/* The general ledger and the revenue share, as arithmetic.
   No React and no Supabase, so every figure on the finance screens can be
   checked without a network.

   One idea underneath all of it: most of the money passing through a
   marketplace is not its revenue. Gross collected on a seller's behalf is a
   liability until settlement, and only commission and fees are earned. Nearly
   every function here exists to keep those two apart. */

export type AccountType =
  | 'Asset' | 'Liability' | 'Revenue' | 'Expense' | 'Equity' | 'Tax' | 'Contra'

export interface Account {
  code: string
  name: string
  type: AccountType
  note: string
  system: boolean
  active: boolean
}

export interface Charge {
  id: string
  label: string
  charge_group: string
  sort_order: number
}

export interface Mapping {
  charge_id: string
  dr: string
  cr: string
  why: string
  changed_by: string | null
  changed_on: string | null
}

export interface Period {
  id: string
  label: string
  starts: string
  ends: string
  status: 'open' | 'closed'
  closed_on: string | null
  closed_by: string | null
}

export interface Posting {
  id: string
  charge_id: string
  amount: number
  dr: string
  cr: string
  ref: string
  when_date: string
  period: string
  source: 'automatic' | 'manual'
  memo: string | null
  partner_id: string | null
}

export interface SettlementLine {
  id: string
  statement_id: string
  partner_id: string | null
  order_ref: string
  product_id: string
  product_name: string
  category_id: string | null
  quantity: number
  gross: number
  tax: number
  commission_rate: number
  commission: number
  fees: number
  refunds: number
  net: number
  occurred_on: string
  sort_order: number
}

export interface Statement {
  id: string
  partner_id: string | null
  partner_name: string
  period: string
  gross: number
  commission: number
  commission_rate: number
  fees: number
  withholding: number
  refunds: number
  net: number
  status: string
  order_count: number
}

const n = (v: number | string | null | undefined): number => Number(v ?? 0)
const money = (v: number): number => +v.toFixed(2)

/* ========================================================================= */
/* The trial balance                                                         */
/* ========================================================================= */

export interface TrialRow {
  code: string
  account: Account | null
  dr: number
  cr: number
  /* Debits less credits. Positive on an asset or an expense, negative on a
     liability or revenue — which is what makes a wrong sign obvious. */
  movement: number
}

export interface TrialBalance {
  rows: TrialRow[]
  dr: number
  cr: number
  balanced: boolean
  difference: number
}

export function postingsIn(postings: readonly Posting[], period: string | null): Posting[] {
  return period ? postings.filter(p => p.period === period) : postings.slice()
}

/**
 * One row per account, both columns, and the proof they agree.
 *
 * Every entry is a debit and a credit of the same amount, so a balanced trial
 * balance is arithmetic rather than an opinion. It is still worth computing:
 * it is the check that catches a mapping posting to the wrong side before a
 * period close does, and a close is much more expensive to undo.
 */
export function trialBalance(
  postings: readonly Posting[], accounts: readonly Account[], period: string | null = null,
): TrialBalance {
  const rows = new Map<string, { dr: number; cr: number }>()
  const bump = (code: string, dr: number, cr: number) => {
    const row = rows.get(code) ?? { dr: 0, cr: 0 }
    row.dr += dr; row.cr += cr
    rows.set(code, row)
  }
  for (const p of postingsIn(postings, period)) {
    bump(p.dr, n(p.amount), 0)
    bump(p.cr, 0, n(p.amount))
  }

  const out: TrialRow[] = [...rows.entries()]
    .map(([code, v]) => ({
      code,
      account: accounts.find(a => a.code === code) ?? null,
      dr: money(v.dr),
      cr: money(v.cr),
      movement: money(v.dr - v.cr),
    }))
    .sort((a, b) => a.code.localeCompare(b.code))

  const dr = money(out.reduce((a, r) => a + r.dr, 0))
  const cr = money(out.reduce((a, r) => a + r.cr, 0))
  return { rows: out, dr, cr, balanced: Math.abs(dr - cr) < 0.005, difference: money(dr - cr) }
}

