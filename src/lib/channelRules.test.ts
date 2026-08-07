import { describe, it, expect } from 'vitest'
import {
  withheld, allowed, ruleFor, permits, refusal, shortAnswer, incomplete,
} from './channelRules'
import type { ChannelRule } from './channelRules'

const rule = (over: Partial<ChannelRule> = {}): ChannelRule => ({
  id: 'CR-001',
  what: 'retail-line-onboarding',
  label: 'New prepaid or postpaid line',
  decision: 'not sold here',
  sold_through: 'Aventa self-care, retail POS and CRM',
  reason: 'Activating a line is an identity check this channel does not do.',
  kb_ref: null,
  effective_from: '2026-08-07',
  agreed_by: 'Anika Sharma',
  sort_order: 1,
  ...over,
})

const PORT = rule({ id: 'CR-002', what: 'number-portability', label: 'Bringing your number', sort_order: 2 })
const FIBRE = rule({
  id: 'CR-003', what: 'fixed-line-access', label: 'Fibre and fixed-line broadband',
  sold_through: 'Aventa field sales and CRM', sort_order: 3,
})
const IOT = rule({
  id: 'CR-004', what: 'iot-connectivity', label: 'IoT connectivity',
  decision: 'sold here', sold_through: null, sort_order: 4,
})
const ALL = [FIBRE, rule(), IOT, PORT]

describe('splitting the rules', () => {
  it('lists the refusals in the order they were agreed, not the order they arrived', () => {
    expect(withheld(ALL).map(r => r.id)).toEqual(['CR-001', 'CR-002', 'CR-003'])
  })

  it('lists what IS sold here, so the IoT case does not read as an oversight', () => {
    expect(allowed(ALL).map(r => r.id)).toEqual(['CR-004'])
  })
})

describe('permits', () => {
  it('refuses what the rule refuses', () => {
    expect(permits(ALL, 'retail-line-onboarding')).toBe(false)
    expect(permits(ALL, 'number-portability')).toBe(false)
    expect(permits(ALL, 'fixed-line-access')).toBe(false)
  })

  it('allows what the rule allows', () => {
    expect(permits(ALL, 'iot-connectivity')).toBe(true)
  })

  /* The default matters more than it looks. A rule renamed in one place and not
     the other must not silently withdraw the whole shelf. */
  it('allows a question nobody has ruled on', () => {
    expect(permits(ALL, 'something-nobody-decided')).toBe(true)
    expect(permits([], 'retail-line-onboarding')).toBe(true)
  })
})

describe('refusal', () => {
  it('names the rule, the reason and where the customer actually goes', () => {
    const said = refusal(ALL, 'retail-line-onboarding')
    expect(said).toContain('New prepaid or postpaid line')
    expect(said).toContain('identity check')
    expect(said).toContain('Aventa self-care, retail POS and CRM')
  })

  it('says nothing about something that is sold here', () => {
    expect(refusal(ALL, 'iot-connectivity')).toBeNull()
    expect(refusal(ALL, 'unknown')).toBeNull()
  })

  /* A refusal with a dangling "It is done through ." reads as a bug and gets
     escalated as one. */
  it('does not trail an empty destination when there is none', () => {
    const orphan = rule({ what: 'x', sold_through: null })
    expect(refusal([orphan], 'x')).not.toContain('done through')
    expect(refusal([orphan], 'x')).not.toMatch(/\s\.$/)
  })
})

describe('shortAnswer', () => {
  it('points at the channel rather than repeating the refusal', () => {
    expect(shortAnswer(rule())).toBe('Sold through Aventa self-care, retail POS and CRM')
    expect(shortAnswer(IOT)).toBe('Sold here')
    expect(shortAnswer(rule({ sold_through: null }))).toBe('Not sold here')
  })
})

describe('incomplete', () => {
  it('passes a rule that says no, why, where and who agreed it', () => {
    expect(incomplete(rule())).toBeNull()
    expect(incomplete(IOT)).toBeNull()
  })

  it('catches a refusal with nowhere to send the customer', () => {
    expect(incomplete(rule({ sold_through: null }))).toMatch(/without saying where/)
  })

  it('catches a rule with no reason on it', () => {
    expect(incomplete(rule({ reason: '   ' }))).toMatch(/no reason/)
  })

  it('catches a rule nobody agreed', () => {
    expect(incomplete(rule({ agreed_by: null }))).toMatch(/agreed it/)
  })

  /* A rule that says yes needs no destination — that is the whole point of it
     saying yes. */
  it('does not ask a permission for a destination', () => {
    expect(incomplete(rule({ decision: 'sold here', sold_through: null }))).toBeNull()
  })
})

describe('ruleFor', () => {
  it('finds by what, not by id', () => {
    expect(ruleFor(ALL, 'fixed-line-access')?.id).toBe('CR-003')
    expect(ruleFor(ALL, 'CR-003')).toBeNull()
  })
})
