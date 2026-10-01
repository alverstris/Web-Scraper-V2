import { useEffect, useRef, useState } from 'react';
import type { AccountView } from '../shared/contracts';
import { App } from './App';
import { AdminConsole } from './admin';
import { api, errorMessage, setCsrfToken, subscribeSessionExpiry } from './api';
import { DemoListing } from './demo-listing';
import { BrandMark, PublicSite } from './public-site';
import { Field } from './ui';

type AuthResponse = { account: AccountView | null; csrfToken: string | null };

function SignIn({ staff, navigate, onAuthenticated, dashboardPath }: { staff: boolean; navigate: (path: string) => void; onAuthenticated: (response: AuthResponse) => void; dashboardPath: string }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit() {
    if (busy) return;
    setBusy(true); setError('');
    try {
      const response = await api<AuthResponse>(staff ? '/auth/staff-login' : '/auth/login', null, { method: 'POST', body: { email, password } });
      onAuthenticated(response); navigate(staff ? '/staff' : dashboardPath);
    } catch (failure) { setError(errorMessage(failure)); }
    finally { setBusy(false); }
  }
  return <div className="kw-auth">
    <a className="skip-link" href="#sign-in-main">Skip to sign in</a>
    <header><a className="kw-brand" aria-label="Keywise home" href="/" onClick={event => { event.preventDefault(); navigate('/'); }}><BrandMark/><span>Keywise<span className="kw-brand-period">.</span></span></a></header>
    <main id="sign-in-main" className="kw-auth-card">
      <p className="kw-eyebrow">{staff ? 'Staff access' : 'Your next home starts here'}</p>
      <h1>{staff ? 'Staff sign in' : 'Welcome to Keywise'}</h1>
      <p>{staff ? 'Sign in with your staff account to manage destinations, sources, and customer access.' : 'Sign in to explore homes by commute time, save snapshots, and manage your searches.'}</p>
      <form onSubmit={event => { event.preventDefault(); void submit(); }}>
        <Field label="Email address"><input type="email" name="email" autoComplete="username" required value={email} onChange={event => setEmail(event.target.value)} /></Field>
        <Field label="Password"><input type="password" name="password" autoComplete="current-password" required value={password} onChange={event => setPassword(event.target.value)} /></Field>
        {error && <p className="error" role="alert">{error}</p>}
        <button className="kw-button kw-button-primary" disabled={busy} type="submit">{busy ? 'Signing in…' : staff ? 'Staff sign in' : 'Sign in'}</button>
      </form>
      <p className="muted">{staff ? 'Customer accounts cannot access the staff workspace.' : 'This local preview uses the supplied mock accounts. Google and Microsoft sign-in will be connected before launch.'}</p>
      <a href="/" onClick={event => { event.preventDefault(); navigate('/'); }}>Back to Keywise</a>
    </main>
  </div>;
}

