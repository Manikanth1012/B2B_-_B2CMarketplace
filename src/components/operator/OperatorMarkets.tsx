/* Markets, the currencies each one trades in, and who is allowed to sell where.
 *
 * Both halves of this existed only as seeded rows. A seller's markets could be
 * granted one seller at a time from their own record, and which currencies a
 * market accepted could not be changed at all — Kenya took shillings and dollars
 * because a migration said so.
 *
 * Two sections, because they answer two different questions and an operator
 * arrives with one of them: what does this market trade in, and who is trading.
 *
 * Every rule shown here is enforced again by the database — `guard_market_currency`
 * for the single default, `guard_market_currency_removal` for the last currency
 * and for orphaned bills. The screen asks first so the answer arrives before the
 * click rather than as a Postgres exception after it.
 */
import { useState, useEffect, useCallback } from 'react'
import { Pager, usePaging } from '../Pager'
import { Globe, Check, Ban, Clock, Plus, Trash2, Star } from 'lucide-react'
import { useMarket } from '../../lib/MarketContext'
import {
  loadPartnerMarkets, decideMarket, addMarketCurrency, removeMarketCurrency,
  setDefaultCurrency, currencyFootprint, loadMoneyBook,
} from '../../lib/moneyRepo'
import { currenciesOf, symbolOf } from '../../lib/money'
import type { MarketCurrency } from '../../lib/money'
import {
  addableTo, canRemove, canMakeDefault, grid, tallyFor, outstanding,
  bookGaps, unsettleable, latestFixes,
} from '../../lib/marketAdmin'
import type { Cell, GrantState } from '../../lib/marketAdmin'
import type { PartnerMarket } from '../../lib/marketPricing'
import { supabase } from '../../lib/supabase'
import { SectionCard, StatCard, Btn, Table, Td, EmptyState, Modal, toast, ConfirmDialog } from './shared'

interface Seller { id: string; name: string; type: string; country: string }

const ACTOR = 'Anika Sharma'

