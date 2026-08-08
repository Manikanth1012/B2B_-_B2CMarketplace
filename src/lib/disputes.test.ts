import { describe, it, expect } from 'vitest'
import {
  KIND_LABEL, KIND_PARTIES, STATUS_LABEL, STATUS_TONE, OUTCOME_LABEL, isClosed,
  daysLeft, isLate, ageInDays, clockLine, withholding, pressureLine, workQueue,
  atStake, canClose, closingEffect, outcomesFor, record, disputeProblems, line,
} from './disputes'
import type { DisputeRow, DisputeKind, DisputeStatus, DisputeOutcome } from './disputes'

const TODAY = '2026-08-08'

const d = (over: Partial<DisputeRow> = {}): DisputeRow => ({
  id: 'DSP-2201',
  kind: 'order',
  subject_ref: 'ORD-880519',
  partner_id: 'PTR-1004',
  account_id: 'ENT-2011',
  order_ref: 'ORD-880519',
  product_id: 'SKU-5003',
  category_id: 'iot',
  reason: '3 of 25 sensors reported missing on delivery',
  detail: 'Buyer signed for 25 cartons.',
  claimant: 'Brightline Foods',
  raised: '2026-07-25',
  amount: 22497,
  currency: 'INR',
  owner: 'seller',
  status: 'awaiting_seller',
  due_on: '2026-08-01',
  outcome: null,
  resolution: null,
  resolved_on: null,
  sort_order: 1,
  ...over,
})

describe('the vocabulary', () => {
  it('has a label and a description of who is arguing for every kind', () => {
    for (const k of ['order', 'invoice', 'statement', 'note'] as DisputeKind[]) {
      expect(KIND_LABEL[k], k).toBeTruthy()
      expect(KIND_PARTIES[k], k).toBeTruthy()
    }
  })

  /* An invoice dispute is the marketplace being disputed, not refereeing. The
     screen has to say which, because the two need opposite instincts. */
  it('says plainly when the marketplace is the one being disputed', () => {
    expect(KIND_PARTIES.invoice).toMatch(/We are the ones being disputed/)
    expect(KIND_PARTIES.order).toMatch(/holds the ring/)
  })

  it('has a label and a tone for every status', () => {
    for (const s of ['open', 'awaiting_seller', 'awaiting_marketplace', 'resolved', 'rejected'] as DisputeStatus[]) {
      expect(STATUS_LABEL[s], s).toBeTruthy()
      expect(STATUS_TONE[s], s).toBeTruthy()
    }
  })

  it('has words for every outcome', () => {
    for (const o of ['refunded', 'redelivered', 'partial', 'upheld_seller', 'withdrawn'] as DisputeOutcome[]) {
      expect(OUTCOME_LABEL[o], o).toBeTruthy()
    }
  })

  it('counts both closed states as closed', () => {
    expect(isClosed(d({ status: 'resolved' }))).toBe(true)
    expect(isClosed(d({ status: 'rejected' }))).toBe(true)
    expect(isClosed(d({ status: 'open' }))).toBe(false)
  })
})

describe('the clock', () => {
  it('counts days to the promise', () => {
    expect(daysLeft(d({ due_on: '2026-08-13' }), TODAY)).toBe(5)
  })

  it('goes negative once it is late', () => {
    expect(daysLeft(d({ due_on: '2026-08-01' }), TODAY)).toBe(-7)
  })

  it('has no clock when nothing set one', () => {
    expect(daysLeft(d({ due_on: null }), TODAY)).toBeNull()
    expect(isLate(d({ due_on: null }), TODAY)).toBe(false)
  })

  /* A closed dispute cannot be late. Leaving it late would fill the queue with
     work already done. */
  it('is never late once it is closed', () => {
    expect(isLate(d({ due_on: '2026-01-01', status: 'resolved' }), TODAY)).toBe(false)
  })

  it('counts how long it has been running', () => {
    expect(ageInDays(d({ raised: '2026-07-25' }), TODAY)).toBe(14)
  })

  it('never reports a negative age for something raised today', () => {
    expect(ageInDays(d({ raised: TODAY }), TODAY)).toBe(0)
  })

  it('says how late it is and how long it has run', () => {
    expect(clockLine(d({ due_on: '2026-08-01', raised: '2026-07-25' }), TODAY))
      .toBe('7 days late, and open 14 days.')
  })

  it('says due today rather than "in 0 days"', () => {
    expect(clockLine(d({ due_on: TODAY }), TODAY)).toMatch(/^Due today/)
  })

  it('says nobody is late when nothing set a date', () => {
    expect(clockLine(d({ due_on: null }), TODAY)).toMatch(/nobody is late on this/)
  })

  it('reports how long a closed one took, not how long ago it was', () => {
    expect(clockLine(d({ status: 'resolved', raised: '2026-07-25', resolved_on: '2026-07-30' }), TODAY))
      .toBe('Closed on 2026-07-30, 5 days after it was raised.')
  })
})

