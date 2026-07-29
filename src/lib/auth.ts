import type { Persona, Session } from '../types/view'

/* Pure identity logic. Deliberately imports nothing that touches Supabase —
   ./supabase constructs a client at module load and throws without credentials,
   which would drag the unit tests into needing an environment. The I/O lives in
   authRepo.ts, the same split as kb.ts/kbRepo.ts and onboarding.ts. */

const PERSONAS: readonly Persona[] = ['consumer', 'operator', 'partner', 'enterprise']

export function isPersona(value: unknown): value is Persona {
  return typeof value === 'string' && (PERSONAS as readonly string[]).includes(value)
}

export class SignInError extends Error {}

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
