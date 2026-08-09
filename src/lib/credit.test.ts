import { describe, it, expect } from 'vitest'
import {
  BAND_LABEL, BAND_TONE, BAND_MEANING, utilisation, isOver, pressure, PRESSURE_TONE,
  wouldBreach, positionLine, reserveOn, sellerCover, securityLine,
  reviewIn, reviewOverdue, reviewQueue, creditBook, creditProblems,
  reviewMonths, dueFrom, onCadence,
} from './credit'
import type { Position, Assessment, Security, CreditBand } from './credit'

const TODAY = '2026-08-08'

const pos = (over: Partial<Position> = {}): Position => ({
  account_id: 'ENT-2007',
  company: 'SmartBuild Ltd',
  currency: 'INR',
  credit_limit: 1000,
  deposit_held: 0,
  owed: 400,
  committed: 100,
  exposure: 500,
  headroom: 500,
  over_limit: false,
  band: 'low',
  next_review: '2027-08-08',
  ...over,
})

const ass = (over: Partial<Assessment> = {}): Assessment => ({
  id: 'CRA-2007-01',
  account_id: 'ENT-2007',
  partner_id: null,
  side: 'buyer',
  reviewed_on: '2026-08-08',
  reviewed_by: 'Ruben Oyelaran',
  evidence: 'Filed accounts and twelve months of invoices.',
  band: 'low',
  rationale: 'Pays inside terms.',
  currency: 'INR',
  limit_granted: 1000,
  deposit_required: null,
  reserve_pct: null,
  next_review: '2027-08-08',
  superseded_by: null,
  ...over,
})

const sec = (over: Partial<Security> = {}): Security => ({
  partner_id: 'PTR-1011',
  deposit_held: 0,
  deposit_kind: 'none',
  deposit_ref: null,
  deposit_taken_on: null,
  reserve_pct: 0,
  reserve_held: 0,
  currency: 'USD',
  why: 'Nothing in the record justifies it.',
  reviewed_on: '2026-08-08',
  ...over,
})

describe('the words on a band', () => {
  it('has a label, a tone and a consequence for each', () => {
    for (const b of ['low', 'medium', 'high', 'refused'] as CreditBand[]) {
      expect(BAND_LABEL[b], b).toBeTruthy()
      expect(BAND_TONE[b], b).toBeTruthy()
      expect(BAND_MEANING[b], b).toBeTruthy()
    }
  })

  /* The band is only useful if it says what happens, not what it is called. */
  it('says what each band actually does to a purchase', () => {
    expect(BAND_MEANING.high).toMatch(/Held at the limit/)
    expect(BAND_MEANING.refused).toMatch(/paid before it ships/)
  })
})

describe('how much of the limit is used', () => {
  it('reports a fraction', () => {
    expect(utilisation(pos({ exposure: 500, credit_limit: 1000 }))).toBe(0.5)
  })

  /* Capping at full would hide the only case anybody needs to see. */
  it('goes past one rather than stopping there', () => {
    expect(utilisation(pos({ exposure: 2439.75, credit_limit: 990 }))).toBeGreaterThan(2)
  })

  it('is infinite for exposure against no limit, which is the point', () => {
    expect(utilisation(pos({ exposure: 500, credit_limit: 0 }))).toBe(Infinity)
  })

  it('is zero for no limit and nothing owed', () => {
    expect(utilisation(pos({ exposure: 0, credit_limit: 0 }))).toBe(0)
  })

  it('knows when somebody is over', () => {
    expect(isOver(pos({ exposure: 1001, credit_limit: 1000 }))).toBe(true)
    expect(isOver(pos({ exposure: 1000, credit_limit: 1000 }))).toBe(false)
  })
})

describe('how close to the edge', () => {
  it('is clear well below the limit', () => {
    expect(pressure(pos({ exposure: 500, credit_limit: 1000 }))).toBe('clear')
  })

  it('is near from four fifths', () => {
    expect(pressure(pos({ exposure: 800, credit_limit: 1000 }))).toBe('near')
  })

  it('is at the limit exactly on it', () => {
    expect(pressure(pos({ exposure: 1000, credit_limit: 1000 }))).toBe('at')
  })

  it('is over past it', () => {
    expect(pressure(pos({ exposure: 1001, credit_limit: 1000 }))).toBe('over')
  })

  it('has a tone for every pressure', () => {
    for (const p of ['clear', 'near', 'at', 'over'] as const) {
      expect(PRESSURE_TONE[p], p).toBeTruthy()
    }
  })
})

