# CONTEXT — B2B/B2C Telecom Marketplace Prototype

**Read this first if you are picking this work up cold, on a new session, or on a different model.**

Written 25 Jul 2026, last updated 26 Jul 2026 (M21). It records what exists, why it is the way it is, what was tried and rejected, and what would break if you changed it. Everything here is verifiable from the files in this folder.

---

## 1. What this is in one paragraph

A working, self-contained front-end prototype of a telecom marketplace platform for **6D Technologies**, built for Mani (AVP Solutions). Four HTML files, one per persona, each a complete single-page application with no back end, no build step to view, and no network calls except the Poppins webfont. They share one deterministic synthetic dataset so the four personas reconcile against each other. It exists to make the PRD reviewable, to demo to an operator, and to de-risk estimation. It is **not** production software.

---

## 2. Folder contents

```
D:\Claude\Projects\B2B_Marketplace\
├── PRD.md                      v3.6 — product requirements, aligned to the build
├── epics_and_stories.md        v1.15 — EPICs and stories, with prototype status markers
├── CONTEXT.md                  this file
├── README.md                   the prototype's own walkthrough — what to click in a demo
├── index.html                  entry point: persona cards and the demo script
├── consumer.html               18 screens · 6D brand
├── partner.html                23 screens · 6D brand
├── operator.html               31 screens · 6D brand
├── enterprise.html             20 screens · neutral / white-label
├── assets/brand/               approved logo assets (see §7)
├── selfcare/                   earlier Enterprise Self-Care prototype, parked (see §9)
└── _src/                       source layers and the build script
```

### `_src/` layout

| File | Role |
|---|---|
| `build.py` | Inlines the shared layers into each persona file. **Run this after every edit.** |
| `core.css` | The entire design system — nim tokens, components, layout, responsive rules |
| `core.js` | App shell, nav, DataTable, charts, dialogs, inspector, toasts, AI panel, profile menu |
| `icons.js` | Lucide icon paths + `SHAPE`/`SH()` inline SVG status shapes |
| `mp_data.js` | The marketplace dataset — seeded, deterministic, ~120 KB |
| `mp_shared.js` | Shared marketplace components, the state layer, and every cross-persona engine |
| `views_consumer.js` · `views_partner.js` · `views_mpoperator.js` · `views_enterprise.js` | Per-persona screens |
| `journeys*.js` | Twenty-one automated test suites |
| `layout.js` | Alignment and unstyled-class audit across all four built files |
| `smoke.js` | Per-persona render walk |
| `data.js`, `shared_views.js`, `views_admin.js`, `views_user.js`, `views_lead.js`, `views_operator.js` | The parked self-care prototype's layers |

---

## 3. How to work on it

```bash
# after ANY edit to _src/
python3 _src/build.py

# tests (each stays under a 45-second budget deliberately — see §8)
npm install jsdom
node _src/layout.js               # alignment and unstyled-class audit
node _src/journeys.js             # 123 checks
node _src/journeys_admin.js       # 166 checks
node _src/journeys_config.js      # 214 checks
node _src/journeys_catalogue.js   # 247 checks
node _src/journeys_commerce.js    # 129 checks
node _src/journeys_audit.js       # 134 checks
node _src/journeys_ops.js         # 140 checks
node _src/journeys_wms.js         #  38 checks
node _src/journeys_platform.js    # 209 checks
node _src/journeys_final.js       # 159 checks
node _src/journeys_billing.js     # 142 checks
node _src/journeys_adjust.js      #  77 checks
node _src/journeys_scope.js       #  54 checks
node _src/journeys_trim.js        #  41 checks
node _src/journeys_gaps.js        #  52 checks
node _src/journeys_rewards.js     # 132 checks
node _src/journeys_theme.js       #  89 checks
node _src/journeys_onboard.js     # 240 checks
node _src/journeys_stored.js      #  86 checks
node _src/journeys_deps.js        # 106 checks
node _src/smoke.js partner.html   # render walk, one persona at a time
# 2,578 checks across twenty-one suites, plus the layout audit and four smoke walks
```

**Never edit the built `*.html` files directly.** They are generated. Edit the layers in `_src/` and rebuild.

`build.py` carries a **scope guardrail**: it greps `mp_data.js` for SD-WAN, MPLS and CPQ terms and exits non-zero if any appear. That exclusion was an explicit instruction and the guardrail exists because it was violated once already.

---

## 4. Milestones completed

Chronological. Each entry states what was asked and what materially changed.

### M1 — Wrong product, corrected
Built four Enterprise Self-Care personas from a Drive PRD. Rejected: *"These prototypes do not look like Marketplace at all."* Researched real marketplace platforms and rebuilt against the six-category table supplied. The self-care work was parked under `selfcare/` rather than deleted, at your request.

### M2 — The marketplace, four personas
Six categories, 15 partners, 39 products, 2,600 orders, 30 settlement statements. Consumer storefront, partner console, operator console, enterprise buyer portal. Brand split agreed: 6D on operator, partner and consumer; neutral on enterprise because it is the surface an operator white-labels.

### M3 — Journeys became stateful
*"Partner onboarding steps are not working."* Every action had been a toast. Added a state layer in `mp_shared.js` plus `BEFORE_RENDER` / `AFTER_RENDER` / `App.refreshNav()` hooks so actions mutate real records and the UI re-derives. This is the single most important architectural change in the project.

### M4 — Invitations name a recipient
*"To whom / which partner is this sent?"* Replaced the dead-end invite toast with a validated form that creates a real partner record at the application gate.

### M5 — Glyphs, categories and brand
*"I do not want question marks."* Every status shape had been a Unicode dingbat that Poppins has no glyph for. Converted all to inline SVG; a test now fails if any dingbat reaches the DOM. Added six categorical colour tokens and four distinct tier shapes. Applied the supplied 6D logo.

### M6 — Top bar and My details
Top bar rewritten as a strict single-line flex row with a defined drop order. Consumer *My details* rebuilt so every control mutates a record — payment methods, addresses, wallet, points, data requests, account closure. Added coverage check, trade-in and bundle builder.

### M7 — Configuration surfaces
Roles configuration as its own screen in all four portals with an editable capability matrix. Password, MFA and session management. Settlement invoice detail before approval. Bill formatting and per-partner cycles. Fixed "Add to basket" appearing on seller and operator product views.

### M8 — Governance journeys completed
Working profile menu behind the avatar. Real CSV/JSON export engine replacing 62 toast-only buttons. Per-vertical and gate policy editors. Marketplace-to-partner-list redirection with filters. Tax configuration and merchant of record. AARYA logo applied to the assistant. Redesigned the AI confidence chip, which had been rendering as an empty box.

### M9 — Catalogue and commercial depth
Notification rule builder and per-channel message templates. "Six marketplaces" generalised to "marketplace categories" with computed counts. Onboarding gates made openable with full submissions. Listing policy console. Commercial models with model-driven parameters. Partner bills, viewable and downloadable. Operator first-party product and bundle composition from the BSS catalogue.

### M10 — Reporting and partner self-service
Real 90-day / 12-month period switch backed by a trailing series that reconciles exactly to the live order set. Partner onboarding guide. Partner's own application submissions. Partner bill downloads and previous bills.

### M11 — Media, integrations and pricing
Multi-media listing manager with mandatory alt text. Partner integrations console — endpoint registry, event catalogue, test call, delivery log, API keys. Three-tier pricing with an absolute cost floor. Per-component bundle discounts capped at cost. The conditional discount rules engine.

### M12 — Audit trail
Append-only trail in all four portals with per-role read scoping: a role with no audit categories is refused the screen, personal data is redacted rather than hidden, and your own actions are never redacted from you. Reading the log is itself logged and is itself a permission in the roles matrix. Around fifty action types now write entries from the live state layer.

### M13 — Storefront advertising
Four banner slots modelled as a small ad server rather than a hard-coded hero: targeting, scheduling, share-of-voice weighting and measurement. Pre-login targeting deliberately limited to locale and device. Sellers cannot buy placement, and the console says so. Buyers get a "why am I seeing this" explanation.

### M14 — Inventory
Stock became a ledger: on hand, reserved, available, with soft holds at basket and decrement at dispatch. The storefront reads availability from it, so adding to a basket is capped and an out-of-stock line is refused rather than discovered at fulfilment. Movement history, SIM pool with a lifecycle, and logical capacity pools.

### M15 — Ticketing and SLA
The general queue behind disputes: eight categories, four priorities that multiply rather than replace the category target, an SLA clock that pauses while waiting on the requester, automatic four-step escalation, threaded replies and internal notes. Scoped per organisation.

### M16 — Reviews
Verified-purchase-gated submission, moderation for content rather than sentiment, seller replies, and aggregates that blend the historical count with published reviews so the headline figure never contradicts the list a buyer can read.

### M17 — Partner branding
The seller's own console in their livery, with contrast checked rather than trusted and three dashboard cards that cannot be hidden. Scope stated explicitly: it stops at their console.

### M18 — Documentation
PRD updated to v1.8 with seven new functional sections and a traceability matrix. Epics updated to v1.10 with 16 new EPICs and 80 stories. This context file.

### M19 — Developer portal, catalogue depth, WMS, audit integrity, dunning and forecasting
The last five gaps from §10, closed in one pass, plus a forward view for every persona.

