import { describe, it, expect } from 'vitest'
import {
  maskAccount, maskTaxId, maskIban,
  validateContact, canRemoveContact, contactGaps, unverified, groupByPurpose, CONTACT_PURPOSES,
  bankCodeFor, showLocalCode, validateBankChange, pendingChange, taxPosition, RENEWAL_WINDOW_DAYS,
  goLiveRows, validatePause,
  validateProfile, awayCover, canDelegate, securityGaps,
  validateInvite, canRemove, blankInvite, type InviteDraft,
} from './partnerDetails'
import type { Contact, BankAccount, BankDraft, PartnerUser } from './partnerDetails'

const contact = (over: Partial<Contact> & Pick<Contact, 'id'>): Contact => ({
  partner_id: 'PTR-1004', kind: 'email', value: 'a@b.com', purpose: 'settlement',
  label: null, verified: true, verified_on: '2024-09-27', sort_order: 0,
  ...over,
})

const bank = (over: Partial<BankAccount> = {}): BankAccount => ({
  partner_id: 'PTR-1004', holder: 'Nimbus Sensors Ltd', bank: 'Deutsche Bank',
  branch: 'München', account: '100668276720', local_label: 'Bankleitzahl', local_code: '50010517',
  swift: 'DEUTDEFF', iban: 'DE8937041006682767', currency: 'USD',
  tax_label: 'USt-IdNr', tax_id: 'DE123456789', residency: 'Germany',
  treaty_on_file: true, treaty_expires: '2026-09-15', withholding: 'Nil under treaty',
  verified: true, verified_on: '2024-09-27', verified_by: 'Ruben Oyelaran',
  method: 'Two micro-deposits matched',
  pending_status: 'none', pending_holder: null, pending_bank: null, pending_branch: null,
  pending_account: null, pending_local: null, pending_swift: null, pending_why: null,
  pending_requested_on: null, pending_requested_by: null,
  pending_decided_on: null, pending_decided_by: null, pending_note: null,
  ...over,
})

const draft = (over: Partial<BankDraft> = {}): BankDraft => ({
  holder: 'Nimbus Sensors Ltd', bank: 'Commerzbank', branch: 'München',
  account: '500123456789', confirm: '500123456789', local: '50010517', swift: 'COBADEFF',
  why: 'Moved our banking to Commerzbank on 20 July.',
  ...over,
})

const user = (over: Partial<PartnerUser> & Pick<PartnerUser, 'id'>): PartnerUser => ({
  partner_id: 'PTR-1004', name: 'Rajesh Kumar', email: 'rajesh.kumar@nimbussensors.com',
  job_title: 'Seller operations lead', role: 'admin', status: 'active', joined: '2024-09-27',
  last_active: 'Today', mfa: true, sessions: 1, pwd_changed: '2026-05-12', pwd_strength: 'strong',
  must_reset: false, timezone: 'Asia/Kolkata (IST)', date_format: 'DD MMM YYYY', language: 'English',
  out_of_office: false, delegate_id: null, digest: 'Weekly', sort_order: 1,
  ...over,
})

/* ------------------------------------------------------------------ masks -- */

describe('masking', () => {
  it('leaves four digits of an account — enough to recognise, not enough to pay into', () => {
    expect(maskAccount('100668276720')).toBe('•••• 6720')
  })

  it('says so plainly when there is no account rather than showing empty dots', () => {
    expect(maskAccount(null)).toBe('Not on file')
  })

  it('keeps the jurisdiction of a tax identifier — that part is not the secret', () => {
    /* Eleven characters in, so two shown at each end and five hidden. */
    expect(maskTaxId('DE123456789')).toBe('DE•••••89')
  })

  it('hides the middle of an IBAN but keeps the country and the tail', () => {
    expect(maskIban('DE8937041006682767')).toBe('DE89 •••• 2767')
  })

  it('returns null rather than a string for a country with no IBAN', () => {
    expect(maskIban(null)).toBeNull()
  })
})

