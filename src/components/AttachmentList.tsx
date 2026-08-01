import { useState } from 'react'
import { Paperclip, FileText, Image as ImageIcon, ExternalLink, ShieldAlert, ShieldCheck, Trash2 } from 'lucide-react'
import { openLink } from '../lib/attachmentRepo'
import { scanNote, canOpen, sizeOf } from '../lib/attachments'
import type { Attachment } from '../lib/attachments'

/* What a customer sent with their complaint, shown to whoever is allowed to see
   it — the person who raised the ticket, and the desk working it.
 *
 * The link is minted on click rather than held in the markup. The bucket is
 * private and the URL is signed for five minutes: an attachment is somebody's
 * photograph of their own hallway, and a page that renders a permanent link to
 * it has published it to anybody who views source.
 */
export function AttachmentList({ attachments, onWithdraw, compact }: {
  attachments: Attachment[]
  /* Given only where withdrawal is possible — the customer's own view of a
     ticket the desk has not answered yet. */
  onWithdraw?: (a: Attachment) => void
  compact?: boolean
}) {
  const [opening, setOpening] = useState<string | null>(null)
  const [failed, setFailed] = useState<string | null>(null)

  if (!attachments.length) return null

  const open = async (a: Attachment) => {
    setOpening(a.id)
    setFailed(null)
    const url = await openLink(a)
    setOpening(null)
    if (!url) { setFailed(a.id); return }
    window.open(url, '_blank', 'noopener,noreferrer')
  }

  return (
    <div style={{ marginTop: compact ? '8px' : '16px' }}>
      <h5 style={{
        fontSize: 'var(--text-xs)', fontWeight: 700, color: 'var(--text-tertiary)',
        textTransform: 'uppercase', letterSpacing: '0.05em',
        display: 'flex', alignItems: 'center', gap: '6px',
      }}>
        <Paperclip size={12} />
        {attachments.length} attachment{attachments.length === 1 ? '' : 's'}
      </h5>

      <ul style={{ listStyle: 'none', margin: '10px 0 0', padding: 0, display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {attachments.map(a => {
          const scan = scanNote(a.scan)
          const openable = canOpen(a)
          return (
            <li key={a.id} style={{
              display: 'flex', alignItems: 'flex-start', gap: '10px',
              padding: '10px 12px', borderRadius: 'var(--radius)',
              background: 'var(--bg-alt)', border: '1px solid var(--border-light)',
            }}>
              <span style={{ color: 'var(--text-tertiary)', marginTop: '2px', display: 'flex' }}>
                {a.mime.startsWith('image/') ? <ImageIcon size={16} /> : <FileText size={16} />}
              </span>

              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 'var(--text-sm)', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {a.filename}
                </div>
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
                  {sizeOf(a.bytes)} · {a.kind} · sent by {a.uploaded_by}
                </div>
                {a.caption && (
                  <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', marginTop: '4px' }}>{a.caption}</div>
                )}

                {/* Never silent about a file nobody has scanned. The person
                    clicking is usually an agent on a work machine. */}
                <div style={{
                  display: 'flex', alignItems: 'center', gap: '5px', marginTop: '6px',
                  fontSize: 'var(--text-xs)', fontWeight: 600,
                  color: scan.tone === 'ok' ? 'var(--success)' : scan.tone === 'bad' ? 'var(--danger)' : 'var(--warning)',
                }}>
                  {scan.tone === 'ok' ? <ShieldCheck size={12} /> : <ShieldAlert size={12} />}
                  {scan.text}
                </div>

                {failed === a.id && (
                  <div role="alert" style={{ fontSize: 'var(--text-xs)', color: 'var(--danger)', marginTop: '4px' }}>
                    That file could not be opened. It may have been withdrawn.
                  </div>
                )}
              </div>

              <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
                <button
                  onClick={() => open(a)}
                  disabled={!openable || opening === a.id}
                  title={openable ? 'Opens in a new tab, for five minutes' : 'This file cannot be opened'}
                  className="btn btn-secondary btn-sm"
                  style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}
                >
                  <ExternalLink size={13} />
                  {opening === a.id ? 'Opening…' : 'Open'}
                </button>
                {onWithdraw && (
                  <button
                    onClick={() => onWithdraw(a)}
                    aria-label={`Remove ${a.filename}`}
                    className="btn btn-secondary btn-sm"
                    style={{ display: 'inline-flex', alignItems: 'center' }}
                  >
                    <Trash2 size={13} />
                  </button>
                )}
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
