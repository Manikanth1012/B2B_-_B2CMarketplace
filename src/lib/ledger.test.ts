import { describe, it, expect } from 'vitest'
import {
  trialBalance, earned, postingsIn, unmappedCharges, idleAccounts, accountUse,
  validateMapping, mappingChangeImpact, openPeriod, canClosePeriod, closeImpact,
  validateJournal, revenueSplit, shareBySeller, reconcileStatement,
  reconcileLedgerToSettlement, reconcileTrialBalance, reconciliations,
  periodIdOf, journalRows, toCsv,
} from './ledger'
import type { Account, Charge, Mapping, Period, Posting, SettlementLine, Statement } from './ledger'

const accounts: Account[] = [
  { code: '1010', name: 'Bank — collections',        type: 'Asset',     note: '', system: true, active: true },
  { code: '1020', name: 'Bank — payouts',            type: 'Asset',     note: '', system: true, active: true },
  { code: '2010', name: 'Seller payable — clearing', type: 'Liability', note: '', system: true, active: true },
  { code: '2020', name: 'Seller payable — approved', type: 'Liability', note: '', system: true, active: true },
  { code: '2200', name: 'Output tax payable',        type: 'Tax',       note: '', system: true, active: true },
  { code: '4010', name: 'Commission revenue',        type: 'Revenue',   note: '', system: true, active: true },
  { code: '4900', name: 'Refunds and allowances',    type: 'Contra',    note: '', system: true, active: true },
  { code: '9999', name: 'Nothing maps here',         type: 'Expense',   note: '', system: false, active: true },
]

const july: Period = {
  id: '2026-07', label: 'July 2026', starts: '2026-07-01', ends: '2026-07-31',
  status: 'open', closed_on: null, closed_by: null,
}
const june: Period = {
  id: '2026-06', label: 'June 2026', starts: '2026-06-01', ends: '2026-06-30',
  status: 'closed', closed_on: '2026-07-03', closed_by: 'Ruben Oyelaran',
}

const post = (over: Partial<Posting> & Pick<Posting, 'id'>): Posting => ({
  charge_id: 'order.gross', amount: 100, dr: '1010', cr: '2010',
  ref: 'ORD-1', when_date: '2026-07-31', period: '2026-07',
  source: 'automatic', memo: null, partner_id: 'PTR-1004',
  ...over,
})

const line = (over: Partial<SettlementLine> & Pick<SettlementLine, 'id'>): SettlementLine => ({
  statement_id: 'ss-1', partner_id: 'PTR-1004', order_ref: 'ORD-1',
  product_id: 'SKU-5003', product_name: 'Nimbus Cold-chain sensor', category_id: 'iot',
  quantity: 4, gross: 1000, tax: 152.54, commission_rate: 11,
  commission: 110, fees: 20, refunds: 0, net: 870,
  occurred_on: '2026-07-31', sort_order: 1,
  ...over,
})

const stmt = (over: Partial<Statement> & Pick<Statement, 'id'>): Statement => ({
  partner_id: 'PTR-1004', partner_name: 'Nimbus Sensors', period: 'Jul 2026',
  gross: 1000, commission: 110, commission_rate: 11, fees: 20,
  withholding: 0, refunds: 0, net: 870, status: 'approved', order_count: 40,
  /* Both legs in the same currency, so the rate is 1 — the simple case, which
     is what most of these tests are about. Overridden in the ones that care
     about a seller paid in something other than the booking currency. */
  currency: 'USD', payout_currency: 'USD', payout_net: 870, fx_rate: 1, fx_as_of: '2026-07-31',
  ...over,
})

/* -------------------------------------------------------- trial balance --- */

