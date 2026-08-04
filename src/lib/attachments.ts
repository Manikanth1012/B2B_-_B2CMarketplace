/* Files a customer attaches to a support ticket. No React and no Supabase, so
   the rules can be tested without a network or a file picker.

   The rules exist because an upload form is one of the few places a customer
   can hand the marketplace something it then has to store, serve and eventually
   explain. What it accepts, how big, how many, and what it refuses to promise
   about a file it has not scanned — all of that belongs somewhere it can be
   read, rather than scattered across an input's `accept` attribute. */

export type Check = { ok: true; note?: string } | { ok: false; reason: string }

export type AttachmentKind = 'evidence' | 'document' | 'screenshot' | 'other'
export type ScanState = 'pending' | 'clean' | 'blocked'

export interface Attachment {
  id: string
  ticket_id: string
  path: string | null
  filename: string
  mime: string
  bytes: number
  kind: AttachmentKind
  caption: string | null
  uploaded_by: string
  user_id: string | null
  uploaded_at: string
  scan: ScanState
  sort_order: number
}

/* What the bucket is configured to take. Repeated here so the picker can refuse
   before the upload rather than after, and kept in step with the
   `allowed_mime_types` on `ticket-attachments` — a form that offers what the
   bucket rejects is a form that wastes somebody's data allowance. */
export const ACCEPTED: { mime: string; ext: string[]; label: string }[] = [
  { mime: 'image/jpeg', ext: ['.jpg', '.jpeg'], label: 'Photo' },
  { mime: 'image/png', ext: ['.png'], label: 'Photo or screenshot' },
  { mime: 'image/webp', ext: ['.webp'], label: 'Photo' },
  { mime: 'image/heic', ext: ['.heic'], label: 'Photo from an iPhone' },
  { mime: 'application/pdf', ext: ['.pdf'], label: 'Document' },
  { mime: 'text/plain', ext: ['.txt', '.log'], label: 'Log or note' },
]

export const MAX_BYTES = 10 * 1024 * 1024
export const MAX_FILES = 5

export const ACCEPT_ATTRIBUTE = ACCEPTED.flatMap(a => [a.mime, ...a.ext]).join(',')

/** The friendly list the form prints, without repeating "photo" three times. */
export function acceptedLabel(): string {
  return 'Photos, PDFs and text logs'
}

/**
 * Whether one file can be attached.
 *
 * The type check is on the declared MIME with the extension as a fallback,
 * because browsers disagree about what a `.heic` from an iPhone is and some
 * send an empty type rather than guess. An empty type with a known extension is
 * accepted; the bucket checks again on the way in.
 */
export function validateFile(
  file: { name: string; type: string; size: number },
  already: readonly { filename: string; bytes: number }[] = [],
): Check {
  const name = file.name.trim()
  if (!name) return { ok: false, reason: 'That file has no name.' }

  if (file.size <= 0) {
    return { ok: false, reason: `${name} is empty. Check it saved properly before attaching it.` }
  }
  if (file.size > MAX_BYTES) {
    return {
      ok: false,
      reason: `${name} is ${sizeOf(file.size)} — the limit is ${sizeOf(MAX_BYTES)}. A photo taken on a phone is usually well under it; a video is not, so describe what it shows instead.`,
    }
  }
  if (already.length >= MAX_FILES) {
    return { ok: false, reason: `You can attach ${MAX_FILES} files. Remove one first.` }
  }
  if (already.some(a => a.filename === name && a.bytes === file.size)) {
    return { ok: false, reason: `${name} is already attached.` }
  }

  const ext = name.slice(name.lastIndexOf('.')).toLowerCase()
  const byMime = ACCEPTED.find(a => a.mime === file.type.toLowerCase())
  const byExt = ACCEPTED.find(a => a.ext.includes(ext))
  if (!byMime && !byExt) {
    return {
      ok: false,
      reason: `${name} is not a kind of file we can take. ${acceptedLabel()} — anything else, describe it in the message.`,
    }
  }

  return { ok: true, note: `${name} · ${sizeOf(file.size)}` }
}

/** Whether the whole set can go up together. */
export function validateSet(files: readonly { name: string; type: string; size: number }[]): Check {
  if (files.length > MAX_FILES) {
    return { ok: false, reason: `You can attach ${MAX_FILES} files — that is ${files.length}.` }
  }
  const total = files.reduce((a, f) => a + f.size, 0)
  if (total > MAX_BYTES * 2) {
    return { ok: false, reason: `That is ${sizeOf(total)} altogether, which is more than we can take in one go.` }
  }
  for (const f of files) {
    const one = validateFile(f, [])
    if (!one.ok) return one
  }
  return { ok: true }
}

