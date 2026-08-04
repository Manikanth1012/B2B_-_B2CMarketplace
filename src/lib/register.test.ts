import { describe, it, expect } from 'vitest'
import {
  validatePassword, validateSignUp, passwordStrength, marketNote,
  MIN_PASSWORD, BLANK_SIGNUP,
} from './register'
import type { SignUpDraft } from './register'

const MARKETS = [
  { code: 'IN', name: 'India', tax_label: 'GST', tax_rate: 18 },
  { code: 'AE', name: 'United Arab Emirates', tax_label: 'VAT', tax_rate: 5 },
  { code: 'KE', name: 'Kenya', tax_label: 'VAT', tax_rate: 16 },
]
const ACCEPTED = [
  { market_code: 'IN', currency: 'INR', is_default: true },
  { market_code: 'KE', currency: 'KES', is_default: true },
  { market_code: 'KE', currency: 'USD', is_default: false },
]

function draft(over: Partial<SignUpDraft> = {}): SignUpDraft {
  return {
    name: 'Asha Kunjumon', email: 'asha@example.com', password: 'harbour-lantern-tin',
    msisdn: '+91 98860 41127', city: 'Kochi', market: 'IN', ...over,
  }
}

describe('the password rules', () => {
  it('cares about length before anything else', () => {
    /* A rule demanding a symbol and a digit and a capital is a rule people
       satisfy with Password1!, which is on every leaked list there is. */
    const short = validatePassword('Ab1!xyz')
    expect(short.ok).toBe(false)
    expect(short.ok === false && short.reason).toMatch(new RegExp(`at least ${MIN_PASSWORD} characters`))
  })

  it('accepts three ordinary words with nothing clever in them', () => {
    expect(validatePassword('harbour lantern tin').ok).toBe(true)
    expect(validatePassword('correcthorsebattery').ok).toBe(true)
  })

  it('refuses the first things anybody would guess', () => {
    for (const p of ['password123', 'MyPassw0rdIsThis', 'letmein12345', 'aventatelecom1']) {
      expect(validatePassword(p).ok, p).toBe(false)
    }
  })

  it('refuses the name and the address on the same form', () => {
    /* Both are visible on screen while the password is being chosen, which
       makes them the first two things anybody would try. */
    expect(validatePassword('ashakunjumon-2026', { name: 'Asha Kunjumon' }).ok).toBe(false)
    expect(validatePassword('asha-is-my-password', { email: 'asha@example.com' }).ok).toBe(false)
  })

  it('does not refuse a short fragment that happens to appear', () => {
    /* A two- or three-letter name would otherwise ban half the alphabet. */
    expect(validatePassword('rivergatecopper', { name: 'Al Ng' }).ok).toBe(true)
  })

  it('refuses one long character', () => {
    expect(validatePassword('aaaaaaaaaaaaaaaa').ok).toBe(false)
  })
})

describe('the strength meter', () => {
  it('never disagrees with the button', () => {
    /* Anything the validator refuses reads weak, whatever its length — a meter
       showing "good" beside a disabled button is the screen contradicting
       itself. */
    expect(passwordStrength('password12345')).toBe('weak')
    expect(passwordStrength('short')).toBe('weak')
  })

  it('rates length above cleverness', () => {
    /* Sixteen plain characters beat ten with a symbol in, which is the point
       the copy beside the box is making. */
    expect(passwordStrength('harbourlanterntin')).toBe('strong')
    expect(passwordStrength('Tr0ub4dor!')).toBe('fair')
  })

  it('climbs as the password gets longer', () => {
    const ladder = ['zebracoast', 'zebracoastfig', 'zebracoastfigmoon']
      .map(p => passwordStrength(p))
    /* Monotonic: adding characters never makes the meter go down. */
    const rank = { weak: 0, fair: 1, good: 2, strong: 3 }
    expect(rank[ladder[0]]).toBeLessThanOrEqual(rank[ladder[1]])
    expect(rank[ladder[1]]).toBeLessThanOrEqual(rank[ladder[2]])
  })
})

describe('the form as a whole', () => {
  it('accepts a complete one', () => {
    expect(validateSignUp(draft(), MARKETS)).toEqual({ ok: true })
  })

  it('asks in the order the fields are on screen', () => {
    /* Somebody told about the password, who fixes it and is then told about
       the city, has been made to go round twice. The first failure reported is
       the topmost one. */
    const empty = validateSignUp(BLANK_SIGNUP, MARKETS)
    expect(empty.ok === false && empty.reason).toMatch(/name the account should be in/)
  })

  it('catches a typo in the email without being clever', () => {
    expect(validateSignUp(draft({ email: 'asha@example' }), MARKETS).ok).toBe(false)
    expect(validateSignUp(draft({ email: "o'brien+shop@sub.domain.co.uk" }), MARKETS).ok).toBe(true)
  })

  it('accepts a mobile number however it is punctuated', () => {
    for (const msisdn of ['+91 98860 41127', '(020) 7946 0958', '+254-20-1234567']) {
      expect(validateSignUp(draft({ msisdn }), MARKETS).ok, msisdn).toBe(true)
    }
    expect(validateSignUp(draft({ msisdn: 'call me' }), MARKETS).ok).toBe(false)
  })

  it('refuses a country the marketplace does not operate in', () => {
    const out = validateSignUp(draft({ market: 'GB' }), MARKETS)
    expect(out.ok).toBe(false)
    expect(out.ok === false && out.reason).toMatch(/does not operate there/)
  })

  it('does not refuse every country while the markets are still loading', () => {
    /* The screen calls this before and after they arrive, and the database has
       the last word either way. */
    expect(validateSignUp(draft(), []).ok).toBe(true)
  })

  it('refuses a weak password through the same one call', () => {
    const out = validateSignUp(draft({ password: 'password123' }), MARKETS)
    expect(out.ok).toBe(false)
    expect(out.ok === false && out.reason).toMatch(/first guesses/)
  })
})

describe('what a shopper is told before they commit', () => {
  it('names the market, the money and the tax', () => {
    const note = marketNote('IN', MARKETS, ACCEPTED)
    expect(note).toMatch(/India/)
    expect(note).toMatch(/INR/)
    expect(note).toMatch(/GST at 18%/)
  })

  it('names both currencies where the market takes two', () => {
    /* Kenya trades in shillings and dollars, and a shopper choosing Kenya
       should know that before they register rather than at checkout. */
    expect(marketNote('KE', MARKETS, ACCEPTED)).toMatch(/KES or USD/)
  })

  it('says nothing at all about a market that does not exist', () => {
    expect(marketNote('', MARKETS, ACCEPTED)).toBeNull()
    expect(marketNote('GB', MARKETS, ACCEPTED)).toBeNull()
  })
})
