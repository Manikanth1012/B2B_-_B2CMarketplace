import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import type { OnboardingGate } from '../../types'
import { SectionCard, StatusPill, fmtDate, EmptyState, Btn, Modal, FormField, TextArea, TextInput, Select, toast } from './shared'
import { CircleCheck as CheckCircle, Clock, Circle, Lock, ChevronRight } from 'lucide-react'
import { clearGate, loadOnboarding } from '../../lib/onboardingRepo'
import { canClearGate, gateIdFor, GATES } from '../../lib/onboarding'
import type { TechStatus } from '../../lib/onboarding'
import { TechChecklist } from '../TechChecklist'

const PARTNER_TYPES = ['Content provider', 'Device OEM', 'Insurance', 'IoT hardware', 'Reseller', 'Security ISV']

const partnerNameOf = (g: OnboardingGate) => g.partner?.name ?? g.partner_id

export function OperatorOnboarding() {
  const [gates, setGates] = useState<OnboardingGate[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedPartner, setSelectedPartner] = useState<string | null>(null)
  const [gateModal, setGateModal] = useState<OnboardingGate | null>(null)
  const [addPartnerModal, setAddPartnerModal] = useState(false)
  const [newPartner, setNewPartner] = useState({ name: '', type: '', contact: '', email: '', country: '' })
  const [tech, setTech] = useState<TechStatus | null>(null)

  useEffect(() => {
    supabase.from('onboarding_gates').select('*, partner:partners(id,name,status)').order('sort_order').then(({ data }) => {
      if (data) {
        setGates(data as OnboardingGate[])
        const partners = [...new Set((data as OnboardingGate[]).map(partnerNameOf))]
        if (!selectedPartner && partners.length > 0) setSelectedPartner(partners[0])
      }
      setLoading(false)
    })
  }, [])

  const partners = [...new Set(gates.map(partnerNameOf))]
  const activePartner = selectedPartner || partners[0] || ''
  const partnerGates = gates.filter(g => partnerNameOf(g) === activePartner).sort((a, b) => a.gate_order - b.gate_order)
  const currentGate = partnerGates.find(g => g.status === 'current')

  useEffect(() => {
    const pid = gates.find(g => (g.partner?.name ?? g.partner_id) === activePartner)?.partner_id
    if (!pid) return
    loadOnboarding(pid).then(s => setTech(s.tech))
  }, [activePartner, gates])

  if (loading) return <div style={{ textAlign: 'center', padding: '40px' }}><div className="spinner" style={{ margin: '0 auto' }} /></div>

  const refreshGates = async () => {
    const { data } = await supabase.from('onboarding_gates').select('*, partner:partners(id,name,status)').order('sort_order')
    if (data) setGates(data as OnboardingGate[])
  }

  const handleClearGate = async (gate: OnboardingGate, evidence: string) => {
    const res = await clearGate({
      gateId: gate.id, partnerId: gate.partner_id, evidence,
      actor: 'Marketplace onboarding desk',
    })
    if (!res.ok) { toast(res.reason, 'error'); return }
    toast(`${gate.gate_name} cleared for ${activePartner}`)
    if (res.auditWarning) toast(res.auditWarning, 'error')
    await refreshGates()
    const s = await loadOnboarding(gate.partner_id)
    setTech(s.tech)
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
    if (!newPartner.type) { toast('Partner type is required', 'error'); return }
    const partnerId = `PTR-${String(Date.now()).slice(-4)}`
    const sortBase = gates.length > 0 ? Math.max(...gates.map(g => g.sort_order)) + 1 : 0
    const { error: partnerErr } = await supabase.from('partners').insert({
      id: partnerId, name: newPartner.name, type: newPartner.type, status: 'onboarding',
    })
    if (partnerErr) { toast(`Could not create partner: ${partnerErr.message}`, 'error'); return }
    const newGates = GATES.map((g, i) => ({
      id: `og-${partnerId}-${i}`,
      partner_id: partnerId,
      gate_name: g.name,
      gate_order: g.order,
      status: g.order === 1 ? ('current' as const) : ('pending' as const),
      owner: g.owner,
      target_days: g.targetDays,
      dual_control: g.dualControl,
      waivable: g.waivable,
      submitted_by: 'desk',
      submitted_at: new Date().toISOString(),
      reviewed_by: null,
      reviewed_at: null,
      evidence: [],
      notes: `Desk-created application for ${newPartner.name}`,
      sort_order: sortBase + i + 1,
    }))
    const { error: gatesErr } = await supabase.from('onboarding_gates').insert(newGates)
    if (gatesErr) { toast(`Partner created, but onboarding gates could not be created: ${gatesErr.message}`, 'error'); return }
    toast(`${newPartner.name} added to onboarding funnel`)
    setNewPartner({ name: '', type: '', contact: '', email: '', country: '' })
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
          allGates={partnerGates}
          tech={tech}
          onClose={() => setGateModal(null)}
          onClear={(evidence) => handleClearGate(gateModal, evidence)}
          onAddNote={(note) => handleAddNote(gateModal, note)}
        />
      )}

      {/* Add partner modal */}
      <Modal open={addPartnerModal} onClose={() => setAddPartnerModal(false)} title="Add Partner to Onboarding"
        footer={<><Btn variant="secondary" size="sm" onClick={() => setAddPartnerModal(false)}>Cancel</Btn><Btn size="sm" disabled={!newPartner.name.trim() || !newPartner.type} onClick={handleAddPartner}>Create</Btn></>}>
        <FormField label="Partner name" required>
          <TextInput value={newPartner.name} onChange={(e) => setNewPartner({ ...newPartner, name: e.target.value })} placeholder="e.g. Acme IoT Solutions" />
        </FormField>
        <FormField label="Partner type" required>
          <Select value={newPartner.type} onChange={(e) => setNewPartner({ ...newPartner, type: e.target.value })}>
            <option value="">Select a type…</option>
            {PARTNER_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
          </Select>
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

function GateModal({ gate, allGates, tech, onClose, onClear, onAddNote }: {
  gate: OnboardingGate
  allGates: OnboardingGate[]
  tech: TechStatus | null
  onClose: () => void
  onClear: (evidence: string) => void
  onAddNote: (note: string) => void
}) {
  const [note, setNote] = useState(gate.notes || '')
  const [evidence, setEvidence] = useState('')

  const emptyTech: TechStatus =
    { checks: { registered: false, auth: false, tested: false, sandbox: false }, missing: [], noAuth: [], untested: [] }
  const verdict = canClearGate(gate, allGates, tech ?? emptyTech)
  const isTech = gateIdFor(gate) === 'tech'

  return (
    <Modal open onClose={onClose} title={`Gate: ${gate.gate_name}`}
      footer={
        <>
          <Btn variant="secondary" size="sm" onClick={onClose}>Close</Btn>
          <Btn size="sm" onClick={() => onAddNote(note)} disabled={!note.trim() || note === gate.notes}>Save note</Btn>
          <Btn variant="success" size="sm" disabled={!verdict.ok || !evidence.trim()}
               onClick={() => onClear(evidence)}>Clear gate</Btn>
        </>
      }>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
          <StatusPill status={gate.status} />
          <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)' }}>
            Owner: {gate.owner} · Target: {gate.target_days} working days
          </span>
        </div>

        {!verdict.ok && (
          <div style={{
            padding: '12px', borderRadius: 'var(--radius-md)',
            background: 'var(--danger-bg)', border: '1px solid var(--danger)',
            fontSize: 'var(--text-sm)', color: 'var(--danger)',
          }}>
            {verdict.reason}
          </div>
        )}

        {isTech && tech && <TechChecklist tech={tech} mode="operator" />}

        {gate.reviewed_by && (
          <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
            Reviewed by {gate.reviewed_by} on {fmtDate(gate.reviewed_at)}
          </div>
        )}

        <FormField label="Notes">
          <TextArea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add a note for this gate..." />
        </FormField>

        {verdict.ok && (
          <FormField label="Evidence reviewed" required>
            <TextArea value={evidence} onChange={(e) => setEvidence(e.target.value)}
                      placeholder="What you checked and where the evidence sits" />
          </FormField>
        )}

        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
          Gates cannot be un-cleared. A partner that should not have progressed must be suspended instead.
          {isTech && ' No override exists for this gate.'}
        </div>
      </div>
    </Modal>
  )
}
