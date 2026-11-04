import type { ReactNode } from 'react'
import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react'

export function KpiCard({ label, value, delta, children }: {
  label: string
  value: string
  delta?: { text: string; direction: 'up' | 'down' | 'flat' }
  children?: ReactNode
}) {
  const Icon = delta?.direction === 'up' ? ArrowUpRight : delta?.direction === 'down' ? ArrowDownRight : Minus
  return (
    <div className="bento-card bento-card--light kpi-card">
      <div className="kpi-card__label">{label}</div>
      <div className="kpi-card__value">{value}</div>
      {delta && (
        <div className={`kpi-card__delta${delta.direction === 'flat' ? '' : ` kpi-card__delta--${delta.direction}`}`}>
          <Icon size={12} aria-hidden style={{ verticalAlign: '-2px' }} /> {delta.text}
        </div>
      )}
      {children}
    </div>
  )
}
