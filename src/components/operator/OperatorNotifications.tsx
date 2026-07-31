import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  Bell, Plus, Pencil, Eye, TriangleAlert as AlertTriangle, Lock, Search,
} from 'lucide-react'
import {
  SectionCard, StatCard, Btn, Modal, FormField, TextInput, TextArea, Select,
  Table, Td, EmptyState, toast, fmtInt,
} from './shared'
import { Callout } from '../OnboardingJourney'
import { loadConfiguration, saveRule, setRuleEnabled, deleteRule, saveTemplate } from '../../lib/notificationRepo'
import type { NotificationBook } from '../../lib/notificationRepo'
import {
  KIND_ORDER, PERSONA_LABEL, STATE_LABEL, orderKinds, availableEvents, validateRule,
  ruleChangeImpact, missingTemplates, remaining, preview, SAMPLE, validateTemplate,
  filterLog, deliverySummary, byKind, notDelivered, silentRules, costByGateway,
  explain, money, when, effective, placeholdersIn, PLACEHOLDERS,
} from '../../lib/notifications'
import type {
  Rule, Template, Persona, KindId, Kind, LogState, Preference,
} from '../../lib/notifications'

/* Notifications, from the only console that configures them.
 *
 * The split this screen exists to keep visible: a RULE is the marketplace's
 * decision — this event, this audience, these channels, this often — and a
 * PREFERENCE is the recipient's, made inside whatever the rule allows. Sellers,
 * enterprise buyers and customers can read their rules and choose among the
 * channels on them. They cannot add a channel the rule does not carry, because
 * nothing is written for it, and they cannot silence a mandatory one, because
 * "we did tell you, you had turned it off" is not a defence anybody wants to
 * make about a failed payment.
 */

const ACTOR = 'Marketplace comms desk'

type Tab = 'rules' | 'wording' | 'channels' | 'recipients' | 'history'

const TABS: { id: Tab; label: string }[] = [
  { id: 'rules', label: 'Rules' },
  { id: 'wording', label: 'Wording' },
  { id: 'channels', label: 'Channels' },
  { id: 'recipients', label: 'Who chose what' },
  { id: 'history', label: 'History' },
]

