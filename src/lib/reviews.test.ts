import { describe, it, expect } from 'vitest'
import {
  canReview, validateReview, aggregate, awaitingReply, hasReply,
  pendingReviews, validateModeration, orderForDisplay, stars,
  REVIEW_REASONS, MIN_BODY, type Review, provenanceOf, isVerified, PROVENANCE_BADGE, PROVENANCE_NOTE, verifiedShare } from './reviews'

const review = (o: Partial<Review> & { id: string }): Review => ({
  product_id: 'SKU-5003', rating: 5, title: 'Good', body: 'A long enough body here.',
  author: 'Someone', submitted: '2026-07-20', status: 'published',
  reject_reason: null, reply_by: null, reply_at: null, reply_text: null, ...o,
})

describe('canReview', () => {
  /* The rule the insert policy also enforces. This exists so the screen can explain
     itself rather than offering a button the database will refuse. */
  it('allows someone who bought it and has not reviewed it', () => {
    expect(canReview('SKU-5003', ['SKU-5003'], []).ok).toBe(true)
  })

  it('refuses someone who never bought it', () => {
    const r = canReview('SKU-5003', ['SKU-4001'], [])
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/bought/i)
  })

  /* A second review is an edit, not another opinion. */
  it('refuses a second review of the same product', () => {
    const r = canReview('SKU-5003', ['SKU-5003'], [review({ id: 'a' })])
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/already/i)
  })

  it('is unaffected by a review of something else', () => {
    expect(canReview('SKU-5003', ['SKU-5003'], [review({ id: 'a', product_id: 'SKU-4001' })]).ok).toBe(true)
  })
})

describe('validateReview', () => {
  const body = 'x'.repeat(MIN_BODY)

  it('accepts a complete review', () => {
    expect(validateReview(4, 'Solid', body)).toBeNull()
  })

  it('insists on a rating in range', () => {
    expect(validateReview(0, 'T', body)).toMatch(/1 to 5/)
    expect(validateReview(6, 'T', body)).toMatch(/1 to 5/)
    expect(validateReview(3.5, 'T', body)).toMatch(/1 to 5/)
  })

  it('insists on a headline', () => {
    expect(validateReview(4, '   ', body)).toMatch(/headline/i)
  })

  /* "Good" helps nobody deciding whether to buy. */
  it('insists on enough words to be useful', () => {
    expect(validateReview(4, 'Good', 'Good')).toMatch(new RegExp(String(MIN_BODY)))
  })
})

describe('aggregate', () => {
  const reviews = [
    review({ id: 'a', rating: 5 }),
    review({ id: 'b', rating: 4 }),
    review({ id: 'c', rating: 2 }),
    review({ id: 'd', rating: 5 }),
  ]

  it('averages what is published, to one decimal', () => {
    expect(aggregate(reviews)).toMatchObject({ count: 4, average: 4 })
  })

  /* Publishing by the back door: a pending review counted in the average is visible
     in everything but its text. A rejected one counted keeps refused content alive. */
  it('ignores pending and rejected reviews entirely', () => {
    const withNoise = [
      ...reviews,
      review({ id: 'p', rating: 1, status: 'pending' }),
      review({ id: 'r', rating: 1, status: 'rejected' }),
    ]
    expect(aggregate(withNoise)).toEqual(aggregate(reviews))
  })

  /* The shape an average hides — four fives and a one is not five threes. */
  it('reports the distribution, not just the mean', () => {
    expect(aggregate(reviews).distribution).toEqual([0, 1, 0, 1, 2])
  })

  it('is zero rather than NaN with nothing published', () => {
    expect(aggregate([])).toEqual({ count: 0, average: 0, distribution: [0, 0, 0, 0, 0] })
    expect(aggregate([review({ id: 'p', status: 'pending' })]).average).toBe(0)
  })
})

describe('awaitingReply', () => {
  /* An unanswered two-star is the one that costs the seller, so it sorts first. */
  it('puts the worst unanswered review first', () => {
    const out = awaitingReply([
      review({ id: 'five', rating: 5 }),
      review({ id: 'two', rating: 2 }),
      review({ id: 'four', rating: 4 }),
    ])
    expect(out.map(r => r.id)).toEqual(['two', 'four', 'five'])
  })

  it('leaves out the ones already answered', () => {
    const out = awaitingReply([
      review({ id: 'answered', rating: 1, reply_text: 'Sorry about that.' }),
      review({ id: 'open', rating: 3 }),
    ])
    expect(out.map(r => r.id)).toEqual(['open'])
  })

  it('leaves out anything not published', () => {
    expect(awaitingReply([review({ id: 'p', status: 'pending' })])).toEqual([])
  })

  it('does not treat whitespace as a reply', () => {
    expect(hasReply(review({ id: 'a', reply_text: '   ' }))).toBe(false)
    expect(hasReply(review({ id: 'b', reply_text: 'A real answer.' }))).toBe(true)
  })
})

