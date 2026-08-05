import { useState, useEffect, useCallback } from 'react'
import { Download, Wallet, Receipt, TriangleAlert as AlertTriangle, Building2 } from 'lucide-react'
import {
  StatCard, SectionCard, Table, Td, Id, StatusPill, fmtInt, Btn, toast, Modal,
  FormField, TextArea, EmptyState,
} from '../operator/shared'
import { Callout } from '../OnboardingJourney'
import { useAccountMoney } from './money'
import { loadAccount, payInvoice, disputeInvoice, invoiceCsv } from '../../lib/enterpriseRepo'
import { loadDocumentSetup } from '../../lib/documentRepo'
import type { DocumentSetup } from '../../lib/documentRepo'
import { invoiceFacts } from '../../lib/documentFacts'
import type { InvoiceRow, InvoiceLineRow, AccountRow } from '../../lib/documentFacts'
import { billPdf, pdfNameFor, saveBlob } from '../../lib/billPdf'
import type { AccountBook } from '../../lib/enterpriseRepo'
import {
  outstanding, budgetPosition, bySeller, byCostCentre, reconcileInvoice, arrears,
  taxPosition, committed, idleSeats, renewingWithin, day,
} from '../../lib/enterprise'
import type { Invoice } from '../../lib/enterprise'
import { Pager, usePaging } from '../Pager'

/* Billing, for an account that buys from six companies and pays one bill.
 *
 * That consolidation is the whole point of buying through a marketplace, and
 * it is also the thing that makes an invoice hard to trust: a total covering
 * sellers the buyer never contracted with individually is a total somebody
 * disputes. So every invoice here opens into the lines behind it, broken down
 * the two ways finance actually asks for — by seller and by cost centre — and
 * the page checks the arithmetic rather than asking anybody to take it on
 * faith.
 */

const TODAY = new Date().toISOString().slice(0, 10)

