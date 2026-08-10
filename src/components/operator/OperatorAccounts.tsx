import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  Building2, Users, Check, Clock, TriangleAlert as AlertTriangle, Inbox, Search,
} from 'lucide-react'
import { Pager, usePaging } from '../Pager'
import { StatCard, SectionCard, Table, Td, StatusPill, Btn, EmptyState, fmtInt } from './shared'
import { Callout } from '../OnboardingJourney'
import { useMarket } from '../../lib/MarketContext'
import { loadAccountBook } from '../../lib/accountsRepo'
import type { AccountBook } from '../../lib/accountsRepo'
import {
  stepsOf, progressOf, isLate, whereTheyAre, rollup, matches, deskOrder, shopperLine,
} from '../../lib/accounts'
import type { Account, Step } from '../../lib/accounts'
import type { OperatorView } from '../../types/view'

/* Who the marketplace's customers are, and where each of them has got to.
 *
 * The console had Sellers and no Accounts. Companies turned up sideways — in
 * Credit & Exposure, in Agreements, in Wallets — each screen showing the slice
 * it needed, none of them answering "who are our customers". Retail shoppers
 * appeared nowhere at all.
 *
 * The sharper half was onboarding. Six steps decide whether a company can open
 * an account, one of them the credit assessment the marketplace staffs itself,
 * and they were readable only from the customer's own console. The desk that
 * owns the gate could not see the gate. Sellers have had a journey rail since
 * the beginning; companies had nothing after the accept button.
 *
 * The applications queue is not rebuilt here. Deciding a company and deciding a
 * seller is one desk's work and it already has a screen — this one counts what
 * is waiting and sends you there, rather than growing a second queue that would
 * drift from the first.
 */

const TODAY = new Date().toISOString().slice(0, 10)

