import { useState, useEffect, useCallback } from 'react'
import { Download, FileSignature } from 'lucide-react'
import { SectionCard, StatCard, Btn, StatusPill, Table, Td, toast, fmtInt } from '../operator/shared'
import { Callout } from '../OnboardingJourney'
import { loadMyContract, signedCopyUrl } from '../../lib/contractsRepo'
import {
  STANDING_LABEL, STANDING_TONE, AMENDMENT_LABEL,
  standingOf, daysLeft, noticeBy, whatHappensNext, inEffectOrder,
} from '../../lib/contracts'
import type { Contract, Amendment } from '../../lib/contracts'
import { useMarket } from '../../lib/MarketContext'

/* The account's own agreement, from the buyer's seat.
 *
 * Unlike a credit assessment — which is the marketplace's working about them and
 * stays with the marketplace — a contract is a document the account signed.
 * There is nothing in it they are not entitled to see, so this shows all of it,
 * including the amendments and the signed copies. What they cannot do is change
 * any of it.
 *
 * The thing worth putting at the top is not the term but what happens when it
 * ends, because that is the part nobody reads until it is too late: an
 * agreement that lapses stops the account buying, and one that auto-renews rolls
 * for another year. Both fail the same way — by nobody acting.
 */

export function EnterpriseAgreement() {
  const [book, setBook] = useState<{
    contract: Contract | null; history: Contract[]; amendments: Amendment[]; loadError?: string
  } | null>(null)
  const { fmtIn } = useMarket()

  const reload = useCallback(async () => setBook(await loadMyContract()), [])
  useEffect(() => { void reload() }, [reload])

  if (!book) {
    return <div style={{ textAlign: 'center', padding: '40px' }}><div className="spinner" style={{ margin: '0 auto' }} /></div>
  }
  if (book.loadError) {
    return <Callout tone="danger" title="Your agreement did not load">{book.loadError}</Callout>
  }

  const today = new Date().toISOString().slice(0, 10)
  const c = book.contract

  const download = async (path: string | null) => {
    const url = await signedCopyUrl(path)
    if (!url) { toast('There is no signed copy on file for that one.', 'error'); return }
    window.open(url, '_blank', 'noopener')
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div>
        <h1 style={{ fontSize: 'var(--text-2xl)', fontWeight: 800, color: 'var(--text)' }}>
          Your agreement
        </h1>
        <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)', marginTop: '4px', maxWidth: '84ch' }}>
          The master services agreement your account buys under — the term, the payment terms,
          who signed it, and every amendment since. You are charged the price published for your
          market; no rate card forms part of this and nothing here changes what anything costs.
        </p>
      </div>

      {!c ? (
        /* The state that stops everything. Said plainly and with what to do,
           because an account that cannot raise a requisition will otherwise
           work it out from a database error message. */
        <Callout tone="danger" title="There is no agreement in force on this account">
          Nothing can be raised or approved on account until one is signed. Your account manager
          at Aventa has to put a new agreement in place — until then, existing subscriptions
          continue and are still invoiced.
        </Callout>
      ) : (
        <Live contract={c} amendments={book.amendments.filter(a => a.contract_id === c.id)}
              today={today} fmtIn={fmtIn} onDownload={download} />
      )}

      {book.history.length > 0 && (
        <SectionCard title="Earlier agreements"
          subtitle="Kept rather than replaced, so what you were on in an earlier year has an answer.">
          <Table headers={['Reference', 'Term', 'Payment terms', 'Standing', '']}>
            {book.history.map(h => {
              const s = standingOf(h, today)
              return (
                <tr key={h.id}>
                  <Td>
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)' }}>{h.id}</div>
                    <div style={{ fontSize: '10px', color: 'var(--text-tertiary)' }}>{h.title}</div>
                  </Td>
                  <Td style={{ fontSize: 'var(--text-xs)' }}>{h.starts_on} → {h.ends_on}</Td>
                  <Td style={{ fontSize: 'var(--text-xs)' }}>{h.terms}</Td>
                  <Td><StatusPill status={STANDING_TONE[s]} label={STANDING_LABEL[s]} /></Td>
                  <Td right>
                    <Btn size="sm" variant="secondary" onClick={() => download(h.document_path)}>
                      <Download size={13} /> Copy
                    </Btn>
                  </Td>
                </tr>
              )
            })}
          </Table>
        </SectionCard>
      )}
    </div>
  )
}

