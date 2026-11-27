import type React from 'react'
import { ChartFrame, money0 } from './common'
import { ColumnChart, type Column } from './ColumnChart'
import { SERIES, categoryColour } from './palette'

export type Bar = Column

/**
 * Bars. Horizontal (the default) is the ranking form: one row per item,
 * largest first, the name on the left, the bar, then the value and (with
 * `share`) its share of the total, all printed, so the chart reads without
 * hovering and without colour. It is what a "mix" should be when the point is
 * which is biggest: lengths on one baseline compare better than slices.
 * `orientation="vertical"` is a ColumnChart.
 */
export function BarChart({ orientation = 'horizontal', data, label, caption, format = money0, share = false, sort = true, colour, max: rows, ...rest }: {
  orientation?: 'horizontal' | 'vertical'
  data: readonly Bar[]
  label: string
  caption?: React.ReactNode
  format?: (n: number) => string
  /** Print each bar's share of the total beside its value. */
  share?: boolean
  /** Largest first (default). Off keeps the order given. */
  sort?: boolean
  colour?: string
  /** Show at most this many rows (the rest still count toward the total). */
  max?: number
  height?: number
  tickFormat?: (n: number) => string
  yLabel?: string
  xLabel?: string
}) {
  if (orientation === 'vertical') {
    return <ColumnChart data={data} label={label} caption={caption} format={format} colour={colour} {...rest} />
  }
  if (data.length === 0) return null
  const ordered = sort ? [...data].sort((a, b) => b.value - a.value) : [...data]
  const list = rows ? ordered.slice(0, rows) : ordered
  const total = data.reduce((s, d) => s + Math.max(d.value, 0), 0)
  const top = Math.max(...list.map(d => d.value), 1)
  const shareOf = (v: number) => (total > 0 ? `${Math.round((Math.max(v, 0) / total) * 100)}%` : '0%')
  const fill = (d: Bar) => d.colour ?? (d.key ? categoryColour(d.key) : colour ?? SERIES[0])

  return (
    <ChartFrame label={label} caption={caption}
      table={{
        columns: share ? ['Item', 'Value', 'Share'] : ['Item', 'Value'],
        rows: list.map(d => (share ? [d.label, format(d.value), shareOf(d.value)] : [d.label, format(d.value)])),
      }}>
      <ol className={share ? 'ui-bars ui-bars--share' : 'ui-bars'} aria-hidden="true">
        {list.map((d, i) => (
          <li key={`${d.label}-${i}`} className="ui-bars__row" title={d.note ? `${d.label}: ${format(d.value)} · ${d.note}` : undefined}>
            <span className="ui-bars__label">{d.label}</span>
            <span className="ui-bars__track">
              <span className={d.muted ? 'ui-bars__bar ui-chart__bar--muted' : 'ui-bars__bar'}
                style={{ width: `${Math.max((Math.max(d.value, 0) / top) * 100, d.value > 0 ? 1 : 0)}%`, background: fill(d) }} />
            </span>
            <span className="ui-bars__value">{format(d.value)}</span>
            {share && <span className="ui-bars__share">{shareOf(d.value)}</span>}
          </li>
        ))}
      </ol>
    </ChartFrame>
  )
}
