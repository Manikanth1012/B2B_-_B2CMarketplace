/* The seller book: finding one among many, and everything the marketplace holds
 * about the one you found.
 *
 * The directory was a wrapped row of one chip per seller. That is readable at
 * fifteen and unusable at a hundred, and it answered none of the questions
 * people bring to a partner list — how many are live, who is stuck, who sells
 * what, where the book is concentrated. The record behind it was missing the
 * two things anybody opens a partner to see: what they have handed over, and
 * what they have been paid.
 */

import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  Search, ChevronLeft, ChevronRight, ChevronUp, ChevronDown, FileText,
  CircleCheck as CheckCircle, CircleAlert as AlertCircle, Circle, Clock, TriangleAlert, Plus,
} from 'lucide-react'
import {
  SectionCard, EmptyState, Btn, Modal, FormField, TextArea, toast, fmtDate, fmtMoney, fmtInt,
} from './shared'
import { Callout, DocumentViewer } from '../OnboardingJourney'
import { PartnerSettlementTab } from './PartnerSettlementTab'
import { ColumnChart, DonutChart } from './charts'
import {
  loadPartnerDirectory, loadPartnerDetail, movePartner,
  addPartnerCategory, approvePartnerCategory, withdrawPartnerCategory,
} from '../../lib/partnerRepo'
import type { PartnerDirectoryRow, PartnerDetail, Statement } from '../../lib/partnerRepo'
import { transitionsFrom, statusMeaning, orderedHistory, canMove } from '../../lib/partnerLifecycle'
import type { PartnerStatus } from '../../lib/partnerLifecycle'
import { rateAt, nextTier, listingState, listingBreakdown } from '../../lib/partnerCommerce'
import type { CommissionPlan } from '../../lib/partnerCommerce'
import {
  applyFilters, sortRows, paginate, byStatus, byTier, byCategory, categoryReadiness,
  EMPTY_FILTERS, EVIDENCE_MEANING,
} from '../../lib/partnerDirectory'
import type { Filters, SortKey, Tier, CategoryEvidence, PolicyRule } from '../../lib/partnerDirectory'
import type { Category } from '../../types'
import {
  addableCategories, canAddCategory, canApproveCategory, canWithdrawCategory, blockingRules,
} from '../../lib/partnerCategories'

const STATUS_INK: Record<string, string> = {
  live: 'var(--success)', onboarding: 'var(--info)', review: 'var(--warning)',
  suspended: 'var(--danger)', rejected: 'var(--danger)',
}

const PAGE_SIZE = 12

/* The desk that owns seller eligibility. Same actor the lifecycle moves record,
   because widening what somebody may sell is the same kind of decision. */
const ACTOR = 'Marketplace onboarding desk'

type Tab = 'overview' | 'categories' | 'listings' | 'settlement' | 'documents' | 'bills' | 'history'

const TABS: { id: Tab; label: string }[] = [
  { id: 'overview',   label: 'Overview' },
  { id: 'categories', label: 'Categories' },
  { id: 'listings',   label: 'Listings' },
  { id: 'settlement', label: 'Settlement & contacts' },
  { id: 'documents',  label: 'Documents' },
  { id: 'bills',      label: 'Bills' },
  { id: 'history',    label: 'History' },
]

