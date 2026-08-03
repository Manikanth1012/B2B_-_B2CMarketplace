import { useState, useEffect, useCallback } from 'react'
import { RotateCcw, Plus, TriangleAlert as AlertTriangle, Clock } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import {
  StatCard, SectionCard, Table, Td, StatusPill, fmtInt, Btn, toast, Modal,
  FormField, TextArea, TextInput, Select, EmptyState,
} from '../operator/shared'
import { Callout } from '../OnboardingJourney'
import { loadAccountRefunds, requestRefund } from '../../lib/refundRepo'
import type { RefundBook } from '../../lib/refundRepo'
import { loadAccount } from '../../lib/enterpriseRepo'
import {
  STATES, REASONS, summarise, sla, ownership, fundedBy, autoApproves, byCategory, thresholdFor,
} from '../../lib/refunds'
import type { Refund, RefundReason, RefundThreshold } from '../../lib/refunds'
import { day } from '../../lib/enterprise'
import { useAccountMoney } from './money'

/* Refunds, from the account that paid rather than the person who clicked.
 *
 * The difference from the consumer screen is who owns the request. A business
 * refund belongs to the company: the money goes back to the company account,
 * and the colleague chasing it next week is rarely the one who raised it. So
 * everything here is scoped to the account and every row names the person, in
 * the way a shared inbox does.
 *
 * The rest is the same subject the seller and the marketplace already see, and
 * deliberately the same rules module — a buyer being quoted a different SLA
 * from the one the seller is held to is how a dispute becomes an argument
 * about the platform rather than about the goods.
 */

const NOW = new Date()

