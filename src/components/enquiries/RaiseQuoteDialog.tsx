/* Asking a seller (or the desk) to price something before it is bought.
 *
 * Opened from a listing ("Request a quote") or from the requisition drawer
 * ("Request a quote for this basket"). Who answers is decided by the database
 * from the lines: one seller gets it, a mix goes to the desk.
 */
import { useEffect, useState } from 'react'
import { Dialog } from '../ui/Dialog'
import { Btn, FormField, TextInput, TextArea } from '../operator/shared'
import { Callout } from '../OnboardingJourney'
import { raiseQuote } from '../../lib/enquiryRepo'

export interface QuoteSeed { product_id: string; name: string; quantity: number }

interface Row { product_id: string; name: string; quantity: string; target: string }

const localDate = () => {
  const n = new Date()
  const p = (x: number) => String(x).padStart(2, '0')
  return `${n.getFullYear()}-${p(n.getMonth() + 1)}-${p(n.getDate())}`
}

export function RaiseQuoteDialog({ open, seed, onClose, onRaised }: {
  open: boolean
  seed: readonly QuoteSeed[]
  onClose: () => void
  onRaised: (id: string) => void
}) {
  const [rows, setRows] = useState<Row[]>([])
  const [subject, setSubject] = useState('')
  const [neededBy, setNeededBy] = useState('')
  const [note, setNote] = useState('')
  const [problem, setProblem] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    setRows(seed.map(s => ({ product_id: s.product_id, name: s.name, quantity: String(s.quantity), target: '' })))
    setSubject(seed.length === 1 ? `Quote for ${seed[0].name}` : `Quote for ${seed.length} items`)
    setNeededBy(''); setNote(''); setProblem(null); setBusy(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const set = (i: number, patch: Partial<Row>) => setRows(rs => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)))

  const submit = async () => {
    if (!subject.trim()) { setProblem('Give the request a subject the seller will recognise.'); return }
    if (!rows.length) { setProblem('There is nothing to quote.'); return }
    const lines: { product_id: string; quantity: number; target_unit_price: number | null }[] = []
    for (const r of rows) {
      const q = Number(r.quantity)
      if (!Number.isInteger(q) || q < 1) { setProblem(`Ask for a whole number of ${r.name}, at least one.`); return }
      const t = r.target.trim() === '' ? null : Number(r.target)
      if (t !== null && (!Number.isFinite(t) || t <= 0)) { setProblem(`The target price for ${r.name} has to be more than nothing, or left empty.`); return }
      lines.push({ product_id: r.product_id, quantity: q, target_unit_price: t })
    }
    if (neededBy && neededBy < localDate()) { setProblem('The needed-by date has passed. Choose today or later, or leave it empty.'); return }
    setProblem(null); setBusy(true)
    const res = await raiseQuote({ subject: subject.trim(), lines, needed_by: neededBy || null, note: note.trim() || null })
    setBusy(false)
    if (!res.ok) { setProblem(res.error); return }
    onRaised(res.id)
  }

  return (
    <Dialog open={open} onClose={onClose} title="Request a quote" wide className="enq-dialog"
      footer={<>
        <Btn variant="secondary" onClick={onClose}>Cancel</Btn>
        <Btn variant="primary" onClick={submit} disabled={busy}>{busy ? 'Sending…' : 'Send the request'}</Btn>
      </>}>
      <div className="enq-form">
        <p className="enq-hint">
          The seller answers with a price per line and a date it holds until. Accepting it puts these lines into your
          requisition at that price; nothing is ordered until the requisition is approved.
        </p>
        <FormField label="Subject" required>
          <TextInput value={subject} onChange={e => setSubject(e.target.value)} />
        </FormField>
        <div className="enq-form__lines" role="group" aria-label="Lines">
          {rows.map((r, i) => (
            <div key={r.product_id} className="enq-form__line">
              <span className="enq-form__name">{r.name}</span>
              <FormField label="Quantity" required>
                <TextInput type="number" min={1} step={1} inputMode="numeric" value={r.quantity}
                  aria-label={`Quantity of ${r.name}`} onChange={e => set(i, { quantity: e.target.value })} />
              </FormField>
              <FormField label="Target unit price">
                <TextInput type="number" min={0} step="0.01" inputMode="decimal" value={r.target}
                  aria-label={`Target unit price for ${r.name} (optional)`} onChange={e => set(i, { target: e.target.value })} />
              </FormField>
            </div>
          ))}
        </div>
        <FormField label="Needed by" hint="Optional. When you need it delivered or live.">
          <TextInput type="date" min={localDate()} value={neededBy} onChange={e => setNeededBy(e.target.value)} />
        </FormField>
        <FormField label="Note to the seller">
          <TextArea rows={3} value={note} onChange={e => setNote(e.target.value)} />
        </FormField>
        {problem && <div role="alert"><Callout tone="danger" title="Not sent">{problem}</Callout></div>}
      </div>
    </Dialog>
  )
}
