/* Touches the live Supabase project.
 *
 * Two claims. An article can be published to more than one audience, and each
 * reader gets exactly what was addressed to them — which is the thing that
 * used to require writing the article twice. And the operator can now author
 * this at all: the knowledge base was seeded and then frozen.
 *
 * The refusal worth checking against a real database is "published to nobody".
 * It reads as live on the author's list and appears on no reader's screen, so
 * a form is not enough — `guard_kb()` is what makes it impossible.
 *
 * Everything written here is undone in the same file.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { supabase } from './supabase'
import { signIn, signOut } from './authRepo'
import { loadKbAdmin, saveArticle, saveFaq, deleteArticle, deleteFaq, setArticleStatus, setAudiences } from './kbAdminRepo'
import type { KbAdminBook } from './kbAdminRepo'
import { loadKb } from './kbRepo'
import {
  publishedTo, faqsFor, faqsByTopic, validateFaq, canLink,
  blocksOf, blockProblem, bodyProblem,
} from './kb'

const OPERATOR = { email: 'anika.sharma@aventa.com', password: 'operator123' }
const CONSUMER = { email: 'priya.raman@example.com', password: 'demo1234' }
const PARTNER = { email: 'rajesh.kumar@nimbussensors.com', password: 'partner123' }

let book: KbAdminBook
const articles: string[] = []
const faqs: string[] = []
/* How many questions were on file before this suite wrote anything. Captured
   rather than written down: a literal count is a test that fails the next time
   somebody seeds a question, which tells you nothing about whether the tidy-up
   worked. */
let faqsBefore = 0

describe('what each audience has to read', () => {
  beforeAll(async () => {
    await signIn(OPERATOR.email, OPERATOR.password)
    book = await loadKbAdmin()
    expect(book.loadError, book.loadError).toBeUndefined()
    faqsBefore = book.faqs.length
  })

  it('gives every reader-facing audience articles and questions', async () => {
    for (const p of ['consumer', 'enterprise', 'partner'] as const) {
      expect(book.articles.filter(a => publishedTo(a, p)).length, `${p} articles`).toBeGreaterThan(0)
      expect(book.faqs.filter(f => publishedTo(f, p)).length, `${p} questions`).toBeGreaterThan(0)
    }
  })

  it('publishes nothing to nobody', () => {
    const orphans = [...book.articles, ...book.faqs]
      .filter(x => x.status === 'published' && x.personas.length === 0)
    expect(orphans).toEqual([])
  })

  /* The thing that used to need the article written twice. */
  it('lets one article reach two audiences', () => {
    const shared = book.articles.filter(a => a.personas.length > 1)
    expect(shared.length, 'no article reaches more than one audience').toBeGreaterThan(0)
    const both = shared.find(a => a.personas.includes('consumer') && a.personas.includes('enterprise'))
    expect(both, 'nothing is shared between retail and business').toBeTruthy()
  })

  it('never points a published question at an answer its readers cannot open', () => {
    for (const f of book.faqs.filter(x => x.status === 'published' && x.article_id)) {
      const a = book.articles.find(x => x.id === f.article_id)!
      expect(a.status, `${f.id} opens a draft`).toBe('published')
      expect(f.personas.some(p => a.personas.includes(p)), `${f.id} opens an article its readers cannot see`).toBe(true)
    }
  })

  it('writes every question as a question', () => {
    for (const f of book.faqs) {
      expect(validateFaq(f).ok, `${f.id}: ${f.question}`).toBe(true)
    }
  })
})

