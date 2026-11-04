# UI revamp, spec 1 of 5 — design foundation and public homepage

Date: 2026-11-04 · Status: awaiting review

## Why

The public marketplace looks like a generic storefront. The target is the
"bento-grid modular ecosystem + modern futuristic technology" direction in the
Aventa UI/UX revamp brief, illustrated by the sample homepage screen supplied
with it. The brief covers every experience; it is split into five specs, each
with its own plan and build:

1. **Foundation + public homepage** — this spec.
2. Commerce — retail and enterprise storefronts, product listing and detail,
   cart and checkout, header search.
3. Operator console — grouped sidebar, bento KPI dashboard, business accounts.
4. Partner portal — the operator workspace language, partner navigation.
5. Validation sweep across all four signed-in experiences.

## Constraints

- **No functional change.** Routes, the `surface` state machine in `App.tsx`,
  repos, RLS, pricing and market switching behave exactly as today.
- **No invented data.** Categories, counts, products, prices, ratings and
  sellers come from the live tables. Marketing copy ("Why Aventa?") is the only
  static content.
- **No new dependencies.** No Tailwind, no animation library, no router.
- **Accessibility does not regress.** `global.css` records deliberate contrast
  fixes; every text pairing must still clear WCAG 2.2 AA.

## Decisions taken in brainstorming

| Question | Decision |
|---|---|
| Scope of spec 1 | Foundation and homepage together |
| Hero visual | Coded, animated SVG network globe — no photo |
| Category taxonomy | The real `categories` table, restyled; not the sample's five labels |
| Imagery | Existing assets in `images/`, processed through `npm run assets` |
| Styling approach | Token remap + a small shared `ui/` component layer |

## 1. Foundation

### 1.1 Tokens (`src/styles/global.css`)

Existing variables are repointed, so the ~5,900 inline styles that read them
change everywhere without touching component files.

| Token | Now | New |
|---|---|---|
| `--brand-navy` | `#0B1F3A` | `#061B3A` |
| `--brand-navy-light` | `#142A4A` | `#0B2850` |
| `--brand-navy-dark` | `#060F1F` | `#03132B` |
| `--brand-accent` | `#00A6A6` | `#00C6B5` |
| `--brand-accent-light` | `#00C9C9` | `#12CDE0` |
| `--brand-accent-dark` | `#007575` | stays — the AA-safe teal for small text and white-label fills |
| `--bg-alt` | `#F9FAFB` | `#F4F7FC` |
| `--text` | `#111827` | `#102344` |
| `--text-secondary` | `#4B5563` | `#475569` |
| `--text-tertiary` | `#6B7280` | `#5B6B82` |
| `--border` | `#E5E7EB` | `#E3EAF3` |

The brief's secondary text `#64748B` measures 4.76:1 on white but 4.43:1 on
the new `#F4F7FC` page ground — under AA. So `--text-secondary` is `#475569`
(7.06:1) and `--text-tertiary` is `#5B6B82` (5.05:1), the nearest slate that
clears 4.5:1 on both surfaces. The three-step ink hierarchy survives.

New tokens:

```
--blue: #0756A5;  --electric: #168BFF;  --cyan: #12CDE0;  --teal: #00C6B5;
--grad-navy:  linear-gradient(135deg, #03132B 0%, #061B3A 45%, #0756A5 100%);
--grad-cyan:  linear-gradient(90deg, #168BFF 0%, #12CDE0 100%);
--shadow-card: 0 1px 2px rgba(16,35,68,.04), 0 4px 16px rgba(16,35,68,.06);
--shadow-lift: 0 12px 32px -8px rgba(16,35,68,.18);
--radius-card: 16px;
```

**Colour roles.** The brief's success `#16A36A`, warning `#E9A23B` and teal
`#00C6B5` are used for fills, icons, dots and large type only. Small text keeps
the existing AA-safe `--success`, `--warning`, `--danger` and
`--brand-accent-dark`. The new primary button is cyan `#12CDE0` with navy
`#061B3A` text (≈ 10:1).

**Shape.** `.btn` becomes pill-shaped (`--radius-full`); `.card` uses
`--radius-card`, drops its border in favour of `--shadow-card`, and lifts with
`--shadow-lift` on hover. Focus rings use `--electric`.

### 1.2 Shared components (`src/components/ui/`)

Styled by one new stylesheet, `src/styles/ui.css`, using class names rather
than inline styles so hover, focus and breakpoints are real CSS.

