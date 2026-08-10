import { useState, useEffect, useCallback } from 'react'
import { Plus, Trash2, Pencil, ArrowLeft, Eye, EyeOff, Paperclip, X, Check, UserCheck } from 'lucide-react'
import {
  SectionCard, Table, Td, EmptyState, Btn, Modal, FormField, TextInput, TextArea,
  Select, toast, ConfirmDialog, StatCard,
} from './shared'
import { Callout } from '../OnboardingJourney'
import { Pager, usePaging } from '../Pager'
import {
  loadKbAdmin, saveArticle, setArticleStatus, deleteArticle,
  saveFaq, deleteFaq, setAudiences, coverage,
} from '../../lib/kbAdminRepo'
import type { KbAdminBook, ArticleDraft, FaqDraft, KbReader } from '../../lib/kbAdminRepo'
import {
  KB_KINDS, kbKind, PERSONAS, personaLabel, publishedTo, kbWarnings,
  validateArticle, validateFaq, canLink, helpfulness, assetsFor,
} from '../../lib/kb'
import type { KbArticle, KbFaq } from '../../lib/kb'
import { KnowledgeBase } from '../KnowledgeBase'
import type { Persona } from '../../types/view'

/* The operator could read the knowledge base and change none of it: it was
   seeded and then frozen.

   Two things it needed beyond an editor. An article belonged to exactly one
   persona, so "how a refund works" — the same article for a retail customer
   and a business buyer — had to be written twice, which is how two copies of
   one policy drift apart and how the copy nobody remembers to update becomes
   the one somebody reads. Audience is a set.

   And there were no FAQs. An article is four hundred words with a title, a
   summary and a reading time; a frequently asked question is one sentence and
   its answer. Filing the second as the first produces a page of four-hundred-
   word articles called "Can I change my plan mid-month?". */

const ACTOR = 'Anika Sharma'
const READERS = ['consumer', 'enterprise', 'partner', 'operator']

