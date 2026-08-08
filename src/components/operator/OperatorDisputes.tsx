import { useState, useEffect, useCallback, useMemo } from 'react'
import { Scale, TriangleAlert, Clock, Banknote } from 'lucide-react'
import {
  SectionCard, StatCard, EmptyState, Btn, StatusPill, Table, Td, toast,
  Modal, FormField, TextArea, Select, fmtInt,
} from './shared'
import { Callout } from '../OnboardingJourney'
import { loadDisputeBook, closeDispute, reassign, addDetail } from '../../lib/disputesRepo'
import type { DisputeBook } from '../../lib/disputesRepo'
import {
  KIND_LABEL, KIND_PARTIES, STATUS_LABEL, STATUS_TONE, OUTCOME_LABEL, isClosed,
  clockLine, isLate, withholding, pressureLine, workQueue, atStake, canClose,
  closingEffect, outcomesFor, record, disputeProblems, line,
} from '../../lib/disputes'
import type { DisputeRow, DisputeKind, DisputeOutcome } from '../../lib/disputes'
import { formatGroups } from '../../lib/money'
import { useMarket } from '../../lib/MarketContext'

/* One desk, four kinds of argument.
 *
 * An enterprise could dispute an invoice, a seller could dispute a statement or
 * a note, and a buyer could dispute an order — and only the last of those was a
 * record anybody could work. `disputeInvoice` wrote `status = 'disputed'` and a
 * sentence, and nothing anywhere read it: no owner, no clock, no outcome, no way
 * to answer. Zero invoices were disputed, which reads as buyers being happy and
 * was really the button leading nowhere.
 *
 * The queue is ordered on who is out of pocket while the argument runs, not on
 * age and not on amount. A seller whose statement is disputed is not being paid
 * at all; an account disputing an invoice is holding its own money. Both matter
 * and only one is bleeding, and a desk that sorts by date works them in the
 * wrong order every time.
 */

const ACTOR_DAYS = { seller: 5, marketplace: 3, buyer: 7 } as const

export function OperatorDisputes() {
  const [book, setBook] = useState<DisputeBook | null>(null)
  const [tab, setTab] = useState<'queue' | 'closed'>('queue')
  const [open, setOpen] = useState<string | null>(null)

  const reload = useCallback(async () => setBook(await loadDisputeBook()), [])
  useEffect(() => { void reload() }, [reload])

  if (!book) {
    return <div style={{ textAlign: 'center', padding: '40px' }}><div className="spinner" style={{ margin: '0 auto' }} /></div>
  }
  if (book.loadError) {
    return <Callout tone="danger" title="The dispute book did not load">{book.loadError}</Callout>
  }

  const today = new Date().toISOString().slice(0, 10)
  const problems = disputeProblems(book.disputes, book.flagged)
  const opened = book.disputes.find(d => d.id === open) ?? null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div>
        <h1 style={{ fontSize: 'var(--text-2xl)', fontWeight: 800, color: 'var(--text)' }}>Disputes</h1>
        <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)', marginTop: '4px', maxWidth: '82ch' }}>
          Money in limbo with somebody waiting for an answer — a buyer against a seller on an order,
          an account against us on an invoice, a seller against us on a statement or an adjustment.
          Not tickets: a ticket is a question, a dispute holds money and has a clock on it.
        </p>
      </div>

      {problems.length > 0 && (
        <Callout tone="danger" title={`${problems.length} case${problems.length === 1 ? '' : 's'} disagree with their own source`}>
          <ul style={{ margin: 0, paddingLeft: '18px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
            {problems.map((p, i) => <li key={i} style={{ fontSize: 'var(--text-xs)', lineHeight: 1.6 }}>{p}</li>)}
          </ul>
        </Callout>
      )}

      <Stakes book={book} today={today} />

      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
        {([['queue', 'Open'], ['closed', 'Decided']] as const).map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)}
            style={{
              padding: '7px 14px', borderRadius: 'var(--radius-md)', fontSize: 'var(--text-sm)',
              fontWeight: 600, cursor: 'pointer',
              border: `1px solid ${tab === id ? 'var(--primary)' : 'var(--border)'}`,
              background: tab === id ? 'var(--primary-soft)' : 'var(--surface)',
              color: tab === id ? 'var(--primary)' : 'var(--text-secondary)',
            }}>{label}</button>
        ))}
      </div>

      {tab === 'queue' && <Queue book={book} today={today} onOpen={setOpen} />}
      {tab === 'closed' && <Decided book={book} />}

      {opened && (
        <Detail dispute={opened} book={book} today={today}
          onClose={() => setOpen(null)} onChanged={reload} />
      )}
    </div>
  )
}

