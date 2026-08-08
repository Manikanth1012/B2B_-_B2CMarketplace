import { useState, useEffect, useCallback, useMemo } from 'react'
import { FileText, TriangleAlert, Scale, ShieldCheck } from 'lucide-react'
import {
  SectionCard, StatCard, EmptyState, Btn, StatusPill, Table, Td, toast,
  Modal, FormField, TextInput, TextArea, Select,
} from './shared'
import { Callout } from '../OnboardingJourney'
import {
  loadNoteBook, raiseNote, approveNote, voidNote, applyToStatement, resolveDispute,
} from '../../lib/creditNotesRepo'
import type { NoteBook } from '../../lib/creditNotesRepo'
import {
  workQueue, exposure, line, nextId, reasonsFor, noteProblems, approvalNeeded,
  needsEvidence, canApprove, canVoid, whatIsMissing, signedAmount,
  STATE_LABEL, STATE_TONE, STATE_MEANING,
} from '../../lib/creditNotes'
import type { Note, NoteKind, NotePolicy } from '../../lib/creditNotes'
import { useMarket } from '../../lib/MarketContext'

/* Paying a seller differently without misstating what the sale was.
 *
 * A settlement statement is derived from trade. When the marketplace owes a
 * seller something that is not about a sale — commission charged at the wrong
 * rate for a month, a promotion we agreed to fund, a fee billed twice, an SLA
 * penalty in the contract — there is nowhere on the statement to put it, so it
 * gets put somewhere wrong: the commission rate is bent, and the seller's own
 * reconciliation fails against a rate nobody changed; or it is netted into fees,
 * where it cannot be explained, appealed or reversed.
 *
 * The screen is built around the three things that make a note a document rather
 * than a deduction. It has a reason in the reason's own words. It has a
 * signature, and what that signature is worth is the threshold's answer rather
 * than the raiser's. And the seller can see it and argue with it — which is why
 * every button that cannot be pressed says why on itself, because the reason is
 * the part somebody has to understand.
 */

const ACTOR = 'Anika Sharma'

