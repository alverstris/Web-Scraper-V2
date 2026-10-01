# Keywise local website

Keywise has a public product website, a customer sign-in and property-search dashboard, and a separate staff sign-in and workspace. This local version uses saved synthetic properties, journey estimates and mock accounts. It does not fetch real advertisements, contact routing/GPT/verification providers, or grant access to any live service.

## Start locally

Use Node.js 22.12 or later. Obtain the updated checkout on your own computer, then open a terminal in the project folder containing `package.json`. Install with the pinned pnpm version and start both services:

```sh
npx pnpm@10.32.1 install --frozen-lockfile
npm run dev
```

Open `http://127.0.0.1:5173/` in a browser on that same computer. The API listens on `127.0.0.1:8787`; Vite proxies its API requests. Ctrl+C stops both processes. No API keys or `.env` file are required for the default local demo. Optional settings can be copied from `.env.example`; preserve an existing `.env`, keep `APP_MODE=demo` and the default loopback host. Mock credentials and cookie sessions are for this loopback development environment.

The validation server ran inside the cloud workspace using `.data/keywise-interactive-20261001` to preserve prior development state. Its loopback address is not a hosted preview accessible from your computer. That ignored directory is not included in the repository; starting your updated local checkout prepares its own saved fixtures automatically.

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

The public homepage explains the product. The main navigation's **Help** link opens `/help` for sign-in, coverage, allowance and snapshot guidance; Help and the public footer also expose the saved-file viewer. Customer sign-in opens `/dashboard`, which immediately loads the saved **EPFL east entrance** public-transport dataset. The EPFL west entrance is a separate profile; UNIL Dorigny is also available through the destination-profile selector. Each profile keeps its exact selected point and original journey assumptions. The initial profiles use home-to-destination public transport with an 08:30 arrival on 6 October 2026, in Europe/Zurich. These are illustrative calculations, not a current travel forecast.

The market contains 24 invented rental listings around Lausanne. Fictitious property names, CHF monthly rents, room/bedroom counts, furnishing and facilities provide useful filtering variation. Rooms remain separate from bedrooms. Unknown attributes, approximate locations, unresolved origins and unavailable routes remain visible. No listing describes a real property or promises actual availability.

Filter the dataset by rent, bedrooms, rooms, facilities or commute time; sort it or switch between list and map/coordinate views. These operations make no routing request and use no custom allowance. For example, maximum rent CHF 900 shows four fixture properties; adding minimum two bedrooms shows two. Changing an EPFL profile loads its maintained results without starting a private custom run.

A custom commute follows destination confirmation, travel/time settings, a review showing allowance implications, and an explicit start action. Editing a draft does not recalculate or relabel existing results. Custom results belong to their customer, remain temporary and can be recovered by that owner's recovery ID. Cancellation and discard show their effect on the existing allowance.

Complete permitted synthetic datasets can be exported and reopened as snapshots. The file contains the full dataset rather than only visible matches, preserves the original calculation time, and grants no account privileges. Import checks run locally and do not recalculate routes. Exact current availability is not inferred from a saved file.

Visitors can also use the public `/open-snapshot` page to open and filter an existing file without signing in. This local file viewer is independent of the API, accounts and new calculations; it can work when the online service is unavailable. It does not expose another customer's private server results. Source handoff and a future map SDK may still require a network connection.

Customers without runs can continue exploring published profiles and snapshots. The destination-limited account may calculate another profile for EPFL east but cannot start a new UNIL destination that day. Suspended customers can submit an account-support request and read the staff response; a support response alone does not restore an allowance.

## Staff journey

The staff workspace supports audited spending stops, source enablement, run cancellation, account allowance/status changes, shorter future retention, nomination review and support responses. Each change requires a reason. Approving a destination nomination does not calculate or publish a profile. Staff separately choose the approved exact point, market, travel settings, time and refresh policy, then explicitly publish or refresh its synthetic dataset. Removing a profile prevents ordinary maintenance from republishing it automatically.

## Saved fixture state

The first API startup writes the listing inventory and popular-profile manifests/results to the ignored `.data/` directory, or the directory selected by `DATA_DIR`. Listing records and larger result payloads use separate local repository/blob adapters. Restarting with the same directory reuses valid published snapshots. Startup prepares missing EPFL east/west defaults and refreshes expired profiles while respecting deliberate staff removal. Browser reload does not create a custom run or automatically reroute a valid popular dataset.

Fixture source changes are not applied by blindly overwriting an existing user's local records. To refresh the synthetic source deliberately, run `npm run ingest`, then `npm run maintain` against the same local `DATA_DIR`. To start over, stop the local processes and rename `.data/` to a dated backup before restarting; preserve any snapshots or state you want to keep. Do not use this reset procedure against cloud services.

## Integration TODOs

- Replace local mock password/session access with reviewed real customer and staff authentication; retain server ownership and staff-role checks.
- Identity, phone/institutional verification and duplicate-free-allowance policy are deferred at the user's request. Do not treat a local mock sign-in as production eligibility.
- Select authorised listing feeds and confirm retrieval, processing, media, retention and export rights before ingesting live inventory.
- Connect approved location/routing providers, restricted keys and provider-supported route controls. Establish rights for temporary results, shared popular datasets and portable files before enabling them.
- Connect GPT extraction only for permitted source descriptions with constrained schemas and field evidence; result filtering must remain independent of extraction.
- Review live Firebase/Google/Cloudflare configuration, separate environments, private storage/IAM, queues, schedules, expiry/cleanup and direct-origin protections.
- Approve advertising/consent/referral integrations and privacy/terms. No active ad network, payment flow or commercial commitment is implied by this local website.

Detailed production gates remain in [gates.md](gates.md). Local software checks and saved synthetic examples do not clear those gates.
