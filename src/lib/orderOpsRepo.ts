/* The whole order book, and the small set of moves the marketplace may make on
 * somebody else's order.
 *
 * Every write here is an ordinary table update. The rules are in the database —
 * `guard_operator_order_edit` refuses a change to what it cost or who bought it,
 * `guard_order_completion` refuses the final step while the network has not
 * provisioned — so an operator screen cannot talk the row into a state the
 * policy forbids, whatever it sends.
 *
 * Every numeric arrives from PostgREST as a string. An order screen that adds
 * two of them without `Number()` reports a book value with a comma in it.
 */

import { supabase } from './supabase'
import type { OrderRow, LineRow, PushRow } from './orderOps'

const ORDER_NUM = ['total', 'subtotal', 'tax', 'discount', 'tax_rate', 'stage']
const LINE_NUM = ['price', 'quantity']

const num = <T,>(row: T, keys: readonly string[]): T => {
  const out = { ...row } as Record<string, unknown>
  for (const k of keys) if (out[k] != null) out[k] = Number(out[k])
  return out as T
}

export interface OrderBook {
  orders: OrderRow[]
  lines: LineRow[]
  pushes: PushRow[]
  loadError?: string
}

export async function loadOrderBook(): Promise<OrderBook> {
  const [o, l, c] = await Promise.all([
    supabase.from('orders').select('*').order('created_at', { ascending: false }),
    supabase.from('order_items').select('*'),
    supabase.from('com_order').select('id,order_ref,product_name,state,failure_reason'),
  ])

  const errors: string[] = []
  if (o.error) errors.push(`the orders: ${o.error.message}`)
  if (l.error) errors.push(`the lines: ${l.error.message}`)
  if (c.error) errors.push(`the network fulfilment: ${c.error.message}`)

  return {
    orders: ((o.data ?? []) as OrderRow[]).map(x => num(x, ORDER_NUM)),
    lines: ((l.data ?? []) as LineRow[]).map(x => num(x, LINE_NUM)),
    pushes: (c.data ?? []) as PushRow[],
    ...(errors.length ? { loadError: `Some of the order book did not load (${errors.join('; ')}).` } : {}),
  }
}

/**
 * Move it on one step.
 *
 * `status` follows `stage` rather than being set separately: the two disagreeing
 * is one of the contradictions this screen exists to find, and a screen that can
 * write them independently is a screen that can create it.
 */
export async function advance(
  o: OrderRow,
): Promise<{ ok: boolean; why?: string; to?: string }> {
  const to = o.stages[o.stage + 1]
  if (to === undefined) return { ok: false, why: `${o.order_ref} is already at the end of its ladder.` }

  const last = o.stage + 1 >= o.stages.length - 1
  const status = last
    ? (o.stages[o.stages.length - 1] === 'Delivered' ? 'delivered' : 'active')
    : (to === 'In transit' ? 'in-transit' : 'processing')

  const { error } = await supabase.from('orders')
    .update({ stage: o.stage + 1, status })
    .eq('id', o.id)
  return error ? { ok: false, why: error.message } : { ok: true, to }
}

/** And back, for the step somebody took by mistake. */
export async function stepBack(o: OrderRow): Promise<{ ok: boolean; why?: string }> {
  if (o.stage <= 0) return { ok: false, why: `${o.order_ref} is at the start.` }
  const { error } = await supabase.from('orders')
    .update({ stage: o.stage - 1, status: o.stage - 1 === 0 ? 'placed' : 'processing' })
    .eq('id', o.id)
  return error ? { ok: false, why: error.message } : { ok: true }
}

/** Fail it, with the reason the guard demands and the customer needs. */
export async function failOrder(
  o: OrderRow, reason: string,
): Promise<{ ok: boolean; why?: string }> {
  if (!reason.trim()) {
    return { ok: false, why: 'Say what went wrong. "Failed" on its own cannot be acted on by anybody.' }
  }
  const { error } = await supabase.from('orders')
    .update({ failed: true, failed_reason: reason.trim(), status: 'failed' })
    .eq('id', o.id)
  return error ? { ok: false, why: error.message } : { ok: true }
}

/**
 * Take the failure off, which is a different act from succeeding.
 *
 * The reason stays. A failure that was investigated and reversed is a thing
 * somebody should still be able to read about, and clearing it would delete the
 * only account of what happened.
 */
export async function unfail(o: OrderRow): Promise<{ ok: boolean; why?: string }> {
  const { error } = await supabase.from('orders')
    .update({ failed: false, status: o.stage === 0 ? 'placed' : 'processing' })
    .eq('id', o.id)
  return error ? { ok: false, why: error.message } : { ok: true }
}

/** Where the parcel is, for a customer who has nothing to look up. */
export async function setTracking(
  o: OrderRow, carrier: string, ref: string,
): Promise<{ ok: boolean; why?: string }> {
  if (!ref.trim()) return { ok: false, why: 'A tracking reference with nothing in it helps nobody.' }
  const { error } = await supabase.from('orders')
    .update({ carrier: carrier.trim() || null, tracking_ref: ref.trim() })
    .eq('id', o.id)
  return error ? { ok: false, why: error.message } : { ok: true }
}

/**
 * Remove an order that a fault minted and no money ever touched.
 *
 * Deliberately narrow, and the narrowness is in the database: `guard_order_delete`
 * refuses the moment a payment attempt, refund, settlement line, network push,
 * number, stock unit, dispute or invoice refers to it, or the order reached any
 * state past being placed. An order that money touched is a record of something
 * that happened — fail it with a reason or refund it.
 *
 * It exists because the register's own duplicate detection would otherwise find
 * something the register could not then fix.
 */
export async function removeOrder(o: OrderRow): Promise<{ ok: boolean; why?: string }> {
  /* The order alone. `order_items.order_id` cascades, so the lines go with it
     inside the same statement the guard is attached to.
   *
   * The first version of this deleted the lines first and the order second,
   * which meant the refusal path — the whole point of the guard — left the order
   * standing with nothing behind it. Two statements cannot be half-refused if
   * there is only one. */
  const { error, count } = await supabase.from('orders')
    .delete({ count: 'exact' }).eq('id', o.id)
  if (error) return { ok: false, why: error.message }
  /* A row-level refusal is not an error — PostgREST deletes nothing and returns
     success, which is exactly how a cleanup reported working for twenty runs
     while leaving twenty orders behind. */
  if (!count) {
    return { ok: false, why: `${o.order_ref} was not removed. Nothing here may delete it.` }
  }
  return { ok: true }
}

/** Move one line, for the order that is half fulfilled. */
export async function setLineStatus(
  lineId: string, status: string,
): Promise<{ ok: boolean; why?: string }> {
  const { error } = await supabase.from('order_items').update({ status }).eq('id', lineId)
  return error ? { ok: false, why: error.message } : { ok: true }
}
