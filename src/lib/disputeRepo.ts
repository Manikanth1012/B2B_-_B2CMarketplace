/* Disputes a seller is in, and their thread with the marketplace desk.
   Two different things sharing a screen: a dispute holds money, a message does
   not, and merging them would make every question look like a claim. */

import { supabase } from './supabase'

export interface Dispute {
  id: string
  partner_id: string
  order_ref: string
  product_id: string | null
  category_id: string | null
  reason: string
  detail: string | null
  buyer: string
  raised: string
  amount: number
  owner: 'seller' | 'marketplace' | 'buyer'
  status: 'open' | 'awaiting_seller' | 'awaiting_marketplace' | 'resolved' | 'rejected'
  due_on: string | null
  outcome: 'refunded' | 'redelivered' | 'partial' | 'upheld_seller' | 'withdrawn' | null
  resolution: string | null
  resolved_on: string | null
  sort_order: number
}

export interface PartnerMessage {
  id: string
  partner_id: string
  subject: string
  topic: 'settlement' | 'listing' | 'onboarding' | 'dispute' | 'technical' | 'other'
  body: string
  raised_by: string
  raised_at: string
  status: 'open' | 'answered' | 'closed'
  priority: 'normal' | 'urgent'
  ref: string | null
  answered_by: string | null
  answered_at: string | null
  answer: string | null
  sort_order: number
}

export const TOPICS: { id: PartnerMessage['topic']; label: string; desk: string }[] = [
  { id: 'settlement', label: 'Settlement or a payment', desk: 'Settlement desk' },
  { id: 'listing', label: 'A listing or the catalogue', desk: 'Catalogue desk' },
  { id: 'dispute', label: 'An open dispute', desk: 'Disputes desk' },
  { id: 'onboarding', label: 'Onboarding or eligibility', desk: 'Onboarding desk' },
  { id: 'technical', label: 'The API or an integration', desk: 'Developer support' },
  { id: 'other', label: 'Something else', desk: 'Marketplace support' },
]

export interface SupportSnapshot {
  disputes: Dispute[]
  messages: PartnerMessage[]
  loadError?: string
}

export async function loadPartnerSupport(partnerId: string): Promise<SupportSnapshot> {
  const [d, m] = await Promise.all([
    supabase.from('partner_disputes').select('*').eq('partner_id', partnerId).order('sort_order'),
    supabase.from('partner_messages').select('*').eq('partner_id', partnerId).order('sort_order'),
  ])
  const errors: string[] = []
  if (d.error) errors.push(`disputes: ${d.error.message}`)
  if (m.error) errors.push(`messages: ${m.error.message}`)
  return {
    disputes: (d.data ?? []) as Dispute[],
    messages: (m.data ?? []) as PartnerMessage[],
    ...(errors.length > 0 ? { loadError: `Could not load your support record (${errors.join('; ')}).` } : {}),
  }
}

export type Result = { ok: true; note?: string } | { ok: false; reason: string }

/**
 * A seller writing to the marketplace.
 *
 * The topic is not decoration — it decides which desk reads it. A general
 * inbox somebody triages by reading is how a settlement question waits four
 * days behind a listing query.
 */
export async function contactMarketplace(
  { partnerId, subject, topic, body, raisedBy, ref, urgent }: {
    partnerId: string
    subject: string
    topic: PartnerMessage['topic']
    body: string
    raisedBy: string
    ref?: string | null
    urgent?: boolean
  },
): Promise<Result> {
  if (!subject.trim()) return { ok: false, reason: 'Give it a subject — it is what the desk sees first.' }
  if (body.trim().length < 20) {
    return { ok: false, reason: 'Say a bit more. A line the desk has to come back and ask about takes two days rather than one.' }
  }

  const { error } = await supabase.from('partner_messages').insert({
    id: `PMS-${Date.now().toString(36).slice(-5).toUpperCase()}`,
    partner_id: partnerId, subject: subject.trim(), topic, body: body.trim(),
    raised_by: raisedBy, raised_at: new Date().toISOString().slice(0, 10),
    status: 'open', priority: urgent ? 'urgent' : 'normal',
    ref: ref ?? null, sort_order: 0,
  })
  if (error) return { ok: false, reason: `That did not send: ${error.message}` }

  const desk = TOPICS.find(t => t.id === topic)?.desk ?? 'Marketplace support'
  return { ok: true, note: `Sent to the ${desk}. You will get a reply here rather than by email.` }
}

/** What a seller is being held for, and what it has cost them historically.
    The held figure is the one that matters — it is their money, withheld. */
export function disputeSummary(disputes: readonly Dispute[]): {
  open: number; held: number; resolved: number; wonPct: number | null; totalClosed: number
} {
  const live = disputes.filter(d => !['resolved', 'rejected'].includes(d.status))
  const closed = disputes.filter(d => ['resolved', 'rejected'].includes(d.status))
  /* "Won" means the seller did not pay: upheld, withdrawn, or redelivered at
     their own cost without a deduction. Refunded and partial cost them. */
  const won = closed.filter(d => ['upheld_seller', 'withdrawn', 'redelivered'].includes(d.outcome ?? ''))
  return {
    open: live.length,
    held: +live.reduce((n, d) => n + Number(d.amount), 0).toFixed(2),
    resolved: closed.length,
    totalClosed: closed.length,
    wonPct: closed.length === 0 ? null : Math.round((won.length / closed.length) * 1000) / 10,
  }
}

export const OUTCOME_LABEL: Record<string, string> = {
  refunded: 'Refunded to the buyer',
  redelivered: 'Replaced at the seller’s cost',
  partial: 'Partially refunded',
  upheld_seller: 'Decided in the seller’s favour',
  withdrawn: 'Withdrawn by the buyer',
}