| Component | Purpose |
|---|---|
| `BentoGrid` | CSS-grid container; children declare `span` / `rowSpan`; collapses by breakpoint |
| `BentoCard` | Variants `light`, `dark` (navy gradient), `image` (background photo + overlay); optional eyebrow, title, body, CTA |
| `SectionHeader` | Title, subtitle, optional "View all →" action |
| `CategoryTile` | Image, name, count, arrow; gradient fallback when no image |
| `ProductCard` | Photo, name, seller, short description, price, rating, badge, primary action |
| `StatusBadge` | Tone (`success`, `warning`, `danger`, `info`, `neutral`) + icon, never colour alone |
| `KpiCard` | Label, value, delta, optional sparkline slot — defined here, adopted in spec 3 |
| `NetworkGlobe` | The hero SVG (see 2.2) |

The existing `ProductCard.tsx` used by the signed-in consumer screens is not
replaced in this spec; spec 2 migrates it onto the `ui/` version.

## 2. Public homepage

Files: `PublicShell.tsx`, `LandingPage.tsx` and new section components under
`src/components/public/home/`. `CategoryRail.tsx` is superseded by the new
category section and removed once nothing imports it.

### 2.1 Header

Sticky, 64px, `--brand-navy`, with a 1px `rgba(255,255,255,.08)` bottom rule.

- 6D logo (approved asset) · divider · **Aventa** wordmark — inline SVG,
  gradient "A" mark plus text. The 6D mark itself is never redrawn.
- **Discover ▾** — a panel listing the real categories with icon and live
  product count, each going to `categoryDestination(category)`.
- **Retail · Enterprise · Partners** — the existing `PublicPage` targets.
- `MarketPicker` (unchanged component) and **Sign in** (existing
  `onDemoSignIn`).
- No search, bell, cart or avatar for anonymous visitors. Search needs a query
  parameter on the audience pages and is in spec 2; the others have no account
  behind them.

Below 900px the nav collapses into a menu button with a slide-down panel.

### 2.2 Bento hero

Grid of 3 columns × 2 rows on desktop; the main card spans 2 × 2.

**Main card** — `--grad-navy` background with `NetworkGlobe` on the right:
a dotted sphere, 6–8 arcs drawn with `stroke-dashoffset`, pulsing nodes, and
five ringed lucide icons (radio tower, cloud, shield, smartphone, cpu). Content:

- Eyebrow pill: "⚡ The complete telecom marketplace"
- H1: "One marketplace." / "Every kind of buyer." — second line in `--grad-cyan`
  text fill
- Body: "Discover devices, connectivity, digital services, security and IoT
  solutions from a connected ecosystem" + the existing live market clause
  (`marketProse(book.markets)`)
- CTAs: **Shop Retail** (cyan primary) → `retail`; **Explore Enterprise** and
  **Become a Partner** (outlined white) → `enterprise`, `partner`

**Side cards** (`BentoCard variant="image"`):

| Card | Image | Link |
|---|---|---|
| For Businesses — "Accelerate your digital transformation" | IoT factory banner | Explore Enterprise → `enterprise` |
| For Partners — "Grow together with 6D" | Handshake banner | Become a Partner → `partner` |

### 2.3 Operator promo banners

`PromoStrip` keeps its data source and behaviour (operator-paused banners
disappear); restyled as one rounded `--radius-card` carousel card with dot
indicators. Hidden when there are no live banners.

### 2.4 Explore by Category

`SectionHeader` + one row of `CategoryTile`s for every category a visitor can
reach, in `sort_order`. Count = live, sellable products for the tile's
destination audience (existing `countByCategory`). Click →
`categoryDestination`. Image chosen by `categoryVisual(id)`:

| Category id | Image source |
|---|---|
| `consumer` | `hero.webp` — hand holding a phone (from `images/Mobile.png`) |
| `device` | new crop of `images/device_01_android_phone…png` |
| `content` | carousel tile 2 — streaming on a TV |
| `iot` | carousel tile 3 — connected smart home |
| `security` | carousel tile 4 — shield and padlock |
| `partner` | banner 4 — handshake (positioned right) |
| anything else | gradient fallback with the category's lucide icon |

The scenic carousel and banner slices are preferred over the product-on-white
photographs so the row reads like the sample; the device tile is the one
exception, as there is no scenic device image.

### 2.5 Featured products + promo card

Bento row: four `ProductCard`s (span 1 each) and a **"Power your business with
Aventa"** dark card (span 2, blue-wave banner, "Learn more" → `enterprise`).

