import {test} from 'node:test';
import assert from 'node:assert/strict';
import {demoListings,demoSources,demoDestinations} from '../shared/fixtures.ts';
import type {RouteDefinition,FeedResult} from '../shared/contracts.ts';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {GoogleRouteProvider,GoogleLocationResolver} from '../server/providers/google.ts';
import {AuthorizedJsonFeed,isPublicIPv4} from '../server/providers/authorized-feed.ts';
import {reconcileFeed,ingestSources} from '../server/ingestion.ts';
import {MemoryRepository} from '../server/storage.ts';
import {createProviders,providerConfigurationSchema} from '../server/providers/index.ts';
import {validateCreateRun,safeUrl,listingSchema} from '../shared/validation.ts';
const definition:RouteDefinition={destination:demoDestinations[0],direction:'HOME_TO_DESTINATION',mode:'TRANSIT',transitPreference:'LESS_WALKING',preferredTransitModes:['BUS'],timeBasis:{kind:'ARRIVAL',at:new Date(Date.now()+864e5).toISOString(),timezone:'Europe/Zurich'},provider:'google',adapterVersion:'v1'};
const rights={agreementReference:'Test fixture only',storageApproved:true,locationStorageApproved:true,expiresAt:'2099-01-01T00:00:00Z'};
test('administrator-disabled sources are not fetched or re-enabled by ingestion',async()=>{
 const repo=new MemoryRepository();await repo.transaction(async tx=>tx.put('sources',demoSources[0].id,{...demoSources[0],enabled:false}));
 let calls=0;const provider={source:demoSources[0],async fetch(){calls++;return {records:demoListings,complete:true,removedIds:[]}}};
 const result=await ingestSources(repo,[provider]);assert.equal(calls,0);assert.equal(result[0].reason,'SOURCE_DISABLED');
 assert.equal((await repo.get<any>('sources',demoSources[0].id)).enabled,false);
});
test('A11 incomplete feed preserves unseen active inventory; complete feed reconciles',()=>{
 const incomplete=reconcileFeed(demoListings,{records:[demoListings[0]],complete:false,removedIds:[]},demoSources[0],new Date().toISOString());assert.equal(incomplete.listings.filter(l=>l.active).length,24);
 const complete=reconcileFeed(demoListings,{records:[demoListings[0]],complete:true,removedIds:[]},demoSources[0],new Date().toISOString());assert.equal(complete.inactiveCount,23);
});
test('A12 unchanged source data avoids rewriting and preserves unknown bedrooms/shared laundry',()=>{
 const result=reconcileFeed(demoListings,{records:demoListings,complete:true,removedIds:[]},demoSources[0],new Date().toISOString());assert.equal(result.unchangedCount,24);assert.equal(result.listings[0].bedrooms,null);assert.equal(result.listings[0].facilities.washingMachine,'SHARED');assert.equal(result.listings[1].rooms,2.5);assert.equal(result.listings[1].bedrooms,2);
});
test('A11 malformed complete feed fails before inventory mutation',()=>{assert.throws(()=>reconcileFeed(demoListings,{records:[{...demoListings[0],sourceUrl:'https://evil.example/listing'}],complete:true,removedIds:[]},demoSources[0],new Date().toISOString()))});
test('A01 standard requests reject hidden filters',()=>{assert.throws(()=>validateCreateRun({idempotencyKey:'test-key-123',destinationSelectionId:'x',marketId:'ch-vaud-demo',searchScope:'STANDARD',maxRent:900,routeDefinition:{direction:definition.direction,mode:definition.mode,transitPreference:definition.transitPreference,preferredTransitModes:[],timeBasis:definition.timeBasis}}))});
test('A13/A14/A17 Google matrix maps explicit supported controls, indices and missing outcomes',async()=>{
 let body:any;
 const http=(async(_url:any,init:any)=>{body=JSON.parse(init.body);return new Response(JSON.stringify([{originIndex:1,destinationIndex:0,status:{},condition:'ROUTE_NOT_FOUND'},{originIndex:0,destinationIndex:0,status:{},condition:'ROUTE_EXISTS',duration:'120.5s',distanceMeters:1000,fallbackInfo:{}}]))}) as typeof fetch;
 const provider=new GoogleRouteProvider('test-only',rights,http);const rows=await provider.route(demoListings.slice(0,3),definition);
 assert.equal(rows[0].durationSeconds,120.5);assert.equal(rows[1].state,'NO_ROUTE');assert.equal(rows[2].state,'PROVIDER_ERROR');assert.equal(rows[0].transfers,undefined);assert.equal(rows[0].geometry,undefined);assert.equal(body.arrivalTime,definition.timeBasis.at);assert.equal(body.transitPreferences.routingPreference,'LESS_WALKING');assert.deepEqual(body.transitPreferences.allowedTravelModes,['BUS']);assert.ok(rows[0].warnings.some(x=>x.includes('fallback')));
});
test('A13 unsupported preferences and A31 missing rights fail before provider work',async()=>{
 let calls=0;const http=(async()=>{calls++;throw new Error('must not call')})as typeof fetch;
 await assert.rejects(new GoogleRouteProvider('test',rights,http).route(demoListings,{...definition,mode:'WALK'}));
 await assert.rejects(new GoogleRouteProvider('test',{...rights,storageApproved:false},http).route(demoListings,definition));assert.equal(calls,0);assert.throws(()=>createProviders('live'));
});
test('ingestion stores source health and retries unchanged without new versions',async()=>{const repo=new MemoryRepository();const providers=createProviders('demo');await ingestSources(repo,providers.listings);const first=await repo.query('listingVersions');await ingestSources(repo,providers.listings);assert.equal((await repo.query('listingVersions')).length,first.length);assert.equal((await repo.query('listings')).length,24)});

