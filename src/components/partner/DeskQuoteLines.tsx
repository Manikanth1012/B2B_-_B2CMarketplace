/* The seller's own lines on quotes the desk is answering.
 *
 * A quote across two sellers goes to the marketplace desk, which sends one
 * quote to the buyer. The seller of each line can tell the desk what it would
 * charge for it: a unit price and an optional note, while the desk has not
 * yet answered. The desk decides whether to use it. The database checks who,
 * when, and that the price is not under the seller's own agreed minimum
 * (propose_line_price); this form only stops the obvious before asking.
 *
 * Before 20261112200000 is applied there is nothing to ask, and the section
 * says so in one calm sentence instead of offering a form that would fail. */
import { useState } from 'react'
import { Btn, TextInput, TextArea, fmtInt, fmtDate, fmtDateTime } from '../operator/shared'

/* Why a line takes no more proposals, by what became of its quote. */
function closedSentence(status: string): string {
  switch (status) {
    case 'withdrawn': return 'The buyer withdrew this quote, so your price can no longer be changed.'
    case 'declined': return 'This quote was declined, so your price can no longer be changed.'
    case 'accepted': return 'The buyer accepted the quote the desk sent, so your price can no longer be changed.'
    default: return 'The desk has already answered this quote, so your price can no longer be changed.'
  }
}
import type { DeskQuoteLine } from '../../lib/enquiryPayload'

export type DeskLinesState =
  | { kind: 'loading' }
  | { kind: 'missing' }
  | { kind: 'failed'; error: string }
  | { kind: 'ready'; lines: readonly DeskQuoteLine[] }

export interface DeskQuoteLinesProps {
  state: DeskLinesState
  money: (n: number, currency: string) => string
  /** Returns the error to show, or null when it worked. */
  onPropose: (lineId: string, price: number, note: string) => Promise<string | null>
}

export function DeskQuoteLines({ state, money, onPropose }: DeskQuoteLinesProps) {
  if (state.kind === 'loading') return null
  if (state.kind === 'ready' && state.lines.length === 0) return null
  return (
    <section className="enq-desk-lines" aria-labelledby="enq-desk-lines-h" style={{ marginTop: 24 }}>
      <h2 id="enq-desk-lines-h" style={{ fontSize: 'var(--text-lg)', fontWeight: 700, color: 'var(--text)' }}>
        Your lines on quotes the desk is answering
      </h2>
      {state.kind === 'missing' && (
        <p className="enq-muted" role="status">
          Pricing your part of a quote across sellers is not set up yet. The marketplace desk prices those quotes for now.
        </p>
      )}
      {state.kind === 'failed' && (
        <p className="enq-error" role="alert">Your lines on desk quotes could not be loaded ({state.error}). Try again shortly.</p>
      )}
      {state.kind === 'ready' && (
        <>
          <p className="enq-muted">
            These quotes also name another seller's listings, so the desk sends one quote for all of them. Tell the desk what you would charge for your lines; it decides what to send, and the buyer does not see your price. You can propose until the desk sends the quote.
          </p>
          {state.lines.map(l => <DeskLine key={l.line_id} line={l} money={money} onPropose={onPropose} />)}
        </>
      )}
    </section>
  )
}

function DeskLine({ line: l, money, onPropose }: { line: DeskQuoteLine } & Omit<DeskQuoteLinesProps, 'state'>) {
  const [price, setPrice] = useState(l.seller_unit_price !== null ? String(l.seller_unit_price) : '')
  const [note, setNote] = useState(l.seller_note ?? '')
  const [error, setError] = useState<string | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const [sent, setSent] = useState(false)
  const [busy, setBusy] = useState(false)
  const open = l.status === 'submitted'
  const id = `enq-dl-${l.line_id}`

  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault()
    setSent(false); setFailure(null)
    const raw = price.trim()
    const n = Number(raw)
    if (raw === '' || !Number.isFinite(n) || n <= 0) {
      setError('Enter a unit price above zero.')
      document.getElementById(id)?.focus()
      return
    }
    /* Rounded to the cent first, as the database rounds it. */
    if (l.floor_price !== null && l.floor_price > 0 && Math.round(n * 100) / 100 < l.floor_price) {
      setError(`That is below the minimum you agreed for this listing, which is ${money(l.floor_price, l.currency)}.`)
      document.getElementById(id)?.focus()
      return
    }
    setError(null)
    setBusy(true)
    const err = await onPropose(l.line_id, n, note.trim())
    setBusy(false)
    if (err) setFailure(err)
    else setSent(true)
  }

  return (
    <article className="enq-resp__line" style={{ borderTop: '1px solid var(--border)', paddingTop: 14, marginTop: 14 }}>
      <h3 style={{ fontSize: 'var(--text-base)', fontWeight: 700, color: 'var(--text)', margin: 0 }}>
        {l.name} <span className="enq-muted">· {l.enquiry_id} · “{l.subject}”</span>
      </h3>
      <p className="enq-muted">
        {fmtInt(l.quantity)} wanted
        {l.target_unit_price !== null ? ` · they hope for ${money(l.target_unit_price, l.currency)}` : ''}
        {l.needed_by ? ` · needed by ${fmtDate(l.needed_by)}` : ''}
      </p>
      {l.seller_unit_price !== null && (
        <p className="enq-muted">
          You proposed {money(l.seller_unit_price, l.currency)} a unit
          {l.seller_priced_at ? ` on ${fmtDateTime(l.seller_priced_at)}` : ''}.
        </p>
      )}
      {!open ? (
        <p className="enq-muted" role="status">
          {closedSentence(l.status)}
        </p>
      ) : (
        <form className="enq-resp" onSubmit={submit} noValidate>
          <div className="c-field">
            <label htmlFor={id} className="c-field__label">Your unit price ({l.currency})</label>
            <TextInput id={id} inputMode="decimal" value={price} onChange={e => setPrice(e.target.value)}
              aria-invalid={error ? true : undefined}
              aria-describedby={`${id}-hint ${id}-msg`} />
            <div id={`${id}-hint`} className="c-field__hint">
              {l.floor_price !== null && l.floor_price > 0
                ? `Not below your agreed minimum of ${money(l.floor_price, l.currency)}.`
                : 'What you would charge the buyer for one unit.'}
              {' You can propose until the desk sends the quote.'}
            </div>
            <div id={`${id}-msg`}>{error && <p className="enq-error" role="alert">{error}</p>}</div>
          </div>
          <div className="c-field">
            <label htmlFor={`${id}-note`} className="c-field__label">Note to the desk (optional)</label>
            <TextArea id={`${id}-note`} rows={2} value={note} onChange={e => setNote(e.target.value)} maxLength={1000} />
          </div>
          {failure && <p className="enq-error" role="alert">{failure}</p>}
          {sent && <p className="enq-muted" role="status">The desk has your price.</p>}
          <div className="enq-actions">
            <Btn type="submit" disabled={busy}>
              {busy ? 'Sending…' : l.seller_unit_price !== null ? 'Propose a new price' : 'Propose this price'}
            </Btn>
          </div>
        </form>
      )}
    </article>
  )
}
