/* A configured bundle as one grouped line: its name, the chosen parts
 * underneath, one total and one quantity.
 *
 * Shared by the shopper's basket and the business requisition. Parts are not
 * edited one by one: Edit bundle reopens the configurator with the current
 * choices, Remove takes every part out, a new quantity is priced again on the
 * server and replaces the group, and an expired price offers "Re-price".
 */
import { useState, type ReactNode } from 'react'
import { Minus, Plus, Package } from 'lucide-react'
import type { Choices } from '../../lib/bundles'
import type { BundleBlock } from '../../lib/bundleLines'
import { openBundleConfigurator } from './events'
import { rebundle, type Sink } from './sinks'

export interface BundleGroupPart { key: string; name: string; seller?: string; quantity: number; lineTotal: number }

export function BundleGroup({
  name, parts, total, partsTotal, fmt, block, editable, sink, onRemove, actions, compact,
}: {
  name: string
  parts: BundleGroupPart[]
  total: number
  /** What the parts come to separately, for "you save". */
  partsTotal?: number | null
  fmt: (n: number) => string
  block: BundleBlock
  /** What it takes to configure it again; null when the selection did not load. */
  editable: { selectionId: string; templateId: string; choices: Choices; quantity: number; currency: string } | null
  sink: Sink
  onRemove: () => void | Promise<void>
  /** Extra buttons beside Edit and Remove (Save for later). */
  actions?: ReactNode
  compact?: boolean
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const again = async (quantity: number) => {
    if (!editable) return
    setBusy(true)
    setError(null)
    const r = await rebundle(editable, quantity, sink)
    setBusy(false)
    if (!r.ok) setError(r.error)
  }

  const saving = partsTotal != null ? Math.round((partsTotal - total) * 100) / 100 : 0

  return (
    <div className={`bundle-group${compact ? ' bundle-group--compact' : ''}`} role="group" aria-label={`Bundle: ${name}`}>
      <div className="bundle-group__head">
        <span className="bundle-group__mark" aria-hidden="true"><Package size={16} /></span>
        <div className="bundle-group__title">
          <span className="bundle-group__kicker">Bundle</span>
          <h4 className="bundle-group__name">{name}</h4>
        </div>
        <span className="bundle-group__total">{fmt(total)}</span>
      </div>

      <ul className="bundle-group__parts">
        {parts.map(p => (
          <li key={p.key} className="bundle-group__part">
            <span className="bundle-group__part-name">
              {p.name} <span className="bundle-group__qty">× {p.quantity}</span>
              {p.seller && <span className="bundle-group__seller"> · {p.seller}</span>}
            </span>
            <span className="bundle-group__part-price">{fmt(p.lineTotal)}</span>
          </li>
        ))}
      </ul>
      {saving > 0 && <p className="bundle-group__saving">You save {fmt(saving)} against buying the parts separately.</p>}

      {block.kind !== 'ok' && (
        <p className="bundle-group__problem" role="status">{block.says}</p>
      )}
      {error && <p className="bundle-group__problem" role="alert">{error}</p>}

      <div className="bundle-group__actions">
        {editable && (
          <div className="bundle-group__stepper" role="group" aria-label={`Quantity of ${name}`}>
            <button type="button" onClick={() => again(editable.quantity - 1)} disabled={busy || editable.quantity <= 1}
              aria-label={`One fewer ${name}`}>
              <Minus size={14} aria-hidden="true" />
            </button>
            <span aria-live="polite">{editable.quantity}</span>
            <button type="button" onClick={() => again(editable.quantity + 1)} disabled={busy}
              aria-label={`One more ${name}`}>
              <Plus size={14} aria-hidden="true" />
            </button>
          </div>
        )}
        {editable && block.kind === 'expired' && (
          <button type="button" className="bundle-group__btn bundle-group__btn--primary" disabled={busy}
            onClick={() => again(editable.quantity)}>
            {busy ? 'Re-pricing…' : 'Re-price'}
          </button>
        )}
        {editable && (
          <button type="button" className="bundle-group__btn" disabled={busy}
            onClick={() => openBundleConfigurator({
              templateId: editable.templateId, choices: editable.choices,
              quantity: editable.quantity, replaceSelectionId: editable.selectionId,
            })}>
            Edit bundle
          </button>
        )}
        {actions}
        <button type="button" className="bundle-group__btn" disabled={busy}
          onClick={() => { void onRemove() }} aria-label={`Remove ${name}`}>
          Remove
        </button>
      </div>
    </div>
  )
}

/** A short note for a part shown on its own, away from the rest of its bundle. */
export function PartOfBundle({ name }: { name?: string | null }) {
  return <span className="bundle-part-note">Part of a bundle{name ? `: ${name}` : ''}</span>
}