export function OperatorPartners() {
  const [rows, setRows] = useState<PartnerDirectoryRow[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [tiers, setTiers] = useState<Tier[]>([])
  const [dirError, setDirError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS)
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({ key: 'status', dir: 'asc' })
  const [page, setPage] = useState(1)

  const [selected, setSelected] = useState<string | null>(null)
  const [detail, setDetail] = useState<PartnerDetail | null>(null)
  const [tab, setTab] = useState<Tab>('overview')
  const [moveTo, setMoveTo] = useState<PartnerStatus | null>(null)
  const [viewDoc, setViewDoc] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    const d = await loadPartnerDirectory()
    setRows(d.rows); setCategories(d.categories); setTiers(d.tiers)
    setDirError(d.loadError ?? null)
    return d.rows
  }, [])

  useEffect(() => { refresh().then(() => setLoading(false)) }, [refresh])

  const reloadDetail = useCallback(async (id: string) => setDetail(await loadPartnerDetail(id)), [])
  useEffect(() => { if (selected) void reloadDetail(selected) }, [selected, reloadDetail])
  /* A new filter starts at the top of the new result, not on whatever page
     number happened to be showing. */
  useEffect(() => { setPage(1) }, [filters])

  const filtered = useMemo(() => applyFilters(rows, filters), [rows, filters])
  const sorted = useMemo(() => sortRows(filtered, sort.key, sort.dir, tiers), [filtered, sort, tiers])
  const pageOf = useMemo(() => paginate(sorted, page, PAGE_SIZE), [sorted, page])

  if (loading) return <div style={{ textAlign: 'center', padding: '40px' }}><div className="spinner" style={{ margin: '0 auto' }} /></div>

  const catName = (id: string) => categories.find(c => c.id === id)?.name ?? id
  const tierOf = (id: string) => tiers.find(t => t.id === id) ?? null
  const partner = detail?.partner ?? null

  const toggle = <K extends keyof Filters>(key: K, value: string) => setFilters(f => {
    const list = f[key] as string[]
    return { ...f, [key]: list.includes(value) ? list.filter(v => v !== value) : [...list, value] }
  })

  const handleMove = async (to: PartnerStatus, reason: string) => {
    if (!partner) return
    const res = await movePartner({ partnerId: partner.id, to, reason, actor: 'Marketplace onboarding desk' })
    if (!res.ok) { toast(res.reason, 'error'); return }
    toast(res.listingsSuspended > 0
      ? `${partner.name} is now ${to}. ${res.listingsSuspended} live listing${res.listingsSuspended === 1 ? '' : 's'} taken down.`
      : `${partner.name} is now ${to}.`)
    if (res.recordWarning) toast(res.recordWarning, 'error')
    setMoveTo(null)
    await Promise.all([refresh(), reloadDetail(partner.id)])
  }

  const statusBuckets = byStatus(rows)
  const tierBuckets = byTier(rows, tiers)
  const catBuckets = byCategory(rows, categories)
  const filtering = filters.search !== '' || filters.statuses.length > 0 ||
                    filters.tiers.length > 0 || filters.categories.length > 0

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div>
        <h1 style={{ fontSize: 'var(--text-2xl)', fontWeight: 800, color: 'var(--text)' }}>Sellers</h1>
        <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)', marginTop: '4px' }}>
          {rows.length} on record · {rows.reduce((n, r) => n + r.liveListings, 0)} live listings between them
        </p>
      </div>

      {dirError && <Callout tone="danger" title="Some of this screen did not load">{dirError}</Callout>}

      {/* State first, because "how many are stuck" is the question a partner
          list gets asked most and the old screen could not answer it at all.
          Each tile is also the filter for that state. */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '10px' }}>
        {statusBuckets.map(b => {
          const on = filters.statuses.includes(b.key as PartnerStatus)
          return (
            <button key={b.key} onClick={() => toggle('statuses', b.key)} style={{
              textAlign: 'left', padding: '12px 14px', cursor: 'pointer',
              borderRadius: 'var(--radius-md)', background: on ? 'var(--brand-navy)' : 'white',
              border: `1px solid ${on ? 'var(--brand-navy)' : 'var(--border)'}`,
            }}>
              <div style={{ fontSize: 'var(--text-2xl)', fontWeight: 800, color: on ? 'white' : STATUS_INK[b.key] }}>
                {b.count}
              </div>
              <div style={{ fontSize: 'var(--text-xs)', fontWeight: 600, color: on ? 'rgba(255,255,255,0.75)' : 'var(--text-secondary)' }}>
                {b.label}
              </div>
            </button>
          )
        })}
      </div>

      <SectionCard
        title="Directory"
        subtitle={filtering
          ? `${pageOf.total} of ${rows.length} match · showing ${pageOf.from}–${pageOf.to}`
          : `Showing ${pageOf.from}–${pageOf.to} of ${pageOf.total}`}
        action={filtering
          ? <button onClick={() => setFilters(EMPTY_FILTERS)} style={{
              fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--brand-navy)',
              background: 'none', border: 'none', cursor: 'pointer',
            }}>Clear filters</button>
          : undefined}
      >
        <div style={{ padding: '14px 20px', display: 'flex', flexDirection: 'column', gap: '11px', borderBottom: '1px solid var(--border-light)' }}>
          <div style={{ position: 'relative', maxWidth: '380px' }}>
            <Search size={15} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-tertiary)' }} />
            <input
              value={filters.search}
              onChange={e => setFilters(f => ({ ...f, search: e.target.value }))}
              placeholder="Search name, id, type, country or contact"
              style={{
                width: '100%', padding: '8px 12px 8px 32px', borderRadius: 'var(--radius)',
                border: '1px solid var(--border)', fontSize: 'var(--text-sm)', outline: 'none', color: 'var(--text)',
              }}
            />
          </div>

          <ChipRow label="Marketplace"
                   options={catBuckets.map(b => ({ value: b.key, label: `${b.label} (${b.count})` }))}
                   selected={filters.categories} onToggle={v => toggle('categories', v)} />
          <ChipRow label="Tier"
                   options={tierBuckets.map(b => ({ value: b.key, label: `${b.label} (${b.count})`, colour: b.colour }))}
                   selected={filters.tiers} onToggle={v => toggle('tiers', v)} />
        </div>

        {pageOf.items.length === 0 ? (
          <EmptyState message="No seller matches those filters" />
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '860px' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)' }}>
                  <SortHead label="Seller"       col="name"     sort={sort} onSort={setSort} />
                  <Head label="Marketplaces" />
                  <SortHead label="Tier"         col="tier"     sort={sort} onSort={setSort} />
                  <Head label="Settlement plan" />
                  <SortHead label="Listings"     col="listings" sort={sort} onSort={setSort} right />
                  <SortHead label="Onboarding"   col="progress" sort={sort} onSort={setSort} />
                  <SortHead label="State"        col="status"   sort={sort} onSort={setSort} />
                </tr>
              </thead>
              <tbody>
                {pageOf.items.map(r => {
                  const t = tierOf(r.tier_id)
                  return (
                    <tr key={r.id}
                        onClick={() => { setSelected(r.id); setTab('overview') }}
                        style={{
                          borderBottom: '1px solid var(--border-light)', cursor: 'pointer',
                          background: r.id === selected ? 'var(--info-bg)' : 'transparent',
                        }}>
                      <Cell>
                        <div style={{ fontSize: 'var(--text-xs)', fontWeight: 700, color: 'var(--text)' }}>{r.name}</div>
                        <div style={{ fontSize: '10px', color: 'var(--text-tertiary)' }}>{r.id} · {r.type} · {r.country}</div>
                      </Cell>
                      <Cell>
                        <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                          {r.categories.length === 0
                            ? <span style={{ fontSize: '10px', color: 'var(--text-tertiary)' }}>None</span>
                            : r.categories.map(c => (
                                <span key={c} style={{
                                  fontSize: '10px', fontWeight: 600, padding: '1px 7px',
                                  borderRadius: 'var(--radius-full)', background: 'var(--bg-alt)',
                                  border: '1px solid var(--border)', color: 'var(--text-secondary)',
                                }}>{catName(c)}</span>
                              ))}
                        </div>
                      </Cell>
                      <Cell>
                        {t && <TierBadge tier={t} />}
                      </Cell>
                      <Cell>
                        <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                          {r.planName ?? <span style={{ color: 'var(--text-tertiary)' }}>Not assigned</span>}
                        </div>
                      </Cell>
                      <Cell right>
                        <span style={{ fontSize: 'var(--text-xs)', fontWeight: 700 }}>{r.liveListings}</span>
                        <span style={{ fontSize: '10px', color: 'var(--text-tertiary)' }}> / {r.listings}</span>
                      </Cell>
                      <Cell>
                        <GateProgress cleared={r.clearedGates} total={r.totalGates} at={r.currentGate} />
                      </Cell>
                      <Cell>
                        <span style={{ fontSize: '11px', fontWeight: 700, color: STATUS_INK[r.status] }}>{r.status}</span>
                      </Cell>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        {pageOf.pages > 1 && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '11px 20px', borderTop: '1px solid var(--border-light)' }}>
            <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
              Page {pageOf.page} of {pageOf.pages}
            </span>
            <div style={{ display: 'flex', gap: '6px' }}>
              <Btn variant="secondary" size="sm" disabled={pageOf.page === 1} onClick={() => setPage(p => p - 1)}>
                <ChevronLeft size={13} /> Previous
              </Btn>
              <Btn variant="secondary" size="sm" disabled={pageOf.page === pageOf.pages} onClick={() => setPage(p => p + 1)}>
                Next <ChevronRight size={13} />
              </Btn>
            </div>
          </div>
        )}
      </SectionCard>

      {/* Where the book sits. Both read the whole directory, not the filtered
          page — a distribution that changes as you filter is not a
          distribution. */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(330px, 1fr))', gap: '20px' }}>
        <SectionCard title="Sellers by marketplace"
                     subtitle="A seller approved for two counts in both, so these sum to more than the seller count">
          <div style={{ padding: '18px 20px' }}>
            <ColumnChart
              data={catBuckets.map(b => ({ label: b.label.split(' ')[0], value: b.count }))}
              format={n => `${n}`}
              label="Sellers by marketplace"
              height={150}
            />
          </div>
        </SectionCard>

        <SectionCard title="Tier distribution" subtitle="Where the seller book is concentrated">
          <div style={{ padding: '18px 20px' }}>
            <DonutChart
              data={tierBuckets.filter(b => b.count > 0).map(b => ({ label: b.label, value: b.count, colour: b.colour }))}
              centre={String(rows.length)}
              centreSub="sellers"
              format={n => `${n}`}
              label="Partner tier distribution"
            />
          </div>
        </SectionCard>
      </div>

      {/* -------------------------------------------------- the record ---- */}
      {partner && (
        <SectionCard
          title={partner.name}
          subtitle={`${partner.id} · ${partner.type} · ${partner.country} · ${partner.contact}${partner.email ? ` <${partner.email}>` : ''}`}
          action={
            <button onClick={() => { setSelected(null); setDetail(null) }} style={{
              fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--text-tertiary)',
              background: 'none', border: 'none', cursor: 'pointer',
            }}>Close</button>
          }
        >
          <div style={{ display: 'flex', gap: '4px', padding: '10px 20px 0', flexWrap: 'wrap', borderBottom: '1px solid var(--border-light)' }}>
            {TABS.map(t => (
              <button key={t.id} onClick={() => setTab(t.id)} style={{
                padding: '7px 13px', cursor: 'pointer', background: 'none', border: 'none',
                fontSize: 'var(--text-xs)', fontWeight: 700,
                color: tab === t.id ? 'var(--brand-navy)' : 'var(--text-tertiary)',
                borderBottom: `2px solid ${tab === t.id ? 'var(--brand-navy)' : 'transparent'}`,
              }}>
                {t.label}
                {t.id === 'documents' && detail && <Count n={detail.documents.length + detail.evidence.filter(e => e.document).length} />}
                {t.id === 'bills' && detail && <Count n={detail.statements.length} />}
                {t.id === 'listings' && detail && <Count n={detail.listings.length} />}
              </button>
            ))}
          </div>

          <div style={{ padding: '18px 20px' }}>
            {detail?.loadError && <Callout tone="danger" title="Part of this record did not load">{detail.loadError}</Callout>}

            {tab === 'overview' && (
              <Overview
                detail={detail!} tier={tierOf(partner.tier_id)} catName={catName}
                onMove={setMoveTo}
                othersOnPlan={detail?.plan ? rows.filter(r => r.plan_id === detail.plan!.id && r.id !== partner.id).length : 0}
              />
            )}
            {tab === 'categories' && (
              <Categories detail={detail!} categories={categories} catName={catName}
                          onChanged={async () => { await Promise.all([refresh(), reloadDetail(detail!.partner!.id)]) }} />
            )}
            {tab === 'listings' && <Listings detail={detail!} catName={catName} />}
            {tab === 'settlement' && (
              <PartnerSettlementTab partnerId={partner.id} partnerName={partner.name} country={partner.country} />
            )}
            {tab === 'documents' && <Documents detail={detail!} catName={catName} onView={setViewDoc} />}
            {tab === 'bills' && <Bills detail={detail!} />}
            {tab === 'history' && <History detail={detail!} />}
          </div>
        </SectionCard>
      )}

      {viewDoc && partner && (
        <DocumentViewer name={viewDoc} partnerName={partner.name} onClose={() => setViewDoc(null)} />
      )}

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

/* ------------------------------------------------------------- overview -- */

function Overview({ detail, tier, catName, onMove, othersOnPlan }: {
  detail: PartnerDetail
  tier: Tier | null
  catName: (id: string) => string
  onMove: (to: PartnerStatus) => void
  othersOnPlan: number
}) {
  const p = detail.partner!
  const plan = detail.plan
  const paid = detail.statements.filter(s => s.status === 'paid').reduce((n, s) => n + Number(s.net), 0)
  const due = detail.statements.filter(s => s.status !== 'paid').reduce((n, s) => n + Number(s.net), 0)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
      <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{
          padding: '3px 12px', borderRadius: 'var(--radius-full)', fontSize: 'var(--text-xs)',
          fontWeight: 800, background: 'var(--bg-alt)', color: STATUS_INK[p.status] ?? 'var(--text)',
          border: `1px solid ${STATUS_INK[p.status] ?? 'var(--border)'}`,
        }}>{p.status}</span>
        {tier && <TierBadge tier={tier} />}
        <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', flex: 1, minWidth: '220px' }}>
          {statusMeaning(p.status)}
        </span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px' }}>
        <Stat label="Settled to date" value={`$${fmtMoney(paid)}`}
              sub={`${detail.statements.filter(s => s.status === 'paid').length} statements`} />
        <Stat label="Outstanding" value={due > 0 ? `$${fmtMoney(due)}` : 'Nothing due'}
              sub={`${detail.statements.filter(s => s.status !== 'paid').length} unpaid`} />
        <Stat label="Live listings" value={String(detail.listings.filter(l => l.status === 'live').length)}
              sub={`of ${detail.listings.length} on record`} />
        <Stat label="Joined" value={p.joined === '—' ? 'Not live yet' : p.joined}
              sub={p.rating > 0 ? `${p.rating} / 5 from buyers` : 'No rating yet'} />
      </div>

      {/* What the tier is actually worth. A badge with no consequence is
          decoration, and a seller cannot work towards a ladder they cannot
          read the rungs of. */}
      {tier && (
        <div>
          <SubHead>Tier — {tier.name}</SubHead>
          <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', margin: '0 0 8px' }}>
            Qualifies at ${fmtMoney(tier.qualify_gross)} trailing twelve-month gross
            {tier.rate_relief > 0 && ` · ${tier.rate_relief} points off the commission rate`}
          </p>
          <ul style={{ margin: 0, paddingLeft: '18px', display: 'flex', flexDirection: 'column', gap: '3px' }}>
            {tier.benefits.map(b => (
              <li key={b} style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>{b}</li>
            ))}
          </ul>
        </div>
      )}

      <div>
        <SubHead>Commission model</SubHead>
        {!plan ? (
          <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', margin: 0 }}>
            No plan is assigned. Nothing was agreed, which is what you would expect on an application that
            never reached the agreements gate — a seller cannot settle without one.
          </p>
        ) : <PlanBody plan={plan} catName={catName} othersOnPlan={othersOnPlan} />}
      </div>

      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', borderTop: '1px solid var(--border-light)', paddingTop: '14px' }}>
        {transitionsFrom(p.status).map(t => (
          <Btn key={t.to} size="sm" variant={t.to === 'suspended' || t.to === 'rejected' ? 'danger' : 'secondary'}
               onClick={() => onMove(t.to)}>{t.label}</Btn>
        ))}
      </div>
    </div>
  )
}

