/* The requisition a business buyer is building, held once for the whole console.
 *
 * Four screens sell the same shelf — Browse Catalogue and the three vertical
 * marketplaces — and a buyer moves between them mid-decision, so a basket owned
 * by any one of them would empty itself on the way to the next. It lives here
 * for the same reason the market does: one answer, read wherever it is needed.
 *
 * Kept in the database now (spec 11, decision 1), one basket per buyer on any
 * device. It used not to be: an unraised requisition is work in progress
 * against prices and a policy that move, and restoring last week's would put
 * stale figures in front of an approver. Two things changed that. The operator
 * has to see pending and abandoned baskets, which only the database can show;
 * and a kept basket is now re-priced against today's shelf the moment it loads,
 * with every line that moved or fell off listed in the drawer (decision 2), the
 * same reading Raise already makes before it writes.
 *
 * The basket is still answered synchronously from memory — every operation
 * tells its caller yes or no in the same tick — and keeping it is a side
 * effect: loaded on sign-in, saved ~400 ms after each change (and at once
 * before Raise), read again when the window regains focus and before Raise so
 * a stock flag the database wrote shows without a reload, and cleared once a
 * requisition is raised. Before the baskets migration is applied the database
 * says the tables do not exist, and the basket stays in memory, as it was.
 */
import { createContext, useContext, useMemo, useState, useRef, useCallback, useEffect } from 'react'
import type { ReactNode } from 'react'
import {
  EMPTY_BASKET, addToBasket, setQuantity as setQty, removeLine as dropLine, repriceTo,
  basketCount, basketTotal, setReason as setLineReason, applyContractChanges,
} from './requisitionBasket'
import type { Basket, BasketLine, ContractChange } from './requisitionBasket'
import { addBundleToBasket, removeBundleFromBasket } from './bundleLines'
import { fromKept, mergeSaved, fellOff, lineToSave } from './baskets'
import {
  loadRequisitionBasket, saveRequisitionBasket, clearRequisitionBasket, acceptBasketFlag,
} from './basketRepo'
import { onUserChange } from './authRepo'
import { recheck } from './requisitionRecheck'

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
  /** Put today's prices on the lines that moved (contractChanges), before anything is raised. */
  applyChanges: (changes: readonly ContractChange[]) => void
  /** What changed when a kept basket was loaded and re-priced: lines that moved, and lines taken out
      because they are no longer sold in the basket's currency. Null when nothing did. */
  restored: { changes: ContractChange[]; dropped: string[] } | null
  dismissRestored: () => void
  /** Why the basket could not be kept just now, when the database refused it. */
  keepError: string | null
  /** Save anything pending and read the kept basket again (flags included). Resolves to the basket as it now is. */
  sync: () => Promise<Basket>
  /** Accept a stock flag on a kept line (by its id): the line keeps the quantity it was cut to. */
  acceptFlag: (lineId: string) => Promise<{ ok: true } | { ok: false; reason: string }>
  /** A requisition was raised from this basket: empty it and clear the kept copy. */
  raised: () => Promise<void>
}

/* Said once per page, not on every save: the tables are simply not there yet. */
let warnedMissing = false
function warnMissing(detail: string) {
  if (warnedMissing) return
  warnedMissing = true
  console.warn(`The requisition basket is kept in this page only: the baskets migration is not applied (${detail}).`)
}

const SAVE_MS = 400

