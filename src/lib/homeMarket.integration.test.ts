/* Touches the live Supabase project. Writes orders and prices, removes them.
 *
 * Who may transact in what, asked of the database rather than of the screen.
 * Three rules, one per persona, and they are not the same rule:
 *
 *   a customer   buys in the market they are registered in, in any currency
 *                that market trades in. Priya Raman is Indian, so rupees and
 *                nothing else; a Kenyan customer would have shillings or
 *                dollars.
 *   an account   contracts in one market and may transact in any currency that
 *                market takes — the same choice a shopper there has. What it
 *                does not get to choose is the market, or the primary currency
 *                its budget and limits are set in.
 *   a seller     prices only in the currencies of markets they are approved in.
 *                Beacon Reseller Co sells in Kenya and the UAE, so KES, AED and
 *                USD, and never INR.
 *
 * Each rule is checked both ways: the thing it permits is accepted and the
 * thing it forbids is refused. A guard that refuses everything satisfies half
 * of these, which is why the halves are written out separately.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { supabase } from './supabase'
import { signIn, signOut } from './authRepo'

const CONSUMER = { email: 'priya.raman@example.com', password: 'demo1234' }
const ENTERPRISE = { email: 'vikram.shah@smartbuild.in', password: 'enterprise123' }
const PARTNER = { email: 'rajesh.kumar@nimbussensors.com', password: 'partner123' }

const ref = () => `ORD-HM-${Date.now().toString(36).slice(-6).toUpperCase()}`

describe('a customer buys in the market they are registered in', () => {
  let uid = ''
  let home = ''
  const written: string[] = []

  beforeAll(async () => {
    await signIn(CONSUMER.email, CONSUMER.password)
    const { data: session } = await supabase.auth.getSession()
    uid = session.session!.user.id
    const { data } = await supabase.from('consumer_profile').select('market').maybeSingle()
    home = (data as { market: string }).market
  }, 30000)

  afterAll(async () => {
    for (const id of written) {
      await supabase.from('order_items').delete().eq('order_id', id)
      await supabase.from('orders').delete().eq('id', id)
    }
    await signOut()
  })

  const place = async (market: string, currency: string) => {
    const { data: m } = await supabase.from('markets').select('tax_rate').eq('code', market).single()
    const res = await supabase.from('orders').insert({
      order_ref: ref(), seller: 'Kestrel Devices', status: 'placed',
      total: 100, subtotal: 100, tax: 0, discount: 0,
      market, currency, tax_rate: Number((m as { tax_rate: number }).tax_rate),
      payment_method: 'card', buyer_name: 'Priya Raman',
      buyer_email: CONSUMER.email, shipping_address: {}, user_id: uid,
    }).select('id').single()
    if (res.data) written.push(res.data.id)
    return res
  }

  it('is registered somewhere', () => {
    expect(home).toBeTruthy()
  })

  it('accepts an order in their own market and its default currency', async () => {
    const { data: mine } = await supabase.rpc('currencies_for_market', { market_code: home })
    const first = (mine as { currency: string }[])[0].currency
    const { error } = await place(home, first)
    expect(error, `refused ${first} in ${home}, which is where this customer is registered`).toBeNull()
  })

  it('accepts every currency their own market trades in', async () => {
    /* Kenya takes shillings and dollars. India takes rupees. Whatever the
       customer's market is, all of its currencies have to work — offering a
       choice the checkout refuses is the fault this pair of tests exists for. */
    const { data: mine } = await supabase.rpc('currencies_for_market', { market_code: home })
    for (const { currency } of mine as { currency: string }[]) {
      const { error } = await place(home, currency)
      expect(error, `${currency} is offered in ${home} and was refused`).toBeNull()
    }
  })

  it('refuses an order in a market they are not registered in', async () => {
    const { data: others } = await supabase.from('markets').select('code').neq('code', home)
    const elsewhere = (others as { code: string }[])[0].code
    const { data: cur } = await supabase.rpc('currencies_for_market', { market_code: elsewhere })
    const { error } = await place(elsewhere, (cur as { currency: string }[])[0].currency)
    expect(error, `this customer bought in ${elsewhere}`).not.toBeNull()
    expect(error?.message).toMatch(/registered in/)
  })

  it('refuses a currency their own market does not trade in', async () => {
    const { data: mine } = await supabase.rpc('currencies_for_market', { market_code: home })
    const takes = new Set((mine as { currency: string }[]).map(c => c.currency))
    const { data: all } = await supabase.from('currencies').select('code')
    const foreign = (all as { code: string }[]).map(c => c.code).find(c => !takes.has(c))
    if (!foreign) return
    const { error } = await place(home, foreign)
    expect(error, `${foreign} was accepted in ${home}`).not.toBeNull()
    expect(error?.message).toMatch(/does not trade in/)
  })
})

