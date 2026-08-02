import { useState, useEffect, useCallback, useMemo } from 'react'
import { Plus, Copy, Trash2, Pencil, Lock, ArrowLeft } from 'lucide-react'
import {
  SectionCard, EmptyState, Btn, FormField, TextInput, TextArea, Select,
  Table, Td, toast, ConfirmDialog,
} from './shared'
import { Callout } from '../OnboardingJourney'
import { BillDocument } from '../BillDocument'
import {
  loadBillTemplates, saveTemplate, duplicateTemplate, deleteTemplate,
  assignTemplate, removeOverride, saveIssuer,
} from '../../lib/billTemplateRepo'
import type { BillTemplateBook, Draft } from '../../lib/billTemplateRepo'
import {
  sectionsOn, offeredTo, canRemove, canAdd, warningsFor, validateTemplate,
  nextReference, referencePattern, validateNumbering, canDelete, usedBy, suppressed, templateFor,
} from '../../lib/billTemplate'
import type { Template, Audience, Section } from '../../lib/billTemplate'

/* A bill is the most-read document the marketplace produces and, for many
   customers, the only one they ever see. It used to be one hard-coded layout
   for everybody, which is only defensible while every counterparty is the same
   kind of counterparty — and here none of them are. A retail customer wants
   the figure at the top, a slip at the bottom and one offer in the middle; a
   procurement team wants every line against a purchase order and did not ask
   to be sold to on a tax document; a seller gets a self-billing invoice, where
   a payment slip is backwards because we pay them.

   So: a catalogue of sections, templates that pick from it, and an assignment
   saying who gets which. The preview sits beside the checkboxes rather than
   behind a button, because a list of sixteen switches is not something anybody
   can check their own work against. */

const ACTOR = 'Anika Sharma'
const AUDIENCES: (Audience | 'any')[] = ['consumer', 'enterprise', 'partner', 'any']

export function OperatorBillTemplates() {
  const [book, setBook] = useState<BillTemplateBook | null>(null)
  const [editing, setEditing] = useState<Template | 'new' | null>(null)
  const [tab, setTab] = useState<'templates' | 'assignments' | 'identity'>('templates')

  const reload = useCallback(async () => setBook(await loadBillTemplates()), [])
  useEffect(() => { void reload() }, [reload])

  if (!book) {
    return <div style={{ textAlign: 'center', padding: '40px' }}><div className="spinner" style={{ margin: '0 auto' }} /></div>
  }
  if (book.loadError) {
    return <Callout tone="danger" title="The template catalogue did not load">{book.loadError}</Callout>
  }

  if (editing) {
    return (
      <TemplateEditor
        book={book}
        template={editing === 'new' ? null : editing}
        onDone={async () => { setEditing(null); await reload() }}
        onCancel={() => setEditing(null)}
      />
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '16px', flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ fontSize: 'var(--text-2xl)', fontWeight: 800, color: 'var(--text)' }}>Bill and invoice templates</h2>
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', marginTop: '4px', maxWidth: '68ch' }}>
            Which sections appear on a document, in what order, and who is sent which template.
          </p>
        </div>
        {tab === 'templates' && (
          <Btn onClick={() => setEditing('new')}><Plus size={14} style={{ marginRight: 6 }} />New template</Btn>
        )}
      </div>

      <div style={{ display: 'flex', gap: '4px', borderBottom: '1px solid var(--border)' }}>
        {([
          ['templates', 'Templates'],
          ['assignments', 'Who gets what'],
          ['identity', 'Billing identity'],
        ] as const).map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)} style={{
            padding: '8px 14px', border: 'none', background: 'none', cursor: 'pointer',
            fontSize: 'var(--text-sm)', fontWeight: tab === id ? 700 : 500,
            color: tab === id ? 'var(--brand-navy)' : 'var(--text-tertiary)',
            borderBottom: `2px solid ${tab === id ? 'var(--brand-navy)' : 'transparent'}`,
            marginBottom: '-1px',
          }}>{label}</button>
        ))}
      </div>

      {tab === 'templates' && <TemplateList book={book} onEdit={setEditing} onChanged={reload} />}
      {tab === 'assignments' && <Assignments book={book} onChanged={reload} />}
      {tab === 'identity' && <BillingIdentity book={book} onChanged={reload} />}
    </div>
  )
}

