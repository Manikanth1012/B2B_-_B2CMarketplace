import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import type { OperatorChannel } from '../../types'
import { SectionCard, Table, Td, StatusPill, EmptyState, Btn, Modal, FormField, TextInput, Select, TextArea, toast, ConfirmDialog } from './shared'
import { useMarket } from '../../lib/MarketContext'

export function OperatorChannels() {
  /* What the marketplace pays a carrier per message. It buys these centrally,
     in its own reporting currency — so this is not a per-market figure and does
     not want grouping. It wants the mark to come from the currency table
     instead of being typed, which is the difference between "this is dollars"
     and "somebody wrote a dollar sign". */
  const { book: moneyBook, fmtIn } = useMarket()
  const cost = (n: number) =>
    fmtIn(Number(n), moneyBook.currencies.find(c => c.is_reporting)?.code ?? 'USD')
  const [channels, setChannels] = useState<OperatorChannel[]>([])
  const [loading, setLoading] = useState(true)
  const [editModal, setEditModal] = useState<OperatorChannel | null>(null)
  const [addModal, setAddModal] = useState(false)

  useEffect(() => {
    supabase.from('operator_channels').select('*').order('sort_order').then(({ data }) => {
      if (data) setChannels(data as OperatorChannel[])
      setLoading(false)
    })
  }, [])

  if (loading) return <div style={{ textAlign: 'center', padding: '40px' }}><div className="spinner" style={{ margin: '0 auto' }} /></div>

  const refresh = async () => {
    const { data } = await supabase.from('operator_channels').select('*').order('sort_order')
    if (data) setChannels(data as OperatorChannel[])
  }

  const handleToggle = async (c: OperatorChannel) => {
    await supabase.from('operator_channels').update({ enabled: !c.enabled }).eq('id', c.id)
    toast(`Channel ${c.enabled ? 'disabled' : 'enabled'}`)
    await refresh()
  }

  const handleDelete = async (id: string) => {
    await supabase.from('operator_channels').delete().eq('id', id)
    toast('Channel deleted')
    await refresh()
  }

  const handleSave = async (c: OperatorChannel) => {
    if (c.id) {
      await supabase.from('operator_channels').update(c).eq('id', c.id)
      toast('Channel updated')
    } else {
      const id = `ch-${Date.now()}`
      const sortOrder = channels.length > 0 ? Math.max(...channels.map(x => x.sort_order)) + 1 : 0
      await supabase.from('operator_channels').insert({ ...c, id, sort_order: sortOrder })
      toast('Channel created')
    }
    await refresh()
    setEditModal(null)
    setAddModal(false)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <h1 style={{ fontSize: 'var(--text-2xl)', fontWeight: 800, color: 'var(--text)' }}>Channels</h1>
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)', marginTop: '4px' }}>{channels.length} channels · {channels.filter(c => c.enabled).length} enabled · {channels.filter(c => c.is_primary).length} primary</p>
        </div>
        <Btn onClick={() => setAddModal(true)}>New channel</Btn>
      </div>

      {/* Twelve columns did not fit, and the twelfth held the buttons. Two pairs
          collapse because each pair was always one fact: a transport and its
          protocol are how the message is carried, and whether a channel is
          primary is part of its status rather than a column of dashes beside it. */}
      <SectionCard title="Channel Master" subtitle="A channel is what the customer experiences; a provider is what carries it.">
        {channels.length === 0 ? <EmptyState message="No channels configured" /> : (
          <Table headers={['Name', 'Type', 'Transport', 'Sender', 'Throughput', 'Cost', 'Success', 'Receipt', 'Status', 'Actions']}>
            {channels.map(c => (
              <tr key={c.id}>
                <Td>{c.name}</Td>
                <Td right>{c.type}</Td>
                <Td right>
                  {c.transport}
                  <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>{c.protocol}</div>
                </Td>
                <Td right>{c.sender}</Td>
                <Td right>{c.throughput}/s</Td>
                <Td right>{cost(c.unit_cost)}</Td>
                <Td right>{c.success_rate > 0 ? `${c.success_rate}%` : '—'}</Td>
                <Td right>{c.has_receipt ? 'Yes' : <span style={{ color: 'var(--warning)', fontWeight: 600 }}>No</span>}</Td>
                <Td right>
                  <StatusPill status={c.enabled ? 'active' : 'paused'} />
                  {c.is_primary && (
                    <div style={{ fontSize: 'var(--text-xs)', color: 'var(--brand-navy)', fontWeight: 700, marginTop: '2px' }}>Primary</div>
                  )}
                </Td>
                <Td right>
                  <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end' }}>
                    <Btn variant="secondary" size="sm" onClick={() => setEditModal(c)}>Edit</Btn>
                    <Btn variant="secondary" size="sm" onClick={() => handleToggle(c)}>{c.enabled ? 'Disable' : 'Enable'}</Btn>
                    <Btn variant="danger" size="sm" onClick={() => handleDelete(c.id)}>Delete</Btn>
                  </div>
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </SectionCard>

      <SectionCard title="Delivery Notes" subtitle="Push has no true delivery receipt — acceptance only, not that a handset displayed anything">
        <div style={{ padding: '20px' }}>
          <ul style={{ paddingLeft: '20px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <li style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>Push success rate is <strong>not averaged</strong> into the platform-wide delivery figure.</li>
            <li style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>Hard rejections (invalid number, unsubscribed, blocked) are <strong>never retried</strong>.</li>
            <li style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>Failover is automatic after a defined number of attempts on the primary.</li>
            <li style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>Cost is reported per channel, per message and per thousand.</li>
          </ul>
        </div>
      </SectionCard>

      {(editModal || addModal) && <ChannelModal channel={editModal} onClose={() => { setEditModal(null); setAddModal(false) }} onSave={handleSave} />}
    </div>
  )
}

function ChannelModal({ channel, onClose, onSave }: { channel: OperatorChannel | null; onClose: () => void; onSave: (c: OperatorChannel) => void }) {
  const [form, setForm] = useState<OperatorChannel>(channel || {
    id: '', name: '', type: 'digital', transport: '', protocol: 'REST', sender: '', throughput: 100,
    unit_cost: 0, success_rate: 0, region: 'global', has_receipt: true, is_primary: false, enabled: true, note: '', sort_order: 0,
  })
  useEffect(() => { if (channel) setForm(channel) }, [channel])

  const handleSave = () => {
    if (!form.name.trim()) { toast('Channel name is required', 'error'); return }
    if (!form.transport.trim()) { toast('Transport is required', 'error'); return }
    onSave(form)
  }

  return (
    <Modal open onClose={onClose} title={channel ? 'Edit Channel' : 'New Channel'}
      footer={<><Btn variant="secondary" size="sm" onClick={onClose}>Cancel</Btn><Btn size="sm" onClick={handleSave}>Save</Btn></>}>
      <div style={{ display: 'flex', gap: '12px' }}>
        <div style={{ flex: 1 }}><FormField label="Name" required><TextInput value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></FormField></div>
        <div style={{ flex: 1 }}><FormField label="Type"><Select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}><option value="digital">Digital</option><option value="telecom">Telecom</option></Select></FormField></div>
      </div>
      <div style={{ display: 'flex', gap: '12px' }}>
        <div style={{ flex: 1 }}><FormField label="Transport" required><TextInput value={form.transport} onChange={(e) => setForm({ ...form, transport: e.target.value })} placeholder="e.g. Route Mobile, AWS SES" /></FormField></div>
        <div style={{ flex: 1 }}><FormField label="Protocol"><TextInput value={form.protocol} onChange={(e) => setForm({ ...form, protocol: e.target.value })} placeholder="e.g. SMPP 3.4, REST, SMTP" /></FormField></div>
      </div>
      <FormField label="Sender identity"><TextInput value={form.sender} onChange={(e) => setForm({ ...form, sender: e.target.value })} placeholder="e.g. AVENTA, noreply@aventa.com" /></FormField>
      <div style={{ display: 'flex', gap: '12px' }}>
        <div style={{ flex: 1 }}><FormField label="Throughput (msg/s)"><TextInput type="number" value={form.throughput} onChange={(e) => setForm({ ...form, throughput: parseInt(e.target.value) || 0 })} /></FormField></div>
        <div style={{ flex: 1 }}><FormField label="Unit cost"><TextInput type="number" step="0.0001" value={form.unit_cost} onChange={(e) => setForm({ ...form, unit_cost: parseFloat(e.target.value) || 0 })} /></FormField></div>
        <div style={{ flex: 1 }}><FormField label="Success rate %"><TextInput type="number" step="0.1" value={form.success_rate} onChange={(e) => setForm({ ...form, success_rate: parseFloat(e.target.value) || 0 })} /></FormField></div>
      </div>
      <FormField label="Region"><TextInput value={form.region} onChange={(e) => setForm({ ...form, region: e.target.value })} /></FormField>
      <FormField label="Note"><TextArea value={form.note || ''} onChange={(e) => setForm({ ...form, note: e.target.value })} /></FormField>
      <div style={{ display: 'flex', gap: '12px' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: 'var(--text-sm)', cursor: 'pointer' }}><input type="checkbox" checked={form.has_receipt} onChange={(e) => setForm({ ...form, has_receipt: e.target.checked })} /> Has delivery receipt</label>
        <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: 'var(--text-sm)', cursor: 'pointer' }}><input type="checkbox" checked={form.is_primary} onChange={(e) => setForm({ ...form, is_primary: e.target.checked })} /> Primary channel</label>
        <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: 'var(--text-sm)', cursor: 'pointer' }}><input type="checkbox" checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} /> Enabled</label>
      </div>
    </Modal>
  )
}
