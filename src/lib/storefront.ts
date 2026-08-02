/* What the public landing page shows, decided here rather than in the component.
   No React and no Supabase, so the rules can be tested without a DOM or a network. */

import type { Category } from '../types'
import type { PublicPage } from '../types/view'

/* ------------------------------------------------------------------ banners */

/** A row of `public_banners` — the operator's banner with the commercial columns
    dropped and the live-right-now filter already applied by the view. */
export interface PublicBanner {
  id: string
  slot: string
  title: string
  subtitle: string | null
  cta: string
  audience: string
  /* Where the call to action goes, chosen by the operator. Null falls back to the
     audience, which is what the strip used to infer for everything. */
  destination: string | null
  weight: number
  sort_order: number
}

/* The operator can file a banner under four slots. Only these two are the
   storefront; `login` belongs on the sign-in screen and `category_header` above a
   category listing, and showing either here would put a banner where its author
   did not ask for it. */
export const STOREFRONT_SLOTS: readonly string[] = ['storefront_hero', 'storefront_strip']

export interface PromoSlide {
  banner: PublicBanner
  image: string
}

/* A row keeps the same artwork from render to render, so pausing a banner in the
   operator console does not reshuffle the pictures on the ones either side of it.
   Derived from the id rather than the position for exactly that reason. */
function hash(id: string): number {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0
  return h
}

/**
 * One image per id, stable across renders and distinct within the group. Two rows
 * landing on the same picture is harmless but reads as a mistake, so a collision
 * probes for the next free image; with fewer ids than images that always succeeds,
 * and with more it wraps and repeats rather than failing.
 */
export function assignImages(
  ids: readonly string[],
  images: readonly string[],
): Record<string, string> {
  if (images.length === 0) return {}
  const taken = new Set<number>()
  const out: Record<string, string> = {}
  for (const id of ids) {
    let i = hash(id) % images.length
    for (let n = 0; n < images.length && taken.has(i); n++) i = (i + 1) % images.length
    taken.add(i)
    out[id] = images[i]
  }
  return out
}

/**
 * The promo strip: the operator's live storefront banners, heaviest first, each
 * paired with a stable image. Returns at most `limit` slides, and fewer — or none —
 * when the operator has paused them, which is the correct outcome rather than a bug.
 */
export function promoStrip(
  banners: readonly PublicBanner[],
  images: readonly string[],
  limit = 4,
): PromoSlide[] {
  if (images.length === 0) return []

  const live = banners
    .filter(b => STOREFRONT_SLOTS.includes(b.slot))
    /* Weight is the operator's own priority dial. sort_order breaks a tie the way
       the console lists them, and the id breaks it after that so the order never
       depends on the order rows came back in. */
    .sort((a, b) =>
      b.weight - a.weight ||
      a.sort_order - b.sort_order ||
      a.id.localeCompare(b.id))
    .slice(0, limit)

  const art = assignImages(live.map(b => b.id), images)
  return live.map(banner => ({ banner, image: art[banner.id] }))
}

const PAGES: readonly string[] = ['landing', 'retail', 'enterprise', 'partner']

/**
 * Where a banner's call to action goes.
 *
 * This used to be inferred from `audience` alone, which conflates two things:
 * audience is who the banner is *shown to*, the destination is where the click
 * *lands*. "Become a marketplace seller · Apply to sell" is shown to everyone, so its
 * audience is `all`, and inferring from that sent would-be sellers to the retail shop.
 * The operator now chooses; the old inference remains as the fallback.
 */
export function bannerDestination(banner: { audience: string; destination?: string | null }): PublicPage {
  const chosen = banner.destination?.toLowerCase()
  if (chosen && PAGES.includes(chosen)) return chosen as PublicPage

  const a = banner.audience.toLowerCase()
  if (a.includes('enterprise') || a.includes('b2b')) return 'enterprise'
  if (a.includes('partner')) return 'partner'
  return 'retail'
}

/* --------------------------------------------------------------- categories */

/**
 * Who may actually buy from a category.
 *
 * This reads `shoppable_by`, which the operator sets, and nothing else. It used
 * to be inferred from the `audience` prose — 'B2C', 'B2B2X', 'Consumer &
 * Enterprise' — by substring match, in four different places with four slightly
 * different sets of needles. That is how the Partner category, which sells
 * white-label storefronts and wholesale packs of 500 lines to resellers, ended
 * up on the retail home page with a Browse button on it.
 *
 * `audience` is still what a tile prints and still decides which landing rail
 * promotes a category. It is no longer what a permission branches on.
 */
export type Shopper = 'consumer' | 'enterprise' | 'partner'

export function shoppableBy(category: Category, who: Shopper): boolean {
  return (category.shoppable_by ?? []).includes(who)
}

/** The categories that persona may buy from, in the catalogue's own order. */
export function categoriesFor(categories: readonly Category[], who: Shopper): Category[] {
  return categories
    .filter(c => shoppableBy(c, who))
    .sort((a, b) => a.sort_order - b.sort_order)
}

/* The two landing rails are "Retail products" and "Enterprise products", and
   which rail promotes a category is still the `audience` prose — that is a
   merchandising choice and the operator writes it as a sentence. IoT reads
   'Enterprise' and is promoted there even though a retail customer can buy a
   sensor, and that is the operator's call rather than a contradiction.

   What the rails now also do is refuse to promote a shelf to somebody who
   cannot buy from it, which is what kept Partner on the enterprise rail. Both
   conditions have to hold, so the prose can lead and the column can veto. */
