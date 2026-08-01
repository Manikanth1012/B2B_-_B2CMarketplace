import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  KB_KINDS, kbKind, filterArticles, allTags, canAct,
  assetsFor, assetsByKind, assetKind, assetMeta, fileSize, duration,
} from './kb'
import type { KbArticle, KbAsset } from './kb'

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

/* Every published article must point at a view this app actually has. The
   equivalent check caught two faults on the prototype's first run. */
describe('view bindings in the migration', () => {
  const sql = readFileSync('supabase/migrations/20260729120000_knowledge_base.sql', 'utf8')
  const views = readFileSync('src/types/view.ts', 'utf8')
  const known = new Set((views.match(/'[a-z][a-z0-9-]*'/g) || []).map(s => s.replace(/'/g, '')))

  /* Rows are `('id', 'persona', ..., 'view'|NULL, ...)`; pull id/persona/view. */
  const rows = [...sql.matchAll(/^\('([^']+)', '([a-z]+)', '[^']*', '(?:[^']|'')*', \d+, (?:'[^']*'|NULL), (NULL|'[^']+')/gm)]
    .map(m => ({ id: m[1], persona: m[2], view: m[3] === 'NULL' ? null : m[3].replace(/'/g, '') }))

  it('parsed the article rows', () => {
    expect(rows.length).toBeGreaterThanOrEqual(33)
  })

  it('every non-null view is a real view id', () => {
    const bad = rows.filter(r => r.view && !known.has(r.view))
    expect(bad.map(b => `${b.id} -> ${b.view}`)).toEqual([])
  })

  it('a null view is only ever on a held article', () => {
    const published = sql.split('\n').filter(l => l.startsWith("('") && l.includes("'published'"))
    const nullViewPublished = published.filter(l => /, NULL, '\{/.test(l))
    expect(nullViewPublished).toEqual([])
  })
})

/* ------------------------------------------------------------ attachments -- */

function asset(over: Partial<KbAsset> = {}): KbAsset {
  return {
    id: 'KBA-1', article_id: 'KB-B06', kind: 'manual',
    title: 'Cold-chain sensor — installation manual',
    description: 'Placement, bracket, pairing.',
    path: 'nimbus-cold-chain-install.pdf', url: null, mime: 'application/pdf',
    bytes: 5580, duration_secs: null, pages: 3, language: 'English',
    updated: '2026-08-01', sort_order: 1, ...over,
  }
}

const VIDEO = asset({ id: 'KBA-2', kind: 'video', title: 'Mounting a sensor', mime: 'video/mp4', bytes: 94613, duration_secs: 128, pages: null, sort_order: 2 })
const SHEET = asset({ id: 'KBA-3', kind: 'datasheet', title: 'NS-CC200 datasheet', bytes: 3016, pages: 2, sort_order: 3 })
const OTHER = asset({ id: 'KBA-4', article_id: 'KB-B02', kind: 'template', title: 'Checklist', mime: 'text/csv', bytes: 646, pages: null, sort_order: 1 })
const ASSETS = [SHEET, asset(), VIDEO, OTHER]

describe('article attachments', () => {
  it('gives an article its own files, in the order the operator set', () => {
    expect(assetsFor(ASSETS, 'KB-B06').map(a => a.id)).toEqual(['KBA-1', 'KBA-2', 'KBA-3'])
    expect(assetsFor(ASSETS, 'KB-B02').map(a => a.id)).toEqual(['KBA-4'])
    expect(assetsFor(ASSETS, 'KB-NOPE')).toEqual([])
  })

  it('groups by kind in the fixed order, skipping the empty groups', () => {
    const groups = assetsByKind(assetsFor(ASSETS, 'KB-B06'))
    expect(groups.map(g => g.kind)).toEqual(['manual', 'datasheet', 'video'])
    expect(groups.map(g => g.label)).toEqual(['Manuals and guides', 'Datasheets', 'Videos'])
    expect(groups.every(g => g.assets.length > 0)).toBe(true)
  })

  it('falls back rather than losing a file with an unfamiliar kind', () => {
    expect(assetKind('nonesuch').id).toBe('other')
    expect(assetKind('video').label).toBe('Video')
  })

  /* What a reader wants before clicking, not after. */
  it('prints a video’s running time and a document’s page count', () => {
    expect(assetMeta(VIDEO)).toBe('Video · 2:08 · 95 kB · updated 01 Aug 2026')
    expect(assetMeta(asset())).toBe('Manual · 3 pages · 5.6 kB · updated 01 Aug 2026')
    expect(assetMeta(OTHER)).toBe('Template · 646 B · updated 01 Aug 2026')
  })

  it('says the language only when it is not the one you are reading in', () => {
    expect(assetMeta(asset({ language: 'English' }))).not.toMatch(/English/)
    expect(assetMeta(asset({ language: 'हिन्दी' }))).toMatch(/हिन्दी/)
  })

  it('writes a single page without an s', () => {
    expect(assetMeta(asset({ pages: 1 }))).toMatch(/1 page ·/)
    expect(assetMeta(asset({ updated: null }))).not.toMatch(/updated/)
  })

  it('reads sizes the way a file manager does', () => {
    expect(fileSize(5580)).toBe('5.6 kB')
    expect(fileSize(1_200_000)).toBe('1.2 MB')
    expect(fileSize(646)).toBe('646 B')
    expect(fileSize(0)).toBe('—')
  })

  it('writes a running time, and not as a timestamp under a minute', () => {
    expect(duration(128)).toBe('2:08')
    expect(duration(600)).toBe('10:00')
    expect(duration(45)).toBe('45 sec')
    expect(duration(0)).toBe('—')
  })
})
