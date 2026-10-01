import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { Actor, CreateRunRequest, Entitlement, ListingVersion, RouteDefinition } from '../shared/contracts.ts';
import { demoDestinations } from '../shared/fixtures.ts';
import { CommuteService } from '../server/service.ts';
import { MemoryRepository, MemoryBlobStore } from '../server/storage.ts';
import { createProviders } from '../server/providers/index.ts';
import { createApiServer } from '../server/http.ts';
import { authenticate } from '../server/auth.ts';
import { ApiError } from '../server/errors.ts';
import { demoQueueDelay, LocalQueue } from '../server/queue.ts';

const actor=(uid:string):Actor=>({uid,admin:uid==='admin'});
const hasCode=(code:string)=>(error:unknown)=>error instanceof ApiError&&error.code===code;
async function setup(at='2026-09-30T12:00:00Z') {
  let current=new Date(at);
  const repo=new MemoryRepository(),providers=createProviders('demo');
  let routeCalls=0;
  const route={...providers.route,id:providers.route.id,version:providers.route.version,maxBatchSize:providers.route.maxBatchSize,async route(listings:ListingVersion[],definition:RouteDefinition){routeCalls++;return providers.route.route(listings,definition);}};
  const service=new CommuteService({mode:'demo',repo,blobs:new MemoryBlobStore(),...providers,route,clock:()=>current,queue:{enqueue:async()=>{}}});
  await service.initialise(false);
  async function request(uid:string,index=0,key='demo-request-key'):Promise<CreateRunRequest> {
    const account=actor(uid);await service.searchLocations(account,'demo');
    const selection=await service.confirmLocation(account,demoDestinations[index].id);
    return {idempotencyKey:key,destinationSelectionId:selection.selectionId,marketId:'ch-vaud-demo',searchScope:'STANDARD',routeDefinition:{direction:'HOME_TO_DESTINATION',mode:'TRANSIT',transitPreference:'DEFAULT',preferredTransitModes:[],timeBasis:{kind:'ARRIVAL',at:'2026-10-06T08:30:00+02:00',timezone:'Europe/Zurich'}}};
  }
  return {service,repo,request,routeCalls:()=>routeCalls,setTime:(value:string)=>{current=new Date(value);}};
}

test('demo sign-in and provider linking retain account, entitlement and usage; a new sign-in gets only one synthetic allowance',async()=>{
  const h=await setup(),alice=actor('alice');
  const signedIn=await h.service.demoSignIn({accountId:'alice',provider:'google'});
  assert.equal(signedIn.token,'demo-alice');assert.equal(signedIn.account.admin,false);assert.deepEqual(signedIn.account.providers,['google.com']);
  const run=await h.service.createRun(alice,await h.request('alice'));
  const before=await h.service.entitlement(alice);
  await assert.rejects(h.service.demoSignIn({accountId:'alice',provider:'microsoft'}),hasCode('PROVIDER_NOT_LINKED'));
  assert.deepEqual((await h.service.linkDemoProvider(alice,{provider:'microsoft'})).providers,['google.com','microsoft.com']);
  const linked=await h.service.demoSignIn({accountId:'alice',provider:'microsoft'});
  assert.equal(linked.account.uid,alice.uid);assert.deepEqual(await h.service.entitlement(alice),before);
  assert.equal((await h.service.run(alice,run.id)).id,run.id);
  await assert.rejects(authenticate('Bearer demo-alice-linked','demo'),hasCode('LOCAL_SESSION_REQUIRED'));
  assert.equal((await h.service.entitlement(actor('new'))).entitlement,null);
  await Promise.all([h.service.demoSignIn({accountId:'new',provider:'microsoft'}),h.service.demoSignIn({accountId:'new',provider:'microsoft'})]);
  const entitlement=await h.service.entitlement(actor('new'));
  assert.equal(entitlement.accountState,'ACTIVE');assert.equal(entitlement.remainingRuns,2);assert.equal(entitlement.entitlement?.policyVersion,'demo-verification-deferred');
  assert.equal((await h.repo.query<Entitlement>('entitlements')).filter(item=>item.userIds.includes('new')).length,1);
  assert.equal((await h.service.capabilities()).features.verification,false);
});