export function OperatorNotifications() {
  const [book, setBook] = useState<NotificationBook | null>(null)
  const [tab, setTab] = useState<Tab>('rules')
  const [persona, setPersona] = useState<Persona>('consumer')
  const [editing, setEditing] = useState<{ rule: Rule; isNew: boolean } | null>(null)
  const [wording, setWording] = useState<Template | null>(null)

  const reload = useCallback(async () => setBook(await loadConfiguration()), [])
  useEffect(() => { void reload() }, [reload])

  if (!book) return <div style={{ textAlign: 'center', padding: '40px' }}><div className="spinner" style={{ margin: '0 auto' }} /></div>

  const gaps = missingTemplates(book.rules, book.templates)
  const summary = deliverySummary(book.log)
  const silent = silentRules(book.rules, book.log)

  const startNew = () => {
    const free = availableEvents(book.events, book.rules, persona)
    if (!free.length) {
      toast(`Every event that happens to ${PERSONA_LABEL[persona].toLowerCase()} already has a rule`, 'error')
      return
    }
    const n = book.rules.filter(r => r.persona === persona).length + 1
    setEditing({
      isNew: true,
      rule: {
        id: `NR-${persona[0].toUpperCase()}${n}-${Date.now().toString(36).slice(-3).toUpperCase()}`,
        persona, event_id: free[0].id, name: free[0].label, audience: 'Everyone',
        kinds: ['inapp'], throttle: 'Every time', severity: 'normal',
        enabled: true, mandatory: false, why: '', last_sent: null,
        sort_order: (Math.max(0, ...book.rules.filter(r => r.persona === persona).map(r => r.sort_order)) + 1),
      },
    })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '16px', flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontSize: 'var(--text-2xl)', fontWeight: 800, color: 'var(--text)' }}>Notifications</h1>
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)', marginTop: '4px' }}>
            What the platform says, to whom, on which channel — and what it actually said.
          </p>
        </div>
        {tab === 'rules' && <Btn onClick={startNew}><Plus size={14} /> New rule</Btn>}
      </div>

      {book.loadError && <Callout tone="danger" title="Some of this did not load">{book.loadError}</Callout>}

      <Callout tone="info" title="The marketplace decides what is sent; the recipient decides where">
        A rule here sets the event, the audience, the channels it can use and how often. Sellers, enterprise
        buyers and customers see their own rules and pick among those channels. They cannot add one the rule
        does not carry — there would be nothing written to send — and a mandatory rule can be moved but never
        switched off.
      </Callout>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px' }}>
        <StatCard label="Live rules" value={fmtInt(book.rules.filter(r => r.enabled).length)}
                  sublabel={`${fmtInt(book.rules.filter(r => r.mandatory).length)} cannot be switched off · ${fmtInt(book.rules.filter(r => !r.enabled).length)} paused`} />
        <StatCard label="Reached its recipient" value={summary.rate === null ? '—' : `${summary.rate}%`}
                  sublabel={`${fmtInt(summary.delivered)} of ${fmtInt(summary.attempted)} attempted · ${fmtInt(summary.suppressed)} deliberately not sent`}
                  color={summary.rate !== null && summary.rate < 95 ? 'var(--warning)' : 'var(--success)'} />
        <StatCard label="Spent on messages" value={money(summary.cost)}
                  sublabel="In-app and push cost nothing; SMS is the whole bill" />
        <StatCard label="Nothing written" value={fmtInt(gaps.length)}
                  sublabel={gaps.length ? 'Rules that would fire and say nothing' : 'Every rule can say something on every channel it uses'}
                  color={gaps.length ? 'var(--danger)' : 'var(--success)'} />
      </div>

      {gaps.length > 0 && (
        <Callout tone="danger" title={`${gaps.length} rule and channel pairs have no wording`}>
          {gaps.slice(0, 4).map(g => `${g.rule.name} on ${g.kind}`).join('; ')}
          {gaps.length > 4 ? ` and ${gaps.length - 4} more.` : '.'} Each one would fire and send an empty message.
        </Callout>
      )}

      <div style={{ display: 'flex', gap: '4px', borderBottom: '1px solid var(--border)', flexWrap: 'wrap' }}>
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{
            padding: '10px 16px', border: 'none', background: 'none', cursor: 'pointer',
            fontSize: 'var(--text-sm)', fontWeight: tab === t.id ? 700 : 500,
            color: tab === t.id ? 'var(--brand-accent-dark)' : 'var(--text-tertiary)',
            borderBottom: tab === t.id ? '2px solid var(--brand-accent-dark)' : '2px solid transparent',
          }}>{t.label}</button>
        ))}
      </div>

      {tab === 'rules' && (
        <RulesTab book={book} persona={persona} onPersona={setPersona}
                  onEdit={r => setEditing({ rule: { ...r }, isNew: false })}
                  onReload={reload} silent={silent} />
      )}
      {tab === 'wording' && <WordingTab book={book} onEdit={setWording} />}
      {tab === 'channels' && <ChannelsTab book={book} />}
      {tab === 'recipients' && <RecipientsTab book={book} />}
      {tab === 'history' && <HistoryTab book={book} />}

      {editing && (
        <RuleModal book={book} rule={editing.rule} isNew={editing.isNew}
                   onClose={() => setEditing(null)}
                   onSaved={async () => { setEditing(null); await reload() }} />
      )}
      {wording && (
        <WordingModal book={book} template={wording}
                      onClose={() => setWording(null)}
                      onSaved={async () => { setWording(null); await reload() }} />
      )}
    </div>
  )
}

/* ----------------------------------------------------------------- rules --- */

