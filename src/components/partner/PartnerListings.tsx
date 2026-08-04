import { Package, Plus, Download, Search, Upload, TriangleAlert } from 'lucide-react'
import { Pager, usePaging } from '../Pager'
import { useState, useEffect, useRef, useCallback } from 'react'
import { SectionCard, Table, Td, fmtMoney, Btn, EmptyState, toast, FormField, TextArea } from '../operator/shared'
import { parseFeed, feedTemplate, feedSummary, toSubmission } from '../../lib/bulkListings'
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
  const [bulk, setBulk] = useState(false)
  const [pasted, setPasted] = useState('')
  const [context, setContext] = useState<ListingContext | null>(null)
  const [importing, setImporting] = useState(false)
  const feedFile = useRef<HTMLInputElement>(null)
  const [pricing, setPricing] = useState<{ id: string; name: string; partner_id: string | null; price: number; currency?: string } | null>(null)

  const reload = useCallback(async () => {
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
          <><Table headers={['Listing', 'Marketplace', 'Price', 'Commission', 'Availability', 'State', 'Review', 'Markets']}>
            {page.rows.map(l => {
              const state = listingState(l.status)
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
                    {/* Stops the row's own click — pricing is a different
                        thing from reading the listing. */}
                    <Btn variant="secondary" size="sm" onClick={e => { e.stopPropagation(); setPricing({ id: l.id, name: l.name, partner_id: partnerId, price: l.price }) }}>Prices</Btn>
                  </Td>
                </tr>
              )
            })}
          </Table>
          <div style={{ padding: '0 18px 12px' }}><Pager page={page} noun="listings" /></div></>
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

/** A labelled fact, so the modal reads as a record rather than as prose. */
function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '140px 1fr', gap: '12px', fontSize: 'var(--text-sm)' }}>
      <span style={{ color: 'var(--text-tertiary)' }}>{label}</span>
      <span style={{ color: 'var(--text)' }}>{value}</span>
    </div>
  )
}
