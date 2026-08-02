/* Touches the live Supabase project. Writes, and puts back what it changed.
 *
 * `marketPricing.ts` states the pricing rules in front of the form so somebody
 * is told "below your floor" while typing. The database states them again — RLS
 * for who may touch a row, `guard_price_book` for whether the number in it is
 * allowed. Two statements of one rule drift, and the drift is invisible: the
 * form goes on accepting a price the database has quietly started refusing, or
 * worse, the form starts refusing one the database would take.
 *
 * So each rule is asserted twice here — once against the pure function and once
 * by actually attempting the write as the signed-in party.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { supabase } from './supabase'
import { signIn, signOut } from './authRepo'
import {
  priceableCurrencies, priceProblems, problemOn, marketsFor, sellableIn,
} from './marketPricing'
import type { PartnerMarket, BookRow } from './marketPricing'
import { setPrice, clearPrice, loadPartnerMarkets, loadProductPrices, decideMarket } from './moneyRepo'
import { currenciesOf } from './money'
import type { Currency, Market, MarketCurrency } from './money'

const OPERATOR = { email: 'anika.sharma@aventa.com', password: 'operator123' }
const PARTNER = { email: 'rajesh.kumar@nimbussensors.com', password: 'partner123' }
const DEMO_PARTNER = 'PTR-1004'

let markets: Market[] = []
let currencies: Currency[] = []
let accepted: MarketCurrency[] = []
let grants: PartnerMarket[] = []
/** A listing belonging to the demo seller, and one belonging to somebody else. */
let mine: { id: string; name: string; price: number } | null = null
let theirs: { id: string; partner_id: string } | null = null
let restore: BookRow[] = []

beforeAll(async () => {
  await signIn(OPERATOR.email, OPERATOR.password)
  const [m, c, a, g, p] = await Promise.all([
    supabase.from('markets').select('*').order('sort_order'),
    supabase.from('currencies').select('*').order('sort_order'),
    supabase.from('market_currencies').select('*'),
    loadPartnerMarkets(),
    supabase.from('products').select('id,name,price,partner_id').not('partner_id', 'is', null),
  ])
  markets = ((m.data ?? []) as Market[]).map(x => ({ ...x, tax_rate: Number(x.tax_rate) }))
  currencies = (c.data ?? []) as Currency[]
  accepted = (a.data ?? []) as MarketCurrency[]
  grants = g

  const rows = (p.data ?? []) as { id: string; name: string; price: number; partner_id: string }[]
  mine = rows.find(r => r.partner_id === DEMO_PARTNER) ?? null
  theirs = rows.find(r => r.partner_id !== DEMO_PARTNER) ?? null
  expect(mine, 'the demo seller has no products to price').toBeTruthy()
  expect(theirs, 'no other seller to test isolation against').toBeTruthy()

  restore = await loadProductPrices(mine!.id)
  expect(markets.length).toBeGreaterThan(1)
})

afterAll(async () => {
  /* Put the price book back exactly as it was, whatever the tests did. */
  await signOut()
  await signIn(OPERATOR.email, OPERATOR.password)
  if (mine) {
    const now = await loadProductPrices(mine.id)
    for (const row of now) {
      if (!restore.some(r => r.currency === row.currency)) await clearPrice(mine.id, row.currency)
    }
    for (const row of restore) await setPrice(row)
  }
  await signOut()
})

/* ---------------------------------------------------------- the grants --- */

describe('where a seller may sell', () => {
  it('gives the demo seller more than one market, so multi-market is exercised', () => {
    expect(marketsFor(grants, DEMO_PARTNER, markets).length).toBeGreaterThan(1)
  })

  it('leaves at least one grant outstanding, so the request path means something', () => {
    expect(grants.some(g => g.state === 'requested')).toBe(true)
  })

  it('never approves a market that is not a market', () => {
    const codes = new Set(markets.map(m => m.code))
    for (const g of grants) expect(codes.has(g.market_code), `${g.market_code} is not a market`).toBe(true)
  })
})

/* -------------------------------------------- what each market will take --- */

