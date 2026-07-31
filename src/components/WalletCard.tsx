import { useState, useEffect, useCallback } from 'react'
import { Wallet as WalletIcon, Plus, Lock, Zap } from 'lucide-react'
import { SectionCard, EmptyState, Btn, Modal, FormField, TextInput, Select, toast, fmtMoney, fmtDate } from './operator/shared'
import { Callout } from './OnboardingJourney'
import { loadMyWallet, topUp } from '../lib/walletRepo'
import type { MyWallet } from '../lib/walletRepo'
import { canTopUp, runningBalance, settleOnClosure } from '../lib/wallet'

/* The customer's own side of the same obligation the operator sees. One row
   read by two personas rather than two rows that drift.

   The two pots are shown separately here for the same reason they are stored
   separately: telling somebody their "$42.60 balance" is coming back when $12
   of it never can is the kind of promise a support queue is made of. */

export function WalletCard({ paymentMethods, onChanged }: {
  /* What the money could be returned to, for the closure warning. */
  paymentMethods?: { detail: string; is_primary: boolean }[]
  onChanged?: () => void
}) {
  const [my, setMy] = useState<MyWallet | null>(null)
  const [adding, setAdding] = useState(false)

  const reload = useCallback(async () => setMy(await loadMyWallet()), [])
  useEffect(() => { void reload() }, [reload])

  if (!my) return <div style={{ textAlign: 'center', padding: '30px' }}><div className="spinner" style={{ margin: '0 auto' }} /></div>

  if (!my.wallet) {
    return (
      <SectionCard title="Wallet">
        <div style={{ padding: '16px 20px' }}>
          <EmptyState message="No wallet on this account yet" />
        </div>
      </SectionCard>
    )
  }

  const w = my.wallet
  const statement = runningBalance(my.ledger).reverse()
  const primary = paymentMethods?.find(p => p.is_primary)?.detail ?? paymentMethods?.[0]?.detail ?? null
  const settlement = settleOnClosure(w, primary)

  return (
    <>
      <SectionCard
        title="Wallet"
        subtitle={`Opened ${fmtDate(w.opened)} · last movement ${fmtDate(w.last_move)}`}
        action={<Btn size="sm" onClick={() => setAdding(true)}><Plus size={13} /> Top up</Btn>}>
        <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
          {my.loadError && <Callout tone="danger">{my.loadError}</Callout>}

          <div style={{ display: 'flex', gap: '10px', alignItems: 'baseline', flexWrap: 'wrap' }}>
            <WalletIcon size={20} style={{ color: 'var(--text-tertiary)' }} />
            <span style={{ fontSize: '30px', fontWeight: 800, lineHeight: 1 }}>${fmtMoney(Number(w.balance))}</span>
            <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>available to spend</span>
          </div>

          {/* The split, always. It is the difference between money you can get
              back and money you can only spend here. */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '10px' }}>
            <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: '11px 13px' }}>
              <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                <Lock size={12} style={{ color: 'var(--brand-navy)' }} />
                <strong style={{ fontSize: 'var(--text-xs)' }}>Your money — ${fmtMoney(Number(w.cash))}</strong>
              </div>
              <p style={{ fontSize: '11px', color: 'var(--text-tertiary)', margin: '3px 0 0' }}>
                What you topped up and what was refunded here. You can ask for it back at any time, and it
                is returned if you close your account.
              </p>
            </div>
            <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: '11px 13px' }}>
              <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                <Zap size={12} style={{ color: 'var(--success)' }} />
                <strong style={{ fontSize: 'var(--text-xs)' }}>Credit — ${fmtMoney(Number(w.promo))}</strong>
              </div>
              <p style={{ fontSize: '11px', color: 'var(--text-tertiary)', margin: '3px 0 0' }}>
                Points you converted and goodwill from support. Spendable here, but it cannot be paid out
                as cash — so spend it before your own money.
              </p>
            </div>
          </div>

          {/* Which is exactly what happens when you spend. Worth saying, because
              it is in the customer's favour and nobody would guess it. */}
          {Number(w.promo) > 0 && (
            <Callout tone="info">
              When you pay from your wallet the credit goes first, so the money you could still ask back
              stays yours for as long as possible.
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
                        {Number(e.amount) < 0 ? '−' : '+'}${fmtMoney(Math.abs(Number(e.amount)))}
                      </span>
                      <span style={{ fontSize: '10px', color: 'var(--text-tertiary)', minWidth: '60px', textAlign: 'right' }}>
                        ${fmtMoney(e.balance)}
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
          methods={paymentMethods ?? []}
          onClose={() => setAdding(false)}
          onDone={async () => { setAdding(false); await reload(); onChanged?.() }}
        />
      )}
    </>
  )
}

function TopUpDialog({ my, methods, onClose, onDone }: {
  my: MyWallet
  methods: { detail: string; is_primary: boolean }[]
  onClose: () => void
  onDone: () => Promise<void>
}) {
  const [amount, setAmount] = useState('25')
  const [instrument, setInstrument] = useState(
    methods.find(m => m.is_primary)?.detail ?? methods[0]?.detail ?? 'a saved card')
  const [busy, setBusy] = useState(false)

  const value = parseFloat(amount) || 0
  const verdict = my.wallet ? canTopUp(my.wallet, value, my.policy) : { ok: false as const, reason: 'No wallet.' }
  const room = my.wallet ? +(my.policy.max_balance - Number(my.wallet.balance)).toFixed(2) : 0

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
        }}>Add ${value > 0 ? value.toFixed(2) : '0.00'}</Btn>
      </>}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
        <Callout tone="info">
          What you add is your own money. It stays yours — you can ask for it back at any time, and it is
          returned to the card or account it came from if you close your account.
        </Callout>

        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          {[10, 25, 50, 100].map(v => (
            <button key={v} onClick={() => setAmount(String(v))}
                    style={{
                      padding: '7px 14px', borderRadius: 'var(--radius)', cursor: 'pointer',
                      fontSize: 'var(--text-sm)', fontWeight: 700,
                      border: `1px solid ${amount === String(v) ? 'var(--brand-navy)' : 'var(--border)'}`,
                      background: amount === String(v) ? 'var(--brand-navy)' : 'white',
                      color: amount === String(v) ? 'white' : 'var(--text-secondary)',
                    }}>${v}</button>
          ))}
        </div>

        <FormField label="Amount (USD)" required
                   hint={`Between $${my.policy.min_topup.toFixed(2)} and $${room.toFixed(2)} — the wallet is capped at $${my.policy.max_balance.toFixed(2)}.`}>
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
