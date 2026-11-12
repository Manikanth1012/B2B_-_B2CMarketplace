import { useCallback, useEffect, useMemo, useState } from 'react'
import { EnquiryList } from '../enquiries/EnquiryList'
import { EnquiryDetail } from '../enquiries/EnquiryDetail'
import type { ActionPayload } from '../enquiries/EnquiryDetail'
import { ReassignDialog } from '../enquiries/ReassignDialog'
import type { PartnerChoice } from '../enquiries/ReassignDialog'
import { QuoteResponseForm } from '../enquiries/QuoteResponseForm'
import { SlotResponseForm } from '../enquiries/SlotResponseForm'
import { DeclineForm } from '../enquiries/DeclineForm'
import { Dialog } from '../ui/Dialog'
import { Callout } from '../OnboardingJourney'
import { Select, toast, fmtDateTime } from './shared'
import { loadEnquiries, listPartners, reply, markDone, closeEnquiry, sendQuote, decline, confirmSlot, proposeSlot } from '../../lib/enquiryRepo'
import type { EnquiryBook } from '../../lib/enquiryRepo'
import { dbToday } from '../../lib/dbDay'
import type { Action, Enquiry } from '../../lib/enquiries'
import { waitingOver } from '../../lib/enquiryList'
import type { Chip, TypeFilter } from '../../lib/enquiryList'
import { useMarket } from '../../lib/MarketContext'

/* Everything that has been asked, and the desk's own to answer.
   The enquiries table may not exist yet (the migration is applied by hand), so
   a failed load is a calm notice, never a crash. */

/* The desk quotes with the same forms as a seller. No floors: a price floor is
   a seller's own agreed minimum, and the desk has none. */
const NO_FLOORS: Readonly<Record<string, number>> = {}

const EMPTY: EnquiryBook = { enquiries: [], lines: [], slots: [], messages: [], events: [], loadError: null }

const AGE = [
  { id: 'any', label: 'Any age', days: 0 },
  { id: '2', label: 'Waiting over 2 days', days: 2 },
  { id: '7', label: 'Waiting over 7 days', days: 7 },
] as const

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
  const today = dbToday()
  /* Every amount in the enquiry's own currency, spelt as the buyer and the
     seller see it. */
  const { fmtIn } = useMarket()
  const money = useCallback((n: number, cur: string) => fmtIn(n, cur), [fmtIn])

  const refresh = useCallback(async () => {
    const b = await loadEnquiries()
    setBook(b); setLoaded(true)
  }, [])
  useEffect(() => { void refresh() }, [refresh])
  useEffect(() => {
    let live = true
    void listPartners().then(r => { if (live && r.ok) setPartners(r.partners) })   // names fall back to ids
    return () => { live = false }
  }, [])

  const nameOf = useCallback((id: string) => partners.find(p => p.id === id)?.name ?? id, [partners])
  const answerer = useCallback((e: Enquiry) => e.partner_id === null ? 'Operator desk' : nameOf(e.partner_id), [nameOf])

  /* Sellers to filter by: those who hold at least one enquiry. */
  const present = useMemo(() => {
    const ids = [...new Set(book.enquiries.map(e => e.partner_id).filter((x): x is string => x !== null))]
    return ids.map(id => ({ id, name: nameOf(id) })).sort((a, b) => a.name.localeCompare(b.name))
  }, [book.enquiries, nameOf])
  /* A seller filtered on who no longer holds anything (after a reassign) would
     leave the select showing a value with no option. Back to everyone. */
  useEffect(() => {
    if (who !== 'any' && who !== 'desk' && !present.some(p => p.id === who)) setWho('any')
  }, [who, present])

  const extraFilter = useCallback((e: Enquiry) => {
    if (who === 'desk' && e.partner_id !== null) return false
    if (who !== 'any' && who !== 'desk' && e.partner_id !== who) return false
    const days = AGE.find(a => a.id === age)?.days ?? 0
    if (!waitingOver(e, days, Date.now())) return false
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
  /* For the shared forms: the error to show in the form, or null once it went
     through and the dialog has closed. */
  const answered = async (r: { ok: true } | { ok: false; error: string }, msg: string): Promise<string | null> => {
    if (!r.ok) return r.error
    await finished(msg)
    return null
  }

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

      <Dialog className="enq-dialog" open={form?.kind === 'quote' && !!open} onClose={close}
        title={open?.status === 'quoted' ? 'Send a new quote' : 'Send a quote'} wide>
        {open && <QuoteResponseForm key={open.id} enquiry={open} today={today} floors={NO_FLOORS} money={money}
          lines={book.lines.filter(l => l.enquiry_id === open.id).sort((a, b) => a.sort_order - b.sort_order)}
          onCancel={close}
          onSubmit={async (prices, until, note) => answered(await sendQuote(open.id, prices, until, note || null), 'Quote sent.')} />}
      </Dialog>

      <Dialog className="enq-dialog" open={form?.kind === 'decline' && !!open} onClose={close} title="Decline this enquiry">
        {open && <DeclineForm onCancel={close} onSubmit={async why => answered(await decline(open.id, why), 'Declined.')} />}
      </Dialog>

      <Dialog className="enq-dialog" open={form?.kind === 'confirm' && !!confirmSlotRow} onClose={close} title="Confirm a time">
        {confirmSlotRow && <SlotResponseForm mode="confirm" when={fmtDateTime(confirmSlotRow.starts_at)}
          location={confirmSlotRow.location} onCancel={close}
          onSubmit={async v => answered(await confirmSlot(confirmSlotRow.id, v.location), 'Time confirmed.')} />}
      </Dialog>

      <Dialog className="enq-dialog" open={form?.kind === 'propose' && !!open} onClose={close} title="Suggest another time">
        {open && <SlotResponseForm mode="propose" onCancel={close}
          onSubmit={async v => answered(await proposeSlot(open.id, v.startsAt!, v.location), 'Time suggested.')} />}
      </Dialog>

      {open && form?.kind === 'reassign' && (
        <ReassignDialog open onClose={close} enquiryId={open.id} currentPartnerId={open.partner_id}
          partners={partners} onDone={() => finished('Reassigned.')} />
      )}
    </div>
  )
}
