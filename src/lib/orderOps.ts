/**
 * Working somebody else's order.
 *
 * Every persona could see its own orders and nobody could see all of them. A
 * buyer rings up with a reference, a seller says the marketplace never sent it,
 * an enterprise says they were charged twice — and there was no screen where
 * those three accounts of the same order could be put beside each other.
 *
 * What the operator does here is narrow on purpose, and the shape of it comes
 * from `guard_operator_order_edit`: the marketplace moves an order along, it
 * does not rewrite what it cost or who bought it. Price, tax, currency, buyer
 * and payment reference were agreed at checkout and the way to change them is a
 * refund, not an edit. So the module is mostly about *reading* — deciding which
 * order is in trouble and saying why in terms somebody can act on — and the
 * small set of moves that are legitimately the marketplace's.
 *
 * Two ideas run through it.
 *
 * A CONTRADICTION IS WORSE THAN A DELAY. An order that has been sitting in
 * "placed" for nine days is slow. An order showing "Delivered" to the customer
 * while the network provisioning is still in progress is *wrong*, and somebody
 * has already been told something untrue. The queue ranks on that, not on age.
 *
 * NEVER SUM ACROSS CURRENCIES. The book is INR, KES, AED and USD. "₹2.9m of
 * open orders" is a real figure; "2.9m of open orders" is four currencies added
 * together and means nothing.
 */

import { byCurrency, money } from './money'
import type { Money } from './money'
import type { ComState } from './com'

/** One currency's worth, as `byCurrency` reports it. Never flattened into one. */
export type CurrencyGroup = { currency: string; total: Money; count: number }

export interface OrderRow {
  id: string
  order_ref: string
  status: string
  total: number
  subtotal: number
  tax: number
  discount: number
  tax_rate: number
  currency: string
  market: string
  buyer_name: string | null
  buyer_email: string | null
  seller: string | null
  vertical: string | null
  payment_method: string | null
  payment_ref: string | null
  tracking_ref: string | null
  carrier: string | null
  placed_date: string | null
  created_at: string | null
  failed: boolean
  failed_reason: string | null
  stage: number
  stages: string[]
  user_id: string | null
  account_id: string | null
  requisition_id: string | null
  invoice_id: string | null
  ordered_by: string | null
  cost_centre: string | null
  po_ref: string | null
}

export interface LineRow {
  id: string
  order_id: string
  product_id: string
  product_name: string
  price: number
  quantity: number
  fulfil: string
  status: string
}

export interface PushRow {
  id: string
  order_ref: string
  product_name: string
  state: ComState
  failure_reason: string | null
}

/* ------------------------------------------------------------ who bought it -- */

export type BuyerKind = 'consumer' | 'enterprise' | 'guest'

/**
 * An enterprise order is one bought on an account, whoever pressed the button —
 * so `account_id` decides and `user_id` does not, because an enterprise order
 * carries both and reading `user_id` first would file every one of them as
 * retail.
 */
export function buyerKind(o: Pick<OrderRow, 'account_id' | 'user_id'>): BuyerKind {
  if (o.account_id) return 'enterprise'
  if (o.user_id) return 'consumer'
  return 'guest'
}

export const BUYER_LABEL: Record<BuyerKind, string> = {
  consumer: 'Retail',
  enterprise: 'Business account',
  guest: 'Guest checkout',
}

/** Who to contact, which is a different question from who paid. */
export function contactLine(o: OrderRow): string {
  const kind = buyerKind(o)
  if (kind === 'enterprise') {
    return `${o.buyer_name ?? o.account_id} — raised by ${o.ordered_by ?? 'somebody unnamed'}`
  }
  if (kind === 'guest') {
    return `${o.buyer_name ?? 'A guest'} at ${o.buyer_email ?? 'no address on file'} — no account to sign into`
  }
  return `${o.buyer_name ?? 'A customer'} — ${o.buyer_email ?? 'no address on file'}`
}

/* ------------------------------------------------------------- where it is -- */

/** What the customer is currently being shown. */
export function showing(o: Pick<OrderRow, 'stage' | 'stages'>): string {
  return o.stages[o.stage] ?? o.stages[o.stages.length - 1] ?? 'Unknown'
}

