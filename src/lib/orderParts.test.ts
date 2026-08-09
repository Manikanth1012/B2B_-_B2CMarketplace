import { describe, it, expect } from 'vitest'
import {
  RAIL, labelFor, progressOf, onRail, orderStateFrom, summaryOf,
  nextFor, canMove, partsOf, mine, awaiting,
} from './orderParts'
import type { Part, PartState, FulfilKind } from './orderParts'

const part = (over: Partial<Part> = {}): Part => ({
  id: 'ORD-1-1', order_id: 'o1', seller: 'Kestrel Devices', partner_id: 'PTR-1002',
  kind: 'shipped', state: 'placed', carrier: null, tracking_ref: null,
  despatched_on: null, delivered_on: null, sort_order: 1, ...over,
})

describe('the journey each kind of part is on', () => {
  /* Two rails, not five. The differences between an eSIM and a managed firewall
     are in what the words mean, not in the shape of the journey. */
  it('ships one way and switches on the other', () => {
    expect(RAIL.shipped).toEqual(['placed', 'packed', 'in transit', 'delivered'])
    for (const k of ['instant', 'esim', 'provisioned', 'activation'] as FulfilKind[]) {
      expect(RAIL[k], k).toEqual(['placed', 'activating', 'active'])
    }
  })

  /* A buyer reads "Active on your line" about an eSIM and "Delivered" about a
     handset. One word for both is a word that is wrong about one of them. */
  it('names a state in the words its own kind uses', () => {
    expect(labelFor({ kind: 'shipped', state: 'delivered' })).toBe('Delivered')
    expect(labelFor({ kind: 'esim', state: 'active' })).toBe('Active on your line')
    expect(labelFor({ kind: 'provisioned', state: 'active' })).toBe('In service')
    expect(labelFor({ kind: 'shipped', state: 'failed' })).toBe('Could not be fulfilled')
  })

  it('places a part on its own rail and knows when it is off it', () => {
    expect(progressOf({ kind: 'shipped', state: 'in transit' })).toEqual({ at: 2, of: 4 })
    expect(progressOf({ kind: 'esim', state: 'active' })).toEqual({ at: 2, of: 3 })
    expect(onRail({ kind: 'shipped', state: 'delivered' })).toBe(true)
    expect(onRail({ kind: 'shipped', state: 'failed' })).toBe(false)
    /* A shipped part cannot be 'active' — the constraint refuses it, and this
       is what stops a screen drawing it at position zero as if it were fine. */
    expect(onRail({ kind: 'shipped', state: 'active' })).toBe(false)
  })
})

/* The defect this whole change is about: an order with one status, over parts
   that are doing different things. */
describe('what the whole order amounts to', () => {
  const states = (...s: PartState[]) => s.map(state => ({ state }))

  it('is delivered only when every part is done', () => {
    expect(orderStateFrom(states('delivered', 'active'))).toBe('delivered')
    expect(orderStateFrom(states('active', 'active'))).toBe('active')
    /* The handset arrived; the eSIM has not activated. Saying "delivered" here
       is the sentence that started this. */
    expect(orderStateFrom(states('delivered', 'activating'))).toBe('processing')
  })

  it('reports the part that is furthest along the road, not the furthest behind', () => {
    expect(orderStateFrom(states('placed', 'in transit'))).toBe('in transit')
    expect(orderStateFrom(states('placed', 'packed'))).toBe('packed')
  })

  /* "Failed" on an order where the handset arrived and the insurance did not is
     a worse answer than either half of it. */
  it('says partly-failed rather than choosing a half to believe', () => {
    expect(orderStateFrom(states('delivered', 'failed'))).toBe('partly-failed')
    expect(orderStateFrom(states('failed', 'failed'))).toBe('failed')
    expect(orderStateFrom(states('refunded', 'refunded'))).toBe('refunded')
  })

  it('is placed when there is nothing on it', () => {
    expect(orderStateFrom([])).toBe('placed')
  })

  /* Three orders said `in transit` with nothing on them that ships. Nothing
     derived from parts can, because no part of theirs is ever in transit. */
  it('cannot be in transit when no part of it ships', () => {
    expect(orderStateFrom(states('activating', 'placed'))).toBe('processing')
    expect(orderStateFrom(states('active', 'active'))).not.toBe('in transit')
  })
})