export function EnterpriseRefunds() {
  const [book, setBook] = useState<RefundBook | null>(null)
  const [account, setAccount] = useState<{ id: string; company: string; currency: string } | null>(null)

  const [asking, setAsking] = useState(false)
  const [open, setOpen] = useState<string | null>(null)

  const reload = useCallback(async () => {
    const acct = await loadAccount()
    if (!acct.account) { setBook({ refunds: [], policy: null, windows: [], thresholds: [], loadError: acct.loadError }); return }
    setAccount({ id: acct.account.id, company: acct.account.company, currency: acct.account.currency })
    setBook(await loadAccountRefunds(acct.account.id))
  }, [])
  useEffect(() => { void reload() }, [reload])

  const { money } = useAccountMoney(account?.currency)

  if (!book) return <div style={{ textAlign: 'center', padding: '40px' }}><div className="spinner" style={{ margin: '0 auto' }} /></div>

  const { policy } = book
  const s = summarise(book.refunds, NOW)
  const waiting = book.refunds.filter(r => r.state === 'requested')
  const escalated = book.refunds.filter(r => r.state === 'escalated')

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '16px', flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontSize: 'var(--text-2xl)', fontWeight: 800, color: 'var(--text)' }}>Refunds</h1>
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)', marginTop: '4px' }}>
            Money back to {account?.company ?? 'the account'} that paid. The seller decides, and the marketplace steps in if they do not.
          </p>
        </div>
        <Btn onClick={() => setAsking(true)} disabled={!policy}><Plus size={14} /> Ask for a refund</Btn>
      </div>

      {book.loadError && <Callout tone="danger" title="Some of this did not load">{book.loadError}</Callout>}

      {policy && (
        <Callout tone="info" title="How a refund is decided">
          The seller has {policy.seller_sla_hours} hours to answer. {policy.escalation_rule} {policy.funded_by}
          {' '}Refunds under {money(thresholdFor(book.thresholds, account?.currency ?? 'USD', policy))} and anything provable from the payment record
          approve themselves, because arguing about them costs both sides more than the money.
        </Callout>
      )}

      {escalated.length > 0 && (
        <Callout tone="danger" title={`${escalated.length} request${escalated.length === 1 ? ' has' : 's have'} been escalated`}>
          The seller did not answer inside the window, so the marketplace decides. Nobody on your side had to
          chase it — the clock did it. The money still comes off the seller’s settlement either way.
        </Callout>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '12px' }}>
        <StatCard label="Waiting on a decision" value={fmtInt(s.open)}
                  sublabel={s.open ? `${money(s.atStake)} at stake${s.overdue ? ` · ${s.overdue} past the SLA` : ''}` : 'Nothing outstanding'}
                  color={s.overdue ? 'var(--danger)' : s.open ? 'var(--warning)' : 'var(--success)'} />
        <StatCard label="Recovered" value={money(s.refundedValue)}
                  sublabel={`${s.decided} decided${s.heldPct !== null ? ` · ${s.heldPct}% declined` : ''}`}
                  color="var(--success)" />
        <StatCard label="Escalated" value={fmtInt(s.escalated)}
                  sublabel={s.escalated ? 'The marketplace decides these' : 'None escalated'}
                  color={s.escalated ? 'var(--warning)' : undefined} />
        <StatCard label="Raised in total" value={fmtInt(book.refunds.length)}
                  sublabel={`Against ${new Set(book.refunds.map(r => r.seller)).size} sellers`} />
      </div>

      <SectionCard title="Requests" subtitle="Click a row for what was said and what happens next">
        {book.refunds.length === 0 ? (
          <EmptyState message="Nothing has been asked for on this account yet" />
        ) : (
          <Table headers={['Raised', 'Item', 'Seller', 'Order', 'Amount', 'Reason', 'Who decides', 'State']}>
            {book.refunds.map(r => {
              const clock = policy ? sla(r, policy, NOW) : null
              return (
                <>
                  <tr key={r.id} onClick={() => setOpen(open === r.id ? null : r.id)} style={{ cursor: 'pointer' }}>
                    <Td style={{ fontSize: 'var(--text-xs)', whiteSpace: 'nowrap' }}>
                      <div style={{ fontWeight: 600 }}>{day(r.requested)}</div>
                      <div style={{ color: 'var(--text-tertiary)' }}>{r.id}</div>
                    </Td>
                    <Td>{r.item}</Td>
                    <Td right style={{ fontSize: 'var(--text-xs)' }}>{r.seller}</Td>
                    <Td right style={{ fontSize: 'var(--text-xs)' }}>{r.order_ref}</Td>
                    <Td right style={{ fontWeight: 600 }}>
                      {money(Number(r.amount))}
                      {r.refunded !== null && Number(r.refunded) !== Number(r.amount) && (
                        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--success)' }}>{money(Number(r.refunded))} back</div>
                      )}
                    </Td>
                    <Td right style={{ fontSize: 'var(--text-xs)' }}>{REASONS[r.reason].label}</Td>
                    <Td right style={{ fontSize: 'var(--text-xs)' }}>{ownership(r).owner === 'seller' ? r.seller : 'The marketplace'}</Td>
                    <Td right>
                      <StatusPill status={pillFor(r)} />
                      {clock && (r.state === 'requested' || r.state === 'escalated') && (
                        <div style={{
                          fontSize: 'var(--text-xs)', marginTop: '2px', maxWidth: '220px', textAlign: 'right',
                          /* Prose, in a right-aligned cell that does not wrap
                             by default because most of them hold figures. This
                             one is a sentence and has to. */
                          whiteSpace: 'normal',
                          color: clock.level === 'overdue' || clock.level === 'gone' ? 'var(--danger)' : 'var(--text-tertiary)',
                        }}>
                          {clock.text}
                        </div>
                      )}
                    </Td>
                  </tr>
                  {open === r.id && (
                    <tr key={`${r.id}-detail`}>
                      <td colSpan={8} style={{ padding: '14px 18px', background: 'var(--bg-alt)', borderBottom: '1px solid var(--border)' }}>
                        <Detail refund={r} book={book} />
                      </td>
                    </tr>
                  )}
                </>
              )
            })}
          </Table>
        )}
      </SectionCard>

      {waiting.length > 0 && (
        <SectionCard title="What is still open, and who owes you an answer"
                     subtitle="Nobody here has to chase these — the clock escalates them">
          <Table headers={['Request', 'Item', 'Owes the answer', 'By', 'Amount']}>
            {waiting.map(r => {
              const own = ownership(r)
              const clock = policy ? sla(r, policy, NOW) : null
              const late = clock?.level === 'overdue' || clock?.level === 'gone'
              return (
                <tr key={r.id}>
                  <Td style={{ fontWeight: 600 }}>{r.id}</Td>
                  <Td>{r.item}</Td>
                  <Td right>{own.owner === 'seller' ? r.seller : 'The marketplace'}</Td>
                  <Td right style={{ fontSize: 'var(--text-xs)', color: late ? 'var(--danger)' : undefined }}>
                    {day(r.sla_due)}{late ? ' — passed' : ''}
                  </Td>
                  <Td right>{money(Number(r.amount))}</Td>
                </tr>
              )
            })}
          </Table>
        </SectionCard>
      )}

      <SectionCard title="What is coming back, by category"
                   subtitle="Where the money is going wrong tells you what to stop buying">
        <Table headers={['Category', 'Requests', 'Still open', 'At stake']}>
          {byCategory(book.refunds).map(c => (
            <tr key={c.category_id}>
              <Td>{c.category_id}</Td>
              <Td right>{c.total}</Td>
              <Td right>{c.open || '—'}</Td>
              <Td right>{c.value ? money(c.value) : '—'}</Td>
            </tr>
          ))}
        </Table>
      </SectionCard>

      {asking && policy && account && (
        <AskForRefund policy={policy} thresholds={book.thresholds}
                      accountId={account.id} company={account.company}
                      currency={account.currency}
                      onClose={() => setAsking(false)}
                      onDone={async () => { setAsking(false); await reload() }} />
      )}
    </div>
  )
}

