/**
 * The automated pass a review gets before a person reads it.
 *
 * Screening does not publish anything and does not refuse anything. It reads
 * the review against the rest of the corpus and says what is wrong with it, in
 * words a moderator can act on and quote back to the customer. The operator
 * still decides — which is the point: a filter that publishes on its own is a
 * filter nobody audits, and one that refuses on its own is a customer told
 * nothing by a machine that cannot be appealed to.
 *
 * What it buys is triage. Twenty reviews a day where three are copy-paste and
 * one is somebody's phone number is twenty careful reads; with this it is four
 * careful reads and sixteen glances.
 *
 * Every check is deterministic and explains itself with the text that triggered
 * it. Nothing here scores a review on a hidden number.
 */

export interface ScreenableReview {
  id: string
  product_id: string
  rating: number
  title: string
  body: string
  author: string
  submitted: string
  status: string
}

export type Severity = 'serious' | 'suspect' | 'note'

export interface Flag {
  code: string
  label: string
  severity: Severity
  /* Why this matters, in the moderator's terms rather than the rule's. */
  why: string
  /* The part of the review that set it off, so the moderator can see the
     evidence without hunting for it. A check that cannot point at anything is a
     check nobody should trust. */
  evidence: string
  /* Which of the standing refusal reasons this maps to, where it maps cleanly.
     Lets the screen pre-fill the refusal rather than making somebody re-derive
     a decision the check already made. */
  suggests?: string
}

export interface Screening {
  reviewId: string
  flags: Flag[]
  /* The worst severity present, or null when nothing fired. */
  worst: Severity | null
  /* What the screen would do, if it were deciding. It is not. */
  recommendation: 'refuse' | 'read closely' | 'looks fine'
}

/* ------------------------------------------------------------ normalising */

/** Down to comparable text: lower case, punctuation gone, runs of whitespace
    collapsed. Two reviews that differ only in exclamation marks are the same
    review, and a duplicate check that misses that misses most duplicates. */
export function normalise(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim()
}

const words = (text: string): string[] => normalise(text).split(' ').filter(Boolean)

/** How much two pieces of text overlap, 0 to 1, by shared words over total
    distinct words. Crude on purpose: it is explainable to somebody disputing a
    refusal, which a language model's opinion is not. */
export function similarity(a: string, b: string): number {
  const A = new Set(words(a))
  const B = new Set(words(b))
  if (A.size === 0 || B.size === 0) return 0
  let shared = 0
  for (const w of A) if (B.has(w)) shared++
  return shared / (A.size + B.size - shared)
}

/* The point at which two reviews are the same review wearing different
   punctuation. Set high enough that two people independently praising battery
   life do not collide. */
export const DUPLICATE_AT = 0.8

/* ---------------------------------------------------------------- checks */

const EMAIL = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i
const PHONE = /(?:\+?\d[\d\s().-]{8,}\d)/
const URL = /\b(?:https?:\/\/|www\.)\S+|\b[a-z0-9-]+\.(?:com|net|org|io|shop|co)\b/i

/* A long run of one character, or a long token with no vowel in it. Both are
   what a keyboard mash looks like and neither is what a word looks like. */
const CHAR_RUN = /(.)\1{4,}/
const VOWELLESS = /\b[bcdfghjklmnpqrstvwxz]{7,}\b/i

const NEGATIVE = [
  'broken', 'useless', 'terrible', 'awful', 'rubbish', 'waste', 'faulty', 'refund',
  'never works', 'stopped working', 'disappointed', 'worst', 'scam', 'avoid',
]
const POSITIVE = [
  'excellent', 'perfect', 'brilliant', 'flawless', 'love it', 'recommend',
  'exactly what', 'delighted', 'outstanding',
]

const hits = (body: string, list: string[]): string[] => {
  const n = normalise(body)
  return list.filter(t => n.includes(normalise(t)))
}

export interface ScreenContext {
  /* Everything else on the marketplace, to compare against. */
  corpus: readonly ScreenableReview[]
  /* Sellers other than the one being reviewed, so a plug for a rival can be
     recognised by name rather than by guesswork. */
  otherSellers?: readonly string[]
  /* Product ids this author actually bought. Omitted means unknown, which is
     not the same as "did not buy" and is not flagged. */
  purchasedByAuthor?: readonly string[]
}

