import { useState, useEffect, useCallback, useMemo } from 'react'
import { ShieldAlert, TriangleAlert, Info, CircleCheck as CheckCircle, Package } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import type { Product } from '../../types'
import {
  orderForDisplay, validateModeration, stars,
  REVIEW_REASONS, type Review, type RejectReason,
} from '../../lib/reviews'
import { screenAll, triage, screeningSummary } from '../../lib/reviewScreening'
import type { Screening, Severity, Flag } from '../../lib/reviewScreening'
import { SectionCard, EmptyState, Btn, Select, toast, StatCard } from './shared'
import { Callout } from '../OnboardingJourney'

/* Moderation. Every review is checked before it is published, which is only
   true if there is a screen where that happens — and useful only if the person
   at that screen is not reading twenty reviews to find the three that matter.
   The automated pass does the finding; it does not do the deciding. */

const SEVERITY: Record<Severity, { ink: string; bg: string; label: string; icon: typeof Info }> = {
  serious: { ink: 'var(--danger)', bg: 'var(--danger-bg)', label: 'Serious', icon: ShieldAlert },
  suspect: { ink: 'var(--warning)', bg: 'var(--warning-bg)', label: 'Worth a look', icon: TriangleAlert },
  note: { ink: 'var(--text-tertiary)', bg: 'var(--bg-alt)', label: 'Note', icon: Info },
}

export function OperatorReviews() {
  const [reviews, setReviews] = useState<Review[]>([])
  const [products, setProducts] = useState<Record<string, Product>>({})
  const [loading, setLoading] = useState(true)
  const [reason, setReason] = useState<Record<string, RejectReason>>({})
  const [tab, setTab] = useState<'pending' | 'published' | 'rejected'>('pending')
  const [flaggedOnly, setFlaggedOnly] = useState(false)

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

  /* Screened against every review on the marketplace, published ones included —
     a copy of something already on the site is exactly what this is for. */
  const screenings = useMemo(() => {
    const sellers = [...new Set(Object.values(products).map(p => p.seller))]
    return screenAll(reviews, { corpus: reviews, otherSellers: sellers })
  }, [reviews, products])

  const decide = async (r: Review, decision: 'published' | 'rejected') => {
    const why = decision === 'rejected' ? (reason[r.id] ?? null) : null
    const problem = validateModeration(decision, why)
    if (problem) { toast(problem, 'error'); return }

    const { error } = await supabase.from('product_reviews')
      .update({ status: decision, reject_reason: why })
      .eq('id', r.id)
    if (error) { toast(`That did not save: ${error.message}`, 'error'); return }
    await load()
    toast(decision === 'published' ? 'Review published' : `Review refused — ${why}`)
  }

  if (loading) return <div style={{ textAlign: 'center', padding: '40px' }}><div className="spinner" style={{ margin: '0 auto' }} /></div>

  const pendingRaw = reviews.filter(r => r.status === 'pending')
  const pending = triage(pendingRaw, screenings)
  const published = orderForDisplay(reviews)
  const rejected = reviews.filter(r => r.status === 'rejected')

  const summary = screeningSummary(new Map(pendingRaw.map(r => [r.id, screenings.get(r.id)!])))

  const base = tab === 'pending' ? pending : tab === 'published' ? published : rejected
  const shown = flaggedOnly && tab === 'pending'
    ? base.filter(r => (screenings.get(r.id)?.flags.length ?? 0) > 0)
    : base

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div>
        <h1 style={{ fontSize: 'var(--text-2xl)', fontWeight: 800, color: 'var(--text)' }}>Reviews</h1>
        <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)', marginTop: '4px' }}>
          {pending.length} awaiting a decision · {published.length} published · {rejected.length} refused
        </p>
      </div>

      <Callout tone="info">
        Every review is screened automatically before it reaches this queue — for duplicates, junk text,
        contact details, links, and a rating that contradicts what it says. The screen never publishes and
        never refuses: it says what is wrong and shows the text that set it off, and a person decides. What
        it saves is the reading, not the judgement.
      </Callout>

      {tab === 'pending' && pendingRaw.length > 0 && (
        <div className="stat-row">
          <StatCard label="Awaiting a decision" value={String(summary.total)}
                    sublabel="Oldest first within each severity" />
          <StatCard label="Serious" value={String(summary.serious)}
                    sublabel="Duplicate, junk or personal data" color="var(--danger)" />
          <StatCard label="Worth a look" value={String(summary.suspect)}
                    sublabel="A link, a rival named, or the stars disagree" color="var(--warning)" />
          <StatCard label="Nothing flagged" value={String(summary.clean)}
                    sublabel="Still needs a decision — clean is not published" color="var(--success)" />
        </div>
      )}

      <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
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

        {tab === 'pending' && summary.total > 0 && (
          <label style={{ display: 'flex', gap: '6px', alignItems: 'center', marginLeft: '6px', fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', cursor: 'pointer' }}>
            <input type="checkbox" checked={flaggedOnly} onChange={e => setFlaggedOnly(e.target.checked)} />
            Only the {summary.serious + summary.suspect} the screen flagged
          </label>
        )}
      </div>

      <SectionCard title={tab === 'pending' ? 'Awaiting a decision' : tab === 'published' ? 'Published' : 'Refused'}>
        {shown.length === 0 ? <EmptyState message="Nothing here" /> : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', padding: '14px 16px' }}>
            {shown.map(r => {
              const s = screenings.get(r.id)
              const worst = s?.worst ?? null
              const tone = worst ? SEVERITY[worst] : null
              const product = products[r.product_id]

              return (
                <div key={r.id} style={{
                  border: `1px solid ${tone && tab === 'pending' ? tone.ink : 'var(--border)'}`,
                  borderRadius: 'var(--radius)', overflow: 'hidden',
                }}>
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: '10px', padding: '9px 12px',
                    background: tone && tab === 'pending' ? tone.bg : 'var(--bg-alt)',
                    borderBottom: '1px solid var(--border-light)', flexWrap: 'wrap',
                  }}>
                    <Package size={14} style={{ color: 'var(--text-tertiary)', flexShrink: 0 }} />
                    <span style={{ fontSize: 'var(--text-sm)', fontWeight: 700 }}>
                      {product?.name ?? r.product_id}
                    </span>
                    {/* Who carries the consequence of this review. A seller's
                        rating moves; a first-party listing's does not answer to
                        anyone outside the marketplace. */}
                    <span style={{ fontSize: '10px', color: 'var(--text-tertiary)' }}>
                      {product ? (product.partner_id ? `sold by ${product.seller}` : 'first party') : ''}
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

                  {tab === 'pending' && s && (
                    <ScreenPanel
                      screening={s}
                      onUseReason={code => setReason({ ...reason, [r.id]: code as RejectReason })}
                    />
                  )}

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
              )
            })}
          </div>
        )}
      </SectionCard>
    </div>
  )
}

