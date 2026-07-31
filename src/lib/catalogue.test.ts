import { describe, it, expect } from 'vitest'
import {
  canApprove, canReject, summarise, bundleView, checkBundlePrice, canAddToBasket,
  rulesFor, applyPolicy, policyFailures, splitOf,
  type ProductRow, type Submission, type ProductRule, type Component, type Media,
  type CategoryPolicy, type PolicyRuleRow,
} from './catalogue'

const product = (o: Partial<ProductRow> & { id: string; name: string }): ProductRow => ({
  category_id: 'device', sub_category: 'Phones', partner_id: 'PTR-1002', seller: 'Kestrel Devices',
  price: 749, was_price: null, cost: 520, model: 'oneoff', fulfil: 'shipped',
  floor_price: 620, list_price: 799, price_includes_tax: true, tax_rate: 18,
  rating: 4.4, reviews: 100, stock: 'in', status: 'live', listed: '02 Mar 2024',
  description: '', tags: [], comm: 9, badge: null, specs: {}, sort_order: 1, ...o,
})

const sub = (o: Partial<Submission> & { id: string }): Submission => ({
  product_id: 'SKU-4001', partner_id: 'PTR-1002', status: 'pending', risk: 'low',
  check_note: 'Standard hardware listing', issue: null, decision_reason: null,
  submitted_by: 'Anil Mehra', submitted_at: '2026-07-24', reviewed_by: null, reviewed_at: null,
  version: 1, sort_order: 1, ...o,
})

const rule = (o: Partial<ProductRule> & { id: string; product_id: string; kind: ProductRule['kind']; targets: string[] }): ProductRule =>
  ({ why: 'because', sort_order: 1, ...o })

const TODAY = new Date('2026-07-30T00:00:00Z')

describe('canApprove', () => {
  it('allows a routine listing', () => {
    expect(canApprove(sub({ id: 'a' })).ok).toBe(true)
  })

  /* A medium risk is a question, not a breach. Somebody can satisfy themselves
     and say so. */
  it('allows a flagged listing a reviewer can satisfy themselves about', () => {
    expect(canApprove(sub({ id: 'a', risk: 'medium', issue: 'Cost above price' })).ok).toBe(true)
  })

  /* No override exists, the same discipline the technical onboarding gate
     follows: approving a stated breach exposes the marketplace. */
  it('refuses a stated policy breach and repeats what it is', () => {
    const v = canApprove(sub({ id: 'a', risk: 'high', issue: 'Randomised paid rewards' }))
    expect(v.ok).toBe(false)
    if (!v.ok) {
      expect(v.reason).toMatch(/Randomised paid rewards/)
      expect(v.reason).toMatch(/exposes the marketplace/)
    }
  })

  it('refuses a second decision on something already decided', () => {
    const v = canApprove(sub({ id: 'a', status: 'approved' }))
    expect(v.ok).toBe(false)
    if (!v.ok) expect(v.reason).toMatch(/already approved/)
  })
})

describe('canReject', () => {
  it('requires a ground the seller can act on', () => {
    const v = canReject(sub({ id: 'a' }), 'no')
    expect(v.ok).toBe(false)
    if (!v.ok) expect(v.reason).toMatch(/name what is missing/i)
  })

  it('accepts a stated reason', () => {
    expect(canReject(sub({ id: 'a' }), 'Type approval is missing for UAE and Kenya.').ok).toBe(true)
  })
})

describe('summarise', () => {
  const subs = [
    sub({ id: '1', risk: 'low', submitted_at: '2026-07-28' }),
    sub({ id: '2', risk: 'medium', submitted_at: '2026-07-24' }),
    sub({ id: '3', risk: 'high', submitted_at: '2026-07-21' }),
    sub({ id: '4', status: 'approved' }),
    sub({ id: '5', status: 'approved' }),
    sub({ id: '6', status: 'rejected' }),
  ]
  const products = [
    product({ id: 'a', name: 'a', status: 'live' }),
    product({ id: 'b', name: 'b', status: 'live' }),
    product({ id: 'c', name: 'c', status: 'suspended' }),
  ]

  it('counts what is waiting, flagged and blocked', () => {
    expect(summarise(subs, products, TODAY)).toMatchObject({ waiting: 3, flagged: 2, blocked: 1 })
  })

  it('counts the catalogue behind the queue', () => {
    expect(summarise(subs, products, TODAY)).toMatchObject({ live: 2, suspended: 1, rejected: 1 })
  })

  it('reports the median age of what is waiting, not the mean', () => {
    expect(summarise(subs, products, TODAY).medianAgeDays).toBe(6)
  })

  it('reports the approval rate over decided submissions only', () => {
    expect(summarise(subs, products, TODAY).approvalRate).toBe(67)
  })

  /* Nothing decided and nothing approved are different answers, and a screen
     that shows 0% for the first is lying about the second. */
  it('reports no rate rather than zero before anything is decided', () => {
    expect(summarise([sub({ id: '1' })], products, TODAY).approvalRate).toBeNull()
  })

  it('reports no median rather than zero with an empty queue', () => {
    expect(summarise([sub({ id: '4', status: 'approved' })], products, TODAY).medianAgeDays).toBeNull()
  })
})

