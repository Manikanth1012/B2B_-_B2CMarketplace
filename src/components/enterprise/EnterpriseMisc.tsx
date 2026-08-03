import { useState, useEffect } from 'react'
import { SectionCard, Table, Td, EmptyState } from '../operator/shared'
import { Callout } from '../OnboardingJourney'
import { Pager, usePaging } from '../Pager'
import { loadAccount } from '../../lib/enterpriseRepo'
import { loadAdmin } from '../../lib/enterpriseAdminRepo'
import { auditTrail } from '../../lib/enterpriseAdmin'
import type { AuditEntry } from '../../lib/enterpriseAdmin'
import { day } from '../../lib/enterprise'

/* The audit log.
 *
 * It is derived from the requisitions, invoices and people already on the
 * account rather than kept as a second record of the same events. Five
 * hand-typed lines were how this page came to name an "Anita Rao" who does not
 * exist while every requisition on the account was raised by Anita Desai — a
 * log that can disagree with the screens it describes is worse than no log,
 * because somebody will quote it.
 */
export function EnterpriseAudit() {
  const [entries, setEntries] = useState<AuditEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void (async () => {
      const [account, admin] = await Promise.all([loadAccount(), loadAdmin()])
      setError(account.loadError ?? admin.loadError ?? null)
      setEntries(auditTrail({
        requisitions: account.requisitions,
        invoices: account.invoices,
        people: admin.people,
      }))
    })()
  }, [])

  /* An append-only log only grows — 26 entries today and more every week —
     so it is paged like every other record list. Above the loading guard:
     `usePaging` is a hook, and a hook below an early return runs on some
     renders and not others. */
  const page = usePaging(entries ?? [])

  if (!entries) return <div style={{ textAlign: 'center', padding: '40px' }}><div className="spinner" style={{ margin: '0 auto' }} /></div>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div>
        <h1 style={{ fontSize: 'var(--text-2xl)', fontWeight: 800, color: 'var(--text)' }}>Audit Log</h1>
        <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)', marginTop: '4px', maxWidth: '72ch' }}>
          <strong>Your account only.</strong> Who raised what, who signed it and what it cost — the evidence trail behind your
          procurement. It is drawn from the records themselves, so it cannot drift from what the other screens show.
        </p>
      </div>

      {error && <Callout tone="warning" title="Some of this did not load">{error}</Callout>}

      <SectionCard title="Recent activity" subtitle={`${entries.length} entries, newest first`}>
        {entries.length === 0
          ? <EmptyState message="Nothing has happened on this account yet." />
          : (
            <Table headers={['When', 'Who', 'Action', 'Detail', 'Severity']}>
              {page.rows.map((e, i) => (
                <tr key={i}>
                  <Td style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', whiteSpace: 'nowrap' }}>{day(e.when)}</Td>
                  <Td>{e.who}</Td>
                  <Td>{e.action}</Td>
                  <Td style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>{e.detail}</Td>
                  <Td right>
                    <span style={{
                      fontSize: 'var(--text-xs)', fontWeight: 600, padding: '2px 8px', borderRadius: 'var(--radius-full)',
                      background: e.severity === 'high' ? 'var(--danger-bg)' : e.severity === 'normal' ? 'var(--info-bg)' : 'var(--bg-alt)',
                      color: e.severity === 'high' ? 'var(--danger)' : e.severity === 'normal' ? 'var(--info)' : 'var(--text-tertiary)',
                    }}>
                      {e.severity}
                    </span>
                  </Td>
                </tr>
              ))}
            </Table>
          )}
        <Pager page={page} noun="entries" />
      </SectionCard>

      <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', maxWidth: '72ch' }}>
        Entries cannot be edited or deleted. What you can read here depends on your role — somebody who cannot see the
        billing position does not see invoice lines in this log either.
      </p>
    </div>
  )
}
