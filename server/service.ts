import { createHash, createHmac, randomUUID } from 'node:crypto';
import type {AccountSupportRequest,AccountView,Actor,Capabilities,Counts,CreateRunRequest,Dataset,DemoSignInResult,Destination,Entitlement,EntitlementView,ListingProvider,ListingVersion,LocationResolver,PopularProfile,RouteDefinition,RouteProvider,RouteRow,RunManifest,Source,Suggestion} from '../shared/contracts.ts';
import { DEMO_FIXTURE_VERSION, demoDestinations, demoListings, demoMarkets, demoPopularPlans, demoSources } from '../shared/fixtures.ts';
import { demoAccounts } from '../shared/demo-accounts.ts';
import { validateCreateRun, assertSupportedDefinition, commuteSettingsSchema, safeIdentifier, safeText } from '../shared/validation.ts';
import { ApiError, check } from './errors.ts';
import type { Repository, StoreTx, BlobStore } from './storage.ts';
import type { Queue, TaskPayload } from './queue.ts';
import type { LivePolicy } from './config.ts';
import type { Partner } from '../shared/commercial.ts';
import { resolveOutbound } from './partners.ts';
import { validateChallenge } from './challenge.ts';

interface StoredRun extends RunManifest {universeKey:string;dayKey:string;destinationKey:string;batchIds:string[]}
interface Batch {id:string;runId:string;listingIds:string[];state:'PENDING'|'LEASED'|'DONE'|'CANCELLED';attempts:number;leaseUntil?:string;leaseToken?:string;chunkKey?:string}
interface Usage {id:string; reservations:Record<string,{destinationKey:string;destinationId?:string;status:RunManifest['accounting']}>}
interface Selection {id:string;ownerId:string;destination:Destination;expiresAt:string}
interface Identity {id:string;entitlementId:string}
interface DemoAccountRecord {id:string;providers:string[]}
interface StoredSuggestion extends Suggestion {entitlementIds?:string[]}
interface Audit {id:string;actorId:string;action:string;reason:string;at:string;targetId?:string}
interface Switch {id:string;enabled:boolean;reason:string}
interface PublishedDataset {id:string;key:string;expiresAt?:string}
interface PopularPlan {id:string;name:string;marketId:string;refreshPolicy:string;definition:RouteDefinition}
interface Publication {actor:Actor;reason:string}
export interface ServiceOptions {
  mode:'demo'|'live'; repo:Repository; blobs:BlobStore; route:RouteProvider; location:LocationResolver;
  listings:ListingProvider[]; queue:Queue; clock?:()=>Date; ttlMs?:number; maxCandidates?:number;
  livePolicy?:LivePolicy;
}
const finalStates = new Set(['COMPLETE','PARTIAL','FAILED','CANCELLED']);
const emptyCounts = (total:number):Counts => ({total,completed:0,success:0,noRoute:0,unresolved:0,failed:0});
const hash = (value:unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const destinationKey = (d:Destination) => hash([d.id,d.point,d.context]);
const versionKey = (l:ListingVersion) => `${l.id}__${l.version}`;
function dayKey(date:Date, timezone:string) { return new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit'}).format(date); }
function nextReset(date:Date,timezone:string) {
  const current=dayKey(date,timezone);let low=date.getTime(),high=low+48*3600_000;
  // Find the next calendar-day boundary in the policy zone, including 23/25-hour DST days.
  while(high-low>1){const mid=Math.floor((low+high)/2);if(dayKey(new Date(mid),timezone)===current)low=mid;else high=mid;}
  return new Date(high).toISOString();
}
function aggregate(rows:RouteRow[], total:number):Counts {
  return {total,completed:rows.length,success:rows.filter(r=>r.state==='SUCCESS').length,noRoute:rows.filter(r=>r.state==='NO_ROUTE').length,
    unresolved:rows.filter(r=>r.state==='UNRESOLVED_ORIGIN').length,failed:rows.filter(r=>r.state==='PROVIDER_ERROR'||r.state==='UNSUPPORTED_SETTINGS').length};
}
function manifest(run:StoredRun):RunManifest {
  const {universeKey:_universe,dayKey:_day,destinationKey:_destination,batchIds:_batches,...publicRun} = run;
  // Storage keys are intentionally not handed to clients; results use an authenticated endpoint.
  return {...publicRun,chunkRefs:[]};
}

export class CommuteService {
  readonly repo:Repository; readonly blobs:BlobStore; readonly mode:'demo'|'live';
  queue:Queue; private now:()=>Date; private ttlMs:number; private maxCandidates:number;
  constructor(private options:ServiceOptions) {
    this.repo=options.repo; this.blobs=options.blobs; this.queue=options.queue; this.mode=options.mode;
    this.now=options.clock??(()=>new Date()); this.ttlMs=options.ttlMs??6*3600_000; this.maxCandidates=options.maxCandidates??1000;
  }
  private iso() {return this.now().toISOString();}
  private policyActive() {const policy=this.options.livePolicy;return !!policy&&Date.parse(policy.approvedAt)<=this.now().getTime()&&Date.parse(policy.expiresAt)>this.now().getTime();}
  private markets() {return this.mode==='demo'?demoMarkets:(this.policyActive()?this.options.livePolicy!.markets:[]);}
  private active(run:StoredRun) {check(!run.deletedAt && Date.parse(run.expiresAt)>this.now().getTime(),410,'RUN_EXPIRED','These temporary results have expired or were discarded.');}
  private async own(actor:Actor,id:string) {
    const run=await this.repo.get<StoredRun>('runs',id);
    check(run && run.ownerId===actor.uid,404,'RUN_NOT_FOUND','Run not found.'); this.active(run); return run;
  }
  private async audit(tx:StoreTx,actor:Actor,action:string,reason:string,targetId?:string) {
    check(reason.trim().length>=3&&reason.length<=500,400,'REASON_REQUIRED','Give a short reason for this administrative change.');
    const id=randomUUID(); tx.put('audits',id,{id,actorId:actor.uid,action,reason,at:this.iso(),...(targetId?{targetId}:{})} satisfies Audit);
  }
  async initialise(publish=true) {
    if (this.mode!=='demo') return;
    const fixturesChanged=await this.repo.transaction(async tx=>{
      for (const uid of ['alice','bob','admin','exhausted','destination-limit','suspended']) {
        if (!(await tx.get('identities',uid))) {
          const id=`demo-${uid}`;
          tx.put('identities',uid,{id:uid,entitlementId:id});
          tx.put('entitlements',id,{id,userIds:[uid],status:uid==='suspended'?'SUSPENDED':'ACTIVE',dailyRuns:uid==='destination-limit'?3:2,dailyDestinations:uid==='destination-limit'?1:2,timezone:'Europe/Zurich',policyVersion:'demo-v1'} satisfies Entitlement);
        }
      }
      for(const uid of ['exhausted','destination-limit']) {
        const key=dayKey(this.now(),'Europe/Zurich'),id=`demo-${uid}__${key}`;
        if(!(await tx.get('usage',id))) {
          const count=uid==='exhausted'?2:1;
          tx.put('usage',id,{id,reservations:Object.fromEntries(Array.from({length:count},(_,index)=>[`fixture-${uid}-${index}`,{destinationKey:destinationKey(demoDestinations[index]),destinationId:demoDestinations[index].id,status:'FINALISED'}]))} satisfies Usage);
        }
      }
      const seeded=await tx.get<{id:string;at:string;fixtureVersion?:string}>('config','seeded');
      if(seeded?.fixtureVersion===DEMO_FIXTURE_VERSION)return false;
      // Upgrade only our known synthetic inventory. Frozen custom-run versions, allowances,
      // source controls, user publication settings and unpublication records are retained.
      for(const source of demoSources)if(!(await tx.get('sources',source.id)))tx.put('sources',source.id,source);
      for(const listing of demoListings){
        const current=await tx.get<ListingVersion>('listings',listing.id);
        if(!current||(current.sourceId===listing.sourceId&&current.sourceListingId===listing.sourceListingId)){
          tx.put('listings',listing.id,listing);tx.put('listingVersions',versionKey(listing),listing);
        }
      }
      tx.put('config','seeded',{id:'seeded',at:seeded?.at??this.iso(),fixtureVersion:DEMO_FIXTURE_VERSION});return true;
    });
    if (publish) {
      const profiles=await this.repo.query<PopularProfile>('popularProfiles');
      const expired=await Promise.all(profiles.map(async p=>{const d=await this.repo.get<PublishedDataset>('popularDatasets',p.datasetId);return !d?.expiresAt||Date.parse(d.expiresAt)<=this.now().getTime();}));
      const unpublished=new Set((await this.repo.query<{id:string}>('demoUnpublishedProfiles')).map(profile=>profile.id));
      const missingCampusProfile=demoPopularPlans.some(plan=>!profiles.some(profile=>profile.id===plan.id)&&!unpublished.has(plan.id));
      const outdatedCampusProfile=profiles.some(profile=>demoPopularPlans.some(plan=>plan.id===profile.id)&&profile.definition.adapterVersion!==this.options.route.version);
      if(!profiles.length||expired.some(Boolean)||missingCampusProfile||outdatedCampusProfile||fixturesChanged){
        // Existing operator controls must not prevent the API from starting: staff
        // need access to restore service, and valid published snapshots stay readable.
        // Manual maintenance still reports these gates instead of silently bypassing them.
        const stop=await this.repo.get<Switch>('config','kill-switch');
        const sources=await this.repo.query<Source>('sources');
        const allowedSources=new Set(sources.filter(source=>source.enabled&&source.synthetic&&source.permissions.retrieval&&source.permissions.storage).map(source=>source.id));
        const available=(await this.repo.query<ListingVersion>('listings')).some(listing=>listing.active&&listing.status!=='INACTIVE'&&listing.marketId===demoMarkets[0].id&&allowedSources.has(listing.sourceId));
        if(!stop?.enabled&&available)await this.maintainPopular();
      }
    }
  }
  async capabilities():Promise<Capabilities> {
    const stop=await this.repo.get<Switch>('config','kill-switch');
    return {mode:this.mode,markets:this.markets(),modes:['WALK','BICYCLE','DRIVE','TRANSIT'],
      transitPreferences:['DEFAULT','LESS_WALKING','FEWER_TRANSFERS'],preferredTransitModes:['BUS','SUBWAY','TRAIN','LIGHT_RAIL','RAIL'],timeKinds:['DEPARTURE','ARRIVAL'],
      gates:[{id:'routing-retention',enabled:this.mode==='live'&&this.policyActive(),reason:this.policyActive()?'Reviewed temporary route storage is configured; popular precomputation has a separate approval.':'Live temporary storage and maintained route dataset rights require written review.'},
        {id:'listing-supply',enabled:this.mode==='live'&&this.options.listings.length>0,reason:'An authorised live listing feed must be configured and successfully ingested.'},
        {id:'verification-policy',enabled:false,reason:'Live entitlement issuance requires an approved evidence and recovery policy.'},
        {id:'live-export',enabled:false,reason:'Live routing and listing export/import rights have not been approved.'},
        {id:'launch-policy',enabled:this.policyActive(),reason:this.policyActive()?'Reviewed retention, explicit time, cancellation, and market policies are configured.':'Live retention, time, cancellation, and market policies remain unapproved.'}],
      maxCandidates:this.maxCandidates,features:{customRuns:(this.mode==='demo'||(this.policyActive()&&this.options.livePolicy!.allowCustomRuns&&!!process.env.TURNSTILE_SECRET&&!!process.env.TURNSTILE_ALLOWED_HOSTNAMES))&&!stop?.enabled,export:this.mode==='demo',ads:false,verification:false}};
  }
  demoScenarios() {
    check(this.mode==='demo',404,'NOT_FOUND','Endpoint not found.');
    return structuredClone(demoAccounts);
  }
  async account(actor:Actor):Promise<AccountView> {
    if(this.mode!=='demo')return {uid:actor.uid,label:'Signed-in account',name:'Signed-in account',email:'',admin:actor.admin,providers:[]};
    const scenario=demoAccounts.find(item=>item.id===actor.uid),record=await this.repo.get<DemoAccountRecord>('demoAccounts',actor.uid);
    return {uid:actor.uid,label:scenario?.label??'Local test account',name:scenario?.label??'Local test account',email:`${actor.uid}@keywise.test`,admin:actor.admin,providers:record?.providers??[]};
  }
  async initialiseLocalAccount(actor:Actor) {
    check(this.mode==='demo',503,'LOCAL_AUTH_ONLY','Local access does not grant live entitlement.');
    await this.repo.transaction(async tx=>{
      if(await tx.get<Identity>('identities',actor.uid))return;
      const id=`local-${actor.uid}`;
      tx.put('identities',actor.uid,{id:actor.uid,entitlementId:id});
      tx.put('entitlements',id,{id,userIds:[actor.uid],status:'ACTIVE',dailyRuns:2,dailyDestinations:2,timezone:'Europe/Zurich',policyVersion:'local-verification-deferred'} satisfies Entitlement);
    });
  }
  private demoProvider(value:unknown) {
    check(value==='google'||value==='microsoft',400,'INVALID_PROVIDER','Choose Google or Microsoft sign-in.');
    return value==='google'?'google.com':'microsoft.com';
  }
  async demoSignIn(input:Record<string,unknown>):Promise<DemoSignInResult> {
    check(this.mode==='demo',404,'NOT_FOUND','Endpoint not found.');
    const scenario=demoAccounts.find(item=>item.id===input.accountId);
    check(scenario,400,'INVALID_DEMO_ACCOUNT','Choose a documented local account scenario.');
    const provider=this.demoProvider(input.provider),actor={uid:scenario.id,admin:scenario.id==='admin'};
    await this.rateLimit(`demo-sign-in-${actor.uid}`,'auth',30,60_000);
    await this.repo.transaction(async tx=>{
      const record=await tx.get<DemoAccountRecord>('demoAccounts',actor.uid);
      check(!record?.providers.length||record.providers.includes(provider),409,'PROVIDER_NOT_LINKED','Use a connected sign-in provider, then link this provider from your account.');
      if(!record?.providers.length)tx.put('demoAccounts',actor.uid,{id:actor.uid,providers:[provider]});
      // Verification is deliberately deferred. This allowance is a local fixture only.
      if(!(await tx.get<Identity>('identities',actor.uid))) {
        const id=`demo-${actor.uid}`;
        tx.put('identities',actor.uid,{id:actor.uid,entitlementId:id});
        tx.put('entitlements',id,{id,userIds:[actor.uid],status:'ACTIVE',dailyRuns:2,dailyDestinations:2,timezone:'Europe/Zurich',policyVersion:'demo-verification-deferred'} satisfies Entitlement);
      }
    });
    return {token:`demo-${actor.uid}`,account:await this.account(actor)};
  }
  async linkDemoProvider(actor:Actor,input:Record<string,unknown>):Promise<AccountView> {
    check(this.mode==='demo',503,'DEMO_AUTH_ONLY','Link sign-in providers through the configured authentication service.');
    const provider=this.demoProvider(input.provider);
    await this.repo.transaction(async tx=>{
      const record=(await tx.get<DemoAccountRecord>('demoAccounts',actor.uid))??{id:actor.uid,providers:[]};
      if(!record.providers.includes(provider))record.providers.push(provider);
      tx.put('demoAccounts',actor.uid,record);
    });
    return this.account(actor);
  }
  async rateLimit(actorId:string,group:string,limit:number,windowMs:number) {
    const window=Math.floor(this.now().getTime()/windowMs),id=hash([actorId,group,window]);
    await this.repo.transaction(async tx=>{const record=await tx.get<{id:string;count:number}>('rateLimits',id);check((record?.count??0)<limit,429,'RATE_LIMITED','Too many requests. Please wait a minute before trying again.');tx.put('rateLimits',id,{id,count:(record?.count??0)+1,expiresAt:new Date((window+1)*windowMs).toISOString()});});
  }
  async entitlement(actor:Actor):Promise<EntitlementView> {
    return this.repo.transaction(async tx=>{
      const identity=await tx.get<Identity>('identities',actor.uid);
      const entitlement=identity?await tx.get<Entitlement>('entitlements',identity.entitlementId):undefined;
      const key=dayKey(this.now(),entitlement?.timezone??'Europe/Zurich');
      const usage=entitlement?await tx.get<Usage>('usage',`${entitlement.id}__${key}`):undefined;
      const charged=Object.values(usage?.reservations??{}).filter(r=>r.status!=='RELEASED');
      const usedDestinationIds=new Set<string>();
      for(const [runId,reservation] of Object.entries(usage?.reservations??{}))if(reservation.status!=='RELEASED') {
        const id=reservation.destinationId??(await tx.get<StoredRun>('runs',runId))?.definition.destination.id;
        if(id)usedDestinationIds.add(id);
      }
      const remainingRuns=entitlement?Math.max(0,entitlement.dailyRuns-charged.length):0;
      const remainingDestinations=entitlement?Math.max(0,entitlement.dailyDestinations-new Set(charged.map(r=>r.destinationKey)).size):0;
      const verificationRequired=!entitlement||entitlement.status==='VERIFICATION_REQUIRED',supportRequired=entitlement?.status==='SUSPENDED';
      const accountState=verificationRequired?'VERIFICATION_REQUIRED':supportRequired?'SUSPENDED':remainingRuns===0?'RUN_LIMIT_REACHED':remainingDestinations===0?'DESTINATION_LIMIT_REACHED':'ACTIVE';
      return {entitlement:entitlement??null,dayKey:key,remainingRuns,remainingDestinations,usedDestinationIds:[...usedDestinationIds],
        resetsAt:nextReset(this.now(),entitlement?.timezone??'Europe/Zurich'),canStartCustomRun:entitlement?.status==='ACTIVE'&&remainingRuns>0&&(remainingDestinations>0||usedDestinationIds.size>0),
        accountState,verificationRequired,supportRequired,supportMessage:'Use account support for access, allowance or account recovery issues. Sharing a network does not merge allowances.'};
    });
  }
  async verify(actor:Actor,evidence:unknown):Promise<EntitlementView> {
    check(this.mode==='demo',503,'VERIFICATION_GATED','Live verification issuance is disabled until an approved provider and eligibility policy are configured.');
    check(typeof evidence==='string'&&evidence.trim().length>=4&&evidence.length<=100,400,'INVALID_EVIDENCE','Enter a demo evidence label of 4–100 characters.');
    const key=createHmac('sha256',process.env.EVIDENCE_HMAC_KEY||'local-demo-only-not-a-production-secret').update(evidence.trim().toLowerCase()).digest('hex');
    await this.repo.transaction(async tx=>{
      const identity=await tx.get<Identity>('identities',actor.uid), existing=await tx.get<{entitlementId:string}>('evidence',key);
      if (existing && existing.entitlementId!==identity?.entitlementId) throw new ApiError(409,'EVIDENCE_ALREADY_USED','This evidence is already associated with an allowance. Use account recovery or contact support.');
      if (identity) return;
      const id=randomUUID();
      tx.put('evidence',key,{id:key,entitlementId:id,kind:'synthetic',policyVersion:'demo-v1'});
      tx.put('identities',actor.uid,{id:actor.uid,entitlementId:id});
      tx.put('entitlements',id,{id,userIds:[actor.uid],status:'ACTIVE',dailyRuns:2,dailyDestinations:2,timezone:'Europe/Zurich',policyVersion:'demo-v1'} satisfies Entitlement);
    });
    return this.entitlement(actor);
  }
  async searchLocations(actor:Actor,query:unknown) {
    check(this.mode==='demo'||this.policyActive(),503,'LOCATION_GATED','Live destination resolution is unavailable until location rights are configured.');
    check(typeof query==='string'&&query.trim().length>=2&&query.length<=200,400,'INVALID_QUERY','Search using 2–200 characters.');
    const candidates=await this.options.location.search(query.trim());
    await this.repo.transaction(async tx=>{for(const destination of candidates) tx.put('candidates',`${actor.uid}__${destination.id}`,{id:destination.id,ownerId:actor.uid,destination,expiresAt:new Date(this.now().getTime()+30*60_000).toISOString()});});
    return {candidates};
  }
  async confirmLocation(actor:Actor,destinationId:unknown) {
    check(typeof destinationId==='string',400,'INVALID_DESTINATION','Select a returned destination.');
    const candidate=await this.repo.get<Selection>('candidates',`${actor.uid}__${destinationId}`);
    check(candidate&&Date.parse(candidate.expiresAt)>this.now().getTime(),400,'DESTINATION_EXPIRED','Search again and confirm the exact intended destination.');
    const id=randomUUID(), selection={...candidate,id,ownerId:actor.uid};
    await this.repo.transaction(async tx=>{tx.put('selections',id,selection);});
    return {selectionId:id,destination:candidate.destination};
  }
  async createRun(actor:Actor,raw:unknown):Promise<RunManifest> {
    let request:CreateRunRequest;
    try {request=validateCreateRun(raw);} catch {throw new ApiError(400,'INVALID_RUN','Invalid commute settings. Standard searches cannot contain hidden property filters.');}
    check(this.mode==='demo'||(this.policyActive()&&this.options.livePolicy!.allowCustomRuns),503,'LIVE_GATED','Live custom runs are disabled until data rights and launch policies are approved.');
    const selection=await this.repo.get<Selection>('selections',request.destinationSelectionId);
    check(selection&&selection.ownerId===actor.uid,400,'INVALID_SELECTION','Confirm a destination returned by the server.');
    const definition:RouteDefinition={...request.routeDefinition,destination:selection.destination,provider:this.mode==='demo'?'synthetic':'google',adapterVersion:this.options.route.version};
    try {assertSupportedDefinition(definition);} catch (error) {throw new ApiError(400,'UNSUPPORTED_SETTINGS',error instanceof Error?error.message:'Unsupported commute settings.');}
    const market=this.markets().find(m=>m.id===request.marketId); check(market,400,'INVALID_MARKET','Select a supported market.');
    const fingerprint=hash({...request,idempotencyKey:undefined,destinationSelectionId:undefined,verificationChallenge:undefined,destination:selection.destination});
    if(this.mode==='live') {
      // An already accepted submission needs no second challenge; its single-use token has been consumed.
      const identity=await this.repo.get<Identity>('identities',actor.uid);
      const existing=identity?await this.repo.get<{runId:string;fingerprint:string}>('idempotency',hash([identity.entitlementId,actor.uid,request.idempotencyKey])):undefined;
      if(existing){check(existing.fingerprint===fingerprint,409,'IDEMPOTENCY_CONFLICT','That submission key belongs to different settings.');return this.run(actor,existing.runId);}
      check(typeof request.verificationChallenge==='string'&&await validateChallenge(request.verificationChallenge),403,'CHALLENGE_REQUIRED','Complete the website verification challenge before starting a run.');
    }
    const runId=randomUUID(); const createdAt=this.iso();
    // Freeze the entire eligible universe atomically with allowance reservation. No view controls are accepted here.
    const result=await this.repo.transaction(async tx=>{
      const identity=await tx.get<Identity>('identities',actor.uid);
      check(identity,403,'VERIFICATION_REQUIRED','Verify eligibility before starting a custom run.');
      const entitlement=await tx.get<Entitlement>('entitlements',identity.entitlementId);
      check(entitlement?.status==='ACTIVE',403,'ENTITLEMENT_UNAVAILABLE','Your allowance needs verification or account support.');
      const idemKey=hash([entitlement.id,actor.uid,request.idempotencyKey]);
      const existing=await tx.get<{runId:string;fingerprint:string}>('idempotency',idemKey);
      if (existing) {check(existing.fingerprint===fingerprint,409,'IDEMPOTENCY_CONFLICT','That submission key belongs to different commute settings.');
        const run=await tx.get<StoredRun>('runs',existing.runId);check(run,410,'RUN_EXPIRED','That run is no longer available.');this.active(run);return {run,existing:true,listings:[] as ListingVersion[]};}
      check(Date.parse(selection.expiresAt)>this.now().getTime(),400,'DESTINATION_EXPIRED','Search again and confirm the exact intended destination.');
      const stop=await tx.get<Switch>('config','kill-switch');check(!stop?.enabled,503,'SPENDING_STOPPED','New route work is temporarily paused by an operator.');
      const sources=await tx.query<Source>('sources');
      const allowedSources=new Set(sources.filter(s=>s.enabled&&s.permissions.retrieval&&s.permissions.storage&&s.synthetic===(this.mode==='demo')).map(s=>s.id));
      const listingUniverse=(await tx.query<ListingVersion>('listings')).filter(l=>l.marketId===request.marketId&&l.active&&l.status!=='INACTIVE'&&allowedSources.has(l.sourceId)).sort((a,b)=>a.id.localeCompare(b.id));
      check(listingUniverse.length>0,409,'NO_LISTINGS','No eligible listings are currently available for this market.');
      check(listingUniverse.length<=this.maxCandidates,413,'CAPACITY_EXCEEDED','The complete market exceeds this service’s current routing capacity. No partial universe was started.');
      const key=dayKey(this.now(),entitlement.timezone),usageId=`${entitlement.id}__${key}`;
      const usage=(await tx.get<Usage>('usage',usageId))??{id:usageId,reservations:{}};
      const charged=Object.values(usage.reservations).filter(r=>r.status!=='RELEASED'), destKey=destinationKey(selection.destination);
      check(charged.length<entitlement.dailyRuns,429,'RUN_ALLOWANCE_EXHAUSTED','Today’s custom run allowance has been used.');
      const destinations=new Set(charged.map(r=>r.destinationKey));destinations.add(destKey);
      check(destinations.size<=entitlement.dailyDestinations,429,'DESTINATION_ALLOWANCE_EXHAUSTED','Today’s distinct-destination allowance has been used.');
      const batchSize=Math.min(25,this.options.route.maxBatchSize),batchIds:string[]=[];
      for(let offset=0;offset<listingUniverse.length;offset+=batchSize) {
        const id=`${runId}--${Math.floor(offset/batchSize)}`;batchIds.push(id);
        tx.put('batches',id,{id,runId,listingIds:listingUniverse.slice(offset,offset+batchSize).map(l=>l.id),state:'PENDING',attempts:0} satisfies Batch);
      }
      const retention=await tx.get<{hours:number}>('config','retention');
      const run:StoredRun={id:runId,ownerId:actor.uid,entitlementId:entitlement.id,state:'QUEUED',definition,marketId:market.id,coverage:market.coverage,
        universeVersion:hash(listingUniverse.map(l=>[l.id,l.version])),listingRefs:listingUniverse.map(l=>({id:l.id,version:l.version})),counts:emptyCounts(listingUniverse.length),
        createdAt,expiresAt:new Date(this.now().getTime()+Math.min(this.ttlMs,(retention?.hours??Infinity)*3600_000)).toISOString(),calculatedAt:null,chunkRefs:[],errors:[],synthetic:this.mode==='demo',
        exportAllowed:this.mode==='demo'&&listingUniverse.every(l=>sources.find(s=>s.id===l.sourceId)?.permissions.export===true),accounting:'RESERVED',externalRequests:0,externalElements:0,
        universeKey:`runs/${runId}/universe.json`,dayKey:key,destinationKey:destKey,batchIds};
      usage.reservations[runId]={destinationKey:destKey,destinationId:selection.destination.id,status:'RESERVED'};
      tx.put('usage',usageId,usage);tx.put('runs',runId,run);tx.put('idempotency',idemKey,{id:idemKey,runId,fingerprint,createdAt,ownerId:actor.uid});
      return {run,existing:false,listings:listingUniverse};
    });
    if (!result.existing) {
      try {await this.blobs.put(result.run.universeKey,result.listings);for(const batchId of result.run.batchIds) await this.queue.enqueue({runId:result.run.id,batchId});}
      catch {await this.failBeforeDispatch(result.run.id);throw new ApiError(503,'DISPATCH_FAILED','Queue dispatch was interrupted. Allowance is released only if no external work began; retry this same submission to retrieve its recorded outcome.');}
    }
    return manifest(result.run);
  }
  private async settle(tx:StoreTx,run:StoredRun,status:RunManifest['accounting']) {
    const id=`${run.entitlementId}__${run.dayKey}`,usage=await tx.get<Usage>('usage',id);
    if(usage?.reservations[run.id]) {usage.reservations[run.id].status=status;tx.put('usage',id,usage);}
    run.accounting=status;
  }
  private async failBeforeDispatch(id:string) {
    await this.repo.transaction(async tx=>{const run=await tx.get<StoredRun>('runs',id);if(!run||finalStates.has(run.state))return;
      run.state=run.externalRequests?'PARTIAL':'FAILED';run.errors.push('Queue dispatch was interrupted.');
      await this.settle(tx,run,run.externalRequests?'FINALISED':'RELEASED');tx.put('runs',id,run);
    });
  }
  async run(actor:Actor,id:string) {return manifest(await this.own(actor,id));}
  async results(actor:Actor,id:string):Promise<Dataset> {
    const run=await this.own(actor,id),listings=await this.blobs.get<ListingVersion[]>(run.universeKey);
    check(listings,409,'DATASET_PREPARING','The frozen listing snapshot is being prepared. Try again shortly.');
    const chunks=await Promise.all(run.chunkRefs.map(key=>this.blobs.get<RouteRow[]>(key)));
    check(chunks.every(chunk=>Array.isArray(chunk)),503,'DATASET_INCOMPLETE','A stored result chunk is missing or unavailable. This dataset cannot be presented as complete.');
    const rows=chunks.flatMap(chunk=>chunk??[]),versions=new Map(run.listingRefs.map(ref=>[ref.id,ref.version]));
    check(listings.length===run.listingRefs.length&&new Set(listings.map(l=>l.id)).size===listings.length&&listings.every(l=>versions.get(l.id)===l.version)&&rows.length===run.counts.completed&&new Set(rows.map(r=>r.listingId)).size===rows.length&&rows.every(r=>versions.get(r.listingId)===r.listingVersion),503,'DATASET_INCOMPLETE','Stored results do not reconcile with the frozen listing universe.');
    this.active(run);
    return {id:run.id,definition:run.definition,marketId:run.marketId,coverage:run.coverage,universeVersion:run.universeVersion,createdAt:run.createdAt,
      calculatedAt:run.calculatedAt??run.createdAt,state:run.state,counts:aggregate(rows,listings.length),listings,rows,synthetic:run.synthetic,
      exportAllowed:run.exportAllowed&&run.state==='COMPLETE',attribution:run.synthetic?['Synthetic demonstration listings and journey estimates; no live availability or routing.']:['Google Maps',...this.options.listings.map(p=>p.source.attribution)]};
  }
  async cancel(actor:Actor,id:string):Promise<RunManifest> {
    await this.own(actor,id);
    return this.repo.transaction(async tx=>{const run=await tx.get<StoredRun>('runs',id);check(run&&run.ownerId===actor.uid,404,'RUN_NOT_FOUND','Run not found.');this.active(run);
      if(!finalStates.has(run.state)){run.state='CANCELLED';await this.settle(tx,run,run.externalRequests?'FINALISED':'RELEASED');
        for(const batchId of run.batchIds){const batch=await tx.get<Batch>('batches',batchId);if(batch?.state==='PENDING'){batch.state='CANCELLED';tx.put('batches',batchId,batch);}}
        tx.put('runs',id,run);}return manifest(run);});
  }
  async discard(actor:Actor,id:string) {
    const run=await this.own(actor,id); await this.cancel(actor,id);
    await this.repo.transaction(async tx=>{const current=await tx.get<StoredRun>('runs',id);if(current){current.deletedAt=this.iso();tx.put('runs',id,current);}});
    await this.deletePayload(run);return {deleted:true};
  }
  private async deletePayload(run:StoredRun) {for(const key of await this.blobs.list(`runs/${run.id}/`))await this.blobs.delete(key);}
  async processBatch(task:TaskPayload):Promise<void> {
    const leaseToken=randomUUID();
    const claim=await this.repo.transaction(async tx=>{
      const run=await tx.get<StoredRun>('runs',task.runId),batch=await tx.get<Batch>('batches',task.batchId),stop=await tx.get<Switch>('config','kill-switch');
      if(!run||!batch||batch.runId!==run.id||finalStates.has(run.state)||run.deletedAt||Date.parse(run.expiresAt)<=this.now().getTime()||stop?.enabled)return undefined;
      if(batch.state==='DONE'||batch.state==='CANCELLED'||(batch.state==='LEASED'&&Date.parse(batch.leaseUntil!)>this.now().getTime()))return undefined;
      const leased=(await tx.query<Batch>('batches')).filter(b=>b.state==='LEASED'&&Date.parse(b.leaseUntil??'')>this.now().getTime()).length;
      if(leased>=4)return undefined;
      batch.state='LEASED';batch.leaseToken=leaseToken;batch.leaseUntil=new Date(this.now().getTime()+120_000).toISOString();batch.attempts++;
      run.state='RUNNING';tx.put('batches',batch.id,batch);tx.put('runs',run.id,run);return {run,batch};
    });
    if(!claim)return;
    const universe=await this.blobs.get<ListingVersion[]>(claim.run.universeKey);
    if(!universe) {await this.repo.transaction(async tx=>{const batch=await tx.get<Batch>('batches',task.batchId);if(batch?.leaseToken===leaseToken){batch.state='PENDING';tx.put('batches',batch.id,batch);}});return;}
    const listingMap=new Map(universe.map(l=>[l.id,l])),listings=claim.batch.listingIds.map(id=>listingMap.get(id)).filter((l):l is ListingVersion=>!!l);
    const routable=listings.filter(l=>l.location.point&&l.status==='ROUTABLE');
    let rows:RouteRow[]=listings.filter(l=>!routable.includes(l)).map(l=>({listingId:l.id,listingVersion:l.version,state:'UNRESOLVED_ORIGIN',warnings:[l.status==='APPROXIMATE'?'Approximate origin excluded from exact commute ranking.':'No usable origin coordinate.'],provider:this.options.route.id,calculatedAt:this.iso()}));
    if(routable.length&&claim.batch.attempts<=3) {
      const allowed=await this.repo.transaction(async tx=>{const run=await tx.get<StoredRun>('runs',task.runId),stop=await tx.get<Switch>('config','kill-switch'),batch=await tx.get<Batch>('batches',task.batchId);
        if(!run||finalStates.has(run.state)||run.deletedAt||stop?.enabled||Date.parse(run.expiresAt)<=this.now().getTime()||batch?.leaseToken!==leaseToken||Date.parse(batch.leaseUntil??'')<=this.now().getTime()||(this.mode==='live'&&!this.policyActive()))return false;
        const budgetId=dayKey(this.now(),'UTC'),budget=(await tx.get<{id:string;elements:number}>('providerBudget',budgetId))??{id:budgetId,elements:0};
        if(budget.elements+routable.length>10_000)return false;budget.elements+=routable.length;tx.put('providerBudget',budgetId,budget);
        run.externalRequests++;run.externalElements+=routable.length;await this.settle(tx,run,'FINALISED');tx.put('runs',run.id,run);return true;});
      if(!allowed)return;
      try {
        const returned=await this.options.route.route(routable,claim.run.definition),byId=new Map(returned.map(r=>[r.listingId,r]));
        rows.push(...routable.map(l=>{const row=byId.get(l.id);if(!row||row.listingVersion!==l.version||!['SUCCESS','NO_ROUTE','UNRESOLVED_ORIGIN','UNSUPPORTED_SETTINGS','PROVIDER_ERROR'].includes(row.state)||(row.state==='SUCCESS'&&(!Number.isFinite(row.durationSeconds)||row.durationSeconds!<0)))
          return {listingId:l.id,listingVersion:l.version,state:'PROVIDER_ERROR' as const,warnings:['Provider omitted or returned an invalid route row.'],provider:this.options.route.id,calculatedAt:this.iso()};return row;}));
      } catch {
        if(claim.batch.attempts<3) {await this.repo.transaction(async tx=>{const batch=await tx.get<Batch>('batches',task.batchId);if(batch?.leaseToken===leaseToken){batch.state='PENDING';tx.put('batches',batch.id,batch);}});await this.queue.enqueue(task);return;}
        rows.push(...routable.map(l=>({listingId:l.id,listingVersion:l.version,state:'PROVIDER_ERROR' as const,warnings:['Routing provider failed after bounded retries.'],provider:this.options.route.id,calculatedAt:this.iso()})));
      }
    } else if(routable.length)rows.push(...routable.map(l=>({listingId:l.id,listingVersion:l.version,state:'PROVIDER_ERROR' as const,warnings:['Routing retry limit reached after interrupted worker attempts.'],provider:this.options.route.id,calculatedAt:this.iso()})));
    const chunkKey=`runs/${task.runId}/batches/${claim.batch.id}-${leaseToken}.json`;await this.blobs.put(chunkKey,rows);
    const accepted=await this.repo.transaction(async tx=>{
      const run=await tx.get<StoredRun>('runs',task.runId),batch=await tx.get<Batch>('batches',task.batchId);
      if(!run||!batch||batch.leaseToken!==leaseToken||batch.state==='DONE'||run.deletedAt||Date.parse(run.expiresAt)<=this.now().getTime())return false;
      batch.state='DONE';batch.chunkKey=chunkKey;tx.put('batches',batch.id,batch);run.chunkRefs.push(chunkKey);
      const count=aggregate(rows,run.counts.total);for(const key of ['completed','success','noRoute','unresolved','failed'] as const)run.counts[key]+=count[key];
      if(run.counts.completed===run.counts.total&&run.state!=='CANCELLED') {run.state=run.counts.failed?(run.counts.success?'PARTIAL':'FAILED'):'COMPLETE';run.calculatedAt=this.iso();await this.settle(tx,run,run.externalRequests?'FINALISED':'RELEASED');}
      tx.put('runs',run.id,run);return true;
    });
    if(!accepted)await this.blobs.delete(chunkKey);
  }
  async reconcile() {
    const runs=await this.repo.query<StoredRun>('runs');
    for(const run of runs) {
      if(finalStates.has(run.state)||run.deletedAt||Date.parse(run.expiresAt)<=this.now().getTime())continue;
      // Recover a crash between reserving a run and writing its immutable universe from the recorded versions.
      if(!(await this.blobs.get(run.universeKey))) {
        const snapshots=await Promise.all(run.listingRefs.map(ref=>this.repo.get<ListingVersion>('listingVersions',`${ref.id}__${ref.version}`)));
        if(snapshots.every(Boolean))await this.blobs.put(run.universeKey,snapshots);else{await this.failBeforeDispatch(run.id);continue;}
      }
      for(const id of run.batchIds){const batch=await this.repo.get<Batch>('batches',id);if(batch&&(batch.state==='PENDING'||(batch.state==='LEASED'&&Date.parse(batch.leaseUntil!)<=this.now().getTime())))await this.queue.enqueue({runId:run.id,batchId:id});}
    }
  }
  async cleanup() {
    const runs=await this.repo.query<StoredRun>('runs');let removed=0;
    for(const run of runs)if(run.deletedAt||Date.parse(run.expiresAt)<=this.now().getTime()) {
      await this.repo.transaction(async tx=>{const current=await tx.get<StoredRun>('runs',run.id);if(!current)return;
        if(!finalStates.has(current.state)) {current.state='CANCELLED';await this.settle(tx,current,current.externalRequests?'FINALISED':'RELEASED');}
        current.deletedAt??=this.iso();tx.put('runs',run.id,current);
      });await this.deletePayload(run);
      // Keep the tombstone until all blobs were removed, so interrupted deletion is retried safely.
      await this.repo.transaction(async tx=>{for(const id of run.batchIds)tx.delete('batches',id);tx.delete('runs',run.id);});removed++;
    }
    for(const collection of ['selections','candidates','rateLimits'])await this.repo.transaction(async tx=>{for(const row of await tx.query<Selection>(collection))if(Date.parse(row.expiresAt)<=this.now().getTime())tx.delete(collection,collection==='candidates'?`${row.ownerId}__${row.id}`:row.id);});
    // Recover payloads left by a late worker or crash after an unreferenced object upload.
    for(const key of await this.blobs.list('runs/')){const id=key.split('/')[1];if(!(await this.repo.get('runs',id)))await this.blobs.delete(key);}
    const profiles=await this.repo.query<PopularProfile>('popularProfiles'),published=new Set(profiles.map(p=>p.datasetId));
    for(const dataset of await this.repo.query<PublishedDataset>('popularDatasets'))if(!published.has(dataset.id)||(dataset.expiresAt&&Date.parse(dataset.expiresAt)<=this.now().getTime())){
      await this.blobs.delete(dataset.key);await this.repo.transaction(async tx=>{tx.delete('popularDatasets',dataset.id);for(const profile of profiles.filter(p=>p.datasetId===dataset.id))tx.delete('popularProfiles',profile.id);});
    }
    const maintenance=await this.repo.get<{expiresAt:number}>('jobLeases','popular');
    if(!maintenance||maintenance.expiresAt<=this.now().getTime()) {
      const known=new Set((await this.repo.query<PublishedDataset>('popularDatasets')).map(d=>d.key));
      for(const key of await this.blobs.list('popular/'))if(!known.has(key))await this.blobs.delete(key);
    }
    return {removed};
  }
  async popularProfiles() {
    const profiles=await this.repo.query<PopularProfile>('popularProfiles');
    if(this.mode!=='demo')return profiles;
    const order=['epfl-east-transit','epfl-west-transit','unil-dorigny-transit',...demoPopularPlans.filter(plan=>plan.definition.mode!=='TRANSIT').map(plan=>plan.id)];
    const rank=(id:string)=>{const index=order.indexOf(id);return index<0?order.length:index;};
    return profiles.sort((a,b)=>rank(a.id)-rank(b.id)||a.id.localeCompare(b.id));
  }
  async popularDataset(id:string) {
    const profile=await this.repo.get<PopularProfile>('popularProfiles',id);check(profile,404,'PROFILE_NOT_FOUND','This popular profile is not published.');
    const stored=await this.repo.get<PublishedDataset>('popularDatasets',profile.datasetId),dataset=stored?await this.blobs.get<Dataset>(stored.key):undefined;
    check(dataset&&(!stored?.expiresAt||Date.parse(stored.expiresAt)>this.now().getTime())&&(dataset.synthetic||this.policyActive()),503,'PROFILE_UNAVAILABLE','This profile’s published results are unavailable or expired.');return dataset;
  }
  async maintainPopular() {
    return this.maintainPlans();
  }
  private async maintainPlans(plans?:PopularPlan[],publication?:Publication) {
    const token=randomUUID();
    await this.repo.transaction(async tx=>{const lease=await tx.get<{expiresAt:number}>('jobLeases','popular');check(!lease||lease.expiresAt<=this.now().getTime(),409,'MAINTENANCE_BUSY','Popular maintenance is already running.');tx.put('jobLeases','popular',{id:'popular',token,expiresAt:this.now().getTime()+120_000});});
    try{await this.refreshPopular(token,plans,publication);}finally{await this.repo.transaction(async tx=>{const lease=await tx.get<{token:string}>('jobLeases','popular');if(lease?.token===token)tx.delete('jobLeases','popular');});}
  }
  private async refreshPopular(token:string,requestedPlans?:PopularPlan[],publication?:Publication) {
    check(this.mode==='demo'||(this.policyActive()&&this.options.livePolicy!.allowPopular&&this.options.livePolicy!.popularApprovalReference),503,'POPULAR_GATED','Live maintained datasets require explicit precomputation and retention rights.');
    const stop=await this.repo.get<Switch>('config','kill-switch');check(!stop?.enabled,503,'SPENDING_STOPPED','Popular maintenance is paused by the spending stop.');
    const sources=await this.repo.query<Source>('sources'),allowedSources=new Set(sources.filter(s=>s.enabled&&s.permissions.storage&&s.permissions.retrieval&&s.synthetic===(this.mode==='demo')).map(s=>s.id));
    const defaultPlans=this.mode==='demo'?demoPopularPlans : this.options.livePolicy!.popularPlans;
    const savedPlans=this.mode==='demo'?await this.repo.query<PopularPlan>('demoPopularPlans'):[];
    const unpublished=this.mode==='demo'?new Set((await this.repo.query<{id:string}>('demoUnpublishedProfiles')).map(profile=>profile.id)):new Set<string>();
    const plans=requestedPlans??[...new Map([...defaultPlans,...savedPlans].map(plan=>[plan.id,plan])).values()].filter(plan=>!unpublished.has(plan.id));
    for(const plan of plans) {
      const profileId=plan.id,definition={...plan.definition,adapterVersion:this.options.route.version},destination=definition.destination,market=this.markets().find(m=>m.id===plan.marketId);
      check(market,400,'INVALID_MARKET','Popular profile market is not configured.');assertSupportedDefinition(definition);
      const listings=(await this.repo.query<ListingVersion>('listings')).filter(l=>l.active&&l.marketId===market.id&&allowedSources.has(l.sourceId));
      check(listings.length>0&&listings.length<=this.maxCandidates,413,'CAPACITY_EXCEEDED','The full popular market must fit the supported workload before publication.');
      const routable=listings.filter(l=>l.status==='ROUTABLE'&&l.location.point),rows:RouteRow[]=[];
      for(let i=0;i<routable.length;i+=this.options.route.maxBatchSize) {
        const currentStop=await this.repo.get<Switch>('config','kill-switch');check(!currentStop?.enabled&&(this.mode==='demo'||this.policyActive()),503,'SPENDING_STOPPED','Popular maintenance was stopped before the next batch.');
        const batch=routable.slice(i,i+this.options.route.maxBatchSize);
        await this.repo.transaction(async tx=>{const lease=await tx.get<{token:string;expiresAt:number}>('jobLeases','popular');check(lease?.token===token&&lease.expiresAt>this.now().getTime(),409,'MAINTENANCE_BUSY','Popular maintenance lease was lost.');
          tx.put('jobLeases','popular',{id:'popular',token,expiresAt:this.now().getTime()+120_000});const budgetId=dayKey(this.now(),'UTC'),budget=(await tx.get<{id:string;elements:number}>('providerBudget',budgetId))??{id:budgetId,elements:0};check(budget.elements+batch.length<=10_000,503,'BUDGET_STOPPED','The daily provider element safety limit was reached.');budget.elements+=batch.length;tx.put('providerBudget',budgetId,budget);});
        rows.push(...await this.options.route.route(batch,definition));
      }
      rows.push(...listings.filter(l=>!routable.includes(l)).map(l=>({listingId:l.id,listingVersion:l.version,state:'UNRESOLVED_ORIGIN' as const,warnings:['Origin cannot support an exact commute.'],provider:this.options.route.id,calculatedAt:this.iso()})));
      const counts=aggregate(rows,listings.length),versions=new Map(listings.map(l=>[l.id,l.version]));check(rows.length===listings.length&&new Set(rows.map(r=>r.listingId)).size===listings.length&&rows.every(r=>versions.get(r.listingId)===r.listingVersion&&(r.state!=='SUCCESS'||(Number.isFinite(r.durationSeconds)&&r.durationSeconds!>=0))),503,'INCOMPLETE_PROFILE','Popular maintenance returned an incomplete dataset; the last published version remains available.');
      const id=randomUUID(),key=`popular/${profileId}/${id}.json`,at=this.iso(),oldProfile=await this.repo.get<PopularProfile>('popularProfiles',profileId);
      const dataset:Dataset={id,definition,marketId:market.id,coverage:market.coverage,universeVersion:hash(listings.map(l=>[l.id,l.version])),createdAt:at,calculatedAt:at,state:counts.failed?'PARTIAL':'COMPLETE',counts,listings,rows,synthetic:this.mode==='demo',exportAllowed:this.mode==='demo'&&sources.filter(s=>allowedSources.has(s.id)).every(s=>s.permissions.export),attribution:this.mode==='demo'?['Synthetic demonstration data. No real route calculation or listing availability.']:['Google Maps',...sources.filter(s=>allowedSources.has(s.id)).map(s=>s.attribution)]};
      await this.blobs.put(key,dataset);
      await this.repo.transaction(async tx=>{
        const lease=await tx.get<{token:string;expiresAt:number}>('jobLeases','popular');check(lease?.token===token&&lease.expiresAt>this.now().getTime(),409,'MAINTENANCE_BUSY','Popular maintenance lease was lost before publication.');
        tx.put('popularDatasets',id,{id,key,expiresAt:new Date(this.now().getTime()+this.ttlMs).toISOString()});
        tx.put('popularProfiles',profileId,{id:profileId,name:plan.name,destination,definition,marketId:market.id,publishedAt:at,refreshPolicy:plan.refreshPolicy,datasetId:id} satisfies PopularProfile);
        if(publication){tx.put('demoPopularPlans',profileId,{...plan,definition});tx.delete('demoUnpublishedProfiles',profileId);await this.audit(tx,publication.actor,'POPULAR_PROFILE_PUBLISH',publication.reason,profileId);}
      });
      if(oldProfile){const old=await this.repo.get<PublishedDataset>('popularDatasets',oldProfile.datasetId);if(old){await this.blobs.delete(old.key);await this.repo.transaction(async tx=>tx.delete('popularDatasets',old.id));}}
    }
  }
  async publishPopularProfile(actor:Actor,input:Record<string,unknown>):Promise<PopularProfile> {
    check(actor.admin,403,'ADMIN_REQUIRED','Administrator access required.');
    check(this.mode==='demo',503,'POPULAR_PUBLICATION_GATED','Live publication requires the approved provider policy and configured maintenance process.');
    check(Object.keys(input).every(key=>['suggestionId','profileId','name','marketId','routeDefinition','refreshPolicy','reason'].includes(key)),400,'INVALID_POPULAR_PROFILE','Unexpected publication field.');
    check(typeof input.reason==='string'&&input.reason.trim().length>=3&&input.reason.length<=500,400,'REASON_REQUIRED','Give a short reason for this administrative change.');
    check(typeof input.name==='string'&&input.name.trim().length>=3&&input.name.length<=160&&safeText.safeParse(input.name).success,400,'INVALID_POPULAR_PROFILE','Use a readable profile name of 3–160 characters.');
    check(typeof input.refreshPolicy==='string'&&input.refreshPolicy.trim().length>=5&&input.refreshPolicy.length<=300&&safeText.safeParse(input.refreshPolicy).success,400,'INVALID_POPULAR_PROFILE','Describe the refresh policy in 5–300 characters.');
    check(typeof input.marketId==='string'&&this.markets().some(market=>market.id===input.marketId),400,'INVALID_MARKET','Select a supported market.');
    const settings=commuteSettingsSchema.safeParse(input.routeDefinition);check(settings.success,400,'INVALID_POPULAR_PROFILE','Choose a complete supported commute definition and explicit journey time.');
    const profileId=typeof input.profileId==='string'?input.profileId:undefined,suggestionId=typeof input.suggestionId==='string'?input.suggestionId:undefined;
    check(profileId||suggestionId,400,'INVALID_POPULAR_PROFILE','Choose an approved nomination or a published profile to refresh.');
    if(profileId)check(safeIdentifier.safeParse(profileId).success,400,'INVALID_POPULAR_PROFILE','Choose a valid published profile.');
    const previous=profileId?await this.repo.get<PopularProfile>('popularProfiles',profileId):undefined;
    if(profileId)check(previous,404,'PROFILE_NOT_FOUND','Choose a published profile to refresh.');
    const suggestion=suggestionId?await this.repo.get<Suggestion>('suggestions',suggestionId):undefined;
    if(suggestionId)check(suggestion?.status==='APPROVED',409,'SUGGESTION_NOT_APPROVED','Approve the exact destination nomination before publishing its profile.');
    const destination=suggestion?.destination??previous?.destination;
    check(destination?.point&&destination.precision==='EXACT',400,'INVALID_DESTINATION','Publish only a confirmed exact destination point.');
    if(previous&&suggestion)check(destinationKey(previous.destination)===destinationKey(suggestion.destination),409,'PROFILE_DESTINATION_CONFLICT','Refresh keeps the existing profile’s exact destination. Publish a separate profile for another point.');
    const definition:RouteDefinition={...settings.data!,destination,provider:'synthetic',adapterVersion:this.options.route.version};
    try{assertSupportedDefinition(definition);}catch(error){throw new ApiError(400,'UNSUPPORTED_SETTINGS',error instanceof Error?error.message:'Unsupported commute definition.');}
    const plan:PopularPlan={id:profileId??`demo-published-${hash([suggestionId,input.name,input.marketId,settings.data]).slice(0,24)}`,name:input.name.trim(),marketId:input.marketId,refreshPolicy:input.refreshPolicy.trim(),definition};
    await this.maintainPlans([plan],{actor,reason:input.reason});
    const published=await this.repo.get<PopularProfile>('popularProfiles',plan.id);check(published,503,'PROFILE_UNAVAILABLE','Publication did not complete. Refresh the administrator workspace.');return published;
  }
  async suggest(actor:Actor,input:{destinationSelectionId?:unknown;locationType?:unknown;expectedUsage?:unknown}) {
    check(typeof input.destinationSelectionId==='string',400,'INVALID_SELECTION','Confirm an exact destination before suggesting it.');
    const selection=await this.repo.get<Selection>('selections',input.destinationSelectionId);
    check(selection&&selection.ownerId===actor.uid&&Date.parse(selection.expiresAt)>this.now().getTime(),400,'INVALID_SELECTION','Confirm an exact destination before suggesting it.');
    for(const field of ['locationType','expectedUsage'] as const)check(input[field]===undefined||(typeof input[field]==='string'&&input[field].length<=300),400,'INVALID_SUGGESTION','Suggestion answers must be short text.');
    const id=destinationKey(selection.destination);
    return this.repo.transaction(async tx=>{
      const identity=await tx.get<Identity>('identities',actor.uid),entitlement=identity?await tx.get<Entitlement>('entitlements',identity.entitlementId):undefined;
      check(entitlement?.status==='ACTIVE',403,'SUGGESTION_ELIGIBILITY_REQUIRED','An active account allowance is required to nominate a popular destination. You can still browse published profiles.');
      let suggestion=await tx.get<StoredSuggestion>('suggestions',id);
      if(!suggestion)suggestion={id,destination:selection.destination,requesterIds:[],status:'PENDING',createdAt:this.iso(),locationType:input.locationType as string|undefined,expectedUsage:input.expectedUsage as string|undefined};
      if(!suggestion.entitlementIds) {
        suggestion.entitlementIds=[];
        for(const uid of suggestion.requesterIds){const prior=await tx.get<Identity>('identities',uid);if(prior&&!suggestion.entitlementIds.includes(prior.entitlementId))suggestion.entitlementIds.push(prior.entitlementId);}
      }
      if(!suggestion.entitlementIds.includes(entitlement.id))suggestion.entitlementIds.push(entitlement.id);
      if(!suggestion.requesterIds.includes(actor.uid))suggestion.requesterIds.push(actor.uid);tx.put('suggestions',id,suggestion);
      return {id,status:suggestion.status,distinctRequests:suggestion.entitlementIds.length};
    });
  }
  async demoListing(id:string) {
    check(this.mode==='demo',404,'NOT_FOUND','Endpoint not found.');
    const listing=await this.repo.get<ListingVersion>('listings',id),source=listing?await this.repo.get<Source>('sources',listing.sourceId):undefined;
    check(listing&&source?.synthetic,404,'LISTING_NOT_FOUND','This demonstration listing is unavailable. Return to the search results.');
    return listing;
  }
  async supportRequests(actor:Actor) {
    return (await this.repo.query<AccountSupportRequest>('supportRequests')).filter(request=>request.ownerId===actor.uid).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
  }
  async requestSupport(actor:Actor,input:Record<string,unknown>) {
    check(['VERIFICATION','ACCESS','ALLOWANCE'].includes(String(input.category)),400,'INVALID_SUPPORT_REQUEST','Choose an account support category.');
    check(typeof input.message==='string'&&input.message.trim().length>=10&&input.message.length<=1000&&safeText.safeParse(input.message).success,400,'INVALID_SUPPORT_REQUEST','Describe the issue in 10–1000 characters. Do not include passwords or verification codes.');
    const request:AccountSupportRequest={id:randomUUID(),ownerId:actor.uid,category:input.category as AccountSupportRequest['category'],message:input.message.trim(),status:'OPEN',createdAt:this.iso()};
    await this.repo.transaction(async tx=>tx.put('supportRequests',request.id,request));return request;
  }
  async resolveSupport(actor:Actor,id:string,input:Record<string,unknown>) {
    check(actor.admin,403,'ADMIN_REQUIRED','Administrator access required.');
    check(typeof input.response==='string'&&input.response.trim().length>=10&&input.response.length<=1000&&safeText.safeParse(input.response).success&&typeof input.reason==='string',400,'INVALID_SUPPORT_RESPONSE','Supply a response of 10–1000 characters and an administrative reason.');
    return this.repo.transaction(async tx=>{
      const request=await tx.get<AccountSupportRequest>('supportRequests',id);check(request,404,'SUPPORT_REQUEST_NOT_FOUND','Support request not found.');
      await this.audit(tx,actor,'ACCOUNT_SUPPORT_RESPONSE',input.reason as string,id);
      request.status='RESOLVED';request.response=(input.response as string).trim();request.resolvedAt=this.iso();tx.put('supportRequests',id,request);return request;
    });
  }
  async outbound(listingId:string) {
    const listing=await this.repo.get<ListingVersion>('listings',listingId);check(listing,404,'LISTING_NOT_FOUND','Listing not found.');
    const source=await this.repo.get<Source>('sources',listing.sourceId);let url:URL;try{url=new URL(listing.sourceUrl);}catch{throw new ApiError(400,'INVALID_SOURCE_LINK','The original source link is unavailable.');}
    check(source&&source.canonicalHosts.includes(url.hostname)&&url.protocol==='https:'&&!url.username&&!url.password,400,'INVALID_SOURCE_LINK','The original source link is not approved.');
    const partners=await this.repo.query<Partner>('partners');
    return resolveOutbound(listing,source,partners.find(p=>p.enabled&&p.sourceId===listing.sourceId),this.now().getTime());
  }
  async admin(actor:Actor) {
    check(actor.admin,403,'ADMIN_REQUIRED','Administrator access required.');
    return {killSwitch:(await this.repo.get<Switch>('config','kill-switch'))??{id:'kill-switch',enabled:false,reason:''},
      runs:(await this.repo.query<StoredRun>('runs')).map(r=>({id:r.id,state:r.state,counts:r.counts,createdAt:r.createdAt,externalRequests:r.externalRequests,externalElements:r.externalElements})),
      suggestions:await this.repo.query<Suggestion>('suggestions'),audit:await this.repo.query<Audit>('audits'),sources:await this.repo.query<Source>('sources'),sourceHealth:await this.repo.query('sourceHealth'),providerBudget:await this.repo.query('providerBudget'),
      entitlements:await this.repo.query<Entitlement>('entitlements'),supportRequests:await this.repo.query<AccountSupportRequest>('supportRequests')};
  }
  async setKillSwitch(actor:Actor,enabled:unknown,reason:unknown) {
    check(actor.admin,403,'ADMIN_REQUIRED','Administrator access required.');check(typeof enabled==='boolean'&&typeof reason==='string',400,'INVALID_ADMIN_CHANGE','Supply an enabled flag and reason.');
    await this.repo.transaction(async tx=>{await this.audit(tx,actor,'SPENDING_SWITCH',reason);tx.put('config','kill-switch',{id:'kill-switch',enabled,reason});});
    if(!enabled)await this.reconcile();return {enabled,reason};
  }
  async reviewSuggestion(actor:Actor,id:string,status:unknown,reason:unknown) {
    check(actor.admin,403,'ADMIN_REQUIRED','Administrator access required.');check((status==='APPROVED'||status==='REJECTED')&&typeof reason==='string',400,'INVALID_ADMIN_CHANGE','Supply a review decision and reason.');
    return this.repo.transaction(async tx=>{const suggestion=await tx.get<Suggestion>('suggestions',id);check(suggestion,404,'SUGGESTION_NOT_FOUND','Suggestion not found.');await this.audit(tx,actor,'SUGGESTION_REVIEW',reason,id);suggestion.status=status;tx.put('suggestions',id,suggestion);return suggestion;});
  }
  async adminAction(actor:Actor,input:Record<string,unknown>) {
    check(actor.admin,403,'ADMIN_REQUIRED','Administrator access required.');
    check(typeof input.action==='string'&&typeof input.reason==='string',400,'INVALID_ADMIN_CHANGE','Supply an action and reason.');
    check(Object.keys(input).every(k=>['action','targetId','value','reason'].includes(k)),400,'INVALID_ADMIN_CHANGE','Unexpected administration field.');
    const {action,value,reason}=input,targetId=typeof input.targetId==='string'?input.targetId:undefined;
    let blobToDelete:string|undefined;
    const result=await this.repo.transaction(async tx=>{
      if(action==='SOURCE_ENABLED'){
        check(targetId&&typeof value==='boolean',400,'INVALID_ADMIN_CHANGE','Choose a source and boolean enabled state.');
        const source=await tx.get<Source>('sources',targetId);check(source,404,'SOURCE_NOT_FOUND','Source not found.');
        if(value)check(source.permissions.retrieval&&source.permissions.storage,409,'SOURCE_GATED','Retrieval and storage permission are required to enable this source.');
        source.enabled=value;tx.put('sources',targetId,source);
      }else if(action==='ENTITLEMENT_POLICY'){
        check(targetId&&value&&typeof value==='object'&&!Array.isArray(value),400,'INVALID_ADMIN_CHANGE','Choose an entitlement and policy.');
        const policy=value as Record<string,unknown>;
        check(Object.keys(policy).every(k=>['dailyRuns','dailyDestinations','status'].includes(k))&&Number.isInteger(policy.dailyRuns)&&Number(policy.dailyRuns)>=0&&Number(policy.dailyRuns)<=100&&Number.isInteger(policy.dailyDestinations)&&Number(policy.dailyDestinations)>=0&&Number(policy.dailyDestinations)<=100&&['ACTIVE','SUSPENDED','VERIFICATION_REQUIRED'].includes(String(policy.status)),400,'INVALID_ADMIN_CHANGE','Policy needs bounded integer allowances and a valid status.');
        const entitlement=await tx.get<Entitlement>('entitlements',targetId);check(entitlement,404,'ENTITLEMENT_NOT_FOUND','Entitlement not found.');
        if(this.mode==='live'&&policy.status==='ACTIVE'&&entitlement.status!=='ACTIVE')throw new ApiError(503,'VERIFICATION_GATED','Live activation requires the approved verification support process.');
        Object.assign(entitlement,policy);tx.put('entitlements',targetId,entitlement);
      }else if(action==='RETENTION_HOURS'){
        check(typeof value==='number'&&Number.isFinite(value)&&value>0&&value<=this.ttlMs/3600_000,400,'INVALID_RETENTION','Retention may only be shortened within the approved maximum. Existing run expiries are unchanged.');tx.put('config','retention',{id:'retention',hours:value});
      }else if(action==='UNPUBLISH_PROFILE'){
        check(targetId,400,'INVALID_ADMIN_CHANGE','Choose a profile.');const profile=await tx.get<PopularProfile>('popularProfiles',targetId);check(profile,404,'PROFILE_NOT_FOUND','Profile not found.');
        const dataset=await tx.get<PublishedDataset>('popularDatasets',profile.datasetId);blobToDelete=dataset?.key;tx.delete('popularProfiles',targetId);
        if(this.mode==='demo')tx.put('demoUnpublishedProfiles',targetId,{id:targetId,at:this.iso()});
        // Payload metadata remains until blob deletion succeeds; cleanup can find orphan versions.
      }else if(action==='CANCEL_RUN'){
        check(targetId,400,'INVALID_ADMIN_CHANGE','Choose a run.');const run=await tx.get<StoredRun>('runs',targetId);check(run,404,'RUN_NOT_FOUND','Run not found.');
        if(!finalStates.has(run.state)){run.state='CANCELLED';await this.settle(tx,run,run.externalRequests?'FINALISED':'RELEASED');tx.put('runs',targetId,run);}
      }else throw new ApiError(400,'INVALID_ADMIN_CHANGE','Unknown administration action.');
      await this.audit(tx,actor,action,reason,targetId);return {action,applied:true};
    });
    if(blobToDelete)await this.blobs.delete(blobToDelete);return result;
  }
}