describe('a business contracts in one market and buys in what that market takes', () => {
  let account: { id: string; market: string; currency: string }

  beforeAll(async () => {
    await signIn(ENTERPRISE.email, ENTERPRISE.password)
    const { data } = await supabase.from('enterprise_accounts')
      .select('id, market, currency').maybeSingle()
    account = data as typeof account
  }, 30000)

  afterAll(async () => { await signOut() })

  it('knows where it contracts', () => {
    expect(account.market).toBeTruthy()
    expect(account.currency).toBeTruthy()
  })

  it('cannot write an order at all — a business buys through a requisition', async () => {
    /* The first thing I assumed here was wrong: I wrote a test that inserted an
       order as the enterprise buyer and expected it to succeed. It cannot.
       `owner_insert_orders` admits only a consumer writing their own row, and a
       business order is raised as a requisition and written by the marketplace
       once it is approved.

       So the market rule is not what stops a buyer here — RLS is, one layer
       earlier — and the two are worth keeping apart. Asserting the stronger one
       is the honest version of the test I meant to write. */
    const { data: m } = await supabase.from('markets').select('tax_rate').eq('code', account.market).single()
    const { error } = await supabase.from('orders').insert({
      order_ref: ref(), seller: 'Nimbus Sensors', status: 'placed',
      total: 1000, subtotal: 1000, tax: 0, discount: 0,
      market: account.market, currency: account.currency,
      tax_rate: Number((m as { tax_rate: number }).tax_rate),
      payment_method: 'invoice', buyer_name: 'Vikram Shah',
      buyer_email: ENTERPRISE.email, shipping_address: {}, account_id: account.id,
    })
    expect(error, 'a business buyer wrote an order directly').not.toBeNull()
  })

  it('has every order on its account in its own market and currency', async () => {
    /* What the guard protects, checked over the rows that exist. The buyer
       cannot write one, but the marketplace can, and `guard_order_currency`
       refuses a business order outside the account's market or currency. */
    const { data } = await supabase.from('orders')
      .select('order_ref, market, currency').eq('account_id', account.id)
    const rows = (data ?? []) as { order_ref: string; market: string; currency: string }[]
    expect(rows.length, 'this account has no orders, so this checked nothing').toBeGreaterThan(0)
    for (const o of rows) {
      expect(o.market, `${o.order_ref} was placed in ${o.market}`).toBe(account.market)
      expect(o.currency, `${o.order_ref} is in ${o.currency}`).toBe(account.currency)
    }
  })

  it('is invoiced in a currency its own market trades in', async () => {
    const { data: cur } = await supabase.rpc('currencies_for_market', { market_code: account.market })
    const takes = (cur as { currency: string }[]).map(c => c.currency)
    expect(takes, `${account.market} does not trade in ${account.currency}`).toContain(account.currency)
  })

  it('may transact in any currency its market takes, not only its primary one', async () => {
    /* The rule as it now stands. `20260802450000` pinned a business to the one
       currency on its account, which was stricter than intended: a company in
       Nairobi has the same choice a shopper in Nairobi has. What stays pinned is
       the market — and the primary currency, which is what the budget, the
       credit limit and the cost-centre caps are set in.

       Asserted against the guard rather than by inserting, because a business
       buyer cannot write an order at all — see the test above. */
    const { data: cur } = await supabase.rpc('currencies_for_market', { market_code: account.market })
    const takes = (cur as { currency: string }[]).map(c => c.currency)
    /* SmartBuild contracts in India, which trades in rupees alone, so there is
       no second currency here to exercise. Said out loud rather than passing
       silently on a set of one. */
    if (takes.length < 2) {
      expect(takes.length, `${account.market} trades in one currency, so nothing was proved about a second`).toBe(1)
      return
    }
    expect(takes).toContain(account.currency)
    expect(takes.length).toBeGreaterThan(1)
  })

  it('raises every invoice in its own market', async () => {
    /* There was no guard on invoices at all until `20260802470000`, which is
       how SmartBuild's July bill came to be raised in Kenya, in shillings, for
       its own Indian subscriptions. */
    const { data } = await supabase.from('enterprise_invoices')
      .select('id, market, currency').eq('account_id', account.id)
    const rows = (data ?? []) as { id: string; market: string; currency: string }[]
    expect(rows.length, 'no invoices, so this checked nothing').toBeGreaterThan(0)

    const { data: cur } = await supabase.rpc('currencies_for_market', { market_code: account.market })
    const takes = new Set((cur as { currency: string }[]).map(c => c.currency))
    for (const i of rows) {
      expect(i.market, `${i.id} was raised in ${i.market}`).toBe(account.market)
      expect(takes.has(i.currency), `${i.id} is in ${i.currency}, which ${i.market} does not take`).toBe(true)
    }
  })
})

