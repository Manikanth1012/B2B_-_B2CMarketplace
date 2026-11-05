/* Move an enquiry between the operator desk and a seller, with a reason that
   goes on the record. The database refuses a reassignment without one, and so
   does this form, before asking. */
import { useId, useState } from 'react'
import { Dialog } from '../ui/Dialog'
import { Btn, FormField, Select, TextArea } from '../operator/shared'
import { reassign } from '../../lib/enquiryRepo'

export interface PartnerChoice { id: string; name: string }

const DESK = '__desk__'

export function ReassignDialog({ open, onClose, enquiryId, currentPartnerId, partners, onDone }: {
  open: boolean
  onClose: () => void
  enquiryId: string
  currentPartnerId: string | null
  partners: readonly PartnerChoice[]
  onDone: () => void
}) {
  const errId = useId()
  const [target, setTarget] = useState<string>(currentPartnerId ?? DESK)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    const why = reason.trim()
    if (!why) { setError('Say why it is being moved; the reason goes on its history.'); return }
    const to = target === DESK ? null : target
    if (to === currentPartnerId) { setError('It is already with them. Choose someone else.'); return }
    setBusy(true); setError(null)
    const r = await reassign(enquiryId, to, why)
    setBusy(false)
    if (!r.ok) { setError(r.error); return }
    onDone()
  }

  return (
    <Dialog open={open} onClose={onClose} title="Reassign this enquiry" className="enq-dialog"
      footer={<>
        <Btn variant="secondary" onClick={onClose} disabled={busy}>Cancel</Btn>
        <Btn onClick={submit} disabled={busy}>{busy ? 'Moving…' : 'Reassign'}</Btn>
      </>}>
      <div className="enq-form">
        <FormField label="Who answers it" required>
          <Select value={target} onChange={e => setTarget(e.target.value)}>
            <option value={DESK}>The operator desk</option>
            {partners.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
        </FormField>
        <FormField label="Reason" required>
          <TextArea rows={3} value={reason} onChange={e => setReason(e.target.value)}
            aria-invalid={error ? true : undefined} aria-describedby={error ? errId : undefined} />
        </FormField>
        {error && <p id={errId} className="enq-error" role="alert">{error}</p>}
      </div>
    </Dialog>
  )
}
