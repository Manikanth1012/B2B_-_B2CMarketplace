/* The only module that reads or writes the enterprise account.
   Rules live in enterprise.ts so they can be tested without a network.

   Every write is checked twice: once here so the screen can explain a refusal
   in the buyer's own words, and again by `guard_requisition()` in the database
   so a refusal cannot be skipped by talking to the API directly. */

import { supabase } from './supabase'
import { loadPriceBook, loadCopyBook, describeIn } from './moneyRepo'
import {
  needFor, policyNoteFor, validateDecision, validateRequisition, requisitionTotal, money,
  inPolicyMoney, policyMoneyFor,
} from './enterprise'
import type {
  Account, Member, CostCentre, Policy, Requisition, ReqLine,
  Subscription, Invoice, InvoiceLine, Check,
} from './enterprise'
import { currenciesOf } from './money'
import type { Rate, MarketCurrency } from './money'
import type { EnterpriseRole } from './enterpriseAdmin'

export type Result = Check

export interface AccountBook {
  account: Account | null
  me: Member | null
  members: Member[]
  /* What each of those members may do. Read here rather than looked up per
     screen, because a list of people without the roles behind them can say who
     is on the account but not who may sign anything. */
  roles: EnterpriseRole[]
  centres: CostCentre[]
  policy: Policy | null
  requisitions: Requisition[]
  lines: ReqLine[]
  subscriptions: Subscription[]
  invoices: Invoice[]
  invoiceLines: InvoiceLine[]
  /* What this account may transact in, default first: the currencies its own
     market takes. One entry for an account in India, two for one in Nairobi or
     Dubai — the same list `guard_requisition_currency` enforces, so the screen
     offers exactly what the database will accept. */
  currencies: string[]
  /* The rate table, because a requisition raised in a second currency is judged
     against a threshold set in the account's primary one, at the fix in force
     on the day it was raised. */
  rates: Rate[]
  loadError?: string
}

const EMPTY: AccountBook = {
  account: null, me: null, members: [], roles: [], centres: [], policy: null,
  requisitions: [], lines: [], subscriptions: [], invoices: [], invoiceLines: [],
  currencies: [], rates: [],
}

/**
 * The whole account in one read.
 *
 * Approvals cannot be drawn without the policy and the members — a screen that
 * fetches requisitions alone can show a queue but cannot say who may act on
 * it, which is the only question the queue exists to answer.
 */
export async function loadAccount(): Promise<AccountBook> {
  const { data: session } = await supabase.auth.getUser()
  const uid = session.user?.id ?? null

  const [a, u, ro, c, p, r, l, s, i, il, mc, fx] = await Promise.all([
    supabase.from('enterprise_accounts').select('*').maybeSingle(),
    supabase.from('enterprise_users').select('*').order('sort_order'),
    supabase.from('enterprise_roles').select('*').order('sort_order'),
    supabase.from('enterprise_cost_centres').select('*').order('sort_order'),
    supabase.from('enterprise_approval_policy').select('*').maybeSingle(),
    supabase.from('enterprise_requisitions').select('*').order('sort_order'),
    supabase.from('enterprise_requisition_lines').select('*').order('sort_order'),
    supabase.from('enterprise_subscriptions').select('*').order('sort_order'),
    supabase.from('enterprise_invoices').select('*').order('sort_order'),
    supabase.from('enterprise_invoice_lines').select('*').order('sort_order'),
    supabase.from('market_currencies').select('*').order('sort_order'),
    supabase.from('fx_rates').select('*').order('as_of'),
  ])

  const errors: string[] = []
  const grab = <T>(res: { data: unknown; error: { message: string } | null }, what: string): T[] => {
    if (res.error) errors.push(`${what}: ${res.error.message}`)
    return (res.data ?? []) as T[]
  }
  const members = grab<Member>(u, 'your colleagues')
  const account = (a.data ?? null) as Account | null

  return {
    ...EMPTY,
    account,
    me: members.find(m => m.user_id === uid) ?? null,
    members,
    roles: grab<EnterpriseRole>(ro, 'roles'),
    centres: grab<CostCentre>(c, 'cost centres'),
    policy: (p.data ?? null) as Policy | null,
    requisitions: grab<Requisition>(r, 'requisitions'),
    lines: grab<ReqLine>(l, 'requisition lines'),
    subscriptions: grab<Subscription>(s, 'subscriptions'),
    invoices: grab<Invoice>(i, 'invoices'),
    invoiceLines: grab<InvoiceLine>(il, 'invoice lines'),
    /* Empty rather than a guess when the account has not loaded. Falling back to
       its primary currency would be inventing an answer to "what may we pay in",
       and the screen would then offer a choice the guard has not agreed to. */
    currencies: account
      ? currenciesOf(account.market, grab<MarketCurrency>(mc, 'market currencies'))
      : [],
    /* PostgREST hands numerics back as strings, and a rate that is a string
       multiplies to NaN — which converts every figure to nothing at all. */
    rates: grab<Rate>(fx, 'exchange rates').map(x => ({ ...x, rate: Number(x.rate) })),
    ...(a.error ? { loadError: `Your account did not load (${a.error.message}).` }
      : errors.length ? { loadError: `Some of this did not load (${errors.join('; ')}).` } : {}),
  }
}

