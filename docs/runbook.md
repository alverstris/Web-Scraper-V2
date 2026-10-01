# Operations and deployment

No live deployment was performed for this delivery. The scripts are parameterised deployment templates; their PowerShell syntax and application edge behaviour can be tested locally, but cloud IAM, billing, real provider calls and rollback have not been exercised. Keep the production gates in [gates.md](gates.md) visible when using this runbook.

The supplied archive records seven passing local edge tests and successful PowerShell parsing of the deployment scripts. Its Wrangler staging dry run could not load the optional `@cloudflare/workerd-windows-64` native binary on the original Windows ARM64 machine. This is historical source-machine evidence, not a failure diagnosed on the current cloud machine. Successful Wrangler packaging and an edge rollout remain unverified. Repeat the packaging check on a supported installation with the required optional dependencies before deployment; no Cloudflare upload was performed for this delivery. Current Keywise build and software-test evidence is recorded in [acceptance.md](acceptance.md).

## Local development

Follow the root README. The combined developer command starts the API and Vite against synthetic data. Demo account fixtures and state persist in `.data/`. For a fresh demo, stop both processes and rename that directory to a dated local backup, then restart; do not clear a cloud database to reset fixtures. Start independent demo processes with separate `DATA_DIR` values to avoid sharing a local store across processes.

`pnpm build`, `pnpm test` and `pnpm test:e2e` cover different layers. Browser tests need their configured Playwright installation. Never interpret successful local tests as a check of Firebase rules, Cloud Run IAM or live listing licences. Record actual outcomes in [acceptance.md](acceptance.md).

## Environments and credentials

Create a distinct Google/Firebase project for staging, separate from production. Select Cloud Run, GCS and Firestore locations consciously; the brief does not authorise a residency promise. Use dedicated Cloudflare environment bindings. Preview deployments have `API_ENABLED=false` and no production origin or secrets.

| Identity | Minimum application responsibility |
| --- | --- |
| API service account | Firestore data access, private result objects, enqueue tasks, act as the task identity, Firebase user read for revoked-token checks, specific API secret versions |
| Worker service account | Firestore data access, private result objects, enqueue retries, act as task identity |
| Jobs service account | Firestore data access, private result objects, enqueue reconciliation, act as task identity |
| Task service account | Invoke the routing worker only |
| Scheduler service account | Run the named ingestion/cleanup/popular jobs only |

The provisioning template uses environment-project `roles/datastore.user` and task-enqueuer grants plus bucket-specific object access. These are intentionally isolated by project; a later custom IAM role review can narrow them further. No service account key files are needed on Cloud Run. Ensure Google's Cloud Tasks and Scheduler service-agent grants exist after enabling the APIs; do not replace them with administrator credentials.

The origin API is publicly reachable at the transport layer so the Cloudflare Worker can connect. Every application API route must check the edge secret before work, and protected routes additionally verify Firebase. The worker service is private at Cloud Run IAM and verifies its task identity. Do not accidentally grant `allUsers` on the worker or jobs. User tokens and edge credentials have different purposes and must never be reused.

## Provision and build

1. Resolve the cloud-environment and relevant provider/policy gates. Install authenticated Google Cloud CLI, Docker, the pinned package manager and a reviewed Firebase CLI. Add Firebase to the selected Google project and enable the approved sign-in providers. Set authorised domains and Microsoft/Google provider configuration separately in each environment.
2. Copy `deploy/environment.example.json` to `deploy/staging.local.json`. Fill in every named project, region, bucket and timezone field. The default schedule strings are engineering examples, not an approved launch time. Copy `deploy/live.env.example.yaml` to `deploy/staging.local.env.yaml`; keep it in live mode with unavailable features rather than exposing demo identities remotely.
3. Run the provisioning script below. It enables the named APIs, creates service accounts, a private bucket, Firestore database, secrets and a bounded routing queue. The queue remains paused. The dedicated result bucket disables versioning and soft-delete so discarded payloads are not silently archived. Review this irreversible-deletion tradeoff against the approved policy before using the template on real data.

```powershell
pwsh -File deploy/provision.ps1 -ConfigFile deploy/staging.local.json
```

