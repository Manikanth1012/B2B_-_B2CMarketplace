/* What the account holder can produce when somebody asks them to.
 *
 * A retail customer had no documents at all. Not a thin list — no table, no
 * concept: the agreement they signed, the mandate the bank quotes back at them,
 * the cover certificate they need when the handset goes through a washing
 * machine, none of it existed anywhere they could reach. The seller and the
 * business account both had a document trail and the customer had a bill.
 *
 * Each row says what the document is for in a sentence, because the names
 * alone do not distinguish "the mandate" from "the agreement that mentions the
 * mandate", and the customer opening this is looking for one of them.
 */
import { useState, useEffect } from 'react'
import { FileText, ShieldCheck } from 'lucide-react'
import { loadConsumerDocuments } from '../../lib/evidenceRepo'
import type { ConsumerDocument } from '../../lib/evidenceRepo'
import { EvidenceLink } from '../EvidenceLink'
import type { Viewer } from '../../lib/evidence'
import { Pager, usePaging } from '../Pager'

export function CustomerDocuments({ viewer }: { viewer: Viewer }) {
  const [docs, setDocs] = useState<ConsumerDocument[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    loadConsumerDocuments().then(r => {
      if (!live) return
      setDocs(r.documents); setError(r.loadError); setLoading(false)
    })
    return () => { live = false }
  }, [])

  /* Hooks before any early return. A `usePaging` below a `if (loading)` is a
     conditional hook, and React responds by rendering nothing at all. */
  const paged = usePaging(docs, { initialSize: 5 })

  if (loading) {
    return <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)' }}>Loading your documents…</p>
  }

  if (error) {
    return <p style={{ fontSize: 'var(--text-sm)', color: 'var(--danger)' }}>{error}</p>
  }

  if (docs.length === 0) {
    return (
      <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)' }}>
        Nothing on file yet. Documents appear here as the account collects them — the agreement when it
        opens, a confirmation whenever the plan changes, and a certificate for anything covered.
      </p>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <div style={{
        display: 'flex', gap: '10px', alignItems: 'flex-start', padding: '12px 14px',
        background: 'var(--info-bg)', borderLeft: '3px solid var(--info)', borderRadius: 'var(--radius-md)',
      }}>
        <ShieldCheck size={16} style={{ color: 'var(--info)', flexShrink: 0, marginTop: '1px' }} />
        <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', margin: 0, lineHeight: 1.5 }}>
          Yours to keep. Every link is signed for a couple of minutes and only works while you are signed in,
          so a link forwarded to somebody else is a dead link by the time they open it.
        </p>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {paged.rows.map(d => (
          <div key={d.id} style={{
            display: 'flex', gap: '12px', alignItems: 'center', padding: '12px 14px',
            border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', background: 'white',
          }}>
            <span style={{
              width: 34, height: 34, flexShrink: 0, borderRadius: 'var(--radius-sm)', background: 'var(--bg-alt)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-tertiary)',
            }}><FileText size={17} /></span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 'var(--text-sm)', fontWeight: 700, color: 'var(--text)' }}>{d.name}</div>
              <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
                {d.category} · {d.issued} · {d.kind} {d.size}
              </div>
              <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', margin: '4px 0 0', lineHeight: 1.45 }}>
                {d.detail}
              </p>
            </div>
            <EvidenceLink viewer={viewer} doc={d} />
          </div>
        ))}
      </div>

      <Pager page={paged} noun="documents" />
    </div>
  )
}