/* ---------------------------------------------------------------- the list -- */

function TemplateList(
  { book, onEdit, onChanged }: {
    book: BillTemplateBook; onEdit: (t: Template) => void; onChanged: () => Promise<void>
  },
) {
  const [confirming, setConfirming] = useState<Template | null>(null)

  const act = async (fn: () => Promise<{ ok: boolean; reason?: string; note?: string }>) => {
    const res = await fn()
    if (!res.ok) { toast(res.reason ?? 'That did not work', 'error'); return }
    toast(res.note ?? 'Saved')
    await onChanged()
  }

  return (
    <>
      <Callout tone="info" title="Templates differ by audience because the audiences do">
        A consumer bill carries a payment slip and one relevant offer. A self-billing invoice to a
        seller carries neither — a slip would be asking them to pay us. Four sections cannot be
        switched off on any template: without both parties, the tax breakdown and a summary that
        reconciles, a document is not a bill.
      </Callout>

      <SectionCard title="Templates" subtitle={`${book.templates.length} on file`}>
        <Table headers={['Template', 'Audience', 'Document title', 'Sections', 'Next reference', 'In use', '']}>
          {book.templates.map(t => {
            const ids = sectionsOn(t, book.sections, book.chosen).map(s => s.id)
            const used = usedBy(t.id, book.assignments)
            const del = canDelete(t, book.assignments)
            return (
              <tr key={t.id} style={{ borderBottom: '1px solid var(--border-light)' }}>
                <Td>
                  <div style={{ fontWeight: 600, color: 'var(--text)' }}>
                    {t.name}
                    {t.system && (
                      <span style={{
                        marginLeft: 8, padding: '1px 7px', borderRadius: 'var(--radius-full)',
                        background: 'var(--bg-alt)', color: 'var(--text-tertiary)',
                        fontSize: '10px', fontWeight: 700,
                      }}>Built in</span>
                    )}
                  </div>
                  <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', maxWidth: '46ch' }}>{t.note}</div>
                </Td>
                <Td>{t.audience === 'any' ? 'Any' : t.audience}</Td>
                <Td>{t.doc_title}</Td>
                <Td right>{ids.length}</Td>
                <Td><span style={{ fontVariantNumeric: 'tabular-nums' }}>{referencePattern(t)}</span></Td>
                <Td>
                  {used.length
                    ? used.join(', ')
                    : <span style={{ color: 'var(--text-tertiary)' }}>Nobody yet</span>}
                </Td>
                <Td>
                  <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end' }}>
                    <Btn size="sm" variant="secondary" onClick={() => onEdit(t)}>
                      <Pencil size={12} style={{ marginRight: 4 }} />Edit
                    </Btn>
                    <Btn size="sm" variant="secondary"
                      onClick={() => act(() => duplicateTemplate({ source: t, ids, actor: ACTOR }))}>
                      <Copy size={12} style={{ marginRight: 4 }} />Duplicate
                    </Btn>
                    <Btn size="sm" variant="danger" disabled={!del.ok}
                      title={del.ok ? undefined : del.reason}
                      onClick={() => setConfirming(t)}>
                      <Trash2 size={12} />
                    </Btn>
                  </div>
                </Td>
              </tr>
            )
          })}
        </Table>
        {!book.templates.length && <EmptyState message="No templates on file." />}
      </SectionCard>

      <ConfirmDialog
        open={!!confirming}
        onClose={() => setConfirming(null)}
        title={confirming ? `Delete ${confirming.name}` : ''}
        message="It is assigned to nobody, so no bill changes. Documents already issued on it are unaffected — a bill is a snapshot, not a live render."
        confirmLabel="Delete it"
        danger
        onConfirm={() => {
          if (confirming) void act(() => deleteTemplate({ template: confirming, assignments: book.assignments, actor: ACTOR }))
          setConfirming(null)
        }}
      />
    </>
  )
}

/* -------------------------------------------------------------- the editor -- */

