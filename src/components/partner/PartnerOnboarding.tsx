import { TriangleAlert as AlertTriangle, CircleCheck as CheckCircle, Clock, Lock, FileText, Plus } from 'lucide-react'
import { SectionCard, StatCard, Table, Td, StatusPill, fmtInt, Btn } from '../operator/shared'
import { ONB_STEPS, ONB_STATE, ONB_TASKS, VERTICAL_NAMES } from './data'
import { useState } from 'react'
import { Modal, FormField, TextArea, toast } from '../operator/shared'

export function PartnerOnboarding() {
  const [tasks, setTasks] = useState(ONB_TASKS)
  const [resolveTask, setResolveTask] = useState<typeof ONB_TASKS[0] | null>(null)
  const [state, setState] = useState(ONB_STATE)

  const openTasks = tasks.filter(t => t.status !== 'done')
  const currentGate = ONB_STEPS.find(s => state[s.id] === 'now')
  const cleared = ONB_STEPS.filter(s => state[s.id] === 'done').length

  const gateStateName = (v: string) =>
    v === 'done' ? 'Cleared' : v === 'now' ? 'Open — you' : v === 'fail' ? 'Blocked' : 'Not started'

  const handleResolveTask = (taskId: string) => {
    setTasks(prev => prev.map(t => t.id === taskId ? { ...t, status: 'done', due: '—' } : t))
    setResolveTask(null)
    toast('Task resolved — gate updated')

    // Check if all tasks on current gate are done
    const updatedTasks = tasks.map(t => t.id === taskId ? { ...t, status: 'done' as const, due: '—' } : t)
    if (currentGate) {
      const gateTasks = updatedTasks.filter(t => t.step === currentGate.id)
      if (gateTasks.every(t => t.status === 'done')) {
        // Clear this gate and open the next
        setState(prev => {
          const next = { ...prev, [currentGate.id]: 'done' }
          const nextStep = ONB_STEPS.find((s, i) => i > ONB_STEPS.findIndex(x => x.id === currentGate.id))
          if (nextStep && next[nextStep.id] === 'todo') next[nextStep.id] = 'now'
          return next
        })
        toast('Gate cleared — next gate is now open')
      }
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1 style={{ fontSize: 'var(--text-2xl)', fontWeight: 800, color: 'var(--text)' }}>Onboarding</h1>
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)', marginTop: '4px' }}>
            Your original onboarding and any application to add a marketplace, with every gate and who owns it.
          </p>
        </div>
        <Btn variant="primary"><Plus size={14} /> Add a marketplace</Btn>
      </div>

      {/* Status banner */}
      <div style={{
        display: 'flex', gap: '12px', alignItems: 'flex-start',
        padding: '14px 18px', borderRadius: 'var(--radius-md)',
        background: 'var(--warning-bg)', border: '1px solid var(--warning)',
      }}>
        <AlertTriangle size={18} style={{ color: 'var(--warning)', flexShrink: 0, marginTop: '1px' }} />
        <div style={{ fontSize: 'var(--text-sm)', color: 'var(--warning)' }}>
          <strong>Security Marketplace application ONB-8842 is at the technical gate.</strong> 3 of 5 working days used. {openTasks.length} tasks are yours; the marketplace is not waiting on anything.
        </div>
      </div>

      {/* Pipeline */}
      <SectionCard title="Application to join Security Marketplace" subtitle="Reference ONB-8842 · started 14 Jul 2026">
        <div style={{ padding: '20px' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0', overflowX: 'auto', paddingBottom: '8px' }}>
            {ONB_STEPS.map((s, i) => {
              const v = state[s.id]
              const cls = v === 'done' ? 'done' : v === 'now' ? 'now' : 'todo'
              return (
                <div key={s.id} style={{ flex: '1 1 0', minWidth: '118px', textAlign: 'center', position: 'relative' }}>
                  <div style={{
                    width: '28px', height: '28px', borderRadius: '50%', margin: '0 auto 6px',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 'var(--text-xs)', fontWeight: 700,
                    background: v === 'done' ? 'var(--success-bg)' : v === 'now' ? 'var(--brand-navy)' : 'var(--bg-alt)',
                    color: v === 'done' ? 'var(--success)' : v === 'now' ? 'white' : 'var(--text-tertiary)',
                    border: v === 'done' ? '2px solid var(--success)' : v === 'now' ? '2px solid var(--brand-navy)' : '2px solid var(--border)',
                  }}>
                    {v === 'done' ? <CheckCircle size={14} /> : i + 1}
                  </div>
                  <div style={{ fontSize: 'var(--text-xs)', fontWeight: 500, color: v === 'todo' ? 'var(--text-tertiary)' : 'var(--text)' }}>{s.name}</div>
                  <div style={{ fontSize: '10px', color: 'var(--text-tertiary)', marginTop: '2px' }}>
                    {v === 'done' ? 'Cleared' : v === 'now' ? 'You are here' : 'Not started'}
                  </div>
                </div>
              )
            })}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px', marginTop: '20px' }}>
            <StatCard label="Elapsed" value="3 days" sublabel="Target 5 working days" />
            <StatCard label="Gates Cleared" value={`${cleared} of ${ONB_STEPS.length}`} sublabel={currentGate ? `${currentGate.name} is open` : 'All gates cleared'} />
            <StatCard label="Waiting On" value={currentGate ? 'You' : 'Nobody'} sublabel={`${openTasks.length} open tasks`} />
          </div>
        </div>
      </SectionCard>

      {/* Gate details table */}
      <SectionCard title="What Each Gate Needs" subtitle="Every gate runs in order — the next one cannot open until the current one closes">
        <Table headers={['Gate', 'What it checks', 'State', 'Owner']}>
          {ONB_STEPS.map(s => {
            const v = state[s.id]
            return (
              <tr key={s.id}>
                <Td><strong>{s.name}</strong></Td>
                <Td>{s.desc}</Td>
                <Td right>
                  {v === 'done' ? <StatusPill status="cleared" /> : v === 'now' ? <StatusPill status="open" /> : <StatusPill status="draft" />}
                </Td>
                <Td right>{v === 'done' ? '—' : v === 'now' ? 'You' : 'Marketplace'}</Td>
              </tr>
            )
          })}
        </Table>
      </SectionCard>

      {/* Tasks */}
      <SectionCard title="Your Tasks" subtitle={`${openTasks.length} open · the marketplace cannot progress the gate until these close`}>
        <div style={{ padding: '0 20px 20px' }}>
          {tasks.map(t => {
            const gate = ONB_STEPS.find(s => s.id === t.step)?.name || t.step
            const statusIcon = t.status === 'done' ? <CheckCircle size={16} style={{ color: 'var(--success)' }} />
              : t.status === 'blocked' ? <AlertTriangle size={16} style={{ color: 'var(--danger)' }} />
              : t.status === 'notstarted' ? <Lock size={16} style={{ color: 'var(--text-tertiary)' }} />
              : <Clock size={16} style={{ color: 'var(--warning)' }} />
            return (
              <div key={t.id} style={{ display: 'flex', gap: '11px', alignItems: 'flex-start', padding: '14px 0', borderBottom: '1px solid var(--border-light)' }}>
                <span style={{ flexShrink: 0 }}>{statusIcon}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', gap: '7px', alignItems: 'center' }}>
                    <span style={{ fontSize: 'var(--text-sm)', fontWeight: 600 }}>{t.title}</span>
                    <span style={{ fontSize: 'var(--text-xs)', padding: '2px 8px', borderRadius: 'var(--radius)', background: 'var(--bg-alt)', color: 'var(--text-tertiary)' }}>{gate}</span>
                  </div>
                  <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', marginTop: '3px' }}>{t.detail}</div>
                </div>
                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  <div style={{ marginBottom: '4px' }}>
                    {t.status === 'done' ? <StatusPill status="cleared" />
                      : t.status === 'blocked' ? <StatusPill status="rejected" />
                      : t.status === 'notstarted' ? <StatusPill status="draft" />
                      : <StatusPill status="pending" />}
                  </div>
                  {t.status === 'blocked' || t.status === 'pending'
                    ? <Btn variant="primary" size="sm" onClick={() => setResolveTask(t)}>Resolve</Btn>
                    : t.status === 'notstarted'
                    ? <Btn variant="secondary" size="sm" disabled>Locked</Btn>
                    : <Btn variant="secondary" size="sm" onClick={() => setResolveTask(t)}>View</Btn>}
                  <div style={{ fontSize: '10px', color: 'var(--text-tertiary)', marginTop: '4px' }}>Owner: {t.owner}</div>
                </div>
              </div>
            )
          })}
        </div>
      </SectionCard>

      {/* Resolve task modal */}
      <Modal
        open={!!resolveTask}
        onClose={() => setResolveTask(null)}
        title={resolveTask?.title || ''}
        footer={
          <>
            <Btn variant="secondary" size="sm" onClick={() => setResolveTask(null)}>Cancel</Btn>
            {resolveTask?.status !== 'done' && (
              <Btn variant="primary" size="sm" onClick={() => handleResolveTask(resolveTask!.id)}>
                {resolveTask?.id === 'OB-9103' ? 'Submit questionnaire' : 'Mark as done'}
              </Btn>
            )}
          </>
        }
      >
        <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', marginBottom: '16px' }}>{resolveTask?.detail}</p>
        {resolveTask?.id === 'OB-9102' && (
          <div style={{ marginBottom: '16px' }}>
            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', marginBottom: '8px' }}>Recent callback attempts:</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              {['1: 200 OK', '2: 200 OK', '3: 500 Internal Server Error', '4: 500 Internal Server Error', '5: 500 Internal Server Error'].map((r, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 10px', borderRadius: 'var(--radius)', background: r.includes('500') ? 'var(--danger-bg)' : 'var(--success-bg)', fontSize: 'var(--text-xs)' }}>
                  <span>Attempt {r.split(':')[0]}</span>
                  <span style={{ color: r.includes('500') ? 'var(--danger)' : 'var(--success)', fontWeight: 600 }}>{r.split(': ')[1]}</span>
                </div>
              ))}
            </div>
          </div>
        )}
        <FormField label="Notes for the onboarding desk">
          <TextArea placeholder="Add any context for the marketplace team..." />
        </FormField>
      </Modal>
    </div>
  )
}