function promotedTo(category: Category, ...needles: string[]): boolean {
  const a = category.audience.toLowerCase()
  return needles.some(n => a.includes(n))
}

export function retailCategories(categories: readonly Category[]): Category[] {
  return categoriesFor(categories, 'consumer')
    .filter(c => promotedTo(c, 'b2c', 'consumer'))
}

export function enterpriseCategories(categories: readonly Category[]): Category[] {
  return categoriesFor(categories, 'enterprise')
    .filter(c => promotedTo(c, 'enterprise', 'b2b'))
}

/**
 * Where a category tile goes from the public landing page.
 *
 * A category only a reseller can buy from sends a visitor to the partner page,
 * which is the shop window for becoming one rather than a shelf. Everything
 * else goes where the rail that promotes it goes.
 */
export function categoryDestination(category: Category): PublicPage {
  if (!shoppableBy(category, 'consumer') && !shoppableBy(category, 'enterprise')) return 'partner'
  if (promotedTo(category, 'b2c', 'consumer')) return 'retail'
  return 'enterprise'
}

/** The categories an audience page covers. The partner page is the shop window for
    sellers, so it shows everything that can be listed rather than a buyer's slice. */
export function categoriesForPage(
  page: Exclude<PublicPage, 'landing'>,
  categories: readonly Category[],
): Category[] {
  if (page === 'retail') return retailCategories(categories)
  if (page === 'enterprise') return enterpriseCategories(categories)
  return [...categories].sort((a, b) => a.sort_order - b.sort_order)
}

/* ----------------------------------------------------------------- products */

/* Only these reach a shopper. The operator's catalogue also carries drafts and
   delisted rows, and a public page showing either would be advertising something
   nobody can buy. */
const SELLABLE = new Set(['live', 'active', 'published'])

export interface SellableProduct {
  id: string
  name: string
  seller: string
  price: number
  was_price: number | null
  rating: number | null
  reviews: number
  stock: string
  badge: string | null
  unit: string | null
  category_id: string
  status: string
  sort_order: number
  /* Who this particular thing is sold to. A shelf being visible has never
     meant everything on it is for sale to you: IoT carries a $52 occupancy
     sensor and a fifty-unit fleet bundle, and only one of those is a purchase
     a private individual makes. Optional so a caller that has not selected the
     column is not silently filtered to nothing. */
  audiences?: string[] | null
}

/** Is this catalogue row something a visitor can actually be offered? */
export function isSellable(p: { status: string }): boolean {
  return SELLABLE.has(p.status.toLowerCase())
}

/**
 * Whether this product is sold to that persona.
 *
 * A missing `audiences` means the caller did not ask for the column, not that
 * the product is for nobody — so it is treated as unrestricted and the
 * category rule alone applies. Getting that backwards empties every grid on
 * the site the first time somebody forgets a select.
 */
export function soldTo(p: { audiences?: string[] | null }, who: Shopper): boolean {
  const a = p.audiences
  return !a || a.length === 0 || a.includes(who)
}

/** The shopper a public page is written for. The seller page is a shop window
    rather than a shelf, so it is not filtered to a buyer's slice. */
const PAGE_SHOPPER: Record<string, Shopper> = { retail: 'consumer', enterprise: 'enterprise' }

/**
 * The products an audience page lists: live rows in that page's categories that
 * are actually sold to that page's shopper, in the catalogue's own order.
 * `limit` keeps the page to a browsable length rather than printing the whole
 * catalogue.
 */
export function productsForPage<T extends SellableProduct>(
  products: readonly T[],
  categories: readonly Category[],
  page: Exclude<PublicPage, 'landing'>,
  limit = 12,
): T[] {
  const ids = new Set(categoriesForPage(page, categories).map(c => c.id))
  const who = PAGE_SHOPPER[page]
  return products
    .filter(p => ids.has(p.category_id) && isSellable(p) && (!who || soldTo(p, who)))
    .sort((a, b) => a.sort_order - b.sort_order || a.id.localeCompare(b.id))
    .slice(0, limit)
}

/** Everything on one shelf that this persona may actually buy. */
export function productsFor<T extends SellableProduct>(
  products: readonly T[], who: Shopper, categoryId?: string,
): T[] {
  return products
    .filter(p => isSellable(p) && soldTo(p, who) && (!categoryId || p.category_id === categoryId))
    .sort((a, b) => a.sort_order - b.sort_order || a.id.localeCompare(b.id))
}

/** "In stock" / "Low stock" / "Out of stock" drive whether a product can be added,
    so the decision lives here rather than in a template. */
export function canAddToBasket(p: { stock: string }): boolean {
  return !p.stock.toLowerCase().includes('out')
}

/**
 * A few real listings to stand for a category — what a prospective seller is shown
 * under "what sells here". Showcase order, not catalogue order: what the operator
 * flagged as a bestseller first, then what buyers rated highest, and `sort_order`
 * only to break the remaining ties so the choice is stable between renders.
 */
export function exampleProducts<T extends SellableProduct>(
  products: readonly T[],
  categoryId: string,
  limit = 3,
): T[] {
  return products
    .filter(p => p.category_id === categoryId && isSellable(p))
    .sort((a, b) =>
      Number(b.badge === 'Bestseller') - Number(a.badge === 'Bestseller') ||
      (b.rating ?? 0) - (a.rating ?? 0) ||
      a.sort_order - b.sort_order ||
      a.id.localeCompare(b.id))
    .slice(0, limit)
}
