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
import type { Currency, Market } from './money'

const OPERATOR = { email: 'anika.sharma@aventa.com', password: 'operator123' }
const PARTNER = { email: 'rajesh.kumar@nimbussensors.com', password: 'partner123' }
const DEMO_PARTNER = 'PTR-1004'

let markets: Market[] = []
let currencies: Currency[] = []
let grants: PartnerMarket[] = []
/** A listing belonging to the demo seller, and one belonging to somebody else. */
let mine: { id: string; name: string; price: number } | null = null
let theirs: { id: string; partner_id: string } | null = null
let restore: BookRow[] = []

beforeAll(async () => {
  await signIn(OPERATOR.email, OPERATOR.password)
  const [m, c, g, p] = await Promise.all([
    supabase.from('markets').select('*').order('sort_order'),
    supabase.from('currencies').select('*').order('sort_order'),
    loadPartnerMarkets(),
    supabase.from('products').select('id,name,price,partner_id').not('partner_id', 'is', null),
  ])
  markets = ((m.data ?? []) as Market[]).map(x => ({ ...x, tax_rate: Number(x.tax_rate) }))
  currencies = (c.data ?? []) as Currency[]
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

  it('may price in every market the marketplace has opened', () => {
    expect(priceableCurrencies(who, markets, grants).sort())
      .toEqual([...new Set(markets.map(m => m.currency))].sort())
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
      const verdict = sellableIn({ id: mine!.id, partner_id: DEMO_PARTNER }, m, grants, rows)
      const approved = marketsFor(grants, DEMO_PARTNER, markets).some(x => x.code === m.code)
      const priced = rows.some(r => r.currency === m.currency)
      expect(verdict.ok, `${m.code}: approved=${approved} priced=${priced}`).toBe(approved && priced)
    }
  })

  it('never prices a seller into a market they cannot trade in', async () => {
    /* Two plain reads and a join in memory. PostgREST types an embedded
       relation as an array whichever way the foreign key points, and arguing
       with that in a test is not worth a cast. */
    const [{ data: priced }, { data: owners }] = await Promise.all([
      supabase.from('product_prices').select('product_id,currency'),
      supabase.from('products').select('id,partner_id'),
    ])
    const ownerOf = new Map(
      ((owners ?? []) as { id: string; partner_id: string | null }[]).map(p => [p.id, p.partner_id]))
    const reporting = currencies.find(c => c.is_reporting)?.code
    expect((priced ?? []).length, 'no prices to check').toBeGreaterThan(0)

    for (const row of (priced ?? []) as { product_id: string; currency: string }[]) {
      const owner = ownerOf.get(row.product_id)
      if (!owner || row.currency === reporting) continue
      const ok = marketsFor(grants, owner, markets).some(m => m.currency === row.currency)
      expect(ok, `${row.product_id} is priced in ${row.currency}, which ${owner} cannot trade in`).toBe(true)
    }
  })
})
