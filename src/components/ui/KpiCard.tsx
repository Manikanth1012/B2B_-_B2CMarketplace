import type { ReactNode } from 'react'
import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react'
import { Sparkline } from './charts/Sparkline'

/**
 * A headline figure.
 *
 * Rule 9 (spec 18): one value per card, never several currencies joined into
 * one string. The headline is the largest currency; the others go in
 * `breakdown`, a compact list under it (code left, amount right, tabular). A
 * count carries a short `status` line ("3 need a decision") rather than
 * standing bare. In a `KpiRow` the cards share one height and the label,
 * value and foot line sit at the same place on each.
 */
export function KpiCard({ label, value, delta, icon, children, unit, context, variant, series, breakdown, status, tone }: {
  label: string
  icon?: ReactNode
  value: string
  delta?: { text: string; direction: 'up' | 'down' | 'flat' }
  children?: ReactNode
  /** Small caps note beside the label, e.g. a currency or period. */
  unit?: string
  /** One line under the value, at the card's foot. */
  context?: string
  /** `risk` adds a 3px left rule in the danger colour. */
  variant?: 'money' | 'ops' | 'risk'
  series?: number[]
  /** The other currencies (or parts), listed under the headline: label left, value right. */
  breakdown?: { label: string; value: string }[]
  /** A short status line for a count, e.g. "2 overdue, 1 due today". */
  status?: string
  /** Colours the value: `warning` for something waiting, `success` for something healthy. */
  tone?: 'warning' | 'success'
}) {
  const Icon = delta?.direction === 'up' ? ArrowUpRight : delta?.direction === 'down' ? ArrowDownRight : Minus
  return (
    <div className={`bento-card bento-card--light kpi-card${variant ? ` kpi-card--${variant}` : ''}`}>
      <div className="kpi-card__head">
        <div className="kpi-card__label">{icon && <span aria-hidden="true" className="kpi-card__icon">{icon}</span>}{label}</div>
        {unit && <span className="kpi-card__unit">{unit}</span>}
      </div>
      <div className={`kpi-card__value${tone ? ` kpi-card__value--${tone}` : ''}`}>{value}</div>
      {breakdown && breakdown.length > 0 && (
        <dl className="kpi-card__breakdown">
          {breakdown.map(b => (
            <div key={b.label} className="kpi-card__breakdown-row">
              <dt>{b.label}</dt>
              <dd>{b.value}</dd>
            </div>
          ))}
        </dl>
      )}
      {delta && (
        <div className={`kpi-card__delta${delta.direction === 'flat' ? '' : ` kpi-card__delta--${delta.direction}`}`}>
          <Icon size={12} aria-hidden style={{ verticalAlign: '-2px' }} /> {delta.text}
        </div>
      )}
      {(status || context) && (
        <div className="kpi-card__foot">
          {status && <div className="kpi-card__status">{status}</div>}
          {context && <div className="kpi-card__context">{context}</div>}
        </div>
      )}
      {series && <Sparkline values={series} className="kpi-card__spark" />}
      {children}
    </div>
  )
}

/**
 * A row of KPI cards: equal widths that wrap on a narrow screen, one height
 * per line of cards, the foot line pushed to the bottom of each so the
 * contexts line up.
 */
export function KpiRow({ children, label }: { children: ReactNode; label?: string }) {
  return <div className="kpi-row" role={label ? 'group' : undefined} aria-label={label}>{children}</div>
}

/**
 * Money held in several currencies, as a card wants it (rule 9): one currency
 * is the headline, the rest a `breakdown`; nothing is added together.
 *
 * Which one leads: with `toBase` (a converter into one currency at rates the
 * screen has already loaded) the largest converted amount, so rupees do not
 * outrank dollars merely for having more digits. Without it the largest
 * nominal amount, which is only a tie-break across currencies and says nothing
 * about worth. The headline's code is returned as `unit` so a "$" is never
 * ambiguous; pass it to the card.
 */
export function groupsToKpi(
  groups: readonly { currency: string; total: { amount: number } }[],
  fmt: (amount: number, currency: string) => string,
  empty = '—',
  toBase?: (amount: number, currency: string) => number,
): { value: string; unit?: string; breakdown?: { label: string; value: string }[] } {
  if (groups.length === 0) return { value: empty }
  /* Converted only when every currency converts: one missing rate (or the rates
     still loading) would otherwise rank that currency last and make the order a
     guess, so the whole card falls back to nominal instead. */
  const converted = toBase ? groups.map(g => toBase(g.total.amount, g.currency)) : null
  const useConverted = !!converted && converted.every(v => Number.isFinite(v))
  const rank = (g: { currency: string; total: { amount: number } }) =>
    useConverted ? converted![groups.indexOf(g as typeof groups[number])] : g.total.amount
  const sorted = [...groups].sort((a, b) => rank(b) - rank(a))
  const [head, ...rest] = sorted
  return {
    value: fmt(head.total.amount, head.currency),
    unit: head.currency,
    breakdown: rest.length ? rest.map(g => ({ label: g.currency, value: fmt(g.total.amount, g.currency) })) : undefined,
  }
}
