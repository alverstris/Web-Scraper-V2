import test from 'node:test';
import assert from 'node:assert/strict';
import type { ListingVersion, RouteDefinition, RouteProvider } from '../shared/contracts.ts';
import { DEMO_ROUTE_VERSION, demoDestinations } from '../shared/fixtures.ts';
import { SyntheticRouteProvider, SyntheticLocationResolver, SyntheticListingProvider } from '../server/providers/synthetic.ts';
import { CommuteService } from '../server/service.ts';
import { MemoryRepository, MemoryBlobStore } from '../server/storage.ts';
import type { TaskPayload } from '../server/queue.ts';

function legacySeconds(listing:ListingVersion,definition:RouteDefinition){
  const a=listing.location.point!,b=definition.destination.point!;
  const meters=Math.round(Math.hypot((a.lat-b.lat)*111000,(a.lng-b.lng)*76000)*1.25);
  const speed={WALK:1.3,BICYCLE:4.5,DRIVE:9,TRANSIT:6}[definition.mode];
  const preference=definition.transitPreference==='FEWER_TRANSFERS'?90:definition.transitPreference==='LESS_WALKING'?60:0;
  return Math.max(60,Math.round(meters/speed)+(definition.mode==='TRANSIT'?420:0)+preference);
}

for(const version of ['synthetic-v1','synthetic-v2'])test(`pending ${version} runs keep their frozen simulation after startup upgrade`,async()=>{
  const repo=new MemoryRepository(),blobs=new MemoryBlobStore(),queued:TaskPayload[]=[],currentProvider=new SyntheticRouteProvider();
  const legacyProvider:RouteProvider={id:'synthetic',version,maxBatchSize:6,route:(listings,definition)=>currentProvider.route(listings,definition)};
  function service(route:RouteProvider){return new CommuteService({mode:'demo',repo,blobs,route,location:new SyntheticLocationResolver(),listings:[new SyntheticListingProvider()],queue:{enqueue:async task=>{queued.push(task);}}});}
  const old=service(legacyProvider),actor={uid:'alice',admin:false};await old.initialise(false);
  await old.searchLocations(actor,'EPFL');const selection=await old.confirmLocation(actor,'epfl-east');
  const run=await old.createRun(actor,{idempotencyKey:`legacy-${version}-run`,destinationSelectionId:selection.selectionId,marketId:'ch-vaud-demo',searchScope:'STANDARD',routeDefinition:{direction:'HOME_TO_DESTINATION',mode:'TRANSIT',transitPreference:'DEFAULT',preferredTransitModes:[],timeBasis:{kind:'ARRIVAL',at:'2026-10-06T08:30:00+02:00',timezone:'Europe/Zurich'}}});
  await old.processBatch(queued.shift()!);const originalRows=(await old.results(actor,run.id)).rows;
  await repo.transaction(async tx=>tx.put('config','seeded',{id:'seeded',at:'2026-09-01T00:00:00Z',fixtureVersion:'fixture-v2'}));
  const upgraded=service(currentProvider);await upgraded.initialise();while(queued.length)await upgraded.processBatch(queued.shift()!);
  const data=await upgraded.results(actor,run.id);assert.equal(data.state,'COMPLETE');assert.equal(data.definition.adapterVersion,version);
  assert.deepEqual(data.rows.slice(0,originalRows.length),originalRows,'Already calculated chunks are never rewritten.');
  assert.equal((await upgraded.entitlement(actor)).remainingRuns,1);
  for(const row of data.rows.filter(row=>row.state==='SUCCESS')){
    const listing=data.listings.find(item=>item.id===row.listingId)!;
    if(version==='synthetic-v1'){
      assert.equal(row.durationSeconds,legacySeconds(listing,data.definition));assert.equal(row.walkingSeconds,undefined);assert.equal(row.transfers,undefined);assert.equal(row.transitModes,undefined);
      assert.equal(row.warnings[0],'Synthetic test journey; not travel advice.');
    }else{
      const index=Number(listing.sourceListingId)-1,duration=300+((index*7+1)%23)*150;
      assert.equal(row.durationSeconds,duration);assert.equal(row.walkingSeconds,Math.min(duration,(2+(index*3)%17)*60));assert.equal(row.transfers,index%4);
    }
  }
  assert.ok((await upgraded.popularProfiles()).every(profile=>profile.definition.adapterVersion===DEMO_ROUTE_VERSION),'New prepared profiles use the current adapter.');
});

test('legacy direct routing retains every supported mode and transit preference formula',async()=>{
  const provider=new SyntheticRouteProvider(),listing=(await new SyntheticListingProvider().fetch()).records[1];
  for(const mode of ['WALK','BICYCLE','DRIVE','TRANSIT'] as const)for(const transitPreference of mode==='TRANSIT'?['DEFAULT','LESS_WALKING','FEWER_TRANSFERS'] as const:['DEFAULT'] as const){
    const definition:RouteDefinition={destination:demoDestinations[0],direction:'HOME_TO_DESTINATION',mode,transitPreference,preferredTransitModes:[],timeBasis:{kind:mode==='TRANSIT'?'ARRIVAL':'DEPARTURE',at:'2026-10-06T08:00:00+02:00',timezone:'Europe/Zurich'},provider:'synthetic',adapterVersion:'synthetic-v1'};
    const row=(await provider.route([listing],definition))[0];assert.equal(row.durationSeconds,legacySeconds(listing,definition));assert.equal(row.walkingSeconds,undefined);
  }
});
