/* Touches the live Supabase project.
 *
 * The claims here are the ones RLS alone cannot make. RLS can say "this row
 * belongs to your account"; it cannot say "you may not promote yourself" or
 * "you may not leave this account with nobody who can approve", because both
 * compare the row being written against the person writing it. Those live in
 * `guard_enterprise_user()` and `guard_enterprise_role()` precisely so a
 * client cannot go round them — so they have to be checked from a client.
 *
 * Everything written here is undone in the same file. A test that leaves a
 * suspended colleague behind breaks the next person to open the demo.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { supabase } from './supabase'
import { signIn, signOut } from './authRepo'
import {
  loadAdmin, inviteMember, changeRole, changeStatus, saveRole, deleteRole,
  setAway, setDelegate, setMfa,
} from './enterpriseAdminRepo'
import type { AdminBook } from './enterpriseAdminRepo'
import { creditPosition, onboardingProgress, securityGaps, may, holders } from './enterpriseAdmin'
import { loadAccount } from './enterpriseRepo'

const ENTERPRISE = { email: 'vikram.shah@smartbuild.in', password: 'enterprise123' }
const OPERATOR = { email: 'anika.sharma@aventa.com', password: 'operator123' }
const ACCOUNT = 'ENT-2007'
const TODAY = new Date().toISOString().slice(0, 10)

describe('roles and people, as the procurement lead sees them', () => {
  let book: AdminBook

  beforeAll(async () => {
    await signIn(ENTERPRISE.email, ENTERPRISE.password)
    book = await loadAdmin()
    expect(book.loadError).toBeUndefined()
  })

  afterAll(async () => { await signOut() })

  it('knows who is signed in and what their role lets them do', () => {
    expect(book.me?.name).toBe('Vikram Shah')
    expect(may(book.me, book.roles, 'can_manage_users')).toBe(true)
    expect(may(book.me, book.roles, 'can_set_policy')).toBe(true)
    expect(may(book.me, book.roles, 'can_reveal_bank')).toBe(true)
  })

  it('sees only its own account’s roles, people, sessions and record', () => {
    expect(book.roles.every(r => r.account_id === ACCOUNT)).toBe(true)
    expect(book.people.every(p => p.account_id === ACCOUNT)).toBe(true)
    expect(book.sessions.every(s => s.account_id === ACCOUNT)).toBe(true)
    expect(book.onboarding.every(o => o.account_id === ACCOUNT)).toBe(true)
    expect(book.billing?.account_id).toBe(ACCOUNT)
  })

  it('never returns another account’s roles, however it asks', async () => {
    const { data } = await supabase.from('enterprise_roles').select('account_id')
    expect(new Set(data!.map(r => r.account_id))).toEqual(new Set([ACCOUNT]))
  })

  it('holds every permission on the role, not a second copy on the person', () => {
    for (const p of book.people) {
      const r = book.roles.find(x => x.id === p.role)
      expect(r, `${p.name} holds a role that is not on this account`).toBeDefined()
      expect(p.can_raise).toBe(r!.can_raise)
      expect(p.approves_finance).toBe(r!.approves_finance)
      expect(p.approves_it).toBe(r!.approves_it)
      expect(p.approve_limit).toBe(r!.approve_limit === null ? null : Number(r!.approve_limit))
    }
  })

  it('leaves the account able to approve and able to be administered', () => {
    const active = book.people.filter(p => p.status === 'active')
    expect(active.some(p => may(p, book.roles, 'approves_finance'))).toBe(true)
    expect(active.some(p => may(p, book.roles, 'can_manage_users'))).toBe(true)
  })

  it('has something real outstanding on security rather than a clean sheet', () => {
    const gaps = securityGaps(book.people, book.roles, TODAY)
    expect(gaps.length).toBeGreaterThan(0)
    expect(gaps[0].kind).toBe('mfa')
  })
})

describe('what the account is not allowed to do to itself', () => {
  let book: AdminBook

  beforeAll(async () => {
    await signIn(ENTERPRISE.email, ENTERPRISE.password)
    book = await loadAdmin()
  })

  afterAll(async () => { await signOut() })

  it('refuses to let the lead change their own role', async () => {
    const me = book.me!
    const r = await changeRole(me, 'buyer', book)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/cannot change your own role/i)

    /* And the row is untouched — a rule that only lives in the client is a
       rule the API does not have. */
    const after = await loadAdmin()
    expect(after.me?.role).toBe('procurement-lead')
  })

  it('refuses to let the lead suspend themselves', async () => {
    const r = await changeStatus(book.me!, 'suspended', book)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/yourself/i)
    expect((await loadAdmin()).me?.status).toBe('active')
  })

  it('refuses a role that can approve without a second factor', async () => {
    const viewer = book.roles.find(r => r.id === 'viewer')!
    const r = await saveRole({
      name: 'Viewer', description: viewer.description, can_raise: false,
      approves_finance: true, approves_it: false, approve_limit: 5000,
      can_view_billing: true, can_reveal_bank: false, can_manage_users: false,
      can_set_policy: false, mfa_required: false,
    }, book, viewer)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/second factor/i)

    const after = await loadAdmin()
    expect(after.roles.find(x => x.id === 'viewer')?.approves_finance).toBe(false)
  })

  it('refuses to delete a built-in role the approval policy names', async () => {
    const r = await deleteRole(book.roles.find(x => x.id === 'finance-approver')!, book)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/edited but not deleted/i)
    expect((await loadAdmin()).roles.some(x => x.id === 'finance-approver')).toBe(true)
  })

  it('refuses to delete a role somebody holds', async () => {
    const held = book.roles.find(r => holders(r.id, book.people).length > 0)!
    const r = await deleteRole({ ...held, system: false }, book)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/Move them to another role first/i)
  })

  it('cannot raise its own credit limit', async () => {
    const limit = Number(book.billing!.credit_limit)
    const { data, error } = await supabase.from('enterprise_billing')
      .update({ credit_limit: limit * 10 }).eq('account_id', ACCOUNT).select('account_id')
    /* Either refused outright or narrowed to nothing — both are a refusal.
       What must not happen is the limit moving. */
    expect(error !== null || (data ?? []).length === 0).toBe(true)
    expect(Number((await loadAdmin()).billing!.credit_limit)).toBe(limit)
  })

  it('cannot tick off its own outstanding onboarding check', async () => {
    const due = book.onboarding.find(o => o.state !== 'done')!
    const { data, error } = await supabase.from('enterprise_onboarding')
      .update({ state: 'done', done_on: TODAY, done_by: 'Vikram Shah' })
      .eq('id', due.id).select('id')
    expect(error !== null || (data ?? []).length === 0).toBe(true)
    expect((await loadAdmin()).onboarding.find(o => o.id === due.id)?.state).toBe(due.state)
  })
})

