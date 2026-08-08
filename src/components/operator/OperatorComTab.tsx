import { useState, useEffect, useCallback, useMemo } from 'react'
import { Send, RefreshCw, ChevronRight, ChevronDown, Server, ArrowRight, CircleHelp as HelpCircle } from 'lucide-react'
import { SectionCard, EmptyState, Btn, StatusPill, Table, Td, toast } from './shared'
import { Callout } from '../OnboardingJourney'
import { Pager, usePaging } from '../Pager'
import { loadComBook, sendPush, pollPush, retryDue, previewPayload, loadContext } from '../../lib/comRepo'
import type { ComBook } from '../../lib/comRepo'
import {
  workOrder, queueHealth, explain, retryable, pollable, unacknowledged, attemptsLeft,
  mappingFor, sourceLabel, mappingProblems, missingFor, reachable, systemLine,
  STATE_LABEL, STATE_TONE, STATE_MEANING,
} from '../../lib/com'
import type { Push, Fulfil } from '../../lib/com'

/* Fulfilment that leaves the marketplace.
 *
 * Everything else in this portal is an API the marketplace PUBLISHES — a seller
 * subscribes, is approved, gets a key. This is the other direction and the
 * distinction is worth keeping visible: nobody subscribes to the telco's order
 * manager, the marketplace is the consumer, and an operator looking for an
 * approval queue here would be looking for something that does not exist.
 *
 * The screen is arranged the way somebody works the queue. A rejection is a
 * customer who has paid and cannot be served and it will not clear on its own;
 * a give-up means nothing is provisioned and nothing is trying; silence looks
 * fine on every other screen in the marketplace, which is why it is on this one.
 */

const FULFIL_CLASSES: Fulfil[] = ['esim', 'provisioned', 'activation']