describe('the sentence a buyer reads', () => {
  it('says the one thing where there is only one part', () => {
    expect(summaryOf([part({ kind: 'esim', state: 'active' })])).toBe('Active on your line')
  })

  it('counts the parts where they disagree', () => {
    const two = [
      part({ id: 'p1', kind: 'shipped', state: 'delivered' }),
      part({ id: 'p2', kind: 'esim', state: 'activating' }),
    ]
    expect(summaryOf(two)).toBe('1 of 2 parts complete · activating')
  })

  it('names the failure rather than burying it in a count', () => {
    const two = [
      part({ id: 'p1', kind: 'shipped', state: 'delivered' }),
      part({ id: 'p2', kind: 'instant', state: 'failed' }),
    ]
    expect(summaryOf(two)).toMatch(/could not be fulfilled/)
  })

  it('says so plainly when everything is done', () => {
    expect(summaryOf([
      part({ id: 'p1', state: 'delivered' }),
      part({ id: 'p2', kind: 'instant', state: 'active' }),
    ])).toBe('All 2 parts complete')
  })
})

describe('moving a part', () => {
  const ME = { partner_id: 'PTR-1002' }

  it('moves one step along its own rail and no further', () => {
    expect(nextFor({ kind: 'shipped', state: 'placed' })).toBe('packed')
    expect(nextFor({ kind: 'esim', state: 'activating' })).toBe('active')
    expect(nextFor({ kind: 'shipped', state: 'delivered' })).toBeNull()
  })

  /* The security half. Kestrel could mark PlayForge's game delivered because
     the policy was written over the whole order. */
  it('refuses a seller the other seller\'s part', () => {
    const theirs = part({ partner_id: 'PTR-1009', seller: 'PlayForge Games' })
    const out = canMove(theirs, 'packed', ME)
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.reason).toMatch(/another seller's/)
  })

  it('lets the operator move any of them', () => {
    const theirs = part({ partner_id: 'PTR-1009' })
    expect(canMove(theirs, 'packed', { partner_id: null, operator: true }).ok).toBe(true)
  })

  it('refuses a jump past a step', () => {
    const out = canMove(part({ state: 'placed' }), 'delivered', ME)
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.reason).toMatch(/one step at a time/)
  })

  /* "On its way" with nothing to track is a status a buyer cannot act on. */
  it('will not send a parcel on its way without a tracking number', () => {
    const packed = part({ state: 'packed', tracking_ref: null })
    const out = canMove(packed, 'in transit', ME)
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.reason).toMatch(/tracking number/)
    expect(canMove({ ...packed, tracking_ref: 'RM123' }, 'in transit', ME).ok).toBe(true)
  })

  it('does not revive a part that failed or was refunded', () => {
    expect(canMove(part({ state: 'failed' }), 'packed', ME).ok).toBe(false)
    expect(canMove(part({ state: 'refunded' }), 'packed', ME).ok).toBe(false)
  })
})

describe('picking parts out', () => {
  const all = [
    part({ id: 'a', order_id: 'o1', sort_order: 2, partner_id: 'PTR-1002' }),
    part({ id: 'b', order_id: 'o1', sort_order: 1, partner_id: 'PTR-1009' }),
    part({ id: 'c', order_id: 'o2', sort_order: 1, partner_id: 'PTR-1002' }),
  ]

  it('gives one order its parts in a settled order', () => {
    expect(partsOf(all, 'o1').map(p => p.id)).toEqual(['b', 'a'])
  })

  it('gives a seller their own across every order', () => {
    expect(mine(all, 'PTR-1002').map(p => p.id)).toEqual(['a', 'c'])
  })

  it('queues what still needs doing, least advanced first', () => {
    const queue = awaiting([
      part({ id: 'done', state: 'delivered' }),
      part({ id: 'gone', state: 'failed' }),
      part({ id: 'mid', state: 'packed' }),
      part({ id: 'new', state: 'placed' }),
    ])
    expect(queue.map(p => p.id)).toEqual(['new', 'mid'])
  })
})
