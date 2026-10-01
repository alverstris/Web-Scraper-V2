import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import type { AccountView, Actor } from '../shared/contracts.ts';
import type { Repository } from './storage.ts';
import { check } from './errors.ts';

const deriveKey = promisify(scrypt);
export const localSessionCookie = 'keywise_session';
export interface LocalSessionView {account:AccountView;csrfToken:string;actor:Actor}
interface LocalAccount {
  id:string;email:string;name:string;role:'CUSTOMER'|'ADMIN';salt:string;passwordHash:string;
}
interface LocalSession {id:string;uid:string;csrfToken:string;createdAt:string;expiresAt:string}
interface LoginThrottle {id:string;count:number;expiresAt:string}
export interface LocalAuthOptions {clock?:()=>Date;sessionTtlMs?:number}
const digest=(value:string)=>createHash('sha256').update(value).digest('hex');
function equal(actual:string,expected:string){const a=Buffer.from(actual),b=Buffer.from(expected);return a.length===b.length&&timingSafeEqual(a,b);}
async function passwordHash(password:string,salt:string){return (await deriveKey(password,salt,64) as Buffer).toString('hex');}
function accountView(account:LocalAccount):AccountView {
  return {uid:account.id,email:account.email,name:account.name,label:account.name,admin:account.role==='ADMIN',providers:['password']};
}
export function readSessionCookie(cookie:string|undefined):string|undefined {
  const value=cookie?.split(';').map(item=>item.trim()).find(item=>item.startsWith(`${localSessionCookie}=`))?.slice(localSessionCookie.length+1);
  return value&&/^[a-f0-9]{64}$/.test(value)?value:undefined;
}
export function setSessionCookie(token:string,ttlMs:number,secure=false){return `${localSessionCookie}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${Math.ceil(ttlMs/1000)}${secure?'; Secure':''}`;}
export function clearSessionCookie(secure=false){return `${localSessionCookie}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secure?'; Secure':''}`;}