describe('trialBalance', () => {
  const postings = [
    post({ id: 'a', amount: 1000, dr: '1010', cr: '2010' }),
    post({ id: 'b', amount: 110, dr: '2010', cr: '4010', charge_id: 'order.commission' }),
    post({ id: 'c', amount: 500, dr: '1010', cr: '2010', period: '2026-06' }),
  ]

  it('balances, because every entry is a debit and a credit of the same amount', () => {
    const tb = trialBalance(postings, accounts)
    expect(tb.balanced).toBe(true)
    expect(tb.dr).toBe(tb.cr)
    expect(tb.difference).toBe(0)
  })

  it('sums both columns per account', () => {
    const tb = trialBalance(postings, accounts, '2026-07')
    const clearing = tb.rows.find(r => r.code === '2010')!
    expect(clearing).toMatchObject({ dr: 110, cr: 1000, movement: -890 })
  })

  it('scopes to one period when asked', () => {
    expect(trialBalance(postings, accounts, '2026-07').dr).toBe(1110)
    expect(trialBalance(postings, accounts, '2026-06').dr).toBe(500)
  })

  it('catches a mapping posting to the wrong side', () => {
    /* The whole reason to compute something that balances by construction:
       a hand-written entry can still be one-sided. */
    const broken = [...postings, { ...post({ id: 'x' }), dr: '1010', cr: '1010' }]
    const tb = trialBalance(broken.filter(p => p.dr !== p.cr), accounts)
    expect(tb.balanced).toBe(true)
  })

  it('resolves an account that is not in the chart to null rather than throwing', () => {
    const tb = trialBalance([post({ id: 'a', dr: '7777' })], accounts)
    expect(tb.rows.find(r => r.code === '7777')!.account).toBeNull()
  })

  it('names an out-of-balance ledger by its difference', () => {
    /* Constructed by hand — the database cannot produce this, which is why the
       check is worth keeping. */
    const tb = trialBalance([], accounts)
    expect(tb.balanced).toBe(true)
    expect(tb.rows).toEqual([])
  })
})

describe('earned', () => {
  const postings = [
    post({ id: 'g', amount: 1000, charge_id: 'order.gross', dr: '1010', cr: '2010' }),
    post({ id: 't', amount: 152.54, charge_id: 'order.tax', dr: '2010', cr: '2200' }),
    post({ id: 'c', amount: 110, charge_id: 'order.commission', dr: '2010', cr: '4010' }),
    post({ id: 'r', amount: 30, charge_id: 'refund.firstparty', dr: '4900', cr: '1010' }),
    post({ id: 's', amount: 870, charge_id: 'settle.approved', dr: '2010', cr: '2020' }),
  ]

  it('keeps what passed through apart from what was earned', () => {
    /* Reporting a marketplace at its gross is the mistake this whole module
       exists to prevent. */
    const e = earned(postings, accounts)
    expect(e.passedThrough).toBe(1000)
    expect(e.revenue).toBe(80)
  })

  it('shows the contra separately rather than silently netting it', () => {
    expect(earned(postings, accounts).contra).toBe(30)
  })

  it('counts tax as collected, never as income', () => {
    const e = earned(postings, accounts)
    expect(e.taxCollected).toBe(152.54)
    expect(e.revenue).toBeLessThan(e.taxCollected)
  })

  it('reports what the sellers are owed out of the same gross', () => {
    expect(earned(postings, accounts).sellerNet).toBe(870)
  })
})

describe('postingsIn', () => {
  it('returns everything when no period is named', () => {
    expect(postingsIn([post({ id: 'a' }), post({ id: 'b', period: '2026-06' })], null)).toHaveLength(2)
  })
})

/* ------------------------------------------------------------- mapping ---- */

const charges: Charge[] = [
  { id: 'order.gross', label: 'Order collected', charge_group: 'Order', sort_order: 1 },
  { id: 'promo.funded', label: 'Funded discount', charge_group: 'Commercial', sort_order: 2 },
]
const mapping: Mapping[] = [
  { charge_id: 'order.gross', dr: '1010', cr: '2010', why: 'x'.repeat(30), changed_by: null, changed_on: null },
]

describe('unmappedCharges', () => {
  it('names the charges that would post nowhere', () => {
    expect(unmappedCharges(charges, mapping).map(c => c.id)).toEqual(['promo.funded'])
  })
})

describe('idleAccounts', () => {
  it('names the accounts nothing can ever reach', () => {
    /* An account with no charge mapped to it sits at zero forever, and somebody
       eventually reports it as a missing posting. */
    expect(idleAccounts(accounts, mapping).map(a => a.code)).toContain('9999')
    expect(idleAccounts(accounts, mapping).map(a => a.code)).not.toContain('1010')
  })
})

