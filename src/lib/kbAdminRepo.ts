/* The operator's side of the knowledge base.
 *
 * There was no authoring path at all: the knowledge base was seeded and then
 * frozen, and the one thing the operator could do with it was read it. This is
 * the write half — articles, the audiences they are published to, and the
 * questions people actually ask.
 */
import { supabase } from './supabase'
import { validateArticle, validateFaq, canLink, publishedTo } from './kb'
import type { KbArticle, KbFaq, KbAsset, KbStatus } from './kb'

export type Result = { ok: true; note?: string } | { ok: false; reason: string }

/**
 * Somebody an article can be addressed to by name.
 *
 * One shape across three tables, because the audience picker asks one question
 * — "who is this for?" — and a seller, a business account and a retail customer
 * are all answers to it.
 */
export interface KbReader {
  id: string
  name: string
  persona: 'partner' | 'enterprise' | 'consumer'
  note: string
}

export interface KbAdminBook {
  articles: KbArticle[]
  faqs: KbFaq[]
  assets: KbAsset[]
  /* Everyone who could be named as an audience. Loaded here rather than by the
     picker so opening the editor does not go and fetch three more tables. */
  readers: KbReader[]
  loadError?: string
}

/** Everything, across every audience — this is the console that owns it. */
export async function loadKbAdmin(): Promise<KbAdminBook> {
  const [artRes, faqRes, assetRes, ptr, acc, cus] = await Promise.all([
    supabase.from('kb_articles').select('*').order('persona').order('sort_order'),
    supabase.from('kb_faqs').select('*').order('sort_order'),
    supabase.from('kb_assets').select('*').order('sort_order'),
    supabase.from('partners').select('id,name,type,country').order('name'),
    supabase.from('enterprise_accounts').select('id,company').order('company'),
    supabase.from('consumer_profile').select('customer_id,name').order('name'),
  ])

  const readers: KbReader[] = [
    ...((ptr.data ?? []) as { id: string; name: string; type: string; country: string }[])
      .map(p => ({ id: p.id, name: p.name, persona: 'partner' as const, note: `${p.type} · ${p.country}` })),
    ...((acc.data ?? []) as { id: string; company: string }[])
      .map(a => ({ id: a.id, name: a.company, persona: 'enterprise' as const, note: a.id })),
    ...((cus.data ?? []) as { customer_id: string; name: string }[])
      .map(c => ({ id: c.customer_id, name: c.name, persona: 'consumer' as const, note: c.customer_id })),
  ]

  const book: KbAdminBook = {
    articles: (artRes.data ?? []) as KbArticle[],
    faqs: (faqRes.data ?? []) as KbFaq[],
    assets: (assetRes.data ?? []) as KbAsset[],
    readers,
  }
  /* A failed reader list does not blank the screen — it costs the ability to
     address something to one person, not the ability to author at all. */
  const failed = [artRes.error, faqRes.error].find(Boolean)
  return failed ? { ...book, loadError: failed.message } : book
}

/* ------------------------------------------------------------ articles --- */

export type ArticleDraft = Pick<KbArticle,
  'title' | 'summary' | 'kind' | 'personas' | 'audience_ids' | 'status' | 'mins' | 'tags' |
  'view' | 'roles' | 'body' | 'audience_note'>

export async function saveArticle(
  { id, draft, actor }: { id: string | null; draft: ArticleDraft; actor: string },
): Promise<Result & { id?: string }> {
  const check = validateArticle(draft)
  if (!check.ok) return check

  const isNew = !id
  const articleId = id ?? `KB-${Date.now().toString(36).toUpperCase().slice(-5)}`

  const { data, error } = await supabase.from('kb_articles').upsert({
    ...draft,
    id: articleId,
    /* `persona` is where it sorts in this console; the first audience is the
       honest answer to "whose article is this". `personas` is what readers are
       matched on and is not derived from it. */
    persona: draft.personas[0] ?? 'operator',
    view: draft.view || null,
    updated: today(),
    ...(isNew ? { sort_order: 900 } : {}),
  }).select('id')

  if (error) return { ok: false, reason: friendly(error.message) }
  if (!data?.length) return { ok: false, reason: REFUSED }

  await writeAudit(actor, isNew ? 'kb.article.created' : 'kb.article.edited',
    draft.title, isNew ? null : articleId, draft.status,
    `Published to ${draft.personas.join(' and ') || 'nobody yet'}`)

  return {
    ok: true,
    id: articleId,
    note: draft.status === 'published'
      ? `${draft.title} is live for ${draft.personas.join(' and ')}.`
      : `${draft.title} saved as a draft. Nobody sees it until it is published.`,
  }
}

