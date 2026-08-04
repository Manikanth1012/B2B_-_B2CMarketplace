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
import { createContext, useContext, useMemo, useState, useRef, useCallback } from 'react'
import type { ReactNode } from 'react'
import {
  EMPTY_BASKET, addToBasket, setQuantity as setQty, removeLine as dropLine, repriceTo,
  basketCount, basketTotal,
} from './requisitionBasket'
import type { Basket, BasketLine } from './requisitionBasket'

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
  empty: () => void
  /** Move the whole basket onto another currency's shelf. Returns what fell off. */
  reprice: (currency: string, shelf: readonly { id: string; price: number; model: string; unit: string | null }[]) => string[]
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

  const empty = useCallback(() => commit(EMPTY_BASKET), [commit])

  const reprice: RequisitionState['reprice'] = useCallback((currency, shelf) => {
    const r = repriceTo(live.current, currency, shelf)
    commit(r.basket)
    return r.dropped
  }, [commit])

  const value = useMemo<RequisitionState>(() => ({
    basket,
    count: basketCount(basket),
    total: basketTotal(basket),
    open, setOpen, add, setQuantity, remove, empty, reprice,
  }), [basket, open, add, setQuantity, remove, empty, reprice])

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useRequisition(): RequisitionState {
  const v = useContext(Ctx)
  if (!v) throw new Error('useRequisition outside a RequisitionProvider')
  return v
}
