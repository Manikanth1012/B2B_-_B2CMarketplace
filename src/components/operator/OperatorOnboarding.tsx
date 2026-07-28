import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import type { OnboardingGate } from '../../types'
import { SectionCard, StatusPill, fmtDate, EmptyState } from './shared'
import { CircleCheck as CheckCircle, Clock, Circle, Lock } from 'lucide-react'

export function OperatorOnboarding() {
  const [gates, setGates] = useState<OnboardingGate[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedPartner, setSelectedPartner] = useState<string | null>(null)

  useEffect(() => {
    supabase.from('onboarding_gates').select('*').order('sort_order').then(({ data }) => {
      if (data) setGates(data as OnboardingGate[])
      setLoading(false)
    })
  }, [])

  if (loading) return <div style={{ textAlign: 'center', padding: '40px' }}><div className="spinner" style={{ margin: '0 auto' }} /></div>

  const partners = [...new Set(gates.map(g => g.partner_name))]
  const activePartner = selectedPartner || partners[0] || ''
  const partnerGates = gates.filter(g => g.partner_name === activePartner).sort((a, b) => a.gate_order - b.gate_order)

  const statusIcon = (status: string) => {
    if (status === 'cleared') return <CheckCircle size={20} style={{ color: 'var(--success)' }} />
    if (status === 'current') return <Clock size={20} style={{ color: 'var(--info)' }} />
    if (status === 'pending') return <Circle size={20} style={{ color: 'var(--text-tertiary)' }} />
    return <Lock size={20} style={{ color: 'var(--text-tertiary)' }} />
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div>
        <h1 style={{ fontSize: 'var(--text-2xl)', fontWeight: 800, color: 'var(--text)' }}>Partner Onboarding</h1>
        <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)', marginTop: '4px' }}>7-gate funnel · {partners.length} partners in flight</p>
      </div>

      {/* Partner selector */}
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
        {partners.map(p => (
          <button
            key={p}
            onClick={() => setSelectedPartner(p)}
            style={{
              padding: '8px 16px', borderRadius: 'var(--radius-full)',
              fontSize: 'var(--text-sm)', fontWeight: 600,
              background: p === activePartner ? 'var(--brand-navy)' : 'white',
              color: p === activePartner ? 'white' : 'var(--text-secondary)',
              border: '1px solid var(--border)', cursor: 'pointer',
              transition: 'all 150ms ease',
            }}
          >
            {p}
          </button>
        ))}
      </div>

      {/* Gate funnel */}
      <SectionCard title={`Onboarding: ${activePartner}`} subtitle="Sequential gates — each must clear before the next opens">
        {partnerGates.length === 0 ? (
          <EmptyState message="No onboarding records" />
        ) : (
          <div style={{ padding: '20px' }}>
            <div style={{ display: 'flex', gap: '4px', alignItems: 'stretch' }}>
              {partnerGates.map((gate, i) => (
                <div key={gate.id} style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    display: 'flex', flexDirection: 'column', alignItems: 'center',
                    padding: '16px 12px',
                    background: gate.status === 'cleared' ? 'var(--success-bg)' : gate.status === 'current' ? 'var(--info-bg)' : 'var(--bg-alt)',
                    borderRadius: 'var(--radius-md)',
                    border: '1px solid',
                    borderColor: gate.status === 'cleared' ? 'var(--success)' : gate.status === 'current' ? 'var(--info)' : 'var(--border)',
                    position: 'relative',
                  }}>
                    <div style={{ marginBottom: '8px' }}>{statusIcon(gate.status)}</div>
                    <div style={{ fontSize: 'var(--text-xs)', fontWeight: 700, color: 'var(--text)', textAlign: 'center', lineHeight: 1.3 }}>{gate.gate_name}</div>
                    <div style={{ fontSize: '10px', color: 'var(--text-tertiary)', marginTop: '4px' }}>Owner: {gate.owner}</div>
                    <div style={{ fontSize: '10px', color: 'var(--text-tertiary)' }}>Target: {gate.target_days}d</div>
                    {gate.dual_control && <div style={{ fontSize: '10px', color: 'var(--warning)', fontWeight: 600 }}>Dual control</div>}
                    {!gate.waivable && <div style={{ fontSize: '10px', color: 'var(--danger)', fontWeight: 600 }}>Not waivable</div>}
                    {gate.status === 'cleared' && gate.reviewed_at && (
                      <div style={{ fontSize: '10px', color: 'var(--success)', marginTop: '4px' }}>Cleared {fmtDate(gate.reviewed_at)}</div>
                    )}
                    {gate.status === 'current' && gate.notes && (
                      <div style={{ fontSize: '10px', color: 'var(--info)', marginTop: '4px', textAlign: 'center' }}>{gate.notes}</div>
                    )}
                  </div>
                  {i < partnerGates.length - 1 && (
                    <div style={{ textAlign: 'center', color: 'var(--text-tertiary)', fontSize: '10px', marginTop: '4px' }}>
                      {gate.status === 'cleared' ? '✓' : '—'}
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* Evidence */}
            <div style={{ marginTop: '24px' }}>
              <h4 style={{ fontSize: 'var(--text-sm)', fontWeight: 700, color: 'var(--text)', marginBottom: '12px' }}>Evidence Submitted</h4>
              {partnerGates.filter(g => g.evidence.length > 0 || g.notes).map(gate => (
                <div key={gate.id} style={{ display: 'flex', gap: '12px', padding: '12px 0', borderTop: '1px solid var(--border-light)' }}>
                  <div style={{ flexShrink: 0 }}>{statusIcon(gate.status)}</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--text)' }}>{gate.gate_name}</div>
                    {gate.evidence.length > 0 && (
                      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '4px' }}>
                        {gate.evidence.map((e, i) => (
                          <span key={i} className="pill">{e}</span>
                        ))}
                      </div>
                    )}
                    {gate.notes && <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', marginTop: '4px' }}>{gate.notes}</div>}
                  </div>
                  <div style={{ flexShrink: 0 }}>
                    <StatusPill status={gate.status} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </SectionCard>
    </div>
  )
}
