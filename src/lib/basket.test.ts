import { describe, it, expect } from 'vitest'
import {
  activeLines, savedLines, basketCount, basketSubtotal,
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
    expect(basketSubtotal(lines)).toBe(229 * 1 + 229 * 3)
  })

  it('copes with a line whose product did not load', () => {
    expect(basketSubtotal([line({ id: 'x', product: null })])).toBe(0)
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
