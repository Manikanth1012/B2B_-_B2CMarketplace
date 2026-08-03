import { useState, useEffect, useCallback } from 'react'
import { Wallet as WalletIcon, Plus, Lock, Zap } from 'lucide-react'
import { SectionCard, EmptyState, Btn, Modal, FormField, TextInput, Select, toast, fmtDate } from './operator/shared'
import { Callout } from './OnboardingJourney'
import { useMarket } from '../lib/MarketContext'
import { loadMyWallet, topUp } from '../lib/walletRepo'
import type { MyWallet } from '../lib/walletRepo'
import { canTopUp, runningBalance, settleOnClosure, limitFor } from '../lib/wallet'

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
  /* What the money could be returned to, for the closure warning. */
  paymentMethods?: { detail: string; is_primary: boolean }[]
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

  const reload = useCallback(async () => setMy(await loadMyWallet()), [])
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
          onDone={async () => { setAdding(false); await reload(); onChanged?.() }}
        />
      )}
    </>
  )
}

function TopUpDialog({ my, money, methods, onClose, onDone }: {
  my: MyWallet
  money: (n: number) => string
  methods: { detail: string; is_primary: boolean }[]
  onClose: () => void
  onDone: () => Promise<void>
}) {
  const limit = limitFor(my.limits, my.wallet?.currency ?? 'USD', my.policy)

  /* The quick amounts are multiples of the floor rather than a fixed 10/25/50/
     100, which is a dollar ladder. Five hundred rupees up gives 1,000 / 2,500 /
     5,000 / 10,000, and five dollars up gives back exactly the four this used
     to hard-code. */
  const chips = [2, 5, 10, 20].map(n => n * limit.min_topup)

  const [amount, setAmount] = useState(String(chips[1]))
  const [instrument, setInstrument] = useState(
    methods.find(m => m.is_primary)?.detail ?? methods[0]?.detail ?? 'a saved card')
  const [busy, setBusy] = useState(false)

  const value = parseFloat(amount) || 0
  const verdict = my.wallet
    ? canTopUp(my.wallet, value, limit, money)
    : { ok: false as const, reason: 'No wallet.' }
  const room = my.wallet ? +(limit.max_balance - Number(my.wallet.balance)).toFixed(2) : 0

  return (
    <Modal open onClose={onClose} title="Top up your wallet"
      footer={<>
        <Btn variant="secondary" size="sm" onClick={onClose}>Cancel</Btn>
        <Btn size="sm" disabled={!verdict.ok || busy} onClick={async () => {
          if (!my.wallet) return
          setBusy(true)
          try {
            const res = await topUp({ walletId: my.wallet.id, amount: value, instrument })
            if (!res.ok) { toast(res.reason, 'error'); return }
            toast(res.note ?? 'Topped up')
            await onDone()
          } finally { setBusy(false) }
        }}>Add {money(Math.max(0, value))}</Btn>
      </>}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
        <Callout tone="info">
          What you add is your own money. It stays yours — you can ask for it back at any time, and it is
          returned to the card or account it came from if you close your account.
        </Callout>

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
          <Select value={instrument} onChange={e => setInstrument(e.target.value)}>
            {methods.length === 0 && <option value="a saved card">a saved card</option>}
            {methods.map(m => <option key={m.detail} value={m.detail}>{m.detail}{m.is_primary ? ' (primary)' : ''}</option>)}
          </Select>
        </FormField>

        {!verdict.ok && value > 0 && <Callout tone="danger">{verdict.reason}</Callout>}
      </div>
    </Modal>
  )
}
