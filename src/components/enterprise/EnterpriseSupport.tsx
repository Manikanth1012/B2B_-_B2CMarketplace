import { useState, useEffect, useCallback } from 'react'
import { LifeBuoy, Plus, TriangleAlert as AlertTriangle, Pause, Send } from 'lucide-react'
import {
  StatCard, SectionCard, Table, Td, StatusPill, fmtInt, Btn, toast, Modal,
  FormField, TextArea, TextInput, Select, EmptyState,
} from '../operator/shared'
import { Callout } from '../OnboardingJourney'
import { loadAccount } from '../../lib/enterpriseRepo'
import type { AccountBook } from '../../lib/enterpriseRepo'
import { loadSupport, raiseTicket, replyToTicket, closeTicket } from '../../lib/supportRepo'
import type { SupportBook } from '../../lib/supportRepo'
import {
  queue, summarise, byCategory, standing, pastTarget, isOpen, duration,
  categoriesFor, priorityFor, respondTarget, waitingOn, STATE_LABEL,
} from '../../lib/support'
import type { Ticket } from '../../lib/support'

/* Support, as a shared inbox rather than a private one.
 *
 * A ticket belongs to the account, not to whoever happened to raise it — the
 * colleague picking it up next week is rarely the person who opened it, and a
 * queue only they can see is a queue that stalls when they are away.
 *
 * The number that makes the SLA honest is worked time: anything spent waiting
 * on the account does not count against the marketplace's target. It cuts both
 * ways and is worth saying out loud, because a queue measured on elapsed time
 * teaches a desk to close tickets rather than answer them.
 */

const NOW = new Date()

