import { describe, it, expect } from 'vitest'
import {
  LANGUAGES, TIME_ZONES,
  isLanguage, isTimeZone, languageLabel,
  effectivePreferences, isAuditable,
  DEFAULT_LANGUAGE, DEFAULT_TIME_ZONE, 
} from './preferences'

describe('the option lists', () => {
  /* A select with one option is not a preference. The prototype offered English
     only; the marketplace claims India, UAE and Kenya on its own landing page. */
  it('offers a language per region the marketplace serves', () => {
    expect(LANGUAGES.length).toBeGreaterThan(1)
    expect(LANGUAGES.map(l => l.value)).toEqual(['English', 'हिन्दी', 'العربية', 'Kiswahili'])
  })

  it('labels each language in a way its speaker would recognise', () => {
    expect(languageLabel('हिन्दी')).toBe('हिन्दी (Hindi)')
    expect(languageLabel('العربية')).toBe('العربية (Arabic)')
  })

  /* Kenya is one of the three stated regions, and the prototype's list had no
     Kenyan zone. */
  it('has a time zone for every stated region', () => {
    expect(TIME_ZONES).toContain('Asia/Kolkata (IST)')
    expect(TIME_ZONES).toContain('Asia/Dubai (GST)')
    expect(TIME_ZONES).toContain('Africa/Nairobi (EAT)')
  })

})

describe('validation', () => {
  it('accepts what the pickers offer and nothing else', () => {
    expect(isLanguage('English')).toBe(true)
    expect(isLanguage('Klingon')).toBe(false)
    expect(isTimeZone('Africa/Nairobi (EAT)')).toBe(true)
    expect(isTimeZone('Mars/Olympus')).toBe(false)
  })

  it('renders an unrecognised stored value rather than a blank select', () => {
    expect(languageLabel('Sindarin')).toBe('Sindarin')
  })
})

describe('effectivePreferences', () => {
  it('reads what the profile stores', () => {
    expect(effectivePreferences({
      preferred_language: 'Kiswahili', time_zone: 'Africa/Nairobi (EAT)',
    })).toEqual({ language: 'Kiswahili', timeZone: 'Africa/Nairobi (EAT)' })
  })

  /* Every screen needs an effective answer. Without one, each invents its own
     fallback and they disagree. */
  it('falls back to the defaults for missing values', () => {
    expect(effectivePreferences({})).toEqual({
      language: DEFAULT_LANGUAGE, timeZone: DEFAULT_TIME_ZONE,
    })
  })

  it('falls back rather than passing through something unrenderable', () => {
    const p = effectivePreferences({ preferred_language: 'Klingon', time_zone: null })
    expect(p.language).toBe(DEFAULT_LANGUAGE)
  })
})

describe('isAuditable', () => {
  /* Language and time zone change what the customer is sent and when — an agent
     handling "why did I get this in English" needs the date it changed. */
  it('logs the preferences that change what gets sent', () => {
    expect(isAuditable('language')).toBe(true)
    expect(isAuditable('timeZone')).toBe(true)
  })

  it('does not log the cosmetic one', () => {
  })
})
