// How an enquiry list is cut and ordered, as pure functions, so the three
// consoles (buyer, seller, operator) agree on what "waiting on you" means.
// No supabase import: it must stay testable in Node.

import { waitingOn, enquiryState, isTerminal } from './enquiries'
import type { Enquiry, EnquiryLine, EnquiryType, Role } from './enquiries'

export type Chip = 'all' | 'mine' | 'theirs' | 'closed'
export type TypeFilter = EnquiryType | 'all'

export const CHIPS: readonly { id: Chip; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'mine', label: 'Waiting on you' },
  { id: 'theirs', label: 'Waiting on them' },
  { id: 'closed', label: 'Closed' },
]

export const TYPE_LABEL: Record<EnquiryType, string> = {
  quote: 'Quote', demo: 'Demo', sales: 'Sales',
}

const CLOSED = new Set(['accepted', 'declined', 'withdrawn', 'done', 'closed'])

/** Finished: nothing more can happen to it. */
export function isClosed(e: Pick<Enquiry, 'status'>): boolean {
  return CLOSED.has(e.status)
}

/** Which chip an enquiry falls under for this role. The three non-"all" chips
    partition the list. A scheduled demo is waiting on nobody by `waitingOn`,
    but its next step is the responder's (mark it done), so it is the
    responder's to act on and the buyer's to wait for. */
export function bandOf(e: Enquiry, role: Role, today: string): Exclude<Chip, 'all'> {
  if (isClosed(e)) return 'closed'
  const side = role === 'buyer' ? 'buyer' : 'responder'
  const w = waitingOn(e, today)
  if (w === side) return 'mine'
  if (e.status === 'scheduled' && side === 'responder') return 'mine'
  return 'theirs'
}

export function chipCounts(enquiries: readonly Enquiry[], role: Role, today: string): Record<Chip, number> {
  const out: Record<Chip, number> = { all: enquiries.length, mine: 0, theirs: 0, closed: 0 }
  for (const e of enquiries) out[bandOf(e, role, today)]++
  return out
}

/** Filtered by chip, type and words; waiting-on-you first, then the most
    recently changed. `names` lets the search reach who answers. */
export function filterEnquiries(
  enquiries: readonly Enquiry[],
  f: { chip: Chip; type: TypeFilter; query: string },
  role: Role, today: string,
  names: (e: Enquiry) => string = () => '',
): Enquiry[] {
  const q = f.query.trim().toLowerCase()
  const rank = (e: Enquiry) => ({ mine: 0, theirs: 1, closed: 2 })[bandOf(e, role, today)]
  return enquiries
    .filter(e => f.chip === 'all' || bandOf(e, role, today) === f.chip)
    .filter(e => f.type === 'all' || e.type === f.type)
    .filter(e => !q || [e.subject, e.id, names(e), enquiryState(e, today), TYPE_LABEL[e.type]]
      .some(s => s.toLowerCase().includes(q)))
    .slice()
    .sort((a, b) => rank(a) - rank(b) || (b.updated_at < a.updated_at ? -1 : b.updated_at > a.updated_at ? 1 : 0))
}

/** Still open and untouched for more than `days` days: the operator's age
    filter. A finished enquiry is waiting on nobody, however old it is, so it
    never counts. `days` of 0 or less lets everything through. */
export function waitingOver(e: Pick<Enquiry, 'type' | 'status' | 'updated_at'>, days: number, now: number): boolean {
  if (days <= 0) return true
  if (isTerminal(e.type, e.status)) return false
  return now - Date.parse(e.updated_at) > days * 86_400_000
}

/** Who answers it, in words. */
export function answererName(e: Pick<Enquiry, 'partner_id'>, partnerNames: ReadonlyMap<string, string>): string {
  if (e.partner_id === null) return 'Marketplace desk'
  return partnerNames.get(e.partner_id) ?? e.partner_id
}

/** Quote lines already on a requisition that is still live (pending or
    approved), each mapped to that requisition's id. guard_quoted_line refuses
    a second live requisition line for the same quote line, so the screen must
    not offer one. `quote_line_id` is read loosely because the column arrives
    with the enquiries migration and older rows do not have it. */
export function liveQuoteLineIds(
  requisitions: readonly { id: string; state: string }[],
  lines: readonly { requisition_id: string; quote_line_id?: string | null }[],
): Map<string, string> {
  const live = new Set(requisitions.filter(r => r.state === 'pending' || r.state === 'approved').map(r => r.id))
  const out = new Map<string, string>()
  for (const l of lines) {
    if (l.quote_line_id && live.has(l.requisition_id) && !out.has(l.quote_line_id)) out.set(l.quote_line_id, l.requisition_id)
  }
  return out
}

export type QuoteStanding =
  | { kind: 'none' }
  | { kind: 'add'; lineIds: string[] }
  | { kind: 'held'; requisitionId: string }

