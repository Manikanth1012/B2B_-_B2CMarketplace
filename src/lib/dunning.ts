/* What chasing an unpaid bill consists of. No React and no Supabase, so the
   rules can be tested without a DOM or a network.

   A dunning ladder decides when somebody is cut off, which makes it the most
   consequential piece of configuration in the marketplace and the one most
   worth refusing loudly. Three of the rules here are refusals rather than
   warnings, and each is a refusal because the alternative harms somebody who
   is not the person making the mistake:

   - A seller is never suspended. Their listings coming down strands buyers who
     are mid-order; the marketplace withholds their settlement instead.
   - A step cannot fire inside the grace the ladder promises, or the grace is
     not grace.
   - A tier ladder cannot be harsher than the audience default it overrides.
     A Platinum customer chased faster than a Bronze one is a tier that means
     the opposite of what it says. */

export type Check = { ok: true; note?: string } | { ok: false; reason: string }
export type Audience = 'consumer' | 'enterprise' | 'partner'

export const CHANNELS = ['automatic', 'sms', 'email', 'in-app', 'call', 'letter', 'settlement'] as const
export const ACTIONS = ['retry', 'remind', 'warn', 'final', 'suspend', 'withhold', 'refer', 'review'] as const
export type Channel = (typeof CHANNELS)[number]
export type Action = (typeof ACTIONS)[number]

export interface Ladder {
  id: string
  name: string
  audience: Audience
  /* Null is the audience default; a value overrides it for that tier. */
  tier: string | null
  grace_days: number
  /* Null means never suspended, which is the correct answer for a seller and
     for a strategic account rather than an omission. */
  suspend_on_day: number | null
  withhold_settlement: boolean
  pause_on_promise: boolean
  note: string
  system: boolean
  updated_by: string | null
  updated_on: string | null
  sort_order: number
}

export interface Step {
  id: string
  ladder_id: string
  step_no: number
  name: string
  day: number
  channel: Channel
  action: Action
  note: string
}

export interface Case {
  id: string
  account_name: string
  account_type: string
  tier: string | null
  amount: number
  /* What the debt is owed in. A collections desk quotes a debtor their own
     figure, and the four cases on this marketplace are in two currencies. */
  currency: string
  age_days: number
  step: number
  step_name: string
  ladder_id: string | null
  attempts: number
  reason: string
  collector: string | null
  promise_to_pay: string | null
  status: string
  sort_order: number
}

/* --------------------------------------------------------- what applies -- */

export function stepsOn(ladderId: string, all: readonly Step[]): Step[] {
  return all.filter(s => s.ladder_id === ladderId).sort((a, b) => a.step_no - b.step_no)
}

/**
 * The ladder an account runs on.
 *
 * Resolved from the account, never chosen. A collector picking the gentle
 * ladder for whoever complained loudest is the failure this table exists to
 * prevent, so the answer is a function of audience and tier and nothing else.
 * An exact tier beats the default; no tier falls back to it.
 */
export function ladderFor(
  { audience, tier }: { audience: Audience; tier?: string | null },
  ladders: readonly Ladder[],
): Ladder | null {
  const mine = ladders.filter(l => l.audience === audience)
  return mine.find(l => tier != null && l.tier === tier) ?? mine.find(l => l.tier === null) ?? null
}

/** The audience default a tier ladder overrides. */
export function defaultFor(audience: Audience, ladders: readonly Ladder[]): Ladder | null {
  return ladders.find(l => l.audience === audience && l.tier === null) ?? null
}

/** Who is currently being chased on this ladder. */
export function casesOn(ladderId: string, cases: readonly Case[]): Case[] {
  return cases.filter(c => c.ladder_id === ladderId)
}

/* ------------------------------------------------------------ refusals --- */

/**
 * Whether a step belongs on this ladder at all.
 *
 * The seller rule is first because it is the one whose violation reaches
 * somebody who is not a party to the debt.
 */
export function canAddStep(step: Pick<Step, 'action' | 'day'>, ladder: Ladder): Check {
  if (ladder.audience === 'partner' && step.action === 'suspend') {
    return {
      ok: false,
      reason: 'A seller is never suspended. Taking their listings down strands buyers who are mid-order — withhold the settlement instead.',
    }
  }
  if (step.action === 'suspend' && ladder.suspend_on_day === null) {
    return {
      ok: false,
      reason: `${ladder.name} says it never suspends. Give it a suspension day first, or choose another action.`,
    }
  }
  if (step.day < 0) {
    return { ok: false, reason: 'A step cannot fire before the bill is due.' }
  }
  if (step.day < ladder.grace_days) {
    return {
      ok: false,
      reason: `${ladder.name} promises ${ladder.grace_days} days of grace, and this fires on day ${step.day}. Grace that gets chased inside is not grace.`,
    }
  }
  if (ladder.audience !== 'partner' && step.action === 'withhold') {
    return { ok: false, reason: 'There is no settlement to withhold from a customer. That action is for sellers.' }
  }
  return { ok: true }
}

