/* Touches the live Supabase project.
 *
 * The claim worth checking against a real database: a seller cannot be
 * suspended, whatever the screen offers. That rule protects somebody who is
 * not a party to the debt — a buyer who is mid-order with that seller — so it
 * is enforced by `guard_dunning()` rather than by a form, and this is what
 * proves the guard exists.
 *
 * Also: the ladder a case runs on is resolved from the account rather than
 * chosen, every audience has a default, and no tier is chased harder than the
 * default it overrides.
 *
 * Everything written here is undone in the same file.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { supabase } from './supabase'
import { signIn, signOut } from './authRepo'
import { loadDunning, saveLadder, saveStep, deleteLadder, deleteStep, moveStep } from './dunningRepo'
import type { DunningBook } from './dunningRepo'
import {
  ladderFor, stepsOn, defaultFor, canAddStep, canDeleteLadder, validateLadder, warningsFor,
} from './dunning'
import type { Ladder } from './dunning'

const OPERATOR = { email: 'anika.sharma@aventa.com', password: 'operator123' }
const CONSUMER = { email: 'priya.raman@example.com', password: 'demo1234' }

let book: DunningBook
const made: string[] = []

describe('the seeded ladders', () => {
  beforeAll(async () => {
    await signIn(OPERATOR.email, OPERATOR.password)
    book = await loadDunning()
    expect(book.loadError, book.loadError).toBeUndefined()
  })

  it('gives every audience a default, so nobody is in arrears unchased', () => {
    for (const a of ['consumer', 'enterprise', 'partner'] as const) {
      expect(defaultFor(a, book.ladders), a).not.toBeNull()
    }
  })

  it('never suspends a seller, on any ladder', () => {
    const seller = book.ladders.filter(l => l.audience === 'partner')
    expect(seller.length).toBeGreaterThan(0)
    for (const l of seller) {
      expect(l.suspend_on_day, l.name).toBeNull()
      expect(stepsOn(l.id, book.steps).map(s => s.action), l.name).not.toContain('suspend')
    }
  })

  it('recovers a seller debt by withholding rather than by cutting them off', () => {
    for (const l of book.ladders.filter(x => x.audience === 'partner')) {
      expect(stepsOn(l.id, book.steps).map(s => s.action), l.name).toContain('withhold')
    }
  })

  it('gives every tier ladder more room than the default it overrides', () => {
    for (const l of book.ladders.filter(x => x.tier !== null)) {
      const base = defaultFor(l.audience, book.ladders)!
      expect(l.grace_days, `${l.name} grace`).toBeGreaterThanOrEqual(base.grace_days)
      if (l.suspend_on_day !== null && base.suspend_on_day !== null) {
        expect(l.suspend_on_day, `${l.name} cut-off`).toBeGreaterThanOrEqual(base.suspend_on_day)
      }
    }
  })

  it('fires its steps in order, and none inside its own grace', () => {
    for (const l of book.ladders) {
      const mine = stepsOn(l.id, book.steps)
      for (let i = 1; i < mine.length; i++) {
        expect(mine[i].day, `${l.name}: step ${mine[i].step_no} fires before the one before it`)
          .toBeGreaterThanOrEqual(mine[i - 1].day)
      }
      for (const s of mine) {
        expect(s.day, `${l.name} — ${s.name} fires inside its own grace`).toBeGreaterThanOrEqual(l.grace_days)
      }
    }
  })

  it('carries out every cut-off it promises, on the day it promises it', () => {
    for (const l of book.ladders.filter(x => x.suspend_on_day !== null)) {
      const suspend = stepsOn(l.id, book.steps).find(s => s.action === 'suspend')
      expect(suspend, `${l.name} promises a cut-off no step carries out`).toBeTruthy()
      expect(suspend!.day, l.name).toBe(l.suspend_on_day)
    }
  })

  it('warns a customer before it cuts them off', () => {
    for (const l of book.ladders.filter(x => x.suspend_on_day !== null)) {
      expect(stepsOn(l.id, book.steps).map(s => s.action), `${l.name} has no final notice`).toContain('final')
    }
  })

  it('says nothing is odd about any of them', () => {
    for (const l of book.ladders) {
      const serious = warningsFor(l, book.steps).filter(w => w.level === 'warn')
      expect(serious.map(w => w.text), `${l.name}: ${serious.map(w => w.text).join(' | ')}`).toEqual([])
    }
  })

  it('treats a business account far more slowly than a retail one', () => {
    const con = defaultFor('consumer', book.ladders)!
    const ent = defaultFor('enterprise', book.ladders)!
    expect(ent.suspend_on_day!).toBeGreaterThan(con.suspend_on_day! * 3)
  })
})

describe('which ladder a case is actually on', () => {
  it('resolves every case from its own account, not from a collector’s choice', () => {
    for (const c of book.cases) {
      const wanted = ladderFor({ audience: c.account_type as 'consumer', tier: c.tier }, book.ladders)
      expect(wanted, `${c.account_name} resolves to no ladder`).not.toBeNull()
      expect(c.ladder_id, `${c.account_name} is on the wrong ladder`).toBe(wanted!.id)
    }
  })

  it('puts the gold retail customer on the gold ladder, not the standard one', () => {
    const priya = book.cases.find(c => c.account_name === 'Priya Raman')
    expect(priya, 'the demo retail case is gone').toBeTruthy()
    expect(priya!.tier).toBe('gold')
    expect(book.ladders.find(l => l.id === priya!.ladder_id)?.tier).toBe('gold')
  })

  it('speaks one vocabulary — partner, not seller', () => {
    expect(book.cases.map(c => c.account_type)).not.toContain('seller')
    expect(book.cases.some(c => c.account_type === 'partner')).toBe(true)
  })

  it('never leaves a case on a ladder written for another audience', () => {
    for (const c of book.cases) {
      const l = book.ladders.find(x => x.id === c.ladder_id)!
      expect(l.audience, c.account_name).toBe(c.account_type)
    }
  })
})

describe('what the database refuses', () => {
  let mine: Ladder | null = null

  it('creates a ladder through the repo', async () => {
    const res = await saveLadder({
      id: null, actor: 'Integration suite', ladders: book.ladders,
      draft: {
        name: 'Integration test ladder', audience: 'consumer', tier: 'silver',
        grace_days: 4, suspend_on_day: 18, withhold_settlement: false,
        pause_on_promise: true, note: 'Written by the integration suite.',
      },
    })
    expect(res.ok, (res as { reason?: string }).reason).toBe(true)
    made.push(res.id!)

    book = await loadDunning()
    mine = book.ladders.find(l => l.id === res.id) ?? null
    expect(mine).not.toBeNull()
  })

  /* The module refuses this before it reaches the wire; the next test proves
     the database refuses it too, for anybody who reaches it another way. */
  it('will not let the module write a tier ladder harsher than its default', () => {
    const check = validateLadder(
      { name: 'x', audience: 'consumer', tier: 'silver', grace_days: 1, suspend_on_day: 18 },
      book.ladders)
    expect(check.ok).toBe(false)
    if (!check.ok) expect(check.reason).toMatch(/the opposite of what it says/)
  })

  it('refuses a suspension step on a seller ladder, in the database', async () => {
    const seller = book.ladders.find(l => l.audience === 'partner' && l.tier === null)!
    const { error } = await supabase.from('dunning_steps').insert({
      id: `DS-TEST-${Date.now()}`, ladder_id: seller.id, step_no: 99,
      name: 'Suspend', day: 30, channel: 'automatic', action: 'suspend', note: '',
    })
    expect(error, 'a seller ladder accepted a suspension').not.toBeNull()
    expect(error!.message).toMatch(/never suspended/)

    const { data } = await supabase.from('dunning_steps')
      .select('id').eq('ladder_id', seller.id).eq('action', 'suspend')
    expect(data ?? []).toEqual([])
  })

  it('says the same thing the module says', () => {
    const seller = book.ladders.find(l => l.audience === 'partner')!
    const check = canAddStep({ action: 'suspend', day: 30 }, seller)
    expect(check.ok).toBe(false)
    if (!check.ok) expect(check.reason).toMatch(/strands buyers who are mid-order/)
  })

  it('refuses a cut-off inside the ladder’s own grace, in the database', async () => {
    const { error } = await supabase.from('dunning_ladders')
      .update({ grace_days: 20 }).eq('id', mine!.id)
    expect(error, 'a ladder accepted a cut-off inside its own grace').not.toBeNull()
    expect(error!.message).toMatch(/grace/)
  })

  it('refuses a suspension day on a seller ladder, in the database', async () => {
    const seller = book.ladders.find(l => l.audience === 'partner' && l.tier === null)!
    const { error } = await supabase.from('dunning_ladders')
      .update({ suspend_on_day: 30 }).eq('id', seller.id)
    expect(error).not.toBeNull()
    expect(error!.message).toMatch(/withheld instead/)
  })

  it('refuses to delete an audience default', async () => {
    const con = defaultFor('consumer', book.ladders)!
    const check = canDeleteLadder(con, book.cases)
    expect(check.ok).toBe(false)

    const res = await deleteLadder({ ladder: con, cases: book.cases, actor: 'Integration suite' })
    expect(res.ok).toBe(false)

    const { data } = await supabase.from('dunning_ladders').select('id').eq('id', con.id)
    expect(data?.length).toBe(1)
  })

  it('refuses to delete a ladder somebody is being chased on', async () => {
    const busy = book.ladders.find(l => book.cases.some(c => c.ladder_id === l.id && l.tier !== null))
    if (!busy) return
    const res = await deleteLadder({ ladder: busy, cases: book.cases, actor: 'Integration suite' })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.reason).toMatch(/being chased on/)
  })
})

