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
  loadEnquiries, acceptQuote, decline, withdraw, confirmSlot, proposeSlot, reply, closeEnquiry, loadQuotedProducts,
} from '../../lib/enquiryRepo'
import type { EnquiryBook } from '../../lib/enquiryRepo'
import { toRequisitionLines, slotProblems } from '../../lib/enquiries'
import { dbToday, validUntilLabel } from '../../lib/dbDay'
import type { Action, Enquiry, EnquiryLine } from '../../lib/enquiries'
import {
  answererName, localToIso, liveQuoteLineIds, acceptedQuoteStanding, quoteChanged, quotedBasketLines, quoteBasketClash,
} from '../../lib/enquiryList'
import type { Chip, TypeFilter } from '../../lib/enquiryList'
import { loadAccount, loadEnterpriseCatalogue } from '../../lib/enterpriseRepo'
import type { AccountBook, EnterpriseListing } from '../../lib/enterpriseRepo'
import { useRequisition } from '../../lib/RequisitionContext'
import { useMarket } from '../../lib/MarketContext'

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
  /* Why an accepted quote's lines did not all go in, kept beside the Add
     button (not only in a toast) until they do. */
  const [addProblem, setAddProblem] = useState<{ id: string; text: string } | null>(null)
  const req = useRequisition()
  const { fmtIn } = useMarket()
  const today = dbToday()

  const reload = useCallback(async () => {
    const [b, a] = await Promise.all([loadEnquiries(), loadAccount()])
    setBook(b); setAccount(a)
    return { book: b, account: a }
  }, [])
  useEffect(() => { void reload() }, [reload])
  useEffect(() => onEnquiriesChanged(() => { void reload() }), [reload])

  /* Seller names, for "Answered by". Only the live shelf: a requisition line's
     facts are read by product id when a quote is added (loadQuotedProducts). */
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

  /* Quote lines already on a pending or approved requisition. The database
     refuses a second one, so they are never offered again. */
  const liveFrom = (a: AccountBook | null) => liveQuoteLineIds(
    a?.requisitions ?? [],
    (a?.lines ?? []) as unknown as { requisition_id: string; quote_line_id?: string | null }[],
  )
  const live = useMemo(() => liveFrom(account), [account])

  /* The accepted quote's lines into the requisition. Separate from accepting,
     because the requisition is not kept across a reload: an accepted quote
     can be put back in from here until it expires. Takes the lines to use, so
     Accept can pass the ones it has just read back. */
  const addToRequisition = async (e: Enquiry, quoteLines: readonly EnquiryLine[], held: ReadonlyMap<string, string>): Promise<boolean> => {
    const fail = (text: string) => { setAddProblem({ id: e.id, text }); toast(text, 'error'); return false }
    let quoted
    try {
      quoted = toRequisitionLines(e, quoteLines.filter(l => l.enquiry_id === e.id), today)
    } catch (err) {
      return fail(err instanceof Error ? err.message : String(err))
    }
    const cur = e.currency ?? currency ?? ''
    const todo = quoted.filter(l => !held.has(l.quote_line_id) && !req.basket.lines.some(b => b.quote_line_id === l.quote_line_id))
    if (!todo.length) { setAddProblem(null); return true }
    /* One sentence for the whole quote, rather than the same refusal per line. */
    const clash = quoteBasketClash(req.basket, cur, e.valid_until ? validUntilLabel(e.valid_until) : null)
    if (clash) { req.setOpen(true); return fail(clash) }
    /* The quote's own lines, with the product facts read by id whatever the
       listing's status: a quote on a listing paused since it was priced is
       still good, and guard_quoted_line is the judge of that, not the shelf. */
    const p = await loadQuotedProducts(todo.map(l => l.product_id))
    if (!p.ok) return fail(`The quoted products could not be read, so nothing was added. The quote stays accepted; use Add to requisition to try again. The detail: ${p.error}`)
    const { lines, unread } = quotedBasketLines(todo, p.products)
    const refused = [...unread]
    let added = 0
    for (const { quantity, ...line } of lines) {
      const r = req.add(line, cur, quantity)
      if (r.ok) added++
      else refused.push(r.reason)
    }
    if (added) toast(`${added} quoted ${added === 1 ? 'line' : 'lines'} added to your requisition at the quoted price.`, 'success')
    req.setOpen(true)
    if (refused.length) return fail(refused.join(' '))
    setAddProblem(null)
    return true
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
  const inBasket = new Set(req.basket.lines.map(l => l.quote_line_id).filter((x): x is string => !!x))
  const standing = open && book
    ? acceptedQuoteStanding(open, book.lines, today, canRaise, inBasket, live)
    : { kind: 'none' as const }

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
              extra={standing.kind === 'add' ? (
                <>
                  <Btn variant="primary" disabled={busy} onClick={async () => {
                    setBusy(true)
                    try { await addToRequisition(open, book.lines, live) } finally { setBusy(false) }
                  }}>Add to requisition</Btn>
                  {addProblem?.id === open.id && (
                    <div role="alert"><Callout tone="warning" title="Not all of this quote is in your requisition">{addProblem.text}</Callout></div>
                  )}
                </>
              ) : standing.kind === 'held' ? (
                <span className="enq-muted">Already on requisition {standing.requisitionId}</span>
              ) : undefined} />
          )}
        </div>
      )}

      {pending && (
        <ActionDialog pending={pending} slots={book?.slots ?? []} today={today}
          clash={pending.action === 'accept' ? quoteBasketClash(req.basket, pending.enquiry.currency ?? currency ?? '', null) : null}
          onClose={() => setPending(null)}
          onAccept={async () => {
            const id = pending.enquiry.id
            const seen = (book?.lines ?? []).filter(l => l.enquiry_id === id)
            const r = await acceptQuote(id)
            if (!r.ok) return r
            setPending(null)
            /* Read back what was accepted rather than trusting the screen: the
               seller may have re-quoted since this page last loaded, and the
               database accepts whatever is quoted now. */
            const fresh = await reload()
            const now = fresh.book.lines.filter(l => l.enquiry_id === id)
            const e = fresh.book.enquiries.find(x => x.id === id)
            if (fresh.book.loadError || !e) {
              toast('The quote was accepted, but it could not be read back, so nothing was added. Open it again and use Add to requisition.', 'error')
              return r
            }
            if (quoteChanged(seen, now)) {
              toast('The seller updated the price before you accepted — review it. Nothing was added to your requisition.', 'error')
              return r
            }
            await addToRequisition(e, now, liveFrom(fresh.account))
            return r
          }}
          onDone={done} />
      )}
    </div>
  )
}

type Result = { ok: true } | { ok: false; error: string }

/* The buyer's confirmations and small forms, one dialog for each action. */
function ActionDialog({ pending, slots, clash, onClose, onAccept, onDone }: {
  pending: Pending
  slots: EnquiryBook['slots']
  today: string
  /* Why the quote's lines could not join the requisition as it stands. */
  clash: string | null
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
        {action === 'accept' && clash && <Callout tone="warning" title="Your requisition is in another currency">{clash}</Callout>}
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