/* ---------------------------------------------------------- requisitions -- */

/**
 * A decision, and the order it places.
 *
 * Approving *is* ordering — a separate "now place it" step is how a
 * requisition sits approved and unordered for a fortnight while everybody
 * assumes somebody else pressed it. So the order reference is written in the
 * same update as the decision.
 */
export async function decideRequisition(
  { req, me, policy, approve, note, currency, rates = [] }: {
    req: Requisition; me: Member; policy: Policy; approve: boolean; note: string
    /* The account's primary currency — what the approver's limit is set in, and
       what the requisition is judged against. */
    currency: string
    rates?: readonly Rate[]
  },
): Promise<Result> {
  /* An approver's limit is a chosen figure in the account's own money, so a
     requisition raised in another currency is converted at the fix in force
     when it was raised before being compared against it. `null` means there is
     no such rate, and `validateDecision` refuses rather than comparing. */
  const at = inPolicyMoney(req, currency, rates, req.raised_on)
  const check = validateDecision(req, me, policy, approve, note, currency, at)
  if (!check.ok) return check

  const { data, error } = await supabase.from('enterprise_requisitions').update({
    state: approve ? 'approved' : 'declined',
    decision_note: note.trim() || (approve ? 'Approved.' : null),
    /* decided_by and decided_on are stamped by the trigger, which knows who is
       signed in. Sending them from here would be asking the client to assert
       its own identity. */
    order_ref: approve ? orderRefFor(req) : null,
  }).eq('id', req.id).select('id')

  if (error) return { ok: false, reason: friendly(error.message) }
  if (!data?.length) return { ok: false, reason: REFUSED }
  return {
    ok: true,
    note: approve
      /* Named in the money it will actually be paid in, which is the
         requisition's own — the conversion was for the limit test, not for the
         seller. */
      ? `${req.id} approved — the order has gone to the seller and ${money(req.amount, req.currency)} is committed.`
      : `${req.id} declined. Nothing was ordered and the requester has been told why.`,
  }
}

/* Deterministic from the requisition rather than random, so re-running a
   decision that half-failed produces the same reference instead of a second
   order. */
function orderRefFor(req: Requisition): string {
  return `ORD-8821${req.id.replace(/\D/g, '').slice(-2)}`
}

export async function withdrawRequisition(req: Requisition, me: Member): Promise<Result> {
  if (req.state !== 'pending') {
    return { ok: false, reason: `${req.id} was already ${req.state}.` }
  }
  if (req.raised_by !== me.id) {
    return { ok: false, reason: `Only the person who raised ${req.id} can withdraw it.` }
  }
  const { data, error } = await supabase.from('enterprise_requisitions')
    .update({ state: 'withdrawn' }).eq('id', req.id).select('id')
  if (error) return { ok: false, reason: friendly(error.message) }
  if (!data?.length) return { ok: false, reason: REFUSED }
  return { ok: true, note: `${req.id} withdrawn. Nothing was ordered.` }
}

export interface Draft {
  title: string
  reason: string
  /* What the lines are priced in. Any currency the account's market takes —
     `AccountBook.currencies` is that list, and it is what the form offers. */
  currency: string
  vertical: string
  cost_centre: string | null
  model: 'oneoff' | 'monthly'
  po_ref: string
  lines: {
    product_id: string | null; name: string; seller: string
    partner_id: string | null; quantity: number; unit_price: number
  }[]
}

