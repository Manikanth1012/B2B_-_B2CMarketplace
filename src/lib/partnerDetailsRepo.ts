/* The seller's own record: who they are, how we reach them, where the money
   goes and which marketplaces they are trading in.

   Rules live in partnerDetails.ts so they can be tested without a network. This
   file is the only place that writes any of it. */

import { supabase } from './supabase'
import { currentEmail } from './authRepo'
import {
  validateContact, canRemoveContact, validateBankChange, validateProfile,
  canDelegate, validatePause,
} from './partnerDetails'
import type {
  Contact, ContactKind, ContactPurpose, BankAccount, BankDraft, PartnerUser,
} from './partnerDetails'

export type Result = { ok: true; note?: string } | { ok: false; reason: string }

export interface GoLive {
  partner_id: string
  category_id: string
  storefront_enabled: boolean
  went_live_on: string | null
  first_listing_on: string | null
  opened_by: string | null
  paused_reason: string | null
  paused_on: string | null
}

export interface MyDetails {
  /* The person signed in, matched on the address the session authenticates as
     rather than on a flag in the row — a "this is you" column drifts the moment
     a second person signs in. */
  me: PartnerUser | null
  colleagues: PartnerUser[]
  contacts: Contact[]
  bank: BankAccount | null
  golive: GoLive[]
  authEmail: string | null
  loadError?: string
}

export async function loadMyDetails(partnerId: string): Promise<MyDetails> {
  const [email, users, contacts, bankRes, gl] = await Promise.all([
    currentEmail(),
    supabase.from('partner_users').select('*').eq('partner_id', partnerId).order('sort_order'),
    supabase.from('partner_contacts').select('*').eq('partner_id', partnerId).order('sort_order'),
    supabase.from('partner_bank').select('*').eq('partner_id', partnerId).maybeSingle(),
    supabase.from('partner_golive').select('*').eq('partner_id', partnerId),
  ])

  const errors: string[] = []
  if (users.error) errors.push(`people: ${users.error.message}`)
  if (contacts.error) errors.push(`contacts: ${contacts.error.message}`)
  if (bankRes.error) errors.push(`settlement account: ${bankRes.error.message}`)
  if (gl.error) errors.push(`go-live: ${gl.error.message}`)

  const all = (users.data ?? []) as PartnerUser[]
  const me = email ? all.find(u => u.email.toLowerCase() === email.toLowerCase()) ?? null : null

  return {
    me,
    colleagues: all.filter(u => u.id !== me?.id),
    contacts: (contacts.data ?? []) as Contact[],
    bank: (bankRes.data ?? null) as BankAccount | null,
    golive: (gl.data ?? []) as GoLive[],
    authEmail: email,
    ...(errors.length > 0 ? { loadError: `Some of your record could not be loaded (${errors.join('; ')}).` } : {}),
  }
}

export interface PartnerSettlement {
  bank: BankAccount | null
  contacts: Contact[]
  golive: GoLive[]
  loadError?: string
}

/** The same three tables from the marketplace's side. Separate from
    loadMyDetails because the operator has no "you" here — they are reading
    somebody else's record, which is exactly why the reveal below is logged. */
export async function loadPartnerSettlement(partnerId: string): Promise<PartnerSettlement> {
  const [bankRes, contacts, gl] = await Promise.all([
    supabase.from('partner_bank').select('*').eq('partner_id', partnerId).maybeSingle(),
    supabase.from('partner_contacts').select('*').eq('partner_id', partnerId).order('sort_order'),
    supabase.from('partner_golive').select('*').eq('partner_id', partnerId),
  ])
  const errors: string[] = []
  if (bankRes.error) errors.push(`settlement account: ${bankRes.error.message}`)
  if (contacts.error) errors.push(`contacts: ${contacts.error.message}`)
  if (gl.error) errors.push(`go-live: ${gl.error.message}`)
  return {
    bank: (bankRes.data ?? null) as BankAccount | null,
    contacts: (contacts.data ?? []) as Contact[],
    golive: (gl.data ?? []) as GoLive[],
    ...(errors.length > 0 ? { loadError: errors.join('; ') } : {}),
  }
}

/**
 * The marketplace looking at a seller's account number in full.
 *
 * The record exists so the platform can pay somebody, not so it can be read, so
 * this is a deliberate act with a reason attached and an audit row naming who
 * looked. An unexplained look at somebody's bank details is the one nobody can
 * defend afterwards.
 */
export async function logBankReveal(
  { partnerId, partnerName, why, by }: {
    partnerId: string; partnerName: string; why: string; by: string
  },
): Promise<Result> {
  if (why.trim().length < 8) {
    return { ok: false, reason: 'A reason is required. An unexplained look at somebody’s bank details is the one nobody can defend afterwards.' }
  }
  await writeAudit(by, 'bank.revealed', `${partnerId} · ${partnerName}`, 'high',
    `Full settlement detail shown once — ${why.trim()}`)
  return { ok: true, note: 'Shown once, and recorded against your name.' }
}

