/* The only module that uploads a ticket attachment or fetches one back.
   Rules live in attachments.ts so they can be tested without a network. */

import { supabase } from './supabase'
import { validateFile, guessKind, storagePath, disputePath, canWithdraw } from './attachments'
import type { Attachment, Check } from './attachments'

export type Result = Check

const BUCKET = 'ticket-attachments'

/** The attachments on one ticket, oldest first — the order they were sent in is
    the order the desk reads them. */
export async function loadAttachments(ticketId: string): Promise<Attachment[]> {
  const { data } = await supabase
    .from('support_attachments').select('*')
    .eq('ticket_id', ticketId)
    .order('sort_order').order('uploaded_at')
  return (data ?? []) as Attachment[]
}

/** Every attachment on a set of tickets, for a queue that wants to show a paper
    clip against the rows that have one without a request per row. */
export async function loadAttachmentsFor(ticketIds: readonly string[]): Promise<Attachment[]> {
  if (!ticketIds.length) return []
  const { data } = await supabase
    .from('support_attachments').select('*')
    .in('ticket_id', ticketIds as string[])
    .order('uploaded_at')
  return (data ?? []) as Attachment[]
}

/**
 * Put a file on a ticket.
 *
 * The bytes go up first and the row second, in that order on purpose: a row
 * pointing at a file that failed to upload is a paper clip that opens nothing,
 * whereas a file with no row is invisible and harmless. If the row fails the
 * object is removed again, so the bucket does not fill with orphans.
 */
export async function attachFile(
  { ticketId, file, caption }: { ticketId: string; file: File; caption?: string },
): Promise<Result & { attachment?: Attachment }> {
  const existing = await loadAttachments(ticketId)
  const check = validateFile(file, existing)
  if (!check.ok) return check

  const { data: session } = await supabase.auth.getUser()
  const uid = session.user?.id
  if (!uid) return { ok: false, reason: 'Sign in before attaching a file.' }

  const path = storagePath(uid, ticketId, file.name)
  const up = await supabase.storage.from(BUCKET).upload(path, file, {
    contentType: file.type || 'application/octet-stream', upsert: false,
  })
  if (up.error) return { ok: false, reason: friendly(up.error.message) }

  const { data, error } = await supabase.from('support_attachments').insert({
    id: `ATT-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    ticket_id: ticketId,
    path,
    filename: file.name,
    mime: file.type || 'application/octet-stream',
    bytes: file.size,
    kind: guessKind(file),
    caption: caption?.trim() || null,
    uploaded_by: session.user?.email ?? 'A customer',
    user_id: uid,
    /* `scan` is stamped by the trigger. Sending it from here would be the
       uploader marking their own file clean. */
    sort_order: existing.length + 1,
  }).select('*').maybeSingle()

  if (error || !data) {
    await supabase.storage.from(BUCKET).remove([path])
    return { ok: false, reason: error ? friendly(error.message) : REFUSED }
  }

  return {
    ok: true,
    note: `${file.name} attached. Support can see it as soon as they open the ticket.`,
    attachment: data as Attachment,
  }
}

/** Everything attached to a dispute — by either side of it. */
export async function loadEvidence(disputeId: string): Promise<Attachment[]> {
  const { data } = await supabase.from('support_attachments')
    .select('*').eq('dispute_id', disputeId).order('sort_order')
  return (data ?? []) as Attachment[]
}

/**
 * Attaching evidence to a dispute.
 *
 * The same validation, the same bucket and the same scan as a ticket
 * attachment, because they are the same kind of thing — the only difference is
 * what the file is about, and that is a column.
 */
export async function attachEvidence(
  { disputeId, file, caption }: { disputeId: string; file: File; caption?: string },
): Promise<Result & { attachment?: Attachment }> {
  const existing = await loadEvidence(disputeId)
  const check = validateFile(file, existing)
  if (!check.ok) return check

  const { data: session } = await supabase.auth.getUser()
  const uid = session.user?.id
  if (!uid) return { ok: false, reason: 'Sign in before attaching a file.' }

  const path = disputePath(disputeId, file.name)
  const up = await supabase.storage.from(BUCKET).upload(path, file, {
    contentType: file.type || 'application/octet-stream', upsert: false,
  })
  if (up.error) return { ok: false, reason: friendly(up.error.message) }

  const { data, error } = await supabase.from('support_attachments').insert({
    id: `ATT-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    dispute_id: disputeId,
    ticket_id: null,
    path,
    filename: file.name,
    mime: file.type || 'application/octet-stream',
    bytes: file.size,
    kind: guessKind(file),
    caption: caption?.trim() || null,
    uploaded_by: session.user?.email ?? 'The seller',
    user_id: uid,
    sort_order: existing.length + 1,
  }).select('*').maybeSingle()

  if (error || !data) {
    /* The row is the record; a file with no row is a file nobody will ever
       find. Take it back out rather than leaving it in the bucket. */
    await supabase.storage.from(BUCKET).remove([path])
    return { ok: false, reason: error ? friendly(error.message) : REFUSED }
  }

  return {
    ok: true,
    note: `${file.name} attached to the dispute. The marketplace sees it as soon as they open it, and so does anybody at your company.`,
    attachment: data as Attachment,
  }
}

