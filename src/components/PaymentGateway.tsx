/**
 * The payment provider's own page.
 *
 * One component for every rail and both things you can pay for — a wallet
 * top-up and a basket — because they are the same trip. What differs is what
 * the provider asks for, and that comes from `gateway.ts` rather than from
 * branches in here.
 *
 * Two steps, deliberately. Every one of these rails has a second act and it is
 * the act that decides whether the payment happens: the bank's one-time code,
 * the wallet's PIN, the approval that arrives in a UPI app, the code texted to
 * the number the bill belongs to. A page that takes a card number and
 * immediately says "paid" is not a payment page, it is a form.
 *
 * It does not look like the marketplace on purpose. A payment page that looks
 * exactly like the site you came from is the thing customers are told to be
 * suspicious of, and a demo that blurs the handoff teaches the wrong shape.
 */
import { useState } from 'react'
import { ShieldCheck, ArrowLeft, Smartphone } from 'lucide-react'
import { Btn, FormField, TextInput, Select, toast } from './operator/shared'
import {
  fieldsFor, validateFields, instrumentLabel, confirmFor, validateConfirm,
  isFinanced, tenureOf, longestTenure, instalmentOf,
} from '../lib/gateway'
import type { PaymentMethod, PaymentAttempt } from '../lib/gateway'
import { settle } from '../lib/gatewayRepo'