function PlanBody({ plan, catName, othersOnPlan }: {
  plan: CommissionPlan; catName: (id: string) => string; othersOnPlan: number
}) {
  const opening = rateAt(plan, 0)
  const next = nextTier(plan, 0)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
      <Facts rows={[
        ['Plan', `${plan.name} (${plan.id})`],
        ['Model', plan.model],
        ['Applies to', plan.category_id ? catName(plan.category_id) : 'Every category'],
        ['Opening rate', `${opening}%`],
        ['Settlement', plan.cycle],
        ['Hold', plan.hold],
        ['Fees on top', plan.fees],
      ]} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
        {plan.tiers.map((t, i) => (
          <div key={t.from} style={{
            display: 'flex', gap: '10px', padding: '6px 11px', borderRadius: 'var(--radius-sm)',
            background: i === 0 ? 'var(--info-bg)' : 'var(--bg-alt)', fontSize: 'var(--text-xs)',
          }}>
            <span style={{ flex: 1, color: 'var(--text-secondary)' }}>
              {t.from === 0 ? 'From the first sale' : `From $${fmtMoney(t.from)} cumulative`}
            </span>
            <span style={{ fontWeight: 800 }}>{t.rate}%</span>
          </div>
        ))}
      </div>
      <p style={{ fontSize: '11px', color: 'var(--text-tertiary)', margin: 0 }}>
        {next && `The rate ${next.tier.rate < opening ? 'falls' : 'rises'} to ${next.tier.rate}% at $${fmtMoney(next.tier.from)} of cumulative gross value. `}
        {othersOnPlan > 0 && `${othersOnPlan} other seller${othersOnPlan === 1 ? ' is' : 's are'} on the same schedule — editing it edits theirs too.`}
      </p>
    </div>
  )
}

