/* The enterprise buyer's account — approvals, refunds and billing.
   No React and no Supabase, so the rules can be tested without a network.

   The thing this module exists to keep honest is who may say yes. A threshold
   decides whether a purchase needs approving at all; a role decides who may do
   it; and separation of duties decides that it cannot be the person who asked.
   All three are checked here so a screen can explain a refusal in the buyer's
   own words, and again by a trigger in the database so the explanation cannot
   be skipped by talking to the API directly. */

export type Need = 'none' | 'finance' | 'it' | 'both'
export type ReqState = 'pending' | 'approved' | 'declined' | 'withdrawn'
/* A role used to be one of five fixed strings. It is a row on
   `enterprise_roles` now, per account, because the approval policy refers to
   roles by name — which makes them the company's configuration rather than
   our enum. What a role may do is read from that row (see enterpriseAdmin.ts),
   never from a union here. */
export type Role = string
export type InvoiceStatus = 'open' | 'overdue' | 'paid' | 'disputed' | 'credited'
export type SubStatus = 'active' | 'suspended' | 'cancelled'

export interface Account {
  id: string
  company: string
  legal_name: string
  segment: 'large' | 'mid' | 'small'
  industry: string
  sites: number
  staff: number
  terms: string
  currency: string
  fy_starts: string
  budget_year: number
  reg_type: string
  registration: string | null
  place_of_supply: string
  po_required: boolean
  reverse_charge: boolean
  cost_centre_on_invoice: boolean
  tax_exempt: boolean
  exempt_cert: string | null
  status: string
}

export interface Member {
  id: string
  account_id: string
  user_id: string | null
  name: string
  email: string
  title: string
  role: Role
  can_raise: boolean
  approves_finance: boolean
  approves_it: boolean
  approve_limit: number | null
  cost_centre: string | null
  phone: string | null
  mfa: boolean
  status: 'active' | 'invited' | 'suspended' | 'removed'
  sort_order: number
}

export interface CostCentre {
  id: string
  account_id: string
  name: string
  owner: string
  quarter: string
  cap_quarter: number
  spent_quarter: number
  status: string
  sort_order: number
}

export interface Policy {
  account_id: string
  threshold: number
  security_signoff: boolean
  duplicate_flag: boolean
  auto_approve_renewals: boolean
  self_approve: boolean
  note: string
  updated_by: string | null
  updated_on: string | null
}

export interface Requisition {
  id: string
  account_id: string
  raised_by: string
  raised_on: string
  raised_at: string
  title: string
  vertical: string
  cost_centre: string | null
  amount: number
  model: 'oneoff' | 'monthly'
  reason: string
  need: Need
  policy_note: string
  state: ReqState
  decided_by: string | null
  decided_on: string | null
  decision_note: string | null
  order_ref: string | null
  po_ref: string | null
  sort_order: number
}

export interface ReqLine {
  id: string
  requisition_id: string
  product_id: string | null
  name: string
  seller: string
  partner_id: string | null
  quantity: number
  unit_price: number
  line_total: number
  sort_order: number
}

export interface Subscription {
  id: string
  account_id: string
  product_id: string | null
  name: string
  seller: string
  partner_id: string | null
  vertical: string
  quantity: number
  seats_used: number
  unit_price: number
  unit: string
  monthly: number
  cost_centre: string | null
  started: string
  renews: string
  status: SubStatus
  auto_renew: boolean
  contract_ref: string | null
  why_suspended: string | null
  sort_order: number
}

export interface Invoice {
  id: string
  account_id: string
  period: string
  kind: 'recurring' | 'oneoff'
  issued: string
  due: string
  recurring: number
  oneoff: number
  tax_rate: number
  tax: number
  total: number
  status: InvoiceStatus
  paid_on: string | null
  po_ref: string | null
  note: string | null
  sort_order: number
}

export interface InvoiceLine {
  id: string
  invoice_id: string
  kind: 'subscription' | 'oneoff' | 'credit'
  description: string
  seller: string
  partner_id: string | null
  cost_centre: string | null
  subscription_id: string | null
  requisition_id: string | null
  quantity: number | null
  unit_price: number | null
  amount: number
  sort_order: number
}

export type Check = { ok: true; note?: string } | { ok: false; reason: string }

