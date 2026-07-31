/* The only module that reads or writes refunds.
   Rules live in refunds.ts so they can be tested without a network. */

import { supabase } from './supabase'
import {
  STATES, REASONS, canDecide, validateDecision, applyDecision, escalationDue, ownership,
} from './refunds'
import type { Refund, RefundPolicy, RefundReason, Decision } from './refunds'

export type Result = { ok: true; note?: string } | { ok: false; reason: string }

export interface RefundWindow { category_id: string; days: number; note: string }

export interface RefundBook {
  refunds: Refund[]
  policy: RefundPolicy | null
  windows: RefundWindow[]
  loadError?: string
}

/* The policy is the same for everybody, so it is fetched with every view rather
   than passed around — a screen that reasons about an SLA it has not read is a
   screen that will one day quote the wrong one. */
async function loadRules(): Promise<{ policy: RefundPolicy | null; windows: RefundWindow[]; errors: string[] }> {
  const [p, w] = await Promise.all([
    supabase.from('refund_policy').select('*').eq('id', 'current').maybeSingle(),
    supabase.from('refund_windows').select('*'),
  ])
  const errors: string[] = []
  if (p.error) errors.push(`refund policy: ${p.error.message}`)
  if (w.error) errors.push(`refund windows: ${w.error.message}`)
  return {
    policy: (p.data ?? null) as RefundPolicy | null,
    windows: (w.data ?? []) as RefundWindow[],
    errors,
  }
}

/** Every refund raised against one seller's products, decided or not. Hiding
    the decided ones would hide what the marketplace decided for them. */
export async function loadSellerRefunds(partnerId: string): Promise<RefundBook> {
  const [res, rules] = await Promise.all([
    supabase.from('refunds').select('*').eq('partner_id', partnerId).order('sort_order'),
    loadRules(),
  ])
  const errors = [...rules.errors]
  if (res.error) errors.push(`refunds: ${res.error.message}`)
  return {
    refunds: (res.data ?? []) as Refund[],
    policy: rules.policy,
    windows: rules.windows,
    ...(errors.length > 0 ? { loadError: `Some of this did not load (${errors.join('; ')}).` } : {}),
  }
}

/** The whole book, for the marketplace. */
export async function loadAllRefunds(): Promise<RefundBook> {
  const [res, rules] = await Promise.all([
    supabase.from('refunds').select('*').order('sort_order'),
    loadRules(),
  ])
  const errors = [...rules.errors]
  if (res.error) errors.push(`refunds: ${res.error.message}`)
  return {
    refunds: (res.data ?? []) as Refund[],
    policy: rules.policy,
    windows: rules.windows,
    ...(errors.length > 0 ? { loadError: `Some of this did not load (${errors.join('; ')}).` } : {}),
  }
}

/** A customer's own. */
export async function loadMyRefunds(): Promise<RefundBook> {
  const { data: session } = await supabase.auth.getSession()
  const uid = session.session?.user.id
  if (!uid) return { refunds: [], policy: null, windows: [] }
  const [res, rules] = await Promise.all([
    supabase.from('refunds').select('*').eq('user_id', uid).order('requested', { ascending: false }),
    loadRules(),
  ])
  const errors = [...rules.errors]
  if (res.error) errors.push(`refunds: ${res.error.message}`)
  return {
    refunds: (res.data ?? []) as Refund[],
    policy: rules.policy,
    windows: rules.windows,
    ...(errors.length > 0 ? { loadError: `Some of this did not load (${errors.join('; ')}).` } : {}),
  }
}

/**
 * A decision, made once, written the same way from either console.
 *
 * `as` is the persona doing it rather than a claim about who may: the rules
 * module decides that, and it refuses a seller who has already lost the
 * decision to the clock.
 */
export async function decideRefund(
  { refund, decision, refunded, note, by, as }: {
    refund: Refund
    decision: Decision
    refunded: number
    note: string
    by: string
    as: 'seller' | 'marketplace'
  },
): Promise<Result> {
  const allowed = canDecide(refund, as)
  if (!allowed.ok) return allowed

  const valid = validateDecision({
    decision, amount: Number(refund.amount), refunded,
    note, reason: refund.reason, evidence: refund.evidence,
  })
  if (!valid.ok) return valid

  const outcome = applyDecision({ decision, refunded })
  const { error } = await supabase.from('refunds').update({
    state: outcome.state,
    refunded: outcome.refunded,
    decided_on: new Date().toISOString().slice(0, 10),
    decided_by: by,
    decision_note: note.trim(),
  }).eq('id', refund.id)
  if (error) return { ok: false, reason: `That did not save: ${error.message}` }

  await writeAudit(by, `refund.${decision}d`, refund.id,
    decision === 'decline' ? 'warn' : 'notice',
    `${refund.customer} · ${refund.item} · $${Number(refund.amount).toFixed(2)} — ${note.trim()}`)

  if (decision === 'approve') {
    return { ok: true, note: `Agreed. $${Number(refund.amount).toFixed(2)} is queued back to the instrument that paid, and it comes off ${as === 'marketplace' && refund.first_party ? 'the marketplace' : 'your'} next settlement.` }
  }
  if (decision === 'partial') {
    return { ok: true, note: `$${refunded.toFixed(2)} of $${Number(refund.amount).toFixed(2)} refunded. The customer sees the difference and your explanation of it.` }
  }
  return { ok: true, note: 'Declined, with your reason sent to the customer. They can escalate it to the marketplace.' }
}

/**
 * The marketplace taking a decision off a seller who did not make it.
 *
 * This is what the clock does, expressed as a call somebody can also make by
 * hand. It is not a punishment and the money still follows the sale — it just
 * stops the customer waiting on a seller who has stopped answering.
 */