describe('a full round trip: invite, move, suspend, remove', () => {
  let book: AdminBook
  const email = 'integration.test@smartbuild.in'

  beforeAll(async () => {
    await signIn(ENTERPRISE.email, ENTERPRISE.password)
    book = await loadAdmin()
    /* Clear anything a previous failed run left behind. */
    await supabase.from('enterprise_users').delete().eq('email', email)
    book = await loadAdmin()
  })

  afterAll(async () => {
    await supabase.from('enterprise_users').delete().eq('email', email)
    await signOut()
  })

  it('invites somebody, stamps who invited them, and takes the permissions from the role', async () => {
    const r = await inviteMember({
      name: 'Integration Test', email, title: 'Site buyer', role: 'buyer', cost_centre: null,
    }, book)
    expect(r.ok, r.ok ? '' : r.reason).toBe(true)

    book = await loadAdmin()
    const added = book.people.find(p => p.email === email)!
    expect(added.status).toBe('invited')
    expect(added.invited_by).toBe(book.me!.id)
    expect(added.invited_on).toBe(TODAY)
    expect(added.must_reset).toBe(true)
    expect(added.can_raise).toBe(true)
    expect(added.approves_finance).toBe(false)
  })

  it('refuses a second invitation to the same address', async () => {
    const r = await inviteMember({
      name: 'Integration Twin', email, title: '', role: 'viewer', cost_centre: null,
    }, book)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/already been invited|resend/i)
  })

  it('moves them to another role and the flags follow', async () => {
    const target = book.people.find(p => p.email === email)!
    const r = await changeRole(target, 'it-approver', book)
    expect(r.ok, r.ok ? '' : r.reason).toBe(true)

    book = await loadAdmin()
    const moved = book.people.find(p => p.email === email)!
    expect(moved.role).toBe('it-approver')
    expect(moved.approves_it).toBe(true)
    expect(moved.approves_finance).toBe(false)
  })

  it('suspends and then removes them, and the record stays', async () => {
    let target = book.people.find(p => p.email === email)!
    /* They are still invited, so suspending is the honest next step only once
       they are active. Go straight to removed, which is what an administrator
       does to an invitation that went to the wrong person. */
    const r = await changeStatus(target, 'removed', book)
    expect(r.ok, r.ok ? '' : r.reason).toBe(true)

    book = await loadAdmin()
    target = book.people.find(p => p.email === email)!
    expect(target.status).toBe('removed')
    expect(target.name).toBe('Integration Test')
  })
})

