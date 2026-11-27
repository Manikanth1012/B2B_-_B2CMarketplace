import { describe, expect, it } from 'vitest'
import { inLocalRange, localDay } from './localDay'

/* Built from local-time parts, so the edge holds in whatever zone the test runs
   in: in IST, 28 Nov 00:10 local is 27 Nov 18:40 UTC and its UTC day is the 27th. */
const local = (h: number, m: number) => new Date(2026, 10, 28, h, m).toISOString()

describe('localDay', () => {
  it('is the local day, not the UTC day', () => {
    expect(localDay(local(0, 10))).toBe('2026-11-28')
    expect(localDay(local(23, 50))).toBe('2026-11-28')
  })
  it('is empty for something that is not a date', () => expect(localDay('nope')).toBe(''))
})

describe('inLocalRange', () => {
  it('keeps the first and last minutes of a local day', () => {
    expect(inLocalRange(local(0, 10), '2026-11-28', '2026-11-28')).toBe(true)
    expect(inLocalRange(local(23, 50), '2026-11-28', '2026-11-28')).toBe(true)
  })
  it('excludes the neighbouring days and leaves empty bounds open', () => {
    expect(inLocalRange(local(0, 10), '2026-11-29', '')).toBe(false)
    expect(inLocalRange(local(23, 50), '', '2026-11-27')).toBe(false)
    expect(inLocalRange(local(12, 0), '', '')).toBe(true)
  })
})
