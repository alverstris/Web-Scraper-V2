import type {RouteProvider,LocationResolver,ListingProvider,ListingVersion,RouteDefinition,RouteRow,TransitMode} from '../../shared/contracts.ts';
import {DEMO_ROUTE_VERSION,demoDestinations,demoListings,demoSources} from '../../shared/fixtures.ts';
import {assertSupportedDefinition} from '../../shared/validation.ts';
export class SyntheticRouteProvider implements RouteProvider {
 id='synthetic';version=DEMO_ROUTE_VERSION;maxBatchSize=6;
 async route(listings:ListingVersion[],definition:RouteDefinition):Promise<RouteRow[]>{
  assertSupportedDefinition(definition);
  if(definition.provider!==this.id||!['synthetic-v1','synthetic-v2',this.version].includes(definition.adapterVersion))throw new Error('Unsupported synthetic route adapter version.');
  const legacy=definition.adapterVersion==='synthetic-v1',previousSimulation=definition.adapterVersion==='synthetic-v2';
  return listings.map(l=>{
   const base={listingId:l.id,listingVersion:l.version,provider:this.id,calculatedAt:new Date().toISOString(),warnings:[legacy?'Synthetic test journey; not travel advice.':'Explicitly simulated journey, walking, transfers and transit types; not travel advice.',...(l.location.precision!=='EXACT'?['Origin is approximate.']:[])]};
   if(!l.location.point)return {...base,state:'UNRESOLVED_ORIGIN'};
   if(l.id==='demo-23')return {...base,state:'UNRESOLVED_ORIGIN'};
   if(l.id==='demo-24')return {...base,state:'NO_ROUTE'};
   const a=l.location.point,b=definition.destination.point!;
   const meters=Math.round(Math.hypot((a.lat-b.lat)*111000,(a.lng-b.lng)*76000)*1.25);
   const speed={WALK:1.3,BICYCLE:4.5,DRIVE:9,TRANSIT:6}[definition.mode];
   // Pending runs keep their frozen calculation algorithm after the demo is upgraded.
   if(legacy){
    const preference=definition.transitPreference==='FEWER_TRANSFERS'?90:definition.transitPreference==='LESS_WALKING'?60:0;
    return {...base,state:'SUCCESS',durationSeconds:Math.max(60,Math.round(meters/speed)+(definition.mode==='TRANSIT'?420:0)+preference),distanceMeters:meters};
   }
   const fixtureIndex=Math.max(0,Number(l.sourceListingId)-1)||0;
   if(definition.mode==='TRANSIT') {
    // Broad deterministic fixture coverage is intentional; these are never real timetables.
    const destinationOffset=definition.destination.id==='epfl-west'?90:definition.destination.id==='unil-dorigny'?150:0;
    const preference=definition.transitPreference==='FEWER_TRANSFERS'?120:definition.transitPreference==='LESS_WALKING'?60:0;
    const durationSeconds=300+((fixtureIndex*7+1)%23)*150+destinationOffset+preference;
    const walkingSeconds=Math.min(previousSimulation?durationSeconds:durationSeconds*.4,(2+(fixtureIndex*3)%17)*60)*(definition.transitPreference==='LESS_WALKING'?0.5:1);
    const transfers=definition.transitPreference==='FEWER_TRANSFERS'?0:previousSimulation?fixtureIndex%4:Math.min(fixtureIndex%4,Math.floor(durationSeconds/900));
    const choices:TransitMode[][]=[['BUS'],['SUBWAY'],['TRAIN'],['LIGHT_RAIL'],['RAIL'],['BUS','SUBWAY'],['TRAIN','BUS']];
    const transitModes=choices[fixtureIndex%choices.length];
    return {...base,state:'SUCCESS',durationSeconds,distanceMeters:meters,walkingSeconds,transfers,transitModes:[...transitModes]};
   }
   return {...base,state:'SUCCESS',durationSeconds:Math.max(60,Math.round(meters/speed)),distanceMeters:meters};
  });
 }
}
export class SyntheticLocationResolver implements LocationResolver {async search(query:string){const q=query.toLowerCase().trim();return structuredClone(demoDestinations.filter(d=>(d.label+' '+d.locality+' '+d.context).toLowerCase().includes(q)))}}
export class SyntheticListingProvider implements ListingProvider {source=structuredClone(demoSources[0]);async fetch(){return {records:structuredClone(demoListings),complete:true,removedIds:[]}}}
