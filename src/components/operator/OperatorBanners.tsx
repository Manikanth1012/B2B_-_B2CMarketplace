import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import type { OperatorBanner } from '../../types'
import { SectionCard, Table, Td, StatusPill, EmptyState, fmtInt, fmtMoney, fmtDate, Btn, Modal, FormField, TextInput, Select, TextArea, toast, ConfirmDialog } from './shared'

export function OperatorBanners() {
  const [banners, setBanners] = useState<OperatorBanner[]>([])
  const [loading, setLoading] = useState(true)
  const [editModal, setEditModal] = useState<OperatorBanner | null>(null)
  const [addModal, setAddModal] = useState(false)

  useEffect(() => {
    supabase.from('operator_banners').select('*').order('sort_order').then(({ data }) => {
      if (data) setBanners(data as OperatorBanner[])
      setLoading(false)
    })
  }, [])

  if (loading) return <div style={{ textAlign: 'center', padding: '40px' }}><div className="spinner" style={{ margin: '0 auto' }} /></div>

  const totalImpressions = banners.reduce((s, b) => s + b.impressions, 0)
  const totalClicks = banners.reduce((s, b) => s + b.clicks, 0)
  const totalRevenue = banners.reduce((s, b) => s + b.revenue, 0)
  const ctr = totalImpressions > 0 ? (totalClicks / totalImpressions * 100).toFixed(2) : '0'

  const refresh = async () => {
    const { data } = await supabase.from('operator_banners').select('*').order('sort_order')
    if (data) setBanners(data as OperatorBanner[])
  }

  const handleToggle = async (b: OperatorBanner) => {
    const newStatus = b.status === 'active' ? 'paused' : 'active'
    await supabase.from('operator_banners').update({ status: newStatus }).eq('id', b.id)
    toast(`Banner ${newStatus === 'active' ? 'activated' : 'paused'}`)
    await refresh()
  }

  const handleDelete = async (id: string) => {
    await supabase.from('operator_banners').delete().eq('id', id)
    toast('Banner deleted')
    await refresh()
  }

  const handleSave = async (b: OperatorBanner) => {
    if (b.id) {
      await supabase.from('operator_banners').update(b).eq('id', b.id)
      toast('Banner updated')
    } else {
      const id = `bn-${Date.now()}`
      const sortOrder = banners.length > 0 ? Math.max(...banners.map(x => x.sort_order)) + 1 : 0
      await supabase.from('operator_banners').insert({ ...b, id, sort_order: sortOrder, status: 'active', impressions: 0, clicks: 0, revenue: 0 })
      toast('Banner created')
    }
    await refresh()
    setEditModal(null)
    setAddModal(false)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <h1 style={{ fontSize: 'var(--text-2xl)', fontWeight: 800, color: 'var(--text)' }}>Storefront Banners</h1>
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)', marginTop: '4px' }}>{banners.length} banners · {fmtInt(totalImpressions)} impressions · {ctr}% CTR · ${fmtMoney(totalRevenue)} attributed revenue</p>
        </div>
        <Btn onClick={() => setAddModal(true)}>New banner</Btn>
      </div>

      <SectionCard title="Banner Slots" subtitle="Login · Storefront hero · Storefront strip · Category header. Sellers cannot buy placement.">
        {banners.length === 0 ? <EmptyState message="No banners configured" /> : (
          <Table headers={['Slot', 'Title', 'Audience', 'Region', 'Weight', 'Impressions', 'Clicks', 'CTR', 'Revenue', 'Status', 'Actions']}>
            {banners.map(b => {
              const ctr = b.impressions > 0 ? (b.clicks / b.impressions * 100).toFixed(2) : '0'
              return (
                <tr key={b.id}>
                  <Td>{b.slot}</Td>
                  <Td>{b.title}</Td>
                  <Td right>{b.audience}</Td>
                  <Td right>{b.region}</Td>
                  <Td right>{b.weight}</Td>
                  <Td right>{fmtInt(b.impressions)}</Td>
                  <Td right>{fmtInt(b.clicks)}</Td>
                  <Td right>{ctr}%</Td>
                  <Td right>${fmtMoney(b.revenue)}</Td>
                  <Td right><StatusPill status={b.status} /></Td>
                  <Td right>
                    <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end' }}>
                      <Btn variant="secondary" size="sm" onClick={() => setEditModal(b)}>Edit</Btn>
                      <Btn variant="secondary" size="sm" onClick={() => handleToggle(b)}>{b.status === 'active' ? 'Pause' : 'Activate'}</Btn>
                      <Btn variant="danger" size="sm" onClick={() => handleDelete(b.id)}>Delete</Btn>
                    </div>
                  </Td>
                </tr>
              )
            })}
          </Table>
        )}
      </SectionCard>

      {(editModal || addModal) && <BannerModal banner={editModal} onClose={() => { setEditModal(null); setAddModal(false) }} onSave={handleSave} />}
    </div>
  )
}

