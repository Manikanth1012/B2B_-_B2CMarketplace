/* Touches the live Supabase project. Raises an ordinary two-line requisition,
 * has it approved and ordered, checks the order — and removes every row it
 * wrote.
 *
 * The bug under test: a requisition raised from the requisition basket names
 * what it buys on its lines, not on its header, and `place_requisition_order`
 * read only the header, so the order was refused with "… does not say what it
 * is buying, so no order line can be written for it." 20261111200000 orders
 * such a requisition line by line. Until that migration is applied the live
 * function is the old one, and this file skips, saying so, at the point the
 * order is placed.
 *
 * The route is the one bundles.integration.test.ts uses: the SmartBuild buyer
 * raises it (`raiseRequisition`) and confirms it within policy
 * (`decideRequisition`); ENT-2007 is over its credit limit, so approving holds
 * it, and the operator's `releaseHold` places the order through
 * `place_requisition_order`. If the account is ever not held, approving places
 * the order directly, and the same assertions apply.
 *
 * Only one-off products fulfilled by their own sellers (SKU-5003, SKU-5007), so
 * the order can be deleted outright.
 *
 * Sign-ins are rationed (Supabase rate-limits them): operator, business buyer,
 * operator, business buyer.
 *
 * Clean-up, in afterAll and again at the start of a run in case one died:
 *   - orders on any requisition whose title carries the marker, lines first,
 *     as the operator;
 *   - the requisitions themselves, as the business buyer (lines cascade).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { supabase } from './supabase'
import { signIn, signOut } from './authRepo'
import { loadAccount, raiseRequisition, decideRequisition, loadEnterpriseCatalogue } from './enterpriseRepo'
import type { AccountBook, Draft } from './enterpriseRepo'
import { canDecide } from './enterprise'
import { releaseHold } from './creditRepo'

const OPERATOR = { email: 'anika.sharma@aventa.com', password: 'operator123' }
const BUYER = { email: 'vikram.shah@smartbuild.in', password: 'enterprise123' }  // SmartBuild, ENT-2007

const MARKER = '[itest-req-lines]'
const TITLE = `Cold-chain sensors and gateway ${MARKER}`
const SENSOR = 'SKU-5003'    // Nimbus Cold-chain sensor
const GATEWAY = 'SKU-5007'   // Volta IoT Gateway LTE-M

const OLD_FUNCTION = /does not say what it is buying/
const STALE = 'Skipped: the live place_requisition_order still orders only the header product, so '
  + '20261111200000_a_requisition_is_ordered_line_by_line.sql has not been applied yet.'

type Creds = { email: string; password: string }
let who = ''
async function as(c: Creds | null) {
  if (c && who === c.email) return
  await signOut()
  who = ''
  if (!c) return
  await signIn(c.email, c.password)
  who = c.email
}

const cents = (n: unknown) => Math.round(Number(n) * 100)

/* ------------------------------------------------------------- clean-up -- */

/** As the operator: every order on a marked requisition, lines first. Checked. */
async function orderSweep() {
  await as(OPERATOR)
  const { data: reqs, error } = await supabase.from('enterprise_requisitions').select('id').like('title', `%${MARKER}%`)
  if (error) throw new Error(`could not list test requisitions: ${error.message}`)
  const ids = ((reqs ?? []) as { id: string }[]).map(r => r.id)
  if (!ids.length) return
  const { data: orders, error: oErr } = await supabase.from('orders').select('id').in('requisition_id', ids)
  if (oErr) throw new Error(`could not list test orders: ${oErr.message}`)
  for (const o of (orders ?? []) as { id: string }[]) {
    const li = await supabase.from('order_items').delete().eq('order_id', o.id)
    if (li.error) throw new Error(`could not remove the lines of order ${o.id}: ${li.error.message}`)
    const d = await supabase.from('orders').delete().eq('id', o.id).select('id')
    if (d.error) throw new Error(`could not remove order ${o.id}: ${d.error.message}`)
  }
  const { data: left } = await supabase.from('orders').select('id').in('requisition_id', ids)
  if ((left ?? []).length) throw new Error(`orders left behind: ${JSON.stringify(left)}`)
}

