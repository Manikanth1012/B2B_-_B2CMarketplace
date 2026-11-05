import { useCallback, useEffect, useMemo, useState } from 'react'
import { EnquiryList } from '../enquiries/EnquiryList'
import { EnquiryDetail } from '../enquiries/EnquiryDetail'
import type { ActionPayload } from '../enquiries/EnquiryDetail'
import { ReassignDialog } from '../enquiries/ReassignDialog'
import type { PartnerChoice } from '../enquiries/ReassignDialog'
import { QuoteDialog, DeclineDialog, ConfirmSlotDialog, ProposeSlotDialog } from './OperatorEnquiryForms'
import { Callout } from '../OnboardingJourney'
import { Select, toast } from './shared'
import { loadEnquiries, reply, markDone, closeEnquiry } from '../../lib/enquiryRepo'
import type { EnquiryBook } from '../../lib/enquiryRepo'
import type { Action, Enquiry } from '../../lib/enquiries'
import type { Chip, TypeFilter } from '../../lib/enquiryList'
import { supabase } from '../../lib/supabase'

/* Everything that has been asked, and the desk's own to answer.
   The enquiries table may not exist yet (the migration is applied by hand), so
   a failed load is a calm notice, never a crash. */

const EMPTY: EnquiryBook = { enquiries: [], lines: [], slots: [], messages: [], events: [], loadError: null }
const DAY = 86_400_000

const AGE = [
  { id: 'any', label: 'Any age', days: 0 },
  { id: '2', label: 'Waiting over 2 days', days: 2 },
  { id: '7', label: 'Waiting over 7 days', days: 7 },
] as const

function localToday(): string {
  const n = new Date(); const p = (x: number) => String(x).padStart(2, '0')
  return `${n.getFullYear()}-${p(n.getMonth() + 1)}-${p(n.getDate())}`
}

