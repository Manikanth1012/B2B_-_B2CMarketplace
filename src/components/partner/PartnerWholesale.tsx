import { useState, useEffect, useCallback } from 'react'
import {
  ShoppingBag, Check, Ban, Info,
} from 'lucide-react'
import {
  StatCard, SectionCard, Table, Td, StatusPill, Btn, toast,
  Modal, FormField, TextArea,
} from '../operator/shared'
import { Callout } from '../OnboardingJourney'
import { useMarket } from '../../lib/MarketContext'
import {
  partnerShelf, shelfPrices, purchases, charges, recoveries, accruing, buy, cancel,
} from '../../lib/wholesaleRepo'
import type { WholesaleAccruing } from '../../lib/wholesaleRepo'
import {
  buyProblem, chargeLine, monthlyCost, outstanding, chargesOver,
} from '../../lib/wholesale'
import type { Purchase, Charge, Sellable } from '../../lib/wholesale'
import { loadSellerRecord } from '../../lib/partnerRepo'
import type { SellerRecord } from '../../lib/partnerRepo'

/* What this seller buys from the marketplace, and how it comes off what they
 * are owed.
 *
 * Six products carried the `partner` audience and were shown on the reseller
 * shelf. Nothing could buy one — the audience was a label on a product rather
 * than a thing a partner could do.
 *
 * Nothing is paid here. The marketplace already owes this seller a settlement
 * every cycle, and what they take comes off it. That is why the page leads with
 * what this cycle will cost rather than with a basket: the number that matters
 * is the one that lands in the bank, and it is the settlement figure minus
 * this.
 */

