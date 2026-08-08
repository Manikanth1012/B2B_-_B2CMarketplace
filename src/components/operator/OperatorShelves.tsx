import { useState, useEffect, useCallback, useMemo } from 'react'
import { ShieldCheck, TriangleAlert, Lock, Unlock, Layers } from 'lucide-react'
import { SectionCard, EmptyState, Btn, StatusPill, Table, Td, toast, FormField, TextInput, TextArea, Select } from './shared'
import { Callout } from '../OnboardingJourney'
import { loadShelfBook, savePolicy, setLevel, setOpen } from '../../lib/shelfPolicyRepo'
import type { ShelfBook } from '../../lib/shelfPolicyRepo'
import {
  occupancy, barImpact, capImpact, barLine, reviewLine, returnsLine, capLine,
  shelfWarnings, levelOf, reachOf, ruleLine, matrixProblems, ruleCoverage, levelImpact,
  LEVEL_LABEL,
} from '../../lib/shelfPolicy'
import type { RuleLevel } from '../../lib/shelfPolicy'
import type { CategoryPolicy } from '../../lib/catalogue'

/* What may go on each shelf, from whom, and how much.
 *
 * The model behind this was already in the database and only half connected —
 * the rules, the matrix and the per-category policy all existed, and the caps
 * and rating bars were read by nothing and editable by nobody. A governance
 * model that can only be changed by migration is not a governance model.
 *
 * The screen is built around one idea: a policy change is an act with victims.
 * Raising a bar to 4.0 is the same thing as removing three suppliers and their
 * listings, and the only difference between a considered decision and an
 * accident is whether the screen said so before the click.
 */

const ACTOR = 'Anika Sharma'
const LEVELS: RuleLevel[] = ['off', 'warn', 'enforce']

export function OperatorShelves() {
  const [book, setBook] = useState<ShelfBook | null>(null)
  const [tab, setTab] = useState<'shelves' | 'rules' | 'matrix'>('shelves')
  const [editing, setEditing] = useState<string | null>(null)

  const reload = useCallback(async () => setBook(await loadShelfBook()), [])
  useEffect(() => { void reload() }, [reload])

  if (!book) {
    return <div style={{ textAlign: 'center', padding: '40px' }}><div className="spinner" style={{ margin: '0 auto' }} /></div>
  }
  if (book.loadError) {
    return <Callout tone="danger" title="The shelf policy did not load">{book.loadError}</Callout>
  }

  const problems = matrixProblems(book.rules, book.matrix, book.categories)
  const closed = book.categories.filter(c => !c.open_to_buyers)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div>
        <h1 style={{ fontSize: 'var(--text-2xl)', fontWeight: 800, color: 'var(--text)' }}>Shelves and rules</h1>
        <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)', marginTop: '4px', maxWidth: '76ch' }}>
          What may go on each shelf, from whom, and how much of it. Every change here takes effect on
          the next listing written from anywhere — the rules are enforced in the database, not by this
          screen.
        </p>
      </div>

      {closed.length > 0 && (
        <Callout tone="warning" title={`${closed.length} shelf${closed.length === 1 ? '' : 'ves'} closed to buyers`}>
          {closed.map(c => {
            const p = book.policies.find(x => x.category_id === c.id)
            return `${c.name}${p?.closed_reason ? ` — ${p.closed_reason}` : ' (no reason recorded)'}`
          }).join('; ')}
        </Callout>
      )}

      {problems.length > 0 && (
        <Callout tone="danger" title={`${problems.length} contradiction${problems.length === 1 ? '' : 's'} in the rule book`}>
          <ul style={{ margin: '4px 0 0', paddingLeft: '18px', lineHeight: 1.7 }}>
            {problems.map(p => <li key={p}>{p}</li>)}
          </ul>
        </Callout>
      )}

      <div style={{ display: 'flex', gap: '4px', borderBottom: '1px solid var(--border)' }}>
        {([['shelves', `Shelves (${book.categories.length})`],
           ['rules', `Rule book (${book.rules.length})`],
           ['matrix', 'Which rule, which shelf']] as const).map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)} style={{
            padding: '8px 14px', border: 'none', background: 'none', cursor: 'pointer',
            fontSize: 'var(--text-sm)', fontWeight: tab === id ? 700 : 500,
            color: tab === id ? 'var(--brand-navy)' : 'var(--text-tertiary)',
            borderBottom: `2px solid ${tab === id ? 'var(--brand-navy)' : 'transparent'}`,
            marginBottom: '-1px',
          }}>{label}</button>
        ))}
      </div>

      {tab === 'shelves' && (
        <Shelves book={book} editing={editing} setEditing={setEditing} onChanged={reload} />
      )}
      {tab === 'rules' && <RuleBook book={book} />}
      {tab === 'matrix' && <Matrix book={book} onChanged={reload} />}
    </div>
  )
}