4. Add independent high-entropy edge and evidence secrets and the issued Turnstile secret through Secret Manager. Record numeric versions in the local deployment configuration. The edge secret must contain at least 32 characters and must match the Cloudflare environment secret. Use secret tooling without echoing values into logs, commit history, command examples or frontend configuration. API-only injection for these secrets is intentional.
5. Select a supported Node.js Debian container image, verify its publisher/security status, and record its full digest as `nodeImageDigest`. Build and push the application image to the environment's Artifact Registry. Record the resulting image digest, not only the tag, as `imageDigest`.

```powershell
$cfg = Get-Content deploy/staging.local.json -Raw | ConvertFrom-Json
$registry = "$($cfg.region)-docker.pkg.dev"
$imageTag = "$registry/$($cfg.projectId)/$($cfg.artifactRepository)/application:reviewed-build"
gcloud auth configure-docker $registry
docker build --build-arg "NODE_IMAGE=$($cfg.nodeImageDigest)" -t $imageTag .
docker push $imageTag
gcloud artifacts docker images describe $imageTag --project=$($cfg.projectId) --format='value(image_summary.digest)'
```

Use the returned digest to form the full `.../application@sha256:...` image reference. The Dockerfile installs from the committed pnpm lockfile and runs without root privileges. Image construction/push is a separate explicit operation; ordinary package installation never provisions cloud resources.

## Deploy the backend

Fill in all runtime environment values. A worker URL can be obtained from the environment's existing service or an initial private deployment; when bootstrapping, deploy the worker with a clearly provisional HTTPS service origin, read its actual `status.url`, then update `WORKER_URL` in the runtime file and redeploy before any queue is resumed. OIDC audience and the actual worker URL must match exactly. Do not use a production worker to bypass this bootstrap step.

```powershell
pwsh -File deploy/deploy-services.ps1 -ConfigFile deploy/staging.local.json
gcloud run services describe "$($cfg.servicePrefix)-worker" --project=$($cfg.projectId) --region=$($cfg.region) --format='value(status.url)'
gcloud run services describe "$($cfg.servicePrefix)-api" --project=$($cfg.projectId) --region=$($cfg.region) --format='value(status.url)'
```

This deploys a private routing worker, the edge-authenticated API and three jobs from one immutable image. It does not enable live providers, issue entitlements, run jobs, resume queues or activate a frontend domain. Set `PROVIDER_CONFIG_PATH` to the approved provider configuration and `POLICY_CONFIG_PATH` to the validated launch policy only after their agreement references and data rights are approved. A non-secret approved policy can be embedded in `deploy/policy/approved.json` by the Dockerfile. The application remains unavailable for affected live features until provider configuration and policy are supplied.

The Dockerfile also includes `deploy/providers/approved.json` when supplied. Provider JSON contains agreement metadata and secret environment-variable names only. Populate `providerSecrets` in the local deployment config with mappings such as `GOOGLE_MAPS_SERVER_KEY` to `environment-prefix-maps:1` and the configured feed-token variable to its own Secret Manager version. The provisioning script creates the secret containers; add the actual secret versions securely before deployment. Current shared provider construction requires those provider credentials in API/worker/jobs; API trust-boundary and Turnstile secrets remain API-only. Never insert literal keys into provider JSON, Docker build arguments or a `VITE_` variable.

Deploy the default-deny Firestore rules and indexes to the explicit Firebase project. Deploy `storage.rules` only for the separately initialised Firebase Storage resource; the plain result GCS bucket is controlled by IAM/public-access prevention, not by Firebase rules.

```powershell
firebase deploy --project $cfg.projectId --only firestore:rules,firestore:indexes
```

`firestore.indexes.json` intentionally defines no composite indexes for the current collection queries. Run the actual cloud query workload before changing access patterns; add required indexes in source control rather than relying on a developer's console state. Expiry is enforced by the application and cleanup job. Do not turn ISO date strings into an assumed Firestore TTL policy; Firestore TTL needs a supported timestamp field and does not synchronously delete associated payloads.

## Deploy Cloudflare

Populate only the approved browser Firebase configuration before the Vite build. These public values do not replace backend secrets. Configure `API_ORIGIN` and `FIREBASE_AUTH_DOMAIN` in the matching environment block in `wrangler.toml` or a reviewed generated config; never commit an edge secret. Add the production custom-domain route only when approved.

