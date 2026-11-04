# UI revamp, spec 2 — commerce experiences — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle the retail and enterprise shopping screens on spec 1's component layer — one product card everywhere, a shared listing layout, a two-column product page and checkout — and hide products not priced for the visitor's market, without changing any behaviour.

**Architecture:** New decisions go into pure, tested functions in `src/lib` (`pricedFor`, `filterProducts`, `searchTarget`, `cardAction`). Spec 1's `ui/ProductCard` is generalised to every shop surface, and a new `ui/ListingLayout` gives all three listing screens one skeleton. Screens are then restructured in place: their data reads, state and handlers stay; their markup moves onto the shared components and classes.

**Tech Stack:** React 18 + TypeScript + Vite 5, Vitest 2 (Node environment, `src/**/*.test.ts`), lucide-react, CSS in `src/styles/ui.css`.

**Spec:** `docs/superpowers/specs/2026-11-04-ui-revamp-commerce-design.md`

## Global Constraints

- No functional change: routes, `App.tsx` view/surface state, repos, RLS, pricing, basket, requisition and approval flows, checkout and payment flow, market switching behave as before. The only behavioural change is the spec's market rule (products not priced in the visitor's currency are hidden from shop listings).
- No invented data or capabilities: only fields the product or listing already carries; no new buttons that do something new. The brief's quote/demo/contact-sales/enquiry/bundle features are out of scope (backlog).
- No new dependencies. No database change.
- WCAG 2.2 AA on every text/surface pair (4.5:1 small text, 3:1 large text and UI glyphs); `src/lib/contrast.test.ts` must stay green, including its guard against `color: var(--brand-accent)` in `.tsx`.
- Shopping and checkout are light and plain: no navy gradients, globe or glow inside them.
- All animation and transitions off under `prefers-reduced-motion: reduce`.
- Keep the existing explanatory comments in files you restructure; they record why the code is the way it is.
- Gates at the end of every task: `npx vitest run` (only the two known env-dependent failures allowed: `gateway.test.ts` financingProblem, `partnerApplication.test.ts` '02 Aug 2026') and `npm run build`.
- Commits: plain-English subject saying what changed and why, short body, ending `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Stage only files you changed; never force-add ignored files.

## File map

| File | Status | Responsibility |
|---|---|---|
| `src/lib/storefront.ts` | modify | `pricedFor`, `cardAction` |
| `src/lib/listing.ts` + `.test.ts` | create | `filterProducts` (search/sub/stock/sort), `searchTarget` |
| `src/lib/home.ts` | modify | `featuredProducts` calls `pricedFor` |
| `src/lib/storefront.test.ts` | modify | tests for `pricedFor`, `cardAction` |
| `src/components/ui/ProductCard.tsx` | modify | generalised card (action, compare, stock, notify, price note) |
| `src/components/ui/ListingLayout.tsx` | create | title strip, filter panel/sheet, toolbar, grid slot |
| `src/styles/ui.css` | modify | card controls, listing layout, detail, checkout classes |
| `src/components/ProductGrid.tsx` | modify | consumer listing on the new layout + card |
| `src/components/ProductCard.tsx` | delete | replaced by `ui/ProductCard` |
| `src/components/Hero.tsx`, `CategoryStrip.tsx` | modify | compact retail home |
| `src/components/public/AudiencePage.tsx` | modify | public listing on the new layout, search, market rule |
| `src/components/public/PublicProductGrid.tsx` | delete | replaced by the listing layout |
| `src/components/public/PublicShell.tsx`, `src/types/view.ts`, `src/App.tsx` | modify | header search → retail with a query |
| `src/components/enterprise/EnterpriseBrowse.tsx`, `RequisitionPanel.tsx` | modify | enterprise listing, category tiles, requisition drawer |
| `src/components/ProductDetail.tsx` | modify | two-column detail |
| `src/components/CartDrawer.tsx`, `Checkout.tsx` | modify | restyled drawer, two-column checkout |
| `README.md`, `docs/superpowers/backlog.md` | modify | docs |

---

### Task 1: The shop's decisions, as tested functions

**Files:**
- Create: `src/lib/listing.ts`, `src/lib/listing.test.ts`
- Modify: `src/lib/storefront.ts`, `src/lib/storefront.test.ts`, `src/lib/home.ts`

**Interfaces — Produces:**
- `pricedFor<T extends { currency?: string }>(products: readonly T[], currency: string): T[]` (storefront.ts)
- `cardAction(context: 'retail' | 'enterprise', p: { stock: string }): { label: string; disabled: boolean }` (storefront.ts)
- `type SortKey = 'featured' | 'price-low' | 'price-high' | 'rating' | 'reviews'`
- `interface ListingFilters { search: string; sub: string | null; stock: string | null; sort: SortKey }`
- `filterProducts<T extends FilterableProduct>(products: readonly T[], f: ListingFilters): T[]` where `FilterableProduct = { name: string; description: string; tags?: string[] | null; sub_category: string | null; stock: string; price: number; rating: number | null; reviews: number }` (listing.ts)
- `SORT_OPTIONS: readonly { value: SortKey; label: string }[]` (listing.ts)
- `searchTarget(text: string): { page: 'retail'; q: string } | null` (listing.ts)

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/storefront.test.ts` (keep its existing imports; add `pricedFor, cardAction` to the import from `./storefront`):

```ts
describe('pricedFor', () => {
  const rows = [
    { id: 'a', currency: 'INR' },
    { id: 'b', currency: 'USD' },
    { id: 'c' },
  ]
  it('keeps what is priced in the visitor’s currency and drops the rest', () => {
    expect(pricedFor(rows, 'INR').map(r => r.id)).toEqual(['a', 'c'])
  })
  it('keeps rows that were never repriced, since they carry no currency to judge', () => {
    expect(pricedFor([{ id: 'x' }], 'KES').map(r => r.id)).toEqual(['x'])
  })
})

describe('cardAction', () => {
  it('asks a shopper to add to the basket and a business buyer to add to the requisition', () => {
    expect(cardAction('retail', { stock: 'In stock' })).toEqual({ label: 'Add to basket', disabled: false })
    expect(cardAction('enterprise', { stock: 'In stock' })).toEqual({ label: 'Add to requisition', disabled: false })
  })
  it('will not offer what cannot be added', () => {
    expect(cardAction('retail', { stock: 'Out of stock' })).toEqual({ label: 'Out of stock', disabled: true })
    expect(cardAction('enterprise', { stock: 'out' })).toEqual({ label: 'Out of stock', disabled: true })
  })
})
```

