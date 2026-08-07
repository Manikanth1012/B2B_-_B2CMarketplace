/* Date of birth, and the one thing it is for.
 *
 * This is not a profile decoration. A mobile number cannot be issued to
 * somebody under 18 in their own name in India, Kenya or the UAE, and the
 * marketplace has been allocating them without a way to check. The date is the
 * input to that rule; everything else here follows from taking it seriously.
 *
 * Two positions, both enforced in the database as well:
 *
 *   Age is derived, never stored. A stored age is wrong the day after it is
 *   written and nothing recomputes it.
 *
 *   Nobody outside the customer needs the exact date. "Old enough" is what a
 *   rule needs; a band is what a report needs. The date itself stays with the
 *   person it belongs to.
 */

export type DobSource = 'self' | 'kyc' | 'import'

export const ADULT = 18

export const SOURCE_LABEL: Record<DobSource, string> = {
  self: 'As you told us',
  kyc: 'Checked against your ID',
  import: 'Carried over from your old account',
}

/** Whole years, turning over on the birthday and not before it. The naive
    version subtracts the years and is wrong for everybody whose birthday has
    not happened yet this year — which is, on any given day, about half of
    everybody. */
export function ageOn(dob: string | null, on: Date = new Date()): number | null {
  if (!dob) return null
  const d = new Date(dob)
  if (Number.isNaN(d.getTime())) return null
  let years = on.getFullYear() - d.getFullYear()
  const month = on.getMonth() - d.getMonth()
  if (month < 0 || (month === 0 && on.getDate() < d.getDate())) years -= 1
  return years
}

/** Null where the date is not held. Not false — "we do not know" and "under
    age" are different answers and only one of them is a refusal. */
export function isAdult(dob: string | null, on: Date = new Date()): boolean | null {
  const age = ageOn(dob, on)
  return age === null ? null : age >= ADULT
}

const BANDS: [number, string][] = [
  [18, 'under 18'], [25, '18-24'], [35, '25-34'], [50, '35-49'], [65, '50-64'],
]

/** For anywhere the exact date is more than is needed. An operator report does
    not require somebody's birthday. */
export function ageBand(dob: string | null, on: Date = new Date()): string {
  const age = ageOn(dob, on)
  if (age === null) return 'not given'
  for (const [under, label] of BANDS) if (age < under) return label
  return '65+'
}

export type Check = { ok: true; note?: string } | { ok: false; reason: string }

/** What a form may accept. The refusals are the ones that would otherwise sit
    in the table gating a legal check. */
export function validateDob(value: string, on: Date = new Date()): Check {
  if (!value.trim()) {
    /* Blank is allowed — a marketplace that has been running has customers who
       never gave one, and forcing a date makes people invent one. */
    return { ok: true, note: 'Leaving this blank is fine. We only need it where the law asks us for it.' }
  }
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return { ok: false, reason: 'That is not a date.' }
  if (d > on) return { ok: false, reason: 'A date of birth in the future is a typo, not a date of birth.' }

  const age = ageOn(value, on)!
  if (age > 130) return { ok: false, reason: 'That would make you over 130.' }
  if (age < ADULT) {
    return {
      ok: true,
      note: `You are ${age}. A mobile number cannot be issued in your own name until you are ${ADULT} — it goes to a parent or guardian, on their account.`,
    }
  }
  return { ok: true }
}

/** Whether a number can go to this person, and why not where it cannot. The
    same rule the database enforces, said here so the screen can explain the
    refusal before anybody presses anything. */
export function canHoldANumber(dob: string | null, on: Date = new Date()): Check {
  const adult = isAdult(dob, on)
  if (adult === null) {
    /* Not a refusal. The marketplace has issued numbers for years without
       asking, and retrospectively blocking everybody who never gave a date
       would take working lines off working customers. */
    return {
      ok: true,
      note: 'No date of birth on file, so the age check could not be made. Ask for one before the next allocation.',
    }
  }
  if (!adult) {
    return {
      ok: false,
      reason: `That customer is ${ageOn(dob, on)}. A mobile number cannot be issued to somebody under ${ADULT} in their own name — it goes to a parent or guardian, on their account.`,
    }
  }
  return { ok: true }
}

/** "17 April 1991 · 35" — the date and what it means, together, because a date
    on its own makes the reader do arithmetic. */
export function dobLine(dob: string | null, on: Date = new Date()): string {
  if (!dob) return 'Not given'
  const d = new Date(dob)
  if (Number.isNaN(d.getTime())) return dob
  return `${d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}`
    + ` · ${ageOn(dob, on)}`
}

/** Where the date came from, because a date typed into a form and one checked
    against an ID document are different claims and only one of them should be
    gating a legal requirement. */
export function sourceLine(source: DobSource | null): string {
  if (!source) return 'Not given'
  return SOURCE_LABEL[source]
}

/** A birthday today is worth knowing about where a programme rewards it, and
    the leap-year case is the one that quietly never fires. */
export function birthdayOn(dob: string | null, on: Date = new Date()): boolean {
  if (!dob) return false
  const d = new Date(dob)
  if (Number.isNaN(d.getTime())) return false
  if (d.getMonth() === 1 && d.getDate() === 29) {
    /* 29 February exists once every four years. Somebody born on it has a
       birthday every year, and a check that only matches the date drops them
       three years in four. */
    const leap = new Date(on.getFullYear(), 1, 29).getMonth() === 1
    return leap
      ? on.getMonth() === 1 && on.getDate() === 29
      : on.getMonth() === 1 && on.getDate() === 28
  }
  return on.getMonth() === d.getMonth() && on.getDate() === d.getDate()
}
