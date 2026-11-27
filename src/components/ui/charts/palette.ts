/* The chart palette (spec 18).
 *
 * Six categorical slots, defined as tokens in global.css (`--chart-1..6`:
 * indigo, teal, slate-blue, amber, rose, slate) and checked there at 3:1 or
 * better against white and the canvas, the WCAG 1.4.11 floor for a non-text
 * mark. Marks use the variables, never hex, so a token change repaints every
 * chart and the design guardrail has nothing to count.
 *
 * Colour never carries identity alone: every chart here also has direct
 * labels, a value column or a legend with values, and a data table for screen
 * readers.
 */
export const CHART_SLOTS = 6

export const SERIES = [
  'var(--chart-1)',
  'var(--chart-2)',
  'var(--chart-3)',
  'var(--chart-4)',
  'var(--chart-5)',
  'var(--chart-6)',
] as const

/** One colour per position, assigned in fixed order. Prefer `categoryColour`
    when the thing has a key, so filtering the set never repaints the survivors. */
export function seriesColour(index: number): string {
  return SERIES[((index % CHART_SLOTS) + CHART_SLOTS) % CHART_SLOTS]
}

/* The marketplaces (categories), in their own sort order, own one slot each:
   the same marketplace is the same colour on every chart in the app. */
const KNOWN: Record<string, number> = {
  consumer: 0,
  partner: 1,
  iot: 2,
  security: 3,
  device: 4,
  content: 5,
}

/**
 * A stable colour for a category key: a known marketplace takes its own slot;
 * any other key is hashed onto the six, so it is at least the same every time
 * it appears (two unknown keys can share a slot, which is why identity is
 * never colour alone).
 */
export function categoryColour(key: string): string {
  const k = key.trim().toLowerCase()
  if (k in KNOWN) return SERIES[KNOWN[k]]
  let h = 0
  for (let i = 0; i < k.length; i++) h = (h * 31 + k.charCodeAt(i)) | 0
  return seriesColour(Math.abs(h))
}
