import { describe, it, expect } from 'vitest'
import { tabKeyTarget } from './tabKeys'

describe('tabKeyTarget', () => {
  it('ArrowRight moves to the next tab', () => expect(tabKeyTarget('ArrowRight', 0, 9)).toBe(1))
  it('ArrowDown moves to the next tab', () => expect(tabKeyTarget('ArrowDown', 0, 9)).toBe(1))
  it('ArrowRight from the last wraps', () => expect(tabKeyTarget('ArrowRight', 8, 9)).toBe(0))
  it('ArrowLeft from the first wraps', () => expect(tabKeyTarget('ArrowLeft', 0, 9)).toBe(8))
  it('ArrowUp moves to the previous tab', () => expect(tabKeyTarget('ArrowUp', 3, 9)).toBe(2))
  it('Home goes to the first', () => expect(tabKeyTarget('Home', 5, 9)).toBe(0))
  it('End goes to the last', () => expect(tabKeyTarget('End', 2, 9)).toBe(8))
  it('a letter is not a tablist key', () => expect(tabKeyTarget('a', 2, 9)).toBeNull())
  it('Enter is not a tablist key', () => expect(tabKeyTarget('Enter', 2, 9)).toBeNull())
})
