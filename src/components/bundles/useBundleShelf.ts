/* Reads what a shop needs to show and price bundles in one currency: the
 * templates the persona can see (RLS), and the name, stock and price-book row
 * of every product a template offers.
 *
 * Shared by the shop's bundle cards and the configurator, so one read serves
 * both. A failed read — including the bundle tables not existing yet, before
 * the migration is applied — is an empty shelf: the shop renders as it does
 * without bundles, and the reason is kept for whoever asks (`loadError`).
 */
import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { loadBundleBook } from '../../lib/bundleRepo'
import { EMPTY_SHELF, type Shelf, type ShelfPart } from './shelf'
import { BUNDLES_CHANGED } from './events'

interface Loaded { shelf: Shelf; loadError: string | null }

const cache = new Map<string, { at: number; promise: Promise<Loaded> }>()
const FRESH_MS = 60_000

async function read(currency: string): Promise<Loaded> {
  const book = await loadBundleBook()
  if (book.loadError || book.templates.length === 0) {
    return { shelf: EMPTY_SHELF, loadError: book.loadError }
  }
  const ids = [...new Set(book.options.map(o => o.product_id))]
  const parts = new Map<string, ShelfPart>()
  if (ids.length) {
    try {
      const [p, pr] = await Promise.all([
        supabase.from('products').select('id, name, seller, category_id, stock, status, unit').in('id', ids),
        supabase.from('product_prices').select('product_id, price, floor_price').eq('currency', currency).in('product_id', ids),
      ])
      if (p.error) return { shelf: EMPTY_SHELF, loadError: p.error.message }
      if (pr.error) return { shelf: EMPTY_SHELF, loadError: pr.error.message }
      const prices = new Map(((pr.data ?? []) as { product_id: string; price: number; floor_price: number | null }[])
        .map(r => [r.product_id, r]))
      for (const r of (p.data ?? []) as Record<string, unknown>[]) {
        const row = prices.get(String(r.id))
        parts.set(String(r.id), {
          id: String(r.id), name: String(r.name), seller: String(r.seller ?? ''),
          category_id: r.category_id == null ? null : String(r.category_id),
          stock: String(r.stock ?? 'in'), status: String(r.status ?? ''), unit: r.unit == null ? null : String(r.unit),
          list: row ? Number(row.price) : null,
          floor: row && row.floor_price != null ? Number(row.floor_price) : null,
        })
      }
    } catch (err) {
      return { shelf: EMPTY_SHELF, loadError: err instanceof Error ? err.message : String(err) }
    }
  }
  return { shelf: { templates: book.templates, slots: book.slots, options: book.options, parts }, loadError: null }
}

function load(currency: string): Promise<Loaded> {
  const hit = cache.get(currency)
  if (hit && Date.now() - hit.at < FRESH_MS) return hit.promise
  const promise = read(currency).catch(err => ({ shelf: EMPTY_SHELF, loadError: err instanceof Error ? err.message : String(err) }))
  cache.set(currency, { at: Date.now(), promise })
  return promise
}

/** The bundle shelf for a currency; `null` currency (not known yet) is empty. */
export function useBundleShelf(currency: string | null): Loaded & { loading: boolean } {
  const [state, setState] = useState<Loaded & { loading: boolean }>({ shelf: EMPTY_SHELF, loadError: null, loading: !!currency })
  const [tick, setTick] = useState(0)

  useEffect(() => {
    const again = () => { cache.clear(); setTick(t => t + 1) }
    window.addEventListener(BUNDLES_CHANGED, again)
    return () => window.removeEventListener(BUNDLES_CHANGED, again)
  }, [])

  useEffect(() => {
    if (!currency) { setState({ shelf: EMPTY_SHELF, loadError: null, loading: false }); return }
    let live = true
    setState(s => ({ ...s, loading: true }))
    void load(currency).then(r => { if (live) setState({ ...r, loading: false }) })
    return () => { live = false }
  }, [currency, tick])

  return state
}
