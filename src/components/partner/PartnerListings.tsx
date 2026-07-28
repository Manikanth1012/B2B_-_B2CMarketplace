import { Package, Plus, Download, Search } from 'lucide-react'
import { useState } from 'react'
import { SectionCard, Table, Td, StatusPill, fmtMoney, Btn, toast } from '../operator/shared'
import { PARTNER_LISTINGS, VERTICAL_NAMES } from './data'

export function PartnerListings() {
  const [filter, setFilter] = useState<string>('all')
  const [search, setSearch] = useState('')

  const filtered = PARTNER_LISTINGS.filter(l => {
    if (filter !== 'all' && l.status !== filter) return false
    if (search && !l.name.toLowerCase().includes(search.toLowerCase()) && !l.id.toLowerCase().includes(search.toLowerCase())) return false
    return true
  })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1 style={{ fontSize: 'var(--text-2xl)', fontWeight: 800, color: 'var(--text)' }}>My Listings</h1>
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)', marginTop: '4px' }}>
            {PARTNER_LISTINGS.length} products across {new Set(PARTNER_LISTINGS.map(l => l.v)).size} marketplaces · {PARTNER_LISTINGS.filter(l => l.status === 'live').length} live, {PARTNER_LISTINGS.filter(l => l.status === 'pending').length} in review
          </p>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <Btn variant="secondary" onClick={() => toast('Bulk upload — CSV or catalogue feed')}><Download size={14} /> Bulk upload</Btn>
          <Btn variant="primary"><Plus size={14} /> New listing</Btn>
        </div>
      </div>

      <div style={{
        padding: '14px 18px', borderRadius: 'var(--radius-md)',
        background: 'var(--info-bg)', border: '1px solid var(--info)',
        fontSize: 'var(--text-sm)', color: 'var(--info)',
      }}>
        Listings go live once the marketplace clears them. Standard review is one working day; anything with a policy or certification question takes longer and you will see why here.
      </div>

      <SectionCard
        title="Your Listings"
        subtitle={`${filtered.length} shown`}
        action={
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <div style={{ position: 'relative' }}>
              <input
                type="text"
                placeholder="Search listing or SKU..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                style={{
                  width: '200px', padding: '6px 10px 6px 30px',
                  borderRadius: 'var(--radius)', border: '1px solid var(--border)',
                  fontSize: 'var(--text-sm)', outline: 'none', color: 'var(--text)',
                }}
              />
              <Search size={14} style={{ position: 'absolute', left: '8px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-tertiary)' }} />
            </div>
            {['all', 'live', 'pending', 'draft'].map(f => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                style={{
                  padding: '4px 10px', borderRadius: 'var(--radius-full)',
                  fontSize: 'var(--text-xs)', fontWeight: 600, cursor: 'pointer',
                  border: '1px solid var(--border)',
                  background: filter === f ? 'var(--brand-navy)' : 'white',
                  color: filter === f ? 'white' : 'var(--text-secondary)',
                }}
              >
                {f === 'all' ? 'All' : f.charAt(0).toUpperCase() + f.slice(1)}
              </button>
            ))}
          </div>
        }
      >
        <Table headers={['Listing', 'Marketplace', 'Price', 'Commission', 'Rating', 'Availability', 'State', '']}>
          {filtered.map(l => (
            <tr key={l.id}>
              <Td>
                <div style={{ display: 'flex', gap: '9px', alignItems: 'center' }}>
                  <div style={{ width: '34px', height: '34px', borderRadius: 'var(--radius)', background: 'var(--bg-alt)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <Package size={16} style={{ color: 'var(--text-tertiary)' }} />
                  </div>
                  <div>
                    <div style={{ fontWeight: 600 }}>{l.name}</div>
                    <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>{l.id} · {l.cat}</div>
                  </div>
                </div>
              </Td>
              <Td>{VERTICAL_NAMES[l.v] || l.v}</Td>
              <Td right>
                <span style={{ fontWeight: 600 }}>${fmtMoney(l.price)}</span>
                {l.model === 'monthly' && <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>per month</div>}
              </Td>
              <Td right>
                <span>{l.comm}%</span>
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>${fmtMoney(l.price * l.comm / 100)}</div>
              </Td>
              <Td right>
                {l.rating != null ? (
                  <span style={{ fontSize: 'var(--text-sm)' }}>★ {l.rating} ({l.reviews})</span>
                ) : (
                  <span style={{ color: 'var(--text-tertiary)', fontSize: 'var(--text-xs)' }}>No reviews</span>
                )}
              </Td>
              <Td right>
                <span style={{ fontSize: 'var(--text-xs)', color: l.stock === 'in' ? 'var(--success)' : l.stock === 'low' ? 'var(--warning)' : 'var(--danger)' }}>
                  {l.stock === 'in' ? 'In stock' : l.stock === 'low' ? 'Low stock' : 'Out of stock'}
                </span>
              </Td>
              <Td right><StatusPill status={l.status} /></Td>
              <Td right>
                {l.status === 'pending'
                  ? <Btn variant="secondary" size="sm" onClick={() => toast(`Review status: with the catalogue team, submitted ${l.listed}`)}>Status</Btn>
                  : <Btn variant="secondary" size="sm" onClick={() => toast('Listing editor opened')}>Edit</Btn>}
              </Td>
            </tr>
          ))}
        </Table>
      </SectionCard>
    </div>
  )
}
