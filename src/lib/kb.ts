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
