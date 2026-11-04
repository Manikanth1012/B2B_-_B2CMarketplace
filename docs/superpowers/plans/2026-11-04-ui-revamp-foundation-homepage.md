# UI revamp, spec 1 — foundation and public homepage — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the whole app onto the Aventa palette and rebuild the public homepage as a bento grid with a coded network-globe hero, without changing any behaviour.

**Architecture:** Repoint the CSS variables in `global.css` (every inline style that reads them follows), add a class-based shared component layer in `src/components/ui/` styled by `src/styles/ui.css`, and compose the homepage from those components. Every decision the homepage makes (which products, which sellers, which image, which count) lives in a pure, tested function in `src/lib/home.ts`.

**Tech Stack:** React 18 + TypeScript + Vite 5, Vitest 2 (Node environment, `src/**/*.test.ts` only), lucide-react icons, sharp for the asset pipeline, Supabase reads through the existing repos.

**Spec:** `docs/superpowers/specs/2026-11-04-ui-revamp-foundation-homepage-design.md`

## Global Constraints

- No functional change: routes, the `surface` state in `App.tsx`, repos, RLS, pricing and market switching behave exactly as before.
- No invented data: categories, counts, products, prices, ratings and sellers come from live tables. Only "Why Aventa?" copy is static.
- No new dependencies. No Tailwind, no animation library, no router.
- Every text/surface pair clears WCAG 2.2 AA: 4.5:1 for small text, 3:1 for large text and UI glyphs.
- Brief colours that fail as small text — teal `#00C6B5` (2.15:1), success `#16A36A` (3.24:1), electric `#168BFF` (3.40:1) — are used for fills, icons and large type only.
- All animation stops under `prefers-reduced-motion: reduce`.
- Third-party trademarks (Vodafone, Ericsson, …) are not used. The 6D mark renders only from `/assets/brand/6d-logo-white.png`, never redrawn.
- Gates at the end of every task: `npm test` and `npm run build` both pass.
- Commit messages follow the repo's style: a plain-English subject saying what changed and why, a short body, ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## File map

| File | Status | Responsibility |
|---|---|---|
| `src/lib/contrast.ts` | create | WCAG contrast maths and a token reader for CSS text |
| `src/lib/contrast.test.ts` | create | Asserts every token pairing the design uses clears AA |
| `src/styles/global.css` | modify | Repointed and new tokens |
| `src/lib/storefront.ts` | modify | Extract `showcaseOrder` from `exampleProducts` |
| `src/lib/home.ts` | create | `featuredProducts`, `ecosystemSellers`, `categoryVisual`, `tileCount`, `HOME_ART` |
| `src/lib/home.test.ts` | create | Tests for the above |
| `scripts/build-assets.mjs` | modify | Device tile crop, `HOME` manifest, corrected comments |
| `src/lib/assets.ts` | regenerated | Adds `HOME` |
| `src/lib/assets.test.ts` | modify | Covers `HOME` |
| `src/styles/ui.css` | create | All shared component and homepage classes |
| `src/main.tsx` | modify | Imports `ui.css` |
| `src/components/ui/*.tsx` | create | BentoGrid, BentoCard, SectionHeader, StatusBadge, KpiCard, AventaWordmark, CategoryTile, ProductCard, NetworkGlobe, categoryIcons |
| `src/components/public/DiscoverMenu.tsx` | create | Header category panel |
| `src/components/public/PublicShell.tsx` | modify | New header and footer |
| `src/components/public/home/*.tsx` | create | HomeHero, CategorySection, FeaturedSection, WhyAventa, EcosystemStrip |
| `src/components/public/LandingPage.tsx` | modify | Composes the sections; opens the product modal |
| `src/components/public/PromoStrip.tsx` | modify | Restyled as rounded cards |
| `src/components/public/CategoryRail.tsx` | delete | Superseded by CategorySection |
| `src/App.tsx` | modify | Passes `onAddToBasket` to `LandingPage` |
| 4 component files | modify | Small teal text moved to `--brand-accent-dark` |
| `README.md` | modify | Branding, Design system, asset pipeline |

---

### Task 1: Tokens and the contrast test

**Files:**
- Create: `src/lib/contrast.ts`, `src/lib/contrast.test.ts`
- Modify: `src/styles/global.css:1-110`
- Modify: `src/components/Checkout.tsx:533`, `src/components/OrdersView.tsx:182`, `src/components/operator/OperatorRoles.tsx:326`, `src/components/public/ContinueWithAventaId.tsx:307`

**Interfaces:**
- Produces: `contrast(fg: string, bg: string): number`, `readTokens(css: string): Record<string, string>`; CSS tokens `--blue`, `--electric`, `--cyan`, `--teal`, `--grad-navy`, `--grad-cyan`, `--shadow-card`, `--shadow-lift`, `--radius-card`.

- [ ] **Step 1: Write the failing test**

`src/lib/contrast.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { contrast, readTokens } from './contrast'

describe('contrast()', () => {
  it('matches the WCAG reference values', () => {
    expect(contrast('#000000', '#FFFFFF')).toBeCloseTo(21, 1)
    expect(contrast('#FFFFFF', '#FFFFFF')).toBeCloseTo(1, 5)
    expect(contrast('#007575', '#FFFFFF')).toBeCloseTo(5.52, 1)
  })
  it('is symmetric', () => {
    expect(contrast('#102344', '#F4F7FC')).toBeCloseTo(contrast('#F4F7FC', '#102344'), 5)
  })
})

describe('readTokens()', () => {
  it('reads six-digit hex custom properties and ignores everything else', () => {
    const t = readTokens(':root { --a: #112233; --b: 4px; --c:#AbCdEf; }')
    expect(t).toEqual({ a: '#112233', c: '#ABCDEF' })
  })
})

/* Every text-on-surface pairing the design system actually uses. Adding a new
   pairing to the UI means adding it here; changing a token so a pairing drops
   under AA fails this test before it reaches a screen. */
const css = readFileSync(new URL('../styles/global.css', import.meta.url), 'utf8')
const tokens = readTokens(css)

const PAIRS: [fg: string, bg: string, min: number][] = [
  ['text', 'bg-card', 4.5],
  ['text', 'bg-alt', 4.5],
  ['text-secondary', 'bg-card', 4.5],
  ['text-secondary', 'bg-alt', 4.5],
  ['text-tertiary', 'bg-card', 4.5],
  ['text-tertiary', 'bg-alt', 4.5],
  ['brand-accent-dark', 'bg-card', 4.5],
  ['brand-accent-dark', 'bg-alt', 4.5],
  ['blue', 'bg-card', 4.5],
  ['blue', 'bg-alt', 4.5],
  ['brand-navy', 'cyan', 4.5],          // primary button label
  ['cyan', 'brand-navy', 4.5],          // links and eyebrows on dark cards
  ['text-inverse', 'brand-navy', 4.5],
  ['text-inverse', 'brand-navy-dark', 4.5],
  ['success', 'bg-card', 4.5],
  ['warning', 'bg-card', 4.5],
  ['danger', 'bg-card', 4.5],
  ['info', 'bg-card', 4.5],
  ['success', 'success-bg', 4.5],
  ['warning', 'warning-bg', 4.5],
  ['danger', 'danger-bg', 4.5],
  ['info', 'info-bg', 4.5],
  ['electric', 'bg-card', 3],           // focus ring: a UI glyph, not text
]

describe('design tokens', () => {
  it.each(PAIRS)('--%s on --%s clears %s:1', (fg, bg, min) => {
    expect(tokens[fg], `--${fg} is not defined`).toBeDefined()
    expect(tokens[bg], `--${bg} is not defined`).toBeDefined()
    expect(contrast(tokens[fg], tokens[bg])).toBeGreaterThanOrEqual(min)
  })

  it('carries the Aventa palette', () => {
    expect(tokens['brand-navy']).toBe('#061B3A')
    expect(tokens['brand-navy-dark']).toBe('#03132B')
    expect(tokens['cyan']).toBe('#12CDE0')
    expect(tokens['bg-alt']).toBe('#F4F7FC')
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/lib/contrast.test.ts`
Expected: FAIL — `Failed to resolve import "./contrast"`.

- [ ] **Step 3: Write `src/lib/contrast.ts`**

```ts
/* WCAG 2.x contrast, and a reader for the hex tokens in a stylesheet. No DOM:
   the token test reads global.css as text so it runs in the Node suite. */

function channel(v: number): number {
  const s = v / 255
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
}

function luminance(hex: string): number {
  const h = hex.replace('#', '')
  const r = parseInt(h.slice(0, 2), 16)
  const g = parseInt(h.slice(2, 4), 16)
  const b = parseInt(h.slice(4, 6), 16)
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

/** Contrast ratio between two `#RRGGBB` colours, 1 to 21. */
export function contrast(fg: string, bg: string): number {
  const a = luminance(fg)
  const b = luminance(bg)
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}