/* --------------------------------------------------------------- contacts -- */

describe('validateContact', () => {
  it('refuses a telephone number for something that is sent in writing', () => {
    const v = validateContact({ kind: 'phone', value: '+49 89 1234', purpose: 'disputes', existing: [] })
    expect(!v.ok && v.reason).toMatch(/in writing/)
  })

  it('refuses a second sign-in address instead of silently keeping both', () => {
    const v = validateContact({
      kind: 'email', value: 'other@nimbussensors.com', purpose: 'signin',
      existing: [contact({ id: 'a', purpose: 'signin' })],
    })
    expect(!v.ok && v.reason).toMatch(/already a sign-in address/)
  })

  it('treats the same address for two different purposes as fine', () => {
    /* One person is often both the disputes contact and the settlement one.
       That is not a duplicate, it is a small company. */
    const v = validateContact({
      kind: 'email', value: 'a@b.com', purpose: 'disputes',
      existing: [contact({ id: 'a', purpose: 'settlement', value: 'a@b.com' })],
    })
    expect(v.ok).toBe(true)
  })

  it('catches the same address twice for one purpose', () => {
    const v = validateContact({
      kind: 'email', value: 'A@B.com', purpose: 'settlement',
      existing: [contact({ id: 'a', value: 'a@b.com' })],
    })
    expect(!v.ok && v.reason).toMatch(/already listed/)
  })

  it('lets a row be edited without clashing with itself', () => {
    const row = contact({ id: 'a', value: 'a@b.com' })
    const v = validateContact({
      kind: 'email', value: 'a@b.com', purpose: 'settlement', existing: [row], editingId: 'a',
    })
    expect(v.ok).toBe(true)
  })

  it('rejects a number too short to dial', () => {
    const v = validateContact({ kind: 'phone', value: '12345', purpose: 'escalation', existing: [] })
    expect(!v.ok && v.reason).toMatch(/too short/)
  })
})

describe('canRemoveContact', () => {
  it('will not let somebody delete the address they sign in with', () => {
    const v = canRemoveContact(contact({ id: 'a', purpose: 'signin' }))
    expect(!v.ok && v.reason).toMatch(/lock you out/)
  })

  it('allows any other contact to go', () => {
    expect(canRemoveContact(contact({ id: 'a', purpose: 'technical' })).ok).toBe(true)
  })
})

describe('contactGaps', () => {
  it('names the purposes nobody is listed for, worst first', () => {
    const gaps = contactGaps([contact({ id: 'a', purpose: 'signin' })])
    expect(gaps.map(g => g.purpose)).toEqual(['settlement', 'disputes', 'escalation', 'technical', 'notices'])
  })

  it('says what each gap costs rather than that it is missing', () => {
    const gaps = contactGaps([])
    expect(gaps.find(g => g.purpose === 'disputes')!.ifMissing).toMatch(/decided without you/)
  })

  it('reports nothing once every purpose has somebody', () => {
    const all = CONTACT_PURPOSES
      .filter(p => p.id !== 'signin')
      .map((p, i) => contact({ id: `c${i}`, purpose: p.id, kind: p.allows[0] }))
    expect(contactGaps(all)).toEqual([])
  })
})

describe('unverified', () => {
  it('lists what has been recorded but never proved', () => {
    const rows = unverified([
      contact({ id: 'a' }),
      contact({ id: 'b', kind: 'phone', purpose: 'escalation', verified: false, verified_on: null }),
    ])
    expect(rows.map(r => r.id)).toEqual(['b'])
  })
})

describe('groupByPurpose', () => {
  it('returns every purpose, including the empty ones, so a gap is visible', () => {
    const groups = groupByPurpose([contact({ id: 'a', purpose: 'signin' })])
    expect(groups).toHaveLength(CONTACT_PURPOSES.length)
    expect(groups.find(g => g.spec.id === 'notices')!.rows).toEqual([])
  })
})

/* ------------------------------------------------------------------- bank -- */

