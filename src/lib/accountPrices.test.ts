import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  standingOf, overlaps, inForce, effectivePrice, shelfPrice, priceDraftProblems, replacedBy, endOn,
  lineContract, needWithRules, offContractNote, offContractReasonProblem, showsOffContract,
  orderShelf, preferenceOf, ruleSummary, promotable, DEFAULT_RULES,
  type AccountPrice, type Preference, type PriceDraft, type OffContractRule, type QuoteLineForPromotion,
} from './accountPrices'
import type { Need } from './enterprise'

const T = '2026-11-12'
const ap = (o: Partial<AccountPrice> = {}): AccountPrice => ({
  id: 'AP-1', account_id: 'A', product_id: 'P', currency: 'INR', unit_price: 100,
  starts_on: '2026-11-01', ends_on: null, source: 'negotiated', quote_line_id: null, quote_ref: null,
  note: null, set_by: 'x', set_at: '', ended_by: null, ended_at: null, end_reason: null, ...o,
})
const key = { account_id: 'A', product_id: 'P', currency: 'INR' }

describe('standingOf', () => {
  it('classifies', () => {
    expect(standingOf({ starts_on: '2026-11-13', ends_on: null }, T)).toBe('scheduled')
    expect(standingOf({ starts_on: T, ends_on: null }, T)).toBe('in force')
    expect(standingOf({ starts_on: '2026-11-01', ends_on: T }, T)).toBe('in force')
    expect(standingOf({ starts_on: '2026-11-01', ends_on: '2026-11-11' }, T)).toBe('ended')
    expect(standingOf({ starts_on: '2026-11-20', ends_on: '2026-11-19' }, T)).toBe('withdrawn')
    expect(standingOf({ starts_on: '2026-11-01', ends_on: '2026-10-31' }, T)).toBe('withdrawn')
  })
})

describe('overlaps', () => {
  it('works on inclusive days', () => {
    expect(overlaps({ starts_on: '2026-11-01', ends_on: '2026-11-10' }, { starts_on: '2026-11-10', ends_on: null })).toBe(true)
    expect(overlaps({ starts_on: '2026-11-01', ends_on: '2026-11-09' }, { starts_on: '2026-11-10', ends_on: null })).toBe(false)
    expect(overlaps({ starts_on: '2026-11-01', ends_on: null }, { starts_on: '2027-01-01', ends_on: null })).toBe(true)
    expect(overlaps({ starts_on: '2026-11-05', ends_on: '2026-11-04' }, { starts_on: '2026-11-01', ends_on: null })).toBe(false)
  })
})

describe('inForce', () => {
  it('picks only the key in force', () => {
    const a = ap({ id: 'a' })
    const other = ap({ id: 'o', account_id: 'B' })
    const eur = ap({ id: 'e', currency: 'EUR' })
    const later = ap({ id: 'l', starts_on: '2026-11-13' })
    expect(inForce([other, eur, later, a], key, T)?.id).toBe('a')
    expect(inForce([other, eur, later], key, T)).toBeNull()
  })
})

describe('effectivePrice', () => {
  it('is least(published, greatest(account, floor))', () => {
    expect(effectivePrice(100, 50, null)).toBe(100)
    expect(effectivePrice(100, 50, 80)).toBe(80)
    expect(effectivePrice(100, 90, 80)).toBe(90)
    expect(effectivePrice(70, 50, 80)).toBe(70)
    expect(effectivePrice(100, null, 0)).toBe(0)
    expect(effectivePrice(100, null, 80)).toBe(80)
    expect(effectivePrice(199.995, null, null)).toBe(200)
    expect(effectivePrice(300, null, 199.995)).toBe(200)
  })
})

describe('shelfPrice', () => {
  it('reports saving and clamp', () => {
    expect(shelfPrice(100, 50, null)).toMatchObject({ price: 100, on_contract: false, saving: 0, clamp: 'none', account_price_id: null })
    expect(shelfPrice(100, 50, ap({ unit_price: 80 }))).toMatchObject({ price: 80, on_contract: true, saving: 20, clamp: 'none', account_price_id: 'AP-1' })
    expect(shelfPrice(100, 90, ap({ unit_price: 80 }))).toMatchObject({ price: 90, saving: 10, clamp: 'floor' })
    expect(shelfPrice(70, 50, ap({ unit_price: 80 }))).toMatchObject({ price: 70, on_contract: true, saving: 0, clamp: 'published' })
  })
})

