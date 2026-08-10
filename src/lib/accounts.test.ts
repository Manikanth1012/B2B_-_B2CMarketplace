import { describe, it, expect } from 'vitest'
import {
  stepsOf, progressOf, isLate, whereTheyAre, rollup, matches, deskOrder, shopperLine,
} from './accounts'
import type { Account, Step, StepState } from './accounts'

const step = (over: Partial<Step> = {}): Step => ({
  id: 'BO-2007-1', account_id: 'ENT-2007', name: 'Company verification',
  detail: 'Verified against the company register.', state: 'done', gate_id: 'verify',
  done_on: '2025-07-28', done_by: 'Lena Fischer', due_on: null, sort_order: 1, ...over,
})

/* Gates, and no diary entry unless a test asks for one — `progressOf` counts
   only what has a gate behind it. */
const ladder = (states: StepState[], account = 'ENT-2007'): Step[] =>
  states.map((state, i) => step({
    id: `BO-${account}-${i + 1}`, account_id: account, sort_order: i + 1, state,
    name: `Step ${i + 1}`, gate_id: `gate-${i + 1}`,
    done_on: state === 'done' ? '2025-08-01' : null,
    due_on: state === 'done' ? null : '2026-09-01',
  }))

const acct = (over: Partial<Account> = {}): Account => ({
  id: 'ENT-2007', company: 'SmartBuild Ltd', market: 'IN', segment: 'mid',
  status: 'active', terms: 'Net 30', currency: 'INR', ...over,
})

describe('where a company has got to', () => {
  it('gives one account its own steps, in order', () => {
    const all = [
      step({ id: 'a', account_id: 'ENT-1', sort_order: 3 }),
      step({ id: 'b', account_id: 'ENT-2', sort_order: 1 }),
      step({ id: 'c', account_id: 'ENT-1', sort_order: 1 }),
    ]
    expect(stepsOf(all, 'ENT-1').map(s => s.id)).toEqual(['c', 'a'])
  })

  it('counts what is done and names what is next', () => {
    const p = progressOf(ladder(['done', 'done', 'due', 'due']))
    expect(p).toMatchObject({ done: 2, of: 4, overdue: 0, complete: false })
    expect(p.next?.name).toBe('Step 3')
  })

  /* A step past its date has a better claim on somebody's attention than one
     that is merely next. */
  it('puts an overdue step in front of the one that is merely next', () => {
    const p = progressOf(ladder(['done', 'due', 'overdue']))
    expect(p.next?.name).toBe('Step 3')
    expect(p.overdue).toBe(1)
  })

  it('counts a waived step as settled — somebody decided it, which is the point', () => {
    const p = progressOf(ladder(['done', 'waived']))
    expect(p).toMatchObject({ done: 2, complete: true })
    expect(p.next).toBeNull()
  })

  it('is not complete with nothing on file', () => {
    expect(progressOf([])).toMatchObject({ done: 0, of: 0, complete: false, next: null })
  })
})

/* The stored state is what somebody last wrote; the date is what is true. */
describe('whether a step has run late', () => {
  it('is late when its date has passed, whatever the row says', () => {
    expect(isLate(step({ state: 'due', due_on: '2026-01-01' }), '2026-08-10')).toBe(true)
  })

  it('is not late before its date', () => {
    expect(isLate(step({ state: 'due', due_on: '2026-12-01' }), '2026-08-10')).toBe(false)
  })

  it('is never late once it is done or waived', () => {
    expect(isLate(step({ state: 'done', due_on: '2020-01-01' }), '2026-08-10')).toBe(false)
    expect(isLate(step({ state: 'waived', due_on: '2020-01-01' }), '2026-08-10')).toBe(false)
  })

  it('is not late with no date at all — nobody agreed one', () => {
    expect(isLate(step({ state: 'due', due_on: null }), '2026-08-10')).toBe(false)
  })
})

describe('the sentence on the row', () => {
  it('says onboarded when everything is settled', () => {
    expect(whereTheyAre(progressOf(ladder(['done', 'done'])), '2026-08-10')).toBe('Onboarded')
  })

  /* Five of six accounts had exactly this and the screen would have shown
     blank rows, which reads as broken rather than as missing. */
  it('says so plainly when there is no record at all', () => {
    expect(whereTheyAre(progressOf([]), '2026-08-10')).toBe('No onboarding record at all')
  })

  it('names the next step and its date', () => {
    expect(whereTheyAre(progressOf(ladder(['done', 'due'])), '2026-08-10'))
      .toBe('Step 2 by 2026-09-01')
  })

  it('says overdue rather than a date that has been and gone', () => {
    const p = progressOf([step({ state: 'due', due_on: '2026-01-01', name: 'Mandate', sort_order: 1 })])
    expect(whereTheyAre(p, '2026-08-10')).toBe('Mandate — overdue')
  })
})

