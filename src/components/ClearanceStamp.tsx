import { ShieldCheck, AlertTriangle } from 'lucide-react'
import { faceOfDocument, scannable } from '../lib/einvoice'
import type { Regime, ClearanceRecord } from '../lib/einvoice'

/* The block that goes on the customer's own copy. Exported because the same
   identifiers belong on an enterprise invoice and on a consumer bill, and a
   second implementation of it is a second thing to get wrong. */
export function ClearanceStamp(
  { regime, record, compact }: {
    regime: Regime | null
    record: ClearanceRecord | null
    compact?: boolean
  },
) {
  const face = faceOfDocument(regime, record)
  if (!regime || !record) return null
  if (record.status === 'not-required') return null

  const scan = scannable(record)
  const tiny = { fontSize: compact ? '10px' : 'var(--text-xs)', color: 'var(--text-tertiary)', lineHeight: 1.5 }

  /* An uncleared document under a before-issue regime says so on its own face.
     A customer holding an invoice with no IRN needs to know it is not one they
     can claim against — finding out from their own auditor is worse. */
  if (record.status !== 'cleared') {
    return (
      <div style={{
        marginTop: '10px', padding: '8px 10px', borderRadius: '4px',
        background: 'var(--warning-bg)', border: '1px solid var(--warning)',
        display: 'flex', gap: '8px', alignItems: 'flex-start',
      }}>
        <AlertTriangle size={13} style={{ color: 'var(--warning)', flexShrink: 0, marginTop: '1px' }} />
        <div style={tiny}>
          <strong style={{ color: 'var(--warning)' }}>Not yet registered with {regime.authority}.</strong>
          {regime.clearance === 'before-issue'
            ? ' Until it is, this is not a tax invoice and input credit cannot be claimed against it.'
            : ' The document is valid; the statutory report is outstanding.'}
        </div>
      </div>
    )
  }

  return (
    <div style={{
      marginTop: '10px', paddingTop: '8px', borderTop: '1px solid var(--border-light)',
      display: 'flex', gap: '10px', alignItems: 'flex-start', justifyContent: 'space-between',
    }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '5px', marginBottom: '3px' }}>
          <ShieldCheck size={12} style={{ color: 'var(--success)' }} />
          <strong style={{ fontSize: compact ? '10px' : 'var(--text-xs)', color: 'var(--text-secondary)' }}>
            {regime.scheme}
          </strong>
        </div>
        {face.length === 0
          ? (
            <div style={tiny}>
              Reported to {regime.authority}
              {record.transmission_ref && <> · <span style={{ fontFamily: 'var(--font-mono)' }}>{record.transmission_ref}</span></>}
            </div>
          )
          : face.map(f => (
            <div key={f.label} style={tiny}>
              {f.label}{' '}
              <span style={f.mono
                ? { fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)', wordBreak: 'break-all' }
                : { color: 'var(--text-secondary)' }}>{f.value}</span>
            </div>
          ))}
      </div>

      {scan !== null && (
        <div style={{ textAlign: 'center', flexShrink: 0 }}>
          {/* A stand-in for the signed QR. The payload the authority returns is
              a signed JWT and is not something to invent the pixels of, so what
              is drawn is a placeholder that occupies the space the real code
              occupies and says what it is. */}
          <div aria-hidden style={{
            width: compact ? '40px' : '52px', height: compact ? '40px' : '52px',
            borderRadius: '3px', border: '1px solid var(--border)',
            background: 'repeating-conic-gradient(var(--text) 0% 25%, transparent 0% 50%) 50% / 8px 8px',
            opacity: 0.75,
          }} />
          <div style={{ ...tiny, marginTop: '3px' }}>
            {scan === 'signed' ? 'Signed QR' : 'Verify'}
          </div>
        </div>
      )}
    </div>
  )
}
