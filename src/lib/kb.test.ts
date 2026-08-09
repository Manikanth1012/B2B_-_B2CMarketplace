import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  addressedTo, visibleTo, KB_KINDS, kbKind, filterArticles, allTags, canAct,
  assetsFor, assetsByKind, assetKind, assetMeta, fileSize, duration,
  publishedTo, personaLabel, faqsFor, faqsByTopic, searchFaqs, helpfulness,
  validateAudience, validateArticle, validateFaq, canLink, kbWarnings,
  embeddable, embedUrl, blockProblem, bodyProblem, blocksOf, blankBlock, BLOCK_LABEL,
} from './kb'
import type { KbArticle, KbAsset, KbFaq } from './kb'

const art = (over: Partial<KbArticle> = {}): KbArticle => ({
  id: 'KB-1', persona: 'operator', personas: ['operator'], audience_ids: [], audience_note: '',
  kind: 'howto', title: 'Onboard a seller',
  mins: 5, updated: '21 Jul 2026', view: 'op-onboarding',
  roles: [], tags: ['partners', 'onboarding'],
  summary: 'How the seven gates work', body: [{ kind: 'prose', heading: 'Why', text: 'Because' }],
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

/* ================================================================ FAQs === */

const faq = (over: Partial<KbFaq> = {}): KbFaq => ({
  id: 'FAQ-1', question: 'Where do I find my bill?', answer: 'Under Bills on your account.',
  personas: ['consumer'], audience_ids: [], topic: 'Billing', status: 'published',
  asked: 100, helpful: 80, article_id: null, updated: '01 Aug 2026',
  updated_by: 'Anika Sharma', sort_order: 1, ...over,
})

describe('who a piece is published to', () => {
  /* An article belonged to one persona, so the same policy had to be written
     twice to reach two audiences — which is how the copy nobody remembers to
     update becomes the one somebody reads. */
  it('lets one article reach two audiences', () => {
    const both = art({ personas: ['consumer', 'enterprise'] })
    expect(publishedTo(both, 'consumer')).toBe(true)
    expect(publishedTo(both, 'enterprise')).toBe(true)
    expect(publishedTo(both, 'partner')).toBe(false)
  })

  it('shows a held draft to nobody, whoever it names', () => {
    const held = art({ personas: ['consumer', 'enterprise'], status: 'held' })
    expect(publishedTo(held, 'consumer')).toBe(false)
    expect(publishedTo(held, 'enterprise')).toBe(false)
  })

  it('names the audiences the way a reader would', () => {
    expect(personaLabel('consumer')).toBe('Retail customers')
    expect(personaLabel('partner')).toBe('Sellers')
    expect(personaLabel('nobody')).toBe('nobody')
  })
})

describe('addressing something to particular readers', () => {
  /* Empty is the normal case and it means everybody, not nobody. Getting this
     backwards would hide every article in the knowledge base. */
  it('lets everybody through when nobody is named', () => {
    expect(addressedTo({ audience_ids: [] }, [])).toBe(true)
    expect(addressedTo({ audience_ids: [] }, ['PTR-1004'])).toBe(true)
    expect(addressedTo({}, [])).toBe(true)
  })

  it('lets a named reader through and nobody else', () => {
    const one = { audience_ids: ['PTR-1004'] }
    expect(addressedTo(one, ['PTR-1004'])).toBe(true)
    expect(addressedTo(one, ['PTR-1009'])).toBe(false)
    expect(addressedTo(one, [])).toBe(false)
  })

  it('lets a reader through on any one of the ids they hold', () => {
    /* A person signed in can be a customer and, in another marketplace,
       an account — the check is an intersection, not an equality. */
    expect(addressedTo({ audience_ids: ['ACC-77'] }, ['CUS-1', 'ACC-77'])).toBe(true)
  })

  it('needs the persona as well as the name', () => {
    const forOneSeller = art({ personas: ['partner'], audience_ids: ['PTR-1004'] })
    /* Right name, wrong audience: the two conditions are ANDed. */
    expect(visibleTo(forOneSeller, 'consumer', ['PTR-1004'])).toBe(false)
    expect(visibleTo(forOneSeller, 'partner', ['PTR-1004'])).toBe(true)
    expect(visibleTo(forOneSeller, 'partner', ['PTR-1009'])).toBe(false)
  })

  it('keeps a draft hidden from the reader it is addressed to', () => {
    const held = art({ personas: ['partner'], audience_ids: ['PTR-1004'], status: 'held' })
    expect(visibleTo(held, 'partner', ['PTR-1004'])).toBe(false)
  })

  it('narrows the questions a reader sees, without narrowing anybody else out', () => {
    const list = [
      faq({ id: 'all', personas: ['partner'], audience_ids: [], sort_order: 1 }),
      faq({ id: 'mine', personas: ['partner'], audience_ids: ['PTR-1004'], sort_order: 2 }),
      faq({ id: 'theirs', personas: ['partner'], audience_ids: ['PTR-1009'], sort_order: 3 }),
    ]
    expect(faqsFor(list, 'partner', ['PTR-1004']).map(f => f.id)).toEqual(['all', 'mine'])
    expect(faqsFor(list, 'partner', ['PTR-1009']).map(f => f.id)).toEqual(['all', 'theirs'])
    /* A seller who is nobody in particular still gets the general ones. */
    expect(faqsFor(list, 'partner', []).map(f => f.id)).toEqual(['all'])
  })
})

describe('the questions a reader sees', () => {
  const FAQS = [
    faq({ id: 'a', personas: ['consumer', 'enterprise'], audience_ids: [], topic: 'Billing', sort_order: 1 }),
    faq({ id: 'b', personas: ['consumer'], audience_ids: [], topic: 'Rewards', sort_order: 2 }),
    faq({ id: 'c', personas: ['partner'], audience_ids: [], topic: 'Settlement', sort_order: 3 }),
    faq({ id: 'd', personas: ['consumer'], audience_ids: [], topic: 'Billing', status: 'held', sort_order: 4 }),
  ]

  it('gives each audience its own, and nobody else’s', () => {
    expect(faqsFor(FAQS, 'consumer').map(f => f.id)).toEqual(['a', 'b'])
    expect(faqsFor(FAQS, 'enterprise').map(f => f.id)).toEqual(['a'])
    expect(faqsFor(FAQS, 'partner').map(f => f.id)).toEqual(['c'])
  })

  it('keeps a held question off every tab', () => {
    expect(faqsFor(FAQS, 'consumer').map(f => f.id)).not.toContain('d')
  })

  it('groups them by topic, in the order the topics appear', () => {
    const grouped = faqsByTopic(faqsFor(FAQS, 'consumer'))
    expect(grouped.map(g => g.topic)).toEqual(['Billing', 'Rewards'])
    expect(grouped[0].faqs.map(f => f.id)).toEqual(['a'])
  })

  it('searches the question, the answer and the topic', () => {
    expect(searchFaqs(FAQS, 'bill').map(f => f.id)).toEqual(['a', 'b', 'c', 'd'])
    expect(searchFaqs(FAQS, 'settlement').map(f => f.id)).toEqual(['c'])
    expect(searchFaqs(FAQS, '').map(f => f.id)).toHaveLength(4)
    expect(searchFaqs(FAQS, 'zzz')).toEqual([])
  })

  /* "0% helpful" and "nobody has said" are different facts, and showing the
     first for the second condemns a new answer for being new. */
  it('reports helpfulness as unknown rather than as zero when nobody has voted', () => {
    expect(helpfulness({ asked: 0, helpful: 0 })).toBeNull()
    expect(helpfulness({ asked: 100, helpful: 80 })).toBe(80)
    expect(helpfulness({ asked: 3, helpful: 0 })).toBe(0)
  })
})

describe('what may be published', () => {
  /* The refusal that matters: it reads as live on the author's list and
     appears on no reader's screen. */
  it('refuses to publish to nobody, and offers the alternative', () => {
    const check = validateAudience({ personas: [], status: 'published' })
    expect(check.ok).toBe(false)
    if (!check.ok) expect(check.reason).toMatch(/hold it as a draft instead/)
  })

  it('allows a draft addressed to nobody yet', () => {
    const check = validateAudience({ personas: [], status: 'held' })
    expect(check.ok).toBe(true)
    if (check.ok) expect(check.note).toMatch(/addressed to nobody yet/)
  })

  it('refuses an audience this marketplace does not have', () => {
    const check = validateAudience({ personas: ['consumer', 'reseller'], status: 'published' })
    expect(check.ok).toBe(false)
    if (!check.ok) expect(check.reason).toMatch(/reseller/)
  })

  it('says who will be able to read it', () => {
    const check = validateAudience({ personas: ['consumer', 'partner'], status: 'published' })
    expect(check.ok).toBe(true)
    if (check.ok) expect(check.note).toBe('Readable by Retail customers and Sellers.')
  })

  it('refuses an article with no title or no summary', () => {
    expect(validateArticle({ title: ' ', summary: 'x', personas: ['consumer'], status: 'published' }).ok).toBe(false)
    const noSummary = validateArticle({ title: 'x', summary: '', personas: ['consumer'], status: 'published' })
    expect(noSummary.ok).toBe(false)
    if (!noSummary.ok) expect(noSummary.reason).toMatch(/nobody can tell apart from its neighbours/)
  })

  it('insists a FAQ is written as a question', () => {
    const check = validateFaq({ question: 'Changing a plan', answer: 'Yes', personas: ['consumer'], status: 'published' })
    expect(check.ok).toBe(false)
    if (!check.ok) expect(check.reason).toMatch(/ending in a question mark/)
    expect(validateFaq({ question: 'Can I change a plan?', answer: 'Yes', personas: ['consumer'], status: 'published' }).ok).toBe(true)
  })

  it('refuses a question with no answer', () => {
    const check = validateFaq({ question: 'What now?', answer: '  ', personas: ['consumer'], status: 'published' })
    expect(check.ok).toBe(false)
    if (!check.ok) expect(check.reason).toMatch(/cannot explain/)
  })
})

describe('a question that opens an article', () => {
  const target = art({ id: 'KB-C04', title: 'A payment failed', personas: ['consumer'], status: 'published' })

  it('allows a link its own readers can follow', () => {
    expect(canLink({ personas: ['consumer'], status: 'published' }, target).ok).toBe(true)
  })

  /* A door to a room the reader cannot enter is worse than no door: they
     click, and either nothing happens or they are refused. */
  it('refuses a published question pointing at a draft', () => {
    const check = canLink({ personas: ['consumer'], status: 'published' }, { ...target, status: 'held' })
    expect(check.ok).toBe(false)
    if (!check.ok) expect(check.reason).toMatch(/cannot open an unpublished answer/)
  })

  it('refuses a link to an article this question’s readers cannot see', () => {
    const check = canLink({ personas: ['partner'], status: 'published' }, target)
    expect(check.ok).toBe(false)
    if (!check.ok) expect(check.reason).toMatch(/a door they cannot walk through/)
  })

  /* A draft question may point at a draft article — they are being written
     together. It may not point at one its own readers will never see, because
     that link is already broken and only looks fine until it is published. */
  it('lets a draft question point at a draft answer for the same readers', () => {
    expect(canLink({ personas: ['consumer'], status: 'held' }, { ...target, status: 'held' }).ok).toBe(true)
  })

  it('still refuses a draft link the audiences will never share', () => {
    const check = canLink({ personas: ['partner'], status: 'held' }, { ...target, status: 'held' })
    expect(check.ok).toBe(false)
    if (!check.ok) expect(check.reason).toMatch(/a door they cannot walk through/)
  })
})

describe('what the operator should be worried about', () => {
  const full = ['consumer', 'enterprise', 'partner'].flatMap(p => [
    art({ id: `a-${p}`, personas: [p] }),
  ])
  const fullFaqs = ['consumer', 'enterprise', 'partner'].map(p => faq({ id: `f-${p}`, personas: [p] }))

  it('says nothing when every audience has both', () => {
    expect(kbWarnings(full, fullFaqs).filter(w => w.level === 'warn')).toEqual([])
  })

  it('flags an audience with no articles', () => {
    const text = kbWarnings(full.filter(a => a.id !== 'a-partner'), fullFaqs).map(w => w.text).join(' | ')
    expect(text).toMatch(/Sellers have no published articles/)
  })

  it('flags an empty FAQ tab', () => {
    const text = kbWarnings(full, fullFaqs.filter(f => f.id !== 'f-enterprise')).map(w => w.text).join(' | ')
    expect(text).toMatch(/Business accounts have no published questions/)
  })

  /* Asked often and rarely found helpful is the most useful signal here: a
     question people have, and an answer that is not answering it. */
  it('surfaces an answer that is asked a lot and helps nobody', () => {
    const bad = faq({ id: 'bad', question: 'Why was I charged twice?', asked: 400, helpful: 40 })
    const text = kbWarnings(full, [...fullFaqs, bad]).map(w => w.text).join(' | ')
    expect(text).toMatch(/Why was I charged twice\?/)
  })

  it('does not condemn a new answer for being new', () => {
    const fresh = faq({ id: 'fresh', asked: 2, helpful: 0 })
    const text = kbWarnings(full, [...fullFaqs, fresh]).map(w => w.text).join(' | ')
    expect(text).not.toMatch(/rarely found helpful/)
  })
})


/* Every article in this marketplace was prose about a user interface with no
   picture of it. A block is now words, a picture or a video. */
describe('the blocks an article is made of', () => {
  it('accepts a URL a person would actually paste, and converts it', () => {
    expect(embedUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ'))
      .toBe('https://www.youtube.com/embed/dQw4w9WgXcQ')
    expect(embedUrl('https://youtu.be/dQw4w9WgXcQ'))
      .toBe('https://www.youtube.com/embed/dQw4w9WgXcQ')
    expect(embedUrl('https://vimeo.com/76979871'))
      .toBe('https://player.vimeo.com/video/76979871')
    expect(embedUrl('https://player.vimeo.com/video/76979871'))
      .toBe('https://player.vimeo.com/video/76979871')
  })

  /* The whole trick a suffix match falls for. */
  it('matches the host and not the end of it', () => {
    expect(embeddable('https://notyoutube.com/watch?v=1')).toBe(false)
    expect(embeddable('https://youtube.com.evil.test/watch?v=1')).toBe(false)
    expect(embeddable('https://www.youtube.com/watch?v=1')).toBe(true)
  })

  it('will not frame anything that is not https, or not a URL at all', () => {
    expect(embeddable('http://www.youtube.com/watch?v=1')).toBe(false)
    expect(embeddable('javascript:alert(1)')).toBe(false)
    expect(embeddable('')).toBe(false)
    expect(embedUrl('https://example.com/v')).toBeNull()
  })

  it('refuses a block that has nothing to show', () => {
    expect(blockProblem({ kind: 'prose', heading: '', text: 'x' })).toMatch(/needs a heading/)
    expect(blockProblem({ kind: 'prose', heading: 'x', text: '  ' })).toMatch(/heading over a gap/)
    expect(blockProblem({ kind: 'image', heading: 'x', src: '', alt: 'y' })).toMatch(/needs a picture/)
    expect(blockProblem({ kind: 'video', heading: 'x', url: 'https://example.com/v' }))
      .toMatch(/not a host this marketplace will frame/)
  })

  /* On a help page the reader most likely to need the picture described is the
     one who cannot see it. */
  it('requires alt text on every picture', () => {
    expect(blockProblem({ kind: 'image', heading: 'x', src: 'https://a/b.png', alt: '' }))
      .toMatch(/alt text/)
    expect(blockProblem({ kind: 'image', heading: 'x', src: 'https://a/b.png', alt: 'The screen' }))
      .toBeNull()
  })

  it('names the first block that is wrong, not the count of them', () => {
    expect(bodyProblem([])).toMatch(/no blocks is a title/)
    expect(bodyProblem([
      { kind: 'prose', heading: 'Fine', text: 'Yes' },
      { kind: 'image', heading: 'Broken', src: 'https://a/b.png', alt: '' },
    ])).toMatch(/alt text/)
    expect(bodyProblem([{ kind: 'prose', heading: 'Fine', text: 'Yes' }])).toBeNull()
  })

  /* A fixture or an export written before the migration is still a pair, and a
     reader that renders nothing for one silently drops an article's content. */
  it('still reads a body written as pairs', () => {
    const out = blocksOf([['Why', 'Because'], { kind: 'prose', heading: 'And', text: 'So' }])
    expect(out).toEqual([
      { kind: 'prose', heading: 'Why', text: 'Because' },
      { kind: 'prose', heading: 'And', text: 'So' },
    ])
    expect(blocksOf(null)).toEqual([])
  })

  it('starts each kind of block from a blank that is the right shape', () => {
    expect(blankBlock('image')).toEqual({ kind: 'image', heading: '', src: '', alt: '' })
    expect(blankBlock('video')).toEqual({ kind: 'video', heading: '', url: '' })
    expect(Object.keys(BLOCK_LABEL)).toEqual(['prose', 'image', 'video'])
  })
})
