import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { activeFilterLabels, datasetStateMessage, emptyResultMessage, money, PropertyFilters, removeActiveFilter, ResultExplorer } from '../src/results.tsx';
import { dateLabel, DefinitionSummary } from '../src/ui.tsx';
import { demoDestinations, demoListings } from '../shared/fixtures.ts';
import { filterDataset } from '../shared/view.ts';
import type { Dataset, ViewState } from '../shared/contracts.ts';

const at='2026-09-30T12:00:00Z';
const all:ViewState={sort:'COMMUTE_ASC',includeUnavailable:true};
function fixture():Dataset {
  const listing=structuredClone(demoListings[0]);
  return {id:'results-flow',definition:{destination:structuredClone(demoDestinations[0]),direction:'HOME_TO_DESTINATION',mode:'TRANSIT',transitPreference:'DEFAULT',preferredTransitModes:['LIGHT_RAIL'],timeBasis:{kind:'ARRIVAL',at:'2026-10-06T08:00:00+02:00',timezone:'Europe/Zurich'},provider:'synthetic',adapterVersion:'synthetic-v1'},marketId:listing.marketId,coverage:'One synthetic property',universeVersion:'v1',createdAt:at,calculatedAt:at,state:'COMPLETE',counts:{total:1,completed:1,success:1,noRoute:0,unresolved:0,failed:0},listings:[listing],rows:[{listingId:listing.id,listingVersion:listing.version,state:'SUCCESS',durationSeconds:900,provider:'synthetic',warnings:[],calculatedAt:at}],synthetic:true,exportAllowed:true,attribution:['Synthetic test values.']};
}
function render(dataset:Dataset,{view=all,busy=false,imported=false,items=filterDataset(dataset,view)}:{view?:ViewState;busy?:boolean;imported?:boolean;items?:ReturnType<typeof filterDataset>}={}) {
  return renderToStaticMarkup(createElement(ResultExplorer,{dataset,items,view,setView:()=>{},busy,imported,onSource:()=>{},onSave:()=>{},onEditCommute:()=>{}}));
}

test('local worker loading and pending-only runs never claim filters found no matches',()=>{
  const dataset=fixture();
  const loading=render(dataset,{busy:true,items:[]});
  assert.match(loading,/Updating local view/);
  assert.doesNotMatch(loading,/No results match/);
  dataset.state='RUNNING';dataset.rows=[];dataset.counts={...dataset.counts,completed:0,success:0};
  const pending=render(dataset);
  assert.match(pending,/Properties will appear here as each batch finishes/);
  assert.doesNotMatch(pending,/No results match/);
  dataset.state='QUEUED';
  assert.match(emptyResultMessage(dataset,all,false),/queued/);
});

test('failed, cancelled and partial searches explain which results are usable',()=>{
  const dataset=fixture();
  dataset.state='FAILED';dataset.rows=[];
  assert.match(emptyResultMessage(dataset,all,false),/could not produce results/);
  assert.match(datasetStateMessage(dataset)!,/before the failure/);
  dataset.state='CANCELLED';
  assert.match(emptyResultMessage(dataset,all,false),/cancelled before results became available/);
  assert.match(datasetStateMessage(dataset)!,/remaining properties were not processed/);
  dataset.state='PARTIAL';
  assert.match(emptyResultMessage(dataset,all,false),/some properties processed/);
  assert.match(datasetStateMessage(dataset)!,/do not establish the fastest journey/);
});

test('empty available-only views distinguish missing journeys from zero-minute commutes',()=>{
  const dataset=fixture();
  dataset.rows[0]={...dataset.rows[0],state:'NO_ROUTE',durationSeconds:undefined};
  dataset.counts.success=0;dataset.counts.noRoute=1;
  assert.match(emptyResultMessage(dataset,{...all,includeUnavailable:false},false),/Turn on “Include rows without an available route”/);
  const output=render(dataset);
  assert.match(output,/No journey found/);
  assert.match(output,/does not mean a zero-minute commute/);
  assert.doesNotMatch(output,/0 min/);
});

test('active filters show useful labels, units and private/shared or unstated distinctions',()=>{
  assert.deepEqual(activeFilterLabels({...all,maxRent:900,minArea:30,maxCommuteMinutes:20,furnishing:'PARTIAL',facilities:{washingMachine:'SHARED',airConditioning:'UNKNOWN'},includeUnavailable:false,bounds:{north:2,south:1,east:2,west:1}}),[
    'Maximum commute: 20 min','Maximum rent: 900 CHF/month','Minimum floor area: 30 m²','Partly furnished','Washing machine: Shared','Air conditioning: Not stated','Geographic area','Available journeys only',
  ]);
  assert.deepEqual(activeFilterLabels({...all,maxRent:0}),['Maximum rent: 0 CHF/month']);
  assert.deepEqual(activeFilterLabels({...all,maxWalkingMinutes:10,maxTransfers:0,transitModes:['SUBWAY'],minRooms:1.5,maxRooms:3,minBedrooms:1,maxBedrooms:2,locality:'Renens',propertyType:'APARTMENT'}),[
    'Maximum walking: 10 min','Maximum transfers: 0','Minimum rooms: 1.5','Maximum rooms: 3','Minimum bedrooms: 1','Maximum bedrooms: 2','Allowed transit types: Metro','Area: Renens','Property type: Apartment',
  ]);
  assert.deepEqual(activeFilterLabels({...all,transitModes:[]}),['Allowed transit types: None']);
});