/* ------------------------------------------------------- categories tab -- */

function Categories({ detail, categories, catName, onChanged }: {
  detail: PartnerDetail; categories: Category[]; catName: (id: string) => string
  onChanged: () => Promise<void>
}) {
  const today = new Date()
  const rule = (id: string): PolicyRule | undefined => detail.rules.find(r => r.id === id)
  const [adding, setAdding] = useState(false)
  const [withdrawing, setWithdrawing] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const partner = detail.partner!
  const applied = [...detail.approvals].sort((a, b) =>
    (categories.find(c => c.id === a.category_id)?.sort_order ?? 99) -
    (categories.find(c => c.id === b.category_id)?.sort_order ?? 99))

  const addable = addableCategories(categories, detail.approvals)

  const run = async (fn: () => Promise<{ ok: boolean; reason?: string; note?: string }>, ok: string) => {
    setBusy(true)
    try {
      const res = await fn()
      if (!res.ok) { toast(res.reason ?? 'That did not work', 'error'); return false }
      toast(res.note ?? ok)
      await onChanged()
      return true
    } finally { setBusy(false) }
  }

  const addSection = (
    <SectionCard
      title="Add a category"
      subtitle={addable.length === 0
        ? 'This seller already holds every marketplace.'
        : `${addable.length} this seller does not hold`}
      action={addable.length > 0 && (
        <Btn size="sm" onClick={() => setAdding(true)} disabled={busy}><Plus size={13} /> Add a category</Btn>
      )}>
      <div style={{ padding: '12px 20px' }}>
        <p style={{ fontSize: '11px', color: 'var(--text-tertiary)', margin: 0 }}>
          {addable.length === 0
            ? 'Nothing left to add.'
            : `Adding one opens an application, not a marketplace: ${addable.map(c => c.name).join(', ')}. It lands unapproved with its evidence outstanding, and opens when the rules that category enforces are satisfied.`}
        </p>
      </div>
    </SectionCard>
  )

  if (applied.length === 0) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <Callout tone="warning" title="No categories on record">
          This seller cannot list anything until they hold at least one category.
        </Callout>
        {addSection}
        {adding && (
          <AddCategoryDialog
            partnerName={partner.name} partnerStatus={partner.status}
            addable={addable} approvals={detail.approvals} categories={categories}
            onClose={() => setAdding(false)}
            onSubmit={async (categoryId, reason) => {
              const done = await run(() => addPartnerCategory({ partnerId: partner.id, categoryId, actor: ACTOR, reason }), 'Category added')
              if (done) setAdding(false)
            }}
          />
        )}
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <Callout tone="info">
        The seven company gates say who this seller is. These say what they may sell — and they are per
        category because the demands are: security needs an independent attestation, devices need type
        approval per market, content needs distribution rights. Adding a category is a change to the
        seller's agreement, not a setting.
      </Callout>

      {addSection}

      {applied.map(a => {
        const readiness = categoryReadiness(a.category_id, detail.evidence, a.approved_at !== null, today)
        const mine = detail.evidence.filter(e => e.category_id === a.category_id)
        const tone = !readiness.approved ? 'warning' : readiness.clear ? 'success' : 'danger'

        return (
          <div key={a.category_id} style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
            <div style={{
              padding: '11px 14px', display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap',
              background: tone === 'success' ? 'var(--success-bg)' : tone === 'danger' ? 'var(--danger-bg)' : 'var(--warning-bg)',
              borderBottom: '1px solid var(--border)',
            }}>
              <span style={{ fontSize: 'var(--text-sm)', fontWeight: 800, color: 'var(--text)' }}>{catName(a.category_id)}</span>
              <span style={{
                fontSize: '10px', fontWeight: 700, padding: '2px 9px', borderRadius: 'var(--radius-full)',
                background: 'white',
                color: tone === 'success' ? 'var(--success)' : tone === 'danger' ? 'var(--danger)' : 'var(--warning)',
              }}>
                {!readiness.approved ? 'Not approved' : readiness.clear ? 'Open' : 'Approved — action needed'}
              </span>
              <span style={{ flex: 1, fontSize: '11px', color: 'var(--text-secondary)', minWidth: '180px' }}>
                {readiness.satisfied} of {readiness.total} rules satisfied
                {a.approved_at && ` · approved ${fmtDate(a.approved_at)}${a.approved_by ? ` by ${a.approved_by}` : ''}`}
              </span>

              {/* The two decisions this category is waiting on. Approve is
                  disabled with its reason on the row rather than refusing after
                  a round trip; withdraw always asks, because it narrows what
                  somebody is contractually allowed to sell. */}
              <div style={{ display: 'flex', gap: '6px' }}>
                {!a.approved_at && (() => {
                  const verdict = canApproveCategory(
                    partner.id, a.category_id, detail.approvals, detail.evidence, detail.matrix, detail.rules)
                  const blocking = blockingRules(partner.id, a.category_id, detail.evidence, detail.matrix, detail.rules)
                  return (
                    <Btn size="sm" disabled={!verdict.ok || busy}
                         title={verdict.ok ? `Open ${catName(a.category_id)} for this seller` : (verdict as { reason: string }).reason}
                         onClick={() => void run(
                           () => approvePartnerCategory({ partnerId: partner.id, categoryId: a.category_id, actor: ACTOR }),
                           `${catName(a.category_id)} is open`)}>
                      {blocking.length > 0 ? `Blocked — ${blocking.length} rule${blocking.length === 1 ? '' : 's'}` : 'Approve'}
                    </Btn>
                  )
                })()}
                <Btn size="sm" variant="secondary" disabled={busy}
                     onClick={() => setWithdrawing(a.category_id)}>Withdraw</Btn>
              </div>
            </div>

            {/* Approved and clear are different things, and the difference is
                worth a whole line: a lapsed certificate does not un-approve
                anything by itself, but it does stop new listings. */}
            {readiness.expired.length > 0 && (
              <div style={{ padding: '10px 14px', background: 'var(--danger-bg)', borderBottom: '1px solid var(--border)' }}>
                <div style={{ display: 'flex', gap: '7px', alignItems: 'flex-start' }}>
                  <TriangleAlert size={14} style={{ color: 'var(--danger)', flexShrink: 0, marginTop: '1px' }} />
                  <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>
                    <strong style={{ color: 'var(--danger)' }}>
                      {readiness.expired.length} document{readiness.expired.length === 1 ? ' has' : 's have'} expired.
                    </strong>{' '}
                    Existing listings continue; new ones in this category are held until it is renewed.
                  </div>
                </div>
              </div>
            )}
            {readiness.expiring.length > 0 && (
              <div style={{ padding: '9px 14px', background: 'var(--warning-bg)', borderBottom: '1px solid var(--border)', fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>
                {readiness.expiring.length} expires within 60 days — {readiness.expiring.map(e => fmtDate(e.expires_on)).join(', ')}.
              </div>
            )}

            <div>
              {mine.sort((a2, b2) => a2.rule_id.localeCompare(b2.rule_id)).map((e, i) => (
                <EvidenceRow key={e.id} e={e} rule={rule(e.rule_id)} first={i === 0} today={today} />
              ))}
            </div>
          </div>
        )
      })}

      {adding && (
        <AddCategoryDialog
          partnerName={partner.name} partnerStatus={partner.status}
          addable={addable} approvals={detail.approvals} categories={categories}
          onClose={() => setAdding(false)}
          onSubmit={async (categoryId, reason) => {
            const done = await run(() => addPartnerCategory({ partnerId: partner.id, categoryId, actor: ACTOR, reason }), 'Category added')
            if (done) setAdding(false)
          }}
        />
      )}

      {withdrawing && (
        <WithdrawCategoryDialog
          categoryName={catName(withdrawing)}
          partnerName={partner.name}
          verdict={canWithdrawCategory(withdrawing, detail.approvals, detail.listings)}
          onClose={() => setWithdrawing(null)}
          onSubmit={async reason => {
            const done = await run(
              () => withdrawPartnerCategory({ partnerId: partner.id, categoryId: withdrawing, actor: ACTOR, reason }),
              'Category withdrawn')
            if (done) setWithdrawing(null)
          }}
        />
      )}
    </div>
  )
}

/* Adding a category asks for a reason for the same purpose the lifecycle move
   does: the next person to open this record needs to know who widened the
   agreement and on what basis. */
function AddCategoryDialog({ partnerName, partnerStatus, addable, approvals, categories, onClose, onSubmit }: {
  partnerName: string
  partnerStatus: string
  addable: { id: string; name: string }[]
  approvals: PartnerDetail['approvals']
  categories: Category[]
  onClose: () => void
  onSubmit: (categoryId: string, reason: string) => void
}) {
  const [categoryId, setCategoryId] = useState(addable[0]?.id ?? '')
  const [reason, setReason] = useState('')

  const verdict = canAddCategory(
    partnerStatus, categoryId,
    categories.map(c => ({ id: c.id, name: c.name, sort_order: c.sort_order })),
    approvals)
  const problem = !verdict.ok ? (verdict as { reason: string }).reason
    : !reason.trim() ? 'Say why this category is being added.'
    : null

  return (
    <Modal open onClose={onClose} title={`Add a category to ${partnerName}`}
      footer={<>
        <Btn variant="secondary" size="sm" onClick={onClose}>Cancel</Btn>
        <Btn size="sm" disabled={!!problem} onClick={() => onSubmit(categoryId, reason)}>Add the category</Btn>
      </>}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
        <Callout tone="info">
          This opens an application, not a marketplace. The category lands unapproved with the rules it
          enforces written out as what the seller now owes, and it opens only once those are satisfied —
          so adding it here cannot by itself put anything on sale.
        </Callout>

        <FormField label="Category" required>
          <select value={categoryId} onChange={e => setCategoryId(e.target.value)}
                  style={{ width: '100%', padding: '8px 10px', borderRadius: 'var(--radius)', border: '1px solid var(--border)', fontSize: 'var(--text-sm)' }}>
            {addable.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </FormField>

        <FormField label="Why" required hint="Recorded against the seller and kept in the audit trail.">
          <TextArea value={reason} onChange={e => setReason(e.target.value)} rows={3}
                    placeholder="e.g. Signed addendum 4 to the reseller agreement, countersigned 30 Jul 2026." />
        </FormField>

        {problem && <Callout tone="danger">{problem}</Callout>}
      </div>
    </Modal>
  )
}

function WithdrawCategoryDialog({ categoryName, partnerName, verdict, onClose, onSubmit }: {
  categoryName: string
  partnerName: string
  verdict: { ok: true } | { ok: false; reason: string }
  onClose: () => void
  onSubmit: (reason: string) => void
}) {
  const [reason, setReason] = useState('')
  const problem = !verdict.ok ? verdict.reason : !reason.trim() ? 'Say why it is being withdrawn.' : null

  return (
    <Modal open onClose={onClose} title={`Withdraw ${categoryName} from ${partnerName}`}
      footer={<>
        <Btn variant="secondary" size="sm" onClick={onClose}>Cancel</Btn>
        <Btn size="sm" disabled={!!problem} onClick={() => onSubmit(reason)}>Withdraw the category</Btn>
      </>}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
        {verdict.ok ? (
          <Callout tone="warning">
            This seller will no longer be able to list in {categoryName}, and the evidence they supplied
            against it is cleared with it. Their agreement narrows — this is not a filter.
          </Callout>
        ) : (
          <Callout tone="danger" title="This cannot be withdrawn yet">{verdict.reason}</Callout>
        )}

        <FormField label="Why" required hint="The seller is told, and it is kept in the audit trail.">
          <TextArea value={reason} onChange={e => setReason(e.target.value)} rows={3}
                    disabled={!verdict.ok}
                    placeholder="e.g. Type approval lapsed in two of three markets and was not renewed within the 60-day grace." />
        </FormField>

        {problem && verdict.ok && <Callout tone="danger">{problem}</Callout>}
      </div>
    </Modal>
  )
}

function EvidenceRow({ e, rule, first, today }: {
  e: CategoryEvidence; rule: PolicyRule | undefined; first: boolean; today: Date
}) {
  const expired = e.expires_on ? Date.parse(e.expires_on) < today.getTime() : false
  const icon =
    e.state === 'outstanding' || e.state === 'rejected' ? <AlertCircle size={14} style={{ color: 'var(--danger)' }} />
    : expired ? <TriangleAlert size={14} style={{ color: 'var(--danger)' }} />
    : e.state === 'submitted' ? <Clock size={14} style={{ color: 'var(--warning)' }} />
    : e.state === 'standing' ? <Circle size={14} style={{ color: 'var(--text-tertiary)' }} />
    : <CheckCircle size={14} style={{ color: 'var(--success)' }} />

  return (
    <div style={{
      display: 'flex', gap: '10px', padding: '10px 14px', alignItems: 'flex-start',
      borderTop: first ? 'none' : '1px solid var(--border-light)',
    }}>
      <span style={{ flexShrink: 0, marginTop: '1px' }}>{icon}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 'var(--text-xs)', fontWeight: 700, color: 'var(--text)' }}>
          {rule?.name ?? e.rule_id}
          <span style={{ fontWeight: 400, color: 'var(--text-tertiary)' }}> · {e.rule_id}</span>
        </div>
        {rule && <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', marginTop: '1px' }}>{rule.descr}</div>}
        <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '3px' }}>
          {EVIDENCE_MEANING[e.state]}
          {e.note && ` ${e.note}`}
        </div>
        {e.document && (
          <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', marginTop: '3px' }}>
            {e.document}{e.kind ? ` · ${e.kind} ${e.size}` : ''}
            {e.expires_on && (
              <span style={{ color: expired ? 'var(--danger)' : 'var(--text-tertiary)', fontWeight: expired ? 700 : 400 }}>
                {' '}· {expired ? 'expired' : 'valid to'} {fmtDate(e.expires_on)}
              </span>
            )}
          </div>
        )}
      </div>
      <div style={{ flexShrink: 0, textAlign: 'right' }}>
        {rule && <div style={{ fontSize: '10px', fontWeight: 700, color: 'var(--text-secondary)' }}>{rule.owner}</div>}
        {rule && <div style={{ fontSize: '10px', color: 'var(--text-tertiary)' }}>{CHECK_LABEL[rule.check_by]}</div>}
      </div>
    </div>
  )
}

