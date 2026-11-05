/* Declining an enquiry, for whoever answers it: the seller, or the operator
 * desk on what is routed to it. A reason is required here and by the
 * database, because a decline nobody can act on helps nobody. */
import { useId, useState } from 'react'
import { Btn, FormField, TextArea } from '../operator/shared'

export interface DeclineFormProps {
  /** Returns the error to show, or null when it worked. */
  onSubmit: (reason: string) => Promise<string | null>
  onCancel: () => void
}

export function DeclineForm({ onSubmit, onCancel }: DeclineFormProps) {
  const errId = useId()
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault()
    if (!reason.trim()) {
      setError('Say why, so the buyer knows what to do next.')
      document.getElementById(`${errId}-reason`)?.focus()
      return
    }
    setBusy(true); setError(null)
    const err = await onSubmit(reason.trim())
    setBusy(false)
    if (err) setError(err)
  }

  return (
    <form className="enq-resp" onSubmit={submit} noValidate>
      <FormField label="Reason" required>
        <TextArea id={`${errId}-reason`} rows={3} value={reason} onChange={e => setReason(e.target.value)}
          aria-invalid={error ? true : undefined} aria-describedby={error ? errId : undefined} />
      </FormField>
      {error && <p id={errId} className="enq-error" role="alert">{error}</p>}
      <div className="enq-actions">
        <Btn type="button" variant="secondary" onClick={onCancel} disabled={busy}>Keep it open</Btn>
        <Btn type="submit" variant="danger" disabled={busy}>{busy ? 'Declining…' : 'Decline'}</Btn>
      </div>
    </form>
  )
}
