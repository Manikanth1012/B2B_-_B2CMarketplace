import { describe, it, expect } from 'vitest'
import {
  activeLines, savedLines, basketCount, basketTotal, basketMoney, bySeller,
  canCheckout, canMoveToBasket, SAVED_CAVEAT, type BasketLine,
} from './basket'

const line = (o: Partial<BasketLine> & { id: string }): BasketLine => ({
  product_id: 'SKU-4004', quantity: 1, saved: false,
  product: { price: 229, stock: 'in' }, ...o,
})

describe('splitting the basket', () => {
  const lines = [
    line({ id: 'a' }),
    line({ id: 'b', saved: true }),
    line({ id: 'c', quantity: 3 }),
  ]

  it('separates what is being bought from what is set aside', () => {
    expect(activeLines(lines).map(l => l.id)).toEqual(['a', 'c'])
    expect(savedLines(lines).map(l => l.id)).toEqual(['b'])
  })

  /* The badge counts units, not lines — three of one thing is three items. */
  it('counts units and ignores saved lines', () => {
    expect(basketCount(lines)).toBe(4)
  })

  /* Charging somebody for something they explicitly set aside is the failure this
     whole split exists to prevent. */
  it('leaves saved lines out of the total', () => {
    expect(basketTotal(lines)).toBe(229 * 1 + 229 * 3)
  })

  it('copes with a line whose product did not load', () => {
    expect(basketTotal([line({ id: 'x', product: null })])).toBe(0)
  })
})

describe('canCheckout', () => {
  it('allows checkout when something is actually being bought', () => {
    expect(canCheckout([line({ id: 'a' })])).toBe(true)
  })

  it('refuses an empty basket', () => {
    expect(canCheckout([])).toBe(false)
  })

  /* A basket holding only saved items is the state that saving something puts you
     in. Offering Checkout there would buy nothing, or worse, buy the saved item. */
  it('refuses a basket that is entirely saved', () => {
    expect(canCheckout([line({ id: 'a', saved: true }), line({ id: 'b', saved: true })])).toBe(false)
  })
})

describe('canMoveToBasket', () => {
  it('allows a saved item that is still in stock', () => {
    expect(canMoveToBasket(line({ id: 'a', saved: true }))).toBe(true)
    expect(canMoveToBasket(line({ id: 'b', saved: true, product: { price: 1, stock: 'low' } }))).toBe(true)
  })

  /* Saving does not reserve stock, so a saved item can go out of stock underneath
     the customer. Moving it back has to fail visibly rather than at checkout. */
  it('refuses one that has gone out of stock while it sat there', () => {
    expect(canMoveToBasket(line({ id: 'c', saved: true, product: { price: 1, stock: 'out' } }))).toBe(false)
  })

  it('assumes in stock when the product did not load', () => {
    expect(canMoveToBasket(line({ id: 'd', saved: true, product: null }))).toBe(true)
  })
})

describe('the caveat', () => {
  /* Both are promises the marketplace cannot keep, and both are what people assume
     saving does. Said up front rather than discovered at checkout. */
  it('says saving holds neither stock nor price', () => {
    expect(SAVED_CAVEAT).toMatch(/reserve stock/i)
    expect(SAVED_CAVEAT).toMatch(/hold a price/i)
  })
})

describe('what the basket is worth, and the tax inside it', () => {
  const lines = [line({ id: 'a', product: { price: 549, stock: 'In stock' } })]

  it('treats the shelf price as the total, because that is what a shelf price is', () => {
    /* ₹549 a month is ₹549 a month. The checkout used to add eighteen percent on
       top of it, so the basket promised one figure and the order recorded
       another — and the seeded orders all say `sum(items) = total`. */
    const m = basketMoney(lines, 18)
    expect(m.total).toBe(549)
    expect(m.net + m.tax).toBe(549)
  })

  it('works the tax back out at the rate it was given', () => {
    const m = basketMoney(lines, 18)
    expect(m.net).toBe(465.25)
    expect(m.tax).toBe(83.75)
  })

  it('charges each market its own rate, not India’s everywhere', () => {
    /* Written into the cart drawer and the checkout as `0.18` — Indian GST,
       charged to a shopper in Nairobi where it is sixteen and Dubai where it is
       five. The rate is a parameter now and comes from the market. */
    expect(basketMoney(lines, 16).tax).toBe(75.72)
    expect(basketMoney(lines, 5).tax).toBe(26.14)
  })

  it('is not confused by a rate of zero', () => {
    const m = basketMoney(lines, 0)
    expect(m.net).toBe(549)
    expect(m.tax).toBe(0)
  })

  it('leaves a saved line out of all three figures', () => {
    const m = basketMoney([...lines, line({ id: 'b', saved: true, product: { price: 9999, stock: 'In stock' } })], 18)
    expect(m.total).toBe(549)
  })
})