function Live({ contract, amendments, today, fmtIn, onDownload }: {
  contract: Contract; amendments: Amendment[]; today: string
  fmtIn: (n: number, c: string) => string
  onDownload: (path: string | null) => void
}) {
  const s = standingOf(contract, today)
  const left = daysLeft(contract, today)
  const by = noticeBy(contract)
  const ordered = inEffectOrder(amendments)

  return (
    <>
      <Callout tone={s === 'expiring' ? 'warning' : 'info'} title={`What happens on ${contract.ends_on}`}>
        {whatHappensNext(contract, today)}
      </Callout>

      <div className="stat-row">
        <StatCard label="Reference" value={contract.id} sublabel={contract.title} />
        <StatCard label="Payment terms" value={contract.terms}
          sublabel={`Invoiced in ${contract.currency}`} />
        <StatCard label="Days left" value={fmtInt(Math.max(0, left))}
          sublabel={by ? `Notice due by ${by}` : 'No notice period'}
          color={s === 'expiring' ? 'var(--warning)' : undefined} />
        <StatCard label="Amendments" value={fmtInt(ordered.length)}
          sublabel={ordered.length ? `Latest effective ${ordered[ordered.length - 1].effective_on}` : 'None since signature'} />
      </div>

      <SectionCard title="The agreement"
        subtitle="Signed by both sides. The copy below is the one that was countersigned."
        action={<Btn size="sm" variant="secondary" onClick={() => onDownload(contract.document_path)}>
          <Download size={13} /> Signed copy
        </Btn>}>
        <div style={{ padding: '16px 18px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: '14px' }}>
          <Fact label="Signed on" value={contract.signed_on} />
          <Fact label="Runs from" value={contract.starts_on} />
          <Fact label="Runs to" value={contract.ends_on} />
          <Fact label="Signed for you" value={`${contract.signed_by} · ${contract.signed_title}`} />
          <Fact label="Countersigned by" value={`${contract.countersigned_by} · Aventa Telecom`} />
          <Fact label="Renewal"
                value={contract.auto_renew ? 'Automatic unless notice is given' : 'By agreement — it does not roll over'} />
          {contract.term_value != null && (
            <Fact label="Expected spend"
                  value={fmtIn(contract.term_value, contract.currency)}
                  hint="Your own estimate across the term. It is not a commitment and carries no price advantage." />
          )}
        </div>
      </SectionCard>

      {ordered.length > 0 && (
        <SectionCard title="Amendments"
          subtitle="In the order they took effect, which is not always the order they were signed.">
          <Table headers={['What changed', 'Was', 'Now', 'Effective', '']}>
            {ordered.map(a => (
              <tr key={a.id}>
                <Td>
                  <strong style={{ fontSize: 'var(--text-sm)' }}>{AMENDMENT_LABEL[a.kind]}</strong>
                  <div style={{ fontSize: '10px', color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}>{a.id}</div>
                  <div style={{ fontSize: '10px', color: 'var(--text-secondary)', marginTop: '3px', maxWidth: '36ch' }}>{a.why}</div>
                </Td>
                <Td style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', maxWidth: '24ch' }}>{a.was}</Td>
                <Td style={{ fontSize: 'var(--text-xs)', maxWidth: '24ch' }}>{a.now_says}</Td>
                <Td style={{ fontSize: 'var(--text-xs)' }}>
                  {a.effective_on}
                  <div style={{ fontSize: '10px', color: 'var(--text-tertiary)' }}>signed {a.signed_on}</div>
                </Td>
                <Td right>
                  <Btn size="sm" variant="secondary" onClick={() => onDownload(a.document_path)}>
                    <Download size={13} /> Copy
                  </Btn>
                </Td>
              </tr>
            ))}
          </Table>
        </SectionCard>
      )}

      {/* The boundary, said to the buyer rather than only recorded in
          `channel_rule`. An account that thinks it has negotiated pricing and
          has not is a conversation nobody wants to have at invoice time. */}
      <Callout tone="info" title="What this agreement does not set">
        Prices. You are charged what is published for your market on the day you order, and any
        promotion is available to you on the same terms as to any other buyer there. The expected
        spend above is your own planning figure — it buys nothing and discounts nothing.
      </Callout>
    </>
  )
}

function Fact({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div>
      <div style={{ fontSize: '10px', color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '.04em' }}>
        {label}
      </div>
      <div style={{ fontSize: 'var(--text-sm)', fontWeight: 600, marginTop: '2px' }}>{value}</div>
      {hint && <div style={{ fontSize: '10px', color: 'var(--text-tertiary)', marginTop: '2px' }}>{hint}</div>}
    </div>
  )
}
