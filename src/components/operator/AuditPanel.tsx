import { SectionCard, Table, Td } from './shared'
import { groupFindings, auditSummary } from '../../lib/marketAdmin'
import type { Finding } from '../../lib/marketAdmin'

/* One panel for both audits.
 *
 * `market_consistency` and `ledger_consistency` answer different questions —
 * who may sell where, and whether a stored total is the sum of its rows — but
 * they are the same shape and the same idea: a query whose empty result is the
 * point. Rendering them twice would mean two places to forget that an empty
 * audit still has to say something.
 *
 * The `okText` differs because "nothing to answer for" is only reassuring if it
 * says what was checked. A panel that goes blank when everything is fine is
 * indistinguishable from a panel that failed to load.
 */
export function AuditPanel({
  title, subtitle, okText, audit,
}: {
  title: string
  subtitle: string
  /* What was checked, said in the words of this particular audit. */
  okText?: string
  audit: { rows: Finding[]; error?: string }
}) {
  if (audit.error) {
    return (
      <SectionCard title={title} subtitle={subtitle}>
        <div style={{ padding: '13px 16px', fontSize: 'var(--text-sm)', color: 'var(--danger)', lineHeight: 1.6 }}>
          This did not load: {audit.error} Everything else on this screen still works.
        </div>
      </SectionCard>
    )
  }

  const groups = groupFindings(audit.rows)
  const sum = auditSummary(groups)
  const clear = sum.tone === 'ok'

  return (
    <SectionCard title={title} subtitle={subtitle}>
      <div style={{
        padding: '13px 16px', borderRadius: 'var(--radius-md)', margin: '0 0 14px',
        fontSize: 'var(--text-sm)', lineHeight: 1.6,
        background: clear ? 'var(--success-bg)' : sum.tone === 'bad' ? 'var(--danger-bg)' : 'var(--warning-bg)',
        border: `1px solid ${clear ? 'var(--success)' : sum.tone === 'bad' ? 'var(--danger)' : 'var(--warning)'}`,
      }}>
        <strong>{clear ? 'Nothing to answer for.' : sum.text}</strong>
        {clear && (
          <div style={{ marginTop: '4px', fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>
            {okText ?? sum.text}
          </div>
        )}
      </div>

      {groups.length > 0 && (
        <Table headers={['What is wrong', 'How many', 'Which ones']}>
          {groups.map(g => (
            <tr key={g.finding}>
              <Td>
                <div style={{ fontWeight: 600 }}>
                  {g.finding.charAt(0).toUpperCase() + g.finding.slice(1)}
                </div>
                <div style={{ fontSize: 'var(--text-xs)', color: g.live ? 'var(--danger)' : 'var(--text-tertiary)' }}>
                  {g.live
                    ? 'Affects what somebody can buy or is being charged now'
                    : 'A record that reads oddly — nothing is being quoted or paid on it'}
                </div>
              </Td>
              <Td right>{g.rows.length}</Td>
              <Td style={{ whiteSpace: 'normal', maxWidth: '460px' }}>
                {/* Named rather than counted. A count tells somebody there is
                    work; the names tell them where it is. */}
                <div style={{ fontSize: 'var(--text-xs)', lineHeight: 1.6 }}>
                  {g.rows.slice(0, 6).map(r => (
                    <div key={r.subject}>
                      <strong>{r.subject}</strong> — {r.detail}
                    </div>
                  ))}
                  {g.rows.length > 6 && (
                    <div style={{ color: 'var(--text-tertiary)', marginTop: '2px' }}>
                      and {g.rows.length - 6} more
                    </div>
                  )}
                </div>
              </Td>
            </tr>
          ))}
        </Table>
      )}
    </SectionCard>
  )
}