/**
 * Raising a request to spend.
 *
 * `need` is worked out and stored here rather than recomputed on read, because
 * the policy can change afterwards. What matters at audit is what the policy
 * asked for on the day.
 */
export async function raiseRequisition(
  { draft, me, account, policy, currencies = [], rates = [] }: {
    draft: Draft; me: Member; account: Account; policy: Policy
    /* What this account's market takes. Checked here as well as by
       `guard_requisition_currency`, so the refusal is a sentence rather than a
       Postgres error string. */
    currencies?: readonly string[]
    rates?: readonly Rate[]
  },
): Promise<Result> {
  const check = validateRequisition(draft, me)
  if (!check.ok) return check

  const lines = draft.lines.filter(l => l.quantity > 0)
  const amount = requisitionTotal(lines)
  if (amount <= 0) return { ok: false, reason: 'That adds up to nothing — check the quantities' }

  const currency = draft.currency || account.currency
  if (currencies.length && !currencies.includes(currency)) {
    return {
      ok: false,
      reason: `This account contracts in ${account.market}, which does not trade in ${currency}. It takes ${currencies.join(' or ')}.`,
    }
  }

  if (account.po_required && !draft.po_ref.trim()) {
    return {
      ok: false,
      reason: 'This account requires a purchase order on every invoice, so one is needed before the order can be placed.',
    }
  }

  const today = new Date().toISOString().slice(0, 10)

  /* The threshold is set in the account's primary currency, so this is what the
     requisition is worth in that money. Refused rather than raised when there
     is no rate: a requisition whose `need` was decided on the wrong number is
     an approval nobody can rely on, and it would sit in the queue looking
     settled. */
  const at = inPolicyMoney({ amount, currency }, account.currency, rates, today)
  if (!at) {
    return {
      ok: false,
      reason: `There is no exchange rate on file for ${currency} to ${account.currency} on ${today}, so this cannot be checked against the ${money(policy.threshold, account.currency)} approval threshold.`,
    }
  }

  const need = needFor({ amount: at.amount, vertical: draft.vertical }, policy)
  const id = `REQ-${Math.floor(Date.now() / 1000).toString().slice(-4)}`

  const { error } = await supabase.from('enterprise_requisitions').insert({
    id, account_id: account.id, raised_by: me.id, raised_on: today, raised_at: 'Just now',
    title: draft.title.trim(), vertical: draft.vertical, cost_centre: draft.cost_centre,
    amount, currency, model: draft.model, reason: draft.reason.trim(),
    need, policy_note: policyNoteFor(need, at.amount, policy, account.currency, at), state: 'pending',
    po_ref: draft.po_ref.trim() || null,
    sort_order: 0,
  })
  if (error) return { ok: false, reason: friendly(error.message) }

  const { error: lineError } = await supabase.from('enterprise_requisition_lines').insert(
    lines.map((l, n) => ({
      id: `RL-${id.replace('REQ-', '')}-${n + 1}`,
      requisition_id: id, product_id: l.product_id, name: l.name, seller: l.seller,
      partner_id: l.partner_id, quantity: l.quantity, unit_price: l.unit_price,
      line_total: Math.round(l.quantity * l.unit_price * 100) / 100, sort_order: n + 1,
    })),
  )
  if (lineError) {
    /* A requisition with no lines is a request for an unnamed amount, which
       nobody can approve. Better to have neither than half of one. */
    await supabase.from('enterprise_requisitions').delete().eq('id', id)
    return { ok: false, reason: `That was not raised: ${friendly(lineError.message)}` }
  }

  return {
    ok: true,
    /* Nothing is ordered here, by either branch. This function writes a
       requisition in `pending`; `decideRequisition` is what stamps an
       `order_ref`, and `canDecide` lets the raiser themselves confirm a
       within-policy one because there is no approver to separate them from.
       The old wording said the order "has been placed", which would have sent
       a buyer to look for it in Orders and find nothing. */
    note: need === 'none'
      ? `${id} raised for ${money(amount, currency)}. It is within policy, so nobody else has to sign it — confirm it on Approvals and the order goes.`
      : `${id} raised for ${money(amount, currency)}. It needs ${need === 'both' ? 'finance approval and IT sign-off' : need === 'finance' ? 'finance approval' : 'IT sign-off'} before anything is ordered.`,
  }
}

