import { useState, useEffect, useCallback } from 'react'
import {
  SquareCheck as CheckSquare, Shield, Cpu, Monitor, Lock, TriangleAlert as AlertTriangle,
  History, Users, Wallet,
} from 'lucide-react'
import {
  StatCard, SectionCard, Table, Td, StatusPill, fmtMoney, fmtInt, Btn, toast, Modal,
  FormField, TextArea, TextInput, EmptyState,
} from '../operator/shared'
import { Callout } from '../OnboardingJourney'
import { loadAccount, decideRequisition, savePolicy } from '../../lib/enterpriseRepo'
import type { AccountBook } from '../../lib/enterpriseRepo'
import {
  waiting, decided, canDecide, whoCanDecide, approvalImpact, duplicatesOf,
  summariseApprovals, byRequester, centreUse, centresAtRisk, policyImpact,
  spentThisYear, money, money0, day, NEED_LABEL, ROLE_LABEL,
} from '../../lib/enterprise'
import type { Requisition, Policy, Member } from '../../lib/enterprise'

/* Approvals, from the seat of the person who signs them.
 *
 * A queue on its own is a list of things somebody else has to think about.
 * What makes it decidable is the three things sitting next to each request:
 * why it was asked for, what the account already holds that looks like it, and
 * what approving actually commits the company to. Approving places the order —
 * there is no separate "now order it" step, because that is how a requisition
 * sits approved and unordered for a fortnight.
 *
 * The one thing the procurement lead cannot do, despite sitting at the top of
 * the hierarchy, is approve their own request. That is not an oversight in the
 * permission model; it is the control an audit tests first.
 */

const VICON: Record<string, typeof Cpu> = { iot: Cpu, security: Shield, device: Monitor, devices: Monitor }

