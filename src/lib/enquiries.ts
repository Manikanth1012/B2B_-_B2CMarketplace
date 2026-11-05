// The rules of an enquiry, as pure functions. The database enforces the same
// rules in its triggers (guard_enquiry, guard_quoted_line); this module mirrors
// them so a screen never offers what the database would refuse. No supabase
// import here: it must stay testable in Node.
//
// Dates are 'YYYY-MM-DD' strings compared lexically; timestamps are ISO strings.

export type EnquiryType = 'quote' | 'demo' | 'sales'
export type QuoteStatus = 'submitted' | 'quoted' | 'accepted' | 'declined' | 'withdrawn'
export type DemoStatus = 'requested' | 'scheduled' | 'done' | 'declined' | 'withdrawn'
export type SalesStatus = 'open' | 'answered' | 'closed'
export type EnquiryStatus = QuoteStatus | DemoStatus | SalesStatus
export type Role = 'buyer' | 'responder' | 'operator'   // operator may also act as responder on desk-routed rows
export type Waiting = 'buyer' | 'responder' | 'nobody'

export interface Enquiry {
  id: string; type: EnquiryType; account_id: string; raised_by: string
  partner_id: string | null; subject: string; status: EnquiryStatus
  currency: string | null; needed_by: string | null; valid_until: string | null
  format: 'video' | 'onsite' | null; attendees: number | null
  contact_pref: 'email' | 'phone' | 'in_app' | null; decline_reason: string | null
  created_at: string; updated_at: string; decided_at: string | null
}
export interface EnquiryLine {
  id: string; enquiry_id: string; product_id: string; name: string; partner_id: string | null
  quantity: number; target_unit_price: number | null; quoted_unit_price: number | null; sort_order: number
}
export interface EnquirySlot { id: string; enquiry_id: string; starts_at: string; proposed_by: 'buyer' | 'responder'; confirmed: boolean; location: string | null }
export interface EnquiryMessage { id: string; enquiry_id: string; author_role: 'buyer' | 'partner' | 'operator'; author_name: string; body: string; created_at: string }
export type Action = 'quote' | 'requote' | 'accept' | 'decline' | 'withdraw' | 'confirm-slot' | 'propose-slot' | 'mark-done' | 'reply' | 'close' | 'reassign'

const TERMINAL: Record<EnquiryType, readonly EnquiryStatus[]> = {
  quote: ['accepted', 'declined', 'withdrawn'],
  demo: ['done', 'declined', 'withdrawn'],
  sales: ['closed'],
}
/** Finished: accepted, declined, withdrawn, done or closed, as its type has it. */
export const isTerminal = (type: EnquiryType, status: EnquiryStatus) => TERMINAL[type].includes(status)

/** The seller an enquiry goes to: the one partner all lines share, else null (the operator desk). */
export function routeTo(lines: readonly { partner_id: string | null }[]): string | null {
  if (lines.length === 0) return null
  const first = lines[0].partner_id
  if (first === null) return null
  return lines.every(l => l.partner_id === first) ? first : null
}

// Transition table (spec §1). Each row: who may move from -> to. The operator
// may do what a responder does; whether it is their row to answer (desk) is
// decided by nextActions and, finally, the database.
type Mover = 'buyer' | 'responder' | 'either'
const TRANSITIONS: Record<EnquiryType, readonly [EnquiryStatus, EnquiryStatus, Mover][]> = {
  quote: [
    ['submitted', 'quoted', 'responder'],
    ['quoted', 'quoted', 'responder'],           // re-quote with a new valid_until
    ['submitted', 'declined', 'responder'],
    ['quoted', 'declined', 'responder'],
    ['quoted', 'accepted', 'buyer'],
    ['quoted', 'declined', 'buyer'],
    ['submitted', 'withdrawn', 'buyer'],
    ['quoted', 'withdrawn', 'buyer'],
  ],
  demo: [
    ['requested', 'scheduled', 'either'],        // whoever did not propose the slot confirms it
    ['requested', 'declined', 'responder'],
    ['scheduled', 'declined', 'responder'],
    ['requested', 'withdrawn', 'buyer'],
    ['scheduled', 'withdrawn', 'buyer'],
    ['scheduled', 'done', 'responder'],
  ],
  sales: [
    ['open', 'answered', 'responder'],
    ['answered', 'open', 'buyer'],
    ['open', 'closed', 'either'],
    ['answered', 'closed', 'either'],
  ],
}

export function canTransition(type: EnquiryType, from: EnquiryStatus, to: EnquiryStatus, role: Role): boolean {
  return TRANSITIONS[type].some(([f, t, who]) => {
    if (f !== from || t !== to) return false
    if (who === 'either') return true
    return who === 'buyer' ? role === 'buyer' : role === 'responder' || role === 'operator'
  })
}

export function isExpired(e: Pick<Enquiry, 'type' | 'status' | 'valid_until'>, today: string): boolean {
  return e.type === 'quote' && e.status === 'quoted' && e.valid_until !== null && e.valid_until < today
}

export function enquiryState(e: Enquiry, today: string): EnquiryStatus | 'expired' {
  return isExpired(e, today) ? 'expired' : e.status
}

export function waitingOn(e: Enquiry, today: string): Waiting {
  if (isTerminal(e.type, e.status)) return 'nobody'
  if (isExpired(e, today)) return 'responder'   // the seller has to re-quote
  switch (e.status) {
    case 'submitted': case 'requested': case 'open': return 'responder'
    case 'quoted': case 'answered': return 'buyer'
    default: return 'nobody'                    // scheduled
  }
}

