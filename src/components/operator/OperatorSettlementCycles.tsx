import { useState, useEffect, useCallback } from 'react'
import { Play } from 'lucide-react'
import {
  SectionCard, Table, Td, StatusPill, EmptyState, Btn, Modal,
  FormField, TextInput, TextArea, Select, toast, fmtInt,
} from './shared'
import { Callout } from '../OnboardingJourney'
import { useMarket } from '../../lib/MarketContext'
import {
  FREQUENCY_LABEL, cycleLine, holdLine, minimumLine,
  termsProblem, termsWarnings, periodLabel,
} from '../../lib/settlementCycle'
import type { Terms, Frequency, Align } from '../../lib/settlementCycle'
import { loadCycleBook, saveTerms, runSettlements, loadWithholdingPositions } from '../../lib/settlementCycleRepo'
import { positionLine, payeeWarnings } from '../../lib/withholding'
import type { CycleBook, DueRow, AccruingRow, Run } from '../../lib/settlementCycleRepo'

/* The contracted cycle, and the runs that follow it.
 *
 * `commission_plans.cycle` used to hold "Monthly, net 30" — a sentence. Nothing
 * parsed it, nothing scheduled from it, and every plan said the same thing, so
 * the marketplace settled every partner monthly whatever their contract said.
 * These two tabs are the contract as a record and the runs as a history.
 */

const ACTOR = 'Anika Sharma'

export function SettlementCycles() {
  const [book, setBook] = useState<CycleBook | null>(null)
  const [editing, setEditing] = useState<Terms | null>(null)

  const reload = useCallback(async () => setBook(await loadCycleBook()), [])
  useEffect(() => { void reload() }, [reload])

  if (!book) return <div style={{ textAlign: 'center', padding: '40px' }}><div className="spinner" style={{ margin: '0 auto' }} /></div>

  const waiting = book.due.filter(d => d.state === 'waiting')

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {book.loadError && <Callout tone="danger" title="Some of this did not load">{book.loadError}</Callout>}

      {/* The only thing on this screen that is a call to action. Everything
          else is a record. */}
      {waiting.length > 0 ? (
        <Callout tone="warning" title={`${waiting.length} ${waiting.length === 1 ? 'partner has' : 'partners have'} a closed period nobody has settled`}>
          {waiting.map(d => `${d.partner_name} (${d.period_start} to ${d.period_end}, closed ${d.closed_on})`).join('; ')}.
          {' '}Run settlement from the Runs tab.
        </Callout>
      ) : (
        <Callout tone="info" title="Every closed period is settled">
          Nothing is waiting. The next contract period to close is{' '}
          {book.due
            .filter(d => d.next_close)
            .sort((a, b) => (a.next_close! < b.next_close! ? -1 : 1))[0]?.next_close ?? 'not scheduled'}.
        </Callout>
      )}

      <SectionCard
        title="Agreed settlement cycles"
        subtitle="What each partner signed. The run reads these rather than a default, so a change here changes when they are paid.">
        {book.due.length === 0 ? <EmptyState message="No partner has an agreed cycle" /> : (
          <Table headers={['Partner', 'Cycle', 'Terms', 'Last closed', 'Next closes', 'State', '']}>
            {book.due.map(d => {
              const t = book.terms.find(x => x.partner_id === d.partner_id)
              return (
                <tr key={d.partner_id}>
                  <Td>
                    <div style={{ fontWeight: 600 }}>{d.partner_name}</div>
                    <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono, monospace)' }}>
                      {d.partner_id}{d.contract_ref ? ` · ${d.contract_ref}` : ''}
                    </div>
                  </Td>
                  <Td>
                    <div style={{ fontWeight: 600 }}>{FREQUENCY_LABEL[d.frequency]}</div>
                    {d.frequency !== 'monthly' && (
                      <div style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>
                        {d.align === 'anniversary' ? 'from the contract month' : 'calendar boundary'}
                      </div>
                    )}
                  </Td>
                  <Td style={{ fontSize: 'var(--text-xs)', maxWidth: '260px' }}>
                    net {d.pay_within_days}
                    {t && holdLine(t) && <div style={{ color: 'var(--text-tertiary)' }}>{holdLine(t)}</div>}
                    {t && minimumLine(t) && <div style={{ color: 'var(--text-tertiary)' }}>{minimumLine(t)}</div>}
                  </Td>
                  <Td right style={{ fontSize: 'var(--text-xs)' }}>
                    {d.closed_on
                      ? <>{periodLabel(d.frequency, d.period_start!)}<div style={{ color: 'var(--text-tertiary)' }}>closed {d.closed_on}</div></>
                      : <span style={{ color: 'var(--text-tertiary)' }}>—</span>}
                  </Td>
                  <Td right style={{ fontSize: 'var(--text-xs)' }}>{d.next_close ?? '—'}</Td>
                  <Td right><StateChip state={d.state} /></Td>
                  <Td right>
                    <Btn size="sm" variant="secondary" onClick={() => setEditing(t ?? null)} disabled={!t}>
                      Edit
                    </Btn>
                  </Td>
                </tr>
              )
            })}
          </Table>
        )}
      </SectionCard>

      <AccruingCard rows={book.accruing} />

      {editing && (
        <TermsEditor
          terms={editing}
          onClose={() => setEditing(null)}
          onSaved={async () => { setEditing(null); await reload() }} />
      )}
    </div>
  )
}

