import { useState, useEffect, useCallback } from 'react'
import { Pager, usePaging } from '../Pager'
import { Wallet as WalletIcon, Lock, Zap, Clock, TriangleAlert } from 'lucide-react'
import {
  SectionCard, EmptyState, Btn, Table, Td, toast, fmtInt, fmtDate, PageHeader,
} from './shared'
import { KpiCard, KpiRow } from '../ui/KpiCard'
import { StatusBadge } from '../ui/StatusBadge'
import { Callout } from '../OnboardingJourney'
import { loadWalletBook, markReturnPaid } from '../../lib/walletRepo'
import type { WalletBookSnapshot } from '../../lib/walletRepo'
import { summariseBook, runningBalance, isDormant } from '../../lib/wallet'
import type { Wallet } from '../../lib/wallet'
import { useMarket } from '../../lib/MarketContext'
import { byCurrency, formatGroups, money, totalIn } from '../../lib/money'

/* The marketplace's own liability. A wallet balance is money held on behalf of
   somebody else — never income, however long it sits there — and how much of it
   is the customer's own money decides how much has to stay liquid. That split
   is the reason this screen leads with two numbers rather than one. */

const ACTOR = 'Marketplace operations'

/* The date the reporting figures are converted at. Named rather than "today",
   so two people reading this screen a week apart see the same total and can say
   which rates produced it. Same constant, same reason, as the rewards screen. */
const AS_OF = '2026-08-01'

const STATE_TONE: Record<string, 'success' | 'warning' | 'info' | 'neutral'> = {
  active: 'success', dormant: 'warning', closing: 'info', closed: 'neutral',
}

