# UI revamp — backlog

Work agreed but not yet scheduled into a spec. Each item becomes its own
brainstorm → spec → plan → build cycle when it is picked up.

## Revamp specs

| # | Spec | Status |
|---|---|---|
| 1 | Foundation + public homepage | Done — merged 2026-11-04 (`5489bb2`) |
| 2 | Commerce — retail and enterprise storefronts, product listing and detail, cart, checkout, header search | Done — merged 2026-11-04 (`f5ee450`) |
| 3 + 4 | Workspace consoles — one pass over the shared console components (`operator/shared.tsx`, used by ~80 operator, partner and enterprise screens) and the three sidebars, then the operator's bento KPI dashboard, grouped navigation and Business Accounts screen. Merged from the original specs 3 and 4 at the user's choice (2026-11-04) | Done — merged 2026-11-04 (`49f40da`) |
| 5 | Account screens (Orders, Subscriptions, Rewards, My account) on a shared account layer and `Dialog`, the carried-over review items, and a validation sweep of every experience at 1280 / 1024 / 390 — spec `2026-11-04-ui-revamp-account-validation-design.md` | Done — merged 2026-11-05 (`b1becf9`) |

Every item carried over from the spec 1, spec 2 and consoles reviews was
closed by spec 5, except the two noted below.

## New enterprise features (deferred from spec 2 — 2026-11-04)

Done — merged 2026-11-05 (`8fd5759`): quote, demo, Contact Sales and enquiry tracking are spec 6
(`2026-11-05-enterprise-enquiries-design.md`), migration applied 2026-11-05.
Done — merged 2026-11-11 (`5a13e47`): buyer-built bundles are spec 7
(`2026-11-05-buyer-built-bundles-design.md`), migration applied 2026-11-11.
Today's bundles are fixed and composed by the operator (Catalogue Review →
Compose a bundle); spec 7 is the buyer-built kind.

The revamp brief asks for these on the enterprise storefront. None exist in
the app today, and each needs database tables with RLS, an operator-side
screen to answer it, and notifications — so they are features, not a
restyle, and get their own spec after the revamp.

- [x] **Request a quote** — buyer asks for pricing on a listing or a basket; operator/seller responds.
- [x] **Request a demo** — buyer books a demo of a product or service.
- [x] **Contact Sales** — a tracked enquiry rather than a mailto link.
- [x] **Enterprise enquiry tracking** — the buyer's list of quotes, demos and enquiries with status.
- [x] **Configurable product bundles** — buyer assembles a bundle with options and gets one price.

## Spec 8 — polish (2026-11-11/12)

Done — merged to main (`35d477a`, `78023e0`, `bea3f7a`, `86cbc33`): all 13 items below. The database check
(migration `20261111300000`) was applied 2026-11-12; its integration test passes.
Plan: `docs/superpowers/plans/2026-11-11-polish.md`.

## Spec 9 — account price books and guided buying (2026-11-12)

