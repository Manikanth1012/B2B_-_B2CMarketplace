import { describe, it, expect } from 'vitest'
import {
  compose, compositionProblem, compositionWarnings, maxComponentDiscount,
  packModel, guessFulfil, priceBasis, sellableHere, withheldNote,
} from './federation'
import type { TelcoItem, BundleRule, ComponentPick } from './federation'

/* The real rate card, so the numbers here are the numbers the demo shows. */
const item = (over: Partial<TelcoItem> & Pick<TelcoItem, 'id'>): TelcoItem => ({
  name: over.id, family: 'Mobile postpaid', kind: 'Plan',
  rc: 0, nrc: 0, unit: 'per line/mo', spec: '', cost_rc: 0, cost_nrc: 0, ...over,
})

const MOB050 = item({ id: 'TP-MOB-050', name: 'Freedom 50 GB', rc: 22, cost_rc: 12.76 })
const MOBUNL = item({ id: 'TP-MOB-UNL', name: 'Freedom Unlimited', rc: 39, cost_rc: 22.62 })
const VASSEC = item({ id: 'TP-VAS-SEC', name: 'Mobile security', family: 'Value added', kind: 'Service', rc: 2.5, cost_rc: 0.95 })
const VASCLD = item({ id: 'TP-VAS-CLD', name: 'Cloud backup 200 GB', family: 'Value added', kind: 'Service', rc: 4.5, cost_rc: 1.71 })
const VASINS = item({ id: 'TP-VAS-INS', name: 'Device protection', family: 'Value added', kind: 'Service', rc: 6, cost_rc: 2.28 })
const ADDROM = item({ id: 'TP-ADD-ROM', name: 'Roaming day pass', family: 'Add-on', kind: 'Add-on', nrc: 5, cost_nrc: 2.25 })
const ADDDAT = item({ id: 'TP-ADD-DAT', name: 'Data top-up 10 GB', family: 'Add-on', kind: 'Add-on', nrc: 7, cost_nrc: 3.15 })
const EQPRTR = item({ id: 'TP-EQP-RTR', name: 'Wi-Fi 6 mesh router', family: 'Equipment', kind: 'Hardware', nrc: 79, cost_nrc: 63.2 })
/* Withheld from this channel, and still on the rate card — the BSS sells fibre
   every day. Kept in ITEMS on purpose: the composer has to meet it and refuse
   it, which it cannot do if the fixture quietly drops it. */
const FBB300 = item({
  id: 'TP-FBB-300', name: 'Fibre 300 Mbps', family: 'Fixed broadband',
  rc: 26, nrc: 35, cost_rc: 15.08, cost_nrc: 20.3,
  marketplace: false, sold_through: 'Aventa field sales and CRM',
  withheld_reason: 'Fixed access needs a serviceability check against a street address.',
})
const ESMTRV = item({ id: 'TP-ESM-TRV', name: 'Travel eSIM — 10 GB', family: 'eSIM', rc: 14, cost_rc: 8.12 })
const WHLDAT = item({ id: 'TP-WHL-DATA', name: 'Wholesale data capacity — per line', family: 'Wholesale', rc: 7.8, cost_rc: 4.52 })
/* One item carrying a monthly charge AND a connection fee. The single-item
   version of the recurring/one-off clash, and the harder one to spot. */
const IOTSIM = item({
  id: 'TP-IOT-SIM', name: 'IoT data SIM — 500 MB', family: 'IoT connectivity',
  rc: 1.1, nrc: 2, cost_rc: 0.64, cost_nrc: 1.16,
})

const ITEMS = [MOB050, MOBUNL, VASSEC, VASCLD, VASINS, ADDROM, ADDDAT, EQPRTR, FBB300, ESMTRV, WHLDAT, IOTSIM]
const RULE: BundleRule = { per_component: 4, max_discount: 18, min_components: 2, max_components: 6 }

const pick = (telcoId: string, quantity = 1, discount = 0): ComponentPick => ({ telcoId, quantity, discount })

