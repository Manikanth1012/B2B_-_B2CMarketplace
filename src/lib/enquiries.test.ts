import { describe, it, expect } from 'vitest'
import {
  routeTo, canTransition, isExpired, enquiryState, waitingOn, nextActions, quoteTotals,
  validUntilProblem, slotProblems, demoOffered, toRequisitionLines,
  type Enquiry, type EnquiryLine, type EnquiryStatus, type EnquiryType, type Role,
} from './enquiries'

const TODAY = '2026-11-05'

function enq(over: Partial<Enquiry> = {}): Enquiry {
  return {
    id: 'ENQ-1', type: 'quote', account_id: 'A', raised_by: 'U', partner_id: 'P1', subject: 's',
    status: 'submitted', currency: 'INR', needed_by: null, valid_until: null, format: null,
    attendees: null, contact_pref: null, decline_reason: null,
    created_at: '2026-11-01T00:00:00Z', updated_at: '2026-11-01T00:00:00Z', decided_at: null,
    ...over,
  }
}
function line(over: Partial<EnquiryLine> = {}): EnquiryLine {
  return {
    id: 'L1', enquiry_id: 'ENQ-1', product_id: 'p1', name: 'Thing', partner_id: 'P1',
    quantity: 2, target_unit_price: null, quoted_unit_price: 10, sort_order: 0, ...over,
  }
}
const quoted = (valid_until: string | null) => enq({ status: 'quoted', valid_until })

describe('routeTo', () => {
  it('routes to the one partner', () => {
    expect(routeTo([{ partner_id: 'P1' }, { partner_id: 'P1' }])).toBe('P1')
    expect(routeTo([{ partner_id: 'P1' }])).toBe('P1')
  })
  it('goes to the desk for two partners, a null partner, or no lines', () => {
    expect(routeTo([{ partner_id: 'P1' }, { partner_id: 'P2' }])).toBeNull()
    expect(routeTo([{ partner_id: 'P1' }, { partner_id: null }])).toBeNull()
    expect(routeTo([{ partner_id: null }])).toBeNull()
    expect(routeTo([])).toBeNull()
  })
})

