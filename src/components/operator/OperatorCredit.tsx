import { useState, useEffect, useCallback, useMemo } from 'react'
import { ShieldCheck, TriangleAlert, Lock, Landmark } from 'lucide-react'
import {
  SectionCard, EmptyState, Btn, StatusPill, Table, Td, toast,
  Modal, FormField, TextArea, fmtInt, PageHeader, RowActions,
} from './shared'
import { Tabs } from '../ui/Tabs'
import { KpiCard, KpiRow, groupsToKpi } from '../ui/KpiCard'
import { Callout } from '../OnboardingJourney'
import { StatusBadge } from '../ui/StatusBadge'
import { accountBands } from '../../lib/riskRepo'
import { BAND_LABEL as RISK_BAND_LABEL, bandTone } from '../../lib/risk'
import { loadCreditBook, releaseHold } from '../../lib/creditRepo'
import type { CreditBook } from '../../lib/creditRepo'
import {
  BAND_LABEL, BAND_TONE, BAND_MEANING, utilisation, isOver, pressure, PRESSURE_TONE,
  positionLine, securityLine, sellerCover, reviewIn, reviewOverdue, reviewQueue,
  creditBook, creditProblems,
} from '../../lib/credit'
import type { Position } from '../../lib/credit'
import { rankingIn } from '../../lib/money'
import { useMarket } from '../../lib/MarketContext'

/* Who we are exposed to, and what we hold against it.
 *
 * Two risks in opposite directions. A business account owes us, so the
 * instrument is a limit. A seller is owed by us — their refunds and debit notes
 * can exceed their sales — so the instrument is security: a deposit and a
 * rolling reserve. Retail is neither: a shopper pays at checkout, so there is
 * nothing to assess and nothing to hold.
 *
 * Building this found that `credit_limit` had existed for a while as a number on
 * a screen. Four of six accounts had none at all, and the two that did were not
 * held to it — the column even carried a sentence describing a hold that nothing
 * implemented. It implements it now, and the first thing the enforcement found
 * was an account 1.4m rupees past a limit whose own review called it low risk.
 *
 * Which is why the screen leads with who is over rather than with a total. A
 * total across four currencies is a quantity of nothing; an account past its
 * limit is somebody to ring this morning.
 */

const ACTOR = 'Anika Sharma'

