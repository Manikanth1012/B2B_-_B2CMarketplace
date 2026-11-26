/* Touches the live Supabase project, read only. Writes nothing.
 *
 * 20261126100000, spec 14:
 *   - SmartBuild's subscriptions are invoiced monthly, August to October,
 *     one `-S` invoice a month with a line per subscription that was
 *     running that month;
 *   - nothing the buyer can read is open past its due date;
 *   - the buyer cannot run the billing, the overdue sweep, nor the invoicing.
 *
 * Skipped, saying why, until the migration is applied: INV-2007-202608-INR-S
 * is asked for.
 *
 * Sign-in: business buyer.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { supabase } from './supabase'
import { signIn, signOut } from './authRepo'

const BUYER = { email: 'vikram.shah@smartbuild.in', password: 'enterprise123' }   // SmartBuild, ENT-2007, INR

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
    console.warn('Skipped: INV-2007-202608-INR-S is not there, so 20261126100000 has not been applied yet.')
    ctx.skip()
  }
}

beforeAll(async () => {
  await as(BUYER)
  const { data, error } = await supabase.from('enterprise_invoices').select('id').eq('id', 'INV-2007-202608-INR-S').maybeSingle()
  if (error) throw new Error(`enterprise_invoices could not be read: ${error.message}`)
  applied = !!data
}, 60000)

afterAll(async () => { await as(null) }, 60000)

const MONTHS: [string, string, string, string[]][] = [
  ['INV-2007-202608-INR-S', 'Aug 2026', '2026-08-31', ['paid']],
  ['INV-2007-202609-INR-S', 'Sep 2026', '2026-09-30', ['paid']],
  ['INV-2007-202610-INR-S', 'Oct 2026', '2026-10-31', ['open', 'overdue']],
]

describe('a business is invoiced for its subscriptions', () => {
  it('raises one recurring invoice a month for SmartBuild, August to October', async (ctx) => {
    skipUnlessApplied(ctx)
    await as(BUYER)
    const { data, error } = await supabase.from('enterprise_invoices')
      .select('id, period, kind, status, recurring, tax, total, tax_rate').in('id', MONTHS.map(m => m[0])).order('id')
    expect(error).toBeNull()
    const inv = (data ?? []) as { id: string; period: string; kind: string; status: string; recurring: number; tax: number; total: number; tax_rate: number }[]
    expect(inv.map(i => i.id)).toEqual(MONTHS.map(m => m[0]))
    inv.forEach((i, n) => {
      expect(i.period).toBe(MONTHS[n][1])
      expect(MONTHS[n][3], `${i.id} is ${i.status}`).toContain(i.status)
      expect(i.kind).toBe('recurring')
      expect(Number(i.tax_rate)).toBe(18)
      expect(Math.abs(Number(i.total) - Number(i.recurring) - Number(i.tax))).toBeLessThanOrEqual(0.01)
    })
  }, 60000)

  it('has a line for each subscription running that month, and the lines add up', async (ctx) => {
    skipUnlessApplied(ctx)
    await as(BUYER)
    const subs = await supabase.from('enterprise_subscriptions').select('id, status, started')
    expect(subs.error).toBeNull()
    const all = (subs.data ?? []) as { id: string; status: string; started: string }[]
    for (const [id, , monthEnd] of MONTHS) {
      const inv = await supabase.from('enterprise_invoices').select('recurring').eq('id', id).single()
      expect(inv.error).toBeNull()
      const lines = await supabase.from('enterprise_invoice_lines').select('kind, subscription_id, amount').eq('invoice_id', id)
      expect(lines.error).toBeNull()
      const rows = (lines.data ?? []) as { kind: string; subscription_id: string | null; amount: number }[]
      for (const l of rows) {
        expect(l.kind, id).toBe('subscription')
        expect(l.subscription_id, id).not.toBeNull()
      }
      const expected = all.filter(s => ['active', 'suspended'].includes(s.status) && s.started <= monthEnd).map(s => s.id).sort()
      expect(rows.map(l => l.subscription_id as string).sort(), id).toEqual(expected)
      expect(expected.length).toBeGreaterThan(0)
      const sum = rows.reduce((t, l) => t + Number(l.amount), 0)
      expect(Math.abs(sum - Number((inv.data as { recurring: number }).recurring)), id).toBeLessThanOrEqual(0.01)
    }
  }, 60000)

  it('leaves no invoice open past its due date', async (ctx) => {
    skipUnlessApplied(ctx)
    await as(BUYER)
    const today = new Date().toISOString().slice(0, 10)
    const { data, error } = await supabase.from('enterprise_invoices').select('id, due').eq('status', 'open').lt('due', today)
    expect(error).toBeNull()
    expect(data ?? []).toEqual([])
  }, 60000)

  it('lets nobody signed in run the billing, the sweep, nor the invoicing', async (ctx) => {
    skipUnlessApplied(ctx)
    await as(BUYER)
    for (const fn of ['bill_account_subscriptions', 'mark_overdue_invoices', 'run_invoicing']) {
      const r = await supabase.rpc(fn, { p_as_of: '2000-01-01' })
      expect(r.error, `${fn} answered a signed-in buyer`).not.toBeNull()
    }
  }, 60000)
})