describe('bankCodeFor', () => {
  it('asks for the thing the person is actually holding', () => {
    expect(bankCodeFor('India').local).toBe('IFSC')
    expect(bankCodeFor('Germany').local).toBe('Bankleitzahl')
  })

  it('knows where an IBAN is used and where it is not', () => {
    expect(bankCodeFor('Germany').iban).toBe(true)
    expect(bankCodeFor('India').iban).toBe(false)
  })

  it('falls back to something legible for a country it has never seen', () => {
    expect(bankCodeFor('Atlantis').local).toBe('Local clearing code')
  })
})

describe('showLocalCode', () => {
  it('shows a clearing code outright — it identifies a bank, not an account', () => {
    /* Masking it beside an unmasked BIC would be one card contradicting itself
       about what the secret is. */
    expect(showLocalCode('Germany', '50010517')).toBe('50010517')
    expect(showLocalCode('India', 'HDFC0001234')).toBe('HDFC0001234')
  })

  it('masks the one country whose local field carries an account number in it', () => {
    /* Brazil's "Agência/conta" is a branch and an account in one box. */
    expect(showLocalCode('Brazil', '0001 / 12345-6')).toBe('•••• 45-6')
  })
})

describe('validateBankChange', () => {
  it('accepts a complete, explained change', () => {
    expect(validateBankChange(draft(), bank())).toEqual({ ok: true })
  })

  it('catches a mistyped account number — the one typo that costs real money', () => {
    const v = validateBankChange(draft({ confirm: '500123456798' }), bank())
    expect(!v.ok && v.reason).toMatch(/sends money to a stranger/)
  })

  it('ignores spacing when comparing the two entries', () => {
    expect(validateBankChange(draft({ confirm: '5001 2345 6789' }), bank()).ok).toBe(true)
  })

  it('refuses a change to the account already on file', () => {
    const v = validateBankChange(draft({ account: '100668276720', confirm: '100668276720' }), bank())
    expect(!v.ok && v.reason).toMatch(/already on file/)
  })

  it('requires a reason, because an unexplained payout change is what a takeover looks like', () => {
    const v = validateBankChange(draft({ why: 'moved' }), bank())
    expect(!v.ok && v.reason).toMatch(/account takeover/)
  })

  it('will not take an account number with no bank behind it', () => {
    const v = validateBankChange(draft({ bank: '  ' }), bank())
    expect(!v.ok && v.reason).toMatch(/cannot be paid to/)
  })

  it('works for a seller who has no account on file yet', () => {
    expect(validateBankChange(draft(), null).ok).toBe(true)
  })
})

describe('pendingChange', () => {
  it('reports nothing in flight on a settled account', () => {
    expect(pendingChange(bank())).toEqual({ state: 'none' })
  })

  it('masks the destination of a change that is waiting', () => {
    const p = pendingChange(bank({
      pending_status: 'submitted', pending_account: '500123456789',
      pending_holder: 'Nimbus Sensors Ltd', pending_bank: 'Commerzbank',
      pending_why: 'Moved banks', pending_requested_on: '2026-07-30', pending_requested_by: 'Rajesh Kumar',
    }))
    expect(p).toMatchObject({ state: 'submitted', to: '•••• 6789', by: 'Rajesh Kumar' })
  })

  it('carries the marketplace’s reason back when a change was refused', () => {
    const p = pendingChange(bank({
      pending_status: 'rejected', pending_why: 'Moved banks',
      pending_note: 'The holder name does not match the registered entity.',
      pending_decided_on: '2026-07-31', pending_decided_by: 'Ruben Oyelaran',
    }))
    expect(p.state === 'rejected' && p.note).toMatch(/does not match/)
  })
})

