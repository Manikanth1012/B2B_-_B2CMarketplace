/* Asking to see something working before buying it: a format, who is coming,
 * and up to three times that suit. The seller confirms one, or suggests
 * another.
 */
import { useEffect, useState } from 'react'
import { Dialog } from '../ui/Dialog'
import { Btn, FormField, TextInput, TextArea, Select } from '../operator/shared'
import { Callout } from '../OnboardingJourney'
import { raiseDemo } from '../../lib/enquiryRepo'
import { slotProblems } from '../../lib/enquiries'
import { localToIso } from '../../lib/enquiryList'

export function RaiseDemoDialog({ open, product, onClose, onRaised }: {
  open: boolean
  product: { id: string; name: string } | null
  onClose: () => void
  onRaised: (id: string) => void
}) {
  const [subject, setSubject] = useState('')
  const [format, setFormat] = useState<'video' | 'onsite'>('video')
  const [attendees, setAttendees] = useState('2')
  const [times, setTimes] = useState(['', '', ''])
  const [note, setNote] = useState('')
  const [problem, setProblem] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    setSubject(product ? `Demo of ${product.name}` : 'Demo')
    setFormat('video'); setAttendees('2'); setTimes(['', '', '']); setNote(''); setProblem(null); setBusy(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const submit = async () => {
    if (!product) return
    if (!subject.trim()) { setProblem('Give the request a subject the seller will recognise.'); return }
    const n = Number(attendees)
    if (!Number.isInteger(n) || n < 1) { setProblem('Say how many people will attend: a whole number, at least one.'); return }
    const typed = times.filter(t => t.trim() !== '')
    const iso = typed.map(localToIso)
    if (iso.some(t => t === null)) { setProblem('One of the times is not a date and time.'); return }
    const slots = iso as string[]
    const p = slotProblems(slots.map(s => ({ starts_at: s, confirmed: false })), new Date().toISOString())
    if (p) { setProblem(p); return }
    setProblem(null); setBusy(true)
    const res = await raiseDemo({ subject: subject.trim(), product_id: product.id, format, attendees: n, slots, note: note.trim() || null })
    setBusy(false)
    if (!res.ok) { setProblem(res.error); return }
    onRaised(res.id)
  }

  return (
    <Dialog open={open && !!product} onClose={onClose} title="Book a demo" className="enq-dialog"
      footer={<>
        <Btn variant="secondary" onClick={onClose}>Cancel</Btn>
        <Btn variant="primary" onClick={submit} disabled={busy}>{busy ? 'Sending…' : 'Send the request'}</Btn>
      </>}>
      <div className="enq-form">
        <FormField label="Subject" required>
          <TextInput value={subject} onChange={e => setSubject(e.target.value)} />
        </FormField>
        <div className="enq-two">
          <FormField label="Format" required>
            <Select value={format} onChange={e => setFormat(e.target.value as 'video' | 'onsite')}>
              <option value="video">Video call</option>
              <option value="onsite">On site</option>
            </Select>
          </FormField>
          <FormField label="Attendees" required>
            <TextInput type="number" min={1} step={1} inputMode="numeric" value={attendees} onChange={e => setAttendees(e.target.value)} />
          </FormField>
        </div>
        <p className="enq-hint">Up to three times that suit you. The seller confirms one or suggests another.</p>
        {times.map((t, i) => (
          <FormField key={i} label={`Preferred time ${i + 1}`} required={i === 0}>
            <TextInput type="datetime-local" value={t}
              onChange={e => setTimes(ts => ts.map((x, j) => (j === i ? e.target.value : x)))} />
          </FormField>
        ))}
        <FormField label="Note to the seller">
          <TextArea rows={3} value={note} onChange={e => setNote(e.target.value)} />
        </FormField>
        {problem && <div role="alert"><Callout tone="danger" title="Not sent">{problem}</Callout></div>}
      </div>
    </Dialog>
  )
}
