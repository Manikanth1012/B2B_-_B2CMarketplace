/* Reading and moving serialised stock.
 *
 * Four thousand units are on file and none of these functions fetches them all.
 * The counts come from `stock_unit_rollup`, which aggregates in the database —
 * counting rows in the browser would report a percentage of the first thousand
 * PostgREST is willing to return, which is the bug the developer portal already
 * had once.
 */

import { supabase } from './supabase'
import type { StockUnit, UnitEvent, UnitRollup, Drift, UnitState, HoldReason } from './serials'
import { canMove } from './serials'

export type Result = { ok: true; note?: string } | { ok: false; reason: string }

const UNIT_COLS =
  'serial,product_id,warehouse_id,state,hold_reason,received_on,grn_ref,supplier_id,'
  + 'batch_ref,order_id,order_item_id,order_ref,customer,despatched_on,delivered_on,'
  + 'returned_on,note'

/** Every line's counts in one read. Cheap — it is one row per stock line, not
    one per unit. */
export async function loadRollups(): Promise<{ rollups: UnitRollup[]; drift: Drift[] }> {
  const [r, d] = await Promise.all([
    supabase.from('stock_unit_rollup').select('*'),
    supabase.from('serial_consistency').select('*'),
  ])
  return {
    rollups: (r.data ?? []) as UnitRollup[],
    drift: ((d.data ?? []) as Drift[]).filter(x => !x.agrees),
  }
}

/** One stock line's units, newest movement first, capped. A line can hold nine
    hundred and nobody reads nine hundred rows — the counts above the list are
    the answer to "how many" and this is the answer to "which". */
export async function loadLineUnits(
  productId: string, warehouseId: string, opts?: { state?: UnitState | 'all'; limit?: number },
): Promise<StockUnit[]> {
  let q = supabase.from('stock_unit').select(UNIT_COLS)
    .eq('product_id', productId).eq('warehouse_id', warehouseId)
  if (opts?.state && opts.state !== 'all') q = q.eq('state', opts.state)
  const { data } = await q
    .order('despatched_on', { ascending: false, nullsFirst: false })
    .order('received_on')
    .limit(opts?.limit ?? 200)
  return (data ?? []) as unknown as StockUnit[]
}

/** Everything that left this line, so "where did the stock go" is answerable
    without paging through what is still on the shelf. */
export async function loadLineDespatches(
  productId: string, warehouseId: string,
): Promise<StockUnit[]> {
  const { data } = await supabase.from('stock_unit').select(UNIT_COLS)
    .eq('product_id', productId).eq('warehouse_id', warehouseId)
    .not('order_ref', 'is', null)
    .order('despatched_on', { ascending: false })
    .limit(300)
  return (data ?? []) as unknown as StockUnit[]
}

/** The search box. Support does not know whether they are holding a serial, an
    order or a batch, so all of them are tried and the query goes to the
    database rather than filtering a page in the browser. */
export async function findUnits(query: string, limit = 60): Promise<StockUnit[]> {
  const q = query.trim()
  if (q.length < 3) return []
  /* PostgREST `or` needs the wildcards inline. The commas inside a value would
     break the filter, so anything exotic is stripped rather than escaped. */
  const safe = q.replace(/[,()*]/g, ' ').trim()
  if (!safe) return []
  const { data } = await supabase.from('stock_unit').select(UNIT_COLS)
    .or([
      `serial.ilike.%${safe}%`,
      `order_ref.ilike.%${safe}%`,
      `customer.ilike.%${safe}%`,
      `batch_ref.ilike.%${safe}%`,
      `grn_ref.ilike.%${safe}%`,
    ].join(','))
    .order('received_on', { ascending: false })
    .limit(limit)
  return (data ?? []) as unknown as StockUnit[]
}

/** Which units went out on one order. The question the operator actually asks
    when a customer rings about a handset. */
export async function loadOrderUnits(orderRef: string): Promise<StockUnit[]> {
  const { data } = await supabase.from('stock_unit').select(UNIT_COLS)
    .eq('order_ref', orderRef).order('serial')
  return (data ?? []) as unknown as StockUnit[]
}

/** Every unit from a batch, for the recall question. */
export async function loadBatch(batch: string): Promise<StockUnit[]> {
  const { data } = await supabase.from('stock_unit').select(UNIT_COLS)
    .eq('batch_ref', batch).order('serial').limit(500)
  return (data ?? []) as unknown as StockUnit[]
}

