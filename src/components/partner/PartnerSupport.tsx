import { LifeBuoy, Plus, FileText, Package, Wallet } from 'lucide-react'
import { SectionCard, StatusPill, Btn, toast } from '../operator/shared'
import { PARTNER_DISPUTES } from './data'

export function PartnerSupport() {
  const openDisputes = PARTNER_DISPUTES.filter(d => d.status !== 'resolved')

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1 style={{ fontSize: 'var(--text-2xl)', fontWeight: 800, color: 'var(--text)' }}>Disputes and Support</h1>
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)', marginTop: '4px' }}>
            {openDisputes.length} open · disputes are held against settlement until they close
          </p>
        </div>
        <Btn variant="primary"><Plus size={14} /> Contact the marketplace</Btn>
      </div>

      {PARTNER_DISPUTES.length > 0 ? (
        PARTNER_DISPUTES.map(d => (
          <SectionCard key={d.id} title={d.reason} subtitle={`${d.id} · order ${d.order} · raised by ${d.buyer} ${d.raised}`}>
            <div style={{ padding: '20px' }}>
              <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-start', flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                  <StatusPill status={d.status} />
                  <StatusPill status={d.sla === 'Breached' ? 'rejected' : 'open'} />
                </div>
                <div style={{ flex: 1 }} />
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontWeight: 700, fontSize: 'var(--text-lg)' }}>${d.amount.toLocaleString('en-US', { minimumFractionDigits: 2 })}</div>
                  <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>held from settlement</div>
                </div>
              </div>
              <div style={{ marginTop: '16px', paddingTop: '16px', borderTop: '1px solid var(--border-light)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>Owner: {d.owner} — the marketplace is waiting on you</span>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <Btn variant="secondary" size="sm" onClick={() => toast('Evidence upload opened')}>Upload evidence</Btn>
                  <Btn variant="primary" size="sm" onClick={() => toast('Response sent to the marketplace')}>Respond</Btn>
                </div>
              </div>
            </div>
          </SectionCard>
        ))
      ) : (
        <SectionCard title="No disputes" subtitle="">
          <div style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--text-tertiary)', fontSize: 'var(--text-sm)' }}>
            Buyer disputes against your orders would appear here.
          </div>
        </SectionCard>
      )}

      <SectionCard title="Help and Policies" subtitle="Seller resources">
        <div style={{ padding: '20px', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: '16px' }}>
          {[
            { title: 'Seller policies', desc: 'What can and cannot be listed, and why listings get rejected', icon: <FileText size={16} /> },
            { title: 'Fulfilment standards', desc: 'Dispatch targets, tracking requirements and what counts as late', icon: <Package size={16} /> },
            { title: 'Settlement rules', desc: 'Cycles, holdbacks, refunds, withholding and disputes', icon: <Wallet size={16} /> },
          ].map(c => (
            <div key={c.title} style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: '16px' }}>
              <div style={{ display: 'flex', gap: '10px', alignItems: 'center', marginBottom: '8px' }}>
                <span style={{ color: 'var(--brand-accent)' }}>{c.icon}</span>
                <span style={{ fontWeight: 600, fontSize: 'var(--text-sm)' }}>{c.title}</span>
              </div>
              <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', marginBottom: '12px' }}>{c.desc}</div>
              <Btn variant="secondary" size="sm" onClick={() => toast(`${c.title} opened`)}>Read</Btn>
            </div>
          ))}
        </div>
      </SectionCard>
    </div>
  )
}
