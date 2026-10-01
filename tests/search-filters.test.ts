import test from 'node:test';
import assert from 'node:assert/strict';
import type { Dataset, RouteRow, ViewState } from '../shared/contracts.ts';
import { demoDestinations, demoListings } from '../shared/fixtures.ts';
import { applicableViewForDataset, filterDataset } from '../shared/view.ts';
import { FILTER_LIMITS, FILTER_OPTIONS, validateViewState } from '../shared/search-filters.ts';
import { listingSchema } from '../shared/validation.ts';
import { exportSnapshot, importSnapshot } from '../shared/portable.ts';

const all:ViewState={sort:'COMMUTE_ASC',includeUnavailable:true};
function dataset():Dataset{
  const listings=structuredClone(demoListings.slice(1,5));
  listings[0].locality='Renens';listings[1].locality='Lausanne';listings[2].locality=undefined;listings[2].rent.amount=null;
  const at='2026-10-01T06:00:00Z';
  const details:Partial<RouteRow>[]=[{durationSeconds:600,walkingSeconds:0,transfers:0,transitModes:['BUS']},{durationSeconds:1800,walkingSeconds:600,transfers:1,transitModes:['BUS','SUBWAY']},{durationSeconds:2400},{}];
  const rows:RouteRow[]=listings.map((listing,index)=>({listingId:listing.id,listingVersion:listing.version,state:index===3?'NO_ROUTE':'SUCCESS',...details[index],provider:'synthetic',warnings:[],calculatedAt:at}));
  return {id:'local-filter-fixture',definition:{destination:demoDestinations[0],direction:'HOME_TO_DESTINATION',mode:'TRANSIT',transitPreference:'DEFAULT',preferredTransitModes:[],timeBasis:{kind:'ARRIVAL',at:'2026-10-06T08:30:00+02:00',timezone:'Europe/Zurich'},provider:'synthetic',adapterVersion:'test'},marketId:'ch-vaud-demo',coverage:'Four explicit fixture records',universeVersion:'v3',createdAt:at,calculatedAt:at,state:'COMPLETE',counts:{total:4,completed:4,success:3,noRoute:1,unresolved:0,failed:0},listings,rows,synthetic:true,exportAllowed:true,attribution:['Explicitly simulated test journeys.']};
}

test('view controls reject unsupported codes, unbounded numbers and inverted ranges before filtering',()=>{
  for(const change of [{minRent:-1},{maxRent:FILTER_LIMITS.rent+1},{maxRent:Infinity},{maxArea:10001},{minRooms:2.25},{minBedrooms:1.5},{maxBathrooms:2.5},{maxCommuteMinutes:10.5},{maxWalkingMinutes:0.5},{maxTransfers:1.5},{propertyType:'FREE_TEXT'},{furnishing:'ANY'},{facilities:{pool:'PRIVATE'}},{facilities:{kitchen:'YES'}},{transitModes:['PLANE']},{transitModes:['BUS','BUS']},{locality:'<b>Renens</b>'},{bounds:{north:0,south:1,west:0,east:1}},{minRent:1000,maxRent:900},{minArea:100,maxArea:50}])assert.throws(()=>validateViewState({...all,...change}));
  assert.equal(validateViewState({...all,minRooms:2.5,maxBedrooms:20,maxRent:100000}).minRooms,2.5);
  assert.deepEqual(validateViewState({...all,transitModes:[]}).transitModes,[]);
  for(const option of FILTER_OPTIONS.propertyTypes)assert.doesNotThrow(()=>validateViewState({...all,propertyType:option.value}));
});

test('local property and named-area ranges require known normalized facts without inferring areas from labels',()=>{
  const data=dataset(),before=JSON.stringify(data);
  data.listings[2].location.label='Renens fictional property location';
  assert.deepEqual(filterDataset(data,{...all,locality:'renens'}).map(result=>result.listing.id),['demo-2']);
  assert.deepEqual(filterDataset(data,{...all,minRent:750,maxRent:900}).map(result=>result.listing.id),['demo-3']);
  assert.deepEqual(filterDataset(data,{...all,minRooms:2.5,maxRooms:2.5,minBedrooms:2,maxBedrooms:2}).map(result=>result.listing.id),['demo-2','demo-3']);
  data.listings[1].floorArea=null;data.listings[1].bathrooms=null;
  assert.ok(!filterDataset(data,{...all,minArea:0,maxArea:100}).some(result=>result.listing.id==='demo-3'));
  assert.ok(!filterDataset(data,{...all,minBathrooms:0,maxBathrooms:2}).some(result=>result.listing.id==='demo-3'));
  const stable=JSON.stringify(data);filterDataset(data,{...all,sort:'RENT_DESC'});assert.equal(JSON.stringify(data),stable);
  assert.notEqual(before,stable,'Only deliberate fixture changes were made.');
  const incompatible=structuredClone(data) as any;incompatible.listings[0].rent.period='WEEK';assert.throws(()=>filterDataset(incompatible,all),/CHF per month/);
});

