import { Fragment, useEffect, useMemo, useState } from 'react'
import { ShoppingBasket } from 'lucide-react'
import { BentoCard } from '../ui/BentoCard'
import { StatusBadge } from '../ui/StatusBadge'
import { Btn, EmptyState, Table, Td, fmtDateTime, PageHeader, RowActions } from './shared'
import { BasketRulesDrawer } from './BasketRulesDrawer'
import { Tabs } from '../ui/Tabs'
import { Callout } from '../OnboardingJourney'
import { useMarket } from '../../lib/MarketContext'
import { loadWatchedBaskets, remindBasketOwner } from '../../lib/basketRepo'
import type { WatchedBaskets, WatchedLine } from '../../lib/basketRepo'
import { IDLE_LABEL, basketValue, cartsByUser, flagCount, idleState } from '../../lib/baskets'
import { loadBasketSettings, loadScheduleLog } from '../../lib/remindersRepo'
import type { BasketSettings } from '../../lib/remindersRepo'
import { DEFAULT_BASKET_WINDOW, basketStateFor, windowFor } from '../../lib/reminders'
import type { BasketWindow } from '../../lib/reminders'
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

/* Pending or Abandoned on the given rules. The basket rows do not carry a market,
   so the default rules judge them; without the settings table it is the old
   seven days. A basket nearing clearing is still Abandoned on this screen. */
function stateOn(win: BasketWindow | null, lastChange: string, now: Date): IdleState {
  if (!win) return idleState(lastChange, now)
  return basketStateFor(lastChange, win, now) === 'pending' ? 'pending' : 'abandoned'
}

/* The newest of a manual and a scheduled reminder. */
const later = (a: string | null, b: string | null): string | null =>
  a && b ? (Date.parse(a) >= Date.parse(b) ? a : b) : (a ?? b)

