/* The basket's rules. No database — these are the decisions the screen must
   not be making for itself. */
import { describe, it, expect } from 'vitest'
import {
  EMPTY_BASKET, MAX_QUANTITY, addToBasket, setQuantity, removeLine,
  basketTotal, basketCount, verticalOf, modelOf, repriceTo, verdict,
  whatIsMissing, missingFields, missingNote, holdsQuote, isQuoted, setReason,
} from './requisitionBasket'
import type { Basket, BasketLine } from './requisitionBasket'
import type { Policy, Account } from './enterprise'
import type { Rate } from './money'

const item = (over: Partial<Omit<BasketLine, 'quantity'>> = {}): Omit<BasketLine, 'quantity'> => ({
  product_id: 'SKU-5003', name: 'Nimbus Cold-chain sensor', seller: 'Nimbus Sensors',
  partner_id: 'PTR-002', unit_price: 8400, model: 'oneoff', vertical: 'iot', unit: null, ...over,
})

const firewall = item({
  product_id: 'SKU-6001', name: 'Sentinel Managed Firewall — Standard',
  seller: 'Sentinel Cyber', partner_id: 'PTR-004', unit_price: 24000, vertical: 'security',
})
const sim = item({
  product_id: 'SKU-5002', name: 'IoT Connect 2 GB', seller: 'Aventa Telecom',
  partner_id: null, unit_price: 269, model: 'monthly', unit: 'per SIM',
})

/* Builds a basket by adding, so the fixtures go through the same door the
   screen does. A hand-built literal could hold a state `addToBasket` refuses. */
function build(...items: { line: Omit<BasketLine, 'quantity'>; q?: number }[]): Basket {
  let b = EMPTY_BASKET
  for (const { line, q } of items) {
    const r = addToBasket(b, line, 'INR', q ?? 1)
    if (!r.ok) throw new Error(`fixture refused: ${r.reason}`)
    b = r.basket
  }
  return b
}

const ACCOUNT = { id: 'ENT-2001', currency: 'INR', market: 'IN', po_required: false } as unknown as Account
const POLICY = { threshold: 200000, security_signoff: true } as unknown as Policy

describe('putting things in', () => {
  it('takes its currency from the first line', () => {
    const b = build({ line: item() })
    expect(b.currency).toBe('INR')
    expect(b.lines).toHaveLength(1)
    expect(b.lines[0].quantity).toBe(1)
  })

  it('adds to a line already there rather than listing it twice', () => {
    const b = build({ line: item(), q: 25 }, { line: item(), q: 5 })
    expect(b.lines).toHaveLength(1)
    expect(b.lines[0].quantity).toBe(30)
  })

  it('refuses a second currency, because a total across two is in neither', () => {
    const b = build({ line: item() })
    const r = addToBasket(b, item({ product_id: 'SKU-5004', name: 'Occupancy sensor' }), 'AED')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/INR.*AED|priced in INR/)
  })

  it('refuses to mix a one-off with a monthly, which are different commitments', () => {
    const b = build({ line: item() })
    const r = addToBasket(b, sim, 'INR')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/one-off|monthly/)
  })

  it('allows the mix in the other direction no more than in this one', () => {
    let b = EMPTY_BASKET
    const first = addToBasket(b, sim, 'INR')
    expect(first.ok).toBe(true)
    if (!first.ok) return
    b = first.basket
    expect(addToBasket(b, item(), 'INR').ok).toBe(false)
  })

  it('refuses something the shelf does not price', () => {
    const r = addToBasket(EMPTY_BASKET, item({ unit_price: 0 }), 'INR')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/no price in INR/)
  })

  it('refuses a fractional or absent quantity', () => {
    expect(addToBasket(EMPTY_BASKET, item(), 'INR', 2.5).ok).toBe(false)
    expect(addToBasket(EMPTY_BASKET, item(), 'INR', 0).ok).toBe(false)
    expect(addToBasket(EMPTY_BASKET, item(), 'INR', -3).ok).toBe(false)
  })

  it('refuses a quantity nobody meant, including by accumulation', () => {
    expect(addToBasket(EMPTY_BASKET, item(), 'INR', MAX_QUANTITY + 1).ok).toBe(false)
    const b = build({ line: item(), q: MAX_QUANTITY })
    expect(addToBasket(b, item(), 'INR', 1).ok).toBe(false)
  })
})