export async function loadUnitHistory(serial: string): Promise<UnitEvent[]> {
  const { data } = await supabase.from('stock_unit_event').select('*')
    .eq('serial', serial).order('at', { ascending: false })
  return (data ?? []) as UnitEvent[]
}

/* ---- Moving one ------------------------------------------------------------ */

/** Checked here so the screen can explain the refusal, and checked again by a
    trigger so it cannot be skipped by talking to the API directly. */
export async function moveUnit(
  unit: StockUnit, to: UnitState, opts?: { hold?: HoldReason | null; note?: string },
): Promise<Result> {
  const check = canMove(unit, to, opts?.hold)
  if (!check.ok) return check

  const patch: Record<string, unknown> = { state: to, note: opts?.note ?? unit.note }
  if (to === 'reserved') patch.hold_reason = opts?.hold ?? null
  if (to === 'in_stock') {
    /* Back on the shelf is back to nothing: no hold, no order, no despatch
       date. Leaving them would let a serial carry an order it did not ship on. */
    Object.assign(patch, {
      hold_reason: null, order_id: null, order_item_id: null, order_ref: null,
      customer: null, despatched_on: null, delivered_on: null,
    })
  }
  if (to === 'delivered') patch.delivered_on = new Date().toISOString().slice(0, 10)
  if (to === 'returned') patch.returned_on = new Date().toISOString().slice(0, 10)
  if (to === 'despatched') patch.despatched_on = new Date().toISOString().slice(0, 10)

  const { error } = await supabase.from('stock_unit').update(patch).eq('serial', unit.serial)
  if (error) return { ok: false, reason: friendly(error.message) }
  return { ok: true, note: check.note }
}

/** Receiving a delivery mints the serials. Without this an inbound quantity
    lands as a number and the units it is made of never exist. */
export async function receiveUnits(
  productId: string, warehouseId: string, qty: number,
  grn?: string, batch?: string,
): Promise<Result & { from?: string; to?: string }> {
  const { data, error } = await supabase.rpc('receive_units', {
    p_product: productId, p_warehouse: warehouseId, p_qty: qty,
    p_grn: grn || null, p_batch: batch || null, p_on: null,
  })
  if (error) return { ok: false, reason: friendly(error.message) }
  const r = data as { ok: boolean; why?: string; received?: number; from?: string; to?: string }
  if (!r.ok) return { ok: false, reason: r.why ?? 'That receipt was refused.' }
  return {
    ok: true,
    note: `${r.received} units received, ${r.from} to ${r.to}.`,
    from: r.from, to: r.to,
  }
}

/** Picking against an order line. Oldest first, and a short pick is reported
    rather than quietly sending four of six. */
export async function despatchUnits(orderItemId: string, qty?: number): Promise<
  Result & { serials?: string[] }
> {
  const { data, error } = await supabase.rpc('despatch_units', {
    p_order_item: orderItemId, p_qty: qty ?? null,
  })
  if (error) return { ok: false, reason: friendly(error.message) }
  const r = data as { ok: boolean; why?: string; serials?: string[] }
  if (!r.ok) return { ok: false, reason: r.why ?? 'Nothing could be picked.', serials: r.serials }
  return { ok: true, note: `${r.serials?.length ?? 0} units picked.`, serials: r.serials }
}

/** The ledger follows the units. Called after anything that changes a count,
    so the stored number is never the one that drifted. */
export async function recountLine(productId: string, warehouseId: string): Promise<Result> {
  const { data } = await supabase.from('stock_unit_rollup').select('*')
    .eq('product_id', productId).eq('warehouse_id', warehouseId).maybeSingle()
  const r = (data ?? { on_hand: 0, reserved: 0 }) as UnitRollup
  const { error } = await supabase.from('operator_inventory')
    .update({ on_hand: r.on_hand ?? 0, reserved: r.reserved ?? 0 })
    .eq('product_id', productId).eq('warehouse_id', warehouseId)
  if (error) return { ok: false, reason: friendly(error.message) }
  return { ok: true, note: `Recounted: ${r.on_hand ?? 0} on hand, ${r.reserved ?? 0} reserved.` }
}

function friendly(message: string): string {
  const m = message.replace(/^.*?\bERROR:\s*/i, '').trim()
  if (/row-level security/i.test(m)) {
    return 'You are not allowed to change that. Only the marketplace moves stock.'
  }
  return m
}