function StateChip({ state }: { state: DueRow['state'] }) {
  const tone = state === 'settled' ? 'healthy'
    : state === 'waiting' ? 'pending'
    : 'degraded'
  return <StatusPill status={tone} label={state} />
}

/* What is building up in the period each partner is in now.
 *
 * A quarterly seller between July and October otherwise looks at a blank
 * screen, and an operator cannot answer "how much is building up" without it.
 * Labelled as accruing everywhere, because it is not owed. */
function AccruingCard({ rows }: { rows: AccruingRow[] }) {
  const { fmtIn } = useMarket()
  if (rows.length === 0) return null
  return (
    <SectionCard
      title="Accruing in the current period"
      subtitle="Not owed and not payable — this is what has been sold since the last period closed. It moves every day.">
      <Table headers={['Partner', 'Period', 'Closes', 'Sales', 'Gross', 'Net so far', 'Held back', 'Payable if it closed today']}>
        {rows.map(r => {
          /* The figure that would actually go out, applying the hold and the
             minimum to what has accrued. Stated as a conditional because it is
             one — a sale tomorrow changes it. */
          const wouldPay = r.net - r.held_back
          const stuck = wouldPay > 0 && wouldPay < r.minimum_payout
          return (
            <tr key={r.partner_id}>
              <Td>{r.partner_name}</Td>
              <Td right style={{ fontSize: 'var(--text-xs)' }}>
                {periodLabel(r.frequency, r.period_start)}
                <div style={{ color: 'var(--text-tertiary)' }}>{r.period_start} to {r.period_end}</div>
              </Td>
              <Td right style={{ fontSize: 'var(--text-xs)' }}>
                {r.closed_on}
                <div style={{ color: 'var(--text-tertiary)' }}>due {r.due_on}</div>
              </Td>
              <Td right>{fmtInt(r.lines)}</Td>
              <Td right>{fmtIn(r.gross, 'USD')}</Td>
              <Td right style={{ fontWeight: 700 }}>{fmtIn(r.net, 'USD')}</Td>
              <Td right>
                {r.held_back > 0
                  ? <span style={{ color: 'var(--warning)' }}>{fmtIn(r.held_back, 'USD')}</span>
                  : <span style={{ color: 'var(--text-tertiary)' }}>—</span>}
                {r.hold_days > 0 && r.held_back === 0 && (
                  <div style={{ fontSize: '10px', color: 'var(--text-tertiary)' }}>
                    nothing inside the {r.hold_days}-day window yet
                  </div>
                )}
              </Td>
              <Td right>
                {stuck ? (
                  <span style={{ color: 'var(--warning)' }}>
                    carries — under {r.minimum_payout.toFixed(2)} {r.payout_currency}
                  </span>
                ) : fmtIn(Math.max(0, wouldPay), 'USD')}
              </Td>
            </tr>
          )
        })}
      </Table>
    </SectionCard>
  )
}

/* ---- The runs ---------------------------------------------------------------- */