describe('taxPosition', () => {
  const on = (d: string) => new Date(d + 'T00:00:00Z')

  it('is quiet while the certificate has months left', () => {
    const t = taxPosition(bank({ treaty_expires: '2027-03-31' }), on('2026-07-31'))
    expect(t.level).toBe('ok')
    expect(t.daysLeft).toBe(243)
  })

  it('warns inside the renewal window, because a certificate takes weeks to get', () => {
    const t = taxPosition(bank({ treaty_expires: '2026-09-15' }), on('2026-07-31'))
    expect(t.level).toBe('expiring')
    expect(t.daysLeft).toBe(46)
    expect(t.headline).toMatch(/expires in 46 days/)
  })

  it('treats the last day inside the window rather than outside it', () => {
    const t = taxPosition(bank({ treaty_expires: '2026-09-29' }), on('2026-07-31'))
    expect(t.daysLeft).toBe(RENEWAL_WINDOW_DAYS)
    expect(t.level).toBe('expiring')
  })

  it('says the rate resumed on its own once it has lapsed', () => {
    const t = taxPosition(bank({ treaty_expires: '2026-07-01' }), on('2026-07-31'))
    expect(t.level).toBe('expired')
    expect(t.detail).toMatch(/reclaimed from the authority/)
  })

  it('explains that withholding is not a marketplace charge when nothing is on file', () => {
    const t = taxPosition(bank({
      treaty_on_file: false, treaty_expires: null,
      withholding: '10% statutory — no certificate on file', residency: 'Brazil',
    }), on('2026-07-31'))
    expect(t.level).toBe('none')
    expect(t.detail).toMatch(/not a marketplace charge/)
  })

  it('handles a seller with no settlement record at all', () => {
    expect(taxPosition(null, on('2026-07-31')).level).toBe('none')
  })
})

/* ---------------------------------------------------------------- go-live -- */

describe('goLiveRows', () => {
  const categories = [
    { id: 'iot', name: 'IoT' },
    { id: 'device', name: 'Devices' },
    { id: 'security', name: 'Security' },
    { id: 'mobility', name: 'Mobility', self_apply: false },
  ]
  const approvals = [
    { category_id: 'iot', approved_at: '2024-09-27' },
    { category_id: 'device', approved_at: '2024-09-27' },
    { category_id: 'security', approved_at: null },
  ]
  const golive = [
    { category_id: 'iot', storefront_enabled: true, went_live_on: '2024-09-27', first_listing_on: '2024-09-27' },
    { category_id: 'device', storefront_enabled: true, went_live_on: '2024-09-27', first_listing_on: null },
  ]
  const listings = [
    { category_id: 'iot', status: 'live' },
    { category_id: 'iot', status: 'live' },
    { category_id: 'iot', status: 'pending' },
  ]

  it('puts the open-but-empty marketplace first — it is the one nobody notices', () => {
    const rows = goLiveRows(categories, approvals, golive, listings)
    expect(rows[0]).toMatchObject({ category_id: 'device', state: 'empty' })
    expect(rows[0].next).toMatch(/do not see you at all/)
  })

  it('counts live and in-review listings separately', () => {
    const iot = goLiveRows(categories, approvals, golive, listings).find(r => r.category_id === 'iot')!
    expect(iot).toMatchObject({ state: 'trading', live: 2, pending: 1, next: null })
  })

  it('says a marketplace with something in review is nearly there rather than empty', () => {
    const rows = goLiveRows(categories, approvals, golive,
      [{ category_id: 'device', status: 'pending' }])
    expect(rows.find(r => r.category_id === 'device')!.next).toMatch(/1 listing in review/)
  })

  it('shows an application as applied, not as available to apply for', () => {
    const sec = goLiveRows(categories, approvals, golive, listings).find(r => r.category_id === 'security')!
    expect(sec.state).toBe('applied')
  })

  it('does not invite a seller to apply where the marketplace places sellers itself', () => {
    const mob = goLiveRows(categories, approvals, golive, listings).find(r => r.category_id === 'mobility')!
    expect(mob.state).toBe('available')
    expect(mob.next).toMatch(/places sellers here itself/)
  })

  it('reports a paused storefront as the seller’s own doing, with the count it hides', () => {
    const paused = goLiveRows(categories, approvals, [
      { category_id: 'iot', storefront_enabled: false, went_live_on: '2024-09-27',
        first_listing_on: '2024-09-27', paused_reason: 'Rebuilding the range' },
    ], listings).find(r => r.category_id === 'iot')!
    expect(paused.state).toBe('paused')
    expect(paused.next).toMatch(/2 listings are hidden/)
    expect(paused.pausedReason).toBe('Rebuilding the range')
  })
})