describe('bundleView', () => {
  const duo = product({ id: 'SKU-2006', name: 'Duo', price: 34, category_id: 'consumer', partner_id: null, cost: 0 })
  const plan = product({ id: 'SKU-2002', name: 'Unlimited', price: 27, partner_id: null, cost: 0 })
  const tv = product({ id: 'SKU-3001', name: 'StreamNova Premium', price: 12.99, partner_id: 'PTR-1001', cost: 0 })
  const comps: Component[] = [
    { bundle_id: 'SKU-2006', component_id: 'SKU-2002', quantity: 1, note: 'The line', sort_order: 1 },
    { bundle_id: 'SKU-2006', component_id: 'SKU-3001', quantity: 1, note: 'The telly', sort_order: 2 },
  ]

  it('computes the saving from the parts rather than a stated percentage', () => {
    const v = bundleView(duo, comps, [plan, tv])!
    expect(v.partsTotal).toBe(39.99)
    expect(v.saving).toBe(5.99)
    expect(v.savingPct).toBe(15)
  })

  it('multiplies by quantity', () => {
    const pack = product({ id: 'B', name: 'Pack', price: 2295 })
    const sensor = product({ id: 'S', name: 'Sensor', price: 84 })
    const v = bundleView(pack, [{ bundle_id: 'B', component_id: 'S', quantity: 25, note: null, sort_order: 1 }], [sensor])!
    expect(v.partsTotal).toBe(2100)
  })

  it('is null for a product with no components rather than an empty bundle', () => {
    expect(bundleView(plan, comps, [plan, tv])).toBeNull()
  })

  /* A bundle cannot be delivered if one of its parts is not on sale, and the
     operator has to know which one. */
  it('names a component that is not on sale', () => {
    const v = bundleView(duo, comps, [plan, { ...tv, status: 'suspended' }])!
    expect(v.unavailable.map(p => p.id)).toEqual(['SKU-3001'])
  })

  it('skips a component that no longer exists rather than counting it as free', () => {
    const v = bundleView(duo, comps, [plan])!
    expect(v.parts).toHaveLength(1)
    expect(v.partsTotal).toBe(27)
  })
})

describe('checkBundlePrice', () => {
  it('accepts a bundle cheaper than its parts', () => {
    expect(checkBundlePrice(34, 39.99).ok).toBe(true)
  })

  it('refuses one priced at or above its parts', () => {
    const v = checkBundlePrice(45, 39.99)
    expect(v.ok).toBe(false)
    if (!v.ok) expect(v.reason).toMatch(/worse deal with a badge/)
  })

  it('refuses a bundle equal to its parts, which saves nothing', () => {
    expect(checkBundlePrice(39.99, 39.99).ok).toBe(false)
  })

  it('refuses a bundle with no components', () => {
    expect(checkBundlePrice(10, 0).ok).toBe(false)
  })
})

