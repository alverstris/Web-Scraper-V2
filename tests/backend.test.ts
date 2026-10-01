import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type {Actor,CreateRunRequest,ListingVersion,RouteDefinition,RouteProvider,Source} from '../shared/contracts.ts';
import { demoDestinations,demoListings } from '../shared/fixtures.ts';
import { CommuteService } from '../server/service.ts';
import { MemoryRepository,MemoryBlobStore,FileRepository,FileBlobStore } from '../server/storage.ts';
import { createProviders } from '../server/providers/index.ts';
import { createApiServer } from '../server/http.ts';
import { authenticate } from '../server/auth.ts';
import { ApiError } from '../server/errors.ts';
import type { TaskPayload } from '../server/queue.ts';
const alice:Actor={uid:'alice',admin:false},bob:Actor={uid:'bob',admin:false},admin:Actor={uid:'admin',admin:true};
async function setup(overrides:{route?:RouteProvider;maxCandidates?:number}={}) {
  const providers=createProviders('demo'),repo=new MemoryRepository(),blobs=new MemoryBlobStore(),tasks:TaskPayload[]=[];
  let calls=0;const definitions:RouteDefinition[]=[];
  const route=overrides.route??{...providers.route,id:providers.route.id,version:providers.route.version,maxBatchSize:6,
    async route(listings:ListingVersion[],definition:RouteDefinition){calls++;definitions.push(structuredClone(definition));return providers.route.route(listings,definition);}};
  const service=new CommuteService({mode:'demo',repo,blobs,...providers,route,queue:{enqueue:async task=>{tasks.push(task);}},maxCandidates:overrides.maxCandidates});
  await service.initialise(false);
  async function request(actor=alice,index=0,key='submission-key-0001'):Promise<CreateRunRequest> {
    await service.searchLocations(actor,'demo');const selection=await service.confirmLocation(actor,demoDestinations[index].id);
    return {idempotencyKey:key,destinationSelectionId:selection.selectionId,marketId:'ch-vaud-demo',searchScope:'STANDARD',routeDefinition:{direction:'HOME_TO_DESTINATION',mode:'TRANSIT',transitPreference:'DEFAULT',preferredTransitModes:[],timeBasis:{kind:'ARRIVAL',at:'2026-10-06T08:30:00+02:00',timezone:'Europe/Zurich'}}};
  }
  async function drain(){let guard=0;while(tasks.length){assert.ok(guard++<100);await service.processBatch(tasks.shift()!);}}
  return {service,repo,blobs,tasks,request,drain,calls:()=>calls,definitions};
}
const code=(expected:string)=>(error:unknown)=>error instanceof ApiError&&error.code===expected;

