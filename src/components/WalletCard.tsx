import { useState, useEffect, useCallback } from 'react'
import {
  Wallet as WalletIcon, Plus, Lock, Zap, CreditCard, Landmark, Smartphone,
  Building2, ShieldCheck,
} from 'lucide-react'
import { SectionCard, EmptyState, Btn, Modal, FormField, TextInput, Select, toast, fmtDate } from './operator/shared'
import { Callout } from './OnboardingJourney'
import { useMarket } from '../lib/MarketContext'
import { loadMyWallet } from '../lib/walletRepo'
import type { MyWallet } from '../lib/walletRepo'
import { canTopUp, runningBalance, settleOnClosure, limitFor } from '../lib/wallet'
import {
  offersIn, savedFor, canHandOff, canStart, marketForWallet, fieldsFor,
  validateFields, instrumentLabel, describe as describeAttempt,
} from '../lib/gateway'
import type { PaymentMethod, PaymentAttempt, MethodKind } from '../lib/gateway'
import { loadPaymentCatalogue, loadAttempts, startPayment, settle } from '../lib/gatewayRepo'
import type { PaymentCatalogue } from '../lib/gatewayRepo'
import { isExpired } from '../lib/payments'

/* A card already on the account. The wallet panel is handed these by whichever
   screen it sits on, and the gateway needs the kind and the expiry as well as
   the label — an expired card offered here is a trip to a provider to be told
   no. */
export interface SavedCard {
  id: string
  kind: string
  detail: string
  expires: string | null
  is_primary: boolean
  status: string
}

/* The customer's own side of the same obligation the operator sees. One row
   read by two personas rather than two rows that drift — and now four, because
   a company's wallet is the same object with a different owner and this panel
   draws both.

   The two pots are shown separately here for the same reason they are stored
   separately: telling somebody their "₹3,290 balance" is coming back when
   ₹1,049 of it never can is the kind of promise a support queue is made of.

   Every figure is in the wallet's own currency. It used to write a `$` and
   could say nothing else about it, which was wrong for the Indian customer this
   demo is built around — her wallet holds rupees. */

