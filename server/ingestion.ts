import {createHash,randomUUID} from 'node:crypto';
import type {FeedResult,ListingProvider,ListingVersion,Source} from '../shared/contracts.ts';
import {listingSchema,isoTime,safeIdentifier} from '../shared/validation.ts';
import type {Repository} from './storage.ts';
function canonical(value:unknown):unknown {if(Array.isArray(value))return value.map(canonical);if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>[key,canonical(item)]));return value}
function contentVersion(l:ListingVersion){const {version,firstSeenAt,lastSeenAt,sourceUpdatedAt,ingestedAt,...content}=l;return createHash('sha256').update(JSON.stringify(canonical(content))).digest('hex').slice(0,24)}
export function reconcileFeed(previous:ListingVersion[],feed:FeedResult,source:Source,nowISO:string){
 isoTime.parse(nowISO);
 if(!source.enabled||!source.permissions.retrieval||!source.permissions.storage||!source.permissions.agreementReference.trim())throw new Error('Source retrieval and storage permissions are required.');
 if(!Array.isArray(feed.records)||feed.records.length>10000||typeof feed.complete!=='boolean'||!Array.isArray(feed.removedIds)||feed.removedIds.length>10000)throw new Error('Invalid feed envelope.');
 feed.removedIds.forEach(id=>safeIdentifier.parse(id));
 const old=new Map(previous.filter(l=>l.sourceId===source.id).map(l=>[l.sourceListingId,l]));
 const next=new Map(old);const seen=new Set<string>();const stableIds=new Map(previous.map(l=>[l.id,`${l.sourceId}:${l.sourceListingId}`]));let newCount=0,updatedCount=0,unchangedCount=0,inactiveCount=0;
 for(const raw of feed.records){
  const incoming=listingSchema.parse(raw);
  if(incoming.sourceId!==source.id||incoming.marketId!==source.marketId||!source.canonicalHosts.includes(new URL(incoming.sourceUrl).hostname))throw new Error('Source, market or URL mismatch.');
  if(seen.has(incoming.sourceListingId))throw new Error('Duplicate provider listing identifier.');seen.add(incoming.sourceListingId);
  const key=`${incoming.sourceId}:${incoming.sourceListingId}`,existing=stableIds.get(incoming.id);
  if(existing&&existing!==key)throw new Error('Stable listing identifier belongs to a different source record.');stableIds.set(incoming.id,key);
  const prior=old.get(incoming.sourceListingId);
  if(prior&&prior.id!==incoming.id)throw new Error('A source listing changed its stable identifier.');
  const normalized={...incoming,firstSeenAt:prior?.firstSeenAt??nowISO,lastSeenAt:nowISO,ingestedAt:nowISO};
  const version=contentVersion(normalized);
  if(prior&&contentVersion(prior)===version){unchangedCount++;continue}
  next.set(incoming.sourceListingId,{...normalized,version});if(prior)updatedCount++;else newCount++;
 }
 const removals=new Set(feed.removedIds);
 for(const [key,value]of next){
  if(seen.has(key)&&removals.has(key))throw new Error('Feed contains conflicting active and removed records.');
  if(value.active&&(removals.has(key)||(feed.complete&&!seen.has(key)))){
   const inactive:ListingVersion={...value,active:false,status:'INACTIVE',ingestedAt:nowISO};inactive.version=contentVersion(inactive);next.set(key,inactive);inactiveCount++;
  }
 }
 return {listings:[...next.values()],newCount,updatedCount,unchangedCount,inactiveCount};
}
export async function ingestSources(repository:Repository,providers:ListingProvider[]){
 const summaries=[];
 for(const provider of providers){
  const id=provider.source.id,lease=randomUUID(),now=Date.now();
  const configured=await repository.get<Source>('sources',id);
  if(configured&&!configured.enabled){summaries.push({sourceId:id,skipped:true,reason:'SOURCE_DISABLED'});continue;}
  await repository.transaction(async tx=>{const lock=await tx.get<{expiresAt:number}>('sourceLocks',id);if(lock&&lock.expiresAt>now)throw new Error(`Source ingestion already running: ${id}`);tx.put('sourceLocks',id,{id,lease,expiresAt:now+600000})});
  try{
   const feed=await provider.fetch(),at=new Date().toISOString();
   const all=await repository.query<ListingVersion>('listings');
   if(feed.records.some(l=>all.some(old=>old.id===l.id&&old.sourceId!==id)))throw new Error('Cross-source listing identifier collision.');
   const result=reconcileFeed(all,feed,provider.source,at);
   const changed=result.listings.filter(l=>all.find(x=>x.id===l.id)?.version!==l.version);
   for(let offset=0;offset<changed.length;offset+=100){
    await repository.transaction(async tx=>{const lock=await tx.get<{lease:string;expiresAt:number}>('sourceLocks',id);if(lock?.lease!==lease||lock.expiresAt<=Date.now())throw new Error('Ingestion lease expired; retry safely.');
     const currentSource=await tx.get<Source>('sources',id);if(currentSource&&!currentSource.enabled)throw new Error('Source disabled during ingestion.');
     for(const l of changed.slice(offset,offset+100)){const existing=await tx.get<ListingVersion>('listings',l.id);if(existing&&(existing.sourceId!==l.sourceId||existing.sourceListingId!==l.sourceListingId))throw new Error('Concurrent source identifier collision.');tx.put('listings',l.id,l);tx.put('listingVersions',`${l.id}__${l.version}`,l)}
    });
   }
   // Keep ingestion observations separate: unchanged content/version documents are not rewritten.
   for(let offset=0;offset<feed.records.length;offset+=100){
    await repository.transaction(async tx=>{const lock=await tx.get<{lease:string;expiresAt:number}>('sourceLocks',id);if(lock?.lease!==lease||lock.expiresAt<=Date.now())throw new Error('Ingestion lease expired; retry safely.');
     const currentSource=await tx.get<Source>('sources',id);if(currentSource&&!currentSource.enabled)throw new Error('Source disabled during ingestion.');
     for(const l of feed.records.slice(offset,offset+100))tx.put('listingObservations',l.id,{id:l.id,sourceId:id,lastSeenAt:at,sourceUpdatedAt:l.sourceUpdatedAt,ingestedAt:at});
    });
   }
   const {listings,...summary}=result;
   await repository.transaction(async tx=>{const lock=await tx.get<{lease:string;expiresAt:number}>('sourceLocks',id);if(lock?.lease!==lease||lock.expiresAt<=Date.now())throw new Error('Ingestion lease lost.');const currentSource=await tx.get<Source>('sources',id);if(currentSource&&!currentSource.enabled)throw new Error('Source disabled during ingestion.');tx.put('sources',id,provider.source);tx.put('sourceHealth',id,{id,...summary,complete:feed.complete,observedAt:at,recordCount:feed.records.length});tx.delete('sourceLocks',id)});
   summaries.push({sourceId:id,...summary,complete:feed.complete});
  }catch(error){
   await repository.transaction(async tx=>{const lock=await tx.get<{lease:string}>('sourceLocks',id);if(lock?.lease===lease){tx.delete('sourceLocks',id);tx.put('sourceHealth',id,{id,complete:false,observedAt:new Date().toISOString(),error:'INGESTION_FAILED'})}});
   throw error;
  }
 }
 return summaries;
}
