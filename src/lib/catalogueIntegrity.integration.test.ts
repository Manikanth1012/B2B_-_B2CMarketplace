/* Touches the live Supabase project. Reads only.

   One invariant, checked across every table that points at the catalogue: a row
   that names a product must name a product that exists, and call it what the
   catalogue calls it. Seven order_items rows once failed this — product_id pointed
   at an unrelated SKU whose seller was a different company — and nothing noticed,
   because there was no foreign key and no test. */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { supabase } from './supabase'
import { signIn, signOut } from './authRepo'
import { PRODUCT_IMAGES } from './images'

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
         the SKU it pointed at was sold by Kestrel Devices.

         A NULL seller is not a failure — `20260802380000` gave the column that
         meaning for an order that genuinely spans sellers, which a business
         requisition can (ninety sensors and four gateways, one approval). What
         is a failure is a name that is only half true, and a joined list, which
         is what the checkout wrote the first time somebody filled a mixed
         basket. */
      if (row.order?.seller) {
        expect(row.order.seller, `${row.order.order_ref} names several sellers in one field`).not.toContain(', ')
        expect(row.order.seller, `${row.order.order_ref} seller disagrees`).toBe(p!.seller)
      }
    }
  })

  it('refunds the consumer for items their orders actually contain', async () => {
    const [{ data: refunds }, { data: items }] = await Promise.all([
      supabase.from('refunds').select('order_ref, item'),
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

  /* The review record and the product are two halves of one listing, and this
     is the seam. It used to be looser than that: `product_id` was nullable and a
     submission carried a name and a price of its own, so a queue row could name
     a product that did not exist and quote a price the catalogue contradicted.
     Now every submission points at its product from the moment it is created,
     and `products.status` is the lifecycle both sides read. */
  it('links every submission to a real product whose status agrees with it', async () => {
    await signOut()
    await signIn('anika.sharma@aventa.com', 'operator123')
    const { data, error } = await supabase
      .from('operator_listings')
      .select('id, status, product_id, partner_id, product:products(id, status, partner_id)')
      .returns<{ id: string; status: string; product_id: string; partner_id: string | null;
                 product: { id: string; status: string; partner_id: string | null } | null }[]>()
    expect(error).toBeNull()
    expect(data!.length).toBeGreaterThan(0)

    for (const l of data!) {
      expect(l.product, `${l.id} links to a product that does not exist`).toBeTruthy()
      expect(l.partner_id, `${l.id} and its product disagree about the seller`).toBe(l.product!.partner_id)

      /* Pending means waiting; approved means on sale or since taken down;
         rejected means it never went on sale.

         `paused` belongs in the approved set and was missing from it. A seller
         pausing their own listing is an ordinary thing to do — it is how you
         stop selling something while you restock — and it does not un-approve
         the decision the marketplace already made. The set held only the two
         states the seed happened to contain.

         `retired` belongs there for the same reason and was missing for the
         same reason: until the marketplace closed new lines to new business,
         nothing had ever been withdrawn. Withdrawing a listing does not undo
         the approval that put it on sale — the approval is why the customers
         still on it have a contract at all. */
      const p = l.product!.status
      if (l.status === 'pending') expect(p, `${l.id} is pending but its product is ${p}`).toBe('pending')
      if (l.status === 'approved') expect(['live', 'suspended', 'paused', 'retired'], `${l.id} is approved but its product is ${p}`).toContain(p)
      if (l.status === 'rejected') expect(['rejected', 'suspended'], `${l.id} is rejected but its product is ${p}`).toContain(p)
    }

    /* And nothing a buyer can reach, or is waiting on, arrived without a
       decision behind it. */
    const reviewed = new Set(data!.map(l => l.product_id))
    const { data: shelf } = await supabase.from('products').select('id,name,status').in('status', ['live', 'pending'])
    for (const p of (shelf ?? []) as { id: string; name: string }[]) {
      expect(reviewed.has(p.id), `${p.name} is on the shelf with no review record`).toBe(true)
    }
  })

  it('gives every product on the shelf its own photo, not the generic one', async () => {
    /* Ranged over `products` rather than a list written here, because the miss
       was exactly a product nobody remembered to add: `PRODUCT_IMAGES` predates
       the federated packs, so all five resolved through `getProductImage`'s
       fallback and five different things wore one stock handset — three of them
       on the retail storefront.

       Checked as a key rather than by comparing URLs: the fallback is
       SKU-4003's photo, so a URL comparison would call a real entry a miss. */
    await signIn('anika.sharma@aventa.com', 'operator123')
    const { data } = await supabase.from('products').select('id, name').eq('status', 'live')
    const shelf = (data ?? []) as { id: string; name: string }[]
    expect(shelf.length, 'nothing is live, so this checked nothing').toBeGreaterThan(20)

    for (const p of shelf) {
      expect(Object.prototype.hasOwnProperty.call(PRODUCT_IMAGES, p.id),
        `${p.name} (${p.id}) has no photo of its own and shows the generic one`).toBe(true)
    }
  })

  it('shows the buyer the same photo the operator sees', async () => {
    /* Two sources exist — this map, which every buyer-facing screen reads, and
       `product_media`, which the operator's catalogue reads and a seller can
       write to. They are allowed to differ today on older SKUs; what they must
       not do is differ on a product whose photo was chosen deliberately, which
       is what the federated packs' alt text records.

       This is the reconciliation for those five. If the two sources are ever
       merged, widen it to the whole shelf. */
    const { data } = await supabase.from('product_media')
      .select('product_id, url').eq('role', 'hero').like('product_id', 'SKU-FP%')
    const heroes = (data ?? []) as { product_id: string; url: string }[]
    expect(heroes.length, 'no federated pack has a hero, so this checked nothing').toBe(7)

    for (const h of heroes) {
      expect(PRODUCT_IMAGES[h.product_id],
        `${h.product_id}: the storefront and the operator show different photos`).toBe(h.url)
    }
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
