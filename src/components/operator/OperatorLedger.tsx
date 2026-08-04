import { useState, useEffect, useCallback } from 'react'
import {
  Download, Lock, Plus, TriangleAlert as AlertTriangle, CircleCheck as CheckCircle, Settings,
} from 'lucide-react'
import {
  SectionCard, StatCard, Btn, Modal, FormField, TextInput, TextArea, Select,
  Table, Td, toast, fmtMoney, fmtInt,
} from './shared'
import { Callout } from '../OnboardingJourney'
import { Pager, usePaging } from '../Pager'
import {
  loadLedger, saveMapping, postJournal, closePeriod, openNextPeriod, addAccount,
} from '../../lib/ledgerRepo'
import type { LedgerBook } from '../../lib/ledgerRepo'
import {
  trialBalance, earned, postingsIn, unmappedCharges, idleAccounts, accountUse,
  openPeriod, canClosePeriod, closeImpact, mappingChangeImpact,
  reconciliations, journalRows, toCsv,
} from '../../lib/ledger'
import type { Account, Charge, Period } from '../../lib/ledger'

/* The general ledger.
 *
 * A marketplace is harder to account for than a shop because most of the money
 * passing through it is not its revenue. Gross collected on a seller's behalf
 * is a liability until settlement; only commission and fees are earned. Booking
 * gross to revenue overstates income by roughly the size of the marketplace,
 * which is why the mapping is configuration on this page with a written reason
 * against every line, rather than something buried in a posting routine.
 */

const ACTOR = 'Marketplace finance desk'

type Tab = 'balance' | 'mapping' | 'postings' | 'chart' | 'periods'

