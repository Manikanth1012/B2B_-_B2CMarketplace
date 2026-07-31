import { describe, it, expect } from 'vitest'
import {
  STATES, REASONS, sla, escalationDue, ownership, fundedBy, autoApproves,
  canDecide, validateDecision, applyDecision, summarise, queue, byCategory,
  slowSellers, windowFor, insideWindow,
} from './refunds'
import type { Refund, RefundPolicy } from './refunds'

const policy: RefundPolicy = {
  seller_sla_hours: 48,
  escalate_after_hours: 72,
  auto_approve_below: 25,
  auto_approve_reasons: ['duplicate'],
  escalation_rule: 'x',
  marketplace_decides_when: 'y',
  funded_by: 'The seller whose product it was.',
  store_credit: 'z',
}

const r = (over: Partial<Refund> & Pick<Refund, 'id'>): Refund => ({
  order_ref: 'ORD-1', product_id: 'SKU-5003', item: 'Nimbus Cold-chain sensor',
  category_id: 'iot', partner_id: 'PTR-1004', seller: 'Nimbus Sensors', first_party: false,
  bundle_ref: null, customer: 'Brightline Foods', buyer_type: 'enterprise', user_id: null,
  amount: 168, refunded: null, currency: 'USD', reason: 'faulty', detail: null, evidence: null,
  requested: '2026-07-28', decider: 'seller', sla_due: '2026-07-30', state: 'requested',
  decided_on: null, decided_by: null, decision_note: null,
  escalated_on: null, escalated_why: null, sort_order: 0,
  ...over,
})

const on = (d: string) => new Date(d + 'T00:00:00Z')

/* -------------------------------------------------------------- the clock -- */

describe('sla', () => {
  it('counts down while there is still time', () => {
    const s = sla(r({ id: 'a', sla_due: '2026-08-02' }), policy, on('2026-07-30'))
    expect(s.level).toBe('ok')
    expect(s.text).toBe('An answer is owed in 3 days.')
  })

  it('says tomorrow rather than "in 1 days"', () => {
    expect(sla(r({ id: 'a', sla_due: '2026-07-31' }), policy, on('2026-07-30')).text)
      .toBe('An answer is owed tomorrow.')
  })

  it('marks the day it is due as its own state', () => {
    /* "Owed today" and "one day left" are different urgencies and a seller
       working a queue treats them differently. */
    const s = sla(r({ id: 'a', sla_due: '2026-07-30' }), policy, on('2026-07-30'))
    expect(s.level).toBe('today')
  })

  it('under the published policy, being late at all means it can be taken away', () => {
    /* 48-hour SLA and a 72-hour clock, on whole days: the first day a seller is
       past the deadline is the third day since the request, which is the day
       escalation becomes available. There is no grace between them. */
    const s = sla(r({ id: 'a', requested: '2026-07-28', sla_due: '2026-07-30' }), policy, on('2026-07-31'))
    expect(s.level).toBe('overdue')
    expect(s.text).toMatch(/take this decision away at any time/)
  })

  it('counts down to escalation where the policy leaves a gap between the two', () => {
    const tighter = { ...policy, seller_sla_hours: 24 }
    const s = sla(r({ id: 'a', requested: '2026-07-29', sla_due: '2026-07-30' }), tighter, on('2026-07-31'))
    expect(s.text).toMatch(/escalates to the marketplace tomorrow/)
  })

  it('stops running once the marketplace has taken it', () => {
    const s = sla(r({ id: 'a', state: 'escalated', escalated_on: '2026-07-30', escalated_why: 'late' }),
      policy, on('2026-07-31'))
    expect(s.level).toBe('gone')
    expect(s.text).toMatch(/out of the seller’s hands/)
  })

  it('is silent on anything already decided', () => {
    expect(sla(r({ id: 'a', state: 'declined' }), policy, on('2026-07-31')).level).toBe('settled')
  })

  it('distinguishes agreed-but-unpaid from closed', () => {
    expect(sla(r({ id: 'a', state: 'approved' }), policy, on('2026-07-31')).text)
      .toMatch(/waiting on the payment run/)
  })
})