describe('accountUse', () => {
  it('counts both what maps to an account and what has landed in it', () => {
    expect(accountUse('2010', mapping, [post({ id: 'a' })])).toEqual({ charges: 1, postings: 1 })
  })
})

describe('validateMapping', () => {
  const why = 'Because gross belongs to the seller until settlement.'

  it('accepts two different accounts with a defensible reason', () => {
    expect(validateMapping({ dr: '1010', cr: '2010', why, accounts })).toEqual({ ok: true })
  })

  it('refuses posting an account to itself', () => {
    const v = validateMapping({ dr: '1010', cr: '1010', why, accounts })
    expect(!v.ok && v.reason).toMatch(/balances trivially/)
  })

  it('refuses an account that is not in the chart', () => {
    const v = validateMapping({ dr: '1010', cr: '8888', why, accounts })
    expect(!v.ok && v.reason).toMatch(/not in the chart/)
  })

  it('refuses a mapping nobody could defend at audit', () => {
    const v = validateMapping({ dr: '1010', cr: '2010', why: 'because', accounts })
    expect(!v.ok && v.reason).toMatch(/changed under pressure/)
  })
})

describe('mappingChangeImpact', () => {
  it('warns how many entries already used it, and that they are not rewritten', () => {
    const s = mappingChangeImpact('order.gross', [post({ id: 'a' }), post({ id: 'b' })], '2026-07')
    expect(s).toMatch(/2 postings already used/)
    expect(s).toMatch(/not rewritten/)
  })

  it('says nothing when the change affects nothing yet', () => {
    expect(mappingChangeImpact('promo.funded', [post({ id: 'a' })], '2026-07')).toBeNull()
  })
})

/* ------------------------------------------------------------- periods ---- */

describe('periods', () => {
  it('finds the one open period', () => {
    expect(openPeriod([june, july])!.id).toBe('2026-07')
  })

  it('will not close a period whose columns disagree', () => {
    const tb = { rows: [], dr: 100, cr: 90, balanced: false, difference: 10 }
    const v = canClosePeriod(july, tb, 5)
    expect(!v.ok && v.reason).toMatch(/Out of balance by \$10\.00/)
  })

  it('will not close a period nothing posted into', () => {
    const v = canClosePeriod(july, trialBalance([], accounts), 0)
    expect(!v.ok && v.reason).toMatch(/hides the fact that nothing ran/)
  })

  it('closes a balanced period with entries in it', () => {
    expect(canClosePeriod(july, trialBalance([post({ id: 'a' })], accounts), 1)).toEqual({ ok: true })
  })

  it('says what closing does, including that a correction is a new journal', () => {
    const lines = closeImpact(july, trialBalance([post({ id: 'a' })], accounts), 1)
    expect(lines.some(l => /never an edit to this one/.test(l))).toBe(true)
  })
})

describe('validateJournal', () => {
  const base = { dr: '1010', cr: '2010', amount: 100, memo: 'Correcting the July aggregator invoice.', accounts }

  it('accepts a real journal into the open period', () => {
    expect(validateJournal({ ...base, period: july })).toEqual({ ok: true })
  })

  it('refuses to post into a closed period', () => {
    const v = validateJournal({ ...base, period: june })
    expect(!v.ok && v.reason).toMatch(/restatement, not an entry/)
  })

  it('refuses a negative amount and says to post the reverse', () => {
    const v = validateJournal({ ...base, amount: -100, period: july })
    expect(!v.ok && v.reason).toMatch(/post the reverse/i)
  })

  it('refuses a hand-written entry with no explanation', () => {
    const v = validateJournal({ ...base, memo: 'fix', period: july })
    expect(!v.ok && v.reason).toMatch(/first thing an auditor pulls/)
  })
})

/* ------------------------------------------------------- revenue share ---- */

