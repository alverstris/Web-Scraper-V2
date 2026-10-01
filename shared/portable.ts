import { z } from 'zod';
import type { Dataset } from './contracts';

export const PORTABLE_LIMITS = Object.freeze({ bytes: 8 * 1024 * 1024, rows: 10_000, nesting: 20 });
export class SnapshotError extends Error {
  constructor(public readonly code: string, message: string) { super(message); this.name = 'SnapshotError'; }
}

const plainText = (max = 2048) => z.string().max(max).refine(
  value => !/[<>\u0000-\u0008\u000B\u000C\u000E-\u001F]|(?:javascript|vbscript|data)\s*:/i.test(value),
  'Only plain text is allowed in a portable snapshot.',
);
const id = plainText(160).min(1);
const isoTime = z.string().max(40).datetime({ offset: true });
const nonnegative = z.number().finite().nonnegative();
const count = nonnegative.int().max(PORTABLE_LIMITS.rows);
const point = z.object({ lat: z.number().finite().min(-90).max(90), lng: z.number().finite().min(-180).max(180) }).strict();
const locationShape = { point: point.optional(), label: plainText(), precision: z.enum(['EXACT','BUILDING','STREET','LOCALITY','UNRESOLVED']), provenance: plainText() };
const location = z.object(locationShape).strict();
const destination = z.object({ ...locationShape, id, country: plainText(100), locality: plainText(256), context: plainText() }).strict();
const facility = z.enum(['PRIVATE','SHARED','ABSENT','UNKNOWN','REVIEW']);
const dangerousKey = /^(?:__proto__|prototype|constructor|(?:access|refresh|id)?token|authorization|credentials?|secrets?|api[_-]?key|password|entitlement(?:Id|s)?|quotas?|phone|email|verificationEvidence|trackingId|campaignId)$/i;

/** Canonical public HTTPS source links only. These links are never fetched by import. */
function safeSourceUrl(value: string): boolean {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    return url.protocol === 'https:' && !url.username && !url.password && !url.hash && !url.search &&
      value === url.href && host.length <= 253 && host.includes('.') &&
      !host.endsWith('.') && !host.includes(':') && !/^\d+(?:\.\d+){3}$/.test(host) &&
      !/(?:^|\.)(?:localhost|local|internal|lan|home|onion)$/.test(host) &&
      !host.endsWith('.arpa') && /^[a-z0-9.-]+$/.test(host) &&
      host.split('.').every(label => /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label)) &&
      (url.port === '' || url.port === '443');
  } catch { return false; }
}

const listing = z.object({
  id, sourceId: id, sourceListingId: id, version: id, marketId: id,
  sourceUrl: plainText(2048).refine(safeSourceUrl, 'Source URL must be a canonical public HTTPS link without tracking parameters.'),
  title: plainText(512), location, active: z.boolean(), status: z.enum(['ROUTABLE','APPROXIMATE','UNRESOLVED','INACTIVE']),
  rent: z.object({ amount: nonnegative.max(100_000_000).nullable(), currency: z.string().regex(/^[A-Z]{3}$/), period: z.enum(['MONTH','WEEK']), charges: nonnegative.max(100_000_000).nullable() }).strict(),
  propertyType: plainText(128), floorArea: nonnegative.max(1_000_000).nullable(), rooms: nonnegative.max(10_000).nullable(), bedrooms: nonnegative.int().max(10_000).nullable(), bathrooms: nonnegative.max(10_000).nullable(),
  furnishing: z.enum(['FURNISHED','UNFURNISHED','PARTIAL','UNKNOWN']),
  facilities: z.object({ washingMachine: facility, dryer: facility, kitchen: facility, dishwasher: facility, airConditioning: facility, balcony: facility, parking: facility }).strict(),
  evidence: z.record(plainText(128).refine(key => !dangerousKey.test(key), 'Sensitive evidence keys are prohibited.'), plainText(8192)).refine(value => Object.keys(value).length <= 64, 'Too many evidence entries.'),
  extractionVersion: id, firstSeenAt: isoTime, lastSeenAt: isoTime, sourceUpdatedAt: isoTime.nullable(), ingestedAt: isoTime,
}).strict();

