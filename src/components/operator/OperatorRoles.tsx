import { useState, useEffect } from 'react'
import { Pager, usePaging } from '../Pager'
import { supabase } from '../../lib/supabase'
import type { OperatorRole, OperatorUser } from '../../types'
import { SectionCard, Table, Td, StatusPill, EmptyState, fmtDateTime, Btn, Modal, FormField, TextInput, Select, TextArea, toast, ConfirmDialog } from './shared'
import {
  byArea, matching, levelOf, summarise, validateRole, emptyCapabilities, fillGaps,
} from '../../lib/operatorAccess'
import type { CapabilityDef, AuditCategoryDef, CapabilityLevel } from '../../lib/operatorAccess'

export function OperatorRoles() {
  const [roles, setRoles] = useState<OperatorRole[]>([])
  const [users, setUsers] = useState<OperatorUser[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<'roles' | 'users'>('roles')
  const [editRole, setEditRole] = useState<OperatorRole | null>(null)
  const [addRoleModal, setAddRoleModal] = useState(false)
  const [addUserModal, setAddUserModal] = useState(false)
  const [editUser, setEditUser] = useState<OperatorUser | null>(null)
  /* What the console actually has. The form used to ask an operator to type
     these from memory into a comma-separated box, with nothing offering the
     values and nothing checking them. */
  const [caps, setCaps] = useState<CapabilityDef[]>([])
  const [cats, setCats] = useState<AuditCategoryDef[]>([])

  useEffect(() => {
    Promise.all([
      supabase.from('operator_roles').select('*').order('sort_order'),
      supabase.from('operator_users').select('*').order('sort_order'),
      supabase.from('operator_capabilities').select('*').order('sort_order'),
      supabase.from('operator_audit_categories').select('*').order('sort_order'),
    ]).then(([r, u, c, a]) => {
      if (r.data) setRoles(r.data as OperatorRole[])
      if (u.data) setUsers(u.data as OperatorUser[])
      if (c.data) setCaps(c.data as CapabilityDef[])
      if (a.data) setCats(a.data as AuditCategoryDef[])
      setLoading(false)
    })
  }, [])

  /* Above the loading guard: `usePaging` is a hook, and a hook after an
     early return runs on some renders and not others. */
  const rolesPage = usePaging(roles)
  const usersPage = usePaging(users)

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
            <><Table headers={['Role', 'Description', 'Assigned', 'Audit Scope', 'Capabilities', 'Actions']}>
              {rolesPage.rows.map(r => {
                /* The same summary the editor shows. This counted `full` and
                   `scoped` only, so the Read-Only Analyst's three read-only
                   grants read as "0 full · 0 scoped" — a role that looked empty
                   on the one screen that lists them all. */
                const held = summarise(r.capabilities, caps)
                return (
                  <tr key={r.id}>
                    <Td>{r.name}{r.is_builtin && <span style={{ fontSize: '10px', color: 'var(--text-tertiary)', marginLeft: '4px' }}>built-in</span>}</Td>
                    <Td>{r.description}</Td>
                    <Td right>{r.assigned_count}</Td>
                    <Td right>{r.audit_categories.length} {r.audit_categories.length === 1 ? 'category' : 'categories'}</Td>
                    <Td right>{held.text}</Td>
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
            <div style={{ padding: '0 18px 12px' }}><Pager page={rolesPage} noun="roles" /></div></>
          )}
        </SectionCard>
      )}

      {tab === 'users' && (
        <SectionCard title="User Directory" subtitle="All operator staff">
          {users.length === 0 ? <EmptyState message="No users" /> : (
            <><Table headers={['Name', 'Email', 'Role', 'MFA', 'Status', 'Last Active', 'Actions']}>
              {usersPage.rows.map(u => (
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
            <div style={{ padding: '0 18px 12px' }}><Pager page={usersPage} noun="users" /></div></>
          )}
        </SectionCard>
      )}

      {(editRole || addRoleModal) && <RoleModal role={editRole} caps={caps} cats={cats} onClose={() => { setEditRole(null); setAddRoleModal(false) }} onSave={handleSaveRole} />}
      {(editUser || addUserModal) && <UserModal user={editUser} roles={roles} onClose={() => { setEditUser(null); setAddUserModal(false) }} onSave={handleSaveUser} />}
    </div>
  )
}

/* The three settings, as a segmented control rather than a dropdown. Twenty-
   eight dropdowns is twenty-eight clicks before you can even read the state;
   three buttons show the current one and set any other in a single click. */
const LEVEL_LABEL: Record<CapabilityLevel, string> = {
  none: 'None', read: 'Read', scoped: 'Scoped', full: 'Full',
}
const LEVEL_TINT: Record<CapabilityLevel, string> = {
  none: 'var(--text-tertiary)', read: 'var(--info)', scoped: '#B26A00', full: 'var(--success)',
}

function LevelPicker({ value, scopable, onChange }: {
  value: CapabilityLevel; scopable: boolean; onChange: (l: CapabilityLevel) => void
}) {
  /* A capability that cannot be scoped drops that one button rather than
     showing it greyed — a disabled control invites the question of what it
     would have meant. `read` is always offered: nothing here can only be looked
     at in full or not at all. */
  const options: CapabilityLevel[] = scopable
    ? ['none', 'read', 'scoped', 'full']
    : ['none', 'read', 'full']
  return (
    <div role="group" style={{ display: 'flex', border: '1px solid var(--border)', borderRadius: 'var(--radius)', overflow: 'hidden' }}>
      {options.map(l => (
        <button key={l} type="button" onClick={() => onChange(l)} aria-pressed={value === l}
          style={{
            padding: '4px 10px', fontSize: '11px', fontWeight: 700, cursor: 'pointer',
            border: 'none', borderLeft: l === options[0] ? 'none' : '1px solid var(--border)',
            background: value === l ? LEVEL_TINT[l] : 'white',
            color: value === l ? 'white' : 'var(--text-tertiary)',
          }}>{LEVEL_LABEL[l]}</button>
      ))}
    </div>
  )
}

function RoleModal({ role, caps, cats, onClose, onSave }: {
  role: OperatorRole | null
  caps: CapabilityDef[]
  cats: AuditCategoryDef[]
  onClose: () => void
  onSave: (r: OperatorRole) => void
}) {
  const [form, setForm] = useState<OperatorRole>(role || {
    id: '', name: '', description: '', is_builtin: false, assigned_count: 0, audit_categories: [], capabilities: {}, sort_order: 0,
  })
  const [filter, setFilter] = useState('')
  useEffect(() => { if (role) setForm(role) }, [role])

  /* Every capability the console has, at whatever level this role holds it.
     The form used to list only the keys already on the role, so a capability
     added since it was made was invisible — and the only way to grant it was to
     type its name correctly from memory. */
  useEffect(() => {
    if (!caps.length) return
    setForm(f => ({ ...f, capabilities: role ? fillGaps(f.capabilities, caps) : emptyCapabilities(caps) }))
  }, [caps, role])

  const setLevel = (id: string, level: CapabilityLevel) =>
    setForm(f => ({ ...f, capabilities: { ...f.capabilities, [id]: level } }))

  const toggleCategory = (id: string) => setForm(f => ({
    ...f,
    audit_categories: f.audit_categories.includes(id)
      ? f.audit_categories.filter(c => c !== id)
      : [...f.audit_categories, id],
  }))

  const setArea = (area: string, level: CapabilityLevel) => setForm(f => ({
    ...f,
    capabilities: {
      ...f.capabilities,
      ...Object.fromEntries(caps.filter(c => c.area === area)
        .map(c => [c.id, level === 'scoped' && !c.scopable ? 'full' : level])),
    },
  }))

  const handleSave = () => {
    const check = validateRole(form, { categories: cats, capabilities: caps })
    if (!check.ok) { toast(check.reason, 'error'); return }
    onSave(form)
  }

  const shown = matching(caps, filter)
  const total = summarise(form.capabilities, caps)

  return (
    <Modal open onClose={onClose} title={role ? 'Edit Role' : 'New Role'}
      footer={<>
        <span style={{ flex: 1, fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
          {total.text}{form.audit_categories.length > 0
            ? ` · ${form.audit_categories.length} audit ${form.audit_categories.length === 1 ? 'category' : 'categories'}`
            : ''}
        </span>
        <Btn variant="secondary" size="sm" onClick={onClose}>Cancel</Btn>
        <Btn size="sm" onClick={handleSave}>Save</Btn>
      </>}>
      <FormField label="Role name" required><TextInput value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></FormField>
      <FormField label="Description"><TextArea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></FormField>

      {/* Was a comma-separated box. Nobody remembers thirteen category names,
          and a typo saved cleanly as a role scoped to nothing. */}
      <FormField label="Audit categories"
        hint="Which parts of the audit trail this role may read. Leave empty for none.">
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
          {cats.map(c => {
            const on = form.audit_categories.includes(c.id)
            return (
              <button key={c.id} type="button" onClick={() => toggleCategory(c.id)} title={c.covers}
                aria-pressed={on}
                style={{
                  padding: '5px 10px', borderRadius: 'var(--radius-full)', cursor: 'pointer',
                  fontSize: '12px', fontWeight: 600,
                  border: `1px solid ${on ? 'var(--brand-navy)' : 'var(--border)'}`,
                  background: on ? 'var(--brand-navy)' : 'white',
                  color: on ? 'white' : 'var(--text-secondary)',
                }}>{c.label}</button>
            )
          })}
        </div>
      </FormField>

      <div style={{ marginTop: '16px' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '12px', marginBottom: '4px' }}>
          <h4 style={{ fontSize: 'var(--text-sm)', fontWeight: 700 }}>Capabilities</h4>
          <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>{total.text}</span>
        </div>
        <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', marginBottom: '10px' }}>
          Everything this console can do. Read is look but do not change; Scoped is act, but only within the seller,
          market or queue the holder is assigned. A few cannot be scoped.
        </p>

        <TextInput value={filter} onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter — name, area, or what it covers (try “webhooks”)" style={{ marginBottom: '10px' }} />

        {shown.length === 0
          ? <EmptyState message={`Nothing matches “${filter}”. The console has ${caps.length} capabilities.`} />
          : byArea(shown).map(group => (
            <div key={group.area} style={{ marginBottom: '14px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
                <h5 style={{ fontSize: '11px', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text-tertiary)' }}>{group.area}</h5>
                {/* Granting a whole area at once. Eight areas beats twenty-eight
                    rows when the intent is "everything in support". */}
                <div style={{ display: 'flex', gap: '6px' }}>
                  <button type="button" onClick={() => setArea(group.area, 'full')}
                    style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: '11px', fontWeight: 700, color: 'var(--brand-accent)' }}>All</button>
                  <button type="button" onClick={() => setArea(group.area, 'none')}
                    style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: '11px', fontWeight: 700, color: 'var(--text-tertiary)' }}>None</button>
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                {group.caps.map(c => {
                  const level = levelOf(form.capabilities, c.id)
                  return (
                    <div key={c.id} style={{
                      display: 'flex', alignItems: 'center', gap: '12px', padding: '6px 8px',
                      borderRadius: 'var(--radius)',
                      background: level === 'none' ? 'transparent' : 'rgba(0,166,166,0.05)',
                    }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--text)' }}>{c.label}</div>
                        {/* The sentence that stops anybody having to go and look
                            it up. `mor` is the reason this line exists. */}
                        <div style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>{c.covers}</div>
                      </div>
                      <LevelPicker value={level} scopable={c.scopable}
                        onChange={(l) => setLevel(c.id, l)} />
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
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
