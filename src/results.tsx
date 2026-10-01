import { lazy, Suspense, useId, useRef, useState, type CSSProperties, type PointerEvent } from 'react';
import type { Dataset, Facility, FacilityKey, ListingVersion, TransitMode, ViewState } from '../shared/contracts';
import { FILTER_LIMITS, FILTER_OPTIONS, validateViewState } from '../shared/search-filters';
import type { ResultItem } from './worker-client';
import { AdPlacement } from './ads';
import { CountsSummary, DefinitionSummary, Field, Panel, dateLabel, modeLabels } from './ui';

const facilityLabels: Record<FacilityKey,string> = {washingMachine:'Washing machine',dryer:'Dryer',kitchen:'Kitchen',dishwasher:'Dishwasher',airConditioning:'Air conditioning',balcony:'Balcony',parking:'Parking'};
const facilityValueLabels: Record<Facility,string> = {PRIVATE:'Private',SHARED:'Shared',ABSENT:'Explicitly absent',UNKNOWN:'Not stated',REVIEW:'Needs review'};
const furnishingLabels: Record<ListingVersion['furnishing'],string> = {FURNISHED:'Furnished',UNFURNISHED:'Unfurnished',PARTIAL:'Partly furnished',UNKNOWN:'Furnishing not stated'};
const transitLabels: Record<TransitMode,string> = {BUS:'Bus',SUBWAY:'Metro',TRAIN:'Train',LIGHT_RAIL:'Light rail',RAIL:'Rail'};
const GoogleMap = lazy(()=>import('./google-map'));
const routeLabels = {SUCCESS:'Available journey',NO_ROUTE:'No journey found',UNRESOLVED_ORIGIN:'Location too imprecise to calculate',UNSUPPORTED_SETTINGS:'Journey settings not supported',PROVIDER_ERROR:'Journey calculation unavailable'};
export function money(listing: ResultItem['listing']) {
  return listing.rent.amount === null ? 'Rent not stated' : `CHF ${listing.rent.amount.toLocaleString('en-CH')}/month`;
}
function commute(route: ResultItem['route']) { return route.state === 'SUCCESS' && route.durationSeconds !== undefined ? `${Math.ceil(route.durationSeconds/60)} min` : routeLabels[route.state]; }

function MeasuredJourney({item,mode}:{item:ResultItem;mode:Dataset['definition']['mode']}) {
  if(item.route.state!=='SUCCESS'||mode!=='TRANSIT')return null;
  if(item.route.walkingSeconds===undefined&&item.route.transfers===undefined&&item.route.transitModes===undefined)return null;
  return <p className="measured-journey-facts">
    {item.route.walkingSeconds!==undefined&&<span>{Math.ceil(item.route.walkingSeconds/60)} min walking</span>}
    {item.route.transfers!==undefined&&<span>{item.route.transfers} {item.route.transfers===1?'transfer':'transfers'}</span>}
    {item.route.transitModes!==undefined&&<span>{item.route.transitModes.length?item.route.transitModes.map(type=>transitLabels[type]).join(' · '):'No transit leg'}</span>}
  </p>;
}

export function activeFilterLabels(view:ViewState):string[] {
  const labels:string[] = [];
  const numeric: [keyof ViewState,string,string][] = [['maxCommuteMinutes','Maximum commute',' min'],['maxWalkingMinutes','Maximum walking',' min'],['maxTransfers','Maximum transfers',''],['minRent','Minimum rent',' CHF/month'],['maxRent','Maximum rent',' CHF/month'],['minRooms','Minimum rooms',''],['maxRooms','Maximum rooms',''],['minBedrooms','Minimum bedrooms',''],['maxBedrooms','Maximum bedrooms',''],['minBathrooms','Minimum bathrooms',''],['maxBathrooms','Maximum bathrooms',''],['minArea','Minimum floor area',' m²'],['maxArea','Maximum floor area',' m²']];
  for(const [key,label,unit] of numeric) if(view[key]!==undefined) labels.push(`${label}: ${view[key]}${unit}`);
  if(view.transitModes!==undefined)labels.push(`Allowed transit types: ${view.transitModes.length?view.transitModes.map(type=>transitLabels[type]).join(', '):'None'}`);
  if(view.locality)labels.push(`Area: ${view.locality}`);
  if(view.furnishing) labels.push(furnishingLabels[view.furnishing]);
  if(view.propertyType) labels.push(`Property type: ${FILTER_OPTIONS.propertyTypes.find(option=>option.value===view.propertyType)?.label??view.propertyType}`);
  for(const [key,value] of Object.entries(view.facilities ?? {})) if(value) labels.push(`${facilityLabels[key as FacilityKey]}: ${facilityValueLabels[value]}`);
  if(view.bounds) labels.push('Geographic area');
  if(!view.includeUnavailable) labels.push('Available journeys only');
  return labels;
}

