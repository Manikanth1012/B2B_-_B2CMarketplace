/* Who may open a document, and what it is called when they do.
 *
 * The bucket's own rule is one line of SQL — the first path segment is the
 * counterparty the document belongs to — and storage enforces it whatever this
 * file says. But a console that offers a View button on a row it can never open
 * is worse than one that offers nothing: the reviewer clicks, waits, and is told
 * the object does not exist, which is what a storage policy says when it means
 * "not yours". So the same rule is stated here, ahead of the request, and the
 * button is simply not offered.
 *
 * Two statements of one rule is a thing worth being nervous about. The
 * integration suite reads both — every path in the database against `canOpen`,
 * and every persona against the bucket itself — so a policy changed on one side
 * and not the other fails a test rather than a user.
 */

export type Persona = 'operator' | 'partner' | 'enterprise' | 'consumer'

/** Who is asking, in the only terms the bucket understands. */
export interface Viewer {
  persona: Persona | null
  /** The seller's id, for a seller. Null for everybody else. */
  partnerId?: string | null
  /** The business account's id, for a buyer on that account. */
  accountId?: string | null
  /** The retail customer's own id. */
  customerId?: string | null
}

/** The counterparty a document belongs to — the first segment, and the whole
 *  access rule. A path with no segment separator belongs to nobody. */
export function folderOf(path: string | null | undefined): string | null {
  if (!path) return null
  const cut = path.indexOf('/')
  return cut <= 0 ? null : path.slice(0, cut)
}

/**
 * Whether this viewer may open this document.
 *
 * The operator may open anything — reviewing evidence is the job. Everybody
 * else may open their own folder and nothing else, matched against the id their
 * persona carries: a seller's `partnerId` never matches a business account's
 * folder, and a null id never matches anything at all, which is the behaviour
 * wanted for a signed-out viewer.
 */
export function canOpen(viewer: Viewer, path: string | null | undefined): boolean {
  const folder = folderOf(path)
  if (!folder) return false
  if (viewer.persona === 'operator') return true

  const mine =
    viewer.persona === 'partner' ? viewer.partnerId
    : viewer.persona === 'enterprise' ? viewer.accountId
    : viewer.persona === 'consumer' ? viewer.customerId
    : null

  return !!mine && mine === folder
}

/**
 * How long a link to a document should live.
 *
 * Long enough to click and for a reader to load, short enough that a URL pasted
 * into a chat window is a dead link by the time anybody follows it. These are
 * passports and bank letters; the link is the document.
 */
export const LINK_SECONDS = 120

/**
 * What the file is called when it lands in somebody's downloads folder.
 *
 * The stored path is derived from a row id — `doc-ptr-1004-kyc-2.pdf` — which
 * is right for a bucket and useless in a downloads folder. The document's own
 * name, reduced to something every filesystem accepts, with the reference
 * appended so two documents of the same name do not overwrite each other.
 */
export function fileNameFor(name: string, reference: string, path?: string | null): string {
  const ext = (path?.match(/\.([A-Za-z0-9]{1,5})$/)?.[1] ?? 'pdf').toLowerCase()
  const stem = name
    .normalize('NFKD')
    .replace(/[^\w\s-]+/g, ' ')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 70)
    .replace(/^-|-$/g, '')
  return `${stem || 'document'}-${reference}.${ext}`
}

/**
 * Why a document cannot be opened, in words for the person looking at it.
 *
 * Three different situations look identical on the screen — nothing was ever
 * uploaded, something was uploaded but this viewer is not entitled to it, and
 * the file is simply missing — and telling them apart is the difference between
 * "chase the seller" and "raise a bug".
 */
export function whyNot(viewer: Viewer, doc: { path?: string | null }): string | null {
  if (!doc.path) return 'Nothing has been uploaded against this record yet.'
  if (!canOpen(viewer, doc.path)) return 'This document belongs to another party and is not yours to open.'
  return null
}