/** Whether the ladder itself is one somebody could be put on. */
export function validateLadder(
  draft: Pick<Ladder, 'name' | 'audience' | 'tier' | 'grace_days' | 'suspend_on_day'>,
  ladders: readonly Ladder[],
): Check {
  if (!draft.name.trim()) {
    return { ok: false, reason: 'A ladder needs a name — it is what the case list refers to.' }
  }
  if (draft.grace_days < 0) {
    return { ok: false, reason: 'Grace cannot be negative. That would start chasing before the bill was due.' }
  }
  if (draft.audience === 'partner' && draft.suspend_on_day !== null) {
    return {
      ok: false,
      reason: 'A seller ladder cannot carry a suspension day. Their listings staying up is the point; the settlement is withheld instead.',
    }
  }
  if (draft.suspend_on_day !== null && draft.suspend_on_day <= draft.grace_days) {
    return {
      ok: false,
      reason: `Service would stop on day ${draft.suspend_on_day}, inside the ${draft.grace_days} days of grace this ladder promises.`,
    }
  }

  /* The point of a tier is that it is treated better. A tier ladder harsher
     than its own default is a tier that means the opposite of what it says. */
  if (draft.tier) {
    const base = defaultFor(draft.audience, ladders)
    if (base) {
      if (draft.grace_days < base.grace_days) {
        return {
          ok: false,
          reason: `${base.name} gives every ${draft.audience} account ${base.grace_days} days of grace. A tier ladder cannot give less — that is the tier meaning the opposite of what it says.`,
        }
      }
      if (draft.suspend_on_day !== null && base.suspend_on_day !== null
        && draft.suspend_on_day < base.suspend_on_day) {
        return {
          ok: false,
          reason: `${base.name} suspends on day ${base.suspend_on_day}. A tier ladder cannot suspend sooner.`,
        }
      }
    }
  }

  return {
    ok: true,
    note: draft.suspend_on_day === null
      ? 'Nothing on this ladder interrupts service.'
      : `Service stops on day ${draft.suspend_on_day}, after ${draft.grace_days} days of grace.`,
  }
}

export function canDeleteLadder(l: Ladder, cases: readonly Case[]): Check {
  if (l.system) {
    return {
      ok: false,
      reason: `${l.name} ships with the marketplace and is the default for its audience. It can be edited but not deleted.`,
    }
  }
  if (l.tier === null) {
    return {
      ok: false,
      reason: `${l.name} is the default for every ${l.audience} account. An audience with no ladder is an audience nobody chases and nobody warns.`,
    }
  }
  const on = casesOn(l.id, cases)
  if (on.length) {
    return {
      ok: false,
      reason: `${on.length} account${on.length === 1 ? ' is' : 's are'} being chased on ${l.name} right now: ${on.map(c => c.account_name).join(', ')}. Move them first.`,
    }
  }
  return { ok: true, note: 'Nobody is on it, so nobody\'s chase changes. Accounts at this tier fall back to the audience default.' }
}

/* ------------------------------------------------------------ warnings --- */

export interface Warning { level: 'warn' | 'info'; text: string }

/**
 * What is odd about a ladder, said out loud and then allowed.
 *
 * Unlike the refusals above, every one of these is a ladder somebody could
 * genuinely want. A marketplace that only ever emails is defensible; it is
 * also how a debt ages quietly to ninety days.
 */
