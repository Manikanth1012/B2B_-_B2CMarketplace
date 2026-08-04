import { Plug, TriangleAlert as AlertTriangle, CircleCheck as CheckCircle, Activity, Key, Plus } from 'lucide-react'
import { StatCard, SectionCard, Table, Td, Id, StatusPill, fmtInt, Btn, toast } from '../operator/shared'
import { PARTNER_ENDPOINTS } from './data'

export function PartnerIntegrations() {
  const live = PARTNER_ENDPOINTS.filter(e => e.enabled)
  const failing = PARTNER_ENDPOINTS.filter(e => e.enabled && e.health === 'failing')

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1 style={{ fontSize: 'var(--text-2xl)', fontWeight: 800, color: 'var(--text)' }}>Integrations</h1>
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)', marginTop: '4px' }}>
            {PARTNER_ENDPOINTS.length} endpoints registered, {live.length} enabled · the marketplace calls you, you never poll
          </p>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <Btn variant="secondary" onClick={() => toast('API keys opened')}><Key size={14} /> API keys</Btn>
          <Btn variant="primary"><Plus size={14} /> Add an endpoint</Btn>
        </div>
      </div>

      {/* API access panel */}
      <SectionCard title="Your API Access" subtitle="Sandbox tier · rate limit: 100 req/min">
        <div style={{ padding: '20px' }}>
          <div style={{
            padding: '12px 16px', borderRadius: 'var(--radius-md)',
            background: 'var(--warning-bg)', border: '1px solid var(--warning)',
            fontSize: 'var(--text-sm)', color: 'var(--warning)', marginBottom: '16px',
          }}>
            <strong>You are on sandbox.</strong> Test data only — production access is granted when the technical gate clears. 2 of 4 checks pass today.
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', fontSize: 'var(--text-sm)' }}>
            <ApiRow label="Current tier" value="Sandbox" />
            <ApiRow label="Environment" value="Sandbox — https://sandbox.api.6d-marketplace.com" />
            <ApiRow label="Rate limit" value="100 requests per minute" />
            <ApiRow label="Monthly quota" value="10,000 calls" />
            <ApiRow label="Scopes" value="catalogue:read, orders:read, orders:write, settlement:read" />
          </div>
        </div>
      </SectionCard>

      {/* Failing endpoint banner */}
      {failing.length > 0 && (
        <div style={{
          display: 'flex', gap: '12px', alignItems: 'flex-start',
          padding: '14px 18px', borderRadius: 'var(--radius-md)',
          background: 'var(--danger-bg)', border: '1px solid var(--danger)',
        }}>
          <AlertTriangle size={18} style={{ color: 'var(--danger)', flexShrink: 0, marginTop: '1px' }} />
          <div style={{ fontSize: 'var(--text-sm)', color: 'var(--danger)' }}>
            <strong>{failing[0].name} is failing.</strong> {failing[0].note} Until it responds, orders routed to it will not be acknowledged and your Security Marketplace application stays at the technical gate.
            <span style={{ marginLeft: '8px' }}>
              <button onClick={() => toast('Test callback sent — 200 OK')} style={{ background: 'none', border: 'none', color: 'var(--danger)', textDecoration: 'underline', cursor: 'pointer', font: 'inherit' }}>Send a test call</button>
            </span>
          </div>
        </div>
      )}

      <div className="stat-row">
        <StatCard label="Endpoints enabled" value={`${live.length} of ${PARTNER_ENDPOINTS.length}`} sublabel={`${PARTNER_ENDPOINTS.filter(e => e.env === 'Sandbox').length} sandbox`} />
        <StatCard label="Required events covered" value="2 of 2" sublabel="Order created, cancelled — both handled" color="var(--success)" />
        <StatCard label="Call success, last 7" value="40%" sublabel="3 failed, all on one endpoint" color="var(--danger)" />
        <StatCard label="Avg latency" value="420ms" sublabel="p95: 1.2s" />
      </div>

      <SectionCard title="Your Endpoints" subtitle={`${PARTNER_ENDPOINTS.length} registered`}>
        <Table headers={['Name', 'Environment', 'URL', 'Auth', 'Health', 'Enabled', '']}>
          {PARTNER_ENDPOINTS.map(ep => (
            <tr key={ep.id}>
              <Td>
                <div style={{ fontWeight: 600 }}>{ep.name}</div>
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>{ep.method} · {ep.retry}</div>
              </Td>
              <Td>{ep.env}</Td>
              <Td style={{ fontSize: 'var(--text-xs)', fontFamily: 'monospace', color: 'var(--text-secondary)' }}>{ep.url.replace('https://', '')}</Td>
              {/* "HMAC-SHA256" is one algorithm, not two — the hyphen is a
                  break opportunity CSS takes by default and the column was
                  printing it over two lines. */}
              <Td><Id>{ep.auth}</Id></Td>
              <Td right>
                {!ep.enabled ? <StatusPill status="draft" />
                  : ep.health === 'failing' ? <StatusPill status="rejected" />
                  : <StatusPill status="healthy" />}
              </Td>
              <Td right>{ep.enabled ? <StatusPill status="active" /> : <StatusPill status="paused" />}</Td>
              <Td right>
                <Btn variant="secondary" size="sm" onClick={() => toast('Endpoint detail opened')}>Configure</Btn>
              </Td>
            </tr>
          ))}
        </Table>
      </SectionCard>
    </div>
  )
}

function ApiRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', gap: '12px' }}>
      <span style={{ color: 'var(--text-tertiary)', minWidth: '120px' }}>{label}</span>
      <span style={{ fontWeight: 600, color: 'var(--text)' }}>{value}</span>
    </div>
  )
}