function rowsOf(w: WatchedBaskets, now: Date, win: BasketWindow | null, scheduled: Map<string, string>): { business: Row[]; shoppers: Row[] } {
  const business: Row[] = w.business.map(b => ({
    kind: 'requisition', id: b.id, owner: b.owner, email: b.email, account: b.account,
    lineCount: b.lines.length,
    value: basketValue(b.lines.map(l => ({ quantity: l.quantity, unit_price: l.unit_price ?? 0 }))),
    unpriced: b.lines.filter(l => l.unit_price === null).length,
    currency: b.currency, lastChange: b.updated_at, state: stateOn(win, b.updated_at, now),
    flags: flagCount(b.lines), remindedAt: later(b.reminded_at, scheduled.get(b.id) ?? null), lines: b.lines,
  }))
  const shoppers: Row[] = cartsByUser(w.cartLines).map(c => {
    const who = w.shoppers.get(c.user_id)
    return {
      kind: 'cart', id: c.user_id, owner: who?.name || 'Unknown shopper', email: who?.email ?? null, account: null,
      lineCount: c.lineCount, value: c.value, unpriced: c.unpriced, currency: who?.currency ?? null,
      lastChange: c.lastChange, state: stateOn(win, c.lastChange, now), flags: c.flags,
      remindedAt: later(w.cartReminders.get(c.user_id) ?? null, scheduled.get(`cart:${c.user_id}`) ?? null), lines: c.lines,
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

  /* Spec 19: the rules the baskets are judged by, and what the night has sent.
     Both come from tables the migration adds; missing, the screen keeps working
     on the old seven days and the manual reminder alone. */
  const [settings, setSettings] = useState<BasketSettings[] | null>(null)
  const [rulesMissing, setRulesMissing] = useState(false)
  const [scheduled, setScheduled] = useState<Map<string, string>>(new Map())
  const [rulesOpen, setRulesOpen] = useState(false)

  const loadRules = async () => {
    const r = await loadBasketSettings()
    if (r.ok) { setSettings(r.value); setRulesMissing(false) } else setRulesMissing(r.missing)
  }

  useEffect(() => {
    let live = true
    void loadBasketSettings().then(r => {
      if (!live) return
      if (r.ok) setSettings(r.value); else setRulesMissing(r.missing)
    })
    /* "Last reminder" is the later of the manual one and the latest scheduled
       send for that owner (a sent row in the schedule log, newest 500). */
    void loadScheduleLog().then(r => {
      if (!live || !r.ok) return
      const m = new Map<string, string>()
      for (const l of r.value) {
        if (l.outcome !== 'sent') continue
        const at = l.created_at
        const had = m.get(l.subject_id)
        if (!had || Date.parse(at) > Date.parse(had)) m.set(l.subject_id, at)
      }
      setScheduled(m)
    })
    return () => { live = false }
  }, [])

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
  const win = useMemo<BasketWindow | null>(() => (settings ? windowFor(settings, 'default') : null), [settings])
  const rows = useMemo(() => (data ? rowsOf(data, now, win, scheduled) : { business: [], shoppers: [] }),
    [data, now, win, scheduled])
  const eff = win ?? DEFAULT_BASKET_WINDOW
  const days = (n: number) => `${n} ${n === 1 ? 'day' : 'days'}`
  const perMarket = (settings ?? []).some(s => s.market !== 'default' && win
    && (s.pending_days !== win.pending_days || s.abandoned_after_days !== win.abandoned_after_days
      || s.clear_after_days !== win.clear_after_days))
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
      <PageHeader
        title="Baskets"
        description={`What buyers have collected and not yet bought. Pending: changed in the last ${days(eff.pending_days)}. Abandoned: left for ${days(eff.abandoned_after_days)} or more. Baskets untouched for ${days(eff.clear_after_days)} are cleared by the nightly run.${perMarket ? ' These are the default rules; some markets have their own.' : ''}`}
        actions={settings && data ? <Btn variant="secondary" onClick={() => setRulesOpen(true)}>Basket rules</Btn> : undefined}>
        {data && (
          <Tabs ariaLabel="Whose baskets" panelIdPrefix="op-baskets-panel-" value={tab}
            onChange={id => { setTab(id as Tab); setOpenId(null); setSaid(null) }}
            tabs={[
              { id: 'business', label: 'Business', count: rows.business.length },
              { id: 'shoppers', label: 'Shoppers', count: rows.shoppers.length },
            ]} />
        )}
      </PageHeader>

      {problem?.missing && (
        <Callout tone="info" title="Baskets are not set up yet">
          This database does not keep baskets yet (the baskets migration is not applied), so there is nothing to show.
          Until it is, a business buyer&rsquo;s basket is kept only in the page they have open, and is lost when they
          reload or close it.
        </Callout>
      )}
      {rulesMissing && data && (
        <Callout tone="info" title="Basket rules and scheduled reminders">
          Scheduled reminders arrive with migration 20261127400000. Until it is applied, baskets are judged on the
          fixed 7 and 90 days and only the manual reminder is shown.
        </Callout>
      )}
      {problem && !problem.missing && (
        <div role="alert" className="op-baskets__error">The baskets could not be read: {problem.error}</div>
      )}
      {!problem && !data && <p role="status" className="op-baskets__note">Loading baskets…</p>}

      {data && (
        <BentoCard as="article" headingLevel={2} title={tab === 'business' ? 'Business baskets' : 'Shopper baskets'}>
          <div id={`op-baskets-panel-${tab}`} aria-labelledby={`op-baskets-panel-${tab}-tab`} role="tabpanel">
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
              <Table headers={['Owner', 'Lines', 'Value', 'Last change', 'State', 'Stock flags', 'Last reminder', 'Actions']}>
                {shown.map(r => {
                  const open = openId === r.id
                  const reminded = sent.get(`${r.kind}:${r.id}`) ?? r.remindedAt
                  return (
                    <Fragment key={`${r.kind}:${r.id}`}>
                      <tr>
                        <Td>
                          <div style={{ fontWeight: 600 }}><span className="c-td__clamp" style={{ WebkitLineClamp: 2 }} title={r.owner}>{r.owner}</span></div>
                          <div className="op-baskets__sub">{r.email ?? 'No email on file'}{r.account ? ` · ${r.account}` : ''}</div>
                        </Td>
                        <Td kind="num">{r.lineCount}</Td>
                        <Td kind="num">
                          {money(r)}
                          {r.unpriced > 0 && <div className="op-baskets__sub">{r.unpriced} not priced</div>}
                        </Td>
                        <Td kind="date">{fmtDateTime(r.lastChange || null)}</Td>
                        <Td kind="status">
                          <StatusBadge tone={r.state === 'abandoned' ? 'warning' : 'info'}>{IDLE_LABEL[r.state]}</StatusBadge>
                        </Td>
                        <Td kind="num">{r.flags === 0 ? 'None' : r.flags}</Td>
                        <Td kind="date">{reminded ? fmtDateTime(reminded) : 'Never'}</Td>
                        <Td>
                          <RowActions label={r.owner} actions={[{
                            id: 'toggle', label: open ? 'Close' : 'Open', variant: 'secondary',
                            srOnly: `${r.owner}’s basket`, expanded: open,
                            onClick: () => { setOpenId(open ? null : r.id); setSaid(null) },
                          }]} />
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

      {settings && rulesOpen && (
        <BasketRulesDrawer open onClose={() => setRulesOpen(false)} settings={settings}
          baskets={[...rows.business, ...rows.shoppers]} onSaved={loadRules} />
      )}
    </div>
  )
}