export const NEED_LABEL: Record<Need, string> = {
  none: 'No approval needed',
  finance: 'Finance approval',
  it: 'IT sign-off',
  both: 'Finance approval and IT sign-off',
}

/* ---------------------------------------------------------------- policy -- */

/**
 * What a purchase needs before it can go ahead.
 *
 * Two independent tests, deliberately not collapsed into one. Value is a
 * finance question and gets a finance answer; connecting something new to the
 * network is a risk question and gets IT's, however little it costs. A £200
 * security tool with a bad agent on it is worse than a £5,000 order of chairs.
 */
export function needFor(
  { amount, vertical }: { amount: number; vertical: string }, policy: Policy,
): Need {
  const finance = amount >= policy.threshold
  const it = vertical === 'security' && policy.security_signoff
  return finance && it ? 'both' : finance ? 'finance' : it ? 'it' : 'none'
}

/** Why it needs what it needs, in the sentence a requester will read. */
export function policyNoteFor(need: Need, amount: number, policy: Policy): string {
  const t = money(policy.threshold)
  switch (need) {
    case 'both':
      return `At or above the ${t} threshold and a security purchase — finance approval and IT sign-off both required`
    case 'finance':
      return `At or above the ${t} threshold — finance approval required`
    case 'it':
      return amount >= policy.threshold
        ? 'A security purchase — IT sign-off required'
        : `Below the ${t} threshold, but a security purchase — IT sign-off required whatever it costs`
    default:
      return `Below the ${t} threshold and not a security purchase — no approval needed, recorded for the audit trail`
  }
}

/** What turning a policy switch on or off actually does, counted against the
    requisitions on record rather than described in the abstract. */
export function policyImpact(
  policy: Policy, next: Partial<Policy>, reqs: Requisition[],
): string[] {
  const out: string[] = []
  const after = { ...policy, ...next }

  if (next.threshold !== undefined && next.threshold !== policy.threshold) {
    const before = reqs.filter(r => r.amount >= policy.threshold).length
    const now = reqs.filter(r => r.amount >= after.threshold).length
    out.push(
      now === before
        ? `Still ${now} of the ${reqs.length} requisitions on record would have needed finance approval`
        : `${now} of the ${reqs.length} requisitions on record would have needed finance approval, against ${before} today`,
    )
  }
  if (next.security_signoff === false && policy.security_signoff) {
    const n = reqs.filter(r => r.vertical === 'security' && r.amount < policy.threshold).length
    out.push(`${n} security purchase${n === 1 ? '' : 's'} below the threshold would go through with nobody from IT seeing ${n === 1 ? 'it' : 'them'}`)
  }
  if (next.self_approve === true && !policy.self_approve) {
    const approvers = new Set(reqs.filter(r => r.decided_by).map(r => r.decided_by))
    out.push(`One person can raise and approve the same spend. ${approvers.size} people have approved something on this account.`)
  }
  if (next.auto_approve_renewals === true && !policy.auto_approve_renewals) {
    out.push('A renewal at a higher price than the last term would go through unseen. Most price rises arrive as renewals.')
  }
  return out
}

/* ---------------------------------------------------------- requisitions -- */

/** Everything still waiting, oldest first — a queue is only useful in the order
    people have been waiting in. */
export function waiting(reqs: Requisition[]): Requisition[] {
  return reqs.filter(r => r.state === 'pending')
    .sort((a, b) => a.raised_on.localeCompare(b.raised_on) || a.sort_order - b.sort_order)
}

export function decided(reqs: Requisition[]): Requisition[] {
  return reqs.filter(r => r.state !== 'pending')
    .sort((a, b) => (b.decided_on ?? '').localeCompare(a.decided_on ?? ''))
}

/**
 * Whether this person may decide this requisition, and if not, why not.
 *
 * The order of the tests is the order a person would reason in: am I an
 * approver at all, is it mine, do I hold the right sign-off, is it within my
 * limit. Getting "you cannot approve your own" before "you are not an
 * approver" would be a confusing thing to be told.
 */
