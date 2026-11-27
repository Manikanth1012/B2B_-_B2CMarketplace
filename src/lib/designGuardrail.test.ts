/**
 * Design guardrail: one-off styles in components may only go down.
 *
 * Counts, per file and in total, three kinds of literal in src/components (every .tsx)
 * (tests and DesignSystemPage.tsx excluded) and compares them with
 * designGuardrail.baseline.json. A count above the baseline fails the test.
 *
 *   fontSize  `fontSize: '13px'`, `fontSize: "13px"`, `fontSize: 13` (a number
 *             literal; `fontSize: 'var(--fs-meta)'`, expressions and variables
 *             are not counted).
 *   hex       `#rgb`, `#rrggbb`, `#rrggbbaa` inside a string literal, after
 *             comments are removed. Not counted: SVG path data (`d="..."`),
 *             fragment anchors and ids (`href="#abc"`, `id="#abc"`,
 *             `htmlFor`, `url(#id)`), because those are not colours.
 *   radius    `borderRadius: <value>` where the value is not `0`, `'50%'` or
 *             a `var(--radius...)` token (including a template starting with one).
 *
 * To lower the baseline after removing literals: run this test, read the
 * "now N" figures in the output (or `UPDATE_GUARDRAIL=1 npx vitest run
 * src/lib/designGuardrail.test.ts`, which rewrites the JSON with current
 * counts, and only when none has risen), and commit the JSON.
 */
import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

export type Category = 'fontSize' | 'hex' | 'radius'
export type Counts = Record<Category, number>
const CATEGORIES: Category[] = ['fontSize', 'hex', 'radius']

/** Remove block comments and whole-line or trailing `//` comments (not `://`). */
export function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:\w'"`])\/\/.*$/gm, '$1')
}

