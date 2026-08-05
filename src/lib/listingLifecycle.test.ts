/* The life of a listing after it is published. My Listings used to show a state
   and offer no way to change it. */
import { describe, it, expect } from 'vitest'
import {
  stateOf, isSelling, sellerMayMoveTo, canMove, validatePause, validateRetire,
  validateGoLive, validateGoLiveFor, stateAfterApproval, untilLive, MAX_SCHEDULE_DAYS,
  changesIn, validateProposal, nextVersion, pendingVersion, canPropose,
  STATE_MEANING,
} from './listingLifecycle'
import type { Listing, ProductVersion, ListingState } from './listingLifecycle'

const listing = (over: Partial<Listing> = {}): Listing => ({
  id: 'SKU-5003', name: 'Nimbus Cold-chain sensor', status: 'live', ...over,
})

const version = (over: Partial<ProductVersion> = {}): ProductVersion => ({
  id: 'PV-1', product_id: 'SKU-5003', version: 1, state: 'pending',
  proposed: {}, was: {}, note: 'Corrected the battery life.',
  submitted_by: 'Rajesh Kumar', submitted_at: '2026-08-05T09:00:00Z',
  decided_by: null, decided_at: null, decision_reason: null, ...over,
})

const TODAY = '2026-08-05'

describe('what a state means', () => {
  it('knows which states put something in front of a buyer', () => {
    expect(isSelling(listing({ status: 'live' }))).toBe(true)
    for (const s of ['draft', 'pending', 'rejected', 'scheduled', 'paused', 'suspended', 'retired']) {
      expect(isSelling(listing({ status: s }))).toBe(false)
    }
  })

  it('distinguishes the seller taking it down from the marketplace doing so', () => {
    /* Collapsing these would let a seller clear a suspension by pausing and
       resuming. They are not the same event and they do not read the same. */
    expect(STATE_MEANING.paused.says).toMatch(/You took it off sale/)
    expect(STATE_MEANING.suspended.says).toMatch(/Only they can put it back/)
  })

  it('falls back to draft rather than inventing a state', () => {
    expect(stateOf(listing({ status: 'nonsense' }))).toBe('draft')
  })
})

describe('what a seller may do', () => {
  it('lets a live listing be paused or retired, and nothing else', () => {
    expect(sellerMayMoveTo(listing({ status: 'live' }))).toEqual(['paused', 'retired'])
  })

  it('lets a paused listing come back', () => {
    expect(canMove(listing({ status: 'paused' }), 'live').ok).toBe(true)
  })

  it('refuses to let a seller lift their own suspension, and says who can', () => {
    const r = canMove(listing({ status: 'suspended' }), 'live')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/Disputes & Support/)
  })

  it('refuses suspension as a destination for anybody selling', () => {
    const r = canMove(listing({ status: 'live' }), 'suspended')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/Only the marketplace/)
  })

  it('treats retirement as the end', () => {
    expect(sellerMayMoveTo(listing({ status: 'retired' }))).toEqual([])
    const r = canMove(listing({ status: 'retired' }), 'live')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/final/)
  })

  it('says so rather than pretending, when it is already in that state', () => {
    const r = canMove(listing({ status: 'paused' }), 'paused')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/already paused/)
  })

  it('lets a refused listing be submitted again', () => {
    expect(canMove(listing({ status: 'rejected' }), 'pending').ok).toBe(true)
  })
})

describe('taking one off sale', () => {
  it('insists on a reason somebody else can read', () => {
    expect(validatePause('  ').ok).toBe(false)
    expect(validatePause('Cell supplier delayed to September').ok).toBe(true)
  })

  it('makes retiring harder than pausing, and says what it costs', () => {
    const l = listing()
    expect(validateRetire('Discontinued', 'wrong name', l).ok).toBe(false)
    const r = validateRetire('Discontinued', 'nimbus cold-chain sensor', l)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.note).toMatch(/Past orders/)
  })

  it('points somebody who meant to pause at pausing', () => {
    const r = validateRetire('Out of stock', '', listing())
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/pause it instead/)
  })
})