export function OperatorMarkets() {
  const { book } = useMarket()
  /* The context's book is loaded once for the whole app; this screen changes it,
     so it keeps its own copy and re-reads after every write. Reading the shared
     one would leave the operator looking at what the marketplace accepted when
     they signed in. */
  const [accepted, setAccepted] = useState<MarketCurrency[]>([])
  const [sellers, setSellers] = useState<Seller[]>([])
  const [grants, setGrants] = useState<PartnerMarket[]>([])
  const [priced, setPriced] = useState<Record<string, number>>({})
  /* Two things this screen could not see, and both are consequences of the one
     click it exists to make. Adding a currency to a market opens a shelf the
     price book may not cover, and opens a currency the treasury may have no
     rate to settle out of. `20260802430000` found the first as a data defect
     and `20260802420000` made the second load-bearing; neither was visible to
     the person doing the granting. */
  const [gaps, setGaps] = useState<ReturnType<typeof bookGaps>>([])
  const [rates, setRates] = useState<{ base: string; quote: string; rate: number; as_of: string }[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [adding, setAdding] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<
    { market: string; currency: string; warning?: string } | null>(null)

  const reload = useCallback(async () => {
    const [mb, s, g, pp, live] = await Promise.all([
      loadMoneyBook(),
      supabase.from('partners').select('id,name,type,country').order('name'),
      loadPartnerMarkets(),
      supabase.from('product_prices').select('product_id, currency'),
      supabase.from('products').select('id').eq('status', 'live'),
    ])
    setAccepted(mb.accepted)
    setRates(mb.rates)
    setGaps(bookGaps(
      mb.markets, mb.accepted,
      (live.data ?? []) as { id: string }[],
      (pp.data ?? []) as { product_id: string; currency: string }[],
    ))
    setSellers((s.data ?? []) as Seller[])
    setGrants(g)
    /* One count per currency, for the "what would this remove" line. */
    const counts: Record<string, number> = {}
    for (const r of (pp.data ?? []) as { currency: string }[]) {
      counts[r.currency] = (counts[r.currency] ?? 0) + 1
    }
    setPriced(counts)
    setLoading(false)
  }, [])

  useEffect(() => { void reload() }, [reload])

  const markets = book.markets
  const cells = grid(sellers, markets, grants)
  const waiting = outstanding(cells)
  const reporting = book.currencies.find(c => c.is_reporting)?.code ?? 'USD'
  const fixes = latestFixes(rates, reporting)

  async function add(marketCode: string, currency: string) {
    setBusy(`${marketCode}|${currency}`)
    const res = await addMarketCurrency(marketCode, currency)
    setBusy(null); setAdding(null)
    if (!res.ok) { toast(res.reason ?? 'That currency was not added', 'error'); return }
    const m = markets.find(x => x.code === marketCode)
    toast(`${m?.name ?? marketCode} now trades in ${currency}`)
    await reload()
  }

  /* Asked before the dialog opens, because "3 bills exist in this currency" is
     the answer, not a detail inside the confirmation. */
  async function askRemove(marketCode: string, currency: string) {
    setBusy(`${marketCode}|${currency}`)
    const counts = await currencyFootprint(marketCode, currency)
    setBusy(null)
    const verdict = canRemove(marketCode, currency, accepted, counts)
    if (!verdict.ok) { toast(verdict.reason ?? 'That cannot be removed', 'error'); return }
    setConfirm({ market: marketCode, currency, warning: verdict.warning })
  }

  async function doRemove() {
    if (!confirm) return
    const { market, currency } = confirm
    setConfirm(null); setBusy(`${market}|${currency}`)
    const res = await removeMarketCurrency(market, currency)
    setBusy(null)
    if (!res.ok) { toast(res.reason ?? 'Nothing was removed', 'error'); return }
    toast(`${currency} withdrawn from ${markets.find(m => m.code === market)?.name ?? market}`)
    await reload()
  }

  async function makeDefault(marketCode: string, currency: string) {
    const verdict = canMakeDefault(marketCode, currency, accepted)
    if (!verdict.ok) { toast(verdict.reason ?? 'Nothing to change', 'error'); return }
    setBusy(`${marketCode}|${currency}`)
    const res = await setDefaultCurrency(marketCode, currency)
    setBusy(null)
    if (!res.ok) { toast(res.reason ?? 'The default was not changed', 'error'); return }
    toast(`Shoppers in ${markets.find(m => m.code === marketCode)?.name ?? marketCode} are now quoted in ${currency}`)
    await reload()
  }

  async function decide(partnerId: string, marketCode: string, state: GrantState) {
    if (state === 'none') return
    setBusy(`${partnerId}|${marketCode}`)
    const res = await decideMarket(
      partnerId, marketCode, state as 'approved' | 'suspended' | 'requested', ACTOR,
      state === 'approved' ? `Granted by ${ACTOR}.` : `Suspended by ${ACTOR}.`,
    )
    setBusy(null)
    if (!res.ok) { toast(res.reason ?? 'Nothing was changed', 'error'); return }
    setGrants(await loadPartnerMarkets())
  }

  /* Above the loading guard: `usePaging` is a hook, and a hook after an
     early return runs on some renders and not others. */
  const sellersPage = usePaging(sellers)

  if (loading) {
    return <p style={{ padding: '24px', color: 'var(--text-tertiary)' }}>Loading markets…</p>
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div>
        <h1 style={{ fontSize: 'var(--text-2xl)', fontWeight: 800, margin: 0 }}>Markets & currencies</h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: 'var(--text-sm)', margin: '4px 0 0' }}>
          Where the marketplace trades, what it takes money in, and who is allowed to sell there
        </p>
      </div>

      <div className="stat-row">
        <StatCard label="Markets open" value={String(markets.length)}
                  sublabel={markets.map(m => m.code).join(' · ')} />
        <StatCard label="Currencies accepted" value={String(new Set(accepted.map(a => a.currency)).size)}
                  sublabel={[...new Set(accepted.map(a => a.currency))].sort().join(' · ')} />
        <StatCard label="Sellers on record" value={String(sellers.length)} />
        <StatCard label="Market requests waiting" value={String(waiting.length)}
                  color={waiting.length ? 'var(--warning)' : undefined}
                  sublabel={waiting.length ? 'Nobody can trade until these are decided' : 'Nothing outstanding'} />
      </div>

      {/* Two consequences of granting a currency that nothing on this screen
          could see until now. Both are stated before the section that does the
          granting, because they are the reason to look twice at it. */}
      {gaps.length > 0 && (
        <div style={{
          padding: '13px 16px', borderRadius: 'var(--radius-md)',
          background: 'var(--warning-bg)', border: '1px solid var(--warning)',
          fontSize: 'var(--text-sm)', lineHeight: 1.6,
        }}>
          <strong>
            {gaps.length} {gaps.length === 1 ? 'shelf is' : 'shelves are'} not fully priced.
          </strong>
          <div style={{ marginTop: '5px', fontSize: 'var(--text-xs)' }}>
            {gaps.map(g => {
              const m = markets.find(x => x.code === g.market_code)
              return `${m?.name ?? g.market_code} in ${g.currency}: ${g.missing} of ${g.of} unpriced`
            }).join(' · ')}
          </div>
          <div style={{ marginTop: '6px', fontSize: '11px', color: 'var(--text-secondary)' }}>
            A shopper who chooses one of these is shown the product's base price instead — a plausible
            number in the wrong money, which is the kind of wrong nothing on the page can look wrong.
          </div>
        </div>
      )}

      {unsettleable(accepted, rates, reporting).length > 0 && (
        <div style={{
          padding: '13px 16px', borderRadius: 'var(--radius-md)',
          background: 'var(--danger-bg)', border: '1px solid var(--danger)',
          fontSize: 'var(--text-sm)', lineHeight: 1.6,
        }}>
          <strong>
            No rate on file for {unsettleable(accepted, rates, reporting).join(', ')}.
          </strong>{' '}
          The marketplace can take money in {unsettleable(accepted, rates, reporting).length === 1 ? 'it' : 'them'} and
          cannot pay a seller out of {unsettleable(accepted, rates, reporting).length === 1 ? 'it' : 'them'} — a
          settlement into that account will refuse rather than convert at a rate nobody set.
        </div>
      )}

      {/* ============================ the fixes settlements convert at ==== */}

      <SectionCard
        title="Rates on file"
        subtitle={`The most recent fix for each currency, from ${reporting}. A settlement uses the fix in force when its period closed, never the newest — so these are what the next run will use, not what the last one did.`}
      >
        {fixes.length === 0 ? (
          <EmptyState message="No rates on file" />
        ) : (
          <Table headers={['Currency', 'One ' + reporting + ' buys', 'Fixed on', 'Source']}>
            {fixes.map(f => {
              const cur = book.currencies.find(c => c.code === f.currency)
              const row = rates.find(r => r.quote === f.currency && r.as_of === f.as_of) as
                { pegged?: boolean; source?: string } | undefined
              return (
                <tr key={f.currency}>
                  <Td>
                    <strong style={{ fontSize: 'var(--text-xs)' }}>{f.currency}</strong>
                    <div style={{ fontSize: '10px', color: 'var(--text-tertiary)' }}>{cur?.name ?? ''}</div>
                  </Td>
                  <Td right>{f.rate}</Td>
                  <Td right>{f.as_of}</Td>
                  <Td right>
                    <span style={{ fontSize: '10px', color: 'var(--text-tertiary)' }}>
                      {row?.source ?? '—'}{row?.pegged ? ' · pegged' : ''}
                    </span>
                  </Td>
                </tr>
              )
            })}
          </Table>
        )}
      </SectionCard>

      {/* =============================== what each market trades in ======= */}

      <SectionCard
        title="What each market trades in"
        subtitle="The first currency is what a shopper there is quoted before choosing otherwise. Tax follows the market, never the currency — a Kenyan sale is VAT at 16% in shillings or in dollars."
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {markets.map(m => {
            const takes = currenciesOf(m.code, accepted)
            const canAdd = addableTo(m.code, accepted, book.currencies)
            return (
              <div key={m.code} style={{
                border: '1px solid var(--border)', borderRadius: 'var(--radius-md)',
                padding: '12px 14px', background: 'white',
              }}>
                <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap', marginBottom: '10px' }}>
                  <Globe size={16} style={{ color: 'var(--text-tertiary)', flexShrink: 0 }} />
                  <strong style={{ fontSize: 'var(--text-sm)' }}>{m.name}</strong>
                  <span style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>
                    {m.code} · {m.tax_label} {m.tax_rate}%{m.is_default ? ' · default market' : ''}
                  </span>
                  <span style={{ marginLeft: 'auto' }}>
                    {canAdd.length > 0 ? (
                      <Btn variant="secondary" size="sm" onClick={() => setAdding(m.code)}>
                        <Plus size={12} /> Add currency
                      </Btn>
                    ) : (
                      <span style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>
                        Takes every currency on file
                      </span>
                    )}
                  </span>
                </div>

                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                  {takes.map((c, i) => {
                    const isDefault = i === 0
                    const key = `${m.code}|${c}`
                    return (
                      <span key={c} style={{
                        display: 'inline-flex', alignItems: 'center', gap: '7px',
                        padding: '5px 6px 5px 11px', borderRadius: 'var(--radius-full)',
                        border: `1px solid ${isDefault ? 'var(--brand-navy)' : 'var(--border)'}`,
                        background: isDefault ? 'var(--bg-alt)' : 'white',
                      }}>
                        <span style={{ fontSize: 'var(--text-xs)', fontWeight: 700 }}>
                          {symbolOf(c, book.currencies) === c ? c : `${symbolOf(c, book.currencies)} ${c}`}
                        </span>
                        {isDefault ? (
                          <span style={{
                            fontSize: '9px', fontWeight: 700, textTransform: 'uppercase',
                            letterSpacing: '0.05em', color: 'var(--brand-navy)',
                          }}>
                            quoted by default
                          </span>
                        ) : (
                          <>
                            <button
                              onClick={() => makeDefault(m.code, c)}
                              disabled={busy === key}
                              title={`Quote shoppers in ${m.name} in ${c}`}
                              style={chip('var(--text-tertiary)')}
                            >
                              <Star size={12} />
                            </button>
                            <button
                              onClick={() => askRemove(m.code, c)}
                              disabled={busy === key}
                              title={`Stop trading in ${c} here`}
                              style={chip('var(--danger)')}
                            >
                              <Trash2 size={12} />
                            </button>
                          </>
                        )}
                      </span>
                    )
                  })}
                </div>

                {/* The default cannot be removed while it is the default, which
                    is worth saying beside the row rather than only in the toast
                    that fires after somebody tries. */}
                {takes.length > 1 && (
                  <p style={{ margin: '9px 0 0', fontSize: '10px', color: 'var(--text-tertiary)' }}>
                    To stop trading in {takes[0]} here, make another currency the default first.
                  </p>
                )}
              </div>
            )
          })}
        </div>
      </SectionCard>

      {/* ==================================== who sells where ============= */}

      <SectionCard
        title="Who sells where"
        subtitle="A seller trades only in markets granted here, and prices only in the currencies those markets take."
      >
        {sellers.length === 0 ? (
          <EmptyState message="No sellers on record" />
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <><Table headers={['Seller', ...markets.map(m => m.name)]}>
              {sellersPage.rows.map(s => (
                <tr key={s.id}>
                  <Td>
                    <div style={{ fontWeight: 700, fontSize: 'var(--text-xs)' }}>{s.name}</div>
                    <div style={{ fontSize: '10px', color: 'var(--text-tertiary)' }}>
                      {s.id} · {s.type} · {s.country}
                    </div>
                  </Td>
                  {markets.map(m => {
                    const cell = cells.find(c => c.partner_id === s.id && c.market_code === m.code)!
                    const key = `${s.id}|${m.code}`
                    return (
                      /* `right`, because `Table` right-aligns every header after
                         the first. A left-aligned cell under a right-aligned
                         header puts the market's name nowhere near its column. */
                      <Td key={m.code} right>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '7px' }}>
                          <GrantChip state={cell.state} />
                          {cell.state === 'approved' ? (
                            <button onClick={() => decide(s.id, m.code, 'suspended')}
                                    disabled={busy === key} title={`Suspend ${s.name} in ${m.name}`}
                                    style={chip('var(--danger)')}>
                              <Ban size={12} />
                            </button>
                          ) : (
                            <button onClick={() => decide(s.id, m.code, 'approved')}
                                    disabled={busy === key} title={`Let ${s.name} sell in ${m.name}`}
                                    style={chip('var(--success)')}>
                              <Check size={12} />
                            </button>
                          )}
                        </div>
                      </Td>
                    )
                  })}
                </tr>
              ))}
            </Table>
            <div style={{ padding: '0 18px 12px' }}><Pager page={sellersPage} noun="sellers" /></div></>
          </div>
        )}

        {/* A tally under the grid, because the column is long enough that
            counting approvals by eye is the thing the reader would do next. */}
        <div style={{
          display: 'flex', gap: '18px', flexWrap: 'wrap', marginTop: '12px',
          paddingTop: '12px', borderTop: '1px solid var(--border-light)',
        }}>
          {markets.map(m => {
            const t = tallyFor(m.code, cells)
            return (
              <div key={m.code} style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                <strong style={{ color: 'var(--text)' }}>{m.name}</strong>{' — '}
                {t.approved} trading
                {t.requested > 0 && <span style={{ color: 'var(--warning)' }}>, {t.requested} waiting</span>}
                {t.suspended > 0 && <span style={{ color: 'var(--danger)' }}>, {t.suspended} suspended</span>}
                , {t.none} not asked
              </div>
            )
          })}
        </div>
      </SectionCard>

      {/* ------------------------------------------------ add a currency -- */}

      <Modal
        open={adding !== null}
        onClose={() => setAdding(null)}
        title={adding ? `Add a currency to ${markets.find(m => m.code === adding)?.name}` : ''}
        footer={<Btn variant="secondary" size="sm" onClick={() => setAdding(null)}>Cancel</Btn>}
      >
        {adding && (
          <>
            <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', marginTop: 0 }}>
              Adding a currency lets sellers approved here set a price in it, and lets a shopper
              choose to be quoted in it. It does not change what anybody is quoted by default, and
              it does not change the tax — {markets.find(m => m.code === adding)?.tax_label}{' '}
              {markets.find(m => m.code === adding)?.tax_rate}% either way.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {addableTo(adding, accepted, book.currencies).map(c => {
                const cur = book.currencies.find(x => x.code === c)
                return (
                  <button
                    key={c}
                    onClick={() => add(adding, c)}
                    disabled={busy === `${adding}|${c}`}
                    style={{
                      display: 'flex', alignItems: 'center', gap: '10px', width: '100%',
                      padding: '10px 12px', background: 'white', cursor: 'pointer',
                      border: '1px solid var(--border)', borderRadius: 'var(--radius-md)',
                      textAlign: 'left',
                    }}
                  >
                    <strong style={{ fontSize: 'var(--text-sm)', minWidth: '58px' }}>{c}</strong>
                    <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>
                      {cur?.name ?? c}
                    </span>
                    <span style={{ marginLeft: 'auto', fontSize: '10px', color: 'var(--text-tertiary)' }}>
                      {priced[c] ?? 0} listing{(priced[c] ?? 0) === 1 ? '' : 's'} already priced in it
                    </span>
                  </button>
                )
              })}
            </div>
          </>
        )}
      </Modal>

      <ConfirmDialog
        open={confirm !== null}
        onClose={() => setConfirm(null)}
        onConfirm={doRemove}
        danger
        confirmLabel="Stop trading in it"
        title={confirm ? `Withdraw ${confirm.currency} from ${markets.find(m => m.code === confirm.market)?.name}?` : ''}
        message={
          confirm
            ? `Shoppers there will no longer be able to choose ${confirm.currency}.` +
              (confirm.warning ? ` ${confirm.warning}` : '') +
              ' Prices already set in it are kept, and come back if the currency is added again.'
            : ''
        }
      />
    </div>
  )
}