/**
 * Screen one review.
 *
 * Order matters only for reading: the flags come back worst first, because a
 * moderator who reads one line should read the one that decides it.
 */
export function screen(review: ScreenableReview, context: ScreenContext): Screening {
  const flags: Flag[] = []
  const body = review.body ?? ''
  const title = review.title ?? ''
  const full = `${title} ${body}`.trim()

  /* ---- duplication ---- */
  const others = context.corpus.filter(r => r.id !== review.id)

  const sameAuthorSameProduct = others.find(r =>
    r.author === review.author && r.product_id === review.product_id)
  if (sameAuthorSameProduct) {
    flags.push({
      code: 'dup-author-product', label: 'Second review of the same product', severity: 'serious',
      why: `${review.author} already reviewed this product (${sameAuthorSameProduct.id}). One person, one review — otherwise the rating is whatever somebody has the patience to repeat.`,
      evidence: sameAuthorSameProduct.title,
      suggests: 'Duplicate',
    })
  }

  const copies = others
    .map(r => ({ r, score: similarity(body, r.body ?? '') }))
    .filter(x => x.score >= DUPLICATE_AT)
    .sort((a, b) => b.score - a.score)
  if (copies.length > 0) {
    const top = copies[0]
    const sameHand = top.r.author === review.author
    flags.push({
      code: sameHand ? 'dup-text-self' : 'dup-text-other',
      label: sameHand ? 'Same text posted before' : 'Same text as another reviewer',
      severity: 'serious',
      why: sameHand
        ? `Word for word the same as ${top.r.id} by the same person on ${top.r.product_id === review.product_id ? 'this product' : top.r.product_id}. Copy-paste across products says nothing about either.`
        : `${Math.round(top.score * 100)}% the same as ${top.r.id} by ${top.r.author}. Two people do not write the same paragraph; this is a farm or a bot.`,
      evidence: top.r.body?.slice(0, 120) ?? '',
      suggests: 'Duplicate',
    })
  }

  /* ---- junk text ---- */
  const run = CHAR_RUN.exec(body)
  if (run) {
    flags.push({
      code: 'junk-run', label: 'Mashed keyboard', severity: 'serious',
      why: 'A run of the same character five or more times. Nobody types that meaning anything by it.',
      evidence: run[0],
      suggests: 'Not about this product',
    })
  }
  const vowelless = VOWELLESS.exec(body)
  if (vowelless) {
    flags.push({
      code: 'junk-gibberish', label: 'Not words', severity: 'serious',
      why: 'A long run of consonants with no vowel — gibberish rather than language.',
      evidence: vowelless[0],
      suggests: 'Not about this product',
    })
  }
  /* Eight, not five. "it is fine i guess" is five words and tells the next
     buyer nothing; the length rule that let it through counts characters, which
     is why this counts words instead. */
  const wordCount = words(body).length
  if (wordCount > 0 && wordCount < 8) {
    flags.push({
      code: 'thin', label: 'Says almost nothing', severity: 'suspect',
      why: `${wordCount} word${wordCount === 1 ? '' : 's'}. It clears the length rule but tells the next buyer nothing.`,
      evidence: body.trim(),
    })
  }

  /* ---- shouting ---- */
  const letters = body.replace(/[^a-zA-Z]/g, '')
  if (letters.length >= 20) {
    const caps = body.replace(/[^A-Z]/g, '').length / letters.length
    if (caps > 0.7) {
      flags.push({
        code: 'shouting', label: 'All capitals', severity: 'note',
        why: `${Math.round(caps * 100)}% capitals. Publishable, but it reads as shouting next to everything else on the page.`,
        evidence: body.slice(0, 80),
      })
    }
  }

  /* ---- personal data and promotion ---- */
  const email = EMAIL.exec(full)
  if (email) {
    flags.push({
      code: 'contact-email', label: 'Contains an email address', severity: 'serious',
      why: 'Publishing it exposes somebody\'s contact details to everyone who reads the product page.',
      evidence: email[0],
      suggests: 'Contains personal data',
    })
  }
  const phone = PHONE.exec(full)
  if (phone) {
    flags.push({
      code: 'contact-phone', label: 'Contains a phone number', severity: 'serious',
      why: 'Same as an email address: it should not be on a public product page.',
      evidence: phone[0].trim(),
      suggests: 'Contains personal data',
    })
  }
  const url = URL.exec(full)
  if (url) {
    flags.push({
      code: 'link', label: 'Contains a link', severity: 'suspect',
      why: 'Reviews carrying links are usually selling something. Worth reading before it goes up.',
      evidence: url[0],
      suggests: 'Promotes a competitor',
    })
  }

  const rivals = (context.otherSellers ?? []).filter(s => {
    const n = normalise(s)
    return n.length > 3 && normalise(full).includes(n)
  })
  if (rivals.length > 0) {
    flags.push({
      code: 'competitor', label: 'Names another seller', severity: 'suspect',
      why: `Mentions ${rivals.join(', ')}. Sometimes a fair comparison, sometimes a plant — worth a read either way.`,
      evidence: rivals[0],
      suggests: 'Promotes a competitor',
    })
  }

  /* ---- the rating against what it says ---- */
  const negatives = hits(full, NEGATIVE)
  const positives = hits(full, POSITIVE)
  if (review.rating >= 4 && negatives.length > 0 && positives.length === 0) {
    flags.push({
      code: 'mismatch-high', label: 'High rating, negative text', severity: 'suspect',
      why: `${review.rating} stars but the text says ${negatives.join(', ')}. Either the stars slipped or the text is not about this.`,
      evidence: negatives.join(', '),
    })
  }
  if (review.rating <= 2 && positives.length > 0 && negatives.length === 0) {
    flags.push({
      code: 'mismatch-low', label: 'Low rating, positive text', severity: 'suspect',
      why: `${review.rating} star${review.rating === 1 ? '' : 's'} but the text says ${positives.join(', ')}. Worth checking the rating was not a misclick.`,
      evidence: positives.join(', '),
    })
  }

  /* ---- did they buy it ---- */
  if (context.purchasedByAuthor && !context.purchasedByAuthor.includes(review.product_id)) {
    flags.push({
      code: 'unverified', label: 'No purchase on record', severity: 'suspect',
      why: 'The marketplace has no order from this person for this product. The insert policy should have refused it, so this is worth understanding before it is published.',
      evidence: review.product_id,
      suggests: 'Not about this product',
    })
  }

  const rank: Record<Severity, number> = { serious: 0, suspect: 1, note: 2 }
  flags.sort((a, b) => rank[a.severity] - rank[b.severity])

  const worst = flags.length === 0 ? null : flags[0].severity
  return {
    reviewId: review.id,
    flags,
    worst,
    recommendation:
      worst === 'serious' ? 'refuse'
      : worst === null ? 'looks fine'
      : 'read closely',
  }
}