export function atEnd(o: Pick<OrderRow, 'stage' | 'stages'>): boolean {
  return o.stage >= o.stages.length - 1
}

export function nextStage(o: Pick<OrderRow, 'stage' | 'stages'>): string | null {
  return atEnd(o) ? null : (o.stages[o.stage + 1] ?? null)
}

export const STATUS_TONE: Record<string, string> = {
  placed: 'pending',
  processing: 'current',
  shipped: 'current',
  'in-transit': 'current',
  delivered: 'healthy',
  active: 'healthy',
  refunded: 'draft',
  failed: 'rejected',
  'partly-failed': 'degraded',
}

/* ------------------------------------------------------------- how old it is -- */

const DAY = 86400000

/** Days since it was placed, or null when nothing recorded when that was. */
export function ageInDays(o: Pick<OrderRow, 'created_at'>, today: string): number | null {
  if (!o.created_at) return null
  const then = Date.parse(o.created_at)
  const now = Date.parse(today.length === 10 ? `${today}T00:00:00Z` : today)
  if (Number.isNaN(then) || Number.isNaN(now)) return null
  return Math.floor((now - then) / DAY)
}

/**
 * How long each state is allowed to last before somebody should look.
 *
 * These are not SLAs — the SLA belongs to the seller and lives on the ticket. It
 * is the point at which an order stops being in progress and starts being
 * forgotten, which is a different and earlier moment.
 */
export const PATIENCE: Record<string, number> = {
  placed: 2,
  processing: 3,
  shipped: 7,
  'in-transit': 7,
  'partly-failed': 1,
}

export function isStuck(
  o: Pick<OrderRow, 'status' | 'created_at'>, today: string,
): { stuck: false } | { stuck: true; days: number; allowed: number } {
  const allowed = PATIENCE[o.status]
  if (allowed === undefined) return { stuck: false }
  const days = ageInDays(o, today)
  if (days === null || days <= allowed) return { stuck: false }
  return { stuck: true, days, allowed }
}

/* ------------------------------------------------------------- what is wrong -- */

export type Severity = 'wrong' | 'stalled' | 'untidy'

export interface Problem {
  severity: Severity
  what: string
  /* What somebody would do about it, in the words of the thing that would fix
     it. A problem with no next move is a complaint. */
  next: string
}

const SEVERITY_RANK: Record<Severity, number> = { wrong: 0, stalled: 1, untidy: 2 }

export const SEVERITY_LABEL: Record<Severity, string> = {
  wrong: 'Saying something untrue',
  stalled: 'Nothing is happening',
  untidy: 'Incomplete record',
}

/**
 * Everything wrong with one order.
 *
 * The `wrong` ones all have the same shape: the customer has been told
 * something the rest of the database does not support. Those come first
 * wherever they appear, because unlike a delay they are already doing damage.
 */
