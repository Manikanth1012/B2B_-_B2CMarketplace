import { describe, it, expect } from 'vitest'
import {
  type Ladder, type Step, type Case,
  stepsOn, ladderFor, defaultFor, casesOn,
  canAddStep, validateLadder, canDeleteLadder, warningsFor,
  nextStep, currentStep, dueIn, caseState, suspendsOn, tierLabel,
} from './dunning'

/* The fixtures are the seeded ladders, because a test that passes against a
   shape the database does not hold is a test about nothing. */

const ladder = (over: Partial<Ladder> & { id: string }): Ladder => ({
  name: 'Retail — standard', audience: 'consumer', tier: null,
  grace_days: 3, suspend_on_day: 14, withhold_settlement: false, pause_on_promise: true,
  note: '', system: false, updated_by: null, updated_on: null, sort_order: 1, ...over,
})

const CON = ladder({ id: 'DL-CON', system: true })
const CON_GOLD = ladder({ id: 'DL-CON-GOLD', name: 'Retail — Gold', tier: 'gold', grace_days: 5, suspend_on_day: 21, sort_order: 2 })
const CON_PLAT = ladder({ id: 'DL-CON-PLAT', name: 'Retail — Platinum', tier: 'platinum', grace_days: 7, suspend_on_day: 30, sort_order: 3 })
const ENT = ladder({ id: 'DL-ENT', name: 'Business — standard', audience: 'enterprise', grace_days: 5, suspend_on_day: 60, system: true, sort_order: 4 })
const ENT_STRAT = ladder({ id: 'DL-ENT-STRAT', name: 'Business — Strategic', audience: 'enterprise', tier: 'org-platinum', grace_days: 10, suspend_on_day: null, sort_order: 5 })
const PTR = ladder({ id: 'DL-PTR', name: 'Seller — standard', audience: 'partner', grace_days: 0, suspend_on_day: null, withhold_settlement: true, system: true, sort_order: 6 })
const PTR_PLAT = ladder({ id: 'DL-PTR-PLAT', name: 'Seller — Platinum', audience: 'partner', tier: 'platinum', grace_days: 14, suspend_on_day: null, withhold_settlement: true, sort_order: 7 })

const LADDERS = [CON, CON_GOLD, CON_PLAT, ENT, ENT_STRAT, PTR, PTR_PLAT]

const step = (over: Partial<Step> & { id: string; ladder_id: string; step_no: number }): Step => ({
  name: 'Step', day: 5, channel: 'email', action: 'remind', note: '', ...over,
})

const CON_STEPS: Step[] = [
  step({ id: 'a', ladder_id: 'DL-CON', step_no: 1, name: 'Soft retry', day: 3, channel: 'automatic', action: 'retry' }),
  step({ id: 'b', ladder_id: 'DL-CON', step_no: 2, name: 'Soft reminder', day: 5, channel: 'sms', action: 'remind' }),
  step({ id: 'c', ladder_id: 'DL-CON', step_no: 3, name: 'Second reminder', day: 8, channel: 'email', action: 'remind' }),
  step({ id: 'd', ladder_id: 'DL-CON', step_no: 4, name: 'Third reminder', day: 11, channel: 'in-app', action: 'warn' }),
  step({ id: 'e', ladder_id: 'DL-CON', step_no: 5, name: 'Final notice', day: 13, channel: 'sms', action: 'final' }),
  step({ id: 'f', ladder_id: 'DL-CON', step_no: 6, name: 'Suspend', day: 14, channel: 'automatic', action: 'suspend' }),
  step({ id: 'g', ladder_id: 'DL-CON', step_no: 7, name: 'Refer', day: 45, channel: 'letter', action: 'refer' }),
]

const PTR_STEPS: Step[] = [
  step({ id: 'p1', ladder_id: 'DL-PTR', step_no: 1, name: 'Debt notice', day: 1, action: 'remind' }),
  step({ id: 'p2', ladder_id: 'DL-PTR', step_no: 2, name: 'Commission recovery', day: 7, channel: 'settlement', action: 'withhold' }),
]

const STEPS = [...CON_STEPS, ...PTR_STEPS]

const dcase = (over: Partial<Case> & { id: string }): Case => ({
  account_name: 'Priya Raman', account_type: 'consumer', tier: 'gold',
  amount: 42, age_days: 18, step: 6, step_name: 'Suspend', ladder_id: 'DL-CON',
  attempts: 4, reason: 'Card expired', collector: null, promise_to_pay: null,
  status: 'active', sort_order: 1, ...over,
})

