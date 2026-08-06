/* The only module that talks to the identity provider.
   Rules live in `sso.ts` so they can be tested without a network.

   The order of the two writes is the same as `registerShopper`'s, for the same
   reason: an auth user and the marketplace rows that make it a customer cannot
   be one transaction, because one is Supabase's auth service and the other is
   Postgres. Auth first, so the failure in between is the recoverable one — a
   sign-in with no profile is a state the app already understands, where the
   other order mints a customer number for an account that does not exist. */

import { supabase } from './supabase'
import type { Assertion, Begun } from './sso'
import type { Session } from '../types/view'

export type BeginResult = { ok: true; begun: Begun } | { ok: false; reason: string }
export type OpenResult =
  | { ok: true; customer_id: string; session: Session }
  | { ok: false; reason: string }
export type LinkResult = { ok: true; subject: string } | { ok: false; reason: string }

function friendly(message: string): string {
  const m = /(?:^|\n)([A-Z][^\n]*[.!])\s*$/.exec(message)
  return (m?.[1] ?? message).replace(/^ERROR:\s*/, '').trim()
}

/**
 * Ask the provider who this is, and the marketplace what it would do about it.
 *
 * One round trip rather than two, because the second question cannot be
 * answered on the client: deciding between "open an account" and "an account
 * already exists" needs a privileged look at the auth table, and exposing that
 * lookup would turn the marketplace into a directory of who is registered.
 */
export async function beginSso(subject: string, secret: string): Promise<BeginResult> {
  const { data, error } = await supabase.rpc('sso_begin', {
    p_subject: subject, p_secret: secret,
  })
  if (error) return { ok: false, reason: friendly(error.message) }

  const row = (Array.isArray(data) ? data[0] : data) as (Assertion & {
    outcome: Begun['outcome']; reason: string | null
  }) | undefined
  if (!row) return { ok: false, reason: 'That did not match an Aventa ID.' }

  const { outcome, reason, ...assertion } = row
  return { ok: true, begun: { outcome, reason, assertion: assertion as Assertion } }
}

/**
 * Open a marketplace account from the assertion, with no form.
 *
 * The generated credential is the simulation seam and is documented at length
 * in `20260806190000`. Nobody chooses it and nobody is ever shown it: it exists
 * because the marketplace account needs a Supabase credential to hold a
 * session, where a real deployment would exchange an authorization code for
 * tokens. It goes straight into `sso_provision`, which is the only thing that
 * can ever read it back.
 */
export async function openFromSso(
  assertion: Assertion, secret: string,
): Promise<OpenResult> {
  /* One UUID, not two. Two ran to 77 characters and bcrypt hashes at most 72
     bytes, so Supabase refused the sign-up with a bare 400 and the journey
     stopped on the review screen with no account and no explanation. 122 bits
     of entropy in a credential nobody types is already far past enough. */
  const generated = `sso-${crypto.randomUUID()}`

  const { data, error } = await supabase.auth.signUp({
    email: assertion.email, password: generated,
  })
  if (error) return { ok: false, reason: friendly(error.message) }
  if (!data.session || !data.user) {
    return {
      ok: false,
      reason: 'The account was created but not signed in. Try Continue with Aventa ID again.',
    }
  }

  const { data: customer, error: profileError } = await supabase.rpc('sso_provision', {
    p_subject: assertion.subject, p_secret: secret, p_mk_secret: generated,
  })
  if (profileError) {
    /* The sign-in exists and the profile does not. Signed out rather than left
       half-in — a session with no persona reaches nothing and looks like a bug.
       Unlike the registration form, the way back in is to press the same button
       again: `sso_provision` refuses a second profile and creates a first one,
       so the retry completes what this attempt started. */
    await supabase.auth.signOut()
    return { ok: false, reason: friendly(profileError.message) }
  }

  /* Nudge every auth listener to look again. `signUp` fires SIGNED_IN before
     the profile exists, so anything resolving the home market from
     `consumer_profile.market` on an auth event reads it too early and caches
     the answer — which is how a shopper who registered in Nairobi landed on an
     Indian storefront until they reloaded. */
  await supabase.auth.refreshSession()

  return { ok: true, customer_id: String(customer), session: { persona: 'consumer' } }
}

/**
 * Bind an account somebody has just proved is theirs.
 *
 * Called with a live session on the marketplace account — they have just typed
 * its password — and with the subject they proved at the provider. Two
 * credentials in one session is what makes this safe, and it is the whole
 * reason a match on the email address does not bind by itself.
 */
export async function linkToSso(subject: string, secret: string): Promise<LinkResult> {
  const { data, error } = await supabase.rpc('sso_link', {
    p_subject: subject, p_secret: secret, p_mk_secret: null,
  })
  if (error) return { ok: false, reason: friendly(error.message) }
  return { ok: true, subject: String(data) }
}

/**
 * Sign a returning customer in through the provider.
 *
 * Only works for an account that was opened this way. One linked by
 * confirmation has its own password and `sso_signin` says so rather than
 * handing back a credential it does not hold.
 */
export async function signInWithSso(
  subject: string, secret: string,
): Promise<OpenResult> {
  const { data, error } = await supabase.rpc('sso_signin', {
    p_subject: subject, p_secret: secret,
  })
  if (error) return { ok: false, reason: friendly(error.message) }

  const row = (Array.isArray(data) ? data[0] : data) as { email: string; secret: string } | undefined
  if (!row) return { ok: false, reason: 'That Aventa ID is not linked to a marketplace account yet.' }

  const { error: signInError } = await supabase.auth.signInWithPassword({
    email: row.email, password: row.secret,
  })
  if (signInError) return { ok: false, reason: friendly(signInError.message) }

  const { data: customer } = await supabase.from('consumer_profile')
    .select('customer_id').maybeSingle()

  return {
    ok: true,
    customer_id: String((customer as { customer_id?: string } | null)?.customer_id ?? ''),
    session: { persona: 'consumer' },
  }
}

/** Whether this account is bound to a subscriber, for the security screen. */
export async function myLink(): Promise<{
  subject: string; how: string; linked_on: string; msisdn: string
  kyc_level: string; kyc_verified_on: string; plan: string
} | null> {
  const { data } = await supabase.from('my_identity_link').select('*').maybeSingle()
  return (data as never) ?? null
}
