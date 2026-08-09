import { useState, useEffect, useCallback, useMemo } from 'react'
import { FileSignature, TriangleAlert, Download, RefreshCw, Ban } from 'lucide-react'
import {
  SectionCard, StatCard, EmptyState, Btn, StatusPill, Table, Td, toast,
  Modal, FormField, TextArea, TextInput, fmtInt,
} from './shared'
import { Callout } from '../OnboardingJourney'
import {
  loadContractBook, renewContract, terminateContract, addAmendment, signedCopyUrl,
} from '../../lib/contractsRepo'
import type { ContractBook } from '../../lib/contractsRepo'
import {
  STANDING_LABEL, STANDING_TONE, AMENDMENT_LABEL,
  standingOf, daysLeft, noticeBy, whatHappensNext, renewalQueue,
  registerOf, againstTerm, inEffectOrder, validateAmendment, contractProblems,
} from '../../lib/contracts'
import type { Contract } from '../../lib/contracts'
import { formatGroups } from '../../lib/money'
import { useMarket } from '../../lib/MarketContext'

/* What every account is buying under.
 *
 * Six accounts had been trading for the whole life of this prototype with
 * nothing anywhere saying on whose authority. The payment terms sat on two
 * different rows and had already drifted apart; one of them advertised
 * "contract pricing on most lines" for an arrangement that exists nowhere in
 * the codebase and which CR-008 records as not operated here.
 *
 * The screen leads with what is running out rather than with a count, because a
 * register of agreements is only interesting at its edges. An expired agreement
 * is an account that cannot buy anything right now. An expiring one is the last
 * chance to act before that.
 */

const ACTOR = 'Anika Sharma'

export function OperatorContracts() {
  const [book, setBook] = useState<ContractBook | null>(null)
  const [renewing, setRenewing] = useState<Contract | null>(null)
  const [ending, setEnding] = useState<Contract | null>(null)
  const [amending, setAmending] = useState<Contract | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  /* Above the loading guard: a hook after an early return runs on some renders
     and not others. */
  const { fmtIn } = useMarket()

  const reload = useCallback(async () => setBook(await loadContractBook()), [])
  useEffect(() => { void reload() }, [reload])

  if (!book) {
    return <div style={{ textAlign: 'center', padding: '40px' }}><div className="spinner" style={{ margin: '0 auto' }} /></div>
  }
  if (book.loadError) {
    return <Callout tone="danger" title="The register did not load">{book.loadError}</Callout>
  }

  const today = new Date().toISOString().slice(0, 10)
  const problems = contractProblems(book.contracts, book.accounts, today)
  const reg = registerOf(book.contracts, today)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div>
        <h1 style={{ fontSize: 'var(--text-2xl)', fontWeight: 800, color: 'var(--text)' }}>
          Agreements
        </h1>
        <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)', marginTop: '4px', maxWidth: '84ch' }}>
          What each business account buys under: the term, the payment terms and who signed.
          Not a price list — every account is charged the published price for its market, and
          nothing here changes what anything costs. An account with no agreement in force
          cannot raise or approve a purchase at all.
        </p>
      </div>

      {problems.length > 0 && (
        <Callout tone="danger" title={`${problems.length} thing${problems.length === 1 ? '' : 's'} to fix in the register`}>
          <ul style={{ margin: '4px 0 0 16px' }}>{problems.map((p, i) => <li key={i}>{p}</li>)}</ul>
        </Callout>
      )}

      <div className="stat-row">
        <StatCard label="In force" value={fmtInt(reg.inForce)}
          sublabel={`of ${fmtInt(reg.total)} on the register`} />
        <StatCard label="Expiring" value={fmtInt(reg.expiring)}
          sublabel="Inside their own notice period"
          color={reg.expiring ? 'var(--warning)' : undefined} />
        <StatCard label="Expired" value={fmtInt(reg.expired)}
          sublabel={reg.expired ? 'These accounts cannot buy' : 'Nobody is locked out'}
          color={reg.expired ? 'var(--danger)' : undefined} />
        {/* Never one figure across four currencies. And "stated" rather than
            "committed", because nothing here is a commitment to buy. */}
        <StatCard label="Stated across live terms" value={formatGroups(reg.committed, fmtIn)}
          sublabel={`${fmtInt(reg.autoRenewing)} of ${fmtInt(reg.inForce)} renew automatically`} />
      </div>

      <Register book={book} today={today} fmtIn={fmtIn}
        onOpen={setOpen} openId={open}
        onRenew={setRenewing} onEnd={setEnding} onAmend={setAmending} />

      {renewing && (
        <RenewModal contract={renewing} onClose={() => setRenewing(null)}
          onDone={async () => { setRenewing(null); await reload() }} />
      )}
      {ending && (
        <TerminateModal contract={ending} onClose={() => setEnding(null)}
          onDone={async () => { setEnding(null); await reload() }} />
      )}
      {amending && (
        <AmendModal contract={amending} onClose={() => setAmending(null)}
          onDone={async () => { setAmending(null); await reload() }} />
      )}
    </div>
  )
}