/* ----------------------------------------------------------------- shelves -- */

function Shelves({ book, editing, setEditing, onChanged }: {
  book: ShelfBook
  editing: string | null
  setEditing: (v: string | null) => void
  onChanged: () => Promise<void>
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
      {book.categories.map(c => {
        const policy = book.policies.find(p => p.category_id === c.id)
        if (!policy) {
          return (
            <Callout key={c.id} tone="danger" title={`${c.name} has no policy`}>
              Nobody has decided anything about this shelf, which is different from deciding to govern
              it loosely. Every listing on it is accepted on whatever the catalogue desk happens to think.
            </Callout>
          )
        }
        const held = occupancy(book.listings, book.sellers, c.id, policy)
        const cover = ruleCoverage(book.rules, book.matrix, c.id)
        const warnings = shelfWarnings(policy, c, book.listings, book.sellers)
        const isEditing = editing === c.id

        return (
          <SectionCard key={c.id} title={c.name}
            subtitle={`${held.reduce((n, h) => n + h.held, 0)} listings from ${held.length} supplier${held.length === 1 ? '' : 's'} · ${c.audience ?? ''}`}
            action={
              <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                <StatusPill status={c.open_to_buyers ? 'healthy' : 'degraded'}
                            label={c.open_to_buyers ? 'Open' : 'Closed'} />
                <Btn variant="secondary" size="sm" onClick={() => setEditing(isEditing ? null : c.id)}>
                  {isEditing ? 'Close' : 'Change'}
                </Btn>
              </div>
            }>
            <div style={{ padding: '4px 20px 18px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div style={{ display: 'grid', gap: '8px', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))' }}>
                <Fact icon={<ShieldCheck size={13} />} text={reviewLine(policy)} />
                <Fact icon={<Layers size={13} />} text={capLine(policy)} />
                <Fact icon={<ShieldCheck size={13} />} text={barLine(policy)} />
                <Fact icon={<ShieldCheck size={13} />} text={returnsLine(policy)} />
              </div>

              {policy.note && (
                <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', lineHeight: 1.6, margin: 0, maxWidth: '92ch' }}>
                  {policy.note}
                </p>
              )}

              <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>
                <strong>{cover.enforced}</strong> of {cover.applicable} published rules block a listing here
                {cover.warned > 0 && <>, <strong>{cover.warned}</strong> only flag it</>}
                {cover.off > 0 && <>, <strong>{cover.off}</strong> are not applied</>}.
              </div>

              {warnings.map(w => (
                <div key={w} style={{
                  display: 'flex', gap: '8px', alignItems: 'flex-start',
                  background: 'var(--warning-bg)', border: '1px solid var(--warning)',
                  borderRadius: '6px', padding: '8px 10px',
                }}>
                  <TriangleAlert size={13} style={{ color: 'var(--warning)', flexShrink: 0, marginTop: '2px' }} />
                  <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', lineHeight: 1.55 }}>{w}</span>
                </div>
              ))}

              {held.length > 0 && (
                <Table headers={['Supplier', 'Holds', 'Of cap', '']}>
                  {held.map(h => (
                    <tr key={h.seller_id ?? 'first-party'}>
                      <Td>{h.seller}</Td>
                      <Td right>{h.held}</Td>
                      <Td right>{h.cap === null ? 'uncapped' : `${h.held} / ${h.cap}`}</Td>
                      <Td>
                        {h.pct !== null && (
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <div style={{ flex: 1, height: '6px', borderRadius: '3px', background: 'var(--border-light)', minWidth: '80px' }}>
                              <div style={{
                                width: `${Math.min(100, h.pct)}%`, height: '100%', borderRadius: '3px',
                                background: h.state === 'over' || h.state === 'full' ? 'var(--danger)'
                                  : h.state === 'nearly' ? 'var(--warning)' : 'var(--success)',
                              }} />
                            </div>
                            <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', minWidth: '12ch' }}>
                              {h.state === 'over' ? 'over the cap'
                                : h.state === 'full' ? 'at the cap'
                                : h.state === 'nearly' ? 'near the cap' : `${h.pct}%`}
                            </span>
                          </div>
                        )}
                      </Td>
                    </tr>
                  ))}
                </Table>
              )}

              {isEditing && (
                <PolicyEditor book={book} policy={policy} categoryName={c.name}
                              onDone={async () => { setEditing(null); await onChanged() }} />
              )}
            </div>
          </SectionCard>
        )
      })}
    </div>
  )
}