test('A01/A02/A03/A16/A17 whole immutable universe and stable journey assumptions; reading/filtering never reroutes',async()=>{
  const h=await setup(),request=await h.request(),run=await h.service.createRun(alice,request);
  assert.equal(run.counts.total,demoListings.length);assert.equal(h.calls(),0);
  await assert.rejects(h.service.createRun(alice,{...request,idempotencyKey:'different-key-0001',maxRent:1000}),code('INVALID_RUN'));
  await h.repo.transaction(async tx=>{const listing=await tx.get<ListingVersion>('listings','demo-1');assert.ok(listing);listing.rent.amount=9999;listing.version='changed';tx.put('listings',listing.id,listing);});
  await h.service.processBatch(h.tasks.shift()!);const partial=await h.service.results(alice,run.id);assert.ok(partial.counts.completed<partial.counts.total);
  await h.drain();const dataset=await h.service.results(alice,run.id),calls=h.calls();
  assert.equal(dataset.state,'COMPLETE');assert.equal(dataset.rows.length,demoListings.length);assert.notEqual(dataset.listings[0].rent.amount,9999);
  assert.equal(new Set(dataset.rows.map(r=>r.listingId)).size,demoListings.length);
  assert.ok(dataset.rows.filter(r=>r.state!=='SUCCESS').every(r=>r.durationSeconds===undefined));
  for(let n=0;n<10;n++){const data=await h.service.results(alice,run.id);data.listings.filter(l=>(l.rent.amount??Infinity)<1000);}
  assert.equal(h.calls(),calls);assert.ok(h.definitions.every(d=>d.timeBasis.at===request.routeDefinition.timeBasis.at));
});
test('A04/A05 identical and nearby destinations create private owner-isolated computations',async()=>{
  const h=await setup(),a=await h.service.createRun(alice,await h.request(alice)),b=await h.service.createRun(bob,await h.request(bob));
  assert.notEqual(a.id,b.id);await assert.rejects(h.service.run(bob,a.id),code('RUN_NOT_FOUND'));await assert.rejects(h.service.results(bob,a.id),code('RUN_NOT_FOUND'));await assert.rejects(h.service.cancel(bob,a.id),code('RUN_NOT_FOUND'));await assert.rejects(h.service.discard(bob,a.id),code('RUN_NOT_FOUND'));
  const west=await h.service.createRun(alice,await h.request(alice,1,'submission-key-0002'));assert.notDeepEqual(a.definition.destination.point,west.definition.destination.point);
  await h.drain();assert.equal((await h.service.entitlement(alice)).remainingRuns,0);assert.equal((await h.service.entitlement(bob)).remainingRuns,1);
});
test('A06 duplicate request and duplicate worker delivery debit and compute once',async()=>{
  const h=await setup(),request=await h.request(),runs=await Promise.all([h.service.createRun(alice,request),h.service.createRun(alice,request)]);
  assert.equal(runs[0].id,runs[1].id);assert.equal((await h.service.entitlement(alice)).remainingRuns,1);assert.equal(h.tasks.length,4);
  assert.equal((await h.service.createRun(alice,{...request,verificationChallenge:'fresh-challenge-token'})).id,runs[0].id);
  const task=h.tasks.shift()!;await Promise.all([h.service.processBatch(task),h.service.processBatch(task)]);const calls=h.calls();await h.service.processBatch(task);assert.equal(h.calls(),calls);
  await h.drain();assert.equal((await h.service.run(alice,runs[0].id)).counts.completed,24);
  await assert.rejects(h.service.createRun(alice,{...request,routeDefinition:{...request.routeDefinition,transitPreference:'LESS_WALKING'}}),code('IDEMPOTENCY_CONFLICT'));
});
test('A07 concurrent submissions cannot overdraw an entitlement',async()=>{
  const h=await setup(),request=await h.request();const attempts=await Promise.allSettled(Array.from({length:5},(_,i)=>h.service.createRun(alice,{...request,idempotencyKey:`concurrent-submit-${i}`})));
  assert.equal(attempts.filter(r=>r.status==='fulfilled').length,2);assert.equal((await h.service.entitlement(alice)).remainingRuns,0);assert.equal((await h.repo.query('runs')).length,2);
});
test('A08/A09/A10 linked login preserves entitlement; evidence cannot mint duplicate allowances',async()=>{
  const h=await setup();await assert.rejects(authenticate('Bearer demo-alice-linked','demo'),code('LOCAL_SESSION_REQUIRED'));
  assert.equal((await h.service.entitlement(alice)).entitlement?.id,'demo-alice');
  const charlie={uid:'charlie',admin:false},dan={uid:'dan',admin:false};await h.service.verify(charlie,'same-human');await assert.rejects(h.service.verify(dan,' SAME-HUMAN '),code('EVIDENCE_ALREADY_USED'));
  await h.service.verify(dan,'separate-human');assert.notEqual((await h.service.entitlement(charlie)).entitlement?.id,(await h.service.entitlement(dan)).entitlement?.id);
  assert.ok(!(JSON.stringify(await h.repo.query('evidence'))).includes('same-human'));
});
test('capacity and unsupported inputs fail before allowance reservation or provider work',async()=>{
  const h=await setup({maxCandidates:10}),request=await h.request();await assert.rejects(h.service.createRun(alice,request),code('CAPACITY_EXCEEDED'));assert.equal((await h.service.entitlement(alice)).remainingRuns,2);assert.equal(h.tasks.length,0);
  await assert.rejects(h.service.createRun(alice,{...request,routeDefinition:{...request.routeDefinition,mode:'WALK'}}),code('UNSUPPORTED_SETTINGS'));assert.equal(h.calls(),0);
});
test('cancellation before external work releases allowance; cancellation after work finalises once',async()=>{
  const h=await setup(),run=await h.service.createRun(alice,await h.request());assert.equal((await h.service.cancel(alice,run.id)).accounting,'RELEASED');await h.drain();assert.equal(h.calls(),0);
  const second=await h.service.createRun(alice,await h.request(alice,0,'second-submission'));await h.service.processBatch(h.tasks.shift()!);const cancelled=await h.service.cancel(alice,second.id);assert.equal(cancelled.accounting,'FINALISED');const calls=h.calls();await h.drain();assert.equal(h.calls(),calls);assert.equal((await h.service.entitlement(alice)).remainingRuns,1);
  await h.service.discard(alice,second.id);await assert.rejects(h.service.run(alice,second.id),code('RUN_EXPIRED'));assert.equal((await h.service.entitlement(alice)).remainingRuns,1);assert.equal((await h.blobs.list(`runs/${second.id}/`)).length,0);
});
test('bounded provider retries leave explicit errors and one finalised allowance',async()=>{
  let calls=0;const h=await setup({route:{id:'synthetic',version:'test',maxBatchSize:100,route:async()=>{calls++;throw new Error('timeout');}}});
  const run=await h.service.createRun(alice,await h.request());await h.drain();const done=await h.service.run(alice,run.id);
  assert.equal(calls,3);assert.equal(done.state,'FAILED');assert.equal(done.counts.completed,24);assert.equal(done.accounting,'FINALISED');assert.equal(done.externalRequests,3);assert.ok(done.counts.failed>0);
});
test('A18/A19 popular browse and exact suggestion aggregation do not start custom work',async()=>{
  const h=await setup();await h.service.maintainPopular();const calls=h.calls(),profiles=await h.service.popularProfiles();assert.equal(profiles.length,12);
  await h.service.popularDataset(profiles[0].id);assert.equal(h.calls(),calls);
  const a=await h.request(alice),b=await h.request(bob),west=await h.request(alice,1);const first=await h.service.suggest(alice,{destinationSelectionId:a.destinationSelectionId});
  assert.equal((await h.service.suggest(alice,{destinationSelectionId:a.destinationSelectionId})).distinctRequests,1);assert.equal((await h.service.suggest(bob,{destinationSelectionId:b.destinationSelectionId})).distinctRequests,2);assert.notEqual((await h.service.suggest(alice,{destinationSelectionId:west.destinationSelectionId})).id,first.id);
  assert.equal(h.tasks.length,0);assert.equal((await h.service.entitlement(alice)).remainingRuns,2);
});
test('A31 admin operations require role and reason and remain audited',async()=>{
  const h=await setup();await assert.rejects(h.service.setKillSwitch(alice,true,'stop'),code('ADMIN_REQUIRED'));await assert.rejects(h.service.setKillSwitch(admin,true,''),code('REASON_REQUIRED'));
  await h.service.setKillSwitch(admin,true,'investigating spending');assert.equal((await h.service.capabilities()).features.customRuns,false);await assert.rejects(h.service.createRun(alice,await h.request()),code('SPENDING_STOPPED'));
  await h.service.setKillSwitch(admin,false,'spending issue resolved');await h.service.adminAction(admin,{action:'ENTITLEMENT_POLICY',targetId:'demo-alice',value:{dailyRuns:3,dailyDestinations:2,status:'ACTIVE'},reason:'demo configuration test'});assert.equal((await h.service.entitlement(alice)).remainingRuns,3);assert.equal((await h.service.admin(admin)).audit.length,3);
});
test('source outbound URLs are allowlisted and receive no private route data',async()=>{
  const h=await setup();assert.deepEqual(await h.service.outbound('demo-1'),{url:'https://example.com/rentals/1'});
  await h.repo.transaction(async tx=>{const listing=await tx.get<ListingVersion>('listings','demo-1');assert.ok(listing);listing.sourceUrl='https://attacker.example/path';tx.put('listings','demo-1',listing);});await assert.rejects(h.service.outbound('demo-1'),code('INVALID_SOURCE_LINK'));
});
test('A30 HTTP protects owners/admin/jobs, uses no-store and never returns SPA HTML for APIs',async()=>{
  const h=await setup(),server=createApiServer(h.service);server.listen(0,'127.0.0.1');await once(server,'listening');const address=server.address();assert.ok(address&&typeof address==='object');const base=`http://127.0.0.1:${address.port}`;
  try{
    const noAuth=await fetch(`${base}/api/v1/me/entitlement`);assert.equal(noAuth.status,401);assert.equal(noAuth.headers.get('cache-control'),'private, no-store');assert.ok((await noAuth.json()).error.correlationId);
    const job=await fetch(`${base}/internal/batches`,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});assert.equal(job.status,404);
    const login=await fetch(`${base}/api/v1/auth/login`,{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify({email:'alice@keywise.test',password:'Keywise-Demo-2026!'})});assert.equal(login.status,200);
    const cookie=login.headers.get('set-cookie')!.split(';')[0]!;
    const adminResponse=await fetch(`${base}/api/v1/admin`,{headers:{Cookie:cookie}});assert.equal(adminResponse.status,403);
    const unknown=await fetch(`${base}/api/v1/missing`,{headers:{Cookie:cookie}});assert.equal(unknown.status,404);assert.match(unknown.headers.get('content-type')??'',/application\/json/);
    const fakeUid=await fetch(`${base}/api/v1/me/entitlement`,{headers:{'x-user-id':'alice'}});assert.equal(fakeUid.status,401);
  }finally{server.close();await once(server,'close');}
});
test('live API fails closed on direct-origin requests and disabled features',async()=>{
  const providers=createProviders('demo'),service=new CommuteService({mode:'live',repo:new MemoryRepository(),blobs:new MemoryBlobStore(),...providers,queue:{enqueue:async()=>{}}});
  assert.equal((await service.capabilities()).features.customRuns,false);await assert.rejects(service.verify(alice,'evidence'),code('VERIFICATION_GATED'));
  const server=createApiServer(service,{originSecret:'test-secret'});server.listen(0,'127.0.0.1');await once(server,'listening');const address=server.address();assert.ok(address&&typeof address==='object');const base=`http://127.0.0.1:${address.port}`;
  try{assert.equal((await fetch(`${base}/api/v1/capabilities`)).status,403);const response=await fetch(`${base}/api/v1/capabilities`,{headers:{'x-edge-secret':'test-secret'}});assert.equal(response.status,200);assert.equal((await response.json()).mode,'live');}finally{server.close();await once(server,'close');}
});
test('local transactional storage survives reopen and rolls back failed updates',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'commute-storage-test-'));
  try{const repo=new FileRepository(dir);await repo.transaction(async tx=>tx.put('counts','one',{n:0}));await Promise.all(Array.from({length:12},()=>repo.transaction(async tx=>{const value=await tx.get<{n:number}>('counts','one');tx.put('counts','one',{n:value!.n+1});})));
    await assert.rejects(repo.transaction(async tx=>{tx.put('counts','one',{n:999});throw new Error('rollback');}));assert.equal((await new FileRepository(dir).get<{n:number}>('counts','one'))?.n,12);
    const blobs=new FileBlobStore(join(dir,'payloads'));await blobs.put('runs/a/data.json',{hello:'world'});assert.deepEqual(await blobs.get('runs/a/data.json'),{hello:'world'});await assert.rejects(blobs.put('../escape.json',{}));
  }finally{await rm(dir,{recursive:true,force:true});}
});
test('approved live popular plans use the configured market and point, with separate rights and no portable export',async()=>{
  const providers=createProviders('demo'),repo=new MemoryRepository(),blobs=new MemoryBlobStore();let calls=0;
  const destination={...demoDestinations[0],id:'approved-entrance',label:'Approved test entrance'};
  const definition:RouteDefinition={destination,direction:'HOME_TO_DESTINATION',mode:'TRANSIT',transitPreference:'DEFAULT',preferredTransitModes:[],timeBasis:{kind:'ARRIVAL',at:'2026-10-06T08:30:00+02:00',timezone:'Europe/Zurich'},provider:'google',adapterVersion:'test-google-adapter'};
  const policy={approvalReference:'test-only-approved-policy',approvedAt:'2026-01-01T00:00:00Z',expiresAt:'2099-01-01T00:00:00Z',markets:[{id:'approved-market',label:'Test market',coverage:'Only explicitly supplied test inventory.'}],retentionHours:1,maxCandidates:100,allowCustomRuns:true,allowPopular:true,allowExport:false as const,popularApprovalReference:'separate-test-popular-permission',popularPlans:[{id:'configured-profile',name:'Configured test profile',definition,marketId:'approved-market',refreshPolicy:'Explicit test refresh policy'}],accountingPolicy:'RESERVE_THEN_FINALISE_ON_EXTERNAL_WORK' as const,precisionPolicy:'EXCLUDE_APPROXIMATE' as const,timePolicy:'EXPLICIT_INSTANT' as const};
  const route:RouteProvider={id:'google',version:'test-google-adapter',maxBatchSize:100,async route(listings,def){calls++;assert.equal(def.destination.id,'approved-entrance');return listings.map(l=>({listingId:l.id,listingVersion:l.version,state:'SUCCESS',durationSeconds:100,provider:'google',calculatedAt:new Date().toISOString(),warnings:[]}));}};
  await repo.transaction(async tx=>{tx.put('sources','approved-source',{...providers.listings[0].source,id:'approved-source',synthetic:false,marketId:'approved-market'});for(const listing of demoListings)tx.put('listings',listing.id,{...listing,sourceId:'approved-source',marketId:'approved-market'});});
  const service=new CommuteService({mode:'live',repo,blobs,route,location:providers.location,listings:[],queue:{enqueue:async()=>{}},livePolicy:policy});
  await service.maintainPopular();const profiles=await service.popularProfiles();assert.equal(profiles.length,1);assert.equal(profiles[0].id,'configured-profile');const dataset=await service.popularDataset(profiles[0].id);assert.equal(dataset.synthetic,false);assert.equal(dataset.exportAllowed,false);assert.equal(dataset.counts.total,24);assert.equal(calls,1);
  policy.allowPopular=false;await assert.rejects(service.maintainPopular(),code('POPULAR_GATED'));
});
