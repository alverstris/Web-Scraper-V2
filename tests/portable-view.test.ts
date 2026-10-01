import test from 'node:test';
import assert from 'node:assert/strict';
import { exportSnapshot, importSnapshot, PORTABLE_LIMITS, SnapshotError } from '../shared/portable.ts';
import { filterDataset } from '../shared/view.ts';
import { demoDestinations, demoListings } from '../shared/fixtures.ts';
import type { Dataset, RouteRow, ViewState } from '../shared/contracts.ts';

const at = '2026-09-30T12:00:00Z';
function fixture(): Dataset {
  const listings = structuredClone([demoListings[0], demoListings[1], demoListings[2], demoListings[22]]);
  const rows: RouteRow[] = listings.map((listing, index) => ({
    listingId: listing.id, listingVersion: listing.version,
    state: index === 3 ? 'UNRESOLVED_ORIGIN' : 'SUCCESS',
    ...(index === 3 ? {} : { durationSeconds: index === 0 ? 1200 : 600 }),
    warnings: [], provider: 'synthetic', calculatedAt: at,
  }));
  return {
    id: 'synthetic-snapshot', definition: { destination: structuredClone(demoDestinations[0]), direction: 'HOME_TO_DESTINATION', mode: 'TRANSIT', transitPreference: 'DEFAULT', preferredTransitModes: [], timeBasis: { kind: 'ARRIVAL', at: '2026-10-06T08:00:00+02:00', timezone: 'Europe/Zurich' }, provider: 'synthetic', adapterVersion: 'synthetic-v1' },
    marketId: 'ch-vaud-demo', coverage: 'Four synthetic test listings.', universeVersion: 'fixture-v1', createdAt: at, calculatedAt: at, state: 'COMPLETE',
    counts: { total: 4, completed: 4, success: 3, noRoute: 0, unresolved: 1, failed: 0 }, listings, rows, synthetic: true, exportAllowed: true,
    attribution: ['All values are synthetic fixtures; no live listings or routing data.'],
  };
}
function invalidFile(change: (file: any) => void): string {
  const file = JSON.parse(exportSnapshot(fixture()));
  change(file);
  return JSON.stringify(file);
}
const all: ViewState = { sort: 'COMMUTE_ASC', includeUnavailable: true };

test('A21 portable round trip preserves the entire immutable universe, provenance and original timestamps', () => {
  const original = fixture();
  const before = JSON.stringify(original);
  const narrow = filterDataset(original, { ...all, maxRent: 700 });
  assert.equal(narrow.length, 1);
  const encoded = exportSnapshot(original);
  assert.equal(JSON.parse(encoded).rights.basis, 'SYNTHETIC_FIXTURE_PERMISSION');
  const restored = importSnapshot(encoded);
  assert.deepEqual(restored, original);
  assert.equal(restored.listings.length, 4);
  assert.equal(restored.calculatedAt, at);
  assert.equal(restored.definition.timeBasis.at, '2026-10-06T08:00:00+02:00');
  assert.equal(JSON.stringify(original), before);
  assert.ok(Object.isFrozen(restored));
  assert.ok(Object.isFrozen(restored.listings[0].facilities));
  assert.throws(() => { restored.listings[0].title = 'changed'; }, TypeError);
});

test('A02/A21 importing and repeatedly exploring data make no network calls', () => {
  const originalFetch = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = (() => { requests++; throw new Error('Network is prohibited in local snapshot exploration'); }) as typeof fetch;
  try {
    const restored = importSnapshot(exportSnapshot(fixture()));
    for (let index = 0; index < 20; index++) filterDataset(restored, { ...all, maxRent: 600 + index * 50, sort: index % 2 ? 'RENT_DESC' : 'COMMUTE_ASC' });
    assert.equal(requests, 0);
  } finally { globalThis.fetch = originalFetch; }
});