describe('bySeller', () => {
  const line = (id: string, seller: string | undefined, saved = false) => ({
    id, product_id: 'SKU-' + id, quantity: 1, saved,
    product: seller === undefined ? null : { price: 100, seller },
  })

  it('splits a basket that spans two sellers', () => {
    const out = bySeller([line('a', 'Aventa Telecom'), line('b', 'ClearVault Cloud')])
    expect(out.map(g => g.seller)).toEqual(['Aventa Telecom', 'ClearVault Cloud'])
    expect(out.every(g => g.lines.length === 1)).toBe(true)
  })

  it('leaves a single-seller basket as one group', () => {
    const out = bySeller([line('a', 'Aventa Telecom'), line('b', 'Aventa Telecom')])
    expect(out).toHaveLength(1)
    expect(out[0].lines).toHaveLength(2)
  })

  it('leaves saved lines out — they are not being bought', () => {
    const out = bySeller([line('a', 'Aventa Telecom'), line('b', 'ClearVault Cloud', true)])
    expect(out).toHaveLength(1)
    expect(out[0].seller).toBe('Aventa Telecom')
  })

  it('keeps a line whose product did not load rather than dropping it', () => {
    /* Dropping it would charge for a basket quietly missing an item, which is
       worse than an order with no seller on it. */
    const out = bySeller([line('a', undefined)])
    expect(out).toHaveLength(1)
    expect(out[0].seller).toBe('')
    expect(out[0].lines).toHaveLength(1)
  })

  it('groups in the same order every time', () => {
    const a = bySeller([line('a', 'Zenith'), line('b', 'Aventa Telecom')])
    const b = bySeller([line('b', 'Aventa Telecom'), line('a', 'Zenith')])
    expect(a.map(g => g.seller)).toEqual(b.map(g => g.seller))
  })

  it('charges exactly what the basket said, however it is split', () => {
    /* The only figure that must survive the split unchanged. What the shopper
       agreed to pay is the sum of the shelf prices, and splitting a basket into
       two orders cannot change it by a penny. */
    const lines = [line('a', 'Aventa Telecom'), line('b', 'ClearVault Cloud')]
    const whole = basketMoney(lines, 18)
    const parts = bySeller(lines).map(g => basketMoney(g.lines, 18))
    expect(parts.reduce((n, p) => n + p.total, 0)).toBeCloseTo(whole.total, 2)
  })

  it('leaves each order adding up on its own, even where that costs a rounding unit', () => {
    /* Two orders each work their own tax back out of their own total, so the
       two nets can come to a minor unit more than one order's would have. That
       is the right way round: `subtotal + tax = total` is what each order
       asserts and what the migration checks, and no row anywhere holds "the
       whole basket's net". The cart drawer's split is an estimate over a basket
       that has not been placed; the orders' splits are the record.

       The bound is what matters — a unit per group and no more. Anything larger
       would mean the split was recomputed rather than apportioned. */
    const lines = [line('a', 'Aventa Telecom'), line('b', 'ClearVault Cloud')]
    const whole = basketMoney(lines, 18)
    const parts = bySeller(lines).map(g => basketMoney(g.lines, 18))
    for (const p of parts) expect(p.net + p.tax).toBeCloseTo(p.total, 2)
    const drift = Math.abs(parts.reduce((n, p) => n + p.net, 0) - whole.net)
    expect(drift).toBeLessThanOrEqual(0.01 * parts.length)
  })

  it('returns nothing for an empty basket', () => {
    expect(bySeller([])).toEqual([])
  })
})
