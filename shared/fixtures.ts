import type {Destination, ListingVersion, Source} from './contracts.ts';
export const demoMarkets=[{id:'ch-vaud-demo',label:'Vaud demonstration',coverage:'24 synthetic rental listings around Lausanne. Not a live housing feed.'}];
export const demoDestinations:Destination[]=[
 {id:'epfl-east',label:'EPFL — east entrance (demo)',point:{lat:46.5191,lng:6.5683},precision:'EXACT',country:'CH',locality:'Ecublens',context:'East pedestrian entrance; confirm this exact point.',provenance:'Synthetic destination fixture'},
 {id:'epfl-west',label:'EPFL — west entrance (demo)',point:{lat:46.5192,lng:6.5621},precision:'EXACT',country:'CH',locality:'Ecublens',context:'West pedestrian entrance; separate from the east entrance.',provenance:'Synthetic destination fixture'},
 {id:'unil-dorigny',label:'UNIL — Dorigny (demo)',point:{lat:46.5224,lng:6.5808},precision:'EXACT',country:'CH',locality:'Lausanne',context:'Illustrative campus arrival point.',provenance:'Synthetic destination fixture'},
 {id:'lausanne-station',label:'Lausanne station (demo)',point:{lat:46.5167,lng:6.6291},precision:'EXACT',country:'CH',locality:'Lausanne',context:'Illustrative station entrance.',provenance:'Synthetic destination fixture'}
];
export const demoSources:Source[]=[{id:'synthetic-rentals',name:'Synthetic rental fixtures',canonicalHosts:['example.com'],enabled:true,synthetic:true,marketId:'ch-vaud-demo',attribution:'All listings and journey estimates are synthetic test data.',permissions:{retrieval:true,storage:true,export:true,descriptions:true,images:false,agreementReference:'Internally generated test fixtures; no external listing content.',reviewedAt:'2026-09-30T12:00:00Z'}}];
const places=['Ecublens','Renens','Prilly','Lausanne','Chavannes','Bussigny'];
// Invented names distinguish fixture cards without implying real advertisements.
const propertyNames=['Maple','Linden','Juniper','Birch','Willow','Cedar','Alder','Elm','Rowan','Hazel','Aspen','Oak','Laurel','Beech','Pine','Spruce','Olive','Chestnut','Magnolia','Poplar','Ash','Walnut','Fir','Acacia'];
export const demoListings:ListingVersion[]=Array.from({length:24},(_,i)=>{
 const n=i+1,unknown=i%6===0,locality=places[i%places.length];
 return {id:`demo-${n}`,sourceId:'synthetic-rentals',sourceListingId:`${n}`,version:'fixture-v2',marketId:'ch-vaud-demo',sourceUrl:`https://example.com/rentals/${n}`,title:`${propertyNames[i]} ${i%3===0?'studio':'apartment'} in ${locality}`,
 location:{label:`${locality} · ${i===22?'location not confirmed':i%7===0?'illustrative locality':'fictional property location'}`,precision:i===22?'UNRESOLVED':i%7===0?'LOCALITY':'EXACT',...(i===22?{}:{point:{lat:46.513+(i%6)*.006,lng:6.55+Math.floor(i/6)*.022}}),provenance:'Synthetic coordinates; not a real property address'},
 active:true,status:i===22?'UNRESOLVED':i%7===0?'APPROXIMATE':'ROUTABLE',rent:{amount:650+i*75,currency:'CHF',period:'MONTH',charges:unknown?null:100},propertyType:i%3===0?'STUDIO':'APARTMENT',floorArea:unknown?null:22+i*3,rooms:i%3===0?1:2.5,bedrooms:unknown?null:i%3===0?0:2,bathrooms:unknown?null:1,furnishing:unknown?'UNKNOWN':i%2===0?'FURNISHED':'UNFURNISHED',
 facilities:{washingMachine:i%3===0?'SHARED':unknown?'UNKNOWN':'PRIVATE',dryer:'SHARED',kitchen:'PRIVATE',dishwasher:unknown?'UNKNOWN':'ABSENT',airConditioning:'UNKNOWN',balcony:i%2===0?'PRIVATE':'ABSENT',parking:'UNKNOWN'},evidence:{rooms:'Synthetic structured rooms field. Not a bedroom count.',washingMachine:'Synthetic structured facility field.'},extractionVersion:'structured-v1',firstSeenAt:'2026-09-30T10:00:00Z',lastSeenAt:'2026-09-30T10:00:00Z',sourceUpdatedAt:null,ingestedAt:'2026-09-30T10:00:00Z'};
});
