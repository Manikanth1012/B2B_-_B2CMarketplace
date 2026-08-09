import { describe, it, expect } from 'vitest'
import {
  offeredTo, worthOf, mostRedeemable, validateRedemption, canRedeemAnything,
  ladderFor, rungOf, rungState, nextRung,
  rateFor, worthIn, ladderIn, returnRate, earnLine, pointsFor,
  earnOnSpend, reversalOf,
  fmtPoints, fmtMoney, earnedOn, withinMonthlyCap, reversalValueOf } from './loyalty'
import type { Member, Programme, RedeemOption, PointRate, Threshold } from './loyalty'

const PROGRAMME: Programme = {
  id: 'LP-01', name: 'Aventa Rewards', unit: 'point', per_unit: 100, min_redeem: 500,
  expiry_months: 24, rounding_note: 'Rounded down.', status: 'active',
}

function option(over: Partial<RedeemOption> = {}): RedeemOption {
  return {
    id: 'RDM-01', name: 'Wallet credit', kind: 'wallet', min: 500, step: 100,
    value_per: 1, cost: 'operator', audience: 'all', status: 'active',
    description: 'Spendable in the marketplace.', why: null, ...over,
  }
}

function member(over: Partial<Member> = {}): Member {
  return {
    id: 'LM-4001', name: 'Priya Raman', kind: 'consumer', currency: 'USD', tier: 'gold', balance: 12400,
    qualify_12m: 2100, lifetime_earned: 30000, lifetime_redeemed: 17600,
    expiring_soon: 800, expiring_on: '31 Dec 2026', last_activity: '25 Jul 2026',
    user_id: 'u1', ...over,
  }
}

const WALLET = option()
const BILL = option({ id: 'RDM-02', name: 'Bill credit', kind: 'bill', min: 1000, step: 500 })
const ORG = option({ id: 'RDM-09', name: 'Invoice credit', audience: 'enterprise', min: 5000 })
const RETIRED = option({ id: 'RDM-08', name: 'Old voucher', status: 'retired' })
const OPTIONS = [WALLET, BILL, ORG, RETIRED]

describe('what is on offer', () => {
  it('offers the live options for this kind of account', () => {
    expect(offeredTo(OPTIONS, member()).map(o => o.id)).toEqual(['RDM-01', 'RDM-02'])
  })

  it('does not offer an organisation redemption to a retail customer', () => {
    expect(offeredTo(OPTIONS, member()).map(o => o.id)).not.toContain('RDM-09')
    expect(offeredTo(OPTIONS, member({ kind: 'enterprise' })).map(o => o.id)).toContain('RDM-09')
  })

  it('offers nothing to nobody', () => {
    expect(offeredTo(OPTIONS, null)).toEqual([])
  })

  it('converts points to money at the programme rate', () => {
    expect(worthOf(12400, WALLET, PROGRAMME)).toBe(124)
    expect(worthOf(1250, option({ value_per: 1.5 }), PROGRAMME)).toBe(18.75)
  })

  it('rounds to the cent rather than carrying a fraction of one', () => {
    expect(worthOf(333, WALLET, PROGRAMME)).toBe(3.33)
  })

  it('says the most that can go in, respecting the step', () => {
    expect(mostRedeemable(WALLET, member({ balance: 12450 }))).toBe(12400)
    expect(mostRedeemable(BILL, member({ balance: 12450 }))).toBe(12000)
  })
})

/* The refusals are the point of the module — each is a sentence a customer can
   act on, and each is checked again inside `redeem_points()`. */