function blankDraft(): Draft {
  return {
    name: '', audience: 'consumer', doc_title: 'Invoice', accent: '#0D47A1', note: '',
    numbering: 'INV-{YYYY}-{SEQ}', next_seq: 1, date_format: 'DD MMM YYYY', currency: 'USD',
    tax_label: 'Tax', rounding: 'Half up, 2 decimal places', language: 'English',
    logo: true, show_order_lines: true,
    remittance: 'Paid by bank transfer to the account on file. Quote the document reference.',
    footer: 'Issued by Aventa Telecom.',
  }
}

function TemplateEditor(
  { book, template, onDone, onCancel }: {
    book: BillTemplateBook; template: Template | null
    onDone: () => Promise<void>; onCancel: () => void
  },
) {
  const [draft, setDraft] = useState<Draft>(() =>
    template ? { ...(template as unknown as Draft) } : blankDraft())
  const [ids, setIds] = useState<string[]>(() =>
    template
      ? sectionsOn(template, book.sections, book.chosen).map(s => s.id)
      /* A new template starts as a document somebody could actually send:
         the four that cannot come off, plus the ones whose absence the
         warnings would immediately complain about. */
      : ['masthead', 'parties', 'hero', 'subs', 'usage', 'tax', 'summary', 'howtopay', 'support'])
  const [saving, setSaving] = useState(false)

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft(d => ({ ...d, [k]: v }))

  /* Changing audience can strip a section the new audience may not have. That
     is a real edit and it is better made visibly here than refused on save. */
  const setAudience = (audience: Draft['audience']) => {
    const dropped = book.sections.filter(s => ids.includes(s.id) && !offeredTo(s, audience))
    setDraft(d => ({ ...d, audience }))
    if (dropped.length) {
      setIds(prev => prev.filter(id => !dropped.some(s => s.id === id)))
      toast(`${dropped.map(s => s.label).join(' and ')} removed — not written for a ${audience} document.`, 'info')
    }
  }

  const toggle = (s: Section) => {
    if (ids.includes(s.id)) {
      const check = canRemove(s)
      if (!check.ok) { toast(check.reason, 'error'); return }
      setIds(prev => prev.filter(x => x !== s.id))
    } else {
      const check = canAdd(s, draft.audience)
      if (!check.ok) { toast(check.reason, 'error'); return }
      setIds(prev => [...prev, s.id])
    }
  }

  const warnings = useMemo(
    () => warningsFor({ ids, audience: draft.audience, showOrderLines: draft.show_order_lines }),
    [ids, draft.audience, draft.show_order_lines])
  const verdict = validateTemplate(draft, ids, book.sections)
  const numbering = validateNumbering(draft.numbering)

  /* Preview against the audience this template is written for. An "any"
     template has to be previewed against somebody, so it is previewed against
     a consumer — the audience with the most sections to get wrong. */
  const previewAudience: Audience = draft.audience === 'any' ? 'consumer' : draft.audience
  const facts = book.samples[previewAudience]
  const hidden = facts ? suppressed(ids, facts) : []

  const save = async () => {
    setSaving(true)
    const res = await saveTemplate({
      id: template?.id ?? null, draft, ids, actor: ACTOR, all: book.sections,
    })
    setSaving(false)
    if (!res.ok) { toast(res.reason, 'error'); return }
    toast(res.note ?? 'Saved')
    await onDone()
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
        <Btn variant="secondary" size="sm" onClick={onCancel}>
          <ArrowLeft size={13} style={{ marginRight: 5 }} />Back
        </Btn>
        <h2 style={{ fontSize: 'var(--text-xl)', fontWeight: 800, color: 'var(--text)' }}>
          {template ? template.name : 'New template'}
        </h2>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: '8px' }}>
          <Btn variant="secondary" size="sm" onClick={onCancel}>Cancel</Btn>
          <Btn size="sm" disabled={saving || !verdict.ok} onClick={() => void save()}>
            {saving ? 'Saving…' : template ? 'Save' : 'Create it'}
          </Btn>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.15fr) minmax(0, 1fr)', gap: '20px', alignItems: 'start' }}>
        {/* ------------------------------------------------------- the choices */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', minWidth: 0 }}>
          <SectionCard title="What this document is">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 16px' }}>
              <FormField label="Template name" required>
                <TextInput value={draft.name} onChange={e => set('name', e.target.value)}
                  placeholder="Consumer standard" />
              </FormField>
              <FormField label="Audience"
                hint="What a section is offered for. A payment slip is not offered to a seller.">
                <Select value={draft.audience} onChange={e => setAudience(e.target.value as Draft['audience'])}>
                  {AUDIENCES.map(a => <option key={a} value={a}>{a === 'any' ? 'Any counterparty' : a}</option>)}
                </Select>
              </FormField>
              <FormField label="Document title" required
                hint={'"Tax invoice" carries a legal meaning in some jurisdictions. Choose it deliberately.'}>
                <TextInput value={draft.doc_title} onChange={e => set('doc_title', e.target.value)} />
              </FormField>
              <FormField label="Accent colour">
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <input type="color" value={draft.accent} onChange={e => set('accent', e.target.value)}
                    style={{ width: 44, height: 38, border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: 2, cursor: 'pointer' }} />
                  <TextInput value={draft.accent} onChange={e => set('accent', e.target.value)} />
                </div>
              </FormField>
            </div>
            <FormField label="What it is for" hint="Shown on the template list, so somebody else can tell them apart.">
              <TextArea value={draft.note} onChange={e => set('note', e.target.value)} rows={2} />
            </FormField>
          </SectionCard>

          <SectionCard title="Sections"
            subtitle={`${ids.length} of ${book.sections.length} on this document`}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
              {book.sections.map(s => {
                const on = ids.includes(s.id)
                const allowed = offeredTo(s, draft.audience)
                const why = !allowed
                  ? (canAdd(s, draft.audience) as { ok: false; reason: string }).reason
                  : s.locked ? 'Cannot be switched off.' : null
                return (
                  <label key={s.id} title={why ?? undefined} style={{
                    display: 'flex', gap: '10px', alignItems: 'flex-start',
                    padding: '8px 10px', borderRadius: 'var(--radius)',
                    background: on ? 'var(--info-bg)' : 'transparent',
                    opacity: allowed ? 1 : 0.45,
                    cursor: allowed && !s.locked ? 'pointer' : 'not-allowed',
                  }}>
                    <input type="checkbox" checked={on} disabled={!allowed || s.locked}
                      onChange={() => toggle(s)} style={{ marginTop: 3, cursor: 'inherit' }} />
                    <span style={{ minWidth: 0 }}>
                      <span style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--text)' }}>
                        {s.label}
                        {s.locked && <Lock size={11} style={{ marginLeft: 6, verticalAlign: '-1px', color: 'var(--text-tertiary)' }} />}
                      </span>
                      <span style={{ display: 'block', fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
                        {allowed ? s.note : why}
                      </span>
                    </span>
                  </label>
                )
              })}
            </div>
          </SectionCard>

          <SectionCard title="How it is formatted">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 16px' }}>
              <FormField label="Numbering pattern" required
                hint={numbering.ok
                  ? `Tokens: {YYYY}, {YY}, {PARTNER}, {SEQ}. Next document: ${referencePattern(draft)}`
                    + (draft.numbering.includes('{PARTNER}')
                      ? ` — for PTR-1003 that is ${nextReference(draft, { party: 'PTR-1003' })}.`
                      : '')
                  : (numbering as { ok: false; reason: string }).reason}>
                <TextInput value={draft.numbering} onChange={e => set('numbering', e.target.value)}
                  style={numbering.ok ? undefined : { borderColor: 'var(--danger)' }} />
              </FormField>
              <FormField label="Next sequence"
                hint="Where the running number carries on from. Moving it backwards reissues references.">
                <TextInput type="number" min={1} value={draft.next_seq}
                  onChange={e => set('next_seq', Math.max(1, Number(e.target.value) || 1))} />
              </FormField>
              <FormField label="Date format">
                <Select value={draft.date_format} onChange={e => set('date_format', e.target.value)}>
                  {['DD MMM YYYY', 'YYYY-MM-DD', 'MM/DD/YYYY', 'DD/MM/YYYY'].map(f => <option key={f}>{f}</option>)}
                </Select>
              </FormField>
              <FormField label="Currency">
                <TextInput value={draft.currency} onChange={e => set('currency', e.target.value)} />
              </FormField>
              <FormField label="Tax label"
                hint="What the tax line is called on the face of the document.">
                <TextInput value={draft.tax_label} onChange={e => set('tax_label', e.target.value)} />
              </FormField>
              <FormField label="Rounding">
                <Select value={draft.rounding} onChange={e => set('rounding', e.target.value)}>
                  {['Half up, 2 decimal places', 'Half even, 2 decimal places', 'Truncate, 2 decimal places']
                    .map(r => <option key={r}>{r}</option>)}
                </Select>
              </FormField>
              <FormField label="Language">
                <TextInput value={draft.language} onChange={e => set('language', e.target.value)} />
              </FormField>
              <FormField label="Line detail"
                hint="Off prints a totals line rather than the items behind it.">
                <Select value={draft.show_order_lines ? 'on' : 'off'}
                  onChange={e => set('show_order_lines', e.target.value === 'on')}>
                  <option value="on">Itemise every charge</option>
                  <option value="off">Totals only</option>
                </Select>
              </FormField>
            </div>
            <FormField label="Remittance instructions"
              hint="Printed in the How to pay block. Nothing here and that section prints nothing.">
              <TextArea value={draft.remittance} onChange={e => set('remittance', e.target.value)} rows={2} />
            </FormField>
            <FormField label="Footer">
              <TextArea value={draft.footer} onChange={e => set('footer', e.target.value)} rows={2} />
            </FormField>
            <label style={{ display: 'flex', gap: '8px', alignItems: 'center', fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>
              <input type="checkbox" checked={draft.logo} onChange={e => set('logo', e.target.checked)} />
              Print the issuing entity's mark in the masthead
            </label>
          </SectionCard>
        </div>

        {/* ------------------------------------------------------- the document */}
        <div style={{ position: 'sticky', top: '16px', display: 'flex', flexDirection: 'column', gap: '12px', minWidth: 0 }}>
          {!verdict.ok && (
            <Callout tone="danger" title="This cannot be saved yet">{(verdict as { ok: false; reason: string }).reason}</Callout>
          )}
          {verdict.ok && !warnings.length && (
            <Callout tone="success" title="A complete document for this audience">{verdict.note}</Callout>
          )}
          {warnings.map((w, i) => (
            <Callout key={i} tone={w.level === 'warn' ? 'warning' : 'info'}
              title={w.level === 'warn' ? 'Worth a second look' : 'Worth knowing'}>
              {w.text}
            </Callout>
          ))}

          <div>
            <h4 style={{ fontSize: 'var(--text-sm)', fontWeight: 700, color: 'var(--text)', marginBottom: '4px' }}>
              How it comes out
            </h4>
            <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', marginBottom: '10px' }}>
              A real {previewAudience} document, redrawn as you tick a section.
            </p>
            <BillDocument template={draft} ids={ids} facts={facts}
              reference={nextReference(draft, { party: facts?.billedTo.ref ?? undefined })} />
          </div>

          {hidden.length > 0 && (
            <Callout tone="info" title="Ticked, but not on this particular document">
              <ul style={{ margin: '4px 0 0', paddingLeft: '16px' }}>
                {hidden.map(h => (
                  <li key={h.id}>
                    <strong>{book.sections.find(s => s.id === h.id)?.label ?? h.id}</strong> — {h.why}.
                  </li>
                ))}
              </ul>
            </Callout>
          )}
        </div>
      </div>
    </div>
  )
}

/* --------------------------------------------------------- who gets what -- */

function Assignments({ book, onChanged }: { book: BillTemplateBook; onChanged: () => Promise<void> }) {
  const [party, setParty] = useState('')
  const [partyTemplate, setPartyTemplate] = useState('')
  const [why, setWhy] = useState('')

  const act = async (fn: () => Promise<{ ok: boolean; reason?: string; note?: string }>) => {
    const res = await fn()
    if (!res.ok) { toast(res.reason ?? 'That did not work', 'error'); return false }
    toast(res.note ?? 'Saved')
    await onChanged()
    return true
  }

  const defaults = (['consumer', 'enterprise', 'partner'] as Audience[])
  const overrides = book.assignments.filter(a => a.party_id)

  return (
    <>
      <Callout tone="info" title="An exception belongs to one counterparty, not to everybody">
        The default decides what every counterparty in that audience is sent. An override is for the
        case a default cannot serve — one seller registered where the regulator prescribes a format.
        The override wins, and nobody else's document changes.
      </Callout>

      <SectionCard title="Defaults" subtitle="What every counterparty in the audience is sent">
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          {defaults.map(aud => {
            const current = templateFor({ audience: aud }, book.assignments, book.templates)
            const options = book.templates.filter(t => t.audience === aud || t.audience === 'any')
            return (
              <div key={aud} style={{ display: 'grid', gridTemplateColumns: '140px minmax(0,1fr) minmax(0,1.2fr)', gap: '12px', alignItems: 'center' }}>
                <div style={{ fontSize: 'var(--text-sm)', fontWeight: 700, color: 'var(--text)', textTransform: 'capitalize' }}>{aud}</div>
                <Select value={current?.id ?? ''}
                  onChange={e => void act(() => assignTemplate({
                    audience: aud, partyId: null, templateId: e.target.value,
                    why: `Every ${aud}.`, actor: ACTOR,
                  }))}>
                  {!current && <option value="">Not assigned</option>}
                  {options.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                </Select>
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
                  {current
                    ? `${sectionsOn(current, book.sections, book.chosen).length} sections · next ${referencePattern(current)}`
                    : 'Nobody in this audience has a document at all.'}
                </div>
              </div>
            )
          })}
        </div>
      </SectionCard>

      <SectionCard title="Exceptions" subtitle={`${overrides.length} counterpart${overrides.length === 1 ? 'y' : 'ies'} on something other than the default`}>
        <Table headers={['Counterparty', 'Audience', 'Template', 'Why', 'Changed', '']}>
          {overrides.map(a => {
            const t = book.templates.find(x => x.id === a.template_id)
            return (
              <tr key={a.id} style={{ borderBottom: '1px solid var(--border-light)' }}>
                <Td><strong>{a.party_id}</strong></Td>
                <Td>{a.audience}</Td>
                <Td>{t?.name ?? a.template_id}</Td>
                <Td><span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>{a.why}</span></Td>
                <Td>{a.updated_by ? `${a.updated_by} · ${a.updated_on}` : '—'}</Td>
                <Td>
                  <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                    <Btn size="sm" variant="secondary"
                      onClick={() => void act(() => removeOverride({ assignment: a, actor: ACTOR }))}>
                      Remove
                    </Btn>
                  </div>
                </Td>
              </tr>
            )
          })}
        </Table>
        {!overrides.length && <EmptyState message="No exceptions. Every counterparty gets their audience's default." />}

        <div style={{ marginTop: '16px', paddingTop: '16px', borderTop: '1px solid var(--border-light)' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr) minmax(0,1.4fr) auto', gap: '12px', alignItems: 'end' }}>
            <FormField label="Counterparty" hint="A seller or account id, e.g. PTR-1003.">
              <TextInput value={party} onChange={e => setParty(e.target.value.toUpperCase())} placeholder="PTR-1003" />
            </FormField>
            <FormField label="Template">
              <Select value={partyTemplate} onChange={e => setPartyTemplate(e.target.value)}>
                <option value="">Choose one</option>
                {book.templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </Select>
            </FormField>
            <FormField label="Why" hint="An exception without a reason is one nobody dares remove later.">
              <TextInput value={why} onChange={e => setWhy(e.target.value)}
                placeholder="Registered where the regulator prescribes the format." />
            </FormField>
            <div style={{ marginBottom: '16px' }}>
              <Btn disabled={!party.trim() || !partyTemplate || !why.trim()}
                onClick={async () => {
                  const t = book.templates.find(x => x.id === partyTemplate)
                  if (!t) return
                  const audience: Audience = t.audience === 'any'
                    ? (party.startsWith('PTR') ? 'partner' : party.startsWith('ENT') ? 'enterprise' : 'consumer')
                    : t.audience
                  const ok = await act(() => assignTemplate({
                    audience, partyId: party.trim(), templateId: partyTemplate, why, actor: ACTOR,
                  }))
                  if (ok) { setParty(''); setPartyTemplate(''); setWhy('') }
                }}>
                <Plus size={14} style={{ marginRight: 6 }} />Add exception
              </Btn>
            </div>
          </div>
        </div>
      </SectionCard>
    </>
  )
}

/* ------------------------------------------------------- billing identity -- */

function BillingIdentity({ book, onChanged }: { book: BillTemplateBook; onChanged: () => Promise<void> }) {
  const issuer = book.issuer
  const [form, setForm] = useState(() => issuer ? { ...issuer } : null)
  const [saving, setSaving] = useState(false)

  useEffect(() => { setForm(issuer ? { ...issuer } : null) }, [issuer])

  if (!form) return <EmptyState message="No issuing entity on file." />
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm(f => f ? { ...f, [k]: v } : f)

  return (
    <>
      <Callout tone="warning" title="This prints on every document, on every template">
        The parties block and the support block draw from here rather than from the template, so a
        change lands on the next bill every counterparty receives. Documents already issued are
        unaffected — a bill is a snapshot, not a live render.
      </Callout>

      <SectionCard title="Who the bill is from">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 16px' }}>
          <FormField label="Registered legal name" required>
            <TextInput value={form.legal_name} onChange={e => set('legal_name', e.target.value)} />
          </FormField>
          <FormField label="Trading name">
            <TextInput value={form.trading_name} onChange={e => set('trading_name', e.target.value)} />
          </FormField>
          <FormField label="Tax registration label">
            <TextInput value={form.tax_label} onChange={e => set('tax_label', e.target.value)} />
          </FormField>
          <FormField label="Tax registration number" required>
            <TextInput value={form.tax_id} onChange={e => set('tax_id', e.target.value)} />
          </FormField>
          <FormField label="Company registration"
            hint="A different number from the tax one, and finance teams ask for both.">
            <TextInput value={form.company_no ?? ''} onChange={e => set('company_no', e.target.value)} />
          </FormField>
          <FormField label="Bank">
            <TextInput value={form.bank_name} onChange={e => set('bank_name', e.target.value)} />
          </FormField>
        </div>
        <FormField label="Registered address" required
          hint="One line per line, as it should be printed.">
          <TextArea rows={3} value={form.lines.join('\n')}
            onChange={e => set('lines', e.target.value.split('\n'))} />
        </FormField>
        <FormField label="Bank detail">
          <TextInput value={form.bank_detail} onChange={e => set('bank_detail', e.target.value)} />
        </FormField>
      </SectionCard>

      <SectionCard title="Support and disputes"
        subtitle="A bill is where people look when something is wrong with a bill">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 16px' }}>
          <FormField label="Phone">
            <TextInput value={form.support_phone} onChange={e => set('support_phone', e.target.value)} />
          </FormField>
          <FormField label="Hours">
            <TextInput value={form.support_hours} onChange={e => set('support_hours', e.target.value)} />
          </FormField>
          <FormField label="Email">
            <TextInput value={form.support_email} onChange={e => set('support_email', e.target.value)} />
          </FormField>
          <FormField label="Help portal">
            <TextInput value={form.support_portal} onChange={e => set('support_portal', e.target.value)} />
          </FormField>
          <FormField label="Dispute window">
            <TextInput value={form.dispute_window} onChange={e => set('dispute_window', e.target.value)} />
          </FormField>
          <FormField label="Escalation">
            <TextInput value={form.escalation} onChange={e => set('escalation', e.target.value)} />
          </FormField>
        </div>
        <FormField label="Terms" hint="One per line. Numbered on the document in this order.">
          <TextArea rows={4} value={form.terms.join('\n')}
            onChange={e => set('terms', e.target.value.split('\n'))} />
        </FormField>
        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
          <Btn disabled={saving} onClick={async () => {
            setSaving(true)
            const res = await saveIssuer({ issuer: form, actor: ACTOR })
            setSaving(false)
            if (!res.ok) { toast(res.reason, 'error'); return }
            toast(res.note ?? 'Saved')
            await onChanged()
          }}>{saving ? 'Saving…' : 'Save billing identity'}</Btn>
        </div>
      </SectionCard>
    </>
  )
}
