import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const css = (f: string) => readFileSync(resolve(__dirname, '../styles', f), 'utf8')
const ui = css('ui.css'), consoleCss = css('console.css'), global = css('global.css')

describe('control states in CSS', () => {
  it('keyboard focus on buttons, checkboxes, radios and the toggle is a real outline driven by --focus-color', () => {
    expect(consoleCss).toMatch(/\.c-btn:focus-visible \{ outline: 2px solid var\(--focus-color\)/)
    expect(global).toMatch(/\.btn:focus-visible \{ outline: 2px solid var\(--focus-color\)/)
    expect(global).toMatch(/input\[type="radio"\]:focus-visible \{\s*outline: 2px solid var\(--focus-color\)/)
    expect(ui).toMatch(/\.ui-toggle__track:focus-visible \{ outline: 2px solid var\(--focus-color\)/)
  })
  it('every dark ground redefines --focus-color as --accent-on-dark', () => {
    const m = ui.match(/([^{}]+)\{ --focus-color: var\(--accent-on-dark\); \}/)
    expect(m).not.toBeNull()
    for (const c of ['.site-header', '.site-footer', '.bento-card--dark', '.bento-card--image', '.cpe-side', '.op-sidebar', '.hero-main', '.promo-tile', '.rw-toast', '.av-toast']) {
      expect(m![1]).toContain(c)
    }
  })
  it('hover never overrides disabled', () => {
    for (const sel of ['.btn-cyan', '.btn-primary', '.btn-secondary', '.btn-ghost', '.btn-outline-light']) {
      const all = (ui + global).split('\n').filter(l => l.startsWith(sel + ':hover'))
      for (const l of all) expect(l, l).toContain(':not(:disabled)')
    }
    expect(ui).toMatch(/\.btn-cyan:disabled \{/)
    expect(consoleCss).not.toMatch(/\.c-btn--\w+:hover \{/)
  })
  it('solid danger and success apply only to dialog footer actions', () => {
    expect(consoleCss).not.toMatch(/\.c-modal \.c-btn--(danger|success)/)
    expect(consoleCss).not.toMatch(/\[role="dialog"\] \.c-btn--(danger|success)/)
    expect(consoleCss).toMatch(/\.ui-dialog__foot \.c-btn--danger:active:not\(:disabled\)/)
  })
  it('product-card buttons sit on the 40/32 scale', () => {
    expect(ui).not.toMatch(/\.p-card__actions \.btn \{[^}]*min-height: 36px/)
  })
})
