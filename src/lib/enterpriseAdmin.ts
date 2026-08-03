/* Who is on the account, what they may do, and the record the account was
   opened on. No React and no Supabase, so the rules can be tested without a
   network.

   The thing this module exists to keep honest is that permission is held in
   one place. A role says what somebody may do; a person holds a role. The
   moment those become two independent copies — a role that says "may approve"
   beside a person whose own flag says otherwise — nobody can answer "who can
   sign this" without reading both and guessing which one won. So every
   permission question here is asked of the role, and the flags on the person
   are refreshed from it by a trigger in the database.

   The other half is the small set of things an account must never be able to
   do to itself: promote itself, lock itself out, or leave nobody able to
   approve. Those are checked here so a screen can explain the refusal, and
   again by `guard_enterprise_user()` and `guard_enterprise_role()` so the
   explanation cannot be skipped by talking to the API directly. */

import type { Check, Member } from './enterprise'
import { money, money0 } from './enterprise'

/* ------------------------------------------------------------- the shapes -- */

export interface EnterpriseRole {
  id: string
  account_id: string
  name: string
  description: string
  system: boolean
  can_raise: boolean
  approves_finance: boolean
  approves_it: boolean
  approve_limit: number | null
  can_view_billing: boolean
  can_reveal_bank: boolean
  can_manage_users: boolean
  can_set_policy: boolean
  mfa_required: boolean
  sort_order: number
}

export interface Session {
  id: string
  account_id: string
  member_id: string
  device: string
  browser: string
  location: string
  ip: string
  started: string
  last_seen: string
  current: boolean
  trusted: boolean
  sort_order: number
}

export interface Billing {
  account_id: string
  method: string
  bank: string | null
  holder: string | null
  account_number: string | null
  local_label: string | null
  local_code: string | null
  mandate_ref: string | null
  mandate_signed_on: string | null
  mandate_signed_by: string | null
  verified: boolean
  verified_on: string | null
  verified_by: string | null
  fallback: string
  terms: string
  billing_contact: string
  invoice_delivery: string
  credit_limit: number
  credit_reviewed: string | null
  credit_review_due: string | null
  at_limit_note: string
  currency: string
}

export interface OnboardingCheck {
  id: string
  account_id: string
  name: string
  detail: string
  state: 'done' | 'due' | 'overdue'
  done_on: string | null
  done_by: string | null
  due_on: string | null
  documents: { name: string; kind: string; size: string }[]
  /* Where each document above lives in the evidence bucket, in the same order.
     Kept alongside rather than folded into `documents` because that column is
     jsonb written by the seeding, and two shapes of one column is how a screen
     ends up rendering half a list. */
  document_paths: string[]
  sort_order: number
}

/** The columns `20260801400000_enterprise_roles_and_details.sql` added. */
export interface MemberDetail {
  user_ref: string | null
  joined: string | null
  timezone: string
  language: string
  date_format: string
  mfa_method: string | null
  must_reset: boolean
  last_sign_in: string | null
  password_changed: string | null
  out_of_office: boolean
  delegate_id: string | null
  invited_by: string | null
  invited_on: string | null
}

export type Person = Member & MemberDetail

/* ------------------------------------------------------- what a role says -- */

/** The permission flags a screen may show, tick and toggle. Narrower than
    `keyof EnterpriseRole` on purpose — `name` and `sort_order` are not
    permissions, and a grid that could be handed one would render a tick
    against it. */
export type Capability =
  | 'can_raise' | 'approves_finance' | 'approves_it'
  | 'can_view_billing' | 'can_reveal_bank' | 'can_manage_users' | 'can_set_policy'

export const CAPABILITIES: { key: Capability; label: string; note: string }[] = [
  { key: 'can_raise', label: 'Raise a requisition', note: 'Ask for something. Everything else on this list is about what happens next.' },
  { key: 'approves_finance', label: 'Approve on value', note: 'Sign off spend at or above the threshold, up to the limit below.' },
  { key: 'approves_it', label: 'Sign off on security', note: 'Anything that connects to the network, whatever it costs.' },
  { key: 'can_view_billing', label: 'See invoices and the credit position', note: 'What the account owes and what it has left to spend.' },
  { key: 'can_reveal_bank', label: 'Reveal the payment instruction', note: 'The full account number and mandate reference. Logged with a name against it.' },
  { key: 'can_manage_users', label: 'Add and remove people', note: 'The keys to the account. Keep this to as few people as the company can stand.' },
  { key: 'can_set_policy', label: 'Change the approval policy and roles', note: 'Changes who every future requisition routes to.' },
]