export async function escalateRefund(
  { refund, policy, by, why }: {
    refund: Refund; policy: RefundPolicy; by: string; why?: string
  },
): Promise<Result> {
  if (refund.state !== 'requested') {
    return { ok: false, reason: `This is ${STATES[refund.state].label.toLowerCase()}, so there is nothing to take over.` }
  }
  if (ownership(refund).owner === 'marketplace') {
    return { ok: false, reason: 'The marketplace already owns this one.' }
  }
  const due = escalationDue(refund, policy, new Date())
  const reason = why?.trim()
    || (due
      ? `Unresolved more than ${policy.escalate_after_hours} hours after it was raised, past the escalation clock.`
      : '')
  if (!reason) {
    return {
      ok: false,
      reason: `The clock has not run out on this one yet — the seller has until ${refund.sla_due} plus the ${policy.escalate_after_hours}-hour window. Taking it early needs a reason on the record.`,
    }
  }

  const { error } = await supabase.from('refunds').update({
    state: 'escalated',
    decider: 'marketplace',
    escalated_on: new Date().toISOString().slice(0, 10),
    escalated_why: reason,
  }).eq('id', refund.id)
  if (error) return { ok: false, reason: `That did not save: ${error.message}` }

  await writeAudit(by, 'refund.escalated', refund.id, 'warn',
    `${refund.seller} · ${refund.customer} · $${Number(refund.amount).toFixed(2)} — ${reason}`)
  return { ok: true, note: `The marketplace decides this now. ${refund.seller} has been told why.` }
}

/** Money actually leaving. Separate from approving it, because saying
    "refunded" before the payment run has is how a customer is told twice that
    they have been paid and is not. */
export async function markRefundPaid(refund: Refund, by: string): Promise<Result> {
  if (refund.state !== 'approved') {
    return { ok: false, reason: 'Only an agreed refund can be paid. This one has not been agreed.' }
  }
  const { error } = await supabase.from('refunds').update({
    state: 'refunded',
    refunded: refund.amount,
    decided_by: refund.decided_by ?? by,
  }).eq('id', refund.id)
  if (error) return { ok: false, reason: `That did not save: ${error.message}` }
  await writeAudit(by, 'refund.paid', refund.id, 'notice',
    `$${Number(refund.amount).toFixed(2)} returned to ${refund.customer}`)
  return { ok: true, note: `$${Number(refund.amount).toFixed(2)} returned to the instrument that paid.` }
}

/**
 * A customer asking for their money back.
 *
 * Who decides is settled here rather than argued about later: the marketplace
 * takes what it sold itself, and a claim that decides itself is decided on the
 * spot rather than made to wait two days for a person to agree with the payment
 * records.
 */
export async function requestRefund(
  { order, policy, reason, detail, evidence }: {
    order: {
      order_ref: string; product_id: string; item: string; category_id: string | null
      partner_id: string | null; seller: string; first_party: boolean
      customer: string; amount: number
    }
    policy: RefundPolicy
    reason: RefundReason
    detail: string
    evidence: string
  },
): Promise<Result> {
  if (detail.trim().split(/\s+/).filter(Boolean).length < 6) {
    return { ok: false, reason: `Say what went wrong in a line or two. "${REASONS[reason].label}" on its own gives the seller nothing to check.` }
  }

  const { data: session } = await supabase.auth.getSession()
  const uid = session.session?.user.id
  if (!uid) return { ok: false, reason: 'Sign in to raise a refund.' }

  const auto = policy.auto_approve_reasons.includes(reason) || order.amount < policy.auto_approve_below
  const today = new Date()
  const due = new Date(today.getTime() + policy.seller_sla_hours * 3600000)
  const iso = (d: Date) => d.toISOString().slice(0, 10)

  const decider = auto ? 'auto' : order.first_party ? 'marketplace' : 'seller'
  const state = auto ? 'approved' : 'requested'

  const { error } = await supabase.from('refunds').insert({
    id: `RFN-${Date.now().toString(36).slice(-5).toUpperCase()}`,
    order_ref: order.order_ref, product_id: order.product_id, item: order.item,
    category_id: order.category_id, partner_id: order.partner_id, seller: order.seller,
    first_party: order.first_party, customer: order.customer,
    buyer_type: 'consumer', user_id: uid,
    amount: order.amount, refunded: null, reason,
    detail: detail.trim(), evidence: evidence.trim() || null,
    requested: iso(today), decider, sla_due: iso(due), state,
    decided_on: auto ? iso(today) : null,
    decided_by: auto ? 'Auto' : null,
    decision_note: auto
      ? (policy.auto_approve_reasons.includes(reason)
          ? `${REASONS[reason].label} is provable from the payment record and is never a judgement call, so it approved itself.`
          : `Under the $${Number(policy.auto_approve_below).toFixed(2)} threshold, where arguing about it costs both sides more than the refund.`)
      : null,
    sort_order: 0,
  })
  if (error) return { ok: false, reason: `That was not raised: ${error.message}` }

  return {
    ok: true,
    note: auto
      ? `Agreed on the spot. $${order.amount.toFixed(2)} is queued back to the instrument that paid.`
      : `Raised. ${order.first_party ? 'The marketplace' : order.seller} owes you an answer by ${iso(due)}, and if none comes the marketplace takes the decision itself.`,
  }
}

async function writeAudit(
  actor: string, action: string, object: string, severity: string, detail: string,
): Promise<void> {
  await supabase.from('operator_audit_log').insert({
    id: `AUD-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    actor, role: 'Refunds', action, object,
    category: 'Commercial', severity, outcome: 'success',
    before_val: null, after_val: detail,
  })
}
