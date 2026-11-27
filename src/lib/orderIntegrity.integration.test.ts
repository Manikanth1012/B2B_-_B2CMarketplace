/* Touches the live Supabase project. Refusals only: everything tried here is
 * refused once the migration is applied, and the order is read back afterwards
 * to prove nothing changed. Before it is applied nothing is tried at all.
 *
 * 20261127100000_orders_are_records_once_paid.sql (spec 17), as the shopper
 * Priya Raman, on her own delivered order ORD-D2608-S01:
 *   - an update of the order is refused, and of one of its lines;
 *   - a delete of the order is refused, with a sentence saying why;
 *   - an order written as `placed`, with no payment behind it, is refused;
 *   - the order and its lines are as they were.
 *
 * Skipped, saying why, until the migration is applied: the read-only marker
 * `orders_are_records()` is called, and a missing function means it is not
 * there yet.
 *
 * Sign-ins: shopper.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { supabase } from './supabase'
import { signIn, signOut } from './authRepo'

const SHOPPER = { email: 'priya.raman@example.com', password: 'demo1234' }
const REF = 'ORD-D2608-S01'

type Row = Record<string, unknown> & { id: string; status: string; user_id: string; currency: string }
let before: Row | null = null
let lines: Record<string, unknown>[] = []
let applied = false

const skipUnlessApplied = (ctx: { skip: () => void }) => {
  if (!applied) {
    console.warn('Skipped: there is no orders_are_records() function, so 20261127100000_orders_are_records_once_paid.sql has not been applied yet.')
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
  const { data, error } = await supabase.rpc('orders_are_records')
  if (error) {
    if (/could not find|does not exist|schema cache/i.test(error.message)) return
    throw new Error(`orders_are_records() could not be called: ${error.message}`)
  }
  if (data !== true) throw new Error(`orders_are_records() answered ${JSON.stringify(data)}, not true`)
  applied = true

  const now = await readBack()
  if (now.error) throw new Error(`${REF} could not be read: ${now.error.message}`)
  if (!now.order) throw new Error(`${REF} is not one of ${SHOPPER.email}'s orders, so there is nothing to try`)
  if (now.order.status === 'awaiting_payment') throw new Error(`${REF} is awaiting payment, which a shopper may remove; this file needs a paid order`)
  before = now.order
  lines = now.lines
}, 60000)

afterAll(async () => { await signOut() }, 30000)

describe('a paid order is a record, for the shopper who placed it', () => {
  it('refuses an update of the order', async (ctx) => {
    skipUnlessApplied(ctx)
    const { data, error } = await supabase.from('orders')
      .update({ status: 'cancelled', total: 1 }).eq('id', before!.id).select('id')
    /* No policy lets it through: no row comes back (a row-level refusal raises no error). */
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

  it('refuses an order written as placed, with no payment behind it', async (ctx) => {
    skipUnlessApplied(ctx)
    const { data, error } = await supabase.from('orders').insert({
      order_ref: `ORD-OI-UNPAID-${Date.now().toString(36).toUpperCase()}`, status: 'placed',
      total: 1, subtotal: 1, tax: 0, discount: 0, payment_method: 'card',
      buyer_name: 'Priya Raman', buyer_email: SHOPPER.email, shipping_address: {},
      /* No market, so the currency guard has nothing to ask and the refusal
         is the insert policy's own. */
      market: null, currency: before!.currency, user_id: before!.user_id,
    }).select('id')
    expect(error, `a placed order was written by a shopper (${JSON.stringify(data)})`).not.toBeNull()
    expect(error!.message).toMatch(/row-level security/i)
  }, 60000)

  it('leaves the order and its lines as they were', async (ctx) => {
    skipUnlessApplied(ctx)
    const now = await readBack()
    expect(now.error).toBeNull()
    expect(now.order).toEqual(before)
    expect(now.lines).toEqual(lines)
  }, 60000)
})