/** The capabilities that mean somebody has to hold a second factor. */
export const MFA_FORCING: Capability[] = ['approves_finance', 'approves_it', 'can_reveal_bank']

export function roleOf(person: { role: string } | null, roles: EnterpriseRole[]): EnterpriseRole | null {
  if (!person) return null
  return roles.find(r => r.id === person.role) ?? null
}

export function roleName(roleId: string, roles: EnterpriseRole[]): string {
  return roles.find(r => r.id === roleId)?.name ?? roleId
}

/** People who hold a role and have not been removed. A removed person keeps
    their role on the record so the audit trail still reads, but they do not
    stand in the way of deleting it. */
export function holders(roleId: string, people: Person[]): Person[] {
  return people.filter(p => p.role === roleId && p.status !== 'removed')
}

/* Takes anything that holds a role, not just a full Person — the approvals
   screen asks this of a `Member` and has no business loading the rest. */
export function may(me: { role: string } | null, roles: EnterpriseRole[], capability: Capability): boolean {
  const r = roleOf(me, roles)
  return r ? r[capability] === true : false
}

/**
 * What a role adds up to, in one line.
 *
 * A permission grid answers "may they" precisely and "what is this role"
 * badly. Both belong on the page — this is the second one.
 */
export function summariseRole(role: EnterpriseRole, currency: string): string {
  const parts: string[] = []
  if (role.can_raise) parts.push('raises')
  if (role.approves_finance) {
    parts.push(role.approve_limit === null ? 'approves any value' : `approves up to ${money0(role.approve_limit, currency)}`)
  }
  if (role.approves_it) parts.push('signs off on security')
  if (role.can_manage_users) parts.push('manages people')
  if (role.can_set_policy) parts.push('sets policy')
  if (!parts.length) return role.can_view_billing ? 'reads the account, changes nothing' : 'reads the catalogue, changes nothing'
  return parts.join(', ')
}

/* --------------------------------------------------------- inviting people -- */

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/

export interface InviteDraft {
  name: string
  email: string
  title: string
  role: string
  cost_centre: string | null
}

/**
 * Whether an invitation can be sent.
 *
 * The domain check is a warning rather than a refusal on purpose. Companies
 * genuinely invite a contractor on their own address, and a rule that refuses
 * it teaches people to route round the invitation entirely by sharing a login
 * — which is worse than the thing the rule was protecting against.
 */
export function validateInvite(
  draft: InviteDraft, roles: EnterpriseRole[], people: Person[], me: Person | null,
): Check {
  if (!may(me, roles, 'can_manage_users')) {
    return { ok: false, reason: 'Only somebody who manages people on this account can invite a colleague.' }
  }
  const name = draft.name.trim()
  if (!name) return { ok: false, reason: 'A name is required — it is what colleagues see against every approval.' }

  const email = draft.email.trim().toLowerCase()
  if (!EMAIL.test(email)) return { ok: false, reason: 'A valid work email is required. The invitation goes wherever this points.' }

  const clash = people.find(p => p.email.toLowerCase() === email && p.status !== 'removed')
  if (clash) {
    return {
      ok: false,
      reason: clash.status === 'invited'
        ? `${clash.name} has already been invited on that address. Resend their invitation rather than creating a second account.`
        : `${clash.name} is already on this account with that address.`,
    }
  }

  const role = roles.find(r => r.id === draft.role)
  if (!role) return { ok: false, reason: 'Choose a role. It decides what they can do on their first day.' }

  const domain = (me?.email.split('@')[1] ?? '').toLowerCase()
  const note = domain && !email.endsWith(`@${domain}`)
    ? `${email} is outside ${domain}. That is allowed — contractors are invited this way — but check it is the address you meant.`
    : role.mfa_required
      ? `${role.name} can approve, so they will be asked to set up a second factor before they can sign anything.`
      : undefined

  return note ? { ok: true, note } : { ok: true }
}

/* ------------------------------------------------- changing somebody's role -- */