describe('whether a redemption can go ahead', () => {
  const go = (over: Partial<{ member: Member | null; option: RedeemOption | undefined; points: number }> = {}) =>
    validateRedemption({
      member: member(), option: WALLET, programme: PROGRAMME, points: 1000, ...over,
    })

  it('allows a redemption that meets every rule, and says what it costs', () => {
    const c = go()
    expect(c.ok).toBe(true)
    if (c.ok) {
      expect(c.note).toMatch(/1,000 pts for \$10\.00 of wallet credit/)
      expect(c.note).toMatch(/not reversible/)
    }
  })

  it('refuses more than the balance, and says what is available', () => {
    const c = go({ points: 99999 })
    expect(c.ok).toBe(false)
    if (!c.ok) expect(c.reason).toMatch(/more than your balance — 12,400 pts available/)
  })

  /* Order matters: somebody 200 points short needs to hear that, not a lecture
     about step sizes on a total they could never reach. */
  it('answers the balance before the step', () => {
    const c = validateRedemption({ member: member({ balance: 300 }), option: WALLET, programme: PROGRAMME, points: 350 })
    expect(c.ok).toBe(false)
    if (!c.ok) expect(c.reason).toMatch(/more than your balance/)
  })

  it('refuses below the programme floor', () => {
    const c = go({ points: 200 })
    expect(c.ok).toBe(false)
    if (!c.ok) expect(c.reason).toMatch(/at least 500 pts before anything can be redeemed/)
  })

  it('refuses below an option that starts higher than the floor', () => {
    const c = go({ option: BILL, points: 500 })
    expect(c.ok).toBe(false)
    if (!c.ok) expect(c.reason).toMatch(/Bill credit starts at 1,000 pts/)
  })

  it('refuses a figure between the steps', () => {
    const c = go({ points: 1050 })
    expect(c.ok).toBe(false)
    if (!c.ok) expect(c.reason).toMatch(/steps of 100 pts/)
  })

  it('refuses a retired option and one meant for another audience', () => {
    expect(go({ option: RETIRED }).ok).toBe(false)
    expect(go({ option: ORG, points: 5000 }).ok).toBe(false)
  })

  it('refuses nothing chosen, nothing loaded, and nothing sensible', () => {
    expect(go({ option: undefined }).ok).toBe(false)
    expect(go({ member: null }).ok).toBe(false)
    expect(go({ points: 0 }).ok).toBe(false)
    expect(go({ points: Number.NaN }).ok).toBe(false)
    expect(go({ points: -1000 }).ok).toBe(false)
  })
})

describe('whether anything can be redeemed at all', () => {
  it('says yes when the balance clears the floor and something is on offer', () => {
    expect(canRedeemAnything(member(), OPTIONS, PROGRAMME).ok).toBe(true)
  })

  it('names the floor when the balance is under it', () => {
    const c = canRedeemAnything(member({ balance: 120 }), OPTIONS, PROGRAMME)
    expect(c.ok).toBe(false)
    if (!c.ok) expect(c.reason).toMatch(/at least 500 pts .* 120 pts so far/)
  })

  it('names the smallest redemption when the floor is cleared but nothing is affordable', () => {
    const dear = [option({ id: 'RDM-07', min: 20000, step: 1000 })]
    const c = canRedeemAnything(member({ balance: 900 }), dear, PROGRAMME)
    expect(c.ok).toBe(false)
    if (!c.ok) expect(c.reason).toMatch(/smallest redemption on offer is 20,000 pts/)
  })

  it('says so plainly when nothing is offered to this account', () => {
    const c = canRedeemAnything(member({ kind: 'consumer' }), [ORG], PROGRAMME)
    expect(c.ok).toBe(false)
    if (!c.ok) expect(c.reason).toMatch(/nothing on offer for your account/)
  })
})

describe('the words', () => {
  it('writes points and money the way the screen does', () => {
    expect(fmtPoints(12400)).toBe('12,400 pts')
    expect(fmtPoints(null)).toBe('—')
    expect(fmtPoints(Number.NaN)).toBe('—')
    expect(fmtMoney(124)).toBe('$124.00')
    expect(fmtMoney(1234.5)).toBe('$1,234.50')
  })
})

/* --------------------------------------------------------------- ladders -- */

/* `loyalty_tiers` holds two progressions in one table and they share
   sort_order 1..4. Unscoped, the retail rewards page drew all eight rungs
   interleaved — qualifying spend running $600, $12,000, $35,000, $1,800,
   $100,000, $4,500 — with "You are here" under two of them. */
const RUNGS = [
  { id: 'bronze', sort_order: 1, qualify_spend: 0, kind: 'consumer' },
  { id: 'org-bronze', sort_order: 1, qualify_spend: 0, kind: 'enterprise' },
  { id: 'silver', sort_order: 2, qualify_spend: 600, kind: 'consumer' },
  { id: 'org-silver', sort_order: 2, qualify_spend: 12000, kind: 'enterprise' },
  { id: 'gold', sort_order: 3, qualify_spend: 1800, kind: 'consumer' },
  { id: 'org-gold', sort_order: 3, qualify_spend: 35000, kind: 'enterprise' },
  { id: 'platinum', sort_order: 4, qualify_spend: 4500, kind: 'consumer' },
  { id: 'org-platinum', sort_order: 4, qualify_spend: 100000, kind: 'enterprise' },
]

