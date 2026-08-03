import { describe, it, expect } from 'vitest'
import {
  offeredTo, worthOf, mostRedeemable, validateRedemption, canRedeemAnything,
  ladderFor, rungOf, rungState, nextRung,
  fmtPoints, fmtMoney,
} from './loyalty'
import type { Member, Programme, RedeemOption } from './loyalty'

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
    id: 'LM-4001', name: 'Priya Raman', kind: 'consumer', tier: 'gold', balance: 12400,
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
  const priya = { tier: 'gold', kind: 'consumer', qualify_12m: 2500 }

  it('finds the rung by id', () => {
    expect(rungOf(RUNGS, priya)?.id).toBe('gold')
  })

  it('will not find a rung from the other ladder', () => {
    expect(rungOf(RUNGS, { tier: 'org-gold', kind: 'consumer' })).toBeNull()
  })

  /* The defect this is really about: rank is unique only within one ladder,
     so comparing sort_order marked Gold *and* Business Plus as "here". */
  it('marks exactly one rung as here', () => {
    const current = rungOf(RUNGS, priya)
    const here = RUNGS.filter(t => rungState(t, current) === 'here')
    expect(here.map(t => t.id)).toEqual(['gold'])
  })

  it('calls the rungs below past and the rungs above future', () => {
    const current = rungOf(RUNGS, priya)
    const ladder = ladderFor(RUNGS, 'consumer')
    expect(ladder.map(t => rungState(t, current))).toEqual(['past', 'past', 'here', 'future'])
  })

  it('calls everything future when the member is on no known rung', () => {
    expect(rungState(RUNGS[0], null)).toBe('future')
  })
})

describe('what the next rung costs', () => {
  it('names the next rung on the member’s own ladder', () => {
    expect(nextRung(RUNGS, { tier: 'gold', kind: 'consumer', qualify_12m: 2500 }).next?.id)
      .toBe('platinum')
  })

  it('measures the gap from the rung below, not from zero', () => {
    /* Gold is $1,800, Platinum $4,500, and this member has spent $2,500. That
       is 700 of a 2,700 span — 26%. Measured from zero it would read 56%,
       which flatters a member who has only just arrived. */
    const p = nextRung(RUNGS, { tier: 'gold', kind: 'consumer', qualify_12m: 2500 })
    expect(p.need).toBe(2000)
    expect(p.pct).toBe(26)
  })

  it('is complete at the top of the ladder', () => {
    const p = nextRung(RUNGS, { tier: 'platinum', kind: 'consumer', qualify_12m: 9000 })
    expect(p).toEqual({ next: null, need: 0, pct: 100 })
  })

  it('never reports a negative gap or a percentage past 100', () => {
    const p = nextRung(RUNGS, { tier: 'bronze', kind: 'consumer', qualify_12m: 100000 })
    expect(p.need).toBeGreaterThanOrEqual(0)
    expect(p.pct).toBeLessThanOrEqual(100)
  })
})