/**
 * Whether a role change can go through.
 *
 * Three refusals, and each of them is a way an account locks itself out or
 * quietly grants itself everything. The last-approver and last-administrator
 * checks look alike but are not the same: an account with nobody who can
 * approve stops working, and an account with nobody who can manage people
 * cannot fix it.
 */
export function validateRoleChange(
  target: Person, nextRoleId: string, me: Person | null, roles: EnterpriseRole[], people: Person[],
): Check {
  if (!may(me, roles, 'can_manage_users')) {
    return { ok: false, reason: 'Only somebody who manages people on this account can change a role.' }
  }
  if (target.status === 'removed') {
    return { ok: false, reason: `${target.name} has been removed from this account. Invite them again rather than editing the old record.` }
  }
  const next = roles.find(r => r.id === nextRoleId)
  if (!next) return { ok: false, reason: 'That role is not on this account.' }
  if (next.id === target.role) return { ok: false, reason: `${target.name} already holds ${next.name}.` }

  if (me && target.id === me.id) {
    return {
      ok: false,
      reason: 'You cannot change your own role. That is deliberate — it is the control that stops one account quietly granting itself everything. Somebody else who manages people has to do it.',
    }
  }

  const current = roles.find(r => r.id === target.role)
  if (current?.approves_finance && !next.approves_finance
      && !others(target, people, roles, r => r.approves_finance).length) {
    return { ok: false, reason: `${target.name} is the only person left who can approve on value. Give somebody else finance approval first.` }
  }
  if (current?.can_manage_users && !next.can_manage_users
      && !others(target, people, roles, r => r.can_manage_users).length) {
    return { ok: false, reason: `${target.name} is the only person left who can manage people. Moving them would lock this account out of its own administration.` }
  }

  const gained = CAPABILITIES.filter(c => next[c.key] === true && current?.[c.key] !== true).map(c => c.label)
  const lost = CAPABILITIES.filter(c => current?.[c.key] === true && next[c.key] !== true).map(c => c.label)
  const bits: string[] = []
  if (gained.length) bits.push(`gains ${gained.join(', ').toLowerCase()}`)
  if (lost.length) bits.push(`loses ${lost.join(', ').toLowerCase()}`)
  if (next.mfa_required && !target.mfa) bits.push('and will be asked to set up a second factor before they can approve anything')

  return { ok: true, note: bits.length ? `${target.name} ${bits.join('; ')}.` : `${target.name} moves to ${next.name}.` }
}

/** Everybody else on the account who is active and whose role passes a test. */
function others(
  target: Person, people: Person[], roles: EnterpriseRole[], test: (r: EnterpriseRole) => boolean,
): Person[] {
  return people.filter(p => {
    if (p.id === target.id || p.status !== 'active') return false
    const r = roles.find(x => x.id === p.role)
    return !!r && test(r)
  })
}

export type Standing = 'active' | 'invited' | 'suspended' | 'removed'

export function validateStatusChange(
  target: Person, next: Standing, me: Person | null, roles: EnterpriseRole[], people: Person[],
): Check {
  if (!may(me, roles, 'can_manage_users')) {
    return { ok: false, reason: 'Only somebody who manages people on this account can suspend or remove a colleague.' }
  }
  if (me && target.id === me.id) {
    return { ok: false, reason: 'You cannot suspend or remove yourself. Ask another administrator.' }
  }
  if (next === target.status) return { ok: false, reason: `${target.name} is already ${next}.` }
  if (target.status === 'removed') {
    return { ok: false, reason: `${target.name} has been removed. Invite them again to bring them back.` }
  }
  if (next === 'active' && target.status === 'invited') {
    return { ok: false, reason: `${target.name} becomes active by accepting their invitation and signing in — it is not something you switch on for them.` }
  }

  const role = roles.find(r => r.id === target.role)
  if (next !== 'active' && target.status === 'active') {
    if (role?.approves_finance && !others(target, people, roles, r => r.approves_finance).length) {
      return { ok: false, reason: `${target.name} is the only person who can approve on value. Nothing would be approvable until somebody else has it.` }
    }
    if (role?.can_manage_users && !others(target, people, roles, r => r.can_manage_users).length) {
      return { ok: false, reason: `${target.name} is the only person who can manage people. This account would have no administrator.` }
    }
  }

  return {
    ok: true,
    note: next === 'suspended'
      ? `${target.name} keeps their record and their history, and cannot sign in until you lift it.`
      : next === 'removed'
        ? `${target.name} loses access immediately. Everything they raised, approved or ordered stays on the account with their name on it.`
        : `${target.name} is ${next}.`,
  }
}

