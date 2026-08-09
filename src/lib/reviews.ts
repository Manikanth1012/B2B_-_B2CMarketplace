/* Review rules, pure.

   The model, from the prototype: reviews are records, not a static number — written
   only by someone who bought the thing, moderated before publication, answerable by
   the seller, and aggregated from what is actually published. */

export interface Review {
  id: string
  product_id: string
  rating: number
  title: string
  body: string
  author: string
  submitted: string
  status: 'pending' | 'published' | 'rejected'
  reject_reason: string | null
  reply_by: string | null
  reply_at: string | null
  reply_text: string | null
  user_id?: string | null
  /* Who wrote it and what they bought.
   *
     `customer_id` rather than `user_id` alone, because four of the shoppers in
     this marketplace have orders and no login — a guest checkout is a customer
     we can name, and filing them as anonymous throws away what we know.
     `order_ref` is the purchase the review is about; null is not a defect, it
     is an unverified review, which is an ordinary thing. */
  customer_id?: string | null
  account_id?: string | null
  order_ref?: string | null
}

/** What is known about where a review came from, worst-known to best. */
export type Provenance = 'anonymous' | 'known' | 'verified'

export const REVIEW_STATES = ['pending', 'published', 'rejected'] as const

/* Refusing a review without saying why is not a decision anyone can appeal or learn
   from, so the moderator picks from a list rather than typing prose. */
export const REVIEW_REASONS = [
  'Contains personal data',
  'Abusive or discriminatory',
  'Not about this product',
  'Promotes a competitor',
  'Appears to be incentivised',
  'Duplicate',
] as const

export type RejectReason = typeof REVIEW_REASONS[number]

/* ------------------------------------------------------------- eligibility */

/**
 * May this person review this product? Only if they bought it, and only once.
 * The database enforces the same rule in the insert policy — this is so the screen
 * can explain itself rather than offering a button that will be refused.
 */
export function canReview(
  productId: string,
  purchasedProductIds: readonly string[],
  ownReviews: readonly Pick<Review, 'product_id'>[],
): { ok: true } | { ok: false; reason: string } {
  if (!purchasedProductIds.includes(productId)) {
    return { ok: false, reason: 'Only people who bought this can review it.' }
  }
  if (ownReviews.some(r => r.product_id === productId)) {
    return { ok: false, reason: 'You have already reviewed this one.' }
  }
  return { ok: true }
}

export const MIN_BODY = 20

export function validateReview(rating: number, title: string, body: string): string | null {
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) return 'Choose a rating from 1 to 5 stars.'
  if (!title.trim()) return 'Give it a short headline.'
  /* Long enough to say something. "Good" helps nobody deciding whether to buy. */
  if (body.trim().length < MIN_BODY) return `Tell us a bit more — at least ${MIN_BODY} characters.`
  return null
}

/* -------------------------------------------------------------- aggregation */

export interface Aggregate {
  count: number
  average: number
  /* Index 0 is one star, index 4 is five. The shape of the distribution is the part
     an average hides — four fives and a one is not the same product as five threes. */
  distribution: [number, number, number, number, number]
}

/** Aggregated from published reviews only. Counting pending ones would publish them
    by the back door, and counting rejected ones would keep refused content alive. */
export function aggregate(reviews: readonly Review[]): Aggregate {
  const published = reviews.filter(r => r.status === 'published')
  const distribution: [number, number, number, number, number] = [0, 0, 0, 0, 0]
  for (const r of published) distribution[r.rating - 1]++

  const count = published.length
  const average = count === 0
    ? 0
    : Math.round((published.reduce((s, r) => s + r.rating, 0) / count) * 10) / 10

  return { count, average, distribution }
}

/* --------------------------------------------------------------- the seller */

/** A published review the seller has not answered. Low ratings first — an unanswered
    two-star is the one that costs them, and it is what their Reviews screen is for. */
export function awaitingReply(reviews: readonly Review[]): Review[] {
  return reviews
    .filter(r => r.status === 'published' && !r.reply_text)
    .sort((a, b) => a.rating - b.rating || b.submitted.localeCompare(a.submitted))
}

export function hasReply(r: Review): boolean {
  return Boolean(r.reply_text && r.reply_text.trim())
}

/* ------------------------------------------------------------- moderation */

export function pendingReviews(reviews: readonly Review[]): Review[] {
  /* Oldest first — somebody has been waiting longest for a decision. */
  return reviews
    .filter(r => r.status === 'pending')
    .sort((a, b) => a.submitted.localeCompare(b.submitted) || a.id.localeCompare(b.id))
}

/** A rejection has to carry a reason; an approval must not carry one. */
export function validateModeration(
  decision: 'published' | 'rejected',
  reason: string | null,
): string | null {
  if (decision === 'rejected' && !reason) return 'Choose why it is being refused.'
  return null
}

/* ------------------------------------------------------------------ display */

/* Newest first for a reader, but a review with a seller's answer is more useful than
   one without, so replies float within the same day. */
export function orderForDisplay(reviews: readonly Review[]): Review[] {
  return reviews
    .filter(r => r.status === 'published')
    .sort((a, b) =>
      b.submitted.localeCompare(a.submitted) ||
      Number(hasReply(b)) - Number(hasReply(a)) ||
      a.id.localeCompare(b.id))
}

export function stars(rating: number): string {
  return '★'.repeat(Math.max(0, Math.min(5, rating))) + '☆'.repeat(Math.max(0, 5 - rating))
}


/* --------------------------------------------------------------- provenance */

/**
 * Where a review came from.
 *
 * Three states and they are genuinely different to a reader. A verified
 * purchase is a claim the marketplace can stand behind. A known customer with
 * no purchase of *this* product is somebody real saying something about a thing
 * they got elsewhere — worth reading, not worth badging. Anonymous is a name in
 * a text box.
 *
 * Derived from the pointer rather than stored beside it. A `verified` boolean
 * next to an `order_ref` is two copies of one fact, and the copy that goes
 * stale is always the one the screen reads.
 */
export function provenanceOf(
  r: Pick<Review, 'order_ref' | 'customer_id' | 'account_id'>,
): Provenance {
  if (r.order_ref) return 'verified'
  return r.customer_id || r.account_id ? 'known' : 'anonymous'
}

export function isVerified(r: Pick<Review, 'order_ref'>): boolean {
  return Boolean(r.order_ref)
}

/** The badge a shopper sees. Nothing at all for the two unverified states —
    "unverified purchase" on a review reads as an accusation, and the absence of
    the badge is the whole message. */
export const PROVENANCE_BADGE: Record<Provenance, string | null> = {
  verified: 'Verified purchase',
  known: null,
  anonymous: null,
}

/** What the moderator is told, which is the opposite: they need the two
    unverified states spelled out, because that is what they are deciding on. */
export const PROVENANCE_NOTE: Record<Provenance, string> = {
  verified: 'Verified purchase — the order is on file',
  known: 'Known customer, but no purchase of this product on file',
  anonymous: 'Not linked to any account',
}

/**
 * How much of a product's published opinion is backed by a purchase.
 *
 * Reported as a pair rather than a percentage, because "60% verified" over five
 * reviews and over five hundred are different facts and the percentage hides
 * which one you are looking at.
 */
export function verifiedShare(
  reviews: readonly Pick<Review, 'status' | 'order_ref'>[],
): { verified: number; published: number } {
  const published = reviews.filter(r => r.status === 'published')
  return { verified: published.filter(isVerified).length, published: published.length }
}
