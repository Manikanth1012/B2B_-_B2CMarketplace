import { useState } from 'react'
import { X, Scale, Check } from 'lucide-react'
import {
  COMPARE_CAP, capHint, canCompare, compareRows, differingOnly, sameCount, highlightNote,
} from '../lib/compare'
import type { Comparable } from '../lib/compare'

/* The tray and the table, shared by both buy sides.
 *
 * The consumer storefront and the enterprise catalogue ask the same question —
 * which of these three — and answer it with different money, different words
 * for the action, and the same rules. So the rules live in `compare.ts`, the
 * chrome lives here once, and each persona passes in its own formatter and its
 * own verb: a shopper adds to the basket, a buyer adds to a requisition.
 */

interface TrayProps {
  picks: Comparable[]
  onRemove: (id: string) => void
  onClear: () => void
  onOpen: () => void
}

export function CompareTray({ picks, onRemove, onClear, onOpen }: TrayProps) {
  if (picks.length === 0) return null

  return (
    <div style={{
      position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 60,
      background: 'white', borderTop: '1px solid var(--border)',
      boxShadow: '0 -4px 16px rgba(0,0,0,0.08)', padding: '12px 20px',
    }}>
      <div style={{
        maxWidth: '1280px', margin: '0 auto', display: 'flex', gap: '14px',
        alignItems: 'center', flexWrap: 'wrap',
      }}>
        <Scale size={18} style={{ color: 'var(--brand-navy)', flexShrink: 0 }} />

        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', flex: 1, minWidth: '220px' }}>
          {picks.map(p => (
            <span key={p.id} style={{
              display: 'inline-flex', alignItems: 'center', gap: '6px',
              padding: '4px 8px 4px 10px', borderRadius: 'var(--radius-full)',
              background: 'var(--bg-alt)', border: '1px solid var(--border)',
              fontSize: 'var(--text-xs)', maxWidth: '260px',
            }}>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {p.name}
              </span>
              <button onClick={() => onRemove(p.id)} aria-label={`Remove ${p.name} from the comparison`}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'flex' }}>
                <X size={13} style={{ color: 'var(--text-tertiary)' }} />
              </button>
            </span>
          ))}
        </div>

        {/* Said here rather than only when the fourth pick is refused. */}
        <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
          {capHint(picks.length)}
        </span>

        <button onClick={onClear} style={{
          background: 'none', border: 'none', cursor: 'pointer',
          fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', textDecoration: 'underline',
        }}>Clear</button>

        <button onClick={onOpen} disabled={!canCompare(picks.map(p => p.id))}
                title={canCompare(picks.map(p => p.id)) ? undefined : 'Pick at least two'}
                style={{
                  padding: '8px 18px', borderRadius: 'var(--radius)', border: 'none',
                  fontSize: 'var(--text-sm)', fontWeight: 700,
                  background: canCompare(picks.map(p => p.id)) ? 'var(--brand-navy)' : 'var(--gray-100)',
                  color: canCompare(picks.map(p => p.id)) ? 'white' : 'var(--text-tertiary)',
                  cursor: canCompare(picks.map(p => p.id)) ? 'pointer' : 'not-allowed',
                }}>
          Compare {picks.length}
        </button>
      </div>
    </div>
  )
}

/* ---- The table ------------------------------------------------------------ */

interface TableProps {
  picks: Comparable[]
  /* Each persona prints money its own way — the shopper's market currency, the
     account's billing currency — so the formatter comes in rather than being
     decided here. */
  money: (n: number, currency: string) => string
  /* "Add to basket" for a shopper, "Add to requisition" for a buyer. */
  actionLabel: string
  onAction: (item: Comparable) => void
  onRemove: (id: string) => void
  onClose: () => void
  /* Not every product can be bought right now — out of stock, or an enterprise
     product the account is not approved for. */
  canAct?: (item: Comparable) => boolean
}