export function OperatorKnowledge() {
  const [book, setBook] = useState<KbAdminBook | null>(null)
  const [tab, setTab] = useState<'articles' | 'faqs' | 'read'>('articles')
  const [editing, setEditing] = useState<KbArticle | 'new' | null>(null)
  const [readAs, setReadAs] = useState<Persona>('operator')

  const reload = useCallback(async () => setBook(await loadKbAdmin()), [])
  useEffect(() => { void reload() }, [reload])

  if (!book) return <div style={{ textAlign: 'center', padding: '40px' }}><div className="spinner" style={{ margin: '0 auto' }} /></div>
  if (book.loadError) return <Callout tone="danger" title="The knowledge base did not load">{book.loadError}</Callout>

  if (editing) {
    return (
      <ArticleEditor
        book={book}
        article={editing === 'new' ? null : editing}
        onDone={async () => { setEditing(null); await reload() }}
        onCancel={() => setEditing(null)}
      />
    )
  }

  const warnings = kbWarnings(book.articles, book.faqs)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '16px', flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontSize: 'var(--text-2xl)', fontWeight: 800, color: 'var(--text)' }}>Knowledge base</h1>
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)', marginTop: '4px', maxWidth: '72ch' }}>
            What each audience can read, and who each piece is published to. One article can be
            published to more than one — the same policy written twice is two policies waiting to
            disagree.
          </p>
        </div>
        {tab === 'articles' && <Btn onClick={() => setEditing('new')}><Plus size={14} style={{ marginRight: 6 }} />New article</Btn>}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: '12px' }}>
        {coverage(book).map(c => (
          <StatCard key={c.persona} label={personaLabel(c.persona)}
            value={`${c.articles} + ${c.faqs}`}
            sublabel={`articles and questions${c.drafts ? ` · ${c.drafts} draft${c.drafts === 1 ? '' : 's'}` : ''}`} />
        ))}
      </div>

      {warnings.map((w, i) => (
        <Callout key={i} tone={w.level === 'warn' ? 'warning' : 'info'}
          title={w.level === 'warn' ? 'Somebody has nothing to read' : 'Worth a look'}>{w.text}</Callout>
      ))}

      <div style={{ display: 'flex', gap: '4px', borderBottom: '1px solid var(--border)', flexWrap: 'wrap' }}>
        {([
          ['articles', `Articles (${book.articles.length})`],
          ['faqs', `FAQs (${book.faqs.length})`],
          ['read', 'Read it'],
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

      {tab === 'articles' && <Articles book={book} onEdit={setEditing} onChanged={reload} />}
      {tab === 'faqs' && <Faqs book={book} onChanged={reload} />}
      {tab === 'read' && <ReadIt book={book} as={readAs} onChangeAs={setReadAs} />}
    </div>
  )
}

/* ------------------------------------------------------------ reading it --- */

/**
 * The operator reading the knowledge base — their own, or somebody else's.
 *
 * This used to be a second entry in the sidebar, "Knowledge base" beside
 * "Manage content", and the split was wrong in both directions: the reading
 * screen could not be edited from, and the editing screen could not be read
 * from, so checking what an article actually looked like meant leaving the
 * editor and coming back. They are one screen and this is its third tab.
 *
 * Reading *as somebody else* is the part that could not be done at all before.
 * An operator publishes to four audiences and could see only their own.
 */
function ReadIt(
  { book, as, onChangeAs }: {
    book: KbAdminBook; as: Persona; onChangeAs: (p: Persona) => void
  },
) {
  /* Somebody to stand in for, when the chosen audience has named readers. The
     operator's own RLS returns every row, so "read as a seller" would otherwise
     show the seller's articles *plus* the ones addressed to other sellers by
     name — a preview that is convincing and wrong. */
  const candidates = book.readers.filter(r => r.persona === as)
  const [asWhom, setAsWhom] = useState<string>('')

  useEffect(() => { setAsWhom('') }, [as])

  /* Which pieces are addressed to somebody by name in this audience — the
     reason to pick a stand-in rather than a detail. */
  const addressed = [...book.articles, ...book.faqs]
    .filter(x => x.personas.includes(as) && (x.audience_ids ?? []).length > 0).length

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
      <SectionCard title="Read it as they do"
        subtitle="The same screen the audience gets, with their articles and their questions.">
        <div style={{ padding: '12px', display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div style={{ minWidth: '220px' }}>
            <FormField label="As">
              <Select value={as} onChange={e => onChangeAs(e.target.value as Persona)}>
                {PERSONAS.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
              </Select>
            </FormField>
          </div>
          {candidates.length > 0 && (
            <div style={{ minWidth: '260px', flex: 1 }}>
              <FormField label="Standing in for"
                hint={addressed > 0
                  ? `${addressed} ${addressed === 1 ? 'piece is' : 'pieces are'} addressed to particular readers here. Pick one to see what they see.`
                  : 'Nothing here is addressed to anybody in particular, so everyone in this audience sees the same thing.'}>
                <Select value={asWhom} onChange={e => setAsWhom(e.target.value)}>
                  <option value="">Nobody in particular</option>
                  {candidates.map(r => <option key={r.id} value={r.id}>{r.name} · {r.id}</option>)}
                </Select>
              </FormField>
            </div>
          )}
        </div>
      </SectionCard>

      {/* Keyed so switching audience remounts rather than showing the previous
          one's articles under the new one's heading while it loads. */}
      <KnowledgeBase
        key={`${as}:${asWhom}`}
        persona={as}
        title={as === 'operator' ? 'Knowledge base' : `${personaLabel(as)} — knowledge base`}
        previewAs={{ persona: as, holderIds: asWhom ? [asWhom] : [] }}
      />
    </div>
  )
}

/* ------------------------------------------------------------- articles --- */

function Articles(
  { book, onEdit, onChanged }: {
    book: KbAdminBook; onEdit: (a: KbArticle) => void; onChanged: () => Promise<void>
  },
) {
  const [who, setWho] = useState('')
  const [q, setQ] = useState('')
  const [removing, setRemoving] = useState<KbArticle | null>(null)

  const shown = book.articles.filter(a => {
    if (who && !a.personas.includes(who)) return false
    if (q && !`${a.title} ${a.summary} ${a.id}`.toLowerCase().includes(q.toLowerCase())) return false
    return true
  })
  const page = usePaging(shown, { resetKey: `${who}:${q}` })

  const act = async (fn: () => Promise<{ ok: boolean; reason?: string; note?: string }>) => {
    const res = await fn()
    if (!res.ok) { toast(res.reason ?? 'That did not work', 'error'); return }
    toast(res.note ?? 'Saved')
    await onChanged()
  }

  return (
    <>
      <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: '220px' }}>
          <TextInput value={q} onChange={e => setQ(e.target.value)} placeholder="Search articles…" />
        </div>
        <div style={{ width: '220px' }}>
          <Select value={who} onChange={e => setWho(e.target.value)}>
            <option value="">Every audience</option>
            {PERSONAS.map(p => <option key={p.id} value={p.id}>Published to {p.label}</option>)}
          </Select>
        </div>
      </div>

      <SectionCard title="Articles" subtitle="Ticking an audience publishes to it immediately — no need to open the editor">
        {shown.length === 0 ? <EmptyState message="Nothing matches that" /> : (
          <Table headers={['Article', 'Kind', 'Published to', 'Files', 'Updated', 'Status', '']}>
            {page.rows.map(a => (
              <tr key={a.id} style={{ borderBottom: '1px solid var(--border-light)' }}>
                <Td>
                  <div style={{ fontWeight: 600 }}>{a.title}</div>
                  <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', maxWidth: '54ch' }}>{a.summary}</div>
                </Td>
                <Td>{kbKind(a.kind).label}</Td>
                <Td>
                  <AudiencePicker
                    personas={a.personas}
                    disabled={false}
                    onChange={next => act(() => setAudiences({
                      kind: 'article', id: a.id, personas: next,
                      current: { status: a.status, title: a.title }, actor: ACTOR,
                    }))}
                  />
                </Td>
                <Td right>
                  {assetsFor(book.assets, a.id).length
                    ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 'var(--text-xs)' }}>
                        <Paperclip size={11} />{assetsFor(book.assets, a.id).length}
                      </span>
                    : <span style={{ color: 'var(--text-tertiary)' }}>—</span>}
                </Td>
                <Td>{a.updated ?? '—'}</Td>
                <Td>
                  <span style={{
                    ...pill,
                    background: a.status === 'published' ? 'var(--success-bg)' : 'var(--bg-alt)',
                    color: a.status === 'published' ? 'var(--success)' : 'var(--text-tertiary)',
                  }}>{a.status === 'published' ? 'live' : 'draft'}</span>
                </Td>
                <Td right>
                  <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end' }}>
                    <Btn size="sm" variant="secondary" onClick={() => onEdit(a)}>
                      <Pencil size={12} style={{ marginRight: 4 }} />Edit
                    </Btn>
                    <Btn size="sm" variant="secondary"
                      onClick={() => act(() => setArticleStatus({
                        article: a, status: a.status === 'published' ? 'held' : 'published', actor: ACTOR,
                      }))}>
                      {a.status === 'published'
                        ? <><EyeOff size={12} style={{ marginRight: 4 }} />Hold</>
                        : <><Eye size={12} style={{ marginRight: 4 }} />Publish</>}
                    </Btn>
                    <Btn size="sm" variant="danger" onClick={() => setRemoving(a)}><Trash2 size={12} /></Btn>
                  </div>
                </Td>
              </tr>
            ))}
          </Table>
        )}
        <Pager page={page} noun="articles" />
      </SectionCard>

      <ConfirmDialog
        open={!!removing}
        onClose={() => setRemoving(null)}
        title={removing ? `Delete ${removing.title}` : ''}
        message="The files attached to it go too. Holding it takes it off every reader's screen without deleting anything — prefer that unless it is genuinely wrong to keep."
        confirmLabel="Delete it" danger
        onConfirm={async () => {
          if (!removing) return
          await act(() => deleteArticle({ article: removing, faqs: book.faqs, actor: ACTOR }))
          setRemoving(null)
        }}
      />
    </>
  )
}

