/* Touches the live Supabase project.
 *
 * The claim: a retail customer cannot buy from the Partner category. The screens
 * no longer offer it, but a screen is not a control — anyone can call the API.
 * `guard_shoppable()` is the control, and this is what proves it exists.
 *
 * Everything written here is undone in the same file.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { supabase } from './supabase'
import { signIn, signOut } from './authRepo'
import { loadCategories } from './storefrontRepo'
import { categoriesFor, shoppableBy, retailCategories, enterpriseCategories } from './storefront'

const CONSUMER = { email: 'priya.raman@example.com', password: 'demo1234' }
const ENTERPRISE = { email: 'vikram.shah@smartbuild.in', password: 'enterprise123' }
const OPERATOR = { email: 'anika.sharma@aventa.com', password: 'operator123' }

/* Reseller enablement: a white-label storefront, sold to somebody setting up as
   a reseller. Not a thing a retail customer buys. */
const PARTNER_SKU = 'SKU-7001'

describe('what the categories themselves say', () => {
  beforeAll(async () => { await signOut() })

  it('marks the partner category as a reseller shelf and nobody else’s', async () => {
    const cats = await loadCategories()
    const partner = cats.find(c => c.id === 'partner')!
    expect(partner.shoppable_by).toEqual(['partner'])
    expect(shoppableBy(partner, 'consumer')).toBe(false)
    expect(shoppableBy(partner, 'enterprise')).toBe(false)
  })

  it('keeps it off both shopping rails', async () => {
    const cats = await loadCategories()
    expect(retailCategories(cats).map(c => c.id)).not.toContain('partner')
    expect(enterpriseCategories(cats).map(c => c.id)).not.toContain('partner')
    expect(categoriesFor(cats, 'consumer').map(c => c.id)).not.toContain('partner')
  })

  /* And still shows it to a visitor, because the public partner page is the shop
     window for becoming a reseller. Hiding the rows would empty that page. */
  it('is still readable, because not-for-sale-to-you is not the same as hidden', async () => {
    const { data, error } = await supabase
      .from('products').select('id').eq('category_id', 'partner').eq('status', 'live')
    expect(error).toBeNull()
    expect((data ?? []).length).toBeGreaterThan(0)
  })

  it('leaves every other shelf reachable by somebody', async () => {
    const cats = await loadCategories()
    for (const c of cats) {
      expect(c.shoppable_by.length, `${c.id} is shoppable by nobody`).toBeGreaterThan(0)
    }
  })
})

describe('a retail customer, at the API rather than the screen', () => {
  const added: string[] = []

  beforeAll(async () => { await signIn(CONSUMER.email, CONSUMER.password) })
  afterAll(async () => {
    for (const id of added) await supabase.from('cart_items').delete().eq('id', id)
    await signOut()
  })

  it('cannot put a partner product in their basket', async () => {
    const { data, error } = await supabase.from('cart_items')
      .insert({ product_id: PARTNER_SKU, quantity: 1 }).select('id')
    if (data?.length) added.push(...data.map(r => r.id))

    expect(error, 'the basket accepted a reseller pack').not.toBeNull()
    expect(error!.message).toMatch(/not sold to consumer|is for partner/i)
  })

  it('cannot put one in an order either', async () => {
    const { data: order } = await supabase.from('orders')
      .insert({
        order_ref: `ORD-TEST-${Date.now()}`, status: 'placed', total: 249, subtotal: 249,
        tax: 0, discount: 0, payment_method: 'card', buyer_name: 'Test',
        buyer_email: CONSUMER.email, shipping_address: {},
      }).select('id').maybeSingle()

    if (order) {
      const { error } = await supabase.from('order_items').insert({
        order_id: order.id, product_id: PARTNER_SKU, product_name: 'White-label storefront',
        price: 249, quantity: 1, fulfil: 'instant', status: 'placed',
      }).select('id')
      expect(error, 'the order accepted a reseller pack').not.toBeNull()
      await supabase.from('orders').delete().eq('id', order.id)
    }
  })

  it('can still buy from a shelf that is theirs', async () => {
    const cats = await loadCategories()
    const mine = categoriesFor(cats, 'consumer').map(c => c.id)
    const { data: p } = await supabase.from('products')
      .select('id').eq('status', 'live').in('category_id', mine).limit(1).maybeSingle()
    expect(p, 'the retail shop has nothing in it').not.toBeNull()

    const { data, error } = await supabase.from('cart_items')
      .insert({ product_id: p!.id, quantity: 1 }).select('id')
    expect(error).toBeNull()
    if (data?.length) added.push(...data.map(r => r.id))
  })
})

describe('an enterprise buyer', () => {
  beforeAll(async () => { await signIn(ENTERPRISE.email, ENTERPRISE.password) })
  afterAll(async () => { await signOut() })

  it('cannot buy a reseller pack either — it is not their shelf, it is a reseller’s', async () => {
    const { data: order } = await supabase.from('orders').select('id').limit(1).maybeSingle()
    if (!order) return
    const { error } = await supabase.from('order_items').insert({
      order_id: order.id, product_id: PARTNER_SKU, product_name: 'White-label storefront',
      price: 249, quantity: 1, fulfil: 'instant', status: 'placed',
    }).select('id')
    expect(error).not.toBeNull()
  })
})

describe('the operator, who runs all six', () => {
  beforeAll(async () => { await signIn(OPERATOR.email, OPERATOR.password) })
  afterAll(async () => { await signOut() })

  it('sees every category, partner included', async () => {
    const { data } = await supabase.from('categories').select('id,shoppable_by')
    expect((data ?? []).map(c => c.id)).toContain('partner')
    expect((data ?? []).every(c => (c.shoppable_by as string[]).length > 0)).toBe(true)
  })
})