describe('changing what is in it', () => {
  it('sets a quantity outright', () => {
    const b = build({ line: item(), q: 3 })
    const r = setQuantity(b, 'SKU-5003', 40)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.basket.lines[0].quantity).toBe(40)
  })

  it('treats nought as removing it, because that is what typing 0 means', () => {
    const b = build({ line: item() }, { line: item({ product_id: 'SKU-5004', name: 'Occupancy' }) })
    const r = setQuantity(b, 'SKU-5003', 0)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.basket.lines.map(l => l.product_id)).toEqual(['SKU-5004'])
  })

  it('forgets the currency once the last line goes, so the other one is takeable', () => {
    const b = build({ line: item() })
    const r = removeLine(b, 'SKU-5003')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.basket.currency).toBe('')
    /* The point of forgetting it: a dirham line is now allowed. */
    expect(addToBasket(r.basket, item(), 'AED').ok).toBe(true)
  })

  it('totals the lines and counts the units, which are different questions', () => {
    const b = build({ line: item(), q: 10 }, { line: item({ product_id: 'SKU-5004', name: 'Occupancy', unit_price: 6200 }), q: 4 })
    expect(basketTotal(b)).toBe(10 * 8400 + 4 * 6200)
    expect(basketCount(b)).toBe(14)
    expect(b.lines).toHaveLength(2)
  })
})

describe('what the requisition is filed under', () => {
  it('is the one vertical when they all agree', () => {
    const b = build({ line: item() }, { line: item({ product_id: 'SKU-5004', name: 'Occupancy' }) })
    expect(verticalOf(b.lines)).toBe('iot')
  })

  it('is security whenever anything in it is, however little of it there is', () => {
    /* The rule that matters. One firewall among ninety sensors is still a
       security purchase, and `needFor` reads nothing but the vertical to
       decide whether IT signs. */
    const b = build({ line: item(), q: 90 }, { line: firewall, q: 1 })
    expect(verticalOf(b.lines)).toBe('security')
    expect(verdict(b, ACCOUNT, POLICY, [], '2026-08-04').need).toBe('both')
  })

  it('is the vertical carrying the most money when none is security', () => {
    const b = build(
      { line: item({ product_id: 'SKU-4001', name: 'Kestrel K9 Pro', vertical: 'device', unit_price: 64999 }), q: 3 },
      { line: item(), q: 2 },
    )
    expect(verticalOf(b.lines)).toBe('device')
  })

  it('is nothing at all for an empty basket', () => {
    expect(verticalOf([])).toBe('')
  })

  it('reports the model the basket was fixed to by its first line', () => {
    expect(modelOf(build({ line: sim }).lines)).toBe('monthly')
    expect(modelOf([])).toBe('oneoff')
  })
})

describe('moving it to another currency', () => {
  const shelf = [
    { id: 'SKU-5003', price: 372, model: 'oneoff', unit: null },
    { id: 'SKU-5004', price: 275, model: 'oneoff', unit: null },
  ]

  it('takes the new shelf price rather than converting the old one', () => {
    const b = build({ line: item(), q: 10 })
    const { basket, dropped } = repriceTo(b, 'AED', shelf)
    expect(dropped).toEqual([])
    expect(basket.currency).toBe('AED')
    expect(basket.lines[0].unit_price).toBe(372)
    expect(basket.lines[0].quantity).toBe(10)
    expect(basketTotal(basket)).toBe(3720)
  })

  it('drops and names anything the new shelf does not carry', () => {
    const b = build({ line: item() }, { line: firewall })
    const { basket, dropped } = repriceTo(b, 'AED', shelf)
    expect(dropped).toEqual(['Sentinel Managed Firewall — Standard'])
    expect(basket.lines).toHaveLength(1)
  })

  it('empties rather than leaving a basket of nothing in a new currency', () => {
    const b = build({ line: firewall })
    const { basket } = repriceTo(b, 'AED', shelf)
    expect(basket).toEqual(EMPTY_BASKET)
  })

  it('drops and names a line the new currency does not price, rather than carrying a figure in another money', () => {
    /* loadEnterpriseCatalogue's fallback: no book row in AED, so the base row,
       labelled USD. It is not an AED price. */
    const b = build({ line: item() }, { line: firewall })
    const mixed = [...shelf, { id: 'SKU-6001', price: 289, model: 'oneoff', unit: null, currency: 'USD' }]
    const { basket, dropped } = repriceTo(b, 'AED', mixed)
    expect(dropped).toEqual(['Sentinel Managed Firewall — Standard'])
    expect(basket.lines.map(l => l.product_id)).toEqual(['SKU-5003'])
  })

  it('takes a shelf row labelled in the new currency', () => {
    const b = build({ line: item(), q: 2 })
    const { basket, dropped } = repriceTo(b, 'AED', [{ id: 'SKU-5003', price: 372, model: 'oneoff', unit: null, currency: 'AED' }])
    expect(dropped).toEqual([])
    expect(basket.lines[0].unit_price).toBe(372)
  })

  it('is a no-op when the currency has not moved', () => {
    const b = build({ line: item() })
    expect(repriceTo(b, 'INR', []).basket).toBe(b)
  })
})

