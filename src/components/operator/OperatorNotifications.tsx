import { useState, useEffect, useCallback, useMemo } from 'react'
import { Pager, usePaging } from '../Pager'
import {
  Bell, Plus, Pencil, Eye, TriangleAlert as AlertTriangle, Lock, Search,
} from 'lucide-react'
import {
  SectionCard, StatCard, Btn, Modal, FormField, TextInput, TextArea, Select,
  Table, Td, EmptyState, toast, fmtInt, StatusPill,
} from './shared'
import { Callout } from '../OnboardingJourney'
import {
  loadConfiguration, saveRule, setRuleEnabled, deleteRule, saveTemplate,
  saveIntegration, setGatewaySecret, testGateway, saveRate,
} from '../../lib/notificationRepo'
import type { NotificationBook } from '../../lib/notificationRepo'
import {
  KIND_ORDER, PERSONA_LABEL, STATE_LABEL, orderKinds, availableEvents, validateRule,
  ruleChangeImpact, missingTemplates, remaining, preview, SAMPLE, validateTemplate,
  filterLog, deliverySummary, byKind, notDelivered, silentRules, costByGateway,
  explain, money, when, effective, placeholdersIn, PLACEHOLDERS,
  ownerKey, nameRecipient, recipientLine, scopeLine,
  spendLine, configGaps, liveButBroken, failoverChain, quote,
} from '../../lib/notifications'
import type {
  Rule, Template, Persona, KindId, Kind, LogState, Preference, NamedRecipient,
  Gateway, Integration, Rate,
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

      <div className="stat-row">
        <StatCard label="Live rules" value={fmtInt(book.rules.filter(r => r.enabled).length)}
                  sublabel={`${fmtInt(book.rules.filter(r => r.mandatory).length)} cannot be switched off · ${fmtInt(book.rules.filter(r => !r.enabled).length)} paused`} />
        <StatCard label="Reached its recipient" value={summary.rate === null ? '—' : `${summary.rate}%`}
                  sublabel={`${fmtInt(summary.delivered)} of ${fmtInt(summary.attempted)} attempted · ${fmtInt(summary.suppressed)} deliberately not sent`}
                  color={summary.rate !== null && summary.rate < 95 ? 'var(--warning)' : 'var(--success)'} />
        {/* Per currency, never one number. Route Mobile bills Kenya in
            shillings and India in rupees; adding those together produces a
            figure that is not money anywhere. */}
        <StatCard label="Spent on messages"
                  value={summary.spend.length === 0 ? '—'
                    : summary.spend.length === 1 ? money(summary.spend[0].amount, summary.spend[0].currency)
                    : `${summary.spend.length} currencies`}
                  sublabel={summary.spend.length > 1
                    ? spendLine(summary.spend, money)
                    : 'In-app costs nothing to carry; SMS is the whole bill'} />
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
      {tab === 'channels' && <ChannelsTab book={book} onReload={reload} />}
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
  /* Reset to page 1 when the persona changes — the list is a different list. */
  const rulesPage = usePaging(rules, { resetKey: persona })
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
          <><Table headers={['Rule', 'Event', 'Audience', 'Channels', 'How often', 'Priority', 'Last sent', 'Status', 'Actions']}>
            {rulesPage.rows.map(r => {
              const gaps = r.kinds.filter(k => !book.templates.some(t => t.rule_id === r.id && t.kind_id === k))
              return (
                <tr key={r.id}>
                  <Td>
                    <div style={{ fontWeight: 600 }}>{r.name}</div>
                    <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', maxWidth: '230px', lineHeight: 1.4 }}>{r.why}</div>
                  </Td>
                  {/* Capped: the event name is a phrase and was taking 201px of a
                      nine-column table, which is what pushed Actions past the
                      edge. It wraps rather than widening. */}
                  <Td right style={{ fontSize: 'var(--text-xs)', maxWidth: '130px' }}>{events.get(r.event_id)?.label ?? r.event_id}</Td>
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
          <div style={{ padding: '0 18px 12px' }}><Pager page={rulesPage} noun="rules" /></div></>
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
  const wordingPage = usePaging(rows, { resetKey: persona })

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
        <><Table headers={['Rule', 'Who', 'Channel', 'Subject', 'Length', 'Last edited', '']}>
          {wordingPage.rows.map(({ t, r }) => {
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
        <div style={{ padding: '0 18px 12px' }}><Pager page={wordingPage} noun="templates" /></div></>
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

function ChannelsTab({ book, onReload }: { book: NotificationBook; onReload: () => Promise<void> }) {
  const perKind = byKind(book.log, book.kinds)
  const gatewayUse = costByGateway(book.log, book.gateways)
  const broken = liveButBroken(book.gateways, book.integrations, book.rates)
  const [wiring, setWiring] = useState<Gateway | null>(null)
  const [pricing, setPricing] = useState<Gateway | null>(null)
  const [testing, setTesting] = useState<string | null>(null)

  const integrationOf = (id: string) => book.integrations.find(i => i.channel_id === id) ?? null
  const ratesOf = (id: string) => book.rates.filter(r => r.channel_id === id && !r.effective_to)
  const nameOf = (id: string) => book.gateways.find(g => g.id === id)?.name ?? id

  const runTest = async (id: string) => {
    setTesting(id)
    const r = await testGateway(id, ACTOR)
    setTesting(null)
    toast(r.ok ? r.note ?? 'Connected' : r.reason, r.ok ? 'success' : 'error')
    await onReload()
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <Callout tone="info" title="A channel is what the recipient experiences; a gateway is what carries it">
        Every channel below except in-app needs at least one enabled gateway behind it, or a rule using it sends
        into nothing. A gateway needs more than a name: an address, a credential, a registered sender where the
        market demands one, somewhere to receive delivery receipts, and a rate — a gateway nobody has priced
        reports every message it carries as costing nothing.
      </Callout>

      {/* Switched on and unable to send is the state worth shouting about: it is
          live, and every message routed to it is lost. */}
      {broken.length > 0 && (
        <Callout tone="danger" title={`${broken.length} enabled gateway${broken.length === 1 ? '' : 's'} cannot send`}>
          {broken.map(b => (
            <div key={b.gateway.id} style={{ marginTop: '4px' }}>
              <strong>{b.gateway.name}</strong> — {b.gaps.join('; ')}.
            </div>
          ))}
        </Callout>
      )}

      <SectionCard title="What is behind each gateway"
                   subtitle="The address, the credential and the sender registration a real send needs — and whether anybody has proved it works.">
        <Table headers={['Gateway', 'Carries', 'Address', 'Credential', 'Receipts', 'Falls over to', 'Checked', 'Actions']}>
          {book.gateways.map(g => {
            const ci = integrationOf(g.id)
            const gaps = configGaps(g, ci, book.rates)
            const chain = failoverChain(g.id, book.integrations).slice(1)
            return (
              <tr key={g.id}>
                <Td>
                  <div style={{ fontWeight: 600 }}>{g.name}</div>
                  <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
                    {g.transport ?? 'no transport named'} · {g.enabled ? 'enabled' : 'disabled'}
                  </div>
                </Td>
                <Td right>{g.kind ? <KindChip kind={g.kind} /> : <span style={{ color: 'var(--warning)' }}>not mapped</span>}</Td>
                <Td right style={{ fontSize: 'var(--text-xs)', maxWidth: '220px', wordBreak: 'break-all' }}>
                  {ci?.endpoint
                    ? `${ci.endpoint}${ci.port && !ci.endpoint.startsWith('http') ? `:${ci.port}` : ''}`
                    : <span style={{ color: 'var(--danger)' }}>none</span>}
                </Td>
                <Td right style={{ fontSize: 'var(--text-xs)' }}>
                  {!ci ? '—' : ci.auth_mode === 'none' ? 'none needed'
                    : ci.secret_hint
                      /* The last four and the date, because a credential you can
                         read back is a credential you have leaked. */
                      ? `${ci.auth_mode} · ends ${ci.secret_hint}${ci.secret_set_on ? ` · set ${ci.secret_set_on}` : ''}`
                      : <span style={{ color: 'var(--danger)' }}>{ci.auth_mode}, none loaded</span>}
                </Td>
                <Td right style={{ fontSize: 'var(--text-xs)', maxWidth: '180px', wordBreak: 'break-word' }}>
                  {!g.has_receipt ? 'none claimed'
                    : ci?.dlr_url ? ci.dlr_url
                    : <span style={{ color: 'var(--danger)' }}>claimed, nowhere to arrive</span>}
                </Td>
                <Td right style={{ fontSize: 'var(--text-xs)' }}>
                  {chain.length === 0 ? '—'
                    : `${chain.map(nameOf).join(' → ')} · after ${ci?.retry_attempts ?? 0} ${ci?.retry_backoff ?? ''} retries`}
                </Td>
                <Td right style={{ fontSize: 'var(--text-xs)' }}>
                  <StatusPill status={ci?.status ?? 'not_configured'} />
                  <div style={{ color: 'var(--text-tertiary)', marginTop: '2px' }}>
                    {ci?.last_test_at
                      ? `${when(ci.last_test_at)}${ci.last_test_ms ? ` · ${ci.last_test_ms}ms` : ''}`
                      : 'never'}
                  </div>
                  {gaps.length > 0 && (
                    <div style={{ color: 'var(--danger)', marginTop: '2px', maxWidth: '200px' }}>{gaps[0]}</div>
                  )}
                </Td>
                <Td right>
                  <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                    <Btn variant="secondary" size="sm" onClick={() => setWiring(g)}>Configure</Btn>
                    <Btn variant="secondary" size="sm" onClick={() => setPricing(g)}>Rates</Btn>
                    <Btn variant="secondary" size="sm" disabled={testing === g.id}
                         onClick={() => void runTest(g.id)}>
                      {testing === g.id ? 'Checking…' : 'Check'}
                    </Btn>
                  </div>
                </Td>
              </tr>
            )
          })}
        </Table>
      </SectionCard>

      <SectionCard title="What each gateway charges"
                   subtitle="Per destination, in the currency the carrier bills in. One rate for everywhere is not how any of these are sold.">
        <Table headers={['Gateway', 'Destination', 'Rate', 'Billed by', 'From', 'Note']}>
          {book.rates.filter(r => !r.effective_to).map(r => (
            <tr key={r.id}>
              <Td>{nameOf(r.channel_id)}</Td>
              <Td right style={{ fontSize: 'var(--text-xs)' }}>
                {r.destination === 'default'
                  ? <span style={{ color: 'var(--text-tertiary)' }}>anywhere not quoted</span>
                  : r.destination}
              </Td>
              <Td right>{money(r.unit_rate, r.currency)}</Td>
              <Td right style={{ fontSize: 'var(--text-xs)' }}>
                {r.segment_chars
                  ? `segment of ${r.segment_chars} chars (${r.multipart_chars ?? r.segment_chars} concatenated)`
                  : 'the message'}
              </Td>
              <Td right style={{ fontSize: 'var(--text-xs)' }}>{r.effective_from}</Td>
              <Td right style={{ fontSize: 'var(--text-xs)', maxWidth: '240px' }}>{r.note ?? '—'}</Td>
            </tr>
          ))}
        </Table>
      </SectionCard>

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
                <Td right style={{ fontSize: 'var(--text-xs)' }}>
                  {stats && stats.spend.length ? spendLine(stats.spend, money) : '—'}
                </Td>
              </tr>
            )
          })}
        </Table>
      </SectionCard>

      <SectionCard title="What each gateway has carried" subtitle="Counted in segments, because that is what a carrier bills.">
        {gatewayUse.length === 0 ? <EmptyState message="Nothing has been sent through a gateway yet" /> : (
          <Table headers={['Gateway', 'Carries', 'Messages', 'Segments', 'Cost']}>
            {gatewayUse.map(g => (
              <tr key={g.id}>
                <Td>{g.name}</Td>
                <Td right>{g.kind ? <KindChip kind={g.kind} /> : <span style={{ color: 'var(--warning)' }}>not mapped</span>}</Td>
                <Td right>{fmtInt(g.messages)}</Td>
                <Td right>{fmtInt(g.segments)}</Td>
                <Td right style={{ fontSize: 'var(--text-xs)' }}>
                  {g.spend.length ? spendLine(g.spend, money) : '—'}
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </SectionCard>

      <SectionCard title="Every check that has been run"
                   subtitle="A pass says what it checked. Green with nothing behind it is what this screen used to show.">
        {book.tests.length === 0 ? <EmptyState message="No gateway has been checked yet" /> : (
          <Table headers={['When', 'Gateway', 'By', 'Result', 'What it found']}>
            {book.tests.slice(0, 24).map(t => (
              <tr key={t.id}>
                <Td style={{ fontSize: 'var(--text-xs)', whiteSpace: 'nowrap' }}>{when(t.ran_at)}</Td>
                <Td right style={{ fontSize: 'var(--text-xs)' }}>{nameOf(t.channel_id)}</Td>
                <Td right style={{ fontSize: 'var(--text-xs)' }}>{t.ran_by}</Td>
                <Td right>
                  <StatusPill status={t.ok ? 'passed' : 'failed'} />
                  {t.ms != null && (
                    <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>{t.ms}ms</div>
                  )}
                </Td>
                <Td right style={{ fontSize: 'var(--text-xs)', maxWidth: '420px' }}>
                  {(t.checks ?? []).map((c, i) => <div key={i}>{t.ok ? '✓' : '✗'} {c}</div>)}
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </SectionCard>

      {wiring && (
        <IntegrationModal gateway={wiring} book={book}
                          onClose={() => setWiring(null)} onSaved={onReload} />
      )}
      {pricing && (
        <RatesModal gateway={pricing} book={book}
                    onClose={() => setPricing(null)} onSaved={onReload} />
      )}
    </div>
  )
}

/* The wiring itself. Nothing here reveals a credential — the field sets a new
   one and the record shows only its last four characters afterwards. */
function IntegrationModal({ gateway, book, onClose, onSaved }: {
  gateway: Gateway; book: NotificationBook; onClose: () => void; onSaved: () => Promise<void>
}) {
  const existing = book.integrations.find(i => i.channel_id === gateway.id) ?? null
  const [form, setForm] = useState<Integration>(existing ?? {
    channel_id: gateway.id, endpoint: null, port: null, auth_mode: 'none', auth_user: null,
    secret_hint: null, secret_set_on: null, sender_registry: null, sender_ref: null, sender_ok: false,
    dlr_url: null, timeout_ms: 5000, retry_attempts: 2, retry_backoff: 'exponential',
    retry_after_ms: 2000, failover_id: null, status: 'not_configured',
    last_test_at: null, last_test_ms: null, last_test_note: null, note: null,
  })
  const [secret, setSecret] = useState('')
  const [busy, setBusy] = useState(false)

  const set = <K extends keyof Integration>(k: K, v: Integration[K]) => setForm({ ...form, [k]: v })
  const gaps = configGaps(gateway, form, book.rates)

  const save = async () => {
    setBusy(true)
    const r = await saveIntegration(form)
    if (!r.ok) { setBusy(false); toast(r.reason, 'error'); return }
    if (secret.trim()) {
      const s = await setGatewaySecret(gateway.id, secret.trim())
      if (!s.ok) { setBusy(false); toast(s.reason, 'error'); return }
      toast(s.note ?? 'Credential set', 'success')
    } else {
      toast(r.note ?? 'Saved', 'success')
    }
    setBusy(false)
    await onSaved()
    onClose()
  }

  /* Only a channel of the same kind is a real alternative, and the database
     refuses anything else — so the picker offers only what it would accept. */
  const failoverOptions = book.gateways.filter(g =>
    g.id !== gateway.id && g.kind === gateway.kind && g.enabled)

  return (
    <Modal open onClose={onClose} title={`${gateway.name} — how it is reached`}
           footer={<>
             <Btn variant="secondary" size="sm" onClick={onClose}>Cancel</Btn>
             <Btn size="sm" disabled={busy} onClick={() => void save()}>{busy ? 'Saving…' : 'Save'}</Btn>
           </>}>
      {gaps.length > 0 && (
        <Callout tone="warning" title="This would not send yet">
          {gaps.join('; ')}.
        </Callout>
      )}

      <div style={{ display: 'flex', gap: '12px' }}>
        <div style={{ flex: 2 }}>
          <FormField label="Endpoint" hint="A host for an SMPP bind, a URL for a REST gateway">
            <TextInput value={form.endpoint ?? ''} onChange={e => set('endpoint', e.target.value)}
                       placeholder="smpp.routemobile.com" />
          </FormField>
        </div>
        <div style={{ flex: 1 }}>
          <FormField label="Port">
            <TextInput type="number" value={form.port ?? ''}
                       onChange={e => set('port', e.target.value ? parseInt(e.target.value) : null)} />
          </FormField>
        </div>
      </div>

      <div style={{ display: 'flex', gap: '12px' }}>
        <div style={{ flex: 1 }}>
          <FormField label="Authentication">
            <Select value={form.auth_mode} onChange={e => set('auth_mode', e.target.value as Integration['auth_mode'])}>
              <option value="none">None</option>
              <option value="basic">Basic</option>
              <option value="api_key">API key</option>
              <option value="oauth2">OAuth 2</option>
              <option value="smpp_bind">SMPP bind</option>
              <option value="mtls">Mutual TLS</option>
            </Select>
          </FormField>
        </div>
        <div style={{ flex: 1 }}>
          <FormField label="User or key id">
            <TextInput value={form.auth_user ?? ''} onChange={e => set('auth_user', e.target.value)} />
          </FormField>
        </div>
      </div>

      <FormField label="Credential"
                 hint={form.secret_hint
                   ? `One is loaded, ending ${form.secret_hint}${form.secret_set_on ? `, set on ${form.secret_set_on}` : ''}. It is stored hashed and cannot be read back — typing here replaces it.`
                   : 'Stored hashed. It is never shown again, here or anywhere.'}>
        <TextInput type="password" value={secret} onChange={e => setSecret(e.target.value)}
                   placeholder={form.secret_hint ? 'Leave blank to keep the current one' : 'At least eight characters'} />
      </FormField>

      <div style={{ display: 'flex', gap: '12px' }}>
        <div style={{ flex: 1 }}>
          <FormField label="Sender registry" hint="DLT in India, a sender-ID application in Kenya">
            <TextInput value={form.sender_registry ?? ''} onChange={e => set('sender_registry', e.target.value)}
                       placeholder="TRAI DLT" />
          </FormField>
        </div>
        <div style={{ flex: 1 }}>
          <FormField label="Registration reference">
            <TextInput value={form.sender_ref ?? ''} onChange={e => set('sender_ref', e.target.value)} />
          </FormField>
        </div>
      </div>
      <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: 'var(--text-sm)', cursor: 'pointer' }}>
        <input type="checkbox" checked={form.sender_ok} onChange={e => set('sender_ok', e.target.checked)} />
        Sender {gateway.sender ?? ''} is registered and approved
      </label>

      <FormField label="Delivery receipt callback"
                 hint={gateway.has_receipt
                   ? 'This channel claims delivery receipts, so it needs somewhere for them to arrive — otherwise it reports delivery of messages nobody got.'
                   : 'This channel does not claim receipts, so this can stay empty.'}>
        <TextInput value={form.dlr_url ?? ''} onChange={e => set('dlr_url', e.target.value)}
                   placeholder="https://api.aventa.com/hooks/dlr/…" />
      </FormField>

      <div style={{ display: 'flex', gap: '12px' }}>
        <div style={{ flex: 1 }}>
          <FormField label="Timeout (ms)">
            <TextInput type="number" value={form.timeout_ms}
                       onChange={e => set('timeout_ms', parseInt(e.target.value) || 5000)} />
          </FormField>
        </div>
        <div style={{ flex: 1 }}>
          <FormField label="Retries">
            <TextInput type="number" value={form.retry_attempts}
                       onChange={e => set('retry_attempts', parseInt(e.target.value) || 0)} />
          </FormField>
        </div>
        <div style={{ flex: 1 }}>
          <FormField label="Backoff">
            <Select value={form.retry_backoff} onChange={e => set('retry_backoff', e.target.value as Integration['retry_backoff'])}>
              <option value="none">None</option>
              <option value="fixed">Fixed</option>
              <option value="exponential">Exponential</option>
            </Select>
          </FormField>
        </div>
        <div style={{ flex: 1 }}>
          <FormField label="Wait (ms)">
            <TextInput type="number" value={form.retry_after_ms}
                       onChange={e => set('retry_after_ms', parseInt(e.target.value) || 2000)} />
          </FormField>
        </div>
      </div>

      <FormField label="Falls over to"
                 hint="Only an enabled channel carrying the same kind — anything else sends the retry somewhere it cannot go.">
        <Select value={form.failover_id ?? ''} onChange={e => set('failover_id', e.target.value || null)}>
          <option value="">Nothing — a refusal here is the end of the road</option>
          {failoverOptions.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
        </Select>
      </FormField>

      <FormField label="Note">
        <TextArea value={form.note ?? ''} onChange={e => set('note', e.target.value)} />
      </FormField>
    </Modal>
  )
}

/* The rate card for one gateway, plus what a message would actually cost — a
   number a desk can check against a carrier invoice before it signs one. */
function RatesModal({ gateway, book, onClose, onSaved }: {
  gateway: Gateway; book: NotificationBook; onClose: () => void; onSaved: () => Promise<void>
}) {
  const markets = Array.from(new Set(book.rates.map(r => r.destination).filter(d => d !== 'default'))).sort()
  const live = book.rates.filter(r => r.channel_id === gateway.id && !r.effective_to)
  const [adding, setAdding] = useState(false)
  const [form, setForm] = useState<Rate>({
    id: '', channel_id: gateway.id, destination: markets[0] ?? 'default', currency: 'USD',
    unit_rate: 0, segment_chars: gateway.kind === 'sms' ? 160 : null,
    multipart_chars: gateway.kind === 'sms' ? 153 : null, min_charge: 0,
    effective_from: new Date().toISOString().slice(0, 10), effective_to: null, note: null,
  })
  const [chars, setChars] = useState(160)
  const [where, setWhere] = useState(markets[0] ?? 'default')
  const [busy, setBusy] = useState(false)

  const q = quote(book.rates, gateway.id, where, chars)
  const replacing = live.find(r => r.destination === form.destination) ?? null

  const add = async () => {
    setBusy(true)
    const r = await saveRate(form, replacing)
    setBusy(false)
    toast(r.ok ? r.note ?? 'Saved' : r.reason, r.ok ? 'success' : 'error')
    if (r.ok) { setAdding(false); await onSaved() }
  }

  return (
    <Modal open onClose={onClose} title={`${gateway.name} — what it charges`}
           footer={<Btn variant="secondary" size="sm" onClick={onClose}>Close</Btn>}>
      <Callout tone="info" title="A rate is replaced, not edited">
        Changing a price ends the old rate and starts a new one, so a message sent last month still reconciles
        against the rate that was live when it went.
      </Callout>

      <Table headers={['Destination', 'Rate', 'Billed by', 'From', 'Note']}>
        {live.map(r => (
          <tr key={r.id}>
            <Td>{r.destination === 'default' ? 'anywhere not quoted' : r.destination}</Td>
            <Td right>{money(r.unit_rate, r.currency)}</Td>
            <Td right style={{ fontSize: 'var(--text-xs)' }}>
              {r.segment_chars ? `${r.segment_chars} char segment` : 'the message'}
            </Td>
            <Td right style={{ fontSize: 'var(--text-xs)' }}>{r.effective_from}</Td>
            <Td right style={{ fontSize: 'var(--text-xs)' }}>{r.note ?? '—'}</Td>
          </tr>
        ))}
      </Table>
      {live.length === 0 && (
        <EmptyState message="Nothing priced — every message on this gateway currently costs nothing" />
      )}

      {/* The calculator, because a rate card is only checkable against a real
          message. */}
      <SectionCard title="What a message would cost" subtitle="Type a length and pick a destination.">
        <div style={{ display: 'flex', gap: '12px', padding: '12px 16px', alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: '120px' }}>
            <FormField label="Characters">
              <TextInput type="number" value={chars} onChange={e => setChars(parseInt(e.target.value) || 0)} />
            </FormField>
          </div>
          <div style={{ flex: 1, minWidth: '120px' }}>
            <FormField label="Destination">
              <Select value={where} onChange={e => setWhere(e.target.value)}>
                {[...markets, 'default'].map(m => (
                  <option key={m} value={m}>{m === 'default' ? 'Anywhere else' : m}</option>
                ))}
              </Select>
            </FormField>
          </div>
          <div style={{ flex: 2, minWidth: '220px', paddingBottom: '10px' }}>
            {q.priced ? (
              <div style={{ fontSize: 'var(--text-sm)' }}>
                <strong>{money(q.amount, q.currency)}</strong>
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
                  {q.segments} segment{q.segments === 1 ? '' : 's'} at {money(q.rate.unit_rate, q.currency)}
                  {q.fellBack && ' · on the default rate, not a quote for this market'}
                </div>
              </div>
            ) : (
              <div style={{ fontSize: 'var(--text-sm)', color: 'var(--danger)' }}>{q.why}</div>
            )}
          </div>
        </div>
      </SectionCard>

      {!adding ? (
        <Btn size="sm" onClick={() => setAdding(true)}><Plus size={14} /> Add or replace a rate</Btn>
      ) : (
        <SectionCard title={replacing ? `Replace the ${form.destination} rate` : `New rate for ${form.destination}`}
                     subtitle={replacing ? `The current one started on ${replacing.effective_from} and will be closed the day before this starts.` : undefined}>
          <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <div style={{ display: 'flex', gap: '12px' }}>
              <div style={{ flex: 1 }}>
                <FormField label="Destination">
                  <Select value={form.destination} onChange={e => setForm({ ...form, destination: e.target.value })}>
                    {[...markets, 'default'].map(m => (
                      <option key={m} value={m}>{m === 'default' ? 'Anywhere not quoted' : m}</option>
                    ))}
                  </Select>
                </FormField>
              </div>
              <div style={{ flex: 1 }}>
                <FormField label="Currency" hint="What the carrier bills in, not what the marketplace reports in">
                  <Select value={form.currency} onChange={e => setForm({ ...form, currency: e.target.value })}>
                    {Array.from(new Set(book.rates.map(r => r.currency))).sort().map(c => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </Select>
                </FormField>
              </div>
              <div style={{ flex: 1 }}>
                <FormField label="Rate">
                  <TextInput type="number" step="0.000001" value={form.unit_rate}
                             onChange={e => setForm({ ...form, unit_rate: parseFloat(e.target.value) || 0 })} />
                </FormField>
              </div>
            </div>
            <div style={{ display: 'flex', gap: '12px' }}>
              <div style={{ flex: 1 }}>
                <FormField label="Segment chars" hint="Blank where the carrier bills per message">
                  <TextInput type="number" value={form.segment_chars ?? ''}
                             onChange={e => setForm({ ...form, segment_chars: e.target.value ? parseInt(e.target.value) : null })} />
                </FormField>
              </div>
              <div style={{ flex: 1 }}>
                <FormField label="Concatenated chars">
                  <TextInput type="number" value={form.multipart_chars ?? ''}
                             onChange={e => setForm({ ...form, multipart_chars: e.target.value ? parseInt(e.target.value) : null })} />
                </FormField>
              </div>
              <div style={{ flex: 1 }}>
                <FormField label="Starts">
                  <TextInput type="date" value={form.effective_from}
                             onChange={e => setForm({ ...form, effective_from: e.target.value })} />
                </FormField>
              </div>
            </div>
            <FormField label="Note">
              <TextInput value={form.note ?? ''} onChange={e => setForm({ ...form, note: e.target.value })}
                         placeholder="Transactional SMPP rate, per segment" />
            </FormField>
            <div style={{ display: 'flex', gap: '8px' }}>
              <Btn size="sm" disabled={busy} onClick={() => void add()}>{busy ? 'Saving…' : 'Save rate'}</Btn>
              <Btn variant="secondary" size="sm" onClick={() => setAdding(false)}>Cancel</Btn>
            </div>
          </div>
        </SectionCard>
      )}
    </Modal>
  )
}

/* ------------------------------------------------------------ recipients -- */

function RecipientsTab({ book }: { book: NotificationBook }) {
  const rules = new Map(book.rules.map(r => [r.id, r]))

  /* Grouped by whoever the preference belongs to, because "what has this account
     turned off" is the question support actually asks. */
  const groups = useMemo(() => {
    const m = new Map<string, {
      key: string; label: string; who: NamedRecipient; scope: string; prefs: Preference[]
    }>()
    for (const p of book.preferences) {
      const key = ownerKey(p) ?? 'unknown'
      const who = nameRecipient(ownerKey(p), book.recipients)
      const g = m.get(key) ?? {
        key,
        label: recipientLine(who),
        who,
        scope: scopeLine(p.scope),
        prefs: [],
      }
      g.prefs.push(p)
      m.set(key, g)
    }
    /* Named people first, then whatever the directory could not place — an
       unresolvable owner belongs at the bottom, not scattered through. */
    return [...m.values()].sort((a, b) =>
      a.who.known === b.who.known ? a.label.localeCompare(b.label) : a.who.known ? -1 : 1)
  }, [book.preferences, book.recipients])

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
              const who = nameRecipient(ownerKey(p), book.recipients)
              return (
                <tr key={p.id}>
                  <Td>
                    <span style={{ color: who.known ? undefined : 'var(--text-tertiary)' }}>{who.name}</span>
                    {who.ref && (
                      <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
                        {who.ref}{p.scope === 'partner' ? ' · whole account' : ''}
                      </div>
                    )}
                  </Td>
                  <Td right>{r?.name ?? p.rule_id}</Td>
                  <Td right style={{ fontSize: 'var(--text-xs)' }}>
                    {who.detail || (r ? PERSONA_LABEL[r.persona] : '—')}
                  </Td>
                  <Td right style={{ fontSize: 'var(--text-xs)' }}>{p.updated_on ?? '—'}</Td>
                </tr>
              )
            })}
          </Table>
        </SectionCard>
      )}

      {groups.map(g => (
        <SectionCard key={g.key} title={g.label}
                     subtitle={[
                       g.who.detail,
                       `${g.prefs.length} choices`,
                       g.scope,
                     ].filter(Boolean).join(' · ')}>
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
  /* The log is the longest table in the console and had no paging at all.
     Any change of filter is a different list, so it goes back to page 1. */
  const logPage = usePaging(rows, { resetKey: `${persona}:${kind}:${state}:${search}` })
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
          <><Table headers={['When', 'Who', 'Recipient', 'Channel', 'Subject', 'Rule', 'Outcome', 'Cost']}>
            {logPage.rows.map(e => (
              <>
                <tr key={e.id} onClick={() => setOpen(open === e.id ? null : e.id)} style={{ cursor: 'pointer' }}>
                  <Td style={{ fontSize: 'var(--text-xs)', whiteSpace: 'nowrap' }}>{when(e.sent_at)}</Td>
                  <Td right style={{ fontSize: 'var(--text-xs)' }}>{PERSONA_LABEL[e.persona]}</Td>
                  <Td right style={{ fontSize: 'var(--text-xs)' }}>{e.recipient}</Td>
                  <Td right><KindChip kind={e.kind_id} /></Td>
                  <Td right style={{ maxWidth: '260px' }}>{e.subject}</Td>
                  <Td right style={{ fontSize: 'var(--text-xs)' }}>{rules.get(e.rule_id ?? '')?.name ?? '—'}</Td>
                  <Td right><OutcomePill state={e.state} /></Td>
                  <Td right style={{ fontSize: 'var(--text-xs)' }}>
                    {e.cost > 0 && e.cost_currency ? (
                      <>
                        {money(e.cost, e.cost_currency)}
                        {(e.segments ?? 1) > 1 && (
                          <div style={{ color: 'var(--text-tertiary)' }}>{e.segments} segments</div>
                        )}
                      </>
                    ) : '—'}
                  </Td>
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
          <div style={{ padding: '0 18px 12px' }}><Pager page={logPage} noun="messages" /></div></>
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