describe('a role the company makes for itself', () => {
  let book: AdminBook
  const name = 'Integration Site Manager'

  beforeAll(async () => {
    await signIn(ENTERPRISE.email, ENTERPRISE.password)
    await supabase.from('enterprise_roles').delete().eq('name', name)
    book = await loadAdmin()
  })

  afterAll(async () => {
    await supabase.from('enterprise_roles').delete().eq('name', name)
    await signOut()
  })

  it('creates it, and it is custom rather than built-in', async () => {
    const r = await saveRole({
      name, description: 'Runs one site.', can_raise: true, approves_finance: false,
      approves_it: false, approve_limit: null, can_view_billing: false,
      can_reveal_bank: false, can_manage_users: false, can_set_policy: false,
      mfa_required: false,
    }, book)
    expect(r.ok, r.ok ? '' : r.reason).toBe(true)

    book = await loadAdmin()
    const made = book.roles.find(x => x.name === name)!
    expect(made.system).toBe(false)
    expect(made.account_id).toBe(ACCOUNT)
  })

  it('refuses a second role with the same name', async () => {
    const r = await saveRole({
      name, description: 'Another one.', can_raise: true, approves_finance: false,
      approves_it: false, approve_limit: null, can_view_billing: false,
      can_reveal_bank: false, can_manage_users: false, can_set_policy: false,
      mfa_required: false,
    }, book)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/already a role called/i)
  })

  it('deletes it again, because nobody holds it', async () => {
    const made = book.roles.find(x => x.name === name)!
    const r = await deleteRole(made, book)
    expect(r.ok, r.ok ? '' : r.reason).toBe(true)
    expect((await loadAdmin()).roles.some(x => x.name === name)).toBe(false)
  })
})

describe('my own details', () => {
  let book: AdminBook

  beforeAll(async () => {
    await signIn(ENTERPRISE.email, ENTERPRISE.password)
    book = await loadAdmin()
  })

  afterAll(async () => {
    await setAway(book.me!, false, book)
    await signOut()
  })

  it('marks me away and routes work to a delegate, then clears it on return', async () => {
    const me = book.me!
    expect((await setAway(me, true, book)).ok).toBe(true)

    book = await loadAdmin()
    const colleague = book.people.find(p => p.status === 'active' && p.id !== me.id)!
    const d = await setDelegate(book.me!, colleague.id, book)
    expect(d.ok, d.ok ? '' : d.reason).toBe(true)

    book = await loadAdmin()
    expect(book.me!.out_of_office).toBe(true)
    expect(book.me!.delegate_id).toBe(colleague.id)

    expect((await setAway(book.me!, false, book)).ok).toBe(true)
    book = await loadAdmin()
    expect(book.me!.out_of_office).toBe(false)
    expect(book.me!.delegate_id).toBeNull()
  })

  it('will not let me turn off a second factor my role requires', async () => {
    const r = await setMfa(book.me!, false, '', book)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/second factor is required/i)
    expect((await loadAdmin()).me!.mfa).toBe(true)
  })

  it('reads a credit position that agrees with the invoices behind it', async () => {
    const account = await loadAccount()
    const pos = creditPosition(book.billing!, account.invoices)
    const owed = account.invoices
      .filter(i => ['open', 'overdue', 'disputed'].includes(i.status))
      .reduce((a, i) => a + Number(i.total), 0)
    expect(pos.committed).toBeCloseTo(owed, 2)
    expect(pos.headroom).toBeCloseTo(Number(book.billing!.credit_limit) - owed, 2)
  })

  it('reads an onboarding record where every completed check names somebody', () => {
    const p = onboardingProgress(book.onboarding)
    expect(p.total).toBeGreaterThan(0)
    for (const c of book.onboarding.filter(c => c.state === 'done')) {
      expect(c.done_on).toBeTruthy()
      expect(c.done_by).toBeTruthy()
    }
    expect(p.outstanding.every(c => c.due_on)).toBe(true)
  })

  it('holds a mandate that says who verified it and when', () => {
    const b = book.billing!
    if (b.verified) {
      expect(b.verified_on).toBeTruthy()
      expect(b.verified_by).toBeTruthy()
    }
  })
})

describe('the operator, who runs the marketplace', () => {
  beforeAll(async () => { await signIn(OPERATOR.email, OPERATOR.password) })
  afterAll(async () => { await signOut() })

  it('sees every account’s roles and people, not one', async () => {
    const [{ data: roles }, { data: people }] = await Promise.all([
      supabase.from('enterprise_roles').select('account_id'),
      supabase.from('enterprise_users').select('account_id'),
    ])
    expect(new Set(roles!.map(r => r.account_id)).size).toBeGreaterThan(1)
    expect(new Set(people!.map(p => p.account_id)).size).toBeGreaterThan(1)
  })

  it('sees the credit decision behind every buying account', async () => {
    const { data } = await supabase.from('enterprise_billing').select('account_id, credit_limit')
    expect(data!.length).toBeGreaterThan(0)
    expect(data!.every(b => Number(b.credit_limit) > 0)).toBe(true)
  })
})