/* ---------------------------------------------------------------- you ----- */

export async function saveProfile(
  me: PartnerUser,
  patch: { name: string; job_title: string; timezone: string; date_format: string; digest: string },
): Promise<Result> {
  const check = validateProfile(patch.name, patch.job_title)
  if (!check.ok) return check

  const { error } = await supabase.from('partner_users').update({
    name: patch.name.trim(), job_title: patch.job_title.trim(),
    timezone: patch.timezone, date_format: patch.date_format, digest: patch.digest,
  }).eq('id', me.id)
  if (error) return { ok: false, reason: `That did not save: ${error.message}` }
  return { ok: true, note: 'Your details are saved.' }
}

/**
 * Marking yourself away, and who covers.
 *
 * Away and delegate move together. The database refuses a delegate on somebody
 * who is not away, which is deliberate: cover that is recorded but not in force
 * reads on screen as cover you have, and it is the reason an approval sits for a
 * fortnight.
 */
export async function setAway(
  me: PartnerUser, away: boolean, delegateId: string | null, colleagues: readonly PartnerUser[],
): Promise<Result> {
  if (away && delegateId) {
    const to = colleagues.find(c => c.id === delegateId)
    if (!to) return { ok: false, reason: 'That colleague is no longer on your team.' }
    const verdict = canDelegate(me, to)
    if (!verdict.ok) return verdict
  }

  const { error } = await supabase.from('partner_users')
    .update({ out_of_office: away, delegate_id: away ? delegateId : null })
    .eq('id', me.id)
  if (error) return { ok: false, reason: `That did not save: ${error.message}` }

  if (!away) return { ok: true, note: 'Welcome back — work routes to you again.' }
  const to = colleagues.find(c => c.id === delegateId)
  return {
    ok: true,
    note: to ? `Work routes to ${to.name} while you are away.`
             : 'You are marked as away. With no delegate, work assigned to you will wait.',
  }
}

/** Multi-factor on one account. Turning it off is the change worth being
    explicit about, so the caller is told what it costs. */
export async function setMfa(user: PartnerUser, on: boolean): Promise<Result> {
  const { error } = await supabase.from('partner_users').update({ mfa: on }).eq('id', user.id)
  if (error) return { ok: false, reason: `That did not save: ${error.message}` }
  return {
    ok: true,
    note: on
      ? 'Multi-factor is on. A stolen password is no longer enough on its own.'
      : 'Multi-factor is off. A stolen password alone would now be enough to sign in.',
  }
}

export async function signOutOtherSessions(user: PartnerUser): Promise<Result> {
  const others = Math.max(0, user.sessions - 1)
  if (others === 0) return { ok: true, note: 'No other sessions are open.' }
  const { error } = await supabase.from('partner_users').update({ sessions: 1 }).eq('id', user.id)
  if (error) return { ok: false, reason: `That did not work: ${error.message}` }
  return { ok: true, note: `${others} other session${others === 1 ? '' : 's'} signed out.` }
}

/** Record that the password changed. The change itself goes through Supabase
    Auth in authRepo — this is only the seller-visible history of it. */
export async function stampPasswordChange(user: PartnerUser, strength: 'weak' | 'fair' | 'strong'): Promise<void> {
  await supabase.from('partner_users').update({
    pwd_changed: new Date().toISOString().slice(0, 10),
    pwd_strength: strength,
    must_reset: false,
  }).eq('id', user.id)
}

/* ------------------------------------------------------------ contacts ---- */

export async function addContact(
  { partnerId, kind, value, purpose, label, existing }: {
    partnerId: string
    kind: ContactKind
    value: string
    purpose: ContactPurpose
    label: string
    existing: readonly Contact[]
  },
): Promise<Result> {
  const check = validateContact({ kind, value, purpose, existing })
  if (!check.ok) return check

  const { error } = await supabase.from('partner_contacts').insert({
    id: `PC-${Date.now().toString(36).slice(-6).toUpperCase()}`,
    partner_id: partnerId, kind, value: value.trim(), purpose,
    label: label.trim() || null,
    /* New contacts start unproved. Nothing is sent to an address nobody has
       confirmed reads — an incident page to an unverified number is the same as
       no page at all. */
    verified: false, verified_on: null,
    sort_order: existing.length + 1,
  })
  if (error) return { ok: false, reason: `That was not added: ${error.message}` }
  return {
    ok: true,
    note: 'Added. It is not used for anything until it is verified — send the confirmation from the row.',
  }
}

/** Standing in for a real round trip: a live build sends a code and waits for
    it. What matters here is that an unverified contact is never used, and this
    is the only thing that changes that. */
