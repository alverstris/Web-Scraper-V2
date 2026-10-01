# Release gates and deferred work

The local application is a synthetic implementation. A successful local test is not a live integration test. No API credential, listing agreement, SMS provider, ad network, map agreement or cloud account was supplied with the brief. These omissions stay explicit rather than being converted into fabricated production behaviour.

| Gate | Required decision or evidence | Current safe behaviour |
| --- | --- | --- |
| Listing supply | Named authorised feed; retrieval, storage, text processing, media and export rights; bounded ingestion test | Synthetic inventory only; no scraping/circumvention |
| Route content rights | Agreement covering temporary custom retention, maintained popular results, downloads, imports and geometry | Live dataset persistence/export not enabled |
| Location rights | Permitted resolver and retention; explicit distinction between source and Google-derived coordinates | Synthetic confirmed destinations and labelled approximate origins |
| Market/precision | Approved market coverage and policy for approximate origins | Demo coverage is stated; no national coverage claim |
| Eligibility | Phone or institution policy, duplicate paths, recovery and recycled identifiers; verification provider | Separate entitlement model; live free entitlement issuance unavailable |
| Usage policy | Allowance amounts, reset timezone, cancellations, partial failures and operator adjustments | Demo policy is test data, not a commercial commitment |
| Provider routing | Exact capability mapping, time policy, batch limits, retry behaviour and bounded live test | Unsupported combinations rejected; adapters cannot silently ignore controls |
| Popular maintenance | Approved points/profiles, refresh cadence, atomic publication and retention | Published synthetic profiles exercise browsing workflow |
| Retention | Approved payload lifetime, backup/replica behaviour, cleanup targets and minimal accounting retention | Immediate application expiry; cleanup implementation requires cloud verification |
| Firebase auth | Separate projects, Google/Microsoft configuration, domain list, linking/recovery and admin claims | Local mock passwords and cookie sessions enforce separate customer/staff roles; live provider linking and recovery remain unrun |
| Cloud deployment | Reviewed regions/IAM/secrets, direct-origin/storage tests, queue retry and scheduler execution | Parameterised deployment scripts; no services deployed |
| Ads/consent/partners | Chosen network and consent platform, source/referral agreements and privacy review | Disabled integration hooks; original source links remain usable |
| User information | Applicable privacy/terms, retention explanations and contact/support process | No legal or residency certification |
| Visual and motion acceptance | Animation design, full accessibility/device review and field performance | Branded Keywise public website, customer dashboard and staff workspace implemented; further motion and device review remain |
| Performance/security | Staging load test, security rules emulator checks, provider-error drills and mobile field evidence | Software tests only; no claim of production SLOs or Web Vitals |

## Integration work still required

The selected stack includes a Google location resolver and route-matrix adapter, an authorised normalised JSON listing-feed adapter, Firebase authentication, Firestore/GCS adapters and Cloud Tasks dispatch. Their live composition deliberately reports unavailable capabilities while provider permission records and policy decisions are missing. Enabling it requires selecting approved providers and supplying the reviewed configuration through `PROVIDER_CONFIG_PATH` and `POLICY_CONFIG_PATH`, not merely setting `APP_MODE=live` and adding a Google key.

Complete Firebase provider setup, Turnstile configuration and the approved entitlement-verification delivery flow. Supply the selected authorised feed configuration and test the existing normalised JSON connector; a supplier with a different raw schema needs an additional normalisation adapter. Review the implemented Google resolver and routing mappings against the applicable agreement and chosen route modes. Prove account isolation, concurrent allowance reservation, Cloud Tasks redelivery and expiry with the actual cloud services. Deploy and test Firestore rules separately; local repository tests do not prove IAM or rules deployment.

The demo map representation is a synthetic schematic with list fallback. An optional Google Maps component exists, but its live SDK behaviour, attribution, restricted browser key and CSP must be verified before enablement. The Keywise visual identity and public/dashboard/staff page layouts are implemented; additional animation, full accessibility/device review and field performance evidence remain separate work. Actual ad scripts, consent management, sponsored campaigns, paid plans and partner billing remain inactive. Focused search, contact-agent lead forms, duplicate-property grouping and optional snapshot listing refresh are later scope.

## Release evidence record

For each affected feature, record agreement/approval reference, reviewer, review date, applicable environment, data fields, storage/export permissions, tested provider/API version, bounded live test run and rollback owner. Store the confidential agreement itself outside this public repository. Publish only the user-facing attribution and terms that the agreement requires.

Resolve rights first, then perform bounded integration tests in a separate staging project. Passing tests should update [acceptance.md](acceptance.md) with the date and evidence type: unit/synthetic, emulator, staging live integration or production field observation. Unrun checks must remain marked unrun.
