# Reviewed provider configuration mount point

No authorised live supplier or routing permission is supplied. The authoritative configuration schema is `server/providers/index.ts`. After approval, place non-secret provider configuration in `approved.json` or mount it at runtime and set `PROVIDER_CONFIG_PATH=/app/deploy/providers/approved.json`.

The file identifies Google storage/location permission and expiry, plus one or more authorised feed endpoints and host allowlists. Feed credentials are referenced through `tokenEnvName`; they are never literal values in the JSON. `GOOGLE_MAPS_SERVER_KEY` and referenced feed tokens must be injected server-side, independently in each environment.

The existing JSON connector expects the normalised listing schema. A supplier returning a different format requires a tested source-specific normalisation adapter. The content of an approval record is a claim to be substantiated by the operator's agreement review, not permission created by the software.
