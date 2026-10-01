export type Mode = 'WALK' | 'BICYCLE' | 'DRIVE' | 'TRANSIT';
export type TransitPreference = 'DEFAULT' | 'LESS_WALKING' | 'FEWER_TRANSFERS';
export type Precision = 'EXACT' | 'BUILDING' | 'STREET' | 'LOCALITY' | 'UNRESOLVED';
export type Facility = 'PRIVATE' | 'SHARED' | 'ABSENT' | 'UNKNOWN' | 'REVIEW';
export type FacilityKey = 'washingMachine'|'dryer'|'kitchen'|'dishwasher'|'airConditioning'|'balcony'|'parking';
export interface Point { lat: number; lng: number }
export interface Location { point?: Point; label: string; precision: Precision; provenance: string }
export interface Destination extends Location { id: string; country: string; locality: string; context: string }
export interface ListingVersion {
  id: string; sourceId: string; sourceListingId: string; version: string; marketId: string;
  sourceUrl: string; title: string; location: Location; active: boolean;
  status: 'ROUTABLE'|'APPROXIMATE'|'UNRESOLVED'|'INACTIVE';
  rent: { amount: number|null; currency: string; period: 'MONTH'|'WEEK'; charges: number|null };
  propertyType: string; floorArea: number|null; rooms: number|null; bedrooms: number|null; bathrooms: number|null;
  furnishing: 'FURNISHED'|'UNFURNISHED'|'PARTIAL'|'UNKNOWN';
  facilities: Record<FacilityKey, Facility>; evidence: Record<string,string>; extractionVersion: string;
  firstSeenAt: string; lastSeenAt: string; sourceUpdatedAt: string|null; ingestedAt: string;
}
export interface RouteDefinition {
  destination: Destination; direction: 'HOME_TO_DESTINATION'; mode: Mode;
  transitPreference: TransitPreference; preferredTransitModes: ('BUS'|'SUBWAY'|'TRAIN'|'LIGHT_RAIL'|'RAIL')[];
  timeBasis: { kind: 'DEPARTURE'|'ARRIVAL'; at: string; timezone: string };
  provider: 'synthetic'|'google'; adapterVersion: string;
}
export type RowState = 'SUCCESS'|'NO_ROUTE'|'UNRESOLVED_ORIGIN'|'UNSUPPORTED_SETTINGS'|'PROVIDER_ERROR';
export interface RouteRow {
  listingId: string; listingVersion: string; state: RowState; durationSeconds?: number; distanceMeters?: number;
  walkingSeconds?: number; transfers?: number; geometry?: string;
  warnings: string[]; provider: string; calculatedAt: string;
}
export type RunState = 'QUEUED'|'RUNNING'|'COMPLETE'|'PARTIAL'|'FAILED'|'CANCELLED';
export interface Counts {total:number; completed:number; success:number; noRoute:number; unresolved:number; failed:number}
export interface RunManifest {
  id: string; ownerId: string; entitlementId: string; state: RunState; definition: RouteDefinition;
  marketId: string; coverage: string; universeVersion: string; listingRefs: {id:string;version:string}[];
  counts: Counts; createdAt: string; expiresAt: string; calculatedAt: string|null; deletedAt?: string;
  chunkRefs: string[]; errors: string[]; synthetic: boolean; exportAllowed: boolean;
  accounting: 'RESERVED'|'FINALISED'|'RELEASED'; externalRequests: number; externalElements: number;
}
export interface Dataset {
  id: string; definition: RouteDefinition; marketId: string; coverage: string; universeVersion: string;
  createdAt: string; calculatedAt: string; state: RunState; counts: Counts;
  listings: ListingVersion[]; rows: RouteRow[]; synthetic: boolean; exportAllowed: boolean; attribution: string[];
}
export interface CreateRunRequest {
  idempotencyKey: string; destinationSelectionId: string; marketId: string; searchScope: 'STANDARD';
  routeDefinition: Omit<RouteDefinition,'destination'|'provider'|'adapterVersion'>; verificationChallenge?: string;
}
export interface ViewState {
  maxRent?: number; minBedrooms?: number; minRooms?: number; minBathrooms?:number; minArea?:number; maxCommuteMinutes?:number;
  furnishing?: ListingVersion['furnishing']; propertyType?: string; facilities?: Partial<Record<FacilityKey,Facility>>;
  bounds?: {north:number;south:number;east:number;west:number};
  sort: 'COMMUTE_ASC'|'COMMUTE_DESC'|'RENT_ASC'|'RENT_DESC'; includeUnavailable: boolean; selectedId?:string;
}
export interface SourcePermissions {
  retrieval:boolean; storage:boolean; export:boolean; descriptions:boolean; images:boolean;
  agreementReference:string; reviewedAt:string;
}
export interface Source {id:string;name:string;canonicalHosts:string[];enabled:boolean;synthetic:boolean;marketId:string;attribution:string;permissions:SourcePermissions}
export interface Entitlement {
  id:string;userIds:string[];status:'ACTIVE'|'VERIFICATION_REQUIRED'|'SUSPENDED';
  dailyRuns:number;dailyDestinations:number;timezone:string;policyVersion:string;
}
export interface EntitlementView {
  entitlement:Entitlement|null;remainingRuns:number;remainingDestinations:number;dayKey:string;verificationRequired:boolean;supportMessage:string;
  usedDestinationIds:string[];resetsAt:string;canStartCustomRun:boolean;supportRequired:boolean;
  accountState:'ACTIVE'|'VERIFICATION_REQUIRED'|'SUSPENDED'|'RUN_LIMIT_REACHED'|'DESTINATION_LIMIT_REACHED';
}
export interface AccountView {uid:string;label:string;name:string;email:string;admin:boolean;providers:string[]}
export interface DemoScenario {id:string;label:string;description:string}
export interface DemoSignInResult {token:string;account:AccountView}
export interface AccountSupportRequest {
  id:string;ownerId:string;category:'VERIFICATION'|'ACCESS'|'ALLOWANCE';message:string;
  status:'OPEN'|'RESOLVED';createdAt:string;response?:string;resolvedAt?:string;
}
export interface PopularProfile {id:string;name:string;destination:Destination;definition:RouteDefinition;marketId:string;publishedAt:string;refreshPolicy:string;datasetId:string}
export interface PublishPopularProfileRequest {
  suggestionId?:string;profileId?:string;name:string;marketId:string;
  routeDefinition:Omit<RouteDefinition,'destination'|'provider'|'adapterVersion'>;
  refreshPolicy:string;reason:string;
}
export interface Suggestion {id:string;destination:Destination;requesterIds:string[];status:'PENDING'|'APPROVED'|'REJECTED';locationType?:string;expectedUsage?:string;createdAt:string}
export interface Gate {id:string;enabled:boolean;reason:string}
export interface Capabilities {
  mode:'demo'|'live'; markets:{id:string;label:string;coverage:string}[]; modes:Mode[];
  transitPreferences:TransitPreference[]; preferredTransitModes:RouteDefinition['preferredTransitModes'];
  timeKinds:('DEPARTURE'|'ARRIVAL')[]; gates:Gate[]; maxCandidates:number;
  features:{customRuns:boolean;export:boolean;ads:boolean;verification:boolean};
}
export interface ApiErrorBody {error:{code:string;message:string;correlationId:string}}
export interface Actor {uid:string;admin:boolean}
export interface RouteProvider {id:string;version:string;maxBatchSize:number;route(listings:ListingVersion[],definition:RouteDefinition):Promise<RouteRow[]>}
export interface LocationResolver {search(query:string):Promise<Destination[]>}
export interface FeedResult {records:ListingVersion[];complete:boolean;removedIds:string[]}
export interface ListingProvider {source:Source;fetch():Promise<FeedResult>}
