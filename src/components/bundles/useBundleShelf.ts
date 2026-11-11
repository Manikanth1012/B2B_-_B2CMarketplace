/* What a shop needs to show and price bundles in one currency: the templates
 * the persona can see (RLS) and every product a template offers, with its
 * price-book row. Both reads go through bundleRepo; this keeps only a short
 * cache and the hook, shared by the bundle cards and the configurator.
 *
 * A failed read — including the bundle tables not existing yet, before the
 * migration is applied — leaves the shelf empty, so the shop renders as it
 * does without bundles. The reason is reported in `loadError` (and once to
 * the console), never swallowed.
 */
import { useEffect, useState } from 'react'
import { loadBundleBook, loadBundleParts } from '../../lib/bundleRepo'
import { useMarket } from '../../lib/MarketContext'
import { EMPTY_SHELF, bundleCurrency, type Shelf } from './shelf'
import { BUNDLES_CHANGED } from './events'

interface Loaded { shelf: Shelf; loadError: string | null }

const cache = new Map<string, { at: number; promise: Promise<Loaded> }>()
const FRESH_MS = 60_000

async function read(currency: string): Promise<Loaded> {
  const book = await loadBundleBook()
  if (book.loadError) return { shelf: EMPTY_SHELF, loadError: book.loadError }
  if (book.templates.length === 0) return { shelf: EMPTY_SHELF, loadError: null }
  const parts = await loadBundleParts(book.options.map(o => o.product_id), currency)
  if (!parts.ok) return { shelf: EMPTY_SHELF, loadError: `The bundle parts did not load (${parts.error}).` }
  return {
    shelf: { templates: book.templates, slots: book.slots, options: book.options, parts: new Map(parts.value.map(p => [p.id, p])) },
    loadError: null,
  }
}

function load(currency: string): Promise<Loaded> {
  const hit = cache.get(currency)
  if (hit && Date.now() - hit.at < FRESH_MS) return hit.promise
  const promise = read(currency)
    .catch(err => ({ shelf: EMPTY_SHELF, loadError: err instanceof Error ? err.message : String(err) }))
    .then(r => {
      if (r.loadError) console.warn(`Bundles are not shown: ${r.loadError}`)
      return r
    })
  cache.set(currency, { at: Date.now(), promise })
  return promise
}

/** The bundle shelf for a currency; `null` currency (not known yet) is empty.
    A shelf read for another currency is never returned, so figures are never
    formatted in the wrong money while the new one loads. */
export function useBundleShelf(currency: string | null): Loaded & { loading: boolean } {
  const [state, setState] = useState<Loaded & { currency: string | null }>({ shelf: EMPTY_SHELF, loadError: null, currency: null })
  const [tick, setTick] = useState(0)

  useEffect(() => {
    const again = () => { cache.clear(); setTick(t => t + 1) }
    window.addEventListener(BUNDLES_CHANGED, again)
    return () => window.removeEventListener(BUNDLES_CHANGED, again)
  }, [])

  useEffect(() => {
    if (!currency) return
    let live = true
    void load(currency).then(r => { if (live) setState({ ...r, currency }) })
    return () => { live = false }
  }, [currency, tick])

  if (!currency) return { shelf: EMPTY_SHELF, loadError: null, loading: false }
  if (state.currency !== currency) return { shelf: EMPTY_SHELF, loadError: null, loading: true }
  return { shelf: state.shelf, loadError: state.loadError, loading: false }
}

/** The currency bundles are priced in for this viewer, and the shop's. A
    bundle is always priced in the buyer's own currency — consumer home or
    business account — because that is the only one configure_bundle takes. */
export function useBundleCurrency(): { currency: string | null; header: string | null; own: boolean } {
  const { currency, market, account, ready } = useMarket()
  const header = currency?.code ?? market?.currency ?? null
  return { currency: ready ? bundleCurrency(account, header) : null, header, own: !!account }
}