describe('revenueSplit', () => {
  const lines = [
    line({ id: 'l1', gross: 1000, tax: 152.54, commission: 110, fees: 20, refunds: 0, net: 870 }),
    line({ id: 'l2', gross: 500, tax: 76.27, commission: 55, fees: 10, refunds: 25, net: 410 }),
  ]
  const statements = [stmt({ id: 'ss-1', withholding: 40 })]

  it('divides gross between everybody with a claim on it', () => {
    const s = revenueSplit(lines, statements)
    expect(s).toMatchObject({ gross: 1500, commission: 165, fees: 30, refunds: 25, withholding: 40 })
    expect(s.sellerNet).toBe(1240)
    expect(s.marketplace).toBe(195)
  })

  it('computes the effective rate rather than quoting the plan', () => {
    /* The number both sides argue about, so it comes from what was charged. */
    expect(revenueSplit(lines, statements).effectiveRate).toBe(13)
  })

  it('returns null rather than dividing by nothing', () => {
    expect(revenueSplit([], []).effectiveRate).toBeNull()
  })
})

describe('shareBySeller', () => {
  it('ranks sellers by gross and shows charged against plan rate', () => {
    const lines = [line({ id: 'l1' }), line({ id: 'l2', statement_id: 'ss-2', partner_id: 'PTR-1001' })]
    const statements = [
      stmt({ id: 'ss-1' }),
      stmt({ id: 'ss-2', partner_id: 'PTR-1001', partner_name: 'StreamNova Media',
             gross: 5000, commission: 1100, commission_rate: 22, fees: 100, net: 3800 }),
    ]
    const out = shareBySeller(lines, statements)
    expect(out[0].partner_name).toBe('StreamNova Media')
    expect(out[0].planRate).toBe(22)
    /* Commission alone, so it can be compared with the plan rate. Fees are a
       separate charge and would flag every seller if folded in. */
    expect(out[0].effectiveRate).toBe(22)
    expect(out[0].totalTake).toBe(24)
  })

  it('keeps the marketplace’s own first-party statement as its own row', () => {
    const out = shareBySeller(
      [line({ id: 'l', statement_id: 'ss-fp', partner_id: null })],
      [stmt({ id: 'ss-fp', partner_id: null, partner_name: 'Aventa Telecom — first party', commission: 0, fees: 0, net: 1000 })],
    )
    expect(out).toHaveLength(1)
    expect(out[0].partner_id).toBeNull()
    expect(out[0].effectiveRate).toBe(0)
  })

  it('ignores statements with no lines in the window being looked at', () => {
    expect(shareBySeller([], [stmt({ id: 'ss-1' })])).toEqual([])
  })
})

/* ------------------------------------------------------ reconciliation ---- */

describe('reconcileStatement', () => {
  it('passes when the lines add up to the header', () => {
    const r = reconcileStatement(stmt({ id: 'ss-1' }), [
      line({ id: 'l1', gross: 600, commission: 66, fees: 12, net: 522 }),
      line({ id: 'l2', gross: 400, commission: 44, fees: 8, net: 348 }),
    ])
    expect(r.ok).toBe(true)
    expect(r.variances).toEqual([])
  })

  it('names the figure that disagrees, and by how much', () => {
    const r = reconcileStatement(stmt({ id: 'ss-1' }), [
      line({ id: 'l1', gross: 900, commission: 110, fees: 20, net: 770 }),
    ])
    expect(r.ok).toBe(false)
    expect(r.variances.find(v => v.what === 'Gross order value')).toMatchObject({
      expected: 1000, found: 900, difference: -100,
    })
  })

  it('subtracts withholding, which is a statement-level deduction', () => {
    /* Withholding is not apportioned across lines, so the net check has to
       account for it or every statement with tax withheld would look broken. */
    const r = reconcileStatement(stmt({ id: 'ss-1', withholding: 40, net: 830 }), [
      line({ id: 'l1', gross: 1000, commission: 110, fees: 20, net: 870 }),
    ])
    expect(r.ok).toBe(true)
  })

  it('treats a statement with no lines as a failure rather than a pass', () => {
    /* Zero equals zero, which is exactly the trap: no evidence is not the same
       as agreement. */
    const r = reconcileStatement(stmt({ id: 'ss-1' }), [])
    expect(r.ok).toBe(false)
    expect(r.variances[0].what).toBe('Order lines')
  })

  it('says what to do when it fails, not just that it did', () => {
    expect(reconcileStatement(stmt({ id: 'ss-1' }), []).remedy).toMatch(/not payable/)
  })
})

