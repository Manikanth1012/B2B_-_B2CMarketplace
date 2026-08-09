/* A seller's orders, read and moved on.
 *
 * The screen this serves ran on a constant. Rules are in `fulfilment.ts` so
 * they can be tested without a network; what is here is the reads, the writes,
 * and the translation of a database refusal into something a seller can act on.
 */
import { supabase } from './supabase'
import type { SellerOrder, SellerLine, DispatchRow, Check } from './fulfilment'
import type { Part, PartState } from './orderParts'

export interface OrderBook {
  orders: SellerOrder[]
  lines: SellerLine[]
  /* The seller's own SKUs, so the screen can tell their lines from a
     co-seller's on a shared order without a second round trip. */
  mine: Set<string>
  /* The parts of every order this seller can see — theirs and the other
     seller's alike, because a seller looking at a shared order needs to know
     what the other half is doing before they promise their buyer anything. */
  parts: Part[]
  loadError?: string
}

const EMPTY: OrderBook = { orders: [], lines: [], mine: new Set(), parts: [] }
const REFUSED = 'Nothing changed — you are not allowed to make that change.'

export async function loadSellerOrders(partnerId: string): Promise<OrderBook> {
  /* RLS returns exactly the orders this seller supplies a line on, so there is
     no filter here to get wrong. `products` is asked separately because the
     seller needs to know which lines on a shared order are theirs. */
  const [o, mine] = await Promise.all([
    supabase.from('orders').select('*').order('created_at', { ascending: false }),
    supabase.from('products').select('id').eq('partner_id', partnerId),
  ])
  if (o.error) return { ...EMPTY, loadError: `Your orders did not load (${o.error.message}).` }

  const orders = ((o.data ?? []) as Record<string, unknown>[]).map(row => ({
    ...row,
    total: Number(row.total ?? 0),
    stage: Number(row.stage ?? 0),
    stages: (row.stages ?? []) as string[],
  })) as unknown as SellerOrder[]

  if (!orders.length) return { ...EMPTY, mine: new Set() }

  const [items, parts] = await Promise.all([
    supabase.from('order_items').select('*').in('order_id', orders.map(x => x.id)),
    supabase.from('order_part').select('*').in('order_id', orders.map(x => x.id)).order('sort_order'),
  ])

  return {
    orders,
    parts: ((parts.data ?? []) as Record<string, unknown>[]).map(p => ({
      ...p,
      order_id: String(p.order_id),
      sort_order: Number(p.sort_order ?? 0),
    })) as unknown as Part[],
    lines: ((items.data ?? []) as Record<string, unknown>[]).map(l => ({
      order_id: String(l.order_id),
      product_id: String(l.product_id),
      product_name: String(l.product_name ?? l.product_id),
      price: Number(l.price ?? 0),
      quantity: Number(l.quantity ?? 0),
      fulfil: (l.fulfil ?? null) as string | null,
    })),
    mine: new Set(((mine.data ?? []) as { id: string }[]).map(p => p.id)),
    ...(items.error ? { loadError: `The order lines did not load (${items.error.message}).` } : {}),
  }
}

/**
 * Moving one part of an order to its next state.
 *
 * The order's own status is not written here — a trigger derives it from the
 * parts. Writing both would be two statements of one fact, and on a mixed order
 * the header's copy is the one that goes wrong.
 */
export async function movePart(
  part: Part, to: PartState, patch: { carrier?: string; tracking?: string } = {},
): Promise<Check> {
  const row: Record<string, unknown> = { state: to }
  if (patch.carrier !== undefined) row.carrier = patch.carrier || null
  if (patch.tracking !== undefined) row.tracking_ref = patch.tracking || null
  if (to === 'in transit') row.despatched_on = new Date().toISOString().slice(0, 10)
  if (to === 'delivered') row.delivered_on = new Date().toISOString().slice(0, 10)

  const { data, error } = await supabase.from('order_part')
    .update(row).eq('id', part.id).select('id')
  if (error) return { ok: false, reason: friendly(error.message) }
  /* A row-level refusal writes nothing and reports success, so the absence of
     the row is what says the policy declined — this is the path a seller
     reaching for another seller's part takes. */
  if (!data?.length) return { ok: false, reason: REFUSED }
  return { ok: true, note: `${part.seller}'s part is now ${to}.` }
}

/** Moving one order to its next stage. */
export async function advance(o: SellerOrder, patch: { carrier?: string; tracking?: string } = {}): Promise<Check> {
  const next = o.stage + 1
  const { data, error } = await supabase.from('orders').update({
    stage: next,
    status: statusFor(o, next),
    ...(patch.carrier ? { carrier: patch.carrier.trim() } : {}),
    ...(patch.tracking ? { tracking_ref: patch.tracking.trim() } : {}),
  }).eq('id', o.id).select('id')

  if (error) return { ok: false, reason: friendly(error.message) }
  if (!data?.length) return { ok: false, reason: REFUSED }
  return { ok: true, note: `${o.order_ref} marked ${(o.stages[next] ?? '').toLowerCase()}.` }
}

/** Recording that it went wrong, with the reason the database insists on. */
export async function markFailed(o: SellerOrder, why: string): Promise<Check> {
  if (!why.trim()) {
    return { ok: false, reason: 'Say what went wrong. "Failed" on its own cannot be acted on by anybody.' }
  }
  const { data, error } = await supabase.from('orders').update({
    failed: true, failed_reason: why.trim(), status: 'failed',
  }).eq('id', o.id).select('id')
  if (error) return { ok: false, reason: friendly(error.message) }
  if (!data?.length) return { ok: false, reason: REFUSED }
  return { ok: true, note: `${o.order_ref} flagged. The marketplace and the buyer both see the reason.` }
}

/**
 * A batch of tracking numbers.
 *
 * One update per row rather than an upsert: an upsert would need the whole row,
 * and the guard exists precisely to stop a seller sending the whole row. Each
 * is reported on its own so a file of forty that half-applies says which half.
 */
export async function applyDispatch(
  rows: readonly DispatchRow[], orders: readonly SellerOrder[],
): Promise<{ applied: number; failures: string[] }> {
  const byRef = new Map(orders.map(o => [o.order_ref, o]))
  const failures: string[] = []
  let applied = 0

  for (const row of rows) {
    const o = byRef.get(row.order_ref)
    if (!o) { failures.push(`${row.order_ref}: no longer in your orders.`); continue }
    const r = await advance(o, { carrier: row.carrier, tracking: row.tracking_ref })
    if (r.ok) applied++
    else failures.push(`${row.order_ref}: ${r.reason}`)
  }
  return { applied, failures }
}

/* `orders.status` is what the buyer's screens read; `stage` is what the rail
   draws. Keeping them in step here rather than in three screens. */
function statusFor(o: SellerOrder, stage: number): string {
  const name = (o.stages[stage] ?? '').toLowerCase()
  if (/deliver/.test(name)) return 'delivered'
  if (/in service|activated/.test(name)) return 'active'
  if (/transit/.test(name)) return 'in-transit'
  if (/dispatch|packed/.test(name)) return 'shipped'
  return 'processing'
}

function friendly(message: string): string {
  if (/another seller/i.test(message)) return message.replace(/^.*?:\s*/, '')
  if (/not moved backwards/i.test(message)) return message.replace(/^.*?:\s*/, '')
  if (/row-level security/i.test(message)) return REFUSED
  /* Postgres prefixes a raised exception; the sentence after it is the one
     written for whoever is reading the screen. */
  const raised = /(?:ERROR:\s*)?(?:P0001:\s*)?(.*)$/.exec(message)
  return raised?.[1] ?? message
}
