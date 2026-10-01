import { BrandMark } from './public-site';
import { useEffect, useRef, useState } from 'react';
import type { Capabilities, CreateRunRequest, Dataset, Destination, EntitlementView, PopularProfile, RouteDefinition, RunManifest, ViewState } from '../shared/contracts';
import { api, ApiError, errorMessage } from './api';
import type { Session } from './auth';
import { AccountPanel } from './account';
import { RunChallenge } from './challenge';
import { PropertyFilters, ResultExplorer } from './results';
import { ChoiceGroup, CountsSummary, DefinitionSummary, Field, Panel, dateLabel, modeLabels, preferenceLabels, useReducedMotion } from './ui';
import { DatasetWorker, type ResultItem } from './worker-client';
import { PORTABLE_LIMITS } from '../shared/portable';
import { SEARCH_TIMEZONE, journeyDateInput, parseJourneyDateInput } from './journey-time';
import { applicableViewForDataset } from '../shared/view';

type Journey = 'popular' | 'custom' | 'saved' | 'suggestion';
const initialView: ViewState = { sort: 'COMMUTE_ASC', includeUnavailable: true };
function tomorrowInput() {
  return journeyDateInput(Date.now() + 86_400_000).slice(0, 10) + 'T09:00';
}
function terminal(run: RunManifest) { return ['COMPLETE', 'PARTIAL', 'FAILED', 'CANCELLED'].includes(run.state); }
function sourceUrl(value: string) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('This source link is unavailable.');
  return url.href;
}

