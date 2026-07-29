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

  const errs = [artRes.error?.message, tourRes.error?.message].filter(Boolean)
  return {
    articles: (artRes.data ?? []) as KbArticle[],
    tours: (tourRes.data ?? []) as KbTour[],
    ...(errs.length ? { loadError: errs.join('; ') } : {}),
  }
}

/* Contextual help: the article bound to the screen you are on, if any. */
export async function articleForView(persona: string, view: string): Promise<KbArticle | null> {
  const { data, error } = await supabase.from('kb_articles').select('*')
    .eq('persona', persona).eq('status', 'published').eq('view', view)
    .order('sort_order').limit(1)
  if (error) return null
  return (data && data[0] ? data[0] : null) as KbArticle | null
}
