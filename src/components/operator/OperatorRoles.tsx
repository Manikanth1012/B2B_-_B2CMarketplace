import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import type { OperatorRole, OperatorUser } from '../../types'
import { SectionCard, Table, Td, StatusPill, EmptyState, fmtDateTime } from './shared'

export function OperatorRoles() {
  const [roles, setRoles] = useState<OperatorRole[]>([])
  const [users, setUsers] = useState<OperatorUser[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<'roles' | 'users'>('roles')

  useEffect(() => {
    Promise.all([
      supabase.from('operator_roles').select('*').order('sort_order'),
      supabase.from('operator_users').select('*').order('sort_order'),
    ]).then(([r, u]) => {
      if (r.data) setRoles(r.data as OperatorRole[])
      if (u.data) setUsers(u.data as OperatorUser[])
      setLoading(false)
    })
  }, [])

  if (loading) return <div style={{ textAlign: 'center', padding: '40px' }}><div className="spinner" style={{ margin: '0 auto' }} /></div>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div>
        <h1 style={{ fontSize: 'var(--text-2xl)', fontWeight: 800, color: 'var(--text)' }}>Roles & Users</h1>
        <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)', marginTop: '4px' }}>
          {roles.length} roles · {users.length} users · Capability matrix
        </p>
      </div>

      <div style={{ display: 'flex', gap: '8px' }}>
        {[
          { id: 'roles' as const, label: 'Roles' },
          { id: 'users' as const, label: 'Users' },
        ].map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{
            padding: '8px 16px', borderRadius: 'var(--radius)', fontSize: 'var(--text-sm)', fontWeight: 600,
            background: tab === t.id ? 'var(--brand-navy)' : 'white', color: tab === t.id ? 'white' : 'var(--text-secondary)',
            border: '1px solid var(--border)', cursor: 'pointer',
          }}>{t.label}</button>
        ))}
      </div>

      {tab === 'roles' && (
        <SectionCard title="Role Matrix" subtitle="13 roles · Built-ins can be edited but not deleted">
          {roles.length === 0 ? <EmptyState message="No roles defined" /> : (
            <Table headers={['Role', 'Description', 'Assigned', 'Audit Scope', 'Capabilities']}>
              {roles.map(r => {
                const caps = Object.entries(r.capabilities)
                const fullCount = caps.filter(([, v]) => v === 'full').length
                const scopedCount = caps.filter(([, v]) => v === 'scoped').length
                return (
                  <tr key={r.id}>
                    <Td>{r.name}{r.is_builtin && <span style={{ fontSize: '10px', color: 'var(--text-tertiary)', marginLeft: '4px' }}>built-in</span>}</Td>
                    <Td>{r.description}</Td>
                    <Td right>{r.assigned_count}</Td>
                    <Td right>{r.audit_categories.length} categories</Td>
                    <Td right>{fullCount} full · {scopedCount} scoped</Td>
                  </tr>
                )
              })}
            </Table>
          )}
        </SectionCard>
      )}

      {tab === 'users' && (
        <SectionCard title="User Directory" subtitle="All operator staff">
          {users.length === 0 ? <EmptyState message="No users" /> : (
            <Table headers={['Name', 'Email', 'Role', 'MFA', 'Status', 'Last Active', 'Joined']}>
              {users.map(u => (
                <tr key={u.id}>
                  <Td>{u.name}</Td>
                  <Td right style={{ fontSize: 'var(--text-xs)' }}>{u.email}</Td>
                  <Td right>{u.role_name}</Td>
                  <Td right>{u.mfa_enabled ? <span style={{ color: 'var(--success)', fontWeight: 600, fontSize: 'var(--text-xs)' }}>Enabled</span> : <span style={{ color: 'var(--text-tertiary)', fontSize: 'var(--text-xs)' }}>Off</span>}</Td>
                  <Td right><StatusPill status={u.status} /></Td>
                  <Td right style={{ fontSize: 'var(--text-xs)' }}>{fmtDateTime(u.last_active)}</Td>
                  <Td right style={{ fontSize: 'var(--text-xs)' }}>{new Date(u.joined_at).toLocaleDateString()}</Td>
                </tr>
              ))}
            </Table>
          )}
        </SectionCard>
      )}
    </div>
  )
}