test('A21/A31 export fails closed for incomplete, unpermitted and live datasets', () => {
  assert.throws(() => exportSnapshot({ ...fixture(), state: 'PARTIAL' }), (error: unknown) => error instanceof SnapshotError && error.code === 'INCOMPLETE_DATASET');
  assert.throws(() => exportSnapshot({ ...fixture(), exportAllowed: false }), (error: unknown) => error instanceof SnapshotError && error.code === 'EXPORT_NOT_PERMITTED');
  assert.throws(() => exportSnapshot({ ...fixture(), synthetic: false }), (error: unknown) => error instanceof SnapshotError && error.code === 'LIVE_RIGHTS_UNCONFIGURED');
  assert.throws(() => importSnapshot(invalidFile(file => { file.rights.basis = 'OWNER_SAYS_ALLOWED'; })));
  assert.throws(() => importSnapshot(invalidFile(file => { file.dataset.synthetic = false; })));
});

test('A22 malformed, compressed, oversized and deeply nested files fail with readable errors', () => {
  assert.throws(() => importSnapshot('{broken'), (error: unknown) => error instanceof SnapshotError && error.code === 'INVALID_JSON');
  assert.throws(() => importSnapshot('\u001f\u008bcompressed'), SnapshotError);
  assert.throws(() => importSnapshot(' '.repeat(PORTABLE_LIMITS.bytes + 1)), (error: unknown) => error instanceof SnapshotError && error.code === 'TOO_LARGE');
  assert.throws(() => importSnapshot('['.repeat(PORTABLE_LIMITS.nesting + 1) + '0' + ']'.repeat(PORTABLE_LIMITS.nesting + 1)), (error: unknown) => error instanceof SnapshotError && error.code === 'TOO_DEEP');
  assert.throws(() => importSnapshot(invalidFile(file => { file.schemaVersion = 42; })), (error: unknown) => error instanceof SnapshotError && error.code === 'UNSUPPORTED_VERSION');
});

test('A22 script markup, unsafe URLs and sensitive metadata are rejected', () => {
  for (const title of ['<script>alert(1)</script>', '<img src=x onerror=alert(1)>', 'javascript:alert(1)']) {
    assert.throws(() => importSnapshot(invalidFile(file => { file.dataset.listings[0].title = title; })));
  }
  for (const url of ['javascript:alert(1)', 'data:text/html,hello', 'https://user:secret@example.com/item', 'https://localhost/item', 'https://127.0.0.1/item', 'https://[::1]/item', 'https://api.internal/item', 'https://example.com/item?token=secret', 'https://example.com/item#private', 'http://example.com/item']) {
    assert.throws(() => importSnapshot(invalidFile(file => { file.dataset.listings[0].sourceUrl = url; })), `unsafe source URL accepted: ${url}`);
  }
  assert.throws(() => importSnapshot(invalidFile(file => { file.dataset.entitlement = { dailyRuns: 100 }; })));
  assert.throws(() => importSnapshot(invalidFile(file => { file.dataset.listings[0].evidence.apiKey = 'secret'; })));
  assert.throws(() => importSnapshot(invalidFile(file => { file.rights.trackingId = 'campaign'; })));
});

test('A16/A22 references, unique records and completeness must reconcile', () => {
  const mutations = [
    (file: any) => { file.dataset.counts.success = 4; },
    (file: any) => { file.dataset.rows.pop(); },
    (file: any) => { file.dataset.rows[0].listingVersion = 'new-version'; },
    (file: any) => { file.dataset.rows[0].listingId = 'missing'; },
    (file: any) => { file.dataset.rows[1] = file.dataset.rows[0]; },
    (file: any) => { file.dataset.listings[1] = file.dataset.listings[0]; },
    (file: any) => { file.dataset.listings[0].marketId = 'different-market'; },
    (file: any) => { file.dataset.counts.total = PORTABLE_LIMITS.rows + 1; },
  ];
  for (const mutate of mutations) assert.throws(() => importSnapshot(invalidFile(mutate)), SnapshotError);
});