/**
 * Publish or hold, without opening the editor.
 *
 * Holding is the reversible half of deleting, and the operator reaches for it
 * far more often — an article that is wrong should stop being read now and be
 * fixed afterwards.
 */
export async function setArticleStatus(
  { article, status, actor }: { article: KbArticle; status: KbStatus; actor: string },
): Promise<Result> {
  const check = validateArticle({ ...article, status })
  if (!check.ok) return check

  const { data, error } = await supabase.from('kb_articles')
    .update({ status, updated: today() }).eq('id', article.id).select('id')
  if (error) return { ok: false, reason: friendly(error.message) }
  if (!data?.length) return { ok: false, reason: REFUSED }

  await writeAudit(actor, 'kb.article.' + status, article.title, article.status, status,
    status === 'held' ? 'Taken off every reader’s screen' : `Live for ${article.personas.join(' and ')}`)
  return {
    ok: true,
    note: status === 'published'
      ? `${article.title} is live for ${article.personas.join(' and ')}.`
      : `${article.title} held. It is off every reader’s screen; nothing was deleted.`,
  }
}

/**
 * Delete an article.
 *
 * Refused while a published question points at it. A FAQ whose answer has been
 * deleted is a door to a wall, and the person who finds it is a customer.
 */
export async function deleteArticle(
  { article, faqs, actor }: { article: KbArticle; faqs: readonly KbFaq[]; actor: string },
): Promise<Result> {
  const pointing = faqs.filter(f => f.article_id === article.id && f.status === 'published')
  if (pointing.length) {
    return {
      ok: false,
      reason: `${pointing.length} published question${pointing.length === 1 ? '' : 's'} opens this article: ${pointing.map(f => f.question).join(' · ')}. Unlink or hold them first.`,
    }
  }

  const { data, error } = await supabase.from('kb_articles')
    .delete().eq('id', article.id).select('id')
  if (error) return { ok: false, reason: friendly(error.message) }
  if (!data?.length) return { ok: false, reason: REFUSED }

  await writeAudit(actor, 'kb.article.deleted', article.title, article.id, 'deleted',
    'Article and its assets removed', 'warn')
  return { ok: true, note: `${article.title} deleted, along with the files attached to it.` }
}

/* ---------------------------------------------------------------- FAQs --- */

export type FaqDraft = Pick<KbFaq,
  'question' | 'answer' | 'personas' | 'audience_ids' | 'topic' | 'status' | 'article_id'>

export async function saveFaq(
  { id, draft, articles, actor }: {
    id: string | null; draft: FaqDraft; articles: readonly KbArticle[]; actor: string
  },
): Promise<Result & { id?: string }> {
  const check = validateFaq(draft)
  if (!check.ok) return check

  if (draft.article_id) {
    const target = articles.find(a => a.id === draft.article_id)
    if (!target) return { ok: false, reason: 'That article no longer exists. Reload the screen.' }
    const link = canLink(draft, target)
    if (!link.ok) return link
  }

  const isNew = !id
  const faqId = id ?? `FAQ-${Date.now().toString(36).toUpperCase().slice(-5)}`

  const { data, error } = await supabase.from('kb_faqs').upsert({
    ...draft,
    id: faqId,
    article_id: draft.article_id || null,
    updated: today(),
    updated_by: actor,
    ...(isNew ? { asked: 0, helpful: 0, sort_order: 900 } : {}),
  }).select('id')

  if (error) return { ok: false, reason: friendly(error.message) }
  if (!data?.length) return { ok: false, reason: REFUSED }

  await writeAudit(actor, isNew ? 'kb.faq.created' : 'kb.faq.edited',
    draft.question, isNew ? null : faqId, draft.status,
    `Published to ${draft.personas.join(' and ') || 'nobody yet'}`)

  return {
    ok: true,
    id: faqId,
    note: draft.status === 'published'
      ? `Answered for ${draft.personas.join(' and ')}.`
      : 'Saved as a draft. It is on nobody’s FAQ tab yet.',
  }
}

