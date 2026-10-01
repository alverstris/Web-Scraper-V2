import type {ListingVersion,Source} from '../shared/contracts.ts';
import type {Partner} from '../shared/commercial.ts';
import {safeUrl} from '../shared/validation.ts';
/** Only a listing identity enters a referral. No route, account, evidence or view data is accepted. */
export function resolveOutbound(listing:ListingVersion,source:Source,partner?:Partner,now=Date.now()):{url:string;disclosure?:string}{
 const original=safeUrl.parse(listing.sourceUrl),canonical=new URL(original);
 if(source.id!==listing.sourceId||!source.canonicalHosts.includes(canonical.hostname))throw new Error('Unapproved original listing URL.');
 if(!partner?.enabled||partner.sourceId!==source.id||!partner.referral||!partner.agreementReference.trim()||!Number.isFinite(Date.parse(partner.expiresAt))||Date.parse(partner.expiresAt)<=now)return {url:original};
 try{
  const url=new URL(safeUrl.parse(partner.referral.baseUrl));
  if(!partner.allowedHosts.includes(url.hostname)||!/^[a-zA-Z0-9_-]{1,50}$/.test(partner.referral.listingParameter))return {url:original};
  url.search='';
  for(const [key,value]of Object.entries(partner.referral.fixedParameters)){
   if(!/^[a-zA-Z0-9_-]{1,50}$/.test(key)||value.length>300)throw new Error('Invalid partner parameter.');url.searchParams.set(key,value);
  }
  url.searchParams.set(partner.referral.listingParameter,listing.sourceListingId);
  return {url:url.href,disclosure:partner.disclosure};
 }catch{return {url:original}}
}