describe('what the desk is looking at', () => {
  const steps = [
    ...ladder(['done', 'done'], 'ENT-A'),
    ...ladder(['done', 'due'], 'ENT-B'),
    ...ladder(['done', 'overdue'], 'ENT-C'),
  ]
  const accounts = [
    acct({ id: 'ENT-A', company: 'Alpha' }),
    acct({ id: 'ENT-B', company: 'Bravo' }),
    acct({ id: 'ENT-C', company: 'Charlie' }),
  ]

  it('counts them apart', () => {
    expect(rollup({ accounts, steps, waiting: 2, today: '2026-08-10' }))
      .toEqual({ accounts: 3, onboarded: 1, inFlight: 2, overdue: 1, waiting: 2 })
  })

  /* An application is not an account. Counting them together would tell the
     desk it has more customers than it has. */
  it('does not count applications as accounts', () => {
    const r = rollup({ accounts, steps, waiting: 5, today: '2026-08-10' })
    expect(r.accounts).toBe(3)
    expect(r.waiting).toBe(5)
  })

  it('puts the overdue first, then the unfinished, then the rest', () => {
    expect(deskOrder(accounts, steps, '2026-08-10').map(a => a.company))
      .toEqual(['Charlie', 'Bravo', 'Alpha'])
  })

  it('treats a date that has passed as overdue when ordering, not only the label', () => {
    const late = [...ladder(['done', 'due'], 'ENT-A')]
    late[1].due_on = '2026-01-01'
    const order = deskOrder(accounts, [...late, ...steps.filter(s => s.account_id !== 'ENT-A')], '2026-08-10')
    expect(order[0].company).toBe('Alpha')
  })
})

describe('finding one', () => {
  const a = acct({ company: 'Harbourpoint Retail', industry: 'Retail', market: 'KE' })
  it('matches on anything a person would type', () => {
    for (const q of ['harbour', 'ENT-2007', 'ke', 'retail', 'MID']) {
      expect(matches(a, q), q).toBe(true)
    }
  })
  it('matches everything on an empty search', () => {
    expect(matches(a, '   ')).toBe(true)
  })
  it('does not match what is not there', () => {
    expect(matches(a, 'zzz')).toBe(false)
  })
})

describe('a retail customer as a row', () => {
  const s = { user_id: 'u1', name: 'Priya Raman', email: null, market: 'IN', currency: 'INR', tier: 'Gold', points: 628, joined: '2024-02-01' }
  it('says where they are and what they are worth', () => {
    expect(shopperLine(s)).toBe('IN · Gold member')
  })
  it('says so when there is nothing to say', () => {
    expect(shopperLine({ ...s, market: null, tier: null })).toBe('No market recorded')
  })
})

/* The annual credit review is a diary entry, not a gate. Counting it made
   every account on the book read as part-way through for ever, because a
   yearly review is never finished by design — the first screen to count them
   reported "0 of 6 fully onboarded" for a book where all six had passed every
   real gate. */
describe('the step that is not a gate', () => {
  const withReview = (reviewState: StepState, due: string | null) => [
    ...ladder(['done', 'done', 'done', 'done', 'done']),
    step({ id: 'BO-6', sort_order: 6, gate_id: null, name: 'Annual credit review',
           state: reviewState, done_on: null, due_on: due }),
  ]

  it('does not count towards how many steps there are', () => {
    const p = progressOf(withReview('due', '2027-04-05'))
    expect(p).toMatchObject({ done: 5, of: 5, complete: true })
    expect(p.review?.name).toBe('Annual credit review')
  })

  it('lets an account be onboarded with a review still pending', () => {
    expect(whereTheyAre(progressOf(withReview('due', '2027-04-05')), '2026-08-10'))
      .toBe('Onboarded')
  })

  /* Both are true and the second is the one somebody has to act on. */
  it('says onboarded and overdue where the review has come round again', () => {
    expect(whereTheyAre(progressOf(withReview('overdue', '2026-07-06')), '2026-08-10'))
      .toBe('Onboarded · credit review overdue')
  })

  it('counts a lapsed review as work for the desk', () => {
    const accounts = [acct({ id: 'ENT-2007', company: 'SmartBuild Ltd' })]
    const r = rollup({ accounts, steps: withReview('overdue', '2026-07-06'), waiting: 0, today: '2026-08-10' })
    expect(r).toMatchObject({ onboarded: 1, inFlight: 0, overdue: 1 })
  })

  it('puts an account with a lapsed review in front of a settled one', () => {
    const lapsed = withReview('overdue', '2026-07-06').map(s => ({ ...s, account_id: 'ENT-B' }))
    const settled = withReview('due', '2027-04-05').map(s => ({ ...s, account_id: 'ENT-A' }))
    const accounts = [acct({ id: 'ENT-A', company: 'Alpha' }), acct({ id: 'ENT-B', company: 'Bravo' })]
    expect(deskOrder(accounts, [...settled, ...lapsed], '2026-08-10').map(a => a.company))
      .toEqual(['Bravo', 'Alpha'])
  })
})