function pillFor(r: Refund): string {
  return r.state === 'refunded' || r.state === 'approved' ? 'approved'
    : r.state === 'declined' ? 'rejected'
      : r.state === 'escalated' ? 'escalated'
        : r.state === 'partial' ? 'cleared' : 'pending'
}

function Detail({ refund, book }: { refund: Refund; book: RefundBook }) {
  const funded = book.policy ? fundedBy(refund, book.policy) : ''
  const win = book.windows.find(w => w.category_id === refund.category_id)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
      <div><strong style={{ color: 'var(--text)' }}>What we said:</strong> {refund.detail ?? '—'}</div>
      {refund.evidence && <div><strong style={{ color: 'var(--text)' }}>Evidence:</strong> {refund.evidence}</div>}
      {refund.decision_note && (
        <div><strong style={{ color: 'var(--text)' }}>{refund.state === 'declined' ? 'Why it was declined' : 'The decision'}:</strong>{' '}
          {refund.decision_note}
          {refund.decided_by && <span style={{ color: 'var(--text-tertiary)' }}> — {refund.decided_by}, {day(refund.decided_on)}</span>}
        </div>
      )}
      {refund.escalated_why && (
        <div style={{ color: 'var(--warning)' }}><strong>Escalated {day(refund.escalated_on)}:</strong> {refund.escalated_why}</div>
      )}
      <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
        {STATES[refund.state].meaning} {funded}
        {win ? ` The return window for ${refund.category_id} is ${win.days} days — ${win.note}` : ''}
      </div>
    </div>
  )
}

/* -------------------------------------------------------------- raise one -- */

interface Refundable {
  order_ref: string; product_id: string; item: string; category_id: string | null
  partner_id: string | null; seller: string; first_party: boolean; amount: number
}

