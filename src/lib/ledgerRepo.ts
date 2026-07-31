/* The only module that reads or writes the ledger and the revenue share.
   Rules live in ledger.ts so the arithmetic can be tested without a network. */

import { supabase } from './supabase'
import { validateMapping, validateJournal, canClosePeriod, trialBalance, openPeriod } from './ledger'
import type {
  Account, Charge, Mapping, Period, Posting, SettlementLine, Statement,
} from './ledger'

export type Result = { ok: true; note?: string } | { ok: false; reason: string }

export interface LedgerBook {
  accounts: Account[]
  charges: Charge[]
  mapping: Mapping[]
  periods: Period[]
  postings: Posting[]
  statements: Statement[]
  lines: SettlementLine[]
  loadError?: string
}

export async function loadLedger(): Promise<LedgerBook> {
  const [a, c, m, p, po, st, ln] = await Promise.all([
    supabase.from('gl_accounts').select('*').order('code'),
    supabase.from('gl_charges').select('*').order('sort_order'),
    supabase.from('gl_mapping').select('*'),
    supabase.from('gl_periods').select('*').order('id'),
    supabase.from('gl_postings').select('*').order('when_date', { ascending: false }),
    supabase.from('settlement_statements').select('*').order('sort_order'),
    supabase.from('settlement_lines').select('*').order('sort_order'),
  ])
  const errors: string[] = []
  for (const [what, res] of [['chart', a], ['charges', c], ['mapping', m], ['periods', p],
                             ['postings', po], ['statements', st], ['lines', ln]] as const) {
    if (res.error) errors.push(`${what}: ${res.error.message}`)
  }
  return {
    accounts: (a.data ?? []) as Account[],
    charges: (c.data ?? []) as Charge[],
    mapping: (m.data ?? []) as Mapping[],
    periods: (p.data ?? []) as Period[],
    postings: (po.data ?? []) as Posting[],
    statements: (st.data ?? []) as Statement[],
    lines: (ln.data ?? []) as SettlementLine[],
    ...(errors.length > 0 ? { loadError: `Some of the ledger did not load (${errors.join('; ')}).` } : {}),
  }
}

export interface SellerStatements {
  statements: Statement[]
  lines: SettlementLine[]
  loadError?: string
}

/** A seller's own statements and the order lines behind them. This is the
    seller's half of the reconciliation: the same rows the marketplace reads,
    under the seller's own row-level security. */
export async function loadSellerStatements(partnerId: string): Promise<SellerStatements> {
  const [st, ln] = await Promise.all([
    supabase.from('settlement_statements').select('*').eq('partner_id', partnerId).order('sort_order', { ascending: false }),
    supabase.from('settlement_lines').select('*').eq('partner_id', partnerId).order('sort_order'),
  ])
  const errors: string[] = []
  if (st.error) errors.push(`statements: ${st.error.message}`)
  if (ln.error) errors.push(`lines: ${ln.error.message}`)
  return {
    statements: (st.data ?? []) as Statement[],
    lines: (ln.data ?? []) as SettlementLine[],
    ...(errors.length > 0 ? { loadError: `Some of this did not load (${errors.join('; ')}).` } : {}),
  }
}

/**
 * Changing where a charge posts.
 *
 * It applies to entries made from now on and never rewrites the ones already
 * made. A ledger that restates itself is not a ledger, and the alternative —
 * silently re-posting a closed period — is how a reconciliation that passed
 * last month fails this month with nobody able to say why.
 */
export async function saveMapping(
  { chargeId, dr, cr, why, accounts, by }: {
    chargeId: string; dr: string; cr: string; why: string
    accounts: readonly Account[]; by: string
  },
): Promise<Result> {
  const check = validateMapping({ dr, cr, why, accounts })
  if (!check.ok) return check

  const { error } = await supabase.from('gl_mapping').upsert({
    charge_id: chargeId, dr, cr, why: why.trim(),
    changed_by: by, changed_on: new Date().toISOString().slice(0, 10),
  })
  if (error) return { ok: false, reason: `That did not save: ${error.message}` }

  await writeAudit(by, 'gl.mapping', chargeId, 'warn',
    `Now posts ${dr} to ${cr}. ${why.trim()} Applies to entries made from now on; existing ones are not rewritten.`)
  return { ok: true, note: `${chargeId} now posts ${dr} to ${cr}, from the next entry onwards.` }
}

/** A journal somebody wrote by hand. It goes into the open period and it says
    why, because a manual entry with no explanation is the first thing an
    auditor pulls. */
