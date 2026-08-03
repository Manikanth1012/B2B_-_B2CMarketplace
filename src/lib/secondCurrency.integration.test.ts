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

  it('prices every live product in every currency its markets accept', async () => {
    /* Offering the choice and then falling back to the base row is the failure
       with no symptom: a plausible number in the wrong money. */
    const [{ data: products }, { data: prices }] = await Promise.all([
      supabase.from('products').select('id, name').eq('status', 'live'),
      supabase.from('product_prices').select('product_id, currency'),
    ])
    const priced = new Set((prices ?? []).map(p => `${p.product_id}|${p.currency}`))
    const gaps: string[] = []
    for (const cur of new Set(money.accepted.map(a => a.currency))) {
      for (const p of (products ?? []) as { id: string; name: string }[]) {
        if (!priced.has(`${p.id}|${cur}`)) gaps.push(`${p.name} has no ${cur} price`)
      }
    }
    expect(gaps).toEqual([])
  })

  it('accepts an order in the second currency a market takes', async () => {
    const market = money.markets.find(m => currenciesOf(m.code, money.accepted).length > 1)!
    const second = currenciesOf(market.code, money.accepted)[1]
    expect(marketTakes(market.code, second, money.accepted)).toBe(true)

    const { data: session } = await supabase.auth.getSession()
    const { data, error } = await supabase.from('orders').insert({
      order_ref: `ORD-TEST-${Date.now().toString(36).slice(-6).toUpperCase()}`,
      seller: 'Kestrel Devices', status: 'placed',
      total: 749, subtotal: 645.69, tax: 103.31, discount: 0,
      currency: second, market: market.code, tax_rate: Number(market.tax_rate),
      payment_method: 'card', buyer_name: 'Priya Raman',
      buyer_email: CONSUMER.email, shipping_address: {},
      user_id: session.session?.user.id,
    }).select('id').single()

    expect(error, `the guard refused ${second} in ${market.code}, which the picker offers`).toBeNull()
    expect(data).toBeTruthy()
    if (data) written.push(data.id)
  })

  it('still refuses a currency the market does not trade in', async () => {
    /* The other half. A rule that permits everything is not a rule. */
    const single = money.markets.find(m => currenciesOf(m.code, money.accepted).length === 1)!
    const foreign = money.currencies
      .map(c => c.code)
      .find(c => !marketTakes(single.code, c, money.accepted))!

    const { data: session } = await supabase.auth.getSession()
    const { data, error } = await supabase.from('orders').insert({
      order_ref: `ORD-TEST-${Date.now().toString(36).slice(-6).toUpperCase()}`,
      seller: 'Kestrel Devices', status: 'placed',
      total: 100, subtotal: 100, tax: 0, discount: 0,
      currency: foreign, market: single.code, tax_rate: Number(single.tax_rate),
      payment_method: 'card', buyer_name: 'Priya Raman',
      buyer_email: CONSUMER.email, shipping_address: {},
      user_id: session.session?.user.id,
    }).select('id').single()

    if (data) written.push(data.id)
    expect(error, `${foreign} was accepted in ${single.code}, which does not trade in it`).not.toBeNull()
    expect(error?.message).toMatch(new RegExp(`does not trade in ${foreign}`))
  })

  it('names what the market does take, so the message is actionable', async () => {
    const single = money.markets.find(m => currenciesOf(m.code, money.accepted).length === 1)!
    const foreign = money.currencies
      .map(c => c.code)
      .find(c => !marketTakes(single.code, c, money.accepted))!

    const { data: session } = await supabase.auth.getSession()
    const { error } = await supabase.from('orders').insert({
      order_ref: `ORD-TEST-${Date.now().toString(36).slice(-6).toUpperCase()}`,
      seller: 'Kestrel Devices', status: 'placed',
      total: 100, subtotal: 100, tax: 0, discount: 0,
      currency: foreign, market: single.code, tax_rate: Number(single.tax_rate),
      payment_method: 'card', buyer_name: 'Priya Raman',
      buyer_email: CONSUMER.email, shipping_address: {},
      user_id: session.session?.user.id,
    })
    /* "It takes INR" rather than "invalid currency" — a refusal that does not
       say what would work makes the shopper guess. */
    expect(error?.message).toMatch(new RegExp(`It takes ${currenciesOf(single.code, money.accepted)[0]}`))
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