/* What the automated pass found, with the text that set each check off. A flag
   with no evidence behind it is a machine asking to be trusted, which is the
   thing a moderation queue should never do. */
function ScreenPanel({ screening, onUseReason }: {
  screening: Screening
  onUseReason: (reason: string) => void
}) {
  if (screening.flags.length === 0) {
    return (
      <div style={{ display: 'flex', gap: '7px', alignItems: 'center', padding: '8px 12px', borderTop: '1px solid var(--border-light)', background: 'var(--success-bg)' }}>
        <CheckCircle size={13} style={{ color: 'var(--success)', flexShrink: 0 }} />
        <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
          Nothing flagged by the automated screen. It still needs a decision — clean is not the same as published.
        </span>
      </div>
    )
  }

  return (
    <div style={{ borderTop: '1px solid var(--border-light)' }}>
      <div style={{ padding: '7px 12px', background: 'var(--bg-alt)', display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ fontSize: '10px', fontWeight: 800, letterSpacing: '0.03em', textTransform: 'uppercase', color: 'var(--text-secondary)' }}>
          Automated screen
        </span>
        <span style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>
          {screening.flags.length} finding{screening.flags.length === 1 ? '' : 's'} · recommends: <strong>{screening.recommendation}</strong>
        </span>
      </div>
      {screening.flags.map(f => <FlagRow key={f.code} flag={f} onUseReason={onUseReason} />)}
    </div>
  )
}

function FlagRow({ flag, onUseReason }: { flag: Flag; onUseReason: (reason: string) => void }) {
  const tone = SEVERITY[flag.severity]
  const Icon = tone.icon
  return (
    <div style={{ display: 'flex', gap: '9px', padding: '8px 12px', borderTop: '1px solid var(--border-light)', alignItems: 'flex-start' }}>
      <Icon size={13} style={{ color: tone.ink, flexShrink: 0, marginTop: '2px' }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: '11px', fontWeight: 700, color: tone.ink }}>{flag.label}</div>
        <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '1px' }}>{flag.why}</div>
        {flag.evidence && (
          <div style={{
            fontSize: '10px', color: 'var(--text-tertiary)', marginTop: '3px',
            fontFamily: 'ui-monospace, monospace', background: 'var(--bg-alt)',
            padding: '3px 6px', borderRadius: 'var(--radius-sm)', wordBreak: 'break-word',
          }}>
            {flag.evidence}
          </div>
        )}
      </div>
      {/* The check already worked out which refusal reason applies. Making
          somebody re-derive it from a dropdown is asking them to repeat work the
          screen did. */}
      {flag.suggests && (
        <button onClick={() => onUseReason(flag.suggests!)}
                style={{
                  flexShrink: 0, fontSize: '10px', fontWeight: 700, cursor: 'pointer',
                  padding: '3px 8px', borderRadius: 'var(--radius-full)',
                  border: `1px solid ${tone.ink}`, background: 'white', color: tone.ink,
                }}>
          Use “{flag.suggests}”
        </button>
      )}
    </div>
  )
}
