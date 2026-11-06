import { useState, useEffect } from 'react'
import { BundleCards } from '../bundles/BundleCard'
import type { CSSProperties } from 'react'
import { toast } from '../operator/shared'
/* The card resolves its photo with the same resolver the storefront and the
   basket use (`getProductImage`). A business buyer and a shopper are looking at
   one `products` row — SKU-4001 is the same handset on both shelves — so the
   photo has to come from one place or the two screens quietly disagree about
   what is being sold. */
import { ProductCard, ListingLayout, ListingGrid, EmptyListing, CategoryTile, categoryIcon } from '../ui'
import { pricedFor, cardAction } from '../../lib/storefront'
import { categoryVisual } from '../../lib/home'
import { useRequisition } from '../../lib/RequisitionContext'
import { holdsQuote, quoteHoldsCurrency } from '../../lib/requisitionBasket'
import type { EnterpriseListing as Listing } from '../../lib/enterpriseRepo'

/* One shape of line from one shape of row, used by both catalogue screens, so
   a requisition raised from the vertical view and one raised from Browse
   describe the same purchase. */
export function lineFor(p: Listing) {
  return {
    product_id: p.id, name: p.name, seller: p.seller, partner_id: p.partner_id,
    unit_price: p.price, model: p.model === 'monthly' ? 'monthly' as const : 'oneoff' as const,
    vertical: p.category_id, unit: p.unit,
  }
}
import { VERTICAL_NAMES } from './data'
import { loadAccount, loadEnterpriseCatalogue } from '../../lib/enterpriseRepo'
import type { EnterpriseListing } from '../../lib/enterpriseRepo'
import { useAccountMoney } from './money'
import { useMarket } from '../../lib/MarketContext'
import type { Policy, Subscription } from '../../lib/enterprise'
import { EnterpriseListingModal } from './EnterpriseListingModal'
import { CompareTray, CompareTable } from '../CompareTray'
import { toggleCompare, COMPARE_CAP } from '../../lib/compare'
import type { Comparable } from '../../lib/compare'

