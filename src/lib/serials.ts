/* Serialised stock: one physical thing, by its serial.
 *
 * The stock ledger counted units and could not name one. A count answers "how
 * many" and nothing else, and the questions a warehouse is actually asked are
 * all about a particular object:
 *
 *   which handset went out on ORD-771339
 *   where is this serial now, and who has it
 *   this came back faulty — was it ours, whose batch was it in
 *   we are recalling a batch — which orders are affected
 *
 * No Supabase here — the vocabulary, the arithmetic and the sentences, tested
 * on the cases that matter. Four thousand units live in the database and are
 * fetched a page at a time; nothing in this file assumes it has all of them.
 */

export type UnitState =
  | 'in_stock' | 'reserved' | 'despatched' | 'delivered'
  | 'returned' | 'faulty' | 'written_off'

export type HoldReason = 'order' | 'quarantine' | 'allocation' | 'demo' | 'engineering'

export interface StockUnit {
  serial: string
  product_id: string
  warehouse_id: string
  state: UnitState
  hold_reason: HoldReason | null
  received_on: string
  grn_ref: string | null
  supplier_id: string | null
  batch_ref: string | null
  order_id: string | null
  order_item_id: string | null
  order_ref: string | null
  customer: string | null
  despatched_on: string | null
  delivered_on: string | null
  returned_on: string | null
  note: string | null
}

export interface UnitEvent {
  id: number
  serial: string
  at: string
  actor: string
  from_state: string | null
  to_state: string
  detail: string
  order_ref: string | null
}

/** The counts, from `stock_unit_rollup`. Derived in the database rather than
    by counting a page of rows in the browser — a percentage of the first
    thousand rows PostgREST returns is not a percentage. */
export interface UnitRollup {
  product_id: string
  warehouse_id: string
  in_stock: number
  reserved: number
  reserved_on_orders: number
  held_back: number
  despatched: number
  delivered: number
  returned: number
  faulty: number
  written_off: number
  on_hand: number
}

export interface Drift {
  line_id: string
  product_id: string
  warehouse_id: string
  ledger_on_hand: number
  counted_on_hand: number
  ledger_reserved: number
  counted_reserved: number
  agrees: boolean
}

export const STATE_LABEL: Record<UnitState, string> = {
  in_stock: 'On the shelf',
  reserved: 'Reserved',
  despatched: 'Despatched',
  delivered: 'Delivered',
  returned: 'Came back',
  faulty: 'Faulty',
  written_off: 'Written off',
}

/* The pill vocabulary, so a despatched unit is not coloured like a failure. */
export const STATE_TONE: Record<UnitState, string> = {
  in_stock: 'active',
  reserved: 'pending',
  despatched: 'current',
  delivered: 'delivered',
  returned: 'paused',
  faulty: 'rejected',
  written_off: 'retired',
}

export const HOLD_LABEL: Record<HoldReason, string> = {
  order: 'Allocated to an order',
  quarantine: 'In quarantine',
  allocation: 'Committed elsewhere',
  demo: 'Demo pool',
  engineering: 'With engineering',
}

/** Whether a unit is physically in the building. A despatched unit is not on
    hand however recently it left, and a faulty one is on hand and unsellable —
    the two are different facts and one number cannot carry both. */
export const inBuilding = (u: Pick<StockUnit, 'state'>): boolean =>
  u.state === 'in_stock' || u.state === 'reserved' || u.state === 'faulty'

export const sellable = (u: Pick<StockUnit, 'state'>): boolean => u.state === 'in_stock'

/* ---- The story of one unit ------------------------------------------------- */

/** One sentence saying where this unit is and how it got there. The state on
    its own is a word; this is the answer to the question somebody asked. */
export function unitStory(u: StockUnit): string {
  switch (u.state) {
    case 'in_stock':
      return `On the shelf at ${u.warehouse_id}, received ${u.received_on}`
    case 'reserved':
      return u.hold_reason === 'order'
        ? `Allocated to ${u.order_ref ?? 'an order'} and not yet picked`
        : `${HOLD_LABEL[u.hold_reason ?? 'allocation']}${u.note ? ` — ${u.note}` : ''}`
    case 'despatched':
      return `Left on ${u.order_ref} on ${u.despatched_on}, to ${u.customer ?? 'the customer'}`
    case 'delivered':
      return `Delivered to ${u.customer ?? 'the customer'} on ${u.delivered_on}, on ${u.order_ref}`
    case 'returned':
      return `Came back from ${u.customer ?? 'the customer'} on ${u.returned_on}, having gone out on ${u.order_ref}`
    case 'faulty':
      return u.note ?? 'Failed inspection and is not sellable'
    case 'written_off':
      return u.note ?? 'Written off'
  }
}