/** Screen a whole queue. The corpus is every review, including published ones —
    a copy of something already on the site is exactly what the check is for. */
export function screenAll(
  reviews: readonly ScreenableReview[],
  context: Omit<ScreenContext, 'corpus'> & { corpus?: readonly ScreenableReview[] } = {},
): Map<string, Screening> {
  const corpus = context.corpus ?? reviews
  return new Map(reviews.map(r => [r.id, screen(r, { ...context, corpus })]))
}

/** Worst first, then oldest first — somebody has been waiting on every one of
    these, and the ones that will be refused should not sit behind the ones that
    need thought. */
export function triage<T extends ScreenableReview>(
  reviews: readonly T[],
  screenings: Map<string, Screening>,
): T[] {
  const rank = (id: string): number => {
    const s = screenings.get(id)
    if (!s || s.worst === null) return 3
    return { serious: 0, suspect: 1, note: 2 }[s.worst]
  }
  return [...reviews].sort((a, b) =>
    rank(a.id) - rank(b.id) ||
    a.submitted.localeCompare(b.submitted) ||
    a.id.localeCompare(b.id))
}

/** What the queue looks like at a glance, for the summary line. */
export function screeningSummary(screenings: Map<string, Screening>): {
  total: number; serious: number; suspect: number; clean: number
} {
  const all = [...screenings.values()]
  return {
    total: all.length,
    serious: all.filter(s => s.worst === 'serious').length,
    suspect: all.filter(s => s.worst === 'suspect').length,
    clean: all.filter(s => s.worst === null).length,
  }
}