export function OperatorNotes() {
  const [book, setBook] = useState<NoteBook | null>(null)
  const [tab, setTab] = useState<'queue' | 'policy'>('queue')
  const [raising, setRaising] = useState<NoteKind | null>(null)
  const [voiding, setVoiding] = useState<Note | null>(null)
  const [resolving, setResolving] = useState<Note | null>(null)

  const reload = useCallback(async () => setBook(await loadNoteBook()), [])
  useEffect(() => { void reload() }, [reload])

  if (!book) {
    return <div style={{ textAlign: 'center', padding: '40px' }}><div className="spinner" style={{ margin: '0 auto' }} /></div>
  }
  if (book.loadError) {
    return <Callout tone="danger" title="The note book did not load">{book.loadError}</Callout>
  }
  if (!book.policy) {
    return (
      <Callout tone="danger" title="There is no note policy">
        Nothing can be raised until somebody says what a signature is worth. The thresholds live in
        `note_policy`.
      </Callout>
    )
  }
  const policy = book.policy
  const problems = noteProblems(book.notes, book.reasons, policy)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div>
        <h1 style={{ fontSize: 'var(--text-2xl)', fontWeight: 800, color: 'var(--text)' }}>
          Credit and debit notes
        </h1>
        <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)', marginTop: '4px', maxWidth: '80ch' }}>
          Adjustments to what a seller is paid that are not about a sale. Each one is a document with
          a reason, evidence and a signature, and it lands on the seller's next statement as its own
          line — so their reconciliation against their contracted commission still works.
        </p>
      </div>

      {problems.length > 0 && (
        <Callout tone="danger" title={`${problems.length} note${problems.length === 1 ? '' : 's'} disagree with the policy`}>
          <ul style={{ margin: 0, paddingLeft: '18px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
            {problems.map((p, i) => <li key={i} style={{ fontSize: 'var(--text-xs)', lineHeight: 1.6 }}>{p}</li>)}
          </ul>
        </Callout>
      )}

      <Exposure book={book} policy={policy} />

      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
        {([['queue', 'Notes'], ['policy', 'Reasons and thresholds']] as const).map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)}
            style={{
              padding: '7px 14px', borderRadius: 'var(--radius-md)', fontSize: 'var(--text-sm)',
              fontWeight: 600, cursor: 'pointer',
              border: `1px solid ${tab === id ? 'var(--primary)' : 'var(--border)'}`,
              background: tab === id ? 'var(--primary-soft)' : 'var(--surface)',
              color: tab === id ? 'var(--primary)' : 'var(--text-secondary)',
            }}>{label}</button>
        ))}
        <div style={{ flex: 1 }} />
        <Btn size="sm" variant="secondary" onClick={() => setRaising('debit')}>Raise a debit note</Btn>
        <Btn size="sm" onClick={() => setRaising('credit')}>Raise a credit note</Btn>
      </div>

      {tab === 'queue' && (
        <Queue book={book} policy={policy} reload={reload}
               onVoid={setVoiding} onResolve={setResolving} />
      )}
      {tab === 'policy' && <PolicyTab book={book} policy={policy} />}

      {raising && (
        <RaiseDialog book={book} policy={policy} kind={raising}
          onClose={() => setRaising(null)}
          onDone={async () => { setRaising(null); await reload() }} />
      )}
      {voiding && (
        <VoidDialog note={voiding} policy={policy}
          onClose={() => setVoiding(null)}
          onDone={async () => { setVoiding(null); await reload() }} />
      )}
      {resolving && (
        <ResolveDialog note={resolving}
          onClose={() => setResolving(null)}
          onDone={async () => { setResolving(null); await reload() }} />
      )}
    </div>
  )
}

/* ---------------------------------------------------------------- exposure -- */

/* Committed-and-unpaid is the figure that belongs on a screen by itself. It is
   what the marketplace has agreed to and not yet moved, and it is invisible
   everywhere else: the statements do not carry it yet and the ledger has never
   seen it. */
function Exposure({ book, policy }: { book: NoteBook; policy: NotePolicy }) {
  const { fmtIn } = useMarket()
  const e = exposure(book.notes, policy)
  const cash = (n: number) => `${n < 0 ? '−' : n > 0 ? '+' : ''}${fmtIn(Math.abs(n), e.currency)}`
  const disputed = book.notes.filter(n => n.state === 'disputed').length

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: '12px' }}>
      <StatCard label="Agreed, not yet settled" value={cash(e.committed)}
        sublabel="Lands on the next run" color="var(--primary)" />
      <StatCard label="Still being decided" value={cash(e.awaiting)}
        sublabel="Drafts and notes short a signature" />
      <StatCard label="Under dispute" value={cash(e.disputed)}
        sublabel={disputed === 0 ? 'Nothing challenged' : `${disputed} seller${disputed === 1 ? '' : 's'} arguing`}
        color={disputed > 0 ? 'var(--danger)' : undefined} />
      <StatCard label="Settled" value={cash(e.settled)} sublabel="On a statement already" />
    </div>
  )
}

/* ------------------------------------------------------------------- queue -- */