test('provider schema rejects private addresses, local names, parser tricks and unsafe IDs',()=>{
 for(const url of ['https://127.1/a','https://2130706433/a','https://10.1.2.3/a','https://169.254.169.254/metadata','https://[::1]/a','https://[::ffff:127.0.0.1]/a','https://service.local/a','https://localhost./a','https://user:password@example.com/a','https://example.com\\@localhost/a'])assert.equal(safeUrl.safeParse(url).success,false,url);
 assert.equal(safeUrl.safeParse('https://example.com/listing/1').success,true);
 for(const ip of ['127.0.0.1','10.1.0.1','169.254.169.254','192.168.0.1','172.16.1.1','100.64.0.1','0.0.0.0','224.1.1.1'])assert.equal(isPublicIPv4(ip),false);
 assert.equal(isPublicIPv4('8.8.8.8'),true);
 assert.equal(listingSchema.safeParse({...demoListings[0],id:'../injected'}).success,false);
 assert.equal(listingSchema.safeParse({...demoListings[0],active:false}).success,false);
});

test('feed permissions and source allowlist are enforced before remote calls',async()=>{
 let calls=0;const http=(async()=>{calls++;return new Response('{}')})as typeof fetch;
 await assert.rejects(new AuthorizedJsonFeed({...demoSources[0],canonicalHosts:['127.0.0.1']},'https://127.0.0.1/feed',undefined,http).fetch());
 await assert.rejects(new AuthorizedJsonFeed(demoSources[0],'https://unapproved.example/feed',undefined,http).fetch());
 await assert.rejects(new AuthorizedJsonFeed({...demoSources[0],permissions:{...demoSources[0].permissions,storage:false}},'https://example.com/feed',undefined,http).fetch());
 assert.equal(calls,0);
});

test('authorized JSON feed preserves completeness and rejects unknown envelope fields',async()=>{
 const response={records:[demoListings[0]],complete:false,removedIds:['2']};
 const feed=new AuthorizedJsonFeed(demoSources[0],'https://example.com/feed',undefined,(async()=>new Response(JSON.stringify(response)))as typeof fetch);
 assert.deepEqual(await feed.fetch(),response);
 const bad=new AuthorizedJsonFeed(demoSources[0],'https://example.com/feed',undefined,(async()=>new Response(JSON.stringify({...response,nextPage:'https://evil.example'})))as typeof fetch);
 await assert.rejects(bad.fetch());
});

test('stable source identifiers cannot collide and timestamp observations do not change content versions',async()=>{
 assert.throws(()=>reconcileFeed([],{records:[demoListings[0],{...demoListings[1],id:demoListings[0].id}],complete:true,removedIds:[]},demoSources[0],new Date().toISOString()));
 assert.throws(()=>reconcileFeed(demoListings,{records:[demoListings[0]],complete:true,removedIds:[demoListings[0].sourceListingId]},demoSources[0],new Date().toISOString()));
 const repo=new MemoryRepository();await ingestSources(repo,createProviders('demo').listings);
 const before=await repo.query('listingVersions');const current=await repo.get<{lastSeenAt:string}>('listingObservations','demo-1');
 assert.ok(current);assert.ok(Date.parse(current.lastSeenAt)>Date.parse(demoListings[0].lastSeenAt));
 await ingestSources(repo,createProviders('demo').listings);assert.deepEqual(await repo.query('listingVersions'),before);
});

test('invalid Google permission expiry is blocked without a request',async()=>{
 let calls=0;const http=(async()=>{calls++;throw new Error('No network expected')})as typeof fetch;
 await assert.rejects(new GoogleRouteProvider('test',{...rights,expiresAt:'not-a-date'},http).route(demoListings.slice(0,1),definition));assert.equal(calls,0);
});