- **Marketplace developer portal** (`operator.html` → Developer portal). Five published APIs each declaring the TMF standard they implement and their lifecycle state, four access plans, five consumers with key state and quota consumption, and reference documentation carrying a real request, a real response and an idempotency rule on every write endpoint.
- **Listing versioning** — every partner listing carries a history. Rollback writes a *new* version rather than deleting one, so the record of what a buyer could have seen on a given date survives.
- **Contract pricing** — account-scoped negotiated prices with minimum quantity and term. An unsigned price is recorded and shown but never resolves.
- **Product comparison** — a three-item tray on the consumer storefront, reading availability from the stock ledger rather than a static field.
- **WMS integration** — each warehouse bound to a system with a sync mode and state, drift against the ledger surfaced with direction and magnitude, shipments with carrier and tracking, and drop-ship declared as delegated rather than measured.
- **Audit integrity** — hash chain with a daily anchor to object-locked storage, on-demand verification that reports entries checked and gaps found and writes itself to the log, and three SIEM destinations with one deliberately running behind.
- **Dunning** — a seven-step ladder, cases with amount, age, attempts and reason, retry, promise-to-pay and a customer-side notice on the consumer's own account.
- **Projection** — `forecastFrom()` and `forecastAccuracy()` in `mp_shared.js`, surfaced on all four dashboards: operator revenue, partner settlement, enterprise spend against budget, consumer cost of commitments. Linear trend over the trailing six months × a seasonal index, with a confidence band, and a backtest error printed on the panel.
- **Eighth test suite** `journeys_platform.js`, 85 checks.

### M20 — Authentication, Number Management and channel delivery
The last three gaps from §10, all of which had been described as needing a back end. They do — but the *behaviour* around each is where the design lives, and that is what was built.

- **A real sign-in gate** on all four personas. `App.init()` renders the login card and returns; the shell is not built until a session exists, so no record is in the DOM before sign-in. Password, TOTP, passkey, per-account lockout after five failures, step-up re-authentication before a named list of sensitive actions, session listing and revocation, and a sign-in history that keeps failures.
- **Enforced SSO closes the local password path.** The enterprise persona has no password field at all, because its domain is enforced. The operator's is available but not enforced, and the panel says so and names the weakness.
- **Number Management / Logical Inventory integration.** ICCID, IMSI and MSISDN are federated from the operator's BSS, not held here — three systems, TMF639 / TMF652 / SGP.22 ES2+, reserved ranges with expiry, the full eSIM profile lifecycle, and nightly reconciliation in which the BSS always wins and nothing is ever written back to it. A seller sees allocations against its own orders only.
- **Channel delivery.** Six providers with protocol, sender, throughput, unit cost and receipt support; primary and failover; the eight-state DLR machine under the transports' own names; retry with backoff; hard rejections that are never retried; per-message reason codes; channel spend per thousand. Push is declared as having no true receipt and is kept out of the platform average.
- **Ninth test suite** `journeys_final.js`. All eight earlier suites were patched to sign in through the gate rather than around it.

### M33 — Dunning ladders per customer type, and the general ledger
- **Five ladders** — consumer, small business, enterprise, seller, and a high-value consumer band. Resolution is from the account, most specific band wins. Pacing genuinely differs: consumer suspends at day 14, enterprise not before 60, and a seller never — settlement is withheld instead, because taking their listings down strands a buyer mid-order.
- **The step editor argues back**: suspending a consumer early, no terminal step, a ladder that never tells the customer, two steps on one day. A ladder must state why it is paced that way, or it gets overridden case by case until it means nothing.
- **The general ledger.** Chart of accounts, seventeen charge types each mapped to a debit and credit with the reasoning recorded, postings generated from the order register, and a trial balance that must net to zero. The judgement that matters: gross collected credits a liability, not revenue — booking it to revenue overstates income by roughly the size of the marketplace. Period close is blocked while the columns disagree.

### M32 — Three fixes from review
- **A flex `<td>` broke table row alignment.** `td.rowend{display:flex}` takes the cell out of the table layout algorithm, so the buttons stopped tracking their own row and drifted over the ones above and below — which is exactly why a click on Configure landed on Preview. Cells are `table-cell` again with the buttons spaced by a sibling rule.
- **Bill formatting and templates held half the answer each.** `BILL_FORMAT` is gone; numbering, date format, currency, tax label, rounding, language, remittance and footer now live **on the template**, so a numbering pattern and a document title cannot disagree about the same bill. The formatting panel edits whichever template that audience is assigned, and says so.
- The live document sketch was lost in that rewrite and has been restored, now driven by the template.

### M31 — The bill became a template system
The bill was a hard-coded layout with no advert, no contact blocks and no support details, and only the enterprise persona had a PDF at all. All three were fair criticisms.

- **Fourteen switchable sections**, four of them locked — masthead, both parties, taxation and the reconciling summary. A document without those is not a bill.
- **Five templates**, operator-managed: create, duplicate, configure, preview, delete. Assigned per audience with a per-partner override. Built-ins are reconfigurable but not deletable, because an audience with no template has no bill.
- **The editor argues back**: an advert on a seller invoice, a payment slip on self-billing, a slip with no payment instructions, a bill with no support block.
- **Both parties in full**, provider support with hours and an escalation address, and one advert from a dedicated bill slot — suppressed on anything overdue or in dunning.
- **PDF in every persona**, CSV alongside. A consumer bills screen was added; there was none.
- Two defects found. `taxRate()` returns a percentage, and both document functions treated it as a fraction — an 18% line was rendering as 1800%, so a $172.88 bill showed $3,111.84 of tax. And the tenth suite exists because `journeys_platform` had reached 34 seconds against a 45-second cap; the document and billing checks were split into `journeys_billing.js`.

### M30 — API authoring, versions and the subscription matrix
The developer portal listed APIs and let you change none of them, showed one version number per API, and never said who was calling what.

- **Publish an API from the console** — identifier, standard, audience, scopes, methods, environments, lifecycle, and a mandatory one-line answer to why it exists. The identifier is fixed once published because it appears in every base URL.
- **Version history per API**, each version carrying a changelog. A breaking change is a new major version, never an edit; the dialog distinguishes additive from breaking and says what each obliges. Deprecating requires a sunset date and names the consumers still on it.
- **A subscription matrix** — APIs down, consumers across, showing the version each holds, with anything on a deprecated or sunset version in amber.
- One defect found while testing: `avPreview` built its output as `brk ? A : B + C`, which parses as `brk ? A : (B + C)`. The deprecation warning vanished on exactly the change most likely to need it — a breaking one. Parenthesised and covered by a check.
- A second, smaller one: a test asserted the total count of `bulk.apply` audit entries was one. Once the dataset carried a seeded bulk job that became two. The assertion now counts what the action adds rather than the total, which is what it always meant.

### M29 — The event catalogue made configurable
The events were readable and not editable, which made them look like a property of the platform rather than a decision somebody took.

- Each event is now authored: id, label, seller-facing meaning, group, payload fields, personal-data flag, mandatory or not, and which fulfilment models it applies to.
- **The blast-radius preview is the point.** Marking an event mandatory puts every seller without an endpoint for it out of compliance the instant it is saved, so the editor computes and names them live, before the save.
- Draft, active, deprecated. A draft creates **no** compliance gap — an event nobody can hear cannot oblige anybody. Deprecated keeps being delivered to existing subscribers and stops being mandatory.
- Two defects surfaced. `pepAllGaps`, the coverage matrix and the impact preview all filtered partners on `status==='active'` when the trading status is `'live'`, so **every gap count silently read zero**. And `pepRequiredFor` did not check event status, so a draft event marked mandatory immediately created gaps across the estate. Both were caught by writing the test before believing the screen.

### M28 — The developer portal corrected, and the inbound side built
A conceptual correction from the user, and two things it exposed.

- **The developer portal was framed as API monetisation. It is not.** It is integration access extended to partners — a second way to do what their console already allows. Priced plans became **entitlement tiers** with no price field at all; a test now asserts `API_TIERS.every(t => t.price === undefined)` so it cannot creep back. Added Subscriptions (TMF637) and Inventory (TMF685) as first-class APIs, and made sandbox and production explicit, with production **earned** by completing a sandbox order rather than requested.
- **The inbound side did not exist.** `PARTNER_ENDPOINTS` now holds every partner's endpoints, over 23 marketplace events grouped as Order, Subscription, Catalogue, Finance and Support. The coverage matrix answers the question the operator could not otherwise answer: if this event fires tonight, who hears about it. Required is relative to the fulfilment model, so a shipper is marked *not applicable* for subscription events rather than counted as a gap.
- **Integration became a tested onboarding milestone.** Four checks — endpoints for every required event, authentication on all of them, an acknowledged test call each, and one sandbox order end to end. `advanceGate` refuses the technical gate until all four hold, with **no override**. Two existing journey tests began failing the moment this landed, which is the control working; both were rewritten to prove the integration the way an operator would have to.
- **Operator-led onboarding.** The desk can capture the same application a seller would submit, with a mandatory reason. It marks the application gate done and opens KYC — it clears nothing else, because a path that skipped the checks would be a way round the controls rather than a convenience.

### M26 — Real documents, and a dataset with depth
Two reports: downloads produced nothing, and screens looked sparse.

- **A PDF writer in `mp_shared.js`** — object graph, cross-reference table, base-14 Helvetica, WinAnsi folding of the typographic characters used elsewhere, and a page builder with title, key-value, table, total, note, two-column, hero, terms and payment-slip primitives. `buildPdf` assembles byte chunks rather than a string, because an embedded image is binary and any text encoding corrupts it.
- **Brand artwork is embedded.** The PNGs are colour type 6, so `build.py` decodes them, unfilters the scanlines, splits RGB from alpha, recompresses both and emits base64 into the bundle as `BRAND_IMG`. The PDF places them as an image XObject with an `/SMask`. The browser has no zlib, which is why the decode has to happen at build time.
- **An operator logo was created** — `assets/brand/aventa-logo.png` and a white variant — because the issuing operator is fictional and had no mark. The 6D mark is used as supplied and is never reconstructed.
- **A full bill template**: masthead, issuer legal identity, billed-to, headline amount, recurring stack, one-off charges, taxation table, summary, payments received, how to pay, ten numbered terms in two columns, and a detachable payment slip.
- **Dataset deepened three to fourfold** on the operational surface only. The reconciling core is frozen: GMV is still $711,108.93 and still equals the sum of the categories.
- Three defects found by the new checks: a footer that ran through the page number, an `ETBT` operator from a missing newline, and — from the data work — audit entries seeded into contexts that could never produce them, plus one pre-existing buyer entry in a category no buyer role could read.