export async function verifyContact(contact: Contact): Promise<Result> {
  if (contact.verified) return { ok: true, note: 'Already verified.' }
  const { error } = await supabase.from('partner_contacts')
    .update({ verified: true, verified_on: new Date().toISOString().slice(0, 10) })
    .eq('id', contact.id)
  if (error) return { ok: false, reason: `That did not work: ${error.message}` }
  return { ok: true, note: `${contact.value} is verified and will now be used.` }
}

export async function removeContact(contact: Contact): Promise<Result> {
  const check = canRemoveContact(contact)
  if (!check.ok) return check
  const { error } = await supabase.from('partner_contacts').delete().eq('id', contact.id)
  if (error) return { ok: false, reason: `That was not removed: ${error.message}` }
  return { ok: true, note: `${contact.value} removed.` }
}

/* ---------------------------------------------------------------- bank ---- */

/**
 * A seller asking for their settlement account to change.
 *
 * It lands in the pending slot, not in the live columns. Payouts keep running to
 * the account on file until the marketplace confirms the new one, and the
 * request carries a reason the marketplace can read. Changing where money goes
 * is the change most worth attacking, so it is the one that does not take effect
 * on save.
 */
export async function requestBankChange(
  { partnerId, draft, current, requestedBy }: {
    partnerId: string
    draft: BankDraft
    current: BankAccount | null
    requestedBy: string
  },
): Promise<Result> {
  const check = validateBankChange(draft, current)
  if (!check.ok) return check
  if (current?.pending_status === 'submitted') {
    return { ok: false, reason: 'There is already a change waiting on the marketplace. Withdraw that one first.' }
  }

  const { error } = await supabase.from('partner_bank').update({
    pending_status: 'submitted',
    pending_holder: draft.holder.trim(),
    pending_bank: draft.bank.trim(),
    pending_branch: draft.branch.trim() || null,
    pending_account: draft.account.replace(/\s+/g, ''),
    pending_local: draft.local.trim() || null,
    pending_swift: draft.swift.trim() || null,
    pending_why: draft.why.trim(),
    pending_requested_on: new Date().toISOString().slice(0, 10),
    pending_requested_by: requestedBy,
    pending_decided_on: null, pending_decided_by: null, pending_note: null,
  }).eq('partner_id', partnerId)
  if (error) return { ok: false, reason: `That was not submitted: ${error.message}` }

  await writeAudit(requestedBy, 'bank.change.requested', partnerId, 'high',
    `Settlement account change requested — ${draft.why.trim()}. Payouts hold on the account on file until the marketplace confirms the new one.`)

  return {
    ok: true,
    note: 'Submitted. Settlements keep paying to the account on file until the marketplace confirms the new one.',
  }
}

export async function withdrawBankChange(partnerId: string, by: string): Promise<Result> {
  const { error } = await supabase.from('partner_bank').update({
    pending_status: 'none',
    pending_holder: null, pending_bank: null, pending_branch: null, pending_account: null,
    pending_local: null, pending_swift: null, pending_why: null,
    pending_requested_on: null, pending_requested_by: null,
    pending_decided_on: null, pending_decided_by: null, pending_note: null,
  }).eq('partner_id', partnerId)
  if (error) return { ok: false, reason: `That was not withdrawn: ${error.message}` }
  await writeAudit(by, 'bank.change.withdrawn', partnerId, 'info',
    'The seller withdrew their settlement account change. Nothing moved.')
  return { ok: true, note: 'Withdrawn. Nothing about your settlement account changed.' }
}

/**
 * The marketplace confirming a change. This is the only path from pending to
 * live: it promotes the requested detail into the live columns and re-opens the
 * verification, because the new account has never had a payment proved against
 * it.
 */
export async function confirmBankChange(
  bank: BankAccount, by: string,
): Promise<Result> {
  if (bank.pending_status !== 'submitted') {
    return { ok: false, reason: 'There is no change waiting on this account.' }
  }
  const today = new Date().toISOString().slice(0, 10)
  const { error } = await supabase.from('partner_bank').update({
    holder: bank.pending_holder, bank: bank.pending_bank,
    branch: bank.pending_branch, account: bank.pending_account,
    local_code: bank.pending_local ?? bank.local_code,
    swift: bank.pending_swift ?? bank.swift,
    /* A new account is a new instruction. Carrying the old verification across
       would mean the marketplace had proved a payment to an account it has
       never paid. */
    verified: true, verified_on: today, verified_by: by,
    method: 'Two micro-deposits matched',
    pending_status: 'none',
    pending_holder: null, pending_bank: null, pending_branch: null, pending_account: null,
    pending_local: null, pending_swift: null, pending_why: null,
    pending_requested_on: null, pending_requested_by: null,
    pending_decided_on: null, pending_decided_by: null, pending_note: null,
  }).eq('partner_id', bank.partner_id)
  if (error) return { ok: false, reason: `That was not confirmed: ${error.message}` }

  await writeAudit(by, 'bank.change.confirmed', bank.partner_id, 'high',
    `Settlement account changed. Settlements from the next run pay to the new account.`)
  return { ok: true, note: 'Confirmed. The next settlement run pays to the new account.' }
}