/* ------------------------------------------------------------------ FAQs -- */

function Faqs({ book, onChanged }: { book: KbAdminBook; onChanged: () => Promise<void> }) {
  const [who, setWho] = useState('')
  const [editing, setEditing] = useState<KbFaq | 'new' | null>(null)
  const [removing, setRemoving] = useState<KbFaq | null>(null)

  const shown = book.faqs.filter(f => !who || f.personas.includes(who))
  const page = usePaging(shown, { resetKey: who })

  const act = async (fn: () => Promise<{ ok: boolean; reason?: string; note?: string }>) => {
    const res = await fn()
    if (!res.ok) { toast(res.reason ?? 'That did not work', 'error'); return }
    toast(res.note ?? 'Saved')
    await onChanged()
  }

  return (
    <>
      <Callout tone="info" title="A question is not a short article">
        These appear on their own tab in each audience's knowledge base, grouped by topic. A question
        asked often and rarely found helpful is a question people have and an answer that is not
        answering it — which is the most useful thing this screen can tell you.
      </Callout>

      <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ width: '220px' }}>
          <Select value={who} onChange={e => setWho(e.target.value)}>
            <option value="">Every audience</option>
            {PERSONAS.map(p => <option key={p.id} value={p.id}>Asked by {p.label}</option>)}
          </Select>
        </div>
        <Btn size="sm" style={{ marginLeft: 'auto' }} onClick={() => setEditing('new')}>
          <Plus size={13} style={{ marginRight: 5 }} />New question
        </Btn>
      </div>

      <SectionCard title="Common questions" subtitle={`${shown.length} of ${book.faqs.length}`}>
        {shown.length === 0 ? <EmptyState message="No questions for that audience yet" /> : (
          <Table headers={['Question', 'Topic', 'Asked by', 'Asked', 'Helpful', 'Status', '']}>
            {page.rows.map(f => {
              const rate = helpfulness(f)
              const article = f.article_id ? book.articles.find(a => a.id === f.article_id) : null
              return (
                <tr key={f.id} style={{ borderBottom: '1px solid var(--border-light)' }}>
                  <Td>
                    <div style={{ fontWeight: 600, maxWidth: '46ch' }}>{f.question}</div>
                    <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', maxWidth: '56ch' }}>{f.answer}</div>
                    {article && (
                      <div style={{ fontSize: '11px', color: 'var(--brand-navy)', marginTop: 2 }}>
                        opens {article.title}
                      </div>
                    )}
                  </Td>
                  <Td>{f.topic}</Td>
                  <Td>
                    <AudiencePicker
                      personas={f.personas}
                      disabled={false}
                      onChange={next => act(() => setAudiences({
                        kind: 'faq', id: f.id, personas: next,
                        current: { status: f.status, title: f.question }, actor: ACTOR,
                      }))}
                    />
                  </Td>
                  <Td right>{f.asked.toLocaleString()}</Td>
                  <Td right>
                    {rate === null
                      ? <span style={{ color: 'var(--text-tertiary)' }}>nobody has said</span>
                      : <span style={{ color: rate < 60 ? 'var(--warning)' : 'var(--text)' }}>{rate}%</span>}
                  </Td>
                  <Td>
                    <span style={{
                      ...pill,
                      background: f.status === 'published' ? 'var(--success-bg)' : 'var(--bg-alt)',
                      color: f.status === 'published' ? 'var(--success)' : 'var(--text-tertiary)',
                    }}>{f.status === 'published' ? 'live' : 'draft'}</span>
                  </Td>
                  <Td right>
                    <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end' }}>
                      <Btn size="sm" variant="secondary" onClick={() => setEditing(f)}><Pencil size={12} /></Btn>
                      <Btn size="sm" variant="danger" onClick={() => setRemoving(f)}><Trash2 size={12} /></Btn>
                    </div>
                  </Td>
                </tr>
              )
            })}
          </Table>
        )}
        <Pager page={page} noun="questions" />
      </SectionCard>

      {editing && (
        <FaqModal
          book={book}
          faq={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={async () => { setEditing(null); await onChanged() }}
        />
      )}

      <ConfirmDialog
        open={!!removing}
        onClose={() => setRemoving(null)}
        title="Delete this question"
        message={removing
          ? `It has been asked ${removing.asked.toLocaleString()} times. Deleting it does not stop people asking — it stops them finding the answer.`
          : ''}
        confirmLabel="Delete it" danger
        onConfirm={async () => {
          if (!removing) return
          await act(() => deleteFaq({ faq: removing, actor: ACTOR }))
          setRemoving(null)
        }}
      />
    </>
  )
}