describe('which ladder an account climbs', () => {
  it('gives a retail member the retail rungs only', () => {
    expect(ladderFor(RUNGS, 'consumer').map(t => t.id))
      .toEqual(['bronze', 'silver', 'gold', 'platinum'])
  })

  it('gives a business account the business rungs only', () => {
    expect(ladderFor(RUNGS, 'enterprise').map(t => t.id))
      .toEqual(['org-bronze', 'org-silver', 'org-gold', 'org-platinum'])
  })

  it('leaves the qualifying spend climbing, which is the whole point', () => {
    const spends = ladderFor(RUNGS, 'consumer').map(t => t.qualify_spend)
    expect(spends).toEqual([...spends].sort((a, b) => a - b))
  })

  it('treats an unknown kind as retail rather than showing everything', () => {
    expect(ladderFor(RUNGS, 'nonsense').map(t => t.id))
      .toEqual(['bronze', 'silver', 'gold', 'platinum'])
  })
})

describe('where the member is standing', () => {
  const priya = { tier: 'gold', qualify_12m: 2500 }
  const RETAIL = ladderFor(RUNGS, 'consumer')

  it('finds the rung by id', () => {
    expect(rungOf(RETAIL, priya)?.id).toBe('gold')
  })

  it('will not find a rung from the other ladder', () => {
    expect(rungOf(RETAIL, { tier: 'org-gold' })).toBeNull()
  })

  /* The defect this is really about: rank is unique only within one ladder,
     so comparing sort_order marked Gold *and* Business Plus as "here". */
  it('marks exactly one rung as here', () => {
    const current = rungOf(RETAIL, priya)
    const here = RUNGS.filter(t => rungState(t, current) === 'here')
    expect(here.map(t => t.id)).toEqual(['gold'])
  })

  it('calls the rungs below past and the rungs above future', () => {
    const current = rungOf(RETAIL, priya)
    expect(RETAIL.map(t => rungState(t, current))).toEqual(['past', 'past', 'here', 'future'])
  })

  it('calls everything future when the member is on no known rung', () => {
    expect(rungState(RUNGS[0], null)).toBe('future')
  })
})

describe('what the next rung costs', () => {
  it('names the next rung on the member’s own ladder', () => {
    expect(nextRung(ladderFor(RUNGS, 'consumer'), { tier: 'gold', qualify_12m: 2500 }).next?.id)
      .toBe('platinum')
  })

  it('measures the gap from the rung below, not from zero', () => {
    /* Gold is $1,800, Platinum $4,500, and this member has spent $2,500. That
       is 700 of a 2,700 span — 26%. Measured from zero it would read 56%,
       which flatters a member who has only just arrived. */
    const p = nextRung(ladderFor(RUNGS, 'consumer'), { tier: 'gold', qualify_12m: 2500 })
    expect(p.need).toBe(2000)
    expect(p.pct).toBe(26)
  })

  it('is complete at the top of the ladder', () => {
    const p = nextRung(ladderFor(RUNGS, 'consumer'), { tier: 'platinum', qualify_12m: 9000 })
    expect(p).toEqual({ next: null, need: 0, pct: 100 })
  })

  it('never reports a negative gap or a percentage past 100', () => {
    const p = nextRung(ladderFor(RUNGS, 'consumer'), { tier: 'bronze', qualify_12m: 100000 })
    expect(p.need).toBeGreaterThanOrEqual(0)
    expect(p.pct).toBeLessThanOrEqual(100)
  })
})

/* ------------------------------------ what a point is worth, and where -- */

const RATES: PointRate[] = [
  { currency: 'USD', earn_per_unit: 1, per_unit: 100 },
  { currency: 'INR', earn_per_unit: 0.01, per_unit: 1 },
  { currency: 'AED', earn_per_unit: 0.25, per_unit: 25 },
  { currency: 'KES', earn_per_unit: 0.01, per_unit: 1 },
]

const RETAIL = ladderFor(RUNGS, 'consumer')

const THRESHOLDS: Threshold[] = [
  { tier_id: 'bronze', currency: 'INR', qualify_spend: 0 },
  { tier_id: 'silver', currency: 'INR', qualify_spend: 50000 },
  { tier_id: 'gold', currency: 'INR', qualify_spend: 150000 },
  { tier_id: 'platinum', currency: 'INR', qualify_spend: 400000 },
]