export function PartnerWholesale({ partnerId }: { partnerId: string }) {
  const { fmtIn } = useMarket()
  /* Settlements are denominated in dollars and so is everything here. The
     seller's payout currency is applied when the run pays the net, and this
     page is upstream of that. */
  const usd = (n: number) => fmtIn(n, 'USD')

  const [shelf, setShelf] = useState<Sellable[]>([])
  const [prices, setPrices] = useState<Record<string, number>>({})
  const [mine, setMine] = useState<Purchase[]>([])
  const [bills, setBills] = useState<Charge[]>([])
  const [took, setTook] = useState<{ charge_id: string; statement_id: string; amount: number }[]>([])
  const [cycle, setCycle] = useState<WholesaleAccruing | null>(null)
  const [record, setRecord] = useState<SellerRecord | null>(null)
  const [loading, setLoading] = useState(true)

  const [taking, setTaking] = useState<Sellable | null>(null)
  const [qty, setQty] = useState('1')
  const [why, setWhy] = useState('')
  const [stopping, setStopping] = useState<Purchase | null>(null)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  /* A page that fails to load says so. Without this the whole screen is a
     spinner that never resolves, which reads as "slow" and is "broken". */
  const [failed, setFailed] = useState<string | null>(null)

  const reload = useCallback(async () => {
    try {
      const [s, p, m, c, r, a, rec] = await Promise.all([
        partnerShelf(), shelfPrices(), purchases(), charges(), recoveries(),
        accruing(), loadSellerRecord(partnerId),
      ])
      setShelf(s); setPrices(p); setMine(m); setBills(c); setTook(r); setCycle(a); setRecord(rec)
      setFailed(null)
    } catch (e) {
      setFailed(e instanceof Error ? e.message : String(e))
    }
    setLoading(false)
  }, [partnerId])
  useEffect(() => { void reload() }, [reload])

  if (failed) {
    return (
      <Callout tone="danger" title="This page could not be loaded">
        {failed}
      </Callout>
    )
  }

  if (loading || !record?.partner) {
    return <div style={{ textAlign: 'center', padding: '40px' }}><div className="spinner" style={{ margin: '0 auto' }} /></div>
  }

  const me = { id: record.partner.id, name: record.partner.name, status: record.partner.status }
  const live = mine.filter(p => p.state === 'active')
  const owing = outstanding(bills)
  /* What the cycle running now still has to take: this period's standing
     orders, less anything already recovered, plus whatever an earlier period
     could not cover. */
  const due = cycle ? Math.round((cycle.this_period + cycle.brought_forward) * 100) / 100 : null

  const take = async () => {
    if (!taking) return
    const n = Number(qty)
    if (!Number.isFinite(n) || n < 1) { toast('How many? A purchase of nothing is not a purchase.', 'error'); return }
    setBusy(true)
    const out = await buy(taking.id, n, why.trim() || undefined)
    setBusy(false)
    if (!out.ok) { toast(out.why ?? 'It could not be taken.', 'error'); return }
    toast(out.why ?? 'Taken.', 'success')
    setTaking(null); setQty('1'); setWhy('')
    await reload()
  }

  const stop = async () => {
    if (!stopping) return
    if (!reason.trim()) { toast('Say why it is being stopped.', 'error'); return }
    setBusy(true)
    const out = await cancel(stopping.id, reason.trim())
    setBusy(false)
    if (!out.ok) { toast(out.why ?? 'It could not be stopped.', 'error'); return }
    toast(out.why ?? 'Stopped.', 'success')
    setStopping(null); setReason('')
    await reload()
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div>
        <h1 style={{ fontSize: 'var(--text-2xl)', fontWeight: 700, margin: 0 }}>Wholesale</h1>
        <p style={{ color: 'var(--text-secondary)', margin: '4px 0 0', fontSize: 'var(--text-sm)' }}>
          What you buy from Aventa. Nothing is charged to a card — it comes off your settlement.
        </p>
      </div>

      {/* Two figures, not three. `this_period` already counts what has been
          charged and not yet recovered, so putting that beside it as its own
          card showed a reseller the same money twice under two labels. */}
      <div style={{ display: 'grid', gap: '12px', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' }}>
        <StatCard label="Running now" value={String(live.length)}
          sublabel={live.length === 1 ? 'standing order' : 'standing orders'} />
        <StatCard label="Still to come off your settlement"
          value={due == null ? '—' : usd(due)}
          sublabel={cycle ? `for ${cycle.period_start} to ${cycle.period_end}` : 'no open cycle'}
          color={due && due > 0 ? 'var(--warning)' : undefined} />
      </div>

      {owing > 0 && (
        <Callout tone="warning" title="Carried to the next settlement">
          {usd(owing)} of wholesale could not come off the periods it was raised against — it was more
          than those periods earned. It is not written off and it is not invoiced: it comes off the
          next settlement that has room for it.
        </Callout>
      )}

      {/* ------------------------------------------------- the standing orders */}
      <SectionCard title="Your standing orders"
        subtitle="Charged by the calendar month, pro-rated for the month you take one and the month you stop it.">
        {mine.length === 0 ? (
          <Empty>Nothing taken yet. The shelf below is what Aventa sells to partners.</Empty>
        ) : (
          <Table headers={['Product', 'Qty', 'A month', 'From', 'Status', '']}>
            {mine.map(p => (
              <tr key={p.id}>
                <Td>
                  <div style={{ fontWeight: 600 }}>{p.product_name}</div>
                  {p.note && (
                    <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>{p.note}</div>
                  )}
                </Td>
                <Td right>{p.quantity}</Td>
                <Td right>{monthlyCost(p) === 0 ? 'Free' : usd(monthlyCost(p))}</Td>
                <Td>{p.started_on}</Td>
                <Td>
                  <StatusPill status={p.state === 'active' ? 'active' : 'cancelled'}
                    label={p.state === 'active' ? 'Active' : 'Stopped'} />
                  {p.state === 'cancelled' && (
                    <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', marginTop: '2px' }}>
                      {p.cancelled_on} · {p.cancel_reason}
                    </div>
                  )}
                </Td>
                <Td>
                  {p.state === 'active' && (
                    <Btn variant="secondary" onClick={() => { setStopping(p); setReason('') }}>
                      <Ban size={14} /> Stop
                    </Btn>
                  )}
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </SectionCard>

      {/* --------------------------------------------------------- the charges */}
      <SectionCard title="What has been charged"
        subtitle="One row per month per standing order, and which settlement took it.">
        {bills.length === 0 ? (
          <Empty>Nothing charged yet. A charge is raised when the settlement covering that month is built.</Empty>
        ) : (
          <Table headers={['Month', 'What for', 'Charged', 'Recovered', 'Outstanding', 'Taken by']}>
            {bills.map(c => {
              const left = Math.max(0, Math.round((c.gross - c.recovered) * 100) / 100)
              const on = took.filter(t => t.charge_id === c.id)
              return (
                <tr key={c.id}>
                  <Td>{c.period_start.slice(0, 7)}</Td>
                  <Td>{chargeLine(c)}</Td>
                  <Td right>{usd(c.gross)}</Td>
                  <Td right>{usd(c.recovered)}</Td>
                  <Td right>
                    {left > 0
                      ? <span style={{ color: 'var(--warning)', fontWeight: 600 }}>{usd(left)}</span>
                      : '—'}
                  </Td>
                  <Td>
                    {on.length === 0 ? '—' : on.map(t => (
                      <div key={t.statement_id} style={{ fontSize: 'var(--text-xs)' }}>
                        {t.statement_id} · {usd(t.amount)}
                      </div>
                    ))}
                  </Td>
                </tr>
              )
            })}
          </Table>
        )}
      </SectionCard>

      {/* ----------------------------------------------------------- the shelf */}
      <SectionCard title="What Aventa sells to partners"
        subtitle="Priced in dollars, the currency your statements are denominated in.">
        <div style={{ display: 'grid', gap: '12px', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))' }}>
          {shelf.map(p => {
            const problem = buyProblem(p, me)
            const price = prices[p.id] ?? 0
            const held = live.find(x => x.product_id === p.id)
            return (
              <div key={p.id} style={{
                border: '1px solid var(--border-light)', borderRadius: 'var(--radius)',
                padding: '14px', display: 'flex', flexDirection: 'column', gap: '8px', minWidth: 0,
              }}>
                <div style={{ fontWeight: 700, fontSize: 'var(--text-sm)' }}>{p.name}</div>
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
                  from {p.seller ?? 'Aventa Telecom'}
                </div>
                <div style={{ fontSize: 'var(--text-lg)', fontWeight: 700 }}>
                  {price === 0 ? 'Free' : <>{usd(price)}<span style={{ fontSize: 'var(--text-xs)', fontWeight: 400, color: 'var(--text-tertiary)' }}> / month</span></>}
                </div>
                {held ? (
                  <div style={{ display: 'flex', gap: '6px', alignItems: 'center', fontSize: 'var(--text-xs)', color: 'var(--success)' }}>
                    <Check size={13} /> Running — {held.quantity} taken
                  </div>
                ) : problem ? (
                  <div style={{ display: 'flex', gap: '6px', alignItems: 'flex-start', fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
                    <Info size={13} style={{ flexShrink: 0, marginTop: '1px' }} /> {problem}
                  </div>
                ) : (
                  <Btn onClick={() => { setTaking(p); setQty('1'); setWhy('') }}>
                    <ShoppingBag size={14} /> Take this
                  </Btn>
                )}
              </div>
            )
          })}
        </div>
      </SectionCard>

      {/* ---------------------------------------------------------- the modals */}
      {taking && (
        <Modal open title={`Take ${taking.name}`} onClose={() => setTaking(null)}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <Callout tone="info">
              {(prices[taking.id] ?? 0) === 0
                ? 'This one is free. It raises no charge and appears on no statement.'
                : `${usd(prices[taking.id] ?? 0)} a month per unit, charged from today and pro-rated for the rest of this month. It comes off your settlement rather than being invoiced.`}
            </Callout>
            <FormField label="How many">
              <input className="input" type="number" min={1} value={qty}
                onChange={e => setQty(e.target.value)} />
            </FormField>
            <FormField label="What it is for" hint="Optional, and it goes on your own record rather than to Aventa.">
              <TextArea value={why} onChange={e => setWhy(e.target.value)} rows={2} />
            </FormField>
            {Number(qty) >= 1 && (prices[taking.id] ?? 0) > 0 && (
              <Preview product={taking.name} unit={prices[taking.id] ?? 0} qty={Number(qty)} usd={usd} />
            )}
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
              <Btn variant="secondary" onClick={() => setTaking(null)}>Cancel</Btn>
              <Btn onClick={take} disabled={busy}>Take it</Btn>
            </div>
          </div>
        </Modal>
      )}

      {stopping && (
        <Modal open title={`Stop ${stopping.product_name}`} onClose={() => setStopping(null)}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <Callout tone="warning" title="What stopping it does">
              Service runs to the end of today and this month is charged to that date. Charges already
              raised stand — a month that has been used is a month that is owed for.
            </Callout>
            <FormField label="Why" hint="It is on the record, and it is what gets read back when the charge is queried.">
              <TextArea value={reason} onChange={e => setReason(e.target.value)} rows={3} />
            </FormField>
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
              <Btn variant="secondary" onClick={() => setStopping(null)}>Keep it</Btn>
              <Btn variant="danger" onClick={stop} disabled={busy}>Stop it</Btn>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}

/* What today's date does to this month's charge, before it is taken. A price
   per month is not what the first month costs, and saying so afterwards is
   worse than saying so now. */
function Preview({ product, unit, qty, usd }: {
  product: string; unit: number; qty: number; usd: (n: number) => string
}) {
  const today = new Date().toISOString().slice(0, 10)
  const monthEnd = new Date(Date.UTC(
    Number(today.slice(0, 4)), Number(today.slice(5, 7)), 0)).toISOString().slice(0, 10)
  const [first] = chargesOver(
    [{
      id: 'preview', partner_id: '', product_id: '', product_name: product,
      quantity: qty, unit_price: unit, currency: 'USD', billing_period: 'monthly',
      state: 'active', started_on: today, ends_on: null, ordered_by: '',
    }],
    today.slice(0, 8) + '01', monthEnd)
  if (!first) return null
  return (
    <div style={{
      background: 'var(--bg-alt)', borderRadius: 'var(--radius)', padding: '10px 12px',
      fontSize: 'var(--text-xs)', color: 'var(--text-secondary)',
    }}>
      This month: {usd(first.gross)}
      {first.days_charged < first.days_in_period
        && ` — ${first.days_charged} of ${first.days_in_period} days.`}
      {' '}Every month after: {usd(Math.round(unit * qty * 100) / 100)}.
    </div>
  )
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-tertiary)', fontSize: 'var(--text-sm)' }}>
      {children}
    </div>
  )
}
