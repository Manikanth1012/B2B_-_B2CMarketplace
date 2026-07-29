/* Touches the live Supabase project. Owns only rows it creates. */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { supabase } from './supabase'
import { loadKb, articleForView, raiseContentFeedback, CONTENT_FEEDBACK_CATEGORY } from './kbRepo'
import type { KbArticle } from './kb'

const AID = 'KB-TEST-1'
const ORG = 'KB Test Co'

const testArticle: KbArticle = {
  id: AID, persona: 'partner', kind: 'howto', title: 'Test article', mins: 1,
  updated: '29 Jul 2026', view: 'pt-listings', roles: [], tags: ['test'],
  summary: 'Seeded by the integration test', body: [['Heading', 'Prose']],
  status: 'published', sort_order: 999,
}

async function teardown() {
  await supabase.from('operator_tickets').delete().eq('org', ORG)
  await supabase.from('kb_articles').delete().eq('id', AID)
}

beforeAll(async () => {
  await teardown()
  await supabase.from('kb_articles').insert({ ...testArticle, body: JSON.stringify(testArticle.body) })
})

afterAll(teardown)

describe('knowledge base round trip', () => {
  it('loads the seeded article for its persona', async () => {
    const snap = await loadKb('partner')
    expect(snap.loadError).toBeUndefined()
    expect(snap.articles.map(a => a.id)).toContain(AID)
  })

  it('does not return it for another persona', async () => {
    const snap = await loadKb('consumer')
    expect(snap.articles.map(a => a.id)).not.toContain(AID)
  })

  it('resolves contextual help by view, and returns null for a screen with no article', async () => {
    const hit = await articleForView('partner', 'pt-listings')
    expect(hit.ok).toBe(true)
    if (hit.ok) expect(hit.article).not.toBeNull()
    const miss = await articleForView('partner', 'pt-nonexistent')
    expect(miss.ok).toBe(true)
    if (miss.ok) expect(miss.article).toBeNull()
  })

  it('refuses feedback with an empty note', async () => {
    const res = await raiseContentFeedback({ article: testArticle, actor: 'test', org: ORG, note: '   ' })
    expect(res.ok).toBe(false)
  })

  it('lands feedback in the operator queue under its own category', async () => {
    const res = await raiseContentFeedback({ article: testArticle, actor: 'test', org: ORG, note: 'Unclear' })
    expect(res.ok).toBe(true)
    const { data } = await supabase.from('operator_tickets').select('*').eq('org', ORG)
    expect(data).toHaveLength(1)
    expect(data![0].category).toBe(CONTENT_FEEDBACK_CATEGORY)
    expect(data![0].subject).toContain('Test article')
  })
})