test('three primary controls use native sliders and bedroom segments with explicit unlimited states',()=>{
  const dataset=fixture();
  dataset.listings[0].locality='Ecublens';
  dataset.rows[0]={...dataset.rows[0],walkingSeconds:180,transfers:1,transitModes:['SUBWAY','BUS']};
  const before=JSON.stringify(dataset);
  const output=renderToStaticMarkup(createElement(PropertyFilters,{dataset,view:all,setView:()=>{}}));
  assert.ok(output.indexOf('id="commute-filters"')<output.indexOf('class="rent-range"'));
  assert.match(output,/type="range" min="0" max="120" step="5"/);
  assert.match(output,/aria-label="Minimum rent \(CHF\/month\)" aria-valuemax="5000" aria-valuetext="No minimum rent" type="range" min="0" max="5000" step="50"/);
  assert.match(output,/aria-label="Maximum rent \(CHF\/month\)" aria-valuemin="0" aria-valuetext="No maximum rent" type="range" min="0" max="5000" step="50"/);
  assert.match(output,/aria-label="No commute limit"/);
  assert.match(output,/Clear rent limits/);
  assert.match(output,/role="group" aria-label="Minimum bedrooms"/);
  for(const choice of ['1+','2+','3+','4+'])assert.ok(output.includes('>'+choice+'</button>'));
  for(const label of ['Maximum commute (minutes)','Maximum walking (minutes)','Maximum transfers','Allowed transit types in measured journey','Minimum rent (CHF/month)','Maximum rent (CHF/month)','Minimum rooms','Minimum bedrooms','Area'])assert.ok(output.includes(label),label);
  assert.match(output,/<details class="more-property-filters"><summary>More filters<span>/);
  assert.match(output,/<details class="transit-details"><summary>Transit details<span>/);
  for(const group of ['Rooms and space','Home preferences','Areas','Facilities'])assert.ok(output.includes('<summary>'+group+'</summary>'));
  assert.ok(output.includes('>Ecublens</button>'));
  assert.ok(output.includes('>Apartment</button>'));
  assert.doesNotMatch(output,/<select/);
  assert.match(output,/do not find an alternative route/);
  assert.doesNotMatch(output,/source currency|coordinate box|Active box:/);
  assert.equal(JSON.stringify(dataset),before);
});

test('zero limits remain distinct from unlimited and rent uses keyboard-friendly increments',()=>{
  const dataset=fixture();
  const output=renderToStaticMarkup(createElement(PropertyFilters,{dataset,view:{...all,maxCommuteMinutes:0,minRent:0,maxRent:900},setView:()=>{}}));
  assert.match(output,/aria-valuetext="0 min maximum"/);
  assert.match(output,/aria-valuetext="CHF 0 per month minimum"/);
  assert.match(output,/aria-valuetext="CHF 900 per month maximum"/);
  assert.match(output,/step="50"/);
  assert.match(output,/type="number" min="0" max="40" step="0.5"/);
  assert.match(output,/type="number" min="0" max="20" step="1"/);
  const bounded=renderToStaticMarkup(createElement(PropertyFilters,{dataset,view:{...all,minRent:900,maxRent:1500},setView:()=>{}}));
  assert.match(bounded,/aria-label="Minimum rent \(CHF\/month\)" aria-valuemax="1500"/);
  assert.match(bounded,/aria-label="Maximum rent \(CHF\/month\)" aria-valuemin="900"/);
});

test('filters without measured transit detail are unavailable and walking sorts are absent',()=>{
  const dataset=fixture();
  delete dataset.listings[0].locality;
  const output=renderToStaticMarkup(createElement(PropertyFilters,{dataset,view:all,setView:()=>{}}));
  assert.match(output,/type="range" min="0" max="60" step="5" disabled=""/);
  assert.match(output,/<fieldset class="transit-type-filters" disabled="">/);
  assert.doesNotMatch(render(dataset),/value="WALKING_ASC"|value="WALKING_DESC"/);
  dataset.definition.mode='WALK';
  const walking=renderToStaticMarkup(createElement(PropertyFilters,{dataset,view:all,setView:()=>{}}));
  assert.doesNotMatch(walking,/Maximum walking \(minutes\)|Maximum transfers|Allowed transit types in measured journey/);
  assert.match(walking,/<strong>Walking<\/strong>/);
});

