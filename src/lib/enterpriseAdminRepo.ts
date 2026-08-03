/* The only module that reads or writes the account's people, roles, sessions,
   payment mandate and onboarding record.

   Rules live in enterpriseAdmin.ts so they can be tested without a network.
   Every write here is checked twice — once by those rules so the screen can
   explain a refusal in the buyer's own words, and again by
   `guard_enterprise_user()` and `guard_enterprise_role()` in the database, so
   a refusal cannot be skipped by talking to the API directly. */

import { supabase } from './supabase'
import {
  validateInvite, validateRoleChange, validateStatusChange, validateRole,
  validateRoleDelete, validateDelegate, roleName,
} from './enterpriseAdmin'
import type {
  EnterpriseRole, Session, Billing, OnboardingCheck, Person, InviteDraft, RoleDraft, Standing,
} from './enterpriseAdmin'
import type { Check } from './enterprise'

export type Result = Check

export interface AdminBook {
  me: Person | null
  people: Person[]
  roles: EnterpriseRole[]
  sessions: Session[]
  billing: Billing | null
  onboarding: OnboardingCheck[]
  loadError?: string
}

const EMPTY: AdminBook = {
  me: null, people: [], roles: [], sessions: [], billing: null, onboarding: [],
}

/**
 * Everything the administration screens need, in one read.
 *
 * People and roles are inseparable here: a list of names without the roles
 * behind them can say who is on the account but not what any of them may do,
 * which is the only question the list exists to answer.
 */
export async function loadAdmin(): Promise<AdminBook> {
  const { data: session } = await supabase.auth.getUser()
  const uid = session.user?.id ?? null

  const [u, r, s, b, o] = await Promise.all([
    supabase.from('enterprise_users').select('*').order('sort_order'),
    supabase.from('enterprise_roles').select('*').order('sort_order'),
    supabase.from('enterprise_sessions').select('*').order('sort_order'),
    supabase.from('enterprise_billing').select('*').maybeSingle(),
    supabase.from('enterprise_onboarding').select('*').order('sort_order'),
  ])

  const errors: string[] = []
  const grab = <T>(res: { data: unknown; error: { message: string } | null }, what: string): T[] => {
    if (res.error) errors.push(`${what}: ${res.error.message}`)
    return (res.data ?? []) as T[]
  }
  const people = grab<Person>(u, 'your colleagues').map(normalise)

  return {
    ...EMPTY,
    me: people.find(p => p.user_id === uid) ?? null,
    people,
    roles: grab<EnterpriseRole>(r, 'roles'),
    sessions: grab<Session>(s, 'sessions'),
    billing: (b.data ?? null) as Billing | null,
    onboarding: grab<OnboardingCheck>(o, 'the onboarding record'),
    ...(errors.length || b.error
      ? { loadError: `Some of this did not load (${[...errors, b.error?.message].filter(Boolean).join('; ')}).` }
      : {}),
  }
}

/* Postgres hands numerics back as strings over PostgREST, and `documents` as
   parsed jsonb. Coercing here means no screen has to remember to. */
function normalise(p: Person): Person {
  return { ...p, approve_limit: p.approve_limit === null ? null : Number(p.approve_limit) }
}

/* ------------------------------------------------------------- inviting -- */

/**
 * Invite a colleague.
 *
 * The row is created with no `user_id`: it is a place on the account waiting
 * for somebody, not an account. They become active by accepting the invitation
 * and signing in, which is the one part of this nobody else can do for them.
 */
