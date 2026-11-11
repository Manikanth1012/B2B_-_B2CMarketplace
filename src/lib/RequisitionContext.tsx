/* The requisition a business buyer is building, held once for the whole console.
 *
 * Four screens sell the same shelf — Browse Catalogue and the three vertical
 * marketplaces — and a buyer moves between them mid-decision, so a basket owned
 * by any one of them would empty itself on the way to the next. It lives here
 * for the same reason the market does: one answer, read wherever it is needed.
 *
 * Not persisted, unlike the market. A market choice survives a reload because it
 * is a preference; an unraised requisition is work in progress against prices
 * and a policy that are re-read on every load, and restoring one from last week
 * would put stale figures in front of an approver.
 */
import { createContext, useContext, useMemo, useState, useRef, useCallback, useEffect } from 'react'
import type { ReactNode } from 'react'
import {
  EMPTY_BASKET, addToBasket, setQuantity as setQty, removeLine as dropLine, repriceTo,
  basketCount, basketTotal, setReason as setLineReason,
} from './requisitionBasket'
import type { Basket, BasketLine } from './requisitionBasket'
import { addBundleToBasket, removeBundleFromBasket } from './bundleLines'

type AddBundle = (lines: BasketLine[], currency: string, replaceSelectionId?: string) =>
  { ok: true; note: string } | { ok: false; reason: string }

/* The bundle configurator's hand-off reaches the basket from outside the tree
   (a window event opens it from anywhere), so the provider lends its
   `addBundle` here while it is mounted. Null when there is no provider. */
let bridge: AddBundle | null = null

/** Put a whole configured bundle into the requisition being built. */
export function addBundleToRequisition(lines: BasketLine[], currency: string, replaceSelectionId?: string):
  { ok: true; note: string } | { ok: false; reason: string } {
  if (!bridge) return { ok: false, reason: 'There is no requisition open to add the bundle to.' }
  return bridge(lines, currency, replaceSelectionId)
}

export interface RequisitionState {
  basket: Basket
  count: number
  total: number
  /** Whether the review panel is showing. */
  open: boolean
  setOpen: (open: boolean) => void
  /* Every mutation answers rather than throwing, because every one of them can
     legitimately refuse — a second currency, a mixed commitment, a quantity
     nobody meant — and the caller has to say so out loud. */
  add: (line: Omit<BasketLine, 'quantity'>, currency: string, quantity?: number) =>
    { ok: true; note?: string } | { ok: false; reason: string }
  setQuantity: (product_id: string, quantity: number) =>
    { ok: true } | { ok: false; reason: string }
  remove: (product_id: string) => void
  /** Why an ordinary line is bought off the account's price book. */
  setReason: (product_id: string, reason: string) =>
    { ok: true } | { ok: false; reason: string }
  /** A configured bundle, whole; in place of `replaceSelectionId` when given. */
  addBundle: AddBundle
  /** Every line of one bundle. */
  removeBundle: (selectionId: string) => void
  empty: () => void
  /** Move the whole basket onto another currency's shelf. Returns what fell off. */
  reprice: (currency: string, shelf: readonly { id: string; price: number; model: string; unit: string | null; currency?: string; on_contract?: boolean }[]) => string[]
}

const Ctx = createContext<RequisitionState | null>(null)

export function RequisitionProvider({ children }: { children: ReactNode }) {
  const [basket, setBasketState] = useState<Basket>(EMPTY_BASKET)
  const [open, setOpen] = useState(false)

  /* The basket twice over, and deliberately.

     Every operation here has to answer its caller in the same tick — "no, this
     one is monthly and yours is a one-off" is the whole point of the return
     value. A functional `setState` updater cannot do that: React runs it when
     it gets round to rendering, so the refusal would arrive after the caller
     had already decided there was nothing to say. The ref is what the
     operations read and write; the state is what the tree renders. */
  const live = useRef<Basket>(EMPTY_BASKET)
  const commit = useCallback((next: Basket) => {
    live.current = next
    setBasketState(next)
  }, [])

  const add: RequisitionState['add'] = useCallback((line, currency, quantity = 1) => {
    const wasEmpty = live.current.lines.length === 0
    const r = addToBasket(live.current, line, currency, quantity)
    if (!r.ok) return { ok: false, reason: r.reason }
    commit(r.basket)
    /* The panel opens on the first thing put in it, and not again after that.

       A toast at the bottom-right for three and a half seconds was the only
       acknowledgement, and the report was that nothing happened when a SKU was
       added — from somebody looking at the card they had just clicked, three
       hundred pixels away. Opening once shows what the button did and where the
       requisition lives; opening on every add would fight anybody filling a
       basket of six. */
    if (wasEmpty) setOpen(true)
    return { ok: true, note: r.note }
  }, [commit])

  const setQuantity: RequisitionState['setQuantity'] = useCallback((product_id, quantity) => {
    const r = setQty(live.current, product_id, quantity)
    if (!r.ok) return { ok: false, reason: r.reason }
    commit(r.basket)
    return { ok: true }
  }, [commit])

  const remove = useCallback((product_id: string) => {
    const r = dropLine(live.current, product_id)
    if (r.ok) commit(r.basket)
  }, [commit])

  const setReason: RequisitionState['setReason'] = useCallback((product_id, reason) => {
    const r = setLineReason(live.current, product_id, reason)
    if (!r.ok) return { ok: false, reason: r.reason }
    commit(r.basket)
    return { ok: true }
  }, [commit])

  const empty = useCallback(() => commit(EMPTY_BASKET), [commit])

  const addBundle: AddBundle = useCallback((lines, currency, replaceSelectionId) => {
    const wasEmpty = live.current.lines.length === 0
    const r = addBundleToBasket(live.current, lines, currency, replaceSelectionId)
    if (!r.ok) return r
    commit(r.basket)
    if (wasEmpty) setOpen(true)
    return { ok: true, note: r.note }
  }, [commit])

  const removeBundle = useCallback((selectionId: string) => {
    commit(removeBundleFromBasket(live.current, selectionId))
  }, [commit])

  useEffect(() => {
    bridge = addBundle
    return () => { if (bridge === addBundle) bridge = null }
  }, [addBundle])

  const reprice: RequisitionState['reprice'] = useCallback((currency, shelf) => {
    const r = repriceTo(live.current, currency, shelf)
    commit(r.basket)
    return r.dropped
  }, [commit])

  const value = useMemo<RequisitionState>(() => ({
    basket,
    count: basketCount(basket),
    total: basketTotal(basket),
    open, setOpen, add, setQuantity, remove, setReason, addBundle, removeBundle, empty, reprice,
  }), [basket, open, add, setQuantity, remove, setReason, addBundle, removeBundle, empty, reprice])

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useRequisition(): RequisitionState {
  const v = useContext(Ctx)
  if (!v) throw new Error('useRequisition outside a RequisitionProvider')
  return v
}