export function canDecide(req: Requisition, me: Member, policy: Policy): Check {
  if (req.state !== 'pending') {
    return { ok: false, reason: `${req.id} was already ${req.state}. A decision is not re-openable.` }
  }
  if (req.need === 'none') {
    return me.can_raise
      ? { ok: true, note: 'Within policy — confirming it places the order.' }
      : { ok: false, reason: 'Your role on this account cannot place an order. Ask a colleague who can raise a requisition.' }
  }
  if (!me.approves_finance && !me.approves_it) {
    return { ok: false, reason: 'Your role on this account is not an approver. Somebody holding finance approval or IT sign-off has to decide this.' }
  }
  /* Separation of duties is a control on approval. A requisition needing none
     was handled above — confirming your own within-policy purchase is placing
     an order rather than signing one off, so there is nothing to separate. */
  if (req.raised_by === me.id && !policy.self_approve) {
    return {
      ok: false,
      reason: 'You raised this one. Somebody else has to decide it — that is what separation of duties means.',
    }
  }
  if ((req.need === 'finance' || req.need === 'both') && !me.approves_finance) {
    return { ok: false, reason: `This needs finance approval, and you hold IT sign-off rather than finance.` }
  }
  if ((req.need === 'it' || req.need === 'both') && !me.approves_it) {
    return { ok: false, reason: `This is a security purchase and needs IT sign-off, which you do not hold.` }
  }
  if (me.approve_limit !== null && req.amount > me.approve_limit) {
    return {
      ok: false,
      reason: `${money(req.amount)} is above the ${money(me.approve_limit)} you may approve.`,
    }
  }
  return { ok: true }
}

/** Who could decide it, so a screen can say who to chase rather than leaving a
    requester to guess. */
export function whoCanDecide(req: Requisition, members: Member[], policy: Policy): Member[] {
  return members
    .filter(m => m.status === 'active')
    .filter(m => canDecide(req, m, policy).ok)
    .sort((a, b) => a.sort_order - b.sort_order)
}

export function validateDecision(
  req: Requisition, me: Member, policy: Policy, approve: boolean, note: string,
): Check {
  const allowed = canDecide(req, me, policy)
  if (!allowed.ok) return allowed
  if (!approve && !note.trim()) {
    return {
      ok: false,
      reason: 'A decline needs a reason. The requester cannot revise something they were not told about.',
    }
  }
  return { ok: true }
}

/** What approving actually commits the account to. Approving places the order,
    so this is the last point at which anybody sees the consequence. */
export function approvalImpact(
  req: Requisition, lines: ReqLine[], account: Account, centres: CostCentre[], spentYear: number,
): string[] {
  const sellers = [...new Set(lines.map(l => l.seller))]
  const out: string[] = []
  out.push(
    sellers.length === 1
      ? `The order goes to ${sellers[0]} immediately — this is not a quote.`
      : `Orders go to ${sellers.join(' and ')} immediately — this is not a quote.`,
  )
  out.push(
    req.model === 'monthly'
      ? `${money(req.amount)} a month is added to the committed spend and appears on the next invoice.`
      : `${money(req.amount)} is invoiced on ${account.terms}.`,
  )
  const cc = centres.find(c => c.id === req.cost_centre)
  if (cc) {
    const after = cc.spent_quarter + (req.model === 'monthly' ? req.amount * 3 : req.amount)
    out.push(
      after > cc.cap_quarter
        ? `${cc.name} goes ${money(after - cc.cap_quarter)} over its ${money(cc.cap_quarter)} cap for ${cc.quarter}.`
        : `${cc.name} moves to ${money(after)} of its ${money(cc.cap_quarter)} cap for ${cc.quarter}.`,
    )
  }
  const left = account.budget_year - spentYear - (req.model === 'monthly' ? req.amount : req.amount)
  out.push(`Budget remaining drops to about ${money(Math.max(0, left))} for the year.`)
  return out
}

/** A requisition asking for something the account already holds. The single
    most useful thing to show an approver, and the reason the prototype puts
    "what the account already holds" next to the request. */
export function duplicatesOf(
  lines: ReqLine[], subs: Subscription[],
): { line: ReqLine; sub: Subscription }[] {
  const out: { line: ReqLine; sub: Subscription }[] = []
  for (const line of lines) {
    const sub = subs.find(s =>
      s.status !== 'cancelled' && (
        (line.product_id !== null && s.product_id === line.product_id) ||
        s.name.toLowerCase() === line.name.toLowerCase()))
    if (sub) out.push({ line, sub })
  }
  return out
}

