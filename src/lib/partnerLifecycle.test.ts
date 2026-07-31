import { describe, it, expect } from 'vitest'
import {
  canMove, findTransition, transitionsFrom, orderedHistory, statusMeaning,
  TRANSITIONS, PARTNER_STATUSES,
  type PartnerStatus, type LifecycleEvent,
} from './partnerLifecycle'

const cleared = (n: number) => Array(n).fill('cleared')
const ctx = (gateStatuses: string[], reason = 'Reviewed and agreed at the desk') => ({ gateStatuses, reason })

describe('canMove', () => {
  it('allows a move the ladder defines', () => {
    const v = canMove('live', 'suspended', ctx(cleared(7)))
    expect(v.ok).toBe(true)
    if (v.ok) expect(v.transition.suspendsListings).toBe(true)
  })

  it('refuses a move nothing defines, and says what is available instead', () => {
    const v = canMove('suspended', 'rejected', ctx(cleared(7)))
    expect(v.ok).toBe(false)
    if (!v.ok) expect(v.reason).toMatch(/from suspended the moves are: live/i)
  })

  it('refuses a move to the state it is already in', () => {
    const v = canMove('live', 'live', ctx(cleared(7)))
    expect(v.ok).toBe(false)
    if (!v.ok) expect(v.reason).toMatch(/already live/)
  })

  /* The rule the whole funnel rests on. */
  it('will not publish a seller live with gates outstanding', () => {
    const v = canMove('onboarding', 'live', ctx([...cleared(4), 'current', 'pending', 'pending']))
    expect(v.ok).toBe(false)
    if (!v.ok) expect(v.reason).toMatch(/3 of 7 gates are not cleared/)
  })

  it('will not publish a seller with no onboarding record at all', () => {
    const v = canMove('onboarding', 'live', ctx([]))
    expect(v.ok).toBe(false)
    if (!v.ok) expect(v.reason).toMatch(/no onboarding record/)
  })

  it('publishes live once every gate is cleared', () => {
    expect(canMove('review', 'live', ctx(cleared(7))).ok).toBe(true)
  })

  /* Moves that do not open a storefront are not gated on the funnel — holding
     an application for review must not need the gates it is being held on. */
  it('does not require cleared gates for a move that opens nothing', () => {
    expect(canMove('onboarding', 'review', ctx(['current', 'pending'])).ok).toBe(true)
  })

  it('requires a stated reason for every move', () => {
    const v = canMove('live', 'suspended', ctx(cleared(7), '   '))
    expect(v.ok).toBe(false)
    if (!v.ok) expect(v.reason).toMatch(/reason is required/i)
  })
})

describe('the transition table', () => {
  /* A state with no way out is a partner nobody can ever act on again. */
  it('leaves no status stranded', () => {
    PARTNER_STATUSES.forEach(s => {
      expect(transitionsFrom(s).length, `${s} has no move out of it`).toBeGreaterThan(0)
    })
  })

  it('only ever names real statuses', () => {
    TRANSITIONS.forEach(t => {
      expect(PARTNER_STATUSES).toContain(t.from)
      expect(PARTNER_STATUSES).toContain(t.to)
    })
  })

  /* Reapplying is a new application, not a resumed one — so the only path out
     of `rejected` goes back to the first gate. */
  it('sends a rejected seller back to the start and nowhere else', () => {
    expect(transitionsFrom('rejected').map(t => t.to)).toEqual(['onboarding'])
  })

  /* Reinstating must not silently put unreviewed stock back on sale. */
  it('does not restore listings when a suspended seller is reinstated', () => {
    const t = findTransition('suspended', 'live')!
    expect(t.suspendsListings).toBeFalsy()
    expect(t.effect).toMatch(/stay down/i)
  })

  it('states an effect for every move', () => {
    TRANSITIONS.forEach(t => expect(t.effect.length).toBeGreaterThan(20))
  })
})

describe('orderedHistory', () => {
  const ev = (id: string, at: string): LifecycleEvent => ({
    id, partner_id: 'PTR-1015', from_status: 'live', to_status: 'suspended',
    reason: 'r', actor: 'a', at,
  })

  it('puts the most recent decision first', () => {
    const rows = [ev('a', '2024-01-01'), ev('c', '2026-05-18'), ev('b', '2025-06-01')]
    expect(orderedHistory(rows).map(e => e.id)).toEqual(['c', 'b', 'a'])
  })

  it('does not mutate what it was given', () => {
    const rows = [ev('a', '2024-01-01'), ev('b', '2026-01-01')]
    orderedHistory(rows)
    expect(rows.map(e => e.id)).toEqual(['a', 'b'])
  })
})

describe('statusMeaning', () => {
  it('says something about trading for every status', () => {
    PARTNER_STATUSES.forEach(s => expect(statusMeaning(s as PartnerStatus).length).toBeGreaterThan(10))
  })

  /* The distinction a suspended seller most needs and is most often not told. */
  it('says a suspension does not cancel orders already placed', () => {
    expect(statusMeaning('suspended')).toMatch(/still fulfilled and settled/i)
  })
})
