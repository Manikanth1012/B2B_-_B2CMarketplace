import { describe, it, expect } from 'vitest'
import {
  CAPABILITIES, roleOf, roleName, holders, may, summariseRole,
  validateInvite, validateRoleChange, validateStatusChange,
  validateRole, validateRoleDelete, securityGaps, daysBetween,
  passwordProblems, passwordStrength, validatePassword,
  validateDelegate, delegateOptions, creditPosition, creditReview,
  onboardingProgress, auditTrail, maskAccount, maskTail, maskTaxId, when,
} from './enterpriseAdmin'
import type { EnterpriseRole, Person, Billing, OnboardingCheck, RoleDraft } from './enterpriseAdmin'

/* ------------------------------------------------------------- fixtures -- */

function role(over: Partial<EnterpriseRole> = {}): EnterpriseRole {
  return {
    id: 'buyer', account_id: 'ENT-2007', name: 'Buyer', description: 'Raises things.',
    system: true, can_raise: true, approves_finance: false, approves_it: false,
    approve_limit: null, can_view_billing: false, can_reveal_bank: false,
    can_manage_users: false, can_set_policy: false, mfa_required: false, sort_order: 4,
    ...over,
  }
}

const LEAD = role({
  id: 'procurement-lead', name: 'Procurement lead', approves_finance: true, approves_it: true,
  can_view_billing: true, can_reveal_bank: true, can_manage_users: true, can_set_policy: true,
  mfa_required: true, sort_order: 1,
})
const FIN = role({
  id: 'finance-approver', name: 'Finance approver', can_raise: false, approves_finance: true,
  approve_limit: 25000, can_view_billing: true, can_reveal_bank: true, mfa_required: true, sort_order: 2,
})
const IT = role({ id: 'it-approver', name: 'IT sign-off', approves_it: true, mfa_required: true, sort_order: 3 })
const BUYER = role()
const VIEWER = role({ id: 'viewer', name: 'Viewer', can_raise: false, can_view_billing: true, sort_order: 5 })
const ROLES = [LEAD, FIN, IT, BUYER, VIEWER]

function person(over: Partial<Person> = {}): Person {
  return {
    id: 'EU-2007-04', account_id: 'ENT-2007', user_id: null, name: 'Anita Desai',
    email: 'anita.desai@smartbuild.in', title: 'Site buyer', role: 'buyer',
    can_raise: true, approves_finance: false, approves_it: false, approve_limit: null,
    cost_centre: 'CC-RETAIL', phone: null, mfa: true, status: 'active', sort_order: 4,
    user_ref: 'USR-2007-04', joined: '2026-02-02', timezone: 'Asia/Kolkata (IST)',
    language: 'English', date_format: 'DD MMM YYYY', mfa_method: 'Authenticator app',
    must_reset: false, last_sign_in: '2026-08-01T08:40:00Z', password_changed: '2026-02-02',
    out_of_office: false, delegate_id: null, invited_by: null, invited_on: null,
    ...over,
  }
}

const VIKRAM = person({ id: 'EU-01', name: 'Vikram Shah', email: 'vikram.shah@smartbuild.in', role: 'procurement-lead', approves_finance: true, approves_it: true, sort_order: 1 })
const MEERA = person({ id: 'EU-02', name: 'Meera Iyer', email: 'meera.iyer@smartbuild.in', role: 'finance-approver', can_raise: false, approves_finance: true, approve_limit: 25000, sort_order: 2 })
const KARTHIK = person({ id: 'EU-03', name: 'Karthik Nair', email: 'karthik.nair@smartbuild.in', role: 'it-approver', approves_it: true, mfa: false, mfa_method: null, password_changed: '2025-09-15', sort_order: 3 })
const ANITA = person()
const SUNITA = person({ id: 'EU-06', name: 'Sunita Rao', email: 'sunita.rao@smartbuild.in', role: 'viewer', can_raise: false, status: 'invited', mfa: false, mfa_method: null, must_reset: true, last_sign_in: null, password_changed: null, sort_order: 6 })
const TEAM: Person[] = [VIKRAM, MEERA, KARTHIK, ANITA, SUNITA]

const TODAY = '2026-08-01'