/* --------------------------------------------------------------- pieces --- */

/**
 * The audience checkboxes.
 *
 * Inline on the row rather than behind the editor, because widening an article
 * to a second audience is by a long way the most common edit here — and making
 * somebody open a form to tick one box is how they copy the article instead.
 */
function AudiencePicker(
  { personas, onChange, disabled }: {
    personas: string[]; onChange: (next: string[]) => void; disabled: boolean
  },
) {
  return (
    <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
      {READERS.map(p => {
        const on = personas.includes(p)
        return (
          <button key={p} disabled={disabled}
            title={personaLabel(p)}
            onClick={() => onChange(on ? personas.filter(x => x !== p) : [...personas, p])}
            style={{
              padding: '2px 8px', borderRadius: 'var(--radius-full)',
              fontSize: '10px', fontWeight: 700, cursor: disabled ? 'not-allowed' : 'pointer',
              border: `1px solid ${on ? 'var(--brand-navy)' : 'var(--border)'}`,
              background: on ? 'var(--brand-navy)' : 'white',
              color: on ? 'white' : 'var(--text-tertiary)',
            }}>
            {personaLabel(p).split(' ')[0]}
          </button>
        )
      })}
    </div>
  )
}

/**
 * Naming the specific readers something is for.
 *
 * Narrows the personas above it rather than replacing them, so the list only
 * offers people who are in one of those personas — offering a retail customer
 * on an article published to sellers would let somebody build the one
 * combination that reaches nobody, which the database refuses anyway.
 *
 * Empty is the normal case and says so out loud. "Nobody selected" reads as a
 * mistake unless the screen tells you it means everybody.
 */
