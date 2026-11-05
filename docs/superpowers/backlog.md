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

Done: quote, demo, Contact Sales and enquiry tracking are spec 6
(`2026-11-05-enterprise-enquiries-design.md`), migration applied 2026-11-05.
Bundles follow as spec 7.
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
- [ ] **Configurable product bundles** — buyer assembles a bundle with options and gets one price.

## Still open after spec 5 (small, non-blocking)

Found by the spec 5 reviews and sweep, judged not worth holding the merge.

- [ ] **Component tests need a DOM.** Vitest runs in Node, so `Dialog`, `useFocusTrap`, `AccountTabs` and the price Retry state are covered by pure-function tests plus the browser sweep only. Adding `jsdom` (a dev dependency) would let them be tested directly.
- [ ] My account form labels (`Field` in `AccountView.tsx`) are not tied to their inputs with `htmlFor`/`id` (pre-existing).
- [ ] The public product window does not pass `onNotifyMe`, so its "Notify me when available" line stays plain text there (it opens `NotifyMeModal` on the signed-in product page).
- [ ] Public `CategorySection` tiles have no description line (consumer tiles do).
- [ ] Rewards figures lost their icons: `KpiCard` has no icon slot.
- [ ] Order lines show a generic package tile: order items carry no image.
- [ ] Rewards progress bar: its cyan end is 1.9:1 against the track (the text label carries the meaning, so not an AA failure).
- [ ] Business Accounts: the Waiting chip counts 0 while a search is typed (applications have no searchable text).
- [ ] `AccountTabs` sets no `aria-orientation` (the list is vertical only by CSS; arrow keys work both ways).
- [ ] `Dialog` does not stop Escape propagating, so another document-level Escape listener open beneath a dialog (account menu, cart drawer) would also close — no such stacking exists today.
- [ ] Contrast guard blind spots: a `catColors = {…}` assignment form and template strings inside style objects; the browser scanner skips `color()`/`oklch()` values.
- [ ] Requisition lines take `unit_price` from the client; the database does not re-check it against the price book (spec 6 checks quoted lines only).
- [ ] Build warns that the main chunk is over 500 kB (pre-existing): split by persona with dynamic `import()`.

## Changes to be aware of (deliberate, from spec 5)

- `statusTone` now colours console and account pills that were grey: e.g. tickets `new` amber and `closed` green, settlement `paid` green, users `invited` amber, subscriptions `paused` amber and `cancelled` red, bills `open` blue, refunds `approved` green. Refund and ticket `escalated` stay amber, ticket `resolved` is blue ("waiting on you"), a refunded order stays amber.
- `--text-tertiary` is now `#556479` and rating stars use `--star` `#8F5A06` (both for contrast on tinted rows).
- The public header's nav collapses into the menu below 1024px (was 900px).
- A signed-in shopper is pinned to their home market (the picker ignores a switch), so a basket is never carried across markets; only signed-out visitors switch market.

## Still open after spec 6 (small, non-blocking)

- [ ] No calendar invites or email for demos and quotes — in-app notifications only (no gateway).
- [ ] The seller of a multi-seller desk quote can read its own lines but has no screen to tell the desk its price; the desk asks in the conversation.
- [ ] The requisition basket is not saved across a reload; an accepted quote offers "Add to requisition" again until it is on a live requisition.
- [ ] Expiry is checked against the browser's date on screen and the database's date on accept; around midnight they can differ by a day.
- [ ] Seed enquiries name SKU-5004, which is paused on the live shelf; new enquiries need a live listing.

## Data to check (not code)

- [ ] Nimbus Sensors' (PTR-1004) AE market grant was left `suspended` by an interrupted pricing test (2026-11-05); set it back to approved.
- [ ] ~30 `notification_log` rows `NL-ENQ-*` point at deleted test enquiries (`ENQ-10xx`); only the service role can remove them.

- [ ] Beacon IoT Care (SKU-7011) has no INR price — confirm that is intended (seller not approved in India).
- [ ] 13 integration tests fail against the shared live database (contract renewals, credit, disputes, help coverage, partner certificates, settlement idempotency, withholding) — the seed data has drifted since it was written. Unchanged by the revamp.
