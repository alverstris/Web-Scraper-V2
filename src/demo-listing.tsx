import { BrandMark } from './public-site';
import { useEffect, useState } from 'react';
import type { ListingVersion } from '../shared/contracts';
import { api, errorMessage } from './api';
import { dateLabel, Panel } from './ui';

export function DemoListing({ id }: { id: string }) {
  const [listing, setListing] = useState<ListingVersion | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let cancelled = false;
    api<ListingVersion>('/demo/listings/' + encodeURIComponent(id), null)
      .then(data => { if (!cancelled) setListing(data); })
      .catch(failure => { if (!cancelled) setError(errorMessage(failure)); });
    return () => { cancelled = true; };
  }, [id]);
  return <main className="app kw-workspace">
    <header><a className="kw-brand" aria-label="Keywise home" href="/"><BrandMark/><span>Keywise<span className="kw-brand-period">.</span></span></a></header>
    <aside className="demo-banner">Simulated property-provider website. This synthetic listing tests opening the original advertisement in a separate tab.</aside>
    {error ? <p role="alert">{error}</p> : !listing ? <p role="status">Opening the listing…</p> : <Panel title={listing.title}>
      <p>{listing.rent.amount === null ? 'Monthly rent not stated' : 'CHF ' + listing.rent.amount.toLocaleString('en-CH') + ' / month'}</p>
      <p>{listing.location.label} · {listing.location.precision.toLowerCase()} location</p>
      <dl className="facts">
        <div><dt>Rooms</dt><dd>{listing.rooms ?? 'Not stated'}</dd></div>
        <div><dt>Bedrooms</dt><dd>{listing.bedrooms ?? 'Not stated'}</dd></div>
        <div><dt>Floor area</dt><dd>{listing.floorArea === null ? 'Not stated' : listing.floorArea + ' m²'}</dd></div>
        <div><dt>Additional monthly charges</dt><dd>{listing.rent.charges === null ? 'Not stated' : 'CHF ' + listing.rent.charges.toLocaleString('en-CH') + ' / month'}</dd></div>
      </dl>
      <p>Photos and applications are unavailable for synthetic properties. The live service opens the authorised provider's original page.</p>
      <p>Source last observed {dateLabel(listing.lastSeenAt)}.</p>
    </Panel>}
    <a href="/dashboard">Return to your Keywise search</a>
  </main>;
}