describe('canTransition', () => {
  const t = canTransition
  it('quote: the responder quotes, declines and re-quotes', () => {
    expect(t('quote', 'submitted', 'quoted', 'responder')).toBe(true)
    expect(t('quote', 'quoted', 'quoted', 'responder')).toBe(true)
    expect(t('quote', 'submitted', 'declined', 'responder')).toBe(true)
    expect(t('quote', 'quoted', 'declined', 'responder')).toBe(true)
  })
  it('quote: the buyer accepts, declines and withdraws', () => {
    expect(t('quote', 'quoted', 'accepted', 'buyer')).toBe(true)
    expect(t('quote', 'quoted', 'declined', 'buyer')).toBe(true)
    expect(t('quote', 'submitted', 'withdrawn', 'buyer')).toBe(true)
    expect(t('quote', 'quoted', 'withdrawn', 'buyer')).toBe(true)
  })
  it('quote: roles cannot do each other\'s moves', () => {
    expect(t('quote', 'submitted', 'quoted', 'buyer')).toBe(false)
    expect(t('quote', 'quoted', 'accepted', 'responder')).toBe(false)
    expect(t('quote', 'submitted', 'accepted', 'buyer')).toBe(false)
    expect(t('quote', 'submitted', 'declined', 'buyer')).toBe(false)
    expect(t('quote', 'submitted', 'withdrawn', 'responder')).toBe(false)
    expect(t('quote', 'quoted', 'quoted', 'buyer')).toBe(false)
    expect(t('quote', 'submitted', 'submitted', 'responder')).toBe(false)
  })
  it('demo table', () => {
    expect(t('demo', 'requested', 'scheduled', 'responder')).toBe(true)
    expect(t('demo', 'requested', 'declined', 'responder')).toBe(true)
    expect(t('demo', 'scheduled', 'declined', 'responder')).toBe(true)
    expect(t('demo', 'requested', 'withdrawn', 'buyer')).toBe(true)
    expect(t('demo', 'scheduled', 'withdrawn', 'buyer')).toBe(true)
    expect(t('demo', 'scheduled', 'done', 'responder')).toBe(true)
    expect(t('demo', 'requested', 'scheduled', 'buyer')).toBe(false)
    expect(t('demo', 'scheduled', 'done', 'buyer')).toBe(false)
    expect(t('demo', 'requested', 'done', 'responder')).toBe(false)
    expect(t('demo', 'requested', 'withdrawn', 'responder')).toBe(false)
    expect(t('demo', 'scheduled', 'declined', 'buyer')).toBe(false)
  })
  it('sales table', () => {
    expect(t('sales', 'open', 'answered', 'responder')).toBe(true)
    expect(t('sales', 'answered', 'open', 'buyer')).toBe(true)
    expect(t('sales', 'open', 'closed', 'buyer')).toBe(true)
    expect(t('sales', 'answered', 'closed', 'responder')).toBe(true)
    expect(t('sales', 'open', 'closed', 'operator')).toBe(true)
    expect(t('sales', 'open', 'answered', 'buyer')).toBe(false)
    expect(t('sales', 'answered', 'open', 'responder')).toBe(false)
  })
  it('the operator can do what a responder does', () => {
    expect(t('quote', 'submitted', 'quoted', 'operator')).toBe(true)
    expect(t('quote', 'quoted', 'accepted', 'operator')).toBe(false)
    expect(t('demo', 'requested', 'scheduled', 'operator')).toBe(true)
  })
  it('nobody leaves a terminal status, and a foreign status pairs with no type', () => {
    const terminals: [EnquiryType, EnquiryStatus][] = [
      ['quote', 'accepted'], ['quote', 'declined'], ['quote', 'withdrawn'],
      ['demo', 'done'], ['demo', 'declined'], ['demo', 'withdrawn'], ['sales', 'closed'],
    ]
    const all: EnquiryStatus[] = ['submitted', 'quoted', 'accepted', 'declined', 'withdrawn', 'requested', 'scheduled', 'done', 'open', 'answered', 'closed']
    const roles: Role[] = ['buyer', 'responder', 'operator']
    for (const [ty, from] of terminals) for (const to of all) for (const r of roles) {
      expect(t(ty, from, to, r), `${ty} ${from}->${to} ${r}`).toBe(false)
    }
    expect(t('sales', 'open', 'quoted', 'responder')).toBe(false)
    expect(t('quote', 'open', 'closed', 'buyer')).toBe(false)
  })
})

describe('expiry', () => {
  it('a quoted quote past valid_until is expired; today is not', () => {
    expect(isExpired(quoted('2026-11-04'), TODAY)).toBe(true)
    expect(isExpired(quoted('2026-11-05'), TODAY)).toBe(false)
    expect(isExpired(quoted('2026-11-06'), TODAY)).toBe(false)
    expect(enquiryState(quoted('2026-11-04'), TODAY)).toBe('expired')
    expect(enquiryState(quoted('2026-11-05'), TODAY)).toBe('quoted')
  })
  it('nothing else expires', () => {
    expect(isExpired(enq({ status: 'accepted', valid_until: '2020-01-01' }), TODAY)).toBe(false)
    expect(isExpired(enq({ status: 'submitted', valid_until: '2020-01-01' }), TODAY)).toBe(false)
    expect(isExpired(enq({ type: 'demo', status: 'scheduled', valid_until: '2020-01-01' }), TODAY)).toBe(false)
    expect(isExpired(quoted(null), TODAY)).toBe(false)
    expect(enquiryState(enq({ type: 'sales', status: 'open' }), TODAY)).toBe('open')
  })
})

