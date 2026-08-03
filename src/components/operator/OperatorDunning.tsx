import { useState, useEffect, useCallback } from 'react'
import { Plus, Trash2, Pencil, ArrowLeft, ArrowUp, ArrowDown, Lock } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import {
  SectionCard, Table, Td, StatusPill, EmptyState, fmtMoney, fmtDate, Btn, Modal,
  FormField, TextInput, TextArea, Select, toast, ConfirmDialog, StatCard,
} from './shared'
import { Callout } from '../OnboardingJourney'
import { Pager, usePaging } from '../Pager'
import {
  loadDunning, saveLadder, deleteLadder, saveStep, deleteStep, moveStep, reresolveCase,
} from '../../lib/dunningRepo'
import type { DunningBook, LadderDraft, StepDraft } from '../../lib/dunningRepo'
import {
  stepsOn, ladderFor, casesOn, canDeleteLadder, warningsFor, validateLadder, canAddStep,
  currentStep, caseState, suspendsOn, tierLabel, TIERS, CHANNELS, ACTIONS, AUDIENCE_LABEL,
} from '../../lib/dunning'
import type { Ladder, Step, Case, Audience } from '../../lib/dunning'

/* Collections showed which ladder a case was running on and gave nobody a way
   to see what that ladder was. The steps were an array inside a click handler
   and the rules were five sentences in a bulleted list underneath — which is a
   description of a policy rather than the policy.

   It matters more here than on most screens, because a dunning ladder decides
   when somebody is cut off and the audiences are not comparable. A retail
   customer suspended on day 14 usually churns, taking more with them than the
   receivable was worth. An enterprise invoice at day 35 is nearly always a
   purchase order in transit. A seller must never be suspended at all: their
   listings coming down strands buyers who are mid-order, so the money is
   withheld from settlement instead.

   And one ladder per audience is not enough either. A Platinum customer of six
   years and a Bronze account three weeks old are not the same collections
   problem, and treating them alike is how a marketplace loses the customer it
   least wanted to. */

const ACTOR = 'Marketplace operations'
const AUDIENCES: Audience[] = ['consumer', 'enterprise', 'partner']

export function OperatorDunning() {
  const [book, setBook] = useState<DunningBook | null>(null)
  const [tab, setTab] = useState<'cases' | 'ladders'>('cases')
  const [editing, setEditing] = useState<Ladder | 'new' | null>(null)

  const reload = useCallback(async () => setBook(await loadDunning()), [])
  useEffect(() => { void reload() }, [reload])

  if (!book) return <div style={{ textAlign: 'center', padding: '40px' }}><div className="spinner" style={{ margin: '0 auto' }} /></div>
  if (book.loadError) return <Callout tone="danger" title="Collections did not load">{book.loadError}</Callout>

  if (editing) {
    return (
      <LadderEditor
        book={book}
        ladder={editing === 'new' ? null : editing}
        onDone={async () => { setEditing(null); await reload() }}
        onCancel={() => setEditing(null)}
      />
    )
  }

  const active = book.cases.filter(c => c.status === 'active')
  const outstanding = book.cases.reduce((s, c) => s + Number(c.amount), 0)
  const soonest = active
    .map(c => suspendsOn(c, book.ladders.find(l => l.id === c.ladder_id) ?? null))
    .filter((d): d is number => d !== null)
    .sort((a, b) => a - b)[0]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '16px', flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontSize: 'var(--text-2xl)', fontWeight: 800, color: 'var(--text)' }}>Collections</h1>
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)', marginTop: '4px' }}>
            {active.length} active {active.length === 1 ? 'case' : 'cases'} · ${fmtMoney(outstanding)} outstanding
            {soonest !== undefined && (soonest >= 0
              ? ` · soonest interruption in ${soonest} ${soonest === 1 ? 'day' : 'days'}`
              : ` · one account is ${Math.abs(soonest)} days past its interruption date`)}
          </p>
        </div>
        {tab === 'ladders' && <Btn onClick={() => setEditing('new')}><Plus size={14} style={{ marginRight: 6 }} />New ladder</Btn>}
      </div>

      <div style={{ display: 'flex', gap: '4px', borderBottom: '1px solid var(--border)' }}>
        {([['cases', `Cases (${book.cases.length})`], ['ladders', `Ladders (${book.ladders.length})`]] as const).map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)} style={{
            padding: '8px 14px', border: 'none', background: 'none', cursor: 'pointer',
            fontSize: 'var(--text-sm)', fontWeight: tab === id ? 700 : 500,
            color: tab === id ? 'var(--brand-navy)' : 'var(--text-tertiary)',
            borderBottom: `2px solid ${tab === id ? 'var(--brand-navy)' : 'transparent'}`,
            marginBottom: '-1px',
          }}>{label}</button>
        ))}
      </div>

      {tab === 'cases' ? <Cases book={book} onChanged={reload} /> : <Ladders book={book} onEdit={setEditing} onChanged={reload} />}
    </div>
  )
}

