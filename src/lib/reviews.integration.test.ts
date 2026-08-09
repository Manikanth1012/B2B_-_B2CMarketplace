/* Touches the live Supabase project.
 *
 * Provenance is worked out twice — once in SQL, in the
 * `product_review_provenance` view the moderation queue reads, and once in
 * TypeScript, in `provenanceOf`, which is what the shopper's badge comes from.
 * Two evaluations of one rule stay in agreement for exactly as long as nobody
 * edits one of them. This file is what notices.
 *
 * It also exercises the guard: a seller cannot review, and an `order_ref` has
 * to be an order that actually contains the product. Both are refusals, so
 * both are asserted by trying and being refused — a control nobody has tried
 * to break is a sentence, not a rule.
 *
 * Everything written here is undone in the same file.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { supabase } from './supabase'
import { signIn, signOut } from './authRepo'
import { provenanceOf, isVerified, verifiedShare, PROVENANCE_NOTE, type Review } from './reviews'

const OPERATOR = { email: 'anika.sharma@aventa.com', password: 'operator123' }

/* The view spells the same three states in prose. Kept here rather than
   exported from the module, so that a change to either wording has to be made
   deliberately in two places instead of silently agreeing with itself. */
const VIEW_WORDING: Record<string, string> = {
  'Verified purchase': 'verified',
  'Known customer, no purchase of this product on file': 'known',
  'Not linked to any account': 'anonymous',
}

interface ProvenanceRow {
  id: string
  product_id: string
  seller: string | null
  status: string
  customer_id: string | null
  account_id: string | null
  order_ref: string | null
  verified: boolean
  provenance: string
}

const written: string[] = []

describe('every review is filed against what is behind it', () => {
  let reviews: Review[]
  let rows: ProvenanceRow[]

  beforeAll(async () => {
    await signIn(OPERATOR.email, OPERATOR.password)
    const [a, b] = await Promise.all([
      supabase.from('product_reviews').select('*'),
      supabase.from('product_review_provenance').select('*'),
    ])
    expect(a.error, a.error?.message).toBeNull()
    expect(b.error, b.error?.message).toBeNull()
    reviews = (a.data ?? []) as Review[]
    rows = (b.data ?? []) as ProvenanceRow[]
    expect(reviews.length).toBeGreaterThan(0)
  }, 30_000)

  afterAll(async () => {
    for (const id of written) await supabase.from('product_reviews').delete().eq('id', id)
    await signOut()
  })

  it('shows every review in the view, and no more', () => {
    expect(rows.length).toBe(reviews.length)
    expect(new Set(rows.map(r => r.id))).toEqual(new Set(reviews.map(r => r.id)))
  })

  /* The claim the file exists for. */
  it('agrees with provenanceOf on every single review', () => {
    const disagreements = rows
      .map(row => ({ row, mine: provenanceOf(row) }))
      .filter(({ row, mine }) => VIEW_WORDING[row.provenance] !== mine)
      .map(({ row, mine }) => `${row.id}: SQL says "${row.provenance}", provenanceOf says "${mine}"`)
    expect(disagreements, disagreements.join('; ')).toEqual([])
  })

  it('agrees with isVerified on the view\'s own boolean', () => {
    const off = rows.filter(r => r.verified !== isVerified(r)).map(r => r.id)
    expect(off, `verified disagrees with order_ref on ${off.join(', ')}`).toEqual([])
  })

  it('uses wording the moderator screen can render', () => {
    for (const row of rows) {
      const p = provenanceOf(row)
      expect(PROVENANCE_NOTE[p], `no note for ${row.id}`).toBeTruthy()
    }
  })

  /* Backfilled once, in the migration. If this drops to zero somebody has
     truncated the link and the badge silently stops appearing anywhere. */
  it('has a real number of verified purchases, not zero and not all of them', () => {
    const share = verifiedShare(reviews)
    expect(share.published).toBeGreaterThan(0)
    expect(share.verified).toBeGreaterThan(0)
    expect(share.verified).toBeLessThanOrEqual(share.published)
  })

  it('never cites an order that does not contain the product', async () => {
    const cited = rows.filter(r => r.order_ref)
    expect(cited.length).toBeGreaterThan(0)

    const { data, error } = await supabase
      .from('orders')
      .select('order_ref, order_items(product_id)')
      .in('order_ref', [...new Set(cited.map(r => r.order_ref!))])
    expect(error, error?.message).toBeNull()

    const contents = new Map<string, Set<string>>()
    for (const o of (data ?? []) as { order_ref: string; order_items: { product_id: string }[] }[]) {
      contents.set(o.order_ref, new Set(o.order_items.map(i => i.product_id)))
    }

    const wrong = cited
      .filter(r => !contents.get(r.order_ref!)?.has(r.product_id))
      .map(r => `${r.id} cites ${r.order_ref} for ${r.product_id}`)
    expect(wrong, wrong.join('; ')).toEqual([])
  })

  it('publishes nothing written by somebody who sells here', async () => {
    const { data, error } = await supabase.from('partners').select('name')
    expect(error, error?.message).toBeNull()
    const sellers = new Set(((data ?? []) as { name: string }[]).map(p => p.name))

    const surviving = reviews
      .filter(r => r.status !== 'rejected' && sellers.has(r.author))
      .map(r => `${r.id} by ${r.author}`)
    expect(surviving, surviving.join('; ')).toEqual([])
  })

  /* --- the guard, tried rather than read ---------------------------------- */

  it('refuses an order_ref that does not contain the product', async () => {
    const donor = rows.find(r => r.order_ref)!
    const other = rows.find(r => r.product_id !== donor.product_id)!

    const id = `REV-TEST-${Date.now()}`
    written.push(id)
    const { error } = await supabase.from('product_reviews').insert({
      id,
      product_id: other.product_id,
      rating: 5,
      title: 'Citing somebody else\'s order',
      body: 'This review names an order that bought a different product entirely.',
      author: 'Integration Test',
      submitted: new Date().toISOString().slice(0, 10),
      status: 'pending',
      order_ref: donor.order_ref,
    })
    expect(error, 'the guard let a mismatched order through').not.toBeNull()
    expect(error!.message).toMatch(/cannot be the purchase behind this review/)
  })

  it('refuses a review written under a seller\'s name', async () => {
    const { data } = await supabase.from('partners').select('name').limit(1)
    const seller = ((data ?? []) as { name: string }[])[0]
    expect(seller, 'no partners to test with').toBeTruthy()

    const id = `REV-TEST-S-${Date.now()}`
    written.push(id)
    const { error } = await supabase.from('product_reviews').insert({
      id,
      product_id: rows[0].product_id,
      rating: 5,
      title: 'A seller praising the neighbourhood',
      body: 'Written by a party that sells on this marketplace, which the reader cannot see.',
      author: seller.name,
      submitted: new Date().toISOString().slice(0, 10),
      status: 'pending',
    })
    expect(error, 'the guard let a seller review through').not.toBeNull()
    expect(error!.message).toMatch(/cannot review products on it/)
  })

  /* The remedy must not meet the rule — the guard once refused the very update
     that takes an offending review down. */
  it('still allows a seller review to be rejected', async () => {
    const offending = reviews.find(r => r.status === 'rejected' && r.reject_reason?.includes('sells on this marketplace'))
    expect(offending, 'nothing was refused for the conflict').toBeTruthy()

    const { error } = await supabase.from('product_reviews')
      .update({ status: 'rejected', reject_reason: offending!.reject_reason })
      .eq('id', offending!.id)
    expect(error, error?.message).toBeNull()
  })
})
