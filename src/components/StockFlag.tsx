/* Under a basket line the marketplace's stock flag caught (spec 11, 2b): the
   note the database wrote, and what the buyer can do about it. Accept keeps
   the quantity it was cut to; a line no longer available can only be removed.
   Said in words and with an icon, never by colour alone. Shared by the
   shopper's cart, checkout and the business requisition. */
import type { CSSProperties } from 'react'
import { TriangleAlert } from 'lucide-react'

export function StockFlag({ id, note, name, from, canAccept, busy, problem, onAccept, onRemove, style }: {
  id?: string
  note: string
  name: string
  /** Where Remove takes it from, for the button's accessible name ("the requisition", "your basket"). */
  from: string
  canAccept: boolean
  busy: boolean
  problem: string | null
  onAccept: () => void
  onRemove: () => void
  style?: CSSProperties
}) {
  return (
    <div id={id} className="stock-flag" style={style}>
      <div className="stock-flag__note">
        <TriangleAlert size={14} aria-hidden="true" />
        <span><strong>Stock changed:</strong> {note}</span>
      </div>
      <div className="stock-flag__actions">
        {canAccept && (
          <button type="button" className="btn btn-secondary btn-sm stock-flag__btn" disabled={busy} onClick={onAccept}
            aria-label={`Accept the change to ${name}`}>
            Accept
          </button>
        )}
        <button type="button" className="btn btn-secondary btn-sm stock-flag__btn" disabled={busy} onClick={onRemove}
          aria-label={`Remove ${name} from ${from}`}>
          Remove
        </button>
      </div>
      {problem && <div role="alert" className="stock-flag__problem">{problem}</div>}
    </div>
  )
}