describe('whether an order would breach', () => {
  /* The same arithmetic as the database trigger, so the approver is told before
     they approve rather than after. */
  it('passes an order that fits', () => {
    expect(wouldBreach(pos({ exposure: 500, credit_limit: 1000 }), 400).breach).toBe(false)
  })

  it('passes one that lands exactly on the limit', () => {
    expect(wouldBreach(pos({ exposure: 500, credit_limit: 1000 }), 500).breach).toBe(false)
  })

  it('catches one that goes a rupee past, and says by how much', () => {
    const r = wouldBreach(pos({ exposure: 500, credit_limit: 1000 }), 501)
    expect(r.breach).toBe(true)
    expect(r.breach && r.over).toBe(1)
  })

  it('counts what is already over as well as what the order adds', () => {
    const r = wouldBreach(pos({ exposure: 2439.75, credit_limit: 990 }), 100)
    expect(r.breach && r.over).toBe(1549.75)
  })

  /* An account with no limit is unassessed rather than unlimited, and this is
     not the function that should refuse them — `creditProblems` reports it. */
  it('does not breach against a limit that does not exist', () => {
    expect(wouldBreach(pos({ credit_limit: 0 }), 999999).breach).toBe(false)
  })
})

describe('the sentence on a position', () => {
  it('leads with being over, and says the next order is held', () => {
    const l = positionLine(pos({ exposure: 2439.75, credit_limit: 990, headroom: -1449.75 }))
    expect(l).toMatch(/over its limit by 1449.75 INR/)
    expect(l).toMatch(/next requisition is held/)
  })

  it('warns when a large order would take it past', () => {
    expect(positionLine(pos({ exposure: 850, credit_limit: 1000, headroom: 150 })))
      .toMatch(/a large order would take it past/)
  })

  it('is plain when there is room', () => {
    expect(positionLine(pos({ exposure: 200, credit_limit: 1000, headroom: 800 })))
      .toBe('SmartBuild Ltd has 800.00 INR left of 1000.00 INR.')
  })

  it('says plainly when there is no limit at all', () => {
    expect(positionLine(pos({ credit_limit: 0 })))
      .toMatch(/buys on terms against no limit at all/)
  })
})

describe('a seller’s security', () => {
  it('takes the rate off the gross', () => {
    expect(reserveOn(10000, 7.5)).toBe(750)
  })

  it('rounds to the cent', () => {
    expect(reserveOn(333.33, 10)).toBe(33.33)
  })

  it('holds nothing at a zero rate', () => {
    expect(reserveOn(10000, 0)).toBe(0)
  })

  it('adds the deposit and the reserve into what is held', () => {
    const c = sellerCover(sec({ deposit_held: 5000, reserve_held: 1200 }), 8000)
    expect(c.held).toBe(6200)
    expect(c.uncovered).toBe(1800)
    expect(c.covered).toBe(false)
  })

  it('is covered once we hold as much as we owe', () => {
    const c = sellerCover(sec({ deposit_held: 5000, reserve_held: 3000 }), 8000)
    expect(c.covered).toBe(true)
    expect(c.uncovered).toBe(0)
  })

  /* Holding more than we owe is their money sitting with us, not extra safety,
     so the uncovered figure floors at zero rather than going negative. */
  it('never reports negative exposure when we hold more than we owe', () => {
    expect(sellerCover(sec({ deposit_held: 20000 }), 8000).uncovered).toBe(0)
  })

  it('says plainly when nothing is held and why', () => {
    expect(securityLine(sec())).toMatch(/Nothing held/)
  })

  it('names the instrument and the rate', () => {
    const l = securityLine(sec({ deposit_held: 5000, deposit_kind: 'bank guarantee', reserve_pct: 10, reserve_held: 400 }))
    expect(l).toContain('bank guarantee')
    expect(l).toContain('10% rolling reserve')
    expect(l).toContain('400.00 USD held')
  })

  /* A rate set today has accrued nothing yet, and saying "0.00 held" reads as a
     reserve that is not working rather than one that has not run. */
  it('distinguishes a reserve that has not accrued from one holding nothing', () => {
    expect(securityLine(sec({ reserve_pct: 10, reserve_held: 0 })))
      .toMatch(/nothing accrued yet/)
  })
})

/* The sentences say what to say; the market says how money is written. Passing
   the formatter in is what stopped "1449746.18 INR" appearing on the same row
   as a column that read ₹14,49,746.18. */