function ReaderPicker(
  { readers, personas, chosen, onChange, disabled }: {
    readers: readonly KbReader[]
    personas: readonly string[]
    chosen: readonly string[]
    onChange: (next: string[]) => void
    disabled?: boolean
  },
) {
  const [q, setQ] = useState('')

  const eligible = readers.filter(r => personas.includes(r.persona))
  const needle = q.trim().toLowerCase()
  const shown = needle
    ? eligible.filter(r => r.name.toLowerCase().includes(needle) || r.id.toLowerCase().includes(needle))
    : eligible.slice(0, 8)

  /* A chosen reader who is no longer eligible — because the persona was
     unticked after they were picked — is still shown, or it would silently
     stay on the record while disappearing from the screen. */
  const orphans = chosen.filter(id => !eligible.some(r => r.id === id))

  const toggle = (id: string) =>
    onChange(chosen.includes(id) ? chosen.filter(x => x !== id) : [...chosen, id])

  if (personas.length === 0) {
    return (
      <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', margin: 0 }}>
        Tick an audience above first — a named reader has to be somebody in one of them.
      </p>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', margin: 0, lineHeight: 1.5 }}>
        {chosen.length === 0
          ? `Nobody named, so this reaches every one of ${personas.map(personaLabel).join(' and ')}. Name somebody to narrow it to them alone.`
          : `Only these ${chosen.length} will see it. Everyone else in ${personas.map(personaLabel).join(' and ')} will not.`}
      </p>

      {chosen.length > 0 && (
        <div style={{ display: 'flex', gap: '5px', flexWrap: 'wrap' }}>
          {chosen.map(id => {
            const r = readers.find(x => x.id === id)
            const orphaned = orphans.includes(id)
            return (
              <button key={id} disabled={disabled} onClick={() => toggle(id)}
                title={orphaned ? 'Not in any audience ticked above — this would reach nobody' : 'Remove'}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: '5px',
                  padding: '3px 9px', borderRadius: 'var(--radius-full)',
                  border: `1px solid ${orphaned ? 'var(--danger)' : 'var(--brand-navy)'}`,
                  background: orphaned ? 'var(--danger-bg)' : 'var(--brand-navy)',
                  color: orphaned ? 'var(--danger)' : 'white',
                  fontSize: '11px', fontWeight: 700, cursor: 'pointer',
                }}>
                {r?.name ?? id} <X size={10} />
              </button>
            )
          })}
        </div>
      )}

      <TextInput value={q} onChange={e => setQ(e.target.value)}
                 placeholder={`Search ${eligible.length} readers by name or id…`} />

      <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', maxHeight: '190px', overflowY: 'auto' }}>
        {shown.length === 0 && (
          <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>Nobody matches that.</span>
        )}
        {shown.map(r => {
          const on = chosen.includes(r.id)
          return (
            <button key={r.id} disabled={disabled} onClick={() => toggle(r.id)}
              style={{
                display: 'flex', alignItems: 'center', gap: '9px', width: '100%',
                padding: '6px 9px', textAlign: 'left', cursor: 'pointer',
                border: `1px solid ${on ? 'var(--brand-navy)' : 'var(--border-light)'}`,
                borderRadius: 'var(--radius-sm)', background: on ? 'var(--bg-alt)' : 'white',
              }}>
              <span style={{ width: 13, flexShrink: 0, color: 'var(--brand-navy)' }}>
                {on && <Check size={13} />}
              </span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: 'block', fontSize: 'var(--text-xs)', fontWeight: 700 }}>{r.name}</span>
                <span style={{ display: 'block', fontSize: '10px', color: 'var(--text-tertiary)' }}>
                  {personaLabel(r.persona)} · {r.note}
                </span>
              </span>
            </button>
          )
        })}
        {!needle && eligible.length > shown.length && (
          <span style={{ fontSize: '10px', color: 'var(--text-tertiary)', padding: '4px 9px' }}>
            {eligible.length - shown.length} more — search to find them.
          </span>
        )}
      </div>
    </div>
  )
}

