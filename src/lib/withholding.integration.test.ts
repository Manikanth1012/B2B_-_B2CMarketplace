/* Touches the live Supabase project. Reads only.
 *
 * Withholding is computed twice: once in `withholding_on` inside the
 * transaction that writes a statement, and once in `withholding.ts` for the
 * screens that have to say what will be deducted before any run happens. Two
 * evaluations of one published rule are only safe while something reconciles
 * them, and this is that something.
 *
 * The rest of the file is about the data the rules run against, because a rule
 * that no payment is eligible for is a rule nobody has checked. Every seller
 * was domestic until this suite had something to say about it, which meant the
 * treaty rate, the non-resident rate and the certificate renewal window were
 * all unreachable — three-quarters of the model, configured and dead.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { supabase } from './supabase'
import { signIn, signOut } from './authRepo'
import { loadWithholdingPositions } from './settlementCycleRepo'
import {
  rulesFor, rateFor, deductionsOn, totalOf, effectiveRate, payeeWarnings, positionLine,
} from './withholding'
import type { Rule } from './withholding'
import { taxPosition, RENEWAL_WINDOW_DAYS } from './partnerDetails'
import type { BankAccount } from './partnerDetails'

const OPERATOR = { email: 'anika.sharma@aventa.com', password: 'operator123' }

let rules: Rule[] = []
let payees: Awaited<ReturnType<typeof loadWithholdingPositions>>['payees'] = []
let banks: BankAccount[] = []

beforeAll(async () => {
  await signIn(OPERATOR.email, OPERATOR.password)
  const pos = await loadWithholdingPositions()
  expect(pos.loadError, pos.loadError ?? '').toBeUndefined()
  rules = pos.rules
  payees = pos.payees
  const { data } = await supabase.from('partner_bank').select('*')
  banks = (data ?? []) as BankAccount[]
  expect(rules.length).toBeGreaterThan(0)
  expect(payees.length).toBeGreaterThan(0)
})

afterAll(async () => { await signOut() })

describe('the rule and its second evaluation', () => {
  /* The reconciliation. If these two ever part company, a statement is written
     with one deduction and the seller was shown another. */
  it('agrees with the database, payee by payee and rule by rule', async () => {
    const amounts = { gross: 12500, commission: 1750, net: 10500 }
    const on = new Date().toISOString().slice(0, 10)

    for (const p of payees) {
      const residence = p.tax_residence ?? p.market
      const { data, error } = await supabase.rpc('withholding_on', {
        p_market: p.market, p_applies_to: 'partner-payout',
        p_residence: residence, p_treaty: p.treaty_on_file,
        p_gross: amounts.gross, p_commission: amounts.commission, p_net: amounts.net,
        p_on: on,
      })
      expect(error, `${p.partner_id}: ${error?.message}`).toBeNull()

      const sql = ((data ?? []) as { rule_id: string; rate: number; amount: number }[])
        .filter(d => Number(d.amount) > 0)
      const ts = deductionsOn({
        rules, market: p.market, direction: 'partner-payout',
        payee: { residence, treaty_on_file: p.treaty_on_file },
        amounts, on,
      })

      expect(ts.map(d => d.rule_id).sort(),
        `${p.partner_name} is deducted under different statutes by the two`)
        .toEqual(sql.map(d => d.rule_id).sort())
      for (const d of ts) {
        const other = sql.find(x => x.rule_id === d.rule_id)!
        expect(Number(other.rate), `${p.partner_name} / ${d.rule_id}: rate`).toBe(d.rate)
        expect(Math.abs(Number(other.amount) - d.amount),
          `${p.partner_name} / ${d.rule_id}: ${other.amount} in the database, ${d.amount} on the screen`)
          .toBeLessThan(0.005)
      }
    }
  })
})

describe('the cases the rules exist for', () => {
  /* Residence, not the flag, decides. A payee resident where they are paid is
     charged the domestic rate whatever certificate they hold. */
  it('has a payee whose payment crosses a border', () => {
    const crossing = payees.filter(p => (p.tax_residence ?? p.market) !== p.market)
    expect(crossing.length,
      'every payee is domestic, so the non-resident and treaty rates are unreachable')
      .toBeGreaterThan(0)
  })

  it('reaches the treaty rate on a real payee, and it is cheaper than the statutory one', () => {
    const crossing = payees.filter(p =>
      (p.tax_residence ?? p.market) !== p.market && p.treaty_on_file)
    expect(crossing.length).toBeGreaterThan(0)

    for (const p of crossing) {
      const live = rulesFor(rules, p.market, 'partner-payout', new Date().toISOString().slice(0, 10))
      const relieved = live.filter(r => r.treaty_rate != null)
      expect(relieved.length, `${p.partner_name} holds a certificate no rule gives relief under`)
        .toBeGreaterThan(0)
      for (const r of relieved) {
        const payee = { residence: p.tax_residence!, treaty_on_file: true }
        const without = rateFor(r, p.market, { ...payee, treaty_on_file: false })
        expect(rateFor(r, p.market, payee), `${r.id} does not apply the treaty rate`).toBe(r.treaty_rate)
        expect(without, `${r.id}'s treaty rate is no cheaper than going without one`)
          .toBeGreaterThan(r.treaty_rate!)
      }
    }
  })

  /* The reason the certificate is worth chasing, in money. */
  it('costs a cross-border seller real money to let the certificate lapse', () => {
    const p = payees.find(x => (x.tax_residence ?? x.market) !== x.market)!
    const amounts = { gross: 12500, commission: 1750, net: 10500 }
    const on = new Date().toISOString().slice(0, 10)
    const arg = (treaty: boolean) => ({
      rules, market: p.market, direction: 'partner-payout' as const,
      payee: { residence: p.tax_residence!, treaty_on_file: treaty }, amounts, on,
    })
    const withCert = totalOf(deductionsOn(arg(true)))
    const without = totalOf(deductionsOn(arg(false)))
    expect(without).toBeGreaterThan(withCert)
    expect(effectiveRate(deductionsOn(arg(false)), amounts.gross))
      .toBeGreaterThan(effectiveRate(deductionsOn(arg(true)), amounts.gross))
  })

  it('has a certificate inside the renewal window, so the countdown counts something', () => {
    const inWindow = banks.filter(b => {
      const pos = taxPosition(b, new Date())
      return pos.level === 'expiring'
    })
    expect(inWindow.length,
      `no certificate expires within ${RENEWAL_WINDOW_DAYS} days, so the renewal panel is shown against nothing`)
      .toBeGreaterThan(0)
    for (const b of inWindow) {
      expect(taxPosition(b, new Date()).daysLeft).toBeLessThanOrEqual(RENEWAL_WINDOW_DAYS)
    }
  })
})

