import { supabase } from './supabase'
import { sessionFromAppMetadata, SignInError } from './auth'
import type { Session } from '../types/view'

/* The only module that talks to Supabase Auth. The rules it applies live in
   auth.ts, so they can be tested without credentials. */

export { SignInError }

/** Exchange credentials for a real JWT. The persona comes back from the server. */
export async function signIn(email: string, password: string): Promise<Session> {
  const { data, error } = await supabase.auth.signInWithPassword({
    email: email.trim(),
    password,
  })

  if (error) throw new SignInError('Incorrect email or password. Use the pre-filled demo credentials.')

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

export async function signOut(): Promise<void> {
  await supabase.auth.signOut()
}