describe('validatePause', () => {
  it('demands a reason, because a dark storefront becomes a support ticket', () => {
    const v = validatePause('', 3)
    expect(!v.ok && v.reason).toMatch(/support ticket/)
  })

  it('refuses to pause a marketplace with nothing published in it', () => {
    const v = validatePause('Rebuilding the range', 0)
    expect(!v.ok && v.reason).toMatch(/nothing published/)
  })

  it('accepts a reason against live stock', () => {
    expect(validatePause('Rebuilding the range for Q4', 3)).toEqual({ ok: true })
  })
})

/* -------------------------------------------------------------------- you -- */

describe('validateProfile', () => {
  it('requires a name, because it is what colleagues see against an action', () => {
    const v = validateProfile('  ', 'Ops lead')
    expect(!v.ok && v.reason).toMatch(/what colleagues see/)
  })

  it('requires a job title', () => {
    expect(validateProfile('Rajesh Kumar', '').ok).toBe(false)
  })

  it('accepts both filled in', () => {
    expect(validateProfile('Rajesh Kumar', 'Ops lead')).toEqual({ ok: true })
  })
})

describe('awayCover', () => {
  it('says work comes to you when you are here', () => {
    expect(awayCover(user({ id: 'a' }), [])).toMatch(/comes to you/)
  })

  it('warns that work simply waits when away with nobody covering', () => {
    const s = awayCover(user({ id: 'a', out_of_office: true }), [])
    expect(s).toMatch(/simply wait/)
  })

  it('names the delegate and keeps the audit trail honest about who acted', () => {
    const s = awayCover(
      user({ id: 'a', out_of_office: true, delegate_id: 'b' }),
      [user({ id: 'b', name: 'Priya Nair' })],
    )
    expect(s).toMatch(/Priya Nair can act in your place/)
    expect(s).toMatch(/who actually acted/)
  })
})

describe('canDelegate', () => {
  it('refuses yourself', () => {
    expect(canDelegate(user({ id: 'a' }), user({ id: 'a' })).ok).toBe(false)
  })

  it('refuses somebody whose account is suspended', () => {
    const v = canDelegate(user({ id: 'a' }), user({ id: 'b', name: 'Priya Nair', status: 'suspended' }))
    expect(!v.ok && v.reason).toMatch(/nothing would reach them/)
  })

  it('refuses somebody who cannot act, since the work would still wait', () => {
    const v = canDelegate(user({ id: 'a' }), user({ id: 'b', name: 'Sam', role: 'read_only' }))
    expect(!v.ok && v.reason).toMatch(/look but not act/)
  })

  it('accepts an active colleague who can act', () => {
    expect(canDelegate(user({ id: 'a' }), user({ id: 'b', role: 'fulfilment' })).ok).toBe(true)
  })
})

describe('securityGaps', () => {
  it('names the person rather than reporting a coverage percentage', () => {
    const gaps = securityGaps([
      user({ id: 'a' }),
      user({ id: 'b', name: 'Priya Nair', role: 'fulfilment', mfa: false }),
    ])
    expect(gaps).toHaveLength(1)
    expect(gaps[0]).toMatchObject({ who: 'Priya Nair', what: 'No multi-factor authentication' })
  })

  it('says plainly when the account with no MFA can move money', () => {
    const gaps = securityGaps([user({ id: 'a', name: 'Arjun Mehta', role: 'finance', mfa: false })])
    expect(gaps[0].why).toMatch(/can move money/)
  })

  it('flags an outstanding forced reset as a gap of its own', () => {
    const gaps = securityGaps([user({ id: 'a', must_reset: true })])
    expect(gaps.map(g => g.what)).toContain('Password reset outstanding')
  })

  it('flags more open sessions than anybody has devices', () => {
    const gaps = securityGaps([user({ id: 'a', sessions: 5 })])
    expect(gaps[0].what).toBe('5 sessions open')
  })

  it('ignores people whose accounts are not active', () => {
    expect(securityGaps([user({ id: 'a', status: 'suspended', mfa: false })])).toEqual([])
  })

  it('reports nothing when everybody is covered', () => {
    expect(securityGaps([user({ id: 'a' }), user({ id: 'b', sessions: 2 })])).toEqual([])
  })
})

