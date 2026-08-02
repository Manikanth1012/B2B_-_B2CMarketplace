import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import type { SettlementStatement } from '../../types'
import { SectionCard, Table, Td, StatusPill, EmptyState, fmtMoney, fmtDate, Btn, Modal, FormField, TextInput, TextArea, toast, ConfirmDialog } from './shared'
import { Pager, usePaging } from '../Pager'

/* `focus` is a statement id handed over from the dashboard. Opening it here
   rather than making the operator find the row again is the whole point of a
   dashboard listing work: the list says what needs doing and this is where it
   gets done. */
export function OperatorSettlement({ focus = null }: { focus?: string | null } = {}) {
  const [statements, setStatements] = useState<SettlementStatement[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<string>('all')
  const [detailModal, setDetailModal] = useState<SettlementStatement | null>(null)
  const [addModal, setAddModal] = useState(false)
  const [rejectModal, setRejectModal] = useState<SettlementStatement | null>(null)
  const [rejectReason, setRejectReason] = useState('')

  useEffect(() => {
    supabase.from('settlement_statements').select('*').order('sort_order').then(({ data }) => {
      if (data) setStatements(data as SettlementStatement[])
      setLoading(false)
    })
  }, [])

  /* Above the loading guard: `usePaging` is a hook, and a hook below an early
     return runs on some renders and not others. */
  const filtered = filter === 'all' ? statements : statements.filter(s => s.status === filter)
  const page = usePaging(filtered, { resetKey: filter })

  /* Once, when the id arrives — reopening it every render would make the modal
     impossible to close. */
  useEffect(() => {
    if (!focus || !statements.length) return
    const wanted = statements.find(s => s.id === focus)
    if (wanted) setDetailModal(wanted)
  }, [focus, statements])

  if (loading) return <div style={{ textAlign: 'center', padding: '40px' }}><div className="spinner" style={{ margin: '0 auto' }} /></div>
  const pendingCount = statements.filter(s => s.status === 'pending').length
  const approvedCount = statements.filter(s => s.status === 'approved').length
  const totalPending = statements.filter(s => s.status === 'pending').reduce((sum, s) => sum + s.net, 0)

  const refresh = async () => {
    const { data } = await supabase.from('settlement_statements').select('*').order('sort_order')
    if (data) setStatements(data as SettlementStatement[])
  }

  const handleApprove = async (id: string) => {
    await supabase.from('settlement_statements').update({
      status: 'approved', approved_by: 'Finance Team', approved_at: new Date().toISOString(),
    }).eq('id', id)
    toast('Settlement approved')
    await refresh()
  }

  const handleReject = async () => {
    if (!rejectModal) return
    if (!rejectReason.trim()) { toast('A reason is required to reject a settlement', 'error'); return }
    await supabase.from('settlement_statements').update({
      status: 'rejected', disputed: true, approved_by: 'Finance Team', approved_at: new Date().toISOString(),
    }).eq('id', rejectModal.id)
    toast('Settlement rejected — disputed')
    setRejectReason('')
    setRejectModal(null)
    await refresh()
  }

  const handleDelete = async (id: string) => {
    await supabase.from('settlement_statements').delete().eq('id', id)
    toast('Statement deleted')
    await refresh()
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <h1 style={{ fontSize: 'var(--text-2xl)', fontWeight: 800, color: 'var(--text)' }}>Settlement Runs</h1>
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)', marginTop: '4px' }}>{pendingCount} pending · ${fmtMoney(totalPending)} net payable · {approvedCount} approved</p>
        </div>
        <Btn onClick={() => setAddModal(true)}>New statement</Btn>
      </div>

      <div style={{ display: 'flex', gap: '8px' }}>
        {[{ id: 'all', label: 'All', count: statements.length }, { id: 'pending', label: 'Pending', count: pendingCount }, { id: 'approved', label: 'Approved', count: approvedCount }].map(f => (
          <button key={f.id} onClick={() => setFilter(f.id)} style={{ padding: '8px 16px', borderRadius: 'var(--radius)', fontSize: 'var(--text-sm)', fontWeight: 600, background: filter === f.id ? 'var(--brand-navy)' : 'white', color: filter === f.id ? 'white' : 'var(--text-secondary)', border: '1px solid var(--border)', cursor: 'pointer' }}>{f.label} ({f.count})</button>
        ))}
      </div>

      <SectionCard title="Settlement Statements" subtitle="Gross-to-net deduction stack. A disputed statement cannot be approved.">
        {filtered.length === 0 ? <EmptyState message="No statements in this filter" /> : (
          <Table headers={['Partner', 'Period', 'Gross', 'Commission', 'Fees', 'Refunds', 'Net', 'Orders', 'Status', 'Actions']}>
            {page.rows.map(s => (
              <tr key={s.id}>
                <Td>{s.partner_name}{s.disputed && <span style={{ fontSize: '10px', color: 'var(--danger)', marginLeft: '4px' }}>disputed</span>}</Td>
                <Td right>{s.period}</Td>
                <Td right>${fmtMoney(s.gross)}</Td>
                <Td right>-${fmtMoney(s.commission)}</Td>
                <Td right>-${fmtMoney(s.fees)}</Td>
                <Td right>-${fmtMoney(s.refunds)}</Td>
                <Td right style={{ fontWeight: 700 }}>${fmtMoney(s.net)}</Td>
                <Td right>{s.order_count}</Td>
                <Td right><StatusPill status={s.status} /></Td>
                <Td right>
                  <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end' }}>
                    <Btn variant="secondary" size="sm" onClick={() => setDetailModal(s)}>View</Btn>
                    {s.status === 'pending' && <Btn variant="success" size="sm" onClick={() => handleApprove(s.id)}>Approve</Btn>}
                    {s.status === 'pending' && <Btn variant="danger" size="sm" onClick={() => setRejectModal(s)}>Reject</Btn>}
                    <Btn variant="danger" size="sm" onClick={() => handleDelete(s.id)}>Delete</Btn>
                  </div>
                </Td>
              </tr>
            ))}
          </Table>
        )}
        <Pager page={page} noun="statements" />
      </SectionCard>

      {/* Detail modal */}
      <Modal open={!!detailModal} onClose={() => setDetailModal(null)} title="Settlement Detail"
        footer={<Btn variant="secondary" size="sm" onClick={() => setDetailModal(null)}>Close</Btn>}>
        {detailModal && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <div><strong>{detailModal.partner_name}</strong> · {detailModal.period}</div>
              <StatusPill status={detailModal.status} />
            </div>
            <table style={{ width: '100%', fontSize: 'var(--text-sm)', minWidth: 'min-content' }}>
              <tbody>
                <tr><td style={{ padding: '6px 0', color: 'var(--text-tertiary)' }}>Gross sales</td><td style={{ textAlign: 'right', fontWeight: 600 }}>${fmtMoney(detailModal.gross)}</td></tr>
                <tr><td style={{ padding: '6px 0', color: 'var(--text-tertiary)' }}>Commission ({detailModal.commission_rate}%)</td><td style={{ textAlign: 'right', color: 'var(--danger)' }}>-${fmtMoney(detailModal.commission)}</td></tr>
                <tr><td style={{ padding: '6px 0', color: 'var(--text-tertiary)' }}>Platform fees</td><td style={{ textAlign: 'right', color: 'var(--danger)' }}>-${fmtMoney(detailModal.fees)}</td></tr>
                <tr><td style={{ padding: '6px 0', color: 'var(--text-tertiary)' }}>Withholding</td><td style={{ textAlign: 'right', color: 'var(--danger)' }}>-${fmtMoney(detailModal.withholding)}</td></tr>
                <tr><td style={{ padding: '6px 0', color: 'var(--text-tertiary)' }}>Refunds</td><td style={{ textAlign: 'right', color: 'var(--danger)' }}>-${fmtMoney(detailModal.refunds)}</td></tr>
                <tr style={{ borderTop: '2px solid var(--border)' }}><td style={{ padding: '10px 0', fontWeight: 800 }}>Net payable</td><td style={{ textAlign: 'right', fontWeight: 800, fontSize: 'var(--text-lg)' }}>${fmtMoney(detailModal.net)}</td></tr>
              </tbody>
            </table>
            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>{detailModal.order_count} orders · {detailModal.currency}</div>
            {detailModal.approved_by && <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>Approved by {detailModal.approved_by} on {fmtDate(detailModal.approved_at)}</div>}
          </div>
        )}
      </Modal>

      {/* Reject modal */}
      <Modal open={!!rejectModal} onClose={() => setRejectModal(null)} title="Reject Settlement"
        footer={<><Btn variant="secondary" size="sm" onClick={() => setRejectModal(null)}>Cancel</Btn><Btn variant="danger" size="sm" onClick={handleReject}>Reject & dispute</Btn></>}>
        <FormField label="Reason for rejection" required>
          <TextArea value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} placeholder="e.g. Commission rate does not match contract schedule..." />
        </FormField>
      </Modal>

      {/* Add modal */}
      {addModal && <StatementModal open={addModal} onClose={() => setAddModal(false)} onSave={async (s) => {
        const id = `ss-${Date.now()}`
        const sortOrder = statements.length > 0 ? Math.max(...statements.map(x => x.sort_order)) + 1 : 0
        await supabase.from('settlement_statements').insert({ ...s, id, sort_order: sortOrder, status: 'pending', submitted_at: new Date().toISOString() })
        toast('Statement created')
        setAddModal(false)
        await refresh()
      }} />}
    </div>
  )
}

