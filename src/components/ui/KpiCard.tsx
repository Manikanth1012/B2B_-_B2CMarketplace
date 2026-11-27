import type { ReactNode } from 'react'
import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react'

/** Inline trend line: no axes, decorative, hidden under two points. */
function Sparkline({ series }: { series: number[] }) {
  if (series.length < 2) return null
  const w = 120, h = 32, pad = 2
  const min = Math.min(...series), max = Math.max(...series), span = max - min || 1
  const pts = series.map((v, i) => `${(i / (series.length - 1) * (w - pad * 2) + pad).toFixed(1)},${(h - pad - (v - min) / span * (h - pad * 2)).toFixed(1)}`).join(' ')
  return (
    <svg className="kpi-card__spark" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden="true" focusable="false">
      <polyline points={pts} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

export function KpiCard({ label, value, delta, icon, children, unit, context, variant, series }: {
  label: string
  icon?: ReactNode
  value: string
  delta?: { text: string; direction: 'up' | 'down' | 'flat' }
  children?: ReactNode
  /** Small caps note beside the label, e.g. a currency or period. */
  unit?: string
  /** One line under the value. */
  context?: string
  /** `risk` adds a 3px left rule in the danger colour. */
  variant?: 'money' | 'ops' | 'risk'
  series?: number[]
}) {
  const Icon = delta?.direction === 'up' ? ArrowUpRight : delta?.direction === 'down' ? ArrowDownRight : Minus
  return (
    <div className={`bento-card bento-card--light kpi-card${variant ? ` kpi-card--${variant}` : ''}`}>
      <div className="kpi-card__head">
        <div className="kpi-card__label">{icon && <span aria-hidden="true" style={{ display: 'inline-flex', verticalAlign: '-3px', marginRight: 6 }}>{icon}</span>}{label}</div>
        {unit && <span className="kpi-card__unit">{unit}</span>}
      </div>
      <div className="kpi-card__value">{value}</div>
      {delta && (
        <div className={`kpi-card__delta${delta.direction === 'flat' ? '' : ` kpi-card__delta--${delta.direction}`}`}>
          <Icon size={12} aria-hidden style={{ verticalAlign: '-2px' }} /> {delta.text}
        </div>
      )}
      {context && <div className="kpi-card__context">{context}</div>}
      {series && <Sparkline series={series} />}
      {children}
    </div>
  )
}
