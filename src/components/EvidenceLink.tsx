/* The View and Download buttons that actually open a document.
 *
 * Every console shows document rows and every one of them had its own idea of
 * what View meant — the seller console opened a panel describing the file, the
 * operator's did the same, and the business console did not offer the button at
 * all. One component, so a document opens the same way from all four consoles
 * and the access rule is stated once.
 *
 * The link is signed and short-lived, so it is fetched at the moment of the
 * click rather than rendered into the page: a page that holds fifty live URLs
 * to passports is a page worth being careful about, and most of them will never
 * be clicked.
 */
import { useState } from 'react'
import { Download, ExternalLink, Loader as Loader2 } from 'lucide-react'
import { openEvidence } from '../lib/evidenceRepo'
import { whyNot } from '../lib/evidence'
import type { Viewer } from '../lib/evidence'

export interface EvidenceDoc {
  id: string
  name: string
  path?: string | null
}

const BTN: React.CSSProperties = {
  fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--brand-navy)',
  background: 'white', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)',
  padding: '4px 10px', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '4px',
}

export function EvidenceLink({ viewer, doc, compact }: {
  viewer: Viewer
  doc: EvidenceDoc
  /* Drop the labels where the row is already crowded. */
  compact?: boolean
}) {
  const [busy, setBusy] = useState<'view' | 'download' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const blocked = whyNot(viewer, doc)

  async function go(mode: 'view' | 'download') {
    setBusy(mode); setError(null)
    const res = await openEvidence(viewer, doc, { download: mode === 'download' })
    setBusy(null)
    if (!res.url) { setError(res.error); return }
    /* `noopener` because the signed URL is on a different origin and the opened
       tab has no business reaching back into this one. */
    window.open(res.url, '_blank', 'noopener,noreferrer')
  }

  if (blocked) {
    return (
      <span title={blocked} style={{ fontSize: '10px', color: 'var(--text-tertiary)', whiteSpace: 'nowrap' }}>
        {doc.path ? 'Not yours' : 'Not uploaded'}
      </span>
    )
  }

  return (
    <span style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'flex-end', gap: '3px' }}>
      <span style={{ display: 'inline-flex', gap: '5px' }}>
        <button onClick={() => go('view')} disabled={busy !== null} style={BTN} aria-label={`View ${doc.name}`}>
          {busy === 'view' ? <Loader2 size={12} /> : <ExternalLink size={12} />}
          {!compact && 'View'}
        </button>
        <button onClick={() => go('download')} disabled={busy !== null} style={BTN} aria-label={`Download ${doc.name}`}>
          {busy === 'download' ? <Loader2 size={12} /> : <Download size={12} />}
          {!compact && 'Download'}
        </button>
      </span>
      {error && (
        <span style={{ fontSize: '10px', color: 'var(--danger)', maxWidth: '220px', textAlign: 'right', whiteSpace: 'normal' }}>{error}</span>
      )}
    </span>
  )
}
