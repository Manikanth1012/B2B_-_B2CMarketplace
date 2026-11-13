import { Fragment, useEffect, useMemo, useState } from 'react'
import { ShoppingBasket } from 'lucide-react'
import { BentoCard } from '../ui/BentoCard'
import { StatusBadge } from '../ui/StatusBadge'
import { Btn, EmptyState, Table, Td, fmtDateTime } from './shared'
import { Callout } from '../OnboardingJourney'
import { useMarket } from '../../lib/MarketContext'
import { loadWatchedBaskets, remindBasketOwner } from '../../lib/basketRepo'
import type { WatchedBaskets, WatchedLine } from '../../lib/basketRepo'
import { IDLE_DAYS, IDLE_LABEL, basketValue, cartsByUser, flagCount, idleState } from '../../lib/baskets'
import type { IdleState } from '../../lib/baskets'

/* Baskets the marketplace is keeping (spec 11, decision 2c): business buyers'
   requisition baskets and shoppers' carts, a tab each. Pending is a basket
   changed in the last seven days; Abandoned, one left longer. The operator can
   read the lines and their stock notes and send the owner one in-app reminder
   a day, and never deletes a basket — the night clears those untouched for 90
   days. Before the baskets migration the screen says it is not set up yet. */

type Tab = 'business' | 'shoppers'
type Filter = 'all' | IdleState

interface Row {
  kind: 'requisition' | 'cart'
  /** What remind_basket_owner takes: the basket's id, or the shopper's user id. */
  id: string
  owner: string
  email: string | null
  account: string | null
  lineCount: number
  value: number
  unpriced: number
  currency: string | null
  lastChange: string
  state: IdleState
  flags: number
  remindedAt: string | null
  lines: WatchedLine[]
}

function rowsOf(w: WatchedBaskets, now: Date): { business: Row[]; shoppers: Row[] } {
  const business: Row[] = w.business.map(b => ({
    kind: 'requisition', id: b.id, owner: b.owner, email: b.email, account: b.account,
    lineCount: b.lines.length,
    value: basketValue(b.lines.map(l => ({ quantity: l.quantity, unit_price: l.unit_price ?? 0 }))),
    unpriced: b.lines.filter(l => l.unit_price === null).length,
    currency: b.currency, lastChange: b.updated_at, state: idleState(b.updated_at, now),
    flags: flagCount(b.lines), remindedAt: b.reminded_at, lines: b.lines,
  }))
  const shoppers: Row[] = cartsByUser(w.cartLines).map(c => {
    const who = w.shoppers.get(c.user_id)
    return {
      kind: 'cart', id: c.user_id, owner: who?.name || 'Unknown shopper', email: who?.email ?? null, account: null,
      lineCount: c.lineCount, value: c.value, unpriced: c.unpriced, currency: who?.currency ?? null,
      lastChange: c.lastChange, state: idleState(c.lastChange, now), flags: c.flags,
      remindedAt: w.cartReminders.get(c.user_id) ?? null, lines: c.lines,
    }
  })
  return { business, shoppers }
}