export function EnterpriseBilling() {
  const [book, setBook] = useState<AccountBook | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const [paying, setPaying] = useState<Invoice | null>(null)
  const [disputing, setDisputing] = useState<Invoice | null>(null)

  const reload = useCallback(async () => setBook(await loadAccount()), [])
  const { money, money0 } = useAccountMoney(book?.account?.currency)
  useEffect(() => { void reload() }, [reload])

  /* Above the loading guard, and reading through an empty list until the book
     arrives: `usePaging` is a hook, and a hook below an early return runs on
     some renders and not others. */
  const page = usePaging(book?.invoices ?? [])
  /* The template every business invoice is issued on, and the identity it
     is issued under. Loaded once for the screen. */
  const [doc, setDoc] = useState<DocumentSetup>({ issuer: null, template: null, ids: [], sections: [] })
  /* Issued by the entity registered in this account's market, so it waits for
     the account. Was the Indian company on every invoice in every market. */
  const accountMarket = book?.account?.market ?? null
  useEffect(() => {
    void loadDocumentSetup('enterprise', null, accountMarket).then(setDoc)
  }, [accountMarket])

  if (!book) return <div style={{ textAlign: 'center', padding: '40px' }}><div className="spinner" style={{ margin: '0 auto' }} /></div>

  const { account } = book
  if (!account) {
    return <Callout tone="danger" title="This console is not attached to an account">{book.loadError ?? 'No enterprise account is linked to the signed-in user.'}</Callout>
  }

  const due = outstanding(book.invoices)
  const budget = budgetPosition(book.invoices, account, TODAY)
  const com = committed(book.subscriptions)
  const idle = idleSeats(book.subscriptions)
  const tax = taxPosition(account, book.invoices)
  const late = book.invoices.filter(i => i.status === 'overdue')
  const sellers = new Set(book.invoiceLines.map(l => l.seller))
  const broken = book.invoices
    .map(i => ({ invoice: i, check: reconcileInvoice(i, book.invoiceLines) }))
    .filter(r => !r.check.ok)

  /* The invoice as a document, on the template the operator assigned to
     business accounts. It used to come out as CSV — a spreadsheet of a legal
     document, which is a different thing from the document, and not something
     accounts payable can file. The CSV is still offered beside it, because
     reconciling a hundred lines in a spreadsheet is exactly what it is for. */
  const download = (invoice: Invoice) => {
    if (!doc.template) { toast('The invoice format is still loading', 'error'); return }
    const facts = invoiceFacts(
      invoice as unknown as InvoiceRow,
      book.invoiceLines as unknown as InvoiceLineRow[],
      { issuer: doc.issuer, account: account as unknown as AccountRow, template: doc.template })
    saveBlob(billPdf(facts, doc.template, doc.ids, doc.sections), pdfNameFor(facts))
    toast(`${invoice.id} downloaded as a PDF`)
  }

  const downloadCsv = (invoice: Invoice) => {
    saveBlob(new Blob([invoiceCsv(invoice, book.invoiceLines)], { type: 'text/csv' }), `${invoice.id}.csv`)
    toast(`${invoice.id} exported with every line behind it`)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '16px', flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontSize: 'var(--text-2xl)', fontWeight: 800, color: 'var(--text)' }}>Billing</h1>
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)', marginTop: '4px' }}>
            One invoice covers every seller · {account.terms} · {money(due.total)} outstanding
          </p>
        </div>
      </div>

      {book.loadError && <Callout tone="danger" title="Some of this did not load">{book.loadError}</Callout>}

      {broken.length > 0 && (
        <Callout tone="danger" title={`${broken.length} invoice${broken.length === 1 ? ' does' : 's do'} not add up`}>
          {broken.map(b => b.check.ok ? '' : b.check.reason).join('; ')}. Do not pay these until they are corrected.
        </Callout>
      )}

      {late.map(i => {
        const a = arrears(i, TODAY)
        return (
          <Callout key={i.id} tone={a?.stage === 'suspended' ? 'danger' : 'warning'}
                   title={`${i.id} is overdue — ${money(i.total)} was due ${day(i.due)}`}>
            {a ? `${a.days} day${a.days === 1 ? '' : 's'} late. ${a.what}` : ''}
            {i.note ? ` ${i.note}` : ''}
          </Callout>
        )
      })}

      <div className="stat-row">
        <StatCard label="Outstanding" value={money(due.total)}
                  sublabel={`${due.count} unsettled${due.overdue ? ` · ${money(due.overdue)} of it overdue` : ''}`}
                  color={due.overdue ? 'var(--danger)' : undefined} />
        <StatCard label="Billed each month" value={money(com.billed)}
                  sublabel={com.suspended
                    ? `${money(com.renewing)} renewing · ${money(com.suspended)} running to contract end`
                    : `${book.subscriptions.filter(s => s.status === 'active').length} subscriptions`} />
        <StatCard label="Budget used" value={`${budget.pct}%`}
                  sublabel={`${money0(budget.spent)} of ${money0(budget.budget)} · ${budget.yearPct}% of the year gone`}
                  color={budget.ahead ? 'var(--warning)' : 'var(--success)'} />
        <StatCard label="Sellers on one invoice" value={fmtInt(sellers.size)}
                  sublabel="The marketplace settles each of them separately" />
      </div>

      {budget.ahead && (
        <Callout tone="warning" title="Spend is ahead of the year">
          {money0(budget.spent)} of {money0(budget.budget)} is {budget.pct}% of the budget with {budget.yearPct}%
          of the financial year gone. At this rate the year ends about {money0(budget.spent / Math.max(budget.yearPct, 1) * 100)} against a {money0(budget.budget)} budget.
        </Callout>
      )}

      {idle.worst && (
        <Callout tone="info" title={`${fmtInt(idle.seats)} seats are paid for and not assigned`}>
          About {money(idle.monthly)} a month, {money(idle.monthly * 12)} a year. The largest single piece is{' '}
          {idle.worst.name} — {fmtInt(idle.worst.quantity - idle.worst.seats_used)} of {fmtInt(idle.worst.quantity)}{' '}
          {idle.worst.unit.replace('/mo', '')} unassigned. Reducing at renewal is the cheapest saving on this page.
        </Callout>
      )}

      <SectionCard title="Invoices" subtitle="Click a row to see every line behind the total">
        {book.invoices.length === 0 ? <EmptyState message="No invoices have been issued yet" /> : (
          <Table headers={['Invoice', 'Issued', 'Due', 'Subscriptions', 'One-off', 'Tax', 'Total', 'State', '']}>
            {page.rows.map(i => {
              const lines = book.invoiceLines.filter(l => l.invoice_id === i.id)
              return (
                <>
                  <tr key={i.id} onClick={() => setOpen(open === i.id ? null : i.id)} style={{ cursor: 'pointer' }}>
                    <Td>
                      {/* An identifier, so it holds its line. The hyphens in
                          `INV-2026-0779` are break opportunities CSS takes by
                          default, and the column was printing it down three
                          lines as three fields. */}
                      <div style={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}><Id>{i.id}</Id></div>
                      <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>{i.period}</div>
                    </Td>
                    <Td right style={{ fontSize: 'var(--text-xs)' }}>{day(i.issued)}</Td>
                    <Td right style={{ fontSize: 'var(--text-xs)' }}>{day(i.due)}</Td>
                    <Td right>{i.recurring ? money(i.recurring) : '—'}</Td>
                    <Td right>{i.oneoff ? money(i.oneoff) : '—'}</Td>
                    <Td right>{money(i.tax)}</Td>
                    <Td right style={{ fontWeight: 700 }}>{money(i.total)}</Td>
                    <Td right>
                      <StatusPill status={i.status === 'overdue' ? 'escalated' : i.status === 'paid' ? 'resolved' : i.status === 'disputed' ? 'pending' : 'open'} />
                      {i.paid_on && <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', marginTop: '2px' }}>{day(i.paid_on)}</div>}
                    </Td>
                    <Td right>
                      <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end' }} onClick={e => e.stopPropagation()}>
                        <Btn variant="secondary" size="sm" onClick={() => download(i)}><Download size={12} /> PDF</Btn>
                        <Btn variant="secondary" size="sm" onClick={() => downloadCsv(i)}>CSV</Btn>
                        {i.status !== 'paid' && (
                          <>
                            <Btn variant="secondary" size="sm" onClick={() => setDisputing(i)}>Query</Btn>
                            <Btn size="sm" onClick={() => setPaying(i)}>Pay</Btn>
                          </>
                        )}
                      </div>
                    </Td>
                  </tr>
                  {open === i.id && (
                    <tr key={`${i.id}-lines`}>
                      <td colSpan={9} style={{ padding: '14px 18px', background: 'var(--bg-alt)', borderBottom: '1px solid var(--border)' }}>
                        <InvoiceDetail invoice={i} book={book} />
                      </td>
                    </tr>
                  )}
                </>
              )
            })}
          </Table>
        )}
        <Pager page={page} noun="invoices" />
      </SectionCard>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '16px' }}>
        <SectionCard title="This month by seller"
                     subtitle="You receive and pay one invoice; the marketplace settles each seller separately">
          <Table headers={['Seller', 'Lines', 'Monthly', 'Share']}>
            {bySeller(book.invoiceLines.filter(l => l.invoice_id === currentInvoice(book)?.id && l.kind === 'subscription')).map(r => (
              <tr key={r.seller}>
                <Td>{r.seller}</Td>
                <Td right>{r.lines}</Td>
                <Td right>{money(r.amount)}</Td>
                <Td right>{r.share}%</Td>
              </tr>
            ))}
          </Table>
        </SectionCard>

        <SectionCard title="This month by cost centre" subtitle="Where the recurring spend is attributed">
          <Table headers={['Cost centre', 'Monthly', 'Share']}>
            {byCostCentre(
              book.invoiceLines.filter(l => l.invoice_id === currentInvoice(book)?.id && l.kind === 'subscription'),
              book.centres,
            ).map(r => (
              <tr key={r.id}>
                <Td>{r.name}<div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>{r.id}</div></Td>
                <Td right>{money(r.amount)}</Td>
                <Td right>{r.share}%</Td>
              </tr>
            ))}
          </Table>
        </SectionCard>
      </div>

      <SectionCard title="What is renewing" subtitle="The next 90 days, and what happens if nothing is done">
        {renewingWithin(book.subscriptions, 90, TODAY).length === 0
          ? <EmptyState message="Nothing renews in the next 90 days" />
          : (
            <Table headers={['Service', 'Seller', 'Licensed', 'Assigned', 'Monthly', 'Renews', 'What happens']}>
              {renewingWithin(book.subscriptions, 90, TODAY).map(s => (
                <tr key={s.id}>
                  <Td><div style={{ fontWeight: 600 }}>{s.name}</div>
                      <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>{s.contract_ref}</div></Td>
                  <Td right style={{ fontSize: 'var(--text-xs)' }}>{s.seller}</Td>
                  <Td right>{fmtInt(s.quantity)}</Td>
                  <Td right>{fmtInt(s.seats_used)}</Td>
                  <Td right>{money(s.monthly)}</Td>
                  <Td right style={{ fontSize: 'var(--text-xs)' }}>{day(s.renews)}</Td>
                  <Td right style={{ fontSize: 'var(--text-xs)', maxWidth: '320px', textAlign: 'right' }}>
                    {s.status === 'suspended'
                      ? 'Does not renew — it ends on this date'
                      : s.auto_renew
                        ? `Renews automatically at ${money(s.monthly)} a month`
                        : 'Will lapse unless somebody renews it'}
                  </Td>
                </tr>
              ))}
            </Table>
          )}
      </SectionCard>

      <SectionCard title="Tax and registration" subtitle="What can be reclaimed, and what stops it">
        <div style={{ padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <Callout tone={tax.blocked ? 'danger' : 'success'}
                   title={tax.blocked ? 'Input tax cannot be reclaimed' : `${money(tax.reclaimable)} of input tax on these invoices`}>
            {tax.why}
          </Callout>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '14px' }}>
            <Fact label="Registration type" value={account.reg_type} />
            <Fact label="Registration number" value={account.registration ?? 'Not on file'} />
            <Fact label="Place of supply" value={account.place_of_supply} />
            <Fact label="Payment terms" value={account.terms} />
            <Fact label="Purchase order" value={account.po_required ? 'Required on every invoice' : 'Not required'} />
            <Fact label="Reverse charge" value={account.reverse_charge ? 'Applied where the rules allow' : 'Not applied'} />
            <Fact label="Cost centre breakdown" value={account.cost_centre_on_invoice ? 'Shown on the invoice' : 'Not shown'} />
            <Fact label="Legal entity" value={account.legal_name} />
          </div>
          <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', lineHeight: 1.6 }}>
            The invoice itself is the marketplace’s document and is not editable here — two parties holding
            different versions of the same legal record is worse than one of them finding it inconvenient. What
            this account controls is where it goes and how it is broken down.
          </div>
        </div>
      </SectionCard>

      {paying && <PayModal invoice={paying} onClose={() => setPaying(null)} onDone={async () => { setPaying(null); await reload() }} />}
      {disputing && <DisputeModal invoice={disputing} onClose={() => setDisputing(null)} onDone={async () => { setDisputing(null); await reload() }} />}
    </div>
  )
}