describe('what a reader actually gets', () => {
  afterAll(async () => {
    await signOut()
    await signIn(OPERATOR.email, OPERATOR.password)
  })

  it('gives a retail customer their own questions, grouped by topic', async () => {
    await signOut()
    await signIn(CONSUMER.email, CONSUMER.password)
    const snap = await loadKb('consumer')
    expect(snap.faqs.length).toBeGreaterThan(0)
    expect(faqsByTopic(faqsFor(snap.faqs, 'consumer')).length).toBeGreaterThan(1)
    for (const f of snap.faqs) expect(f.personas, f.id).toContain('consumer')
  })

  it('does not give them a seller’s questions', async () => {
    const snap = await loadKb('consumer')
    expect(snap.faqs.map(f => f.question)).not.toContain('When do I get paid?')
  })

  it('gives a seller theirs, and not a customer’s', async () => {
    await signOut()
    await signIn(PARTNER.email, PARTNER.password)
    const snap = await loadKb('partner')
    expect(snap.faqs.map(f => f.question)).toContain('When do I get paid?')
    expect(snap.faqs.map(f => f.question)).not.toContain('How long do reward points last?')
  })

  /* A question everybody asks appears for everybody, from one row. */
  it('shows a shared question on every tab it was addressed to', async () => {
    const seller = (await loadKb('partner')).faqs.map(f => f.id)
    await signOut()
    await signIn(CONSUMER.email, CONSUMER.password)
    const retail = (await loadKb('consumer')).faqs.map(f => f.id)
    expect(seller).toContain('FAQ-001')
    expect(retail).toContain('FAQ-001')
  })
})

describe('what the operator can now do, and what is still refused', () => {
  it('writes an article for two audiences at once', async () => {
    const res = await saveArticle({
      id: null, actor: 'Integration suite',
      draft: {
        title: 'Integration test article', summary: 'Written by the integration suite.',
        kind: 'howto', personas: ['consumer', 'enterprise'], audience_ids: [], status: 'published',
        mins: 2, tags: ['test'], view: null, roles: [], body: [{ kind: 'prose', heading: 'Why', text: 'Because' }],
        audience_note: '',
      },
    })
    expect(res.ok, (res as { reason?: string }).reason).toBe(true)
    articles.push(res.id!)

    book = await loadKbAdmin()
    const mine = book.articles.find(a => a.id === res.id)!
    expect(mine.personas.sort()).toEqual(['consumer', 'enterprise'])
  })

  it('puts it on both readers’ shelves and on nobody else’s', async () => {
    await signOut()
    await signIn(CONSUMER.email, CONSUMER.password)
    expect((await loadKb('consumer')).articles.map(a => a.id)).toContain(articles[0])

    await signOut()
    await signIn(PARTNER.email, PARTNER.password)
    expect((await loadKb('partner')).articles.map(a => a.id)).not.toContain(articles[0])

    await signOut()
    await signIn(OPERATOR.email, OPERATOR.password)
  })

  /* The refusal that matters: live on the author's list, absent from every
     reader's screen. */
  it('refuses to publish to nobody, in the database', async () => {
    const { error } = await supabase.from('kb_articles')
      .update({ personas: [] }).eq('id', articles[0])
    expect(error, 'an article was published to nobody').not.toBeNull()
    expect(error!.message).toMatch(/published to nobody/)
  })

  it('refuses an audience this marketplace does not have', async () => {
    const { error } = await supabase.from('kb_articles')
      .update({ personas: ['consumer', 'reseller'] }).eq('id', articles[0])
    expect(error).not.toBeNull()
    expect(error!.message).toMatch(/not an audience/)
  })

  it('narrows an audience from the list without opening the editor', async () => {
    const mine = book.articles.find(a => a.id === articles[0])!
    const res = await setAudiences({
      kind: 'article', id: mine.id, personas: ['consumer'],
      current: { status: mine.status, title: mine.title }, actor: 'Integration suite',
    })
    expect(res.ok, (res as { reason?: string }).reason).toBe(true)

    await signOut()
    await signIn(CONSUMER.email, CONSUMER.password)
    expect((await loadKb('consumer')).articles.map(a => a.id)).toContain(articles[0])
    await signOut()
    await signIn(OPERATOR.email, OPERATOR.password)
    book = await loadKbAdmin()
  })

  it('holds an article, taking it off every screen without deleting it', async () => {
    const mine = book.articles.find(a => a.id === articles[0])!
    const res = await setArticleStatus({ article: mine, status: 'held', actor: 'Integration suite' })
    expect(res.ok, (res as { reason?: string }).reason).toBe(true)

    await signOut()
    await signIn(CONSUMER.email, CONSUMER.password)
    expect((await loadKb('consumer')).articles.map(a => a.id)).not.toContain(articles[0])

    await signOut()
    await signIn(OPERATOR.email, OPERATOR.password)
    book = await loadKbAdmin()
    /* Still there for the author — held is not deleted. */
    expect(book.articles.map(a => a.id)).toContain(articles[0])

    await setArticleStatus({
      article: book.articles.find(a => a.id === articles[0])!, status: 'published', actor: 'Integration suite',
    })
    book = await loadKbAdmin()
  })

  it('writes a question, and insists it is a question', async () => {
    const bad = await saveFaq({
      id: null, articles: book.articles, actor: 'Integration suite',
      draft: { question: 'Changing a plan', answer: 'Yes.', personas: ['consumer'], audience_ids: [], topic: 'Test', status: 'published', article_id: null },
    })
    expect(bad.ok).toBe(false)
    if (!bad.ok) expect(bad.reason).toMatch(/question mark/)

    const good = await saveFaq({
      id: null, articles: book.articles, actor: 'Integration suite',
      draft: {
        question: 'Is this an integration test?', answer: 'Yes, and it cleans up after itself.',
        personas: ['consumer'], audience_ids: [], topic: 'Test', status: 'published', article_id: articles[0],
      },
    })
    expect(good.ok, (good as { reason?: string }).reason).toBe(true)
    faqs.push(good.id!)
  })

  it('refuses a question that opens a door its readers cannot walk through', async () => {
    book = await loadKbAdmin()
    const res = await saveFaq({
      id: null, articles: book.articles, actor: 'Integration suite',
      draft: {
        question: 'Can a seller read a retail article?', answer: 'No.',
        personas: ['partner'], audience_ids: [], topic: 'Test', status: 'published', article_id: articles[0],
      },
    })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.reason).toMatch(/cannot walk through/)
  })

  it('says the same thing the module says', () => {
    const target = book.articles.find(a => a.id === articles[0])!
    const check = canLink({ personas: ['partner'], status: 'published' }, target)
    expect(check.ok).toBe(false)
  })

  it('refuses to delete an article a published question opens', async () => {
    book = await loadKbAdmin()
    const mine = book.articles.find(a => a.id === articles[0])!
    const res = await deleteArticle({ article: mine, faqs: book.faqs, actor: 'Integration suite' })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.reason).toMatch(/Unlink or hold them first/)
  })
})

