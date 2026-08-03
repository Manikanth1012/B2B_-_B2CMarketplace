import { useState, useEffect, useCallback } from 'react'
import { Zap, Star, Gift, Lock, TrendingUp } from 'lucide-react'
import {
  StatCard, SectionCard, Table, Td, StatusPill, fmtMoney, fmtInt, Btn, toast, Modal,
  FormField, TextArea, TextInput, Select, EmptyState,
} from '../operator/shared'
import { Callout } from '../OnboardingJourney'
import { Pager, usePaging } from '../Pager'
import { loadAccount } from '../../lib/enterpriseRepo'
import type { AccountBook } from '../../lib/enterpriseRepo'
import { loadRewards, proposeRedemption, decideRedemption, withdrawRedemption } from '../../lib/enterpriseRewardsRepo'
import type { RewardBook } from '../../lib/enterpriseRewardsRepo'
import {
  tiersFor, tierProgress, newestFirst, summarise, byRule, byVertical, optionsFor,
  canAfford, canPropose, canRelease, releaseImpact, waiting, settled, committedPoints,
  availablePoints, pointsValue, fmtPoints, money, money0, FUNDER_LABEL,
} from '../../lib/enterpriseRewards'
import type { Redemption, RedeemOption } from '../../lib/enterpriseRewards'

/* Rewards, for a member that is a company rather than a person.
 *
 * Two things drive the whole screen. The tier ladder is the business one — an
 * account spending $78,000 a year would be top tier several times over on the
 * consumer ladder, which would make the tier meaningless — and the points are
 * company money, so spending them is proposed by one person and released by
 * another, exactly like a requisition.
 *
 * Every movement traces to an invoice the account was actually billed for, and
 * every earn names the rule that paid it and who funded it. A balance nobody
 * can reconcile to a purchase is a balance nobody trusts.
 */

