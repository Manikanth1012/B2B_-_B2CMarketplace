/* Touches the live Supabase project.
 *
 * A settlement has two legs — what the marketplace computed and what the
 * seller's bank receives — and the whole claim of `20260802420000` is that the
 * second one is frozen rather than recomputed. These checks are that claim, run
 * against the real rows.
 *
 * The unit tests in `settlement.test.ts` prove the arithmetic. This proves the
 * arithmetic was actually applied, which is a different thing and the one that
 * keeps not being true.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { supabase } from './supabase'
import { signIn, signOut } from './authRepo'
import { payoutAgrees, statementAddsUp, periodEnd } from './settlement'

const OPERATOR = { email: 'anika.sharma@aventa.com', password: 'operator123' }

interface Row {
  id: string
  partner_id: string | null
  partner_name: string
  period: string
  net: number
  currency: string
  payout_currency: string
  payout_net: number
  fx_rate: number
  fx_as_of: string
  gross: number
  commission: number
  fees: number
  withholding: number
  refunds: number
  adjustments: number
}

describe('what a seller is actually paid', () => {
  let rows: Row[] = []
  let banks: { partner_id: string; currency: string }[] = []
  let rates: { base: string; quote: string; rate: number; as_of: string }[] = []

  beforeAll(async () => {
    await signIn(OPERATOR.email, OPERATOR.password)
    const [s, b, f] = await Promise.all([
      supabase.from('settlement_statements').select('*'),
      supabase.from('partner_bank').select('partner_id, currency'),
      supabase.from('fx_rates').select('base, quote, rate, as_of'),
    ])
    rows = (s.data ?? []) as Row[]
    banks = (b.data ?? []) as { partner_id: string; currency: string }[]
    rates = ((f.data ?? []) as { base: string; quote: string; rate: number; as_of: string }[])
      .map(r => ({ ...r, rate: Number(r.rate) }))
  }, 30000)

  afterAll(async () => { await signOut() })

  it('has statements to check, in more than one payout currency', async () => {
    /* The floor. If every seller banked in dollars, every assertion below would
       pass having compared nothing — the failure this suite exists to avoid. */
    expect(rows.length).toBeGreaterThan(20)
    const paid = new Set(rows.map(r => r.payout_currency))
    expect(paid.size, `only ${[...paid].join(', ')} — nothing was converted`).toBeGreaterThan(2)
    expect(rows.filter(r => Number(r.fx_rate) !== 1).length).toBeGreaterThan(0)
  })

  it('remits into the currency the seller’s account actually takes', async () => {
    const wrong = rows.filter(r => {
      const bank = banks.find(b => b.partner_id === r.partner_id)
      /* No bank row is the marketplace's own first-party line, which settles in
         the currency it is computed in because there is nobody to pay. */
      const owed = bank?.currency ?? r.currency
      return r.payout_currency !== owed
    })
    expect(wrong.map(r => `${r.id} pays ${r.payout_currency}`)).toEqual([])
  })

  it('reproduces its own conversion', async () => {
    /* Catches a rate edited without the amount and an amount edited without the
       rate — the two halves of the same drift, neither visible on the screen
       because both look like ordinary numbers. */
    const drifted = rows.filter(r => !payoutAgrees(r))
    expect(drifted.map(r => `${r.id}: ${r.net} × ${r.fx_rate} ≠ ${r.payout_net}`)).toEqual([])
  })

  it('used a fix that was in force when the period closed, never a later one', async () => {
    const late = rows.filter(r => {
      const end = periodEnd(r.period)
      return end !== null && r.fx_as_of > end
    })
    expect(late.map(r => `${r.id} for ${r.period} used ${r.fx_as_of}`)).toEqual([])
  })

  it('names a rate that is actually on file', async () => {
    /* A number typed onto the row would satisfy every check above. This is the
       one that says the conversion came from the rate table. */
    const invented = rows.filter(r => Number(r.fx_rate) !== 1 && !rates.some(f =>
      f.base === r.currency && f.quote === r.payout_currency
      && f.as_of === r.fx_as_of && Math.abs(f.rate - Number(r.fx_rate)) < 1e-9))
    expect(invented.map(r => `${r.id} claims ${r.fx_rate} on ${r.fx_as_of}`)).toEqual([])
  })

  it('still adds up in the currency it was computed in', async () => {
    /* Untouched by the payout leg, and asserted for that reason: a change that
       leaves the arithmetic alone should be able to prove it did. */
    expect(rows.filter(r => !statementAddsUp(r)).map(r => r.id)).toEqual([])
  })

  it('has a rate on file old enough for every period it settles', async () => {
    /* Before this there were two fixes and statements going back to February,
       so half the book could not be dated at all. */
    const gaps = rows.filter(r => Number(r.fx_rate) === 1 ? false : (() => {
      const end = periodEnd(r.period)
      if (!end) return true
      return !rates.some(f => f.base === r.currency && f.quote === r.payout_currency && f.as_of <= end)
    })())
    expect(gaps.map(r => `${r.id} for ${r.period}`)).toEqual([])
  })

  it('does not pay a rupee account a figure that looks like dollars', async () => {
    /* Plausibility. Every check above compares a row to itself or to a rate,
       and all of them would pass on an unconverted figure relabelled. */
    const small = rows.filter(r =>
      ['INR', 'KES'].includes(r.payout_currency) && Number(r.payout_net) < 10000)
    expect(small.map(r => `${r.id}: ${r.payout_net} ${r.payout_currency}`)).toEqual([])
  })
})
