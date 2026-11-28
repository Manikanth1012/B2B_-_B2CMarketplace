import { useState, useEffect, useCallback } from 'react'
import { Pager, usePaging } from '../Pager'
import { Gift, Clock, TriangleAlert as AlertTriangle, Check, Pause } from 'lucide-react'
import {
  SectionCard, Btn, Modal, FormField, TextInput, TextArea, Select,
  Table, Td, toast, fmtInt, PageHeader, RowActions,
} from './shared'
import { Tabs } from '../ui/Tabs'
import { KpiCard, KpiRow } from '../ui/KpiCard'
import { StatusBadge } from '../ui/StatusBadge'
import { Callout } from '../OnboardingJourney'
import { useMarket } from '../../lib/MarketContext'
import { loadProgramme, approveProposal, rejectProposal, pauseRule } from '../../lib/rewardsRepo'
import type { ProgrammeBook } from '../../lib/rewardsRepo'
import {
  liability, costBySeller, pendingProposals, daysWaiting, shareLabel, FUNDERS,
} from '../../lib/sellerRewards'
import type { EarnRule, Funder, Money } from '../../lib/sellerRewards'
import { totalIn } from '../../lib/money'
import { supabase } from '../../lib/supabase'

/* The marketplace's view of the programme.
 *
 * The operator's question is not "how many points" but what we owe, who funded
 * it, and what is waiting on us. A seller-funded rule sitting unanswered costs
 * the marketplace nothing and costs the seller their campaign, which is exactly
 * why it needs to be at the top of this page rather than in a queue somebody
 * remembers to check.
 */

const ACTOR = 'Marketplace growth desk'

type Tab = 'proposals' | 'rules' | 'sellers' | 'currencies'

/* The day the reporting rates are taken from. The marketplace's own books have
   a closing date; converting at "today" would mean two people opening this page
   a week apart cannot reconcile their figures. */
const AS_OF = '2026-08-01'