function Queue({ book, policy, reload, onVoid, onResolve }: {
  book: NoteBook; policy: NotePolicy; reload: () => Promise<void>
  onVoid: (n: Note) => void; onResolve: (n: Note) => void
}) {
  const { fmtIn } = useMarket()
  const [filter, setFilter] = useState<'open' | 'all'>('open')
  const [busy, setBusy] = useState<string | null>(null)

  const rows = useMemo(() => {
    const live = filter === 'open'
      ? book.notes.filter(n => n.state !== 'applied' && n.state !== 'void')
      : book.notes
    return workQueue(live)
  }, [book.notes, filter])

  const sellerName = (id: string) => book.sellers.find(s => s.id === id)?.name ?? id

  const sign = async (n: Note) => {
    setBusy(n.id)
    const r = await approveNote(n.id, ACTOR)
    setBusy(null)
    toast(r.why ?? (r.ok ? 'Approved' : 'That did not go through'), r.ok ? 'success' : 'error')
    if (r.ok) await reload()
  }

  return (
    <SectionCard title="What to work, worst first"
      subtitle="A disputed note is a seller who is not being paid while the argument is open, so it comes above everything. Then the ones short a signature, then the agreed."
      action={
        <Select value={filter} onChange={e => setFilter(e.target.value as 'open' | 'all')}
                style={{ width: 'auto' }}>
          <option value="open">Still moving</option>
          <option value="all">Everything, including settled and void</option>
        </Select>
      }>
      {rows.length === 0
        ? <EmptyState message="Nothing outstanding. Every note has either settled or been voided." />
        : (
          <Table headers={['Note', 'Seller and reason', { label: 'Amount', align: 'right' }, 'State', 'Signatures', { label: '', align: 'right' }]}>
            {rows.map(n => {
              const reason = book.reasons.find(r => r.id === n.reason_id) ?? null
              const missing = whatIsMissing(n, reason, policy)
              const sig = canApprove(n, ACTOR, policy)
              const voidable = canVoid(n, policy, new Date().toISOString().slice(0, 10))
              const need = approvalNeeded(n.amount, policy)

              return (
                <tr key={n.id}>
                  <Td>
                    <strong style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)' }}>{n.id}</strong>
                    <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
                      raised {n.raised_on} by {n.raised_by}
                    </div>
                  </Td>

                  <Td style={{ maxWidth: '44ch' }}>
                    <div style={{ fontSize: 'var(--text-sm)', fontWeight: 600 }}>{sellerName(n.partner_id)}</div>
                    <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>{line(n, reason)}</div>
                    <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', lineHeight: 1.5, marginTop: '2px' }}>
                      {n.detail}
                    </div>
                    {n.evidence && (
                      <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', marginTop: '3px' }}>
                        Evidence: {n.evidence}
                      </div>
                    )}
                    {n.dispute_note && (
                      <div style={{ fontSize: 'var(--text-xs)', color: 'var(--danger)', marginTop: '4px', lineHeight: 1.5 }}>
                        The seller says: {n.dispute_note}
                      </div>
                    )}
                    {n.void_reason && (
                      <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', marginTop: '4px' }}>
                        Voided: {n.void_reason}
                      </div>
                    )}
                    {missing.length > 0 && n.state === 'draft' && (
                      <ul style={{ margin: '5px 0 0', paddingLeft: '16px' }}>
                        {missing.map((m, i) => (
                          <li key={i} style={{ fontSize: 'var(--text-xs)', color: 'var(--warning)', lineHeight: 1.5 }}>{m}</li>
                        ))}
                      </ul>
                    )}
                  </Td>

                  <Td right>
                    <strong style={{ color: n.kind === 'credit' ? 'var(--success)' : 'var(--danger)' }}>
                      {n.kind === 'credit' ? '+' : '−'}{fmtIn(n.amount, n.currency)}
                    </strong>
                    <div style={{ fontSize: '10px', color: 'var(--text-tertiary)' }}>
                      {n.kind === 'credit' ? 'we pay more' : 'we recover'}
                    </div>
                    {n.tax > 0 && (
                      <div style={{ fontSize: '10px', color: 'var(--text-tertiary)' }}>
                        incl. tax {fmtIn(n.tax, n.currency)}{n.tax_rate ? ` at ${n.tax_rate}%` : ''}
                      </div>
                    )}
                  </Td>

                  <Td>
                    <StatusPill status={STATE_TONE[n.state]} label={STATE_LABEL[n.state]} />
                    <div style={{ fontSize: '10px', color: 'var(--text-tertiary)', marginTop: '2px', maxWidth: '24ch', lineHeight: 1.4 }}>
                      {STATE_MEANING[n.state]}
                    </div>
                    {n.statement_id && (
                      <div style={{ fontSize: '10px', color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}>
                        {n.statement_id}
                      </div>
                    )}
                  </Td>

                  <Td>
                    <div style={{ fontSize: 'var(--text-xs)', lineHeight: 1.6 }}>
                      {n.approved_by ?? <span style={{ color: 'var(--text-tertiary)' }}>nobody yet</span>}
                    </div>
                    {need === 'two' && (
                      <div style={{ fontSize: '10px', color: n.second_approved_by ? 'var(--text-tertiary)' : 'var(--warning)' }}>
                        {n.second_approved_by ?? `needs a second — at or above ${policy.second_approval_above} ${policy.currency}`}
                      </div>
                    )}
                    {/* Only where nobody has signed. Printing the floor beside a
                        name says twice what the name already said, and on the
                        sub-floor notes the approver field is the policy itself. */}
                    {need === 'none' && !n.approved_by && (
                      <div style={{ fontSize: '10px', color: 'var(--text-tertiary)' }}>
                        no signature needed — under the {policy.auto_approve_below} {policy.currency} floor
                      </div>
                    )}
                  </Td>

                  <Td right>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', alignItems: 'flex-end' }}>
                      {n.state === 'disputed' ? (
                        <Btn size="sm" onClick={() => onResolve(n)}>Resolve</Btn>
                      ) : (
                        <Btn size="sm" disabled={!sig.ok || busy === n.id}
                             title={sig.ok ? undefined : sig.reason}
                             onClick={() => void sign(n)}>
                          {busy === n.id ? 'Signing…' : sig.ok && sig.which === 'second' ? 'Countersign' : 'Approve'}
                        </Btn>
                      )}
                      <Btn size="sm" variant="secondary" disabled={!voidable.ok}
                           title={voidable.ok ? `Can be voided until ${voidable.until}` : voidable.reason}
                           onClick={() => onVoid(n)}>Void</Btn>
                      {!sig.ok && n.state !== 'disputed' && (
                        <div style={{ fontSize: '10px', color: 'var(--text-tertiary)', maxWidth: '26ch', textAlign: 'right', lineHeight: 1.4 }}>
                          {sig.reason}
                        </div>
                      )}
                    </div>
                  </Td>
                </tr>
              )
            })}
          </Table>
        )}

      <Landing book={book} reload={reload} />
    </SectionCard>
  )
}