function RulesTab({ book, persona, onPersona, onEdit, onReload, silent }: {
  book: NotificationBook
  persona: Persona
  onPersona: (p: Persona) => void
  onEdit: (r: Rule) => void
  onReload: () => Promise<void>
  silent: Rule[]
}) {
  const rules = book.rules.filter(r => r.persona === persona).sort((a, b) => a.sort_order - b.sort_order)
  const events = new Map(book.events.map(e => [e.id, e]))

  const toggle = async (r: Rule) => {
    const res = await setRuleEnabled(r, !r.enabled)
    toast(res.ok ? res.note ?? 'Saved' : res.reason, res.ok ? 'success' : 'error')
    if (res.ok) await onReload()
  }

  const remove = async (r: Rule) => {
    const res = await deleteRule(r, book.preferences)
    toast(res.ok ? res.note ?? 'Deleted' : res.reason, res.ok ? 'success' : 'error')
    if (res.ok) await onReload()
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
        {(['operator', 'partner', 'enterprise', 'consumer'] as Persona[]).map(p => (
          <button key={p} onClick={() => onPersona(p)} style={{
            padding: '6px 14px', borderRadius: 'var(--radius-full)', cursor: 'pointer',
            border: `1px solid ${persona === p ? 'var(--brand-accent-dark)' : 'var(--border)'}`,
            background: persona === p ? 'var(--brand-accent-dark)' : 'var(--surface)',
            color: persona === p ? '#fff' : 'var(--text-secondary)',
            fontSize: 'var(--text-sm)', fontWeight: 600,
          }}>
            {PERSONA_LABEL[p]} · {book.rules.filter(r => r.persona === p).length}
          </button>
        ))}
      </div>

      <SectionCard title={`What ${PERSONA_LABEL[persona].toLowerCase()} are told`}
                   subtitle="Every line is something the platform will interrupt somebody for. The reason column is why that is justified.">
        {rules.length === 0 ? <EmptyState message="No rules for this persona yet" /> : (
          <Table headers={['Rule', 'Event', 'Audience', 'Channels', 'How often', 'Priority', 'Last sent', 'Status', 'Actions']}>
            {rules.map(r => {
              const gaps = r.kinds.filter(k => !book.templates.some(t => t.rule_id === r.id && t.kind_id === k))
              return (
                <tr key={r.id}>
                  <Td>
                    <div style={{ fontWeight: 600 }}>{r.name}</div>
                    <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', maxWidth: '340px', lineHeight: 1.4 }}>{r.why}</div>
                  </Td>
                  <Td right style={{ fontSize: 'var(--text-xs)' }}>{events.get(r.event_id)?.label ?? r.event_id}</Td>
                  <Td right style={{ fontSize: 'var(--text-xs)' }}>{r.audience}</Td>
                  <Td right>
                    <div style={{ display: 'flex', gap: '4px', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                      {orderKinds(r.kinds).map(k => (
                        <KindChip key={k} kind={k} bad={gaps.includes(k)} />
                      ))}
                    </div>
                  </Td>
                  <Td right style={{ fontSize: 'var(--text-xs)' }}>{r.throttle}</Td>
                  <Td right>
                    <span style={{
                      fontSize: 'var(--text-xs)', fontWeight: 600,
                      color: r.severity === 'high' ? 'var(--danger)' : r.severity === 'low' ? 'var(--text-tertiary)' : 'var(--text-secondary)',
                    }}>{r.severity}</span>
                  </Td>
                  <Td right style={{ fontSize: 'var(--text-xs)' }}>{r.last_sent ?? '—'}</Td>
                  <Td right>
                    {r.mandatory
                      ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--info)' }}><Lock size={11} /> always on</span>
                      : <span style={{ fontSize: 'var(--text-xs)', fontWeight: 600, color: r.enabled ? 'var(--success)' : 'var(--text-tertiary)' }}>{r.enabled ? 'on' : 'paused'}</span>}
                  </Td>
                  <Td right>
                    <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end' }}>
                      <Btn variant="secondary" size="sm" onClick={() => onEdit(r)}><Pencil size={12} /> Edit</Btn>
                      {!r.mandatory && (
                        <Btn variant="secondary" size="sm" onClick={() => toggle(r)}>{r.enabled ? 'Pause' : 'Resume'}</Btn>
                      )}
                      <Btn variant="danger" size="sm" onClick={() => remove(r)}>Delete</Btn>
                    </div>
                  </Td>
                </tr>
              )
            })}
          </Table>
        )}
      </SectionCard>

      {silent.length > 0 && (
        <SectionCard title="On, but has never sent anything"
                     subtitle="Either the event does not happen or the rule is aimed at the wrong thing. Both are worth knowing.">
          <div style={{ padding: '14px 20px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {silent.map(r => (
              <div key={r.id} style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>
                <strong>{r.name}</strong> · {PERSONA_LABEL[r.persona].toLowerCase()} · {orderKinds(r.kinds).join(', ')}
              </div>
            ))}
          </div>
        </SectionCard>
      )}
    </div>
  )
}

function KindChip({ kind, bad, muted }: { kind: KindId; bad?: boolean; muted?: boolean }) {
  return (
    <span title={bad ? 'Nothing is written for this channel' : undefined} style={{
      padding: '1px 8px', borderRadius: 'var(--radius-full)', fontSize: 'var(--text-xs)', fontWeight: 600,
      background: bad ? 'var(--danger-bg)' : muted ? 'var(--bg-alt)' : 'var(--info-bg)',
      color: bad ? 'var(--danger)' : muted ? 'var(--text-tertiary)' : 'var(--info)',
    }}>{kind}{bad ? ' !' : ''}</span>
  )
}