describe('rateFor', () => {
  it('finds the rate set for a currency', () => {
    expect(rateFor(RATES, 'INR')?.per_unit).toBe(1)
  })

  it('is null for a currency nobody has priced a point in, rather than the first one', () => {
    /* Falling back to USD would value a member's balance at a hundredth of
       what it is, silently and only for them. */
    expect(rateFor(RATES, 'GBP')).toBeNull()
  })
})

describe('worthIn', () => {
  it('values points in the member’s own money, not always the dollar', () => {
    expect(worthIn(2500, { value_per: 1 }, rateFor(RATES, 'USD'))).toBe(25)
    expect(worthIn(2500, { value_per: 1 }, rateFor(RATES, 'INR'))).toBe(2500)
    expect(worthIn(2500, { value_per: 1 }, rateFor(RATES, 'AED'))).toBe(100)
  })

  it('carries the option’s own premium through', () => {
    /* A seller voucher is worth 20% more than plain credit, in every currency. */
    expect(worthIn(1000, { value_per: 1.2 }, rateFor(RATES, 'INR'))).toBe(1200)
    expect(worthIn(1000, { value_per: 1.2 }, rateFor(RATES, 'USD'))).toBe(12)
  })

  it('is worth nothing rather than worth somebody else’s number when unpriced', () => {
    expect(worthIn(2500, { value_per: 1 }, null)).toBe(0)
  })

  it('does not divide by zero into an infinity', () => {
    expect(worthIn(2500, { value_per: 1 }, { currency: 'XXX', earn_per_unit: 1, per_unit: 0 })).toBe(0)
  })
})

describe('returnRate', () => {
  it('gives every currency the same return, which is the only check that means anything', () => {
    /* Each rate agrees with itself by construction, so comparing a rate to
       itself proves nothing. What matters is that a rupee and a dirham hand
       back the same proportion of what was spent. */
    for (const r of RATES) expect(returnRate(r), r.currency).toBeCloseTo(1, 10)
  })

  it('catches a rate that has quietly become five times as generous', () => {
    expect(returnRate({ currency: 'INR', earn_per_unit: 0.05, per_unit: 1 })).toBeCloseTo(5, 10)
  })
})

describe('pointsFor', () => {
  it('earns points on spend at the rung’s multiplier, in the local denomination', () => {
    /* ₹14,000 at 1.5× Gold is the 210 points on Priya's ledger. */
    expect(pointsFor(14000, rateFor(RATES, 'INR'), 1.5)).toBe(210)
    /* The same 1.5× on $140 is the same 210 — the point is the unit that
       travels, and only its value is local. */
    expect(pointsFor(140, rateFor(RATES, 'USD'), 1.5)).toBe(210)
  })

  it('issues whole points, because the ledger holds whole points', () => {
    expect(Number.isInteger(pointsFor(1333, rateFor(RATES, 'INR'), 1.5))).toBe(true)
  })

  it('earns nothing where nobody has priced a point', () => {
    expect(pointsFor(14000, null, 1.5)).toBe(0)
  })

  it('floors rather than rounds, so an unearned point is not awarded', () => {
    /* KES 3,188.79 at 1.25× is 39.86 points, and the ledger row says 39. This
       was Math.round, which said 40 — the screen quoting the next earn and the
       ledger recording it disagreed by one. */
    expect(pointsFor(3188.79, rateFor(RATES, 'KES'), 1.25)).toBe(39)
    expect(pointsFor(1981.90, rateFor(RATES, 'KES'), 1.25)).toBe(24)
    expect(pointsFor(81895.69, rateFor(RATES, 'KES'), 1.25)).toBe(1023)
  })
})