/** Every `--name: #RRGGBB` declaration in the text, first definition wins. */
export function readTokens(css: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const m of css.matchAll(/--([\w-]+)\s*:\s*(#[0-9a-fA-F]{6})\b/g)) {
    if (!(m[1] in out)) out[m[1]] = m[2].toUpperCase()
  }
  return out
}
```

- [ ] **Step 4: Run it — the maths passes, the palette test fails**

Run: `npx vitest run src/lib/contrast.test.ts`
Expected: `contrast()` and `readTokens()` PASS; `--blue … not defined` and `carries the Aventa palette` FAIL.

- [ ] **Step 5: Repoint and add tokens in `src/styles/global.css`**

Replace the `/* Brand palette … */` block (lines 2–13) with:

```css
  /* Brand palette — Aventa. Deep navy ground, electric blue to cyan accents.
     Teal, cyan and electric are fills, icons and large type; small text uses
     --brand-accent-dark or --blue, which clear AA (see contrast.test.ts). */
  --brand-navy: #061B3A;
  --brand-navy-light: #0B2850;
  --brand-navy-dark: #03132B;
  --brand-accent: #00C6B5;
  --brand-accent-light: #12CDE0;
  --brand-accent-dark: #007575;   /* 5.52:1 on white, 5.14:1 on --bg-alt — the teal for small text */
  --brand-accent-darker: #005F5F;
  --brand-gold: #F5A623;
  --brand-red: #E63946;

  --blue: #0756A5;                 /* links and small accent text on light surfaces — 7.28:1 */
  --electric: #168BFF;             /* focus rings, icons, gradients — 3.40:1, never small text */
  --cyan: #12CDE0;                 /* primary button fill (navy label 8.84:1), accents on dark */
  --teal: #00C6B5;                 /* fills only — 2.15:1 on white */
  --grad-navy: linear-gradient(135deg, #03132B 0%, #061B3A 45%, #0756A5 100%);
  --grad-cyan: linear-gradient(90deg, #168BFF 0%, #12CDE0 100%);
```

In the Surfaces/Text/Shadows/Radii blocks change these values and add the new ones:

```css
  --bg-alt: #F4F7FC;
  --border: #E3EAF3;
  --border-light: #EEF2F8;

  --text: #102344;
  --text-secondary: #475569;   /* 7.06:1 on --bg-alt */
  /* The brief's #64748B is 4.43:1 on the new #F4F7FC ground — under AA.
     #5B6B82 is the nearest slate that clears 4.5:1 on white and on --bg-alt. */
  --text-tertiary: #5B6B82;

  --shadow-card: 0 1px 2px rgba(16,35,68,0.04), 0 4px 16px rgba(16,35,68,0.06);
  --shadow-lift: 0 12px 32px -8px rgba(16,35,68,0.18);

  --radius-card: 16px;
```

Keep the existing explanatory comment above `--text-tertiary` but update its numbers to the line above. Leave `--success`, `--warning`, `--danger`, `--info` and their `-bg` tints unchanged — they are the AA-safe text colours.

Then in the `.btn` rule change `border-radius: var(--radius);` to `border-radius: var(--radius-full);`, and replace the `.card` rule with:

```css
.card {
  background: var(--bg-card);
  border: 1px solid var(--border-light);
  border-radius: var(--radius-card);
  box-shadow: var(--shadow-card);
  overflow: hidden;
  transition: box-shadow var(--transition), transform var(--transition);
}

.card-hover:hover {
  box-shadow: var(--shadow-lift);
  transform: translateY(-2px);
}
```

- [ ] **Step 6: Move small teal text onto the AA-safe teal**

`--brand-accent` is now `#00C6B5` (2.15:1 on white). Four places set small text in it. In each, change `color: 'var(--brand-accent)'` to `color: 'var(--brand-accent-dark)'`:

- `src/components/Checkout.tsx:533`
- `src/components/OrdersView.tsx:182`
- `src/components/operator/OperatorRoles.tsx:326`
- `src/components/public/ContinueWithAventaId.tsx:307`

Leave `src/components/LoginScreen.tsx:84` (`accentColor`) alone — it tints a checkbox fill, not text.

Confirm nothing else does it: run
`git grep -n "color: 'var(--brand-accent)'" -- src` — expected: no output.

- [ ] **Step 7: Run all gates**

Run: `npx vitest run src/lib/contrast.test.ts` — expected PASS (all pairs).
Run: `npm test` — expected all files PASS.
Run: `npm run build` — expected success.

- [ ] **Step 8: Commit**

```bash
git add src/lib/contrast.ts src/lib/contrast.test.ts src/styles/global.css src/components/Checkout.tsx src/components/OrdersView.tsx src/components/operator/OperatorRoles.tsx src/components/public/ContinueWithAventaId.tsx
git commit -m "The Aventa palette, held to the contrast the old one had earned" -m "Repoints the brand, surface and ink tokens to the revamp palette and adds the blue, electric, cyan and gradient tokens. The brief's slate fails AA on its own page ground, so the lightest ink is the nearest slate that passes; a test now reads global.css and fails if any pairing the design uses drops under AA. Four labels set in the old teal move to the dark teal, because the new one is 2.15:1." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: What the homepage selects

**Files:**
- Modify: `src/lib/storefront.ts:283-296`
- Create: `src/lib/home.ts`, `src/lib/home.test.ts`

**Interfaces:**
- Consumes: from `./storefront` — `SellableProduct`, `Shopper`, `isSellable`, `soldTo`, `categoriesFor`, `categoryDestination`; from `./assets` — `HERO`, `CAROUSEL`, `BANNERS` (and `HOME`, added in Task 3).
- Produces:
  - `showcaseOrder(a: SellableProduct, b: SellableProduct): number` (in `storefront.ts`)
  - `featuredProducts<T extends SellableProduct>(products: readonly T[], categories: readonly Category[], n?: number): T[]`
  - `ecosystemSellers(products: readonly { seller: string; status: string }[], n?: number): string[]`
  - `tileCount(category: Category, products: readonly SellableProduct[]): number`
  - `interface Visual { src: string; position?: string }`
  - `categoryVisual(id: string): Visual | null`
  - `HOME_ART: { business: string; partners: string; promo: string }`

Task 3 adds `HOME.categoryDevice`; until then `home.ts` uses `HERO` for the device tile so the build stays green. Task 3 switches it.

- [ ] **Step 1: Extract `showcaseOrder` (refactor under existing tests)**

In `src/lib/storefront.ts` replace `exampleProducts` (lines 283–296) with:

```ts
/** Showcase order: operator-flagged bestsellers first, then what buyers rated
    highest, then `sort_order` and id so the choice is stable between renders. */
export function showcaseOrder(a: SellableProduct, b: SellableProduct): number {
  return Number(b.badge === 'Bestseller') - Number(a.badge === 'Bestseller') ||
    (b.rating ?? 0) - (a.rating ?? 0) ||
    a.sort_order - b.sort_order ||
    a.id.localeCompare(b.id)
}

export function exampleProducts<T extends SellableProduct>(
  products: readonly T[],
  categoryId: string,
  limit = 3,
): T[] {
  return products
    .filter(p => p.category_id === categoryId && isSellable(p))
    .sort(showcaseOrder)
    .slice(0, limit)
}
```

Run: `npx vitest run src/lib/storefront.test.ts` — expected PASS, unchanged.

- [ ] **Step 2: Write the failing tests**

`src/lib/home.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { Category } from '../types'
import type { SellableProduct } from './storefront'
import { featuredProducts, ecosystemSellers, tileCount, categoryVisual, HOME_ART } from './home'

const cat = (id: string, shoppable_by: Category['shoppable_by'], audience = 'B2C', sort_order = 0): Category =>
  ({ id, name: id, audience, shoppable_by, icon: 'package', blurb: '', sort_order })

const prod = (o: Partial<SellableProduct> & { id: string }): SellableProduct => ({
  name: o.id, seller: 'Seller', price: 10, was_price: null, rating: null, reviews: 0,
  stock: 'In stock', badge: null, unit: null, category_id: 'device', status: 'live',
  sort_order: 0, audiences: null, ...o,
})

const CATS = [
  cat('device', ['consumer', 'enterprise'], 'B2C'),
  cat('iot', ['enterprise'], 'Enterprise'),
  cat('partner', ['partner'], 'B2B2X'),
]

describe('featuredProducts', () => {
  it('offers only what a retail visitor can buy', () => {
    const rows = [
      prod({ id: 'ok' }),
      prod({ id: 'draft', status: 'draft' }),
      prod({ id: 'biz-only', audiences: ['enterprise'] }),
      prod({ id: 'iot-shelf', category_id: 'iot' }),
    ]
    expect(featuredProducts(rows, CATS).map(p => p.id)).toEqual(['ok'])
  })

  it('leads with bestsellers, then rating, then catalogue order', () => {
    const rows = [
      prod({ id: 'a', rating: 4.9, sort_order: 1 }),
      prod({ id: 'b', badge: 'Bestseller', rating: 3.1, sort_order: 2 }),
      prod({ id: 'c', rating: 4.9, sort_order: 0 }),
      prod({ id: 'd', rating: null, sort_order: 0 }),
    ]
    expect(featuredProducts(rows, CATS).map(p => p.id)).toEqual(['b', 'c', 'a', 'd'])
  })

  it('returns at most n', () => {
    const rows = Array.from({ length: 9 }, (_, i) => prod({ id: `p${i}` }))
    expect(featuredProducts(rows, CATS, 4)).toHaveLength(4)
    expect(featuredProducts(rows, CATS)).toHaveLength(4)
  })
})

describe('ecosystemSellers', () => {
  it('names each live seller once, busiest first, then alphabetically', () => {
    const rows = [
      { seller: 'Zeta', status: 'live' }, { seller: 'Alpha', status: 'live' },
      { seller: 'Zeta', status: 'live' }, { seller: 'Beta', status: 'live' },
      { seller: 'Gone', status: 'delisted' }, { seller: '  ', status: 'live' },
    ]
    expect(ecosystemSellers(rows)).toEqual(['Zeta', 'Alpha', 'Beta'])
  })

  it('returns at most n', () => {
    const rows = ['a', 'b', 'c'].map(seller => ({ seller, status: 'live' }))
    expect(ecosystemSellers(rows, 2)).toEqual(['a', 'b'])
  })
})

describe('tileCount', () => {
  it('counts a retail tile in what a consumer can buy', () => {
    const rows = [
      prod({ id: '1' }), prod({ id: '2', audiences: ['enterprise'] }),
      prod({ id: '3', status: 'draft' }), prod({ id: '4', category_id: 'iot' }),
    ]
    expect(tileCount(CATS[0], rows)).toBe(1)
  })

  it('counts every live row on a shelf only resellers buy from', () => {
    const rows = [prod({ id: '1', category_id: 'partner' }), prod({ id: '2', category_id: 'partner', audiences: ['partner'] })]
    expect(tileCount(CATS[2], rows)).toBe(2)
  })
})

describe('categoryVisual', () => {
  const onDisk = (p: string) => existsSync(join('public', p.replace(/^\//, '')))

  it('has a picture on disk for each of the six shelves', () => {
    for (const id of ['consumer', 'device', 'content', 'iot', 'security', 'partner']) {
      const v = categoryVisual(id)
      expect(v, id).not.toBeNull()
      expect(onDisk(v!.src), `${id} → ${v!.src}`).toBe(true)
    }
  })

  it('returns null for a shelf it does not know, so the tile draws its fallback', () => {
    expect(categoryVisual('something-new')).toBeNull()
  })

  it('points the hero cards at files on disk', () => {
    expect(Object.values(HOME_ART).every(onDisk)).toBe(true)
  })
})
```

- [ ] **Step 3: Run them and watch them fail**

Run: `npx vitest run src/lib/home.test.ts`
Expected: FAIL — `Failed to resolve import "./home"`.

- [ ] **Step 4: Write `src/lib/home.ts`**

```ts
/* What the public homepage shows, decided here rather than in components.
   No React and no Supabase, so every choice is testable in the Node suite. */

import type { Category } from '../types'
import type { PublicPage } from '../types/view'
import {
  categoriesFor, categoryDestination, isSellable, showcaseOrder, soldTo,
  type SellableProduct, type Shopper,
} from './storefront'
import { HERO, CAROUSEL, BANNERS } from './assets'

/** The products in the Featured band: live, on a shelf a retail visitor can buy
    from, sold to consumers, in showcase order. */
export function featuredProducts<T extends SellableProduct>(
  products: readonly T[],
  categories: readonly Category[],
  n = 4,
): T[] {
  const shelves = new Set(categoriesFor(categories, 'consumer').map(c => c.id))
  return products
    .filter(p => shelves.has(p.category_id) && isSellable(p) && soldTo(p, 'consumer'))
    .sort(showcaseOrder)
    .slice(0, n)
}

/** Sellers for the ecosystem strip, read from the live catalogue rather than the
    partners table, which an anonymous visitor may not be able to read. */
export function ecosystemSellers(
  products: readonly { seller: string; status: string }[],
  n = 8,
): string[] {
  const counts = new Map<string, number>()
  for (const p of products) {
    if (!isSellable(p)) continue
    const name = p.seller?.trim()
    if (!name) continue
    counts.set(name, (counts.get(name) ?? 0) + 1)
  }
  return [...counts]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, n)
    .map(([name]) => name)
}

const SHOPPER_FOR: Partial<Record<PublicPage, Shopper>> = { retail: 'consumer', enterprise: 'enterprise' }

/** The "N products" on a tile: what the visitor will find on the page the tile
    opens, so a retail tile counts only what a consumer can buy. */
export function tileCount(category: Category, products: readonly SellableProduct[]): number {
  const who = SHOPPER_FOR[categoryDestination(category)]
  return products.filter(p =>
    p.category_id === category.id && isSellable(p) && (!who || soldTo(p, who))).length
}

export interface Visual { src: string; position?: string }

/* Scenic slices first so the row reads like one set; see the spec, 2.4. */
const CATEGORY_VISUALS: Record<string, Visual> = {
  consumer: { src: HERO, position: 'center 40%' },
  device: { src: HERO, position: 'center 40%' },          // Task 3 → HOME.categoryDevice
  content: { src: CAROUSEL[1], position: 'center 30%' },
  iot: { src: CAROUSEL[2], position: 'center 25%' },
  security: { src: CAROUSEL[3], position: 'center 35%' },
  partner: { src: BANNERS[3], position: 'right center' },
}

/** The picture for a category tile, or null for a shelf added since — the tile
    then draws a gradient with the category's icon instead of a broken image. */
export function categoryVisual(id: string): Visual | null {
  return CATEGORY_VISUALS[id] ?? null
}

/** Artwork for the hero side cards and the promo card. */
export const HOME_ART = {
  business: BANNERS[5],   // IoT factory
  partners: BANNERS[3],   // handshake
  promo: BANNERS[0],      // blue light wave
} as const
```

- [ ] **Step 5: Run the tests and watch them pass**

Run: `npx vitest run src/lib/home.test.ts src/lib/storefront.test.ts`
Expected: PASS.

- [ ] **Step 6: Gates and commit**

Run: `npm test` and `npm run build` — both pass.

```bash
git add src/lib/storefront.ts src/lib/home.ts src/lib/home.test.ts
git commit -m "What the new homepage puts on show, decided where it can be tested" -m "Featured products, the sellers in the ecosystem strip, the count and picture on each category tile, and the hero artwork are pure functions over the live catalogue. The featured ranking is the showcase order the seller page already uses, now shared rather than written twice." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: The device tile image and the `HOME` manifest

**Files:**
- Modify: `scripts/build-assets.mjs`
- Regenerate: `src/lib/assets.ts`, `public/assets/mp/home/cat-device.webp`
- Modify: `src/lib/assets.test.ts`, `src/lib/home.ts`

**Interfaces:**
- Produces: `export const HOME = { categoryDevice: '/assets/mp/home/cat-device.webp' } as const` in `src/lib/assets.ts`.

- [ ] **Step 1: Write the failing test**

In `src/lib/assets.test.ts` change the import and `all`:

```ts
import { HERO, CAROUSEL, BANNERS, DEVICE_THUMBS, RETAIL_PRODUCTS, ENTERPRISE_PRODUCTS, HOME } from './assets'

const onDisk = (p: string) => join('public', p.replace(/^\//, ''))
const all = [HERO, ...CAROUSEL, ...BANNERS, ...DEVICE_THUMBS,
             ...RETAIL_PRODUCTS.map(p => p.src), ...ENTERPRISE_PRODUCTS.map(p => p.src),
             ...Object.values(HOME)]
```

and add inside `describe('asset manifest', …)`:

```ts
  it('has the homepage set', () => {
    expect(HOME.categoryDevice).toBe('/assets/mp/home/cat-device.webp')
  })
```

Run: `npx vitest run src/lib/assets.test.ts`
Expected: FAIL — `HOME` is not exported.

- [ ] **Step 2: Add the step to `scripts/build-assets.mjs`**

Change the header comment (lines 1–3) to:

```js
/* Slices the supplied sprite sheets and emits WebP plus a typed manifest.
   Re-runnable: `npm run assets`. Sources live in images/, which is tracked in
   git; only the processed WebP under public/assets/mp is served. */
```

After the `hero.webp` block (after line 99) add:

```js
/* The homepage's category row prefers the scenic slices above; devices have no
   scenic picture, so their tile is cropped from one product photograph. */
const HOME_OUT = join(OUT, 'home')
mkdirSync(HOME_OUT, { recursive: true })
const deviceSrc = readdirSync(SRC).filter((f) => f.startsWith('device_01_android_phone'))
if (deviceSrc.length !== 1) {
  throw new Error(`device tile: expected one images/device_01_android_phone*, found ${deviceSrc.length}`)
}
await sharp(join(SRC, deviceSrc[0]))
  .resize(640, 400, { fit: 'cover' })
  .webp({ quality: 80 })
  .toFile(join(HOME_OUT, 'cat-device.webp'))
const home = { categoryDevice: '/assets/mp/home/cat-device.webp' }
```

In the `writeFileSync('src/lib/assets.ts', …)` template, change the header lines to

```
/* GENERATED by scripts/build-assets.mjs — do not edit.
   Re-run with \`npm run assets\`. Sources are in images/. */
```

and append after `${tiles('ENTERPRISE_PRODUCTS', enterprise)}`:

```js
export const HOME = ${JSON.stringify(home, null, 2)} as const
```

(the template literal now ends `…${tiles('ENTERPRISE_PRODUCTS', enterprise)}export const HOME = ${JSON.stringify(home, null, 2)} as const\n\``).

- [ ] **Step 3: Run the pipeline and inspect the diff**

Run: `npm run assets`
Expected output: `carousel 5 · banners 12 · thumbs 42 · products 12`.

Run: `git status --short public src/lib/assets.ts`
Expected: `src/lib/assets.ts` modified, `public/assets/mp/home/` new. If existing `.webp` files show as modified, open two of them to confirm they are the same pictures (sharp re-encodes) and keep them — but do not commit unrelated image churn: `git checkout -- public/assets/mp/*.webp` restores them, since only `home/` is new.

- [ ] **Step 4: Point the device tile at the new image**

In `src/lib/home.ts` change the import to `import { HERO, CAROUSEL, BANNERS, HOME } from './assets'` and the device row to:

```ts
  device: { src: HOME.categoryDevice },
```

- [ ] **Step 5: Gates and commit**

Run: `npx vitest run src/lib/assets.test.ts src/lib/home.test.ts` — PASS.
Run: `npm test` and `npm run build` — pass.

```bash
git add scripts/build-assets.mjs src/lib/assets.ts src/lib/assets.test.ts src/lib/home.ts public/assets/mp/home/cat-device.webp
git commit -m "A picture for the device shelf, cut from the images we already hold" -m "The asset pipeline crops one phone photograph from images/ into a 640x400 WebP for the device tile and exports it as HOME. The comments that called images/ gitignored are corrected: it has been tracked since the last push." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: The shared layer — stylesheet and layout components

**Files:**
- Create: `src/styles/ui.css`
- Modify: `src/main.tsx`
- Create: `src/components/ui/BentoGrid.tsx`, `BentoCard.tsx`, `SectionHeader.tsx`, `StatusBadge.tsx`, `KpiCard.tsx`, `AventaWordmark.tsx`, `index.ts`

**Interfaces:**
- Produces:
  - `BentoGrid({ cols?: number; className?: string; children })`
  - `BentoCell({ span?: 1|2|3; rows?: 1|2; children })` — exported from `BentoGrid.tsx`
  - `BentoCard({ variant?: 'light'|'dark'|'image'; image?: string; imagePosition?: string; eyebrow?: string; title?: ReactNode; text?: ReactNode; action?: ReactNode; interactive?: boolean; className?: string; as?: 'div'|'article'; children? })`
  - `SectionHeader({ title: string; subtitle?: string; action?: { label: string; onClick: () => void }; id?: string })`
  - `StatusBadge({ tone: 'success'|'warning'|'danger'|'info'|'neutral'; icon?: ReactNode | null; children })`
  - `KpiCard({ label: string; value: string; delta?: { text: string; direction: 'up'|'down'|'flat' }; children? })`
  - `AventaWordmark({ size?: number })`
  - CSS classes `.btn-cyan`, `.btn-outline-light`, `.ui-link`, `.ui-link--light`

No unit tests: the suite runs in Node without a DOM. These are verified by `npm run build` here and visually in Task 8.

- [ ] **Step 1: Create `src/styles/ui.css` (shared part)**

```css
/* The shared component layer for the revamp. Classes rather than inline styles
   so that hover, focus, breakpoints and reduced motion are real CSS. Colours
   come only from tokens in global.css, which contrast.test.ts holds to AA. */

:focus-visible { outline: 2px solid var(--electric); outline-offset: 2px; }

/* ---------- Buttons ---------- */
.btn-cyan { background: var(--cyan); color: var(--brand-navy); }
.btn-cyan:hover { background: #3ED8E8; transform: translateY(-1px); box-shadow: 0 8px 24px -6px rgba(18, 205, 224, 0.55); }
.btn-outline-light { background: rgba(255, 255, 255, 0.04); color: #fff; border-color: rgba(255, 255, 255, 0.5); }
.btn-outline-light:hover { background: rgba(255, 255, 255, 0.12); border-color: #fff; }

.ui-link {
  display: inline-flex; align-items: center; gap: 6px; padding: 0;
  background: none; border: none; cursor: pointer;
  font-size: var(--text-sm); font-weight: 600; color: var(--blue);
}
.ui-link:hover { text-decoration: underline; }
.ui-link--light { color: var(--cyan); }

/* ---------- Section header ---------- */
.ui-section { padding-block: 28px; }
.ui-section-header { display: flex; align-items: flex-end; justify-content: space-between; gap: 16px; flex-wrap: wrap; margin-bottom: 16px; }
.ui-section-title {
  position: relative; padding-left: 14px;
  font-size: var(--text-2xl); font-weight: 800; line-height: 1.2; letter-spacing: -0.01em; color: var(--text);
}
.ui-section-title::before {
  content: ''; position: absolute; left: 0; top: 4px; bottom: 4px; width: 4px;
  border-radius: 4px; background: var(--grad-cyan);
}
.ui-section-sub { margin-top: 4px; font-size: var(--text-sm); color: var(--text-secondary); }

/* ---------- Bento grid ---------- */
.bento { display: grid; gap: 16px; grid-template-columns: repeat(var(--bento-cols, 4), minmax(0, 1fr)); }
.bento > [data-span="2"] { grid-column: span 2; }
.bento > [data-span="3"] { grid-column: span 3; }
.bento > [data-rows="2"] { grid-row: span 2; }
.bento > * { min-width: 0; display: flex; }
.bento > * > * { flex: 1; }
@media (max-width: 1199px) {
  .bento { --bento-cols: 2 !important; }
  .bento > [data-span="3"] { grid-column: span 2; }
  .bento > [data-rows="2"] { grid-row: auto; }
}
@media (max-width: 767px) {
  .bento { --bento-cols: 1 !important; }
  .bento > [data-span] { grid-column: auto; }
}

/* ---------- Bento card ---------- */
.bento-card {
  position: relative; display: flex; flex-direction: column; min-width: 0;
  padding: 24px; border-radius: var(--radius-card); overflow: hidden;
  background: var(--bg-card); color: var(--text); box-shadow: var(--shadow-card);
}
.bento-card--interactive { transition: transform var(--transition), box-shadow var(--transition); }
.bento-card--interactive:hover { transform: translateY(-2px); box-shadow: var(--shadow-lift); }
.bento-card--dark { background: var(--grad-navy); color: #fff; }
.bento-card--image { background: var(--brand-navy); color: #fff; }
.bento-card__media { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
/* A floor for the copy: the artwork is arbitrary, so white text gets a navy
   wash it can rely on rather than a tint that happens to suit today's picture. */
.bento-card--image::after {
  content: ''; position: absolute; inset: 0;
  background: linear-gradient(90deg, rgba(3,19,43,0.95) 0%, rgba(3,19,43,0.84) 45%, rgba(3,19,43,0.3) 78%, rgba(3,19,43,0) 100%);
}
.bento-card__body { position: relative; z-index: 1; display: flex; flex-direction: column; gap: 8px; height: 100%; }
.bento-card__eyebrow { font-size: var(--text-sm); font-weight: 600; color: var(--cyan); }
.bento-card--light .bento-card__eyebrow { color: var(--blue); }
.bento-card__title { font-size: var(--text-xl); font-weight: 800; line-height: 1.2; letter-spacing: -0.01em; }
.bento-card__text { font-size: var(--text-sm); line-height: 1.5; color: rgba(255,255,255,0.86); }
.bento-card--light .bento-card__text { color: var(--text-secondary); }
.bento-card__action { margin-top: auto; padding-top: 8px; }

/* ---------- Status badge ---------- */
.status-badge {
  display: inline-flex; align-items: center; gap: 4px; padding: 2px 10px;
  border-radius: var(--radius-full); font-size: var(--text-xs); font-weight: 700; line-height: 1.6; white-space: nowrap;
}
.status-badge--success { background: var(--success-bg); color: var(--success); }
.status-badge--warning { background: var(--warning-bg); color: var(--warning); }
.status-badge--danger  { background: var(--danger-bg);  color: var(--danger); }
.status-badge--info    { background: var(--info-bg);    color: var(--info); }
.status-badge--neutral { background: var(--gray-100);   color: var(--text-secondary); }

/* ---------- KPI card ---------- */
.kpi-card { padding: 18px; gap: 4px; }
.kpi-card__label { font-size: var(--text-xs); font-weight: 600; color: var(--text-secondary); }
.kpi-card__value { font-size: var(--text-2xl); font-weight: 800; letter-spacing: -0.01em; color: var(--text); line-height: 1.2; }
.kpi-card__delta { font-size: var(--text-xs); font-weight: 700; color: var(--text-secondary); }
.kpi-card__delta--up { color: var(--success); }
.kpi-card__delta--down { color: var(--danger); }

/* ---------- Wordmark ---------- */
.aventa-wordmark { display: inline-flex; align-items: center; gap: 8px; color: #fff; font-weight: 600; letter-spacing: -0.01em; line-height: 1; }

/* ---------- Motion ---------- */
@media (prefers-reduced-motion: reduce) {
  .bento-card--interactive, .btn-cyan { transition: none; }
  .bento-card--interactive:hover, .btn-cyan:hover { transform: none; }
}
```

- [ ] **Step 2: Import it in `src/main.tsx`**

```ts
import './styles/global.css'
import './styles/ui.css'
```

- [ ] **Step 3: Write the components**

`src/components/ui/BentoGrid.tsx`:

```tsx
import type { CSSProperties, ReactNode } from 'react'

/** A bento grid: `cols` columns on desktop, two on tablet, one on a phone. */
export function BentoGrid({ cols = 4, className, children }: {
  cols?: number
  className?: string
  children: ReactNode
}) {
  return (
    <div className={['bento', className].filter(Boolean).join(' ')} style={{ '--bento-cols': cols } as CSSProperties}>
      {children}
    </div>
  )
}

/** One cell. `span` columns wide and `rows` rows tall on desktop; collapses below. */
export function BentoCell({ span = 1, rows = 1, children }: {
  span?: 1 | 2 | 3
  rows?: 1 | 2
  children: ReactNode
}) {
  return (
    <div data-span={span > 1 ? span : undefined} data-rows={rows > 1 ? rows : undefined}>
      {children}
    </div>
  )
}
```

`src/components/ui/BentoCard.tsx`:

```tsx
import type { ReactNode } from 'react'

export function BentoCard({
  variant = 'light', image, imagePosition, eyebrow, title, text, action,
  interactive = false, className, as: Tag = 'div', children,
}: {
  variant?: 'light' | 'dark' | 'image'
  image?: string
  imagePosition?: string
  eyebrow?: string
  title?: ReactNode
  text?: ReactNode
  action?: ReactNode
  interactive?: boolean
  className?: string
  as?: 'div' | 'article'
  children?: ReactNode
}) {
  const cls = [
    'bento-card', `bento-card--${variant}`,
    interactive && 'bento-card--interactive', className,
  ].filter(Boolean).join(' ')

  return (
    <Tag className={cls}>
      {variant === 'image' && image && (
        <img className="bento-card__media" src={image} alt="" loading="lazy"
          style={imagePosition ? { objectPosition: imagePosition } : undefined} />
      )}
      <div className="bento-card__body">
        {eyebrow && <div className="bento-card__eyebrow">{eyebrow}</div>}
        {title && <h3 className="bento-card__title">{title}</h3>}
        {text && <p className="bento-card__text">{text}</p>}
        {children}
        {action && <div className="bento-card__action">{action}</div>}
      </div>
    </Tag>
  )
}
```

`src/components/ui/SectionHeader.tsx`:

```tsx
import { ArrowRight } from 'lucide-react'

export function SectionHeader({ title, subtitle, action, id }: {
  title: string
  subtitle?: string
  action?: { label: string; onClick: () => void }
  id?: string
}) {
  return (
    <div className="ui-section-header">
      <div>
        <h2 className="ui-section-title" id={id}>{title}</h2>
        {subtitle && <p className="ui-section-sub">{subtitle}</p>}
      </div>
      {action && (
        <button className="ui-link" onClick={action.onClick}>
          {action.label} <ArrowRight size={14} aria-hidden />
        </button>
      )}
    </div>
  )
}
```

`src/components/ui/StatusBadge.tsx`:

```tsx
import type { ReactNode } from 'react'
import { CheckCircle2, AlertTriangle, XCircle, Info } from 'lucide-react'

type Tone = 'success' | 'warning' | 'danger' | 'info' | 'neutral'

/* A state never rests on colour alone: each tone carries its own shape. */
const ICON: Record<Tone, ReactNode> = {
  success: <CheckCircle2 size={12} aria-hidden />,
  warning: <AlertTriangle size={12} aria-hidden />,
  danger: <XCircle size={12} aria-hidden />,
  info: <Info size={12} aria-hidden />,
  neutral: null,
}

/** `icon` replaces the tone's shape; pass `null` where the words alone carry it. */
export function StatusBadge({ tone, icon, children }: {
  tone: Tone
  icon?: ReactNode | null
  children: ReactNode
}) {
  return (
    <span className={`status-badge status-badge--${tone}`}>
      {icon === undefined ? ICON[tone] : icon}
      {children}
    </span>
  )
}
```

`src/components/ui/KpiCard.tsx`:

```tsx
import type { ReactNode } from 'react'
import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react'

export function KpiCard({ label, value, delta, children }: {
  label: string
  value: string
  delta?: { text: string; direction: 'up' | 'down' | 'flat' }
  children?: ReactNode
}) {
  const Icon = delta?.direction === 'up' ? ArrowUpRight : delta?.direction === 'down' ? ArrowDownRight : Minus
  return (
    <div className="bento-card bento-card--light kpi-card">
      <div className="kpi-card__label">{label}</div>
      <div className="kpi-card__value">{value}</div>
      {delta && (
        <div className={`kpi-card__delta${delta.direction === 'flat' ? '' : ` kpi-card__delta--${delta.direction}`}`}>
          <Icon size={12} aria-hidden style={{ verticalAlign: '-2px' }} /> {delta.text}
        </div>
      )}
      {children}
    </div>
  )
}
```

`src/components/ui/AventaWordmark.tsx`:

```tsx
import { useId } from 'react'

/** The Aventa marketplace wordmark: a gradient "A" and the name. There is no
    Aventa logo file; the 6D mark beside it is the approved asset, never this. */
export function AventaWordmark({ size = 28 }: { size?: number }) {
  const g = useId()
  return (
    <span className="aventa-wordmark" style={{ fontSize: size * 0.82 }}>
      <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
        <defs>
          <linearGradient id={g} x1="0" y1="1" x2="1" y2="0">
            <stop offset="0" stopColor="#168BFF" />
            <stop offset="1" stopColor="#12CDE0" />
          </linearGradient>
        </defs>
        <path d="M16 2 L30 30 H22.5 L16 16.5 L9.5 30 H2 Z" fill={`url(#${g})`} />
        <path d="M11.5 24 H20.5" stroke="#061B3A" strokeWidth="2.2" strokeLinecap="round" />
      </svg>
      <span>Aventa</span>
    </span>
  )
}
```

`src/components/ui/index.ts`:

```ts
export { BentoGrid, BentoCell } from './BentoGrid'
export { BentoCard } from './BentoCard'
export { SectionHeader } from './SectionHeader'
export { StatusBadge } from './StatusBadge'
export { KpiCard } from './KpiCard'
export { AventaWordmark } from './AventaWordmark'
```

- [ ] **Step 4: Gates and commit**

Run: `npm test` and `npm run build` — pass.

```bash
git add src/styles/ui.css src/main.tsx src/components/ui
git commit -m "A shared layer for the bento look: grid, cards, headers, badges" -m "Class-based components so hover, focus, breakpoints and reduced motion live in CSS rather than in 5,900 inline styles. The KPI card is defined now and adopted by the operator console in spec 3, so all four specs share one vocabulary." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Category tile, product card and the network globe

**Files:**
- Modify: `src/styles/ui.css` (append)
- Create: `src/components/ui/categoryIcons.ts`, `CategoryTile.tsx`, `ProductCard.tsx`, `NetworkGlobe.tsx`
- Modify: `src/components/ui/index.ts`

**Interfaces:**
- Consumes: `Visual` from `src/lib/home.ts`; `StatusBadge`; `getProductImage` from `src/lib/images.ts`; `useMarket().fmt`.
- Produces:
  - `categoryIcon(id: string): LucideIcon`
  - `CategoryTile({ name: string; count?: number; visual: Visual | null; icon: LucideIcon; onClick: () => void })`
  - `ProductCard({ product: Product; onOpen: (p: Product) => void })`
  - `badgeTone(badge: string): 'success'|'warning'|'info'|'neutral'` (exported from `ProductCard.tsx`)
  - `NetworkGlobe()`

- [ ] **Step 1: Append the styles to `src/styles/ui.css`**

```css
/* ---------- Category tile ---------- */
.cat-row { display: grid; gap: 16px; grid-template-columns: repeat(var(--cat-cols, 6), minmax(0, 1fr)); }
@media (max-width: 1199px) { .cat-row { --cat-cols: 3 !important; } }
@media (max-width: 767px) {
  .cat-row { display: flex; overflow-x: auto; scroll-snap-type: x mandatory; padding-bottom: 8px; }
  .cat-row > * { flex: 0 0 72%; scroll-snap-align: start; }
}
.cat-tile {
  display: flex; flex-direction: column; width: 100%; padding: 0; border: none; text-align: left; cursor: pointer;
  background: var(--bg-card); border-radius: var(--radius-card); overflow: hidden; box-shadow: var(--shadow-card);
  transition: transform var(--transition), box-shadow var(--transition);
}
.cat-tile:hover { transform: translateY(-2px); box-shadow: var(--shadow-lift); }
.cat-tile__media {
  position: relative; aspect-ratio: 16 / 9; overflow: hidden;
  display: flex; align-items: center; justify-content: center;
  background: var(--grad-navy); color: rgba(255, 255, 255, 0.85);
}
.cat-tile__media img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; transition: transform var(--transition-slow); }
.cat-tile:hover .cat-tile__media img { transform: scale(1.04); }
.cat-tile__body { display: flex; align-items: center; gap: 12px; padding: 14px 16px; }
.cat-tile__name { font-size: var(--text-base); font-weight: 700; line-height: 1.3; color: var(--text); }
.cat-tile__count { font-size: var(--text-xs); color: var(--text-tertiary); }
.cat-tile__arrow {
  margin-left: auto; flex-shrink: 0; width: 32px; height: 32px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center; background: var(--bg-alt); color: var(--blue);
}

/* ---------- Product card ---------- */
.p-card {
  display: flex; flex-direction: column; min-width: 0; height: 100%; cursor: pointer;
  background: var(--bg-card); border-radius: var(--radius-card); overflow: hidden; box-shadow: var(--shadow-card);
  transition: transform var(--transition), box-shadow var(--transition);
}
.p-card:hover { transform: translateY(-2px); box-shadow: var(--shadow-lift); }
.p-card__media { position: relative; aspect-ratio: 4 / 3; background: var(--bg-alt); }
.p-card__media img { width: 100%; height: 100%; object-fit: cover; }
.p-card__badge { position: absolute; top: 10px; right: 10px; }
.p-card__body { display: flex; flex-direction: column; gap: 4px; flex: 1; padding: 14px 16px 16px; }
.p-card__name { font-size: var(--text-sm); font-weight: 700; line-height: 1.35; color: var(--text); }
.p-card__seller { font-size: var(--text-xs); color: var(--text-tertiary); }
.p-card__desc {
  font-size: var(--text-xs); line-height: 1.5; color: var(--text-secondary);
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
}
.p-card__rating { display: flex; align-items: center; gap: 4px; font-size: var(--text-xs); color: var(--text-secondary); }
.p-card__foot { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; margin-top: auto; padding-top: 10px; flex-wrap: wrap; }
.p-card__price { font-size: var(--text-lg); font-weight: 800; color: var(--text); }
.p-card__unit { font-size: var(--text-xs); font-weight: 500; color: var(--text-tertiary); margin-left: 4px; }

/* ---------- Network globe ---------- */
.globe { position: relative; aspect-ratio: 560 / 440; pointer-events: none; }
.globe svg { position: absolute; inset: 0; width: 100%; height: 100%; }
.globe-arc { fill: none; stroke-width: 1.6; stroke-linecap: round; stroke-dasharray: 6 10; animation: globe-flow 6s linear infinite; }
.globe-halo { transform-box: fill-box; transform-origin: center; animation: globe-pulse 2.8s ease-out infinite; }
.globe-ring {
  position: absolute; width: 12%; aspect-ratio: 1; border-radius: 50%;
  display: flex; align-items: center; justify-content: center; color: #fff;
  border: 1.5px solid rgba(127, 233, 244, 0.7);
  background: radial-gradient(circle, rgba(18, 205, 224, 0.22), rgba(6, 27, 58, 0.65));
  box-shadow: 0 0 24px rgba(18, 205, 224, 0.45), inset 0 0 12px rgba(18, 205, 224, 0.3);
  animation: globe-float 7s ease-in-out infinite;
}
.globe-ring svg { position: static; width: 46%; height: 46%; }
@keyframes globe-flow { to { stroke-dashoffset: -160; } }
@keyframes globe-pulse { 0% { transform: scale(0.6); opacity: 0.55; } 100% { transform: scale(2.4); opacity: 0; } }
@keyframes globe-float { 50% { transform: translateY(-6px); } }
@media (max-width: 767px), (prefers-reduced-motion: reduce) {
  .globe-arc, .globe-halo, .globe-ring { animation: none; }
}
@media (prefers-reduced-motion: reduce) {
  .cat-tile, .p-card, .cat-tile__media img { transition: none; }
  .cat-tile:hover, .p-card:hover { transform: none; }
  .cat-tile:hover .cat-tile__media img { transform: none; }
}
```

- [ ] **Step 2: Write `src/components/ui/categoryIcons.ts`**

```ts
import { Signal, Smartphone, PlayCircle, Cpu, ShieldCheck, Handshake, Package, type LucideIcon } from 'lucide-react'

/* Keyed on the category id, which is stable, rather than the free-text `icon`
   column. A shelf added later gets the generic package. */
const ICONS: Record<string, LucideIcon> = {
  consumer: Signal, device: Smartphone, content: PlayCircle,
  iot: Cpu, security: ShieldCheck, partner: Handshake,
}

export function categoryIcon(id: string): LucideIcon {
  return ICONS[id] ?? Package
}
```

- [ ] **Step 3: Write `src/components/ui/CategoryTile.tsx`**

```tsx
import { useState } from 'react'
import { ArrowRight, type LucideIcon } from 'lucide-react'
import type { Visual } from '../../lib/home'

export function CategoryTile({ name, count, visual, icon: Icon, onClick }: {
  name: string
  /** Omitted when the catalogue did not load: no count beats a wrong one. */
  count?: number
  visual: Visual | null
  icon: LucideIcon
  onClick: () => void
}) {
  const [broken, setBroken] = useState(false)
  const showImage = visual && !broken
  return (
    <button className="cat-tile" onClick={onClick}>
      <div className="cat-tile__media">
        {showImage
          ? <img src={visual.src} alt="" loading="lazy" onError={() => setBroken(true)}
              style={visual.position ? { objectPosition: visual.position } : undefined} />
          : <Icon size={40} aria-hidden />}
      </div>
      <div className="cat-tile__body">
        <div>
          <div className="cat-tile__name">{name}</div>
          {count !== undefined && (
            <div className="cat-tile__count">{count} {count === 1 ? 'product' : 'products'}</div>
          )}
        </div>
        <span className="cat-tile__arrow" aria-hidden><ArrowRight size={16} /></span>
      </div>
    </button>
  )
}
```

- [ ] **Step 4: Write `src/components/ui/ProductCard.tsx`**

```tsx
import { Star, ArrowRight } from 'lucide-react'
import type { Product } from '../../types'
import { getProductImage } from '../../lib/images'
import { useMarket } from '../../lib/MarketContext'
import { StatusBadge } from './StatusBadge'

/** The colour family for a catalogue badge. The words are the operator's;
    this only picks the tint, and the text carries the meaning. */
export function badgeTone(badge: string): 'success' | 'warning' | 'info' | 'neutral' {
  const b = badge.toLowerCase()
  if (b.includes('best') || b.includes('popular')) return 'warning'
  if (b.includes('new')) return 'success'
  if (b.includes('bundle') || b.includes('recommend')) return 'info'
  return 'neutral'
}

/* A real catalogue row: its own photograph, name, seller, description, price in
   the visitor's currency, and rating only when buyers have left one. The whole
   card opens the product; it is a real control, reachable by keyboard. */
export function ProductCard({ product: p, onOpen }: {
  product: Product
  onOpen: (p: Product) => void
}) {
  const { fmt } = useMarket()
  return (
    <article
      className="p-card"
      role="button"
      tabIndex={0}
      aria-label={`${p.name} — view details`}
      onClick={() => onOpen(p)}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(p) } }}
    >
      <div className="p-card__media">
        <img src={getProductImage(p.id)} alt="" loading="lazy" />
        {p.badge && (
          <span className="p-card__badge">
            <StatusBadge tone={badgeTone(p.badge)} icon={null}>{p.badge}</StatusBadge>
          </span>
        )}
      </div>
      <div className="p-card__body">
        <div className="p-card__name">{p.name}</div>
        <div className="p-card__seller">{p.seller}</div>
        {p.description && <p className="p-card__desc">{p.description}</p>}
        {p.rating !== null && (
          <div className="p-card__rating">
            <Star size={12} fill="currentColor" style={{ color: 'var(--brand-gold)' }} aria-hidden />
            {p.rating.toFixed(1)} <span style={{ color: 'var(--text-tertiary)' }}>({p.reviews})</span>
          </div>
        )}
        <div className="p-card__foot">
          <span className="p-card__price">
            {fmt(p.price)}{p.unit && <span className="p-card__unit">{p.unit}</span>}
          </span>
          <span className="ui-link" aria-hidden>View details <ArrowRight size={14} /></span>
        </div>
      </div>
    </article>
  )
}
```

- [ ] **Step 5: Write `src/components/ui/NetworkGlobe.tsx`**

```tsx
import { useId } from 'react'
import { RadioTower, Cloud, ShieldCheck, Smartphone, Cpu } from 'lucide-react'

const CX = 300, CY = 225, R = 170

/* A seeded generator so the "city lights" are the same on every render and in
   every screenshot. */
function lcg(seed: number) {
  let s = seed
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296 }
}

/* Dots clustered into loose continents: a point is kept where a smooth field
   is high, so they read as land masses rather than noise. */
const DOTS = (() => {
  const rand = lcg(7)
  const out: { x: number; y: number; o: number }[] = []
  while (out.length < 320) {
    const a = rand() * Math.PI * 2, d = Math.sqrt(rand()) * R * 0.96
    const x = CX + Math.cos(a) * d, y = CY + Math.sin(a) * d
    const field = Math.sin(x * 0.045) + Math.cos(y * 0.06 + x * 0.02)
    if (field > 0.35) out.push({ x, y, o: 0.35 + rand() * 0.65 })
  }
  return out
})()

const NODES: [number, number][] = [
  [228, 150], [330, 118], [392, 196], [268, 252], [356, 300], [205, 318], [420, 258], [300, 190],
]
const LINKS: [number, number][] = [[0, 1], [1, 2], [0, 3], [3, 4], [2, 6], [5, 3], [7, 4], [1, 7], [6, 4]]

function arc([x1, y1]: [number, number], [x2, y2]: [number, number]): string {
  const mx = (x1 + x2) / 2, my = (y1 + y2) / 2
  const cx = mx + (mx - CX) * 0.7, cy = my + (my - CY) * 0.7 - 18
  return `M${x1},${y1} Q${cx},${cy} ${x2},${y2}`
}

const RINGS = [
  { Icon: RadioTower, left: '64%', top: '2%', delay: '0s' },
  { Icon: Cloud, left: '84%', top: '20%', delay: '1.2s' },
  { Icon: ShieldCheck, left: '78%', top: '45%', delay: '2.4s' },
  { Icon: Smartphone, left: '66%', top: '68%', delay: '0.6s' },
  { Icon: Cpu, left: '84%', top: '72%', delay: '1.8s' },
]

/** The hero's connected-globe artwork. Decorative, so hidden from assistive tech. */
export function NetworkGlobe() {
  const id = useId().replace(/:/g, '')
  return (
    <div className="globe" aria-hidden>
      <svg viewBox="0 0 560 440">
        <defs>
          <radialGradient id={`${id}-fill`} cx="38%" cy="32%" r="75%">
            <stop offset="0" stopColor="#0E4C8F" />
            <stop offset="0.55" stopColor="#061B3A" />
            <stop offset="1" stopColor="#03132B" />
          </radialGradient>
          <radialGradient id={`${id}-glow`} cx="50%" cy="50%" r="50%">
            <stop offset="0.6" stopColor="#12CDE0" stopOpacity="0.28" />
            <stop offset="1" stopColor="#12CDE0" stopOpacity="0" />
          </radialGradient>
          <linearGradient id={`${id}-arc`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#168BFF" />
            <stop offset="1" stopColor="#7FE9F4" />
          </linearGradient>
        </defs>

        <circle cx={CX} cy={CY} r={R + 34} fill={`url(#${id}-glow)`} />
        <circle cx={CX} cy={CY} r={R} fill={`url(#${id}-fill)`} stroke="rgba(127,233,244,0.35)" />

        <g fill="none" stroke="rgba(127,190,255,0.16)">
          {[-60, -30, 0, 30, 60].map(lat => {
            const r = Math.cos((lat * Math.PI) / 180) * R
            return <ellipse key={`lat${lat}`} cx={CX} cy={CY + Math.sin((lat * Math.PI) / 180) * R} rx={r} ry={r * 0.22} />
          })}
          {[25, 55, 80].map(lon => (
            <ellipse key={`lon${lon}`} cx={CX} cy={CY} rx={Math.sin((lon * Math.PI) / 180) * R} ry={R} />
          ))}
        </g>

        <g fill="#7FE9F4">
          {DOTS.map((d, i) => <circle key={i} cx={d.x} cy={d.y} r={1.2} opacity={d.o} />)}
        </g>

        <g stroke={`url(#${id}-arc)`}>
          {LINKS.map(([a, b], i) => (
            <path key={i} className="globe-arc" d={arc(NODES[a], NODES[b])} style={{ animationDelay: `${i * -0.7}s` }} />
          ))}
        </g>

        {NODES.map(([x, y], i) => (
          <g key={i}>
            <circle className="globe-halo" cx={x} cy={y} r={6} fill="#12CDE0" style={{ animationDelay: `${i * 0.35}s` }} />
            <circle cx={x} cy={y} r={2.8} fill="#E6FBFE" />
          </g>
        ))}
      </svg>

      {RINGS.map(({ Icon, left, top, delay }) => (
        <span key={left + top} className="globe-ring" style={{ left, top, animationDelay: delay }}>
          <Icon strokeWidth={1.75} />
        </span>
      ))}
    </div>
  )
}
```

- [ ] **Step 6: Export them**

Append to `src/components/ui/index.ts`:

```ts
export { CategoryTile } from './CategoryTile'
export { ProductCard, badgeTone } from './ProductCard'
export { NetworkGlobe } from './NetworkGlobe'
export { categoryIcon } from './categoryIcons'
```

- [ ] **Step 7: Gates and commit**

Run: `npm test` and `npm run build` — pass.

```bash
git add src/styles/ui.css src/components/ui
git commit -m "Category tiles, product cards and the network globe" -m "The tile falls back to a gradient and the shelf's icon when a picture is missing or fails to load. The product card prints the row as it is, with a rating only when buyers have left one. The globe is SVG, seeded so it draws the same every time, and still under reduced motion and on phones." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Header, Discover menu and footer

**Files:**
- Modify: `src/styles/ui.css` (append)
- Create: `src/components/public/DiscoverMenu.tsx`
- Modify: `src/components/public/PublicShell.tsx` (whole file)

**Interfaces:**
- Consumes: `loadCategories`, `loadCatalogue` (`src/lib/storefrontRepo.ts`); `tileCount` (`src/lib/home.ts`); `categoryDestination` (`src/lib/storefront.ts`); `categoryIcon`, `AventaWordmark`.
- Produces: `DiscoverMenu({ onNavigate: (p: PublicPage) => void; onDone?: () => void })`. `PublicShell`'s props are unchanged.

- [ ] **Step 1: Append header and footer styles to `src/styles/ui.css`**

```css
/* ---------- Public header ---------- */
.site-header { position: sticky; top: 0; z-index: 100; background: var(--brand-navy); border-bottom: 1px solid rgba(255, 255, 255, 0.08); }
.site-header__bar { position: relative; display: flex; align-items: center; gap: 20px; height: 64px; }
.site-header__brand { display: flex; align-items: center; gap: 14px; flex-shrink: 0; padding: 0; background: none; border: none; cursor: pointer; }
.site-header__divider { width: 1px; height: 28px; background: rgba(255, 255, 255, 0.2); }
.site-nav { display: flex; align-items: center; gap: 4px; flex: 1; }
.site-nav__item {
  display: inline-flex; align-items: center; gap: 4px; padding: 8px 12px; border: none; border-radius: var(--radius);
  background: transparent; color: rgba(255, 255, 255, 0.86); font-size: var(--text-sm); font-weight: 600; cursor: pointer;
  transition: background var(--transition);
}
.site-nav__item:hover { background: rgba(255, 255, 255, 0.08); color: #fff; }
.site-nav__item[aria-current="page"], .site-nav__item[aria-expanded="true"] { background: rgba(255, 255, 255, 0.14); color: #fff; }
.site-header__end { display: flex; align-items: center; gap: 12px; flex-shrink: 0; margin-left: auto; }
.site-header__menu-btn { display: none; color: #fff; padding: 8px; border-radius: var(--radius); }
.site-header__menu-btn:hover { background: rgba(255, 255, 255, 0.08); }
@media (max-width: 899px) {
  .site-nav { display: none; }
  .site-nav.is-open {
    display: flex; position: absolute; top: 64px; left: 0; right: 0; flex-direction: column; align-items: stretch;
    padding: 12px 16px 16px; background: var(--brand-navy); border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  }
  .site-header__menu-btn { display: inline-flex; }
}
@media (max-width: 520px) { .site-header__divider, .site-header__6d { display: none; } }

.discover { position: relative; }
.discover__panel {
  position: absolute; top: calc(100% + 8px); left: 0; z-index: 110; width: min(560px, 90vw);
  display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 4px; padding: 12px;
  background: var(--bg-card); border-radius: var(--radius-card); box-shadow: var(--shadow-xl);
  animation: fadeIn var(--transition) ease-out;
}
@media (max-width: 899px) { .discover__panel { position: static; width: 100%; grid-template-columns: 1fr; margin-top: 4px; box-shadow: none; } }
.discover__item {
  display: flex; align-items: flex-start; gap: 12px; padding: 10px 12px; border: none; border-radius: var(--radius-md);
  background: none; color: var(--text); text-align: left; cursor: pointer;
}
.discover__item:hover { background: var(--bg-alt); }
.discover__icon {
  flex-shrink: 0; width: 36px; height: 36px; border-radius: 10px; display: flex; align-items: center; justify-content: center;
  background: linear-gradient(135deg, rgba(22, 139, 255, 0.12), rgba(18, 205, 224, 0.16)); color: var(--blue);
}
.discover__name { font-size: var(--text-sm); font-weight: 700; }
.discover__meta { font-size: var(--text-xs); color: var(--text-tertiary); line-height: 1.4; }
@media (prefers-reduced-motion: reduce) { .discover__panel { animation: none; } }

/* ---------- Public footer ---------- */
.site-footer { background: var(--brand-navy-dark); color: rgba(255, 255, 255, 0.72); }
.site-footer__heading { margin: 0 0 12px; font-size: var(--text-xs); font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: rgba(255, 255, 255, 0.6); }
```

- [ ] **Step 2: Write `src/components/public/DiscoverMenu.tsx`**

```tsx
import { useEffect, useRef, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import type { Category, Product } from '../../types'
import type { PublicPage } from '../../types/view'
import { loadCategories, loadCatalogue } from '../../lib/storefrontRepo'
import { categoryDestination } from '../../lib/storefront'
import { tileCount } from '../../lib/home'
import { categoryIcon } from '../ui/categoryIcons'

/* The header's category panel. Read on first open rather than on every page,
   because most visitors never open it. Empty categories hide the panel's
   contents rather than showing a box with nothing in it. */
export function DiscoverMenu({ onNavigate, onDone }: {
  onNavigate: (p: PublicPage) => void
  onDone?: () => void
}) {
  const [open, setOpen] = useState(false)
  const [categories, setCategories] = useState<Category[] | null>(null)
  const [catalogue, setCatalogue] = useState<Product[]>([])
  const root = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open || categories) return
    loadCategories().then(setCategories)
    loadCatalogue().then(setCatalogue)
  }, [open, categories])

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false) }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey) }
  }, [open])

  const go = (c: Category) => { setOpen(false); onDone?.(); onNavigate(categoryDestination(c)) }

  return (
    <div className="discover" ref={root}>
      <button className="site-nav__item" aria-expanded={open} aria-haspopup="true" onClick={() => setOpen(o => !o)}>
        Discover <ChevronDown size={14} aria-hidden />
      </button>
      {open && categories && categories.length > 0 && (
        <div className="discover__panel" role="menu" aria-label="Categories">
          {categories.map(c => {
            const Icon = categoryIcon(c.id)
            const n = catalogue.length ? tileCount(c, catalogue) : null
            return (
              <button key={c.id} className="discover__item" role="menuitem" onClick={() => go(c)}>
                <span className="discover__icon"><Icon size={18} aria-hidden /></span>
                <span>
                  <span className="discover__name">{c.name}</span>
                  <span className="discover__meta" style={{ display: 'block' }}>
                    {n !== null ? `${n} ${n === 1 ? 'product' : 'products'} · ` : ''}{c.audience}
                  </span>
                </span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 3: Rewrite `src/components/public/PublicShell.tsx`**

Keep `NAV`, `FOOTER_MENU` and `FooterGroup` (lines 1–52) exactly as they are, except `FooterGroup`'s `<h2>`: replace its inline `style` with `className="site-footer__heading"`. Add these imports to the top:

```ts
import { useState } from 'react'
import { Menu, X } from 'lucide-react'
import { DiscoverMenu } from './DiscoverMenu'
import { AventaWordmark } from '../ui/AventaWordmark'
```

Replace the `PublicShell` function (lines 54–158) with:

```tsx
export function PublicShell({ page, onNavigate, onDemoSignIn, children }: {
  page: PublicPage
  onNavigate: (p: PublicPage) => void
  onDemoSignIn: () => void
  children: React.ReactNode
}) {
  /* Sorted the way the markets table orders them, so the footer, the storefront
     picker and the operator's own screen list them in one order. */
  const { book } = useMarket()
  const regions = [...book.markets].sort((a, b) => a.sort_order - b.sort_order)
  const [menuOpen, setMenuOpen] = useState(false)
  const go = (p: PublicPage) => { setMenuOpen(false); onNavigate(p) }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', background: 'var(--bg-alt)' }}>
      <header className="site-header">
        <div className="container site-header__bar">
          <button className="site-header__brand" onClick={() => go('landing')} aria-label="Aventa marketplace — home">
            <img className="site-header__6d" src="/assets/brand/6d-logo-white.png" alt="" style={{ height: '30px' }} />
            <span className="site-header__divider" aria-hidden />
            <AventaWordmark size={26} />
          </button>

          <nav className={`site-nav${menuOpen ? ' is-open' : ''}`} aria-label="Marketplace">
            <DiscoverMenu onNavigate={go} onDone={() => setMenuOpen(false)} />
            {NAV.map(n => (
              <button key={n.id} className="site-nav__item" onClick={() => go(n.id)}
                aria-current={page === n.id ? 'page' : undefined}>
                {n.label}
              </button>
            ))}
          </nav>

          <div className="site-header__end">
            {/* A visitor has no account and so no home market — this is the one
                surface where the choice is genuinely free, and it is the surface
                most people meet first. */}
            <MarketPicker />
            <button className="btn btn-sm btn-outline-light" onClick={onDemoSignIn}>Sign in</button>
            <button className="site-header__menu-btn" aria-label={menuOpen ? 'Close menu' : 'Open menu'}
              aria-expanded={menuOpen} onClick={() => setMenuOpen(o => !o)}>
              {menuOpen ? <X size={20} /> : <Menu size={20} />}
            </button>
          </div>
        </div>
      </header>

      <main style={{ flex: 1 }}>{children}</main>

      {/* The site menu repeats here so someone who has read to the bottom of a long
          page can move on without scrolling back up. Sign-in is deliberately not
          among them — it lives in the header, and one way in is enough. */}
      <footer className="site-footer">
        <div className="container" style={{ paddingTop: '48px', paddingBottom: '32px', display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: '32px' }}>
          <div style={{ minWidth: '220px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
              <img src="/assets/brand/6d-logo-white.png" alt="" style={{ height: '26px', opacity: 0.9 }} />
              <span className="site-header__divider" aria-hidden />
              <AventaWordmark size={22} />
            </div>
            <p style={{ fontSize: 'var(--text-sm)', margin: '14px 0 0', maxWidth: '300px', lineHeight: 1.6 }}>
              One connected marketplace — devices, connectivity, security and IoT from verified
              partners, one checkout, one settlement cycle.
            </p>
          </div>

          <nav aria-label="Site menu" style={{ display: 'flex', gap: '48px', flexWrap: 'wrap' }}>
            <FooterGroup heading="Marketplace" items={FOOTER_MENU} page={page} onNavigate={go} />
            <div>
              <h2 className="site-footer__heading">Regions</h2>
              <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {/* Read from the markets table, not typed. */}
                {regions.map(r => (
                  <li key={r.code} style={{ fontSize: 'var(--text-sm)' }}>{r.name}</li>
                ))}
              </ul>
            </div>
          </nav>
        </div>

        <div className="container" style={{ paddingBottom: '28px' }}>
          <span style={{ fontSize: 'var(--text-sm)', color: 'rgba(255,255,255,0.6)' }}>
            © 2026 6D Technologies · Aventa{regions.length > 0 && ` · ${marketProse(regions, { conjunction: '', separator: ' · ' })}`}
          </span>
        </div>
      </footer>
    </div>
  )
}
```

- [ ] **Step 4: Gates and commit**

Run: `npm test` and `npm run build` — pass.

```bash
git add src/styles/ui.css src/components/public/DiscoverMenu.tsx src/components/public/PublicShell.tsx
git commit -m "A header that shows the shelves, and a menu that works on a phone" -m "Discover opens the real categories with their live counts, read on first open. Retail, Enterprise and Partners stay where they were; the market picker and sign-in are unchanged. Below 900px the navigation folds into a menu button. The footer carries the same menu and the regions from the markets table." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: The homepage

**Files:**
- Modify: `src/styles/ui.css` (append)
- Create: `src/components/public/home/HomeHero.tsx`, `CategorySection.tsx`, `FeaturedSection.tsx`, `WhyAventa.tsx`, `EcosystemStrip.tsx`
- Modify: `src/components/public/LandingPage.tsx` (whole file), `src/components/public/PromoStrip.tsx`, `src/App.tsx:421`
- Delete: `src/components/public/CategoryRail.tsx`

**Interfaces:**
- Consumes: everything in Tasks 2–6; `PublicProductModal({ product, onClose, onAddToBasket })`.
- Produces: `LandingPage({ onNavigate: (p: PublicPage) => void; onAddToBasket: (p: Product) => void })`.

- [ ] **Step 1: Append homepage styles to `src/styles/ui.css`**

```css
/* ---------- Homepage ---------- */
.home-band { padding-block: 24px; }
.home-band:first-child { padding-top: 20px; }

.hero-main { min-height: 440px; padding: clamp(24px, 4vw, 48px); justify-content: center; }
/* The globe sits inside the card body but is placed against the card itself,
   so the body is static here and only the copy is lifted above the artwork. */
.hero-main .bento-card__body { position: static; max-width: 54%; justify-content: center; gap: 18px; }
.hero-main .bento-card__body > :not(.hero-art) { position: relative; z-index: 1; }
.hero-eyebrow {
  align-self: flex-start; display: inline-flex; align-items: center; gap: 8px; padding: 6px 14px;
  border-radius: var(--radius-full); border: 1px solid rgba(18, 205, 224, 0.35); background: rgba(18, 205, 224, 0.12);
  color: var(--cyan); font-size: var(--text-sm); font-weight: 600;
}
.hero-title { font-size: clamp(2.25rem, 4.4vw, 3.5rem); font-weight: 800; line-height: 1.05; letter-spacing: -0.025em; }
.hero-title__accent { background: var(--grad-cyan); -webkit-background-clip: text; background-clip: text; color: transparent; }
.hero-lede { font-size: var(--text-lg); line-height: 1.55; color: rgba(255, 255, 255, 0.84); }
.hero-ctas { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 6px; }
.hero-art { position: absolute; right: -24px; top: 50%; transform: translateY(-50%); width: min(58%, 640px); }
.hero-side { min-height: 212px; }
.hero-side .bento-card__body { max-width: 62%; }
@media (max-width: 1199px) { .hero-main .bento-card__body { max-width: 60%; } }
@media (max-width: 767px) {
  .hero-main { min-height: 0; }
  .hero-main .bento-card__body, .hero-side .bento-card__body { max-width: 100%; }
  .hero-art { position: relative; right: auto; top: auto; transform: none; width: 100%; margin-top: 8px; }
}

.why-tile { align-items: flex-start; gap: 10px; padding: 20px; }
.why-tile__icon {
  width: 44px; height: 44px; border-radius: 12px; display: flex; align-items: center; justify-content: center;
  background: linear-gradient(135deg, rgba(22, 139, 255, 0.12), rgba(18, 205, 224, 0.18)); color: var(--blue);
}
.why-tile__title { font-size: var(--text-base); font-weight: 700; color: var(--text); }
.why-tile__text { font-size: var(--text-sm); color: var(--text-secondary); line-height: 1.5; }

.eco-strip {
  display: flex; align-items: center; gap: 24px; flex-wrap: wrap; padding: 20px 24px;
  background: var(--bg-card); border-radius: var(--radius-card); box-shadow: var(--shadow-card);
}
.eco-strip__label { font-size: var(--text-sm); font-weight: 700; color: var(--text); white-space: nowrap; }
.eco-strip__list { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 0; list-style: none; margin: 0; padding: 0; }
.eco-strip__item {
  padding: 0 20px; border-left: 1px solid var(--border); font-size: var(--text-base); font-weight: 700;
  letter-spacing: -0.01em; color: var(--text-secondary);
}
.eco-strip__item:first-child { border-left: none; padding-left: 0; }

.promo-row { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
.promo-tile {
  position: relative; display: block; width: 100%; padding: 0; border: none; cursor: pointer; text-align: left;
  aspect-ratio: 1000 / 240; border-radius: var(--radius-card); overflow: hidden; background: var(--brand-navy);
  box-shadow: var(--shadow-card); transition: transform var(--transition), box-shadow var(--transition);
}
.promo-tile:hover { transform: translateY(-2px); box-shadow: var(--shadow-lift); }
@media (max-width: 767px) { .promo-row { grid-template-columns: 1fr; } }
@media (prefers-reduced-motion: reduce) { .promo-tile { transition: none; } .promo-tile:hover { transform: none; } }
```

- [ ] **Step 2: Write `src/components/public/home/HomeHero.tsx`**

```tsx
import { ArrowRight, Zap } from 'lucide-react'
import type { PublicPage } from '../../../types/view'
import { BentoGrid, BentoCell, BentoCard, NetworkGlobe } from '../../ui'
import { HOME_ART } from '../../../lib/home'

export function HomeHero({ markets, onNavigate }: {
  /** The live market list as prose, e.g. "India, Kenya and the UAE"; empty hides the clause. */
  markets: string
  onNavigate: (p: PublicPage) => void
}) {
  return (
    <section className="container home-band" aria-label="Welcome">
      <BentoGrid cols={3}>
        <BentoCell span={2} rows={2}>
          <BentoCard variant="dark" className="hero-main">
            <span className="hero-eyebrow"><Zap size={14} aria-hidden /> The complete telecom marketplace</span>
            <h1 className="hero-title">
              One marketplace.<br /><span className="hero-title__accent">Every kind of buyer.</span>
            </h1>
            <p className="hero-lede">
              Discover devices, connectivity, digital services, security and IoT solutions from a
              connected ecosystem{markets ? ` — across ${markets}` : ''}.
            </p>
            <div className="hero-ctas">
              <button className="btn btn-lg btn-cyan" onClick={() => onNavigate('retail')}>
                Shop Retail <ArrowRight size={16} aria-hidden />
              </button>
              <button className="btn btn-lg btn-outline-light" onClick={() => onNavigate('enterprise')}>
                Explore Enterprise <ArrowRight size={16} aria-hidden />
              </button>
              <button className="btn btn-lg btn-outline-light" onClick={() => onNavigate('partner')}>
                Become a Partner <ArrowRight size={16} aria-hidden />
              </button>
            </div>
            <div className="hero-art"><NetworkGlobe /></div>
          </BentoCard>
        </BentoCell>

        <BentoCell>
          <BentoCard
            variant="image" image={HOME_ART.business} imagePosition="right center" className="hero-side"
            eyebrow="For Businesses" title="Accelerate your digital transformation"
            text="Connectivity, IoT and security for your estate, on contract terms."
            action={<button className="ui-link ui-link--light" onClick={() => onNavigate('enterprise')}>
              Explore Enterprise <ArrowRight size={14} aria-hidden /></button>}
          />
        </BentoCell>
        <BentoCell>
          <BentoCard
            variant="image" image={HOME_ART.partners} imagePosition="right center" className="hero-side"
            eyebrow="For Partners" title="Grow together with 6D"
            text="List your products and reach every buyer on the marketplace."
            action={<button className="ui-link ui-link--light" onClick={() => onNavigate('partner')}>
              Become a Partner <ArrowRight size={14} aria-hidden /></button>}
          />
        </BentoCell>
      </BentoGrid>
    </section>
  )
}
```

- [ ] **Step 3: Write `src/components/public/home/CategorySection.tsx`**

```tsx
import { useId, type CSSProperties } from 'react'
import type { Category, Product } from '../../../types'
import type { PublicPage } from '../../../types/view'
import { categoryDestination } from '../../../lib/storefront'
import { categoryVisual, tileCount } from '../../../lib/home'
import { SectionHeader, CategoryTile, categoryIcon } from '../../ui'

export function CategorySection({ categories, catalogue, onNavigate }: {
  categories: readonly Category[]
  catalogue: readonly Product[]
  onNavigate: (p: PublicPage) => void
}) {
  const headingId = useId()
  if (categories.length === 0) return null
  const sorted = [...categories].sort((a, b) => a.sort_order - b.sort_order)

  return (
    <section className="container home-band" aria-labelledby={headingId}>
      <SectionHeader id={headingId} title="Explore by category" subtitle="Find the right solutions for your needs" />
      <div className="cat-row" style={{ '--cat-cols': Math.min(sorted.length, 6) } as CSSProperties}>
        {sorted.map(c => (
          <CategoryTile
            key={c.id}
            name={c.name}
            count={catalogue.length ? tileCount(c, catalogue) : undefined}
            visual={categoryVisual(c.id)}
            icon={categoryIcon(c.id)}
            onClick={() => onNavigate(categoryDestination(c))}
          />
        ))}
      </div>
    </section>
  )
}
```

- [ ] **Step 4: Write `src/components/public/home/FeaturedSection.tsx`**

```tsx
import { useId } from 'react'
import { ArrowRight } from 'lucide-react'
import type { Product } from '../../../types'
import type { PublicPage } from '../../../types/view'
import { HOME_ART } from '../../../lib/home'
import { BentoGrid, BentoCell, BentoCard, SectionHeader, ProductCard } from '../../ui'

export function FeaturedSection({ products, onOpen, onNavigate }: {
  products: readonly Product[]
  onOpen: (p: Product) => void
  onNavigate: (p: PublicPage) => void
}) {
  const headingId = useId()
  if (products.length === 0) return null

  return (
    <section className="container home-band" aria-labelledby={headingId}>
      <SectionHeader id={headingId} title="Featured products"
        action={{ label: 'View all products', onClick: () => onNavigate('retail') }} />
      <BentoGrid cols={6}>
        {products.map(p => (
          <BentoCell key={p.id}><ProductCard product={p} onOpen={onOpen} /></BentoCell>
        ))}
        <BentoCell span={2}>
          <BentoCard
            variant="image" image={HOME_ART.promo} imagePosition="center"
            title="Power your business with Aventa"
            text="Innovative telecom solutions for a connected future."
            action={<button className="btn btn-cyan" onClick={() => onNavigate('enterprise')}>
              Learn more <ArrowRight size={14} aria-hidden /></button>}
          />
        </BentoCell>
      </BentoGrid>
    </section>
  )
}
```

- [ ] **Step 5: Write `src/components/public/home/WhyAventa.tsx`**

```tsx
import { useId } from 'react'
import { Zap, ShieldCheck, Globe2, Sparkles, type LucideIcon } from 'lucide-react'
import { BentoGrid, BentoCell, SectionHeader } from '../../ui'

const REASONS: { icon: LucideIcon; title: string; text: string }[] = [
  { icon: Zap, title: 'Faster time to market', text: 'List once and sell to retail, business and reseller buyers.' },
  { icon: ShieldCheck, title: 'Enterprise-grade security', text: 'Verified sellers, reviewed listings and governed settlement.' },
  { icon: Globe2, title: 'Global reach', text: 'Priced and settled for every market the marketplace runs in.' },
  { icon: Sparkles, title: 'Seamless experience', text: 'One basket, one checkout and one bill across every seller.' },
]

export function WhyAventa() {
  const headingId = useId()
  return (
    <section className="container home-band" aria-labelledby={headingId}>
      <SectionHeader id={headingId} title="Why Aventa?" />
      <BentoGrid cols={4}>
        {REASONS.map(({ icon: Icon, title, text }) => (
          <BentoCell key={title}>
            <div className="bento-card bento-card--light why-tile">
              <span className="why-tile__icon"><Icon size={22} aria-hidden /></span>
              <h3 className="why-tile__title">{title}</h3>
              <p className="why-tile__text">{text}</p>
            </div>
          </BentoCell>
        ))}
      </BentoGrid>
    </section>
  )
}
```

- [ ] **Step 6: Write `src/components/public/home/EcosystemStrip.tsx`**

```tsx
/* The sellers actually trading here, as wordmarks set in type. Not third-party
   logos: showing a brand implies a partnership, and we hold no approved marks. */
export function EcosystemStrip({ sellers }: { sellers: readonly string[] }) {
  if (sellers.length === 0) return null
  return (
    <section className="container home-band" aria-label="Sellers on Aventa">
      <div className="eco-strip">
        <span className="eco-strip__label">Sellers on Aventa</span>
        <ul className="eco-strip__list">
          {sellers.map(s => <li key={s} className="eco-strip__item">{s}</li>)}
        </ul>
      </div>
    </section>
  )
}
```

- [ ] **Step 7: Restyle `src/components/public/PromoStrip.tsx`**

Keep the file's comments, data flow and markup structure. Change only:
- the `<section>`: `className="container home-band"` and `style={{ paddingBlock: '8px' }}`, wrapping the buttons in `<div className="promo-row">…</div>`;
- each `<button>`: replace its `style` and the `onMouseEnter`/`onMouseLeave` handlers with `className="promo-tile"`.

The overlay gradient, text block and CTA span stay as they are.

- [ ] **Step 8: Rewrite `src/components/public/LandingPage.tsx`**

```tsx
import { useState, useEffect, useCallback } from 'react'
import { PromoStrip } from './PromoStrip'
import { PublicProductModal } from './PublicProductModal'
import { HomeHero } from './home/HomeHero'
import { CategorySection } from './home/CategorySection'
import { FeaturedSection } from './home/FeaturedSection'
import { WhyAventa } from './home/WhyAventa'
import { EcosystemStrip } from './home/EcosystemStrip'
import { BANNERS } from '../../lib/assets'
import { loadPromoBanners, loadCategories, loadCatalogue } from '../../lib/storefrontRepo'
import { loadPriceBook, loadCopyBook, repriceAll } from '../../lib/moneyRepo'
import { useMarket } from '../../lib/MarketContext'
import { promoStrip, type PromoSlide } from '../../lib/storefront'
import { featuredProducts, ecosystemSellers } from '../../lib/home'
import type { Category, Product } from '../../types'
import type { PublicPage } from '../../types/view'
import { marketProse } from '../../lib/money'

export function LandingPage({ onNavigate, onAddToBasket }: {
  onNavigate: (p: PublicPage) => void
  onAddToBasket: (p: Product) => void
}) {
  const { book, market, currency } = useMarket()
  const markets = marketProse(book.markets)
  /* The chosen currency, not the market's default. Reading the default here
     while the formatter reads the choice is how a shilling price ends up under
     a dollar sign — the same relabelling the bills migration had to undo. */
  const currencyCode = currency?.code ?? market?.currency ?? 'USD'
  const [slides, setSlides] = useState<PromoSlide[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [catalogue, setCatalogue] = useState<Product[]>([])
  const [open, setOpen] = useState<Product | null>(null)
  const close = useCallback(() => setOpen(null), [])

  useEffect(() => {
    /* Three independent reads. Any of them coming back empty degrades one band of
       the page rather than failing the page, which is why none of them throws. */
    loadPromoBanners().then(b => setSlides(promoStrip(b, BANNERS)))
    loadCategories().then(setCategories)
    /* Priced for the market too. A shopper who sees $18.00 before signing in
       and ₹1,599.00 after has been shown two different shops. */
    Promise.all([loadCatalogue(), loadPriceBook(currencyCode), loadCopyBook()])
      .then(([rows, prices, copy]) => setCatalogue(repriceAll(rows, prices, currencyCode, copy)))
    /* The currency is a dependency: without it this closes over the first one
       it saw and the page keeps showing that market's prices forever. */
  }, [currencyCode])

  return (
    <>
      <HomeHero markets={markets} onNavigate={onNavigate} />
      {/* The operator's live banners. Pausing one in their console takes it off this page. */}
      <PromoStrip slides={slides} onNavigate={onNavigate} />
      <CategorySection categories={categories} catalogue={catalogue} onNavigate={onNavigate} />
      <FeaturedSection products={featuredProducts(catalogue, categories, 4)} onOpen={setOpen} onNavigate={onNavigate} />
      <WhyAventa />
      <EcosystemStrip sellers={ecosystemSellers(catalogue, 8)} />
      <PublicProductModal product={open} onClose={close} onAddToBasket={onAddToBasket} />
    </>
  )
}
```

- [ ] **Step 9: Pass the basket handler from `src/App.tsx`**

Replace line 421 with:

```tsx
        {surface.page === 'landing' && (
          <LandingPage
            onNavigate={(page) => { setSurface({ kind: 'public', page }); window.scrollTo({ top: 0 }) }}
            /* Same as the audience pages: the basket needs an owner, so the first
               add sends the visitor to sign in and completes it afterwards. */
            onAddToBasket={(p) => {
              setPendingProduct(p)
              setSurface({ kind: 'login', prefill: 'consumer' })
              window.scrollTo({ top: 0 })
            }}
          />
        )}
```

- [ ] **Step 10: Remove `CategoryRail.tsx`**

Run: `git grep -n "CategoryRail" -- src` — expected: no matches outside `CategoryRail.tsx` itself.
Then: `git rm src/components/public/CategoryRail.tsx`

- [ ] **Step 11: Gates and commit**

Run: `npm test` and `npm run build` — pass.

```bash
git add src/styles/ui.css src/components/public src/App.tsx
git commit -m "The homepage as a bento grid of what the marketplace actually sells" -m "A navy hero with the coded globe and the three ways in, cards for businesses and partners, the operator's live banners, a category row with real counts, four featured products from the live catalogue priced for the visitor's market, and the sellers trading here. Each band reads its own data and disappears alone when that data is empty. View details opens the product page the audience pages already use, and Add to basket there takes the same sign-in path." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Browser verification

Use the `run-app` skill to start the app (it covers the same-origin proxy if the browser cannot reach Supabase).

- [ ] **Step 1: Homepage at three widths.** Screenshot at 1440×900, 1024×768 and 390×844. Compare against the sample screen: hero two-thirds with stacked side cards on desktop; side cards side by side on tablet; single column on a phone with the category row scrolling sideways.
- [ ] **Step 2: Every control.** Click Shop Retail, Explore Enterprise, Become a Partner, both side-card links, every category tile, every Discover entry, View all products, Learn more, each promo banner. Each lands on the page it names. Open a featured product: the modal shows; Escape closes it; Add to basket goes to sign-in and, after signing in as the demo consumer, the item is in the basket.
- [ ] **Step 3: Market switching.** Change the market in the header: featured prices change currency and the hero's market clause stays correct.
- [ ] **Step 4: Failure and motion.** In devtools, block `*/rest/v1/products*`: featured band and ecosystem strip disappear, category counts disappear, the rest of the page renders. Emulate `prefers-reduced-motion: reduce`: the globe is still. The console shows no new errors.
- [ ] **Step 5: The signed-in surfaces.** Sign in as each demo persona — consumer, enterprise, operator, partner — and screenshot their home screens. Look for anything the palette change made hard to read; fix by moving the text onto an AA-safe token, add the pairing to `contrast.test.ts`, and commit with a message saying which screen and why.
- [ ] **Step 6: Integration suite.** Run `npm run test:integration`. Expected: the same result as on `main` before this work (run it there first if unsure, and record the baseline in the commit message of any fix).

---

### Task 9: README

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Replace the Branding section** (from `## Branding` up to the next `---`) with the Aventa identity: the 6D mark beside the Aventa wordmark on navy `#061B3A` chrome; the wordmark is SVG because there is no Aventa logo file, while the 6D mark still renders only from the approved PNG; Inter as the typeface.

- [ ] **Step 2: Add a `## Design system` section** after Branding:
  - the token table from spec 1.1 (old → new), and the colour-roles rule (teal, cyan, electric and the brief's success green are fills, icons and large type; small text uses the AA-safe tokens; `contrast.test.ts` enforces it);
  - the `src/components/ui/` components, one line each on when to use it;
  - the rule: futuristic treatment (navy gradients, globe, glow) on discovery and promotional surfaces only; transactional and operational screens stay light and plain;
  - the five-spec revamp, linking `docs/superpowers/specs/2026-11-04-ui-revamp-foundation-homepage-design.md`.

- [ ] **Step 3: Update Scripts / Rebuilding** with the asset pipeline: source images live in `images/` (tracked in git); `npm run assets` writes resized WebP to `public/assets/mp/` (including `home/`) and regenerates `src/lib/assets.ts`; never reference `images/` from the app.

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "The README describes the look the app now has" -m "Branding moves to the Aventa palette and wordmark, a Design system section records the tokens, the shared components and where the futuristic treatment belongs, and the asset pipeline from images/ is written down." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

`selfcare/README.md` documents a separate prototype and is not changed.
