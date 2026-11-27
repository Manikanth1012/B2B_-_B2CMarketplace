import type React from 'react'
import { ChartFrame, ChartTip, Gridlines, XAxis, YAxis, compactMoney, money0, niceTicks, pct, useRovingMarks } from './common'
import { seriesColour } from './palette'

/** One line. `null` is a gap (no reading), not a zero. */
export interface LineSeries { key: string; label: string; values: readonly (number | null)[]; colour?: string }

/**
 * A trend: one or more series over the same categories (months, nights), in
 * one unit. Never two units on one axis: two measures with different units
 * are two charts. A legend appears only with more than one series. Each
 * category is a focusable band (one tab stop, arrow keys between bands);
 * hovering or focusing it marks the points and shows every series' value.
 */
export function LineChart({ labels, series, height = 180, format = money0, tickFormat, label, caption, yLabel, xLabel, area = false, ticks: tickCount = 4 }: {
  labels: readonly string[]
  series: readonly LineSeries[]
  height?: number
  format?: (n: number) => string
  tickFormat?: (n: number) => string
  label: string
  caption?: React.ReactNode
  yLabel?: string
  xLabel?: string
  /** Fill under each line (an area chart). */
  area?: boolean
  ticks?: number
}) {
  const n = labels.length
  const roving = useRovingMarks(n)
  if (n === 0 || series.length === 0) return null

  const all = series.flatMap(s => s.values.filter((v): v is number => v !== null))
  const ticks = niceTicks(Math.min(0, ...all), Math.max(1, ...all), tickCount)
  const tick = tickFormat ?? (format === money0 ? compactMoney : format)
  const colourOf = (s: LineSeries, i: number) => s.colour ?? seriesColour(i)
  const x = (i: number) => ((i + 0.5) / n) * 100
  const y = (v: number) => 100 - pct(v, ticks)
  const base = y(Math.max(ticks[0], Math.min(0, ticks[ticks.length - 1])))
  const shown = roving.shown

  /* Runs of consecutive readings; a null breaks the line. */
  const runs = (vals: readonly (number | null)[]) => {
    const out: [number, number][][] = []
    let cur: [number, number][] = []
    vals.forEach((v, i) => {
      if (v === null) { if (cur.length) out.push(cur); cur = [] } else cur.push([x(i), y(v)])
    })
    if (cur.length) out.push(cur)
    return out
  }
  const bandWords = (i: number) => `${labels[i]}: ${series.map(s => `${series.length > 1 ? `${s.label} ` : ''}${s.values[i] === null || s.values[i] === undefined ? 'no reading' : format(s.values[i] as number)}`).join(', ')}`
  const peak = (i: number) => Math.max(...series.map(s => s.values[i] ?? ticks[0]))

  return (
    <ChartFrame label={label} caption={caption}
      legend={series.map((s, i) => ({ label: s.label, colour: colourOf(s, i) }))}
      table={{
        columns: [xLabel ?? 'Category', ...series.map(s => s.label)],
        rows: labels.map((l, i) => [l, ...series.map(s => (s.values[i] === null || s.values[i] === undefined ? '—' : format(s.values[i] as number)))]),
      }}>
      {yLabel && <div className="ui-chart__axis-title ui-chart__axis-title--y">{yLabel}</div>}
      <div className="ui-chart__body">
        <YAxis ticks={ticks} format={tick} height={height} />
        <div className="ui-chart__plot" style={{ height }} role="group" aria-label={label}>
          <Gridlines ticks={ticks} />
          <svg className="ui-chart__svg" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true" focusable="false">
            {series.map((s, si) => runs(s.values).map((run, ri) => (
              <g key={`${s.key}-${ri}`} style={{ color: colourOf(s, si) }}>
                {area && run.length > 1 && (
                  <polygon className="ui-chart__area"
                    points={`${run[0][0]},${base} ${run.map(p => p.join(',')).join(' ')} ${run[run.length - 1][0]},${base}`} />
                )}
                <polyline className="ui-chart__line" points={run.map(p => p.join(',')).join(' ')} vectorEffect="non-scaling-stroke" />
              </g>
            )))}
          </svg>
          {shown !== null && (
            <>
              <span className="ui-chart__guide" aria-hidden="true" style={{ left: `${x(shown)}%` }} />
              {series.map((s, si) => s.values[shown] === null || s.values[shown] === undefined ? null : (
                <span key={s.key} className="ui-chart__dot" aria-hidden="true"
                  style={{ left: `${x(shown)}%`, bottom: `${pct(s.values[shown] as number, ticks)}%`, background: colourOf(s, si) }} />
              ))}
            </>
          )}
          {n === 1 && series.map((s, si) => s.values[0] === null ? null : (
            <span key={`only-${s.key}`} className="ui-chart__dot" aria-hidden="true"
              style={{ left: '50%', bottom: `${pct(s.values[0] as number, ticks)}%`, background: colourOf(s, si) }} />
          ))}
          <div className="ui-chart__bands">
            {labels.map((l, i) => (
              <div key={`${l}-${i}`} role="img" aria-label={bandWords(i)} className="ui-chart__band" {...roving.markProps(i)} />
            ))}
          </div>
          {shown !== null && (
            <ChartTip x={x(shown)} bottom={pct(peak(shown), ticks)}>{bandWords(shown)}</ChartTip>
          )}
        </div>
        <span />
        <XAxis labels={[...labels]} title={xLabel} />
      </div>
    </ChartFrame>
  )
}

/** A LineChart filled underneath: a single total over time. */
export function AreaChart(props: Omit<React.ComponentProps<typeof LineChart>, 'area'>) {
  return <LineChart {...props} area />
}