/* ------------------------------------------------------------- the basics -- */

describe('reading a role', () => {
  it('finds the role somebody holds', () => {
    expect(roleOf(MEERA, ROLES)?.name).toBe('Finance approver')
    expect(roleOf(null, ROLES)).toBeNull()
  })

  it('falls back to the id when the role is not on the account', () => {
    expect(roleName('site-manager', ROLES)).toBe('site-manager')
    expect(roleName('viewer', ROLES)).toBe('Viewer')
  })

  it('counts holders but not people who were removed', () => {
    const gone = person({ id: 'EU-07', role: 'buyer', status: 'removed' })
    expect(holders('buyer', [...TEAM, gone]).map(p => p.id)).toEqual(['EU-2007-04'])
  })

  it('asks the role, never the copy on the person', () => {
    /* Karthik's own row says he approves IT. The role is what counts. */
    expect(may(KARTHIK, ROLES, 'approves_it')).toBe(true)
    expect(may(KARTHIK, ROLES, 'can_manage_users')).toBe(false)
    expect(may(null, ROLES, 'can_manage_users')).toBe(false)
  })

  it('says what a role adds up to in one line', () => {
    expect(summariseRole(LEAD, 'USD')).toBe('raises, approves any value, signs off on security, manages people, sets policy')
    expect(summariseRole(FIN, 'USD')).toBe('approves up to USD 25,000')
    expect(summariseRole(VIEWER, 'USD')).toBe('reads the account, changes nothing')
  })

  it('governs the capabilities the screen shows', () => {
    expect(CAPABILITIES.map(c => c.key)).toContain('can_reveal_bank')
    expect(new Set(CAPABILITIES.map(c => c.key)).size).toBe(CAPABILITIES.length)
  })
})

/* ---------------------------------------------------------------- invites -- */

describe('inviting a colleague', () => {
  const draft = { name: 'Rohit Menon', email: 'rohit.menon@smartbuild.in', title: 'Buyer', role: 'buyer', cost_centre: 'CC-1000' }

  it('lets an administrator invite', () => {
    expect(validateInvite(draft, ROLES, TEAM, VIKRAM).ok).toBe(true)
  })

  it('refuses anybody who does not manage people', () => {
    const c = validateInvite(draft, ROLES, TEAM, ANITA)
    expect(c.ok).toBe(false)
    if (!c.ok) expect(c.reason).toMatch(/manages people/i)
  })

  it('needs a name and a real address', () => {
    expect(validateInvite({ ...draft, name: '  ' }, ROLES, TEAM, VIKRAM).ok).toBe(false)
    expect(validateInvite({ ...draft, email: 'rohit@' }, ROLES, TEAM, VIKRAM).ok).toBe(false)
  })

  it('refuses a second account on an address already here', () => {
    const c = validateInvite({ ...draft, email: 'MEERA.IYER@smartbuild.in' }, ROLES, TEAM, VIKRAM)
    expect(c.ok).toBe(false)
    if (!c.ok) expect(c.reason).toMatch(/already on this account/i)
  })

  it('points at the outstanding invitation rather than making a duplicate', () => {
    const c = validateInvite({ ...draft, email: 'sunita.rao@smartbuild.in' }, ROLES, TEAM, VIKRAM)
    expect(c.ok).toBe(false)
    if (!c.ok) expect(c.reason).toMatch(/resend/i)
  })

  it('reuses an address only once the person has actually gone', () => {
    const gone = person({ id: 'EU-08', name: 'Old Hand', email: 'reuse@smartbuild.in', status: 'removed' })
    expect(validateInvite({ ...draft, email: 'reuse@smartbuild.in' }, ROLES, [...TEAM, gone], VIKRAM).ok).toBe(true)
  })

  it('needs a role that exists', () => {
    expect(validateInvite({ ...draft, role: 'nonesuch' }, ROLES, TEAM, VIKRAM).ok).toBe(false)
  })

  it('warns about an outside address without refusing it', () => {
    const c = validateInvite({ ...draft, email: 'contractor@buildworks.co' }, ROLES, TEAM, VIKRAM)
    expect(c.ok).toBe(true)
    if (c.ok) expect(c.note).toMatch(/outside smartbuild\.in/i)
  })

  it('warns that an approving role will need a second factor', () => {
    const c = validateInvite({ ...draft, role: 'finance-approver' }, ROLES, TEAM, VIKRAM)
    expect(c.ok).toBe(true)
    if (c.ok) expect(c.note).toMatch(/second factor/i)
  })
})

