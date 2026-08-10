import { useState, useEffect, useCallback, useMemo } from 'react'
import { RefreshCw, PhoneCall, Play, Store, Landmark } from 'lucide-react'
import { Pager, usePaging } from '../Pager'
import {
  StatCard, SectionCard, Table, Td, StatusPill, Btn, EmptyState, Modal, FormField,
  TextInput, fmtInt, fmtDate, toast,
} from './shared'
import { Callout } from '../OnboardingJourney'
import { useMarket } from '../../lib/MarketContext'
import { loadRenewalDesk, reportRenewal, runRenewals } from '../../lib/renewalsRepo'
import type { RenewalDesk, RunResult, WatchRow } from '../../lib/renewalsRepo'
import { plan, ownedByMarketplace } from '../../lib/renewals'

/* Renewals, and the half of them that are not ours.
 *
 * The run used to charge and roll every active subscription on file. Most of
 * them are not the marketplace's to renew: a subscription sold by a seller is
 * renewed by that seller, who takes the money and tells us. Rolling their date
 * on their behalf asserted a renewal that may never have happened, and it hid
 * the only fact worth acting on — that nobody has heard from them.
 *
 * So this screen has two halves that never mix. What we sell, which a run
 * renews. And what a vendor sells, which sits here until the vendor reports it
 * and somebody rings them if they do not.
 */

const TODAY = new Date().toISOString().slice(0, 10)

const BAND_TONE: Record<string, string> = {
  watch: 'pending', chase: 'review', escalate: 'suspended',
}

const BAND_LABEL: Record<string, string> = {
  watch: 'Watch', chase: 'Chase', escalate: 'Escalate',
}

