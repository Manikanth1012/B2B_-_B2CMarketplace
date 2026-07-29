import { describe, it, expect } from 'vitest'
import { nextIndex, prevIndex, shouldAdvance, SLIDE_MS } from './carousel'

const s = (index: number, count = 5, paused = false) => ({ index, count, paused })

describe('nextIndex', () => {
  it('advances', () => expect(nextIndex(s(0))).toBe(1))
  it('wraps at the end', () => expect(nextIndex(s(4))).toBe(0))
  it('handles a single slide', () => expect(nextIndex(s(0, 1))).toBe(0))
  it('returns 0 for an empty set rather than NaN', () => expect(nextIndex(s(0, 0))).toBe(0))
})

describe('prevIndex', () => {
  it('goes back', () => expect(prevIndex(s(2))).toBe(1))
  it('wraps at the start', () => expect(prevIndex(s(0))).toBe(4))
  it('returns 0 for an empty set', () => expect(prevIndex(s(0, 0))).toBe(0))
})

describe('shouldAdvance', () => {
  it('advances when running and motion is allowed', () => {
    expect(shouldAdvance(s(0), false)).toBe(true)
  })

  it('does not advance while paused — someone is reading the slide', () => {
    expect(shouldAdvance(s(0, 5, true), false)).toBe(false)
  })

  it('does not advance under reduced motion, even when unpaused', () => {
    expect(shouldAdvance(s(0), true)).toBe(false)
  })

  it('does not advance with fewer than two slides', () => {
    expect(shouldAdvance(s(0, 1), false)).toBe(false)
  })
})

describe('SLIDE_MS', () => {
  it('is a sane dwell time — long enough to read a slide', () => {
    expect(SLIDE_MS).toBeGreaterThanOrEqual(5000)
  })
})