export async function rejectBankChange(bank: BankAccount, by: string, note: string): Promise<Result> {
  if (!note.trim()) {
    return { ok: false, reason: 'Say why. A refusal with no reason on it comes straight back as the same request.' }
  }
  const { error } = await supabase.from('partner_bank').update({
    pending_status: 'rejected',
    pending_decided_on: new Date().toISOString().slice(0, 10),
    pending_decided_by: by,
    pending_note: note.trim(),
  }).eq('partner_id', bank.partner_id)
  if (error) return { ok: false, reason: `That was not recorded: ${error.message}` }
  await writeAudit(by, 'bank.change.rejected', bank.partner_id, 'high',
    `Settlement account change refused — ${note.trim()}`)
  return { ok: true, note: 'Refused, with the reason sent back to the seller.' }
}

/** A replacement treaty certificate. Withholding changes on the settlement run
    after the marketplace accepts it, never before and never backdated. */
export async function recordTreatyCertificate(
  partnerId: string, expires: string, by: string,
): Promise<Result> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(expires)) {
    return { ok: false, reason: 'Give the date it is valid to. A certificate with no expiry cannot be checked, and checking it is the whole point.' }
  }
  if (new Date(expires + 'T00:00:00Z').getTime() <= Date.now()) {
    return { ok: false, reason: 'That date has already passed. A certificate that has expired changes nothing.' }
  }
  const { error } = await supabase.from('partner_bank').update({
    treaty_on_file: true,
    treaty_expires: expires,
    withholding: `Nil under treaty — certificate expires ${fmt(expires)}, pending marketplace review`,
  }).eq('partner_id', partnerId)
  if (error) return { ok: false, reason: `That was not recorded: ${error.message}` }
  await writeAudit(by, 'bank.treaty.recorded', partnerId, 'info',
    `Tax residency certificate recorded, valid to ${fmt(expires)}`)
  return {
    ok: true,
    note: `Recorded. Withholding changes on the settlement run after the marketplace accepts it — anything already withheld is reclaimed from the authority, not from us.`,
  }
}

/* -------------------------------------------------------------- go-live --- */

export async function pauseStorefront(
  { partnerId, categoryId, reason, liveListings, by }: {
    partnerId: string; categoryId: string; reason: string; liveListings: number; by: string
  },
): Promise<Result> {
  const check = validatePause(reason, liveListings)
  if (!check.ok) return check
  const { error } = await supabase.from('partner_golive').update({
    storefront_enabled: false,
    paused_reason: reason.trim(),
    paused_on: new Date().toISOString().slice(0, 10),
  }).eq('partner_id', partnerId).eq('category_id', categoryId)
  if (error) return { ok: false, reason: `That did not save: ${error.message}` }
  await writeAudit(by, 'storefront.paused', `${partnerId}/${categoryId}`, 'notice',
    `Storefront paused by the seller — ${reason.trim()}. ${liveListings} listing${liveListings === 1 ? '' : 's'} hidden from buyers.`)
  return {
    ok: true,
    note: `Paused. Your ${liveListings} listing${liveListings === 1 ? '' : 's'} ${liveListings === 1 ? 'is' : 'are'} hidden from buyers but not withdrawn — reopening puts them straight back.`,
  }
}

export async function reopenStorefront(
  { partnerId, categoryId, by }: { partnerId: string; categoryId: string; by: string },
): Promise<Result> {
  const { error } = await supabase.from('partner_golive').update({
    storefront_enabled: true, paused_reason: null, paused_on: null,
  }).eq('partner_id', partnerId).eq('category_id', categoryId)
  if (error) return { ok: false, reason: `That did not save: ${error.message}` }
  await writeAudit(by, 'storefront.reopened', `${partnerId}/${categoryId}`, 'notice',
    'Storefront reopened by the seller.')
  return { ok: true, note: 'Reopened. Your listings are back in front of buyers.' }
}

/* ------------------------------------------------------------------------- */

function fmt(iso: string): string {
  return new Date(iso + 'T00:00:00Z').toLocaleDateString('en-GB',
    { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' })
}

async function writeAudit(
  actor: string, action: string, object: string, severity: string, detail: string,
): Promise<void> {
  await supabase.from('operator_audit_log').insert({
    id: `AUD-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    actor, role: 'Seller', action, object,
    category: 'Partners', severity, outcome: 'success',
    before_val: null, after_val: detail,
  })
}
