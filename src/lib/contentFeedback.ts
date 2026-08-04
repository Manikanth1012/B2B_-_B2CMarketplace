/**
 * What readers say about the marketplace's own words.
 *
 * Deliberately not a review. A product review is a buyer's opinion of something
 * a seller sells, moderated and then published to other shoppers. This is a
 * reader's opinion of something the marketplace wrote, and it is never
 * published — it is a work queue for whoever owns the content. Treating the two
 * the same would put "this page is out of date" on a product page.
 *
 * The useful output is not a satisfaction score. It is: which page is failing,
 * for whom, and in what way — because those three together are a ticket
 * somebody can pick up, and a percentage is not.
 */

export type Surface = 'kb_article' | 'category' | 'product' | 'banner' | 'page'
export type Persona = 'consumer' | 'partner' | 'enterprise'
export type FeedbackState = 'new' | 'triaged' | 'actioned' | 'declined'

export type Reason =
  | 'out_of_date' | 'missing_steps' | 'contradicts_screen' | 'hard_to_find'
  | 'too_long' | 'wrong_audience' | 'clear_and_correct'

export interface Feedback {
  id: string
  surface: Surface
  ref: string
  persona: Persona
  author: string
  author_ref: string | null
  helpful: boolean
  reason: Reason
  comment: string | null
  submitted: string
  state: FeedbackState
  reviewed_by: string | null
  reviewed_at: string | null
  action_taken: string | null
  sort_order: number
}

/* What each reason means and what it implies about the fix. A theme with no
   remedy attached is a chart nobody acts on. */
export const REASONS: Record<Reason, { label: string; fix: string; severity: number }> = {
  contradicts_screen: {
    label: 'Contradicts the screen',
    fix: 'The words and the product disagree. One of them is wrong, and until somebody says which, every reader is misled.',
    severity: 0,
  },
  out_of_date: {
    label: 'Out of date',
    fix: 'It was true once. Re-check it against the current build and restate it.',
    severity: 1,
  },
  missing_steps: {
    label: 'Missing a step',
    fix: 'It stops before the thing the reader came for. Find where they gave up and carry on from there.',
    severity: 2,
  },
  wrong_audience: {
    label: 'Written for somebody else',
    fix: 'It assumes knowledge the actual reader does not have. Establish who opens this page and write for them.',
    severity: 3,
  },
  hard_to_find: {
    label: 'Hard to find',
    fix: 'The content is fine; nothing points at it from where the question arises. This is a navigation fix, not a writing one.',
    severity: 4,
  },
  too_long: {
    label: 'Too long for the question',
    fix: 'The answer is in there and buried. Lead with it.',
    severity: 5,
  },
  clear_and_correct: {
    label: 'Clear and correct',
    fix: 'Nothing to do. Worth knowing which pages work.',
    severity: 9,
  },
}

export const SURFACE_LABEL: Record<Surface, string> = {
  kb_article: 'Help article',
  category: 'Marketplace page',
  product: 'Product description',
  banner: 'Banner copy',
  page: 'Screen',
}

/* ------------------------------------------------------------- summary --- */

export interface Summary {
  total: number
  helpful: number
  unhelpful: number
  /* Null rather than 0 when nothing has come in — 0% helpful and no feedback
     are very different states and one of them is not a failure. */
  helpfulPct: number | null
  awaiting: number
  actioned: number
}

export function summarise(items: readonly Feedback[]): Summary {
  const helpful = items.filter(f => f.helpful).length
  return {
    total: items.length,
    helpful,
    unhelpful: items.length - helpful,
    helpfulPct: items.length === 0 ? null : Math.round((helpful / items.length) * 1000) / 10,
    awaiting: items.filter(f => f.state === 'new').length,
    actioned: items.filter(f => f.state === 'actioned').length,
  }
}

export interface SurfaceRow {
  surface: Surface
  ref: string
  total: number
  unhelpful: number
  helpfulPct: number | null
  /* Which personas complained. The same article failing two personas is a
     different problem from one failing only sellers. */
  personas: Persona[]
  topReason: Reason | null
  awaiting: number
}

/**
 * The content that is failing, worst first.
 *
 * Ranked by how many readers it let down rather than by percentage: a page with
 * one unhappy reader out of one is 0% helpful and is not the problem. Volume of
 * complaints is what makes something worth an afternoon.
 */
