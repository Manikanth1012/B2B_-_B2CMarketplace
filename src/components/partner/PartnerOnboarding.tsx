import { useState, useEffect, useCallback } from 'react'
import { CircleAlert as AlertCircle, Clock, CircleCheck as Check, FileText, Plus } from 'lucide-react'
import { SectionCard, EmptyState, Btn, Modal, FormField, TextInput, TextArea, Select, toast } from '../operator/shared'
import { TechChecklist } from '../TechChecklist'
import { JourneyRail, GateDetail, Callout } from '../OnboardingJourney'
import { EvidenceLink } from '../EvidenceLink'
import type { Viewer } from '../../lib/evidence'
import {
  loadOnboarding, registerEndpoint, setEndpointAuth, sendTestCall, runSandboxOrder,
} from '../../lib/onboardingRepo'
import type { OnboardingSnapshot, ActionResult } from '../../lib/onboardingRepo'
import { deriveTaskState, gateIdFor, journeyProgress, REQUIRED_EVENTS, SLA_DAYS } from '../../lib/onboarding'
import { loadSellerRecord, applyForCategory } from '../../lib/partnerRepo'
import type { SellerRecord } from '../../lib/partnerRepo'
import { categoryReadiness, EVIDENCE_MEANING } from '../../lib/partnerDirectory'
import { fmtDate } from '../operator/shared'