export function problemsFor(
  o: OrderRow, lines: readonly LineRow[], pushes: readonly PushRow[], today: string,
): Problem[] {
  const out: Problem[] = []
  const mine = lines.filter(l => l.order_id === o.id)
  const open = pushes.filter(p => p.order_ref === o.order_ref
    && p.state !== 'completed' && p.state !== 'cancelled')

  /* The one `guard_order_completion` exists to stop, caught here for the orders
     that reached this state before the guard did. */
  const done = o.status === 'delivered' || o.status === 'active'
  if (done && open.length > 0) {
    out.push({
      severity: 'wrong',
      what: `The customer is being shown "${o.status}" while ${open[0].product_name} has not been provisioned.`,
      next: 'Put the status back to what is true and work the network fulfilment. The order cannot '
        + 'honestly reach the end of its ladder until that completes or is cancelled.',
    })
  }
  if (done && !atEnd(o)) {
    out.push({
      severity: 'wrong',
      what: `The status says ${o.status} and the tracker still shows "${showing(o)}".`,
      /* Only one of these two is available when the network has not finished,
         and offering both would contradict the button on the same screen — which
         is disabled for exactly that reason. */
      next: open.length > 0
        ? 'Put the status back to what is actually true. It cannot be moved to the end while the '
          + 'network fulfilment is outstanding.'
        : 'Move it to the end of its own ladder, or put the status back to what is actually true.',
    })
  }
  if (o.failed && !(o.failed_reason ?? '').trim()) {
    out.push({
      severity: 'wrong',
      what: 'It is marked failed with no reason on it.',
      next: 'Say what went wrong. "Failed" on its own cannot be acted on by the customer or by support.',
    })
  }
  if (o.status === 'refunded' && !o.failed && mine.every(l => l.status !== 'refunded')) {
    out.push({
      severity: 'untidy',
      what: 'The order is refunded and no line says so.',
      next: 'Check the refund landed against the right line before the seller is settled on it.',
    })
  }

  const charged = linesCharged(mine)
  if (mine.length === 0) {
    out.push({
      severity: 'wrong',
      what: 'There are no lines behind it at all.',
      next: 'An order with no lines cannot be fulfilled, settled or refunded. Find what was bought.',
    })
  } else if (Math.abs(charged - (o.total + o.discount)) > 0.02) {
    out.push({
      severity: 'wrong',
      what: `The lines come to ${charged.toFixed(2)} and it was charged ${(o.total + o.discount).toFixed(2)} before discount.`,
      next: 'One of the two is wrong and the customer has already paid one of them.',
    })
  }

  const rejected = pushes.filter(p => p.order_ref === o.order_ref && p.state === 'rejected')
  for (const r of rejected) {
    out.push({
      severity: 'stalled',
      what: `${r.product_name} was refused by the order manager. ${r.failure_reason ?? ''}`.trim(),
      next: 'Fix what it objected to and push it again, or cancel the line and refund it.',
    })
  }

  const s = isStuck(o, today)
  if (s.stuck) {
    out.push({
      severity: 'stalled',
      what: `${s.days} days in "${o.status}", against ${s.allowed} before anybody looks.`,
      next: o.seller ? `Chase ${o.seller}.` : 'Find out who is meant to be fulfilling it.',
    })
  }

  if (!o.placed_date && !o.created_at) {
    out.push({
      severity: 'untidy',
      what: 'Nothing records when it was placed.',
      next: 'Without a date it cannot be aged, chased or reported in a period.',
    })
  }
  if ((o.status === 'shipped' || o.status === 'in-transit') && !(o.tracking_ref ?? '').trim()) {
    out.push({
      severity: 'untidy',
      what: 'It is in transit with no tracking reference.',
      next: 'The customer has nothing to look up and support has nothing to quote.',
    })
  }

  return out.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity])
}

export interface Exception {
  order: OrderRow
  problems: Problem[]
  worst: Severity
}

/**
 * What to work, worst first.
 *
 * Ranked on the worst thing wrong rather than on how many things are, because
 * an order saying one untrue thing needs somebody before an order with three
 * missing tracking references.
 */
export function exceptionQueue(
  orders: readonly OrderRow[], lines: readonly LineRow[],
  pushes: readonly PushRow[], today: string,
): Exception[] {
  const out: Exception[] = []
  for (const o of orders) {
    const problems = problemsFor(o, lines, pushes, today)
    if (problems.length === 0) continue
    out.push({ order: o, problems, worst: problems[0].severity })
  }
  return out.sort((a, b) => {
    const d = SEVERITY_RANK[a.worst] - SEVERITY_RANK[b.worst]
    if (d !== 0) return d
    /* Within a severity, the one that has been wrong longest. */
    return (ageInDays(b.order, today) ?? 0) - (ageInDays(a.order, today) ?? 0)
  })
}

/* --------------------------------------------------------------- the money -- */

/** What the lines say was charged, before any order-level discount. */
export function linesCharged(lines: readonly LineRow[]): number {
  return Math.round(lines.reduce((n, l) => n + l.price * l.quantity, 0) * 100) / 100
}

/**
 * The book, kept in its own currencies.
 *
 * Four currencies trade here. A single total across them is the one number on
 * an operator screen that is guaranteed to be meaningless.
 */
export function bookValue(orders: readonly OrderRow[]): CurrencyGroup[] {
  return byCurrency(orders.map(o => money(o.total, o.currency)))
}

/* -------------------------------------------------------------- what may move -- */

