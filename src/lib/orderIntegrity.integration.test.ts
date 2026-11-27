/* Touches the live Supabase project. Refusals only: nothing is written once the
 * migration is applied, because everything tried here is refused, and the
 * order is read back afterwards to prove it.
 *
 * 20261127100000_orders_are_records_once_paid.sql (spec 17), as the shopper
 * Priya Raman, on her own delivered order ORD-D2608-S01:
 *   - an update of the order is refused, and of one of its lines;
 *   - a delete of the order is refused, with a sentence saying why;
 *   - the order and its lines are as they were.
 *
 * Skipped, saying why, until the migration is applied. Detected by behaviour:
 * the shopper "updates" the order's status to the status it already has. Before
 * the migration that is a no-op that comes back with the row (their update
 * policy let it through); after it, no row comes back. Nothing else is tried
 * until the no-op is refused, so a delete is never attempted against a database
 * that would carry it out.
 *
 * Sign-ins: shopper.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { supabase } from './supabase'
import { signIn, signOut } from './authRepo'

const SHOPPER = { email: 'priya.raman@example.com', password: 'demo1234' }
const REF = 'ORD-D2608-S01'

type Row = Record<string, unknown> & { id: string; status: string }
let before: Row | null = null
let lines: Record<string, unknown>[] = []
let applied = false
let why = ''

const skipUnlessApplied = (ctx: { skip: () => void }) => {
  if (!applied) {
    console.warn(`Skipped: ${why}`)
    ctx.skip()
  }
}

async function readBack() {
  const o = await supabase.from('orders').select('*').eq('order_ref', REF).maybeSingle()
  const l = o.data
    ? await supabase.from('order_items').select('*').eq('order_id', (o.data as Row).id).order('id')
    : { data: [], error: null }
  return { order: o.data as Row | null, lines: (l.data ?? []) as Record<string, unknown>[], error: o.error ?? l.error }
}

beforeAll(async () => {
  await signIn(SHOPPER.email, SHOPPER.password)
  const now = await readBack()
  if (now.error) throw new Error(`${REF} could not be read: ${now.error.message}`)
  if (!now.order) throw new Error(`${REF} is not one of ${SHOPPER.email}'s orders, so there is nothing to try`)
  if (now.order.status === 'awaiting_payment') throw new Error(`${REF} is awaiting payment, which a shopper may remove; this file needs a paid order`)
  before = now.order
  lines = now.lines

  /* The no-op that tells the two databases apart. */
  const { data, error } = await supabase.from('orders')
    .update({ status: before.status }).eq('id', before.id).select('id')
  if (error) {
    why = `a no-op update of ${REF} failed (${error.message}), so whether 20261127100000 is applied cannot be told`
    return
  }
  if ((data ?? []).length > 0) {
    why = `the shopper could still update ${REF}, so 20261127100000_orders_are_records_once_paid.sql has not been applied yet`
    return
  }
  applied = true
}, 60000)

afterAll(async () => { await signOut() }, 30000)

describe('a paid order is a record, for the shopper who placed it', () => {
  it('refuses an update of the order', async (ctx) => {
    skipUnlessApplied(ctx)
    const { data, error } = await supabase.from('orders')
      .update({ status: 'cancelled', total: 1 }).eq('id', before!.id).select('id')
    /* No policy lets it through: no row comes back (no error is raised for a row-level refusal). */
    expect(error).toBeNull()
    expect(data ?? [], `${REF} was updated by its shopper`).toEqual([])
  }, 60000)

  it('refuses an update of one of its lines', async (ctx) => {
    skipUnlessApplied(ctx)
    expect(lines.length, `${REF} has no lines to try`).toBeGreaterThan(0)
    const { data, error } = await supabase.from('order_items')
      .update({ price: 1 }).eq('id', String(lines[0].id)).select('id')
    expect(error).toBeNull()
    expect(data ?? [], `a line of ${REF} was updated by its shopper`).toEqual([])
  }, 60000)

  it('refuses a delete of the order, saying why', async (ctx) => {
    skipUnlessApplied(ctx)
    const { data, error } = await supabase.from('orders').delete().eq('id', before!.id).select('id')
    expect(error, `${REF} was removed by its shopper (${JSON.stringify(data)})`).not.toBeNull()
    expect(error!.message).toMatch(/cannot be removed\. It is no longer waiting to be paid, so it is a record of a purchase/)
  }, 60000)

  it('leaves the order and its lines as they were', async (ctx) => {
    skipUnlessApplied(ctx)
    const now = await readBack()
    expect(now.error).toBeNull()
    expect(now.order).toEqual(before)
    expect(now.lines).toEqual(lines)
  }, 60000)
})