describe('editing the steps of a ladder', () => {
  it('adds two steps, in order', async () => {
    const mine = book.ladders.find(l => l.id === made[0])!
    for (const [no, day, name] of [[1, 6, 'First reminder'], [2, 12, 'Second reminder']] as const) {
      const res = await saveStep({
        id: null, ladder: mine, stepNo: no, actor: 'Integration suite',
        draft: { name, day, channel: 'email', action: 'remind', note: '' },
      })
      expect(res.ok, (res as { reason?: string }).reason).toBe(true)
    }
    book = await loadDunning()
    expect(stepsOn(mine.id, book.steps).map(s => s.name)).toEqual(['First reminder', 'Second reminder'])
  })

  it('refuses a step inside the grace, through the repo', async () => {
    const mine = book.ladders.find(l => l.id === made[0])!
    const res = await saveStep({
      id: null, ladder: mine, stepNo: 3, actor: 'Integration suite',
      draft: { name: 'Too soon', day: 1, channel: 'sms', action: 'remind', note: '' },
    })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.reason).toMatch(/not grace/)
  })

  it('swaps two steps, days and all', async () => {
    const mine = book.ladders.find(l => l.id === made[0])!
    const first = stepsOn(mine.id, book.steps)[0]
    const res = await moveStep({ step: first, ladder: mine, steps: book.steps, delta: 1, actor: 'Integration suite' })
    expect(res.ok, (res as { reason?: string }).reason).toBe(true)

    book = await loadDunning()
    const after = stepsOn(mine.id, book.steps)
    expect(after.map(s => s.name)).toEqual(['Second reminder', 'First reminder'])
    /* And still ascending by day, or the ladder chases backwards. */
    expect(after[0].day).toBeLessThanOrEqual(after[1].day)
  })

  /* A case records which step it is on as a number, so a hole in the sequence
     is an account that quietly stops advancing. */
  it('closes the gap when a step is removed', async () => {
    const mine = book.ladders.find(l => l.id === made[0])!
    const steps = stepsOn(mine.id, book.steps)
    const res = await deleteStep({ step: steps[0], ladder: mine, steps: book.steps, actor: 'Integration suite' })
    expect(res.ok, (res as { reason?: string }).reason).toBe(true)

    book = await loadDunning()
    expect(stepsOn(mine.id, book.steps).map(s => s.step_no)).toEqual([1])
  })
})

