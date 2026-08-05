/* Touches the live Supabase project. Writes an order and removes it again.
 *
 * Kenya trades in shillings and dollars; the UAE in dirhams and dollars.
 * `market_currencies` has said so since `20260802120000` and `MarketPicker`
 * renders it as a row of chips a shopper can click.
 *
 * Then checkout failed. `guard_order_currency` compared the order against the
 * customer's most recent bill, so taking the choice the picker offered was
 * refused by the database. The picker and the guard disagreed about what the
 * marketplace permits.
 *
 * Every guard test written before this one checks that a guard REFUSES
 * something. That is half a test: a guard that refuses everything passes all of
 * them. These check that it permits what it is supposed to permit, which is the
 * half that was missing and the half where the bug was.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { supabase } from './supabase'
import { signIn, signOut } from './authRepo'
import { loadMoneyBook } from './moneyRepo'
import { currenciesOf, marketTakes } from './money'
import type { MoneyBook } from './moneyRepo'

const CONSUMER = { email: 'priya.raman@example.com', password: 'demo1234' }

describe('a market that trades in more than one currency', () => {
  let money: MoneyBook
  const written: string[] = []

  beforeAll(async () => {
    await signIn(CONSUMER.email, CONSUMER.password)
    money = await loadMoneyBook()
  }, 30000)

  afterAll(async () => {
    for (const id of written) {
      await supabase.from('order_items').delete().eq('order_id', id)
      await supabase.from('orders').delete().eq('id', id)
    }
    await signOut()
  })

  it('has more than one such market to test against', () => {
    /* The floor. With one currency per market every assertion below passes
       having proved nothing about the second. */
    const multi = money.markets.filter(m => currenciesOf(m.code, money.accepted).length > 1)
    expect(multi.length, 'no market trades in two currencies').toBeGreaterThan(1)
  })

  it('prices every live product in every currency ITS OWN seller’s markets accept', async () => {
    /* Offering the choice and then falling back to the base row is the failure
       with no symptom: a plausible number in the wrong money.
     *
     * Scoped to the seller's own approved markets, which is not where this
     * started. It read "every currency any market accepts", and passed for
     * months because every seller was approved everywhere — the same assumption
     * `homeMarket.integration.test.ts` says was true "until `20260802460000`".
     *
     * The first seller approved in some markets and not others broke the tie,
     * and broke it against this test: Beacon Reseller Co is approved in Kenya
     * and the UAE and suspended in India, and the sibling rule — a seller holds
     * no price in a currency none of their approved markets take — forbids them
     * a rupee price outright. Both rules cannot hold. This one was the loose
     * statement of a per-seller rule, so it is narrowed rather than the other
     * one being weakened.
     *
     * A first-party listing has no seller and is priced everywhere. */
    const [{ data: products }, { data: prices }, { data: grants }] = await Promise.all([
      supabase.from('products').select('id, name, partner_id').eq('status', 'live'),
      supabase.from('product_prices').select('product_id, currency'),
      supabase.from('partner_markets').select('partner_id, market_code, state'),
    ])
    const priced = new Set((prices ?? []).map(p => `${p.product_id}|${p.currency}`))
    const approved = (grants ?? []) as { partner_id: string; market_code: string; state: string }[]
    const everywhere = new Set(money.accepted.map(a => a.currency))

    const owed = (partnerId: string | null): Set<string> => {
      if (!partnerId) return everywhere
      const mine = approved.filter(g => g.partner_id === partnerId && g.state === 'approved')
      return new Set(money.accepted
        .filter(a => mine.some(g => g.market_code === a.market_code))
        .map(a => a.currency))
    }

    const gaps: string[] = []
    for (const p of (products ?? []) as { id: string; name: string; partner_id: string | null }[]) {
      for (const cur of owed(p.partner_id)) {
        if (!priced.has(`${p.id}|${cur}`)) gaps.push(`${p.name} has no ${cur} price`)
      }
    }
    expect(gaps).toEqual([])
  })

  it('has a seller whose currencies are a subset, so the narrowing is exercised', async () => {
    /* Without one, the scoping above is indistinguishable from the loose rule
       it replaced and this file would pass against a marketplace that never
       enforced it. */
    const [{ data: grants }, { data: markets }] = await Promise.all([
      supabase.from('partner_markets').select('partner_id, market_code, state'),
      supabase.from('markets').select('code'),
    ])
    const approved = (grants ?? []).filter(g => g.state === 'approved')
    const byPartner = new Map<string, number>()
    for (const g of approved) byPartner.set(g.partner_id, (byPartner.get(g.partner_id) ?? 0) + 1)
    const partial = [...byPartner.values()].filter(n => n > 0 && n < (markets ?? []).length)
    expect(partial.length, 'every seller trades in every market, so the scoping proves nothing')
      .toBeGreaterThan(0)
  })

  it('accepts an order in the second currency the BUYER\'s own market takes', async () => {
    /* This test used to place the order in whichever market had two currencies,
       regardless of where the customer was registered — and it passed, because
       at the time the guard only asked "does this market take this currency?".
       `20260802450000` added the question it was missing: which market may this
       buyer buy in at all. The old assertion was encoding half a rule.

       So the order goes in the customer's own market now. Where that market
       trades in one currency there is no second one to try, and the test says
       so rather than quietly passing on the first — see task #62, the
       marketplace has no customer registered outside India. */
    const { data: profile } = await supabase.from('consumer_profile').select('market').maybeSingle()
    const home = (profile as { market: string }).market
    const mine = currenciesOf(home, money.accepted)

    if (mine.length < 2) {
      expect(mine.length, `${home} trades in one currency, so nothing here was proved about a second`).toBe(1)
      return
    }

    const { data: session } = await supabase.auth.getSession()
    const { data, error } = await supabase.from('orders').insert({
      order_ref: `ORD-TEST-${Date.now().toString(36).slice(-6).toUpperCase()}`,
      seller: 'Kestrel Devices', status: 'placed',
      total: 749, subtotal: 645.69, tax: 103.31, discount: 0,
      currency: mine[1], market: home,
      tax_rate: Number(money.markets.find(m => m.code === home)!.tax_rate),
      payment_method: 'card', buyer_name: 'Priya Raman',
      buyer_email: CONSUMER.email, shipping_address: {},
      user_id: session.session?.user.id,
    }).select('id').single()

    expect(error, `the guard refused ${mine[1]} in ${home}, which the picker offers there`).toBeNull()
    if (data) written.push(data.id)
  })

  it('refuses an order in a market the buyer is not registered in', async () => {
    /* The half that was missing. A market trading in two currencies says
       nothing about who may shop there. */
    const { data: profile } = await supabase.from('consumer_profile').select('market').maybeSingle()
    const home = (profile as { market: string }).market
    const elsewhere = money.markets.find(m => m.code !== home)!
    const cur = currenciesOf(elsewhere.code, money.accepted)[0]

    const { data: session } = await supabase.auth.getSession()
    const { data, error } = await supabase.from('orders').insert({
      order_ref: `ORD-TEST-${Date.now().toString(36).slice(-6).toUpperCase()}`,
      seller: 'Kestrel Devices', status: 'placed',
      total: 100, subtotal: 100, tax: 0, discount: 0,
      currency: cur, market: elsewhere.code, tax_rate: Number(elsewhere.tax_rate),
      payment_method: 'card', buyer_name: 'Priya Raman',
      buyer_email: CONSUMER.email, shipping_address: {},
      user_id: session.session?.user.id,
    }).select('id').single()

    if (data) written.push(data.id)
    expect(error, `a customer registered in ${home} bought in ${elsewhere.code}`).not.toBeNull()
    expect(error?.message).toMatch(/registered in/)
  })

  it('taxes at the market’s rate whatever currency was chosen', async () => {
    /* Changing currency changes what you pay in and never what rate — the thing
       the picker's own footnote promises. */
    const market = money.markets.find(m => currenciesOf(m.code, money.accepted).length > 1)!
    const { data } = await supabase.from('orders')
      .select('currency, tax_rate').eq('market', market.code)
    for (const o of (data ?? []) as { currency: string; tax_rate: number }[]) {
      expect(Number(o.tax_rate), `an order in ${o.currency} was taxed at ${o.tax_rate}%`)
        .toBe(Number(market.tax_rate))
    }
  })
})
