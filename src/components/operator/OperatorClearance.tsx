import { useState, useEffect, useCallback, useMemo } from 'react'
import { RefreshCw, Globe } from 'lucide-react'
import { SectionCard, EmptyState, Btn, StatusPill, Table, Td, toast } from './shared'
import { Callout } from '../OnboardingJourney'
import { Pager, usePaging } from '../Pager'
import { loadClearanceBook, clearDocument } from '../../lib/einvoiceRepo'
import type { ClearanceBook, ClearanceDoc } from '../../lib/einvoiceRepo'
import {
  regimeFor, regimeLine, outstanding, coverage, canIssue, faceOfDocument,
  cancellable, scannable, STATUS_LABEL, STATUS_TONE,
} from '../../lib/einvoice'
import { useMarket } from '../../lib/MarketContext'

/* Statutory clearance.
 *
 * The marketplace computed tax in three jurisdictions correctly and registered
 * the resulting documents with nobody. In India that is not a paperwork gap —
 * an unregistered invoice is not a tax invoice, the customer cannot claim input
 * credit against it, and the supplier is penalised per document.
 *
 * The screen is arranged around the one distinction that decides what anybody
 * does about a row: whether the regime clears BEFORE the document is issued. A
 * rejection under India's IRP is blocking a customer from being invoiced at
 * all; the same rejection in the Emirates is a reporting backlog. Sorting them
 * into one undifferentiated "uncleared" list is how the urgent one waits.
 */

