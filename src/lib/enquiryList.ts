// How an enquiry list is cut and ordered, as pure functions, so the three
// consoles (buyer, seller, operator) agree on what "waiting on you" means.
// No supabase import: it must stay testable in Node.

import { waitingOn, enquiryState } from './enquiries'
import type { Enquiry, EnquiryType, Role } from './enquiries'

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

/** Who answers it, in words. */
export function answererName(e: Pick<Enquiry, 'partner_id'>, partnerNames: ReadonlyMap<string, string>): string {
  if (e.partner_id === null) return 'Marketplace desk'
  return partnerNames.get(e.partner_id) ?? e.partner_id
}

/** The datetime-local value a person typed, as an ISO instant; null when it is not a time. */
export function localToIso(value: string): string | null {
  if (!value) return null
  const t = Date.parse(value)
  return Number.isNaN(t) ? null : new Date(t).toISOString()
}