describe('who is out of pocket while it runs', () => {
  /* The distinction the whole queue is ordered on. */
  it('holds a seller’s whole payout on a statement dispute', () => {
    expect(withholding(d({ kind: 'statement', owner: 'marketplace' }))).toBe(true)
    expect(pressureLine(d({ kind: 'statement' }))).toMatch(/not being paid at all/)
  })

  it('holds part of it on a note dispute', () => {
    expect(withholding(d({ kind: 'note' }))).toBe(true)
    expect(pressureLine(d({ kind: 'note' }))).toMatch(/does not settle/)
  })

  it('holds nothing on an invoice dispute — the account keeps its own money', () => {
    expect(withholding(d({ kind: 'invoice', owner: 'marketplace' }))).toBe(false)
    expect(pressureLine(d({ kind: 'invoice' }))).toMatch(/holding the money/)
  })

  /* The case people forget: an order dispute the marketplace owns means we are
     sitting on the seller's money. */
  it('holds the seller’s money on an order dispute the marketplace owns', () => {
    expect(withholding(d({ kind: 'order', owner: 'marketplace' }))).toBe(true)
    expect(pressureLine(d({ kind: 'order', owner: 'marketplace' }))).toMatch(/holding the seller’s money/)
  })

  it('holds nothing on an order dispute the seller has been asked to answer', () => {
    expect(withholding(d({ kind: 'order', owner: 'seller' }))).toBe(false)
  })

  it('holds nothing once it is closed, whatever kind it was', () => {
    for (const k of ['order', 'invoice', 'statement', 'note'] as DisputeKind[]) {
      expect(withholding(d({ kind: k, owner: 'marketplace', status: 'resolved' })), k).toBe(false)
    }
    expect(pressureLine(d({ status: 'resolved' }))).toBe('Nothing is held.')
  })
})

describe('what to work first', () => {
  const late_bleeding = d({ id: 'A', kind: 'statement', due_on: '2026-08-01', amount: 100 })
  const bleeding = d({ id: 'B', kind: 'note', due_on: '2026-08-20', amount: 100 })
  const late = d({ id: 'C', kind: 'invoice', owner: 'marketplace', due_on: '2026-08-02', amount: 100 })
  const asked = d({ id: 'D', kind: 'order', owner: 'seller', due_on: '2026-08-30', amount: 100 })
  const done = d({ id: 'E', kind: 'statement', status: 'resolved', outcome: 'refunded', due_on: '2026-01-01' })
  const q = workQueue([done, asked, late, bleeding, late_bleeding], TODAY)

  it('puts unpaid-and-late above everything', () => {
    expect(q[0].id).toBe('A')
  })

  it('puts unpaid above merely late', () => {
    expect(q.map(x => x.id)).toEqual(['A', 'B', 'C', 'D', 'E'])
  })

  it('puts everything closed last', () => {
    expect(q[q.length - 1].id).toBe('E')
  })

  it('breaks a tie on which is latest against its own promise', () => {
    const two = workQueue([
      d({ id: 'soon', kind: 'invoice', due_on: '2026-08-20' }),
      d({ id: 'late', kind: 'invoice', due_on: '2026-08-09' }),
    ], TODAY)
    expect(two[0].id).toBe('late')
  })

  it('then on size, because the bigger claim costs more to be wrong about', () => {
    const two = workQueue([
      d({ id: 'small', kind: 'invoice', due_on: '2026-08-20', amount: 10 }),
      d({ id: 'big', kind: 'invoice', due_on: '2026-08-20', amount: 90000 }),
    ], TODAY)
    expect(two[0].id).toBe('big')
  })

  it('does not reorder the caller’s array', () => {
    const src = [done, asked]
    workQueue(src, TODAY)
    expect(src[0].id).toBe('E')
  })
})