```powershell
pnpm build
pnpm exec wrangler secret put EDGE_ORIGIN_SECRET --env staging
pnpm exec wrangler deploy --env staging
```

The edge starts with `API_ENABLED=false`. After origin security checks, change the staging binding to true and redeploy. Every `/api` response is private/no-store. Do not create a Cloudflare Cache Everything rule or API cache override. The SPA fallback is deliberately bypassed for `/api` paths, including unknown endpoints and browser navigation requests. HTML is revalidated; Vite's fingerprinted assets use static-asset caching.

Google Maps is optional. Supply a browser-only restricted `VITE_GOOGLE_MAPS_BROWSER_KEY` and approved `VITE_GOOGLE_MAP_ID` at build time, then enable `GOOGLE_MAPS_ENABLED=true` at the edge only in that reviewed environment. The conditional CSP includes Maps domains, font/style resources and the SDK's documented eval capability. No inline scripts are enabled. Recheck the SDK's actual network/CSP behaviour, attribution and usage costs before live release. Firebase popup sign-in and linked-provider flows must also be tested against the deployed CSP and exact auth domain.

Cloudflare WAF/rate-limiting/crawler controls are account configuration, not automatically created by Wrangler here. Configure separate rules for public reads, destination lookup, sign-in/verification, run creation and admin traffic. Enable the approved AI crawler policy without using a university IP address as proof of one person. Retain server checks even when the edge is protecting traffic.

Live custom runs also require Turnstile. Provide `VITE_TURNSTILE_SITE_KEY` at frontend build time, inject `TURNSTILE_SECRET` into the API and configure `TURNSTILE_ALLOWED_HOSTNAMES` for that environment. Enable `TURNSTILE_ENABLED=true` in the matching Worker environment so its CSP allows only the necessary Cloudflare script/frame/connection origin. The backend validates the challenge action and hostname. Demo mode never loads the external challenge SDK. Test a denied/expired/reused challenge and a valid challenge in staging; Turnstile still does not grant account entitlement.

## Queues and schedules

The template bounds the queue to two concurrent dispatches and two dispatches per second, with five delivery attempts. These are conservative staging limits, not a workload-derived production quota. The worker further controls batch attempts and leases. Verify provider-element quotas and cancellation behaviour before raising concurrency.

```powershell
pwsh -File deploy/schedules.ps1 -ConfigFile deploy/staging.local.json
```

The script creates or updates schedules and leaves them paused. Cloud Scheduler invokes `https://run.googleapis.com/v2/.../jobs/{name}:run` using OAuth, while Cloud Tasks invokes the worker service using OIDC. The selected IANA timezone is explicit. Provider ingestion leases still prevent overlap because a scheduler retry or manual run can coincide with an unfinished job.

Perform one bounded, approved staging execution per job; inspect the resulting completeness and audit records. Resume cleanup first when permitted temporary datasets exist, then the authorised ingestion/popular schedules and routing queue. A scheduler configuration alone is not evidence that its job can authenticate or finish.

```powershell
gcloud tasks queues resume "$($cfg.servicePrefix)-routing" --project=$($cfg.projectId) --location=$($cfg.region)
gcloud scheduler jobs resume "$($cfg.servicePrefix)-cleanup" --project=$($cfg.projectId) --location=$($cfg.region)
```

## Required staging checks

| Check | Expected result |
| --- | --- |
| Direct origin API request without edge credential | Denied before protected work |
| Forged edge header sent through Worker | Replaced by Worker; never trusted as caller privilege |
| Missing/foreign/expired Firebase identity | Denied on protected endpoints |
| Another user's run ID or result chunk | Denied even with a valid account token |
| Missing `/api` endpoint, including navigation request | JSON 404 with no-store; never HTML 200 |
| Unauthenticated worker invocation | Rejected by Cloud Run IAM |
| Wrong OIDC audience or service account | Rejected by task authentication |
| Direct Firestore/Firebase Storage client and anonymous GCS object read | Denied |
| Two simultaneous run creations against one allowance | At most the server-authorised number accepted |
| Duplicate task delivery/retry | No duplicate successful batch or allowance debit |
| Expired run before cleanup executes | Access immediately denied |
| Partial provider ingestion | Existing inventory not mass-deactivated |
| Turn on the spending stop | New provider work stops; in-flight outcomes stay honestly reported |
| Staging caller supplied production credentials/project values | Deployment review/configuration rejects cross-environment reuse |
| Disabled ads, blocked SDK/tracking, failed Maps load | Search/filter/import and original source handoff remain usable |