/* ------------------------------------------------------------- the register -- */

function Register({ book, today, fmtIn, onOpen, openId, onRenew, onEnd, onAmend }: {
  book: ContractBook; today: string
  fmtIn: (n: number, c: string) => string
  onOpen: (id: string | null) => void; openId: string | null
  onRenew: (c: Contract) => void; onEnd: (c: Contract) => void; onAmend: (c: Contract) => void
}) {
  /* Soonest first, expired above expiring. An expired agreement is an account
     that cannot buy right now; everything else can wait until this week. */
  const rows = useMemo(() => renewalQueue(book.contracts, today), [book, today])

  if (rows.length === 0) {
    return <SectionCard title="Nothing on the register">
      <EmptyState message="No account has an agreement on file" />
    </SectionCard>
  }

  return (
    <SectionCard title="Agreements, soonest first"
      subtitle="Expired at the top because those accounts are locked out today, then by how little time is left. Click a row for the term, the amendments and the signed copy.">
      <Table headers={['Account', 'Agreement', 'Term', 'Terms', 'Ends', 'Standing', '']}>
        {rows.map(c => {
          const s = standingOf(c, today)
          const left = daysLeft(c, today)
          const isOpen = openId === c.id
          return [
            <tr key={c.id} onClick={() => onOpen(isOpen ? null : c.id)}
                style={{ cursor: 'pointer' }}>
              <Td style={{ maxWidth: '22ch' }}>
                <strong style={{ fontSize: 'var(--text-sm)' }}>{c.company}</strong>
                <div style={{ fontSize: '10px', color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}>
                  {c.account_id}
                </div>
              </Td>
              <Td>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)' }}>{c.id}</div>
                <div style={{ fontSize: '10px', color: 'var(--text-tertiary)', maxWidth: '28ch' }}>{c.title}</div>
              </Td>
              <Td style={{ fontSize: 'var(--text-xs)' }}>
                {c.starts_on} → {c.ends_on}
                <div style={{ fontSize: '10px', color: 'var(--text-tertiary)' }}>
                  {c.auto_renew ? 'Auto-renews' : 'Does not renew'} · {c.notice_days}d notice
                </div>
              </Td>
              <Td style={{ fontSize: 'var(--text-xs)' }}>{c.terms}</Td>
              <Td right>
                <div style={{
                  fontWeight: s === 'expired' || s === 'expiring' ? 700 : 400,
                  color: s === 'expired' ? 'var(--danger)' : s === 'expiring' ? 'var(--warning)' : undefined,
                  fontSize: 'var(--text-xs)',
                }}>
                  {/* A countdown only where counting down means something. A
                      superseded agreement showing "in -861 days" is arithmetic
                      leaking through a row that should say when it ended. */}
                  {s === 'superseded' ? `ended ${c.ends_on}`
                    : s === 'terminated' ? `ended ${c.terminated_on ?? c.ends_on}`
                    : s === 'draft' ? 'not signed in'
                    : s === 'expired' ? `${-left} days ago`
                    : s === 'not started' ? `starts ${c.starts_on}`
                    : `in ${left} days`}
                </div>
              </Td>
              <Td><StatusPill status={STANDING_TONE[s]} label={STANDING_LABEL[s]} /></Td>
              <Td right style={{ fontSize: '10px', color: 'var(--text-tertiary)' }}>
                {isOpen ? 'Hide' : 'Open'}
              </Td>
            </tr>,
            isOpen && (
              <tr key={`${c.id}-detail`}>
                <td colSpan={7} style={{ background: 'var(--surface-2)', padding: 0 }}>
                  <Detail contract={c} book={book} today={today} fmtIn={fmtIn}
                    onRenew={onRenew} onEnd={onEnd} onAmend={onAmend} />
                </td>
              </tr>
            ),
          ]
        })}
      </Table>
    </SectionCard>
  )
}