export function warningsFor(ladder: Ladder, steps: readonly Step[]): Warning[] {
  const mine = stepsOn(ladder.id, steps)
  const out: Warning[] = []

  if (!mine.length) {
    out.push({ level: 'warn', text: 'This ladder has no steps, so nothing happens on it. An account resolved here is an account nobody chases.' })
    return out
  }

  if (ladder.suspend_on_day !== null && !mine.some(s => s.action === 'suspend')) {
    out.push({
      level: 'warn',
      text: `The ladder says service stops on day ${ladder.suspend_on_day}, but no step does it. The promise on the account banner will not be kept.`,
    })
  }
  if (ladder.suspend_on_day !== null && !mine.some(s => s.action === 'final')) {
    out.push({
      level: 'warn',
      text: 'Service is interrupted with no final notice before it. Fair warning before a cut-off is the minimum, and in several jurisdictions it is the law.',
    })
  }
  if (mine.every(s => s.channel === 'email')) {
    out.push({
      level: 'info',
      text: 'Every step is an email. One undelivered address and the whole ladder is silent while the debt ages.',
    })
  }
  if (ladder.audience === 'partner' && !mine.some(s => s.action === 'withhold')) {
    out.push({
      level: 'warn',
      text: 'Nothing on this seller ladder withholds anything, and a seller is never suspended — so nothing on it recovers the money.',
    })
  }
  if (ladder.audience === 'consumer' && mine.length > 0 && mine[0].day <= 1 && mine[0].channel !== 'automatic') {
    out.push({
      level: 'info',
      text: 'The first contact goes out within a day of the due date. Most first failures are a card that needs re-presenting, and a message that early reads as a mistake.',
    })
  }
  const suspend = mine.find(s => s.action === 'suspend')
  const last = mine[mine.length - 1]
  if (suspend && last.day > suspend.day && !mine.some(s => s.action === 'refer')) {
    out.push({
      level: 'info',
      text: 'There are steps after the suspension that do not refer the debt. Chasing somebody whose service you have already stopped rarely recovers anything.',
    })
  }

  return out
}

/* ------------------------------------------------------------ the case --- */

/** Where a case actually is, and what happens next. */
export function nextStep(c: Case, steps: readonly Step[]): Step | null {
  const mine = stepsOn(c.ladder_id ?? '', steps)
  return mine.find(s => s.step_no === c.step + 1) ?? null
}

export function currentStep(c: Case, steps: readonly Step[]): Step | null {
  return stepsOn(c.ladder_id ?? '', steps).find(s => s.step_no === c.step) ?? null
}

/**
 * When the next step is due, in days from now.
 *
 * A promise to pay pauses the ladder where it stands — that is what "pause"
 * means, and resuming from the start would punish somebody for having
 * negotiated. Negative means overdue: the step should already have fired.
 */
export function dueIn(c: Case, steps: readonly Step[], ladder: Ladder | null): number | null {
  if (ladder?.pause_on_promise && c.promise_to_pay) return null
  const next = nextStep(c, steps)
  return next ? next.day - c.age_days : null
}

export function caseState(c: Case, steps: readonly Step[], ladder: Ladder | null): string {
  if (c.status !== 'active') return c.status
  if (ladder?.pause_on_promise && c.promise_to_pay) return 'paused on a promise to pay'
  const due = dueIn(c, steps, ladder)
  if (due === null) return 'at the end of the ladder'
  if (due < 0) return `${Math.abs(due)} day${Math.abs(due) === 1 ? '' : 's'} overdue for the next step`
  if (due === 0) return 'next step due today'
  return `next step in ${due} day${due === 1 ? '' : 's'}`
}

/** Whether this account is heading for a cut-off, and when. */
export function suspendsOn(c: Case, ladder: Ladder | null): number | null {
  if (!ladder || ladder.suspend_on_day === null) return null
  return ladder.suspend_on_day - c.age_days
}

export const TIERS: Record<Audience, { id: string; label: string }[]> = {
  consumer: [
    { id: 'bronze', label: 'Bronze' },
    { id: 'silver', label: 'Silver' },
    { id: 'gold', label: 'Gold' },
    { id: 'platinum', label: 'Platinum' },
  ],
  enterprise: [
    { id: 'org-bronze', label: 'Registered' },
    { id: 'org-silver', label: 'Business' },
    { id: 'org-gold', label: 'Business Plus' },
    { id: 'org-platinum', label: 'Strategic' },
  ],
  partner: [
    { id: 'bronze', label: 'Bronze' },
    { id: 'silver', label: 'Silver' },
    { id: 'gold', label: 'Gold' },
    { id: 'platinum', label: 'Platinum' },
  ],
}

export function tierLabel(audience: Audience, tier: string | null): string {
  if (!tier) return 'Every account'
  return TIERS[audience]?.find(t => t.id === tier)?.label ?? tier
}

export const AUDIENCE_LABEL: Record<Audience, string> = {
  consumer: 'Retail customers',
  enterprise: 'Business accounts',
  partner: 'Sellers',
}