/** What a serial is worth being asked about: where it came from, where it went.
    Missing values are declared rather than left blank — "we did not record the
    batch" and "there is no batch" are different, and a gap reads as neither. */
export function provenance(u: StockUnit): { label: string; value: string | null }[] {
  return [
    { label: 'Received', value: u.received_on },
    { label: 'Goods-in reference', value: u.grn_ref },
    { label: 'Batch', value: u.batch_ref },
    { label: 'Supplied by', value: u.supplier_id },
    { label: 'Warehouse', value: u.warehouse_id },
    { label: 'Order', value: u.order_ref },
    { label: 'Customer', value: u.customer },
    { label: 'Despatched', value: u.despatched_on },
    { label: 'Delivered', value: u.delivered_on },
    { label: 'Returned', value: u.returned_on },
  ]
}

/* ---- Reading a stock line -------------------------------------------------- */

/** Why a line is short. "48 available against a reorder point of 60" says
    nothing about what to do; twenty units held against a framework agreement
    is a decision somebody can take. */
export function holdsOn(units: readonly StockUnit[]): {
  reason: HoldReason; label: string; count: number; note: string | null
}[] {
  const m = new Map<HoldReason, { reason: HoldReason; label: string; count: number; note: string | null }>()
  for (const u of units) {
    if (u.state !== 'reserved' || !u.hold_reason) continue
    const e = m.get(u.hold_reason)
      ?? { reason: u.hold_reason, label: HOLD_LABEL[u.hold_reason], count: 0, note: u.note }
    e.count += 1
    /* Where several holds share a reason but not a note, the note stops being
       the explanation and the count is all there is. */
    if (e.note !== u.note) e.note = null
    m.set(u.hold_reason, e)
  }
  return [...m.values()].sort((a, b) => b.count - a.count)
}

/** How long the oldest thing on the shelf has been there. A line can be
    healthy on quantity and still be carrying units nobody will take. */
export function oldestOnShelf(units: readonly StockUnit[], today = new Date()): {
  serial: string; received: string; days: number
} | null {
  const shelf = units.filter(sellable)
  if (shelf.length === 0) return null
  const oldest = shelf.reduce((a, b) => (a.received_on <= b.received_on ? a : b))
  const days = Math.max(0, Math.round(
    (today.getTime() - new Date(oldest.received_on).getTime()) / 86400000))
  return { serial: oldest.serial, received: oldest.received_on, days }
}

/** Which order took units from this line, most recent first. The operator's
    question is "where did this stock go", and a list of serials does not
    answer it until they are grouped by the thing that took them. */
export function byOrder(units: readonly StockUnit[]): {
  order_ref: string; order_id: string | null; customer: string | null
  count: number; state: UnitState; on: string | null; serials: string[]
}[] {
  const m = new Map<string, {
    order_ref: string; order_id: string | null; customer: string | null
    count: number; state: UnitState; on: string | null; serials: string[]
  }>()
  for (const u of units) {
    if (!u.order_ref) continue
    const e = m.get(u.order_ref) ?? {
      order_ref: u.order_ref, order_id: u.order_id, customer: u.customer,
      count: 0, state: u.state,
      on: u.delivered_on ?? u.despatched_on ?? null, serials: [],
    }
    e.count += 1
    e.serials.push(u.serial)
    m.set(u.order_ref, e)
  }
  return [...m.values()].sort((a, b) => (b.on ?? '').localeCompare(a.on ?? ''))
}

/** The recall question. Given a batch, which orders received units from it and
    who has them — the one query nobody could run against a count. */
export function batchReach(units: readonly StockUnit[], batch: string): {
  batch: string; total: number; shipped: number; stillHere: number
  orders: { order_ref: string; customer: string | null; count: number }[]
} {
  const mine = units.filter(u => u.batch_ref === batch)
  const shipped = mine.filter(u => u.order_ref)
  return {
    batch,
    total: mine.length,
    shipped: shipped.length,
    stillHere: mine.filter(inBuilding).length,
    orders: byOrder(shipped).map(o => ({ order_ref: o.order_ref, customer: o.customer, count: o.count })),
  }
}

