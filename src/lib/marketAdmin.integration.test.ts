/* Touches the live Supabase project. Writes, and puts back what it changed.
 *
 * `marketAdmin.ts` tells the operator what they may do to a market's currencies
 * before they click. The database decides — `guard_market_currency` keeps one
 * default per market, `guard_market_currency_removal` refuses the last currency
 * and refuses to orphan bills, and RLS decides who may write at all.
 *
 * The pure suite proves the sentences are right. This proves the sentences match
 * what actually happens, which is the only thing that makes stating a rule twice
 * safe.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { supabase } from './supabase'
import { signIn, signOut } from './authRepo'
import { addableTo, canRemove, canMakeDefault } from './marketAdmin'
import {
  loadMoneyBook, addMarketCurrency, removeMarketCurrency,
  setDefaultCurrency, currencyFootprint,
} from './moneyRepo'
import { currenciesOf } from './money'
import type { Currency, Market, MarketCurrency } from './money'

const OPERATOR = { email: 'anika.sharma@aventa.com', password: 'operator123' }
const PARTNER = { email: 'rajesh.kumar@nimbussensors.com', password: 'partner123' }

let markets: Market[] = []
let currencies: Currency[] = []
let accepted: MarketCurrency[] = []

const refresh = async () => {
  const b = await loadMoneyBook()
  markets = b.markets; currencies = b.currencies; accepted = b.accepted
}

beforeAll(async () => {
  await signIn(OPERATOR.email, OPERATOR.password)
  await refresh()
  expect(markets.length).toBeGreaterThan(1)
})

afterAll(async () => { await signOut() })

/* ------------------------------------------------ what is there now --- */

describe('the arrangement as configured', () => {
  it('gives every market exactly one default, and the market row agrees', async () => {
    for (const m of markets) {
      const takes = currenciesOf(m.code, accepted)
      expect(takes.length, `${m.code} accepts nothing`).toBeGreaterThan(0)
      expect(takes[0], `${m.code} disagrees with its own default`).toBe(m.currency)
    }
  })

  it('offers only currencies a market does not already take', () => {
    for (const m of markets) {
      const offered = addableTo(m.code, accepted, currencies)
      const have = currenciesOf(m.code, accepted)
      for (const c of offered) expect(have).not.toContain(c)
      expect(offered.length + have.length).toBe(currencies.length)
    }
  })
})

/* ------------------------------------- adding, defaulting, removing --- */