/** Whether two baskets hold the same lines, flags and all. */
function sameBasket(a: Basket, b: Basket): boolean {
  if (a.currency !== b.currency || a.lines.length !== b.lines.length) return false
  const sig = (l: BasketLine) => JSON.stringify([lineToSave(l), l.id ?? null, l.stock_note ?? null, l.was_quantity ?? null, l.flagged_at ?? null])
  return a.lines.every((l, i) => sig(l) === sig(b.lines[i]))
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
  const [restored, setRestored] = useState<RequisitionState['restored']>(null)
  const [keepError, setKeepError] = useState<string | null>(null)

  /* Keeping it. `enabled` is on once the signed-in buyer's kept basket has
     loaded: before that a save could replace a basket nobody has read yet. */
  const enabled = useRef(false)
  const user = useRef<string | null>(null)
  const loadedFor = useRef<string | null>(null)
  const dirty = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inflight = useRef<Promise<void> | null>(null)

  const show = useCallback((next: Basket) => {
    live.current = next
    setBasketState(next)
  }, [])

  const stopTimer = () => { if (timer.current) { clearTimeout(timer.current); timer.current = null } }

  const settle = useCallback(async () => {
    while (inflight.current) await inflight.current
  }, [])

  const flush = useCallback(async (): Promise<void> => {
    stopTimer()
    await settle()
    if (!enabled.current || !dirty.current) return
    dirty.current = false
    const sent = live.current
    const who = user.current
    const p = (async () => {
      const r = await saveRequisitionBasket(sent.currency, sent.lines)
      if (user.current !== who) return
      if (!r.ok) {
        if (r.missing) { enabled.current = false; warnMissing(r.error); return }
        console.warn(`The requisition basket could not be kept (${r.error}).`)
        setKeepError(r.error)
        return
      }
      setKeepError(null)
      /* The server's ids and flags onto the lines, without undoing anything
         the buyer changed while the save was out. */
      const merged = mergeSaved(live.current, sent, r.value)
      if (merged !== live.current) show(merged)
    })()
    inflight.current = p
    try { await p } finally { if (inflight.current === p) inflight.current = null }
  }, [settle, show])

  const commit = useCallback((next: Basket) => {
    show(next)
    if (!enabled.current) return
    dirty.current = true
    stopTimer()
    timer.current = setTimeout(() => { timer.current = null; void flush() }, SAVE_MS)
  }, [show, flush])

  /* Re-priced as Raise re-prices (spec 10), once, when a kept basket comes
     back: what moved takes today's price, and what is no longer sold in the
     basket's currency comes out. Both are listed in the drawer. */
  const repriceRestored = useCallback(async (account_id: string, who: string) => {
    const basket = live.current
    if (!basket.lines.length) return
    const fresh = await recheck(account_id, basket, new Date().toISOString().slice(0, 10))
    if (!fresh || user.current !== who) return
    const gone = fellOff(live.current, fresh.published)
    let next = applyContractChanges(live.current, fresh.changes)
    if (gone.length) {
      const out = new Set(gone.map(g => g.product_id))
      const lines = next.lines.filter(l => l.quote_line_id || l.bundle_selection_id || !out.has(l.product_id))
      next = lines.length ? { ...next, lines } : EMPTY_BASKET
    }
    if (next !== live.current) commit(next)
    const changes = fresh.changes.filter(c => !gone.some(g => g.product_id === c.product_id))
    if (changes.length || gone.length) setRestored({ changes, dropped: gone.map(g => g.name) })
  }, [commit])

  /* The signed-in buyer's kept basket, read for the first time. A failed read
     (other than the tables not existing) leaves keeping off until a later try,
     so an empty page never overwrites a basket it could not read. */
  const loadFirst = useCallback(async (who: string) => {
    const r = await loadRequisitionBasket()
    if (user.current !== who) return
    if (!r.ok) {
      if (r.missing) warnMissing(r.error)
      else console.warn(`The kept requisition basket could not be read (${r.error}). It stays in this page until it can be.`)
      return
    }
    loadedFor.current = who
    enabled.current = true
    if (live.current.lines.length) {
      /* Something went in before the kept basket came back: what is on screen
         is what the buyer is looking at, and it is kept. */
      if (!r.value) { dirty.current = true; void flush() }
      else commit(live.current)
      return
    }
    const kept = fromKept(r.value)
    show(kept)
    if (r.value && kept.lines.length) void repriceRestored(r.value.account_id, who)
  }, [commit, flush, show, repriceRestored])

  /* The kept basket read again — flags the database wrote since, or a change
     made on another device. Taken only if nothing changed here meanwhile;
     otherwise the next save merges. */
  const reload = useCallback(async () => {
    const who = user.current
    if (!who) return
    if (loadedFor.current !== who) { await loadFirst(who); return }
    if (!enabled.current) return
    await flush()
    const before = live.current
    const r = await loadRequisitionBasket()
    if (user.current !== who) return
    if (!r.ok) {
      if (r.missing) { enabled.current = false; warnMissing(r.error) }
      else console.warn(`The kept requisition basket could not be read again (${r.error}).`)
      return
    }
    if (live.current !== before || dirty.current) return
    const kept = fromKept(r.value)
    if (!sameBasket(kept, before)) show(kept)
  }, [flush, loadFirst, show])

  useEffect(() => {
    const stop = onUserChange(id => {
      const was = user.current
      user.current = id
      stopTimer()
      dirty.current = false
      enabled.current = false
      loadedFor.current = null
      /* Another person's basket is never shown to the next. */
      if (was && was !== id) { show(EMPTY_BASKET); setRestored(null) }
      if (id) void loadFirst(id)
    })
    return () => {
      stop()
      /* Leaving the console (signing out): whatever was waiting to be kept goes now. */
      if (enabled.current && dirty.current) void flush()
    }
  }, [loadFirst, show, flush])

  useEffect(() => {
    const onFocus = () => { void reload() }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [reload])

  const sync = useCallback(async (): Promise<Basket> => {
    await reload()
    return live.current
  }, [reload])

  const acceptFlag: RequisitionState['acceptFlag'] = useCallback(async (lineId) => {
    if (!enabled.current) return { ok: false, reason: 'Your requisition basket is not kept yet, so there is no flag to accept.' }
    await flush()
    const r = await acceptBasketFlag('requisition', lineId)
    if (!r.ok) return { ok: false, reason: r.error }
    /* Cleared here at once; the read that follows confirms it. */
    show({
      ...live.current,
      lines: live.current.lines.map(l => (l.id === lineId ? { ...l, stock_note: null, was_quantity: null, flagged_at: null } : l)),
    })
    await reload()
    return { ok: true }
  }, [flush, reload, show])

  const raised = useCallback(async () => {
    stopTimer()
    dirty.current = false
    await settle()
    show(EMPTY_BASKET)
    setRestored(null)
    if (!enabled.current) return
    const r = await clearRequisitionBasket()
    if (!r.ok) {
      if (r.missing) { enabled.current = false; warnMissing(r.error) }
      else {
        /* Saving it empty deletes it too; a raised basket must not come back on the next read. */
        console.warn(`The requisition was raised, but its kept basket could not be cleared (${r.error}). Trying again by saving it empty.`)
        dirty.current = true
        await flush()
      }
    }
  }, [settle, show, flush])

  const dismissRestored = useCallback(() => setRestored(null), [])

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

  const empty = useCallback(() => { commit(EMPTY_BASKET); setRestored(null) }, [commit])

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

  const applyChanges = useCallback((changes: readonly ContractChange[]) => {
    commit(applyContractChanges(live.current, changes))
  }, [commit])

  const value = useMemo<RequisitionState>(() => ({
    basket,
    count: basketCount(basket),
    total: basketTotal(basket),
    open, setOpen, add, setQuantity, remove, setReason, addBundle, removeBundle, empty, reprice, applyChanges,
    restored, dismissRestored, keepError, sync, acceptFlag, raised,
  }), [basket, open, add, setQuantity, remove, setReason, addBundle, removeBundle, empty, reprice, applyChanges,
    restored, dismissRestored, keepError, sync, acceptFlag, raised])

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useRequisition(): RequisitionState {
  const v = useContext(Ctx)
  if (!v) throw new Error('useRequisition outside a RequisitionProvider')
  return v
}