export function bySurface(items: readonly Feedback[]): SurfaceRow[] {
  /* Written as an escape rather than as the character itself. The separator
     has to be one no surface or ref can contain, which is why it is NUL — but
     a literal NUL byte does not survive being opened and saved again, and when
     it was stripped `split('')` quietly became a split into single characters,
     so every row came back as surface 'k', ref 'b'. Five tests caught it; the
     escape is what stops it happening a second time. */
  const SEP = '\u0000'
  const keys = [...new Set(items.map(f => `${f.surface}${SEP}${f.ref}`))]
  return keys
    .map(k => {
      const [surface, ref] = k.split(SEP) as [Surface, string]
      const mine = items.filter(f => f.surface === surface && f.ref === ref)
      const unhelpful = mine.filter(f => !f.helpful)

      /* The most common complaint, ties broken by which is worse to leave. */
      const counts = new Map<Reason, number>()
      for (const f of unhelpful) counts.set(f.reason, (counts.get(f.reason) ?? 0) + 1)
      const topReason = [...counts.entries()].sort((a, b) =>
        b[1] - a[1] || REASONS[a[0]].severity - REASONS[b[0]].severity)[0]?.[0] ?? null

      return {
        surface, ref,
        total: mine.length,
        unhelpful: unhelpful.length,
        helpfulPct: mine.length === 0 ? null : Math.round(((mine.length - unhelpful.length) / mine.length) * 1000) / 10,
        personas: [...new Set(mine.map(f => f.persona))].sort(),
        topReason,
        awaiting: mine.filter(f => f.state === 'new').length,
      }
    })
    .sort((a, b) => b.unhelpful - a.unhelpful || b.total - a.total || a.ref.localeCompare(b.ref))
}

export interface ThemeRow {
  reason: Reason
  label: string
  count: number
  pct: number
  fix: string
  /* Where it is happening, so the fix has an address. */
  surfaces: Surface[]
}

/** The complaint themes, biggest first. Each carries what to do about it —
    counting problems without naming the remedy produces a report, not work. */
export function themes(items: readonly Feedback[]): ThemeRow[] {
  const unhelpful = items.filter(f => !f.helpful)
  if (unhelpful.length === 0) return []
  const reasons = [...new Set(unhelpful.map(f => f.reason))]
  return reasons
    .map(reason => {
      const mine = unhelpful.filter(f => f.reason === reason)
      return {
        reason,
        label: REASONS[reason].label,
        count: mine.length,
        pct: Math.round((mine.length / unhelpful.length) * 1000) / 10,
        fix: REASONS[reason].fix,
        surfaces: [...new Set(mine.map(f => f.surface))].sort(),
      }
    })
    .sort((a, b) => b.count - a.count || REASONS[a.reason].severity - REASONS[b.reason].severity)
}

/** By whose eyes. Sellers are the ones nobody usually asks and the ones who
    read the same six pages until they are fluent, so their unhappiness is both
    the most specific and the easiest to overlook. */
export function byPersona(items: readonly Feedback[]): { persona: Persona; total: number; helpfulPct: number | null; awaiting: number }[] {
  const personas: Persona[] = ['consumer', 'partner', 'enterprise']
  return personas
    .map(persona => {
      const mine = items.filter(f => f.persona === persona)
      return { persona, ...summarise(mine) }
    })
    .filter(r => r.total > 0)
    .map(r => ({ persona: r.persona, total: r.total, helpfulPct: r.helpfulPct, awaiting: r.awaiting }))
}

/**
 * The working order.
 *
 * Undecided first, because those are the only ones anybody owes anything on.
 * Within that, the complaint that misleads readers outranks the one that merely
 * bores them, and older beats newer — somebody has been waiting.
 */
export function triage(items: readonly Feedback[]): Feedback[] {
  const stateRank: Record<FeedbackState, number> = { new: 0, triaged: 1, actioned: 2, declined: 3 }
  return [...items].sort((a, b) =>
    stateRank[a.state] - stateRank[b.state] ||
    REASONS[a.reason].severity - REASONS[b.reason].severity ||
    a.submitted.localeCompare(b.submitted) ||
    a.id.localeCompare(b.id))
}

/** Whether this can be closed. A disposition with no account of what was done
    is a status somebody set to make a number go down. */
export function canClose(
  state: FeedbackState, actionTaken: string,
): { ok: true } | { ok: false; reason: string } {
  if (state !== 'actioned' && state !== 'declined') {
    return { ok: false, reason: 'Choose whether it was acted on or declined.' }
  }
  if (!actionTaken.trim()) {
    return {
      ok: false,
      reason: state === 'actioned'
        ? 'Say what changed. The next person to read this page needs to know it was already fixed once.'
        : 'Say why it was declined. A dismissal with no reason comes back as the same complaint next month.',
    }
  }
  return { ok: true }
}
