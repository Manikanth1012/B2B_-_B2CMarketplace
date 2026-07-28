import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import type { OnboardingGate } from '../../types'
import { SectionCard, StatusPill, fmtDate, EmptyState, Btn, Modal, FormField, TextArea, TextInput, toast } from './shared'
import { CircleCheck as CheckCircle, Clock, Circle, Lock, ChevronRight } from 'lucide-react'

const GATE_NAMES = ['Application', 'KYC & due diligence', 'Agreements', 'Bank & tax', 'Technical readiness', 'Compliance review', 'Go-live']

export function OperatorOnboarding() {
  const [gates, setGates] = useState<OnboardingGate[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedPartner, setSelectedPartner] = useState<string | null>(null)
  const [gateModal, setGateModal] = useState<OnboardingGate | null>(null)
  const [addPartnerModal, setAddPartnerModal] = useState(false)
  const [newPartner, setNewPartner] = useState({ name: '', contact: '', email: '', country: '' })

  useEffect(() => {
    supabase.from('onboarding_gates').select('*').order('sort_order').then(({ data }) => {
      if (data) {
        setGates(data as OnboardingGate[])
        const partners = [...new Set(data.map(g => g.partner_name))]
        if (!selectedPartner && partners.length > 0) setSelectedPartner(partners[0])
      }
      setLoading(false)
    })
  }, [])

  if (loading) return <div style={{ textAlign: 'center', padding: '40px' }}><div className="spinner" style={{ margin: '0 auto' }} /></div>

  const partners = [...new Set(gates.map(g => g.partner_name))]
  const activePartner = selectedPartner || partners[0] || ''
  const partnerGates = gates.filter(g => g.partner_name === activePartner).sort((a, b) => a.gate_order - b.gate_order)
  const currentGate = partnerGates.find(g => g.status === 'current')

  const refreshGates = async () => {
    const { data } = await supabase.from('onboarding_gates').select('*').order('sort_order')
    if (data) setGates(data as OnboardingGate[])
  }

  const handleClearGate = async (gate: OnboardingGate) => {
    const nextGate = partnerGates.find(g => g.gate_order === gate.gate_order + 1)
    await supabase.from('onboarding_gates').update({
      status: 'cleared', reviewed_by: 'Onboarding Desk', reviewed_at: new Date().toISOString(),
    }).eq('id', gate.id)
    if (nextGate) {
      await supabase.from('onboarding_gates').update({ status: 'current' }).eq('id', nextGate.id)
    }
    toast(`${gate.gate_name} cleared for ${activePartner}`)
    await refreshGates()
    setGateModal(null)
  }

  const handleAddNote = async (gate: OnboardingGate, note: string) => {
    await supabase.from('onboarding_gates').update({ notes: note }).eq('id', gate.id)
    toast('Note added')
    await refreshGates()
    setGateModal(null)
  }

  const handleAddPartner = async () => {
    if (!newPartner.name.trim()) { toast('Partner name is required', 'error'); return }
    const partnerId = `P-${String(Date.now()).slice(-4)}`
    const sortBase = gates.length > 0 ? Math.max(...gates.map(g => g.sort_order)) + 1 : 0
    const newGates = GATE_NAMES.map((gn, i) => ({
      id: `og-${partnerId}-${i}`,
      partner_id: partnerId,
      partner_name: newPartner.name,
      gate_name: gn,
      gate_order: i + 1,
      status: i === 0 ? 'current' : 'pending',
      owner: i === 0 ? 'Onboarding Desk' : i === 1 ? 'Compliance' : i === 2 ? 'Legal' : i === 3 ? 'Finance' : i === 4 ? 'Integrations' : i === 5 ? 'Compliance' : 'Onboarding Desk',
      target_days: i === 0 || i === 5 || i === 6 ? 1 : i === 1 ? 3 : 2,
      dual_control: i !== 0,
      waivable: i !== 1 && i !== 2,
      submitted_by: 'desk',
      submitted_at: new Date().toISOString(),
      reviewed_by: null,
      reviewed_at: null,
      evidence: [],
      notes: `Desk-created application for ${newPartner.name}`,
      sort_order: sortBase + i + 1,
    }))
    await supabase.from('onboarding_gates').insert(newGates)
    toast(`${newPartner.name} added to onboarding funnel`)
    setNewPartner({ name: '', contact: '', email: '', country: '' })
    setAddPartnerModal(false)
    await refreshGates()
    setSelectedPartner(newPartner.name)
  }

  const statusIcon = (status: string) => {
    if (status === 'cleared') return <CheckCircle size={20} style={{ color: 'var(--success)' }} />
    if (status === 'current') return <Clock size={20} style={{ color: 'var(--info)' }} />
    if (status === 'pending') return <Circle size={20} style={{ color: 'var(--text-tertiary)' }} />
    return <Lock size={20} style={{ color: 'var(--text-tertiary)' }} />
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <h1 style={{ fontSize: 'var(--text-2xl)', fontWeight: 800, color: 'var(--text)' }}>Partner Onboarding</h1>
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)', marginTop: '4px' }}>7-gate funnel · {partners.length} partners in flight</p>
        </div>
        <Btn onClick={() => setAddPartnerModal(true)}>Add partner</Btn>
      </div>

      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
        {partners.map(p => (
          <button key={p} onClick={() => setSelectedPartner(p)} style={{
            padding: '8px 16px', borderRadius: 'var(--radius-full)', fontSize: 'var(--text-sm)', fontWeight: 600,
            background: p === activePartner ? 'var(--brand-navy)' : 'white',
            color: p === activePartner ? 'white' : 'var(--text-secondary)',
            border: '1px solid var(--border)', cursor: 'pointer',
          }}>{p}</button>
        ))}
      </div>

      <SectionCard title={`Onboarding: ${activePartner}`} subtitle="Click a gate to review, add notes, or clear it">
        {partnerGates.length === 0 ? <EmptyState message="No onboarding records" /> : (
          <div style={{ padding: '20px' }}>
            <div style={{ display: 'flex', gap: '4px', alignItems: 'stretch' }}>
              {partnerGates.map((gate, i) => (
                <div key={gate.id} style={{ flex: 1, minWidth: 0 }}>
                  <button onClick={() => setGateModal(gate)} style={{
                    display: 'flex', flexDirection: 'column', alignItems: 'center', width: '100%',
                    padding: '16px 12px',
                    background: gate.status === 'cleared' ? 'var(--success-bg)' : gate.status === 'current' ? 'var(--info-bg)' : 'var(--bg-alt)',
                    borderRadius: 'var(--radius-md)', border: '1px solid',
                    borderColor: gate.status === 'cleared' ? 'var(--success)' : gate.status === 'current' ? 'var(--info)' : 'var(--border)',
                    cursor: 'pointer', transition: 'all 150ms ease',
                  }}>
                    <div style={{ marginBottom: '8px' }}>{statusIcon(gate.status)}</div>
                    <div style={{ fontSize: 'var(--text-xs)', fontWeight: 700, color: 'var(--text)', textAlign: 'center', lineHeight: 1.3 }}>{gate.gate_name}</div>
                    <div style={{ fontSize: '10px', color: 'var(--text-tertiary)', marginTop: '4px' }}>Owner: {gate.owner}</div>
                    <div style={{ fontSize: '10px', color: 'var(--text-tertiary)' }}>Target: {gate.target_days}d</div>
                    {gate.dual_control && <div style={{ fontSize: '10px', color: 'var(--warning)', fontWeight: 600 }}>Dual control</div>}
                    {!gate.waivable && <div style={{ fontSize: '10px', color: 'var(--danger)', fontWeight: 600 }}>Not waivable</div>}
                    {gate.status === 'cleared' && gate.reviewed_at && <div style={{ fontSize: '10px', color: 'var(--success)', marginTop: '4px' }}>Cleared {fmtDate(gate.reviewed_at)}</div>}
                    {gate.status === 'current' && <div style={{ fontSize: '10px', color: 'var(--info)', marginTop: '4px', fontWeight: 600 }}>Click to review →</div>}
                  </button>
                  {i < partnerGates.length - 1 && <div style={{ textAlign: 'center', color: 'var(--text-tertiary)', fontSize: '10px', marginTop: '4px' }}>{gate.status === 'cleared' ? '✓' : '—'}</div>}
                </div>
              ))}
            </div>

            <div style={{ marginTop: '24px' }}>
              <h4 style={{ fontSize: 'var(--text-sm)', fontWeight: 700, color: 'var(--text)', marginBottom: '12px' }}>Evidence & Notes</h4>
              {partnerGates.filter(g => g.evidence.length > 0 || g.notes).map(gate => (
                <div key={gate.id} style={{ display: 'flex', gap: '12px', padding: '12px 0', borderTop: '1px solid var(--border-light)' }}>
                  <div style={{ flexShrink: 0 }}>{statusIcon(gate.status)}</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--text)' }}>{gate.gate_name}</div>
                    {gate.evidence.length > 0 && <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '4px' }}>{gate.evidence.map((e, i) => <span key={i} className="pill">{e}</span>)}</div>}
                    {gate.notes && <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', marginTop: '4px' }}>{gate.notes}</div>}
                  </div>
                  <div style={{ flexShrink: 0 }}><StatusPill status={gate.status} /></div>
                </div>
              ))}
            </div>
          </div>
        )}
      </SectionCard>

      {/* Gate modal */}
      {gateModal && (
        <GateModal
          gate={gateModal}
          onClose={() => setGateModal(null)}
          onClear={() => handleClearGate(gateModal)}
          onAddNote={(note) => handleAddNote(gateModal, note)}
        />
      )}

      {/* Add partner modal */}
      <Modal open={addPartnerModal} onClose={() => setAddPartnerModal(false)} title="Add Partner to Onboarding"
        footer={<><Btn variant="secondary" size="sm" onClick={() => setAddPartnerModal(false)}>Cancel</Btn><Btn size="sm" onClick={handleAddPartner}>Create</Btn></>}>
        <FormField label="Partner name" required>
          <TextInput value={newPartner.name} onChange={(e) => setNewPartner({ ...newPartner, name: e.target.value })} placeholder="e.g. Acme IoT Solutions" />
        </FormField>
        <FormField label="Contact person">
          <TextInput value={newPartner.contact} onChange={(e) => setNewPartner({ ...newPartner, contact: e.target.value })} placeholder="Full name" />
        </FormField>
        <FormField label="Email">
          <TextInput value={newPartner.email} onChange={(e) => setNewPartner({ ...newPartner, email: e.target.value })} placeholder="contact@partner.com" />
        </FormField>
        <FormField label="Country">
          <TextInput value={newPartner.country} onChange={(e) => setNewPartner({ ...newPartner, country: e.target.value })} placeholder="e.g. India" />
        </FormField>
        <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>This creates a desk-recorded application. KYC opens immediately — all gates still have to clear.</p>
      </Modal>
    </div>
  )
}

