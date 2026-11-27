import { describe, it, expect } from 'vitest'
import {
  DEFAULT_ORDER_BANDS, DEFAULT_ACCOUNT_BANDS, HELD_FOR_BUYER, BAND_LABEL,
  orderBand, accountBand, reasonsLine, bandTone, ruleEditProblem, bandsProblem,
} from './risk'

describe('defaults', () => {
  it('seeds both band sets at 40 and 70', () => {
    expect(DEFAULT_ORDER_BANDS).toEqual({ review_at: 40, hold_at: 70 })
    expect(DEFAULT_ACCOUNT_BANDS).toEqual({ review_at: 40, hold_at: 70 })
  })
  it('words a held order for the buyer', () => {
    expect(HELD_FOR_BUYER).toBe("We're checking this order — usually within a few hours.")
  })
})

describe('bands', () => {
  it('orders: 39 low, 40 review, 69 review, 70 hold', () => {
    expect(orderBand(39, DEFAULT_ORDER_BANDS)).toBe('low')
    expect(orderBand(40, DEFAULT_ORDER_BANDS)).toBe('review')
    expect(orderBand(69, DEFAULT_ORDER_BANDS)).toBe('review')
    expect(orderBand(70, DEFAULT_ORDER_BANDS)).toBe('hold')
    expect(orderBand(-5, DEFAULT_ORDER_BANDS)).toBe('low')
  })
  it('accounts: 39 low, 40 review, 69 review, 70 high', () => {
    expect(accountBand(39, DEFAULT_ACCOUNT_BANDS)).toBe('low')
    expect(accountBand(40, DEFAULT_ACCOUNT_BANDS)).toBe('review')
    expect(accountBand(69, DEFAULT_ACCOUNT_BANDS)).toBe('review')
    expect(accountBand(70, DEFAULT_ACCOUNT_BANDS)).toBe('high')
  })
  it('follows edited bands', () => {
    expect(orderBand(25, { review_at: 20, hold_at: 30 })).toBe('review')
  })
})

describe('reasonsLine', () => {
  it('says so when nothing fired', () => {
    expect(reasonsLine([])).toBe('No rules fired')
  })
  it('lists highest first, ties by label', () => {
    expect(reasonsLine([
      { rule: 'a', label: 'First order', points: 10 },
      { rule: 'b', label: 'New account', points: 20 },
      { rule: 'c', label: 'Alpha', points: 10 },
    ])).toBe('New account +20 · Alpha +10 · First order +10')
  })
  it('shows negative points with a true minus', () => {
    expect(reasonsLine([
      { rule: 'a', label: 'Repeat buyer', points: -15 },
      { rule: 'b', label: 'New account', points: 20 },
    ])).toBe('New account +20 · Repeat buyer \u221215')
  })
  it('does not reorder its input', () => {
    const r = [{ rule: 'a', label: 'A', points: 1 }, { rule: 'b', label: 'B', points: 2 }]
    reasonsLine(r)
    expect(r[0].rule).toBe('a')
  })
})

describe('BAND_LABEL', () => {
  it('names every order and account band in words', () => {
    expect(BAND_LABEL).toEqual({ low: 'Low', review: 'Review', hold: 'Hold', high: 'High' })
  })
})

describe('bandTone', () => {
  it('maps bands to tones', () => {
    expect(bandTone('low')).toBe('success')
    expect(bandTone('review')).toBe('warning')
    expect(bandTone('hold')).toBe('danger')
    expect(bandTone('high')).toBe('danger')
  })
})

describe('ruleEditProblem', () => {
  const ok = { points: 20, threshold: 5, needsThreshold: true }
  it('accepts a good edit', () => {
    expect(ruleEditProblem(ok)).toBeNull()
    expect(ruleEditProblem({ points: -50, threshold: null, needsThreshold: false })).toBeNull()
    expect(ruleEditProblem({ points: 100, threshold: null, needsThreshold: false })).toBeNull()
    expect(ruleEditProblem({ points: 0, threshold: 0.5, needsThreshold: true })).toBeNull()
  })
  it('rejects points that are not whole or out of range', () => {
    expect(ruleEditProblem({ ...ok, points: 1.5 })).toMatch(/whole number/)
    expect(ruleEditProblem({ ...ok, points: 101 })).toMatch(/−50 and 100/)
    expect(ruleEditProblem({ ...ok, points: -51 })).toMatch(/−50 and 100/)
    expect(ruleEditProblem({ ...ok, points: NaN })).not.toBeNull()
  })
  it('needs a threshold above zero when the rule has one', () => {
    expect(ruleEditProblem({ ...ok, threshold: null })).toMatch(/threshold/i)
    expect(ruleEditProblem({ ...ok, threshold: 0 })).toMatch(/threshold/i)
    expect(ruleEditProblem({ ...ok, threshold: -3 })).toMatch(/threshold/i)
    expect(ruleEditProblem({ ...ok, threshold: Infinity })).toMatch(/threshold/i)
    expect(ruleEditProblem({ ...ok, threshold: NaN })).toMatch(/threshold/i)
  })
  it('ignores the threshold when the rule has none', () => {
    expect(ruleEditProblem({ points: 10, threshold: -9, needsThreshold: false })).toBeNull()
  })
})

describe('bandsProblem', () => {
  it('accepts the defaults and the edges', () => {
    expect(bandsProblem({ review_at: 40, hold_at: 70 })).toBeNull()
    expect(bandsProblem({ review_at: 1, hold_at: 100 })).toBeNull()
  })
  it('rejects non-whole or out-of-range numbers', () => {
    expect(bandsProblem({ review_at: 40.5, hold_at: 70 })).not.toBeNull()
    expect(bandsProblem({ review_at: 40, hold_at: 70.2 })).not.toBeNull()
    expect(bandsProblem({ review_at: 0, hold_at: 70 })).not.toBeNull()
    expect(bandsProblem({ review_at: 40, hold_at: 101 })).not.toBeNull()
    expect(bandsProblem({ review_at: NaN, hold_at: 70 })).not.toBeNull()
  })
  it('needs review below hold', () => {
    expect(bandsProblem({ review_at: 70, hold_at: 70 })).toMatch(/below/)
    expect(bandsProblem({ review_at: 80, hold_at: 70 })).toMatch(/below/)
  })
})
