/* A word with the marketplace's sales desk: a topic, a message, and how to
 * be answered. Always goes to the operator desk.
 */
import { useEffect, useState } from 'react'
import { Dialog } from '../ui/Dialog'
import { Btn, FormField, TextInput, TextArea, Select } from '../operator/shared'
import { Callout } from '../OnboardingJourney'
import { raiseSales } from '../../lib/enquiryRepo'

type Pref = 'email' | 'phone' | 'in_app'

export function ContactSalesDialog({ open, onClose, onRaised }: {
  open: boolean
  onClose: () => void
  onRaised: (id: string) => void
}) {
  const [subject, setSubject] = useState('')
  const [message, setMessage] = useState('')
  const [pref, setPref] = useState<Pref>('in_app')
  const [problem, setProblem] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    setSubject(''); setMessage(''); setPref('in_app'); setProblem(null); setBusy(false)
  }, [open])

  const submit = async () => {
    if (!subject.trim()) { setProblem('Say what it is about.'); return }
    if (!message.trim()) { setProblem('Write the message for the sales team.'); return }
    setProblem(null); setBusy(true)
    const res = await raiseSales({ subject: subject.trim(), message: message.trim(), contact_pref: pref })
    setBusy(false)
    if (!res.ok) { setProblem(res.error); return }
    onRaised(res.id)
  }

  return (
    <Dialog open={open} onClose={onClose} title="Contact Sales" className="enq-dialog"
      footer={<>
        <Btn variant="secondary" onClick={onClose}>Cancel</Btn>
        <Btn variant="primary" onClick={submit} disabled={busy}>{busy ? 'Sending…' : 'Send'}</Btn>
      </>}>
      <div className="enq-form">
        <p className="enq-hint">Volume pricing, a contract question, something not on the catalogue: the marketplace&rsquo;s sales desk answers.</p>
        <FormField label="Topic" required>
          <TextInput value={subject} onChange={e => setSubject(e.target.value)} placeholder="Volume pricing for 500 trackers" />
        </FormField>
        <FormField label="Message" required>
          <TextArea rows={5} value={message} onChange={e => setMessage(e.target.value)} />
        </FormField>
        <FormField label="How should we reply">
          <Select value={pref} onChange={e => setPref(e.target.value as Pref)}>
            <option value="in_app">Here, in the console</option>
            <option value="email">Email</option>
            <option value="phone">Phone</option>
          </Select>
        </FormField>
        {problem && <div role="alert"><Callout tone="danger" title="Not sent">{problem}</Callout></div>}
      </div>
    </Dialog>
  )
}
