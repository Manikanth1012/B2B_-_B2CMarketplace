import { describe, it, expect } from 'vitest'
import {
  ADULT, SOURCE_LABEL, ageOn, isAdult, ageBand, validateDob,
  canHoldANumber, dobLine, sourceLine, birthdayOn,
} from './dob'

const on = (s: string) => new Date(s + 'T12:00:00Z')

describe('age', () => {
  it('turns over on the birthday and not before it', () => {
    /* The naive version subtracts the years and is wrong for everybody whose
       birthday has not happened yet this year — about half of everybody, on
       any given day. */
    expect(ageOn('1991-04-17', on('2026-04-16'))).toBe(34)
    expect(ageOn('1991-04-17', on('2026-04-17'))).toBe(35)
    expect(ageOn('1991-04-17', on('2026-08-07'))).toBe(35)
  })

  it('handles a birthday later in the same month', () => {
    expect(ageOn('1991-08-20', on('2026-08-07'))).toBe(34)
    expect(ageOn('1991-08-01', on('2026-08-07'))).toBe(35)
  })

  it('is null where the date is not held, not zero', () => {
    /* A customer who never gave one is not a newborn. */
    expect(ageOn(null)).toBeNull()
    expect(ageOn('')).toBeNull()
    expect(ageOn('not a date')).toBeNull()
  })
})

describe('old enough', () => {
  it('answers yes, no, or "we do not know"', () => {
    expect(isAdult('1991-04-17', on('2026-08-07'))).toBe(true)
    expect(isAdult('2012-04-17', on('2026-08-07'))).toBe(false)
    /* Null rather than false. "We do not know" and "under age" are different
       answers and only one of them is a refusal. */
    expect(isAdult(null)).toBeNull()
  })

  it('turns eighteen on the day, not the year', () => {
    expect(isAdult('2008-08-08', on('2026-08-07'))).toBe(false)
    expect(isAdult('2008-08-07', on('2026-08-07'))).toBe(true)
  })
})

describe('the band', () => {
  it('never leaks the date', () => {
    expect(ageBand('1991-04-17', on('2026-08-07'))).toBe('35-49')
    expect(ageBand('1996-11-02', on('2026-08-07'))).toBe('25-34')
    expect(ageBand('2012-01-01', on('2026-08-07'))).toBe('under 18')
    expect(ageBand('1950-01-01', on('2026-08-07'))).toBe('65+')
  })

  it('says a missing date is missing rather than putting it in a band', () => {
    expect(ageBand(null)).toBe('not given')
  })
})

describe('what a form may accept', () => {
  it('allows blank, and says so rather than nagging', () => {
    /* A marketplace that has been running has customers who never gave one,
       and forcing a date makes people invent one. */
    const r = validateDob('', on('2026-08-07'))
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.note).toContain('blank is fine')
  })

  it('refuses a date in the future', () => {
    const r = validateDob('2030-01-01', on('2026-08-07'))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toContain('typo')
  })

  it('refuses something that is not a date', () => {
    expect(validateDob('yesterday', on('2026-08-07')).ok).toBe(false)
  })

  it('refuses an implausible age', () => {
    const r = validateDob('1850-01-01', on('2026-08-07'))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toContain('over 130')
  })

  it('accepts a minor and tells them what it means', () => {
    /* Not a refusal — a fourteen-year-old may hold an account. What they may
       not hold is a mobile number in their own name. */
    const r = validateDob('2012-01-01', on('2026-08-07'))
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.note).toContain('14')
      expect(r.note).toContain('parent or guardian')
    }
  })

  it('says nothing extra about an ordinary date', () => {
    const r = validateDob('1991-04-17', on('2026-08-07'))
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.note).toBeUndefined()
  })
})

describe('whether a number can go to them', () => {
  it('refuses a minor, with the age and the alternative', () => {
    const r = canHoldANumber('2012-01-01', on('2026-08-07'))
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.reason).toContain('14')
      expect(r.reason).toContain(String(ADULT))
      expect(r.reason).toContain('parent or guardian')
    }
  })

  it('allows an adult without comment', () => {
    const r = canHoldANumber('1991-04-17', on('2026-08-07'))
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.note).toBeUndefined()
  })

  it('does not refuse where no date is held, and says the check was not made', () => {
    /* The marketplace issued numbers for years without asking. Retrospectively
       blocking everybody who never gave a date would take working lines off
       working customers. */
    const r = canHoldANumber(null)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.note).toContain('could not be made')
  })
})

describe('how it reads', () => {
  it('gives the date and what it means, so nobody has to do the arithmetic', () => {
    expect(dobLine('1991-04-17', on('2026-08-07'))).toBe('17 April 1991 · 35')
  })

  it('says not given rather than printing an empty string', () => {
    expect(dobLine(null)).toBe('Not given')
  })

  it('keeps a typed date and a verified one apart', () => {
    /* Only one of them should be gating a legal requirement. */
    expect(sourceLine('self')).not.toBe(sourceLine('kyc'))
    expect(sourceLine('kyc')).toContain('ID')
    expect(sourceLine(null)).toBe('Not given')
    for (const s of ['self', 'kyc', 'import'] as const) expect(SOURCE_LABEL[s]).toBeTruthy()
  })
})

describe('birthdays', () => {
  it('matches the day', () => {
    expect(birthdayOn('1991-04-17', on('2026-04-17'))).toBe(true)
    expect(birthdayOn('1991-04-17', on('2026-04-18'))).toBe(false)
    expect(birthdayOn(null, on('2026-04-17'))).toBe(false)
  })

  it('does not drop somebody born on 29 February three years in four', () => {
    /* A check that only matches the date never fires for them outside a leap
       year, and they have a birthday every year like everybody else. */
    expect(birthdayOn('1992-02-29', on('2026-02-28'))).toBe(true)
    expect(birthdayOn('1992-02-29', on('2026-03-01'))).toBe(false)
    expect(birthdayOn('1992-02-29', on('2028-02-29'))).toBe(true)
    expect(birthdayOn('1992-02-29', on('2028-02-28'))).toBe(false)
  })
})
