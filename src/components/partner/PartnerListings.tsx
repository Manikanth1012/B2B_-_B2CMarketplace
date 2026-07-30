import { Package, Plus, Download, Search } from 'lucide-react'
import { useState, useEffect } from 'react'
import { SectionCard, Table, Td, fmtMoney, Btn, EmptyState, toast } from '../operator/shared'
import { Callout } from '../OnboardingJourney'
import { loadSellerRecord } from '../../lib/partnerRepo'
import type { SellerRecord } from '../../lib/partnerRepo'
import { listingState, listingBreakdown, rateAt } from '../../lib/partnerCommerce'

/* Reads the seller's real catalogue rows rather than a hard-coded list. The
   static one carried five products, two of them in a marketplace this seller is
   not approved for, and none of them existed in the catalogue buyers see. */
export function PartnerListings({ partnerId }: { partnerId: string }) {
  const [rec, setRec] = useState<SellerRecord | null>(null)
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<string>('all')
  const [search, setSearch] = useState('')

  useEffect(() => {
    loadSellerRecord(partnerId).then(r => { setRec(r); setLoading(false) })
  }, [partnerId])

  if (loading || !rec) {
    return <div style={{ textAlign: 'center', padding: '40px' }}><div className="spinner" style={{ margin: '0 auto' }} /></div>
  }

  const catName = (id: string) => rec.categories.find(c => c.id === id)?.name ?? id
  const breakdown = listingBreakdown(rec.listings)
  const states = ['all', ...new Set(rec.listings.map(l => l.status))]

  const filtered = rec.listings.filter(l => {
    if (filter !== 'all' && l.status !== filter) return false
    if (search && !l.name.toLowerCase().includes(search.toLowerCase()) && !l.id.toLowerCase().includes(search.toLowerCase())) return false
    return true
  })

  /* The rate the seller is actually paid on, read from the plan rather than a
     per-row number nothing agreed to. */
  const rate = rec.plan ? rateAt(rec.plan, 0) : null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '16px', flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontSize: 'var(--text-2xl)', fontWeight: 800, color: 'var(--text)' }}>My listings</h1>
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)', marginTop: '4px' }}>
            {rec.listings.length} product{rec.listings.length === 1 ? '' : 's'} across{' '}
            {new Set(rec.listings.map(l => l.category_id)).size} marketplace
            {new Set(rec.listings.map(l => l.category_id)).size === 1 ? '' : 's'}
            {breakdown.length > 0 && ` · ${breakdown.map(b => `${b.count} ${b.label.toLowerCase()}`).join(', ')}`}
          </p>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <Btn variant="secondary" onClick={() => toast('Bulk upload — CSV or catalogue feed')}><Download size={14} /> Bulk upload</Btn>
          <Btn variant="primary"><Plus size={14} /> New listing</Btn>
        </div>
      </div>

      {rec.loadError && <Callout tone="danger" title="Part of this page did not load">{rec.loadError}</Callout>}

      <Callout tone="info">
        Listings go live once the marketplace clears them. Standard review is one working day; anything with
        a policy or certification question takes longer and you will see why here. You can only list in the
        {' '}{rec.approvals.filter(a => a.approved_at).length} categor
        {rec.approvals.filter(a => a.approved_at).length === 1 ? 'y' : 'ies'} you were approved for —
        adding one is a change to your agreement, not a setting.
      </Callout>

      <SectionCard
        title="Your listings"
        subtitle={`${filtered.length} shown`}
        action={
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
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
            {/* Only the states this seller actually has. A filter that can only
                ever return nothing is a filter that teaches people not to use
                the filters. */}
            {states.map(f => (
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
                {f === 'all' ? 'All' : listingState(f).label}
              </button>
            ))}
          </div>
        }
      >
        {filtered.length === 0 ? (
          <EmptyState message={rec.listings.length === 0
            ? 'Nothing listed yet. Your storefront opens at the last onboarding gate.'
            : 'No listing matches that'} />
        ) : (
          <Table headers={['Listing', 'Marketplace', 'Price', 'Commission', 'Availability', 'State']}>
            {filtered.map(l => {
              const state = listingState(l.status)
              return (
                <tr key={l.id}>
                  <Td>
                    <div style={{ display: 'flex', gap: '9px', alignItems: 'center' }}>
                      <div style={{ width: '34px', height: '34px', borderRadius: 'var(--radius)', background: 'var(--bg-alt)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                        <Package size={16} style={{ color: 'var(--text-tertiary)' }} />
                      </div>
                      <div>
                        <div style={{ fontWeight: 600 }}>{l.name}</div>
                        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
                          {l.id}{l.listed ? ` · listed ${l.listed}` : ''}
                        </div>
                      </div>
                    </div>
                  </Td>
                  <Td>{catName(l.category_id)}</Td>
                  <Td right><span style={{ fontWeight: 600 }}>${fmtMoney(l.price)}</span></Td>
                  <Td right>
                    {rate === null ? <span style={{ color: 'var(--text-tertiary)', fontSize: 'var(--text-xs)' }}>No plan</span> : (
                      <>
                        <span>{rate}%</span>
                        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>${fmtMoney(l.price * rate / 100)}</div>
                      </>
                    )}
                  </Td>
                  <Td right>
                    <span style={{ fontSize: 'var(--text-xs)', color: l.stock === 'in' ? 'var(--success)' : l.stock === 'low' ? 'var(--warning)' : 'var(--danger)' }}>
                      {l.stock === 'in' ? 'In stock' : l.stock === 'low' ? 'Low stock' : 'Out of stock'}
                    </span>
                  </Td>
                  <Td right>
                    <div style={{
                      fontSize: 'var(--text-xs)', fontWeight: 700,
                      color: l.status === 'live' ? 'var(--success)' : l.status === 'pending' ? 'var(--warning)' : 'var(--danger)',
                    }}>{state.label}</div>
                    <div style={{ fontSize: '10px', color: 'var(--text-tertiary)', maxWidth: '220px' }}>{state.meaning}</div>
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
