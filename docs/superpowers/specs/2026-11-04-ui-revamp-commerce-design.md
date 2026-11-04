# UI revamp, spec 2 of 5 — commerce experiences

Date: 2026-11-04 · Status: awaiting review
Builds on spec 1 (`2026-11-04-ui-revamp-foundation-homepage-design.md`, merged).

## Why

The shopping screens still carry the old layout: full-bleed navy bands,
three different product-card designs, filters inline above a grid, a product
page in one column. The revamp brief (sections 5–7) asks for a light, premium
commerce experience on the retail side and a denser, structured one on the
enterprise side, sharing one product vocabulary.

## Decisions taken in brainstorming

| Question | Decision |
|---|---|
| Brief's new B2B features (quote, demo, contact sales, enquiry tracking, configurable bundles) | Not in spec 2 — restyle what exists. Kept on `docs/superpowers/backlog.md` as their own later spec |
| Products with no price in the visitor's market (e.g. SKU-7011 has no INR row) | Hidden from that market's shop pages, the rule spec 1's Featured band already applies |
| Approach | Extend spec 1's `ui/` layer and restyle screen by screen |

## Constraints

Spec 1's constraints carry over unchanged: no functional change (routes,
`App.tsx` surface/view state, repos, RLS, pricing, basket, requisition and
approval flows, market switching); no invented data or capabilities; no new
dependencies; WCAG 2.2 AA on every text/surface pair, held by
`src/lib/contrast.test.ts`; animation off under `prefers-reduced-motion`.

Shopping and checkout screens are **light and plain** — no navy gradients,
globe or glow inside them. Identity comes from accents: navy ink, cyan primary
buttons, blue links, teal for offers.

## 1. Shared rules

### 1.1 One product card

`src/components/ui/ProductCard.tsx` (spec 1) becomes the card for every shop
surface. New optional props, all off by default so the homepage is unchanged:

| Prop | Shows |
|---|---|
| `action?: { label: string; icon?: LucideIcon; onClick(p): void; disabled?: boolean }` | The context's primary action button (consumer "Add to basket", enterprise "Add to requisition") |
| `compare?: { checked: boolean; onToggle(p): void; disabled?: boolean }` | A labelled compare checkbox |
| `showStock?: boolean` | A `StatusBadge` for In stock / Low stock / Out of stock |

The card stays a single control that opens the product; the action button
and checkbox stop propagation, as today's cards do. Out-of-stock disables the
action exactly as `canAddToBasket` decides today.

Replaced by it: `src/components/ProductCard.tsx` (consumer),
the card markup inside `public/PublicProductGrid.tsx`, and the card markup
inside `enterprise/EnterpriseBrowse.tsx`. The old consumer `ProductCard.tsx`
is deleted once nothing imports it.

### 1.2 The market rule

A pure function in `src/lib/storefront.ts`:

```ts
pricedFor<T extends { currency?: string }>(products: readonly T[], currency: string): T[]
```

keeps products whose `currency` equals the visitor's currency, and keeps
products that carry no `currency` (unrepriced rows). It is applied wherever a
shop surface lists repriced products: consumer home, category view, public
Retail/Enterprise pages, enterprise browse, and search results.
`featuredProducts` (spec 1) is refactored to call it, so there is one rule.

The cart and checkout are not filtered: a line already in a basket keeps its
behaviour; spec 5 checks baskets carried across a market switch.

### 1.3 Header search on the public site

The public header gains a search pill (desktop) / search icon (phone).
Submitting navigates to the Retail page with the text pre-filled into its
search box — the public Retail page gains one as part of the shared listing
toolbar (2.2); it filters the products already loaded, by the same rule the
signed-in grid uses. `PublicPage` navigation gains an optional query:
`onNavigate(page, { q?: string })`; `AudiencePage` passes `q` into the retail
grid's search state. A pure helper `searchTarget(text): { page: 'retail'; q: string } | null`
returns null for blank input.

## 2. Screens

### 2.1 Retail storefront — signed-in consumer home

