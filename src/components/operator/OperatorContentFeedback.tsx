import { useState, useEffect, useCallback } from 'react'
import { MessageSquareWarning, ThumbsUp, ThumbsDown, FileText } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import {
  SectionCard, EmptyState, Btn, Modal, FormField, TextArea, Select,
  Table, Td, toast, fmtDate, StatCard,
} from './shared'
import { Callout } from '../OnboardingJourney'
import {
  summarise, bySurface, themes, byPersona, triage, canClose, REASONS, SURFACE_LABEL,
} from '../../lib/contentFeedback'
import type { Feedback, FeedbackState } from '../../lib/contentFeedback'

/* Reader feedback on the marketplace's own words. Never published — it is a
   work queue for whoever owns the content, which is the whole difference
   between this and a product review.

   The useful output is not a satisfaction score. It is which page is failing,
   for whom, and in what way: three facts that together make a ticket somebody
   can pick up, where a percentage makes none. */

const ACTOR = 'Content desk'

const STATE_INK: Record<FeedbackState, string> = {
  new: 'var(--warning)', triaged: 'var(--info, #2a78d6)',
  actioned: 'var(--success)', declined: 'var(--text-tertiary)',
}

export function OperatorContentFeedback() {
  const [items, setItems] = useState<Feedback[] | null>(null)
  const [titles, setTitles] = useState<Record<string, string>>({})
  const [deciding, setDeciding] = useState<Feedback | null>(null)
  const [openOnly, setOpenOnly] = useState(true)

  const reload = useCallback(async () => {
    const [f, kb, cat, prod] = await Promise.all([
      supabase.from('content_feedback').select('*').order('sort_order'),
      supabase.from('kb_articles').select('id,title'),
      supabase.from('categories').select('id,name'),
      supabase.from('products').select('id,name'),
    ])
    setItems((f.data ?? []) as Feedback[])
    setTitles(Object.fromEntries([
      ...((kb.data ?? []) as { id: string; title: string }[]).map(a => [a.id, a.title]),
      ...((cat.data ?? []) as { id: string; name: string }[]).map(c => [c.id, c.name]),
      ...((prod.data ?? []) as { id: string; name: string }[]).map(p => [p.id, p.name]),
    ]))
  }, [])

  useEffect(() => { void reload() }, [reload])

  if (!items) return <div style={{ textAlign: 'center', padding: '40px' }}><div className="spinner" style={{ margin: '0 auto' }} /></div>

  const nameOf = (ref: string) => titles[ref] ?? ref
  const stats = summarise(items)
  const surfaces = bySurface(items)
  const themeRows = themes(items)
  const personas = byPersona(items)
  const shown = triage(openOnly ? items.filter(f => f.state === 'new' || f.state === 'triaged') : items)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div>
        <h1 style={{ fontSize: 'var(--text-2xl)', fontWeight: 800, color: 'var(--text)' }}>Content feedback</h1>
        <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)', marginTop: '4px' }}>
          What readers say about the marketplace's own words — help articles, marketplace pages,
          product descriptions and banner copy
        </p>
      </div>

      <Callout tone="info">
        This is not a review queue. A review is a buyer's opinion of something a seller sells, and it gets
        published. This is a reader's opinion of something we wrote, and it never does — it is a work list
        for whoever owns the page. Closing an item asks what changed, because a disposition with no account
        of it is a status somebody set to make a number go down.
      </Callout>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px' }}>
        <StatCard label="Awaiting a decision" value={String(stats.awaiting)}
                  sublabel="Undecided, oldest and most misleading first"
                  color={stats.awaiting > 0 ? 'var(--warning)' : undefined} />
        <StatCard label="Found it helpful"
                  value={stats.helpfulPct === null ? '—' : `${stats.helpfulPct}%`}
                  sublabel={`${stats.helpful} of ${stats.total} responses`} />
        <StatCard label="Pages with complaints" value={String(surfaces.filter(s => s.unhelpful > 0).length)}
                  sublabel="Ranked by how many readers each let down" />
        <StatCard label="Fixed" value={String(stats.actioned)}
                  sublabel="Closed with a note saying what changed" color="var(--success)" />
      </div>

      {/* Who is unhappy. Sellers are the ones nobody usually asks and the ones
          who read the same six pages until they are fluent. */}
      <SectionCard title="By whose eyes" subtitle="The same page fails different readers differently">
        <div style={{ padding: '14px 20px', display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
          {personas.map(p => (
            <div key={p.persona} style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: '11px 14px', minWidth: '190px' }}>
              <div style={{ fontSize: 'var(--text-xs)', fontWeight: 800, textTransform: 'capitalize' }}>{p.persona}</div>
              <div style={{ fontSize: 'var(--text-lg)', fontWeight: 800, color: (p.helpfulPct ?? 100) < 40 ? 'var(--danger)' : 'var(--text)' }}>
                {p.helpfulPct === null ? '—' : `${p.helpfulPct}% helpful`}
              </div>
              <div style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>
                {p.total} response{p.total === 1 ? '' : 's'} · {p.awaiting} awaiting
              </div>
            </div>
          ))}
        </div>
      </SectionCard>

      {themeRows.length > 0 && (
        <SectionCard title="What is actually wrong"
                     subtitle="Themes across every complaint, with what each one implies about the fix">
          <div style={{ padding: '14px 20px', display: 'flex', flexDirection: 'column', gap: '9px' }}>
            {themeRows.map(t => (
              <div key={t.reason} style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: '11px 13px' }}>
                <div style={{ display: 'flex', gap: '9px', alignItems: 'baseline', flexWrap: 'wrap' }}>
                  <strong style={{ fontSize: 'var(--text-sm)' }}>{t.label}</strong>
                  <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-secondary)' }}>
                    {t.count} of the complaints ({t.pct}%)
                  </span>
                  <span style={{ fontSize: '10px', color: 'var(--text-tertiary)', marginLeft: 'auto' }}>
                    {t.surfaces.map(s => SURFACE_LABEL[s]).join(' · ')}
                  </span>
                </div>
                <div style={{ marginTop: '4px', height: '5px', borderRadius: '3px', background: 'var(--border-light)', overflow: 'hidden' }}>
                  <div style={{ width: `${t.pct}%`, height: '100%', background: 'var(--brand-navy)' }} />
                </div>
                <p style={{ fontSize: '11px', color: 'var(--text-secondary)', margin: '5px 0 0' }}>{t.fix}</p>
              </div>
            ))}
          </div>
        </SectionCard>
      )}

      <SectionCard title="Which content is failing"
                   subtitle="Ranked by readers let down, not by percentage — one unhappy reader out of one is 0% and is not the problem">
        <Table headers={['Content', 'Type', 'Responses', 'Complaints', 'Helpful', 'Read by', 'Commonest complaint', 'Open']}>
          {surfaces.slice(0, 12).map(s => (
            <tr key={`${s.surface}-${s.ref}`}>
              <Td>
                <div style={{ fontSize: 'var(--text-xs)', fontWeight: 700 }}>{nameOf(s.ref)}</div>
                <div style={{ fontSize: '10px', color: 'var(--text-tertiary)' }}>{s.ref}</div>
              </Td>
              <Td><span style={{ fontSize: '11px' }}>{SURFACE_LABEL[s.surface]}</span></Td>
              <Td right>{s.total}</Td>
              <Td right>
                <span style={{ fontWeight: 700, color: s.unhelpful > 1 ? 'var(--danger)' : 'var(--text)' }}>{s.unhelpful}</span>
              </Td>
              <Td right>{s.helpfulPct === null ? '—' : `${s.helpfulPct}%`}</Td>
              <Td><span style={{ fontSize: '10px', color: 'var(--text-tertiary)' }}>{s.personas.join(', ')}</span></Td>
              <Td>
                <span style={{ fontSize: '10px', color: s.topReason ? 'var(--text-secondary)' : 'var(--text-tertiary)' }}>
                  {s.topReason ? REASONS[s.topReason].label : 'None'}
                </span>
              </Td>
              <Td right>{s.awaiting === 0 ? '—' : s.awaiting}</Td>
            </tr>
          ))}
        </Table>
      </SectionCard>

      <SectionCard
        title={openOnly ? `The queue (${shown.length})` : `Everything (${shown.length})`}
        subtitle="Undecided first, then whichever misleads readers most, then whoever has waited longest"
        action={
          <label style={{ display: 'flex', gap: '6px', alignItems: 'center', fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', cursor: 'pointer' }}>
            <input type="checkbox" checked={openOnly} onChange={e => setOpenOnly(e.target.checked)} />
            Only what is still open
          </label>
        }>
        {shown.length === 0 ? <EmptyState message="Nothing outstanding" /> : (
          <div style={{ padding: '14px 20px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {shown.map(f => (
              <div key={f.id} style={{
                border: `1px solid ${f.state === 'new' ? 'var(--warning)' : 'var(--border)'}`,
                borderRadius: 'var(--radius-md)', overflow: 'hidden',
              }}>
                <div style={{
                  display: 'flex', gap: '9px', alignItems: 'center', padding: '9px 12px', flexWrap: 'wrap',
                  background: f.state === 'new' ? 'var(--warning-bg)' : 'var(--bg-alt)',
                  borderBottom: '1px solid var(--border-light)',
                }}>
                  {f.helpful
                    ? <ThumbsUp size={13} style={{ color: 'var(--success)' }} />
                    : <ThumbsDown size={13} style={{ color: 'var(--danger)' }} />}
                  <FileText size={12} style={{ color: 'var(--text-tertiary)' }} />
                  <strong style={{ fontSize: 'var(--text-xs)' }}>{nameOf(f.ref)}</strong>
                  <span style={{ fontSize: '10px', color: 'var(--text-tertiary)' }}>
                    {SURFACE_LABEL[f.surface]} · {f.ref}
                  </span>
                  <span style={{
                    fontSize: '10px', fontWeight: 700, padding: '1px 7px', borderRadius: 'var(--radius-full)',
                    background: 'white', color: f.helpful ? 'var(--success)' : 'var(--danger)',
                  }}>
                    {REASONS[f.reason].label}
                  </span>
                  <span style={{ marginLeft: 'auto', fontSize: '10px', color: 'var(--text-tertiary)' }}>
                    {f.author} · {f.persona} · {fmtDate(f.submitted)}
                  </span>
                  <span style={{ fontSize: '10px', fontWeight: 800, color: STATE_INK[f.state] }}>{f.state}</span>
                </div>

                {f.comment && (
                  <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', margin: 0, padding: '10px 12px', lineHeight: 1.55 }}>
                    “{f.comment}”
                  </p>
                )}

                {f.action_taken && (
                  <div style={{ padding: '8px 12px', borderTop: '1px solid var(--border-light)', background: 'var(--bg-alt)' }}>
                    <div style={{ fontSize: '10px', fontWeight: 700, color: f.state === 'declined' ? 'var(--text-tertiary)' : 'var(--success)' }}>
                      {f.state === 'declined' ? 'Declined' : 'Fixed'} by {f.reviewed_by}
                      {f.reviewed_at ? ` · ${fmtDate(f.reviewed_at)}` : ''}
                    </div>
                    <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>{f.action_taken}</div>
                  </div>
                )}

                {(f.state === 'new' || f.state === 'triaged') && !f.helpful && (
                  <div style={{ display: 'flex', gap: '8px', padding: '9px 12px', borderTop: '1px solid var(--border-light)', flexWrap: 'wrap', alignItems: 'center' }}>
                    <span style={{ fontSize: '11px', color: 'var(--text-tertiary)', flex: 1, minWidth: '200px' }}>
                      {REASONS[f.reason].fix}
                    </span>
                    <Btn size="sm" onClick={() => setDeciding(f)}>Close it out</Btn>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      {deciding && (
        <CloseDialog
          item={deciding}
          title={nameOf(deciding.ref)}
          onClose={() => setDeciding(null)}
          onSaved={async () => { setDeciding(null); await reload() }}
        />
      )}
    </div>
  )
}

function CloseDialog({ item, title, onClose, onSaved }: {
  item: Feedback; title: string; onClose: () => void; onSaved: () => Promise<void>
}) {
  const [state, setState] = useState<FeedbackState>('actioned')
  const [action, setAction] = useState('')
  const [busy, setBusy] = useState(false)

  const verdict = canClose(state, action)

  return (
    <Modal open onClose={onClose} title={`Close out — ${title}`}
      footer={<>
        <Btn variant="secondary" size="sm" onClick={onClose}>Cancel</Btn>
        <Btn size="sm" disabled={!verdict.ok || busy} onClick={async () => {
          setBusy(true)
          try {
            const { error } = await supabase.from('content_feedback').update({
              state, action_taken: action.trim(),
              reviewed_by: ACTOR, reviewed_at: new Date().toISOString().slice(0, 10),
            }).eq('id', item.id)
            if (error) { toast(`That did not save: ${error.message}`, 'error'); return }
            toast(state === 'actioned' ? 'Marked as fixed' : 'Declined, with the reason recorded')
            await onSaved()
          } finally { setBusy(false) }
        }}>Save</Btn>
      </>}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
        <Callout tone="info" title={REASONS[item.reason].label}>{REASONS[item.reason].fix}</Callout>

        {item.comment && (
          <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: '11px 13px' }}>
            <div style={{ fontSize: '10px', color: 'var(--text-tertiary)', fontWeight: 700 }}>
              {item.author} · {item.persona} · {fmtDate(item.submitted)}
            </div>
            <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', margin: '4px 0 0', lineHeight: 1.55 }}>
              “{item.comment}”
            </p>
          </div>
        )}

        <FormField label="Outcome" required>
          <Select value={state} onChange={e => setState(e.target.value as FeedbackState)}>
            <option value="actioned">Fixed — the content changed</option>
            <option value="declined">Declined — no change needed</option>
            <option value="triaged">Triaged — picked up, not done yet</option>
          </Select>
        </FormField>

        <FormField
          label={state === 'declined' ? 'Why it was declined' : 'What changed'}
          required
          hint={state === 'declined'
            ? 'A dismissal with no reason comes back as the same complaint next month.'
            : 'The next person to read this page needs to know it was already fixed once.'}>
          <TextArea value={action} onChange={e => setAction(e.target.value)} rows={3} />
        </FormField>

        {!verdict.ok && <Callout tone="danger">{verdict.reason}</Callout>}
      </div>
    </Modal>
  )
}