describe('what is at stake', () => {
  /* Due dates are explicit: the fixture's default is in the past, and leaving it
     would make every open row late and the two counts identical. */
  const rows = [
    d({ id: '1', kind: 'statement', amount: 14744.07, currency: 'USD', due_on: '2026-08-13' }),
    d({ id: '2', kind: 'note', amount: 89.99, currency: 'USD', due_on: '2026-08-13' }),
    d({ id: '3', kind: 'invoice', owner: 'marketplace', amount: 169435.4, currency: 'KES', due_on: '2026-08-15' }),
    d({ id: '4', kind: 'order', owner: 'seller', amount: 22497, currency: 'INR', due_on: '2026-08-20' }),
    d({ id: '5', kind: 'order', owner: 'marketplace', amount: 1000, currency: 'INR', due_on: '2026-08-01' }),
    d({ id: '6', kind: 'order', status: 'resolved', outcome: 'refunded', amount: 99999, currency: 'INR' }),
  ]
  const s = atStake(rows, TODAY)

  /* Somebody's payroll, reported on its own. */
  it('reports withheld money separately from claimed money', () => {
    expect(s.withheld.find(g => g.currency === 'USD')!.total.amount).toBe(14834.06)
    expect(s.withheld.find(g => g.currency === 'INR')!.total.amount).toBe(1000)
    expect(s.claimed.find(g => g.currency === 'KES')!.total.amount).toBe(169435.4)
  })

  it('never adds two currencies together', () => {
    expect(s.withheld.length).toBe(2)
    expect(new Set(s.withheld.map(g => g.currency)).size).toBe(2)
  })

  it('leaves closed disputes out of every figure', () => {
    const all = [...s.withheld, ...s.claimed].reduce((n, g) => n + g.total.amount, 0)
    expect(all).not.toContain(99999)
    expect(s.open).toBe(5)
  })

  it('counts the late ones and the bleeding ones separately', () => {
    expect(s.late).toBe(1)
    expect(s.bleeding).toBe(3)
  })
})

describe('closing one', () => {
  it('refuses without an outcome, because nobody could tell who paid', () => {
    const r = canClose(d(), null, 'We agreed with the buyer.')
    expect(r.ok).toBe(false)
    expect(!r.ok && r.reason).toMatch(/who paid/)
  })

  it('refuses without an answer, naming who is owed one', () => {
    const r = canClose(d(), 'refunded', '   ')
    expect(r.ok).toBe(false)
    expect(!r.ok && r.reason).toContain('Brightline Foods')
  })

  it('refuses one already closed', () => {
    expect(canClose(d({ status: 'resolved' }), 'refunded', 'x').ok).toBe(false)
  })

  it('accepts an outcome with an answer', () => {
    expect(canClose(d(), 'refunded', 'Three units confirmed short. Refunded.').ok).toBe(true)
  })
})

describe('what closing it will do', () => {
  it('sends an invoice back to payable, and says settling the argument is not paying it', () => {
    expect(closingEffect(d({ kind: 'invoice', subject_ref: 'INV-KE-2026-07' }), 'partial'))
      .toMatch(/not the same as settling the invoice/)
  })

  it('unfreezes a statement', () => {
    expect(closingEffect(d({ kind: 'statement', subject_ref: 'ss-1011-202607' }), 'upheld_seller'))
      .toMatch(/approved and paid on its cycle/)
  })

  /* The one worth spelling out: the outcome decides whether the adjustment
     survives, and the two answers are opposite. */
  it('voids a note when the seller wins, and reinstates it when they do not', () => {
    expect(closingEffect(d({ kind: 'note', subject_ref: 'DN-2026-0034' }), 'upheld_seller'))
      .toMatch(/voided/)
    expect(closingEffect(d({ kind: 'note', subject_ref: 'DN-2026-0034' }), 'refunded'))
      .toMatch(/back to issued/)
  })

  it('releases a hold on an order dispute the marketplace owns', () => {
    expect(closingEffect(d({ kind: 'order', owner: 'marketplace' }), 'refunded'))
      .toMatch(/released at the next run/)
  })
})