export async function inviteMember(
  draft: InviteDraft, book: AdminBook,
): Promise<Result> {
  const check = validateInvite(draft, book.roles, book.people, book.me)
  if (!check.ok) return check
  const account = book.me?.account_id
  if (!account) return { ok: false, reason: 'You are not on an enterprise account.' }

  const id = nextId(book.people.map(p => p.id), `EU-${account.replace(/^ENT-/, '')}`)
  const role = book.roles.find(r => r.id === draft.role)!

  /* The permission flags are stamped by the trigger from the role. Sending
     them from here would be the client asserting what somebody may do. */
  const { data, error } = await supabase.from('enterprise_users').insert({
    id,
    account_id: account,
    name: draft.name.trim(),
    email: draft.email.trim().toLowerCase(),
    title: draft.title.trim() || role.name,
    role: draft.role,
    cost_centre: draft.cost_centre,
    status: 'invited',
    mfa: false,
    must_reset: true,
    user_ref: id.replace('EU-', 'USR-'),
    joined: new Date().toISOString().slice(0, 10),
    sort_order: book.people.length + 1,
  }).select('id')

  if (error) return { ok: false, reason: friendly(error.message) }
  if (!data?.length) return { ok: false, reason: REFUSED }
  return {
    ok: true,
    note: `${draft.name.trim()} has been invited as ${role.name}. The link goes to ${draft.email.trim().toLowerCase()} and is valid for 14 days. They show as invited until they sign in.`,
  }
}

/** EU-2007-07 after EU-2007-06. Ids are read aloud on this account, so they
    stay sequential rather than becoming a uuid nobody can quote. */
function nextId(existing: string[], prefix: string): string {
  const n = existing
    .filter(id => id.startsWith(`${prefix}-`))
    .map(id => Number(id.slice(prefix.length + 1)))
    .filter(x => Number.isFinite(x))
    .reduce((a, b) => Math.max(a, b), 0)
  return `${prefix}-${String(n + 1).padStart(2, '0')}`
}

/* --------------------------------------------------- changing what they may do -- */

export async function changeRole(target: Person, nextRoleId: string, book: AdminBook): Promise<Result> {
  const check = validateRoleChange(target, nextRoleId, book.me, book.roles, book.people)
  if (!check.ok) return check

  const { data, error } = await supabase.from('enterprise_users')
    .update({ role: nextRoleId }).eq('id', target.id).select('id')
  if (error) return { ok: false, reason: friendly(error.message) }
  if (!data?.length) return { ok: false, reason: REFUSED }
  return { ok: true, note: `${target.name} now holds ${roleName(nextRoleId, book.roles)}. ${check.note ?? ''}`.trim() }
}

export async function changeStatus(target: Person, next: Standing, book: AdminBook): Promise<Result> {
  const check = validateStatusChange(target, next, book.me, book.roles, book.people)
  if (!check.ok) return check

  const { data, error } = await supabase.from('enterprise_users')
    .update({ status: next }).eq('id', target.id).select('id')
  if (error) return { ok: false, reason: friendly(error.message) }
  if (!data?.length) return { ok: false, reason: REFUSED }
  return { ok: true, note: check.note }
}

/** A cost centre is not a permission — it decides where their spend lands, and
    an administrator moving somebody between sites changes it routinely. */
export async function setCostCentre(target: Person, centre: string | null, book: AdminBook): Promise<Result> {
  if (!book.me) return { ok: false, reason: 'You are not on this account.' }
  const { data, error } = await supabase.from('enterprise_users')
    .update({ cost_centre: centre }).eq('id', target.id).select('id')
  if (error) return { ok: false, reason: friendly(error.message) }
  if (!data?.length) return { ok: false, reason: REFUSED }
  return { ok: true, note: `${target.name}'s spend is allocated to ${centre ?? 'no cost centre'} from now on.` }
}

/* ------------------------------------------------------------------ roles -- */