function Fact({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div style={{ display: 'flex', gap: '7px', alignItems: 'flex-start' }}>
      <span style={{ color: 'var(--text-tertiary)', flexShrink: 0, marginTop: '2px' }}>{icon}</span>
      <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', lineHeight: 1.55 }}>{text}</span>
    </div>
  )
}

/* The editor. Every field that can remove a supplier says so while it is being
   changed, not after it has been saved. */
function PolicyEditor({ book, policy, categoryName, onDone }: {
  book: ShelfBook; policy: CategoryPolicy; categoryName: string; onDone: () => Promise<void>
}) {
  const [form, setForm] = useState({
    min_rating: policy.min_rating === null ? '' : String(policy.min_rating),
    allow_unrated: policy.allow_unrated,
    max_listings_per_seller: policy.max_listings_per_seller === null ? '' : String(policy.max_listings_per_seller),
    price_floor: policy.price_floor,
    sla_hours: String(policy.sla_hours),
    auto_publish: policy.auto_publish,
    open_to_buyers: policy.open_to_buyers,
    closed_reason: policy.closed_reason ?? '',
    note: policy.note ?? '',
  })
  const [busy, setBusy] = useState(false)
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm(f => ({ ...f, [k]: v }))

  const bar = form.min_rating.trim() === '' ? null : Number(form.min_rating)
  const cap = form.max_listings_per_seller.trim() === '' ? null : Number(form.max_listings_per_seller)

  const impact = useMemo(
    () => barImpact(book.sellers, book.listings, policy.category_id, bar, form.allow_unrated),
    [book.sellers, book.listings, policy.category_id, bar, form.allow_unrated],
  )
  const capOver = useMemo(
    () => cap === null ? [] : capImpact(book.listings, book.sellers, policy.category_id, cap),
    [book.listings, book.sellers, policy.category_id, cap],
  )

  const save = async () => {
    setBusy(true)
    const res = form.open_to_buyers === policy.open_to_buyers
      ? await savePolicy(policy.category_id, {
          min_rating: bar, allow_unrated: form.allow_unrated,
          max_listings_per_seller: cap, price_floor: form.price_floor,
          sla_hours: Number(form.sla_hours), auto_publish: form.auto_publish,
          note: form.note.trim() || null,
        }, ACTOR)
      : await setOpen(policy.category_id, form.open_to_buyers, form.closed_reason.trim() || null, ACTOR)
    setBusy(false)
    if (!res.ok) { toast(res.why ?? 'That did not save', 'error'); return }
    toast(`${categoryName} updated.`)
    await onDone()
  }

  return (
    <div style={{ borderTop: '1px solid var(--border)', paddingTop: '14px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
      <div style={{ display: 'grid', gap: '12px', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
        <FormField label="Rating bar" hint="Blank means no bar. A seller below it may not list here.">
          <TextInput value={form.min_rating} onChange={e => set('min_rating', e.target.value)}
                     placeholder="none" inputMode="decimal" />
        </FormField>
        <FormField label="A seller nobody has rated"
                   hint="The question the bar cannot answer. Refusing them closes the shelf to new supply.">
          <Select value={form.allow_unrated ? 'admit' : 'refuse'}
                  onChange={e => set('allow_unrated', e.target.value === 'admit')}>
            <option value="admit">May list</option>
            <option value="refuse">Is refused</option>
          </Select>
        </FormField>
        <FormField label="Listings per supplier" hint="Blank means uncapped.">
          <TextInput value={form.max_listings_per_seller}
                     onChange={e => set('max_listings_per_seller', e.target.value)}
                     placeholder="uncapped" inputMode="numeric" />
        </FormField>
        <FormField label="Review window (hours)">
          <TextInput value={form.sla_hours} onChange={e => set('sla_hours', e.target.value)} inputMode="numeric" />
        </FormField>
        <FormField label="Price below cost">
          <Select value={form.price_floor ? 'refuse' : 'allow'}
                  onChange={e => set('price_floor', e.target.value === 'refuse')}>
            <option value="refuse">Refused</option>
            <option value="allow">Allowed</option>
          </Select>
        </FormField>
        <FormField label="A passing listing">
          <Select value={form.auto_publish ? 'auto' : 'wait'}
                  onChange={e => set('auto_publish', e.target.value === 'auto')}>
            <option value="wait">Waits for a person</option>
            <option value="auto">Goes live on its own</option>
          </Select>
        </FormField>
        <FormField label="Open to buyers">
          <Select value={form.open_to_buyers ? 'open' : 'closed'}
                  onChange={e => set('open_to_buyers', e.target.value === 'open')}>
            <option value="open">Open</option>
            <option value="closed">Closed</option>
          </Select>
        </FormField>
      </div>

      {!form.open_to_buyers && (
        <FormField label="Why it is closing" required
                   hint="Somebody will reopen it and needs to know what they are undoing.">
          <TextInput value={form.closed_reason} onChange={e => set('closed_reason', e.target.value)} />
        </FormField>
      )}

      <FormField label="Why this shelf is governed this way">
        <TextArea rows={2} value={form.note} onChange={e => set('note', e.target.value)} />
      </FormField>

      {/* The whole point of the screen. */}
      {(impact.excluded.length > 0 || impact.unratedAffected.length > 0) && (
        <Callout tone="danger" title={`This removes ${impact.excluded.length + impact.unratedAffected.length} supplier${impact.excluded.length + impact.unratedAffected.length === 1 ? '' : 's'} from ${categoryName}`}>
          {impact.excluded.map(s => `${s.name} (rated ${s.rating})`).join(', ')}
          {impact.excluded.length > 0 && impact.unratedAffected.length > 0 && ', and '}
          {impact.unratedAffected.map(s => `${s.name} (unrated)`).join(', ')}
          {' '}— {impact.listings} listing{impact.listings === 1 ? '' : 's'} would stop being eligible.
          Nothing already live is withdrawn by this, but none of it can be relisted or changed.
        </Callout>
      )}

      {capOver.length > 0 && (
        <Callout tone="warning" title="That cap is below where the shelf already is">
          {capOver.map(o => `${o.seller} holds ${o.held}, which is ${o.over} over`).join('; ')}.
          The cap refuses the next listing and does nothing about the ones already there.
        </Callout>
      )}

      <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
        <Btn variant="secondary" size="sm" onClick={() => void onDone()}>Cancel</Btn>
        <Btn size="sm" disabled={busy} onClick={() => void save()}>
          {busy ? 'Saving…' : 'Save'}
        </Btn>
      </div>
    </div>
  )
}

/* --------------------------------------------------------------- rule book -- */

function RuleBook({ book }: { book: ShelfBook }) {
  return (
    <SectionCard title="The rule book"
                 subtitle="What every listing is checked against, who owns each rule, and what proves it.">
      <Table headers={['Rule', 'How it is checked', 'Rests on', 'Owner', 'Evidence', 'Reaches', 'State']}>
        {book.rules.map(r => {
          const reach = reachOf(book.matrix, r.id)
          const nameOf = (id: string) => book.categories.find(c => c.id === id)?.name ?? id
          return (
            <tr key={r.id}>
              <Td style={{ maxWidth: '30ch' }}>
                <strong>{r.name}</strong>
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', lineHeight: 1.5 }}>
                  {r.descr}
                </div>
              </Td>
              <Td>
                <span style={{ fontSize: 'var(--text-xs)' }}>
                  {r.check_by === 'auto' ? 'The platform, itself'
                    : r.check_by === 'doc' ? 'Against a document'
                    : r.check_by === 'extern' ? 'An external service' : 'A person'}
                </span>
              </Td>
              <Td>{r.basis}</Td>
              <Td>{r.owner}</Td>
              <Td style={{ maxWidth: '24ch' }}>
                <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
                  {r.evidence ?? '—'}
                </span>
              </Td>
              <Td style={{ maxWidth: '26ch' }}>
                {reach.enforced.length === 0 && reach.warned.length === 0
                  ? <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>Nowhere</span>
                  : (
                    <span style={{ fontSize: 'var(--text-xs)' }}>
                      {reach.enforced.length > 0 && <>Blocks on {reach.enforced.map(nameOf).join(', ')}</>}
                      {reach.enforced.length > 0 && reach.warned.length > 0 && <br />}
                      {reach.warned.length > 0 && (
                        <span style={{ color: 'var(--text-tertiary)' }}>Flags on {reach.warned.map(nameOf).join(', ')}</span>
                      )}
                    </span>
                  )}
              </Td>
              <Td>
                <StatusPill status={r.status === 'active' ? 'healthy' : 'draft'} label={r.status} />
                {!r.blocks && (
                  <div style={{ fontSize: '10px', color: 'var(--text-tertiary)', marginTop: '2px' }}>advisory</div>
                )}
              </Td>
            </tr>
          )
        })}
      </Table>
    </SectionCard>
  )
}

/* ------------------------------------------------------------------ matrix -- */

function Matrix({ book, onChanged }: { book: ShelfBook; onChanged: () => Promise<void> }) {
  const [busy, setBusy] = useState<string | null>(null)

  const change = async (categoryId: string, ruleId: string, level: RuleLevel) => {
    const key = `${categoryId}:${ruleId}`
    setBusy(key)
    const res = await setLevel(categoryId, ruleId, level)
    setBusy(null)
    if (!res.ok) { toast(res.why ?? 'That did not save', 'error'); return }
    toast(`${book.rules.find(r => r.id === ruleId)?.name} — ${LEVEL_LABEL[level].toLowerCase()} on ${book.categories.find(c => c.id === categoryId)?.name}.`)
    await onChanged()
  }

  return (
    <SectionCard title="Which rule bites on which shelf"
                 subtitle="Off, flagged for the reviewer, or blocking. A rule set to block refuses the listing at the database, not on this screen.">
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--text-table)' }}>
          <thead>
            <tr style={{ borderBottom: '2px solid var(--border)' }}>
              <th style={th}>Rule</th>
              {book.categories.map(c => (
                <th key={c.id} style={{ ...th, textAlign: 'center' }}>
                  {c.name}
                  {!c.open_to_buyers && (
                    <div style={{ fontSize: '9px', color: 'var(--warning)', fontWeight: 600 }}>closed</div>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {book.rules.map(r => (
              <tr key={r.id}>
                <td style={{ padding: '10px', borderBottom: '1px solid var(--border-light)', maxWidth: '32ch' }}>
                  <strong style={{ fontSize: 'var(--text-xs)' }}>{r.name}</strong>
                  <div style={{ fontSize: '10px', color: 'var(--text-tertiary)', lineHeight: 1.45 }}>
                    {ruleLine(r)}
                  </div>
                </td>
                {book.categories.map(c => {
                  const level = levelOf(book.matrix, c.id, r.id)
                  const policy = book.policies.find(p => p.category_id === c.id) ?? null
                  const impact = levelImpact(r, policy, book.listings, c.id)
                  const key = `${c.id}:${r.id}`
                  return (
                    <td key={c.id} style={{ padding: '8px', borderBottom: '1px solid var(--border-light)', textAlign: 'center' }}>
                      <select value={level} disabled={busy === key}
                              onChange={e => void change(c.id, r.id, e.target.value as RuleLevel)}
                              title={impact.known
                                ? `${impact.failing} listing${impact.failing === 1 ? '' : 's'} here would fail this today.`
                                : impact.why}
                              style={{
                                fontSize: '11px', padding: '3px 6px', borderRadius: '4px', cursor: 'pointer',
                                border: `1px solid ${level === 'enforce' ? 'var(--danger)' : level === 'warn' ? 'var(--warning)' : 'var(--border)'}`,
                                background: level === 'enforce' ? 'var(--danger-bg)' : level === 'warn' ? 'var(--warning-bg)' : 'transparent',
                                color: level === 'off' ? 'var(--text-tertiary)' : 'var(--text)',
                                fontWeight: level === 'off' ? 400 : 600,
                              }}>
                        {LEVELS.map(l => <option key={l} value={l}>{l}</option>)}
                      </select>
                      {impact.known && impact.failing > 0 && level !== 'enforce' && (
                        <div style={{ fontSize: '9px', color: 'var(--danger)', marginTop: '2px' }}>
                          {impact.failing} would fail
                        </div>
                      )}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {book.rules.length === 0 && <EmptyState message="No rules are published." />}
    </SectionCard>
  )
}

const th: React.CSSProperties = {
  textAlign: 'left', padding: '10px', fontSize: 'var(--text-xs)', fontWeight: 700,
  color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.04em',
}
