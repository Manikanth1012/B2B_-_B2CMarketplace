/* Getting a document out of the private bucket.
 *
 * A signed URL, not a public one. The bucket is private because these are
 * passports, bank verification letters and beneficial ownership declarations,
 * and a public URL is a URL forever — deleting the row does not un-share the
 * link somebody already has.
 *
 * Storage refuses by saying the object does not exist, which is correct of it
 * and unhelpful on a screen. `evidence.ts` states the same rule ahead of the
 * request so the console can say something true instead.
 */
import { supabase } from './supabase'
import { canOpen, fileNameFor, LINK_SECONDS } from './evidence'
import type { Viewer } from './evidence'

export const BUCKET = 'evidence'

export interface OpenResult {
  url: string | null
  error: string | null
}

/**
 * A short-lived link to one document.
 *
 * `download` asks storage to send a Content-Disposition, so the same call
 * serves both buttons: View opens it in a tab, Download saves it under the
 * document's own name rather than under the row id the path is built from.
 */
export async function openEvidence(
  viewer: Viewer,
  doc: { path?: string | null; name: string; id: string },
  opts: { download?: boolean } = {},
): Promise<OpenResult> {
  if (!doc.path) return { url: null, error: 'Nothing has been uploaded against this record yet.' }
  if (!canOpen(viewer, doc.path)) {
    return { url: null, error: 'This document belongs to another party and is not yours to open.' }
  }

  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(
    doc.path, LINK_SECONDS,
    opts.download ? { download: fileNameFor(doc.name, doc.id, doc.path) } : undefined,
  )

  if (error || !data?.signedUrl) {
    /* Storage says "Object not found" both when the file is missing and when
       the policy refused. The check above has already ruled out the second, so
       this is the first — and saying so sends somebody to the right place. */
    return { url: null, error: 'The file is missing from the document store. Nothing was deleted from the record.' }
  }
  return { url: data.signedUrl, error: null }
}

/** The customer's own records. Ordered as the account presents them, not by id. */
export async function loadConsumerDocuments(): Promise<{
  documents: ConsumerDocument[]; loadError: string | null
}> {
  const { data, error } = await supabase
    .from('consumer_documents').select('*').order('sort_order')
  return {
    documents: (data ?? []) as ConsumerDocument[],
    loadError: error ? error.message : null,
  }
}

export interface ConsumerDocument {
  id: string
  name: string
  kind: string
  category: string
  issued: string
  detail: string
  path: string | null
  size: string
  sort_order: number
}