### M24 — Knowledge base and guided walkthroughs
A help centre in every portal, scoped to what that persona does. Thirty articles across the four, plus nine walkthroughs.

- **Walkthroughs navigate the console** rather than describing it. Each stop moves to the screen — or opens the drawer, where the step is a drawer rather than a screen, which is why a `basket` stop carries `open:'openCart()'` instead of pretending `basket` is a view.
- **Contextual help in the top bar** opens the article for the screen you are on. A screen with no article says so and opens the catalogue instead of failing silently.
- **Role-scoped for action, not for reading.** Anyone can read any article; a reader whose role cannot act is told which role can.
- **Ratings are counted, review dates declared, and every article routes into a ticket** pre-filled with its own title — the articles that fail are the ones worth finding.
- A validator in the suite fails the build if any article or walkthrough stop points at a view that does not exist in that console. It caught two on the first run.

### M23 — Product-grade wording, and the rules made findable
Two follow-ups from review, both about how the build reads rather than what it does.

- **No wording anywhere tells a viewer this is provisional.** "Prototype", "synthetic", "fictional", "demo", "not reproduced in this prototype" and "in the real platform" are all gone from every screen, dialog, inspector and from `index.html`. The disclaimers they carried were kept where they were true and reworded to say the true thing — "Document contents are not shown here. Uploaded partner documents are personal and commercial data." One of them was also **stale**: the audit panel still said a production trail *would be* hash-chained and SIEM-exported, which M19 had already built.
- **The rules were findable only by scrolling.** The rules table sits below four fields, three toggles and a divider inside a 470px inspector, so reviewers concluded there was nowhere to configure them. Added a signpost above the fold with the applied/enforced counts, a jump to the section, a route to the full matrix from the inspector footer, and a **Listing rules** action on the Marketplace categories page itself.
- **The lock now holds on both paths.** `cyclePolicyRule` in the category inspector did not honour a locked rule, only the matrix did. A control enforced in one place and not the other is not a control.
- `layout.js` gained a **provisional-wording check** across all 85 views, so the language cannot regress.

### M22 — Listing rule catalogue and the per-seller cap
Two controls that were displayed but not real, both found by the user reading the screens rather than by any test.

- **The rules were shown per category with no page to author them.** POLICY_RULES was a hard-coded list of ten with only id, name and description. Now each rule carries how it is checked, why it exists, who owns it, what evidence it needs and its lifecycle, with a rule × category matrix so "where does this apply" is one screen rather than six inspectors. Retire, never delete — past decisions cite the rule.
- **The per-seller listing cap was stored and never checked.** `maxListingsPerSeller` was written by the policy inspector and read by nothing. Now enforced at submission and on the bulk path, with headroom shown when the category is chosen. Its label also collided with "held" meaning blocked in review, so it now reads "Live listings per seller".

### M21 — Bulk update
Two doors, one engine, across all four personas.

- **CSV upload** and **common update** run through the same validator, dry run and commit, so a rule cannot hold on one path and lapse on the other.
- Nine sets: operator has listings, partners, SIMs, users and banners; the seller has its own listings and its stock; the buyer has its users; the consumer has auto-renew and nothing else.
- Update-only — no create, no delete. Mandatory dry run. Per-row rejection with a 20% ceiling on the file. Every domain rule enforced identically, including the cost floor, the reserved-stock floor and the refusal to let anybody change their own access from a spreadsheet.
- One audit entry per job rather than one per row.
- Folded into `journeys_final.js`, which now runs 156 checks in about 32 seconds.

---

## 5. Architectural decisions and the reasoning behind them

Change these only deliberately — each one has a failure mode behind it.

| Decision | Why | What breaks if reversed |
|---|---|---|
| **One deterministic seeded dataset** (mulberry32, seed 20260725) shared by all personas | The four portals must agree. A demo dies the moment the operator's GMV does not match the sum of the categories. | Cross-persona reconciliation; roughly 40 tests assert exact equality |
| **Build-time inlining rather than modules** | Files must open from the file system with no server. | Portability — the whole point of a self-contained demo |
| **State layer in `mp_shared.js`, views are pure functions of state** | Actions must mutate records, not fire toasts. | Every end-to-end journey and its test |
| **`dt()` caches DataTables but refreshes rows** | Caching preserved sort/search/page but froze the row array, so newly created records never appeared. Fixed by reassigning rows while keeping view state. | New records become invisible in every table in every persona |
| **Confirm dialogs snapshot form values before teardown** | Handlers were reading a detached DOM, silently discarding everything typed into a dialog. | Licence counts, reasons, intervention outcomes all lost again |
| **Status shapes are inline SVG, never Unicode** | Poppins has no dingbat glyphs; every chip rendered as `?`. | Universal visual failure on machines without a symbol fallback font |
| **Cost floor enforced in the pricing engine, not in rule authoring** | A floor an author can write around is not a floor. | The commercial guarantee that nothing sells below cost |
| **Discounts applied before tax** | Tax follows the price actually charged. | Every tax figure on a discounted basket |
| **Tax backed out of inclusive prices, never added** | The checkout was adding 18% on top of a tax-inclusive shelf price, overstating totals by the tax on the tax. | Every consumer total |
| **Approved logos referenced as images** | The design contract forbids reconstructing a brand mark in CSS or SVG. | Brand compliance; a test asserts the correct mark per portal |
| **Audience derived from `App.cfg.orgCtx`, not from which globals exist** | Both personas share the dataset, so sniffing for a global got enterprise detection wrong. | Enterprise promotions silently evaluating as consumer |

---

## 6. The dataset and its invariants

Defined in `_src/mp_data.js`. **These invariants are load-bearing — several tests assert them to the cent.**

| Invariant | Value |
| GMV = sum of categories = sum of order gross | $711,108.93 |
| Marketplace commission | $66,304.03 (9.3% blended take) |
| Settlement net = gross − commission − fees − withholding − refunds, across all 30 statements | holds |
| Statement order lines reconcile to statement gross | to the cent |
| Last 3 months of the 12-month history = the 90-day figure | exactly |
| Per-partner history reconciles to that partner's own gross and order count | exactly |
| Every priced product has a cost below its price | 0 exceptions |

Entity counts: 6 categories · 15 partners · 39 products · 2,600 orders · 30 statements · 8 plans across 7 commercial models · 7 onboarding gates · 10 catalogue policy rules · 6 promotions · 6 tax jurisdictions · 17 operator BSS products · 18 notification events · 11 integration events · 12 months of history.

**Order mix is deliberately inverted**: consumer and content generate ~69% of order count but ~4% of gross value; IoT, security and device are the reverse. That shapes the whole narrative — support load follows order count, settlement risk follows gross value — and it is stated on the operator overview.

---

## 7. Brand assets

`assets/brand/` holds the approved raster assets. **None of these is reconstructed in code.**

| File | Use |
| `6d-logo-white.png` | Rail brand mark on 6D-branded portals |
| `6d-logo.png` | Light-background variant |
| `aarya-mark.png` | AARYA glyph, background knocked out to transparency — assistant launcher and panel header |
| `aarya-wordmark.png` · `aarya-lockup.png` | Cropped from the supplied lockup, available for documents |

`README.txt` in that folder notes that neither 6D file matches the hash recorded in the design skill; they are the assets you supplied on 25 Jul 2026 and were used as given.

---

## 8. Test architecture, and why there are ten suites

The shell running these has a **45-second cap per command**. The suite was split repeatedly as it grew — the split is by area only, and each file now runs in 12–37 seconds. There is no other reason for the boundaries.

| Suite | Checks | Covers |
| `journeys.js` | 120 | Core buying, selling and safeguard journeys |
| `journeys_admin.js` | 155 | Administration, consumer account controls, presentation contract |
| `journeys_config.js` | 204 | Roles, passwords, listing actions, settlement documents, billing, tax, export, profile, AI confidence |
| `journeys_catalogue.js` | 246 | Notifications, onboarding gates, listing policy, commercial models, partner bills, first-party products, reporting periods |
| `journeys_commerce.js` | 112 | Product media, partner integrations, three-tier pricing, bundle discounts, the discount engine |
| `journeys_audit.js` | 133 | Audit trail, role scoping, redaction, storefront advertising |
| `journeys_ops.js` | 140 | Inventory, ticketing and SLA, reviews, partner branding |
| `journeys_platform.js` | 205 | Developer portal, projection maths, dunning, WMS drift, chain verification, versions, contract pricing, comparison |
| `journeys_final.js` | 156 | Sign-in gate, lockout, enforced SSO, step-up, sessions, Number Management, channel delivery, bulk update |

Plus a tenth script that is not a journey suite:

| Script | Checks |
| `layout.js` | Walks all 84 views. Flags any class used in markup with no CSS rule behind it, any table row whose cell count does not match its header, numeric cells not right-aligned under a numeric header, and inline min-widths that would overflow a 1024 viewport. Run it after any CSS or markup change. |

**1,604 checks total.** They assert that records changed, not that screens rendered. They click through confirmation dialogs exactly as a person would. If you add a suite, keep it under the cap.

### Defects the layout audit caught
Added 26 Jul 2026 after a report of overlapping buttons on the bulk update screen. Both defects render without throwing, so no journey test could see them.

1. **`.rowend` had no CSS rule.** Four action groups — bulk, sessions, the ICCID inspector and the delivery inspector — rendered their buttons edge-to-edge with no gap, reading as one merged control. The same audit found `.warntext` and `.stock-in` undefined, and `banner('success', …)` emitting `.banner-success`, which had no rule at all, so every success banner drew a `currentColor` border with no fill.
2. **A missing closing quote on a `style` attribute in `tktSlaBar()`.** On a breached ticket the markup was `<div class="t-tiny" style="color:var(--nim-danger-fg)>`. The parser then consumed the following `</td><td>` into the attribute value, so the row lost a cell and **every column to the right of Resolution SLA shifted left by one** — the State pill appeared under the SLA header. Only breached tickets were affected, which is why it survived nine test suites.