describe('canAddToBasket', () => {
  const name = (id: string) => ({ 'SKU-3001': 'StreamNova Premium', 'SKU-3002': 'StreamNova Standard', 'SKU-3003': 'PlayForge Cloud Gaming', 'SKU-4004': 'Volta Mesh' }[id] ?? id)
  const rules: ProductRule[] = [
    rule({ id: 'r1', product_id: 'SKU-3001', kind: 'excludes', targets: ['SKU-3002'], why: 'One tier per household.' }),
    rule({ id: 'r2', product_id: 'SKU-3004', kind: 'requires', targets: ['SKU-3003'], why: 'The pass unlocks content inside the subscription.' }),
    rule({ id: 'r3', product_id: 'SKU-3004', kind: 'works_with', targets: ['SKU-4004'], why: 'A weak signal spoils cloud gaming.' }),
  ]

  it('allows something with nothing in its way', () => {
    const v = canAddToBasket('SKU-3001', [], rules, name)
    expect(v.ok).toBe(true)
  })

  it('blocks an exclusion and names what is in the way', () => {
    const v = canAddToBasket('SKU-3001', ['SKU-3002'], rules, name)
    expect(v.ok).toBe(false)
    if (!v.ok) {
      expect(v.kind).toBe('excludes')
      expect(v.reason).toMatch(/StreamNova Standard/)
      expect(v.reason).toMatch(/One tier per household/)
    }
  })

  /* The exclusion runs both ways: adding Standard when Premium is held must be
     blocked too, and only one of the two rules is written down. */
  it('blocks the reverse direction of an exclusion the other product declares', () => {
    const v = canAddToBasket('SKU-3002', ['SKU-3001'], rules, name)
    expect(v.ok).toBe(false)
    if (!v.ok) expect(v.reason).toMatch(/StreamNova Premium/)
  })

  it('blocks a requirement nothing held satisfies, and says what to add', () => {
    const v = canAddToBasket('SKU-3004', [], rules, name)
    expect(v.ok).toBe(false)
    if (!v.ok) {
      expect(v.kind).toBe('requires')
      expect(v.reason).toMatch(/Add PlayForge Cloud Gaming first/)
    }
  })

  it('allows it once any one of the required products is held', () => {
    expect(canAddToBasket('SKU-3004', ['SKU-3003'], rules, name).ok).toBe(true)
  })

  /* A suggestion that blocks an order is a bug wearing a hint. */
  it('never blocks on advice, and returns it instead', () => {
    const v = canAddToBasket('SKU-3004', ['SKU-3003'], rules, name)
    expect(v.ok).toBe(true)
    if (v.ok) expect(v.suggestions.map(s => s.product)).toEqual(['SKU-4004'])
  })

  it('does not suggest something already held', () => {
    const v = canAddToBasket('SKU-3004', ['SKU-3003', 'SKU-4004'], rules, name)
    expect(v.ok).toBe(true)
    if (v.ok) expect(v.suggestions).toEqual([])
  })
})

describe('rulesFor', () => {
  it('separates what blocks from what advises', () => {
    const rules: ProductRule[] = [
      rule({ id: 'a', product_id: 'X', kind: 'requires', targets: ['Y'] }),
      rule({ id: 'b', product_id: 'X', kind: 'excludes', targets: ['Z'] }),
      rule({ id: 'c', product_id: 'X', kind: 'works_with', targets: ['W'] }),
      rule({ id: 'd', product_id: 'OTHER', kind: 'excludes', targets: ['Q'] }),
    ]
    const r = rulesFor('X', rules)
    expect(r.blocking).toBe(2)
    expect(r.worksWith).toHaveLength(1)
  })
})

