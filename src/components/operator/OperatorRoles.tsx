import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import type { OperatorRole, OperatorUser } from '../../types'
import { SectionCard, Table, Td, StatusPill, EmptyState, fmtDateTime, Btn, Modal, FormField, TextInput, Select, TextArea, toast, ConfirmDialog } from './shared'

export function OperatorRoles() {
  const [roles, setRoles] = useState<OperatorRole[]>([])
  const [users, setUsers] = useState<OperatorUser[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<'roles' | 'users'>('roles')
  const [editRole, setEditRole] = useState<OperatorRole | null>(null)
  const [addRoleModal, setAddRoleModal] = useState(false)
  const [addUserModal, setAddUserModal] = useState(false)
  const [editUser, setEditUser] = useState<OperatorUser | null>(null)

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

  const refreshRoles = async () => {
    const { data } = await supabase.from('operator_roles').select('*').order('sort_order')
    if (data) setRoles(data as OperatorRole[])
  }
  const refreshUsers = async () => {
    const { data } = await supabase.from('operator_users').select('*').order('sort_order')
    if (data) setUsers(data as OperatorUser[])
  }

  const handleDeleteRole = async (id: string) => {
    const role = roles.find(r => r.id === id)
    if (role?.is_builtin) { toast('Built-in roles cannot be deleted', 'error'); return }
    if ((role?.assigned_count ?? 0) > 0) { toast('Cannot delete a role with users assigned — reassign them first', 'error'); return }
    await supabase.from('operator_roles').delete().eq('id', id)
    toast('Role deleted')
    await refreshRoles()
  }

  const handleDeleteUser = async (id: string) => {
    await supabase.from('operator_users').delete().eq('id', id)
    toast('User removed')
    await refreshUsers()
  }

  const handleSaveRole = async (r: OperatorRole) => {
    if (r.id) {
      await supabase.from('operator_roles').update(r).eq('id', r.id)
      toast('Role updated')
    } else {
      const id = `role-${Date.now()}`
      const sortOrder = roles.length > 0 ? Math.max(...roles.map(x => x.sort_order)) + 1 : 0
      await supabase.from('operator_roles').insert({ ...r, id, sort_order: sortOrder, is_builtin: false, assigned_count: 0 })
      toast('Role created')
    }
    await refreshRoles()
    setEditRole(null)
    setAddRoleModal(false)
  }

  const handleSaveUser = async (u: OperatorUser) => {
    if (u.id) {
      await supabase.from('operator_users').update(u).eq('id', u.id)
      toast('User updated')
    } else {
      const id = `ou-${Date.now()}`
      const sortOrder = users.length > 0 ? Math.max(...users.map(x => x.sort_order)) + 1 : 0
      await supabase.from('operator_users').insert({ ...u, id, sort_order: sortOrder, status: 'active', joined_at: new Date().toISOString(), last_active: null })
      toast('User invited')
    }
    await refreshUsers()
    setEditUser(null)
    setAddUserModal(false)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <h1 style={{ fontSize: 'var(--text-2xl)', fontWeight: 800, color: 'var(--text)' }}>Roles & Users</h1>
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)', marginTop: '4px' }}>{roles.length} roles · {users.length} users · Capability matrix</p>
        </div>
        <Btn onClick={() => tab === 'roles' ? setAddRoleModal(true) : setAddUserModal(true)}>{tab === 'roles' ? 'New role' : 'Invite user'}</Btn>
      </div>

      <div style={{ display: 'flex', gap: '8px' }}>
        {[{ id: 'roles' as const, label: 'Roles' }, { id: 'users' as const, label: 'Users' }].map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{ padding: '8px 16px', borderRadius: 'var(--radius)', fontSize: 'var(--text-sm)', fontWeight: 600, background: tab === t.id ? 'var(--brand-navy)' : 'white', color: tab === t.id ? 'white' : 'var(--text-secondary)', border: '1px solid var(--border)', cursor: 'pointer' }}>{t.label}</button>
        ))}
      </div>

      {tab === 'roles' && (
        <SectionCard title="Role Matrix" subtitle="13 roles · Built-ins can be edited but not deleted">
          {roles.length === 0 ? <EmptyState message="No roles defined" /> : (
            <Table headers={['Role', 'Description', 'Assigned', 'Audit Scope', 'Capabilities', 'Actions']}>
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
                    <Td right>
                      <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end' }}>
                        <Btn variant="secondary" size="sm" onClick={() => setEditRole(r)}>Edit</Btn>
                        <Btn variant="danger" size="sm" onClick={() => handleDeleteRole(r.id)}>Delete</Btn>
                      </div>
                    </Td>
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
            <Table headers={['Name', 'Email', 'Role', 'MFA', 'Status', 'Last Active', 'Actions']}>
              {users.map(u => (
                <tr key={u.id}>
                  <Td>{u.name}</Td>
                  <Td right style={{ fontSize: 'var(--text-xs)' }}>{u.email}</Td>
                  <Td right>{u.role_name}</Td>
                  <Td right>{u.mfa_enabled ? <span style={{ color: 'var(--success)', fontWeight: 600, fontSize: 'var(--text-xs)' }}>Enabled</span> : <span style={{ color: 'var(--text-tertiary)', fontSize: 'var(--text-xs)' }}>Off</span>}</Td>
                  <Td right><StatusPill status={u.status} /></Td>
                  <Td right style={{ fontSize: 'var(--text-xs)' }}>{fmtDateTime(u.last_active)}</Td>
                  <Td right>
                    <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end' }}>
                      <Btn variant="secondary" size="sm" onClick={() => setEditUser(u)}>Edit</Btn>
                      <Btn variant="danger" size="sm" onClick={() => handleDeleteUser(u.id)}>Remove</Btn>
                    </div>
                  </Td>
                </tr>
              ))}
            </Table>
          )}
        </SectionCard>
      )}

      {(editRole || addRoleModal) && <RoleModal role={editRole} onClose={() => { setEditRole(null); setAddRoleModal(false) }} onSave={handleSaveRole} />}
      {(editUser || addUserModal) && <UserModal user={editUser} roles={roles} onClose={() => { setEditUser(null); setAddUserModal(false) }} onSave={handleSaveUser} />}
    </div>
  )
}