describe('maxComponentDiscount', () => {
  it('allows a component down to its own cost and no further', () => {
    /* 22.00 list, 12.76 cost — 42% off lands exactly on cost. */
    expect(maxComponentDiscount(MOB050)).toBe(42)
  })

  it('gives value-added services the most room, because they cost least to deliver', () => {
    expect(maxComponentDiscount(VASSEC)).toBe(62)
    expect(maxComponentDiscount(EQPRTR)).toBe(20)
  })

  it('reads the one-off cost for a one-off item rather than the recurring zero', () => {
    /* Getting this wrong would report 0% headroom on everything one-off. */
    expect(maxComponentDiscount(ADDROM)).toBe(55)
  })

  it('is zero for an item with no price at all', () => {
    expect(maxComponentDiscount(item({ id: 'TP-NIL' }))).toBe(0)
  })
})

describe('compose — the seeded packs', () => {
  it('prices Family Mobile Trio as the database does', () => {
    const c = compose([pick('TP-MOB-050', 3), pick('TP-VAS-SEC', 3)], ITEMS, RULE)
    expect(c.listTotal).toBe(73.5)
    expect(c.packPct).toBe(4)
    expect(c.price).toBe(70.56)
    expect(c.cost).toBe(41.13)
    expect(c.model).toBe('monthly')
  })

  it('prices Everything Unlimited at the four-component step', () => {
    const c = compose(
      [pick('TP-MOB-UNL'), pick('TP-VAS-INS'), pick('TP-VAS-SEC'), pick('TP-VAS-CLD')],
      ITEMS, RULE,
    )
    expect(c.listTotal).toBe(52)
    expect(c.packPct).toBe(12)
    expect(c.price).toBe(45.76)
    expect(c.cost).toBe(27.56)
  })

  it('prices a one-off pack off the non-recurring side', () => {
    const c = compose([pick('TP-ADD-ROM'), pick('TP-ADD-DAT')], ITEMS, RULE)
    expect(c.model).toBe('oneoff')
    expect(c.listTotal).toBe(12)
    expect(c.price).toBe(11.52)
    expect(c.cost).toBe(5.4)
  })
})

describe('compose — the discount rule', () => {
  it('gives nothing for a single component, because one component is the product', () => {
    expect(compose([pick('TP-MOB-050')], ITEMS, RULE).packPct).toBe(0)
  })

  it('steps once per extra component, not once per component', () => {
    const pct = (n: number) => compose(
      [pick('TP-MOB-050'), pick('TP-VAS-SEC'), pick('TP-VAS-CLD'), pick('TP-VAS-INS'), pick('TP-MOB-UNL'), pick('TP-ESM-TRV')]
        .slice(0, n), ITEMS, RULE,
    ).packPct
    expect([pct(2), pct(3), pct(4), pct(5), pct(6)]).toEqual([4, 8, 12, 16, 18])
  })

  it('caps at the published maximum rather than running on', () => {
    /* Six components would be 20% at 4% a step; the rule stops at 18. */
    const c = compose(
      [pick('TP-MOB-050'), pick('TP-VAS-SEC'), pick('TP-VAS-CLD'), pick('TP-VAS-INS'), pick('TP-MOB-UNL'), pick('TP-ESM-TRV')],
      ITEMS, RULE,
    )
    expect(c.packPct).toBe(18)
  })

  it('applies a per-component discount before the pack discount', () => {
    const plain = compose([pick('TP-MOB-050'), pick('TP-VAS-SEC')], ITEMS, RULE)
    const cut = compose([pick('TP-MOB-050', 1, 10), pick('TP-VAS-SEC')], ITEMS, RULE)
    expect(cut.lineDiscountTotal).toBe(2.2)
    expect(cut.price).toBeLessThan(plain.price)
    /* (22 − 2.20 + 2.50) × 0.96 */
    expect(cut.price).toBe(21.41)
  })

  it('clips a per-component discount at that component’s own cost', () => {
    const c = compose([pick('TP-MOB-050', 1, 90), pick('TP-VAS-SEC')], ITEMS, RULE)
    const line = c.lines[0]
    expect(line.requestedDiscount).toBe(90)
    expect(line.discount).toBe(42)
    expect(line.clipped).toBe(true)
  })
})