const definition = z.object({
  destination, direction: z.literal('HOME_TO_DESTINATION'), mode: z.enum(['WALK','BICYCLE','DRIVE','TRANSIT']),
  transitPreference: z.enum(['DEFAULT','LESS_WALKING','FEWER_TRANSFERS']),
  preferredTransitModes: z.array(z.enum(['BUS','SUBWAY','TRAIN','LIGHT_RAIL','RAIL'])).max(5),
  timeBasis: z.object({ kind: z.enum(['DEPARTURE','ARRIVAL']), at: isoTime, timezone: plainText(100).refine(value => { try { new Intl.DateTimeFormat('en', { timeZone: value }); return true; } catch { return false; } }, 'Unknown time zone.') }).strict(),
  provider: z.enum(['synthetic','google']), adapterVersion: id,
}).strict().superRefine((value, ctx) => {
  if (value.mode !== 'TRANSIT' && (value.transitPreference !== 'DEFAULT' || value.preferredTransitModes.length > 0)) ctx.addIssue({ code: 'custom', message: 'Transit settings cannot apply to another mode.' });
  if (value.mode !== 'TRANSIT' && value.timeBasis.kind === 'ARRIVAL') ctx.addIssue({ code: 'custom', message: 'Arrival-time routing requires public transport.' });
  if (new Set(value.preferredTransitModes).size !== value.preferredTransitModes.length) ctx.addIssue({ code: 'custom', message: 'Transit modes must be unique.' });
  if (!value.destination.point || value.destination.precision === 'UNRESOLVED') ctx.addIssue({ code: 'custom', message: 'A snapshot needs a confirmed destination point.' });
});

const row = z.object({
  listingId: id, listingVersion: id, state: z.enum(['SUCCESS','NO_ROUTE','UNRESOLVED_ORIGIN','UNSUPPORTED_SETTINGS','PROVIDER_ERROR']),
  durationSeconds: nonnegative.max(31_536_000).optional(), distanceMeters: nonnegative.max(100_000_000).optional(), walkingSeconds: nonnegative.max(31_536_000).optional(), transfers: nonnegative.int().max(10_000).optional(), geometry: plainText(131_072).optional(),
  warnings: z.array(plainText()).max(32), provider: id, calculatedAt: isoTime,
}).strict().superRefine((value, ctx) => {
  if (value.state === 'SUCCESS' && value.durationSeconds === undefined) ctx.addIssue({ code: 'custom', message: 'A successful route needs a measured duration.' });
  if (value.state !== 'SUCCESS' && [value.durationSeconds,value.distanceMeters,value.walkingSeconds,value.transfers,value.geometry].some(item => item !== undefined)) ctx.addIssue({ code: 'custom', message: 'Unavailable routes cannot contain measured route details.' });
  if (value.walkingSeconds !== undefined && value.durationSeconds !== undefined && value.walkingSeconds > value.durationSeconds) ctx.addIssue({ code: 'custom', message: 'Walking duration cannot exceed total duration.' });
});

const datasetSchema = z.object({
  id, definition, marketId: id, coverage: plainText(), universeVersion: id,
  createdAt: isoTime, calculatedAt: isoTime, state: z.literal('COMPLETE'),
  counts: z.object({ total: count, completed: count, success: count, noRoute: count, unresolved: count, failed: count }).strict(),
  listings: z.array(listing).max(PORTABLE_LIMITS.rows), rows: z.array(row).max(PORTABLE_LIMITS.rows),
  synthetic: z.literal(true), exportAllowed: z.literal(true), attribution: z.array(plainText()).min(1).max(32),
}).strict().superRefine((value, ctx) => {
  const invalid = (message: string) => ctx.addIssue({ code: 'custom', message });
  if (value.definition.provider !== 'synthetic') invalid('Synthetic snapshots must use the synthetic provider.');
  const listingRefs = new Map(value.listings.map(item => [item.id, item.version]));
  const resolvedOrigins = new Set(value.listings.filter(item => item.location.point).map(item => item.id));
  if (listingRefs.size !== value.listings.length) invalid('Listing identifiers must be unique.');
  const rowIds = new Set<string>();
  for (const item of value.rows) {
    if (rowIds.has(item.listingId)) invalid('A listing can have only one route row.');
    rowIds.add(item.listingId);
    if (listingRefs.get(item.listingId) !== item.listingVersion) invalid('Route references must match the frozen listing version.');
    if (item.provider !== 'synthetic') invalid('Synthetic snapshots cannot contain live provider rows.');
    if (item.state === 'SUCCESS' && !resolvedOrigins.has(item.listingId)) invalid('A successful route needs a resolved origin point.');
  }
  if (value.listings.some(item => item.marketId !== value.marketId)) invalid('Every listing must belong to the declared market.');
  if (value.listings.some(item => item.location.precision === 'UNRESOLVED' ? item.location.point !== undefined : item.location.point === undefined)) invalid('Location coordinates must agree with their stated precision.');
  const actual = {
    total: value.listings.length,
    completed: value.rows.length,
    success: value.rows.filter(item => item.state === 'SUCCESS').length,
    noRoute: value.rows.filter(item => item.state === 'NO_ROUTE').length,
    unresolved: value.rows.filter(item => item.state === 'UNRESOLVED_ORIGIN').length,
    failed: value.rows.filter(item => item.state === 'UNSUPPORTED_SETTINGS' || item.state === 'PROVIDER_ERROR').length,
  };
  if (actual.total !== actual.completed || Object.entries(actual).some(([key, number]) => value.counts[key as keyof typeof actual] !== number)) invalid('Completeness counts must reconcile with every listing and route row.');
});

