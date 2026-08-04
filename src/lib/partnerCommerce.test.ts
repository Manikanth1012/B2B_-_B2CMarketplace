import { describe, it, expect } from 'vitest'
import {
  canListIn, approvedCategories, rateAt, nextTier, commissionOn, orderedPlans,
  listingState, listingBreakdown,
  moneySplit, planSchedule,
  type PartnerCategory, type CommissionPlan, type ListingRow,
} from './partnerCommerce'

const NAMES: Record<string, string> = {
  consumer: 'Consumer', partner: 'Partner', iot: 'IoT',
  security: 'Security', device: 'Devices', content: 'Digital Content',
}
const name = (id: string) => NAMES[id] ?? id
const ORDER = Object.keys(NAMES).map((id, i) => ({ id, sort_order: i + 1 }))

const approval = (category_id: string, approved = true): PartnerCategory => ({
  partner_id: 'PTR-1004', category_id,
  approved_at: approved ? '2024-09-27' : null,
  approved_by: approved ? 'Lena Fischer' : null,
})

/* The demo partner's real plan, so the tests fail if the seed and the arithmetic
   drift apart. */
const IOT: CommissionPlan = {
  id: 'CP-IOT-STD', name: 'IoT — hardware + connectivity', category_id: 'iot',
  model: 'Split: hardware commission, connectivity wholesale', base_rate: 11,
  tiers: [{ from: 0, rate: 11 }, { from: 200000, rate: 9 }],
  fees: 'Payment processing 1.9% + $0.20', payment_fee_pct: 1.9, payment_fee_flat: 0.20,
  cycle: 'Monthly, net 30', hold: '14 days', sort_order: 5,
}

/* A reseller's ladder runs the other way — the discount rises with volume. */
const RESELL: CommissionPlan = {
  ...IOT, id: 'CP-RESELL-T3', name: 'Reseller — tier 3 (entry)', category_id: 'partner',
  model: 'Wholesale discount off list', base_rate: 10,
  tiers: [{ from: 0, rate: 10 }, { from: 60000, rate: 12 }], sort_order: 8,
}

describe('canListIn', () => {
  const approvals = [approval('iot'), approval('device')]

  it('allows a category the seller was approved for', () => {
    expect(canListIn('iot', approvals, name).ok).toBe(true)
  })

  it('refuses one they were not, and names what they may sell instead', () => {
    const v = canListIn('security', approvals, name)
    expect(v.ok).toBe(false)
    if (!v.ok) {
      expect(v.reason).toMatch(/not approved to sell in Security/)
      expect(v.reason).toMatch(/IoT and Devices/)
    }
  })

  /* Applied for is not approved. The difference is the whole gate. */
  it('refuses a category that is applied for but not yet approved', () => {
    const v = canListIn('device', [approval('iot'), approval('device', false)], name)
    expect(v.ok).toBe(false)
    if (!v.ok) expect(v.reason).toMatch(/not approved yet/)
  })

  it('says something useful to a seller approved for nothing at all', () => {
    const v = canListIn('iot', [approval('iot', false)], name)
    expect(v.ok).toBe(false)
    if (!v.ok) expect(v.reason).toMatch(/when your application clears/)
  })
})

describe('approvedCategories', () => {
  it('returns only approved ones, in the marketplace order', () => {
    const rows = [approval('content'), approval('iot'), approval('device', false)]
    expect(approvedCategories(rows, ORDER)).toEqual(['iot', 'content'])
  })
})

describe('rateAt', () => {
  it('uses the opening rate below the first threshold', () => {
    expect(rateAt(IOT, 0)).toBe(11)
    expect(rateAt(IOT, 199_999)).toBe(11)
  })

  it('steps at the threshold itself, not past it', () => {
    expect(rateAt(IOT, 200_000)).toBe(9)
  })

  /* Reading the ladder rather than assuming which way it runs. */
  it('handles a ladder that rises with volume', () => {
    expect(rateAt(RESELL, 0)).toBe(10)
    expect(rateAt(RESELL, 60_000)).toBe(12)
  })

  it('resolves the same way whatever order the tiers are stored in', () => {
    const shuffled = { ...IOT, tiers: [{ from: 200000, rate: 9 }, { from: 0, rate: 11 }] }
    expect(rateAt(shuffled, 250_000)).toBe(9)
  })

  it('falls back to the base rate for a plan with no ladder', () => {
    expect(rateAt({ ...IOT, tiers: [] }, 999_999)).toBe(11)
  })
})

describe('nextTier', () => {
  it('names the step ahead and what it takes to reach it', () => {
    expect(nextTier(IOT, 150_000)).toEqual({ tier: { from: 200000, rate: 9 }, toGo: 50_000 })
  })

  it('says nothing once the seller is on the last step', () => {
    expect(nextTier(IOT, 200_000)).toBeNull()
  })
})