const CHECK_LABEL: Record<string, string> = {
  auto: 'Automated', doc: 'Document', manual: 'Manual review', extern: 'External check',
}

/* ---------------------------------------------------------- other tabs -- */

function Listings({ detail, catName }: { detail: PartnerDetail; catName: (id: string) => string }) {
  const breakdown = listingBreakdown(detail.listings)
  if (detail.listings.length === 0) {
    return <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', margin: 0 }}>
      This seller has no listings. For a seller still applying that is expected — the storefront opens at
      the last gate.
    </p>
  }
  return (
    <div>
      <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', margin: '0 0 10px' }}>
        {breakdown.map(b => `${b.count} ${b.label.toLowerCase()}`).join(' · ')}
      </p>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '520px' }}>
          <thead><tr style={{ borderBottom: '1px solid var(--border)' }}>
            <Head label="Listing" /><Head label="Marketplace" /><Head label="Price" right /><Head label="Stock" /><Head label="State" />
          </tr></thead>
          <tbody>
            {detail.listings.map(l => {
              const state = listingState(l.status)
              return (
                <tr key={l.id} style={{ borderBottom: '1px solid var(--border-light)' }}>
                  <Cell>
                    <div style={{ fontSize: 'var(--text-xs)', fontWeight: 700 }}>{l.name}</div>
                    <div style={{ fontSize: '10px', color: 'var(--text-tertiary)' }}>{l.id}</div>
                  </Cell>
                  <Cell><span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>{catName(l.category_id)}</span></Cell>
                  <Cell right><span style={{ fontSize: 'var(--text-xs)' }}>${fmtMoney(l.price)}</span></Cell>
                  <Cell><span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>{l.stock}</span></Cell>
                  <Cell>
                    <div style={{ fontSize: '11px', fontWeight: 700,
                      color: l.status === 'live' ? 'var(--success)' : l.status === 'pending' ? 'var(--warning)' : 'var(--danger)' }}>
                      {state.label}
                    </div>
                    <div style={{ fontSize: '10px', color: 'var(--text-tertiary)', maxWidth: '210px' }}>{state.meaning}</div>
                  </Cell>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function Documents({ detail, catName, onView }: {
  detail: PartnerDetail; catName: (id: string) => string; onView: (name: string) => void
}) {
  const categoryDocs = detail.evidence.filter(e => e.document)
  const today = Date.now()

  if (detail.documents.length === 0 && categoryDocs.length === 0) {
    return <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', margin: 0 }}>
      Nothing has been supplied yet.
    </p>
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
      <Callout tone="info">
        Everything this seller has handed over, in one place. Opening one is recorded against your account —
        these carry personal data on named individuals and a company's banking details.
      </Callout>

      {detail.documents.length > 0 && (
        <div>
          <SubHead>From the company gates ({detail.documents.length})</SubHead>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {detail.documents.map(d => (
              <DocRow key={d.id} name={d.name} meta={`${d.kind} · ${d.size}${d.uploaded_by ? ` · ${d.uploaded_by}` : ''}`}
                      onView={() => onView(d.name)} />
            ))}
          </div>
        </div>
      )}

      {categoryDocs.length > 0 && (
        <div>
          <SubHead>Against category rules ({categoryDocs.length})</SubHead>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {categoryDocs.map(e => {
              const expired = e.expires_on ? Date.parse(e.expires_on) < today : false
              return (
                <DocRow
                  key={e.id}
                  name={e.document!}
                  meta={`${catName(e.category_id)} · ${e.rule_id}${e.kind ? ` · ${e.kind} ${e.size}` : ''}`}
                  warn={expired ? `Expired ${fmtDate(e.expires_on)}` :
                        e.state === 'outstanding' ? 'Not supplied' : undefined}
                  onView={e.state === 'outstanding' ? undefined : () => onView(e.document!)}
                />
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

function DocRow({ name, meta, warn, onView }: {
  name: string; meta: string; warn?: string; onView?: () => void
}) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: '10px', padding: '9px 11px',
      border: `1px solid ${warn ? 'var(--danger)' : 'var(--border)'}`,
      borderRadius: 'var(--radius-md)', background: warn ? 'var(--danger-bg)' : 'white',
    }}>
      <span style={{
        width: 28, height: 28, flexShrink: 0, borderRadius: 'var(--radius-sm)', background: 'var(--bg-alt)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-tertiary)',
      }}><FileText size={14} /></span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 'var(--text-xs)', fontWeight: 700, color: 'var(--text)' }}>{name}</div>
        <div style={{ fontSize: '10px', color: warn ? 'var(--danger)' : 'var(--text-tertiary)' }}>
          {warn ? `${meta} · ${warn}` : meta}
        </div>
      </div>
      {/* Nothing to open where nothing was supplied — a View button on a
          missing document is a dead end dressed as an action. */}
      {onView && (
        <button onClick={onView} style={{
          fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--brand-navy)', background: 'none',
          border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '4px 10px', cursor: 'pointer',
        }}>View</button>
      )}
    </div>
  )
}

function Bills({ detail }: { detail: PartnerDetail }) {
  if (detail.statements.length === 0) {
    return <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', margin: 0 }}>
      No statements. A seller bills once they have sold something — a seller with no listings of their own
      has nothing to settle.
    </p>
  }

  const total = (k: keyof Statement) => detail.statements.reduce((n, s) => n + Number(s[k]), 0)

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '12px', marginBottom: '14px' }}>
        <Stat label="Gross billed" value={`$${fmtMoney(total('gross'))}`} sub={`${detail.statements.length} periods`} />
        <Stat label="Marketplace commission" value={`$${fmtMoney(total('commission'))}`}
              sub={detail.plan ? `${detail.plan.base_rate}% on the ${detail.plan.name} plan` : 'No plan'} />
        <Stat label="Settled to the seller" value={`$${fmtMoney(total('net'))}`}
              sub={`${fmtInt(detail.statements.reduce((n, s) => n + s.order_count, 0))} orders`} />
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '760px' }}>
          <thead><tr style={{ borderBottom: '1px solid var(--border)' }}>
            <Head label="Period" /><Head label="Orders" right /><Head label="Gross" right />
            <Head label="Commission" right /><Head label="Fees" right /><Head label="Refunds" right />
            <Head label="Net paid" right /><Head label="State" />
          </tr></thead>
          <tbody>
            {detail.statements.map(s => (
              <tr key={s.id} style={{ borderBottom: '1px solid var(--border-light)' }}>
                <Cell>
                  <div style={{ fontSize: 'var(--text-xs)', fontWeight: 700 }}>{s.period}</div>
                  <div style={{ fontSize: '10px', color: 'var(--text-tertiary)' }}>{s.id}</div>
                </Cell>
                <Cell right><span style={{ fontSize: 'var(--text-xs)' }}>{fmtInt(s.order_count)}</span></Cell>
                <Cell right><span style={{ fontSize: 'var(--text-xs)' }}>${fmtMoney(s.gross)}</span></Cell>
                <Cell right>
                  <span style={{ fontSize: 'var(--text-xs)' }}>−${fmtMoney(s.commission)}</span>
                  <div style={{ fontSize: '10px', color: 'var(--text-tertiary)' }}>{s.commission_rate}%</div>
                </Cell>
                <Cell right><span style={{ fontSize: 'var(--text-xs)' }}>{s.fees > 0 ? `−$${fmtMoney(s.fees)}` : '—'}</span></Cell>
                <Cell right><span style={{ fontSize: 'var(--text-xs)' }}>{s.refunds > 0 ? `−$${fmtMoney(s.refunds)}` : '—'}</span></Cell>
                <Cell right><span style={{ fontSize: 'var(--text-xs)', fontWeight: 800 }}>${fmtMoney(s.net)}</span></Cell>
                <Cell>
                  <div style={{ fontSize: '11px', fontWeight: 700,
                    color: s.status === 'paid' ? 'var(--success)' : s.status === 'approved' ? 'var(--info)' : 'var(--warning)' }}>
                    {s.status}
                  </div>
                  {s.disputed && <div style={{ fontSize: '10px', color: 'var(--danger)', fontWeight: 700 }}>Disputed</div>}
                  {s.approved_by && <div style={{ fontSize: '10px', color: 'var(--text-tertiary)' }}>{s.approved_by}</div>}
                </Cell>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p style={{ fontSize: '10px', color: 'var(--text-tertiary)', margin: '10px 0 0' }}>
        Gross less commission, fees, withholding and refunds is what was paid. The rate on each row is the
        rate on the plan the seller counter-signed at the agreements gate.
      </p>
    </div>
  )
}

function History({ detail }: { detail: PartnerDetail }) {
  const events = orderedHistory(detail.history)
  if (events.length === 0) {
    return <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', margin: 0 }}>
      No history recorded. That is not the same as nothing having happened — it means this seller predates
      the record.
    </p>
  }
  return (
    <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '12px' }}>
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
            <div style={{ fontSize: '10px', color: 'var(--text-tertiary)', marginTop: '2px' }}>{e.actor} · {fmtDate(e.at)}</div>
          </div>
        </li>
      ))}
    </ol>
  )
}

