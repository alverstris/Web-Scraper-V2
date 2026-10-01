import { lazy, Suspense, useRef, useState, type PointerEvent } from 'react';
import type { Dataset, Facility, FacilityKey, ListingVersion, ViewState } from '../shared/contracts';
import type { ResultItem } from './worker-client';
import { AdPlacement } from './ads';
import { CountsSummary, DefinitionSummary, Field, Panel, dateLabel } from './ui';

const facilityLabels: Record<FacilityKey,string> = {washingMachine:'Washing machine',dryer:'Dryer',kitchen:'Kitchen',dishwasher:'Dishwasher',airConditioning:'Air conditioning',balcony:'Balcony',parking:'Parking'};
const facilityValueLabels: Record<Facility,string> = {PRIVATE:'Private',SHARED:'Shared',ABSENT:'Explicitly absent',UNKNOWN:'Not stated',REVIEW:'Needs review'};
const furnishingLabels: Record<ListingVersion['furnishing'],string> = {FURNISHED:'Furnished',UNFURNISHED:'Unfurnished',PARTIAL:'Partly furnished',UNKNOWN:'Furnishing not stated'};
const GoogleMap = lazy(()=>import('./google-map'));
const routeLabels = {SUCCESS:'Available journey',NO_ROUTE:'No journey found',UNRESOLVED_ORIGIN:'Location too imprecise to calculate',UNSUPPORTED_SETTINGS:'Journey settings not supported',PROVIDER_ERROR:'Journey calculation unavailable'};
export function money(listing: ResultItem['listing']) {
  return listing.rent.amount === null ? 'Rent not stated' : `${listing.rent.currency} ${listing.rent.amount.toLocaleString()} / ${listing.rent.period.toLowerCase()}`;
}
function commute(route: ResultItem['route']) { return route.state === 'SUCCESS' && route.durationSeconds !== undefined ? `${Math.ceil(route.durationSeconds/60)} min` : routeLabels[route.state]; }

export function activeFilterLabels(view:ViewState):string[] {
  const labels:string[] = [];
  const numeric: [keyof ViewState,string,string][] = [['maxRent','Maximum rent',' (source currency / period)'],['minBedrooms','Minimum bedrooms',''],['minRooms','Minimum rooms',''],['minBathrooms','Minimum bathrooms',''],['minArea','Minimum floor area',' m²'],['maxCommuteMinutes','Maximum commute',' min']];
  for(const [key,label,unit] of numeric) if(view[key]!==undefined) labels.push(`${label}: ${view[key]}${unit}`);
  if(view.furnishing) labels.push(furnishingLabels[view.furnishing]);
  if(view.propertyType) labels.push(`Property type: ${view.propertyType}`);
  for(const [key,value] of Object.entries(view.facilities ?? {})) if(value) labels.push(`${facilityLabels[key as FacilityKey]}: ${facilityValueLabels[value]}`);
  if(view.bounds) labels.push('Geographic area');
  if(!view.includeUnavailable) labels.push('Available journeys only');
  return labels;
}

export function emptyResultMessage(dataset:Dataset,view:ViewState,busy:boolean):string {
  if(busy) return 'Updating local view…';
  if(dataset.state==='QUEUED') return 'Your search is queued. Properties will appear here as journeys are calculated.';
  if(dataset.state==='RUNNING'&&!dataset.rows.length) return 'Journeys are being calculated. Properties will appear here as each batch finishes.';
  if(dataset.state==='FAILED'&&!dataset.rows.length) return 'This search could not produce results. Review your commute and try another search.';
  if(dataset.state==='CANCELLED'&&!dataset.rows.length) return 'This search was cancelled before results became available.';
  if(!dataset.counts.total) return 'No properties were found within this search’s coverage.';
  if(!view.includeUnavailable&&dataset.counts.success===0&&dataset.counts.completed>0) return `No available journeys have been found${dataset.state==='RUNNING'?' yet':''}. Turn on “Include rows without an available route” to inspect properties with no journey or an imprecise location.`;
  if(dataset.state==='RUNNING') return 'No processed properties match these filters yet. Calculation is still in progress; clear a limit to explore the results already available.';
  if(dataset.state==='PARTIAL') return 'No available results match these filters. This search finished with only some properties processed; clear a limit to explore those results.';
  return 'No results match these filters. Clear a limit to explore the existing search results.';
}

