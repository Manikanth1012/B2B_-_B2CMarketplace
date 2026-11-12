/* One enquiry, read in full, shared by the three consoles.
 *
 * The action bar renders exactly what `nextActions` returns for this role, and
 * nothing else: the screen never offers what the database would refuse. Every
 * button goes through one `onAction(action, payload)` callback; the console
 * decides whether that opens a form (a decline reason, a price per line) or
 * goes straight to the repository. `reply` is the one action answered here,
 * by the composer at the foot of the conversation.
 */
import { useState } from 'react'
import type React from 'react'
import { Send, CalendarPlus } from 'lucide-react'
import { demoInvite, quoteExpiryInvite } from '../../lib/calendarInvite'
import { fmtDbDate, validUntilLabel } from '../../lib/dbDay'
import { downloadIcs } from './downloadIcs'
import { Table, Td, StatusPill, Btn, TextArea, FormField, EmptyState, fmtDate, fmtDateTime, fmtInt } from '../operator/shared'
import { enquiryState, nextActions, quoteTotals } from '../../lib/enquiries'
import type { Action, Enquiry, EnquiryLine, EnquiryMessage, EnquirySlot, Role } from '../../lib/enquiries'
import type { EnquiryEvent } from '../../lib/enquiryRepo'
import { TYPE_LABEL } from '../../lib/enquiryList'

export interface ActionPayload {
  /** For `reply`: what was written. */
  body?: string
  /** For `confirm-slot`: the open time proposed by the other side, latest first. */
  slotId?: string
}

export type ActionResult = { ok: true } | { ok: false; error: string } | void

export interface EnquiryDetailProps {
  enquiry: Enquiry
  /** The book, or the slice of it this enquiry needs; rows are filtered by enquiry id here. */
  book: { lines: readonly EnquiryLine[]; slots: readonly EnquirySlot[]; messages: readonly EnquiryMessage[]; events: readonly EnquiryEvent[] }
  role: Role
  today: string
  /** Passed to nextActions with this enquiry's slots added. */
  opts?: { canRaise?: boolean; isDesk?: boolean }
  onAction: (action: Action, payload?: ActionPayload) => ActionResult | Promise<ActionResult>
  /** Who answers it, in words. */
  answerer: string
  money: (n: number, currency: string) => string
  /** Anything a console adds beside the actions (the buyer's "Add to requisition again"). */
  extra?: React.ReactNode
  /** Disables the bar while the console is working. */
  busy?: boolean
}

const LABEL: Record<Action, string> = {
  quote: 'Send a quote',
  requote: 'Send a new quote',
  accept: 'Accept the quote',
  decline: 'Decline',
  withdraw: 'Withdraw',
  'confirm-slot': 'Confirm a time',
  'propose-slot': 'Suggest another time',
  'mark-done': 'Mark the demo done',
  reply: 'Reply',
  close: 'Close',
  reassign: 'Reassign',
}

const VARIANT: Partial<Record<Action, 'primary' | 'secondary' | 'danger' | 'success'>> = {
  quote: 'primary', requote: 'primary', accept: 'success', 'confirm-slot': 'primary',
  'mark-done': 'primary', decline: 'danger', withdraw: 'danger',
}

const FORMAT: Record<string, string> = { video: 'Video call', onsite: 'On site' }
const CONTACT: Record<string, string> = { email: 'Email', phone: 'Phone', in_app: 'Here, in the console' }

