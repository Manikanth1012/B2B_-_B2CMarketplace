import { supabase } from './supabase'
import type { Category, Product } from '../types'
import type { PublicBanner } from './storefront'
import { isSellable } from './storefront'

/* Everything the signed-out storefront reads. Three tables, all of them readable
   without a session by design — `categories` and `products` carry an anon SELECT
   policy, and `public_banners` is a view over the operator's banners with the
   commercial columns dropped. Nothing else on the public front touches Supabase. */

/** The operator's live storefront promos. Empty is a valid answer: it means every
    banner is paused or out of its date window, and the strip should disappear. */
export async function loadPromoBanners(): Promise<PublicBanner[]> {
  const { data, error } = await supabase
    .from('public_banners')
    .select('id,slot,title,subtitle,cta,audience,destination,weight,sort_order')
  if (error) return []
  return (data ?? []) as PublicBanner[]
}

export async function loadCategories(): Promise<Category[]> {
  const { data, error } = await supabase
    .from('categories').select('*').order('sort_order')
  if (error) return []
  return (data ?? []) as Category[]
}

/** The catalogue rows the public pages show. The audience split and the live-row
    filter are applied in `storefront.ts`, so this stays a plain read. */
export async function loadCatalogue(): Promise<Product[]> {
  const { data, error } = await supabase
    .from('products').select('*').order('sort_order')
  if (error) return []
  return (data ?? []) as Product[]
}

/** How many live products sit in each category — the "N products" line on a category
    tile. Counts only what a visitor could actually be offered: a tile claiming eight
    when one is suspended is advertising a listing nobody can buy. Counted here rather
    than in SQL because the public front already has the catalogue in hand. */
export function countByCategory(products: readonly Product[]): Record<string, number> {
  const out: Record<string, number> = {}
  for (const p of products) {
    if (!isSellable(p)) continue
    out[p.category_id] = (out[p.category_id] ?? 0) + 1
  }
  return out
}