describe('applyPolicy', () => {
  const policy: CategoryPolicy = {
    category_id: 'device', review: 'Automated with spot check', auto_publish: true,
    returns_window: '14 days', sla_hours: 48, price_floor: true,
    rating_required: false, min_rating: 3, max_listings_per_seller: 400,
  }
  const rules: PolicyRuleRow[] = [
    { id: 'PR-03', name: 'Price floor', descr: '', check_by: 'auto', basis: 'Commercial', owner: 'Commercial', evidence: null, blocks: true, status: 'active', locked: null, sort_order: 3 },
    { id: 'PR-04', name: 'Type approval', descr: '', check_by: 'doc', basis: 'Regulatory', owner: 'Compliance', evidence: 'Certificate', blocks: true, status: 'active', locked: null, sort_order: 4 },
    { id: 'PR-08', name: 'Returns window', descr: '', check_by: 'auto', basis: 'Regulatory', owner: 'Legal', evidence: null, blocks: true, status: 'active', locked: null, sort_order: 8 },
    { id: 'PR-11', name: 'Accessibility statement', descr: '', check_by: 'doc', basis: 'Commercial', owner: 'Product', evidence: 'VPAT', blocks: false, status: 'draft', locked: null, sort_order: 11 },
  ]
  const matrix = [
    { category_id: 'device', rule_id: 'PR-03', level: 'enforce' },
    { category_id: 'device', rule_id: 'PR-04', level: 'enforce' },
    { category_id: 'device', rule_id: 'PR-08', level: 'enforce' },
    { category_id: 'device', rule_id: 'PR-11', level: 'warn' },
    { category_id: 'content', rule_id: 'PR-03', level: 'enforce' },
    { category_id: 'device', rule_id: 'PR-99', level: 'enforce' },
  ]
  const media: Media[] = [
    { id: 'm1', product_id: 'SKU-4001', url: 'x', role: 'hero', alt: 'a phone', sort_order: 1 },
    { id: 'm2', product_id: 'SKU-4001', url: 'y', role: 'gallery', alt: null, sort_order: 2 },
  ]

  it('applies only the rules its own category turns on', () => {
    const applied = applyPolicy(product({ id: 'SKU-4001', name: 'K9' }), policy, rules, matrix, media)
    expect(applied.map(a => a.rule.id)).toEqual(['PR-03', 'PR-04', 'PR-08', 'PR-11'])
  })

  it('ignores a matrix row naming a rule that does not exist', () => {
    const applied = applyPolicy(product({ id: 'SKU-4001', name: 'K9' }), policy, rules, matrix, media)
    expect(applied.map(a => a.rule.id)).not.toContain('PR-99')
  })

  it('passes a price above the floor', () => {
    const applied = applyPolicy(product({ id: 'SKU-4001', name: 'K9', price: 749, cost: 520 }), policy, rules, matrix, media)
    expect(applied.find(a => a.rule.id === 'PR-03')!.automatic).toMatchObject({ pass: true })
  })

  /* The Beacon listing: priced below what it costs. */
  it('fails a price below the floor and says by how much', () => {
    const applied = applyPolicy(product({ id: 'SKU-4001', name: 'x', price: 11.8, cost: 13 }), policy, rules, matrix, media)
    const floor = applied.find(a => a.rule.id === 'PR-03')!.automatic!
    expect(floor.pass).toBe(false)
    expect(floor.detail).toMatch(/\$1\.20 below/)
  })

  it('does not judge a price with no cost recorded', () => {
    const applied = applyPolicy(product({ id: 'SKU-4001', name: 'x', price: 10, cost: 0 }), policy, rules, matrix, media)
    const floor = applied.find(a => a.rule.id === 'PR-03')!.automatic!
    expect(floor.pass).toBe(true)
    expect(floor.detail).toMatch(/no floor to check/)
  })

  /* A digital product is not exempt by luck — the returns rule does not apply
     to it, and saying so is different from saying it passed. */
  it('says a returns window does not apply to something that is not shipped', () => {
    const applied = applyPolicy(product({ id: 'SKU-3001', name: 'x', fulfil: 'instant' }), policy, rules, matrix, media)
    expect(applied.find(a => a.rule.id === 'PR-08')!.automatic!.detail).toMatch(/no statutory returns window/)
  })

  /* Nothing here reads a certificate, so nothing here claims one is valid. */
  it('leaves a document rule for the person who has to check it', () => {
    const applied = applyPolicy(product({ id: 'SKU-4001', name: 'x' }), policy, rules, matrix, media)
    expect(applied.find(a => a.rule.id === 'PR-04')!.automatic).toBeNull()
  })

  it('counts images with no alt text', () => {
    const applied = applyPolicy(product({ id: 'SKU-4001', name: 'x' }), policy, rules, matrix, media)
    const a11y = applied.find(a => a.rule.id === 'PR-11')!.automatic!
    expect(a11y.pass).toBe(false)
    expect(a11y.detail).toMatch(/1 of 2 images/)
  })
})

describe('policyFailures', () => {
  it('reports only enforced failures, not warnings', () => {
    const mk = (id: string, level: 'warn' | 'enforce', pass: boolean) => ({
      rule: { id, name: id, descr: '', check_by: 'auto' as const, basis: '', owner: '', evidence: null, blocks: true, status: 'active', locked: null, sort_order: 1 },
      level, automatic: { pass, detail: '' },
    })
    expect(policyFailures([mk('a', 'enforce', false), mk('b', 'warn', false), mk('c', 'enforce', true)]).map(f => f.rule.id))
      .toEqual(['a'])
  })
})

describe('splitOf', () => {
  it('takes commission and fees on a partner listing', () => {
    const s = splitOf(product({ id: 'x', name: 'x', price: 100, comm: 9 }), 9)
    expect(s).toMatchObject({ gross: 100, commission: 9, fees: 2.1, net: 88.9, firstParty: false })
  })

  it('uses the plan rate over the per-listing number when one is given', () => {
    expect(splitOf(product({ id: 'x', name: 'x', price: 100, comm: 9 }), 11).commission).toBe(11)
  })

  /* There is nobody to pay a commission to on the operator's own stock. */
  it('takes nothing on a first-party listing', () => {
    const s = splitOf(product({ id: 'x', name: 'x', price: 100, partner_id: null }), null)
    expect(s).toMatchObject({ commission: 0, fees: 0, net: 100, firstParty: true })
  })
})
