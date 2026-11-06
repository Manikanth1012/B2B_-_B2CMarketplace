import { describe, it, expect } from 'vitest'
import { draftProblems, hasProblems } from './templateDraftProblems'
import type { ProblemDraft, ProblemSlot } from './templateDraftProblems'

const slot = (key: string, o: Partial<ProblemSlot> = {}): ProblemSlot => ({
  key, label: key, min_pick: 1, max_pick: 1, qty_min: 1, qty_max: 3, qty_default: 2,
  options: [{ product_id: `${key}-a`, is_default: true }], ...o,
})
const draft = (o: Partial<ProblemDraft> = {}): ProblemDraft => ({
  name: 'Kit', discount_pct: 5, audiences: ['enterprise'], slots: [slot('a'), slot('b')], ...o,
})

describe('draftProblems', () => {
  it('accepts a sound draft', () => expect(hasProblems(draftProblems(draft(), 10))).toBe(false))
  it('checks the discount against the rule', () => {
    expect(draftProblems(draft({ discount_pct: 0 }), 10).bundle.discount).toMatch(/above 0/)
    expect(draftProblems(draft({ discount_pct: 11 }), 10).bundle.discount).toMatch(/at most 10%/)
  })
  it('checks pick and quantity limits', () => {
    const p = draftProblems(draft({ slots: [slot('a', { min_pick: 3, max_pick: 2, qty_min: 0, qty_default: 9 })] }), 10).slots.a
    expect(p.min_pick).toBeTruthy(); expect(p.qty_min).toBeTruthy(); expect(p.qty_default).toMatch(/above/)
    expect(draftProblems(draft({ slots: [slot('a', { max_pick: 0, min_pick: 0 })] }), 10).slots.a.max_pick).toBeTruthy()
  })
  it('wants a starting choice in range for a required part, and none needed when optional', () => {
    const two = [{ product_id: 'x', is_default: false }, { product_id: 'y', is_default: false }]
    expect(draftProblems(draft({ slots: [slot('a', { options: two })] }), 10).slots.a.options).toMatch(/exactly one/)
    expect(hasProblems(draftProblems(draft({ slots: [slot('a', { min_pick: 0, options: two })] }), 10))).toBe(false)
  })
  it('refuses a product in two parts and a part with no options', () => {
    const dup = draft({ slots: [slot('a', { options: [{ product_id: 'x', is_default: true }] }), slot('b', { options: [{ product_id: 'x', is_default: true }] })] })
    expect(draftProblems(dup, 10).slots.b.options).toMatch(/one part only/)
    expect(draftProblems(draft({ slots: [slot('a', { options: [] })] }), 10).slots.a.options).toMatch(/at least one/)
  })
})
