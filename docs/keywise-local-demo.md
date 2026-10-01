# Keywise local website

Keywise has a public product website, a customer sign-in and property-search dashboard, and a separate staff sign-in and workspace. This local version uses saved synthetic properties, journey estimates and mock accounts. It does not fetch real advertisements, contact routing/GPT/verification providers, or grant access to any live service.

## Start locally

Use Node.js 22.12 or later. Obtain the updated checkout on your own computer, then open a terminal in the project folder containing `package.json`. Install with the pinned pnpm version and start both services:

```sh
npx pnpm@10.32.1 install --frozen-lockfile
npm run dev
```

For Windows PowerShell, these commands avoid the blocked `npm.ps1`/`npx.ps1` wrappers without changing the execution policy:

```powershell
npm.cmd --version
npm.cmd exec --yes --package=pnpm@10.32.1 -- pnpm install --frozen-lockfile
npm.cmd run dev
```

Open `http://127.0.0.1:5173/` in a browser on that same computer. The API listens on `127.0.0.1:8787`; Vite proxies its API requests. Ctrl+C stops both processes. No API keys or `.env` file are required for the default local demo. Optional settings can be copied from `.env.example`; preserve an existing `.env`, keep `APP_MODE=demo` and the default loopback host. Mock credentials and cookie sessions are for this loopback development environment.

The current review runs locally on the user's Windows laptop. Its loopback address is available on that computer while the development services remain running. Saved data in the ignored `.data/` directory is not included in the repository; a fresh checkout prepares its own saved fixtures automatically.

## Startup troubleshooting

The combined launcher prepares saved data before starting Vite. Its default API readiness timeout is 90 seconds; it prints progress every ten seconds and includes the health endpoint and last failure if preparation times out. `DEV_STARTUP_TIMEOUT_MS` optionally adjusts this wait between 1,000 and 300,000 milliseconds.

To inspect an API startup failure, stop the combined launcher with Ctrl+C and run this in the project folder:

```powershell
node --import tsx server/main.ts
```

When it prints `{"event":"api_listening","mode":"demo","host":"127.0.0.1","port":8787}`, leave that terminal open. In a **second terminal**, in the same project folder, start the website:

```powershell
npm.cmd run dev:web
```

On macOS/Linux, use `npm run dev:web`. Open `http://127.0.0.1:5173/` after Vite reports that it is ready. Both terminals must remain open; Ctrl+C stops each service. Stop both before switching back to the combined command so the ports are available. If the API exits or reports an error, preserve its complete output to diagnose the failure; do not delete saved data as a startup workaround.

If public pages load but both customer and staff sign-in fail with a gateway/connection error, the website may still be running while the API has stopped. Pressing Ctrl+C in the API terminal stops sign-in and dashboard access. Restart `node --import tsx server/main.ts`, wait for `api_listening`, keep that terminal running, and retry sign-in. In another PowerShell terminal, check API readiness with this exact command:

```powershell
Invoke-RestMethod http://127.0.0.1:8787/health
```

The expected result has `ok` set to `True` and `mode` set to `demo`. If the command cannot connect, inspect the API terminal for an exit or startup error. If the API is healthy but sign-in still fails, preserve the website terminal's proxy error as well. Restarting these services keeps your saved local listings and accounts.

## Mock sign-in accounts

These are deliberately published local test credentials, not production secrets. Use the customer sign-in at `/sign-in` for the customer accounts. All customer passwords are **`Keywise-Demo-2026!`**.

| Email | Initial experience |
| --- | --- |
| `alice@keywise.test` | Eligible customer with two daily custom runs and two distinct destinations. |
| `bob@keywise.test` | A separate eligible customer with independent allowances and private results. |
| `new@keywise.test` | New customer; first local sign-in receives a synthetic allowance while verification is deferred. |
| `exhausted@keywise.test` | Daily custom runs already used; popular results and snapshots remain usable. |
| `destination-limit@keywise.test` | Two runs remain for EPFL east; a new destination is unavailable for the current allowance day. |
| `suspended@keywise.test` | Custom calculations suspended; published results, snapshots and account support remain available. |

The public footer's staff sign-in link leads to `/staff/sign-in`. The administrator is **`admin@keywise.test`**, with password **`Keywise-Staff-2026!`**. The staff workspace is `/staff`. Customer credentials do not confer an administrator role; an ordinary customer who requests staff access must be denied.

Allowances and administrative changes are saved locally. The table describes fresh fixture state, not a guarantee that an account remains unused after testing. Reset days follow the server's Europe/Zurich policy, including daylight-saving time.

## Customer journey

The public homepage explains the product. The main navigation's **Help** link opens `/help` for sign-in, coverage, allowance and snapshot guidance; Help and the public footer also expose the saved-file viewer. Customer sign-in opens `/dashboard`, which immediately loads the saved **EPFL east entrance** public-transport dataset. Saved destination and travel mode menus load twelve prepared profiles: EPFL east, EPFL west and UNIL Dorigny, each with walking, cycling, driving and public transport. Each profile keeps its exact selected point and original journey assumptions. Public transport uses an 08:30 arrival on 6 October 2026; the other modes use an 08:00 departure that day, all in Europe/Zurich. These are illustrative calculations, not a current travel forecast.