export function WalletCard({ paymentMethods, onChanged, title, intro, whose }: {
  /* What the money could be returned to, for the closure warning — and what a
     card payment can be started from without retyping it. */
  paymentMethods?: SavedCard[]
  onChanged?: () => void
  title?: string
  intro?: React.ReactNode
  /* "your" for a person, "the company's" for an account. The prose changes and
     the arithmetic does not. */
  whose?: 'yours' | 'company'
}) {
  const { fmtIn } = useMarket()
  const [my, setMy] = useState<MyWallet | null>(null)
  const [adding, setAdding] = useState(false)
  const [attempts, setAttempts] = useState<PaymentAttempt[]>([])

  const reload = useCallback(async () => {
    const next = await loadMyWallet()
    setMy(next)
    setAttempts(next.wallet ? await loadAttempts(next.wallet.id) : [])
  }, [])
  useEffect(() => { void reload() }, [reload])

  if (!my) return <div style={{ textAlign: 'center', padding: '30px' }}><div className="spinner" style={{ margin: '0 auto' }} /></div>

  if (!my.wallet) {
    return (
      <SectionCard title={title ?? 'Wallet'}>
        <div style={{ padding: '16px 20px' }}>
          <EmptyState message="No wallet on this account yet" />
        </div>
      </SectionCard>
    )
  }

  const w = my.wallet
  const money = (n: number) => fmtIn(n, w.currency)
  const company = whose === 'company'
  const statement = runningBalance(my.ledger).reverse()
  const primary = paymentMethods?.find(p => p.is_primary)?.detail ?? paymentMethods?.[0]?.detail ?? null
  const settlement = settleOnClosure(w, primary, money)
  /* Only the ones that produced no money. A succeeded attempt is already in the
     statement below, and saying it twice would make the wallet look topped up
     twice. */
  const unfinished = attempts.filter(a => a.state !== 'succeeded').slice(0, 3)

  return (
    <>
      <SectionCard
        title={title ?? 'Wallet'}
        subtitle={`Opened ${fmtDate(w.opened)} · last movement ${fmtDate(w.last_move)} · held in ${w.currency}`}
        action={<Btn size="sm" onClick={() => setAdding(true)}><Plus size={13} /> Top up</Btn>}>
        <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
          {my.loadError && <Callout tone="danger">{my.loadError}</Callout>}
          {intro}

          <div style={{ display: 'flex', gap: '10px', alignItems: 'baseline', flexWrap: 'wrap' }}>
            <WalletIcon size={20} style={{ color: 'var(--text-tertiary)' }} />
            <span style={{ fontSize: '30px', fontWeight: 800, lineHeight: 1 }}>{money(Number(w.balance))}</span>
            <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>available to spend</span>
          </div>

          {/* The split, always. It is the difference between money you can get
              back and money you can only spend here. */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '10px' }}>
            <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: '11px 13px' }}>
              <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                <Lock size={12} style={{ color: 'var(--brand-navy)' }} />
                <strong style={{ fontSize: 'var(--text-xs)' }}>
                  {company ? 'The company\u2019s money' : 'Your money'} — {money(Number(w.cash))}
                </strong>
              </div>
              <p style={{ fontSize: '11px', color: 'var(--text-tertiary)', margin: '3px 0 0' }}>
                {company
                  ? 'What the account topped up and what was refunded here. Returnable to the account\u2019s own instrument on request, and on closure.'
                  : 'What you topped up and what was refunded here. You can ask for it back at any time, and it is returned if you close your account.'}
              </p>
            </div>
            <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: '11px 13px' }}>
              <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                <Zap size={12} style={{ color: 'var(--success)' }} />
                <strong style={{ fontSize: 'var(--text-xs)' }}>Credit — {money(Number(w.promo))}</strong>
              </div>
              <p style={{ fontSize: '11px', color: 'var(--text-tertiary)', margin: '3px 0 0' }}>
                {company
                  ? 'Points the account converted and goodwill from support. Spendable here, but it cannot be paid out as cash — so it goes first.'
                  : 'Points you converted and goodwill from support. Spendable here, but it cannot be paid out as cash — so spend it before your own money.'}
              </p>
            </div>
          </div>

          {/* Which is exactly what happens when you spend. Worth saying, because
              it is in the customer's favour and nobody would guess it. */}
          {Number(w.promo) > 0 && (
            <Callout tone="info">
              {company
                ? 'When the account pays from the wallet the credit goes first, so the money it could still ask back stays available for as long as possible.'
                : 'When you pay from your wallet the credit goes first, so the money you could still ask back stays yours for as long as possible.'}
            </Callout>
          )}

          {settlement.hasPromo && (
            <Callout tone="warning" title="If you close your account">
              {settlement.lines.join(' ')}
            </Callout>
          )}

          {/* Payments that did not become money. The statement below is the
              record of what landed, so a refused or abandoned top-up leaves no
              trace there — and "I paid and nothing arrived" is the one thing a
              customer most needs to be able to look up. */}
          {unfinished.length > 0 && (
            <div>
              <div style={{ fontSize: 'var(--text-sm)', fontWeight: 700, marginBottom: '7px' }}>Payments that did not go through</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '7px' }}>
                {unfinished.map(a => {
                  const d = describeAttempt(a, money)
                  return (
                    <Callout key={a.id} tone={d.tone === 'waiting' ? 'warning' : 'danger'} title={d.headline}>
                      {d.detail}
                    </Callout>
                  )
                })}
              </div>
            </div>
          )}

          <div>
            <div style={{ fontSize: 'var(--text-sm)', fontWeight: 700, marginBottom: '7px' }}>Statement</div>
            {statement.length === 0 ? (
              <EmptyState message="Top-ups, refunds and spend appear here" />
            ) : (
              <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-md)' }}>
                {statement.map((e, i) => {
                  const src = my.sources.find(s => s.id === e.source)
                  return (
                    <div key={e.id} style={{
                      display: 'flex', gap: '10px', padding: '9px 12px', alignItems: 'baseline', flexWrap: 'wrap',
                      borderTop: i === 0 ? 'none' : '1px solid var(--border-light)',
                    }}>
                      <span style={{ fontSize: '10px', color: 'var(--text-tertiary)', minWidth: '76px' }}>{fmtDate(e.when_date)}</span>
                      <div style={{ flex: 1, minWidth: '160px' }}>
                        <div style={{ fontSize: 'var(--text-xs)' }}>{e.what}</div>
                        <div style={{ fontSize: '10px', color: e.pot === 'cash' ? 'var(--brand-navy)' : 'var(--success)' }}>
                          {e.pot === 'cash' ? 'Your money' : 'Credit'} · {src?.label ?? e.source}
                        </div>
                      </div>
                      <span style={{
                        fontSize: 'var(--text-xs)', fontWeight: 700, minWidth: '70px', textAlign: 'right',
                        color: Number(e.amount) < 0 ? 'var(--text-secondary)' : 'var(--success)',
                      }}>
                        {Number(e.amount) < 0 ? '−' : '+'}{money(Math.abs(Number(e.amount)))}
                      </span>
                      <span style={{ fontSize: '10px', color: 'var(--text-tertiary)', minWidth: '72px', textAlign: 'right' }}>
                        {money(e.balance)}
                      </span>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      </SectionCard>

      {adding && (
        <TopUpDialog
          my={my}
          money={money}
          methods={paymentMethods ?? []}
          onClose={() => setAdding(false)}
          /* Reloads but does not close. A successful payment has a reference on
             it, and closing the dialog the moment the money lands takes that
             reference away from the one person who might need to quote it. */
          onDone={async () => { await reload(); onChanged?.() }}
        />
      )}
    </>
  )
}

/**
 * Deciding how much and how, and then leaving.
 *
 * "Pay with" used to list only the instruments already saved on the account, so
 * a customer with no saved card had nothing to choose and a customer who wanted
 * to pay by net banking or UPI had no way to say so. What is offered now comes
 * from the marketplace's own payment catalogue, per market — the rails differ
 * completely between Bengaluru, Dubai and Nairobi and a single list would have
 * been wrong in at least two of them.
 */
function TopUpDialog({ my, money, methods: saved, onClose, onDone }: {
  my: MyWallet
  money: (n: number) => string
  methods: SavedCard[]
  onClose: () => void
  onDone: () => Promise<void>
}) {
  const { book, market } = useMarket()
  const limit = limitFor(my.limits, my.wallet?.currency ?? 'USD', my.policy)

  /* The quick amounts are multiples of the floor rather than a fixed 10/25/50/
     100, which is a dollar ladder. Five hundred rupees up gives 1,000 / 2,500 /
     5,000 / 10,000, and five dollars up gives back exactly the four this used
     to hard-code. */
  const chips = [2, 5, 10, 20].map(n => n * limit.min_topup)

  const [amount, setAmount] = useState(String(chips[1]))
  const [catalogue, setCatalogue] = useState<PaymentCatalogue | null>(null)
  const [attempts, setAttempts] = useState<PaymentAttempt[]>([])
  const [chosen, setChosen] = useState<string | null>(null)
  const [savedCard, setSavedCard] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  /* The attempt the customer is away on. While this is set the marketplace has
     handed over and is waiting, which is a different screen. */
  const [away, setAway] = useState<{ attempt: PaymentAttempt; method: PaymentMethod } | null>(null)
  const [outcome, setOutcome] = useState<PaymentAttempt | null>(null)

  const walletId = my.wallet?.id ?? null
  useEffect(() => {
    void loadPaymentCatalogue().then(setCatalogue)
  }, [])
  useEffect(() => {
    if (walletId) void loadAttempts(walletId).then(setAttempts)
  }, [walletId])

  const marketCode = my.wallet
    ? marketForWallet(my.wallet.currency, book.accepted, market?.code ?? null)
    : null
  const offers = catalogue && marketCode ? offersIn(marketCode, catalogue.methods, catalogue.links) : []
  const method = offers.find(o => o.method.id === chosen)?.method ?? null
  const provider = offers.find(o => o.method.id === chosen)?.provider ?? null
  const cards = method ? savedFor(method, saved, isExpired) : []

  const value = parseFloat(amount) || 0
  const amountCheck = my.wallet
    ? canTopUp(my.wallet, value, limit, money)
    : { ok: false as const, reason: 'No wallet.' }
  const handoff = canHandOff({ amount: value, method, offers })
  const start = canStart(attempts)
  const room = my.wallet ? +(limit.max_balance - Number(my.wallet.balance)).toFixed(2) : 0
  const ready = amountCheck.ok && handoff.ok && start.ok

  /* ------------------------------------------------ what the provider said */
  if (outcome) {
    const d = describeAttempt(outcome, money)
    return (
      <Modal open onClose={onClose} title={d.headline}
        footer={<Btn size="sm" onClick={onClose}>Done</Btn>}>
        <Callout tone={d.tone === 'good' ? 'success' : d.tone === 'bad' ? 'danger' : 'warning'}
                 title={d.headline}>
          {d.detail}
        </Callout>
      </Modal>
    )
  }

  /* ------------------------------------------------------- away, paying */
  if (away && my.wallet) {
    return (
      <GatewayPage
        attempt={away.attempt}
        method={away.method}
        savedLabel={savedCard}
        merchant="Aventa Telecom"
        money={money}
        onSettled={async settled => {
          setAway(null)
          setOutcome(settled)
          if (settled.state === 'succeeded') await onDone()
          else if (walletId) setAttempts(await loadAttempts(walletId))
        }}
      />
    )
  }

  return (
    <Modal open onClose={onClose} title="Top up your wallet"
      footer={<>
        <Btn variant="secondary" size="sm" onClick={onClose}>Cancel</Btn>
        <Btn size="sm" disabled={!ready || busy} onClick={async () => {
          if (!my.wallet || !method || !provider || !marketCode) return
          setBusy(true)
          try {
            const res = await startPayment({
              walletId: my.wallet.id, amount: value, currency: my.wallet.currency,
              method, marketCode, provider,
            })
            if (!res.ok) { toast(res.reason, 'error'); return }
            setAway({ attempt: res.attempt, method })
          } finally { setBusy(false) }
        }}>
          {busy ? 'Starting…' : `Pay ${money(Math.max(0, value))}`}
        </Btn>
      </>}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
        <Callout tone="info">
          What you add is your own money. It stays yours — you can ask for it back at any time, and it is
          returned to the card or account it came from if you close your account.
        </Callout>

        {catalogue?.loadError && <Callout tone="danger">{catalogue.loadError}</Callout>}

        {/* A payment already at the provider. Starting a second is how one
            top-up becomes two charges. */}
        {!start.ok && <Callout tone="warning" title="A payment is already in progress">{start.reason}</Callout>}
        {start.ok && start.note && <Callout tone="warning">{start.note}</Callout>}

        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          {chips.map(v => (
            <button key={v} onClick={() => setAmount(String(v))}
                    style={{
                      padding: '7px 14px', borderRadius: 'var(--radius)', cursor: 'pointer',
                      fontSize: 'var(--text-sm)', fontWeight: 700, whiteSpace: 'nowrap',
                      border: `1px solid ${amount === String(v) ? 'var(--brand-navy)' : 'var(--border)'}`,
                      background: amount === String(v) ? 'var(--brand-navy)' : 'white',
                      color: amount === String(v) ? 'white' : 'var(--text-secondary)',
                    }}>{money(v)}</button>
          ))}
        </div>

        <FormField label={`Amount (${my.wallet?.currency ?? 'USD'})`} required
                   hint={`Between ${money(limit.min_topup)} and ${money(room)} — the wallet is capped at ${money(limit.max_balance)}.`}>
          <TextInput type="number" value={amount} onChange={e => setAmount(e.target.value)} />
        </FormField>

        <FormField label="Pay with" required>
          {!catalogue ? (
            <div className="spinner" style={{ margin: '6px 0' }} />
          ) : offers.length === 0 ? (
            <Callout tone="warning">
              No way to pay is set up for this market yet. Support can take the top-up over the phone.
            </Callout>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '7px' }}>
              {offers.map(o => {
                const on = chosen === o.method.id
                return (
                  <button key={o.method.id}
                          onClick={() => { setChosen(o.method.id); setSavedCard(null) }}
                          style={{
                            textAlign: 'left', cursor: 'pointer', padding: '11px 13px',
                            borderRadius: 'var(--radius-md)', background: on ? 'var(--bg-alt)' : 'white',
                            border: `1px solid ${on ? 'var(--brand-navy)' : 'var(--border)'}`,
                          }}>
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                      <MethodIcon kind={o.method.kind} />
                      <strong style={{ fontSize: 'var(--text-sm)' }}>{o.method.label}</strong>
                      <span style={{ fontSize: '10px', color: 'var(--text-tertiary)' }}>
                        via {o.provider} · {o.method.typical}
                      </span>
                    </div>
                    <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '3px' }}>
                      {o.method.blurb}
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </FormField>

        {/* Only for a card, and only if one is saved. Everything else is typed
            at the provider, which is where it belongs. */}
        {cards.length > 0 && (
          <FormField label="Which card"
                     hint="You will still be asked for the CVV at the provider — a saved card is not a stored password.">
            <Select value={savedCard ?? ''} onChange={e => setSavedCard(e.target.value || null)}>
              <option value="">A different card</option>
              {cards.map(c => (
                <option key={c.id} value={c.detail}>
                  {c.kind} {c.detail}{c.is_primary ? ' (primary)' : ''}
                </option>
              ))}
            </Select>
          </FormField>
        )}

        {!amountCheck.ok && value > 0 && <Callout tone="danger">{amountCheck.reason}</Callout>}
        {amountCheck.ok && method && handoff.ok && (
          <Callout tone="info" title={`Next: ${provider}`}>{handoff.note}</Callout>
        )}
      </div>
    </Modal>
  )
}

function MethodIcon({ kind }: { kind: MethodKind }) {
  const Icon = kind === 'card' ? CreditCard
    : kind === 'netbanking' ? Landmark
    : kind === 'upi' ? Smartphone
    : kind === 'mobile_money' ? Smartphone
    : Building2
  return <Icon size={15} style={{ color: 'var(--brand-navy)' }} />
}

/**
 * The provider's own page.
 *
 * Deliberately does not look like the marketplace: a payment page that looks
 * exactly like the site you came from is the thing customers are told to be
 * suspicious of, and a demo that blurs the handoff teaches the wrong shape.
 *
 * It is a stand-in and says so in one line at the bottom. Everything above that
 * line behaves the way the real one does — including refusing a card number
 * that fails the check an issuer does, and including the two ways out that are
 * not "paid": the provider declining, and the customer walking away.
 */
function GatewayPage({ attempt, method, savedLabel, merchant, money, onSettled }: {
  attempt: PaymentAttempt
  method: PaymentMethod
  savedLabel: string | null
  merchant: string
  money: (n: number) => string
  onSettled: (settled: PaymentAttempt) => Promise<void>
}) {
  const [values, setValues] = useState<Record<string, string>>(
    savedLabel ? { __saved: savedLabel } : {})
  const [busy, setBusy] = useState(false)
  const fields = fieldsFor(method, savedLabel)
  const check = validateFields(method, values)

  const finish = async (
    outcome: 'succeeded' | 'failed' | 'cancelled', reason?: string,
  ) => {
    setBusy(true)
    try {
      const instrument = outcome === 'succeeded' || outcome === 'failed'
        ? instrumentLabel(method, values, savedLabel)
        : undefined
      const res = await settle({
        attemptId: attempt.id, outcome, instrument,
        gatewayRef: `${(attempt.provider ?? 'PSP').replace(/\W/g, '').slice(0, 4).toUpperCase()}-${attempt.id.slice(-6)}`,
        reason,
      })
      if (!res.ok) { toast(res.reason, 'error'); return }
      await onSettled({
        ...attempt,
        state: outcome,
        instrument: instrument ?? attempt.instrument,
        failure_reason: outcome === 'failed' ? (reason ?? null) : null,
        decided_at: new Date().toISOString(),
      })
    } finally { setBusy(false) }
  }

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
            </div>
            <div style={{ fontSize: '24px', fontWeight: 800 }}>{money(attempt.amount)}</div>
          </div>

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

          {!check.ok && Object.keys(values).length > (savedLabel ? 1 : 0) && (
            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--danger)' }}>{check.reason}</div>
          )}

          <Btn disabled={!check.ok || busy} onClick={() => void finish('succeeded')}>
            {busy ? 'Talking to your bank…' : `Pay ${money(attempt.amount)}`}
          </Btn>

          <div style={{ display: 'flex', gap: '8px' }}>
            <Btn variant="secondary" size="sm" disabled={busy} style={{ flex: 1 }}
                 onClick={() => void finish('cancelled')}>
              Cancel and go back
            </Btn>
            {/* The refusal path, reachable. A payment screen that can only
                succeed is a payment screen nobody has ever seen fail. */}
            <Btn variant="secondary" size="sm" disabled={busy} style={{ flex: 1 }}
                 onClick={() => void finish('failed',
                   'Your bank declined the payment. They did not say why — your bank can tell you.')}>
              Decline it
            </Btn>
          </div>

          <div style={{ fontSize: '10px', color: 'var(--text-tertiary)', lineHeight: 1.5, borderTop: '1px solid var(--border-light)', paddingTop: '10px' }}>
            This stands in for {attempt.provider}’s hosted page so the handoff can be walked end to end.
            Nothing typed here leaves your browser, and no card is charged. The wallet is credited only
            when a payment succeeds, which is the whole point of the trip.
          </div>
        </div>
      </div>
    </div>
  )
}