/* ------------------------------------------------------------ role changes -- */

describe('changing somebody’s role', () => {
  it('allows an ordinary move and says what changes', () => {
    const c = validateRoleChange(ANITA, 'it-approver', VIKRAM, ROLES, TEAM)
    expect(c.ok).toBe(true)
    if (c.ok) expect(c.note).toMatch(/gains sign off on security/i)
  })

  it('warns only when the new role needs a second factor they do not have', () => {
    const noMfa = person({ ...ANITA, mfa: false, mfa_method: null })
    const c = validateRoleChange(noMfa, 'it-approver', VIKRAM, ROLES, TEAM)
    expect(c.ok).toBe(true)
    if (c.ok) expect(c.note).toMatch(/second factor/i)
    /* Anita already has one, so telling her to set one up would be noise. */
    const has = validateRoleChange(ANITA, 'it-approver', VIKRAM, ROLES, TEAM)
    if (has.ok) expect(has.note).not.toMatch(/second factor/i)
  })

  it('names what a move takes away as well as what it gives', () => {
    const c = validateRoleChange(MEERA, 'buyer', VIKRAM, ROLES, TEAM.concat(person({ id: 'EU-21', name: 'Spare', role: 'procurement-lead', approves_finance: true })))
    expect(c.ok).toBe(true)
    if (c.ok) expect(c.note).toMatch(/loses approve on value/i)
  })

  it('refuses somebody moving their own role, even the administrator', () => {
    /* Vikram is the one person here who *could* do it — which is exactly why
       the check has to be in front of him rather than behind the permission. */
    const c = validateRoleChange(VIKRAM, 'finance-approver', VIKRAM, ROLES, TEAM)
    expect(c.ok).toBe(false)
    if (!c.ok) expect(c.reason).toMatch(/cannot change your own role/i)
  })

  it('refuses anybody who does not manage people', () => {
    expect(validateRoleChange(ANITA, 'viewer', KARTHIK, ROLES, TEAM).ok).toBe(false)
  })

  it('refuses a move to a role that is not there, or a move to nowhere', () => {
    expect(validateRoleChange(ANITA, 'site-manager', VIKRAM, ROLES, TEAM).ok).toBe(false)
    const same = validateRoleChange(ANITA, 'buyer', VIKRAM, ROLES, TEAM)
    expect(same.ok).toBe(false)
    if (!same.ok) expect(same.reason).toMatch(/already holds/i)
  })

  it('will not leave the account with nobody who can approve on value', () => {
    /* Vikram moves Meera down first; then he is the last approver, and the
       one demoting him is a second administrator. */
    const admin = person({ id: 'EU-09', name: 'Deepa Rao', email: 'd@smartbuild.in', role: 'procurement-lead', approves_finance: true, sort_order: 9 })
    const two = [VIKRAM, KARTHIK, ANITA, admin]
    const c = validateRoleChange(VIKRAM, 'buyer', admin, ROLES, two.filter(p => p.id !== admin.id).concat(admin))
    expect(c.ok).toBe(true)     // Deepa still approves

    const alone = [VIKRAM, KARTHIK, ANITA]
    const solo = person({ ...ANITA, role: 'procurement-lead', id: 'EU-10', name: 'Nobody Else' })
    void solo
    const c2 = validateRoleChange(VIKRAM, 'buyer', person({ id: 'EU-11', name: 'Ops', role: 'procurement-lead' }), ROLES, alone)
    expect(c2.ok).toBe(false)
    if (!c2.ok) expect(c2.reason).toMatch(/only person left who can approve/i)
  })

  it('will not leave the account with nobody who can manage people', () => {
    const noOtherAdmin = [VIKRAM, MEERA, ANITA]
    const c = validateRoleChange(VIKRAM, 'finance-approver', person({ id: 'EU-12', name: 'Ops', role: 'procurement-lead' }), ROLES, noOtherAdmin)
    expect(c.ok).toBe(false)
    if (!c.ok) expect(c.reason).toMatch(/lock this account out/i)
  })

  it('refuses to edit somebody who has already gone', () => {
    const gone = person({ ...ANITA, status: 'removed' })
    expect(validateRoleChange(gone, 'viewer', VIKRAM, ROLES, TEAM).ok).toBe(false)
  })
})

