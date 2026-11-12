/* A quote: one unit price per line, how long it holds, and a note. Used by
 * the seller and by the operator desk on what is routed to it.
 * A price under the seller's own agreed floor is flagged, not refused: the
 * floor is the seller's number and the seller may knowingly go beneath it.
 * The desk has no floor of its own and passes none, so it sees no warning.
 * On a desk quote across sellers, each seller may have proposed a price for
 * its own lines (propose_line_price). The desk sees it beside the line and
 * can use it with one press, or price the line itself. */
import { useState } from 'react'
import { TriangleAlert } from 'lucide-react'
import { Btn, FormField, TextInput, TextArea, fmtInt, fmtDateTime } from '../operator/shared'
import { validUntilProblem } from '../../lib/enquiries'
import type { Enquiry, EnquiryLine } from '../../lib/enquiries'
import type { SellerProposal } from '../../lib/enquiryPayload'

export interface QuoteResponseFormProps {
  enquiry: Enquiry
  /** The seller's proposal is there only on desk quotes, once 20261112200000 is applied. */
  lines: readonly (EnquiryLine & Partial<SellerProposal>)[]
  today: string
  /** product_id -> the seller's agreed floor, where it could be read. */
  floors: Readonly<Record<string, number>>
  /** True when the floors could not be read, so no warning can be shown. */
  floorsFailed?: boolean
  money: (n: number, currency: string) => string
  /** Returns the error to show, or null when it worked. */
  onSubmit: (prices: Record<string, number>, validUntil: string, note: string) => Promise<string | null>
  onCancel: () => void
}

export function QuoteResponseForm({ enquiry, lines, today, floors, floorsFailed, money, onSubmit, onCancel }: QuoteResponseFormProps) {
  const cur = enquiry.currency ?? ''
  const [prices, setPrices] = useState<Record<string, string>>(() =>
    Object.fromEntries(lines.map(l => [l.id, l.quoted_unit_price !== null ? String(l.quoted_unit_price) : ''])))
  const [until, setUntil] = useState(enquiry.valid_until ?? '')
  const [note, setNote] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [failure, setFailure] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const priceOf = (id: string): number | null => {
    const raw = (prices[id] ?? '').trim()
    if (raw === '') return null
    return Number(raw)
  }

  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault()
    const next: Record<string, string> = {}
    const out: Record<string, number> = {}
    for (const l of lines) {
      const n = priceOf(l.id)
      if (n === null || !Number.isFinite(n) || n <= 0) next[l.id] = 'Enter a price above zero.'
      else out[l.id] = n
    }
    const dateProblem = validUntilProblem(until, today)
    if (dateProblem) next.until = dateProblem
    setErrors(next)
    if (Object.keys(next).length) {
      const first = lines.find(l => next[l.id])
      document.getElementById(first ? `enq-q-${first.id}` : 'enq-q-until')?.focus()
      return
    }
    setBusy(true); setFailure(null)
    const err = await onSubmit(out, until, note.trim())
    setBusy(false)
    if (err) setFailure(err)
  }

  return (
    <form className="enq-resp" onSubmit={submit} noValidate>
      {lines.map(l => {
        const n = priceOf(l.id)
        const floor = floors[l.product_id]
        const below = floor !== undefined && n !== null && Number.isFinite(n) && n > 0 && n < floor
        const id = `enq-q-${l.id}`
        return (
          <div key={l.id} className="enq-resp__line">
            {/* The label and the description are written here, not through FormField,
                which would overwrite aria-describedby. */}
            <label htmlFor={id} className="c-field__label">{l.name} · unit price ({cur})</label>
            <TextInput id={id} inputMode="decimal" value={prices[l.id] ?? ''}
              onChange={e => setPrices(p => ({ ...p, [l.id]: e.target.value }))}
              aria-invalid={errors[l.id] ? true : undefined}
              aria-describedby={`${id}-hint ${id}-msg`} />
            <div id={`${id}-hint`} className="c-field__hint">
              {fmtInt(l.quantity)} wanted{l.target_unit_price !== null ? ` · they hope for ${money(l.target_unit_price, cur)}` : ''}
            </div>
            {typeof l.seller_unit_price === 'number' && (
              <div className="enq-proposal" id={`${id}-proposal`}>
                <p className="enq-muted">
                  The seller proposes {money(l.seller_unit_price, cur)} a unit
                  {l.seller_priced_at ? ` (${fmtDateTime(l.seller_priced_at)})` : ''}.
                  {l.seller_note ? ` “${l.seller_note}”` : ''}
                </p>
                <div className="enq-actions" style={{ justifyContent: 'flex-start' }}>
                  <Btn type="button" variant="secondary" style={{ minHeight: 44 }}
                    aria-label={`Use the seller's price for ${l.name}`}
                    onClick={() => {
                      setPrices(p => ({ ...p, [l.id]: String(l.seller_unit_price) }))
                      setErrors(e => { const rest = { ...e }; delete rest[l.id]; return rest })
                    }}>
                    Use the seller's price
                  </Btn>
                </div>
              </div>
            )}
            <div id={`${id}-msg`}>
              {errors[l.id] && <p className="enq-error" role="alert">{errors[l.id]}</p>}
              {below && (
                <p className="enq-warn" role="status">
                  <TriangleAlert size={14} aria-hidden="true" /> This is below the minimum you agreed for this listing ({money(floor, cur)}). You can still send it.
                </p>
              )}
            </div>
          </div>
        )
      })}
      <FormField label="Quote valid until" required>
        <TextInput id="enq-q-until" type="date" value={until} min={today} onChange={e => setUntil(e.target.value)}
          aria-invalid={errors.until ? true : undefined}
          aria-describedby={errors.until ? 'enq-q-until-msg' : undefined} />
      </FormField>
      {errors.until && <p id="enq-q-until-msg" className="enq-error" role="alert">{errors.until}</p>}
      {floorsFailed && <p className="enq-muted" role="status">Couldn't check your price floors — quote as usual.</p>}
      <FormField label="Note to the buyer (optional)">
        <TextArea rows={3} value={note} onChange={e => setNote(e.target.value)} />
      </FormField>
      {failure && <p className="enq-error" role="alert">{failure}</p>}
      <div className="enq-actions">
        <Btn type="button" variant="secondary" onClick={onCancel} disabled={busy}>Cancel</Btn>
        <Btn type="submit" disabled={busy}>{busy ? 'Sending…' : 'Send the quote'}</Btn>
      </div>
    </form>
  )
}
