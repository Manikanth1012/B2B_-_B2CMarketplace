/* What the public homepage shows, decided here rather than in components.
   No React and no Supabase, so every choice is testable in the Node suite. */

import type { Category } from '../types'
import type { PublicPage } from '../types/view'
import {
  retailCategories, categoryDestination, isSellable, showcaseOrder, soldTo,
  type SellableProduct, type Shopper,
} from './storefront'
import { HERO, CAROUSEL, BANNERS, HOME } from './assets'

/** The products in the Featured band: live, on a shelf the retail page lists
    (so "View all products" always shows them), sold to consumers, in showcase
    order. Given `currency`, a product priced in any other is left out: one not
    priced for the visitor's market would print a base-currency amount under the
    local symbol, and is usually a seller not approved in that market. A product
    with no `currency` field is kept. */
export function featuredProducts<T extends SellableProduct & { currency?: string }>(
  products: readonly T[],
  categories: readonly Category[],
  n = 4,
  currency?: string,
): T[] {
  const shelves = new Set(retailCategories(categories).map(c => c.id))
  return products
    .filter(p => shelves.has(p.category_id) && isSellable(p) && soldTo(p, 'consumer')
      && (!currency || !p.currency || p.currency === currency))
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
  device: { src: HOME.categoryDevice },
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
