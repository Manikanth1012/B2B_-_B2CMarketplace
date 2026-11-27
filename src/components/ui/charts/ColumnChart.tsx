import type React from 'react'
import { ChartFrame, ChartTip, Gridlines, XAxis, YAxis, allIntegers, compactMoney, money0, niceTicks, pct, useRovingMarks } from './common'
import { SERIES, categoryColour } from './palette'

/** One column. `key` pins the colour to a category; `muted` draws it back
    (an aggregated month beside line-level ones); `note` adds to the tooltip. */
export interface Column { label: string; value: number; note?: string; muted?: boolean; key?: string; colour?: string }

/**
 * Change over time, or magnitude across a handful of named things, as
 * vertical columns. One series and one unit, so no legend (the card's title
 * names it) and one value axis with formatted ticks over light gridlines.
 * Every column takes hover and keyboard focus (one tab stop, arrow keys
 * between columns) and shows its value in a tooltip.
 */
export function ColumnChart({ data, height = 160, format = money0, tickFormat, colour, label, caption, yLabel, xLabel, ticks: tickCount = 4 }: {
  data: readonly Column[]
  height?: number
  format?: (n: number) => string
  /** Axis tick text; defaults to a compact form of `format` for money ($12k). */
  tickFormat?: (n: number) => string
  colour?: string
  /** The accessible name, and the data table's caption. */
  label: string
  /** A visible caption above the plot. */
  caption?: React.ReactNode
  /** The value axis's title, printed above it (e.g. "Orders"). */
  yLabel?: string
  /** The category axis's title, printed under it. */
  xLabel?: string
  ticks?: number
}) {
  const roving = useRovingMarks(data.length)
  if (data.length === 0) return null

  const ticks = niceTicks(Math.min(0, ...data.map(d => d.value)), Math.max(...data.map(d => d.value), 1), tickCount, allIntegers(data.map(d => d.value)))
  const tick = tickFormat ?? (format === money0 ? compactMoney : format)
  const shown = roving.shown
  const fill = (d: Column) => d.colour ?? (d.key ? categoryColour(d.key) : colour ?? SERIES[0])
  const words = (d: Column) => `${d.label}: ${format(d.value)}${d.note ? ` · ${d.note}` : ''}`

  return (
    <ChartFrame label={label} caption={caption}
      table={{ columns: [xLabel ?? 'Category', yLabel ?? 'Value'], rows: data.map(d => [d.label, format(d.value)]) }}>
      {yLabel && <div className="ui-chart__axis-title ui-chart__axis-title--y">{yLabel}</div>}
      <div className="ui-chart__body">
        <YAxis ticks={ticks} format={tick} height={height} />
        <div className="ui-chart__plot" style={{ height }} role="group" aria-label={label}>
          <Gridlines ticks={ticks} />
          <div className="ui-chart__cols">
            {data.map((d, i) => {
              const top = pct(Math.max(d.value, 0), ticks)
              const bottom = pct(Math.min(d.value, 0), ticks)
              return (
                <div key={`${d.label}-${i}`} role="img" aria-label={words(d)} className="ui-chart__col" {...roving.markProps(i)}>
                  <span className={['ui-chart__bar', d.muted && 'ui-chart__bar--muted', shown === i && 'is-active'].filter(Boolean).join(' ')}
                    style={{ bottom: `${bottom}%`, height: `${Math.max(top - bottom, d.value === 0 ? 0 : 1.5)}%`, background: fill(d) }} />
                </div>
              )
            })}
          </div>
          {shown !== null && data[shown] && (
            <ChartTip x={((shown + 0.5) / data.length) * 100} bottom={pct(Math.max(data[shown].value, 0), ticks)}>
              {words(data[shown])}
            </ChartTip>
          )}
        </div>
        <span />
        <XAxis labels={data.map(d => d.label)} title={xLabel} />
      </div>
    </ChartFrame>
  )
}
