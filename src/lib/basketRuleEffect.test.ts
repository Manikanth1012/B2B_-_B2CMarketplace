import { describe, expect, it } from 'vitest'
import { basketRuleEffect, effectText } from './basketRuleEffect'

const NOW = new Date('2026-11-28T10:00:00Z')
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString()
const before = { pending_days: 7, abandoned_after_days: 7, clear_after_days: 90 }

describe('basketRuleEffect', () => {
  it('counts a basket exactly at the edge as cleared tonight (the night runs as of tomorrow)', () => {
    const after = { pending_days: 2, abandoned_after_days: 2, clear_after_days: 8 }
    /* Last changed 8 days ago: clearsOn = day + 9 = tomorrow, which tonight's run clears. */
    expect(basketRuleEffect([{ lastChange: daysAgo(8) }], before, after, NOW).clearedTonight).toBe(1)
    /* One day fresher is cleared the night after. */
    expect(basketRuleEffect([{ lastChange: daysAgo(7) }], before, after, NOW).clearedTonight).toBe(0)
  })
  it('says nothing moves when nothing does', () => {
    expect(effectText(basketRuleEffect([{ lastChange: daysAgo(1) }], before, before, NOW)))
      .toBe('No basket changes state, and none would be cleared tonight')
  })
})