Create `src/lib/listing.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { filterProducts, searchTarget, SORT_OPTIONS, type ListingFilters } from './listing'

const p = (o: Partial<Parameters<typeof filterProducts>[0][number]> & { name: string }) => ({
  description: '', tags: [], sub_category: null, stock: 'In stock', price: 10, rating: null, reviews: 0, ...o,
})
const none: ListingFilters = { search: '', sub: null, stock: null, sort: 'featured' }

describe('filterProducts', () => {
  const rows = [
    p({ name: 'Kestrel phone', price: 300, rating: 4.1, reviews: 9, sub_category: 'Phones' }),
    p({ name: 'Router', description: 'Mesh wifi', price: 90, rating: 4.8, reviews: 2, sub_category: 'Routers', stock: 'Low stock' }),
    p({ name: 'Case', tags: ['Kestrel'], price: 15, rating: null, reviews: 40, sub_category: 'Accessories' }),
  ]
  it('leaves the catalogue order alone when nothing is set', () => {
    expect(filterProducts(rows, none).map(r => r.name)).toEqual(['Kestrel phone', 'Router', 'Case'])
  })
  it('searches name, description and tags, ignoring case', () => {
    expect(filterProducts(rows, { ...none, search: 'kestrel' }).map(r => r.name)).toEqual(['Kestrel phone', 'Case'])
    expect(filterProducts(rows, { ...none, search: 'MESH' }).map(r => r.name)).toEqual(['Router'])
  })
  it('filters by sub-category and by stock', () => {
    expect(filterProducts(rows, { ...none, sub: 'Routers' }).map(r => r.name)).toEqual(['Router'])
    expect(filterProducts(rows, { ...none, stock: 'Low stock' }).map(r => r.name)).toEqual(['Router'])
  })
  it('sorts the four ways the grid offers', () => {
    expect(filterProducts(rows, { ...none, sort: 'price-low' }).map(r => r.price)).toEqual([15, 90, 300])
    expect(filterProducts(rows, { ...none, sort: 'price-high' }).map(r => r.price)).toEqual([300, 90, 15])
    expect(filterProducts(rows, { ...none, sort: 'rating' }).map(r => r.name)).toEqual(['Router', 'Kestrel phone', 'Case'])
    expect(filterProducts(rows, { ...none, sort: 'reviews' }).map(r => r.name)).toEqual(['Case', 'Kestrel phone', 'Router'])
  })
  it('does not reorder the array it was given', () => {
    const copy = [...rows]
    filterProducts(rows, { ...none, sort: 'price-low' })
    expect(rows).toEqual(copy)
  })
  it('offers exactly the sorts it implements', () => {
    expect(SORT_OPTIONS.map(o => o.value)).toEqual(['featured', 'price-low', 'price-high', 'rating', 'reviews'])
  })
})

describe('searchTarget', () => {
  it('sends a search to the retail page, trimmed', () => {
    expect(searchTarget('  router ')).toEqual({ page: 'retail', q: 'router' })
  })
  it('ignores an empty search', () => {
    expect(searchTarget('   ')).toBeNull()
  })
})
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run src/lib/listing.test.ts src/lib/storefront.test.ts`
Expected: FAIL — `./listing` cannot be resolved; `pricedFor` / `cardAction` not exported.

- [ ] **Step 3: Implement**

Append to `src/lib/storefront.ts` (it already exports `canAddToBasket`):

```ts
/**
 * The products a visitor's market can actually be sold. A row the price book
 * does not price in that currency comes back from `reprice` in its base
 * currency instead, and printing it under the local symbol is a wrong price —
 * and usually a seller not approved in that market. Rows that were never
 * repriced carry no currency and are kept, since there is nothing to judge.
 */
export function pricedFor<T extends { currency?: string }>(products: readonly T[], currency: string): T[] {
  return products.filter(p => !p.currency || p.currency === currency)
}

/** What a product card's main button says, and whether it can be pressed. */
export function cardAction(
  context: 'retail' | 'enterprise',
  p: { stock: string },
): { label: string; disabled: boolean } {
  if (!canAddToBasket(p)) return { label: 'Out of stock', disabled: true }
  return { label: context === 'enterprise' ? 'Add to requisition' : 'Add to basket', disabled: false }
}
```

Create `src/lib/listing.ts` — the filter and sort rules moved verbatim out of `ProductGrid.tsx`'s `filtered` memo (lines ~115–151) so every listing uses one rule:

```ts
/* How a shop listing narrows and orders its products. Lifted out of the
   signed-in grid so the public pages search and sort by the same rule. */

export type SortKey = 'featured' | 'price-low' | 'price-high' | 'rating' | 'reviews'

export const SORT_OPTIONS: readonly { value: SortKey; label: string }[] = [
  { value: 'featured', label: 'Featured' },
  { value: 'price-low', label: 'Price: low to high' },
  { value: 'price-high', label: 'Price: high to low' },
  { value: 'rating', label: 'Highest rated' },
  { value: 'reviews', label: 'Most reviewed' },
]

export interface ListingFilters {
  search: string
  sub: string | null
  stock: string | null
  sort: SortKey
}

export interface FilterableProduct {
  name: string
  description: string
  tags?: string[] | null
  sub_category: string | null
  stock: string
  price: number
  rating: number | null
  reviews: number
}

export function filterProducts<T extends FilterableProduct>(products: readonly T[], f: ListingFilters): T[] {
  let result = [...products]
  if (f.search) {
    const q = f.search.toLowerCase()
    result = result.filter(p =>
      p.name.toLowerCase().includes(q) ||
      p.description.toLowerCase().includes(q) ||
      (p.tags ?? []).some(t => t.toLowerCase().includes(q)))
  }
  if (f.sub) result = result.filter(p => p.sub_category === f.sub)
  if (f.stock) result = result.filter(p => p.stock === f.stock)
  switch (f.sort) {
    case 'price-low': result.sort((a, b) => a.price - b.price); break
    case 'price-high': result.sort((a, b) => b.price - a.price); break
    case 'rating': result.sort((a, b) => (b.rating || 0) - (a.rating || 0)); break
    case 'reviews': result.sort((a, b) => b.reviews - a.reviews); break
  }
  return result
}

/** Where the public header's search goes. Blank is no search at all. */
export function searchTarget(text: string): { page: 'retail'; q: string } | null {
  const q = text.trim()
  return q ? { page: 'retail', q } : null
}
```

Before writing `SORT_OPTIONS` labels, read `ProductGrid.tsx`'s `<select>` (~line 252) and copy its option labels exactly; adjust the test's expectations only if a label differs (values must stay as above, since they are what the grid already stores).

In `src/lib/home.ts`, `featuredProducts` currently filters `(!currency || !p.currency || p.currency === currency)` inline. Replace that clause with a call to `pricedFor` (import it from `./storefront`), applied when `currency` is given: e.g. `const pool = currency ? pricedFor(products, currency) : products` and filter `pool`. Its existing tests must pass unchanged.

- [ ] **Step 4: Run them and watch them pass**

Run: `npx vitest run src/lib/listing.test.ts src/lib/storefront.test.ts src/lib/home.test.ts` — PASS.

- [ ] **Step 5: Gates and commit**

`npx vitest run`, `npm run build`.

