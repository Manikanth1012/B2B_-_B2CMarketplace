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

  /* "A shelf that is theirs" is no longer enough to name a product they may
     buy: IoT is a retail shelf carrying a fifty-unit fleet bundle. The product
     has to be theirs too, which is what `audiences` says. */
  it('can still buy something that is theirs, on a shelf that is theirs', async () => {
    const cats = await loadCategories()
    const mine = categoriesFor(cats, 'consumer').map(c => c.id)
    const { data: p } = await supabase.from('products')
      .select('id').eq('status', 'live').in('category_id', mine)
      .contains('audiences', ['consumer']).limit(1).maybeSingle()
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

/* A shelf is not a product.
 *
 * The category rule was the right unit for the seller shelf and the wrong one
 * for IoT, where a $52 occupancy sensor and a fifty-unit fleet bundle share a
 * shelf. Both rules now run, so this checks the second one the same way the
 * first was checked: not by reading the screen, but by trying it on the API.
 */
describe('what a retail customer may actually buy off a shared shelf', () => {
  /* Fifty vehicle trackers for $4,800 — the listing that started this. */
  const FLEET = 'SKU-5008'
  /* One occupancy sensor, no imaging. A thing a person buys for their house. */
  const SENSOR = 'SKU-5004'
  /* Managed detection and response, priced per endpoint. */
  const MDR = 'SKU-6002'

  beforeAll(async () => { await signOut() })

  it('files the bulk and per-seat listings as business-only, and leaves the single units retail', async () => {
    const { data } = await supabase.from('products')
      .select('id,name,audiences').in('id', [FLEET, SENSOR, MDR])
    const by = Object.fromEntries((data ?? []).map(p => [p.id, p.audiences as string[]]))
    expect(by[FLEET]).toEqual(['enterprise'])
    expect(by[MDR]).toEqual(['enterprise'])
    expect(by[SENSOR]).toContain('consumer')
  })

  it('leaves the security shelf off the retail storefront entirely', async () => {
    const cats = await loadCategories()
    const security = cats.find(c => c.id === 'security')!
    expect(shoppableBy(security, 'consumer')).toBe(false)
    expect(shoppableBy(security, 'enterprise')).toBe(true)
    expect(retailCategories(cats).map(c => c.id)).not.toContain('security')
  })

  /* But IoT keeps its retail edge. If it did not, this would be a category
     rule wearing a product rule's clothes and the shelf should have moved. */
  it('keeps the IoT shelf, because things on it are still sold to retail', async () => {
    const cats = await loadCategories()
    expect(categoriesFor(cats, 'consumer').map(c => c.id)).toContain('iot')
    const { data } = await supabase.from('products')
      .select('id').eq('category_id', 'iot').eq('status', 'live').contains('audiences', ['consumer'])
    expect((data ?? []).length).toBeGreaterThan(0)
  })

  it('refuses to put a fleet bundle in a retail basket, at the database', async () => {
    await signIn(CONSUMER.email, CONSUMER.password)
    const { data: session } = await supabase.auth.getUser()
    const { error } = await supabase.from('cart_items').insert({
      product_id: FLEET, quantity: 1, user_id: session.user?.id ?? null,
    }).select('id')
    expect(error, 'a retail basket accepted fifty vehicle trackers').not.toBeNull()
    expect(error!.message).toMatch(/not sold to consumer/)
    /* And nothing landed. A refusal that inserts anyway is not a refusal. */
    const { data: left } = await supabase.from('cart_items').select('id').eq('product_id', FLEET)
    expect(left ?? []).toEqual([])
    await signOut()
  })

  it('still lets the same customer buy a single sensor', async () => {
    await signIn(CONSUMER.email, CONSUMER.password)
    const { data: session } = await supabase.auth.getUser()
    const { data, error } = await supabase.from('cart_items').insert({
      product_id: SENSOR, quantity: 1, user_id: session.user?.id ?? null,
    }).select('id')
    expect(error, error?.message).toBeNull()
    await supabase.from('cart_items').delete().in('id', (data ?? []).map(r => r.id))
    await signOut()
  })

  /* The other half of the rule cannot be shown by writing: a business account
     has neither a basket nor a direct order write — purchases arrive through
     an approved requisition. So what is checked is that the rule would not
     stand in their way, and that it has not been applied retroactively to what
     they have already bought. */
  it('does not put the business shelf out of reach of the business account', async () => {
    await signIn(ENTERPRISE.email, ENTERPRISE.password)

    const { data: bought } = await supabase
      .from('order_items').select('product_id, product:products(name, audiences)')
    /* PostgREST types an embedded row as an array; one product per line is
       what the foreign key guarantees, and flattening says so. */
    const theirs = (bought ?? []).flatMap(r =>
      [r.product].flat().filter(Boolean) as { name: string; audiences: string[] }[])
    const stranded = theirs
      .filter(p => !p.audiences.includes('enterprise'))
      .map(p => p.name)
    expect(stranded, 'a business account has bought something it may no longer buy').toEqual([])

    /* And the bundle that started this is genuinely on their shelf, not merely
       off the retail one. Narrowing that left it sold to nobody would be a
       listing withdrawn rather than a listing reclassified. */
    const { data: fleet } = await supabase.from('products')
      .select('audiences').eq('id', FLEET).maybeSingle()
    expect((fleet!.audiences as string[])).toContain('enterprise')
    await signOut()
  })

  it('leaves no shelf visible to somebody with nothing on it', async () => {
    const cats = await loadCategories()
    const { data: prods } = await supabase.from('products')
      .select('category_id,audiences,status').neq('status', 'archived')
    for (const c of cats) {
      for (const who of c.shoppable_by) {
        const any = (prods ?? []).some(p =>
          p.category_id === c.id && (p.audiences as string[]).includes(who))
        expect(any, `${c.id} is shown to ${who} with nothing on it`).toBe(true)
      }
    }
  })
})
