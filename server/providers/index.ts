import {SyntheticRouteProvider,SyntheticLocationResolver,SyntheticListingProvider} from './synthetic.ts';
import {GoogleRouteProvider,GoogleLocationResolver,requirePermission} from './google.ts';
import {AuthorizedJsonFeed} from './authorized-feed.ts';
import {readFileSync,statSync} from 'node:fs';
import {z} from 'zod';
import {safeText,safeIdentifier,isoTime,safeUrl,isPublicHostname} from '../../shared/validation.ts';
const sourceSchema=z.object({
 id:safeIdentifier,name:safeText.min(1),canonicalHosts:z.array(z.string().refine(isPublicHostname,'Only public DNS hostnames are permitted')).min(1).max(20),enabled:z.literal(true),synthetic:z.literal(false),marketId:safeIdentifier,attribution:safeText.min(1),
 permissions:z.object({retrieval:z.literal(true),storage:z.literal(true),export:z.boolean(),descriptions:z.boolean(),images:z.boolean(),agreementReference:safeText.trim().min(1),reviewedAt:isoTime}).strict()
}).strict();
export const providerConfigurationSchema=z.object({
 schemaVersion:z.literal(1),
 google:z.object({agreementReference:safeText.trim().min(1),storageApproved:z.literal(true),locationStorageApproved:z.literal(true),expiresAt:isoTime}).strict(),
 feeds:z.array(z.object({source:sourceSchema,endpoint:safeUrl,tokenEnvName:z.string().regex(/^[A-Z][A-Z0-9_]{1,100}$/).optional()}).strict()).min(1).max(20)
}).strict().superRefine((configuration,ctx)=>{
 const ids=new Set<string>();
 configuration.feeds.forEach((feed,index)=>{
  if(ids.has(feed.source.id))ctx.addIssue({code:'custom',path:['feeds',index,'source','id'],message:'Provider IDs must be unique.'});ids.add(feed.source.id);
  if(!feed.source.canonicalHosts.includes(new URL(feed.endpoint).hostname))ctx.addIssue({code:'custom',path:['feeds',index,'endpoint'],message:'Endpoint hostname must appear in the source allowlist.'});
  if(Date.parse(feed.source.permissions.reviewedAt)>Date.now())ctx.addIssue({code:'custom',path:['feeds',index,'source','permissions','reviewedAt'],message:'Permission review cannot be in the future.'});
 });
});
export function createProviders(mode:'demo'|'live',environment:Record<string,string|undefined>=process.env) {
 if(mode==='demo')return {route:new SyntheticRouteProvider(),location:new SyntheticLocationResolver(),listings:[new SyntheticListingProvider()]};
 const path=environment.PROVIDER_CONFIG_PATH,key=environment.GOOGLE_MAPS_SERVER_KEY;
 if(!path||!key?.trim())throw new Error('LIVE_PROVIDERS_UNAVAILABLE: PROVIDER_CONFIG_PATH and GOOGLE_MAPS_SERVER_KEY are required; approved listing supply, location rights and storage rights must be configured.');
 if(statSync(path).size>100000)throw new Error('Provider configuration exceeds size limit.');
 const configuration=providerConfigurationSchema.parse(JSON.parse(readFileSync(path,'utf8')));
 requirePermission(configuration.google,true);
 const listings=configuration.feeds.map(feed=>{
  const token=feed.tokenEnvName?environment[feed.tokenEnvName]:undefined;
  if(feed.tokenEnvName&&!token?.trim())throw new Error(`Configured feed secret is missing: ${feed.tokenEnvName}`);
  return new AuthorizedJsonFeed(feed.source,feed.endpoint,token);
 });
 return {route:new GoogleRouteProvider(key,configuration.google),location:new GoogleLocationResolver(key,configuration.google),listings};
}