export async function postJournal(
  { dr, cr, amount, memo, ref, chargeId, accounts, periods, by }: {
    dr: string; cr: string; amount: number; memo: string; ref: string; chargeId: string
    accounts: readonly Account[]; periods: readonly Period[]; by: string
  },
): Promise<Result> {
  const period = openPeriod(periods)
  const check = validateJournal({ dr, cr, amount, memo, accounts, period })
  if (!check.ok) return check
  if (!ref.trim()) {
    return { ok: false, reason: 'Give it a reference. A posting nobody can trace back to a record is the one nobody can answer for.' }
  }

  const { error } = await supabase.from('gl_postings').insert({
    id: `JE-${Date.now().toString(36).toUpperCase()}`,
    charge_id: chargeId, amount: +amount.toFixed(2), dr, cr,
    ref: ref.trim(), when_date: new Date().toISOString().slice(0, 10),
    period: period!.id, source: 'manual', memo: memo.trim(),
  })
  if (error) return { ok: false, reason: `That did not post: ${error.message}` }

  await writeAudit(by, 'gl.journal', ref.trim(), 'warn',
    `Manual journal $${amount.toFixed(2)} — ${dr} to ${cr} in ${period!.label}. ${memo.trim()}`)
  return { ok: true, note: `Posted into ${period!.label}. It appears on the trial balance immediately.` }
}

/**
 * Closing a period.
 *
 * The trial balance has to agree first — closing an out-of-balance period locks
 * the error in, and the only way out afterwards is a restatement.
 */
export async function closePeriod(
  { period, postings, accounts, by }: {
    period: Period; postings: readonly Posting[]; accounts: readonly Account[]; by: string
  },
): Promise<Result> {
  const tb = trialBalance(postings, accounts, period.id)
  const count = postings.filter(p => p.period === period.id).length
  const check = canClosePeriod(period, tb, count)
  if (!check.ok) return check

  const { error } = await supabase.from('gl_periods').update({
    status: 'closed',
    closed_on: new Date().toISOString().slice(0, 10),
    closed_by: by,
  }).eq('id', period.id)
  if (error) return { ok: false, reason: `That did not close: ${error.message}` }

  await writeAudit(by, 'gl.close', period.label, 'high',
    `Closed with ${count} postings and $${tb.dr.toFixed(2)} on each side. Corrections from here are journals in the next period.`)
  return { ok: true, note: `${period.label} is closed. $${tb.dr.toFixed(2)} on each side, ${count} entries.` }
}

/** Opening the next one. A ledger with no open period cannot record anything
    that happens today. */
export async function openNextPeriod(
  { after, by }: { after: Period; by: string },
): Promise<Result> {
  const end = new Date(after.ends + 'T00:00:00Z')
  const start = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() + 1, 1))
  const finish = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0))
  const id = start.toISOString().slice(0, 7)

  const { error } = await supabase.from('gl_periods').insert({
    id, label: start.toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }),
    starts: start.toISOString().slice(0, 10),
    ends: finish.toISOString().slice(0, 10),
    status: 'open',
  })
  if (error) return { ok: false, reason: `That did not open: ${error.message}` }
  await writeAudit(by, 'gl.open', id, 'notice', 'Period opened for posting.')
  return { ok: true, note: `${id} is open for posting.` }
}

export async function addAccount(
  { code, name, type, note, by }: {
    code: string; name: string; type: Account['type']; note: string; by: string
  },
): Promise<Result> {
  if (!/^\d{4}$/.test(code.trim())) {
    return { ok: false, reason: 'A code is four digits. The range decides where it sorts in the chart, and a code that does not sort is a code nobody finds.' }
  }
  if (!name.trim() || note.trim().length < 10) {
    return { ok: false, reason: 'Name it and say what lands there. An account nobody can describe is one somebody will map the wrong charge to.' }
  }
  const { error } = await supabase.from('gl_accounts').insert({
    code: code.trim(), name: name.trim(), type, note: note.trim(), system: false, active: true,
  })
  if (error) return { ok: false, reason: `That was not added: ${error.message}` }
  await writeAudit(by, 'gl.account', code.trim(), 'notice', `${name.trim()} added to the chart as ${type}.`)
  return {
    ok: true,
    note: 'Added. Nothing will post to it until a charge is mapped to it — which is the usual reason somebody thinks a posting has gone missing.',
  }
}

async function writeAudit(
  actor: string, action: string, object: string, severity: string, detail: string,
): Promise<void> {
  await supabase.from('operator_audit_log').insert({
    id: `AUD-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    actor, role: 'Finance', action, object,
    category: 'Commercial', severity, outcome: 'success',
    before_val: null, after_val: detail,
  })
}
