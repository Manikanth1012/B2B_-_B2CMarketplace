/* What a shop needs to show and price bundles in one currency: the templates
 * the persona can see (RLS) and every product a template offers, with its
 * price-book row. Both reads go through bundleRepo; this keeps only a short
 * cache and the hook, shared by the bundle cards and the configurator.
 *
 * A failed read — including the bundle tables not existing yet, before the
 * migration is applied — leaves the shelf empty, so the shop renders as it
 * does without bundles. The reason is reported in `loadError` (and once to
 * the console), never swallowed.
 *
 * The cache is keyed by the signed-in user and the currency, and emptied when
 * the user changes (spec 11, decision 9): templates are read under row-level
 * security, so one person's shelf is never handed to the next who signs in on
 * the same page. Same 60 s freshness for one person.
 */
import { useEffect, useState } from 'react'
import { loadBundleBook, loadBundleParts } from '../../lib/bundleRepo'
import { useMarket } from '../../lib/MarketContext'
import { EMPTY_SHELF, bundleCurrency, type Shelf } from './shelf'
import { BUNDLES_CHANGED } from './events'
import { onUserChange } from '../../lib/authRepo'

interface Loaded { shelf: Shelf; loadError: string | null }

const cache = new Map<string, { at: number; promise: Promise<Loaded> }>()
const FRESH_MS = 60_000

/* Who the cache was filled for. `undefined` until the session has been read. */
let cachedFor: string | null | undefined

/** The user changed (or was first read): a cache filled for anybody else goes. */
function forUser(id: string | null) {
  if (id === cachedFor) return
  cache.clear()
  cachedFor = id
}

const keyOf = (userId: string | null, currency: string) => `${userId ?? 'anon'}:${currency}`

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

function load(userId: string | null, currency: string): Promise<Loaded> {
  const key = keyOf(userId, currency)
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < FRESH_MS) return hit.promise
  const promise = read(currency)
    .catch(err => ({ shelf: EMPTY_SHELF, loadError: err instanceof Error ? err.message : String(err) }))
    .then(r => {
      if (r.loadError) console.warn(`Bundles are not shown: ${r.loadError}`)
      return r
    })
  cache.set(key, { at: Date.now(), promise })
  return promise
}

/** The bundle shelf for a currency; `null` currency (not known yet) is empty.
    A shelf read for another currency is never returned, so figures are never
    formatted in the wrong money while the new one loads. */
export function useBundleShelf(currency: string | null): Loaded & { loading: boolean } {
  const [state, setState] = useState<Loaded & { currency: string | null; userId?: string | null }>({ shelf: EMPTY_SHELF, loadError: null, currency: null })
  const [tick, setTick] = useState(0)
  /* Undefined until the session is known, so nothing is read for the wrong person. */
  const [userId, setUserId] = useState<string | null | undefined>(undefined)

  useEffect(() => {
    try {
      return onUserChange(id => { forUser(id); setUserId(id) })
    } catch (e) {
      /* No auth client (a test without one): read as a visitor. */
      console.warn(`The signed-in user could not be read for the bundle shelf (${e instanceof Error ? e.message : String(e)}).`)
      setUserId(null)
      return undefined
    }
  }, [])

  useEffect(() => {
    const again = () => { cache.clear(); setTick(t => t + 1) }
    window.addEventListener(BUNDLES_CHANGED, again)
    return () => window.removeEventListener(BUNDLES_CHANGED, again)
  }, [])

  useEffect(() => {
    if (!currency || userId === undefined) return
    let live = true
    void load(userId, currency).then(r => { if (live) setState({ ...r, currency, userId }) })
    return () => { live = false }
  }, [currency, tick, userId])

  if (!currency) return { shelf: EMPTY_SHELF, loadError: null, loading: false }
  if (state.currency !== currency || userId === undefined || state.userId !== userId) return { shelf: EMPTY_SHELF, loadError: null, loading: true }
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
