/* The only module that reads or writes the loyalty programme from the seller's
   or the marketplace's side. Rules live in sellerRewards.ts. */

import { supabase } from './supabase'
import { validateProposal, canWithdraw, validateApproval, validateRejection } from './sellerRewards'
import type { EarnRule, Movement, Programme, Proposal, Funder, PointRate } from './sellerRewards'

export type Result = { ok: true; note?: string } | { ok: false; reason: string }

/* PostgREST hands numerics back as strings, and a rate that is a string divides
   to NaN — which renders as "NaN" rather than failing. */
const numeric = (rows: PointRate[]): PointRate[] =>
  rows.map(r => ({ ...r, earn_per_unit: Number(r.earn_per_unit), per_unit: Number(r.per_unit) }))

export interface SellerRewards {
  movements: Movement[]
  rules: EarnRule[]
  programme: Programme | null
  /* What a point is worth in each currency. A seller sells into more than one
     market, so what a rule costs them is a different figure per market. */
  rates: PointRate[]
  loadError?: string
}

/**
 * What the programme costs one seller.
 *
 * The movements come back under the seller's own row-level security — their
 * products, their cost, nothing about another seller's customers. The rules
 * come back whole because they are the published terms everybody trades under;
 * the screen filters them to the ones that can cost this seller money.
 */
export async function loadSellerRewards(partnerId: string): Promise<SellerRewards> {
  const [mv, rules, prog, rates] = await Promise.all([
    supabase.from('loyalty_ledger').select('*').eq('seller_id', partnerId).order('when_date', { ascending: false }),
    supabase.from('loyalty_earn_rules').select('*').order('id'),
    supabase.from('loyalty_programme').select('*').maybeSingle(),
    supabase.from('loyalty_point_rates').select('*'),
  ])
  const errors: string[] = []
  if (mv.error) errors.push(`movements: ${mv.error.message}`)
  if (rules.error) errors.push(`rules: ${rules.error.message}`)
  if (prog.error) errors.push(`programme: ${prog.error.message}`)
  if (rates.error) errors.push(`what a point is worth: ${rates.error.message}`)
  return {
    movements: (mv.data ?? []) as Movement[],
    rules: (rules.data ?? []) as EarnRule[],
    programme: (prog.data ?? null) as Programme | null,
    rates: numeric((rates.data ?? []) as PointRate[]),
    ...(errors.length > 0 ? { loadError: `Some of this did not load (${errors.join('; ')}).` } : {}),
  }
}

export interface ProgrammeBook extends SellerRewards {
  members: { id: string; name: string; kind: string; tier: string; balance: number; currency: string }[]
}

/** The whole programme, for the marketplace. */
export async function loadProgramme(): Promise<ProgrammeBook> {
  const [mv, rules, prog, members, rates] = await Promise.all([
    supabase.from('loyalty_ledger').select('*').order('when_date', { ascending: false }),
    supabase.from('loyalty_earn_rules').select('*').order('id'),
    supabase.from('loyalty_programme').select('*').maybeSingle(),
    /* `currency` is what makes the liability rollup a set of debts rather than
       one number nobody can pay. */
    supabase.from('loyalty_members').select('id,name,kind,tier,balance,currency'),
    supabase.from('loyalty_point_rates').select('*'),
  ])
  const errors: string[] = []
  if (mv.error) errors.push(`movements: ${mv.error.message}`)
  if (rules.error) errors.push(`rules: ${rules.error.message}`)
  if (prog.error) errors.push(`programme: ${prog.error.message}`)
  if (members.error) errors.push(`members: ${members.error.message}`)
  if (rates.error) errors.push(`what a point is worth: ${rates.error.message}`)
  return {
    movements: (mv.data ?? []) as Movement[],
    rules: (rules.data ?? []) as EarnRule[],
    programme: (prog.data ?? null) as Programme | null,
    members: (members.data ?? []) as ProgrammeBook['members'],
    rates: numeric((rates.data ?? []) as PointRate[]),
    ...(errors.length > 0 ? { loadError: `Some of this did not load (${errors.join('; ')}).` } : {}),
  }
}

/**
 * A seller proposing to spend their own margin.
 *
 * It arrives as `pending` and funded by the seller, and the insert policy
 * refuses anything else — so this is safe even though the seller is the one
 * writing it. Nothing issues under a rule until the marketplace approves it.
 */
