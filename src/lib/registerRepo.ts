/* The only module that registers a shopper.
   Rules live in register.ts so they can be tested without a network.

   Two steps that have to both happen: an auth user, and the marketplace rows
   that make that user a customer. They cannot be one transaction — one is
   Supabase's auth service and the other is Postgres — so the order is chosen so
   that the failure in between is the recoverable one.

   Auth first. A sign-in with no profile is a state the app already understands:
   `signIn` returns "this account is not one of the four personas" and the
   person can try again, because `register_as_consumer` is idempotent in the
   only direction that matters — it refuses a second profile and creates a first
   one. The other order would mint a customer number for an account that does
   not exist. */

import { supabase } from './supabase'
import { validateSignUp } from './register'
import type { Check, SignUpDraft } from './register'
import type { Session } from '../types/view'

export type Result =
  | { ok: true; customer_id: string; session: Session }
  | { ok: false; reason: string }

function friendly(message: string): string {
  /* Supabase says "User already registered" for an address that exists, which
     is true and tells somebody nothing about what to do next. */
  if (/already registered|already exists/i.test(message)) {
    return 'There is already an account on that email address. Sign in instead, or use the password reset if you cannot get in.'
  }
  if (/password/i.test(message) && /short|least|weak/i.test(message)) {
    return 'That password is too short for the marketplace to accept.'
  }
  if (/rate limit|too many/i.test(message)) {
    return 'Too many attempts from here just now. Wait a minute and try again.'
  }
  const m = /(?:^|\n)([A-Z][^\n]*\.)\s*$/.exec(message)
  return (m?.[1] ?? message).replace(/^ERROR:\s*/, '').trim()
}

/** Whether an address is spoken for, so the form can say so before it sends
    somebody through a sign-up that will fail. */
export async function emailTaken(email: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('email_is_registered', { p_email: email })
  /* On error, say no. A false "that is taken" stops somebody registering at
     all, where a false "that is free" is corrected one step later by the real
     check inside `signUp`. */
  return error ? false : data === true
}

export async function registerShopper(
  draft: SignUpDraft, markets: readonly { code: string }[] = [],
): Promise<Result> {
  const check: Check = validateSignUp(draft, markets)
  if (!check.ok) return check

  const { data, error } = await supabase.auth.signUp({
    email: draft.email.trim(),
    password: draft.password,
  })
  if (error) return { ok: false, reason: friendly(error.message) }

  /* No session means the project requires an emailed confirmation. This one
     does not, but saying so plainly beats the alternative — a spinner that
     never resolves and a customer number that was never issued. */
  if (!data.session || !data.user) {
    return {
      ok: false,
      reason: 'The account was created but not signed in. Check your email for a confirmation link, then sign in.',
    }
  }

  const { data: customer, error: profileError } = await supabase.rpc('register_as_consumer', {
    p_name: draft.name, p_msisdn: draft.msisdn, p_city: draft.city, p_market: draft.market,
  })
  if (profileError) {
    /* The sign-in exists and the profile does not. Left signed out rather than
       half-in: a session with no persona reaches nothing and looks like a bug,
       and the address is now taken so a retry has to go through sign-in. */
    await supabase.auth.signOut()
    return {
      ok: false,
      reason: `${friendly(profileError.message)} The sign-in was created — use it to sign in and the profile will be finished then.`,
    }
  }

  /* Nudge every auth listener to look again.
   *
   * `signUp` fires SIGNED_IN before this function has created the profile, so
   * anything that reads the profile on an auth event reads it too early and
   * caches the answer. `MarketContext` does exactly that — it resolves the home
   * market from `consumer_profile.market` — and a shopper who registered in
   * Nairobi was landing on an Indian storefront, priced in rupees, until they
   * reloaded. Refreshing the session raises TOKEN_REFRESHED, which every
   * listener already handles. */
  await supabase.auth.refreshSession()

  return {
    ok: true,
    customer_id: String(customer),
    /* `Session` carries the persona and, for a seller, the partner id. A shopper
       has neither an id to carry nor anywhere to carry it — the console reads
       `auth.uid()` off the JWT for everything it needs. */
    session: { persona: 'consumer' },
  }
}

/**
 * Finish a registration that stopped half-way.
 *
 * The recovery for the gap above: somebody whose auth user exists and whose
 * profile does not signs in, gets no persona, and lands here rather than at a
 * dead end.
 */
export async function completeRegistration(
  draft: Pick<SignUpDraft, 'name' | 'msisdn' | 'city' | 'market'>,
): Promise<{ ok: true; customer_id: string } | { ok: false; reason: string }> {
  const { data, error } = await supabase.rpc('register_as_consumer', {
    p_name: draft.name, p_msisdn: draft.msisdn, p_city: draft.city, p_market: draft.market,
  })
  if (error) return { ok: false, reason: friendly(error.message) }
  return { ok: true, customer_id: String(data) }
}
