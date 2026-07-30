import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import type { OperatorListing } from '../../types'
import { SectionCard, Table, Td, StatusPill, EmptyState, fmtMoney, fmtDate, Btn, Modal, FormField, TextInput, Select, TextArea, toast, ConfirmDialog } from './shared'

export function OperatorCatalogue() {
  const [listings, setListings] = useState<OperatorListing[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<string>('all')
  const [editModal, setEditModal] = useState<OperatorListing | null>(null)
  const [addModal, setAddModal] = useState(false)
  const [rejectModal, setRejectModal] = useState<OperatorListing | null>(null)
  const [rejectReason, setRejectReason] = useState('')
  /* What each linked product actually sells for, which is not always what the seller
     submitted — ol-005 asked $899 and lists at $24. Keyed by SKU. */
  const [live, setLive] = useState<Record<string, number>>({})

  useEffect(() => {
    supabase.from('operator_listings').select('*').order('sort_order').then(({ data }) => {
      if (data) setListings(data as OperatorListing[])
      setLoading(false)
    })
    supabase.from('products').select('id, price').then(({ data }) => {
      if (data) setLive(Object.fromEntries((data as { id: string; price: number }[]).map(p => [p.id, p.price])))
    })
  }, [])

  if (loading) return <div style={{ textAlign: 'center', padding: '40px' }}><div className="spinner" style={{ margin: '0 auto' }} /></div>

  const filtered = filter === 'all' ? listings : listings.filter(l => l.status === filter)
  const pendingCount = listings.filter(l => l.status === 'pending').length
  const approvedCount = listings.filter(l => l.status === 'approved').length
  const rejectedCount = listings.filter(l => l.status === 'rejected').length

  const refresh = async () => {
    const { data } = await supabase.from('operator_listings').select('*').order('sort_order')
    if (data) setListings(data as OperatorListing[])
  }

  const handleApprove = async (id: string) => {
    await supabase.from('operator_listings').update({
      status: 'approved', reviewed_by: 'Catalogue Team', reviewed_at: new Date().toISOString(),
    }).eq('id', id)
    toast('Listing approved')
    await refresh()
  }

  const handleReject = async () => {
    if (!rejectModal) return
    if (!rejectReason.trim()) { toast('A rejection reason is required', 'error'); return }
    await supabase.from('operator_listings').update({
      status: 'rejected', reviewed_by: 'Catalogue Team', reviewed_at: new Date().toISOString(),
      notes: rejectReason,
    }).eq('id', rejectModal.id)
    toast('Listing rejected')
    setRejectReason('')
    setRejectModal(null)
    await refresh()
  }

  const handleDelete = async (id: string) => {
    await supabase.from('operator_listings').delete().eq('id', id)
    toast('Listing deleted')
    await refresh()
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <h1 style={{ fontSize: 'var(--text-2xl)', fontWeight: 800, color: 'var(--text)' }}>Catalogue Review</h1>
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)', marginTop: '4px' }}>{pendingCount} pending · {approvedCount} approved · {rejectedCount} rejected</p>
        </div>
        <Btn onClick={() => setAddModal(true)}>Add listing</Btn>
      </div>

      <div style={{ display: 'flex', gap: '8px' }}>
        {[{ id: 'all', label: 'All', count: listings.length }, { id: 'pending', label: 'Pending', count: pendingCount }, { id: 'approved', label: 'Approved', count: approvedCount }, { id: 'rejected', label: 'Rejected', count: rejectedCount }].map(f => (
          <button key={f.id} onClick={() => setFilter(f.id)} style={{ padding: '8px 16px', borderRadius: 'var(--radius)', fontSize: 'var(--text-sm)', fontWeight: 600, background: filter === f.id ? 'var(--brand-navy)' : 'white', color: filter === f.id ? 'white' : 'var(--text-secondary)', border: '1px solid var(--border)', cursor: 'pointer' }}>{f.label} ({f.count})</button>
        ))}
      </div>

      <SectionCard title="Product Listings" subtitle={`${filtered.length} listings`}>
        {filtered.length === 0 ? <EmptyState message="No listings in this filter" /> : (
          <Table headers={['Product', 'Partner', 'Category', 'Price', 'Margin', 'Status', 'In catalogue', 'Reviews', 'Actions']}>
            {filtered.map(l => {
              const margin = ((l.price - l.cost) / l.price * 100).toFixed(0)
              return (
                <tr key={l.id}>
                  <Td>{l.product_name}{l.version > 1 && <span style={{ fontSize: '10px', color: 'var(--text-tertiary)', marginLeft: '4px' }}>v{l.version}</span>}</Td>
                  <Td>{l.partner_name}</Td>
                  <Td>{l.category}</Td>
                  <Td right>${fmtMoney(l.price)}</Td>
                  <Td right style={{ color: Number(margin) < 20 ? 'var(--danger)' : 'var(--success)' }}>{margin}%</Td>
                  <Td right><StatusPill status={l.status} /></Td>
                  {/* A submission is not the same thing as a live product. This column
                      is the difference: which catalogue row the listing became, and
                      the price it actually sells at rather than the one submitted.
                      An approved listing with nothing here is the case worth seeing —
                      it was signed off and never reached the shelf. */}
                  <Td right>
                    {l.product_id
                      ? <span style={{ color: 'var(--text)' }}>
                          {l.product_id}
                          {live[l.product_id] !== undefined && (
                            <span style={{ color: 'var(--text-tertiary)', marginLeft: '6px' }}>${fmtMoney(live[l.product_id])}</span>
                          )}
                        </span>
                      : l.status === 'approved'
                        ? <span style={{ color: 'var(--warning, #B45309)', fontWeight: 600 }}>Not listed</span>
                        : <span style={{ color: 'var(--text-tertiary)' }}>—</span>}
                  </Td>
                  <Td right>{l.reviews > 0 ? `${l.reviews} (${l.rating?.toFixed(1)})` : '—'}</Td>
                  <Td right>
                    <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end' }}>
                      <Btn variant="secondary" size="sm" onClick={() => setEditModal(l)}>Edit</Btn>
                      {l.status === 'pending' && <Btn variant="success" size="sm" onClick={() => handleApprove(l.id)}>Approve</Btn>}
                      {l.status === 'pending' && <Btn variant="danger" size="sm" onClick={() => setRejectModal(l)}>Reject</Btn>}
                      <Btn variant="danger" size="sm" onClick={() => handleDelete(l.id)}>Delete</Btn>
                    </div>
                  </Td>
                </tr>
              )
            })}
          </Table>
        )}
      </SectionCard>

      {editModal && <ListingModal listing={editModal} onClose={() => setEditModal(null)} onSave={async (updated) => {
        await supabase.from('operator_listings').update(updated).eq('id', updated.id)
        toast('Listing updated')
        setEditModal(null)
        await refresh()
      }} />}

      {addModal && <ListingModal open onClose={() => setAddModal(false)} onSave={async (listing) => {
        const id = `ol-${Date.now()}`
        const sortOrder = listings.length > 0 ? Math.max(...listings.map(l => l.sort_order)) + 1 : 0
        await supabase.from('operator_listings').insert({ ...listing, id, sort_order: sortOrder, status: 'pending', submitted_at: new Date().toISOString(), reviews: 0, version: 1 })
        toast('Listing created')
        setAddModal(false)
        await refresh()
      }} />}

      <Modal open={!!rejectModal} onClose={() => setRejectModal(null)} title="Reject Listing"
        footer={<><Btn variant="secondary" size="sm" onClick={() => setRejectModal(null)}>Cancel</Btn><Btn variant="danger" size="sm" onClick={handleReject}>Reject listing</Btn></>}>
        <FormField label="Rejection reason" required hint="The seller will see this reason. A rejection that does not say what would fix it is a dead end.">
          <TextArea value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} placeholder="e.g. Missing alt text on product images. Please add descriptions and resubmit." />
        </FormField>
      </Modal>
    </div>
  )
}

