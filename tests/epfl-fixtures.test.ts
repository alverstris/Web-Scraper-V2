import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { ListingVersion, RouteDefinition } from '../shared/contracts.ts';
import { filterDataset } from '../shared/view.ts';
import { DEMO_FIXTURE_VERSION, demoListings } from '../shared/fixtures.ts';
import { createProviders } from '../server/providers/index.ts';
import { CommuteService } from '../server/service.ts';
import { FileBlobStore, FileRepository } from '../server/storage.ts';

test('EPFL profiles and full fixture datasets survive restart and filter without rerouting',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'keywise-epfl-fixtures-'));
  const now=new Date();
  let routingCalls=0;
  function service() {
    const providers=createProviders('demo');
    const route={...providers.route,id:providers.route.id,version:providers.route.version,maxBatchSize:providers.route.maxBatchSize,
      async route(listings:ListingVersion[],definition:RouteDefinition){routingCalls++;return providers.route.route(listings,definition);}};
    return new CommuteService({mode:'demo',repo:new FileRepository(directory),blobs:new FileBlobStore(join(directory,'blobs')),
      ...providers,route,queue:{enqueue:async()=>{}},clock:()=>now});
  }
  try {
    const first=service();await first.initialise();
    const profiles=await first.popularProfiles();
    assert.equal(profiles[0].id,'epfl-east-transit');
    assert.equal(profiles.length,12);
    assert.deepEqual(profiles.slice(0,3).map(profile=>profile.definition.destination.id),['epfl-east','epfl-west','unil-dorigny']);
    for(const destination of ['epfl-east','epfl-west','unil-dorigny'])assert.deepEqual(new Set(profiles.filter(profile=>profile.destination.id===destination).map(profile=>profile.definition.mode)),new Set(['TRANSIT','WALK','BICYCLE','DRIVE']));
    const east=await first.popularDataset('epfl-east-transit');
    const west=await first.popularDataset('epfl-west-transit');
    assert.equal(east.state,'COMPLETE');assert.equal(east.synthetic,true);assert.equal(east.listings.length,24);assert.equal(east.rows.length,24);
    assert.notDeepEqual(east.definition.destination.point,west.definition.destination.point);
    assert.equal(east.definition.timeBasis.kind,'ARRIVAL');
    assert.equal(east.definition.timeBasis.timezone,'Europe/Zurich');
    const successes=east.rows.filter(row=>row.state==='SUCCESS');
    assert.ok(successes.some(row=>row.durationSeconds!<=10*60));assert.ok(successes.some(row=>row.durationSeconds!>=50*60));
    assert.ok(successes.every(row=>row.walkingSeconds!==undefined&&row.transfers!==undefined&&row.transitModes?.length));
    const walk=await first.popularDataset('epfl-east-walk'),bicycle=await first.popularDataset('epfl-east-bicycle'),drive=await first.popularDataset('epfl-east-drive');
    for(const dataset of [walk,bicycle,drive]){
      assert.equal(dataset.definition.timeBasis.kind,'DEPARTURE');assert.equal(dataset.definition.preferredTransitModes.length,0);
      assert.ok(dataset.rows.every(row=>row.walkingSeconds===undefined&&row.transfers===undefined&&row.transitModes===undefined));
    }
    assert.notEqual(walk.rows.find(row=>row.state==='SUCCESS')?.durationSeconds,bicycle.rows.find(row=>row.state==='SUCCESS')?.durationSeconds);
    const callsAfterPreparation=routingCalls;assert.ok(callsAfterPreparation>0);

    const restarted=service();await restarted.initialise();
    const reopened=await restarted.popularDataset('epfl-east-transit');
    assert.deepEqual(reopened,east);assert.equal(routingCalls,callsAfterPreparation);
    assert.equal((await restarted.repo.query<ListingVersion>('listings')).length,24);
    assert.equal(filterDataset(reopened,{sort:'COMMUTE_ASC',includeUnavailable:true,maxRent:900}).length,4);
    assert.equal(filterDataset(reopened,{sort:'COMMUTE_DESC',includeUnavailable:true,maxRent:900,minBedrooms:2}).length,2);
    assert.equal(routingCalls,callsAfterPreparation,'Loading and exploring a saved popular dataset makes no routing calls.');
    assert.equal((await restarted.entitlement({uid:'alice',admin:false})).remainingRuns,2);
  } finally {await rm(directory,{recursive:true,force:true});}
});

test('fixture migration refreshes prepared profiles while retaining private snapshots, allowance and explicit unpublication',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'keywise-fixture-migration-'));
  const providers=createProviders('demo'),repo=new FileRepository(directory),blobs=new FileBlobStore(join(directory,'blobs'));
  const service=()=>new CommuteService({mode:'demo',repo,blobs,...providers,queue:{enqueue:async()=>{}}});
  const alice={uid:'alice',admin:false},admin={uid:'admin',admin:true};
  try{
    const original=service();await original.initialise();
    await original.adminAction(admin,{action:'UNPUBLISH_PROFILE',targetId:'epfl-west-drive',reason:'Keep this profile unpublished'});
    await repo.transaction(async tx=>{
      tx.put('config','seeded',{id:'seeded',at:'2026-09-01T00:00:00Z',fixtureVersion:'fixture-v2'});
      for(const listing of demoListings){const old={...listing,version:'fixture-v2',title:`Old ${listing.title}`};delete old.locality;tx.put('listings',old.id,old);tx.put('listingVersions',`${old.id}__${old.version}`,old);}
      const source=await tx.get<any>('sources','synthetic-rentals');tx.put('sources',source.id,{...source,attribution:'Operator source attribution retained'});
    });
    await original.searchLocations(alice,'EPFL');const selection=await original.confirmLocation(alice,'epfl-east');
    const run=await original.createRun(alice,{idempotencyKey:'preserved-private-run',destinationSelectionId:selection.selectionId,marketId:'ch-vaud-demo',searchScope:'STANDARD',routeDefinition:{direction:'HOME_TO_DESTINATION',mode:'TRANSIT',transitPreference:'DEFAULT',preferredTransitModes:[],timeBasis:{kind:'ARRIVAL',at:'2026-10-06T08:30:00+02:00',timezone:'Europe/Zurich'}}});
    const frozen=await original.results(alice,run.id),allowance=await original.entitlement(alice);
    const restarted=service();await restarted.initialise();
    assert.equal((await repo.get<any>('config','seeded')).fixtureVersion,DEMO_FIXTURE_VERSION);
    assert.ok((await repo.query<ListingVersion>('listings')).every(listing=>listing.version===DEMO_FIXTURE_VERSION&&!!listing.locality));
    assert.deepEqual(await restarted.results(alice,run.id),frozen);assert.deepEqual(await restarted.entitlement(alice),allowance);
    assert.equal((await restarted.popularProfiles()).length,11);assert.ok(!(await restarted.popularProfiles()).some(profile=>profile.id==='epfl-west-drive'));
    assert.equal((await repo.get<any>('sources','synthetic-rentals')).attribution,'Operator source attribution retained');
    const refreshed=await restarted.popularDataset('epfl-east-transit');assert.ok(refreshed.listings.every(listing=>listing.version===DEMO_FIXTURE_VERSION));
  }finally{await rm(directory,{recursive:true,force:true});}
});
