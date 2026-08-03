import { useState, useEffect, useCallback } from 'react'
import {
  Gift, Plus, TriangleAlert as AlertTriangle, Award, Undo2, Trash2,
} from 'lucide-react'
import {
  SectionCard, StatCard, Btn, Modal, FormField, TextInput, TextArea, Select,
  Table, Td, toast, fmtInt,
} from '../operator/shared'
import { Callout } from '../OnboardingJourney'
import { useMarket } from '../../lib/MarketContext'
import { loadSellerRewards, proposeRule, withdrawProposal } from '../../lib/rewardsRepo'
import type { SellerRewards } from '../../lib/rewardsRepo'
import {
  rewardCost, byRule, rulesCosting, myProposals, shareLabel, costOf, canWithdraw, newestFirst,
  proposalImpact, worthIn, FUNDERS, MAX_RATE,
} from '../../lib/sellerRewards'
import type { EarnRule, Movement, Proposal, Money, PointRate } from '../../lib/sellerRewards'
import { loadSellerRecord } from '../../lib/partnerRepo'
import type { SellerRecord } from '../../lib/partnerRepo'
import { supabase } from '../../lib/supabase'

/* Rewards, from the seller's side.
 *
 * The programme has always issued points on sellers' products and recovered the
 * cost from their settlements, and no seller could see a movement of it: the
 * ledger was readable by the customer who earned the points and by the operator
 * and by nobody else. A seller was billed for a campaign they could not read.
 *
 * So this page answers three questions in order: what did it cost me, which
 * rule did that, and can I have one of my own.
 */

interface Tier {
  id: string; name: string; rank: number; qualify_gross: number
  benefits: string[]; rate_relief: number; colour: string; sort_order: number
}

const TYPE_LABEL: Record<string, string> = {
  earn: 'Issued', redeem: 'Redeemed', reverse: 'Taken back', expire: 'Expired', adjust: 'Adjusted',
}

/** An option that adds nothing of its own — what one point is simply worth. */
const PLAIN = { value_per: 1 }

/**
 * A total that spans currencies, shown as the debts it actually is.
 *
 * A stat tile has one big number in it, so the largest bucket takes that slot
 * and the rest go underneath. What must not happen is the three being added:
 * ₹20,542 + KSh 1,200 + AED 37.60 = 21,779.60, which is a real number and not
 * an amount of anything.
 */
function MoneyStat({ label, list, sublabel, colour, fmt }: {
  label: string; list: readonly Money[]; sublabel: string
  colour?: string; fmt: (n: number, c: string) => string
}) {
  const [lead, ...rest] = list
  return (
    <StatCard
      label={label}
      value={lead ? fmt(lead.amount, lead.currency) : '—'}
      sublabel={[rest.map(m => `+ ${fmt(m.amount, m.currency)}`).join(' · '), sublabel]
        .filter(Boolean).join(' · ')}
      color={colour}
    />
  )
}