/* ---- The ledger against the units ------------------------------------------ */

/** A stored count that disagrees with the rows under it, said in words. This is
    the bug the table exists to prevent, so it is reported rather than assumed
    away — silence here would mean nobody ever checked. */
export function driftLine(d: Drift): string | null {
  if (d.agrees) return null
  const parts: string[] = []
  if (d.ledger_on_hand !== d.counted_on_hand) {
    parts.push(`the ledger says ${d.ledger_on_hand} on hand and ${d.counted_on_hand} units exist`)
  }
  if (d.ledger_reserved !== d.counted_reserved) {
    parts.push(`it says ${d.ledger_reserved} reserved and ${d.counted_reserved} are`)
  }
  /* The physical count wins, which is the rule the warehouse screen already
     states for its WMS drift. A silent correction destroys the audit value. */
  return `${d.line_id}: ${parts.join(', ')}. The units are the count.`
}

/* ---- Finding one --------------------------------------------------------- */

/** What somebody types into the box. A serial, part of one, an order reference,
    a customer, a batch or a goods-in reference — support does not know which of
    those they are holding when they start. */
export function matches(u: StockUnit, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return false
  return [u.serial, u.order_ref, u.customer, u.batch_ref, u.grn_ref, u.supplier_id]
    .some(v => (v ?? '').toLowerCase().includes(q))
}

/** What the search is looking for, so the screen can say what it searched
    rather than only what it found. */
export function queryKind(query: string): string {
  const q = query.trim()
  if (!q) return 'nothing yet'
  if (/^\d{10,}$/.test(q)) return 'an IMEI'
  if (/^ORD-/i.test(q)) return 'an order'
  if (/^BATCH-/i.test(q)) return 'a batch'
  if (/^GRN-/i.test(q)) return 'a goods-in reference'
  /* `SKU5007-0000012` — the SKU carries digits, so the prefix is not
     letters-only. BATCH and GRN are caught above and cannot fall in here. */
  if (/^[A-Z][A-Z0-9]{2,}-\d+$/i.test(q)) return 'a serial'
  return 'a name or a partial reference'
}

/* ---- Moving one ------------------------------------------------------------ */

/* Which states a unit can go to from where it is. A screen that offers every
   state offers "delivered" on something still on the shelf. */
const NEXT: Record<UnitState, UnitState[]> = {
  in_stock: ['reserved', 'faulty', 'written_off'],
  reserved: ['in_stock', 'despatched', 'faulty'],
  despatched: ['delivered', 'returned'],
  delivered: ['returned'],
  returned: ['in_stock', 'faulty', 'written_off'],
  faulty: ['written_off', 'in_stock'],
  written_off: [],
}

export const nextStates = (from: UnitState): UnitState[] => NEXT[from]

export type Move = { ok: true; note?: string } | { ok: false; reason: string }

export function canMove(u: StockUnit, to: UnitState, reason?: HoldReason | null): Move {
  if (u.state === to) return { ok: false, reason: `It is already ${STATE_LABEL[to].toLowerCase()}.` }
  if (!NEXT[u.state].includes(to)) {
    return {
      ok: false,
      reason: `A unit that is ${STATE_LABEL[u.state].toLowerCase()} cannot go straight to ${STATE_LABEL[to].toLowerCase()}.`,
    }
  }
  if (to === 'reserved' && !reason) {
    return {
      ok: false,
      reason: 'A reservation has to say why — against an order, or held back deliberately. "Reserved" on its own is the number nobody could explain.',
    }
  }
  if (to === 'reserved' && reason === 'order' && !u.order_ref) {
    return { ok: false, reason: 'Reserved against an order means naming the order.' }
  }
  if (to === 'written_off') {
    return { ok: true, note: 'Writing off is final — the unit cannot come back onto the shelf afterwards.' }
  }
  if (to === 'in_stock' && u.state === 'faulty') {
    return { ok: true, note: 'Putting a faulty unit back on the shelf makes it sellable again. Say why in the note.' }
  }
  return { ok: true }
}
