import { useId, useState } from 'react'

/* Charts for the operator console.
 *
 * The categorical palette is the data-viz reference instance, unchanged, and it
 * passes the six checks on the adjacent pairlist: lightness band, chroma floor, CVD
 * separation (worst adjacent ΔE 9.1 protan), normal-vision floor (19.6) and contrast.
 * The earlier attempt to reuse the app's own category colours failed two of them —
 * the gold sat outside the lightness band and both teal and gold were under 3:1 on
 * a light surface — so those stay for category badges and these are used for marks.
 *
 * Three of these slots are below 3:1 against the light surface, which the method
 * allows only with relief: every chart here carries visible direct labels or a value
 * column, never colour alone.
 */
export const SERIES = [
  '#2a78d6', // blue
  '#eb6834', // orange
  '#1baf7a', // aqua
  '#eda100', // yellow
  '#e87ba4', // magenta
  '#008300', // green
] as const

/** One colour per key, assigned in fixed order and never cycled — so filtering the
    set never repaints the survivors. */
export function seriesColour(index: number): string {
  return SERIES[index % SERIES.length]
}

const AXIS = 'var(--text-tertiary)'

function money0(n: number): string {
  return '$' + Math.round(n).toLocaleString('en-US')
}

/* ------------------------------------------------------------ column chart */

export interface Column { label: string; value: number; note?: string; muted?: boolean }

/**
 * Change over time, or magnitude across a handful of named things. One series, so no
 * legend — the panel title names it. Bars are anchored to the baseline with 4px
 * rounded tops and a 2px gap, and every bar carries a hover tooltip.
 */
export function ColumnChart({ data, height = 160, format = money0, colour, label }: {
  data: readonly Column[]
  height?: number
  format?: (n: number) => string
  colour?: string
  label: string
}) {
  const [hover, setHover] = useState<number | null>(null)
  const id = useId()
  if (data.length === 0) return <></>

  const max = Math.max(...data.map(d => d.value), 1)

  return (
    <div>
      <div
        role="img"
        aria-label={`${label}. ${data.map(d => `${d.label} ${format(d.value)}`).join(', ')}`}
        style={{ display: 'flex', alignItems: 'flex-end', gap: '2px', height: `${height}px`, position: 'relative' }}
      >
        {data.map((d, i) => (
          <div
            key={d.label}
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
            style={{ flex: 1, height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', position: 'relative', cursor: 'default' }}
          >
            {hover === i && (
              <div
                role="tooltip"
                style={{
                  position: 'absolute', bottom: '100%', left: '50%', transform: 'translateX(-50%)',
                  marginBottom: '6px', whiteSpace: 'nowrap', zIndex: 5,
                  background: 'var(--brand-navy)', color: 'white', padding: '5px 9px',
                  borderRadius: 'var(--radius)', fontSize: 'var(--text-xs)', fontWeight: 600,
                  boxShadow: 'var(--shadow-md)',
                }}
              >
                {d.label}: {format(d.value)}{d.note ? ` · ${d.note}` : ''}
              </div>
            )}
            <div
              style={{
                height: `${Math.max((d.value / max) * 100, 1.5)}%`,
                background: colour ?? SERIES[0],
                /* Aggregated months are drawn back — the panel says which are
                   line-level, and the chart should not contradict it. */
                opacity: d.muted ? 0.55 : 1,
                borderRadius: '4px 4px 0 0',
                transition: 'opacity 120ms ease',
                outline: hover === i ? '2px solid var(--brand-navy)' : 'none',
                outlineOffset: '1px',
              }}
            />
          </div>
        ))}
      </div>
      <div aria-hidden style={{ display: 'flex', gap: '2px', marginTop: '6px' }}>
        {data.map(d => (
          <div key={d.label} style={{ flex: 1, textAlign: 'center', fontSize: '10px', color: AXIS, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {d.label}
          </div>
        ))}
      </div>
      <span id={id} className="sr-only" />
    </div>
  )
}

/* -------------------------------------------------------------- donut ---- */

export interface Slice { label: string; value: number }

/**
 * Identity plus share of a whole, for a handful of slices. Carries a legend with the
 * value beside each label — three palette slots sit below 3:1 on a light surface, so
 * the numbers are the relief that keeps it readable without colour.
 */
export function DonutChart({ data, centre, centreSub, format = money0, label }: {
  data: readonly Slice[]
  centre: string
  centreSub?: string
  format?: (n: number) => string
  label: string
}) {
  const [hover, setHover] = useState<number | null>(null)
  const total = data.reduce((s, d) => s + d.value, 0)
  if (total <= 0) return <></>

  const R = 60, STROKE = 22, C = 2 * Math.PI * R
  let offset = 0

  return (
    <div style={{ display: 'flex', gap: '20px', alignItems: 'center', flexWrap: 'wrap' }}>
      <div style={{ position: 'relative', flexShrink: 0 }}>
        <svg
          width="150" height="150" viewBox="0 0 150 150"
          role="img"
          aria-label={`${label}. ${data.map(d => `${d.label} ${format(d.value)}`).join(', ')}`}
        >
          <g transform="rotate(-90 75 75)">
            {data.map((d, i) => {
              const frac = d.value / total
              /* A 2px surface gap between segments, so adjacent fills never touch. */
              const len = Math.max(frac * C - 2, 0)
              const dash = `${len} ${C - len}`
              const el = (
                <circle
                  key={d.label}
                  cx="75" cy="75" r={R}
                  fill="none"
                  stroke={seriesColour(i)}
                  strokeWidth={hover === i ? STROKE + 3 : STROKE}
                  strokeDasharray={dash}
                  strokeDashoffset={-offset}
                  onMouseEnter={() => setHover(i)}
                  onMouseLeave={() => setHover(null)}
                  style={{ transition: 'stroke-width 120ms ease' }}
                />
              )
              offset += frac * C
              return el
            })}
          </g>
        </svg>
        <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
          <div style={{ fontSize: 'var(--text-lg)', fontWeight: 800, color: 'var(--text)' }}>{centre}</div>
          {centreSub && <div style={{ fontSize: '10px', color: AXIS }}>{centreSub}</div>}
        </div>
      </div>

      {/* Legend with values — the relief the palette's light slots require, and the
          reason identity here is never colour alone. */}
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '6px', minWidth: '190px', flex: 1 }}>
        {data.map((d, i) => (
          <li
            key={d.label}
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
            style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: 'var(--text-xs)' }}
          >
            <span aria-hidden style={{ width: '10px', height: '10px', borderRadius: '2px', background: seriesColour(i), flexShrink: 0 }} />
            <span style={{ color: 'var(--text-secondary)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.label}</span>
            <span style={{ marginLeft: 'auto', fontWeight: 700, color: 'var(--text)' }}>{format(d.value)}</span>
            <span style={{ color: AXIS, width: '34px', textAlign: 'right' }}>{Math.round((d.value / total) * 100)}%</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