test('scenario entitlement states distinguish run limits, destination reuse and suspended support',async()=>{
  const h=await setup();
  for(const id of ['alice','bob','new','exhausted','destination-limit','suspended','admin'])await assert.rejects(authenticate(`Bearer demo-${id}`,'demo'),hasCode('LOCAL_SESSION_REQUIRED'));
  const exhausted=await h.service.entitlement(actor('exhausted'));
  assert.equal(exhausted.accountState,'RUN_LIMIT_REACHED');assert.equal(exhausted.canStartCustomRun,false);
  await assert.rejects(h.service.createRun(actor('exhausted'),await h.request('exhausted')),hasCode('RUN_ALLOWANCE_EXHAUSTED'));
  const limited=await h.service.entitlement(actor('destination-limit'));
  assert.equal(limited.accountState,'DESTINATION_LIMIT_REACHED');assert.equal(limited.remainingRuns,2);assert.equal(limited.canStartCustomRun,true);assert.deepEqual(limited.usedDestinationIds,['epfl-east']);
  await assert.rejects(h.service.createRun(actor('destination-limit'),await h.request('destination-limit',1)),hasCode('DESTINATION_ALLOWANCE_EXHAUSTED'));
  assert.equal((await h.service.entitlement(actor('destination-limit'))).remainingRuns,2);
  await h.service.createRun(actor('destination-limit'),await h.request('destination-limit',0));
  assert.equal((await h.service.entitlement(actor('destination-limit'))).remainingRuns,1);
  const suspended=await h.service.entitlement(actor('suspended'));
  assert.equal(suspended.accountState,'SUSPENDED');assert.equal(suspended.verificationRequired,false);assert.equal(suspended.supportRequired,true);assert.equal(suspended.canStartCustomRun,false);
  await h.service.demoSignIn({accountId:'suspended',provider:'google'});
  await assert.rejects(h.service.createRun(actor('suspended'),await h.request('suspended')),hasCode('ENTITLEMENT_UNAVAILABLE'));
  assert.equal((await h.service.account(actor('admin'))).admin,true);
  assert.equal((await h.service.account(actor('alice'))).admin,false);
});

test('allowance reset uses the server policy timezone across daylight-saving changes',async()=>{
  const h=await setup('2026-03-28T23:30:00Z');
  const spring=await h.service.entitlement(actor('alice'));
  assert.equal(spring.dayKey,'2026-03-29');assert.equal(spring.resetsAt,'2026-03-29T22:00:00.000Z');
  await h.service.createRun(actor('alice'),await h.request('alice'));
  h.setTime(spring.resetsAt);
  const fresh=await h.service.entitlement(actor('alice'));
  assert.equal(fresh.remainingRuns,2);assert.deepEqual(fresh.usedDestinationIds,[]);
  h.setTime('2026-10-24T22:30:00Z');
  const autumn=await h.service.entitlement(actor('alice'));
  assert.equal(autumn.dayKey,'2026-10-25');assert.equal(autumn.resetsAt,'2026-10-25T23:00:00.000Z');
});

test('support is private, audited and cannot grant allowance through a response',async()=>{
  const h=await setup(),newAccount=actor('new'),admin=actor('admin');
  const request=await h.service.requestSupport(newAccount,{category:'ACCESS',message:'Please help me recover access to my account.'});
  assert.equal(request.status,'OPEN');assert.deepEqual(await h.service.supportRequests(actor('bob')),[]);
  await assert.rejects(h.service.resolveSupport(actor('alice'),request.id,{response:'Your request was reviewed.',reason:'local test'}),hasCode('ADMIN_REQUIRED'));
  await assert.rejects(h.service.resolveSupport(admin,request.id,{response:'Your request was reviewed.',reason:''}),hasCode('REASON_REQUIRED'));
  assert.equal((await h.service.supportRequests(newAccount))[0].status,'OPEN');
  const resolved=await h.service.resolveSupport(admin,request.id,{response:'Use your connected provider to recover your account.',reason:'Reviewed the local account request'});
  assert.equal(resolved.status,'RESOLVED');assert.ok(resolved.resolvedAt);assert.equal((await h.service.entitlement(newAccount)).entitlement,null);
  const console=await h.service.admin(admin);assert.equal(console.supportRequests[0].response,resolved.response);assert.equal(console.audit.length,1);assert.ok(console.entitlements.length>=6);
  await assert.rejects(h.service.requestSupport(newAccount,{category:'ACCESS',message:'short'}),hasCode('INVALID_SUPPORT_REQUEST'));
});