export async function saveRole(draft: RoleDraft, book: AdminBook, existing?: EnterpriseRole): Promise<Result> {
  const check = validateRole(draft, book.roles, book.me, existing)
  if (!check.ok) return check
  const account = book.me?.account_id
  if (!account) return { ok: false, reason: 'You are not on an enterprise account.' }

  const row = {
    name: draft.name.trim(),
    description: draft.description.trim() || 'Not yet described.',
    can_raise: draft.can_raise,
    approves_finance: draft.approves_finance,
    approves_it: draft.approves_it,
    approve_limit: draft.approve_limit,
    can_view_billing: draft.can_view_billing,
    can_reveal_bank: draft.can_reveal_bank,
    can_manage_users: draft.can_manage_users,
    can_set_policy: draft.can_set_policy,
    mfa_required: draft.mfa_required,
  }

  if (existing) {
    const { data, error } = await supabase.from('enterprise_roles')
      .update(row).eq('id', existing.id).select('id')
    if (error) return { ok: false, reason: friendly(error.message) }
    if (!data?.length) return { ok: false, reason: REFUSED }
    const n = book.people.filter(p => p.role === existing.id && p.status !== 'removed').length
    return {
      ok: true,
      note: n
        ? `${row.name} saved. It takes effect for the ${n} ${n === 1 ? 'person who holds' : 'people who hold'} it at their next sign-in.`
        : `${row.name} saved. Nobody holds it, so nothing changes for anyone today.`,
    }
  }

  const id = slug(row.name, account, book.roles.map(r => r.id))
  const { data, error } = await supabase.from('enterprise_roles').insert({
    id, account_id: account, system: false, sort_order: book.roles.length + 1, ...row,
  }).select('id')
  if (error) return { ok: false, reason: friendly(error.message) }
  if (!data?.length) return { ok: false, reason: REFUSED }
  return { ok: true, note: `${row.name} created with nobody in it, so nothing changes until you assign somebody.` }
}

function slug(name: string, account: string, taken: string[]): string {
  const base = `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'role'}-${account}`
  let id = base
  let n = 2
  while (taken.includes(id)) id = `${base}-${n++}`
  return id
}

export async function deleteRole(role: EnterpriseRole, book: AdminBook): Promise<Result> {
  const check = validateRoleDelete(role, book.people, book.me, book.roles)
  if (!check.ok) return check

  const { data, error } = await supabase.from('enterprise_roles')
    .delete().eq('id', role.id).select('id')
  if (error) return { ok: false, reason: friendly(error.message) }
  if (!data?.length) return { ok: false, reason: REFUSED }
  return { ok: true, note: `${role.name} deleted. Any audit entry recording somebody acting under it keeps the name.` }
}

/* ------------------------------------------------------------- my details -- */

export interface ProfileDraft {
  name: string
  title: string
  phone: string
  timezone: string
  language: string
  date_format: string
}

/**
 * Your own name, contact and preferences.
 *
 * Deliberately not the email address. Sign-in address is held by Supabase auth
 * and changing it is a confirmed round trip on both addresses, not a text
 * field somebody edits in passing — a screen that saves it here would show a
 * new address beside a login that still only answers to the old one.
 */
export async function saveProfile(draft: ProfileDraft, me: Person): Promise<Result> {
  const name = draft.name.trim()
  if (!name) return { ok: false, reason: 'A name is required — it is what colleagues see against every approval you sign.' }

  const { data, error } = await supabase.from('enterprise_users').update({
    name,
    title: draft.title.trim() || me.title,
    phone: draft.phone.trim() || null,
    timezone: draft.timezone,
    language: draft.language,
    date_format: draft.date_format,
  }).eq('id', me.id).select('id')
  if (error) return { ok: false, reason: friendly(error.message) }
  if (!data?.length) return { ok: false, reason: REFUSED }
  return { ok: true, note: 'Your details are saved.' }
}

export async function setAway(me: Person, away: boolean, book: AdminBook): Promise<Result> {
  /* Coming back clears the delegate. Leaving it set means work quietly routes
     elsewhere the next time somebody ticks the box, which is how an approval
     ends up with a person who has no idea why. */
  const { data, error } = await supabase.from('enterprise_users').update({
    out_of_office: away, ...(away ? {} : { delegate_id: null }),
  }).eq('id', me.id).select('id')
  if (error) return { ok: false, reason: friendly(error.message) }
  if (!data?.length) return { ok: false, reason: REFUSED }

  const to = away && me.delegate_id ? book.people.find(p => p.id === me.delegate_id) : null
  return {
    ok: true,
    note: away
      ? to ? `You are marked as away. Work routes to ${to.name}.`
        : 'You are marked as away. Nothing is delegated, so anything assigned to you will wait.'
      : 'Welcome back — work routes to you again, and the delegate is cleared.',
  }
}

