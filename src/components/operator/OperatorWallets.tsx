import { useState, useEffect, useCallback } from 'react'
import { Wallet as WalletIcon, Lock, Zap, Clock, TriangleAlert } from 'lucide-react'
import {
  SectionCard, EmptyState, Btn, Table, Td, toast, fmtMoney, fmtInt, fmtDate, StatCard,
} from './shared'
import { Callout } from '../OnboardingJourney'
import { loadWalletBook, markReturnPaid } from '../../lib/walletRepo'
import type { WalletBookSnapshot } from '../../lib/walletRepo'
import { summariseBook, runningBalance, isDormant } from '../../lib/wallet'
import type { Wallet } from '../../lib/wallet'

/* The marketplace's own liability. A wallet balance is money held on behalf of
   somebody else — never income, however long it sits there — and how much of it
   is the customer's own money decides how much has to stay liquid. That split
   is the reason this screen leads with two numbers rather than one. */

const ACTOR = 'Marketplace operations'

const STATE_INK: Record<string, string> = {
  active: 'var(--success)', dormant: 'var(--warning)',
  closing: 'var(--info, #2a78d6)', closed: 'var(--text-tertiary)',
}

export function OperatorWallets() {
  const [snap, setSnap] = useState<WalletBookSnapshot | null>(null)
  const [open, setOpen] = useState<string | null>(null)

  const reload = useCallback(async () => setSnap(await loadWalletBook()), [])
  useEffect(() => { void reload() }, [reload])

  if (!snap) return <div style={{ textAlign: 'center', padding: '40px' }}><div className="spinner" style={{ margin: '0 auto' }} /></div>

  const book = summariseBook(snap.wallets)
  const owing = snap.closures.filter(c => c.state === 'requested')
  const selected = snap.wallets.find(w => w.id === open) ?? null

  const act = async (fn: () => Promise<{ ok: boolean; reason?: string; note?: string }>, ok: string) => {
    const res = await fn()
    if (!res.ok) { toast(res.reason ?? 'That did not work', 'error'); return }
    toast(res.note ?? ok)
    await reload()
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div>
        <h1 style={{ fontSize: 'var(--text-2xl)', fontWeight: 800, color: 'var(--text)' }}>Marketplace wallet</h1>
        <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)', marginTop: '4px' }}>
          What the marketplace is holding on behalf of customers, and whose money each part of it is
        </p>
      </div>

      {snap.loadError && <Callout tone="danger" title="Some of this screen did not load">{snap.loadError}</Callout>}

      <Callout tone="warning" title="A wallet balance is money the platform is holding for somebody else">
        Unlike a reward point it is real money, and in most places the holder can ask for it back. It is
        never income, however long it sits there.
      </Callout>

      {/* Money the marketplace owes and has not yet paid. Named, because a
          closure sitting at 'requested' is somebody waiting for their money. */}
      {owing.length > 0 && (
        <Callout tone="danger" title={`${owing.length} return${owing.length === 1 ? '' : 's'} still owed`}>
          {owing.map(c => {
            const w = snap.wallets.find(x => x.id === c.wallet_id)
            return (
              <div key={c.id} style={{ display: 'flex', gap: '10px', alignItems: 'center', marginTop: '5px', flexWrap: 'wrap' }}>
                <strong>${fmtMoney(Number(c.cash_returned))}</strong>
                <span>to {w?.name ?? c.wallet_id} — {c.instrument}</span>
                <span style={{ fontSize: '10px', color: 'var(--text-tertiary)' }}>
                  requested {fmtDate(c.requested_at)}
                </span>
                <Btn size="sm" onClick={() => act(() => markReturnPaid({ closureId: c.id, actor: ACTOR }), 'Marked as paid')}>
                  Mark as paid
                </Btn>
              </div>
            )
          })}
        </Callout>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: '12px' }}>
        <StatCard label="Held in wallets" value={`$${fmtMoney(book.total)}`}
                  sublabel={`Across ${book.accounts} accounts`} />
        <StatCard label="The customer's own money" value={`$${fmtMoney(book.cash)}`}
                  sublabel="Top-ups and refunds — refundable on request" color="var(--danger)" />
        <StatCard label="Credit we issued" value={`$${fmtMoney(book.promo)}`}
                  sublabel="Rewards and goodwill — spendable, not refundable" color="var(--success)" />
        <StatCard label="Dormant" value={book.dormant === 0 ? 'None' : `$${fmtMoney(book.dormantValue)}`}
                  sublabel={book.dormant === 0
                    ? 'Every account has moved recently'
                    : `${book.dormant} account${book.dormant === 1 ? '' : 's'} untouched for ${snap.policy.dormancy_months} months`}
                  color={book.dormant > 0 ? 'var(--warning)' : undefined} />
      </div>

      <SectionCard title="Whose money it is"
                   subtitle="Two pots, because they are legally different and mixing them is how a platform refunds its own promotional credit as cash">
        <div style={{ padding: '14px 20px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '14px' }}>
          <div style={{ border: '1px solid var(--danger)', borderRadius: 'var(--radius-md)', padding: '12px 14px', background: 'var(--danger-bg)' }}>
            <div style={{ display: 'flex', gap: '7px', alignItems: 'center', marginBottom: '5px' }}>
              <Lock size={14} style={{ color: 'var(--danger)' }} />
              <strong style={{ fontSize: 'var(--text-sm)' }}>Refundable — ${fmtMoney(book.cash)}</strong>
            </div>
            <p style={{ fontSize: '11px', color: 'var(--text-secondary)', margin: 0 }}>{snap.policy.cash_refundable}</p>
          </div>
          <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: '12px 14px', background: 'var(--bg-alt)' }}>
            <div style={{ display: 'flex', gap: '7px', alignItems: 'center', marginBottom: '5px' }}>
              <Zap size={14} style={{ color: 'var(--success)' }} />
              <strong style={{ fontSize: 'var(--text-sm)' }}>Not refundable — ${fmtMoney(book.promo)}</strong>
            </div>
            <p style={{ fontSize: '11px', color: 'var(--text-secondary)', margin: 0 }}>{snap.policy.non_refundable}</p>
          </div>
          <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: '12px 14px' }}>
            <div style={{ display: 'flex', gap: '7px', alignItems: 'center', marginBottom: '5px' }}>
              <Clock size={14} style={{ color: 'var(--warning)' }} />
              <strong style={{ fontSize: 'var(--text-sm)' }}>Dormancy</strong>
            </div>
            <p style={{ fontSize: '11px', color: 'var(--text-secondary)', margin: 0 }}>{snap.policy.dormancy_note}</p>
          </div>
        </div>
      </SectionCard>

      <SectionCard title="Where the money comes from"
                   subtitle="Each source lands in one pot, and that decides whether it can ever be paid back">
        <Table headers={['Source', 'Movements', 'Value', 'Pot', 'What it means']}>
          {snap.sources.map(s => {
            const rows = snap.ledger.filter(l => l.source === s.id)
            const value = rows.reduce((n, l) => n + Number(l.amount), 0)
            return (
              <tr key={s.id}>
                <Td><strong style={{ fontSize: 'var(--text-xs)' }}>{s.label}</strong></Td>
                <Td right>{fmtInt(rows.length)}</Td>
                <Td right>${fmtMoney(Math.abs(value))}</Td>
                <Td>
                  <span style={{ fontSize: '10px', fontWeight: 700, color: s.pot === 'cash' ? 'var(--danger)' : 'var(--success)' }}>
                    {s.pot === 'cash' ? "The customer's" : 'Not refundable'}
                  </span>
                </Td>
                <Td><span style={{ fontSize: '10px', color: 'var(--text-tertiary)' }}>{s.note}</span></Td>
              </tr>
            )
          })}
        </Table>
      </SectionCard>

      <SectionCard title={`Accounts (${snap.wallets.length})`}
                   subtitle="Consumers and businesses alike. Open one to see how its balance was reached.">
        {snap.wallets.length === 0 ? <EmptyState message="No wallets" /> : (
          <Table headers={['Holder', 'Type', 'Their money', 'Our credit', 'Balance', 'Opened', 'Last movement', 'State']}>
            {snap.wallets.map(w => (
              <tr key={w.id} style={{ cursor: 'pointer' }} onClick={() => setOpen(w.id)}>
                <Td>
                  <div style={{ fontWeight: 700, fontSize: 'var(--text-xs)', color: 'var(--brand-navy)' }}>{w.name}</div>
                  <div style={{ fontSize: '10px', color: 'var(--text-tertiary)' }}>{w.party} · {w.id}</div>
                </Td>
                <Td><span style={{ fontSize: '11px' }}>{w.kind}</span></Td>
                <Td right>${fmtMoney(Number(w.cash))}</Td>
                <Td right>{Number(w.promo) === 0 ? '—' : `$${fmtMoney(Number(w.promo))}`}</Td>
                <Td right><strong>${fmtMoney(Number(w.balance))}</strong></Td>
                <Td><span style={{ fontSize: '10px', color: 'var(--text-tertiary)' }}>{fmtDate(w.opened)}</span></Td>
                <Td><span style={{ fontSize: '10px', color: 'var(--text-tertiary)' }}>{fmtDate(w.last_move)}</span></Td>
                <Td>
                  <span style={{ fontSize: '10px', fontWeight: 800, color: STATE_INK[w.state] }}>{w.state}</span>
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </SectionCard>

      {selected && (
        <WalletDrawer wallet={selected} snap={snap} onClose={() => setOpen(null)} />
      )}
    </div>
  )
}

function WalletDrawer({ wallet, snap, onClose }: {
  wallet: Wallet; snap: WalletBookSnapshot; onClose: () => void
}) {
  const mine = snap.ledger.filter(l => l.wallet_id === wallet.id)
  const statement = runningBalance(mine).reverse()
  const dormant = isDormant(wallet, snap.policy, new Date())
  const closure = snap.closures.find(c => c.wallet_id === wallet.id)

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.5)', zIndex: 400, display: 'flex', justifyContent: 'flex-end' }}>
      <div onClick={e => e.stopPropagation()} style={{ background: 'white', width: 'min(640px, 100%)', height: '100%', overflowY: 'auto' }}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', position: 'sticky', top: 0, background: 'white', zIndex: 2 }}>
          <div style={{ display: 'flex', gap: '9px', alignItems: 'center' }}>
            <WalletIcon size={16} style={{ color: 'var(--text-tertiary)' }} />
            <h3 style={{ fontSize: 'var(--text-lg)', fontWeight: 800, margin: 0 }}>{wallet.name}</h3>
            <span style={{ fontSize: '10px', fontWeight: 800, color: STATE_INK[wallet.state] }}>{wallet.state}</span>
          </div>
          <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
            {wallet.party} · {wallet.id} · {wallet.kind} · opened {fmtDate(wallet.opened)}
          </div>
        </div>

        <div style={{ padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {wallet.note && <Callout tone="warning" title="Flagged">{wallet.note}</Callout>}
          {dormant && wallet.state !== 'dormant' && (
            <Callout tone="warning" title="This has gone quiet">
              No movement since {fmtDate(wallet.last_move)}, which is past the {snap.policy.dormancy_months}-month
              mark. It should be flagged and the holder written to.
            </Callout>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '10px' }}>
            {([
              ['Their money', `$${fmtMoney(Number(wallet.cash))}`, 'var(--danger)'],
              ['Our credit', `$${fmtMoney(Number(wallet.promo))}`, 'var(--success)'],
              ['Balance', `$${fmtMoney(Number(wallet.balance))}`, 'var(--text)'],
            ] as [string, string, string][]).map(([k, v, ink]) => (
              <div key={k} style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: '10px 12px' }}>
                <div style={{ fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.03em', color: 'var(--text-tertiary)', fontWeight: 700 }}>{k}</div>
                <div style={{ fontSize: 'var(--text-lg)', fontWeight: 800, color: ink }}>{v}</div>
              </div>
            ))}
          </div>

          {closure && (
            <Callout tone={closure.state === 'returned' ? 'success' : 'warning'}
                     title={closure.state === 'returned' ? 'Closed and settled' : 'Closing — money still owed'}>
              ${fmtMoney(Number(closure.cash_returned))} returned to {closure.instrument};
              {' '}${fmtMoney(Number(closure.promo_written_off))} of promotional credit written off.
              {closure.note && ` ${closure.note}`}
            </Callout>
          )}

          <div>
            <div style={{ fontSize: 'var(--text-sm)', fontWeight: 700, marginBottom: '7px' }}>
              Statement <span style={{ fontWeight: 400, color: 'var(--text-tertiary)' }}>· newest first</span>
            </div>
            {statement.length === 0 ? <EmptyState message="No movements" /> : (
              <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-md)' }}>
                {statement.map((e, i) => {
                  const src = snap.sources.find(s => s.id === e.source)
                  return (
                    <div key={e.id} style={{
                      display: 'flex', gap: '10px', padding: '9px 12px', alignItems: 'baseline', flexWrap: 'wrap',
                      borderTop: i === 0 ? 'none' : '1px solid var(--border-light)',
                    }}>
                      <span style={{ fontSize: '10px', color: 'var(--text-tertiary)', minWidth: '78px' }}>{fmtDate(e.when_date)}</span>
                      <div style={{ flex: 1, minWidth: '170px' }}>
                        <div style={{ fontSize: 'var(--text-xs)' }}>{e.what}</div>
                        <div style={{ fontSize: '10px', color: e.pot === 'cash' ? 'var(--danger)' : 'var(--success)' }}>
                          {src?.label ?? e.source} · {e.pot === 'cash' ? "the customer's money" : 'credit we issued'}
                        </div>
                      </div>
                      <span style={{
                        fontSize: 'var(--text-xs)', fontWeight: 700, minWidth: '72px', textAlign: 'right',
                        color: Number(e.amount) < 0 ? 'var(--text-secondary)' : 'var(--success)',
                      }}>
                        {Number(e.amount) < 0 ? '−' : '+'}${fmtMoney(Math.abs(Number(e.amount)))}
                      </span>
                      <span style={{ fontSize: '10px', color: 'var(--text-tertiary)', minWidth: '62px', textAlign: 'right' }}>
                        ${fmtMoney(e.balance)}
                      </span>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {Number(wallet.cash) > 0 && (
            <Callout tone="info">
              <TriangleAlert size={12} style={{ display: 'inline', verticalAlign: '-2px', marginRight: '4px' }} />
              ${fmtMoney(Number(wallet.cash))} of this is the holder's own money. If they close the account it
              goes back to the instrument that funded it, and the marketplace cannot keep it.
            </Callout>
          )}
        </div>
      </div>
    </div>
  )
}