/* ---------------------------------------------------------- suspend/remove -- */

describe('suspending and removing', () => {
  it('suspends an ordinary colleague and says what it means', () => {
    const c = validateStatusChange(ANITA, 'suspended', VIKRAM, ROLES, TEAM)
    expect(c.ok).toBe(true)
    if (c.ok) expect(c.note).toMatch(/keeps their record/i)
  })

  it('says removal keeps the history', () => {
    const c = validateStatusChange(ANITA, 'removed', VIKRAM, ROLES, TEAM)
    expect(c.ok).toBe(true)
    if (c.ok) expect(c.note).toMatch(/stays on the account with their name/i)
  })

  it('refuses suspending yourself', () => {
    const c = validateStatusChange(VIKRAM, 'suspended', VIKRAM, ROLES, TEAM)
    expect(c.ok).toBe(false)
    if (!c.ok) expect(c.reason).toMatch(/cannot suspend or remove yourself/i)
  })

  it('will not suspend the only approver', () => {
    const c = validateStatusChange(MEERA, 'suspended', VIKRAM, ROLES, [MEERA, ANITA, person({ id: 'EU-13', name: 'Ops', role: 'buyer' })])
    expect(c.ok).toBe(false)
    if (!c.ok) expect(c.reason).toMatch(/only person who can approve/i)
  })

  it('will not remove the only administrator', () => {
    const other = person({ id: 'EU-14', name: 'Ops', role: 'procurement-lead', approves_finance: true })
    const c = validateStatusChange(VIKRAM, 'removed', other, ROLES, [VIKRAM, MEERA, ANITA])
    expect(c.ok).toBe(false)
    if (!c.ok) expect(c.reason).toMatch(/no administrator/i)
  })

  it('does not pretend an invitation can be accepted on somebody’s behalf', () => {
    const c = validateStatusChange(SUNITA, 'active', VIKRAM, ROLES, TEAM)
    expect(c.ok).toBe(false)
    if (!c.ok) expect(c.reason).toMatch(/accepting their invitation/i)
  })

  it('refuses a change that changes nothing', () => {
    expect(validateStatusChange(ANITA, 'active', VIKRAM, ROLES, TEAM).ok).toBe(false)
  })
})

/* -------------------------------------------------------------- role edits -- */