/* --------------------------------------------------------- move dialog --- */

function MoveDialog({ partnerName, from, to, liveListings, clearedGates, totalGates, onClose, onConfirm }: {
  partnerName: string; from: PartnerStatus; to: PartnerStatus
  liveListings: number; clearedGates: number; totalGates: number
  onClose: () => void; onConfirm: (reason: string) => void
}) {
  const [reason, setReason] = useState('')

  /* Checked here as well as in the repo, so the operator is told before they
     type a reason rather than after. The repo re-checks against fresh state
     regardless — this is the courtesy, that is the rule. */
  const verdict = canMove(from, to, {
    gateStatuses: Array.from({ length: totalGates }, (_, i) => (i < clearedGates ? 'cleared' : 'pending')),
    reason: reason || 'x',
  })

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

/* ------------------------------------------------------------- pieces --- */

function ChipRow({ label, options, selected, onToggle }: {
  label: string
  options: { value: string; label: string; colour?: string }[]
  selected: string[]
  onToggle: (value: string) => void
}) {
  return (
    <div style={{ display: 'flex', gap: '7px', alignItems: 'center', flexWrap: 'wrap' }}>
      <span style={{ fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text-tertiary)', minWidth: '86px' }}>
        {label}
      </span>
      {options.map(o => {
        const on = selected.includes(o.value)
        return (
          <button key={o.value} onClick={() => onToggle(o.value)} style={{
            padding: '3px 11px', borderRadius: 'var(--radius-full)', cursor: 'pointer',
            fontSize: '11px', fontWeight: 600,
            border: `1px solid ${on ? (o.colour ?? 'var(--brand-navy)') : 'var(--border)'}`,
            background: on ? (o.colour ?? 'var(--brand-navy)') : 'white',
            color: on ? 'white' : 'var(--text-secondary)',
          }}>{o.label}</button>
        )
      })}
    </div>
  )
}

/* Colour identifies the tier; the words are in text ink. The tier hues sit
   between 2.7:1 and 5:1 on this surface, so white-on-fill would be unreadable
   on at least one of them — and the skill's rule is that text wears text tokens
   and a coloured mark beside it carries the identity. */
function TierBadge({ tier }: { tier: Tier }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: '5px', padding: '2px 9px 2px 6px',
      borderRadius: 'var(--radius-full)', background: 'var(--bg-alt)', border: '1px solid var(--border)',
      fontSize: '10px', fontWeight: 700, color: 'var(--text)', whiteSpace: 'nowrap',
    }}>
      <span aria-hidden style={{ width: 8, height: 8, borderRadius: '50%', background: tier.colour, flexShrink: 0 }} />
      {tier.name}
    </span>
  )
}