/* ---------------------------------------------------------------- at stake -- */

function Stakes({ book, today }: { book: DisputeBook; today: string }) {
  const { fmtIn } = useMarket()
  const s = atStake(book.disputes, today)
  const r = record(book.disputes)

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px' }}>
      {/* Somebody's payroll, reported on its own. This is the figure that
          decides whether the queue is urgent, and it is invisible everywhere
          else in the console. */}
      <StatCard label="Withheld while it runs" value={formatGroups(s.withheld, fmtIn)}
        sublabel={s.bleeding === 0 ? 'Nobody is unpaid' : `${fmtInt(s.bleeding)} not being paid`}
        color={s.bleeding > 0 ? 'var(--danger)' : undefined} />
      <StatCard label="Claimed, not withheld" value={formatGroups(s.claimed, fmtIn)}
        sublabel="Real exposure, nobody short" />
      <StatCard label="Past their promise" value={fmtInt(s.late)}
        sublabel={`of ${fmtInt(s.open)} open`}
        color={s.late > 0 ? 'var(--warning)' : undefined} />
      <StatCard label="Decided in our favour"
        value={r.upheldPct === null ? '—' : `${r.upheldPct}%`}
        sublabel={r.medianDays === null
          ? `${fmtInt(r.closed)} closed`
          : `${fmtInt(r.closed)} closed, ${r.medianDays} days typical`} />
    </div>
  )
}

/* ------------------------------------------------------------------ the queue -- */

function Queue({ book, today, onOpen }: {
  book: DisputeBook; today: string; onOpen: (id: string) => void
}) {
  const { fmtIn } = useMarket()
  const [kind, setKind] = useState<'all' | DisputeKind>('all')

  const rows = useMemo(() => {
    const live = book.disputes.filter(d => !isClosed(d))
    return workQueue(kind === 'all' ? live : live.filter(d => d.kind === kind), today)
  }, [book.disputes, kind, today])

  if (book.disputes.filter(d => !isClosed(d)).length === 0) {
    return (
      <SectionCard title="Nothing is being argued about"
        subtitle="No order, invoice, statement or adjustment is in dispute.">
        <EmptyState message="Nothing open." />
      </SectionCard>
    )
  }

  return (
    <SectionCard title="Who is waiting, and who is out of pocket"
      subtitle="Ordered by who is not being paid while the argument runs — not by age and not by size. A seller whose statement is disputed gets nothing until somebody decides; an account disputing an invoice is holding its own money."
      action={
        <Select value={kind} onChange={e => setKind(e.target.value as typeof kind)} style={{ width: 'auto' }}>
          <option value="all">Every kind</option>
          <option value="order">Orders</option>
          <option value="invoice">Invoices</option>
          <option value="statement">Statements</option>
          <option value="note">Adjustments</option>
        </Select>
      }>
      {rows.length === 0
        ? <EmptyState message="Nothing open of that kind." />
        : (
          <Table headers={['Case', 'What is being argued', { label: 'At stake', align: 'right' }, 'Clock', { label: '', align: 'right' }]}>
            {rows.map(d => (
              <tr key={d.id}>
                <Td>
                  <strong style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)' }}>{d.id}</strong>
                  <div style={{ fontSize: '10px', color: 'var(--text-tertiary)', marginTop: '2px' }}>
                    {KIND_LABEL[d.kind]}
                  </div>
                  <div style={{ marginTop: '3px' }}>
                    <StatusPill status={STATUS_TONE[d.status]} label={STATUS_LABEL[d.status]} />
                  </div>
                </Td>

                <Td style={{ maxWidth: '48ch' }}>
                  <div style={{ fontSize: 'var(--text-xs)', fontWeight: 600 }}>{line(d)}</div>
                  <div style={{ fontSize: '10px', color: 'var(--text-tertiary)', marginTop: '2px' }}>
                    {KIND_PARTIES[d.kind]}
                  </div>
                  {d.detail && (
                    <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', marginTop: '4px', lineHeight: 1.5, whiteSpace: 'pre-line' }}>
                      {d.detail.length > 220 ? `${d.detail.slice(0, 220)}…` : d.detail}
                    </div>
                  )}
                </Td>

                <Td right>
                  <strong style={{ color: withholding(d) ? 'var(--danger)' : undefined }}>
                    {fmtIn(d.amount, d.currency)}
                  </strong>
                  <div style={{ fontSize: '10px', color: 'var(--text-tertiary)', maxWidth: '24ch', lineHeight: 1.4, marginTop: '2px' }}>
                    {pressureLine(d)}
                  </div>
                </Td>

                <Td style={{ maxWidth: '20ch' }}>
                  <div style={{
                    fontSize: 'var(--text-xs)', lineHeight: 1.5,
                    color: isLate(d, today) ? 'var(--danger)' : 'var(--text-secondary)',
                    fontWeight: isLate(d, today) ? 700 : 400,
                  }}>
                    {clockLine(d, today)}
                  </div>
                  <div style={{ fontSize: '10px', color: 'var(--text-tertiary)', marginTop: '2px' }}>
                    with the {d.owner}
                  </div>
                </Td>

                <Td right><Btn size="sm" onClick={() => onOpen(d.id)}>Work it</Btn></Td>
              </tr>
            ))}
          </Table>
        )}
    </SectionCard>
  )
}

