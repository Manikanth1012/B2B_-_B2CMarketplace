import { useState, useEffect } from 'react'
import { SquareCheck as CheckSquare, X, Shield, Cpu } from 'lucide-react'
import { StatCard, SectionCard, Table, Td, StatusPill, fmtInt, Btn, toast, Modal } from '../operator/shared'
import { Callout } from '../OnboardingJourney'
import { VERTICAL_NAMES } from './data'
import { loadAccount, loadEnterpriseCatalogue } from '../../lib/enterpriseRepo'
import type { AccountBook, EnterpriseListing } from '../../lib/enterpriseRepo'
import { idleSeats, renewingWithin, day } from '../../lib/enterprise'
import { useAccountMoney } from './money'
/* Same rows, same photos as the Business Catalogue and the storefront — the
   vertical screens are a filtered view of the one shelf, not a second one. */
import { getProductImage } from '../../lib/images'
import { useRequisition } from '../../lib/RequisitionContext'
import { lineFor } from './EnterpriseBrowse'
import { useMarket } from '../../lib/MarketContext'

/* EnterpriseApprovals moved to EnterpriseApprovals.tsx when requisitions
   became rows rather than a constant. Deciding one here filtered a React array,
   so an approval survived until the next refresh and no colleague ever saw it. */

/* EnterpriseOrders moved to EnterpriseOrders.tsx when orders became rows.
   The five constants here named order references that existed nowhere else,
   while the refunds, the notification log and a support ticket all pointed at
   orders this screen had never heard of. */

/* Subscriptions the account actually holds.
 *
 * This screen read `ENTERPRISE_SUBS` from `data.ts` — six objects with dollar
 * prices — while `enterprise_subscriptions` held the same six as rows in the
 * account's own currency. So it reported $17,875 a month committed against an
 * account whose Billing screen, reading the invoices, said ₹5,82,229. Two
 * screens, one fact, no shared source.
 *
 * Relabelling the constant's figures as rupees would have been worse than
 * leaving them: $825.55 marked ₹825.55 is a dollar figure wearing a rupee
 * label, and nothing on the page could tell. The table is the answer because
 * the table is what the invoices are raised from.
 */
