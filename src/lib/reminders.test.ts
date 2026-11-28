import { describe, it, expect } from 'vitest'
import {
  addDays, daysBetween, utcDay, dueOn, anchorFor, stepDueOn, stepsDueOn,
  offsetCode, stepLabel, stepLabelWithCode, parseOffset, validateStep, missingStepTemplates,
  validateBasketWindow, windowFor, abandonedOn, clearsOn, basketStateFor, basketWindowLine,
  DEFAULT_BASKET_WINDOW, daysLeftText, latestOffset, canSchedule, NO_STEPS_AFTER_THE_DAY,
} from './reminders'

const W = DEFAULT_BASKET_WINDOW

describe('dates', () => {
  it('adds and counts UTC days, across months and years', () => {
    expect(addDays('2026-11-28', 3)).toBe('2026-12-01')
    expect(addDays('2027-01-01', -1)).toBe('2026-12-31')
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29')
    expect(daysBetween('2026-11-28', '2026-12-05')).toBe(7)
    expect(daysBetween('2026-12-05', '2026-11-28')).toBe(-7)
    expect(addDays('not a date', 1)).toBeNull()
  })
  it('reads the UTC day of a timestamp', () => {
    expect(utcDay('2026-11-28T23:30:00+05:30')).toBe('2026-11-28')
    expect(utcDay('2026-11-28T20:30:00-05:00')).toBe('2026-11-29')
    expect(utcDay('nonsense')).toBeNull()
  })
})

describe('offset maths', () => {
  it('a step is due on anchor + offset', () => {
    expect(dueOn('2026-12-10', -7)).toBe('2026-12-03')
    expect(dueOn('2026-12-10', 0)).toBe('2026-12-10')
    expect(dueOn('2026-12-10', 2)).toBe('2026-12-12')
  })
  it('n−1 from a clearing date is the day before the night that clears it', () => {
    const clears = clearsOn('2026-09-01T10:00:00Z', W)
    expect(clears).toBe('2026-12-01')
    expect(dueOn(clears!, -1)).toBe('2026-11-30')
    expect(anchorFor('2026-11-30', -1)).toBe(clears)
  })
  it('finds the step due on a day, and none on other days', () => {
    const steps = [
      { id: 'm7', offset_days: -7, enabled: true },
      { id: 'm1', offset_days: -1, enabled: true },
      { id: 'p2', offset_days: 2, enabled: false },
    ]
    expect(stepDueOn(steps, '2026-12-10', '2026-12-03')?.id).toBe('m7')
    expect(stepDueOn(steps, '2026-12-10', '2026-12-09')?.id).toBe('m1')
    expect(stepDueOn(steps, '2026-12-10', '2026-12-05')).toBeNull()
    /* A step that is off is not due, unless asked for. */
    expect(stepDueOn(steps, '2026-12-10', '2026-12-12')).toBeNull()
    expect(stepsDueOn(steps, '2026-12-10', '2026-12-12', true).map(s => s.id)).toEqual(['p2'])
    expect(stepsDueOn(steps, 'bad', '2026-12-12')).toEqual([])
  })
})

describe('step labels', () => {
  it('says before, on the day and after', () => {
    expect(stepLabel(-7)).toBe('7 days before')
    expect(stepLabel(-1)).toBe('1 day before')
    expect(stepLabel(0)).toBe('on the day')
    expect(stepLabel(1)).toBe('1 day after')
    expect(stepLabel(2)).toBe('2 days after')
  })
  it('gives the n−7 form, with a true minus sign', () => {
    expect(offsetCode(-7)).toBe('n−7')
    expect(offsetCode(0)).toBe('n+0')
    expect(offsetCode(2)).toBe('n+2')
    expect(stepLabelWithCode(-7)).toBe('7 days before (n−7)')
  })
  it('reads an offset back, in any of the forms, within ±30', () => {
    expect(parseOffset('n−7')).toBe(-7)
    expect(parseOffset('n-1')).toBe(-1)
    expect(parseOffset('n+2')).toBe(2)
    expect(parseOffset('n+0')).toBe(0)
    expect(parseOffset('-0')).toBe(0)
    expect(parseOffset('5')).toBe(5)
    expect(parseOffset('n-31')).toBeNull()
    expect(parseOffset('soon')).toBeNull()
  })
})

describe('days left, in words', () => {
  it('reads naturally either side of the day', () => {
    expect(daysLeftText(7)).toBe('in 7 days')
    expect(daysLeftText(1)).toBe('in 1 day')
    expect(daysLeftText(0)).toBe('today')
    expect(daysLeftText(-1)).toBe('1 day ago')
    expect(daysLeftText(-2)).toBe('2 days ago')
  })
})