```bash
git add src/lib/listing.ts src/lib/listing.test.ts src/lib/storefront.ts src/lib/storefront.test.ts src/lib/home.ts
git commit -m "One rule for what a shop lists, how it sorts, and what its button says" -m "pricedFor hides products the visitor's market does not price, and the homepage now uses it rather than its own copy. The signed-in grid's search, filter and sort move into filterProducts so the public pages can share them; cardAction decides basket versus requisition and out of stock in one place." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: One product card for every shop surface

**Files:**
- Modify: `src/components/ui/ProductCard.tsx`, `src/styles/ui.css`

**Interfaces:**
- Consumes: `cardAction` (Task 1); `StatusBadge`; `useMarket().fmtIn(amount: number, currency: string)`; `getProductImage(id)`.
- Produces:

```ts
export interface CardProduct {
  id: string; name: string; seller: string; description?: string | null
  price: number; was_price?: number | null; currency?: string
  unit?: string | null; rating: number | null; reviews: number
  badge?: string | null; stock: string
}
export function ProductCard(props: {
  product: CardProduct
  onOpen: (p: CardProduct) => void
  action?: { label: string; onClick: () => void; disabled?: boolean }
  compare?: { checked: boolean; onToggle: () => void; disabled?: boolean }
  showStock?: boolean
  notify?: { watching: boolean; onNotify: () => void }   // shown only when out of stock
  priceNote?: string                                     // e.g. '/mo', appended after the price
}): JSX.Element
export function stockTone(stock: string): 'success' | 'warning' | 'danger'
```

The homepage passes only `product` and `onOpen` and must render exactly as before (no button, no checkbox, no stock badge).

- [ ] **Step 1: Generalise the component**

Rewrite `src/components/ui/ProductCard.tsx`:

```tsx
import { Star, ArrowRight, Bell, ShoppingBag } from 'lucide-react'
import { getProductImage } from '../../lib/images'
import { useMarket } from '../../lib/MarketContext'
import { StatusBadge } from './StatusBadge'

export interface CardProduct {
  id: string
  name: string
  seller: string
  description?: string | null
  price: number
  was_price?: number | null
  currency?: string
  unit?: string | null
  rating: number | null
  reviews: number
  badge?: string | null
  stock: string
}

/** The colour family for a catalogue badge. The words are the operator's;
    this only picks the tint, and the text carries the meaning. */
export function badgeTone(badge: string): 'success' | 'warning' | 'info' | 'neutral' {
  const b = badge.toLowerCase()
  if (b.includes('best') || b.includes('popular')) return 'warning'
  if (b.includes('new')) return 'success'
  if (b.includes('bundle') || b.includes('recommend')) return 'info'
  return 'neutral'
}

export function stockTone(stock: string): 'success' | 'warning' | 'danger' {
  const s = stock.toLowerCase()
  if (s.includes('out')) return 'danger'
  if (s.includes('low')) return 'warning'
  return 'success'
}

/* A real catalogue row: its own photograph, name, seller, description, price in
   the currency it was priced in, and rating only when buyers have left one. The
   whole card opens the product; the button and checkbox inside stop the click
   so buying or comparing does not also open the page. */
export function ProductCard({ product: p, onOpen, action, compare, showStock, notify, priceNote }: {
  product: CardProduct
  onOpen: (p: CardProduct) => void
  action?: { label: string; onClick: () => void; disabled?: boolean }
  compare?: { checked: boolean; onToggle: () => void; disabled?: boolean }
  showStock?: boolean
  notify?: { watching: boolean; onNotify: () => void }
  priceNote?: string
}) {
  const { fmtIn, currency } = useMarket()
  const price = (n: number) => fmtIn(n, p.currency ?? currency?.code ?? 'USD')
  const outOfStock = stockTone(p.stock) === 'danger'
  const hasRating = p.rating !== null && p.rating > 0
  const stop = (e: React.SyntheticEvent) => e.stopPropagation()

  return (
    <article
      className="p-card"
      role="button"
      tabIndex={0}
      aria-label={`${p.name}, ${price(p.price)} — view details`}
      onClick={() => onOpen(p)}
      onKeyDown={e => {
        if (e.target !== e.currentTarget) return
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(p) }
      }}
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
        {hasRating && (
          <div className="p-card__rating">
            <Star size={12} fill="currentColor" style={{ color: 'var(--brand-gold)' }} aria-hidden />
            {p.rating!.toFixed(1)} <span style={{ color: 'var(--text-tertiary)' }}>({p.reviews})</span>
          </div>
        )}
        {showStock && <div><StatusBadge tone={stockTone(p.stock)}>{p.stock}</StatusBadge></div>}
        <div className="p-card__foot">
          <span className="p-card__price">
            {price(p.price)}
            {(priceNote ?? p.unit) && <span className="p-card__unit">{priceNote ?? p.unit}</span>}
            {p.was_price != null && p.was_price > p.price && (
              <span className="p-card__was">{price(p.was_price)}</span>
            )}
          </span>
          {!action && <span className="ui-link" aria-hidden>View details <ArrowRight size={14} /></span>}
        </div>
        {(action || compare || (notify && outOfStock)) && (
          <div className="p-card__actions" onClick={stop} onKeyDown={stop}>
            {compare && (
              <label className="p-card__compare">
                <input type="checkbox" checked={compare.checked} disabled={compare.disabled} onChange={compare.onToggle} />
                Compare
              </label>
            )}
            {notify && outOfStock ? (
              <button className="btn btn-sm btn-secondary" onClick={notify.onNotify} disabled={notify.watching}>
                <Bell size={14} aria-hidden /> {notify.watching ? 'We’ll tell you' : 'Notify me'}
              </button>
            ) : action && (
              <button className="btn btn-sm btn-cyan" onClick={action.onClick} disabled={action.disabled}>
                <ShoppingBag size={14} aria-hidden /> {action.label}
              </button>
            )}
          </div>
        )}
      </div>
    </article>
  )
}
```

Before finalising the notify labels, read `src/components/ProductCard.tsx` (the consumer card being replaced in Task 4) and copy its existing watching/notify wording exactly instead of the two strings above.

- [ ] **Step 2: Append the styles to `src/styles/ui.css`**

```css
/* ---------- Product card controls (spec 2) ---------- */
.p-card__was { margin-left: 6px; font-size: var(--text-xs); font-weight: 500; color: var(--text-tertiary); text-decoration: line-through; }
.p-card__actions { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: 12px; flex-wrap: wrap; }
.p-card__actions .btn { flex: 1; justify-content: center; min-height: 36px; }
.p-card__compare { display: inline-flex; align-items: center; gap: 6px; font-size: var(--text-xs); font-weight: 600; color: var(--text-secondary); cursor: pointer; }
.p-card__compare input { width: 16px; height: 16px; accent-color: var(--blue); }
.p-card__actions .btn:disabled { opacity: 1; background: var(--gray-100); color: var(--text-secondary); cursor: not-allowed; }
```

(`--text-secondary` on `--gray-100` clears AA; the disabled button keeps readable text rather than fading to 50%.)

- [ ] **Step 3: Gates and commit**

`npx vitest run` and `npm run build` (the homepage `FeaturedSection` still compiles: `CardProduct` accepts a `Product`, and `onOpen` receives the same object — if TypeScript rejects `onOpen={setOpen}` because `CardProduct` is wider than `Product`, change `FeaturedSection`'s handler to `onOpen={p => onOpen(p as Product)}`).

```bash
git add src/components/ui/ProductCard.tsx src/styles/ui.css src/components/public/home/FeaturedSection.tsx
git commit -m "The product card learns to sell: basket, requisition, compare, stock and notify" -m "Every control is optional, so the homepage card is unchanged. Prices print in the currency they were priced in. A disabled button keeps readable text instead of fading under contrast." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: One listing layout

