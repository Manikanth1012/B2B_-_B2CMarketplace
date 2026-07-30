import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../../lib/supabase'
import type { Product } from '../../types'
import { awaitingReply, orderForDisplay, aggregate, hasReply, stars, type Review } from '../../lib/reviews'
import { formatDateOnly } from '../../lib/subscriptions'

/* What buyers are saying about this seller's products, and what they have not
   answered. The unanswered low ratings are the reason the screen exists — a reviews
   screen that only shows praise proves nothing. */

export function PartnerReviews({ partnerId }: { partnerId: string }) {
  const [reviews, setReviews] = useState<Review[]>([])
  const [products, setProducts] = useState<Record<string, Product>>({})
  const [loading, setLoading] = useState(true)
  const [replying, setReplying] = useState<string | null>(null)
  const [text, setText] = useState('')
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    const { data: prods } = await supabase.from('products').select('*').eq('partner_id', partnerId)
    const mine = (prods ?? []) as Product[]
    setProducts(Object.fromEntries(mine.map(p => [p.id, p])))

    if (mine.length > 0) {
      const { data } = await supabase.from('product_reviews').select('*')
        .in('product_id', mine.map(p => p.id))
      setReviews((data ?? []) as Review[])
    }
    setLoading(false)
  }, [partnerId])

  useEffect(() => { load() }, [load])

  const reply = async (r: Review) => {
    if (!text.trim()) return
    setSaving(true)
    await supabase.from('product_reviews').update({
      reply_by: products[r.product_id]?.seller ?? 'Seller',
      reply_at: new Date().toISOString().slice(0, 10),
      reply_text: text.trim(),
    }).eq('id', r.id)
    setSaving(false)
    setReplying(null)
    setText('')
    await load()
  }

  if (loading) return <div style={{ textAlign: 'center', padding: '40px' }}><div className="spinner" style={{ margin: '0 auto' }} /></div>

  const agg = aggregate(reviews)
  const unanswered = awaitingReply(reviews)
  const all = orderForDisplay(reviews)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div>
        <h1 style={{ fontSize: 'var(--text-2xl)', fontWeight: 800, color: 'var(--text)' }}>Reviews</h1>
        <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)', marginTop: '4px' }}>
          {agg.count === 0
            ? 'Nothing published yet'
            : `${agg.average} average from ${agg.count} published · ${unanswered.length} unanswered`}
        </p>
      </div>

      {agg.count > 0 && (
        <div style={{ background: 'white', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: '20px' }}>
          {/* The shape an average hides: four fives and a one is not five threes. */}
          {[5, 4, 3, 2, 1].map(n => {
            const c = agg.distribution[n - 1]
            const pct = agg.count > 0 ? (c / agg.count) * 100 : 0
            return (
              <div key={n} style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '6px' }}>
                <span style={{ fontSize: 'var(--text-xs)', width: '12px', color: 'var(--text-secondary)' }}>{n}</span>
                <div style={{ flex: 1, height: '8px', borderRadius: '4px', background: 'var(--border-light)', overflow: 'hidden' }}>
                  <div style={{ width: `${pct}%`, height: '100%', background: n <= 2 ? 'var(--danger)' : n === 3 ? 'var(--warning, #F5A623)' : 'var(--success)' }} />
                </div>
                <span style={{ fontSize: 'var(--text-xs)', width: '24px', textAlign: 'right', color: 'var(--text-secondary)' }}>{c}</span>
              </div>
            )
          })}
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {all.length === 0 && (
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>
            No published reviews on your products yet.
          </p>
        )}
        {all.map(r => (
          <div key={r.id} style={{
            background: 'white',
            border: `1px solid ${!hasReply(r) && r.rating <= 2 ? '#FCD34D' : 'var(--border)'}`,
            borderRadius: 'var(--radius-lg)', padding: '16px',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
              <span style={{ color: 'var(--brand-gold, #F5A623)', letterSpacing: '1px' }}>{stars(r.rating)}</span>
              <span style={{ fontSize: 'var(--text-sm)', fontWeight: 700 }}>{r.title}</span>
              <span style={{ marginLeft: 'auto', fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
                {products[r.product_id]?.name} · {r.author} · {formatDateOnly(r.submitted)}
              </span>
            </div>
            <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', margin: '8px 0 0', lineHeight: 1.55 }}>{r.body}</p>

            {hasReply(r) ? (
              <div style={{ marginTop: '12px', paddingLeft: '12px', borderLeft: '3px solid var(--brand-accent-dark)' }}>
                <div style={{ fontSize: 'var(--text-xs)', fontWeight: 700 }}>
                  {r.reply_by}{r.reply_at && ` · ${formatDateOnly(r.reply_at)}`}
                </div>
                <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', margin: '3px 0 0', lineHeight: 1.55 }}>{r.reply_text}</p>
              </div>
            ) : replying === r.id ? (
              <div style={{ marginTop: '12px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <textarea
                  value={text}
                  onChange={e => setText(e.target.value)}
                  rows={3}
                  aria-label="Your reply"
                  placeholder="Answer the buyer. This is published next to their review."
                  style={{ width: '100%', padding: '9px 12px', borderRadius: 'var(--radius)', border: '1px solid var(--border)', fontSize: 'var(--text-sm)', fontFamily: 'inherit', resize: 'vertical' }}
                />
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button onClick={() => reply(r)} disabled={saving || !text.trim()} className="btn btn-primary btn-sm">
                    {saving ? 'Posting…' : 'Post reply'}
                  </button>
                  <button onClick={() => { setReplying(null); setText('') }} className="btn btn-secondary btn-sm">Cancel</button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => { setReplying(r.id); setText('') }}
                className="btn btn-secondary btn-sm"
                style={{ marginTop: '12px' }}
              >
                Reply
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
