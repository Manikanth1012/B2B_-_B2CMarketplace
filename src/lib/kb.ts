/* The knowledge base's pure layer: shapes, the fixed kind vocabulary, and the
   filtering the list screen does. No React, no Supabase, no I/O. */

export type KbStatus = 'published' | 'held'

export interface KbKind { id: string; label: string; icon: string }

export interface KbArticle {
  id: string
  /* The console this article was written from. Not the audience — `personas`
     is. Kept because it decides where an article sorts in the operator's own
     list, and dropping it would rewrite every seed for no gain. */
  persona: string
  /* Every persona it is published to. One article can be the same article for
     a retail customer and a business buyer; writing it twice is how two copies
     of one policy drift apart. */
  personas: string[]
  audience_note: string
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

/* ------------------------------------------------------------ attachments -- */

/**
 * A file hanging off an article — a manual, a datasheet, a brochure, a video,
 * a template.
 *
 * `path` is a file the marketplace hosts in the `kb-assets` bucket; `url` is
 * one it points at elsewhere. Exactly one is set, which the database enforces,
 * because an asset offering neither is a download button that does nothing.
 */
export type KbAssetKind = 'manual' | 'datasheet' | 'brochure' | 'video' | 'template' | 'other'

export interface KbAsset {
  id: string
  article_id: string
  kind: KbAssetKind
  title: string
  description: string
  path: string | null
  url: string | null
  mime: string
  bytes: number | null
  duration_secs: number | null
  pages: number | null
  language: string
  updated: string | null
  sort_order: number
}

export const KB_ASSET_KINDS: { id: KbAssetKind; label: string; plural: string }[] = [
  { id: 'manual',    label: 'Manual',     plural: 'Manuals and guides' },
  { id: 'datasheet', label: 'Datasheet',  plural: 'Datasheets' },
  { id: 'brochure',  label: 'Brochure',   plural: 'Brochures' },
  { id: 'video',     label: 'Video',      plural: 'Videos' },
  { id: 'template',  label: 'Template',   plural: 'Templates' },
  { id: 'other',     label: 'Attachment', plural: 'Other files' },
]

export function assetKind(id: string): { id: KbAssetKind; label: string; plural: string } {
  return KB_ASSET_KINDS.find(k => k.id === id) ?? KB_ASSET_KINDS[KB_ASSET_KINDS.length - 1]
}

export function assetsFor(all: readonly KbAsset[], articleId: string): KbAsset[] {
  return all
    .filter(a => a.article_id === articleId)
    .sort((a, b) => a.sort_order - b.sort_order || a.title.localeCompare(b.title))
}

/** Grouped the way the panel renders them, in the fixed kind order, skipping
    any group with nothing in it. */
export function assetsByKind(all: readonly KbAsset[]): { kind: KbAssetKind; label: string; assets: KbAsset[] }[] {
  return KB_ASSET_KINDS
    .map(k => ({ kind: k.id, label: k.plural, assets: all.filter(a => a.kind === k.id) }))
    .filter(g => g.assets.length > 0)
}

/**
 * What to print under an asset's name: how big it is, and how long it takes.
 *
 * A reader deciding whether to click wants both before they do, not after. A
 * video gets its running time, a document its page count, everything else its
 * size alone.
 */
export function assetMeta(a: KbAsset): string {
  const bits: string[] = [assetKind(a.kind).label]
  if (a.kind === 'video' && a.duration_secs) bits.push(duration(a.duration_secs))
  else if (a.pages) bits.push(`${a.pages} page${a.pages === 1 ? '' : 's'}`)
  if (a.bytes) bits.push(fileSize(a.bytes))
  if (a.language && a.language !== 'English') bits.push(a.language)
  /* Folded in rather than appended by the component, which was producing
     "Manual · 2 pages · 3.3 kB · · updated 2026-07-15" — two separators and a
     date in the format a database uses rather than one a person reads. */
  if (a.updated) bits.push(`updated ${reviewed(a.updated)}`)
  return bits.join(' · ')
}

/** "15 Jul 2026". The column is a date, and a reader is not reading a log. */
export function reviewed(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

/** "1.2 MB". Decimal rather than binary, because that is what a file manager
    shows and a reader comparing the two should not see a discrepancy. */
export function fileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '—'
  if (bytes < 1000) return `${bytes} B`
  const units = ['kB', 'MB', 'GB']
  let n = bytes / 1000
  let i = 0
  while (n >= 1000 && i < units.length - 1) { n /= 1000; i++ }
  return `${n < 10 ? n.toFixed(1) : Math.round(n)} ${units[i]}`
}

/** "2:04", or "45 sec" under a minute — a bare "0:45" reads as a timestamp. */
export function duration(secs: number): string {
  if (!Number.isFinite(secs) || secs <= 0) return '—'
  if (secs < 60) return `${Math.round(secs)} sec`
  const m = Math.floor(secs / 60)
  const s = Math.round(secs % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

/* ================================================================ FAQs === */

/* An article is four hundred words with a title, a summary and a reading time.
   A frequently asked question is one sentence and its answer. Filing the second
   as the first produces a page of four-hundred-word articles called "Can I
   change my plan mid-month?", so they are their own shape. */
export interface KbFaq {
  id: string
  question: string
  answer: string
  personas: string[]
  topic: string
  status: KbStatus
  /* How often it is asked, and how often the answer helped. A question nobody
     asks is clutter; a question everybody asks is an article waiting to be
     written. */
  asked: number
  helpful: number
  /* Set when the answer is really an article and the FAQ is the doorway. */
  article_id: string | null
  updated: string
  updated_by: string | null
  sort_order: number
}

export const PERSONAS: { id: string; label: string; note: string }[] = [
  { id: 'consumer', label: 'Retail customers', note: 'Plans, devices, subscriptions and rewards.' },
  { id: 'enterprise', label: 'Business accounts', note: 'Requisitions, approvals, cost centres and invoices.' },
  { id: 'partner', label: 'Sellers', note: 'Listings, onboarding and settlement.' },
  { id: 'operator', label: 'Marketplace staff', note: 'The operator console itself.' },
]

export function personaLabel(id: string): string {
  return PERSONAS.find(p => p.id === id)?.label ?? id
}

/** Whether this reader is one of the people it was published to. */
export function publishedTo(item: { personas: string[]; status: KbStatus }, persona: string): boolean {
  return item.status === 'published' && item.personas.includes(persona)
}

/** The questions a reader sees, newest-first within a topic. */
export function faqsFor(all: readonly KbFaq[], persona: string): KbFaq[] {
  return all
    .filter(f => publishedTo(f, persona))
    .sort((a, b) => a.sort_order - b.sort_order)
}

/** Grouped by topic, in the order the topics first appear. */
export function faqsByTopic(faqs: readonly KbFaq[]): { topic: string; faqs: KbFaq[] }[] {
  const out: { topic: string; faqs: KbFaq[] }[] = []
  for (const f of faqs) {
    const bucket = out.find(b => b.topic === f.topic)
    if (bucket) bucket.faqs.push(f)
    else out.push({ topic: f.topic, faqs: [f] })
  }
  return out
}

export function searchFaqs(all: readonly KbFaq[], q: string): KbFaq[] {
  const needle = q.trim().toLowerCase()
  if (!needle) return [...all]
  return all.filter(f =>
    f.question.toLowerCase().includes(needle)
    || f.answer.toLowerCase().includes(needle)
    || f.topic.toLowerCase().includes(needle))
}

/**
 * How useful an answer has been.
 *
 * Null rather than zero when nobody has voted: "0% helpful" and "nobody has
 * said" are different facts, and showing the first for the second condemns a
 * new answer for being new.
 */
export function helpfulness(f: Pick<KbFaq, 'asked' | 'helpful'>): number | null {
  if (f.asked <= 0) return null
  return Math.round((f.helpful / f.asked) * 100)
}

/* ------------------------------------------------------- authoring rules -- */

export type Check = { ok: true; note?: string } | { ok: false; reason: string }

/**
 * Whether this is something a reader could actually be given.
 *
 * Published to nobody is the refusal that matters. It reads as live on the
 * author's list and appears on no reader's screen — a withdrawal wearing the
 * costume of a publication, which the author discovers when somebody asks
 * where their article went.
 */
export function validateAudience(
  item: { personas: readonly string[]; status: KbStatus },
): Check {
  const known = new Set(PERSONAS.map(p => p.id))
  const bad = item.personas.filter(p => !known.has(p))
  if (bad.length) return { ok: false, reason: `${bad.join(', ')} is not an audience this marketplace has.` }

  if (item.status === 'published' && item.personas.length === 0) {
    return {
      ok: false,
      reason: 'This would be published to nobody, so nobody could read it. Choose at least one audience, or hold it as a draft instead.',
    }
  }
  if (item.personas.length === 0) {
    return { ok: true, note: 'Held as a draft, addressed to nobody yet.' }
  }
  return {
    ok: true,
    note: item.status === 'published'
      ? `Readable by ${item.personas.map(personaLabel).join(' and ')}.`
      : `Held. When published it will reach ${item.personas.map(personaLabel).join(' and ')}.`,
  }
}

export function validateArticle(
  draft: { title: string; summary: string; personas: readonly string[]; status: KbStatus },
): Check {
  if (!draft.title.trim()) return { ok: false, reason: 'An article needs a title — it is what the list shows and what search matches.' }
  if (!draft.summary.trim()) {
    return { ok: false, reason: 'An article needs a summary. It is the line under the title, and an article nobody can tell apart from its neighbours is an article nobody opens.' }
  }
  return validateAudience(draft)
}

export function validateFaq(
  draft: { question: string; answer: string; personas: readonly string[]; status: KbStatus },
): Check {
  const q = draft.question.trim()
  if (!q) return { ok: false, reason: 'A question is the whole point of a FAQ.' }
  if (!q.endsWith('?')) {
    return { ok: false, reason: 'Write it as a question, ending in a question mark. Readers scan this tab for the thing they were about to ask.' }
  }
  if (!draft.answer.trim()) return { ok: false, reason: 'An answer is required. A question with no answer is a list of things this marketplace cannot explain.' }
  return validateAudience(draft)
}

/**
 * Whether a FAQ may point at this article.
 *
 * A doorway to a room the reader cannot enter is worse than no doorway: they
 * click, and either nothing happens or they are told they may not see it.
 */
export function canLink(
  faq: { personas: readonly string[]; status: KbStatus },
  article: { id: string; title: string; personas: string[]; status: KbStatus },
): Check {
  if (faq.status === 'published' && article.status !== 'published') {
    return { ok: false, reason: `${article.title} is still a draft. A published question cannot open an unpublished answer.` }
  }
  const shared = faq.personas.some(p => article.personas.includes(p))
  if (faq.personas.length > 0 && !shared) {
    return {
      ok: false,
      reason: `${article.title} is not published to ${faq.personas.map(personaLabel).join(' or ')}, so this question would open a door they cannot walk through.`,
    }
  }
  return { ok: true }
}

/** What the operator's list should be worried about. */
export function kbWarnings(
  articles: readonly KbArticle[], faqs: readonly KbFaq[],
): { level: 'warn' | 'info'; text: string }[] {
  const out: { level: 'warn' | 'info'; text: string }[] = []

  for (const p of ['consumer', 'enterprise', 'partner']) {
    if (!articles.some(a => publishedTo(a, p))) {
      out.push({ level: 'warn', text: `${personaLabel(p)} have no published articles at all.` })
    }
    if (!faqs.some(f => publishedTo(f, p))) {
      out.push({ level: 'warn', text: `${personaLabel(p)} have no published questions, so their FAQ tab is empty.` })
    }
  }

  const orphan = faqs.filter(f => f.status === 'published' && f.personas.length === 0)
  if (orphan.length) {
    out.push({ level: 'warn', text: `${orphan.length} published question${orphan.length === 1 ? ' is' : 's are'} addressed to nobody.` })
  }

  /* Asked a lot and rarely found helpful is the most useful signal here: it is
     a question people have and an answer that is not answering it. */
  const failing = faqs.filter(f => f.asked >= 50 && (helpfulness(f) ?? 100) < 60)
  if (failing.length) {
    out.push({
      level: 'info',
      text: `${failing.length} question${failing.length === 1 ? '' : 's'} asked often and rarely found helpful: ${failing.map(f => f.question).join(' · ')}`,
    })
  }

  return out
}