export function EnquiryDetail({ enquiry: e, book, role, today, opts, onAction, answerer, money, extra, busy }: EnquiryDetailProps) {
  const lines = book.lines.filter(l => l.enquiry_id === e.id).slice().sort((a, b) => a.sort_order - b.sort_order)
  const slots = book.slots.filter(s => s.enquiry_id === e.id)
  const messages = book.messages.filter(m => m.enquiry_id === e.id)
  const events = book.events.filter(ev => ev.enquiry_id === e.id)
  const state = enquiryState(e, today)
  const actions = nextActions(e, role, today, { ...opts, slots })
  const bar = actions.filter(a => a !== 'reply')
  const canReply = actions.includes('reply')
  const totals = e.type === 'quote' ? quoteTotals(lines) : null
  const cur = e.currency ?? ''

  /* The time a confirm would confirm: the latest open one the other side put forward. */
  const mySide = role === 'buyer' ? 'buyer' : 'responder'
  const offered = slots.filter(s => !s.confirmed && s.proposed_by !== mySide)
  const toConfirm = offered[offered.length - 1]

  /* A scheduled demo (its confirmed time) or a sent, still-valid quote (its expiry) can go into a calendar. */
  const confirmed = slots.find(s => s.confirmed)
  const invite =
    e.type === 'demo' && e.status === 'scheduled' && confirmed
      ? { summary: `Demo: ${e.subject}`, text: () => demoInvite({
          enquiryId: e.id, updatedAt: e.updated_at, summary: `Demo: ${e.subject}`,
          description: `${FORMAT[e.format ?? ''] ?? 'Demo'} (enquiry ${e.id})`, location: confirmed.location ?? undefined, startsAt: confirmed.starts_at }) }
      : e.type === 'quote' && (e.status === 'quoted' || e.status === 'accepted') && e.valid_until && state !== 'expired'
        ? { summary: `Quote expires: ${e.subject}`, text: () => quoteExpiryInvite({
            enquiryId: e.id, updatedAt: e.updated_at, summary: `Quote expires: ${e.subject}`,
            description: `The quote for ${e.subject} (enquiry ${e.id}) is valid until ${fmtDbDate(e.valid_until!)} (UTC).`, validUntil: e.valid_until! }) }
        : null
  const addToCalendar = () => { if (invite) downloadIcs(`${e.id}.ics`, invite.text()) }

  const [body, setBody] = useState('')
  const [sending, setSending] = useState(false)
  const [replyError, setReplyError] = useState<string | null>(null)
  const send = async () => {
    if (!body.trim()) { setReplyError('Write something before sending it.'); return }
    setSending(true); setReplyError(null)
    const r = await onAction('reply', { body: body.trim() })
    setSending(false)
    if (r && !r.ok) { setReplyError(r.error); return }
    setBody('')
  }

  return (
    <article className="enq-detail" aria-labelledby={`enq-${e.id}-title`}>
      <header className="enq-detail__head">
        <div>
          <p className="enq-detail__kicker">{TYPE_LABEL[e.type]} enquiry · {e.id}</p>
          <h2 id={`enq-${e.id}-title`} className="enq-detail__title">{e.subject}</h2>
        </div>
        <StatusPill status={state} />
      </header>

      <dl className="enq-facts">
        <div><dt>Answered by</dt><dd>{answerer}</dd></div>
        <div><dt>Raised</dt><dd>{fmtDate(e.created_at)}</dd></div>
        <div><dt>Last update</dt><dd>{fmtDateTime(e.updated_at)}</dd></div>
        {e.type === 'quote' && <div><dt>Needed by</dt><dd>{fmtDate(e.needed_by)}</dd></div>}
        {e.type === 'quote' && e.valid_until && (
          <div><dt>Quote valid until</dt><dd>{validUntilLabel(e.valid_until)}{state === 'expired' ? ' (expired)' : ''}</dd></div>
        )}
        {invite && (
          <div className="enq-facts__wide">
            <Btn variant="secondary" style={{ minHeight: 44 }} onClick={addToCalendar} aria-label={`Add to calendar: ${invite.summary}`}>
              <CalendarPlus size={14} aria-hidden="true" /> Add to calendar
            </Btn>
          </div>
        )}
        {e.type === 'demo' && <div><dt>Format</dt><dd>{e.format ? FORMAT[e.format] : '—'}</dd></div>}
        {e.type === 'demo' && <div><dt>Attendees</dt><dd>{e.attendees ?? '—'}</dd></div>}
        {e.type === 'sales' && <div><dt>Reply by</dt><dd>{e.contact_pref ? CONTACT[e.contact_pref] : '—'}</dd></div>}
        {e.decline_reason && <div className="enq-facts__wide"><dt>Why it was declined</dt><dd>{e.decline_reason}</dd></div>}
      </dl>

      {e.type !== 'sales' && (
        <section className="enq-detail__part" aria-label="Lines">
          <h3 className="enq-detail__h">{e.type === 'quote' ? 'What is being quoted' : 'What the demo is of'}</h3>
          {lines.length === 0 ? <EmptyState message="No lines on this enquiry." /> : (
            <Table headers={e.type === 'quote'
              ? ['Item', 'Quantity', 'Target price', 'Quoted price', 'Line total']
              : ['Item', 'Quantity']}>
              {lines.map(l => {
                const t = totals?.lines.find(x => x.id === l.id)
                return e.type === 'quote' ? (
                  <tr key={l.id}>
                    <Td>{l.name}</Td>
                    <Td right>{fmtInt(l.quantity)}</Td>
                    <Td right>{l.target_unit_price === null ? '—' : money(l.target_unit_price, cur)}</Td>
                    <Td right>{l.quoted_unit_price === null ? 'Not yet' : money(l.quoted_unit_price, cur)}</Td>
                    <Td right>{t ? money(t.total, cur) : '—'}</Td>
                  </tr>
                ) : (
                  <tr key={l.id}><Td>{l.name}</Td><Td right>{fmtInt(l.quantity)}</Td></tr>
                )
              })}
              {totals && (
                <tr className="enq-total">
                  <Td>Total</Td><Td right>{''}</Td><Td right>{''}</Td><Td right>{''}</Td>
                  <Td right><strong>{money(totals.total, cur)}</strong></Td>
                </tr>
              )}
            </Table>
          )}
        </section>
      )}

      {e.type === 'demo' && (
        <section className="enq-detail__part" aria-label="Times">
          <h3 className="enq-detail__h">Times</h3>
          {slots.length === 0 ? <EmptyState message="No times proposed." /> : (
            <ul className="enq-slots">
              {slots.map(s => (
                <li key={s.id} className={`enq-slot${s.confirmed ? ' is-confirmed' : ''}`}>
                  <span className="enq-slot__when">{fmtDateTime(s.starts_at)}</span>
                  <span className="enq-slot__who">Proposed by {s.proposed_by === 'buyer' ? 'the buyer' : 'the seller'}</span>
                  {s.location && <span className="enq-slot__where">{s.location}</span>}
                  {s.confirmed && <StatusPill status="scheduled" label="Confirmed" />}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <section className="enq-detail__part" aria-label="Conversation">
        <h3 className="enq-detail__h">Conversation</h3>
        {messages.length === 0 ? <p className="enq-muted">Nothing has been said yet.</p> : (
          <ol className="enq-thread">
            {messages.map(m => (
              <li key={m.id} className={`enq-msg enq-msg--${m.author_role}`}>
                <div className="enq-msg__meta">{m.author_name} · {fmtDateTime(m.created_at)}</div>
                <div className="enq-msg__body">{m.body}</div>
              </li>
            ))}
          </ol>
        )}
        {canReply && (
          <div className="enq-reply">
            <FormField label="Reply">
              <TextArea rows={3} value={body} onChange={ev => setBody(ev.target.value)}
                aria-invalid={replyError ? true : undefined} />
            </FormField>
            {replyError && <p className="enq-error" role="alert">{replyError}</p>}
            <div className="enq-actions">
              <Btn variant="secondary" onClick={send} disabled={sending || busy}><Send size={14} aria-hidden="true" /> {sending ? 'Sending…' : 'Send'}</Btn>
            </div>
          </div>
        )}
      </section>

      {(bar.length > 0 || extra) && (
        <div className="enq-actions enq-actions--bar" role="group" aria-label="What you can do">
          {extra}
          {bar.map(a => (
            <Btn key={a} variant={VARIANT[a] ?? 'secondary'} disabled={busy}
              onClick={() => { void onAction(a, a === 'confirm-slot' && toConfirm ? { slotId: toConfirm.id } : undefined) }}>
              {a === 'decline' && e.type === 'quote' && role === 'buyer' ? 'Decline the quote' : LABEL[a]}
            </Btn>
          ))}
        </div>
      )}

      <section className="enq-detail__part" aria-label="History">
        <details className="enq-history">
          <summary><h3 className="enq-detail__h enq-detail__h--inline">History</h3></summary>
          {events.length === 0 ? <p className="enq-muted">No history recorded.</p> : (
            <ol className="enq-events">
              {events.map(ev => (
                <li key={ev.id}>
                  <span className="enq-events__at">{fmtDateTime(ev.at)}</span>{' '}
                  <strong>{ev.actor_name}</strong> {ev.action.replace(/_/g, ' ')}
                  {ev.from_status && ev.to_status && ev.from_status !== ev.to_status && ` (${ev.from_status} → ${ev.to_status})`}
                  {ev.note && <span className="enq-events__note"> — {ev.note}</span>}
                </li>
              ))}
            </ol>
          )}
        </details>
      </section>
    </article>
  )
}