export function validateRequisition(
  draft: { title: string; reason: string; cost_centre: string | null; lines: Partial<ReqLine>[] },
  me: Member,
): Check {
  if (!me.can_raise) {
    return { ok: false, reason: 'Your role on this account cannot raise a requisition. Ask a colleague who can, or ask an administrator to move you to a role that raises.' }
  }
  if (!draft.title.trim()) return { ok: false, reason: 'Give it a name an approver will recognise' }
  if (!draft.reason.trim()) {
    return { ok: false, reason: 'Say why it is needed. An approver deciding without one is guessing.' }
  }
  if (!draft.cost_centre) return { ok: false, reason: 'Pick the cost centre it comes out of' }
  const lines = draft.lines.filter(l => (l.quantity ?? 0) > 0)
  if (!lines.length) return { ok: false, reason: 'Add at least one line' }
  return { ok: true }
}

export function requisitionTotal(lines: Pick<ReqLine, 'quantity' | 'unit_price'>[]): number {
  return round2(lines.reduce((s, l) => s + l.quantity * l.unit_price, 0))
}

export function summariseApprovals(reqs: Requisition[], me: Member, policy: Policy): {
  waiting: number; mine: number; blocked: number; value: number
  approved: number; declined: number
} {
  const w = waiting(reqs)
  return {
    waiting: w.length,
    mine: w.filter(r => canDecide(r, me, policy).ok).length,
    blocked: w.filter(r => !canDecide(r, me, policy).ok).length,
    value: round2(w.reduce((s, r) => s + r.amount, 0)),
    approved: reqs.filter(r => r.state === 'approved').length,
    declined: reqs.filter(r => r.state === 'declined').length,
  }
}

/** Who is asking for what, so a lead can see whether one person is driving all
    the spend. */
export function byRequester(reqs: Requisition[], members: Member[]): {
  member: Member; raised: number; value: number; pending: number
}[] {
  return members
    .filter(m => m.can_raise)
    .map(m => {
      const mine = reqs.filter(r => r.raised_by === m.id)
      return {
        member: m,
        raised: mine.length,
        value: round2(mine.filter(r => r.state === 'approved').reduce((s, r) => s + r.amount, 0)),
        pending: mine.filter(r => r.state === 'pending').length,
      }
    })
    .filter(r => r.raised > 0)
    .sort((a, b) => b.value - a.value)
}

/* --------------------------------------------------------- cost centres -- */

export function centreUse(centre: CostCentre): { pct: number; left: number; over: boolean } {
  const pct = centre.cap_quarter > 0 ? round1((centre.spent_quarter / centre.cap_quarter) * 100) : 0
  return { pct, left: round2(centre.cap_quarter - centre.spent_quarter), over: centre.spent_quarter > centre.cap_quarter }
}

/** The ones worth an alert. A cap that is only reported on at quarter end is a
    report rather than a control. */
export function centresAtRisk(centres: CostCentre[], threshold = 90): CostCentre[] {
  return centres.filter(c => centreUse(c).pct >= threshold)
    .sort((a, b) => centreUse(b).pct - centreUse(a).pct)
}

/* ---------------------------------------------------------- subscriptions */

/** What the account is committed to per month. Suspended is included on
    purpose: the licences were sold and bill to contract end. What suspension
    stops is the renewal, and conflating the two understates the next invoice. */
export function committed(subs: Subscription[]): { billed: number; renewing: number; suspended: number } {
  const billed = round2(subs.filter(s => s.status !== 'cancelled').reduce((a, s) => a + s.monthly, 0))
  const renewing = round2(subs.filter(s => s.status === 'active').reduce((a, s) => a + s.monthly, 0))
  return { billed, renewing, suspended: round2(billed - renewing) }
}

/** Seats paid for and not handed to anybody. The clearest waste on the
    account, and the number a procurement lead is measured on. */
export function idleSeats(subs: Subscription[]): { seats: number; monthly: number; worst: Subscription | null } {
  const live = subs.filter(s => s.status === 'active')
  const seats = live.reduce((a, s) => a + (s.quantity - s.seats_used), 0)
  const monthly = round2(live.reduce((a, s) => a + (s.quantity - s.seats_used) * s.unit_price, 0))
  const worst = live
    .slice()
    .sort((a, b) => (b.quantity - b.seats_used) * b.unit_price - (a.quantity - a.seats_used) * a.unit_price)[0] ?? null
  return { seats, monthly, worst: worst && worst.quantity > worst.seats_used ? worst : null }
}

