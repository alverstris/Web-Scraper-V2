import type {RouteProvider,ListingVersion,RouteDefinition,RouteRow,LocationResolver,Destination} from '../../shared/contracts.ts';
import {assertSupportedDefinition,destinationSchema,listingSchema,isoTime,safeText} from '../../shared/validation.ts';
export interface GooglePermission { agreementReference:string; storageApproved:boolean; locationStorageApproved:boolean; expiresAt:string }
export function requirePermission(rights:GooglePermission,location=false){
 if(!safeText.safeParse(rights.agreementReference).success||!rights.agreementReference.trim()||rights.storageApproved!==true||(location&&rights.locationStorageApproved!==true)||!isoTime.safeParse(rights.expiresAt).success||Date.parse(rights.expiresAt)<=Date.now())throw new Error('Google data permission is missing, expired or insufficient.');
}
/** Not enabled by the default composition. Requires a reviewed agreement and bounded live validation. */
export class GoogleRouteProvider implements RouteProvider {
 id='google';version='google-matrix-v1';maxBatchSize=100;
 constructor(private key:string,private rights:GooglePermission,private http:typeof fetch=fetch){}
 async route(listings:ListingVersion[],definition:RouteDefinition):Promise<RouteRow[]>{
  requirePermission(this.rights); assertSupportedDefinition(definition);
  if(!this.key)throw new Error('Google Routes server key is missing.');
  if(listings.length>this.maxBatchSize)throw new Error('Matrix batch exceeds 100 elements.');
  if(definition.provider!==this.id)throw new Error('Route definition provider does not match this adapter.');
  listings.forEach(l=>listingSchema.parse(l));
  if(new Set(listings.map(l=>l.id)).size!==listings.length)throw new Error('Duplicate listing identifiers in routing batch.');
  const at=Date.parse(definition.timeBasis.at),now=Date.now();
  if(definition.mode==='TRANSIT'&&(at<now-7*864e5||at>now+100*864e5))throw new Error('Transit time must be within the provider planning window.');
  if(definition.mode!=='TRANSIT'&&at<now)throw new Error('Use a future departure time for this mode.');
  const valid=listings.filter(l=>l.location.point&&l.location.precision!=='UNRESOLVED');
  const calculatedAt=new Date().toISOString();
  const base=(l:ListingVersion)=>({listingId:l.id,listingVersion:l.version,provider:this.id,calculatedAt,warnings:l.location.precision==='EXACT'?[]:['Approximate origin; duration is approximate.']});
  const rows=new Map<string,RouteRow>(listings.filter(l=>!valid.includes(l)).map(l=>[l.id,{...base(l),state:'UNRESOLVED_ORIGIN'}]));
  if(!valid.length)return listings.map(l=>rows.get(l.id)!);
  const waypoint=(p:{lat:number;lng:number})=>({location:{latLng:{latitude:p.lat,longitude:p.lng}}});
  const body:Record<string,unknown>={origins:valid.map(l=>({waypoint:waypoint(l.location.point!)})),destinations:[{waypoint:waypoint(definition.destination.point!)}],travelMode:definition.mode,languageCode:'en',units:'METRIC',[definition.timeBasis.kind==='ARRIVAL'?'arrivalTime':'departureTime']:definition.timeBasis.at};
  if(definition.mode==='DRIVE')body.routingPreference='TRAFFIC_AWARE';
  if(definition.mode==='TRANSIT')body.transitPreferences={...(definition.transitPreference==='DEFAULT'?{}:{routingPreference:definition.transitPreference}),...(definition.preferredTransitModes.length?{allowedTravelModes:definition.preferredTransitModes}:{})};
  const response=await this.http('https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix',{method:'POST',headers:{'Content-Type':'application/json','X-Goog-Api-Key':this.key,'X-Goog-FieldMask':'originIndex,destinationIndex,status,condition,duration,distanceMeters,fallbackInfo'},body:JSON.stringify(body),signal:AbortSignal.timeout(30000),redirect:'error'});
  if(!response.ok)throw new Error(`ROUTING_PROVIDER_HTTP_${response.status}`);
  const elements:unknown=await response.json();
  if(!Array.isArray(elements))throw new Error('Invalid matrix response.');
  const seen=new Set<number>();
  for(const raw of elements){
   if(!raw||typeof raw!=='object')throw new Error('Invalid matrix element.');
   const e=raw as Record<string,any>,i=e.originIndex??0,j=e.destinationIndex??0;
   if(!Number.isInteger(i)||i<0||i>=valid.length||j!==0||seen.has(i))throw new Error('Invalid or duplicate matrix indices.');seen.add(i);
   const l=valid[i],row:RouteRow={...base(l),state:'PROVIDER_ERROR'};
   const statusValid=e.status===undefined||(e.status!==null&&typeof e.status==='object'&&!Array.isArray(e.status)&&(e.status.code===undefined||Number.isInteger(e.status.code)));
   if(!statusValid)row.warnings.push('Provider returned an invalid element status.');
   else if(e.status?.code&&e.status.code!==0)row.warnings.push('Provider could not calculate this journey.');
   else if(e.condition==='ROUTE_NOT_FOUND')row.state='NO_ROUTE';
   else if(e.condition==='ROUTE_EXISTS'&&typeof e.duration==='string'&&/^\d+(?:\.\d{1,9})?s$/.test(e.duration)&&Number.isFinite(Number(e.duration.slice(0,-1)))&&Number(e.duration.slice(0,-1))<=315576000000){
    row.state='SUCCESS';row.durationSeconds=Number(e.duration.slice(0,-1));
    if(Number.isSafeInteger(e.distanceMeters)&&e.distanceMeters>=0)row.distanceMeters=e.distanceMeters;
    if(e.fallbackInfo)row.warnings.push('Provider used a fallback computation. Requested preferences are not guaranteed.');
    if(definition.preferredTransitModes.length)row.warnings.push('Transit types are preferences, not guaranteed exclusions.');
   }else row.warnings.push('Provider returned incomplete route information.');
   rows.set(l.id,row);
  }
  for(const l of valid)if(!rows.has(l.id))rows.set(l.id,{...base(l),state:'PROVIDER_ERROR',warnings:['Provider omitted this matrix element.']});
  return listings.map(l=>rows.get(l.id)!);
 }
}
/** Geocoding candidates must still be explicitly confirmed by the user. */
export class GoogleLocationResolver implements LocationResolver {
 constructor(private key:string,private rights:GooglePermission,private http:typeof fetch=fetch){}
 async search(query:string):Promise<Destination[]>{
  requirePermission(this.rights,true);if(!this.key)throw new Error('Google geocoding server key is missing.');
  if(!safeText.safeParse(query).success||query.trim().length<3||query.length>300)throw new Error('Use between 3 and 300 plain-text characters.');
  const url=new URL('https://maps.googleapis.com/maps/api/geocode/json');url.searchParams.set('address',query);url.searchParams.set('key',this.key);
  const response=await this.http(url,{redirect:'error',signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw new Error(`LOCATION_PROVIDER_HTTP_${response.status}`);
  const data=await response.json() as {status:string;results?:any[]};
  if(data.status==='ZERO_RESULTS')return [];if(data.status!=='OK'||!Array.isArray(data.results))throw new Error('Location provider unavailable.');
  return data.results.slice(0,8).map(r=>{
   const p=r.geometry?.location;if(!p||!Number.isFinite(p.lat)||!Number.isFinite(p.lng)||!r.place_id)throw new Error('Malformed location provider response.');
   const component=(type:string)=>r.address_components?.find((c:any)=>c.types?.includes(type));
   const precision=r.geometry.location_type==='ROOFTOP'?'EXACT':r.geometry.location_type==='RANGE_INTERPOLATED'?'STREET':'LOCALITY';
   return destinationSchema.parse({id:r.place_id,label:r.formatted_address,point:{lat:p.lat,lng:p.lng},precision,country:component('country')?.short_name,locality:component('locality')?.long_name??component('postal_town')?.long_name??'',context:'Confirm the intended point or entrance. Geocoding does not verify entrance access.',provenance:`Google Geocoding; ${this.rights.agreementReference}`});
  });
 }
}
