import type {RouteProvider,LocationResolver,ListingProvider,ListingVersion,RouteDefinition,RouteRow} from '../../shared/contracts.ts';
import {demoDestinations,demoListings,demoSources} from '../../shared/fixtures.ts';
import {assertSupportedDefinition} from '../../shared/validation.ts';
export class SyntheticRouteProvider implements RouteProvider {
 id='synthetic';version='synthetic-v1';maxBatchSize=6;
 async route(listings:ListingVersion[],definition:RouteDefinition):Promise<RouteRow[]>{
  assertSupportedDefinition(definition);
  return listings.map(l=>{
   const base={listingId:l.id,listingVersion:l.version,provider:this.id,calculatedAt:new Date().toISOString(),warnings:['Synthetic test journey; not travel advice.',...(l.location.precision!=='EXACT'?['Origin is approximate.']:[])]};
   if(!l.location.point)return {...base,state:'UNRESOLVED_ORIGIN'};
   if(l.id==='demo-23')return {...base,state:'UNRESOLVED_ORIGIN'};
   if(l.id==='demo-24')return {...base,state:'NO_ROUTE'};
   const a=l.location.point,b=definition.destination.point!;
   const meters=Math.round(Math.hypot((a.lat-b.lat)*111000,(a.lng-b.lng)*76000)*1.25);
   const speed={WALK:1.3,BICYCLE:4.5,DRIVE:9,TRANSIT:6}[definition.mode];
   const preference=definition.transitPreference==='FEWER_TRANSFERS'?90:definition.transitPreference==='LESS_WALKING'?60:0;
   return {...base,state:'SUCCESS',durationSeconds:Math.max(60,Math.round(meters/speed)+(definition.mode==='TRANSIT'?420:0)+preference),distanceMeters:meters};
  });
 }
}
export class SyntheticLocationResolver implements LocationResolver {async search(query:string){const q=query.toLowerCase().trim();return structuredClone(demoDestinations.filter(d=>(d.label+' '+d.locality+' '+d.context).toLowerCase().includes(q)))}}
export class SyntheticListingProvider implements ListingProvider {source=structuredClone(demoSources[0]);async fetch(){return {records:structuredClone(demoListings),complete:true,removedIds:[]}}}
