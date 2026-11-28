import { useMemo, useState } from 'react'
import { Plus } from 'lucide-react'
import { Callout } from '../OnboardingJourney'
import { StatusBadge } from '../ui/StatusBadge'
import { Toggle } from '../ui/Toggle'
import {
  Btn, ConfirmDialog, EmptyState, FormField, Modal, RowActions, SectionCard, Table, TextArea, TextInput, Td, toast,
} from './shared'
import {
  addStep, removeStep, removeStepTemplate, saveStepTemplate, updateStep,
} from '../../lib/remindersRepo'
import type { RuleStep } from '../../lib/remindersRepo'
import {
  MAX_OFFSET, MIN_OFFSET, canSchedule, latestOffset, missingStepTemplates, offsetCode, stepLabel, validateStep,
} from '../../lib/reminders'
import {
  PLACEHOLDERS, SAMPLE, orderKinds, placeholdersIn, preview, remaining, validateTemplate,
} from '../../lib/notifications'
import type { Kind, KindId, NotificationEvent, Rule } from '../../lib/notifications'

/* The Schedule section of a rule on a dated event (spec 19): its steps, each an
   offset from the event's date, the channels it goes on, what it says on each,
   and a switch. Steps are written straight away (not with the rule's Save);
   the database's guards say no to what the screen should already have refused. */

const ACTOR = 'Marketplace comms desk'

export interface ScheduleState {
  steps: RuleStep[]
  /** The migration is not applied: the tables are not there. */
  missing: boolean
  error: string | null
}

export const NO_SCHEDULE: ScheduleState = { steps: [], missing: false, error: null }

export const MIGRATION_NOTICE = 'Scheduled reminders arrive with migration 20261127400000.'

/** Why a rule cannot be turned on yet: a step with nothing written for a channel it sends on. Null when it can. */
export function scheduleBlock(rule: Pick<Rule, 'id' | 'name'>, steps: readonly RuleStep[]): string | null {
  const bad = steps
    .filter(s => s.rule_id === rule.id)
    .map(s => ({ s, m: missingStepTemplates(s, s.templates) }))
    .filter(x => x.m.length > 0)
  if (bad.length === 0) return null
  const where = bad.map(x => `${stepLabel(x.s.offset_days)} on ${x.m.join(', ')}`).join('; ')
  return `${rule.name} has a schedule step with nothing written (${where}). Write it, or remove the step, before turning the rule on.`
}