describe('which outcomes are on offer', () => {
  it('offers redelivery only where there are goods', () => {
    expect(outcomesFor('order')).toContain('redelivered')
    for (const k of ['invoice', 'statement', 'note'] as DisputeKind[]) {
      expect(outcomesFor(k), k).not.toContain('redelivered')
    }
  })

  it('always offers a way for each side to win', () => {
    for (const k of ['order', 'invoice', 'statement', 'note'] as DisputeKind[]) {
      expect(outcomesFor(k), k).toContain('upheld_seller')
      expect(outcomesFor(k), k).toContain('refunded')
    }
  })
})

describe('how the desk is doing', () => {
  const rows = [
    d({ id: '1', status: 'resolved', outcome: 'refunded', raised: '2026-05-11', resolved_on: '2026-05-15' }),
    d({ id: '2', status: 'resolved', outcome: 'upheld_seller', raised: '2026-05-30', resolved_on: '2026-06-05' }),
    d({ id: '3', status: 'resolved', outcome: 'redelivered', raised: '2026-06-14', resolved_on: '2026-06-27' }),
    d({ id: '4', status: 'rejected', outcome: 'withdrawn', raised: '2026-04-19', resolved_on: '2026-04-30' }),
    d({ id: '5', status: 'open' }),
  ]
  const r = record(rows)

  it('counts only what is closed', () => {
    expect(r.closed).toBe(4)
  })

  it('counts a replacement at the seller’s cost as not having paid out', () => {
    expect(r.upheld).toBe(3)
    expect(r.paidOut).toBe(1)
  })

  it('reports the share as a percentage of what is closed', () => {
    expect(r.upheldPct).toBe(75)
  })

  it('has no percentage when nothing is closed', () => {
    expect(record([d({ status: 'open' })]).upheldPct).toBeNull()
  })

  /* Median rather than mean: one dispute that ran a year would make the average
     say the desk is slow when three quarters of them close in a week. */
  it('reports the median days to close, not the mean', () => {
    expect(r.medianDays).toBe(11)
  })
})

describe('where the book disagrees with itself', () => {
  it('finds a closed dispute with no answer on it', () => {
    const out = disputeProblems([d({ status: 'resolved', outcome: null, resolution: null })], [])
    expect(out[0]).toMatch(/closed with no answer/)
  })

  it('finds an open dispute already carrying an outcome', () => {
    const out = disputeProblems([d({ status: 'open', outcome: 'refunded' })], [])
    expect(out.some(x => x.includes('already carries an outcome'))).toBe(true)
  })

  it('finds one resolved before it was raised', () => {
    const out = disputeProblems(
      [d({ status: 'resolved', outcome: 'refunded', resolution: 'x', raised: '2026-08-01', resolved_on: '2026-07-01' })], [])
    expect(out.some(x => x.includes('before it was raised'))).toBe(true)
  })

  it('finds an order dispute naming no order', () => {
    const out = disputeProblems([d({ kind: 'order', order_ref: null })], [])
    expect(out.some(x => x.includes('naming no order'))).toBe(true)
  })

  /* The pair that matters: a flag and a case that disagree means somebody is
     reading one of them and believing it. */
  it('finds something marked disputed with no case open on it', () => {
    const out = disputeProblems([], [{ kind: 'invoice', ref: 'INV-KE-2026-07' }])
    expect(out.some(x => x.includes('INV-KE-2026-07') && x.includes('no case is open'))).toBe(true)
  })

  it('finds a case open against something no longer flagged', () => {
    const out = disputeProblems([d({ kind: 'statement', subject_ref: 'ss-1011-202607', status: 'open' })], [])
    expect(out.some(x => x.includes('not marked disputed at the source'))).toBe(true)
  })

  /* An order has no disputed flag of its own — the dispute row is the only
     record — so demanding one would report every order dispute as broken. */
  it('does not demand a source flag for an order dispute', () => {
    const out = disputeProblems([d({ kind: 'order', status: 'open' })], [])
    expect(out).toEqual([])
  })

  it('is silent when the flags and the cases agree', () => {
    const out = disputeProblems(
      [d({ kind: 'note', subject_ref: 'DN-2026-0034', status: 'open' })],
      [{ kind: 'note', ref: 'DN-2026-0034' }])
    expect(out).toEqual([])
  })
})

describe('the sentence on a row', () => {
  it('names the claimant, what is being argued about, and why', () => {
    expect(line(d()))
      .toBe('Brightline Foods against ORD-880519 — 3 of 25 sensors reported missing on delivery.')
  })
})
