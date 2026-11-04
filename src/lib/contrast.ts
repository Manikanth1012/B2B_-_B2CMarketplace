/* WCAG 2.x contrast, and a reader for the hex tokens in a stylesheet. No DOM:
   the token test reads global.css as text so it runs in the Node suite. */

function channel(v: number): number {
  const s = v / 255
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
}

function luminance(hex: string): number {
  const h = hex.replace('#', '')
  const r = parseInt(h.slice(0, 2), 16)
  const g = parseInt(h.slice(2, 4), 16)
  const b = parseInt(h.slice(4, 6), 16)
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

/** Contrast ratio between two `#RRGGBB` colours, 1 to 21. */
export function contrast(fg: string, bg: string): number {
  const a = luminance(fg)
  const b = luminance(bg)
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}

/** Every `--name: #RRGGBB` declaration in the text, first definition wins. */
export function readTokens(css: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const m of css.matchAll(/--([\w-]+)\s*:\s*(#[0-9a-fA-F]{6})\b/g)) {
    if (!(m[1] in out)) out[m[1]] = m[2].toUpperCase()
  }
  return out
}