describe('steps', () => {
  it('goes no later than the day itself where the date moves on or the subject goes', () => {
    expect(NO_STEPS_AFTER_THE_DAY).toEqual(['subscription.renewal', 'agreement.notice', 'basket.clearing'])
    expect(latestOffset('basket.clearing')).toBe(0)
    expect(latestOffset('invoice.due')).toBe(30)
    expect(validateStep({ offset_days: 0, kinds: ['email'] }, ['email'], 'basket.clearing')).toEqual({ ok: true })
    expect(validateStep({ offset_days: 1, kinds: ['email'] }, ['email'], 'subscription.renewal').ok).toBe(false)
    expect(validateStep({ offset_days: 3, kinds: ['email'] }, ['email'], 'invoice.due')).toEqual({ ok: true })
    expect(validateStep({ offset_days: 3, kinds: ['email'] }, ['email'], 'basket.abandoned')).toEqual({ ok: true })
  })
  it('refuses a seller’s agreement notice, which nobody could receive', () => {
    expect(canSchedule('agreement.notice', 'partner').ok).toBe(false)
    expect(canSchedule('agreement.notice', 'enterprise').ok).toBe(true)
    expect(validateStep({ offset_days: -7, kinds: ['email'] }, ['email'], 'agreement.notice', 'partner').ok).toBe(false)
  })

  it('keeps a step to ±30 days and to the rule’s channels', () => {
    expect(validateStep({ offset_days: -1, kinds: ['email', 'whatsapp'] }, ['email', 'whatsapp'])).toEqual({ ok: true })
    expect(validateStep({ offset_days: -31, kinds: ['email'] }, ['email']).ok).toBe(false)
    expect(validateStep({ offset_days: 1.5, kinds: ['email'] }, ['email']).ok).toBe(false)
    expect(validateStep({ offset_days: 0, kinds: [] }, ['email']).ok).toBe(false)
    const r = validateStep({ offset_days: 0, kinds: ['sms'] }, ['email'])
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toContain('sms')
  })
  it('flags a channel with no template', () => {
    expect(missingStepTemplates({ id: 'S', kinds: ['email', 'whatsapp'] }, [{ step_id: 'S', kind_id: 'email' }, { step_id: 'T', kind_id: 'whatsapp' }]))
      .toEqual(['whatsapp'])
  })
})

describe('basket windows', () => {
  it('accepts today’s 7, 7 and 90', () => expect(validateBasketWindow(W)).toEqual({ ok: true }))
  it('refuses what the database refuses', () => {
    expect(validateBasketWindow({ pending_days: 0, abandoned_after_days: 7, clear_after_days: 90 }).ok).toBe(false)
    expect(validateBasketWindow({ pending_days: 7, abandoned_after_days: 7, clear_after_days: 366 }).ok).toBe(false)
    expect(validateBasketWindow({ pending_days: 7.5, abandoned_after_days: 8, clear_after_days: 90 }).ok).toBe(false)
    expect(validateBasketWindow({ pending_days: 8, abandoned_after_days: 7, clear_after_days: 90 }).ok).toBe(false)
    expect(validateBasketWindow({ pending_days: 7, abandoned_after_days: 30, clear_after_days: 30 }).ok).toBe(false)
    expect(validateBasketWindow({ pending_days: 3, abandoned_after_days: 10, clear_after_days: 11 })).toEqual({ ok: true })
  })
  it('takes the market’s rules, else the default, else today’s', () => {
    const rows = [{ market: 'default', ...W }, { market: 'KE', pending_days: 3, abandoned_after_days: 5, clear_after_days: 30 }]
    expect(windowFor(rows, 'KE').clear_after_days).toBe(30)
    expect(windowFor(rows, 'IN').clear_after_days).toBe(90)
    expect(windowFor([], 'IN')).toEqual(W)
  })
  it('dates abandonment and clearing as the database does', () => {
    /* The first night after seven whole days: never before the screen says Abandoned. */
    expect(abandonedOn('2026-11-20T10:00:00Z', W)).toBe('2026-11-28')
    expect(abandonedOn('2026-11-20T00:00:00Z', W)).toBe('2026-11-28')
    expect(basketStateFor('2026-11-20T23:59:59Z', W, '2026-11-28T00:30:00Z')).toBe('abandoned')
    expect(clearsOn('2026-11-20T10:00:00Z', W)).toBe('2027-02-19')
    expect(clearsOn('2026-11-20T00:00:00Z', W)).toBe('2027-02-19')
    expect(abandonedOn('?', W)).toBeNull()
  })
  it('says pending, abandoned or clearing soon', () => {
    const last = '2026-09-01T10:00:00Z'      // clears on 2026-12-01
    expect(basketStateFor(last, W, '2026-09-05')).toBe('pending')
    expect(basketStateFor(last, W, '2026-09-08T09:59:00Z')).toBe('pending')
    expect(basketStateFor(last, W, '2026-09-08T10:00:00Z')).toBe('abandoned')
    expect(basketStateFor(last, W, '2026-11-23')).toBe('abandoned')
    expect(basketStateFor(last, W, '2026-11-24')).toBe('clearing-soon')
    expect(basketStateFor(last, W, new Date('2026-11-30T12:00:00Z'))).toBe('clearing-soon')
    expect(basketStateFor('garbage', W, '2026-11-30')).toBe('pending')
  })
  it('follows the settings, not a fixed 7 and 90', () => {
    const s = { pending_days: 2, abandoned_after_days: 3, clear_after_days: 10 }
    expect(basketStateFor('2026-11-20T10:00:00Z', s, '2026-11-22')).toBe('pending')
    expect(basketStateFor('2026-11-20T10:00:00Z', s, '2026-11-23T11:00:00Z')).toBe('abandoned')   // clears 1 Dec
    expect(basketStateFor('2026-11-20T10:00:00Z', s, '2026-11-24')).toBe('clearing-soon')
    expect(basketWindowLine(W)).toBe('Pending: changed in the last 7 days. Abandoned: left for 7 days or more. Cleared by the nightly run after 90 days untouched.')
  })
})
