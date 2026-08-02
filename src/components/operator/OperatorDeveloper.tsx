import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import type { OperatorApi, OperatorApiSubscription } from '../../types'
import { SectionCard, Table, Td, StatusPill, EmptyState, fmtInt, Btn, Modal, FormField, TextInput, Select, TextArea, toast, ConfirmDialog } from './shared'

export function OperatorDeveloper() {
  const [apis, setApis] = useState<OperatorApi[]>([])
  const [subs, setSubs] = useState<OperatorApiSubscription[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<'apis' | 'subscriptions'>('apis')
  const [editApi, setEditApi] = useState<OperatorApi | null>(null)
  const [addApiModal, setAddApiModal] = useState(false)
  const [addSubModal, setAddSubModal] = useState(false)

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

  const refreshApis = async () => {
    const { data } = await supabase.from('operator_apis').select('*').order('sort_order')
    if (data) setApis(data as OperatorApi[])
  }
  const refreshSubs = async () => {
    const { data } = await supabase.from('operator_api_subscriptions').select('*').order('sort_order')
    if (data) setSubs(data as OperatorApiSubscription[])
  }

  const handleDeleteApi = async (id: string) => {
    const subCount = subs.filter(s => s.api_id === id).length
    if (subCount > 0) { toast(`Cannot delete — ${subCount} subscriptions still active on this API`, 'error'); return }
    await supabase.from('operator_apis').delete().eq('id', id)
    toast('API deleted')
    await refreshApis()
  }

  const handleDeleteSub = async (id: string) => {
    await supabase.from('operator_api_subscriptions').delete().eq('id', id)
    toast('Subscription removed')
    await refreshSubs()
  }

  const handleSaveApi = async (a: OperatorApi) => {
    if (a.id) {
      await supabase.from('operator_apis').update(a).eq('id', a.id)
      toast('API updated')
    } else {
      const id = `AP-${Date.now().toString().slice(-4)}`
      const sortOrder = apis.length > 0 ? Math.max(...apis.map(x => x.sort_order)) + 1 : 0
      await supabase.from('operator_apis').insert({ ...a, id, sort_order: sortOrder, lifecycle: 'current', subscriber_count: 0 })
      toast('API published')
    }
    await refreshApis()
    setEditApi(null)
    setAddApiModal(false)
  }

  const handleAddSub = async (sub: OperatorApiSubscription) => {
    const id = `sub-${Date.now()}`
    const sortOrder = subs.length > 0 ? Math.max(...subs.map(x => x.sort_order)) + 1 : 0
    await supabase.from('operator_api_subscriptions').insert({ ...sub, id, sort_order: sortOrder, status: 'active', started_at: new Date().toISOString() })
    toast('Subscription created')
    await refreshSubs()
    setAddSubModal(false)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <h1 style={{ fontSize: 'var(--text-2xl)', fontWeight: 800, color: 'var(--text)' }}>Developer Portal</h1>
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)', marginTop: '4px' }}>{apis.length} published APIs · {subs.length} active subscriptions · Integration access, not a product line</p>
        </div>
        <Btn onClick={() => tab === 'apis' ? setAddApiModal(true) : setAddSubModal(true)}>{tab === 'apis' ? 'Publish API' : 'Add subscription'}</Btn>
      </div>

      <div style={{ display: 'flex', gap: '8px' }}>
        {[{ id: 'apis' as const, label: 'APIs' }, { id: 'subscriptions' as const, label: 'Subscriptions' }].map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{ padding: '8px 16px', borderRadius: 'var(--radius)', fontSize: 'var(--text-sm)', fontWeight: 600, background: tab === t.id ? 'var(--brand-navy)' : 'white', color: tab === t.id ? 'white' : 'var(--text-secondary)', border: '1px solid var(--border)', cursor: 'pointer' }}>{t.label}</button>
        ))}
      </div>

      {tab === 'apis' && (
        <SectionCard title="Published APIs" subtitle="Each declares the TMF standard it implements and its lifecycle state">
          {apis.length === 0 ? <EmptyState message="No APIs published" /> : (
            <Table headers={['Name', 'Standard', 'Audience', 'Version', 'Subscribers', 'Lifecycle',
                             { label: 'Why', align: 'left' }, 'Actions']}>
              {apis.map(a => (
                <tr key={a.id}>
                  <Td>{a.name}</Td>
                  <Td right>{a.standard}</Td>
                  <Td right>{a.audience}</Td>
                  <Td right>{a.version}</Td>
                  <Td right>{fmtInt(a.subscriber_count)}</Td>
                  <Td right><StatusPill status={a.lifecycle} /></Td>
                  {/* A sentence, so it wraps and aligns like one. It was marked
                      as a figure, which meant nowrap inside a 200px cell — the
                      text did not clip, it ran on under the buttons. */}
                  <Td style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', maxWidth: '260px' }}>{a.why}</Td>
                  <Td right>
                    <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end' }}>
                      <Btn variant="secondary" size="sm" onClick={() => setEditApi(a)}>Edit</Btn>
                      <Btn variant="danger" size="sm" onClick={() => handleDeleteApi(a.id)}>Delete</Btn>
                    </div>
                  </Td>
                </tr>
              ))}
            </Table>
          )}
        </SectionCard>
      )}

      {tab === 'subscriptions' && (
        <SectionCard title="Subscription Matrix" subtitle="APIs down, consumers across">
          {subs.length === 0 ? <EmptyState message="No subscriptions" /> : (
            <Table headers={['Consumer', 'API', 'Version', 'Environment', 'Volume', 'Status', 'Actions']}>
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
                    <Td right><Btn variant="danger" size="sm" onClick={() => handleDeleteSub(s.id)}>Remove</Btn></Td>
                  </tr>
                )
              })}
            </Table>
          )}
        </SectionCard>
      )}

      {(editApi || addApiModal) && <ApiModal api={editApi} onClose={() => { setEditApi(null); setAddApiModal(false) }} onSave={handleSaveApi} />}
      {addSubModal && <SubModal apis={apis} onClose={() => setAddSubModal(false)} onSave={handleAddSub} />}
    </div>
  )
}