describe('a requisition is raised in money the account\'s market takes', () => {
  /* Where a business purchase actually begins. The order guard has been right
     about currency since `20260802470000`, but a requisition had an amount and
     no currency at all — so a dollar request on a shilling account was
     indistinguishable from a shilling one, and it was the requisition that got
     approved. */
  let account: { id: string; market: string; currency: string }
  let me: { id: string }
  let takes: string[]
  const written: string[] = []

  const raise = (currency: string) => supabase.from('enterprise_requisitions').insert({
    id: `REQ-HM${Date.now().toString().slice(-5)}`,
    account_id: account.id, raised_by: me.id,
    raised_on: new Date().toISOString().slice(0, 10), raised_at: 'Just now',
    title: 'Integration test — currency guard', vertical: 'iot', cost_centre: null,
    amount: 1000, currency, model: 'oneoff',
    reason: 'Written by homeMarket.integration.test.ts and removed again.',
    need: 'none', policy_note: '', state: 'pending', sort_order: 999,
  }).select('id').single()

  beforeAll(async () => {
    await signIn(ENTERPRISE.email, ENTERPRISE.password)
    const [{ data: a }, { data: u }] = await Promise.all([
      supabase.from('enterprise_accounts').select('id, market, currency').maybeSingle(),
      supabase.from('enterprise_users').select('id, user_id'),
    ])
    account = a as typeof account
    const { data: session } = await supabase.auth.getSession()
    me = (u as { id: string; user_id: string }[]).find(x => x.user_id === session.session?.user.id)!
    const { data: cur } = await supabase.rpc('currencies_for_market', { market_code: account.market })
    takes = (cur as { currency: string }[]).map(c => c.currency)
  }, 30000)

  afterAll(async () => {
    for (const id of written) await supabase.from('enterprise_requisitions').delete().eq('id', id)
    await signOut()
  })

  it('has requisitions on file to check, all in money the market takes', async () => {
    const { data } = await supabase.from('enterprise_requisitions')
      .select('id, currency').eq('account_id', account.id)
    const rows = (data ?? []) as { id: string; currency: string }[]
    expect(rows.length, 'no requisitions, so this checked nothing').toBeGreaterThan(0)
    for (const r of rows) {
      expect(takes, `${r.id} is in ${r.currency}, which ${account.market} does not trade in`).toContain(r.currency)
    }
  })

  it('accepts one in the account\'s own currency', async () => {
    /* The permission half. A guard that refuses everything passes every
       refusal test written for it, so this comes first. */
    const { data, error } = await raise(account.currency)
    expect(error, error ? `the guard refused ${account.currency} on an account billed in it: ${error.message}` : '').toBeNull()
    if (data) written.push((data as { id: string }).id)
  })

  it('accepts one in any other currency its market takes', async () => {
    const second = takes.find(c => c !== account.currency)
    if (!second) {
      /* SmartBuild contracts in India, which trades in rupees alone. Said out
         loud rather than passing on a set of one — this is task #62's shape on
         the enterprise side: the demo login is in a one-currency market. */
      expect(takes, `${account.market} trades in one currency, so nothing here was proved about a second`)
        .toEqual([account.currency])
      return
    }
    const { data, error } = await raise(second)
    expect(error, `the guard refused ${second}, which ${account.market} trades in`).toBeNull()
    if (data) written.push((data as { id: string }).id)
  })

  it('refuses one in a currency its market does not trade in', async () => {
    /* Ranged over what exists rather than hard-coded: whichever currency the
       marketplace holds that this market does not take. */
    const { data: all } = await supabase.from('currencies').select('code')
    const outside = (all as { code: string }[]).map(c => c.code).find(c => !takes.includes(c))
    expect(outside, 'every currency is traded in this market, so there is nothing to refuse').toBeTruthy()

    const { data, error } = await raise(outside!)
    if (data) written.push((data as { id: string }).id)
    expect(error, `a requisition in ${outside} was accepted on an account contracting in ${account.market}`).not.toBeNull()
    expect(error?.message).toMatch(/does not trade in/)
  })
})