describe('escalationDue', () => {
  it('is false while the seller still has time', () => {
    expect(escalationDue(r({ id: 'a', requested: '2026-07-30' }), policy, on('2026-07-31'))).toBe(false)
  })

  it('is true once 72 hours have passed with no answer', () => {
    expect(escalationDue(r({ id: 'a', requested: '2026-07-28' }), policy, on('2026-07-31'))).toBe(true)
  })

  it('does not re-escalate something already escalated', () => {
    const row = r({ id: 'a', requested: '2026-07-20', state: 'escalated', escalated_on: '2026-07-23', escalated_why: 'x' })
    expect(escalationDue(row, policy, on('2026-07-31'))).toBe(false)
  })

  it('leaves the marketplace’s own alone — there is nobody to escalate to', () => {
    expect(escalationDue(r({ id: 'a', requested: '2026-07-20', decider: 'marketplace' }), policy, on('2026-07-31')))
      .toBe(false)
  })
})

/* ------------------------------------------------------------- ownership -- */

describe('ownership', () => {
  it('gives a seller their own product, and says why', () => {
    const o = ownership(r({ id: 'a' }))
    expect(o.owner).toBe('seller')
    expect(o.because).toMatch(/seller’s revenue going back/)
  })

  it('gives the marketplace what the marketplace sold', () => {
    const o = ownership(r({ id: 'a', first_party: true, partner_id: null, decider: 'marketplace' }))
    expect(o).toMatchObject({ owner: 'marketplace' })
    expect(o.because).toMatch(/both decides and funds it/)
  })

  it('gives the marketplace a bundle it assembled, even though a seller supplied the part', () => {
    const o = ownership(r({ id: 'a', bundle_ref: 'BND-FLEET-PRO' }))
    expect(o.owner).toBe('marketplace')
    expect(o.because).toMatch(/answers for the whole/)
  })

  it('repeats the escalation reason rather than just claiming the decision', () => {
    /* A seller who loses a decision without being told why concludes the
       marketplace simply took it. */
    const o = ownership(r({
      id: 'a', state: 'escalated', decider: 'marketplace',
      escalated_on: '2026-07-27', escalated_why: 'Ninety-six hours unresolved.',
    }))
    expect(o.because).toBe('Ninety-six hours unresolved.')
  })
})

describe('fundedBy', () => {
  it('bills a third-party refund back to the seller even when the marketplace granted it', () => {
    expect(fundedBy(r({ id: 'a', state: 'escalated', escalated_on: 'x', escalated_why: 'y' }), policy))
      .toBe(policy.funded_by)
  })

  it('leaves a first-party refund with the marketplace', () => {
    expect(fundedBy(r({ id: 'a', first_party: true, partner_id: null, decider: 'marketplace' }), policy))
      .toMatch(/carries the cost/)
  })
})

describe('autoApproves', () => {
  it('approves a duplicate charge at any value — it is provable, not a judgement', () => {
    const v = autoApproves('duplicate', 5000, policy)
    expect(v.yes).toBe(true)
    expect(v.because).toMatch(/not a judgement call/)
  })

  it('approves anything under the threshold, because arguing costs more', () => {
    expect(autoApproves('changed-mind', 6.49, policy).because).toMatch(/costs both sides more/)
  })

  it('leaves a real claim for a person', () => {
    expect(autoApproves('faulty', 168, policy).yes).toBe(false)
  })

  it('treats the threshold as exclusive', () => {
    expect(autoApproves('changed-mind', 25, policy).yes).toBe(false)
  })
})

/* -------------------------------------------------------------- deciding -- */

describe('canDecide', () => {
  it('lets the seller decide their own open request', () => {
    expect(canDecide(r({ id: 'a' }), 'seller')).toEqual({ ok: true })
  })

  it('refuses the seller once the clock has moved it', () => {
    const row = r({ id: 'a', state: 'escalated', decider: 'marketplace', escalated_on: 'x', escalated_why: 'ran out' })
    const v = canDecide(row, 'seller')
    expect(!v.ok && v.reason).toMatch(/ran out/)
  })

  it('refuses the marketplace while the seller still has it', () => {
    const v = canDecide(r({ id: 'a' }), 'marketplace')
    expect(!v.ok && v.reason).toMatch(/when the clock runs out, not before/)
  })

  it('will not reopen a closed refund', () => {
    const v = canDecide(r({ id: 'a', state: 'refunded', refunded: 168 }), 'seller')
    expect(!v.ok && v.reason).toMatch(/not reopened/)
  })

  it('treats an approved one as nothing left to decide', () => {
    const v = canDecide(r({ id: 'a', state: 'approved' }), 'marketplace')
    expect(!v.ok && v.reason).toMatch(/queued to the payment run/)
  })
})