describe('earnOnSpend', () => {
  const kenyan = { currency: 'KES' }
  /* USD→KES on 28 Jul 2026, the rate the marketplace treasury had in force. */
  const RATE = 128.45

  it('converts the spend before computing points, not the points afterwards', () => {
    const got = earnOnSpend({
      spend: 12.50, paidIn: 'USD', member: kenyan, rates: RATES, fxRate: RATE, multiplier: 1.25,
    })
    expect(got.spendInHome).toBe(1605.63)
    expect(got.points).toBe(20)
    expect(got.converted).toBe(true)

    /* The wrong way round, for the record: earning in dollars first gives 15,
       and 15 points in a KES programme is KSh 15 rather than the KSh 20 that
       spend is worth. */
    expect(pointsFor(12.50, rateFor(RATES, 'USD'), 1.25)).toBe(15)
  })

  it('returns the same 1% of spend whichever currency it was paid in', () => {
    const inDollars = earnOnSpend({
      spend: 100, paidIn: 'USD', member: kenyan, rates: RATES, fxRate: RATE,
    })
    const inShillings = earnOnSpend({
      spend: 100 * RATE, paidIn: 'KES', member: kenyan, rates: RATES, fxRate: 1,
    })
    expect(inDollars.points).toBe(inShillings.points)
  })

  it('applies no rate at all when the money is already the member’s own', () => {
    const got = earnOnSpend({
      spend: 1637.07, paidIn: 'KES', member: kenyan, rates: RATES, fxRate: 999,
    })
    expect(got.fxRate).toBe(1)
    expect(got.spendInHome).toBe(1637.07)
    expect(got.converted).toBe(false)
  })

  it('refuses a conversion it has no rate for rather than assuming parity', () => {
    const got = earnOnSpend({
      spend: 12.50, paidIn: 'USD', member: kenyan, rates: RATES, fxRate: 0,
    })
    /* Parity would award 1/129th of the points and look like a small purchase
       rather than a missing rate. */
    expect(got.points).toBe(0)
    expect(got.converted).toBe(true)
  })

  it('earns nothing where nobody has priced a point in the member’s currency', () => {
    const got = earnOnSpend({
      spend: 1000, paidIn: 'KES', member: { currency: 'ZZZ' }, rates: RATES, fxRate: 1,
    })
    expect(got.points).toBe(0)
  })
})

describe('reversalOf', () => {
  it('gives back exactly what the earn gave, never a recomputation', () => {
    expect(reversalOf(20)).toBe(-20)
    /* Idempotent on a figure that is already negative, so a caller passing the
       reversal's own points does not flip it back to a credit. */
    expect(reversalOf(-20)).toBe(-20)
  })

  it('does not let a movement in the exchange rate change what comes back', () => {
    const kenyan = { currency: 'KES' }
    const earned = earnOnSpend({
      spend: 12.50, paidIn: 'USD', member: kenyan, rates: RATES, fxRate: 128.45, multiplier: 1.25,
    })
    /* The shilling weakens between the purchase and the refund. The customer
       neither profits nor loses by returning the item. */
    const later = earnOnSpend({
      spend: 12.50, paidIn: 'USD', member: kenyan, rates: RATES, fxRate: 140.00, multiplier: 1.25,
    })
    expect(later.points).toBeGreaterThan(earned.points)
    expect(reversalOf(earned.points)).toBe(-20)
  })
})

describe('ladderIn', () => {
  const indian = { kind: 'consumer', currency: 'INR' }

  it('gives the member the rungs set for their own currency', () => {
    expect(ladderIn(RETAIL, THRESHOLDS, indian).map(t => t.qualify_spend))
      .toEqual([0, 50000, 150000, 400000])
  })

  it('leaves the business ladder out of a retail member’s rungs', () => {
    expect(ladderIn(RUNGS, THRESHOLDS, indian).map(t => t.id))
      .toEqual(['bronze', 'silver', 'gold', 'platinum'])
  })

  it('keeps a rung with no threshold in this currency rather than zeroing it', () => {
    /* Zero reads as "already qualified" and quietly promotes somebody. */
    expect(ladderIn(RETAIL, THRESHOLDS, { kind: 'consumer', currency: 'KES' })
      .map(t => t.qualify_spend)).toEqual(RETAIL.map(t => t.qualify_spend))
  })

  it('is what stops a rupee customer being told she is at the top', () => {
    /* ₹187,127 is past every dollar rung — $0, $600, $1,800, $4,500 — so an
       unscoped ladder says there is nothing above Gold. */
    const her = { tier: 'gold', qualify_12m: 187127 }
    expect(nextRung(RETAIL, her).next).toBeNull()
    expect(nextRung(ladderIn(RETAIL, THRESHOLDS, indian), her).next?.id).toBe('platinum')
  })
})