export interface Earned {
  /* Collected on sellers' behalf. Not income, however large it looks. */
  passedThrough: number
  /* Commission, fees and advertising, less what was given back. */
  revenue: number
  contra: number
  /* Collected for the authority, and owed straight back to it. */
  taxCollected: number
  /* What the sellers are owed out of it. */
  sellerNet: number
}

/** What the marketplace actually earned, as against what merely passed through
    it. The gap between the two is the number a marketplace is most often
    reported at by mistake. */
export function earned(
  postings: readonly Posting[], accounts: readonly Account[], period: string | null = null,
): Earned {
  const rows = postingsIn(postings, period)
  const typeOf = (code: string) => accounts.find(a => a.code === code)?.type ?? null
  const sum = (f: (p: Posting) => boolean) => money(rows.filter(f).reduce((a, p) => a + n(p.amount), 0))

  const revenue = sum(p => typeOf(p.cr) === 'Revenue')
  const contra = sum(p => typeOf(p.dr) === 'Contra')
  return {
    passedThrough: sum(p => p.charge_id === 'order.gross'),
    revenue: money(revenue - contra),
    contra,
    taxCollected: sum(p => p.charge_id === 'order.tax'),
    sellerNet: sum(p => p.charge_id === 'settle.approved'),
  }
}

/* ========================================================================= */
/* Configuration                                                             */
/* ========================================================================= */

/** Charges that post nowhere. Anything of that type would vanish, which is the
    usual reason somebody says an entry has gone missing. */
export function unmappedCharges(charges: readonly Charge[], mapping: readonly Mapping[]): Charge[] {
  return charges.filter(c => !mapping.some(m => m.charge_id === c.id))
}

/** Accounts nothing can ever reach. Adding a code is easy; the mistake is all
    downstream — an account with no charge mapped to it sits at zero forever. */
export function idleAccounts(accounts: readonly Account[], mapping: readonly Mapping[]): Account[] {
  return accounts.filter(a => !mapping.some(m => m.dr === a.code || m.cr === a.code))
}

export function accountUse(
  code: string, mapping: readonly Mapping[], postings: readonly Posting[],
): { charges: number; postings: number } {
  return {
    charges: mapping.filter(m => m.dr === code || m.cr === code).length,
    postings: postings.filter(p => p.dr === code || p.cr === code).length,
  }
}

export type Check = { ok: true } | { ok: false; reason: string }

export function validateMapping(
  { dr, cr, why, accounts }: { dr: string; cr: string; why: string; accounts: readonly Account[] },
): Check {
  if (!dr || !cr) return { ok: false, reason: 'Both sides are required. A posting with one side is not a posting.' }
  if (dr === cr) {
    return { ok: false, reason: 'Debit and credit cannot be the same account — that moves nothing and balances trivially.' }
  }
  if (!accounts.some(a => a.code === dr) || !accounts.some(a => a.code === cr)) {
    return { ok: false, reason: 'One of those accounts is not in the chart. Add it there first, or nothing will post.' }
  }
  if (why.trim().length < 20) {
    return { ok: false, reason: 'Record why it posts this way. A mapping nobody can defend at audit is one that gets changed under pressure and never changed back.' }
  }
  return { ok: true }
}

/** Changing a mapping does not rewrite history. A ledger that restates itself
    is not a ledger, so the warning names how many entries already used it. */
export function mappingChangeImpact(
  chargeId: string, postings: readonly Posting[], openPeriod: string | null,
): string | null {
  const used = postings.filter(p => p.charge_id === chargeId && p.period === openPeriod).length
  if (used === 0) return null
  return `${used} posting${used === 1 ? '' : 's'} already used this mapping in the open period. Changing it affects entries made from now on — existing ones are not rewritten.`
}

/* ========================================================================= */
/* Periods                                                                   */
/* ========================================================================= */

export function openPeriod(periods: readonly Period[]): Period | null {
  return periods.find(p => p.status === 'open') ?? null
}