/* --------------------------------------------------------------- what was decided -- */

function Decided({ book }: { book: DisputeBook }) {
  const { fmtIn } = useMarket()
  const rows = book.disputes.filter(isClosed)
    .sort((a, b) => (b.resolved_on ?? '').localeCompare(a.resolved_on ?? ''))

  if (rows.length === 0) return <SectionCard title="Nothing decided yet"><EmptyState message="No closed disputes." /></SectionCard>

  return (
    <SectionCard title="What was decided, and why"
      subtitle="The record somebody reads when the same buyer raises the same claim again, and when a seller asks why they were charged for one and not the other.">
      <Table headers={['Case', 'What was argued', { label: 'Amount', align: 'right' }, 'Outcome', 'The answer given']}>
        {rows.map(d => (
          <tr key={d.id}>
            <Td>
              <strong style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)' }}>{d.id}</strong>
              <div style={{ fontSize: '10px', color: 'var(--text-tertiary)' }}>
                {d.raised} → {d.resolved_on ?? '—'}
              </div>
            </Td>
            <Td style={{ maxWidth: '38ch' }}>
              <div style={{ fontSize: 'var(--text-xs)' }}>{line(d)}</div>
              <div style={{ fontSize: '10px', color: 'var(--text-tertiary)' }}>{KIND_LABEL[d.kind]}</div>
            </Td>
            <Td right>{fmtIn(d.amount, d.currency)}</Td>
            <Td>
              <StatusPill status={STATUS_TONE[d.status]} label={STATUS_LABEL[d.status]} />
              <div style={{ fontSize: '10px', color: 'var(--text-tertiary)', marginTop: '2px', maxWidth: '20ch', lineHeight: 1.4 }}>
                {d.outcome ? OUTCOME_LABEL[d.outcome] : 'No outcome recorded'}
              </div>
            </Td>
            <Td style={{ maxWidth: '52ch' }}>
              <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                {d.resolution ?? '—'}
              </span>
            </Td>
          </tr>
        ))}
      </Table>
    </SectionCard>
  )
}

/* -------------------------------------------------------------------- working one -- */

