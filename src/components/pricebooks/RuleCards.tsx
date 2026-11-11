import { useRef } from 'react'
import type { KeyboardEvent } from 'react'
import { ruleSummary } from '../../lib/accountPrices'
import type { OffContractRule } from '../../lib/accountPrices'

export const RULES: OffContractRule[] = ['allow', 'reason', 'approval']

/* The off-contract rule as three cards, one choice. A radio group: one tab
   stop, arrow keys move and select (wrapping), the checked card says so in
   words as well as colour. When `readOnly`, the choice is shown and cannot be
   changed. Each card says what the rule means for the buyer and the approver. */
export function RuleCards({ value, onChange, readOnly, label = 'When a buyer goes off your price book' }: {
  value: OffContractRule
  onChange: (next: OffContractRule) => void
  readOnly?: boolean
  label?: string
}) {
  const refs = useRef<Record<string, HTMLDivElement | null>>({})

  const move = (from: OffContractRule, step: number) => {
    const next = RULES[(RULES.indexOf(from) + step + RULES.length) % RULES.length]
    onChange(next)
    refs.current[next]?.focus()
  }
  const onKey = (e: KeyboardEvent, rule: OffContractRule) => {
    if (readOnly) return
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); move(rule, 1) }
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); move(rule, -1) }
    else if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); onChange(rule) }
  }

  return (
    <div role="radiogroup" aria-label={label} aria-readonly={readOnly || undefined}
      style={{ display: 'grid', gap: '12px', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' }}>
      {RULES.map(rule => {
        const s = ruleSummary(rule)
        const checked = rule === value
        return (
          <div key={rule}
            ref={el => { refs.current[rule] = el }}
            role="radio" aria-checked={checked} aria-disabled={readOnly || undefined}
            tabIndex={checked ? 0 : -1}
            onClick={() => { if (!readOnly) onChange(rule) }}
            onKeyDown={e => onKey(e, rule)}
            style={{
              minHeight: '44px', padding: '14px 16px', borderRadius: 'var(--radius-md, 8px)',
              border: checked ? '2px solid var(--brand-accent-dark)' : '1px solid var(--border-strong, var(--border))',
              background: 'var(--bg-card)', color: 'var(--text)',
              cursor: readOnly ? 'default' : 'pointer', display: 'flex', flexDirection: 'column', gap: '6px',
            }}>
            <div style={{ fontWeight: 700, fontSize: 'var(--text-sm)' }}>
              {s.title}{checked && <span style={{ marginLeft: '8px', fontWeight: 600 }}>(selected)</span>}
            </div>
            <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>
              <strong>Buyers.</strong> {s.buyer}
            </div>
            <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>
              <strong>Approvers.</strong> {s.approver}
            </div>
          </div>
        )
      })}
    </div>
  )
}