export function OperatorLedger() {
  const [book, setBook] = useState<LedgerBook | null>(null)
  const [tab, setTab] = useState<Tab>('balance')
  const [period, setPeriod] = useState<string | null>(null)
  const [editing, setEditing] = useState<Charge | null>(null)
  const [journal, setJournal] = useState(false)
  const [adding, setAdding] = useState(false)
  const [closing, setClosing] = useState(false)

  const reload = useCallback(async () => setBook(await loadLedger()), [])
  useEffect(() => { void reload() }, [reload])

  /* Worked out above the loading guard, because the five tables below are
     paged and `usePaging` is a hook — a hook after an early return runs on some
     renders and not others, which React refuses. Everything here tolerates a
     null `book`; the guard is immediately after. */
  const open = book ? openPeriod(book.periods) : null
  const viewing = period ?? open?.id ?? book?.periods[book.periods.length - 1]?.id ?? null
  const current = book?.periods.find(p => p.id === viewing) ?? null
  const tb = book ? trialBalance(book.postings, book.accounts, viewing) : null
  const money = book ? earned(book.postings, book.accounts, viewing) : null
  const rows = book ? postingsIn(book.postings, viewing) : []
  const unmapped = book ? unmappedCharges(book.charges, book.mapping) : []
  const idle = book ? idleAccounts(book.accounts, book.mapping) : []

  /* One pager per tab rather than one shared: they are different lists of
     different lengths, and coming back to Postings on page 7 having left
     Periods on page 1 is what a reader expects. `resetKey` is the period,
     because changing it changes what every one of these lists contains. */
  const balancePage = usePaging(tb?.rows ?? [], { resetKey: viewing ?? '' })
  const mappingPage = usePaging(book?.charges ?? [], { resetKey: viewing ?? '' })
  const postingsPage = usePaging(rows, { resetKey: viewing ?? '' })
  const chartPage = usePaging(book?.accounts ?? [], { resetKey: viewing ?? '' })
  const periodsPage = usePaging(book?.periods ?? [], { resetKey: viewing ?? '' })

  if (!book || !tb || !money) {
    return <div style={{ textAlign: 'center', padding: '40px' }}><div className="spinner" style={{ margin: '0 auto' }} /></div>
  }
  const checks = current
    ? reconciliations({ postings: book.postings, accounts: book.accounts,
                        statements: book.statements, lines: book.lines, period: current })
    : []
  const failing = checks.filter(c => !c.ok)

  const download = () => {
    const csv = toCsv(journalRows(rows, book.accounts))
    const blob = new Blob([csv], { type: 'text/csv' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `journal-${viewing}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
    toast(`${rows.length} entries exported as ${rows.length * 2} journal rows`)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '16px', flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontSize: 'var(--text-2xl)', fontWeight: 800, color: 'var(--text)' }}>General ledger</h1>
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)', marginTop: '4px' }}>
            Where every charge lands, and the proof that the two sides agree.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <Select value={viewing ?? ''} onChange={e => setPeriod(e.target.value)} style={{ width: 'auto' }}>
            {book.periods.map(p => (
              <option key={p.id} value={p.id}>{p.label}{p.status === 'open' ? ' — open' : ''}</option>
            ))}
          </Select>
          <Btn variant="secondary" onClick={download}><Download size={14} /> Export journal</Btn>
          <Btn variant="secondary" onClick={() => setJournal(true)}><Plus size={14} /> Journal entry</Btn>
        </div>
      </div>

      {book.loadError && <Callout tone="danger" title="Some of the ledger did not load">{book.loadError}</Callout>}

      <Callout tone="info" title="Most of the money passing through a marketplace is not its revenue">
        Gross collected on a seller’s behalf is a liability until settlement; only commission and fees are
        earned. Booking gross to revenue would overstate income by roughly the size of the marketplace, which
        is why the mapping below is configuration with a stated reason rather than something buried in code.
      </Callout>

      <div className="stat-row">
        <StatCard label="Passed through" value={`$${fmtMoney(money.passedThrough)}`}
                  sublabel="Collected on sellers’ behalf — not income" />
        <StatCard label="Actually earned" value={`$${fmtMoney(money.revenue)}`}
                  sublabel={`Commission, fees and advertising, less $${fmtMoney(money.contra)} given back`}
                  color="var(--success)" />
        <StatCard label="Owed to sellers" value={`$${fmtMoney(money.sellerNet)}`}
                  sublabel={`Approved this period · $${fmtMoney(money.taxCollected)} tax collected for the authority`} />
        <StatCard label="Trial balance"
                  value={tb.balanced ? 'Balanced' : `Out by $${fmtMoney(Math.abs(tb.difference))}`}
                  sublabel={`${fmtInt(rows.length)} entries · $${fmtMoney(tb.dr)} each side`}
                  color={tb.balanced ? 'var(--success)' : 'var(--danger)'} />
      </div>

      {failing.length === 0 ? (
        <Callout tone="success" title={`All ${checks.length} reconciliations pass for ${current?.label ?? 'this period'}`}>
          {checks.map(c => c.proves).join(' ')}
        </Callout>
      ) : failing.map(c => (
        <Callout key={c.id} tone="danger" title={c.name}>
          {c.variances.map(v => (
            <div key={v.what}>
              {v.what}: expected ${fmtMoney(v.expected)}, found ${fmtMoney(v.found)} —
              a difference of ${fmtMoney(v.difference)}.
            </div>
          ))}
          <div style={{ marginTop: '4px' }}><strong>{c.remedy}</strong></div>
        </Callout>
      ))}

      {unmapped.length > 0 && (
        <Callout tone="warning" title={`${unmapped.length} charge type${unmapped.length === 1 ? '' : 's'} with no mapping`}>
          {unmapped.map(c => c.label).join(', ')}. Anything of that type would post nowhere at all.
        </Callout>
      )}

      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
        {([
          ['balance', `Trial balance (${tb.rows.length})`],
          ['mapping', `Charge mapping (${book.charges.length})`],
          ['postings', `Postings (${fmtInt(rows.length)})`],
          ['chart', `Chart of accounts (${book.accounts.length})`],
          ['periods', `Periods (${book.periods.length})`],
        ] as const).map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)} style={{
            padding: '8px 15px', borderRadius: 'var(--radius)', cursor: 'pointer',
            fontSize: 'var(--text-sm)', fontWeight: 600, border: '1px solid var(--border)',
            background: tab === id ? 'var(--brand-navy)' : 'white',
            color: tab === id ? 'white' : 'var(--text-secondary)',
          }}>{label}</button>
        ))}
      </div>

      {tab === 'balance' && (
        <SectionCard title={`Trial balance — ${current?.label ?? ''}`}
                     subtitle={`${tb.rows.length} accounts with movement`}>
          <Table headers={['Account', 'Type', 'Debit', 'Credit', 'Movement']}>
            {balancePage.rows.map(r => (
              <tr key={r.code}>
                <Td>
                  <div style={{ fontWeight: 600 }}>{r.code}</div>
                  <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
                    {r.account?.name ?? 'Not in the chart'}
                  </div>
                </Td>
                <Td style={{ fontSize: 'var(--text-xs)' }}>{r.account?.type ?? '—'}</Td>
                <Td right>{r.dr ? `$${fmtMoney(r.dr)}` : '—'}</Td>
                <Td right>{r.cr ? `$${fmtMoney(r.cr)}` : '—'}</Td>
                <Td right><strong>${fmtMoney(r.movement)}</strong></Td>
              </tr>
            ))}
            <tr style={{ borderTop: '2px solid var(--border)' }}>
              <Td><strong>Total</strong></Td>
              <Td>{''}</Td>
              <Td right><strong>${fmtMoney(tb.dr)}</strong></Td>
              <Td right><strong>${fmtMoney(tb.cr)}</strong></Td>
              <Td right><strong>${fmtMoney(tb.difference)}</strong></Td>
            </tr>
          </Table>
          <Pager page={balancePage} noun="accounts" />
        </SectionCard>
      )}

      {tab === 'mapping' && (
        <SectionCard title="Charge mapping"
                     subtitle="One row per thing that can happen commercially, and where it posts">
          <Table headers={['Charge', 'Debit', 'Credit', 'Entries', 'Value', '']}>
            {mappingPage.rows.map(c => {
              const m = book.mapping.find(x => x.charge_id === c.id)
              const ps = rows.filter(p => p.charge_id === c.id)
              const value = ps.reduce((a, p) => a + Number(p.amount), 0)
              return (
                <tr key={c.id}>
                  <Td>
                    <div style={{ fontWeight: 600 }}>{c.label}</div>
                    <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>{c.charge_group} · {c.id}</div>
                  </Td>
                  <Td style={{ fontSize: 'var(--text-xs)' }}>
                    {m ? `${m.dr} ${book.accounts.find(a => a.code === m.dr)?.name ?? ''}` : <Warn>Unmapped</Warn>}
                  </Td>
                  <Td style={{ fontSize: 'var(--text-xs)' }}>
                    {m ? `${m.cr} ${book.accounts.find(a => a.code === m.cr)?.name ?? ''}` : <Warn>Unmapped</Warn>}
                  </Td>
                  <Td right>{ps.length || '—'}</Td>
                  <Td right>{value ? `$${fmtMoney(value)}` : '—'}</Td>
                  <Td right>
                    <Btn variant="secondary" size="sm" onClick={() => setEditing(c)}>
                      <Settings size={12} /> Configure
                    </Btn>
                  </Td>
                </tr>
              )
            })}
          </Table>
          <Pager page={mappingPage} noun="charges" />
        </SectionCard>
      )}

      {tab === 'postings' && (
        <SectionCard title="Postings"
                     subtitle="Generated from the settlement register and the order lines, so the ledger reconciles to them rather than being computed beside them">
          <Table headers={['Entry', 'Charge', 'Reference', 'Debit', 'Credit', 'Amount']}>
            {postingsPage.rows.map(p => (
              <tr key={p.id}>
                <Td>
                  <div style={{ fontWeight: 600, fontSize: 'var(--text-xs)' }}>{p.id}</div>
                  <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
                    {p.when_date}{p.source === 'manual' ? ' · manual' : ''}
                  </div>
                </Td>
                <Td style={{ fontSize: 'var(--text-xs)' }}>
                  {book.charges.find(c => c.id === p.charge_id)?.label ?? p.charge_id}
                  {p.memo && <div style={{ color: 'var(--text-tertiary)' }}>{p.memo}</div>}
                </Td>
                <Td style={{ fontSize: 'var(--text-xs)' }}>
                  {p.ref}
                  {p.partner_id && <div style={{ color: 'var(--text-tertiary)' }}>{p.partner_id}</div>}
                </Td>
                <Td style={{ fontSize: 'var(--text-xs)' }}>{p.dr}</Td>
                <Td style={{ fontSize: 'var(--text-xs)' }}>{p.cr}</Td>
                <Td right><strong>${fmtMoney(Number(p.amount))}</strong></Td>
              </tr>
            ))}
          </Table>
          <Pager page={postingsPage} noun="postings" />
          {rows.length > 200 && (
            <div style={{ padding: '12px 20px', fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
              Showing the first 200 of {fmtInt(rows.length)}. Export the journal for the whole period.
            </div>
          )}
        </SectionCard>
      )}

      {tab === 'chart' && (
        <>
          {idle.length > 0 && (
            <Callout tone="warning" title={`${idle.length} account${idle.length === 1 ? ' has' : 's have'} no charge mapped`}>
              {idle.map(a => `${a.code} ${a.name}`).join(', ')}. Nothing will ever post to{' '}
              {idle.length === 1 ? 'it' : 'them'} until a charge is mapped on the mapping tab — which is the
              usual reason somebody thinks a posting has gone missing.
            </Callout>
          )}
          <SectionCard title="Chart of accounts" subtitle={`${book.accounts.length} accounts`}
                       action={<Btn variant="primary" size="sm" onClick={() => setAdding(true)}>
                         <Plus size={12} /> Add an account
                       </Btn>}>
            <Table headers={['Code', 'Account', 'Type', 'Charges', 'Entries', 'What lands here']}>
              {chartPage.rows.map(a => {
                const use = accountUse(a.code, book.mapping, book.postings)
                return (
                  <tr key={a.code}>
                    <Td><strong>{a.code}</strong></Td>
                    <Td>{a.name}{a.system && <span style={{ color: 'var(--text-tertiary)', fontWeight: 500 }}> · built in</span>}</Td>
                    <Td style={{ fontSize: 'var(--text-xs)' }}>{a.type}</Td>
                    <Td right>{use.charges || <Warn>none</Warn>}</Td>
                    <Td right>{use.postings || '—'}</Td>
                    <Td style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>{a.note}</Td>
                  </tr>
                )
              })}
            </Table>
            <Pager page={chartPage} noun="accounts" />
          </SectionCard>
        </>
      )}

      {tab === 'periods' && (
        <>
          <SectionCard title="Periods" subtitle={`${book.periods.filter(p => p.status === 'open').length} open`}
                       action={open && (
                         <Btn variant="primary" size="sm" onClick={() => setClosing(true)}>
                           <Lock size={12} /> Close {open.label}
                         </Btn>
                       )}>
            <Table headers={['Period', 'Entries', 'Value', 'Closed', 'State']}>
              {periodsPage.rows.map(p => {
                const ps = book.postings.filter(x => x.period === p.id)
                return (
                  <tr key={p.id}>
                    <Td><strong>{p.label}</strong></Td>
                    <Td right>{fmtInt(ps.length)}</Td>
                    <Td right>${fmtMoney(ps.reduce((a, x) => a + Number(x.amount), 0))}</Td>
                    <Td style={{ fontSize: 'var(--text-xs)' }}>
                      {p.closed_on ? `${p.closed_on} by ${p.closed_by}` : '—'}
                    </Td>
                    <Td right>
                      <span style={{
                        padding: '2px 10px', borderRadius: 'var(--radius-full)',
                        fontSize: 'var(--text-xs)', fontWeight: 700,
                        background: p.status === 'open' ? 'var(--success-bg)' : 'var(--bg-alt)',
                        color: p.status === 'open' ? 'var(--success)' : 'var(--text-tertiary)',
                      }}>{p.status}</span>
                    </Td>
                  </tr>
                )
              })}
            </Table>
            <Pager page={periodsPage} noun="periods" />
          </SectionCard>
          <Callout tone="info" title="A correction after close is a journal in the next period, never an edit to a closed one">
            Restating a closed period breaks every report already issued from it.
          </Callout>
        </>
      )}

      {editing && (
        <MappingModal charge={editing} book={book} openPeriodId={open?.id ?? null}
                      onClose={() => setEditing(null)}
                      onDone={async () => { setEditing(null); await reload() }} />
      )}
      {journal && (
        <JournalModal book={book} onClose={() => setJournal(false)}
                      onDone={async () => { setJournal(false); await reload() }} />
      )}
      {adding && (
        <AccountModal onClose={() => setAdding(false)}
                      onDone={async () => { setAdding(false); await reload() }} />
      )}
      {closing && open && (
        <CloseModal period={open} book={book} onClose={() => setClosing(false)}
                    onDone={async () => { setClosing(false); setPeriod(null); await reload() }} />
      )}
    </div>
  )
}

function Warn({ children }: { children: React.ReactNode }) {
  return <span style={{ color: 'var(--warning)', fontWeight: 700, fontSize: 'var(--text-xs)' }}>{children}</span>
}

function MappingModal({ charge, book, openPeriodId, onClose, onDone }: {
  charge: Charge; book: LedgerBook; openPeriodId: string | null
  onClose: () => void; onDone: () => Promise<void>
}) {
  const existing = book.mapping.find(m => m.charge_id === charge.id)
  const [dr, setDr] = useState(existing?.dr ?? '')
  const [cr, setCr] = useState(existing?.cr ?? '')
  const [why, setWhy] = useState(existing?.why ?? '')
  const [err, setErr] = useState('')
  const impact = mappingChangeImpact(charge.id, book.postings, openPeriodId)

  return (
    <Modal open onClose={onClose} title={charge.label}
           footer={<>
             <Btn variant="secondary" onClick={onClose}>Cancel</Btn>
             <Btn variant="primary" onClick={async () => {
               setErr('')
               const r = await saveMapping({
                 chargeId: charge.id, dr, cr, why, accounts: book.accounts, by: ACTOR,
               })
               if (!r.ok) { setErr(r.reason); return }
               toast(r.note ?? 'Saved')
               await onDone()
             }}>Save the mapping</Btn>
           </>}>
      {existing && (
        <div style={{ marginBottom: '16px' }}>
          <Callout tone="info" title="Why it posts this way today">{existing.why}</Callout>
        </div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '0 16px' }}>
        <FormField label="Debit" required>
          <Select value={dr} onChange={e => setDr(e.target.value)}>
            <option value="">Pick an account</option>
            {book.accounts.map(a => <option key={a.code} value={a.code}>{a.code} — {a.name}</option>)}
          </Select>
        </FormField>
        <FormField label="Credit" required>
          <Select value={cr} onChange={e => setCr(e.target.value)}>
            <option value="">Pick an account</option>
            {book.accounts.map(a => <option key={a.code} value={a.code}>{a.code} — {a.name}</option>)}
          </Select>
        </FormField>
      </div>
      <FormField label="Why it posts this way" required
                 hint="A mapping nobody can defend at audit is one that gets changed under pressure and never changed back.">
        <TextArea rows={3} value={why} onChange={e => setWhy(e.target.value)} />
      </FormField>
      {impact && (
        <div style={{ marginTop: '4px' }}>
          <Callout tone="warning" title="This does not rewrite history">{impact}</Callout>
        </div>
      )}
      {err && <div style={{ fontSize: 'var(--text-sm)', color: 'var(--danger)', fontWeight: 600, marginTop: '12px' }}>{err}</div>}
    </Modal>
  )
}

function JournalModal({ book, onClose, onDone }: {
  book: LedgerBook; onClose: () => void; onDone: () => Promise<void>
}) {
  const [chargeId, setChargeId] = useState(book.charges[0]?.id ?? '')
  const [dr, setDr] = useState('')
  const [cr, setCr] = useState('')
  const [amount, setAmount] = useState('')
  const [ref, setRef] = useState('')
  const [memo, setMemo] = useState('')
  const [err, setErr] = useState('')
  const open = openPeriod(book.periods)

  useEffect(() => {
    const m = book.mapping.find(x => x.charge_id === chargeId)
    if (m) { setDr(m.dr); setCr(m.cr) }
  }, [chargeId, book.mapping])

  return (
    <Modal open onClose={onClose} title="Journal entry"
           footer={<>
             <Btn variant="secondary" onClick={onClose}>Cancel</Btn>
             <Btn variant="primary" onClick={async () => {
               setErr('')
               const r = await postJournal({
                 dr, cr, amount: Number(amount) || 0, memo, ref, chargeId,
                 accounts: book.accounts, periods: book.periods, by: ACTOR,
               })
               if (!r.ok) { setErr(r.reason); return }
               toast(r.note ?? 'Posted')
               await onDone()
             }}>Post it</Btn>
           </>}>
      <div style={{ marginBottom: '16px' }}>
        <Callout tone="info" title={open ? `It posts into ${open.label}` : 'There is no open period'}>
          A hand-written entry sits beside the automatic ones and shows on the same trial balance. It carries a
          memo because it is the first thing an auditor pulls.
        </Callout>
      </div>
      <FormField label="What kind of charge" hint="Picking one fills in the sides from its mapping.">
        <Select value={chargeId} onChange={e => setChargeId(e.target.value)}>
          {book.charges.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
        </Select>
      </FormField>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0 16px' }}>
        <FormField label="Debit" required>
          <Select value={dr} onChange={e => setDr(e.target.value)}>
            <option value="">Pick an account</option>
            {book.accounts.map(a => <option key={a.code} value={a.code}>{a.code} — {a.name}</option>)}
          </Select>
        </FormField>
        <FormField label="Credit" required>
          <Select value={cr} onChange={e => setCr(e.target.value)}>
            <option value="">Pick an account</option>
            {book.accounts.map(a => <option key={a.code} value={a.code}>{a.code} — {a.name}</option>)}
          </Select>
        </FormField>
        <FormField label="Amount" required>
          <TextInput type="number" step="0.01" min="0.01" value={amount} onChange={e => setAmount(e.target.value)} />
        </FormField>
        <FormField label="Reference" required hint="The record this comes from.">
          <TextInput value={ref} onChange={e => setRef(e.target.value)} placeholder="INV-2026-0781" />
        </FormField>
      </div>
      <FormField label="Memo" required hint="Why this entry exists, in a sentence somebody can answer at audit.">
        <TextArea rows={2} value={memo} onChange={e => setMemo(e.target.value)} />
      </FormField>
      {err && <div style={{ fontSize: 'var(--text-sm)', color: 'var(--danger)', fontWeight: 600 }}>{err}</div>}
    </Modal>
  )
}

function AccountModal({ onClose, onDone }: { onClose: () => void; onDone: () => Promise<void> }) {
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [type, setType] = useState<Account['type']>('Expense')
  const [note, setNote] = useState('')
  const [err, setErr] = useState('')

  return (
    <Modal open onClose={onClose} title="Add an account"
           footer={<>
             <Btn variant="secondary" onClick={onClose}>Cancel</Btn>
             <Btn variant="primary" onClick={async () => {
               setErr('')
               const r = await addAccount({ code, name, type, note, by: ACTOR })
               if (!r.ok) { setErr(r.reason); return }
               toast(r.note ?? 'Added')
               await onDone()
             }}>Add it</Btn>
           </>}>
      <div style={{ marginBottom: '16px' }}>
        <Callout tone="info" title="Adding a code is the easy part">
          An account with no charge mapped to it never receives a posting and sits at zero forever, which is
          the usual reason somebody reports an entry as missing. Map a charge to it on the mapping tab.
        </Callout>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0 16px' }}>
        <FormField label="Code" required hint="Four digits. The range decides where it sorts.">
          <TextInput value={code} onChange={e => setCode(e.target.value)} placeholder="6040" />
        </FormField>
        <FormField label="Type" required>
          <Select value={type} onChange={e => setType(e.target.value as Account['type'])}>
            {['Asset', 'Liability', 'Revenue', 'Expense', 'Equity', 'Tax', 'Contra'].map(t =>
              <option key={t}>{t}</option>)}
          </Select>
        </FormField>
      </div>
      <FormField label="Name" required>
        <TextInput value={name} onChange={e => setName(e.target.value)} placeholder="Partner incentive spend" />
      </FormField>
      <FormField label="What lands here" required>
        <TextInput value={note} onChange={e => setNote(e.target.value)}
                   placeholder="Campaign contributions the marketplace agreed to carry." />
      </FormField>
      {err && <div style={{ fontSize: 'var(--text-sm)', color: 'var(--danger)', fontWeight: 600 }}>{err}</div>}
    </Modal>
  )
}

function CloseModal({ period, book, onClose, onDone }: {
  period: Period; book: LedgerBook; onClose: () => void; onDone: () => Promise<void>
}) {
  const [err, setErr] = useState('')
  const tb = trialBalance(book.postings, book.accounts, period.id)
  const count = book.postings.filter(p => p.period === period.id).length
  const allowed = canClosePeriod(period, tb, count)

  return (
    <Modal open onClose={onClose} title={`Close ${period.label}`}
           footer={<>
             <Btn variant="secondary" onClick={onClose}>Cancel</Btn>
             <Btn variant="danger" disabled={!allowed.ok} onClick={async () => {
               setErr('')
               const r = await closePeriod({
                 period, postings: book.postings, accounts: book.accounts, by: ACTOR,
               })
               if (!r.ok) { setErr(r.reason); return }
               toast(r.note ?? 'Closed')
               const next = await openNextPeriod({ after: period, by: ACTOR })
               if (next.ok) toast(next.note ?? 'Next period open', 'info')
               await onDone()
             }}>Close the period</Btn>
           </>}>
      <div style={{ marginBottom: '16px' }}>
        {allowed.ok ? (
          <Callout tone="success" title={`Debits and credits agree at $${fmtMoney(tb.dr)}`}>
            <CheckCircle size={12} style={{ verticalAlign: 'middle' }} /> The period can be closed.
          </Callout>
        ) : (
          <Callout tone="danger" title="This period cannot be closed">
            <AlertTriangle size={12} style={{ verticalAlign: 'middle' }} /> {allowed.reason}
          </Callout>
        )}
      </div>
      <ul style={{ margin: 0, paddingLeft: '18px', fontSize: 'var(--text-sm)', lineHeight: 1.7 }}>
        {closeImpact(period, tb, count).map((l, i) => <li key={i}>{l}</li>)}
        <li>The next month opens for posting straight away, so nothing that happens tomorrow has nowhere to go.</li>
      </ul>
      {err && <div style={{ fontSize: 'var(--text-sm)', color: 'var(--danger)', fontWeight: 600, marginTop: '12px' }}>{err}</div>}
    </Modal>
  )
}
