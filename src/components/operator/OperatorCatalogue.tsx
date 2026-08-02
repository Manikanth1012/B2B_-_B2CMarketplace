/* Catalogue governance: what is waiting to be decided, what is on sale, what
 * the operator sells itself, and the rules that decide all three.
 *
 * What was here was one table of a free-standing `operator_listings` record —
 * no summary, no separation between the queue and the catalogue, no images, no
 * policy, no dependencies, and an "Add listing" form that typed a product name
 * into a table nothing else read.
 */

import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  Search, Package, TriangleAlert, CircleCheck as CheckCircle, CircleAlert as AlertCircle,
  Circle, Clock, Layers, MessageSquareWarning, Plus, X, Radio, Minus,
} from 'lucide-react'
import {
  SectionCard, EmptyState, Btn, Modal, FormField, TextArea, TextInput, Select,
  toast, fmtMoney, fmtDate,
} from './shared'
import { Callout } from '../OnboardingJourney'
import {
  loadCatalogue, approveListing, rejectListing, raiseQuery, publishFirstParty,
  createBundle, previewBundle, composePack, setAudiences,
} from '../../lib/catalogueRepo'
import type { CatalogueSnapshot, BundleDraft, PackDraft } from '../../lib/catalogueRepo'
import { compose, compositionProblem, compositionWarnings, maxComponentDiscount, priceBasis } from '../../lib/federation'
import { checkBundleAgainstFloors, bundleRoom, bases, headroom } from '../../lib/pricing'
import type { ComponentPick, TelcoItem } from '../../lib/federation'
import { canApprove, summarise, bundleView, rulesFor, applyPolicy, policyFailures, splitOf } from '../../lib/catalogue'
import type { ProductRow, Submission } from '../../lib/catalogue'
import { Pager, usePaging } from '../Pager'

const ACTOR = 'Aventa catalogue desk'

const RISK: Record<string, { label: string; ink: string; bg: string }> = {
  high:   { label: 'Policy breach', ink: 'var(--danger)',  bg: 'var(--danger-bg)' },
  medium: { label: 'Needs a check', ink: 'var(--warning)', bg: 'var(--warning-bg)' },
  low:    { label: 'Routine',       ink: 'var(--success)', bg: 'var(--success-bg)' },
}

const STATUS_INK: Record<string, string> = {
  live: 'var(--success)', pending: 'var(--warning)',
  rejected: 'var(--danger)', suspended: 'var(--danger)', draft: 'var(--text-tertiary)',
}

type Tab = 'queue' | 'catalogue' | 'firstparty' | 'rules'