/* --------------------------------------------------------------- policy -- */

/** Only the procurement lead can change this, and RLS says so too. */
export async function savePolicy(next: Policy, me: Member): Promise<Result> {
  if (me.role !== 'procurement-lead') {
    return { ok: false, reason: 'Only the procurement lead can change the approval policy.' }
  }
  if (next.threshold < 0) return { ok: false, reason: 'A threshold cannot be negative' }
  const { data, error } = await supabase.from('enterprise_approval_policy').update({
    threshold: next.threshold,
    security_signoff: next.security_signoff,
    duplicate_flag: next.duplicate_flag,
    auto_approve_renewals: next.auto_approve_renewals,
    self_approve: next.self_approve,
    note: next.note.trim(),
    updated_by: me.name,
    updated_on: new Date().toISOString().slice(0, 10),
  }).eq('account_id', next.account_id).select('account_id')
  if (error) return { ok: false, reason: friendly(error.message) }
  if (!data?.length) return { ok: false, reason: REFUSED }
  return { ok: true, note: 'Policy saved. It applies to requisitions raised from now on.' }
}

/* -------------------------------------------------------------- billing -- */

/** Paying is an outward-facing action against a real balance, so it is
    deliberately not a fire-and-forget button — the caller confirms first. */
export async function payInvoice(invoice: Invoice): Promise<Result> {
  if (invoice.status === 'paid') {
    return { ok: false, reason: `${invoice.id} was already paid on ${invoice.paid_on}.` }
  }
  const { data, error } = await supabase.from('enterprise_invoices').update({
    status: 'paid', paid_on: new Date().toISOString().slice(0, 10),
  }).eq('id', invoice.id).select('id')
  if (error) return { ok: false, reason: friendly(error.message) }
  if (!data?.length) return { ok: false, reason: REFUSED }
  return {
    ok: true,
    note: `${money(invoice.total, invoice.currency)} paid against ${invoice.id}. Remittance advice follows to the finance address on file.`,
  }
}

/** A buyer disagreeing with an invoice, which is not the same as refusing to
    pay it — the balance stands until somebody looks. */
export async function disputeInvoice(invoice: Invoice, why: string): Promise<Result> {
  if (!why.trim()) {
    return { ok: false, reason: 'Say what is wrong with it. "Disputed" with no reason cannot be investigated.' }
  }
  if (invoice.status === 'paid') {
    return { ok: false, reason: `${invoice.id} has been paid. Raise a refund against the order instead.` }
  }
  const { data, error } = await supabase.from('enterprise_invoices').update({
    status: 'disputed', note: why.trim(),
  }).eq('id', invoice.id).select('id')
  if (error) return { ok: false, reason: friendly(error.message) }
  if (!data?.length) return { ok: false, reason: REFUSED }
  return {
    ok: true,
    note: `${invoice.id} marked as disputed. The balance stands until it is settled, and nothing is suspended while it is open.`,
  }
}

/**
 * Stopping — or restarting — a subscription's automatic renewal.
 *
 * The only part of a subscription a buyer manages between renewals. Seats,
 * price, term and the contract reference are the record of what was agreed, and
 * the database refuses a write from an account that touches any of them, so
 * this cannot quietly become "edit your own contract" later.
 */
export async function setAutoRenew(sub: { id: string; name: string; renews: string }, on: boolean): Promise<Result> {
  const { data, error } = await supabase.from('enterprise_subscriptions')
    .update({ auto_renew: on }).eq('id', sub.id).select('id')
  if (error) return { ok: false, reason: friendly(error.message) }
  if (!data?.length) return { ok: false, reason: REFUSED }
  return {
    ok: true,
    note: on
      ? `${sub.name} will renew on ${sub.renews} as before.`
      : `${sub.name} will not renew. It runs to ${sub.renews} and then stops — nothing is switched off before then.`,
  }
}