export function removeActiveFilter(view:ViewState,label:string):ViewState {
  const numeric: [keyof ViewState,string][] = [['maxCommuteMinutes','Maximum commute:'],['maxWalkingMinutes','Maximum walking:'],['maxTransfers','Maximum transfers:'],['minRent','Minimum rent:'],['maxRent','Maximum rent:'],['minRooms','Minimum rooms:'],['maxRooms','Maximum rooms:'],['minBedrooms','Minimum bedrooms:'],['maxBedrooms','Maximum bedrooms:'],['minBathrooms','Minimum bathrooms:'],['maxBathrooms','Maximum bathrooms:'],['minArea','Minimum floor area:'],['maxArea','Maximum floor area:']];
  const key=numeric.find(([,prefix])=>label.startsWith(prefix))?.[0];
  if(key)return validateViewState({...view,[key]:undefined});
  if(label.startsWith('Allowed transit types:'))return validateViewState({...view,transitModes:undefined});
  if(label.startsWith('Area:'))return validateViewState({...view,locality:undefined});
  if(label.startsWith('Property type:'))return validateViewState({...view,propertyType:undefined});
  if(view.furnishing&&label===furnishingLabels[view.furnishing])return validateViewState({...view,furnishing:undefined});
  if(label==='Geographic area')return validateViewState({...view,bounds:undefined});
  if(label==='Available journeys only')return validateViewState({...view,includeUnavailable:true});
  const facility=(Object.entries(facilityLabels) as [FacilityKey,string][]).find(([,name])=>label.startsWith(name+':'))?.[0];
  if(facility){const facilities={...view.facilities};delete facilities[facility];return validateViewState({...view,facilities});}
  return view;
}

function LimitSlider({label,value,maximum=120,step=5,unit='min',disabled=false,clearLabel,onChange}:{label:string;value?:number;maximum?:number;step?:number;unit?:string;disabled?:boolean;clearLabel:string;onChange:(value:number|undefined)=>void}) {
  const id=useId(),max=Math.max(maximum,Math.ceil((value??0)/step)*step);
  return <div className={`limit-slider${disabled?' control-unavailable':''}`}>
    <div className="slider-heading"><label htmlFor={id}>{label}</label><output htmlFor={id}>{value===undefined?'No limit':`${value} ${unit}`}</output></div>
    <input id={id} type="range" min="0" max={max} step={step} value={value??max} disabled={disabled} aria-valuetext={value===undefined?'No limit':`${value} ${unit} maximum`} onChange={event=>onChange(Number(event.target.value))} style={{'--range-fill':`${(value??max)/max*100}%`} as CSSProperties}/>
    <div className="slider-scale"><span>0 {unit}</span><button type="button" aria-label={clearLabel} disabled={disabled||value===undefined} onClick={()=>onChange(undefined)}>No limit</button><span>{max} {unit}</span></div>
  </div>;
}

