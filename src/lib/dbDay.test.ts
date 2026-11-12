import { describe, it, expect } from 'vitest'
import { dbToday, dayDiffersFromDb, isPastDbDay, fmtDbDate, validUntilLabel } from './dbDay'

describe('dbDay', () => {
  it('reads the UTC date', () => {
    expect(dbToday(new Date('2026-11-12T23:59:59Z'))).toBe('2026-11-12')
    expect(dbToday(new Date('2026-11-13T00:00:00Z'))).toBe('2026-11-13')
    expect(dbToday(new Date('2026-01-01T00:00:00Z'))).toBe('2026-01-01')
  })
  it('a quote valid until today is still valid at 23:59 UTC and expired a second later', () => {
    expect(isPastDbDay('2026-11-12', new Date('2026-11-12T23:59:59Z'))).toBe(false)
    expect(isPastDbDay('2026-11-12', new Date('2026-11-13T00:00:00Z'))).toBe(true)
    expect(isPastDbDay(null, new Date())).toBe(false)
  })
  it('formats a calendar date without a zone shift', () => {
    expect(fmtDbDate('2026-11-12')).toBe('12 Nov 2026')
    expect(fmtDbDate('2026-01-05')).toBe('5 Jan 2026')
    expect(fmtDbDate('nope')).toBe('nope')
  })
  it('adds (UTC) exactly when the viewer day differs, at every hour around midnight UTC', () => {
    for (let h = 0; h < 24; h++) {
      const t = new Date(Date.UTC(2026, 10, 12, h))
      expect(validUntilLabel('2026-11-12', t).endsWith('(UTC)')).toBe(dayDiffersFromDb(t))
      expect(validUntilLabel('2026-11-12', t).startsWith('12 Nov 2026')).toBe(true)
    }
  })
})