/* The run applies notes itself. This exists for the statement that was cut
   before somebody finished approving — otherwise an issued note waits a whole
   cycle for a signature that arrived an hour late. */
function Landing({ book, reload }: { book: NoteBook; reload: () => Promise<void> }) {
  const { fmtIn } = useMarket()
  const [busy, setBusy] = useState<string | null>(null)

  const issuedFor = (partner: string) => book.notes.filter(n => n.state === 'issued' && n.partner_id === partner)
  const candidates = book.open.filter(s => issuedFor(s.partner_id).length > 0)
  if (candidates.length === 0) return null

  const land = async (id: string) => {
    setBusy(id)
    const r = await applyToStatement(id)
    setBusy(null)
    toast(r.ok ? `${r.applied} note${r.applied === 1 ? '' : 's'} landed on ${id}.` : (r.why ?? 'That did not go through'),
          r.ok ? 'success' : 'error')
    if (r.ok) await reload()
  }

  return (
    <div style={{ marginTop: '16px', paddingTop: '14px', borderTop: '1px solid var(--border)' }}>
      <div style={{ fontSize: 'var(--text-sm)', fontWeight: 700, marginBottom: '4px' }}>
        Statements still open with notes waiting
      </div>
      <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', margin: '0 0 10px', maxWidth: '76ch' }}>
        The settlement run applies notes by itself. Landing one here is for a statement that was cut
        before the last signature arrived — a signed-off statement cannot take one at all.
      </p>
      <Table headers={['Statement', 'Seller', 'Period', { label: 'Waiting', align: 'right' }, { label: '', align: 'right' }]}>
        {candidates.map(s => {
          const waiting = issuedFor(s.partner_id)
          const move = waiting.reduce((n, x) => n + signedAmount(x), 0)
          return (
            <tr key={s.id}>
              <Td><span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)' }}>{s.id}</span></Td>
              <Td>{s.partner_name}</Td>
              <Td>{s.period}</Td>
              <Td right>
                <strong style={{ color: move >= 0 ? 'var(--success)' : 'var(--danger)' }}>
                  {move >= 0 ? '+' : '−'}{fmtIn(Math.abs(move), s.currency)}
                </strong>
                <div style={{ fontSize: '10px', color: 'var(--text-tertiary)' }}>
                  {waiting.length} note{waiting.length === 1 ? '' : 's'}
                </div>
              </Td>
              <Td right>
                <Btn size="sm" variant="secondary" disabled={busy === s.id} onClick={() => void land(s.id)}>
                  {busy === s.id ? 'Landing…' : 'Apply now'}
                </Btn>
              </Td>
            </tr>
          )
        })}
      </Table>
    </div>
  )
}