function ApiModal({ api, onClose, onSave }: { api: OperatorApi | null; onClose: () => void; onSave: (a: OperatorApi) => void }) {
  const [form, setForm] = useState<OperatorApi>(api || {
    id: '', name: '', standard: 'TMF620', audience: 'Sellers', description: '', why: '', scopes: [], methods: ['GET'], environments: ['sandbox'], lifecycle: 'current', version: '1.0', subscriber_count: 0, sort_order: 0,
  })
  useEffect(() => { if (api) setForm(api) }, [api])

  const handleSave = () => {
    if (!form.name.trim()) { toast('Name is required', 'error'); return }
    if (!form.why.trim()) { toast('You must answer why this API exists in one line', 'error'); return }
    onSave(form)
  }

  return (
    <Modal open onClose={onClose} title={api ? 'Edit API' : 'Publish API'}
      footer={<><Btn variant="secondary" size="sm" onClick={onClose}>Cancel</Btn><Btn size="sm" onClick={handleSave}>Save</Btn></>}>
      <FormField label="Name" required><TextInput value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></FormField>
      <div style={{ display: 'flex', gap: '12px' }}>
        <div style={{ flex: 1 }}><FormField label="TMF Standard"><TextInput value={form.standard} onChange={(e) => setForm({ ...form, standard: e.target.value })} /></FormField></div>
        <div style={{ flex: 1 }}><FormField label="Version"><TextInput value={form.version} onChange={(e) => setForm({ ...form, version: e.target.value })} /></FormField></div>
      </div>
      <FormField label="Audience"><TextInput value={form.audience} onChange={(e) => setForm({ ...form, audience: e.target.value })} placeholder="Sellers, Buyers, Sellers + Buyers" /></FormField>
      <FormField label="Description"><TextArea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></FormField>
      <FormField label="Why does this API exist? (one line)" required hint="If it cannot answer this, it probably should not be published."><TextInput value={form.why} onChange={(e) => setForm({ ...form, why: e.target.value })} /></FormField>
      <FormField label="Lifecycle"><Select value={form.lifecycle} onChange={(e) => setForm({ ...form, lifecycle: e.target.value })}><option value="current">Current</option><option value="supported">Supported</option><option value="deprecated">Deprecated</option><option value="sunset">Sunset</option></Select></FormField>
    </Modal>
  )
}

function SubModal({ apis, onClose, onSave }: { apis: OperatorApi[]; onClose: () => void; onSave: (s: OperatorApiSubscription) => void }) {
  const [form, setForm] = useState<OperatorApiSubscription>({
    id: '', api_id: '', consumer_name: '', version: '', environment: 'sandbox', scopes: [], volume: 0, started_at: new Date().toISOString(), status: 'active', sort_order: 0,
  })

  const handleSave = () => {
    if (!form.api_id) { toast('API is required', 'error'); return }
    if (!form.consumer_name.trim()) { toast('Consumer name is required', 'error'); return }
    const api = apis.find(a => a.id === form.api_id)
    if (api) setForm(f => ({ ...f, version: f.version || api.version }))
    onSave({ ...form, version: form.version || api?.version || '' })
  }

  return (
    <Modal open onClose={onClose} title="Add Subscription"
      footer={<><Btn variant="secondary" size="sm" onClick={onClose}>Cancel</Btn><Btn size="sm" onClick={handleSave}>Create</Btn></>}>
      <FormField label="API" required>
        <Select value={form.api_id} onChange={(e) => setForm({ ...form, api_id: e.target.value })}>
          <option value="">Select an API...</option>
          {apis.map(a => <option key={a.id} value={a.id}>{a.name} ({a.standard})</option>)}
        </Select>
      </FormField>
      <FormField label="Consumer name" required><TextInput value={form.consumer_name} onChange={(e) => setForm({ ...form, consumer_name: e.target.value })} placeholder="e.g. TechDyne Devices" /></FormField>
      <div style={{ display: 'flex', gap: '12px' }}>
        <div style={{ flex: 1 }}><FormField label="Version"><TextInput value={form.version} onChange={(e) => setForm({ ...form, version: e.target.value })} placeholder="Auto-filled from API" /></FormField></div>
        <div style={{ flex: 1 }}><FormField label="Environment"><Select value={form.environment} onChange={(e) => setForm({ ...form, environment: e.target.value })}><option value="sandbox">Sandbox</option><option value="production">Production</option></Select></FormField></div>
      </div>
      <FormField label="Expected volume (calls/month)"><TextInput type="number" value={form.volume} onChange={(e) => setForm({ ...form, volume: parseInt(e.target.value) || 0 })} /></FormField>
    </Modal>
  )
}