Products: `featuredProducts(catalogue, 4)` — sellable, sold to consumers,
operator bestseller badge first, then rating, then `sort_order` and id. It
reuses the ranking of the existing `exampleProducts` rather than writing a
second one. Prices are the market-repriced values the page already computes.
**View details** opens the existing `PublicProductModal`.

### 2.6 Why Aventa?

Four icon tiles, static copy: Faster time to market · Enterprise-grade
security · Global reach · Seamless experience.

### 2.7 Ecosystem strip

"Sellers on Aventa" — `ecosystemSellers(catalogue, 8)`: distinct `seller`
names from the sellable catalogue, ordered by number of live listings then
name, set as typographic wordmarks. Derived from the catalogue the page
already loads, so it needs no extra query and no read on `partners`, which
anonymous visitors may not have. Third-party trademarks from the sample
(Vodafone, Ericsson, …) are not used.

### 2.8 Footer

Same content and data (menu + regions from the markets table), on
`--brand-navy-dark` with the Aventa wordmark beside the 6D logo.

### 2.9 Responsive and motion

| Width | Layout |
|---|---|
| ≥ 1200px | As above |
| 768–1199px | Hero main card full width, side cards side by side below; category tiles 3 per row; featured 2 + promo full width |
| < 768px | Single column in reading order; category tiles scroll horizontally; globe drawn static and smaller |

Motion: arc draw and node pulse in the globe, card lift on hover, dropdown
fade. All animation is disabled under `prefers-reduced-motion: reduce`.

## 3. Images

The hero side cards and the promo card reuse banner slices already produced
by `npm run assets` (banner 6 — IoT factory, banner 4 — handshake, banner 1 —
blue wave); the category tiles reuse carousel slices and `hero.webp` as listed
in 2.4. The only new output is the device tile: `scripts/build-assets.mjs`
gains a step writing `public/assets/mp/home/cat-device.webp` (640×400) and a
`HOME` export in `src/lib/assets.ts`. The 1–2 MB originals are never served.

The comments in `build-assets.mjs` and the generated header in `assets.ts`
that call `images/` gitignored are corrected — the folder is now tracked.

## 4. Data flow and failure

`LandingPage` keeps its three independent reads (promo banners, categories,
repriced catalogue). Each band renders from its own data and degrades alone:

| Read empty or failed | Result |
|---|---|
| Promo banners | Promo band hidden |
| Categories | Category band and Discover menu hidden |
| Catalogue | Featured band hidden; category counts omitted; ecosystem strip hidden |
| A tile image 404s | Gradient fallback (`onError`) |

Hero, Why Aventa and footer never depend on data.

## 5. Testing

The unit suite runs in Node and covers `lib/` only, so every homepage decision
lives in a pure, tested function (written test-first):

- `categoryVisual(id)` — known ids map to their image; unknown ids return the
  fallback.
- `featuredProducts(catalogue, n)` — excludes unsellable and enterprise-only
  rows; bestseller first, then rating; stable ordering; respects `n`.
- `ecosystemSellers(catalogue, n)` — distinct, sellable-only, ordered by live
  listings then name.
- **Token contrast test** — parses `global.css`, and asserts every text/surface
  pair the design uses meets 4.5:1 (3:1 for large text and UI glyphs).

Gates at the end of every implementation task: `npm test` and
`npm run build`. Before merge: `npm run test:integration`.

Browser verification (run-app skill): homepage screenshots at 1440, 1024 and
390px against the sample; every CTA, tile, Discover entry and View details
exercised; switching market updates featured prices and the hero's market
clause; reduced motion stops the globe; no new console errors. The consumer,
enterprise, operator and partner entry points are opened and screenshotted to
catch anything the token remap made unreadable.

## 6. Documentation

Root `README.md`:

- **Branding** — replace the stale palette (`#0D1B4B`, Poppins, nim tokens)
  with the Aventa tokens, colour roles and the AA rule above.
- New **Design system** section — the token table, the `ui/` components and
  when to use each, the "futuristic on discovery surfaces only; light and plain
  on transactional and operational screens" rule.
- **Rebuilding / Scripts** — the `images/` → `npm run assets` → `public/assets/mp`
  pipeline, including the new homepage set.
- Mention the five-spec revamp and link this spec.

`selfcare/README.md` documents a separate earlier prototype the revamp does not
touch, and is left unchanged.

## Out of scope

Restyling signed-in screens beyond what the token remap does on its own;
header search; operator sidebar grouping; the product detail redesign; any
database change.