export async function setDelegate(
  me: Person, delegateId: string | null, book: AdminBook, currency: string,
): Promise<Result> {
  const check = validateDelegate(me, delegateId, book.people, book.roles, currency)
  if (!check.ok) return check

  const { data, error } = await supabase.from('enterprise_users')
    .update({ delegate_id: delegateId }).eq('id', me.id).select('id')
  if (error) return { ok: false, reason: friendly(error.message) }
  if (!data?.length) return { ok: false, reason: REFUSED }
  return { ok: true, note: check.note }
}

/**
 * Turn a second factor on or off.
 *
 * Turning it off is refused when the role requires it rather than allowed with
 * a warning. A role that can approve spend without a second factor is the
 * first thing an audit picks up, and the database refuses it too.
 */
export async function setMfa(me: Person, on: boolean, method: string, book: AdminBook): Promise<Result> {
  const role = book.roles.find(r => r.id === me.role)
  if (!on && role?.mfa_required) {
    return {
      ok: false,
      reason: `${role.name} can approve, so a second factor is required on it. Move to a role that does not approve first, or ask somebody to change what ${role.name} may do.`,
    }
  }
  const { data, error } = await supabase.from('enterprise_users')
    .update({ mfa: on, mfa_method: on ? method : null }).eq('id', me.id).select('id')
  if (error) return { ok: false, reason: friendly(error.message) }
  if (!data?.length) return { ok: false, reason: REFUSED }
  return {
    ok: true,
    note: on
      ? `Second factor on, using ${method.toLowerCase()}. You will be asked for it at your next sign-in.`
      : 'Second factor off. Your account is now protected by a password alone.',
  }
}

/** End a session somewhere else. The current one is left alone — signing
    yourself out of the screen you are reading is not a security control. */
export async function endSession(session: Session): Promise<Result> {
  if (session.current) {
    return { ok: false, reason: 'That is this session. Use sign out in the account menu instead.' }
  }
  const { data, error } = await supabase.from('enterprise_sessions')
    .delete().eq('id', session.id).select('id')
  if (error) return { ok: false, reason: friendly(error.message) }
  if (!data?.length) return { ok: false, reason: REFUSED }
  return { ok: true, note: `Signed out of ${session.device} in ${session.location}. It will need the password and a second factor to come back.` }
}

export async function endOtherSessions(me: Person, book: AdminBook): Promise<Result> {
  const others = book.sessions.filter(s => s.member_id === me.id && !s.current)
  if (!others.length) return { ok: false, reason: 'There are no other sessions open.' }

  const { data, error } = await supabase.from('enterprise_sessions')
    .delete().in('id', others.map(s => s.id)).select('id')
  if (error) return { ok: false, reason: friendly(error.message) }
  if (!data?.length) return { ok: false, reason: REFUSED }
  return { ok: true, note: `${data.length} other session${data.length === 1 ? '' : 's'} ended.` }
}

/* --------------------------------------------------------------- helpers -- */

/**
 * The message for a write that changed nothing.
 *
 * RLS does not raise on an update it disallows — it narrows the rows the
 * statement can see, so a forbidden update matches nothing and returns
 * success. Trusting `!error` would have the screen announce that somebody was
 * suspended while the row sat untouched.
 */
const REFUSED = 'Nothing changed — you are not allowed to make that change on this account.'

/** The guards refuse in their own words on purpose; this strips the Postgres
    wrapper so the buyer reads the sentence and not the stack. */
function friendly(message: string): string {
  const m = message.replace(/^.*?\bERROR:\s*/i, '').trim()
  if (/row-level security/i.test(m)) return 'You are not allowed to change that on this account.'
  if (/duplicate key/i.test(m)) return 'That already exists.'
  if (/violates foreign key/i.test(m)) return 'That role is not on this account.'
  return m
}
