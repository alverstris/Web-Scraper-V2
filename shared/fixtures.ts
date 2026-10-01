import type {Destination, Facility, ListingVersion, Mode, Source} from './contracts.ts';
export const DEMO_FIXTURE_VERSION = 'fixture-v3';
export const DEMO_ROUTE_VERSION = 'synthetic-v3';
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
const propertyTypes:ListingVersion['propertyType'][]=['STUDIO','APARTMENT','APARTMENT','STUDIO','HOUSE','ROOM','UNKNOWN','APARTMENT'];
const furnishings:ListingVersion['furnishing'][]=['UNKNOWN','UNFURNISHED','FURNISHED','PARTIAL'];
const facilityValues:Facility[]=['SHARED','PRIVATE','ABSENT','UNKNOWN','REVIEW'];
const propertyLabels={STUDIO:'studio',APARTMENT:'apartment',HOUSE:'house',ROOM:'room',UNKNOWN:'home'};
export const demoListings:ListingVersion[]=Array.from({length:24},(_,i)=>{
 const n=i+1,unknown=i%6===0,locality=places[i%places.length],propertyType=propertyTypes[i%propertyTypes.length];
 const rooms=i<4?(i===0||i===3?1:2.5):i===22?2.5:propertyType==='STUDIO'||propertyType==='ROOM'?1:1.5+(i%8)*.5;
 const bedrooms=unknown?null:i===1||i===2?2:propertyType==='STUDIO'?0:propertyType==='ROOM'?1:Math.max(1,Math.floor(rooms)-1);
 return {id:`demo-${n}`,sourceId:'synthetic-rentals',sourceListingId:`${n}`,version:DEMO_FIXTURE_VERSION,marketId:'ch-vaud-demo',sourceUrl:`https://example.com/rentals/${n}`,title:`${propertyNames[i]} ${propertyLabels[propertyType]} in ${locality}`,locality,
 location:{label:`${locality} · ${i===22?'location not confirmed':i%7===0?'illustrative locality':'fictional property location'}`,precision:i===22?'UNRESOLVED':i%7===0?'LOCALITY':'EXACT',...(i===22?{}:{point:{lat:46.513+(i%6)*.006,lng:6.55+Math.floor(i/6)*.022}}),provenance:'Synthetic coordinates; not a real property address'},
 active:true,status:i===22?'UNRESOLVED':i%7===0?'APPROXIMATE':'ROUTABLE',rent:{amount:650+i*75,currency:'CHF',period:'MONTH',charges:unknown?null:60+(i%5)*35},propertyType,floorArea:unknown?null:22+i*4,rooms,bedrooms,bathrooms:unknown?null:1+Math.floor(i/10),furnishing:furnishings[i%furnishings.length],
 facilities:{washingMachine:facilityValues[i%5],dryer:facilityValues[(i+1)%5],kitchen:facilityValues[(i+2)%5],dishwasher:facilityValues[(i+3)%5],airConditioning:facilityValues[(i+4)%5],balcony:facilityValues[(i+2)%5],parking:facilityValues[(i+3)%5]},evidence:{rooms:'Synthetic structured rooms field. Not a bedroom count.',washingMachine:'Synthetic structured facility field.'},extractionVersion:'structured-v2',firstSeenAt:'2026-09-30T10:00:00Z',lastSeenAt:'2026-09-30T10:00:00Z',sourceUpdatedAt:null,ingestedAt:'2026-09-30T10:00:00Z'};
});

/** Every selectable campus/mode combination has its own prepared calculation. */
export const demoPopularPlans=demoDestinations.slice(0,3).flatMap(destination=>(['TRANSIT','WALK','BICYCLE','DRIVE'] as Mode[]).map(mode=>({
 id:`${destination.id}-${mode.toLowerCase()}`,name:`${destination.label} · ${{TRANSIT:'public transport',WALK:'walking',BICYCLE:'cycling',DRIVE:'driving'}[mode]}`,
 marketId:demoMarkets[0].id,refreshPolicy:`Simulated fixture journeys; manual or scheduled maintenance. Fixed Tuesday 6 October 2026, ${mode==='TRANSIT'?'08:30 arrival':'08:00 departure'}.`,
 definition:{destination,direction:'HOME_TO_DESTINATION' as const,mode,transitPreference:'DEFAULT' as const,preferredTransitModes:[],
 timeBasis:{kind:mode==='TRANSIT'?'ARRIVAL' as const:'DEPARTURE' as const,at:mode==='TRANSIT'?'2026-10-06T08:30:00+02:00':'2026-10-06T08:00:00+02:00',timezone:'Europe/Zurich'},provider:'synthetic' as const,adapterVersion:DEMO_ROUTE_VERSION},
})));