export function OperatorRewards() {
  const [book, setBook] = useState<ProgrammeBook | null>(null)
  const [names, setNames] = useState<Record<string, string>>({})
  const [tab, setTab] = useState<Tab>('proposals')
  const [deciding, setDeciding] = useState<EarnRule | null>(null)
  const { book: moneyBook, fmtIn } = useMarket()

  const reload = useCallback(async () => {
    const [b, p] = await Promise.all([
      loadProgramme(),
      supabase.from('partners').select('id,name'),
    ])
    setBook(b)
    setNames(Object.fromEntries(((p.data ?? []) as { id: string; name: string }[]).map(x => [x.id, x.name])))
  }, [])
  useEffect(() => { void reload() }, [reload])

  /* Above the loading guard: `usePaging` is a hook, and a hook after an
     early return runs on some renders and not others. */
  const rulesPage = usePaging((book?.rules ?? []).filter(r => r.status === 'active' || r.status === 'scheduled'))
  const sellersPage = usePaging(book ? costBySeller(book.movements, book.rules) : [])

  if (!book) return <div style={{ textAlign: 'center', padding: '40px' }}><div className="spinner" style={{ margin: '0 auto' }} /></div>

  const programme = book.programme
  const now = new Date()
  const owed = programme ? liability(book.members, book.movements, programme, book.rates) : null
  const pending = pendingProposals(book.rules)
  const sellers = costBySeller(book.movements, book.rules)
  const live = book.rules.filter(r => r.status === 'active' || r.status === 'scheduled')

  /* The marketplace reports in one currency; its members hold points in four.
     `totalIn` is the honest version of what this page used to do implicitly —
     it converts at a named date's rates and hands back what it could not
     convert, so a total computed over three of four currencies says so rather
     than looking complete. */
  const home = moneyBook.currencies.find(c => c.is_reporting)?.code ?? 'USD'
  const reported = (list: readonly Money[]) =>
    totalIn(list, home, moneyBook.rates, AS_OF, moneyBook.currencies)
  const spread = (list: readonly Money[]) =>
    list.map(m => fmtIn(m.amount, m.currency)).join(' · ') || '—'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <PageHeader title={programme?.name ?? 'Rewards'}
        description="The programme, what it owes, and who is paying for it." />

      {book.loadError && <Callout tone="danger" title="Some of this page did not load">{book.loadError}</Callout>}

      {programme && (
        <Callout tone="warning" title="Every point issued is a liability from the moment it exists, not a cost when it is spent">
          {programme.funding_note}
        </Callout>
      )}

      {pending.length > 0 && (
        <Callout tone="info" title={`${pending.length} seller-funded rule${pending.length === 1 ? '' : 's'} waiting on you`}>
          Nothing is issued under a rule until it is approved, so a delay here costs the seller the campaign
          rather than costing the marketplace anything. The longest has been waiting{' '}
          {daysWaiting(pending[0], now)} days.
        </Callout>
      )}

      {owed && (() => {
        const gross = reported(owed.gross)
        const expected = reported(owed.expected)
        const breakage = reported(owed.breakageValue)
        return (
          <>
            <KpiRow label="Programme summary">
              <KpiCard variant="ops" label="Points outstanding" value={fmtInt(owed.outstandingPoints)}
                       status={`across ${book.members.length} members, in ${owed.gross.length} ${owed.gross.length === 1 ? 'currency' : 'currencies'}`} />
              {/* Converted, and said so. This tile used to divide every balance
                  on the marketplace by one rate and put a dollar sign on the
                  answer, which for a rupee member was out by a factor of a
                  hundred. */}
              <KpiCard variant="money" label="Gross liability" unit={home}
                       value={fmtIn(gross.total.amount, gross.total.currency)}
                       context={`If every point were redeemed tomorrow · at ${AS_OF} rates`} />
              <KpiCard variant="money" label="Expected to be spent" unit={home}
                       value={fmtIn(expected.total.amount, expected.total.currency)}
                       context={`${fmtIn(breakage.total.amount, breakage.total.currency)} of estimated breakage`} />
              <KpiCard variant="ops" label="Issued by sellers"
                       value={fmtInt(owed.byFunder.partner + owed.byFunder.shared)}
                       status={`against ${fmtInt(owed.byFunder.operator)} the marketplace funded`} />
            </KpiRow>

            {gross.missing.length > 0 && (
              <Callout tone="danger" title={`${gross.missing.join(', ')} could not be converted`}>
                There is no rate on file for {gross.missing.join(' or ')} at {AS_OF}, so the totals above
                leave those members out. A liability computed over some of the currencies is worse than
                no total, which is why it says so here rather than quietly rounding down.
              </Callout>
            )}
          </>
        )
      })()}

      <Tabs ariaLabel="Programme views" panelIdPrefix="rewards-panel-" value={tab} onChange={id => setTab(id as Tab)}
        tabs={[
          { id: 'proposals', label: 'Waiting on you', count: pending.length },
          { id: 'rules', label: 'Live rules', count: live.length },
          { id: 'sellers', label: 'Cost by seller', count: sellers.length },
          { id: 'currencies', label: 'What is owed, and where', count: owed?.gross.length ?? 0 },
        ]} />

      <div role="tabpanel" id={`rewards-panel-${tab}`} aria-labelledby={`rewards-panel-${tab}-tab`} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {tab === 'proposals' && (
        pending.length === 0 ? (
          <Callout tone="success" title="Nothing waiting">
            Every seller proposal has been answered. New ones appear here the moment they are sent.
          </Callout>
        ) : pending.map(r => (
          <SectionCard key={r.id} title={r.name}
                       subtitle={`${r.id} · ${names[r.scope_id ?? ''] ?? r.scope_id} · proposed by ${r.proposed_by} on ${r.proposed_on}`}
                       action={
                         <StatusBadge tone={(daysWaiting(r, now) ?? 0) > 7 ? 'danger' : 'warning'}
                                      icon={<Clock size={12} aria-hidden="true" />}>
                           waiting {daysWaiting(r, now)} days
                         </StatusBadge>
                       }>
            <div style={{ padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '13px' }}>
                <F label="Rate" value={`${r.rate}× on the seller's products`} />
                <F label="Cap per order" value={r.cap_per_order ? `${fmtInt(r.cap_per_order)} points` : 'None'}
                   sub={r.cap_per_order ? undefined : 'No ceiling on a single order.'} />
                <F label="Runs" value={`${r.from}${r.to ? ` – ${r.to}` : ' onwards'}`} />
                <F label="As proposed, funded by" value={FUNDERS[r.funder].label} sub={shareLabel(r)} />
              </div>
              <div style={{ borderLeft: '3px solid var(--border)', paddingLeft: '12px', lineHeight: 1.6 }}>
                “{r.why}”
              </div>
              <div>
                <Btn variant="primary" size="sm" onClick={() => setDeciding(r)}>
                  <Check size={13} /> Answer it
                </Btn>
              </div>
            </div>
          </SectionCard>
        ))
      )}

      {tab === 'rules' && (
        <SectionCard title="Rules issuing points right now" subtitle="Who funds each, and what it is for">
          <><Table headers={['Rule', 'Applies to', 'Rate', 'Funded by', 'Runs', 'Actions']}>
            {rulesPage.rows.map(r => (
              <tr key={r.id}>
                <Td>
                  <div style={{ fontWeight: 600 }}><span className="c-td__clamp" style={{ WebkitLineClamp: 2 }} title={r.name}>{r.name}</span></div>
                  <div className="c-sub">{r.id}</div>
                </Td>
                <Td>
                  {r.scope === 'all' ? 'Everything'
                    : r.scope === 'vertical' ? `${r.scope_id} marketplace`
                    : names[r.scope_id ?? ''] ?? r.scope_id}
                  <div className="c-sub">{r.audience}</div>
                </Td>
                <Td kind="num">{r.rate}×</Td>
                <Td>
                  <div>{FUNDERS[r.funder].label}</div>
                  <div className="c-sub">{shareLabel(r)}</div>
                </Td>
                <Td kind="date">{r.from}{r.to ? ` – ${r.to}` : ' onwards'}</Td>
                <Td>
                  <RowActions label={r.name} actions={[{
                    id: 'pause', label: 'Pause', variant: 'secondary', icon: <Pause size={12} />,
                    onClick: async () => {
                      const res = await pauseRule(r, ACTOR)
                      toast(res.ok ? (res.note ?? 'Paused') : res.reason, res.ok ? 'success' : 'error')
                      await reload()
                    },
                  }]} />
                </Td>
              </tr>
            ))}
          </Table>
          <div style={{ padding: '0 18px 12px' }}><Pager page={rulesPage} noun="rules" /></div></>
        </SectionCard>
      )}

      {tab === 'sellers' && (
        sellers.length === 0 ? (
          <Callout tone="info" title="No seller is funding anything">
            Every point issued so far has come out of the marketplace's own budget.
          </Callout>
        ) : (
          <SectionCard title="What the programme costs each seller"
                       subtitle={`Recovered on their settlement, itemised by rule on the statement · the ${home} column converts at ${AS_OF} rates`}>
            <><Table headers={['Seller', 'Points issued', 'Movements', 'Recovered from them',
                             `In ${home}`]}>
              {sellersPage.rows.map(s => {
                const inHome = reported(s.cost)
                return (
                  <tr key={s.partner_id}>
                    <Td>
                      <div style={{ fontWeight: 600 }}><span className="c-td__clamp" style={{ WebkitLineClamp: 2 }} title={names[s.partner_id] ?? s.partner_id}>{names[s.partner_id] ?? s.partner_id}</span></div>
                      <div className="c-sub">{s.partner_id}</div>
                    </Td>
                    <Td kind="num">{fmtInt(s.points)}</Td>
                    <Td kind="num">{s.movements}</Td>
                    {/* What they are actually charged, in the currencies they
                        are actually charged in. A seller listing in three
                        markets owes three amounts, and adding them was the
                        whole bug. */}
                    <Td kind="num" style={{ maxWidth: '160px' }}>
                      {s.cost.map(m => (
                        <div key={m.currency}><strong>{fmtIn(m.amount, m.currency)}</strong></div>
                      ))}
                    </Td>
                    <Td kind="num">{fmtIn(inHome.total.amount, inHome.total.currency)}</Td>
                  </tr>
                )
              })}
            </Table>
            <div style={{ padding: '0 18px 12px' }}><Pager page={sellersPage} noun="sellers" /></div></>
          </SectionCard>
        )
      )}

      {tab === 'currencies' && owed && (
        <SectionCard title="What is owed, and in what"
                     subtitle="A point is a unit the marketplace issues; what it is worth is set per currency, so this is several debts rather than one">
          <Table headers={['Currency', 'A point is worth', 'Members', 'Gross liability',
                           'Expected to be spent', 'Breakage']}>
            {owed.gross.map((g, i) => {
              const rate = book.rates.find(r => r.currency === g.currency)
              const members = book.members.filter(m => m.currency === g.currency)
              return (
                <tr key={g.currency}>
                  <Td kind="id"><strong>{g.currency}</strong></Td>
                  <Td kind="num">{rate ? fmtIn(1 / rate.per_unit, g.currency) : '—'}</Td>
                  <Td kind="num">{members.length}</Td>
                  <Td kind="num">{fmtIn(g.amount, g.currency)}</Td>
                  <Td kind="num">{fmtIn(owed.expected[i].amount, g.currency)}</Td>
                  <Td kind="num">{fmtIn(owed.breakageValue[i].amount, g.currency)}</Td>
                </tr>
              )
            })}
          </Table>
          <div style={{ padding: '14px 20px', color: 'var(--slate-600)', lineHeight: 1.6 }}>
            Each rate is a chosen figure, not a converted one — a point is ₹1 in India because somebody
            set it there, not because $0.01 comes to ₹0.87. What is checked instead is that every
            currency hands back the same proportion of what was spent: {spread(owed.gross)} outstanding,
            all of it earned at one percent.
          </div>
        </SectionCard>
      )}

      </div>

      {deciding && (
        <DecideModal rule={deciding} sellerName={names[deciding.scope_id ?? ''] ?? deciding.scope_id ?? ''}
                     onClose={() => setDeciding(null)}
                     onDone={async () => { setDeciding(null); await reload() }} />
      )}
    </div>
  )
}

