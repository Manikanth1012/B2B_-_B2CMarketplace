/* Touches the live Supabase project. Owns only rows it creates.

   Signs in as the operator first: since the scoped-RLS migrations landed, anon can
   only SELECT published kb_articles, so seeding a fixture article and reading the
   operator ticket queue back both need a persona behind them. */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { supabase } from './supabase'
import { signIn, signOut } from './authRepo'
import { loadKb, articleForView, raiseContentFeedback, CONTENT_FEEDBACK_CATEGORY } from './kbRepo'
import type { KbArticle } from './kb'

const OPERATOR = { email: 'anika.sharma@aventa.com', password: 'operator123' }

const AID = 'KB-TEST-1'
const ORG = 'KB Test Co'

/* pt-team is a real partner view. It used to be one no seeded article bound to, which
   is no longer true of any view — every screen in every persona now carries a help
   article, and pt-team carries KB-P20.

   So the fixture wins the race explicitly instead of by absence: `articleForView` orders
   by sort_order and takes the first, and -1 is below anything real. Relying on there
   being no competition is what broke when the gap was filled. */
const testArticle: KbArticle = {
  id: AID, persona: 'partner', personas: ['partner'], audience_ids: [], audience_note: '',
  kind: 'howto', title: 'Test article', mins: 1,
  updated: '29 Jul 2026', view: 'pt-team', roles: [], tags: ['test'],
  summary: 'Seeded by the integration test', body: [['Heading', 'Prose']],
  status: 'published', sort_order: -1,
}

async function teardown() {
  await supabase.from('support_tickets').delete().eq('org', ORG)
  await supabase.from('kb_articles').delete().eq('id', AID)
}

beforeAll(async () => {
  await signIn(OPERATOR.email, OPERATOR.password)
  await teardown()
  const { error } = await supabase.from('kb_articles').insert({ ...testArticle, body: JSON.stringify(testArticle.body) })
  if (error) throw new Error(`Could not seed ${AID}: ${error.message}`)
})

afterAll(async () => {
  await teardown()
  await signOut()
})

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

  it('resolves contextual help by view, and returns null for a view that does not exist', async () => {
    const hit = await articleForView('partner', 'pt-team')
    expect(hit.ok).toBe(true)
    // A bare non-null check would pass even if this test's own insert silently failed.
    // Assert it is the article we seeded, not merely "something".
    if (hit.ok) expect(hit.article?.id).toBe(AID)
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
    const { data } = await supabase.from('support_tickets').select('*').eq('org', ORG)
    expect(data).toHaveLength(1)
    expect(data![0].category).toBe(CONTENT_FEEDBACK_CATEGORY)
    expect(data![0].subject).toContain('Test article')
    // Guards the jsonb-string-vs-array bug: JSON.stringify()-ing the messages payload before
    // insert stores a jsonb string scalar, which reads back with typeof 'string' and no
    // .map — this is what breaks OperatorTickets.tsx's `selected.messages.map(...)`.
    expect(Array.isArray(data![0].messages)).toBe(true)
    expect(data![0].messages[0].text).toBe('Unclear')
  })
})