export function OperatorRenewals() {
  const { fmtIn } = useMarket()
  const [desk, setDesk] = useState<RenewalDesk | null>(null)
  const [running, setRunning] = useState(false)
  const [outcome, setOutcome] = useState<RunResult | null>(null)
  const [reporting, setReporting] = useState<WatchRow | null>(null)
  const [vendorRef, setVendorRef] = useState('')
  const [amount, setAmount] = useState('')
  const [saving, setSaving] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  const reload = useCallback(async () => setDesk(await loadRenewalDesk()), [])
  useEffect(() => { void reload() }, [reload])

  const subs = desk?.subs ?? []
  const watch = desk?.watch ?? []
  const charges = desk?.charges ?? []

  /* What a run today would do, worked out in the browser from the same rows the
     run reads. A button that says "run" and reports afterwards is one nobody
     presses twice. */
  const preview = useMemo(() => plan(subs, TODAY), [subs])

  const chargePage = usePaging(charges, { resetKey: String(charges.length) })
  const watchPage = usePaging(watch, { resetKey: String(watch.length) })

  if (!desk) {
    return <div style={{ textAlign: 'center', padding: '40px' }}><div className="spinner" style={{ margin: '0 auto' }} /></div>
  }

  const ours = subs.filter(s => s.status === 'active' && ownedByMarketplace(s))
  const theirs = subs.filter(s => s.status === 'active' && !ownedByMarketplace(s))
  const worst = watch.reduce((n, w) => Math.max(n, w.days_late), 0)

  const run = async () => {
    setRunning(true)
    const { result, error } = await runRenewals(TODAY, 'Operator, from the renewals desk')
    setRunning(false)
    if (error) { toast(error, 'error'); return }
    setOutcome(result!)
    toast(result!.charged === 0
      ? 'Nothing of ours was due. Nothing was charged.'
      : `${result!.charged} cycle${result!.charged === 1 ? '' : 's'} raised, ${result!.rolled} date${result!.rolled === 1 ? '' : 's'} moved.`)
    await reload()
  }

  const openReport = (w: WatchRow) => {
    setReporting(w)
    setVendorRef('')
    setAmount(String(w.price))
    setProblem(null)
  }

  const send = async () => {
    if (!reporting) return
    if (!vendorRef.trim()) {
      setProblem('A report with no reference from the vendor cannot be traced back to their record of it.')
      return
    }
    setSaving(true)
    const { result, error } = await reportRenewal(
      reporting.ref, reporting.due, vendorRef.trim(),
      amount.trim() === '' ? undefined : Number(amount))
    setSaving(false)
    if (error) { setProblem(error); return }
    setReporting(null)
    toast(result!.already
      ? 'That cycle was already on file. Nothing was raised twice.'
      : `${reporting.vendor}'s renewal recorded. ${reporting.ref} now renews ${result!.renews_next}.`)
    await reload()
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {desk.loadError && <Callout tone="danger" title="Some of this did not load">{desk.loadError}</Callout>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '14px' }}>
        <StatCard label="We renew" value={fmtInt(ours.length)}
          sublabel="Active subscriptions Aventa sells" />
        <StatCard label="A seller renews" value={fmtInt(theirs.length)}
          sublabel="Their date, their money, their report" />
        <StatCard label="Due for us today" value={fmtInt(preview.charge.length)}
          sublabel={preview.charge.length ? 'The run will raise these' : 'Nothing of ours is due'} />
        <StatCard label="Waiting on a vendor" value={fmtInt(watch.length)}
          sublabel={worst ? `Oldest is ${worst} day${worst === 1 ? '' : 's'} late` : 'Every vendor is current'}
          color={watch.length ? 'var(--warning)' : undefined} />
      </div>

      <Callout tone="info" title="Two kinds of renewal, and only one of them is a run">
        Aventa's own lines — Freedom, Family Safety, Digital Life, IoT Connect — are billed by the marketplace, so
        the run below raises the cycle and moves the date. Everything a seller sells is renewed by that seller:
        they take the money on their own system and report it here. The marketplace does not move a date it does
        not own, so a vendor who goes quiet shows up as work rather than as a date that silently moved.
      </Callout>

      <SectionCard
        title="The renewal run"
        subtitle="What Aventa sells, for the cycle that has started. It refuses a date in the future, and a second run finds the first run's charges rather than raising them twice."
        action={<Btn onClick={run} disabled={running} size="sm">
          {running ? <><RefreshCw size={12} className="spin" /> Running</> : <><Play size={12} /> Run for {fmtDate(TODAY)}</>}
        </Btn>}
      >
        <div style={{ padding: '16px 20px', display: 'flex', gap: '28px', flexWrap: 'wrap', fontSize: 'var(--text-sm)' }}>
          <div>
            <div style={{ color: 'var(--text-tertiary)', fontSize: 'var(--text-xs)' }}>To raise</div>
            <div style={{ fontWeight: 700, fontSize: 'var(--text-lg)' }}>{fmtInt(preview.charge.length)}</div>
          </div>
          <div>
            <div style={{ color: 'var(--text-tertiary)', fontSize: 'var(--text-xs)' }}>Dates to move</div>
            <div style={{ fontWeight: 700, fontSize: 'var(--text-lg)' }}>{fmtInt(preview.roll.length)}</div>
          </div>
          <div>
            <div style={{ color: 'var(--text-tertiary)', fontSize: 'var(--text-xs)' }}>Will not renew</div>
            <div style={{ fontWeight: 700, fontSize: 'var(--text-lg)' }}>{fmtInt(preview.skip.length)}</div>
          </div>
          <div>
            <div style={{ color: 'var(--text-tertiary)', fontSize: 'var(--text-xs)' }}>Not ours to renew</div>
            <div style={{ fontWeight: 700, fontSize: 'var(--text-lg)' }}>{fmtInt(preview.awaiting.length)}</div>
          </div>
        </div>

        {preview.charge.length > 0 && (
          <Table headers={['Subscription', 'Covers', { label: 'Amount', align: 'right' }]}>
            {preview.charge.map(c => (
              <tr key={c.subscription_id}>
                <Td style={{ fontSize: 'var(--text-xs)' }}>{c.ref}</Td>
                <Td style={{ fontSize: 'var(--text-xs)' }}>{c.period_start} to {c.period_end}</Td>
                <Td right>{fmtIn(c.amount, c.currency)}</Td>
              </tr>
            ))}
          </Table>
        )}

        {preview.skip.length > 0 && (
          <div style={{ padding: '0 20px 16px', fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', lineHeight: 1.7 }}>
            {preview.skip.map(s => <div key={s.ref}><strong>{s.ref}</strong> — {s.why}</div>)}
          </div>
        )}

        {outcome && (
          <div style={{
            margin: '0 20px 16px', padding: '12px 14px', borderRadius: 'var(--radius)',
            background: 'var(--success-bg)', fontSize: 'var(--text-sm)', lineHeight: 1.6,
          }}>
            <strong>Ran for {outcome.ran_on}.</strong> {fmtInt(outcome.charged)} raised,
            {' '}{fmtInt(outcome.already)} already on file, {fmtInt(outcome.rolled)} dates moved.
            {outcome.awaiting.length > 0 && <> {fmtInt(outcome.awaiting.length)} left alone because a seller renews them.</>}
          </div>
        )}
      </SectionCard>

      <SectionCard
        title="Waiting on a vendor"
        subtitle="A seller's renewal date has come and they have not told us they took it. The marketplace does not roll these — it chases them."
      >
        {watch.length === 0 ? (
          <EmptyState message="Every seller is current. Nothing is waiting on a report." />
        ) : (
          <>
            <Table headers={[
              'Subscription', 'Seller', 'Customer', 'Due', { label: 'Late', align: 'right' },
              { label: 'Cycle', align: 'right' }, '', '',
            ]}>
              {watchPage.rows.map(w => (
                <tr key={w.ref}>
                  <Td style={{ fontSize: 'var(--text-xs)' }}>
                    {w.ref}
                    <div style={{ color: 'var(--text-tertiary)' }}>{w.product_name}</div>
                  </Td>
                  <Td style={{ fontSize: 'var(--text-xs)' }}>{w.vendor}</Td>
                  <Td style={{ fontSize: 'var(--text-xs)' }}>{w.customer ?? '—'}</Td>
                  <Td style={{ fontSize: 'var(--text-xs)' }}>{w.due}</Td>
                  <Td right>{fmtInt(w.days_late)} day{w.days_late === 1 ? '' : 's'}</Td>
                  <Td right>{fmtIn(w.price, w.currency)}</Td>
                  <Td><StatusPill status={BAND_TONE[w.band] ?? 'pending'} label={BAND_LABEL[w.band] ?? w.band} /></Td>
                  <Td>
                    <Btn variant="secondary" size="sm" onClick={() => openReport(w)}>
                      <PhoneCall size={12} /> Record their report
                    </Btn>
                  </Td>
                </tr>
              ))}
            </Table>
            <div style={{ padding: '0 18px 12px' }}><Pager page={watchPage} noun="subscriptions" /></div>
            <div style={{ padding: '0 20px 16px', fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', lineHeight: 1.7 }}>
              A seller reports their own renewals from their console. Recording one here is for when they tell us by
              email or on a call — the row says the marketplace filed it on their behalf rather than pretending they did.
            </div>
          </>
        )}
      </SectionCard>

      <SectionCard
        title="Cycles raised"
        subtitle="Every renewal on file, ours and theirs. A charge waits for the bill covering its period; nothing here has taken money."
      >
        {charges.length === 0 ? (
          <EmptyState message="No renewal has been raised yet." />
        ) : (
          <>
            <Table headers={[
              'Subscription', 'Covers', 'Raised by', 'Their reference',
              { label: 'Amount', align: 'right' }, 'On a bill',
            ]}>
              {chargePage.rows.map(c => (
                <tr key={c.id}>
                  <Td style={{ fontSize: 'var(--text-xs)' }}>
                    {c.ref}
                    <div style={{ color: 'var(--text-tertiary)' }}>{c.product_name}</div>
                  </Td>
                  <Td style={{ fontSize: 'var(--text-xs)' }}>{c.period_start} to {c.period_end}</Td>
                  <Td style={{ fontSize: 'var(--text-xs)' }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
                      {c.source === 'vendor' ? <Store size={11} /> : <Landmark size={11} />}
                      {c.reported_by ?? (c.source === 'vendor' ? 'A seller' : 'Renewal run')}
                    </span>
                  </Td>
                  <Td style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>{c.vendor_ref ?? '—'}</Td>
                  <Td right>{fmtIn(c.amount, c.currency)}</Td>
                  <Td style={{ fontSize: 'var(--text-xs)' }}>{c.bill_id ?? 'Waiting for one'}</Td>
                </tr>
              ))}
            </Table>
            <div style={{ padding: '0 18px 12px' }}><Pager page={chargePage} noun="cycles" /></div>
          </>
        )}
      </SectionCard>

      <Modal
        open={!!reporting}
        onClose={() => setReporting(null)}
        title={reporting ? `${reporting.vendor} renewed ${reporting.ref}` : ''}
        footer={
          <>
            <Btn variant="secondary" onClick={() => setReporting(null)}>Cancel</Btn>
            <Btn onClick={send} disabled={saving}>{saving ? 'Recording…' : 'Record it'}</Btn>
          </>
        }
      >
        {reporting && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div style={{ fontSize: 'var(--text-sm)', lineHeight: 1.6, color: 'var(--text-secondary)' }}>
              The cycle starting <strong>{reporting.due}</strong> on {reporting.product_name}, for{' '}
              {reporting.customer ?? 'the customer'}. It is {reporting.days_late} day
              {reporting.days_late === 1 ? '' : 's'} past the date and this is the only cycle that can be reported —
              a vendor several cycles behind reports each one in turn, so the gap stays visible until they do.
            </div>
            {problem && <Callout tone="danger" title="That was not recorded">{problem}</Callout>}
            <FormField label="The seller's own reference" required
              hint="Their record of the renewal, so a dispute can be traced back to it.">
              <TextInput value={vendorRef} onChange={e => setVendorRef(e.target.value)}
                placeholder="e.g. BEA-RN-202608" />
            </FormField>
            <FormField label={`What they charged (${reporting.currency})`}
              hint="Leave as it is unless the seller took a different amount from the one on file.">
              <TextInput value={amount} onChange={e => setAmount(e.target.value)} inputMode="decimal" />
            </FormField>
            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', lineHeight: 1.7 }}>
              Recording this moves {reporting.ref} on by one cycle. It does not take any money — the charge waits
              for the bill covering its period, the same way a wholesale charge waits for its settlement.
            </div>
          </div>
        )}
      </Modal>

    </div>
  )
}
