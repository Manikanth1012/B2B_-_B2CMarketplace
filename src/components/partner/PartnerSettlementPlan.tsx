import { useState, useEffect } from 'react'
import { Download } from 'lucide-react'
import {
  StatCard, SectionCard, Table, Td, StatusPill, fmtMoney, Btn, EmptyState, toast,
  Modal, FormField, TextArea,
} from '../operator/shared'
import { Callout } from '../OnboardingJourney'
import { loadSellerRecord } from '../../lib/partnerRepo'
import type { SellerRecord } from '../../lib/partnerRepo'
import { rateAt, nextTier, planSchedule } from '../../lib/partnerCommerce'
import { toCsv } from '../../lib/ledger'
import { saveBlob } from '../../lib/billPdf'
import { loadSupport, raiseTicket } from '../../lib/supportRepo'
import { attachFile } from '../../lib/attachmentRepo'
import { AttachmentPicker } from '../AttachmentPicker'
import { PARTNER_ORDERS } from './data'

/* Reads the plan the seller actually settles on. The hard-coded one quoted a
   12% base against CP-IOT-STD, which settles at 11% — a number a seller reads
   and plans against has to be the number they are paid on. */
export function PartnerSettlementPlan({ partnerId }: { partnerId: string }) {
  const [rec, setRec] = useState<SellerRecord | null>(null)
  const [loading, setLoading] = useState(true)
  const [asking, setAsking] = useState(false)
  const [why, setWhy] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [sending, setSending] = useState(false)

  useEffect(() => {
    loadSellerRecord(partnerId).then(r => { setRec(r); setLoading(false) })
  }, [partnerId])

  if (loading) {
    return <div style={{ textAlign: 'center', padding: '40px' }}><div className="spinner" style={{ margin: '0 auto' }} /></div>
  }

  const plan = rec?.plan ?? null

  if (!plan) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        <h1 style={{ fontSize: 'var(--text-2xl)', fontWeight: 800, color: 'var(--text)' }}>Settlement plan</h1>
        {rec?.loadError
          ? <Callout tone="danger" title="This did not load">{rec.loadError}</Callout>
          : <Callout tone="warning" title="No plan is assigned yet">
              A commission schedule is counter-signed at the agreements gate, and nothing settles without one.
              Your onboarding page shows which gate you are on.
            </Callout>}
      </div>
    )
  }

  /* Trailing gross from the seller's own orders. The tiers below are read
     against this figure, so the "you are here" row is derived rather than
     asserted. */
  const gmv = PARTNER_ORDERS.reduce((a, o) => a + o.gross, 0)
  const rate = rateAt(plan, gmv)
  const ahead = nextTier(plan, gmv)

  /* The ladder, the terms, and where this seller stands on it — as a file their
     own finance team can open. "Download schedule" used to raise a toast saying
     the schedule had been downloaded, which is the one thing it had not done. */
  const download = () => {
    saveBlob(
      new Blob([toCsv(planSchedule(plan, gmv))], { type: 'text/csv' }),
      `settlement-plan-${plan.id}.csv`,
    )
    toast(`${plan.id} downloaded — ${plan.tiers.length} tiers and the terms behind them`)
  }

  /* What the request says if the seller writes nothing else. A review the desk
     cannot price is a review that comes back asking for these three numbers. */
  const defaultCase = ahead
    ? `Trailing twelve-month gross is $${fmtMoney(gmv)} against ${plan.id}, settling at ${rate}%. `
      + `The next tier is ${ahead.tier.rate}% at $${fmtMoney(ahead.tier.from)}, which is $${fmtMoney(ahead.toGo)} away. `
      + `Asking for the ladder to be looked at ahead of that.`
    : `Trailing twelve-month gross is $${fmtMoney(gmv)} against ${plan.id}, settling at ${rate}% — `
      + `the top of the published ladder. Asking whether anything sits above it.`

  const ask = async () => {
    setSending(true)
    const book = await loadSupport()
    const r = await raiseTicket({
      draft: {
        subject: `Tier review — ${plan.id} at ${rate}%`,
        category: 'contract',
        note: why,
        /* The plan is the reference. A ticket about a commission ladder that
           does not say which ladder is a ticket somebody has to ask about. */
        ref: plan.id,
      },
      book,
      persona: 'partner',
      raisedBy: rec?.partner?.name ?? 'The seller',
      org: rec?.partner?.name ?? '',
      partnerId,
      channel: 'console',
    })
    if (!r.ok) { setSending(false); toast(r.reason, 'error'); return }

    /* The ticket carries the id the files hang off, so they go up after it. */
    const failed: string[] = []
    for (const f of files) {
      const up = await attachFile({ ticketId: r.ticket_id, file: f })
      if (!up.ok) failed.push(f.name)
    }
    setSending(false)
    setAsking(false)
    setFiles([])
    toast(failed.length
      ? `Raised, but ${failed.length} file${failed.length === 1 ? '' : 's'} did not upload — reply on the ticket to send ${failed.length === 1 ? 'it' : 'them'} again.`
      : r.note ?? 'Raised — it is in the marketplace queue with your other requests.',
      failed.length ? 'info' : 'success')
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '16px', flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontSize: 'var(--text-2xl)', fontWeight: 800, color: 'var(--text)' }}>Settlement plan</h1>
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)', marginTop: '4px' }}>
            {plan.name} · {plan.model} · applies to every listing you sell
          </p>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <Btn variant="secondary" onClick={download}><Download size={14} /> Download schedule</Btn>
          <Btn variant="primary" onClick={() => { setWhy(defaultCase); setAsking(true) }}>Request a tier review</Btn>
        </div>
      </div>

      <Callout tone="info">
        Commission is set by your plan, not by individual listings. Tiers apply to trailing twelve-month
        gross value and are recalculated on the first of each month.
        {ahead && ` At $${fmtMoney(ahead.toGo)} more you move to ${ahead.tier.rate}%.`}
      </Callout>

      <div className="stat-row">
        <StatCard label="Current rate" value={`${rate}%`} sublabel={plan.model} />
        <StatCard label="Trailing gross" value={`$${fmtMoney(gmv)}`} sublabel="Rolling 12 months" color="var(--brand-navy)" />
        <StatCard label="Payout cycle" value={plan.cycle.split(',')[0]} sublabel={plan.cycle.split(',')[1] || ''} />
        <StatCard label="Holdback" value={plan.hold === 'None' ? 'None' : plan.hold.split('(')[0]} sublabel="Protects against returns" />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '20px' }} className="op-grid-2col">
        <SectionCard title="Commission tiers" subtitle="Trailing 12-month gross value determines your rate">
          {plan.tiers.length === 0 ? <EmptyState message="This plan has a single flat rate" /> : (
            <Table headers={['Trailing 12-month gross', 'Commission', 'You keep', 'State']}>
              {plan.tiers.map((t, i) => {
                const next = plan.tiers[i + 1]
                const active = gmv >= t.from && (!next || gmv < next.from)
                return (
                  <tr key={t.from} style={active ? { background: 'var(--bg-alt)' } : undefined}>
                    <Td>
                      {t.from === 0 ? `Up to $${fmtMoney(next ? next.from : 0)}`
                        : next ? `$${fmtMoney(t.from)} to $${fmtMoney(next.from)}`
                        : `Above $${fmtMoney(t.from)}`}
                    </Td>
                    <Td right>{t.rate}%</Td>
                    <Td right>{(100 - t.rate).toFixed(1)}%</Td>
                    <Td right>
                      {active ? <StatusPill status="active" />
                        : gmv >= t.from ? <StatusPill status="cleared" />
                        : <StatusPill status="draft" />}
                    </Td>
                  </tr>
                )
              })}
            </Table>
          )}
        </SectionCard>

        <SectionCard title="Plan terms" subtitle={plan.id}>
          <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '8px', fontSize: 'var(--text-sm)' }}>
            <TermRow label="Plan" value={plan.id} />
            <TermRow label="Model" value={plan.model} />
            <TermRow label="Opening rate" value={`${plan.base_rate}%`} />
            <TermRow label="Fees" value={plan.fees} />
            <TermRow label="Cycle" value={plan.cycle} />
            <TermRow label="Holdback" value={plan.hold} />
            <TermRow label="Currency" value="USD — settled in USD" />
            <TermRow label="Withholding" value="Treaty rate applied while your tax certificate is valid" />
          </div>
        </SectionCard>
      </div>

      <Modal
        open={asking}
        onClose={() => setAsking(false)}
        title="Request a tier review"
        footer={
          <div style={{ display: 'flex', gap: '8px' }}>
            <Btn variant="secondary" onClick={() => setAsking(false)}>Cancel</Btn>
            <Btn variant="primary" disabled={sending} onClick={() => void ask()}>
              {sending ? 'Sending…' : 'Send it'}
            </Btn>
          </div>
        }>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <Callout tone="info">
            This goes to the marketplace's contract desk as a ticket under <strong>{plan.id}</strong>, and you
            will find it in Support alongside everything else you have raised. Tiers are recalculated
            automatically on the first of each month — a review is for the case where the published ladder is
            not the right ladder for your business.
          </Callout>

          <FormField label="Why you are asking" required
                     hint="Prefilled with your position on the ladder. Add anything the desk would otherwise have to come back for — a contract you are bidding, volume you expect, a competitor's terms.">
            <TextArea rows={6} value={why} onChange={e => setWhy(e.target.value)} />
          </FormField>

          {/* A tier review is argued from documents — the contract being bid,
              the volume forecast, the competitor's rate card. Without this the
              seller could only describe them and the desk had to write back
              asking for the thing itself. */}
          <AttachmentPicker
            files={files}
            onChange={setFiles}
            disabled={sending}
            label="Attach anything that makes the case"
            hint="A contract, a forecast, a rate card. Photos, PDFs and text logs, up to 10 MB each."
            onError={reason => reason && toast(reason, 'error')}
          />
        </div>
      </Modal>
    </div>
  )
}

function TermRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
      <span style={{ color: 'var(--text-tertiary)' }}>{label}</span>
      <span style={{ fontWeight: 600, textAlign: 'right', maxWidth: '60%' }}>{value}</span>
    </div>
  )
}
