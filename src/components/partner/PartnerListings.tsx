import { Package, Plus, Download, Search } from 'lucide-react'
import { useState, useEffect } from 'react'
import { SectionCard, Table, Td, fmtMoney, Btn, EmptyState, toast } from '../operator/shared'
import { Callout } from '../OnboardingJourney'
import { loadSellerRecord } from '../../lib/partnerRepo'
import type { SellerRecord } from '../../lib/partnerRepo'
import { loadSellerSubmissions } from '../../lib/catalogueRepo'
import type { Submission } from '../../lib/catalogue'
import type { ListingQuery } from '../../lib/catalogueRepo'
import { fmtDate, Modal } from '../operator/shared'
import { PriceBookEditor } from '../PriceBookEditor'
import { listingState, listingBreakdown, rateAt } from '../../lib/partnerCommerce'

/* Reads the seller's real catalogue rows rather than a hard-coded list. The
   static one carried five products, two of them in a marketplace this seller is
   not approved for, and none of them existed in the catalogue buyers see. */
export function PartnerListings({ partnerId, onNewListing }: {
  partnerId: string
  /* The console owns navigation, so the page asks rather than routing itself. */
  onNewListing?: () => void
}) {
  const [rec, setRec] = useState<SellerRecord | null>(null)
  /* What the catalogue desk did with each submission, and anything they have
     asked. A seller who cannot see why a listing was refused cannot fix it. */
  const [subs, setSubs] = useState<Submission[]>([])
  const [queries, setQueries] = useState<ListingQuery[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<string>('all')
  const [search, setSearch] = useState('')
  /* Which listing's per-market prices are open. A seller sells in more than one
     country, so a listing has more than one price and the row cannot show them
     all — the row shows the home market and this opens the rest. */
  const [pricing, setPricing] = useState<{ id: string; name: string; partner_id: string | null; price: number; currency?: string } | null>(null)

  useEffect(() => {
    Promise.all([loadSellerRecord(partnerId), loadSellerSubmissions(partnerId)])
      .then(([r, s]) => { setRec(r); setSubs(s.submissions); setQueries(s.queries); setLoading(false) })
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
          <Btn variant="primary" onClick={onNewListing}><Plus size={14} /> New listing</Btn>
        </div>
      </div>

      {rec.loadError && <Callout tone="danger" title="Part of this page did not load">{rec.loadError}</Callout>}

      {/* Anything the catalogue desk has asked. These hold a listing in the
          queue until they are answered, so they belong above the table rather
          than buried in a row. */}
      {queries.filter(q => q.status !== 'closed').length > 0 && (
        <SectionCard title="Questions on your listings"
                     subtitle="Each of these is holding a listing in the review queue">
          <div style={{ padding: '14px 20px', display: 'flex', flexDirection: 'column', gap: '9px' }}>
            {queries.filter(q => q.status !== 'closed').map(q => {
              const p = rec.listings.find(l => l.id === q.product_id)
              return (
                <div key={q.id} style={{
                  padding: '10px 12px', borderRadius: 'var(--radius-md)',
                  border: `1px solid ${q.status === 'overdue' ? 'var(--danger)' : 'var(--border)'}`,
                  background: q.status === 'overdue' ? 'var(--danger-bg)' : 'white',
                }}>
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'baseline', flexWrap: 'wrap' }}>
                    <strong style={{ fontSize: 'var(--text-xs)' }}>{q.subject}</strong>
                    <span style={{ fontSize: '10px', fontWeight: 700, color: q.status === 'overdue' ? 'var(--danger)' : q.status === 'answered' ? 'var(--success)' : 'var(--warning)' }}>
                      {q.status}
                    </span>
                    <span style={{ fontSize: '10px', color: 'var(--text-tertiary)' }}>
                      {p ? `${p.name} · ` : ''}from {q.asked_by} · answer by {fmtDate(q.due_on)}
                    </span>
                  </div>
                  <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '3px' }}>{q.body}</div>
                  {q.answer && (
                    <div style={{ fontSize: '11px', marginTop: '5px', paddingLeft: '9px', borderLeft: '2px solid var(--success)' }}>
                      You answered: {q.answer}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </SectionCard>
      )}

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
          <Table headers={['Listing', 'Marketplace', 'Price', 'Commission', 'Availability', 'State', 'Review', 'Markets']}>
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
                  <Td>
                    {(() => {
                      const s = subs.filter(x => x.product_id === l.id).sort((a, b) => b.version - a.version)[0]
                      if (!s) return <span style={{ fontSize: '10px', color: 'var(--text-tertiary)' }}>No record</span>
                      return (
                        <div style={{ maxWidth: '260px' }}>
                          <div style={{ fontSize: '10px', fontWeight: 700, color: s.status === 'approved' ? 'var(--success)' : s.status === 'rejected' ? 'var(--danger)' : 'var(--warning)' }}>
                            {s.status === 'pending' ? `Waiting since ${fmtDate(s.submitted_at)}` : `${s.status} by ${s.reviewed_by}`}
                          </div>
                          {/* The reason, not just the outcome — a refusal a seller
                              cannot act on comes straight back as a ticket. */}
                          <div style={{ fontSize: '10px', color: 'var(--text-tertiary)' }}>
                            {s.decision_reason ?? s.issue ?? s.check_note}
                          </div>
                        </div>
                      )
                    })()}
                  </Td>
                  <Td right>
                    <Btn variant="secondary" size="sm" onClick={() => setPricing({ id: l.id, name: l.name, partner_id: partnerId, price: l.price })}>Prices</Btn>
                  </Td>
                </tr>
              )
            })}
          </Table>
        )}
      </SectionCard>

      <Modal
        open={pricing !== null}
        onClose={() => setPricing(null)}
        title={pricing ? `Prices — ${pricing.name}` : ''}
        footer={<Btn variant="secondary" size="sm" onClick={() => setPricing(null)}>Close</Btn>}
      >
        {pricing && (
          <PriceBookEditor
            product={pricing}
            who={{ persona: 'partner', partnerId }}
            onChanged={() => { void loadSellerRecord(partnerId).then(setRec) }}
          />
        )}
      </Modal>
    </div>
  )
}
