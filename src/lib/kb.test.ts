import { describe, it, expect } from 'vitest'
import { KB_KINDS, kbKind, filterArticles, allTags, canAct } from './kb'
import type { KbArticle } from './kb'

const art = (over: Partial<KbArticle> = {}): KbArticle => ({
  id: 'KB-1', persona: 'operator', kind: 'howto', title: 'Onboard a seller',
  mins: 5, updated: '21 Jul 2026', view: 'op-onboarding',
  roles: [], tags: ['partners', 'onboarding'],
  summary: 'How the seven gates work', body: [['Why', 'Because']],
  status: 'published', sort_order: 0, ...over,
})

describe('KB_KINDS', () => {
  it('declares the five kinds in the prototype order', () => {
    expect(KB_KINDS.map(k => k.id)).toEqual(['start', 'howto', 'concept', 'policy', 'fix'])
  })

  it('falls back for an unknown kind rather than throwing', () => {
    expect(kbKind('nonsense').label).toBe('nonsense')
    expect(kbKind('howto').label).toBe('How to')
  })
})

describe('filterArticles', () => {
  const all = [
    art(),
    art({ id: 'KB-2', kind: 'policy', title: 'Listing rules', tags: ['catalogue'], summary: 'What is checked' }),
    art({ id: 'KB-3', kind: 'howto', title: 'Run a settlement', tags: ['finance'], summary: 'Paying out to accounts' }),
  ]

  it('returns everything when nothing is set', () => {
    expect(filterArticles(all, {}).length).toBe(3)
  })

  it('filters by kind', () => {
    expect(filterArticles(all, { kind: 'howto' }).map(a => a.id)).toEqual(['KB-1', 'KB-3'])
  })

  it('filters by tag', () => {
    expect(filterArticles(all, { tag: 'finance' }).map(a => a.id)).toEqual(['KB-3'])
  })

  it('searches title and summary, case-insensitively', () => {
    expect(filterArticles(all, { q: 'SELLER' }).map(a => a.id)).toEqual(['KB-1'])
    expect(filterArticles(all, { q: 'paying' }).map(a => a.id)).toEqual(['KB-3'])
  })

  it('combines kind and search', () => {
    expect(filterArticles(all, { kind: 'howto', q: 'settlement' }).map(a => a.id)).toEqual(['KB-3'])
  })

  it('returns nothing when the search matches nothing', () => {
    expect(filterArticles(all, { q: 'zzzz' })).toEqual([])
  })
})

describe('allTags', () => {
  it('returns a sorted unique list', () => {
    expect(allTags([art(), art({ tags: ['finance', 'partners'] })])).toEqual(['finance', 'onboarding', 'partners'])
  })
})

describe('canAct', () => {
  it('is true when the article names no roles — everyone may act', () => {
    expect(canAct(art({ roles: [] }), null)).toBe(true)
    expect(canAct(art({ roles: [] }), 'OR-ADMIN')).toBe(true)
  })

  it('is true when my role is named', () => {
    expect(canAct(art({ roles: ['OR-ADMIN'] }), 'OR-ADMIN')).toBe(true)
  })

  it('is false when my role is not named', () => {
    expect(canAct(art({ roles: ['OR-ADMIN'] }), 'OR-VIEW')).toBe(false)
  })

  it('is true when my role is unknown — reading is never gated', () => {
    expect(canAct(art({ roles: ['OR-ADMIN'] }), null)).toBe(true)
  })
})