describe('compose — the floor', () => {
  it('raises an override that lands below what the parts cost', () => {
    const c = compose([pick('TP-MOB-050', 3), pick('TP-VAS-SEC', 3)], ITEMS, RULE, 10)
    expect(c.requested).toBe(10)
    expect(c.floored).toBe(true)
    expect(c.price).toBe(41.13)
  })

  it('accepts an override above cost as typed', () => {
    const c = compose([pick('TP-MOB-050', 3), pick('TP-VAS-SEC', 3)], ITEMS, RULE, 65)
    expect(c.floored).toBe(false)
    expect(c.price).toBe(65)
    expect(c.margin).toBe(23.87)
  })

  it('counts only the dimension being billed towards the floor', () => {
    /* Fibre costs $15.08 a month and $20.30 to install. A monthly pack is not
       made cheaper to deliver by an install fee it never charges. */
    const c = compose([pick('TP-FBB-300'), pick('TP-VAS-CLD')], ITEMS, RULE)
    expect(c.model).toBe('monthly')
    expect(c.cost).toBe(16.79)
  })
})

describe('packModel and guessFulfil', () => {
  it('bills monthly when anything in it recurs', () => {
    expect(packModel([pick('TP-MOB-050')], ITEMS)).toBe('monthly')
    expect(packModel([pick('TP-ADD-ROM'), pick('TP-ADD-DAT')], ITEMS)).toBe('oneoff')
  })

  it('ships when there is equipment, whatever else is in it', () => {
    expect(guessFulfil([pick('TP-VAS-CLD'), pick('TP-EQP-RTR')], ITEMS)).toBe('shipped')
  })

  it('reads eSIM, then provisioning, then falls back to instant', () => {
    expect(guessFulfil([pick('TP-ESM-TRV'), pick('TP-VAS-SEC')], ITEMS)).toBe('esim')
    /* Wholesale capacity has to be turned on by the network before the
       reseller's own subscriber can use it — provisioned, not instant. */
    expect(guessFulfil([pick('TP-WHL-DATA')], ITEMS)).toBe('provisioned')
    expect(guessFulfil([pick('TP-VAS-SEC'), pick('TP-VAS-CLD')], ITEMS)).toBe('instant')
  })
})

describe('sellableHere', () => {
  it('withholds what the channel does not sell', () => {
    expect(sellableHere(FBB300)).toBe(false)
    expect(sellableHere(VASSEC)).toBe(true)
  })

  /* The flag arrived after the rate card. An older copy with no column on it
     is not a rate card somebody emptied. */
  it('treats an item with no flag as sellable', () => {
    expect(sellableHere(item({ id: 'TP-OLD', rc: 1 }))).toBe(true)
  })

  it('says why and where, or says nothing at all', () => {
    expect(withheldNote(VASSEC)).toBeNull()
    const note = withheldNote(FBB300)
    expect(note).toContain('serviceability check')
    expect(note).toContain('Aventa field sales and CRM')
  })

  it('still answers when the reason was never filled in', () => {
    const bare = item({ id: 'TP-X', rc: 1, marketplace: false, sold_through: 'CRM' })
    expect(withheldNote(bare)).toContain('CRM')
  })
})

