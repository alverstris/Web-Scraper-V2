# Keywise customer and staff review

The current website has a public showcase, normal email/password sign-in, a separate customer dashboard and a staff workspace. The earlier identity selector, default-Alice provider simulation and browser token instructions are superseded. Use [the Keywise local guide](keywise-local-demo.md) for mock credentials, startup, saved EPFL datasets and integration TODOs.

All property information and journey estimates in this review are synthetic. Account identities/passwords are local fixtures. The review exercises real local ownership, filtering, allowance, file-validation and staff-operation logic; it does not validate a live housing feed, routing provider or production authentication.

## Prepare a review

Start the development processes using the same `DATA_DIR` as the prepared fixtures. For the prepared cloud workspace:

```sh
APP_MODE=demo DATA_DIR=.data/keywise-interactive-20261001 corepack pnpm dev
```

State and allowance usage survive restarts. To repeat tests with fresh accounts, stop the processes and choose another unused `DATA_DIR`; preserve the existing directory rather than deleting it. Sign out before switching customer/staff accounts. Keep browser contexts separate when checking ownership, since cookie sessions represent the authenticated account.

If inspecting network requests, count `POST /api/v1/runs` as new custom calculations. Filtering, sorting, property selection, profile loading, snapshot import, sign-in, recovery, support and nominations must create no new custom run. Explicit staff publication is a separate synthetic maintenance action.

## Visitor

1. Open `/` and explore **How it works**, **Popular destinations** and **Help**. These pages explain the product and coverage; property filters belong to the customer dashboard.
2. Use the top-right customer sign-in link. Expect `/sign-in`, with email/password controls and no account/persona selector or successful implicit login.
3. Use **Open a saved search** from Help or the public footer. `/open-snapshot` validates and explores a local file without account access or a new route calculation, including when the API is unavailable.
4. Follow the public footer's **Staff sign in** link. Its visibility is deliberate; access depends on the account's staff role, not on hiding the URL.
5. Visit `/dashboard` while signed out. Expect the customer sign-in path rather than another customer's results. Invalid credentials must remain on sign-in with a useful explanation.

## Eligible Alice and independent Bob

1. Sign in with `alice@keywise.test` and the customer password from the local guide. Expect `/dashboard` with saved EPFL east results immediately available. Loading the profile consumes no custom allowance.
2. Confirm the result header's exact entrance and travel mode; expand Search details to review the arrival/departure assumption, coverage and calculation time. Use Saved destination to load EPFL west and verify the point remains distinct. Try the four travel-mode buttons: each loads its own prepared dataset without using a run.
3. Drag the monthly-rent maximum to CHF 900: expect four fixture properties. Choose the 2+ bedroom button: expect two. Clear these filters, set the commute bar to 30 minutes, then expand Transit details to test walking, transfers and allowed transport types. More filters reveals rooms/space, furnishing/type, areas and all seven amenities. Try removing one active chip and clearing all filters. Change sorting, map/list presentation, selection and geographic view filters; no routes recalculate. Unknown attributes remain distinct from zero or absent.
4. Set up a custom commute: find an exact destination, confirm the intended entrance, choose supported travel/time settings and review the complete market and allowance effects. Returning to the draft or changing settings starts no work and does not relabel old results.
5. Explicitly confirm one calculation. Inspect pending/progress/terminal state, coverage counts, reservation/finalisation and recovery ID. Repeated filters after completion consume no further allowance.
6. Sign out, then sign in with `bob@keywise.test`. Alice's private results must disappear. Trying Alice's recovery ID must fail without disclosing her dataset. Bob can start an independent run for identical settings using his own allowance.
7. Return as Alice before expiry to recover her existing run without reserving another. Browser reload and repeated sign-in do not grant new allowances or start routes.

## New customer, exhausted and destination-limited accounts

| Customer account | Expected behavior |
| --- | --- |
| `new@keywise.test` | First local sign-in receives one synthetic entitlement. No phone/SMS/institutional verification step is required; that integration is explicitly deferred. Repeated sign-in preserves the same entitlement. |
| `exhausted@keywise.test` | Custom-run review/start remains unavailable with reset-time guidance. Saved popular profiles, free filters, snapshots and account support remain available. No fabricated paid upgrade or automatic free rerun appears. |
| `destination-limit@keywise.test` | EPFL east is already used today. Another profile for that entrance can be reviewed and explicitly calculated using one remaining run. EPFL west or UNIL is a new destination and remains blocked until the next policy day. |