/* ------------------------------------------------------------ editing roles -- */

export interface RoleDraft {
  id?: string
  name: string
  description: string
  can_raise: boolean
  approves_finance: boolean
  approves_it: boolean
  approve_limit: number | null
  can_view_billing: boolean
  can_reveal_bank: boolean
  can_manage_users: boolean
  can_set_policy: boolean
  mfa_required: boolean
}

/**
 * Whether a role can be saved.
 *
 * The MFA rule is not a preference. A role that can approve spend or read a
 * payment instruction without a second factor is the first thing an auditor
 * writes up, and the database refuses it too, so refusing it here means the
 * screen can say why instead of showing a constraint violation.
 */
export function validateRole(
  draft: RoleDraft, roles: EnterpriseRole[], me: Person | null, existing?: EnterpriseRole,
): Check {
  if (!may(me, roles, 'can_set_policy')) {
    return { ok: false, reason: 'Only somebody who can set policy on this account can change what a role may do.' }
  }
  const name = draft.name.trim()
  if (!name) return { ok: false, reason: 'A role needs a name people will recognise — it is what the approval policy refers to.' }
  if (roles.some(r => r.id !== existing?.id && r.name.trim().toLowerCase() === name.toLowerCase())) {
    return { ok: false, reason: `There is already a role called ${name}. Two roles with one name is two people disagreeing about who signs.` }
  }
  if (draft.approve_limit !== null && draft.approve_limit < 0) {
    return { ok: false, reason: 'An approval limit cannot be negative.' }
  }
  const forcing = MFA_FORCING.filter(k => draft[k] === true)
  if (forcing.length && !draft.mfa_required) {
    return {
      ok: false,
      reason: 'A role that can approve or reveal the payment instruction has to require a second factor. Turn that on, or take those permissions off.',
    }
  }
  if (!draft.approves_finance && draft.approve_limit !== null) {
    return { ok: false, reason: 'An approval limit only means something on a role that approves on value.' }
  }
  if (existing && me && existing.id === me.role) {
    const widened = draft.approves_finance && !existing.approves_finance
      || draft.can_reveal_bank && !existing.can_reveal_bank
      || draft.can_set_policy && !existing.can_set_policy
      || limitWidened(existing.approve_limit, draft.approve_limit)
    if (widened) {
      return { ok: false, reason: `You hold ${existing.name}. Somebody else has to widen it — nobody signs off on their own authority.` }
    }
  }
  return { ok: true }
}

function limitWidened(before: number | null, after: number | null): boolean {
  if (before === null) return false          // already unlimited; nothing is wider
  if (after === null) return true            // limited to unlimited is the widest step there is
  return after > before
}

export function validateRoleDelete(role: EnterpriseRole, people: Person[], me: Person | null, roles: EnterpriseRole[]): Check {
  if (!may(me, roles, 'can_set_policy')) {
    return { ok: false, reason: 'Only somebody who can set policy on this account can delete a role.' }
  }
  if (role.system) {
    return { ok: false, reason: `${role.name} is one of the roles the approval policy refers to by name. It can be edited but not deleted.` }
  }
  const held = holders(role.id, people)
  if (held.length) {
    return {
      ok: false,
      reason: `${held.length} ${held.length === 1 ? 'person holds' : 'people hold'} ${role.name} — ${held.map(p => p.name).join(', ')}. Move them to another role first, or they would be left with no permissions at all.`,
    }
  }
  return { ok: true, note: `${role.name} is held by nobody, so deleting it changes nothing for anyone today.` }
}

/* -------------------------------------------------------- security standing -- */

export interface Gap {
  member: Person
  kind: 'mfa' | 'reset' | 'stale-password' | 'never-signed-in'
  what: string
}

/** How old a password is allowed to get before it is worth a nudge. Not an
    expiry — see PASSWORD_POLICY on why rotation on a schedule is not required. */
export const STALE_PASSWORD_DAYS = 365