The fix for the first was a systemic CSS rule (`.tbl td > .btn + .btn`) rather than a wrapper added to each of the ten render functions, so cells added later inherit the spacing.

### Defects the tests caught

Worth knowing, because most would have surfaced live:

1. Confirm dialogs read form fields **after** the dialog was removed from the DOM — everything typed into a dialog was discarded.
2. "Invite a partner" was a dead-end toast with no recipient.
3. The gate machine reopened already-cleared gates for a partner adding a second category.
4. Every status chip rendered as `?` — Unicode dingbats Poppins cannot draw.
5. `pill('neutral', …)` had no map entry and fell through to the "unavailable" style.
6. The top bar wrapped instead of truncating; the freshness chip went stale after 45 seconds, making a healthy header look broken mid-demo.
7. Cached tables kept their original row array, so no created record ever appeared — in any table, in any persona.
8. The AI confidence chip stretched to full card height and read as an empty outline.
9. The basket added tax **on top of** a tax-inclusive price, overstating every total by the tax on the tax.

---

## 9. Constraints — what this prototype deliberately is not

State these in any demo. They are not apologies; the alternative is someone believing it is production-ready.

1. **No back end.** State lives in memory and resets on reload.
2. **No authentication.** Passwords, MFA and keys are modelled as records and behaviours.
3. **No real documents.** CSV export is genuine and downloads. PDF is acknowledged as a stub.
4. **Media is metadata.** There is no file system, so an added image is a plausible record. The validation, ordering and alt-text rules are the real part.
5. **Tax figures are illustrative.** Configuration, not advice, and the screen says so.
6. **Order-level detail is 90 days.** The 12-month view is monthly aggregates before that, deliberately, and it is labelled.
7. **SD-WAN, MPLS and CPQ are excluded** at your direction, with a build-time guardrail.
8. **`selfcare/` is parked.** It is the earlier Enterprise Self-Care prototype, kept alongside at your request. Not marketplace scope; do not extend it without being asked.

---

## 10. Known gaps, in priority order

Not defects — scope not yet built. From the coverage table in `epics_and_stories.md`.

| Gap | Component | Note |
| UPC federation | CAT | Modelled as a local operator catalogue of 17 products; not an integration. |
| Loyalty programme and tier definition | BIL | Points balance and redemption exist; TMF737 programme design does not. |
| n8n orchestration | AI | The whole Category C of PRD §4.5. |
**There are none left.** Every gap recorded in v1.8 through v2.0 of the PRD has been closed.

What remains is not gap but *substrate* — the things a prototype cannot have because it has no server:

| Not present | Why | What was built instead |
| A server to check credentials against | No back end | The gate, lockout, step-up, enforced SSO and session lifecycle are all real behaviours; the credential check itself is a string compare |
| A write path to the operator's BSS | Deliberate — see §13 | Read and reconcile only. Nothing here, including a bulk file, can write to Number Management |
| A carrier to hand a message to | No network | Providers, DLR states, retry, failover, reason codes and cost are modelled end to end |
| A database | No back end | State is in memory and resets on reload |

**Closed in M20–M21**: authentication and sessions, Number Management / Logical Inventory integration, channel delivery, bulk update.
**Closed in M19**: developer portal, listing versioning, contract pricing, product comparison, WMS, hash-chained audit with SIEM export, dunning, per-persona forecasting.
**Closed in M12–M17**: inventory, audit log, partner branding, review submission, full ticketing with SLA, login ad banners.

---

## 11. Suggested next artifacts

Proposed and not yet commissioned:

1. **TMF Open API mapping** — bind each screen to TMF620 / 632 / 637 / 666 / 678. Turns the prototype into an integration brief.
2. **Competitive one-pager** — against Mirakl, AppDirect and the Salesforce/ServiceNow build-your-own route. That is the comparison that gets asked in the room.
3. **Click-through demo script** — mapping each screen to the marketplace category it evidences. `README.md` has the raw material.
4. **RFP compliance matrix** — the PRD sections map cleanly onto one.

---

### M34 — Warehouse configuration and shipment provenance

Warehouses became configurable rather than assumed: type, address, timezone, despatch cutoff, capacity, the countries and categories they serve, and the tax registration that makes an invoice valid from that site. Routing rules map inventory to a warehouse by category and destination. Every shipment now names the purchase order it fulfils, who despatched it and who receives it. A drop-ship site is declared as delegated rather than measured, because the stock is not ours. The returns hub gained a system link — returned stock that sits in no ledger is stock nobody can sell.

The Bill Formatter gained **Save as a template**, which lists the result alongside the built-ins and can assign it to an audience immediately, leaving the built-in it was derived from untouched.

### M35 — Channels as a managed master

`DUN_CHANNELS` was a hard-coded array of prose combinations (`'Email + SMS'`). It became `CHANNELS`: a managed master with a type, a transport, an enabled flag and a note, reconciled against the transport providers on the delivery screen. A dunning step now names channel **ids**, so switching a channel off removes it from every ladder at once.

Two failure modes are distinguished and both are named on screen. **Dark** — every channel on a step is off, so it runs and reaches nobody. **Degraded** — one of two is off, so it still sends and nothing looks broken, but it is no longer reaching people the way the policy was written. A test written to assert the first case found the second, which is the more common one.

Disabling a channel a ladder uses names the affected ladders before it proceeds, and does not rewrite them — what replaces a channel is a decision somebody has to make.

### M36 — Collections ownership, and category ladder profiles at onboarding

Three rules decide who paces a receivable, and the first that matches wins: money owed *to* the marketplace is the marketplace's to chase (a debtor does not set the terms of their own recovery); anything sold inside an operator-assembled bundle is the marketplace's (one merchant of record, one bill, therefore one suspension date); everything else the seller sold directly is theirs.

Sellers got a **Collections** screen that separates the cases they pace, the cases the marketplace paces on their behalf but they still fund, and what they themselves owe. Six **category ladder profiles** — retail subscriber, content subscriber, device instalment, IoT deployment, managed security, reseller downstream — are seeded at onboarding, idempotently, so a seller never starts with no collections policy and nothing overwrites what they have edited. The operator sees every seller ladder with **drift against the published default**: a seller who has doubled every interval is telling us their customers are not like the ones the default was written for.

A side effect worth noting: once sellers govern their own direct receivables, the marketplace consumer ladder legitimately runs almost nothing. A test that assumed otherwise failed, correctly.

### M37 — Credit and debit notes, and partner-approved refunds

Two instruments people confuse, kept apart. A **note** is marketplace-to-seller and corrects a settlement already struck; no customer, no card. A **refund** is customer-to-seller and returns money to the instrument that paid.

Notes carry configurable thresholds — auto-approval below a floor, a second approver above a ceiling, evidence above a middle band — and the second-approval threshold cannot be set below the auto-approval one. A debit note is the only adjustment that increases our own revenue, so it carries the heaviest justification. A disputed note does not settle while open.

Refunds mirror the collections rule deliberately: **one rule about who owns a commercial decision, applied consistently in both directions.** The seller decides on their own products; the marketplace decides on first-party, on bundles, on escalations, and on anything the seller leaves unanswered past the SLA — and still recovers it from the seller's settlement, so silence costs them the decision rather than the money. `AP-ADJ` (TMF666 / TMF678) exposes both, idempotent on the request id.

### M38 — Ladder scope, seller reviews, and artwork that is actually drawn

**Scope.** A ladder now declares what it applies to as well as who: product category, marketplace category, or customer type only. `LADDER_SCOPES` is ordered narrowest-first and that array *is* the precedence, so adding a scope means deciding where it sits. Two bugs surfaced while wiring it. The first: category ladders still required a segment match, so an enterprise IoT SIM case fell through to the generic enterprise ladder — fixed by letting a category ladder carry no customer type, which is what "a default for this category" means. The second, introduced by that fix: a seller's commission debt started picking up a product ladder, because `segment:null` matches everything. Commission is not a product, so category scopes are now excluded for marketplace debt.

**Reviews.** The seller's Reviews panel was a fixed distribution `[62,24,8,4,2]`, an invented quote and a button that raised a toast. It is now a screen reading real records, ordered so unanswered poor reviews come first, with a per-listing table showing where a reply is outstanding. Nimbus was given thirteen more reviews including four unanswered poor ones, because a review screen that only shows praise proves nothing.

**Artwork.** `.adart` printed `b.image` — a filename in a box, which reads as a broken asset. Eleven drawn vector motifs replace it, inheriting the banner accent, carrying the alt text on the SVG, and offered to the operator as a labelled picker rather than a path field. Filenames stay in the media manager, where a filename is the right thing to show.

### M39 — Persona scope: what a role administers versus what it merely holds

The consumer console had grown an administrator's screen. Rules, message templates, a channels-by-severity matrix and a "Send a test" button are things a marketplace operator or an org admin needs; a retail customer needs "stop texting me about offers" to be easy to find, and every one of those panels made it harder. Notifications and Messages we sent you merged into one page, because "what I want to be told" and "what you actually sent me" are one question asked in two directions.

The enterprise buyer kept its rules — an organisation genuinely administers alerting, and a rule addressed to a role follows people as roles change. It lost message-template authoring: two parties editing one document is how a customer ends up quoting wording nobody here recognises. It also lost Bill formatting, which is an issuer's control. That removal took the buyer's PO-number requirement with it, which a regression test caught; the setting already existed on the buyer's own AP panel, and the invoice preview now reads that rather than a second copy on the template.

The **carrier cost column** came off consumer, buyer and seller. It is what we pay Route Mobile per SMS — a marketplace operating cost, not a line anybody else is entitled to. The **DLR-state glossary** came off the consumer for the same reason: an operator reconciles against "submitted versus sent", a customer does not.

**Send a test** was a toast that claimed success. It now creates a real delivery against the real provider, so it lands in the log with a receipt state — and a channel with no true receipt reports as *sent*, not *delivered*, which is the thing worth discovering before you rely on it.