/* The invoice the monthly breakdowns describe: the newest recurring one. */
function currentInvoice(book: AccountBook): Invoice | undefined {
  return book.invoices.filter(i => i.kind === 'recurring')
    .sort((a, b) => b.issued.localeCompare(a.issued))[0]
}

function InvoiceDetail({ invoice, book }: { invoice: Invoice; book: AccountBook }) {
  /* The invoice's own currency rather than the account's. They agree — the
     guard sees to that — but a document is read in the money it was issued in,
     and a reprint of an old one must not follow the account somewhere else. */
  const { money } = useAccountMoney(invoice.currency)
  const lines = book.invoiceLines.filter(l => l.invoice_id === invoice.id)
  const check = reconcileInvoice(invoice, book.invoiceLines)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
      <div style={{ fontSize: 'var(--text-xs)', fontWeight: 700, color: 'var(--text-tertiary)' }}>
        {lines.length} LINES BEHIND {invoice.id}
      </div>
      <Table headers={['What', 'Seller', 'Cost centre', 'Qty', 'Unit', 'Amount']}>
        {lines.map(l => (
          <tr key={l.id}>
            <Td>
              {l.description}
              {l.requisition_id && <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}> · {l.requisition_id}</span>}
            </Td>
            <Td right style={{ fontSize: 'var(--text-xs)' }}>{l.seller}</Td>
            <Td right style={{ fontSize: 'var(--text-xs)' }}>
              {book.centres.find(c => c.id === l.cost_centre)?.name ?? 'Not allocated'}
            </Td>
            <Td right>{l.quantity === null ? '—' : fmtInt(l.quantity)}</Td>
            <Td right>{l.unit_price === null ? '—' : money(l.unit_price)}</Td>
            <Td right style={{ fontWeight: 600 }}>{money(l.amount)}</Td>
          </tr>
        ))}
      </Table>
      <div style={{ fontSize: 'var(--text-xs)', color: check.ok ? 'var(--success)' : 'var(--danger)', fontWeight: 600 }}>
        {check.ok
          ? `Checks out — ${check.note}, totalling ${money(invoice.total)}.`
          : check.reason}
      </div>
      {invoice.po_ref && (
        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>Against purchase order {invoice.po_ref}.</div>
      )}
    </div>
  )
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>{label}</div>
      <div style={{ fontSize: 'var(--text-sm)', fontWeight: 600 }}>{value}</div>
    </div>
  )
}