/**
 * What is outstanding on this account's security, worst first.
 *
 * Deliberately not a score. A number out of ten tells nobody what to do; a
 * list of names with one sentence each does.
 */
export function securityGaps(people: Person[], roles: EnterpriseRole[], today: string): Gap[] {
  const out: Gap[] = []
  for (const p of people) {
    if (p.status === 'removed') continue
    const role = roles.find(r => r.id === p.role)
    if (p.status === 'active' && role?.mfa_required && !p.mfa) {
      out.push({ member: p, kind: 'mfa', what: `${p.name} holds ${role.name} and has no second factor. That role can approve, so this is the one an auditor picks up first.` })
    } else if (p.status === 'active' && !p.mfa) {
      out.push({ member: p, kind: 'mfa', what: `${p.name} has no second factor. Not required for ${role?.name ?? 'their role'}, but worth having.` })
    }
    if (p.must_reset) {
      out.push({ member: p, kind: 'reset', what: `${p.name} still has to set a password before they can sign in.` })
    }
    if (p.status === 'invited' && !p.must_reset) {
      out.push({ member: p, kind: 'never-signed-in', what: `${p.name} was invited and has not signed in yet.` })
    }
    if (p.status === 'active' && p.password_changed && daysBetween(p.password_changed, today) > STALE_PASSWORD_DAYS) {
      out.push({ member: p, kind: 'stale-password', what: `${p.name} has not changed their password in ${Math.floor(daysBetween(p.password_changed, today) / 30)} months.` })
    }
  }
  const rank: Record<Gap['kind'], number> = { mfa: 0, reset: 1, 'stale-password': 2, 'never-signed-in': 3 }
  return out.sort((a, b) => rank[a.kind] - rank[b.kind])
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(to) - Date.parse(from)) / 86400000)
}

export const PASSWORD_POLICY = {
  minLength: 12,
  needs: 'upper and lower case, a number and a symbol',
  reuse: 'Cannot match any of your last 5 passwords',
  lockout: 'Locked for 15 minutes after 5 failed attempts',
  rotation:
    'Rotation on a schedule is deliberately not required. Forcing regular changes pushes people toward weaker, patterned passwords; rotation on suspicion does not.',
}

export function passwordProblems(v: string): string[] {
  const out: string[] = []
  if (v.length < PASSWORD_POLICY.minLength) out.push(`needs ${PASSWORD_POLICY.minLength - v.length} more character${PASSWORD_POLICY.minLength - v.length === 1 ? '' : 's'}`)
  if (!/[a-z]/.test(v) || !/[A-Z]/.test(v)) out.push('needs upper and lower case')
  if (!/\d/.test(v)) out.push('needs a number')
  if (!/[^A-Za-z0-9]/.test(v)) out.push('needs a symbol')
  return out
}

export function passwordStrength(v: string): { score: number; label: string } {
  if (!v) return { score: 0, label: '' }
  let s = 0
  if (v.length >= PASSWORD_POLICY.minLength) s++
  if (/[a-z]/.test(v) && /[A-Z]/.test(v)) s++
  if (/\d/.test(v)) s++
  if (/[^A-Za-z0-9]/.test(v)) s++
  if (v.length >= 16) s++
  return { score: s, label: s <= 2 ? 'Weak' : s === 3 ? 'Fair' : s === 4 ? 'Strong' : 'Very strong' }
}

export function validatePassword(next: string, again: string): Check {
  const problems = passwordProblems(next)
  if (problems.length) return { ok: false, reason: `That password ${problems.join(', ')}.` }
  if (next !== again) return { ok: false, reason: 'The two entries do not match.' }
  return { ok: true, note: `${passwordStrength(next).label} — nobody at the marketplace can see it, including support.` }
}

/* -------------------------------------------------------------- delegation -- */

/**
 * Whether somebody can act in your place.
 *
 * A delegate acts up to your limit and no further. That is the whole rule and
 * it is worth stating plainly on the screen, because the assumption people
 * arrive with is the opposite one — that handing work over hands over the
 * authority to finish it.
 */
