import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { LocalAuth,localSessionCookie,setSessionCookie,clearSessionCookie } from '../server/local-auth.ts';
import { CommuteService } from '../server/service.ts';
import { MemoryRepository,MemoryBlobStore } from '../server/storage.ts';
import { createProviders } from '../server/providers/index.ts';
import { createApiServer } from '../server/http.ts';
import { demoDestinations } from '../shared/fixtures.ts';

const password='Keywise-Demo-2026!',staffPassword='Keywise-Staff-2026!';
async function setup(ttl=8*3600_000) {
  let now=new Date('2026-10-01T10:00:00Z');
  const repo=new MemoryRepository(),providers=createProviders('demo');
  const service=new CommuteService({mode:'demo',repo,blobs:new MemoryBlobStore(),...providers,clock:()=>now,queue:{enqueue:async()=>{}}});
  await service.initialise(false);
  const auth=new LocalAuth(repo,{clock:()=>now,sessionTtlMs:ttl});
  const server=createApiServer(service,{localAuth:auth});server.listen(0,'127.0.0.1');await once(server,'listening');
  const origin=`http://127.0.0.1:${(server.address() as AddressInfo).port}`,base=origin+'/api/v1';
  async function request(path:string,options:{method?:string;body?:unknown;cookie?:string;csrf?:string;origin?:string|null;headers?:Record<string,string>}={}) {
    const headers:Record<string,string>={...(options.cookie?{Cookie:options.cookie}:{}),...(options.csrf?{'X-CSRF-Token':options.csrf}:{}),...options.headers};
    if(options.body!==undefined)headers['Content-Type']='application/json';
    if((options.method??'GET')!=='GET'&&options.origin!==null)headers.Origin=options.origin??origin;
    return fetch(base+path,{method:options.method??'GET',headers,...(options.body!==undefined?{body:JSON.stringify(options.body)}:{})});
  }
  async function login(id='alice',staff=false) {
    const response=await request(staff?'/auth/staff-login':'/auth/login',{method:'POST',body:{email:`${id}@keywise.test`,password:id==='admin'?staffPassword:password}});
    assert.equal(response.status,200);const data=await response.json(),cookie=response.headers.get('set-cookie')!.split(';')[0]!;
    return {cookie,csrf:data.csrfToken as string,account:data.account,response};
  }
  async function close(){server.close();await once(server,'close');}
  return {repo,service,auth,request,login,close,advance:(ms:number)=>{now=new Date(now.getTime()+ms);}};
}

