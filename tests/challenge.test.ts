import {test} from 'node:test';import assert from 'node:assert/strict';import {validateChallenge} from '../server/challenge.ts';
test('A30 live challenge validates hostname, action, timestamp and provider success; failures deny',async()=>{
 const prior={secret:process.env.TURNSTILE_SECRET,hosts:process.env.TURNSTILE_ALLOWED_HOSTNAMES};process.env.TURNSTILE_SECRET='synthetic-test-secret';process.env.TURNSTILE_ALLOWED_HOSTNAMES='commute.example.com';
 try{
  const good={success:true,action:'custom-run',hostname:'commute.example.com',challenge_ts:new Date().toISOString()};
  for(const [body,expected]of [[good,true],[{...good,success:false},false],[{...good,hostname:'evil.example'},false],[{...good,action:'other'},false],[{...good,challenge_ts:'2020-01-01T00:00:00Z'},false],[{...good,challenge_ts:'invalid'},false]]as const){
   assert.equal(await validateChallenge('test-token',(async()=>new Response(JSON.stringify(body)))as typeof fetch),expected);
  }
  assert.equal(await validateChallenge('test-token',(async()=>{throw new Error('offline')})as typeof fetch),false);
  delete process.env.TURNSTILE_SECRET;assert.equal(await validateChallenge('test-token'),false);
 }finally{if(prior.secret===undefined)delete process.env.TURNSTILE_SECRET;else process.env.TURNSTILE_SECRET=prior.secret;if(prior.hosts===undefined)delete process.env.TURNSTILE_ALLOWED_HOSTNAMES;else process.env.TURNSTILE_ALLOWED_HOSTNAMES=prior.hosts}
});
