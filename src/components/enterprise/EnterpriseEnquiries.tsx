/* The business buyer's enquiries: every quote, demo and sales question the
 * account has asked, and what each is waiting on.
 *
 * The list and the detail are the shared ones; this screen supplies the
 * buyer's forms and handlers. Accepting a quote moves it to `accepted` and
 * then puts its lines into the requisition at the quoted price, where
 * guard_quoted_line holds them to it.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Btn, FormField, TextArea, TextInput, toast, fmtDateTime } from '../operator/shared'
import { Dialog } from '../ui/Dialog'
import { Callout } from '../OnboardingJourney'
import { EnquiryList } from '../enquiries/EnquiryList'
import { EnquiryDetail } from '../enquiries/EnquiryDetail'
import type { ActionPayload, ActionResult } from '../enquiries/EnquiryDetail'
import { onEnquiriesChanged } from '../enquiries/events'
import {
  loadEnquiries, acceptQuote, decline, withdraw, confirmSlot, proposeSlot, reply, closeEnquiry,
} from '../../lib/enquiryRepo'
import type { EnquiryBook } from '../../lib/enquiryRepo'
import { toRequisitionLines, slotProblems } from '../../lib/enquiries'
import type { Action, Enquiry } from '../../lib/enquiries'
import { answererName, localToIso } from '../../lib/enquiryList'
import type { Chip, TypeFilter } from '../../lib/enquiryList'
import { loadAccount, loadEnterpriseCatalogue } from '../../lib/enterpriseRepo'
import type { AccountBook, EnterpriseListing } from '../../lib/enterpriseRepo'
import { useRequisition } from '../../lib/RequisitionContext'
import { useMarket } from '../../lib/MarketContext'

export function localToday(): string {
  const n = new Date()
  const p = (x: number) => String(x).padStart(2, '0')
  return `${n.getFullYear()}-${p(n.getMonth() + 1)}-${p(n.getDate())}`
}

type Pending = { action: Action; enquiry: Enquiry; slotId?: string }

export function EnterpriseEnquiries() {
  const [book, setBook] = useState<EnquiryBook | null>(null)
  const [account, setAccount] = useState<AccountBook | null>(null)
  const [shelf, setShelf] = useState<EnterpriseListing[]>([])
  const [chip, setChip] = useState<Chip>('all')
  const [type, setType] = useState<TypeFilter>('all')
  const [query, setQuery] = useState('')
  const [openId, setOpenId] = useState<string | null>(null)
  const [pending, setPending] = useState<Pending | null>(null)
  const [busy, setBusy] = useState(false)
  const req = useRequisition()
  const { fmtIn } = useMarket()
  const today = localToday()

  const reload = useCallback(async () => {
    const [b, a] = await Promise.all([loadEnquiries(), loadAccount()])
    setBook(b); setAccount(a)
    return b
  }, [])
  useEffect(() => { void reload() }, [reload])
  useEffect(() => onEnquiriesChanged(() => { void reload() }), [reload])

  /* Seller names (for "Answered by") and the catalogue facts a requisition
     line needs that a quote line does not carry: seller, model, vertical. */
  const currency = account?.account?.currency ?? null
  useEffect(() => {
    if (!currency) return
    let live = true
    void loadEnterpriseCatalogue(currency).then(rows => { if (live) setShelf(rows) }).catch(() => { /* names fall back to ids */ })
    return () => { live = false }
  }, [currency])
  const names = useMemo(() => {
    const m = new Map<string, string>()
    for (const p of shelf) if (p.partner_id) m.set(p.partner_id, p.seller)
    return m
  }, [shelf])
  const answerer = useCallback((e: Enquiry) => answererName(e, names), [names])

  const canRaise = !!account?.me?.can_raise
  const enquiries = book?.enquiries ?? []
  const open = openId ? enquiries.find(e => e.id === openId) ?? null : null

  /* The accepted quote's lines into the requisition. Separate from accepting,
     because the requisition is not kept across a reload: an accepted quote
     can be put back in from here until it expires. */
  const addToRequisition = async (e: Enquiry): Promise<boolean> => {
    if (!book) return false
    let lines
    try {
      lines = toRequisitionLines(e, book.lines.filter(l => l.enquiry_id === e.id), today)
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), 'error')
      return false
    }
    const cur = e.currency ?? currency ?? ''
    const listings = cur === currency && shelf.length ? shelf : await loadEnterpriseCatalogue(cur)
    const refused: string[] = []
    let added = 0
    for (const l of lines) {
      if (req.basket.lines.some(b => b.quote_line_id === l.quote_line_id)) continue
      const p = listings.find(x => x.id === l.product_id)
      if (!p) { refused.push(`${l.name} is no longer on the catalogue, so it cannot go on a requisition.`); continue }
      const r = req.add({
        product_id: l.product_id, name: l.name, seller: p.seller, partner_id: l.partner_id,
        unit_price: l.unit_price, model: p.model === 'monthly' ? 'monthly' : 'oneoff',
        vertical: p.category_id, unit: p.unit, quote_line_id: l.quote_line_id,
      }, cur, l.quantity)
      if (r.ok) added++
      else refused.push(r.reason)
    }
    if (refused.length) toast(refused.join(' '), 'error')
    if (added) toast(`${added} quoted ${added === 1 ? 'line' : 'lines'} added to your requisition at the quoted price.`, 'success')
    req.setOpen(true)
    return refused.length === 0
  }

  const onAction = async (action: Action, payload?: ActionPayload): Promise<ActionResult> => {
    if (!open) return
    if (action === 'reply') {
      const r = await reply(open.id, payload?.body ?? '')
      if (r.ok) await reload()
      return r
    }
    if (action === 'confirm-slot' && !payload?.slotId) {
      toast('There is no proposed time to confirm.', 'error')
      return
    }
    setPending({ action, enquiry: open, slotId: payload?.slotId })
  }

  const done = async (message: string) => {
    setPending(null)
    toast(message, 'success')
    await reload()
  }

  const loading = !book || !account
  /* isExpired only speaks of a quote still in `quoted`; an accepted one runs
     out on the same date for the requisition's purposes. */
  const accepted = open && open.type === 'quote' && open.status === 'accepted'
    && !(open.valid_until !== null && open.valid_until < today)
  const allIn = open && book
    ? book.lines.filter(l => l.enquiry_id === open.id).every(l => req.basket.lines.some(b => b.quote_line_id === l.id))
    : false

  return (
    <div className="enq">
      <div>
        <h1>Enquiries</h1>
        <p className="enq__lede">
          Quotes, demos and questions this account has asked, and what each is waiting on. Ask for a quote or a demo
          from any listing, for a quote on your whole requisition from the requisition drawer, or use Contact Sales
          in the header.
        </p>
      </div>

      {book?.loadError && (
        <Callout tone="warning" title="Enquiries are not available yet">
          This account&rsquo;s enquiries could not be read, so the list below may be empty or incomplete. Nothing you
          have asked is lost. The detail: {book.loadError}
        </Callout>
      )}

      {open?.type === 'quote' && open.status === 'quoted' && !canRaise && account?.me && (
        <Callout tone="info" title="Someone who can raise requisitions has to accept this">
          Your role on this account cannot raise a requisition, so it cannot accept a quote either.
        </Callout>
      )}

      {loading ? (
        <div style={{ textAlign: 'center', padding: '40px' }}><div className="spinner" style={{ margin: '0 auto' }} aria-label="Loading" /></div>
      ) : (
        <div className={`enq-layout${open ? ' enq-layout--split' : ''}`}>
          <EnquiryList enquiries={enquiries} role="buyer" today={today}
            chip={chip} onChip={setChip} type={type} onType={setType} query={query} onQuery={setQuery}
            onOpen={id => setOpenId(openId === id ? null : id)} openId={openId} answerer={answerer}
            title="Your enquiries" />
          {open && (
            <EnquiryDetail key={open.id} enquiry={open} book={book} role="buyer" today={today}
              opts={{ canRaise }} onAction={onAction} answerer={answerer(open)} money={fmtIn} busy={busy}
              extra={accepted && canRaise && !allIn ? (
                <Btn variant="primary" disabled={busy} onClick={async () => {
                  setBusy(true); await addToRequisition(open); setBusy(false)
                }}>Add to requisition</Btn>
              ) : undefined} />
          )}
        </div>
      )}

      {pending && (
        <ActionDialog pending={pending} slots={book?.slots ?? []} today={today}
          onClose={() => setPending(null)}
          onAccept={async () => {
            const r = await acceptQuote(pending.enquiry.id)
            if (!r.ok) return r
            setPending(null)
            await addToRequisition({ ...pending.enquiry, status: 'accepted' })
            await reload()
            return r
          }}
          onDone={done} />
      )}
    </div>
  )
}

