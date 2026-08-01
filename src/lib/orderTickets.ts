/* Raising a support ticket against an order, decided here rather than in the
   component. No React and no Supabase, so the rules can be tested directly. */

export interface TicketableOrder {
  order_ref: string
  status: string
  seller: string | null
}

/* An order that has been refunded or cancelled is concluded — there is nothing left
   to chase, and a refund dispute is its own flow (`consumer_refunds`), not a support
   ticket. Everything short of that is still live enough to have a problem worth
   raising, including a delivered one: "it arrived broken" is the single most common
   reason a customer contacts anybody. */
const CONCLUDED = new Set(['refunded', 'cancelled', 'canceled'])

export function canRaiseTicket(order: { status: string }): boolean {
  return !CONCLUDED.has(order.status.trim().toLowerCase())
}

/* The queue's own vocabulary — consumer_tickets.category. Offering free text would
   put a fifth category into a table that has four and a console that filters on them. */
/* The shared queue's own vocabulary — `support_categories.id`. It used to be
   four consumer-only words that the operator's queue did not recognise, so a
   ticket raised here arrived in a category the desk could not filter on. */
export const TICKET_CATEGORIES = ['delivery', 'service', 'billing', 'account'] as const
export type TicketCategory = typeof TICKET_CATEGORIES[number]

export interface TicketDraft {
  id: string
  ref: string
  subject: string
  category: TicketCategory
  priority: string
  status: string
  persona: string
  org: string
  opened_by: string
  channel: string
  owner: string | null
  sla_mins: number
  breached: boolean
  escalated: boolean
  messages: { who: string; text: string; when: string }[]
}

/* The response clock the marketplace commits to, by how much the customer is out of
   pocket in time. These match the seeded tickets: P2 is a four-hour promise, P3 a day,
   P4 three days. */
/* Mirrors `support_sla.resolve_mins`. */
const SLA_MINS: Record<string, number> = { P1: 240, P2: 480, P3: 1440, P4: 4320 }

/* Delivery problems on an order in flight are the time-critical ones; a billing
   question can wait a day. Nothing here is P1 — that is reserved for the operator's
   own incidents, not a single consumer order. */
const SEVERITY: Record<TicketCategory, string> = {
  delivery: 'P3',
  service: 'P2',
  billing: 'P2',
  account: 'P3',
}

const LABEL: Record<TicketCategory, string> = {
  delivery: 'Delivery problem',
  service: 'Service not working',
  billing: 'Billing query',
  account: 'Account or access',
}

export function label(category: TicketCategory): string {
  return LABEL[category] ?? 'Support request'
}

export function severityFor(category: TicketCategory): string {
  return SEVERITY[category] ?? 'P3'
}

export function slaFor(severity: string): number {
  return SLA_MINS[severity] ?? 1440
}

/** Is this note usable as a ticket? Whitespace is not a description of a problem. */
export function validateNote(note: string): { ok: true } | { ok: false; reason: string } {
  const trimmed = note.trim()
  if (trimmed.length === 0) return { ok: false, reason: 'Tell us what went wrong so we can help.' }
  if (trimmed.length < 10) return { ok: false, reason: 'A little more detail, please — at least a sentence.' }
  return { ok: true }
}

/**
 * Build the row. The subject names the order, because an agent picking this out of a
 * queue needs to know what it is about before opening it, and the customer's own
 * words become the first message rather than being flattened into the subject.
 */
export function buildTicket(
  order: TicketableOrder,
  category: TicketCategory,
  note: string,
  raisedBy: string,
  now: Date = new Date(),
): TicketDraft {
  const severity = severityFor(category)
  const stamp = `${now.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })} ${now
    .toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`

  return {
    /* Same shape as the seeded ids (TCK-59120). Time-based so two tickets raised in
       one session cannot collide on the primary key. */
    id: `TCK-${Date.now().toString().slice(-8)}`,
    ref: order.order_ref,
    subject: `${label(category)} on ${order.order_ref}`,
    category,
    priority: severity,
    /* Everything starts as new. The database refuses anything else — a ticket
       raised already open is one nobody has picked up but the queue thinks
       somebody has. */
    status: 'new',
    persona: 'consumer',
    org: 'Consumer',
    opened_by: raisedBy,
    channel: 'Self-care portal',
    /* Unassigned until the queue picks it up. Naming a team here would be inventing
       an assignment the marketplace has not made. */
    owner: null,
    sla_mins: slaFor(severity),
    breached: false,
    escalated: false,
    messages: [{ who: raisedBy, text: note.trim(), when: stamp }],
  }
}