export function EnterpriseApprovals() {
  const [book, setBook] = useState<AccountBook | null>(null)
  const [deciding, setDeciding] = useState<{ req: Requisition; approve: boolean } | null>(null)
  const [editPolicy, setEditPolicy] = useState(false)

  const reload = useCallback(async () => setBook(await loadAccount()), [])
  useEffect(() => { void reload() }, [reload])

  if (!book) return <div style={{ textAlign: 'center', padding: '40px' }}><div className="spinner" style={{ margin: '0 auto' }} /></div>

  const { account, me, policy } = book
  if (!account || !policy) {
    return <Callout tone="danger" title="This console is not attached to an account">{book.loadError ?? 'No enterprise account is linked to the signed-in user.'}</Callout>
  }

  const queue = waiting(book.requisitions)
  const history = decided(book.requisitions)
  const summary = me ? summariseApprovals(book.requisitions, me, policy) : null
  const atRisk = centresAtRisk(book.centres)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '16px', flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontSize: 'var(--text-2xl)', fontWeight: 800, color: 'var(--text)' }}>Approvals</h1>
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)', marginTop: '4px' }}>
            {queue.length} waiting · purchases at or above {money0(policy.threshold)} need finance approval
            {policy.security_signoff ? ', and security purchases need IT sign-off whatever they cost' : ''}
          </p>
        </div>
        {me?.role === 'procurement-lead' && (
          <Btn variant="secondary" onClick={() => setEditPolicy(true)}><Shield size={14} /> Policy</Btn>
        )}
      </div>

      {book.loadError && <Callout tone="danger" title="Some of this did not load">{book.loadError}</Callout>}

      {me && (
        <Callout tone="info" title={`You are signed in as ${ROLE_LABEL[me.role].toLowerCase()}`}>
          {me.approves_finance && me.approves_it
            ? 'You hold both finance approval and IT sign-off, so anything on this account can be decided by you — except your own requests.'
            : me.approves_finance
              ? `You hold finance approval${me.approve_limit !== null ? ` up to ${money(me.approve_limit)}` : ' with no ceiling'}. Security purchases still need IT sign-off.`
              : me.approves_it
                ? 'You hold IT sign-off. Anything at or above the threshold still needs finance as well.'
                : 'You can raise requisitions but not decide them.'}
          {' '}Approvers see the requester’s reason, the cost and what the account already holds, so a duplicate request is obvious before it is approved.
        </Callout>
      )}

      {summary && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '12px' }}>
          <StatCard label="Waiting on you" value={fmtInt(summary.mine)}
                    sublabel={summary.blocked ? `${summary.blocked} more need somebody else` : 'Nothing needs another approver'}
                    color={summary.mine ? 'var(--warning)' : 'var(--success)'} />
          <StatCard label="Value in the queue" value={`$${fmtMoney(summary.value)}`}
                    sublabel={`${summary.waiting} requisitions, oldest first`} />
          <StatCard label="Decided" value={fmtInt(summary.approved + summary.declined)}
                    sublabel={`${summary.approved} approved · ${summary.declined} declined`} />
          <StatCard label="Budget used"
                    value={`$${fmtMoney(spentThisYear(book.invoices, account))}`}
                    sublabel={`of ${money0(account.budget_year)} for the year from ${day(account.fy_starts)}`} />
        </div>
      )}

      {atRisk.length > 0 && (
        <Callout tone="warning" title={`${atRisk.length} cost centre${atRisk.length === 1 ? ' is' : 's are'} close to the cap`}>
          {atRisk.map(c => `${c.name} is at ${centreUse(c).pct}% of ${money(c.cap_quarter)} for ${c.quarter}, with ${money(centreUse(c).left)} left`).join('; ')}.
          Approving anything against {atRisk.length === 1 ? 'it' : 'them'} needs a decision about the cap first.
        </Callout>
      )}

      {queue.length === 0 ? (
        <SectionCard title="Nothing waiting" subtitle="Requisitions above your policy thresholds land here">
          <EmptyState message="Everything raised on this account has been decided." />
        </SectionCard>
      ) : queue.map(req => (
        <RequisitionCard key={req.id} req={req} book={book}
                         onDecide={approve => setDeciding({ req, approve })} />
      ))}

      <SectionCard title="Who is asking" subtitle="Approved value by requester, so one person driving all the spend is visible">
        <Table headers={['Person', 'Role', 'Cost centre', 'Raised', 'Waiting', 'Approved value']}>
          {byRequester(book.requisitions, book.members).map(r => (
            <tr key={r.member.id}>
              <Td><div style={{ fontWeight: 600 }}>{r.member.name}</div>
                  <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>{r.member.title}</div></Td>
              <Td right style={{ fontSize: 'var(--text-xs)' }}>{ROLE_LABEL[r.member.role]}</Td>
              <Td right style={{ fontSize: 'var(--text-xs)' }}>
                {book.centres.find(c => c.id === r.member.cost_centre)?.name ?? r.member.cost_centre ?? '—'}
              </Td>
              <Td right>{r.raised}</Td>
              <Td right>{r.pending || '—'}</Td>
              <Td right>${fmtMoney(r.value)}</Td>
            </tr>
          ))}
        </Table>
      </SectionCard>

      <SectionCard title="Cost centres" subtitle={`Committed against each cap for ${book.centres[0]?.quarter ?? 'the quarter'}`}>
        <Table headers={['Cost centre', 'Owner', 'Cap', 'Committed', 'Left', 'Used']}>
          {book.centres.map(c => {
            const u = centreUse(c)
            return (
              <tr key={c.id}>
                <Td><div style={{ fontWeight: 600 }}>{c.name}</div>
                    <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>{c.id}</div></Td>
                <Td right style={{ fontSize: 'var(--text-xs)' }}>{c.owner}</Td>
                <Td right>${fmtMoney(c.cap_quarter)}</Td>
                <Td right>${fmtMoney(c.spent_quarter)}</Td>
                <Td right style={{ color: u.over ? 'var(--danger)' : undefined }}>${fmtMoney(u.left)}</Td>
                <Td right>
                  <div style={{ minWidth: '110px' }}>
                    <div style={{ fontSize: 'var(--text-xs)', fontWeight: 700, color: u.pct >= 90 ? 'var(--danger)' : u.pct >= 75 ? 'var(--warning)' : 'var(--text-secondary)' }}>
                      {u.pct}%
                    </div>
                    <div style={{ height: '6px', borderRadius: '3px', background: 'var(--bg-alt)', overflow: 'hidden', marginTop: '3px' }}>
                      <div style={{
                        height: '100%', width: `${Math.min(100, u.pct)}%`, borderRadius: '3px',
                        background: u.pct >= 90 ? 'var(--danger)' : u.pct >= 75 ? 'var(--warning)' : 'var(--brand-accent-dark)',
                      }} />
                    </div>
                  </div>
                </Td>
              </tr>
            )
          })}
        </Table>
      </SectionCard>

      <SectionCard title="Decision history" subtitle={`${history.length} decided — approvals and declines are both kept`}>
        {history.length === 0 ? <EmptyState message="Nothing has been decided yet" /> : (
          <Table headers={['Request', 'Item', 'Requester', 'Value', 'Needed', 'Decided by', 'Outcome']}>
            {history.map(r => (
              <tr key={r.id}>
                <Td><div style={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{r.id}</div>
                    <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>{day(r.raised_on)}</div></Td>
                <Td>
                  <div>{r.title}</div>
                  {r.decision_note && (
                    <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', maxWidth: '380px', lineHeight: 1.4 }}>
                      {r.decision_note}
                    </div>
                  )}
                </Td>
                <Td right style={{ fontSize: 'var(--text-xs)' }}>{nameOf(book.members, r.raised_by)}</Td>
                <Td right>${fmtMoney(r.amount)}{r.model === 'monthly' ? '/mo' : ''}</Td>
                <Td right style={{ fontSize: 'var(--text-xs)' }}>{NEED_LABEL[r.need]}</Td>
                <Td right style={{ fontSize: 'var(--text-xs)' }}>
                  {nameOf(book.members, r.decided_by)}
                  <div style={{ color: 'var(--text-tertiary)' }}>{day(r.decided_on)}</div>
                </Td>
                <Td right>
                  <StatusPill status={r.state === 'approved' ? 'approved' : r.state === 'declined' ? 'rejected' : 'draft'} />
                  {r.order_ref && <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', marginTop: '2px' }}>{r.order_ref}</div>}
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </SectionCard>

      {deciding && me && (
        <DecideModal book={book} me={me} policy={policy} req={deciding.req} approve={deciding.approve}
                     onClose={() => setDeciding(null)}
                     onDone={async () => { setDeciding(null); await reload() }} />
      )}
      {editPolicy && me && (
        <PolicyModal book={book} me={me} policy={policy}
                     onClose={() => setEditPolicy(false)}
                     onDone={async () => { setEditPolicy(false); await reload() }} />
      )}
    </div>
  )
}

function nameOf(members: Member[], id: string | null): string {
  if (!id) return '—'
  return members.find(m => m.id === id)?.name ?? id
}

/* ------------------------------------------------------------ one request -- */

function RequisitionCard({ book, req, onDecide }: {
  book: AccountBook; req: Requisition; onDecide: (approve: boolean) => void
}) {
  const { me, policy } = book
  const lines = book.lines.filter(l => l.requisition_id === req.id)
  const allowed = me && policy ? canDecide(req, me, policy) : { ok: false as const, reason: 'Not signed in' }
  const others = policy ? whoCanDecide(req, book.members, policy) : []
  const dupes = policy?.duplicate_flag ? duplicatesOf(lines, book.subscriptions) : []
  const centre = book.centres.find(c => c.id === req.cost_centre)
  const Icon = VICON[req.vertical] ?? Cpu

  return (
    <SectionCard title={req.title} subtitle={`${req.id} · ${nameOf(book.members, req.raised_by)} · raised ${req.raised_at}`}>
      <div style={{ padding: '20px' }}>
        <div style={{ display: 'flex', gap: '14px', alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <div style={{ width: '40px', height: '40px', borderRadius: 'var(--radius)', background: 'var(--bg-alt)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <Icon size={20} style={{ color: 'var(--text-tertiary)' }} />
          </div>
          <div style={{ flex: 1, minWidth: '240px' }}>
            <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
              <StatusPill status="pending" />
              <span style={{ fontSize: 'var(--text-xs)', padding: '2px 8px', borderRadius: 'var(--radius)', background: 'var(--bg-alt)', color: 'var(--text-tertiary)' }}>
                {NEED_LABEL[req.need]}
              </span>
              {centre && (
                <span style={{ fontSize: 'var(--text-xs)', padding: '2px 8px', borderRadius: 'var(--radius)', background: 'var(--bg-alt)', color: 'var(--text-tertiary)' }}>
                  {centre.name}
                </span>
              )}
              {req.po_ref && (
                <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>{req.po_ref}</span>
              )}
            </div>
            <div style={{ fontSize: 'var(--text-sm)', fontStyle: 'italic', color: 'var(--text-secondary)', marginTop: '10px', lineHeight: 1.5 }}>
              “{req.reason}”
            </div>
            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', marginTop: '6px' }}>{req.policy_note}</div>
          </div>
          <div style={{ textAlign: 'right', flexShrink: 0 }}>
            <div style={{ fontWeight: 800, fontSize: 'var(--text-lg)' }}>${fmtMoney(req.amount)}</div>
            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
              {req.model === 'monthly' ? 'per month' : 'one-off'}
            </div>
          </div>
        </div>

        {lines.length > 0 && (
          <div style={{ marginTop: '14px', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
            <Table headers={['Line', 'Seller', 'Qty', 'Unit', 'Total']}>
              {lines.map(l => (
                <tr key={l.id}>
                  <Td>{l.name}</Td>
                  <Td right style={{ fontSize: 'var(--text-xs)' }}>{l.seller}</Td>
                  <Td right>{fmtInt(l.quantity)}</Td>
                  <Td right>${fmtMoney(l.unit_price)}</Td>
                  <Td right style={{ fontWeight: 600 }}>${fmtMoney(l.line_total)}</Td>
                </tr>
              ))}
            </Table>
          </div>
        )}

        {dupes.length > 0 && (
          <div style={{ marginTop: '12px' }}>
            <Callout tone="warning" title="The account already holds this">
              {dupes.map(d => (
                <div key={d.sub.id}>
                  {d.sub.name} — {fmtInt(d.sub.quantity)} {d.sub.unit.replace('/mo', '')} from {d.sub.seller},
                  {' '}{fmtInt(d.sub.quantity - d.sub.seats_used)} of them unassigned
                  {d.sub.status === 'suspended' ? ' (suspended, running to contract end)' : ''}.
                </div>
              ))}
            </Callout>
          </div>
        )}

        <div style={{ marginTop: '16px', paddingTop: '16px', borderTop: '1px solid var(--border-light)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', flex: 1, minWidth: '200px' }}>
            {allowed.ok
              ? req.need === 'none'
                ? 'Nobody has to approve this — it is within policy. Confirming places the order.'
                : `Yours to decide.${others.length > 1 ? ` ${others.length - 1} other${others.length === 2 ? '' : 's'} could also.` : ''}`
              : others.length
                ? `${allowed.reason} ${others.map(m => m.name).join(' or ')} can.`
                : `${allowed.reason} Nobody else on the account holds the right sign-off — the policy needs looking at.`}
          </span>
          <div style={{ display: 'flex', gap: '8px' }}>
            <Btn variant="danger" size="sm" disabled={!allowed.ok} onClick={() => onDecide(false)}>Decline</Btn>
            <Btn variant="success" size="sm" disabled={!allowed.ok} onClick={() => onDecide(true)}>
              {req.need === 'none' ? 'Confirm and order' : 'Approve and order'}
            </Btn>
          </div>
        </div>
      </div>
    </SectionCard>
  )
}

function DecideModal({ book, me, policy, req, approve, onClose, onDone }: {
  book: AccountBook; me: Member; policy: Policy; req: Requisition
  approve: boolean; onClose: () => void; onDone: () => Promise<void>
}) {
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const lines = book.lines.filter(l => l.requisition_id === req.id)
  const impact = book.account
    ? approvalImpact(req, lines, book.account, book.centres, spentThisYear(book.invoices, book.account))
    : []

  const submit = async () => {
    setBusy(true)
    const res = await decideRequisition({ req, me, policy, approve, note })
    setBusy(false)
    toast(res.ok ? res.note ?? 'Saved' : res.reason, res.ok ? 'success' : 'error')
    if (res.ok) await onDone()
  }

  return (
    <Modal open onClose={onClose}
      title={`${approve ? (req.need === 'none' ? 'Confirm' : 'Approve') : 'Decline'} ${req.title}`}
      footer={<>
        <Btn variant="secondary" size="sm" onClick={onClose}>Cancel</Btn>
        <Btn variant={approve ? 'success' : 'danger'} size="sm" onClick={submit} disabled={busy}>
          {busy ? 'Saving…' : approve ? (req.need === 'none' ? 'Confirm and place the order' : 'Approve and place the order') : 'Decline'}
        </Btn>
      </>}>
      <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>
        {nameOf(book.members, req.raised_by)} · ${fmtMoney(req.amount)}{req.model === 'monthly' ? ' per month' : ''} · {req.id}
      </div>

      <FormField label={`Reason (shared with ${nameOf(book.members, req.raised_by)})`} required={!approve}
                 hint={approve ? 'Optional' : 'Required — they cannot revise something they were not told about'}>
        <TextArea rows={3} value={note} onChange={e => setNote(e.target.value)}
                  placeholder={approve ? 'Anything worth recording against the decision' : 'What would need to change for this to be approved'} />
      </FormField>

      {approve ? (
        <Callout tone="warning" title={req.need === 'none' ? 'This places the order — there is no separate confirmation' : 'Approving places the order — there is no separate confirmation'}>
          <ul style={{ margin: '4px 0 0 16px' }}>{impact.map((s, i) => <li key={i}>{s}</li>)}</ul>
        </Callout>
      ) : (
        <Callout tone="info" title="Nothing is ordered and nothing is charged">
          {nameOf(book.members, req.raised_by)} is told why and can revise and resubmit. The decision stays on the record either way.
        </Callout>
      )}
    </Modal>
  )
}

/* ---------------------------------------------------------------- policy -- */

function PolicyModal({ book, me, policy, onClose, onDone }: {
  book: AccountBook; me: Member; policy: Policy; onClose: () => void; onDone: () => Promise<void>
}) {
  const [form, setForm] = useState<Policy>(policy)
  const [busy, setBusy] = useState(false)
  const impact = policyImpact(policy, form, book.requisitions)

  const submit = async () => {
    setBusy(true)
    const res = await savePolicy(form, me)
    setBusy(false)
    toast(res.ok ? res.note ?? 'Saved' : res.reason, res.ok ? 'success' : 'error')
    if (res.ok) await onDone()
  }

  return (
    <Modal open onClose={onClose} title="Approval policy"
      footer={<>
        <Btn variant="secondary" size="sm" onClick={onClose}>Cancel</Btn>
        <Btn size="sm" onClick={submit} disabled={busy}>{busy ? 'Saving…' : 'Save policy'}</Btn>
      </>}>
      <FormField label="Finance approval threshold" required
                 hint={`Requisitions at or above this go to whoever holds finance approval. ${book.requisitions.filter(r => r.amount >= form.threshold).length} of the ${book.requisitions.length} on record would have needed it.`}>
        <TextInput type="number" step="100" value={form.threshold}
                   onChange={e => setForm({ ...form, threshold: parseFloat(e.target.value) || 0 })} />
      </FormField>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        <Toggle checked={form.security_signoff} onChange={v => setForm({ ...form, security_signoff: v })}
                label="Security purchases always need IT sign-off"
                hint="Whatever they cost. The risk on a security tool is what it connects to, not what it is worth." />
        <Toggle checked={form.duplicate_flag} onChange={v => setForm({ ...form, duplicate_flag: v })}
                label="Flag a requisition that duplicates something already held"
                hint="Shown to the approver next to the request, with how many seats are already unassigned." />
        <Toggle checked={form.auto_approve_renewals} onChange={v => setForm({ ...form, auto_approve_renewals: v })}
                label="Auto-approve renewals of existing subscriptions"
                hint="Keeps the desk clear, at the cost of nobody seeing a price rise. Most price rises arrive as renewals." />
        <Toggle checked={form.self_approve} onChange={v => setForm({ ...form, self_approve: v })}
                label="Allow an approver to approve their own requisition"
                hint="Off by default, and worth leaving off." />
      </div>

      {form.self_approve && (
        <Callout tone="danger" title="Self-approval is on">
          One person can now raise and approve the same spend. That is the control most audits test first, and
          the reason it is off by default.
        </Callout>
      )}

      {impact.length > 0 && (
        <Callout tone="warning" title="What this changes">
          <ul style={{ margin: '4px 0 0 16px' }}>{impact.map((s, i) => <li key={i}>{s}</li>)}</ul>
        </Callout>
      )}

      <FormField label="Why the policy is set this way" hint="The next person to read it needs to know">
        <TextArea rows={3} value={form.note} onChange={e => setForm({ ...form, note: e.target.value })} />
      </FormField>

      {policy.updated_by && (
        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
          Last changed by {policy.updated_by} on {day(policy.updated_on)}.
        </div>
      )}
    </Modal>
  )
}

function Toggle({ checked, onChange, label, hint }: {
  checked: boolean; onChange: (v: boolean) => void; label: string; hint: string
}) {
  return (
    <label style={{ display: 'flex', gap: '10px', alignItems: 'flex-start', cursor: 'pointer' }}>
      <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} style={{ marginTop: '3px' }} />
      <div>
        <div style={{ fontSize: 'var(--text-sm)', fontWeight: 600 }}>{label}</div>
        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', lineHeight: 1.4 }}>{hint}</div>
      </div>
    </label>
  )
}

export { CheckSquare, Lock, AlertTriangle, History, Users, Wallet }
