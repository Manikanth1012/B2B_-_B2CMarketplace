import { describe, it, expect, beforeAll } from 'vitest'
import { supabase } from './supabase'
import {
  windowFor, lastClosed, nextClose, dueOn, periodLabel, heldBack, settle, projectPayout,
} from './settlementCycle'
import type { Terms } from './settlementCycle'
import type { Rule } from './withholding'

const signIn = async (email: string, password: string) => {
  const { error } = await supabase.auth.signInWithPassword({ email, password })
  expect(error, `could not sign in as ${email}`).toBeNull()
}

/* The settlement cycle exists twice: as `settlement_window` and friends in the
 * database, because a run has to write its statements in one transaction, and
 * as `settlementCycle.ts`, because a screen has to say when a partner is next
 * paid for a period nobody has run yet.
 *
 * Two evaluations of one published rule. This is the only thing that keeps them
 * honest, and it runs against the real contracts rather than a fixture — the
 * "closes on the 25th" bug was invisible on every frequency but the one a real
 * partner is actually on.
 */
describe('the settlement cycle, in the database and in TypeScript', () => {
  let terms: Terms[]
  const TODAY = new Date().toISOString().slice(0, 10)

  beforeAll(async () => {
    await supabase.auth.signOut()
    await signIn('anika.sharma@aventa.com', 'operator123')
    const { data, error } = await supabase.from('partner_settlement_terms').select('*').order('partner_id')
    expect(error).toBeNull()
    terms = (data ?? []).map(t => ({
      ...(t as Terms),
      closes_on_day: Number((t as Terms).closes_on_day),
      pay_within_days: Number((t as Terms).pay_within_days),
      hold_days: Number((t as Terms).hold_days),
      minimum_payout: Number((t as Terms).minimum_payout),
    }))
  })

  it('has a contract for every live partner, across all four frequencies', () => {
    expect(terms.length).toBeGreaterThan(10)
    expect(new Set(terms.map(t => t.frequency))).toEqual(
      new Set(['monthly', 'quarterly', 'half-yearly', 'yearly']))
    /* Both alignments, because a system that only ever runs one silently pays
       the other partner on the wrong days. */
    expect(new Set(terms.map(t => t.align))).toEqual(new Set(['calendar', 'anniversary']))
  })

  it('agrees with the database on which period is running', async () => {
    /* Through the view the screens read, which is the arithmetic reached the
       way a caller reaches it rather than through a probe written for a test. */
    const { data: due, error } = await supabase.from('settlement_due').select('*')
    expect(error).toBeNull()

    for (const row of (due ?? []) as { partner_id: string; period_start: string | null; period_end: string | null; closed_on: string | null; next_close: string | null }[]) {
      const t = terms.find(x => x.partner_id === row.partner_id)!
      const mine = lastClosed(t, TODAY)

      expect(row.period_start ?? null, `${row.partner_id}: last closed period start`).toBe(mine?.start ?? null)
      expect(row.period_end ?? null, `${row.partner_id}: last closed period end`).toBe(mine?.end ?? null)
      expect(row.closed_on ?? null, `${row.partner_id}: close date`).toBe(mine?.closes ?? null)
      expect(row.next_close ?? null, `${row.partner_id}: next close`).toBe(nextClose(t, TODAY))
    }
  })

  it('agrees with the database on the period each partner is accruing into', async () => {
    const { data, error } = await supabase.from('settlement_accruing').select('*')
    expect(error).toBeNull()
    expect((data ?? []).length, 'nothing is accruing, so this checked nothing').toBeGreaterThan(0)

    for (const row of (data ?? []) as { partner_id: string; period_start: string; period_end: string; closed_on: string; due_on: string }[]) {
      const t = terms.find(x => x.partner_id === row.partner_id)!
      const w = windowFor(t, TODAY)!
      expect(row.period_start, `${row.partner_id}: accruing start`).toBe(w.start)
      expect(row.period_end, `${row.partner_id}: accruing end`).toBe(w.end)
      expect(row.closed_on, `${row.partner_id}: accruing close`).toBe(w.closes)
      expect(row.due_on, `${row.partner_id}: accruing due`).toBe(dueOn(t, w.closes))
    }
  })

  it('agrees on how much is held back inside each hold window', async () => {
    const { data: acc } = await supabase.from('settlement_accruing').select('*')
    const { data: lines } = await supabase.from('settlement_lines')
      .select('partner_id, net, occurred_on, statement_id').is('statement_id', null)

    for (const row of (acc ?? []) as { partner_id: string; held_back: string; closed_on: string; period_start: string; period_end: string }[]) {
      const t = terms.find(x => x.partner_id === row.partner_id)!
      const mine = heldBack(
        ((lines ?? []) as { partner_id: string; net: string; occurred_on: string }[])
          .filter(l => l.partner_id === row.partner_id
            && l.occurred_on >= row.period_start && l.occurred_on <= row.period_end)
          .map(l => ({ net: Number(l.net), occurred_on: l.occurred_on })),
        t, row.closed_on)
      expect(Math.abs(Number(row.held_back) - mine), `${row.partner_id}: held back`).toBeLessThan(0.02)
    }
  })

  it('names every issued period the way the contract does', async () => {
    const { data } = await supabase.from('settlement_statements')
      .select('id, partner_id, period, period_start, frequency')
    for (const s of (data ?? []) as { id: string; period: string; period_start: string; frequency: Terms['frequency'] }[]) {
      expect(s.period, `${s.id}`).toBe(periodLabel(s.frequency, s.period_start))
    }
  })

  /* `settlement_statements.net` is stored AFTER withholding — the run writes
     `after_wht` into it, and the statement screen reads it that way ("the
     payout is $net, because withholding is deducted at statement level").
     `settlement_accruing.net` is the sum of the line nets, before any tax. Two
     columns of the same name meaning different things; feeding a statement row
     to `projectPayout` would deduct the tax twice.

     So the pre-tax figure the module is given here is reconstructed rather than
     read, and the check is that putting it back through the module lands on
     what the run stored. */
  it('pays every issued statement the way the module would have', async () => {
    const { data } = await supabase.from('settlement_statements')
      .select('id, partner_id, net, withholding, held_back, carried_in, carried_out, status')
      .neq('status', 'open')

    let taxed = 0
    for (const s of (data ?? []) as Record<string, string>[]) {
      const t = terms.find(x => x.partner_id === s.partner_id)
      if (!t) continue
      const withheld = Number(s.withholding ?? 0)
      if (withheld > 0) taxed++
      const mine = settle({
        earned: Number(s.net) + withheld, withheld, held: Number(s.held_back),
        carriedIn: Number(s.carried_in), terms: t,
      })

      /* The order the run uses: tax comes off before anything is held, so what
         is left after tax is exactly the figure it stored as the net. A module
         that deducted in the wrong place would still balance its own books and
         disagree with this. */
      expect(Math.abs((mine.earned - mine.withheld) - Number(s.net)), `${s.id}: net after tax`)
        .toBeLessThan(0.02)

      /* What carries forward is the figure that decides whether money moves at
         all, so it is the one worth reconciling rather than the net. */
      expect(Math.abs(mine.carriedOut - Number(s.carried_out)), `${s.id}: carried out`)
        .toBeLessThan(0.02)

      /* And what is transferred: `after_wht - held + carried`, the run's own
         expression. Reconciling `carried_out` alone never caught the missing
         tax term, because a deduction does not change what carries. */
      expect(
        Math.abs(mine.payable - Math.max(0, Number(s.net) - Number(s.held_back) + Number(s.carried_in))),
        `${s.id}: payable`,
      ).toBeLessThan(0.02)
    }

    expect(taxed, 'no statement deducted anything, so the tax term went unchecked')
      .toBeGreaterThan(0)
  })

  /* The seller's own card projects a close that has not happened, off the
     accruing view. If those inputs stop arriving the projection silently falls
     back to the figure this whole change replaced. */
  it('gives the accrual card everything it needs to project a close', async () => {
    const { data, error } = await supabase.from('settlement_accruing').select('*')
    expect(error, error?.message).toBeNull()
    const rows = (data ?? []) as Record<string, string | boolean>[]
    expect(rows.length).toBeGreaterThan(0)

    for (const row of rows) {
      expect(row.market, `${row.partner_id}: no market`).toBeTruthy()
      expect(row.tax_residence, `${row.partner_id}: no tax residence`).toBeTruthy()
      expect(typeof row.treaty_on_file, `${row.partner_id}: treaty flag`).toBe('boolean')
      expect(Number(row.carried_in), `${row.partner_id}: carry-in`).toBeGreaterThanOrEqual(0)
    }

    /* Both sides of the comparison the whole withholding model turns on. A
       marketplace where every seller is resident where they sell never
       exercises the non-resident branch, and the treaty rate stays theory. */
    expect(rows.some(r => r.tax_residence !== r.market),
      'every seller is resident in their own market, so the cross-border rate is untested')
      .toBe(true)
  })

  /* The projection and the run are the two evaluations of one rule, and the
     only way to know they agree is to close a period both ways. */
  it('projects the same deduction the run computed, on the periods already settled', async () => {
    const [{ data: statements }, { data: ruleRows }] = await Promise.all([
      supabase.from('settlement_statements')
        .select('id, partner_id, gross, commission, fees, refunds, withholding, closed_on')
        .gt('withholding', 0),
      supabase.from('withholding_rule').select('*').order('sort_order'),
    ])
    const rules = ((ruleRows ?? []) as Record<string, string>[]).map(r => ({
      ...r,
      resident_rate: Number(r.resident_rate),
      non_resident_rate: Number(r.non_resident_rate),
      treaty_rate: r.treaty_rate == null ? null : Number(r.treaty_rate),
      sort_order: Number(r.sort_order),
    })) as unknown as Rule[]

    const { data: banks } = await supabase.from('partner_bank')
      .select('partner_id, tax_residence, treaty_on_file')
    const { data: partners } = await supabase.from('partners').select('id, market')
    const marketOf = new Map(((partners ?? []) as { id: string; market: string }[])
      .map(p => [p.id, p.market]))
    const bankOf = new Map(((banks ?? []) as {
      partner_id: string; tax_residence: string | null; treaty_on_file: boolean
    }[]).map(b => [b.partner_id, b]))

    const rows = (statements ?? []) as Record<string, string>[]
    expect(rows.length, 'nothing was ever deducted, so this checked nothing').toBeGreaterThan(0)

    for (const s of rows) {
      const market = marketOf.get(s.partner_id)!
      const bank = bankOf.get(s.partner_id)
      const t = terms.find(x => x.partner_id === s.partner_id)
      if (!t) continue

      const mine = projectPayout({
        accruing: {
          gross: Number(s.gross), commission: Number(s.commission),
          fees: Number(s.fees), refunds: Number(s.refunds),
          /* Not read for the deduction, which is the point — the tax comes off
             the gross-to-net stack, not off whatever `net` happens to say. */
          net: 0, held_back: 0, carried_in: 0,
          market,
          tax_residence: bank?.tax_residence ?? market,
          treaty_on_file: bank?.treaty_on_file ?? false,
          closed_on: s.closed_on,
        },
        terms: t,
        rules,
      })
      expect(Math.abs(mine.withheld - Number(s.withholding)), `${s.id}: withheld`)
        .toBeLessThan(0.02)
    }
  })

  it('refuses a run dated into the future, before it writes anything', async () => {
    const before = await supabase.from('settlement_statements').select('id')
    const { error } = await supabase.rpc('run_settlements', {
      p_as_of: '2027-12-31', p_actor: 'integration test', p_kind: 'manual', p_only: null,
    })
    expect(error, 'a run was accepted for a date that has not happened').not.toBeNull()
    expect(error!.message).toMatch(/cannot be dated/)

    /* And nothing was written on the way to being refused — the point of
       checking the date before the loop rather than inside it. */
    const after = await supabase.from('settlement_statements').select('id')
    expect((after.data ?? []).length).toBe((before.data ?? []).length)
  })

  it('is idempotent — a second run finds the first run’s statements', async () => {
    const { data: first, error: e1 } = await supabase.rpc('run_settlements', {
      p_as_of: new Date().toISOString().slice(0, 10),
      p_actor: 'integration test', p_kind: 'manual', p_only: null,
    })
    expect(e1).toBeNull()
    const one = first as { settled: number; skipped: { already?: boolean }[] }

    const { data: second, error: e2 } = await supabase.rpc('run_settlements', {
      p_as_of: new Date().toISOString().slice(0, 10),
      p_actor: 'integration test', p_kind: 'manual', p_only: null,
    })
    expect(e2).toBeNull()
    const two = second as { settled: number; skipped: { already?: boolean }[] }

    /* The second run settles nothing the first one did. Whatever the first run
       created, the second finds and reports as already settled. */
    expect(two.settled).toBe(0)
    expect(one.settled + two.settled).toBe(one.settled)
    /* And every skip names a partner and a reason — "three were skipped" is
       not something anybody can act on. */
    for (const s of two.skipped as { partner_id?: string; partner?: string; reason?: string }[]) {
      expect(s.partner_id, 'a skip with no partner on it').toBeTruthy()
      expect(s.reason, `${s.partner_id} was skipped with no reason`).toBeTruthy()
    }
  })

  it('leaves no run on record that settled nothing', async () => {
    const { data: runs } = await supabase.from('settlement_run').select('id, settled, ran_on')
    const { data: stmts } = await supabase.from('settlement_statements').select('run_id')
    const counted = new Map<string, number>()
    for (const s of (stmts ?? []) as { run_id: string | null }[]) {
      if (s.run_id) counted.set(s.run_id, (counted.get(s.run_id) ?? 0) + 1)
    }
    for (const r of (runs ?? []) as { id: string; settled: number; ran_on: string }[]) {
      expect(counted.get(r.id) ?? 0, `${r.id} settled nothing`).toBeGreaterThan(0)
      expect(Number(r.settled), `${r.id} claims a count it does not have`).toBe(counted.get(r.id))
      expect(r.ran_on <= TODAY, `${r.id} is dated in the future`).toBe(true)
    }
  })

  it('does not let a seller run settlement for themselves', async () => {
    await supabase.auth.signOut()
    await signIn('rajesh.kumar@nimbussensors.com', 'partner123')
    const { error } = await supabase.rpc('run_settlements', {
      p_as_of: TODAY, p_actor: 'a seller', p_kind: 'manual', p_only: 'PTR-1004',
    })
    expect(error, 'a seller ran settlement').not.toBeNull()
    expect(error!.message).toMatch(/Only the marketplace/)

    await supabase.auth.signOut()
    await signIn('anika.sharma@aventa.com', 'operator123')
  })

  it('shows a seller their own cycle and nobody else’s', async () => {
    await supabase.auth.signOut()
    await signIn('rajesh.kumar@nimbussensors.com', 'partner123')
    const { data } = await supabase.from('partner_settlement_terms').select('partner_id')
    expect((data ?? []).map(r => (r as { partner_id: string }).partner_id)).toEqual(['PTR-1004'])

    await supabase.auth.signOut()
    await signIn('anika.sharma@aventa.com', 'operator123')
  })
})