export function EnterpriseSubs() {
  const [book, setBook] = useState<AccountBook | null>(null)
  useEffect(() => { void loadAccount().then(setBook) }, [])

  const { money, money0 } = useAccountMoney(book?.account?.currency)

  if (!book) {
    return <div style={{ textAlign: 'center', padding: '40px' }}><div className="spinner" style={{ margin: '0 auto' }} /></div>
  }

  const subs = book.subscriptions
  const activeSubs = subs.filter(s => s.status === 'active')
  const mrc = activeSubs.reduce((a, s) => a + Number(s.monthly), 0)
  /* Idle seats and what they cost, from the rules module rather than counted
     again here — the Dashboard shows the same figure and the two disagreeing
     is how a renewal conversation goes wrong. */
  const idle = idleSeats(subs)
  const suspended = subs.filter(s => s.status === 'suspended')
  const nextUp = renewingWithin(subs, 400, new Date().toISOString().slice(0, 10))[0] ?? null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div>
        <h1 style={{ fontSize: 'var(--text-2xl)', fontWeight: 800, color: 'var(--text)' }}>Subscriptions</h1>
        <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)', marginTop: '4px' }}>
          {activeSubs.length} active · {money(mrc)}/month committed · {fmtInt(idle.seats)} unassigned seats
        </p>
      </div>

      {book.loadError && <Callout tone="danger" title="Some of this did not load">{book.loadError}</Callout>}

      {/* The suspension notice, written from the row rather than into the
          markup. It named one product and one date in prose, so a second
          suspension would have been invisible and this one would have outlived
          itself. */}
      {suspended.map(s => (
        <div key={s.id} style={{
          display: 'flex', gap: '12px', alignItems: 'flex-start',
          padding: '14px 18px', borderRadius: 'var(--radius-md)',
          background: 'var(--danger-bg)', border: '1px solid var(--danger)',
        }}>
          <Shield size={18} style={{ color: 'var(--danger)', flexShrink: 0, marginTop: '1px' }} />
          <div style={{ fontSize: 'var(--text-sm)', color: 'var(--danger)' }}>
            <strong>{s.name} is suspended.</strong>{' '}
            {s.why_suspended ?? `Your ${fmtInt(s.quantity)} licences run to contract end (${day(s.renews)}) and will not renew.`}
          </div>
        </div>
      ))}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: '16px' }}>
        <StatCard label="Monthly committed" value={money(mrc)}
                  sublabel={`${activeSubs.length} active subscriptions`} color="var(--brand-navy)" />
        <StatCard label="Unassigned seats" value={fmtInt(idle.seats)}
                  sublabel={`${money(idle.monthly)}/mo at risk${idle.worst ? ` · worst on ${idle.worst.name}` : ''}`}
                  color={idle.seats > 0 ? 'var(--warning)' : undefined} />
        <StatCard label="Suspended" value={fmtInt(suspended.length)}
                  sublabel={suspended.length ? 'Needs replacement decision' : 'None'}
                  color={suspended.length ? 'var(--danger)' : undefined} />
        <StatCard label="Next renewal" value={nextUp ? day(nextUp.renews) : '—'}
                  sublabel={nextUp ? nextUp.name : 'Nothing renewing'}
                  color={nextUp ? 'var(--warning)' : undefined} />
      </div>

      <SectionCard title="What the account holds" subtitle={`${subs.length} subscriptions, active and suspended`}>
        <Table headers={['Service', 'Seller', 'Licensed', 'Assigned', 'Each', 'Monthly', 'Renews', 'State', '']}>
          {subs.map(s => (
            <tr key={s.id}>
              <Td>
                <div style={{ fontWeight: 600 }}>{s.name}</div>
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>{s.unit}</div>
              </Td>
              <Td>{s.seller}</Td>
              <Td right>{fmtInt(s.quantity)}</Td>
              <Td right>
                {s.status === 'suspended'
                  ? <span style={{ color: 'var(--text-tertiary)', fontSize: 'var(--text-xs)' }}>Not assignable</span>
                  : (
                    <div>
                      <div style={{ fontSize: 'var(--text-sm)' }}>{s.seats_used} / {s.quantity}</div>
                      <div style={{ height: '6px', borderRadius: '3px', background: 'var(--bg-alt)', overflow: 'hidden', marginTop: '4px' }}>
                        <div style={{ height: '100%', width: `${Math.min(100, (s.seats_used / s.quantity) * 100)}%`, background: 'var(--brand-accent-dark)', borderRadius: '3px' }} />
                      </div>
                    </div>
                  )}
              </Td>
              <Td right>{money(Number(s.unit_price))}</Td>
              <Td right>{money0(Number(s.monthly))}</Td>
              <Td>{day(s.renews)}</Td>
              <Td right><StatusPill status={s.status} /></Td>
              <Td right><Btn variant="secondary" size="sm" onClick={() => toast(`${s.name} · ${s.contract_ref ?? 'no contract reference'}`)}>Manage</Btn></Td>
            </tr>
          ))}
        </Table>
      </SectionCard>
    </div>
  )
}

/* One vertical of the business catalogue.
 *
 * The listings were eight objects written into this file, priced in dollars,
 * with SKU ids that named different products in `products` — and "what you
 * already hold" came from the same constant the Subscriptions screen used. Both
 * now read the account: the catalogue from `products` filtered by `audiences`
 * and priced from `product_prices`, the holdings from
 * `enterprise_subscriptions`.
 */