test('local sign-in uses salted password hashes and opaque HttpOnly sessions without exposing credentials',async()=>{
  const h=await setup();
  try {
    assert.deepEqual(await (await h.request('/auth/session')).json(),{account:null,csrfToken:null});
    const login=await h.login();assert.equal(login.account.uid,'alice');assert.equal(login.account.email,'alice@keywise.test');assert.equal(login.account.name,'Alice');assert.equal(login.account.admin,false);
    const cookie=login.response.headers.get('set-cookie')!;assert.match(cookie,/HttpOnly/);assert.match(cookie,/SameSite=Strict/);assert.match(cookie,/Path=\//);assert.match(cookie,/Max-Age=28800/);
    assert.match(login.cookie,new RegExp(`^${localSessionCookie}=[a-f0-9]{64}$`));assert.match(login.csrf,/^[a-f0-9]{64}$/);
    const session=await (await h.request('/auth/session',{cookie:login.cookie})).json();assert.deepEqual(session.account,login.account);assert.equal(session.csrfToken,login.csrf);
    const stored=JSON.stringify(await h.repo.query('localAccounts'));assert.equal(stored.includes(password),false);assert.equal(stored.includes(staffPassword),false);assert.match(stored,/passwordHash/);
    const sessions=JSON.stringify(await h.repo.query('localSessions'));assert.equal(sessions.includes(login.cookie.split('=')[1]!),false);
    const denied=await h.request('/auth/login',{method:'POST',body:{email:'alice@keywise.test',password:'incorrect'}});assert.equal(denied.status,401);assert.equal(denied.headers.has('set-cookie'),false);
  } finally {await h.close();}
});

test('staff login and every admin request derive roles from server accounts',async()=>{
  const h=await setup();
  try {
    const refused=await h.request('/auth/staff-login',{method:'POST',body:{email:'alice@keywise.test',password}});assert.equal(refused.status,403);assert.equal(refused.headers.has('set-cookie'),false);
    const injection=await h.request('/auth/login',{method:'POST',body:{email:'alice@keywise.test',password,admin:true}});assert.equal(injection.status,400);
    const customer=await h.login(),staff=await h.login('admin',true);
    assert.equal(staff.account.admin,true);
    assert.equal((await h.request('/admin',{cookie:customer.cookie,headers:{'X-User-Id':'admin',Authorization:'Bearer demo-admin'}})).status,403);
    assert.equal((await h.request('/admin',{cookie:staff.cookie})).status,200);
    await h.repo.transaction(async tx=>{const account=await tx.get<{id:string;role:string}>('localAccounts','admin');tx.put('localAccounts','admin',{...account,role:'CUSTOMER'});});
    assert.equal((await h.request('/admin',{cookie:staff.cookie})).status,403);
    assert.equal((await (await h.request('/auth/session',{cookie:staff.cookie})).json()).account.admin,false);
  } finally {await h.close();}
});

test('public fixture identity selection and known bearer tokens cannot authenticate customers or staff',async()=>{
  const h=await setup();
  try {
    assert.equal((await h.request('/demo/accounts')).status,404);
    assert.equal((await h.request('/demo/sign-in',{method:'POST',body:{accountId:'admin',provider:'google'}})).status,404);
    for(const token of ['demo-alice','demo-admin','demo-alice-linked'])assert.equal((await h.request('/admin',{headers:{Authorization:`Bearer ${token}`}})).status,401);
    assert.equal((await h.request('/me/account',{headers:{'X-User-Id':'alice'}})).status,401);
    assert.equal((await h.request('/auth/session',{cookie:`${localSessionCookie}=demo-admin`})).status,200);
    assert.equal((await (await h.request('/auth/session',{cookie:`${localSessionCookie}=demo-admin`})).json()).account,null);
  } finally {await h.close();}
});

test('login rejects foreign origins and protected changes require same-origin CSRF',async()=>{
  const h=await setup();
  try {
    const credentials={email:'admin@keywise.test',password:staffPassword};
    assert.equal((await h.request('/auth/staff-login',{method:'POST',body:credentials,origin:'https://attacker.example'})).status,403);
    assert.equal((await h.request('/auth/staff-login',{method:'POST',body:credentials,origin:null})).status,403);
    const staff=await h.login('admin',true),body={enabled:true,reason:'Test a reviewed local spending stop'};
    assert.equal((await h.request('/admin/kill-switch',{method:'POST',body,cookie:staff.cookie})).status,403);
    assert.equal((await h.request('/admin/kill-switch',{method:'POST',body,cookie:staff.cookie,csrf:'wrong'})).status,403);
    assert.equal((await h.request('/admin/kill-switch',{method:'POST',body,cookie:staff.cookie,csrf:staff.csrf,origin:'https://attacker.example'})).status,403);
    assert.equal((await h.service.capabilities()).features.customRuns,true);
    assert.equal((await h.request('/admin/kill-switch',{method:'POST',body,cookie:staff.cookie,csrf:staff.csrf})).status,200);
    assert.equal((await h.service.capabilities()).features.customRuns,false);
  } finally {await h.close();}
});

test('session rotation, expiry and logout revoke previous access',async()=>{
  const h=await setup(1000);
  try {
    const first=await h.login();
    const replacementResponse=await h.request('/auth/login',{method:'POST',body:{email:'bob@keywise.test',password},cookie:first.cookie});
    assert.equal(replacementResponse.status,200);const replacement=await replacementResponse.json(),cookie=replacementResponse.headers.get('set-cookie')!.split(';')[0]!;
    assert.notEqual(cookie,first.cookie);assert.equal((await h.request('/me/account',{cookie:first.cookie})).status,401);
    assert.equal((await h.request('/auth/logout',{method:'POST',cookie,csrf:'wrong'})).status,403);
    assert.equal((await h.request('/me/account',{cookie})).status,200);
    const logout=await h.request('/auth/logout',{method:'POST',cookie,csrf:replacement.csrfToken});assert.equal(logout.status,200);assert.match(logout.headers.get('set-cookie')!,/Max-Age=0/);
    assert.equal((await h.request('/me/account',{cookie})).status,401);
    const third=await h.login();h.advance(1000);
    assert.equal((await h.request('/me/account',{cookie:third.cookie})).status,401);
    assert.deepEqual(await (await h.request('/auth/session',{cookie:third.cookie})).json(),{account:null,csrfToken:null});
  } finally {await h.close();}
});

test('cookie sessions preserve private run ownership and independent allowances',async()=>{
  const h=await setup();
  try {
    const alice=await h.login(),bob=await h.login('bob');
    await h.request('/location-selections',{method:'POST',cookie:alice.cookie,csrf:alice.csrf,body:{query:'EPFL'}});
    const selection=await (await h.request('/location-selections',{method:'POST',cookie:alice.cookie,csrf:alice.csrf,body:{destinationId:demoDestinations[0].id}})).json();
    const body={idempotencyKey:'cookie-session-run',destinationSelectionId:selection.selectionId,marketId:'ch-vaud-demo',searchScope:'STANDARD',routeDefinition:{direction:'HOME_TO_DESTINATION',mode:'TRANSIT',transitPreference:'DEFAULT',preferredTransitModes:[],timeBasis:{kind:'ARRIVAL',at:'2026-10-06T08:30:00+02:00',timezone:'Europe/Zurich'}}};
    const created=await h.request('/runs',{method:'POST',cookie:alice.cookie,csrf:alice.csrf,body});assert.equal(created.status,202);const run=await created.json();
    assert.equal((await h.request(`/runs/${run.id}`,{cookie:alice.cookie})).status,200);
    for(const suffix of ['', '/results'])assert.equal((await h.request(`/runs/${run.id}${suffix}`,{cookie:bob.cookie})).status,404);
    const a=await (await h.request('/me/entitlement',{cookie:alice.cookie})).json(),b=await (await h.request('/me/entitlement',{cookie:bob.cookie})).json();
    assert.equal(a.remainingRuns,1);assert.equal(b.remainingRuns,2);
    const next=await h.login('new');assert.equal((await (await h.request('/me/entitlement',{cookie:next.cookie})).json()).verificationRequired,false);
  } finally {await h.close();}
});

test('credential retries are throttled before unlimited password work',async()=>{
  const h=await setup();
  try {
    for(let attempt=0;attempt<10;attempt++)assert.equal((await h.request('/auth/login',{method:'POST',body:{email:'alice@keywise.test',password:'incorrect'}})).status,401);
    const limited=await h.request('/auth/login',{method:'POST',body:{email:'alice@keywise.test',password}});assert.equal(limited.status,429);assert.equal((await limited.json()).error.code,'LOGIN_RATE_LIMITED');
    h.advance(60_000);assert.equal((await h.request('/auth/login',{method:'POST',body:{email:'alice@keywise.test',password}})).status,200);
  } finally {await h.close();}
});

test('local session records stay bounded and expired records are removed on sign-in',async()=>{
  const h=await setup();
  try {
    await h.repo.transaction(async tx=>tx.put('localSessions','expired-test-session',{id:'expired-test-session',uid:'bob',csrfToken:'expired',createdAt:'2026-09-01T00:00:00Z',expiresAt:'2026-09-01T01:00:00Z'}));
    for(let index=0;index<9;index++)await h.login();
    const sessions=await h.repo.query<{uid:string}>('localSessions');assert.equal(sessions.length,8);assert.ok(sessions.every(session=>session.uid==='alice'));
    assert.match(setSessionCookie('a'.repeat(64),1000,true),/; Secure$/);assert.doesNotMatch(setSessionCookie('a'.repeat(64),1000),/Secure/);assert.match(clearSessionCookie(true),/; Secure$/);
  } finally {await h.close();}
});