export function OperatorAccounts({ onNavigate }: { onNavigate?: (v: OperatorView) => void }) {
  const { fmtIn } = useMarket()
  const [book, setBook] = useState<AccountBook | null>(null)
  const [tab, setTab] = useState<'business' | 'retail'>('business')
  const [q, setQ] = useState('')
  const [openId, setOpenId] = useState<string | null>(null)

  const reload = useCallback(async () => setBook(await loadAccountBook()), [])
  useEffect(() => { void reload() }, [reload])

  const accounts = book?.accounts ?? []
  const steps = book?.steps ?? []

  const ordered = useMemo(
    () => deskOrder(accounts.filter(a => matches(a, q)), steps, TODAY),
    [accounts, steps, q])
  const shoppers = useMemo(
    () => (book?.shoppers ?? []).filter(s =>
      !q.trim() || [s.name, s.email ?? '', s.market ?? ''].some(v => v.toLowerCase().includes(q.trim().toLowerCase()))),
    [book?.shoppers, q])

  /* Above the loading guard — a hook after an early return runs on some renders
     and not others. */
  const bizPage = usePaging(ordered, { resetKey: q + tab })
  const retailPage = usePaging(shoppers, { resetKey: q + tab })

  if (!book) {
    return <div style={{ textAlign: 'center', padding: '40px' }}><div className="spinner" style={{ margin: '0 auto' }} /></div>
  }

  const totals = rollup({ accounts, steps, waiting: book.waiting, today: TODAY })
  const open = openId ? accounts.find(a => a.id === openId) ?? null : null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div>
        <h1 style={{ fontSize: 'var(--text-2xl)', fontWeight: 800, margin: 0 }}>Accounts</h1>
        <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)', marginTop: '4px' }}>
          Who buys from this marketplace — companies and their onboarding, and the people who shop here.
        </p>
      </div>

      {book.loadError && (
        <Callout tone="danger" title="Some of this screen did not load">{book.loadError}</Callout>
      )}

      <div style={{ display: 'grid', gap: '12px', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
        <StatCard label="Business accounts" value={fmtInt(totals.accounts)}
          sublabel={`${totals.onboarded} through every gate`} />
        <StatCard label="Part-way through" value={fmtInt(totals.inFlight)}
          sublabel="still have a gate outstanding" />
        <StatCard label="Overdue" value={fmtInt(totals.overdue)}
          sublabel={totals.overdue ? 'a gate or a review past its date' : 'nothing past its date'}
          color={totals.overdue ? 'var(--danger)' : undefined} />
        <StatCard label="Waiting to be decided" value={fmtInt(totals.waiting)}
          sublabel="companies who have applied"
          color={totals.waiting ? 'var(--warning)' : undefined} />
        <StatCard label="Retail customers" value={fmtInt(book.shoppers.length)}
          sublabel="people with an account here" />
      </div>

      {totals.waiting > 0 && (
        <Callout tone="warning" title={`${totals.waiting} ${totals.waiting === 1 ? 'company is' : 'companies are'} waiting on the desk`}>
          They are applications, not accounts — nobody has decided them yet, so there is nothing to onboard.
          They are decided on Onboarding, in the same queue as the sellers, because it is the same desk doing it.
          {onNavigate && (
            <div style={{ marginTop: '10px' }}>
              <Btn variant="secondary" onClick={() => onNavigate('op-onboarding')}>
                <Inbox size={14} /> Open the queue
              </Btn>
            </div>
          )}
        </Callout>
      )}

      <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: '4px' }}>
          <Btn variant={tab === 'business' ? 'primary' : 'secondary'} onClick={() => setTab('business')}>
            <Building2 size={14} /> Businesses ({accounts.length})
          </Btn>
          <Btn variant={tab === 'retail' ? 'primary' : 'secondary'} onClick={() => setTab('retail')}>
            <Users size={14} /> Retail customers ({book.shoppers.length})
          </Btn>
        </div>
        <div style={{ position: 'relative', flex: '1 1 240px', minWidth: 0 }}>
          <Search size={14} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-tertiary)' }} />
          <input className="input" value={q} onChange={e => setQ(e.target.value)}
            placeholder={tab === 'business' ? 'Company, market, industry…' : 'Name, email, market…'}
            style={{ paddingLeft: '30px', width: '100%' }} />
        </div>
      </div>

      {tab === 'business' ? (
        <SectionCard title="Business accounts"
          subtitle="Whoever needs something doing about them, first.">
          {ordered.length === 0 ? (
            <EmptyState message={q ? 'No company matches that.' : 'No business accounts yet.'} />
          ) : (
            <>
              <Table headers={['Company', 'Market', 'Terms', 'Credit', 'Onboarding', 'Where they are', '']}>
                {bizPage.rows.map(a => {
                  const mine = stepsOf(steps, a.id)
                  const p = progressOf(mine)
                  const c = book.credit.find(x => x.account_id === a.id)
                  /* The review counts as work even on an account that has
                     passed every gate — it is why the row can be both
                     onboarded and red. */
                  const late = [p.next, p.review].some(
                    x => !!x && (x.state === 'overdue' || isLate(x, TODAY)))
                  return (
                    <tr key={a.id}>
                      <Td>
                        <div style={{ fontWeight: 600 }}>{a.company}</div>
                        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
                          {a.id} · {a.segment}{a.industry ? ` · ${a.industry}` : ''}
                        </div>
                      </Td>
                      <Td>{a.market}</Td>
                      <Td>{a.terms}</Td>
                      <Td>
                        {c ? (
                          <>
                            <StatusPill status={c.band} />
                            {c.limit_granted != null && (
                              <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', marginTop: '2px' }}>
                                {fmtIn(c.limit_granted, c.currency)}
                              </div>
                            )}
                          </>
                        ) : (
                          <span style={{ color: 'var(--danger)', fontSize: 'var(--text-xs)', fontWeight: 600 }}>
                            No assessment
                          </span>
                        )}
                      </Td>
                      <Td>
                        <Bar done={p.done} of={p.of}
                             late={!!p.next && (p.next.state === 'overdue' || isLate(p.next, TODAY))} />
                      </Td>
                      <Td>
                        <span style={{ color: late ? 'var(--danger)' : undefined, fontWeight: late ? 600 : 400 }}>
                          {whereTheyAre(p, TODAY)}
                        </span>
                      </Td>
                      <Td>
                        <Btn variant="secondary"
                          onClick={() => setOpenId(openId === a.id ? null : a.id)}>
                          {openId === a.id ? 'Hide' : 'Journey'}
                        </Btn>
                      </Td>
                    </tr>
                  )
                })}
              </Table>
              <Pager page={bizPage} noun="accounts" />
            </>
          )}
        </SectionCard>
      ) : (
        <SectionCard title="Retail customers" subtitle="People who shop here, and what they are worth to us.">
          {shoppers.length === 0 ? (
            <EmptyState message={q ? 'Nobody matches that.' : 'No retail customers yet.'} />
          ) : (
            <>
              <Table headers={['Customer', 'Where', 'Tier', 'Points', 'With us since']}>
                {retailPage.rows.map(s => (
                  <tr key={s.id}>
                    <Td>
                      <div style={{ fontWeight: 600 }}>{s.name}</div>
                      {s.email && (
                        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>{s.email}</div>
                      )}
                    </Td>
                    <Td>{shopperLine(s)}</Td>
                    <Td>{s.tier ?? '—'}</Td>
                    <Td right>{s.points ? fmtInt(s.points) : '—'}</Td>
                    <Td>{s.joined ?? '—'}</Td>
                  </tr>
                ))}
              </Table>
              <Pager page={retailPage} noun="customers" />
            </>
          )}
        </SectionCard>
      )}

      {open && (
        <Journey account={open} steps={stepsOf(steps, open.id)} />
      )}
    </div>
  )
}