/** The invoice as a document, because finance pays from a document. */
export function invoiceCsv(invoice: Invoice, lines: InvoiceLine[]): string {
  const head = ['Line', 'Kind', 'Description', 'Seller', 'Cost centre', 'Quantity', 'Unit price', 'Amount']
  const rows = lines
    .filter(l => l.invoice_id === invoice.id)
    .map((l, n) => [
      String(n + 1), l.kind, l.description, l.seller, l.cost_centre ?? 'Not allocated',
      l.quantity === null ? '' : String(l.quantity),
      l.unit_price === null ? '' : l.unit_price.toFixed(2),
      l.amount.toFixed(2),
    ])
  const foot = [
    ['', '', '', '', '', '', 'Subtotal', (invoice.recurring + invoice.oneoff).toFixed(2)],
    ['', '', '', '', '', '', `Tax (${invoice.tax_rate}%)`, invoice.tax.toFixed(2)],
    ['', '', '', '', '', '', 'Total', invoice.total.toFixed(2)],
  ]
  return [head, ...rows, ...foot]
    .map(r => r.map(c => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(','))
    .join('\n')
}

/* ------------------------------------------------ what a business may buy -- */

/**
 * The catalogue a business sees, priced in the money it is invoiced in.
 *
 * Both enterprise catalogue screens read a constant in `data.ts` — twelve
 * objects with dollar prices and SKU ids that collide with real products
 * (`SKU-3001` was "6D Connect IoT SIM 100-pack" there and "StreamNova Premium
 * 4K" in `products`), so a requisition raised from that screen would have named
 * a consumer streaming subscription.
 *
 * `audiences` already says who may buy each product and `product_prices` already
 * holds the figure per currency. Nothing had to be invented — the constant was
 * a second catalogue nobody was maintaining.
 */
export interface EnterpriseListing {
  id: string
  name: string
  category_id: string
  sub_category: string | null
  seller: string
  partner_id: string | null
  price: number
  currency: string
  model: string
  unit: string | null
  rating: number
  reviews: number
  stock: string
  description: string
}

export async function loadEnterpriseCatalogue(currency: string): Promise<EnterpriseListing[]> {
  const [p, book, copy] = await Promise.all([
    supabase.from('products').select('*')
      .contains('audiences', ['enterprise']).eq('status', 'live').order('sort_order'),
    loadPriceBook(currency),
    loadCopyBook(),
  ])
  type Row = {
    id: string; name: string; category_id: string; sub_category: string | null
    seller: string; partner_id: string | null; price: number; model: string
    unit: string | null; rating: number | null; reviews: number | null
    stock: string; description: string | null
  }
  return ((p.data ?? []) as Row[]).map(r => {
    const priced = book.get(r.id)
    return {
      id: r.id, name: r.name, category_id: r.category_id, sub_category: r.sub_category,
      seller: r.seller, partner_id: r.partner_id,
      /* The book's figure, or the base row if the book does not price it there.
         Converting on the spot would put an unrounded number on a shelf beside
         chosen ones — the same rule `reprice` follows for the storefront. */
      price: priced ? priced.price : Number(r.price),
      currency: priced ? currency : 'USD',
      model: r.model, unit: r.unit,
      rating: Number(r.rating ?? 0), reviews: Number(r.reviews ?? 0),
      stock: r.stock,
      /* The copy for this account's currency, falling back to the base row —
         a pooled-data overage rate is a price and is set per market. */
      description: describeIn({ id: r.id, description: r.description ?? '' }, copy, currency),
    }
  })
}

/* --------------------------------------------------------------- helpers -- */

/**
 * The message for a write that changed nothing.
 *
 * RLS does not raise on an update it disallows — it narrows the rows the
 * statement can see, so a forbidden update matches nothing and returns
 * success. Trusting `!error` would have the screen announce that an invoice
 * was paid while the row sat untouched, which is worse than an error. Every
 * write here asks for the affected rows back and treats none as a refusal.
 */
const REFUSED = 'Nothing changed — you are not allowed to make that change on this account.'

/** The database refuses in its own words on purpose — `guard_requisition()`'s
    messages are written to be read. This strips the Postgres wrapper. */
function friendly(message: string): string {
  const m = message.replace(/^.*?\bERROR:\s*/i, '').trim()
  if (/row-level security/i.test(m)) {
    return 'You are not allowed to change that on this account.'
  }
  if (/duplicate key/i.test(m)) return 'That already exists.'
  return m
}
