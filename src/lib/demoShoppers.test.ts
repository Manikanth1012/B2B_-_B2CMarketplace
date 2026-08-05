/* Which demo account the header's market picker implies. Choosing Kenya and
   then being signed in as somebody in Bengaluru is the picker being ignored,
   which is worse than not offering it. */
import { describe, it, expect } from 'vitest'
import {
  shopperForMarket, shoppersFor,
  CONSUMER_SHOPPERS, PARTNER_SHOPPERS, ENTERPRISE_SHOPPERS, SHOPPERS_BY_PERSONA,
} from './demoShoppers'

describe('the account a market implies', () => {
  it('opens the card on the account registered in that market', () => {
    expect(shopperForMarket('IN')).toBe(0)
    expect(shopperForMarket('KE')).toBe(1)
  })

  it('falls back to the first account for a market with no demo account', () => {
    /* The UAE has none. A card that opens on nobody is not an improvement on a
       card that opens on the wrong person. */
    expect(shopperForMarket('AE')).toBe(0)
  })

  it('falls back before the picker has resolved', () => {
    expect(shopperForMarket(null)).toBe(0)
    expect(shopperForMarket(undefined)).toBe(0)
  })

  it('reads the list it is given, not the consumer one', () => {
    /* The default argument is the consumer list, which is what it was before
       the seller and buyer had accounts. A partner card asking for Kenya must
       not be answered from the shopper list. */
    expect(shoppersFor('partner')[shopperForMarket('KE', PARTNER_SHOPPERS)].who)
      .toBe('Beacon Reseller Co')
    expect(shoppersFor('enterprise')[shopperForMarket('KE', ENTERPRISE_SHOPPERS)].who)
      .toBe('Harbourpoint Retail')
  })
})

describe('which personas can be signed in as somewhere other than India', () => {
  it('offers a second country on every persona that is registered in one', () => {
    for (const [persona, list] of Object.entries(SHOPPERS_BY_PERSONA)) {
      expect(list.length, `${persona} has only one demo account`).toBeGreaterThan(1)
    }
  })

  it('offers none for the operator, who runs all three markets', () => {
    /* Signing in as "the operator in Kenya" would describe a role that does not
       exist. The absence is the point, not an omission. */
    expect(shoppersFor('operator')).toEqual([])
    expect(shoppersFor('')).toEqual([])
  })

  it('opens every persona on India first, so an untouched demo is unchanged', () => {
    for (const [persona, list] of Object.entries(SHOPPERS_BY_PERSONA)) {
      expect(list[0].market, `${persona} no longer opens on India`).toBe('IN')
    }
  })

  it('has a Kenyan account for every persona, which is the whole point', () => {
    /* Four faults in the Kenyan market had been live for weeks because no
       Kenyan screen could be opened. */
    for (const [persona, list] of Object.entries(SHOPPERS_BY_PERSONA)) {
      expect(list.some(s => s.market === 'KE'), `${persona} cannot be shown in Kenya`).toBe(true)
    }
  })

  it('names one account per market on each persona', () => {
    for (const [persona, list] of Object.entries(SHOPPERS_BY_PERSONA)) {
      const markets = list.map(s => s.market)
      expect(new Set(markets).size, `${persona} has two accounts in one market`).toBe(markets.length)
    }
  })

  it('gives every account an address, a password and something to say about it', () => {
    for (const list of [CONSUMER_SHOPPERS, PARTNER_SHOPPERS, ENTERPRISE_SHOPPERS]) {
      for (const s of list) {
        expect(s.email).toMatch(/@/)
        expect(s.password.length).toBeGreaterThan(7)
        expect(s.who.length).toBeGreaterThan(0)
        expect(s.where.length).toBeGreaterThan(0)
        /* The line under the name has to say why you would pick this one —
           "Nairobi, Kenya" alone does not. */
        expect(s.money.length).toBeGreaterThan(0)
      }
    }
  })

  it('never reuses one address across two personas', () => {
    const all = Object.values(SHOPPERS_BY_PERSONA).flat().map(s => s.email)
    expect(new Set(all).size).toBe(all.length)
  })
})
