import { describe, it, expect } from 'vitest'
import { nextStep, carried, stillNeeded, canBind, securityOptions } from './sso'
import type { Assertion, Begun } from './sso'

/* The seeded directory, trimmed. An invented fixture would pass against an
   assertion shape the telco does not send. */
const ROHAN: Assertion = {
  subject: 'AV-IN-88214021', name: 'Rohan Mehta', email: 'rohan.mehta@example.com',
  msisdn: '+91 99450 22187', market: 'IN', city: 'Pune',
  line1: 'Flat 12B, Konark Meadows, Baner Road', pin: '411045',
  kyc_level: 'Full', kyc_id_kind: 'Aadhaar', kyc_id_masked: 'XXXX XXXX 4417',
  kyc_verified_on: '2023-06-14', customer_since: '2023-06-14',
  plan: 'Aventa Freedom 50 GB', market_name: 'India', currency: 'INR',
}

const PRIYA: Assertion = {
  ...ROHAN, subject: 'AV-IN-77105533', name: 'Priya Raman',
  email: 'priya.raman@example.com', msisdn: '+91 98860 41127',
  city: 'Bengaluru', line1: '42 Rustom Bagh, Off Airport Road', pin: '560017',
}

const begun = (outcome: Begun['outcome'], over: Partial<Begun> = {}): Begun =>
  ({ outcome, reason: null, assertion: ROHAN, ...over })

describe('what the marketplace does with an assertion', () => {
  it('opens an account with no form when nobody holds that address', () => {
    const s = nextStep(begun('provision'))
    expect(s.step).toBe('open')
    expect(s.title).toContain('Rohan')
    expect(s.action).toBe('Open my account')
  })

  it('stops rather than binding when an account already exists', () => {
    /* The whole design. A matching address is not proof the account is theirs,
       and binding on a match means anybody who can make the IdP assert an
       address can take over whatever sits on it. */
    const s = nextStep(begun('link', {
      assertion: PRIYA,
      reason: 'There is already a marketplace account on priya.raman@example.com. Sign into it once and the two are linked for good.',
    }))
    expect(s.step).toBe('confirm')
    expect(s.action).toBe('Sign in and link')
    expect(s.detail).toContain('priya.raman@example.com')
  })

  it('never tells somebody the accounts have been linked before they have been', () => {
    /* The wording carries the security property. "We have linked your accounts"
       on this screen would describe something that has deliberately not
       happened yet. */
    const s = nextStep(begun('link', { assertion: PRIYA }))
    expect(s.detail).not.toMatch(/have been linked|are linked|we linked/i)
    expect(s.detail).toMatch(/sign into it/i)
  })

  it('signs a returning customer straight in', () => {
    const s = nextStep(begun('signin'))
    expect(s.step).toBe('enter')
    expect(s.title).toContain('Welcome back')
  })

  it('offers nothing to retry on a refusal', () => {
    /* A refusal here is about a fact — the wrong country, or verification the
       telco has not done — and a second attempt will not change it. The way on
       is the ordinary form, offered beside this rather than as a retry. */
    const s = nextStep(begun('refused', {
      reason: 'Your Aventa account is registered in UG, and the marketplace does not trade there yet.',
    }))
    expect(s.step).toBe('stop')
    expect(s.action).toBeNull()
    expect(s.detail).toContain('does not trade there')
  })

  it('says something on a refusal that arrives with no reason', () => {
    expect(nextStep(begun('refused')).detail.length).toBeGreaterThan(0)
  })

  it('uses the first name, and copes with one word', () => {
    expect(nextStep(begun('provision', { assertion: { ...ROHAN, name: 'Otieno' } })).title)
      .toContain('Otieno')
  })
})

describe('what the customer is shown before they accept it', () => {
  it('names everything that carries across', () => {
    const rows = carried(ROHAN)
    const labels = rows.map(r => r.label)
    expect(labels).toContain('Name')
    expect(labels).toContain('Mobile')
    expect(labels).toContain('Address')
    expect(labels).toContain('Identity')
  })

  it('shows the address the telco holds rather than asking for it again', () => {
    expect(carried(ROHAN).find(r => r.label === 'Address')?.value)
      .toBe('Flat 12B, Konark Meadows, Baner Road, Pune 411045')
  })

  it('masks the identity document', () => {
    const id = carried(ROHAN).find(r => r.label === 'Identity')!
    expect(id.value).toBe('Aadhaar XXXX XXXX 4417')
    expect(id.value).not.toMatch(/\d{6,}/)
  })

  it('says which fields the telco verified and which it merely holds', () => {
    /* Showing a plan name beside a verified address with no distinction
       implies the marketplace checked both. It checked neither — the telco
       did — and only some of it was verification. */
    const rows = carried(ROHAN)
    expect(rows.find(r => r.label === 'Identity')?.verified).toBe(true)
    expect(rows.find(r => r.label === 'Your plan')?.verified).toBe(false)
  })

  it('says what is still going to be asked for', () => {
    /* "Nothing to fill in" followed by a payment form at checkout is a promise
       that was not quite true. */
    const rest = stillNeeded()
    expect(rest.length).toBeGreaterThan(0)
    expect(rest.join(' ')).toMatch(/payment/i)
  })
})

describe('binding an account somebody has just proved is theirs', () => {
  it('binds when the session is on the asserted address', () => {
    expect(canBind('priya.raman@example.com', PRIYA)).toEqual({ ok: true })
  })

  it('ignores case and surrounding space, because an address is an address', () => {
    expect(canBind('  Priya.Raman@Example.com ', PRIYA)).toEqual({ ok: true })
  })

  it('refuses to bind a subscriber to somebody else’s account', () => {
    /* Proving *a* password is not proof. Without this, anybody who can sign
       into any marketplace account could bind any subscriber to it. */
    const v = canBind('wanjiru.kamau@example.com', PRIYA)
    expect(v.ok).toBe(false)
    if (!v.ok) {
      expect(v.reason).toContain('wanjiru.kamau@example.com')
      expect(v.reason).toContain('priya.raman@example.com')
    }
  })

  it('refuses when nobody is signed in', () => {
    expect(canBind(null, PRIYA).ok).toBe(false)
    expect(canBind(undefined, PRIYA).ok).toBe(false)
    expect(canBind('', PRIYA).ok).toBe(false)
  })
})

describe('what the account’s security screen may offer', () => {
  it('does not offer to change a password that does not exist', () => {
    /* An account opened through the second door never had one to choose. */
    const s = securityOptions('telco-sso', true)
    expect(s.canChangePassword).toBe(false)
    expect(s.note).toMatch(/Aventa ID/)
  })

  it('offers it on an account opened here', () => {
    expect(securityOptions('self', false).canChangePassword).toBe(true)
  })

  it('says both credentials work once an account has been linked', () => {
    const s = securityOptions('self', true)
    expect(s.canChangePassword).toBe(true)
    expect(s.note).toMatch(/Either will sign you in/)
  })
})