describe('the currencies a market accepts', () => {
  it('gives every market exactly one default, and it is the one on the market row', () => {
    for (const m of markets) {
      const takes = accepted.filter(a => a.market_code === m.code)
      expect(takes.length, `${m.code} accepts no currency at all`).toBeGreaterThan(0)
      const defaults = takes.filter(a => a.is_default)
      expect(defaults.length, `${m.code} has ${defaults.length} default currencies`).toBe(1)
      expect(defaults[0].currency, `${m.code} disagrees with its own default`).toBe(m.currency)
      expect(currenciesOf(m.code, accepted)[0], 'the default is not listed first').toBe(m.currency)
    }
  })

  /* The arrangement the operator configured, asserted rather than assumed —
     "Kenya takes dollars" is a business fact and losing it silently would
     silently change what customers can be charged. */
  it('takes dollars in Kenya and the UAE, and rupees alone in India', () => {
    expect(currenciesOf('KE', accepted)).toEqual(['KES', 'USD'])
    expect(currenciesOf('AE', accepted)).toEqual(['AED', 'USD'])
    expect(currenciesOf('IN', accepted)).toEqual(['INR'])
  })

  it('exercises more than one currency in at least one market, or nothing here is tested', () => {
    expect(markets.some(m => currenciesOf(m.code, accepted).length > 1)).toBe(true)
  })

  it('accepts nothing that is not a currency', () => {
    const codes = new Set(currencies.map(c => c.code))
    for (const a of accepted) {
      expect(codes.has(a.currency), `${a.currency} is not a currency`).toBe(true)
    }
  })
})

/* ------------------------------------------------- the seller's own writes --- */