describe('waitingOn', () => {
  it('follows the status', () => {
    expect(waitingOn(enq({ status: 'submitted' }), TODAY)).toBe('responder')
    expect(waitingOn(quoted('2026-12-01'), TODAY)).toBe('buyer')
    expect(waitingOn(quoted('2026-11-01'), TODAY)).toBe('responder')
    expect(waitingOn(enq({ type: 'demo', status: 'requested' }), TODAY)).toBe('responder')
    expect(waitingOn(enq({ type: 'demo', status: 'scheduled' }), TODAY)).toBe('nobody')
    expect(waitingOn(enq({ type: 'sales', status: 'open' }), TODAY)).toBe('responder')
    expect(waitingOn(enq({ type: 'sales', status: 'answered' }), TODAY)).toBe('buyer')
  })
  it('nobody once terminal', () => {
    for (const [type, status] of [['quote', 'accepted'], ['quote', 'declined'], ['quote', 'withdrawn'], ['demo', 'done'], ['demo', 'declined'], ['demo', 'withdrawn'], ['sales', 'closed']] as const) {
      expect(waitingOn(enq({ type, status }), TODAY)).toBe('nobody')
    }
  })
})

describe('nextActions', () => {
  it('buyer on a live quote accepts only with can_raise', () => {
    const q = quoted('2026-12-01')
    expect(nextActions(q, 'buyer', TODAY, { canRaise: true })).toEqual(['accept', 'decline', 'withdraw', 'reply'])
    const without = nextActions(q, 'buyer', TODAY)
    expect(without).toEqual(['withdraw', 'reply'])
    expect(without).not.toContain('accept')
  })
  it('buyer cannot accept an expired quote', () => {
    const a = nextActions(quoted('2026-11-01'), 'buyer', TODAY, { canRaise: true })
    expect(a).not.toContain('accept')
    expect(a).toContain('withdraw')
  })
  it('responder: quote/decline/reply on submitted; requote on quoted and expired', () => {
    expect(nextActions(enq(), 'responder', TODAY)).toEqual(['quote', 'decline', 'reply'])
    expect(nextActions(quoted('2026-12-01'), 'responder', TODAY)).toEqual(['requote', 'decline', 'reply'])
    expect(nextActions(quoted('2026-11-01'), 'responder', TODAY)).toContain('requote')
  })
  it('demo and sales actions', () => {
    const req = enq({ type: 'demo', status: 'requested' })
    expect(nextActions(req, 'responder', TODAY)).toEqual(['confirm-slot', 'propose-slot', 'decline', 'reply'])
    expect(nextActions(req, 'buyer', TODAY)).toEqual(['withdraw', 'reply'])
    const sch = enq({ type: 'demo', status: 'scheduled' })
    expect(nextActions(sch, 'responder', TODAY)).toEqual(['mark-done', 'decline', 'reply'])
    expect(nextActions(sch, 'buyer', TODAY)).toEqual(['withdraw', 'reply'])
    const open = enq({ type: 'sales', status: 'open', partner_id: null })
    expect(nextActions(open, 'buyer', TODAY)).toEqual(['reply', 'close'])
    expect(nextActions(open, 'responder', TODAY)).toEqual(['reply', 'close'])
  })
  it('terminal enquiries offer nothing, to anyone', () => {
    for (const e of [enq({ status: 'accepted' }), enq({ type: 'demo', status: 'done' }), enq({ type: 'sales', status: 'closed' })]) {
      for (const r of ['buyer', 'responder', 'operator'] as Role[]) {
        expect(nextActions(e, r, TODAY, { canRaise: true, isDesk: true })).toEqual([])
      }
    }
  })
  it('operator: on a desk row acts as responder plus reassign; otherwise reassign and reply', () => {
    const desk = enq({ partner_id: null })
    expect(nextActions(desk, 'operator', TODAY, { isDesk: true })).toEqual(['quote', 'decline', 'reply', 'reassign'])
    expect(nextActions(enq(), 'operator', TODAY, { isDesk: false })).toEqual(['reassign', 'reply'])
    expect(nextActions(enq(), 'operator', TODAY)).toEqual(['reassign', 'reply'])
  })
})

describe('quoteTotals', () => {
  it('sums priced lines to two decimals', () => {
    const r = quoteTotals([line({ id: 'a', quantity: 3, quoted_unit_price: 0.1 }), line({ id: 'b', quantity: 2, quoted_unit_price: 19.995 })])
    expect(r).not.toBeNull()
    expect(r!.lines[0]).toEqual({ id: 'a', total: 0.3 })
    expect(r!.lines[1].total).toBeCloseTo(39.99, 2)
    expect(r!.total).toBeCloseTo(40.29, 2)
    expect(Number.isInteger(Math.round(r!.total * 100))).toBe(true)
    expect(r!.total).toBe(Math.round(r!.total * 100) / 100)
  })
  it('is null while any line is unpriced, or there are none', () => {
    expect(quoteTotals([line(), line({ id: 'b', quoted_unit_price: null })])).toBeNull()
    expect(quoteTotals([])).toBeNull()
  })
})

