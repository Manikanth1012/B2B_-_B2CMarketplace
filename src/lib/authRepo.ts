import { supabase } from './supabase'
import { sessionFromAppMetadata, SignInError } from './auth'
import type { Session } from '../types/view'

/* The only module that talks to Supabase Auth. The rules it applies live in
   auth.ts, so they can be tested without credentials. */

export { SignInError }

/** Exchange credentials for a real JWT. The persona comes back from the server. */
/**
 * Signing in.
 *
 * `demo` changes only what a refusal says. The message used to end "Use the
 * pre-filled demo credentials" for everybody, which on the real sign-in screen
 * is advice a registered seller cannot act on — there are no prefilled
 * credentials there, and the sentence reads as though the marketplace has
 * mistaken them for a tourist.
 *
 * Neither version says which half was wrong. "No account with that address"
 * tells a stranger who is registered here.
 */
export async function signIn(email: string, password: string, demo = false): Promise<Session> {
  const { data, error } = await supabase.auth.signInWithPassword({
    email: email.trim(),
    password,
  })

  if (error) {
    throw new SignInError(demo
      ? 'Incorrect email or password. Use the pre-filled demo credentials.'
      : 'Incorrect email or password.')
  }

  const session = sessionFromAppMetadata(data.user?.app_metadata)
  if (!session) {
    // Signed in, but this account is not one of the four personas. Do not leave
    // a half-session behind.
    await supabase.auth.signOut()
    throw new SignInError('This account has no console assigned to it.')
  }
  return session
}

/** Restore a session on page load. Null when there is no valid one. */
export async function restoreSession(): Promise<Session | null> {
  const { data } = await supabase.auth.getSession()
  if (!data.session) return null
  return sessionFromAppMetadata(data.session.user.app_metadata)
}

/* Signs out of this browser only.
 *
 * The default is `global`, which revokes every refresh token the person holds
 * — signing out on a laptop would sign them out on their phone mid-order. The
 * app has no "sign out everywhere" control, so nobody ever asked for that. */
export async function signOut(): Promise<void> {
  await supabase.auth.signOut({ scope: 'local' })
}

/** The address the session is actually authenticated as. Not the same thing as
    `consumer_profile.email`, which is display text — Priya signs in as
    priya.raman@example.com and her profile reads priya.raman@6dtech.co.in. Anything
    reasoning about identity has to use this one. */
export async function currentEmail(): Promise<string | null> {
  const { data } = await supabase.auth.getSession()
  return data.session?.user.email ?? null
}

/**
 * Change the signed-in user's password, for real.
 *
 * Supabase's `updateUser` does **not** ask for the current password — a stolen
 * session could otherwise change it and lock the owner out. So the current password
 * is verified first by signing in with it. That call also refreshes the session,
 * which is what `updateUser` then acts on.
 */
export async function changePassword(current: string, next: string): Promise<void> {
  const { data: sessionData } = await supabase.auth.getSession()
  const email = sessionData.session?.user.email
  if (!email) throw new SignInError('You are not signed in.')

  const { error: reauthError } = await supabase.auth.signInWithPassword({ email, password: current })
  if (reauthError) throw new SignInError('That is not your current password.')

  const { error } = await supabase.auth.updateUser({ password: next })
  if (error) throw new SignInError(error.message)
}

/**
 * Send a reset link. Resolves the same way whether or not the address has an account
 * — the caller shows one message either way, so this never reveals who is registered.
 */
export async function requestPasswordReset(email: string): Promise<void> {
  await supabase.auth.resetPasswordForEmail(email.trim(), {
    redirectTo: `${window.location.origin}/`,
  })
}
