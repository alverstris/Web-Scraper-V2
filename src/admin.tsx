import { useEffect, useState } from 'react';
import type { AccountSupportRequest, Capabilities, Entitlement, PopularProfile, RouteDefinition, RunManifest, Source, Suggestion } from '../shared/contracts';
import { api, errorMessage } from './api';
import { CountsSummary, DefinitionSummary, Field, Panel, dateLabel, modeLabels, preferenceLabels } from './ui';

type AdminRun = Pick<RunManifest, 'id'|'state'|'counts'|'createdAt'|'externalRequests'|'externalElements'>;
interface SourceHealth {id: string; complete: boolean; observedAt: string; recordCount?: number; error?: string}
interface AdminState {
  killSwitch: {id: string; enabled: boolean; reason: string};
  runs: AdminRun[]; suggestions: Suggestion[]; audit: unknown[]; sources: Source[];
  sourceHealth: SourceHealth[]; providerBudget: {id: string; elements: number}[];
  entitlements?: Entitlement[]; supportRequests?: AccountSupportRequest[];
}

function dateInput(value: string) {
  const date = new Date(value);
  return new Date(date.valueOf()-date.getTimezoneOffset()*60_000).toISOString().slice(0,16);
}

export function AdminConsole({token,onChanged}: {token: string | null;onChanged?:()=>Promise<void>}) {
  const [data,setData] = useState<AdminState|null>(null);
  const [profiles,setProfiles] = useState<PopularProfile[]>([]);
  const [capabilities,setCapabilities] = useState<Capabilities|null>(null);
  const [error,setError] = useState('');
  const [notice,setNotice] = useState('');
  const [reason,setReason] = useState('');
  const [busy,setBusy] = useState(false);
  const [targetEntitlement,setTargetEntitlement] = useState('');
  const [dailyRuns,setDailyRuns] = useState(2);
  const [dailyDestinations,setDailyDestinations] = useState(2);
  const [policyStatus,setPolicyStatus] = useState<Entitlement['status']>('ACTIVE');
  const [retentionHours,setRetentionHours] = useState(1);
  const [supportResponses,setSupportResponses] = useState<Record<string,string>>({});
  const [publicationTarget,setPublicationTarget] = useState('');
  const [profileName,setProfileName] = useState('');
  const [marketId,setMarketId] = useState('');
  const [mode,setMode] = useState<RouteDefinition['mode']>('TRANSIT');
  const [preference,setPreference] = useState<RouteDefinition['transitPreference']>('DEFAULT');
  const [preferredModes,setPreferredModes] = useState<RouteDefinition['preferredTransitModes']>([]);
  const [timeKind,setTimeKind] = useState<'DEPARTURE'|'ARRIVAL'>('ARRIVAL');
  const [journeyTime,setJourneyTime] = useState(()=>dateInput(new Date(Date.now()+86_400_000).toISOString()));
  const [refreshPolicy,setRefreshPolicy] = useState('Operator-maintained synthetic profile; refresh explicitly after review.');
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  async function load() {
    return Promise.all([api<AdminState>('/admin',token),api<PopularProfile[]>('/popular-destinations',token),api<Capabilities>('/capabilities',token)]);
  }
  function update(state: AdminState,published: PopularProfile[],caps: Capabilities) {
    setData(state);setProfiles(published);setCapabilities(caps);setMarketId(current=>current||caps.markets[0]?.id||'');
  }
  async function refresh() {
    setBusy(true);
    try {const [state,published,caps] = await load();update(state,published,caps);setError('');await onChanged?.();}
    catch(e) {setData(null);setProfiles([]);setError(errorMessage(e));}
    finally {setBusy(false);}
  }
  useEffect(()=>{
    let current = true;
    setData(null);setProfiles([]);setError('');setNotice('');setReason('');setBusy(true);setSupportResponses({});
    load().then(([state,published,caps])=>{if(current)update(state,published,caps);})
      .catch(e=>{if(current)setError(errorMessage(e));})
      .finally(()=>{if(current)setBusy(false);});
    return ()=>{current=false;};
  },[token]);
  async function change(path: string,body: unknown,success: string) {
    if(reason.trim().length<3) {setError('Give an audit reason of at least three characters before making an administrative change.');return;}
    setBusy(true);setError('');setNotice('');
    try {
      await api(path,token,{method:'POST',body});
      const [state,published,caps] = await load();update(state,published,caps);setNotice(success);await onChanged?.();
    } catch(e) {setError(errorMessage(e));}
    finally {setBusy(false);}
  }
  function chooseEntitlement(value: string) {
    setTargetEntitlement(value);
    const entitlement = data?.entitlements?.find(item=>item.id===value);
    if(entitlement) {setDailyRuns(entitlement.dailyRuns);setDailyDestinations(entitlement.dailyDestinations);setPolicyStatus(entitlement.status);}
  }
  function choosePublication(value: string) {
    setPublicationTarget(value);setError('');
    if(value.startsWith('profile:')) {
      const profile = profiles.find(item=>item.id===value.slice(8));
      if(!profile)return;
      setProfileName(profile.name);setMarketId(profile.marketId);setMode(profile.definition.mode);
      setPreference(profile.definition.transitPreference);setPreferredModes(profile.definition.preferredTransitModes);
      setTimeKind(profile.definition.timeBasis.kind);setJourneyTime(dateInput(profile.definition.timeBasis.at));setRefreshPolicy(profile.refreshPolicy);
    } else {
      const suggestion = data?.suggestions.find(item=>item.id===value.slice(11));
      setProfileName(suggestion?`${suggestion.destination.label} · public transport`:'');
      setMode('TRANSIT');setPreference('DEFAULT');setPreferredModes([]);setTimeKind('ARRIVAL');
      setRefreshPolicy('Operator-maintained synthetic profile; refresh explicitly after review.');
    }
  }
  const chosenProfile = publicationTarget.startsWith('profile:')?profiles.find(item=>item.id===publicationTarget.slice(8)):undefined;
  const chosenSuggestion = publicationTarget.startsWith('suggestion:')?data?.suggestions.find(item=>item.id===publicationTarget.slice(11)&&item.status==='APPROVED'):undefined;
  const publicationDestination = chosenProfile?.destination??chosenSuggestion?.destination;
  const publicationTime = new Date(journeyTime);
  const publicationDefinition: RouteDefinition|null = publicationDestination&&!Number.isNaN(publicationTime.valueOf())?{
    destination:publicationDestination,direction:'HOME_TO_DESTINATION' as const,mode,
    transitPreference:mode==='TRANSIT'?preference:'DEFAULT' as const,preferredTransitModes:mode==='TRANSIT'?preferredModes:[],
    timeBasis:{kind:timeKind,at:publicationTime.toISOString(),timezone},provider:'synthetic',adapterVersion:'assigned by server',
  }:null;
  async function publishProfile() {
    if(!publicationDefinition)return;
    const {destination,provider,adapterVersion,...routeDefinition} = publicationDefinition;
    await change('/admin/popular-profiles',{
      ...(chosenProfile?{profileId:chosenProfile.id}:{suggestionId:chosenSuggestion!.id}),
      name:profileName.trim(),marketId,routeDefinition,refreshPolicy:refreshPolicy.trim(),reason,
    },chosenProfile?'Synthetic profile refreshed and published. Public browsing now uses the coherent new dataset.':'Synthetic profile calculated and published. Public browsing uses this maintained dataset without starting a custom run.');
  }
  const changeDisabled = busy || reason.trim().length<3;

  return <Panel title="Admin console" id="admin">
    <p>Manage service availability, destination nominations and account allowances. Every change requires an administrator role and an audit reason.</p>
    {error&&<p role="alert">{error}</p>}
    {notice&&<p role="status">{notice}</p>}
    {!data&&busy&&<p role="status">Loading administrator workspace…</p>}
    <Field label="Audit reason" hint="At least three characters; recorded with your administrator identity and the change time.">
      <input value={reason} maxLength={500} onChange={e=>setReason(e.target.value)}/>
    </Field>
    <button onClick={()=>void refresh()} disabled={busy}>Refresh admin state</button>
    {data&&<>
      <h3>Spending stop</h3>
      <p>New run acceptance: {data.killSwitch.enabled?'stopped':'enabled subject to all gates'}</p>
      {data.killSwitch.reason&&<p>Latest operator reason: {data.killSwitch.reason}</p>}
      <p>Public profile browsing and saved snapshots remain available. Releasing the stop still requires the configured account and provider permissions.</p>
      <button disabled={changeDisabled} onClick={()=>void change('/admin/kill-switch',
        {enabled:!data.killSwitch.enabled,reason},data.killSwitch.enabled?'Spending stop released. New runs remain subject to account and service limits.':'New routing work stopped.')}
      >{data.killSwitch.enabled?'Release spending stop':'Stop new routing work'}</button>

      <h3>Destination suggestion queue</h3>
      {!data.suggestions.length&&<p>No suggestions submitted.</p>}
      <ul>{data.suggestions.map(s=><li key={s.id}>
        <p>{s.destination.label} — {s.destination.context} · {s.status.toLowerCase()} · {s.requesterIds.length} distinct requests</p>
        <p>{s.locationType||'Type not specified'} · {s.expectedUsage||'Usage not specified'}</p>
        <div className="actions">
          <button disabled={changeDisabled||s.status==='APPROVED'} onClick={()=>void change(`/admin/suggestions/${encodeURIComponent(s.id)}`,
            {status:'APPROVED',reason},'Nomination approved for review. No route calculation or publication started.')}>Approve nomination</button>
          <button disabled={changeDisabled||s.status==='REJECTED'} onClick={()=>void change(`/admin/suggestions/${encodeURIComponent(s.id)}`,
            {status:'REJECTED',reason},'Nomination rejected. Existing published profiles are unchanged.')}>Reject nomination</button>
        </div>
      </li>)}</ul>
      <p>Approval records a nomination decision. Publishing a new popular profile requires an approved destination, route settings and maintenance configuration.</p>

      <h3>Publish or refresh a popular profile</h3>
      {capabilities?.mode==='demo'?<form onSubmit={event=>{event.preventDefault();void publishProfile();}}>
        <p>Approve a nomination first, then explicitly calculate and publish its profile. This action uses synthetic routes and does not spend a user's custom allowance. Approval alone starts no computation.</p>
        <Field label="Popular profile publication target"><select value={publicationTarget} onChange={event=>choosePublication(event.target.value)}>
          <option value="">Choose an approved destination or published profile</option>
          <optgroup label="Publish an approved nomination">{data.suggestions.filter(item=>item.status==='APPROVED').map(item=><option key={item.id} value={`suggestion:${item.id}`}>{item.destination.label} — {item.destination.context}</option>)}</optgroup>
          <optgroup label="Refresh a published profile">{profiles.map(item=><option key={item.id} value={`profile:${item.id}`}>{item.name}</option>)}</optgroup>
        </select></Field>
        {publicationDestination&&<>
          <p>Confirmed publication point: {publicationDestination.label} — {publicationDestination.context}. Distinct entrances remain separate profiles.</p>
          <div className="control-grid">
            <Field label="Popular profile name"><input value={profileName} minLength={3} maxLength={160} required onChange={event=>setProfileName(event.target.value)}/></Field>
            <Field label="Popular profile market"><select value={marketId} onChange={event=>setMarketId(event.target.value)}>{capabilities.markets.map(market=><option key={market.id} value={market.id}>{market.label}</option>)}</select></Field>
            <Field label="Popular profile travel mode"><select value={mode} onChange={event=>{setMode(event.target.value as RouteDefinition['mode']);setPreference('DEFAULT');setPreferredModes([]);setTimeKind('DEPARTURE');}}>{capabilities.modes.map(value=><option key={value} value={value}>{modeLabels[value]}</option>)}</select></Field>
            {mode==='TRANSIT'&&<Field label="Popular profile transit preference"><select value={preference} onChange={event=>setPreference(event.target.value as RouteDefinition['transitPreference'])}>{capabilities.transitPreferences.map(value=><option key={value} value={value}>{preferenceLabels[value]}</option>)}</select></Field>}
            <Field label="Popular profile journey time basis"><select value={timeKind} onChange={event=>setTimeKind(event.target.value as 'DEPARTURE'|'ARRIVAL')}>{capabilities.timeKinds.filter(kind=>kind!=='ARRIVAL'||mode==='TRANSIT').map(kind=><option key={kind} value={kind}>{kind==='ARRIVAL'?'Arrive by':'Depart at'}</option>)}</select></Field>
            <Field label={`Popular profile date and time (${timezone})`}><input type="datetime-local" value={journeyTime} required onChange={event=>setJourneyTime(event.target.value)}/></Field>
            <Field label="Popular profile refresh policy"><textarea value={refreshPolicy} minLength={5} maxLength={300} required onChange={event=>setRefreshPolicy(event.target.value)}/></Field>
          </div>
          {mode==='TRANSIT'&&!!capabilities.preferredTransitModes.length&&<fieldset><legend>Popular profile preferred transit modes (not guaranteed)</legend>{capabilities.preferredTransitModes.map(value=><label className="check" key={value}><input type="checkbox" checked={preferredModes.includes(value)} onChange={event=>setPreferredModes(event.target.checked?[...preferredModes,value]:preferredModes.filter(item=>item!==value))}/>{value.toLowerCase().replace('_',' ')}</label>)}</fieldset>}
          <p>Publication coverage: {capabilities.markets.find(market=>market.id===marketId)?.coverage}. Property filters never narrow this dataset.</p>
          {publicationDefinition&&<DefinitionSummary definition={publicationDefinition}/>}
          <button disabled={changeDisabled||data.killSwitch.enabled||!publicationDefinition||profileName.trim().length<3||refreshPolicy.trim().length<5}>{chosenProfile?'Refresh synthetic profile':'Publish synthetic profile'}</button>
          {data.killSwitch.enabled&&<p>Release the spending stop before calculating a popular profile.</p>}
        </>}
      </form>:<p>Live publication is unavailable until provider permissions, supported profiles and staging validation are approved.</p>}

      <h3>Published popular profiles</h3>
      {!profiles.length&&<p>No profiles are currently published.</p>}
      <ul>{profiles.map(profile=><li key={profile.id}>
        <p>{profile.name} — {profile.destination.context} · published {dateLabel(profile.publishedAt)}</p>
        <button disabled={changeDisabled} onClick={()=>void change('/admin/actions',
          {action:'UNPUBLISH_PROFILE',targetId:profile.id,reason},'Profile unpublished. The underlying listing inventory is unchanged.')}>Unpublish {profile.name}</button>
      </li>)}</ul>

      <h3>Sources and ingestion</h3>
      {!data.sources.length&&<p>No listing sources are configured.</p>}
      <ul>{data.sources.map(source=>{
        const health = data.sourceHealth.find(item=>item.id===source.id);
        return <li key={source.id}>
          <p>{source.name} · {source.enabled?'enabled':'disabled'} · {source.synthetic?'synthetic':'live'} · agreement {source.permissions.agreementReference}</p>
          {health?<p>Last ingestion {dateLabel(health.observedAt)}: {health.error?'failed':health.complete?'complete':'incomplete'}
            {health.recordCount!==undefined?` · ${health.recordCount} source records`:''}. Incomplete feeds do not remove unseen inventory.</p>
            :<p>No ingestion observation recorded.</p>}
          <button disabled={changeDisabled||(!source.enabled&&(!source.permissions.retrieval||!source.permissions.storage))} onClick={()=>void change('/admin/actions',
            {action:'SOURCE_ENABLED',targetId:source.id,value:!source.enabled,reason},`${source.name} ${source.enabled?'disabled':'enabled'} for future source processing and routing universes.`)}
          >{source.enabled?'Disable':'Enable'} source: {source.name}</button>
        </li>;
      })}</ul>

      <h3>Run operations</h3>
      {!data.runs.length&&<p>No custom runs have been submitted.</p>}
      <ul>{data.runs.map(run=><li key={run.id}>
        <p>Run {run.id} · {run.state.toLowerCase()} · created {dateLabel(run.createdAt)}</p>
        <CountsSummary counts={run.counts}/>
        <p>{run.externalRequests} external requests · {run.externalElements} route elements</p>
        <button disabled={changeDisabled||!['QUEUED','RUNNING'].includes(run.state)} onClick={()=>void change('/admin/actions',
          {action:'CANCEL_RUN',targetId:run.id,reason},'Pending run work cancelled. Accounting follows the configured policy for work already started.')}>Cancel run {run.id}</button>
      </li>)}</ul>
      <details><summary>Provider work counters</summary>
        {data.providerBudget.length?<ul>{data.providerBudget.map(day=><li key={day.id}>{day.id} (UTC) · {day.elements} route elements reserved against the safety budget</li>)}</ul>:<p>No provider budget reservations recorded.</p>}
      </details>

      <h3>Account support requests</h3>
      {!data.supportRequests?.length&&<p>No support requests submitted.</p>}
      <ul>{data.supportRequests?.map(request=><li key={request.id}>
        <p>{request.category.toLowerCase()} · {request.status.toLowerCase()} · account {request.ownerId} · received {dateLabel(request.createdAt)}</p>
        <p>{request.message}</p>
        {request.status==='RESOLVED'?<p>Response: {request.response}</p>:<>
          <Field label={`Support response for ${request.id}`} hint="Write 10–1000 characters explaining the reviewed outcome."><textarea minLength={10} maxLength={1000} value={supportResponses[request.id]??''} onChange={e=>setSupportResponses({...supportResponses,[request.id]:e.target.value})}/></Field>
          <button disabled={changeDisabled||(supportResponses[request.id]??'').trim().length<10} onClick={()=>void change(`/admin/support-requests/${encodeURIComponent(request.id)}`,
            {response:supportResponses[request.id],reason},'Support response recorded. Account allowance policy remains unchanged.')}>Resolve support request {request.id}</button>
        </>}
      </li>)}</ul>
      <p>Resolving a request records a response. Use the separately audited allowance controls if an account policy change is warranted.</p>

      <details><summary>Allowance and retention controls</summary>
        <p>Changes are checked against server limits. This does not create a new entitlement, bypass live verification requirements or erase recorded usage.</p>
        <div className="control-grid">
          <Field label="Entitlement ID">{data.entitlements?<select value={targetEntitlement} onChange={e=>chooseEntitlement(e.target.value)}>
            <option value="">Choose an account allowance</option>{data.entitlements.map(item=><option key={item.id} value={item.id}>{item.id} · {item.status.toLowerCase()}</option>)}
          </select>:<input value={targetEntitlement} onChange={e=>setTargetEntitlement(e.target.value)}/>}</Field>
          <Field label="Daily run allowance"><input type="number" min="0" max="100" value={dailyRuns} onChange={e=>setDailyRuns(Number(e.target.value))}/></Field>
          <Field label="Daily distinct destinations"><input type="number" min="0" max="100" value={dailyDestinations} onChange={e=>setDailyDestinations(Number(e.target.value))}/></Field>
          <Field label="Entitlement status"><select value={policyStatus} onChange={e=>setPolicyStatus(e.target.value as Entitlement['status'])}>
            <option value="ACTIVE">Active</option><option value="SUSPENDED">Suspended</option><option value="VERIFICATION_REQUIRED">Verification required</option>
          </select></Field>
        </div>
        <button disabled={changeDisabled||!targetEntitlement.trim()} onClick={()=>void change('/admin/actions',
          {action:'ENTITLEMENT_POLICY',targetId:targetEntitlement.trim(),value:{dailyRuns,dailyDestinations,status:policyStatus},reason},'Account allowance policy updated. Existing usage remains recorded.')}>Apply entitlement policy</button>
        <Field label="Maximum retention for new runs (hours)"><input type="number" min="0.1" step="0.1" value={retentionHours} onChange={e=>setRetentionHours(Number(e.target.value))}/></Field>
        <p>Retention can only be shortened within the approved maximum. Existing result expiry times remain unchanged.</p>
        <button disabled={changeDisabled} onClick={()=>void change('/admin/actions',
          {action:'RETENTION_HOURS',value:retentionHours,reason},'Retention updated for future runs only.')}>Apply shorter retention</button>
      </details>
      <details><summary>Audit records ({data.audit.length})</summary><pre>{JSON.stringify(data.audit,null,2)}</pre></details>
    </>}
  </Panel>;
}