export function renewingWithin(subs: Subscription[], days: number, today: string): Subscription[] {
  const now = Date.parse(today)
  return subs
    .filter(s => s.status !== 'cancelled')
    .filter(s => {
      const d = Date.parse(s.renews)
      return !Number.isNaN(d) && d >= now && (d - now) / 86400000 <= days
    })
    .sort((a, b) => a.renews.localeCompare(b.renews))
}

/* --------------------------------------------------------------- billing -- */

export function outstanding(invoices: Invoice[]): { total: number; count: number; overdue: number } {
  const unpaid = invoices.filter(i => i.status === 'open' || i.status === 'overdue')
  return {
    total: round2(unpaid.reduce((a, i) => a + i.total, 0)),
    count: unpaid.length,
    overdue: round2(invoices.filter(i => i.status === 'overdue').reduce((a, i) => a + i.total, 0)),
  }
}

/** Spend so far this financial year, by issue date — the figure "budget used"
    has to mean, or it disagrees with the invoices sitting under it. */
export function spentThisYear(invoices: Invoice[], account: Account): number {
  return round2(invoices.filter(i => i.issued >= account.fy_starts).reduce((a, i) => a + i.total, 0))
}

/** Budget used, next to how much of the year has actually gone. A percentage
    on its own cannot tell you whether you are overspending or just far into
    the year. */
export function budgetPosition(invoices: Invoice[], account: Account, today: string): {
  spent: number; budget: number; pct: number; yearPct: number; ahead: boolean; left: number
} {
  const spent = spentThisYear(invoices, account)
  const start = Date.parse(account.fy_starts)
  const now = Date.parse(today)
  const yearPct = Number.isNaN(start) || Number.isNaN(now)
    ? 0
    : round1(Math.min(100, Math.max(0, ((now - start) / (365 * 86400000)) * 100)))
  const pct = account.budget_year > 0 ? round1((spent / account.budget_year) * 100) : 0
  return { spent, budget: account.budget_year, pct, yearPct, ahead: pct > yearPct, left: round2(account.budget_year - spent) }
}

/** One invoice covers every seller, so the useful breakdown is by seller. It is
    also the answer to "who are we actually spending this with". */
export function bySeller(lines: InvoiceLine[]): {
  seller: string; partner_id: string | null; amount: number; share: number; lines: number
}[] {
  const total = lines.reduce((a, l) => a + l.amount, 0)
  const m = new Map<string, { seller: string; partner_id: string | null; amount: number; lines: number }>()
  for (const l of lines) {
    const row = m.get(l.seller) ?? { seller: l.seller, partner_id: l.partner_id, amount: 0, lines: 0 }
    row.amount = round2(row.amount + l.amount)
    row.lines += 1
    m.set(l.seller, row)
  }
  return [...m.values()]
    .map(r => ({ ...r, share: total > 0 ? round1((r.amount / total) * 100) : 0 }))
    .sort((a, b) => b.amount - a.amount)
}

export function byCostCentre(lines: InvoiceLine[], centres: CostCentre[]): {
  id: string; name: string; amount: number; share: number
}[] {
  const total = lines.reduce((a, l) => a + l.amount, 0)
  const m = new Map<string, number>()
  for (const l of lines) {
    const key = l.cost_centre ?? '—'
    m.set(key, round2((m.get(key) ?? 0) + l.amount))
  }
  return [...m.entries()]
    .map(([id, amount]) => ({
      id,
      name: centres.find(c => c.id === id)?.name ?? 'Not allocated',
      amount,
      share: total > 0 ? round1((amount / total) * 100) : 0,
    }))
    .sort((a, b) => b.amount - a.amount)
}

/** Does the invoice equal the lines under it. A buyer being asked to pay a
    total they cannot reconstruct is a buyer who disputes it. */
