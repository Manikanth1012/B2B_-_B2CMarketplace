import { useState, useEffect, useCallback } from 'react'
import { ChevronLeft, Clock, Paperclip, TriangleAlert as AlertTriangle } from 'lucide-react'
import { SectionCard, EmptyState, Btn, TextInput, Select, Modal, FormField, TextArea, toast } from './operator/shared'
import { loadKb, raiseContentFeedback } from '../lib/kbRepo'
import type { KbSnapshot } from '../lib/kbRepo'
import { KB_KINDS, kbKind, filterArticles, allTags, canAct, assetsFor } from '../lib/kb'
import type { KbArticle } from '../lib/kb'
import { KbAssets } from './KbAssets'
import type { Persona } from '../types/view'

export function KnowledgeBase({ persona, title, myRole = null, feedbackAs }: {
  persona: Persona
  title: string
  /* Not yet supplied by any caller — App.tsx renders all four consoles without it, and
     Session (src/types/view.ts) carries no current-role field to source it from. Until
     that plumbing exists this is always null, so canAct() always returns true and the
     "you can read this, but performing it needs role X" banner below is unreachable. */
  myRole?: string | null
  /* Omitted for the operator: they are the queue. */
  feedbackAs?: { actor: string; org: string }
}) {
  const [snap, setSnap] = useState<KbSnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [kind, setKind] = useState('')
  const [tag, setTag] = useState('')
  const [q, setQ] = useState('')
  const [open, setOpen] = useState<KbArticle | null>(null)
  const [fbFor, setFbFor] = useState<KbArticle | null>(null)
  const [note, setNote] = useState('')

  const load = useCallback(async () => { setSnap(await loadKb(persona)) }, [persona])
  useEffect(() => { load().then(() => setLoading(false)) }, [load])

  if (loading || !snap) {
    return <div style={{ textAlign: 'center', padding: '40px' }}><div className="spinner" style={{ margin: '0 auto' }} /></div>
  }

  if (snap.loadError) {
    return (
      <div style={{ padding: '16px', borderRadius: 'var(--radius-md)', background: 'var(--danger-bg)', border: '1px solid var(--danger)', color: 'var(--danger)' }}>
        <strong>The knowledge base could not be loaded.</strong>
        <div style={{ fontSize: 'var(--text-sm)', marginTop: '4px' }}>{snap.loadError}</div>
      </div>
    )
  }

  /* ---------- Reader ---------- */
  if (open) {
    const actionable = canAct(open, myRole)
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        <Btn variant="secondary" size="sm" onClick={() => setOpen(null)}><ChevronLeft size={14} /> Back to {title}</Btn>
        <SectionCard title={open.title} subtitle={open.summary}>
          <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '18px' }}>
            <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap', fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>
              <span className="pill">{kbKind(open.kind).label}</span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}><Clock size={12} /> {open.mins} min read</span>
              {open.updated && <span>Reviewed {open.updated}</span>}
              {open.tags.map(t => <span key={t} className="pill">{t}</span>)}
            </div>

            {!actionable && (
              <div style={{ padding: '12px', borderRadius: 'var(--radius-md)', background: 'var(--warning-bg)', border: '1px solid var(--warning)', fontSize: 'var(--text-sm)', color: 'var(--text)' }}>
                <AlertTriangle size={14} style={{ verticalAlign: '-2px', marginRight: '6px' }} />
                You can read this, but performing it needs one of: {open.roles.join(', ')}.
              </div>
            )}

            {open.body.map(([heading, prose], i) => (
              <div key={i}>
                <div style={{ fontSize: 'var(--text-sm)', fontWeight: 700, marginBottom: '4px' }}>{heading}</div>
                <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', lineHeight: 1.65 }}>{prose}</p>
              </div>
            ))}

            <KbAssets assets={assetsFor(snap.assets, open.id)} />

            {feedbackAs && (
              <div style={{ borderTop: '1px solid var(--border-light)', paddingTop: '14px' }}>
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', marginBottom: '8px' }}>
                  Wrong, missing or unclear? Tell us — the articles that fail are the ones worth finding.
                </div>
                <Btn size="sm" variant="secondary" onClick={() => { setFbFor(open); setNote('') }}>This did not answer my question</Btn>
              </div>
            )}

          </div>
        </SectionCard>

        <Modal open={!!fbFor} onClose={() => setFbFor(null)} title="Tell us what is wrong"
          footer={<>
            <Btn variant="secondary" size="sm" onClick={() => setFbFor(null)}>Cancel</Btn>
            <Btn size="sm" onClick={async () => {
              if (!fbFor || !feedbackAs) return
              const res = await raiseContentFeedback({ article: fbFor, actor: feedbackAs.actor, org: feedbackAs.org, note })
              if (!res.ok) { toast(res.reason, 'error'); return }
              setFbFor(null)
              toast(`Thanks — logged as ${res.ticketId}. We review content feedback separately from support.`)
            }}>Send</Btn>
          </>}>
          <FormField label={`About: ${fbFor?.title ?? ''}`} required>
            <TextArea value={note} onChange={e => setNote(e.target.value)} placeholder="What did you expect to find?" />
          </FormField>
          <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>
            This goes to the team that maintains these articles, not to support. You will get a reference, not a case to track.
          </p>
        </Modal>
      </div>
    )
  }

  /* ---------- List ---------- */
  const shown = filterArticles(snap.articles, { kind: kind || undefined, tag: tag || undefined, q })
  const tags = allTags(snap.articles)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div>
        <h1 style={{ fontSize: 'var(--text-2xl)', fontWeight: 800, color: 'var(--text)' }}>{title}</h1>
        <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', marginTop: '4px' }}>
          {snap.articles.length} articles · what this console does and why the rules are the way they are
        </p>
      </div>

      <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: '220px' }}>
          <TextInput value={q} onChange={e => setQ(e.target.value)} placeholder="Search articles…" />
        </div>
        <div style={{ width: '180px' }}>
          <Select value={kind} onChange={e => setKind(e.target.value)}>
            <option value="">All kinds</option>
            {KB_KINDS.map(k => <option key={k.id} value={k.id}>{k.label}</option>)}
          </Select>
        </div>
        <div style={{ width: '180px' }}>
          <Select value={tag} onChange={e => setTag(e.target.value)}>
            <option value="">All topics</option>
            {tags.map(t => <option key={t} value={t}>{t}</option>)}
          </Select>
        </div>
      </div>

      <SectionCard title="Articles" subtitle={shown.length === snap.articles.length ? undefined : `${shown.length} of ${snap.articles.length} shown`}>
        {shown.length === 0 ? <EmptyState message="Nothing matches that search" /> : (
          <div style={{ padding: '12px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {shown.map(a => (
              <button key={a.id} onClick={() => setOpen(a)} style={{
                textAlign: 'left', padding: '14px', borderRadius: 'var(--radius-md)',
                border: '1px solid var(--border)', background: 'white', cursor: 'pointer',
              }}>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '4px' }}>
                  <span className="pill">{kbKind(a.kind).label}</span>
                  <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>{a.mins} min</span>
                  {/* Which articles carry a manual or a video, without opening
                      each one to find out. */}
                  {assetsFor(snap.assets, a.id).length > 0 && (
                    <span style={{
                      display: 'inline-flex', alignItems: 'center', gap: '4px',
                      fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--brand-accent-dark)',
                    }}>
                      <Paperclip size={11} />
                      {assetsFor(snap.assets, a.id).length} download{assetsFor(snap.assets, a.id).length === 1 ? '' : 's'}
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 'var(--text-sm)', fontWeight: 700, color: 'var(--text)' }}>{a.title}</div>
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', marginTop: '2px' }}>{a.summary}</div>
              </button>
            ))}
          </div>
        )}
      </SectionCard>
    </div>
  )
}
