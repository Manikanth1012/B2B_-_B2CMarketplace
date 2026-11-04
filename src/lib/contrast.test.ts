import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { contrast, readTokens } from './contrast'

describe('contrast()', () => {
  it('matches the WCAG reference values', () => {
    expect(contrast('#000000', '#FFFFFF')).toBeCloseTo(21, 1)
    expect(contrast('#FFFFFF', '#FFFFFF')).toBeCloseTo(1, 5)
    expect(contrast('#007575', '#FFFFFF')).toBeCloseTo(5.52, 1)
  })
  it('is symmetric', () => {
    expect(contrast('#102344', '#F4F7FC')).toBeCloseTo(contrast('#F4F7FC', '#102344'), 5)
  })
})

describe('readTokens()', () => {
  it('reads six-digit hex custom properties and ignores everything else', () => {
    const t = readTokens(':root { --a: #112233; --b: 4px; --c:#AbCdEf; }')
    expect(t).toEqual({ a: '#112233', c: '#ABCDEF' })
  })
})

/* Every text-on-surface pairing the design system actually uses. Adding a new
   pairing to the UI means adding it here; changing a token so a pairing drops
   under AA fails this test before it reaches a screen. */
const css = readFileSync(new URL('../styles/global.css', import.meta.url), 'utf8')
const tokens = readTokens(css)

const PAIRS: [fg: string, bg: string, min: number][] = [
  ['text', 'bg-card', 4.5],
  ['text', 'bg-alt', 4.5],
  ['text-secondary', 'bg-card', 4.5],
  ['text-secondary', 'bg-alt', 4.5],
  ['text-tertiary', 'bg-card', 4.5],
  ['text-tertiary', 'bg-alt', 4.5],
  ['brand-accent-dark', 'bg-card', 4.5],
  ['brand-accent-dark', 'bg-alt', 4.5],
  ['blue', 'bg-card', 4.5],
  ['blue', 'bg-alt', 4.5],
  ['brand-navy', 'cyan', 4.5],          // primary button label
  ['cyan', 'brand-navy', 4.5],          // links and eyebrows on dark cards
  ['text-inverse', 'brand-navy', 4.5],
  ['text-inverse', 'brand-navy-dark', 4.5],
  ['success', 'bg-card', 4.5],
  ['warning', 'bg-card', 4.5],
  ['danger', 'bg-card', 4.5],
  ['info', 'bg-card', 4.5],
  ['success', 'success-bg', 4.5],
  ['warning', 'warning-bg', 4.5],
  ['danger', 'danger-bg', 4.5],
  ['info', 'info-bg', 4.5],
  ['electric', 'bg-card', 3],           // focus ring: a UI glyph, not text
]

describe('design tokens', () => {
  it.each(PAIRS)('--%s on --%s clears %s:1', (fg, bg, min) => {
    expect(tokens[fg], `--${fg} is not defined`).toBeDefined()
    expect(tokens[bg], `--${bg} is not defined`).toBeDefined()
    expect(contrast(tokens[fg], tokens[bg])).toBeGreaterThanOrEqual(min)
  })

  it('carries the Aventa palette', () => {
    expect(tokens['brand-navy']).toBe('#061B3A')
    expect(tokens['brand-navy-dark']).toBe('#03132B')
    expect(tokens['cyan']).toBe('#12CDE0')
    expect(tokens['bg-alt']).toBe('#F4F7FC')
  })
})
