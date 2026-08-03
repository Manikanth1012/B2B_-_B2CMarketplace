import { useState, useEffect, useCallback } from 'react'
import { Wallet, Download, FileText, TriangleAlert as AlertTriangle } from 'lucide-react'
import {
  StatCard, SectionCard, Table, Td, StatusPill, fmtInt, Btn, toast,
} from '../operator/shared'
import { Callout } from '../OnboardingJourney'
import { PartnerStatementLines } from './PartnerStatementLines'
import { loadSellerStatements } from '../../lib/ledgerRepo'
import type { SellerStatements } from '../../lib/ledgerRepo'
import { reconcileStatement, toCsv } from '../../lib/ledger'
import type { Statement } from '../../lib/ledger'
import { loadSellerRecord } from '../../lib/partnerRepo'
import type { SellerRecord } from '../../lib/partnerRepo'
import { loadDocumentSetup } from '../../lib/documentRepo'
import { useMarket } from '../../lib/MarketContext'
import { byCurrency, formatGroups, money } from '../../lib/money'
import type { DocumentSetup } from '../../lib/documentRepo'
import { statementFacts } from '../../lib/documentFacts'
import type { StatementRow } from '../../lib/documentFacts'
import { billPdf, pdfNameFor, saveBlob } from '../../lib/billPdf'
import { nextReference } from '../../lib/billTemplate'

/* What the seller is owed, how it was worked out, and when it lands.
 *
 * This page used to run on a TypeScript constant: four invented statements
 * quoting a 12% rate against a plan that settles at 11%, sitting directly above
 * a reconciliation panel reading the real register. One page, two answers to
 * "what am I owed". It now reads the settlement register throughout — the same
 * rows the operator approves and the ledger posts from.
 */

