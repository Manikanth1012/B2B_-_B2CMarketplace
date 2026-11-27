import { useCallback, useRef, useState } from 'react'
import type React from 'react'

/* What every chart shares: number formats, tick steps, the <figure> with its
   caption, legend and screen-reader table, the tooltip and roving focus. */

export function money0(n: number): string {
  return '$' + Math.round(n).toLocaleString('en-US')
}

/** $950, $12k, $1.2M: for axis ticks, where "$196,720" would take the plot's width. */
export function compactMoney(n: number): string {
  return (n < 0 ? '-$' : '$') + compactAbs(Math.abs(n))
}

/** 950, 12k, 1.2M */
export function compactNumber(n: number): string {
  return (n < 0 ? '-' : '') + compactAbs(Math.abs(n))
}

function compactAbs(a: number): string {
  const trim = (x: number) => (Math.round(x * 10) / 10).toString()
  if (a >= 1e9) return trim(a / 1e9) + 'B'
  if (a >= 1e6) return trim(a / 1e6) + 'M'
  if (a >= 1e3) return trim(a / 1e3) + 'k'
  return trim(a)
}

/**
 * Round tick values for an axis from `lo` to `hi`: steps of 1, 2, 2.5 or 5
 * times a power of ten, about `count` of them, always including zero when the
 * range spans it. With `integers` (counts) the step is a whole number and
 * never 2.5: "2.5 orders" is not a tick anyone can read. Values are rounded to
 * the step's own decimals, so 0.1 + 0.2 is 0.3 and not 0.30000000000000004.
 */
export function niceTicks(lo: number, hi: number, count = 4, integers = false): number[] {
  const min = Math.min(0, lo)
  const max = Math.max(hi, min + 1e-9)
  const raw = (max - min) / Math.max(count, 1)
  const mag = Math.pow(10, Math.floor(Math.log10(raw || 1)))
  const r = raw / mag
  const m = r <= 1 ? 1 : r <= 2 ? 2 : r <= 2.5 && !integers ? 2.5 : r <= 5 ? 5 : 10
  let step = Number((m * mag).toPrecision(12))
  if (integers) step = Math.max(1, Math.round(step))
  const decimals = (String(step).split('.')[1] ?? '').length
  const fix = (v: number) => Number(v.toFixed(decimals))
  const first = Math.floor(min / step)
  const last = Math.ceil(max / step)
  const out: number[] = []
  for (let k = first; k <= last; k++) out.push(fix(k * step))
  return out.length > 1 ? out : [0, step]
}

/** True when every value is a whole number (a count), for niceTicks. */
export const allIntegers = (values: readonly number[]): boolean => values.every(v => Number.isInteger(v))

/** Where a value sits between the first and last tick, 0 to 100. */
export function pct(v: number, ticks: number[]): number {
  const lo = ticks[0], hi = ticks[ticks.length - 1]
  return hi === lo ? 0 : ((v - lo) / (hi - lo)) * 100
}

export interface LegendItem { label: string; colour: string }
export interface DataTable { columns: string[]; rows: (string | number)[][] }

/**
 * The frame round every chart: a <figure> named by its caption (visible when
 * `caption` is given, otherwise the `label` read only by a screen reader), a
 * legend only when more than one series shares the plot, and the same data
 * as a visually hidden table, the honest fallback for a picture.
 */
export function ChartFrame({ label, caption, legend, table, children, className }: {
  label: string
  caption?: React.ReactNode
  legend?: LegendItem[]
  table: DataTable
  children: React.ReactNode
  className?: string
}) {
  return (
    <figure className={className ? `ui-chart ${className}` : 'ui-chart'}>
      {caption
        ? <figcaption className="ui-chart__caption">{caption}<span className="sr-only">. {label}</span></figcaption>
        : <figcaption className="sr-only">{label}</figcaption>}
      {legend && legend.length > 1 && (
        <ul className="ui-chart__legend" aria-hidden="true">
          {legend.map(l => (
            <li key={l.label}><span className="ui-chart__swatch" style={{ background: l.colour }} />{l.label}</li>
          ))}
        </ul>
      )}
      {children}
      <table className="sr-only">
        <caption>{label}</caption>
        <thead><tr>{table.columns.map(c => <th key={c} scope="col">{c}</th>)}</tr></thead>
        <tbody>
          {table.rows.map((r, i) => (
            <tr key={i}>{r.map((c, j) => (j === 0 ? <th key={j} scope="row">{c}</th> : <td key={j}>{c}</td>))}</tr>
          ))}
        </tbody>
      </table>
    </figure>
  )
}

