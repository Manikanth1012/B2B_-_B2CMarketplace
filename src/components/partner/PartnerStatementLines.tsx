import { useState, useEffect, useCallback } from 'react'
import { Pager, usePaging } from '../Pager'
import { CircleCheck as CheckCircle, TriangleAlert as AlertTriangle, Download } from 'lucide-react'
import { SectionCard, Table, Td, Btn, toast, fmtMoney, fmtInt } from '../operator/shared'
import { Callout } from '../OnboardingJourney'
import { loadSellerStatements } from '../../lib/ledgerRepo'
import type { SellerStatements } from '../../lib/ledgerRepo'
import { reconcileStatement, revenueSplit, toCsv } from '../../lib/ledger'
import type { Statement } from '../../lib/ledger'

/* The seller's half of the reconciliation.
 *
 * "Your statement reconciles to your order lines" was a claim on a screen. It
 * is now a sum: the same rows the marketplace reads, under the seller's own
 * row-level security, with every deduction named and the arithmetic shown. A
 * seller who cannot check a deduction has to take it on trust, and a
 * marketplace that asks sellers to take money on trust spends its week on
 * disputes.
 */

export function PartnerStatementLines({ partnerId }: { partnerId: string }) {
  const [snap, setSnap] = useState<SellerStatements | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)

  const reload = useCallback(async () => setSnap(await loadSellerStatements(partnerId)), [partnerId])
  useEffect(() => { void reload() }, [reload])

  /* Above the loading guard, and above the "no statements yet" one: `usePaging`
     is a hook, and a hook after an early return runs on some renders and not
     others. */
  const showingId = openId ?? snap?.statements[0]?.id ?? null
  const linesPage = usePaging(
    (snap?.lines ?? []).filter(l => l.statement_id === showingId),
    { resetKey: showingId ?? '' },
  )

  if (!snap) return <div style={{ textAlign: 'center', padding: '30px' }}><div className="spinner" style={{ margin: '0 auto' }} /></div>

  if (snap.statements.length === 0) {
    return (
      <SectionCard title="How it reconciles">
        <div style={{ padding: '20px', fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)' }}>
          No statement has been raised against this account yet. When one is, every figure on it appears here
          with the order lines behind it.
        </div>
      </SectionCard>
    )
  }

  const showing = openId ?? snap.statements[0].id
  const statement = snap.statements.find(s => s.id === showing)!
  const lines = snap.lines.filter(l => l.statement_id === statement.id)
  const check = reconcileStatement(statement, lines)
  const split = revenueSplit(lines, [statement])
  const failing = snap.statements.filter(s =>
    !reconcileStatement(s, snap.lines.filter(l => l.statement_id === s.id)).ok)

  const download = () => {
    const rows: string[][] = [[
      'statement', 'period', 'order', 'product_id', 'product', 'quantity',
      'gross', 'tax', 'commission_rate', 'commission', 'fees', 'refunds', 'net',
    ]]
    for (const l of snap.lines) {
      const s = snap.statements.find(x => x.id === l.statement_id)
      rows.push([l.statement_id, s?.period ?? '', l.order_ref, l.product_id, l.product_name,
        String(l.quantity), Number(l.gross).toFixed(2), Number(l.tax).toFixed(2),
        String(l.commission_rate), Number(l.commission).toFixed(2), Number(l.fees).toFixed(2),
        Number(l.refunds).toFixed(2), Number(l.net).toFixed(2)])
    }
    const blob = new Blob([toCsv(rows)], { type: 'text/csv' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `settlement-lines-${partnerId}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
    toast(`${snap.lines.length} lines exported — finance reconciles from a file, not a screen`)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {snap.loadError && <Callout tone="danger" title="Some of this did not load">{snap.loadError}</Callout>}

      {failing.length > 0 && (
        <Callout tone="danger" title={`${failing.length} statement${failing.length === 1 ? ' does' : 's do'} not equal the lines behind ${failing.length === 1 ? 'it' : 'them'}`}>
          Do not accept these. A statement that does not reconcile is not payable, and the marketplace should
          hold the run until the missing orders are found. Raise it from Disputes and support.
        </Callout>
      )}

      <SectionCard
        title="How it reconciles"
        subtitle="The same rows the marketplace reads. Every figure on the statement is the sum of the lines below it."
        action={<Btn variant="secondary" size="sm" onClick={download}><Download size={12} /> Export lines</Btn>}
      >
        <div style={{ padding: '14px 20px', display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
          {snap.statements.map(s => (
            <button key={s.id} onClick={() => setOpenId(s.id)} style={{
              padding: '6px 13px', borderRadius: 'var(--radius)', cursor: 'pointer',
              fontSize: 'var(--text-xs)', fontWeight: 600, border: '1px solid var(--border)',
              background: s.id === showing ? 'var(--brand-navy)' : 'white',
              color: s.id === showing ? 'white' : 'var(--text-secondary)',
            }}>{s.period}</button>
          ))}
        </div>

        <div style={{
          margin: '0 20px 14px', padding: '11px 14px', borderRadius: 'var(--radius)',
          display: 'flex', gap: '10px', alignItems: 'flex-start',
          background: check.ok ? 'var(--success-bg)' : 'var(--danger-bg)',
        }}>
          {check.ok
            ? <CheckCircle size={16} style={{ color: 'var(--success)', flexShrink: 0, marginTop: '2px' }} />
            : <AlertTriangle size={16} style={{ color: 'var(--danger)', flexShrink: 0, marginTop: '2px' }} />}
          <div style={{ fontSize: 'var(--text-sm)', lineHeight: 1.5 }}>
            {check.ok ? (
              <>
                <strong>{statement.id} reconciles.</strong> ${fmtMoney(Number(statement.gross))} of gross
                across {lines.length} order line{lines.length === 1 ? '' : 's'}, less
                ${fmtMoney(Number(statement.commission))} commission at {statement.commission_rate}%,
                ${fmtMoney(Number(statement.fees))} of fees
                {Number(statement.refunds) > 0 ? ` and $${fmtMoney(Number(statement.refunds))} of refunds` : ''}
                {Number(statement.withholding) > 0 ? `, less $${fmtMoney(Number(statement.withholding))} withheld at source` : ''}
                {' '}= <strong>${fmtMoney(Number(statement.net))}</strong> to you.
              </>
            ) : (
              <>
                <strong>{statement.id} does not reconcile.</strong>{' '}
                {check.variances.map(v => `${v.what} is out by $${fmtMoney(v.difference)}`).join('; ')}.
                {' '}{check.remedy}
              </>
            )}
          </div>
        </div>

        <><Table headers={['Order', 'Product', 'Qty', 'Gross', 'Tax', 'Commission', 'Fees', 'Refunds', 'Yours']}>
          {linesPage.rows.map(l => (
            <tr key={l.id}>
              <Td style={{ fontSize: 'var(--text-xs)' }}>{l.order_ref}</Td>
              <Td style={{ fontSize: 'var(--text-xs)' }}>
                {l.product_name}
                <div style={{ color: 'var(--text-tertiary)' }}>{l.product_id}</div>
              </Td>
              <Td right>{fmtInt(l.quantity)}</Td>
              <Td right>${fmtMoney(Number(l.gross))}</Td>
              <Td right>${fmtMoney(Number(l.tax))}</Td>
              <Td right>
                ${fmtMoney(Number(l.commission))}
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>at {l.commission_rate}%</div>
              </Td>
              <Td right>${fmtMoney(Number(l.fees))}</Td>
              <Td right>{Number(l.refunds) ? `$${fmtMoney(Number(l.refunds))}` : '—'}</Td>
              <Td right><strong>${fmtMoney(Number(l.net))}</strong></Td>
            </tr>
          ))}
          <tr style={{ borderTop: '2px solid var(--border)' }}>
            <Td><strong>Your statement</strong></Td>
            <Td style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>{statement.id}</Td>
            <Td right><strong>{fmtInt(statement.order_count)}</strong></Td>
            <Td right><strong>${fmtMoney(Number(statement.gross))}</strong></Td>
            <Td right><strong>${fmtMoney(split.tax)}</strong></Td>
            <Td right><strong>${fmtMoney(Number(statement.commission))}</strong></Td>
            <Td right><strong>${fmtMoney(Number(statement.fees))}</strong></Td>
            <Td right><strong>{Number(statement.refunds) ? `$${fmtMoney(Number(statement.refunds))}` : '—'}</strong></Td>
            <Td right><strong>${fmtMoney(Number(statement.net))}</strong></Td>
          </tr>
        </Table>
        <div style={{ padding: '0 18px 12px' }}><Pager page={linesPage} noun="lines" /></div></>

        <div style={{ padding: '14px 20px', fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', lineHeight: 1.7 }}>
          Tax is shown so you can see what of the gross was never yours or ours — it is collected on the
          authority’s behalf and does not change your share.
          {/* Two things sit between the lines and the payout, and both are at
              statement level. Naming only withholding left the arithmetic short
              by exactly the note, which reads to a seller as a statement that
              does not add up. */}
          {(Number(statement.withholding) > 0 || Number(statement.adjustments ?? 0) !== 0) && (
            <> The lines total ${fmtMoney(lines.reduce((a, l) => a + Number(l.net), 0))} and the payout is{' '}
            ${fmtMoney(Number(statement.net))}, because
            {Number(statement.withholding) > 0 && (
              <> withholding of ${fmtMoney(Number(statement.withholding))} is deducted at statement level
              rather than per line</>
            )}
            {Number(statement.withholding) > 0 && Number(statement.adjustments ?? 0) !== 0 && <>, and</>}
            {Number(statement.adjustments ?? 0) !== 0 && (
              <> {Number(statement.adjustments) > 0 ? 'a credit' : 'a debit'} of{' '}
              ${fmtMoney(Math.abs(Number(statement.adjustments)))} was applied by note — an adjustment that
              is not about any one sale, so it belongs to no line</>
            )}.</>
          )}
        </div>
      </SectionCard>
    </div>
  )
}

export type { Statement }
