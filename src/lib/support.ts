/* The support queue, shared by every persona. No React and no Supabase.

   The thing that makes an SLA honest is the waiting clock: time spent waiting
   on the requester does not count against the resolution target. Without that
   exclusion the queue metric stops measuring support and starts measuring how
   quickly customers reply, and every desk learns to close tickets rather than
   answer them. Everything here works in "worked minutes" for that reason. */

export type TicketState = 'new' | 'open' | 'waiting' | 'escalated' | 'resolved' | 'closed'
export type Priority = 'P1' | 'P2' | 'P3' | 'P4'

export interface Sla {
  priority: Priority
  label: string
  meaning: string
  respond_mins: number
  resolve_mins: number
  /* How long the person who raised it gets to say whether it really is fixed,
     before the window runs out and it closes itself. */
  confirm_days: number
  priority_queue_multiplier: number
  sort_order: number
}

export interface Category {
  id: string
  label: string
  personas: string[]
  hint: string
  default_priority: Priority
  sort_order: number
}

export interface TicketMessage { who: string; text: string; when: string }

export interface Ticket {
  id: string
  subject: string
  category: string
  priority: Priority
  status: TicketState
  persona: string
  org: string | null
  opened_by: string
  owner: string | null
  opened_at: string
  sla_mins: number
  response_mins: number | null
  first_response_mins: number | null
  resolution_mins: number | null
  breached: boolean
  escalated: boolean
  escalated_at: string | null
  waiting_on_customer: boolean
  waiting_minutes: number
  waiting_since: string | null
  resolved_at: string | null
  resolution_note: string | null
  /* The consent record. 'resolved' means the desk believes it is fixed and is
     waiting to be told; 'closed' means the person who raised it agreed, or the
     window ran out. These four columns are what tells those two apart. */
  confirm_due: string | null
  confirmed_by: string | null
  confirmed_at: string | null
  closed_how: CloseKind | null
  reopened: number
  messages: TicketMessage[]
  account_id: string | null
  partner_id: string | null
  user_id: string | null
  raised_by_member: string | null
  ref: string | null
  channel: string | null
  sort_order: number
}

export type Check = { ok: true; note?: string } | { ok: false; reason: string }

export const OPEN_STATES: TicketState[] = ['new', 'open', 'waiting', 'escalated']

export const STATE_LABEL: Record<TicketState, string> = {
  new: 'New',
  open: 'Being worked on',
  waiting: 'Waiting on you',
  escalated: 'Escalated',
  resolved: 'Fixed — waiting on you',
  closed: 'Closed',
}

/* How a ticket came to be closed. Kept apart because "the customer agreed" and
   "nobody answered" are not the same fact, and a desk measured on the total of
   both will always find the second one easier. */
export type CloseKind = 'confirmed' | 'offline' | 'auto'

export const CLOSE_LABEL: Record<CloseKind, string> = {
  confirmed: 'Confirmed by the person who raised it',
  offline: 'Agreement recorded by the desk',
  auto: 'Closed automatically — nobody answered',
}

export function isOpen(t: Ticket): boolean {
  return OPEN_STATES.includes(t.status)
}

/* ----------------------------------------------------------- the clock -- */

const MIN = 60000

/**
 * Minutes of our time on a ticket: elapsed, less anything spent waiting on the
 * requester.
 *
 * A ticket that sat with the customer for a week is not a ticket the desk took
 * a week over. Counting it that way makes the queue look bad for something
 * outside its control, which is how a support team ends up chasing the metric
 * by closing tickets instead of answering them.
 */
export function workedMinutes(t: Ticket, now: Date): number {
  const start = Date.parse(t.opened_at)
  if (Number.isNaN(start)) return 0
  const end = t.resolved_at ? Date.parse(t.resolved_at) : now.getTime()
  const elapsed = Math.max(0, Math.floor((end - start) / MIN))
  /* Anything still paused right now counts as paused. */
  const pausedNow = t.waiting_on_customer && t.waiting_since
    ? Math.max(0, Math.floor((now.getTime() - Date.parse(t.waiting_since)) / MIN))
    : 0
  return Math.max(0, elapsed - t.waiting_minutes - pausedNow)
}

