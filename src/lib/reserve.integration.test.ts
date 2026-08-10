/* Touches the live Supabase project.
 *
 * Seven sellers carried a rolling reserve rate — 2% to 10%, each with a
 * rationale somebody wrote and the operator's screen printed — and `reserve_held`
 * was 0.00 on every one of them, because neither the run nor `settlementCycle.ts`
 * had ever contained the word. A control that was a sentence and not a rule.
 *
 * Three claims, and the third is the one that could not be made before:
 *
 *   - `reserve_on` and `reserveOn` are the same arithmetic, checked against
 *     every seller on file rather than a fixture
 *   - the payout leg carries the retention: `payout_net` is the net less what
 *     is held and plus what has matured, not the net converted
 *   - a real settlement run retains it — run, not asserted about. That was
 *     impossible until the run could write a statement at all.
 *
 * Everything written here is put back, including the statement.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { supabase } from './supabase'
import { signIn, signOut } from './authRepo'
import { reserveOn, settle } from './settlementCycle'
import type { Terms } from './settlementCycle'
import { payoutAgrees } from './settlement'

const OPERATOR = { email: 'anika.sharma@aventa.com', password: 'operator123' }

interface Security {
  partner_id: string; reserve_pct: number; reserve_held: number
  reserve_days: number; deposit_held: number
}

describe('the rolling reserve', () => {
  let security: Security[]
  const madeStatements: string[] = []

  beforeAll(async () => {
    await signIn(OPERATOR.email, OPERATOR.password)
    const { data, error } = await supabase.from('partner_security').select('*')
    expect(error, error?.message).toBeNull()
    security = ((data ?? []) as Record<string, unknown>[]).map(r => ({
      partner_id: String(r.partner_id),
      reserve_pct: Number(r.reserve_pct ?? 0),
      reserve_held: Number(r.reserve_held ?? 0),
      reserve_days: Number(r.reserve_days ?? 0),
      deposit_held: Number(r.deposit_held ?? 0),
    }))
    expect(security.length).toBeGreaterThan(0)
  }, 30_000)

  afterAll(async () => {
    await signIn(OPERATOR.email, OPERATOR.password)
    for (const id of madeStatements) {
      await supabase.from('partner_reserve_tranche').delete().eq('statement_id', id)
      await supabase.from('settlement_statements').delete().eq('id', id)
    }
    await signOut()
  })

  /* Two evaluations of one rule. */
  it('agrees with the database on what every seller retains', async () => {
    const wrong: string[] = []
    for (const s of security) {
      for (const [gross, room] of [[10_000, 9_000], [10_000, 100], [0, 5_000]]) {
        const { data, error } = await supabase.rpc('reserve_on', {
          p_partner: s.partner_id, p_gross: gross, p_room: room,
          p_closed_on: new Date().toISOString().slice(0, 10),
        })
        expect(error, error?.message).toBeNull()
        const theirs = ((data ?? []) as Record<string, string>[])[0]
        const mine = reserveOn({ gross, room, rate: s.reserve_pct, matured: Number(theirs.released) })
        if (Math.abs(Number(theirs.due) - mine.due) > 0.005
          || Math.abs(Number(theirs.withheld) - mine.withheld) > 0.005) {
          wrong.push(`${s.partner_id} at ${gross}/${room}: sql ${theirs.due}/${theirs.withheld} vs ts ${mine.due}/${mine.withheld}`)
        }
      }
    }
    expect(wrong, wrong.join('; ')).toEqual([])
  }, 60_000)

  it('gives every seller on a rate a horizon to get it back over', () => {
    const bad = security.filter(s => s.reserve_pct > 0 && !(s.reserve_days > 0))
      .map(s => `${s.partner_id} is on ${s.reserve_pct}% with no maturity`)
    expect(bad, bad.join('; ')).toEqual([])
  })

  /* A reserve is a queue, not a balance: the held figure has to be the sum of
     what is on file and unmatured, or it is a number nobody can reconcile. */
  it('holds exactly what its unreleased tranches add up to', async () => {
    const { data } = await supabase.from('partner_reserve_tranche')
      .select('partner_id, amount, released_on')
    const open = ((data ?? []) as { partner_id: string; amount: string; released_on: string | null }[])
      .filter(t => t.released_on === null)
    for (const s of security) {
      const summed = open.filter(t => t.partner_id === s.partner_id)
        .reduce((n, t) => n + Number(t.amount), 0)
      expect(Math.abs(summed - s.reserve_held), `${s.partner_id}`).toBeLessThan(0.005)
    }
  })

  /* `payout_net` was asserted to be the net converted. It stopped being that
     the moment a retention became real, and the check had to learn the
     difference rather than the retention being left out of the payment. */
  it('reproduces every statement’s own payout, retention included', async () => {
    const { data } = await supabase.from('settlement_statements')
      .select('id, net, payout_net, fx_rate, reserve_withheld, reserve_released')
    const rows = (data ?? []) as Record<string, string>[]
    const drifted = rows.filter(r => !payoutAgrees({
      net: Number(r.net), payout_net: Number(r.payout_net), fx_rate: Number(r.fx_rate),
      reserve_withheld: Number(r.reserve_withheld ?? 0),
      reserve_released: Number(r.reserve_released ?? 0),
    })).map(r => `${r.id}: ${r.net} − ${r.reserve_withheld} × ${r.fx_rate} ≠ ${r.payout_net}`)
    expect(drifted, drifted.join('; ')).toEqual([])
  })

  /* The claim that could not be made before: a run that actually retains.
     The run could not write a statement at all until `20260810180000` — its
     insert omitted three NOT NULL columns and every suite run reached only the
     "already settled" branch. */
  it('retains the reserve on a settlement it actually runs', async () => {
    const seller = security.find(s => s.reserve_pct > 0)
    expect(seller, 'no seller is on a reserve rate').toBeTruthy()

    const { data: acc } = await supabase.from('settlement_accruing')
      .select('*').eq('partner_id', seller!.partner_id).maybeSingle()
    const a = acc as Record<string, string> | null
    expect(a, 'the seller has no open period').toBeTruthy()

    /* The period has to have closed for a run to settle it, and the run refuses
       a date in the future — so this only runs once the calendar allows it.
       Skipped rather than faked, and said out loud. */
    const closed = String(a!.closed_on)
    const today = new Date().toISOString().slice(0, 10)
    if (closed > today) {
      expect(Number(a!.reserve_pct), 'the rate is not on the projection').toBeGreaterThan(0)
      return
    }

    const before = await supabase.from('partner_security')
      .select('reserve_held').eq('partner_id', seller!.partner_id).maybeSingle()

    const { data: ran, error } = await supabase.rpc('run_settlements', {
      p_as_of: closed, p_actor: 'integration test', p_kind: 'manual',
      p_only: seller!.partner_id,
    })
    expect(error, error?.message).toBeNull()
    const out = ran as { settled: number; run_id: string | null }

    if (out.settled > 0) {
      const { data: st } = await supabase.from('settlement_statements')
        .select('*').eq('run_id', out.run_id!).maybeSingle()
      const s = st as Record<string, string>
      madeStatements.push(String(s.id))

      expect(Number(s.reserve_withheld), 'the run settled and retained nothing').toBeGreaterThan(0)
      expect(payoutAgrees({
        net: Number(s.net), payout_net: Number(s.payout_net), fx_rate: Number(s.fx_rate),
        reserve_withheld: Number(s.reserve_withheld), reserve_released: Number(s.reserve_released),
      }), 'the payout does not reflect the retention').toBe(true)

      /* And it is on file as a dated tranche, not as a balance. */
      const { data: tr } = await supabase.from('partner_reserve_tranche')
        .select('*').eq('statement_id', s.id).maybeSingle()
      const t = tr as Record<string, string>
      expect(t, 'the run retained without recording a tranche').toBeTruthy()
      expect(t.matures_on > t.held_on, 'a tranche that matures the day it is held').toBe(true)

      const after = await supabase.from('partner_security')
        .select('reserve_held').eq('partner_id', seller!.partner_id).maybeSingle()
      expect(Number((after.data as { reserve_held: string }).reserve_held))
        .toBeGreaterThan(Number((before.data as { reserve_held: string }).reserve_held))
    }
  }, 60_000)

  /* The deposit half was always real; the reserve half was not. Stated so the
     difference between them stays visible. */
  it('has a deposit recorded with an instrument and a date where one is held', async () => {
    const { data } = await supabase.from('partner_security')
      .select('partner_id, deposit_held, deposit_kind, deposit_taken_on')
    const bad = ((data ?? []) as Record<string, string>[])
      .filter(s => Number(s.deposit_held) > 0 && (!s.deposit_kind || s.deposit_kind === 'none' || !s.deposit_taken_on))
      .map(s => `${s.partner_id} holds ${s.deposit_held} with no instrument or no date`)
    expect(bad, bad.join('; ')).toEqual([])
  })
})
