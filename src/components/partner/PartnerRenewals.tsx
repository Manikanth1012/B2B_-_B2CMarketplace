import { useState, useEffect, useCallback } from 'react'
import { CircleCheck as CheckCircle, Clock, Send } from 'lucide-react'
import { Pager, usePaging } from '../Pager'
import {
  StatCard, SectionCard, Table, Td, StatusPill, Btn, EmptyState, Modal, FormField,
  TextInput, fmtInt, toast,
} from '../operator/shared'
import { Callout } from '../OnboardingJourney'
import { useMarket } from '../../lib/MarketContext'
import { loadVendorBook, reportRenewal } from '../../lib/renewalsRepo'
import type { VendorBook, BookRow } from '../../lib/renewalsRepo'
import { band, daysLate } from '../../lib/renewals'

/* The renewals that are yours.
 *
 * A subscription somebody bought from you is renewed by you: you decide whether
 * it runs on, you take the money on your own system, and the marketplace holds
 * the record. Until now the marketplace was moving those dates itself, which
 * meant its book claimed renewals you may never have taken.
 *
 * It has stopped. The date only moves when you say it has, which is what this
 * screen is for — and until you do, the marketplace can see that it is waiting
 * on you, which is the point.
 *
 * The rows are subscriptions, not subscribers. Who bought it is the
 * marketplace's to hold; what you need to renew it is the reference, the cycle
 * and the price, and that is what the database will give you.
 */

const TODAY = new Date().toISOString().slice(0, 10)

const BAND_TONE: Record<string, string> = {
  watch: 'pending', chase: 'review', escalate: 'suspended',
}