describe('editing what a role may do', () => {
  const draft: RoleDraft = {
    name: 'Site manager', description: 'Runs a site.', can_raise: true,
    approves_finance: false, approves_it: false, approve_limit: null,
    can_view_billing: false, can_reveal_bank: false, can_manage_users: false,
    can_set_policy: false, mfa_required: false,
  }

  it('saves a plain new role', () => {
    expect(validateRole(draft, ROLES, VIKRAM).ok).toBe(true)
  })

  it('refuses anybody who cannot set policy', () => {
    const c = validateRole(draft, ROLES, MEERA)
    expect(c.ok).toBe(false)
    if (!c.ok) expect(c.reason).toMatch(/set policy/i)
  })

  it('needs a name, and not one already in use', () => {
    expect(validateRole({ ...draft, name: ' ' }, ROLES, VIKRAM).ok).toBe(false)
    const c = validateRole({ ...draft, name: 'viewer' }, ROLES, VIKRAM)
    expect(c.ok).toBe(false)
    if (!c.ok) expect(c.reason).toMatch(/already a role called/i)
  })

  it('lets a role keep its own name when it is edited', () => {
    expect(validateRole({ ...draft, name: 'Viewer', id: 'viewer' }, ROLES, VIKRAM, VIEWER).ok).toBe(true)
  })

  it('refuses approval without a second factor', () => {
    const c = validateRole({ ...draft, approves_finance: true, mfa_required: false }, ROLES, VIKRAM)
    expect(c.ok).toBe(false)
    if (!c.ok) expect(c.reason).toMatch(/second factor/i)
    expect(validateRole({ ...draft, approves_finance: true, mfa_required: true }, ROLES, VIKRAM).ok).toBe(true)
  })

  it('refuses a limit on a role that does not approve on value', () => {
    const c = validateRole({ ...draft, approve_limit: 5000 }, ROLES, VIKRAM)
    expect(c.ok).toBe(false)
    if (!c.ok) expect(c.reason).toMatch(/only means something/i)
  })

  it('refuses a negative limit', () => {
    expect(validateRole({ ...draft, approves_finance: true, mfa_required: true, approve_limit: -1 }, ROLES, VIKRAM).ok).toBe(false)
  })

  /* The self-widening ban only ever fires on somebody who can set policy — and
     the built-in lead already holds everything, so it takes a company that has
     made its own limited administrator to reach it. Which is exactly the
     account that needs it. */
  const ADMIN = role({
    id: 'policy-admin', name: 'Policy admin', system: false, approves_finance: true,
    approve_limit: 40000, can_view_billing: true, can_manage_users: true,
    can_set_policy: true, mfa_required: true, sort_order: 6,
  })
  const HOLDER = person({ id: 'EU-20', name: 'Deepa Rao', role: 'policy-admin', approves_finance: true, approve_limit: 40000 })
  const WITH_ADMIN = [...ROLES, ADMIN]
  const own = (over: Partial<RoleDraft>): RoleDraft => ({
    ...draft, name: 'Policy admin', approves_finance: true, mfa_required: true,
    can_view_billing: true, can_manage_users: true, can_set_policy: true,
    approve_limit: 40000, ...over,
  })

  it('will not let somebody widen the role they hold themselves', () => {
    const c = validateRole(own({ approve_limit: 90000 }), WITH_ADMIN, HOLDER, ADMIN)
    expect(c.ok).toBe(false)
    if (!c.ok) expect(c.reason).toMatch(/Somebody else has to widen it/i)
  })

  it('refuses reaching for the bank details on your own role', () => {
    expect(validateRole(own({ can_reveal_bank: true }), WITH_ADMIN, HOLDER, ADMIN).ok).toBe(false)
  })

  it('lets somebody narrow the role they hold', () => {
    expect(validateRole(own({ approve_limit: 10000 }), WITH_ADMIN, HOLDER, ADMIN).ok).toBe(true)
  })

  it('treats removing a limit as the widest step there is', () => {
    expect(validateRole(own({ approve_limit: null }), WITH_ADMIN, HOLDER, ADMIN).ok).toBe(false)
  })

  it('lets somebody else widen it', () => {
    expect(validateRole(own({ approve_limit: 90000 }), WITH_ADMIN, VIKRAM, ADMIN).ok).toBe(true)
  })
})

describe('deleting a role', () => {
  const custom = role({ id: 'site-manager', name: 'Site manager', system: false })

  it('deletes a custom role nobody holds', () => {
    const c = validateRoleDelete(custom, TEAM, VIKRAM, ROLES)
    expect(c.ok).toBe(true)
    if (c.ok) expect(c.note).toMatch(/held by nobody/i)
  })

  it('refuses a built-in role', () => {
    const c = validateRoleDelete(VIEWER, TEAM, VIKRAM, ROLES)
    expect(c.ok).toBe(false)
    if (!c.ok) expect(c.reason).toMatch(/edited but not deleted/i)
  })

  it('names the people who would be left with nothing', () => {
    const held = [...TEAM, person({ id: 'EU-15', name: 'Priya Kumar', role: 'site-manager' })]
    const c = validateRoleDelete(custom, held, VIKRAM, ROLES)
    expect(c.ok).toBe(false)
    if (!c.ok) expect(c.reason).toMatch(/Priya Kumar/)
  })

  it('refuses anybody who cannot set policy', () => {
    expect(validateRoleDelete(custom, TEAM, ANITA, ROLES).ok).toBe(false)
  })
})

/* --------------------------------------------------------------- security -- */