describe('earnLine', () => {
  it('says it the way a customer reads it in their own market', () => {
    expect(earnLine(rateFor(RATES, 'INR')!)).toBe('1 point per 100 spent')
    expect(earnLine(rateFor(RATES, 'INR')!, 1.5)).toBe('1.5 points per 100 spent')
  })

  it('flips to points-per-unit where a unit earns more than one', () => {
    expect(earnLine(rateFor(RATES, 'USD')!)).toBe('1 point per 1 spent')
    expect(earnLine(rateFor(RATES, 'USD')!, 2)).toBe('2 points per 1 spent')
  })

  it('does not write a currency of its own — the caller formats the figure', () => {
    /* The stored tier prose used to say "Earn 1.5 points per $1", which is
       wrong in three of the four currencies the marketplace trades in. */
    for (const r of RATES) expect(earnLine(r, 1.5)).not.toMatch(/[$₹]|AED|KSh/)
  })
})

/* Three things multiply and they are easy to mistake for one. I reported
   thirteen ledger rows as "three times or more what the rate tables allow" by
   comparing against the currency rate alone — on that arithmetic a Gold
   customer during a triple-points window looks like a fraud, and the rows that
   stood out loudest were the ones where the promotion was working. */
describe('what an order earns under a rule', () => {
  const inr: PointRate = { currency: 'INR', earn_per_unit: 0.01, per_unit: 1 }
  const plain = { rate: 1.0, bonus: null, cap_per_order: null }

  it('multiplies the currency rate, the rule rate and the tier together', () => {
    /* ₹10,000 at a point per hundred is 100; doubled by the rule is 200; Gold's
       1.5x makes 300. Checking the whole chain rather than each link, because
       the defect was a caller that used one of the three. */
    expect(earnedOn({ amount: 10000, rate: inr, rule: { ...plain, rate: 2.0 }, multiplier: 1.5 }))
      .toBe(300)
  })

  it('is the base earn when the rule and the tier are both neutral', () => {
    expect(earnedOn({ amount: 10000, rate: inr, rule: plain, multiplier: 1 })).toBe(100)
  })

  it('gives a Gold member more than a Bronze one on the same money', () => {
    const gold = earnedOn({ amount: 10000, rate: inr, rule: plain, multiplier: 1.5 })
    const bronze = earnedOn({ amount: 10000, rate: inr, rule: plain, multiplier: 1.0 })
    expect(gold).toBeGreaterThan(bronze)
  })

  it('adds a flat bonus on top of the multiplied figure', () => {
    expect(earnedOn({ amount: 10000, rate: inr, rule: { ...plain, bonus: 750 }, multiplier: 1 }))
      .toBe(850)
  })

  it('stops at the per-order cap', () => {
    expect(earnedOn({ amount: 999999, rate: inr, rule: { ...plain, cap_per_order: 1200 }, multiplier: 2 }))
      .toBe(1200)
  })

  /* Floored, not rounded — the rule `pointsFor` already establishes, inherited
     rather than restated so the two cannot disagree. */
  it('floors rather than rounding, like the base rate does', () => {
    expect(earnedOn({ amount: 3188.79, rate: { ...inr, earn_per_unit: 0.01 }, rule: plain, multiplier: 1.25 }))
      .toBe(39)
  })

  it('never returns less than nothing', () => {
    expect(earnedOn({ amount: 0, rate: inr, rule: plain, multiplier: 1.5 })).toBe(0)
    expect(earnedOn({ amount: 100, rate: null, rule: plain, multiplier: 1.5 })).toBe(0)
  })
})

describe('a monthly ceiling', () => {
  it('lets the first orders earn in full', () => {
    expect(withinMonthlyCap(500, 0, 5000)).toBe(500)
  })

  it('takes only what is left once the month is nearly spent', () => {
    expect(withinMonthlyCap(500, 4800, 5000)).toBe(200)
  })

  it('gives nothing once the ceiling is reached, rather than a negative', () => {
    expect(withinMonthlyCap(500, 5000, 5000)).toBe(0)
    expect(withinMonthlyCap(500, 6000, 5000)).toBe(0)
  })

  it('is no ceiling at all where the rule sets none', () => {
    expect(withinMonthlyCap(99999, 100000, null)).toBe(99999)
  })
})

describe('the cash on a reversal', () => {
  /* The half that is easy to get wrong by symmetry. Points flip; money does
     not. */
  it('stays a magnitude while the points flip', () => {
    expect(reversalOf(680)).toBe(-680)
    expect(reversalValueOf(680)).toBe(680)
    expect(reversalValueOf(-680)).toBe(680)
  })
})