/* Frozen at checkout. The list is `guard_operator_order_edit`'s, written out
   here so a screen can grey the field rather than let somebody type into it and
   discover the rule on submit. */
export const FROZEN: readonly string[] = [
  'total', 'subtotal', 'tax', 'tax_rate', 'discount', 'currency', 'market',
  'buyer_name', 'buyer_email', 'user_id', 'account_id', 'order_ref',
  'invoice_id', 'requisition_id', 'payment_method', 'payment_ref',
]

export function isFrozen(field: string): boolean {
  return FROZEN.includes(field)
}

export const FROZEN_REASON =
  'Agreed at checkout. The marketplace moves an order along; it does not rewrite what it cost '
  + 'or who bought it, and a refund is the way to change those.'

/**
 * Whether the order can be moved on a step, and what stops it.
 *
 * This is `guard_order_completion` evaluated in the browser: it refuses the last
 * step while a network push is outstanding, because that is the step that tells
 * the customer their service is live. The database refuses it too — this exists
 * so the button carries the reason instead of the failure.
 */
export function canAdvance(
  o: OrderRow, pushes: readonly PushRow[],
): { ok: true; to: string } | { ok: false; reason: string } {
  if (o.failed) {
    return { ok: false, reason: `${o.order_ref} failed. Reverse that before moving it on.` }
  }
  const to = nextStage(o)
  if (to === null) {
    return { ok: false, reason: `${o.order_ref} is already at "${showing(o)}", the end of its ladder.` }
  }
  const last = o.stage + 1 >= o.stages.length - 1
  if (!last) return { ok: true, to }

  const open = pushes.find(p => p.order_ref === o.order_ref
    && p.state !== 'completed' && p.state !== 'cancelled')
  if (open) {
    return {
      ok: false,
      reason: `${open.product_name} is ${open.state} with the order manager. `
        + `Showing "${to}" would tell the customer their service is live while it is not.`,
    }
  }
  return { ok: true, to }
}

/** Failing an order is a thing somebody has to explain. */
export function canFail(reason: string): { ok: true } | { ok: false; reason: string } {
  if (!reason.trim()) {
    return {
      ok: false,
      reason: 'Say what went wrong. "Failed" on its own leaves the customer with a dead order '
        + 'and support with nothing to tell them.',
    }
  }
  return { ok: true }
}

/* ------------------------------------------------------------------ finding -- */

/**
 * One box, because a caller does not know which field they are holding.
 *
 * Somebody rings up with a reference, or an email, or "the Sentinel order" — and
 * asking them which of six fields that is, is the operator's problem to solve,
 * not theirs.
 */
export function searchOrders(
  orders: readonly OrderRow[], lines: readonly LineRow[], q: string,
): OrderRow[] {
  const needle = q.trim().toLowerCase()
  if (!needle) return [...orders]
  const byLine = new Set(
    lines.filter(l => l.product_name.toLowerCase().includes(needle)
                   || l.product_id.toLowerCase().includes(needle))
         .map(l => l.order_id))
  return orders.filter(o =>
    byLine.has(o.id)
    || [o.order_ref, o.buyer_name, o.buyer_email, o.seller, o.account_id, o.requisition_id,
        o.tracking_ref, o.po_ref, o.cost_centre, o.invoice_id, o.status, o.market]
      .some(v => (v ?? '').toLowerCase().includes(needle)))
}

/* --------------------------------------------------------------- the rollup -- */

export interface Rollup {
  total: number
  open: number
  failed: number
  exceptions: number
  wrong: number
  value: CurrencyGroup[]
}

export function rollup(
  orders: readonly OrderRow[], lines: readonly LineRow[],
  pushes: readonly PushRow[], today: string,
): Rollup {
  const q = exceptionQueue(orders, lines, pushes, today)
  const open = orders.filter(o => !['delivered', 'active', 'refunded', 'failed'].includes(o.status))
  return {
    total: orders.length,
    open: open.length,
    failed: orders.filter(o => o.failed).length,
    exceptions: q.length,
    wrong: q.filter(e => e.worst === 'wrong').length,
    /* The value on the screen is the open book, because settled orders are the
       ledger's business and open ones are this screen's. */
    value: bookValue(open),
  }
}