describe('what raising it will mean, said before it is raised', () => {
  it('needs nobody when it is under the threshold and not security', () => {
    const v = verdict(build({ line: item(), q: 2 }), ACCOUNT, POLICY, [], '2026-08-04')
    expect(v.need).toBe('none')
    expect(v.blocked).toBeNull()
    expect(v.total).toBe(16800)
  })

  it('needs finance at the threshold, not merely above it', () => {
    /* 200000 exactly. `needFor` uses >=, and a preview that said "no approval"
       on the boundary would be contradicted by the requisition it raised. */
    const b = build({ line: item({ unit_price: 100000 }), q: 2 })
    expect(basketTotal(b)).toBe(200000)
    expect(verdict(b, ACCOUNT, POLICY, [], '2026-08-04').need).toBe('finance')
  })

  it('needs IT for a small security purchase, and says why', () => {
    const v = verdict(build({ line: firewall }), ACCOUNT, POLICY, [], '2026-08-04')
    expect(v.need).toBe('it')
    expect(v.note).toMatch(/security/i)
  })

  it('refuses to guess when the total cannot be put into the policy currency', () => {
    /* The account judges in INR; this basket is in dirhams and there is no
       rate. Calling that 'none' would place an order nobody approved. */
    const b = build({ line: item() })
    const inAed = repriceTo(b, 'AED', [{ id: 'SKU-5003', price: 372, model: 'oneoff', unit: null }]).basket
    const v = verdict(inAed, ACCOUNT, POLICY, [], '2026-08-04')
    expect(v.blocked).toMatch(/no exchange rate/i)
    expect(v.note).toBeNull()
  })

  it('judges a second currency at the rate on the day', () => {
    const rates: Rate[] = [
      { base: 'AED', quote: 'INR', rate: 23.5, as_of: '2026-08-01' } as unknown as Rate,
    ]
    const b = repriceTo(build({ line: item(), q: 30 }), 'AED',
      [{ id: 'SKU-5003', price: 372, model: 'oneoff', unit: null }]).basket
    /* 30 × 372 = 11,160 AED ≈ 262,260 INR, which is over the 200,000 threshold
       even though the figure on the screen is a five-digit dirham one. */
    const v = verdict(b, ACCOUNT, POLICY, rates, '2026-08-04')
    expect(v.total).toBe(11160)
    expect(v.currency).toBe('AED')
    expect(v.need).toBe('finance')
    expect(v.note).toMatch(/converted at/)
  })

  /* The preview is what a buyer reads beside a basket the storefront already
     wrote in rupees. Written by `money()` it says "INR 200,000.00" under a
     total that says "₹2,00,000.00". */
  it('writes the threshold in the money the screen is written in', () => {
    const rupees = (n: number, c: string) =>
      `${c === 'INR' ? '₹' : c + ' '}${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    const b = build({ line: item({ unit_price: 100000 }), q: 2 })
    const v = verdict(b, ACCOUNT, POLICY, [], '2026-08-04', rupees)
    expect(v.note).toContain('₹2,00,000.00')
    expect(v.note).not.toMatch(/INR [\d,]/)
    /* And still the ISO code when nobody hands it one. */
    expect(verdict(b, ACCOUNT, POLICY, [], '2026-08-04').note).toContain('INR 200,000.00')
  })

  it('says nothing about an empty basket', () => {
    const v = verdict(EMPTY_BASKET, ACCOUNT, POLICY, [], '2026-08-04')
    expect(v.total).toBe(0)
    expect(v.note).toBeNull()
    expect(v.blocked).toBeNull()
  })
})

describe('what is still missing', () => {
  const full = { title: 'Cold-chain rollout', reason: 'Depot 4 expansion', cost_centre: 'CC-01', po_ref: '' }

  it('is nothing when the draft is complete', () => {
    expect(whatIsMissing(build({ line: item() }), full, ACCOUNT)).toEqual([])
    expect(missingNote([])).toBeNull()
  })

  it('names an empty basket, which no form field would', () => {
    expect(whatIsMissing(EMPTY_BASKET, full, ACCOUNT)).toContain('at least one line')
  })

  it('names each empty field', () => {
    const m = whatIsMissing(build({ line: item() }), { title: ' ', reason: '', cost_centre: null, po_ref: '' }, ACCOUNT)
    expect(m).toHaveLength(3)
  })

  it('asks for a purchase order only on an account that requires one', () => {
    const strict = { ...ACCOUNT, po_required: true } as Account
    expect(whatIsMissing(build({ line: item() }), full, strict))
      .toEqual(['a purchase order reference, which this account requires on every invoice'])
    expect(whatIsMissing(build({ line: item() }), { ...full, po_ref: 'PO-8891' }, strict)).toEqual([])
  })

  it('reads as a sentence rather than a list', () => {
    expect(missingNote(['a', 'b', 'c'])).toBe('Still needs a, b and c.')
    expect(missingNote(['a'])).toBe('Still needs a.')
  })

  it('names the field, so the screen can take somebody to it', () => {
    /* The prose alone is what a disabled button had, and it was not enough —
       the fields it described were below the fold. */
    const m = missingFields(build({ line: item() }), { title: '', reason: '', cost_centre: null, po_ref: '' }, ACCOUNT)
    expect(m.map(x => x.field)).toEqual(['title', 'reason', 'cost_centre'])
  })

  it('names them in the order they appear on the form', () => {
    /* Because the screen focuses the first, and focusing the cost centre while
       the title above it is also empty sends somebody to the wrong place. */
    const strict = { ...ACCOUNT, po_required: true } as Account
    const m = missingFields(EMPTY_BASKET, { title: '', reason: '', cost_centre: null, po_ref: '' }, strict)
    expect(m.map(x => x.field)).toEqual(['lines', 'title', 'reason', 'cost_centre', 'po_ref'])
  })

  it('says the same thing both ways round', () => {
    const draft = { title: '', reason: 'why', cost_centre: null, po_ref: '' }
    const b = build({ line: item() })
    expect(whatIsMissing(b, draft, ACCOUNT)).toEqual(missingFields(b, draft, ACCOUNT).map(m => m.says))
  })
})

describe('a line from an accepted quote', () => {
  const quoted = item({ unit_price: 7900, quote_line_id: 'EQL-1' })

  it('goes in at the quoted price and quantity, as its own line', () => {
    const b = build({ line: quoted, q: 40 })
    expect(b.lines[0].unit_price).toBe(7900)
    expect(b.lines[0].quantity).toBe(40)
    expect(isQuoted(b.lines[0])).toBe(true)
    expect(holdsQuote(b)).toBe(true)
  })

  it('is not added twice', () => {
    expect(addToBasket(build({ line: quoted, q: 40 }), quoted, 'INR', 40).ok).toBe(false)
  })

  it('does not merge with an ordinary line of the same product, either way round', () => {
    expect(addToBasket(build({ line: item() }), quoted, 'INR', 40).ok).toBe(false)
    expect(addToBasket(build({ line: quoted, q: 40 }), item(), 'INR', 1).ok).toBe(false)
  })

  it('keeps its quantity, but can be removed', () => {
    const b = build({ line: quoted, q: 40 })
    expect(setQuantity(b, 'SKU-5003', 41).ok).toBe(false)
    expect(setQuantity(b, 'SKU-5003', 40).ok).toBe(true)
    const gone = setQuantity(b, 'SKU-5003', 0)
    expect(gone.ok && gone.basket).toEqual(EMPTY_BASKET)
  })

  it('is never re-read from a shelf, so the basket stays in the quoted currency', () => {
    const b = build({ line: quoted, q: 40 }, { line: firewall })
    const { basket, dropped } = repriceTo(b, 'AED', [
      { id: 'SKU-5003', price: 372, model: 'oneoff', unit: null },
      { id: 'SKU-6001', price: 1100, model: 'oneoff', unit: null },
    ])
    expect(basket).toBe(b)
    expect(dropped).toEqual([])
    expect(basket.lines[0].unit_price).toBe(7900)
  })

  it('leaves ordinary lines behaving as before', () => {
    const b = build({ line: item() }, { line: item() })
    expect(b.lines).toHaveLength(1)
    expect(b.lines[0].quantity).toBe(2)
    expect(holdsQuote(b)).toBe(false)
  })
})

describe('the account price book and its buying rules', () => {
  const onBook = item({ product_id: 'SKU-9101', name: 'Agreed tracker', on_contract: true })
  const offBook = item({ product_id: 'SKU-9102', name: 'Unagreed tracker', on_contract: false })
  const full = { title: 'Trackers', reason: 'Fleet', cost_centre: 'CC-01', po_ref: '' }

  it('records a reason on a line, and refuses a line that is not there', () => {
    const b = build({ line: offBook })
    const r = setReason(b, 'SKU-9102', 'Only stockist in Pune')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.basket.lines[0].off_contract_reason).toBe('Only stockist in Pune')
    const nope = setReason(b, 'SKU-0000', 'Only stockist in Pune')
    expect(nope.ok).toBe(false)
    expect(b.lines[0].off_contract_reason).toBeUndefined()
  })

  it('under approval, a line off the book sends a within-policy requisition to finance', () => {
    const v = verdict(build({ line: offBook }), ACCOUNT, POLICY, [], '2026-08-04', undefined, { rule: 'approval' })
    expect(v.need).toBe('finance')
    expect(v.note).toContain("1 line is off the account's price book — finance approval required")
  })

  it('under approval, an IT sign-off becomes both', () => {
    const fw = item({ ...firewall, on_contract: false })
    expect(verdict(build({ line: fw }), ACCOUNT, POLICY, [], '2026-08-04').need).toBe('it')
    expect(verdict(build({ line: fw }), ACCOUNT, POLICY, [], '2026-08-04', undefined, { rule: 'approval' }).need).toBe('both')
  })

  it('under approval, a basket wholly on the book is unchanged', () => {
    const plain = verdict(build({ line: onBook }), ACCOUNT, POLICY, [], '2026-08-04')
    const ruled = verdict(build({ line: onBook }), ACCOUNT, POLICY, [], '2026-08-04', undefined, { rule: 'approval' })
    expect(ruled).toEqual(plain)
  })

  it('under allow or reason, the need is unchanged', () => {
    const b = build({ line: offBook })
    const plain = verdict(b, ACCOUNT, POLICY, [], '2026-08-04')
    expect(verdict(b, ACCOUNT, POLICY, [], '2026-08-04', undefined, { rule: 'allow' })).toEqual(plain)
    const reason = verdict(b, ACCOUNT, POLICY, [], '2026-08-04', undefined, { rule: 'reason' })
    expect(reason.need).toBe(plain.need)
    expect(reason.note).toContain('a reason is recorded for each')
  })

  it('asks for a reason on each off-book line when the rule is reason and it is shown', () => {
    const b = build({ line: offBook }, { line: onBook })
    const asks = missingFields(b, full, ACCOUNT, { rule: 'reason', shows: true })
    expect(asks).toEqual([{ field: 'off_contract_reason', says: 'a reason for each line off your price book' }])
    const r = setReason(b, 'SKU-9102', 'Only stockist in Pune')
    if (!r.ok) throw new Error(r.reason)
    expect(missingFields(r.basket, full, ACCOUNT, { rule: 'reason', shows: true })).toEqual([])
    const short = setReason(b, 'SKU-9102', ' abc ')
    if (!short.ok) throw new Error(short.reason)
    expect(missingFields(short.basket, full, ACCOUNT, { rule: 'reason', shows: true }).map(m => m.field)).toEqual(['off_contract_reason'])
  })

  it('asks for no reason under allow or approval, when hidden, or without rules', () => {
    const b = build({ line: offBook })
    expect(missingFields(b, full, ACCOUNT, { rule: 'allow', shows: true })).toEqual([])
    expect(missingFields(b, full, ACCOUNT, { rule: 'approval', shows: true })).toEqual([])
    expect(missingFields(b, full, ACCOUNT, { rule: 'reason', shows: false })).toEqual([])
    expect(missingFields(b, full, ACCOUNT)).toEqual([])
  })

  it('takes on_contract from the new shelf and drops a reason once the line is on the book', () => {
    const r = setReason(build({ line: offBook }), 'SKU-9102', 'Only stockist in Pune')
    if (!r.ok) throw new Error(r.reason)
    const on = repriceTo(r.basket, 'AED', [{ id: 'SKU-9102', price: 300, model: 'oneoff', unit: null, currency: 'AED', on_contract: true }]).basket
    expect(on.lines[0].on_contract).toBe(true)
    expect(on.lines[0].off_contract_reason).toBeUndefined()
    const still = repriceTo(r.basket, 'AED', [{ id: 'SKU-9102', price: 300, model: 'oneoff', unit: null, currency: 'AED', on_contract: false }]).basket
    expect(still.lines[0].on_contract).toBe(false)
    expect(still.lines[0].off_contract_reason).toBe('Only stockist in Pune')
  })
})