describe('commissionOn', () => {
  it('charges at the rate the volume earns', () => {
    expect(commissionOn(IOT, 1000, 0)).toBe(110)
    expect(commissionOn(IOT, 1000, 200_000)).toBe(90)
  })

  it('rounds to the cent rather than carrying a float', () => {
    expect(commissionOn(IOT, 33.33, 0)).toBe(3.67)
  })
})

describe('orderedPlans', () => {
  it('puts plans in the marketplace order and leaves the input alone', () => {
    const input = [RESELL, IOT]
    expect(orderedPlans(input).map(p => p.id)).toEqual(['CP-IOT-STD', 'CP-RESELL-T3'])
    expect(input.map(p => p.id)).toEqual(['CP-RESELL-T3', 'CP-IOT-STD'])
  })
})

describe('listing state', () => {
  it('explains what a state means for a buyer', () => {
    expect(listingState('pending').meaning).toMatch(/not visible to buyers/i)
    expect(listingState('live').label).toBe('Live')
  })

  /* An unknown state must not silently render as one of the known ones. */
  it('passes an unrecognised state through rather than guessing', () => {
    expect(listingState('archived').label).toBe('archived')
    expect(listingState('archived').meaning).toMatch(/no description/i)
  })
})

describe('listingBreakdown', () => {
  const row = (id: string, status: string): ListingRow =>
    ({ id, name: id, category_id: 'iot', status, price: 10, stock: 'in', listed: null })

  it('counts by state, biggest group first', () => {
    const rows = [row('a', 'live'), row('b', 'pending'), row('c', 'live'), row('d', 'live')]
    expect(listingBreakdown(rows)).toEqual([
      { status: 'live', label: 'Live', count: 3 },
      { status: 'pending', label: 'In review', count: 1 },
    ])
  })

  it('is empty rather than a zero row for a seller with no listings', () => {
    expect(listingBreakdown([])).toEqual([])
  })
})

describe('where a sale’s money goes', () => {
  it('splits it on the seller’s own plan, not on a number in the markup', () => {
    /* The dashboard drew this from `1000 - 120 - 21` — 12% and 2.1% — for every
       seller. Nimbus settles at 11% on 1.9% + $0.20 and keeps $870.80. */
    const s = moneySplit(IOT, 1000, 0)
    expect(s.commissionRate).toBe(11)
    expect(s.commission).toBe(110)
    expect(s.fees).toBe(19.2)
    expect(s.keep).toBe(870.8)
  })

  it('reads the rate off the ladder, so a bigger seller is drawn differently', () => {
    const s = moneySplit(IOT, 1000, 250000)
    expect(s.commissionRate).toBe(9)
    expect(s.keep).toBe(890.8)
  })

  it('gives shares that account for the whole sale', () => {
    const s = moneySplit(IOT, 1000, 0)
    expect(+(s.commissionShare + s.feesShare + s.keepShare).toFixed(2)).toBe(100)
  })

  it('keeps the flat fee flat, because it is per order and not per pound', () => {
    /* At a small sale the 20 cents is 1% of the money and at a large one it is
       nothing. Folding it into a percentage would be wrong at both ends. */
    expect(moneySplit(IOT, 20, 0).fees).toBe(0.58)
    expect(moneySplit(IOT, 20000, 0).fees).toBe(380.2)
  })

  it('handles a plan that charges no payment fee at all', () => {
    const free: CommissionPlan = { ...IOT, payment_fee_pct: 0, payment_fee_flat: 0 }
    expect(moneySplit(free, 1000, 0).fees).toBe(0)
    expect(moneySplit(free, 1000, 0).keep).toBe(890)
  })

  it('does not divide by a sale of nothing', () => {
    expect(moneySplit(IOT, 0, 0).keepShare).toBe(0)
  })
})

describe('the schedule a seller can take away', () => {
  it('carries the terms, the ladder and where they stand on it', () => {
    const rows = planSchedule(IOT, 120000)
    const find = (field: string) => rows.find(r => r[1] === field)?.[2]
    expect(find('id')).toBe('CP-IOT-STD')
    expect(find('current_rate_pct')).toBe('11')
    expect(find('gross_to_next_tier')).toBe('80000.00')
    expect(rows.filter(r => r[0] === 'tier')).toHaveLength(2)
  })

  it('says so plainly at the top of the ladder rather than leaving a blank', () => {
    const rows = planSchedule(IOT, 400000)
    expect(rows.find(r => r[1] === 'next_tier_rate_pct')?.[2]).toMatch(/top tier/)
  })

  it('opens with a header row, so it is a spreadsheet and not a wall', () => {
    expect(planSchedule(IOT, 0)[0]).toEqual(['section', 'field', 'value'])
  })
})
