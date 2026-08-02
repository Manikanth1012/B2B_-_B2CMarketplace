/* Setting a listing's price in each market it sells in.
 *
 * One component for both consoles. The operator prices anything in any market
 * the marketplace has opened; a seller prices their own listings in the markets
 * they are approved for. Those are different permissions over the same act, and
 * writing the editor twice is how the two drift until a seller can do something
 * on one screen that the other refuses.
 *
 * What it will not do is decide anything. The rules are in `marketPricing.ts`
 * and enforced again by RLS and `guard_price_book` — this asks them and draws
 * the answer. A price refused by the database after being accepted by the form
 * is a form that lied.
 */
import { useState, useEffect, useCallback } from 'react'
import { Trash2, Wand as Wand2, TriangleAlert as AlertTriangle, Check } from 'lucide-react'
import {
  priceableCurrencies, priceProblems, problemOn, priceIsUsable,
  suggestPrice, missingPrices, draftFrom, emptyDraft, toRow, marketsFor,
} from '../lib/marketPricing'
import type { BookRow, PartnerMarket, PriceDraft, PriceField } from '../lib/marketPricing'
import { currenciesOf, marketsTaking, symbolOf } from '../lib/money'
import { loadProductPrices, loadPartnerMarkets, setPrice, clearPrice } from '../lib/moneyRepo'
import { useMarket } from '../lib/MarketContext'
import { Btn, toast } from './operator/shared'

export function PriceBookEditor({ product, who, onChanged }: {
  product: { id: string; name: string; partner_id: string | null; price: number; currency?: string }
  who: { persona: 'operator' | 'partner'; partnerId?: string | null }
  onChanged?: () => void
}) {
  const { book } = useMarket()
  const [rows, setRows] = useState<BookRow[]>([])
  const [grants, setGrants] = useState<PartnerMarket[]>([])
  const [drafts, setDrafts] = useState<Record<string, PriceDraft>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const reload = useCallback(async () => {
    const [r, g] = await Promise.all([
      loadProductPrices(product.id),
      loadPartnerMarkets(product.partner_id ?? undefined),
    ])
    setRows(r); setGrants(g)
    setDrafts(Object.fromEntries(r.map(x => [x.currency, draftFrom(x)])))
    setLoading(false)
  }, [product.id, product.partner_id])

  useEffect(() => { void reload() }, [reload])

  /* Whose permission decides. For the operator this is every currency every
     market takes; for a seller, only the markets they are approved in — and a
     seller editing their own product is asked about *their* grants, not the
     product owner's, because on their own console those are the same thing and
     on the operator's they are not.
     `book.accepted` is what makes this more than one currency per market: a
     seller approved in Kenya prices in shillings and in dollars. */
  const allowed = priceableCurrencies(who, book.markets, grants, book.accepted)
  /* The operator is not limited by the seller's grants, but should still be
     told when they are pricing into a market that seller cannot trade in —
     that is a decision, not an accident. */
  const sellerCurrencies = new Set(
    (product.partner_id
      ? marketsFor(grants, product.partner_id, book.markets)
      : book.markets
    ).flatMap(m => {
      const takes = currenciesOf(m.code, book.accepted)
      return takes.length ? takes : [m.currency]
    }),
  )

  const gaps = missingPrices(rows, product.id, allowed)

  const set = (currency: string, field: PriceField, value: string) =>
    setDrafts(d => ({ ...d, [currency]: { ...(d[currency] ?? emptyDraft(currency)), [field]: value } }))

  async function save(currency: string) {
    const draft = drafts[currency]
    if (!draft) return
    setBusy(currency)
    const res = await setPrice(toRow(draft, product.id))
    setBusy(null)
    if (!res.ok) { toast(res.reason ?? 'That price was not saved', 'error'); return }
    toast(`${product.name} priced in ${currency}`)
    await reload()
    onChanged?.()
  }

  async function remove(currency: string) {
    setBusy(currency)
    const res = await clearPrice(product.id, currency)
    setBusy(null)
    if (!res.ok) { toast(res.reason ?? 'Nothing was removed', 'error'); return }
    toast(`Withdrawn from the ${currency} market`)
    await reload()
    onChanged?.()
  }

  function suggest(currency: string) {
    /* From the base listing, at the rate in force today, then charm-rounded —
       offered into the field rather than saved, because a converted price is a
       guess about a market the seller knows better than we do. */
    const s = suggestPrice(
      { amount: product.price, currency: product.currency ?? 'USD' },
      currency, book.rates, new Date().toISOString().slice(0, 10),
    )
    if (!s) { toast(`No rate to ${currency} on file`, 'error'); return }
    set(currency, 'price', String(s.price))
    toast(`Suggested from ${product.currency ?? 'USD'} at ${s.rate.toFixed(4)} (${s.as_of})`)
  }

  if (loading) {
    return <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>Loading prices…</p>
  }

  if (allowed.length === 0) {
    return (
      <Note tone="warning">
        This seller is not approved to trade in any market yet, so there is nowhere to set a price.
        Markets are granted on the seller's record.
      </Note>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      <Note tone="info">
        A price is set per market, not converted at checkout. Removing one withdraws the listing from
        that market — the shopper there stops seeing it rather than seeing it in somebody else's currency.
      </Note>

      {[...rows.map(r => r.currency), ...gaps].map(currency => {
        /* A currency, not a market — dollars sell in Nairobi and Dubai at once,
           so the row is headed by every market it reaches and by each of their
           taxes, which differ. One price, two tax rates, and a seller who is
           told only one of them prices against the wrong margin. */
        const reaches = marketsTaking(currency, book.accepted, book.markets)
          .map(c => book.markets.find(m => m.code === c)!)
          .filter(Boolean)
        const draft = drafts[currency] ?? emptyDraft(currency)
        const existing = rows.find(r => r.currency === currency)
        const problems = priceProblems(draft, allowed, book.currencies)
        const usable = priceIsUsable(draft, allowed, book.currencies)
        const cannotTrade = !sellerCurrencies.has(currency)

        return (
          <div key={currency} style={{
            border: `1px solid ${existing ? 'var(--border)' : 'var(--warning)'}`,
            borderRadius: 'var(--radius-md)', overflow: 'hidden',
            background: existing ? 'white' : 'var(--warning-bg)',
          }}>
            <div style={{
              display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap',
              padding: '9px 12px', borderBottom: '1px solid var(--border-light)',
            }}>
              {/* A currency whose symbol *is* its code — the dirham — must not
                  be headed "AED AED". */}
              <strong style={{ fontSize: 'var(--text-sm)' }}>
                {symbolOf(currency, book.currencies) === currency
                  ? currency
                  : `${symbolOf(currency, book.currencies)} ${currency}`}
              </strong>
              <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
                {reaches.length
                  ? reaches.map(m => `${m.name} (${m.tax_label} ${m.tax_rate}%)`).join(' · ')
                  : 'no market takes this currency'}
              </span>
              {!existing && (
                <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--warning)' }}>
                  Not priced — not on sale here
                </span>
              )}
              {cannotTrade && (
                <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--danger)' }}>
                  Seller not approved in this market
                </span>
              )}
              <span style={{ marginLeft: 'auto', display: 'flex', gap: '6px' }}>
                <Btn variant="secondary" size="sm" onClick={() => suggest(currency)}>
                  <Wand2 size={12} /> Suggest
                </Btn>
                <Btn size="sm" disabled={!usable || busy === currency} onClick={() => save(currency)}>
                  <Check size={12} /> {existing ? 'Save' : 'Set price'}
                </Btn>
                {existing && (
                  <Btn variant="danger" size="sm" disabled={busy === currency} onClick={() => remove(currency)}>
                    <Trash2 size={12} />
                  </Btn>
                )}
              </span>
            </div>

            <div style={{
              /* 110px so all four fit one row in the modal rather than leaving
                 "List" alone underneath, which reads as a separate section. */
              display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))',
              gap: '10px', padding: '12px',
            }}>
              <Field label="Price" required value={draft.price} currency={currency}
                     error={problemOn(problems, 'price')}
                     onChange={v => set(currency, 'price', v)} />
              <Field label="Was (strikethrough)" value={draft.was_price} currency={currency}
                     error={problemOn(problems, 'was_price')}
                     onChange={v => set(currency, 'was_price', v)} />
              <Field label="Floor" value={draft.floor_price} currency={currency}
                     error={problemOn(problems, 'floor_price')}
                     onChange={v => set(currency, 'floor_price', v)} />
              <Field label="List" value={draft.list_price} currency={currency}
                     error={problemOn(problems, 'list_price')}
                     onChange={v => set(currency, 'list_price', v)} />
            </div>
          </div>
        )
      })}
    </div>
  )
}