function RuleModal({ book, rule, isNew, onClose, onSaved }: {
  book: NotificationBook; rule: Rule; isNew: boolean; onClose: () => void; onSaved: () => Promise<void>
}) {
  const [form, setForm] = useState<Rule>(rule)
  const [busy, setBusy] = useState(false)

  const choices = isNew
    ? availableEvents(book.events, book.rules, form.persona)
    : book.events.filter(e => e.personas.includes(form.persona))
  const check = validateRule(form, book.events, book.gateways)
  const impact = isNew ? [] : ruleChangeImpact(rule, form, book.preferences)
  const ev = book.events.find(e => e.id === form.event_id)

  const toggleKindOn = (k: KindId) => {
    setForm(f => ({
      ...f,
      kinds: f.kinds.includes(k) ? f.kinds.filter(x => x !== k) : orderKinds([...f.kinds, k]),
    }))
  }

  const submit = async () => {
    setBusy(true)
    const res = await saveRule({ rule: form, book, isNew })
    setBusy(false)
    toast(res.ok ? res.note ?? 'Saved' : res.reason, res.ok ? 'success' : 'error')
    if (res.ok) await onSaved()
  }

  return (
    <Modal open onClose={onClose} title={isNew ? 'New notification rule' : form.name}
      footer={<>
        <Btn variant="secondary" size="sm" onClick={onClose}>Cancel</Btn>
        <Btn size="sm" onClick={submit} disabled={busy || !check.ok}>{busy ? 'Saving…' : 'Save'}</Btn>
      </>}>
      <div style={{ display: 'flex', gap: '12px' }}>
        <div style={{ flex: 1 }}>
          <FormField label="Who hears it" required>
            <Select value={form.persona} disabled={!isNew}
                    onChange={e => setForm({ ...form, persona: e.target.value as Persona, event_id: '' })}>
              {(['operator', 'partner', 'enterprise', 'consumer'] as Persona[]).map(p => (
                <option key={p} value={p}>{PERSONA_LABEL[p]}</option>
              ))}
            </Select>
          </FormField>
        </div>
        <div style={{ flex: 1.4 }}>
          <FormField label="On what happening" required
                     hint={ev?.description}>
            <Select value={form.event_id} onChange={e => setForm({ ...form, event_id: e.target.value })}>
              <option value="">Pick an event…</option>
              {choices.map(e => <option key={e.id} value={e.id}>{e.category} — {e.label}</option>)}
            </Select>
          </FormField>
        </div>
      </div>

      <FormField label="Rule name" required hint="This is the line the recipient sees on their own preference screen">
        <TextInput value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
      </FormField>

      <FormField label="Audience" hint="Who at the recipient's organisation. “Everyone” is a decision, not a default.">
        <TextInput value={form.audience} onChange={e => setForm({ ...form, audience: e.target.value })} />
      </FormField>

      <FormField label="Channels it may use" required
                 hint="The recipient chooses among these and can never add to them, because nothing is written for the rest.">
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          {book.kinds.map(k => {
            const on = form.kinds.includes(k.id)
            const dead = k.id !== 'inapp' && !book.gateways.some(g => g.kind === k.id && g.enabled)
            return (
              <button key={k.id} type="button" onClick={() => toggleKindOn(k.id)} title={dead ? 'No gateway is enabled behind this channel' : k.note}
                      style={{
                        padding: '6px 12px', borderRadius: 'var(--radius-full)', cursor: 'pointer',
                        border: `1px solid ${on ? 'var(--brand-accent-dark)' : 'var(--border)'}`,
                        background: on ? 'var(--brand-accent-dark)' : 'var(--surface)',
                        color: on ? '#fff' : dead ? 'var(--text-tertiary)' : 'var(--text-secondary)',
                        fontSize: 'var(--text-sm)', fontWeight: 600,
                      }}>
                {k.label}{dead ? ' — no gateway' : ''}
              </button>
            )
          })}
        </div>
      </FormField>

      <div style={{ display: 'flex', gap: '12px' }}>
        <div style={{ flex: 1 }}>
          <FormField label="How often">
            <Select value={form.throttle} onChange={e => setForm({ ...form, throttle: e.target.value })}>
              {['Every time', 'At most once an hour', 'At most once a day', 'Digest — once a day', 'Digest — weekly']
                .map(t => <option key={t} value={t}>{t}</option>)}
            </Select>
          </FormField>
        </div>
        <div style={{ flex: 1 }}>
          <FormField label="Priority">
            <Select value={form.severity} onChange={e => setForm({ ...form, severity: e.target.value as Rule['severity'] })}>
              <option value="high">High — worth interrupting somebody</option>
              <option value="normal">Normal</option>
              <option value="low">Low — a digest at most</option>
            </Select>
          </FormField>
        </div>
      </div>

      <FormField label="Why this is worth sending" required
                 hint="The next person to read this list has to be able to tell whether it still earns its place.">
        <TextArea rows={2} value={form.why} onChange={e => setForm({ ...form, why: e.target.value })} />
      </FormField>

      <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: 'var(--text-sm)', cursor: 'pointer' }}>
          <input type="checkbox" checked={form.enabled}
                 onChange={e => setForm({ ...form, enabled: e.target.checked })} /> On
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: 'var(--text-sm)', cursor: 'pointer' }}>
          <input type="checkbox" checked={form.mandatory}
                 onChange={e => setForm({ ...form, mandatory: e.target.checked, enabled: e.target.checked ? true : form.enabled })} />
          Cannot be switched off by the recipient
        </label>
      </div>

      {form.mandatory && (
        <Callout tone="warning" title="A mandatory rule takes a choice away">
          The recipient can still move it between the channels above. Reserve this for the things where silence
          is itself the harm — a failed payment, a delivery that is not coming, a price rise.
        </Callout>
      )}

      {impact.length > 0 && (
        <Callout tone="warning" title="What this change does to people already on it">
          <ul style={{ margin: '4px 0 0 16px' }}>{impact.map((s, i) => <li key={i}>{s}</li>)}</ul>
        </Callout>
      )}

      {!check.ok && <Callout tone="danger" title="Not saved yet">{check.reason}</Callout>}
    </Modal>
  )
}

/* ------------------------------------------------------------- templates -- */