function RentRange({view,onChange}:{view:ViewState;onChange:(view:ViewState)=>void}) {
  const minId=useId(),maxId=useId();
  const scale=Math.max(5000,Math.ceil(Math.max(view.minRent??0,view.maxRent??0)/50)*50);
  const from=view.minRent??0,to=view.maxRent??scale;
  return <div className="rent-range">
    <div className="slider-heading"><h3>Monthly rent</h3><span>CHF/month</span></div>
    <div className="rent-range-values"><label htmlFor={minId}>From <strong>{view.minRent===undefined?'Any':`CHF ${view.minRent.toLocaleString('en-CH')}`}</strong></label><label htmlFor={maxId}>Up to <strong>{view.maxRent===undefined?'No limit':`CHF ${view.maxRent.toLocaleString('en-CH')}`}</strong></label></div>
    <div className="dual-range" style={{'--range-start':`${from/scale*100}%`,'--range-end':`${to/scale*100}%`} as CSSProperties} onPointerDown={event=>{if((event.target as HTMLElement).tagName==='INPUT')return;const rect=event.currentTarget.getBoundingClientRect();const amount=Math.max(0,Math.min(scale,Math.round((event.clientX-rect.left)/rect.width*scale/50)*50));if(Math.abs(amount-from)<Math.abs(amount-to))onChange({...view,minRent:Math.min(amount,to)});else onChange({...view,maxRent:Math.max(amount,from)});}}>
      <span className="dual-range-track" aria-hidden="true"/>
      <input id={minId} aria-label="Minimum rent (CHF/month)" aria-valuemax={to} aria-valuetext={view.minRent===undefined?'No minimum rent':`CHF ${view.minRent} per month minimum`} type="range" min="0" max={scale} step="50" value={from} onChange={event=>onChange({...view,minRent:Math.min(Number(event.target.value),to)})}/>
      <input id={maxId} aria-label="Maximum rent (CHF/month)" aria-valuemin={from} aria-valuetext={view.maxRent===undefined?'No maximum rent':`CHF ${view.maxRent} per month maximum`} type="range" min="0" max={scale} step="50" value={to} onChange={event=>onChange({...view,maxRent:Math.max(Number(event.target.value),from)})}/>
    </div>
    <div className="slider-scale"><span>CHF 0</span><button type="button" disabled={view.minRent===undefined&&view.maxRent===undefined} onClick={()=>onChange({...view,minRent:undefined,maxRent:undefined})}>Clear rent limits</button><span>CHF {scale.toLocaleString('en-CH')}</span></div>
    <small>Advertised rent. Additional charges are shown separately.</small>
  </div>;
}

