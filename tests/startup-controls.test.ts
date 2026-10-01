import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { ListingVersion, PopularProfile, RouteDefinition, RouteProvider } from '../shared/contracts.ts';
import { DEMO_FIXTURE_VERSION, DEMO_ROUTE_VERSION } from '../shared/fixtures.ts';
import { createProviders } from '../server/providers/index.ts';
import { CommuteService } from '../server/service.ts';
import { createApiServer } from '../server/http.ts';
import { MemoryRepository, MemoryBlobStore } from '../server/storage.ts';

for(const control of ['spending-stop','disabled-source'])test(`startup migration preserves ${control} while keeping staff API and published snapshots available`,async()=>{
  const providers=createProviders('demo'),repo=new MemoryRepository(),blobs=new MemoryBlobStore(),admin={uid:'admin',admin:true};
  let routeCalls=0;
  function route(version:string):RouteProvider{return {id:'synthetic',version,maxBatchSize:6,async route(listings:ListingVersion[],definition:RouteDefinition){routeCalls++;return providers.route.route(listings,definition);}};}
  function service(adapter:RouteProvider){return new CommuteService({mode:'demo',repo,blobs,...providers,route:adapter,queue:{enqueue:async()=>{}}});}
  const old=service(route('synthetic-v1'));await old.initialise();
  await repo.transaction(async tx=>{
    tx.put('config','seeded',{id:'seeded',at:'2026-09-01T00:00:00Z',fixtureVersion:'fixture-v2'});
    for(const profile of await tx.query<PopularProfile>('popularProfiles'))if(profile.definition.mode!=='TRANSIT')tx.delete('popularProfiles',profile.id);
  });
  if(control==='spending-stop')await old.setKillSwitch(admin,true,'Retain the operator spending stop across upgrades');
  else await old.adminAction(admin,{action:'SOURCE_ENABLED',targetId:'synthetic-rentals',value:false,reason:'Retain the operator source pause across upgrades'});
  const frozen=await old.popularDataset('epfl-east-transit'),preparedCalls=routeCalls;
  const reopened=service(route(DEMO_ROUTE_VERSION));await reopened.initialise();
  assert.equal(routeCalls,preparedCalls,'Startup must not bypass the saved spending/source control.');
  assert.equal((await repo.get<any>('config','seeded')).fixtureVersion,DEMO_FIXTURE_VERSION);
  assert.deepEqual(await reopened.popularDataset('epfl-east-transit'),frozen);
  assert.equal((await reopened.popularProfiles()).length,3);
  if(control==='spending-stop')assert.equal((await reopened.admin(admin)).killSwitch.enabled,true);
  else assert.equal((await reopened.admin(admin)).sources.find(source=>source.id==='synthetic-rentals')?.enabled,false);
  await assert.rejects(reopened.maintainPopular(),(error:any)=>error.code===(control==='spending-stop'?'SPENDING_STOPPED':'CAPACITY_EXCEEDED'));
  assert.equal(routeCalls,preparedCalls,'Explicit maintenance still fails closed while the control is active.');

  const server=createApiServer(reopened);server.listen(0,'127.0.0.1');await once(server,'listening');
  const address=server.address();assert.ok(address&&typeof address==='object');const origin=`http://127.0.0.1:${address.port}`;
  try{
    assert.equal((await fetch(`${origin}/health`)).status,200);
    const login=await fetch(`${origin}/api/v1/auth/staff-login`,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({email:'admin@keywise.test',password:'Keywise-Staff-2026!'})});
    assert.equal(login.status,200);const session=await login.json(),cookie=login.headers.get('set-cookie')!.split(';')[0]!;
    assert.equal((await fetch(`${origin}/api/v1/admin`,{headers:{Cookie:cookie}})).status,200);
    const endpoint=control==='spending-stop'?'kill-switch':'actions';
    const body=control==='spending-stop'?{enabled:false,reason:'Operator restores routing after review'}:{action:'SOURCE_ENABLED',targetId:'synthetic-rentals',value:true,reason:'Operator restores the synthetic source after review'};
    const restore=await fetch(`${origin}/api/v1/admin/${endpoint}`,{method:'POST',headers:{Cookie:cookie,Origin:origin,'X-CSRF-Token':session.csrfToken,'Content-Type':'application/json'},body:JSON.stringify(body)});
    assert.equal(restore.status,200);
    await reopened.maintainPopular();assert.equal((await reopened.popularProfiles()).length,12);
    assert.ok((await reopened.popularProfiles()).every(profile=>profile.definition.adapterVersion===DEMO_ROUTE_VERSION));
    assert.ok(routeCalls>preparedCalls);
  }finally{server.close();await once(server,'close');}
});