export async function proposeRule(
  { partnerId, proposal, by, existing }: {
    partnerId: string; proposal: Proposal; by: string; existing: readonly EarnRule[]
  },
): Promise<Result> {
  const check = validateProposal(proposal)
  if (!check.ok) return check

  const mine = existing.filter(r => r.scope === 'partner' && r.scope_id === partnerId)
  if (mine.some(r => r.status === 'pending' && r.proposed_by)) {
    return {
      ok: false,
      reason: 'You already have a proposal waiting on the marketplace. Withdraw it or wait for an answer — two at once only slows both down.',
    }
  }

  const n = existing.length + 1
  const { error } = await supabase.from('loyalty_earn_rules').insert({
    id: `ERN-${String(n).padStart(2, '0')}-${Date.now().toString(36).slice(-3).toUpperCase()}`,
    name: proposal.name.trim(),
    scope: 'partner', scope_id: partnerId,
    rate: proposal.rate, funder: 'partner', split: null, status: 'pending',
    from: proposal.from || todayLabel(),
    to: proposal.to || null,
    cap_per_order: proposal.capPerOrder, cap_per_month: null,
    audience: 'all', why: proposal.why.trim(),
    proposed_by: by, proposed_on: new Date().toISOString().slice(0, 10),
  })
  if (error) return { ok: false, reason: `That was not sent: ${error.message}` }
  return {
    ok: true,
    note: 'Sent to the marketplace. It issues nothing until they approve it, so nothing is costing you yet.',
  }
}

export async function withdrawProposal(rule: EarnRule): Promise<Result> {
  const check = canWithdraw(rule)
  if (!check.ok) return check
  const { error } = await supabase.from('loyalty_earn_rules').delete().eq('id', rule.id)
  if (error) return { ok: false, reason: `That was not withdrawn: ${error.message}` }
  return { ok: true, note: `${rule.name} withdrawn. Nothing had been issued under it.` }
}

/**
 * The marketplace answering a proposal.
 *
 * It may agree to carry part of the cost — that is what moving the funder to
 * shared means — but not to carry all of it: a seller's proposal reclassified
 * as marketplace-funded is a different rule with a different budget behind it.
 */
export async function approveProposal(
  { rule, funder, split, note, by }: {
    rule: EarnRule; funder: Funder; split: number | null; note: string; by: string
  },
): Promise<Result> {
  const check = validateApproval(rule, { funder, split, note })
  if (!check.ok) return check

  const { error } = await supabase.from('loyalty_earn_rules').update({
    status: 'active',
    funder,
    split: funder === 'shared' ? split : null,
    decided_by: by,
    decided_on: new Date().toISOString().slice(0, 10),
    decision_note: note.trim(),
  }).eq('id', rule.id)
  if (error) return { ok: false, reason: `That was not approved: ${error.message}` }

  await writeAudit(by, 'reward.rule', rule.id, 'warn',
    `${rule.name} approved — ${rule.rate}× funded ${funder === 'shared' ? `${100 - (split ?? 0)}/${split} with the seller` : 'by the seller'}. ${note.trim()}`)
  return {
    ok: true,
    note: funder === 'shared'
      ? `Approved, with the marketplace carrying ${split}%. The seller is told the split changed.`
      : 'Approved as proposed. It starts issuing on its start date.',
  }
}

export async function rejectProposal(
  { rule, note, by }: { rule: EarnRule; note: string; by: string },
): Promise<Result> {
  const check = validateRejection(note)
  if (!check.ok) return check
  const { error } = await supabase.from('loyalty_earn_rules').update({
    status: 'paused',
    decided_by: by,
    decided_on: new Date().toISOString().slice(0, 10),
    decision_note: note.trim(),
  }).eq('id', rule.id)
  if (error) return { ok: false, reason: `That was not recorded: ${error.message}` }
  await writeAudit(by, 'reward.rule', rule.id, 'warn', `${rule.name} refused — ${note.trim()}`)
  return { ok: true, note: 'Refused, with the reason sent back to the seller.' }
}

/** Stopping a rule that is running. It never withdraws points already issued —
    a point is a liability from the moment it exists. */
export async function pauseRule(rule: EarnRule, by: string): Promise<Result> {
  if (rule.status !== 'active' && rule.status !== 'scheduled') {
    return { ok: false, reason: `${rule.name} is not running.` }
  }
  const { error } = await supabase.from('loyalty_earn_rules')
    .update({ status: 'paused' }).eq('id', rule.id)
  if (error) return { ok: false, reason: `That did not save: ${error.message}` }
  await writeAudit(by, 'reward.rule', rule.id, 'warn',
    `${rule.name} paused. Points already issued under it stand.`)
  return { ok: true, note: 'Paused. It issues nothing from now on; points already issued stand.' }
}

function todayLabel(): string {
  return new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

async function writeAudit(
  actor: string, action: string, object: string, severity: string, detail: string,
): Promise<void> {
  await supabase.from('operator_audit_log').insert({
    id: `AUD-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    actor, role: 'Rewards', action, object,
    category: 'Commercial', severity, outcome: 'success',
    before_val: null, after_val: detail,
  })
}