type Result = { ok: true } | { ok: false; error: string }

/* The buyer's confirmations and small forms, one dialog for each action. */
function ActionDialog({ pending, slots, onClose, onAccept, onDone }: {
  pending: Pending
  slots: EnquiryBook['slots']
  today: string
  onClose: () => void
  onAccept: () => Promise<Result>
  onDone: (message: string) => Promise<void>
}) {
  const { action, enquiry: e } = pending
  const [reason, setReason] = useState('')
  const [when, setWhen] = useState('')
  const [problem, setProblem] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const slot = pending.slotId ? slots.find(s => s.id === pending.slotId) ?? null : null

  const run = async () => {
    setProblem(null)
    let r: Result
    let message = 'Done.'
    switch (action) {
      case 'accept':
        setBusy(true); r = await onAccept(); setBusy(false)
        if (!r.ok) setProblem(r.error)
        return
      case 'decline':
        if (!reason.trim()) { setProblem('Say why, so the seller knows what would have worked.'); return }
        setBusy(true); r = await decline(e.id, reason.trim()); message = 'Quote declined.'
        break
      case 'withdraw':
        setBusy(true); r = await withdraw(e.id); message = 'Enquiry withdrawn.'
        break
      case 'close':
        setBusy(true); r = await closeEnquiry(e.id); message = 'Enquiry closed.'
        break
      case 'confirm-slot':
        if (!pending.slotId) return
        setBusy(true); r = await confirmSlot(pending.slotId, slot?.location ?? ''); message = 'Time confirmed. The demo is scheduled.'
        break
      case 'propose-slot': {
        const iso = localToIso(when)
        if (!iso) { setProblem('Choose a date and time.'); return }
        const p = slotProblems([{ starts_at: iso, confirmed: false }], new Date().toISOString())
        if (p) { setProblem(p); return }
        setBusy(true); r = await proposeSlot(e.id, iso); message = 'Time suggested.'
        break
      }
      default:
        return
    }
    setBusy(false)
    if (!r.ok) { setProblem(r.error); return }
    await onDone(message)
  }

  const TITLE: Partial<Record<Action, string>> = {
    accept: 'Accept this quote?', decline: 'Decline this quote', withdraw: 'Withdraw this enquiry?',
    close: 'Close this enquiry?', 'confirm-slot': 'Confirm this time?', 'propose-slot': 'Suggest another time',
  }
  const GO: Partial<Record<Action, string>> = {
    accept: 'Accept and add to requisition', decline: 'Decline the quote', withdraw: 'Withdraw',
    close: 'Close it', 'confirm-slot': 'Confirm the time', 'propose-slot': 'Suggest it',
  }
  const danger = action === 'decline' || action === 'withdraw'

  return (
    <Dialog open onClose={onClose} title={TITLE[action] ?? 'Confirm'} className="enq-dialog"
      footer={<>
        <Btn variant="secondary" onClick={onClose}>Cancel</Btn>
        <Btn variant={danger ? 'danger' : 'primary'} onClick={run} disabled={busy}>{busy ? 'Working…' : GO[action] ?? 'Confirm'}</Btn>
      </>}>
      <div className="enq-form">
        {action === 'accept' && (
          <p className="enq-hint">
            The quoted lines go into your requisition at the quoted prices and quantities. Nothing is ordered until the
            requisition is raised and approved.
          </p>
        )}
        {action === 'withdraw' && <p className="enq-hint">The seller stops working on it. This cannot be undone.</p>}
        {action === 'close' && <p className="enq-hint">Close it if you have the answer you needed.</p>}
        {action === 'confirm-slot' && slot && (
          <p className="enq-hint">{fmtDateTime(slot.starts_at)}{slot.location ? ` · ${slot.location}` : ''}</p>
        )}
        {action === 'decline' && (
          <FormField label="Why are you declining it" required>
            <TextArea rows={3} value={reason} onChange={ev => setReason(ev.target.value)} />
          </FormField>
        )}
        {action === 'propose-slot' && (
          <FormField label="A time that suits you" required>
            <TextInput type="datetime-local" value={when} onChange={ev => setWhen(ev.target.value)} />
          </FormField>
        )}
        {problem && <div role="alert"><Callout tone="danger" title="That did not go through">{problem}</Callout></div>}
      </div>
    </Dialog>
  )
}