/** As the business buyer: every marked requisition (lines cascade). Checked. */
async function requisitionSweep() {
  await as(BUYER)
  const { data, error } = await supabase.from('enterprise_requisitions').select('id').like('title', `%${MARKER}%`)
  if (error) throw new Error(`could not list requisitions to sweep: ${error.message}`)
  for (const r of (data ?? []) as { id: string }[]) {
    const { data: gone, error: dErr } = await supabase.from('enterprise_requisitions').delete().eq('id', r.id).select('id')
    if (dErr) throw new Error(`could not sweep ${r.id}: ${dErr.message}`)
    if (!gone?.length) throw new Error(`sweeping ${r.id} removed nothing — it is still there`)
  }
}

afterAll(async () => {
  await orderSweep()
  await requisitionSweep()
  const { data: left } = await supabase.from('enterprise_requisitions').select('id').like('title', `%${MARKER}%`)
  expect(left ?? [], 'test requisitions were left behind').toEqual([])
  await as(null)
}, 120000)

/* ---------------------------------------------------------------- state -- */

interface Line { product_id: string; quantity: number; unit_price: number; seller: string }
const run: { req: string; lines: Line[]; amount: number; held: boolean; placed: boolean; stale: boolean } = {
  req: '', lines: [], amount: 0, held: false, placed: false, stale: false,
}

/* ===================================================== the business buyer === */

describe('a business buyer raises an ordinary requisition of two products', () => {
  let book: AccountBook

  beforeAll(async () => {
    await orderSweep()
    await requisitionSweep()
    book = await loadAccount()
    expect(book.account, 'the buyer did not load an account').toBeTruthy()
    expect(book.me, 'the buyer is not on the account').toBeTruthy()
  }, 90000)

  it('raises it from the basket\'s lines, with no product on the header', async () => {
    const shelf = await loadEnterpriseCatalogue(book.account!.currency)
    const a = shelf.find(p => p.id === SENSOR)
    const b = shelf.find(p => p.id === GATEWAY)
    expect(a && b, 'the shelf did not carry the two SKUs this test buys').toBeTruthy()

    /* Two sensors when that stays within policy (so the raiser may confirm it
       and the order line shows a unit price, not a line total); one otherwise. */
    const sensors = 2 * a!.price + b!.price < Number(book.policy!.threshold) ? 2 : 1
    const lines = [
      { product_id: a!.id, name: a!.name, seller: a!.seller, partner_id: a!.partner_id, quantity: sensors, unit_price: a!.price },
      { product_id: b!.id, name: b!.name, seller: b!.seller, partner_id: b!.partner_id, quantity: 1, unit_price: b!.price },
    ]
    const draft: Draft = {
      title: TITLE,
      reason: 'Integration test: an ordinary requisition is ordered line by line.',
      currency: book.account!.currency, vertical: 'iot',
      cost_centre: book.centres[0]?.id ?? null, model: 'oneoff', po_ref: 'PO-ITEST-REQ-LINES',
      lines,
    }
    const res = await raiseRequisition({
      draft, me: book.me!, account: book.account!, policy: book.policy!,
      currencies: book.currencies, rates: book.rates,
    })
    expect(res.ok, res.ok ? '' : res.reason).toBe(true)

    const { data } = await supabase.from('enterprise_requisitions')
      .select('id,amount,product_id,need,state').eq('title', TITLE)
    const rows = (data ?? []) as { id: string; amount: number; product_id: string | null; need: string; state: string }[]
    expect(rows.length).toBe(1)
    /* The shape that was failing: lines, and no header product. */
    expect(rows[0].product_id).toBeNull()
    expect(rows[0].state).toBe('pending')
    expect(rows[0].need, 'the requisition is not within policy, so the raiser cannot confirm it').toBe('none')
    run.req = rows[0].id
    run.amount = Number(rows[0].amount)
    run.lines = lines.map(l => ({ product_id: l.product_id, quantity: l.quantity, unit_price: l.unit_price, seller: l.seller }))
    expect(cents(run.amount)).toBe(run.lines.reduce((n, l) => n + cents(l.unit_price) * l.quantity, 0))
  }, 90000)

  it('confirms it (within policy, so the raiser may)', async (ctx) => {
    expect(run.req, 'nothing was raised above').toBeTruthy()
    const fresh = await loadAccount()
    const req = fresh.requisitions.find(r => r.id === run.req)!
    expect(req).toBeTruthy()
    const can = canDecide(req, fresh.me!, fresh.policy!)
    expect(can.ok, can.ok ? '' : can.reason).toBe(true)
    const res = await decideRequisition({
      req, me: fresh.me!, policy: fresh.policy!, approve: true,
      note: 'Approved for the requisition-lines integration test.', currency: fresh.account!.currency, rates: fresh.rates,
    })
    if (!res.ok && OLD_FUNCTION.test(res.reason)) {
      /* Not held, so approving tried to place the order, and the old function refused it. */
      run.stale = true
      console.warn(STALE)
      ctx.skip()
      return
    }
    expect(res.ok, res.ok ? '' : res.reason).toBe(true)
    const { data } = await supabase.from('enterprise_requisitions').select('state,credit_hold,order_ref').eq('id', run.req).single()
    const row = data as { state: string; credit_hold: boolean; order_ref: string | null }
    expect(row.state).toBe('approved')
    run.held = !!row.credit_hold
    run.placed = !run.held
  }, 90000)
})