describe('as the seller', () => {
  beforeAll(async () => { await signOut(); await signIn(PARTNER.email, PARTNER.password) })
  afterAll(async () => { await signOut(); await signIn(OPERATOR.email, OPERATOR.password) })

  const who = { persona: 'partner' as const, partnerId: DEMO_PARTNER }

  it('prices its own listing in a market it is approved for', async () => {
    const allowed = priceableCurrencies(who, markets, grants)
    expect(allowed.length).toBeGreaterThan(0)

    const currency = allowed[0]
    const existing = restore.find(r => r.currency === currency)
    const price = existing ? existing.price : 999

    const res = await setPrice({
      product_id: mine!.id, currency, price,
      was_price: null, floor_price: existing?.floor_price ?? null, list_price: existing?.list_price ?? null,
    })
    expect(res.reason ?? '').toBe('')
    expect(res.ok).toBe(true)
  })

  /* The seller RLS policy now joins `market_currencies` rather than reading
     one currency off the market row. If that join were wrong the form would
     offer dollars and the write would vanish silently — RLS refuses by
     matching no rows, not by raising. */
  it('prices in a second currency its markets take, not only the default one', async () => {
    const secondaries = markets
      .flatMap(m => currenciesOf(m.code, accepted).slice(1))
      .filter(c => marketsFor(grants, DEMO_PARTNER, markets)
        .some(m => currenciesOf(m.code, accepted).includes(c)))
    expect(secondaries.length,
      'no market this seller trades in has a second currency, so this proves nothing')
      .toBeGreaterThan(0)

    const currency = secondaries[0]
    const before = restore.find(r => r.currency === currency)
    const price = before ? before.price : 99

    const res = await setPrice({
      product_id: mine!.id, currency, price,
      was_price: null, floor_price: before?.floor_price ?? null, list_price: before?.list_price ?? null,
    })
    expect(res.reason ?? '').toBe('')
    expect(res.ok, `the seller could not price in ${currency}`).toBe(true)

    /* And it is really there — an RLS refusal returns no error. */
    const after = await loadProductPrices(mine!.id)
    expect(after.find(r => r.currency === currency)?.price).toBe(price)
  })

  it('is refused a price below the floor — by the guard, not only by the form', async () => {
    const existing = restore.find(r => r.floor_price !== null)
    if (!existing) return

    const under = existing.floor_price! - 1

    /* The form's answer... */
    const problems = priceProblems(
      { currency: existing.currency, price: String(under), was_price: '', floor_price: String(existing.floor_price), list_price: '' },
      priceableCurrencies(who, markets, grants), currencies,
    )
    expect(problemOn(problems, 'price')).toMatch(/below the floor/i)

    /* ...and the database's, which is the one that counts. */
    const res = await setPrice({ ...existing, price: under })
    expect(res.ok, 'the guard let a price through below its own floor').toBe(false)
    expect(res.reason).toMatch(/floor/i)
  })

  it('is refused a price of nothing', async () => {
    const existing = restore[0]
    if (!existing) return
    const res = await setPrice({ ...existing, price: 0, floor_price: null })
    expect(res.ok).toBe(false)
  })

  it('cannot price another seller\'s listing', async () => {
    const res = await setPrice({
      product_id: theirs!.id, currency: markets[0].currency, price: 12345,
      was_price: null, floor_price: null, list_price: null,
    })
    expect(res.ok, 'a seller repriced somebody else\'s listing').toBe(false)

    /* And nothing moved. An RLS refusal is silent — the write succeeds and
       changes no rows — so the absence of an error is not evidence. */
    const after = await loadProductPrices(theirs!.id)
    expect(after.find(r => r.currency === markets[0].currency)?.price).not.toBe(12345)
  })

  /* The demo seller is approved everywhere, so asking "is there a market they
     cannot sell in" and skipping when there is not would be a test that passes
     by finding nothing to check. One is closed for the duration instead. */
  it('cannot price into a market it is not approved for', async () => {
    const target = markets.find(m => !m.is_default)!
    const before = (await loadPartnerMarkets(DEMO_PARTNER))
      .find(g => g.market_code === target.code)

    /* Close it as the operator... */
    await signOut(); await signIn(OPERATOR.email, OPERATOR.password)
    await decideMarket(DEMO_PARTNER, target.code, 'suspended', 'test', 'Closed by the pricing test')
    await signOut(); await signIn(PARTNER.email, PARTNER.password)

    try {
      const closed = await loadPartnerMarkets(DEMO_PARTNER)
      expect(closed.find(g => g.market_code === target.code)?.state,
        'the market was not actually closed, so the refusal below proves nothing').toBe('suspended')

      /* ...and the seller can no longer price into it. */
      const res = await setPrice({
        product_id: mine!.id, currency: target.currency, price: 999,
        was_price: null, floor_price: null, list_price: null,
      })
      expect(res.ok, `a seller priced into ${target.currency} while suspended there`).toBe(false)

      /* The form agrees. */
      expect(priceableCurrencies(who, markets, closed)).not.toContain(target.currency)
    } finally {
      await signOut(); await signIn(OPERATOR.email, OPERATOR.password)
      await decideMarket(
        DEMO_PARTNER, target.code, before?.state ?? 'approved', 'test',
        before?.note ?? 'Restored by the pricing test',
      )
      await signOut(); await signIn(PARTNER.email, PARTNER.password)
    }
  })

  it('cannot grant itself a market', async () => {
    /* Aimed at a market that is genuinely outstanding, so "approved" would be a
       real change rather than a no-op that proves nothing. */
    const outstanding = grants.find(g => g.state === 'requested')
    if (!outstanding) {
      throw new Error('no outstanding grant to attempt — the fixture no longer exercises this')
    }

    await supabase.from('partner_markets').upsert({
      partner_id: outstanding.partner_id,
      market_code: outstanding.market_code,
      state: 'approved',
    })

    const after = await loadPartnerMarkets(outstanding.partner_id)
    expect(
      after.find(g => g.market_code === outstanding.market_code)?.state,
      'a seller approved their own market',
    ).toBe('requested')
  })
})

/* ----------------------------------------------------- the operator's --- */

describe('as the operator', () => {
  const who = { persona: 'operator' as const }

  it('may price in every currency every market takes', () => {
    expect(priceableCurrencies(who, markets, grants, accepted).sort())
      .toEqual([...new Set(accepted.map(a => a.currency))].sort())
  })

  /* The regression this whole change is about: before `market_currencies` the
     operator's list was one currency per market, so the dollar column of a
     Kenyan price book could not be edited at all. */
  it('may price in dollars, because two markets take them', () => {
    expect(priceableCurrencies(who, markets, grants, accepted)).toContain('USD')
  })

  it('prices a seller\'s listing on their behalf', async () => {
    const existing = restore[0]
    if (!existing) return
    const res = await setPrice({ ...existing })
    expect(res.reason ?? '').toBe('')
    expect(res.ok).toBe(true)
  })
})