/**
 * The tooltip over a mark: placed at `x`% across the plot and `bottom`% up it,
 * kept inside the plot near the edges. Hidden from assistive technology: the
 * mark it belongs to carries the same words as its name.
 */
export function ChartTip({ x, bottom, children }: { x: number; bottom: number; children: React.ReactNode }) {
  const shift = x < 15 ? '-10%' : x > 85 ? '-90%' : '-50%'
  return (
    <div className="ui-chart__tip" aria-hidden="true"
      style={{ left: `${x}%`, bottom: `calc(${Math.min(bottom, 100)}% + 8px)`, transform: `translateX(${shift})` }}>
      {children}
    </div>
  )
}

/**
 * One tab stop for the whole set of marks; the arrow keys, Home and End move
 * between them (WAI-ARIA roving tabindex). The shown mark is the hovered one,
 * or the focused one when nothing is hovered.
 */
export function useRovingMarks(count: number) {
  const [hover, setHover] = useState<number | null>(null)
  const [focus, setFocus] = useState<number | null>(null)
  const [stop, setStop] = useState(0)
  const refs = useRef<(HTMLElement | null)[]>([])

  const go = useCallback((i: number) => {
    const n = Math.max(0, Math.min(count - 1, i))
    setStop(n)
    refs.current[n]?.focus()
  }, [count])

  const markProps = (i: number) => ({
    ref: (el: HTMLElement | null) => { refs.current[i] = el },
    tabIndex: i === Math.min(stop, count - 1) ? 0 : -1,
    onMouseEnter: () => setHover(i),
    onMouseLeave: () => setHover(h => (h === i ? null : h)),
    onFocus: () => { setFocus(i); setStop(i) },
    onBlur: () => setFocus(f => (f === i ? null : f)),
    onKeyDown: (e: React.KeyboardEvent) => {
      const k = e.key
      if (k === 'ArrowRight' || k === 'ArrowDown') { e.preventDefault(); go(i + 1) }
      else if (k === 'ArrowLeft' || k === 'ArrowUp') { e.preventDefault(); go(i - 1) }
      else if (k === 'Home') { e.preventDefault(); go(0) }
      else if (k === 'End') { e.preventDefault(); go(count - 1) }
    },
  })

  return { shown: hover ?? focus, markProps }
}

/**
 * The value axis: tick labels down the left, sized by the widest label so the
 * plot starts where the labels end.
 */
export function YAxis({ ticks, format, height }: { ticks: number[]; format: (n: number) => string; height: number }) {
  const labels = ticks.map(format)
  const widest = labels.reduce((a, b) => (b.length > a.length ? b : a), '')
  return (
    <div className="ui-chart__y" aria-hidden="true" style={{ height }}>
      <span className="ui-chart__y-sizer">{widest}</span>
      {ticks.map((t, i) => (
        <span key={t} className="ui-chart__y-tick" style={{ bottom: `${pct(t, ticks)}%` }}>{labels[i]}</span>
      ))}
    </div>
  )
}

/** Light horizontal gridlines at the ticks; the zero line a shade darker. */
export function Gridlines({ ticks }: { ticks: number[] }) {
  return (
    <>
      {ticks.map(t => (
        <span key={t} aria-hidden="true" className={t === 0 ? 'ui-chart__grid ui-chart__grid--zero' : 'ui-chart__grid'}
          style={{ bottom: `${pct(t, ticks)}%` }} />
      ))}
    </>
  )
}

/** Category labels under the plot, one per band, centred on it. */
export function XAxis({ labels, title }: { labels: string[]; title?: string }) {
  return (
    <div className="ui-chart__x" aria-hidden="true">
      <div className="ui-chart__x-labels">
        {labels.map((l, i) => <span key={`${l}-${i}`} className="ui-chart__x-tick" title={l}>{l}</span>)}
      </div>
      {title && <div className="ui-chart__axis-title">{title}</div>}
    </div>
  )
}