export function canClosePeriod(period: Period | null, tb: TrialBalance, postings: number): Check {
  if (!period) return { ok: false, reason: 'There is no open period to close.' }
  if (!tb.balanced) {
    return {
      ok: false,
      reason: `Out of balance by $${Math.abs(tb.difference).toFixed(2)}. A period cannot be closed while the two columns disagree — find the mapping posting to the wrong side.`,
    }
  }
  if (postings === 0) {
    return { ok: false, reason: 'Nothing has posted into this period. Closing an empty period hides the fact that nothing ran.' }
  }
  return { ok: true }
}

export function closeImpact(period: Period, tb: TrialBalance, postings: number): string[] {
  return [
    `${postings} posting${postings === 1 ? '' : 's'} totalling $${tb.dr.toFixed(2)} on each side are fixed as they stand.`,
    `No further entry can be made into ${period.label}.`,
    'A correction after close is a journal in the next period, never an edit to this one — restating a closed period breaks every report already issued from it.',
  ]
}

export function validateJournal(
  { dr, cr, amount, memo, accounts, period }: {
    dr: string; cr: string; amount: number; memo: string
    accounts: readonly Account[]; period: Period | null
  },
): Check {
  if (!period || period.status !== 'open') {
    return { ok: false, reason: 'There is no open period to post into. A journal into a closed period is a restatement, not an entry.' }
  }
  const sides = validateMapping({ dr, cr, why: 'x'.repeat(21), accounts })
  if (!sides.ok) return sides
  if (!(amount > 0)) return { ok: false, reason: 'An entry needs an amount. Post the reverse rather than a negative one.' }
  if (memo.trim().split(/\s+/).filter(Boolean).length < 4) {
    return { ok: false, reason: 'Say what this journal is for. A hand-written entry with no explanation is the first thing an auditor pulls and the last thing anybody can answer.' }
  }
  return { ok: true }
}

/* ========================================================================= */
/* Revenue share                                                             */
/* ========================================================================= */

export interface Split {
  gross: number
  /* Collected for the authority. Never anybody's revenue. */
  tax: number
  commission: number
  fees: number
  refunds: number
  withholding: number
  /* What the sellers keep. */
  sellerNet: number
  /* What the marketplace keeps out of the same gross. */
  marketplace: number
  /* Commission and fees as a share of gross. The number both sides argue
     about, so it is computed rather than quoted from a plan. */
  effectiveRate: number | null
}

/** How one period's gross divides between the four parties that have a claim
    on it: the seller, the marketplace, the tax authority, and the buyer who
    got some of it back. */
export function revenueSplit(
  lines: readonly SettlementLine[], statements: readonly Statement[],
): Split {
  const gross = money(lines.reduce((a, l) => a + n(l.gross), 0))
  const tax = money(lines.reduce((a, l) => a + n(l.tax), 0))
  const commission = money(lines.reduce((a, l) => a + n(l.commission), 0))
  const fees = money(lines.reduce((a, l) => a + n(l.fees), 0))
  const refunds = money(lines.reduce((a, l) => a + n(l.refunds), 0))
  const ids = new Set(lines.map(l => l.statement_id))
  const withholding = money(statements.filter(s => ids.has(s.id)).reduce((a, s) => a + n(s.withholding), 0))
  return {
    gross, tax, commission, fees, refunds, withholding,
    sellerNet: money(gross - commission - fees - refunds - withholding),
    marketplace: money(commission + fees),
    effectiveRate: gross === 0 ? null : +(((commission + fees) / gross) * 100).toFixed(2),
  }
}

export interface SellerShare {
  partner_id: string | null
  partner_name: string
  gross: number
  commission: number
  fees: number
  refunds: number
  withholding: number
  net: number
  orders: number
  /* Commission as a share of gross — the like-for-like against the plan rate.
     Fees are a separate charge and always push the total take above the
     commission rate, so comparing the total against the plan would flag every
     seller on the platform and mean nothing. */
  effectiveRate: number | null
  /* Commission and fees together: what the marketplace actually kept. */
  totalTake: number | null
  planRate: number | null
}

/** The share per seller, with the rate they were actually charged beside the
    rate their plan says. A seller who is billed at a rate their plan does not
    carry is the single most common settlement dispute. */