export async function deleteFaq(
  { faq, actor }: { faq: KbFaq; actor: string },
): Promise<Result> {
  const { data, error } = await supabase.from('kb_faqs').delete().eq('id', faq.id).select('id')
  if (error) return { ok: false, reason: friendly(error.message) }
  if (!data?.length) return { ok: false, reason: REFUSED }

  await writeAudit(actor, 'kb.faq.deleted', faq.question, faq.id, 'deleted',
    `Asked ${faq.asked} times before it was removed`, 'warn')
  return { ok: true, note: 'Question removed.' }
}

/**
 * Widen or narrow what a reader can see, from the list.
 *
 * The common edit by a long way: an article written for one audience turns out
 * to answer the same question for another. Doing it without opening the editor
 * is the difference between a policy that stays in one place and a policy that
 * gets copied.
 */
export async function setAudiences(
  { kind, id, personas, current, actor }: {
    kind: 'article' | 'faq'
    id: string
    personas: string[]
    current: { status: KbStatus; title: string }
    actor: string
  },
): Promise<Result> {
  const check = validateArticle({
    title: current.title, summary: 'x', personas, status: current.status,
  })
  if (!check.ok) return check

  const table = kind === 'article' ? 'kb_articles' : 'kb_faqs'
  const { data, error } = await supabase.from(table)
    .update({ personas, updated: today() }).eq('id', id).select('id')
  if (error) return { ok: false, reason: friendly(error.message) }
  if (!data?.length) return { ok: false, reason: REFUSED }

  await writeAudit(actor, `kb.${kind}.audience`, current.title, null,
    personas.join(' and ') || 'nobody', 'Audience changed')
  return { ok: true, note: `Now published to ${personas.map(p => p).join(' and ') || 'nobody'}.` }
}

/** What each audience actually has to read. Used by the operator's overview. */
export function coverage(
  book: KbAdminBook,
): { persona: string; articles: number; faqs: number; drafts: number }[] {
  return ['consumer', 'enterprise', 'partner', 'operator'].map(p => ({
    persona: p,
    articles: book.articles.filter(a => publishedTo(a, p)).length,
    faqs: book.faqs.filter(f => publishedTo(f, p)).length,
    drafts: book.articles.filter(a => a.status === 'held' && a.personas.includes(p)).length,
  }))
}

/* --------------------------------------------------------------- helpers -- */

const REFUSED = 'Nothing changed. Only the marketplace operator can edit the knowledge base.'

function today(): string {
  return new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

async function writeAudit(
  actor: string, action: string, object: string, before: string | null,
  after: string, detail: string, severity = 'info',
): Promise<void> {
  await supabase.from('operator_audit_log').insert({
    id: `AUD-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    actor, role: 'Marketplace operations', action, object,
    category: 'Support', severity, outcome: 'success',
    before_val: before, after_val: `${after} — ${detail}`,
  })
}

function friendly(message: string): string {
  const m = message.replace(/^.*?\bERROR:\s*/i, '').trim()
  if (/published to nobody|not an audience/i.test(m)) return m
  if (/duplicate key/i.test(m)) return 'Something with that id already exists. Reload the screen.'
  if (/violates foreign key/i.test(m)) return 'That article no longer exists. Reload the screen.'
  if (/row-level security|permission denied/i.test(m)) return REFUSED
  return m
}