export function EnterpriseBrowse() {
  const [vertical, setVertical] = useState<string | null>(null)
  const [category, setCategory] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  /* The threshold quoted here is the account's own, not a constant — a
     catalogue that promises a different rule from the one the Approvals screen
     applies is worse than one that promises nothing. */
  const [policy, setPolicy] = useState<Policy | null>(null)
  /* What the catalogue is quoted in.

     The choice comes from the header picker rather than a second chooser on
     this screen. `MarketContext` already pins the market to
     `enterprise_accounts.market` for a signed-in business and offers exactly
     the currencies that market takes — the same list
     `guard_requisition_currency` accepts. A control here as well would be a
     second answer to one question, which is how the picker and the guard came
     to disagree in the first place.

     `offered` is that list, kept for the sentence under the banner; an account
     in India has one entry and there is nothing to say. */
  const { currency: chosen } = useMarket()
  const [offered, setOffered] = useState<string[]>([])
  /* The account's primary currency stays separate from the quote currency,
     because the approval threshold is set in it and does not move when the
     shelf does. Quoting a rupee threshold with a shilling mark is the mistake
     this pair of variables exists to keep apart. */
  const [primary, setPrimary] = useState<string | null>(null)
  const currency = primary === null ? null
    : chosen && offered.includes(chosen.code) ? chosen.code
    : primary
  const { money } = useAccountMoney(currency)
  const { money0 } = useAccountMoney(primary)
  /* The catalogue itself, from `products` rather than from a constant. The
     constant listed twelve items with dollar prices and SKU ids that named
     different products in the real catalogue — `SKU-3001` was an IoT SIM pack
     here and StreamNova Premium 4K in the table — so a requisition raised from
     this screen would have referred to a consumer streaming subscription. */
  const [listings, setListings] = useState<EnterpriseListing[] | null>(null)
  /* The listing a buyer clicked. Clicking a card used to be
     `toast(`Listing detail: ${p.name}`)` — the card's own title, in a bubble
     that vanished. */
  const [viewing, setViewing] = useState<EnterpriseListing | null>(null)
  /* Held by id so a pick survives a filter change or a reprice — both rebuild
     the listing object and neither changes the id. */
  const [comparing, setComparing] = useState<string[]>([])
  const [showCompare, setShowCompare] = useState(false)
  /* What the account already holds, so the detail can say "you are paying for
     twelve of these and four are idle" before somebody orders more. */
  const [subs, setSubs] = useState<Subscription[]>([])
  useEffect(() => {
    void (async () => {
      const book = await loadAccount()
      setPolicy(book.policy)
      setPrimary(book.account?.currency ?? 'USD')
      setOffered(book.currencies)
      setSubs(book.subscriptions)
    })()
  }, [])

  /* Re-read the shelf when the currency moves rather than converting what is
     already on it. A price is chosen per market, not derived from another
     market's — `product_prices` holds a row per currency and that row is the
     price, so converting the rupee one would show a figure nobody set. */
  useEffect(() => {
    if (!currency) return
    let live = true
    setListings(null)
    void loadEnterpriseCatalogue(currency).then(rows => { if (live) setListings(rows) })
    return () => { live = false }
  }, [currency])
  const [sort, setSort] = useState('popular')

  /* Adding says what happened either way. The refusals are real ones — a second
     currency, a monthly line joining a one-off requisition — and a silent
     no-op is what this button used to be. */
  const req = useRequisition()
  const addToRequisition = (p: EnterpriseListing) => {
    if (!currency) return
    const r = req.add(lineFor(p), currency)
    if (!r.ok) { toast(r.reason, 'error'); return }
    toast(r.note ?? `${p.name} added`, 'success')
  }

  /* The basket follows the shelf. Prices are chosen per currency rather than
     converted, so when the header picker moves, the lines are re-read at the
     new shelf's figures instead of being multiplied by a rate. */
  useEffect(() => {
    if (!currency || !listings || !req.basket.lines.length) return
    if (req.basket.currency === currency) return
    /* A quoted price is in the quote's currency and is not on any shelf, so a
       basket holding one stays where it is (repriceTo leaves it alone too). */
    if (holdsQuote(req.basket)) {
      toast(quoteHoldsCurrency(req.basket.currency, currency), 'info')
      return
    }
    const dropped = req.reprice(currency, listings)
    if (dropped.length) {
      toast(`${dropped.join(' and ')} ${dropped.length === 1 ? 'is' : 'are'} not sold in ${currency}, so ${dropped.length === 1 ? 'it was' : 'they were'} taken out of your requisition.`, 'error')
    } else {
      toast(`Your requisition is now priced in ${currency}.`, 'info')
    }
    /* `req` identity changes on every basket edit; depending on it would
       reprice in a loop. The currency and the shelf are what this reacts to. */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currency, listings])

  /* Resolved against the loaded catalogue every render, so a listing withdrawn
     while the tray was open drops out rather than being compared from a stale
     copy. */
  const picks: Comparable[] = comparing
    .map(id => (listings ?? []).find(l => l.id === id))
    .filter((l): l is EnterpriseListing => !!l)
    .map(l => ({
      id: l.id, name: l.name, seller: l.seller, price: l.price,
      currency, rating: l.rating, reviews: l.reviews,
      stock: l.stock ?? 'in', fulfil: l.fulfil, model: l.model, unit: l.unit,
      category_id: l.category_id, specs: l.specs,
      price_includes_tax: l.price_includes_tax,
    }))

  const pick = (id: string) => {
    const r = toggleCompare(comparing, id)
    setComparing(r.ids)
    if (!r.ok) toast(r.reason, 'error')
    else if (r.note) toast(r.note, 'info')
  }

  /* Only what the account's currency actually prices. `currency` on a listing
     falls back to USD when the price book has no row for the account's
     currency, so without this a buyer in rupees would see a dollar figure on a
     shelf they cannot buy from. */
  const priced = pricedFor(listings ?? [], currency ?? '')
  let results = priced
  if (vertical) results = results.filter(p => p.category_id === vertical)
  if (category) results = results.filter(p => p.sub_category === category)
  if (query) {
    const q = query.toLowerCase()
    results = results.filter(p => (p.name + ' ' + p.description + ' ' + p.seller + ' ' + (p.sub_category ?? '')).toLowerCase().includes(q))
  }
  results = results.slice().sort((a, b) =>
    sort === 'priceup' ? a.price - b.price
    : sort === 'pricedown' ? b.price - a.price
    : sort === 'rating' ? (b.rating || 0) - (a.rating || 0)
    : (b.reviews || 0) - (a.reviews || 0))

  const all = priced
  const cats = Array.from(new Set((vertical ? all.filter(p => p.category_id === vertical) : all)
    .map(p => p.sub_category).filter((c): c is string => !!c)))
  /* One tile per shelf that has something priced for this account. */
  const shelves = Array.from(new Set(all.map(p => p.category_id)))

  const reset = () => { setVertical(null); setCategory(null); setQuery('') }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <ListingLayout
        title={vertical ? VERTICAL_NAMES[vertical] : 'Business Catalogue'}
        subtitle={`${results.length} of ${all.length} listings approved for business accounts · sold by ${new Set(results.map(p => p.seller)).size} sellers`}
        count={results.length}
        total={all.length}
        search={{ value: query, onChange: setQuery, placeholder: 'Search the catalogue' }}
        sort={{
          value: sort, onChange: setSort,
          options: [
            { value: 'popular', label: 'Most popular' },
            { value: 'rating', label: 'Highest rated' },
            { value: 'priceup', label: 'Price: low to high' },
            { value: 'pricedown', label: 'Price: high to low' },
          ],
        }}
        filters={[
          {
            id: 'vertical', title: 'Marketplace', selected: vertical,
            onSelect: v => { setVertical(v); setCategory(null) },
            /* Taken from the loaded listings (first-seen order), not a fixed trio. */
            options: shelves.map(v => ({
              value: v, label: VERTICAL_NAMES[v]?.replace(' Marketplace', '') ?? v,
              count: all.filter(p => p.category_id === v).length,
            })),
          },
          {
            id: 'category', title: 'Category', selected: category, onSelect: setCategory,
            options: cats.map(c => ({
              value: c, label: c,
              count: all.filter(p => p.sub_category === c && (!vertical || p.category_id === vertical)).length,
            })),
          },
        ]}
        onClear={reset}
        above={
          <>
            <div className="info-strip">
              <div>
                Everything here is pre-approved for business purchase. {policy
                  ? `Anything at or above ${money0(Number(policy.threshold))} needs finance approval before the order is placed${policy.security_signoff ? '; security purchases also need IT sign-off whatever they cost' : ''}.`
                  : 'Your account’s approval thresholds are loading.'}
                {/* Said only where there is a choice to have made. An account in India
                    never sees it, because India trades in rupees alone. */}
                {offered.length > 1 && (
                  <div style={{ fontSize: 'var(--text-xs)', marginTop: '8px' }}>
                    {currency === primary
                      ? `Priced in ${currency}. This account may also buy in ${offered.filter(c => c !== primary).join(' or ')} — the currency picker in the header changes it.`
                      : `Priced in ${currency}. The ${money0(Number(policy?.threshold ?? 0))} threshold stays in ${primary}, and a requisition raised in ${currency} is converted to it at the rate on the day it is raised.`}
                  </div>
                )}
              </div>
            </div>
            {shelves.length > 0 && (
              <div className="cat-row cat-row--compact" style={{ '--cat-cols': Math.min(shelves.length, 6), marginBottom: '16px' } as CSSProperties}>
                {shelves.map(id => (
                  <CategoryTile
                    key={id}
                    name={VERTICAL_NAMES[id]?.replace(' Marketplace', '') ?? id}
                    count={all.filter(p => p.category_id === id).length}
                    visual={categoryVisual(id)}
                    icon={categoryIcon(id)}
                    onClick={() => { setVertical(id); setCategory(null) }}
                  />
                ))}
              </div>
            )}
          </>
        }
      >
        {/* "Nothing matches" while the catalogue is still in flight would tell
            a buyer their filters excluded everything, which is a different
            and wrong statement. */}
        {listings === null ? (
          <div style={{ textAlign: 'center', padding: '40px' }}><div className="spinner" style={{ margin: '0 auto' }} /></div>
        ) : results.length > 0 ? (
          <ListingGrid>
            {/* Configurable bundles first; a Category filter is a product facet, so it leaves them out. */}
            {!category && <BundleCards audience="enterprise" currency={currency} category={vertical} search={query} />}
            {results.map(p => {
              const a = cardAction('enterprise', p)
              return (
                <ProductCard
                  key={p.id}
                  product={p}
                  onOpen={() => setViewing(p)}
                  action={{ label: a.label, disabled: a.disabled, onClick: () => addToRequisition(p) }}
                  compare={{
                    checked: comparing.includes(p.id),
                    disabled: comparing.length >= COMPARE_CAP && !comparing.includes(p.id),
                    onToggle: () => pick(p.id),
                  }}
                  showStock
                  priceNote={p.model === 'monthly' ? (p.unit ? ` ${p.unit}/mo` : '/mo') : undefined}
                />
              )
            })}
          </ListingGrid>
        ) : (
          <EmptyListing title="Nothing matches" text="No business listings match those filters." onClear={reset} />
        )}
      </ListingLayout>

      <CompareTray
        picks={picks}
        onRemove={id => setComparing(comparing.filter(x => x !== id))}
        onClear={() => { setComparing([]); setShowCompare(false) }}
        onOpen={() => setShowCompare(true)}
      />

      {showCompare && picks.length >= 2 && (
        <CompareTable
          picks={picks}
          money={(n) => money(n)}
          actionLabel="Add to requisition"
          onAction={item => {
            const listing = (listings ?? []).find(x => x.id === item.id)
            if (listing) addToRequisition(listing)
          }}
          onRemove={id => setComparing(comparing.filter(x => x !== id))}
          onClose={() => setShowCompare(false)}
        />
      )}

      <EnterpriseListingModal
        listing={viewing}
        held={viewing ? subs.filter(x => x.product_id === viewing.id) : []}
        money={money}
        onClose={() => setViewing(null)}
        onAdd={addToRequisition}
      />
    </div>
  )
}
