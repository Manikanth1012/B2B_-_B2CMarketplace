import { useState, useEffect } from 'react'
import { Search, Package, Star } from 'lucide-react'
import { SectionCard, Btn, toast } from '../operator/shared'
import { VERTICAL_NAMES } from './data'
import { loadAccount, loadEnterpriseCatalogue } from '../../lib/enterpriseRepo'
import type { EnterpriseListing } from '../../lib/enterpriseRepo'
import { useAccountMoney } from './money'
import type { Policy } from '../../lib/enterprise'

export function EnterpriseBrowse() {
  const [vertical, setVertical] = useState<string | null>(null)
  const [category, setCategory] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  /* The threshold quoted here is the account's own, not a constant — a
     catalogue that promises a different rule from the one the Approvals screen
     applies is worse than one that promises nothing. */
  const [policy, setPolicy] = useState<Policy | null>(null)
  /* The account's own currency too, for the same reason: a threshold quoted in
     dollars to a company invoiced in rupees is a different rule again. */
  const [currency, setCurrency] = useState<string | null>(null)
  const { money, money0 } = useAccountMoney(currency)
  /* The catalogue itself, from `products` rather than from a constant. The
     constant listed twelve items with dollar prices and SKU ids that named
     different products in the real catalogue — `SKU-3001` was an IoT SIM pack
     here and StreamNova Premium 4K in the table — so a requisition raised from
     this screen would have referred to a consumer streaming subscription. */
  const [listings, setListings] = useState<EnterpriseListing[] | null>(null)
  useEffect(() => {
    void (async () => {
      const book = await loadAccount()
      setPolicy(book.policy)
      const cur = book.account?.currency ?? 'USD'
      setCurrency(cur)
      setListings(await loadEnterpriseCatalogue(cur))
    })()
  }, [])
  const [sort, setSort] = useState('popular')

  let results = listings ?? []
  if (vertical) results = results.filter(p => p.category_id === vertical)
  if (category) results = results.filter(p => p.sub_category === category)
  if (query) {
    const q = query.toLowerCase()
    results = results.filter(p => (p.name + ' ' + p.description + ' ' + p.seller + ' ' + (p.sub_category ?? '')).toLowerCase().includes(q))
  }
  results = results.slice().sort((a, b) =>
    sort === 'priceup' ? a.price - b.price
    : sort === 'pricedown' ? b.price - a.price
    : sort === 'rating' ? (b.rating || 0) - (a.rating || 0)
    : (b.reviews || 0) - (a.reviews || 0))

  const all = listings ?? []
  const cats = Array.from(new Set((vertical ? all.filter(p => p.category_id === vertical) : all)
    .map(p => p.sub_category).filter((c): c is string => !!c)))
  const filtering = vertical || category || query

  const reset = () => { setVertical(null); setCategory(null); setQuery('') }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1 style={{ fontSize: 'var(--text-2xl)', fontWeight: 800, color: 'var(--text)' }}>{vertical ? VERTICAL_NAMES[vertical] : 'Business Catalogue'}</h1>
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)', marginTop: '4px' }}>
            {results.length} of {all.length} listings approved for business accounts · sold by {new Set(results.map(p => p.seller)).size} sellers
          </p>
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <div style={{ position: 'relative' }}>
            <input
              type="text" placeholder="Search the catalogue" value={query}
              onChange={e => setQuery(e.target.value)}
              style={{ width: '200px', padding: '6px 10px 6px 30px', borderRadius: 'var(--radius)', border: '1px solid var(--border)', fontSize: 'var(--text-sm)', outline: 'none', color: 'var(--text)' }}
            />
            <Search size={14} style={{ position: 'absolute', left: '8px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-tertiary)' }} />
          </div>
          <select value={sort} onChange={e => setSort(e.target.value)} style={{ padding: '6px 10px', borderRadius: 'var(--radius)', border: '1px solid var(--border)', fontSize: 'var(--text-sm)', outline: 'none', background: 'white' }}>
            <option value="popular">Most popular</option>
            <option value="rating">Highest rated</option>
            <option value="priceup">Price: low to high</option>
            <option value="pricedown">Price: high to low</option>
          </select>
        </div>
      </div>

      <div style={{
        padding: '14px 18px', borderRadius: 'var(--radius-md)',
        background: 'var(--info-bg)', border: '1px solid var(--info)',
        fontSize: 'var(--text-sm)', color: 'var(--info)',
      }}>
        Everything here is pre-approved for business purchase. {policy
          ? `Anything at or above ${money0(Number(policy.threshold))} needs finance approval before the order is placed${policy.security_signoff ? '; security purchases also need IT sign-off whatever they cost' : ''}.`
          : 'Your account’s approval thresholds are loading.'}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '230px 1fr', gap: '16px' }} className="op-grid-2col">
        {/* Facets */}
        <aside style={{ background: 'white', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', alignSelf: 'start', position: 'sticky', top: '80px' }}>
          <div style={{ padding: '12px', borderBottom: '1px solid var(--border-light)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <strong style={{ fontSize: 'var(--text-sm)' }}>Filters</strong>
            {filtering && <button onClick={reset} style={{ background: 'none', border: 'none', color: 'var(--brand-accent-dark)', fontSize: 'var(--text-xs)', cursor: 'pointer' }}>Clear all</button>}
          </div>
          <div style={{ padding: '12px', borderBottom: '1px solid var(--border-light)' }}>
            <div style={{ fontWeight: 600, fontSize: 'var(--text-sm)', marginBottom: '8px' }}>Marketplace</div>
            {['iot', 'security', 'device'].map(v => (
              <label key={v} style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px', cursor: 'pointer', fontSize: 'var(--text-sm)' }}>
                <input type="checkbox" checked={vertical === v} onChange={() => { setVertical(vertical === v ? null : v); setCategory(null) }} />
                <span>{VERTICAL_NAMES[v]?.replace(' Marketplace', '')}</span>
                <span style={{ marginLeft: 'auto', fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>{all.filter(p => p.category_id === v).length}</span>
              </label>
            ))}
          </div>
          <div style={{ padding: '12px' }}>
            <div style={{ fontWeight: 600, fontSize: 'var(--text-sm)', marginBottom: '8px' }}>Category</div>
            {cats.map(c => (
              <label key={c} style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px', cursor: 'pointer', fontSize: 'var(--text-sm)' }}>
                <input type="checkbox" checked={category === c} onChange={() => setCategory(category === c ? null : c)} />
                <span>{c}</span>
                <span style={{ marginLeft: 'auto', fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>{all.filter(p => p.sub_category === c && (!vertical || p.category_id === vertical)).length}</span>
              </label>
            ))}
          </div>
        </aside>

        {/* Results */}
        <div>
          {/* "Nothing matches" while the catalogue is still in flight would tell
              a buyer their filters excluded everything, which is a different
              and wrong statement. */}
          {listings === null ? (
            <div style={{ textAlign: 'center', padding: '40px' }}><div className="spinner" style={{ margin: '0 auto' }} /></div>
          ) : results.length > 0 ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '14px' }}>
              {results.map(p => (
                <div key={p.id} style={{ background: 'white', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', overflow: 'hidden', display: 'flex', flexDirection: 'column', cursor: 'pointer', transition: 'border-color 150ms ease' }}
                  onMouseEnter={(e) => e.currentTarget.style.borderColor = 'var(--brand-accent)'}
                  onMouseLeave={(e) => e.currentTarget.style.borderColor = 'var(--border)'}
                  onClick={() => toast(`Listing detail: ${p.name}`)}
                >
                  <div style={{ height: '120px', background: 'var(--bg-alt)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Package size={32} style={{ color: 'var(--text-tertiary)' }} />
                  </div>
                  <div style={{ padding: '12px', flex: 1, display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <div style={{ fontWeight: 600, fontSize: 'var(--text-sm)' }}>{p.name}</div>
                    <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>{p.seller} · {p.sub_category}</div>
                    <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', lineHeight: 1.4 }}>{p.description}</div>
                    {p.rating > 0 && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>
                        <Star size={12} style={{ color: '#F5A623' }} fill="#F5A623" />
                        {p.rating} ({p.reviews})
                      </div>
                    )}
                  </div>
                  <div style={{ padding: '10px 12px', borderTop: '1px solid var(--border-light)', background: 'var(--bg-alt)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div>
                      <span style={{ fontWeight: 700, fontSize: 'var(--text-base)' }}>{money(p.price)}</span>
                      {p.model === 'monthly' && <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>{p.unit ? ` ${p.unit}/mo` : '/mo'}</span>}
                    </div>
                    <Btn variant="primary" size="sm" onClick={(e) => { e.stopPropagation(); toast(`${p.name} added to requisition`) }}>Add</Btn>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <SectionCard title="Nothing matches" subtitle="Your filters exclude all listings">
              <div style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--text-tertiary)' }}>
                <p>No business listings match those filters.</p>
                <Btn variant="primary" size="sm" style={{ marginTop: '12px' }} onClick={reset}>Clear filters</Btn>
              </div>
            </SectionCard>
          )}
        </div>
      </div>
    </div>
  )
}