function responderActions(e: Enquiry): Action[] {
  switch (e.type) {
    case 'quote':
      return e.status === 'submitted' ? ['quote', 'decline', 'reply'] : ['requote', 'decline', 'reply']
    case 'demo':
      return e.status === 'requested'
        ? ['confirm-slot', 'propose-slot', 'decline', 'reply']
        : ['mark-done', 'decline', 'reply']
    case 'sales':
      return ['reply', 'close']
  }
}

function buyerActions(e: Enquiry, today: string, canRaise: boolean, slots: readonly Pick<EnquirySlot, 'proposed_by' | 'confirmed' | 'starts_at'>[]): Action[] {
  switch (e.type) {
    case 'quote':
      if (e.status === 'quoted' && canRaise) {
        return isExpired(e, today) ? ['decline', 'withdraw', 'reply'] : ['accept', 'decline', 'withdraw', 'reply']
      }
      return ['withdraw', 'reply']
    case 'demo': {
      // While requested, the buyer confirms a time the seller proposed (-> scheduled) or
      // suggests another. Once scheduled, the time is fixed: withdraw or talk it through.
      if (e.status !== 'requested') return ['withdraw', 'reply']
      const open = slots.filter(s => !s.confirmed)
      const latest = open[open.length - 1]
      const confirm: Action[] = latest?.proposed_by === 'responder' ? ['confirm-slot'] : []
      return [...confirm, 'propose-slot', 'withdraw', 'reply']
    }
    case 'sales':
      return ['reply', 'close']
  }
}

type SlotLike = Pick<EnquirySlot, 'proposed_by' | 'confirmed' | 'starts_at'>

export function nextActions(e: Enquiry, role: Role, today: string, opts: { canRaise?: boolean; isDesk?: boolean; slots?: readonly SlotLike[] } = {}): Action[] {
  if (isTerminal(e.type, e.status)) return []
  if (role === 'buyer') return buyerActions(e, today, !!opts.canRaise, opts.slots ?? [])
  if (role === 'responder') return responderActions(e)
  // operator: answers desk-routed rows like a responder; on a seller's row only oversees
  return opts.isDesk ? [...responderActions(e), 'reassign'] : ['reassign', 'reply']
}

const cents = (n: number) => Math.round(n * 100) / 100

export function quoteTotals(lines: readonly EnquiryLine[]): { lines: { id: string; total: number }[]; total: number } | null {
  if (lines.length === 0) return null
  const out: { id: string; total: number }[] = []
  for (const l of lines) {
    if (l.quoted_unit_price === null) return null
    out.push({ id: l.id, total: cents(l.quoted_unit_price * l.quantity) })
  }
  return { lines: out, total: cents(out.reduce((s, l) => s + l.total, 0)) }
}

const DAY = 86_400_000
const dayNumber = (d: string) => (/^\d{4}-\d{2}-\d{2}$/.test(d) ? Date.parse(d + 'T00:00:00Z') / DAY : NaN)

/** null = ok. A quote must stay open between 1 and 90 days from today. */
export function validUntilProblem(date: string, today: string): string | null {
  const d = dayNumber(date), t = dayNumber(today)
  if (Number.isNaN(d) || Number.isNaN(t)) return 'Choose a valid-until date.'
  const ahead = d - t
  if (ahead < 1) return 'The quote must be valid until a future date.'
  if (ahead > 90) return 'A quote can be valid for at most 90 days.'
  return null
}

/** null = ok. A demo request offers 1 to 3 future slots; at most one is confirmed. */
export function slotProblems(slots: readonly { starts_at: string; confirmed: boolean }[], nowIso: string): string | null {
  if (slots.length < 1) return 'Propose at least one time.'
  if (slots.length > 3) return 'Propose at most three times.'
  const now = Date.parse(nowIso)
  if (slots.some(s => !(Date.parse(s.starts_at) > now))) return 'Every proposed time must be in the future.'
  if (slots.filter(s => s.confirmed).length > 1) return 'Only one time can be confirmed.'
  return null
}

export function demoOffered(p: { model: string; category_id: string }): boolean {
  return p.model !== 'oneoff' || ['iot', 'security'].includes(p.category_id)
}

/** Today in the browser's own calendar, as YYYY-MM-DD. */
export function localToday(): string {
  const n = new Date()
  const p = (x: number) => String(x).padStart(2, '0')
  return `${n.getFullYear()}-${p(n.getMonth() + 1)}-${p(n.getDate())}`
}

/** The accepted quote as requisition lines at the quoted prices. Throws unless it is an accepted, unexpired quote with every line priced. */
export function toRequisitionLines(e: Enquiry, lines: readonly EnquiryLine[], today: string = localToday()): {
  product_id: string; name: string; partner_id: string | null; quantity: number; unit_price: number; quote_line_id: string
}[] {
  if (e.type !== 'quote' || e.status !== 'accepted') throw new Error('Only an accepted quote can be added to a requisition.')
  if (e.valid_until !== null && e.valid_until < today) throw new Error('This quote has expired.')
  if (lines.length === 0) throw new Error('This quote has no lines.')
  return lines.map(l => {
    if (l.quoted_unit_price === null) throw new Error('This quote has an unpriced line.')
    return { product_id: l.product_id, name: l.name, partner_id: l.partner_id, quantity: l.quantity, unit_price: l.quoted_unit_price, quote_line_id: l.id }
  })
}
