import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  bundleIdsOf, priceCartBundles, bundleBlock, bundleBasketLines, addBundleToBasket,
  removeBundleFromBasket, holdsBundle, heldCurrencyNote, bundleColumns, partOnSale,
  basketBundleBlocks, requisitionBundleBlock, requisitionBillingBlock, billingOf, heldBilling, type BundleInfo,
  bundlePriceUntil, bundleSubscriptionColumns, bundleRenewalNote, businessRenewalNote,
} from './bundleLines'
import {
  addToBasket, setQuantity, removeLine, repriceTo, EMPTY_BASKET, quoteHoldsCurrency,
  type Basket, type BasketLine,
} from './requisitionBasket'

const info = (over: Partial<BundleInfo['selection']> = {}): BundleInfo => ({
  name: 'Smart office starter kit',
  selection: {
    id: 'BS-1', template_id: 'BT-1', currency: 'INR', quantity: 1, total: 900, parts_total: 1000,
    priced_at: '2026-11-01T00:00:00Z', valid_until: '2026-11-08T00:00:00Z', choices: { s1: [{ product_id: 'A', quantity: 1 }] },
    ...over,
  },
  lines: [
    { id: 'L1', selection_id: 'BS-1', product_id: 'A', name: 'Sensor', partner_id: 'P1', seller: 'Nimbus', quantity: 2, list_unit_price: 300, unit_price: 270, floor_unit_price: null, sort_order: 1 },
    { id: 'L2', selection_id: 'BS-1', product_id: 'B', name: 'Gateway', partner_id: 'P2', seller: 'Volta', quantity: 1, list_unit_price: 400, unit_price: 360, floor_unit_price: 350, sort_order: 2 },
  ],
})

const facts = new Map([
  ['A', { id: 'A', seller: 'Nimbus', model: 'oneoff', category_id: 'iot', unit: null }],
  ['B', { id: 'B', seller: 'Volta', model: 'oneoff', category_id: 'iot', unit: null }],
])

const plain = (over: Partial<BasketLine> = {}): Omit<BasketLine, 'quantity'> => ({
  product_id: 'A', name: 'Sensor', seller: 'Nimbus', partner_id: 'P1', unit_price: 300,
  model: 'oneoff', vertical: 'iot', unit: null, ...over,
})

describe('cart lines', () => {
  it('collects distinct selection ids in order and ignores ordinary lines', () => {
    expect(bundleIdsOf([{}, { bundle_selection_id: 'X' }, { bundle_selection_id: null }, { bundle_selection_id: 'Y' }, { bundle_selection_id: 'X' }])).toEqual(['X', 'Y'])
  })

  it('prices bundle parts from the selection and leaves ordinary lines exactly as they were', () => {
    const ordinary = { id: 'c0', product_id: 'A', product: { price: 300 } }
    const lines = [ordinary, { id: 'c1', product_id: 'A', bundle_selection_id: 'BS-1', product: { price: 300 } }]
    const out = priceCartBundles(lines, new Map([['BS-1', info()]]))
    expect(out[0]).toBe(ordinary)
    expect(out[1].product?.price).toBe(270)
    expect(out[1].bundle_unit_price).toBe(270)
  })

  it('never falls back to the shelf price when the selection did not load', () => {
    const out = priceCartBundles([{ product_id: 'A', bundle_selection_id: 'BS-9', product: { price: 300 } }], new Map())
    expect(out[0].bundle_unit_price).toBeNull()
    expect(out[0].product?.price).toBe(0)
    expect(bundleBlock(out[0].bundle, 'INR', '2026-11-05T12:00:00Z', () => true).kind).toBe('unloaded')
  })
})

describe('what stops a bundle being bought', () => {
  it('is fine inside its seven days with every part on sale', () => {
    expect(bundleBlock(info(), 'INR', '2026-11-07T23:59:00Z', () => true)).toEqual({ kind: 'ok' })
  })
  it('asks for a re-price once the hold has passed', () => {
    expect(bundleBlock(info(), 'INR', '2026-11-08T00:00:01Z', () => true).kind).toBe('expired')
  })
  it('names the part that is no longer on sale', () => {
    const b = bundleBlock(info(), 'INR', '2026-11-05T12:00:00Z', id => id !== 'B')
    expect(b.kind).toBe('part-unavailable')
    if (b.kind === 'part-unavailable') expect(b.says).toContain('Gateway')
  })
  it('refuses a bundle priced in another currency', () => {
    expect(bundleBlock(info(), 'AED', '2026-11-05T12:00:00Z', () => true).kind).toBe('currency')
  })
  it('reads availability from the basket line products', () => {
    expect(partOnSale({ status: 'live', stock: 'in' })).toBe(true)
    expect(partOnSale({ status: 'paused', stock: 'in' })).toBe(false)
    expect(partOnSale({ status: 'live', stock: 'out' })).toBe(false)
    expect(partOnSale(null)).toBe(false)
    const i = info()
    const lines = [
      { product_id: 'A', bundle_selection_id: 'BS-1', bundle: i, product: { status: 'live', stock: 'in' } },
      { product_id: 'B', bundle_selection_id: 'BS-1', bundle: i, product: { status: 'live', stock: 'out' } },
      { product_id: 'C', product: { status: 'paused', stock: 'out' } },
    ]
    const blocks = basketBundleBlocks(lines, 'INR', '2026-11-05T12:00:00Z')
    expect(blocks).toHaveLength(1)
    expect(blocks[0].block.kind).toBe('part-unavailable')
    expect(basketBundleBlocks([lines[2]], 'INR', '2026-11-05T12:00:00Z')).toEqual([])
  })
})