describe('what is outstanding on security', () => {
  const gaps = securityGaps(TEAM, ROLES, TODAY)

  it('puts the missing second factor on an approving role first', () => {
    expect(gaps[0].kind).toBe('mfa')
    expect(gaps[0].member.name).toBe('Karthik Nair')
    expect(gaps[0].what).toMatch(/auditor picks up first/i)
  })

  it('flags the invitation that has not been taken up', () => {
    expect(gaps.some(g => g.kind === 'reset' && g.member.name === 'Sunita Rao')).toBe(true)
  })

  it('does not nag about a second factor on a role that does not need one', () => {
    const casual = securityGaps([person({ ...ANITA, mfa: false, mfa_method: null })], ROLES, TODAY)
    expect(casual[0].what).toMatch(/worth having/i)
  })

  it('notices a password nobody has touched in a year', () => {
    const stale = securityGaps([person({ ...ANITA, password_changed: '2024-01-01' })], ROLES, TODAY)
    expect(stale.some(g => g.kind === 'stale-password')).toBe(true)
  })

  it('says nothing about somebody who has left', () => {
    expect(securityGaps([person({ ...KARTHIK, status: 'removed' })], ROLES, TODAY)).toEqual([])
  })

  it('counts days the way a calendar does', () => {
    expect(daysBetween('2026-07-25', '2026-08-01')).toBe(7)
    expect(daysBetween('2026-08-05', '2026-08-01')).toBe(-4)
  })
})

describe('passwords', () => {
  it('says exactly what is missing', () => {
    expect(passwordProblems('abc')).toEqual(['needs 9 more characters', 'needs upper and lower case', 'needs a number', 'needs a symbol'])
    expect(passwordProblems('Sh0rt!Passw0rd')).toEqual([])
  })

  it('gets the singular right on the last character', () => {
    expect(passwordProblems('Abcdefgh1jk!')[0]).toBeUndefined()
    expect(passwordProblems('Abcdefgh1j!')).toContain('needs 1 more character')
  })

  it('scores strength without pretending it is precise', () => {
    expect(passwordStrength('').label).toBe('')
    expect(passwordStrength('password').label).toBe('Weak')
    expect(passwordStrength('Sh0rt!Passw0rd').label).toBe('Strong')
    expect(passwordStrength('Sh0rt!Passw0rdLonger').label).toBe('Very strong')
  })

  it('refuses a mismatch after the policy passes', () => {
    const c = validatePassword('Sh0rt!Passw0rd', 'Sh0rt!Passw0rdX')
    expect(c.ok).toBe(false)
    if (!c.ok) expect(c.reason).toMatch(/do not match/i)
  })

  it('accepts one that meets the policy', () => {
    const c = validatePassword('Sh0rt!Passw0rd', 'Sh0rt!Passw0rd')
    expect(c.ok).toBe(true)
    if (c.ok) expect(c.note).toMatch(/including support/i)
  })
})

/* ------------------------------------------------------------- delegation -- */

describe('handing work over', () => {
  it('says a delegation is not a promotion', () => {
    const c = validateDelegate(MEERA, ANITA.id, TEAM, ROLES, 'USD')
    expect(c.ok).toBe(true)
    if (c.ok) expect(c.note).toMatch(/cannot approve on value/i)
  })

  it('names the ceiling when the delegate can approve', () => {
    const c = validateDelegate(MEERA, person({ ...ANITA, role: 'finance-approver' }).id, TEAM.map(p => p.id === ANITA.id ? { ...p, role: 'finance-approver' } : p), ROLES, 'USD')
    expect(c.ok).toBe(true)
    if (c.ok) expect(c.note).toMatch(/USD 25,000/)
  })

  it('refuses yourself, somebody suspended and somebody also away', () => {
    expect(validateDelegate(MEERA, MEERA.id, TEAM, ROLES, 'USD').ok).toBe(false)
    const off = TEAM.map(p => p.id === ANITA.id ? { ...p, status: 'suspended' as const } : p)
    expect(validateDelegate(MEERA, ANITA.id, off, ROLES, 'USD').ok).toBe(false)
    const away = TEAM.map(p => p.id === ANITA.id ? { ...p, out_of_office: true } : p)
    expect(validateDelegate(MEERA, ANITA.id, away, ROLES, 'USD').ok).toBe(false)
  })

  it('says plainly what happens with no delegate at all', () => {
    const c = validateDelegate(MEERA, null, TEAM, ROLES, 'USD')
    expect(c.ok).toBe(true)
    if (c.ok) expect(c.note).toMatch(/waits until you are back/i)
  })

  it('offers only colleagues who are here', () => {
    const away = TEAM.map(p => p.id === KARTHIK.id ? { ...p, out_of_office: true } : p)
    expect(delegateOptions(MEERA, away).map(p => p.id)).toEqual(['EU-01', 'EU-2007-04'])
  })
})