/* ------------------------------------------------ what the shelf shows --- */

describe('what is actually on sale where', () => {
  it('agrees with the storefront: a listing is sellable exactly where it is priced and approved', async () => {
    const rows = await loadProductPrices(mine!.id)
    for (const m of markets) {
      const verdict = sellableIn({ id: mine!.id, partner_id: DEMO_PARTNER }, m, grants, rows, accepted)
      const approved = marketsFor(grants, DEMO_PARTNER, markets).some(x => x.code === m.code)
      /* The market's *default* currency decides. A listing priced only in the
         second currency is not on the shelf — a shopper who chose nothing is
         quoted in the default and would meet a card with no price. */
      const priced = rows.some(r => r.currency === m.currency)
      expect(verdict.ok, `${m.code}: approved=${approved} priced=${priced}`).toBe(approved && priced)

      /* And where it does sell, the gaps it reports are exactly the market's
         other currencies that have no row. */
      if (verdict.ok) {
        const expected = currenciesOf(m.code, accepted).slice(1)
          .filter(c => !rows.some(r => r.currency === c))
        expect(verdict.gaps.sort(), `${m.code} gaps`).toEqual(expected.sort())
      }
    }
  })

  /* The check above compares [] to [] — every market currency is priced, which
     is the state we want the data in and the reason it proves nothing about
     gaps. So the same listing is read again with one currency taken away. No
     write: the row is dropped in memory, because the assertion is about
     `sellableIn`, not about the database. */
  it('calls a missing second currency a gap and not a refusal', async () => {
    const rows = await loadProductPrices(mine!.id)
    const twoCurrency = markets.find(m => currenciesOf(m.code, accepted).length > 1)
    expect(twoCurrency, 'no market takes two currencies, so this proves nothing').toBeTruthy()

    const second = currenciesOf(twoCurrency!.code, accepted)[1]
    expect(rows.some(r => r.currency === second),
      `the demo listing has no ${second} price, so removing it changes nothing`).toBe(true)

    const without = rows.filter(r => r.currency !== second)
    const verdict = sellableIn({ id: mine!.id, partner_id: DEMO_PARTNER }, twoCurrency!, grants, without, accepted)

    /* Still on sale — the default currency is priced — but short of one. */
    expect(verdict.ok, 'losing a second currency took the listing off the shelf entirely').toBe(true)
    expect(verdict.ok && verdict.gaps).toEqual([second])
  })

  it('never prices a seller into a currency none of their markets take', async () => {
    /* Two plain reads and a join in memory. PostgREST types an embedded
       relation as an array whichever way the foreign key points, and arguing
       with that in a test is not worth a cast. */
    const [{ data: priced }, { data: owners }] = await Promise.all([
      supabase.from('product_prices').select('product_id,currency'),
      supabase.from('products').select('id,partner_id'),
    ])
    const ownerOf = new Map(
      ((owners ?? []) as { id: string; partner_id: string | null }[]).map(p => [p.id, p.partner_id]))
    expect((priced ?? []).length, 'no prices to check').toBeGreaterThan(0)

    /* The reporting currency is no longer waved through. It used to be exempt
       because dollars were the marketplace's unit of account and no market's
       currency — now Kenya and the UAE trade in them, so a dollar price has to
       be earned by a grant like any other. */
    for (const row of (priced ?? []) as { product_id: string; currency: string }[]) {
      const owner = ownerOf.get(row.product_id)
      if (!owner) continue
      const ok = marketsFor(grants, owner, markets)
        .some(m => currenciesOf(m.code, accepted).includes(row.currency))
      expect(ok, `${row.product_id} is priced in ${row.currency}, which ${owner} cannot trade in`).toBe(true)
    }
  })

  it('prices every dollar-taking market\'s listings in dollars too, or half the shelf is blank', async () => {
    const { data } = await supabase.from('product_prices').select('currency').eq('currency', 'USD')
    expect((data ?? []).length,
      'no USD prices at all, so choosing dollars in Nairobi shows an empty storefront')
      .toBeGreaterThan(20)
  })
})