function WordingTab({ book, onEdit }: { book: NotificationBook; onEdit: (t: Template) => void }) {
  const [persona, setPersona] = useState<Persona | 'all'>('all')
  const rules = new Map(book.rules.map(r => [r.id, r]))
  const kinds = new Map(book.kinds.map(k => [k.id, k]))

  const rows = book.templates
    .map(t => ({ t, r: rules.get(t.rule_id) }))
    .filter((x): x is { t: Template; r: Rule } => !!x.r)
    .filter(x => persona === 'all' || x.r.persona === persona)
    .sort((a, b) => a.r.sort_order - b.r.sort_order || KIND_ORDER.indexOf(a.t.kind_id) - KIND_ORDER.indexOf(b.t.kind_id))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <Callout tone="info" title="Written once per channel, on purpose">
        An SMS that reads like an email is a wasted segment; an email that reads like an SMS tells nobody what
        to do next. Every rule and channel pair has its own wording, and a body longer than the channel carries
        is refused rather than truncated on somebody's handset.
      </Callout>

      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
        {(['all', 'operator', 'partner', 'enterprise', 'consumer'] as const).map(p => (
          <button key={p} onClick={() => setPersona(p)} style={{
            padding: '6px 14px', borderRadius: 'var(--radius-full)', cursor: 'pointer',
            border: `1px solid ${persona === p ? 'var(--brand-accent-dark)' : 'var(--border)'}`,
            background: persona === p ? 'var(--brand-accent-dark)' : 'var(--surface)',
            color: persona === p ? '#fff' : 'var(--text-secondary)',
            fontSize: 'var(--text-sm)', fontWeight: 600,
          }}>{p === 'all' ? 'Everything' : PERSONA_LABEL[p]}</button>
        ))}
      </div>

      <SectionCard title={`${rows.length} messages`} subtitle="What actually arrives, per rule per channel.">
        <Table headers={['Rule', 'Who', 'Channel', 'Subject', 'Length', 'Last edited', '']}>
          {rows.map(({ t, r }) => {
            const k = kinds.get(t.kind_id)
            const over = k?.max_chars != null && t.body.length > k.max_chars
            return (
              <tr key={t.id}>
                <Td>{r.name}</Td>
                <Td right style={{ fontSize: 'var(--text-xs)' }}>{PERSONA_LABEL[r.persona]}</Td>
                <Td right><KindChip kind={t.kind_id} /></Td>
                <Td right style={{ fontSize: 'var(--text-xs)', maxWidth: '260px' }}>{t.subject}</Td>
                <Td right style={{ color: over ? 'var(--danger)' : undefined, fontWeight: over ? 700 : undefined }}>
                  {t.body.length}{k?.max_chars != null ? ` / ${k.max_chars}` : ''}
                </Td>
                <Td right style={{ fontSize: 'var(--text-xs)' }}>
                  {t.edited_on ? `${t.edited_on}${t.edited_by ? ` · ${t.edited_by}` : ''}` : 'never — generated'}
                </Td>
                <Td right><Btn variant="secondary" size="sm" onClick={() => onEdit(t)}><Pencil size={12} /> Edit</Btn></Td>
              </tr>
            )
          })}
        </Table>
      </SectionCard>
    </div>
  )
}