export function validateDelegate(me: Person, delegateId: string | null, people: Person[], roles: EnterpriseRole[], currency: string): Check {
  if (!delegateId) return { ok: true, note: 'No delegate — anything assigned to you waits until you are back.' }
  if (delegateId === me.id) return { ok: false, reason: 'You cannot delegate to yourself.' }
  const to = people.find(p => p.id === delegateId)
  if (!to) return { ok: false, reason: 'That colleague is not on this account.' }
  if (to.status !== 'active') return { ok: false, reason: `${to.name} is ${to.status}, so nothing would reach them.` }
  if (to.out_of_office) return { ok: false, reason: `${to.name} is away too. Work would sit with somebody who is not there either.` }

  const mine = roles.find(r => r.id === me.role)
  const theirs = roles.find(r => r.id === to.role)
  if (mine?.approves_finance && !theirs?.approves_finance) {
    return {
      ok: true,
      note: `${to.name} holds ${theirs?.name ?? 'another role'} and cannot approve on value. Approvals will wait for you; everything else routes to them.`,
    }
  }
  const ceiling = mine?.approve_limit ?? null
  return {
    ok: true,
    note: ceiling === null
      ? `${to.name} can act in your place. The audit log still records who actually acted.`
      : `${to.name} can act in your place up to your own limit of ${money(ceiling, currency)}. Anything above it still escalates — a delegation is not a promotion.`,
  }
}

export function delegateOptions(me: Person, people: Person[]): Person[] {
  return people.filter(p => p.id !== me.id && p.status === 'active' && !p.out_of_office)
}

/* ---------------------------------------------------------- credit position -- */

export interface CreditPosition {
  limit: number
  committed: number
  headroom: number
  pct: number
  state: 'clear' | 'watch' | 'at-limit'
  note: string
}

/**
 * How much of the credit line is used.
 *
 * Committed is what is billed and not yet paid — not what has been spent this
 * year. A limit is a position, and last quarter's paid invoices are not part
 * of it.
 */
export function creditPosition(billing: Billing, invoices: { total: number; status: string }[], currency: string): CreditPosition {
  const owed = invoices
    .filter(i => i.status === 'open' || i.status === 'overdue' || i.status === 'disputed')
    .reduce((a, i) => a + Number(i.total), 0)
  const limit = Number(billing.credit_limit)
  const headroom = Math.round((limit - owed) * 100) / 100
  const pct = limit > 0 ? Math.round((owed / limit) * 1000) / 10 : 0
  const state: CreditPosition['state'] = pct >= 100 ? 'at-limit' : pct >= 80 ? 'watch' : 'clear'
  return {
    limit,
    committed: Math.round(owed * 100) / 100,
    headroom,
    pct,
    state,
    note: state === 'at-limit'
      ? `The line is fully drawn. ${billing.at_limit_note}`
      : state === 'watch'
        ? `${money0(headroom, currency)} left of ${money0(limit, currency)}. A large requisition would take this past the limit.`
        : `${money0(headroom, currency)} left of ${money0(limit, currency)} on ${billing.terms.toLowerCase()}.`,
  }
}

/** Whether the annual review is behind, and by how long. */
export function creditReview(billing: Billing, today: string): { due: string | null; overdue: boolean; inDays: number | null; note: string } {
  if (!billing.credit_review_due) return { due: null, overdue: false, inDays: null, note: 'No review date on file.' }
  const inDays = daysBetween(today, billing.credit_review_due)
  return {
    due: billing.credit_review_due,
    overdue: inDays < 0,
    inDays,
    note: inDays < 0
      ? `The annual review was due ${-inDays} days ago. The current limit stands until it is done.`
      : `Reviewed annually. The next one is due in ${inDays} days, and on any request that would cross the limit.`,
  }
}

/* --------------------------------------------------------------- onboarding -- */

export function onboardingProgress(checks: OnboardingCheck[]): { done: number; total: number; outstanding: OnboardingCheck[] } {
  return {
    done: checks.filter(c => c.state === 'done').length,
    total: checks.length,
    outstanding: checks.filter(c => c.state !== 'done'),
  }
}

/* -------------------------------------------------------------- audit trail -- */

export interface AuditEntry {
  when: string
  who: string
  action: string
  detail: string
  severity: 'high' | 'normal' | 'info'
}

/**
 * What happened on this account, derived rather than recorded twice.
 *
 * The trail used to be five hand-typed lines, which is how the page came to
 * name an "Anita Rao" who does not exist while every requisition on the
 * account was raised by Anita Desai. Deriving it from the requisitions,
 * invoices and people already on the account means the log cannot disagree
 * with the screens it describes — if it says a requisition was approved, the
 * requisition is approved, because that row is where the line came from.
 */