export function OperatorCredit() {
  const [book, setBook] = useState<CreditBook | null>(null)
  const [tab, setTab] = useState<'buyers' | 'sellers'>('buyers')
  const [releasing, setReleasing] = useState<string | null>(null)
  /* Above the loading guard: `useMarket` is a hook, and a hook after an early
     return runs on some renders and not others. */
  const { fmtIn } = useMarket()

  const reload = useCallback(async () => setBook(await loadCreditBook()), [])
  useEffect(() => { void reload() }, [reload])

  if (!book) {
    return <div style={{ textAlign: 'center', padding: '40px' }}><div className="spinner" style={{ margin: '0 auto' }} /></div>
  }
  if (book.loadError) {
    return <Callout tone="danger" title="The credit file did not load">{book.loadError}</Callout>
  }

  const today = new Date().toISOString().slice(0, 10)
  const problems = creditProblems(book.positions, book.assessments, book.security, today, fmtIn)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <PageHeader title="Credit & exposure"
        description="Two risks running opposite ways. A business account owes us between the order and the payment, so we set a limit. A seller is owed by us, and their refunds and adjustments can exceed their sales, so we hold security. A retail shopper pays at checkout and is neither." />

      {problems.length > 0 && (
        <Callout tone="danger" title={`${problems.length} thing${problems.length === 1 ? '' : 's'} the credit file disagrees with itself about`}>
          <ul style={{ margin: 0, paddingLeft: '18px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
            {problems.map((p, i) => <li key={i} style={{ lineHeight: 1.6 }}>{p}</li>)}
          </ul>
        </Callout>
      )}

      <Rollup book={book} today={today} />

      {book.held.length > 0 && <Held book={book} onRelease={setReleasing} />}

      <Tabs ariaLabel="Credit views" panelIdPrefix="credit-panel-" value={tab} onChange={id => setTab(id as 'buyers' | 'sellers')}
        tabs={[{ id: 'buyers', label: 'Who owes us' }, { id: 'sellers', label: 'What we hold' }]} />

      <div role="tabpanel" id={`credit-panel-${tab}`} aria-labelledby={`credit-panel-${tab}-tab`}>
        {tab === 'buyers' && <Buyers book={book} today={today} />}
        {tab === 'sellers' && <Sellers book={book} />}
      </div>

      {releasing && (
        <ReleaseDialog id={releasing} book={book}
          onClose={() => setReleasing(null)}
          onDone={async () => { setReleasing(null); await reload() }} />
      )}
    </div>
  )
}

/* ---------------------------------------------------------------- the rollup -- */

function Rollup({ book, today }: { book: CreditBook; today: string }) {
  const { fmtIn, book: moneyBook } = useMarket()
  const b = creditBook(book.positions, book.assessments, today)
  /* Ranking only: which currency leads the card. Nothing is added across
     currencies, and rates already loaded are all that is read. */
  const home = moneyBook.currencies.find(c => c.is_reporting)?.code ?? 'USD'
  const rank = rankingIn(home, moneyBook.rates, today)
  /* Several figures, never one. The book trades in four currencies and a
     single "total exposure" across them would be a quantity of nothing. */
  const exposed = groupsToKpi(b.exposed, fmtIn, '—', rank)

  return (
    <KpiRow label="Credit summary">
      <KpiCard variant="money" label="Owed and committed" unit={exposed.unit} value={exposed.value} breakdown={exposed.breakdown}
        context={`Across ${fmtInt(b.accounts)} accounts, each in its own money`} />
      <KpiCard variant={b.over > 0 ? 'risk' : 'ops'} label="Over their limit" value={fmtInt(b.over)}
        status={b.over === 0 ? 'Nobody is past their limit' : 'Their next requisition is held'} />
      <KpiCard variant="ops" label="Near the limit" value={fmtInt(b.nearLimit)}
        tone={b.nearLimit > 0 ? 'warning' : undefined}
        status="Four fifths used or more" />
      <KpiCard variant="ops" label="Reviews overdue" value={fmtInt(b.unreviewed)}
        tone={b.unreviewed > 0 || b.noLimit > 0 ? 'warning' : undefined}
        status={b.noLimit > 0 ? `${fmtInt(b.noLimit)} trading with no limit at all` : 'Every account has a limit'} />
    </KpiRow>
  )
}

/* --------------------------------------------------------------- held orders -- */

function Held({ book, onRelease }: { book: CreditBook; onRelease: (id: string) => void }) {
  const { fmtIn } = useMarket()
  return (
    <SectionCard title="Purchases held on credit"
      subtitle="Held, not refused. A buyer at their limit is a customer whose finance team should be told — refusing sends them elsewhere and approving quietly is how a receivables book gets away from you.">
      <Table headers={['Requisition', 'Account', 'Amount', 'Why it is held', 'Actions']}>
        {book.held.map(h => (
          <tr key={h.id}>
            <Td kind="id">
              <strong className="c-mono">{h.id}</strong>
              <div className="c-sub">{h.raised_on}</div>
            </Td>
            <Td kind="text" style={{ maxWidth: '28ch' }}>
              <div>{h.account_id}</div>
              <div className="c-sub">{h.title}</div>
            </Td>
            <Td kind="num"><strong>{fmtIn(h.amount, h.currency)}</strong></Td>
            <Td kind="text" style={{ maxWidth: '54ch' }}>
              <span className="c-td__clamp" style={{ WebkitLineClamp: 3 }} title={h.credit_note ?? undefined}>{h.credit_note}</span>
            </Td>
            <Td>
              <RowActions label={h.id} actions={[
                { id: 'release', label: 'Release', variant: 'primary', srOnly: h.id, onClick: () => onRelease(h.id) },
              ]} />
            </Td>
          </tr>
        ))}
      </Table>
    </SectionCard>
  )
}

/* -------------------------------------------------------------- who owes us -- */

function Buyers({ book, today }: { book: CreditBook; today: string }) {
  /* Risk bands by business account id; empty until the risk migration is applied. */
  const [risk, setRisk] = useState<Awaited<ReturnType<typeof accountBands>>>(new Map())
  useEffect(() => { void accountBands('business').then(setRisk) }, [])
  const { fmtIn } = useMarket()
  const rows = useMemo(
    () => reviewQueue(book.positions, book.assessments, today),
    [book, today])

  const live = new Map(book.assessments.filter(a => a.account_id && !a.superseded_by)
    .map(a => [a.account_id!, a]))

  return (
    <SectionCard title="Business accounts, worst first"
      subtitle="Ordered by money already out, then by a decision nobody has revisited. An account over its limit is somebody to ring this morning; an overdue review is somebody to look at this week.">
      <Table headers={['Account', 'Exposure', 'Limit', 'Used', 'Review', 'Assessment']}>
        {rows.map(p => {
          const a = live.get(p.account_id) ?? null
          const u = utilisation(p)
          const pr = pressure(p)
          return (
            <tr key={p.account_id}>
              <Td kind="text" style={{ maxWidth: '24ch' }}>
                <div style={{ fontWeight: 600 }}><span className="c-td__clamp" style={{ WebkitLineClamp: 2 }} title={p.company}>{p.company}</span></div>
                <div className="c-sub c-mono">{p.account_id}</div>
                {risk.has(p.account_id) && (
                  <div style={{ marginTop: '3px' }}>
                    <StatusBadge tone={bandTone(risk.get(p.account_id)!.band)}>Risk: {RISK_BAND_LABEL[risk.get(p.account_id)!.band]}</StatusBadge>
                  </div>
                )}
                {p.deposit_held > 0 && (
                  <div className="c-sub" style={{ marginTop: '2px' }}>
                    {fmtIn(p.deposit_held, p.currency)} deposit held
                  </div>
                )}
              </Td>

              <Td kind="num">
                <strong style={{ color: isOver(p) ? 'var(--danger)' : undefined }}>
                  {fmtIn(p.exposure, p.currency)}
                </strong>
                <div className="c-sub">
                  {fmtIn(p.owed, p.currency)} owed
                  {p.committed > 0 && <> · {fmtIn(p.committed, p.currency)} committed</>}
                </div>
              </Td>

              <Td kind="num">
                {p.credit_limit > 0
                  ? <>
                      {fmtIn(p.credit_limit, p.currency)}
                      <div className={isOver(p) ? undefined : 'c-sub'} style={isOver(p) ? { color: 'var(--danger)' } : undefined}>
                        {isOver(p)
                          ? `${fmtIn(Math.abs(p.headroom), p.currency)} over`
                          : `${fmtIn(p.headroom, p.currency)} left`}
                      </div>
                    </>
                  : <span style={{ color: 'var(--danger)' }}>none set</span>}
              </Td>

              <Td kind="status">
                <StatusPill status={PRESSURE_TONE[pr]}
                  label={Number.isFinite(u) ? `${Math.round(u * 100)}%` : 'no limit'} />
              </Td>

              <Td kind="text" nowrap style={{ maxWidth: '16ch' }}>
                {a
                  ? <div style={{
                      color: reviewOverdue(a, today) ? 'var(--danger)' : undefined,
                      fontWeight: reviewOverdue(a, today) ? 700 : 400,
                    }}>
                      {reviewOverdue(a, today)
                        ? `${-reviewIn(a, today)} days overdue`
                        : `in ${reviewIn(a, today)} days`}
                    </div>
                  : <span style={{ color: 'var(--danger)' }}>never assessed</span>}
              </Td>

              <Td kind="text" style={{ maxWidth: '46ch' }}>
                {a && <StatusPill status={BAND_TONE[a.band]} label={BAND_LABEL[a.band]} />}
                <div className="c-sub" style={{ marginTop: '3px', lineHeight: 1.5 }}>
                  {positionLine(p, fmtIn)}
                </div>
                {a && (
                  <div className="c-sub" style={{ marginTop: '3px', lineHeight: 1.5 }}>
                    {BAND_MEANING[a.band]}
                  </div>
                )}
              </Td>
            </tr>
          )
        })}
      </Table>
    </SectionCard>
  )
}

/* ------------------------------------------------------------ what we hold -- */

function Sellers({ book }: { book: CreditBook }) {
  const { fmtIn } = useMarket()
  const live = new Map(book.assessments.filter(a => a.partner_id && !a.superseded_by)
    .map(a => [a.partner_id!, a]))

  const rows = [...book.sellers].sort((a, b) => {
    const sa = book.security.find(s => s.partner_id === a.partner_id)
    const sb = book.security.find(s => s.partner_id === b.partner_id)
    return (sb?.reserve_pct ?? 0) - (sa?.reserve_pct ?? 0)
  })

  if (rows.length === 0) return <SectionCard title="No sellers"><EmptyState message="Nothing to hold." /></SectionCard>

  return (
    <SectionCard title="Sellers, and what is held against them"
      subtitle="Nobody extends credit to a seller. The exposure runs the other way: their refunds, chargebacks and debit notes can exceed their sales in a period, and then we are out of pocket with nothing to draw on.">
      <Table headers={['Seller', 'We owe them', 'We hold', 'Uncovered', 'Why']}>
        {rows.map(s => {
          const sec = book.security.find(x => x.partner_id === s.partner_id)
          const a = live.get(s.partner_id) ?? null
          const cover = sec
            ? sellerCover(sec, s.unpaid)
            : { held: 0, unpaid: s.unpaid, uncovered: s.unpaid, covered: false, currency: s.currency }
          return (
            <tr key={s.partner_id}>
              <Td kind="text" style={{ maxWidth: '22ch' }}>
                <div style={{ fontWeight: 600 }}><span className="c-td__clamp" style={{ WebkitLineClamp: 2 }} title={s.name}>{s.name}</span></div>
                <div className="c-sub c-mono">{s.partner_id}</div>
                {a && <div style={{ marginTop: '3px' }}><StatusPill status={BAND_TONE[a.band]} label={BAND_LABEL[a.band]} /></div>}
              </Td>
              <Td kind="num">{fmtIn(s.unpaid, s.currency)}</Td>
              <Td kind="num">
                {cover.held > 0
                  ? <strong>{fmtIn(cover.held, cover.currency)}</strong>
                  : <span className="c-sub">—</span>}
                {sec && sec.reserve_pct > 0 && (
                  <div className="c-sub">{sec.reserve_pct}% rolling</div>
                )}
              </Td>
              <Td kind="num">
                <span style={{ color: cover.uncovered > 0 ? 'var(--warning)' : 'var(--success)' }}>
                  {cover.uncovered > 0 ? fmtIn(cover.uncovered, cover.currency) : 'covered'}
                </span>
              </Td>
              <Td kind="text" style={{ maxWidth: '52ch' }}>
                <div style={{ lineHeight: 1.55 }}>
                  {sec ? securityLine(sec, fmtIn) : 'Never assessed.'}
                </div>
                {a && (
                  <div className="c-sub" style={{ marginTop: '3px', lineHeight: 1.5 }}>
                    {a.evidence}
                  </div>
                )}
              </Td>
            </tr>
          )
        })}
      </Table>
    </SectionCard>
  )
}

/* ------------------------------------------------------------------ release -- */

function ReleaseDialog({ id, book, onClose, onDone }: {
  id: string; book: CreditBook; onClose: () => void; onDone: () => Promise<void>
}) {
  const { fmtIn } = useMarket()
  const [why, setWhy] = useState('')
  const [busy, setBusy] = useState(false)
  const h = book.held.find(x => x.id === id)!
  const p = book.positions.find(x => x.account_id === h.account_id) ?? null

  const submit = async () => {
    setBusy(true)
    const r = await releaseHold(id, ACTOR, why)
    setBusy(false)
    toast(r.ok ? `${id} released.` : (r.why ?? 'That did not go through'), r.ok ? 'success' : 'error')
    if (r.ok) await onDone()
  }

  return (
    <Modal open title={`Release ${id}`} onClose={onClose}
      footer={<>
        <Btn variant="secondary" size="sm" onClick={onClose}>Cancel</Btn>
        <Btn size="sm" disabled={busy || !why.trim()} onClick={() => void submit()}>
          {busy ? 'Releasing…' : 'Release it'}
        </Btn>
      </>}>
      {p && (
        <Callout tone={isOver(p) ? 'danger' : 'warning'} title={positionLine(p, fmtIn)}>
          <div style={{ lineHeight: 1.6 }}>
            Releasing this adds {fmtIn(h.amount, h.currency)}, taking the account to{' '}
            {fmtIn(p.exposure + h.amount, p.currency)} against a limit of {fmtIn(p.credit_limit, p.currency)}.
          </div>
        </Callout>
      )}
      <div style={{ marginTop: '12px' }}>
        <FormField label="What the release is against" required
                   hint="An early payment, a director guarantee, a correction to the limit. A hold lifted for no recorded reason is a limit that does not exist.">
          <TextArea rows={3} value={why} onChange={e => setWhy(e.target.value)} />
        </FormField>
      </div>
    </Modal>
  )
}