/**
 * What kind of thing this file appears to be.
 *
 * A guess, offered as a default the customer can change — not a classification.
 * A screenshot and a photograph of a damaged parcel are both PNGs and mean
 * entirely different things to the desk.
 */
export function guessKind(file: { name: string; type: string }): AttachmentKind {
  const n = file.name.toLowerCase()
  if (/screen[ _-]?shot|screen[ _-]?grab|capture/.test(n)) return 'screenshot'
  if (file.type === 'application/pdf' || /invoice|receipt|statement|report/.test(n)) return 'document'
  if (file.type.startsWith('image/')) return 'evidence'
  return 'other'
}

/**
 * Where the bytes go.
 *
 * The first folder is the uploader's own user id, which is what the storage
 * policy keys on — a path outside your own folder is refused by the bucket
 * rather than by good manners. The rest is the ticket and a safe filename.
 */
export function storagePath(userId: string, ticketId: string, filename: string): string {
  return `${userId}/${ticketId}/${Date.now()}-${safeName(filename)}`
}

/**
 * Where a dispute's evidence goes — the dispute id first, not the uploader.
 *
 * Deliberately the other way round from a ticket's. A ticket attachment is one
 * person's file about their own problem, so their folder is the right unit. A
 * dispute is an argument with at least three interested parties: the seller who
 * uploaded it, their colleague who picks the thread up on Monday, and the
 * marketplace deciding it. Filing it under the uploader would mean the
 * colleague cannot open the photograph their own company sent.
 */
export function disputePath(disputeId: string, filename: string): string {
  return `${disputeId}/${Date.now()}-${safeName(filename)}`
}

/**
 * Lowercase, no spaces, nothing that changes meaning in a URL or a shell.
 *
 * The directory part goes first, before anything looks for an extension.
 * `../../etc/passwd` has its last dot inside `../..`, so splitting on that dot
 * first produces `file.etcpasswd` — traversal defeated but the name nonsense.
 * Taking the basename first gives `passwd`, which is what the customer's
 * browser would have called it anyway.
 */
export function safeName(filename: string): string {
  const base = filename.split(/[\\/]/).pop() ?? filename
  const dot = base.lastIndexOf('.')
  const hasExt = dot > 0                       // a leading dot is a name, not an extension
  const stem = (hasExt ? base.slice(0, dot) : base)
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60)
  const ext = (hasExt ? base.slice(dot) : '').toLowerCase().replace(/[^a-z0-9.]/g, '')
  return `${stem || 'file'}${ext}`
}

/**
 * What to say about a file nobody has scanned yet.
 *
 * Deliberately not silence. A screen that shows a download button beside an
 * unscanned file is implying something it has no reason to believe, and the
 * person clicking it is usually a support agent on a work machine.
 */
export function scanNote(scan: ScanState): { tone: 'ok' | 'warn' | 'bad'; text: string } {
  switch (scan) {
    case 'clean':
      return { tone: 'ok', text: 'Scanned' }
    case 'blocked':
      return { tone: 'bad', text: 'Blocked — this file did not pass the scan and cannot be opened' }
    default:
      return { tone: 'warn', text: 'Not scanned yet — open it only if you were expecting it' }
  }
}

export function canOpen(a: Attachment): boolean {
  return a.scan !== 'blocked' && !!a.path
}

/**
 * Whether the customer can still take a file back.
 *
 * Before the desk has replied, changing your mind is reasonable. Afterwards it
 * is editing a record somebody has already acted on, which is why the database
 * refuses it too.
 */
export function canWithdraw(
  a: Attachment, me: { user_id: string | null } | null, ticket: { messages: unknown[] },
): Check {
  if (!me?.user_id || a.user_id !== me.user_id) {
    return { ok: false, reason: 'You can only remove a file you attached yourself.' }
  }
  if (ticket.messages.length > 1) {
    return {
      ok: false,
      reason: 'Support has already replied on this ticket, so what you sent stays on the record. Say what is wrong with it in a reply instead.',
    }
  }
  return { ok: true, note: `${a.filename} will be removed and not kept.` }
}

/** "1.2 MB", decimal — matching what a file manager shows. */
export function sizeOf(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '—'
  if (bytes < 1000) return `${bytes} B`
  const units = ['kB', 'MB', 'GB']
  let n = bytes / 1000
  let i = 0
  while (n >= 1000 && i < units.length - 1) { n /= 1000; i++ }
  return `${n < 10 ? n.toFixed(1) : Math.round(n)} ${units[i]}`
}