function StatementModal({ open, onClose, onSave }: { open: boolean; onClose: () => void; onSave: (s: SettlementStatement) => void }) {
  const [form, setForm] = useState({
    partner_name: '', period: '', gross: 0, commission: 0, commission_rate: 9.3, fees: 0, withholding: 0, refunds: 0, net: 0, order_count: 0, currency: 'USD',
  })

  useEffect(() => {
    const net = form.gross - form.commission - form.fees - form.withholding - form.refunds
    setForm(f => ({ ...f, net }))
  }, [form.gross, form.commission, form.fees, form.withholding, form.refunds])

  const handleSave = () => {
    if (!form.partner_name.trim()) { toast('Partner name is required', 'error'); return }
    if (form.gross <= 0) { toast('Gross must be greater than zero', 'error'); return }
    onSave({ ...form, id: '', status: 'pending', submitted_at: new Date().toISOString(), approved_by: null, approved_at: null, disputed: false, sort_order: 0 })
  }

  return (
    <Modal open={open} onClose={onClose} title="New Settlement Statement"
      footer={<><Btn variant="secondary" size="sm" onClick={onClose}>Cancel</Btn><Btn size="sm" onClick={handleSave}>Create</Btn></>}>
      <FormField label="Partner name" required>
        <TextInput value={form.partner_name} onChange={(e) => setForm({ ...form, partner_name: e.target.value })} />
      </FormField>
      <div style={{ display: 'flex', gap: '12px' }}>
        <div style={{ flex: 1 }}><FormField label="Period" required><TextInput value={form.period} onChange={(e) => setForm({ ...form, period: e.target.value })} placeholder="e.g. Aug 2026" /></FormField></div>
        <div style={{ flex: 1 }}><FormField label="Order count"><TextInput type="number" value={form.order_count} onChange={(e) => setForm({ ...form, order_count: parseInt(e.target.value) || 0 })} /></FormField></div>
      </div>
      <div style={{ display: 'flex', gap: '12px' }}>
        <div style={{ flex: 1 }}><FormField label="Gross" required><TextInput type="number" step="0.01" value={form.gross} onChange={(e) => setForm({ ...form, gross: parseFloat(e.target.value) || 0 })} /></FormField></div>
        <div style={{ flex: 1 }}><FormField label="Commission"><TextInput type="number" step="0.01" value={form.commission} onChange={(e) => setForm({ ...form, commission: parseFloat(e.target.value) || 0 })} /></FormField></div>
      </div>
      <div style={{ display: 'flex', gap: '12px' }}>
        <div style={{ flex: 1 }}><FormField label="Fees"><TextInput type="number" step="0.01" value={form.fees} onChange={(e) => setForm({ ...form, fees: parseFloat(e.target.value) || 0 })} /></FormField></div>
        <div style={{ flex: 1 }}><FormField label="Withholding"><TextInput type="number" step="0.01" value={form.withholding} onChange={(e) => setForm({ ...form, withholding: parseFloat(e.target.value) || 0 })} /></FormField></div>
      </div>
      <div style={{ display: 'flex', gap: '12px' }}>
        <div style={{ flex: 1 }}><FormField label="Refunds"><TextInput type="number" step="0.01" value={form.refunds} onChange={(e) => setForm({ ...form, refunds: parseFloat(e.target.value) || 0 })} /></FormField></div>
        <div style={{ flex: 1 }}><FormField label="Net (calculated)"><TextInput value={form.net} readOnly style={{ background: 'var(--bg-alt)', fontWeight: 700 }} /></FormField></div>
      </div>
    </Modal>
  )
}