function F({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <div className="c-sub">{label}</div>
      <div style={{ fontWeight: 600 }}>{value}</div>
      {sub && <div style={{ color: 'var(--warning)', marginTop: '2px' }}>{sub}</div>}
    </div>
  )
}

function DecideModal({ rule, sellerName, onClose, onDone }: {
  rule: EarnRule; sellerName: string; onClose: () => void; onDone: () => Promise<void>
}) {
  const [answer, setAnswer] = useState<'approve' | 'reject'>('approve')
  const [funder, setFunder] = useState<Funder>('partner')
  const [split, setSplit] = useState('40')
  const [note, setNote] = useState('')
  const [err, setErr] = useState('')
  const [saving, setSaving] = useState(false)

  return (
    <Modal open onClose={onClose} title={`Answer ${sellerName} on ${rule.name}`}
           footer={<>
             <Btn variant="secondary" onClick={onClose}>Cancel</Btn>
             <Btn variant={answer === 'reject' ? 'danger' : 'primary'} disabled={saving}
                  onClick={async () => {
                    setSaving(true); setErr('')
                    const r = answer === 'approve'
                      ? await approveProposal({
                          rule, funder, split: funder === 'shared' ? Number(split) : null,
                          note, by: ACTOR,
                        })
                      : await rejectProposal({ rule, note, by: ACTOR })
                    setSaving(false)
                    if (!r.ok) { setErr(r.reason); return }
                    toast(r.note ?? 'Answered')
                    await onDone()
                  }}>
               {saving ? 'Saving…' : answer === 'approve' ? 'Approve it' : 'Refuse it'}
             </Btn>
           </>}>
      <div style={{ marginBottom: '16px' }}>
        <Callout tone="info" title={`${rule.rate}× on ${sellerName}'s products, capped at ${rule.cap_per_order ? fmtInt(rule.cap_per_order) : 'nothing'}`}>
          “{rule.why}”
        </Callout>
      </div>

      <FormField label="Your answer">
        <Select value={answer} onChange={e => setAnswer(e.target.value as 'approve' | 'reject')}>
          <option value="approve">Approve it</option>
          <option value="reject">Refuse it</option>
        </Select>
      </FormField>

      {answer === 'approve' && (
        <>
          <FormField label="Who funds it"
                     hint="The marketplace can agree to carry part. It cannot carry all of it — that is a different rule with a different budget behind it.">
            <Select value={funder} onChange={e => setFunder(e.target.value as Funder)}>
              <option value="partner">The seller, as they proposed</option>
              <option value="shared">Shared — the marketplace carries part</option>
            </Select>
          </FormField>
          {funder === 'shared' && (
            <FormField label="The marketplace's percentage" required
                       hint="Between 1 and 99. The seller carries the rest, and sees both halves.">
              <TextInput type="number" min="1" max="99" value={split} onChange={e => setSplit(e.target.value)} />
            </FormField>
          )}
        </>
      )}

      <FormField label={answer === 'approve' ? 'What to tell them' : 'Why you are refusing'} required
                 hint={answer === 'approve'
                   ? 'A rule approved silently is one the seller cannot plan around, and a changed split with no note on it is one they will dispute.'
                   : 'A proposal refused with nothing on it comes back next quarter unchanged.'}>
        <TextArea rows={3} value={note} onChange={e => setNote(e.target.value)}
                  placeholder={answer === 'approve'
                    ? 'Approved as proposed. It starts on 1 September and we will review it at the end of the window.'
                    : 'The rate overlaps the IoT accelerator already running until December — come back after that ends.'} />
      </FormField>

      {answer === 'reject' && (
        <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-start', color: 'var(--slate-600)', lineHeight: 1.6 }}>
          <AlertTriangle size={13} style={{ flexShrink: 0, marginTop: '2px' }} />
          <span>Refusing costs the marketplace nothing and costs the seller their campaign, so the reason is the whole of what they get back.</span>
        </div>
      )}

      {err && <div style={{ color: 'var(--danger)', fontWeight: 600, marginTop: '12px' }}>{err}</div>}
    </Modal>
  )
}

export { Gift as RewardsIcon }
