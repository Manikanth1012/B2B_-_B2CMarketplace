/* Which demo shopper the header's market picker implies. Choosing Kenya and
   then being signed in as somebody in Bengaluru is the picker being ignored,
   which is worse than not offering it. */
import { describe, it, expect } from 'vitest'
import { shopperForMarket } from './demoShoppers'

describe('the shopper a market implies', () => {
  it('opens the consumer card on the shopper registered in that market', () => {
    expect(shopperForMarket('IN')).toBe(0)
    expect(shopperForMarket('KE')).toBe(1)
  })

  it('falls back to the first shopper for a market with no demo account', () => {
    /* The UAE has none. A card that opens on nobody is not an improvement on a
       card that opens on the wrong person. */
    expect(shopperForMarket('AE')).toBe(0)
  })

  it('falls back before the picker has resolved', () => {
    expect(shopperForMarket(null)).toBe(0)
    expect(shopperForMarket(undefined)).toBe(0)
  })
})
