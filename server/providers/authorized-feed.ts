import type {ListingProvider,Source,FeedResult} from '../../shared/contracts.ts';
import {lookup} from 'node:dns/promises';
import {request} from 'node:https';
import {listingSchema,safeUrl,safeIdentifier} from '../../shared/validation.ts';
const maxFeedBytes=10_000_000;
export function isPublicIPv4(address:string){
 const parts=address.split('.').map(Number);if(parts.length!==4||parts.some(x=>!Number.isInteger(x)||x<0||x>255))return false;
 const [a,b,c]=parts;
 return !(a===0||a===10||a===127||a>=224||(a===100&&b>=64&&b<=127)||(a===169&&b===254)||(a===172&&b>=16&&b<=31)||(a===192&&(b===168||b===0||b===88))||(a===198&&(b===18||b===19||(b===51&&c===100)))||(a===203&&b===0&&c===113));
}
// Resolve once and connect to the checked address, retaining hostname TLS verification.
// The initial adapter deliberately supports public IPv4 feeds only; no redirect following.
const publicFeedFetch:typeof fetch=async(input,init)=>{
 const url=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url);safeUrl.parse(url.href);
 const addresses=await lookup(url.hostname,{family:4,all:true});
 if(!addresses.length||addresses.some(value=>!isPublicIPv4(value.address)))throw new Error('Feed DNS must resolve exclusively to public IPv4 addresses.');
 return new Promise<Response>((resolve,reject)=>{
  const headers=Object.fromEntries(new Headers(init?.headers).entries());headers.host=url.host;
  const req=request({protocol:'https:',hostname:addresses[0].address,servername:url.hostname,port:url.port||443,path:url.pathname+url.search,method:'GET',headers,signal:init?.signal??undefined},response=>{
   const chunks:Buffer[]=[];let size=0;
   response.on('data',(chunk:Buffer)=>{size+=chunk.length;if(size>maxFeedBytes){response.destroy(new Error('Feed exceeds size limit.'));return}chunks.push(chunk)});
   response.on('error',reject);
   response.on('end',()=>{const resultHeaders=new Headers();for(const [name,value]of Object.entries(response.headers))if(value!==undefined)resultHeaders.set(name,Array.isArray(value)?value.join(', '):value);
    const status=response.statusCode??502;resolve(new Response([204,205,304].includes(status)?null:Buffer.concat(chunks),{status,headers:resultHeaders}));
   });
  });req.on('error',reject);req.end();
 });
};
/** Connector contract for an operator-configured, authorised normalized JSON feed. No scraping. */
export class AuthorizedJsonFeed implements ListingProvider {
 constructor(public source:Source,private endpoint:string,private token:string|undefined,private http:typeof fetch=publicFeedFetch){}
 async fetch():Promise<FeedResult>{
  if(!this.source.enabled||!this.source.permissions.retrieval||!this.source.permissions.storage||!this.source.permissions.agreementReference.trim())throw new Error('FEED_PERMISSION_REQUIRED');
  const u=new URL(safeUrl.parse(this.endpoint));
  if(!this.source.canonicalHosts.includes(u.hostname))throw new Error('Feed endpoint is not approved.');
  const response=await this.http(u,{headers:this.token?{Authorization:`Bearer ${this.token}`}:{},redirect:'error',signal:AbortSignal.timeout(30000)});
  if(!response.ok)throw new Error(`FEED_HTTP_${response.status}`);
  if(Number(response.headers.get('content-length'))>maxFeedBytes){await response.body?.cancel();throw new Error('Feed exceeds size limit.')}
  const reader=response.body?.getReader();if(!reader)throw new Error('Empty feed.');
  const chunks:Uint8Array[]=[];let total=0;
  while(true){const {done,value}=await reader.read();if(done)break;total+=value.length;if(total>maxFeedBytes){await reader.cancel();throw new Error('Feed exceeds size limit.')}chunks.push(value)}
  const body=JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(key=>!['records','complete','removedIds'].includes(key))||!Array.isArray(body.records)||body.records.length>10000||typeof body.complete!=='boolean'||!Array.isArray(body.removedIds)||body.removedIds.length>10000)throw new Error('Invalid feed envelope.');
  const records=body.records.map((x:unknown)=>listingSchema.parse(x));
  if(records.some((l:any)=>l.sourceId!==this.source.id||l.marketId!==this.source.marketId||!this.source.canonicalHosts.includes(new URL(l.sourceUrl).hostname)))throw new Error('Feed contains unapproved source records.');
  body.removedIds.forEach((x:unknown)=>safeIdentifier.parse(x));
  return {records,complete:body.complete,removedIds:body.removedIds};
 }
}