/* ---------------------------------------------------------------- one of them -- */

function Detail({ contract, book, today, fmtIn, onRenew, onEnd, onAmend }: {
  contract: Contract; book: ContractBook; today: string
  fmtIn: (n: number, c: string) => string
  onRenew: (c: Contract) => void; onEnd: (c: Contract) => void; onAmend: (c: Contract) => void
}) {
  const s = standingOf(contract, today)
  const amendments = inEffectOrder(book.amendments.filter(a => a.contract_id === contract.id))
  const spent = book.spentByContract[contract.id] ?? 0
  const against = againstTerm(contract, spent, today)
  const by = noticeBy(contract)

  const download = async () => {
    const url = await signedCopyUrl(contract.document_path)
    if (!url) { toast('There is no signed copy on file for this one.', 'error'); return }
    window.open(url, '_blank', 'noopener')
  }

  return (
    <div style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
      <Callout tone={s === 'expired' ? 'danger' : s === 'expiring' ? 'warning' : 'info'}
               title={STANDING_LABEL[s]}>
        {whatHappensNext(contract, today)}
      </Callout>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: '12px' }}>
        <Fact label="Signed" value={contract.signed_on} />
        <Fact label="Signed for the account" value={`${contract.signed_by} · ${contract.signed_title}`} />
        <Fact label="Countersigned" value={contract.countersigned_by} />
        <Fact label="Payment terms" value={contract.terms} />
        <Fact label="Invoiced in" value={contract.currency} />
        <Fact label="Notice due by" value={by ?? 'No notice period'} />
      </div>

      {/* Stated against actual, with how far through the term we are. A
          percentage alone is unreadable: two months in and two months from the
          end give the same figure and mean opposite things. */}
      {against && (
        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>
          <strong>Stated {fmtIn(against.stated, against.currency)}</strong> across the term ·
          {' '}invoiced {fmtIn(against.spent, against.currency)} so far
          {' '}({against.pct}% of the figure, {against.throughTerm}% of the way through the term).
          <div style={{ color: 'var(--text-tertiary)', marginTop: '2px' }}>
            A stated figure, not a commitment. It buys nothing and changes no price.
          </div>
        </div>
      )}

      {contract.note && (
        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>{contract.note}</div>
      )}

      {amendments.length > 0 && (
        <div>
          <div style={{ fontSize: 'var(--text-xs)', fontWeight: 700, marginBottom: '6px' }}>
            {amendments.length} amendment{amendments.length === 1 ? '' : 's'}
          </div>
          {amendments.map(a => (
            <div key={a.id} style={{
              borderLeft: '2px solid var(--border)', paddingLeft: '10px', marginBottom: '10px',
              fontSize: 'var(--text-xs)',
            }}>
              <div>
                <strong>{AMENDMENT_LABEL[a.kind]}</strong>
                <span style={{ color: 'var(--text-tertiary)' }}> · effective {a.effective_on} · signed {a.signed_on} by {a.signed_by}</span>
              </div>
              <div style={{ color: 'var(--text-tertiary)', marginTop: '2px' }}>Was: {a.was}</div>
              <div style={{ marginTop: '1px' }}>Now: {a.now_says}</div>
              <div style={{ color: 'var(--text-secondary)', marginTop: '3px' }}>{a.why}</div>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
        <Btn size="sm" variant="secondary" onClick={download}>
          <Download size={13} /> Signed copy
        </Btn>
        {contract.state === 'active' && <>
          <Btn size="sm" onClick={() => onRenew(contract)}><RefreshCw size={13} /> Renew</Btn>
          <Btn size="sm" variant="secondary" onClick={() => onAmend(contract)}>Amend</Btn>
          <Btn size="sm" variant="danger" onClick={() => onEnd(contract)}><Ban size={13} /> End it</Btn>
        </>}
      </div>
    </div>
  )
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontSize: '10px', color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '.04em' }}>
        {label}
      </div>
      <div style={{ fontSize: 'var(--text-sm)', fontWeight: 600, marginTop: '2px' }}>{value}</div>
    </div>
  )
}