export function ScheduleSection({ rule, event, kinds, steps, onChanged }: {
  rule: Rule
  event: NotificationEvent
  kinds: Kind[]
  /** This rule's steps. */
  steps: RuleStep[]
  onChanged: () => Promise<void>
}) {
  const [editing, setEditing] = useState<{ step: RuleStep | null } | null>(null)
  const [removing, setRemoving] = useState<RuleStep | null>(null)
  const [said, setSaid] = useState<string | null>(null)
  const can = canSchedule(event.id, rule.persona)

  const report = async (ok: boolean, text: string) => {
    toast(text, ok ? 'success' : 'error')
    if (ok) await onChanged()
  }

  const toggle = async (s: RuleStep, next: boolean) => {
    setSaid(null)
    if (next) {
      const m = missingStepTemplates(s, s.templates)
      if (m.length) {
        const text = `${stepLabel(s.offset_days)} cannot be turned on: nothing is written for ${m.join(', ')}. Edit the step and write it first.`
        setSaid(text)
        toast(text, 'error')
        return
      }
    }
    const r = await updateStep(s.id, { enabled: next })
    if (!r.ok) { setSaid(r.error); toast(r.error, 'error'); return }
    await report(true, `${stepLabel(s.offset_days)} is ${next ? 'on' : 'off'}`)
  }

  const duplicate = async (s: RuleStep) => {
    setSaid(null)
    const made = await addStep(rule.id, { offset_days: s.offset_days, kinds: s.kinds, enabled: false, sort_order: s.sort_order + 1 })
    if (!made.ok) { setSaid(made.error); toast(made.error, 'error'); return }
    for (const t of s.templates) {
      const r = await saveStepTemplate({ step_id: made.value.id, kind_id: t.kind_id, subject: t.subject, body: t.body, edited_by: ACTOR })
      if (!r.ok) { setSaid(r.error); toast(r.error, 'error'); return }
    }
    await report(true, `Copied ${stepLabel(s.offset_days)}. The copy is off until you turn it on.`)
  }

  const remove = async (s: RuleStep) => {
    setSaid(null)
    const r = await removeStep(s.id)
    if (!r.ok) { setSaid(r.error); toast(r.error, 'error'); return }
    await report(true, `${stepLabel(s.offset_days)} removed`)
  }

  return (
    <SectionCard title={`Schedule: ${rule.name}`}
      subtitle={`Sent relative to ${event.label.toLowerCase()}: ${event.anchor ?? 'its date'}. n is that day; n−7 is seven days before.`}
      action={<Btn size="sm" disabled={!can.ok} title={can.ok ? undefined : can.reason}
        onClick={() => { setSaid(null); setEditing({ step: null }) }}><Plus size={12} /> Add step</Btn>}>
      <div className="op-rules">
        {!can.ok && <Callout tone="warning" title="No schedule for this rule">{can.reason}.</Callout>}
        {said && <p role="alert" className="op-rules__refused">{said}</p>}
        {steps.length === 0 ? (
          <EmptyState message="No steps yet. Add one to send a reminder before or after the date." />
        ) : (
          <Table headers={['When', 'Channels', 'Wording', 'Sending', 'Actions']}>
            {steps.map(s => {
              const missing = missingStepTemplates(s, s.templates)
              const name = stepLabel(s.offset_days)
              return (
                <tr key={s.id}>
                  <Td>{name}<span className="op-rules__code">{offsetCode(s.offset_days)}</span></Td>
                  <Td>
                    <div className="op-rules__chips">
                      {orderKinds(s.kinds).map(k => (
                        <StatusBadge key={k} tone={missing.includes(k) ? 'danger' : 'info'}>{k}</StatusBadge>
                      ))}
                    </div>
                  </Td>
                  <Td>
                    {missing.length === 0
                      ? <span>{s.templates.length === 1 ? 'Written' : 'Written for each channel'}</span>
                      : <span className="op-rules__flag">Nothing written for {missing.join(', ')}</span>}
                  </Td>
                  <Td>
                    <Toggle checked={s.enabled} label={s.enabled ? 'On' : 'Off'} id={`step-on-${s.id}`}
                      onChange={next => { void toggle(s, next) }} />
                  </Td>
                  <Td>
                    <RowActions label={name} actions={[
                      { id: 'edit', label: 'Edit', variant: 'secondary', srOnly: name, onClick: () => { setSaid(null); setEditing({ step: s }) } },
                      { id: 'duplicate', label: 'Duplicate', srOnly: name, onClick: () => { void duplicate(s) } },
                      { id: 'remove', label: 'Remove', variant: 'danger', srOnly: name, onClick: () => setRemoving(s) },
                    ]} />
                  </Td>
                </tr>
              )
            })}
          </Table>
        )}
      </div>

      {editing && (
        <StepModal rule={rule} event={event} kinds={kinds} step={editing.step}
          onClose={() => setEditing(null)}
          onSaved={async note => { setEditing(null); await report(true, note) }} />
      )}
      <ConfirmDialog open={!!removing} onClose={() => setRemoving(null)} danger confirmLabel="Remove step"
        title="Remove this step?"
        message={removing
          ? `${stepLabel(removing.offset_days)} and what it says will be removed. What it already sent stays in the history.`
          : ''}
        onConfirm={() => { if (removing) void remove(removing) }} />
    </SectionCard>
  )
}

type Words = Record<string, { subject: string; body: string }>