export function App({ session, onSignOut, onHome, offlineOnly = false, onSignIn, initialProfileId }: { session: Session; onSignOut: () => void; onHome: () => void; offlineOnly?: boolean; onSignIn?: () => void; initialProfileId?: string }) {
  const reducedMotion = useReducedMotion();
  const [capabilities, setCapabilities] = useState<Capabilities | null>(null);
  const [profiles, setProfiles] = useState<PopularProfile[]>([]);
  const [requestedProfileId, setRequestedProfileId] = useState<string | null>(null);
  const [entitlement, setEntitlement] = useState<EntitlementView | null>(null);
  const [journey, setJourney] = useState<Journey>(offlineOnly ? 'saved' : 'popular');
  const [accountOpen, setAccountOpen] = useState(false);
  const [dataset, setDataset] = useState<Dataset | null>(null);
  const [imported, setImported] = useState(false);
  const [view, setView] = useState<ViewState>(initialView);
  const [items, setItems] = useState<ResultItem[]>([]);
  const [filteredDatasetId, setFilteredDatasetId] = useState<string | null>(null);
  const [filtering, setFiltering] = useState(false);
  const [bootError, setBootError] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState('');
  const [query, setQuery] = useState('');
  const [candidates, setCandidates] = useState<Destination[]>([]);
  const [searched, setSearched] = useState(false);
  const [selection, setSelection] = useState<{ selectionId: string; destination: Destination } | null>(null);
  const [mode, setMode] = useState<RouteDefinition['mode']>('TRANSIT');
  const [preference, setPreference] = useState<RouteDefinition['transitPreference']>('DEFAULT');
  const [preferredModes, setPreferredModes] = useState<RouteDefinition['preferredTransitModes']>([]);
  const [timeKind, setTimeKind] = useState<'DEPARTURE' | 'ARRIVAL'>('DEPARTURE');
  const [journeyTime, setJourneyTime] = useState(tomorrowInput);
  const [marketId, setMarketId] = useState('');
  const [confirmation, setConfirmation] = useState<CreateRunRequest | null>(null);
  const [run, setRun] = useState<RunManifest | null>(null);
  const [discardConfirmation, setDiscardConfirmation] = useState(false);
  const [recoveryId, setRecoveryId] = useState('');
  const [recoveryError, setRecoveryError] = useState('');
  const [locationType, setLocationType] = useState('');
  const [expectedUsage, setExpectedUsage] = useState('');
  const [challengeToken, setChallengeToken] = useState<string | null>(null);
  const [challengeReset, setChallengeReset] = useState(0);
  const worker = useRef<DatasetWorker | null>(null);
  const workerDataset = useRef<Dataset | null>(null);
  const privateOwner = useRef<string | null>(null);
  const submission = useRef(false);
  const identityGeneration = useRef(0);
  const currentUid = useRef<string | undefined>(undefined);
  const token = session.token;
  const signedIn = !!session.uid;
  const activeRun = run && !terminal(run);
  const timezone = SEARCH_TIMEZONE;

  useEffect(() => { worker.current = new DatasetWorker(); return () => worker.current?.dispose(); }, []);
  async function refreshCapabilities() {
    const [caps, popular] = await Promise.all([api<Capabilities>('/capabilities', null), api<PopularProfile[]>('/popular-destinations', null)]);
    setCapabilities(caps); setProfiles(popular); setMarketId(current => current || caps.markets[0]?.id || '');
    return caps;
  }
  useEffect(() => {
    if (offlineOnly) return;
    let cancelled = false;
    void (async () => {
      try {
        const [caps, popular] = await Promise.all([api<Capabilities>('/capabilities', null), api<PopularProfile[]>('/popular-destinations', null)]);
        if (cancelled) return;
        setCapabilities(caps); setProfiles(popular); setMarketId(caps.markets[0]?.id || '');
        const profile = popular.find(item => item.id === initialProfileId) ?? popular.find(item => item.destination.id === 'epfl-east') ?? popular[0];
        if (profile) {
          const data = await api<Dataset>('/popular-profiles/' + encodeURIComponent(profile.id), null);
          if (!cancelled) setDataset(data);
        }
      } catch (failure) { if (!cancelled) setBootError(errorMessage(failure)); }
    })();
    return () => { cancelled = true; };
  }, []);
  useEffect(() => {
    if (currentUid.current === session.uid) return;
    currentUid.current = session.uid; identityGeneration.current++;
    setEntitlement(null); setSelection(null); setCandidates([]); setSearched(false); setConfirmation(null);
    setRun(null); setDiscardConfirmation(false);
    if (privateOwner.current) { setDataset(null); privateOwner.current = null; }
    setError(''); setNotice(''); setRecoveryError('');
  }, [session.uid]);
  useEffect(() => {
    if (!signedIn) { setEntitlement(null); return; }
    let cancelled = false;
    api<EntitlementView>('/me/entitlement', token).then(data => { if (!cancelled) setEntitlement(data); })
      .catch(failure => { if (!cancelled) setError(errorMessage(failure)); });
    return () => { cancelled = true; };
  }, [session.uid]);
  useEffect(() => {
    if (!signedIn) return;
    let cancelled = false;
    const refresh = async () => {
      try {
        const data = await api<EntitlementView>('/me/entitlement', token);
        if (!cancelled) setEntitlement(data);
        const caps = await api<Capabilities>('/capabilities', null);
        if (!cancelled) setCapabilities(caps);
      } catch (failure) { if (!cancelled) setError(errorMessage(failure)); }
    };
    const timer = entitlement?.resetsAt ? setTimeout(() => void refresh(), Math.max(100, Math.min(Date.parse(entitlement.resetsAt) - Date.now() + 100, 2_147_483_647))) : undefined;
    const onFocus = () => { void refresh(); };
    window.addEventListener('focus', onFocus);
    return () => { cancelled = true; clearTimeout(timer); window.removeEventListener('focus', onFocus); };
  }, [session.uid, entitlement?.resetsAt]);
  useEffect(() => {
    if (!dataset || !worker.current) { setItems([]); setFilteredDatasetId(null); return; }
    let cancelled = false; setFiltering(true);
    const ready = workerDataset.current === dataset ? Promise.resolve() : worker.current.set(dataset);
    workerDataset.current = dataset;
    ready.then(() => worker.current!.filter(view)).then(rows => {
      if (!cancelled) { setItems(rows); setFilteredDatasetId(dataset.id); setFiltering(false); }
    }).catch(failure => { if (!cancelled) { setError(errorMessage(failure)); setFiltering(false); } });
    return () => { cancelled = true; };
  }, [dataset, view]);
  useEffect(() => {
    if (!run?.id || !signedIn) return;
    const id = run.id; let stopped = false; let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const [manifest, results] = await Promise.all([api<RunManifest>('/runs/' + encodeURIComponent(id), token), api<Dataset>('/runs/' + encodeURIComponent(id) + '/results', token)]);
        if (stopped) return;
        setRun(manifest); setDataset(results); privateOwner.current = manifest.ownerId; setImported(false);
        if (terminal(manifest)) {
          const allowance = await api<EntitlementView>('/me/entitlement', token);
          if (!stopped) setEntitlement(allowance);
        } else timer = setTimeout(() => void poll(), 1200);
      } catch (failure) {
        if (stopped) return;
        setError(errorMessage(failure));
        if (failure instanceof ApiError && [401, 403, 404, 410].includes(failure.status)) {
          setRun(null); setDataset(null); privateOwner.current = null;
          setRecoveryError(failure.status === 410 ? 'These temporary results have expired or were discarded. Open a saved snapshot or choose a new search.' : 'This run is unavailable to the signed-in account. Check the recovery ID and account.');
        } else timer = setTimeout(() => void poll(), 5000);
      }
    }
    void poll(); return () => { stopped = true; clearTimeout(timer); };
  }, [run?.id, session.uid]);
  useEffect(() => {
    if (!run) return;
    const timer = setTimeout(() => {
      setRun(null); setDataset(null); privateOwner.current = null;
      setRecoveryError('These temporary results have expired. Reopen an exported snapshot or choose a new search.');
      setNotice('Your temporary run has expired. No new calculation was started.');
    }, Math.max(0, Math.min(Date.parse(run.expiresAt) - Date.now(), 2_147_483_647)));
    return () => clearTimeout(timer);
  }, [run?.id, run?.expiresAt]);

  async function action(key: string, fn: () => Promise<void>) {
    setBusy(key); setError(''); setNotice('');
    try { await fn(); } catch (failure) { setError(errorMessage(failure)); } finally { setBusy(''); }
  }
  function draftChanged() { setConfirmation(null); setChallengeToken(null); }
  function navigate(next: Journey) { setJourney(next); setAccountOpen(false); setError(''); }
  async function loadProfile(profile: PopularProfile, preserveFilters = false) {
    setRequestedProfileId(profile.id);
    await action('popular', async () => {
      const data = await api<Dataset>('/popular-profiles/' + encodeURIComponent(profile.id), null);
      setRun(null); setDataset(data); privateOwner.current = null; setImported(false);
      setView(current => preserveFilters ? applicableViewForDataset(current, data) : initialView);
      setNotice('Popular results loaded. No custom run was used.');
    });
    setRequestedProfileId(null);
  }
  async function searchDestination() {
    if (!signedIn) { setAccountOpen(true); return; }
    const generation = identityGeneration.current;
    await action('location', async () => {
      setSelection(null); setConfirmation(null); setSearched(false);
      const data = await api<{ candidates: Destination[] }>('/location-selections', token, { method: 'POST', body: { query } });
      if (generation !== identityGeneration.current) return;
      setCandidates(data.candidates); setSearched(true);
    });
  }
  async function selectDestination(destination: Destination) {
    const generation = identityGeneration.current;
    await action('selection', async () => {
      const data = await api<{ selectionId: string; destination: Destination }>('/location-selections', token, { method: 'POST', body: { destinationId: destination.id } });
      if (generation !== identityGeneration.current) return;
      setSelection(data); setConfirmation(null);
      setNotice('Destination confirmed. Choose your commute settings, then review the calculation.');
    });
  }
  const newDestination = !!selection && !entitlement?.usedDestinationIds.includes(selection.destination.id);
  const destinationLimit = newDestination && entitlement?.remainingDestinations === 0;
  const suspended = entitlement?.entitlement?.status === 'SUSPENDED';
  const runBlocked = !signedIn ? 'Sign in to calculate a custom commute.' : !entitlement ? 'Loading your allowance…'
    : suspended ? 'Custom searches are suspended. Contact account support to review access.'
    : entitlement.remainingRuns < 1 ? 'No runs remain today. Browse popular results, reopen a snapshot, or wait for your allowance to reset.'
    : entitlement.verificationRequired ? 'Custom-run access is not available for this account. Contact account support.'
    : destinationLimit ? 'Your new-destination allowance is used. Choose a destination already used today or wait for the allowance reset.'
    : !capabilities?.features.customRuns ? 'New custom calculations are currently unavailable. Browse popular results or reopen a snapshot.'
    : !selection ? 'Find and confirm the exact destination first.' : '';
  function reviewRun() {
    setError(''); if (!selection || !journeyTime || runBlocked) return;
    const at = parseJourneyDateInput(journeyTime, timezone);
    if (!at) { setError('Choose a valid, unambiguous journey date and time in ' + timezone + '. Avoid the hour when the clocks change.'); return; }
    setConfirmation({ idempotencyKey: crypto.randomUUID(), destinationSelectionId: selection.selectionId, marketId, searchScope: 'STANDARD',
      routeDefinition: { direction: 'HOME_TO_DESTINATION', mode, transitPreference: mode === 'TRANSIT' ? preference : 'DEFAULT', preferredTransitModes: mode === 'TRANSIT' ? preferredModes : [], timeBasis: { kind: timeKind, at: at.toISOString(), timezone } } });
  }
  async function startRun() {
    if (!confirmation || submission.current || runBlocked) return;
    if (capabilities?.mode === 'live' && !challengeToken) { setError('Complete the security check before starting this run.'); return; }
    submission.current = true; const generation = identityGeneration.current;
    await action('start', async () => {
      const manifest = await api<RunManifest>('/runs', token, { method: 'POST', body: { ...confirmation, ...(challengeToken ? { verificationChallenge: challengeToken } : {}) } });
      if (generation !== identityGeneration.current) return;
      setRun(manifest); setDataset(null); privateOwner.current = manifest.ownerId; setImported(false); setView(initialView); setConfirmation(null); setAccountOpen(false);
      setNotice('Your private calculation has started. Filters will not start another run.');
      const allowance = await api<EntitlementView>('/me/entitlement', token);
      if (generation === identityGeneration.current) setEntitlement(allowance);
    });
    submission.current = false; setChallengeToken(null); setChallengeReset(value => value + 1);
  }
  async function importFile(file: File | undefined) {
    if (!file) return;
    await action('import', async () => {
      if (file.size > PORTABLE_LIMITS.bytes) throw new Error('This file is too large. Choose an uncompressed snapshot no larger than 8 MiB.');
      const data = await worker.current!.import(await file.text());
      setRun(null); setDataset(data); privateOwner.current = null; setImported(true); setView(initialView);
      setNotice('Saved snapshot opened locally. No data was uploaded and no routes were recalculated.');
    });
  }
  const exportDisabledReason = !dataset ? 'Load results or open a snapshot first.'
    : dataset.state !== 'COMPLETE' ? 'Only a complete dataset can be exported. Partial or cancelled results cannot be saved as a complete snapshot.'
    : !dataset.exportAllowed ? 'These results do not have permission for portable export.'
    : !dataset.synthetic && !capabilities?.features.export ? 'Live export is unavailable until data permissions are approved.' : '';
  async function exportFile() {
    await action('export', async () => {
      if (!dataset || exportDisabledReason) return;
      await worker.current!.set(dataset); const data = await worker.current!.export();
      const url = URL.createObjectURL(new Blob([data], { type: 'application/json' }));
      const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'keywise-snapshot-' + dataset.calculatedAt.slice(0, 10) + '.json'; anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setNotice('The complete snapshot was saved, including properties outside your current filters.');
    });
  }
  async function recoverRun() {
    setRecoveryError('');
    const generation = identityGeneration.current;
    await action('recover', async () => {
      try {
        const manifest = await api<RunManifest>('/runs/' + encodeURIComponent(recoveryId.trim()), token);
        if (generation !== identityGeneration.current) return;
        setRun(manifest); setDataset(null); privateOwner.current = manifest.ownerId; setImported(false); setView(initialView);
        setNotice('Your existing run was recovered. No new calculation was requested.');
      } catch (failure) {
        if (generation !== identityGeneration.current) return;
        setRecoveryError(failure instanceof ApiError && failure.status === 410 ? 'These results have expired or were discarded. Open a saved snapshot or choose a new search.'
          : failure instanceof ApiError && failure.status === 404 ? 'No accessible run was found. Check the ID and sign in to the account that created it.' : errorMessage(failure));
      }
    });
  }
  async function openSource(item: ResultItem) {
    const popup = window.open('about:blank', '_blank'); if (popup) popup.opener = null;
    try {
      let url = sourceUrl(item.listing.sourceUrl);
      if (dataset?.synthetic && item.listing.sourceId === 'synthetic-rentals') url = new URL('/demo-listing/' + encodeURIComponent(item.listing.id), location.origin).href;
      else if (!imported) {
        try { url = sourceUrl((await api<{ url: string }>('/outbound/' + encodeURIComponent(item.listing.id), token)).url); }
        catch { setNotice('The original listing will open without referral tracking.'); }
      }
      if (popup) popup.location.replace(url); else setNotice('Your browser blocked the new tab. Open this source link: ' + url);
    } catch (failure) { popup?.close(); setError(errorMessage(failure)); }
  }

  const activeProfile = profiles.find(profile => profile.datasetId === dataset?.id)
    ?? profiles.find(profile => profile.definition.destination.id === dataset?.definition.destination.id && profile.definition.mode === dataset?.definition.mode)
    ?? profiles[0];
  const requestedProfile = profiles.find(profile => profile.id === requestedProfileId);
  const selectedProfile = requestedProfile ?? activeProfile;
  const savedDestinations = profiles.filter((profile, index) => profiles.findIndex(item => item.destination.id === profile.destination.id) === index);
  const savedModes = profiles.filter(profile => profile.destination.id === selectedProfile?.destination.id)
    .filter((profile, index, choices) => choices.findIndex(item => item.definition.mode === profile.definition.mode) === index);

  const destinationFinder = <section aria-label="Choose destination"><h3>1. Confirm where you need to arrive</h3>
    <form onSubmit={event => { event.preventDefault(); void searchDestination(); }}><div className="control-grid">
      <Field label="Destination name or address"><input value={query} onChange={event => { setQuery(event.target.value); setSelection(null); setCandidates([]); setSearched(false); draftChanged(); }} placeholder={capabilities?.mode === 'demo' ? 'EPFL, UNIL, Lausanne station' : 'Place name or full address'} minLength={2} maxLength={200} required /></Field>
      <button type="submit" disabled={!!busy || query.trim().length < 2}>Find destination</button></div></form>
    {searched && !candidates.length && <p role="status">No destination matched. Try a more complete place name or address. No calculation was started.</p>}
    <ul className="candidate-list">{candidates.map(destination => <li key={destination.id}>
      <p><strong>{destination.label}</strong> · {destination.locality}, {destination.country}</p><p>{destination.context}</p>
      <p>{destination.precision === 'EXACT' ? 'Exact destination point' : 'Approximate destination'}{destination.point && ' · ' + destination.point.lat + ', ' + destination.point.lng}</p>
      {entitlement?.usedDestinationIds.includes(destination.id) && <p>Used today — does not use a new destination from your allowance.</p>}
      <button disabled={!!busy} aria-pressed={selection?.destination.id === destination.id} onClick={() => void selectDestination(destination)}>Confirm this destination: {destination.label}</button>
    </li>)}</ul>
    {selection && <p className="notice">Confirmed: {selection.destination.label} — {selection.destination.context}.</p>}
  </section>;

  return <div className="app kw-workspace" data-reduced-motion={reducedMotion}>
    <a className="skip-link" href="#main">Skip to search</a>
    <header className="kw-workspace-header">
      <div className="kw-workspace-top"><a className="kw-brand" aria-label="Keywise home" href="/" onClick={event => { event.preventDefault(); onHome(); }}><BrandMark/><span>Keywise<span className="kw-brand-period">.</span></span></a>
        <div className="actions">{offlineOnly ? <button onClick={onSignIn}>Sign in</button> : <><span>{session.label}</span><button onClick={onSignOut}>Sign out</button></>}</div></div>
      <h1>{offlineOnly ? 'Your saved search' : 'Your commute search'}</h1><p>{offlineOnly ? 'Open your snapshot and explore it privately on this device.' : 'Find a home that fits the journey you make every day.'}</p>
      <nav aria-label="Search sections">
        {!offlineOnly && <>
        <button aria-pressed={journey === 'popular' && !accountOpen} onClick={() => navigate('popular')}>Popular destinations</button>
        <button aria-pressed={journey === 'custom' && !accountOpen} onClick={() => navigate('custom')}>Custom commute</button>
        </>}
        <button aria-pressed={journey === 'saved' && !accountOpen} onClick={() => navigate('saved')}>Open / save snapshot</button>
        {!offlineOnly && <button aria-pressed={accountOpen} onClick={() => setAccountOpen(value => !value)}>Your account</button>}
      </nav>
      {entitlement && <p className="account-summary">{session.label} · {entitlement.remainingRuns} runs remaining · {entitlement.remainingDestinations} new destinations remaining · Filtering uses no runs</p>}
    </header>
    <main id="main">
      {error && <div className="error" role="alert"><p>{error}</p><button onClick={() => setError('')}>Dismiss error</button></div>}
      {notice && <p className="notice" role="status">{notice}</p>}
      {!offlineOnly && !capabilities && <div role="status"><p>{bootError ? 'The online service is unavailable. You can still open a saved snapshot.' : 'Connecting to the search service…'}</p>
        {bootError && <><button onClick={() => void action('reconnect', async () => { await refreshCapabilities(); setBootError(''); })}>Try connecting again</button><details><summary>Connection details</summary><p>{bootError}</p></details></>}
      </div>}
      {accountOpen && <AccountPanel key={session.uid} session={session} entitlement={entitlement} capabilities={capabilities} busy={!!busy}
        onSignOut={onSignOut} />}
      {journey === 'popular' && <Panel title="Popular destinations" id="popular">
        <p>Choose a destination and how you travel. These saved results use no runs.</p>
        {!!profiles.length && <div className="control-grid saved-commute-controls">
          <Field label="Saved destination"><select disabled={!!busy || !!activeRun} value={selectedProfile?.destination.id ?? ''} onChange={event => {
            const choices = profiles.filter(profile => profile.destination.id === event.target.value);
            const next = choices.find(profile => profile.definition.mode === activeProfile?.definition.mode) ?? choices[0];
            if (next) void loadProfile(next, true);
          }}>{savedDestinations.map(profile => <option key={profile.destination.id} value={profile.destination.id}>{profile.destination.label}</option>)}</select></Field>
          <ChoiceGroup label="Travel mode" hint="Prepared results for this destination · no custom run used" disabled={!!busy || !!activeRun} value={selectedProfile?.definition.mode ?? 'TRANSIT'} onChange={value => {
            const next = profiles.find(profile => profile.destination.id === selectedProfile?.destination.id && profile.definition.mode === value);
            if (next) void loadProfile(next, true);
          }} options={savedModes.map(profile=>({value:profile.definition.mode,label:modeLabels[profile.definition.mode]}))}/>
        </div>}
        {requestedProfile&&<p role="status">Loading {modeLabels[requestedProfile.definition.mode].toLowerCase()} results for {requestedProfile.destination.label}…</p>}
        <details className="kw-profile-picker" open={!dataset}><summary>Change destination profile</summary><div className="profile-grid">{profiles.map(profile => <article key={profile.id}>
          <h3>{profile.name}</h3><p>{profile.destination.label} · {profile.destination.context}</p>
          <p>{modeLabels[profile.definition.mode]} · {preferenceLabels[profile.definition.transitPreference]}</p>
          <p>{profile.definition.timeBasis.kind === 'ARRIVAL' ? 'Arrive by' : 'Depart at'} {dateLabel(profile.definition.timeBasis.at)} · {profile.definition.timeBasis.timezone}</p>
          <p>Coverage: {capabilities?.markets.find(market => market.id === profile.marketId)?.coverage ?? 'See results for published coverage.'}</p>
          <p>Published {dateLabel(profile.publishedAt)} · {profile.refreshPolicy}</p>
          <button disabled={!!busy || !!activeRun} onClick={() => void loadProfile(profile)}>Load {profile.name}</button>
        </article>)}</div></details>
        {capabilities && !profiles.length && <p>No popular profiles are available right now. Configure a custom commute or reopen a saved snapshot.</p>}
        {activeRun && <p>Finish or cancel the active calculation before replacing its results.</p>}
      </Panel>}
      {journey === 'custom' && <Panel title="Custom commute settings" id="custom">
        <p>Make one explicit calculation for the supported market, then explore all its properties with free filters.</p>
        {!signedIn ? <p>Sign in above to choose a destination and review your allowance. Nothing is calculated when you sign in.</p> : <>
          {destinationFinder}
          {selection && <section aria-label="Commute settings"><h3>2. Choose how and when you travel</h3>
            <div className="control-grid">
              <Field label="Supported market"><select value={marketId} onChange={event => { setMarketId(event.target.value); draftChanged(); }}>{capabilities?.markets.map(market => <option key={market.id} value={market.id}>{market.label}</option>)}</select></Field>
              <ChoiceGroup label="Travel mode" value={mode} options={(capabilities?.modes??[]).map(value=>({value,label:modeLabels[value]}))} onChange={value => { setMode(value); setTimeKind('DEPARTURE'); setPreference('DEFAULT'); setPreferredModes([]); draftChanged(); }}/>
              {mode === 'TRANSIT' && <ChoiceGroup label="Transit preference" hint="A route preference; walking and transfer limits are set in the result filters." value={preference} options={(capabilities?.transitPreferences??[]).map(value=>({value,label:preferenceLabels[value]}))} onChange={value=>{setPreference(value);draftChanged();}}/>}
              <ChoiceGroup label="Journey time basis" value={timeKind} options={(capabilities?.timeKinds??[]).filter(kind=>kind!=='ARRIVAL'||mode==='TRANSIT').map(value=>({value,label:value==='ARRIVAL'?'Arrive by':'Depart at'}))} onChange={value=>{setTimeKind(value);draftChanged();}}/>
              <Field label={'Journey date and time (' + timezone + ')'}><input type="datetime-local" value={journeyTime} onChange={event => { setJourneyTime(event.target.value); draftChanged(); }} required /></Field>
            </div>
            {mode === 'TRANSIT' && !!capabilities?.preferredTransitModes.length && <details><summary>Preferred transit types</summary><fieldset className="transit-type-filters"><legend>Preferred transit modes (other modes may still be returned)</legend><div className="transit-type-options">{capabilities.preferredTransitModes.map(value => <label className="check" key={value}><input type="checkbox" checked={preferredModes.includes(value)} onChange={event => { setPreferredModes(event.target.checked ? [...preferredModes, value] : preferredModes.filter(current => current !== value)); draftChanged(); }} />{{BUS:'Bus',SUBWAY:'Metro',TRAIN:'Train',LIGHT_RAIL:'Light rail',RAIL:'Rail'}[value]}</label>)}</div></fieldset></details>}
            <p>Home to destination. A return journey is a separate calculation.</p>
            <p>Standard coverage: {capabilities?.markets.find(market => market.id === marketId)?.coverage ?? 'No supported market is configured'}. Rent, bedrooms, furnishing, and map filters do not narrow this calculation.</p>
            {dataset && <p>These are draft settings. The results below still show their original destination, transport settings, and time.</p>}
            {entitlement && <p>Available: {entitlement.remainingRuns} custom runs · {entitlement.remainingDestinations} new destinations. Resets {dateLabel(entitlement.resetsAt)} ({entitlement.entitlement?.timezone}).</p>}
            {runBlocked && <p role="status">{runBlocked}</p>}{suspended && <button onClick={() => setAccountOpen(true)}>Review account access</button>}
            <button disabled={!!busy || !!activeRun || !!runBlocked || !journeyTime} onClick={reviewRun}>Review custom run</button>
            {activeRun && <p>Finish or cancel your current calculation before starting another.</p>}
          </section>}
          {confirmation && selection && <section className="confirmation" aria-label="Confirm custom run"><h3>3. Confirm this calculation</h3>
            <DefinitionSummary definition={{ ...confirmation.routeDefinition, destination: selection.destination, provider: capabilities?.mode === 'demo' ? 'synthetic' : 'google', adapterVersion: 'assigned by server' }} />
            <p>All eligible listing versions in {capabilities?.markets.find(market => market.id === confirmation.marketId)?.label} will be included. Property filters do not apply to this calculation.</p>
            <p>This reserves one custom run{newDestination ? ' and one new destination' : ' for a destination already used today'}. Remaining afterwards: {Math.max(0, (entitlement?.remainingRuns ?? 0) - 1)} runs and {Math.max(0, (entitlement?.remainingDestinations ?? 0) - (newDestination ? 1 : 0))} new destinations.</p>
            <p>Cancellation before routing starts releases the reservation. Once routing starts, cancellation or a partial failure can still use the run.</p>
            {capabilities?.mode === 'live' && <RunChallenge onToken={setChallengeToken} resetKey={challengeReset} />}
            <div className="actions"><button disabled={!!busy || !!runBlocked || (capabilities?.mode === 'live' && !challengeToken)} onClick={() => void startRun()}>{busy === 'start' ? 'Submitting…' : 'Confirm and start one run'}</button><button disabled={!!busy} onClick={() => setConfirmation(null)}>Return to draft</button></div>
          </section>}
        </>}
      </Panel>}
      {run && <Panel title="Custom run progress" id="progress">
        <p role="status">{run.state} · allowance {run.accounting.toLowerCase()}</p><progress value={run.counts.completed} max={run.counts.total || 1} aria-label="Completed route attempts" /><CountsSummary counts={run.counts} />
        <p>{run.accounting === 'RELEASED' ? 'The run reservation was released.' : run.accounting === 'FINALISED' ? 'One run was used because routing work started.' : 'One run is reserved while this calculation is pending.'}</p>
        <p>Recovery ID: <code>{run.id}</code> · temporary access ends {dateLabel(run.expiresAt)}</p>
        <button onClick={() => void action('copy', async () => { await navigator.clipboard.writeText(run.id); setNotice('Recovery ID copied. Only the account that created the run can use it.'); })}>Copy recovery ID</button>
        {run.errors.map((message, index) => <p key={index}>{message}</p>)}
        <div className="actions"><button disabled={!!busy || terminal(run)} onClick={() => void action('cancel', async () => {
          const updated = await api<RunManifest>('/runs/' + encodeURIComponent(run.id) + '/cancel', token, { method: 'POST' });
          setRun(updated); setDataset(await api<Dataset>('/runs/' + encodeURIComponent(run.id) + '/results', token)); setEntitlement(await api<EntitlementView>('/me/entitlement', token));
          setNotice(updated.accounting === 'RELEASED' ? 'Calculation cancelled. Its allowance reservation was released.' : 'Pending work was cancelled. Work already started still uses one run.');
        })}>Cancel pending work</button><button disabled={!!busy || !terminal(run)} onClick={() => setDiscardConfirmation(true)}>Discard stored results</button></div>
        {discardConfirmation && <section aria-label="Confirm discard"><p>Discard these temporary results? Your used allowance is unchanged. Export a permitted complete snapshot first if you want to keep the results.</p>
          <button disabled={!!busy} onClick={() => void action('discard', async () => { await api('/runs/' + encodeURIComponent(run.id), token, { method: 'DELETE' }); setRun(null); setDataset(null); privateOwner.current = null; setDiscardConfirmation(false); setNotice('Stored custom results discarded. Used allowance is unchanged.'); })}>Discard results permanently</button>
          <button disabled={!!busy} onClick={() => setDiscardConfirmation(false)}>Keep results</button>
        </section>}
      </Panel>}
      {journey === 'saved' && <Panel title="Portable snapshots and run recovery" id="portable">
        <p>Reopen a saved search without recalculating any routes. A snapshot preserves the entire dataset and its original calculation assumptions; it does not refresh listing availability.</p>
        <div className="actions"><Field label="Open a saved search snapshot"><input type="file" accept=".json,application/json" disabled={!!busy || !!activeRun} onChange={event => { void importFile(event.target.files?.[0]); event.target.value = ''; }} /></Field><button disabled={!!busy || !!exportDisabledReason} onClick={() => void exportFile()}>Export complete snapshot</button></div>
        {exportDisabledReason && <p>{exportDisabledReason}</p>}{activeRun && <p>Finish or cancel the active run before replacing its results with a snapshot.</p>}
        <p>Files are checked locally. Nothing is uploaded. Results stay in this tab until you leave unless you explicitly save a snapshot.</p>
        <h3>Recover temporary results</h3>
        {!signedIn ? <><p>Sign in to the account that created the run. Recovery does not spend another run.</p><button onClick={onSignIn}>Sign in to recover a run</button></> : <form onSubmit={event => { event.preventDefault(); void recoverRun(); }}>
          <div className="control-grid"><Field label="Recover your temporary run by ID"><input value={recoveryId} onChange={event => { setRecoveryId(event.target.value); setRecoveryError(''); }} placeholder="Your recovery ID" maxLength={200} /></Field><button disabled={!recoveryId.trim() || !!busy || !!activeRun}>Recover existing run</button></div>
        </form>}{recoveryError && <p role="alert">{recoveryError}</p>}
      </Panel>}
      {dataset && <><PropertyFilters view={view} setView={setView} dataset={dataset} />
        <ResultExplorer dataset={dataset} items={filteredDatasetId === dataset.id ? items : []} view={view} setView={setView} imported={imported} busy={filtering || filteredDatasetId !== dataset.id} onSource={item => void openSource(item)} onSave={() => void exportFile()} saveDisabled={!!busy || !!exportDisabledReason} onEditCommute={offlineOnly ? undefined : () => navigate('custom')} />
        {exportDisabledReason && <p>{exportDisabledReason}</p>}<button onClick={() => navigate('saved')}>Open another snapshot or recover a run</button>
      </>}
      {journey === 'suggestion' && <Panel title="Suggest a popular destination" id="suggestion">
        <p>Nominate the exact place you need to reach. This creates a request for review, not a calculation or automatic publication.</p>
        {suspended && <p>Destination nominations need an active account. Contact account support to review access.</p>}
        {signedIn && <>{destinationFinder}{selection && <form onSubmit={event => { event.preventDefault(); void action('suggest', async () => {
          const result = await api<{ id: string; status: string; distinctRequests: number }>('/popular-destination-suggestions', token, { method: 'POST', body: { destinationSelectionId: selection.selectionId, locationType: locationType || undefined, expectedUsage: expectedUsage || undefined } });
          setNotice('Nomination recorded for review. ' + result.distinctRequests + ' distinct eligible requests. No calculation was started.');
        }); }}><div className="control-grid"><Field label="Location type (optional)"><input value={locationType} onChange={event => setLocationType(event.target.value)} placeholder="University, workplace…" maxLength={120} /></Field><Field label="Expected usage (optional)"><input value={expectedUsage} onChange={event => setExpectedUsage(event.target.value)} placeholder="For example, weekdays" maxLength={300} /></Field></div><button disabled={!!busy || suspended}>Submit nomination</button></form>}</>}
      </Panel>}
      {!offlineOnly && <button onClick={() => navigate('suggestion')}>Suggest a popular destination</button>}
    </main>
    <footer><p>Keywise · Sample EPFL housing data. Listings are fictional and commute times are simulated.</p></footer>
  </div>;
}