function AskForRefund({ policy, thresholds, accountId, company, currency, onClose, onDone }: {
  policy: NonNullable<RefundBook['policy']>
  thresholds: RefundThreshold[]
  accountId: string
  company: string
  /* The account's, so the order this refund is raised against is quoted in the
     money the order was actually billed in. */
  currency: string
  onClose: () => void
  onDone: () => Promise<void>
}) {
  const { money } = useAccountMoney(currency)
  const [options, setOptions] = useState<Refundable[] | null>(null)
  const [pick, setPick] = useState('')
  const [reason, setReason] = useState<RefundReason>('faulty')
  const [detail, setDetail] = useState('')
  const [evidence, setEvidence] = useState('')
  const [busy, setBusy] = useState(false)

  /* What a business can claim against is what it was invoiced for. Reading the
     invoice lines rather than an orders table means the list can never offer
     something the account was never charged for. */
  useEffect(() => {
    void (async () => {
      const [invRes, lineRes, prodRes, claimed] = await Promise.all([
        supabase.from('enterprise_invoices').select('id,account_id').eq('account_id', accountId),
        supabase.from('enterprise_invoice_lines').select('*'),
        supabase.from('products').select('id,category_id,partner_id,seller,name'),
        supabase.from('refunds').select('order_ref,product_id').eq('account_id', accountId),
      ])
      const products = (prodRes.data ?? []) as { id: string; category_id: string | null; partner_id: string | null; seller: string; name: string }[]
      const invoices = new Set(((invRes.data ?? []) as { id: string }[]).map(i => i.id))
      const taken = new Set(((claimed.data ?? []) as { order_ref: string; product_id: string }[])
        .map(r => `${r.order_ref}::${r.product_id}`))

      const rows: Refundable[] = []
      for (const l of (lineRes.data ?? []) as {
        id: string; invoice_id: string; description: string; seller: string
        partner_id: string | null; subscription_id: string | null
        requisition_id: string | null; amount: number; quantity: number | null
      }[]) {
        if (!invoices.has(l.invoice_id)) continue
        const p = products.find(x => x.seller === l.seller && l.description.startsWith(x.name.slice(0, 12)))
        const ref = l.requisition_id ?? l.subscription_id ?? l.invoice_id
        const key = `${ref}::${p?.id ?? l.id}`
        if (taken.has(key)) continue
        rows.push({
          order_ref: ref, product_id: p?.id ?? l.id, item: l.description,
          category_id: p?.category_id ?? null, partner_id: l.partner_id,
          seller: l.seller, first_party: !l.partner_id, amount: Number(l.amount),
        })
      }
      setOptions(rows)
      if (rows.length) setPick(`${rows[0].order_ref}::${rows[0].product_id}`)
    })()
  }, [accountId])

  const chosen = options?.find(o => `${o.order_ref}::${o.product_id}` === pick) ?? null
  /* The threshold for the account's own money, quoted in it. */
  const auto = chosen
    ? autoApproves(reason, chosen.amount, policy,
        thresholdFor(thresholds, currency, policy), money)
    : null

  const submit = async () => {
    if (!chosen) return
    setBusy(true)
    const res = await requestRefund({
      /* An enterprise is invoiced in one currency, so the line being claimed
         against is in that one — the guard trigger checks it against the
         account and refuses anything else. */
      order: { ...chosen, customer: company, currency },
      policy, thresholds, reason, detail, evidence, accountId,
    })
    setBusy(false)
    toast(res.ok ? res.note ?? 'Raised' : res.reason, res.ok ? 'success' : 'error')
    if (res.ok) await onDone()
  }

  return (
    <Modal open onClose={onClose} title="Ask for a refund"
      footer={<>
        <Btn variant="secondary" size="sm" onClick={onClose}>Cancel</Btn>
        <Btn size="sm" onClick={submit} disabled={busy || !chosen}>{busy ? 'Raising…' : 'Raise the request'}</Btn>
      </>}>
      {options === null ? (
        <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)' }}>Loading what you have been invoiced for…</div>
      ) : options.length === 0 ? (
        <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)', lineHeight: 1.6 }}>
          Everything invoiced to this account already has a request against it. A second one on the same line
          would only sit behind the first — raise it through support instead.
        </div>
      ) : (
        <>
          <FormField label="What it is about" required
                     hint="Everything this account has been invoiced for, minus anything already claimed">
            <Select value={pick} onChange={e => setPick(e.target.value)}>
              {options.map(o => (
                <option key={`${o.order_ref}::${o.product_id}`} value={`${o.order_ref}::${o.product_id}`}>
                  {o.item} — {money(o.amount)} · {o.seller}
                </option>
              ))}
            </Select>
          </FormField>

          <FormField label="What went wrong" required>
            <Select value={reason} onChange={e => setReason(e.target.value as RefundReason)}>
              {Object.entries(REASONS).map(([id, r]) => <option key={id} value={id}>{r.label}</option>)}
            </Select>
          </FormField>

          <FormField label="In your own words" required
                     hint="The seller reads this. A line or two on what happened, and how many units it affects.">
            <TextArea rows={3} value={detail} onChange={e => setDetail(e.target.value)} />
          </FormField>

          <FormField label="Anything that backs it up" hint={REASONS[reason].evidence}>
            <TextInput value={evidence} onChange={e => setEvidence(e.target.value)} />
          </FormField>

          {chosen && auto && (
            <Callout tone={auto.yes ? 'success' : 'info'} title={auto.yes ? 'This one approves itself' : `${chosen.seller} has ${policy.seller_sla_hours} hours to answer`}>
              {auto.because}
              {!auto.yes && ' If nobody answers, the marketplace takes the decision and the money still comes off the seller.'}
            </Callout>
          )}
        </>
      )}
    </Modal>
  )
}

export { RotateCcw, AlertTriangle, Clock }
