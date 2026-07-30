/* The partner lifecycle, pure.
 *
 * `partners.status` was a free-text column that anything could set to anything.
 * These are the moves that exist, why each one exists, and what each one does
 * to the seller's listings — stated once so the operator console, the seller's
 * own console and the audit trail cannot hold three different opinions about
 * what "suspended" means.
 */

export type PartnerStatus = 'onboarding' | 'review' | 'live' | 'suspended' | 'rejected'

export const PARTNER_STATUSES: PartnerStatus[] = ['onboarding', 'review', 'live', 'suspended', 'rejected']

export interface Transition {
  from: PartnerStatus
  to: PartnerStatus
  /* The button's words. An operator should not have to work out that "review"
     means "hold this application". */
  label: string
  /* What it does beyond the status word, in a sentence the operator reads
     before they do it rather than discovers afterwards. */
  effect: string
  /* Whether clearing every gate is a precondition. Going live without the
     gates cleared is the one move that would make the whole funnel decorative. */
  requiresAllGatesCleared?: boolean
  /* Live listings this move takes down. */
  suspendsListings?: boolean
}

export const TRANSITIONS: Transition[] = [
  {
    from: 'onboarding', to: 'review',
    label: 'Hold for review',
    effect: 'The application stops advancing while a query is outstanding. Gates already cleared stay cleared.',
  },
  {
    from: 'onboarding', to: 'live',
    label: 'Publish live',
    effect: 'The storefront opens in the categories the seller was approved for.',
    requiresAllGatesCleared: true,
  },
  {
    from: 'onboarding', to: 'rejected',
    label: 'Reject the application',
    effect: 'The application stops. It is not a finding against the company — they may reapply with corrected documents, which opens a new application rather than reopening this one.',
  },
  {
    from: 'review', to: 'onboarding',
    label: 'Return to the seller',
    effect: 'The query is answered and the application resumes at the gate it was held on.',
  },
  {
    from: 'review', to: 'live',
    label: 'Publish live',
    effect: 'The storefront opens in the categories the seller was approved for.',
    requiresAllGatesCleared: true,
  },
  {
    from: 'review', to: 'rejected',
    label: 'Reject the application',
    effect: 'The application stops. They may reapply with corrected documents.',
  },
  {
    from: 'live', to: 'suspended',
    label: 'Suspend the seller',
    effect: 'Every live listing comes down immediately. Orders already placed are still fulfilled and still settled — a suspension stops new trade, it does not cancel trade that happened.',
    suspendsListings: true,
  },
  {
    from: 'suspended', to: 'live',
    label: 'Reinstate the seller',
    effect: 'The storefront reopens. Listings taken down by the suspension stay down until the seller relists them, so nothing goes back on sale that nobody has looked at.',
  },
  {
    /* Deliberately the only path out of `rejected`, and it goes back to the
       start. A rejected application is finished; what follows is a new one. */
    from: 'rejected', to: 'onboarding',
    label: 'Invite a reapplication',
    effect: 'A fresh application opens at the first gate. Nothing from the stopped application carries over — the evidence that failed is not re-used.',
  },
]

export function transitionsFrom(status: PartnerStatus): Transition[] {
  return TRANSITIONS.filter(t => t.from === status)
}

export function findTransition(from: PartnerStatus, to: PartnerStatus): Transition | null {
  return TRANSITIONS.find(t => t.from === from && t.to === to) ?? null
}

export type MoveVerdict =
  | { ok: true; transition: Transition }
  | { ok: false; reason: string }

export interface MoveContext {
  /* Gate statuses for this partner, in any order. */
  gateStatuses: readonly string[]
  reason: string
}

/**
 * The only way a partner's status changes. There is no force parameter: a
 * caller cannot route around the gate precondition because there is nothing to
 * pass, which is the same discipline the technical gate already follows.
 */
export function canMove(from: PartnerStatus, to: PartnerStatus, ctx: MoveContext): MoveVerdict {
  if (from === to) {
    return { ok: false, reason: `This partner is already ${from}.` }
  }
  const transition = findTransition(from, to)
  if (!transition) {
    return {
      ok: false,
      reason: `A partner cannot go from ${from} to ${to}. ` +
        (transitionsFrom(from).length === 0
          ? 'There is no move out of this state.'
          : `From ${from} the moves are: ${transitionsFrom(from).map(t => t.to).join(', ')}.`),
    }
  }
  if (!ctx.reason.trim()) {
    return { ok: false, reason: 'A reason is required. A status change nobody stated a ground for is one the seller cannot answer and the marketplace cannot defend.' }
  }
  if (transition.requiresAllGatesCleared) {
    const outstanding = ctx.gateStatuses.filter(s => s !== 'cleared').length
    if (ctx.gateStatuses.length === 0) {
      return { ok: false, reason: 'This partner has no onboarding record, so there is nothing to say the gates were cleared. Going live on that basis would make the funnel decorative.' }
    }
    if (outstanding > 0) {
      return {
        ok: false,
        reason: `${outstanding} of ${ctx.gateStatuses.length} gates are not cleared. Going live is what the last gate does — it is not a way around the six before it.`,
      }
    }
  }
  return { ok: true, transition }
}

export interface LifecycleEvent {
  id: string
  partner_id: string
  from_status: string | null
  to_status: string
  reason: string
  actor: string
  at: string
}

/** Newest first, which is the order the question is asked in — "why is this
    seller suspended?" before "how did they get here?". */
export function orderedHistory(events: readonly LifecycleEvent[]): LifecycleEvent[] {
  return [...events].sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
}

/** What the status means, for the line under the badge. A word on its own tells
    a seller nothing about whether they can trade today. */
export function statusMeaning(status: PartnerStatus): string {
  switch (status) {
    case 'onboarding': return 'Applying. Nothing is on sale yet.'
    case 'review':     return 'Application held while a query is outstanding. Nothing is on sale.'
    case 'live':       return 'Trading. Listings are visible to buyers in the approved categories.'
    case 'suspended':  return 'Listings are down and no new orders can be placed. Existing orders are still fulfilled and settled.'
    case 'rejected':   return 'The application stopped. A corrected reapplication opens a new one.'
  }
}