function WordingModal({ book, template, onClose, onSaved }: {
  book: NotificationBook; template: Template; onClose: () => void; onSaved: () => Promise<void>
}) {
  const [form, setForm] = useState<Template>(template)
  const [busy, setBusy] = useState(false)
  const [showPreview, setShowPreview] = useState(true)

  const kind = book.kinds.find(k => k.id === form.kind_id)
  const rule = book.rules.find(r => r.id === form.rule_id)
  const left = remaining(form.body, kind)
  const check = validateTemplate(form, book.kinds)
  const used = placeholdersIn(form.subject + ' ' + form.body)

  const submit = async () => {
    setBusy(true)
    const res = await saveTemplate({ template: form, kinds: book.kinds, by: ACTOR })
    setBusy(false)
    toast(res.ok ? res.note ?? 'Saved' : res.reason, res.ok ? 'success' : 'error')
    if (res.ok) await onSaved()
  }

  return (
    <Modal open onClose={onClose} title={`${rule?.name ?? form.rule_id} — ${kind?.label ?? form.kind_id}`}
      footer={<>
        <Btn variant="secondary" size="sm" onClick={() => setShowPreview(p => !p)}><Eye size={12} /> {showPreview ? 'Hide' : 'Show'} preview</Btn>
        <Btn variant="secondary" size="sm" onClick={onClose}>Cancel</Btn>
        <Btn size="sm" onClick={submit} disabled={busy || !check.ok}>{busy ? 'Saving…' : 'Save'}</Btn>
      </>}>
      {kind && <Callout tone="info">{kind.note}</Callout>}

      <FormField label="Subject" required>
        <TextInput value={form.subject} onChange={e => setForm({ ...form, subject: e.target.value })} />
      </FormField>

      <FormField label="Body" required
                 hint={left === null ? 'No length limit on this channel' : `${left} characters left of ${kind?.max_chars}`}>
        <TextArea rows={kind?.max_chars === null ? 9 : 4} value={form.body}
                  onChange={e => setForm({ ...form, body: e.target.value })}
                  style={left !== null && left < 0 ? { borderColor: 'var(--danger)' } : undefined} />
      </FormField>

      <FormField label="Placeholders" hint="Click to insert. Anything else is sent as written.">
        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
          {PLACEHOLDERS.map(p => (
            <button key={p} type="button" onClick={() => setForm(f => ({ ...f, body: `${f.body}{${p}}` }))}
                    style={{
                      padding: '2px 8px', borderRadius: 'var(--radius-full)', cursor: 'pointer',
                      border: '1px solid var(--border)',
                      background: used.includes(p) ? 'var(--info-bg)' : 'var(--surface)',
                      color: used.includes(p) ? 'var(--info)' : 'var(--text-tertiary)',
                      fontSize: 'var(--text-xs)', fontWeight: 600,
                    }}>{`{${p}}`}</button>
          ))}
        </div>
      </FormField>

      {showPreview && (
        <div style={{
          padding: '12px 14px', borderRadius: 'var(--radius-md)', background: 'var(--bg-alt)',
          border: '1px solid var(--border)',
        }}>
          <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', fontWeight: 700, marginBottom: '6px' }}>
            AS IT ARRIVES
          </div>
          <div style={{ fontSize: 'var(--text-sm)', fontWeight: 700, color: 'var(--text)' }}>
            {preview(form.subject, SAMPLE)}
          </div>
          <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', whiteSpace: 'pre-wrap', marginTop: '6px', lineHeight: 1.5 }}>
            {preview(form.body, SAMPLE)}
          </div>
        </div>
      )}

      {!check.ok && <Callout tone="danger" title="Not saved yet">{check.reason}</Callout>}
    </Modal>
  )
}

/* -------------------------------------------------------------- channels -- */

function ChannelsTab({ book }: { book: NotificationBook }) {
  const perKind = byKind(book.log, book.kinds)
  const gatewayCost = costByGateway(book.log, book.gateways)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <Callout tone="info" title="A channel is what the recipient experiences; a gateway is what carries it">
        Every channel below except in-app needs at least one enabled gateway behind it, or a rule using it sends
        into nothing. Gateways themselves — throughput, sender identity, cost per message — are configured on the
        Channels screen.
      </Callout>

      <SectionCard title="Channels" subtitle="What each one is for, what it costs, and what is behind it.">
        <Table headers={['Channel', 'Limit', 'Needs', 'Gateways behind it', 'Rules using it', 'Sent', 'Failed', 'Not sent', 'Cost']}>
          {book.kinds.map(k => {
            const gws = book.gateways.filter(g => g.kind === k.id)
            const live = gws.filter(g => g.enabled)
            const rules = book.rules.filter(r => r.enabled && r.kinds.includes(k.id))
            const stats = perKind.find(p => p.kind === k.id)
            const dead = k.id !== 'inapp' && live.length === 0 && rules.length > 0
            return (
              <tr key={k.id}>
                <Td>
                  <div style={{ fontWeight: 600 }}>{k.label}</div>
                  <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', maxWidth: '320px', lineHeight: 1.4 }}>{k.note}</div>
                </Td>
                <Td right>{k.max_chars === null ? 'none' : `${k.max_chars} chars`}</Td>
                <Td right style={{ fontSize: 'var(--text-xs)' }}>{k.needs === 'none' ? '—' : `a verified ${k.needs}`}</Td>
                <Td right style={{ fontSize: 'var(--text-xs)', color: dead ? 'var(--danger)' : undefined, fontWeight: dead ? 700 : undefined }}>
                  {k.id === 'inapp' ? 'none needed' : gws.length === 0 ? 'nothing mapped' : `${live.length} of ${gws.length} on — ${live.map(g => g.name).join(', ') || 'all disabled'}`}
                </Td>
                <Td right>{rules.length}</Td>
                <Td right>{stats ? fmtInt(stats.sent) : 0}</Td>
                <Td right style={{ color: stats && stats.failed ? 'var(--danger)' : undefined }}>{stats ? fmtInt(stats.failed) : 0}</Td>
                <Td right>{stats ? fmtInt(stats.suppressed) : 0}</Td>
                <Td right>{money(stats?.cost ?? 0)}</Td>
              </tr>
            )
          })}
        </Table>
      </SectionCard>

      <SectionCard title="What each gateway has carried" subtitle="Push and in-app are free, which is exactly why the rest deserve a number.">
        {gatewayCost.length === 0 ? <EmptyState message="Nothing has been sent through a gateway yet" /> : (
          <Table headers={['Gateway', 'Carries', 'Messages', 'Cost']}>
            {gatewayCost.map(g => (
              <tr key={g.id}>
                <Td>{g.name}</Td>
                <Td right>{g.kind ? <KindChip kind={g.kind} /> : <span style={{ color: 'var(--warning)' }}>not mapped</span>}</Td>
                <Td right>{fmtInt(g.messages)}</Td>
                <Td right>{money(g.cost)}</Td>
              </tr>
            ))}
          </Table>
        )}
      </SectionCard>
    </div>
  )
}

