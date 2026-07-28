import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import type { OperatorApi, OperatorApiSubscription } from '../../types'
import { SectionCard, Table, Td, StatusPill, EmptyState, fmtInt } from './shared'

export function OperatorDeveloper() {
  const [apis, setApis] = useState<OperatorApi[]>([])
  const [subs, setSubs] = useState<OperatorApiSubscription[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<'apis' | 'subscriptions'>('apis')

  useEffect(() => {
    Promise.all([
      supabase.from('operator_apis').select('*').order('sort_order'),
      supabase.from('operator_api_subscriptions').select('*').order('sort_order'),
    ]).then(([a, s]) => {
      if (a.data) setApis(a.data as OperatorApi[])
      if (s.data) setSubs(s.data as OperatorApiSubscription[])
      setLoading(false)
    })
  }, [])

  if (loading) return <div style={{ textAlign: 'center', padding: '40px' }}><div className="spinner" style={{ margin: '0 auto' }} /></div>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div>
        <h1 style={{ fontSize: 'var(--text-2xl)', fontWeight: 800, color: 'var(--text)' }}>Developer Portal</h1>
        <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)', marginTop: '4px' }}>
          {apis.length} published APIs · {subs.length} active subscriptions · Integration access, not a product line
        </p>
      </div>

      <div style={{ display: 'flex', gap: '8px' }}>
        {[
          { id: 'apis' as const, label: 'APIs' },
          { id: 'subscriptions' as const, label: 'Subscriptions' },
        ].map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{
            padding: '8px 16px', borderRadius: 'var(--radius)', fontSize: 'var(--text-sm)', fontWeight: 600,
            background: tab === t.id ? 'var(--brand-navy)' : 'white', color: tab === t.id ? 'white' : 'var(--text-secondary)',
            border: '1px solid var(--border)', cursor: 'pointer',
          }}>{t.label}</button>
        ))}
      </div>

      {tab === 'apis' && (
        <SectionCard title="Published APIs" subtitle="Each declares the TMF standard it implements and its lifecycle state">
          {apis.length === 0 ? <EmptyState message="No APIs published" /> : (
            <Table headers={['Name', 'Standard', 'Audience', 'Version', 'Subscribers', 'Lifecycle', 'Why']}>
              {apis.map(a => (
                <tr key={a.id}>
                  <Td>{a.name}</Td>
                  <Td right>{a.standard}</Td>
                  <Td right>{a.audience}</Td>
                  <Td right>{a.version}</Td>
                  <Td right>{fmtInt(a.subscriber_count)}</Td>
                  <Td right><StatusPill status={a.lifecycle} /></Td>
                  <Td right style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', maxWidth: '300px' }}>{a.why}</Td>
                </tr>
              ))}
            </Table>
          )}
        </SectionCard>
      )}

      {tab === 'subscriptions' && (
        <SectionCard title="Subscription Matrix" subtitle="APIs down, consumers across">
          {subs.length === 0 ? <EmptyState message="No subscriptions" /> : (
            <Table headers={['Consumer', 'API', 'Version', 'Environment', 'Volume', 'Status', 'Started']}>
              {subs.map(s => {
                const api = apis.find(a => a.id === s.api_id)
                return (
                  <tr key={s.id}>
                    <Td>{s.consumer_name}</Td>
                    <Td right>{api?.name || s.api_id}</Td>
                    <Td right>{s.version}</Td>
                    <Td right>{s.environment}</Td>
                    <Td right>{fmtInt(s.volume)}</Td>
                    <Td right><StatusPill status={s.status} /></Td>
                    <Td right style={{ fontSize: 'var(--text-xs)' }}>{new Date(s.started_at).toLocaleDateString()}</Td>
                  </tr>
                )
              })}
            </Table>
          )}
        </SectionCard>
      )}
    </div>
  )
}