export function ComTab() {
  const [book, setBook] = useState<ComBook | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const [view, setView] = useState<'queue' | 'mapping' | 'systems'>('queue')
  const now = new Date().toISOString()

  const reload = useCallback(async () => setBook(await loadComBook()), [])
  useEffect(() => { void reload() }, [reload])

  const send = async (p: Push) => {
    setBusy(p.id)
    const r = await sendPush(p.id)
    setBusy(null)
    toast(r.ok ? `${p.product_name} is ${r.state} with the order manager.`
               : r.missing?.length ? `Refused: ${r.missing.join('; ')}`
               : r.why ?? 'The order manager refused it.',
          r.ok ? 'success' : 'error')
    await reload()
  }

  const ask = async (p: Push) => {
    setBusy(p.id)
    const r = await pollPush(p.id)
    setBusy(null)
    toast(r.why ?? (r.ok ? 'Asked.' : 'The order manager did not answer.'), r.ok ? 'success' : 'error')
    await reload()
  }

  const runRetries = async () => {
    setBusy('all')
    const r = await retryDue()
    setBusy(null)
    toast(r.ok ? `${r.tried ?? 0} retried, ${r.accepted ?? 0} accepted.` : r.why ?? 'The retry did not run.',
          r.ok ? 'success' : 'error')
    await reload()
  }

  if (!book) {
    return <div style={{ textAlign: 'center', padding: '40px' }}><div className="spinner" style={{ margin: '0 auto' }} /></div>
  }
  if (book.loadError) {
    return <Callout tone="danger" title="The fulfilment queue did not load">{book.loadError}</Callout>
  }

  const health = queueHealth(book.pushes, book.systems, now)
  const queue = workOrder(book.pushes, book.systems, now)
  const problems = mappingProblems(book.mappings)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <Callout tone="info" title="This is the one interface the marketplace consumes">
        Everything else in this portal is published to sellers. Nobody subscribes to a Customer Order
        Management system — the marketplace is the caller, over the same TMF622 the marketplace itself
        speaks. Twenty-one products are provisioned by the network, and none of them is delivered until
        the order manager says so.
      </Callout>

      {health.worst && (
        <Callout tone="danger" title={`${health.worst.push.product_name ?? health.worst.push.product_id} on ${health.worst.push.order_ref} is ${health.worst.why}`}>
          {explain(health.worst.push, book.systems.find(s => s.id === health.worst!.push.system_id) ?? null, now)}
        </Callout>
      )}

      {problems.length > 0 && (
        <Callout tone="warning" title={`${problems.length} problem${problems.length === 1 ? '' : 's'} in the field mapping`}>
          {problems.join(' ')}
        </Callout>
      )}

      <div style={{ display: 'grid', gap: '12px', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>
        <Figure label="Live on the network" value={String(health.live)} />
        <Figure label="In flight" value={String(health.inFlight)} />
        <Figure label="Stopped" value={String(health.stuck)} tone={health.stuck > 0 ? 'bad' : undefined} />
        <Figure label="Sent and silent" value={String(health.silent)} tone={health.silent > 0 ? 'bad' : undefined} />
      </div>

      <div style={{ display: 'flex', gap: '4px', borderBottom: '1px solid var(--border)' }}>
        {([['queue', `Queue (${book.pushes.length})`],
           ['mapping', `Field mapping (${book.mappings.length})`],
           ['systems', `Systems (${book.systems.length})`]] as const).map(([id, label]) => (
          <button key={id} onClick={() => setView(id)} style={{
            padding: '8px 14px', border: 'none', background: 'none', cursor: 'pointer',
            fontSize: 'var(--text-sm)', fontWeight: view === id ? 700 : 500,
            color: view === id ? 'var(--brand-navy)' : 'var(--text-tertiary)',
            borderBottom: `2px solid ${view === id ? 'var(--brand-navy)' : 'transparent'}`,
            marginBottom: '-1px',
          }}>{label}</button>
        ))}
      </div>

      {view === 'queue' && (
        <Queue book={book} queue={queue} now={now} open={open} setOpen={setOpen}
               busy={busy} onSend={send} onAsk={ask} onRetryAll={runRetries} />
      )}
      {view === 'mapping' && <MappingView book={book} />}
      {view === 'systems' && <Systems book={book} now={now} />}
    </div>
  )
}

/* ------------------------------------------------------------------ queue -- */

function Queue({ book, queue, now, open, setOpen, busy, onSend, onAsk, onRetryAll }: {
  book: ComBook
  queue: Push[]
  now: string
  open: string | null
  setOpen: (v: string | null) => void
  busy: string | null
  onSend: (p: Push) => Promise<void>
  onAsk: (p: Push) => Promise<void>
  onRetryAll: () => Promise<void>
}) {
  const page = usePaging(queue, { initialSize: 10 })
  const due = queue.filter(p => p.state === 'queued').length

  return (
    <SectionCard
      title="What has been asked of the network"
      subtitle="Worst first: a rejection blocks a customer who has paid, a give-up means nobody is trying, and silence shows up nowhere else."
      action={
        <Btn variant="secondary" size="sm" disabled={busy === 'all' || due === 0} onClick={() => void onRetryAll()}>
          <RefreshCw size={12} style={{ marginRight: 5 }} />
          {busy === 'all' ? 'Retrying…' : `Retry what is due${due ? ` (${due})` : ''}`}
        </Btn>
      }
    >
      {queue.length === 0
        ? <EmptyState message="Nothing has been sent to an order manager." />
        : (
          <>
            <Table headers={['Order', 'What', 'Market', 'State', 'Where it stands', 'Attempts', '']}>
              {page.rows.map(p => {
                const sys = book.systems.find(s => s.id === p.system_id) ?? null
                const silent = unacknowledged(p, sys, now)
                const isOpen = open === p.id
                return (
                  <>
                    <tr key={p.id} style={p.state === 'rejected' || p.state === 'failed'
                      ? { background: 'var(--danger-bg)' }
                      : silent ? { background: 'var(--warning-bg)' } : undefined}>
                      <Td>
                        <strong style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)' }}>{p.order_ref}</strong>
                        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
                          {p.com_order_id ?? 'not accepted'}
                        </div>
                      </Td>
                      <Td>
                        {p.product_name ?? p.product_id}
                        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
                          {p.fulfil} · ×{p.quantity}
                        </div>
                      </Td>
                      <Td>{p.market}</Td>
                      <Td>
                        <StatusPill status={STATE_TONE[p.state]} label={STATE_LABEL[p.state]} />
                        {silent && (
                          <div style={{ fontSize: 'var(--text-xs)', color: 'var(--warning)', marginTop: '2px' }}>
                            past the window
                          </div>
                        )}
                      </Td>
                      <Td style={{ maxWidth: '42ch' }}>
                        <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>
                          {explain(p, sys, now)}
                        </span>
                      </Td>
                      <Td right>
                        {p.attempts}{sys ? ` / ${sys.max_attempts}` : ''}
                        {sys && retryable(p) && (
                          <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
                            {attemptsLeft(p, sys)} left
                          </div>
                        )}
                      </Td>
                      <Td right>
                        <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end' }}>
                          {retryable(p) && (
                            <Btn size="sm" disabled={busy === p.id} onClick={() => void onSend(p)}>
                              <Send size={12} style={{ marginRight: 4 }} />
                              {busy === p.id ? 'Sending…' : p.attempts === 0 ? 'Send' : 'Retry'}
                            </Btn>
                          )}
                          {/* Deliberately not a Retry. The far end has the
                              request; sending it again is a second SIM. */}
                          {pollable(p) && (
                            <Btn variant={silent ? 'primary' : 'secondary'} size="sm"
                                 disabled={busy === p.id} onClick={() => void onAsk(p)}>
                              <HelpCircle size={12} style={{ marginRight: 4 }} />
                              {busy === p.id ? 'Asking…' : 'Ask'}
                            </Btn>
                          )}
                          <Btn variant="secondary" size="sm" onClick={() => setOpen(isOpen ? null : p.id)}>
                            {isOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                          </Btn>
                        </div>
                      </Td>
                    </tr>
                    {isOpen && (
                      <tr key={`${p.id}-d`}>
                        <td colSpan={7} style={{ padding: '14px 18px', background: 'var(--bg-alt)', borderBottom: '1px solid var(--border)' }}>
                          <PushDetail push={p} book={book} />
                        </td>
                      </tr>
                    )}
                  </>
                )
              })}
            </Table>
            <Pager page={page} noun="pushes" />
          </>
        )}
    </SectionCard>
  )
}

function PushDetail({ push, book }: { push: Push; book: ComBook }) {
  const [payload, setPayload] = useState<Record<string, unknown> | null>(null)
  const [context, setContext] = useState<Record<string, unknown> | null>(null)

  useEffect(() => {
    let live = true
    if (!push.order_item_id) return
    void Promise.all([previewPayload(push.order_item_id), loadContext(push.order_item_id)])
      .then(([p, c]) => { if (live) { setPayload(p); setContext(c) } })
    return () => { live = false }
  }, [push.order_item_id])

  const events = book.events.filter(e => e.com_order === push.id)
    .sort((a, b) => a.occurred_at < b.occurred_at ? -1 : 1)
  const missing = context ? missingFor(book.mappings, push.fulfil, context) : []

  return (
    <div style={{ display: 'grid', gap: '16px', gridTemplateColumns: 'minmax(260px, 1fr) minmax(320px, 1.4fr)' }}>
      <div>
        <div style={head}>What happened</div>
        {events.length === 0
          ? <EmptyState message="Nothing recorded." />
          : events.map(e => (
            <div key={e.id} style={{ display: 'flex', gap: '8px', padding: '6px 0', borderBottom: '1px solid var(--border-light)' }}>
              <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', minWidth: '13ch' }}>
                {e.occurred_at.slice(0, 16).replace('T', ' ')}
              </span>
              <span style={{ fontSize: 'var(--text-xs)' }}>
                <strong>{e.state ?? e.kind}</strong>
                {e.detail && <> — {e.detail}</>}
              </span>
            </div>
          ))}

        <div style={{ ...head, marginTop: '14px' }}>What this state means</div>
        <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', lineHeight: 1.6, margin: 0 }}>
          {STATE_MEANING[push.state]}
        </p>

        {missing.length > 0 && (
          <>
            <div style={{ ...head, marginTop: '14px', color: 'var(--danger)' }}>Cannot be supplied</div>
            <ul style={{ fontSize: 'var(--text-xs)', color: 'var(--danger)', paddingLeft: '16px', margin: 0, lineHeight: 1.7 }}>
              {missing.map(m => <li key={m}>{m}</li>)}
            </ul>
          </>
        )}

        {push.correlation_id && (
          <>
            <div style={{ ...head, marginTop: '14px' }}>Correlation</div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', wordBreak: 'break-all' }}>
              {push.correlation_id}
            </div>
            <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', marginTop: '4px', lineHeight: 1.5 }}>
              Stable across retries, so a duplicate submission is recognisable as one at the far end
              rather than provisioning a second SIM.
            </p>
          </>
        )}
      </div>

      <div>
        <div style={head}>The body sent, built from the mapping</div>
        <pre style={code}>{JSON.stringify(payload ?? push.payload ?? {}, null, 2)}</pre>
      </div>
    </div>
  )
}

/* ---------------------------------------------------------------- mapping -- */

function MappingView({ book }: { book: ComBook }) {
  const [cls, setCls] = useState<Fulfil>('provisioned')
  const rows = useMemo(() => mappingFor(book.mappings, cls), [book.mappings, cls])

  return (
    <SectionCard
      title="Which of our fields lands where"
      subtitle="The payload is folded out of this table rather than written by hand, so what is shown here is what is sent. Editing a row changes the next push, not the next release."
      action={
        <div style={{ display: 'flex', gap: '4px' }}>
          {FULFIL_CLASSES.map(f => (
            <button key={f} onClick={() => setCls(f)} style={{
              padding: '4px 10px', borderRadius: '999px', cursor: 'pointer',
              border: `1px solid ${cls === f ? 'var(--brand-navy)' : 'var(--border)'}`,
              background: cls === f ? 'var(--brand-navy)' : 'transparent',
              color: cls === f ? '#fff' : 'var(--text-secondary)',
              fontSize: 'var(--text-xs)', fontWeight: 600,
            }}>{f}</button>
          ))}
        </div>
      }
    >
      <Table headers={['Field', 'Ours', '', 'TMF622 path', 'Transform', 'Required', 'Why']}>
        {rows.map(m => (
          <tr key={m.id}>
            <Td>{m.label}</Td>
            <Td style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)' }}>{sourceLabel(m)}</Td>
            <Td><ArrowRight size={12} style={{ color: 'var(--text-tertiary)' }} /></Td>
            <Td style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', wordBreak: 'break-all', maxWidth: '34ch' }}>
              {m.target}
            </Td>
            <Td>
              {m.transform
                ? <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>{m.transform}</span>
                : <span style={{ color: 'var(--text-tertiary)' }}>—</span>}
            </Td>
            <Td>{m.required ? <StatusPill status="required" /> : <span style={{ color: 'var(--text-tertiary)' }}>optional</span>}</Td>
            <Td style={{ maxWidth: '44ch' }}>
              <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>{m.note ?? ''}</span>
            </Td>
          </tr>
        ))}
      </Table>
    </SectionCard>
  )
}