export function OperatorBaskets() {
  const { fmtIn } = useMarket()
  const [data, setData] = useState<WatchedBaskets | null>(null)
  const [problem, setProblem] = useState<{ missing: boolean; error: string } | null>(null)
  const [tab, setTab] = useState<Tab>('business')
  const [filter, setFilter] = useState<Filter>('all')
  const [openId, setOpenId] = useState<string | null>(null)
  const [sending, setSending] = useState<string | null>(null)
  /* The answer to the last Send reminder, said beside the row it was for. */
  const [said, setSaid] = useState<{ id: string; ok: boolean; text: string } | null>(null)
  /* Reminders sent from this screen, so the row shows them without a re-read. */
  const [sent, setSent] = useState<Map<string, string>>(new Map())

  useEffect(() => {
    let live = true
    void loadWatchedBaskets().then(r => {
      if (!live) return
      if (r.ok) setData(r.value)
      else setProblem({ missing: r.missing, error: r.error })
    })
    return () => { live = false }
  }, [])

  const now = useMemo(() => new Date(), [data])
  const rows = useMemo(() => (data ? rowsOf(data, now) : { business: [], shoppers: [] }), [data, now])
  const list = rows[tab]
  const shown = list.filter(r => filter === 'all' || r.state === filter)
  const counts = {
    all: list.length,
    pending: list.filter(r => r.state === 'pending').length,
    abandoned: list.filter(r => r.state === 'abandoned').length,
  }

  const money = (r: Row) => (r.currency ? fmtIn(r.value, r.currency) : String(r.value))

  const remind = async (r: Row) => {
    setSending(r.id)
    setSaid(null)
    const res = await remindBasketOwner(r.kind, r.id)
    setSending(null)
    if (!res.ok) { setSaid({ id: r.id, ok: false, text: res.error }); return }
    setSent(m => new Map(m).set(`${r.kind}:${r.id}`, res.value.reminded_at))
    setSaid({ id: r.id, ok: true, text: `Reminder sent to ${r.owner} about ${res.value.lines} ${res.value.lines === 1 ? 'item' : 'items'}. They will see it in their notifications.` })
  }

  return (
    <div className="op-baskets">
      <div>
        <h1 style={{ fontSize: 'var(--text-2xl)', fontWeight: 800, color: 'var(--text)' }}>Baskets</h1>
        <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)', marginTop: '4px' }}>
          What buyers have collected and not yet bought. Pending: changed in the last {IDLE_DAYS} days. Abandoned: left
          for {IDLE_DAYS} days or more. Baskets untouched for 90 days are cleared by the nightly run.
        </p>
      </div>

      {problem?.missing && (
        <Callout tone="info" title="Baskets are not set up yet">
          This database does not keep baskets yet (the baskets migration is not applied), so there is nothing to show.
          Business baskets stay in the buyer&rsquo;s browser until it is.
        </Callout>
      )}
      {problem && !problem.missing && (
        <div role="alert" className="op-baskets__error">The baskets could not be read: {problem.error}</div>
      )}
      {!problem && !data && <p role="status" className="op-baskets__note">Loading baskets…</p>}

      {data && (
        <BentoCard as="article" headingLevel={2} title={tab === 'business' ? 'Business baskets' : 'Shopper baskets'}>
          <div role="tablist" aria-label="Whose baskets" className="op-baskets__tabs">
            {(['business', 'shoppers'] as const).map(t => (
              <button key={t} type="button" role="tab" id={`op-baskets-tab-${t}`} aria-selected={tab === t}
                aria-controls="op-baskets-panel" className="op-baskets__tab"
                onClick={() => { setTab(t); setOpenId(null); setSaid(null) }}>
                {t === 'business' ? 'Business' : 'Shoppers'} ({rows[t].length})
              </button>
            ))}
          </div>

          <div id="op-baskets-panel" role="tabpanel" aria-labelledby={`op-baskets-tab-${tab}`}>
            <div role="group" aria-label="Show" className="op-baskets__filters">
              {(['all', 'pending', 'abandoned'] as const).map(f => (
                <button key={f} type="button" aria-pressed={filter === f} className="op-baskets__filter"
                  onClick={() => setFilter(f)}>
                  {f === 'all' ? 'All' : IDLE_LABEL[f]} ({counts[f]})
                </button>
              ))}
            </div>

            {shown.length === 0 ? (
              <EmptyState icon={<ShoppingBasket size={28} />}
                message={list.length === 0
                  ? (tab === 'business' ? 'No business buyer has a basket open.' : 'No shopper has a basket open.')
                  : `No ${filter === 'all' ? '' : `${IDLE_LABEL[filter as IdleState].toLowerCase()} `}baskets.`} />
            ) : (
              <Table headers={['Owner', { label: 'Lines', align: 'right' }, { label: 'Value', align: 'right' }, 'Last change', 'State', { label: 'Stock flags', align: 'right' }, 'Last reminder', '']}>
                {shown.map(r => {
                  const open = openId === r.id
                  const reminded = sent.get(`${r.kind}:${r.id}`) ?? r.remindedAt
                  return (
                    <Fragment key={`${r.kind}:${r.id}`}>
                      <tr>
                        <Td>
                          <div style={{ fontWeight: 600 }}>{r.owner}</div>
                          <div className="op-baskets__sub">{r.email ?? 'No email on file'}{r.account ? ` · ${r.account}` : ''}</div>
                        </Td>
                        <Td right>{r.lineCount}</Td>
                        <Td right>
                          {money(r)}
                          {r.unpriced > 0 && <div className="op-baskets__sub">{r.unpriced} not priced</div>}
                        </Td>
                        <Td>{fmtDateTime(r.lastChange || null)}</Td>
                        <Td>
                          <StatusBadge tone={r.state === 'abandoned' ? 'warning' : 'info'}>{IDLE_LABEL[r.state]}</StatusBadge>
                        </Td>
                        <Td right>{r.flags === 0 ? 'None' : r.flags}</Td>
                        <Td>{reminded ? fmtDateTime(reminded) : 'Never'}</Td>
                        <Td>
                          <Btn variant="secondary" size="sm" className="op-baskets__btn" aria-expanded={open}
                            onClick={() => { setOpenId(open ? null : r.id); setSaid(null) }}>
                            {open ? 'Close' : 'Open'}<span className="sr-only"> {r.owner}&rsquo;s basket</span>
                          </Btn>
                        </Td>
                      </tr>
                      {open && (
                        <tr>
                          <td colSpan={8} className="op-baskets__detail">
                            <ul className="op-baskets__lines" aria-label={`${r.owner}’s basket`}>
                              {r.lines.map(l => (
                                <li key={l.id} className="op-baskets__line">
                                  <span>
                                    <strong>{l.name}</strong> × {l.quantity}
                                    {l.bundle_selection_id && <span className="op-baskets__sub"> · part of a bundle</span>}
                                  </span>
                                  <span>{l.unit_price === null || !r.currency ? 'Not priced' : fmtIn(l.unit_price * l.quantity, r.currency)}</span>
                                  {l.stock_note && (
                                    <span className="op-baskets__flag">
                                      <StatusBadge tone="danger">Stock flag</StatusBadge> {l.stock_note}
                                    </span>
                                  )}
                                </li>
                              ))}
                            </ul>
                            <div className="op-baskets__actions">
                              <Btn variant="primary" size="sm" className="op-baskets__btn" disabled={sending === r.id}
                                onClick={() => { void remind(r) }}>
                                {sending === r.id ? 'Sending…' : 'Send reminder'}
                              </Btn>
                              <span className="op-baskets__sub">One in-app reminder a day at most.</span>
                            </div>
                            {said?.id === r.id && (
                              <p role={said.ok ? 'status' : 'alert'} className={said.ok ? 'op-baskets__sent' : 'op-baskets__refused'}>
                                {said.ok ? 'Sent: ' : 'Not sent: '}{said.text}
                              </p>
                            )}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })}
              </Table>
            )}
          </div>
        </BentoCard>
      )}
    </div>
  )
}
