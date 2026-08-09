/* Reading the credit file, and the two acts that change it.
 *
 * The position comes from a view rather than being assembled here: "over the
 * limit" is a fact about two moving numbers, and computing it in the browser
 * from three separate reads would give an answer that was true at three
 * different moments.
 *
 * Releasing a hold and carrying a shortfall both go through functions, because
 * each has a rule that cannot be enforced from a client — a release has to be
 * the operator's and has to carry a reason, and a carry has to move the money
 * to the right place rather than simply zero a figure somebody did not like.
 */

import { supabase } from './supabase'
import { dueFrom } from './credit'
import type { Position, Assessment, Security, CreditBand } from './credit'

const POS_NUM = ['credit_limit', 'deposit_held', 'owed', 'committed', 'exposure', 'headroom']
const ASS_NUM = ['limit_granted', 'deposit_required', 'reserve_pct']
const SEC_NUM = ['deposit_held', 'reserve_pct', 'reserve_held']

const num = <T,>(row: T, keys: readonly string[]): T => {
  const out = { ...row } as Record<string, unknown>
  for (const k of keys) if (out[k] != null) out[k] = Number(out[k])
  return out as T
}

/** A seller and what they are owed, so cover can be compared against it. */
export interface SellerLine {
  partner_id: string
  name: string
  status: string
  unpaid: number
  currency: string
}

export interface HeldRequisition {
  id: string
  account_id: string
  title: string
  amount: number
  currency: string
  raised_on: string
  credit_note: string | null
}

export interface CreditBook {
  positions: Position[]
  assessments: Assessment[]
  security: Security[]
  sellers: SellerLine[]
  held: HeldRequisition[]
  loadError?: string
}

export async function loadCreditBook(): Promise<CreditBook> {
  const [p, a, s, pt, st, hr] = await Promise.all([
    supabase.from('account_credit_position').select('*'),
    supabase.from('credit_assessment').select('*').order('reviewed_on', { ascending: false }),
    supabase.from('partner_security').select('*'),
    supabase.from('partners').select('id,name,status').eq('status', 'live'),
    supabase.from('settlement_statements')
      .select('partner_id,net,currency,status').in('status', ['open', 'pending']),
    supabase.from('enterprise_requisitions')
      .select('id,account_id,title,amount,currency,raised_on,credit_note')
      .eq('credit_hold', true),
  ])

  const errors: string[] = []
  if (p.error) errors.push(`the positions: ${p.error.message}`)
  if (a.error) errors.push(`the assessments: ${a.error.message}`)
  if (s.error) errors.push(`what is held from sellers: ${s.error.message}`)

  /* What each seller is owed and not yet paid. Grouped in one pass rather than a
     query per seller, and kept per currency so nothing is added across them. */
  const owed = new Map<string, { amount: number; currency: string }>()
  for (const row of (st.data ?? []) as { partner_id: string; net: string; currency: string }[]) {
    const held = owed.get(row.partner_id)
    owed.set(row.partner_id, {
      amount: Math.round(((held?.amount ?? 0) + Number(row.net)) * 100) / 100,
      currency: row.currency,
    })
  }

  return {
    positions: ((p.data ?? []) as Position[]).map(x => num(x, POS_NUM)),
    assessments: ((a.data ?? []) as Assessment[]).map(x => num(x, ASS_NUM)),
    security: ((s.data ?? []) as Security[]).map(x => num(x, SEC_NUM)),
    sellers: ((pt.data ?? []) as { id: string; name: string; status: string }[]).map(x => ({
      partner_id: x.id, name: x.name, status: x.status,
      unpaid: owed.get(x.id)?.amount ?? 0,
      currency: owed.get(x.id)?.currency ?? 'USD',
    })),
    held: ((hr.data ?? []) as HeldRequisition[]).map(x => num(x, ['amount'])),
    ...(errors.length ? { loadError: `Some of the credit file did not load (${errors.join('; ')}).` } : {}),
  }
}

/**
 * Let a held requisition through.
 *
 * The reason is not optional and the database says so too. A hold lifted for no
 * recorded reason is a limit that does not exist — the next person sees an
 * approved purchase over the limit and no account of why anybody was comfortable.
 */