test('suggestions require active accounts and count one nomination per entitlement',async()=>{
  const h=await setup();
  await assert.rejects(h.service.suggest(actor('new'),{destinationSelectionId:(await h.request('new')).destinationSelectionId}),hasCode('SUGGESTION_ELIGIBILITY_REQUIRED'));
  await assert.rejects(h.service.suggest(actor('suspended'),{destinationSelectionId:(await h.request('suspended')).destinationSelectionId}),hasCode('SUGGESTION_ELIGIBILITY_REQUIRED'));
  const a=await h.service.suggest(actor('alice'),{destinationSelectionId:(await h.request('alice')).destinationSelectionId});
  await h.repo.transaction(async tx=>tx.put('identities','linked-other-uid',{id:'linked-other-uid',entitlementId:'demo-alice'}));
  const alias=await h.service.suggest(actor('linked-other-uid'),{destinationSelectionId:(await h.request('linked-other-uid')).destinationSelectionId});
  assert.equal(alias.id,a.id);assert.equal(alias.distinctRequests,1);
  assert.equal((await h.service.suggest(actor('bob'),{destinationSelectionId:(await h.request('bob')).destinationSelectionId})).distinctRequests,2);
  assert.equal((await h.repo.query('runs')).length,0);
});

test('demo account and source handoff HTTP endpoints work while live mode denies demo authentication',async()=>{
  const h=await setup(),server=createApiServer(h.service);server.listen(0,'127.0.0.1');await once(server,'listening');
  const address=server.address();assert.ok(address&&typeof address==='object');const base=`http://127.0.0.1:${address.port}/api/v1`;
  try {
    const scenarios=await fetch(`${base}/demo/accounts`);assert.equal(scenarios.status,404);
    const signIn=await fetch(`${base}/auth/staff-login`,{method:'POST',headers:{'Content-Type':'application/json',Origin:base.replace('/api/v1','')},body:JSON.stringify({email:'admin@keywise.test',password:'Keywise-Staff-2026!'})});
    const session=await signIn.json();assert.equal(session.account.admin,true);const cookie=signIn.headers.get('set-cookie')!.split(';')[0]!;
    const account=await fetch(`${base}/me/account`,{headers:{Cookie:cookie}});assert.deepEqual(await account.json(),session.account);
    const listing=await fetch(`${base}/demo/listings/demo-1`);assert.equal(listing.status,200);assert.equal((await listing.json()).id,'demo-1');assert.match(listing.headers.get('cache-control')??'',/no-store/);
    assert.equal((await fetch(`${base}/demo/listings/missing`)).status,404);
    assert.equal((await fetch(`${base}/me/support-requests`)).status,401);
  } finally {server.close();await once(server,'close');}
  const providers=createProviders('demo'),live=new CommuteService({mode:'live',repo:new MemoryRepository(),blobs:new MemoryBlobStore(),...providers,queue:{enqueue:async()=>{}}});
  await assert.rejects(live.demoSignIn({accountId:'admin',provider:'google'}),hasCode('NOT_FOUND'));
  await assert.rejects(live.demoListing('demo-1'),hasCode('NOT_FOUND'));
  await assert.rejects(live.linkDemoProvider(actor('alice'),{provider:'microsoft'}),hasCode('DEMO_AUTH_ONLY'));
  assert.throws(()=>live.demoScenarios(),hasCode('NOT_FOUND'));
});