function GateModal({ gate, onClose, onClear, onAddNote }: {
  gate: OnboardingGate
  onClose: () => void
  onClear: () => void
  onAddNote: (note: string) => void
}) {
  const [note, setNote] = useState(gate.notes || '')
  const canClear = gate.status === 'current'

  return (
    <Modal open onClose={onClose} title={`Gate: ${gate.gate_name}`}
      footer={
        <>
          <Btn variant="secondary" size="sm" onClick={onClose}>Close</Btn>
          {canClear && <Btn variant="success" size="sm" onClick={onClear}>Clear gate</Btn>}
          <Btn size="sm" onClick={() => onAddNote(note)} disabled={!note.trim() || note === gate.notes}>Save note</Btn>
        </>
      }>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
          <StatusPill status={gate.status} />
          <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)' }}>Owner: {gate.owner} · Target: {gate.target_days} working days</span>
        </div>
        {gate.dual_control && <div style={{ fontSize: 'var(--text-sm)', color: 'var(--warning)' }}>This gate requires dual control — two people must approve.</div>}
        {!gate.waivable && <div style={{ fontSize: 'var(--text-sm)', color: 'var(--danger)' }}>This gate cannot be waived.</div>}
        {gate.submitted_by && <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>Submitted by {gate.submitted_by} on {fmtDate(gate.submitted_at)}</div>}
        {gate.reviewed_by && <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>Reviewed by {gate.reviewed_by} on {fmtDate(gate.reviewed_at)}</div>}
        {gate.evidence.length > 0 && (
          <div>
            <div style={{ fontSize: 'var(--text-sm)', fontWeight: 600, marginBottom: '6px' }}>Evidence</div>
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>{gate.evidence.map((e, i) => <span key={i} className="pill">{e}</span>)}</div>
          </div>
        )}
        <FormField label="Notes">
          <TextArea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add a note for this gate..." />
        </FormField>
        {canClear && <div style={{ fontSize: 'var(--text-xs)', color: 'var(--success)' }}>Click "Clear gate" to advance this partner to the next step.</div>}
      </div>
    </Modal>
  )
}