const money = (n: number, cur: string) =>
  `${cur ? cur + ' ' : ''}${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

type Form =
  | { kind: 'quote' | 'decline' | 'propose' | 'reassign' }
  | { kind: 'confirm'; slotId: string }
  | null

export function OperatorEnquiries() {
  const [book, setBook] = useState<EnquiryBook>(EMPTY)
  const [loaded, setLoaded] = useState(false)
  const [partners, setPartners] = useState<PartnerChoice[]>([])
  const [chip, setChip] = useState<Chip>('all')
  const [type, setType] = useState<TypeFilter>('all')
  const [query, setQuery] = useState('')
  const [who, setWho] = useState('any')
  const [age, setAge] = useState<(typeof AGE)[number]['id']>('any')
  const [openId, setOpenId] = useState<string | null>(null)
  const [form, setForm] = useState<Form>(null)
  const [busy, setBusy] = useState(false)
  const today = localToday()

  const refresh = useCallback(async () => {
    const b = await loadEnquiries()
    setBook(b); setLoaded(true)
  }, [])
  useEffect(() => { void refresh() }, [refresh])
  useEffect(() => {
    let live = true
    Promise.resolve(supabase.from('partners').select('id,name').order('name'))
      .then(r => { if (live && r.data) setPartners(r.data as PartnerChoice[]) })
      .catch(() => { /* names fall back to ids */ })
    return () => { live = false }
  }, [])

  const nameOf = useCallback((id: string) => partners.find(p => p.id === id)?.name ?? id, [partners])
  const answerer = useCallback((e: Enquiry) => e.partner_id === null ? 'Operator desk' : nameOf(e.partner_id), [nameOf])

  /* Sellers to filter by: those who hold at least one enquiry. */
  const present = useMemo(() => {
    const ids = [...new Set(book.enquiries.map(e => e.partner_id).filter((x): x is string => x !== null))]
    return ids.map(id => ({ id, name: nameOf(id) })).sort((a, b) => a.name.localeCompare(b.name))
  }, [book.enquiries, nameOf])

  const extraFilter = useCallback((e: Enquiry) => {
    if (who === 'desk' && e.partner_id !== null) return false
    if (who !== 'any' && who !== 'desk' && e.partner_id !== who) return false
    const days = AGE.find(a => a.id === age)?.days ?? 0
    if (days > 0 && !(Date.now() - Date.parse(e.updated_at) > days * DAY)) return false
    return true
  }, [who, age])

  const extraFilters = (
    <>
      <label className="enq-filter">
        <span className="enq-filter__label">Who answers</span>
        <Select value={who} onChange={e => setWho(e.target.value)}>
          <option value="any">Everyone</option>
          <option value="desk">Operator desk</option>
          {present.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </Select>
      </label>
      <label className="enq-filter">
        <span className="enq-filter__label">Age</span>
        <Select value={age} onChange={e => setAge(e.target.value as typeof age)}>
          {AGE.map(a => <option key={a.id} value={a.id}>{a.label}</option>)}
        </Select>
      </label>
    </>
  )

  const open = book.enquiries.find(e => e.id === openId) ?? null

  const finished = async (msg: string) => { setForm(null); await refresh(); toast(msg) }

  const onAction = async (action: Action, payload?: ActionPayload) => {
    if (!open) return
    switch (action) {
      case 'reply': {
        const r = await reply(open.id, payload?.body ?? '')
        if (r.ok) await refresh()
        return r
      }
      case 'quote': case 'requote': setForm({ kind: 'quote' }); return
      case 'decline': setForm({ kind: 'decline' }); return
      case 'propose-slot': setForm({ kind: 'propose' }); return
      case 'confirm-slot': {
        const id = payload?.slotId ?? book.slots.filter(s => s.enquiry_id === open.id && !s.confirmed).slice(-1)[0]?.id
        if (!id) return { ok: false as const, error: 'There is no open time to confirm.' }
        setForm({ kind: 'confirm', slotId: id }); return
      }
      case 'reassign': setForm({ kind: 'reassign' }); return
      case 'mark-done': case 'close': {
        setBusy(true)
        const r = await (action === 'close' ? closeEnquiry(open.id) : markDone(open.id))
        setBusy(false)
        if (r.ok) await refresh()
        return r
      }
      default: return
    }
  }

  const close = () => setForm(null)
  const confirmSlotRow = form?.kind === 'confirm' ? book.slots.find(s => s.id === form.slotId) : undefined

  return (
    <div className="enq enq-desk">
      <div>
        <h1>Enquiries</h1>
        <p className="enq__lede">Everything buyers have asked. The desk answers what no single seller can; any enquiry can be moved.</p>
      </div>

      {book.loadError && (
        <Callout tone="warning" title="Enquiries could not be loaded">
          {book.loadError} If this is a new setup, the enquiries migration may not have been applied yet.
        </Callout>
      )}

      {loaded && (
        <div className={`enq-layout${open ? ' enq-layout--split' : ''}`}>
          <EnquiryList enquiries={book.enquiries} role="operator" today={today}
            chip={chip} onChip={setChip} type={type} onType={setType} query={query} onQuery={setQuery}
            onOpen={id => setOpenId(id === openId ? null : id)} openId={openId}
            answerer={answerer} extraFilters={extraFilters} extraFilter={extraFilter} />
          {open && (
            <EnquiryDetail key={open.id} enquiry={open} book={book} role="operator" today={today}
              opts={{ isDesk: open.partner_id === null }} onAction={onAction}
              answerer={answerer(open)} money={money} busy={busy} />
          )}
        </div>
      )}

      {open && form?.kind === 'quote' && (
        <QuoteDialog key={open.id} open onClose={close} enquiry={open} today={today}
          lines={book.lines.filter(l => l.enquiry_id === open.id)} onDone={() => finished('Quote sent.')} />
      )}
      {open && form?.kind === 'decline' && <DeclineDialog open onClose={close} enquiry={open} onDone={() => finished('Declined.')} />}
      {open && form?.kind === 'propose' && <ProposeSlotDialog open onClose={close} enquiryId={open.id} onDone={() => finished('Time suggested.')} />}
      {open && form?.kind === 'confirm' && (
        <ConfirmSlotDialog open onClose={close} slotId={form.slotId}
          needsPlace={!(confirmSlotRow?.location ?? '').trim()} onDone={() => finished('Time confirmed.')} />
      )}
      {open && form?.kind === 'reassign' && (
        <ReassignDialog open onClose={close} enquiryId={open.id} currentPartnerId={open.partner_id}
          partners={partners} onDone={() => finished('Reassigned.')} />
      )}
    </div>
  )
}
