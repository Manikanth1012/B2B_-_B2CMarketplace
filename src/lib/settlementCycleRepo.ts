/* Reading the contracted cycles, and firing a run.
 *
 * The run itself is `run_settlements` in the database and not here, for the
 * same reason `settle_payment_attempt` is: a run writes statements, attaches
 * lines to them and stamps a run record, and those three have to move together
 * or not at all. Three writes from a browser cannot promise that.
 */

import { supabase } from './supabase'
import type { Terms } from './settlementCycle'

export interface DueRow {
  partner_id: string
  partner_name: string
  partner_status: string
  frequency: Terms['frequency']
  align: Terms['align']
  pay_within_days: number
  hold_days: number
  minimum_payout: number
  payout_currency: string
  contract_ref: string | null
  agreed_on: string
  period_start: string | null
  period_end: string | null
  closed_on: string | null
  due_on: string | null
  next_close: string | null
  statement_id: string | null
  statement_status: string | null
  state: 'not trading' | 'not started' | 'settled' | 'waiting'
}

export interface AccruingRow {
  partner_id: string
  partner_name: string
  frequency: Terms['frequency']
  period_start: string
  period_end: string
  closed_on: string
  due_on: string
  hold_days: number
  hold_reason: string | null
  minimum_payout: number
  payout_currency: string
  gross: number
  commission: number
  fees: number
  refunds: number
  net: number
  lines: number
  held_back: number
}

export interface Run {
  id: string
  ran_on: string
  kind: 'scheduled' | 'manual' | 'catch-up'
  ran_by: string
  status: 'complete' | 'partial' | 'failed'
  considered: number
  settled: number
  /* Named, not counted. "Three partners were skipped" is not something anybody
     can act on. */
  skipped: { partner_id: string; partner: string; reason: string; already?: boolean }[]
  started_at: string
  finished_at: string | null
  note: string | null
}

export interface CycleBook {
  terms: Terms[]
  due: DueRow[]
  accruing: AccruingRow[]
  runs: Run[]
  loadError?: string
}

/* PostgREST returns numeric as a string, so every figure that will be added,
   compared or formatted has to be a number before it leaves this module. The
   alternative is `"1200" + "50" === "120050"` somewhere on a screen. */
const num = <T>(row: T, keys: readonly string[]): T => {
  const out = { ...(row as object) } as Record<string, unknown>
  for (const k of keys) if (out[k] != null) out[k] = Number(out[k])
  return out as T
}

export async function loadCycleBook(): Promise<CycleBook> {
  const [t, d, a, r] = await Promise.all([
    supabase.from('partner_settlement_terms').select('*').order('partner_id'),
    supabase.from('settlement_due').select('*').order('partner_id'),
    supabase.from('settlement_accruing').select('*').order('partner_id'),
    supabase.from('settlement_run').select('*').order('ran_on', { ascending: false }).limit(50),
  ])
  const errors: string[] = []
  const grab = <T>(res: { data: unknown; error: { message: string } | null }, what: string): T[] => {
    if (res.error) errors.push(`${what}: ${res.error.message}`)
    return (res.data ?? []) as T[]
  }
  return {
    terms: grab<Terms>(t, 'the contracts').map(x => num(x, ['minimum_payout', 'hold_days', 'pay_within_days', 'closes_on_day'])),
    due: grab<DueRow>(d, 'what is due').map(x => num(x, ['minimum_payout', 'hold_days', 'pay_within_days'])),
    accruing: grab<AccruingRow>(a, 'what is accruing')
      .map(x => num(x, ['gross', 'commission', 'fees', 'refunds', 'net', 'lines', 'held_back', 'minimum_payout', 'hold_days'])),
    runs: grab<Run>(r, 'the runs'),
    ...(errors.length ? { loadError: `Some of the settlement cycle did not load (${errors.join('; ')}).` } : {}),
  }
}

/** One partner's agreed cycle, for the seller's own console. */
export async function loadMyTerms(partnerId: string): Promise<Terms | null> {
  const { data } = await supabase.from('partner_settlement_terms')
    .select('*').eq('partner_id', partnerId).maybeSingle()
  return data ? num(data as Terms, ['minimum_payout', 'hold_days', 'pay_within_days', 'closes_on_day']) : null
}

export async function loadMyAccrual(partnerId: string): Promise<AccruingRow | null> {
  const { data } = await supabase.from('settlement_accruing')
    .select('*').eq('partner_id', partnerId).maybeSingle()
  return data
    ? num(data as AccruingRow, ['gross', 'commission', 'fees', 'refunds', 'net', 'lines', 'held_back', 'minimum_payout', 'hold_days'])
    : null
}

export type Result = { ok: true; note: string } | { ok: false; reason: string }

export async function saveTerms(terms: Terms): Promise<Result> {
  const { error } = await supabase.from('partner_settlement_terms')
    .upsert({ ...terms, updated_at: new Date().toISOString() })
  if (error) {
    return { ok: false, reason: error.message.replace(/^.*?\bERROR:\s*/i, '').replace(/^P0001:\s*/, '').trim() }
  }
  return { ok: true, note: `Settlement cycle saved for ${terms.partner_id}.` }
}

/**
 * Fire a run.
 *
 * `kind` is what it is, not how it was started: a scheduled run fired by hand
 * because the scheduler was down is still a scheduled run, and a catch-up for
 * one missed partner is a catch-up whoever pressed it.
 */
export async function runSettlements(
  { asOf, actor, kind = 'manual', only }: {
    asOf?: string; actor: string; kind?: Run['kind']; only?: string | null
  },
): Promise<Result & { run?: { run_id: string; considered: number; settled: number; skipped: Run['skipped'] } }> {
  const { data, error } = await supabase.rpc('run_settlements', {
    p_as_of: asOf ?? new Date().toISOString().slice(0, 10),
    p_actor: actor,
    p_kind: kind,
    p_only: only ?? null,
  })
  if (error) {
    return { ok: false, reason: error.message.replace(/^.*?\bERROR:\s*/i, '').replace(/^P0001:\s*/, '').trim() }
  }
  const run = data as { run_id: string; considered: number; settled: number; skipped: Run['skipped'] }
  return {
    ok: true,
    note: run.settled === 0
      ? `Nothing to settle — ${run.considered} contracts checked and every closed period is already settled.`
      : `${run.settled} of ${run.considered} settled as ${run.run_id}.`,
    run,
  }
}