describe('who writes the money in these sentences', () => {
  const rupees = (n: number, c: string) =>
    `${c === 'INR' ? '₹' : c + ' '}${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

  it('uses the formatter it is given, on a position', () => {
    const l = positionLine(pos({ exposure: 2000, credit_limit: 1000, headroom: -1000 }), rupees)
    expect(l).toContain('₹1,000.00')
    expect(l).not.toContain('1000.00 INR')
  })

  it('uses it on both figures, not just the first', () => {
    const l = positionLine(pos({ exposure: 200, credit_limit: 1000, headroom: 800 }), rupees)
    expect(l).toContain('₹800.00')
    expect(l).toContain('₹1,000.00')
  })

  it('uses it on what is held from a seller', () => {
    const l = securityLine(sec({ deposit_held: 5000, deposit_kind: 'bank guarantee',
      reserve_pct: 10, reserve_held: 400, currency: 'INR' }), rupees)
    expect(l).toContain('₹5,000.00')
    expect(l).toContain('₹400.00')
  })

  it('uses it in the problems too, where a bare number is worst', () => {
    const orphan = pos({ account_id: 'ENT-9999', company: 'Nobody Ltd', credit_limit: 990000 })
    const out = creditProblems([orphan], [], [], TODAY, rupees)
    expect(out[0]).toContain('₹9,90,000.00')
  })

  /* Without one it still says something readable rather than throwing — these
     run in tests and in the database checks, where there is no market. */
  it('falls back to the amount and the code', () => {
    expect(positionLine(pos({ exposure: 200, credit_limit: 1000, headroom: 800 })))
      .toContain('800.00 INR')
  })
})

describe('when the review is due', () => {
  it('counts days to it', () => {
    expect(reviewIn(ass({ next_review: '2026-08-18' }), TODAY)).toBe(10)
  })

  it('goes negative once it is late', () => {
    expect(reviewIn(ass({ next_review: '2026-07-08' }), TODAY)).toBe(-31)
    expect(reviewOverdue(ass({ next_review: '2026-07-08' }), TODAY)).toBe(true)
  })

  it('is not overdue on the day', () => {
    expect(reviewOverdue(ass({ next_review: TODAY }), TODAY)).toBe(false)
  })
})

/* The band decided how much they could have and then decided nothing else,
   until `20260808540000`. Every account was a year out whatever it was banded,
   and a risk rating that does not change what happens next is a label. */
describe('how often a band is looked at again', () => {
  it('looks at the ones that worry us four times as often', () => {
    expect(reviewMonths('high')).toBe(3)
    expect(reviewMonths('refused')).toBe(3)
    expect(reviewMonths('medium')).toBe(6)
    expect(reviewMonths('low')).toBe(12)
  })

  it('separates every band from the one below it', () => {
    const bands: CreditBand[] = ['refused', 'high', 'medium', 'low']
    for (let i = 1; i < bands.length; i++) {
      expect(reviewMonths(bands[i]), `${bands[i]} against ${bands[i - 1]}`)
        .toBeGreaterThanOrEqual(reviewMonths(bands[i - 1]))
    }
    expect(reviewMonths('high')).toBeLessThan(reviewMonths('low'))
  })

  /* Months, not days. A quarter that lands on the 5th one time and the 3rd the
     next reads like a mistake to whoever is chasing it. */
  it('lands on the same day of the month', () => {
    expect(dueFrom('high', '2026-08-08')).toBe('2026-11-08')
    expect(dueFrom('medium', '2026-08-08')).toBe('2027-02-08')
    expect(dueFrom('low', '2026-08-08')).toBe('2027-08-08')
  })

  it('carries a quarter over a year end', () => {
    expect(dueFrom('high', '2026-12-15')).toBe('2027-03-15')
  })

  /* Clamped to the end of the month, which is what `make_interval` does and
     what `setUTCMonth` does not — it would roll 30 November plus a quarter to
     2 March. Every one of these was checked against the database. */
  it('clamps to the end of a shorter month, the way Postgres does', () => {
    expect(dueFrom('high', '2026-11-30')).toBe('2027-02-28')
    expect(dueFrom('medium', '2026-12-31')).toBe('2027-06-30')
    expect(dueFrom('medium', '2026-08-31')).toBe('2027-02-28')
    expect(dueFrom('low', '2024-02-29')).toBe('2025-02-28')
  })

  it('knows a date that is on its band and one that is not', () => {
    expect(onCadence(ass({ band: 'low', next_review: '2027-08-08' }))).toBe(true)
    expect(onCadence(ass({ band: 'high', next_review: '2027-08-08' }))).toBe(false)
    expect(onCadence(ass({ band: 'high', next_review: '2026-11-08' }))).toBe(true)
  })
})

describe('what to look at first', () => {
  const over = pos({ account_id: 'A', exposure: 2000, credit_limit: 1000 })
  const stale = pos({ account_id: 'B', exposure: 100, credit_limit: 1000 })
  const near = pos({ account_id: 'C', exposure: 900, credit_limit: 1000 })
  const fine = pos({ account_id: 'D', exposure: 100, credit_limit: 1000 })
  const assessments = [
    ass({ account_id: 'A' }), ass({ account_id: 'B', next_review: '2026-01-01' }),
    ass({ account_id: 'C' }), ass({ account_id: 'D' }),
  ]
  const q = reviewQueue([fine, near, stale, over], assessments, TODAY)

  it('puts money already out above a decision nobody revisited', () => {
    expect(q.map(p => p.account_id)).toEqual(['A', 'B', 'C', 'D'])
  })

  it('breaks a tie on who is closest to the edge', () => {
    const two = reviewQueue([
      pos({ account_id: 'less', exposure: 100, credit_limit: 1000 }),
      pos({ account_id: 'more', exposure: 700, credit_limit: 1000 }),
    ], [], TODAY)
    expect(two[0].account_id).toBe('more')
  })

  it('does not reorder the caller’s array', () => {
    const src = [fine, over]
    reviewQueue(src, assessments, TODAY)
    expect(src[0].account_id).toBe('D')
  })
})

describe('the book', () => {
  const positions = [
    pos({ account_id: 'A', currency: 'INR', exposure: 1000, credit_limit: 500 }),
    pos({ account_id: 'B', currency: 'INR', exposure: 200, credit_limit: 1000 }),
    pos({ account_id: 'C', currency: 'AED', exposure: 50, credit_limit: 100, deposit_held: 25 }),
    pos({ account_id: 'D', currency: 'KES', exposure: 10, credit_limit: 0 }),
  ]
  const b = creditBook(positions, [ass({ account_id: 'B', next_review: '2026-01-01' })], TODAY)

  /* Four currencies trade here. One total across them is the single most
     misleading number a credit screen could carry. */
  it('never adds two currencies together', () => {
    expect(b.exposed.length).toBe(3)
    expect(b.exposed.find(g => g.currency === 'INR')!.total.amount).toBe(1200)
  })

  it('reports what is secured separately, and only where something is held', () => {
    expect(b.secured.length).toBe(1)
    expect(b.secured[0].currency).toBe('AED')
  })

  it('counts who is over, who is near, and who was never assessed', () => {
    expect(b.over).toBe(1)
    expect(b.nearLimit).toBe(0)
    expect(b.unreviewed).toBe(1)
    expect(b.noLimit).toBe(1)
  })
})

describe('where the credit file disagrees with itself', () => {
  it('finds an account trading on terms against no limit', () => {
    const out = creditProblems([pos({ credit_limit: 0 })], [], [], TODAY)
    expect(out[0]).toMatch(/no limit at all/)
  })

  it('finds a limit nobody assessed', () => {
    const out = creditProblems([pos()], [], [], TODAY)
    expect(out[0]).toMatch(/no assessment behind it/)
  })

  it('finds the applied limit disagreeing with the granted one', () => {
    const out = creditProblems([pos({ credit_limit: 2000 })], [ass({ limit_granted: 1000 })], [], TODAY)
    expect(out.some(x => x.includes('held to 2000') && x.includes('granted 1000'))).toBe(true)
  })

  it('finds an assessment in the wrong currency', () => {
    const out = creditProblems([pos()], [ass({ currency: 'AED' })], [], TODAY)
    expect(out.some(x => x.includes('assessed in AED'))).toBe(true)
  })

  /* The one my own first pass failed: a review calling an over-extended account
     low risk is how a red figure stays quiet. */
  it('finds an over-limit account whose review flatters it', () => {
    const out = creditProblems(
      [pos({ exposure: 2000, credit_limit: 1000 })], [ass({ band: 'low' })], [], TODAY)
    expect(out.some(x => x.includes('over its limit') && x.includes('low risk'))).toBe(true)
  })

  it('accepts an over-limit account whose review says so', () => {
    const out = creditProblems(
      [pos({ exposure: 2000, credit_limit: 1000 })], [ass({ band: 'high' })], [], TODAY)
    expect(out.some(x => x.includes('over its limit'))).toBe(false)
  })

  it('finds a review nobody has done', () => {
    const out = creditProblems([pos()], [ass({ next_review: '2026-01-01' })], [], TODAY)
    expect(out.some(x => x.includes('due a review on 2026-01-01'))).toBe(true)
  })

  it('finds a deposit held on no instrument', () => {
    const out = creditProblems([], [], [sec({ deposit_held: 5000, deposit_kind: 'none' })], TODAY)
    expect(out[0]).toMatch(/recorded as no instrument/)
  })

  it('finds a reserve held against a rate of zero', () => {
    const out = creditProblems([], [], [sec({ reserve_held: 400, reserve_pct: 0 })], TODAY)
    expect(out[0]).toMatch(/reserve held against a rate of zero/)
  })

  it('is silent on a file that agrees with itself', () => {
    expect(creditProblems([pos()], [ass()], [sec()], TODAY)).toEqual([])
  })
})