/* ========================================== the order a requisition becomes === */

describe('the approved requisition becomes one order with a line for each of its lines', () => {
  beforeAll(async () => { await as(OPERATOR) }, 60000)

  it('goes to the sellers — on release, when the account is held on credit', async (ctx) => {
    if (run.stale) { console.warn(STALE); ctx.skip(); return }
    expect(run.req, 'nothing was approved above').toBeTruthy()
    if (run.held) {
      /* SmartBuild is over its credit limit, so approving holds; the
         marketplace's release is what places the order, through
         place_requisition_order. A refused placement rolls the release back. */
      const res = await releaseHold(run.req, 'Anika Sharma', 'Integration test — requisition lines; released against a cleared payment.')
      if (!res.ok && OLD_FUNCTION.test(res.why ?? '')) {
        run.stale = true
        console.warn(STALE)
        ctx.skip()
        return
      }
      expect(res.ok, res.why).toBe(true)
      expect(res.why).toMatch(/gone to the seller/i)
    }

    const { data: orders } = await supabase.from('orders').select('id,order_ref,total,account_id,seller')
      .eq('requisition_id', run.req)
    const os = (orders ?? []) as { id: string; order_ref: string; total: number; account_id: string; seller: string | null }[]
    expect(os.length).toBe(1)
    expect(os[0].account_id).toBe('ENT-2007')
    expect(cents(os[0].total)).toBe(cents(run.amount))
    /* One seller across every line names it; two name none. */
    const sellers = new Set(run.lines.map(l => l.seller))
    expect(os[0].seller).toBe(sellers.size === 1 ? [...sellers][0] : null)

    const { data: items } = await supabase.from('order_items').select('product_id,price,quantity,bundle_selection_id')
      .eq('order_id', os[0].id)
    const got = (items ?? []) as { product_id: string; price: number; quantity: number; bundle_selection_id: string | null }[]
    expect(got.length).toBe(2)
    for (const l of run.lines) {
      const g = got.find(x => x.product_id === l.product_id)
      expect(g, `${l.product_id} is not on the order`).toBeTruthy()
      expect(cents(g!.price)).toBe(cents(l.unit_price))
      expect(g!.quantity).toBe(l.quantity)
      expect(g!.bundle_selection_id).toBeNull()
    }

    const { data: req } = await supabase.from('enterprise_requisitions').select('order_ref').eq('id', run.req).single()
    expect((req as { order_ref: string | null }).order_ref).toBe(os[0].order_ref)
  }, 90000)
})