describe('a reader who is not the author', () => {
  afterAll(async () => {
    await signOut()
    await signIn(OPERATOR.email, OPERATOR.password)
  })

  it('cannot publish an article to themselves', async () => {
    await signOut()
    await signIn(CONSUMER.email, CONSUMER.password)
    const { data } = await supabase.from('kb_articles')
      .update({ title: 'Free stuff' }).eq('id', 'KB-C01').select('id')
    expect(data ?? []).toEqual([])

    await signOut()
    await signIn(OPERATOR.email, OPERATOR.password)
    const { data: still } = await supabase.from('kb_articles').select('title').eq('id', 'KB-C01')
    expect(still?.[0]?.title).toBe('Getting started')
  })

  it('cannot write a question of their own', async () => {
    await signOut()
    await signIn(CONSUMER.email, CONSUMER.password)
    const { data } = await supabase.from('kb_faqs').insert({
      id: `FAQ-BAD-${Date.now()}`, question: 'Can I do this?', answer: 'No.',
      personas: ['consumer'], audience_ids: [], topic: 'Test',
    }).select('id')
    expect(data ?? []).toEqual([])
    await signOut()
    await signIn(OPERATOR.email, OPERATOR.password)
  })
})

describe('tidying up', () => {
  afterAll(async () => { await signOut() })

  it('removes everything this file created', async () => {
    await signOut()
    await signIn(OPERATOR.email, OPERATOR.password)
    book = await loadKbAdmin()

    for (const id of faqs) {
      const res = await deleteFaq({ faq: book.faqs.find(f => f.id === id)!, actor: 'Integration suite' })
      expect(res.ok, (res as { reason?: string }).reason).toBe(true)
    }
    book = await loadKbAdmin()
    for (const id of articles) {
      const res = await deleteArticle({
        article: book.articles.find(a => a.id === id)!, faqs: book.faqs, actor: 'Integration suite',
      })
      expect(res.ok, (res as { reason?: string }).reason).toBe(true)
    }

    const after = await loadKbAdmin()
    expect(after.articles.map(a => a.id).filter(id => articles.includes(id))).toEqual([])
    expect(after.faqs.map(f => f.id).filter(id => faqs.includes(id))).toEqual([])
    /* And the set is back to the size it was before this file ran. */
    expect(after.faqs.length, 'the tidy-up left something behind').toBe(faqsBefore)
  })
})