export function EnterpriseSupport() {
  const [book, setBook] = useState<SupportBook | null>(null)
  const [account, setAccount] = useState<AccountBook | null>(null)
  const [raising, setRaising] = useState(false)
  const [open, setOpen] = useState<string | null>(null)

  const reload = useCallback(async () => {
    const [s, a] = await Promise.all([loadSupport(), loadAccount()])
    setBook(s); setAccount(a)
  }, [])
  useEffect(() => { void reload() }, [reload])

  if (!book || !account) return <div style={{ textAlign: 'center', padding: '40px' }}><div className="spinner" style={{ margin: '0 auto' }} /></div>

  const rows = queue(book.tickets, NOW)
  const s = summarise(book.tickets, NOW)
  const late = book.tickets.filter(t => pastTarget(t, NOW))
  const waiting = book.tickets.filter(t => t.waiting_on_customer && isOpen(t))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '16px', flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontSize: 'var(--text-2xl)', fontWeight: 800, color: 'var(--text)' }}>Support</h1>
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)', marginTop: '4px' }}>
            {s.open} open · {s.past} past target · {s.resolved} resolved.
            Everyone on the account sees every ticket, whoever raised it.
          </p>
        </div>
        <Btn onClick={() => setRaising(true)}><Plus size={14} /> Raise a ticket</Btn>
      </div>

      {book.loadError && <Callout tone="danger" title="Some of this did not load">{book.loadError}</Callout>}

      {waiting.length > 0 ? (
        <Callout tone="warning" title={`${waiting.length} ticket${waiting.length === 1 ? ' is' : 's are'} waiting on you`}>
          The marketplace has asked a question and the clock is paused until somebody answers — so this is not
          counting against their target, and it is not moving either. {waiting.map(t => t.id).join(', ')}.
        </Callout>
      ) : late.length > 0 ? (
        <Callout tone="danger" title={`${late.length} ticket${late.length === 1 ? ' is' : 's are'} past the resolution target`}>
          {late[0].subject} has been escalated automatically — nobody had to remember to do it, which is the
          point of an SLA rather than a promise.
        </Callout>
      ) : (
        <Callout tone="success" title="Nothing is past target">
          Time spent waiting on you is not counted against the marketplace, and time spent waiting on them is.
        </Callout>
      )}

      <div className="stat-row">
        <StatCard label="Open" value={fmtInt(s.open)}
                  sublabel={s.unassigned ? `${s.unassigned} not picked up yet` : 'All assigned'}
                  color={s.open ? 'var(--brand-accent-dark)' : 'var(--success)'} />
        <StatCard label="Past target" value={fmtInt(s.past)}
                  sublabel={s.past ? 'Escalated automatically' : 'Everything inside its target'}
                  color={s.past ? 'var(--danger)' : 'var(--success)'} />
        <StatCard label="Waiting on you" value={fmtInt(s.waiting)}
                  sublabel="The clock is paused — not counted against them"
                  color={s.waiting ? 'var(--warning)' : undefined} />
        <StatCard label="Resolved" value={fmtInt(s.resolved)}
                  sublabel={s.medianWorked !== null ? `Median ${duration(s.medianWorked)} of worked time` : 'None yet'}
                  color="var(--success)" />
      </div>

      <SectionCard title="Your tickets"
                   subtitle="Worked first, then closest to target. Click a row to read the thread.">
        {rows.length === 0 ? <EmptyState message="Nothing raised on this account yet" /> : (
          <Table headers={['Ticket', 'Subject', 'Raised by', 'Priority', 'With', 'Against target', 'State']}>
            {rows.map(t => {
              const st = standing(t, NOW)
              return (
                <>
                  <tr key={t.id} onClick={() => setOpen(open === t.id ? null : t.id)} style={{ cursor: 'pointer' }}>
                    <Td>
                      <div style={{ fontWeight: 600 }}>{t.id}</div>
                      <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
                        {book.categories.find(c => c.id === t.category)?.label ?? t.category}
                      </div>
                    </Td>
                    <Td>
                      <div>{t.subject}</div>
                      {t.ref && <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>{t.ref}</div>}
                    </Td>
                    <Td right style={{ fontSize: 'var(--text-xs)' }}>{t.opened_by}</Td>
                    <Td right>
                      <span style={{
                        fontSize: 'var(--text-xs)', fontWeight: 700,
                        color: t.priority === 'P1' ? 'var(--danger)' : t.priority === 'P2' ? 'var(--warning)' : 'var(--text-secondary)',
                      }}>{t.priority}</span>
                    </Td>
                    <Td right style={{ fontSize: 'var(--text-xs)' }}>{waitingOn(t)}</Td>
                    <Td right style={{
                      fontSize: 'var(--text-xs)', maxWidth: '230px', textAlign: 'right',
                      /* A sentence in a right-aligned cell, which does not wrap by default. */
                      whiteSpace: 'normal',
                      color: st.state === 'over' ? 'var(--danger)' : st.state === 'paused' ? 'var(--warning)' : 'var(--text-tertiary)',
                    }}>{st.text}</Td>
                    <Td right>
                      <StatusPill status={
                        t.status === 'escalated' ? 'escalated'
                          : t.status === 'waiting' ? 'pending'
                            : t.status === 'resolved' || t.status === 'closed' ? 'resolved'
                              : t.status === 'new' ? 'open' : 'active'} />
                    </Td>
                  </tr>
                  {open === t.id && (
                    <tr key={`${t.id}-thread`}>
                      <td colSpan={7} style={{ padding: '14px 18px', background: 'var(--bg-alt)', borderBottom: '1px solid var(--border)' }}>
                        <Thread ticket={t} book={book} account={account} onDone={reload} />
                      </td>
                    </tr>
                  )}
                </>
              )
            })}
          </Table>
        )}
      </SectionCard>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '16px' }}>
        <SectionCard title="What you keep raising"
                     subtitle="A pattern here is worth a conversation with the account team rather than another ticket">
          <Table headers={['Category', 'Raised', 'Still open', 'Past target']}>
            {byCategory(book.tickets, book.categories, NOW).map(c => (
              <tr key={c.id}>
                <Td>{c.label}</Td>
                <Td right>{c.total}</Td>
                <Td right>{c.open || '—'}</Td>
                <Td right style={{ color: c.past ? 'var(--danger)' : undefined }}>{c.past || '—'}</Td>
              </tr>
            ))}
          </Table>
        </SectionCard>

        <SectionCard title="What the targets are"
                     subtitle="The same numbers the queue is measured against — not a separate promise">
          <Table headers={['Priority', 'What it means', 'First reply', 'Resolution']}>
            {book.sla.map(s2 => (
              <tr key={s2.priority}>
                <Td><strong>{s2.priority}</strong> {s2.label}</Td>
                <Td style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', maxWidth: '280px', lineHeight: 1.4 }}>{s2.meaning}</Td>
                <Td right>{duration(s2.respond_mins)}</Td>
                <Td right>{duration(s2.resolve_mins)}</Td>
              </tr>
            ))}
          </Table>
          <div style={{ padding: '12px 20px', fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', lineHeight: 1.6 }}>
            Time spent waiting on you is excluded from the resolution target. Without that the number would
            measure how quickly you reply to the marketplace rather than how quickly they fix things.
          </div>
        </SectionCard>
      </div>

      {raising && (
        <RaiseModal book={book} account={account}
                    onClose={() => setRaising(false)}
                    onDone={async () => { setRaising(false); await reload() }} />
      )}
    </div>
  )
}