test('hard transit filters use measured legs and never treat absent metrics or no-route as zero',()=>{
  const data=dataset();
  assert.deepEqual(filterDataset(data,{...all,maxWalkingMinutes:0}).map(result=>result.listing.id),['demo-2']);
  assert.deepEqual(filterDataset(data,{...all,maxTransfers:0}).map(result=>result.listing.id),['demo-2']);
  assert.deepEqual(filterDataset(data,{...all,transitModes:['BUS']}).map(result=>result.listing.id),['demo-2']);
  assert.deepEqual(filterDataset(data,{...all,transitModes:['BUS','SUBWAY']}).map(result=>result.listing.id),['demo-2','demo-3']);
  assert.equal(filterDataset(data,{...all,transitModes:[]}).length,0);
  assert.equal(filterDataset(data,{...all,maxCommuteMinutes:30}).length,2);
  assert.throws(()=>filterDataset(data,{...all,sort:'WALKING_ASC'}),/known walking time/);
  assert.deepEqual(filterDataset(data,{...all,maxWalkingMinutes:10,sort:'WALKING_DESC'}).map(result=>result.listing.id),['demo-3','demo-2']);
  const walking={...data,definition:{...data.definition,mode:'WALK' as const}};
  for(const change of [{maxWalkingMinutes:10},{maxTransfers:0},{transitModes:['BUS'] as const},{sort:'WALKING_ASC'}])assert.throws(()=>filterDataset(walking,{...all,...change} as ViewState),/public transport/);
});

test('changing prepared datasets retains housing choices and clears only unsupported measured transit controls',()=>{
  const data=dataset();
  const view:ViewState={...all,minRent:900,maxRent:2000,minBedrooms:2,facilities:{washingMachine:'PRIVATE'},locality:'Renens',maxCommuteMinutes:30,maxWalkingMinutes:5,maxTransfers:0,transitModes:[],sort:'WALKING_ASC',selectedId:'not-in-this-dataset'};
  const before=JSON.stringify(view),housing={minRent:900,maxRent:2000,minBedrooms:2,facilities:{washingMachine:'PRIVATE'},locality:'Renens',maxCommuteMinutes:30};
  const partial=applicableViewForDataset(view,data);
  assert.equal(partial.maxWalkingMinutes,5);assert.equal(partial.maxTransfers,0);assert.deepEqual(partial.transitModes,[]);
  assert.equal(partial.sort,'COMMUTE_ASC','Mixed availability cannot establish walking order.');assert.equal(partial.selectedId,undefined);
  const unmeasured=structuredClone(data);for(const row of unmeasured.rows){delete row.walkingSeconds;delete row.transfers;delete row.transitModes;}
  const applicable=applicableViewForDataset(view,unmeasured);
  for(const [key,value] of Object.entries(housing))assert.deepEqual(applicable[key as keyof ViewState],value);
  assert.equal(applicable.maxWalkingMinutes,undefined);assert.equal(applicable.maxTransfers,undefined);assert.equal(applicable.transitModes,undefined);assert.equal(applicable.sort,'COMMUTE_ASC');
  const walking={...data,definition:{...data.definition,mode:'WALK' as const}};
  assert.deepEqual(applicableViewForDataset(view,walking),applicable);
  const singleMissing=structuredClone(data);for(const row of singleMissing.rows)delete row.transfers;
  assert.equal(applicableViewForDataset(view,singleMissing).maxTransfers,undefined);assert.equal(applicableViewForDataset(view,singleMissing).maxWalkingMinutes,5);
  assert.equal(JSON.stringify(view),before,'Adapting a view never mutates the existing choices.');
});

test('feed and snapshot validation agree on market units, counts, property codes and housing bounds',()=>{
  const data=dataset();
  const mutations=[
    (listing:any)=>{listing.rent.currency='EUR';},(listing:any)=>{listing.rent.period='WEEK';},(listing:any)=>{listing.rent.amount=100001;},(listing:any)=>{listing.rent.charges=100001;},
    (listing:any)=>{listing.floorArea=10001;},(listing:any)=>{listing.rooms=40.5;},(listing:any)=>{listing.rooms=2.25;},(listing:any)=>{listing.bedrooms=2.5;},(listing:any)=>{listing.bathrooms=1.5;},
    (listing:any)=>{listing.bedrooms=21;},(listing:any)=>{listing.propertyType='BUNGALOW_FREE_TEXT';},
  ];
  for(const mutate of mutations){const value=structuredClone(data.listings[0]);mutate(value);assert.equal(listingSchema.safeParse(value).success,false);const envelope=JSON.parse(exportSnapshot(data));mutate(envelope.dataset.listings[0]);assert.throws(()=>importSnapshot(JSON.stringify(envelope)));}
  for(const listing of demoListings)assert.ok(listingSchema.safeParse(listing).success);
  assert.deepEqual(importSnapshot(exportSnapshot(data)).rows,data.rows,'Simulated transit metrics survive read-only reopening.');
  for(const mutate of [(row:any)=>{row.transitModes=['PLANE'];},(row:any)=>{row.transitModes=['BUS','BUS'];},(row:any)=>{row.transfers=0.5;}]){const envelope=JSON.parse(exportSnapshot(data));mutate(envelope.dataset.rows[0]);assert.throws(()=>importSnapshot(JSON.stringify(envelope)));}
  const envelope=JSON.parse(exportSnapshot(data));envelope.dataset.rows[3].transitModes=['BUS'];assert.throws(()=>importSnapshot(JSON.stringify(envelope)));
});

test('demo housing fixtures exercise every type, furnishing and facility value',()=>{
  assert.deepEqual(new Set(demoListings.map(listing=>listing.propertyType)),new Set(FILTER_OPTIONS.propertyTypes.map(option=>option.value)));
  assert.deepEqual(new Set(demoListings.map(listing=>listing.furnishing)),new Set(FILTER_OPTIONS.furnishing.map(option=>option.value)));
  for(const key of ['washingMachine','dryer','kitchen','dishwasher','airConditioning','balcony','parking'] as const)assert.deepEqual(new Set(demoListings.map(listing=>listing.facilities[key])),new Set(FILTER_OPTIONS.facilities.map(option=>option.value)));
});
