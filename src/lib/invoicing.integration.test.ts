/* Touches the live Supabase project, read only. Writes nothing.
 *
 * 20261113400000 (the billing run) and 20261113500000 (the demo trade for
 * Aug to Nov 2026), spec 12:
 *   - SmartBuild is invoiced for August, September and October's delivered
 *     orders, one invoice a month, every line carrying its requisition; the
 *     September bundle's two parts are on one invoice and come back from
 *     `loadRequisitionBundleParts` under their bundle, which is what the
 *     refund form groups by; November's order waits for 1 Dec;
 *   - the buyer cannot run the billing, nor the night;
 *   - Priya Raman sees her orders for the four months.
 *
 * Skipped, saying why, until both migrations are applied: the seeded order
 * ORD-D2608-01 is asked for.
 *
 * Sign-ins: business buyer, shopper.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { supabase } from './supabase'
import { signIn, signOut } from './authRepo'
import { loadRequisitionBundleParts } from './bundleBasketRepo'

const BUYER = { email: 'vikram.shah@smartbuild.in', password: 'enterprise123' }   // SmartBuild, ENT-2007, INR
const SHOPPER = { email: 'priya.raman@example.com', password: 'demo1234' }

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

let applied = false
const skipUnlessApplied = (ctx: { skip: () => void }) => {
  if (!applied) {
    console.warn('Skipped: ORD-D2608-01 is not there, so 20261113400000 and 20261113500000 have not been applied yet.')
    ctx.skip()
  }
}

beforeAll(async () => {
  await as(BUYER)
  const { data, error } = await supabase.from('orders').select('order_ref').eq('order_ref', 'ORD-D2608-01').maybeSingle()
  if (error) throw new Error(`orders could not be read: ${error.message}`)
  applied = !!data
}, 60000)

afterAll(async () => { await as(null) }, 60000)

describe('a business is invoiced for what it ordered', () => {
  it('raises one invoice a month for SmartBuild, August to October, each line carrying its requisition', async (ctx) => {
    skipUnlessApplied(ctx)
    await as(BUYER)
    const ids = ['INV-2007-202608-INR', 'INV-2007-202609-INR', 'INV-2007-202610-INR']
    const { data, error } = await supabase.from('enterprise_invoices')
      .select('id, period, kind, status, oneoff, tax, total, tax_rate, issued, due, po_ref').in('id', ids).order('id')
    expect(error).toBeNull()
    const inv = (data ?? []) as { id: string; period: string; kind: string; status: string; oneoff: number; tax: number; total: number; tax_rate: number; issued: string; due: string; po_ref: string | null }[]
    expect(inv.map(i => [i.id, i.period, i.status])).toEqual([
      ['INV-2007-202608-INR', 'Aug 2026', 'paid'],
      ['INV-2007-202609-INR', 'Sep 2026', 'paid'],
      ['INV-2007-202610-INR', 'Oct 2026', 'open'],
    ])
    for (const i of inv) {
      expect(i.kind).toBe('oneoff')
      expect(Number(i.tax_rate)).toBe(18)
      expect(Math.abs(Number(i.total) - Number(i.oneoff) - Number(i.tax))).toBeLessThanOrEqual(0.01)
      /* Net 30 from the 1st. */
      expect((Date.parse(i.due) - Date.parse(i.issued)) / 86_400_000).toBe(30)
    }
    expect(inv.map(i => i.po_ref)).toEqual(['PO-SB-2026-08D', 'PO-SB-2026-09D', 'PO-SB-2026-10D'])

    const lines = await supabase.from('enterprise_invoice_lines').select('invoice_id, requisition_id, amount').in('invoice_id', ids)
    expect(lines.error).toBeNull()
    const rows = (lines.data ?? []) as { invoice_id: string; requisition_id: string | null; amount: number }[]
    expect(rows.length).toBeGreaterThanOrEqual(4)
    expect(rows.filter(l => !l.requisition_id)).toEqual([])
    for (const i of inv) {
      const sum = rows.filter(l => l.invoice_id === i.id).reduce((n, l) => n + Number(l.amount), 0)
      expect(Math.abs(sum - Number(i.oneoff))).toBeLessThanOrEqual(0.01)
    }
  }, 60000)

  it("stamps each order with its invoice, and leaves November's for 1 Dec", async (ctx) => {
    skipUnlessApplied(ctx)
    const { data } = await supabase.from('orders').select('order_ref, invoice_id')
      .in('order_ref', ['ORD-D2608-01', 'ORD-D2609-01', 'ORD-D2610-01', 'ORD-D2611-01']).order('order_ref')
    expect((data ?? []).map(o => [o.order_ref, o.invoice_id])).toEqual([
      ['ORD-D2608-01', 'INV-2007-202608-INR'],
      ['ORD-D2609-01', 'INV-2007-202609-INR'],
      ['ORD-D2610-01', 'INV-2007-202610-INR'],
      ['ORD-D2611-01', null],
    ])
  }, 60000)

  it('puts both parts of the September bundle on one invoice, and the refund form can group them', async (ctx) => {
    skipUnlessApplied(ctx)
    const { data } = await supabase.from('enterprise_invoice_lines').select('description, requisition_id')
      .eq('invoice_id', 'INV-2007-202609-INR').eq('requisition_id', 'REQ-D2609-01')
    expect((data ?? []).length).toBe(2)
    const parts = await loadRequisitionBundleParts(['REQ-D2609-01'])
    expect(parts.get('REQ-D2609-01::SKU-5003')).toBe('BS-D2609-01')
    expect(parts.get('REQ-D2609-01::SKU-5007')).toBe('BS-D2609-01')
  }, 60000)

  it('lets nobody signed in run the billing or the night', async (ctx) => {
    skipUnlessApplied(ctx)
    const bill = await supabase.rpc('bill_account_orders', { p_as_of: '2000-01-01' })
    expect(bill.error, 'bill_account_orders answered a signed-in buyer').not.toBeNull()
    const night = await supabase.rpc('run_nightly', { p_as_of: '2000-01-01' })
    expect(night.error, 'run_nightly answered a signed-in buyer').not.toBeNull()
  }, 60000)
})

describe('a shopper\'s recent months', () => {
  it('shows Priya Raman her orders from August to November', async (ctx) => {
    skipUnlessApplied(ctx)
    await as(SHOPPER)
    const { data, error } = await supabase.from('orders').select('order_ref, status, currency').like('order_ref', 'ORD-D26%').order('order_ref')
    expect(error).toBeNull()
    expect((data ?? []).map(o => [o.order_ref, o.status, o.currency])).toEqual([
      ['ORD-D2608-S01', 'delivered', 'INR'],
      ['ORD-D2609-S01', 'delivered', 'INR'],
      ['ORD-D2610-S01', 'delivered', 'INR'],
      ['ORD-D2611-S01', 'in transit', 'INR'],
    ])
  }, 60000)
})