/* ------------------------------------------------------------------ policy -- */

function PolicyTab({ book, policy }: { book: NoteBook; policy: NotePolicy }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <SectionCard title="What a signature is worth"
        subtitle="The threshold decides, not the person raising it — otherwise the control is whatever the raiser believes it is.">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '12px' }}>
          <Threshold icon={<ShieldCheck size={15} />} label="Nobody has to sign"
            value={`under ${policy.auto_approve_below} ${policy.currency}`}
            note="Small enough that requiring a signature would only teach people to click through them." />
          <Threshold icon={<FileText size={15} />} label="Evidence required"
            value={`from ${policy.require_evidence_above} ${policy.currency}`}
            note="A number a seller cannot check comes straight back as a dispute." />
          <Threshold icon={<Scale size={15} />} label="Two signatures"
            value={`from ${policy.second_approval_above} ${policy.currency}`}
            note="And three different people: the raiser cannot approve, and the first approver cannot countersign." />
          <Threshold icon={<TriangleAlert size={15} />} label="Void window"
            value={`${policy.void_window_days} days`}
            note="After that, and after it settles, it has to be reversed with a note the other way." />
        </div>
        <div style={{ marginTop: '14px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <Note label="Tax">{policy.tax_treatment}</Note>
          <Note label="When it settles">{policy.settle_on}</Note>
          <Note label="What it does not do">{policy.note}</Note>
        </div>
      </SectionCard>

      <SectionCard title="Why a note may be raised"
        subtitle="The reason picks the wording, decides whether a reference is demanded, and is what the seller reads first.">
        <Table headers={['Reason', 'Direction', 'Reference', 'What it is for']}>
          {[...reasonsFor(book.reasons, 'credit'), ...reasonsFor(book.reasons, 'debit')].map(r => (
            <tr key={r.id}>
              <Td><strong style={{ fontSize: 'var(--text-sm)' }}>{r.label}</strong></Td>
              <Td>
                <StatusPill status={r.kind === 'credit' ? 'healthy' : 'degraded'}
                            label={r.kind === 'credit' ? 'We pay more' : 'We recover'} />
              </Td>
              <Td style={{ maxWidth: '22ch' }}>
                <span style={{ fontSize: 'var(--text-xs)', color: r.needs_ref ? 'var(--text)' : 'var(--text-tertiary)' }}>
                  {r.needs_ref ? r.ref_label : 'Not demanded'}
                </span>
              </Td>
              <Td style={{ maxWidth: '58ch' }}>
                <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                  {r.guidance}
                </span>
              </Td>
            </tr>
          ))}
        </Table>
      </SectionCard>
    </div>
  )
}