function Detail({ dispute, book, today, onClose, onChanged }: {
  dispute: DisputeRow; book: DisputeBook; today: string
  onClose: () => void; onChanged: () => Promise<void>
}) {
  const { fmtIn } = useMarket()
  const [outcome, setOutcome] = useState<DisputeOutcome | ''>('')
  const [answer, setAnswer] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  const subject = book.subjects.find(s => s.kind === dispute.kind && s.ref === dispute.subject_ref) ?? null
  const check = canClose(dispute, outcome || null, answer)

  const run = async (fn: () => Promise<{ ok: boolean; why?: string }>, good: string) => {
    setBusy(true)
    const r = await fn()
    setBusy(false)
    toast(r.ok ? good : (r.why ?? 'That did not go through'), r.ok ? 'success' : 'error')
    if (r.ok) { await onChanged(); onClose() }
  }

  return (
    <Modal open title={`${dispute.id} — ${KIND_LABEL[dispute.kind].toLowerCase()}`} onClose={onClose}
      footer={<Btn variant="secondary" size="sm" onClick={onClose}>Close</Btn>}>

      <Callout tone={withholding(dispute) ? 'danger' : 'info'}
               title={withholding(dispute) ? 'Somebody is not being paid' : 'Nothing is being withheld'}>
        <div style={{ lineHeight: 1.6 }}>{pressureLine(dispute)}</div>
        <div style={{ marginTop: '3px', opacity: 0.85 }}>{clockLine(dispute, today)}</div>
      </Callout>

      <div style={{ margin: '14px 0' }}>
        <div style={{ fontSize: 'var(--text-sm)', fontWeight: 700 }}>{dispute.reason}</div>
        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', marginTop: '2px' }}>
          {KIND_PARTIES[dispute.kind]} Raised by {dispute.claimant} on {dispute.raised}.
        </div>
        {dispute.detail && (
          <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', marginTop: '8px', lineHeight: 1.65, whiteSpace: 'pre-line' }}>
            {dispute.detail}
          </div>
        )}
      </div>

      {/* What is actually being argued about, resolved so nobody has to leave
          the case to find out what it was. */}
      <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: '11px 13px', marginBottom: '14px' }}>
        <div style={{ fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text-tertiary)' }}>
          {KIND_LABEL[dispute.kind]}
        </div>
        {subject
          ? <>
              <div style={{ fontSize: 'var(--text-sm)', fontWeight: 600, marginTop: '3px' }}>
                {subject.ref} — {subject.who}
              </div>
              <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', lineHeight: 1.5 }}>
                {subject.what}
              </div>
              <div style={{ fontSize: 'var(--text-xs)', marginTop: '4px' }}>
                Worth {fmtIn(subject.amount, subject.currency)} and currently <strong>{subject.state}</strong>.
                {' '}The claim is {fmtIn(dispute.amount, dispute.currency)}
                {subject.amount > 0 && (
                  <> — {Math.round((dispute.amount / subject.amount) * 100)}% of it.</>
                )}
              </div>
            </>
          : <div style={{ fontSize: 'var(--text-xs)', color: 'var(--danger)', marginTop: '3px' }}>
              {dispute.subject_ref} could not be found. A case pointing at nothing cannot be worked.
            </div>}
      </div>

      {!isClosed(dispute) && (
        <>
          <div style={{ fontSize: 'var(--text-sm)', fontWeight: 700, marginBottom: '6px' }}>Hand it on</div>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '16px' }}>
            {(['seller', 'marketplace', 'buyer'] as const).map(who => (
              <Btn key={who} size="sm" variant="secondary"
                   disabled={busy || dispute.owner === who}
                   title={dispute.owner === who ? `It is already with the ${who}.` : `Gives them ${ACTOR_DAYS[who]} days.`}
                   onClick={() => void run(() => reassign(dispute.id, who, ACTOR_DAYS[who]),
                                           `${dispute.id} is with the ${who}, due in ${ACTOR_DAYS[who]} days.`)}>
                To the {who}
              </Btn>
            ))}
          </div>

          <FormField label="Add what you have found"
                     hint="Stamped and appended. This is what somebody reads when the same claim comes back.">
            <TextArea rows={2} value={note} onChange={e => setNote(e.target.value)} />
          </FormField>
          <div style={{ marginTop: '-8px', marginBottom: '16px' }}>
            <Btn size="sm" variant="secondary" disabled={busy || !note.trim()}
                 onClick={() => void run(() => addDetail(dispute.id, note), 'Added to the case.')}>
              Add it
            </Btn>
          </div>

          <div style={{ borderTop: '1px solid var(--border)', paddingTop: '14px' }}>
            <div style={{ fontSize: 'var(--text-sm)', fontWeight: 700, marginBottom: '6px' }}>Decide it</div>

            <FormField label="Which way it went" required
                       hint="Without an outcome nobody can tell who paid.">
              <Select value={outcome} onChange={e => setOutcome(e.target.value as DisputeOutcome | '')}>
                <option value="">Choose…</option>
                {outcomesFor(dispute.kind).map(o => (
                  <option key={o} value={o}>{OUTCOME_LABEL[o]}</option>
                ))}
              </Select>
            </FormField>

            {outcome && (
              <Callout tone="info" title="What deciding it will do">
                {closingEffect(dispute, outcome)}
              </Callout>
            )}

            <div style={{ marginTop: '12px' }}>
              <FormField label="The answer" required
                         hint={`${dispute.claimant} raised this and is owed an answer, whichever way it goes.`}>
                <TextArea rows={4} value={answer} onChange={e => setAnswer(e.target.value)} />
              </FormField>
            </div>

            <Btn size="sm" disabled={busy || !check.ok}
                 title={check.ok ? undefined : check.reason}
                 onClick={() => void run(() => closeDispute(dispute.id, outcome as DisputeOutcome, answer),
                                         `${dispute.id} decided.`)}>
              {busy ? 'Saving…' : 'Decide it'}
            </Btn>
            {!check.ok && (
              <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', marginTop: '6px', lineHeight: 1.6 }}>
                {check.reason}
              </div>
            )}
          </div>
        </>
      )}

      {isClosed(dispute) && (
        <div style={{ borderTop: '1px solid var(--border)', paddingTop: '14px' }}>
          <div style={{ fontSize: 'var(--text-sm)', fontWeight: 700 }}>
            {dispute.outcome ? OUTCOME_LABEL[dispute.outcome] : 'Closed'}
          </div>
          <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', marginTop: '4px', lineHeight: 1.65 }}>
            {dispute.resolution}
          </div>
        </div>
      )}
    </Modal>
  )
}
