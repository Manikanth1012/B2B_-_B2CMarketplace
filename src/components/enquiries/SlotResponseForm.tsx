/* The seller's two answers to a demo: confirm a time the buyer offered (the
 * seller gives the joining link or address), or offer another time. */
import { useState } from 'react'
import { Btn, FormField, TextInput } from '../operator/shared'

export type SlotMode = 'confirm' | 'propose'

export interface SlotResponseFormProps {
  mode: SlotMode
  /** For confirm: the time being confirmed, shown back. */
  when?: string
  /** Any place the time already carries. */
  location?: string | null
  /** Returns the error to show, or null when it worked. */
  onSubmit: (v: { location: string; startsAt?: string }) => Promise<string | null>
  onCancel: () => void
  now?: () => number
}

export function SlotResponseForm({ mode, when, location, onSubmit, onCancel, now = Date.now }: SlotResponseFormProps) {
  const [where, setWhere] = useState(location ?? '')
  const [at, setAt] = useState('')
  const [problem, setProblem] = useState<{ where?: string; at?: string }>({})
  const [failure, setFailure] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  /* A time that already has a place is confirmed as it stands (confirmSlot
     would ignore anything typed), so the place is shown, not asked for. */
  const fixedPlace = mode === 'confirm' && (location ?? '').trim() !== ''

  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault()
    const p: { where?: string; at?: string } = {}
    if (!fixedPlace && !where.trim()) p.where = 'Give a joining link or an address.'
    let iso: string | undefined
    if (mode === 'propose') {
      const t = Date.parse(at)
      if (!at || Number.isNaN(t)) p.at = 'Choose a date and time.'
      else if (t <= now()) p.at = 'Choose a time in the future.'
      else iso = new Date(t).toISOString()
    }
    setProblem(p)
    if (p.where || p.at) {
      document.getElementById(p.at ? 'enq-s-at' : 'enq-s-where')?.focus()
      return
    }
    setBusy(true); setFailure(null)
    const err = await onSubmit({ location: fixedPlace ? (location ?? '').trim() : where.trim(), startsAt: iso })
    setBusy(false)
    if (err) setFailure(err)
  }

  return (
    <form className="enq-resp" onSubmit={submit} noValidate>
      {mode === 'confirm' && when && <p className="enq-muted">Confirming the time the buyer offered: <strong>{when}</strong></p>}
      {mode === 'propose' && (
        <FormField label="New date and time" required>
          <TextInput id="enq-s-at" type="datetime-local" value={at} onChange={e => setAt(e.target.value)}
            aria-invalid={problem.at ? true : undefined}
            aria-describedby={problem.at ? 'enq-s-at-msg' : undefined} />
        </FormField>
      )}
      {problem.at && <p id="enq-s-at-msg" className="enq-error" role="alert">{problem.at}</p>}
      {fixedPlace ? (
        <p className="enq-muted">Meeting at: <strong>{location}</strong></p>
      ) : (
        <>
          <FormField label="Joining link or address" required>
            <TextInput id="enq-s-where" value={where} onChange={e => setWhere(e.target.value)}
              aria-invalid={problem.where ? true : undefined}
              aria-describedby={problem.where ? 'enq-s-where-msg' : undefined} />
          </FormField>
          {problem.where && <p id="enq-s-where-msg" className="enq-error" role="alert">{problem.where}</p>}
        </>
      )}
      {failure && <p className="enq-error" role="alert">{failure}</p>}
      <div className="enq-actions">
        <Btn type="button" variant="secondary" onClick={onCancel} disabled={busy}>Cancel</Btn>
        <Btn type="submit" disabled={busy}>{busy ? 'Saving…' : mode === 'confirm' ? 'Confirm the time' : 'Suggest this time'}</Btn>
      </div>
    </form>
  )
}