export function SettlementRuns() {
  const [book, setBook] = useState<CycleBook | null>(null)
  const [busy, setBusy] = useState(false)
  const [asOf, setAsOf] = useState(new Date().toISOString().slice(0, 10))
  const [last, setLast] = useState<Run['skipped'] | null>(null)

  const reload = useCallback(async () => setBook(await loadCycleBook()), [])
  useEffect(() => { void reload() }, [reload])

  if (!book) return <div style={{ textAlign: 'center', padding: '40px' }}><div className="spinner" style={{ margin: '0 auto' }} /></div>

  const go = async () => {
    setBusy(true)
    const r = await runSettlements({ asOf, actor: ACTOR, kind: 'manual' })
    setBusy(false)
    toast(r.ok ? r.note : r.reason, r.ok ? 'success' : 'error')
    if (r.ok && r.run) setLast(r.run.skipped)
    await reload()
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <SectionCard
        pad
        title="Run settlement"
        subtitle="Settles every contract period that has closed on or before the date and is not settled already."
        action={
          <Btn size="sm" onClick={() => void go()} disabled={busy}>
            <Play size={14} /> {busy ? 'Running…' : 'Run now'}
          </Btn>
        }>
        <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div style={{ minWidth: '180px' }}>
            <FormField label="As at"
                       hint="A run is idempotent — running the same date twice finds the first run's statements rather than paying twice.">
              <TextInput type="date" value={asOf} onChange={e => setAsOf(e.target.value)} />
            </FormField>
          </div>
        </div>

        {/* Named skips. "Three partners were skipped" is not something anybody
            can act on, which is why the run records who and why. */}
        {last && last.length > 0 && (
          <div style={{ marginTop: '4px' }}>
            <div style={{ fontSize: 'var(--text-xs)', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: '6px' }}>
              What that run passed over
            </div>
            {last.map(s => (
              <div key={s.partner_id} style={{
                fontSize: 'var(--text-xs)', color: 'var(--text-secondary)',
                padding: '6px 0', borderTop: '1px solid var(--border-light)',
              }}>
                <strong>{s.partner}</strong> — {s.reason}
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      <SectionCard title="Runs" subtitle={`${book.runs.length} on record, most recent first`}>
        {book.runs.length === 0 ? <EmptyState message="Settlement has never been run" /> : (
          <Table headers={['Run', 'Date', 'Kind', 'By', 'Considered', 'Settled', 'Passed over', 'Status']}>
            {book.runs.map(r => (
              <tr key={r.id}>
                <Td style={{ fontFamily: 'var(--font-mono, monospace)', fontSize: 'var(--text-xs)' }}>{r.id}</Td>
                <Td right>{r.ran_on}</Td>
                <Td right style={{ fontSize: 'var(--text-xs)' }}>{r.kind}</Td>
                <Td right style={{ fontSize: 'var(--text-xs)' }}>{r.ran_by}</Td>
                <Td right>{fmtInt(r.considered)}</Td>
                <Td right style={{ fontWeight: 700 }}>{fmtInt(r.settled)}</Td>
                <Td right style={{ fontSize: 'var(--text-xs)', maxWidth: '360px' }}>
                  {(r.skipped ?? []).length === 0
                    ? <span style={{ color: 'var(--text-tertiary)' }}>nobody</span>
                    : (r.skipped ?? []).map(s => (
                        <div key={s.partner_id} style={{ color: 'var(--text-secondary)' }}>
                          <strong>{s.partner}</strong> — {s.reason}
                        </div>
                      ))}
                </Td>
                <Td right><StatusPill status={r.status === 'complete' ? 'healthy' : 'degraded'} label={r.status} /></Td>
              </tr>
            ))}
          </Table>
        )}
      </SectionCard>
    </div>
  )
}

/* ---- Editing a contract ------------------------------------------------------ */

function TermsEditor({ terms, onClose, onSaved }: {
  terms: Terms; onClose: () => void; onSaved: () => Promise<void>
}) {
  const [draft, setDraft] = useState<Terms>(terms)
  const [busy, setBusy] = useState(false)
  const set = <K extends keyof Terms>(k: K, v: Terms[K]) => setDraft(d => ({ ...d, [k]: v }))

  const problem = termsProblem(draft)
  const warnings = termsWarnings(draft)

  const save = async () => {
    setBusy(true)
    const r = await saveTerms(draft)
    setBusy(false)
    toast(r.ok ? r.note : r.reason, r.ok ? 'success' : 'error')
    if (r.ok) await onSaved()
  }

  return (
    <Modal open onClose={onClose} title={`Settlement cycle — ${draft.partner_id}`}
           footer={<>
             <Btn variant="secondary" size="sm" onClick={onClose}>Cancel</Btn>
             <Btn size="sm" disabled={busy || !!problem} onClick={() => void save()}>
               {busy ? 'Saving…' : 'Save the cycle'}
             </Btn>
           </>}>
      <Callout tone="info" title="This changes when they are paid">
        {cycleLine(draft)} The next run reads this, so a change takes effect from the next period to close —
        it does not re-cut statements that have already been issued.
      </Callout>

      <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: '160px' }}>
          <FormField label="How often">
            <Select value={draft.frequency} onChange={e => set('frequency', e.target.value as Frequency)}>
              {(['monthly', 'quarterly', 'half-yearly', 'yearly'] as const).map(f => (
                <option key={f} value={f}>{FREQUENCY_LABEL[f]}</option>
              ))}
            </Select>
          </FormField>
        </div>
        <div style={{ flex: 1, minWidth: '200px' }}>
          <FormField label="Aligned to"
                     hint="Calendar snaps to the natural boundary — a quarter ends in March, June, September, December. Anniversary counts from the month the contract started.">
            <Select value={draft.align} onChange={e => set('align', e.target.value as Align)}
                    disabled={draft.frequency === 'monthly'}>
              <option value="calendar">The calendar</option>
              <option value="anniversary">The contract month</option>
            </Select>
          </FormField>
        </div>
      </div>

      <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: '150px' }}>
          <FormField label="Closes on day"
                     hint="0 for the last day of the period, whatever length it is. Some contracts say the 25th so the invoice is raised before month end.">
            <TextInput type="number" min={0} max={28} value={String(draft.closes_on_day)}
                       onChange={e => set('closes_on_day', Math.max(0, Math.min(28, Number(e.target.value) || 0)))} />
          </FormField>
        </div>
        <div style={{ flex: 1, minWidth: '150px' }}>
          <FormField label="Payable within (days)">
            <TextInput type="number" min={0} max={120} value={String(draft.pay_within_days)}
                       onChange={e => set('pay_within_days', Math.max(0, Number(e.target.value) || 0))} />
          </FormField>
        </div>
        <div style={{ flex: 1, minWidth: '150px' }}>
          <FormField label="Cycle counts from">
            <TextInput type="date" value={draft.starts_on} onChange={e => set('starts_on', e.target.value)} />
          </FormField>
        </div>
      </div>

      <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: '150px' }}>
          <FormField label="Hold back (days)"
                     hint="Trade inside this window at the close is earned and not yet payable. It carries into the next period.">
            <TextInput type="number" min={0} max={90} value={String(draft.hold_days)}
                       onChange={e => set('hold_days', Math.max(0, Number(e.target.value) || 0))} />
          </FormField>
        </div>
        <div style={{ flex: 2, minWidth: '260px' }}>
          <FormField label="What the hold is for" required={draft.hold_days > 0}>
            <TextArea rows={2} value={draft.hold_reason ?? ''}
                      placeholder="Returns window — a handset sold on the 29th is not settled on the 31st."
                      onChange={e => set('hold_reason', e.target.value || null)} />
          </FormField>
        </div>
      </div>

      <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: '150px' }}>
          <FormField label="Minimum payout"
                     hint="Below this the balance carries. Paying four dollars into a foreign account costs more than four dollars.">
            <TextInput type="number" min={0} step="0.01" value={String(draft.minimum_payout)}
                       onChange={e => set('minimum_payout', Math.max(0, Number(e.target.value) || 0))} />
          </FormField>
        </div>
        <div style={{ flex: 1, minWidth: '130px' }}>
          <FormField label="Paid in">
            <TextInput value={draft.payout_currency}
                       onChange={e => set('payout_currency', e.target.value.toUpperCase().slice(0, 3))} />
          </FormField>
        </div>
        <div style={{ flex: 1, minWidth: '180px' }}>
          <FormField label="Contract reference"
                     hint="A cycle nobody can point at a document for is one that gets changed by whoever asks loudest.">
            <TextInput value={draft.contract_ref ?? ''}
                       onChange={e => set('contract_ref', e.target.value || null)} />
          </FormField>
        </div>
      </div>

      {warnings.map(w => (
        <Callout key={w} tone="warning">{w}</Callout>
      ))}
      {problem && <Callout tone="danger" title="Not ready to save">{problem}</Callout>}
    </Modal>
  )
}

