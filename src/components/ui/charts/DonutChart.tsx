import { useState } from 'react'
import type React from 'react'
import { ChartFrame, money0 } from './common'
import { categoryColour, seriesColour } from './palette'

/* `colour` (or `key`, through categoryColour) pins a slice to its entity.
   Without either the donut colours by position, so filtering out an empty
   slice would repaint every survivor. */
export interface Slice { label: string; value: number; colour?: string; key?: string }

/**
 * Share of a whole, for a handful of slices (six at most: the palette's
 * length). The legend prints each value and share, so identity never rests
 * on colour. When the point is ranking rather than share, use a horizontal
 * BarChart with `share` instead.
 */
export function DonutChart({ data, centre, centreSub, format = money0, label, caption }: {
  data: readonly Slice[]
  centre: string
  centreSub?: string
  format?: (n: number) => string
  label: string
  caption?: React.ReactNode
}) {
  const [hover, setHover] = useState<number | null>(null)
  const total = data.reduce((s, d) => s + Math.max(d.value, 0), 0)
  if (total <= 0) return null

  const R = 60, STROKE = 22, C = 2 * Math.PI * R
  const colourOf = (d: Slice, i: number) => d.colour ?? (d.key ? categoryColour(d.key) : seriesColour(i))
  const share = (v: number) => `${Math.round((Math.max(v, 0) / total) * 100)}%`
  let offset = 0

  return (
    <ChartFrame label={label} caption={caption} className="ui-donut"
      table={{ columns: ['Item', 'Value', 'Share'], rows: data.map(d => [d.label, format(d.value), share(d.value)]) }}>
      <div className="ui-donut__ring" aria-hidden="true">
        <svg width="150" height="150" viewBox="0 0 150 150" focusable="false">
          <g transform="rotate(-90 75 75)">
            {data.map((d, i) => {
              const frac = Math.max(d.value, 0) / total
              /* A 2px surface gap between segments, so adjacent fills never touch. */
              const len = Math.max(frac * C - 2, 0)
              const el = (
                <circle key={d.label} cx="75" cy="75" r={R} fill="none"
                  className={hover === i ? 'ui-donut__slice is-active' : 'ui-donut__slice'}
                  style={{ stroke: colourOf(d, i), strokeWidth: hover === i ? STROKE + 3 : STROKE }}
                  strokeDasharray={`${len} ${C - len}`} strokeDashoffset={-offset}
                  onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} />
              )
              offset += frac * C
              return el
            })}
          </g>
        </svg>
        <div className="ui-donut__centre">
          <div className="ui-donut__centre-value">{centre}</div>
          {centreSub && <div className="ui-donut__centre-sub">{centreSub}</div>}
        </div>
      </div>
      <ul className="ui-donut__legend" aria-hidden="true">
        {data.map((d, i) => (
          <li key={d.label} className={hover === i ? 'is-active' : undefined}
            onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
            <span className="ui-chart__swatch" style={{ background: colourOf(d, i) }} />
            <span className="ui-donut__label">{d.label}</span>
            <span className="ui-donut__value">{format(d.value)}</span>
            <span className="ui-donut__share">{share(d.value)}</span>
          </li>
        ))}
      </ul>
    </ChartFrame>
  )
}
