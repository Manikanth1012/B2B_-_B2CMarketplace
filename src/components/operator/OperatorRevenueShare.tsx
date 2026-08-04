import { useState, useEffect, useCallback } from 'react'
import { Pager, usePaging } from '../Pager'
import { CircleCheck as CheckCircle, TriangleAlert as AlertTriangle, Download } from 'lucide-react'
import {
  SectionCard, StatCard, Btn, Select, Table, Td, toast, fmtMoney, fmtInt,
} from './shared'
import { Callout } from '../OnboardingJourney'
import { loadLedger } from '../../lib/ledgerRepo'
import type { LedgerBook } from '../../lib/ledgerRepo'
import {
  revenueSplit, shareBySeller, reconciliations, reconcileStatement,
  periodIdOf, openPeriod, toCsv,
} from '../../lib/ledger'
import type { Reconciliation } from '../../lib/ledger'

/* How one period's gross divides, and the proof that both sides agree on it.
 *
 * Four parties have a claim on the same money: the seller who sold it, the
 * marketplace that took a commission, the tax authority, and the buyer who got
 * some of it back. Any screen that shows only two of them is a screen somebody
 * will argue with.
 *
 * The reconciliations are the point. A settlement figure nobody can trace to
 * order lines is a figure a seller has to take on trust, and a marketplace that
 * asks sellers to take money on trust is one that spends its week on disputes.
 */