test('A12–A15/A17 route and location values must be honest and time assumptions explicit', () => {
  const mutations = [
    (file: any) => { delete file.dataset.rows[0].durationSeconds; },
    (file: any) => { file.dataset.rows[3].durationSeconds = 0; },
    (file: any) => { file.dataset.rows[0].durationSeconds = -1; },
    (file: any) => { file.dataset.rows[0].walkingSeconds = 99999; },
    (file: any) => { file.dataset.listings[0].location.point.lat = 100; },
    (file: any) => { file.dataset.listings[3].location.point = { lat: 46, lng: 6 }; },
    (file: any) => { file.dataset.definition.timeBasis.at = '2026-10-06T08:00:00'; },
    (file: any) => { file.dataset.definition.timeBasis.timezone = 'Not/A-Timezone'; },
    (file: any) => { file.dataset.definition.mode = 'WALK'; file.dataset.definition.transitPreference = 'LESS_WALKING'; },
  ];
  for (const mutate of mutations) assert.throws(() => importSnapshot(invalidFile(mutate)), SnapshotError);
});

test('A12 property constraints exclude unknown values and preserve rooms/private-shared distinctions', () => {
  const data = fixture();
  assert.equal(data.listings[0].bedrooms, null);
  assert.ok(!filterDataset(data, { ...all, minBedrooms: 0 }).some(item => item.listing.id === data.listings[0].id));
  assert.ok(!filterDataset(data, { ...all, minArea: 0 }).some(item => item.listing.id === data.listings[0].id));
  assert.ok(!filterDataset(data, { ...all, minBathrooms: 0 }).some(item => item.listing.id === data.listings[0].id));
  assert.equal(filterDataset(data, { ...all, minRooms: 2.5 }).length, 3);
  assert.throws(()=>filterDataset(data, { ...all, minBedrooms: 2.5 }), /expected int/i);
  assert.ok(!filterDataset(data, { ...all, facilities: { washingMachine: 'PRIVATE' } }).some(item => item.listing.facilities.washingMachine === 'SHARED'));
  data.listings[0].rent.amount = null;
  assert.ok(!filterDataset(data, { ...all, maxRent: 10_000 }).some(item => item.listing.id === data.listings[0].id));
});

test('A15 sorting puts unavailable routes last in either direction and resolves ties by stable id', () => {
  const data = fixture();
  data.listings[3].rent.amount = 0;
  for (const sort of ['COMMUTE_ASC','COMMUTE_DESC','RENT_ASC','RENT_DESC'] as const) {
    const visible = filterDataset(data, { ...all, sort });
    assert.equal(visible.at(-1)?.route.state, 'UNRESOLVED_ORIGIN');
  }
  assert.deepEqual(filterDataset(data, all).slice(0, 2).map(item => item.listing.id), ['demo-2','demo-3']);
  const originalOrder = data.listings.map(item => item.id);
  filterDataset(data, { ...all, sort: 'COMMUTE_DESC' });
  assert.deepEqual(data.listings.map(item => item.id), originalOrder);
  assert.equal(filterDataset(data, { ...all, includeUnavailable: false }).length, 3);
  assert.equal(filterDataset(data, { ...all, maxCommuteMinutes: 10 }).length, 2);
});

test('A02/A29 geographic filters use real points, including date-line bounds, without changing the universe', () => {
  const data = fixture();
  data.listings[0].location.point = { lat: 1, lng: 179 };
  data.listings[1].location.point = { lat: 1, lng: -179 };
  data.listings[2].location.point = { lat: 1, lng: 10 };
  assert.deepEqual(filterDataset(data, { ...all, bounds: { north: 2, south: 0, west: 170, east: -170 } }).map(item => item.listing.id).sort(), ['demo-1','demo-2']);
  assert.deepEqual(filterDataset(data, { ...all, bounds: { north: 2, south: 0, west: 0, east: 20 } }).map(item => item.listing.id), ['demo-3']);
  assert.equal(data.listings.length, 4);
  assert.equal(data.counts.total, 4);
});

test('Progressive views do not invent routes for candidate listings still awaiting a batch', () => {
  const data = fixture(); data.state = 'RUNNING'; data.rows.pop();
  assert.equal(filterDataset(data, all).length, 3);
  assert.equal(data.listings.length, 4);
});