export function datasetStateMessage(dataset:Dataset):string|undefined {
  switch(dataset.state){
    case 'QUEUED': return 'Your search is waiting to start. No journeys have been calculated yet.';
    case 'RUNNING': return 'Results are arriving in batches. The fastest journey shown so far may change as more properties are processed.';
    case 'PARTIAL': return 'The search finished with some properties unprocessed. These results do not establish the fastest journey across the entire search.';
    case 'FAILED': return 'The search failed. Any results shown were calculated before the failure; the full search was not completed.';
    case 'CANCELLED': return 'The search was cancelled. Any results shown were calculated before cancellation; remaining properties were not processed.';
    default: return undefined;
  }
}

export function PropertyFilters({view,setView,dataset}: {view:ViewState;setView:(view:ViewState)=>void;dataset:Dataset}) {
  const [bounds, setBounds] = useState({north:'',south:'',east:'',west:''});
  const [boundsError, setBoundsError] = useState('');
  function numeric(key: 'maxRent'|'minBedrooms'|'minRooms'|'minBathrooms'|'minArea'|'maxCommuteMinutes', label:string) {
    return <Field label={label}><input type="number" min="0" step={key === 'minRooms' ? '0.5':'1'} value={view[key] ?? ''} onChange={e=>setView({...view,[key]:e.target.value === '' ? undefined:Number(e.target.value)})}/></Field>;
  }
  return <Panel title="Property filters" id="property-filters"><p>These controls filter all loaded search results locally. They do not calculate routes.</p><div className="control-grid">
    {numeric('maxRent','Maximum rent (source currency / period)')}{numeric('minBedrooms','Minimum bedrooms')}{numeric('minRooms','Minimum rooms (separate from bedrooms)')}{numeric('minBathrooms','Minimum bathrooms')}{numeric('minArea','Minimum floor area (m²)')}{numeric('maxCommuteMinutes','Maximum commute (minutes)')}
    <Field label="Furnishing"><select value={view.furnishing ?? ''} onChange={e=>setView({...view,furnishing:e.target.value as ViewState['furnishing'] || undefined})}><option value="">Any / not stated</option><option value="FURNISHED">Furnished</option><option value="UNFURNISHED">Unfurnished</option><option value="PARTIAL">Partly furnished</option><option value="UNKNOWN">Not stated</option></select></Field>
    <Field label="Property type"><select value={view.propertyType ?? ''} onChange={e=>setView({...view,propertyType:e.target.value || undefined})}><option value="">Any type</option>{[...new Set(dataset.listings.map(l=>l.propertyType))].map(type=><option key={type} value={type}>{type}</option>)}</select></Field>
    {Object.entries(facilityLabels).map(([key,label])=><Field key={key} label={label}><select value={view.facilities?.[key as FacilityKey] ?? ''} onChange={e=>{const facilities = {...view.facilities}; if(e.target.value) facilities[key as FacilityKey] = e.target.value as NonNullable<ViewState['facilities']>[FacilityKey]; else delete facilities[key as FacilityKey]; setView({...view,facilities});}}><option value="">Any / not stated</option><option value="PRIVATE">Private</option><option value="SHARED">Shared</option><option value="ABSENT">Explicitly absent</option><option value="UNKNOWN">Not stated</option><option value="REVIEW">Needs review</option></select></Field>)}
    <Field label="Sort"><select value={view.sort} onChange={e=>setView({...view,sort:e.target.value as ViewState['sort']})}><option value="COMMUTE_ASC">Shortest commute first</option><option value="COMMUTE_DESC">Longest commute first</option><option value="RENT_ASC">Lowest rent first</option><option value="RENT_DESC">Highest rent first</option></select></Field>
  </div><label className="check"><input type="checkbox" checked={view.includeUnavailable} onChange={e=>setView({...view,includeUnavailable:e.target.checked})}/> Include rows without an available route</label><p className="muted">A minimum, maximum or facility requirement excludes listings where that fact is unknown. Unknown never means zero or absent.</p>
  <details><summary>Geographic view filter</summary><p>Enter a coordinate box. This filters the current dataset; it does not change its coverage.</p><div className="control-grid">{(['north','south','east','west'] as const).map(key=><Field key={key} label={key}><input type="number" step="any" min={key==='north'||key==='south'?-90:-180} max={key==='north'||key==='south'?90:180} value={bounds[key]} onChange={e=>setBounds({...bounds,[key]:e.target.value})}/></Field>)}</div><div className="actions"><button onClick={()=>{const b = {north:Number(bounds.north),south:Number(bounds.south),east:Number(bounds.east),west:Number(bounds.west)}; if(Object.values(bounds).some(v=>v==='') || Object.values(b).some(v=>!Number.isFinite(v)) || b.north<=b.south || b.east<=b.west || b.north>90 || b.south< -90 || b.east>180 || b.west< -180) {setBoundsError('Enter a valid box: north above south and east above west.');return;} setBoundsError('');setView({...view,bounds:b});}}>Apply geographic filter</button><button onClick={()=>setView({...view,bounds:undefined})}>Clear geographic filter</button></div>{boundsError && <p role="alert">{boundsError}</p>}{view.bounds && <p>Active box: {JSON.stringify(view.bounds)}</p>}</details>
  <p className="muted">Rent filters and sorting use the stated amounts. Currencies and weekly or monthly periods are not converted; compare rents with the same currency and period.</p>
  <button onClick={()=>{setView({sort:'COMMUTE_ASC',includeUnavailable:true,selectedId:view.selectedId});setBounds({north:'',south:'',east:'',west:''});setBoundsError('');}}>Reset property filters</button></Panel>;
}

