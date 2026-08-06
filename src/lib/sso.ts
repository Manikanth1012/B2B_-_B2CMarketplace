/* Signing in with an identity the telco already holds. Pure.
 *
 * A subscriber has already given the telco their name, number, address and
 * identity documents, and the telco has already verified them. The second door
 * carries that across instead of asking again — and asking again is not merely
 * slower, it is worse, because the second answer is unverified.
 *
 * The rules here are about what an assertion is allowed to decide and what it
 * must never be trusted to decide on its own. `ssoRepo.ts` does the talking;
 * this module has no network and no clock of its own.
 */

/** What the telco says about a subscriber. Everything here is theirs, not the
    marketplace's — including the market code, which is in the telco's
    vocabulary and may name a country the marketplace has never traded in. */
export interface Assertion {
  subject: string
  name: string
  email: string
  msisdn: string
  market: string
  city: string
  line1: string
  pin: string
  kyc_level: string
  kyc_id_kind: string
  kyc_id_masked: string
  kyc_verified_on: string
  customer_since: string
  plan: string
  market_name: string
  currency: string | null
}

export type Outcome = 'provision' | 'link' | 'signin' | 'refused'

export interface Begun {
  outcome: Outcome
  reason: string | null
  assertion: Assertion
}

/* ------------------------------------------------------- what happens next */

export interface NextStep {
  /* What the screen does. `confirm` is the one that matters: an account exists
     on the asserted address and the marketplace will not bind to it until
     somebody proves it is theirs. */
  step: 'open' | 'confirm' | 'enter' | 'stop'
  title: string
  detail: string
  /* The button, or null where there is nothing to do but read the refusal. */
  action: string | null
}

/**
 * What the marketplace does with an assertion, said the way a person reads it.
 *
 * The four outcomes are decided in `sso_begin` because deciding them needs a
 * privileged look at whether an account exists on the asserted address. This
 * turns that answer into a screen, and is separate so the wording can be tested
 * without a database.
 */
export function nextStep(begun: Begun): NextStep {
  const a = begun.assertion
  switch (begun.outcome) {
    case 'provision':
      return {
        step: 'open',
        title: `Open your marketplace account, ${firstName(a.name)}`,
        detail: `Everything below comes from your Aventa account and is already verified. Nothing to fill in.`,
        action: 'Open my account',
      }
    case 'link':
      return {
        step: 'confirm',
        title: 'You already have an account here',
        /* Deliberately not "we have linked them". The whole point is that a
           matching address is not proof, and the sentence should not imply the
           marketplace treated it as proof. */
        detail: begun.reason
          ?? `There is already a marketplace account on ${a.email}. Sign into it once to prove it is yours, and we will link the two for good.`,
        action: 'Sign in and link',
      }
    case 'signin':
      return {
        step: 'enter',
        title: `Welcome back, ${firstName(a.name)}`,
        detail: 'Your Aventa ID is linked to this marketplace account.',
        action: 'Continue',
      }
    default:
      return {
        step: 'stop',
        title: 'This Aventa ID cannot open a marketplace account',
        detail: begun.reason ?? 'The marketplace cannot open an account from this Aventa ID.',
        /* No action, and deliberately no "try again": the refusal is about a
           fact that a second attempt will not change. The way on is the
           ordinary registration form, offered beside this. */
        action: null,
      }
  }
}

const firstName = (full: string): string => full.trim().split(/\s+/)[0] || full

/* -------------------------------------------------- what carries across --- */

export interface CarriedField {
  label: string
  value: string
  /* Whether the telco verified this, or merely holds it. Only the first is
     worth the customer's trust, and the screen says which is which rather than
     implying everything shown was checked. */
  verified: boolean
}

/**
 * What the assertion brings, for the screen that shows somebody what they are
 * about to accept.
 *
 * Shown before the account is opened, not after. An onboarding that silently
 * copies a verified address into a marketplace account is one the customer
 * cannot audit, and "no fuss" is not the same as "no idea what happened".
 */
export function carried(a: Assertion): CarriedField[] {
  return [
    { label: 'Name', value: a.name, verified: true },
    { label: 'Mobile', value: a.msisdn, verified: true },
    { label: 'Email', value: a.email, verified: true },
    { label: 'Address', value: `${a.line1}, ${a.city} ${a.pin}`, verified: true },
    { label: 'Identity', value: `${a.kyc_id_kind} ${a.kyc_id_masked}`, verified: true },
    { label: 'Billed in', value: `${a.market_name}${a.currency ? ` · ${a.currency}` : ''}`, verified: false },
    { label: 'Your plan', value: a.plan, verified: false },
  ]
}

/**
 * What the marketplace still does not know, and will ask for later.
 *
 * Named on the same screen, because a customer told "nothing to fill in" and
 * then asked for a delivery address at checkout has been told something that
 * was not quite true.
 */
export const stillNeeded = (): string[] => [
  'A payment method, when you first buy something',
  'A delivery address, if it differs from the one above',
]

/* ------------------------------------------------------------ the binding */

export type LinkVerdict = { ok: true } | { ok: false; reason: string }

/**
 * Whether the account somebody just signed into is the one the assertion is
 * about.
 *
 * The last check before binding, and the one that makes "prove it with a
 * password" mean anything: proving *a* password is not proof unless it is the
 * password on the address the assertion names. Without this, anybody able to
 * sign into any marketplace account could bind any subscriber to it.
 *
 * The database refuses this too — the form is not the boundary — but a refusal
 * that arrives as a Postgres error after the round trip is one nobody can act
 * on.
 */
export function canBind(
  signedInAs: string | null | undefined, assertion: Pick<Assertion, 'email'>,
): LinkVerdict {
  if (!signedInAs) {
    return { ok: false, reason: 'You are not signed in, so there is nothing to link.' }
  }
  if (signedInAs.trim().toLowerCase() !== assertion.email.trim().toLowerCase()) {
    return {
      ok: false,
      reason: `You are signed in as ${signedInAs}, and the Aventa ID belongs to ${assertion.email}. Sign into that account instead.`,
    }
  }
  return { ok: true }
}

/* --------------------------------------------------- how they signed up --- */

export type IdentitySource = 'self' | 'telco-sso'

/**
 * What the account's own security screen may offer.
 *
 * An account opened through the second door has no marketplace password —
 * there was never one to choose — so offering "Change password" is offering to
 * change something that does not exist. It is the one place `identity_source`
 * has to be read rather than being provenance nobody acts on.
 */
export function securityOptions(
  source: IdentitySource, linked: boolean,
): { canChangePassword: boolean; note: string } {
  if (source === 'telco-sso') {
    return {
      canChangePassword: false,
      note: 'You sign in with your Aventa ID, so this account has no separate password. Change it with the telco and it changes here.',
    }
  }
  return {
    canChangePassword: true,
    note: linked
      ? 'This account has its own password, and your Aventa ID is linked to it. Either will sign you in.'
      : 'This account has its own password.',
  }
}