/* --------------------------------------------------------- credit position -- */

const BILLING: Billing = {
  account_id: 'ENT-2007', method: 'Direct debit', bank: 'HDFC Bank', holder: 'SmartBuild',
  account_number: '50100338612907', local_label: 'IFSC', local_code: 'HDFC0000521',
  mandate_ref: 'HDFC0009114882', mandate_signed_on: '2025-08-06', mandate_signed_by: 'Meera Iyer',
  verified: true, verified_on: '2025-08-07', verified_by: 'Ruben Oyelaran',
  fallback: 'Bank transfer', terms: 'Invoice, net 30', billing_contact: 'ap@smartbuild.in',
  invoice_delivery: 'Email', credit_limit: 120000, credit_reviewed: '2026-04-05',
  credit_review_due: '2027-04-05', at_limit_note: 'Held, not refused.', currency: 'USD',
}

describe('the credit position', () => {
  it('counts what is owed, not what was spent', () => {
    const pos = creditPosition(BILLING, [
      { total: 10000, status: 'open' }, { total: 6055.76, status: 'overdue' },
      { total: 40000, status: 'paid' }, { total: 2000, status: 'credited' },
    ], 'USD')
    expect(pos.committed).toBe(16055.76)
    expect(pos.headroom).toBe(103944.24)
    expect(pos.pct).toBe(13.4)
    expect(pos.state).toBe('clear')
  })

  it('counts a disputed invoice — it is still owed until it is credited', () => {
    const pos = creditPosition(BILLING, [{ total: 100000, status: 'disputed' }], 'USD')
    expect(pos.committed).toBe(100000)
    expect(pos.state).toBe('watch')
    expect(pos.note).toMatch(/would take this past the limit/i)
  })

  it('says what happens at the limit in the account’s own words', () => {
    const pos = creditPosition(BILLING, [{ total: 130000, status: 'open' }], 'USD')
    expect(pos.state).toBe('at-limit')
    expect(pos.headroom).toBe(-10000)
    expect(pos.note).toMatch(/Held, not refused/)
  })

  it('does not divide by a limit of nothing', () => {
    expect(creditPosition({ ...BILLING, credit_limit: 0 }, [{ total: 10, status: 'open' }], 'USD').pct).toBe(0)
  })

  it('reads the review date forwards and backwards', () => {
    expect(creditReview(BILLING, TODAY).overdue).toBe(false)
    expect(creditReview(BILLING, TODAY).note).toMatch(/due in 247 days/)
    const late = creditReview({ ...BILLING, credit_review_due: '2026-07-01' }, TODAY)
    expect(late.overdue).toBe(true)
    expect(late.note).toMatch(/current limit stands/i)
    expect(creditReview({ ...BILLING, credit_review_due: null }, TODAY).due).toBeNull()
  })
})

/* --------------------------------------------------------------- the record -- */

describe('what was checked when the account was opened', () => {
  const checks: OnboardingCheck[] = [
    { id: '1', account_id: 'ENT-2007', name: 'Company verification', detail: '', state: 'done', done_on: '2025-07-28', done_by: 'Lena Fischer', due_on: null, documents: [{ name: 'Certificate', kind: 'PDF', size: '1.2 MB' }], document_paths: ['ENT-2007/onboarding/1-1.pdf'], sort_order: 1 },
    { id: '2', account_id: 'ENT-2007', name: 'Annual credit review', detail: '', state: 'due', done_on: null, done_by: null, due_on: '2027-04-05', documents: [], document_paths: [], sort_order: 2 },
  ]

  it('counts what is done and hands back what is not', () => {
    const p = onboardingProgress(checks)
    expect(p).toMatchObject({ done: 1, total: 2 })
    expect(p.outstanding.map(c => c.name)).toEqual(['Annual credit review'])
  })
})