export function OperatorRevenueShare() {
  const [book, setBook] = useState<LedgerBook | null>(null)
  const [period, setPeriod] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)

  const reload = useCallback(async () => setBook(await loadLedger()), [])
  useEffect(() => { void reload() }, [reload])

  /* The period being read has to be worked out above the loading guard, because
     what is on the page depends on it and `usePaging` is a hook — below an early
     return it runs on some renders and not others. */
  const open = book ? openPeriod(book.periods) : null
  const viewing = period ?? open?.id ?? book?.periods[book.periods.length - 1]?.id ?? null
  const current = book?.periods.find(p => p.id === viewing) ?? null

  const statements = (book?.statements ?? []).filter(s => periodIdOf(s.period) === viewing)
  const ids = new Set(statements.map(s => s.id))
  const lines = (book?.lines ?? []).filter(l => ids.has(l.statement_id))

  /* Reset to page 1 when the period changes: leaving somebody on page 4 of a
     period with two sellers shows them an empty table and no reason for it. */
  const sellersPage = usePaging(shareBySeller(lines, statements), { resetKey: viewing ?? '' })

  if (!book) return <div style={{ textAlign: 'center', padding: '40px' }}><div className="spinner" style={{ margin: '0 auto' }} /></div>
  const split = revenueSplit(lines, statements)
  const sellers = shareBySeller(lines, statements)
  const checks = current
    ? reconciliations({ postings: book.postings, accounts: book.accounts,
                        statements: book.statements, lines: book.lines, period: current })
    : []

  const download = () => {
    const rows: string[][] = [[
      'seller_id', 'seller', 'statement', 'period', 'orders', 'gross', 'commission',
      'commission_rate', 'fees', 'refunds', 'withholding', 'net', 'status',
    ]]
    for (const s of statements) {
      rows.push([s.partner_id ?? '', s.partner_name, s.id, s.period, String(s.order_count),
        Number(s.gross).toFixed(2), Number(s.commission).toFixed(2), String(s.commission_rate),
        Number(s.fees).toFixed(2), Number(s.refunds).toFixed(2),
        Number(s.withholding).toFixed(2), Number(s.net).toFixed(2), s.status])
    }
    const blob = new Blob([toCsv(rows)], { type: 'text/csv' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `revenue-share-${viewing}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
    toast(`${statements.length} statements exported`)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '16px', flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontSize: 'var(--text-2xl)', fontWeight: 800, color: 'var(--text)' }}>Revenue share</h1>
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)', marginTop: '4px' }}>
            How the period’s gross divides between the sellers, the marketplace and the authority — and the
            proof that both sides agree on it.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <Select value={viewing ?? ''} onChange={e => setPeriod(e.target.value)} style={{ width: 'auto' }}>
            {book.periods.map(p => (
              <option key={p.id} value={p.id}>{p.label}{p.status === 'open' ? ' — open' : ''}</option>
            ))}
          </Select>
          <Btn variant="secondary" onClick={download}><Download size={14} /> Export</Btn>
        </div>
      </div>

      {book.loadError && <Callout tone="danger" title="Some of this did not load">{book.loadError}</Callout>}

      <div className="stat-row">
        <StatCard label="Gross through the platform" value={`$${fmtMoney(split.gross)}`}
                  sublabel={`${statements.length} statements · ${fmtInt(lines.length)} order lines`} />
        <StatCard label="Sellers keep" value={`$${fmtMoney(split.sellerNet)}`}
                  sublabel="After commission, fees, refunds and withholding" />
        <StatCard label="The marketplace keeps" value={`$${fmtMoney(split.marketplace)}`}
                  sublabel={split.effectiveRate === null ? 'Nothing yet' : `${split.effectiveRate}% of gross, commission and fees`}
                  color="var(--success)" />
        <StatCard label="Collected for the authority" value={`$${fmtMoney(split.tax + split.withholding)}`}
                  sublabel={`$${fmtMoney(split.tax)} output tax · $${fmtMoney(split.withholding)} withheld`} />
      </div>

      {split.gross > 0 && (
        <SectionCard title="Where the gross went" subtitle="Every claim on the same money, at once">
          <div style={{ padding: '20px' }}>
            <div style={{ display: 'flex', height: '34px', borderRadius: 'var(--radius)', overflow: 'hidden', marginBottom: '14px' }}>
              <Band width={split.sellerNet / split.gross} colour="var(--brand-navy)"
                    label={`Sellers $${fmtMoney(split.sellerNet)}`} />
              <Band width={split.commission / split.gross} colour="#5E4B9B" label="Commission" />
              <Band width={split.fees / split.gross} colour="#8B76C9" label="Fees" />
              <Band width={split.tax / split.gross} colour="#B8A4E8" label="Tax" />
              <Band width={(split.refunds + split.withholding) / split.gross} colour="#D9CCF2" label="" />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: '12px' }}>
              <Fact label="Gross order value" value={`$${fmtMoney(split.gross)}`} />
              <Fact label="less output tax" value={`$${fmtMoney(split.tax)}`}
                    sub="Collected on the authority’s behalf. Never anybody’s revenue." />
              <Fact label="less commission" value={`$${fmtMoney(split.commission)}`}
                    sub="The only line that is genuinely the marketplace’s income." />
              <Fact label="less fees" value={`$${fmtMoney(split.fees)}`} />
              <Fact label="less refunds" value={`$${fmtMoney(split.refunds)}`}
                    sub="Borne by the seller whose sale it was." />
              <Fact label="less withholding" value={`$${fmtMoney(split.withholding)}`}
                    sub="Deducted at source and paid to the authority." />
            </div>
          </div>
        </SectionCard>
      )}

      <SectionCard title={`Reconciliation — ${current?.label ?? ''}`}
                   subtitle="Three checks, cheapest first. The last is the one a seller can run themselves.">
        <div style={{ padding: '8px 20px 16px' }}>
          {checks.map(c => <Check key={c.id} check={c} />)}
        </div>
      </SectionCard>

      <SectionCard title="Share by seller"
                   subtitle="Commission charged beside the rate their plan carries — a gap between those two is the commonest settlement dispute. Fees sit in their own column because they are a separate charge.">
        <><Table headers={['Seller', 'Orders', 'Gross', 'Commission', 'Fees',
                       'Commission %', 'Plan %', 'With fees', 'They keep', '']}>
          {sellersPage.rows.map(s => {
            const key = s.partner_id ?? 'first-party'
            /* Commission against the plan rate, like for like. Fees are shown
               in their own column and always push the total take above the
               plan, so folding them in would flag everybody. */
            const mismatch = s.planRate !== null && s.effectiveRate !== null
              && Math.abs(s.effectiveRate - s.planRate) > 1
            return (
              <>
                <tr key={key}>
                  <Td>
                    <div style={{ fontWeight: 600 }}>{s.partner_name}</div>
                    <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
                      {s.partner_id ?? 'The marketplace’s own'}
                    </div>
                  </Td>
                  <Td right>{fmtInt(s.orders)}</Td>
                  <Td right>${fmtMoney(s.gross)}</Td>
                  <Td right>${fmtMoney(s.commission)}</Td>
                  <Td right>${fmtMoney(s.fees)}</Td>
                  <Td right style={{ color: mismatch ? 'var(--warning)' : undefined, fontWeight: mismatch ? 700 : 400 }}>
                    {s.effectiveRate === null ? '—' : `${s.effectiveRate}%`}
                  </Td>
                  <Td right>{s.planRate === null ? '—' : `${s.planRate}%`}</Td>
                  <Td right style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
                    {s.totalTake === null ? '—' : `${s.totalTake}%`}
                  </Td>
                  <Td right><strong>${fmtMoney(s.net)}</strong></Td>
                  <Td right>
                    <Btn variant="secondary" size="sm"
                         onClick={() => setExpanded(expanded === key ? null : key)}>
                      {expanded === key ? 'Hide lines' : 'Lines'}
                    </Btn>
                  </Td>
                </tr>
                {expanded === key && (
                  <tr key={`${key}-lines`}>
                    <Td style={{ padding: 0 }}>
                      <div style={{ padding: '4px 0 14px' }}>
                        {statements.filter(x => (x.partner_id ?? 'first-party') === key).map(x => (
                          <StatementLines key={x.id} statement={x} book={book} />
                        ))}
                      </div>
                    </Td>
                  </tr>
                )}
              </>
            )
          })}
        </Table>
        <div style={{ padding: '0 18px 12px' }}><Pager page={sellersPage} noun="sellers" /></div></>
      </SectionCard>
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
    }}>{pct > 8 ? label : ''}</div>
  )
}

function Fact({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>{label}</div>
      <div style={{ fontSize: 'var(--text-sm)', fontWeight: 700 }}>{value}</div>
      {sub && <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', marginTop: '2px', lineHeight: 1.5 }}>{sub}</div>}
    </div>
  )
}

function Check({ check }: { check: Reconciliation }) {
  return (
    <div style={{ display: 'flex', gap: '11px', alignItems: 'flex-start', padding: '12px 0', borderBottom: '1px solid var(--border-light)' }}>
      {check.ok
        ? <CheckCircle size={17} style={{ color: 'var(--success)', flexShrink: 0, marginTop: '2px' }} />
        : <AlertTriangle size={17} style={{ color: 'var(--danger)', flexShrink: 0, marginTop: '2px' }} />}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 'var(--text-sm)', fontWeight: 700 }}>{check.name}</div>
        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', lineHeight: 1.5 }}>{check.proves}</div>
        {!check.ok && (
          <div style={{ marginTop: '7px' }}>
            {check.variances.map((v, i) => (
              <div key={i} style={{ fontSize: 'var(--text-xs)', color: 'var(--danger)' }}>
                {v.what}: expected ${fmtMoney(v.expected)}, found ${fmtMoney(v.found)} — out by ${fmtMoney(v.difference)}.
              </div>
            ))}
            <div style={{ fontSize: 'var(--text-xs)', marginTop: '4px', fontWeight: 600 }}>{check.remedy}</div>
          </div>
        )}
      </div>
    </div>
  )
}

/* The line detail behind one statement, and whether it adds up. Shown here as
   well as on the seller's own page on purpose: a reconciliation both sides read
   from the same rows is the only kind that settles an argument. */
export function StatementLines({ statement, book }: {
  statement: LedgerBook['statements'][number]; book: LedgerBook
}) {
  const lines = book.lines.filter(l => l.statement_id === statement.id)
  const check = reconcileStatement(statement, lines)

  return (
    <div style={{ border: '1px solid var(--border-light)', borderRadius: 'var(--radius-md)', margin: '0 20px 10px', overflow: 'hidden' }}>
      <div style={{
        padding: '10px 14px', background: check.ok ? 'var(--success-bg)' : 'var(--danger-bg)',
        fontSize: 'var(--text-xs)', fontWeight: 700,
        color: check.ok ? 'var(--success)' : 'var(--danger)',
      }}>
        {statement.id} · {statement.period} · {check.ok
          ? `reconciles to ${lines.length} order line${lines.length === 1 ? '' : 's'}`
          : `does not reconcile — ${check.variances.map(v => v.what).join(', ')}`}
      </div>
      <Table headers={['Order', 'Product', 'Qty', 'Gross', 'Tax', 'Commission', 'Fees', 'Refunds', 'Net']}>
        {lines.map(l => (
          <tr key={l.id}>
            <Td style={{ fontSize: 'var(--text-xs)' }}>{l.order_ref}</Td>
            <Td style={{ fontSize: 'var(--text-xs)' }}>
              {l.product_name}
              <div style={{ color: 'var(--text-tertiary)' }}>{l.product_id}</div>
            </Td>
            <Td right>{fmtInt(l.quantity)}</Td>
            <Td right>${fmtMoney(Number(l.gross))}</Td>
            <Td right>${fmtMoney(Number(l.tax))}</Td>
            <Td right>${fmtMoney(Number(l.commission))}</Td>
            <Td right>${fmtMoney(Number(l.fees))}</Td>
            <Td right>{Number(l.refunds) ? `$${fmtMoney(Number(l.refunds))}` : '—'}</Td>
            <Td right><strong>${fmtMoney(Number(l.net))}</strong></Td>
          </tr>
        ))}
        <tr style={{ borderTop: '2px solid var(--border)' }}>
          <Td><strong>Statement</strong></Td>
          <Td>{''}</Td>
          <Td right><strong>{fmtInt(statement.order_count)}</strong></Td>
          <Td right><strong>${fmtMoney(Number(statement.gross))}</strong></Td>
          <Td>{''}</Td>
          <Td right><strong>${fmtMoney(Number(statement.commission))}</strong></Td>
          <Td right><strong>${fmtMoney(Number(statement.fees))}</strong></Td>
          <Td right><strong>{Number(statement.refunds) ? `$${fmtMoney(Number(statement.refunds))}` : '—'}</strong></Td>
          <Td right><strong>${fmtMoney(Number(statement.net))}</strong></Td>
        </tr>
      </Table>
      {Number(statement.withholding) > 0 && (
        <div style={{ padding: '8px 14px', fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
          Lines total ${fmtMoney(lines.reduce((a, l) => a + Number(l.net), 0))} before ${fmtMoney(Number(statement.withholding))}{' '}
          withheld at source, which is a statement-level deduction rather than a line one.
        </div>
      )}
    </div>
  )
}