export interface Standing {
  worked: number
  target: number
  left: number
  pct: number
  state: 'settled' | 'paused' | 'ok' | 'close' | 'over'
  text: string
}

/** Where a ticket stands against its resolution target, in words somebody can
    act on. "SLA: 480" is a number; "3 h 20 left, and the clock is paused"
    tells you whether to do anything. */
export function standing(t: Ticket, now: Date): Standing {
  const target = t.sla_mins
  const worked = workedMinutes(t, now)
  const left = target - worked
  const pct = target > 0 ? Math.min(999, Math.round((worked / target) * 100)) : 0

  if (t.status === 'resolved' || t.status === 'closed') {
    return {
      worked, target, left, pct, state: 'settled',
      text: `Resolved in ${duration(t.resolution_mins ?? worked)} of worked time.`,
    }
  }
  if (t.waiting_on_customer) {
    return {
      worked, target, left, pct, state: 'paused',
      text: `Waiting on you — the clock is paused with ${duration(Math.max(0, left))} left.`,
    }
  }
  if (left < 0) {
    return {
      worked, target, left, pct, state: 'over',
      text: `${duration(-left)} past the ${duration(target)} target.`,
    }
  }
  if (pct >= 75) {
    return { worked, target, left, pct, state: 'close', text: `${duration(left)} left of the ${duration(target)} target.` }
  }
  return { worked, target, left, pct, state: 'ok', text: `${duration(left)} left of the ${duration(target)} target.` }
}

/** Whether the resolution target has actually been missed. Read from the clock
    rather than from the stored flag, so a ticket that quietly went past it
    while nobody looked still shows as past it. */
export function pastTarget(t: Ticket, now: Date): boolean {
  return isOpen(t) && !t.waiting_on_customer && workedMinutes(t, now) > t.sla_mins
}

export function duration(mins: number): string {
  const m = Math.max(0, Math.round(mins))
  if (m < 60) return `${m} min`
  if (m < 1440) {
    const h = Math.floor(m / 60)
    const r = m % 60
    return r ? `${h} h ${r} min` : `${h} h`
  }
  const d = Math.floor(m / 1440)
  const h = Math.round((m % 1440) / 60)
  return h ? `${d} d ${h} h` : `${d} d`
}

/* ------------------------------------------------------------- the queue -- */

/** The order somebody should work it: what is past target, then what is
    closest to it, then everything that no longer needs a decision. Anything
    paused sinks, because the next move is not ours. */
export function queue(tickets: Ticket[], now: Date): Ticket[] {
  const rank = (t: Ticket): number => {
    if (!isOpen(t)) return 4
    if (t.waiting_on_customer) return 3
    if (pastTarget(t, now)) return 0
    if (standing(t, now).pct >= 75) return 1
    return 2
  }
  return [...tickets].sort((a, b) => {
    const d = rank(a) - rank(b)
    if (d !== 0) return d
    return standing(b, now).pct - standing(a, now).pct
  })
}

export function summarise(tickets: Ticket[], now: Date): {
  open: number; past: number; waiting: number; unassigned: number
  resolved: number; medianWorked: number | null
} {
  const open = tickets.filter(isOpen)
  const done = tickets.filter(t => !isOpen(t))
  const worked = done.map(t => t.resolution_mins ?? workedMinutes(t, now)).sort((a, b) => a - b)
  return {
    open: open.length,
    past: open.filter(t => pastTarget(t, now)).length,
    waiting: open.filter(t => t.waiting_on_customer).length,
    unassigned: open.filter(t => !t.owner).length,
    resolved: done.length,
    medianWorked: worked.length ? worked[Math.floor(worked.length / 2)] : null,
  }
}

/** Which kinds of problem this account keeps having. A queue grouped by
    category is the difference between "we raise a lot of tickets" and "we
    raise a lot of provisioning tickets". */
