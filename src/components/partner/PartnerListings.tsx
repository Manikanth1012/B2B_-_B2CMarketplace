import { Package, Plus, Download, Search, Upload, TriangleAlert } from 'lucide-react'
import { Pager, usePaging } from '../Pager'
import { useState, useEffect, useRef, useCallback } from 'react'
import { SectionCard, Table, Td, fmtMoney, Btn, EmptyState, toast, FormField, TextArea, TextInput } from '../operator/shared'
import { parseFeed, feedTemplate, feedSummary, toSubmission } from '../../lib/bulkListings'
import {
  STATE_MEANING, stateOf, sellerMayMoveTo, validatePause, validateRetire,
  validateGoLiveFor, untilLive, changesIn, validateProposal, canPropose, pendingVersion,
  VERSIONED_FIELDS,
} from '../../lib/listingLifecycle'
import type { Listing, ProductVersion } from '../../lib/listingLifecycle'
import {
  publishDue, loadVersions, pauseListing, resumeListing, retireListing, setGoLive,
  proposeChange, withdrawProposal,
} from '../../lib/listingLifecycleRepo'
import type { Feed } from '../../lib/bulkListings'
import { loadListingContext } from '../../lib/listingDraftRepo'
import type { ListingContext } from '../../lib/listingDraftRepo'
import { submitForReview } from '../../lib/catalogueRepo'
import { toCsv } from '../../lib/ledger'
import { saveBlob } from '../../lib/billPdf'
import { Callout } from '../OnboardingJourney'
import { loadSellerRecord } from '../../lib/partnerRepo'
import type { SellerRecord } from '../../lib/partnerRepo'
import { loadSellerSubmissions } from '../../lib/catalogueRepo'
import type { Submission } from '../../lib/catalogue'
import type { ListingQuery } from '../../lib/catalogueRepo'
import { fmtDate, Modal } from '../operator/shared'
import { PriceBookEditor } from '../PriceBookEditor'
import { listingState, listingBreakdown, rateAt } from '../../lib/partnerCommerce'
import type { ListingRow } from '../../lib/partnerCommerce'

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
  /* The row a seller clicked. The table showed eight columns of a listing and
     had no way to open one — every cell was truncated to fit and the review
     note, which is the thing a seller most needs to read, was three lines of
     10px type in a column. */
  const [viewing, setViewing] = useState<ListingRow | null>(null)
  /* "Bulk upload — CSV or catalogue feed" was a toast. A seller with forty SKUs
     had the same wizard forty times, and the button that acknowledged that did
     nothing about it. */
  /* The row used to show a state and offer no way to change it. */
  const [managing, setManaging] = useState<ListingRow | null>(null)
  const [versions, setVersions] = useState<ProductVersion[]>([])
  const [pauseWhy, setPauseWhy] = useState('')
  const [retireWhy, setRetireWhy] = useState('')
  const [confirmName, setConfirmName] = useState('')
  const [goLive, setGoLiveDate] = useState('')
  const [edit, setEdit] = useState<Record<string, string> | null>(null)
  const [editNote, setEditNote] = useState('')
  const [acting, setActing] = useState(false)
  const [bulk, setBulk] = useState(false)
  const [pasted, setPasted] = useState('')
  const [context, setContext] = useState<ListingContext | null>(null)
  const [importing, setImporting] = useState(false)
  const feedFile = useRef<HTMLInputElement>(null)
  const [pricing, setPricing] = useState<{ id: string; name: string; partner_id: string | null; price: number; currency?: string } | null>(null)

  const reload = useCallback(async () => {
    /* Anything whose go-live date has arrived becomes live before the list is
       read, so the screen never shows "scheduled" for yesterday. There is no
       timer; this is what stands in for one. */
    await publishDue()
    const [r, s] = await Promise.all([loadSellerRecord(partnerId), loadSellerSubmissions(partnerId)])
    setRec(r); setSubs(s.submissions); setQueries(s.queries); setLoading(false)
  }, [partnerId])
  useEffect(() => { void reload() }, [reload])

  /* The seller's approved markets, their currencies and each market's tax —
     what a feed has to be read against. Loaded once when the panel is first
     opened rather than on every visit to the page. */
  useEffect(() => {
    if (!bulk || context) return
    void loadListingContext(partnerId).then(setContext)
  }, [bulk, context, partnerId])

  /* The listing being managed, and the changes it already has in flight. Above
     the loading guard with the rest of the hooks: below it this one would run
     on some renders and not others, which is the hook-order rule. */
  useEffect(() => {
    if (!managing) { setVersions([]); return }
    setGoLiveDate(managing.go_live_on ?? '')
    setPauseWhy(''); setRetireWhy(''); setConfirmName(''); setEdit(null); setEditNote('')
    void loadVersions(managing.id).then(setVersions)
  }, [managing])

  /* Derived above the loading guard, because `usePaging` is a hook: below an
     early return it runs on some renders and not others. */
  const filtered = (rec?.listings ?? []).filter(l => {
    if (filter !== 'all' && l.status !== filter) return false
    if (search && !l.name.toLowerCase().includes(search.toLowerCase()) && !l.id.toLowerCase().includes(search.toLowerCase())) return false
    return true
  })
  const page = usePaging(filtered, { resetKey: `${filter}:${search}` })

  if (loading || !rec) {
    return <div style={{ textAlign: 'center', padding: '40px' }}><div className="spinner" style={{ margin: '0 auto' }} /></div>
  }

  const catName = (id: string) => rec.categories.find(c => c.id === id)?.name ?? id
  const breakdown = listingBreakdown(rec.listings)
  const states = ['all', ...new Set(rec.listings.map(l => l.status))]

  const act = async (fn: () => Promise<{ ok: boolean; reason?: string; note?: string }>) => {
    setActing(true)
    const r = await fn()
    setActing(false)
    toast(r.ok ? r.note ?? 'Saved' : r.reason ?? 'That did not work', r.ok ? 'success' : 'error')
    if (r.ok) { await reload(); setManaging(null) }
  }

  /* Parsed on every keystroke rather than on a button, so the refusals appear
     beside the file while it is still being fixed. */
  const feed: Feed | null = context && pasted.trim()
    ? parseFeed(pasted, { markets: context.markets, categories: rec?.categories ?? [] })
    : null

  const downloadTemplate = () => {
    if (!context) return
    saveBlob(
      new Blob([toCsv(feedTemplate(context.markets, rec?.categories ?? []))], { type: 'text/csv' }),
      'listing-feed-template.csv',
    )
    toast('Template downloaded. Delete the example row before you bring it back.')
  }

  const readFeed = (f: File) => {
    const reader = new FileReader()
    reader.onload = () => setPasted(String(reader.result ?? ''))
    reader.readAsText(f)
  }

  /* One at a time through `submitForReview`, rather than a bulk insert. Every
     rule a single listing meets — the approval, the cost floor, the market
     grants, the review record — is in that function, and a second write path
     that skipped any of them would be a way into the catalogue the wizard
     would have refused. */
  const runImport = async () => {
    if (!feed || !context) return
    setImporting(true)
    const failures: string[] = []
    let done = 0
    for (const r of feed.rows) {
      const result = await submitForReview({
        draft: toSubmission(r, partnerId, context.markets),
        submittedBy: rec?.partner?.name ?? 'The seller',
      })
      if (result.ok) done++
      else failures.push(`${r.name}: ${result.reason}`)
    }
    setImporting(false)
    await reload()
    if (done) toast(`${done} listing${done === 1 ? '' : 's'} submitted for review.`)
    if (failures.length) toast(failures.slice(0, 2).join(' '), 'error')
    if (done && !failures.length) { setBulk(false); setPasted('') }
  }

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
          <Btn variant="secondary" onClick={() => setBulk(true)}><Upload size={14} /> Bulk upload</Btn>
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
                {/* From the same table the rows read, so a filter chip cannot
                    say "paused" beside a row that says "Paused". */}
                {f === 'all' ? 'All' : STATE_MEANING[stateOf({ id: f, name: f, status: f })].label}
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
          /* The last column holds the row's actions and was headed "Markets" —
             a column of buttons under a heading naming something else. */
          <><Table headers={['Listing', 'Marketplace', 'Price', 'Commission', 'Availability', 'State', 'Review', '']}>
            {page.rows.map(l => {
              return (
                <tr key={l.id}
                    onClick={() => setViewing(l)}
                    style={{ cursor: 'pointer' }}
                    title="Open this listing">
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
                    {/* One description of each state, shared with the rules that
                        decide what may be done in it. */}
                    <div style={{
                      fontSize: 'var(--text-xs)', fontWeight: 700,
                      color: l.status === 'live' ? 'var(--success)'
                        : l.status === 'pending' || l.status === 'scheduled' || l.status === 'paused' ? 'var(--warning)'
                        : 'var(--danger)',
                    }}>{STATE_MEANING[stateOf(l)].label}</div>
                    <div style={{ fontSize: '10px', color: 'var(--text-tertiary)', maxWidth: '220px' }}>
                      {untilLive(l.go_live_on ?? null) ?? STATE_MEANING[stateOf(l)].says}
                    </div>
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
                    {/* Both stop the row's own click — pricing and managing are
                        different things from reading the listing. */}
                    <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end' }}>
                      <Btn variant="secondary" size="sm" onClick={e => { e.stopPropagation(); setPricing({ id: l.id, name: l.name, partner_id: partnerId, price: l.price }) }}>Prices</Btn>
                      <Btn variant="secondary" size="sm" onClick={e => { e.stopPropagation(); setManaging(l) }}>Manage</Btn>
                    </div>
                  </Td>
                </tr>
              )
            })}
          </Table>
          <div style={{ padding: '0 18px 12px' }}><Pager page={page} noun="listings" /></div></>
        )}
      </SectionCard>

      {/* ----------------------------------------------------- one listing */}
      {/* The row has advertised "Open this listing" since the detail popups
          went in; nothing opened. Eight columns of a listing are eight
          truncated cells, and the review note — the thing a seller most needs
          to read — was three lines of 10px type inside one of them. */}
      <Modal
        open={viewing !== null}
        onClose={() => setViewing(null)}
        title={viewing ? viewing.name : ''}
        footer={
          viewing ? (
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'space-between', width: '100%' }}>
              <Btn variant="secondary" onClick={() => { const l = viewing; setViewing(null); setManaging(l) }}>Manage</Btn>
              <div style={{ display: 'flex', gap: '8px' }}>
                <Btn variant="secondary" onClick={() => { const l = viewing; setViewing(null); setPricing({ id: l.id, name: l.name, partner_id: partnerId, price: l.price }) }}>Prices</Btn>
                <Btn variant="secondary" onClick={() => setViewing(null)}>Close</Btn>
              </div>
            </div>
          ) : null
        }>
        {viewing && (() => {
          const trail = subs.filter(s => s.product_id === viewing.id).sort((a, b) => b.version - a.version)
          const asked = queries.filter(q => q.product_id === viewing.id)
          const state = stateOf(viewing)
          return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <Callout tone={state === 'live' ? 'info' : state === 'suspended' || state === 'retired' ? 'danger' : 'warning'}
                       title={STATE_MEANING[state].label}>
                {untilLive(viewing.go_live_on ?? null) ?? STATE_MEANING[state].says}
                {state === 'paused' && viewing.paused_reason && <> You said: “{viewing.paused_reason}”.</>}
                {state === 'retired' && viewing.retired_reason && <> You said: “{viewing.retired_reason}”.</>}
              </Callout>

              {viewing.description && (
                <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                  {viewing.description}
                </div>
              )}

              <div style={{ display: 'flex', flexDirection: 'column', gap: '7px' }}>
                <Fact label="SKU" value={viewing.id} />
                <Fact label="Marketplace" value={catName(viewing.category_id) + (viewing.sub_category ? ` · ${viewing.sub_category}` : '')} />
                <Fact label="Availability" value={viewing.stock === 'in' ? 'In stock' : viewing.stock === 'low' ? 'Low stock' : 'Out of stock'} />
                {viewing.fulfil && <Fact label="Fulfilment" value={viewing.fulfil} />}
                <Fact label="Listed" value={viewing.listed ?? 'Not recorded'} />
                <Fact label="Go-live date" value={viewing.go_live_on ?? 'As soon as it is approved'} />
                <Fact label="List price" value={`$${fmtMoney(viewing.price)}`} />
                {/* The number that matters to a seller is not the price, it is
                    what lands in their account after the plan takes its cut. */}
                {rate === null
                  ? <Fact label="You receive" value="No commission plan is attached to your account yet" />
                  : <>
                      <Fact label="Commission" value={`${rate}% · $${fmtMoney(viewing.price * rate / 100)}`} />
                      <Fact label="You receive" value={`$${fmtMoney(viewing.price * (100 - rate) / 100)}`} />
                    </>}
                {viewing.tags?.length ? <Fact label="Tags" value={viewing.tags.join(', ')} /> : null}
              </div>

              <div>
                <Heading>Catalogue review</Heading>
                {trail.length === 0 ? (
                  <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)' }}>
                    No submission on record for this listing.
                  </div>
                ) : trail.map(s => (
                  <div key={`${s.product_id}-${s.version}`} style={{
                    borderLeft: `2px solid ${s.status === 'approved' ? 'var(--success)' : s.status === 'rejected' ? 'var(--danger)' : 'var(--warning)'}`,
                    paddingLeft: '10px', marginBottom: '8px',
                  }}>
                    <div style={{ fontSize: 'var(--text-xs)', fontWeight: 700 }}>
                      v{s.version} · {s.status === 'pending' ? `waiting since ${fmtDate(s.submitted_at)}` : `${s.status} by ${s.reviewed_by}`}
                    </div>
                    <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
                      {s.decision_reason ?? s.issue ?? s.check_note ?? 'No note recorded.'}
                    </div>
                  </div>
                ))}
              </div>

              {asked.length > 0 && (
                <div>
                  <Heading>Questions from the desk</Heading>
                  {asked.map(q => (
                    <div key={q.id} style={{ fontSize: 'var(--text-xs)', marginBottom: '6px' }}>
                      <strong>{q.subject}</strong> — {q.body}
                      {q.answer && <div style={{ color: 'var(--text-tertiary)' }}>You answered: {q.answer}</div>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        })()}
      </Modal>

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

      {/* --------------------------------------------------- manage a listing */}
      <Modal
        open={!!managing}
        onClose={() => setManaging(null)}
        title={managing ? `Manage ${managing.name}` : ''}
        footer={<Btn variant="secondary" onClick={() => setManaging(null)}>Close</Btn>}>
        {managing && (() => {
          const l: Listing = managing
          const state = stateOf(l)
          const moves = sellerMayMoveTo(l)
          const open = pendingVersion(versions)
          const proposable = canPropose(l, versions)
          const field = (key: string) => (managing as unknown as Record<string, unknown>)[key]
          const was = Object.fromEntries(VERSIONED_FIELDS.map(f => [f.key, field(f.key)]))
          /* Only the versioned fields, whatever else the form happens to hold —
             `changesIn` ignores the rest, and so should what is sent. */
          const proposed = edit
            ? Object.fromEntries(Object.entries(edit).filter(([k]) => VERSIONED_FIELDS.some(f => f.key === k)))
            : {}
          const changes = edit ? changesIn(proposed, was) : []
          const proposalCheck = edit ? validateProposal(changes, editNote) : null
          const goLiveCheck = validateGoLiveFor(l, goLive)

          return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
              <Callout tone={state === 'live' ? 'info' : state === 'suspended' ? 'danger' : 'warning'}
                       title={STATE_MEANING[state].label}>
                {STATE_MEANING[state].says}
                {l.paused_reason && state === 'paused' && <> You said: “{l.paused_reason}”.</>}
              </Callout>

              {/* -------------------------------------------------- on sale */}
              {(moves.includes('paused') || moves.includes('live')) && (
                <div>
                  <Heading>Whether it is on sale</Heading>

                  {/* Resuming needs nothing said, so it is a button. Pausing
                      needs a reason, so it is a field with a button under it —
                      a button that opens a field to fill in is one more click
                      for the same two things. */}
                  {moves.includes('live') && (
                    <Btn variant="primary" size="sm" disabled={acting}
                         onClick={() => void act(() => resumeListing(l))}>
                      {acting ? 'Saving…' : l.go_live_on && l.go_live_on > new Date().toISOString().slice(0, 10)
                        ? `Put it back — it waits for ${l.go_live_on}`
                        : 'Put it back on sale'}
                    </Btn>
                  )}

                  {moves.includes('paused') && (
                    <>
                      <FormField label="Why it is coming off sale" required
                                 hint="Your colleagues and the catalogue desk read this. Buyers never see it.">
                        <TextInput value={pauseWhy} onChange={e => setPauseWhy(e.target.value)}
                                   placeholder="Cell supplier delayed to September" />
                      </FormField>
                      <Btn variant="secondary" size="sm" disabled={acting || !validatePause(pauseWhy).ok}
                           onClick={() => void act(() => pauseListing(l, pauseWhy))}>
                        {acting ? 'Saving…' : 'Take it off sale'}
                      </Btn>
                    </>
                  )}
                </div>
              )}

              {/* ------------------------------------------------- go live on */}
              {state !== 'retired' && state !== 'suspended' && (
                <div>
                  <Heading>When it goes on sale</Heading>
                  <FormField label="Go-live date"
                             hint="Leave it empty to go on sale as soon as the catalogue desk approves it.">
                    <TextInput type="date" value={goLive} onChange={e => setGoLiveDate(e.target.value)} />
                  </FormField>
                  <div style={{
                    fontSize: 'var(--text-xs)', marginBottom: '8px',
                    color: goLiveCheck.ok ? 'var(--text-tertiary)' : 'var(--danger)',
                  }}>
                    {goLiveCheck.ok ? goLiveCheck.note : goLiveCheck.reason}
                  </div>
                  <Btn variant="secondary" size="sm" disabled={acting || !goLiveCheck.ok}
                       onClick={() => void act(() => setGoLive(l, goLive))}>
                    {acting ? 'Saving…' : 'Save the date'}
                  </Btn>
                </div>
              )}

              {/* --------------------------------------------- change request */}
              <div>
                <Heading>Changing what it says</Heading>

                {open ? (
                  <div style={{
                    padding: '12px 14px', borderRadius: 'var(--radius-md)',
                    background: 'var(--warning-bg)', border: '1px solid var(--warning)',
                    fontSize: 'var(--text-sm)', color: 'var(--warning)',
                  }}>
                    <strong>Version {open.version} is with the catalogue desk.</strong>{' '}
                    {managing.name} keeps selling exactly as it is until they decide.
                    <div style={{ marginTop: '6px' }}>
                      {changesIn(open.proposed, open.was).map(c => (
                        <div key={c.key} style={{ fontSize: 'var(--text-xs)' }}>
                          {c.label}: “{c.from}” → “{c.to}”
                        </div>
                      ))}
                    </div>
                    <Btn variant="secondary" size="sm" style={{ marginTop: '8px' }} disabled={acting}
                         onClick={() => void act(() => withdrawProposal(open))}>Withdraw it</Btn>
                  </div>
                ) : !proposable.ok ? (
                  <Callout tone="warning">{proposable.reason}</Callout>
                ) : !edit ? (
                  <>
                    <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', lineHeight: 1.6, marginBottom: '8px' }}>
                      What is on sale is what the desk approved, so a change is a proposal rather than an
                      edit. {managing.name} keeps selling unchanged while they look at it.
                    </div>
                    <Btn variant="secondary" size="sm"
                         onClick={() => setEdit(Object.fromEntries(
                           VERSIONED_FIELDS.map(f => {
                             const v = (managing as unknown as Record<string, unknown>)[f.key]
                             return [f.key, Array.isArray(v) ? v.join(', ') : String(v ?? '')]
                           }),
                         ))}>Propose a change</Btn>
                  </>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    {VERSIONED_FIELDS.map(f => (
                      <FormField key={f.key} label={f.label}>
                        {f.key === 'description'
                          ? <TextArea rows={3} value={edit[f.key] ?? ''}
                                      onChange={e => setEdit({ ...edit, [f.key]: e.target.value })} />
                          : <TextInput value={edit[f.key] ?? ''}
                                       onChange={e => setEdit({ ...edit, [f.key]: e.target.value })} />}
                      </FormField>
                    ))}

                    <FormField label="What changed, and why" required
                               hint="The desk decides from this. A proposal with a sentence is answered faster than one without.">
                      <TextArea rows={2} value={editNote} onChange={e => setEditNote(e.target.value)}
                                placeholder="Battery life corrected to seven years after retest." />
                    </FormField>

                    {changes.length > 0 && (
                      <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>
                        {changes.map(c => (
                          <div key={c.key}>{c.label}: “{c.from}” → “{c.to}”</div>
                        ))}
                      </div>
                    )}
                    {proposalCheck && !proposalCheck.ok && (
                      <div style={{ fontSize: 'var(--text-xs)', color: 'var(--danger)' }}>{proposalCheck.reason}</div>
                    )}

                    <div style={{ display: 'flex', gap: '8px' }}>
                      <Btn variant="secondary" size="sm" onClick={() => setEdit(null)}>Cancel</Btn>
                      <Btn variant="primary" size="sm" disabled={acting || !proposalCheck?.ok}
                           onClick={() => void act(() => proposeChange({
                             listing: l, partnerId,
                             proposed: Object.fromEntries(changes.map(c => [c.key,
                               c.key === 'tags' ? (proposed[c.key] as string).split(',').map(t => t.trim()).filter(Boolean)
                                 : proposed[c.key]])),
                             was, note: editNote,
                             submittedBy: rec?.partner?.name ?? 'The seller',
                             existing: versions,
                           }))}>
                        {acting ? 'Sending…' : 'Send for review'}
                      </Btn>
                    </div>
                  </div>
                )}
              </div>

              {/* ------------------------------------------------- withdrawal */}
              {moves.includes('retired') && (
                <div>
                  <Heading>Withdrawing it for good</Heading>
                  <FormField label="Why" required>
                    <TextInput value={retireWhy} onChange={e => setRetireWhy(e.target.value)}
                               placeholder="Discontinued — replaced by the Mk II" />
                  </FormField>
                  <FormField label={`Type “${managing.name}” to confirm`} required
                             hint="This cannot be undone. To take it off sale for a while, pause it instead.">
                    <TextInput value={confirmName} onChange={e => setConfirmName(e.target.value)} />
                  </FormField>
                  <Btn variant="secondary" size="sm" disabled={acting || !validateRetire(retireWhy, confirmName, l).ok}
                       onClick={() => void act(() => retireListing(l, retireWhy))}>
                    {acting ? 'Withdrawing…' : 'Withdraw it'}
                  </Btn>
                </div>
              )}

              {/* --------------------------------------------------- history */}
              {versions.length > 0 && (
                <div>
                  <Heading>Change history</Heading>
                  {versions.map(v => (
                    <div key={v.id} style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', marginTop: '3px' }}>
                      v{v.version} · {v.state}
                      {v.decided_by ? ` by ${v.decided_by}` : ''}
                      {v.decision_reason ? ` — ${v.decision_reason}` : v.note ? ` — ${v.note}` : ''}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        })()}
      </Modal>

      {/* ------------------------------------------------------ bulk upload */}
      <Modal
        open={bulk}
        onClose={() => { setBulk(false); setPasted('') }}
        title="Bulk upload"
        footer={
          <div style={{ display: 'flex', gap: '8px', justifyContent: 'space-between', width: '100%' }}>
            <Btn variant="secondary" disabled={!context} onClick={downloadTemplate}>
              <Download size={14} /> Template
            </Btn>
            <div style={{ display: 'flex', gap: '8px' }}>
              <Btn variant="secondary" onClick={() => { setBulk(false); setPasted('') }}>Close</Btn>
              <Btn variant="primary" disabled={importing || !feed?.rows.length} onClick={() => void runImport()}>
                {importing ? 'Submitting…' : feed?.rows.length ? `Submit ${feed.rows.length} for review` : 'Submit'}
              </Btn>
            </div>
          </div>
        }>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <Callout tone="info" title="Every row goes through the same door">
            A bulk-uploaded listing is checked exactly as a hand-typed one is — your marketplace approval,
            the cost floor, the markets you hold, the review queue. Nothing here is a shortcut past any of
            that; it only saves you the wizard forty times.
          </Callout>

          {!context ? (
            <div style={{ textAlign: 'center', padding: '20px' }}><div className="spinner" style={{ margin: '0 auto' }} /></div>
          ) : context.markets.length === 0 ? (
            <Callout tone="warning" title="You are not approved in any market yet">
              A listing has to be sold somewhere. Your approvals arrive as your application clears.
            </Callout>
          ) : (
            <>
              <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                Download the template — it carries a price column for each of{' '}
                <strong>{context.markets.flatMap(m => m.currencies).filter((c, i, a) => a.indexOf(c) === i).join(', ')}</strong>{' '}
                and one worked example. Separate several markets or tags with <code>|</code>.
              </div>

              <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                <input ref={feedFile} type="file" accept=".csv,text/csv,text/plain" style={{ display: 'none' }}
                       onChange={e => { const f = e.target.files?.[0]; if (f) readFeed(f); e.target.value = '' }} />
                <Btn variant="secondary" size="sm" onClick={() => feedFile.current?.click()}>Choose a file</Btn>
                <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>or paste it below</span>
              </div>

              <FormField label="The feed">
                <TextArea rows={8} value={pasted} onChange={e => setPasted(e.target.value)}
                          style={{ fontFamily: 'monospace', fontSize: 'var(--text-xs)' }}
                          placeholder="kind,name,description,category,…" />
              </FormField>

              {feed && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {feed.rows.length > 0 && (
                    <Callout tone="info" title="What this will do">{feedSummary(feed)}</Callout>
                  )}
                  {feed.problems.length > 0 && (
                    <div style={{
                      padding: '12px 14px', borderRadius: 'var(--radius-md)',
                      background: 'var(--warning-bg)', border: '1px solid var(--warning)',
                      fontSize: 'var(--text-sm)', color: 'var(--warning)',
                    }}>
                      <div style={{ display: 'flex', gap: '8px', alignItems: 'center', fontWeight: 700, marginBottom: '6px' }}>
                        <TriangleAlert size={15} />
                        {feed.problems.length} row{feed.problems.length === 1 ? '' : 's'} will not be submitted
                      </div>
                      {/* Row by row, because a seller cannot fix "4 rows
                          failed". The rest of the file still imports. */}
                      {feed.problems.map((p, i) => (
                        <div key={i} style={{ marginTop: '2px' }}>
                          Row {p.line}{p.name ? ` (${p.name})` : ''}: {p.reason}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </Modal>
    </div>
  )
}

function Heading({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontSize: '10px', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.06em',
      color: 'var(--text-tertiary)', marginBottom: '8px',
    }}>{children}</div>
  )
}

/** A labelled fact, so the modal reads as a record rather than as prose. */
function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '140px 1fr', gap: '12px', fontSize: 'var(--text-sm)' }}>
      <span style={{ color: 'var(--text-tertiary)' }}>{label}</span>
      <span style={{ color: 'var(--text)' }}>{value}</span>
    </div>
  )
}
