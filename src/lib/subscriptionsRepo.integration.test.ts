/* Touches the live Supabase project. Reads only — creates and changes nothing.
   Signs in as the consumer persona, because `subscriptions` is owner-scoped and
   there is nothing to see without a session. */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { supabase } from './supabase'
import { signIn, signOut } from './authRepo'
import type { Subscription } from '../types'
import { monthlyTotal, statusLine, billingCurrency, isActive } from './subscriptions'

const CONSUMER = { email: 'priya.raman@example.com', password: 'demo1234' }

async function load(): Promise<Subscription[]> {
  const { data, error } = await supabase.from('subscriptions').select('*').order('ref')
  expect(error).toBeNull()
  return (data ?? []) as Subscription[]
}

beforeAll(async () => { await signIn(CONSUMER.email, CONSUMER.password) })
afterAll(async () => { await signOut() })

describe('the consumer subscriptions', () => {
  it('carries the six the prototype defines', async () => {
    const subs = await load()
    expect(subs.map(s => s.ref)).toEqual([
      'SUB-9101', 'SUB-9102', 'SUB-9103', 'SUB-9104', 'SUB-9105', 'SUB-9106',
      /* SUB-9107 is not from the prototype. It was added when the product
         dependency rules were written down: the shopper owns a delivered Nimbus
         occupancy sensor, and PRL-20 says a sensor with no connectivity plan
         reports to nothing. Supplying the plan was the fix — deleting the order
         would have been a demo of a marketplace that sells things that do not
         work. */
      'SUB-9107',
    ])
  })

  it('names a real catalogue product and its seller on every row', async () => {
    const subs = await load()
    const { data: products } = await supabase
      .from('products').select('id,name,seller')
      .in('id', subs.map(s => s.product_id))

    /* The seed would still "work" pointing at SKUs that no longer exist, or naming a
       different seller from the one selling it — both would show a plausible screen
       built on nothing. */
    for (const s of subs) {
      const p = products!.find(x => x.id === s.product_id)
      expect(p, `${s.ref} points at a missing product`).toBeTruthy()
      expect(s.product_name).toBe(p!.name)
      expect(s.seller).toBe(p!.seller)
    }
  })

  it('has five billing, one paused and one cancelled', async () => {
    const subs = await load()
    expect(subs.filter(isActive)).toHaveLength(5)
    expect(subs.filter(s => s.status === 'paused')).toHaveLength(1)
    expect(subs.filter(s => s.status === 'cancelled')).toHaveLength(1)
    /* Derived rather than written down. This was `54.28` — the dollar total,
       from when `subscriptions.price` carried the catalogue's USD list price
       on an account billed in rupees. A literal here says nothing about
       whether the figure is right, only whether it has changed. */
    const expected = subs.filter(isActive).reduce((a, s) => a + s.price, 0)
    expect(monthlyTotal(subs)).toBeCloseTo(expected, 2)
  })

  /* The defect that literal was hiding. */
  it('is priced in the currency the account is billed in', async () => {
    const subs = await load()
    const currency = billingCurrency(subs)
    expect(currency, 'the subscriptions disagree about what this account pays in').toBeTruthy()

    const { data } = await supabase.from('consumer_bills').select('currency,issued')
    const bills = (data ?? []) as { currency: string; issued: string }[]
    expect(bills.length, 'no bills to check the subscriptions against').toBeGreaterThan(0)
    expect([...new Set(bills.map(b => b.currency))],
      'this account is billed in more than one currency').toHaveLength(1)
    expect(currency, 'subscriptions are priced against a bill in another currency')
      .toBe(bills[0].currency)
  })

  /* And priced from the book, not converted at render — the rule the whole
     `product_prices` table exists for. */
  it('takes each price from the price book for that currency', async () => {
    const subs = await load()
    const currency = billingCurrency(subs)!
    const { data } = await supabase.from('product_prices').select('product_id,price').eq('currency', currency)
    const book = new Map(((data ?? []) as { product_id: string; price: number }[])
      .map(r => [r.product_id, Number(r.price)]))

    for (const s of subs) {
      const listed = book.get(s.product_id)
      expect(listed, `${s.product_name} has no ${currency} price on file`).toBeDefined()
      expect(s.price, `${s.product_name} disagrees with the price book`).toBeCloseTo(listed!, 2)
    }
  })

  it('gives the dormant rows the date that explains them', async () => {
    const subs = await load()
    const paused = subs.find(s => s.status === 'paused')!
    const cancelled = subs.find(s => s.status === 'cancelled')!

    /* A paused row must not carry a next_renewal — that would claim it is about to
       charge — and a cancelled one must say how long access lasts. */
    expect(paused.resumes_at).toBeTruthy()
    expect(paused.next_renewal).toBeNull()
    expect(cancelled.ends_at).toBeTruthy()
    expect(cancelled.next_renewal).toBeNull()

    expect(statusLine(paused)).toMatch(/^Paused · resumes /)
    expect(statusLine(cancelled)).toMatch(/^Cancelled · access until /)
  })

  it('is owner-scoped — signed out, the same query returns nothing', async () => {
    await signOut()
    const { data, error } = await supabase.from('subscriptions').select('*')
    expect(error).toBeNull()
    expect(data).toEqual([])
    await signIn(CONSUMER.email, CONSUMER.password)
  })
})