export function CompareTable({
  picks, money, actionLabel, onAction, onRemove, onClose, canAct,
}: TableProps) {
  const [onlyDiffer, setOnlyDiffer] = useState(false)
  const all = compareRows(picks, money)
  const rows = onlyDiffer ? differingOnly(all) : all
  const same = sameCount(all)

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 80, background: 'rgba(15,23,42,0.55)',
        display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
        padding: '32px 16px', overflowY: 'auto',
      }}>
      <div onClick={e => e.stopPropagation()} style={{
        background: 'white', borderRadius: 'var(--radius-md)', width: '100%',
        maxWidth: '1080px', overflow: 'hidden',
      }}>
        <div style={{
          padding: '16px 20px', borderBottom: '1px solid var(--border)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px',
        }}>
          <div>
            <h2 style={{ fontSize: 'var(--text-lg)', fontWeight: 800, color: 'var(--text)' }}>
              Comparing {picks.length}
            </h2>
            <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', marginTop: '2px' }}>
              {highlightNote(all)}
            </p>
          </div>
          <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
            {same > 0 && (
              <label style={{
                display: 'flex', gap: '6px', alignItems: 'center',
                fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', cursor: 'pointer',
              }}>
                <input type="checkbox" checked={onlyDiffer} onChange={e => setOnlyDiffer(e.target.checked)} />
                Only what differs ({same} the same)
              </label>
            )}
            <button onClick={onClose} aria-label="Close the comparison"
                    style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex' }}>
              <X size={20} style={{ color: 'var(--text-tertiary)' }} />
            </button>
          </div>
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={{ ...th, width: '160px' }} />
                {picks.map(p => (
                  <th key={p.id} style={{ ...th, textAlign: 'left', minWidth: '200px' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-start' }}>
                        <span style={{ fontSize: 'var(--text-sm)', fontWeight: 700, color: 'var(--text)', flex: 1 }}>
                          {p.name}
                        </span>
                        <button onClick={() => onRemove(p.id)} aria-label={`Remove ${p.name}`}
                                style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'flex' }}>
                          <X size={14} style={{ color: 'var(--text-tertiary)' }} />
                        </button>
                      </div>
                      <button
                        onClick={() => onAction(p)}
                        disabled={canAct ? !canAct(p) : false}
                        style={{
                          padding: '7px 12px', borderRadius: 'var(--radius)', border: 'none',
                          fontSize: 'var(--text-xs)', fontWeight: 700,
                          background: canAct && !canAct(p) ? 'var(--gray-100)' : 'var(--brand-navy)',
                          color: canAct && !canAct(p) ? 'var(--text-tertiary)' : 'white',
                          cursor: canAct && !canAct(p) ? 'not-allowed' : 'pointer',
                        }}>
                        {canAct && !canAct(p) ? 'Unavailable' : actionLabel}
                      </button>
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, ri) => (
                <tr key={row.label} style={{ background: ri % 2 ? 'var(--bg-alt)' : 'white' }}>
                  <td style={{ ...td, fontWeight: 600, color: 'var(--text-secondary)' }}>
                    {row.label}
                    {row.note && (
                      <div style={{ fontSize: '11px', fontWeight: 400, color: 'var(--text-tertiary)', marginTop: '2px' }}>
                        {row.note}
                      </div>
                    )}
                  </td>
                  {row.cells.map((cell, ci) => {
                    const wins = row.best.includes(ci)
                    return (
                      <td key={ci} style={{
                        ...td,
                        color: cell.text === null ? 'var(--text-tertiary)' : 'var(--text)',
                        fontWeight: wins ? 700 : 400,
                        background: wins ? 'var(--success-bg)' : undefined,
                      }}>
                        <span style={{ display: 'inline-flex', gap: '6px', alignItems: 'center' }}>
                          {wins && <Check size={13} style={{ color: 'var(--success)' }} />}
                          {/* Never a zero standing in for a blank. */}
                          {cell.text ?? 'Not stated'}
                        </span>
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

const th: React.CSSProperties = {
  padding: '14px 16px', borderBottom: '1px solid var(--border)',
  fontSize: 'var(--text-xs)', verticalAlign: 'top',
}

const td: React.CSSProperties = {
  padding: '11px 16px', borderBottom: '1px solid var(--border-light)',
  fontSize: 'var(--text-sm)', verticalAlign: 'top',
}

/* The toggle that lives on a product card. */
export function CompareToggle({ on, onClick, disabled }: {
  on: boolean; onClick: () => void; disabled?: boolean
}) {
  return (
    <button
      onClick={e => { e.stopPropagation(); onClick() }}
      disabled={disabled}
      title={on ? 'Remove from the comparison' : disabled ? `You can compare ${COMPARE_CAP} at a time` : 'Compare'}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: '5px',
        padding: '5px 9px', borderRadius: 'var(--radius)',
        border: `1px solid ${on ? 'var(--brand-navy)' : 'var(--border)'}`,
        background: on ? 'var(--brand-navy)' : 'white',
        color: on ? 'white' : disabled ? 'var(--text-tertiary)' : 'var(--text-secondary)',
        fontSize: 'var(--text-xs)', fontWeight: 600,
        cursor: disabled && !on ? 'not-allowed' : 'pointer',
      }}>
      <Scale size={12} /> {on ? 'Comparing' : 'Compare'}
    </button>
  )
}