export function byCategory(tickets: Ticket[], categories: Category[], now: Date): {
  id: string; label: string; total: number; open: number; past: number
}[] {
  const m = new Map<string, { total: number; open: number; past: number }>()
  for (const t of tickets) {
    const row = m.get(t.category) ?? { total: 0, open: 0, past: 0 }
    row.total += 1
    if (isOpen(t)) row.open += 1
    if (pastTarget(t, now)) row.past += 1
    m.set(t.category, row)
  }
  return [...m.entries()]
    .map(([id, v]) => ({ id, label: categories.find(c => c.id === id)?.label ?? id, ...v }))
    .sort((a, b) => b.open - a.open || b.total - a.total)
}

/* ------------------------------------------------------------- raising --- */

export function categoriesFor(categories: Category[], persona: string): Category[] {
  return categories.filter(c => c.personas.includes(persona)).sort((a, b) => a.sort_order - b.sort_order)
}

export function priorityFor(category: string, categories: Category[]): Priority {
  return categories.find(c => c.id === category)?.default_priority ?? 'P3'
}

/** The response target this account is actually promised, tier discount and
    all. Quoting the standard one to an account that pays for a faster one is
    the sort of thing that gets noticed exactly once. */
export function respondTarget(priority: Priority, sla: Sla[], multiplier = 1): number {
  const row = sla.find(s => s.priority === priority)
  if (!row) return 480
  return Math.round(row.respond_mins * multiplier)
}

export function validateTicket(
  draft: { subject: string; category: string; note: string },
): Check {
  if (!draft.subject.trim()) return { ok: false, reason: 'Give it a subject somebody can triage without opening it' }
  if (!draft.category) return { ok: false, reason: 'Pick what it is about' }
  const words = draft.note.trim().split(/\s+/).filter(Boolean)
  if (words.length < 6) {
    return { ok: false, reason: 'A line or two on what is happening. The first person to read this has only what you write here.' }
  }
  return { ok: true }
}

export function validateReply(text: string): Check {
  return text.trim().length >= 2
    ? { ok: true }
    : { ok: false, reason: 'Write something before sending it' }
}

export function validateResolution(note: string): Check {
  return note.trim().length >= 4
    ? { ok: true }
    : { ok: false, reason: 'Say what resolved it — a ticket closed with no note is one somebody cleared from a queue' }
}

/** Who a reply is waiting on. The single most useful thing on a ticket row,
    and the thing a shared inbox otherwise makes everybody guess. */
export function waitingOn(t: Ticket): string {
  if (!isOpen(t)) return '—'
  if (t.waiting_on_customer) return 'You'
  if (t.status === 'new') return 'Nobody yet'
  return t.owner ?? 'The marketplace'
}

export function lastMessage(t: Ticket): TicketMessage | null {
  return t.messages.length ? t.messages[t.messages.length - 1] : null
}

/* ------------------------------------------- closing the loop, in words -- */

/**
 * Is this ticket sitting between the two rungs — the desk says fixed, the
 * person who raised it has not said anything?
 *
 * This is the state the queue never had. Everything the desk marked resolved
 * used to fall straight off the bottom of the list, so a ticket "resolved" by
 * clearing it from a queue looked exactly like one that fixed somebody's
 * problem.
 */
export function awaitingConfirmation(t: Ticket): boolean {
  return t.status === 'resolved'
}

export interface ConfirmWindow {
  /* Whole days left, rounded down — "1 day left" is a promise about the whole
     of tomorrow, so a window with 1.4 days on it reads as 1, not 2. */
  daysLeft: number
  hoursLeft: number
  lapsed: boolean
  text: string
}

/**
 * How long the requester has left to answer, and what to say about it.
 *
 * A lapsed window is not the same as a closed ticket. It means the ticket may
 * now be closed by the clock — somebody or something still has to do it, and
 * until then the requester can still confirm or reopen. Saying "closed" while
 * it is still answerable would be the same lie the old toast told.
 */
