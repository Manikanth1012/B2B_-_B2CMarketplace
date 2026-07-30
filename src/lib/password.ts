/* Password rules, pure. No React and no Supabase, so the policy can be tested
   without a network — and so there is one place that decides what "strong enough"
   means rather than a chain of ifs inside a modal. */

/* The four seeded personas. Their credentials are printed on the sign-in cards and
   re-seeded by scripts/seed-auth-users.mjs, and they are *shared* — every visitor to
   the demo signs in as the same Priya. One person changing her password locks
   everybody else out of the demo, including the integration suite.

   So the change is refused for these accounts specifically, and the refusal says why.
   Everything else about the flow is real: the current password is genuinely verified
   against Supabase Auth and a real account's password genuinely changes. Delete this
   list to enable it everywhere. */
const DEMO_ACCOUNTS = new Set([
  'priya.raman@example.com',
  'anika.sharma@aventa.com',
  'rajesh.kumar@nimbussensors.com',
  'vikram.shah@smartbuild.in',
])

export function isDemoAccount(email: string): boolean {
  return DEMO_ACCOUNTS.has(email.trim().toLowerCase())
}

export interface PasswordCheck {
  ok: boolean
  reason?: string
}

/* Twelve, not eight. The prototype documents a 12-character minimum and the account
   holds payment methods and an order history. Length beats composition rules for
   real-world strength, so there is no "must contain a symbol" here — a long
   passphrase should pass. */
export const MIN_LENGTH = 12

export function checkNewPassword(
  current: string,
  next: string,
  confirm: string,
): PasswordCheck {
  if (!current) return { ok: false, reason: 'Enter your current password.' }
  if (next.length < MIN_LENGTH) {
    return { ok: false, reason: `New password must be at least ${MIN_LENGTH} characters.` }
  }
  if (next !== confirm) return { ok: false, reason: 'The two new passwords do not match.' }
  if (next === current) {
    return { ok: false, reason: 'New password must be different from the current one.' }
  }
  return { ok: true }
}

/** A rough strength read for the meter. Deliberately about length and variety rather
    than a score anyone should trust — it guides, it does not gate. */
export function strengthOf(password: string): { level: 0 | 1 | 2 | 3; label: string } {
  if (password.length === 0) return { level: 0, label: '' }
  const variety =
    (/[a-z]/.test(password) ? 1 : 0) +
    (/[A-Z]/.test(password) ? 1 : 0) +
    (/[0-9]/.test(password) ? 1 : 0) +
    (/[^a-zA-Z0-9]/.test(password) ? 1 : 0)

  if (password.length < MIN_LENGTH) return { level: 1, label: 'Too short' }
  if (password.length >= 20 || variety >= 3) return { level: 3, label: 'Strong' }
  return { level: 2, label: 'Fair' }
}

/** Is this something we can send a reset link to? Deliberately loose — the server
    decides whether the account exists, and we never say. */
export function looksLikeEmail(value: string): boolean {
  const v = value.trim()
  return v.length > 3 && v.includes('@') && !v.startsWith('@') && !v.endsWith('@')
}

/* Whatever happens, the reset screen says the same thing. Confirming which addresses
   have accounts is an enumeration weakness, and it is the message a real service
   shows for exactly that reason. */
export const RESET_SENT_MESSAGE =
  'If an account exists for that address, a reset link is on its way. Check your inbox and spam folder.'