export function OperatorClearance() {
  const [book, setBook] = useState<ClearanceBook | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const { fmtIn } = useMarket()

  const reload = useCallback(async () => setBook(await loadClearanceBook()), [])
  useEffect(() => { void reload() }, [reload])

  const submit = async (d: ClearanceDoc) => {
    setBusy(d.record.id)
    const r = await clearDocument(
      d.record.doc_kind, d.record.doc_id, d.record.market, d.record.audience)
    setBusy(null)
    if (!r.ok) { toast(r.why ?? 'The portal refused the document.', 'error'); return }
    toast(r.status === 'not-required'
      ? `${d.record.doc_id} is out of scope — ${r.why}`
      : `${d.record.doc_id} is registered.`)
    await reload()
  }

  if (!book) {
    return <div style={{ textAlign: 'center', padding: '40px' }}><div className="spinner" style={{ margin: '0 auto' }} /></div>
  }
  if (book.loadError) {
    return <Callout tone="danger" title="The clearance record did not load">{book.loadError}</Callout>
  }

  const records = book.docs.map(d => d.record)
  const queue = outstanding(records, book.regimes)
  const byId = new Map(book.docs.map(d => [d.record.id, d]))
  const blocking = queue.filter(q => q.blocking)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {blocking.length > 0 && (
        <Callout tone="danger" title={`${blocking.length} ${blocking.length === 1 ? 'invoice cannot' : 'invoices cannot'} be issued`}>
          {blocking[0].regime?.scheme} registers an invoice before it is issued. Until these are
          registered they are not tax invoices — the customer cannot claim input credit against
          them and the supplier is penalised per document.
        </Callout>
      )}

      <div style={{ display: 'grid', gap: '12px', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' }}>
        {book.regimes.map(r => {
          const c = coverage(records, r.market)
          return (
            <div key={r.market} style={{
              border: '1px solid var(--border)', borderRadius: '10px', padding: '14px 16px',
              background: 'var(--surface)',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Globe size={14} style={{ color: 'var(--text-tertiary)' }} />
                <strong style={{ fontSize: 'var(--text-sm)', color: 'var(--text)' }}>{r.scheme}</strong>
              </div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', margin: '8px 0 4px' }}>
                <span style={{ fontSize: 'var(--text-2xl)', fontWeight: 800, color: c.failed > 0 ? 'var(--danger)' : 'var(--text)' }}>
                  {c.pct}%
                </span>
                <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>
                  {c.cleared} of {c.inScope} registered
                  {c.failed > 0 && <> · <strong style={{ color: 'var(--danger)' }}>{c.failed} rejected</strong></>}
                </span>
              </div>
              <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', lineHeight: 1.5, margin: 0 }}>
                {regimeLine(r)}
              </p>
              {r.effective_from > new Date().toISOString().slice(0, 10) && (
                <p style={{ fontSize: 'var(--text-xs)', color: 'var(--warning)', marginTop: '6px' }}>
                  Not in force until {r.effective_from}.
                </p>
              )}
            </div>
          )
        })}
      </div>

      <SectionCard
        title="Waiting on an authority"
        subtitle="Blocking first — a rejection under a before-issue regime is stopping a customer being invoiced. Everything below it is a reporting backlog."
      >
        {queue.length === 0
          ? <EmptyState message="Every document in scope is registered." />
          : (
            <Table headers={['Document', 'Market', 'Issued to', 'Amount', 'State', 'Why', '']}>
              {queue.map(q => {
                const d = byId.get(q.record.id)!
                const gate = canIssue(q.regime, q.record, q.record.audience)
                return (
                  <tr key={q.record.id} style={q.blocking ? { background: 'var(--danger-bg)' } : undefined}>
                    <Td>
                      <strong style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)' }}>{q.record.doc_id}</strong>
                      <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
                        {q.record.doc_kind === 'consumer_bill' ? 'Consumer bill' : 'Enterprise invoice'} · {q.record.audience.toUpperCase()}
                      </div>
                    </Td>
                    <Td>{q.regime?.scheme ?? q.record.market}</Td>
                    <Td>{d?.doc?.party ?? '—'}</Td>
                    <Td right>{d?.doc ? fmtIn(d.doc.total, d.doc.currency) : '—'}</Td>
                    <Td><StatusPill status={STATUS_TONE[q.record.status]} label={STATUS_LABEL[q.record.status]} /></Td>
                    <Td style={{ maxWidth: '34ch' }}>
                      <span style={{ fontSize: 'var(--text-xs)', color: q.blocking ? 'var(--danger)' : 'var(--text-secondary)' }}>
                        {gate.ok ? 'The obligation is outstanding but the document has been issued.' : gate.reason}
                      </span>
                    </Td>
                    <Td right>
                      <Btn size="sm" variant={q.blocking ? 'primary' : 'secondary'}
                        disabled={busy === q.record.id}
                        onClick={() => void submit(d)}>
                        {busy === q.record.id
                          ? 'Submitting…'
                          : <><RefreshCw size={12} style={{ marginRight: 5 }} />{q.record.attempts > 0 ? 'Resubmit' : 'Submit'}</>}
                      </Btn>
                    </Td>
                  </tr>
                )
              })}
            </Table>
          )}
      </SectionCard>

      <Registered book={book} />
    </div>
  )
}

/* What came back, and what therefore goes on the face of each document. The
   three jurisdictions return three different things and one of them returns
   nothing at all, which is why this is a table of labels rather than a column
   headed "IRN". */
function Registered({ book }: { book: ClearanceBook }) {
  const [market, setMarket] = useState<string>('all')
  const rows = useMemo(
    () => book.docs.filter(d =>
      (d.record.status === 'cleared' || d.record.status === 'cancelled' || d.record.status === 'not-required')
      && (market === 'all' || d.record.market === market)),
    [book.docs, market],
  )
  const paged = usePaging(rows, { initialSize: 10, resetKey: market })
  const now = new Date().toISOString()

  return (
    <SectionCard
      title="Registered documents"
      subtitle="What the authority returned, and what is therefore printed on the customer's copy."
      action={
        <div style={{ display: 'flex', gap: '4px' }}>
          {['all', ...book.regimes.map(r => r.market)].map(m => (
            <button key={m} onClick={() => setMarket(m)} style={{
              padding: '4px 10px', borderRadius: '999px', cursor: 'pointer',
              border: `1px solid ${market === m ? 'var(--brand-navy)' : 'var(--border)'}`,
              background: market === m ? 'var(--brand-navy)' : 'transparent',
              color: market === m ? '#fff' : 'var(--text-secondary)',
              fontSize: 'var(--text-xs)', fontWeight: 600,
            }}>{m === 'all' ? 'All' : m}</button>
          ))}
        </div>
      }
    >
      {rows.length === 0
        ? <EmptyState message="Nothing has been registered in this market yet." />
        : (
          <>
            <Table headers={['Document', 'Market', 'State', 'On the face of the document', 'Scan', 'Cancellable']}>
              {paged.rows.map(d => {
                const regime = regimeFor(book.regimes, d.record.market)
                const face = faceOfDocument(regime, d.record)
                const cancel = cancellable(regime, d.record, now)
                const scan = scannable(d.record)
                return (
                  <tr key={d.record.id}>
                    <Td>
                      <strong style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)' }}>{d.record.doc_id}</strong>
                      <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>{d.doc?.party ?? '—'}</div>
                    </Td>
                    <Td>{regime?.scheme ?? d.record.market}</Td>
                    <Td><StatusPill status={STATUS_TONE[d.record.status]} label={STATUS_LABEL[d.record.status]} /></Td>
                    <Td style={{ maxWidth: '38ch' }}>
                      {face.length === 0
                        ? (
                          <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
                            {d.record.status === 'not-required'
                              ? `${regime?.scheme ?? 'The regime'} does not cover this document.`
                              : d.record.transmission_ref
                                ? `Nothing is printed. Reported as ${d.record.transmission_ref}.`
                                : 'Nothing has come back yet.'}
                          </span>
                        )
                        : face.map(f => (
                          <div key={f.label} style={{ fontSize: 'var(--text-xs)', lineHeight: 1.6 }}>
                            <span style={{ color: 'var(--text-tertiary)' }}>{f.label} </span>
                            <span style={f.mono
                              ? { fontFamily: 'var(--font-mono)', wordBreak: 'break-all', color: 'var(--text)' }
                              : { color: 'var(--text)' }}>{f.value}</span>
                          </div>
                        ))}
                    </Td>
                    <Td>
                      {scan === null
                        ? <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>—</span>
                        : scan === 'signed'
                          ? <span style={{ fontSize: 'var(--text-xs)', color: 'var(--success)' }}>Signed QR</span>
                          : <a href={scan} target="_blank" rel="noreferrer" style={{ fontSize: 'var(--text-xs)' }}>Authority page</a>}
                    </Td>
                    <Td style={{ maxWidth: '30ch' }}>
                      <span style={{ fontSize: 'var(--text-xs)', color: cancel.ok ? 'var(--text)' : 'var(--text-tertiary)' }}>
                        {cancel.ok ? `Until ${cancel.until.slice(0, 16).replace('T', ' ')}` : cancel.reason}
                      </span>
                    </Td>
                  </tr>
                )
              })}
            </Table>
            <Pager page={paged} noun="documents" />
          </>
        )}
    </SectionCard>
  )
}