test('approving nominations does no routing; explicit admin publication and refresh preserve exact destination and maintenance settings',async()=>{
  const h=await setup(),admin=actor('admin');
  const east=await h.service.suggest(actor('alice'),{destinationSelectionId:(await h.request('alice',0)).destinationSelectionId});
  const west=await h.service.suggest(actor('bob'),{destinationSelectionId:(await h.request('bob',1)).destinationSelectionId});
  const definition=(await h.request('alice')).routeDefinition;
  const input={suggestionId:east.id,name:'EPFL east weekday arrival',marketId:'ch-vaud-demo',routeDefinition:definition,refreshPolicy:'Manual refresh for the stated weekday journey.',reason:'Publish a reviewed synthetic campus profile'};
  await assert.rejects(h.service.publishPopularProfile(admin,input),hasCode('SUGGESTION_NOT_APPROVED'));assert.equal(h.routeCalls(),0);
  await h.service.reviewSuggestion(admin,east.id,'APPROVED','Reviewed the intended east entrance');
  await h.service.reviewSuggestion(admin,west.id,'APPROVED','Reviewed the separate west entrance');
  assert.equal(h.routeCalls(),0);assert.equal((await h.service.popularProfiles()).length,0);
  await assert.rejects(h.service.publishPopularProfile(actor('alice'),input),hasCode('ADMIN_REQUIRED'));
  await assert.rejects(h.service.publishPopularProfile(admin,{...input,reason:''}),hasCode('REASON_REQUIRED'));
  await assert.rejects(h.service.publishPopularProfile(admin,{...input,routeDefinition:{...definition,mode:'WALK'}}),hasCode('UNSUPPORTED_SETTINGS'));
  assert.equal(h.routeCalls(),0);
  const eastProfile=await h.service.publishPopularProfile(admin,input),eastDataset=await h.service.popularDataset(eastProfile.id);
  assert.ok(h.routeCalls()>0);assert.equal(eastDataset.counts.total,24);assert.equal(eastDataset.state,'COMPLETE');assert.equal(eastDataset.synthetic,true);
  assert.deepEqual(eastDataset.definition.destination.point,demoDestinations[0].point);assert.equal(eastDataset.definition.timeBasis.at,definition.timeBasis.at);
  assert.equal((await h.service.entitlement(actor('alice'))).remainingRuns,2);
  const westProfile=await h.service.publishPopularProfile(admin,{...input,suggestionId:west.id,name:'EPFL west weekday arrival'});
  assert.notEqual(westProfile.id,eastProfile.id);assert.notDeepEqual(westProfile.destination.point,eastProfile.destination.point);
  await assert.rejects(h.service.publishPopularProfile(admin,{...input,profileId:eastProfile.id,suggestionId:west.id}),hasCode('PROFILE_DESTINATION_CONFLICT'));
  const beforeRefresh=eastProfile.datasetId;
  const updated=await h.service.publishPopularProfile(admin,{...input,suggestionId:undefined,profileId:eastProfile.id,routeDefinition:{...definition,timeBasis:{...definition.timeBasis,at:'2026-10-07T08:30:00+02:00'}}});
  assert.equal(updated.id,eastProfile.id);assert.notEqual(updated.datasetId,beforeRefresh);
  assert.equal((await h.service.popularDataset(updated.id)).definition.timeBasis.at,'2026-10-07T08:30:00+02:00');
  await h.service.maintainPopular();
  assert.equal((await h.service.popularProfiles()).find(profile=>profile.id===updated.id)?.definition.timeBasis.at,'2026-10-07T08:30:00+02:00');
  assert.equal((await h.service.admin(admin)).audit.filter(audit=>audit.action==='POPULAR_PROFILE_PUBLISH').length,3);
  await h.service.adminAction(admin,{action:'UNPUBLISH_PROFILE',targetId:updated.id,reason:'Stop maintaining this reviewed demo profile'});
  await h.service.maintainPopular();assert.equal((await h.service.popularProfiles()).some(profile=>profile.id===updated.id),false);
  const republished=await h.service.publishPopularProfile(admin,input);assert.equal(republished.id,eastProfile.id);
  const providers=createProviders('demo'),live=new CommuteService({mode:'live',repo:new MemoryRepository(),blobs:new MemoryBlobStore(),...providers,queue:{enqueue:async()=>{}}});
  await assert.rejects(live.publishPopularProfile(admin,input),hasCode('POPULAR_PUBLICATION_GATED'));
});

test('demo queue delay is bounded and cancellable before provider work without affecting live queues',async()=>{
  assert.equal(demoQueueDelay(undefined),1800);assert.equal(demoQueueDelay('0'),0);assert.equal(demoQueueDelay('10000'),10000);
  for(const value of ['-1','10001','1.5','NaN','Infinity',''])assert.throws(()=>demoQueueDelay(value),/DEMO_QUEUE_DELAY_MS/);
  let calls=0;const queue=new LocalQueue(async()=>{calls++;},30);
  await queue.enqueue({runId:'run',batchId:'batch'});await queue.enqueue({runId:'run',batchId:'batch'});
  assert.equal(calls,0);queue.close();await new Promise(resolve=>setTimeout(resolve,50));assert.equal(calls,0);
});