Done — merged to main (`a229421`), migration `20261112100000` applied 2026-11-12; its 11 integration tests pass and
the screens were checked in the browser (SmartBuild's seeded price on the book, the shelf and the desk). Spec `docs/superpowers/specs/2026-11-12-account-price-books-design.md`,
plan `docs/superpowers/plans/2026-11-12-account-price-books.md`. Never re-run `20261111300000` now: it would put back the
published-price-only check. Reverses CR-008 ("negotiated pricing not operated here" → "sold here") — confirmed by the user 2026-11-12, on the condition (enforced by the database) that an account price is never below the seller's floor.
Deferred minors: extra reads in the enterprise Price book reload; preference errors shown at the top;
Approvals' off-book marker follows the account's current rule. (Fixed in spec 10: the drawer re-checks prices on
Raise; Approvals and the note lift have tests.)

## Still open after spec 5 (small, non-blocking)

All closed by spec 8.

Found by the spec 5 reviews and sweep, judged not worth holding the merge.

- [x] **Component tests need a DOM.** Vitest runs in Node, so `Dialog`, `useFocusTrap`, `AccountTabs` and the price Retry state are covered by pure-function tests plus the browser sweep only. Adding `jsdom` (a dev dependency) would let them be tested directly.
- [x] My account form labels (`Field` in `AccountView.tsx`) are not tied to their inputs with `htmlFor`/`id` (pre-existing).
- [x] The public product window does not pass `onNotifyMe`, so its "Notify me when available" line stays plain text there (it opens `NotifyMeModal` on the signed-in product page).
- [x] Public `CategorySection` tiles have no description line (consumer tiles do).
- [x] Rewards figures lost their icons: `KpiCard` has no icon slot.
- [x] Order lines show a generic package tile: order items carry no image.
- [x] Rewards progress bar: its cyan end is 1.9:1 against the track (the text label carries the meaning, so not an AA failure).
- [x] Business Accounts: the Waiting chip counts 0 while a search is typed (applications have no searchable text).
- [x] `AccountTabs` sets no `aria-orientation` (the list is vertical only by CSS; arrow keys work both ways).
- [x] `Dialog` does not stop Escape propagating, so another document-level Escape listener open beneath a dialog (account menu, cart drawer) would also close — no such stacking exists today.
- [x] Contrast guard blind spots: a `catColors = {…}` assignment form and template strings inside style objects; the browser scanner skips `color()`/`oklch()` values.
- [x] Requisition lines take `unit_price` from the client; the database does not re-check it against the price book (spec 6 checks quoted lines only). Fixed by migration `20261111300000`, then account prices by spec 9.
- [x] Build warns that the main chunk is over 500 kB (pre-existing): split by persona with dynamic `import()`.

## Changes to be aware of (deliberate, from spec 5)

- `statusTone` now colours console and account pills that were grey: e.g. tickets `new` amber and `closed` green, settlement `paid` green, users `invited` amber, subscriptions `paused` amber and `cancelled` red, bills `open` blue, refunds `approved` green. Refund and ticket `escalated` stay amber, ticket `resolved` is blue ("waiting on you"), a refunded order stays amber.
- `--text-tertiary` is now `#556479` and rating stars use `--star` `#8F5A06` (both for contrast on tinted rows).
- The public header's nav collapses into the menu below 1024px (was 900px).
- A signed-in shopper is pinned to their home market (the picker ignores a switch), so a basket is never carried across markets; only signed-out visitors switch market.

## Candidate features from competitive research (2026-11-05)

From `docs/superpowers/research/2026-11-05-competitive-features.md` (web research with
sources; "lacks" judged from the README and backlog — confirm against the code before
scoping). Nothing here is scheduled; the user chooses. S < 1 week, M 1–3 weeks, L a month+.

Recommended first:
- [x] **Account price books and guided buying** (M) — spec 9, done 2026-11-12 — standing negotiated prices per account, preferred sellers, off-contract flags; builds on spec 6 quotes; closes the unchecked requisition `unit_price` gap.
- [ ] **Reorder lists + buyer spend analytics** (S–M) — repeat purchases and spend by category/cost centre/seller vs budget; also fixes the basket not surviving a reload.
- [ ] **Net terms and credit line at checkout** (M) — expose the existing credit & collections limits as a payment option with an invoice due date.
- [ ] **Punch-out (cXML) + invoice-to-PO matching** (L) — reach large accounts from Coupa/Ariba/SAP; behind a flag, one reference system first.
- [ ] **Self-serve eSIM activation + number-port tracking** (M) — QR/reissue on the existing eSIM pipeline; port requests with a spec-6-style status timeline.

Also worth considering:
- [ ] Business-unit hierarchy with inherited roles and per-unit approval rules (M)
- [ ] Device financing / instalment plans with credit check (L)
- [ ] Trade-in with instant valuation, credit at checkout (M)
- [ ] IoT self-serve console: activate/suspend SIMs, usage (L)
- [ ] Usage-based and tiered billing for subscriptions (L)
- [ ] RFQ broadcast: one need, several sellers bid (M)
- [ ] Escrow-style order protection (M)
- [ ] Automated KYB and sanctions screening in onboarding (M, needs a vendor)
- [ ] Fraud and risk scoring on orders and accounts (M)
- [ ] TM Forum standard APIs (TMF620 catalogue, TMF648 quote, TMF650 partnership) (M)
- [ ] Channel / reseller sales with reseller commissions (L)
- [ ] Buyer-facing AI shopping assistant (M–L)
- [ ] Procurement AI: renewal alerts, spend classification (S–M)
- [ ] Delivery scheduling and consolidation (S)

## Spec 10 — loose ends (2026-11-12)

Done — merged to main (`7de0841`), migration `20261112200000` applied 2026-11-12; its 7 integration tests and the 32
enquiries tests pass. Plan `docs/superpowers/plans/2026-11-12-loose-ends.md`. Calendar invites (.ics) for demos and
quotes; quote expiry judged on the database's (UTC) day; a seller proposes its price on its lines of a desk quote
(private from the buyer); the requisition drawer re-checks prices on Raise; Approvals tests; 44px dialog Close.
Still open: real email needs a provider. Not taken up on 2026-11-13: choosing one (Resend, SendGrid, Postmark, SES…)
means an account, a sending domain and keys, which are the user's decision; the in-app notifications and the
.ics downloads carry everything until then. Follow-up migration `20261112300000` (applied 2026-11-12):
a seller no longer reads the desk's quoted price on its lines of a desk quote (it reads them only through
`my_desk_quote_lines`).