/* `focus` is a product id handed over from the dashboard's review queue. */
export function OperatorCatalogue({ focus = null }: { focus?: string | null } = {}) {
  const [snap, setSnap] = useState<CatalogueSnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<Tab>('queue')
  const [openProduct, setOpenProduct] = useState<string | null>(focus)
  const [decide, setDecide] = useState<{ sub: Submission; mode: 'approve' | 'reject' | 'query' } | null>(null)
  const [bundleOpen, setBundleOpen] = useState(false)
  const [packOpen, setPackOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [catFilter, setCatFilter] = useState('')
  const [stateFilter, setStateFilter] = useState('')

  const reload = useCallback(async () => setSnap(await loadCatalogue()), [])
  useEffect(() => { reload().then(() => setLoading(false)) }, [reload])

  const today = useMemo(() => new Date(), [])
  const stats = useMemo(() => snap ? summarise(snap.submissions, snap.products, today) : null, [snap, today])

  if (loading || !snap || !stats) {
    return <div style={{ textAlign: 'center', padding: '40px' }}><div className="spinner" style={{ margin: '0 auto' }} /></div>
  }

  const productOf = (id: string) => snap.products.find(p => p.id === id) ?? null
  const catName = (id: string) => snap.categories.find(c => c.id === id)?.name ?? id
  const heroOf = (id: string) => snap.media.find(m => m.product_id === id && m.role === 'hero')?.url ?? null

  const queue = snap.submissions
    .filter(s => s.status === 'pending')
    .sort((a, b) => ({ high: 0, medium: 1, low: 2 })[a.risk] - ({ high: 0, medium: 1, low: 2 })[b.risk])
  const blocked = queue.filter(s => s.risk === 'high')

  const catalogue = snap.products.filter(p => {
    const q = search.trim().toLowerCase()
    if (q && !`${p.name} ${p.id} ${p.seller} ${p.sub_category}`.toLowerCase().includes(q)) return false
    if (catFilter && p.category_id !== catFilter) return false
    if (stateFilter && p.status !== stateFilter) return false
    return true
  })

  const firstParty = snap.products.filter(p => p.partner_id === null)
  const bundles = snap.products.filter(p => snap.components.some(c => c.bundle_id === p.id))
  /* A pack is a first-party listing composed from the rate card. More than one
     federated component makes it a pack; exactly one makes it a rate-card item
     resold as it stands, which is a different thing and reads differently. */
  const packComponentsOf = (id: string) => snap.packComponents.filter(c => c.product_id === id)
  const packs = snap.products.filter(p => packComponentsOf(p.id).length > 1)
  const federatedSingles = snap.products.filter(p => packComponentsOf(p.id).length === 1)

  const act = async (fn: () => Promise<{ ok: boolean; reason?: string; note?: string }>, ok: string) => {
    const res = await fn()
    if (!res.ok) { toast(res.reason ?? 'That did not work', 'error'); return false }
    toast(res.note ?? ok)
    await reload()
    return true
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '16px', flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontSize: 'var(--text-2xl)', fontWeight: 800, color: 'var(--text)' }}>Catalogue</h1>
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)', marginTop: '4px' }}>
            {stats.waiting} awaiting review · {stats.live} live across {snap.categories.length} marketplaces ·{' '}
            {firstParty.filter(p => p.status === 'live').length} sold first party
          </p>
        </div>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <Btn variant="secondary" onClick={() => setPackOpen(true)}><Radio size={14} /> Compose an operator pack</Btn>
          <Btn onClick={() => setBundleOpen(true)}><Plus size={14} /> Compose a bundle</Btn>
        </div>
      </div>

      {snap.loadError && <Callout tone="danger" title="Some of this screen did not load">{snap.loadError}</Callout>}

      {/* Named, not counted. "1 blocked" is a number; this is a decision
          somebody has to take and a rule they cannot go around. */}
      {blocked.length > 0 && (
        <Callout tone="danger" title={`${blocked.length} listing${blocked.length === 1 ? '' : 's'} cannot be approved as submitted`}>
          {blocked.map(s => productOf(s.product_id)?.name).filter(Boolean).join(', ')} — {blocked[0].issue}
        </Callout>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: '12px' }}>
        <Stat label="Awaiting review" value={String(stats.waiting)}
              sub={`${stats.flagged} need a policy or certification check`} ink="var(--warning)" />
        <Stat label="Median time waiting"
              value={stats.medianAgeDays === null ? 'Nothing waiting' : `${stats.medianAgeDays} days`}
              sub="Target is one working day"
              ink={stats.medianAgeDays !== null && stats.medianAgeDays > 1 ? 'var(--danger)' : 'var(--text)'} />
        <Stat label="Approval rate"
              value={stats.approvalRate === null ? 'Nothing decided' : `${stats.approvalRate}%`}
              sub={`${stats.rejected} refused, mostly for missing evidence`} />
        <Stat label="Live listings" value={String(stats.live)}
              sub={`${stats.suspended} suspended with their seller`} ink="var(--success)" />
      </div>

      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
        {([
          ['queue', `Review queue (${queue.length})`],
          ['catalogue', `Live catalogue (${snap.products.length})`],
          ['firstparty', `First party (${firstParty.length})`],
          ['rules', `Dependencies (${snap.rules.length})`],
        ] as [Tab, string][]).map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)} style={{
            padding: '8px 15px', borderRadius: 'var(--radius)', cursor: 'pointer',
            fontSize: 'var(--text-sm)', fontWeight: 600, border: '1px solid var(--border)',
            background: tab === id ? 'var(--brand-navy)' : 'white',
            color: tab === id ? 'white' : 'var(--text-secondary)',
          }}>{label}</button>
        ))}
      </div>

      {tab === 'queue' && (
        <SectionCard title="Review queue" subtitle="Decisions are visible to the seller with the reason you give">
          {queue.length === 0 ? <EmptyState message="Nothing is waiting" /> : (
            <div>
              {queue.map(s => {
                const p = productOf(s.product_id)
                if (!p) return null
                const r = RISK[s.risk]
                const verdict = canApprove(s)
                const q = snap.queries.filter(x => x.product_id === p.id && x.status !== 'closed')
                return (
                  <div key={s.id} style={{ padding: '15px 20px', borderTop: '1px solid var(--border-light)' }}>
                    <div style={{ display: 'flex', gap: '13px', alignItems: 'flex-start', flexWrap: 'wrap' }}>
                      <Thumb url={heroOf(p.id)} />
                      <div style={{ flex: 1, minWidth: '240px' }}>
                        <div style={{ display: 'flex', gap: '7px', alignItems: 'center', flexWrap: 'wrap', marginBottom: '4px' }}>
                          <Pill ink={r.ink} bg={r.bg}>{r.label}</Pill>
                          <span style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>
                            {catName(p.category_id)} · submitted {fmtDate(s.submitted_at)}
                            {s.submitted_at && ` · ${daysAgo(s.submitted_at, today)} in queue`}
                          </span>
                        </div>
                        <button onClick={() => setOpenProduct(p.id)} style={{
                          background: 'none', border: 'none', padding: 0, cursor: 'pointer', textAlign: 'left',
                          fontSize: 'var(--text-base)', fontWeight: 700, color: 'var(--brand-navy)',
                        }}>{p.name}</button>
                        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
                          {p.seller} · {p.id} · from {s.submitted_by ?? 'the seller'}
                        </div>
                        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', marginTop: '6px' }}>{s.check_note}</div>
                        {s.issue && (
                          <div style={{ display: 'flex', gap: '6px', marginTop: '5px', alignItems: 'flex-start' }}>
                            <AlertCircle size={13} style={{ color: r.ink, flexShrink: 0, marginTop: '1px' }} />
                            <span style={{ fontSize: 'var(--text-xs)', color: r.ink }}>{s.issue}</span>
                          </div>
                        )}
                        {q.length > 0 && (
                          <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', marginTop: '5px' }}>
                            {q.length} quer{q.length === 1 ? 'y' : 'ies'} with the seller — {q[0].subject}
                            {q[0].status === 'overdue' && <strong style={{ color: 'var(--danger)' }}> (overdue)</strong>}
                          </div>
                        )}
                      </div>
                      <div style={{ textAlign: 'right', flexShrink: 0 }}>
                        <div style={{ fontSize: 'var(--text-lg)', fontWeight: 800 }}>${fmtMoney(p.price)}</div>
                        <div style={{ fontSize: '10px', color: 'var(--text-tertiary)' }}>
                          {p.model === 'monthly' ? 'per month' : 'one-off'}
                        </div>
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: '7px', marginTop: '11px', flexWrap: 'wrap', alignItems: 'center' }}>
                      <span style={{ flex: 1, fontSize: '11px', color: 'var(--text-tertiary)', minWidth: '180px' }}>
                        {verdict.ok ? 'The seller is told the reason either way.' : 'Approve is disabled on a stated policy breach.'}
                      </span>
                      <Btn variant="secondary" size="sm" onClick={() => setOpenProduct(p.id)}>Full review</Btn>
                      <Btn variant="secondary" size="sm" onClick={() => setDecide({ sub: s, mode: 'query' })}>
                        <MessageSquareWarning size={13} /> Ask the seller
                      </Btn>
                      <Btn variant="danger" size="sm" onClick={() => setDecide({ sub: s, mode: 'reject' })}>Reject</Btn>
                      <Btn size="sm" disabled={!verdict.ok} onClick={() => setDecide({ sub: s, mode: 'approve' })}>Approve</Btn>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </SectionCard>
      )}

      {tab === 'catalogue' && (
        <SectionCard title="Live catalogue" subtitle={`${catalogue.length} shown`}>
          <div style={{ padding: '13px 20px', display: 'flex', gap: '9px', flexWrap: 'wrap', borderBottom: '1px solid var(--border-light)' }}>
            <div style={{ position: 'relative', flex: '1 1 240px', maxWidth: '340px' }}>
              <Search size={14} style={{ position: 'absolute', left: '9px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-tertiary)' }} />
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search listing, SKU or seller"
                     style={{ width: '100%', padding: '7px 10px 7px 30px', borderRadius: 'var(--radius)', border: '1px solid var(--border)', fontSize: 'var(--text-xs)', outline: 'none', color: 'var(--text)' }} />
            </div>
            <Select value={catFilter} onChange={e => setCatFilter(e.target.value)} style={{ fontSize: 'var(--text-xs)', padding: '6px 9px' }}>
              <option value="">Every marketplace</option>
              {snap.categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
            <Select value={stateFilter} onChange={e => setStateFilter(e.target.value)} style={{ fontSize: 'var(--text-xs)', padding: '6px 9px' }}>
              <option value="">Every state</option>
              {['live', 'pending', 'rejected', 'suspended'].map(s => <option key={s} value={s}>{s}</option>)}
            </Select>
          </div>
          <ProductTable products={catalogue} snap={snap} onOpen={setOpenProduct} heroOf={heroOf} catName={catName} />
        </SectionCard>
      )}

      {tab === 'firstparty' && (
        <>
          {/* The rate card first, because it is where everything on this tab
              comes from. Without it "first party" is only a statement about who
              does not sell a thing. */}
          <RateCard telco={snap.telco} rule={snap.bundleRule} used={snap.packComponents} />

          <SectionCard
            title={`Operator packs (${packs.length})`}
            subtitle="Composed from the rate card above. The price is derived from the components, never typed."
            action={<Btn size="sm" variant="secondary" onClick={() => setPackOpen(true)}><Plus size={13} /> Compose</Btn>}>
            {packs.length === 0 ? (
              <EmptyState message="No operator packs composed yet" />
            ) : (
              <div style={{ padding: '14px 20px', display: 'flex', flexDirection: 'column', gap: '11px' }}>
                {packs.map(p => (
                  <PackRow key={p.id} product={p} lines={packComponentsOf(p.id)}
                           catName={catName} onOpen={setOpenProduct} />
                ))}
              </div>
            )}
          </SectionCard>

          {federatedSingles.length > 0 && (
            <SectionCard title={`Federated singles (${federatedSingles.length})`}
                         subtitle="One rate-card item, resold as it stands. The marketplace price is a channel decision, not a different product.">
              <div style={{ padding: '10px 20px 14px' }}>
                {federatedSingles.map(p => {
                  const line = packComponentsOf(p.id)[0]
                  const card = line.rc_at > 0 ? line.rc_at * line.quantity : line.nrc_at * line.quantity
                  const delta = +(p.price - card).toFixed(2)
                  return (
                    <div key={p.id} style={{ display: 'flex', gap: '10px', alignItems: 'baseline', padding: '7px 0', borderBottom: '1px solid var(--border-light)', flexWrap: 'wrap' }}>
                      <button onClick={() => setOpenProduct(p.id)}
                              style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: 'var(--text-xs)', fontWeight: 700, color: 'var(--brand-navy)', minWidth: '160px', textAlign: 'left' }}>
                        {p.name}
                      </button>
                      <span style={{ fontSize: '10px', color: 'var(--text-tertiary)', flex: 1, minWidth: '180px' }}>
                        {line.quantity > 1 ? `${line.quantity} × ` : ''}{line.name_at} ({line.telco_id})
                      </span>
                      <span style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>rate card ${fmtMoney(card)}</span>
                      <span style={{ fontSize: 'var(--text-xs)', fontWeight: 700 }}>sells at ${fmtMoney(p.price)}</span>
                      <span style={{ fontSize: '10px', fontWeight: 700, minWidth: '92px', textAlign: 'right',
                                     color: delta < 0 ? 'var(--success)' : delta > 0 ? 'var(--warning)' : 'var(--text-tertiary)' }}>
                        {delta === 0 ? 'at rate card' : delta < 0 ? `${fmtMoney(Math.abs(delta))} discount` : `${fmtMoney(delta)} uplift`}
                      </span>
                    </div>
                  )
                })}
              </div>
            </SectionCard>
          )}

          <SectionCard title="First-party listings"
                       subtitle="Federated from the operator's own catalogue. No partner, no commission, no settlement.">
            <div style={{ padding: '14px 20px' }}>
              <Callout tone="info">
                These are not typed in. The operator's products already exist in its own catalogue — publishing
                one puts it on the marketplace, and everything a buyer sees comes from the product record rather
                than a second copy that can drift away from it.
              </Callout>
              <div style={{ marginTop: '12px', display: 'flex', flexDirection: 'column', gap: '7px' }}>
                {firstParty.filter(p => p.status !== 'live').length === 0 ? (
                  <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', margin: 0 }}>
                    Everything in the operator catalogue is already on the marketplace.
                    {' '}{firstParty.length} first-party listing{firstParty.length === 1 ? '' : 's'} live.
                  </p>
                ) : firstParty.filter(p => p.status !== 'live').map(p => (
                  <div key={p.id} style={{ display: 'flex', gap: '10px', alignItems: 'center', padding: '9px 11px', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)' }}>
                    <Thumb url={heroOf(p.id)} size={32} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 'var(--text-xs)', fontWeight: 700 }}>{p.name}</div>
                      <div style={{ fontSize: '10px', color: 'var(--text-tertiary)' }}>{p.id} · {catName(p.category_id)} · ${fmtMoney(p.price)}</div>
                    </div>
                    <Btn size="sm" onClick={() => act(() => publishFirstParty({ productId: p.id, actor: ACTOR }), `${p.name} is live`)}>Publish</Btn>
                  </div>
                ))}
              </div>
              <div style={{ marginTop: '14px' }}>
                <ProductTable products={firstParty} snap={snap} onOpen={setOpenProduct} heroOf={heroOf} catName={catName} />
              </div>
            </div>
          </SectionCard>

          <SectionCard title="Bundles" subtitle={`${bundles.length} composed · a bundle always costs less than its parts`}>
            {bundles.length === 0 ? <EmptyState message="No bundles composed" /> : (
              <div style={{ padding: '14px 20px', display: 'flex', flexDirection: 'column', gap: '11px' }}>
                {bundles.map(b => {
                  const v = bundleView(b, snap.components, snap.products)!
                  const sellers = [...new Set(v.parts.map(p => p.component.seller))]
                  return (
                    <div key={b.id} style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
                      <div style={{ display: 'flex', gap: '10px', alignItems: 'center', padding: '10px 13px', background: 'var(--bg-alt)', flexWrap: 'wrap' }}>
                        <Layers size={15} style={{ color: 'var(--text-tertiary)' }} />
                        <button onClick={() => setOpenProduct(b.id)} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: 'var(--text-sm)', fontWeight: 700, color: 'var(--brand-navy)' }}>{b.name}</button>
                        <span style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>
                          sold by {b.seller} · {sellers.length} seller{sellers.length === 1 ? '' : 's'} inside
                        </span>
                        <span style={{ marginLeft: 'auto', fontSize: 'var(--text-sm)', fontWeight: 800 }}>${fmtMoney(b.price)}</span>
                        <span style={{ fontSize: '11px', color: 'var(--success)', fontWeight: 700 }}>saves ${fmtMoney(v.saving)} ({v.savingPct}%)</span>
                      </div>
                      {v.unavailable.length > 0 && (
                        <div style={{ padding: '8px 13px', background: 'var(--danger-bg)', fontSize: '11px', color: 'var(--danger)' }}>
                          Cannot be fulfilled: {v.unavailable.map(u => u.name).join(', ')} {v.unavailable.length === 1 ? 'is' : 'are'} not on sale.
                        </div>
                      )}
                      <div>
                        {v.parts.map(part => (
                          <div key={part.component.id} style={{ display: 'flex', gap: '9px', padding: '8px 13px', borderTop: '1px solid var(--border-light)', fontSize: 'var(--text-xs)', flexWrap: 'wrap' }}>
                            <span style={{ color: 'var(--text-tertiary)', minWidth: '32px' }}>{part.quantity}×</span>
                            <span style={{ flex: 1, minWidth: '160px' }}>
                              {part.component.name}
                              <span style={{ color: 'var(--text-tertiary)' }}> · {part.component.seller}</span>
                              {part.note && <div style={{ fontSize: '10px', color: 'var(--text-tertiary)' }}>{part.note}</div>}
                            </span>
                            <span style={{ color: 'var(--text-secondary)' }}>${fmtMoney(part.lineTotal)}</span>
                          </div>
                        ))}
                        <div style={{ display: 'flex', padding: '8px 13px', borderTop: '1px solid var(--border)', fontSize: 'var(--text-xs)', fontWeight: 700 }}>
                          <span style={{ flex: 1 }}>Bought separately</span>
                          <span>${fmtMoney(v.partsTotal)}</span>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </SectionCard>
        </>
      )}

      {tab === 'rules' && <DependencyRules snap={snap} catName={catName} onOpen={setOpenProduct} />}

      {openProduct && productOf(openProduct) && (
        <ProductInspector
          product={productOf(openProduct)!}
          snap={snap}
          today={today}
          onClose={() => setOpenProduct(null)}
          catName={catName}
          onChanged={reload}
          onDecide={(sub, mode) => { setOpenProduct(null); setDecide({ sub, mode }) }}
        />
      )}

      {decide && productOf(decide.sub.product_id) && (
        <DecideDialog
          sub={decide.sub}
          mode={decide.mode}
          product={productOf(decide.sub.product_id)!}
          onClose={() => setDecide(null)}
          onSubmit={async (text) => {
            const s = decide.sub
            const done = decide.mode === 'approve'
              ? await act(() => approveListing({ submissionId: s.id, actor: ACTOR, note: text }), 'Approved and published')
              : decide.mode === 'reject'
              ? await act(() => rejectListing({ submissionId: s.id, actor: ACTOR, reason: text }), 'Rejected — the seller has been told why')
              : await act(() => raiseQuery({
                  productId: s.product_id, partnerId: s.partner_id,
                  subject: 'Question on your listing', body: text, actor: ACTOR,
                }), 'Query raised')
            if (done) setDecide(null)
          }}
        />
      )}

      {packOpen && (
        <PackComposer
          snap={snap}
          onClose={() => setPackOpen(false)}
          onCreate={async draft => {
            const res = await composePack({ draft, telco: snap.telco, rule: snap.bundleRule, actor: ACTOR })
            if (!res.ok) { toast(res.reason, 'error'); return }
            toast(res.note ?? `${draft.name} is live`)
            setPackOpen(false)
            await reload()
          }}
        />
      )}

      {bundleOpen && (
        <BundleBuilder
          snap={snap}
          onClose={() => setBundleOpen(false)}
          onCreate={async draft => {
            const res = await createBundle({ draft, actor: ACTOR })
            if (!res.ok) { toast(res.reason, 'error'); return }
            toast(res.note ?? `${draft.name} is live`)
            setBundleOpen(false)
            await reload()
          }}
        />
      )}
    </div>
  )
}

/* ------------------------------------------------------ product table ---- */

function ProductTable({ products, snap, onOpen, heroOf, catName }: {
  products: ProductRow[]
  snap: CatalogueSnapshot
  onOpen: (id: string) => void
  heroOf: (id: string) => string | null
  catName: (id: string) => string
}) {
  /* The catalogue is the list most likely to grow past what a screen can hold,
     and the one an operator most often comes back to a particular row of. */
  const page = usePaging(products, { resetKey: `${products.length}:${products[0]?.id ?? ''}` })
  if (products.length === 0) return <EmptyState message="No listing matches that" />
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 'max(820px, min-content)' }}>
        <thead><tr style={{ borderBottom: '1px solid var(--border)' }}>
          {['Listing', 'Marketplace', 'Seller', 'Price', 'Commission', 'Rules', 'State'].map(h => (
            <th key={h} style={{
              textAlign: ['Price', 'Commission'].includes(h) ? 'right' : 'left', padding: '9px 12px',
              fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em',
              color: 'var(--text-tertiary)', whiteSpace: 'nowrap',
            }}>{h}</th>
          ))}
        </tr></thead>
        <tbody>
          {page.rows.map(p => {
            const plan = snap.plans.find(pl => pl.id === snap.partners.find(x => x.id === p.partner_id)?.plan_id)
            const split = splitOf(p, plan?.base_rate ?? null)
            const r = rulesFor(p.id, snap.rules)
            const isBundle = snap.components.some(c => c.bundle_id === p.id)
            return (
              <tr key={p.id} style={{ borderBottom: '1px solid var(--border-light)' }}>
                <td style={{ padding: '8px 12px' }}>
                  <div style={{ display: 'flex', gap: '9px', alignItems: 'center' }}>
                    <Thumb url={heroOf(p.id)} size={30} />
                    <div>
                      <button onClick={() => onOpen(p.id)} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', textAlign: 'left', fontSize: 'var(--text-xs)', fontWeight: 700, color: 'var(--brand-navy)' }}>
                        {p.name}
                        {isBundle && <span style={{ marginLeft: '5px', fontSize: '9px', padding: '1px 5px', borderRadius: '3px', background: 'var(--info-bg)', color: 'var(--info)' }}>BUNDLE</span>}
                      </button>
                      <div style={{ fontSize: '10px', color: 'var(--text-tertiary)' }}>{p.id} · {p.sub_category}</div>
                    </div>
                  </div>
                </td>
                <td style={{ padding: '8px 12px', fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>{catName(p.category_id)}</td>
                <td style={{ padding: '8px 12px', fontSize: 'var(--text-xs)' }}>
                  {p.seller}
                  {p.partner_id === null && <div style={{ fontSize: '10px', color: 'var(--text-tertiary)' }}>first party</div>}
                </td>
                <td style={{ padding: '8px 12px', textAlign: 'right', fontSize: 'var(--text-xs)' }}>${fmtMoney(p.price)}</td>
                <td style={{ padding: '8px 12px', textAlign: 'right', fontSize: 'var(--text-xs)' }}>
                  {split.firstParty ? <span style={{ color: 'var(--text-tertiary)' }}>—</span> : (
                    <>
                      {plan?.base_rate ?? p.comm}%
                      <div style={{ fontSize: '10px', color: 'var(--text-tertiary)' }}>${fmtMoney(split.commission)}</div>
                    </>
                  )}
                </td>
                <td style={{ padding: '8px 12px', fontSize: 'var(--text-xs)', color: r.blocking > 0 ? 'var(--text)' : 'var(--text-tertiary)' }}>
                  {r.blocking > 0 ? `${r.blocking} block` : '—'}
                  {r.worksWith.length > 0 && <div style={{ fontSize: '10px', color: 'var(--text-tertiary)' }}>{r.worksWith.length} advice</div>}
                </td>
                <td style={{ padding: '8px 12px' }}>
                  <span style={{ fontSize: '11px', fontWeight: 700, color: STATUS_INK[p.status] ?? 'var(--text)' }}>{p.status}</span>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <Pager page={page} noun="listings" />
    </div>
  )
}

/* --------------------------------------------------- dependency rules ---- */

function DependencyRules({ snap, catName, onOpen }: {
  snap: CatalogueSnapshot; catName: (id: string) => string; onOpen: (id: string) => void
}) {
  const blocking = snap.rules.filter(r => r.kind !== 'works_with')
  const advice = snap.rules.filter(r => r.kind === 'works_with')
  const LABEL = { requires: 'Requires', excludes: 'Cannot be held with', works_with: 'Suggested with' }

  return (
    <SectionCard
      title="Product dependencies"
      subtitle={`${blocking.length} rules block an order · ${advice.length} are advice only · ${new Set(snap.rules.map(r => r.product_id)).size} products carry at least one`}
    >
      <div style={{ padding: '14px 20px 0' }}>
        <Callout tone="info">
          A requires or excludes rule stops an order being taken. A suggestion never does — it is shown on the
          product and nothing more. Changing a rule affects new baskets only; anything already ordered under
          the old rule stands.
        </Callout>
      </div>
      <div style={{ overflowX: 'auto', marginTop: '12px' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 'max(780px, min-content)' }}>
          <thead><tr style={{ borderBottom: '1px solid var(--border)' }}>
            {['Product', 'Marketplace', 'Relationship', 'Against', 'Enforced'].map(h => (
              <th key={h} style={{ textAlign: 'left', padding: '9px 12px', fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text-tertiary)' }}>{h}</th>
            ))}
          </tr></thead>
          <tbody>
            {[...snap.rules].sort((a, b) => a.product_id.localeCompare(b.product_id) || a.sort_order - b.sort_order).map(r => {
              const p = snap.products.find(x => x.id === r.product_id)
              if (!p) return null
              return (
                <tr key={r.id} style={{ borderBottom: '1px solid var(--border-light)' }}>
                  <td style={{ padding: '9px 12px' }}>
                    <button onClick={() => onOpen(p.id)} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', textAlign: 'left', fontSize: 'var(--text-xs)', fontWeight: 700, color: 'var(--brand-navy)' }}>{p.name}</button>
                    <div style={{ fontSize: '10px', color: 'var(--text-tertiary)' }}>{p.id}</div>
                  </td>
                  <td style={{ padding: '9px 12px', fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>{catName(p.category_id)}</td>
                  <td style={{ padding: '9px 12px', maxWidth: '300px' }}>
                    <div style={{ fontSize: 'var(--text-xs)', fontWeight: 700 }}>{LABEL[r.kind]}</div>
                    <div style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>{r.why}</div>
                  </td>
                  <td style={{ padding: '9px 12px', fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>
                    {r.targets.map(t => snap.products.find(x => x.id === t)?.name ?? t).join(r.kind === 'requires' ? ' or ' : ', ')}
                  </td>
                  <td style={{ padding: '9px 12px' }}>
                    <span style={{ fontSize: '11px', fontWeight: 700, color: r.kind === 'works_with' ? 'var(--text-tertiary)' : 'var(--info)' }}>
                      {r.kind === 'works_with' ? 'Advice only' : 'Blocks the order'}
                    </span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </SectionCard>
  )
}

/* ------------------------------------------------------ the inspector ---- */

function ProductInspector({ product, snap, today, onClose, catName, onChanged, onDecide }: {
  product: ProductRow
  snap: CatalogueSnapshot
  today: Date
  onClose: () => void
  catName: (id: string) => string
  onChanged: () => Promise<void>
  onDecide: (sub: Submission, mode: 'approve' | 'reject' | 'query') => void
}) {
  const media = snap.media.filter(m => m.product_id === product.id).sort((a, b) => a.sort_order - b.sort_order)
  const [shot, setShot] = useState(0)
  const policy = snap.policies.find(p => p.category_id === product.category_id) ?? null
  const applied = applyPolicy(product, policy, snap.policyRules, snap.matrix, snap.media)
  const failures = policyFailures(applied)
  const rules = rulesFor(product.id, snap.rules)
  const bundle = bundleView(product, snap.components, snap.products)
  const partner = snap.partners.find(p => p.id === product.partner_id) ?? null
  const plan = snap.plans.find(pl => pl.id === partner?.plan_id) ?? null
  const split = splitOf(product, plan?.base_rate ?? null)
  const sub = snap.submissions.find(s => s.product_id === product.id && s.status === 'pending')
    ?? snap.submissions.filter(s => s.product_id === product.id).sort((a, b) => b.version - a.version)[0]
  const queries = snap.queries.filter(q => q.product_id === product.id)
  const nameOf = (id: string) => snap.products.find(p => p.id === id)?.name ?? id

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.5)', zIndex: 400, display: 'flex', justifyContent: 'flex-end' }}>
      <div onClick={e => e.stopPropagation()} style={{ background: 'white', width: 'min(660px, 100%)', height: '100%', overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', gap: '12px', alignItems: 'flex-start', position: 'sticky', top: 0, background: 'white', zIndex: 2 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', gap: '7px', alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{ fontSize: '11px', fontWeight: 700, color: STATUS_INK[product.status] }}>{product.status}</span>
              <span style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>{catName(product.category_id)} · {product.sub_category}</span>
            </div>
            <h3 style={{ fontSize: 'var(--text-lg)', fontWeight: 800, margin: '3px 0 0' }}>{product.name}</h3>
            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
              {product.id} · {product.seller}{product.partner_id === null ? ' (first party)' : ''}
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-tertiary)' }}><X size={18} /></button>
        </div>

        <div style={{ padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: '18px' }}>
          {failures.length > 0 && (
            <Callout tone="danger" title={`${failures.length} enforced rule${failures.length === 1 ? '' : 's'} this listing fails`}>
              {failures.map(f => `${f.rule.name}: ${f.automatic!.detail}`).join(' ')}
            </Callout>
          )}

          {/* Big enough to judge. A review of a picture nobody can see is a
              review of a filename. */}
          <section>
            <SubHead>Images ({media.length})</SubHead>
            {media.length === 0 ? (
              <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', margin: 0 }}>No images. This listing cannot go live.</p>
            ) : (
              <>
                <div style={{ aspectRatio: '16 / 10', borderRadius: 'var(--radius-md)', overflow: 'hidden', background: 'var(--bg-alt)', border: '1px solid var(--border)' }}>
                  <img src={media[Math.min(shot, media.length - 1)].url} alt={media[Math.min(shot, media.length - 1)].alt ?? ''}
                       style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                </div>
                <div style={{ display: 'flex', gap: '6px', marginTop: '7px', flexWrap: 'wrap' }}>
                  {media.map((m, i) => (
                    <button key={m.id} onClick={() => setShot(i)} style={{
                      width: 54, height: 40, padding: 0, cursor: 'pointer', overflow: 'hidden', borderRadius: 'var(--radius-sm)',
                      border: `2px solid ${i === shot ? 'var(--brand-navy)' : m.alt ? 'var(--border)' : 'var(--danger)'}`,
                    }}>
                      <img src={m.url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    </button>
                  ))}
                </div>
                <div style={{ fontSize: '11px', color: media[Math.min(shot, media.length - 1)].alt ? 'var(--text-tertiary)' : 'var(--danger)', marginTop: '5px' }}>
                  {media[Math.min(shot, media.length - 1)].alt
                    ? `Alt text: “${media[Math.min(shot, media.length - 1)].alt}”`
                    : 'No alt text. A screen reader announces this image as nothing at all.'}
                </div>
              </>
            )}
          </section>

          <section>
            <SubHead>Specification</SubHead>
            {Object.keys(product.specs ?? {}).length === 0 ? (
              <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', margin: 0 }}>None recorded.</p>
            ) : (
              <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
                {Object.entries(product.specs).map(([k, v], i) => (
                  <div key={k} style={{ display: 'flex', gap: '12px', padding: '7px 11px', flexWrap: 'wrap', background: i % 2 ? 'var(--bg-alt)' : 'white', borderTop: i === 0 ? 'none' : '1px solid var(--border-light)' }}>
                    <span style={{ flex: '0 0 40%', minWidth: '130px', fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>{k}</span>
                    <span style={{ flex: 1, fontSize: 'var(--text-xs)', fontWeight: 600 }}>{String(v)}</span>
                  </div>
                ))}
              </div>
            )}
            {product.description && <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', marginTop: '9px' }}>{product.description}</p>}
          </section>

          <section>
            <SubHead>Commission</SubHead>
            {/* The band, before the money split. What the seller agreed to
                accept is what decides whether this can go in a bundle at all,
                and the basis decides whether the price above means what the
                reader thinks it does. */}
            {(() => {
              const room = headroom({
                price: Number(product.price),
                floor_price: Number(product.floor_price ?? product.price),
                list_price: Number(product.list_price ?? product.price),
              })
              const tax = bases({
                price: Number(product.price),
                price_includes_tax: product.price_includes_tax ?? true,
                tax_rate: Number(product.tax_rate ?? 0),
              })
              return (
                <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: '12px 14px' }}>
                  <div style={{ fontSize: 'var(--text-xs)', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.03em', color: 'var(--text-secondary)', marginBottom: '7px' }}>
                    Price band
                  </div>
                  {([
                    ['Minimum the seller accepts', `$${fmtMoney(Number(product.floor_price ?? product.price))}`],
                    ['Asking price', `$${fmtMoney(Number(product.price))} ${tax.quotedIn === 'gross' ? 'including tax' : 'excluding tax'}`],
                    ['Maximum (RRP)', `$${fmtMoney(Number(product.list_price ?? product.price))}`],
                    ['Buyer pays / seller books', `$${fmtMoney(tax.gross)} / $${fmtMoney(tax.net)} at ${tax.rate}%`],
                  ] as [string, string][]).map(([k, v]) => (
                    <div key={k} style={{ display: 'flex', gap: '10px', fontSize: 'var(--text-xs)', padding: '2px 0' }}>
                      <span style={{ flex: 1, color: 'var(--text-secondary)' }}>{k}</span>
                      <span style={{ fontWeight: 600 }}>{v}</span>
                    </div>
                  ))}
                  <div style={{
                    marginTop: '7px', paddingTop: '7px', borderTop: '1px solid var(--border-light)',
                    fontSize: 'var(--text-xs)', fontWeight: 700,
                    color: room.none ? 'var(--danger)' : 'var(--success)',
                  }}>
                    {room.none
                      ? 'No discount room — this cannot go into a bundle.'
                      : `You may discount up to $${fmtMoney(room.amount)} (${room.pct}%) when composing a bundle.`}
                  </div>
                </div>
              )
            })()}

            {split.firstParty ? (
              <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', margin: 0 }}>
                First party — the operator sells this itself. There is no partner, so no commission is taken and
                nothing is settled. The whole ${fmtMoney(product.price)} is the marketplace's own revenue.
              </p>
            ) : (
              <>
                <div style={{ display: 'flex', height: '26px', borderRadius: 'var(--radius-sm)', overflow: 'hidden', marginBottom: '9px' }}>
                  <div style={{ width: `${(split.net / split.gross) * 100}%`, background: 'var(--brand-navy)' }} />
                  <div style={{ width: `${(split.commission / split.gross) * 100}%`, background: '#5E4B9B' }} />
                  <div style={{ width: `${(split.fees / split.gross) * 100}%`, background: '#B8A4E8' }} />
                </div>
                <Facts rows={[
                  ['Sale price', `$${fmtMoney(split.gross)}`],
                  ['Marketplace commission', `$${fmtMoney(split.commission)} at ${plan?.base_rate ?? product.comm}%${plan ? ` · ${plan.name}` : ''}`],
                  ['Payment and per-order fees', `$${fmtMoney(split.fees)}`],
                  ['Settles to the seller', `$${fmtMoney(split.net)}`],
                ]} />
              </>
            )}
          </section>

          {bundle && (
            <section>
              <SubHead>What is in the bundle</SubHead>
              <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
                {bundle.parts.map((part, i) => (
                  <div key={part.component.id} style={{ display: 'flex', gap: '9px', padding: '8px 11px', fontSize: 'var(--text-xs)', borderTop: i === 0 ? 'none' : '1px solid var(--border-light)', flexWrap: 'wrap' }}>
                    <span style={{ color: 'var(--text-tertiary)', minWidth: '30px' }}>{part.quantity}×</span>
                    <span style={{ flex: 1, minWidth: '150px' }}>
                      {part.component.name}
                      <span style={{ color: 'var(--text-tertiary)' }}> · {part.component.seller}</span>
                      {part.note && <div style={{ fontSize: '10px', color: 'var(--text-tertiary)' }}>{part.note}</div>}
                    </span>
                    <span>${fmtMoney(part.lineTotal)}</span>
                  </div>
                ))}
                <div style={{ display: 'flex', padding: '8px 11px', borderTop: '1px solid var(--border)', fontSize: 'var(--text-xs)', background: 'var(--success-bg)' }}>
                  <span style={{ flex: 1, fontWeight: 700 }}>Bought separately ${fmtMoney(bundle.partsTotal)}</span>
                  <span style={{ fontWeight: 800, color: 'var(--success)' }}>saves ${fmtMoney(bundle.saving)} ({bundle.savingPct}%)</span>
                </div>
              </div>
            </section>
          )}

          {/* The shelf decides who sees the aisle; this decides whose listing
              it is. Both are needed: IoT carries a $52 occupancy sensor and a
              fifty-unit fleet bundle, and no shelf rule can tell them apart. */}
          <section>
            <SubHead>Sold to</SubHead>
            <AudiencePicker product={product} onChanged={onChanged} />
          </section>

          {/* The rules the platform can settle are settled; the rest are named
              for the person who has to settle them. */}
          <section>
            <SubHead>Listing policy — {catName(product.category_id)}</SubHead>
            {policy && (
              <p style={{ fontSize: '11px', color: 'var(--text-tertiary)', margin: '0 0 9px' }}>
                {policy.review} · {policy.auto_publish ? 'auto-publishes on pass' : 'a person decides every listing'} ·
                {' '}returns {policy.returns_window} · fulfilment within {policy.sla_hours} h ·
                {' '}up to {policy.max_listings_per_seller} listings per seller
              </p>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {applied.map(a => (
                <div key={a.rule.id} style={{
                  display: 'flex', gap: '9px', padding: '9px 11px', alignItems: 'flex-start',
                  border: '1px solid var(--border)', borderRadius: 'var(--radius-md)',
                  background: a.automatic && !a.automatic.pass && a.level === 'enforce' ? 'var(--danger-bg)' : 'white',
                }}>
                  <span style={{ flexShrink: 0, marginTop: '1px' }}>
                    {a.automatic === null ? <Circle size={14} style={{ color: 'var(--text-tertiary)' }} />
                      : a.automatic.pass ? <CheckCircle size={14} style={{ color: 'var(--success)' }} />
                      : <AlertCircle size={14} style={{ color: a.level === 'enforce' ? 'var(--danger)' : 'var(--warning)' }} />}
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 'var(--text-xs)', fontWeight: 700 }}>
                      {a.rule.name}
                      <span style={{ fontWeight: 400, color: 'var(--text-tertiary)' }}> · {a.rule.id}</span>
                      {a.level === 'warn' && <span style={{ marginLeft: '5px', fontSize: '9px', padding: '1px 5px', borderRadius: '3px', background: 'var(--warning-bg)', color: 'var(--warning)', fontWeight: 700 }}>WARN ONLY</span>}
                    </div>
                    <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', marginTop: '1px' }}>{a.rule.descr}</div>
                    <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '3px' }}>
                      {a.automatic ? a.automatic.detail
                        : `Checked by ${a.rule.owner}${a.rule.evidence ? ` against: ${a.rule.evidence}` : ''}. Nothing here reads it for you.`}
                    </div>
                    {a.rule.locked && <div style={{ fontSize: '10px', color: 'var(--danger)', marginTop: '3px' }}>{a.rule.locked}</div>}
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section>
            <SubHead>Dependencies</SubHead>
            {rules.blocking === 0 && rules.worksWith.length === 0 ? (
              <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', margin: 0 }}>
                None. This can be bought on its own and alongside anything.
              </p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {[...rules.requires, ...rules.excludes, ...rules.worksWith].map(r => (
                  <div key={r.id} style={{ padding: '9px 11px', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)' }}>
                    <div style={{ fontSize: 'var(--text-xs)', fontWeight: 700 }}>
                      {r.kind === 'requires' ? 'Requires' : r.kind === 'excludes' ? 'Cannot be held with' : 'Suggested with'}{' '}
                      <span style={{ fontWeight: 600, color: 'var(--brand-navy)' }}>
                        {r.targets.map(nameOf).join(r.kind === 'requires' ? ' or ' : ', ')}
                      </span>
                    </div>
                    <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', marginTop: '2px' }}>{r.why}</div>
                    <div style={{ fontSize: '10px', color: r.kind === 'works_with' ? 'var(--text-tertiary)' : 'var(--info)', marginTop: '2px', fontWeight: 700 }}>
                      {r.kind === 'works_with' ? 'Advice only — never blocks an order' : 'Blocks the order'}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          {queries.length > 0 && (
            <section>
              <SubHead>Queries with the seller</SubHead>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '7px' }}>
                {queries.map(q => (
                  <div key={q.id} style={{ padding: '9px 11px', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', background: q.status === 'overdue' ? 'var(--danger-bg)' : 'white' }}>
                    <div style={{ display: 'flex', gap: '7px', alignItems: 'baseline', flexWrap: 'wrap' }}>
                      <strong style={{ fontSize: 'var(--text-xs)' }}>{q.subject}</strong>
                      <span style={{ fontSize: '10px', fontWeight: 700, color: q.status === 'overdue' ? 'var(--danger)' : q.status === 'answered' ? 'var(--success)' : 'var(--warning)' }}>{q.status}</span>
                      <span style={{ fontSize: '10px', color: 'var(--text-tertiary)' }}>asked {fmtDate(q.asked_on)} by {q.asked_by} · due {fmtDate(q.due_on)}</span>
                    </div>
                    <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '3px' }}>{q.body}</div>
                    {q.answer && (
                      <div style={{ fontSize: '11px', color: 'var(--text)', marginTop: '5px', paddingLeft: '9px', borderLeft: '2px solid var(--success)' }}>
                        {q.answer}
                        <div style={{ fontSize: '10px', color: 'var(--text-tertiary)' }}>answered {fmtDate(q.answered_on)}</div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}

          {sub && (
            <section>
              <SubHead>Review record</SubHead>
              <Facts rows={[
                ['Submitted', `${sub.submitted_by ?? '—'} on ${fmtDate(sub.submitted_at)}${sub.status === 'pending' && sub.submitted_at ? ` · ${daysAgo(sub.submitted_at, today)} in queue` : ''}`],
                ['Check', sub.check_note],
                ['Decision', sub.status === 'pending' ? 'Not yet decided' : `${sub.status} by ${sub.reviewed_by} on ${fmtDate(sub.reviewed_at)}`],
                ...(sub.decision_reason ? [['Reason', sub.decision_reason] as [string, string]] : []),
                ['Version', String(sub.version)],
              ]} />
              {sub.status === 'pending' && (
                <div style={{ display: 'flex', gap: '7px', marginTop: '12px', flexWrap: 'wrap' }}>
                  <Btn variant="secondary" size="sm" onClick={() => onDecide(sub, 'query')}>Ask the seller</Btn>
                  <Btn variant="danger" size="sm" onClick={() => onDecide(sub, 'reject')}>Reject</Btn>
                  <Btn size="sm" disabled={!canApprove(sub).ok} onClick={() => onDecide(sub, 'approve')}>Approve</Btn>
                </div>
              )}
            </section>
          )}
        </div>
      </div>
    </div>
  )
}

/* --------------------------------------------------------- decisions ----- */

function DecideDialog({ sub, mode, product, onClose, onSubmit }: {
  sub: Submission
  mode: 'approve' | 'reject' | 'query'
  product: ProductRow
  onClose: () => void
  onSubmit: (text: string) => void
}) {
  const [text, setText] = useState('')
  const title = mode === 'approve' ? 'Approve and publish' : mode === 'reject' ? 'Reject this listing' : 'Ask the seller'

  return (
    <Modal open onClose={onClose} title={title}
      footer={<>
        <Btn variant="secondary" size="sm" onClick={onClose}>Cancel</Btn>
        <Btn size="sm" variant={mode === 'reject' ? 'danger' : 'primary'} disabled={!text.trim()} onClick={() => onSubmit(text)}>
          {mode === 'approve' ? 'Approve and publish' : mode === 'reject' ? 'Reject' : 'Send'}
        </Btn>
      </>}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '13px' }}>
        <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', margin: 0 }}>
          <strong>{product.name}</strong> from {product.seller}.
        </p>

        {mode === 'approve' && (
          <Callout tone="info" title="What this does">
            The listing goes on sale immediately, and the seller is told it was approved along with what you checked.
          </Callout>
        )}
        {mode === 'reject' && (
          <Callout tone="warning" title="What this does">
            The listing does not go on sale and the seller sees your reason. They can correct it and resubmit,
            which opens a new version rather than reopening this decision.
          </Callout>
        )}
        {mode === 'query' && (
          <Callout tone="info" title="What this does">
            The listing stays in the queue and the seller is asked to answer within four working days. Use this
            instead of rejecting when a sentence from them would settle it.
          </Callout>
        )}

        {sub.issue && <Callout tone="danger" title="The finding on this submission">{sub.issue}</Callout>}

        <FormField
          label={mode === 'approve' ? 'What you checked' : mode === 'reject' ? 'Why' : 'What you need from them'}
          required
          hint={mode === 'reject'
            ? 'Name the rule, name what is missing, and say what would clear it. A rejection they cannot act on comes straight back as a ticket.'
            : 'The seller reads this, and so does the next person to open the listing.'}>
          <TextArea value={text} onChange={e => setText(e.target.value)} rows={4}
                    placeholder={mode === 'approve'
                      ? 'e.g. Type approval verified for all three markets; images and alt text present'
                      : mode === 'reject'
                      ? 'e.g. Policy 7.4 — randomised paid rewards. Withdraw the two markets that prohibit them and resubmit.'
                      : 'e.g. Confirm which markets you intend to sell in'} />
        </FormField>
      </div>
    </Modal>
  )
}

/* ----------------------------------------------------- bundle builder ---- */

function BundleBuilder({ snap, onClose, onCreate }: {
  snap: CatalogueSnapshot
  onClose: () => void
  onCreate: (draft: BundleDraft) => void
}) {
  const [name, setName] = useState('')
  const [categoryId, setCategoryId] = useState(snap.categories[0]?.id ?? '')
  const [price, setPrice] = useState('')
  const [model, setModel] = useState('monthly')
  const [description, setDescription] = useState('')
  const [picked, setPicked] = useState<{ productId: string; quantity: number; note: string }[]>([])
  const [search, setSearch] = useState('')

  /* Only what is on sale, and never another bundle — a bundle of bundles has a
     price nobody can explain. */
  const sellable = snap.products.filter(p => p.status === 'live' && !snap.components.some(c => c.bundle_id === p.id))
  const shown = sellable.filter(p =>
    !picked.some(x => x.productId === p.id) &&
    `${p.name} ${p.seller} ${p.id}`.toLowerCase().includes(search.trim().toLowerCase()))

  const draft: BundleDraft = {
    name, categoryId, subCategory: 'Bundles', description,
    price: parseFloat(price) || 0, model, fulfil: 'provisioned', components: picked,
  }
  const preview = previewBundle(draft, snap.products)
  const sellers = [...new Set(picked.map(p => snap.products.find(x => x.id === p.productId)?.seller).filter(Boolean))]

  /* What each seller agreed to accept. Composing a bundle spends somebody
     else's margin, and until the floors existed the only honest discount was
     none — so this is the number the builder was missing. */
  const components = picked.flatMap(pk => {
    const p = snap.products.find(x => x.id === pk.productId)
    if (!p) return []
    return [{
      productId: p.id, name: p.name, quantity: pk.quantity,
      price: Number(p.price), floor_price: Number(p.floor_price ?? p.price),
    }]
  })
  const room = bundleRoom(components)
  const partsTotal = room.partsTotal
  const saving = +(partsTotal - (parseFloat(price) || 0)).toFixed(2)
  const floorCheck = picked.length >= 2 && parseFloat(price) > 0
    ? checkBundleAgainstFloors(parseFloat(price), components)
    : null

  const problem =
    !name.trim() ? 'Give the bundle a name.'
    : picked.length < 2 ? 'A bundle is two or more things sold together. With one component it is just the product.'
    : !(parseFloat(price) > 0) ? 'Set a price.'
    : floorCheck && !floorCheck.ok ? floorCheck.reason
    : null

  return (
    <Modal open onClose={onClose} title="Compose a bundle"
      footer={<>
        <Btn variant="secondary" size="sm" onClick={onClose}>Cancel</Btn>
        <Btn size="sm" disabled={!!problem} onClick={() => onCreate(draft)}>Create and publish</Btn>
      </>}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
        <Callout tone="info">
          A bundle can mix the operator's own stock with any seller's. The marketplace is the only party that
          can compose one, because it is the only one with a relationship with every seller in it — and the
          bundle is sold first party, so no commission is taken on it.
        </Callout>

        <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 220px' }}>
            <FormField label="Bundle name" required>
              <TextInput value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Home Office Complete" />
            </FormField>
          </div>
          <div style={{ flex: '0 1 180px' }}>
            <FormField label="Marketplace">
              <Select value={categoryId} onChange={e => setCategoryId(e.target.value)}>
                {snap.categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Select>
            </FormField>
          </div>
        </div>

        <div>
          <div style={{ fontSize: 'var(--text-sm)', fontWeight: 600, marginBottom: '6px' }}>
            What is in it
            {picked.length > 0 && <span style={{ fontWeight: 400, color: 'var(--text-tertiary)' }}> · {picked.length} chosen from {sellers.length} seller{sellers.length === 1 ? '' : 's'}</span>}
          </div>

          {picked.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '5px', marginBottom: '9px' }}>
              {picked.map(pk => {
                const p = snap.products.find(x => x.id === pk.productId)!
                return (
                  <div key={pk.productId} style={{ display: 'flex', gap: '8px', alignItems: 'center', padding: '7px 9px', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', flexWrap: 'wrap' }}>
                    <input type="number" min={1} value={pk.quantity}
                           onChange={e => setPicked(list => list.map(x => x.productId === pk.productId ? { ...x, quantity: Math.max(1, parseInt(e.target.value) || 1) } : x))}
                           style={{ width: '54px', padding: '3px 6px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', fontSize: 'var(--text-xs)' }} />
                    <div style={{ flex: 1, minWidth: '150px' }}>
                      <div style={{ fontSize: 'var(--text-xs)', fontWeight: 700 }}>{p.name}</div>
                      <div style={{ fontSize: '10px', color: 'var(--text-tertiary)' }}>
                        {p.seller}{p.partner_id === null ? ' · first party' : ''} · ${fmtMoney(p.price)} each
                        {p.floor_price !== undefined && (
                          <> · will go to <strong>${fmtMoney(Number(p.floor_price))}</strong>
                            {' '}({headroom({ price: Number(p.price), floor_price: Number(p.floor_price), list_price: Number(p.list_price ?? p.price) }).pct}% room)</>
                        )}
                      </div>
                    </div>
                    <span style={{ fontSize: 'var(--text-xs)', fontWeight: 700 }}>${fmtMoney(p.price * pk.quantity)}</span>
                    <button onClick={() => setPicked(list => list.filter(x => x.productId !== pk.productId))}
                            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--danger)' }}><X size={14} /></button>
                  </div>
                )
              })}
            </div>
          )}

          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search live listings to add"
                 style={{ width: '100%', padding: '7px 10px', borderRadius: 'var(--radius)', border: '1px solid var(--border)', fontSize: 'var(--text-xs)', outline: 'none', marginBottom: '6px' }} />
          <div style={{ maxHeight: '170px', overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)' }}>
            {shown.length === 0 ? (
              <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', padding: '10px' }}>Nothing else matches.</p>
            ) : shown.slice(0, 40).map(p => (
              <button key={p.id} onClick={() => setPicked(list => [...list, { productId: p.id, quantity: 1, note: '' }])}
                      style={{ display: 'flex', width: '100%', gap: '8px', alignItems: 'center', padding: '7px 10px', background: 'none', border: 'none', borderBottom: '1px solid var(--border-light)', cursor: 'pointer', textAlign: 'left' }}>
                <Plus size={12} style={{ color: 'var(--brand-navy)', flexShrink: 0 }} />
                <span style={{ flex: 1, fontSize: 'var(--text-xs)' }}>
                  {p.name}<span style={{ color: 'var(--text-tertiary)' }}> · {p.seller}</span>
                </span>
                <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>${fmtMoney(p.price)}</span>
              </button>
            ))}
          </div>
        </div>

        <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
          <div style={{ flex: '0 1 160px' }}>
            <FormField label="Bundle price" required>
              <TextInput type="number" step="0.01" value={price} onChange={e => setPrice(e.target.value)} placeholder="0.00" />
            </FormField>
          </div>
          <div style={{ flex: '0 1 160px' }}>
            <FormField label="Billing">
              <Select value={model} onChange={e => setModel(e.target.value)}>
                <option value="monthly">Monthly</option>
                <option value="oneoff">One-off</option>
                <option value="annual">Annual</option>
              </Select>
            </FormField>
          </div>
        </div>

        <FormField label="Description" hint="What the bundle is for. Left blank, it lists what is inside.">
          <TextArea value={description} onChange={e => setDescription(e.target.value)} rows={2} />
        </FormField>

        {/* What the sellers agreed to. Without this the operator is discounting
            somebody else's margin and finding out on their settlement. */}
        {picked.length >= 2 && (
          <div style={{ padding: '11px 13px', borderRadius: 'var(--radius-md)', background: 'var(--bg-alt)', border: '1px solid var(--border)' }}>
            <div style={{ display: 'flex', gap: '10px', fontSize: 'var(--text-xs)', padding: '2px 0' }}>
              <span style={{ flex: 1, color: 'var(--text-secondary)' }}>Parts at their asking prices</span>
              <span style={{ fontWeight: 600 }}>${fmtMoney(room.partsTotal)}</span>
            </div>
            <div style={{ display: 'flex', gap: '10px', fontSize: 'var(--text-xs)', padding: '2px 0' }}>
              <span style={{ flex: 1, color: 'var(--text-secondary)' }}>The least these sellers will accept</span>
              <span style={{ fontWeight: 800 }}>${fmtMoney(room.floorTotal)}</span>
            </div>
            <div style={{ display: 'flex', gap: '10px', fontSize: 'var(--text-xs)', padding: '2px 0' }}>
              <span style={{ flex: 1, color: 'var(--text-secondary)' }}>Deepest discount you may set</span>
              <span style={{ fontWeight: 800, color: 'var(--success)' }}>
                ${fmtMoney(room.maxDiscount)} ({room.maxDiscountPct}%)
              </span>
            </div>
            {room.tightest.length > 0 && (
              <div style={{ fontSize: '10px', color: 'var(--text-tertiary)', marginTop: '5px' }}>
                Least room: {room.tightest.map(t => `${t.name} ${t.roomPct}%`).join(' · ')}
              </div>
            )}
          </div>
        )}

        {/* The saving, computed while the price is still being typed. */}
        <div style={{
          padding: '11px 13px', borderRadius: 'var(--radius-md)',
          background: problem ? 'var(--danger-bg)' : 'var(--success-bg)',
          border: `1px solid ${problem ? 'var(--danger)' : 'var(--success)'}`,
        }}>
          {picked.length === 0 ? (
            <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>Add at least two listings.</span>
          ) : (
            <>
              <div style={{ display: 'flex', fontSize: 'var(--text-xs)', gap: '10px', flexWrap: 'wrap' }}>
                <span style={{ flex: 1, color: 'var(--text-secondary)' }}>Bought separately</span>
                <strong>${fmtMoney(partsTotal)}</strong>
              </div>
              <div style={{ display: 'flex', fontSize: 'var(--text-xs)', gap: '10px', marginTop: '3px', flexWrap: 'wrap' }}>
                <span style={{ flex: 1, color: 'var(--text-secondary)' }}>As a bundle</span>
                <strong>${fmtMoney(parseFloat(price) || 0)}</strong>
              </div>
              <div style={{ display: 'flex', fontSize: 'var(--text-xs)', gap: '10px', marginTop: '4px', paddingTop: '4px', borderTop: '1px solid var(--border)', flexWrap: 'wrap' }}>
                <span style={{ flex: 1, fontWeight: 700 }}>Saving</span>
                <strong style={{ color: saving > 0 ? 'var(--success)' : 'var(--danger)' }}>
                  ${fmtMoney(saving)}{partsTotal > 0 && ` (${Math.round((saving / partsTotal) * 100)}%)`}
                </strong>
              </div>
            </>
          )}
          {problem && <div style={{ fontSize: '11px', color: 'var(--danger)', marginTop: '6px' }}>{problem}</div>}
        </div>
      </div>
    </Modal>
  )
}

/* ------------------------------------------------------------- pieces ---- */

function Thumb({ url, size = 44 }: { url: string | null; size?: number }) {
  return (
    <span style={{
      width: size, height: size, flexShrink: 0, borderRadius: 'var(--radius-sm)', overflow: 'hidden',
      background: 'var(--bg-alt)', display: 'flex', alignItems: 'center', justifyContent: 'center',
      border: '1px solid var(--border)',
    }}>
      {url ? <img src={url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
           : <Package size={size / 2.4} style={{ color: 'var(--text-tertiary)' }} />}
    </span>
  )
}

function Pill({ ink, bg, children }: { ink: string; bg: string; children: React.ReactNode }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '2px 9px',
      borderRadius: 'var(--radius-full)', fontSize: '10px', fontWeight: 700, background: bg, color: ink,
    }}>
      {ink === 'var(--danger)' && <TriangleAlert size={11} />}
      {ink === 'var(--warning)' && <Clock size={11} />}
      {children}
    </span>
  )
}

function Stat({ label, value, sub, ink }: { label: string; value: string; sub?: string; ink?: string }) {
  return (
    <div style={{ padding: '13px 15px', borderRadius: 'var(--radius-md)', background: 'white', border: '1px solid var(--border)' }}>
      <div style={{ fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text-tertiary)' }}>{label}</div>
      <div style={{ fontSize: 'var(--text-xl)', fontWeight: 800, color: ink ?? 'var(--text)', marginTop: '3px' }}>{value}</div>
      {sub && <div style={{ fontSize: '10px', color: 'var(--text-tertiary)', marginTop: '2px' }}>{sub}</div>}
    </div>
  )
}

function SubHead({ children }: { children: React.ReactNode }) {
  return <h4 style={{ fontSize: 'var(--text-sm)', fontWeight: 700, margin: '0 0 8px', color: 'var(--text)' }}>{children}</h4>
}

function Facts({ rows }: { rows: [string, string][] }) {
  return (
    <dl style={{ margin: 0, display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '5px 14px' }}>
      {rows.map(([k, v]) => (
        <div key={k} style={{ display: 'contents' }}>
          <dt style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', whiteSpace: 'nowrap' }}>{k}</dt>
          <dd style={{ fontSize: 'var(--text-xs)', color: 'var(--text)', margin: 0 }}>{v}</dd>
        </div>
      ))}
    </dl>
  )
}

function daysAgo(iso: string, today: Date): string {
  const n = Math.max(0, Math.round((today.getTime() - Date.parse(iso)) / 86400000))
  return n === 0 ? 'today' : `${n} day${n === 1 ? '' : 's'}`
}

/* ------------------------------------------------------- the rate card ---- */

/* What the marketplace federates from. Grouped by family because that is how
   the BSS holds it and how the operator thinks about it, and it keeps a
   seventeen-row list from reading as one long undifferentiated column. */
function RateCard({ telco, rule, used }: {
  telco: TelcoItem[]
  rule: { per_component: number; max_discount: number; min_components: number; max_components: number }
  used: { telco_id: string }[]
}) {
  const [open, setOpen] = useState(false)

  if (telco.length === 0) {
    return (
      <SectionCard title="Operator rate card" subtitle="Federated from the BSS product catalogue">
        <div style={{ padding: '14px 20px' }}>
          <Callout tone="warning" title="The rate card did not load">
            It is readable by the operator only — it carries what each item costs to deliver. If you are signed
            in as the operator and still see this, the federation feed is down and packs cannot be composed
            until it returns.
          </Callout>
        </div>
      </SectionCard>
    )
  }

  const families = [...new Set(telco.map(t => t.family))]
  const inUse = new Set(used.map(u => u.telco_id))

  return (
    <SectionCard
      title="Operator rate card"
      subtitle={`${telco.length} tariff items across ${families.length} families · ${inUse.size} of them in a listing`}
      action={<Btn size="sm" variant="secondary" onClick={() => setOpen(o => !o)}>{open ? 'Hide' : 'Show'} the rate card</Btn>}>
      <div style={{ padding: '14px 20px' }}>
        <Callout tone="info">
          These are the operator's own products, pulled from the BSS rather than retyped. Nothing here is on the
          marketplace by itself — a listing is <em>composed</em> from them, and the component rates are captured at
          that moment so a later tariff change does not reprice a contract somebody already holds.
          {' '}Packs discount {rule.per_component}% per extra component, capped at {rule.max_discount}%, between{' '}
          {rule.min_components} and {rule.max_components} components.
        </Callout>

        {open && (
          <div style={{ marginTop: '12px', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
            {families.map(fam => (
              <div key={fam}>
                <div style={{ padding: '6px 12px', background: 'var(--bg-alt)', borderBottom: '1px solid var(--border-light)' }}>
                  <span style={{ fontSize: '10px', fontWeight: 800, letterSpacing: '0.03em', textTransform: 'uppercase', color: 'var(--text-secondary)' }}>{fam}</span>
                </div>
                {telco.filter(t => t.family === fam).map(t => (
                  <div key={t.id} style={{ display: 'flex', gap: '10px', alignItems: 'baseline', padding: '7px 12px', borderBottom: '1px solid var(--border-light)', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 'var(--text-xs)', fontWeight: 700, minWidth: '150px' }}>{t.name}</span>
                    <span style={{ fontSize: '10px', color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono, monospace)' }}>{t.id}</span>
                    <span style={{ fontSize: '10px', color: 'var(--text-tertiary)', flex: 1, minWidth: '180px' }}>{t.spec}</span>
                    {inUse.has(t.id) && (
                      <span style={{ fontSize: '9px', fontWeight: 700, color: 'var(--success)', padding: '1px 6px', borderRadius: 'var(--radius-full)', background: 'var(--success-bg)' }}>in a listing</span>
                    )}
                    <span style={{ fontSize: 'var(--text-xs)', fontWeight: 700, minWidth: '104px', textAlign: 'right' }}>
                      {t.rc > 0 && <>${fmtMoney(t.rc)}<span style={{ fontWeight: 400, color: 'var(--text-tertiary)' }}> {t.unit}</span></>}
                      {t.rc > 0 && t.nrc > 0 && <br />}
                      {t.nrc > 0 && <span style={{ color: t.rc > 0 ? 'var(--text-tertiary)' : undefined }}>${fmtMoney(t.nrc)} one-off</span>}
                    </span>
                    {/* The operator's own margin, on the operator's own screen.
                        It is why the composer can floor a discount at cost. */}
                    <span style={{ fontSize: '10px', color: 'var(--text-tertiary)', minWidth: '82px', textAlign: 'right' }}>
                      costs ${fmtMoney(t.rc > 0 ? t.cost_rc : t.cost_nrc)}
                    </span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
    </SectionCard>
  )
}

/* One composed pack, with what is inside it and what it saves against the rate
   card. Kept beside the bundle row rather than merged with it, because a pack is
   composed from tariff items and a bundle from listings — the same layout would
   imply they are the same record. */
function PackRow({ product, lines, catName, onOpen }: {
  product: ProductRow
  lines: { telco_id: string; quantity: number; name_at: string; rc_at: number; nrc_at: number; note: string | null; discount: number }[]
  catName: (id: string) => string
  onOpen: (id: string) => void
}) {
  const recurring = product.model !== 'oneoff'
  const lineTotal = (l: typeof lines[number]) => +((recurring ? l.rc_at : l.nrc_at) * l.quantity).toFixed(2)
  const cardTotal = +lines.reduce((n, l) => n + lineTotal(l), 0).toFixed(2)
  const saving = +(cardTotal - product.price).toFixed(2)
  const savingPct = cardTotal > 0 ? Math.round((saving / cardTotal) * 100) : 0

  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
      <div style={{ display: 'flex', gap: '10px', alignItems: 'center', padding: '10px 13px', background: 'var(--bg-alt)', flexWrap: 'wrap' }}>
        <Radio size={15} style={{ color: 'var(--text-tertiary)' }} />
        <button onClick={() => onOpen(product.id)}
                style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: 'var(--text-sm)', fontWeight: 700, color: 'var(--brand-navy)' }}>
          {product.name}
        </button>
        <span style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>
          {catName(product.category_id)} · {lines.length} rate-card components · first party
        </span>
        <span style={{ marginLeft: 'auto', fontSize: 'var(--text-sm)', fontWeight: 800 }}>
          ${fmtMoney(product.price)}{recurring ? <span style={{ fontSize: '10px', fontWeight: 400, color: 'var(--text-tertiary)' }}>/mo</span> : ''}
        </span>
        {saving > 0 && (
          <span style={{ fontSize: '11px', color: 'var(--success)', fontWeight: 700 }}>saves ${fmtMoney(saving)} ({savingPct}%)</span>
        )}
      </div>
      <div>
        {lines.map(l => (
          <div key={l.telco_id} style={{ display: 'flex', gap: '9px', padding: '8px 13px', borderTop: '1px solid var(--border-light)', fontSize: 'var(--text-xs)', flexWrap: 'wrap' }}>
            <span style={{ color: 'var(--text-tertiary)', minWidth: '38px' }}>{l.quantity}×</span>
            <span style={{ flex: 1, minWidth: '160px' }}>
              {l.name_at}
              <span style={{ color: 'var(--text-tertiary)' }}> · {l.telco_id}</span>
              {l.discount > 0 && <span style={{ color: 'var(--warning)' }}> · {l.discount}% off</span>}
              {l.note && <div style={{ fontSize: '10px', color: 'var(--text-tertiary)' }}>{l.note}</div>}
            </span>
            <span style={{ color: 'var(--text-secondary)' }}>${fmtMoney(lineTotal(l))}</span>
          </div>
        ))}
        <div style={{ display: 'flex', padding: '8px 13px', borderTop: '1px solid var(--border)', fontSize: 'var(--text-xs)', fontWeight: 700 }}>
          <span style={{ flex: 1 }}>At the rate card, bought separately</span>
          <span>${fmtMoney(cardTotal)}</span>
        </div>
      </div>
    </div>
  )
}

/* ----------------------------------------------------- the pack composer -- */

/* The prototype's composer, with the arithmetic in lib/federation.ts so it can
   be tested. Nothing here types a price: the operator picks components and the
   rule derives the number, with an override that has to clear the floor. */
function PackComposer({ snap, onClose, onCreate }: {
  snap: CatalogueSnapshot
  onClose: () => void
  onCreate: (draft: PackDraft) => void
}) {
  const [name, setName] = useState('')
  const [categoryId, setCategoryId] = useState(snap.categories[0]?.id ?? '')
  const [description, setDescription] = useState('')
  const [picks, setPicks] = useState<ComponentPick[]>([])
  const [override, setOverride] = useState<string>('')
  const [search, setSearch] = useState('')

  const rule = snap.bundleRule
  const overrideNum = override.trim() === '' ? null : parseFloat(override)
  const composition = compose(picks, snap.telco, rule, Number.isFinite(overrideNum as number) ? overrideNum : null)
  const problem = compositionProblem(name, picks, snap.telco, rule, composition)
  const warnings = compositionWarnings(composition)

  const q = search.trim().toLowerCase()
  const available = snap.telco.filter(t =>
    !picks.some(p => p.telcoId === t.id) &&
    (!q || `${t.name} ${t.family} ${t.spec} ${t.id}`.toLowerCase().includes(q)))
  const families = [...new Set(available.map(t => t.family))]

  const setQty = (id: string, d: number) =>
    setPicks(list => list.map(p => p.telcoId === id ? { ...p, quantity: Math.max(1, Math.min(500, p.quantity + d)) } : p))
  const setDisc = (id: string, v: string) =>
    setPicks(list => list.map(p => p.telcoId === id ? { ...p, discount: Math.max(0, parseFloat(v) || 0) } : p))

  return (
    <Modal open onClose={onClose} title="Compose an operator pack"
      footer={<>
        <span style={{ flex: 1, fontSize: '11px', color: 'var(--text-tertiary)' }}>
          {picks.length === 0 ? 'Nothing selected.' : `${picks.length} component${picks.length === 1 ? '' : 's'} · $${fmtMoney(composition.price)}${composition.model === 'oneoff' ? ' one-off' : ' a month'}`}
        </span>
        <Btn variant="secondary" size="sm" onClick={onClose}>Cancel</Btn>
        <Btn size="sm" disabled={!!problem} onClick={() => onCreate({
          name, categoryId, description, picks,
          override: Number.isFinite(overrideNum as number) ? overrideNum : null,
        })}>Publish the pack</Btn>
      </>}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
        <Callout tone="info">
          Built from the operator's own rate card, so it is sold first party — no partner, no commission and
          nothing to settle. It goes live immediately: first-party listings do not queue for review, because
          you are the reviewer.
        </Callout>

        <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 220px' }}>
            <FormField label="Pack name" required>
              <TextInput value={name} onChange={e => setName(e.target.value)} placeholder="What a buyer sees on the storefront" />
            </FormField>
          </div>
          <div style={{ flex: '0 1 180px' }}>
            <FormField label="Marketplace">
              <Select value={categoryId} onChange={e => setCategoryId(e.target.value)}>
                {snap.categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Select>
            </FormField>
          </div>
        </div>

        {/* What is in it */}
        {picks.length > 0 && (
          <div>
            <div style={{ fontSize: 'var(--text-sm)', fontWeight: 600, marginBottom: '6px' }}>
              Components
              <span style={{ fontWeight: 400, color: 'var(--text-tertiary)' }}>
                {' '}· {composition.model === 'oneoff' ? 'charged once' : 'billed monthly'}, fulfilled by {composition.fulfil}
              </span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
              {composition.lines.map(l => (
                <div key={l.item.id} style={{ display: 'flex', gap: '8px', alignItems: 'center', padding: '7px 9px', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', flexWrap: 'wrap' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
                    <button onClick={() => setQty(l.item.id, -1)} aria-label={`One fewer ${l.item.name}`}
                            style={{ border: '1px solid var(--border)', background: 'white', borderRadius: 'var(--radius-sm)', cursor: 'pointer', padding: '2px 4px', lineHeight: 0 }}><Minus size={11} /></button>
                    <span style={{ fontSize: 'var(--text-xs)', fontWeight: 700, minWidth: '30px', textAlign: 'center' }}>{l.quantity}</span>
                    <button onClick={() => setQty(l.item.id, 1)} aria-label={`One more ${l.item.name}`}
                            style={{ border: '1px solid var(--border)', background: 'white', borderRadius: 'var(--radius-sm)', cursor: 'pointer', padding: '2px 4px', lineHeight: 0 }}><Plus size={11} /></button>
                  </div>
                  <div style={{ flex: 1, minWidth: '150px' }}>
                    <div style={{ fontSize: 'var(--text-xs)', fontWeight: 700 }}>{l.item.name}</div>
                    <div style={{ fontSize: '10px', color: 'var(--text-tertiary)' }}>
                      {l.item.id} · {l.item.family} · costs ${fmtMoney(l.item.rc > 0 ? l.item.cost_rc : l.item.cost_nrc)}
                    </div>
                  </div>
                  {/* Bounded by the component's own cost, so the control cannot
                      express a discount the rule would refuse. */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <input type="number" min={0} max={l.maxDiscount} value={l.discount}
                           onChange={e => setDisc(l.item.id, e.target.value)}
                           aria-label={`Discount on ${l.item.name}, maximum ${l.maxDiscount} percent`}
                           style={{ width: '56px', padding: '3px 6px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', fontSize: 'var(--text-xs)' }} />
                    <span style={{ fontSize: '10px', color: 'var(--text-tertiary)' }}>% <br />max {l.maxDiscount}</span>
                  </div>
                  <span style={{ fontSize: 'var(--text-xs)', fontWeight: 700, minWidth: '64px', textAlign: 'right' }}>
                    ${fmtMoney(composition.model === 'oneoff' ? l.nrcNet : l.rcNet)}
                  </span>
                  <button onClick={() => setPicks(list => list.filter(x => x.telcoId !== l.item.id))}
                          aria-label={`Remove ${l.item.name}`}
                          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--danger)' }}><X size={14} /></button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Pull from the rate card */}
        <div>
          <div style={{ fontSize: 'var(--text-sm)', fontWeight: 600, marginBottom: '6px' }}>
            Pull from the operator catalogue
            <span style={{ fontWeight: 400, color: 'var(--text-tertiary)' }}> · {snap.telco.length} items</span>
          </div>
          <input value={search} onChange={e => setSearch(e.target.value)}
                 placeholder="Search a plan, add-on or piece of equipment"
                 style={{ width: '100%', padding: '7px 10px', borderRadius: 'var(--radius)', border: '1px solid var(--border)', fontSize: 'var(--text-xs)', outline: 'none', marginBottom: '6px' }} />
          <div style={{ maxHeight: '200px', overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)' }}>
            {available.length === 0 ? (
              <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', padding: '10px' }}>
                Nothing in the operator catalogue matches that.
              </p>
            ) : families.map(fam => (
              <div key={fam}>
                <div style={{ padding: '5px 11px', background: 'var(--bg-alt)', borderBottom: '1px solid var(--border-light)' }}>
                  <span style={{ fontSize: '10px', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.03em', color: 'var(--text-secondary)' }}>{fam}</span>
                </div>
                {available.filter(t => t.family === fam).map(t => (
                  <button key={t.id}
                          onClick={() => setPicks(list => [...list, { telcoId: t.id, quantity: 1, discount: 0 }])}
                          style={{ display: 'flex', width: '100%', gap: '8px', alignItems: 'center', padding: '7px 10px', background: 'none', border: 'none', borderBottom: '1px solid var(--border-light)', cursor: 'pointer', textAlign: 'left' }}>
                    <Plus size={12} style={{ color: 'var(--brand-navy)', flexShrink: 0 }} />
                    <span style={{ flex: 1, fontSize: 'var(--text-xs)' }}>
                      {t.name}
                      <span style={{ display: 'block', fontSize: '10px', color: 'var(--text-tertiary)' }}>{t.spec}</span>
                    </span>
                    <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', textAlign: 'right' }}>
                      {t.rc > 0 ? `$${fmtMoney(t.rc)}` : `$${fmtMoney(t.nrc)}`}
                      <span style={{ display: 'block', fontSize: '9px', color: 'var(--text-tertiary)' }}>{t.unit}</span>
                    </span>
                  </button>
                ))}
              </div>
            ))}
          </div>
        </div>

        {/* The derivation, shown while the price is still being set. */}
        {picks.length > 0 && (
          <div style={{ padding: '11px 13px', borderRadius: 'var(--radius-md)', background: 'var(--bg-alt)', border: '1px solid var(--border)' }}>
            <Row label="Components at the rate card" value={`$${fmtMoney(composition.listTotal)}`} />
            {composition.lineDiscountTotal > 0 && (
              <Row label="Per-component discounts" value={`less $${fmtMoney(composition.lineDiscountTotal)}`} />
            )}
            {composition.packPct > 0 && (
              <Row label={`Pack discount — ${rule.per_component}% per extra component, capped at ${rule.max_discount}%`}
                   value={`less $${fmtMoney(composition.packDiscount)} (${composition.packPct}%)`} />
            )}
            <Row label="Derived price" value={`$${fmtMoney(composition.derived)}`} strong />
            <Row label="What the components cost to deliver" value={`less $${fmtMoney(composition.cost)}`} />
            <Row label="Margin" value={`$${fmtMoney(composition.margin)} (${composition.marginPct}%)`} strong
                 ink={composition.margin <= 0 ? 'var(--danger)' : 'var(--success)'} />
          </div>
        )}

        <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
          <div style={{ flex: '0 1 200px' }}>
            <FormField label={`Price${composition.model === 'oneoff' ? '' : ' per month'}`}
                       hint="Leave it blank to publish at the derived price.">
              <TextInput type="number" step="0.01" value={override}
                         onChange={e => setOverride(e.target.value)}
                         placeholder={picks.length > 0 ? fmtMoney(composition.derived) : '0.00'} />
            </FormField>
          </div>
        </div>

        <FormField label="Description" hint="What the pack is for. Left blank, it lists what is inside.">
          <TextArea value={description} onChange={e => setDescription(e.target.value)} rows={2} />
        </FormField>

        {warnings.map((w, i) => <Callout key={i} tone="warning">{w}</Callout>)}
        {problem
          ? <Callout tone="danger" title="Not ready to publish">{problem}</Callout>
          : <Callout tone="success" title={`${name.trim()} will go live at $${fmtMoney(composition.price)}`}>
              {priceBasis(composition, rule)} It is sold by Aventa Telecom, so no commission is taken and nothing settles to a seller.
            </Callout>}
      </div>
    </Modal>
  )
}

function Row({ label, value, strong, ink }: { label: string; value: string; strong?: boolean; ink?: string }) {
  return (
    <div style={{ display: 'flex', gap: '10px', padding: '3px 0', fontSize: 'var(--text-xs)' }}>
      <span style={{ flex: 1, color: 'var(--text-secondary)' }}>{label}</span>
      <span style={{ fontWeight: strong ? 800 : 600, color: ink ?? 'var(--text)' }}>{value}</span>
    </div>
  )
}

/* ------------------------------------------------------ who it is sold to -- */

const SOLD_TO: { id: string; label: string; note: string }[] = [
  { id: 'consumer', label: 'Retail customers', note: 'One of it, bought by a person.' },
  { id: 'enterprise', label: 'Business accounts', note: 'Bought against a purchase order.' },
  { id: 'partner', label: 'Resellers', note: 'Wholesale, listed for other sellers.' },
]

/**
 * The audience toggles.
 *
 * Optimistic on the way out and corrected on the way back: the operator is
 * ticking a box, and a checkbox that waits for a round trip before moving
 * reads as broken. The reload is what settles it, and a refusal restores the
 * previous state rather than leaving the screen a shade ahead of the database.
 */
function AudiencePicker({ product, onChanged }: { product: ProductRow; onChanged: () => Promise<void> }) {
  const [picked, setPicked] = useState<string[]>(product.audiences ?? ['consumer', 'enterprise'])
  const [saving, setSaving] = useState(false)

  useEffect(() => { setPicked(product.audiences ?? ['consumer', 'enterprise']) }, [product.id, product.audiences])

  const toggle = async (id: string) => {
    const next = picked.includes(id) ? picked.filter(x => x !== id) : [...picked, id]
    const previous = picked
    setPicked(next)
    setSaving(true)
    const res = await setAudiences({ productId: product.id, audiences: next, actor: 'Marketplace operations' })
    setSaving(false)
    if (!res.ok) { setPicked(previous); toast(res.reason, 'error'); return }
    toast(res.note ?? 'Saved')
    await onChanged()
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
      {SOLD_TO.map(a => (
        <label key={a.id} style={{
          display: 'flex', gap: '9px', alignItems: 'flex-start',
          padding: '7px 9px', borderRadius: 'var(--radius)',
          background: picked.includes(a.id) ? 'var(--info-bg)' : 'transparent',
          cursor: saving ? 'wait' : 'pointer',
        }}>
          <input type="checkbox" checked={picked.includes(a.id)} disabled={saving}
            onChange={() => void toggle(a.id)} style={{ marginTop: 2 }} />
          <span>
            <span style={{ fontSize: 'var(--text-xs)', fontWeight: 700, color: 'var(--text)' }}>{a.label}</span>
            <span style={{ display: 'block', fontSize: '11px', color: 'var(--text-tertiary)' }}>{a.note}</span>
          </span>
        </label>
      ))}
      <p style={{ fontSize: '11px', color: 'var(--text-tertiary)', margin: '5px 0 0' }}>
        A shelf appears for whoever can buy something on it. Taking the last listing off a
        shelf takes the shelf with it.
      </p>
    </div>
  )
}
