import { useId, useRef } from 'react'
import type { KeyboardEvent } from 'react'
import { ruleSummary } from '../../lib/accountPrices'
import type { OffContractRule } from '../../lib/accountPrices'

export const RULES: OffContractRule[] = ['allow', 'reason', 'approval']

/* The off-contract rule as three cards, one choice. A radio group: one tab
   stop, arrow keys move and select (wrapping), Home and End go to the ends,
   the checked card says so in words as well as colour. When `readOnly`, the
   choice is shown and cannot be changed. Each card says what the rule means
   for the buyer and the approver. */
export function RuleCards({ value, onChange, readOnly, label = 'When a buyer goes off your price book' }: {
  value: OffContractRule
  onChange: (next: OffContractRule) => void
  readOnly?: boolean
  label?: string
}) {
  const uid = useId()
  const refs = useRef<Record<string, HTMLDivElement | null>>({})

  const go = (next: OffContractRule) => { onChange(next); refs.current[next]?.focus() }
  const move = (from: OffContractRule, step: number) =>
    go(RULES[(RULES.indexOf(from) + step + RULES.length) % RULES.length])
  const onKey = (e: KeyboardEvent, rule: OffContractRule) => {
    if (readOnly) return
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); move(rule, 1) }
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); move(rule, -1) }
    else if (e.key === 'Home') { e.preventDefault(); go(RULES[0]) }
    else if (e.key === 'End') { e.preventDefault(); go(RULES[RULES.length - 1]) }
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
            aria-labelledby={`${uid}-${rule}-t`} aria-describedby={`${uid}-${rule}-d`}
            tabIndex={checked ? 0 : -1}
            onClick={() => { if (!readOnly) onChange(rule) }}
            onKeyDown={e => onKey(e, rule)}
            style={{
              minHeight: '44px', borderRadius: 'var(--radius-md, 8px)',
              /* 2px when checked, with 1px less padding, so nothing shifts. */
              border: `${checked ? 2 : 1}px solid ${checked ? 'var(--brand-accent-dark)' : 'var(--border-strong, var(--border))'}`,
              padding: checked ? '13px 15px' : '14px 16px',
              background: 'var(--bg-card)', color: 'var(--text)',
              cursor: readOnly ? 'default' : 'pointer', display: 'flex', flexDirection: 'column', gap: '6px',
            }}>
            <div id={`${uid}-${rule}-t`} style={{ fontWeight: 700, fontSize: 'var(--text-sm)' }}>
              {s.title}{checked && <span aria-hidden="true" style={{ marginLeft: '8px', fontWeight: 600 }}>(selected)</span>}
            </div>
            <div id={`${uid}-${rule}-d`} style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>
              <div><strong>Buyers.</strong> {s.buyer}</div>
              <div><strong>Approvers.</strong> {s.approver}</div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