function blankArticle(): ArticleDraft {
  return {
    title: '', summary: '', kind: 'howto', personas: [], audience_ids: [], status: 'held',
    mins: 3, tags: [], view: null, roles: [], body: [['', '']], audience_note: '',
  }
}

function ArticleEditor(
  { book, article, onDone, onCancel }: {
    book: KbAdminBook; article: KbArticle | null
    onDone: () => Promise<void>; onCancel: () => void
  },
) {
  const [draft, setDraft] = useState<ArticleDraft>(() =>
    /* `audience_ids` defaulted rather than spread blindly: a row written before
       the column existed comes back without it, and an undefined array is a
       crash in every `.length` and `.includes` below. */
    article ? { ...(article as unknown as ArticleDraft), audience_ids: article.audience_ids ?? [] } : blankArticle())
  const [saving, setSaving] = useState(false)

  const set = <K extends keyof ArticleDraft>(k: K, v: ArticleDraft[K]) => setDraft(d => ({ ...d, [k]: v }))
  const verdict = validateArticle(draft)
  const pointing = article ? book.faqs.filter(f => f.article_id === article.id) : []

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
        <Btn variant="secondary" size="sm" onClick={onCancel}><ArrowLeft size={13} style={{ marginRight: 5 }} />Back</Btn>
        <h2 style={{ fontSize: 'var(--text-xl)', fontWeight: 800 }}>{article ? article.title : 'New article'}</h2>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: '8px' }}>
          <Btn variant="secondary" size="sm" onClick={onCancel}>Cancel</Btn>
          <Btn size="sm" disabled={saving || !verdict.ok} onClick={async () => {
            setSaving(true)
            const res = await saveArticle({ id: article?.id ?? null, draft, actor: ACTOR })
            setSaving(false)
            if (!res.ok) { toast(res.reason, 'error'); return }
            toast(res.note ?? 'Saved')
            await onDone()
          }}>{saving ? 'Saving…' : article ? 'Save' : 'Create it'}</Btn>
        </div>
      </div>

      {!verdict.ok
        ? <Callout tone="danger" title="This cannot be saved yet">{(verdict as { ok: false; reason: string }).reason}</Callout>
        : <Callout tone="success" title="Who will read this">{verdict.note}</Callout>}

      {pointing.length > 0 && (
        <Callout tone="info" title={`${pointing.length} question${pointing.length === 1 ? '' : 's'} open${pointing.length === 1 ? 's' : ''} this article`}>
          {pointing.map(f => f.question).join(' · ')}. Narrowing the audience here can leave those
          questions pointing at a door their readers cannot walk through.
        </Callout>
      )}

      <SectionCard pad title="What it says">
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: '0 16px' }}>
          <FormField label="Title" required>
            <TextInput value={draft.title} onChange={e => set('title', e.target.value)} />
          </FormField>
          <FormField label="Kind">
            <Select value={draft.kind} onChange={e => set('kind', e.target.value)}>
              {KB_KINDS.map(k => <option key={k.id} value={k.id}>{k.label}</option>)}
            </Select>
          </FormField>
          <FormField label="Reading time, in minutes">
            <TextInput type="number" min={1} value={draft.mins}
              onChange={e => set('mins', Math.max(1, Number(e.target.value) || 1))} />
          </FormField>
        </div>
        <FormField label="Summary" required hint="The line under the title. An article nobody can tell apart from its neighbours is an article nobody opens.">
          <TextArea rows={2} value={draft.summary} onChange={e => set('summary', e.target.value)} />
        </FormField>
        <FormField label="Topics" hint="Comma separated. Used by the reader's topic filter.">
          <TextInput value={draft.tags.join(', ')}
            onChange={e => set('tags', e.target.value.split(',').map(t => t.trim()).filter(Boolean))} />
        </FormField>
      </SectionCard>

      <SectionCard pad title="Who it is published to"
        subtitle="One article can be the same article for two audiences. Writing it twice is how two copies of one policy drift apart.">
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
          {PERSONAS.map(p => {
            const on = draft.personas.includes(p.id)
            return (
              <label key={p.id} style={{
                display: 'flex', gap: '10px', alignItems: 'flex-start',
                padding: '8px 10px', borderRadius: 'var(--radius)',
                background: on ? 'var(--info-bg)' : 'transparent', cursor: 'pointer',
              }}>
                <input type="checkbox" checked={on} style={{ marginTop: 3 }}
                  onChange={() => set('personas', on
                    ? draft.personas.filter(x => x !== p.id)
                    : [...draft.personas, p.id])} />
                <span>
                  <span style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--text)' }}>{p.label}</span>
                  <span style={{ display: 'block', fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>{p.note}</span>
                </span>
              </label>
            )
          })}
        </div>
        {/* Narrowing, not a second audience. The two conditions are ANDed here
            and in the database, so somebody named who is not in a ticked
            audience is somebody the article reaches nobody through. */}
        <div style={{ marginTop: '14px', paddingTop: '14px', borderTop: '1px solid var(--border-light)' }}>
          <FormField label="Anybody in particular?"
            hint="Leave empty for everybody in the audiences above. Name readers to address it to them alone.">
            <ReaderPicker
              readers={book.readers}
              personas={draft.personas}
              chosen={draft.audience_ids}
              onChange={next => set('audience_ids', next)}
            />
          </FormField>
        </div>

        <div style={{ marginTop: '14px' }}>
          <FormField label="Status">
            <Select value={draft.status} onChange={e => set('status', e.target.value as ArticleDraft['status'])}>
              <option value="held">Draft — nobody sees it</option>
              <option value="published">Published — live for the audiences above</option>
            </Select>
          </FormField>
          <FormField label="A note about the audience"
            hint="Why it is written for these readers and not others. For whoever inherits it.">
            <TextInput value={draft.audience_note} onChange={e => set('audience_note', e.target.value)} />
          </FormField>
        </div>
      </SectionCard>

      <SectionCard pad title="The article itself" subtitle="A heading and its prose, in order">
        {draft.body.map((pair, i) => (
          <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 2.4fr auto', gap: '10px', alignItems: 'start', marginBottom: '10px' }}>
            <TextInput value={pair[0]} placeholder="Heading"
              onChange={e => set('body', draft.body.map((b, j) => j === i ? [e.target.value, b[1]] : b))} />
            <TextArea rows={3} value={pair[1]} placeholder="Prose"
              onChange={e => set('body', draft.body.map((b, j) => j === i ? [b[0], e.target.value] : b))} />
            <Btn size="sm" variant="secondary" disabled={draft.body.length === 1}
              onClick={() => set('body', draft.body.filter((_, j) => j !== i))}>
              <Trash2 size={12} />
            </Btn>
          </div>
        ))}
        <Btn size="sm" variant="secondary" onClick={() => set('body', [...draft.body, ['', '']])}>
          <Plus size={13} style={{ marginRight: 5 }} />Add a section
        </Btn>
      </SectionCard>
    </div>
  )
}