describe('validateDecision', () => {
  const base = { amount: 168, refunded: 0, reason: 'faulty' as const, evidence: 'Fault report' }

  it('refuses a decline with nothing written on it', () => {
    const v = validateDecision({ ...base, decision: 'decline', note: 'no' })
    expect(!v.ok && v.reason).toMatch(/comes back as a chargeback/)
  })

  it('refuses to decline a judgement call while pointing at nothing', () => {
    const v = validateDecision({
      ...base, decision: 'decline', evidence: null,
      note: 'We do not agree with this claim at all, sorry.',
    })
    expect(!v.ok && v.reason).toMatch(/escalates on its own/)
  })

  it('accepts declining a provable reason without extra evidence', () => {
    /* A cancellation timestamp is either inside the window or it is not. */
    const v = validateDecision({
      ...base, decision: 'decline', reason: 'cancelled', evidence: null,
      note: 'Cancelled 31 days after purchase, outside the 14-day window.',
    })
    expect(v.ok).toBe(true)
  })

  it('refuses a part refund that returns nothing', () => {
    const v = validateDecision({ ...base, decision: 'partial', refunded: 0, note: 'a b c d e f g h' })
    expect(!v.ok && v.reason).toMatch(/decline it/)
  })

  it('refuses a part refund that returns everything', () => {
    const v = validateDecision({ ...base, decision: 'partial', refunded: 168, note: 'a b c d e f g h' })
    expect(!v.ok && v.reason).toMatch(/approve it instead/)
  })

  it('makes a part refund explain the difference', () => {
    const v = validateDecision({ ...base, decision: 'partial', refunded: 84, note: 'half' })
    expect(!v.ok && v.reason).toMatch(/Explain the difference/)
  })

  it('accepts a properly explained part refund', () => {
    const v = validateDecision({
      ...base, decision: 'partial', refunded: 84,
      note: 'Two of the four were out of calibration on return and are refunded; the others tested clean.',
    })
    expect(v).toEqual({ ok: true })
  })

  it('asks for a line even on an approval', () => {
    expect(validateDecision({ ...base, decision: 'approve', note: 'ok' }).ok).toBe(false)
    expect(validateDecision({ ...base, decision: 'approve', note: 'Fault accepted, unit returned.' }).ok).toBe(true)
  })
})

describe('applyDecision', () => {
  it('approves rather than refunds — the money has not moved yet', () => {
    /* Saying "refunded" before the payment run has is how a customer is told
       twice that they have been paid and is not. */
    expect(applyDecision({ decision: 'approve', refunded: 0 })).toEqual({ state: 'approved', refunded: null })
  })

  it('records a part refund to the cent', () => {
    expect(applyDecision({ decision: 'partial', refunded: 168.456 })).toEqual({ state: 'partial', refunded: 168.46 })
  })

  it('leaves nothing refunded on a decline', () => {
    expect(applyDecision({ decision: 'decline', refunded: 50 })).toEqual({ state: 'declined', refunded: null })
  })
})

/* ------------------------------------------------------------- the book --- */

describe('summarise', () => {
  const rows = [
    r({ id: 'open', sla_due: '2026-08-05', amount: 100 }),
    r({ id: 'late', sla_due: '2026-07-20', amount: 200 }),
    r({ id: 'esc', state: 'escalated', amount: 300, escalated_on: 'x', escalated_why: 'y' }),
    r({ id: 'no', state: 'declined', amount: 50, decided_on: 'x', decided_by: 'y', decision_note: 'z' }),
    r({ id: 'yes', state: 'refunded', refunded: 40, amount: 40, decided_on: 'x', decided_by: 'y', decision_note: 'z' }),
  ]

  it('puts a ceiling on what could leave, not a prediction', () => {
    const s = summarise(rows, on('2026-07-31'))
    expect(s.open).toBe(3)
    expect(s.atStake).toBe(600)
  })

  it('counts what is late and what has been taken away separately', () => {
    const s = summarise(rows, on('2026-07-31'))
    expect(s).toMatchObject({ overdue: 1, escalated: 1 })
  })

  it('reports what actually went back, not what was claimed', () => {
    expect(summarise(rows, on('2026-07-31')).refundedValue).toBe(40)
  })

  it('reports how much of the closed book the seller held', () => {
    expect(summarise(rows, on('2026-07-31')).heldPct).toBe(50)
  })

  it('returns null rather than zero when nothing has closed', () => {
    /* 0% held and "nothing has closed yet" are different states. */
    expect(summarise([r({ id: 'a' })], on('2026-07-31')).heldPct).toBeNull()
  })
})