function RoleModal({ role, onClose, onSave }: { role: OperatorRole | null; onClose: () => void; onSave: (r: OperatorRole) => void }) {
  const [form, setForm] = useState<OperatorRole>(role || {
    id: '', name: '', description: '', is_builtin: false, assigned_count: 0, audit_categories: [], capabilities: {}, sort_order: 0,
  })
  useEffect(() => { if (role) setForm(role) }, [role])

  const handleSave = () => {
    if (!form.name.trim()) { toast('Role name is required', 'error'); return }
    onSave(form)
  }

  return (
    <Modal open onClose={onClose} title={role ? 'Edit Role' : 'New Role'}
      footer={<><Btn variant="secondary" size="sm" onClick={onClose}>Cancel</Btn><Btn size="sm" onClick={handleSave}>Save</Btn></>}>
      <FormField label="Role name" required><TextInput value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></FormField>
      <FormField label="Description"><TextArea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></FormField>
      <FormField label="Audit categories (comma-separated)"><TextInput value={form.audit_categories.join(', ')} onChange={(e) => setForm({ ...form, audit_categories: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })} /></FormField>
      <div style={{ marginTop: '16px' }}>
        <h4 style={{ fontSize: 'var(--text-sm)', fontWeight: 700, marginBottom: '8px' }}>Capabilities</h4>
        <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', marginBottom: '12px' }}>Each capability: none, scoped, or full. Click to cycle.</p>
        {Object.keys(form.capabilities).length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {Object.entries(form.capabilities).map(([key, val]) => (
              <div key={key} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ flex: 1, fontSize: 'var(--text-sm)' }}>{key}</span>
                <Select value={val} onChange={(e) => setForm({ ...form, capabilities: { ...form.capabilities, [key]: e.target.value } })} style={{ width: 'auto' }}>
                  <option value="none">None</option><option value="scoped">Scoped</option><option value="full">Full</option>
                </Select>
              </div>
            ))}
          </div>
        ) : <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>No capabilities defined.</p>}
        <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
          <TextInput id="new-cap" placeholder="Add capability..." style={{ flex: 1 }} />
          <Btn variant="secondary" size="sm" onClick={() => { const input = document.getElementById('new-cap') as HTMLInputElement; if (input?.value.trim()) { setForm({ ...form, capabilities: { ...form.capabilities, [input.value.trim()]: 'none' } }); input.value = '' } }}>Add</Btn>
        </div>
      </div>
    </Modal>
  )
}

function UserModal({ user, roles, onClose, onSave }: { user: OperatorUser | null; roles: OperatorRole[]; onClose: () => void; onSave: (u: OperatorUser) => void }) {
  const [form, setForm] = useState<OperatorUser>(user || {
    id: '', name: '', email: '', role_id: '', role_name: '', status: 'active', last_active: null, mfa_enabled: false, joined_at: new Date().toISOString(), sort_order: 0,
  })
  useEffect(() => { if (user) setForm(user) }, [user])

  const handleSave = () => {
    if (!form.name.trim()) { toast('Name is required', 'error'); return }
    if (!form.email.trim()) { toast('Email is required', 'error'); return }
    if (!form.role_id) { toast('Role is required', 'error'); return }
    const role = roles.find(r => r.id === form.role_id)
    if (role) setForm(f => ({ ...f, role_name: role.name }))
    onSave({ ...form, role_name: role?.name || form.role_name })
  }

  return (
    <Modal open onClose={onClose} title={user ? 'Edit User' : 'Invite User'}
      footer={<><Btn variant="secondary" size="sm" onClick={onClose}>Cancel</Btn><Btn size="sm" onClick={handleSave}>{user ? 'Save' : 'Send invite'}</Btn></>}>
      <FormField label="Full name" required><TextInput value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></FormField>
      <FormField label="Email" required><TextInput type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></FormField>
      <FormField label="Role" required>
        <Select value={form.role_id} onChange={(e) => { const r = roles.find(x => x.id === e.target.value); setForm({ ...form, role_id: e.target.value, role_name: r?.name || '' }) }}>
          <option value="">Select a role...</option>
          {roles.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
        </Select>
      </FormField>
      <FormField label="MFA enabled">
        <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: 'var(--text-sm)', cursor: 'pointer' }}><input type="checkbox" checked={form.mfa_enabled} onChange={(e) => setForm({ ...form, mfa_enabled: e.target.checked })} /> Require MFA for this user</label>
      </FormField>
    </Modal>
  )
}