export function EnterpriseMarketplace({ vertical }: { vertical: string }) {
  const [book, setBook] = useState<AccountBook | null>(null)
  const [listings, setListings] = useState<EnterpriseListing[] | null>(null)
  const req = useRequisition()

  useEffect(() => {
    void loadAccount().then(setBook)
  }, [])

  /* The currency the header picker is on, exactly as Browse Catalogue reads it.

     This screen used to price at the account's primary currency and ignore the
     picker, so a Nairobi account switching to dollars saw dollars on Browse and
     shillings here — and a requisition filled from both would have been holding
     two currencies, which the basket has to refuse. One shelf, one answer. */
  const { currency: chosen } = useMarket()
  const primary = book?.account?.currency ?? null
  const offered = book?.currencies ?? []
  const currency = primary === null ? null
    : chosen && offered.includes(chosen.code) ? chosen.code
    : primary

  useEffect(() => {
    if (!currency) return
    let live = true
    setListings(null)
    void loadEnterpriseCatalogue(currency).then(rows => { if (live) setListings(rows) })
    return () => { live = false }
  }, [currency])

  /* Same re-pricing rule as Browse: the basket follows the shelf rather than
     being multiplied by a rate. */
  useEffect(() => {
    if (!currency || !listings || !req.basket.lines.length) return
    if (req.basket.currency === currency) return
    const dropped = req.reprice(currency, listings)
    if (dropped.length) {
      toast(`${dropped.join(' and ')} ${dropped.length === 1 ? 'is' : 'are'} not sold in ${currency}, so ${dropped.length === 1 ? 'it was' : 'they were'} taken out of your requisition.`, 'error')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currency, listings])

  /* The shelf's currency for prices; the account's own for the threshold, which
     is a chosen figure and does not move when the shelf does. */
  const { money } = useAccountMoney(currency)
  const { money0 } = useAccountMoney(primary)

  if (!book || !listings) {
    return <div style={{ textAlign: 'center', padding: '40px' }}><div className="spinner" style={{ margin: '0 auto' }} /></div>
  }

  const filtered = listings.filter(l => l.category_id === vertical)
  const byCat: Record<string, EnterpriseListing[]> = {}
  filtered.forEach(l => { (byCat[l.sub_category ?? 'Other'] = byCat[l.sub_category ?? 'Other'] || []).push(l) })

  const mine = book.subscriptions.filter(s => s.vertical === vertical)
  const policy = book.policy

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div>
        <h1 style={{ fontSize: 'var(--text-2xl)', fontWeight: 800, color: 'var(--text)' }}>{VERTICAL_NAMES[vertical]}</h1>
        <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)', marginTop: '4px' }}>
          {filtered.length} listings from {new Set(filtered.map(l => l.seller)).size} sellers
          {policy ? ` · anything at or above ${money0(Number(policy.threshold))} needs finance approval` : ''}
        </p>
      </div>

      {/* Read from the policy rather than asserted about one vertical: an
          account that turns security sign-off off would otherwise still be told
          it was on. */}
      {vertical === 'security' && policy?.security_signoff && (
        <div style={{
          padding: '14px 18px', borderRadius: 'var(--radius-md)',
          background: 'var(--warning-bg)', border: '1px solid var(--warning)',
          fontSize: 'var(--text-sm)', color: 'var(--warning)',
        }}>
          <strong>Security purchases need IT sign-off</strong> regardless of value, on top of the usual finance threshold. That is your own policy, not a marketplace rule.
        </div>
      )}

      {mine.length > 0 && (
        <SectionCard title="What you already hold" subtitle={`${mine.length} subscriptions on this account`}>
          <Table headers={['Service', 'Seller', 'Licensed', 'Each', 'Monthly', 'Renews', 'State']}>
            {mine.map(s => (
              <tr key={s.id}>
                <Td><strong>{s.name}</strong></Td>
                <Td>{s.seller}</Td>
                <Td right>{fmtInt(s.quantity)}</Td>
                <Td right>{money(Number(s.unit_price))}</Td>
                <Td right>{money0(Number(s.monthly))}</Td>
                <Td>{day(s.renews)}</Td>
                <Td right><StatusPill status={s.status} /></Td>
              </tr>
            ))}
          </Table>
        </SectionCard>
      )}

      {Object.entries(byCat).map(([cat, items]) => (
        <SectionCard key={cat} title={cat} subtitle={`${items.length} listings`}>
          <div style={{ padding: '20px', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '14px' }}>
            {items.map(p => (
              <div key={p.id} style={{ background: 'white', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                <div style={{ height: '100px', background: 'var(--bg-alt)' }}>
                  <img src={getProductImage(p.id)} alt="" loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                </div>
                <div style={{ padding: '12px', flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: 'var(--text-sm)' }}>{p.name}</div>
                  <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>{p.seller}</div>
                  <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', marginTop: '4px' }}>{p.description}</div>
                </div>
                <div style={{ padding: '10px 12px', borderTop: '1px solid var(--border-light)', background: 'var(--bg-alt)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontWeight: 700 }}>{money(p.price)}{p.model === 'monthly' ? (p.unit ? ` ${p.unit}/mo` : '/mo') : ''}</span>
                  <Btn variant="primary" size="sm" onClick={() => {
                    if (!currency) return
                    const r = req.add(lineFor(p), currency)
                    toast(r.ok ? (r.note ?? `${p.name} added`) : r.reason, r.ok ? 'success' : 'error')
                  }}>Add</Btn>
                </div>
              </div>
            ))}
          </div>
        </SectionCard>
      ))}
    </div>
  )
}