const RIGHTS = Object.freeze({ basis: 'SYNTHETIC_FIXTURE_PERMISSION', listingData: 'EXPORT_AND_REOPEN', routingData: 'EXPORT_AND_REOPEN', attributionRequired: true } as const);
const envelope = z.object({
  format: z.literal('commute-property-search-snapshot'), schemaVersion: z.literal(1),
  rights: z.object({ basis: z.literal(RIGHTS.basis), listingData: z.literal(RIGHTS.listingData), routingData: z.literal(RIGHTS.routingData), attributionRequired: z.literal(true) }).strict(),
  dataset: datasetSchema,
}).strict();

function ensureTextBounds(text: string): void {
  // Raw JSON only: compressed files are rejected; there is no decompression bomb path.
  if (new TextEncoder().encode(text).byteLength > PORTABLE_LIMITS.bytes) throw new SnapshotError('TOO_LARGE', `Snapshot exceeds ${PORTABLE_LIMITS.bytes / 1024 / 1024} MiB.`);
  let depth = 0, quoted = false, escaped = false;
  for (const char of text) {
    if (quoted) { if (escaped) escaped = false; else if (char === '\\') escaped = true; else if (char === '"') quoted = false; continue; }
    if (char === '"') quoted = true;
    else if (char === '{' || char === '[') { if (++depth > PORTABLE_LIMITS.nesting) throw new SnapshotError('TOO_DEEP', 'Snapshot nesting is too deep.'); }
    else if (char === '}' || char === ']') depth--;
  }
}

function validate(value: unknown): Dataset {
  if (value && typeof value === 'object' && 'schemaVersion' in value && value.schemaVersion !== 1) throw new SnapshotError('UNSUPPORTED_VERSION', 'This snapshot version is not supported. Export it using a compatible application.');
  const parsed = envelope.safeParse(value);
  if (!parsed.success) throw new SnapshotError('INVALID_SNAPSHOT', `Invalid snapshot: ${parsed.error.issues[0]?.message ?? 'schema validation failed'}`);
  return parsed.data.dataset;
}

function freezeDeep<T>(value: T): T {
  if (value && typeof value === 'object') { Object.freeze(value); for (const item of Object.values(value)) freezeDeep(item); }
  return value;
}

/** Export the entire completed universe. No ViewState parameter can narrow coverage. */
export function exportSnapshot(dataset: Dataset): string {
  if (!dataset.exportAllowed) throw new SnapshotError('EXPORT_NOT_PERMITTED', 'Export is unavailable because this dataset does not have export permission.');
  if (!dataset.synthetic) throw new SnapshotError('LIVE_RIGHTS_UNCONFIGURED', 'Live snapshot rights have not been configured. Only clearly labelled synthetic fixtures can be exported.');
  if (dataset.state !== 'COMPLETE') throw new SnapshotError('INCOMPLETE_DATASET', 'Wait for a complete dataset before exporting.');
  const payload = { format: 'commute-property-search-snapshot', schemaVersion: 1, rights: RIGHTS, dataset };
  validate(payload);
  const text = JSON.stringify(payload);
  ensureTextBounds(text);
  return text;
}

/** Parse locally (prefer a browser worker); never fetch, route, or issue entitlements. */
export function importSnapshot(text: string): Dataset {
  ensureTextBounds(text);
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw new SnapshotError('INVALID_JSON', 'This file is not a valid uncompressed JSON snapshot.'); }
  return freezeDeep(validate(value));
}