The market contains 24 invented rental listings around Lausanne. Fictitious property names, CHF monthly rents, room/bedroom counts, furnishing and facilities provide useful filtering variation. Rooms remain separate from bedrooms. Unknown attributes, approximate locations, unresolved origins and unavailable routes remain visible. No listing describes a real property or promises actual availability.

The compact filter panel puts maximum commute minutes, a monthly-rent range and quick bedroom choices first. Expand Transit details for walking minutes, transfers and allowed transit types; expand More filters for grouped room/space, home preference, area and facility requirements. The demo includes explicitly simulated measurements so each control filters actual rows. Allowed types apply to every transit leg in a journey. Sliders show their current values and support arrow/Home/End keyboard input; exact limits remain bounded. Rent is CHF/month, area is m², bedroom/bathroom counts are whole numbers, and rooms allow half-room increments. Unknown, private, shared, absent and needs-review facts stay distinct. Active filter chips can be removed individually or cleared together.

Filtering, sorting and switching between list and map/coordinate views make no routing request and use no custom allowance. For example, maximum rent CHF 900 shows four fixture properties; adding minimum two bedrooms shows two. Changing a saved destination or travel mode loads its maintained results, preserves applicable housing filters and clears transit-only filters when leaving public transport. Custom journey date/time inputs also use Europe/Zurich regardless of the browser's timezone.

A custom commute follows destination confirmation, travel/time settings, a review showing allowance implications, and an explicit start action. Editing a draft does not recalculate or relabel existing results. Custom results belong to their customer, remain temporary and can be recovered by that owner's recovery ID. Cancellation and discard show their effect on the existing allowance.

Complete permitted synthetic datasets can be exported and reopened as snapshots. The file contains the full dataset rather than only visible matches, preserves the original calculation time, and grants no account privileges. Import checks run locally and do not recalculate routes. Exact current availability is not inferred from a saved file.

Visitors can also use the public `/open-snapshot` page to open and filter an existing file without signing in. This local file viewer is independent of the API, accounts and new calculations; it can work when the online service is unavailable. It does not expose another customer's private server results. Source handoff and a future map SDK may still require a network connection.

Customers without runs can continue exploring published profiles and snapshots. The destination-limited account may calculate another profile for EPFL east but cannot start a new UNIL destination that day. Suspended customers can submit an account-support request and read the staff response; a support response alone does not restore an allowance.

## Staff journey

The staff workspace supports audited spending stops, source enablement, run cancellation, account allowance/status changes, shorter future retention, nomination review and support responses. Each change requires a reason. Approving a destination nomination does not calculate or publish a profile. Staff separately choose the approved exact point, market, travel settings, time and refresh policy, then explicitly publish or refresh its synthetic dataset. Removing a profile prevents ordinary maintenance from republishing it automatically.

## Saved fixture state

The first API startup writes the listing inventory and popular-profile manifests/results to the ignored `.data/` directory, or the directory selected by `DATA_DIR`. Listing records and larger result payloads use separate local repository/blob adapters. Restarting with the same directory reuses valid published snapshots. Startup prepares missing default profiles and refreshes expired profiles while respecting deliberate staff removal. Browser reload does not create a custom run or automatically reroute a valid popular dataset.

The fixture-v3 startup migration updates only the application's known synthetic listings and their prepared profiles. It retains existing private snapshots, account allowances, source controls and deliberate profile removal. Other saved records are retained. To refresh the synthetic source deliberately, run `npm run ingest`, then `npm run maintain` against the same local `DATA_DIR`. To start over, stop the local processes and rename `.data/` to a dated backup before restarting; preserve any snapshots or state you want to keep. Do not use this reset procedure against cloud services.

If a saved spending stop or disabled source prevents routing, startup defers profile preparation and keeps the API available for staff to restore service. Existing unexpired snapshots remain readable. Explicit maintenance still reports the active restriction; release it through the staff workspace before requesting maintenance.

## Integration TODOs

- Replace local mock password/session access with reviewed real customer and staff authentication; retain server ownership and staff-role checks.
- Identity, phone/institutional verification and duplicate-free-allowance policy are deferred at the user's request. Do not treat a local mock sign-in as production eligibility.
- Select authorised listing feeds and confirm retrieval, processing, media, retention and export rights before ingesting live inventory.
- Connect approved location/routing providers, restricted keys and provider-supported route controls. Establish rights for temporary results, shared popular datasets and portable files before enabling them.
- Connect GPT extraction only for permitted source descriptions with constrained schemas and field evidence; result filtering must remain independent of extraction.
- Review live Firebase/Google/Cloudflare configuration, separate environments, private storage/IAM, queues, schedules, expiry/cleanup and direct-origin protections.
- Approve advertising/consent/referral integrations and privacy/terms. No active ad network, payment flow or commercial commitment is implied by this local website.

Detailed production gates remain in [gates.md](gates.md). Local software checks and saved synthetic examples do not clear those gates.