/* ---------------------------------------------------------------- cases --- */

function Cases({ book, onChanged }: { book: DunningBook; onChanged: () => Promise<void> }) {
  const page = usePaging(book.cases)
  const [addModal, setAddModal] = useState(false)
  const [promising, setPromising] = useState<Case | null>(null)
  const [newCase, setNewCase] = useState({ account_name: '', account_type: 'consumer' as Audience, tier: '', amount: 0, reason: '' })

  const ladderOf = (c: Case) => book.ladders.find(l => l.id === c.ladder_id) ?? null

  const act = async (fn: () => Promise<{ ok: boolean; reason?: string; note?: string }>) => {
    const res = await fn()
    if (!res.ok) { toast(res.reason ?? 'That did not work', 'error'); return }
    toast(res.note ?? 'Done')
    await onChanged()
  }

  /* Advancing follows the ladder the account is on rather than a fixed list of
     seven names. A Platinum customer's fourth step is an account review; a
     Bronze customer's is a third reminder, and calling both "Third reminder"
     was the old array's way of pretending they were the same. */
  const advance = async (c: Case) => {
    const l = ladderOf(c)
    const mine = stepsOn(c.ladder_id ?? '', book.steps)
    const next = mine.find(s => s.step_no === c.step + 1)
    if (!next) { toast(`${c.account_name} is at the end of ${l?.name ?? 'the ladder'}.`, 'error'); return }
    const { error } = await supabase.from('operator_dunning_cases')
      .update({ step: next.step_no, step_name: next.name, attempts: c.attempts + 1 }).eq('id', c.id)
    if (error) { toast(error.message, 'error'); return }
    toast(`${c.account_name} advanced to ${next.name} — ${next.channel}, day ${next.day}.`)
    await onChanged()
  }

  const promise = async (c: Case, date: string) => {
    const { error } = await supabase.from('operator_dunning_cases')
      .update({ promise_to_pay: date }).eq('id', c.id)
    if (error) { toast(error.message, 'error'); return }
    const l = ladderOf(c)
    toast(l?.pause_on_promise
      ? `Promise recorded. ${l.name} pauses at ${c.step_name} and resumes from there if it is broken.`
      : 'Promise recorded. This ladder does not pause, so the steps keep running.')
    setPromising(null)
    await onChanged()
  }

  const close = async (c: Case) => {
    await supabase.from('operator_dunning_cases').update({ status: 'resolved' }).eq('id', c.id)
    toast(`${c.account_name} closed — payment received.`)
    await onChanged()
  }

  const add = async () => {
    if (!newCase.account_name.trim()) { toast('Account name is required', 'error'); return }
    if (newCase.amount <= 0) { toast('Amount must be more than zero', 'error'); return }

    const tier = newCase.tier || null
    const l = ladderFor({ audience: newCase.account_type, tier }, book.ladders)
    if (!l) { toast(`No ladder is written for a ${newCase.account_type} account.`, 'error'); return }
    const first = stepsOn(l.id, book.steps)[0]

    const { error } = await supabase.from('operator_dunning_cases').insert({
      id: `dc-${Date.now()}`,
      account_name: newCase.account_name, account_type: newCase.account_type, tier,
      amount: newCase.amount, age_days: 0,
      step: first?.step_no ?? 1, step_name: first?.name ?? 'Opened',
      ladder: newCase.account_type, ladder_id: l.id,
      attempts: 0, reason: newCase.reason || 'New case',
      collector: null, promise_to_pay: null, status: 'active',
      sort_order: book.cases.length ? Math.max(...book.cases.map(c => c.sort_order ?? 0)) + 1 : 0,
    })
    if (error) { toast(error.message, 'error'); return }
    toast(`Case opened on ${l.name}.`)
    setNewCase({ account_name: '', account_type: 'consumer', tier: '', amount: 0, reason: '' })
    setAddModal(false)
    await onChanged()
  }

  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px' }}>
        {AUDIENCES.map(a => {
          const mine = book.cases.filter(c => c.account_type === a && c.status === 'active')
          return (
            <StatCard key={a} label={AUDIENCE_LABEL[a]}
              value={`$${fmtMoney(mine.reduce((s, c) => s + Number(c.amount), 0))}`}
              sublabel={(() => {
                const n = new Set(mine.map(c => c.ladder_id)).size
                return `${mine.length} active · ${n} ${n === 1 ? 'ladder' : 'ladders'} in use`
              })()} />
          )
        })}
      </div>

      <SectionCard title="Dunning cases"
        subtitle="Which ladder a case runs on is resolved from the account, not chosen by a collector"
        action={<Btn size="sm" onClick={() => setAddModal(true)}><Plus size={13} style={{ marginRight: 5 }} />New case</Btn>}>
        {book.cases.length === 0 ? <EmptyState message="No dunning cases" /> : (
          <Table headers={['Account', 'Audience', 'Amount', 'Age', 'On this ladder', 'Step', 'What happens next', 'Status', '']}>
            {page.rows.map(c => {
              const l = ladderOf(c)
              const mine = stepsOn(c.ladder_id ?? '', book.steps)
              const cut = suspendsOn(c, l)
              const resolved = ladderFor({ audience: c.account_type as Audience, tier: c.tier }, book.ladders)
              const drifted = resolved && resolved.id !== c.ladder_id
              return (
                <tr key={c.id} style={{ borderBottom: '1px solid var(--border-light)' }}>
                  <Td>
                    <div style={{ fontWeight: 600 }}>{c.account_name}</div>
                    <div style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>{c.reason}</div>
                  </Td>
                  <Td>
                    {AUDIENCE_LABEL[c.account_type as Audience] ?? c.account_type}
                    <div style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>
                      {tierLabel(c.account_type as Audience, c.tier)}
                    </div>
                  </Td>
                  <Td right style={{ fontWeight: 700, color: 'var(--danger)' }}>${fmtMoney(Number(c.amount))}</Td>
                  <Td right style={{ color: c.age_days > 30 ? 'var(--danger)' : c.age_days > 14 ? 'var(--warning)' : 'var(--text)' }}>
                    {c.age_days}d
                  </Td>
                  <Td>
                    {l?.name ?? '—'}
                    {drifted && (
                      <div style={{ fontSize: '11px', color: 'var(--warning)' }}>
                        their tier now resolves to {resolved!.name}
                      </div>
                    )}
                  </Td>
                  <Td right>{c.step}/{mine.length || '?'}<div style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>{currentStep(c, book.steps)?.name ?? c.step_name}</div></Td>
                  <Td>
                    <div style={{ fontSize: 'var(--text-xs)' }}>{caseState(c, book.steps, l)}</div>
                    <div style={{ fontSize: '11px', color: cut !== null && cut <= 3 ? 'var(--danger)' : 'var(--text-tertiary)' }}>
                      {cut === null
                        ? (l?.withhold_settlement ? 'Settlement withheld — never suspended' : 'Never suspended')
                        : cut >= 0 ? `Service stops in ${cut} ${cut === 1 ? 'day' : 'days'}` : `Past the interruption date by ${Math.abs(cut)}`}
                    </div>
                  </Td>
                  <Td right><StatusPill status={c.status} /></Td>
                  <Td right>
                    <div style={{ display: 'flex', gap: '5px', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                      {c.status === 'active' && <Btn variant="secondary" size="sm" onClick={() => void advance(c)}>Advance</Btn>}
                      {c.status === 'active' && <Btn variant="secondary" size="sm" onClick={() => setPromising(c)}>Promise</Btn>}
                      {drifted && <Btn variant="secondary" size="sm" onClick={() => void act(() => reresolveCase({ c, ladders: book.ladders, actor: ACTOR }))}>Re-resolve</Btn>}
                      {c.status === 'active' && <Btn variant="success" size="sm" onClick={() => void close(c)}>Close</Btn>}
                    </div>
                  </Td>
                </tr>
              )
            })}
          </Table>
        )}
        <Pager page={page} noun="cases" />
      </SectionCard>

      <Modal open={addModal} onClose={() => setAddModal(false)} title="New dunning case"
        footer={<><Btn variant="secondary" size="sm" onClick={() => setAddModal(false)}>Cancel</Btn><Btn size="sm" onClick={() => void add()}>Open the case</Btn></>}>
        <FormField label="Account name" required>
          <TextInput value={newCase.account_name} onChange={e => setNewCase({ ...newCase, account_name: e.target.value })} />
        </FormField>
        <div style={{ display: 'flex', gap: '12px' }}>
          <div style={{ flex: 1 }}>
            <FormField label="Audience">
              <Select value={newCase.account_type}
                onChange={e => setNewCase({ ...newCase, account_type: e.target.value as Audience, tier: '' })}>
                {AUDIENCES.map(a => <option key={a} value={a}>{AUDIENCE_LABEL[a]}</option>)}
              </Select>
            </FormField>
          </div>
          <div style={{ flex: 1 }}>
            <FormField label="Tier" hint="Decides which ladder the case runs on.">
              <Select value={newCase.tier} onChange={e => setNewCase({ ...newCase, tier: e.target.value })}>
                <option value="">Not on a tier</option>
                {TIERS[newCase.account_type].map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
              </Select>
            </FormField>
          </div>
          <div style={{ flex: 1 }}>
            <FormField label="Amount" required>
              <TextInput type="number" step="0.01" value={newCase.amount}
                onChange={e => setNewCase({ ...newCase, amount: parseFloat(e.target.value) || 0 })} />
            </FormField>
          </div>
        </div>
        <FormField label="Reason">
          <TextArea value={newCase.reason} onChange={e => setNewCase({ ...newCase, reason: e.target.value })}
            placeholder="Card expired · PO delay · insufficient funds" />
        </FormField>
        <Callout tone="info" title="It will open on">
          {(() => {
            const l = ladderFor({ audience: newCase.account_type, tier: newCase.tier || null }, book.ladders)
            if (!l) return `No ladder is written for a ${newCase.account_type} account.`
            const first = stepsOn(l.id, book.steps)[0]
            return `${l.name} — ${l.grace_days} days of grace, then ${first ? `${first.name} on day ${first.day}` : 'nothing, because it has no steps'}. ${l.suspend_on_day === null ? 'Never suspended.' : `Service stops on day ${l.suspend_on_day}.`}`
          })()}
        </Callout>
      </Modal>

      {promising && (
        <Modal open onClose={() => setPromising(null)} title={`Promise to pay — ${promising.account_name}`}
          footer={<Btn variant="secondary" size="sm" onClick={() => setPromising(null)}>Cancel</Btn>}>
          <FormField label="Promise date" required
            hint={ladderOf(promising)?.pause_on_promise
              ? `The ladder pauses at ${promising.step_name} and resumes from there if the promise is broken.`
              : 'This ladder does not pause on a promise — the steps keep running.'}>
            <TextInput type="date" onChange={e => { if (e.target.value) void promise(promising, e.target.value) }} />
          </FormField>
        </Modal>
      )}
    </>
  )
}

/* -------------------------------------------------------------- ladders --- */

function Ladders(
  { book, onEdit, onChanged }: {
    book: DunningBook; onEdit: (l: Ladder) => void; onChanged: () => Promise<void>
  },
) {
  const [confirming, setConfirming] = useState<Ladder | null>(null)

  return (
    <>
      <Callout tone="info" title="A ladder decides when somebody is cut off, so the audiences differ and so do the tiers">
        A retail customer suspended on day 14 usually churns, taking more with them than the receivable
        was worth. A missed business invoice at day 35 is nearly always a purchase order in transit. A
        seller is never suspended at all — their listings coming down strands buyers who are mid-order,
        so the settlement is withheld instead. Within an audience, a tier ladder overrides the default
        and may only be gentler than it.
      </Callout>

      {AUDIENCES.map(a => {
        const mine = book.ladders.filter(l => l.audience === a).sort((x, y) =>
          (x.tier === null ? 0 : 1) - (y.tier === null ? 0 : 1) || x.sort_order - y.sort_order)
        return (
          <SectionCard key={a} title={AUDIENCE_LABEL[a]}
            subtitle={`${mine.length} ${mine.length === 1 ? 'ladder' : 'ladders'} · the default applies to anyone with no ladder of their own`}>
            <Table headers={['Ladder', 'Applies to', 'Grace', 'Steps', 'Service stops', 'On it now', '']}>
              {mine.map(l => {
                const steps = stepsOn(l.id, book.steps)
                const on = casesOn(l.id, book.cases)
                const del = canDeleteLadder(l, book.cases)
                const warn = warningsFor(l, book.steps).filter(w => w.level === 'warn')
                return (
                  <tr key={l.id} style={{ borderBottom: '1px solid var(--border-light)' }}>
                    <Td>
                      <div style={{ fontWeight: 600 }}>
                        {l.name}
                        {l.system && <span style={pillStyle}>Built in</span>}
                        {l.tier === null && <span style={{ ...pillStyle, background: 'var(--info-bg)', color: 'var(--info)' }}>Default</span>}
                      </div>
                      <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', maxWidth: '52ch' }}>{l.note}</div>
                      {warn.length > 0 && (
                        <div style={{ fontSize: '11px', color: 'var(--warning)', marginTop: 3 }}>
                          {warn.length} thing{warn.length === 1 ? '' : 's'} worth a second look
                        </div>
                      )}
                    </Td>
                    <Td>{tierLabel(a, l.tier)}</Td>
                    <Td right>{l.grace_days}d</Td>
                    <Td right>{steps.length}</Td>
                    <Td>
                      {l.suspend_on_day === null
                        ? <span style={{ color: 'var(--text-tertiary)' }}>{l.withhold_settlement ? 'Never — settlement withheld' : 'Never'}</span>
                        : `Day ${l.suspend_on_day}`}
                    </Td>
                    <Td right>{on.length || <span style={{ color: 'var(--text-tertiary)' }}>—</span>}</Td>
                    <Td right>
                      <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end' }}>
                        <Btn size="sm" variant="secondary" onClick={() => onEdit(l)}>
                          <Pencil size={12} style={{ marginRight: 4 }} />Edit
                        </Btn>
                        <Btn size="sm" variant="danger" disabled={!del.ok} title={del.ok ? undefined : del.reason}
                          onClick={() => setConfirming(l)}>
                          <Trash2 size={12} />
                        </Btn>
                      </div>
                    </Td>
                  </tr>
                )
              })}
            </Table>
          </SectionCard>
        )
      })}

      <ConfirmDialog
        open={!!confirming}
        onClose={() => setConfirming(null)}
        title={confirming ? `Delete ${confirming.name}` : ''}
        message="Nobody is being chased on it, so nobody's chase changes. Accounts at this tier fall back to the audience default."
        confirmLabel="Delete it" danger
        onConfirm={async () => {
          if (!confirming) return
          const res = await deleteLadder({ ladder: confirming, cases: book.cases, actor: ACTOR })
          if (!res.ok) { toast(res.reason, 'error'); return }
          toast(res.note ?? 'Deleted')
          setConfirming(null)
          await onChanged()
        }}
      />
    </>
  )
}

/* --------------------------------------------------------- the editor ---- */

function blankLadder(): LadderDraft {
  return {
    name: '', audience: 'consumer', tier: null, grace_days: 3, suspend_on_day: 14,
    withhold_settlement: false, pause_on_promise: true, note: '',
  }
}

function LadderEditor(
  { book, ladder, onDone, onCancel }: {
    book: DunningBook; ladder: Ladder | null
    onDone: () => Promise<void>; onCancel: () => void
  },
) {
  const [draft, setDraft] = useState<LadderDraft>(() =>
    ladder ? { ...(ladder as unknown as LadderDraft) } : blankLadder())
  const [saving, setSaving] = useState(false)
  const [stepModal, setStepModal] = useState<Step | 'new' | null>(null)
  const [removing, setRemoving] = useState<Step | null>(null)

  const set = <K extends keyof LadderDraft>(k: K, v: LadderDraft[K]) => setDraft(d => ({ ...d, [k]: v }))
  const steps = ladder ? stepsOn(ladder.id, book.steps) : []
  const others = book.ladders.filter(l => l.id !== ladder?.id)
  const verdict = validateLadder(draft, others)
  const warnings = ladder ? warningsFor({ ...(ladder as Ladder), ...draft }, book.steps) : []
  const on = ladder ? casesOn(ladder.id, book.cases) : []

  /* A seller ladder cannot carry a suspension day at all, so switching the
     audience to seller takes it off rather than saving something the database
     will refuse. */
  const setAudience = (audience: Audience) => {
    setDraft(d => ({
      ...d, audience, tier: null,
      ...(audience === 'partner' ? { suspend_on_day: null, withhold_settlement: true } : {}),
    }))
  }

  const act = async (fn: () => Promise<{ ok: boolean; reason?: string; note?: string }>) => {
    const res = await fn()
    if (!res.ok) { toast(res.reason ?? 'That did not work', 'error'); return false }
    toast(res.note ?? 'Saved')
    await onDone()
    return true
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
        <Btn variant="secondary" size="sm" onClick={onCancel}><ArrowLeft size={13} style={{ marginRight: 5 }} />Back</Btn>
        <h2 style={{ fontSize: 'var(--text-xl)', fontWeight: 800 }}>{ladder ? ladder.name : 'New ladder'}</h2>
        {ladder?.system && <span style={pillStyle}><Lock size={10} style={{ verticalAlign: '-1px', marginRight: 3 }} />Built in</span>}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: '8px' }}>
          <Btn variant="secondary" size="sm" onClick={onCancel}>Cancel</Btn>
          <Btn size="sm" disabled={saving || !verdict.ok} onClick={async () => {
            setSaving(true)
            const res = await saveLadder({ id: ladder?.id ?? null, draft, actor: ACTOR, ladders: book.ladders })
            setSaving(false)
            if (!res.ok) { toast(res.reason, 'error'); return }
            toast(res.note ?? 'Saved')
            await onDone()
          }}>{saving ? 'Saving…' : ladder ? 'Save' : 'Create it'}</Btn>
        </div>
      </div>

      {!verdict.ok && <Callout tone="danger" title="This cannot be saved yet">{(verdict as { ok: false; reason: string }).reason}</Callout>}
      {verdict.ok && <Callout tone="success" title="What this ladder promises">{verdict.note}</Callout>}
      {warnings.map((w, i) => (
        <Callout key={i} tone={w.level === 'warn' ? 'warning' : 'info'}
          title={w.level === 'warn' ? 'Worth a second look' : 'Worth knowing'}>{w.text}</Callout>
      ))}
      {on.length > 0 && (
        <Callout tone="info" title={`${on.length} ${on.length === 1 ? 'account is' : 'accounts are'} on this ladder now`}>
          {on.map(c => c.account_name).join(', ')}. A change here applies to steps not yet taken; nothing
          already sent is unsent.
        </Callout>
      )}

      <SectionCard pad title="Who it applies to, and how long they get">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 16px' }}>
          <FormField label="Ladder name" required>
            <TextInput value={draft.name} onChange={e => set('name', e.target.value)} placeholder="Retail — Gold" />
          </FormField>
          <FormField label="Audience" hint="A seller is never suspended, so choosing Sellers takes the suspension day off.">
            <Select value={draft.audience} onChange={e => setAudience(e.target.value as Audience)}>
              {AUDIENCES.map(a => <option key={a} value={a}>{AUDIENCE_LABEL[a]}</option>)}
            </Select>
          </FormField>
          <FormField label="Tier" hint="No tier makes this the audience default. A tier overrides it, and may only be gentler.">
            <Select value={draft.tier ?? ''} onChange={e => set('tier', e.target.value || null)}>
              <option value="">The default for this audience</option>
              {TIERS[draft.audience].map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
            </Select>
          </FormField>
          <FormField label="Grace, in days" hint="Nothing is sent inside this. Days past the due date.">
            <TextInput type="number" min={0} value={draft.grace_days}
              onChange={e => set('grace_days', Math.max(0, Number(e.target.value) || 0))} />
          </FormField>
          <FormField label="Service stops on day"
            hint={draft.audience === 'partner'
              ? 'Not available for sellers — their listings stay up and the settlement is withheld.'
              : 'Leave blank for a ladder that never interrupts service.'}>
            <TextInput type="number" min={1} disabled={draft.audience === 'partner'}
              value={draft.suspend_on_day ?? ''}
              onChange={e => set('suspend_on_day', e.target.value === '' ? null : Number(e.target.value))} />
          </FormField>
          <FormField label="A promise to pay">
            <Select value={draft.pause_on_promise ? 'pause' : 'run'}
              onChange={e => set('pause_on_promise', e.target.value === 'pause')}>
              <option value="pause">Pauses the ladder where it stands</option>
              <option value="run">Does not pause it</option>
            </Select>
          </FormField>
        </div>
        <FormField label="Why this ladder exists" hint="Shown on the ladder list, so the next person can tell them apart.">
          <TextArea rows={2} value={draft.note} onChange={e => set('note', e.target.value)} />
        </FormField>
        {draft.audience === 'partner' && (
          <label style={{ display: 'flex', gap: '8px', alignItems: 'center', fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>
            <input type="checkbox" checked={draft.withhold_settlement}
              onChange={e => set('withhold_settlement', e.target.checked)} />
            Withhold settlement against the debt
          </label>
        )}
      </SectionCard>

      {ladder ? (
        <SectionCard title="The steps" subtitle={`${steps.length} · in the order they fire, by days past due`}
          action={<Btn size="sm" onClick={() => setStepModal('new')}><Plus size={13} style={{ marginRight: 5 }} />Add a step</Btn>}>
          {steps.length === 0 ? (
            <EmptyState message="No steps. An account resolved onto this ladder is an account nobody chases." />
          ) : (
            <Table headers={['#', 'Step', 'Day', 'Channel', 'What it does', '']}>
              {steps.map((s, i) => (
                <tr key={s.id} style={{ borderBottom: '1px solid var(--border-light)' }}>
                  <Td right>{s.step_no}</Td>
                  <Td>
                    <div style={{ fontWeight: 600 }}>{s.name}</div>
                    <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', maxWidth: '54ch' }}>{s.note}</div>
                  </Td>
                  <Td right>day {s.day}</Td>
                  <Td>{s.channel}</Td>
                  <Td>
                    <span style={{
                      ...pillStyle, marginLeft: 0,
                      background: s.action === 'suspend' ? 'var(--danger-bg)' : s.action === 'withhold' ? 'var(--warning-bg)' : 'var(--bg-alt)',
                      color: s.action === 'suspend' ? 'var(--danger)' : s.action === 'withhold' ? 'var(--warning)' : 'var(--text-secondary)',
                    }}>{s.action}</span>
                  </Td>
                  <Td right>
                    <div style={{ display: 'flex', gap: '5px', justifyContent: 'flex-end' }}>
                      <Btn size="sm" variant="secondary" disabled={i === 0}
                        onClick={() => void act(() => moveStep({ step: s, ladder, steps: book.steps, delta: -1, actor: ACTOR }))}>
                        <ArrowUp size={11} />
                      </Btn>
                      <Btn size="sm" variant="secondary" disabled={i === steps.length - 1}
                        onClick={() => void act(() => moveStep({ step: s, ladder, steps: book.steps, delta: 1, actor: ACTOR }))}>
                        <ArrowDown size={11} />
                      </Btn>
                      <Btn size="sm" variant="secondary" onClick={() => setStepModal(s)}><Pencil size={11} /></Btn>
                      <Btn size="sm" variant="danger" onClick={() => setRemoving(s)}><Trash2 size={11} /></Btn>
                    </div>
                  </Td>
                </tr>
              ))}
            </Table>
          )}
        </SectionCard>
      ) : (
        <Callout tone="info" title="Steps come after the ladder exists">
          Save this first. A step is checked against the ladder's grace and its suspension day, and neither
          of those exists yet.
        </Callout>
      )}

      {stepModal && ladder && (
        <StepModal
          ladder={ladder}
          step={stepModal === 'new' ? null : stepModal}
          nextNo={steps.length + 1}
          onClose={() => setStepModal(null)}
          onSaved={async () => { setStepModal(null); await onDone() }}
        />
      )}

      <ConfirmDialog
        open={!!removing}
        onClose={() => setRemoving(null)}
        title={removing ? `Remove ${removing.name}` : ''}
        message="The steps after it move up, so nobody being chased stalls on a gap in the sequence."
        confirmLabel="Remove it" danger
        onConfirm={async () => {
          if (!removing || !ladder) return
          await act(() => deleteStep({ step: removing, ladder, steps: book.steps, actor: ACTOR }))
          setRemoving(null)
        }}
      />
    </div>
  )
}

function StepModal(
  { ladder, step, nextNo, onClose, onSaved }: {
    ladder: Ladder; step: Step | null; nextNo: number
    onClose: () => void; onSaved: () => Promise<void>
  },
) {
  const [draft, setDraft] = useState<StepDraft>(() => step
    ? { name: step.name, day: step.day, channel: step.channel, action: step.action, note: step.note }
    : { name: '', day: Math.max(ladder.grace_days, 1), channel: 'email', action: 'remind', note: '' })
  const [saving, setSaving] = useState(false)

  const set = <K extends keyof StepDraft>(k: K, v: StepDraft[K]) => setDraft(d => ({ ...d, [k]: v }))
  const check = canAddStep(draft, ladder)

  return (
    <Modal open onClose={onClose} title={step ? `Edit ${step.name}` : `Add a step to ${ladder.name}`}
      footer={<>
        <Btn variant="secondary" size="sm" onClick={onClose}>Cancel</Btn>
        <Btn size="sm" disabled={saving || !check.ok} onClick={async () => {
          setSaving(true)
          const res = await saveStep({
            id: step?.id ?? null, ladder, draft, stepNo: step?.step_no ?? nextNo, actor: ACTOR,
          })
          setSaving(false)
          if (!res.ok) { toast(res.reason, 'error'); return }
          toast(res.note ?? 'Saved')
          await onSaved()
        }}>{saving ? 'Saving…' : 'Save'}</Btn>
      </>}>
      <FormField label="What it is called" required hint="Shown to the collector on the case list.">
        <TextInput value={draft.name} onChange={e => set('name', e.target.value)} placeholder="Second reminder" />
      </FormField>
      <div style={{ display: 'flex', gap: '12px' }}>
        <div style={{ flex: 1 }}>
          <FormField label="Days past due" required hint={`This ladder promises ${ladder.grace_days} days of grace.`}>
            <TextInput type="number" min={ladder.grace_days} value={draft.day}
              onChange={e => set('day', Number(e.target.value) || 0)} />
          </FormField>
        </div>
        <div style={{ flex: 1 }}>
          <FormField label="Channel">
            <Select value={draft.channel} onChange={e => set('channel', e.target.value as StepDraft['channel'])}>
              {CHANNELS.map(c => <option key={c} value={c}>{c}</option>)}
            </Select>
          </FormField>
        </div>
        <div style={{ flex: 1 }}>
          <FormField label="What it does">
            <Select value={draft.action} onChange={e => set('action', e.target.value as StepDraft['action'])}>
              {ACTIONS.map(a => <option key={a} value={a}>{a}</option>)}
            </Select>
          </FormField>
        </div>
      </div>
      <FormField label="Note" hint="What this step actually says or does. Read by whoever inherits this ladder.">
        <TextArea rows={2} value={draft.note} onChange={e => set('note', e.target.value)} />
      </FormField>
      {!check.ok && <Callout tone="danger" title="This step cannot go on this ladder">{check.reason}</Callout>}
    </Modal>
  )
}

const pillStyle: React.CSSProperties = {
  marginLeft: 8, padding: '1px 7px', borderRadius: 'var(--radius-full)',
  background: 'var(--bg-alt)', color: 'var(--text-tertiary)',
  fontSize: '10px', fontWeight: 700,
}