describe('moderation', () => {
  it('queues pending reviews oldest first — somebody has waited longest', () => {
    const out = pendingReviews([
      review({ id: 'new', status: 'pending', submitted: '2026-07-29' }),
      review({ id: 'old', status: 'pending', submitted: '2026-07-01' }),
      review({ id: 'live', status: 'published' }),
    ])
    expect(out.map(r => r.id)).toEqual(['old', 'new'])
  })

  /* "Rejected" with no reason is not a decision anyone can appeal or learn from. */
  it('will not refuse a review without a reason', () => {
    expect(validateModeration('rejected', null)).toMatch(/why/i)
    expect(validateModeration('rejected', 'Contains personal data')).toBeNull()
  })

  it('does not demand a reason to publish', () => {
    expect(validateModeration('published', null)).toBeNull()
  })

  it('offers reasons a moderator can actually pick from', () => {
    expect(REVIEW_REASONS).toContain('Contains personal data')
    expect(REVIEW_REASONS.length).toBeGreaterThan(3)
  })
})

describe('orderForDisplay', () => {
  it('shows only published reviews, newest first', () => {
    const out = orderForDisplay([
      review({ id: 'old', submitted: '2026-07-01' }),
      review({ id: 'pending', status: 'pending', submitted: '2026-07-30' }),
      review({ id: 'new', submitted: '2026-07-25' }),
    ])
    expect(out.map(r => r.id)).toEqual(['new', 'old'])
  })

  it('is stable regardless of the order rows arrive in', () => {
    const rows = [review({ id: 'b', submitted: '2026-07-01' }), review({ id: 'a', submitted: '2026-07-01' })]
    expect(orderForDisplay(rows).map(r => r.id)).toEqual(orderForDisplay([...rows].reverse()).map(r => r.id))
  })
})

describe('stars', () => {
  it('draws five, filled to the rating', () => {
    expect(stars(4)).toBe('★★★★☆')
    expect(stars(5)).toBe('★★★★★')
    expect(stars(1)).toBe('★☆☆☆☆')
  })

  it('does not run off the end for nonsense input', () => {
    expect(stars(0)).toBe('☆☆☆☆☆')
    expect(stars(9)).toBe('★★★★★')
  })
})

/* Every other record here traces to something. A review pointed at a product
   and carried a name typed into a text column, and that was all. */
describe('where a review came from', () => {
  const r = (o: Partial<Review> = {}): Review => ({
    id: 'REV-1', product_id: 'SKU-4001', rating: 5, title: 't', body: 'b'.repeat(30),
    author: 'Arun Deshpande', submitted: '01 Aug 2026', status: 'published',
    reject_reason: null, reply_by: null, reply_at: null, reply_text: null,
    ...o,
  })

  it('is verified when it names the purchase', () => {
    expect(provenanceOf(r({ order_ref: 'ORD-1', customer_id: 'cp-1' }))).toBe('verified')
    expect(isVerified(r({ order_ref: 'ORD-1' }))).toBe(true)
  })

  /* Somebody real saying something about a thing they got elsewhere. Worth
     reading, not worth badging — and quite different from a name in a box. */
  it('is known when the customer is identified but the purchase is not', () => {
    expect(provenanceOf(r({ customer_id: 'cp-449118' }))).toBe('known')
    expect(provenanceOf(r({ account_id: 'ENT-2011' }))).toBe('known')
    expect(isVerified(r({ customer_id: 'cp-449118' }))).toBe(false)
  })

  it('is anonymous when nothing behind it resolves', () => {
    expect(provenanceOf(r())).toBe('anonymous')
  })

  /* A customer without a login is still a customer. Four of the shoppers here
     have orders and no auth user, and keying provenance on `user_id` alone
     filed three named people as strangers. */
  it('counts a customer with no login as known', () => {
    expect(provenanceOf(r({ customer_id: 'cp-449118', user_id: null }))).toBe('known')
  })

  it('badges only the verified ones', () => {
    expect(PROVENANCE_BADGE.verified).toBe('Verified purchase')
    expect(PROVENANCE_BADGE.known).toBeNull()
    expect(PROVENANCE_BADGE.anonymous).toBeNull()
  })

  /* The moderator needs the opposite of what the shopper needs: the two
     unverified states spelled out, because that is what they decide on. */
  it('tells the moderator all three apart', () => {
    const notes = new Set(Object.values(PROVENANCE_NOTE))
    expect(notes.size).toBe(3)
    expect(PROVENANCE_NOTE.known).toMatch(/no purchase of this product/)
    expect(PROVENANCE_NOTE.anonymous).toMatch(/not linked/i)
  })

  it('reports the verified share as a pair, over published reviews only', () => {
    const share = verifiedShare([
      r({ status: 'published', order_ref: 'ORD-1' }),
      r({ status: 'published' }),
      r({ status: 'pending', order_ref: 'ORD-2' }),
      r({ status: 'rejected', order_ref: 'ORD-3' }),
    ])
    expect(share).toEqual({ verified: 1, published: 2 })
  })

  it('says nothing rather than dividing by nothing where a product has no reviews', () => {
    expect(verifiedShare([])).toEqual({ verified: 0, published: 0 })
  })
})