describe('what the screen says about each payee', () => {
  /* The error the whole module replaces: thirteen sellers, all domestic, all
     recorded as claiming relief under a treaty that governs nothing. */
  it('finds no treaty certificate recorded against a domestic payment', () => {
    const on = new Date().toISOString().slice(0, 10)
    for (const p of payees) {
      const warnings = payeeWarnings(
        { residence: p.tax_residence ?? p.market, treaty_on_file: p.treaty_on_file,
          tax_id: p.tax_id, treaty_expires: p.treaty_expires },
        p.market, on)
      expect(warnings.filter(w => w.includes('domestic payee')),
        `${p.partner_name} still claims relief on a payment that does not cross a border`)
        .toEqual([])
    }
  })

  it('identifies every payee, because an unidentified one is deducted at double', () => {
    for (const p of payees) {
      expect(p.tax_id, `${p.partner_name} has no tax identifier`).toBeTruthy()
      expect(p.tax_label, `${p.partner_name}'s identifier is not labelled`).toBeTruthy()
    }
    expect(new Set(payees.map(p => p.tax_id)).size,
      'sellers share a tax identifier, which is the first thing an authority queries')
      .toBe(payees.length)
  })

  it('explains the position in a sentence that names a statute', () => {
    const on = new Date().toISOString().slice(0, 10)
    for (const p of payees) {
      const line = positionLine(rules, p.market,
        { residence: p.tax_residence ?? p.market, treaty_on_file: p.treaty_on_file }, on)
      expect(line.length, `${p.partner_name} gets no explanation at all`).toBeGreaterThan(20)
      expect(line, `${p.partner_name}'s explanation says nothing has been decided`)
        .not.toMatch(/nobody has decided/)
    }
  })
})

describe('what was actually deducted', () => {
  it('deducts on every unapproved statement at the rate its own payee attracts', async () => {
    const { data } = await supabase.from('settlement_statements')
      .select('id,partner_id,gross,commission,fees,refunds,net,withholding,withholding_rate,withholding_detail,closed_on,status')
    const rows = (data ?? []) as unknown as Record<string, string & number & unknown[]>[]
    expect(rows.length).toBeGreaterThan(0)

    for (const s of rows) {
      const stack = Number(s.gross) - Number(s.commission) - Number(s.fees)
        - Number(s.refunds) - Number(s.withholding)
      expect(Math.abs(Number(s.net) - stack), `${s.id} does not reconcile after withholding`)
        .toBeLessThan(0.02)

      const detail = (s.withholding_detail ?? []) as { rule_id: string; amount: number }[]
      const summed = detail.reduce((n, d) => n + Number(d.amount), 0)
      expect(Math.abs(summed - Number(s.withholding)),
        `${s.id} withholds ${s.withholding} and itemises ${summed.toFixed(2)}`)
        .toBeLessThan(0.02)

      if (Number(s.gross) > 0) {
        expect(Math.abs(Number(s.withholding_rate) - Number(s.withholding) / Number(s.gross) * 100),
          `${s.id}'s effective rate disagrees with what it deducted`)
          .toBeLessThan(0.01)
      }
    }
  })

  it('gives every deduction a certificate the seller can claim it back with', async () => {
    const { data } = await supabase.from('withholding_certificate').select('*')
    const certs = (data ?? []) as { partner_id: string; amount: number; form: string; rule_id: string; status: string }[]
    expect(certs.length).toBeGreaterThan(0)
    for (const c of certs) {
      expect(Number(c.amount), `${c.partner_id}'s ${c.rule_id} certificate is for nothing`).toBeGreaterThan(0)
      expect(c.form, `${c.partner_id}'s ${c.rule_id} deduction names no document`).toBeTruthy()
      expect(['accruing', 'filed', 'issued']).toContain(c.status)
    }
  })
})