export function PaymentGateway({ attempt, method, savedLabel, merchant, money, onSettled }: {
  attempt: PaymentAttempt
  method: PaymentMethod
  /* A card already on the account, so the provider asks for the CVV alone. */
  savedLabel: string | null
  merchant: string
  money: (n: number) => string
  onSettled: (settled: PaymentAttempt) => Promise<void>
}) {
  /* What the customer typed on each screen. Kept apart so going back to the
     first does not lose the second, and so the code the provider checks is
     never mixed up with the card number it was issued against. */
  const [values, setValues] = useState<Record<string, string>>(
    savedLabel ? { __saved: savedLabel } : {})
  const [answer, setAnswer] = useState<Record<string, string>>({})
  const [step, setStep] = useState<'details' | 'confirm'>('details')
  const [busy, setBusy] = useState(false)

  const fields = fieldsFor(method, savedLabel)
  const detailsCheck = validateFields(method, values)
  const confirm = confirmFor({
    method, values, reference: attempt.reference, amount: attempt.amount, savedLabel, money,
  })
  const confirmCheck = validateConfirm(confirm, answer, attempt.reference)

  const finish = async (outcome: 'succeeded' | 'failed' | 'cancelled', reason?: string) => {
    setBusy(true)
    try {
      const instrument = outcome === 'cancelled'
        ? undefined
        : instrumentLabel(method, values, savedLabel)
      /* The plan the financier approved travels back with the answer. Only on
         a success — a declined application has no plan, and sending one would
         record an agreement nobody entered into. */
      const months = isFinanced(method) && outcome === 'succeeded'
        ? tenureOf(values.tenure) ?? longestTenure(method)
        : null
      const each = months ? instalmentOf(attempt.amount, months) : null
      const res = await settle({
        attemptId: attempt.id, outcome, instrument,
        gatewayRef: `${(attempt.provider ?? 'PSP').replace(/\W/g, '').slice(0, 4).toUpperCase()}-${attempt.id.slice(-6)}`,
        reason,
        tenure: months, instalment: each,
        financier: months ? (attempt.provider ?? null) : null,
      })
      if (!res.ok) { toast(res.reason, 'error'); return }
      await onSettled({
        ...attempt,
        state: outcome,
        instrument: instrument ?? attempt.instrument,
        failure_reason: outcome === 'failed' ? (reason ?? null) : null,
        decided_at: new Date().toISOString(),
        tenure_months: months,
        instalment: each,
        financier: months ? (attempt.provider ?? null) : null,
      })
    } finally { setBusy(false) }
  }

  const touched = Object.keys(values).filter(k => k !== '__saved').length > 0

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 500, background: '#0f172a',
      display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
      padding: '32px 16px', overflowY: 'auto',
    }}>
      <div style={{ width: 'min(440px, 100%)', background: 'white', borderRadius: '14px', overflow: 'hidden' }}>
        <div style={{ padding: '16px 20px', background: '#1e293b', color: 'white' }}>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <ShieldCheck size={16} />
            <strong style={{ fontSize: 'var(--text-sm)' }}>{attempt.provider}</strong>
          </div>
          <div style={{ fontSize: '11px', opacity: 0.75, marginTop: '2px' }}>
            Secure payment page · {attempt.reference}
          </div>
        </div>

        <div style={{ padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
            paddingBottom: '12px', borderBottom: '1px solid var(--border)',
          }}>
            <div>
              <div style={{ fontSize: '10px', color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                Paying
              </div>
              <div style={{ fontSize: 'var(--text-sm)', fontWeight: 700 }}>{merchant}</div>
              {attempt.order_ref && (
                <div style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>Order {attempt.order_ref}</div>
              )}
            </div>
            <div style={{ fontSize: '24px', fontWeight: 800 }}>{money(attempt.amount)}</div>
          </div>

          {step === 'details' ? (
            <>
              <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>
                {method.label} · {method.asks_for}
              </div>

              {fields.map(f => (
                <FormField key={f.key} label={f.label} required hint={f.hint}>
                  {f.kind === 'select' ? (
                    <Select value={values[f.key] ?? ''} onChange={e => setValues({ ...values, [f.key]: e.target.value })}>
                      <option value="">Choose…</option>
                      {(f.options ?? []).map(o => <option key={o} value={o}>{o}</option>)}
                    </Select>
                  ) : (
                    <TextInput type={f.kind === 'password' ? 'password' : 'text'}
                               value={values[f.key] ?? ''}
                               onChange={e => setValues({ ...values, [f.key]: e.target.value })} />
                  )}
                </FormField>
              ))}

              {!detailsCheck.ok && touched && (
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--danger)' }}>{detailsCheck.reason}</div>
              )}

              <Btn disabled={!detailsCheck.ok || busy} onClick={() => setStep('confirm')}>Continue</Btn>

              <div style={{ display: 'flex', gap: '8px' }}>
                <Btn variant="secondary" size="sm" disabled={busy} style={{ flex: 1 }}
                     onClick={() => void finish('cancelled')}>
                  Cancel and go back
                </Btn>
              </div>
            </>
          ) : (
            <>
              <div>
                <div style={{ fontSize: 'var(--text-base)', fontWeight: 700, marginBottom: '4px' }}>{confirm.title}</div>
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', lineHeight: 1.55 }}>
                  {confirm.blurb}
                </div>
              </div>

              {/* What the provider knows about this payment and would show back:
                  the card it is against, the balance it leaves, the bill it
                  lands on. This is the part a customer reads before deciding. */}
              <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
                {confirm.facts.map((f, i) => (
                  <div key={f.label} style={{
                    display: 'flex', justifyContent: 'space-between', gap: '12px',
                    padding: '8px 12px', fontSize: 'var(--text-xs)',
                    borderTop: i === 0 ? 'none' : '1px solid var(--border-light)',
                  }}>
                    <span style={{ color: 'var(--text-tertiary)' }}>{f.label}</span>
                    <span style={{ fontWeight: 600, textAlign: 'right' }}>{f.value}</span>
                  </div>
                ))}
              </div>

              {/* There is no SMS and no bank, so the code is shown. This is the
                  one place the flow admits mid-way that it is a stand-in, and
                  it beats a code field nobody can fill. */}
              {confirm.shown && (
                <div style={{
                  display: 'flex', gap: '9px', alignItems: 'center',
                  padding: '9px 12px', borderRadius: 'var(--radius-md)',
                  background: 'var(--warning-bg)', border: '1px dashed var(--warning)',
                }}>
                  <Smartphone size={15} style={{ color: 'var(--warning)', flexShrink: 0 }} />
                  <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                    Nothing is really sent, so here it is:{' '}
                    <strong style={{ letterSpacing: '0.14em', fontSize: 'var(--text-sm)', color: 'var(--text)' }}>
                      {confirm.shown}
                    </strong>
                  </div>
                </div>
              )}

              {confirm.fields.map(f => (
                <FormField key={f.key} label={f.label} required hint={f.hint}>
                  <TextInput type={f.kind === 'password' ? 'password' : 'text'}
                             value={answer[f.key] ?? ''}
                             onChange={e => setAnswer({ ...answer, [f.key]: e.target.value })} />
                </FormField>
              ))}

              {!confirmCheck.ok && Object.keys(answer).length > 0 && (
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--danger)' }}>{confirmCheck.reason}</div>
              )}

              <Btn disabled={!confirmCheck.ok || busy} onClick={() => void finish('succeeded')}>
                {busy ? 'Talking to your bank…' : confirm.action}
              </Btn>

              <div style={{ display: 'flex', gap: '8px' }}>
                <Btn variant="secondary" size="sm" disabled={busy} style={{ flex: 1 }}
                     onClick={() => { setStep('details'); setAnswer({}) }}>
                  <ArrowLeft size={13} /> Back
                </Btn>
                {/* The refusal path, reachable. A payment screen that can only
                    succeed is a payment screen nobody has ever seen fail. */}
                <Btn variant="secondary" size="sm" disabled={busy} style={{ flex: 1 }}
                     onClick={() => void finish('failed', declineFor(method.kind))}>
                  Decline it
                </Btn>
              </div>
            </>
          )}

          <div style={{ fontSize: '10px', color: 'var(--text-tertiary)', lineHeight: 1.5, borderTop: '1px solid var(--border-light)', paddingTop: '10px' }}>
            This stands in for {attempt.provider}’s hosted page so the handoff can be walked end to end.
            Nothing typed here leaves your browser, and nothing is charged. {attempt.order_ref
              ? 'The order is placed only when a payment succeeds, which is the whole point of the trip.'
              : 'The wallet is credited only when a payment succeeds, which is the whole point of the trip.'}
          </div>
        </div>
      </div>
    </div>
  )
}