/* How far along, at a glance. A fraction is exact and unreadable at a hundred
   rows; a bar is readable and imprecise. Both, so neither has to be. */
function Bar({ done, of, late }: { done: number; of: number; late: boolean }) {
  if (of === 0) return <span style={{ color: 'var(--danger)', fontSize: 'var(--text-xs)' }}>none</span>
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: '92px' }}>
      <div style={{ flex: 1, height: '6px', borderRadius: '3px', background: 'var(--bg-alt)', overflow: 'hidden' }}>
        <div style={{
          width: `${Math.round(done / of * 100)}%`, height: '100%',
          background: late ? 'var(--danger)' : done === of ? 'var(--success)' : 'var(--brand-accent)',
        }} />
      </div>
      <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', whiteSpace: 'nowrap' }}>
        {done}/{of}
      </span>
    </div>
  )
}

/* The six steps, in order, with who did each and when — the rail sellers have
   had since the beginning and companies never got. */
function Journey({ account, steps }: { account: Account; steps: Step[] }) {
  return (
    <SectionCard title={`${account.company} — onboarding`}
      subtitle={`${account.id} · ${account.legal_name ?? account.company} · ${account.market} · ${account.terms}`}>
      {steps.length === 0 ? (
        <EmptyState message="This account has no onboarding record at all." />
      ) : (
        <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: '2px' }}>
          {steps.map((s, i) => {
            const done = s.state === 'done' || s.state === 'waived'
            const late = s.state === 'overdue' || isLate(s, TODAY)
            const tone = done ? 'var(--success)' : late ? 'var(--danger)' : 'var(--warning)'
            return (
              <div key={s.id} style={{ display: 'flex', gap: '12px' }}>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0 }}>
                  <div style={{
                    width: '22px', height: '22px', borderRadius: '50%', background: tone,
                    color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    {done ? <Check size={12} /> : late ? <AlertTriangle size={12} /> : <Clock size={12} />}
                  </div>
                  {i < steps.length - 1 && (
                    <div style={{ width: '2px', flex: 1, minHeight: '26px', background: 'var(--border-light)' }} />
                  )}
                </div>
                <div style={{ paddingBottom: '16px', minWidth: 0 }}>
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'baseline', flexWrap: 'wrap' }}>
                    <span style={{ fontWeight: 700, fontSize: 'var(--text-sm)' }}>{s.name}</span>
                    <span style={{ fontSize: 'var(--text-xs)', color: late ? 'var(--danger)' : 'var(--text-tertiary)' }}>
                      {done
                        ? `${s.done_on ?? ''}${s.done_by ? ` · ${s.done_by}` : ''}`
                        : late
                          ? `overdue since ${s.due_on}`
                          : s.due_on ? `due ${s.due_on}` : 'no date set'}
                    </span>
                  </div>
                  <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', lineHeight: 1.55, marginTop: '2px' }}>
                    {s.detail}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </SectionCard>
  )
}
