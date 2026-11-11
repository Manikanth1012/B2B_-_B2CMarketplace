import { useMarket } from '../../lib/MarketContext'
import { priceText, needsDecimals } from '../../lib/priceText'

/* What an account pays against what everybody sees. When the account's price is
   lower than the published one, both are shown and the published one is struck;
   otherwise there is one figure. The sentence a screen reader gets carries both
   in words, because strike-through alone says nothing to it. `compact` only
   tightens the type; figures are never abbreviated. */
export function PriceTag({ price, published, currency, compact }: {
  price: number
  published: number
  currency: string
  compact?: boolean
}) {
  const { book } = useMarket()
  const dec = needsDecimals(price, published)
  const fmt = (n: number) => priceText(n, currency, book?.currencies ?? [], dec)
  const lower = price < published
  const sentence = lower
    ? `Your price ${fmt(price)}, published price ${fmt(published)}`
    : fmt(price)
  return (
    <span className={`pb-tag${compact ? ' pb-tag--compact' : ''}`}>
      <span className="sr-only">{sentence}</span>
      <span aria-hidden="true" className="pb-tag__visual">
        {lower && <span className="pb-tag__label">Your price</span>}
        <span className="pb-tag__price">{fmt(price)}</span>
        {lower && <s className="pb-tag__was">{fmt(published)}</s>}
      </span>
    </span>
  )
}

export function ContractBadge() {
  return <span className="pb-badge pb-badge--contract">On your price book</span>
}

export function PreferredBadge({ kind }: { kind: 'seller' | 'product' }) {
  return <span className="pb-badge pb-badge--preferred">{kind === 'seller' ? 'Preferred seller' : 'Preferred product'}</span>
}

/* Said in words on the page, never in a tooltip: a reason in a tooltip is not
   there for a keyboard or a touch screen. */
export function OffContractMarker({ reason }: { reason?: string }) {
  return (
    <span className="pb-off">
      <span className="pb-off__label">Off your price book</span>
      {reason && <span className="pb-off__reason">{reason}</span>}
    </span>
  )
}