/* ------------------------------------------------------------------ renewing -- */

function RenewModal({ contract, onClose, onDone }: {
  contract: Contract; onClose: () => void; onDone: () => Promise<void>
}) {
  /* Defaults that make the common case one click: the day after the old one
     ends, for the same length of term, on the same terms. */
  const dayAfter = (d: string) => {
    const x = new Date(`${d}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + 1)
    return x.toISOString().slice(0, 10)
  }
  const plusYear = (d: string, years: number) => {
    const x = new Date(`${d}T00:00:00Z`); x.setUTCFullYear(x.getUTCFullYear() + years)
    x.setUTCDate(x.getUTCDate() - 1)
    return x.toISOString().slice(0, 10)
  }
  const starts = dayAfter(contract.ends_on)
  const today = new Date().toISOString().slice(0, 10)

  const [form, setForm] = useState({
    id: `${contract.account_id.replace('ENT-', 'CTR-')}-${String(Number(contract.id.slice(-2)) + 1).padStart(2, '0')}`,
    title: contract.title.replace(/\d{4}–\d{4}/, `${starts.slice(0, 4)}–${plusYear(starts, 1).slice(0, 4)}`),
    signed_on: today,
    starts_on: starts,
    ends_on: plusYear(starts, 1),
    terms: contract.terms,
    auto_renew: contract.auto_renew,
    notice_days: String(contract.notice_days),
    term_value: contract.term_value == null ? '' : String(contract.term_value),
    signed_by: contract.signed_by,
    signed_title: contract.signed_title,
    note: '',
  })
  const [busy, setBusy] = useState(false)
  const set = (k: keyof typeof form, v: string | boolean) => setForm(f => ({ ...f, [k]: v }))

  const submit = async () => {
    setBusy(true)
    const res = await renewContract(contract, {
      id: form.id.trim(), title: form.title.trim(),
      signed_on: form.signed_on, starts_on: form.starts_on, ends_on: form.ends_on,
      terms: form.terms.trim(), auto_renew: form.auto_renew,
      notice_days: Number(form.notice_days) || 30,
      term_value: form.term_value.trim() === '' ? null : Number(form.term_value),
      signed_by: form.signed_by.trim(), signed_title: form.signed_title.trim(),
      countersigned_by: ACTOR,
      note: form.note.trim() || undefined,
    })
    setBusy(false)
    toast(res.ok ? (res.why ?? 'Renewed') : (res.why ?? 'It could not be renewed'),
      res.ok ? 'success' : 'error')
    if (res.ok) await onDone()
  }

  return (
    <Modal open onClose={onClose} title={`Renew ${contract.id} — ${contract.company}`}
      footer={<>
        <Btn variant="secondary" size="sm" onClick={onClose}>Cancel</Btn>
        <Btn size="sm" onClick={submit} disabled={busy}>{busy ? 'Saving…' : 'Renew'}</Btn>
      </>}>
      <Callout tone="info" title="The old one is superseded in the same act">
        {contract.id} runs to {contract.ends_on}. The new term has to start after that — two
        agreements in force at once is two sets of payment terms and no way to say which was
        breached. Nothing about prices changes: those are the published ones for {contract.market}.
      </Callout>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
        <FormField label="Reference" required>
          <TextInput value={form.id} onChange={e => set('id', e.target.value)} />
        </FormField>
        <FormField label="Signed on" required>
          <TextInput type="date" value={form.signed_on} onChange={e => set('signed_on', e.target.value)} />
        </FormField>
        <FormField label="Starts" required>
          <TextInput type="date" value={form.starts_on} onChange={e => set('starts_on', e.target.value)} />
        </FormField>
        <FormField label="Ends" required>
          <TextInput type="date" value={form.ends_on} onChange={e => set('ends_on', e.target.value)} />
        </FormField>
        <FormField label="Payment terms" required>
          <TextInput value={form.terms} onChange={e => set('terms', e.target.value)} />
        </FormField>
        <FormField label="Notice (days)" required>
          <TextInput value={form.notice_days} onChange={e => set('notice_days', e.target.value)} />
        </FormField>
        <FormField label={`Expected spend (${contract.currency})`}
                   hint="Stated by the account. Buys nothing and changes no price.">
          <TextInput value={form.term_value} onChange={e => set('term_value', e.target.value)} />
        </FormField>
        <FormField label="Signed for the account" required>
          <TextInput value={form.signed_by} onChange={e => set('signed_by', e.target.value)} />
        </FormField>
      </div>

      <FormField label="Title" required>
        <TextInput value={form.title} onChange={e => set('title', e.target.value)} />
      </FormField>

      <label style={{ display: 'flex', gap: '8px', alignItems: 'center', fontSize: 'var(--text-sm)' }}>
        <input type="checkbox" checked={form.auto_renew}
               onChange={e => set('auto_renew', e.target.checked)} />
        Renews automatically unless either side gives notice
      </label>

      <FormField label="Note" hint="Anything worth recording against the renewal">
        <TextArea rows={2} value={form.note} onChange={e => set('note', e.target.value)} />
      </FormField>
    </Modal>
  )
}

/* --------------------------------------------------------------- ending it -- */

function TerminateModal({ contract, onClose, onDone }: {
  contract: Contract; onClose: () => void; onDone: () => Promise<void>
}) {
  const [on, setOn] = useState(new Date().toISOString().slice(0, 10))
  const [why, setWhy] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    setBusy(true)
    const res = await terminateContract(contract.id, on, why)
    setBusy(false)
    toast(res.ok ? (res.why ?? 'Ended') : (res.why ?? 'It could not be ended'),
      res.ok ? 'success' : 'error')
    if (res.ok) await onDone()
  }

  return (
    <Modal open onClose={onClose} title={`End ${contract.id} — ${contract.company}`}
      footer={<>
        <Btn variant="secondary" size="sm" onClick={onClose}>Cancel</Btn>
        <Btn variant="danger" size="sm" onClick={submit} disabled={busy}>
          {busy ? 'Saving…' : 'End the agreement'}
        </Btn>
      </>}>
      <Callout tone="danger" title="This stops the account buying">
        From the date below, {contract.company} cannot raise or approve anything on account
        until a new agreement is in force. Subscriptions already running continue to their own
        renewal dates and are still invoiced.
      </Callout>

      <FormField label="Ends on" required>
        <TextInput type="date" value={on} onChange={e => setOn(e.target.value)} />
      </FormField>

      <FormField label="Why" required
                 hint="Whoever takes the call from the account needs this. A termination with no recorded reason leaves them with nothing to say.">
        <TextArea rows={3} value={why} onChange={e => setWhy(e.target.value)}
                  placeholder="Moved to a group agreement; account closing; breach not remedied…" />
      </FormField>
    </Modal>
  )
}

/* ---------------------------------------------------------------- amending -- */

function AmendModal({ contract, onClose, onDone }: {
  contract: Contract; onClose: () => void; onDone: () => Promise<void>
}) {
  const today = new Date().toISOString().slice(0, 10)
  const [form, setForm] = useState({
    kind: 'terms', signed_on: today, effective_on: today,
    was: '', now_says: '', why: '', signed_by: contract.signed_by,
    terms: contract.terms,
  })
  const [busy, setBusy] = useState(false)
  const set = (k: keyof typeof form, v: string) => setForm(f => ({ ...f, [k]: v }))

  /* Checked here so the operator is told as they type, and again in the module
     the moment they press. The database is what actually holds the shape. */
  const check = validateAmendment(form, contract)

  const submit = async () => {
    if (!check.ok) { toast(check.reason, 'error'); return }
    setBusy(true)
    const res = await addAmendment({ ...form, contract_id: contract.id })
    setBusy(false)
    toast(res.ok ? `Recorded as ${res.id}.` : (res.why ?? 'It could not be recorded'),
      res.ok ? 'success' : 'error')
    if (res.ok) await onDone()
  }

  return (
    <Modal open onClose={onClose} title={`Amend ${contract.id} — ${contract.company}`}
      footer={<>
        <Btn variant="secondary" size="sm" onClick={onClose}>Cancel</Btn>
        <Btn size="sm" onClick={submit} disabled={busy || !check.ok}>
          {busy ? 'Saving…' : 'Record the amendment'}
        </Btn>
      </>}>
      <Callout tone="info" title="Both sides, and why">
        An amendment says what it changed from and what to. One side alone cannot be read back
        by whoever has to explain it to the account that signed it, and a change with no reason
        is an edit somebody made. Prices are not amendable here — see CR-008.
      </Callout>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '10px' }}>
        <FormField label="What kind" required>
          <select value={form.kind} onChange={e => set('kind', e.target.value)}
                  style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid var(--border)' }}>
            {Object.entries(AMENDMENT_LABEL).map(([k, label]) =>
              <option key={k} value={k}>{label}</option>)}
          </select>
        </FormField>
        <FormField label="Signed on" required>
          <TextInput type="date" value={form.signed_on} onChange={e => set('signed_on', e.target.value)} />
        </FormField>
        <FormField label="Effective from" required>
          <TextInput type="date" value={form.effective_on} onChange={e => set('effective_on', e.target.value)} />
        </FormField>
      </div>

      <FormField label="What it said" required>
        <TextArea rows={2} value={form.was} onChange={e => set('was', e.target.value)}
                  placeholder="Payment terms: Net 30 from date of invoice." />
      </FormField>
      <FormField label="What it says now" required>
        <TextArea rows={2} value={form.now_says} onChange={e => set('now_says', e.target.value)}
                  placeholder="Payment terms: Net 15 from date of invoice." />
      </FormField>

      {/* Asked for rather than parsed out of the wording above. Deriving it
          with a regular expression gave an account billing terms that read
          "Net 45 from date of invoice" where every other account reads
          "Net 45". */}
      {form.kind === 'terms' && (
        <FormField label="The payment terms become" required
                   hint="The value the agreement, the account and the billing row all take. Written as they are everywhere else — “Net 45”.">
          <TextInput value={form.terms} onChange={e => set('terms', e.target.value)} />
        </FormField>
      )}
      <FormField label="Why" required>
        <TextArea rows={3} value={form.why} onChange={e => set('why', e.target.value)} />
      </FormField>
      <FormField label="Signed for the account" required>
        <TextInput value={form.signed_by} onChange={e => set('signed_by', e.target.value)} />
      </FormField>

      {!check.ok && (form.was || form.now_says || form.why) && (
        <Callout tone="warning" title="Not yet">{check.reason}</Callout>
      )}
    </Modal>
  )
}