/** Passwords and sessions here are local mock access only. This adapter never runs in live mode. */
export class LocalAuth {
  private ready:Promise<void>|undefined;
  private clock:()=>Date;
  readonly sessionTtlMs:number;
  constructor(private repo:Repository,options:LocalAuthOptions={}) {
    this.clock=options.clock??(()=>new Date());this.sessionTtlMs=options.sessionTtlMs??8*3600_000;
    if(!Number.isFinite(this.sessionTtlMs)||this.sessionTtlMs<1000||this.sessionTtlMs>24*3600_000)throw new Error('Local session lifetime must be 1 second to 24 hours.');
  }
  async initialise(){
    this.ready??=this.seed();return this.ready;
  }
  private async seed(){
    const identities=[['alice','Alice'],['bob','Bob'],['new','New customer'],['exhausted','Customer with used allowance'],['destination-limit','Customer at destination limit'],['suspended','Customer awaiting support'],['admin','Keywise staff']];
    for(const [id,name] of identities){
      if(await this.repo.get('localAccounts',id!))continue;
      const salt=randomBytes(16).toString('hex'),role=id==='admin'?'ADMIN':'CUSTOMER';
      const password=role==='ADMIN'?'Keywise-Staff-2026!':'Keywise-Demo-2026!';
      const account:LocalAccount={id:id!,email:`${id}@keywise.test`,name:name!,role,salt,passwordHash:await passwordHash(password,salt)};
      await this.repo.transaction(async tx=>{if(!(await tx.get('localAccounts',account.id)))tx.put('localAccounts',account.id,account);});
    }
  }
  private async throttle(email:string,remoteAddress:string){
    const now=this.clock().getTime(),window=Math.floor(now/60_000);
    await this.repo.transaction(async tx=>{
      for(const [scope,limit] of [[`email:${email}`,10],[`address:${remoteAddress}`,60]] as const){
        const id=digest([scope,window].join('|')),record=await tx.get<LoginThrottle>('localLoginThrottles',id);
        check((record?.count??0)<limit,429,'LOGIN_RATE_LIMITED','Too many sign-in attempts. Wait a minute and try again.');
        tx.put('localLoginThrottles',id,{id,count:(record?.count??0)+1,expiresAt:new Date((window+1)*60_000).toISOString()} satisfies LoginThrottle);
      }
      for(const expired of await tx.query<LoginThrottle>('localLoginThrottles'))if(Date.parse(expired.expiresAt)<=now)tx.delete('localLoginThrottles',expired.id);
    });
  }
  async login(input:Record<string,unknown>,staffOnly:boolean,remoteAddress:string,oldToken?:string):Promise<{view:LocalSessionView;token:string}>{
    check(Object.keys(input).every(key=>['email','password'].includes(key)),400,'INVALID_SIGN_IN','Supply an email address and password.');
    check(typeof input.email==='string'&&input.email.length<=254&&typeof input.password==='string'&&input.password.length>=1&&input.password.length<=128,400,'INVALID_SIGN_IN','Supply an email address and password.');
    const email=input.email.trim().toLowerCase();await this.initialise();await this.throttle(email,remoteAddress);
    const account=(await this.repo.query<LocalAccount>('localAccounts')).find(candidate=>candidate.email===email);
    const computed=await passwordHash(input.password,account?.salt??'local-sign-in-does-not-disclose-account-presence');
    check(account&&equal(computed,account.passwordHash),401,'INVALID_CREDENTIALS','The email address or password is incorrect.');
    check(!staffOnly||account.role==='ADMIN',403,'STAFF_ACCESS_REQUIRED','This account does not have staff access. Use customer sign-in.');
    const token=randomBytes(32).toString('hex'),csrfToken=randomBytes(32).toString('hex'),now=this.clock();
    const record:LocalSession={id:digest(token),uid:account.id,csrfToken,createdAt:now.toISOString(),expiresAt:new Date(now.getTime()+this.sessionTtlMs).toISOString()};
    await this.repo.transaction(async tx=>{
      if(oldToken)tx.delete('localSessions',digest(oldToken));
      const existing=await tx.query<LocalSession>('localSessions');
      for(const session of existing)if(Date.parse(session.expiresAt)<=now.getTime())tx.delete('localSessions',session.id);
      const active=existing.filter(session=>session.uid===account.id&&Date.parse(session.expiresAt)>now.getTime()&&session.id!==(oldToken?digest(oldToken):undefined)).sort((a,b)=>a.createdAt.localeCompare(b.createdAt)||a.id.localeCompare(b.id));
      // Bound local account sessions while allowing several browser tabs/devices.
      for(const session of active.slice(0,Math.max(0,active.length-7)))tx.delete('localSessions',session.id);
      tx.put('localSessions',record.id,record);
    });
    return {token,view:{account:accountView(account),csrfToken,actor:{uid:account.id,admin:account.role==='ADMIN'}}};
  }
  async session(token:string|undefined):Promise<LocalSessionView|null>{
    if(!token)return null;
    await this.initialise();
    return this.repo.transaction(async tx=>{
      const record=await tx.get<LocalSession>('localSessions',digest(token));
      if(!record)return null;
      const account=await tx.get<LocalAccount>('localAccounts',record.uid);
      if(!account||Date.parse(record.expiresAt)<=this.clock().getTime()){tx.delete('localSessions',record.id);return null;}
      return {account:accountView(account),csrfToken:record.csrfToken,actor:{uid:account.id,admin:account.role==='ADMIN'}};
    });
  }
  checkCsrf(actual:string|undefined,session:LocalSessionView){check(actual&&equal(actual,session.csrfToken),403,'CSRF_REQUIRED','Refresh this page before making this change.');}
  async logout(token:string|undefined){if(token)await this.repo.transaction(async tx=>tx.delete('localSessions',digest(token)));}
}