export function PartnerRewards({ partnerId }: { partnerId: string }) {
  const [snap, setSnap] = useState<SellerRewards | null>(null)
  const [record, setRecord] = useState<SellerRecord | null>(null)
  const [tiers, setTiers] = useState<Tier[]>([])
  const [proposing, setProposing] = useState(false)
  const [tab, setTab] = useState<'cost' | 'rules' | 'tier'>('cost')
  const { book: moneyBook, fmtIn } = useMarket()

  const reload = useCallback(async () => {
    const [s, r, t] = await Promise.all([
      loadSellerRewards(partnerId),
      loadSellerRecord(partnerId),
      supabase.from('partner_tiers').select('*').order('sort_order'),
    ])
    setSnap(s); setRecord(r); setTiers((t.data ?? []) as Tier[])
  }, [partnerId])
  useEffect(() => { void reload() }, [reload])

  if (!snap || !record) {
    return <div style={{ textAlign: 'center', padding: '40px' }}><div className="spinner" style={{ margin: '0 auto' }} /></div>
  }

  /* Read in whatever order Postgres handed them back, listed in the order the
     marketplace lists its currencies — so "a point is worth …" reads the same
     way here as the market switcher does. */
  const order = moneyBook.currencies.map(c => c.code)
  const rates = [...snap.rates].sort((a, b) => order.indexOf(a.currency) - order.indexOf(b.currency))

  const cost = rewardCost(snap.movements, snap.rules)
  const perRule = byRule(snap.movements, snap.rules)
  const mine = rulesCosting(snap.rules, partnerId)
  const proposals = myProposals(snap.rules, partnerId)
  const waiting = proposals.filter(r => r.status === 'pending')
  const answered = proposals.filter(r => r.decided_on !== null)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '16px', flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontSize: 'var(--text-2xl)', fontWeight: 800, color: 'var(--text)' }}>Rewards</h1>
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)', marginTop: '4px' }}>
            Points issued on what you sold, what they cost you, and which of them you chose to fund.
          </p>
        </div>
        <Btn variant="primary" onClick={() => setProposing(true)}><Plus size={14} /> Propose a rule</Btn>
      </div>

      {snap.loadError && <Callout tone="danger" title="Some of this page did not load">{snap.loadError}</Callout>}

      {snap.programme && (
        <Callout tone="info" title={snap.programme.funding_note}>
          Your share appears as a line on the next settlement, itemised by rule, so it can be argued with
          rather than just deducted.
          {/* One sentence said "a point is worth $0.01 when it is spent", which
              is true in one of the four markets this seller can list in. What a
              point is worth is set per currency, and a seller is charged in
              whichever one their customer was billed in. */}
          {rates.length > 0 && (
            <> A point is worth{' '}
              {rates.map(r => fmtIn(worthIn(1, PLAIN, r), r.currency)).join(', ')}{' '}
              when it is spent, depending on where the customer is.</>
          )}
        </Callout>
      )}

      {waiting.length > 0 && (
        <Callout tone="warning" title={`${waiting.length} proposal waiting on the marketplace`}>
          Nothing is issued under a rule until it is approved, so this is costing you nothing yet —
          it is also doing nothing yet.
        </Callout>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px' }}>
        <StatCard label="Points issued on your sales" value={fmtInt(cost.issued)}
                  sublabel={`${cost.movements} movements attributed to you`} />
        <MoneyStat label="Cost of issuing" list={cost.issuingCost} fmt={fmtIn}
                   sublabel="Your share only — shared rules are split" />
        <MoneyStat label="Cost of redemptions" list={cost.redemptionCost} fmt={fmtIn}
                   sublabel={cost.redeemed > 0
                     ? `${fmtInt(cost.redeemed)} points spent with you`
                     : 'Nothing redeemed against you yet'} />
        <MoneyStat label="Lands on your settlement" list={cost.total} fmt={fmtIn}
                   sublabel="Issuing, less clawbacks, plus redemptions"
                   colour={cost.total.some(m => m.amount > 0) ? 'var(--warning)' : undefined} />
      </div>

      {cost.clawed > 0 && (
        <Callout tone="success" title={`${fmtInt(cost.clawed)} points were taken back`}>
          Points issued against an order that was later refunded are reversed, and{' '}
          {cost.clawedBack.map(m => fmtIn(m.amount, m.currency)).join(' · ')}{' '}
          of cost came back to you with them. You are not charged for loyalty on a sale that did not stand.
        </Callout>
      )}

      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
        {([
          ['cost', `Every point attributed to you (${snap.movements.length})`],
          ['rules', `Rules that cost you money (${mine.length})`],
          ['tier', 'What your tier earns you'],
        ] as const).map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)} style={{
            padding: '8px 15px', borderRadius: 'var(--radius)', cursor: 'pointer',
            fontSize: 'var(--text-sm)', fontWeight: 600, border: '1px solid var(--border)',
            background: tab === id ? 'var(--brand-navy)' : 'white',
            color: tab === id ? 'white' : 'var(--text-secondary)',
          }}>{label}</button>
        ))}
      </div>

      {tab === 'cost' && (
        <>
          {perRule.length > 0 && (
            <SectionCard title="What each campaign cost you"
                         subtitle="One total tells you nothing you can act on; this tells you which rule to stop">
              <Table headers={['Rule', 'Your share', 'Points', 'Movements', 'Cost to you']}>
                {perRule.map(r => (
                  <tr key={r.rule.id}>
                    <Td>
                      <div style={{ fontWeight: 600 }}>{r.rule.name}</div>
                      <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>{r.rule.id} · {r.rule.rate}×</div>
                    </Td>
                    <Td>{r.yourShare}</Td>
                    <Td right>{fmtInt(r.points)}</Td>
                    <Td right>{r.movements}</Td>
                    <Td right style={{ maxWidth: '150px' }}>
                      {r.cost.map(m => (
                        <div key={m.currency}><strong>{fmtIn(m.amount, m.currency)}</strong></div>
                      ))}
                    </Td>
                  </tr>
                ))}
              </Table>
            </SectionCard>
          )}

          <SectionCard title="Every point attributed to you"
                       subtitle={snap.movements.length > 0
                         ? `${snap.movements.length} movements, newest first`
                         : 'Nothing yet'}>
            {snap.movements.length === 0 ? (
              <div style={{ padding: '20px', fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)', lineHeight: 1.6 }}>
                No points funded by you have been issued on your products. When they are, every one of them
                appears here with the order behind it.
              </div>
            ) : (
              <Table headers={['When', 'What', 'Against', 'Points', 'Costs you']}>
                {newestFirst(snap.movements).map(m => <MovementRow key={m.id} m={m} snap={snap} fmt={fmtIn} />)}
              </Table>
            )}
          </SectionCard>
        </>
      )}

      {tab === 'rules' && (
        <>
          {mine.length === 0 ? (
            <Callout tone="success" title="You fund no reward rules">
              Every point issued on your products is currently paid for by the marketplace. You can propose a
              seller-funded rule if you want to buy repeat business on a particular line.
            </Callout>
          ) : (
            <SectionCard title="Rules that cost you money" subtitle="Your own, and the category rules you fund part of">
              {mine.map(r => (
                <RuleCard key={r.id} rule={r} partnerId={partnerId}
                          onChanged={reload} />
              ))}
            </SectionCard>
          )}

          {answered.length > 0 && (
            <SectionCard title="Proposals the marketplace has answered"
                         subtitle="Kept so the same idea is not proposed again next quarter">
              <div style={{ padding: '8px 20px 16px' }}>
                {answered.map(r => (
                  <div key={r.id} style={{ padding: '12px 0', borderBottom: '1px solid var(--border-light)' }}>
                    <div style={{ fontWeight: 600, fontSize: 'var(--text-sm)' }}>
                      {r.name} — {r.status === 'active' ? 'approved' : 'refused'} on {r.decided_on} by {r.decided_by}
                    </div>
                    <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', lineHeight: 1.6, marginTop: '3px' }}>
                      {r.decision_note}
                    </div>
                  </div>
                ))}
              </div>
            </SectionCard>
          )}
        </>
      )}

      {tab === 'tier' && <TierPanel record={record} tiers={tiers} fmt={fmtIn} />}

      {proposing && snap.programme && (
        <ProposeModal partnerId={partnerId} programme={snap.programme} existing={snap.rules}
                      rates={rates} fmt={fmtIn}
                      by={record.partner?.contact ?? 'The seller'}
                      onClose={() => setProposing(false)}
                      onDone={async () => { setProposing(false); await reload() }} />
      )}
    </div>
  )
}

