import { useState, useEffect, useCallback } from 'react'
import { Eye, Lock, TriangleAlert as AlertTriangle, Mail, Phone } from 'lucide-react'
import { Modal, FormField, TextInput, TextArea, Btn, toast, fmtDate } from './shared'
import { Callout } from '../OnboardingJourney'
import {
  loadPartnerSettlement, logBankReveal, confirmBankChange, rejectBankChange,
} from '../../lib/partnerDetailsRepo'
import type { PartnerSettlement } from '../../lib/partnerDetailsRepo'
import {
  maskAccount, maskTaxId, maskIban, showLocalCode, taxPosition, pendingChange, contactGaps,
  groupByPurpose, PURPOSE_SPEC,
} from '../../lib/partnerDetails'

/* The marketplace's side of a seller's settlement instruction.
 *
 * Two things live here that live nowhere else in the operator console: the
 * account changes a seller has asked for and nobody has decided, and the
 * addresses the platform actually sends money notices to. A change request that
 * only the seller can see is a request that ages quietly for a month, and a
 * remittance advice sent to a person who left is a payment the seller thinks
 * never happened.
 */

const ACTOR = 'Marketplace finance desk'

export function PartnerSettlementTab({ partnerId, partnerName, country }: {
  partnerId: string; partnerName: string; country: string
}) {
  const [snap, setSnap] = useState<PartnerSettlement | null>(null)
  const [revealed, setRevealed] = useState(false)
  const [asking, setAsking] = useState(false)
  const [refusing, setRefusing] = useState(false)

  const reload = useCallback(async () => setSnap(await loadPartnerSettlement(partnerId)), [partnerId])
  useEffect(() => { setRevealed(false); void reload() }, [reload])

  if (!snap) return <div style={{ padding: '24px', textAlign: 'center' }}><div className="spinner" style={{ margin: '0 auto' }} /></div>

  const bank = snap.bank
  const tax = taxPosition(bank, new Date())
  const pending = pendingChange(bank)
  const gaps = contactGaps(snap.contacts)

  if (!bank) {
    return (
      <Callout tone="danger" title="No settlement instruction on file">
        Nothing can be paid to {partnerName} until an account is recorded and verified. It is captured at the
        bank and tax gate.
      </Callout>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
      {snap.loadError && <Callout tone="danger" title="Part of this did not load">{snap.loadError}</Callout>}

      {pending.state === 'submitted' && (
        <div style={{
          padding: '14px 16px', borderRadius: 'var(--radius-md)',
          background: 'var(--warning-bg)', borderLeft: '3px solid var(--warning)',
        }}>
          <div style={{ fontSize: 'var(--text-sm)', fontWeight: 700, color: 'var(--warning)', marginBottom: '4px' }}>
            {partnerName} has asked to be paid to {pending.to}
          </div>
          <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', lineHeight: 1.6, marginBottom: '10px' }}>
            Requested by {pending.by} on {fmtDate(pending.on)} — “{pending.why}”.<br />
            New details: {bank.pending_holder} at {bank.pending_bank}
            {bank.pending_branch ? ` — ${bank.pending_branch}` : ''}
            {bank.pending_swift ? ` · SWIFT ${bank.pending_swift}` : ''}.<br />
            <strong>Settlements are still paying to {maskAccount(bank.account)} at {bank.bank}.</strong> Confirming
            promotes the new account and re-runs verification against it — a verification proved against the old
            account says nothing about this one.
          </div>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <Btn variant="primary" size="sm" onClick={async () => {
              const r = await confirmBankChange(bank, ACTOR)
              toast(r.ok ? (r.note ?? 'Confirmed') : r.reason, r.ok ? 'success' : 'error')
              await reload()
            }}>Confirm the change</Btn>
            <Btn variant="secondary" size="sm" onClick={() => setRefusing(true)}>Refuse it</Btn>
          </div>
        </div>
      )}

      {pending.state === 'rejected' && (
        <Callout tone="info" title="The last change to this account was refused">
          {pending.by} on {fmtDate(pending.on)}: “{pending.note}”. The seller has been told, and nothing moved.
        </Callout>
      )}

      <Section title="Settlement account"
               sub={bank.verified
                 ? `Verified ${fmtDate(bank.verified_on)} by ${bank.verified_by} · ${bank.method}`
                 : (bank.method ?? 'Not verified')}>
        {!bank.verified && (
          <div style={{ marginBottom: '12px' }}>
            <Callout tone="warning" title="Not verified — nothing will be paid to it">
              Two micro-deposits have to be matched first. The seller accrues a balance meanwhile but is not paid.
            </Callout>
          </div>
        )}
        <Facts rows={[
          ['Account holder', bank.holder],
          ['Bank', bank.branch ? `${bank.bank} — ${bank.branch}` : bank.bank],
          ['Account number', revealed ? bank.account : maskAccount(bank.account)],
          [bank.local_label, showLocalCode(country, bank.local_code)],
          ['SWIFT / BIC', bank.swift],
          ['IBAN', bank.iban ? (revealed ? bank.iban : maskIban(bank.iban) ?? '—') : `Not used in ${bank.residency}`],
          ['Settlement currency', bank.currency],
        ]} />
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginTop: '14px', flexWrap: 'wrap' }}>
          <span style={{ flex: 1, minWidth: '220px', fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', lineHeight: 1.5 }}>
            Masked everywhere. If you need the number to make a payment, take it from the payment file rather
            than from a screen somebody can photograph.
          </span>
          {revealed ? (
            <Btn variant="secondary" size="sm" onClick={() => setRevealed(false)}>
              <Lock size={13} /> Hide it again
            </Btn>
          ) : (
            <Btn variant="secondary" size="sm" onClick={() => setAsking(true)}>
              <Eye size={13} /> Show in full
            </Btn>
          )}
        </div>
      </Section>

      <Section title="Tax position" sub={`${bank.residency} · ${bank.tax_label} ${maskTaxId(bank.tax_id)}`}>
        <div style={{ marginBottom: '12px' }}>
          <Callout tone={tax.level === 'ok' ? 'success' : tax.level === 'expiring' ? 'warning' : 'danger'}
                   title={tax.headline}>{tax.detail}</Callout>
        </div>
        <Facts rows={[
          ['Tax residency', bank.residency],
          [bank.tax_label, revealed ? bank.tax_id : maskTaxId(bank.tax_id)],
          ['Treaty certificate', bank.treaty_on_file && bank.treaty_expires
            ? `On file, valid to ${fmtDate(bank.treaty_expires)}` : 'Not supplied'],
          ['Withholding applied', bank.withholding],
        ]} />
      </Section>

      <Section title="Where notices go"
               sub={`${snap.contacts.length} contact${snap.contacts.length === 1 ? '' : 's'} on file`}>
        {gaps.length > 0 && (
          <div style={{ marginBottom: '12px' }}>
            <Callout tone="warning" title={`${gaps.length} purpose${gaps.length === 1 ? ' has' : 's have'} nobody listed`}>
              {gaps.map(g => g.label).join(', ')}. Those fall back to the seller's sign-in address, so they
              reach one person's inbox and only when that person reads it.
            </Callout>
          </div>
        )}
        {groupByPurpose(snap.contacts).filter(g => g.rows.length > 0).map(({ spec, rows }) => (
          <div key={spec.id} style={{ marginBottom: '12px' }}>
            <div style={{ fontSize: 'var(--text-xs)', fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '5px' }}>
              {spec.label}
            </div>
            {rows.map(c => (
              <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '4px 0', fontSize: 'var(--text-sm)' }}>
                {c.kind === 'email' ? <Mail size={13} style={{ color: 'var(--text-tertiary)' }} />
                                    : <Phone size={13} style={{ color: 'var(--text-tertiary)' }} />}
                <span style={{ fontWeight: 600 }}>{c.value}</span>
                <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>{c.label ?? ''}</span>
                {!c.verified && (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: 'var(--text-xs)', color: 'var(--warning)', fontWeight: 600 }}>
                    <AlertTriangle size={11} /> unverified — nothing is sent to it
                  </span>
                )}
              </div>
            ))}
          </div>
        ))}
        <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', lineHeight: 1.6, margin: 0 }}>
          {PURPOSE_SPEC.settlement.sends} The seller maintains this list themselves under My details.
        </p>
      </Section>

      {asking && (
        <RevealDialog partnerId={partnerId} partnerName={partnerName} country={country}
                      onClose={() => setAsking(false)} onGranted={() => { setRevealed(true); setAsking(false) }} />
      )}

      {refusing && (
        <RefuseDialog partnerName={partnerName}
                      onClose={() => setRefusing(false)}
                      onRefuse={async note => {
                        const r = await rejectBankChange(bank, ACTOR, note)
                        toast(r.ok ? (r.note ?? 'Refused') : r.reason, r.ok ? 'success' : 'error')
                        if (r.ok) { setRefusing(false); await reload() }
                        return r.ok
                      }} />
      )}
    </div>
  )
}