/**
 * Taking a piece of evidence back off a dispute.
 *
 * Separate from `withdrawAttachment` because the rule is different, not because
 * the code is. A ticket attachment is frozen once support has replied — the
 * reply may be about the file. A dispute is frozen when the dispute is settled,
 * because evidence removed after a decision is evidence the decision was made
 * on. The database enforces both; this is what the screen says first.
 */
export async function withdrawEvidence(
  { attachment, open }: { attachment: Attachment; open: boolean },
): Promise<Result> {
  const { data: session } = await supabase.auth.getUser()
  if (attachment.user_id !== (session.user?.id ?? null)) {
    return { ok: false, reason: 'You can only remove a file you attached yourself.' }
  }
  if (!open) {
    return {
      ok: false,
      reason: 'This dispute has been decided, and what was attached is what it was decided on. It stays.',
    }
  }

  const { data, error } = await supabase.from('support_attachments')
    .delete().eq('id', attachment.id).select('id')
  if (error) return { ok: false, reason: friendly(error.message) }
  if (!data?.length) return { ok: false, reason: REFUSED }

  if (attachment.path) await supabase.storage.from(BUCKET).remove([attachment.path])
  return { ok: true, note: `${attachment.filename} removed and not kept.` }
}

/**
 * A link that opens the file.
 *
 * Signed and short-lived, because the bucket is private: an attachment is
 * somebody's photograph of their own hallway, and a permanent public URL to it
 * is a permanent public URL to it. Five minutes is long enough to click.
 */
export async function openLink(a: Attachment): Promise<string | null> {
  if (!a.path || a.scan === 'blocked') return null
  const { data } = await supabase.storage.from(BUCKET).createSignedUrl(a.path, 300)
  return data?.signedUrl ?? null
}

/** Take a file back, if the desk has not replied to it yet. */
export async function withdrawAttachment(
  { attachment, ticket }: { attachment: Attachment; ticket: { messages: unknown[] } },
): Promise<Result> {
  const { data: session } = await supabase.auth.getUser()
  const check = canWithdraw(attachment, { user_id: session.user?.id ?? null }, ticket)
  if (!check.ok) return check

  const { data, error } = await supabase.from('support_attachments')
    .delete().eq('id', attachment.id).select('id')
  if (error) return { ok: false, reason: friendly(error.message) }
  if (!data?.length) return { ok: false, reason: REFUSED }

  if (attachment.path) await supabase.storage.from(BUCKET).remove([attachment.path])
  return { ok: true, note: `${attachment.filename} removed.` }
}

/* --------------------------------------------------------------- helpers -- */

const REFUSED = 'Nothing changed — that file was not accepted.'

function friendly(message: string): string {
  const m = message.replace(/^.*?\bERROR:\s*/i, '').trim()
  if (/mime type|not supported/i.test(m)) {
    return 'That kind of file is not one we can take. Photos, PDFs and text logs.'
  }
  if (/exceeded the maximum|too large|payload/i.test(m)) {
    return 'That file is bigger than we can take. The limit is 10 MB.'
  }
  if (/row-level security|permission denied/i.test(m)) {
    return 'You can only attach a file to your own ticket.'
  }
  if (/duplicate key|already exists/i.test(m)) return 'That file is already attached.'
  return m
}