**Save for later** extends the existing `MY_SAVED` list rather than creating a second one, and lives inside the basket, because the moment somebody is deciding what to buy is when the thing they put aside last week matters. Saving explicitly does not hold a price or reserve stock, and an item that has since sold out or been delisted is marked rather than silently failing.

Merging a screen exposed a routing bug: `App.go` returned early for an id with no nav item, so an old link silently did nothing. Route aliases now keep a retired identifier working.

### M40 — Closing the four consistency gaps

A capability matrix built from the running files, not from reading nav definitions, found four asymmetries with real consequence. All four are now closed.

**Arrears.** The operator and seller both had Collections; the buyer and customer had nothing, despite eight consumer cases (three suspended) and a $14,520 buyer balance. The consumer's bills, home and subscriptions screens never mentioned a failed payment. Built as the debtor's view rather than a filtered collector's view: what is owed, why, what happens next *with a date*, and how to stop it — plus the whole ladder told forwards with their position marked, ask-for-time, and pay.

**Own reviews.** The moderation flow told a reviewer their review was rejected and that they may rewrite it. There was nowhere to be told and nothing to rewrite in. Now there is, with a challenge route to a different moderator.

**Buyer integration.** `AP-PTY` was audienced to enterprise buyers who had no integration screen. Three buyer APIs added, and the interesting constraint built rather than assumed: an API order obeys the buyer's own approval threshold, so the integration cannot be used to route around their finance function.

**Seller guidance.** Three screens shipped this session with a clock and money attached — refunds, notes, collections — and no knowledge-base article. Three added, stating the 48-hour clock, that silence costs the decision rather than the money, and the bundle override.

Two regressions surfaced and were fixed rather than suppressed: a test asserting all four personas hold a message-content panel (now asserts only the two that author wording under their own name), and removing Bill Formatting from the buyer taking their PO requirement with it.

### M41 — Moderation card and GL account creation

**Moderation card.** Three faults were stacking in the operator's review queue: the panel was `flush` (padding removed, right for a table and wrong for a stack of cards), `reviewCard` drew its own border inside it, and the Reject/Publish pair floated in the gap below with nothing tying them to a record. One bordered unit per review now — header, body, footer — with the flag tinting the whole card.

**GL accounts.** The chart of accounts was read-only. It is now extendable, with the three guards that matter: a code must sit in its type's range (every report groups on the leading digit), a duplicate is refused and names what holds it, and an account with no description is refused because one nobody can describe becomes a dumping ground. Removal only works while nothing points at the code.


### M45 — Multi-language rolled back

The five-language build was withdrawn at the client's request: the output was not good enough to show. Kiswahili, French, Spanish and Arabic dictionaries, the `T()` engine, the RTL stylesheet, the DOM pass, the language switch and the coverage panel were all removed, and every `T()` wrapper unwound so the source reads as it did before.

What is worth keeping from the attempt, if it is picked up again: the volume was measured before starting (775 labels, 449 banners, 5,594 prose strings over 60 characters), and the honest scope was chrome plus lead prose — roughly 1,290 phrases per language. That was reached. What was never reached was the long tail of sentences composed at runtime around a live count, and a build showing a real customer a screen that is 80 per cent translated reads worse than one that is plainly English. The lesson is that partial localisation is not a partial success; below some threshold it is a defect.

Two engineering notes worth not relearning. A naive regex is not a string-literal parser — one walked through an escaped apostrophe and corrupted four source files, recovered only because the built HTML inlines every source verbatim. And a test that calls `setLang()` is not a test of the language control: three real faults in the button shipped past a suite that passed every time.

### M46 — Order stages, rewards, refund SLA and a dark theme

**Order stages.** The fulfilment tracker drew five stages and said nothing about any of them; a person clicking one concluded the screen was broken. Each stage is now a control that opens what the stage means, who performs it, which system is the source of record, when it happened relative to placement, what evidence would prove it, and what comes next. A stage not yet reached says so and gives the typical duration while refusing to present it as a commitment. `STAGE_INFO` declares the semantics once and a test fails the build if any pipeline gains a stage with no record behind it. The same component draws onboarding gates and the listing wizard's preview, so the clickable styling is scoped to real buttons and a test asserts both directions — a control must open something, and something that opens nothing must not look like a control.

**Rewards.** Rewards was one number on the consumer dashboard. It is now a programme: conversion rate, tiers with rolling twelve-month qualifying spend, earn rules each naming a funder, a redemption catalogue where the rate differs because the funder differs, a per-member ledger, member accounts for consumers and organisations, and a liability with a stated breakage assumption. Four views for four questions — a customer's balance and history, a seller's bill, the operator's liability, and an enterprise buyer's question of who inside the organisation may spend it. The postings are real: marketplace-funded issuance expenses to 6020, seller-funded is held recoverable at 6030, both credit 2040, and expiry releases to breakage income at 4040 rather than being netted against the expense.

The rules that took the most thought: pausing a rule must never confiscate points already earned; a decline on a seller's proposal requires a reason because the seller has to be able to fix it; a hand adjustment has no approval step, which is exactly why the reason is mandatory; and a breakage assumption above 60% is refused, because that is not an assumption, it is a way of not carrying the liability.

Wiring it surfaced a latent defect worth recording. Four audit actions were writing to a category called `Configuration` that appears in no role's read scope — every one of those entries was invisible to everybody who could open the log. A category that no role can read is a hole, not a control.

**Refund escalation.** Escalation was a button the customer had to know to press. It is gone. A request unresolved 72 hours after it was raised escalates automatically, and so does a decline the seller cannot evidence. The customer is told what the clock is doing rather than handed a control, and every escalated record carries why the platform did it.

**Theme.** A dark theme on the three customer-side portals, pinned light on the operator console because a console with no switch must not silently follow the operating system. Not an inversion: surfaces lift from a near-black base so elevation still reads, the brightest ink stops short of white, and every semantic pair was re-picked against its own dark background. The regression suite computes real WCAG ratios from the shipped tokens rather than trusting the palette by eye, which caught two genuine defects — white on the primary fill is 2.86:1 in dark and 3.0:1 on a light chip, and the focus halo's inner ring was a hard-coded white that read as an outline on a dark screen. Both became tokens.

### M47 — Rewards configuration, and where a point may be spent

Two things were missing from the operator's rewards screen: the redemption catalogue and the tier ladder were both read-only tables. Both are now editable, and the editors carry the rules rather than the documentation.

**Redemption has to settle inside the marketplace.** This was the client's constraint and it turns out to be the right one for a reason worth writing down: a point is a liability against *this* platform. Discharging it against something a third party honours converts a liability created in points into cash owed to somebody who never joined the programme. So `settles` is a field on every fulfilment kind, not a comment — the editor refuses to publish an option that lands outside, and refuses to reinstate a retired one that does. Six live kinds cover wallet credit, invoice credit, checkout discount, in-marketplace seller voucher, trade-in top-up and delivery upgrade. The lounge pass and the donation ship retired with that recorded as the reason, because deleting them would lose the fact that they were once offered and why they stopped being.

**The redemption editor's guards** are the arithmetic ones plus one judgement: the preview compares the option's rate against plain wallet credit and says whether it is a premium or a discount, because an option worth less than the wallet is one a member reading carefully will never take.

**The tier ladder has to climb in both directions at once.** Thresholds and multipliers both rise, or a tier asks somebody to spend more for less. Two tiers cannot share a threshold, since placement would then depend on the order they happen to be listed in. The entry tier's qualifying spend is fixed at zero — every account has to land somewhere and a programme with no floor has members in no tier. A tier holding members is re-priced, not removed. And rung order is derived from the threshold rather than typed, so the ladder cannot be drawn in one sequence and evaluated in another.

### M48 — Onboarding capture, masking, and what each party may see

**Tasks belonged to nobody.** `ONB_TASKS` was one flat array, so opening a gate on a seller live since 2024 showed the in-flight applicant's open chasers. A task now belongs to a partner and to a gate, and its state is derived from that partner's progress rather than typed: cleared → done with who closed it and when; current → open with a due date; not reached → not started. Clearing a gate closes its tasks and opens the next gate's, and the operator's chase list filters to sellers with an application still running.

**Operator-led onboarding collected a free-text "Bank".** It is now five steps mirroring the gates, and the settlement step asks for what the person is actually holding — the clearing code and tax identifier are *named for the country* from `BANK_CODES`, the account number is typed twice, and each of the eight expected documents takes a real file whose name, type and size are kept. Attaching one closes the task that would have chased it and says which file did. None of it clears a gate.

**Masking.** `PARTNER_BANK` holds the number because the platform has to pay somebody; the screens hold `maskAcct()`. A BIC is deliberately not masked and the screen says why, because an inconsistency nobody explains reads as a bug. Revealing is finance-role only, needs a written reason, shows once, and writes a high-severity entry. The same shape covers the buyer's direct debit mandate.

**Each party can see what we hold.** The seller's own details page carries the settlement account, the tax position with the consequence stated, and every gate with its evidence. The buyer's carries a payment instruction and a credit position — deliberately not a copy of the seller screen, because they pay us rather than the other way round.

**A shared defect found on the way.** `confirmAction` called `closeModal()` before `onConfirm`, so any dialog validating inside its handler threw away everything the person typed and left them a toast on an empty screen. It now takes an optional `validate(vals)` that runs while the dialog is still open and renders the reason inside it. Four call sites moved onto it.

**Artwork.** Twenty-four drawn product illustrations replaced the category glyphs, chosen by category then by a keyword in the name — a mesh pack and a CPE both sit under "Routers", and a kit of twenty-five sensors is a kit. Colour is per-category with a deterministic per-product accent. They are illustrations rather than photographs on purpose: the build is offline and self-contained, and photography of devices the marketplace does not own is somebody else's copyright.

**`journeys_config.js` outgrew the 45-second cap** and was split into `journeys_config.js` (126) and `journeys_config2.js` (88). Nineteenth suite `journeys_onboard.js` added (134).

### M49 — Stored value, roles, routing, and the shape of a table

