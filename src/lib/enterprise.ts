import { format as formatMoney, money as asMoney, rateOn } from './money'
import type { Rate } from './money'

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
  /* The account's primary currency: what its budget, credit limit and
     cost-centre caps are set in, because those are chosen figures somebody
     signed off. An individual order or invoice may be in any currency the
     account's market takes — a company in Nairobi has the choice a shopper in
     Nairobi has. */
  currency: string
  /* Where it contracts, from its place of supply. Decides which market's tax
     its invoices are raised under, and which currencies it may transact in. */
  market: string
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
  /* What that amount is. Any currency the account's market takes, which is not
     necessarily the account's primary one — Harbourpoint contracts in Nairobi
     and may raise a requisition in shillings or in dollars. The threshold it is
     judged against is in the primary currency, so see `inPolicyMoney`. */
  currency: string
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
  /* Where it was raised. Equal to the account's market — `guard_invoice_market`
     refuses anything else, which is how a Kenyan invoice came to sit on an
     Indian account before that guard existed. */
  market: string
  id: string
  account_id: string
  period: string
  /* What this invoice was raised in. An account is invoiced in one currency,
     but the column is on the invoice because the invoice is the document — a
     reprint has to come out in the money it was issued in. */
  currency: string
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
 * A requisition's amount in the money the account's limits are set in.
 *
 * The threshold, the cost-centre caps and each approver's limit are *chosen*
 * figures — somebody signed off "anything at or above ₹2,00,000 needs finance"
 * — so they are stated in the account's primary currency and stay there. A
 * limit that moved with the currency of the last purchase would not be a limit.
 *
 * The requisition is the measured quantity, so the requisition is what gets
 * converted, at the rate in force on the day it was raised rather than today's:
 * an approval reopened next year has to read the same as the one the approver
 * signed.
 *
 * Null when there is no rate on file at or before that date. Every caller
 * refuses on null rather than falling back, because the fallback — comparing
 * 15,000 shillings against a 130,000 shilling threshold as though the dollars
 * were shillings — is a decision made on a figure 129 times too small.
 */
export interface PolicyMoney {
  /** The amount, in `currency`. */
  amount: number
  /** The account's primary currency — what the limits are stated in. */
  currency: string
  /** 1 where nothing was converted, so every reading has the same shape. */
  rate: number
  as_of: string
  /** True where the requisition was already in the primary currency. */
  native: boolean
}

export function inPolicyMoney(
  req: { amount: number; currency: string },
  primary: string,
  rates: readonly Rate[],
  asOf: string,
): PolicyMoney | null {
  if (req.currency === primary) {
    return { amount: req.amount, currency: primary, rate: 1, as_of: asOf, native: true }
  }
  const r = rateOn(rates, req.currency, primary, asOf)
  if (!r) return null
  return {
    amount: round2(req.amount * r.rate),
    currency: primary, rate: r.rate, as_of: r.as_of, native: false,
  }
}

/**
 * The one place a screen gets its converter from.
 *
 * Bound to the account and the rate table once, then asked per requisition,
 * because each one is converted at the fix in force on the day *it* was raised
 * — not one date for the whole queue. A screen that built its own would be a
 * second answer to the question `inPolicyMoney` exists to answer once.
 */
export function policyMoneyFor(
  account: Pick<Account, 'currency'>, rates: readonly Rate[],
): (r: Pick<Requisition, 'amount' | 'currency' | 'raised_on'>) => PolicyMoney | null {
  return r => inPolicyMoney(r, account.currency, rates, r.raised_on)
}

/** The clause that says what was converted and at what, appended to any
    sentence that compares a requisition against a limit. A converted figure
    shown without its rate and date is a figure nobody can check. */
export function conversionNote(req: { amount: number; currency: string }, at: PolicyMoney): string {
  if (at.native) return ''
  return ` — ${money(req.amount, req.currency)} converted at ${at.rate} ${at.currency}/${req.currency} as of ${at.as_of}`
}

/**
 * What a purchase needs before it can go ahead.
 *
 * Two independent tests, deliberately not collapsed into one. Value is a
 * finance question and gets a finance answer; connecting something new to the
 * network is a risk question and gets IT's, however little it costs. A £200
 * security tool with a bad agent on it is worse than a £5,000 order of chairs.
 *
 * `amount` must already be in the policy's own money — pass
 * `inPolicyMoney(req, account.currency, rates, req.raised_on)?.amount`. It
 * takes a number rather than the requisition so that it cannot silently
 * compare across currencies: a caller holding a requisition has to have done
 * the conversion, or have refused, before it can call this at all.
 */