/* ---- Tax deducted at source --------------------------------------------------- */

/* Who is deducted from, at what rate, and why.
 *
 * `partner_bank.withholding` was free text and said "Nil under treaty" for all
 * thirteen sellers — including seven Indian companies paid by an Indian
 * company, where no treaty applies and section 194-O does. This is the position
 * derived from where the payee is, which is the question that column was
 * reaching for.
 */
export function WithholdingPositions() {
  const { fmtIn } = useMarket()
  const [book, setBook] = useState<Awaited<ReturnType<typeof loadWithholdingPositions>> | null>(null)
  const today = new Date().toISOString().slice(0, 10)

  useEffect(() => { void loadWithholdingPositions().then(setBook) }, [])
  if (!book) return <div style={{ textAlign: 'center', padding: '40px' }}><div className="spinner" style={{ margin: '0 auto' }} /></div>

  const byMarket = [...new Set(book.rules.filter(r => r.applies_to === 'partner-payout').map(r => r.market))]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {book.loadError && <Callout tone="danger" title="Some of this did not load">{book.loadError}</Callout>}

      <SectionCard
        title="What each jurisdiction takes"
        subtitle="Residence decides the rate. A treaty reduces a non-resident rate and never a domestic one.">
        <Table headers={['Market', 'Statute', 'On', 'Resident', 'Non-resident', 'With a treaty', 'From']}>
          {book.rules.filter(r => r.applies_to === 'partner-payout').map(r => (
            <tr key={r.id}>
              <Td style={{ fontWeight: 600 }}>{r.market}</Td>
              <Td style={{ fontSize: 'var(--text-xs)' }}>
                <div style={{ fontWeight: 600 }}>{r.label}</div>
                <div style={{ color: 'var(--text-tertiary)' }}>{r.statute}</div>
              </Td>
              <Td right style={{ fontSize: 'var(--text-xs)' }}>
                {r.basis === 'gross' ? 'the whole sale'
                  : r.basis === 'commission' ? 'our commission'
                  : 'the net supply'}
              </Td>
              <Td right style={{ fontWeight: 700 }}>{r.resident_rate}%</Td>
              <Td right>{r.non_resident_rate}%</Td>
              <Td right>
                {r.treaty_rate != null
                  ? `${r.treaty_rate}%`
                  : <span style={{ color: 'var(--text-tertiary)' }}>no relief published</span>}
              </Td>
              <Td right style={{ fontSize: 'var(--text-xs)' }}>{r.effective_from}</Td>
            </tr>
          ))}
        </Table>
      </SectionCard>

      <SectionCard
        title="Where each seller is, and what that means"
        subtitle={`${byMarket.length} jurisdictions configured. A market with no rule is not a nil rate — it is a question nobody has answered.`}>
        <Table headers={['Seller', 'Paid from', 'Resident in', 'Tax id', 'Position']}>
          {book.payees.map(p => {
            const payee = { residence: p.tax_residence ?? p.market, treaty_on_file: p.treaty_on_file }
            const warnings = payeeWarnings(
              { ...payee, tax_id: p.tax_id, treaty_expires: p.treaty_expires }, p.market, today)
            return (
              <tr key={p.partner_id}>
                <Td>
                  <div style={{ fontWeight: 600 }}>{p.partner_name}</div>
                  <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono, monospace)' }}>
                    {p.partner_id}
                  </div>
                </Td>
                <Td right>{p.market}</Td>
                <Td right>
                  {p.tax_residence ?? '—'}
                  {p.tax_residence === p.market && (
                    <div style={{ fontSize: '10px', color: 'var(--text-tertiary)' }}>domestic</div>
                  )}
                </Td>
                <Td right style={{ fontSize: 'var(--text-xs)' }}>
                  {p.tax_id
                    ? <>{p.tax_label} {p.tax_id}</>
                    : <span style={{ color: 'var(--warning)' }}>none on file</span>}
                </Td>
                <Td right style={{ fontSize: 'var(--text-xs)', maxWidth: '460px', color: 'var(--text-secondary)' }}>
                  {positionLine(book.rules, p.market, payee, today)}
                  {warnings.map(w => (
                    <div key={w} style={{ color: 'var(--warning)', marginTop: '3px' }}>{w}</div>
                  ))}
                </Td>
              </tr>
            )
          })}
        </Table>
      </SectionCard>
    </div>
  )
}