describe('priceDraftProblems', () => {
  const d: PriceDraft = { account_id: 'A', product_id: 'P', currency: 'INR', unit_price: 80, starts_on: T, ends_on: null, note: '' }
  const ctx = { today: T, published: 100, floor: 50, currencies: ['INR'], businessListing: true, company: 'SmartBuild Ltd', market: 'IN', productName: 'X' }
  it('accepts a good draft', () => expect(priceDraftProblems(d, ctx)).toEqual({}))
  it('says the database sentences', () => {
    expect(priceDraftProblems({ ...d, unit_price: 0 }, ctx).unit_price).toBeTruthy()
    expect(priceDraftProblems({ ...d, unit_price: 100.5 }, ctx).unit_price)
      .toBe('That is above the published price of INR 100.00 for X. An account price is at or below it.')
    expect(priceDraftProblems({ ...d, unit_price: 40 }, ctx).unit_price)
      .toBe('That is below the floor of INR 50.00 that the seller of X agreed. An account price never goes under it.')
    expect(priceDraftProblems({ ...d, starts_on: '2026-11-11' }, ctx).starts_on)
      .toBe('A price starts today or later. Requisitions already raised were checked against the price that applied then.')
    expect(priceDraftProblems({ ...d, ends_on: '2026-11-11' }, ctx).ends_on)
      .toBe('A new price has to run for at least one day: it ends before it starts.')
    expect(priceDraftProblems({ ...d, currency: 'USD' }, ctx).currency)
      .toBe('SmartBuild Ltd buys in IN, which does not trade in USD.')
    expect(priceDraftProblems(d, { ...ctx, businessListing: false }).product_id)
      .toBe('X is not sold to business accounts, so it has no account price.')
    expect(priceDraftProblems(d, { ...ctx, published: null }).product_id)
      .toBe('X has no published price in INR, so there is nothing to agree a price against.')
    expect(priceDraftProblems({ ...d, note: 'x'.repeat(301) }, ctx).note).toBeTruthy()
    expect(priceDraftProblems({ ...d, note: 'x'.repeat(300) }, ctx).note).toBeUndefined()
  })
})

describe('replacedBy', () => {
  const d: PriceDraft = { account_id: 'A', product_id: 'P', currency: 'INR', unit_price: 80, starts_on: '2026-11-20', ends_on: '2026-11-30', note: '' }
  it('ends an in-force row the day before', () => {
    expect(replacedBy([ap({ id: 'a' })], d, T)).toEqual([{ id: 'a', ends_on: '2026-11-19', withdrawn: false }])
  })
  it('withdraws a scheduled row inside the window', () => {
    expect(replacedBy([ap({ id: 's', starts_on: '2026-11-25' })], d, T)).toEqual([{ id: 's', ends_on: '2026-11-24', withdrawn: true }])
  })
  it('leaves a scheduled row after a bounded draft, and ended or withdrawn rows', () => {
    expect(replacedBy([
      ap({ id: 'after', starts_on: '2026-12-05' }),
      ap({ id: 'ended', starts_on: '2026-10-01', ends_on: '2026-11-10' }),
      ap({ id: 'wd', starts_on: '2026-11-25', ends_on: '2026-11-24' }),
      ap({ id: 'other', product_id: 'Q' }),
    ], d, T)).toEqual([])
  })
})

describe('endOn', () => {
  it('is max(yesterday, starts_on - 1)', () => {
    expect(endOn({ starts_on: '2026-11-01' }, T)).toBe('2026-11-11')
    expect(endOn({ starts_on: T }, T)).toBe('2026-11-11')
    expect(endOn({ starts_on: '2026-11-19' }, T)).toBe('2026-11-18')
  })
})

describe('lineContract', () => {
  const prices = [ap({ id: 'in' })]
  it('is not off for quoted, bundle or product-less lines', () => {
    expect(lineContract({ product_id: 'Z', quote_line_id: 'q' }, prices, 'A', 'INR', T)).toEqual({ off: false, account_price_id: null })
    expect(lineContract({ product_id: 'Z', bundle_selection_id: 'b' }, prices, 'A', 'INR', T)).toEqual({ off: false, account_price_id: null })
    expect(lineContract({ product_id: null }, prices, 'A', 'INR', T)).toEqual({ off: false, account_price_id: null })
  })
  it('follows the price in force', () => {
    expect(lineContract({ product_id: 'P' }, prices, 'A', 'INR', T)).toEqual({ off: false, account_price_id: 'in' })
    expect(lineContract({ product_id: 'Z' }, prices, 'A', 'INR', T)).toEqual({ off: true, account_price_id: null })
  })
})

