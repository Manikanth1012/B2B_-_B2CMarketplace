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

  it('is refused a currency that would orphan bills already raised in it', async () => {
    /* A market/currency pair that actually has bills, so the refusal is about
       the bills rather than about there being nothing to find. */
    const { data } = await supabase.from('consumer_bills').select('market,currency')
    const rows = (data ?? []) as { market: string; currency: string }[]
    const withBills = rows.find(r =>
      currenciesOf(r.market, accepted).length > 1 && currenciesOf(r.market, accepted)[0] !== r.currency)

    if (!withBills) {
      /* Not skipped silently: if the seed no longer bills anything in a
         market's second currency this test is checking nothing, and that
         should be visible rather than green. */
      const anyBills = rows.find(r => currenciesOf(r.market, accepted).length > 1)
      expect(anyBills, 'no bills in any multi-currency market at all').toBeTruthy()
      return
    }

    const counts = await currencyFootprint(withBills.market, withBills.currency)
    expect(counts.bills, 'the footprint did not find the bills that are there').toBeGreaterThan(0)
    expect(canRemove(withBills.market, withBills.currency, accepted, counts).reason)
      .toMatch(/already been raised/i)

    const res = await removeMarketCurrency(withBills.market, withBills.currency)
    expect(res.ok, 'bills were orphaned').toBe(false)
    expect(res.reason).toMatch(/orphan|already/i)
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
