/* The only module that reads or writes the shared support queue.
   Rules live in support.ts so they can be tested without a network.

   Nothing here sets an SLA field. `guard_ticket` overwrites every one of them
   from `support_sla` on write, because a queue whose requesters can edit the
   numbers it is measured on is not a measurement. */

import { supabase } from './supabase'
import { validateTicket, validateReply, validateResolution, priorityFor } from './support'
import type { Ticket, Sla, Category, Check, TicketMessage } from './support'

export type Result = Check

/* Raising a ticket returns the id it was raised as. Files can only be attached
   once the ticket exists, so the caller needs the id it just created rather
   than a fresh query that could pick up somebody else's. */
export type RaiseResult =
  | { ok: true; note?: string; ticket_id: string }
  | { ok: false; reason: string }

export interface SupportBook {
  tickets: Ticket[]
  sla: Sla[]
  categories: Category[]
  loadError?: string
}

const EMPTY: SupportBook = { tickets: [], sla: [], categories: [] }

/** Everything one persona can see. RLS does the scoping — an account's select
    returns that account's tickets whatever is asked for. */
export async function loadSupport(): Promise<SupportBook> {
  const [t, s, c] = await Promise.all([
    supabase.from('support_tickets').select('*').order('opened_at', { ascending: false }),
    supabase.from('support_sla').select('*').order('sort_order'),
    supabase.from('support_categories').select('*').order('sort_order'),
  ])
  const errors: string[] = []
  const grab = <T>(res: { data: unknown; error: { message: string } | null }, what: string): T[] => {
    if (res.error) errors.push(`${what}: ${res.error.message}`)
    return (res.data ?? []) as T[]
  }
  return {
    tickets: grab<Ticket>(t, 'tickets'),
    sla: grab<Sla>(s, 'the SLA policy'),
    categories: grab<Category>(c, 'categories'),
    ...(errors.length ? { loadError: `Some of this did not load (${errors.join('; ')}).` } : {}),
  }
}

const REFUSED = 'Nothing changed — you are not allowed to make that change.'

export interface TicketDraft {
  subject: string
  category: string
  note: string
  ref: string | null
}

/**
 * Raising one.
 *
 * The priority comes from the category rather than from the requester. Letting
 * people set their own would make everything a P1 within a week, and then the
 * queue would need a second, secret priority to work from.
 */
export async function raiseTicket(
  { draft, book, persona, raisedBy, org, accountId, partnerId, memberId, channel }: {
    draft: TicketDraft
    book: SupportBook
    persona: string
    raisedBy: string
    org: string
    accountId?: string | null
    /* Set for a seller's ticket. Without it the row is readable by the one
       person who raised it and by nobody else at that company — which is not
       what `partner_support_tickets` was written to allow, and meant a
       colleague picking the thread up could not see it. */
    partnerId?: string | null
    memberId?: string | null
    channel: string
  },
): Promise<RaiseResult> {
  const check = validateTicket(draft)
  if (!check.ok) return check

  const priority = priorityFor(draft.category, book.categories)
  const { data: session } = await supabase.auth.getUser()
  const when = stamp(new Date())

  /* Named before the insert, because the caller uploads any attachments
     against this id as soon as the row lands. */
  const ticketId = `SUP-${Math.floor(Date.now() / 1000).toString().slice(-6)}`

  const { error } = await supabase.from('support_tickets').insert({
    id: ticketId,
    subject: draft.subject.trim(),
    category: draft.category,
    priority,
    status: 'new',
    persona,
    org,
    opened_by: raisedBy,
    owner: null,
    /* sla_mins, breached, escalated and the response clocks are all set by the
       database from `support_sla`. Anything sent here for them is discarded. */
    sla_mins: 0,
    breached: false,
    escalated: false,
    /* Passed as an array, not JSON.stringify'd. `messages` is jsonb — handing
       it a string stores a jsonb string containing JSON, and everything
       downstream then reads its length in characters. */
    messages: [{ who: raisedBy, text: draft.note.trim(), when }],
    account_id: accountId ?? null,
    partner_id: partnerId ?? null,
    user_id: accountId ? null : session.user?.id ?? null,
    raised_by_member: memberId ?? null,
    ref: draft.ref,
    channel,
    sort_order: 0,
  })
  if (error) return { ok: false, reason: friendly(error.message) }

  const target = book.sla.find(s => s.priority === priority)
  return {
    ok: true,
    ticket_id: ticketId,
    note: `Raised as ${priority}. ${target ? `Somebody answers within ${Math.round(target.respond_mins / 60)} hours` : 'Somebody will answer shortly'}, and it is resolved or escalated inside the target.`,
  }
}

/** Adding to the thread. Replying is what clears "waiting on you" — the
    database banks the paused time at the same moment, so the pause cannot be
    left running by somebody who forgot to un-tick a box. */
export async function replyToTicket(ticket: Ticket, text: string, who: string): Promise<Result> {
  const check = validateReply(text)
  if (!check.ok) return check

  const messages: TicketMessage[] = [
    ...ticket.messages,
    { who, text: text.trim(), when: stamp(new Date()) },
  ]
  const { data, error } = await supabase.from('support_tickets')
    .update({ messages })
    .eq('id', ticket.id).select('id')
  if (error) return { ok: false, reason: friendly(error.message) }
  if (!data?.length) return { ok: false, reason: REFUSED }
  return {
    ok: true,
    note: ticket.waiting_on_customer
      ? 'Sent — the ball is back with the marketplace and the clock has restarted.'
      : 'Sent.',
  }
}

/** Accepting the resolution. A requester can close their own ticket; they
    cannot mark it resolved without saying what resolved it, because that is
    the only part of the record anybody reads afterwards. */
export async function closeTicket(ticket: Ticket, note: string, who: string): Promise<Result> {
  const check = validateResolution(note)
  if (!check.ok) return check

  const messages: TicketMessage[] = [
    ...ticket.messages,
    { who, text: note.trim(), when: stamp(new Date()) },
  ]
  const { data, error } = await supabase.from('support_tickets').update({
    status: 'resolved',
    resolution_note: note.trim(),
    messages,
  }).eq('id', ticket.id).select('id')
  if (error) return { ok: false, reason: friendly(error.message) }
  if (!data?.length) return { ok: false, reason: REFUSED }
  return { ok: true, note: `${ticket.id} closed. Reopening it means raising a new one, so nothing gets lost in an old thread.` }
}

function stamp(d: Date): string {
  return `${d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })} ${d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`
}

function friendly(message: string): string {
  const m = message.replace(/^.*?\bERROR:\s*/i, '').trim()
  if (/row-level security/i.test(m)) return 'You are not allowed to change that ticket.'
  if (/duplicate key/i.test(m)) return 'That already exists.'
  return m
}