function RevealDialog({ partnerId, partnerName, country, onClose, onGranted }: {
  partnerId: string; partnerName: string; country: string
  onClose: () => void; onGranted: () => void
}) {
  const [why, setWhy] = useState('')
  const [err, setErr] = useState('')

  return (
    <Modal open onClose={onClose} title={`Show ${partnerName}'s settlement detail in full`}
           footer={<>
             <Btn variant="secondary" onClick={onClose}>Cancel</Btn>
             <Btn variant="primary" onClick={async () => {
               setErr('')
               const r = await logBankReveal({ partnerId, partnerName, why, by: ACTOR })
               if (!r.ok) { setErr(r.reason); return }
               toast(r.note ?? 'Recorded')
               onGranted()
             }}>Show it once</Btn>
           </>}>
      <div style={{ marginBottom: '16px' }}>
        <Callout tone="warning" title="This is logged with your name against it">
          The record exists so the platform can pay a seller in {country || 'their country'}, not so it can be
          read. Closing the record hides it again — nothing is copied anywhere.
        </Callout>
      </div>
      <FormField label="Why you need it" required>
        <TextInput value={why} onChange={e => setWhy(e.target.value)}
                   placeholder="Reconciling a returned payment on SET-2026-07" />
      </FormField>
      {err && <div style={{ fontSize: 'var(--text-sm)', color: 'var(--danger)', fontWeight: 600 }}>{err}</div>}
    </Modal>
  )
}

