import { describe, it, expect } from 'vitest'
import { summarise, bySurface, themes, byPersona, triage, canClose, REASONS } from './contentFeedback'
import type { Feedback, Reason, Persona, Surface } from './contentFeedback'

const fb = (over: Partial<Feedback> & Pick<Feedback, 'id'>): Feedback => ({
  surface: 'kb_article' as Surface, ref: 'KB-P02', persona: 'partner' as Persona,
  author: 'A Seller', author_ref: 'PTR-1004', helpful: false,
  reason: 'missing_steps' as Reason, comment: null, submitted: '2026-07-20',
  state: 'new', reviewed_by: null, reviewed_at: null, action_taken: null, sort_order: 0,
  ...over,
})

describe('summarise', () => {
  it('counts both verdicts and what is still owed', () => {
    const s = summarise([
      fb({ id: 'a', helpful: true, reason: 'clear_and_correct' }),
      fb({ id: 'b' }), fb({ id: 'c', state: 'actioned' }),
    ])
    expect(s).toMatchObject({ total: 3, helpful: 1, unhelpful: 2, awaiting: 2, actioned: 1 })
    expect(s.helpfulPct).toBe(33.3)
  })

  it('returns null rather than zero when nothing has come in', () => {
    /* 0% helpful and "nobody has said anything" are different states, and only
       one of them is a failure. */
    expect(summarise([]).helpfulPct).toBeNull()
  })
})

describe('bySurface', () => {
  const items = [
    fb({ id: 'a', ref: 'KB-P02', persona: 'partner', reason: 'contradicts_screen' }),
    fb({ id: 'b', ref: 'KB-P02', persona: 'consumer', reason: 'contradicts_screen' }),
    fb({ id: 'c', ref: 'KB-P02', persona: 'partner', reason: 'too_long' }),
    fb({ id: 'd', ref: 'KB-C01', helpful: true, reason: 'clear_and_correct' }),
    fb({ id: 'e', ref: 'KB-C04', reason: 'out_of_date' }),
  ]

  it('ranks by how many readers were let down, not by percentage', () => {
    /* KB-C01 is 100% helpful and KB-C04 is 0%, but KB-P02 with three
       complaints is the one worth an afternoon. */
    expect(bySurface(items)[0].ref).toBe('KB-P02')
  })

  it('names the commonest complaint on each page', () => {
    expect(bySurface(items).find(r => r.ref === 'KB-P02')!.topReason).toBe('contradicts_screen')
  })

  it('lists which personas complained, because one failing two is different', () => {
    expect(bySurface(items).find(r => r.ref === 'KB-P02')!.personas).toEqual(['consumer', 'partner'])
  })

  it('leaves a page with only praise showing no top complaint', () => {
    const row = bySurface(items).find(r => r.ref === 'KB-C01')!
    expect(row.topReason).toBeNull()
    expect(row.helpfulPct).toBe(100)
  })

  it('keeps the same ref on two surfaces apart', () => {
    const out = bySurface([
      fb({ id: 'x', surface: 'category', ref: 'security' }),
      fb({ id: 'y', surface: 'product', ref: 'security' }),
    ])
    expect(out).toHaveLength(2)
  })

  it('counts what is still awaiting a decision per page', () => {
    expect(bySurface(items).find(r => r.ref === 'KB-P02')!.awaiting).toBe(3)
  })
})

describe('themes', () => {
  const items = [
    fb({ id: 'a', reason: 'out_of_date' }),
    fb({ id: 'b', reason: 'out_of_date', surface: 'category' }),
    fb({ id: 'c', reason: 'too_long' }),
    fb({ id: 'd', helpful: true, reason: 'clear_and_correct' }),
  ]

  it('counts only the complaints — praise is not a theme to fix', () => {
    const out = themes(items)
    expect(out.map(t => t.reason)).toEqual(['out_of_date', 'too_long'])
    expect(out[0].count).toBe(2)
    expect(out[0].pct).toBe(66.7)
  })

  it('carries the remedy, so counting produces work rather than a report', () => {
    expect(themes(items)[0].fix).toBe(REASONS.out_of_date.fix)
  })

  it('says where each theme is happening', () => {
    expect(themes(items)[0].surfaces).toEqual(['category', 'kb_article'])
  })

  it('breaks a tie towards the complaint that misleads over the one that bores', () => {
    const tied = [
      fb({ id: 'a', reason: 'too_long' }),
      fb({ id: 'b', reason: 'contradicts_screen' }),
    ]
    expect(themes(tied)[0].reason).toBe('contradicts_screen')
  })

  it('returns nothing when everybody is happy', () => {
    expect(themes([fb({ id: 'a', helpful: true, reason: 'clear_and_correct' })])).toEqual([])
  })
})

describe('byPersona', () => {
  it('reports each persona that has said something, and skips those that have not', () => {
    const out = byPersona([
      fb({ id: 'a', persona: 'partner' }),
      fb({ id: 'b', persona: 'partner', helpful: true, reason: 'clear_and_correct' }),
      fb({ id: 'c', persona: 'consumer' }),
    ])
    expect(out.map(r => r.persona)).toEqual(['consumer', 'partner'])
    expect(out.find(r => r.persona === 'partner')!.helpfulPct).toBe(50)
  })
})

describe('triage', () => {
  it('puts undecided first — those are the only ones anybody owes anything on', () => {
    const out = triage([
      fb({ id: 'done', state: 'actioned', reason: 'contradicts_screen' }),
      fb({ id: 'open', state: 'new', reason: 'too_long' }),
    ])
    expect(out[0].id).toBe('open')
  })

  it('within the queue, misleading beats merely long', () => {
    const out = triage([
      fb({ id: 'long', reason: 'too_long', submitted: '2026-07-01' }),
      fb({ id: 'wrong', reason: 'contradicts_screen', submitted: '2026-07-20' }),
    ])
    expect(out[0].id).toBe('wrong')
  })

  it('then oldest first, because somebody has been waiting', () => {
    const out = triage([
      fb({ id: 'newer', reason: 'out_of_date', submitted: '2026-07-25' }),
      fb({ id: 'older', reason: 'out_of_date', submitted: '2026-07-02' }),
    ])
    expect(out.map(f => f.id)).toEqual(['older', 'newer'])
  })
})

describe('canClose', () => {
  it('refuses to close without a disposition', () => {
    expect(canClose('new', 'anything').ok).toBe(false)
  })

  it('demands an account of what changed', () => {
    const v = canClose('actioned', '   ')
    expect(!v.ok && v.reason).toMatch(/Say what changed/)
  })

  it('demands a reason for a dismissal, in its own words', () => {
    const v = canClose('declined', '')
    expect(!v.ok && v.reason).toMatch(/comes back as the same complaint/)
  })

  it('accepts a real disposition', () => {
    expect(canClose('actioned', 'Rewrote step two to match the form.')).toEqual({ ok: true })
    expect(canClose('declined', 'Not a content defect — the seller never resubmitted.')).toEqual({ ok: true })
  })
})
