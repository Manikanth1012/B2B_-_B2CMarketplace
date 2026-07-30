/* Touches the live Supabase project. Reads only — creates and changes nothing.
   Signs in as the consumer persona, because `subscriptions` is owner-scoped and
   there is nothing to see without a session. */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { supabase } from './supabase'
import { signIn, signOut } from './authRepo'
import type { Subscription } from '../types'
import { monthlyTotal, statusLine, isActive } from './subscriptions'

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

  it('has four billing, one paused and one cancelled', async () => {
    const subs = await load()
    expect(subs.filter(isActive)).toHaveLength(4)
    expect(subs.filter(s => s.status === 'paused')).toHaveLength(1)
    expect(subs.filter(s => s.status === 'cancelled')).toHaveLength(1)
    expect(monthlyTotal(subs)).toBeCloseTo(52.88, 2)
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