function BannerModal({ banner, onClose, onSave }: { banner: OperatorBanner | null; onClose: () => void; onSave: (b: OperatorBanner) => void }) {
  const [form, setForm] = useState<OperatorBanner>(banner || {
    id: '', slot: 'login', title: '', subtitle: '', cta: 'Shop now', audience: 'all', region: 'all', device: 'all',
    weight: 50, impressions: 0, clicks: 0, revenue: 0, status: 'active', starts_at: null, ends_at: null, sort_order: 0,
  })
  useEffect(() => { if (banner) setForm(banner) }, [banner])

  const handleSave = () => {
    if (!form.title.trim()) { toast('Title is required', 'error'); return }
    onSave(form)
  }

  return (
    <Modal open onClose={onClose} title={banner ? 'Edit Banner' : 'New Banner'}
      footer={<><Btn variant="secondary" size="sm" onClick={onClose}>Cancel</Btn><Btn size="sm" onClick={handleSave}>Save</Btn></>}>
      <div style={{ display: 'flex', gap: '12px' }}>
        <div style={{ flex: 1 }}><FormField label="Slot" required><Select value={form.slot} onChange={(e) => setForm({ ...form, slot: e.target.value })}><option value="login">Login screen</option><option value="storefront_hero">Storefront hero</option><option value="storefront_strip">Storefront strip</option><option value="category_header">Category header</option></Select></FormField></div>
        <div style={{ flex: 1 }}><FormField label="Weight (share of voice)"><TextInput type="number" value={form.weight} onChange={(e) => setForm({ ...form, weight: parseInt(e.target.value) || 50 })} /></FormField></div>
      </div>
      <FormField label="Title" required><TextInput value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></FormField>
      <FormField label="Subtitle"><TextInput value={form.subtitle || ''} onChange={(e) => setForm({ ...form, subtitle: e.target.value })} /></FormField>
      <FormField label="CTA text"><TextInput value={form.cta} onChange={(e) => setForm({ ...form, cta: e.target.value })} /></FormField>
      <div style={{ display: 'flex', gap: '12px' }}>
        <div style={{ flex: 1 }}><FormField label="Audience"><Select value={form.audience} onChange={(e) => setForm({ ...form, audience: e.target.value })}><option value="all">All</option><option value="consumer">Consumer</option><option value="enterprise">Enterprise</option></Select></FormField></div>
        <div style={{ flex: 1 }}><FormField label="Device"><Select value={form.device} onChange={(e) => setForm({ ...form, device: e.target.value })}><option value="all">All</option><option value="desktop">Desktop</option><option value="mobile">Mobile</option></Select></FormField></div>
      </div>
      <FormField label="Region"><TextInput value={form.region} onChange={(e) => setForm({ ...form, region: e.target.value })} placeholder="e.g. India, UAE, all" /></FormField>
      <div style={{ display: 'flex', gap: '12px' }}>
        <div style={{ flex: 1 }}><FormField label="Start date"><TextInput type="date" value={form.starts_at?.slice(0, 10) || ''} onChange={(e) => setForm({ ...form, starts_at: e.target.value ? new Date(e.target.value).toISOString() : null })} /></FormField></div>
        <div style={{ flex: 1 }}><FormField label="End date"><TextInput type="date" value={form.ends_at?.slice(0, 10) || ''} onChange={(e) => setForm({ ...form, ends_at: e.target.value ? new Date(e.target.value).toISOString() : null })} /></FormField></div>
      </div>
    </Modal>
  )
}
