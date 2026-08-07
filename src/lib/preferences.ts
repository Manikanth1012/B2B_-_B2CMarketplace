/* Consumer preferences, pure. The option lists live here rather than inline in the
   markup so the database check constraint and the picker cannot drift apart. */

/* The marketplace states three regions on its own landing page — India, UAE and
   Kenya — so these are those regions' languages, written the way a speaker would
   recognise them rather than transliterated. The prototype offered English only; a
   select with one option is not a preference. */
export const LANGUAGES = [
  { value: 'English', label: 'English' },
  { value: 'हिन्दी', label: 'हिन्दी (Hindi)' },
  { value: 'العربية', label: 'العربية (Arabic)' },
  { value: 'Kiswahili', label: 'Kiswahili (Swahili)' },
] as const

/* The prototype's three, plus Nairobi — Kenya is one of the three regions the
   marketplace claims to serve, and a Kenyan customer with no Kenyan time zone is a
   gap rather than a decision. */
export const TIME_ZONES = [
  'Asia/Kolkata (IST)',
  'Asia/Dubai (GST)',
  'Africa/Nairobi (EAT)',
  'Europe/London (GMT)',
] as const

/* Data units were a preference between showing a figure in GB or MB. Withdrawn
   — the right unit is decided by the size of the figure, not by a setting:
   nobody wants 0.0004 GB and nobody wants 4,096,000 MB. A preference that
   cannot improve any screen is one more thing on a page and one more column to
   keep in step. */

export type Language = typeof LANGUAGES[number]['value']

export const DEFAULT_LANGUAGE: Language = 'English'
export const DEFAULT_TIME_ZONE = TIME_ZONES[0]

export function isLanguage(v: string): v is Language {
  return LANGUAGES.some(l => l.value === v)
}

export function isTimeZone(v: string): boolean {
  return (TIME_ZONES as readonly string[]).includes(v)
}

/** The label to show for a stored value. A profile written before an option was
    retired should still render as something rather than as a blank select. */
export function languageLabel(value: string): string {
  return LANGUAGES.find(l => l.value === value)?.label ?? value
}

/**
 * Read preferences off a profile row, substituting the default for anything missing
 * or unrecognised. Every screen needs an effective answer, and the alternative is
 * each one inventing its own fallback.
 */
export function effectivePreferences(profile: {
  preferred_language?: string | null
  time_zone?: string | null
}): { language: Language; timeZone: string } {
  const language = profile.preferred_language
  const timeZone = profile.time_zone

  return {
    language: language && isLanguage(language) ? language : DEFAULT_LANGUAGE,
    timeZone: timeZone && isTimeZone(timeZone) ? timeZone : DEFAULT_TIME_ZONE,
  }
}

/** Whether changing this preference is worth writing to the audit log. Both of
    the remaining two are: each changes what the customer is sent or when, and a
    support agent needs to know when it changed. */
export function isAuditable(field: 'language' | 'timeZone'): boolean {
  return field === 'language' || field === 'timeZone'
}