describe('a customer looking at the rules they are being chased under', () => {
  afterAll(async () => { await signOut() })

  it('can read the ladders, because a bill banner tells them what happens next', async () => {
    await signOut()
    await signIn(CONSUMER.email, CONSUMER.password)
    const { data, error } = await supabase.from('dunning_ladders').select('id')
    expect(error, error?.message).toBeNull()
    expect((data ?? []).length).toBeGreaterThan(0)
  })

  it('cannot move themselves onto a gentler one', async () => {
    const { data } = await supabase.from('dunning_ladders')
      .update({ suspend_on_day: 365 }).eq('id', 'DL-CON').select('id')
    expect(data ?? []).toEqual([])

    await signOut()
    await signIn(OPERATOR.email, OPERATOR.password)
    const { data: still } = await supabase.from('dunning_ladders')
      .select('suspend_on_day').eq('id', 'DL-CON')
    expect(still?.[0]?.suspend_on_day).toBe(14)
  })
})

describe('tidying up', () => {
  afterAll(async () => { await signOut() })

  it('removes everything this file created', async () => {
    await signOut()
    await signIn(OPERATOR.email, OPERATOR.password)

    for (const id of made) {
      const { error } = await supabase.from('dunning_ladders').delete().eq('id', id)
      expect(error, `${id}: ${error?.message}`).toBeNull()
    }
    const { data } = await supabase.from('dunning_ladders').select('id').in('id', made)
    expect(data ?? []).toEqual([])

    /* The steps went with the ladder rather than being left pointing nowhere. */
    const { data: orphans } = await supabase.from('dunning_steps')
      .select('ladder_id').in('ladder_id', made)
    expect(orphans ?? []).toEqual([])

    const after = await loadDunning()
    expect(after.ladders.length).toBe(7)
  })
})