const FONT_SIZE = /\bfontSize\s*:\s*(?:'\d+(?:\.\d+)?px'|"\d+(?:\.\d+)?px"|\d+(?:\.\d+)?(?![\w.%]|\s*[-+*/?(]))/g
const HEX = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3})(?![0-9a-zA-Z_-])/g
/* Not colours: SVG path data, anchors, ids, url(#id) references. */
const NOT_COLOUR = /\b(?:d|href|id|htmlFor|xlinkHref|aria-labelledby|aria-controls)\s*=\s*(?:"[^"]*"|'[^']*'|\{[^}]*\})|url\(#[^)]*\)/g
const RADIUS = /\bborderRadius\s*:\s*([^,}\n]*)/g
const RADIUS_OK = /^(?:0|'0'|"0"|'0px'|"0px"|'50%'|"50%"|['"`]var\(--radius)/

function insideString(prefix: string): boolean {
  /* An odd number of unescaped quotes of one kind before the match. */
  const open: Record<string, number> = { "'": 0, '"': 0, '`': 0 }
  for (let i = 0; i < prefix.length; i++) {
    const ch = prefix[i]
    if (ch === String.fromCharCode(92)) { i++; continue }
    if (ch in open) open[ch]++
  }
  return Object.values(open).some(n => n % 2 === 1)
}

export function countFile(source: string): Counts {
  const src = stripComments(source)
  const fontSize = (src.match(FONT_SIZE) ?? []).length

  const hexSrc = src.replace(NOT_COLOUR, m => ' '.repeat(m.length))
  let hex = 0
  for (const line of hexSrc.split('\n')) {
    for (const m of line.matchAll(HEX)) {
      if (insideString(line.slice(0, m.index))) hex++
    }
  }

  let radius = 0
  for (const m of src.matchAll(RADIUS)) {
    if (!RADIUS_OK.test(m[1].trim())) radius++
  }
  return { fontSize, hex, radius }
}

type Baseline = { total: Counts; files: Record<string, Partial<Counts>> }
type Scan = { total: Counts; files: Record<string, Counts> }

/**
 * What update mode may write: per category and per file, min(now, baseline).
 * A file absent from the baseline counts as 0, so a new file with literals is
 * a rise, not an addition. `risen` lists every rise; when it is not empty,
 * nothing may be written.
 */
export function lowerBaseline(base: Baseline, now: Scan): { next: Scan; risen: string[] } {
  const risen: string[] = []
  const next: Scan = { total: { fontSize: 0, hex: 0, radius: 0 }, files: {} }
  for (const k of CATEGORIES) {
    if (now.total[k] > base.total[k]) risen.push(`total ${k}`)
    next.total[k] = Math.min(now.total[k], base.total[k])
  }
  for (const [file, c] of Object.entries(now.files)) {
    const out: Counts = { fontSize: 0, hex: 0, radius: 0 }
    for (const k of CATEGORIES) {
      const allowed = base.files[file]?.[k] ?? 0
      if (c[k] > allowed) risen.push(`${file} ${k}`)
      out[k] = Math.min(c[k], allowed)
    }
    if (out.fontSize + out.hex + out.radius > 0) next.files[file] = out
  }
  return { next, risen }
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (name.endsWith('.tsx') && !name.endsWith('.test.tsx') && name !== 'DesignSystemPage.tsx') out.push(p)
  }
  return out
}

const root = resolve(__dirname, '..')
const baselinePath = join(__dirname, 'designGuardrail.baseline.json')

function scan(): Scan {
  const total: Counts = { fontSize: 0, hex: 0, radius: 0 }
  const files: Record<string, Counts> = {}
  for (const f of walk(join(root, 'components')).sort()) {
    const c = countFile(readFileSync(f, 'utf8'))
    if (c.fontSize + c.hex + c.radius === 0) continue
    files[relative(root, f).replace(/\\/g, '/')] = c
    for (const k of CATEGORIES) total[k] += c[k]
  }
  return { total, files }
}

describe('counters', () => {
  it('counts font sizes', () => {
    const c = countFile(`<a style={{ fontSize: '13px' }} /><b style={{ fontSize: "12px" }} /><i style={{ fontSize: 11 }} /><u style={{ fontSize: 'var(--fs-meta)' }} /><s style={{ fontSize: size }} /><t style={{ fontSize: 14 * 2 }} />`)
    expect(c.fontSize).toBe(3)
  })
  it('counts hex colours in strings but not SVG data, ids or comments', () => {
    const c = countFile([
      `const a = { color: '#fff', background: "#0B1220", border: '1px solid #e2e8f0cc' }`,
      `<path d="M0 0 L#123 4" /><a href="#abc" /><use xlinkHref="#def456" />`,
      `// color: '#ff0000'`,
      `/* '#00ff00' */`,
      `const grad = \`linear-gradient(#111, #222222)\``,
      `const n = 5 // not #aaa`,
    ].join('\n'))
    expect(c.hex).toBe(5)
  })
  it('counts border radii that are not tokens', () => {
    const c = countFile(`a={{ borderRadius: 8 }} b={{ borderRadius: '50%' }} c={{ borderRadius: 0 }} d={{ borderRadius: 'var(--radius-md)' }} e={{ borderRadius: '0 0 8px 8px' }} f={{ borderRadius: r }}`)
    expect(c.radius).toBe(3)
  })
})

describe('update mode', () => {
  const base: Baseline = { total: { fontSize: 3, hex: 0, radius: 0 }, files: { 'components/A.tsx': { fontSize: 2 }, 'components/B.tsx': { fontSize: 1 } } }
  const c = (fontSize: number): Counts => ({ fontSize, hex: 0, radius: 0 })
  it('only lowers: a drop is written', () => {
    const r = lowerBaseline(base, { total: c(2), files: { 'components/A.tsx': c(1), 'components/B.tsx': c(1) } })
    expect(r.risen).toEqual([])
    expect(r.next.total.fontSize).toBe(2)
    expect(r.next.files['components/A.tsx'].fontSize).toBe(1)
  })
  it('a rise in one file offset by a drop in another is refused', () => {
    const r = lowerBaseline(base, { total: c(3), files: { 'components/A.tsx': c(3), 'components/B.tsx': c(0) } })
    expect(r.risen).toEqual(['components/A.tsx fontSize'])
  })
  it('a new file with literals is a rise, not an addition', () => {
    const r = lowerBaseline(base, { total: c(3), files: { 'components/A.tsx': c(1), 'components/B.tsx': c(1), 'components/New.tsx': c(1) } })
    expect(r.risen).toContain('components/New.tsx fontSize')
    expect(r.next.files['components/New.tsx']).toBeUndefined()
  })
})

describe('design guardrail', () => {
  it('no component gains a one-off font size, hex colour or border radius', () => {
    const now = scan()
    const base: Baseline = JSON.parse(readFileSync(baselinePath, 'utf8'))

    if (process.env.UPDATE_GUARDRAIL === '1') {
      const { next, risen } = lowerBaseline(base, now)
      if (risen.length === 0) writeFileSync(baselinePath, JSON.stringify(next, null, 2) + '\n')
    }

    const problems: string[] = []
    for (const k of CATEGORIES) {
      if (now.total[k] > base.total[k]) problems.push(`total ${k}: baseline ${base.total[k]}, now ${now.total[k]}`)
    }
    for (const [file, c] of Object.entries(now.files)) {
      for (const k of CATEGORIES) {
        const allowed = base.files[file]?.[k] ?? 0
        if (c[k] > allowed) problems.push(`${file} ${k}: baseline ${allowed}, now ${c[k]}`)
      }
    }
    expect(problems, [
      'New one-off styles were added. Use a token (var(--fs-*), var(--radius*), a colour variable) or a shared component, see /design-system.',
      'If you removed literals instead, lower the baseline: edit src/lib/designGuardrail.baseline.json, or run',
      'UPDATE_GUARDRAIL=1 npx vitest run src/lib/designGuardrail.test.ts. Never raise it.',
    ].join('\n')).toEqual([])
  })
})