function ListingModal({ listing, open, onClose, onSave }: {
  listing?: OperatorListing
  open?: boolean
  onClose: () => void
  onSave: (listing: OperatorListing) => void
}) {
  const [form, setForm] = useState<OperatorListing>(listing || {
    id: '', product_name: '', partner_name: '', category: 'Consumer', price: 0, cost: 0, status: 'pending',
    submitted_at: new Date().toISOString(), reviewed_by: null, reviewed_at: null, rating: null, reviews: 0,
    stock_status: 'in', version: 1, sort_order: 0,
    /* A new submission is not in the catalogue and has no partner resolved yet —
       both are decided by review, not by the form. */
    product_id: null, partner_id: null,
  })

  useEffect(() => {
    if (listing) setForm(listing)
  }, [listing])

  const handleSave = () => {
    if (!form.product_name.trim()) { toast('Product name is required', 'error'); return }
    if (form.price <= 0) { toast('Price must be greater than zero', 'error'); return }
    if (form.cost >= form.price) { toast('Cost must be below price — nothing sells at or below cost', 'error'); return }
    onSave(form)
  }

  return (
    <Modal open={open ?? true} onClose={onClose} title={listing ? 'Edit Listing' : 'New Listing'}
      footer={<><Btn variant="secondary" size="sm" onClick={onClose}>Cancel</Btn><Btn size="sm" onClick={handleSave}>Save</Btn></>}>
      <FormField label="Product name" required>
        <TextInput value={form.product_name} onChange={(e) => setForm({ ...form, product_name: e.target.value })} />
      </FormField>
      <FormField label="Partner name" required>
        <TextInput value={form.partner_name} onChange={(e) => setForm({ ...form, partner_name: e.target.value })} />
      </FormField>
      <div style={{ display: 'flex', gap: '12px' }}>
        <div style={{ flex: 1 }}>
          <FormField label="Category" required>
            <Select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
              <option>Consumer</option><option>Device</option><option>IoT</option><option>Security</option><option>Digital Content</option><option>Partner</option>
            </Select>
          </FormField>
        </div>
        <div style={{ flex: 1 }}>
          <FormField label="Stock status">
            <Select value={form.stock_status} onChange={(e) => setForm({ ...form, stock_status: e.target.value })}>
              <option value="in">In stock</option><option value="low">Low stock</option><option value="out">Out of stock</option>
            </Select>
          </FormField>
        </div>
      </div>
      <div style={{ display: 'flex', gap: '12px' }}>
        <div style={{ flex: 1 }}>
          <FormField label="Sale price" required hint="Must be above cost.">
            <TextInput type="number" step="0.01" value={form.price} onChange={(e) => setForm({ ...form, price: parseFloat(e.target.value) || 0 })} />
          </FormField>
        </div>
        <div style={{ flex: 1 }}>
          <FormField label="Cost price" required hint="Never shown to a buyer.">
            <TextInput type="number" step="0.01" value={form.cost} onChange={(e) => setForm({ ...form, cost: parseFloat(e.target.value) || 0 })} />
          </FormField>
        </div>
      </div>
      {form.price > 0 && form.cost > 0 && (
        <div style={{ padding: '10px 12px', background: 'var(--bg-alt)', borderRadius: 'var(--radius)', fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>
          Margin: ${fmtMoney(form.price - form.cost)} ({((form.price - form.cost) / form.price * 100).toFixed(1)}%)
        </div>
      )}
    </Modal>
  )
}