describe('which ladder an account runs on', () => {
  it('gives each audience its default', () => {
    expect(ladderFor({ audience: 'consumer' }, LADDERS)?.id).toBe('DL-CON')
    expect(ladderFor({ audience: 'enterprise' }, LADDERS)?.id).toBe('DL-ENT')
    expect(ladderFor({ audience: 'partner' }, LADDERS)?.id).toBe('DL-PTR')
  })

  /* The whole reason tiers are here: a Platinum customer of six years and a
     Bronze account three weeks old are not the same collections problem. */
  it('lets a tier override the default', () => {
    expect(ladderFor({ audience: 'consumer', tier: 'gold' }, LADDERS)?.id).toBe('DL-CON-GOLD')
    expect(ladderFor({ audience: 'consumer', tier: 'platinum' }, LADDERS)?.id).toBe('DL-CON-PLAT')
    expect(ladderFor({ audience: 'enterprise', tier: 'org-platinum' }, LADDERS)?.id).toBe('DL-ENT-STRAT')
  })

  it('falls back for a tier with no ladder of its own', () => {
    expect(ladderFor({ audience: 'consumer', tier: 'bronze' }, LADDERS)?.id).toBe('DL-CON')
    expect(ladderFor({ audience: 'enterprise', tier: 'org-silver' }, LADDERS)?.id).toBe('DL-ENT')
  })

  it('does not apply one audience’s tier ladder to another', () => {
    expect(ladderFor({ audience: 'partner', tier: 'gold' }, LADDERS)?.id).toBe('DL-PTR')
  })

  it('returns null rather than guessing when an audience has none', () => {
    expect(ladderFor({ audience: 'consumer' }, [ENT, PTR])).toBeNull()
  })

  it('finds the default a tier ladder overrides', () => {
    expect(defaultFor('consumer', LADDERS)?.id).toBe('DL-CON')
    expect(defaultFor('partner', LADDERS)?.id).toBe('DL-PTR')
  })

  it('lists a ladder’s steps in order', () => {
    expect(stepsOn('DL-CON', STEPS).map(s => s.step_no)).toEqual([1, 2, 3, 4, 5, 6, 7])
    expect(stepsOn('DL-PTR', STEPS)).toHaveLength(2)
    expect(stepsOn('DL-NOPE', STEPS)).toEqual([])
  })
})

describe('what a ladder may not be made into', () => {
  /* The one rule whose violation reaches somebody who is not a party to the
     debt: a buyer who is mid-order with that seller. */
  it('refuses to suspend a seller, and says who it would hurt', () => {
    const check = canAddStep({ action: 'suspend', day: 30 }, PTR)
    expect(check.ok).toBe(false)
    if (!check.ok) expect(check.reason).toMatch(/strands buyers who are mid-order/)
  })

  it('refuses a suspension step on a ladder that says it never suspends', () => {
    const check = canAddStep({ action: 'suspend', day: 90 }, ENT_STRAT)
    expect(check.ok).toBe(false)
    if (!check.ok) expect(check.reason).toMatch(/says it never suspends/)
  })

  it('refuses a step inside the grace the ladder promises', () => {
    const check = canAddStep({ action: 'remind', day: 2 }, CON)
    expect(check.ok).toBe(false)
    if (!check.ok) expect(check.reason).toMatch(/Grace that gets chased inside is not grace/)
  })

  it('allows a step exactly on the grace boundary', () => {
    expect(canAddStep({ action: 'remind', day: 3 }, CON).ok).toBe(true)
  })

  it('refuses a step before the bill is due', () => {
    expect(canAddStep({ action: 'remind', day: -1 }, PTR).ok).toBe(false)
  })

  it('refuses to withhold a settlement from somebody who has none', () => {
    const check = canAddStep({ action: 'withhold', day: 10 }, CON)
    expect(check.ok).toBe(false)
    if (!check.ok) expect(check.reason).toMatch(/no settlement to withhold/)
  })

  it('allows every seeded retail step on its own ladder', () => {
    for (const s of CON_STEPS) expect(canAddStep(s, CON).ok, s.name).toBe(true)
  })

  it('allows every seeded seller step on its own ladder', () => {
    for (const s of PTR_STEPS) expect(canAddStep(s, PTR).ok, s.name).toBe(true)
  })
})

