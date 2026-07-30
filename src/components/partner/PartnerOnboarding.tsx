import { useState, useEffect, useCallback } from 'react'
import { CircleCheck as CheckCircle, Clock, Circle } from 'lucide-react'
import { SectionCard, EmptyState, Btn, Modal, FormField, TextInput, toast } from '../operator/shared'
import { TechChecklist } from '../TechChecklist'
import {
  loadOnboarding, registerEndpoint, setEndpointAuth, sendTestCall, runSandboxOrder,
} from '../../lib/onboardingRepo'
import type { OnboardingSnapshot, ActionResult } from '../../lib/onboardingRepo'
import { deriveTaskState, gateIdFor, REQUIRED_EVENTS } from '../../lib/onboarding'

export function PartnerOnboarding({ partnerId }: { partnerId: string }) {
  const [snap, setSnap] = useState<OnboardingSnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [epModal, setEpModal] = useState(false)
  const [newEp, setNewEp] = useState({ name: '', url: '' })

  const reload = useCallback(async () => {
    setSnap(await loadOnboarding(partnerId))
  }, [partnerId])

  useEffect(() => { reload().then(() => setLoading(false)) }, [reload])

  if (loading || !snap) {
    return <div style={{ textAlign: 'center', padding: '40px' }}><div className="spinner" style={{ margin: '0 auto' }} /></div>
  }

  if (snap.loadError) {
    return (
      <div style={{
        padding: '16px', borderRadius: 'var(--radius-md)',
        background: 'var(--danger-bg)', border: '1px solid var(--danger)',
        fontSize: 'var(--text-sm)', color: 'var(--danger)',
      }}>
        Your onboarding status could not be loaded. This is not the same as having nothing outstanding —
        please refresh, and contact the marketplace desk if the problem persists.
      </div>
    )
  }

  const current = snap.gates.find(g => g.status === 'current')
  const cleared = snap.gates.filter(g => g.status === 'cleared').length
  const openTasks = snap.tasks.filter(t => deriveTaskState(t, snap.gates) === 'open')

  const icon = (status: string) =>
    status === 'cleared' ? <CheckCircle size={18} style={{ color: 'var(--success)' }} />
    : status === 'current' ? <Clock size={18} style={{ color: 'var(--info)' }} />
    : <Circle size={18} style={{ color: 'var(--text-tertiary)' }} />

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
        <h1 style={{ fontSize: 'var(--text-2xl)', fontWeight: 800, color: 'var(--text)' }}>Onboarding</h1>
        <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)', marginTop: '4px' }}>
          {snap.partnerName} · {cleared} of {snap.gates.length} gates cleared
          {current && ` · currently at ${current.gate_name}`}
        </p>
      </div>

      <SectionCard title="Your gates" subtitle="Each gate is owned by a marketplace team. You are told what is outstanding.">
        {snap.gates.length === 0 ? <EmptyState message="No onboarding record" /> : (
          <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {snap.gates.map(g => (
              <div key={g.id} style={{
                display: 'flex', gap: '12px', alignItems: 'center', padding: '12px',
                borderRadius: 'var(--radius-md)',
                background: g.status === 'current' ? 'var(--info-bg)' : 'var(--bg-alt)',
                border: `1px solid ${g.status === 'current' ? 'var(--info)' : 'var(--border)'}`,
              }}>
                {icon(g.status)}
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 'var(--text-sm)', fontWeight: 600 }}>{g.gate_name}</div>
                  {g.reviewed_by && (
                    <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
                      Cleared by {g.reviewed_by}
                    </div>
                  )}
                </div>
                <span className="pill">{
                  g.status === 'cleared' ? 'Cleared' : g.status === 'current' ? 'Open' : 'Not started'
                }</span>
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      {current && gateIdFor(current) === 'tech' && (
        <SectionCard title="Integration milestone"
                     subtitle="This gate will not clear until each of these is recorded and enforced here. None can be waived.">
          <div style={{ padding: '20px' }}>
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
        </SectionCard>
      )}

      <SectionCard title="What is outstanding" subtitle="Tasks on the gate you are currently at.">
        {openTasks.length === 0 ? <EmptyState message="Nothing outstanding on the current gate" /> : (
          <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {openTasks.map(t => (
              <div key={t.id} style={{ padding: '12px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)' }}>
                <div style={{ fontSize: 'var(--text-sm)', fontWeight: 600 }}>{t.title}</div>
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', marginTop: '2px' }}>{t.detail}</div>
                {t.due && <div style={{ fontSize: 'var(--text-xs)', color: 'var(--warning)', marginTop: '4px' }}>Due: {t.due}</div>}
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