function Thread({ ticket, book, account, onDone }: {
  ticket: Ticket; book: SupportBook; account: AccountBook; onDone: () => Promise<void>
}) {
  const [reply, setReply] = useState('')
  const [closing, setClosing] = useState(false)
  const [busy, setBusy] = useState(false)
  const me = account.me?.name ?? 'The account'

  const send = async () => {
    setBusy(true)
    const res = await replyToTicket(ticket, reply, me)
    setBusy(false)
    toast(res.ok ? res.note ?? 'Sent' : res.reason, res.ok ? 'success' : 'error')
    if (res.ok) { setReply(''); await onDone() }
  }

  const accept = async () => {
    setBusy(true)
    const res = await closeTicket(ticket, reply, me)
    setBusy(false)
    toast(res.ok ? res.note ?? 'Closed' : res.reason, res.ok ? 'success' : 'error')
    if (res.ok) { setReply(''); setClosing(false); await onDone() }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
      {ticket.messages.map((m, i) => (
        <div key={i} style={{
          padding: '10px 12px', borderRadius: 'var(--radius-md)',
          background: m.who === 'System' ? 'transparent' : 'var(--surface)',
          border: m.who === 'System' ? 'none' : '1px solid var(--border)',
          fontStyle: m.who === 'System' ? 'italic' : 'normal',
        }}>
          <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', fontWeight: 600 }}>
            {m.who} · {m.when}
          </div>
          <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', lineHeight: 1.5, marginTop: '2px' }}>{m.text}</div>
        </div>
      ))}

      {ticket.resolution_note && !isOpen(ticket) && (
        <Callout tone="success" title="How it was resolved">{ticket.resolution_note}</Callout>
      )}

      {isOpen(ticket) && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {ticket.waiting_on_customer && (
            <Callout tone="warning" title="This one is waiting on you">
              The clock is paused. Replying restarts it and puts the ticket back with the marketplace.
            </Callout>
          )}
          <TextArea rows={3} value={reply} onChange={e => setReply(e.target.value)}
                    placeholder={closing ? 'What resolved it? This is what anybody reading it later will see.' : 'Add to the thread…'} />
          <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
            {closing ? (
              <>
                <Btn variant="secondary" size="sm" onClick={() => setClosing(false)}>Cancel</Btn>
                <Btn variant="success" size="sm" onClick={accept} disabled={busy}>Close it</Btn>
              </>
            ) : (
              <>
                <Btn variant="secondary" size="sm" onClick={() => setClosing(true)}>This is resolved</Btn>
                <Btn size="sm" onClick={send} disabled={busy || !reply.trim()}><Send size={12} /> Reply</Btn>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function RaiseModal({ book, account, onClose, onDone }: {
  book: SupportBook; account: AccountBook; onClose: () => void; onDone: () => Promise<void>
}) {
  const cats = categoriesFor(book.categories, 'enterprise')
  const [category, setCategory] = useState(cats[0]?.id ?? 'other')
  const [subject, setSubject] = useState('')
  const [note, setNote] = useState('')
  const [ref, setRef] = useState('')
  const [busy, setBusy] = useState(false)

  const priority = priorityFor(category, book.categories)
  const chosen = book.categories.find(c => c.id === category)
  const respond = respondTarget(priority, book.sla)

  const submit = async () => {
    setBusy(true)
    const res = await raiseTicket({
      draft: { subject, category, note, ref: ref.trim() || null },
      book, persona: 'enterprise',
      raisedBy: account.me?.name ?? 'The account',
      org: account.account?.company ?? 'Enterprise',
      accountId: account.account?.id ?? null,
      memberId: account.me?.id ?? null,
      channel: 'Enterprise portal',
    })
    setBusy(false)
    toast(res.ok ? res.note ?? 'Raised' : res.reason, res.ok ? 'success' : 'error')
    if (res.ok) await onDone()
  }

  return (
    <Modal open onClose={onClose} title="Raise a ticket"
      footer={<>
        <Btn variant="secondary" size="sm" onClick={onClose}>Cancel</Btn>
        <Btn size="sm" onClick={submit} disabled={busy}>{busy ? 'Raising…' : 'Raise it'}</Btn>
      </>}>
      <FormField label="What is it about" required hint={chosen?.hint}>
        <Select value={category} onChange={e => setCategory(e.target.value)}>
          {cats.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
        </Select>
      </FormField>

      <FormField label="Subject" required hint="A queue is triaged on this line before anybody opens it">
        <TextInput value={subject} onChange={e => setSubject(e.target.value)}
                   placeholder="e.g. Twelve occupancy sensors will not pair with the gateway" />
      </FormField>

      <FormField label="What is happening" required
                 hint="The first person to read this has only what you write here">
        <TextArea rows={4} value={note} onChange={e => setNote(e.target.value)} />
      </FormField>

      <FormField label="Reference" hint="An order, invoice, subscription or refund it is about — optional but it saves a round trip">
        <TextInput value={ref} onChange={e => setRef(e.target.value)} placeholder="e.g. INV-2026-0781" />
      </FormField>

      <Callout tone="info" title={`This will be raised as ${priority}`}>
        The priority comes from what it is about rather than from who is asking — otherwise everything becomes
        a P1 within a week. First reply within {duration(respond)}, resolved or escalated inside{' '}
        {duration(book.sla.find(s => s.priority === priority)?.resolve_mins ?? 1440)} of worked time.
        Everyone on {account.account?.company ?? 'the account'} will be able to see it.
      </Callout>
    </Modal>
  )
}

export { LifeBuoy, AlertTriangle, Pause }