Record time, build digest, config revision, outcome and sanitised technical IDs for these checks. Do not record exact custom destinations, bearer tokens, raw verification data or provider response bodies in logs.

## Routine operation and incidents

Use the admin spending stop with an actor and reason to pause external routing work. It is checked before run reservation and again before provider work. Pause the Cloud Tasks queue for a second layer of containment. Set the Cloudflare `API_ENABLED=false` binding if the whole API needs isolation. An in-flight request may already have been accepted by a provider; the stop cannot undo past billing.

Monitor source completeness/freshness, unresolved locations, route success/no-route/error counts, batch attempts, queue age, run completion/expiry, cleanup lag, external request/element counters, verification failures, payload sizes and denied admin access. Structured technical logs are implemented; dashboards, alerts, paging and live service-level objectives must be configured and tested for the actual cloud environment. Budget alerts are notifications and do not replace the spending stop, queue pause or provider quota caps.

For a provider outage, keep existing permitted datasets visibly dated, pause the affected source or route profile, and preserve partial/no-route/error distinctions. An incomplete feed must not clear its previous inventory. Retry only unfinished batches using their original frozen universe and journey time. Do not silently change a destination or reuse another user's custom results to fill gaps.

Cleanup should be safe to repeat. Application expiry is immediate; physical GCS/Firestore deletion may lag until the job runs. Investigate leftover private chunks, expired leases and orphaned temporary objects without deleting accounting/abuse evidence contrary to policy. Keep raw destinations out of long-lived logs and disable automatic database/bucket backups for temporary payloads unless the retention agreement explicitly permits them.

## Rollback and secret rotation

Before each release, record the previous Cloud Run revision IDs, worker deployment version, image digest, numeric secret versions, environment config and schema compatibility. Keep changes additive and backward compatible while older workers may still process queued jobs. Pause new work before any incompatible change; this repository includes no destructive schema migration.

For an API regression, pause the queue/spending and return traffic to the previous known-good revision:

```powershell
gcloud run services update-traffic "$($cfg.servicePrefix)-api" --project=$($cfg.projectId) --region=$($cfg.region) --to-revisions='PREVIOUS_API_REVISION=100'
gcloud run services update-traffic "$($cfg.servicePrefix)-worker" --project=$($cfg.projectId) --region=$($cfg.region) --to-revisions='PREVIOUS_WORKER_REVISION=100'
pnpm exec wrangler rollback PREVIOUS_WORKER_VERSION --env staging
```

Cloud Run jobs do not roll back through service traffic percentages. Redeploy the three jobs using the recorded previous image/config and leave their schedules paused until one bounded check succeeds. Do not restore an old database snapshot to roll back code: that can resurrect expired results or reverse allowance accounting. Reconcile accepted runs and unfinished batches before resuming queues.

For edge-secret rotation, pause edge API traffic, create a new Secret Manager version, redeploy the API with that pinned version, update the matching Cloudflare secret, validate direct-origin rejection and the authenticated path, then re-enable traffic. Keep the previous version only for the approved rollback interval. Never include a temporary second credential in public client code.

## Official operational references

These references were checked during implementation. They document platform behaviour; they do not prove that this application has been deployed or approved by a data provider.

- [Cloudflare Static Assets routing](https://developers.cloudflare.com/workers/static-assets/)
- [Cloud Run Jobs scheduling](https://docs.cloud.google.com/run/docs/execute/jobs-on-schedule)
- [Cloud Tasks to Cloud Run](https://docs.cloud.google.com/run/docs/triggering/using-tasks)
- [Cloud Run service authentication](https://docs.cloud.google.com/run/docs/authenticating/service-to-service)
- [GCS public access prevention](https://docs.cloud.google.com/storage/docs/using-public-access-prevention)
- [GCS soft-delete configuration](https://docs.cloud.google.com/storage/docs/use-soft-delete)
- [Google Maps JavaScript CSP requirements](https://developers.google.com/maps/documentation/javascript/content-security-policy)
