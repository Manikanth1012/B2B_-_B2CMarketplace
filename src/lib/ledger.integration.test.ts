/* Touches the live Supabase project.
 *
 * The ledger's whole claim is that it reconciles to the records it was built
 * from rather than being computed beside them. These checks are that claim,
 * run against the real rows: the two columns agree, every entry traces to a
 * mapping and a period, what the ledger says was approved equals what the
 * settlement register approved, and every statement equals the sum of the order
 * lines a seller can see for themselves.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { supabase } from './supabase'
import { signIn, signOut } from './authRepo'
import { loadLedger, loadSellerStatements } from './ledgerRepo'
import type { LedgerBook } from './ledgerRepo'
import {
  trialBalance, earned, unmappedCharges, reconciliations, reconcileStatement,
  revenueSplit, shareBySeller, periodIdOf, openPeriod, journalRows,
} from './ledger'

const OPERATOR = { email: 'anika.sharma@aventa.com', password: 'operator123' }
const PARTNER  = { email: 'rajesh.kumar@nimbussensors.com', password: 'partner123' }
const DEMO = 'PTR-1004'

describe('the ledger, read by the marketplace', () => {
  let book: LedgerBook

  beforeAll(async () => {
    await signIn(OPERATOR.email, OPERATOR.password)
    book = await loadLedger()
    expect(book.loadError).toBeUndefined()
    expect(book.postings.length).toBeGreaterThan(100)
  })

  afterAll(async () => { await signOut() })

  it('balances, in every period and overall', () => {
    expect(trialBalance(book.postings, book.accounts).balanced).toBe(true)
    for (const p of book.periods) {
      const tb = trialBalance(book.postings, book.accounts, p.id)
      expect(tb.balanced, `${p.label} is out by ${tb.difference}`).toBe(true)
    }
  })

  it('maps every charge somewhere', () => {
    expect(unmappedCharges(book.charges, book.mapping).map(c => c.id)).toEqual([])
  })

  it('never posts an account to itself', () => {
    for (const p of book.postings) {
      expect(p.dr, `${p.id} posts ${p.dr} to itself`).not.toBe(p.cr)
    }
  })

  it('resolves every posting to an account in the chart', () => {
    const codes = new Set(book.accounts.map(a => a.code))
    for (const p of book.postings) {
      expect(codes.has(p.dr), `${p.id} debits ${p.dr}, which is not in the chart`).toBe(true)
      expect(codes.has(p.cr), `${p.id} credits ${p.cr}, which is not in the chart`).toBe(true)
    }
  })

  it('keeps every automatic entry in step with its own mapping', () => {
    /* A posting that has drifted from the rule it claims to come from is the
       one nobody can explain at audit. */
    for (const p of book.postings.filter(x => x.source === 'automatic')) {
      const m = book.mapping.find(x => x.charge_id === p.charge_id)!
      expect(p.dr, `${p.id} debits ${p.dr}; ${p.charge_id} maps to ${m.dr}`).toBe(m.dr)
      expect(p.cr).toBe(m.cr)
    }
  })

  it('keeps what passed through well clear of what was earned', () => {
    /* If these ever converge, gross is being booked as revenue — the mistake
       this whole schema exists to prevent. */
    const e = earned(book.postings, book.accounts)
    expect(e.passedThrough).toBeGreaterThan(0)
    expect(e.revenue).toBeGreaterThan(0)
    expect(e.revenue).toBeLessThan(e.passedThrough * 0.4)
  })

  it('has exactly one open period', () => {
    expect(book.periods.filter(p => p.status === 'open')).toHaveLength(1)
  })

  it('passes all three reconciliations in every period', () => {
    for (const p of book.periods) {
      const checks = reconciliations({
        postings: book.postings, accounts: book.accounts,
        statements: book.statements, lines: book.lines, period: p,
      })
      for (const c of checks) {
        expect(c.ok, `${c.name}: ${c.variances.map(v => `${v.what} out by ${v.difference}`).join('; ')}`).toBe(true)
      }
    }
  })

  it('gives every statement line detail that adds up to it', () => {
    for (const s of book.statements) {
      const r = reconcileStatement(s, book.lines)
      expect(r.ok, `${s.id}: ${r.variances.map(v => `${v.what} out by ${v.difference}`).join('; ')}`).toBe(true)
    }
  })

  it('bills nobody for somebody else’s product', async () => {
    const { data } = await supabase.from('products').select('id,partner_id')
    const owner = new Map(((data ?? []) as { id: string; partner_id: string | null }[])
      .map(p => [p.id, p.partner_id]))
    for (const l of book.lines) {
      expect(owner.get(l.product_id) ?? null,
        `${l.id} bills ${l.partner_id} for ${l.product_id}`).toBe(l.partner_id)
    }
  })

  it('divides a period’s gross with nothing left over', () => {
    const period = openPeriod(book.periods)!
    const statements = book.statements.filter(s => periodIdOf(s.period) === period.id)
    const ids = new Set(statements.map(s => s.id))
    const lines = book.lines.filter(l => ids.has(l.statement_id))
    const split = revenueSplit(lines, statements)
    expect(split.gross).toBeGreaterThan(0)
    expect(+(split.sellerNet + split.commission + split.fees + split.refunds + split.withholding).toFixed(2))
      .toBe(split.gross)
  })

  it('shows every seller the rate they were actually charged', () => {
    const period = openPeriod(book.periods)!
    const statements = book.statements.filter(s => periodIdOf(s.period) === period.id)
    const ids = new Set(statements.map(s => s.id))
    const rows = shareBySeller(book.lines.filter(l => ids.has(l.statement_id)), statements)
    expect(rows.length).toBeGreaterThan(5)
    for (const r of rows) {
      if (r.gross > 0) expect(r.effectiveRate).not.toBeNull()
    }
  })

  it('exports a journal an ERP could load, two rows to an entry', () => {
    const rows = journalRows(book.postings.slice(0, 10), book.accounts)
    expect(rows).toHaveLength(21)
    /* One side per row: a zero in both columns imports as two postings. */
    for (const r of rows.slice(1)) {
      expect(r[5] === '' || r[6] === '').toBe(true)
    }
  })
})