function SchematicMap({dataset,items,selectedId,onSelect,onBounds}:{dataset:Dataset;items:ResultItem[];selectedId?:string;onSelect:(id:string)=>void;onBounds:(bounds:ViewState['bounds'])=>void}) {
  const [drawing,setDrawing] = useState(false);
  const [drag,setDrag] = useState<{startX:number;startY:number;x:number;y:number}|null>(null);
  if (!dataset.synthetic) return <Suspense fallback={<p>Loading map adapter…</p>}><GoogleMap dataset={dataset} items={items} selectedId={selectedId} onSelect={onSelect} onBounds={onBounds}/></Suspense>;
  const markers = items.map((item,index)=>({item,number:index+1})).filter(marker=>marker.item.listing.location.point);
  const points = dataset.listings.flatMap(listing=>listing.location.point?[listing.location.point]:[]);
  const destination = dataset.definition.destination.point;
  if(destination) points.push(destination);
  if(!points.length) return <p>These results have no usable coordinates.</p>;
  const latMin = Math.min(...points.map(p=>p.lat))-.003, latMax = Math.max(...points.map(p=>p.lat))+.003;
  const lngMin = Math.min(...points.map(p=>p.lng))-.003, lngMax = Math.max(...points.map(p=>p.lng))+.003;
  function position(point:{lat:number;lng:number}) {return {left:`${5+90*(point.lng-lngMin)/(lngMax-lngMin)}%`,top:`${5+90*(latMax-point.lat)/(latMax-latMin)}%`};}
  function cursor(e:PointerEvent<HTMLDivElement>){const rect=e.currentTarget.getBoundingClientRect();return {x:Math.max(0,Math.min(100,(e.clientX-rect.left)/rect.width*100)),y:Math.max(0,Math.min(100,(e.clientY-rect.top)/rect.height*100))};}
  function finish(){if(!drag)return;const lng=(x:number)=>lngMin+(x-5)/90*(lngMax-lngMin),lat=(y:number)=>latMax-(y-5)/90*(latMax-latMin);if(Math.abs(drag.x-drag.startX)>1&&Math.abs(drag.y-drag.startY)>1)onBounds({north:lat(Math.min(drag.y,drag.startY)),south:lat(Math.max(drag.y,drag.startY)),west:lng(Math.min(drag.x,drag.startX)),east:lng(Math.max(drag.x,drag.startX))});setDrag(null);setDrawing(false);}
  return <section aria-label="Synthetic coordinate overview"><p>Coordinate schematic of synthetic listings. No basemap, route geometry or commute contours are represented. Approximate origins remain approximate.</p><div className="actions"><button aria-pressed={drawing} onClick={()=>{setDrawing(!drawing);setDrag(null);}}>Draw geographic view filter</button><button onClick={()=>onBounds(undefined)}>Clear geographic filter</button></div><p>{drawing?'Drag a rectangle to filter this dataset. The coordinate fields above provide a keyboard alternative.':'Select a numbered marker to inspect its property.'}</p><div className="map-plot" onPointerDown={e=>{if(!drawing)return;e.preventDefault();e.currentTarget.setPointerCapture(e.pointerId);const p=cursor(e);setDrag({startX:p.x,startY:p.y,...p});}} onPointerMove={e=>{if(drag)setDrag({...drag,...cursor(e)});}} onPointerUp={finish} onPointerCancel={()=>setDrag(null)}>{drag&&<span className="map-selection" style={{left:`${Math.min(drag.startX,drag.x)}%`,top:`${Math.min(drag.startY,drag.y)}%`,width:`${Math.abs(drag.x-drag.startX)}%`,height:`${Math.abs(drag.y-drag.startY)}%`}}/>}{destination && <span className="destination-marker" style={position(destination)} title={dataset.definition.destination.label}>Destination</span>}{markers.map(({item,number})=><button key={item.listing.id} className={`map-marker ${item.listing.id===selectedId?'selected':''}`} style={position(item.listing.location.point!)} aria-label={`Select ${item.listing.title}; ${commute(item.route)}; ${item.listing.location.precision.toLowerCase()} location`} aria-pressed={item.listing.id===selectedId} onClick={()=>{if(!drawing)onSelect(item.listing.id);}}>{number}</button>)}</div><p>{items.length-markers.length} results have no map point. All results can be selected below.</p><div className="marker-key">{markers.map(({item,number})=><button key={item.listing.id} aria-pressed={item.listing.id===selectedId} onClick={()=>onSelect(item.listing.id)}>{number}. {item.listing.title}</button>)}</div></section>;
}

