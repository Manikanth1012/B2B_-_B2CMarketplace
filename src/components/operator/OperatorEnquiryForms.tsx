/* The operator answering a desk-routed enquiry: the four answers that need
   more than a click. Each calls the repository directly and shows the
   database's own words if it says no. */
import { useState } from 'react'
import { Dialog } from '../ui/Dialog'
import { Btn, FormField, TextInput, TextArea } from './shared'
import { sendQuote, decline, confirmSlot, proposeSlot } from '../../lib/enquiryRepo'
import { validUntilProblem, slotProblems } from '../../lib/enquiries'
import type { Enquiry, EnquiryLine } from '../../lib/enquiries'

type Done = () => void

function Shell({ open, onClose, title, busy, onSubmit, submitLabel, error, children }: {
  open: boolean; onClose: () => void; title: string; busy: boolean
  onSubmit: () => void; submitLabel: string; error: string | null; children: React.ReactNode
}) {
  return (
    <Dialog open={open} onClose={onClose} title={title} className="enq-dialog"
      footer={<>
        <Btn variant="secondary" onClick={onClose} disabled={busy}>Cancel</Btn>
        <Btn onClick={onSubmit} disabled={busy}>{busy ? 'Working…' : submitLabel}</Btn>
      </>}>
      <div className="enq-form">
        {children}
        {error && <p className="enq-error" role="alert">{error}</p>}
      </div>
    </Dialog>
  )
}

export function QuoteDialog({ open, onClose, enquiry, lines, today, onDone }: {
  open: boolean; onClose: () => void; enquiry: Enquiry; lines: readonly EnquiryLine[]; today: string; onDone: Done
}) {
  const [prices, setPrices] = useState<Record<string, string>>({})
  const [until, setUntil] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    const out: Record<string, number> = {}
    for (const l of lines) {
      const n = Number(prices[l.id])
      if (!prices[l.id]?.trim() || !Number.isFinite(n) || n < 0) { setError(`Give a price for ${l.name}.`); return }
      out[l.id] = n
    }
    const p = validUntilProblem(until, today)
    if (p) { setError(p); return }
    setBusy(true); setError(null)
    const r = await sendQuote(enquiry.id, out, until, note)
    setBusy(false)
    if (!r.ok) { setError(r.error); return }
    onDone()
  }

  return (
    <Shell open={open} onClose={onClose} title={enquiry.status === 'quoted' ? 'Send a new quote' : 'Send a quote'}
      busy={busy} onSubmit={submit} submitLabel="Send quote" error={error}>
      {lines.map(l => (
        <FormField key={l.id} label={`${l.name}: price per unit (${enquiry.currency ?? ''}), quantity ${l.quantity}`} required>
          <TextInput type="number" inputMode="decimal" min={0} step="0.01" value={prices[l.id] ?? ''}
            onChange={e => setPrices({ ...prices, [l.id]: e.target.value })} />
        </FormField>
      ))}
      <FormField label="Valid until" required hint="Between tomorrow and 90 days from today.">
        <TextInput type="date" value={until} onChange={e => setUntil(e.target.value)} />
      </FormField>
      <FormField label="Note for the buyer">
        <TextArea rows={2} value={note} onChange={e => setNote(e.target.value)} />
      </FormField>
    </Shell>
  )
}

export function DeclineDialog({ open, onClose, enquiry, onDone }: {
  open: boolean; onClose: () => void; enquiry: Enquiry; onDone: Done
}) {
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const submit = async () => {
    if (!reason.trim()) { setError('Give the buyer a reason.'); return }
    setBusy(true); setError(null)
    const r = await decline(enquiry.id, reason.trim())
    setBusy(false)
    if (!r.ok) { setError(r.error); return }
    onDone()
  }
  return (
    <Shell open={open} onClose={onClose} title="Decline this enquiry" busy={busy} onSubmit={submit} submitLabel="Decline" error={error}>
      <FormField label="Reason" required>
        <TextArea rows={3} value={reason} onChange={e => setReason(e.target.value)} />
      </FormField>
    </Shell>
  )
}

export function ConfirmSlotDialog({ open, onClose, slotId, needsPlace, onDone }: {
  open: boolean; onClose: () => void; slotId: string; needsPlace: boolean; onDone: Done
}) {
  const [where, setWhere] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const submit = async () => {
    if (needsPlace && !where.trim()) { setError('Say where, or give the link, for the demo.'); return }
    setBusy(true); setError(null)
    const r = await confirmSlot(slotId, where.trim())
    setBusy(false)
    if (!r.ok) { setError(r.error); return }
    onDone()
  }
  return (
    <Shell open={open} onClose={onClose} title="Confirm this time" busy={busy} onSubmit={submit} submitLabel="Confirm" error={error}>
      {needsPlace
        ? <FormField label="Location or meeting link" required>
            <TextInput value={where} onChange={e => setWhere(e.target.value)} />
          </FormField>
        : <p>This time already has its place. Confirming it schedules the demo.</p>}
    </Shell>
  )
}

export function ProposeSlotDialog({ open, onClose, enquiryId, onDone }: {
  open: boolean; onClose: () => void; enquiryId: string; onDone: Done
}) {
  const [when, setWhen] = useState('')
  const [where, setWhere] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const submit = async () => {
    const t = when ? new Date(when) : null
    if (!t || Number.isNaN(t.getTime())) { setError('Choose a date and time.'); return }
    const iso = t.toISOString()
    const p = slotProblems([{ starts_at: iso, confirmed: false }], new Date().toISOString())
    if (p) { setError(p); return }
    if (!where.trim()) { setError('Say where, or give the link, for the demo.'); return }
    setBusy(true); setError(null)
    const r = await proposeSlot(enquiryId, iso, where)
    setBusy(false)
    if (!r.ok) { setError(r.error); return }
    onDone()
  }
  return (
    <Shell open={open} onClose={onClose} title="Suggest another time" busy={busy} onSubmit={submit} submitLabel="Suggest" error={error}>
      <FormField label="Date and time" required>
        <TextInput type="datetime-local" value={when} onChange={e => setWhen(e.target.value)} />
      </FormField>
      <FormField label="Location or meeting link" required>
        <TextInput value={where} onChange={e => setWhere(e.target.value)} />
      </FormField>
    </Shell>
  )
}
