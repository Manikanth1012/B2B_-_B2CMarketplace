# UI revamp — backlog

Work agreed but not yet scheduled into a spec. Each item becomes its own
brainstorm → spec → plan → build cycle when it is picked up.

## Revamp specs

| # | Spec | Status |
|---|---|---|
| 1 | Foundation + public homepage | Done — merged 2026-11-04 (`5489bb2`) |
| 2 | Commerce — retail and enterprise storefronts, product listing and detail, cart, checkout, header search | Done — merged 2026-11-04 (`f5ee450`) |
| 3 + 4 | Workspace consoles — one pass over the shared console components (`operator/shared.tsx`, used by ~80 operator, partner and enterprise screens) and the three sidebars, then the operator's bento KPI dashboard, grouped navigation and Business Accounts screen. Merged from the original specs 3 and 4 at the user's choice (2026-11-04) | Built on branch `ui-revamp-consoles`; merge pending |
| 5 | Validation sweep across all experiences | To do |

## New enterprise features (deferred from spec 2 — 2026-11-04)

The revamp brief asks for these on the enterprise storefront. None exist in
the app today, and each needs database tables with RLS, an operator-side
screen to answer it, and notifications — so they are features, not a
restyle, and get their own spec after the revamp.

- [ ] **Request a quote** — buyer asks for pricing on a listing or a basket; operator/seller responds.
- [ ] **Request a demo** — buyer books a demo of a product or service.
- [ ] **Contact Sales** — a tracked enquiry rather than a mailto link.
- [ ] **Enterprise enquiry tracking** — the buyer's list of quotes, demos and enquiries with status.
- [ ] **Configurable product bundles** — buyer assembles a bundle with options and gets one price.

## Carried over from spec 1 reviews (non-blocking)

- [ ] Product detail fulfilment icon and remaining decorative glyphs in the light teal (`ProductDetail.tsx:29`) — move to `--brand-accent-dark`.
- [ ] Extend the contrast guard to colours passed through variables and props (`accentColor`, `catColors`), and to white glyphs on accent fills.
- [ ] Stale `rgba(0,166,166,…)` tints of the old teal (Checkout, LoginScreen, OperatorShell, OperatorRoles, Hero).
- [ ] One Escape closes both the mobile menu and the Discover panel; close the inner layer first.
- [ ] `BentoCard` heading level prop — hero side cards render `h3` before any `h2`.
- [ ] Remove the now-unused `Carousel.tsx` and `lib/carousel.ts`.
- [ ] Forced-colours fallback for the gradient headline text.
- [ ] `.ui-link` touch target size against WCAG 2.5.8 (24px).

## Carried over from spec 2 reviews (non-blocking)

- [ ] Consumer category tiles no longer show operator blurbs (`CategoryTile` has no description slot).
- [ ] `loadPriceBook`/`loadCopyBook` swallow errors, so a failed price-book read shows the "nothing priced for your market" message — fix in `src/lib/moneyRepo.ts`.
- [ ] The requisition drawer has no focus trap.
- [ ] The enterprise Marketplace filter hardcodes iot/security/device while the tiles come from data.
- [ ] The product page "Notify me when available" line is inert.
- [ ] Cart stepper buttons are below the 44px touch target.

## Carried over from the consoles spec (non-blocking)

- [ ] Operator nav: clicking the forced-open active group's header does nothing visible.
- [ ] Operator nav: `aria-controls` points at an unmounted panel.
- [ ] Quick actions leaves half a row empty when there are no alerts.
- [ ] Accounts tests lack no-steps and due-today boundary cases.
- [ ] The Waiting chip ignores search.
- [ ] Listing modal heading styles are inconsistent.
- [ ] Stat and section cards have no border on white surfaces.
- [ ] Table row hover overrides an inline row highlight.
- [ ] Disabled danger and success buttons look like disabled primary.
- [ ] PartnerDashboard "Settlement Due" colour is decorative.

## Data to check (not code)

- [ ] Beacon IoT Care (SKU-7011) has no INR price — confirm that is intended (seller not approved in India).
- [ ] 14 integration tests fail against the shared live database (contract renewals, credit, settlement, subscription dates) — the seed data has drifted since it was written.