/** What an accepted quote can still do for the buyer's requisition.
    `add`: these lines can go in (not in the basket, not on a live requisition).
    `held`: nothing left to add, and some of it is on that live requisition.
    `none`: not an accepted, unexpired quote this buyer may requisition, or
    everything is already in the basket. */
export function acceptedQuoteStanding(
  e: Pick<Enquiry, 'id' | 'type' | 'status' | 'valid_until'>,
  lines: readonly Pick<EnquiryLine, 'id' | 'enquiry_id'>[],
  today: string, canRaise: boolean,
  inBasket: ReadonlySet<string>, live: ReadonlyMap<string, string>,
): QuoteStanding {
  if (e.type !== 'quote' || e.status !== 'accepted' || !canRaise) return { kind: 'none' }
  if (e.valid_until !== null && e.valid_until < today) return { kind: 'none' }
  const mine = lines.filter(l => l.enquiry_id === e.id)
  if (!mine.length) return { kind: 'none' }
  const left = mine.filter(l => !inBasket.has(l.id) && !live.has(l.id)).map(l => l.id)
  if (left.length) return { kind: 'add', lineIds: left }
  const held = mine.find(l => live.has(l.id))
  return held ? { kind: 'held', requisitionId: live.get(held.id)! } : { kind: 'none' }
}

/** Whether the quote's lines differ, in what was quoted, between what the
    buyer was looking at and what the database now holds. */
export function quoteChanged(
  seen: readonly Pick<EnquiryLine, 'id' | 'quantity' | 'quoted_unit_price'>[],
  now: readonly Pick<EnquiryLine, 'id' | 'quantity' | 'quoted_unit_price'>[],
): boolean {
  if (seen.length !== now.length) return true
  const by = new Map(now.map(l => [l.id, l]))
  return seen.some(s => {
    const n = by.get(s.id)
    return !n || n.quantity !== s.quantity || n.quoted_unit_price !== s.quoted_unit_price
  })
}

/** The datetime-local value a person typed, as an ISO instant; null when it is not a time. */
export function localToIso(value: string): string | null {
  if (!value) return null
  const t = Date.parse(value)
  return Number.isNaN(t) ? null : new Date(t).toISOString()
}

/** What a basket line needs from the catalogue that a quote line does not carry. */
export interface QuotedProduct { id: string; seller: string; model: string; category_id: string; unit: string | null }

/** A basket line built from an accepted quote line, with the quantity it was quoted at. */
export interface QuotedBasketLine {
  product_id: string; name: string; seller: string; partner_id: string | null
  unit_price: number; model: 'oneoff' | 'monthly'; vertical: string; unit: string | null
  quote_line_id: string; quantity: number
}

/** The accepted quote's own lines (product, name, seller, quantity, quoted
    price, quote line) as basket lines. The product's seller name, model,
    vertical and unit are read by id, whatever the listing's status: a paused
    listing's quote is still good, and guard_quoted_line is what decides
    whether a quoted line may be raised. A product that could not be read is
    named in `unread` rather than dropped. */
export function quotedBasketLines(
  quoted: readonly { product_id: string; name: string; partner_id: string | null; quantity: number; unit_price: number; quote_line_id: string }[],
  products: ReadonlyMap<string, QuotedProduct>,
): { lines: QuotedBasketLine[]; unread: string[] } {
  const lines: QuotedBasketLine[] = []
  const unread: string[] = []
  for (const q of quoted) {
    const p = products.get(q.product_id)
    if (!p) {
      unread.push(`${q.name} (${q.product_id}) could not be read from the catalogue, so it was not added.`)
      continue
    }
    lines.push({
      product_id: q.product_id, name: q.name, seller: p.seller, partner_id: q.partner_id,
      unit_price: q.unit_price, model: p.model === 'monthly' ? 'monthly' : 'oneoff',
      vertical: p.category_id, unit: p.unit, quote_line_id: q.quote_line_id, quantity: q.quantity,
    })
  }
  return { lines, unread }
}

/** Why a quote's lines cannot join the requisition being built, or null when
    they can (it is empty, or in the quote's currency). A requisition is in one
    currency, so a basket in another has to be raised or emptied first; the
    accepted quote keeps its price meanwhile. */
export function quoteBasketClash(
  basket: { currency: string; lines: readonly unknown[] }, quoteCurrency: string, until: string | null,
): string | null {
  if (!basket.lines.length || basket.currency === quoteCurrency) return null
  const holds = until ? ` The quote keeps its price until ${until}.` : ''
  return `Your requisition is priced in ${basket.currency} and this quote is in ${quoteCurrency}. A requisition is settled in one currency, so raise or empty the one you have, then come back and use Add to requisition.${holds}`
}