function StepModal({ rule, event, kinds, step, onClose, onSaved }: {
  rule: Rule; event: NotificationEvent; kinds: Kind[]; step: RuleStep | null
  onClose: () => void; onSaved: (note: string) => Promise<void>
}) {
  const [offsetText, setOffsetText] = useState(step ? String(step.offset_days) : '-1')
  const [chosen, setChosen] = useState<KindId[]>(step ? step.kinds : orderKinds(rule.kinds).slice(0, 1))
  const [words, setWords] = useState<Words>(() =>
    Object.fromEntries((step?.templates ?? []).map(t => [t.kind_id, { subject: t.subject, body: t.body }])))
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  const last = latestOffset(event.id)
  const offset = offsetText.trim() === '' ? NaN : Number(offsetText)
  const check = validateStep({ offset_days: offset, kinds: chosen }, rule.kinds, event.id, rule.persona)
  const saved = useMemo(() => new Map((step?.templates ?? []).map(t => [t.kind_id as string, t])), [step])

  const say = (k: KindId) => words[k] ?? { subject: '', body: '' }
  const setWord = (k: KindId, patch: Partial<{ subject: string; body: string }>) => {
    setWords(w => ({ ...w, [k]: { ...say(k), ...patch } }))
    setProblem(null)
  }
  const flip = (k: KindId) => setChosen(c => (c.includes(k) ? c.filter(x => x !== k) : orderKinds([...c, k])))

  /* A channel with words must have words that fit it; one with none is flagged on the row. */
  const wordProblem = chosen
    .map(k => ({ k, w: say(k) }))
    .filter(x => x.w.subject.trim() !== '' || x.w.body.trim() !== '')
    .map(x => ({ k: x.k, c: validateTemplate({ ...x.w, kind_id: x.k }, kinds) }))
    .find(x => !x.c.ok)
  const blocked = !check.ok ? check.reason : wordProblem && !wordProblem.c.ok ? `${wordProblem.k}: ${wordProblem.c.reason}` : null

  const submit = async () => {
    setBusy(true)
    setProblem(null)
    const base = { offset_days: offset, kinds: chosen }
    const made = step ? await updateStep(step.id, base) : await addStep(rule.id, { ...base, enabled: false })
    if (!made.ok) { setBusy(false); setProblem(made.error); return }
    const id = made.value.id
    for (const k of chosen) {
      const w = say(k)
      if (w.subject.trim() === '' && w.body.trim() === '') continue
      const r = await saveStepTemplate({ step_id: id, kind_id: k, subject: w.subject, body: w.body, edited_by: ACTOR })
      if (!r.ok) { setBusy(false); setProblem(`${k}: ${r.error}`); return }
    }
    for (const [k, t] of saved) {
      if (!chosen.includes(k as KindId)) await removeStepTemplate(t.id)
    }
    setBusy(false)
    await onSaved(step ? `${stepLabel(offset)} saved` : `${stepLabel(offset)} added. It is off until you turn it on.`)
  }

  return (
    <Modal open onClose={onClose} title={step ? `Edit step: ${stepLabel(step.offset_days)}` : `New step on ${rule.name}`}
      footer={<>
        <Btn variant="secondary" size="sm" onClick={onClose}>Cancel</Btn>
        <Btn size="sm" onClick={() => { void submit() }} disabled={busy || !!blocked}>{busy ? 'Saving…' : 'Save step'}</Btn>
      </>}>
      <FormField label="Days from the date"
        hint={Number.isInteger(offset) && offset >= MIN_OFFSET && offset <= MAX_OFFSET
          ? `${stepLabel(offset)} (${offsetCode(offset)}). From ${MIN_OFFSET} (before) to ${last} (${last === 0 ? 'the day itself' : 'after'}).`
          : `From ${MIN_OFFSET} (before) to ${last} (${last === 0 ? 'the day itself' : 'after'}). Negative is before the date.`}>
        <TextInput type="number" min={MIN_OFFSET} max={last} value={offsetText}
          onChange={e => { setOffsetText(e.target.value); setProblem(null) }} />
      </FormField>

      <FormField label="Channels" hint="Only channels the rule itself uses.">
        <div className="op-rules__chipset">
          {orderKinds(rule.kinds).map(k => (
            <Btn key={k} variant={chosen.includes(k) ? 'primary' : 'secondary'} size="sm" aria-pressed={chosen.includes(k)}
              onClick={() => flip(k)}>{kinds.find(x => x.id === k)?.label ?? k}</Btn>
          ))}
        </div>
      </FormField>

      {chosen.map(k => {
        const kind = kinds.find(x => x.id === k)
        const w = say(k)
        const left = remaining(w.body, kind)
        const used = placeholdersIn(`${w.subject} ${w.body}`)
        const label = kind?.label ?? k
        return (
          <div key={k} className="op-rules__tpl" role="group" aria-label={`Wording on ${label}`}>
            <strong>{label}</strong>
            <FormField label={`${label} subject`} compact>
              <TextInput value={w.subject} onChange={e => setWord(k, { subject: e.target.value })} />
            </FormField>
            <FormField label={`${label} message`} compact
              hint={left === null ? 'No length limit on this channel' : `${left} characters left of ${kind?.max_chars}`}>
              <TextArea rows={3} value={w.body} onChange={e => setWord(k, { body: e.target.value })} />
            </FormField>
            <div className="op-rules__ph" aria-label={`Placeholders for ${label}`}>
              {PLACEHOLDERS.map(p => (
                <Btn key={p} variant={used.includes(p) ? 'secondary' : 'tertiary'} size="sm"
                  onClick={() => setWord(k, { body: `${w.body}{${p}}` })}>{`{${p}}`}</Btn>
              ))}
            </div>
            {(w.subject || w.body) && (
              <div className="op-rules__preview">
                <div className="op-rules__preview-subject">{preview(w.subject, SAMPLE)}</div>
                <div className="op-rules__preview-body">{preview(w.body, SAMPLE)}</div>
              </div>
            )}
          </div>
        )
      })}

      {blocked && <Callout tone="danger" title="Not saved yet">{blocked}</Callout>}
      {problem && <p role="alert" className="op-rules__refused">Not saved: {problem}</p>}
    </Modal>
  )
}