function Threshold({ icon, label, value, note }: {
  icon: React.ReactNode; label: string; value: string; note: string
}) {
  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: '12px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--text-secondary)' }}>
        {icon}<span style={{ fontSize: 'var(--text-xs)', fontWeight: 700 }}>{label}</span>
      </div>
      <div style={{ fontSize: 'var(--text-lg)', fontWeight: 800, margin: '5px 0 4px' }}>{value}</div>
      <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', lineHeight: 1.55 }}>{note}</div>
    </div>
  )
}

function Note({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 'var(--text-xs)', lineHeight: 1.65, color: 'var(--text-secondary)' }}>
      <strong style={{ color: 'var(--text)' }}>{label}. </strong>{children}
    </div>
  )
}

/* ------------------------------------------------------------------ raising -- */

function RaiseDialog({ book, policy, kind, onClose, onDone }: {
  book: NoteBook; policy: NotePolicy; kind: NoteKind
  onClose: () => void; onDone: () => Promise<void>
}) {
  const reasons = reasonsFor(book.reasons, kind)
  const [partner, setPartner] = useState('')
  const [reasonId, setReasonId] = useState(reasons[0]?.id ?? '')
  const [amount, setAmount] = useState('')
  const [taxRate, setTaxRate] = useState('18')
  const [period, setPeriod] = useState('')
  const [ref, setRef] = useState('')
  const [evidence, setEvidence] = useState('')
  const [detail, setDetail] = useState('')
  const [busy, setBusy] = useState(false)

  const reason = reasons.find(r => r.id === reasonId) ?? null
  const amt = Number(amount) || 0
  const id = nextId(book.notes, kind, new Date().getFullYear())
  const need = approvalNeeded(amt, policy)
  const rate = Number(taxRate) || 0
  const tax = Math.round(amt * rate) / 100

  /* The same evaluation the row will get once it exists, run against the form so
     somebody learns what the note is short of while they can still type it. */
  const missing = whatIsMissing(
    {
      id, partner_id: partner, kind, reason_id: reasonId, amount: amt, currency: policy.currency,
      tax, tax_rate: rate, period: period || null, ref: ref || null, evidence: evidence || null,
      detail, state: 'draft', raised_by: ACTOR, raised_on: new Date().toISOString().slice(0, 10),
      approved_by: null, approved_on: null, second_approved_by: null, second_approved_on: null,
      statement_id: null, applied_on: null, void_reason: null, void_on: null,
      disputed_on: null, dispute_note: null,
    },
    reason, policy,
  ).filter(m => !m.includes('approver'))

  const ready = partner !== '' && reasonId !== '' && amt > 0 && missing.length === 0

  const submit = async () => {
    setBusy(true)
    const r = await raiseNote({
      id, partner_id: partner, kind, reason_id: reasonId, amount: amt,
      currency: policy.currency, tax, tax_rate: rate || null,
      period: period || null, ref: ref || null, evidence: evidence || null,
      detail, raised_by: ACTOR,
    })
    setBusy(false)
    if (!r.ok) { toast(r.why ?? 'That did not save', 'error'); return }
    toast(`${id} raised as a draft. ${need === 'none'
      ? 'It is under the approval floor, so approving it issues it straight away.'
      : need === 'two'
        ? 'It needs two signatures from two other people.'
        : 'It needs one signature from somebody else.'}`)
    await onDone()
  }

  return (
    <Modal open title={kind === 'credit' ? 'Raise a credit note' : 'Raise a debit note'} onClose={onClose}
      footer={<>
        <Btn variant="secondary" size="sm" onClick={onClose}>Cancel</Btn>
        <Btn size="sm" disabled={!ready || busy} onClick={() => void submit()}>
          {busy ? 'Saving…' : `Raise ${id}`}
        </Btn>
      </>}>
      <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', lineHeight: 1.6, marginTop: 0 }}>
        {kind === 'credit'
          ? 'This pays the seller more than the trade says. It appears on their statement as its own line, so their reconciliation against their contracted commission still works.'
          : 'This recovers from the seller. They will see it, and they can dispute it — so it has to say what it is for in terms they can check.'}
      </p>

      <FormField label="Seller" required>
        <Select value={partner} onChange={e => setPartner(e.target.value)}>
          <option value="">Choose a seller…</option>
          {book.sellers.map(s => <option key={s.id} value={s.id}>{s.name} ({s.id})</option>)}
        </Select>
      </FormField>

      <FormField label="Reason" required hint={reason?.guidance}>
        <Select value={reasonId} onChange={e => setReasonId(e.target.value)}>
          {reasons.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}
        </Select>
      </FormField>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
        <FormField label={`Amount (${policy.currency})`} required
                   hint="Always positive. Which way it moves is the kind of note, not the sign.">
          <TextInput type="number" min="0" step="0.01" value={amount}
                     onChange={e => setAmount(e.target.value)} />
        </FormField>
        <FormField label="Tax rate %"
                   hint={`Tax of ${tax.toFixed(2)} ${policy.currency}. The rate that applied to the original charge, not today's.`}>
          <TextInput type="number" min="0" step="0.01" value={taxRate}
                     onChange={e => setTaxRate(e.target.value)} />
        </FormField>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
        <FormField label="Period it belongs to" hint="A correction to March is a March document.">
          <TextInput value={period} onChange={e => setPeriod(e.target.value)} placeholder="Jun 2026" />
        </FormField>
        <FormField label={reason?.needs_ref ? (reason.ref_label ?? 'Reference') : 'Reference'}
                   required={reason?.needs_ref}
                   hint={reason?.needs_ref ? 'Without it the seller cannot check the claim.' : 'Not demanded for this reason.'}>
          <TextInput value={ref} onChange={e => setRef(e.target.value)} />
        </FormField>
      </div>

      <FormField label="Evidence" required={needsEvidence(amt, policy)}
                 hint={needsEvidence(amt, policy)
                   ? `Anything of ${policy.require_evidence_above} ${policy.currency} or more needs it.`
                   : `Optional below ${policy.require_evidence_above} ${policy.currency}, and still worth having.`}>
        <TextInput value={evidence} onChange={e => setEvidence(e.target.value)}
                   placeholder="The report, ticket or statement this rests on" />
      </FormField>

      <FormField label="What it is for" required
                 hint="The seller reads this. Write it for somebody checking whether it is fair.">
        <TextArea rows={3} value={detail} onChange={e => setDetail(e.target.value)} />
      </FormField>

      {amt > 0 && (
        <div style={{
          border: '1px solid var(--border)', borderRadius: 'var(--radius-md)',
          padding: '10px 12px', background: 'var(--surface-2)', marginTop: '4px',
        }}>
          <div style={{ fontSize: 'var(--text-xs)', fontWeight: 700, marginBottom: '4px' }}>
            What happens when you raise it
          </div>
          <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
            {need === 'none'
              ? `Under the ${policy.auto_approve_below} ${policy.currency} floor — one approval issues it.`
              : need === 'one'
                ? 'One signature, from somebody other than you, issues it.'
                : `At or above the ${policy.second_approval_above} ${policy.currency} ceiling — it needs two signatures, and all three of you have to be different people.`}
            {' '}It settles at the next run for this seller and moves their payout by{' '}
            <strong style={{ color: kind === 'credit' ? 'var(--success)' : 'var(--danger)' }}>
              {kind === 'credit' ? '+' : '−'}{amt.toFixed(2)} {policy.currency}
            </strong>.
          </div>
          {missing.length > 0 && (
            <ul style={{ margin: '6px 0 0', paddingLeft: '16px' }}>
              {missing.map((m, i) => (
                <li key={i} style={{ fontSize: 'var(--text-xs)', color: 'var(--warning)', lineHeight: 1.5 }}>{m}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Modal>
  )
}

/* ------------------------------------------------------- voiding, resolving -- */

function VoidDialog({ note, policy, onClose, onDone }: {
  note: Note; policy: NotePolicy; onClose: () => void; onDone: () => Promise<void>
}) {
  const [why, setWhy] = useState('')
  const [busy, setBusy] = useState(false)
  const v = canVoid(note, policy, new Date().toISOString().slice(0, 10))

  const submit = async () => {
    setBusy(true)
    const r = await voidNote(note.id, why)
    setBusy(false)
    if (!r.ok) { toast(r.why ?? 'That did not go through', 'error'); return }
    toast(`${note.id} voided. The reason is kept on it.`)
    await onDone()
  }

  return (
    <Modal open title={`Void ${note.id}`} onClose={onClose}
      footer={<>
        <Btn variant="secondary" size="sm" onClick={onClose}>Cancel</Btn>
        <Btn size="sm" disabled={busy || !why.trim() || !v.ok} onClick={() => void submit()}>
          {busy ? 'Voiding…' : 'Void it'}
        </Btn>
      </>}>
      {!v.ok
        ? <Callout tone="danger" title="This one cannot be voided">{v.reason}</Callout>
        : (
          <>
            <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', lineHeight: 1.6, marginTop: 0 }}>
              It stops before it settles and stays on the record with the reason attached — a void is
              not a deletion. The window closes on {v.until}.
            </p>
            <FormField label="Why it is being voided" required
                       hint="Somebody will read this while looking at why a seller was told about a note that never landed.">
              <TextArea rows={3} value={why} onChange={e => setWhy(e.target.value)} />
            </FormField>
          </>
        )}
    </Modal>
  )
}

/* A dispute has exactly two honest endings: the note was right and goes back to
   issued, or it was not and is voided. Anything else leaves the seller unpaid
   with no answer. */
function ResolveDialog({ note, onClose, onDone }: {
  note: Note; onClose: () => void; onDone: () => Promise<void>
}) {
  const [back, setBack] = useState<'issued' | 'void'>('void')
  const [how, setHow] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    setBusy(true)
    const r = await resolveDispute(note.id, back, how)
    setBusy(false)
    if (!r.ok) { toast(r.why ?? 'That did not go through', 'error'); return }
    toast(back === 'void'
      ? `${note.id} voided. The seller keeps the money.`
      : `${note.id} back to issued. It settles at the next run.`)
    await onDone()
  }

  return (
    <Modal open title={`Resolve the dispute on ${note.id}`} onClose={onClose}
      footer={<>
        <Btn variant="secondary" size="sm" onClick={onClose}>Cancel</Btn>
        <Btn size="sm" disabled={busy || !how.trim()} onClick={() => void submit()}>
          {busy ? 'Saving…' : 'Resolve it'}
        </Btn>
      </>}>
      <div style={{
        border: '1px solid var(--border)', borderRadius: 'var(--radius-md)',
        padding: '10px 12px', marginBottom: '12px',
      }}>
        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>The seller said</div>
        <div style={{ fontSize: 'var(--text-sm)', lineHeight: 1.6 }}>{note.dispute_note}</div>
      </div>

      <FormField label="How it ends" required>
        <Select value={back} onChange={e => setBack(e.target.value as 'issued' | 'void')}>
          <option value="void">They were right — void it</option>
          <option value="issued">The note stands — put it back to issued</option>
        </Select>
      </FormField>

      <FormField label="What you found" required
                 hint="The seller raised it and is owed an answer, whichever way it goes.">
        <TextArea rows={3} value={how} onChange={e => setHow(e.target.value)} />
      </FormField>
    </Modal>
  )
}
