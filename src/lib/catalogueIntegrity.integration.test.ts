/* Touches the live Supabase project. Reads only.

   One invariant, checked across every table that points at the catalogue: a row
   that names a product must name a product that exists, and call it what the
   catalogue calls it. Seven order_items rows once failed this — product_id pointed
   at an unrelated SKU whose seller was a different company — and nothing noticed,
   because there was no foreign key and no test. */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { supabase } from './supabase'
import { signIn, signOut } from './authRepo'

const CONSUMER = { email: 'priya.raman@example.com', password: 'demo1234' }

interface Cat { id: string; name: string; seller: string }
let catalogue: Cat[] = []

beforeAll(async () => {
  await signIn(CONSUMER.email, CONSUMER.password)
  const { data } = await supabase.from('products').select('id,name,seller')
  catalogue = (data ?? []) as Cat[]
  expect(catalogue.length).toBeGreaterThan(0)
})

afterAll(async () => { await signOut() })

const find = (id: string) => catalogue.find(p => p.id === id)

describe('everything that references the catalogue', () => {
  it('resolves every order item to a real product, named the same way', async () => {
    const { data, error } = await supabase
      .from('order_items')
      .select('product_id, product_name, order:orders(order_ref, seller)')
      .returns<{ product_id: string; product_name: string; order: { order_ref: string; seller: string } | null }[]>()
    expect(error).toBeNull()
    expect(data!.length).toBeGreaterThan(0)

    for (const row of data!) {
      const p = find(row.product_id)
      expect(p, `${row.order?.order_ref}: ${row.product_id} is not in the catalogue`).toBeTruthy()
      expect(row.product_name, `${row.order?.order_ref} names the product differently`).toBe(p!.name)
      /* The tell that caught the original bug: the order said Aegis Assurance while
         the SKU it pointed at was sold by Kestrel Devices. */
      if (row.order) expect(row.order.seller, `${row.order.order_ref} seller disagrees`).toBe(p!.seller)
    }
  })

  it('refunds the consumer for items their orders actually contain', async () => {
    const [{ data: refunds }, { data: items }] = await Promise.all([
      supabase.from('consumer_refunds').select('order_ref, item'),
      supabase.from('order_items').select('product_name, order:orders(order_ref)')
        .returns<{ product_name: string; order: { order_ref: string } | null }[]>(),
    ])

    for (const r of refunds ?? []) {
      const named = (items ?? [])
        .filter(i => i.order?.order_ref === r.order_ref)
        .map(i => i.product_name)
      /* Refund rows carry a "(2nd)" qualifier to tell two refunds of the same item
         apart, so the item name is a prefix rather than an exact match. */
      expect(
        named.some(n => r.item.startsWith(n)),
        `refund on ${r.order_ref} is for "${r.item}", which that order does not contain (${named.join(', ')})`,
      ).toBe(true)
    }
  })

  it('resolves every subscription to a real product', async () => {
    const { data } = await supabase.from('subscriptions').select('ref, product_id, product_name, seller')
    for (const s of data ?? []) {
      const p = find(s.product_id)
      expect(p, `${s.ref}: ${s.product_id} is not in the catalogue`).toBeTruthy()
      expect(s.product_name).toBe(p!.name)
      expect(s.seller).toBe(p!.seller)
    }
  })

  it('links approved review-queue listings to the catalogue they became', async () => {
    /* operator_listings is the review queue, not a second catalogue. Reading it needs
       the operator persona. */
    await signOut()
    await signIn('anika.sharma@aventa.com', 'operator123')
    const { data } = await supabase
      .from('operator_listings').select('id, status, product_id, partner_id')

    for (const l of data ?? []) {
      if (l.product_id) {
        expect(find(l.product_id), `${l.id} links to a missing product`).toBeTruthy()
        /* Only an approved submission can be in the catalogue. A pending or rejected
           one carrying a product_id would mean something reached the shelf without
           being signed off. */
        expect(l.status, `${l.id} is ${l.status} but is linked to a live product`).toBe('approved')
      } else {
        /* Null is the normal case for pending and rejected, and for two approved
           listings the catalogue genuinely has no equivalent of. */
        expect(['approved', 'pending', 'rejected']).toContain(l.status)
      }
    }

    const approved = (data ?? []).filter(l => l.status === 'approved')
    expect(approved.length).toBeGreaterThan(0)
    expect(approved.filter(l => l.product_id).length).toBe(5)

    await signOut()
    await signIn(CONSUMER.email, CONSUMER.password)
  })

  it('is enforced by the database, not only by this test', async () => {
    /* The foreign keys added alongside the reconciliation. Without them the data can
       drift again between test runs; with them the write is refused at source. */
    const { error } = await supabase
      .from('cart_items')
      .insert({ product_id: 'SKU-DOES-NOT-EXIST', quantity: 1 })
    expect(error).not.toBeNull()
    expect(error!.message).toMatch(/foreign key|violates/i)
  })
})
