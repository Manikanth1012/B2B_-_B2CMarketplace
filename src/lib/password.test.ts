import { describe, it, expect } from 'vitest'
import {
  checkNewPassword, strengthOf, isDemoAccount, looksLikeEmail,
  MIN_LENGTH, RESET_SENT_MESSAGE,
} from './password'

describe('checkNewPassword', () => {
  it('insists on the current password, so a stolen session cannot change it blind', () => {
    expect(checkNewPassword('', 'a-long-enough-one', 'a-long-enough-one'))
      .toEqual({ ok: false, reason: 'Enter your current password.' })
  })

  it('enforces the length floor', () => {
    const r = checkNewPassword('old', 'short', 'short')
    expect(r.ok).toBe(false)
    expect(r.reason).toContain(String(MIN_LENGTH))
  })

  it('catches a mistyped confirmation', () => {
    expect(checkNewPassword('old', 'correct-horse-battery', 'correct-horse-bettery').ok).toBe(false)
  })

  it('refuses reusing the current password', () => {
    const same = 'correct-horse-battery'
    expect(checkNewPassword(same, same, same))
      .toEqual({ ok: false, reason: 'New password must be different from the current one.' })
  })

  /* A long passphrase with no symbols in it should pass. Composition rules push people
     towards P@ssw0rd1, which is shorter and worse. */
  it('accepts a long passphrase without punctuation', () => {
    expect(checkNewPassword('old', 'correct horse battery staple', 'correct horse battery staple').ok).toBe(true)
  })
})

describe('strengthOf', () => {
  it('says nothing about an empty box', () => {
    expect(strengthOf('')).toEqual({ level: 0, label: '' })
  })

  it('calls anything under the floor too short', () => {
    expect(strengthOf('abc')).toEqual({ level: 1, label: 'Too short' })
  })

  it('rates length on its own as strong', () => {
    expect(strengthOf('aaaaaaaaaaaaaaaaaaaaaa').level).toBe(3)
  })

  it('rates variety as strong once past the floor', () => {
    expect(strengthOf('Passphrase1!').level).toBe(3)
  })

  it('rates a plain twelve-character word as fair, not strong', () => {
    expect(strengthOf('abcdefghijkl')).toEqual({ level: 2, label: 'Fair' })
  })
})

describe('isDemoAccount', () => {
  /* The four are shared: every visitor signs in as the same Priya, and the sign-in
     cards print the credentials. One change would lock everyone out, the integration
     suite included. */
  it('recognises all four seeded personas', () => {
    expect(isDemoAccount('priya.raman@example.com')).toBe(true)
    expect(isDemoAccount('anika.sharma@aventa.com')).toBe(true)
    expect(isDemoAccount('rajesh.kumar@nimbussensors.com')).toBe(true)
    expect(isDemoAccount('vikram.shah@smartbuild.in')).toBe(true)
  })

  it('is not fooled by casing or padding', () => {
    expect(isDemoAccount('  PRIYA.RAMAN@example.com ')).toBe(true)
  })

  it('leaves a real account alone', () => {
    expect(isDemoAccount('someone@elsewhere.test')).toBe(false)
  })
})

describe('looksLikeEmail', () => {
  it('accepts an ordinary address', () => {
    expect(looksLikeEmail('priya.raman@example.com')).toBe(true)
  })

  it('rejects the obvious non-addresses without trying to be a validator', () => {
    expect(looksLikeEmail('')).toBe(false)
    expect(looksLikeEmail('nope')).toBe(false)
    expect(looksLikeEmail('@example.com')).toBe(false)
    expect(looksLikeEmail('priya@')).toBe(false)
  })
})

describe('the reset message', () => {
  /* It has to be the same words whether or not the address is registered. Anything
     conditional here is an account-enumeration weakness. */
  it('never confirms whether an account exists', () => {
    expect(RESET_SENT_MESSAGE).toMatch(/if an account exists/i)
    expect(RESET_SENT_MESSAGE).not.toMatch(/\bwe (have )?sent you\b/i)
  })
})