describe('whether the ladder itself holds together', () => {
  it('accepts every seeded ladder', () => {
    for (const l of LADDERS) expect(validateLadder(l, LADDERS).ok, l.name).toBe(true)
  })

  it('refuses a ladder with no name', () => {
    expect(validateLadder({ ...CON, name: '  ' }, LADDERS).ok).toBe(false)
  })

  it('refuses negative grace', () => {
    const check = validateLadder({ ...CON, grace_days: -1 }, LADDERS)
    expect(check.ok).toBe(false)
    if (!check.ok) expect(check.reason).toMatch(/before the bill was due/)
  })

  it('refuses a suspension day on a seller ladder', () => {
    const check = validateLadder({ ...PTR, suspend_on_day: 30 }, LADDERS)
    expect(check.ok).toBe(false)
    if (!check.ok) expect(check.reason).toMatch(/withheld instead/)
  })

  it('refuses a cut-off inside the grace the same ladder promises', () => {
    const check = validateLadder({ ...CON, grace_days: 20, suspend_on_day: 14 }, LADDERS)
    expect(check.ok).toBe(false)
    if (!check.ok) expect(check.reason).toMatch(/inside the 20 days of grace/)
  })

  /* A tier that is chased harder than the default is a tier meaning the
     opposite of what it says, and it is one mistyped number away. */
  it('refuses a tier ladder with less grace than its own default', () => {
    const check = validateLadder({ ...CON_GOLD, grace_days: 1 }, LADDERS)
    expect(check.ok).toBe(false)
    if (!check.ok) expect(check.reason).toMatch(/the opposite of what it says/)
  })

  it('refuses a tier ladder that suspends sooner than its own default', () => {
    const check = validateLadder({ ...CON_GOLD, suspend_on_day: 10 }, LADDERS)
    expect(check.ok).toBe(false)
    if (!check.ok) expect(check.reason).toMatch(/cannot suspend sooner/)
  })

  it('allows a tier ladder that never suspends where the default does', () => {
    expect(validateLadder({ ...CON_GOLD, suspend_on_day: null }, LADDERS).ok).toBe(true)
  })

  it('says whether anything on it interrupts service', () => {
    const soft = validateLadder(ENT_STRAT, LADDERS)
    expect(soft.ok).toBe(true)
    if (soft.ok) expect(soft.note).toMatch(/Nothing on this ladder interrupts service/)
    const hard = validateLadder(CON, LADDERS)
    if (hard.ok) expect(hard.note).toMatch(/Service stops on day 14/)
  })
})

describe('whether a ladder can go', () => {
  const CASES = [dcase({ id: 'dc-001', ladder_id: 'DL-CON-GOLD' })]

  it('refuses to delete one that ships with the marketplace', () => {
    const check = canDeleteLadder(CON, [])
    expect(check.ok).toBe(false)
    if (!check.ok) expect(check.reason).toMatch(/edited but not deleted/)
  })

  it('refuses to delete an audience default, whoever wrote it', () => {
    const check = canDeleteLadder({ ...CON_GOLD, tier: null, system: false }, [])
    expect(check.ok).toBe(false)
    if (!check.ok) expect(check.reason).toMatch(/nobody chases and nobody warns/)
  })

  it('refuses to delete one somebody is being chased on, and names them', () => {
    const check = canDeleteLadder(CON_GOLD, CASES)
    expect(check.ok).toBe(false)
    if (!check.ok) expect(check.reason).toMatch(/Priya Raman/)
  })

  it('allows an unused tier ladder, and says what falls back', () => {
    const check = canDeleteLadder(CON_PLAT, CASES)
    expect(check.ok).toBe(true)
    if (check.ok) expect(check.note).toMatch(/fall back to the audience default/)
  })

  it('lists who is on a ladder', () => {
    expect(casesOn('DL-CON-GOLD', CASES).map(c => c.account_name)).toEqual(['Priya Raman'])
    expect(casesOn('DL-CON', CASES)).toEqual([])
  })
})