**Action columns.** A conditional primary action let the secondary slide down the column. The fix is a slot that is always drawn, holding a non-interactive marker when the action is gone. More useful than the fix: `layout.js` gained a detector that measures the last action in each row and fails the build if it moves — which found five instances beyond the one that was reported. A narrow cell opts out through a compact mode, because a fixed slot in a cramped column forces the pair apart until they stack.

**`confirmAction` ate people's input.** It called `closeModal()` before `onConfirm`, so any dialog validating inside its handler discarded everything typed and left a toast on an empty screen. It now takes `validate(vals)`, which runs while the dialog is open. Four call sites moved onto it immediately; more should.

**Wallets.** Stored value existed as one number on the consumer dashboard and nowhere else. It is now a liability with two pots — the holder's own money, and credit the platform issued — because refunding promotional credit as cash is the failure that distinction prevents. Dormancy is a state with a written-to date, and the ledger's breakage account is documented as only usable where a balance is legally forfeit. The consumer's balance and the operator's record derive from one set of records, so they cannot disagree.

**Roles.** Six operator roles covered a fraction of the console. Thirteen now, with a thirty-two row matrix covering stock, routing, tickets, arrears, certificates, the ledger, rewards and the API registry. The separations are in the grid rather than in prose. Thirteen columns is wider than a screen, so the matrix scrolls with the capability column pinned.

Adding people to fill those roles exposed two defects the smaller dataset had hidden: a newly invited user landed on page two of the directory and looked lost, and the role filter chip only offered the first four roles. Both were fixed — the first with a note naming the invitee that clears when the invitation is no longer outstanding.

**Routing.** Read-only became configuration, with the guard that matters — a returns centre is never an outbound destination — plus shadow detection before saving and a stated consequence before removal. Fixing the panel width found a `.replace('</div>', …)`, which hits the *first* closing tag: the warehouse panels had been rendering inside whichever container closed first.

**Tax display.** Two independent settings were drawn as two independent lines, so an inclusive price with the split on printed the same tax figure twice under different labels. They are one document now, and the switch that no longer means anything says so instead of sitting there looking operable.

### M50 — Onboarding pace, the seller's own record, and card rails

**Five working days, end to end.** The published SLA said twelve while the gate targets summed to sixteen and the seller's own history showed thirty-one days — three numbers that could not all be true. The ladder is now five: the gates that are a decision on evidence already supplied clear the same day, and only the ones needing somebody to do work carry a day of their own. `slaWords()` renders a zero-day target as *Same day*, because "0 working days" is not how a person says that. The historical timeline is one working week and the operator's median moved with it.

**The seller could not see which marketplaces they were in.** It was discoverable only from a dropdown in the new-listing wizard. The dashboard now names them in the subtitle and carries a strip showing approved, applying and not-applied, and the onboarding screen shows the marketplaces already held beside the application in flight — with the point that an addition reuses what was already cleared, which is why it takes days rather than weeks.

**Documents did nothing.** View, Renew and Upload all raised a toast. They now open a real record, download a real PDF, and take a real file that moves the document to *With the marketplace* — and refuse an upload with no file, or a certificate with no expiry date.

**Card rails.** The action-column defect one level up: a repeated row with a state pill and an action button, each sizing itself, gives every row a different right edge. `.taskrail` pins them, and `layout.js` gained a structural detector for the shape — verified against a synthetic DOM so it is not a check that can never fail.

### M51 — What the catalogue refuses to sell

**Three relationships, and they are not the same thing.** Twenty products carry rules: *requires* and *excludes* stop an order; *works with* is advice and is phrased so it can never be mistaken for a condition. Each carries the seller's reason, and the reason is what the buyer reads — a refusal that does not say what would fix it is a dead end dressed as an error, so a blocked add names the companion and offers **Add both**. Enforcement is at `addToCart`, which is the single door both buy sides go through; the enterprise portal differs only in reading `ENT_SUBS` rather than `MY_SUBS`.

**The rules found two defects on their first day, both in the tests rather than by eye.** Two exclusions were stated from one side only, which meant they bit or did not depending on which product the shopper picked first — bundles now declare `bundleOf` so the asymmetry reads as a decision instead of an omission. And the bundle builder let two tiers of one service be picked together, then the basket refused the second, so the bundle came out one item short of the quote it had just shown.

**A plan change is a switch, not a duplicate.** Enforcing "one Aventa plan per line" immediately broke a legitimate journey, and the break was the useful part. Both readings of the rule are correct depending on intent, so intent is declared rather than inferred: `addToCart(sku, qty, {replaces})` waives the exclusion against that one named product, records the waiver as a note, and the plan list, the confirmation and the basket line all state that the old plan closes when the new one activates. Declaring one replacement waives nothing else.

**The operator sees the rules.** A register under Catalogue, one row per relationship, split by whether it blocks an order or is advice only. Rules that stop revenue cannot live only in a data file.

### M52 — Out of stock stops being a dead end

**Two personas, two different dead ends, one cause.** The consumer tile drew *Notify me* and disabled it. The enterprise tile kept offering *Add to requisition* on a product that could not be supplied, because the catalogue passed its own buy action and `productCard` had no say. The detail drawer closed with a disabled *Out of stock* button that only repeated the badge.

**Notify me now creates a record.** It asks how — email or SMS, address shown — states the expected return date where inventory knows one while making clear the alert fires on arrival rather than on that date, and says an alert reserves neither stock nor a price. Audited both ways. Asking twice does not create two alerts, and a watched product shows an inert *You will be told* rather than an action already taken.

**A caller can choose its buy wording but not what happens when there is nothing to buy.** `addLabel` sets *Add* or *Add to requisition*; `productCard` decides the out-of-stock case from the record. Save for later composes the two actions rather than replacing them, so going out of stock does not cost the buyer the Remove button.

**One assertion had to be rewritten** because it encoded the defect as correct: it asserted a disabled control was present on an out-of-stock tile. It now asserts the opposite — the buy action is gone and what replaces it is live.

## 12. Working preferences observed in this engagement

For whoever or whatever continues this.

- **Telecom-first framing**, calibrated to a senior practitioner. Do not explain BSS basics.
- **Prose over bullet lists** in deliverables; quantified impact where it exists.
- **Every action must do something.** A toast standing in for a journey has been rejected repeatedly and is the single most common correction in this project's history.
- **Declare missing data.** *Not measured* rather than zero; *No comparable prior period* rather than a fabricated percentage. This has been reinforced by the design contract and by explicit correction.
- **Say why, not only what.** Interface copy explains the reasoning behind a constraint — why KYC cannot be waived, why rotation is not enforced, why a discount was capped.
- **Test what you claim.** Every capability asserted in a document has an automated check behind it. Where it does not, the document says so.
- Working folder is now `D:\Claude\Projects\B2B_Marketplace`. All outputs go here.

---

*© 6D Technologies | Confidential*


---

## 13. Design positions worth not undoing

Added 26 Jul 2026. Each of these was a deliberate choice and each has a failure mode behind it. A future model asked to "simplify" any of them should push back first.

