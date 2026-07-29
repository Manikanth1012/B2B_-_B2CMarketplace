/* The only module that talks to Supabase for the knowledge base. */
import { supabase } from './supabase'
import type { KbArticle, KbTour } from './kb'

export interface KbSnapshot {
  articles: KbArticle[]
  tours: KbTour[]
  /* Set when a query failed. An empty list and a failed read are different
     answers and must not look the same on screen. */
  loadError?: string
}

export async function loadKb(persona: string): Promise<KbSnapshot> {
  const [artRes, tourRes] = await Promise.all([
    supabase.from('kb_articles').select('*')
      .eq('persona', persona).eq('status', 'published').order('sort_order'),
    supabase.from('kb_tours').select('*')
      .eq('persona', persona).eq('status', 'published').order('sort_order'),
  ])

  /* Only the articles query can fail the screen. Nothing renders tours yet — `tours` is
     returned for a later phase to consume — so a `kb_tours` failure with a healthy
     `kb_articles` read must not blank out articles the reader can already see. */
  return {
    articles: (artRes.data ?? []) as KbArticle[],
    tours: (tourRes.data ?? []) as KbTour[],
    ...(artRes.error ? { loadError: artRes.error.message } : {}),
  }
}

export type ArticleForViewResult =
  | { ok: true; article: KbArticle | null }   // null = genuinely none bound
  | { ok: false; reason: string }             // the read failed

/* Contextual help: the article bound to the screen you are on, if any.
   A failed read and "no article for this screen" are different answers —
   the caller must not tell the user "none exists" when the truth is
   "we don't know". */
export async function articleForView(persona: string, view: string): Promise<ArticleForViewResult> {
  const { data, error } = await supabase.from('kb_articles').select('*')
    .eq('persona', persona).eq('status', 'published').eq('view', view)
    .order('sort_order').limit(1)
  if (error) return { ok: false, reason: error.message }
  return { ok: true, article: (data && data[0] ? data[0] : null) as KbArticle | null }
}

/* Content feedback is not a service ticket. Different owner, different urgency,
   different resolution — you fix the article, not the customer's account. It
   carries its own category so it does not inflate service SLA figures. */
export const CONTENT_FEEDBACK_CATEGORY = 'Content feedback'

export async function raiseContentFeedback(
  { article, actor, org, note }: { article: KbArticle; actor: string; org: string; note: string },
): Promise<{ ok: true; ticketId: string } | { ok: false; reason: string }> {
  if (!note.trim()) {
    return { ok: false, reason: 'Tell us what was wrong or missing — an empty report cannot be acted on.' }
  }
  const id = `CF-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
  const { error } = await supabase.from('operator_tickets').insert({
    id,
    subject: `Content feedback — ${article.title}`,
    category: CONTENT_FEEDBACK_CATEGORY,
    priority: 'P3',
    status: 'open',
    opened_by: actor,
    org,
    sla_mins: 2880,
    /* jsonb column — write the array directly. JSON.stringify()-ing it here stores a jsonb
       *string scalar* instead of an array, which breaks every reader that does
       `.messages.map(...)` (see OperatorTickets.handleReply, which writes this same column
       correctly and is the pattern to match). */
    messages: [{ who: actor, when: new Date().toISOString(), text: note }],
  }).select()
  if (error) return { ok: false, reason: `Could not send that: ${error.message}` }
  return { ok: true, ticketId: id }
}
