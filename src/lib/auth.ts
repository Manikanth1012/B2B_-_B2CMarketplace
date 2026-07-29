import { supabase } from './supabase'
import type { Persona, Session } from '../types/view'

const PERSONAS: readonly Persona[] = ['consumer', 'operator', 'partner', 'enterprise']

export function isPersona(value: unknown): value is Persona {
  return typeof value === 'string' && (PERSONAS as readonly string[]).includes(value)
}

/**
 * Build a Session from the identity the server issued.
 *
 * Reads `app_metadata` and nothing else. `user_metadata` is writable by the
 * signed-in user through `auth.updateUser`, so deriving a persona from it would
 * let any account promote itself to operator. `app_metadata` can only be written
 * with the service_role key, which is why the seeding script puts the persona
 * there.
 *
 * Returns null when the claim is missing or is not one of the four personas —
 * an authenticated user with no persona is not a session, and public signup is
 * enabled on this project, so that case is reachable by anyone.
 */
export function sessionFromAppMetadata(appMetadata: unknown): Session | null {
  const claims = (appMetadata ?? {}) as Record<string, unknown>
  if (!isPersona(claims.persona)) return null

  const partnerId = claims.partner_id
  return {
    persona: claims.persona,
    partnerId: typeof partnerId === 'string' ? partnerId : undefined,
  }
}

export class SignInError extends Error {}

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
