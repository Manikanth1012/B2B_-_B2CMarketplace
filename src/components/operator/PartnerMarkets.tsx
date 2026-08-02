/* Which markets a seller trades in, and what their listings cost in each.
 *
 * Two things on one screen because they are one decision seen from both ends:
 * granting a market is what makes pricing into it possible, and a market
 * granted with nothing priced in it is a seller who appears in a storefront
 * with no products on the shelf.
 *
 * The operator decides the grants — a seller can ask and nothing more, which
 * `guard_partner_market` enforces rather than trusting this screen.
 */
import { useState, useEffect, useCallback } from 'react'
import { Globe, Check, Ban, Clock } from 'lucide-react'
import { loadPartnerMarkets, decideMarket } from '../../lib/moneyRepo'
import type { PartnerMarket } from '../../lib/marketPricing'
import { sellableIn } from '../../lib/marketPricing'
import { currenciesOf } from '../../lib/money'
import { loadProductPrices } from '../../lib/moneyRepo'
import type { BookRow } from '../../lib/marketPricing'
import { useMarket } from '../../lib/MarketContext'
import { PriceBookEditor } from '../PriceBookEditor'
import { Btn, Modal, toast, EmptyState } from './shared'

interface Listing { id: string; name: string; price: number; status: string }

export function PartnerMarkets({ partnerId, partnerName, listings, actor }: {
  partnerId: string
  partnerName: string
  listings: readonly Listing[]
  actor: string
}) {
  const { book, fmtIn } = useMarket()
  const [grants, setGrants] = useState<PartnerMarket[]>([])
  const [rows, setRows] = useState<BookRow[]>([])
  const [pricing, setPricing] = useState<Listing | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const reload = useCallback(async () => {
    const g = await loadPartnerMarkets(partnerId)
    /* Every listing's prices, so the table can say which markets a listing is
       actually on sale in rather than only which ones the seller may sell in.
       Those are different, and the gap between them is the useful part. */
    const books = await Promise.all(listings.map(l => loadProductPrices(l.id)))
    setGrants(g)
    setRows(books.flat())
    setLoading(false)
  }, [partnerId, listings])

  useEffect(() => { void reload() }, [reload])

  async function decide(code: string, state: 'approved' | 'suspended' | 'requested', note: string) {
    setBusy(code)
    const res = await decideMarket(partnerId, code, state, actor, note)
    setBusy(null)
    if (!res.ok) { toast(res.reason ?? 'Nothing changed', 'error'); return }
    toast(`${partnerName} — ${code} ${state}`)
    await reload()
  }

  if (loading) return <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>Loading markets…</p>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
      <section>
        <h4 style={{ fontSize: 'var(--text-sm)', fontWeight: 700, marginBottom: '8px' }}>Where this seller may trade</h4>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {book.markets.map(m => {
            const grant = grants.find(g => g.market_code === m.code)
            const state = grant?.state ?? 'none'
            /* Counted against the market's *default* currency, because that is
               the price a shopper who has chosen nothing is quoted. A listing
               priced only in the market's second currency is not on the shelf. */
            const takes = currenciesOf(m.code, book.accepted)
            const shown = takes.length ? takes : [m.currency]
            const priced = listings.filter(l =>
              rows.some(r => r.product_id === l.id && r.currency === shown[0])).length

            return (
              <div key={m.code} style={{
                display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap',
                padding: '10px 12px', border: '1px solid var(--border)',
                borderRadius: 'var(--radius-md)', background: 'white',
              }}>
                <Globe size={15} style={{ color: 'var(--text-tertiary)', flexShrink: 0 }} />
                <div style={{ minWidth: '150px' }}>
                  <div style={{ fontSize: 'var(--text-sm)', fontWeight: 700 }}>{m.name}</div>
                  {/* Every currency the grant opens. Granting Kenya lets this
                      seller price in shillings *and* dollars, and an operator
                      who reads "KES" alone has been told half of it. */}
                  <div style={{ fontSize: '10px', color: 'var(--text-tertiary)' }}>
                    {shown.join(' · ')} · {m.tax_label} {m.tax_rate}%
                  </div>
                </div>

                <StateChip state={state} />

                {/* The number that matters: a market granted with nothing priced
                    in it is a shelf with no products on it. */}
                <span style={{ fontSize: 'var(--text-xs)', color: priced === 0 ? 'var(--warning)' : 'var(--text-tertiary)' }}>
                  {priced} of {listings.length} listings priced
                </span>

                {grant?.note && (
                  <span style={{ fontSize: '10px', color: 'var(--text-tertiary)', flex: '1 1 200px' }}>
                    {grant.note}
                  </span>
                )}

                <span style={{ marginLeft: 'auto', display: 'flex', gap: '6px' }}>
                  {state !== 'approved' && (
                    <Btn size="sm" disabled={busy === m.code}
                         onClick={() => decide(m.code, 'approved', `Granted by ${actor}.`)}>
                      <Check size={12} /> Grant
                    </Btn>
                  )}
                  {state === 'approved' && (
                    <Btn variant="danger" size="sm" disabled={busy === m.code}
                         onClick={() => decide(m.code, 'suspended', `Suspended by ${actor}.`)}>
                      <Ban size={12} /> Suspend
                    </Btn>
                  )}
                </span>
              </div>
            )
          })}
        </div>
      </section>

      <section>
        <h4 style={{ fontSize: 'var(--text-sm)', fontWeight: 700, marginBottom: '8px' }}>
          What each listing costs, market by market
        </h4>
        {listings.length === 0 ? (
          <EmptyState message="This seller has no listings to price" />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {listings.map(l => (
              <div key={l.id} style={{
                display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap',
                padding: '9px 11px', border: '1px solid var(--border)',
                borderRadius: 'var(--radius-md)', background: 'white',
              }}>
                <div style={{ flex: '1 1 200px', minWidth: 0 }}>
                  <div style={{ fontSize: 'var(--text-xs)', fontWeight: 700 }}>{l.name}</div>
                  <div style={{ fontSize: '10px', color: 'var(--text-tertiary)' }}>{l.id}</div>
                </div>

                {book.markets.map(m => {
                  const can = sellableIn({ id: l.id, partner_id: partnerId }, m, grants, rows, book.accepted)
                  /* Every currency the market takes, not just its default — a
                     listing priced in shillings but not in dollars is on sale in
                     Kenya to half of Kenya. */
                  const takes = currenciesOf(m.code, book.accepted)
                  const shown = takes.length ? takes : [m.currency]
                  return (
                    <span key={m.code} style={{ minWidth: '110px', textAlign: 'right' }}>
                      <div style={{ fontSize: '10px', color: 'var(--text-tertiary)' }}>{m.code}</div>
                      {shown.map(c => {
                        const row = rows.find(r => r.product_id === l.id && r.currency === c)
                        return (
                          <div key={c} style={{
                            fontSize: 'var(--text-xs)', fontWeight: 600,
                            color: row ? 'var(--text)' : 'var(--text-tertiary)',
                          }}>
                            {row ? fmtIn(row.price, c) : `— ${c}`}
                          </div>
                        )
                      })}
                      {!can.ok && (
                        <div style={{ fontSize: '9px', color: 'var(--warning)' }}>{can.reason}</div>
                      )}
                      {can.ok && can.gaps.length > 0 && (
                        <div style={{ fontSize: '9px', color: 'var(--warning)' }}>
                          No {can.gaps.join('/')} price
                        </div>
                      )}
                    </span>
                  )
                })}

                <Btn variant="secondary" size="sm" onClick={() => setPricing(l)}>Edit</Btn>
              </div>
            ))}
          </div>
        )}
      </section>

      <Modal
        open={pricing !== null}
        onClose={() => setPricing(null)}
        title={pricing ? `Prices — ${pricing.name}` : ''}
        footer={<Btn variant="secondary" size="sm" onClick={() => setPricing(null)}>Close</Btn>}
      >
        {pricing && (
          <PriceBookEditor
            product={{ id: pricing.id, name: pricing.name, partner_id: partnerId, price: pricing.price }}
            who={{ persona: 'operator' }}
            onChanged={reload}
          />
        )}
      </Modal>
    </div>
  )
}

function StateChip({ state }: { state: string }) {
  const map: Record<string, { bg: string; ink: string; label: string; icon: React.ReactNode }> = {
    approved:  { bg: 'var(--success-bg)', ink: 'var(--success)', label: 'Trading',   icon: <Check size={11} /> },
    requested: { bg: 'var(--warning-bg)', ink: 'var(--warning)', label: 'Asked for', icon: <Clock size={11} /> },
    suspended: { bg: 'var(--danger-bg)',  ink: 'var(--danger)',  label: 'Suspended', icon: <Ban size={11} /> },
    none:      { bg: 'var(--bg-alt)',     ink: 'var(--text-tertiary)', label: 'Not selling here', icon: null },
  }
  const s = map[state] ?? map.none
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '2px 9px',
      borderRadius: 'var(--radius-full)', fontSize: '11px', fontWeight: 700,
      background: s.bg, color: s.ink, whiteSpace: 'nowrap',
    }}>{s.icon}{s.label}</span>
  )
}