describe('the audit trail', () => {
  const REQS = [
    { id: 'REQ-5462', title: 'CloudZTNA seats', raised_by: 'EU-2007-04', raised_on: '2026-04-28', amount: 6800, state: 'approved', decided_by: 'EU-02', decided_on: '2026-04-30', decision_note: 'Within budget.', order_ref: 'ORD-882088' },
    { id: 'REQ-5501', title: 'Sensor spares', raised_by: 'EU-2007-05', raised_on: '2026-07-20', amount: 900, state: 'pending', decided_by: null, decided_on: null, decision_note: null, order_ref: null },
  ]
  const INVOICES = [
    { id: 'INV-0613', total: 8420.5, status: 'paid', paid_on: '2026-06-14', period: '2026-05', note: null },
    { id: 'INV-0701', total: 6055.76, status: 'disputed', paid_on: null, period: '2026-07', note: 'Seat count wrong' },
  ]

  const trail = auditTrail({ requisitions: REQS, invoices: INVOICES, people: TEAM }, 'USD')

  it('names people from the account rather than from memory, on both sides of a decision', () => {
    expect(trail.find(e => e.action === 'Raised a requisition' && e.detail.startsWith('REQ-5462'))?.who).toBe('Anita Desai')
    expect(trail.find(e => e.action === 'Approved a requisition')?.who).toBe('Meera Iyer')
  })

  it('reads newest first', () => {
    const dates = trail.map(e => e.when)
    expect([...dates].sort().reverse()).toEqual(dates)
  })

  it('records a decision as well as the request, and the order it placed', () => {
    const decided = trail.find(e => e.action === 'Approved a requisition')
    expect(decided?.detail).toMatch(/ordered as ORD-882088/)
    expect(decided?.severity).toBe('high')
  })

  it('says nothing about a decision that has not happened', () => {
    expect(trail.filter(e => e.detail.startsWith('REQ-5501'))).toHaveLength(1)
  })

  it('carries the money and the dispute', () => {
    expect(trail.find(e => e.action === 'Invoice paid')?.detail).toMatch(/USD 8,420\.50/)
    expect(trail.find(e => e.action === 'Invoice disputed')?.detail).toMatch(/Seat count wrong/)
  })

  it('records how somebody arrived, once', () => {
    const sunita = trail.filter(e => e.detail.includes('Sunita Rao') || e.who === 'Sunita Rao')
    expect(sunita).toHaveLength(1)
  })

  it('does not run away with itself', () => {
    expect(auditTrail({ requisitions: REQS, invoices: INVOICES, people: TEAM }, 'USD', 3)).toHaveLength(3)
  })
})

describe('masking', () => {
  it('shows enough of an account number to recognise and not enough to quote', () => {
    expect(maskAccount('50100338612907')).toBe('••••••••••2907')
    expect(maskAccount('1234')).toBe('1234')
    expect(maskAccount(null)).toBe('—')
  })

  it('keeps the tail of a code', () => {
    expect(maskTail('HDFC0000521', 3)).toBe('••••••••521')
    expect(maskTail('ab', 3)).toBe('ab')
  })

  it('leaves the public part of a tax id readable', () => {
    expect(maskTaxId('29AAJCS4718R1ZM')).toBe('29•••••••••R1ZM')
    expect(maskTaxId('P051772913X')).toBe('P0•••••913X')
    expect(maskTaxId('ABC123')).toBe('ABC123')
  })
})

describe('saying when', () => {
  const now = new Date('2026-08-01T12:00:00Z')

  it('is relative while relative still helps', () => {
    expect(when('2026-08-01T09:12:00Z', now)).toMatch(/^Today /)
    expect(when('2026-07-31T16:40:00Z', now)).toMatch(/^Yesterday /)
    expect(when('2026-07-29T11:05:00Z', now)).toBe('3 days ago')
  })

  it('is a date once it stops helping', () => {
    expect(when('2026-07-19T10:02:00Z', now)).toBe('19 Jul 2026')
  })

  it('says never rather than an empty cell', () => {
    expect(when(null, now)).toBe('Never')
    expect(when('not a date', now)).toBe('Never')
  })
})