describe('a seller checking their own statement', () => {
  beforeAll(async () => { await signIn(PARTNER.email, PARTNER.password) })
  afterAll(async () => { await signOut() })

  it('sees the line detail behind their own statements', async () => {
    const snap = await loadSellerStatements(DEMO)
    expect(snap.loadError).toBeUndefined()
    expect(snap.statements.length).toBeGreaterThan(0)
    expect(snap.lines.length).toBeGreaterThan(0)
    expect(snap.lines.every(l => l.partner_id === DEMO)).toBe(true)
  })

  it('can add the lines up to the statement themselves', async () => {
    const snap = await loadSellerStatements(DEMO)
    for (const s of snap.statements) {
      expect(reconcileStatement(s, snap.lines).ok, `${s.id} does not reconcile for the seller`).toBe(true)
    }
  })

  it('sees no other seller’s revenue', async () => {
    const other = await loadSellerStatements('PTR-1001')
    expect(other.lines).toEqual([])
  })

  it('cannot read the marketplace’s own books', async () => {
    /* The chart of accounts, the postings and the mapping are the marketplace's
       internal record. A seller reading them would be reading every other
       seller's revenue. */
    const [accounts, postings, mapping] = await Promise.all([
      supabase.from('gl_accounts').select('code'),
      supabase.from('gl_postings').select('id'),
      supabase.from('gl_mapping').select('charge_id'),
    ])
    expect(accounts.data ?? []).toEqual([])
    expect(postings.data ?? []).toEqual([])
    expect(mapping.data ?? []).toEqual([])
  })

  it('cannot rewrite a line to increase what it is owed', async () => {
    const before = (await loadSellerStatements(DEMO)).lines[0]
    await supabase.from('settlement_lines')
      .update({ commission: 0, net: Number(before.gross) }).eq('id', before.id)
    const after = (await loadSellerStatements(DEMO)).lines.find(l => l.id === before.id)!
    expect(Number(after.commission), 'a seller wrote off their own commission').toBe(Number(before.commission))
    expect(Number(after.net)).toBe(Number(before.net))
  })
})