function PayModal({ invoice, onClose, onDone }: {
  invoice: Invoice; onClose: () => void; onDone: () => Promise<void>
}) {
  const { money } = useAccountMoney(invoice.currency)
  const [busy, setBusy] = useState(false)
  const submit = async () => {
    setBusy(true)
    const res = await payInvoice(invoice)
    setBusy(false)
    toast(res.ok ? res.note ?? 'Paid' : res.reason, res.ok ? 'success' : 'error')
    if (res.ok) await onDone()
  }
  return (
    <Modal open onClose={onClose} title={`Pay ${invoice.id}`}
      footer={<>
        <Btn variant="secondary" size="sm" onClick={onClose}>Cancel</Btn>
        <Btn size="sm" onClick={submit} disabled={busy}>{busy ? 'Paying…' : `Pay ${money(invoice.total)}`}</Btn>
      </>}>
      <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
        {money(invoice.total)} against {invoice.id} for {invoice.period}, from the account on file. Remittance
        advice follows to the finance address.
      </p>
      {invoice.status === 'overdue' && (
        <Callout tone="info" title="This clears the arrears">
          Paying it lifts anything that was restricted immediately — new orders resume across every seller on
          the account.
        </Callout>
      )}
    </Modal>
  )
}

function DisputeModal({ invoice, onClose, onDone }: {
  invoice: Invoice; onClose: () => void; onDone: () => Promise<void>
}) {
  const [why, setWhy] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async () => {
    setBusy(true)
    const res = await disputeInvoice(invoice, why)
    setBusy(false)
    toast(res.ok ? res.note ?? 'Raised' : res.reason, res.ok ? 'success' : 'error')
    if (res.ok) await onDone()
  }
  return (
    <Modal open onClose={onClose} title={`Query ${invoice.id}`}
      footer={<>
        <Btn variant="secondary" size="sm" onClick={onClose}>Cancel</Btn>
        <Btn size="sm" onClick={submit} disabled={busy}>{busy ? 'Raising…' : 'Raise the query'}</Btn>
      </>}>
      <FormField label="What is wrong with it" required
                 hint="Name the line if you can — a query with no reason cannot be investigated">
        <TextArea rows={4} value={why} onChange={e => setWhy(e.target.value)}
                  placeholder="e.g. the Sentinel MDR line bills 250 endpoints and we reduced to 220 in June" />
      </FormField>
      <Callout tone="info" title="The balance stands while it is open">
        Nothing is suspended and no reminder goes out on a queried invoice, but it is not treated as paid
        either. If the query is about something that was delivered and then went wrong, a refund against the
        order is the faster route.
      </Callout>
    </Modal>
  )
}

export { Wallet, Receipt, AlertTriangle, Building2 }
