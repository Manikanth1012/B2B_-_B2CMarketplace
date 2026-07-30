import { useState, useEffect, useCallback } from 'react'
import { Star, Pencil } from 'lucide-react'
import { supabase } from '../lib/supabase'
import type { Product } from '../types'
import {
  validateReview, canReview, stars, MIN_BODY, type Review,
} from '../lib/reviews'
import { formatDateOnly } from '../lib/subscriptions'

/* "Reviews you have written", plus the things you bought and have not reviewed yet.
   The second half is the point: without it a shopper has no way to find the product
   they meant to write about. */

export function MyReviewsCard({ showToast }: { showToast: (m: string) => void }) {
  const [mine, setMine] = useState<Review[]>([])
  const [purchased, setPurchased] = useState<Product[]>([])
  const [writing, setWriting] = useState<Product | null>(null)
  const [rating, setRating] = useState(5)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    const [{ data: reviews }, { data: items }] = await Promise.all([
      supabase.from('product_reviews').select('*').order('submitted', { ascending: false }),
      supabase.from('order_items').select('product_id'),
    ])
    /* The public policy also returns other people's published reviews, so narrow to
       this account's own — "reviews you have written" means yours. */
    const { data: me } = await supabase.auth.getUser()
    setMine(((reviews ?? []) as Review[]).filter(r => r.user_id && r.user_id === me.user?.id))

    const ids = [...new Set(((items ?? []) as { product_id: string }[]).map(i => i.product_id))]
    if (ids.length > 0) {
      const { data: prods } = await supabase.from('products').select('*').in('id', ids)
      setPurchased((prods ?? []) as Product[])
    }
  }, [])

  useEffect(() => { load() }, [load])

  const open = (p: Product) => {
    setWriting(p); setRating(5); setTitle(''); setBody(''); setError(null)
  }

  const submit = async () => {
    if (!writing) return
    const problem = validateReview(rating, title, body)
    if (problem) { setError(problem); return }

    setSaving(true)
    const { error: writeError } = await supabase.from('product_reviews').insert({
      id: `REV-${Date.now().toString().slice(-8)}`,
      product_id: writing.id,
      rating, title: title.trim(), body: body.trim(),
      author: 'Priya Raman',
      /* Never published straight away — the insert policy pins this too. */
      status: 'pending',
    })
    setSaving(false)

    if (writeError) {
      setError(/row-level security/i.test(writeError.message)
        ? 'Only people who bought this can review it.'
        : 'We could not save that just now.')
      return
    }
    setWriting(null)
    await load()
    showToast('Thanks — your review goes live once it has been checked')
  }

  const unreviewed = purchased.filter(p => canReview(p.id, purchased.map(x => x.id), mine).ok)

  return (
    <div style={{ background: 'white', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: '24px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '4px' }}>
        <span style={{ color: 'var(--brand-accent-dark)' }}><Star size={18} /></span>
        <h2 style={{ fontWeight: 700, fontSize: 'var(--text-lg)' }}>Your reviews</h2>
      </div>
      <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)', marginBottom: '20px' }}>
        Only things you have bought, and each one once
      </p>

      {mine.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '20px' }}>
          {mine.map(r => (
            <div key={r.id} style={{ border: '1px solid var(--border-light)', borderRadius: 'var(--radius)', padding: '12px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '10px' }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 'var(--text-sm)', fontWeight: 700 }}>{r.title}</div>
                  <div style={{ fontSize: 'var(--text-xs)', color: 'var(--brand-gold, #F5A623)', letterSpacing: '1px' }}>{stars(r.rating)}</div>
                </div>
                <span style={{
                  flexShrink: 0, padding: '2px 10px', borderRadius: '999px', fontSize: 'var(--text-xs)', fontWeight: 700,
                  background: r.status === 'published' ? '#DCFCE7' : r.status === 'pending' ? '#FEF3C7' : '#FEE2E2',
                  color: r.status === 'published' ? '#15803D' : r.status === 'pending' ? '#92400E' : '#B91C1C',
                }}>
                  {r.status === 'pending' ? 'Being checked' : r.status === 'published' ? 'Live' : 'Not published'}
                </span>
              </div>
              <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', margin: '6px 0 0', lineHeight: 1.5 }}>{r.body}</p>
              {/* A refusal without its reason is not something anyone can act on. */}
              {r.status === 'rejected' && r.reject_reason && (
                <p style={{ fontSize: 'var(--text-xs)', color: '#B91C1C', margin: '6px 0 0' }}>
                  Not published — {r.reject_reason.toLowerCase()}
                </p>
              )}
              {r.reply_text && (
                <div style={{ marginTop: '8px', paddingTop: '8px', borderTop: '1px solid var(--border-light)' }}>
                  <div style={{ fontSize: 'var(--text-xs)', fontWeight: 700 }}>
                    {r.reply_by} replied{r.reply_at && ` · ${formatDateOnly(r.reply_at)}`}
                  </div>
                  <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', margin: '3px 0 0', lineHeight: 1.5 }}>{r.reply_text}</p>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {writing ? (
        <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '14px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <div style={{ fontSize: 'var(--text-sm)', fontWeight: 700 }}>{writing.name}</div>
          <div style={{ display: 'flex', gap: '4px' }}>
            {[1, 2, 3, 4, 5].map(n => (
              <button
                key={n}
                onClick={() => setRating(n)}
                aria-label={`${n} star${n === 1 ? '' : 's'}`}
                aria-pressed={rating === n}
                style={{
                  background: 'none', border: 'none', cursor: 'pointer', padding: '2px',
                  fontSize: '22px', lineHeight: 1,
                  color: n <= rating ? 'var(--brand-gold, #F5A623)' : 'var(--border)',
                }}
              >
                ★
              </button>
            ))}
          </div>
          <input
            value={title}
            onChange={e => { setTitle(e.target.value); setError(null) }}
            placeholder="A short headline"
            aria-label="Review headline"
            style={inputStyle}
          />
          <textarea
            value={body}
            onChange={e => { setBody(e.target.value); setError(null) }}
            rows={4}
            placeholder={`What was it like? At least ${MIN_BODY} characters.`}
            aria-label="Your review"
            style={{ ...inputStyle, resize: 'vertical' }}
          />
          <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', margin: 0 }}>
            Reviews are checked before they go live. Yours will show here while it waits.
          </p>
          {error && <div role="alert" style={{ fontSize: 'var(--text-sm)', color: 'var(--danger)' }}>{error}</div>}
          <div style={{ display: 'flex', gap: '8px' }}>
            <button onClick={submit} disabled={saving} className="btn btn-primary btn-sm">
              {saving ? 'Sending…' : 'Submit review'}
            </button>
            <button onClick={() => setWriting(null)} className="btn btn-secondary btn-sm">Cancel</button>
          </div>
        </div>
      ) : unreviewed.length > 0 ? (
        <div>
          <h3 style={{ fontSize: 'var(--text-sm)', fontWeight: 700, marginBottom: '8px' }}>Waiting on your verdict</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {unreviewed.map(p => (
              <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px' }}>
                <span style={{ fontSize: 'var(--text-sm)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {p.name}
                </span>
                <button onClick={() => open(p)} className="btn btn-secondary btn-sm" style={{ display: 'flex', alignItems: 'center', gap: '5px', flexShrink: 0 }}>
                  <Pencil size={12} /> Write a review
                </button>
              </div>
            ))}
          </div>
        </div>
      ) : mine.length === 0 ? (
        <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', margin: 0 }}>
          Once you have bought something, you can review it here.
        </p>
      ) : null}
    </div>
  )
}

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '9px 12px', borderRadius: 'var(--radius)',
  border: '1px solid var(--border)', fontSize: 'var(--text-sm)',
  fontFamily: 'inherit', color: 'var(--text)',
}
