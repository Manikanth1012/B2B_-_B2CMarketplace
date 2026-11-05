/* The seller's enquiries: the quotes and demos asked of their listings. */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Dialog } from '../ui/Dialog'
import { Btn, FormField, TextArea, fmtDateTime } from '../operator/shared'
import { Callout } from '../OnboardingJourney'
import { EnquiryList } from '../enquiries/EnquiryList'
import { EnquiryDetail } from '../enquiries/EnquiryDetail'
import type { ActionPayload, ActionResult } from '../enquiries/EnquiryDetail'
import { QuoteResponseForm } from '../enquiries/QuoteResponseForm'
import { SlotResponseForm } from '../enquiries/SlotResponseForm'
import type { Action } from '../../lib/enquiries'
import type { Chip, TypeFilter } from '../../lib/enquiryList'
import { loadEnquiries, sendQuote, decline, markDone, confirmSlot, proposeSlot, reply } from '../../lib/enquiryRepo'
import type { EnquiryBook } from '../../lib/enquiryRepo'
import { supabase } from '../../lib/supabase'
import { useMarket } from '../../lib/MarketContext'

const EMPTY: EnquiryBook = { enquiries: [], lines: [], slots: [], messages: [], events: [], loadError: null }

function today(): string {
  const n = new Date()
  const p = (x: number) => String(x).padStart(2, '0')
  return `${n.getFullYear()}-${p(n.getMonth() + 1)}-${p(n.getDate())}`
}

type Form = { kind: 'quote' } | { kind: 'decline' } | { kind: 'confirm'; slotId: string } | { kind: 'propose' } | null

export function PartnerEnquiries({ partnerId }: { partnerId: string }) {
  const { fmtIn } = useMarket()
  const [book, setBook] = useState<EnquiryBook>(EMPTY)
  const [floors, setFloors] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [chip, setChip] = useState<Chip>('mine')
  const [type, setType] = useState<TypeFilter>('all')
  const [query, setQuery] = useState('')
  const [openId, setOpenId] = useState<string | null>(null)
  const [form, setForm] = useState<Form>(null)
  const [reason, setReason] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const day = today()

  const reload = useCallback(async () => {
    const b = await loadEnquiries()
    setBook(b)
    setLoading(false)
    /* The seller's agreed floors, read from their own listings; if the read
       fails the quote form simply shows no floor warning. */
    const ids = [...new Set(b.lines.map(l => l.product_id))]
    if (ids.length) {
      try {
        const { data } = await supabase.from('products').select('id,floor_price').in('id', ids)
        const m: Record<string, number> = {}
        for (const r of (data ?? []) as { id: string; floor_price: number | null }[]) {
          if (typeof r.floor_price === 'number' && r.floor_price > 0) m[r.id] = r.floor_price
        }
        setFloors(m)
      } catch { setFloors({}) }
    }
  }, [])
  useEffect(() => { void reload() }, [reload, partnerId])

  const open = useMemo(() => book.enquiries.find(e => e.id === openId) ?? null, [book, openId])
  const openLines = useMemo(
    () => book.lines.filter(l => l.enquiry_id === openId).sort((a, b) => a.sort_order - b.sort_order), [book, openId])
  const money = useCallback((n: number, c: string) => fmtIn(n, c), [fmtIn])

  const close = () => { setForm(null); setFormError(null); setReason('') }
  const done = async (r: { ok: true } | { ok: false; error: string }): Promise<string | null> => {
    if (!r.ok) return r.error
    await reload()
    close()
    return null
  }

  const onAction = async (action: Action, payload?: ActionPayload): Promise<ActionResult> => {
    if (!open) return
    switch (action) {
      case 'quote': case 'requote': setForm({ kind: 'quote' }); return
      case 'decline': setForm({ kind: 'decline' }); return
      case 'propose-slot': setForm({ kind: 'propose' }); return
      case 'confirm-slot': if (payload?.slotId) setForm({ kind: 'confirm', slotId: payload.slotId }); return
      case 'mark-done': {
        setBusy(true)
        const r = await markDone(open.id)
        setBusy(false)
        if (!r.ok) return r
        await reload(); return
      }
      case 'reply': {
        const r = await reply(open.id, payload?.body ?? '')
        if (!r.ok) return r
        await reload(); return
      }
      default: return
    }
  }

  const slot = form?.kind === 'confirm' ? book.slots.find(s => s.id === form.slotId) : undefined

  return (
    <div className="enq">
      <h1 style={{ fontSize: 'var(--text-2xl)', fontWeight: 800, color: 'var(--text)' }}>Enquiries</h1>
      {book.loadError && (
        <Callout tone="warning" title="Enquiries could not be loaded">
          {book.loadError} Nothing here has been lost; try again shortly.
        </Callout>
      )}
      {loading ? <p className="enq-muted" role="status">Loading enquiries…</p> : (
        <>
          <EnquiryList enquiries={book.enquiries} role="responder" today={day}
            chip={chip} onChip={setChip} type={type} onType={setType} query={query} onQuery={setQuery}
            onOpen={id => { setOpenId(id); close() }} openId={openId}
            answerer={() => 'You'} title="Quotes and demos asked of your listings"
            subtitle="Open one to answer it." />
          {open && (
            <EnquiryDetail key={open.id} enquiry={open} book={book} role="responder" today={day}
              opts={{ isDesk: false }} onAction={onAction} answerer="You" money={money} busy={busy} />
          )}
        </>
      )}

      <Dialog open={form?.kind === 'quote' && !!open} onClose={close} title="Send a quote" wide>
        {open && <QuoteResponseForm enquiry={open} lines={openLines} today={day} floors={floors} money={money}
          onCancel={close}
          onSubmit={async (prices, until, note) => done(await sendQuote(open.id, prices, until, note || null))} />}
      </Dialog>

      <Dialog open={form?.kind === 'decline' && !!open} onClose={close} title="Decline this enquiry">
        <form className="enq-resp" onSubmit={async ev => {
          ev.preventDefault()
          if (!open) return
          if (!reason.trim()) { setFormError('Say why, so the buyer knows what to do next.'); return }
          setBusy(true); setFormError(null)
          const err = await done(await decline(open.id, reason.trim()))
          setBusy(false)
          if (err) setFormError(err)
        }} noValidate>
          <FormField label="Reason" required>
            <TextArea rows={3} value={reason} onChange={e => setReason(e.target.value)}
              aria-invalid={formError ? true : undefined} />
          </FormField>
          {formError && <p className="enq-error" role="alert">{formError}</p>}
          <div className="enq-actions">
            <Btn type="button" variant="secondary" onClick={close} disabled={busy}>Keep it open</Btn>
            <Btn type="submit" variant="danger" disabled={busy}>{busy ? 'Declining…' : 'Decline'}</Btn>
          </div>
        </form>
      </Dialog>

      <Dialog open={form?.kind === 'confirm' && !!slot} onClose={close} title="Confirm a time">
        {slot && <SlotResponseForm mode="confirm" when={fmtDateTime(slot.starts_at)} location={slot.location}
          onCancel={close} onSubmit={async v => done(await confirmSlot(slot.id, v.location))} />}
      </Dialog>

      <Dialog open={form?.kind === 'propose' && !!open} onClose={close} title="Suggest another time">
        {open && <SlotResponseForm mode="propose" onCancel={close}
          onSubmit={async v => done(await proposeSlot(open.id, v.startsAt!, v.location))} />}
      </Dialog>
    </div>
  )
}