describe('queue', () => {
  it('puts what is late first, then what is due today', () => {
    const out = queue([
      r({ id: 'later', sla_due: '2026-08-04' }),
      r({ id: 'today', sla_due: '2026-07-31' }),
      r({ id: 'late', sla_due: '2026-07-25', requested: '2026-07-23' }),
    ], policy, on('2026-07-31'))
    expect(out.map(x => x.id)).toEqual(['late', 'today', 'later'])
  })

  it('sinks everything already decided below everything that is not', () => {
    const out = queue([
      r({ id: 'done', state: 'refunded', refunded: 168, sla_due: '2026-06-01', decided_on: 'x', decided_by: 'y', decision_note: 'z' }),
      r({ id: 'open', sla_due: '2026-08-09' }),
    ], policy, on('2026-07-31'))
    expect(out[0].id).toBe('open')
  })

  it('breaks a tie on the larger amount, because that is the bigger exposure', () => {
    const out = queue([
      r({ id: 'small', sla_due: '2026-08-02', amount: 20 }),
      r({ id: 'big', sla_due: '2026-08-02', amount: 2000 }),
    ], policy, on('2026-07-31'))
    expect(out[0].id).toBe('big')
  })
})

describe('byCategory', () => {
  it('keeps a pattern in one marketplace from being averaged away', () => {
    const out = byCategory([
      r({ id: 'a', category_id: 'iot' }),
      r({ id: 'b', category_id: 'iot' }),
      r({ id: 'c', category_id: 'device', state: 'refunded', refunded: 168, decided_on: 'x', decided_by: 'y', decision_note: 'z' }),
    ])
    expect(out[0]).toMatchObject({ category_id: 'iot', open: 2, total: 2 })
    expect(out[1]).toMatchObject({ category_id: 'device', open: 0, total: 1 })
  })
})

describe('slowSellers', () => {
  it('ranks who is not answering, not who has the most refunds', () => {
    const out = slowSellers([
      r({ id: 'a', partner_id: 'PTR-1', seller: 'Busy', state: 'refunded', refunded: 1, amount: 1, decided_on: 'x', decided_by: 'y', decision_note: 'z' }),
      r({ id: 'b', partner_id: 'PTR-1', seller: 'Busy', state: 'refunded', refunded: 1, amount: 1, decided_on: 'x', decided_by: 'y', decision_note: 'z' }),
      r({ id: 'c', partner_id: 'PTR-2', seller: 'Slow', sla_due: '2026-07-01', amount: 500 }),
    ], on('2026-07-31'))
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ partner_id: 'PTR-2', overdue: 1, value: 500 })
  })

  it('counts an escalation against the seller who let it happen', () => {
    const out = slowSellers([
      r({ id: 'a', partner_id: 'PTR-2', seller: 'Slow', state: 'escalated', amount: 300, escalated_on: 'x', escalated_why: 'y' }),
    ], on('2026-07-31'))
    expect(out[0]).toMatchObject({ overdue: 0, escalated: 1 })
  })

  it('leaves the marketplace’s own out — it is not a seller', () => {
    const out = slowSellers([
      r({ id: 'a', partner_id: null, first_party: true, decider: 'marketplace', sla_due: '2026-07-01' }),
    ], on('2026-07-31'))
    expect(out).toEqual([])
  })
})

describe('windows', () => {
  const windows = [
    { category_id: 'iot', days: 14, note: 'Hardware follows the device window.' },
    { category_id: 'security', days: 30, note: 'Pro-rata for the unused term.' },
  ]

  it('finds the window and what it means there', () => {
    expect(windowFor('security', windows)!.days).toBe(30)
  })

  it('returns nothing for a marketplace with no window published', () => {
    expect(windowFor('partner', windows)).toBeNull()
  })

  it('says how far past the window a purchase is', () => {
    const v = insideWindow('2026-07-01', 'iot', windows, on('2026-07-31'))
    expect(v).toEqual({ inside: false, days: 30, window: 14 })
  })

  it('counts the last day of the window as inside it', () => {
    expect(insideWindow('2026-07-17', 'iot', windows, on('2026-07-31'))!.inside).toBe(true)
  })
})

describe('the vocabulary', () => {
  it('marks exactly the states nobody has to act on as final', () => {
    const final = (Object.keys(STATES) as (keyof typeof STATES)[]).filter(s => STATES[s].final)
    expect(final.sort()).toEqual(['declined', 'partial', 'refunded'])
  })

  it('names what would settle each reason, not just the reason', () => {
    for (const spec of Object.values(REASONS)) {
      expect(spec.evidence.length).toBeGreaterThan(3)
    }
  })
})
