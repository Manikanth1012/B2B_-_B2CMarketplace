/* Touches the live Supabase project.
 *
 * Kenya and the UAE have taken two currencies since markets were built, and
 * `market_currencies` has said so all along. What nothing exercised was a buyer
 * who actually uses both — so the rules about freezing a document's currency,
 * converting at the document's own date, and never adding one currency to
 * another had no case that could break them.
 *
 * Wanjiru Kamau is that buyer: Nairobi, a Kenyan account, orders and bills in
 * shillings and dollars both. She is on the demo sign-in card as "Nairobi,
 * Kenya · Billed in KSh and $ under VAT", so this is a path a person can walk
 * as well as one a test can.
 *
 * Nothing here writes.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { supabase } from './supabase'
import { signIn, signOut } from './authRepo'
import { byCurrency, formatGroups, money, presentIn } from './money'
import type { Rate, Currency } from './money'

const HER = { email: 'wanjiru.kamau@example.com', password: 'demo1234' }

interface Bill { id: string; currency: string; total: number; status: string; issued: string; fx_as_of: string | null }
interface Order { order_ref: string; currency: string; total: number; market: string }

describe('a buyer who uses both of their market’s currencies', () => {
  let bills: Bill[]
  let orders: Order[]
  let rates: Rate[]
  let currencies: Currency[]
  let profile: { market: string; currency: string } | null

  beforeAll(async () => {
    await signIn(HER.email, HER.password)
    const [b, o, r, c, p] = await Promise.all([
      supabase.from('consumer_bills').select('id, currency, total, status, issued, fx_as_of'),
      supabase.from('orders').select('order_ref, currency, total, market'),
      supabase.from('fx_rates').select('*'),
      supabase.from('currencies').select('*').order('sort_order'),
      supabase.from('consumer_profile').select('market, currency').maybeSingle(),
    ])
    expect(b.error, b.error?.message).toBeNull()
    bills = ((b.data ?? []) as Record<string, string>[]).map(x => ({ ...x, total: Number(x.total) })) as unknown as Bill[]
    orders = ((o.data ?? []) as Record<string, string>[]).map(x => ({ ...x, total: Number(x.total) })) as unknown as Order[]
    rates = ((r.data ?? []) as Record<string, string>[]).map(x => ({ ...x, rate: Number(x.rate) })) as unknown as Rate[]
    currencies = (c.data ?? []) as unknown as Currency[]
    profile = (p.data as { market: string; currency: string } | null)
  }, 30_000)

  afterAll(async () => { await signOut() })

  /* Without this the rest of the file passes by having nothing to test. */
  it('is a buyer in one market holding documents in two currencies', () => {
    expect(profile?.market).toBe('KE')
    const billCcy = new Set(bills.map(b => b.currency))
    const orderCcy = new Set(orders.map(o => o.currency))
    expect([...billCcy].sort(), 'her bills are in one currency').toEqual(['KES', 'USD'])
    expect(orderCcy.size, 'her orders are in one currency').toBeGreaterThan(1)
    expect(new Set(orders.map(o => o.market))).toEqual(new Set(['KE']))
  })

  it('is offered both by the market she is in', async () => {
    const { data } = await supabase.from('market_currencies').select('*').eq('market_code', 'KE')
    const offered = ((data ?? []) as { currency: string }[]).map(m => m.currency).sort()
    expect(offered).toEqual(['KES', 'USD'])
    /* Every currency she actually holds is one the market trades in — a
       document in a currency the market does not take is one nobody could
       have quoted her. */
    for (const b of bills) expect(offered, `${b.id} is in ${b.currency}`).toContain(b.currency)
    for (const o of orders) expect(offered, `${o.order_ref} is in ${o.currency}`).toContain(o.currency)
  })

  /* Six migrations exist to freeze currency and rate on exactly these rows. */
  it('freezes each document in the currency it was struck in', () => {
    for (const b of bills) {
      expect(b.currency, `${b.id} has no currency`).toBeTruthy()
      /* The date the conversion for this document is honest at. Without it a
         reader has nothing to convert against but today. */
      expect(b.fx_as_of ?? b.issued, `${b.id} has no date to convert at`).toBeTruthy()
    }
  })

  /* The defect this file was written to catch: the Outstanding card converted
     the dollar bill at TODAY's rate while the row below it converted at the
     bill's own, so one bill appeared twice on one screen at two figures. */
  it('presents a document at its own date, not at today’s', () => {
    const usd = bills.find(b => b.currency === 'USD')
    expect(usd, 'no dollar bill to check').toBeTruthy()

    const own = presentIn(money(usd!.total, 'USD'), 'KES', rates, usd!.fx_as_of ?? usd!.issued, currencies)
    const today = presentIn(money(usd!.total, 'USD'), 'KES', rates, new Date().toISOString().slice(0, 10), currencies)
    expect(own, 'no rate on file for the bill’s own date').toBeTruthy()

    /* If these two ever agree the test proves nothing, so the seed has to keep
       a rate that moved between the bill's date and now. */
    expect(today && own!.money.amount !== today.money.amount,
      'the rate has not moved since the bill, so this case is not being exercised').toBe(true)
  })

  /* `byCurrency` exists to stop shillings being added to dollars, and the card
     that used it then joined the groups with a plus. */
  it('totals each currency separately and never adds them together', () => {
    const open = bills.filter(b => b.status === 'open')
    const groups = byCurrency(open.map(b => money(b.total, b.currency)))
    expect(groups.length, 'she has no open bill in a second currency').toBeGreaterThan(1)

    /* Bare: a group total spans several documents struck on different days, so
       there is no one date it could honestly be converted at. */
    const line = formatGroups(groups, (amount, currency) => `${currency} ${amount.toFixed(2)}`)
    expect(line).not.toMatch(/\+/)
    for (const g of groups) expect(line).toContain(g.currency)

    /* And each group's total is only its own currency's documents. */
    for (const g of groups) {
      const expected = open.filter(b => b.currency === g.currency)
        .reduce((n, b) => n + b.total, 0)
      expect(Math.abs(g.total.amount - expected), g.currency).toBeLessThan(0.005)
    }
  })

  it('keeps her wallet in one currency, whatever her documents are in', async () => {
    const { data } = await supabase.from('wallets').select('currency, balance')
    const wallets = (data ?? []) as { currency: string; balance: string }[]
    expect(wallets.length, 'no wallet').toBeGreaterThan(0)
    /* A wallet holds money; money is in one currency. Two currencies in one
       balance is the sum this codebase spends six migrations refusing. */
    expect(new Set(wallets.map(w => w.currency)).size).toBe(1)
  })

  it('shows her nobody else’s documents', () => {
    /* RLS scopes both reads, so anything here belongs to her. Stated because a
       two-currency test that accidentally reads the whole table would pass on
       somebody else's dollars. */
    expect(bills.length).toBeGreaterThan(0)
    expect(bills.every(b => b.id.includes('449288'))).toBe(true)
  })
})