export async function releaseHold(
  id: string, who: string, why: string,
): Promise<{ ok: boolean; why?: string }> {
  if (!why.trim()) {
    return { ok: false, why: 'Say what the release is against. An early payment, a director guarantee, a correction.' }
  }
  const { data, error } = await supabase.rpc('release_credit_hold', { p_req: id, p_who: who, p_why: why.trim() })
  if (error) return { ok: false, why: error.message }
  const r = (data ?? {}) as { ok?: boolean; why?: string }
  return { ok: r.ok === true, why: r.why }
}

/** Move a shortfall to the next period rather than invoicing a seller for it. */
export async function carryShortfall(
  statementId: string,
): Promise<{ ok: boolean; why?: string; carried?: number }> {
  const { data, error } = await supabase.rpc('carry_shortfall', { p_statement: statementId })
  if (error) return { ok: false, why: error.message }
  const r = (data ?? {}) as { ok?: boolean; why?: string; carried?: number }
  return { ok: r.ok === true, why: r.why, carried: r.carried }
}

/**
 * Record a new review, superseding the one before it.
 *
 * Superseded rather than overwritten. The previous view of an account is how
 * anybody judges whether this one is an improvement, and a credit file that only
 * holds the current opinion cannot be audited at all.
 */
export async function reassess(
  a: {
    account_id?: string; partner_id?: string; side: 'buyer' | 'seller'
    band: string; evidence: string; rationale: string; currency: string
    limit_granted?: number | null; deposit_required?: number | null; reserve_pct?: number | null
    reviewed_by: string
  },
): Promise<{ ok: boolean; why?: string }> {
  if (!a.evidence.trim() || !a.rationale.trim()) {
    return { ok: false, why: 'A review needs what you looked at and what you concluded. Either alone is an opinion.' }
  }
  const party = a.account_id ?? a.partner_id!
  const today = new Date().toISOString().slice(0, 10)
  /* Not a figure this call chooses. The cadence follows the band, `z_stamp_credit_review_due`
     is what writes it, and this is computed here only so the two copies of the
     date — the assessment and the billing row — go in agreeing. A reviewer who
     could pick their own next date could band an account high and then not look
     at it for a year, which is what the seed did to all of them. */
  const next = dueFrom(a.band as CreditBand, today)

  const { data: prior } = await supabase.from('credit_assessment')
    .select('id').or(`account_id.eq.${party},partner_id.eq.${party}`)
    .is('superseded_by', null).maybeSingle()

  const id = `CRA-${party.replace(/^(ENT|PTR)-/, '')}-${Date.now().toString(36).slice(-4)}`
  const { error } = await supabase.from('credit_assessment').insert({
    id,
    account_id: a.account_id ?? null,
    partner_id: a.partner_id ?? null,
    side: a.side,
    reviewed_on: today,
    reviewed_by: a.reviewed_by,
    evidence: a.evidence.trim(),
    band: a.band,
    rationale: a.rationale.trim(),
    currency: a.currency,
    limit_granted: a.limit_granted ?? null,
    deposit_required: a.deposit_required ?? null,
    reserve_pct: a.reserve_pct ?? null,
    next_review: next,
  })
  if (error) return { ok: false, why: error.message }

  if (prior) {
    await supabase.from('credit_assessment')
      .update({ superseded_by: id }).eq('id', (prior as { id: string }).id)
  }

  /* The limit is stored where enforcement reads it, so the review writes it
     rather than leaving two numbers to agree by hand. */
  if (a.account_id && a.limit_granted != null) {
    await supabase.from('enterprise_billing').update({
      credit_limit: a.limit_granted,
      credit_reviewed: today,
      credit_review_due: next,
    }).eq('account_id', a.account_id)
  }
  if (a.partner_id) {
    await supabase.from('partner_security').update({
      reserve_pct: a.reserve_pct ?? 0,
      why: a.rationale.trim(),
      reviewed_on: today,
    }).eq('partner_id', a.partner_id)
  }
  return { ok: true }
}
