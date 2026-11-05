import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
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
  ['border-strong', 'bg-card', 3],      // form-control boundary (WCAG 1.4.11)
  ['border-strong', 'bg-alt', 3],
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

/* Small text and labels never take the light teal. --brand-accent is 2.15:1 on
   white, so any `color:` on a line that names it is a regression. The exact
   token is matched, so --brand-accent-dark and -light are not caught. Fills,
   borders and icons may still use it. */
function tsxFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) return tsxFiles(p)
    return name.endsWith('.tsx') ? [p] : []
  })
}

describe('small text never takes the light teal', () => {
  it('no color: line in src/**/*.tsx names var(--brand-accent)', () => {
    const offenders: string[] = []
    const pattern = /(?:(?:^|[^A-Za-z])color\s*:|\.style\.color\s*=)[^\n]*var\(--brand-accent\)/
    for (const file of tsxFiles(fileURLToPath(new URL('../', import.meta.url)))) {
      readFileSync(file, 'utf8').split(/\r?\n/).forEach((line, i) => {
        if (pattern.test(line)) offenders.push(`${relative(process.cwd(), file)}:${i + 1}`)
      })
    }
    expect(offenders).toEqual([])
  })
})

/* The check above only sees a literal `color: var(--brand-accent)`. The light
   teal also reaches text through constants and props (`accentColor`, a
   `catColors` map) and white is sometimes laid over it as a glyph or label.
   These two scans read src/lib and src/components for both. */
function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) return sourceFiles(p)
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [p] : []
  })
}
const SRC = fileURLToPath(new URL('../', import.meta.url))
const scanned = ['lib', 'components'].flatMap((d) => sourceFiles(join(SRC, d)))

const LIGHT_TEAL = String.raw`(?:var\(--(?:brand-accent|teal)\)|#00C6B5)`
const lineOf = (text: string, index: number) => text.slice(0, index).split(/\r?\n/).length

describe('the light teal never reaches text or sits under white', () => {
  it('no colour constant or prop that resolves to the light teal is a text colour', () => {
    /* A key that names a text colour (`color`, `accentColor`, `accentFg`,
       `catColors` entries) whose value is the light teal. Border, background,
       fill and stroke keys are fills, which the teal may still take. */
    const keyed = new RegExp(
      String.raw`(?<![\w-])(?!(?:border|background|outline|fill|stroke|shadow|caret)\w*)([A-Za-z]*(?:[cC]olou?rs?|Fg|Text))['"]?\s*:\s*[^,\n}]*` + LIGHT_TEAL, 'i')
    const offenders: string[] = []
    for (const file of scanned) {
      readFileSync(file, 'utf8').split(/\r?\n/).forEach((line, i) => {
        if (/^\s*(\/\/|\*|\/\*)/.test(line)) return
        if (keyed.test(line)) offenders.push(`${relative(process.cwd(), file)}:${i + 1}`)
      })
    }
    expect(offenders).toEqual([])
  })

  it('no style object sets white text or a white glyph on a light-teal background', () => {
    const background = new RegExp(String.raw`background(?:Color)?['"]?\s*:\s*[^,}]*` + LIGHT_TEAL, 'i')
    const white = /(?<![\w-])(?:color|fill|stroke)['"]?\s*:\s*[^,}]*(?:'white'|"white"|#fff(?:fff)?\b|var\(--text-inverse\))/i
    const offenders: string[] = []
    for (const file of scanned) {
      const text = readFileSync(file, 'utf8')
      /* Innermost { … } blocks: one style object, however many lines it spans. */
      for (const m of text.matchAll(/\{[^{}]*\}/g)) {
        if (background.test(m[0]) && white.test(m[0])) {
          offenders.push(`${relative(process.cwd(), file)}:${lineOf(text, m.index!)}`)
        }
      }
    }
    expect(offenders).toEqual([])
  })
})