**Files:**
- Create: `src/components/ui/ListingLayout.tsx`
- Modify: `src/components/ui/index.ts`, `src/styles/ui.css`

**Interfaces — Produces:**

```ts
export interface FilterOption { value: string; label: string; count?: number }
export interface FilterGroupDef { id: string; title: string; options: FilterOption[]; selected: string | null; onSelect: (v: string | null) => void }
export function ListingLayout(props: {
  title: string
  subtitle?: string
  breadcrumb?: { label: string; onClick?: () => void }[]
  count: number                       // results shown
  total?: number                      // before filtering, when different
  search: { value: string; onChange: (v: string) => void; placeholder: string }
  sort: { value: string; options: readonly { value: string; label: string }[]; onChange: (v: string) => void }
  filters: FilterGroupDef[]
  onClear?: () => void                // shown as "Clear all" when any filter/search is set
  above?: React.ReactNode             // e.g. enterprise category tiles, info strips
  children: React.ReactNode           // the grid or an empty state
}): JSX.Element
export function ListingGrid({ children }: { children: React.ReactNode }): JSX.Element
export function EmptyListing({ title, text, onClear }: { title: string; text: string; onClear?: () => void }): JSX.Element
```

- [ ] **Step 1: Write `src/components/ui/ListingLayout.tsx`**

```tsx
import { useEffect, useId, useRef, useState } from 'react'
import { Search, SlidersHorizontal, X, ChevronRight } from 'lucide-react'

export interface FilterOption { value: string; label: string; count?: number }
export interface FilterGroupDef {
  id: string
  title: string
  options: FilterOption[]
  selected: string | null
  onSelect: (v: string | null) => void
}

function FilterGroups({ filters }: { filters: FilterGroupDef[] }) {
  return (
    <>
      {filters.filter(g => g.options.length > 0).map(g => (
        <fieldset key={g.id} className="filter-group">
          <legend className="filter-group__title">{g.title}</legend>
          <label className="filter-option">
            <input type="radio" name={g.id} checked={g.selected === null} onChange={() => g.onSelect(null)} />
            <span>All</span>
          </label>
          {g.options.map(o => (
            <label key={o.value} className="filter-option">
              <input type="radio" name={g.id} checked={g.selected === o.value} onChange={() => g.onSelect(o.value)} />
              <span>{o.label}</span>
              {o.count !== undefined && <span className="filter-option__count">{o.count}</span>}
            </label>
          ))}
        </fieldset>
      ))}
    </>
  )
}

/* The same skeleton for every shop listing: who it is for decides the cards,
   not the furniture around them. Filters sit in a side panel on a wide screen
   and behind a button on a narrow one, where a side panel would leave the grid
   one card wide. */
export function ListingLayout({
  title, subtitle, breadcrumb, count, total, search, sort, filters, onClear, above, children,
}: {
  title: string
  subtitle?: string
  breadcrumb?: { label: string; onClick?: () => void }[]
  count: number
  total?: number
  search: { value: string; onChange: (v: string) => void; placeholder: string }
  sort: { value: string; options: readonly { value: string; label: string }[]; onChange: (v: string) => void }
  filters: FilterGroupDef[]
  onClear?: () => void
  above?: React.ReactNode
  children: React.ReactNode
}) {
  const [sheet, setSheet] = useState(false)
  const opener = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const headingId = useId()
  const active = search.value !== '' || filters.some(g => g.selected !== null)

  useEffect(() => {
    if (!sheet) return
    panel.current?.querySelector<HTMLElement>('input, button')?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setSheet(false); opener.current?.focus() }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [sheet])

  return (
    <section className="container listing" aria-labelledby={headingId}>
      {breadcrumb && breadcrumb.length > 0 && (
        <nav className="listing__crumbs" aria-label="Breadcrumb">
          {breadcrumb.map((b, i) => (
            <span key={b.label}>
              {i > 0 && <ChevronRight size={12} aria-hidden />}
              {b.onClick ? <button className="ui-link" onClick={b.onClick}>{b.label}</button> : <span aria-current="page">{b.label}</span>}
            </span>
          ))}
        </nav>
      )}
      <div className="listing__head">
        <div>
          <h1 className="listing__title" id={headingId}>{title}</h1>
          {subtitle && <p className="listing__sub">{subtitle}</p>}
        </div>
      </div>

      {above}

      <div className="listing__body">
        <aside className="listing__panel" aria-label="Filters">
          <div className="listing__panel-head">
            <span>Filters</span>
            {onClear && active && <button className="ui-link" onClick={onClear}>Clear all</button>}
          </div>
          <FilterGroups filters={filters} />
        </aside>

        <div className="listing__main">
          <div className="listing__toolbar">
            <label className="listing__search">
              <Search size={16} aria-hidden />
              <input type="search" value={search.value} placeholder={search.placeholder}
                aria-label={search.placeholder} onChange={e => search.onChange(e.target.value)} />
            </label>
            <button ref={opener} className="btn btn-sm btn-secondary listing__filters-btn"
              aria-expanded={sheet} onClick={() => setSheet(true)}>
              <SlidersHorizontal size={14} aria-hidden /> Filters
            </button>
            <label className="listing__sort">
              <span>Sort</span>
              <select value={sort.value} onChange={e => sort.onChange(e.target.value)}>
                {sort.options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </label>
            <span className="listing__count" aria-live="polite">
              {total !== undefined && total !== count ? `${count} of ${total}` : count} {count === 1 ? 'result' : 'results'}
            </span>
          </div>
          {children}
        </div>
      </div>

      {sheet && (
        <div className="sheet-backdrop" onClick={() => { setSheet(false); opener.current?.focus() }}>
          <div ref={panel} className="sheet" role="dialog" aria-modal="true" aria-label="Filters" onClick={e => e.stopPropagation()}>
            <div className="listing__panel-head">
              <span>Filters</span>
              <button className="btn btn-sm btn-ghost" aria-label="Close filters"
                onClick={() => { setSheet(false); opener.current?.focus() }}><X size={16} /></button>
            </div>
            <FilterGroups filters={filters} />
            <div className="sheet__foot">
              {onClear && active && <button className="btn btn-secondary" onClick={onClear}>Clear all</button>}
              <button className="btn btn-cyan" onClick={() => { setSheet(false); opener.current?.focus() }}>
                Show {count} {count === 1 ? 'result' : 'results'}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}

export function ListingGrid({ children }: { children: React.ReactNode }) {
  return <div className="listing__grid">{children}</div>
}

export function EmptyListing({ title, text, onClear }: { title: string; text: string; onClear?: () => void }) {
  return (
    <div className="listing__empty">
      <h2>{title}</h2>
      <p>{text}</p>
      {onClear && <button className="btn btn-secondary" onClick={onClear}>Clear all</button>}
    </div>
  )
}
```

Append to `src/components/ui/index.ts`:

