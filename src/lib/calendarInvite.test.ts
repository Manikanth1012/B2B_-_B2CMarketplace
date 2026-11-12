import { describe, it, expect } from 'vitest'
import { demoInvite, quoteExpiryInvite, escapeText, foldLine, dateValue } from './calendarInvite'

const base = { enquiryId: 'ENQ-1', updatedAt: '2026-11-12T10:00:00Z', summary: 'Demo: Sensor, v2', now: new Date('2026-11-12T08:00:00Z') }

describe('calendarInvite', () => {
  it('escapes , ; \\ and newlines', () => {
    expect(escapeText('a,b;c\\d\ne')).toBe('a\\,b\\;c\\\\d\\ne')
  })
  it('folds at 75 octets and never splits a character', () => {
    const long = 'X:' + 'é'.repeat(100)
    const lines = foldLine(long).split('\r\n')
    expect(lines.length).toBeGreaterThan(1)
    for (const l of lines) expect(new TextEncoder().encode(l).length).toBeLessThanOrEqual(75)
    expect(lines.slice(1).every(l => l.startsWith(' '))).toBe(true)
    expect(lines.map((l, i) => (i ? l.slice(1) : l)).join('')).toBe(long)
    expect(foldLine('short')).toBe('short')
  })
  it('demo: CRLF, UTC times, default 30 minutes, stable UID, SEQUENCE and DTSTAMP', () => {
    const ics = demoInvite({ ...base, startsAt: '2026-12-01T09:30:00Z', location: 'https://meet.example/x', description: 'Video call' })
    expect(ics.endsWith('\r\n')).toBe(true)
    expect(ics.replace(/\r\n/g, '').includes('\n')).toBe(false)
    expect(ics).toContain('BEGIN:VCALENDAR\r\nVERSION:2.0\r\n')
    expect(ics).toContain('UID:ENQ-1@aventa.marketplace\r\n')
    expect(ics).toContain('DTSTAMP:20261112T080000Z\r\n')
    expect(ics).toContain('DTSTART:20261201T093000Z\r\n')
    expect(ics).toContain('DTEND:20261201T100000Z\r\n')
    expect(ics).toContain('SUMMARY:Demo: Sensor\\, v2\r\n')
    expect(ics).toContain('LOCATION:https://meet.example/x\r\n')
    expect(ics).toMatch(/SEQUENCE:\d+\r\n/)
    expect(demoInvite({ ...base, startsAt: '2026-12-01T09:30:00Z' })).not.toContain('LOCATION')
  })
  it('sequence grows when the enquiry is updated', () => {
    const seq = (u: string) => Number(/SEQUENCE:(\d+)/.exec(demoInvite({ ...base, updatedAt: u, startsAt: '2026-12-01T09:30:00Z' }))![1])
    expect(seq('2026-11-12T10:05:00Z')).toBeGreaterThan(seq('2026-11-12T10:00:00Z'))
  })
  it('a demo late on the 31st rolls the end over the month', () => {
    expect(demoInvite({ ...base, startsAt: '2026-12-31T23:45:00Z' })).toContain('DTEND:20270101T001500Z')
  })
  it('quote: all-day VALUE=DATE, DTEND the next day', () => {
    const ics = quoteExpiryInvite({ ...base, validUntil: '2026-12-31' })
    expect(ics).toContain('DTSTART;VALUE=DATE:20261231\r\n')
    expect(ics).toContain('DTEND;VALUE=DATE:20270101\r\n')
    expect(dateValue('2028-02-28', 1)).toBe('20280229')
  })
  it('rejects bad input', () => {
    expect(() => demoInvite({ ...base, startsAt: 'soon' })).toThrow()
    expect(() => quoteExpiryInvite({ ...base, validUntil: 'x' })).toThrow()
  })
})
