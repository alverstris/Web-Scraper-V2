import { z } from 'zod';
import type {CreateRunRequest, RouteDefinition} from './contracts.ts';
export const safeText = z.string().max(2000).refine(s=>!/[<>\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(s),'Text must not contain markup or control characters');
export const safeIdentifier=safeText.min(1).max(200).refine(s=>!/[\\/]/.test(s)&&s!=='.'&&s!=='..','Identifiers must be a single path segment');
export const isoTime = z.string().datetime({offset:true});
export const pointSchema = z.object({lat:z.number().finite().min(-90).max(90),lng:z.number().finite().min(-180).max(180)}).strict();
// DNS names only. Reject IP literals, local names and URL parser normalization tricks.
export function isPublicHostname(host:string){return host===host.toLowerCase()&&host.length<=253&&/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]*$/.test(host)&&!/(?:^|\.)(?:localhost|local|internal|intranet|test|invalid)$/.test(host)&&!host.endsWith('.home.arpa')}
export const safeUrl = z.string().url().max(2048).refine(s=>{try{const u=new URL(s);return u.protocol==='https:'&&!u.username&&!u.password&&!u.hash&&!/[<>\s\\]/.test(s)&&isPublicHostname(u.hostname)}catch{return false}},'Only public HTTPS URLs with DNS hostnames are allowed');
const locationShape={point:pointSchema.optional(),label:safeText,precision:z.enum(['EXACT','BUILDING','STREET','LOCALITY','UNRESOLVED']),provenance:safeText};
export const destinationSchema=z.object({...locationShape,id:safeText.min(1),country:z.string().length(2),locality:safeText,context:safeText}).strict();
const numberOrUnknown=z.number().finite().min(0).max(1e9).nullable();
const facility=z.enum(['PRIVATE','SHARED','ABSENT','UNKNOWN','REVIEW']);
export const listingSchema=z.object({
  id:safeIdentifier,sourceId:safeIdentifier,sourceListingId:safeIdentifier,version:safeIdentifier,marketId:safeIdentifier,sourceUrl:safeUrl,title:safeText,
  location:z.object(locationShape).strict(),active:z.boolean(),status:z.enum(['ROUTABLE','APPROXIMATE','UNRESOLVED','INACTIVE']),
  rent:z.object({amount:numberOrUnknown,currency:z.string().regex(/^[A-Z]{3}$/),period:z.enum(['MONTH','WEEK']),charges:numberOrUnknown}).strict(),
  propertyType:safeText,floorArea:numberOrUnknown,rooms:numberOrUnknown,bedrooms:numberOrUnknown,bathrooms:numberOrUnknown,
  furnishing:z.enum(['FURNISHED','UNFURNISHED','PARTIAL','UNKNOWN']),
  facilities:z.object({washingMachine:facility,dryer:facility,kitchen:facility,dishwasher:facility,airConditioning:facility,balcony:facility,parking:facility}).strict(),
  evidence:z.record(z.string().max(100),safeText),extractionVersion:safeText,firstSeenAt:isoTime,lastSeenAt:isoTime,sourceUpdatedAt:isoTime.nullable(),ingestedAt:isoTime
}).strict().superRefine((l,ctx)=>{
  const resolved=!!l.location.point&&l.location.precision!=='UNRESOLVED';
  const expected=!l.active?'INACTIVE':!resolved?'UNRESOLVED':l.location.precision==='EXACT'?'ROUTABLE':'APPROXIMATE';
  if(l.status!==expected)ctx.addIssue({code:'custom',path:['status'],message:'Listing status must match activity, location precision and coordinates.'});
  if(l.location.precision==='UNRESOLVED'&&l.location.point)ctx.addIssue({code:'custom',path:['location'],message:'Unresolved locations must not claim coordinates.'});
});
export const commuteSettingsSchema=z.object({direction:z.literal('HOME_TO_DESTINATION'),mode:z.enum(['WALK','BICYCLE','DRIVE','TRANSIT']),transitPreference:z.enum(['DEFAULT','LESS_WALKING','FEWER_TRANSFERS']),preferredTransitModes:z.array(z.enum(['BUS','SUBWAY','TRAIN','LIGHT_RAIL','RAIL'])).max(5),timeBasis:z.object({kind:z.enum(['DEPARTURE','ARRIVAL']),at:isoTime,timezone:z.string().min(1).max(80).refine(s=>{try{new Intl.DateTimeFormat('en',{timeZone:s});return true}catch{return false}},'Unknown timezone')}).strict()}).strict();
export const routeDefinitionSchema=commuteSettingsSchema.extend({destination:destinationSchema,provider:z.enum(['synthetic','google']),adapterVersion:safeText.min(1)}).strict();
export const createRunSchema=z.object({idempotencyKey:z.string().regex(/^[a-zA-Z0-9_-]{8,100}$/),destinationSelectionId:z.string().min(1).max(200),marketId:z.string().min(1).max(100),searchScope:z.literal('STANDARD'),routeDefinition:commuteSettingsSchema,verificationChallenge:z.string().max(2048).optional()}).strict();
export function assertSupportedDefinition(d:RouteDefinition){
  routeDefinitionSchema.parse(d);
  if(!d.destination.point||d.destination.precision==='UNRESOLVED')throw new Error('Confirm a resolved destination point.');
  if(d.mode!=='TRANSIT'&&(d.transitPreference!=='DEFAULT'||d.preferredTransitModes.length>0))throw new Error('Transit preferences require public transport.');
  if(d.mode!=='TRANSIT'&&d.timeBasis.kind==='ARRIVAL')throw new Error('Arrival-time routing is only supported for public transport.');
  if(new Set(d.preferredTransitModes).size!==d.preferredTransitModes.length)throw new Error('Transit mode preferences must be unique.');
}
export function validateCreateRun(input:unknown):CreateRunRequest{return createRunSchema.parse(input)}
