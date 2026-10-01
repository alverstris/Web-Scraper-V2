import { useEffect, useState } from 'react';
import type { AccountSupportRequest, Capabilities, EntitlementView } from '../shared/contracts';
import type { Session } from './auth';
import { api, errorMessage } from './api';
import { dateLabel, Field, Panel } from './ui';

export function AccountPanel({ session, entitlement, capabilities, busy, onSignOut }: {
  session: Session; entitlement: EntitlementView | null; capabilities: Capabilities | null; busy: boolean;
  onSignOut: () => void;
}) {
  const [supportOpen, setSupportOpen] = useState(false);
  const [requests, setRequests] = useState<AccountSupportRequest[]>([]);
  const [message, setMessage] = useState('');
  const [supportError, setSupportError] = useState('');
  const [sending, setSending] = useState(false);
  useEffect(() => {
    setRequests([]); setMessage(''); setSupportError(''); setSupportOpen(false);
    if (!session.uid) return;
    let cancelled = false;
    api<AccountSupportRequest[]>('/me/support-requests', session.token)
      .then(data => { if (!cancelled) setRequests(data); })
      .catch(error => { if (!cancelled) setSupportError(errorMessage(error)); });
    return () => { cancelled = true; };
  }, [session.uid]);
  async function requestSupport() {
    if (!session.uid || sending) return;
    setSending(true); setSupportError('');
    try {
      const request = await api<AccountSupportRequest>('/account-support-requests', session.token, {
        method: 'POST', body: { category: entitlement?.supportRequired ? 'ACCESS' : 'ALLOWANCE', message },
      });
      setRequests(previous => [...previous, request]); setMessage('');
    } catch (error) { setSupportError(errorMessage(error)); }
    finally { setSending(false); }
  }
  const suspended = entitlement?.entitlement?.status === 'SUSPENDED';
  return <Panel title="Your account" id="account">
      <p>Signed in as <strong>{session.name ?? session.label}</strong>.</p>
      {session.email && <p>{session.email}</p>}
      {!entitlement ? <p role="status">Loading your allowance…</p> : <>
        <p role="status">{suspended ? 'Custom searches are suspended' : entitlement.verificationRequired ? 'Account access needs review' : entitlement.remainingRuns === 0 ? 'Daily run allowance used' : 'Custom searches available'} · {entitlement.remainingRuns} runs remaining · {entitlement.remainingDestinations} new destinations remaining</p>
        <p>Your allowance resets {dateLabel(entitlement.resetsAt)} ({entitlement.entitlement?.timezone ?? 'Europe/Zurich'}).</p>
        {suspended && <p>Contact account support to review access. You can still browse popular results and open your saved snapshots.</p>}
        {entitlement.verificationRequired && <p>Contact account support to review custom-run access. You can still use popular profiles and snapshots.</p>}
        {entitlement.remainingRuns === 0 && !suspended && <p>Browse popular results or reopen a saved snapshot while you wait for your next allowance. Changing filters uses no runs.</p>}
        {entitlement.remainingDestinations === 0 && entitlement.remainingRuns > 0 && !suspended && <p>You can calculate another profile for a destination already used today. A new destination needs the next allowance day.</p>}
      </>}
      <div className="actions"><button disabled={busy} onClick={onSignOut}>Sign out of this account</button></div>
      <button aria-expanded={supportOpen} onClick={() => setSupportOpen(value => !value)}>Contact account support</button>
      {supportOpen && <section aria-label="Account support">
        <p>Explain the access or allowance issue. Do not include passwords, verification codes, or private destination details.</p>
        <form onSubmit={event => { event.preventDefault(); void requestSupport(); }}>
          <Field label="Support message"><textarea value={message} onChange={event => setMessage(event.target.value)} minLength={10} maxLength={1000} required /></Field>
          <button disabled={sending || message.trim().length < 10}>{sending ? 'Sending…' : 'Send support request'}</button>
        </form>
        {supportError && <p role="alert">{supportError}</p>}
        {requests.length > 0 && <ul aria-label="Your support requests">{requests.map(request => <li key={request.id}>
          <p>Request {request.id} · {request.status === 'RESOLVED' ? 'Answered' : 'Awaiting review'}</p>
          <p>{request.message}</p>{request.response && <p>Support response: {request.response}</p>}
          {capabilities?.mode === 'demo' && <p className="muted">Your request has been saved. Staff can review and respond to it.</p>}
        </li>)}</ul>}
      </section>}
  </Panel>;
}
