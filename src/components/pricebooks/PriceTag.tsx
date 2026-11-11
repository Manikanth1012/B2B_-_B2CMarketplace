/* The tag has only a code to go on, so the symbol and grouping come from the
   platform: ₹21,999 for INR (lakh grouping), whole amounts without decimals. */
function money(n: number, currency: string): string {
  const whole = Number.isInteger(n)
  try {
    return new Intl.NumberFormat(currency === 'INR' ? 'en-IN' : 'en-US', {
      style: 'currency', currency, currencyDisplay: 'narrowSymbol',
      minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2,
    }).format(n)
  } catch {
    return `${currency} ${n.toLocaleString('en-US')}`
  }
}

/* What an account pays against what everybody sees. When the account's price is
   lower than the published one, both are shown and the published one is struck;
   otherwise there is one figure. The sentence a screen reader gets carries both
   in words, because strike-through alone says nothing to it. */
export function PriceTag({ price, published, currency, compact }: {
  price: number
  published: number
  currency: string
  compact?: boolean
}) {
  const lower = price < published
  const label = lower
    ? `Your price ${money(price, currency)}, published price ${money(published, currency)}`
    : money(price, currency)
  return (
    <span className={`pb-tag${compact ? ' pb-tag--compact' : ''}`} role="group" aria-label={label}>
      <span aria-hidden="true" className="pb-tag__visual">
        {lower && <span className="pb-tag__label">Your price</span>}
        <span className="pb-tag__price">{money(price, currency)}</span>
        {lower && <s className="pb-tag__was">{money(published, currency)}</s>}
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