describe('when it goes on sale', () => {
  it('treats empty as "as soon as it is approved"', () => {
    const r = validateGoLive('', TODAY)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.note).toMatch(/as soon as/)
  })

  it('refuses a date that has passed rather than publishing at once', () => {
    /* Almost always a mistyped year, and honouring it would publish something
       the seller thought they had a week to finish. */
    const r = validateGoLive('2026-08-04', TODAY)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/has passed/)
  })

  it('allows today', () => {
    expect(validateGoLive(TODAY, TODAY).ok).toBe(true)
  })

  it('refuses a date that is somebody’s typo rather than their plan', () => {
    const r = validateGoLive('2028-08-05', TODAY)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(new RegExp(`more than a year`))
  })

  it('accepts the last day inside the window', () => {
    const edge = new Date(Date.UTC(2026, 7, 5) + MAX_SCHEDULE_DAYS * 86_400_000)
      .toISOString().slice(0, 10)
    expect(validateGoLive(edge, TODAY).ok).toBe(true)
  })

  it('refuses something that is not a date at all', () => {
    expect(validateGoLive('next tuesday', TODAY).ok).toBe(false)
    expect(validateGoLive('2026-13-40', TODAY).ok).toBe(false)
  })

  it('refuses to take a listing that is selling off sale by typing a date', () => {
    /* Found in the browser: setting a future date on a live listing asked the
       database for live → scheduled, which the guard refuses. The move is not
       the problem — a listing going dark with no reason written on it is. */
    const r = validateGoLiveFor(listing({ status: 'live' }), '2026-08-20', TODAY)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/Pause it with a reason first/)
  })

  it('lets a live listing keep a date it has already passed, and clear one', () => {
    expect(validateGoLiveFor(listing({ status: 'live' }), '', TODAY).ok).toBe(true)
    expect(validateGoLiveFor(listing({ status: 'live' }), TODAY, TODAY).ok).toBe(true)
  })

  it('allows a future date on anything that is not already selling', () => {
    for (const s of ['paused', 'scheduled', 'pending', 'draft', 'rejected'] as ListingState[]) {
      expect(validateGoLiveFor(listing({ status: s }), '2026-08-20', TODAY).ok).toBe(true)
    }
  })

  it('still refuses a date that is nonsense whatever the state', () => {
    const r = validateGoLiveFor(listing({ status: 'paused' }), '2026-08-04', TODAY)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/has passed/)
  })

  it('decides where an approved listing lands', () => {
    expect(stateAfterApproval(null, TODAY)).toBe('live')
    expect(stateAfterApproval(TODAY, TODAY)).toBe('live')
    expect(stateAfterApproval('2026-09-01', TODAY)).toBe('scheduled')
  })

  it('counts the wait in days rather than showing a bare date', () => {
    expect(untilLive('2026-08-06', TODAY)).toBe('Goes live tomorrow')
    expect(untilLive('2026-08-12', TODAY)).toBe('Goes live in 7 days')
    expect(untilLive(TODAY, TODAY)).toBeNull()
    expect(untilLive(null, TODAY)).toBeNull()
  })
})

describe('proposing a change to something that is selling', () => {
  const was = { name: 'Nimbus Cold-chain sensor', description: 'Five-year cell.', stock: 'in', tags: ['iot'] }

  it('reports only what differs', () => {
    /* A review screen showing every field with most of them identical is one
       where the reviewer skims and misses the one that matters. */
    const out = changesIn({ description: 'Seven-year cell.', stock: 'in' }, was)
    expect(out.map(c => c.key)).toEqual(['description'])
    expect(out[0].from).toBe('Five-year cell.')
    expect(out[0].to).toBe('Seven-year cell.')
  })

  it('reads a list and an empty value legibly', () => {
    const out = changesIn({ tags: ['iot', 'cold-chain'], description: '' }, was)
    expect(out.find(c => c.key === 'tags')?.to).toBe('iot, cold-chain')
    expect(out.find(c => c.key === 'description')?.to).toBe('—')
  })

  it('ignores a field that was not proposed at all', () => {
    expect(changesIn({}, was)).toEqual([])
  })

  it('refuses a proposal that proposes nothing', () => {
    const r = validateProposal([], 'Tidying up')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/Nothing is different/)
  })

  it('insists on a reason, because the desk decides from it', () => {
    const changes = changesIn({ description: 'New words.' }, was)
    expect(validateProposal(changes, '').ok).toBe(false)
    const r = validateProposal(changes, 'Battery life corrected after retest.')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.note).toMatch(/keeps selling/)
  })

  it('numbers versions from the highest already used', () => {
    expect(nextVersion([version({ version: 1 }), version({ id: 'PV-2', version: 4 })])).toBe(5)
    expect(nextVersion([])).toBe(1)
  })

  it('finds the one waiting on the desk', () => {
    const vs = [version({ state: 'published' }), version({ id: 'PV-2', version: 2 })]
    expect(pendingVersion(vs)?.id).toBe('PV-2')
    expect(pendingVersion([version({ state: 'published' })])).toBeNull()
  })

  it('allows one change in flight at a time, and says why', () => {
    /* Two pending versions of one listing is a queue whose order decides the
       outcome, and nobody reading the review screen would know that. */
    const r = canPropose(listing(), [version()])
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/already waiting/)
    expect(canPropose(listing(), [version({ state: 'published' })]).ok).toBe(true)
  })

  it('refuses a change to something suspended, which has nothing to publish to', () => {
    const r = canPropose(listing({ status: 'suspended' }), [])
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/suspended/)
  })

  it('sends somebody with a submission still in review back to that', () => {
    const r = canPropose(listing({ status: 'pending' }), [])
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/Withdraw that submission/)
  })

  it('allows a change to a paused or scheduled listing', () => {
    for (const s of ['paused', 'scheduled'] as ListingState[]) {
      expect(canPropose(listing({ status: s }), []).ok).toBe(true)
    }
  })
})
