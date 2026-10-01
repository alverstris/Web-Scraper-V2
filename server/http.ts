import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import type { CommuteService } from './service.ts';
import { authenticate,authenticateTask,constantEqual } from './auth.ts';
import { ApiError,check } from './errors.ts';
import { LocalAuth,clearSessionCookie,readSessionCookie,setSessionCookie } from './local-auth.ts';

async function body(req:IncomingMessage):Promise<Record<string,unknown>> {
  check(req.headers['content-type']?.split(';')[0]==='application/json',415,'JSON_REQUIRED','Use application/json.');
  const chunks:Buffer[]=[];let bytes=0;
  for await(const chunk of req){bytes+=chunk.length;check(bytes<=32_768,413,'REQUEST_TOO_LARGE','Request body is too large.');chunks.push(chunk);}
  try{const value=JSON.parse(Buffer.concat(chunks).toString('utf8'));check(value&&typeof value==='object'&&!Array.isArray(value),400,'INVALID_JSON','Supply a JSON object.');return value;}
  catch(error){if(error instanceof ApiError)throw error;throw new ApiError(400,'INVALID_JSON','Malformed JSON request.');}
}
function send(res:ServerResponse,status:number,value:unknown,correlationId:string){
  res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','X-Correlation-ID':correlationId,'Referrer-Policy':'no-referrer'});
  res.end(JSON.stringify(value));
}
export function createApiServer(service:CommuteService,options:{workerOnly?:boolean;originSecret?:string;localAuth?:LocalAuth;allowedOrigins?:string[]}={}) {
  const localAuth=service.mode==='demo'?(options.localAuth??new LocalAuth(service.repo)):undefined;
  function secureCookies(){try{return !!process.env.WEB_ORIGIN&&new URL(process.env.WEB_ORIGIN).protocol==='https:';}catch{return false;}}
  function localOrigin(req:IncomingMessage) {
    const origin=req.headers.origin;
    const allowed=new Set(options.allowedOrigins??['http://127.0.0.1:5173','http://localhost:5173','http://[::1]:5173']);
    if(process.env.WEB_ORIGIN)allowed.add(process.env.WEB_ORIGIN);
    try{const endpoint=new URL(`http://${req.headers.host}`);if(['127.0.0.1','localhost','[::1]'].includes(endpoint.hostname))allowed.add(endpoint.origin);}catch{}
    check(origin?allowed.has(origin):req.headers['sec-fetch-site']==='same-origin',403,'ORIGIN_DENIED','Use the Keywise website to sign in or make changes.');
  }
  return createServer(async(req,res)=>{
    const correlationId=randomUUID();
    try {
      const url=new URL(req.url??'/', 'http://local.invalid'),path=url.pathname,method=req.method??'GET';
      if(path==='/health'&&method==='GET'){send(res,200,{ok:true,mode:service.mode},correlationId);return;}
      if(options.workerOnly) {
        check(path==='/internal/batches'&&method==='POST',404,'NOT_FOUND','Endpoint not found.');
        await authenticateTask(req.headers.authorization);
        const input=await body(req);check(typeof input.runId==='string'&&typeof input.batchId==='string',400,'INVALID_TASK','Invalid task payload.');
        await service.processBatch({runId:input.runId,batchId:input.batchId});send(res,200,{accepted:true},correlationId);return;
      }
      if(service.mode==='live')check(options.originSecret&&constantEqual(String(req.headers['x-edge-secret']??''),options.originSecret),403,'ORIGIN_FORBIDDEN','Use the approved website API endpoint.');
      check(path.startsWith('/api/v1/'),404,'NOT_FOUND','Endpoint not found.');
      if(path.startsWith('/api/v1/auth/')) {
        check(localAuth,503,'AUTH_NOT_CONFIGURED','External sign-in is not configured. Local mock accounts do not grant live access.');
        const cookie=readSessionCookie(req.headers.cookie);
        if(path==='/api/v1/auth/session'&&method==='GET') {
          const session=await localAuth.session(cookie);if(cookie&&!session)res.setHeader('Set-Cookie',clearSessionCookie(secureCookies()));
          send(res,200,session?{account:session.account,csrfToken:session.csrfToken}:{account:null,csrfToken:null},correlationId);return;
        }
        if((path==='/api/v1/auth/login'||path==='/api/v1/auth/staff-login')&&method==='POST') {
          localOrigin(req);
          const result=await localAuth.login(await body(req),path.endsWith('/staff-login'),req.socket.remoteAddress??'local',cookie);
          await service.initialiseLocalAccount(result.view.actor);
          res.setHeader('Set-Cookie',setSessionCookie(result.token,localAuth.sessionTtlMs,secureCookies()));
          send(res,200,{account:result.view.account,csrfToken:result.view.csrfToken},correlationId);return;
        }
        if(path==='/api/v1/auth/logout'&&method==='POST') {
          localOrigin(req);const session=await localAuth.session(cookie);if(session)localAuth.checkCsrf(String(req.headers['x-csrf-token']??''),session);
          await localAuth.logout(cookie);res.setHeader('Set-Cookie',clearSessionCookie(secureCookies()));send(res,200,{account:null,csrfToken:null},correlationId);return;
        }
        throw new ApiError(404,'NOT_FOUND','Endpoint not found.');
      }
      if(path==='/api/v1/capabilities'&&method==='GET'){send(res,200,await service.capabilities(),correlationId);return;}
      if(path==='/api/v1/demo/accounts'||path==='/api/v1/demo/sign-in')throw new ApiError(404,'NOT_FOUND','Endpoint not found.');
      const demoListing=path.match(/^\/api\/v1\/demo\/listings\/([^/]+)$/);
      if(demoListing&&method==='GET'){send(res,200,await service.demoListing(demoListing[1]),correlationId);return;}
      if(path==='/api/v1/popular-destinations'&&method==='GET'){send(res,200,await service.popularProfiles(),correlationId);return;}
      const popular=path.match(/^\/api\/v1\/popular-profiles\/([^/]+)$/);
      if(popular&&method==='GET'){send(res,200,await service.popularDataset(popular[1]),correlationId);return;}
      const outbound=path.match(/^\/api\/v1\/outbound\/([^/]+)$/);
      if(outbound&&method==='GET'){send(res,200,await service.outbound(outbound[1]),correlationId);return;}
      const localSession=localAuth?await localAuth.session(readSessionCookie(req.headers.cookie)):null;
      if(localAuth)check(localSession,401,'AUTH_REQUIRED','Sign in to continue.');
      const actor=localSession?.actor??await authenticate(req.headers.authorization,service.mode);
      if(localSession&&method!=='GET'&&method!=='HEAD'){localOrigin(req);localAuth!.checkCsrf(String(req.headers['x-csrf-token']??''),localSession);}
      const group=path.includes('entitlement-verifications')?'verification':path.includes('location-selections')?'location':path.includes('suggestions')?'suggestion':path.includes('support-requests')?'support':path==='/api/v1/runs'?'run':'ordinary';
      if(method!=='GET') await service.rateLimit(actor.uid,group,group==='verification'?3:group==='support'?5:group==='location'?30:group==='suggestion'?10:60,60_000);
      let value:unknown;let status=200;
      if(path==='/api/v1/me/entitlement'&&method==='GET')value=await service.entitlement(actor);
      else if(path==='/api/v1/me/account'&&method==='GET')value=localSession?.account??await service.account(actor);
      else if(path==='/api/v1/me/login-providers'&&method==='POST')throw new ApiError(503,'AUTH_PROVIDER_UNAVAILABLE','External sign-in provider linking is deferred.');
      else if(path==='/api/v1/me/support-requests'&&method==='GET')value=await service.supportRequests(actor);
      else if(path==='/api/v1/account-support-requests'&&method==='POST'){value=await service.requestSupport(actor,await body(req));status=201;}
      else if(path==='/api/v1/entitlement-verifications'&&method==='POST')throw new ApiError(503,'VERIFICATION_GATED','Eligibility verification is deferred.');
      else if(path==='/api/v1/location-selections'&&method==='POST'){const input=await body(req);value=input.query!==undefined?await service.searchLocations(actor,input.query):await service.confirmLocation(actor,input.destinationId);}
      else if(path==='/api/v1/runs'&&method==='POST'){value=await service.createRun(actor,await body(req));status=202;}
      else if(path==='/api/v1/popular-destination-suggestions'&&method==='POST'){value=await service.suggest(actor,await body(req));status=201;}
      else if(path==='/api/v1/admin'&&method==='GET')value=await service.admin(actor);
      else if(path==='/api/v1/admin/kill-switch'&&method==='POST'){const input=await body(req);value=await service.setKillSwitch(actor,input.enabled,input.reason);}
      else if(path==='/api/v1/admin/actions'&&method==='POST')value=await service.adminAction(actor,await body(req));
      else if(path==='/api/v1/admin/popular-profiles'&&method==='POST'){value=await service.publishPopularProfile(actor,await body(req));status=201;}
      else {
        const run=path.match(/^\/api\/v1\/runs\/([^/]+)(?:\/(results|cancel))?$/),suggestion=path.match(/^\/api\/v1\/admin\/suggestions\/([^/]+)$/),support=path.match(/^\/api\/v1\/admin\/support-requests\/([^/]+)$/);
        if(run&&method==='GET'&&!run[2])value=await service.run(actor,run[1]);
        else if(run&&method==='GET'&&run[2]==='results')value=await service.results(actor,run[1]);
        else if(run&&method==='POST'&&run[2]==='cancel')value=await service.cancel(actor,run[1]);
        else if(run&&method==='DELETE'&&!run[2])value=await service.discard(actor,run[1]);
        else if(suggestion&&method==='POST'){const input=await body(req);value=await service.reviewSuggestion(actor,suggestion[1],input.status,input.reason);}
        else if(support&&method==='POST')value=await service.resolveSupport(actor,support[1],await body(req));
        else throw new ApiError(404,'NOT_FOUND','Endpoint not found.');
      }
      send(res,status,value,correlationId);
    } catch(error) {
      const known=error instanceof ApiError;
      if(!known)process.stderr.write(JSON.stringify({level:'error',event:'request_failed',correlationId,category:error instanceof Error?error.name:'unknown'})+'\n');
      send(res,known?error.status:500,{error:{code:known?error.code:'INTERNAL_ERROR',message:known?error.message:'The request could not be completed. Try again or contact support.',correlationId}},correlationId);
    }
  });
}
