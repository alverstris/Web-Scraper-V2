# Keywise

A branded React website for commute-first property search, with a public product showcase, customer dashboard and separate staff workspace. Visitors, eligible customers, users with exhausted or restricted allowances, and staff can exercise their intended workflows with saved synthetic listings, journey estimates and local mock sign-in. Application state and provider interfaces remain separate from presentation so live integrations can be connected later.

This delivery is a local software implementation and deployment foundation. It is not a live Swiss property service. Live listing supply, route retention/export rights, entitlement policy and several integrations remain release gates, listed in [docs/gates.md](docs/gates.md). The application must not silently substitute the demo provider when live configuration is incomplete.

## Run locally

Use Node.js 22.12 or later. Open a terminal in the updated project folder containing `package.json`, then install the dependencies using the pinned pnpm version and start both services:

```bash
npx pnpm@10.32.1 install --frozen-lockfile
npm run dev
```

In Windows PowerShell, use the `.cmd` wrapper if `npm` or `npx` reports that running scripts is disabled. No execution-policy change is needed:

```powershell
npm.cmd --version
npm.cmd exec --yes --package=pnpm@10.32.1 -- pnpm install --frozen-lockfile
npm.cmd run dev
```

Open http://127.0.0.1:5173 in a browser on that same machine. The website uses React/Vite and proxies `/api` to its local Node API on port 8787. Keep the terminal running; Ctrl+C stops both services. Running this command in a remote/cloud workspace does not make its loopback address accessible from your own computer.

No API keys or `.env` file are required for the default local demo. Startup creates the fictional listings, saved EPFL profiles and mock accounts automatically. Optional local settings can be copied from `.env.example`; preserve an existing `.env` file. The combined command accepts demo mode only and binds to loopback. `pnpm dev` and `corepack pnpm dev` run the same script when those tools are installed.

The launcher waits up to 90 seconds for initial API preparation, printing progress while it waits. If startup fails, it reports the checked address and last failure. See [startup troubleshooting](docs/keywise-local-demo.md#startup-troubleshooting) for running the API and website in separate terminals.

Use the website's customer sign-in at `/sign-in` and the mock email/password accounts in [the Keywise local guide](docs/keywise-local-demo.md). Sign-in opens `/dashboard` with a saved EPFL east dataset ready to filter. Staff use the discreet public footer link to `/staff/sign-in`; ordinary customer accounts are denied staff access. There is no customer-facing test-identity selector or implicit Alice login.

**Integration TODOs:** live identity/OAuth, phone/institutional verification, duplicate-free-allowance policy, authorised feeds, routing, GPT extraction and API keys remain deferred. Mock credentials and cookie sessions exercise the local website only; live entitlement issuance remains gated. Never expose this local fixture environment as a public authentication service.

Local state persists in `DATA_DIR` (normally `.data`). The cloud validation instance used `.data/keywise-interactive-20261001`. A fresh local startup prepares saved EPFL east/west and UNIL profiles and initial mock-account allowances in its own data directory. Synthetic custom work has a 1,800-millisecond queue delay; `DEMO_QUEUE_DELAY_MS` accepts 0–10,000 for cancellation review. See [the current user journeys](docs/demo-user-flows.md) for role and ownership checks.

## Try the workflow

1. Explore the public Keywise website, then sign in to the customer dashboard. The saved EPFL east profile loads without consuming a custom run.
2. Review your allowance, find a custom destination and confirm its exact point. Choose commute settings and review coverage; calculation starts only after explicit confirmation.
3. Watch run progress, try cancellation and inspect successful, missing and unavailable journeys. Recovery uses the creating account and does not spend another run.
4. Change housing filters, sort order and the map/list presentation. This only changes the current dataset view.
5. Export a permitted synthetic snapshot and reopen it. Imported snapshots retain their original time and never award allowance or start routing.
6. Sign out and use another mock customer account to check independent private results, exhausted runs, destination limits and account support.
7. Nominate an exact destination. Sign in through the staff page to approve it, configure its profile and explicitly publish it; customers can then load its shared results. Approval alone launches no calculation.

The [manual testing guide](docs/demo-user-flows.md) describes current customer and staff flows and the checks still requiring live integration. Opening a synthetic original listing uses a local source-page simulation; it does not contact a real rental provider or let you apply for a home.

The synthetic map is a labelled coordinate schematic. It is not a navigable map, transit geometry or an isochrone. An optional Google Maps component is included but requires approved live data, restricted browser credentials and staging verification. The website and dashboard use the Keywise visual identity; further animation and live-map integration remain separate work. Ordinary property filters never become hidden constraints on a standard routing run.

The local flow demonstration prepares public-transport, walking, cycling and driving profiles for EPFL east, EPFL west and UNIL. Commute filters come first: maximum journey minutes, and recorded synthetic walking time, transfers and allowed transit types where available. All rental comparisons use CHF per month; housing facts use fixed units and controlled ranges/options. Named-area filtering and map drawing change the current view only. Changing a saved travel mode opens its actual prepared dataset without using a custom run. See the [frontend research and complete brief-filter mapping](docs/keywise-website-research.md#rental-filtering-research-and-applied-rules--1-october-2026).

## Commands

| Command | Purpose |
| --- | --- |
| `pnpm dev` | Local API and Vite together; synthetic mode only |
| `pnpm build` | Strict TypeScript check and production frontend build |
| `pnpm test` | Domain, server and edge tests |
| `pnpm test:e2e` | Browser tests; requires the configured Playwright browser |
| `pnpm start` | API process |
| `pnpm worker` | Authenticated routing worker process |
| `pnpm ingest` | Authorised listing ingestion job |
| `pnpm cleanup` | Expiry/deletion and interrupted-work reconciliation job |
| `pnpm maintain` | Popular profile maintenance job |

The test and build commands are reproducible checks, not evidence of real provider permissions or production performance. See [docs/acceptance.md](docs/acceptance.md) for the requirement evidence and unrun checks.

## Repository guide

| Path | Responsibility |
| --- | --- |
| `src/` | Plain React screens, state, reusable view components and styling/motion seams |
| `shared/` | Portable domain contracts, validated data and view operations |
| `server/` | API, account/allowance controls, repositories, jobs and providers |
| `edge/worker.ts` | Cloudflare API proxy, API cache isolation and security headers |
| `tests/` | Executable software checks |
| `deploy/` | Parameterised Google Cloud provisioning/deployment scripts |
| `wrangler.toml` | Cloudflare Workers Static Assets configuration; API disabled by default |
| `firestore.rules`, `storage.rules` | Default-deny browser access |
| `docs/architecture.md` | Data ownership, extension boundaries and deployment model |
| `docs/keywise-local-demo.md` | Mock sign-in credentials, page routes, saved fixtures and integration TODOs |
| `docs/keywise-website-research.md` | Research and rationale for the public website, customer dashboard and staff access |
| `docs/demo-user-flows.md` | Current manual customer/staff journey checks |
| `docs/runbook.md` | Operations, deployment, security verification and rollback |
| `docs/gates.md` | Decisions and integrations still required for live release |
| `docs/provider-configuration.md` | Provider/configuration contracts and permission examples |
| `docs/ui-extension-guide.md` | Later styling, motion and map extension guidance |

No cloud deployment or chargeable provider test is performed by installing or building this repository. Deployment scripts operate on explicitly supplied projects and are intended for a reviewed staging deployment after the relevant gates are resolved.