function MovementRow({ m, snap, fmt }: {
  m: Movement; snap: SellerRewards; fmt: (n: number, c: string) => string
}) {
  const share = costOf(m, snap.rules)
  const rule = m.rule_id ? snap.rules.find(r => r.id === m.rule_id) : null
  const negative = Number(m.points) < 0
  return (
    <tr>
      <Td style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', whiteSpace: 'nowrap' }}>{m.when_date}</Td>
      <Td>
        <span style={{
          display: 'inline-flex', alignItems: 'center', gap: '4px', whiteSpace: 'nowrap',
          padding: '2px 9px', borderRadius: 'var(--radius-full)',
          fontSize: 'var(--text-xs)', fontWeight: 600,
          background: m.type === 'reverse' ? 'var(--success-bg)' : m.type === 'redeem' ? 'var(--info-bg)' : 'var(--bg-alt)',
          color: m.type === 'reverse' ? 'var(--success)' : m.type === 'redeem' ? 'var(--info)' : 'var(--text-secondary)',
        }}>{TYPE_LABEL[m.type] ?? m.type}</span>
      </Td>
      <Td>
        <div style={{ fontSize: 'var(--text-sm)' }}>{m.note ?? '—'}</div>
        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
          {m.ref ?? ''}{rule ? ` · ${rule.name}` : ''}
        </div>
      </Td>
      <Td right style={{ color: negative ? 'var(--success)' : undefined, fontWeight: 600 }}>
        {negative ? '' : '+'}{fmtInt(Number(m.points))}
      </Td>
      <Td right>
        <div style={{ fontWeight: 600 }}>{fmt(share.amount, share.currency)}</div>
        {rule && rule.funder === 'shared' && rule.split !== null && (
          <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>{100 - rule.split}% share</div>
        )}
      </Td>
    </tr>
  )
}

