import { useState, useEffect, useCallback } from 'react'
import { CircleAlert as AlertCircle, Clock } from 'lucide-react'
import { SectionCard, EmptyState, Btn, Modal, FormField, TextInput, toast } from '../operator/shared'
import { TechChecklist } from '../TechChecklist'
import { JourneyRail, GateDetail, DocumentViewer, Callout } from '../OnboardingJourney'
import {
  loadOnboarding, registerEndpoint, setEndpointAuth, sendTestCall, runSandboxOrder,
} from '../../lib/onboardingRepo'
import type { OnboardingSnapshot, ActionResult } from '../../lib/onboardingRepo'
import { deriveTaskState, gateIdFor, journeyProgress, REQUIRED_EVENTS, SLA_DAYS } from '../../lib/onboarding'

export function PartnerOnboarding({ partnerId }: { partnerId: string }) {
  const [snap, setSnap] = useState<OnboardingSnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [selectedGate, setSelectedGate] = useState<string | null>(null)
  const [viewDoc, setViewDoc] = useState<string | null>(null)
  const [epModal, setEpModal] = useState(false)
  const [newEp, setNewEp] = useState({ name: '', url: '' })

  const reload = useCallback(async () => {
    const s = await loadOnboarding(partnerId)
    setSnap(s)
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
            <GateDetail step={step} previous={previous} onViewDocument={setViewDoc}>
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

      {viewDoc && (
        <DocumentViewer name={viewDoc} partnerName={snap.partnerName} onClose={() => setViewDoc(null)} />
      )}

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
