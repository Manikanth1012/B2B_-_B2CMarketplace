/* The seller record, in one place.
 *
 * Everything the marketplace knows about a partner was spread across four
 * screens and two of them did not exist: what they are approved to sell, what
 * they have actually listed and in what state, what they settle on, and how
 * their status has moved. Answering "why is this seller suspended and what
 * came down with them" meant three screens and a guess.
 */

import { useState, useEffect, useCallback } from 'react'
import {
  SectionCard, EmptyState, Btn, Modal, FormField, TextArea, Select, toast, fmtDate, fmtMoney,
} from './shared'
import { Callout } from '../OnboardingJourney'
import { loadPartnerDirectory, loadPartnerDetail, movePartner } from '../../lib/partnerRepo'
import type { PartnerDirectoryRow, PartnerDetail } from '../../lib/partnerRepo'
import {
  transitionsFrom, statusMeaning, orderedHistory, canMove,
} from '../../lib/partnerLifecycle'
import type { PartnerStatus } from '../../lib/partnerLifecycle'
import { rateAt, nextTier, listingState, listingBreakdown, approvedCategories } from '../../lib/partnerCommerce'
import type { CommissionPlan } from '../../lib/partnerCommerce'
import type { Category } from '../../types'

const STATUS_INK: Record<string, string> = {
  live: 'var(--success)', onboarding: 'var(--info)', review: 'var(--warning)',
  suspended: 'var(--danger)', rejected: 'var(--danger)',
}

