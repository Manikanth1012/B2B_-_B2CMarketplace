/* Basket rules, pure. What counts as "in the basket" once saving for later exists. */

export interface BasketLine {
  id: string
  product_id: string
  quantity: number
  saved: boolean
  product?: { price: number; stock?: string; seller?: string } | null
}

/* Everything below turns on one rule: a saved line is not in the basket. It is not
   counted on the header badge, not in the totals, and not bought at checkout. Getting
   that wrong charges somebody for something they explicitly set aside. */

export function activeLines<T extends BasketLine>(lines: readonly T[]): T[] {
  return lines.filter(l => !l.saved)
}

export function savedLines<T extends BasketLine>(lines: readonly T[]): T[] {
  return lines.filter(l => l.saved)
}

/** The number on the header badge — units, not lines, and active only. */
export function basketCount(lines: readonly BasketLine[]): number {
  return activeLines(lines).reduce((n, l) => n + l.quantity, 0)
}

/**
 * What the basket comes to, at the prices on the lines.
 *
 * Tax-inclusive, because a shelf price is. Every seeded order on this
 * marketplace has `sum(items) = total` rather than `= subtotal`, and that is how
 * a consumer price is quoted in all three of these markets — ₹549 a month is
 * ₹549 a month, not ₹549 plus GST.
 *
 * The checkout used to treat it as exclusive and add eighteen percent on top, so
 * the basket promised one number and the order recorded another.
 */
export function basketTotal(lines: readonly BasketLine[]): number {
  return activeLines(lines).reduce((sum, l) => sum + (l.product?.price ?? 0) * l.quantity, 0)
}

export interface BasketMoney {
  /* Before tax, worked back out of the total. */
  net: number
  tax: number
  total: number
}

/**
 * The three figures a basket shows, from one total and the rate where the
 * shopper is.
 *
 * `taxRate` is a percentage and comes from the market. It was written into the
 * cart drawer and the checkout as `0.18` — India's GST, charged to a shopper in
 * Nairobi where it is sixteen and in Dubai where it is five.
 */
export function basketMoney(lines: readonly BasketLine[], taxRate: number): BasketMoney {
  const total = round2(basketTotal(lines))
  const net = round2(total / (1 + taxRate / 100))
  return { net, tax: round2(total - net), total }
}

const round2 = (n: number) => Math.round(n * 100) / 100

/**
 * A basket split into one group per seller.
 *
 * `orders.seller` holds one name, and settlement is per seller: a refund is
 * recovered from the seller whose product it was, and a statement is one
 * seller's lines. So an order spanning two sellers is not a thing the rest of
 * the marketplace can act on — the checkout wrote "Aventa Telecom, ClearVault
 * Cloud" into that column and the catalogue-integrity suite caught it, because
 * neither of the two products was sold by a seller of that name.
 *
 * The comment it replaces said "every basket here is single-seller in practice",
 * which was true of the seeded data and false of the first basket anybody
 * actually filled.
 *
 * Ordered by seller name so two runs of the same basket produce the same
 * grouping — the order references are minted from the position, and a set that
 * reshuffles would hand the same shopper different references for the same
 * purchase.
 */
export function bySeller<T extends BasketLine>(lines: readonly T[]): { seller: string; lines: T[] }[] {
  const groups = new Map<string, T[]>()
  for (const l of activeLines(lines)) {
    /* A line whose product did not load has no seller to settle against. It is
       grouped under the empty string rather than dropped: dropping it would
       charge for a basket quietly missing an item. */
    const seller = l.product?.seller ?? ''
    const held = groups.get(seller)
    if (held) held.push(l); else groups.set(seller, [l])
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([seller, ls]) => ({ seller, lines: ls }))
}


/** Can this go through checkout? An empty basket cannot, and neither can one whose
    only contents are saved — that is the state saving something puts you in. */
export function canCheckout(lines: readonly BasketLine[]): boolean {
  return activeLines(lines).length > 0
}

/* What saving does *not* do, stated where the UI can show it: it does not hold stock
   and it does not hold the price. Both are the questions people actually ask, and
   both would be a promise the marketplace cannot keep. */
export const SAVED_CAVEAT = 'Saving does not reserve stock or hold a price.'

/** A saved item whose product has since gone out of stock cannot be moved back. */
export function canMoveToBasket(line: BasketLine): boolean {
  const stock = line.product?.stock?.toLowerCase() ?? 'in'
  return !stock.includes('out')
}
