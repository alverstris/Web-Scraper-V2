import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { activeFilterLabels, datasetStateMessage, emptyResultMessage, ResultExplorer } from '../src/results.tsx';
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
    'Maximum rent: 900 (source currency / period)','Minimum floor area: 30 m²','Maximum commute: 20 min','Partly furnished','Washing machine: Shared','Air conditioning: Not stated','Geographic area','Available journeys only',
  ]);
  assert.deepEqual(activeFilterLabels({...all,maxRent:0}),['Maximum rent: 0 (source currency / period)']);
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