describe('what is odd but allowed', () => {
  const text = (l: Ladder, s: Step[]) => warningsFor(l, s).map(w => w.text).join(' | ')

  it('says nothing about the seeded retail ladder', () => {
    expect(warningsFor(CON, CON_STEPS).filter(w => w.level === 'warn')).toEqual([])
  })

  it('says nothing about the seeded seller ladder', () => {
    expect(warningsFor(PTR, PTR_STEPS).filter(w => w.level === 'warn')).toEqual([])
  })

  it('flags a ladder with no steps as a ladder nobody is chased on', () => {
    expect(text(CON, [])).toMatch(/nothing happens on it/)
  })

  it('flags a promised cut-off that no step carries out', () => {
    expect(text(CON, CON_STEPS.filter(s => s.action !== 'suspend'))).toMatch(/no step does it/)
  })

  it('flags a cut-off with no final notice before it', () => {
    expect(text(CON, CON_STEPS.filter(s => s.action !== 'final'))).toMatch(/Fair warning before a cut-off/)
  })

  it('flags a ladder that is nothing but email', () => {
    const allMail = CON_STEPS.map(s => ({ ...s, channel: 'email' as const }))
    expect(text(CON, allMail)).toMatch(/one undelivered address|One undelivered address/)
  })

  it('flags a seller ladder that recovers nothing', () => {
    expect(text(PTR, PTR_STEPS.filter(s => s.action !== 'withhold'))).toMatch(/nothing on it recovers the money/)
  })

  it('flags a first contact that goes out the day after the bill', () => {
    const eager = [step({ id: 'x', ladder_id: 'DL-CON', step_no: 1, day: 1, channel: 'sms', action: 'remind' })]
    expect(text({ ...CON, grace_days: 0 }, eager)).toMatch(/reads as a mistake/)
  })

  it('grades the missing cut-off as a warning and the email-only ladder as information', () => {
    const w = warningsFor(CON, CON_STEPS.filter(s => s.action !== 'suspend'))
    expect(w.find(x => /no step does it/.test(x.text))?.level).toBe('warn')
    const i = warningsFor(CON, CON_STEPS.map(s => ({ ...s, channel: 'email' as const })))
    expect(i.find(x => /undelivered address/i.test(x.text))?.level).toBe('info')
  })
})

describe('where a case actually is', () => {
  it('names the step it is on and the one after it', () => {
    const c = dcase({ id: 'x', step: 3 })
    expect(currentStep(c, STEPS)?.name).toBe('Second reminder')
    expect(nextStep(c, STEPS)?.name).toBe('Third reminder')
  })

  it('has no next step at the end of the ladder', () => {
    expect(nextStep(dcase({ id: 'x', step: 7 }), STEPS)).toBeNull()
  })

  it('counts the days to the next step', () => {
    expect(dueIn(dcase({ id: 'x', step: 3, age_days: 8 }), STEPS, CON)).toBe(3)
  })

  it('reports a step that should already have fired as overdue', () => {
    expect(caseState(dcase({ id: 'x', step: 3, age_days: 20 }), STEPS, CON))
      .toMatch(/9 days overdue for the next step/)
  })

  /* Pausing means pausing. Resuming from the start would punish somebody for
     having negotiated, which is the opposite of what a promise is for. */
  it('pauses on a promise to pay rather than restarting', () => {
    const c = dcase({ id: 'x', step: 3, promise_to_pay: '2026-08-05' })
    expect(dueIn(c, STEPS, CON)).toBeNull()
    expect(caseState(c, STEPS, CON)).toBe('paused on a promise to pay')
  })

  it('does not pause a ladder that does not pause', () => {
    const c = dcase({ id: 'x', step: 3, age_days: 8, promise_to_pay: '2026-08-05' })
    expect(dueIn(c, STEPS, { ...CON, pause_on_promise: false })).toBe(3)
  })

  it('reports a closed case by its status rather than by its ladder', () => {
    expect(caseState(dcase({ id: 'x', status: 'settled' }), STEPS, CON)).toBe('settled')
  })

  it('counts the days to a cut-off, and says never when there is none', () => {
    expect(suspendsOn(dcase({ id: 'x', age_days: 10 }), CON)).toBe(4)
    expect(suspendsOn(dcase({ id: 'x', age_days: 10 }), PTR)).toBeNull()
    expect(suspendsOn(dcase({ id: 'x', age_days: 10 }), ENT_STRAT)).toBeNull()
  })
})

describe('the tier vocabulary', () => {
  it('reads a business tier by the name the buyer knows it by', () => {
    expect(tierLabel('enterprise', 'org-platinum')).toBe('Strategic')
    expect(tierLabel('enterprise', 'org-silver')).toBe('Business')
  })

  it('reads a retail tier plainly', () => {
    expect(tierLabel('consumer', 'gold')).toBe('Gold')
  })

  it('says who the default is for', () => {
    expect(tierLabel('consumer', null)).toBe('Every account')
  })

  it('falls back to the raw value rather than dropping it', () => {
    expect(tierLabel('consumer', 'titanium')).toBe('titanium')
  })
})