| Position | Why it is there |
| The audit trail has no edit and no delete path, for anyone | A log that can be changed is not evidence |
| A role with no audit scope is **refused** the screen, not shown an empty one | An empty table implies nothing happened |
| Personal data in the audit log is **redacted, not hidden** | The reader should still know an event occurred |
| Your own actions are never redacted from you | You already know what you did |
| Pre-login banners may use only locale and device | Anything more identifies someone who has not identified themselves |
| Sellers cannot buy banner placement | Stated up front because it is the first question a seller asks |
| Availability is on hand less reserved, and the storefront reads it | Otherwise the storefront promises what the warehouse lacks |
| Adding to a basket is capped, not warned | A warning that can be ignored is an oversell |
| The SLA clock pauses while waiting on the requester | Otherwise the metric measures customer response time |
| Escalation is automatic and the requester is told | An escalation the customer does not know about only helps us |
| A resolution requires an explanation | A blank resolution teaches nobody anything |
| Reviews are moderated for content, not sentiment | Rejecting for negativity is recorded and is not permitted |
| A pending review does not move a rating | Otherwise moderation is pointless |
| Ratings blend historical and modelled reviews | So the headline never contradicts the list on screen |
| Seller branding stops at their console | A checkout that restyles per seller erodes marketplace trust |
| Contrast is checked and enforced, not advised | A palette below AA is unreadable for real people |
| Three partner dashboard cards cannot be hidden | Hiding an obligation does not remove it |
| Quota overage is billed, not throttled | Cutting a partner's order flow to enforce a commercial term causes an outage to solve a billing problem |
| A seller pays nothing for API access to its own data | Otherwise the platform taxes the sellers who cost it least to serve |
| Beta and preview APIs are labelled, not quietly published | An integration on an unstable contract is a deferred support cost |
| Every write endpoint documents idempotency | A retried order must not become two orders |
| A rollback creates a new version rather than deleting one | The record of what a buyer could have seen is what settles a pricing dispute |
| An unsigned contract price is recorded but never applied | Recording the negotiated number is useful; charging it is not |
| Comparison is capped at three | A table that needs sideways scrolling stops being a comparison |
| The comparison highlight states it is not a recommendation | It is arithmetic on one dimension; the dimension that matters is the buyer's to choose |
| The physical count wins over the ledger, via a movement record | A silent correction destroys the audit value of the ledger |
| Drop-ship stock is declared seller-reported, not measured | Reporting a number we cannot verify as if we could is the more expensive lie |
| The hash chain is for detection, not prevention | A permission only stops the people who respect permissions |
| Verification of the chain is itself audited | An integrity check nobody can see having run is not a control |
| Audit is streamed outside the system being audited | A trail held only in the audited system evidences intent, not events |
| Service is not interrupted until day 14 | Involuntary churn costs more than the receivable |
| A retry against an expired card never succeeds | The system says so and asks for a new instrument rather than burning the ladder |
| A promise to pay resumes the ladder where it stopped | Restarting rewards a broken promise with a fresh set of reminders |
| A dunning notice states what has and has not been interrupted | Otherwise it generates the support call it was meant to avoid |
| Every forecast prints its method and its measured backtest error | A forecast that will not say how wrong it was last quarter is a decoration |
| Each persona's forecast is built from that persona's own series | A seller's projection derived from marketplace GMV is a number about somebody else |
| The gate renders nothing behind it | Hiding a populated shell with CSS leaves every record in the page for anyone who opens the inspector |
| Lockout counts per account, not per address | Per-address counting protects an attacker with a botnet and punishes an office behind one IP |
| Enforced SSO means no password field for that domain | An enforced identity provider that still accepts a password enforces nothing |
| Failed sign-ins are logged as carefully as successful ones | A log of only what worked cannot show you an attack |
| SMS is offered but labelled the weakest factor | It is there for users who have nothing else, not because it is good |
| Ending a session is stated not to be a password change | If the password is what leaked, ending sessions fixes nothing |
| Sensitive actions ask again even when you are signed in | An unattended screen should not be able to approve a settlement run |
| ICCID, IMSI and MSISDN live in the BSS, not here | A second register of numbers guarantees two answers to the same question |
| Nothing in this prototype writes to Number Management | Where we disagree with the BSS, we are the ones who change |
| An eSIM assignment lands in `released` | Installed and enabled are the device's transitions to claim, not ours |
| A degraded upstream holds reservations rather than confirming them | A held reservation is honest; a confirmed one we cannot back is not |
| The SIM screen says it is a query result, not the inventory | Twelve thousand records in a browser would imply we hold them |
| Delivery states keep the transports' own names | Renaming them makes the log impossible to reconcile against a carrier's report |
| Push is declared as having no true receipt, and kept out of the average | Averaging a measured number with an unmeasurable one produces a number that means nothing |
| Hard rejections are never retried | Three attempts at an invalid number produce three charges and no message |
| Resending a hard rejection is allowed but warns and is audited at warn | Sometimes the operator knows something the code does not; the record should still show they overrode it |
| Bulk updates existing records; it never creates and never deletes | Creating a thousand records from a spreadsheet is a different, riskier operation |
| A bulk dry run is mandatory | You should not be able to commit a file whose effect you have not seen |
| A bad row is rejected on its own, but a file failing over 20% is refused | Three typos should not block four thousand good rows; a fifth of the file failing is the wrong file |
| Every single-record rule is enforced in bulk | Otherwise bulk becomes the documented way around the cost floor |
| You cannot change your own role or status in a bulk file | It is the one mistake nobody can undo for you |
| A bulk job is one audit entry, not one per row | A four-thousand-row import would otherwise bury every other event of that day |
| Nothing is preselected in a common update | A bulk action that starts with everything ticked is a bulk action waiting to go wrong |
| A retail account gets one narrow bulk set, and no bulk cancel | Auto-renew off is reversible; cancelling is not |
| A rule is retired, never deleted | Past review decisions cite it; a decision citing a rule nobody can look up cannot be audited |
| Retiring a rule is not an amnesty | Listings already rejected under it stay rejected |
| A new rule is created as a draft applying nowhere | Authoring and applying are separate decisions, and conflating them switches on checks nobody reviewed |
| An active rule applied to no category is flagged | It checks nothing while still looking like a control |
| Sanctions screening is locked at enforce everywhere | A screen that lets an operator switch it off implies they may |
| The rule editor states its reviewer cost before you save | Nine minutes across four hundred listings is a headcount decision, not a policy tweak |
| Paused listings count against the per-seller cap, withdrawn ones do not | A paused listing still occupies a slot; counting rejections would mean a seller could never recover |
| The listing cap is enforced, not merely recorded | A cap that is stored and never checked is worse than none — it reads as a control and behaves as a comment |
| Chart gutters are measured from the widest label, not hard-coded | A constant gutter drew "$302,577" at a negative x, outside the card |
| Charts are never stretched non-uniformly | preserveAspectRatio="none" distorts the glyphs as well as the geometry |
| No screen tells the viewer the build is provisional | It is shown to customers; language that undercuts it costs credibility the work has already earned |
| Disclaimers were reworded, not deleted | "Document contents are not shown here" is honest without confessing to being a mock-up |
| The rules are reachable from three places, not one | Buried at the bottom of a 470px inspector, they read as absent |
| A locked rule refuses on every path that can change it | A control enforced in one place and not the other is a habit, not a control |
| A walkthrough navigates the console instead of showing screenshots | An annotated screenshot goes stale the moment the screen changes |
| A walkthrough stop may open a drawer rather than name a view | The basket is a drawer; pretending it is a screen produces a dead reference |
| Closing a walkthrough leaves you where it left you | Snapping back to the start punishes the person for stopping to look |
| Articles are role-scoped for action but readable by everyone | Hiding an article teaches nobody; walking someone to a button they lack wastes their time |
| An unrated article shows no score rather than a default | A flattering default is worse than silence |
| "This did not help" opens a ticket carrying the article | The articles that fail are the ones worth finding, and an anonymous thumbs-down does not name one |
| Article-to-view bindings are validated in the suite | A help link to a screen that does not exist in that console is a dead end, not help |
| Downloads produce real files, never a toast | A button that yields nothing teaches the viewer that the buttons are decorative |
| Brand artwork is embedded in the PDF, never redrawn | A reconstructed mark breaches the brand contract and looks wrong at scale |
| PNG decoding happens at build time, not in the browser | The browser has no zlib; the alternative was a redrawn logo |
| A PDF is assembled as bytes, not as a string | Any text encoding corrupts an embedded image |
| An onboarding document downloads as a controlled copy with the content withheld | Reproducing personal data into a forwardable file ends the access log at the download |
| A zero credit is $0.00, not -$0.00 | Minus zero on a bill reads as a defect, because it is one |
| The reconciling core is frozen when data is added | GMV, category totals and statement net all tie to it |
| An audit entry is only seeded in a context that could produce it | A settlement approval in a consumer's log is wrong data, not thin data |
| Every audit category is readable by at least one role in that context | An entry nobody may ever read is a hole, not a control |
| The developer portal is access, not a product line | A seller reading its own orders is not a purchase; charging for it taxes the sellers who automate |
| No access tier carries a price field | Entitlements follow onboarding state and what a partner sells, and change when those change |
| Production access is earned by a completed sandbox order | The single requirement that removes most go-live failures |
| Rate limits shed and queue; they never cut a seller's order flow | Cutting it turns a capacity problem into a customer-facing failure |
| Required events are relative to how a seller fulfils | Marking a shipper as failing on subscription events would be noise, not a gap |
| An unhandled required event is counted, not discovered later | It is not queued and not retried; it simply does not arrive |
| Suspension of a callback stops the calling, not the selling | Taking a seller off sale for their outage punishes the buyer |
| The technical gate is verified, and has no override | A seller live on an unproved integration fails on day one, and the person who cleared it caused that |
| A plaintext endpoint is refused outright | Order payloads carry buyer data |
| The sandbox gate reads the latest run, not the best one | Otherwise a single lucky run buys a permanent pass |
| Operator-led onboarding skips the typing, never the verification | A second path that also skipped the checks would be a way round the controls |
| A desk-created application must record why the desk did it | It has to be explicable a year later |
| Making an event mandatory shows its blast radius before the save | It creates no work here; it puts sellers out of compliance instantly |
| A draft event creates no compliance gap | An event nobody can subscribe to cannot oblige anybody |
| A published event id is never editable | An endpoint subscribes to the string |
| Events are deprecated, never deleted, and stop being mandatory when they are | A subscription to an id nobody can look up cannot be diagnosed |
| A mandatory event with no fulfilment model is flagged as mandatory for nobody | Otherwise it reads as a control while obliging no one |
| An API must answer why it exists in one line | If it cannot, it probably should not be published |
| An API identifier is fixed once published | It appears in every base URL a consumer has hard-coded |
| A version with no changelog is refused | A version nobody can diff is not a version |
| A breaking change is a new major version, never an edit | The consumers on the current version did not agree to a correction landing underneath them |
| Deprecating a version requires a sunset date and names who is on it | A date nobody has been moved off is a date you will end up moving |
| An API with no subscribers is flagged | Either nobody needs it yet, or it was published without a partner asking |
| Four bill sections cannot be switched off | A document without both parties, tax and a reconciling summary is not a bill |
| A built-in template can be reconfigured but not deleted | An audience with no template has no bill |
| The template editor objects to specific combinations | A payment slip on a self-billing invoice is backwards; we pay the seller |
| Provider support details are on the bill | A bill is where people look when something is wrong with a bill |
| An advert never appears on a bill chasing money | Selling to somebody in arrears reads as tone-deaf, and on a final notice as predatory |
| Preview generates a real document, not a mock-up of one | A change to a template should be seen rather than imagined |
| Every persona gets the PDF and the CSV | Finance reconciles from the data and pays from the document |
| taxRate() returns a percentage, and every caller must divide | Treating it as a fraction rendered an 18% line as 1800% |
| A table cell is never a flex container | It leaves the table layout algorithm and the buttons drift onto neighbouring rows |
| Document formatting lives on the template, not beside it | Two screens holding half the answer each is how a numbering pattern and a title disagree |
| Which dunning ladder applies is resolved, not chosen | A collector picking the ladder is a collector setting the policy |
| A seller in arrears is never suspended | Taking their listings down strands a buyer mid-order; withhold settlement instead |
| A dunning ladder must state why it is paced that way | A policy that cannot explain itself gets overridden until it means nothing |
| A ladder change applies from a live case's next step | Nobody is jumped forward or suspended earlier than where they already are |
| Gross collected credits a liability, not revenue | Booking it to revenue overstates income by roughly the size of the marketplace |
| Tax collected is never revenue, and a refund is a contra | Netting either one hides the thing an auditor came to look at |
| A GL mapping cannot be saved without a stated reason | An undefended mapping does not survive an audit |
| Existing postings are never rewritten when a mapping changes | A ledger that restates itself is not a ledger |
| A period cannot close while debits and credits disagree | The trial balance is arithmetic, and it is the check that catches a broken mapping |
| A channel is what the customer experiences; a provider is what carries it | A carrier can be replaced without a single ladder or rule changing |
| A ladder step names channel ids, never a prose combination | Switching a channel off then removes it everywhere at once |
| A degraded step is named, not just a dark one | A step that still sends looks fine and is no longer doing what the policy said |
| Disabling a channel in use names the ladders it breaks, and does not rewrite them | What replaces a channel is a decision somebody has to make |
| A debtor never sets the terms of their own recovery | Money owed to the marketplace runs on the marketplace ladder |
| A bundle has one merchant of record, therefore one suspension date | Two ladders on one balance produce two dates and the customer believes the first |
| A seller paces what they sold directly | It is their revenue and their relationship |
| Every seller is seeded a ladder from their category at onboarding | Nobody should have to invent a collections policy on day one |
| Seeding is idempotent and never overwrites an edit | Re-running onboarding must not undo a seller's judgement |
| Seller drift against the default is shown to the operator | A seller who doubled every interval is telling us something |
| A seller can read the marketplace ladder that overrides theirs | The pacing that overrides yours is what you most need to predict |
| A note is marketplace-to-seller; a refund is customer-to-seller | A note never touches a card and a refund never changes a commission rate |
| A debit note carries the heaviest approval | It is the only adjustment that increases our own revenue |
| A disputed note does not settle while it is open | Otherwise it is deducted while the argument continues |
| A note posts to the ledger only once it has landed | A draft is a proposal, not a fact |
| The seller approves refunds on their own products | It is their revenue being handed back |
| Silence costs the seller the decision, not the money | Past the SLA we answer and still recover from their settlement |
| A decline requires a written reason | Without one it is escalated and decided by somebody with less information |
| Auto-approval states every reason that applied, not the first | "Below $25" and "duplicates are never a judgement call" are both true and both worth saying |
| Store credit is never offered in place of a refund owed | That converts a legal obligation into a marketing one |
| Every shipment names its PO, its sender and its recipient | The person chasing a shipment is rarely the person who booked it |
| A drop-ship site is declared delegated, not measured | Reporting a capacity for stock that is not ours would be inventing one |
| A ladder declares what it applies to, not only who | A $40 balance behaves differently for a games subscription and a cold store |
| The scope array is the precedence | Adding a scope means deciding where it sits, not leaving it to filter order |
| A category ladder names no customer type | "A default for this category" means all of them |
| A ladder that names a customer type wins at the same scope | Specific beats general, and that has to be an explicit sort key |
| Commission owed to the marketplace never uses a product ladder | The debt is not for a product; pacing it like one is a category error |
| The case inspector says which ladder applied and why | A collector who cannot see the reason starts overriding it |
| A scoped ladder cannot be saved without naming its category | A scope with no target silently matches nothing |
| A review screen that only shows praise proves nothing | The demo data carries unanswered poor reviews on purpose |
| A one-line reply to a review is refused | A brush-off reads worse than silence, and it is permanent |
| Banner artwork is drawn, never photographed | Stock needs a licence we lack and dates the moment a handset is refreshed |
| A filename in an artwork tile is a missing asset with a label on it | Worse than no artwork, because it looks like a bug |
| Filenames belong in the media manager and nowhere else | There, the filename is the thing the reader came to see |
| A capability belongs to the role that is accountable for it | A customer does not administer notification rules; an org admin does |
| What a message cost us is never shown outside the operator | It is our carrier rate, not a line the recipient is entitled to |
| An issuer formats the document; a recipient does not | Two parties restyling one legal record produces two versions of it |
| A recipient still controls how their AP needs it | The PO requirement is the buyer's; the layout is ours |
| A test that only says "sent" proves nothing | It must create a real delivery with a real receipt state |
| A channel with no receipt reports as sent, never delivered | Averaging a measured thing with an unmeasurable one means nothing |
| Saving an item is not a reservation, and the screen says so | A held price nobody agreed to is a complaint waiting to happen |
| A retired screen id keeps working as an alias | A silent no-op reads as a broken button |
| A debtor's view is not a collector's view with a filter | One wants a queue and a value; the other wants a date and a way out |
| The next collections step is stated with a date and a consequence | "You are at step 5" tells a customer nothing |
| The whole ladder is shown to the person on it | Hiding it makes a suspension feel arbitrary when it lands |
| A promise to pay resumes, it does not restart | Otherwise a repeat non-payer buys a fresh fortnight each time |
| The person who wrote a review can see it | Telling somebody their review was rejected requires somewhere to be told |
| A rejection challenge reaches a different moderator | Otherwise the appeal is to the person being appealed against |
| An API order obeys the buyer's own approval threshold | An integration that bypasses it routes around their finance function |
| Contract pricing is resolved per call, never cached across accounts | A shared cache shows one customer another's rate |
| API credentials belong to a named person | Whoever holds them can order as the company |
| A screen that holds a clock and money needs a written article | A seller guessing at a 48-hour rule is an escalation waiting to happen |
| A flush panel is for a full-bleed table, never a stack of cards | Without padding the content runs to the panel edge and reads as broken |
| A bordered card never nests inside another bordered card | A box inside a box looks like a rendering fault |
| An action button belongs inside the card it acts on | Floating below a gap, it is unclear which record it applies to |
| A GL code must sit in its type's range | Every report that groups by code range depends on it |
| An account with no description becomes a dumping ground | So the description is mandatory |
| Never parse source with a naive string regex | An escaped apostrophe desynchronises it and it corrupts silently |
| The built artefact is a backup when there is no VCS | It inlines every source file verbatim |
| Two failures of the same mechanical rewrite means stop | Write the placeholder API instead of patching 800 call sites |
| Partial localisation is a defect, not partial success | A screen 80% translated reads worse than one plainly in English |
| A naive regex is not a string-literal parser | It walks through an escaped apostrophe and corrupts silently |
| A test that calls the handler is not a test of the control | Three real faults shipped past a suite that always passed |
| A stage that opens nothing must not look like a control | The person clicks, nothing happens, and concludes the screen is broken |
| A typical duration is not a promised date | So the screen says which one it is |
| A point is a liability the moment it is issued | Not a cost when it is spent, or every period is flattered until somebody redeems |
| Breakage is booked to income visibly | Netting it against the expense hides the number that makes a programme look cheap |
| Breakage above 60% is refused | That is not an assumption, it is a way of not carrying the liability |
| Pausing an earn rule never takes back earned points | Issuance stops; balances do not move |
| An adjustment with no approval step must demand a reason | Otherwise it is indistinguishable from a mistake |
| A seller sees their own cost, never another seller's customer | The same boundary every other console screen keeps |
| Escalation is a clock, not a button | A customer who must know to ask has already been failed |
| An audit category no role can read is a hole | Four actions were logging into one for months |
| A dark theme is a re-picked palette, not an inversion | Pure black behind pure white is worse than the light theme all day |
| Contrast is computed from the shipped tokens in CI | Eyeballing a palette missed two real AA failures |
| Paper stays light in either theme | A document preview is meant to look like a document |
| A money field a person types into carries its unit | A bare 2000 is a different sum in every market this runs in |
| A point is discharged against something the platform controls | Otherwise a points liability becomes a cash debt to a third party |
| A retired option stays on the list | Redemptions against it still have to reconcile |
| A tier ladder climbs in both directions at once | A tier that costs more and gives less is one nobody believes |
| Two tiers may not share a threshold | Placement would depend on list order |
| Rung order is derived, never typed | Or the ladder is drawn one way and evaluated another |
| A tier with members on it is re-priced, not removed | The removal is free; the demotion is not |
| Capture is not verification | A recorded account is unverified until micro-deposits match |
| A tick is a claim, a file is evidence | The gate still has nothing to read otherwise |
| The record holds the number, the screen holds a mask | And the gap between them is audited |
| A BIC is not masked, and the screen says why | An unexplained inconsistency reads as a bug |
| Changing where money goes never takes effect on save | It is the change most worth attacking |
| A buyer is not a seller with the signs reversed | They pay us, so they hold a payment instruction |
| A task belongs to a partner | A live seller on a chase list teaches a desk to ignore its queue |
| Validate before closing the dialog | Closing first discards everything the person typed |
| Illustration is a decision, not a limitation | Offline build; photography of devices we do not own is not ours |
| The last channel cannot be removed while a subject is on | Agreeing to be told with nowhere to tell you is not a choice |
| A close tag inside a ternary is a bug waiting | An empty basket closed the drawer early and pushed content outside it |
| A wallet balance is never income | However long it sits there |
| Two pots, because they are legally different | Refunding promotional credit as cash is the failure |
| A dormant balance is returned, never absorbed | The breakage line is only for where it is legally forfeit |
| A role nobody holds is a role nobody maintains | So every role has people in it |
| Two people in the security role | One is a single point of failure on restoring access |
| Priority is derived from position, never typed | Or the table is drawn one way and evaluated another |
| An empty action slot lets the column wander | A filled one naming what happened is better than a gap |
| More data exposes defects a small dataset hides | Page two, and a filter chip that only listed four of thirteen |
| Three numbers that cannot all be true is a defect | Published SLA, gate targets and history have to agree |
| "0 working days" is not how a person says same-day | So the renderer says it properly |
| A seller has to see what their own account is approved for | Not learn it from a dropdown in a wizard |
| A button that only toasts is not a feature | View, Renew and Upload now change a record |
| Requires, excludes and works-with are three different things | Only two of them stop money, and the third must never look like it might |
| A refusal needs a remedy | Name the companion and offer to add both |
| Intent is declared, not inferred | "One plan per line" is right against a duplicate and wrong against a switch |
| A rule enforced at the basket but not at the picker | Produces a bundle one item short of its own quote |
| A disabled button naming what the user wants | Is worse than no button — either it acts or it is not that control |
| "We will let you know" must say how | The channel and the address live on the record |
| A test can encode a defect as correct | When behaviour is fixed, check whether an assertion was defending the bug |