describe('compositionProblem', () => {
  const c = (picks: ComponentPick[], override: number | null = null) => compose(picks, ITEMS, RULE, override)

  it('wants a name first', () => {
    expect(compositionProblem('  ', [pick('TP-MOB-050'), pick('TP-VAS-SEC')], ITEMS, RULE, c([pick('TP-MOB-050'), pick('TP-VAS-SEC')])))
      .toMatch(/name/i)
  })

  /* Ahead of every other complaint, deliberately. Told that their discount is
     too deep on a fibre line, an operator fixes the discount and tries again. */
  it('refuses a withheld component before it complains about anything else', () => {
    const picks = [pick('TP-FBB-300'), pick('TP-VAS-SEC')]
    const said = compositionProblem('Broadband bundle', picks, ITEMS, RULE, c(picks))
    expect(said).toContain('Fibre 300 Mbps')
    expect(said).toContain('Aventa field sales and CRM')
  })

  it('names the withheld component even when the pack is also the wrong shape', () => {
    /* One component AND a withheld one. The shape complaint would otherwise
       win and send the operator off to add a second fibre line. */
    const picks = [pick('TP-FBB-300')]
    expect(compositionProblem('Just fibre', picks, ITEMS, RULE, c(picks)))
      .toContain('Fibre 300 Mbps')
  })

  it('refuses one component, and says why it is not a pack', () => {
    const picks = [pick('TP-MOB-050')]
    expect(compositionProblem('Solo', picks, ITEMS, RULE, c(picks))).toMatch(/just the product/)
  })

  it('refuses more than the rule allows', () => {
    const picks = [MOB050, MOBUNL, VASSEC, VASCLD, VASINS, ESMTRV, ADDROM].map(i => pick(i.id))
    expect(compositionProblem('Everything', picks, ITEMS, RULE, c(picks))).toMatch(/capped at 6/)
  })

  it('refuses to mix recurring and one-off, naming the components that clash', () => {
    const picks = [pick('TP-MOB-050'), pick('TP-EQP-RTR')]
    const problem = compositionProblem('Line and router', picks, ITEMS, RULE, c(picks))
    expect(problem).toMatch(/either monthly or once/)
    expect(problem).toContain('Wi-Fi 6 mesh router')
  })

  it('refuses a SIM with a connection fee for the same reason', () => {
    /* One item carrying both charges is the same clash as two items carrying
       one each, and it is the easier one to miss. */
    const picks = [pick('TP-IOT-SIM'), pick('TP-VAS-CLD')]
    expect(compositionProblem('SIM and backup', picks, ITEMS, RULE, c(picks)))
      .toMatch(/either monthly or once/)
  })

  it('refuses a price that beats nothing', () => {
    const picks = [pick('TP-MOB-050'), pick('TP-VAS-SEC')]
    expect(compositionProblem('Overpriced', picks, ITEMS, RULE, c(picks, 500)))
      .toMatch(/worse deal with a badge/)
  })

  it('refuses a price below the cost of the parts', () => {
    const picks = [pick('TP-MOB-050'), pick('TP-VAS-SEC')]
    expect(compositionProblem('Underpriced', picks, ITEMS, RULE, c(picks, 2)))
      .toMatch(/below the \$13\.71 these components cost/)
  })

  it('passes a well-formed pack', () => {
    const picks = [pick('TP-MOB-050', 3), pick('TP-VAS-SEC', 3)]
    expect(compositionProblem('Family Mobile Trio', picks, ITEMS, RULE, c(picks))).toBeNull()
  })
})

describe('compositionWarnings', () => {
  it('says which component was capped rather than that one was', () => {
    const c = compose([pick('TP-MOB-050', 1, 90), pick('TP-VAS-SEC')], ITEMS, RULE)
    expect(compositionWarnings(c)[0]).toContain('Freedom 50 GB')
  })

  it('flags a thin margin without blocking it', () => {
    const c = compose([pick('TP-MOB-050'), pick('TP-VAS-SEC')], ITEMS, RULE, 15)
    expect(compositionWarnings(c).some(w => /thin/.test(w))).toBe(true)
    expect(compositionProblem('Thin', [pick('TP-MOB-050'), pick('TP-VAS-SEC')], ITEMS, RULE, c)).toBeNull()
  })

  it('stays quiet on a healthy pack', () => {
    expect(compositionWarnings(compose([pick('TP-MOB-050', 3), pick('TP-VAS-SEC', 3)], ITEMS, RULE))).toEqual([])
  })
})

describe('priceBasis', () => {
  it('shows the whole derivation, not just the answer', () => {
    const c = compose([pick('TP-MOB-050', 3), pick('TP-VAS-SEC', 3)], ITEMS, RULE)
    expect(priceBasis(c, RULE)).toBe(
      '2 components at $73.50, less 4% pack discount (4% per extra component, capped at 18%) = $70.56.',
    )
  })

  it('says so when the published price is not the derived one', () => {
    const c = compose([pick('TP-MOB-050', 3), pick('TP-VAS-SEC', 3)], ITEMS, RULE, 65)
    expect(priceBasis(c, RULE)).toContain('$70.56 derived, published at $65.00')
  })
})