/* ---------------------------------------------------------------- systems -- */

function Systems({ book, now }: { book: ComBook; now: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      {book.systems.map(s => {
        const mine = book.pushes.filter(p => p.system_id === s.id)
        const reach = reachable(s)
        const silent = mine.filter(p => unacknowledged(p, s, now)).length
        return (
          <SectionCard key={s.id} title={s.name}
                       subtitle={`${mine.length} order${mine.length === 1 ? '' : 's'} sent · ${s.market}`}>
            <div style={{ padding: '4px 20px 16px' }}>
              <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap', marginBottom: '10px' }}>
                <Server size={14} style={{ color: 'var(--text-tertiary)' }} />
                <StatusPill status={s.status === 'live' ? 'healthy' : s.status === 'degraded' ? 'degraded' : 'rejected'}
                            label={s.status} />
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>
                  {s.base_url}
                </span>
              </div>
              <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', lineHeight: 1.6, maxWidth: '92ch', margin: 0 }}>
                {systemLine(s)}
              </p>
              {s.note && (
                <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', lineHeight: 1.6, marginTop: '6px', maxWidth: '92ch' }}>
                  {s.note}
                </p>
              )}
              {!reach.ok && (
                <p style={{ fontSize: 'var(--text-xs)', color: 'var(--danger)', marginTop: '8px' }}>{reach.reason}</p>
              )}
              {s.status_note && reach.ok && (
                <p style={{ fontSize: 'var(--text-xs)', color: 'var(--warning)', marginTop: '8px', maxWidth: '92ch' }}>
                  {s.status_note}
                  {silent > 0 && ` ${silent} order${silent === 1 ? ' is' : 's are'} past the acknowledgement window because of it.`}
                </p>
              )}
              {s.contact && (
                <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', marginTop: '8px' }}>
                  Owned by {s.contact}.
                </p>
              )}
            </div>
          </SectionCard>
        )
      })}
    </div>
  )
}

function Figure({ label, value, tone }: { label: string; value: string; tone?: 'bad' }) {
  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: '10px', padding: '12px 14px', background: 'var(--surface)' }}>
      <div style={{ fontSize: 'var(--text-2xl)', fontWeight: 800, color: tone === 'bad' ? 'var(--danger)' : 'var(--text)' }}>
        {value}
      </div>
      <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>{label}</div>
    </div>
  )
}

const head: React.CSSProperties = {
  fontSize: 'var(--text-xs)', fontWeight: 700, color: 'var(--text-tertiary)',
  textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '6px',
}

const code: React.CSSProperties = {
  background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '6px',
  padding: '10px 12px', fontSize: 'var(--text-xs)', lineHeight: 1.55,
  fontFamily: 'var(--font-mono)', overflowX: 'auto', margin: 0, maxHeight: '380px',
}