function RuleCard({ rule, partnerId, onChanged }: {
  rule: EarnRule; partnerId: string; onChanged: () => Promise<void>
}) {
  const withdrawable = canWithdraw(rule).ok
  const own = rule.scope === 'partner' && rule.scope_id === partnerId
  return (
    <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border-light)' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px', flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: '240px' }}>
          <div style={{ fontWeight: 700, fontSize: 'var(--text-sm)' }}>
            {rule.name}
            <span style={{ color: 'var(--text-tertiary)', fontWeight: 500 }}> · {rule.id}</span>
          </div>
          <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', marginTop: '2px' }}>
            {rule.rate}× on {own ? 'your products' : rule.scope === 'vertical' ? `everything in ${rule.scope_id}` : 'everything'}
            {' · '}{rule.from}{rule.to ? ` – ${rule.to}` : ' onwards'}
            {rule.cap_per_order ? ` · capped at ${fmtInt(rule.cap_per_order)} points an order` : ' · no cap'}
          </div>
        </div>
        <span style={{
          padding: '3px 11px', borderRadius: 'var(--radius-full)', whiteSpace: 'nowrap',
          fontSize: 'var(--text-xs)', fontWeight: 700,
          background: rule.status === 'active' ? 'var(--success-bg)'
            : rule.status === 'pending' ? 'var(--warning-bg)' : 'var(--bg-alt)',
          color: rule.status === 'active' ? 'var(--success)'
            : rule.status === 'pending' ? 'var(--warning)' : 'var(--text-tertiary)',
        }}>{rule.status === 'pending' ? 'Waiting on the marketplace' : rule.status}</span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px', marginTop: '12px' }}>
        <div>
          <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>Your share</div>
          <div style={{ fontSize: 'var(--text-sm)', fontWeight: 600 }}>{shareLabel(rule)}</div>
          <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', marginTop: '2px' }}>
            {FUNDERS[rule.funder].note}
          </div>
        </div>
        <div style={{ gridColumn: 'span 2' }}>
          <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>Why it exists</div>
          <div style={{ fontSize: 'var(--text-sm)', lineHeight: 1.5 }}>{rule.why}</div>
        </div>
      </div>

      {rule.proposed_by && (
        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', marginTop: '8px' }}>
          Proposed by {rule.proposed_by} on {rule.proposed_on}
          {rule.decided_on ? ` · answered ${rule.decided_on} by ${rule.decided_by}` : ' · not yet answered'}
        </div>
      )}
      {rule.decision_note && (
        <div style={{ fontSize: 'var(--text-sm)', lineHeight: 1.6, marginTop: '6px', borderLeft: '3px solid var(--border)', paddingLeft: '10px' }}>
          {rule.decision_note}
        </div>
      )}

      {withdrawable && (
        <div style={{ marginTop: '12px' }}>
          <Btn variant="secondary" size="sm" onClick={async () => {
            const r = await withdrawProposal(rule)
            toast(r.ok ? (r.note ?? 'Withdrawn') : r.reason, r.ok ? 'success' : 'error')
            await onChanged()
          }}><Trash2 size={12} /> Withdraw it</Btn>
        </div>
      )}
    </div>
  )
}

