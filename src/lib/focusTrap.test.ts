import { describe, it, expect } from 'vitest'
import { nextFocusIndex } from './focusTrap'

describe('nextFocusIndex', () => {
  it('Tab moves forward', () => expect(nextFocusIndex(0, 3, false)).toBe(1))
  it('Tab from the last wraps to the first', () => expect(nextFocusIndex(2, 3, false)).toBe(0))
  it('Shift+Tab from the first wraps to the last', () => expect(nextFocusIndex(0, 3, true)).toBe(2))
  it('Tab from outside lands on the first', () => expect(nextFocusIndex(-1, 3, false)).toBe(0))
  it('Shift+Tab from outside lands on the last', () => expect(nextFocusIndex(-1, 3, true)).toBe(2))
  it('nothing focusable gives -1', () => expect(nextFocusIndex(0, 0, false)).toBe(-1))
  it('a single element stays put', () => expect(nextFocusIndex(0, 1, true)).toBe(0))
})