export function confirmWindow(t: Ticket, now: Date): ConfirmWindow | null {
  if (t.status !== 'resolved' || !t.confirm_due) return null
  const ms = Date.parse(t.confirm_due) - now.getTime()
  if (Number.isNaN(ms)) return null
  const hoursLeft = Math.floor(ms / 3600000)
  const daysLeft = Math.floor(hoursLeft / 24)

  if (ms <= 0) {
    return {
      daysLeft: 0, hoursLeft: 0, lapsed: true,
      text: 'The window to answer has run out, so this closes itself the next time the marketplace sweeps. You can still say it is not fixed.',
    }
  }
  const left = daysLeft >= 1
    ? `${daysLeft} day${daysLeft === 1 ? '' : 's'}`
    : `${Math.max(1, hoursLeft)} hour${hoursLeft === 1 ? '' : 's'}`
  return {
    daysLeft, hoursLeft, lapsed: false,
    text: `Tell us whether this is fixed. If we do not hear in ${left} it closes on its own.`,
  }
}

/**
 * Whether this signed-in party is the one whose word closes the ticket.
 *
 * Deliberately the company and not the person for an account or a seller: the
 * colleague who picks the thread up next week is rarely the one who raised it,
 * and a ticket only one person can confirm is a ticket that sits in 'resolved'
 * until the window runs out every time they are on leave.
 */
export function canConfirm(
  t: Ticket,
  me: { userId?: string | null; accountId?: string | null; partnerId?: string | null } | null,
): boolean {
  if (t.status !== 'resolved' || !me) return false
  if (t.user_id && me.userId && t.user_id === me.userId) return true
  if (t.account_id && me.accountId && t.account_id === me.accountId) return true
  if (t.partner_id && me.partnerId && t.partner_id === me.partnerId) return true
  return false
}

/**
 * What the desk is allowed to do with a ticket it has already resolved.
 *
 * Not "close it" — that is the requester's word. It may record an agreement
 * given somewhere this system cannot see, which has to name who gave it, or it
 * may wait. Once the window has run out it may also close it as unanswered,
 * which is a different and visibly worse outcome.
 */
export function deskOptions(t: Ticket, now: Date): { offline: boolean; auto: boolean } {
  if (t.status !== 'resolved') return { offline: false, auto: false }
  const w = confirmWindow(t, now)
  return { offline: true, auto: !!w?.lapsed }
}

/**
 * How a closed ticket closed, as a sentence, with the name where there is one.
 *
 * A closed ticket with no author is what this whole change exists to prevent,
 * so the one case with no name says so plainly rather than staying quiet.
 */
export function closedBecause(t: Ticket): string | null {
  if (t.status !== 'closed' || !t.closed_how) return null
  switch (t.closed_how) {
    case 'confirmed':
      return `${t.confirmed_by ?? t.opened_by} confirmed this was resolved.`
    case 'offline':
      return `${t.confirmed_by} agreed this was resolved, recorded by the desk.`
    default:
      return 'Closed automatically — the window to answer ran out with no reply.'
  }
}

/**
 * A ticket that has been sent back more than once.
 *
 * Worth surfacing on its own rather than folding into a resolution-time
 * average: two bounces is not a slow fix, it is a fix that was not one, and the
 * average hides exactly that.
 */
export function bounced(t: Ticket): boolean {
  return t.reopened >= 2
}

/** How many are waiting on the requester rather than on the desk, and how many
    of the closed ones nobody ever agreed to. The second number is the one worth
    watching: it is what a queue looks like when it is being cleared. */
export function consentSummary(tickets: readonly Ticket[]): {
  awaiting: number; confirmed: number; offline: number; auto: number; bounced: number
} {
  return {
    awaiting: tickets.filter(awaitingConfirmation).length,
    confirmed: tickets.filter(t => t.closed_how === 'confirmed').length,
    offline: tickets.filter(t => t.closed_how === 'offline').length,
    auto: tickets.filter(t => t.closed_how === 'auto').length,
    bounced: tickets.filter(bounced).length,
  }
}
