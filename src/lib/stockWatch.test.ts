import { describe, it, expect } from 'vitest'
import {
  isOutOfStock, isOpen, openWatchFor, canWatch,
  watchState, watchStateLabel, orderWatches,
  defaultAddressFor, validateDestination, demandByProduct,
  WATCH_CAVEAT, type Watch,
} from './stockWatch'

const watch = (o: Partial<Watch> & { id: string }): Watch => ({
  product_id: 'SKU-4008', channel: 'Email', to_address: 'p@example.com',
  since: '2026-07-14', notified_at: null, ...o,
})

describe('stock state', () => {
  it('only counts "out" as out of stock — low is still buyable', () => {
    expect(isOutOfStock({ stock: 'out' })).toBe(true)
    expect(isOutOfStock({ stock: 'OUT' })).toBe(true)
    expect(isOutOfStock({ stock: 'low' })).toBe(false)
    expect(isOutOfStock({ stock: 'in' })).toBe(false)
  })
})

describe('canWatch', () => {
  it('offers an alert on something that cannot be bought', () => {
    expect(canWatch({ stock: 'out' }, [], 'SKU-4008')).toBe(true)
  })

  it('does not offer one on something already in stock', () => {
    expect(canWatch({ stock: 'in' }, [], 'SKU-4008')).toBe(false)
  })

  /* Asking twice is the same request. Two rows would send two alerts. */
  it('does not offer a second alert while one is open', () => {
    expect(canWatch({ stock: 'out' }, [watch({ id: 'WCH-1' })], 'SKU-4008')).toBe(false)
  })

  /* A closed watch is history — the next time it sells out, they can ask again. */
  it('offers again once the previous alert has been sent', () => {
    expect(canWatch({ stock: 'out' }, [watch({ id: 'WCH-1', notified_at: '2026-07-21' })], 'SKU-4008')).toBe(true)
  })
})

describe('watchState', () => {
  it('is told once the alert has gone out', () => {
    expect(watchState(watch({ id: 'a', notified_at: '2026-07-21' }), { stock: 'out' })).toBe('told')
  })

  it('is waiting while the product is still out', () => {
    expect(watchState(watch({ id: 'a' }), { stock: 'out' })).toBe('waiting')
  })

  /* The distinction that matters: an open watch on a product that is back means the
     alert has not gone out yet but the thing is buyable now. Calling that "still
     waiting" would hide something the shopper asked for and can have. */
  it('is back in stock when the product returned before the alert went out', () => {
    expect(watchState(watch({ id: 'a' }), { stock: 'in' })).toBe('back')
  })

  it('does not claim a product is out when it could not be loaded', () => {
    expect(watchState(watch({ id: 'a' }), undefined)).toBe('back')
  })

  it('labels each state, with the date where there is one', () => {
    expect(watchStateLabel('told', '21 Jul 2026')).toBe('Told 21 Jul 2026')
    expect(watchStateLabel('told', null)).toBe('Told')
    expect(watchStateLabel('waiting')).toBe('Still out of stock')
    expect(watchStateLabel('back')).toBe('Back in stock')
  })
})

describe('orderWatches', () => {
  it('puts live promises above closed records, newest first', () => {
    const out = orderWatches([
      watch({ id: 'old', since: '2026-05-01' }),
      watch({ id: 'done', since: '2026-07-20', notified_at: '2026-07-21' }),
      watch({ id: 'new', since: '2026-07-14' }),
    ])
    expect(out.map(w => w.id)).toEqual(['new', 'old', 'done'])
  })

  it('does not mutate its input', () => {
    const input = [watch({ id: 'a', notified_at: '2026-07-21' }), watch({ id: 'b' })]
    orderWatches(input)
    expect(input[0].id).toBe('a')
  })
})

describe('where to send it', () => {
  const profile = { email: 'priya@example.com', msisdn: '+91 98860 41127' }

  it('defaults from the profile, per channel', () => {
    expect(defaultAddressFor('Email', profile)).toBe('priya@example.com')
    expect(defaultAddressFor('SMS', profile)).toBe('+91 98860 41127')
  })

  it('copes with a profile missing the field', () => {
    expect(defaultAddressFor('SMS', { email: 'x@y.z' })).toBe('')
  })

  it('rejects an empty destination in the channel it was asked for', () => {
    expect(validateDestination('Email', '  ')).toMatch(/email/i)
    expect(validateDestination('SMS', '')).toMatch(/mobile/i)
  })

  it('catches an address in the wrong shape', () => {
    expect(validateDestination('Email', 'not-an-address')).toBeTruthy()
    expect(validateDestination('SMS', 'nope')).toBeTruthy()
  })

  it('accepts a sensible one', () => {
    expect(validateDestination('Email', 'priya@example.com')).toBeNull()
    expect(validateDestination('SMS', '+91 98860 41127')).toBeNull()
  })
})

describe('demandByProduct', () => {
  /* The reorder signal: a line nobody is waiting for and a line twelve people are
     waiting for should not look the same on the inventory screen. */
  it('counts open watches per product, busiest first', () => {
    expect(demandByProduct([
      watch({ id: '1', product_id: 'SKU-A' }),
      watch({ id: '2', product_id: 'SKU-B' }),
      watch({ id: '3', product_id: 'SKU-B' }),
    ])).toEqual([
      { productId: 'SKU-B', waiting: 2 },
      { productId: 'SKU-A', waiting: 1 },
    ])
  })

  /* Someone already told is not still waiting, and counting them would overstate
     demand for something that may now be back on the shelf. */
  it('leaves out watches that have already been sent', () => {
    expect(demandByProduct([
      watch({ id: '1', product_id: 'SKU-A', notified_at: '2026-07-21' }),
      watch({ id: '2', product_id: 'SKU-A' }),
    ])).toEqual([{ productId: 'SKU-A', waiting: 1 }])
  })

  it('is empty when nobody is waiting', () => {
    expect(demandByProduct([])).toEqual([])
    expect(demandByProduct([watch({ id: '1', notified_at: '2026-07-21' })])).toEqual([])
  })
})

describe('the caveat', () => {
  it('matches the promise the basket makes about saved items', () => {
    expect(WATCH_CAVEAT).toMatch(/reserves stock/i)
    expect(WATCH_CAVEAT).toMatch(/holds a price/i)
  })
})

describe('openWatchFor / isOpen', () => {
  it('finds only the open one', () => {
    const list = [watch({ id: 'closed', notified_at: '2026-07-21' }), watch({ id: 'open' })]
    expect(openWatchFor(list, 'SKU-4008')?.id).toBe('open')
    expect(isOpen(list[0])).toBe(false)
    expect(isOpen(list[1])).toBe(true)
  })

  it('returns nothing for a product with no watch', () => {
    expect(openWatchFor([watch({ id: 'a' })], 'SKU-9999')).toBeUndefined()
  })
})