export function shareBySeller(
  lines: readonly SettlementLine[], statements: readonly Statement[],
): SellerShare[] {
  const ids = new Set(lines.map(l => l.statement_id))
  const relevant = statements.filter(s => ids.has(s.id))
  const map = new Map<string, SellerShare>()

  for (const s of relevant) {
    const key = s.partner_id ?? 'first-party'
    const row = map.get(key) ?? {
      partner_id: s.partner_id, partner_name: s.partner_name,
      gross: 0, commission: 0, fees: 0, refunds: 0, withholding: 0, net: 0,
      orders: 0, effectiveRate: null, totalTake: null, planRate: null,
    }
    row.gross += n(s.gross); row.commission += n(s.commission); row.fees += n(s.fees)
    row.refunds += n(s.refunds); row.withholding += n(s.withholding); row.net += n(s.net)
    row.orders += s.order_count
    row.planRate = n(s.commission_rate) || row.planRate
    map.set(key, row)
  }

  return [...map.values()]
    .map(r => ({
      ...r,
      gross: money(r.gross), commission: money(r.commission), fees: money(r.fees),
      refunds: money(r.refunds), withholding: money(r.withholding), net: money(r.net),
      effectiveRate: r.gross === 0 ? null : +((r.commission / r.gross) * 100).toFixed(2),
      totalTake: r.gross === 0 ? null : +(((r.commission + r.fees) / r.gross) * 100).toFixed(2),
    }))
    .sort((a, b) => b.gross - a.gross)
}

/* ========================================================================= */
/* Reconciliation                                                            */
/* ========================================================================= */

export interface Variance { what: string; expected: number; found: number; difference: number }

export interface Reconciliation {
  id: string
  name: string
  /* What it proves, in the words somebody would use to defend it. */
  proves: string
  ok: boolean
  variances: Variance[]
  /* What to do when it fails. A check that reports a difference and no next
     step is a check nobody acts on. */
  remedy: string
}

const TOLERANCE = 0.005

function variance(what: string, expected: number, found: number): Variance | null {
  const d = money(found - expected)
  return Math.abs(d) < TOLERANCE ? null : { what, expected: money(expected), found: money(found), difference: d }
}

/** A statement against its own lines. This is the sentence the seller's page
    prints, so it is the one worth proving rather than asserting. */
export function reconcileStatement(
  statement: Statement, lines: readonly SettlementLine[],
): Reconciliation {
  const mine = lines.filter(l => l.statement_id === statement.id)
  const sum = (f: (l: SettlementLine) => number) => money(mine.reduce((a, l) => a + n(f(l)), 0))

  const variances = [
    variance('Gross order value', n(statement.gross), sum(l => l.gross)),
    variance('Marketplace commission', n(statement.commission), sum(l => l.commission)),
    variance('Fees', n(statement.fees), sum(l => l.fees)),
    variance('Refunds', n(statement.refunds), sum(l => l.refunds)),
    variance('Net payable', n(statement.net), money(sum(l => l.net) - n(statement.withholding))),
  ].filter((v): v is Variance => v !== null)

  return {
    id: `stmt:${statement.id}`,
    name: `${statement.id} against its order lines`,
    proves: `Every figure on the statement is the sum of ${mine.length} order line${mine.length === 1 ? '' : 's'} the seller can add up themselves.`,
    ok: mine.length > 0 && variances.length === 0,
    variances: mine.length === 0
      ? [{ what: 'Order lines', expected: 1, found: 0, difference: -1 }]
      : variances,
    remedy: 'A statement that does not equal its lines is not payable. Hold the run and find the order the lines are missing before anybody approves it.',
  }
}

/** The ledger against the settlement register. Two systems, one number: what
    was approved for payment in a period. */