- **Compact hero card** (`BentoCard variant="light"` with a navy headline,
  roughly half today's height): today's headline, the live market line, the
  converted free-delivery threshold, primary "Shop all products" (cyan).
- **Trust tiles** beside it on desktop, below on phone: Fast delivery, Secure
  checkout, Support, Rewards — replacing today's icon row; same copy facts.
- **Shop by category** — spec 1 `CategoryTile`s, consumer-shoppable shelves
  only (`categoriesFor(…,'consumer')`, as `CategoryStrip` does today).
- **Featured products** — the shared card with Add to basket and compare.

`Hero.tsx` and `CategoryStrip.tsx` are rewritten in place; their data reads
and the threshold conversion are kept verbatim.

### 2.2 Listing page — consumer category view, public Retail and Enterprise pages

- **Title strip**: category name, live result count, breadcrumb.
- **Desktop ≥ 1024px**: a left filter panel (sub-category, stock — today's
  filters) with "Clear all"; a toolbar above the grid with search, today's four
  sort options and the count; a 3–4 column card grid.
- **Below 1024px**: the panel collapses behind a "Filters" button that opens a
  bottom sheet (focus-trapped, Escape closes, returns focus).
- **Compare**: today's `CompareTray` restyled as a floating bar; the compare
  table is unchanged in content.
- **Empty states**: "No products match these filters" with Clear all; a
  shelf with nothing priced for the market says so rather than showing an
  empty grid.

### 2.3 Enterprise storefront — `en-browse`

Same skeleton as 2.2, denser:

- **Category tiles** above the grid — compact bento tiles, one per category
  in the live data that the enterprise account can buy from, each with its
  live count; clicking sets the existing vertical filter.
- **Left panel**: today's vertical and category filters with counts.
- **Account currency note** stays, as an info strip.
- **Cards**: "Add to requisition".
- **Requisition panel** (`RequisitionPanel.tsx`) restyled as a right-side
  drawer; its fields, validation and approval routing are unchanged.

### 2.4 Product detail — consumer page, public modal, enterprise listing modal

Two columns on desktop, stacked on phone:

- **Left**: photo, overview (description), then a **Specifications**
  accordion built from the product's existing `specs` (hidden when empty),
  then **Seller**, then the reviews block `ProductDetail` already renders.
- **Right, sticky**: price (and was-price), stock badge, subscription or
  contract terms where the product has them, quantity, primary action, and
  whatever secondary actions `ProductDetail` already offers (e.g. Notify me
  when out of stock) — none added.

Only fields already on the product are shown. `ProductDetail.tsx` keeps its
props; `PublicProductModal` and `EnterpriseListingModal` keep using it.

### 2.5 Cart drawer and checkout

- **Cart drawer**: restyled line items, sticky total, cyan "Checkout".
- **Checkout**: two columns — numbered step cards on the left (Delivery
  details, Payment method), a sticky order summary on the right. Same fields,
  validation, payment gateway flow and confirmation as today.

### 2.6 Out of scope

Orders, Subscriptions, Rewards and Account pages (they already carry the new
palette; layout in spec 5). The new B2B features (backlog). Any database
change.

## 3. Responsive and motion

| Width | Layout |
|---|---|
| ≥ 1200px | Filter panel + 4-column grid; detail two columns |
| 1024–1199px | Filter panel + 3-column grid |
| 768–1023px | Filters in a bottom sheet; 2–3 column grid; detail stacked |
| < 768px | 1–2 column grid; sticky bottom bar on detail with price and the primary action |

Card hover lift, accordion and sheet transitions only; all off under reduced
motion.

## 4. Testing

Unit (Node, test-first), in `src/lib`:

- `pricedFor` — keeps matching currency, drops others, keeps rows without
  `currency`; `featuredProducts` still passes its existing tests after the
  refactor.
- `searchTarget` — trims, returns null for blank, routes to retail.
- `cardAction(persona, product)` — returns the label/disabled state the card
  shows (basket vs requisition; out-of-stock disabled), so the rule is not
  buried in JSX.

Gates per task: `npx vitest run` (only the two known env-dependent failures)
and `npm run build`.

Browser (run-app skill), at 1280 / 1024 / 390:

- Consumer: home → category → filter + sort + search → product → add to
  basket → cart drawer → checkout screen (stop before placing an order — the
  database is shared and seeded).
- Enterprise: browse → category tile → filters → compare → open listing →
  add to requisition → requisition drawer (stop before submitting).
- Public: header search lands on Retail with the text applied.
- Market switch India ↔ Kenya: SKU-7011 absent in India, present in Kenya.
- Programmatic contrast scan on every screen above; keyboard pass on filters
  sheet, accordions and drawers.
- Render cost: measure frame time on the consumer home in a foreground tab;
  spec 1's browser check saw very slow paints there (possibly background-tab
  throttling) — confirm or rule out.

Before merge: `npm run test:integration` compared with `main`.

## 5. Documentation

`README.md` Design system section: the card's new props and the market rule.
`docs/superpowers/backlog.md`: mark spec 2 done; move anything deferred there.