function Field({ label, value, onChange, error, required, currency }: {
  label: string; value: string; onChange: (v: string) => void
  error?: string | null; required?: boolean; currency: string
}) {
  const { fmtIn } = useMarket()
  const n = Number(value)
  const preview = value.trim() !== '' && Number.isFinite(n) && n > 0 ? fmtIn(n, currency) : null

  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
      <span style={{ fontSize: '10px', color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
        {label}{required && <span style={{ color: 'var(--danger)' }}> *</span>}
      </span>
      <input
        value={value}
        onChange={e => onChange(e.target.value)}
        inputMode="decimal"
        placeholder="—"
        style={{
          padding: '7px 9px', fontSize: 'var(--text-sm)',
          border: `1px solid ${error ? 'var(--danger)' : 'var(--border)'}`,
          borderRadius: 'var(--radius-sm)', width: '100%',
        }}
      />
      {/* What the shopper will read, with the market's own grouping on it —
          ₹1,00,000 rather than ₹100,000. Typing a number and seeing it
          formatted is how a misplaced digit gets noticed. */}
      {error
        ? <span style={{ fontSize: '10px', color: 'var(--danger)', lineHeight: 1.35 }}>{error}</span>
        : preview && <span style={{ fontSize: '10px', color: 'var(--text-tertiary)' }}>{preview}</span>}
    </label>
  )
}

function Note({ tone, children }: { tone: 'info' | 'warning'; children: React.ReactNode }) {
  const ink = tone === 'info' ? 'var(--info)' : 'var(--warning)'
  const bg = tone === 'info' ? 'var(--info-bg)' : 'var(--warning-bg)'
  return (
    <div style={{
      display: 'flex', gap: '8px', alignItems: 'flex-start', padding: '9px 11px',
      background: bg, borderLeft: `3px solid ${ink}`, borderRadius: 'var(--radius-md)',
    }}>
      <AlertTriangle size={14} style={{ color: ink, flexShrink: 0, marginTop: '1px' }} />
      <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', margin: 0, lineHeight: 1.5 }}>
        {children}
      </p>
    </div>
  )
}