```ts
export { ListingLayout, ListingGrid, EmptyListing } from './ListingLayout'
export type { FilterGroupDef, FilterOption } from './ListingLayout'
export type { CardProduct } from './ProductCard'
export { stockTone } from './ProductCard'
```

- [ ] **Step 2: Append the styles to `src/styles/ui.css`**

```css
/* ---------- Listing layout (spec 2) ---------- */
.listing { padding-block: 24px 48px; }
.listing__crumbs { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; font-size: var(--text-xs); color: var(--text-tertiary); margin-bottom: 8px; }
.listing__crumbs > span { display: inline-flex; align-items: center; gap: 6px; }
.listing__crumbs .ui-link { font-size: var(--text-xs); }
.listing__head { display: flex; justify-content: space-between; align-items: flex-end; gap: 16px; margin-bottom: 16px; }
.listing__title { font-size: var(--text-2xl); font-weight: 800; letter-spacing: -0.01em; color: var(--text); line-height: 1.2; }
.listing__sub { margin-top: 4px; font-size: var(--text-sm); color: var(--text-secondary); }
.listing__body { display: grid; grid-template-columns: 240px minmax(0, 1fr); gap: 24px; align-items: start; }
.listing__panel {
  position: sticky; top: 80px; padding: 16px; border-radius: var(--radius-card);
  background: var(--bg-card); box-shadow: var(--shadow-card);
}
.listing__panel-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; font-weight: 700; font-size: var(--text-sm); color: var(--text); }
.filter-group { border: none; padding: 10px 0; margin: 0; border-top: 1px solid var(--border-light); }
.filter-group__title { font-size: var(--text-xs); font-weight: 700; color: var(--text-secondary); padding: 0; margin-bottom: 6px; }
.filter-option { display: flex; align-items: center; gap: 8px; padding: 5px 0; font-size: var(--text-sm); color: var(--text); cursor: pointer; }
.filter-option input { accent-color: var(--blue); }
.filter-option__count { margin-left: auto; font-size: var(--text-xs); color: var(--text-tertiary); }
.listing__toolbar { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin-bottom: 16px; }
.listing__search {
  flex: 1 1 260px; display: flex; align-items: center; gap: 8px; padding: 0 14px; height: 40px;
  border: 1px solid var(--border); border-radius: var(--radius-full); background: var(--bg-card); color: var(--text-tertiary);
}
.listing__search input { flex: 1; border: none; outline: none; background: transparent; color: var(--text); font-size: var(--text-sm); min-width: 0; }
.listing__search:focus-within { border-color: var(--electric); box-shadow: 0 0 0 2px rgba(22, 139, 255, 0.2); }
.listing__sort { display: inline-flex; align-items: center; gap: 8px; font-size: var(--text-sm); color: var(--text-secondary); }
.listing__sort select { height: 40px; padding: 0 12px; border: 1px solid var(--border); border-radius: var(--radius-full); background: var(--bg-card); color: var(--text); font-size: var(--text-sm); }
.listing__count { font-size: var(--text-sm); color: var(--text-secondary); margin-left: auto; }
.listing__filters-btn { display: none; }
.listing__grid { display: grid; gap: 16px; grid-template-columns: repeat(auto-fill, minmax(min(230px, 100%), 1fr)); }
.listing__empty { padding: 48px 24px; text-align: center; border-radius: var(--radius-card); background: var(--bg-card); box-shadow: var(--shadow-card); }
.listing__empty h2 { font-size: var(--text-lg); font-weight: 700; color: var(--text); }
.listing__empty p { margin: 6px 0 16px; font-size: var(--text-sm); color: var(--text-secondary); }

.sheet-backdrop { position: fixed; inset: 0; z-index: 200; background: rgba(3, 19, 43, 0.45); display: flex; align-items: flex-end; }
.sheet {
  width: 100%; max-height: 85vh; overflow-y: auto; padding: 16px 20px calc(16px + env(safe-area-inset-bottom, 0px));
  background: var(--bg-card); border-radius: 20px 20px 0 0; box-shadow: var(--shadow-xl); animation: fadeIn var(--transition) ease-out;
}
.sheet__foot { position: sticky; bottom: 0; display: flex; gap: 8px; padding-top: 12px; background: var(--bg-card); }
.sheet__foot .btn { flex: 1; justify-content: center; }

@media (max-width: 1023px) {
  .listing__body { grid-template-columns: minmax(0, 1fr); }
  .listing__panel { display: none; }
  .listing__filters-btn { display: inline-flex; }
}
@media (max-width: 520px) {
  .listing__grid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
  .listing__count { width: 100%; margin-left: 0; }
}
@media (prefers-reduced-motion: reduce) { .sheet { animation: none; } }
```

- [ ] **Step 3: Gates and commit**

`npx vitest run`, `npm run build`.

```bash
git add src/components/ui/ListingLayout.tsx src/components/ui/index.ts src/styles/ui.css
git commit -m "One skeleton for every shop listing: filters, search, sort and the grid" -m "Filters sit in a side panel on wide screens and in a bottom sheet behind a button on narrow ones, with focus moved in on open and returned on close. The count is announced as it changes." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: The signed-in consumer listing

**Files:**
- Modify: `src/components/ProductGrid.tsx`
- Delete: `src/components/ProductCard.tsx`

**Interfaces — Consumes:** `filterProducts`, `SORT_OPTIONS`, `SortKey` (listing.ts); `pricedFor`, `cardAction` (storefront.ts); `ListingLayout`, `ListingGrid`, `EmptyListing`, `ProductCard` from `src/components/ui`. `ProductGrid`'s exported props stay exactly as they are; `App.tsx` must not change.

- [ ] **Step 1: Restructure `ProductGrid.tsx`**

Keep: both data effects (categories read; products read with `.eq('status','live')`, `.contains('audiences',['consumer'])`, category restriction, `repriceAll`), the compare state and `picks`/`pick` logic, `CompareTray`/`CompareTable` usage, the unknown-category guard (~line 159), and every comment.

Change:
- State `search/sortBy/subFilter/stockFilter` becomes the inputs to `filterProducts`: `const filtered = useMemo(() => filterProducts(pricedFor(products, currencyCode), { search, sub: subFilter, stock: stockFilter, sort: sortBy as SortKey }), [...])`. Delete the inline filter/sort code it replaces.
- `subCategories` is computed from the priced products.
- Render through `ListingLayout`:
  - `title`: the active category's name, or "All products" when unfiltered on the category view.
  - `subtitle`: the category blurb when present.
  - `breadcrumb`: `[{ label: 'Home', onClick: () => onNavigate('home') }, { label: title }]`.
  - `count={filtered.length}`, `total={pricedFor(products, currencyCode).length}`.
  - `search` with placeholder "Search this shelf".
  - `sort` with `SORT_OPTIONS`.
  - `filters`: a "Type" group from `subCategories` (counts per sub-category), and a "Availability" group from the distinct `stock` values present.
  - `onClear` resets search, sub and stock.
- Cards: `ui/ProductCard` with `action` from `cardAction('retail', p)` wired to the existing add-to-cart handler, `compare` wired to `pick` (disabled when the compare cap is reached and the product isn't picked, as `CompareToggle` does today), `showStock`, `notify` wired to the existing `onNotifyMe` / `watching` props, `priceNote={p.unit ?? undefined}`. `onOpen` navigates to the product exactly as the old card's `onClick` did.
- Empty: `EmptyListing` "No products match" with Clear all; while loading keep the existing spinner.
- The **home** usage (no `categoryFilter`) must still render a "Featured products" section, not a listing page: when `categoryFilter` is null and the component is used on `view === 'home'`, render the existing heading + `ListingGrid` of cards without the filter panel. Read `App.tsx:605-625` to see how home and category both mount `ProductGrid` and choose by `categoryFilter`.

- [ ] **Step 2: Delete the old card**

Run `git grep -n "from './ProductCard'\|components/ProductCard'" -- src`; once only `ui/` references remain, `git rm src/components/ProductCard.tsx`.

- [ ] **Step 3: Gates and commit**

`npx vitest run`, `npm run build`, and confirm `git grep -n "color: 'var(--brand-accent)'" -- src` prints nothing.

```bash
git add -A src/components/ProductGrid.tsx src/components/ProductCard.tsx
git commit -m "The shopper's category page on the shared listing, priced for their market" -m "Filters move into a side panel and a sheet, search and sort share one rule with the public pages, and products the market does not price no longer appear. Basket, compare and notify behave as before." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: The compact retail home