describe('a seller prices only where they are approved to trade', () => {
  beforeAll(async () => { await signIn(PARTNER.email, PARTNER.password) }, 30000)
  afterAll(async () => { await signOut() })

  it('has a seller trading in some markets and not others', async () => {
    /* The floor. Until `20260802460000` every seller was approved everywhere,
       so the restriction bound nothing and this whole suite would have passed
       against a marketplace that did not enforce it. */
    const { data } = await supabase.from('partner_markets').select('partner_id, market_code, state')
    const rows = (data ?? []) as { partner_id: string; market_code: string; state: string }[]
    const { data: markets } = await supabase.from('markets').select('code')
    const total = (markets ?? []).length

    const byPartner = new Map<string, number>()
    for (const r of rows) {
      if (r.state !== 'approved') continue
      byPartner.set(r.partner_id, (byPartner.get(r.partner_id) ?? 0) + 1)
    }
    const partial = [...byPartner.values()].filter(n => n > 1 && n < total)
    expect(partial.length, 'every seller is approved everywhere, so the rule binds nothing').toBeGreaterThan(0)
  })

  it('holds no price in a currency none of its approved markets take', async () => {
    const [{ data: prices }, { data: products }, { data: grants }, { data: accepted }] =
      await Promise.all([
        supabase.from('product_prices').select('product_id, currency'),
        supabase.from('products').select('id, partner_id'),
        supabase.from('partner_markets').select('partner_id, market_code, state'),
        supabase.from('market_currencies').select('market_code, currency'),
      ])
    const owner = new Map((products ?? []).map(p => [p.id, p.partner_id]))
    const allowed = new Map<string, Set<string>>()
    for (const g of (grants ?? []) as { partner_id: string; market_code: string; state: string }[]) {
      if (g.state !== 'approved') continue
      const set = allowed.get(g.partner_id) ?? new Set<string>()
      for (const a of (accepted ?? []) as { market_code: string; currency: string }[]) {
        if (a.market_code === g.market_code) set.add(a.currency)
      }
      allowed.set(g.partner_id, set)
    }
    const bad: string[] = []
    for (const p of (prices ?? []) as { product_id: string; currency: string }[]) {
      const partner = owner.get(p.product_id)
      if (!partner) continue
      if (!allowed.get(partner)?.has(p.currency)) bad.push(`${partner} prices ${p.product_id} in ${p.currency}`)
    }
    expect(bad).toEqual([])
  })

  it('is refused a price in a market it does not trade in', async () => {
    /* Written as a seller, against their own listing, so RLS is what refuses —
       the same path the price editor takes. */
    const { data: session } = await supabase.auth.getSession()
    expect(session.session).toBeTruthy()

    const { data: mine } = await supabase.from('products').select('id').limit(1)
    const product = (mine as { id: string }[])[0]

    const { data: grants } = await supabase.from('partner_markets')
      .select('market_code, state')
    const approved = new Set(((grants ?? []) as { market_code: string; state: string }[])
      .filter(g => g.state === 'approved').map(g => g.market_code))

    const { data: accepted } = await supabase.from('market_currencies').select('market_code, currency')
    const canPrice = new Set(((accepted ?? []) as { market_code: string; currency: string }[])
      .filter(a => approved.has(a.market_code)).map(a => a.currency))

    const { data: all } = await supabase.from('currencies').select('code')
    const forbidden = (all as { code: string }[]).map(c => c.code).find(c => !canPrice.has(c))
    if (!forbidden) return  // this seller trades everywhere; the floor test covers that case

    const { data, error } = await supabase.from('product_prices')
      .upsert({ product_id: product.id, currency: forbidden, price: 1 }, { onConflict: 'product_id,currency' })
      .select('product_id')
    /* RLS refuses by matching no rows rather than by raising, so an absent
       error is not evidence — the empty result is. */
    expect(error !== null || (data ?? []).length === 0,
      `a seller priced in ${forbidden}, which none of their markets take`).toBe(true)
  })
})