export function auditTrail(
  { requisitions, invoices, people }: {
    requisitions: { id: string; title: string; raised_by: string; raised_on: string; amount: number; state: string; decided_by: string | null; decided_on: string | null; decision_note: string | null; order_ref: string | null }[]
    invoices: { id: string; total: number; status: string; paid_on: string | null; period: string; note: string | null }[]
    people: Person[]
  },
  currency: string,
  limit = 40,
): AuditEntry[] {
  const name = (id: string) => people.find(p => p.id === id)?.name ?? id
  const out: AuditEntry[] = []

  for (const r of requisitions) {
    out.push({
      when: r.raised_on, who: name(r.raised_by), action: 'Raised a requisition',
      detail: `${r.id} · ${r.title} · ${money(Number(r.amount), currency)}`,
      severity: 'normal',
    })
    if (r.decided_on && r.decided_by) {
      out.push({
        when: r.decided_on, who: name(r.decided_by),
        action: r.state === 'approved' ? 'Approved a requisition' : r.state === 'declined' ? 'Declined a requisition' : 'Withdrew a requisition',
        detail: [`${r.id} · ${money(Number(r.amount), currency)}`, r.order_ref ? `ordered as ${r.order_ref}` : null, r.decision_note]
          .filter(Boolean).join(' · '),
        severity: 'high',
      })
    }
  }

  for (const i of invoices) {
    if (i.paid_on) {
      out.push({
        when: i.paid_on, who: 'Direct debit', action: 'Invoice paid',
        detail: `${i.id} · ${i.period} · ${money(Number(i.total), currency)}`,
        severity: 'normal',
      })
    }
    if (i.status === 'disputed') {
      out.push({
        when: i.period, who: 'This account', action: 'Invoice disputed',
        detail: `${i.id} · ${money(Number(i.total), currency)}${i.note ? ` · ${i.note}` : ''}`,
        severity: 'high',
      })
    }
  }

  for (const p of people) {
    if (p.invited_on) {
      out.push({
        when: p.invited_on, who: p.invited_by ? name(p.invited_by) : 'An administrator',
        action: 'Invited a colleague',
        detail: `${p.name} · ${p.email}`,
        severity: 'high',
      })
    } else if (p.joined) {
      out.push({
        when: p.joined, who: p.name, action: 'Joined the account',
        detail: `${p.user_ref ?? p.id} · ${p.title}`,
        severity: 'info',
      })
    }
  }

  return out.sort((a, b) => (a.when < b.when ? 1 : a.when > b.when ? -1 : 0)).slice(0, limit)
}

/* ------------------------------------------------------------------ masking -- */

/** Everything but the last four. Enough to recognise, not enough to quote. */
export function maskAccount(n: string | null): string {
  if (!n) return '—'
  const s = n.replace(/\s+/g, '')
  return s.length <= 4 ? s : `${'•'.repeat(Math.max(4, s.length - 4))}${s.slice(-4)}`
}

export function maskTail(s: string | null, keep = 3): string {
  if (!s) return '—'
  return s.length <= keep ? s : `${'•'.repeat(s.length - keep)}${s.slice(-keep)}`
}

/** A tax id shows its first two and last four. The leading digits are the
    state or country code, which is public, and the rest is not. */
export function maskTaxId(s: string | null): string {
  if (!s) return '—'
  if (s.length <= 6) return s
  return `${s.slice(0, 2)}${'•'.repeat(s.length - 6)}${s.slice(-4)}`
}

/* --------------------------------------------------------------- time words -- */

/** "Today 09:12", "Yesterday 16:40", "30 Jul 2026". Relative for the last two
    days because that is the range where a person reads a date and has to work
    out whether it was recent. */
export function when(iso: string | null, now = new Date()): string {
  if (!iso) return 'Never'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return 'Never'
  const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
  const days = daysBetween(d.toISOString().slice(0, 10), now.toISOString().slice(0, 10))
  if (days === 0) return `Today ${time}`
  if (days === 1) return `Yesterday ${time}`
  if (days < 7) return `${days} days ago`
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

export { money, money0 }