function FaqModal(
  { book, faq, onClose, onSaved }: {
    book: KbAdminBook; faq: KbFaq | null; onClose: () => void; onSaved: () => Promise<void>
  },
) {
  const [draft, setDraft] = useState<FaqDraft>(() => faq
    ? { question: faq.question, answer: faq.answer, personas: faq.personas, audience_ids: faq.audience_ids ?? [], topic: faq.topic, status: faq.status, article_id: faq.article_id }
    : { question: '', answer: '', personas: [], audience_ids: [], topic: 'General', status: 'held', article_id: null })
  const [saving, setSaving] = useState(false)

  const set = <K extends keyof FaqDraft>(k: K, v: FaqDraft[K]) => setDraft(d => ({ ...d, [k]: v }))
  const verdict = validateFaq(draft)
  const target = draft.article_id ? book.articles.find(a => a.id === draft.article_id) : null
  const link = target ? canLink(draft, target) : { ok: true as const }

  return (
    <Modal open onClose={onClose} title={faq ? 'Edit question' : 'New question'}
      footer={<>
        <Btn variant="secondary" size="sm" onClick={onClose}>Cancel</Btn>
        <Btn size="sm" disabled={saving || !verdict.ok || !link.ok} onClick={async () => {
          setSaving(true)
          const res = await saveFaq({ id: faq?.id ?? null, draft, articles: book.articles, actor: ACTOR })
          setSaving(false)
          if (!res.ok) { toast(res.reason, 'error'); return }
          toast(res.note ?? 'Saved')
          await onSaved()
        }}>{saving ? 'Saving…' : 'Save'}</Btn>
      </>}>
      <FormField label="The question" required hint="As a reader would ask it, ending in a question mark.">
        <TextInput value={draft.question} onChange={e => set('question', e.target.value)}
          placeholder="Can I change my plan in the middle of a month?" />
      </FormField>
      <FormField label="The answer" required>
        <TextArea rows={4} value={draft.answer} onChange={e => set('answer', e.target.value)} />
      </FormField>
      <div style={{ display: 'flex', gap: '12px' }}>
        <div style={{ flex: 1 }}>
          <FormField label="Topic" hint="Questions are grouped by this on the reader's tab.">
            <TextInput value={draft.topic} onChange={e => set('topic', e.target.value)} />
          </FormField>
        </div>
        <div style={{ flex: 1 }}>
          <FormField label="Status">
            <Select value={draft.status} onChange={e => set('status', e.target.value as FaqDraft['status'])}>
              <option value="held">Draft</option>
              <option value="published">Published</option>
            </Select>
          </FormField>
        </div>
      </div>

      <FormField label="Asked by" hint="It appears on the FAQ tab of everyone ticked.">
        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
          {PERSONAS.map(p => {
            const on = draft.personas.includes(p.id)
            return (
              <button key={p.id} onClick={() => set('personas', on
                ? draft.personas.filter(x => x !== p.id)
                : [...draft.personas, p.id])}
                style={{
                  padding: '5px 12px', borderRadius: 'var(--radius-full)',
                  fontSize: 'var(--text-xs)', fontWeight: 600, cursor: 'pointer',
                  border: `1px solid ${on ? 'var(--brand-navy)' : 'var(--border)'}`,
                  background: on ? 'var(--brand-navy)' : 'white',
                  color: on ? 'white' : 'var(--text-secondary)',
                }}>{p.label}</button>
            )
          })}
        </div>
      </FormField>

      <FormField label="Anybody in particular?"
        hint="Leave empty and every one of them sees it. Name readers and only they do.">
        <ReaderPicker
          readers={book.readers}
          personas={draft.personas}
          chosen={draft.audience_ids}
          onChange={next => set('audience_ids', next)}
        />
      </FormField>

      <FormField label="Opens an article"
        hint="When the real answer is longer than a paragraph, the question is the doorway to it.">
        <Select value={draft.article_id ?? ''} onChange={e => set('article_id', e.target.value || null)}>
          <option value="">Nothing — the answer above is the answer</option>
          {book.articles.map(a => (
            <option key={a.id} value={a.id}>
              {a.title}{a.status === 'held' ? ' (draft)' : ''}
            </option>
          ))}
        </Select>
      </FormField>

      {!verdict.ok && <Callout tone="danger" title="This cannot be saved yet">{(verdict as { ok: false; reason: string }).reason}</Callout>}
      {verdict.ok && !link.ok && <Callout tone="danger" title="That link would not work">{(link as { ok: false; reason: string }).reason}</Callout>}
      {verdict.ok && link.ok && <Callout tone="success" title="Who will see this">{verdict.note}</Callout>}
    </Modal>
  )
}

const pill: React.CSSProperties = {
  padding: '2px 9px', borderRadius: 'var(--radius-full)',
  fontSize: '10px', fontWeight: 700,
}