export function PartnerRenewals({ partnerId }: { partnerId?: string }) {
  const { fmtIn } = useMarket()
  const [book, setBook] = useState<VendorBook | null>(null)
  const [open, setOpen] = useState<BookRow | null>(null)
  const [vendorRef, setVendorRef] = useState('')
  const [amount, setAmount] = useState('')
  const [saving, setSaving] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  const reload = useCallback(async () => setBook(await loadVendorBook(partnerId)), [partnerId])
  useEffect(() => { void reload() }, [reload])

  const rows = book?.rows ?? []
  const charges = book?.charges ?? []
  const due = rows.filter(r => r.due <= TODAY && !r.reported)

  const chargePage = usePaging(charges, { resetKey: String(charges.length) })

  if (!book) {
    return <div style={{ textAlign: 'center', padding: '40px' }}><div className="spinner" style={{ margin: '0 auto' }} /></div>
  }

  const start = (r: BookRow) => {
    setOpen(r)
    setVendorRef('')
    setAmount(String(r.price))
    setProblem(null)
  }

  const send = async () => {
    if (!open) return
    if (!vendorRef.trim()) {
      setProblem('Your own reference for the renewal, please — without it a query about this charge has nothing to point at.')
      return
    }
    setSaving(true)
    const { result, error } = await reportRenewal(
      open.ref, open.due, vendorRef.trim(),
      amount.trim() === '' ? undefined : Number(amount))
    setSaving(false)
    if (error) { setProblem(error); return }
    setOpen(null)
    toast(result!.already
      ? 'That cycle was already reported. Nothing was raised twice.'
      : `Reported. ${open.ref} now renews ${result!.renews_next}.`)
    await reload()
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {book.loadError && <Callout tone="danger" title="Some of this did not load">{book.loadError}</Callout>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '14px' }}>
        <StatCard label="Yours to renew" value={fmtInt(rows.length)}
          sublabel="Active subscriptions on your listings" />
        <StatCard label="To report now" value={fmtInt(due.length)}
          sublabel={due.length ? 'The marketplace is waiting on these' : 'Nothing is outstanding'}
          color={due.length ? 'var(--warning)' : undefined} />
        <StatCard label="Reported" value={fmtInt(charges.length)}
          sublabel="Cycles on file against your listings" />
      </div>

      <Callout tone="info" title="The date moves when you say it has">
        The marketplace bills its own lines and renews them on a run. It does not renew yours — you do, on your
        own system, and this is where you tell us. Until a cycle is reported it stays outstanding here and on the
        marketplace's desk, so a quiet month shows up as something to chase rather than as a date that moved on
        its own.
      </Callout>

      <SectionCard
        title="Your renewals"
        subtitle="One cycle at a time, in date order. If you are several cycles behind, report each in turn — the gap is the record."
      >
        {rows.length === 0 ? (
          <EmptyState message="None of your listings has an active subscription against it yet. When one does, its renewals appear here." />
        ) : (
          <Table headers={[
            'Subscription', 'Cycle due', { label: 'Late', align: 'right' },
            { label: 'Amount', align: 'right' }, 'Last reported', '',
          ]}>
            {rows.map(r => {
              const late = daysLate(r.due, TODAY)
              return (
                <tr key={r.ref}>
                  <Td style={{ fontSize: 'var(--text-xs)' }}>
                    {r.ref}
                    <div style={{ color: 'var(--text-tertiary)' }}>{r.product_name} · {r.cycle}</div>
                  </Td>
                  <Td style={{ fontSize: 'var(--text-xs)' }}>
                    {r.due}
                    {r.reported && (
                      <div style={{ color: 'var(--success)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <CheckCircle size={11} /> reported
                      </div>
                    )}
                  </Td>
                  <Td right>
                    {r.reported || late === 0
                      ? <span style={{ color: 'var(--text-tertiary)' }}>—</span>
                      : <StatusPill status={BAND_TONE[band(late)]} label={`${late} day${late === 1 ? '' : 's'}`} />}
                  </Td>
                  <Td right>{fmtIn(r.price, r.currency)}</Td>
                  <Td style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
                    {r.last_reported ?? 'Never'}
                    {r.vendor_ref && <div>{r.vendor_ref}</div>}
                  </Td>
                  <Td>
                    {r.reported ? (
                      <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
                        Nothing outstanding
                      </span>
                    ) : r.due > TODAY ? (
                      <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <Clock size={11} /> not due yet
                      </span>
                    ) : (
                      <Btn variant="secondary" size="sm" onClick={() => start(r)}>
                        <Send size={12} /> Report renewal
                      </Btn>
                    )}
                  </Td>
                </tr>
              )
            })}
          </Table>
        )}
      </SectionCard>

      <SectionCard
        title="What you have reported"
        subtitle="Every cycle you have told us about. The marketplace holds these against the customer's bill; nothing here moves money between us."
      >
        {charges.length === 0 ? (
          <EmptyState message="You have not reported a renewal yet." />
        ) : (
          <>
            <Table headers={[
              'Subscription', 'Covers', 'Your reference',
              { label: 'Amount', align: 'right' }, 'Filed by',
            ]}>
              {chargePage.rows.map(c => (
                <tr key={c.id}>
                  <Td style={{ fontSize: 'var(--text-xs)' }}>
                    {c.ref}
                    <div style={{ color: 'var(--text-tertiary)' }}>{c.product_name}</div>
                  </Td>
                  <Td style={{ fontSize: 'var(--text-xs)' }}>{c.period_start} to {c.period_end}</Td>
                  <Td style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>{c.vendor_ref ?? '—'}</Td>
                  <Td right>{fmtIn(c.amount, c.currency)}</Td>
                  <Td style={{ fontSize: 'var(--text-xs)' }}>{c.reported_by ?? '—'}</Td>
                </tr>
              ))}
            </Table>
            <div style={{ padding: '0 18px 12px' }}><Pager page={chargePage} noun="cycles" /></div>
          </>
        )}
      </SectionCard>

      <Modal
        open={!!open}
        onClose={() => setOpen(null)}
        title={open ? `Report the renewal of ${open.ref}` : ''}
        footer={
          <>
            <Btn variant="secondary" onClick={() => setOpen(null)}>Cancel</Btn>
            <Btn onClick={send} disabled={saving}>{saving ? 'Reporting…' : 'Report it'}</Btn>
          </>
        }
      >
        {open && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div style={{ fontSize: 'var(--text-sm)', lineHeight: 1.6, color: 'var(--text-secondary)' }}>
              The cycle starting <strong>{open.due}</strong> on {open.product_name}. This is the cycle that is due;
              a later one cannot be reported before it, so nothing is skipped over.
            </div>
            {problem && <Callout tone="danger" title="That was not reported">{problem}</Callout>}
            <FormField label="Your reference" required
              hint="Whatever your own system calls this renewal, so a query can be traced back to it.">
              <TextInput value={vendorRef} onChange={e => setVendorRef(e.target.value)}
                placeholder="e.g. RN-202608-4471" />
            </FormField>
            <FormField label={`What you charged (${open.currency})`}
              hint="Leave as it is unless you took a different amount this cycle.">
              <TextInput value={amount} onChange={e => setAmount(e.target.value)} inputMode="decimal" />
            </FormField>
          </div>
        )}
      </Modal>
    </div>
  )
}
