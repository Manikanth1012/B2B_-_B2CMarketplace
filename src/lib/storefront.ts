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

/** Where a banner's call to action goes. The public front has three destinations
    and no per-banner link column, so the audience the operator chose decides. */
export function bannerDestination(audience: string): PublicPage {
  const a = audience.toLowerCase()
  if (a.includes('enterprise') || a.includes('b2b')) return 'enterprise'
  if (a.includes('partner')) return 'partner'
  return 'retail'
}

/* --------------------------------------------------------------- categories */

/* The landing rails are "Retail products" and "Enterprise products", and every
   category carries the audience it serves — 'B2C', 'Enterprise', 'B2B2X',
   'Consumer & Enterprise'. Reading that string is what keeps the rails honest: a
   category added in the operator console lands in the right rail without anyone
   editing a list here.

   Two consequences worth stating rather than discovering:
     * 'Consumer & Enterprise' (Devices) matches both, and appears in both rails.
       That is what the audience says, and devices genuinely sell to both.
     * 'B2B2X' (Partner) is a business audience, so it rides the enterprise rail. */
function serves(category: Category, ...needles: string[]): boolean {
  const a = category.audience.toLowerCase()
  return needles.some(n => a.includes(n))
}

export function retailCategories(categories: readonly Category[]): Category[] {
  return categories
    .filter(c => serves(c, 'b2c', 'consumer'))
    .sort((a, b) => a.sort_order - b.sort_order)
}

export function enterpriseCategories(categories: readonly Category[]): Category[] {
  return categories
    .filter(c => serves(c, 'enterprise', 'b2b'))
    .sort((a, b) => a.sort_order - b.sort_order)
}

/** Where a category tile goes from the public landing page. */
export function categoryDestination(category: Category): PublicPage {
  if (serves(category, 'b2b2x')) return 'partner'
  if (serves(category, 'b2c', 'consumer')) return 'retail'
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
}

/** Is this catalogue row something a visitor can actually be offered? */
export function isSellable(p: { status: string }): boolean {
  return SELLABLE.has(p.status.toLowerCase())
}

/**
 * The products an audience page lists: live rows in that page's categories, in the
 * catalogue's own order. `limit` keeps the page to a browsable length rather than
 * printing the whole catalogue.
 */
export function productsForPage<T extends SellableProduct>(
  products: readonly T[],
  categories: readonly Category[],
  page: Exclude<PublicPage, 'landing'>,
  limit = 12,
): T[] {
  const ids = new Set(categoriesForPage(page, categories).map(c => c.id))
  return products
    .filter(p => ids.has(p.category_id) && isSellable(p))
    .sort((a, b) => a.sort_order - b.sort_order || a.id.localeCompare(b.id))
    .slice(0, limit)
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