Each account has its own server-derived allowance and private runs. A shared university network does not merge identities. Real verification and duplicate-free-entitlement prevention remain integration TODOs; these mock accounts do not prove person-level uniqueness.

## Suspended customer and support

1. Sign in as `suspended@keywise.test`. Expect an explanation that custom calculations are suspended, while popular profiles and saved-file exploration remain usable.
2. Attempt custom review/start and a destination nomination. The account restriction must remain effective; disabled controls must explain the next valid action.
3. Submit an account-support description without passwords, verification codes or private destinations. Expect an awaiting-review request visible only to its owner and authorised staff.
4. Staff can respond and resolve the request. Return to the customer's account to read that response. Resolving a support request alone changes neither allowance nor suspension.
5. A separate staff policy adjustment, if warranted in the review, requires its own audit reason and preserves recorded usage.

## Staff access and operations

1. Use `/staff/sign-in` with `admin@keywise.test` and the staff password from the local guide. Expect `/staff`. Ordinary customer credentials must be denied staff access with a route back to customer sign-in. Direct staff API requests from customers must also be denied.
2. Try an operational change without an audit reason. The action must remain unavailable. Supply a reason of at least three characters.
3. Stop new routing work: custom starts become unavailable, but existing published profiles and snapshots still work. Release the stop to restore acceptance subject to account/provider limits.
4. Inspect source health, run counts and external-work counters. Source toggles affect future ingestion/routing universes; they do not rewrite existing immutable snapshots. Restore source state after this review.
5. Review support requests and independently adjust account status/allowance when appropriate. Actor, time, reason and target appear in audit records; increasing a limit does not erase usage.
6. Shorten retention only within the approved maximum. Existing run expiry timestamps stay unchanged. Restore relevant settings or use a fresh fixture directory before unrelated tests.

## Nomination to maintained profile

1. As an active customer, nominate an exact destination/entrance and optionally its location type and expected usage. Submission starts no routing and counts one eligible request per entitlement. Different entrances remain separate nominations.
2. As staff, approve or reject the nomination with a reason. Approval alone creates no published dataset and consumes no routing budget.
3. Select the approved nomination in **Publish or refresh a popular profile**. Review the exact point and configure name, supported market, travel preferences, explicit journey time and refresh policy. Editing the form performs no calculation.
4. Explicitly publish the synthetic profile. Customers can subsequently load that shared dataset in their dashboards without creating private custom runs or consuming custom allowance.
5. Explicitly refresh an existing profile, preserving its destination point. The new version is coherent; already loaded results retain their prior definition until a new version is loaded.
6. Unpublish the temporary review profile. It must disappear from customer choices and must not silently return during ordinary maintenance. Source inventory is retained.

## Snapshots, recovery and discard

1. Narrow a complete permitted dataset's view, then export it. Reopening through the dashboard or public `/open-snapshot` viewer restores all 24 fixture records, its original time and assumptions, rather than only the filtered subset. No file is uploaded and no route recalculates.
2. Try malformed JSON, incompatible schemas, script-bearing values and oversized files. Expect an actionable error while preserving any previously valid loaded dataset. Imported data grants no allowance, staff role or partner credit.
3. Recover a private temporary run with the creating customer. Incorrect ownership, expiry and discarded runs must produce useful errors, without starting replacement work automatically.
4. For a terminal run, choose **Discard stored results**, first keep the results, then confirm discard. Server access ends; used allowance stays recorded. A previously exported permitted snapshot remains an old local file, not proof of current availability.

Synthetic batches wait 1,800 milliseconds by default so pending cancellation can be inspected. `DEMO_QUEUE_DELAY_MS` accepts 0–10,000 before startup. Cancellation before routing releases its reservation; after work starts, pending work can stop while one run remains used. For interrupted-work review, copy the recovery ID, stop the local processes, restart using the same directory and recover with the same customer. Existing successful batches are not deliberately recalculated.

Keyboard/mobile review should cover public navigation, customer/staff sign-in, filters, details, custom confirmation, snapshots and support. Respect reduced motion and preserve readable counts and selection when switching presentation. Provider outages, partial failures, expiry and stale leases also need controlled service/rendering tests; do not claim every failure state was manually reproduced through normal clicks.

Live identity/OAuth, verification, listings, routing, GPT extraction, maps, ads/consent, referrals, deployment and production operations remain deferred. See [gates.md](gates.md) and [acceptance.md](acceptance.md) for the evidence and remaining release requirements.
