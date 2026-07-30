/* Basket rules, pure. What counts as "in the basket" once saving for later exists. */

export interface BasketLine {
  id: string
  product_id: string
  quantity: number
  saved: boolean
  product?: { price: number; stock?: string } | null
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

export function basketSubtotal(lines: readonly BasketLine[]): number {
  return activeLines(lines).reduce((sum, l) => sum + (l.product?.price ?? 0) * l.quantity, 0)
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