## Spec 11 — loose ends II (2026-11-13)

Done — branch `loose-ends-ii`, migrations `20261113100000` and `20261113200000` applied by the user 2026-11-13;
`bundleWhole` (5) and `baskets` (7) integration tests pass. Spec `docs/superpowers/specs/2026-11-13-loose-ends-ii-design.md`.
Scheduled jobs screen; the requisition basket kept in the database; flag and cap when stock goes; operator Baskets
screen with reminders; a bundle bought whole; bundle renewals; eight nightly jobs.
Still open (worked on 2026-11-13 on branch `loose-ends-iii`; migration `20261113300000` written, not yet applied):
- [ ] `nightly.integration.test.ts` expects eight jobs, so it passes only after the first night with both migrations (00:30 UTC on 14 Nov).
- [x] **Fixed in `20261113300000`** (answers `changed: false` with a note; `true` when it cleared a flag): `accept_basket_flag` on a line with no flag answers `accepted: true` and changes nothing.
- [x] **Fixed:** saved at once when the page is hidden, and sent as a `keepalive` request when it is closed. Up to ~400 ms of basket edits can be lost if the tab closes right after a change.
- [x] **Fixed:** a bundle part is priced at its selection's bundle price (`cartUnitPrice`). The operator's cart value is approximate (today's list price, not what checkout would charge).
- [x] **Fixed:** "Billed monthly; renews under your account’s agreement" in the configurator and the requisition drawer. A business monthly bundle shows no renewal note (its renewal follows the agreement).
- [x] **Fixed in `20261113300000`** (`report_renewal` charges `subscription_renewal_price` unless the seller names an amount; `vendor_renewal_book` shows that price): A bundle part renewed by its seller (not the marketplace) is not switched to list price after 12 months.
- [ ] Refund grouping needs `requisition_id` on the invoice line; lines without it are listed ungrouped. Checked 2026-11-13: no code writes enterprise invoice lines today (every invoice is seed data), so there is nothing to fix until a billing run for approved requisitions exists — that run is a feature, and it must set `requisition_id`.

## Still open after spec 7 (small, non-blocking)

- [x] **Fixed — migration `20261111200000` applied 2026-11-12, integration test passes — existing bug:** an ordinary (non-bundle) business requisition raised from the basket fails at approval: `raiseRequisition` never sets the requisition's `product_id` and `place_requisition_order` orders from that single header product, ignoring the lines. Spec 7 orders bundle requisitions line by line; ordinary multi-line requisitions still fail. Fixing it changes a live flow.
- [x] **Fixed in spec 11 (settle refuses a part-bought bundle):** Accepted risk: a shopper who removes the rest of a bundle mid-checkout buys one part at its bundle price. No seller goes below its floor; only the marketplace's discount is exposed. Each part can be ordered only once.
- [x] **Fixed in spec 11:** A requisition raised in a secondary currency cannot hold a bundle (bundles are priced in the account's currency).
- [x] **Fixed in spec 11:** Refund picker and operator order views do not group bundle lines yet (refunds work per part at its price).
- [x] **Covered in spec 11** (a template offering a paused part cannot go on sale; live test with SKU-5004, nothing paused): "A paused part blocks the bundle" is enforced by the database but not covered by a live test (it would pause a real product).
- [x] **Fixed in spec 10 (44×44):** The shared dialog's Close button is 36px tall (24px AA minimum met; 44px target not).
- [ ] Business templates are billed one way (all one-off or all monthly; migration `20261111100000`, 2026-11-11). A monthly business kit (SIMs, managed firewall) could be a second template.
- [x] **Fixed in spec 11 (keyed per user):** The bundle shelf cache is keyed by currency only, so after switching accounts it can be stale for up to 60 s.
- [x] **Decided in spec 11 (bundle price for 12 months, then published, floored):** Monthly parts of a bundle renew at the bundle price indefinitely; decide whether renewals revert to list price.
- [x] **Fixed in spec 11 (nightly `bundle selections` job):** Unused selections (configured, never added) are never cleaned up; only the operator can delete them.
- [x] **Fixed in spec 11 (nightly `payments` job; unpaid orders of another payment no longer count):** An abandoned checkout can leave a bundle half-ordered (parts already ordered can't be ordered again); re-configure to buy it.
- [x] **Fixed in spec 11:** The same selection can go on two requisitions; the second approval then cannot be ordered.
- [ ] Seller-authored templates and a free-form build-your-own are out of scope.

## Still open after spec 6 (small, non-blocking)

- [x] **Calendar invites done in spec 10** (.ics download); email still needs a provider. No calendar invites or email for demos and quotes — in-app notifications only (no gateway).
- [x] **Fixed in spec 10 (seller proposes; desk can use it):** The seller of a multi-seller desk quote can read its own lines but has no screen to tell the desk its price, and cannot read a desk-routed conversation; the desk has to reach the seller outside the enquiry, or reassign it to them.
- [x] **Fixed in spec 11 (kept in the database, watched by the operator, flagged when stock goes):** The requisition basket is not saved across a reload; an accepted quote offers "Add to requisition" again until it is on a live requisition.
- [x] **Fixed in spec 10 (UTC day everywhere):** Expiry is checked against the browser's date on screen and the database's date on accept; around midnight they can differ by a day.
- [ ] Seed enquiries name SKU-5004, which is paused on the live shelf. An accepted quote on it still reaches the requisition (its product facts are read by id, whatever the status); only raising a new enquiry from the shelf needs a live listing.

## Data to check (not code)

- [ ] Every seed agreement has fixed dates and ends during 2027 (SmartBuild CTR-2007-01 on 31 Mar 2027, CTR-2014-01 31 Jan 2027, CTR-2013-01 31 May 2027, CTR-2011-01 30 Jun 2027, CTR-2015-01 19 Jul 2027, Meridian CTR-2012-02 11 Nov 2027). A lapse stops that account buying on account and fails its integration tests. The two with auto-renew (CTR-2014-01, CTR-2011-01) now renew themselves each night once their notice deadline passes; the others need renewing in the operator console, then `scripts/make-agreement-copy.ts` (CONTRACT=<new id>) files the signed copy.

- [x] **A nightly schedule, 2026-11-12** (migrations `20261112600000`, `20261112700000`, applied). pg_cron runs `run_nightly()` at 00:30 UTC: agreements with auto-renew, enterprise subscriptions (renew a year, or end), the marketplace's own subscriptions, expired seller documents, and settlement (closes statements left open past their period, settles every missed month, then today). Each job is logged in `scheduled_job_log`. Run it by hand in the SQL editor with `select public.run_nightly();`; the app cannot call it.
- [x] **Demo data brought to 12 Nov 2026** (`20261112700000`): open refunds, disputes, listing queries and inbound stock moved forward 97 days (as old today as on 7 Aug); expired banners extended or ended; Beacon's treaty certificate renewed; 4 overdue credit reviews recorded; seller-reported renewals filed; FX for Sep–Nov. August settled.
- [ ] **Not refreshed (needs a trade backfill if wanted):** no orders, sales, shopper bills, enterprise invoices or ledger postings after 7 Aug. Four shopper bills and four enterprise invoices are still open from August; the ledger's last period is July (open); promotions and earn rules past their end dates still read active (they have no ended state).
- [ ] Beacon (PTR-1009) shows "7.5% reserve, nothing retained" until Q4 closes on 31 Dec: its Q3 payout was entirely taken by wholesale charge recovery, so there was nothing to retain. This makes `credit.integration` "does not disagree with itself" fail until then. The check could look at whether the closed statement had anything payable.
- [x] **Fixed in spec 11 (Scheduled jobs screen):** No operator screen shows `scheduled_job_log` yet; failures are only visible in the table.

- [x] Nimbus Sensors' (PTR-1004) AE market grant was left `suspended` by an interrupted pricing test (2026-11-05); set it back to approved.
- [ ] ~30 `notification_log` rows `NL-ENQ-*` point at deleted test enquiries (`ENQ-10xx`); only the service role can remove them.

- [ ] Beacon IoT Care (SKU-7011) has no INR price — confirm that is intended (seller not approved in India).
- [x] **Contracts and requisitionScope fixed 2026-11-12** (migration `20261112400000`: Meridian Foods renewed as CTR-2012-02 to 2027-11-11, test debris CTR-2012-03 removed; the contracts tests no longer depend on today's date; all 44 pass). - [x] **The other drifted live tests, re-checked 2026-11-12.** Most failures were Supabase sign-in throttling on a full run (run files with pauses). Real faults fixed: the settlement run could not write a statement (`note` column, then two ambiguous names), a won dispute could not void its note after 30 days (`20261112500000`, `20261112600000`); test leftovers cleaned (a dunning ladder, SmartBuild's 20,000 points); help coverage (CRLF), credit and withholding tests no longer depend on the date. All pass except the Beacon reserve item above.