export function needFor(
  { amount, vertical }: { amount: number; vertical: string }, policy: Policy,
): Need {
  const finance = amount >= policy.threshold
  const it = vertical === 'security' && policy.security_signoff
  return finance && it ? 'both' : finance ? 'finance' : it ? 'it' : 'none'
}

/**
 * Why it needs what it needs, in the sentence a requester will read.
 *
 * `amount` is in the policy's money and `currency` is the policy's currency —
 * not the requisition's. Formatting a rupee threshold with a shilling mark
 * because that was the currency to hand is how a sentence comes to state a
 * limit nobody set, and it is what this signature used to invite.
 */
export function policyNoteFor(
  need: Need, amount: number, policy: Policy, currency: string, at?: PolicyMoney | null,
): string {
  const t = money(policy.threshold, currency)
  const from = at && !at.native
    ? ` (judged on ${money(amount, currency)}, converted at ${at.rate} as of ${at.as_of})`
    : ''
  switch (need) {
    case 'both':
      return `At or above the ${t} threshold and a security purchase — finance approval and IT sign-off both required${from}`
    case 'finance':
      return `At or above the ${t} threshold — finance approval required${from}`
    case 'it':
      return amount >= policy.threshold
        ? 'A security purchase — IT sign-off required'
        : `Below the ${t} threshold, but a security purchase — IT sign-off required whatever it costs${from}`
    default:
      return `Below the ${t} threshold and not a security purchase — no approval needed, recorded for the audit trail${from}`
  }
}

/**
 * What turning a policy switch on or off actually does, counted against the
 * requisitions on record rather than described in the abstract.
 *
 * `judge` says what each requisition is worth in the policy's own money, and
 * returns null for one that cannot be converted. Counting an unconvertible
 * requisition either way would be a claim about a figure nobody has, so those
 * are excluded from the counts and said out loud instead — a "3 of 12" that
 * quietly ranged over 11 is the failure this parameter exists to prevent.
 *
 * It defaults to the raw amount, which is correct exactly when every
 * requisition is in the account's primary currency.
 */