export function OperatorPartners() {
  const [rows, setRows] = useState<PartnerDirectoryRow[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [dirError, setDirError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<string | null>(null)
  const [detail, setDetail] = useState<PartnerDetail | null>(null)
  const [filter, setFilter] = useState<string>('all')
  const [moveTo, setMoveTo] = useState<PartnerStatus | null>(null)

  const refresh = useCallback(async () => {
    const d = await loadPartnerDirectory()
    setRows(d.rows); setCategories(d.categories)
    setDirError(d.loadError ?? null)
    return d.rows
  }, [])

  useEffect(() => {
    refresh().then(r => { if (r[0]) setSelected(r[0].id); setLoading(false) })
  }, [refresh])

  const reloadDetail = useCallback(async (id: string) => setDetail(await loadPartnerDetail(id)), [])
  useEffect(() => { if (selected) void reloadDetail(selected) }, [selected, reloadDetail])

  if (loading) return <div style={{ textAlign: 'center', padding: '40px' }}><div className="spinner" style={{ margin: '0 auto' }} /></div>

  const shown = filter === 'all' ? rows : rows.filter(r => r.status === filter)
  const partner = detail?.partner ?? null
  const catName = (id: string) => categories.find(c => c.id === id)?.name ?? id

  const handleMove = async (to: PartnerStatus, reason: string) => {
    if (!partner) return
    const res = await movePartner({ partnerId: partner.id, to, reason, actor: 'Marketplace onboarding desk' })
    if (!res.ok) { toast(res.reason, 'error'); return }
    toast(
      res.listingsSuspended > 0
        ? `${partner.name} is now ${to}. ${res.listingsSuspended} live listing${res.listingsSuspended === 1 ? '' : 's'} taken down.`
        : `${partner.name} is now ${to}.`,
    )
    if (res.recordWarning) toast(res.recordWarning, 'error')
    setMoveTo(null)
    await Promise.all([refresh(), reloadDetail(partner.id)])
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div>
        <h1 style={{ fontSize: 'var(--text-2xl)', fontWeight: 800, color: 'var(--text)' }}>Sellers</h1>
        <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)', marginTop: '4px' }}>
          {rows.length} on record · {rows.filter(r => r.status === 'live').length} trading ·{' '}
          {rows.reduce((n, r) => n + r.liveListings, 0)} live listings between them
        </p>
      </div>

      {dirError && <Callout tone="danger" title="Some of this screen did not load">{dirError}</Callout>}

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(220px, 320px) 1fr', gap: '20px', alignItems: 'start' }}
           className="onb-split">
        <SectionCard
          title="Directory"
          subtitle={`${shown.length} shown`}
          action={
            <Select value={filter} onChange={e => setFilter(e.target.value)} style={{ fontSize: 'var(--text-xs)', padding: '4px 8px' }}>
              <option value="all">Every status</option>
              <option value="live">Live</option>
              <option value="onboarding">Onboarding</option>
              <option value="review">In review</option>
              <option value="suspended">Suspended</option>
              <option value="rejected">Rejected</option>
            </Select>
          }
        >
          {shown.length === 0 ? <EmptyState message="No sellers in this state" /> : (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, maxHeight: '680px', overflowY: 'auto' }}>
              {shown.map(r => (
                <li key={r.id}>
                  <button onClick={() => setSelected(r.id)} style={{
                    width: '100%', textAlign: 'left', padding: '11px 16px', cursor: 'pointer',
                    background: r.id === selected ? 'var(--info-bg)' : 'white',
                    borderLeft: `3px solid ${r.id === selected ? 'var(--brand-navy)' : 'transparent'}`,
                    borderTop: 'none', borderRight: 'none', borderBottom: '1px solid var(--border-light)',
                  }}>
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'baseline' }}>
                      <span style={{ fontSize: 'var(--text-sm)', fontWeight: 700, color: 'var(--text)', flex: 1 }}>{r.name}</span>
                      <span style={{ fontSize: '11px', fontWeight: 700, color: STATUS_INK[r.status] ?? 'var(--text-tertiary)' }}>{r.status}</span>
                    </div>
                    <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', marginTop: '2px' }}>
                      {r.categories.map(catName).join(', ') || 'no category'} · {r.liveListings}/{r.listings} listings live
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', minWidth: 0 }}>
          {!partner ? <SectionCard title="Seller"><EmptyState message="Choose a seller" /></SectionCard> : (
            <>
              {detail?.loadError && <Callout tone="danger" title="Part of this record did not load">{detail.loadError}</Callout>}

              {/* Who they are, and what their status means for trading today —
                  because the word on its own says nothing about that. */}
              <SectionCard title={partner.name} subtitle={`${partner.id} · ${partner.type} · ${partner.country}`}>
                <div style={{ padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
                  <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
                    <span style={{
                      padding: '3px 12px', borderRadius: 'var(--radius-full)', fontSize: 'var(--text-xs)',
                      fontWeight: 800, background: 'var(--bg-alt)', color: STATUS_INK[partner.status] ?? 'var(--text)',
                      border: `1px solid ${STATUS_INK[partner.status] ?? 'var(--border)'}`,
                    }}>{partner.status}</span>
                    <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', flex: 1, minWidth: '220px' }}>
                      {statusMeaning(partner.status)}
                    </span>
                  </div>

                  <Facts rows={[
                    ['Contact', `${partner.contact || '—'}${partner.email ? ` · ${partner.email}` : ''}`],
                    ['Tier', partner.tier || '—'],
                    ['Joined', partner.joined === '—' ? 'Not live yet' : partner.joined],
                    ['Rating', partner.rating > 0 ? `${partner.rating} / 5` : 'No rating yet'],
                  ]} />

                  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', borderTop: '1px solid var(--border-light)', paddingTop: '14px' }}>
                    {transitionsFrom(partner.status).map(t => (
                      <Btn key={t.to} size="sm" variant={t.to === 'suspended' || t.to === 'rejected' ? 'danger' : 'secondary'}
                           onClick={() => setMoveTo(t.to)}>{t.label}</Btn>
                    ))}
                  </div>
                </div>
              </SectionCard>

              <CategoriesCard detail={detail!} categories={categories} catName={catName} />
              <PlanCard
                plan={detail?.plan ?? null}
                catName={catName}
                listings={detail?.listings ?? []}
                /* How many sellers this plan is shared with. The warning about
                   editing it is only worth printing if there is somebody else
                   on it. */
                othersOnPlan={detail?.plan ? rows.filter(r => r.plan_id === detail.plan!.id && r.id !== partner.id).length : 0}
              />
              <ListingsCard detail={detail!} catName={catName} />
              <HistoryCard detail={detail!} />
            </>
          )}
        </div>
      </div>

      {partner && moveTo && (
        <MoveDialog
          partnerName={partner.name}
          from={partner.status}
          to={moveTo}
          liveListings={rows.find(r => r.id === partner.id)?.liveListings ?? 0}
          clearedGates={rows.find(r => r.id === partner.id)?.clearedGates ?? 0}
          totalGates={rows.find(r => r.id === partner.id)?.totalGates ?? 0}
          onClose={() => setMoveTo(null)}
          onConfirm={reason => handleMove(moveTo, reason)}
        />
      )}
    </div>
  )
}

/* ------------------------------------------------------------- sections --- */

function CategoriesCard({ detail, categories, catName }: {
  detail: PartnerDetail; categories: Category[]; catName: (id: string) => string
}) {
  const approved = approvedCategories(detail.approvals, categories)
  const appliedNotApproved = detail.approvals.filter(a => !a.approved_at)

  return (
    <SectionCard title="What they may sell"
                 subtitle="Approval is granted at the application gate and is what every listing is checked against">
      <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {detail.approvals.length === 0 ? (
          <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', margin: 0 }}>
            No categories on record. This seller cannot list anything.
          </p>
        ) : (
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            {[...detail.approvals]
              .sort((a, b) => (categories.find(c => c.id === a.category_id)?.sort_order ?? 99) -
                              (categories.find(c => c.id === b.category_id)?.sort_order ?? 99))
              .map(a => (
                <div key={a.category_id} style={{
                  padding: '7px 12px', borderRadius: 'var(--radius-md)',
                  border: `1px solid ${a.approved_at ? 'var(--success)' : 'var(--border)'}`,
                  background: a.approved_at ? 'var(--success-bg)' : 'var(--bg-alt)',
                }}>
                  <div style={{ fontSize: 'var(--text-xs)', fontWeight: 700, color: 'var(--text)' }}>{catName(a.category_id)}</div>
                  <div style={{ fontSize: '10px', color: 'var(--text-tertiary)' }}>
                    {a.approved_at ? `Approved ${fmtDate(a.approved_at)}${a.approved_by ? ` · ${a.approved_by}` : ''}` : 'Applied for — not approved'}
                  </div>
                </div>
              ))}
          </div>
        )}

        <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', margin: 0 }}>
          {approved.length === 0
            ? 'Nothing is approved yet, so nothing can be listed.'
            : `Approved in ${approved.length} of the ${categories.length} marketplaces.`}
          {appliedNotApproved.length > 0 &&
            ` ${appliedNotApproved.length} more ${appliedNotApproved.length === 1 ? 'is' : 'are'} on the application and open when it clears.`}
          {' '}Adding a category is a change to the seller's agreement, not a setting — it goes back through
          the compliance gate for the rules of that category.
        </p>
      </div>
    </SectionCard>
  )
}

function PlanCard({ plan, catName, listings, othersOnPlan }: {
  plan: CommissionPlan | null
  catName: (id: string) => string
  listings: { price: number; status: string }[]
  othersOnPlan: number
}) {
  if (!plan) {
    return (
      <SectionCard title="Commission model">
        <div style={{ padding: '16px 20px' }}>
          <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', margin: 0 }}>
            No plan is assigned. Nothing was agreed, which is what you would expect on an application that
            never reached the agreements gate — a seller cannot settle without one.
          </p>
        </div>
      </SectionCard>
    )
  }

  /* Volume is not tracked per seller yet, so the ladder is shown at its opening
     step rather than pretending to know where a seller sits on it. Saying
     "you are on 9%" from a number nobody measured is worse than saying nothing. */
  const opening = rateAt(plan, 0)
  const next = nextTier(plan, 0)
  const live = listings.filter(l => l.status === 'live').length

  return (
    <SectionCard title="Commission model" subtitle={`${plan.name} · ${plan.model}`}>
      <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
        <Facts rows={[
          ['Applies to', plan.category_id ? catName(plan.category_id) : 'Every category'],
          ['Opening rate', `${opening}%`],
          ['Settlement', plan.cycle],
          ['Hold', plan.hold],
          ['Fees on top', plan.fees],
        ]} />

        <div>
          <h4 style={{ fontSize: 'var(--text-xs)', fontWeight: 700, marginBottom: '7px' }}>The ladder</h4>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            {plan.tiers.map((t, i) => (
              <div key={t.from} style={{
                display: 'flex', alignItems: 'center', gap: '10px', padding: '7px 11px',
                borderRadius: 'var(--radius-sm)', background: i === 0 ? 'var(--info-bg)' : 'var(--bg-alt)',
                fontSize: 'var(--text-xs)',
              }}>
                <span style={{ flex: 1, color: 'var(--text-secondary)' }}>
                  {t.from === 0 ? 'From the first sale' : `From $${fmtMoney(t.from)} cumulative`}
                </span>
                <span style={{ fontWeight: 800, color: 'var(--text)' }}>{t.rate}%</span>
              </div>
            ))}
          </div>
          {next && (
            <p style={{ fontSize: '11px', color: 'var(--text-tertiary)', marginTop: '7px' }}>
              {/* Which direction the ladder runs is a property of the plan, not
                  an assumption — a reseller's discount rises where a commission
                  rate falls. */}
              The rate {next.tier.rate < opening ? 'falls' : 'rises'} to {next.tier.rate}% at
              {' '}${fmtMoney(next.tier.from)} of cumulative gross value.
            </p>
          )}
        </div>

        <p style={{ fontSize: '11px', color: 'var(--text-tertiary)', margin: 0 }}>
          {live} of this seller's listing{live === 1 ? '' : 's'} settle on this plan.
          {othersOnPlan > 0 &&
            ` ${othersOnPlan} other seller${othersOnPlan === 1 ? ' is' : 's are'} on the same schedule — editing it edits theirs too.`}
        </p>
      </div>
    </SectionCard>
  )
}

function ListingsCard({ detail, catName }: { detail: PartnerDetail; catName: (id: string) => string }) {
  const breakdown = listingBreakdown(detail.listings)

  return (
    <SectionCard
      title="Their listings"
      subtitle={breakdown.length
        ? breakdown.map(b => `${b.count} ${b.label.toLowerCase()}`).join(' · ')
        : 'Nothing listed'}
    >
      {detail.listings.length === 0 ? (
        <div style={{ padding: '16px 20px' }}>
          <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', margin: 0 }}>
            This seller has no listings. For a seller still applying that is expected — the storefront opens
            at the last gate.
          </p>
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '520px' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                {['Listing', 'Category', 'Price', 'Stock', 'State'].map(h => (
                  <th key={h} style={{
                    textAlign: h === 'Price' ? 'right' : 'left', padding: '9px 20px',
                    fontSize: '11px', fontWeight: 700, textTransform: 'uppercase',
                    letterSpacing: '0.04em', color: 'var(--text-tertiary)',
                  }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {detail.listings.map(l => {
                const state = listingState(l.status)
                return (
                  <tr key={l.id} style={{ borderBottom: '1px solid var(--border-light)' }}>
                    <td style={{ padding: '10px 20px' }}>
                      <div style={{ fontSize: 'var(--text-xs)', fontWeight: 700, color: 'var(--text)' }}>{l.name}</div>
                      <div style={{ fontSize: '10px', color: 'var(--text-tertiary)' }}>{l.id}</div>
                    </td>
                    <td style={{ padding: '10px 20px', fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>{catName(l.category_id)}</td>
                    <td style={{ padding: '10px 20px', fontSize: 'var(--text-xs)', textAlign: 'right', color: 'var(--text)' }}>${fmtMoney(l.price)}</td>
                    <td style={{ padding: '10px 20px', fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>{l.stock}</td>
                    <td style={{ padding: '10px 20px' }} title={state.meaning}>
                      <span style={{
                        fontSize: '11px', fontWeight: 700,
                        color: l.status === 'live' ? 'var(--success)'
                          : l.status === 'pending' ? 'var(--warning)' : 'var(--danger)',
                      }}>{state.label}</span>
                      <div style={{ fontSize: '10px', color: 'var(--text-tertiary)', maxWidth: '210px' }}>{state.meaning}</div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </SectionCard>
  )
}

function HistoryCard({ detail }: { detail: PartnerDetail }) {
  const events = orderedHistory(detail.history)

  return (
    <SectionCard title="Lifecycle history" subtitle="Every status change, with the ground it was decided on">
      {events.length === 0 ? (
        <div style={{ padding: '16px 20px' }}>
          <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', margin: 0 }}>
            No history recorded. That is not the same as nothing having happened — it means this seller
            predates the record.
          </p>
        </div>
      ) : (
        <ol style={{ listStyle: 'none', margin: 0, padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {events.map(e => (
            <li key={e.id} style={{ display: 'flex', gap: '11px' }}>
              <span style={{
                width: 9, height: 9, borderRadius: '50%', marginTop: '5px', flexShrink: 0,
                background: STATUS_INK[e.to_status] ?? 'var(--text-tertiary)',
              }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 'var(--text-xs)', fontWeight: 700, color: 'var(--text)' }}>
                  {e.from_status ? `${e.from_status} → ${e.to_status}` : `Opened as ${e.to_status}`}
                </div>
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', marginTop: '2px' }}>{e.reason}</div>
                <div style={{ fontSize: '10px', color: 'var(--text-tertiary)', marginTop: '2px' }}>
                  {e.actor} · {fmtDate(e.at)}
                </div>
              </div>
            </li>
          ))}
        </ol>
      )}
    </SectionCard>
  )
}

/* --------------------------------------------------------- move dialog ---- */

function MoveDialog({ partnerName, from, to, liveListings, clearedGates, totalGates, onClose, onConfirm }: {
  partnerName: string
  from: PartnerStatus
  to: PartnerStatus
  liveListings: number
  clearedGates: number
  totalGates: number
  onClose: () => void
  onConfirm: (reason: string) => void
}) {
  const [reason, setReason] = useState('')

  /* Checked here as well as in the repo, so the operator is told before they
     type a reason rather than after. The repo re-checks against fresh state
     regardless — this is the courtesy, that is the rule. */
  const verdict = canMove(from, to, { gateStatuses: Array(totalGates).fill('cleared').map((v, i) => i < clearedGates ? v : 'pending'), reason: reason || 'x' })

  return (
    <Modal open onClose={onClose} title={verdict.ok ? verdict.transition.label : `Move to ${to}`}
      footer={<>
        <Btn variant="secondary" size="sm" onClick={onClose}>Cancel</Btn>
        <Btn size="sm" variant={to === 'suspended' || to === 'rejected' ? 'danger' : 'primary'}
             disabled={!verdict.ok || !reason.trim()} onClick={() => onConfirm(reason)}>
          {verdict.ok ? verdict.transition.label : 'Not available'}
        </Btn>
      </>}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
        <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', margin: 0 }}>
          <strong>{partnerName}</strong> moves from <strong>{from}</strong> to <strong>{to}</strong>.
        </p>

        {!verdict.ok && <Callout tone="danger" title="This move is not available">{verdict.reason}</Callout>}
        {verdict.ok && <Callout tone={to === 'suspended' || to === 'rejected' ? 'warning' : 'info'} title="What this does">{verdict.transition.effect}</Callout>}

        {verdict.ok && verdict.transition.suspendsListings && liveListings > 0 && (
          <Callout tone="warning">
            {liveListings} live listing{liveListings === 1 ? '' : 's'} come{liveListings === 1 ? 's' : ''} down
            the moment you confirm. Reinstating the seller later does not put {liveListings === 1 ? 'it' : 'them'} back.
          </Callout>
        )}

        <FormField label="Reason" required
          hint="The seller can read this. Name the ground, not the outcome — “14 SLA breaches against a ceiling of 3” is actionable, “performance” is not.">
          <TextArea value={reason} onChange={e => setReason(e.target.value)} rows={4}
                    placeholder="What happened, and what would change it back" />
        </FormField>
      </div>
    </Modal>
  )
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