describe('a bundle on a requisition', () => {
  const parts = () => bundleBasketLines(info(), facts).lines

  it('carries the selection id and its fixed unit prices', () => {
    const { lines, unread } = bundleBasketLines(info(), facts)
    expect(unread).toEqual([])
    expect(lines.map(l => [l.product_id, l.quantity, l.unit_price, l.bundle_selection_id])).toEqual([
      ['A', 2, 270, 'BS-1'], ['B', 1, 360, 'BS-1'],
    ])
    expect(lines[0].bundle?.templateId).toBe('BT-1')
  })

  it('names a part whose product could not be read', () => {
    expect(bundleBasketLines(info(), new Map([['A', facts.get('A')!]])).unread).toEqual(['Gateway'])
  })

  it('goes in whole, beside an ordinary line of the same product, without merging', () => {
    const one = addToBasket(EMPTY_BASKET, plain(), 'INR', 3)
    if (!one.ok) throw new Error(one.reason)
    const r = addBundleToBasket(one.basket, parts(), 'INR')
    if (!r.ok) throw new Error(r.reason)
    expect(r.basket.lines).toHaveLength(3)
    expect(holdsBundle(r.basket)).toBe(true)
    /* An ordinary add of A increments the ordinary line only. */
    const more = addToBasket(r.basket, plain(), 'INR', 1)
    if (!more.ok) throw new Error(more.reason)
    expect(more.basket.lines.filter(l => l.product_id === 'A').map(l => l.quantity).sort()).toEqual([2, 4])
  })

  it('is not moved by the ordinary quantity, remove or reprice operations', () => {
    const r = addBundleToBasket(EMPTY_BASKET, parts(), 'INR')
    if (!r.ok) throw new Error(r.reason)
    const q = setQuantity(r.basket, 'A', 9)
    if (!q.ok) throw new Error(q.reason)
    expect(q.basket.lines.find(l => l.product_id === 'A')!.quantity).toBe(2)
    const rm = removeLine(r.basket, 'A')
    if (!rm.ok) throw new Error('remove refused')
    expect(rm.basket.lines).toHaveLength(2)
    const rp = repriceTo(r.basket, 'AED', [{ id: 'A', price: 1, model: 'oneoff', unit: null }])
    expect(rp.basket).toBe(r.basket)
    expect(rp.dropped).toEqual([])
  })

  it('refuses another currency, a duplicate and a mixed commitment', () => {
    const inr = addToBasket(EMPTY_BASKET, plain({ product_id: 'Z' }), 'INR')
    if (!inr.ok) throw new Error(inr.reason)
    expect(addBundleToBasket(inr.basket, parts(), 'AED').ok).toBe(false)
    const r = addBundleToBasket(EMPTY_BASKET, parts(), 'INR')
    if (!r.ok) throw new Error(r.reason)
    expect(addBundleToBasket(r.basket, parts(), 'INR').ok).toBe(false)
    const monthly = addToBasket(EMPTY_BASKET, plain({ product_id: 'M', model: 'monthly' }), 'INR')
    if (!monthly.ok) throw new Error(monthly.reason)
    expect(addBundleToBasket(monthly.basket, parts(), 'INR').ok).toBe(false)
  })

  it('replaces the old group in place, and may change currency when nothing else is held', () => {
    const r = addBundleToBasket(EMPTY_BASKET, parts(), 'INR')
    if (!r.ok) throw new Error(r.reason)
    const withPlain = addToBasket(r.basket, plain({ product_id: 'Z' }), 'INR')
    if (!withPlain.ok) throw new Error(withPlain.reason)
    const fresh = bundleBasketLines(info({ id: 'BS-2', quantity: 2 }), facts).lines
    const swapped = addBundleToBasket(withPlain.basket, fresh, 'INR', 'BS-1')
    if (!swapped.ok) throw new Error(swapped.reason)
    expect(swapped.basket.lines.map(l => l.bundle_selection_id ?? l.product_id)).toEqual(['BS-2', 'BS-2', 'Z'])
    const alone = addBundleToBasket(r.basket, bundleBasketLines(info({ id: 'BS-3', currency: 'AED' }), facts).lines, 'AED', 'BS-1')
    expect(alone.ok).toBe(true)
  })

  it('removes the whole group, and an empty basket forgets its currency', () => {
    const r = addBundleToBasket(EMPTY_BASKET, parts(), 'INR')
    if (!r.ok) throw new Error(r.reason)
    expect(removeBundleFromBasket(r.basket, 'BS-1')).toEqual(EMPTY_BASKET)
  })

  it('says why the basket keeps its currency, in the quote wording when only quotes are held', () => {
    const quoted: Basket = { currency: 'INR', lines: [{ ...plain(), quantity: 1, quote_line_id: 'Q1' }] }
    expect(heldCurrencyNote(quoted, 'AED')).toBe(quoteHoldsCurrency('INR', 'AED'))
    expect(heldCurrencyNote({ currency: 'INR', lines: [{ ...plain(), quantity: 1 }] }, 'AED')).toBeNull()
    const r = addBundleToBasket(EMPTY_BASKET, parts(), 'INR')
    if (!r.ok) throw new Error(r.reason)
    expect(heldCurrencyNote(r.basket, 'AED')).toContain('a configured bundle')
  })

  it('writes the selection column only on bundle parts', () => {
    expect(bundleColumns({})).toEqual({})
    expect(bundleColumns({ bundle_selection_id: null })).toEqual({})
    expect(bundleColumns({ bundle_selection_id: 'BS-1' })).toEqual({ bundle_selection_id: 'BS-1' })
  })

  it('judges a requisition bundle by the instant its hold ends', () => {
    const meta = bundleBasketLines(info(), facts).lines[0].bundle
    expect(requisitionBundleBlock(meta, [], 'INR', '2026-11-07T23:00:00Z')).toEqual({ kind: 'ok' })
    expect(requisitionBundleBlock(meta, [], 'INR', '2026-11-08T00:00:01Z').kind).toBe('expired')
    expect(requisitionBundleBlock(meta, [], 'AED', '2026-11-07T23:00:00Z').kind).toBe('currency')
    expect(requisitionBundleBlock(undefined, [], 'INR', '2026-11-09T00:00:00Z')).toEqual({ kind: 'ok' })
  })

  it('is pure', () => {
    expect(readFileSync(new URL('./bundleLines.ts', import.meta.url), 'utf8')).not.toMatch(/from ['"].*supabase['"]/)
  })
})

describe('a business bundle is billed one way', () => {
  const models = new Map([['A', 'oneoff'], ['B', 'oneoff'], ['M', 'monthly'], ['U', 'usage']])
  const names = new Map([['A', 'Sensor'], ['B', 'Gateway'], ['M', 'IoT Connect 2 GB']])
  const modelOf = (id: string) => models.get(id)
  const nameOf = (id: string) => names.get(id) ?? id

  it('reads a product model the way a requisition line takes it', () => {
    expect(billingOf('monthly')).toBe('monthly')
    expect(billingOf('oneoff')).toBe('oneoff')
    expect(billingOf('usage')).toBe('oneoff')
    expect(billingOf(undefined)).toBe('oneoff')
  })

  it('lets parts of one model through, and says so before anything is written when they mix', () => {
    expect(requisitionBillingBlock('Kit', [{ product_id: 'A' }, { product_id: 'B' }], modelOf, nameOf)).toBeNull()
    expect(requisitionBillingBlock('Kit', [{ product_id: 'A' }, { product_id: 'U' }], modelOf, nameOf)).toBeNull()
    const says = requisitionBillingBlock('Kit', [{ product_id: 'A' }, { product_id: 'M' }], modelOf, nameOf)
    expect(says).toMatch(/^Kit mixes one-off and monthly parts/)
    expect(says).toContain('IoT Connect 2 GB (monthly)')
    expect(says).toContain('Sensor (one-off)')
  })

  it('leaves a part whose model did not load to the basket, and is silent on nothing picked', () => {
    expect(requisitionBillingBlock('Kit', [{ product_id: 'A' }, { product_id: 'Z' }], modelOf, nameOf)).toBeNull()
    expect(requisitionBillingBlock('Kit', [], modelOf, nameOf)).toBeNull()
  })

  it('names a requisition committed the other way, and lets the same way through', () => {
    const one = [{ product_id: 'A' }, { product_id: 'B' }]
    expect(requisitionBillingBlock('Kit', one, modelOf, nameOf, 'oneoff')).toBeNull()
    expect(requisitionBillingBlock('Kit', one, modelOf, nameOf, null)).toBeNull()
    expect(requisitionBillingBlock('Kit', one, modelOf, nameOf, 'monthly')).toMatch(/^This requisition is a monthly subscription and Kit is not\./)
    expect(requisitionBillingBlock('Kit', [{ product_id: 'M' }], modelOf, nameOf, 'oneoff')).toMatch(/^This requisition is a one-off purchase/)
    // the parts' own mix is said first
    expect(requisitionBillingBlock('Kit', [{ product_id: 'A' }, { product_id: 'M' }], modelOf, nameOf, 'oneoff')).toMatch(/^Kit mixes/)
  })

  it('reads the commitment the basket holds, leaving out the bundle being replaced', () => {
    expect(heldBilling(EMPTY_BASKET)).toBeNull()
    const monthly = addToBasket(EMPTY_BASKET, plain({ product_id: 'M', model: 'monthly' }), 'INR')
    if (!monthly.ok) throw new Error(monthly.reason)
    expect(heldBilling(monthly.basket)).toBe('monthly')
    const r = addBundleToBasket(EMPTY_BASKET, bundleBasketLines(info(), facts).lines, 'INR')
    if (!r.ok) throw new Error(r.reason)
    expect(heldBilling(r.basket)).toBe('oneoff')
    expect(heldBilling(r.basket, 'BS-1')).toBeNull()
  })

  it('agrees with the basket on a bundle billed the other way from the requisition', () => {
    const monthly = addToBasket(EMPTY_BASKET, plain({ product_id: 'M', model: 'monthly' }), 'INR')
    if (!monthly.ok) throw new Error(monthly.reason)
    const lines = bundleBasketLines(info(), facts).lines
    const refused = addBundleToBasket(monthly.basket, lines, 'INR')
    expect(refused.ok).toBe(false)
    const m = new Map(lines.map(l => [l.product_id, l.model]))
    const says = requisitionBillingBlock('Smart office starter kit', lines, id => m.get(id), nameOf, heldBilling(monthly.basket))
    expect(says).not.toBeNull()
    if (!refused.ok) expect(says!.startsWith(refused.reason)).toBe(true)
  })

  it('refuses exactly what the requisition basket refuses', () => {
    const mixed = bundleBasketLines(info(), new Map([...facts, ['B', { ...facts.get('B')!, model: 'monthly' }]]))
    expect(addBundleToBasket(EMPTY_BASKET, mixed.lines, 'INR').ok).toBe(false)
    const m = new Map(mixed.lines.map(l => [l.product_id, l.model]))
    expect(requisitionBillingBlock('Kit', mixed.lines, id => m.get(id), nameOf)).not.toBeNull()
    const same = bundleBasketLines(info(), facts)
    expect(addBundleToBasket(EMPTY_BASKET, same.lines, 'INR').ok).toBe(true)
    const m2 = new Map(same.lines.map(l => [l.product_id, l.model]))
    expect(requisitionBillingBlock('Kit', same.lines, id => m2.get(id), nameOf)).toBeNull()
  })
})

describe('a monthly bundle part renews at the bundle price for 12 months', () => {
  const fmt = (n: number) => `₹${n.toFixed(2)}`

  it('stops the bundle price on the same day a year on, clamped into a short month', () => {
    expect(bundlePriceUntil('2026-11-13')).toBe('2027-11-13')
    expect(bundlePriceUntil('2028-02-29')).toBe('2029-02-28')
    expect(bundlePriceUntil('2026-11-13T09:30:00Z')).toBe('2027-11-13')
  })

  it("writes the bundle columns only on a bundle part's subscription", () => {
    expect(bundleSubscriptionColumns({ bundle_selection_id: 'BS-1' }, '2026-11-13'))
      .toEqual({ bundle_selection_id: 'BS-1', bundle_price_until: '2027-11-13' })
    expect(bundleSubscriptionColumns({ bundle_selection_id: null }, '2026-11-13')).toEqual({})
    expect(bundleSubscriptionColumns({}, '2026-11-13')).toEqual({})
  })

  it('tells the buyer what a monthly part renews at afterwards', () => {
    expect(bundleRenewalNote('monthly', 499, fmt)).toBe('Bundle price for 12 months, then ₹499.00/month')
    expect(bundleRenewalNote('oneoff', 499, fmt)).toBeNull()
    expect(bundleRenewalNote(undefined, 499, fmt)).toBeNull()
    /* No published price in that currency: nothing is promised. */
    expect(bundleRenewalNote('monthly', null, fmt)).toBeNull()
  })
})

describe('businessRenewalNote', () => {
  it("says a business account's monthly part renews under its agreement, and nothing for a one-off part", () => {
    expect(businessRenewalNote('monthly')).toBe('Billed monthly; renews under your account’s agreement')
    expect(businessRenewalNote('oneoff')).toBeNull()
    expect(businessRenewalNote(null)).toBeNull()
  })
})
