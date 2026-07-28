import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import type { OperatorListing } from '../../types'
import { SectionCard, Table, Td, StatusPill, EmptyState, fmtMoney, fmtDate } from './shared'

export function OperatorCatalogue() {
  const [listings, setListings] = useState<OperatorListing[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<string>('all')

  useEffect(() => {
    supabase.from('operator_listings').select('*').order('sort_order').then(({ data }) => {
      if (data) setListings(data as OperatorListing[])
      setLoading(false)
    })
  }, [])

  if (loading) return <div style={{ textAlign: 'center', padding: '40px' }}><div className="spinner" style={{ margin: '0 auto' }} /></div>

  const filtered = filter === 'all' ? listings : listings.filter(l => l.status === filter)
  const pendingCount = listings.filter(l => l.status === 'pending').length
  const approvedCount = listings.filter(l => l.status === 'approved').length
  const rejectedCount = listings.filter(l => l.status === 'rejected').length

  const handleAction = async (id: string, action: 'approve' | 'reject') => {
    const newStatus = action === 'approve' ? 'approved' : 'rejected'
    await supabase.from('operator_listings').update({
      status: newStatus,
      reviewed_by: 'Catalogue Team',
      reviewed_at: new Date().toISOString(),
    }).eq('id', id)
    setListings(prev => prev.map(l => l.id === id ? { ...l, status: newStatus, reviewed_by: 'Catalogue Team', reviewed_at: new Date().toISOString() } : l))
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div>
        <h1 style={{ fontSize: 'var(--text-2xl)', fontWeight: 800, color: 'var(--text)' }}>Catalogue Review</h1>
        <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)', marginTop: '4px' }}>
          {pendingCount} pending · {approvedCount} approved · {rejectedCount} rejected
        </p>
      </div>

      {/* Filter tabs */}
      <div style={{ display: 'flex', gap: '8px' }}>
        {[
          { id: 'all', label: 'All', count: listings.length },
          { id: 'pending', label: 'Pending', count: pendingCount },
          { id: 'approved', label: 'Approved', count: approvedCount },
          { id: 'rejected', label: 'Rejected', count: rejectedCount },
        ].map(f => (
          <button
            key={f.id}
            onClick={() => setFilter(f.id)}
            style={{
              padding: '8px 16px', borderRadius: 'var(--radius)',
              fontSize: 'var(--text-sm)', fontWeight: 600,
              background: filter === f.id ? 'var(--brand-navy)' : 'white',
              color: filter === f.id ? 'white' : 'var(--text-secondary)',
              border: '1px solid var(--border)', cursor: 'pointer',
            }}
          >
            {f.label} ({f.count})
          </button>
        ))}
      </div>

      <SectionCard title="Product Listings" subtitle={`${filtered.length} listings`}>
        {filtered.length === 0 ? (
          <EmptyState message="No listings in this filter" />
        ) : (
          <Table headers={['Product', 'Partner', 'Category', 'Price', 'Margin', 'Status', 'Reviews', 'Action']}>
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
                  <Td right>{l.reviews > 0 ? `${l.reviews} (${l.rating?.toFixed(1)})` : '—'}</Td>
                  <Td right>
                    {l.status === 'pending' ? (
                      <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end' }}>
                        <button onClick={() => handleAction(l.id, 'approve')} className="btn btn-sm" style={{ background: 'var(--success)', color: 'white' }}>Approve</button>
                        <button onClick={() => handleAction(l.id, 'reject')} className="btn btn-sm" style={{ background: 'var(--danger)', color: 'white' }}>Reject</button>
                      </div>
                    ) : (
                      <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
                        {l.reviewed_by} · {fmtDate(l.reviewed_at)}
                      </span>
                    )}
                  </Td>
                </tr>
              )
            })}
          </Table>
        )}
      </SectionCard>
    </div>
  )
}