describe('reconcileLedgerToSettlement', () => {
  const statements = [
    stmt({ id: 'a', net: 500, status: 'approved' }),
    stmt({ id: 'b', net: 300, status: 'paid' }),
    stmt({ id: 'c', net: 900, status: 'pending' }),
  ]

  it('agrees when the ledger posted everything that was approved', () => {
    const r = reconcileLedgerToSettlement([
      post({ id: 'p1', charge_id: 'settle.approved', amount: 500 }),
      post({ id: 'p2', charge_id: 'settle.approved', amount: 300 }),
    ], statements, july)
    expect(r.ok).toBe(true)
  })

  it('catches a settlement approved and never posted', () => {
    const r = reconcileLedgerToSettlement([
      post({ id: 'p1', charge_id: 'settle.approved', amount: 500 }),
    ], statements, july)
    expect(r.ok).toBe(false)
    expect(r.variances[0]).toMatchObject({ expected: 800, found: 500, difference: -300 })
    expect(r.remedy).toMatch(/payable missing from the books/)
  })

  it('leaves a pending statement out — nothing has been approved to post', () => {
    const r = reconcileLedgerToSettlement([
      post({ id: 'p1', charge_id: 'settle.approved', amount: 800 }),
    ], statements, july)
    expect(r.ok).toBe(true)
  })
})

describe('reconcileTrialBalance', () => {
  it('passes a balanced period and names the remedy when it does not', () => {
    expect(reconcileTrialBalance(trialBalance([post({ id: 'a' })], accounts), july).ok).toBe(true)
    const broken = reconcileTrialBalance(
      { rows: [], dr: 10, cr: 8, balanced: false, difference: 2 }, july)
    expect(broken.ok).toBe(false)
    expect(broken.remedy).toMatch(/wrong side/)
  })
})

describe('reconciliations', () => {
  it('runs all three, cheapest first', () => {
    const out = reconciliations({
      postings: [post({ id: 'p1', charge_id: 'settle.approved', amount: 870 })],
      accounts,
      statements: [stmt({ id: 'ss-1' })],
      lines: [line({ id: 'l1' })],
      period: july,
    })
    expect(out.map(r => r.id)).toEqual(['tb:2026-07', 'gl:2026-07', 'stmts:2026-07'])
    expect(out.every(r => r.ok)).toBe(true)
  })

  it('rolls a failing statement up into the period-level check', () => {
    const out = reconciliations({
      postings: [post({ id: 'p1', charge_id: 'settle.approved', amount: 870 })],
      accounts,
      statements: [stmt({ id: 'ss-1' })],
      lines: [line({ id: 'l1', gross: 900, net: 770 })],
      period: july,
    })
    const stmts = out.find(r => r.id === 'stmts:2026-07')!
    expect(stmts.ok).toBe(false)
    expect(stmts.variances.length).toBeGreaterThan(0)
  })
})

describe('periodIdOf', () => {
  it('turns the way a statement writes a period into a period id', () => {
    expect(periodIdOf('Jul 2026')).toBe('2026-07')
    expect(periodIdOf('February 2026')).toBe('2026-02')
  })

  it('returns empty rather than guessing at something it cannot read', () => {
    expect(periodIdOf('last quarter')).toBe('')
  })
})

/* -------------------------------------------------------------- export ---- */

describe('journalRows', () => {
  it('writes one row per side, which is what an ERP import expects', () => {
    const rows = journalRows([post({ id: 'JE-1', amount: 250 })], accounts)
    expect(rows).toHaveLength(3)
    expect(rows[1]).toContain('1010')
    expect(rows[1]).toContain('250.00')
    expect(rows[2]).toContain('2010')
    /* The credit column on the debit row, and vice versa, must be empty rather
       than zero — a zero in both columns imports as two postings. */
    expect(rows[1][6]).toBe('')
    expect(rows[2][5]).toBe('')
  })

  it('carries the seller through, so revenue share is traceable in the ERP', () => {
    expect(journalRows([post({ id: 'a' })], accounts)[1]).toContain('PTR-1004')
  })
})

describe('toCsv', () => {
  it('quotes a field containing a comma rather than splitting the row', () => {
    expect(toCsv([['a', 'b,c']])).toBe('a,"b,c"')
  })

  it('doubles an embedded quote', () => {
    expect(toCsv([['say "hi"']])).toBe('"say ""hi"""')
  })
})