export function EnterpriseRewards() {
  const [book, setBook] = useState<RewardBook | null>(null)
  const [account, setAccount] = useState<AccountBook | null>(null)
  const [proposing, setProposing] = useState<RedeemOption | null>(null)
  const [deciding, setDeciding] = useState<{ r: Redemption; release: boolean } | null>(null)

  const reload = useCallback(async () => {
    const [rw, acct] = await Promise.all([loadRewards(), loadAccount()])
    setBook(rw); setAccount(acct)
  }, [])
  useEffect(() => { void reload() }, [reload])

  /* A hundred and nine movements and growing with every invoice, drawn in one
     unbroken list. Paged like every other ledger. Above the loading guard,
     because a hook below an early return runs on some renders and not others. */
  const ledger = usePaging(newestFirst(book?.movements ?? []))

  if (!book || !account) return <div style={{ textAlign: 'center', padding: '40px' }}><div className="spinner" style={{ margin: '0 auto' }} /></div>

  const { member, policy } = book
  const me = account.me
  if (!member || !policy) {
    return (
      <Callout tone="info" title="This account is not enrolled">
        {book.loadError ?? 'No reward account is linked to this company yet. The marketplace enrols an account when it goes live.'}
      </Callout>
    )
  }

  const s = summarise(book.movements)
  const progress = tierProgress(member, book.tiers)
  const ladder = tiersFor(book.tiers, 'enterprise')
  const options = optionsFor(book.options, member)
  const queue = waiting(book.redemptions)
  const history = settled(book.redemptions)
  const spokenFor = committedPoints(book.redemptions)
  const free = availablePoints(member, book.redemptions)
  const mayPropose = me ? canPropose(me.role, policy).ok : false

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '16px', flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontSize: 'var(--text-2xl)', fontWeight: 800, color: 'var(--text)' }}>Rewards</h1>
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)', marginTop: '4px' }}>
            What {member.name} has earned on its spend, what it is worth, and who is allowed to spend it.
          </p>
        </div>
        {mayPropose && options.length > 0 && (
          <Btn onClick={() => setProposing(options.find(o => canAfford(o, member)) ?? options[0])}>
            <Zap size={14} /> Propose a redemption
          </Btn>
        )}
      </div>

      {book.loadError && <Callout tone="danger" title="Some of this did not load">{book.loadError}</Callout>}

      <Callout tone="info" title="Points earned on company spend are company money">
        {policy.note}
      </Callout>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '12px' }}>
        <StatCard label="Balance" value={fmtInt(member.balance)}
                  sublabel={`Worth ${money(pointsValue(member.balance, book.perUnit))}${spokenFor ? ` · ${fmtInt(spokenFor)} already proposed` : ''}`}
                  color="var(--brand-accent-dark)" />
        <StatCard label="Tier" value={progress.current?.name ?? member.tier}
                  sublabel={`${progress.current?.multiplier ?? 1}× on everything the company buys`}
                  color="var(--brand-navy)" />
        <StatCard label="Qualifying spend" value={money0(Number(member.qualify_12m))}
                  sublabel="Rolling twelve months across every seller" />
        <StatCard label="Earned all time" value={fmtInt(s.earned)}
                  sublabel={`${fmtInt(s.redeemed)} spent · ${s.movements} movements`} color="var(--success)" />
      </div>

      {progress.top ? (
        <Callout tone="success" title={`${progress.current?.name} held — there is nothing above it`}>
          {progress.current?.note} Points do not expire while this tier is held.
        </Callout>
      ) : (
        <Callout tone="info" title={`${money0(progress.need)} more qualifying spend and the account is ${progress.next?.name}`}>
          {money0(Number(member.qualify_12m))} of the {money0(progress.next?.qualify_spend ?? 0)} needed — {progress.pct}% of the way.
          {' '}Moving up takes the earn rate from {progress.current?.multiplier ?? 1}× to {progress.next?.multiplier}×
          on everything, which is worth about {money(pointsValue(Number(member.qualify_12m) * ((progress.next?.multiplier ?? 1) - (progress.current?.multiplier ?? 1)), book.perUnit))} a year at the current spend.
        </Callout>
      )}

      <SectionCard title="The business ladder"
                   subtitle="Organisations qualify on business thresholds — the consumer ladder tops out at $4,500, which any company clears on its first invoice">
        <Table headers={['Tier', 'Qualifying spend', 'Earn rate', 'What it gives you', '']}>
          {ladder.map(t => {
            const held = t.id === member.tier
            return (
              <tr key={t.id} style={held ? { background: 'var(--bg-alt)' } : undefined}>
                <Td><span style={{ fontWeight: held ? 800 : 600 }}>{t.name}</span></Td>
                <Td right>{money0(Number(t.qualify_spend))}</Td>
                <Td right>{t.multiplier}×</Td>
                <Td style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', lineHeight: 1.5 }}>
                  {t.benefits.join(' · ')}
                </Td>
                <Td right>{held ? <StatusPill status="active" /> : Number(t.qualify_spend) < Number(member.qualify_12m) ? <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>passed</span> : <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>{money0(Number(t.qualify_spend) - Number(member.qualify_12m))} away</span>}</Td>
              </tr>
            )
          })}
        </Table>
      </SectionCard>

      {queue.length > 0 && (
        <SectionCard title={`${queue.length} waiting to be released`}
                     subtitle="Points are company money — whoever proposed one cannot release it themselves">
          {queue.map(r => {
            const allowed = me ? canRelease(r, me.role, me.id, policy) : { ok: false as const, reason: 'Not signed in' }
            const opt = book.options.find(o => o.id === r.option_id)
            const by = account.members.find(m => m.id === r.proposed_by)
            return (
              <div key={r.id} style={{ padding: '16px 20px', borderBottom: '1px solid var(--border-light)' }}>
                <div style={{ display: 'flex', gap: '14px', alignItems: 'flex-start', flexWrap: 'wrap' }}>
                  <div style={{ flex: 1, minWidth: '240px' }}>
                    <div style={{ fontWeight: 700 }}>{opt?.name ?? r.option_id}</div>
                    <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
                      {r.id} · {by?.name ?? r.proposed_by} · {r.proposed_on}
                      {r.cost_centre ? ` · ${account.centres.find(c => c.id === r.cost_centre)?.name ?? r.cost_centre}` : ''}
                    </div>
                    <div style={{ fontSize: 'var(--text-sm)', fontStyle: 'italic', color: 'var(--text-secondary)', marginTop: '8px', lineHeight: 1.5 }}>
                      “{r.reason}”
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontWeight: 800, fontSize: 'var(--text-lg)' }}>{fmtInt(r.points)}</div>
                    <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>worth ${fmtMoney(Number(r.value))}</div>
                  </div>
                </div>
                <div style={{ marginTop: '12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', flex: 1, minWidth: '200px' }}>
                    {allowed.ok ? 'Yours to release.' : allowed.reason}
                  </span>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    {me && r.proposed_by === me.id && (
                      <Btn variant="secondary" size="sm" onClick={async () => {
                        const res = await withdrawRedemption(r, me)
                        toast(res.ok ? res.note ?? 'Withdrawn' : res.reason, res.ok ? 'success' : 'error')
                        if (res.ok) await reload()
                      }}>Withdraw</Btn>
                    )}
                    <Btn variant="danger" size="sm" disabled={!allowed.ok} onClick={() => setDeciding({ r, release: false })}>Decline</Btn>
                    <Btn variant="success" size="sm" disabled={!allowed.ok} onClick={() => setDeciding({ r, release: true })}>Release</Btn>
                  </div>
                </div>
              </div>
            )
          })}
        </SectionCard>
      )}

      <SectionCard title="What the points can become"
                   subtitle={`${options.length} available to a business account · every one is spent inside the marketplace`}>
        <div style={{ padding: '18px 20px', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '14px' }}>
          {options.map(o => {
            const afford = free >= o.min
            return (
              <div key={o.id} style={{
                border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: '14px',
                opacity: afford ? 1 : 0.65, display: 'flex', flexDirection: 'column', gap: '8px',
              }}>
                <div style={{ fontWeight: 700, fontSize: 'var(--text-sm)' }}>{o.name}</div>
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', lineHeight: 1.5, flex: 1 }}>{o.description}</div>
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
                  From {fmtInt(o.min)} points · funded by {FUNDER_LABEL[o.cost] ?? o.cost}
                </div>
                {afford
                  ? mayPropose
                    ? <Btn size="sm" onClick={() => setProposing(o)}>Propose</Btn>
                    : <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>Only a buyer or the procurement lead can propose one</span>
                  : <span style={{ fontSize: 'var(--text-xs)', color: 'var(--warning)', fontWeight: 600 }}>
                      {fmtInt(o.min - free)} short of what is free to spend
                    </span>}
              </div>
            )
          })}
        </div>
      </SectionCard>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '16px' }}>
        <SectionCard title="What earned the points" subtitle="Whether the programme rewards what the company actually buys">
          <Table headers={['Rule', 'Marketplace', 'Funded by', 'Times', 'Points']}>
            {byRule(book.movements, book.rules).map(r => (
              <tr key={r.id}>
                <Td>
                  <div style={{ fontWeight: 600 }}>{r.rule?.name ?? r.id}</div>
                  {r.rule?.why && <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', maxWidth: '220px', lineHeight: 1.4 }}>{r.rule.why}</div>}
                </Td>
                <Td right style={{ fontSize: 'var(--text-xs)' }}>{r.rule?.scope === 'vertical' ? r.rule.scope_id : 'everything'}</Td>
                {/* Capped for the same reason as the notification rules table:
                    one prose column taking 181px of five was the whole
                    overflow. */}
                <Td right style={{ fontSize: 'var(--text-xs)', maxWidth: '130px' }}>{FUNDER_LABEL[r.funder] ?? r.funder}</Td>
                <Td right>{r.count}</Td>
                <Td right style={{ fontWeight: 600 }}>{fmtInt(r.points)}</Td>
              </tr>
            ))}
          </Table>
        </SectionCard>

        <SectionCard title="By marketplace" subtitle="Where the earning comes from">
          <Table headers={['Marketplace', 'Movements', 'Points', 'Worth']}>
            {byVertical(book.movements, book.rules).map(v => (
              <tr key={v.vertical}>
                <Td>{v.vertical}</Td>
                <Td right>{v.count}</Td>
                <Td right>{fmtInt(v.points)}</Td>
                <Td right>${fmtMoney(pointsValue(v.points, book.perUnit))}</Td>
              </tr>
            ))}
          </Table>
        </SectionCard>
      </div>

      <SectionCard title="Every movement" subtitle={`${book.movements.length} — each one traces to an invoice the account was billed for`}>
        <Table headers={['When', 'What', 'Reference', 'Rule', 'Funded by', 'Points', 'Worth']}>
          {ledger.rows.map(m => (
            <tr key={m.id}>
              <Td style={{ whiteSpace: 'nowrap', fontSize: 'var(--text-xs)' }}>{m.when_date}</Td>
              <Td style={{ fontSize: 'var(--text-xs)' }}>{m.note}</Td>
              <Td right style={{ fontSize: 'var(--text-xs)' }}>{m.ref ?? '—'}</Td>
              <Td right style={{ fontSize: 'var(--text-xs)' }}>{m.rule_id ?? '—'}</Td>
              <Td right style={{ fontSize: 'var(--text-xs)' }}>{m.funder ? FUNDER_LABEL[m.funder] ?? m.funder : '—'}</Td>
              <Td right style={{ fontWeight: 600, color: Number(m.points) < 0 ? 'var(--danger)' : 'var(--success)' }}>
                {Number(m.points) > 0 ? '+' : ''}{fmtInt(Number(m.points))}
              </Td>
              <Td right>${fmtMoney(Number(m.value))}</Td>
            </tr>
          ))}
        </Table>
        <Pager page={ledger} noun="movements" />
      </SectionCard>

      {history.length > 0 && (
        <SectionCard title="Redemption history" subtitle="Released and declined are both kept">
          <Table headers={['Request', 'What', 'Proposed by', 'Points', 'Released by', 'Outcome']}>
            {history.map(r => (
              <tr key={r.id}>
                <Td><div style={{ fontWeight: 600 }}>{r.id}</div>
                    <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>{r.proposed_on}</div></Td>
                <Td>
                  <div>{book.options.find(o => o.id === r.option_id)?.name ?? r.option_id}</div>
                  {r.decision_note && <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', maxWidth: '360px', lineHeight: 1.4 }}>{r.decision_note}</div>}
                </Td>
                <Td right style={{ fontSize: 'var(--text-xs)' }}>{account.members.find(m => m.id === r.proposed_by)?.name ?? r.proposed_by}</Td>
                <Td right>{fmtInt(r.points)}<div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>${fmtMoney(Number(r.value))}</div></Td>
                <Td right style={{ fontSize: 'var(--text-xs)' }}>
                  {account.members.find(m => m.id === r.released_by)?.name ?? '—'}
                  <div style={{ color: 'var(--text-tertiary)' }}>{r.released_on ?? ''}</div>
                </Td>
                <Td right>
                  <StatusPill status={r.state === 'declined' ? 'rejected' : r.state === 'withdrawn' ? 'draft' : 'approved'} />
                  {r.applied_to && <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', marginTop: '2px' }}>{r.applied_to}</div>}
                </Td>
              </tr>
            ))}
          </Table>
        </SectionCard>
      )}

      {proposing && me && (
        <ProposeModal book={book} account={account} me={me} option={proposing} free={free}
                      onClose={() => setProposing(null)}
                      onDone={async () => { setProposing(null); await reload() }} />
      )}
      {deciding && me && (
        <DecideModal book={book} account={account} me={me} redemption={deciding.r} release={deciding.release}
                     onClose={() => setDeciding(null)}
                     onDone={async () => { setDeciding(null); await reload() }} />
      )}
    </div>
  )
}

function ProposeModal({ book, account, me, option, free, onClose, onDone }: {
  book: RewardBook; account: AccountBook; me: NonNullable<AccountBook['me']>
  option: RedeemOption; free: number; onClose: () => void; onDone: () => Promise<void>
}) {
  const [pick, setPick] = useState(option.id)
  const [points, setPoints] = useState(String(Math.max(option.min, book.policy?.min_redeem ?? option.min)))
  const [reason, setReason] = useState('')
  const [centre, setCentre] = useState(book.policy?.default_cost_centre ?? '')
  const [busy, setBusy] = useState(false)

  const options = optionsFor(book.options, book.member!)
  const chosen = options.find(o => o.id === pick) ?? null
  const n = Number(points) || 0

  const submit = async () => {
    setBusy(true)
    const res = await proposeRedemption({
      book, me, option: chosen, points: n, reason,
      costCentre: book.policy?.allocate_to_cost_centre ? (centre || null) : null,
    })
    setBusy(false)
    toast(res.ok ? res.note ?? 'Proposed' : res.reason, res.ok ? 'success' : 'error')
    if (res.ok) await onDone()
  }

  return (
    <Modal open onClose={onClose} title="Propose a redemption"
      footer={<>
        <Btn variant="secondary" size="sm" onClick={onClose}>Cancel</Btn>
        <Btn size="sm" onClick={submit} disabled={busy}>{busy ? 'Sending…' : 'Propose it'}</Btn>
      </>}>
      <FormField label="What to turn the points into" required>
        <Select value={pick} onChange={e => { setPick(e.target.value); const o = options.find(x => x.id === e.target.value); if (o) setPoints(String(Math.max(o.min, book.policy?.min_redeem ?? o.min))) }}>
          {options.map(o => <option key={o.id} value={o.id}>{o.name} — from {fmtInt(o.min)} points</option>)}
        </Select>
      </FormField>

      <FormField label="How many points" required
                 hint={`${fmtInt(free)} free to spend${chosen ? ` · goes in steps of ${fmtInt(chosen.step)}` : ''} · worth ${money(pointsValue(n, book.perUnit))}`}>
        <TextInput type="number" step={chosen?.step ?? 100} value={points} onChange={e => setPoints(e.target.value)} />
      </FormField>

      {book.policy?.allocate_to_cost_centre && (
        <FormField label="Cost centre" required hint="Where the credit is attributed on the invoice">
          <Select value={centre} onChange={e => setCentre(e.target.value)}>
            <option value="">Pick one…</option>
            {account.centres.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </FormField>
      )}

      <FormField label="What it is for" required
                 hint="Whoever releases it is spending company money on your say-so">
        <TextArea rows={3} value={reason} onChange={e => setReason(e.target.value)} />
      </FormField>

      <Callout tone="info" title="Nothing moves until somebody else releases it">
        {book.policy?.release_roles.map(r => r.replace('-', ' ')).join(' or ')} can sign this off.
        The points stay on the balance and are marked as spoken for until they do.
      </Callout>
    </Modal>
  )
}

function DecideModal({ book, account, me, redemption, release, onClose, onDone }: {
  book: RewardBook; account: AccountBook; me: NonNullable<AccountBook['me']>
  redemption: Redemption; release: boolean; onClose: () => void; onDone: () => Promise<void>
}) {
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const option = book.options.find(o => o.id === redemption.option_id) ?? null
  const impact = book.member && book.policy ? releaseImpact(redemption, book.member, option, book.policy) : []
  const by = account.members.find(m => m.id === redemption.proposed_by)

  const submit = async () => {
    setBusy(true)
    const res = await decideRedemption({ book, me, redemption, release, note })
    setBusy(false)
    toast(res.ok ? res.note ?? 'Saved' : res.reason, res.ok ? 'success' : 'error')
    if (res.ok) await onDone()
  }

  return (
    <Modal open onClose={onClose} title={`${release ? 'Release' : 'Decline'} ${option?.name ?? redemption.id}`}
      footer={<>
        <Btn variant="secondary" size="sm" onClick={onClose}>Cancel</Btn>
        <Btn variant={release ? 'success' : 'danger'} size="sm" onClick={submit} disabled={busy}>
          {busy ? 'Saving…' : release ? 'Release the points' : 'Decline'}
        </Btn>
      </>}>
      <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>
        {by?.name ?? redemption.proposed_by} · {fmtInt(redemption.points)} points · ${fmtMoney(Number(redemption.value))} · {redemption.id}
      </div>

      <FormField label={`Reason (shared with ${by?.name ?? 'the proposer'})`} required={!release}
                 hint={release ? 'Optional' : 'Required — they cannot revise what they were not told about'}>
        <TextArea rows={3} value={note} onChange={e => setNote(e.target.value)} />
      </FormField>

      {release ? (
        <Callout tone="warning" title="Releasing takes the points off the balance">
          <ul style={{ margin: '4px 0 0 16px' }}>{impact.map((s, i) => <li key={i}>{s}</li>)}</ul>
        </Callout>
      ) : (
        <Callout tone="info" title="The points stay where they are">
          Nothing leaves the balance. {by?.name ?? 'The proposer'} is told why and can propose something else.
        </Callout>
      )}
    </Modal>
  )
}

export { Star, Gift, Lock, TrendingUp }