function PillChoices<T extends string|number>({label,value,options,onChange,disabled=false}:{label:string;value?:T;options:readonly {value:T;label:string}[];onChange:(value:T|undefined)=>void;disabled?:boolean}) {
  return <div className="filter-choice-group" role="group" aria-label={label}><p className="filter-choice-label">{label}</p><div className="filter-choice-options"><button type="button" aria-pressed={value===undefined} disabled={disabled} onClick={()=>onChange(undefined)}>Any</button>{options.map(option=><button type="button" key={option.value} aria-pressed={value===option.value} disabled={disabled} onClick={()=>onChange(option.value)}>{option.label}</button>)}</div></div>;
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
  const [filterError,setFilterError] = useState('');
  const transit = dataset.definition.mode==='TRANSIT';
  const successfulRows = dataset.rows.filter(row=>row.state==='SUCCESS');
  const hasWalking = transit&&successfulRows.some(row=>row.walkingSeconds!==undefined);
  const hasTransfers = transit&&successfulRows.some(row=>row.transfers!==undefined);
  const hasTransitTypes = transit&&successfulRows.some(row=>row.transitModes!==undefined);
  const localities = [...new Set(dataset.listings.flatMap(listing=>listing.locality?[listing.locality]:[]))].sort();
  function update(next:ViewState) {
    try {setView(validateViewState(next));setFilterError('');}
    catch {setFilterError('Keep each minimum below its maximum, within the shown range and increments.');}
  }
  type NumericKey = 'minBedrooms'|'maxBedrooms'|'minRooms'|'maxRooms'|'minBathrooms'|'maxBathrooms'|'minArea'|'maxArea';
  function exactRange(title:string,minKey:NumericKey,maxKey:NumericKey,maximum:number,step=1,unit='') {
    function change(key:NumericKey,value:string) {
      let number=value===''?undefined:Number(value);
      const opposite=key===minKey?view[maxKey]:view[minKey];
      if(number!==undefined&&opposite!==undefined)number=key===minKey?Math.min(number,opposite):Math.max(number,opposite);
      update({...view,[key]:number});
    }
    return <div className="exact-range-row"><h4>{title}</h4><div className="exact-range-inputs">
      <Field label={'Minimum '+title.toLowerCase()+(unit?' ('+unit+')':'')}><input type="number" min="0" max={maximum} step={step} value={view[minKey]??''} placeholder="Any" onChange={event=>change(minKey,event.target.value)}/></Field>
      <span aria-hidden="true">to</span>
      <Field label={'Maximum '+title.toLowerCase()+(unit?' ('+unit+')':'')}><input type="number" min="0" max={maximum} step={step} value={view[maxKey]??''} placeholder="No limit" onChange={event=>change(maxKey,event.target.value)}/></Field>
    </div></div>;
  }
  return <Panel title="Filter homes" id="property-filters" className="compact-filters">
    <div className="commute-filter-header"><p><strong>{modeLabels[dataset.definition.mode]}</strong> to <strong>{dataset.definition.destination.label}</strong></p><span className="free-filter-note">Filters use no new runs</span></div>
    <div className="primary-filter-grid">
      <section id="commute-filters" className="primary-filter-card commute-filters"><h3>Your commute</h3>
        <LimitSlider label="Maximum commute (minutes)" value={view.maxCommuteMinutes} clearLabel="No commute limit" onChange={value=>update({...view,maxCommuteMinutes:value})}/>
      </section>
      <section className="primary-filter-card"><RentRange view={view} onChange={update}/></section>
      <section className="primary-filter-card bedroom-filter">
        <PillChoices label="Minimum bedrooms" value={view.minBedrooms} options={[1,2,3,4].map(value=>({value,label:value+'+'}))} onChange={value=>update({...view,minBedrooms:value,maxBedrooms:value!==undefined&&view.maxBedrooms!==undefined&&view.maxBedrooms<value?undefined:view.maxBedrooms})}/>
        <small>A bedroom is a separate sleeping room. Exact room counts are in More filters.</small>
      </section>
    </div>
    <div className="filter-disclosures">
      {transit&&<details className="transit-details"><summary>Transit details<span>Walking, transfers and transport types</span></summary>
        <div className="transit-detail-controls"><LimitSlider label="Maximum walking (minutes)" maximum={60} value={view.maxWalkingMinutes} disabled={!hasWalking} clearLabel="No walking limit" onChange={value=>update({...view,maxWalkingMinutes:value})}/>
          <PillChoices label="Maximum transfers" value={view.maxTransfers} disabled={!hasTransfers} options={[0,1,2,3,4].map(value=>({value,label:String(value)}))} onChange={value=>update({...view,maxTransfers:value})}/>
        </div>
        <fieldset className="transit-type-filters" disabled={!hasTransitTypes}><legend>Allowed transit types in measured journey</legend><div className="transit-type-options">{FILTER_OPTIONS.transitModes.map(option=><label className="check checkbox-pill" key={option.value}><input type="checkbox" checked={view.transitModes===undefined||view.transitModes.includes(option.value)} onChange={event=>{const allowed=view.transitModes??FILTER_OPTIONS.transitModes.map(type=>type.value);const next=event.target.checked?[...allowed,option.value]:allowed.filter(type=>type!==option.value);update({...view,transitModes:next.length===FILTER_OPTIONS.transitModes.length?undefined:next});}}/><span>{option.label}</span></label>)}</div></fieldset>
        <p className="muted">Uncheck a type to exclude journeys that use it. All transit types used by a measured journey must be allowed. These limits filter the returned journey; they do not find an alternative route. Search preferences remain separate.</p>
        {(!hasWalking||!hasTransfers||!hasTransitTypes)&&<p className="muted">Controls without measured journey data are unavailable.</p>}
      </details>}
      <details className="more-property-filters"><summary>More filters<span>Rooms, home preferences, areas and amenities</span></summary>
        <div className="advanced-filter-groups">
          <details className="advanced-filter-group"><summary>Rooms and space</summary><p className="muted">Rooms and bedrooms are separate facts. Leave a field empty for no limit.</p>
            {exactRange('Rooms','minRooms','maxRooms',FILTER_LIMITS.rooms,.5)}
            {exactRange('Bedrooms','minBedrooms','maxBedrooms',FILTER_LIMITS.bedrooms)}
            {exactRange('Bathrooms','minBathrooms','maxBathrooms',FILTER_LIMITS.bathrooms)}
            {exactRange('Floor area','minArea','maxArea',FILTER_LIMITS.area,1,'m²')}
          </details>
          <details className="advanced-filter-group"><summary>Home preferences</summary>
            <PillChoices label="Furnishing" value={view.furnishing} options={FILTER_OPTIONS.furnishing} onChange={value=>update({...view,furnishing:value})}/>
            <PillChoices label="Property type" value={view.propertyType} options={FILTER_OPTIONS.propertyTypes} onChange={value=>update({...view,propertyType:value})}/>
          </details>
          <details className="advanced-filter-group"><summary>Areas</summary>
            <PillChoices label="Area" value={view.locality} disabled={!localities.length} options={localities.map(value=>({value,label:value}))} onChange={value=>update({...view,locality:value,bounds:undefined})}/>
            <p className="muted">Choose a named area here, or draw a filter in the map view.</p>
            {view.bounds&&<p className="notice">A drawn area is active. <button onClick={()=>update({...view,bounds:undefined})}>Clear geographic filter</button></p>}
          </details>
          <details className="advanced-filter-group"><summary>Facilities</summary>
            <p className="muted">Choose an amenity, then say whether it should be private or shared. Missing information stays “Not stated”.</p>
            <div className="amenity-rows">{(Object.entries(facilityLabels) as [FacilityKey,string][]).map(([key,label])=><details className="amenity-row" key={key}><summary>{label}<span>{view.facilities?.[key]?facilityValueLabels[view.facilities[key]!]: 'Any'}</span></summary>
              <PillChoices label={label} value={view.facilities?.[key]} options={FILTER_OPTIONS.facilities} onChange={value=>{const facilities={...view.facilities};if(value)facilities[key]=value;else delete facilities[key];update({...view,facilities});}}/>
            </details>)}</div>
          </details>
        </div>
        <label className="check availability-filter"><input type="checkbox" checked={view.includeUnavailable} onChange={event=>update({...view,includeUnavailable:event.target.checked})}/> Include rows without an available route</label>
        <p className="muted">Limits exclude homes with unknown facts. Unknown never means zero or absent.</p>
      </details>
    </div>
    {filterError&&<p role="alert">{filterError}</p>}
  </Panel>;
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
  return <section aria-label="Synthetic coordinate overview"><p>Coordinate overview of the sample homes. Approximate locations remain approximate.</p><div className="actions"><button aria-pressed={drawing} onClick={()=>{setDrawing(!drawing);setDrag(null);}}>Draw geographic view filter</button><button onClick={()=>onBounds(undefined)}>Clear geographic filter</button></div><p>{drawing?'Drag a rectangle to filter this search. The Area menu in housing filters provides a keyboard alternative.':'Select a numbered marker to inspect its property.'}</p><div className="map-plot" onPointerDown={e=>{if(!drawing)return;e.preventDefault();e.currentTarget.setPointerCapture(e.pointerId);const p=cursor(e);setDrag({startX:p.x,startY:p.y,...p});}} onPointerMove={e=>{if(drag)setDrag({...drag,...cursor(e)});}} onPointerUp={finish} onPointerCancel={()=>setDrag(null)}>{drag&&<span className="map-selection" style={{left:`${Math.min(drag.startX,drag.x)}%`,top:`${Math.min(drag.startY,drag.y)}%`,width:`${Math.abs(drag.x-drag.startX)}%`,height:`${Math.abs(drag.y-drag.startY)}%`}}/>}{destination && <span className="destination-marker" style={position(destination)} title={dataset.definition.destination.label}>Destination</span>}{markers.map(({item,number})=><button key={item.listing.id} className={`map-marker ${item.listing.id===selectedId?'selected':''}`} style={position(item.listing.location.point!)} aria-label={`Select ${item.listing.title}; ${commute(item.route)}; ${item.listing.location.precision.toLowerCase()} location`} aria-pressed={item.listing.id===selectedId} onClick={()=>{if(!drawing)onSelect(item.listing.id);}}>{number}</button>)}</div><p>{items.length-markers.length} results have no map point. All results can be selected below.</p><div className="marker-key">{markers.map(({item,number})=><button key={item.listing.id} aria-pressed={item.listing.id===selectedId} onClick={()=>onSelect(item.listing.id)}>{number}. {item.listing.title}</button>)}</div></section>;
}