describe('validUntilProblem', () => {
  it('accepts 1 to 90 days ahead', () => {
    expect(validUntilProblem('2026-11-06', TODAY)).toBeNull()
    expect(validUntilProblem('2027-02-03', TODAY)).toBeNull() // +90
  })
  it('refuses today, the past, +91 and nonsense', () => {
    expect(validUntilProblem('2026-11-05', TODAY)).not.toBeNull()
    expect(validUntilProblem('2026-10-01', TODAY)).not.toBeNull()
    expect(validUntilProblem('2027-02-04', TODAY)).not.toBeNull() // +91
    expect(validUntilProblem('', TODAY)).not.toBeNull()
    expect(validUntilProblem('soon', TODAY)).not.toBeNull()
  })
})

describe('slotProblems', () => {
  const now = '2026-11-05T10:00:00Z'
  const f = (n: number, confirmed = false) => ({ starts_at: `2026-11-${10 + n}T09:00:00Z`, confirmed })
  it('needs one to three future slots', () => {
    expect(slotProblems([], now)).not.toBeNull()
    expect(slotProblems([f(0), f(1), f(2), f(3)], now)).not.toBeNull()
    expect(slotProblems([f(0)], now)).toBeNull()
    expect(slotProblems([f(0), f(1), f(2)], now)).toBeNull()
  })
  it('refuses a past slot', () => {
    expect(slotProblems([{ starts_at: '2026-11-05T09:00:00Z', confirmed: false }], now)).not.toBeNull()
    expect(slotProblems([f(0), { starts_at: '2026-10-01T09:00:00Z', confirmed: false }], now)).not.toBeNull()
  })
  it('refuses two confirmed', () => {
    expect(slotProblems([f(0, true), f(1, true)], now)).not.toBeNull()
    expect(slotProblems([f(0, true), f(1)], now)).toBeNull()
  })
})

describe('demoOffered', () => {
  it('is offered for subscriptions and for iot/security one-offs', () => {
    expect(demoOffered({ model: 'oneoff', category_id: 'device' })).toBe(false)
    expect(demoOffered({ model: 'monthly', category_id: 'device' })).toBe(true)
    expect(demoOffered({ model: 'oneoff', category_id: 'iot' })).toBe(true)
    expect(demoOffered({ model: 'oneoff', category_id: 'security' })).toBe(true)
  })
})

describe('toRequisitionLines', () => {
  const future = '2999-01-01'
  const accepted = enq({ status: 'accepted', valid_until: future })
  it('turns an accepted quote into priced lines carrying quote_line_id', () => {
    const out = toRequisitionLines(accepted, [line({ id: 'L1', quoted_unit_price: 12.5, quantity: 4 })])
    expect(out).toEqual([{ product_id: 'p1', name: 'Thing', partner_id: 'P1', quantity: 4, unit_price: 12.5, quote_line_id: 'L1' }])
  })
  it('refuses a quote that is not accepted', () => {
    expect(() => toRequisitionLines(enq({ status: 'quoted', valid_until: future }), [line()])).toThrow()
  })
  it('refuses an expired quote', () => {
    expect(() => toRequisitionLines(enq({ status: 'quoted', valid_until: '2020-01-01' }), [line()])).toThrow()
    expect(() => toRequisitionLines(enq({ status: 'accepted', valid_until: '2020-01-01' }), [line()])).toThrow()
  })
  it('refuses an unpriced line, a non-quote, or no lines', () => {
    expect(() => toRequisitionLines(accepted, [line(), line({ id: 'b', quoted_unit_price: null })])).toThrow()
    expect(() => toRequisitionLines(enq({ type: 'demo', status: 'done' }), [line()])).toThrow()
    expect(() => toRequisitionLines(accepted, [])).toThrow()
  })
})
