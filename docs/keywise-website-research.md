# Keywise: website structure and research
Research date: 1 October 2026. This is a research/design brief; application source has not been changed during this research.

## Interpretation of the request
Keywise needs the intended customer-facing website and application structure while external integrations remain unconnected. The public site showcases the product. Customers use the prominent sign-in in the header to reach their own dashboard. Staff use a less prominent footer entrance to a separately protected workspace. Testing should use ordinary account workflows rather than a role/persona selector.

The screenshots establish two navigation patterns: Google Workspace's public product presentation with prominent customer sign-in, and a publicly visible but discreet footer staff-login link. Imperial's screenshot illustrates placement; it does not establish the security behavior behind its link. The Imperial website returned HTTP 403 during research, so no claim is made about its actual login implementation.

## Findings from primary sources
1. Google's current Drive product page separates the marketing page at workspace.google.com/products/drive/ from its Sign in destination on drive.google.com. The product explanation, benefits, application preview and prominent sign-in sit on the public website. Keywise can use this separation without copying Google's branding or claiming AI features that are not connected.
2. OWASP recommends least privilege, denial by default and permission validation on every request. It explicitly says client-side access checks cannot determine access. A footer link or unlisted staff URL is navigation, not authorization.
3. Firebase supports administrative roles through custom claims. Its documentation says claims must be set from a privileged server environment and authenticated access must validate the identity token. A separate staff login page may use the same identity provider as customer login; the server-owned role is what permits staff access.
4. Firebase server session cookies require an existing Firebase sign-in/ID-token flow, CSRF protection, secure cookie policies and session validation. They are not a way to obtain real OAuth sign-in without configuring an identity provider.
5. Firebase's Auth Emulator is useful for isolated tests but issues unsigned tokens and is explicitly unsuitable for production. Removing visible demo controls alone does not turn test authentication into production authentication.

## Proposed areas
| Area | Routes | Content and access |
| --- | --- | --- |
| Public Keywise site | /, /how-it-works, /popular-destinations, /help | Keywise identity, commute-first explanation, honest supported-market information, popular-destination previews, example dashboard, top-right customer Sign in, help and footer links |
| Customer account and application | /sign-in, /dashboard and dashboard subpages | Normal account session; popular profiles, custom setup/confirmation/progress, results filtering/map/list/details, source handoff, snapshots, recovery, allowance, account and support |
| Staff account and application | /staff/sign-in, /staff and staff subpages | Discreet footer Staff sign in; only provisioned staff receive access to nominations/publication, sources, runs, account support/policy, spending stops and audit records |

Routes are recommendations rather than requirements from the source websites. A customer visiting the staff login can see that entrance but cannot receive staff access. Authenticated non-staff users get an access-denied page with a path back to their dashboard. There is no public administrator registration and no browser control that grants a role.

## Brand and public page
Use Keywise consistently in the header, footer, page titles, login, customer dashboard and staff workspace. An appropriate proposed hero is:
“Find a home that fits your commute.”
Supporting copy: “Choose where you need to be. Explore homes by journey time, then filter for your budget and housing needs.”
Primary action: “Start searching,” leading into the customer login/dashboard flow.
Secondary action: “How it works” or a public popular-destination preview.
Header navigation: How it works, Popular destinations, Help, Sign in.
Footer: Help/contact, privacy/terms links when their content is available, and discreet Staff sign in.

Avoid a public page full of route settings, allowance counters, internal provider gates, debug labels or scenario controls. Keep any sample-data disclosure concise and truthful in the relevant examples/datasets.

## Intended journeys
- Visitor: public showcase -> understand the service -> customer sign-in -> own dashboard.
- Returning customer: Sign in -> dashboard -> load a published profile, create an explicitly confirmed custom run, or reopen a snapshot.
- Customer exploring results: filter/sort/select properties over the current dataset without generating routes or changing the run's original definition.
- Customer changing commute settings: edit a draft -> review coverage and allowance -> explicitly start another run.
- Limited/suspended customer: dashboard remains useful for available popular profiles/snapshots; show actual account limits and the next valid action.
- Staff: footer entrance -> authenticate -> server confirms staff role -> separate operational workspace.
- Non-staff at staff entrance: normal credentials do not grant staff access; show access denied and return navigation.

Interpret the latest description as public destination previews and signed-in interactive filtering. This changes the earlier anonymous full-results flow. Popular browsing still consumes no custom-run allowance, and imported files still confer no privileges and initiate no routing. Access policy for offline snapshots should be recorded explicitly when restructuring rather than being removed accidentally.

## Comparison with the current implementation
The existing application already has many domain capabilities: private run ownership, allowances, local filtering, snapshots, recovery, support, nomination review and explicit popular-profile publication. These should be retained.

Its presentation still differs substantially:
- The root page is a tool workspace, rather than a public Keywise showcase.
- Customer account and administrator controls are inline panels, rather than distinct destinations.
- The brand is still “Commute-first property search.”
- Normal demo sign-in defaults to the Alice fixture; the scenario selector exposes test identities.
- A public fixture sign-in endpoint can select admin, and a known demo-admin bearer token is accepted. Those are test conveniences, not a secure staff login.
- Navigation state is component state rather than page routing with protected customer/staff destinations.

Consequently, simply hiding the selector or moving an admin button to the footer is insufficient.

## Authentication while integrations are deferred
Customer authentication and staff authorization still need to function. Deferred phone/institutional/free-allowance verification is a separate TODO and should not erase these access boundaries.

Two distinct implementation choices remain:
- For a functional local review without provider keys, use server-managed local accounts and real password/session validation. Staff accounts/roles are provisioned through a trusted server bootstrap, not customer registration. This demonstrates local authorization without claiming real OAuth or verified eligibility.
- For the eventual Google/Microsoft identity flow, keep the configured Firebase integration boundary. Do not silently log every visitor into Alice or label an unconnected provider as working.

The current edge proxy strips incoming Cookie and outgoing Set-Cookie headers. A future migration to cookie sessions needs corresponding deliberate proxy changes, CSRF protections and private/no-store responses. That is an implementation finding, not a change made during research.

## What “ready” means here
The intended deliverable is the normal public website, customer application and staff application with durable local accounts, correct role boundaries, routes/navigation, validation, empty/error states and the relevant user workflows. Routing, live feeds, GPT extraction, phone/eligibility verification and provider credentials remain explicit integrations.

This can be ready for functional local acceptance and prepared for integration. Live deployment readiness still requires connecting and validating authentication and the relevant providers. Automated fixtures belong in tests or isolated development tooling, outside the shipped customer experience.

## Sources
- Google Drive product site: https://workspace.google.com/products/drive/
- OWASP Authorization Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html
- Firebase custom claims: https://firebase.google.com/docs/auth/admin/custom-claims
- Firebase session cookies: https://firebase.google.com/docs/auth/admin/manage-cookies
- Firebase Auth Emulator: https://firebase.google.com/docs/emulator-suite/connect_auth