export function reconcileLedgerToSettlement(
  postings: readonly Posting[], statements: readonly Statement[], period: Period,
): Reconciliation {
  const posted = money(postingsIn(postings, period.id)
    .filter(p => p.charge_id === 'settle.approved')
    .reduce((a, p) => a + n(p.amount), 0))
  const owed = money(statements
    .filter(s => periodIdOf(s.period) === period.id && ['approved', 'paid'].includes(s.status))
    .reduce((a, s) => a + n(s.net), 0))

  const v = variance('Settlement approved', owed, posted)
  return {
    id: `gl:${period.id}`,
    name: `The ledger against the settlement register — ${period.label}`,
    proves: 'What the ledger says was approved for payment equals what the settlement runs actually approved.',
    ok: v === null,
    variances: v ? [v] : [],
    remedy: 'A settlement approved and never posted is a payable missing from the books. Post the journal before the period closes, not after.',
  }
}

/** The ledger against itself. Cheapest of the three and the one that catches a
    broken mapping. */
export function reconcileTrialBalance(tb: TrialBalance, period: Period): Reconciliation {
  return {
    id: `tb:${period.id}`,
    name: `Trial balance — ${period.label}`,
    proves: 'Every entry is a debit and a credit of the same amount, so the two columns agree.',
    ok: tb.balanced,
    variances: tb.balanced ? [] : [{ what: 'Debits against credits', expected: tb.cr, found: tb.dr, difference: tb.difference }],
    remedy: 'A mapping is posting to the wrong side. Find it on the charge mapping before closing — a close locks the error in.',
  }
}

/** Period identifier from the way a statement writes its period. */
export function periodIdOf(label: string): string {
  const m = /^([A-Za-z]{3})\w*\s+(\d{4})$/.exec(label.trim())
  if (!m) return ''
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  const i = months.indexOf(m[1].slice(0, 1).toUpperCase() + m[1].slice(1, 3).toLowerCase())
  return i < 0 ? '' : `${m[2]}-${String(i + 1).padStart(2, '0')}`
}

/** All three, in the order a finance team runs them: cheapest first, and the
    one the seller can see last, because that is the one that has to hold. */
export function reconciliations(
  { postings, accounts, statements, lines, period }: {
    postings: readonly Posting[]
    accounts: readonly Account[]
    statements: readonly Statement[]
    lines: readonly SettlementLine[]
    period: Period
  },
): Reconciliation[] {
  const tb = trialBalance(postings, accounts, period.id)
  const inPeriod = statements.filter(s => periodIdOf(s.period) === period.id)
  const failing = inPeriod
    .map(s => reconcileStatement(s, lines))
    .filter(r => !r.ok)

  const statementCheck: Reconciliation = {
    id: `stmts:${period.id}`,
    name: `Every statement against its order lines — ${period.label}`,
    proves: `All ${inPeriod.length} statements in the period equal the sum of the order lines behind them.`,
    ok: failing.length === 0,
    variances: failing.flatMap(f => f.variances.map(v => ({ ...v, what: `${f.name.split(' ')[0]} — ${v.what}` }))),
    remedy: 'A statement that does not equal its lines is not payable. Hold it and find the order the lines are missing.',
  }

  return [
    reconcileTrialBalance(tb, period),
    reconcileLedgerToSettlement(postings, statements, period),
    statementCheck,
  ]
}

/** An export a finance system can actually load: one row per side, which is
    what every ERP journal import expects. */
export function journalRows(
  postings: readonly Posting[], accounts: readonly Account[],
): string[][] {
  const name = (code: string) => accounts.find(a => a.code === code)?.name ?? ''
  const out: string[][] = [[
    'entry', 'date', 'period', 'account', 'account_name', 'debit', 'credit',
    'charge', 'reference', 'partner', 'source', 'memo',
  ]]
  for (const p of postings) {
    out.push([p.id, p.when_date, p.period, p.dr, name(p.dr), n(p.amount).toFixed(2), '',
      p.charge_id, p.ref, p.partner_id ?? '', p.source, p.memo ?? ''])
    out.push([p.id, p.when_date, p.period, p.cr, name(p.cr), '', n(p.amount).toFixed(2),
      p.charge_id, p.ref, p.partner_id ?? '', p.source, p.memo ?? ''])
  }
  return out
}

export function toCsv(rows: readonly string[][]): string {
  return rows
    .map(r => r.map(c => /[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c).join(','))
    .join('\n')
}
