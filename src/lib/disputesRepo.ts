/* The dispute desk's book, and the one act it performs.
 *
 * Reading pulls the cases and, separately, the flags at each source — because
 * the check worth having is whether those two agree. A flag with no case is a
 * buyer waiting for an answer nobody is working on; a case with no flag is an
 * argument the source has already forgotten.
 *
 * Writing is one function. Closing a dispute sets the outcome and the answer,
 * and a trigger releases whatever the source was holding: an invoice goes back
 * to payable, a statement stops being disputed, a note either voids or
 * reinstates depending on who won. That release is deliberately not done here —
 * a screen that cleared the flags itself could clear them without closing the
 * case, which is the disagreement this whole model exists to prevent.
 */

import { supabase } from './supabase'
import type { DisputeRow, DisputeOutcome, DisputeKind } from './disputes'

const NUM = ['amount', 'sort_order']

const num = <T,>(row: T, keys: readonly string[]): T => {
  const out = { ...row } as Record<string, unknown>
  for (const k of keys) if (out[k] != null) out[k] = Number(out[k])
  return out as T
}

/** What a case points at, resolved enough to show a desk without a second click. */
export interface Subject {
  kind: DisputeKind
  ref: string
  who: string
  what: string
  amount: number
  currency: string
  state: string
}

export interface DisputeBook {
  disputes: DisputeRow[]
  /* The disputed flags, straight from the sources. Kept apart from the cases so
     the two can be compared rather than assumed equal. */
  flagged: { kind: DisputeKind; ref: string }[]
  subjects: Subject[]
  loadError?: string
}

export async function loadDisputeBook(): Promise<DisputeBook> {
  const [d, o, i, s, n] = await Promise.all([
    supabase.from('disputes').select('*').order('raised', { ascending: false }),
    supabase.from('orders').select('order_ref,buyer_name,seller,total,currency,status'),
    supabase.from('enterprise_invoices').select('id,account_id,period,total,currency,status,due'),
    supabase.from('settlement_statements').select('id,partner_name,period,net,currency,status,disputed'),
    supabase.from('settlement_note').select('id,partner_id,kind,reason_id,amount,currency,state,detail'),
  ])

  const errors: string[] = []
  if (d.error) errors.push(`the disputes: ${d.error.message}`)
  if (o.error) errors.push(`the orders: ${o.error.message}`)

  const orders = (o.data ?? []) as { order_ref: string; buyer_name: string | null; seller: string | null; total: string; currency: string; status: string }[]
  const invoices = (i.data ?? []) as { id: string; account_id: string; period: string; total: string; currency: string; status: string; due: string }[]
  const statements = (s.data ?? []) as { id: string; partner_name: string; period: string; net: string; currency: string; status: string; disputed: boolean }[]
  const notes = (n.data ?? []) as { id: string; partner_id: string; kind: string; amount: string; currency: string; state: string; detail: string }[]

  const subjects: Subject[] = [
    ...orders.map(x => ({
      kind: 'order' as const, ref: x.order_ref, who: x.buyer_name ?? '—',
      what: x.seller ? `Sold by ${x.seller}` : 'Marketplace order',
      amount: Number(x.total), currency: x.currency, state: x.status,
    })),
    ...invoices.map(x => ({
      kind: 'invoice' as const, ref: x.id, who: x.account_id,
      what: `${x.period}, due ${x.due}`,
      amount: Number(x.total), currency: x.currency, state: x.status,
    })),
    ...statements.map(x => ({
      kind: 'statement' as const, ref: x.id, who: x.partner_name,
      what: `${x.period} settlement`,
      amount: Number(x.net), currency: x.currency, state: x.status,
    })),
    ...notes.map(x => ({
      kind: 'note' as const, ref: x.id, who: x.partner_id,
      what: x.detail, amount: Number(x.amount), currency: x.currency, state: x.state,
    })),
  ]

  return {
    disputes: ((d.data ?? []) as DisputeRow[]).map(x => num(x, NUM)),
    flagged: [
      ...invoices.filter(x => x.status === 'disputed').map(x => ({ kind: 'invoice' as const, ref: x.id })),
      ...statements.filter(x => x.disputed).map(x => ({ kind: 'statement' as const, ref: x.id })),
      ...notes.filter(x => x.state === 'disputed').map(x => ({ kind: 'note' as const, ref: x.id })),
    ],
    subjects,
    ...(errors.length ? { loadError: `Some of the dispute book did not load (${errors.join('; ')}).` } : {}),
  }
}

/**
 * Close one, with an outcome and an answer.
 *
 * `rejected` rather than `resolved` when the claim did not stand, because the
 * two read completely differently to the person who raised it and collapsing
 * them into one word loses the only thing they wanted to know.
 */
export async function closeDispute(
  id: string, outcome: DisputeOutcome, resolution: string,
): Promise<{ ok: boolean; why?: string }> {
  if (!resolution.trim()) {
    return { ok: false, why: 'Say how it was resolved. The person who raised it is owed an answer.' }
  }
  const { error } = await supabase.from('disputes').update({
    status: outcome === 'upheld_seller' || outcome === 'withdrawn' ? 'rejected' : 'resolved',
    outcome,
    resolution: resolution.trim(),
    resolved_on: new Date().toISOString().slice(0, 10),
  }).eq('id', id)
  return error ? { ok: false, why: error.message } : { ok: true }
}

/** Hand it to whoever has to answer next, and move the clock with it. */
export async function reassign(
  id: string, owner: 'seller' | 'marketplace' | 'buyer', days: number,
): Promise<{ ok: boolean; why?: string }> {
  const due = new Date(Date.now() + days * 86400000).toISOString().slice(0, 10)
  const status = owner === 'seller' ? 'awaiting_seller'
    : owner === 'marketplace' ? 'awaiting_marketplace' : 'open'
  const { error } = await supabase.from('disputes')
    .update({ owner, status, due_on: due }).eq('id', id)
  return error ? { ok: false, why: error.message } : { ok: true }
}

/** Add to what is known about it without deciding it. */
export async function addDetail(id: string, note: string): Promise<{ ok: boolean; why?: string }> {
  if (!note.trim()) return { ok: false, why: 'Nothing to add.' }
  const { data } = await supabase.from('disputes').select('detail').eq('id', id).maybeSingle()
  const before = (data as { detail: string | null } | null)?.detail ?? ''
  const stamp = new Date().toISOString().slice(0, 10)
  const { error } = await supabase.from('disputes')
    .update({ detail: `${before}\n\n[${stamp}] ${note.trim()}`.trim() }).eq('id', id)
  return error ? { ok: false, why: error.message } : { ok: true }
}