describe('as the operator, configuring a market', () => {
  /* India is the single-currency market by design, so it is the one where
     adding and removing a currency changes something and can be put back
     exactly. Every step is undone in the finally. */
  const MARKET = 'IN'

  it('adds a currency, makes it the default, puts it back, and removes it', async () => {
    const before = currenciesOf(MARKET, accepted)
    expect(before, 'India is no longer the single-currency market this test relies on')
      .toEqual(['INR'])

    const spare = addableTo(MARKET, accepted, currencies)[0]
    expect(spare, 'no currency left to add').toBeTruthy()

    try {
      /* --- added, and not as the default -------------------------------- */
      const add = await addMarketCurrency(MARKET, spare)
      expect(add.reason ?? '').toBe('')
      expect(add.ok).toBe(true)

      await refresh()
      expect(currenciesOf(MARKET, accepted)).toEqual(['INR', spare])
      expect(markets.find(m => m.code === MARKET)?.currency,
        'adding a currency changed what shoppers are quoted').toBe('INR')

      /* --- the default moves, and takes `markets.currency` with it ------- */
      expect(canMakeDefault(MARKET, spare, accepted).ok).toBe(true)
      const def = await setDefaultCurrency(MARKET, spare)
      expect(def.reason ?? '').toBe('')

      await refresh()
      expect(currenciesOf(MARKET, accepted)[0]).toBe(spare)
      expect(markets.find(m => m.code === MARKET)?.currency,
        'the trigger did not move markets.currency to the new default').toBe(spare)

      /* Exactly one default, still — the guard clears the old one rather
         than leaving two and letting the query order decide. */
      const defaults = accepted.filter(a => a.market_code === MARKET && a.is_default)
      expect(defaults).toHaveLength(1)

      /* --- and the old default cannot be removed while it is not ------- */
      const counts = await currencyFootprint(MARKET, spare)
      expect(canRemove(MARKET, spare, accepted, counts).ok,
        'the current default was removable').toBe(false)
    } finally {
      /* Put INR back in charge and take the spare off, in that order — the
         reverse would try to remove the default and be refused. */
      await setDefaultCurrency(MARKET, 'INR')
      await removeMarketCurrency(MARKET, spare)
      await refresh()
    }

    expect(currenciesOf(MARKET, accepted), 'the market was not put back').toEqual(['INR'])
    expect(markets.find(m => m.code === MARKET)?.currency).toBe('INR')
  })

  it('is refused the last currency a market has, by the database and not only by the form', async () => {
    const single = markets.find(m => currenciesOf(m.code, accepted).length === 1)
    expect(single, 'no single-currency market to try this on').toBeTruthy()
    const only = currenciesOf(single!.code, accepted)[0]

    /* The form's answer... */
    const counts = await currencyFootprint(single!.code, only)
    expect(canRemove(single!.code, only, accepted, counts).reason).toMatch(/at least one currency/i)

    /* ...and the database's, which is the one that counts. */
    const res = await removeMarketCurrency(single!.code, only)
    expect(res.ok, `${single!.code} was left with nothing to trade in`).toBe(false)
    expect(res.reason).toMatch(/at least one currency/i)

    await refresh()
    expect(currenciesOf(single!.code, accepted)).toEqual([only])
  })

  /* Built rather than found. This used to hunt the seed for a market/currency
     pair with money in it, which made it hostage to seeding decisions made
     elsewhere — and when a later migration brought a customer's UAE bills home
     to India there was no such pair left, so the test found nothing to check
     and said so. Raising the invoice here means the refusal is always about
     the money, and it exercises `enterprise_invoices`, which the guard did not
     look at until this was written. */
  it('is refused a currency that would orphan money already billed in it', async () => {
    /* The market has to be one an actual account contracts in. This test used
       to take the first multi-currency market and the first account it found,
       and `20260802470000` started refusing the fixture — `guard_invoice_market`
       will not raise an Emirati invoice against an Indian account, which is the
       defect it exists to stop and which this test was unwittingly reproducing. */
    const { data: acct } = await supabase.from('enterprise_accounts').select('id, market')
    const accounts = (acct ?? []) as { id: string; market: string }[]
    const usable = accounts.find(a => currenciesOf(a.market, accepted).length > 1)
    expect(usable, 'no account contracts in a market with a second currency').toBeTruthy()

    const market = markets.find(m => m.code === usable!.market)
    const second = currenciesOf(market!.code, accepted)[1]
    const account = usable!.id

    /* Nothing is billed in it yet, so it comes off cleanly. */
    const clean = await currencyFootprint(market!.code, second)
    expect(clean.bills, `${second} already carries bills in ${market!.code}`).toBe(0)
    expect(canRemove(market!.code, second, accepted, clean).ok).toBe(true)

    const id = `INV-TEST-${Date.now()}`
    try {
      const { error } = await supabase.from('enterprise_invoices').insert({
        id, account_id: account, period: 'Integration test', kind: 'oneoff', issued: '01 Aug 2026',
        due: '31 Aug 2026', recurring: 100, oneoff: 0,
        tax: Math.round(100 * Number(market!.tax_rate)) / 100,
        total: 100 + Math.round(100 * Number(market!.tax_rate)) / 100,
        status: 'open', market: market!.code, currency: second,
        tax_rate: market!.tax_rate, fx_rate: 1, fx_as_of: '2026-08-01',
      })
      expect(error?.message ?? '', 'the fixture invoice was refused').toBe('')

      /* The form's answer... */
      const counts = await currencyFootprint(market!.code, second)
      expect(counts.bills, 'the footprint did not see the invoice just raised').toBeGreaterThan(0)
      expect(canRemove(market!.code, second, accepted, counts).reason).toMatch(/already been raised/i)

      /* ...and the database's, which is the one that counts. Before this the
         guard read `consumer_bills` only and would have allowed it. */
      const res = await removeMarketCurrency(market!.code, second)
      expect(res.ok, `${second} was removed from ${market!.code} with an invoice open in it`).toBe(false)
      expect(res.reason).toMatch(/orphan|bills or invoices/i)
    } finally {
      await supabase.from('enterprise_invoices').delete().eq('id', id)
    }

    /* And the market is exactly as it was. */
    await refresh()
    expect(currenciesOf(market!.code, accepted)).toContain(second)
  })
})

/* --------------------------------------------------- and nobody else --- */

describe('as a seller', () => {
  beforeAll(async () => { await signOut(); await signIn(PARTNER.email, PARTNER.password) })
  afterAll(async () => { await signOut(); await signIn(OPERATOR.email, OPERATOR.password) })

  it('can read what the markets take — the storefront needs it', async () => {
    const b = await loadMoneyBook()
    expect(b.accepted.length).toBeGreaterThan(0)
  })

  it('cannot open a market to a currency', async () => {
    const target = markets.find(m => addableTo(m.code, accepted, currencies).length > 0)!
    const spare = addableTo(target.code, accepted, currencies)[0]

    const res = await addMarketCurrency(target.code, spare)
    expect(res.ok, 'a seller configured a market').toBe(false)

    /* And nothing moved. RLS refuses by matching no rows, so the absence of an
       error is not evidence. */
    const after = await loadMoneyBook()
    expect(currenciesOf(target.code, after.accepted)).not.toContain(spare)
  })

  it('cannot change what shoppers in a market are quoted in', async () => {
    const two = markets.find(m => currenciesOf(m.code, accepted).length > 1)
    expect(two, 'no multi-currency market to try this on').toBeTruthy()
    const second = currenciesOf(two!.code, accepted)[1]

    const res = await setDefaultCurrency(two!.code, second)
    expect(res.ok, 'a seller changed a market\'s default currency').toBe(false)

    const after = await loadMoneyBook()
    expect(currenciesOf(two!.code, after.accepted)[0]).toBe(two!.currency)
  })
})