export function ResultExplorer({dataset,items,view,setView,imported,busy,onSource,onSave,onEditCommute,saveDisabled=false}:{dataset:Dataset;items:ResultItem[];view:ViewState;setView:(view:ViewState)=>void;imported:boolean;busy:boolean;onSource:(item:ResultItem)=>void;onSave?:()=>void;onEditCommute?:()=>void;saveDisabled?:boolean}) {
  const [presentation,setPresentation] = useState<'list'|'map'>('list');
  const [limit,setLimit] = useState(60);
  const [mapFilterError,setMapFilterError] = useState('');
  const detailsHeading = useRef<HTMLHeadingElement>(null);
  const selectedCardButton = useRef<HTMLButtonElement>(null);
  const listButton = useRef<HTMLButtonElement>(null);
  const listing = dataset.listings.find(l=>l.id === view.selectedId);
  const route = dataset.rows.find(r=>r.listingId === view.selectedId && r.listingVersion === listing?.version);
  const selected = listing && route ? {listing,route} : undefined;
  const activeFilters = activeFilterLabels(view);
  const stateMessage = datasetStateMessage(dataset);
  const successfulRows=dataset.rows.filter(row=>row.state==='SUCCESS');
  const hasCompleteWalking=dataset.definition.mode==='TRANSIT'&&successfulRows.length>0&&successfulRows.every(row=>row.walkingSeconds!==undefined);
  function applyBounds(bounds:ViewState['bounds']) {
    try {setView(validateViewState({...view,bounds,locality:bounds?undefined:view.locality}));setMapFilterError('');}
    catch {setMapFilterError('Draw a valid geographic area or choose an area in the housing filters.');}
  }
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
    <p className="result-destination">{modeLabels[dataset.definition.mode]} to <strong>{dataset.definition.destination.label}</strong></p>
    {stateMessage && <p className="notice">{stateMessage}</p>}
    {imported && <p>This snapshot keeps the original calculation and source observation times. Opening it does not check current availability or calculate fresh journeys.</p>}
    <details className="search-details"><summary>Search details</summary><DefinitionSummary definition={dataset.definition}/><p>Coverage: {dataset.coverage}. Search contains {dataset.counts.total} property records.</p><CountsSummary counts={dataset.counts}/>{dataset.counts.noRoute>0&&<p>No journey found means no suitable route was returned for these settings; it does not mean a zero-minute commute.</p>}<p>{dataset.attribution.join(' · ')}</p></details>
    <div className="results-toolbar"><p role="status" aria-live="polite">{busy?'Updating local view…':`${items.length} matching results`} · {activeFilters.length?`${activeFilters.length} active filters`:'No filters'}</p><Field label="Sort"><select value={view.sort} onChange={event=>setView(validateViewState({...view,sort:event.target.value as ViewState['sort']}))}>{FILTER_OPTIONS.sorts.filter(option=>!option.value.startsWith('WALKING')||hasCompleteWalking).map(option=><option key={option.value} value={option.value}>{option.label}</option>)}</select></Field></div>
    <div className="active-filter-toolbar">{activeFilters.length>0&&<ul className="active-filter-chips" aria-label="Active filters">{activeFilters.map(label=><li key={label}><button type="button" aria-label={'Remove '+label} onClick={()=>setView(removeActiveFilter(view,label))}>{label}<span aria-hidden="true">×</span></button></li>)}</ul>}<button type="button" className="clear-filters-button" onClick={()=>setView({sort:'COMMUTE_ASC',includeUnavailable:true,selectedId:view.selectedId})}>Clear all filters</button></div>
    <div className="actions" role="group" aria-label="Result presentation">
      <button ref={listButton} aria-pressed={presentation==='list'} onClick={()=>setPresentation('list')}>List</button>
      <button aria-pressed={presentation==='map'} onClick={()=>setPresentation('map')}>Map / coordinates</button>
      {onSave && <button disabled={saveDisabled||dataset.state!=='COMPLETE'||!dataset.exportAllowed} onClick={onSave}>Save results snapshot</button>}
      {onEditCommute && <button onClick={onEditCommute}>Edit commute</button>}
    </div>
    {!busy&&!items.length && <p>{emptyResultMessage(dataset,view,false)}</p>}
    {mapFilterError&&<p role="alert">{mapFilterError}</p>}
    {presentation==='map' && <SchematicMap dataset={dataset} items={items} selectedId={view.selectedId} onSelect={select} onBounds={applyBounds}/>}
    <div className="results-layout"><div>
      <ol className="result-list" aria-label="Property results">{items.slice(0,limit).map((item,index)=><li key={item.listing.id} className={`result-card ${view.selectedId===item.listing.id?'selected':''}`} data-motion-key={item.listing.id}>
        <h3><span>{index+1}. </span><button ref={view.selectedId===item.listing.id?selectedCardButton:undefined} className="text-button" onClick={()=>select(item.listing.id)} aria-pressed={view.selectedId===item.listing.id}>{item.listing.title}</button></h3>
        <p className="commute-result-summary">{commute(item.route)} · {modeLabels[dataset.definition.mode]}</p>
        <MeasuredJourney item={item} mode={dataset.definition.mode}/>
        <p className="result-rent">{money(item.listing)}{item.listing.rent.amount!==null&&<span className="muted"> · advertised rent</span>}</p>
        <p>{item.listing.rooms===null?'Rooms not stated':`${item.listing.rooms} rooms`} · {item.listing.bedrooms===null?'Bedrooms not stated':`${item.listing.bedrooms} bedrooms`} · {item.listing.floorArea===null?'Floor area not stated':`${item.listing.floorArea} m²`}</p>
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
      <p>{money(selected.listing)}{selected.listing.rent.amount!==null&&' · advertised rent'}</p>
      <p>Additional charges: {selected.listing.rent.charges===null?'Not stated':`CHF ${selected.listing.rent.charges.toLocaleString('en-CH')}/month`}</p>
      <p className="commute-result-summary">{commute(selected.route)} · {modeLabels[dataset.definition.mode]}</p>
      <MeasuredJourney item={selected} mode={dataset.definition.mode}/>
      <p>Calculated {dateLabel(selected.route.calculatedAt)}</p>
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
        {selected.route.transitModes!==undefined && <div><dt>Transit types in measured journey</dt><dd>{selected.route.transitModes.length?selected.route.transitModes.map(type=>transitLabels[type]).join(', '):'No transit leg'}</dd></div>}
      </dl>
      {dataset.definition.mode==='TRANSIT'&&<>
        {selected.route.walkingSeconds===undefined&&<p>Walking time was not measured for this result.</p>}
        {selected.route.transfers===undefined&&<p>Transfer count was not measured for this result.</p>}
        {selected.route.transitModes===undefined&&<p>Transit types were not measured for this result.</p>}
      </>}
      {selected.route.warnings.map((warning,i)=><p className="muted" key={i}>{warning}</p>)}
      <p>Source last observed: {dateLabel(selected.listing.lastSeenAt)}. Availability is not checked when you open these details.</p>
      <details><summary>Source and attribute evidence</summary><p>Location evidence: {selected.listing.location.provenance}</p><dl className="facts">{Object.entries(selected.listing.evidence).map(([key,value])=><div key={key}><dt>{facilityLabels[key as FacilityKey] ?? key.replace(/([a-z])([A-Z])/g,'$1 $2').replace(/_/g,' ')}</dt><dd>{value}</dd></div>)}</dl></details>
      <button onClick={()=>onSource(selected)}>Open original listing</button>
    </> : <p>Select a property card or coordinate marker to inspect its source facts and journey details.</p>}</aside></div>
  </Panel>;
}