/* What each rail says when it refuses. A generic "declined" tells the customer
   nothing about who to ring, and who to ring is different for every one of
   these. */
function declineFor(kind: PaymentMethod['kind']): string {
  switch (kind) {
    case 'card':
      return 'Your bank declined the payment. They did not say why — your bank can tell you.'
    case 'netbanking':
      return 'Your bank refused the transfer. There may not be enough in the account, or the daily limit is reached.'
    case 'upi':
      return 'The collect request was declined in your UPI app, or it expired before it was approved.'
    case 'mobile_money':
      return 'M-Pesa refused the payment. The PIN prompt may have timed out, or the balance is short.'
    case 'mobile_wallet':
      return 'The wallet refused the payment. The balance may be short of the amount.'
    case 'carrier_billing':
      return 'Aventa billing refused the charge. The account may be past due, or this month’s billing limit is reached.'
    case 'bank_transfer':
      return 'The transfer was not authorised.'
    /* A credit decline is not a payment decline, and telling somebody their
       card failed when they were turned down for a loan sends them to the
       wrong phone number — and to try the same card again. */
    case 'emi':
      return 'Your bank did not offer an instalment plan on this card. It may not be a credit card, or the available limit is short of the purchase. The card may still work as an ordinary payment.'
    case 'bnpl':
      return 'The provider did not approve this plan. That decision is theirs and they can tell you why; it says nothing about your card or your Aventa account.'
  }
}