export function reconcileInvoice(invoice: Invoice, lines: InvoiceLine[]): Check {
  const mine = lines.filter(l => l.invoice_id === invoice.id)
  if (!mine.length) return { ok: false, reason: `${invoice.id} has no lines behind it` }
  const sum = round2(mine.reduce((a, l) => a + l.amount, 0))
  const net = round2(invoice.recurring + invoice.oneoff)
  if (sum !== net) {
    return { ok: false, reason: `${invoice.id} is ${money(net)} before tax but its lines add to ${money(sum)}` }
  }
  const tax = round2((net * invoice.tax_rate) / 100)
  if (tax !== round2(invoice.tax)) {
    return { ok: false, reason: `${invoice.id} charges ${money(invoice.tax)} tax where ${invoice.tax_rate}% of ${money(net)} is ${money(tax)}` }
  }
  if (round2(net + invoice.tax) !== round2(invoice.total)) {
    return { ok: false, reason: `${invoice.id} totals ${money(invoice.total)} where its parts add to ${money(net + invoice.tax)}` }
  }
  return { ok: true, note: `${mine.length} lines, ${money(net)} plus ${money(invoice.tax)} tax` }
}

export const DUNNING = { restrictAfterDays: 14, suspendAfterDays: 30 }

function addDays(iso: string, days: number): string {
  const d = new Date(Date.parse(iso) + days * 86400000)
  return Number.isNaN(d.getTime()) ? iso : d.toISOString().slice(0, 10)
}

/**
 * How overdue, and what happens next — with the dates on it.
 *
 * "Can suspend" without a date is not a warning anybody can act on, and a date
 * typed into a seed beside a ladder computed in code is two sources that will
 * eventually disagree. So the dates are derived from the due date and the
 * ladder, and whatever is written on the invoice is left to say why rather
 * than when.
 */
export function arrears(invoice: Invoice, today: string): {
  days: number
  stage: 'due' | 'late' | 'restricted' | 'suspended'
  restrictOn: string
  suspendOn: string
  what: string
} | null {
  if (invoice.status !== 'overdue') return null
  const days = Math.max(0, Math.floor((Date.parse(today) - Date.parse(invoice.due)) / 86400000))
  const stage = days >= DUNNING.suspendAfterDays ? 'suspended'
    : days >= DUNNING.restrictAfterDays ? 'restricted'
      : days >= 1 ? 'late' : 'due'
  const restrictOn = addDays(invoice.due, DUNNING.restrictAfterDays)
  const suspendOn = addDays(invoice.due, DUNNING.suspendAfterDays)
  const what = {
    due: `Due today. Nothing has happened yet — new orders pause on ${day(restrictOn)} if it is not paid.`,
    late: `A reminder has gone out and everything keeps running. New orders pause on ${day(restrictOn)}, and services suspend on ${day(suspendOn)}.`,
    restricted: `New orders are paused across every seller on the account. What you already hold keeps running until ${day(suspendOn)}.`,
    suspended: 'Services are suspended. They restart as soon as the balance clears; data is kept for 30 days from suspension.',
  }[stage]
  return { days, stage, restrictOn, suspendOn, what }
}

/** What a buyer can claim back, which is the only reason the tax position is
    on this screen at all. */
export function taxPosition(account: Account, invoices: Invoice[]): {
  reclaimable: number; blocked: boolean; why: string
} {
  const reclaimable = round2(invoices.reduce((a, i) => a + i.tax, 0))
  if (account.reg_type === 'Not registered' || !account.registration?.trim()) {
    return {
      reclaimable,
      blocked: true,
      why: `${money(reclaimable)} of tax has been charged on these invoices. Without a registration number on file none of it can be reclaimed.`,
    }
  }
  if (account.tax_exempt && !account.exempt_cert) {
    return {
      reclaimable,
      blocked: true,
      why: 'An exemption is claimed with no certificate on file. Until one is uploaded the marketplace has to charge tax as normal.',
    }
  }
  return {
    reclaimable,
    blocked: false,
    why: `${money(reclaimable)} of input tax across these invoices, against ${account.registration}.`,
  }
}

/* --------------------------------------------------------------- helpers -- */

export function round1(n: number): number { return Math.round(n * 10) / 10 }
export function round2(n: number): number { return Math.round(n * 100) / 100 }

export function money(n: number): string {
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export function money0(n: number): string {
  return `$${Math.round(n).toLocaleString('en-US')}`
}

/** "20 Aug 2026" from an ISO date, and anything unparseable handed straight
    back rather than shown as "Invalid Date". */
export function day(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}