test('malformed matrix values never become successful zero-duration winners',async()=>{
 const elements=[{originIndex:0,condition:'ROUTE_EXISTS',status:{code:'0'},duration:'60s'},{originIndex:1,condition:'ROUTE_EXISTS',status:{},duration:'9'.repeat(400)+'s'}];
 const provider=new GoogleRouteProvider('test',rights,(async()=>new Response(JSON.stringify(elements)))as typeof fetch);
 const rows=await provider.route(demoListings.slice(0,2),definition);assert.ok(rows.every(row=>row.state==='PROVIDER_ERROR'&&row.durationSeconds===undefined));
 const duplicate=new GoogleRouteProvider('test',rights,(async()=>new Response(JSON.stringify([{originIndex:0},{originIndex:0}])))as typeof fetch);
 await assert.rejects(duplicate.route(demoListings.slice(0,2),definition));
});

test('geocoding preserves approximate precision and refuses to invent a missing country',async()=>{
 const result={place_id:'candidate',formatted_address:'Lausanne, Switzerland',geometry:{location:{lat:46.5,lng:6.6},location_type:'APPROXIMATE'},address_components:[{types:['country'],short_name:'CH'}]};
 const resolver=new GoogleLocationResolver('test',rights,(async()=>new Response(JSON.stringify({status:'OK',results:[result]})))as typeof fetch);
 assert.equal((await resolver.search('Lausanne'))[0].precision,'LOCALITY');
 const missing=new GoogleLocationResolver('test',rights,(async()=>new Response(JSON.stringify({status:'OK',results:[{...result,address_components:[]}]})))as typeof fetch);
 await assert.rejects(missing.search('Lausanne'));
});

test('live provider configuration requires reviewed live sources and approved endpoint hosts',()=>{
 const config={schemaVersion:1,google:rights,feeds:[{source:{...demoSources[0],synthetic:false},endpoint:'https://example.com/feed'}]};
 assert.ok(providerConfigurationSchema.safeParse(config).success);
 assert.equal(providerConfigurationSchema.safeParse({...config,feeds:[]}).success,false);
 assert.equal(providerConfigurationSchema.safeParse({...config,feeds:[{source:demoSources[0],endpoint:'https://example.com/feed'}]}).success,false);
 assert.equal(providerConfigurationSchema.safeParse({...config,feeds:[{...config.feeds[0],endpoint:'https://evil.example/feed'}]}).success,false);
 assert.throws(()=>createProviders('live',{}));
});

test('reviewed operator config composes real adapters without making network calls',()=>{
 const directory=mkdtempSync(join(tmpdir(),'commute-provider-test-'));
 try{
  const path=join(directory,'providers.json');writeFileSync(path,JSON.stringify({schemaVersion:1,google:rights,feeds:[{source:{...demoSources[0],synthetic:false},endpoint:'https://example.com/feed',tokenEnvName:'FIXTURE_FEED_TOKEN'}]}));
  assert.throws(()=>createProviders('live',{PROVIDER_CONFIG_PATH:path,GOOGLE_MAPS_SERVER_KEY:'fixture'}));
  const providers=createProviders('live',{PROVIDER_CONFIG_PATH:path,GOOGLE_MAPS_SERVER_KEY:'fixture',FIXTURE_FEED_TOKEN:'fixture'});
  assert.ok(providers.route instanceof GoogleRouteProvider);assert.ok(providers.location instanceof GoogleLocationResolver);assert.ok(providers.listings[0] instanceof AuthorizedJsonFeed);
 }finally{rmSync(directory,{recursive:true,force:true})}
});

test('an old ingestion lease cannot overwrite the health of a replacement run',async()=>{
 const repository=new MemoryRepository();let entered!:()=>void,rejectFeed!:(error:Error)=>void;
 const started=new Promise<void>(resolve=>{entered=resolve});
 const task=ingestSources(repository,[{source:demoSources[0],fetch:()=>{entered();return new Promise<FeedResult>((_resolve,reject)=>{rejectFeed=reject})}}]);
 const rejected=assert.rejects(task);await started;
 await repository.transaction(async tx=>{tx.put('sourceLocks',demoSources[0].id,{id:demoSources[0].id,lease:'replacement',expiresAt:Date.now()+600000});tx.put('sourceHealth',demoSources[0].id,{id:demoSources[0].id,complete:true,marker:'newer-run'})});
 rejectFeed(new Error('Old request failed'));await rejected;
 assert.equal((await repository.get<{marker:string}>('sourceHealth',demoSources[0].id))?.marker,'newer-run');
 assert.equal((await repository.get<{lease:string}>('sourceLocks',demoSources[0].id))?.lease,'replacement');
});
