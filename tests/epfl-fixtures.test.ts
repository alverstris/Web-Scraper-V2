import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { ListingVersion, RouteDefinition } from '../shared/contracts.ts';
import { filterDataset } from '../shared/view.ts';
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
    assert.deepEqual(profiles.map(profile=>profile.definition.destination.id),['epfl-east','epfl-west','unil-dorigny']);
    const east=await first.popularDataset('epfl-east-transit');
    const west=await first.popularDataset('epfl-west-transit');
    assert.equal(east.state,'COMPLETE');assert.equal(east.synthetic,true);assert.equal(east.listings.length,24);assert.equal(east.rows.length,24);
    assert.notDeepEqual(east.definition.destination.point,west.definition.destination.point);
    assert.equal(east.definition.timeBasis.kind,'ARRIVAL');
    assert.equal(east.definition.timeBasis.timezone,'Europe/Zurich');
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
