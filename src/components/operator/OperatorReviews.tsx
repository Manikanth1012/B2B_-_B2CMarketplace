import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../../lib/supabase'
import type { Product } from '../../types'
import {
  pendingReviews, orderForDisplay, validateModeration, stars,
  REVIEW_REASONS, type Review, type RejectReason,
} from '../../lib/reviews'
import { SectionCard, EmptyState, Btn, Select, toast } from './shared'

/* Moderation. Every review is checked before it is published, which is only true if
   there is a screen where that happens. */

export function OperatorReviews() {
  const [reviews, setReviews] = useState<Review[]>([])
  const [products, setProducts] = useState<Record<string, Product>>({})
  const [loading, setLoading] = useState(true)
  const [reason, setReason] = useState<Record<string, RejectReason>>({})
  const [tab, setTab] = useState<'pending' | 'published' | 'rejected'>('pending')

  const load = useCallback(async () => {
    const [{ data: rows }, { data: prods }] = await Promise.all([
      supabase.from('product_reviews').select('*'),
      supabase.from('products').select('*'),
    ])
    setReviews((rows ?? []) as Review[])
    setProducts(Object.fromEntries(((prods ?? []) as Product[]).map(p => [p.id, p])))
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const decide = async (r: Review, decision: 'published' | 'rejected') => {
    const why = decision === 'rejected' ? (reason[r.id] ?? null) : null
    const problem = validateModeration(decision, why)
    if (problem) { toast(problem, 'error'); return }

    await supabase.from('product_reviews')
      .update({ status: decision, reject_reason: why })
      .eq('id', r.id)
    await load()
    toast(decision === 'published' ? 'Review published' : `Review refused — ${why}`)
  }

  if (loading) return <div style={{ textAlign: 'center', padding: '40px' }}><div className="spinner" style={{ margin: '0 auto' }} /></div>

  const pending = pendingReviews(reviews)
  const published = orderForDisplay(reviews)
  const rejected = reviews.filter(r => r.status === 'rejected')
  const shown = tab === 'pending' ? pending : tab === 'published' ? published : rejected

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div>
        <h1 style={{ fontSize: 'var(--text-2xl)', fontWeight: 800, color: 'var(--text)' }}>Reviews</h1>
        <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)', marginTop: '4px' }}>
          {pending.length} awaiting a decision · {published.length} published · {rejected.length} refused
        </p>
      </div>

      <div style={{ display: 'flex', gap: '8px' }}>
        {([['pending', 'Awaiting', pending.length], ['published', 'Published', published.length], ['rejected', 'Refused', rejected.length]] as const).map(([id, label, n]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            style={{
              padding: '8px 16px', borderRadius: 'var(--radius)', fontSize: 'var(--text-sm)', fontWeight: 600,
              background: tab === id ? 'var(--brand-navy)' : 'white',
              color: tab === id ? 'white' : 'var(--text-secondary)',
              border: '1px solid var(--border)', cursor: 'pointer',
            }}
          >
            {label} ({n})
          </button>
        ))}
      </div>

      <SectionCard title={tab === 'pending' ? 'Awaiting a decision' : tab === 'published' ? 'Published' : 'Refused'}>
        {shown.length === 0 ? <EmptyState message="Nothing here" /> : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {shown.map(r => (
              <div key={r.id} style={{
                border: `1px solid ${r.rating <= 2 ? 'var(--warning, #FCD34D)' : 'var(--border)'}`,
                borderRadius: 'var(--radius)', overflow: 'hidden',
              }}>
                <div style={{
                  display: 'flex', alignItems: 'center', gap: '10px', padding: '9px 12px',
                  background: r.rating <= 2 ? '#FEF3C7' : 'var(--bg-alt)',
                  borderBottom: '1px solid var(--border-light)',
                }}>
                  <span style={{ fontSize: 'var(--text-sm)', fontWeight: 700, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {products[r.product_id]?.name ?? r.product_id}
                  </span>
                  <span style={{ color: 'var(--brand-gold, #F5A623)', letterSpacing: '1px', flexShrink: 0 }}>{stars(r.rating)}</span>
                  <span style={{ marginLeft: 'auto', fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', flexShrink: 0 }}>
                    {r.author} · {r.submitted}
                  </span>
                </div>

                <div style={{ padding: '11px 12px' }}>
                  <div style={{ fontSize: 'var(--text-sm)', fontWeight: 700 }}>{r.title}</div>
                  <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', margin: '4px 0 0', lineHeight: 1.55 }}>{r.body}</p>
                  {r.reject_reason && (
                    <p style={{ fontSize: 'var(--text-xs)', color: '#B91C1C', margin: '8px 0 0', fontWeight: 600 }}>
                      Refused — {r.reject_reason}
                    </p>
                  )}
                </div>

                {tab === 'pending' && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '9px 12px', borderTop: '1px solid var(--border-light)', background: 'var(--bg-alt)', flexWrap: 'wrap' }}>
                    <Btn variant="success" size="sm" onClick={() => decide(r, 'published')}>Publish</Btn>
                    {/* A refusal must carry its reason, so the reason is chosen
                        before the button rather than asked for afterwards. */}
                    <div style={{ minWidth: '220px' }}>
                      <Select
                        value={reason[r.id] ?? ''}
                        onChange={(e) => setReason({ ...reason, [r.id]: e.target.value as RejectReason })}
                      >
                        <option value="">Reason for refusing…</option>
                        {REVIEW_REASONS.map(x => <option key={x} value={x}>{x}</option>)}
                      </Select>
                    </div>
                    <Btn variant="danger" size="sm" onClick={() => decide(r, 'rejected')}>Refuse</Btn>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </SectionCard>
    </div>
  )
}