function RefuseDialog({ partnerName, onClose, onRefuse }: {
  partnerName: string; onClose: () => void; onRefuse: (note: string) => Promise<boolean>
}) {
  const [note, setNote] = useState('')
  const [err, setErr] = useState('')

  return (
    <Modal open onClose={onClose} title="Refuse the account change"
           footer={<>
             <Btn variant="secondary" onClick={onClose}>Cancel</Btn>
             <Btn variant="danger" onClick={async () => {
               setErr('')
               if (!note.trim()) { setErr('Say why. A refusal with no reason comes straight back as the same request.'); return }
               await onRefuse(note)
             }}>Refuse it</Btn>
           </>}>
      <div style={{ marginBottom: '16px' }}>
        <Callout tone="info" title="Nothing changes about where money goes">
          {partnerName} keeps being paid to the account already on file. They see your reason on their own
          settlement page and can submit a corrected request.
        </Callout>
      </div>
      <FormField label="Why you are refusing" required>
        <TextArea value={note} onChange={e => setNote(e.target.value)}
                  placeholder="The account holder name does not match the registered entity on the KYC record." />
      </FormField>
      {err && <div style={{ fontSize: 'var(--text-sm)', color: 'var(--danger)', fontWeight: 600 }}>{err}</div>}
    </Modal>
  )
}

function Section({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <div style={{ border: '1px solid var(--border-light)', borderRadius: 'var(--radius-md)', padding: '16px 18px' }}>
      <div style={{ marginBottom: '12px' }}>
        <div style={{ fontSize: 'var(--text-sm)', fontWeight: 700 }}>{title}</div>
        {sub && <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>{sub}</div>}
      </div>
      {children}
    </div>
  )
}

function Facts({ rows }: { rows: [string, string][] }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '12px' }}>
      {rows.map(([k, v]) => (
        <div key={k}>
          <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>{k}</div>
          <div style={{ fontSize: 'var(--text-sm)', fontWeight: 600, wordBreak: 'break-word' }}>{v}</div>
        </div>
      ))}
    </div>
  )
}