**Files:**
- Modify: `src/components/Hero.tsx`, `src/components/CategoryStrip.tsx`, `src/styles/ui.css`

**Interfaces — Consumes:** `BentoGrid`, `BentoCell`, `BentoCard`, `SectionHeader`, `CategoryTile`, `categoryIcon` (ui); `categoryVisual` (home.ts). Exported props of `Hero` and `CategoryStrip` unchanged.

- [ ] **Step 1: `Hero.tsx`**

Keep the threshold computation verbatim (lines ~1–40) and every fact the current hero prints. Replace the full-bleed navy section with:

```tsx
<section className="container home-band" aria-label="Welcome">
  <BentoGrid cols={4}>
    <BentoCell span={2}>
      <BentoCard variant="light" className="retail-hero">
        {/* current eyebrow/headline/lede copy, verbatim, as <h1 className="retail-hero__title">…</h1> and <p className="retail-hero__lede">…</p> */}
        {/* current primary CTA → <button className="btn btn-cyan">…</button> calling the same onNavigate */}
      </BentoCard>
    </BentoCell>
    {/* one BentoCell per current trust item (Sparkles/Shield/Truck/Headphones icons already imported),
        each a <div className="bento-card bento-card--light trust-tile"> with icon, title, one line —
        the free-delivery tile prints {threshold} exactly as today */}
  </BentoGrid>
</section>
```

Read the current JSX first and carry every string across unchanged; if the current hero has more or fewer than four trust items, render what it has (BentoGrid wraps).

- [ ] **Step 2: `CategoryStrip.tsx`**

Keep both data reads (categories via `categoriesFor(…,'consumer')`, live counts). Replace the card markup with `SectionHeader title="Shop by category"` and a `.cat-row` of `CategoryTile`s (`visual={categoryVisual(c.id)}`, `icon={categoryIcon(c.id)}`, `count={counts[c.id]}`, `onClick` → the same `onNavigate('category', { category: c.id })` as today). Remove the `catColors` hex map if nothing else uses it.

- [ ] **Step 3: Append styles**

```css
/* ---------- Retail home (spec 2) ---------- */
.retail-hero { justify-content: center; gap: 12px; padding: 28px; min-height: 0; border: 1px solid var(--border-light); }
.retail-hero__title { font-size: clamp(1.6rem, 2.6vw, 2.25rem); font-weight: 800; line-height: 1.1; letter-spacing: -0.02em; color: var(--brand-navy); }
.retail-hero__lede { font-size: var(--text-base); line-height: 1.55; color: var(--text-secondary); }
.trust-tile { gap: 8px; padding: 18px; }
.trust-tile svg { color: var(--blue); }
.trust-tile__title { font-size: var(--text-sm); font-weight: 700; color: var(--text); }
.trust-tile__text { font-size: var(--text-xs); color: var(--text-secondary); line-height: 1.5; }
```

- [ ] **Step 4: Gates and commit**

`npx vitest run`, `npm run build`.

```bash
git add src/components/Hero.tsx src/components/CategoryStrip.tsx src/styles/ui.css
git commit -m "A shopper's home that gets to the products: a compact hero and the category tiles" -m "The full-width navy band becomes one light card beside the trust tiles, with the same facts — including the delivery threshold converted for the market. Categories use the homepage tiles." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Public listings and header search

**Files:**
- Modify: `src/components/public/AudiencePage.tsx`, `src/components/public/PublicShell.tsx`, `src/types/view.ts`, `src/App.tsx`, `src/styles/ui.css`
- Delete: `src/components/public/PublicProductGrid.tsx`

**Interfaces:**
- Consumes: `searchTarget`, `filterProducts`, `SORT_OPTIONS` (listing.ts); `pricedFor`, `cardAction` (storefront.ts); `ListingLayout`, `ListingGrid`, `EmptyListing`, `ProductCard` (ui).
- Produces: the public surface carries an optional search query: in `src/types/view.ts` the surface variant becomes `{ kind: 'public'; page: PublicPage; q?: string }`; `PublicShell` gains prop `onSearch: (q: string) => void`; `AudiencePage` gains prop `initialQuery?: string`.

- [ ] **Step 1: Carry the query**

- `view.ts`: add `q?: string` to the public surface variant.
- `App.tsx` (the `surface.kind === 'public'` block): pass `onSearch={(q) => { setSurface({ kind: 'public', page: 'retail', q }); window.scrollTo({ top: 0 }) }}` to `PublicShell`, and `initialQuery={surface.q}` to `AudiencePage`. Give `AudiencePage` a `key={`${surface.page}:${surface.q ?? ''}`}` so a new search resets its state.

- [ ] **Step 2: Header search in `PublicShell.tsx`**

Add, between the nav and `.site-header__end`, a form:

```tsx
<form className="site-search" role="search" onSubmit={e => {
  e.preventDefault()
  const t = searchTarget(query)
  if (t) { setMenuOpen(false); onSearch(t.q) }
}}>
  <Search size={16} aria-hidden />
  <input type="search" value={query} onChange={e => setQuery(e.target.value)}
    placeholder="Search products, services…" aria-label="Search the marketplace" />
