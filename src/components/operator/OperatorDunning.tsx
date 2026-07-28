import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import type { OperatorDunningCase } from '../../types'
import { SectionCard, Table, Td, StatusPill, EmptyState, fmtMoney, fmtDate, Btn, Modal, FormField, TextInput, TextArea, Select, toast, ConfirmDialog } from './shared'

export function OperatorDunning() {
  const [cases, setCases] = useState<OperatorDunningCase[]>([])
  const [loading, setLoading] = useState(true)
  const [addModal, setAddModal] = useState(false)
  const [editModal, setEditModal] = useState<OperatorDunningCase | null>(null)
  const [newCase, setNewCase] = useState({ account_name: '', account_type: 'consumer', amount: 0, reason: '' })

  useEffect(() => {
    supabase.from('operator_dunning_cases').select('*').order('sort_order').then(({ data }) => {
      if (data) setCases(data as OperatorDunningCase[])
      setLoading(false)
    })
  }, [])

  if (loading) return <div style={{ textAlign: 'center', padding: '40px' }}><div className="spinner" style={{ margin: '0 auto' }} /></div>

  const totalOutstanding = cases.reduce((s, c) => s + c.amount, 0)
  const activeCount = cases.filter(c => c.status === 'active').length

  const refresh = async () => {
    const { data } = await supabase.from('operator_dunning_cases').select('*').order('sort_order')
    if (data) setCases(data as OperatorDunningCase[])
  }

  const handleAdvanceStep = async (c: OperatorDunningCase) => {
    const nextStep = Math.min(c.step + 1, 7)
    const stepNames = ['Soft retry', 'Soft reminder', 'Second reminder', 'Third reminder', 'Final notice', 'Suspend', 'Refer to agency']
    await supabase.from('operator_dunning_cases').update({
      step: nextStep, step_name: stepNames[nextStep - 1], attempts: c.attempts + 1,
    }).eq('id', c.id)
    toast(`Advanced to step ${nextStep}: ${stepNames[nextStep - 1]}`)
    await refresh()
  }

  const handlePromise = async (c: OperatorDunningCase, date: string) => {
    await supabase.from('operator_dunning_cases').update({ promise_to_pay: date }).eq('id', c.id)
    toast('Promise to pay recorded — ladder paused')
    await refresh()
    setEditModal(null)
  }

  const handleClose = async (id: string) => {
    await supabase.from('operator_dunning_cases').update({ status: 'resolved' }).eq('id', id)
    toast('Case closed — payment received')
    await refresh()
  }

  const handleDelete = async (id: string) => {
    await supabase.from('operator_dunning_cases').delete().eq('id', id)
    toast('Case deleted')
    await refresh()
  }

  const handleAdd = async () => {
    if (!newCase.account_name.trim()) { toast('Account name is required', 'error'); return }
    if (newCase.amount <= 0) { toast('Amount must be greater than zero', 'error'); return }
    const id = `dc-${Date.now()}`
    const sortOrder = cases.length > 0 ? Math.max(...cases.map(c => c.sort_order)) + 1 : 0
    await supabase.from('operator_dunning_cases').insert({
      id, account_name: newCase.account_name, account_type: newCase.account_type,
      amount: newCase.amount, age_days: 0, step: 1, step_name: 'Soft retry',
      ladder: newCase.account_type, attempts: 0, reason: newCase.reason || 'New case',
      collector: null, promise_to_pay: null, status: 'active', sort_order: sortOrder,
    })
    toast('Dunning case created')
    setNewCase({ account_name: '', account_type: 'consumer', amount: 0, reason: '' })
    setAddModal(false)
    await refresh()
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <h1 style={{ fontSize: 'var(--text-2xl)', fontWeight: 800, color: 'var(--text)' }}>Collections</h1>
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)', marginTop: '4px' }}>{activeCount} active cases · ${fmtMoney(totalOutstanding)} outstanding · Service not interrupted until day 14</p>
        </div>
        <Btn onClick={() => setAddModal(true)}>New case</Btn>
      </div>

      <SectionCard title="Dunning Cases" subtitle="Which ladder a case runs on is resolved from the account, not chosen by a collector">
        {cases.length === 0 ? <EmptyState message="No dunning cases" /> : (
          <Table headers={['Account', 'Type', 'Amount', 'Age', 'Step', 'Ladder', 'Attempts', 'Reason', 'Promise', 'Status', 'Actions']}>
            {cases.map(c => (
              <tr key={c.id}>
                <Td>{c.account_name}</Td>
                <Td right>{c.account_type}</Td>
                <Td right style={{ fontWeight: 700, color: 'var(--danger)' }}>${fmtMoney(c.amount)}</Td>
                <Td right style={{ color: c.age_days > 30 ? 'var(--danger)' : c.age_days > 14 ? 'var(--warning)' : 'var(--text)' }}>{c.age_days}d</Td>
                <Td right>{c.step}/7</Td>
                <Td right>{c.ladder}</Td>
                <Td right>{c.attempts}</Td>
                <Td right style={{ fontSize: 'var(--text-xs)' }}>{c.reason}</Td>
                <Td right>{c.promise_to_pay ? fmtDate(c.promise_to_pay) : '—'}</Td>
                <Td right><StatusPill status={c.status} /></Td>
                <Td right>
                  <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end' }}>
                    {c.status === 'active' && c.step < 7 && <Btn variant="secondary" size="sm" onClick={() => handleAdvanceStep(c)}>Advance</Btn>}
                    {c.status === 'active' && <Btn variant="secondary" size="sm" onClick={() => setEditModal(c)}>Promise</Btn>}
                    {c.status === 'active' && <Btn variant="success" size="sm" onClick={() => handleClose(c.id)}>Close</Btn>}
                    <Btn variant="danger" size="sm" onClick={() => handleDelete(c.id)}>Delete</Btn>
                  </div>
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </SectionCard>

      <SectionCard title="Ladder Rules" subtitle="A seller is never suspended — settlement is withheld instead">
        <div style={{ padding: '20px' }}>
          <ul style={{ paddingLeft: '20px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <li style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}><strong>Consumer:</strong> suspended at day 14, not before. Involuntary churn costs more than the receivable.</li>
            <li style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}><strong>Enterprise:</strong> not suspended before day 60 — a missed invoice is usually a PO delay.</li>
            <li style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}><strong>Seller:</strong> never suspended — taking listings down strands a buyer mid-order. Settlement is withheld instead.</li>
            <li style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>A promise to pay pauses the ladder where it stands and resumes from there if broken.</li>
            <li style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>A retry against an expired card never succeeds — the system asks for a new instrument.</li>
          </ul>
        </div>
      </SectionCard>

      {/* Add modal */}
      <Modal open={addModal} onClose={() => setAddModal(false)} title="New Dunning Case"
        footer={<><Btn variant="secondary" size="sm" onClick={() => setAddModal(false)}>Cancel</Btn><Btn size="sm" onClick={handleAdd}>Create</Btn></>}>
        <FormField label="Account name" required><TextInput value={newCase.account_name} onChange={(e) => setNewCase({ ...newCase, account_name: e.target.value })} /></FormField>
        <div style={{ display: 'flex', gap: '12px' }}>
          <div style={{ flex: 1 }}><FormField label="Account type"><Select value={newCase.account_type} onChange={(e) => setNewCase({ ...newCase, account_type: e.target.value })}><option value="consumer">Consumer</option><option value="enterprise">Enterprise</option><option value="seller">Seller</option></Select></FormField></div>
          <div style={{ flex: 1 }}><FormField label="Amount" required><TextInput type="number" step="0.01" value={newCase.amount} onChange={(e) => setNewCase({ ...newCase, amount: parseFloat(e.target.value) || 0 })} /></FormField></div>
        </div>
        <FormField label="Reason"><TextArea value={newCase.reason} onChange={(e) => setNewCase({ ...newCase, reason: e.target.value })} placeholder="e.g. Card expired, PO delay, insufficient funds" /></FormField>
      </Modal>

      {/* Promise modal */}
      {editModal && (
        <Modal open onClose={() => setEditModal(null)} title={`Promise to Pay: ${editModal.account_name}`}
          footer={<Btn variant="secondary" size="sm" onClick={() => setEditModal(null)}>Cancel</Btn>}>
          <FormField label="Promise date" required hint="The ladder pauses here and resumes from this step if broken.">
            <TextInput type="date" onChange={(e) => { if (e.target.value) handlePromise(editModal, e.target.value) }} />
          </FormField>
        </Modal>
      )}
    </div>
  )
}
