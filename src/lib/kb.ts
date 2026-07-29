/* The knowledge base's pure layer: shapes, the fixed kind vocabulary, and the
   filtering the list screen does. No React, no Supabase, no I/O. */

export type KbStatus = 'published' | 'held'

export interface KbKind { id: string; label: string; icon: string }

export interface KbArticle {
  id: string
  persona: string
  kind: string
  title: string
  mins: number
  updated: string | null
  /* A React view id, or null where this app has no such screen. */
  view: string | null
  roles: string[]
  tags: string[]
  summary: string
  /* Ordered [heading, prose] pairs, exactly as the prototype holds them. */
  body: [string, string][]
  status: KbStatus
  sort_order: number
}

export interface KbTourStop { view: string | null; at: string; say: string }

export interface KbTour {
  id: string
  persona: string
  title: string
  mins: number
  why: string
  stops: KbTourStop[]
  status: KbStatus
  sort_order: number
}

/* A fixed vocabulary, not data — carried over from the prototype. */
export const KB_KINDS: KbKind[] = [
  { id: 'start',   label: 'Getting started',    icon: 'play' },
  { id: 'howto',   label: 'How to',             icon: 'checklist' },
  { id: 'concept', label: 'How it works',       icon: 'info' },
  { id: 'policy',  label: 'Rules and limits',   icon: 'shield' },
  { id: 'fix',     label: 'When it goes wrong', icon: 'warning' },
]

export const KB_STALE_DAYS = 180

export function kbKind(id: string): KbKind {
  return KB_KINDS.find(k => k.id === id) ?? { id, label: id, icon: 'file' }
}

export function filterArticles(
  all: KbArticle[],
  f: { kind?: string; tag?: string; q?: string },
): KbArticle[] {
  const q = (f.q || '').trim().toLowerCase()
  return all.filter(a => {
    if (f.kind && a.kind !== f.kind) return false
    if (f.tag && !a.tags.includes(f.tag)) return false
    if (q && !(a.title.toLowerCase().includes(q) || a.summary.toLowerCase().includes(q))) return false
    return true
  })
}

export function allTags(all: KbArticle[]): string[] {
  return [...new Set(all.flatMap(a => a.tags))].sort()
}

/* Role scoping governs ACTING, not reading. An article with no roles is open to
   everyone; an unknown role is treated as open, because somebody trying to
   understand why they cannot do a thing is exactly who needs the article. */
export function canAct(a: KbArticle, myRole: string | null): boolean {
  if (!a.roles || a.roles.length === 0) return true
  if (!myRole) return true
  return a.roles.includes(myRole)
}
