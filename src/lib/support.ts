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
  resolved: 'Resolved',
  closed: 'Closed',
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
