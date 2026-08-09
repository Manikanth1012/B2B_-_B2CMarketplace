import { useState, useEffect, useCallback } from 'react'
import { Pager, usePaging } from '../Pager'
import { Wallet, Download, FileText, TriangleAlert as AlertTriangle } from 'lucide-react'
import {
  StatCard, SectionCard, Table, Td, StatusPill, fmtInt, Btn, toast,
  Modal, FormField, TextArea,
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
import { taxLabelFor } from '../../lib/billTemplate'
import { useMarket } from '../../lib/MarketContext'
import { byCurrency, formatGroups, money } from '../../lib/money'
import type { DocumentSetup } from '../../lib/documentRepo'
import { statementFacts } from '../../lib/documentFacts'
import type { StatementRow } from '../../lib/documentFacts'
import { billPdf, pdfNameFor, saveBlob } from '../../lib/billPdf'
import { nextReference } from '../../lib/billTemplate'
import {
  FREQUENCY_LABEL, cycleLine, holdLine, minimumLine, nextClose, periodLabel, projectPayout,
} from '../../lib/settlementCycle'
import type { Terms } from '../../lib/settlementCycle'
import { loadMyTerms, loadMyAccrual, loadMyWithholding } from '../../lib/settlementCycleRepo'
import type { AccruingRow, WithholdingBook } from '../../lib/settlementCycleRepo'
import { byStatute, certificateLine } from '../../lib/withholding'
import type { Rule } from '../../lib/withholding'
import { accruing as loadWholesaleAccruing } from '../../lib/wholesaleRepo'
import type { WholesaleAccruing } from '../../lib/wholesaleRepo'
import { netOff } from '../../lib/wholesale'
const round2 = (n: number) => Math.round(n * 100) / 100
import { loadMyNotes, disputeNote } from '../../lib/creditNotesRepo'
import { line, netOf, STATE_LABEL, STATE_TONE, STATE_MEANING } from '../../lib/creditNotes'
import type { Note } from '../../lib/creditNotes'

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
  const [record, setRecord] = useState<SellerRecord | null>(null)
  /* The issuing entity is the one registered where this seller is, so it waits
     for the seller's own record. Every statement used to be issued by the
     Indian company — a Nairobi seller was told to expect payment from a
     Bengaluru bank account under a GSTIN. */
  const sellerMarket = record?.partner?.market ?? null
  useEffect(() => {
    void loadDocumentSetup('partner', partnerId, sellerMarket).then(setDoc)
  }, [partnerId, sellerMarket])

  const reload = useCallback(async () => {
    const [s, r] = await Promise.all([loadSellerStatements(partnerId), loadSellerRecord(partnerId)])
    setSnap(s); setRecord(r)
  }, [partnerId])
  useEffect(() => { void reload() }, [reload])

  /* Above the loading guard: `usePaging` is a hook, and a hook after an
     early return runs on some renders and not others. */
  const stmtPage = usePaging(snap?.statements ?? [])


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
      currencies: moneyBook.currencies,
      /* The tax is called what it is called where the seller is registered.
         Left to the template it printed "GST / VAT" — the hedge a seeded
         template has to make because one template renders documents in three
         countries. */
      taxLabel: taxLabelFor(sellerMarket, moneyBook.markets, doc.template),
    })
    saveBlob(billPdf(facts, doc.template, doc.ids, doc.sections), pdfNameFor(facts))
    toast(`${st.period} downloaded as a PDF`)
  }

  const download = () => {
    const rows: string[][] = [[
      'statement', 'period', 'orders', 'gross', 'commission', 'commission_rate',
      /* `adjustments` is in the file because finance reconciles from the file.
         Without it the exported net does not equal the exported columns, and
         the person chasing that difference has nothing to chase it with. */
      'fees', 'refunds', 'withholding', 'adjustments', 'net', 'status',
    ]]
    for (const s of statements) {
      rows.push([s.id, s.period, String(s.order_count), Number(s.gross).toFixed(2),
        Number(s.commission).toFixed(2), String(s.commission_rate), Number(s.fees).toFixed(2),
        Number(s.refunds).toFixed(2), Number(s.withholding).toFixed(2),
        Number(s.adjustments ?? 0).toFixed(2), Number(s.net).toFixed(2), s.status])
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
            {/* Not `plan.cycle`. That column says "Monthly, net 30" on all
                eight plans and describes a cadence nothing schedules from; the
                agreed cycle is on the card below and it is per partner. */}
            {plan ? ` Plan: ${plan.name}` : ''}
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
          <div className="stat-row">
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
            <><Table headers={['Period', 'Orders', 'Gross', 'Commission', 'Fees', 'Refunds', 'Net payout', 'State', '']}>
              {stmtPage.rows.map(s => {
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
            <div style={{ padding: '0 18px 12px' }}><Pager page={stmtPage} noun="statements" /></div></>
          </SectionCard>
        </>
      )}

      {/* The seller's half of the reconciliation: the order lines behind every
          figure above, from the same rows the marketplace reads. */}
      <PartnerStatementLines partnerId={partnerId} />

      {/* The cycle as agreed, not as a sentence.
          This card used to read `commission_plans.cycle` — the string "Monthly,
          net 30", identical on all eight plans, describing a cadence nothing
          scheduled from. "When am I paid" is the commonest question a partner
          desk gets and the answer was prose. */}
      <MyCycle partnerId={partnerId} planName={plan?.name ?? null} fees={plan?.fees ?? null} />
      <MyTaxDeducted partnerId={partnerId} />
      {plan && (
        <SectionCard title="How your commission works" subtitle={plan.name}>
          <div style={{ padding: '20px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '16px' }}>
            <Fact icon={<Wallet size={15} />} label="Commercial model" value={plan.model} />
            <Fact icon={<FileText size={15} />} label="Fees" value={plan.fees} />
          </div>
        </SectionCard>
      )}

      <NotesAgainstMe />
    </div>
  )
}

/* What the marketplace has adjusted, and the seller's one move against it.
 *
 * A note changes what this seller is paid and is raised entirely by the other
 * side. Showing it here — with the reason, the evidence and a way to challenge
 * it — is the difference between an adjustment process and a deduction.
 */
function NotesAgainstMe() {
  const [book, setBook] = useState<Awaited<ReturnType<typeof loadMyNotes>> | null>(null)
  const [disputing, setDisputing] = useState<Note | null>(null)
  const [why, setWhy] = useState('')
  const [busy, setBusy] = useState(false)
  const { fmtIn } = useMarket()

  const reload = useCallback(async () => setBook(await loadMyNotes()), [])
  useEffect(() => { void reload() }, [reload])

  if (!book || book.notes.length === 0) return null
  const policy = book.policy
  const cash = (n: number) => fmtIn(Math.abs(n), policy?.currency ?? 'USD')
  const waiting = book.notes.filter(n => n.state === 'issued')

  const submit = async () => {
    if (!disputing) return
    setBusy(true)
    const r = await disputeNote(disputing.id, why)
    setBusy(false)
    if (!r.ok) { toast(r.why ?? 'That did not send', 'error'); return }
    toast(`${disputing.id} disputed. It will not settle while it is open.`)
    setDisputing(null); setWhy('')
    await reload()
  }

  return (
    <SectionCard title="Adjustments the marketplace has made"
      subtitle={waiting.length > 0
        ? `${waiting.length} agreed and not yet on a statement, worth ${netOf(waiting) >= 0 ? '+' : '\u2212'}${cash(netOf(waiting))} at your next run.`
        : 'Each one is separate from your commission so your own reconciliation still works.'}>
      <Table headers={['Note', 'What it is for', { label: 'Amount', align: 'right' }, 'State', { label: '', align: 'right' }]}>
        {book.notes.map(n => {
          const reason = book.reasons.find(r => r.id === n.reason_id) ?? null
          return (
            <tr key={n.id}>
              <Td>
                <strong style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)' }}>{n.id}</strong>
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>{n.raised_on}</div>
              </Td>
              <Td style={{ maxWidth: '42ch' }}>
                <div style={{ fontSize: 'var(--text-xs)' }}>{line(n, reason)}</div>
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', lineHeight: 1.5 }}>{n.detail}</div>
                {n.evidence && (
                  <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', marginTop: '3px' }}>
                    Evidence: {n.evidence}
                  </div>
                )}
                {n.dispute_note && (
                  <div style={{ fontSize: 'var(--text-xs)', color: 'var(--danger)', marginTop: '4px', lineHeight: 1.5 }}>
                    You said: {n.dispute_note}
                  </div>
                )}
              </Td>
              <Td right>
                <strong style={{ color: n.kind === 'credit' ? 'var(--success)' : 'var(--danger)' }}>
                  {n.kind === 'credit' ? '+' : '\u2212'}{cash(n.amount)}
                </strong>
              </Td>
              <Td>
                <StatusPill status={STATE_TONE[n.state]} label={STATE_LABEL[n.state]} />
                <div style={{ fontSize: '10px', color: 'var(--text-tertiary)', marginTop: '2px', maxWidth: '26ch', lineHeight: 1.4 }}>
                  {STATE_MEANING[n.state]}
                </div>
              </Td>
              <Td right>
                {(n.state === 'issued' || n.state === 'applied') && (
                  <Btn variant="secondary" size="sm" onClick={() => { setDisputing(n); setWhy('') }}>
                    Dispute
                  </Btn>
                )}
              </Td>
            </tr>
          )
        })}
      </Table>

      {disputing && (
        <Modal open title={`Dispute ${disputing.id}`} onClose={() => setDisputing(null)}
          footer={<>
            <Btn variant="secondary" size="sm" onClick={() => setDisputing(null)}>Cancel</Btn>
            <Btn size="sm" disabled={busy || !why.trim()} onClick={() => void submit()}>
              {busy ? 'Sending\u2026' : 'Dispute it'}
            </Btn>
          </>}>
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
            It stops settling straight away and stays out of every run until it is resolved \u2014 nothing
            is taken from you while this is open. What the note says does not change; your reason is
            recorded beside it.
          </p>
          <FormField label="What is wrong with it" required
                     hint="Name the order, the period or the clause you are relying on. A dispute with no reason cannot be investigated.">
            <TextArea rows={4} value={why} onChange={e => setWhy(e.target.value)} />
          </FormField>
        </Modal>
      )}
    </SectionCard>
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

/* The seller's own settlement cycle, and what is building up in it.
 *
 * Read-only, deliberately. When you get paid is a term of the contract, not a
 * setting — but a seller is entitled to see it, and to see the two things that
 * change what actually lands: what is held back inside the returns window, and
 * whether the balance is under the minimum that makes a transfer worth making.
 */
function MyCycle({ partnerId, planName, fees }: {
  partnerId: string; planName: string | null; fees: string | null
}) {
  const { fmtIn } = useMarket()
  const [terms, setTerms] = useState<Terms | null>(null)
  const [accrual, setAccrual] = useState<AccruingRow | null>(null)
  /* The rules, not the certificates. What was deducted last quarter is history;
     this card is projecting what the next close will take, which is decided by
     the rules in force on the day it closes. */
  const [rules, setRules] = useState<Rule[]>([])
  /* What this seller has taken from the marketplace. It comes off the same
     payment this card projects, so a projection without it is wrong by
     however much wholesale they are running. */
  const [wholesale, setWholesale] = useState<WholesaleAccruing | null>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let live = true
    void Promise.all([
      loadMyTerms(partnerId), loadMyAccrual(partnerId), loadMyWithholding(partnerId),
      loadWholesaleAccruing(partnerId).catch(() => null),
    ])
      .then(([t, a, w, wh]) => {
        if (live) { setTerms(t); setAccrual(a); setRules(w.rules); setWholesale(wh); setReady(true) }
      })
    return () => { live = false }
  }, [partnerId])

  if (!ready) return null

  /* Said rather than hidden. A seller with no agreed cycle is one nobody can
     pay, and that is a thing to tell them rather than to render as a blank. */
  if (!terms) {
    return (
      <SectionCard title="Your settlement cycle">
        <div style={{ padding: '18px 20px' }}>
          <Callout tone="warning" title="No cycle is agreed yet">
            Nothing is settled until a cycle is agreed and recorded against your account. It is signed with
            the contract{planName ? ` alongside the ${planName} commission plan` : ''}. Raise it with your
            partner manager in Disputes &amp; Support.
          </Callout>
        </div>
      </SectionCard>
    )
  }

  const next = nextClose(terms, new Date().toISOString().slice(0, 10))
  /* The whole stack a run would compute, not the two terms of it that were
     easy to reach off the view. It used to be `net - held_back`, which ignored
     tax at source and whatever the last period could not pay — a seller was
     shown a figure nobody was going to transfer. */
  const outcome = accrual ? projectPayout({ accruing: accrual, terms, rules }) : null

  /* Wholesale is not a deduction from what was earned. It is a separate debt
     that comes off the same payment, so it sits after `projectPayout` rather
     than inside it — and it is bounded by what the payment is, because you
     cannot net off against money that is not there. */
  const wholesaleDue = round2((wholesale?.this_period ?? 0) + (wholesale?.brought_forward ?? 0))
  const afterWholesale = outcome
    ? (() => {
        const out = netOff({
          room: outcome.payable,
          charges: [{ id: 'wholesale', gross: wholesaleDue, recovered: 0 }],
        })
        return { left: round2(outcome.payable - out.recovered), taken: out.recovered, carried: out.carried }
      })()
    : { left: 0, taken: 0, carried: 0 }

  return (
    <SectionCard
      title="Your settlement cycle"
      subtitle={terms.contract_ref ? `Agreed ${terms.agreed_on} · ${terms.contract_ref}` : `Agreed ${terms.agreed_on}`}>
      <div style={{ padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
        <p style={{ margin: 0, fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', lineHeight: 1.55 }}>
          {cycleLine(terms)}
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px' }}>
          <Fact icon={<FileText size={15} />} label="How often"
                value={FREQUENCY_LABEL[terms.frequency]} />
          <Fact icon={<FileText size={15} />} label="Next period closes" value={next ?? '—'} />
          <Fact icon={<Wallet size={15} />} label="Then payable within"
                value={`${terms.pay_within_days} days`} />
          <Fact icon={<Wallet size={15} />} label="Paid in" value={terms.payout_currency} />
        </div>

        {/* The two things that make what lands differ from what was earned. */}
        {holdLine(terms) && (
          <div style={{
            fontSize: 'var(--text-xs)', color: 'var(--text-secondary)',
            padding: '10px 12px', background: 'var(--bg-alt)', borderRadius: 'var(--radius)',
          }}>
            {/* The reason is free text and most of them are written as
                sentences, so the full stop comes off before another is added. */}
            <strong>Held back:</strong> {holdLine(terms)!.replace(/\.$/, '')}. It is not lost — it settles
            in the period after the one it was earned in.
          </div>
        )}
        {minimumLine(terms) && (
          <div style={{
            fontSize: 'var(--text-xs)', color: 'var(--text-secondary)',
            padding: '10px 12px', background: 'var(--bg-alt)', borderRadius: 'var(--radius)',
          }}>
            <strong>Minimum payout:</strong> {minimumLine(terms)}
          </div>
        )}

        {accrual && outcome && (
          <div style={{ borderTop: '1px solid var(--border-light)', paddingTop: '14px' }}>
            <div style={{ fontSize: 'var(--text-xs)', fontWeight: 700, color: 'var(--text-tertiary)', marginBottom: '8px' }}>
              {periodLabel(accrual.frequency, accrual.period_start)} so far —{' '}
              {accrual.period_start} to {accrual.period_end}
            </div>
            <Row label="Sales in the period" value={fmtInt(accrual.lines)} />
            <Row label="Gross" value={fmtIn(accrual.gross, 'USD')} />
            <Row label="Net after commission and fees" value={fmtIn(accrual.net, 'USD')} />
            {/* Listed by statute rather than totalled. A seller claims 194-O
                and s.52 CGST back on two different returns, and one combined
                figure is one they cannot split between them. */}
            {outcome.deductions.map(d => (
              <Row key={d.rule_id}
                   label={`${d.statute} at ${d.rate}% of ${d.basis}`}
                   value={`− ${fmtIn(d.amount, 'USD')}`} />
            ))}
            {accrual.held_back > 0 && (
              <Row label="Inside the hold window" value={`− ${fmtIn(accrual.held_back, 'USD')}`} />
            )}
            {accrual.carried_in > 0 && (
              <Row label="Carried in from the last period" value={`+ ${fmtIn(accrual.carried_in, 'USD')}`} />
            )}
            {/* Listed here because the figure below is what lands, and a seller
                on a $3,900 wholesale pack reading a payable that ignores it is
                reading a number thousands of dollars adrift of their bank. */}
            {wholesaleDue > 0 && (
              <Row label={`Wholesale you have taken${afterWholesale.carried > 0
                ? ` — ${fmtIn(wholesaleDue, 'USD')} due, and this is all the period covers` : ''}`}
                   value={`− ${fmtIn(afterWholesale.taken, 'USD')}`} />
            )}

            <Row
              label={outcome.belowMinimum ? 'Would carry forward' : 'Payable if it closed today'}
              value={outcome.belowMinimum
                ? `${fmtIn(outcome.carriedOut, 'USD')} — under the minimum`
                : fmtIn(afterWholesale.left, 'USD')} />

            {afterWholesale.carried > 0 && (
              <p style={{ fontSize: '11px', color: 'var(--warning)', marginTop: '8px', lineHeight: 1.5 }}>
                {fmtIn(afterWholesale.carried, 'USD')} of wholesale is more than this period earned. It is
                not written off and it is not invoiced — it comes off the next settlement that has room
                for it.
              </p>
            )}

            {/* Not lost, and not the marketplace's. Without this a seller reads
                the deduction as a fee somebody has taken off them. */}
            {outcome.withheld > 0 && (
              <p style={{ fontSize: '11px', color: 'var(--text-tertiary)', marginTop: '8px', lineHeight: 1.5 }}>
                {fmtIn(outcome.withheld, 'USD')} of that goes to the revenue authority rather than to the
                marketplace, against your own tax account. You claim it back on your return with the
                certificate below, which is issued after the quarter closes.
              </p>
            )}

            {/* Stated because it is a projection and not a promise. Every
                figure above moves with the next order, and the tax rates are
                the ones in force on the day the period closes rather than
                today's — that is the day the statement will be computed on. */}
            <p style={{ fontSize: '11px', color: 'var(--text-tertiary)', marginTop: '8px', lineHeight: 1.5 }}>
              This period is still running. Nothing here is owed yet — it is what has been sold since the last
              period closed, and it changes with every order{fees ? `. Fees are ${fees.toLowerCase()}` : ''}.
            </p>
          </div>
        )}
      </div>
    </SectionCard>
  )
}

/* Tax deducted at source, and the document to claim it back with.
 *
 * The deduction already showed on the statement as a line in the gross-to-net
 * stack. What it did not have was a reason a seller could act on: which
 * statute, on what basis, and where the certificate is. Without the last of
 * those the money is simply gone from the seller's point of view, and that is
 * a dispute the marketplace loses.
 */
function MyTaxDeducted({ partnerId }: { partnerId: string }) {
  const { fmtIn } = useMarket()
  const [book, setBook] = useState<WithholdingBook | null>(null)

  useEffect(() => {
    let live = true
    void loadMyWithholding(partnerId).then(b => { if (live) setBook(b) })
    return () => { live = false }
  }, [partnerId])

  if (!book) return null

  const totals = byStatute(book.certificates)
  /* Nothing deducted is a real answer — a UAE seller is deducted from nowhere —
     and it is worth saying rather than rendering an empty card or none. */
  if (book.certificates.length === 0) {
    return (
      <SectionCard title="Tax deducted at source">
        <div style={{ padding: '18px 20px', fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', lineHeight: 1.55 }}>
          Nothing has been deducted from your settlements. Whether anything is depends on where you are tax
          resident and where the paying entity is — if that changes, this card will show what was taken and
          the certificate to claim it back with.
        </div>
      </SectionCard>
    )
  }

  return (
    <SectionCard
      title="Tax deducted at source"
      subtitle="Taken out of your settlement and paid to the authority against your own tax account. You claim it back when you file.">
      <div style={{ padding: '16px 20px 6px', display: 'flex', gap: '20px', flexWrap: 'wrap' }}>
        {totals.map(t => (
          <div key={t.statute}>
            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>{t.statute}</div>
            <div style={{ fontSize: 'var(--text-lg)', fontWeight: 800 }}>{fmtIn(t.amount, 'USD')}</div>
            <div style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>
              across {t.count} {t.count === 1 ? 'quarter' : 'quarters'}
            </div>
          </div>
        ))}
      </div>

      <Table headers={['Quarter', 'Statute', 'On', 'Deducted', 'Document', 'Where it is']}>
        {book.certificates.map(c => (
          <tr key={c.id}>
            <Td>
              <div style={{ fontWeight: 600 }}>{c.period_start} to {c.period_end}</div>
            </Td>
            <Td style={{ fontSize: 'var(--text-xs)' }}>{c.statute ?? c.rule_id}</Td>
            {/* The basis, because a seller reconciling 1% of something needs to
                know 1% of what. India deducts on the whole sale, not the
                commission. */}
            <Td right style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
              {c.basis === 'gross' ? 'the whole sale'
                : c.basis === 'commission' ? 'our commission'
                : 'the net supply'}
            </Td>
            <Td right style={{ fontWeight: 700 }}>{fmtIn(c.amount, c.currency)}</Td>
            <Td right style={{ fontSize: 'var(--text-xs)' }}>{c.form}</Td>
            <Td right style={{ fontSize: 'var(--text-xs)', maxWidth: '320px', color: 'var(--text-secondary)' }}>
              {certificateLine(c)}
            </Td>
          </tr>
        ))}
      </Table>

      <div style={{ padding: '12px 20px 16px', fontSize: '11px', color: 'var(--text-tertiary)', lineHeight: 1.5 }}>
        This is not a cost. It is your own tax, paid early and on your behalf — the certificate is what turns
        it back into a credit on your return.
      </div>
    </SectionCard>
  )
}