describe('inviting a colleague', () => {
  const person = (over: Partial<PartnerUser>): PartnerUser => ({
    id: 'PU-1', partner_id: 'PTR-1004', name: 'Rajesh Kumar', email: 'rajesh.kumar@nimbussensors.com',
    job_title: 'Seller Operations', role: 'admin', status: 'active', joined: '2024-09-27',
    last_active: null, mfa: true, sessions: 1, pwd_changed: null, pwd_strength: null,
    must_reset: false, timezone: 'Asia/Kolkata (IST)', date_format: 'DD MMM YYYY',
    language: 'en', out_of_office: false, delegate_id: null, digest: 'daily', sort_order: 1, ...over,
  })

  const TEAM = [
    person({}),
    person({ id: 'PU-2', name: 'Sana Mirza', email: 'sana.mirza@nimbussensors.com', role: 'fulfilment' }),
  ]

  const draft = (over: Partial<InviteDraft> = {}): InviteDraft => ({
    ...blankInvite(), name: 'Devika Rao', email: 'devika.rao@nimbussensors.com',
    jobTitle: 'Warehouse lead', ...over,
  })

  it('accepts a colleague on the company domain', () => {
    const r = validateInvite(draft(), TEAM)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.note).toMatch(/invited until they accept/)
  })

  it('needs a name and a job title, because both are read off an audit row', () => {
    expect(validateInvite(draft({ name: ' ' }), TEAM).ok).toBe(false)
    expect(validateInvite(draft({ jobTitle: '' }), TEAM).ok).toBe(false)
  })

  it('refuses something that is not an address, quoting what was typed', () => {
    const r = validateInvite(draft({ email: 'devika at nimbus' }), TEAM)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toContain('devika at nimbus')
  })

  it('refuses somebody already on the account, saying what they are', () => {
    const r = validateInvite(draft({ email: 'SANA.MIRZA@nimbussensors.com' }), TEAM)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/already on this account as fulfilment operator/)
  })

  it('points a removed colleague at being restored rather than re-invited', () => {
    /* Re-inviting makes a second row, and their history stays on the first. */
    const r = validateInvite(draft({ email: 'sana.mirza@nimbussensors.com' }),
      [TEAM[0], person({ ...TEAM[1], status: 'removed' })])
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/Restore them/)
  })

  it('warns about a personal address without refusing it', () => {
    /* How somebody who has left keeps their access. A warning, because a
       company that genuinely uses a shared address should not be blocked. */
    const r = validateInvite(draft({ email: 'devika.rao@gmail.com' }), TEAM)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.note).toMatch(/cannot take back when they leave/)
  })

  it('refuses to remove the last admin, and says what would break', () => {
    const r = canRemove(TEAM[0], TEAM)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/last seller admin/)
  })

  it('allows removing an admin while another remains', () => {
    const two = [...TEAM, person({ id: 'PU-3', name: 'Arun Pillai', email: 'arun@nimbussensors.com', role: 'admin' })]
    expect(canRemove(two[0], two).ok).toBe(true)
  })

  it('allows removing anybody who is not an admin', () => {
    const r = canRemove(TEAM[1], TEAM)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.note).toMatch(/stays on the audit log/)
  })

  it('says so rather than removing somebody twice', () => {
    expect(canRemove(person({ ...TEAM[1], status: 'removed' }), TEAM).ok).toBe(false)
  })
})