export function ResultExplorer({dataset,items,view,setView,imported,busy,onSource,onSave,onEditCommute,saveDisabled=false}:{dataset:Dataset;items:ResultItem[];view:ViewState;setView:(view:ViewState)=>void;imported:boolean;busy:boolean;onSource:(item:ResultItem)=>void;onSave?:()=>void;onEditCommute?:()=>void;saveDisabled?:boolean}) {
  const [presentation,setPresentation] = useState<'list'|'map'>('list');
  const [limit,setLimit] = useState(60);
  const detailsHeading = useRef<HTMLHeadingElement>(null);
  const selectedCardButton = useRef<HTMLButtonElement>(null);
  const listButton = useRef<HTMLButtonElement>(null);
  const listing = dataset.listings.find(l=>l.id === view.selectedId);
  const route = dataset.rows.find(r=>r.listingId === view.selectedId && r.listingVersion === listing?.version);
  const selected = listing && route ? {listing,route} : undefined;
  const activeFilters = activeFilterLabels(view);
  const stateMessage = datasetStateMessage(dataset);
  function select(id:string) {
    const position = items.findIndex(item=>item.listing.id===id);
    if(position>=limit) setLimit(Math.ceil((position+1)/60)*60);
    setView({...view,selectedId:id});
    requestAnimationFrame(()=>detailsHeading.current?.focus());
  }
  function clearSelection() {
    const target=selectedCardButton.current ?? listButton.current;
    setView({...view,selectedId:undefined});
    requestAnimationFrame(()=>target?.focus());
  }
  return <Panel title="Search results" id="search-results">
    <div className="result-heading"><p>{imported?'Saved snapshot':dataset.synthetic?'Synthetic results':'Calculated results'} · {dataset.state.toLowerCase()}</p><p>Calculated {dateLabel(dataset.calculatedAt)}. Listing availability may have changed.</p></div>
    <DefinitionSummary definition={dataset.definition}/>
    <p>Coverage: {dataset.coverage}. Search contains {dataset.counts.total} property records.</p>
    <CountsSummary counts={dataset.counts}/>
    {stateMessage && <p className="notice">{stateMessage}</p>}
    {dataset.counts.noRoute>0 && <p>No journey found means no suitable route was returned for these settings; it does not mean a zero-minute commute.</p>}
    {imported && <p>This snapshot keeps the original calculation and source observation times. Opening it does not check current availability or calculate fresh journeys.</p>}
    <p>{dataset.attribution.join(' · ')}</p>
    <p role="status" aria-live="polite">{busy?'Updating local view…':`${items.length} matching results`} · {activeFilters.length?`Active filters: ${activeFilters.join('; ')}`:'No property limits'}</p>
    <div className="actions" role="group" aria-label="Result presentation">
      <button ref={listButton} aria-pressed={presentation==='list'} onClick={()=>setPresentation('list')}>List</button>
      <button aria-pressed={presentation==='map'} onClick={()=>setPresentation('map')}>Map / coordinates</button>
      {onSave && <button disabled={saveDisabled||dataset.state!=='COMPLETE'||!dataset.exportAllowed} onClick={onSave}>Save results snapshot</button>}
      {onEditCommute && <button onClick={onEditCommute}>Edit commute</button>}
    </div>
    {!busy&&!items.length && <p>{emptyResultMessage(dataset,view,false)}</p>}
    {presentation==='map' && <SchematicMap dataset={dataset} items={items} selectedId={view.selectedId} onSelect={select} onBounds={bounds=>setView({...view,bounds})}/>}
    <div className="results-layout"><div>
      <ol className="result-list" aria-label="Property results">{items.slice(0,limit).map((item,index)=><li key={item.listing.id} className={`result-card ${view.selectedId===item.listing.id?'selected':''}`} data-motion-key={item.listing.id}>
        <h3><span>{index+1}. </span><button ref={view.selectedId===item.listing.id?selectedCardButton:undefined} className="text-button" onClick={()=>select(item.listing.id)} aria-pressed={view.selectedId===item.listing.id}>{item.listing.title}</button></h3>
        <p>{commute(item.route)} · {money(item.listing)}</p>
        <p>{item.listing.rooms ?? 'Not stated'} rooms · {item.listing.bedrooms ?? 'Not stated'} bedrooms · {item.listing.floorArea ?? 'Not stated'} m²</p>
        <p>{item.listing.location.label} · {item.listing.location.precision.toLowerCase()} location</p>
        <p>Source: {item.listing.sourceId} · {furnishingLabels[item.listing.furnishing]}</p>
        {item.route.warnings.map((warning,i)=><p key={i} className="muted">{warning}</p>)}
        <div className="actions"><button onClick={()=>select(item.listing.id)}>Details</button><button onClick={()=>onSource(item)}>Open original listing</button></div>
      </li>)}</ol>
      {items.length>limit && <button onClick={()=>setLimit(limit+60)}>Show 60 more results ({items.length-limit} remaining)</button>}
      <AdPlacement slot="results-inline" config={{enabled:false,approved:false,slots:['results-inline'],consentRequired:true}} />
    </div>
    <aside className="details" aria-label="Selected property" data-motion-region="selected-property">{selected ? <>
      <h3 tabIndex={-1} ref={detailsHeading}>{selected.listing.title}</h3>
      <button onClick={clearSelection}>Clear selected property</button>
      {!items.some(item=>item.listing.id===selected.listing.id) && <p role="status">This selection is outside your current filters. Clear the filters to show its card and marker again.</p>}
      <p>{money(selected.listing)}</p>
      <p>Additional charges: {selected.listing.rent.charges===null?'Not stated':`${selected.listing.rent.currency} ${selected.listing.rent.charges}`}</p>
      <p>{commute(selected.route)} · calculated {dateLabel(selected.route.calculatedAt)}</p>
      <p>Location precision: {selected.listing.location.precision.toLowerCase()}. {selected.listing.location.precision!=='EXACT'?'The marker does not establish an exact property address.':''}</p>
      <dl className="facts">
        <div><dt>Rooms</dt><dd>{selected.listing.rooms ?? 'Not stated'}</dd></div>
        <div><dt>Bedrooms</dt><dd>{selected.listing.bedrooms ?? 'Not stated'}</dd></div>
        <div><dt>Bathrooms</dt><dd>{selected.listing.bathrooms ?? 'Not stated'}</dd></div>
        <div><dt>Floor area</dt><dd>{selected.listing.floorArea===null?'Not stated':`${selected.listing.floorArea} m²`}</dd></div>
        <div><dt>Furnishing</dt><dd>{furnishingLabels[selected.listing.furnishing]}</dd></div>
        {Object.entries(facilityLabels).map(([key,label])=><div key={key}><dt>{label}</dt><dd>{facilityValueLabels[selected.listing.facilities[key as FacilityKey]]}</dd></div>)}
        {selected.route.distanceMeters!==undefined && <div><dt>Measured journey distance</dt><dd>{(selected.route.distanceMeters/1000).toFixed(1)} km</dd></div>}
        {selected.route.walkingSeconds!==undefined && <div><dt>Walking</dt><dd>{Math.ceil(selected.route.walkingSeconds/60)} min</dd></div>}
        {selected.route.transfers!==undefined && <div><dt>Transfers</dt><dd>{selected.route.transfers}</dd></div>}
      </dl>
      {selected.route.walkingSeconds===undefined && selected.route.transfers===undefined && <p>Walking time and transfer count were not measured for this result.</p>}
      {selected.route.warnings.map((warning,i)=><p className="muted" key={i}>{warning}</p>)}
      <p>Source last observed: {dateLabel(selected.listing.lastSeenAt)}. Availability is not checked when you open these details.</p>
      <details><summary>Source and attribute evidence</summary><p>Location evidence: {selected.listing.location.provenance}</p><dl className="facts">{Object.entries(selected.listing.evidence).map(([key,value])=><div key={key}><dt>{facilityLabels[key as FacilityKey] ?? key.replace(/([a-z])([A-Z])/g,'$1 $2').replace(/_/g,' ')}</dt><dd>{value}</dd></div>)}</dl></details>
      <button onClick={()=>onSource(selected)}>Open original listing</button>
    </> : <p>Select a property card or coordinate marker to inspect its source facts and journey details.</p>}</aside></div>
  </Panel>;
}