export function policyImpact(
  policy: Policy, next: Partial<Policy>, reqs: Requisition[],
  judge: (r: Requisition) => number | null = r => r.amount,
): string[] {
  const out: string[] = []
  const after = { ...policy, ...next }

  const judged = reqs
    .map(r => ({ r, amount: judge(r) }))
    .filter((x): x is { r: Requisition; amount: number } => x.amount !== null)
  const unjudged = reqs.length - judged.length

  if (next.threshold !== undefined && next.threshold !== policy.threshold) {
    const before = judged.filter(x => x.amount >= policy.threshold).length
    const now = judged.filter(x => x.amount >= after.threshold).length
    out.push(
      now === before
        ? `Still ${now} of the ${judged.length} requisitions on record would have needed finance approval`
        : `${now} of the ${judged.length} requisitions on record would have needed finance approval, against ${before} today`,
    )
  }
  if (next.security_signoff === false && policy.security_signoff) {
    const n = judged.filter(x => x.r.vertical === 'security' && x.amount < policy.threshold).length
    out.push(`${n} security purchase${n === 1 ? '' : 's'} below the threshold would go through with nobody from IT seeing ${n === 1 ? 'it' : 'them'}`)
  }
  if (unjudged > 0 && out.length) {
    out.push(`${unjudged} requisition${unjudged === 1 ? ' is' : 's are'} in a currency with no rate on file for the day ${unjudged === 1 ? 'it was' : 'they were'} raised, so ${unjudged === 1 ? 'it is' : 'they are'} not in these counts.`)
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
/**
 * `currency` is optional, and its absence changes the sentence rather than the
 * verdict. Three callers in this file ask only whether the answer is yes and
 * throw the reason away; handing them a currency they do not have would mean
 * inventing one, and inventing one is how every figure in this persona came to
 * wear a dollar sign. Without it the over-limit refusal names no figure at all,
 * which is worse prose and true.
 *
 * `at` is the requisition in the money `me.approve_limit` is set in — the
 * account's primary currency. Passing it changes the verdict, not only the
 * sentence, which is why it is separate from `currency`: an approver limited to
 * ₹5,00,000 must not sign a $9,000 requisition because 9,000 is the smaller
 * number. Omitted, the raw amount is compared, which is right exactly when the
 * requisition is in the primary currency; passed as null it means the rate was
 * missing, and the decision is refused rather than guessed.
 */
export function canDecide(
  req: Requisition, me: Member, policy: Policy, currency?: string, at?: PolicyMoney | null,
): Check {
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
  if (me.approve_limit !== null) {
    /* `at === null` is "there is a rate and we could not find it", which is not
       the same as "no conversion was needed" and must not be treated as it. */
    if (at === null) {
      return {
        ok: false,
        reason: `${req.id} is in ${req.currency} and the limits on this account are set in ${currency ?? 'another currency'}. There is no rate on file for ${req.raised_on}, so it cannot be judged against them.`,
      }
    }
    const judged = at ? at.amount : req.amount
    if (judged > me.approve_limit) {
      return {
        ok: false,
        reason: currency
          ? `${money(judged, currency)}${at ? conversionNote(req, at) : ''} is above the ${money(me.approve_limit, currency)} you may approve.`
          : 'That is above the value you may approve.',
      }
    }
  }
  return { ok: true }
}

/** Who could decide it, so a screen can say who to chase rather than leaving a
    requester to guess. `at` matters here as well as in `canDecide`: an approver
    whose limit the requisition exceeds once converted is not somebody to chase. */
export function whoCanDecide(
  req: Requisition, members: Member[], policy: Policy, at?: PolicyMoney | null,
): Member[] {
  return members
    .filter(m => m.status === 'active')
    .filter(m => canDecide(req, m, policy, undefined, at).ok)
    .sort((a, b) => a.sort_order - b.sort_order)
}

export function validateDecision(
  req: Requisition, me: Member, policy: Policy, approve: boolean, note: string,
  currency?: string, at?: PolicyMoney | null,
): Check {
  const allowed = canDecide(req, me, policy, currency, at)
  if (!allowed.ok) return allowed
  if (!approve && !note.trim()) {
    return {
      ok: false,
      reason: 'A decline needs a reason. The requester cannot revise something they were not told about.',
    }
  }
  return { ok: true }
}

/**
 * What approving actually commits the account to. Approving places the order,
 * so this is the last point at which anybody sees the consequence.
 *
 * The requisition is stated in its own money, because that is what the seller
 * will be paid; the cap and the budget it moves are in the account's, because
 * those are the figures somebody signed off. `at` is what bridges the two, and
 * a null one means the arithmetic is not available — said plainly rather than
 * done anyway on the wrong number.
 */
export function approvalImpact(
  req: Requisition, lines: ReqLine[], account: Account, centres: CostCentre[], spentYear: number,
  at?: PolicyMoney | null,
): string[] {
  const c = account.currency
  const sellers = [...new Set(lines.map(l => l.seller))]
  const out: string[] = []
  out.push(
    sellers.length === 1
      ? `The order goes to ${sellers[0]} immediately — this is not a quote.`
      : `Orders go to ${sellers.join(' and ')} immediately — this is not a quote.`,
  )
  const asked = money(req.amount, req.currency)
  out.push(
    req.model === 'monthly'
      ? `${asked} a month is added to the committed spend and appears on the next invoice.`
      : `${asked} is invoiced on ${account.terms}.`,
  )

  const owed = at === undefined ? req.amount : at === null ? null : at.amount
  if (owed === null) {
    out.push(`This is in ${req.currency} and the account's caps and budget are in ${c}. With no rate on file for ${req.raised_on}, what it does to either cannot be shown.`)
    return out
  }
  if (at && !at.native) {
    out.push(`Against the account's ${c} caps that is ${money(owed, c)}${conversionNote(req, at)}.`)
  }

  const cc = centres.find(x => x.id === req.cost_centre)
  if (cc) {
    const after = cc.spent_quarter + (req.model === 'monthly' ? owed * 3 : owed)
    out.push(
      after > cc.cap_quarter
        ? `${cc.name} goes ${money(after - cc.cap_quarter, c)} over its ${money(cc.cap_quarter, c)} cap for ${cc.quarter}.`
        : `${cc.name} moves to ${money(after, c)} of its ${money(cc.cap_quarter, c)} cap for ${cc.quarter}.`,
    )
  }
  const left = account.budget_year - spentYear - owed
  out.push(`Budget remaining drops to about ${money(Math.max(0, left), c)} for the year.`)
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

/**
 * The queue at a glance.
 *
 * `value` is a total, so it is a figure in one currency and `judge` is what
 * puts every requisition into it. Adding `r.amount` across a shilling and a
 * dollar requisition would produce a number in no currency at all — the mistake
 * `20260802400000` took out of the operator's rollups — so anything that cannot
 * be converted is counted in `unpriced` rather than folded into the total.
 */
export function summariseApprovals(
  reqs: Requisition[], me: Member, policy: Policy,
  judge: (r: Requisition) => number | null = r => r.amount,
): {
  waiting: number; mine: number; blocked: number; value: number; unpriced: number
  approved: number; declined: number
} {
  const w = waiting(reqs)
  const priced = w.map(judge).filter((n): n is number => n !== null)
  return {
    waiting: w.length,
    mine: w.filter(r => canDecide(r, me, policy).ok).length,
    blocked: w.filter(r => !canDecide(r, me, policy).ok).length,
    value: round2(priced.reduce((s, n) => s + n, 0)),
    unpriced: w.length - priced.length,
    approved: reqs.filter(r => r.state === 'approved').length,
    declined: reqs.filter(r => r.state === 'declined').length,
  }
}

/** Who is asking for what, so a lead can see whether one person is driving all
    the spend. `judge` is a total's requirement, not a nicety — the rows are
    sorted by `value`, and a sort over a mixed-currency sum ranks by exchange
    rate as much as by spend. */
export function byRequester(
  reqs: Requisition[], members: Member[],
  judge: (r: Requisition) => number | null = r => r.amount,
): { member: Member; raised: number; value: number; unpriced: number; pending: number }[] {
  return members
    .filter(m => m.can_raise)
    .map(m => {
      const mine = reqs.filter(r => r.raised_by === m.id)
      const approved = mine.filter(r => r.state === 'approved')
      const priced = approved.map(judge).filter((n): n is number => n !== null)
      return {
        member: m,
        raised: mine.length,
        value: round2(priced.reduce((s, n) => s + n, 0)),
        unpriced: approved.length - priced.length,
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
  const c = invoice.currency
  const mine = lines.filter(l => l.invoice_id === invoice.id)
  if (!mine.length) return { ok: false, reason: `${invoice.id} has no lines behind it` }
  const sum = round2(mine.reduce((a, l) => a + l.amount, 0))
  const net = round2(invoice.recurring + invoice.oneoff)
  if (sum !== net) {
    return { ok: false, reason: `${invoice.id} is ${money(net, c)} before tax but its lines add to ${money(sum, c)}` }
  }
  const tax = round2((net * invoice.tax_rate) / 100)
  if (tax !== round2(invoice.tax)) {
    return { ok: false, reason: `${invoice.id} charges ${money(invoice.tax, c)} tax where ${invoice.tax_rate}% of ${money(net, c)} is ${money(tax, c)}` }
  }
  if (round2(net + invoice.tax) !== round2(invoice.total)) {
    return { ok: false, reason: `${invoice.id} totals ${money(invoice.total, c)} where its parts add to ${money(net + invoice.tax, c)}` }
  }
  return { ok: true, note: `${mine.length} lines, ${money(net, c)} plus ${money(invoice.tax, c)} tax` }
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
      why: `${money(reclaimable, account.currency)} of tax has been charged on these invoices. Without a registration number on file none of it can be reclaimed.`,
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
    why: `${money(reclaimable, account.currency)} of input tax across these invoices, against ${account.registration}.`,
  }
}

/* --------------------------------------------------------------- helpers -- */

export function round1(n: number): number { return Math.round(n * 10) / 10 }
export function round2(n: number): number { return Math.round(n * 100) / 100 }

/**
 * An amount, in the currency it is actually in.
 *
 * These two used to write a `$` and there was nothing else they could say. Every
 * business account on this marketplace is invoiced in rupees, dirhams or
 * shillings — none in dollars — so the Billing screen drew ₹9,22,365 of invoices
 * under a heading that said $27,27,882, and "Budget used" compared a rupee spend
 * to a dollar budget and reported 2,273%.
 *
 * The currency is now a parameter with no default, which is the point: a caller
 * that does not know what money it is holding cannot format it. `format` in
 * `money.ts` is the one formatter, and with no currency table to read it falls
 * back to the ISO code — "INR 27,27,882", which is unambiguous and is how a
 * cross-border document is written anyway. Screens pass `fmtIn` from
 * `useMarket`, which has the table, and get "₹27,27,882".
 */
export function money(n: number, currency: string): string {
  return formatMoney(asMoney(n, currency), [])
}

export function money0(n: number, currency: string): string {
  return formatMoney(asMoney(n, currency), [], { decimals: false })
}

/** "20 Aug 2026" from an ISO date, and anything unparseable handed straight
    back rather than shown as "Invalid Date". */
export function day(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}