export function KeywiseApp() {
  const [path, setPath] = useState(window.location.pathname);
  const [search, setSearch] = useState(window.location.search);
  const [account, setAccount] = useState<AccountView | null>(null);
  const [loading, setLoading] = useState(true);
  const [connectionError, setConnectionError] = useState('');
  const [sessionNotice, setSessionNotice] = useState('');
  const identityGeneration = useRef(0);
  const requestedProfile = new URLSearchParams(search).get('profile') ?? undefined;
  const profileQuery = requestedProfile ? '?profile=' + encodeURIComponent(requestedProfile) : '';
  const dashboardPath = '/dashboard' + profileQuery;
  function navigate(next: string, replace = false) {
    const destination = new URL(next, window.location.origin);
    if (next !== window.location.pathname + window.location.search) {
      if (replace) history.replaceState(null, '', next); else history.pushState(null, '', next);
    }
    setPath(destination.pathname); setSearch(destination.search); window.scrollTo(0, 0);
  }
  function authenticated(response: AuthResponse) {
    identityGeneration.current++;
    setCsrfToken(response.csrfToken); setAccount(response.account); setSessionNotice(''); setConnectionError('');
  }
  useEffect(() => {
    const onPopState = () => { setPath(window.location.pathname); setSearch(window.location.search); };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);
  async function loadSession() {
    const generation = identityGeneration.current;
    setLoading(true); setConnectionError('');
    try {
      const response = await api<AuthResponse>('/auth/session', null);
      if (generation === identityGeneration.current) authenticated(response);
    }
    catch (failure) { if (generation === identityGeneration.current) setConnectionError(errorMessage(failure)); }
    finally { setLoading(false); }
  }
  useEffect(() => { void loadSession(); }, []);
  useEffect(() => subscribeSessionExpiry(() => {
    identityGeneration.current++;
    setCsrfToken(null); setAccount(null);
    setSessionNotice('Your sign-in has expired. Sign in again to access your searches.');
    navigate(path.startsWith('/staff') ? '/staff/sign-in' : '/sign-in', true);
  }), [path]);
  useEffect(() => {
    if (loading || connectionError) return;
    if (path === '/dashboard' && !account) navigate('/sign-in' + profileQuery, true);
    else if (path === '/staff' && !account?.admin) navigate('/staff/sign-in', true);
    else if (path === '/sign-in' && account) navigate(dashboardPath, true);
    else if (path === '/staff/sign-in' && account?.admin) navigate('/staff', true);
  }, [path, search, account, loading, connectionError]);
  useEffect(() => {
    document.title = `${path === '/dashboard' ? 'Your search' : path.startsWith('/staff') ? 'Staff access' : path === '/sign-in' ? 'Sign in' : 'Find a home that fits your commute'} · Keywise`;
  }, [path]);
  async function signOut() {
    try { authenticated(await api<AuthResponse>('/auth/logout', null, { method: 'POST' })); navigate('/'); }
    catch (failure) { setConnectionError(errorMessage(failure)); }
  }
  const protectedPath = path === '/dashboard' || path === '/staff';
  if (protectedPath && (loading || connectionError)) return <div className="kw-auth"><main className="kw-auth-card"><h1>Keywise</h1>
    {connectionError ? <><p className="error" role="alert">{connectionError}</p><button onClick={() => void loadSession()}>Try connecting again</button></> : <p role="status">Opening your workspace…</p>}
  </main></div>;
  const listing = path.match(/^\/demo-listing\/([^/]+)$/);
  if (listing) return <DemoListing id={decodeURIComponent(listing[1])} />;
  if (path === '/open-snapshot') return <App key="snapshot-viewer" session={{ token: null, label: 'Visitor', providers: [] }} offlineOnly onHome={() => navigate('/')} onSignOut={() => navigate('/')} onSignIn={() => navigate('/sign-in')} />;
  if (path === '/dashboard' && account) return <App key={account.uid + ':' + (requestedProfile ?? '')} initialProfileId={requestedProfile} session={{ ...account, token: null }} onSignOut={() => void signOut()} onHome={() => navigate('/')} />;
  if (path === '/staff' && account?.admin) return <div className="app kw-workspace kw-staff">
    <a className="skip-link" href="#staff-main">Skip to staff workspace</a>
    <header className="kw-workspace-header"><div className="kw-workspace-top"><a className="kw-brand" aria-label="Keywise home" href="/" onClick={event => { event.preventDefault(); navigate('/'); }}><BrandMark/><span>Keywise<span className="kw-brand-period">.</span></span></a>
      <div className="actions"><span>{account.label}</span><button onClick={() => navigate('/dashboard')}>View customer dashboard</button><button onClick={() => void signOut()}>Sign out</button></div></div>
      <h1>Staff workspace</h1><p>Manage published destinations, operational limits, and account support.</p></header>
    <main id="staff-main"><AdminConsole token={null} /></main>
  </div>;
  if (path === '/sign-in' || path === '/staff/sign-in') return <>{sessionNotice && <p className="notice" role="status">{sessionNotice}</p>}
    <SignIn key={path} staff={path === '/staff/sign-in'} navigate={navigate} onAuthenticated={authenticated} dashboardPath={dashboardPath} /></>;
  if (protectedPath) return <div className="kw-auth"><p role="status">Redirecting to sign in…</p></div>;
  return <PublicSite path={path} navigate={navigate} signedIn={!!account} />;
}