export function PartnerOnboarding({ partnerId }: { partnerId: string }) {
  const [snap, setSnap] = useState<OnboardingSnapshot | null>(null)
  /* What each category the seller applied for asks of them. The gates are about
     the company; this is about what they intend to sell, and a seller who
     cannot see it cannot supply it. */
  const [record, setRecord] = useState<SellerRecord | null>(null)
  const [loading, setLoading] = useState(true)
  const [selectedGate, setSelectedGate] = useState<string | null>(null)
  const [epModal, setEpModal] = useState(false)
  /* The seller console already knows whose record it is, so the viewer needs no
     round trip — the bucket's folders are named after exactly this id. */
  const viewer: Viewer = { persona: 'partner', partnerId }
  const [newEp, setNewEp] = useState({ name: '', url: '' })

  const reload = useCallback(async () => {
    const [s, r] = await Promise.all([loadOnboarding(partnerId), loadSellerRecord(partnerId)])
    setSnap(s)
    setRecord(r)
    setSelectedGate(prev => {
      if (prev && s.journey.some(j => j.row.id === prev)) return prev
      const p = journeyProgress(s.journey)
      /* Open on whatever the seller has to act on. A completed journey opens on
         the first gate, because then it is a record to read rather than a queue. */
      return (p.failed ?? p.current ?? s.journey[0])?.row.id ?? null
    })
  }, [partnerId])

  useEffect(() => { reload().then(() => setLoading(false)) }, [reload])

  if (loading || !snap) {
    return <div style={{ textAlign: 'center', padding: '40px' }}><div className="spinner" style={{ margin: '0 auto' }} /></div>
  }

  if (snap.loadError) {
    return (
      <Callout tone="danger" title="Your onboarding record could not be loaded">
        This is not the same as having nothing outstanding. Please refresh, and contact the marketplace desk
        if it keeps happening.
      </Callout>
    )
  }

  const progress = journeyProgress(snap.journey)
  const step = snap.journey.find(s => s.row.id === selectedGate) ?? null
  const stepIndex = step ? snap.journey.findIndex(s => s.row.id === step.row.id) : -1
  const previous = stepIndex > 0 ? snap.journey[stepIndex - 1] : null

  const open = snap.tasks
    .map(t => ({ task: t, state: deriveTaskState(t, snap.gates) }))
    .filter(r => r.state === 'open' || r.state === 'blocked')

  const act = async (fn: () => Promise<ActionResult>, msg: string) => {
    const result = await fn()
    await reload()
    if (result.ok) toast(msg)
    else toast(result.reason, 'error')
  }

  const handleAddEndpoint = async () => {
    if (!newEp.name.trim() || !newEp.url.trim()) { toast('Name and URL are both required', 'error'); return }
    const result = await registerEndpoint(partnerId, newEp.name, newEp.url, REQUIRED_EVENTS)
    await reload()
    if (result.ok) {
      setNewEp({ name: '', url: '' }); setEpModal(false)
      toast('Endpoint registered — it still needs authentication and a test call')
    } else {
      toast(result.reason, 'error')
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div>
        <h1 style={{ fontSize: 'var(--text-2xl)', fontWeight: 800, color: 'var(--text)' }}>
          {progress.complete ? 'How you came through onboarding' : 'Onboarding'}
        </h1>
        <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)', marginTop: '4px' }}>
          {snap.partnerName} · {progress.cleared} of {progress.total} gates cleared
          {progress.current ? ` · currently at ${progress.current.gate.name}` : ''}
          {progress.failed ? ` · stopped at ${progress.failed.gate.name}` : ''}
        </p>
      </div>

      {progress.complete && (
        <Callout tone="success" title="Every gate is cleared">
          This is the record the marketplace holds on you, and it is the same record they read. Every field
          and document below is what you submitted at the time. If any of it is wrong or out of date, tell
          the marketplace desk — you cannot edit it here, because a record its subject can rewrite is not
          evidence.
        </Callout>
      )}

      {progress.failed && (
        <Callout tone="danger" title="This application is stopped">
          {progress.failed.submission?.note ?? 'A gate could not be cleared.'} You may reapply with corrected
          documents. That opens a new application rather than reopening this one.
        </Callout>
      )}

      {!progress.complete && !progress.failed && (
        <Callout tone="info">
          Seven gates, {SLA_DAYS} working days end to end once we have what each one asks for. Each gate is
          owned by a marketplace team, and you are told what is outstanding rather than left to guess.
        </Callout>
      )}

      <SectionCard title="Your gates" subtitle="Open any gate to see what was submitted at it">
        {snap.journey.length === 0 ? <EmptyState message="No onboarding record" /> : (
          <div style={{ padding: '18px 20px' }}>
            <JourneyRail steps={snap.journey} selected={selectedGate} onSelect={s => setSelectedGate(s.row.id)} />
          </div>
        )}
      </SectionCard>

      {step && (
        <SectionCard title={step.gate.name} subtitle="What you sent, and what this gate asks for">
          <div style={{ padding: '18px 20px' }}>
            <GateDetail step={step} previous={previous} viewer={viewer}>
              {step.row.status === 'current' && gateIdFor(step.row) === 'tech' && (
                <div style={{ borderTop: '1px solid var(--border-light)', paddingTop: '16px' }}>
                  <h4 style={{ fontSize: 'var(--text-sm)', fontWeight: 700, marginBottom: '4px' }}>Integration milestone</h4>
                  <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', marginBottom: '12px' }}>
                    This gate will not clear until each of these is recorded here. None of them can be waived.
                  </p>
                  <TechChecklist
                    tech={snap.tech}
                    mode="partner"
                    onRegisterEndpoint={() => setEpModal(true)}
                    onFixAuth={() => {
                      const target = snap.tech.noAuth[0]
                      if (target) act(() => setEndpointAuth(target.id, 'HMAC-SHA256'), `${target.name} now authenticates`)
                    }}
                    onSendTestCall={() => {
                      const target = snap.tech.untested[0]
                      if (target) act(() => sendTestCall(target.id), `Test call acknowledged on ${target.name}`)
                    }}
                    onRunSandbox={() => act(() => runSandboxOrder(partnerId), 'Sandbox order completed end to end')}
                  />
                </div>
              )}
            </GateDetail>
          </div>
        </SectionCard>
      )}

      {record && (
        <CategoryRequirements
          record={record}
          viewer={viewer}
          onApplied={async () => { await reload() }}
        />
      )}

      <SectionCard
        title="What is outstanding"
        subtitle={open.length ? `${open.length} on the gate you are at` : 'Nothing outstanding'}
      >
        {open.length === 0 ? (
          <div style={{ padding: '16px 20px' }}>
            <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', margin: 0 }}>
              {progress.complete
                ? 'Nothing. Every task closed when its gate did.'
                : 'Nothing on the current gate is waiting on you.'}
            </p>
          </div>
        ) : (
          <div style={{ padding: '14px 20px', display: 'flex', flexDirection: 'column', gap: '9px' }}>
            {open.map(({ task, state }) => (
              <div key={task.id} style={{
                display: 'flex', gap: '10px', alignItems: 'flex-start', padding: '10px 11px',
                border: '1px solid var(--border)', borderRadius: 'var(--radius-md)',
                background: state === 'blocked' ? 'var(--danger-bg)' : 'white',
              }}>
                <span style={{ flexShrink: 0, marginTop: '1px', color: state === 'blocked' ? 'var(--danger)' : 'var(--info)' }}>
                  {state === 'blocked' ? <AlertCircle size={15} /> : <Clock size={15} />}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 'var(--text-xs)', fontWeight: 700, color: 'var(--text)' }}>{task.title}</div>
                  <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', marginTop: '1px' }}>{task.detail}</div>
                </div>
                <div style={{ flexShrink: 0, textAlign: 'right' }}>
                  {/* "Partner" on the operator's screen is "you" on this one. */}
                  <div style={{ fontSize: '11px', fontWeight: 700, color: task.owner === 'Marketplace' ? 'var(--text-secondary)' : 'var(--brand-navy)' }}>
                    {task.owner === 'Marketplace' ? 'The marketplace' : 'You'}
                  </div>
                  {task.due && <div style={{ fontSize: '11px', color: state === 'blocked' ? 'var(--danger)' : 'var(--text-tertiary)' }}>{task.due}</div>}
                </div>
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      <Modal open={epModal} onClose={() => setEpModal(false)} title="Register an endpoint"
        footer={<><Btn variant="secondary" size="sm" onClick={() => setEpModal(false)}>Cancel</Btn>
                  <Btn size="sm" onClick={handleAddEndpoint}>Register</Btn></>}>
        <FormField label="Name" required>
          <TextInput value={newEp.name} onChange={e => setNewEp({ ...newEp, name: e.target.value })}
                     placeholder="e.g. Fulfilment webhook" />
        </FormField>
        <FormField label="URL" required>
          <TextInput value={newEp.url} onChange={e => setNewEp({ ...newEp, url: e.target.value })}
                     placeholder="https://api.example.com/hook" />
        </FormField>
        <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
          Registered for: {REQUIRED_EVENTS.join(', ')}. It will still need authentication and an acknowledged
          test call before the gate can clear.
        </p>
      </Modal>
    </div>
  )
}


/* --------------------------------------------- category-level onboarding -- */

function CategoryRequirements({ record, viewer, onApplied }: {
  record: SellerRecord
  viewer: Viewer
  onApplied: () => Promise<void>
}) {
  const [applying, setApplying] = useState(false)
  const today = new Date()
  const catName = (id: string) => record.categories.find(c => c.id === id)?.name ?? id
  const rule = (id: string) => record.rules.find(r => r.id === id)


  const ordered = [...record.approvals].sort((a, b) =>
    (record.categories.find(c => c.id === a.category_id)?.sort_order ?? 99) -
    (record.categories.find(c => c.id === b.category_id)?.sort_order ?? 99))

  /* Marketplaces this seller does not hold and may ask for themselves. The
     operator's own shelves are listed too, marked by invitation, because a
     seller looking for one needs to know it exists and why it is shut. */
  const openToApply = record.categories.filter(c =>
    !record.approvals.some(a => a.category_id === c.id) &&
    (c as { self_apply?: boolean }).self_apply !== false)

  return (
    <SectionCard
      title="What each marketplace asks of you"
      subtitle="Separate from the seven gates — these depend on what you sell, not on who you are"
    >
      <div style={{ padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
        {ordered.map(a => {
          const readiness = categoryReadiness(a.category_id, record.evidence, a.approved_at !== null, today)
          const mine = record.evidence
            .filter(e => e.category_id === a.category_id)
            .sort((x, y) => x.rule_id.localeCompare(y.rule_id))
          const tone = !readiness.approved ? 'warning' : readiness.clear ? 'success' : 'danger'

          return (
            <div key={a.category_id} style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
              <div style={{
                padding: '10px 13px', display: 'flex', gap: '9px', alignItems: 'center', flexWrap: 'wrap',
                background: tone === 'success' ? 'var(--success-bg)' : tone === 'danger' ? 'var(--danger-bg)' : 'var(--warning-bg)',
                borderBottom: '1px solid var(--border)',
              }}>
                <strong style={{ fontSize: 'var(--text-sm)', color: 'var(--text)' }}>{catName(a.category_id)}</strong>
                <span style={{ fontSize: '11px', color: 'var(--text-secondary)', flex: 1, minWidth: '200px' }}>
                  {!readiness.approved
                    ? `Not open yet — ${readiness.outstanding.length} document${readiness.outstanding.length === 1 ? '' : 's'} outstanding`
                    : readiness.clear
                    ? `Open — ${readiness.satisfied} of ${readiness.total} rules satisfied`
                    : 'Open, but something needs your attention'}
                </span>
              </div>

              {readiness.expired.length > 0 && (
                <div style={{ padding: '9px 13px', background: 'var(--danger-bg)', borderBottom: '1px solid var(--border)', fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>
                  <strong style={{ color: 'var(--danger)' }}>Something has expired.</strong>{' '}
                  Your existing listings continue, but nothing new can be published here until it is renewed.
                </div>
              )}
              {readiness.expiring.length > 0 && (
                <div style={{ padding: '9px 13px', background: 'var(--warning-bg)', borderBottom: '1px solid var(--border)', fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>
                  Renew before {readiness.expiring.map(e => fmtDate(e.expires_on)).join(', ')} to keep listing here.
                </div>
              )}

              <div>
                {mine.map((e, i) => {
                  const r = rule(e.rule_id)
                  const expired = e.expires_on ? Date.parse(e.expires_on) < today.getTime() : false
                  const yours = e.state === 'outstanding' || e.state === 'rejected'
                  return (
                    <div key={e.id} style={{
                      display: 'flex', gap: '9px', padding: '9px 13px', alignItems: 'flex-start',
                      borderTop: i === 0 ? 'none' : '1px solid var(--border-light)',
                    }}>
                      <span style={{ flexShrink: 0, marginTop: '1px', color: yours || expired ? 'var(--danger)' : e.state === 'standing' ? 'var(--text-tertiary)' : 'var(--success)' }}>
                        {yours || expired ? <AlertCircle size={14} /> : e.state === 'standing' ? <Clock size={14} /> : <CheckCircleIcon />}
                      </span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 'var(--text-xs)', fontWeight: 700, color: 'var(--text)' }}>
                          {r?.name ?? e.rule_id}
                        </div>
                        {r && <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', marginTop: '1px' }}>{r.descr}</div>}
                        <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '3px' }}>
                          {EVIDENCE_MEANING[e.state]}
                        </div>
                        {/* What was actually handed over, openable. A seller
                            being told a rule is satisfied without being shown
                            what satisfied it cannot check the marketplace is
                            holding the right document. */}
                        {e.document && (
                          <div style={{ marginTop: '4px' }}>
                            <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                              <span style={{
                                display: 'inline-flex', alignItems: 'center', gap: '5px',
                                fontSize: '11px', color: 'var(--text)', fontWeight: 600,
                              }}>
                                <FileText size={11} />
                                {e.document}
                                {e.kind && <span style={{ fontWeight: 400, color: 'var(--text-tertiary)' }}>
                                  {' '}· {e.kind}{e.size ? ` ${e.size}` : ''}
                                </span>}
                              </span>
                              <EvidenceLink viewer={viewer} doc={{ id: e.id, name: e.document!, path: e.path }} compact />
                            </div>
                            <div style={{ fontSize: '10px', color: expired ? 'var(--danger)' : 'var(--text-tertiary)', marginTop: '2px' }}>
                              {e.submitted_at && `You sent it ${fmtDate(e.submitted_at)}${e.submitted_by ? ` — ${e.submitted_by}` : ''}. `}
                              {e.reviewed_at && `Accepted ${fmtDate(e.reviewed_at)}${e.reviewed_by ? ` by ${e.reviewed_by}` : ''}. `}
                              {e.expires_on && `${expired ? 'Expired' : 'Valid to'} ${fmtDate(e.expires_on)}.`}
                            </div>
                            {e.note && (
                              <div style={{ fontSize: '10px', color: 'var(--text-secondary)', marginTop: '2px', fontStyle: 'italic' }}>
                                {e.note}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                      {/* Who has to act. A seller reading a compliance list needs
                          to know which lines are theirs. */}
                      <span style={{
                        flexShrink: 0, fontSize: '10px', fontWeight: 700,
                        color: yours ? 'var(--danger)' : 'var(--text-tertiary)',
                      }}>
                        {yours ? 'You' : e.state === 'submitted' ? 'With us' : '—'}
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}

        {ordered.length === 0 && (
          <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', margin: 0 }}>
            You are not on any marketplace yet. Apply for one below and the marketplace desk will tell you
            what it needs.
          </p>
        )}
      </div>

      {/* Other marketplaces. A seller who can see what a shelf demands but has
          no way to ask for it has been shown a door with no handle. */}
      <div style={{ borderTop: '1px solid var(--border)', padding: '16px 20px' }}>
        <div style={{ display: 'flex', gap: '10px', alignItems: 'baseline', flexWrap: 'wrap', marginBottom: '8px' }}>
          <strong style={{ fontSize: 'var(--text-sm)' }}>Sell somewhere else</strong>
          <span style={{ fontSize: '11px', color: 'var(--text-tertiary)', flex: 1 }}>
            Applying opens a checklist. It does not open the marketplace — that is still the desk's decision.
          </span>
          {openToApply.length > 0 && (
            <Btn size="sm" onClick={() => setApplying(true)}><Plus size={13} /> Apply for a marketplace</Btn>
          )}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
          {record.categories
            .filter(c => !record.approvals.some(a => a.category_id === c.id))
            .map(c => {
              const open = (c as { self_apply?: boolean }).self_apply !== false
              const asks = record.matrix.filter(m => m.category_id === c.id && m.level === 'enforce').length
              return (
                <div key={c.id} style={{ display: 'flex', gap: '9px', alignItems: 'baseline', flexWrap: 'wrap', fontSize: '11px' }}>
                  <strong style={{ minWidth: '110px' }}>{c.name}</strong>
                  <span style={{ color: 'var(--text-tertiary)', flex: 1, minWidth: '200px' }}>
                    {(c as { self_apply_note?: string }).self_apply_note ?? c.blurb}
                  </span>
                  <span style={{ color: 'var(--text-secondary)' }}>{asks} rule{asks === 1 ? '' : 's'} to satisfy</span>
                  <span style={{ fontWeight: 700, color: open ? 'var(--success)' : 'var(--text-tertiary)' }}>
                    {open ? 'Open to apply' : 'By invitation'}
                  </span>
                </div>
              )
            })}
        </div>
      </div>

      {applying && (
        <ApplyForMarketplace
          options={openToApply}
          matrix={record.matrix}
          rules={record.rules}
          onClose={() => setApplying(false)}
          onSubmit={async (categoryId, note) => {
            const res = await applyForCategory({ partnerId: record.partner!.id, categoryId, note })
            if (!res.ok) { toast(res.reason, 'error'); return }
            toast(res.note ?? 'Applied')
            setApplying(false)
            await onApplied()
          }}
        />
      )}
    </SectionCard>
  )
}

/* What a marketplace will ask of you, before you commit to asking for it. */
function ApplyForMarketplace({ options, matrix, rules, onClose, onSubmit }: {
  options: { id: string; name: string; blurb: string }[]
  matrix: { category_id: string; rule_id: string; level: string }[]
  rules: { id: string; name: string; descr: string }[]
  onClose: () => void
  onSubmit: (categoryId: string, note: string) => void
}) {
  const [categoryId, setCategoryId] = useState(options[0]?.id ?? '')
  const [note, setNote] = useState('')

  const asks = matrix
    .filter(m => m.category_id === categoryId)
    .map(m => ({ rule: rules.find(r => r.id === m.rule_id), level: m.level }))
    .filter(x => x.rule)

  return (
    <Modal open onClose={onClose} title="Apply for a marketplace"
      footer={<>
        <Btn variant="secondary" size="sm" onClick={onClose}>Cancel</Btn>
        <Btn size="sm" disabled={!categoryId || !note.trim()} onClick={() => onSubmit(categoryId, note)}>
          Apply
        </Btn>
      </>}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
        <Callout tone="info">
          Applying files a request and opens a checklist of what this marketplace demands. Nothing you sell
          appears there until the marketplace desk approves it and the checklist is satisfied.
        </Callout>

        <FormField label="Marketplace" required>
          <Select value={categoryId} onChange={e => setCategoryId(e.target.value)}>
            {options.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </FormField>

        {asks.length > 0 && (
          <div>
            <div style={{ fontSize: 'var(--text-xs)', fontWeight: 700, marginBottom: '6px' }}>
              What it will ask you for
            </div>
            <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-md)' }}>
              {asks.map((a, i) => (
                <div key={a.rule!.id} style={{
                  padding: '8px 11px', borderTop: i === 0 ? 'none' : '1px solid var(--border-light)',
                }}>
                  <div style={{ fontSize: '11px', fontWeight: 700 }}>
                    {a.rule!.name}
                    <span style={{ fontWeight: 400, color: a.level === 'enforce' ? 'var(--danger)' : 'var(--text-tertiary)' }}>
                      {' '}· {a.level === 'enforce' ? 'required' : 'advisory'}
                    </span>
                  </div>
                  <div style={{ fontSize: '10px', color: 'var(--text-tertiary)' }}>{a.rule!.descr}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        <FormField label="Why you want to sell here" required
                   hint="The desk reads this alongside your evidence.">
          <TextArea value={note} onChange={e => setNote(e.target.value)} rows={3}
                    placeholder="e.g. We already hold ISO 27001 for the IoT gateways and want to list the managed-firewall range." />
        </FormField>
      </div>
    </Modal>
  )
}

function CheckCircleIcon() {
  return <Check size={14} />
}