/* ------------------------------------------------------------ recipients -- */

function RecipientsTab({ book }: { book: NotificationBook }) {
  const rules = new Map(book.rules.map(r => [r.id, r]))

  /* Grouped by whoever the preference belongs to, because "what has this account
     turned off" is the question support actually asks. */
  const groups = useMemo(() => {
    const m = new Map<string, { key: string; label: string; scope: string; prefs: Preference[] }>()
    for (const p of book.preferences) {
      const key = p.partner_id ?? p.user_id ?? 'unknown'
      const g = m.get(key) ?? {
        key,
        label: p.partner_id ?? `${(p.user_id ?? '').slice(0, 8)}…`,
        scope: p.scope === 'partner' ? 'whole seller account' : 'one person',
        prefs: [],
      }
      g.prefs.push(p)
      m.set(key, g)
    }
    return [...m.values()]
  }, [book.preferences])

  const off = book.preferences.filter(p => !p.enabled)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <Callout tone="info" title="This is read-only for a reason">
        The marketplace can see what somebody chose — support cannot answer “why did I not get it” otherwise —
        but changing it from here would be making a choice on their behalf. A mandatory rule is refused by the
        database whoever asks, including this console.
      </Callout>

      {off.length > 0 && (
        <SectionCard title={`${off.length} things somebody has switched off`}
                     subtitle="The first answer to “I was never told”.">
          <Table headers={['Recipient', 'Rule', 'Who they are', 'Changed']}>
            {off.map(p => {
              const r = rules.get(p.rule_id)
              return (
                <tr key={p.id}>
                  <Td>{p.partner_id ?? `${(p.user_id ?? '').slice(0, 8)}…`}</Td>
                  <Td right>{r?.name ?? p.rule_id}</Td>
                  <Td right style={{ fontSize: 'var(--text-xs)' }}>{r ? PERSONA_LABEL[r.persona] : '—'}</Td>
                  <Td right style={{ fontSize: 'var(--text-xs)' }}>{p.updated_on ?? '—'}</Td>
                </tr>
              )
            })}
          </Table>
        </SectionCard>
      )}

      {groups.map(g => (
        <SectionCard key={g.key} title={g.label}
                     subtitle={`${g.prefs.length} choices · ${g.scope}`}>
          <Table headers={['Rule', 'On', 'Channels', 'The rule allows', 'Changed']}>
            {g.prefs
              .map(p => ({ p, r: rules.get(p.rule_id) }))
              .sort((a, b) => (a.r?.sort_order ?? 0) - (b.r?.sort_order ?? 0))
              .map(({ p, r }) => {
                const e = r ? effective(r, p) : null
                return (
                  <tr key={p.id}>
                    <Td>
                      {r?.name ?? p.rule_id}
                      {r?.mandatory && <span style={{ marginLeft: '6px', fontSize: 'var(--text-xs)', color: 'var(--info)' }}>always on</span>}
                    </Td>
                    <Td right>
                      <span style={{ fontWeight: 600, color: p.enabled ? 'var(--success)' : 'var(--text-tertiary)' }}>
                        {p.enabled ? 'yes' : 'no'}
                      </span>
                    </Td>
                    <Td right>
                      <div style={{ display: 'flex', gap: '4px', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                        {orderKinds(p.kinds).map(k => <KindChip key={k} kind={k} />)}
                        {p.kinds.length === 0 && <span style={{ color: 'var(--text-tertiary)' }}>—</span>}
                      </div>
                    </Td>
                    <Td right>
                      <div style={{ display: 'flex', gap: '4px', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                        {r ? orderKinds(r.kinds).map(k => <KindChip key={k} kind={k} muted />) : null}
                      </div>
                    </Td>
                    <Td right style={{ fontSize: 'var(--text-xs)' }}>
                      {e?.customised ? (p.updated_on ?? 'yes') : 'as set'}
                    </Td>
                  </tr>
                )
              })}
          </Table>
        </SectionCard>
      ))}

      {groups.length === 0 && <EmptyState message="Nobody has changed anything yet — everybody is on the defaults above" />}
    </div>
  )
}

/* ----------------------------------------------------------------- history -- */

function HistoryTab({ book }: { book: NotificationBook }) {
  const [persona, setPersona] = useState<Persona | 'all'>('all')
  const [kind, setKind] = useState<KindId | 'all'>('all')
  const [state, setState] = useState<LogState | 'all'>('all')
  const [search, setSearch] = useState('')
  const [open, setOpen] = useState<string | null>(null)

  const rows = filterLog(book.log, { persona, kind, state, search })
  const problems = notDelivered(book.log)
  const rules = new Map(book.rules.map(r => [r.id, r]))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {problems.length > 0 && (
        <Callout tone="warning" title={`${problems.length} messages did not reach anybody`}>
          Each carries the reason, and most are not faults — a customer who turned SMS off and a contact number
          that was never verified are the platform working, not failing. The ones marked failed are the ones to look at.
        </Callout>
      )}

      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div style={{ position: 'relative', flex: '1 1 220px' }}>
          <Search size={14} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-tertiary)' }} />
          <TextInput value={search} onChange={e => setSearch(e.target.value)}
                     placeholder="Subject, recipient or reference" style={{ paddingLeft: '30px' }} />
        </div>
        <Select value={persona} onChange={e => setPersona(e.target.value as Persona | 'all')} style={{ width: 'auto' }}>
          <option value="all">Everybody</option>
          {(['operator', 'partner', 'enterprise', 'consumer'] as Persona[]).map(p => (
            <option key={p} value={p}>{PERSONA_LABEL[p]}</option>
          ))}
        </Select>
        <Select value={kind} onChange={e => setKind(e.target.value as KindId | 'all')} style={{ width: 'auto' }}>
          <option value="all">Every channel</option>
          {book.kinds.map(k => <option key={k.id} value={k.id}>{k.label}</option>)}
        </Select>
        <Select value={state} onChange={e => setState(e.target.value as LogState | 'all')} style={{ width: 'auto' }}>
          <option value="all">Any outcome</option>
          {(Object.keys(STATE_LABEL) as LogState[]).map(s => (
            <option key={s} value={s}>{STATE_LABEL[s]}</option>
          ))}
        </Select>
      </div>

      <SectionCard title={`${rows.length} of ${book.log.length} messages`}
                   subtitle="Nobody edits what was sent. Click a row to read what actually went out.">
        {rows.length === 0 ? <EmptyState message="Nothing matches those filters" /> : (
          <Table headers={['When', 'Who', 'Recipient', 'Channel', 'Subject', 'Rule', 'Outcome', 'Cost']}>
            {rows.map(e => (
              <>
                <tr key={e.id} onClick={() => setOpen(open === e.id ? null : e.id)} style={{ cursor: 'pointer' }}>
                  <Td style={{ fontSize: 'var(--text-xs)', whiteSpace: 'nowrap' }}>{when(e.sent_at)}</Td>
                  <Td right style={{ fontSize: 'var(--text-xs)' }}>{PERSONA_LABEL[e.persona]}</Td>
                  <Td right style={{ fontSize: 'var(--text-xs)' }}>{e.recipient}</Td>
                  <Td right><KindChip kind={e.kind_id} /></Td>
                  <Td right style={{ maxWidth: '260px' }}>{e.subject}</Td>
                  <Td right style={{ fontSize: 'var(--text-xs)' }}>{rules.get(e.rule_id ?? '')?.name ?? '—'}</Td>
                  <Td right><OutcomePill state={e.state} /></Td>
                  <Td right style={{ fontSize: 'var(--text-xs)' }}>{e.cost > 0 ? money(e.cost) : '—'}</Td>
                </tr>
                {open === e.id && (
                  <tr key={`${e.id}-body`}>
                    <td colSpan={8} style={{ padding: '12px 16px', background: 'var(--bg-alt)', borderBottom: '1px solid var(--border)' }}>
                      <div style={{ fontSize: 'var(--text-sm)', fontWeight: 700, color: 'var(--text)' }}>{e.subject}</div>
                      <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', whiteSpace: 'pre-wrap', marginTop: '4px', lineHeight: 1.5 }}>{e.body}</div>
                      <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', marginTop: '8px' }}>
                        {e.ref ? `${e.ref} · ` : ''}{explain(e)}
                      </div>
                    </td>
                  </tr>
                )}
              </>
            ))}
          </Table>
        )}
      </SectionCard>
    </div>
  )
}

function OutcomePill({ state }: { state: LogState }) {
  const map: Record<LogState, { bg: string; color: string }> = {
    delivered: { bg: 'var(--success-bg)', color: 'var(--success)' },
    sent: { bg: 'var(--info-bg)', color: 'var(--info)' },
    queued: { bg: 'var(--bg-alt)', color: 'var(--text-tertiary)' },
    failed: { bg: 'var(--danger-bg)', color: 'var(--danger)' },
    suppressed: { bg: 'var(--warning-bg)', color: 'var(--warning)' },
  }
  const s = map[state]
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: '4px',
      padding: '2px 10px', borderRadius: 'var(--radius-full)',
      fontSize: 'var(--text-xs)', fontWeight: 600, background: s.bg, color: s.color,
    }}>
      {state === 'failed' && <AlertTriangle size={10} />}
      {STATE_LABEL[state]}
    </span>
  )
}

export { Bell }