function GateProgress({ cleared, total, at }: { cleared: number; total: number; at: string | null }) {
  if (total === 0) return <span style={{ fontSize: '10px', color: 'var(--text-tertiary)' }}>No record</span>
  const done = cleared === total
  return (
    <div style={{ minWidth: '120px' }}>
      <div style={{ display: 'flex', gap: '2px', marginBottom: '3px' }}>
        {Array.from({ length: total }, (_, i) => (
          <span key={i} style={{
            flex: 1, height: '4px', borderRadius: '2px',
            background: i < cleared ? 'var(--success)' : 'var(--border)',
          }} />
        ))}
      </div>
      <div style={{ fontSize: '10px', color: done ? 'var(--text-tertiary)' : 'var(--info)' }}>
        {done ? 'Complete' : `${cleared}/${total} · ${at ?? 'not started'}`}
      </div>
    </div>
  )
}

function Head({ label, right }: { label: string; right?: boolean }) {
  return (
    <th style={{
      textAlign: right ? 'right' : 'left', padding: '9px 12px', fontSize: '10px', fontWeight: 700,
      textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text-tertiary)', whiteSpace: 'nowrap',
    }}>{label}</th>
  )
}

function SortHead({ label, col, sort, onSort, right }: {
  label: string; col: SortKey; right?: boolean
  sort: { key: SortKey; dir: 'asc' | 'desc' }
  onSort: (s: { key: SortKey; dir: 'asc' | 'desc' }) => void
}) {
  const active = sort.key === col
  return (
    <th style={{ textAlign: right ? 'right' : 'left', padding: 0 }}>
      <button
        onClick={() => onSort({ key: col, dir: active && sort.dir === 'asc' ? 'desc' : 'asc' })}
        aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
        style={{
          width: '100%', padding: '9px 12px', background: 'none', border: 'none', cursor: 'pointer',
          display: 'flex', alignItems: 'center', gap: '3px', justifyContent: right ? 'flex-end' : 'flex-start',
          fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em',
          color: active ? 'var(--text)' : 'var(--text-tertiary)', whiteSpace: 'nowrap',
        }}>
        {label}
        {active && (sort.dir === 'asc' ? <ChevronUp size={11} /> : <ChevronDown size={11} />)}
      </button>
    </th>
  )
}

function Cell({ children, right }: { children: React.ReactNode; right?: boolean }) {
  return <td style={{ padding: '9px 12px', textAlign: right ? 'right' : 'left', verticalAlign: 'top' }}>{children}</td>
}

function Count({ n }: { n: number }) {
  return <span style={{
    marginLeft: '5px', fontSize: '10px', fontWeight: 700, padding: '0 5px',
    borderRadius: 'var(--radius-full)', background: 'var(--bg-alt)', color: 'var(--text-tertiary)',
  }}>{n}</span>
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div style={{ padding: '11px 13px', borderRadius: 'var(--radius-md)', background: 'var(--bg-alt)', border: '1px solid var(--border)' }}>
      <div style={{ fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text-tertiary)' }}>{label}</div>
      <div style={{ fontSize: 'var(--text-lg)', fontWeight: 800, color: 'var(--text)', marginTop: '2px' }}>{value}</div>
      {sub && <div style={{ fontSize: '10px', color: 'var(--text-tertiary)' }}>{sub}</div>}
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
