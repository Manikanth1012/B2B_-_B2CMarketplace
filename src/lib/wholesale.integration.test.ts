/* Touches the live Supabase project.
 *
 * Six products carried the `partner` audience and nothing could buy one. There
 * are three claims here and the middle one is the reason the file exists:
 *
 *   - `chargesOver` and `wholesale_charges` are the same arithmetic, checked
 *     against every standing order on file rather than against a fixture
 *   - a charge nets off against the settlement up to what the period owes and
 *     no further, and the shortfall carries — tried on the statement that
 *     actually runs out of money, not asserted about one
 *   - a seller may take a product and may not take their own, their neighbour's
 *     purchases, or one the marketplace has not published
 *
 * Everything written here is put back.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { supabase } from './supabase'
import { signIn, signOut } from './authRepo'
import { chargesOver, netOff, buyProblem, outstanding, daysCharged } from './wholesale'
import type { Purchase, Charge } from './wholesale'

const OPERATOR = { email: 'anika.sharma@aventa.com', password: 'operator123' }
const NIMBUS = { email: 'rajesh.kumar@nimbussensors.com', password: 'partner123' }
const BEACON = { email: 'amara.okonkwo@example.com', password: 'partner123' }

const nums = <T,>(rows: unknown, keys: string[]): T[] =>
  ((rows ?? []) as Record<string, unknown>[]).map(r => {
    const out = { ...r }
    for (const k of keys) out[k] = Number(out[k] ?? 0)
    return out
  }) as T[]

describe('what a partner buys, and how it comes off what they are owed', () => {
  let buys: Purchase[]
  let bills: Charge[]
  const made: string[] = []

  beforeAll(async () => {
    await signIn(OPERATOR.email, OPERATOR.password)
    const [p, c] = await Promise.all([
      supabase.from('partner_purchase').select('*').order('id'),
      supabase.from('partner_charge').select('*').order('period_start'),
    ])
    expect(p.error, p.error?.message).toBeNull()
    expect(c.error, c.error?.message).toBeNull()
    buys = nums<Purchase>(p.data, ['quantity', 'unit_price'])
    bills = nums<Charge>(c.data, ['quantity', 'unit_price', 'days_charged', 'days_in_period', 'gross', 'recovered'])
    expect(buys.length, 'nothing is on the partner shelf').toBeGreaterThan(0)
  }, 30_000)

  afterAll(async () => {
    await signIn(OPERATOR.email, OPERATOR.password)
    for (const id of made) {
      await supabase.from('partner_charge').delete().eq('purchase_id', id)
      await supabase.from('partner_purchase').delete().eq('id', id)
    }
    await signOut()
  })

  /* The claim the file exists for: two evaluations of one rule. */
  it('agrees with the database about what every standing order costs', async () => {
    const wrong: string[] = []
    for (const b of buys) {
      const to = b.ends_on ?? '2026-12-31'
      const { data, error } = await supabase.rpc('wholesale_charges', {
        p_partner: b.partner_id, p_from: b.started_on, p_to: to,
      })
      expect(error, error?.message).toBeNull()
      const theirs = ((data ?? []) as Record<string, unknown>[])
        .filter(r => r.purchase_id === b.id)
        .map(r => `${r.month_start}:${Number(r.gross).toFixed(2)}:${r.days_charged}`)
        .sort()
      const mine = chargesOver([b], b.started_on, to)
        .map(r => `${r.month_start}:${r.gross.toFixed(2)}:${r.days_charged}`)
        .sort()
      if (JSON.stringify(theirs) !== JSON.stringify(mine)) {
        wrong.push(`${b.id}: sql ${JSON.stringify(theirs)} vs ts ${JSON.stringify(mine)}`)
      }
    }
    expect(wrong, wrong.join('; ')).toEqual([])
  }, 60_000)

  it('charges a monthly product once per calendar month, not once per settlement period', () => {
    /* Beacon settles quarterly. Its quarter has to carry three charges — one
       would bill a reseller for a third of what they used. */
    const quarter = bills.filter(c => c.purchase_id === 'PP-1009-01'
      && c.period_start >= '2026-07-01' && c.period_start < '2026-10-01')
    expect(quarter.length).toBe(3)
    for (const c of quarter) expect(c.period_start.slice(0, 7)).not.toBe(c.period_end.slice(5, 7))
  })

  it('pro-rates the month a purchase started in, and shows the fraction', () => {
    const part = bills.filter(c => c.days_charged < c.days_in_period)
    expect(part.length, 'no part-month charge exists, so the pro-rata is untested').toBeGreaterThan(0)
    for (const c of part) {
      const d = daysCharged(c.period_start, c.period_end, c.period_start, null)
      expect(c.days_in_period, `${c.id} counts the wrong number of days in its month`).toBe(d.inPeriod)
      const full = c.unit_price * c.quantity
      expect(c.gross, `${c.id} was charged a full month for part of one`).toBeLessThan(full)
    }
  })

  /* Free means free — a zero line is one a partner reads past. */
  it('raises no charge for something that costs nothing', () => {
    const free = buys.find(b => b.unit_price === 0)
    expect(free, 'no free purchase on file').toBeTruthy()
    expect(bills.filter(c => c.purchase_id === free!.id)).toEqual([])
    expect(bills.filter(c => c.gross <= 0)).toEqual([])
  })

  /* The case the design exists for. */
  it('nets off what the period can cover and carries the rest', async () => {
    const { data } = await supabase.from('settlement_statements')
      .select('*').eq('id', 'ss-1009-202607').maybeSingle()
    const st = data as Record<string, unknown>
    expect(st, 'Beacon has no quarter to check').toBeTruthy()

    /* The whole quarter went on wholesale and nothing is paid out — but the
       statement is not negative. You cannot net off against money that is not
       there. */
    expect(Number(st.net), 'the statement was netted below zero').toBeGreaterThanOrEqual(0)

    const left = outstanding(bills.filter(c => c.partner_id === 'PTR-1009'))
    expect(left, 'the quarter covered everything, so the shortfall case is not on file')
      .toBeGreaterThan(0)

    /* And the module comes to the same split as the run did. */
    const room = Number(st.gross) - Number(st.commission) - Number(st.fees)
      - Number(st.refunds) - Number(st.withholding) - Number(st.held_back) + Number(st.carried_in)
    const mine = netOff({
      room,
      charges: bills.filter(c => c.partner_id === 'PTR-1009')
        .map(c => ({ id: c.id, gross: c.gross, recovered: 0 })),
    })
    expect(Math.abs(mine.carried - left), 'the module and the run disagree on the shortfall')
      .toBeLessThan(0.02)
  })

  /* Every take is recorded against a statement, and the sum of those is what
     the charge says it recovered. A stored figure nothing recomputes drifts. */
  it('recovers exactly what its recoveries add up to', async () => {
    const { data } = await supabase.from('partner_charge_recovery').select('*')
    const rows = (data ?? []) as { charge_id: string; amount: string }[]
    for (const c of bills) {
      const summed = rows.filter(r => r.charge_id === c.id)
        .reduce((n, r) => n + Number(r.amount), 0)
      expect(Math.abs(summed - c.recovered), `${c.id}`).toBeLessThan(0.005)
    }
  })

  /* `apply_notes` recomputed the adjustment from what was still outstanding, so
     a second call found nothing and reset it to zero. Every settlement run
     calls it, and runs are meant to be repeatable. */
  it('produces the same statement on a second pass as on the first', async () => {
    const before = await supabase.from('settlement_statements')
      .select('net, adjustments, adjustment_detail').eq('id', 'ss-1002-202607').maybeSingle()
    const b = before.data as Record<string, unknown>

    const { error } = await supabase.rpc('apply_settlement_adjustments', { p_statement: 'ss-1002-202607' })
    expect(error, error?.message).toBeNull()

    const after = await supabase.from('settlement_statements')
      .select('net, adjustments, adjustment_detail').eq('id', 'ss-1002-202607').maybeSingle()
    const a = after.data as Record<string, unknown>
    expect(Number(a.net), 'the net moved on a repeat pass').toBe(Number(b.net))
    expect(Number(a.adjustments), 'the adjustment moved on a repeat pass').toBe(Number(b.adjustments))
    expect((a.adjustment_detail as unknown[]).length).toBe((b.adjustment_detail as unknown[]).length)
  })

  /* ------------------------------------------------------- what a seller can do */

  it('lets a seller take a product, and freezes its price on the way in', async () => {
    await signOut()
    await signIn(NIMBUS.email, NIMBUS.password)

    const { data, error } = await supabase.rpc('buy_partner_product', {
      p_product: 'SKU-7001', p_quantity: 2, p_note: 'Written by the integration suite.',
    })
    expect(error, error?.message).toBeNull()
    const out = data as { ok: boolean; id: string; unit_price: number; currency: string }
    expect(out.ok, JSON.stringify(data)).toBe(true)
    made.push(out.id)

    const { data: row } = await supabase.from('partner_purchase')
      .select('*').eq('id', out.id).maybeSingle()
    const r = row as Record<string, unknown>
    expect(r.partner_id).toBe('PTR-1004')
    expect(Number(r.quantity)).toBe(2)
    expect(r.currency, 'a purchase in a currency no statement is denominated in').toBe('USD')
    /* Off the price book rather than off the request — a client that could name
       its own price would be a client that could buy at zero. */
    const { data: book } = await supabase.from('product_prices')
      .select('price').eq('product_id', 'SKU-7001').eq('currency', 'USD').maybeSingle()
    expect(Number(r.unit_price)).toBe(Number((book as { price: string }).price))
    /* And the actor is the session's, not a string the caller supplied. */
    expect(String(r.ordered_by)).toContain('nimbussensors.com')
  }, 30_000)

  it('refuses a seller their own listing, in the database as well as on the screen', async () => {
    await signOut()
    await signIn(BEACON.email, BEACON.password)

    const { data, error } = await supabase.rpc('buy_partner_product', {
      p_product: 'SKU-7009', p_quantity: 1, p_note: null,
    })
    expect(error?.message ?? JSON.stringify(data), 'Beacon bought its own bundle')
      .toMatch(/does not buy from themselves/)

    const out = buyProblem(
      { id: 'SKU-7009', name: 'Beacon wholesale voice bundle — 200 lines', status: 'live',
        audiences: ['partner', 'enterprise'], partner_id: 'PTR-1009',
        seller: 'Beacon Reseller Co', billing_period: 'monthly' },
      { id: 'PTR-1009', name: 'Beacon Reseller Co', status: 'live' })
    expect(out).toMatch(/does not buy from themselves/)
  }, 30_000)

  it('refuses one the marketplace has not published', async () => {
    await signOut()
    await signIn(NIMBUS.email, NIMBUS.password)
    const { data, error } = await supabase.rpc('buy_partner_product', {
      p_product: 'SKU-7004', p_quantity: 1, p_note: null,
    })
    expect(error?.message ?? JSON.stringify(data)).toMatch(/not live/)
  })

  it('refuses a product that is not sold to partners at all', async () => {
    const { data: any1 } = await supabase.from('products')
      .select('id').not('audiences', 'cs', '{partner}').eq('status', 'live').limit(1)
    const other = ((any1 ?? []) as { id: string }[])[0]
    expect(other, 'every product is sold to partners, so this cannot be tested').toBeTruthy()
    const { data, error } = await supabase.rpc('buy_partner_product', {
      p_product: other!.id, p_quantity: 1, p_note: null,
    })
    expect(error?.message ?? JSON.stringify(data)).toMatch(/not sold to partners/)
  })

  it('shows a seller their own standing orders and nobody else\'s', async () => {
    const { data } = await supabase.from('partner_purchase').select('partner_id')
    const seen = new Set(((data ?? []) as { partner_id: string }[]).map(r => r.partner_id))
    expect([...seen].filter(p => p !== 'PTR-1004'), 'a seller can see another seller\'s purchases')
      .toEqual([])

    const { data: c } = await supabase.from('partner_charge').select('partner_id')
    const seenC = new Set(((c ?? []) as { partner_id: string }[]).map(r => r.partner_id))
    expect([...seenC].filter(p => p !== 'PTR-1004')).toEqual([])
  })

  /* Read-only to a partner. Both writes freeze a price or record a reason, and
     a policy can refuse a write but cannot fill one in. */
  it('does not let a seller write the tables directly', async () => {
    const { data: wrote } = await supabase.from('partner_purchase').insert({
      id: 'PP-9999-99', partner_id: 'PTR-1004', product_id: 'SKU-7001',
      product_name: 'White-label storefront', quantity: 1, unit_price: 0.01,
      ordered_by: 'nobody',
    }).select('id')
    expect(wrote ?? [], 'a seller wrote themselves a one-cent storefront').toEqual([])
  })

  it('stops one, and charges the month to the day it stopped', async () => {
    expect(made.length, 'nothing was taken to stop').toBeGreaterThan(0)
    const id = made[0]
    const { data, error } = await supabase.rpc('cancel_partner_purchase', {
      p_id: id, p_reason: 'Written by the integration suite.',
    })
    expect(error, error?.message).toBeNull()
    expect((data as { ok: boolean }).ok).toBe(true)

    const { data: row } = await supabase.from('partner_purchase')
      .select('state, ends_on, cancelled_on, cancel_reason').eq('id', id).maybeSingle()
    const r = row as Record<string, string>
    expect(r.state).toBe('cancelled')
    expect(r.ends_on, 'a stopped purchase with no end date runs forever').toBeTruthy()
    expect(r.ends_on).toBe(r.cancelled_on)

    /* A cancellation with no reason cannot be answered when it is queried. */
    const bad = await supabase.rpc('cancel_partner_purchase', { p_id: id, p_reason: '   ' })
    expect(bad.error?.message ?? JSON.stringify(bad.data)).toMatch(/already stopped|Say why/)
  }, 30_000)
})