</form>
```

with `const [query, setQuery] = useState('')`. Styles:

```css
.site-search {
  display: flex; align-items: center; gap: 8px; height: 38px; padding: 0 14px; width: min(320px, 28vw);
  border-radius: var(--radius-full); background: rgba(255, 255, 255, 0.08); border: 1px solid rgba(255, 255, 255, 0.14);
  color: rgba(255, 255, 255, 0.72);
}
.site-search input { flex: 1; min-width: 0; border: none; outline: none; background: transparent; color: #fff; font-size: var(--text-sm); }
.site-search input::placeholder { color: rgba(255, 255, 255, 0.72); }
.site-search:focus-within { border-color: var(--cyan); }
@media (max-width: 1100px) { .site-search { width: 200px; } }
@media (max-width: 899px) { .site-search { display: none; } .site-nav.is-open .site-search--menu { display: flex; width: 100%; } }
```

On phones, render a second instance inside the open mobile menu (`className="site-search site-search--menu"`) as its first child, so search is reachable without the hidden desktop field. (`rgba(255,255,255,0.72)` on `#061B3A` ≈ 9:1.)

- [ ] **Step 3: `AudiencePage.tsx` buyer listing**

Keep the hero section, the partner branch (`CategoryShowcase`), the modal and every comment. For `retail` and `enterprise`, replace `<PublicProductGrid …/>` with `ListingLayout`:

- state: `search` (initialised from `initialQuery ?? ''`), `sub`, `stock`, `sort`.
- `const shelf = pricedFor(productsForPage(catalogue, categories, page, Infinity), currencyCode)` — pass `Infinity` as the limit so filtering sees the whole shelf (read `productsForPage`'s signature; its `limit` default is 12).
- `const shown = filterProducts(shelf, { search, sub, stock, sort })`.
- `title={c.rail.title}`, `subtitle={c.rail.subtitle}`, `count={shown.length}`, `total={shelf.length}`, filters "Type" (sub-categories) and "Availability" (stock values).
- Cards: `ProductCard` with `action` from `cardAction('retail', p)` calling `onAddToBasket(p)`, `showStock`, `onOpen={setViewing}`.
- Empty: `EmptyListing` with Clear all.

Then `git rm src/components/public/PublicProductGrid.tsx` once `git grep -n PublicProductGrid -- src` shows no other use.

- [ ] **Step 4: Gates and commit**

`npx vitest run`, `npm run build`.

```bash
git add -A src/components/public src/types/view.ts src/App.tsx src/styles/ui.css
git commit -m "Search from the public header, and the public shop pages on the shared listing" -m "A search lands on the Retail page with the words already applied. The public Retail and Enterprise pages gain the same filters, search and sort as the signed-in grid, list the whole shelf rather than the first twelve, and hide what the visitor's market does not price." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: The enterprise storefront and requisition drawer

**Files:**
- Modify: `src/components/enterprise/EnterpriseBrowse.tsx`, `src/components/enterprise/RequisitionPanel.tsx`, `src/styles/ui.css`

**Interfaces — Consumes:** `pricedFor`, `cardAction` (storefront.ts); `ListingLayout`, `ListingGrid`, `EmptyListing`, `ProductCard`, `CategoryTile`, `categoryIcon` (ui); `categoryVisual` (home.ts). `EnterpriseListing` (src/lib/enterpriseRepo.ts) has `currency: string`, `rating: number` (0 = none), `model`, `unit`, `stock`, `description` — it satisfies `CardProduct` structurally (`rating: number` is assignable to `number | null`).

- [ ] **Step 1: `EnterpriseBrowse.tsx`**

Keep: every data effect, the policy/offered/primary currency logic, `req.reprice` and its toast, compare state, `addToRequisition`, `CompareTray`/`CompareTable`, `EnterpriseListingModal`, the "still loading" vs "nothing matches" distinction, and all comments.

Change:
- `const priced = pricedFor(listings ?? [], currency)` (use the component's active currency variable; read the file for its name) — the base for `all` and `results`.
- Render through `ListingLayout`: title "Browse the catalogue" (or the current `<h1>` text, read it), subtitle = the current count line ("N of M listings approved for business accounts · sold by K sellers"), search over the existing `query` state with the existing match rule (name + description + seller + sub_category — keep this enterprise rule; do not switch to `filterProducts`), sort over the existing `sort` state and its existing options (read the `<select>`), filters "Marketplace" (the existing `vertical` options with counts) and "Category" (the existing `category` options with counts), `onClear={reset}`.
- `above`: (a) the currency info strip that exists today, restyled as `<div className="info-strip">…</div>`; (b) a `.cat-row` of compact `CategoryTile`s — one per distinct `category_id` in `priced`, `visual={categoryVisual(id)}`, `icon={categoryIcon(id)}`, `count` = listings in it, name from the existing vertical label mapping in this file, `onClick={() => setVertical(id)}`.
- Cards: `ProductCard` with `action` from `cardAction('enterprise', p)` → `addToRequisition(p)`, `compare` → existing `pick` (cap rule as today), `showStock`, `priceNote={p.model === 'monthly' ? (p.unit ? ` ${p.unit}/mo` : '/mo') : undefined}`, `onOpen={() => setViewing(p)}`.
- Loading: keep the spinner while `listings === null`. Empty: `EmptyListing` with `onClear={reset}`.

CSS:

```css
.info-strip { display: flex; gap: 10px; align-items: flex-start; padding: 12px 16px; margin-bottom: 16px; border-radius: var(--radius-md); background: var(--info-bg); color: var(--info); font-size: var(--text-sm); line-height: 1.5; }
.cat-row--compact .cat-tile__media { aspect-ratio: 21 / 9; }
```

(Add `cat-row--compact` alongside `cat-row` on the enterprise tile row.)

- [ ] **Step 2: `RequisitionPanel.tsx` as a right-side drawer**

Keep every field, validation, the approval routing and all handlers. Restyle the container as a right-side drawer: fixed, full height, `width: min(440px, 100vw)`, `background: var(--bg-card)`, `box-shadow: var(--shadow-xl)`, header row with title and close, scrollable body, sticky footer holding the totals and the existing submit button styled `btn btn-cyan`. Put these in `ui.css` as `.drawer`, `.drawer__head`, `.drawer__body`, `.drawer__foot` and use the classes. Escape closes and returns focus to whatever opened it, if the panel doesn't already do that (read it). Disable the slide-in transition under reduced motion.

- [ ] **Step 3: Gates and commit**

`npx vitest run`, `npm run build`.

```bash
git add src/components/enterprise/EnterpriseBrowse.tsx src/components/enterprise/RequisitionPanel.tsx src/styles/ui.css
git commit -m "The business catalogue on the shared listing, with its shelves as tiles and the requisition as a drawer" -m "Same filters, search rule and sort as before, in the side panel; one tile per shelf above the grid with live counts; listings the account's currency does not price are hidden. The requisition keeps its fields and approvals in a drawer." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: The product page in two columns

**Files:**
- Modify: `src/components/ProductDetail.tsx`, `src/styles/ui.css`

**Interfaces:** `ProductDetail`'s props unchanged (it is used by the consumer `product` view, `PublicProductModal`, and possibly `EnterpriseListingModal` — check with `git grep -n "<ProductDetail" -- src`).

- [ ] **Step 1: Restructure**

Keep every data read, handler, the quantity logic, review loading, notify-me, breadcrumbs, the `compact` prop behaviour, and all comments. Lay out:

- `.pd` grid: `minmax(0, 1.2fr) minmax(320px, 0.8fr)`, gap 32px; one column below 1024px.
- Left column (`.pd__main`): the image in a rounded media box; overview (description); a **Specifications** accordion built from `product.specs` (a `<details className="pd-acc">` with `<summary>` "Specifications" and a two-column definition list; hidden when `specs` is empty); a **Seller** block with what is already shown about the seller; then the existing reviews block.
- Right column (`.pd__buy`, `position: sticky; top: 88px` on desktop): title, seller, rating; price with was-price; stock `StatusBadge` (`stockTone`); whatever subscription/contract terms the page already shows; quantity stepper; primary action `btn btn-cyan btn-lg` full width; existing secondary actions below.
- Below 768px, a sticky bottom bar (`.pd__bar`) repeats price and the primary action (only on the full page, not when `compact`).

CSS (append):

```css
/* ---------- Product detail (spec 2) ---------- */
.pd { display: grid; grid-template-columns: minmax(0, 1.2fr) minmax(320px, 0.8fr); gap: 32px; align-items: start; }
.pd__media { border-radius: var(--radius-card); overflow: hidden; background: var(--bg-alt); aspect-ratio: 4 / 3; }
.pd__media img { width: 100%; height: 100%; object-fit: cover; }
.pd__section { margin-top: 24px; }
.pd__section h2 { font-size: var(--text-lg); font-weight: 700; color: var(--text); margin-bottom: 8px; }
.pd-acc { border-radius: var(--radius-md); background: var(--bg-card); box-shadow: var(--shadow-card); padding: 0 16px; }
.pd-acc summary { cursor: pointer; padding: 14px 0; font-weight: 700; color: var(--text); list-style-position: inside; }
.pd-acc dl { display: grid; grid-template-columns: minmax(120px, 40%) 1fr; gap: 8px 16px; padding-bottom: 16px; font-size: var(--text-sm); }
.pd-acc dt { color: var(--text-secondary); }
.pd-acc dd { color: var(--text); margin: 0; }
.pd__buy { position: sticky; top: 88px; display: flex; flex-direction: column; gap: 12px; padding: 24px; border-radius: var(--radius-card); background: var(--bg-card); box-shadow: var(--shadow-card); }
.pd__price { font-size: var(--text-3xl); font-weight: 800; color: var(--text); letter-spacing: -0.01em; }
.pd__bar { display: none; }
@media (max-width: 1023px) { .pd { grid-template-columns: minmax(0, 1fr); } .pd__buy { position: static; } }
@media (max-width: 767px) {
  .pd__bar {
    display: flex; position: sticky; bottom: 0; z-index: 50; align-items: center; justify-content: space-between; gap: 12px;
    padding: 12px 16px calc(12px + env(safe-area-inset-bottom, 0px)); background: var(--bg-card); box-shadow: 0 -4px 16px rgba(16, 35, 68, 0.08);
  }
}
```

- [ ] **Step 2: Gates and commit**

`npx vitest run`, `npm run build`.

```bash
git add src/components/ProductDetail.tsx src/styles/ui.css
git commit -m "The product page in two columns, with the buying decision always in view" -m "What the product is on the left — picture, overview, specifications in an accordion, seller, reviews; price, stock, terms and the button on the right, held in view, and in a bar at the foot of a phone screen. Same fields and actions as before." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Cart drawer and checkout

**Files:**
- Modify: `src/components/CartDrawer.tsx`, `src/components/Checkout.tsx`, `src/styles/ui.css`

- [ ] **Step 1: `CartDrawer.tsx`**

Keep every handler (quantity, remove, checkout), totals logic and comments. Use the `.drawer` classes from Task 7 (header, scrollable body, sticky footer). Line item: 64px rounded thumbnail (`getProductImage`), name, seller, quantity stepper, line price; remove as an icon button with its existing `aria-label`. Footer: subtotal and any existing totals lines, then "Checkout" as `btn btn-cyan` full width. Empty state: the existing copy in a centred block.

- [ ] **Step 2: `Checkout.tsx`**

Keep every field, validation rule, the payment gateway flow, order creation, confirmation screen, empty-cart screen, and all comments. Layout:

```css
/* ---------- Checkout (spec 2) ---------- */
.co { display: grid; grid-template-columns: minmax(0, 1fr) minmax(300px, 380px); gap: 24px; align-items: start; }
.co__step { padding: 24px; border-radius: var(--radius-card); background: var(--bg-card); box-shadow: var(--shadow-card); margin-bottom: 16px; }
.co__step-head { display: flex; align-items: center; gap: 12px; margin-bottom: 16px; }
.co__step-num { width: 28px; height: 28px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; background: var(--brand-navy); color: #fff; font-size: var(--text-sm); font-weight: 700; }
.co__step-head h2 { font-size: var(--text-lg); font-weight: 700; color: var(--text); }
.co__summary { position: sticky; top: 88px; padding: 20px; border-radius: var(--radius-card); background: var(--bg-card); box-shadow: var(--shadow-card); }
@media (max-width: 1023px) { .co { grid-template-columns: minmax(0, 1fr); } .co__summary { position: static; order: -1; } }
```

The two existing sections ("Delivery details", "Payment method") become `.co__step` cards numbered 1 and 2, keeping their `<h2>` text. The order summary (items, totals, the place-order button as `btn btn-cyan btn-lg` full width) moves to `.co__summary`. Inputs keep their labels; give text inputs a 44px height and `--border` outline with an electric focus ring if they don't already have one, via a `.co input, .co select` rule.

- [ ] **Step 3: Gates and commit**

`npx vitest run`, `npm run build`.

```bash
git add src/components/CartDrawer.tsx src/components/Checkout.tsx src/styles/ui.css
git commit -m "A cart and a checkout that read top to bottom, with the total always in view" -m "The drawer gets clear line items and a sticky total; checkout becomes two numbered steps beside an order summary that stays on screen. Fields, validation and the payment flow are unchanged." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Browser verification

The controller runs this with the `run-app` skill and Chrome, as in spec 1. No commits unless a fix is needed; fixes go to a subagent.

- [ ] Consumer, at 1280 / 1024 / 390: home → a category → filter, sort, search → product page → add to basket → cart drawer → checkout screen. Stop before placing an order.
- [ ] Enterprise: browse → a category tile → filters → compare two → open a listing → add to requisition → requisition drawer. Stop before submitting.
- [ ] Public: header search for a word that matches products lands on Retail with the box filled and the grid filtered; the phone menu offers search.
- [ ] Market: India and Kenya — SKU-7011 absent in India, present in Kenya, on public Retail/Enterprise and on the signed-in grids.
- [ ] Programmatic contrast scan (the spec 1 scanner) on every screen above — zero failures.
- [ ] Keyboard: filters sheet (open, Escape returns focus), accordion, cart and requisition drawers.
- [ ] Render cost: in a foreground tab, measure frame time on the consumer home (two `requestAnimationFrame`s); record the result, and if paints exceed ~100ms, profile and fix the cause.
- [ ] `npm run test:integration` compared with `main`.

---

### Task 11: Docs

**Files:** `README.md`, `docs/superpowers/backlog.md`

- [ ] README Design system section: add the card's new props (one line each), `ListingLayout`, and the market rule (`pricedFor` — products not priced in the visitor's currency are hidden from shop listings).
- [ ] Backlog: spec 2 row → "Done — merged <date> (<sha>)" at merge time; add any minors deferred during spec 2.
- [ ] Commit: "The README and backlog catch up with the shop screens" (+ trailer).
