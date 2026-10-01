# Provider configuration

Demo mode uses explicitly synthetic listing, location and route adapters. Live mode has working adapter composition, but is disabled unless an operator supplies reviewed provider configuration and secrets. Configuring adapters does not itself enable custom runs, publication or portable export: the application launch policy separately controls those features. No live credentials, feed contracts or bounded live-provider validation are included in this handover.

Set `PROVIDER_CONFIG_PATH` to a server-only JSON file and `GOOGLE_MAPS_SERVER_KEY` to the restricted server key. Keep the JSON outside frontend assets and source control when it contains private agreement details. Feed credentials are environment-variable references, never literal values in this JSON. All enabled feeds must be authorised and belong to configured application markets.

The exact version-1 shape is:

```json
{
  "schemaVersion": 1,
  "google": {
    "agreementReference": "Replace with the reviewed applicable agreement reference",
    "storageApproved": true,
    "locationStorageApproved": true,
    "expiresAt": "2027-01-01T00:00:00Z"
  },
  "feeds": [
    {
      "source": {
        "id": "approved-rentals",
        "name": "Replace with authorised provider name",
        "canonicalHosts": ["feed.example.com", "www.example.com"],
        "enabled": true,
        "synthetic": false,
        "marketId": "approved-market",
        "attribution": "Replace with the required source attribution",
        "permissions": {
          "retrieval": true,
          "storage": true,
          "export": false,
          "descriptions": false,
          "images": false,
          "agreementReference": "Replace with the listing supply agreement reference",
          "reviewedAt": "2026-09-30T00:00:00Z"
        }
      },
      "endpoint": "https://feed.example.com/authorised/normalized-listings.json",
      "tokenEnvName": "APPROVED_FEED_TOKEN"
    }
  ]
}
```

These names, hosts, approvals and dates are illustrative placeholders, not supplied permissions. `storageApproved` records approval for this application's permitted temporary route retention; `locationStorageApproved` records permission to retain the location data the app uses. They do not establish popular precomputation or export rights. Review the applicable agreements before setting them. Expired, malformed or incomplete Google permission records fail before a provider request. At least one live feed, unique source IDs, required attribution, retrieval/storage permission, a review date and approved endpoint hostname are required. Source review dates cannot be in the future. The schema rejects unknown keys. Missing configuration or a referenced secret stops live startup instead of falling back to synthetic inventory.

## Authorised listing feeds

`AuthorizedJsonFeed` reads a bounded, normalized JSON snapshot or change feed. This is an integration contract for an authorised provider endpoint or an operator's authorised normalization service. It does not scrape websites, bypass source protections, follow arbitrary page links, or invent a provider-specific integration. An incremental endpoint must supply every update needed by its own retry-safe cursor/version scheme; this connector does not fabricate a missing cursor protocol.

```json
{
  "records": [],
  "complete": false,
  "removedIds": []
}
```

Every record must match `ListingVersion` in `shared/contracts.ts` and the runtime `listingSchema`. `complete: true` means a successfully fetched full source inventory, not merely the final response received before an error. A complete empty feed intentionally reconciles all currently active source records to inactive, so the provider must make this assertion carefully. Use `complete: false` for partial or incremental updates; unseen records remain active, while explicit `removedIds` are still applied. Records cannot simultaneously appear in removals. Unknown envelope fields are rejected, including remote pagination instructions.

Limits are 10 MB per feed response, 10,000 records, and 10,000 removal IDs. Request redirects are not followed. Endpoints must use HTTPS and an exact approved public DNS hostname. The default transport resolves public IPv4 addresses once and connects to the checked address while verifying TLS against the hostname, preventing DNS rebinding between validation and connection. Private, loopback, link-local, shared-address and reserved IPv4 ranges are rejected. The initial adapter deliberately does not support IPv6-only feed endpoints. Outbound network policy should also restrict ingestion egress in production. Test-injected HTTP functions replace this transport and must not be treated as evidence of live network validation.

Listing links also require HTTPS with public DNS hostnames, without credentials or fragments, and must use a source-approved hostname. Record identifiers are bounded path-safe strings. Every source must supply a stable globally unique normalized listing ID and its original source listing ID; collisions are rejected, including a transaction check against concurrent sources. Location status must agree with activity, coordinate availability and precision. Approximate source points remain approximate, unknown bedrooms remain unknown, and rooms/facilities retain their separate meanings.

## Ingestion versions and observations

The source lease prevents overlapping ingestion of a provider. An expired lease cannot write further batches or replace another run's health report. A malformed feed fails validation before listing mutation. Incomplete feeds never remove unseen listings. Content hashing recursively sorts keys, so JSON field order does not manufacture changes. Retrying unchanged content creates no new content versions and does not rewrite normalized listing documents.

`listingVersions` and the normalized `listings` document preserve the timestamps of the content observation that produced that version. A separate `listingObservations/{listingId}` record tracks current `lastSeenAt`, `sourceUpdatedAt` and `ingestedAt` on every successful observed record without changing the content hash. Consumers that need current source-observation freshness should read that record or the feed-level `sourceHealth`; immutable exported snapshots must retain their original timestamps. `firstSeenAt` is preserved across source changes and reactivation. An interrupted ingestion can have committed some upsert batches; source health records failure and a retry reconciles safely. This is not a multi-source atomic publish operation.

## Google adapters

The Routes adapter sends one exact selected destination, explicit departure/arrival time, one supported transit preference and optional preferred transit types. Batches are capped at 100 origins. Matrix rows are reordered by provider indices and missing outcomes become explicit provider errors. No walking durations, transfers or geometry are inferred from matrix-only responses. Invalid statuses and non-finite durations cannot become successful results. Transit type preferences and fallback computations carry warnings rather than promises of guaranteed exclusions.

Geocoding results retain precision: `ROOFTOP` maps to exact, `RANGE_INTERPOLATED` to street, and other location types conservatively to locality. Missing country or invalid coordinates fail validation rather than defaulting to Switzerland. Candidates still require the application's explicit destination confirmation; geocoding does not verify an entrance.

Implementation references checked against official documentation:

- [Google computeRouteMatrix reference](https://developers.google.com/maps/documentation/routes/reference/rest/v2/TopLevel/computeRouteMatrix)
- [Google Geocoding request and response](https://developers.google.com/maps/documentation/geocoding/guides-v3/requests-geocoding)

The tests use injected responses. They verify request mapping, failure handling and ingestion behavior without making paid routing calls. Before enabling live traffic, perform a bounded staging test with the approved source, routing controls, country/precision behavior, attribution, retention and application policies. The existence of valid JSON is not evidence of a provider contract or production readiness.
