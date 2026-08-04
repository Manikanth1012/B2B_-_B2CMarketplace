/* Becoming a shopper.
   No React and no Supabase, so the rules can be tested without a network.

   Unlike a seller application this makes a real account on the first screen —
   everything a shopper does is owner-scoped, so there is nothing to hang a
   basket on until an auth user exists. What that buys is that the rules here
   are about one form, and the thing they are protecting is the moment somebody
   commits a password.

   The password rules are the interesting part, and they are deliberately not
   the usual ones. A rule that demands a symbol and a digit and a capital is a
   rule people satisfy with `Password1!`, which is on every list ever leaked.
   Length does more than composition, so length is what is required, and the
   check that actually matters is against the obvious. */

export type Check = { ok: true } | { ok: false; reason: string }

export interface SignUpDraft {
  name: string
  email: string
  password: string
  msisdn: string
  city: string
  market: string
}

export const BLANK_SIGNUP: SignUpDraft = {
  name: '', email: '', password: '', msisdn: '', city: '', market: '',
}

/* Long enough that guessing is hopeless, short enough to type on a phone.
   Supabase's own floor is 6, which is not a floor. */
export const MIN_PASSWORD = 10

/* Not a leak list — this is a prototype and shipping one would be theatre. It
   is the handful somebody actually types when a box demands ten characters,
   plus what this marketplace is called. Matched on the whole password
   lowercased, so `Marketplace123` is caught and `xmarketplacex` is not the
   point. */
const OBVIOUS = [
  'password', 'passw0rd', '1234567890', 'qwertyuiop', 'letmein', 'iloveyou',
  'aventa', 'marketplace', '6dtech', 'abcdefghij', 'welcome1',
]

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const PHONE_DIGITS = 7

export function validatePassword(password: string, { name = '', email = '' } = {}): Check {
  if (password.length < MIN_PASSWORD) {
    return {
      ok: false,
      reason: `Use at least ${MIN_PASSWORD} characters. Length is what makes a password hard to guess — three ordinary words beat one clever one.`,
    }
  }
  const lower = password.toLowerCase()
  if (OBVIOUS.some(o => lower.includes(o))) {
    return { ok: false, reason: 'That contains something on every list of first guesses. Pick words that are not about this site.' }
  }
  /* Their own name or the local part of their address. Both are on the same
     screen, so both are the first things anybody would try. */
  const localPart = email.split('@')[0]?.toLowerCase() ?? ''
  for (const own of [name.toLowerCase().replace(/\s+/g, ''), localPart]) {
    if (own.length >= 4 && lower.includes(own)) {
      return { ok: false, reason: 'That contains your own name or email address, which is the first thing anybody would try.' }
    }
  }
  if (/^(.)\1+$/.test(password)) {
    return { ok: false, reason: 'That is one character repeated. Length only helps if the characters differ.' }
  }
  return { ok: true }
}

/**
 * Everything the form needs before it commits.
 *
 * One pass over the whole draft rather than a check per field, in the order the
 * fields are asked — somebody told about the password, who fixes it and is then
 * told about the city, has been made to go round twice.
 */
export function validateSignUp(
  draft: SignUpDraft, markets: readonly { code: string }[] = [],
): Check {
  if (!draft.name.trim()) {
    return { ok: false, reason: 'Give the name the account should be in.' }
  }
  if (!EMAIL.test(draft.email.trim())) {
    return { ok: false, reason: 'That does not look like an email address, and it is how you sign in.' }
  }
  const pass = validatePassword(draft.password, { name: draft.name, email: draft.email })
  if (!pass.ok) return pass
  if ((draft.msisdn.match(/\d/g) ?? []).length < PHONE_DIGITS) {
    return { ok: false, reason: 'Give a mobile number — it is what plans and top-ups are attached to.' }
  }
  if (!draft.city.trim()) {
    return { ok: false, reason: 'Give a city, so deliveries and tax go to the right place.' }
  }
  if (!draft.market.trim()) {
    return { ok: false, reason: 'Say which country you are in. It decides what you are charged and the tax you pay.' }
  }
  /* Checked against what exists rather than a list here, and skipped while the
     markets are still loading — the database has the last word either way. */
  if (markets.length > 0 && !markets.some(m => m.code === draft.market)) {
    return { ok: false, reason: 'The marketplace does not operate there yet. Pick one of the countries listed.' }
  }
  return { ok: true }
}

/**
 * How good the password is, for the meter beside the box.
 *
 * Four bands rather than a percentage, because a percentage invites somebody to
 * push it to 100 by adding a `!`. Anything `validatePassword` refuses is 'weak'
 * whatever its length, so the meter and the button never disagree.
 */
export type Strength = 'weak' | 'fair' | 'good' | 'strong'

export function passwordStrength(password: string, own: { name?: string; email?: string } = {}): Strength {
  if (!validatePassword(password, own).ok) return 'weak'
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^a-zA-Z0-9]/].filter(r => r.test(password)).length
  /* Length first and composition second, which is the order that matters. A
     seventeen-character phrase of plain words outranks a ten-character jumble.
     Nothing at the minimum length reaches "good" however it is punctuated:
     `Tr0ub4dor!` has all four character classes and is the textbook example of
     a password that looks strong and is not, so composition alone cannot lift
     a password off the floor. */
  if (password.length >= 16) return 'strong'
  if (password.length >= 13) return classes >= 2 ? 'strong' : 'good'
  if (password.length >= MIN_PASSWORD + 1) return classes >= 3 ? 'good' : 'fair'
  return 'fair'
}

/** What the marketplace can tell a new shopper about where they will be
    buying, before they commit to it. */
export function marketNote(
  market: string,
  markets: readonly { code: string; name: string; tax_label: string; tax_rate: number | string }[],
  currencies: readonly { market_code: string; currency: string; is_default: boolean }[],
): string | null {
  const m = markets.find(x => x.code === market)
  if (!m) return null
  const takes = currencies
    .filter(c => c.market_code === market)
    .sort((a, b) => Number(b.is_default) - Number(a.is_default))
    .map(c => c.currency)
  const money = takes.length > 1
    ? `${takes.slice(0, -1).join(', ')} or ${takes[takes.length - 1]}`
    : takes[0] ?? ''
  return `You will buy in ${m.name}, pay in ${money}, and be charged ${m.tax_label} at ${m.tax_rate}%. This is set by where you register and does not change with the storefront picker.`
}