/* The other half of "what are my rewards": what the seller's own tier is worth
   to them. It is not the loyalty programme — it is the ladder they climb by
   trading — but a seller asking about rewards means both, and sending them to
   another screen for half the answer is the wrong call. */
function TierPanel({ record, tiers, fmt }: {
  record: SellerRecord; tiers: Tier[]; fmt: (n: number, c: string, o?: { decimals?: boolean; code?: boolean }) => string
}) {
  const current = tiers.find(t => t.id === record.partner?.tier_id) ?? null
  const next = current ? tiers.find(t => t.rank === current.rank + 1) ?? null : null

  /* A seller's own tier is qualified on their settlements, and every settlement
     statement on this marketplace is in dollars — so this figure is a dollar
     figure and stays one. It carries its code because the rest of this screen
     is now in the customer's money, and a bare `$` next to ₹ and KSh reads as a
     leftover rather than as the different thing it is. Settlements getting
     their own currency is task #43. */
  const gross = (n: number) => fmt(n, 'USD', { decimals: false, code: true })

  if (!current) {
    return (
      <SectionCard title="What your tier earns you">
        <div style={{ padding: '20px', fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)' }}>
          No tier on this account yet.
        </div>
      </SectionCard>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <SectionCard title={`${current.name} seller`}
                   subtitle={`${current.rate_relief > 0 ? `${current.rate_relief} points off your commission rate · ` : ''}qualifying gross from ${gross(current.qualify_gross)}`}>
        <div style={{ padding: '20px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {current.benefits.map((b, i) => (
              <div key={i} style={{ display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
                <Award size={15} style={{ color: current.colour, flexShrink: 0, marginTop: '2px' }} />
                <span style={{ fontSize: 'var(--text-sm)', lineHeight: 1.5 }}>{b}</span>
              </div>
            ))}
          </div>
          {next && (
            <div style={{ marginTop: '18px', paddingTop: '14px', borderTop: '1px solid var(--border-light)' }}>
              <div style={{ fontSize: 'var(--text-sm)', fontWeight: 700, marginBottom: '8px' }}>
                {next.name} starts at {gross(next.qualify_gross)} of qualifying gross
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {next.benefits
                  .filter(b => !current.benefits.includes(b))
                  .map((b, i) => (
                    <div key={i} style={{ display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
                      <Gift size={14} style={{ color: 'var(--text-tertiary)', flexShrink: 0, marginTop: '2px' }} />
                      <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', lineHeight: 1.5 }}>{b}</span>
                    </div>
                  ))}
              </div>
            </div>
          )}
        </div>
      </SectionCard>

      <Callout tone="info" title="A tier and a reward point are different things">
        Your tier is what trading here earns <em>you</em> — a faster review, a named contact, a lower
        commission rate. A reward point is what a customer earns for buying from you, and one of you pays for
        it. The other two tabs are about that second thing.
      </Callout>
    </div>
  )
}

function ProposeModal({ partnerId, programme, existing, rates, fmt, by, onClose, onDone }: {
  partnerId: string
  programme: NonNullable<SellerRewards['programme']>
  existing: EarnRule[]
  rates: PointRate[]
  fmt: (n: number, c: string) => string
  by: string
  onClose: () => void
  onDone: () => Promise<void>
}) {
  const [p, setP] = useState<Proposal>({
    name: '', rate: 2, capPerOrder: 1000, from: '', to: '', why: '',
  })
  const [err, setErr] = useState('')
  const [saving, setSaving] = useState(false)
  const set = <K extends keyof Proposal>(k: K, v: Proposal[K]) => setP(d => ({ ...d, [k]: v }))

  return (
    <Modal open onClose={onClose} title="Propose a seller-funded earn rule"
           footer={<>
             <Btn variant="secondary" onClick={onClose}>Cancel</Btn>
             <Btn variant="primary" disabled={saving} onClick={async () => {
               setSaving(true); setErr('')
               const r = await proposeRule({ partnerId, proposal: p, by, existing })
               setSaving(false)
               if (!r.ok) { setErr(r.reason); return }
               toast(r.note ?? 'Sent')
               await onDone()
             }}>{saving ? 'Sending…' : 'Send the proposal'}</Btn>
           </>}>
      <div style={{ marginBottom: '16px' }}>
        <Callout tone="warning" title="This goes to the marketplace before any points are issued">
          {programme.funding_note}
        </Callout>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0 16px' }}>
        <FormField label="Name it" required hint="It appears on your settlement line.">
          <TextInput value={p.name} onChange={e => set('name', e.target.value)}
                     placeholder="Autumn accessory bonus" />
        </FormField>
        <FormField label="Points per $1" required>
          <Select value={String(p.rate)} onChange={e => set('rate', Number(e.target.value))}>
            {[1, 1.5, 2, 2.5, 3, 4, 5].filter(r => r <= MAX_RATE).map(r =>
              <option key={r} value={r}>{r}×</option>)}
          </Select>
        </FormField>
        <FormField label="Cap per order (points)" required
                   hint="A rule without a cap is an open cheque on your largest order.">
          <TextInput type="number" min="1" step="100" value={String(p.capPerOrder)}
                     onChange={e => set('capPerOrder', Number(e.target.value))} />
        </FormField>
        <FormField label="Starts" hint="Leave blank to start as soon as it is approved.">
          <TextInput type="date" value={p.from} onChange={e => set('from', e.target.value)} />
        </FormField>
        <FormField label="Ends" hint="Blank runs it until you or the marketplace stops it.">
          <TextInput type="date" value={p.to} onChange={e => set('to', e.target.value)} />
        </FormField>
      </div>

      <FormField label="What this is meant to change" required
                 hint="The marketplace reads the reason before the rate.">
        <TextArea rows={3} value={p.why} onChange={e => set('why', e.target.value)}
                  placeholder="Accessories attach to a sensor order or they never sell at all." />
      </FormField>

      <div style={{ padding: '12px 14px', borderRadius: 'var(--radius)', background: 'var(--bg-alt)' }}>
        <div style={{ fontSize: 'var(--text-xs)', fontWeight: 700, marginBottom: '6px' }}>What agreeing to this commits you to</div>
        <ul style={{ margin: 0, paddingLeft: '18px', fontSize: 'var(--text-xs)', lineHeight: 1.7, color: 'var(--text-secondary)' }}>
          {proposalImpact(p, rates, fmt).map((l, i) => <li key={i}>{l}</li>)}
        </ul>
      </div>

      {err && <div style={{ fontSize: 'var(--text-sm)', color: 'var(--danger)', fontWeight: 600, marginTop: '12px' }}>{err}</div>}
    </Modal>
  )
}

export { AlertTriangle as RewardWarn, Undo2 }