describe('needWithRules', () => {
  const needs: Need[] = ['none', 'finance', 'it', 'both']
  const rules: OffContractRule[] = ['allow', 'reason', 'approval']
  it('covers every combination', () => {
    for (const n of needs) for (const off of [false, true]) for (const r of rules) {
      const expected: Need = r === 'approval' && off ? ({ none: 'finance', it: 'both', finance: 'finance', both: 'both' } as const)[n] : n
      expect(needWithRules(n, off, r)).toBe(expected)
    }
  })
})

describe('offContractNote / reason / showsOffContract', () => {
  it('notes', () => {
    expect(offContractNote('allow', 3)).toBeNull()
    expect(offContractNote('reason', 0)).toBeNull()
    expect(offContractNote('reason', 1)).toContain('1 line is')
    expect(offContractNote('approval', 2)).toContain('2 lines are')
    expect(offContractNote('approval', 2)).toContain('finance approval')
  })
  it('reason bounds', () => {
    expect(offContractReasonProblem('abcd')).not.toBeNull()
    expect(offContractReasonProblem('abcde')).toBeNull()
    expect(offContractReasonProblem('x'.repeat(300))).toBeNull()
    expect(offContractReasonProblem('x'.repeat(301))).not.toBeNull()
    expect(offContractReasonProblem('      ')).not.toBeNull()
    expect(offContractReasonProblem(null)).not.toBeNull()
  })
  it('shows', () => {
    expect(showsOffContract({ off_contract: 'allow' }, [], T)).toBe(false)
    expect(showsOffContract({ off_contract: 'allow' }, [ap({ starts_on: '2026-12-01' })], T)).toBe(false)
    expect(showsOffContract({ off_contract: 'allow' }, [ap()], T)).toBe(true)
    expect(showsOffContract({ off_contract: 'reason' }, [], T)).toBe(true)
  })
  it('defaults to allow', () => expect(DEFAULT_RULES('A').off_contract).toBe('allow'))
})

describe('orderShelf', () => {
  const pref = (o: Partial<Preference>): Preference => ({ id: 'x', account_id: 'A', kind: 'seller', partner_id: null, product_id: null, note: null, added_by: '', added_on: '', ...o })
  const ls = [
    { id: 'l1', partner_id: 's1' }, { id: 'l2', partner_id: 's2' }, { id: 'l3', partner_id: 's1' },
    { id: 'l4', partner_id: 's3' }, { id: 'l5', partner_id: 's2' },
  ]
  it('orders product, seller, rest, stable', () => {
    const prefs = [pref({ kind: 'seller', partner_id: 's2' }), pref({ kind: 'product', product_id: 'l4' })]
    expect(orderShelf(ls, prefs).map(l => l.id)).toEqual(['l4', 'l2', 'l5', 'l1', 'l3'])
    expect(preferenceOf(ls[3], prefs)).toBe('product')
    expect(preferenceOf(ls[1], prefs)).toBe('seller')
    expect(preferenceOf(ls[0], prefs)).toBeNull()
  })
  it('leaves order alone without preferences', () => expect(orderShelf(ls, [])).toEqual(ls))
})

describe('ruleSummary / promotable', () => {
  it('has three distinct titles', () => {
    expect(new Set((['allow', 'reason', 'approval'] as const).map(r => ruleSummary(r).title)).size).toBe(3)
  })
  const line = (o: Partial<QuoteLineForPromotion>): QuoteLineForPromotion =>
    ({ id: 'L', enquiry_id: 'E', account_id: 'A', status: 'accepted', currency: 'INR', product_id: 'P', name: 'X', quoted_unit_price: 100, ...o })
  it('filters', () => {
    const prices = [ap({ unit_price: 100 })]
    expect(promotable([
      line({ id: 'unaccepted', status: 'sent' }),
      line({ id: 'unpriced', quoted_unit_price: null }),
      line({ id: 'same' }),
      line({ id: 'different', quoted_unit_price: 90 }),
    ], prices, T).map(l => l.id)).toEqual(['different'])
  })
})

describe('purity', () => {
  it('imports no supabase', () => {
    expect(readFileSync(resolve(__dirname, 'accountPrices.ts'), 'utf8')).not.toMatch(/from\s+['"][^'"]*supabase/i)
  })
})