test('walking sorting requires measurements for every successful row and allowed types are explicit',()=>{
  const dataset=fixture();
  dataset.rows[0]={...dataset.rows[0],walkingSeconds:120,transfers:0,transitModes:['BUS']};
  const second=structuredClone(dataset.listings[0]);second.id='second';
  dataset.listings.push(second);
  dataset.rows.push({listingId:second.id,listingVersion:second.version,state:'SUCCESS',durationSeconds:1200,provider:'synthetic',warnings:[],calculatedAt:at});
  const output=renderToStaticMarkup(createElement(PropertyFilters,{dataset,view:{...all,transitModes:['BUS']},setView:()=>{}}));
  assert.doesNotMatch(render(dataset),/value="WALKING_ASC"|value="WALKING_DESC"/);
  assert.match(output,/Maximum walking \(minutes\)/);
  assert.match(output,/checkbox" checked=""\/><span>Bus/);
  assert.match(output,/checkbox"\/><span>Metro/);
  assert.match(output,/All transit types used by a measured journey must be allowed/);
});

test('active filter chips remove individual restrictions without touching selection or other filters',()=>{
  const view:ViewState={...all,maxCommuteMinutes:30,maxRent:900,minBedrooms:2,selectedId:'demo-1',facilities:{washingMachine:'SHARED',kitchen:'PRIVATE'}};
  const before=JSON.stringify(view);
  const rentRemoved=removeActiveFilter(view,'Maximum rent: 900 CHF/month');
  assert.equal(rentRemoved.maxRent,undefined);
  assert.equal(rentRemoved.maxCommuteMinutes,30);
  assert.equal(rentRemoved.minBedrooms,2);
  assert.equal(rentRemoved.selectedId,'demo-1');
  const amenityRemoved=removeActiveFilter(view,'Washing machine: Shared');
  assert.equal(amenityRemoved.facilities?.washingMachine,undefined);
  assert.equal(amenityRemoved.facilities?.kitchen,'PRIVATE');
  assert.equal(JSON.stringify(view),before);
  const output=render(fixture(),{view,items:[]});
  assert.match(output,/aria-label="Remove Maximum commute: 30 min"/);
  assert.match(output,/Clear all filters/);
  assert.match(output,/<details class="search-details"><summary>Search details<\/summary>/);
});

test('cards and selected details show fixed transport with measured transit facts and explicit monthly rent',()=>{
  const dataset=fixture();
  dataset.rows[0]={...dataset.rows[0],walkingSeconds:240,transfers:1,transitModes:['SUBWAY','BUS']};
  const output=render(dataset,{view:{...all,selectedId:dataset.listings[0].id}});
  assert.match(output,/class="commute-result-summary">15 min · Public transport<\/p>/);
  assert.match(output,/4 min walking<\/span><span>1 transfer<\/span><span>Metro · Bus/);
  assert.match(output,/<dt>Transit types in measured journey<\/dt><dd>Metro, Bus<\/dd>/);
  assert.match(output,/CHF 650\/month/);
  assert.doesNotMatch(output,/CHF 650 \/ month/);
  assert.equal(money(dataset.listings[0]),'CHF 650/month');
});

test('selected property keeps readable unknown facts, selection context and original observation times',()=>{
  const dataset=fixture(),listing=dataset.listings[0];
  listing.facilities.washingMachine='UNKNOWN';listing.facilities.kitchen='SHARED';listing.furnishing='PARTIAL';
  const before=JSON.stringify(dataset);
  const output=render(dataset,{view:{...all,selectedId:listing.id},items:[],imported:true});
  assert.match(output,/outside your current filters/);
  assert.match(output,/<dt>Washing machine<\/dt><dd>Not stated<\/dd>/);
  assert.match(output,/<dt>Kitchen<\/dt><dd>Shared<\/dd>/);
  assert.match(output,/Partly furnished/);
  assert.ok(output.includes(dateLabel(dataset.calculatedAt)));
  assert.ok(output.includes(dateLabel(listing.lastSeenAt)));
  assert.match(output,/Opening it does not check current availability/);
  assert.match(output,/Clear selected property/);
  assert.equal(JSON.stringify(dataset),before);
});

test('provider implementation stays in expandable details and transit names are human words',()=>{
  const output=renderToStaticMarkup(createElement(DefinitionSummary,{definition:fixture().definition}));
  assert.match(output,/Light rail/);
  assert.doesNotMatch(output,/LIGHT_RAIL|<dt>Provider/);
  assert.match(output,/<details><summary>Calculation details<\/summary><p>Provider: synthetic/);
});

test('snapshot save is unavailable for incomplete searches and disabled adverts stay hidden',()=>{
  const dataset=fixture();
  assert.doesNotMatch(render(dataset),/Advertisement development placeholder|No ad network is loaded/);
  dataset.synthetic=false;
  assert.doesNotMatch(render(dataset),/Advertisement development placeholder/);
  dataset.state='PARTIAL';
  assert.match(render(dataset),/<button disabled="">Save results snapshot<\/button>/);
  assert.doesNotMatch(render(dataset,{items:[]}),/Advertisement development placeholder/);
});