const chip = (color: string): React.CSSProperties => ({
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  width: '22px', height: '22px', padding: 0, borderRadius: 'var(--radius-full)',
  border: '1px solid var(--border)', background: 'white', color, cursor: 'pointer',
})

function GrantChip({ state }: { state: GrantState }) {
  const look: Record<GrantState, { label: string; ink: string; bg: string; icon: React.ReactNode }> = {
    approved:  { label: 'Trading',   ink: 'var(--success)', bg: 'var(--success-bg)', icon: <Check size={11} /> },
    requested: { label: 'Waiting',   ink: 'var(--warning)', bg: 'var(--warning-bg)', icon: <Clock size={11} /> },
    suspended: { label: 'Suspended', ink: 'var(--danger)',  bg: 'var(--danger-bg)',  icon: <Ban size={11} /> },
    /* Named rather than left blank: "not asked" and "refused" are different
       facts about a seller, and an empty cell reads as either. */
    none:      { label: 'Not asked', ink: 'var(--text-tertiary)', bg: 'var(--bg-alt)', icon: null },
  }
  const l = look[state]
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '2px 8px',
      borderRadius: 'var(--radius-full)', background: l.bg, color: l.ink,
      fontSize: '10px', fontWeight: 700, whiteSpace: 'nowrap',
    }}>
      {l.icon}{l.label}
    </span>
  )
}