export function PartnerSettlement({ partnerId }: { partnerId: string }) {
  /* A statement has two legs: what the marketplace computed, in its reporting
     currency, and what this seller's bank receives. `book` is the first; the
     payout figures come off the row, converted once when the statement was cut
     and frozen there. */
  const { book: moneyBook, fmtIn } = useMarket()
  const bookCurrency = moneyBook.currencies.find(c => c.is_reporting)?.code ?? 'USD'
  const book = (n: number | string) => fmtIn(Number(n), bookCurrency)
  const [snap, setSnap] = useState<SellerStatements | null>(null)
  /* This seller's own template, which may be an exception: one seller in a
     jurisdiction whose regulator prescribes a format does not change the
     document every other seller gets. */
  const [doc, setDoc] = useState<DocumentSetup>({ issuer: null, template: null, ids: [], sections: [] })
  useEffect(() => { void loadDocumentSetup('partner', partnerId).then(setDoc) }, [partnerId])
  const [record, setRecord] = useState<SellerRecord | null>(null)

  const reload = useCallback(async () => {
    const [s, r] = await Promise.all([loadSellerStatements(partnerId), loadSellerRecord(partnerId)])
    setSnap(s); setRecord(r)
  }, [partnerId])
  useEffect(() => { void reload() }, [reload])

  if (!snap || !record) {
    return <div style={{ textAlign: 'center', padding: '40px' }}><div className="spinner" style={{ margin: '0 auto' }} /></div>
  }

  const plan = record.plan
  const statements = snap.statements
  const current = statements[0] ?? null
  const unpaid = statements.filter(s => s.status !== 'paid')
  const due = unpaid.reduce((a, s) => a + Number(s.net), 0)
  const dueBy = byCurrency(unpaid.map(s => money(Number(s.payout_net), s.payout_currency)))
  const failing = statements.filter(s =>
    !reconcileStatement(s, snap.lines.filter(l => l.statement_id === s.id)).ok)

  /* The self-billing invoice as a document, on the template the operator
     assigned to sellers. The CSV export below it stays — that is for
     reconciling a period in a spreadsheet, which is a different job from
     filing the invoice. */
  const statementPdf = (st: Statement) => {
    if (!doc.template) { toast('The invoice format is still loading', 'error'); return }
    const facts = statementFacts(st as unknown as StatementRow, {
      issuer: doc.issuer, template: doc.template,
      reference: nextReference(doc.template, { party: st.partner_id ?? undefined }),
    })
    saveBlob(billPdf(facts, doc.template, doc.ids, doc.sections), pdfNameFor(facts))
    toast(`${st.period} downloaded as a PDF`)
  }

  const download = () => {
    const rows: string[][] = [[
      'statement', 'period', 'orders', 'gross', 'commission', 'commission_rate',
      'fees', 'refunds', 'withholding', 'net', 'status',
    ]]
    for (const s of statements) {
      rows.push([s.id, s.period, String(s.order_count), Number(s.gross).toFixed(2),
        Number(s.commission).toFixed(2), String(s.commission_rate), Number(s.fees).toFixed(2),
        Number(s.refunds).toFixed(2), Number(s.withholding).toFixed(2),
        Number(s.net).toFixed(2), s.status])
    }
    const blob = new Blob([toCsv(rows)], { type: 'text/csv' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `statements-${partnerId}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
    toast(`${statements.length} statements exported — finance reconciles from a file, not a screen`)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '16px', flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontSize: 'var(--text-2xl)', fontWeight: 800, color: 'var(--text)' }}>Settlement</h1>
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)', marginTop: '4px' }}>
            What you are owed, how it was worked out, and when it lands.
            {plan ? ` Plan: ${plan.name} · ${plan.cycle}` : ''}
          </p>
        </div>
        <Btn variant="secondary" onClick={download}><Download size={14} /> Export statements</Btn>
      </div>

      {snap.loadError && <Callout tone="danger" title="Some of this page did not load">{snap.loadError}</Callout>}

      {failing.length > 0 && (
        <Callout tone="danger" title={`${failing.length} statement${failing.length === 1 ? ' does' : 's do'} not equal the lines behind ${failing.length === 1 ? 'it' : 'them'}`}>
          A statement that does not reconcile is not payable. Raise it from Disputes and support before the run
          closes rather than after the money has moved.
        </Callout>
      )}

      {statements.length === 0 ? (
        <Callout tone="info" title="No statement has been raised yet">
          Statements are cut on your plan’s cycle once orders have settled. When the first one is raised it
          appears here with every order line behind it.
        </Callout>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: '16px' }}>
            {/* What the seller's own bank will receive, not what the marketplace
                booked. Kestrel Devices banks with HDFC in Bengaluru and was being
                shown a dollar figure its account cannot take. */}
            <StatCard label="Due to you" value={formatGroups(dueBy, fmtIn, book(0))}
                      sublabel={due > 0 ? 'Across statements not yet paid, in the money each is remitted in' : 'Everything raised has been paid'}
                      color="var(--success)" />
            <StatCard label={`Gross — ${current!.period}`} value={book(current!.gross)}
                      sublabel={`${fmtInt(current!.order_count)} orders`} color="var(--brand-navy)" />
            <StatCard label="Commission charged"
                      value={`${(Number(current!.commission) / Number(current!.gross) * 100).toFixed(1)}%`}
                      sublabel={`Plan rate ${current!.commission_rate}%`}
                      color="var(--brand-accent-dark)" />
            <StatCard label="Holdback" value={plan?.hold ?? '—'}
                      sublabel="Released after the returns window" />
          </div>

          <SectionCard title={`Current statement — ${current!.period}`} subtitle={current!.id}>
            <div style={{ padding: '20px', display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '24px' }} className="op-grid-2col">
              <div>
                <div style={{ display: 'flex', height: '28px', borderRadius: 'var(--radius)', overflow: 'hidden', marginBottom: '16px' }}>
                  <Band width={Number(current!.net) / Number(current!.gross)} colour="var(--brand-navy)"
                        label={`You ${book(current!.net)}`} />
                  <Band width={Number(current!.commission) / Number(current!.gross)} colour="#5E4B9B" label="Commission" />
                  <Band width={(Number(current!.fees) + Number(current!.refunds) + Number(current!.withholding)) / Number(current!.gross)}
                        colour="#B8A4E8" label="" />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: 'var(--text-sm)' }}>
                  <Row label={`Gross order value (${fmtInt(current!.order_count)} orders)`}
                       value={book(current!.gross)} />
                  <Row label={`Marketplace commission${plan ? ` — ${plan.name}` : ''} at ${current!.commission_rate}%`}
                       value={`less ${book(current!.commission)}`} />
                  <Row label="Payment processing and per-order fees"
                       value={`less ${book(current!.fees)}`} />
                  {Number(current!.refunds) > 0 && (
                    <Row label="Refunds borne by you" value={`less ${book(current!.refunds)}`} />
                  )}
                  {Number(current!.withholding) > 0 && (
                    <Row label="Withholding tax deducted at source"
                         value={`less ${book(current!.withholding)}`} />
                  )}
                  <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: '8px', borderTop: '2px solid var(--border)', fontWeight: 700 }}>
                    <span>Net payout</span>
                    <span style={{ fontSize: 'var(--text-lg)', fontWeight: 800 }}>{book(current!.net)}</span>
                  </div>
                  {/* The line the seller actually cares about, where their bank
                      takes something else. The rate is the one frozen on the
                      statement — a reprint has to match what was paid. */}
                  {current!.payout_currency !== current!.currency && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: '8px', fontWeight: 700 }}>
                      <span>
                        Reaching your account
                        <div style={{ fontSize: '10px', fontWeight: 400, color: 'var(--text-tertiary)' }}>
                          at the {current!.fx_as_of} fix of {current!.fx_rate}
                        </div>
                      </span>
                      <span style={{ fontSize: 'var(--text-lg)', fontWeight: 800, color: 'var(--success)' }}>
                        {fmtIn(Number(current!.payout_net), current!.payout_currency)}
                      </span>
                    </div>
                  )}
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <Row label="Statement" value={current!.id} />
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ color: 'var(--text-tertiary)', fontSize: 'var(--text-sm)' }}>State</span>
                  <StatusPill status={current!.status} />
                </div>
                {plan && <Row label="Cycle" value={plan.cycle} />}
                {plan && <Row label="Fees" value={plan.fees} />}
                <div style={{
                  marginTop: '4px', padding: '11px 13px', borderRadius: 'var(--radius)',
                  background: current!.status === 'pending' ? 'var(--warning-bg)' : 'var(--bg-alt)',
                  fontSize: 'var(--text-xs)', lineHeight: 1.6,
                }}>
                  {current!.status === 'pending'
                    ? 'Awaiting marketplace approval. Statements are approved after the returns window closes, then paid on the cycle date.'
                    : current!.status === 'approved'
                      ? 'Approved and queued for the next payout run. The amount is fixed from here.'
                      : 'Paid. It shows on the marketplace’s ledger as a discharged payable.'}
                </div>
              </div>
            </div>
          </SectionCard>

          <SectionCard title="Statement history" subtitle="Every statement you have been paid against">
            <Table headers={['Period', 'Orders', 'Gross', 'Commission', 'Fees', 'Refunds', 'Net payout', 'State', '']}>
              {statements.map(s => {
                const ok = reconcileStatement(s, snap.lines.filter(l => l.statement_id === s.id)).ok
                return (
                  <tr key={s.id}>
                    <Td>
                      <div style={{ fontWeight: 600 }}>{s.period}</div>
                      <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>{s.id}</div>
                    </Td>
                    <Td right>{fmtInt(s.order_count)}</Td>
                    <Td right>{book(s.gross)}</Td>
                    <Td right>less {book(s.commission)}</Td>
                    <Td right>less {book(s.fees)}</Td>
                    <Td right>{Number(s.refunds) ? `less ${book(s.refunds)}` : '—'}</Td>
                    <Td right>
                      <strong>{book(s.net)}</strong>
                      {s.payout_currency !== s.currency && (
                        <div style={{ fontSize: '10px', color: 'var(--text-tertiary)', fontWeight: 500 }}>
                          {fmtIn(Number(s.payout_net), s.payout_currency)} paid
                        </div>
                      )}
                    </Td>
                    <Td right><StatusPill status={s.status} /></Td>
                    <Td right>
                      <div style={{ display: 'flex', gap: '8px', alignItems: 'center', justifyContent: 'flex-end' }}>
                        {ok
                          ? <span style={{ fontSize: 'var(--text-xs)', color: 'var(--success)', fontWeight: 600 }}>reconciles</span>
                          : <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: 'var(--text-xs)', color: 'var(--danger)', fontWeight: 700 }}>
                              <AlertTriangle size={11} /> check it
                            </span>}
                        <Btn variant="secondary" size="sm" onClick={() => statementPdf(s)}>
                          <Download size={11} style={{ marginRight: 4 }} />PDF
                        </Btn>
                      </div>
                    </Td>
                  </tr>
                )
              })}
            </Table>
          </SectionCard>
        </>
      )}

      {/* The seller's half of the reconciliation: the order lines behind every
          figure above, from the same rows the marketplace reads. */}
      <PartnerStatementLines partnerId={partnerId} />

      {plan && (
        <SectionCard title="How you are paid" subtitle={plan.name}>
          <div style={{ padding: '20px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '16px' }}>
            <Fact icon={<Wallet size={15} />} label="Commercial model" value={plan.model} />
            <Fact icon={<FileText size={15} />} label="Cycle" value={plan.cycle} />
            <Fact icon={<Wallet size={15} />} label="Holdback" value={plan.hold} />
            <Fact icon={<FileText size={15} />} label="Fees" value={plan.fees} />
          </div>
        </SectionCard>
      )}
    </div>
  )
}

function Band({ width, colour, label }: { width: number; colour: string; label: string }) {
  const pct = Math.max(0, Math.min(100, width * 100))
  if (pct < 0.5) return null
  return (
    <div style={{
      width: `${pct}%`, background: colour, display: 'flex', alignItems: 'center',
      justifyContent: 'center', color: 'white', fontSize: 'var(--text-xs)', fontWeight: 600,
      overflow: 'hidden', whiteSpace: 'nowrap',
    }}>{pct > 12 ? label : ''}</div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', fontSize: 'var(--text-sm)' }}>
      <span style={{ color: 'var(--text-tertiary)' }}>{label}</span>
      <span style={{ fontWeight: 600, color: 'var(--text)', textAlign: 'right' }}>{value}</span>
    </div>
  )
}

function Fact({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
      <span style={{ color: 'var(--text-tertiary)', marginTop: '2px' }}>{icon}</span>
      <div>
        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>{label}</div>
        <div style={{ fontWeight: 600, fontSize: 'var(--text-sm)' }}>{value}</div>
      </div>
    </div>
  )
}