/* An article was a list of [heading, prose] pairs, so the help centre could not
   show you the screen it was describing. */
describe('the blocks an article is made of, in the database', () => {
  const article = 'KB-O06'
  let original: unknown = null

  beforeAll(async () => {
    await signIn(OPERATOR.email, OPERATOR.password)
    const { data } = await supabase.from('kb_articles').select('body').eq('id', article).maybeSingle()
    original = (data as { body: unknown } | null)?.body ?? null
    expect(original, `${article} is not on file`).toBeTruthy()
  }, 30_000)

  afterAll(async () => {
    if (original) await supabase.from('kb_articles').update({ body: original }).eq('id', article)
    await signOut()
  })

  it('holds every block as an object, on every article', async () => {
    const { data, error } = await supabase.from('kb_articles').select('id, body')
    expect(error, error?.message).toBeNull()
    const rows = (data ?? []) as { id: string; body: unknown[] }[]
    expect(rows.length).toBeGreaterThan(0)

    const pairs = rows.filter(r => (r.body ?? []).some(b => Array.isArray(b))).map(r => r.id)
    expect(pairs, `still holding pairs: ${pairs.join(', ')}`).toEqual([])
  })

  /* The rule the module evaluates and the rule the trigger evaluates, against
     every article actually on file rather than a fixture. */
  it('agrees with the module about every article on file', async () => {
    const { data } = await supabase.from('kb_articles').select('id, body')
    const wrong = ((data ?? []) as { id: string; body: unknown }[])
      .map(r => ({ id: r.id, why: bodyProblem(blocksOf(r.body)) }))
      .filter(r => r.why)
      .map(r => `${r.id}: ${r.why}`)
    expect(wrong, wrong.join('; ')).toEqual([])
  })

  it('has media to show, or nothing exercises the feature', async () => {
    const { data } = await supabase.from('kb_articles').select('id, body')
    const media = ((data ?? []) as { body: unknown }[])
      .flatMap(r => blocksOf(r.body))
      .filter(b => b.kind === 'image' || b.kind === 'video')
    expect(media.length).toBeGreaterThanOrEqual(2)
    for (const b of media) expect(blockProblem(b), JSON.stringify(b)).toBeNull()
  })

  it('refuses a picture with no alt text', async () => {
    const { error } = await supabase.from('kb_articles')
      .update({ body: [{ kind: 'image', heading: 'x', src: 'https://a/b.png' }] })
      .eq('id', article)
    expect(error, 'an image with no alt text was written').not.toBeNull()
    expect(error!.message).toMatch(/alt text/)
  })

  /* A URL an author pastes becomes an iframe on a page every persona reads. */
  it('refuses an origin it will not frame, in the database as well as the form', async () => {
    const { error } = await supabase.from('kb_articles')
      .update({ body: [{ kind: 'video', heading: 'x', url: 'https://example.com/v' }] })
      .eq('id', article)
    expect(error, 'an arbitrary origin was accepted as an embed').not.toBeNull()
    expect(error!.message).toMatch(/will frame/)
    expect(blockProblem({ kind: 'video', heading: 'x', url: 'https://example.com/v' }))
      .toMatch(/will frame/)
  })

  it('takes a picture and a video that are properly formed', async () => {
    const body = [
      { kind: 'prose', heading: 'What this is', text: 'Written by the integration suite.' },
      { kind: 'image', heading: 'The screen', src: 'https://example.org/shot.png', alt: 'A screenshot of the settlement list.' },
      { kind: 'video', heading: 'Watch it', url: 'https://vimeo.com/76979871' },
    ]
    const { error } = await supabase.from('kb_articles').update({ body }).eq('id', article)
    expect(error, error?.message).toBeNull()

    const { data } = await supabase.from('kb_articles').select('body').eq('id', article).maybeSingle()
    const back = blocksOf((data as { body: unknown }).body)
    expect(back.map(b => b.kind)).toEqual(['prose', 'image', 'video'])
    expect(bodyProblem(back)).toBeNull()
  })
})