export function OperatorWallets() {
  const [snap, setSnap] = useState<WalletBookSnapshot | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const { book: moneyBook, fmtIn } = useMarket()

  const reload = useCallback(async () => setSnap(await loadWalletBook()), [])
  useEffect(() => { void reload() }, [reload])

  /* Above the loading guard: `usePaging` is a hook, and a hook after an
     early return runs on some renders and not others. */
  const walletsPage = usePaging(snap?.wallets ?? [])

  if (!snap) return <div style={{ textAlign: 'center', padding: '40px' }}><div className="spinner" style={{ margin: '0 auto' }} /></div>

  const book = summariseBook(snap.wallets)
  const owing = snap.closures.filter(c => c.state === 'requested')
  const selected = snap.wallets.find(w => w.id === open) ?? null

  /* Ten wallets in three currencies. `summariseBook`'s scalars add them
     together, which is a quantity of nothing — ₹36,015 plus KSh 24,508 is not
     a number anybody can act on, and it looked entirely reasonable with a
     dollar sign in front of it.

     The headline is converted at a named date and says so; the spread underneath
     is what the marketplace actually holds. Both, because a treasurer needs the
     one figure and an operator needs to know it is three. */
  const home = moneyBook.currencies.find(c => c.is_reporting)?.code ?? 'USD'
  const reported = (list: Parameters<typeof totalIn>[0]) =>
    totalIn(list, home, moneyBook.rates, AS_OF, moneyBook.currencies)
  const spread = (groups: Parameters<typeof formatGroups>[0]) =>
    formatGroups(groups, fmtIn, 'Nothing held')
  const held = reported(book.totalBy.map(g => g.total))
  const heldCash = reported(book.cashBy.map(g => g.total))
  const heldPromo = reported(book.promoBy.map(g => g.total))
  const heldDormant = reported(book.dormantBy.map(g => g.total))
  /* The money as it is held, one row per currency, for a card's breakdown. */
  const groupRows = (groups: Parameters<typeof formatGroups>[0]) =>
    groups.length > 1 ? groups.map(g => ({ label: g.currency, value: fmtIn(g.total.amount, g.currency) })) : undefined
  /* Which wallet a ledger row or a closure belongs to, and therefore what it is
     in. Neither table carries a currency of its own — they cannot: a movement
     is in the money of the wallet it moved. */
  const curOf = (walletId: string) =>
    snap.wallets.find(w => w.id === walletId)?.currency ?? home

  const act = async (fn: () => Promise<{ ok: boolean; reason?: string; note?: string }>, ok: string) => {
    const res = await fn()
    if (!res.ok) { toast(res.reason ?? 'That did not work', 'error'); return }
    toast(res.note ?? ok)
    await reload()
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <PageHeader title="Marketplace wallet"
        description="What the marketplace is holding on behalf of customers, and whose money each part of it is" />

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
                <strong>{fmtIn(Number(c.cash_returned), curOf(c.wallet_id))}</strong>
                <span>to {w?.name ?? c.wallet_id} — {c.instrument}</span>
                <span className="c-sub">
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

      {/* The headline is the converted figure, as before; what is actually held,
          currency by currency, sits under it. Nothing is added or converted here. */}
      <KpiRow label="Wallet summary">
        <KpiCard variant="money" label={`Held in wallets, in ${home}`} unit={held.total.currency}
                 value={`≈ ${fmtIn(held.total.amount, held.total.currency)}`}
                 context={`Across ${book.accounts} accounts in ${book.currencies.length} ${book.currencies.length === 1 ? 'currency' : 'currencies'} · at ${AS_OF} rates`} />
        <KpiCard variant="money" label="The customer's own money" unit={heldCash.total.currency}
                 value={`≈ ${fmtIn(heldCash.total.amount, heldCash.total.currency)}`} tone="danger"
                 context="Top-ups and refunds — refundable on request" />
        <KpiCard variant="money" label="Credit we issued" unit={heldPromo.total.currency}
                 value={`≈ ${fmtIn(heldPromo.total.amount, heldPromo.total.currency)}`} tone="success"
                 breakdown={groupRows(book.promoBy)}
                 context="Rewards and goodwill — spendable, not refundable" />
        <KpiCard variant="money" label="Dormant" unit={book.dormant === 0 ? undefined : heldDormant.total.currency}
                 value={book.dormant === 0 ? 'None' : `≈ ${fmtIn(heldDormant.total.amount, heldDormant.total.currency)}`}
                 tone={book.dormant > 0 ? 'warning' : undefined}
                 breakdown={book.dormant === 0 ? undefined : groupRows(book.dormantBy)}
                 context={book.dormant === 0
                   ? 'Every account has moved recently'
                   : `${book.dormant} account${book.dormant === 1 ? '' : 's'} untouched for ${snap.policy.dormancy_months} months`} />
      </KpiRow>

      {/* What is actually held, before anything was converted. A reporting total
          is a view of the balance sheet; this is the balance sheet. */}
      {book.currencies.length > 1 && (
        <Callout tone="info" title={`Held in ${book.currencies.join(', ')}`}>
          <div><strong>Total held:</strong> {spread(book.totalBy)}</div>
          <div><strong>Of which the customers' own:</strong> {spread(book.cashBy)}</div>
          <div style={{ marginTop: '6px' }}>
            The tiles above convert these at {AS_OF} rates so there is one number to report.
            The money itself is in {book.currencies.length} currencies and has to be held in each —
            a reporting total is a view of the balance sheet, not the balance sheet.
          </div>
        </Callout>
      )}

      {held.missing.length > 0 && (
        <Callout tone="danger" title={`${held.missing.join(', ')} could not be converted`}>
          There is no rate on file for {held.missing.join(' or ')} at {AS_OF}, so the reported totals
          leave those wallets out. A liability computed over some of the currencies is worse than no
          total, which is why it says so here rather than quietly rounding down.
        </Callout>
      )}

      <SectionCard title="Whose money it is"
                   subtitle="Two pots, because they are legally different and mixing them is how a platform refunds its own promotional credit as cash">
        <div style={{ padding: '14px 20px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '14px' }}>
          <div style={{ border: '1px solid var(--danger)', borderRadius: 'var(--radius-md)', padding: '12px 14px', background: 'var(--danger-bg)' }}>
            <div style={{ display: 'flex', gap: '7px', alignItems: 'center', marginBottom: '5px' }}>
              <Lock size={14} style={{ color: 'var(--danger)' }} />
              <strong>Refundable — {spread(book.cashBy)}</strong>
            </div>
            <p className="c-sub" style={{ margin: 0 }}>{snap.policy.cash_refundable}</p>
          </div>
          <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: '12px 14px', background: 'var(--bg-alt)' }}>
            <div style={{ display: 'flex', gap: '7px', alignItems: 'center', marginBottom: '5px' }}>
              <Zap size={14} style={{ color: 'var(--success)' }} />
              <strong>Not refundable — {spread(book.promoBy)}</strong>
            </div>
            <p className="c-sub" style={{ margin: 0 }}>{snap.policy.non_refundable}</p>
          </div>
          <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: '12px 14px' }}>
            <div style={{ display: 'flex', gap: '7px', alignItems: 'center', marginBottom: '5px' }}>
              <Clock size={14} style={{ color: 'var(--warning)' }} />
              <strong>Dormancy</strong>
            </div>
            <p className="c-sub" style={{ margin: 0 }}>{snap.policy.dormancy_note}</p>
          </div>
        </div>
      </SectionCard>

      <SectionCard title="Where the money comes from"
                   subtitle="Each source lands in one pot, and that decides whether it can ever be paid back">
        <Table headers={['Source', 'Movements', 'Value', 'Pot', 'What it means']}>
          {snap.sources.map(s => {
            const rows = snap.ledger.filter(l => l.source === s.id)
            /* Grouped rather than added: one source draws from wallets in three
               currencies, and the sum of those is not a figure. */
            const value = byCurrency(rows.map(l => money(Math.abs(Number(l.amount)), curOf(l.wallet_id))))
            return (
              <tr key={s.id}>
                <Td kind="text"><strong>{s.label}</strong></Td>
                <Td kind="num">{fmtInt(rows.length)}</Td>
                <Td kind="num">
                  {value.length === 0
                    ? 'Nothing held'
                    : value.map(g => <div key={g.currency}>{fmtIn(g.total.amount, g.currency)}</div>)}
                </Td>
                <Td kind="status">
                  <StatusBadge tone={s.pot === 'cash' ? 'danger' : 'success'} icon={null}>
                    {s.pot === 'cash' ? "The customer's" : 'Not refundable'}
                  </StatusBadge>
                </Td>
                <Td kind="text"><span className="c-sub">{s.note}</span></Td>
              </tr>
            )
          })}
        </Table>
      </SectionCard>

      <SectionCard title={`Accounts (${snap.wallets.length})`}
                   subtitle="Consumers and businesses alike. Open one to see how its balance was reached.">
        {snap.wallets.length === 0 ? <EmptyState message="No wallets" /> : (
          <><Table headers={['Holder', 'Type', 'Their money', 'Our credit', 'Balance', 'Opened', 'Last movement', 'State']}>
            {walletsPage.rows.map(w => (
              <tr key={w.id} style={{ cursor: 'pointer' }} onClick={() => setOpen(w.id)}>
                <Td kind="text" style={{ maxWidth: '28ch' }}>
                  <div style={{ fontWeight: 700, color: 'var(--brand-navy)' }}><span className="c-td__clamp" style={{ WebkitLineClamp: 2 }} title={w.name}>{w.name}</span></div>
                  <div className="c-sub">{w.party} · {w.id}</div>
                </Td>
                <Td kind="text" nowrap>{w.kind}</Td>
                <Td kind="num">{fmtIn(Number(w.cash), w.currency)}</Td>
                <Td kind="num">{Number(w.promo) === 0 ? '—' : fmtIn(Number(w.promo), w.currency)}</Td>
                <Td kind="num"><strong>{fmtIn(Number(w.balance), w.currency)}</strong></Td>
                <Td kind="date">{fmtDate(w.opened)}</Td>
                <Td kind="date">{fmtDate(w.last_move)}</Td>
                <Td kind="status">
                  <StatusBadge tone={STATE_TONE[w.state] ?? 'neutral'} icon={null}>{w.state}</StatusBadge>
                </Td>
              </tr>
            ))}
          </Table>
          <div style={{ padding: '0 18px 12px' }}><Pager page={walletsPage} noun="wallets" /></div></>
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
  /* Everything in this drawer is one wallet's, so it is all in one currency —
     the wallet's. Nothing here is converted and nothing needs grouping. */
  const { fmtIn } = useMarket()
  const mny = (n: number) => fmtIn(Number(n), wallet.currency)
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
            <StatusBadge tone={STATE_TONE[wallet.state] ?? 'neutral'} icon={null}>{wallet.state}</StatusBadge>
          </div>
          <div className="c-sub">
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
              ['Their money', mny(wallet.cash), 'var(--danger)'],
              ['Our credit', mny(wallet.promo), 'var(--success)'],
              ['Balance', mny(wallet.balance), 'var(--text)'],
            ] as [string, string, string][]).map(([k, v, ink]) => (
              <div key={k} style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: '10px 12px' }}>
                <div className="c-sub" style={{ textTransform: 'uppercase', letterSpacing: '0.03em', fontWeight: 700 }}>{k}</div>
                <div style={{ fontSize: 'var(--text-lg)', fontWeight: 800, color: ink }}>{v}</div>
              </div>
            ))}
          </div>

          {closure && (
            <Callout tone={closure.state === 'returned' ? 'success' : 'warning'}
                     title={closure.state === 'returned' ? 'Closed and settled' : 'Closing — money still owed'}>
              {mny(closure.cash_returned)} returned to {closure.instrument};
              {' '}{mny(closure.promo_written_off)} of promotional credit written off.
              {closure.note && ` ${closure.note}`}
            </Callout>
          )}

          <div>
            <div style={{ fontSize: 'var(--text-sm)', fontWeight: 700, marginBottom: '7px' }}>
              Statement <span className="c-sub" style={{ fontWeight: 400 }}>· newest first</span>
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
                      <span className="c-sub" style={{ minWidth: '78px' }}>{fmtDate(e.when_date)}</span>
                      <div style={{ flex: 1, minWidth: '170px' }}>
                        <div>{e.what}</div>
                        <div style={{ color: e.pot === 'cash' ? 'var(--danger)' : 'var(--success)' }}>
                          {src?.label ?? e.source} · {e.pot === 'cash' ? "the customer's money" : 'credit we issued'}
                        </div>
                      </div>
                      <span style={{
                        fontWeight: 700, minWidth: '72px', textAlign: 'right',
                        color: Number(e.amount) < 0 ? 'var(--text-secondary)' : 'var(--success)',
                      }}>
                        {Number(e.amount) < 0 ? '−' : '+'}{mny(Math.abs(Number(e.amount)))}
                      </span>
                      <span className="c-sub" style={{ minWidth: '62px', textAlign: 'right' }}>
                        {mny(e.balance)}
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
              {mny(wallet.cash)} of this is the holder's own money. If they close the account it
              goes back to the instrument that funded it, and the marketplace cannot keep it.
            </Callout>
          )}
        </div>
      </div>
    </div>
  )
}
