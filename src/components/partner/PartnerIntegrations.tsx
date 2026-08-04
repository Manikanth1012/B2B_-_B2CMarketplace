import { useState, useEffect, useCallback } from 'react'
import {
  TriangleAlert as AlertTriangle, Key, Plus, Send, Trash2,
} from 'lucide-react'
import {
  StatCard, SectionCard, Table, Td, Id, StatusPill, fmtInt, fmtDateTime, Btn, toast,
  Modal, FormField, TextInput, Select, EmptyState, ConfirmDialog,
} from '../operator/shared'
import { Pager, usePaging } from '../Pager'
import { Callout } from '../OnboardingJourney'
import {
  METHODS, ENVIRONMENTS, AUTH_KINDS, EVENTS,
  successRate, healthOf, healthNote, eventsUncovered, recent,
  validateEndpoint, blankDraft,
} from '../../lib/endpoints'
import type { Endpoint, EndpointDraft } from '../../lib/endpoints'
import {
  loadEndpoints, addEndpoint, updateEndpoint, setEnabled, removeEndpoint, sendTestCall,
} from '../../lib/endpointsRepo'
import type { EndpointBook } from '../../lib/endpointsRepo'
import { loadApiAccess } from '../../lib/apiAccessRepo'
import type { ApiAccess } from '../../lib/apiAccessRepo'

/* The screen used to render three objects from `data.ts` describing Nimbus
   Sensors' webhooks — to every seller who signed in — and its four buttons all
   raised a toast. The worst of them was "Send a test call", which answered
   "200 OK" without calling anything: a seller whose endpoint is down was being
   told it was up. */
export function PartnerIntegrations({ partnerId }: { partnerId: string }) {
  const [book, setBook] = useState<EndpointBook>({ endpoints: [], calls: [] })
  const [access, setAccess] = useState<ApiAccess | null>(null)
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<{ endpoint: Endpoint | null; draft: EndpointDraft } | null>(null)
  const [keys, setKeys] = useState(false)
  const [removing, setRemoving] = useState<Endpoint | null>(null)
  const [testing, setTesting] = useState<string | null>(null)

  const reload = useCallback(async () => {
    const [b, a] = await Promise.all([loadEndpoints(partnerId), loadApiAccess(partnerId)])
    setBook(b); setAccess(a); setLoading(false)
  }, [partnerId])

  useEffect(() => { void reload() }, [reload])

  /* Above the loading guard: `usePaging` is a hook, and a hook below an early
     return runs on some renders and not others. */
  const page = usePaging(book.endpoints, { initialSize: 10 })

  const test = async (ep: Endpoint) => {
    setTesting(ep.id)
    const r = await sendTestCall(ep, book.calls)
    setTesting(null)
    toast(r.note ?? 'Called.', r.result?.status === 'ok' ? 'success' : 'error')
    await reload()
  }

  const save = async () => {
    if (!editing) return
    const check = validateEndpoint(editing.draft, book.endpoints, editing.endpoint?.id)
    if (!check.ok) { toast(check.reason, 'error'); return }

    const r = editing.endpoint
      ? await updateEndpoint(editing.endpoint.id, editing.draft)
      : await addEndpoint(partnerId, editing.draft, book.endpoints)

    if (!r.ok) { toast(r.reason, 'error'); return }
    toast(r.note ?? 'Saved')
    setEditing(null)
    await reload()
  }

  const toggle = async (ep: Endpoint) => {
    const r = await setEnabled(ep.id, !ep.enabled)
    toast(r.ok ? r.note ?? 'Saved' : r.reason, r.ok ? 'success' : 'error')
    await reload()
  }

  const drop = async () => {
    if (!removing) return
    const r = await removeEndpoint(removing.id)
    toast(r.ok ? r.note ?? 'Removed' : r.reason, r.ok ? 'success' : 'error')
    setRemoving(null)
    await reload()
  }

  if (loading) {
    return <div style={{ textAlign: 'center', padding: '40px' }}><div className="spinner" style={{ margin: '0 auto' }} /></div>
  }

  const live = book.endpoints.filter(e => e.enabled)
  const failing = live.filter(e => healthOf(book.calls, e.id) === 'failing')
  const uncovered = eventsUncovered(book.endpoints)
  const sandboxOnly = live.length > 0 && live.every(e => e.env === 'Sandbox')

  /* One figure over every call the seller has made, rather than the per-endpoint
     window. "40% success" used to be a string on the page. */
  const allCalls = book.calls.length
  const good = book.calls.filter(c => c.status === 'ok').length
  const latencies = book.calls.map(c => c.ms).filter((n): n is number => typeof n === 'number')
  const avgMs = latencies.length ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length) : null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '16px', flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontSize: 'var(--text-2xl)', fontWeight: 800, color: 'var(--text)' }}>Integrations</h1>
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)', marginTop: '4px' }}>
            {book.endpoints.length} endpoint{book.endpoints.length === 1 ? '' : 's'} registered, {live.length} enabled · the marketplace calls you, you never poll
          </p>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <Btn variant="secondary" onClick={() => setKeys(true)}><Key size={14} /> API access</Btn>
          <Btn variant="primary" onClick={() => setEditing({ endpoint: null, draft: blankDraft() })}>
            <Plus size={14} /> Add an endpoint
          </Btn>
        </div>
      </div>

      {book.loadError && <Callout tone="danger" title="Some of this did not load">{book.loadError}</Callout>}

      {/* API access panel */}
      <SectionCard
        title="Your API access"
        subtitle={access
          ? `${access.subscriptions.length} subscription${access.subscriptions.length === 1 ? '' : 's'} · ${access.scopes.length} scope${access.scopes.length === 1 ? '' : 's'} granted`
          : 'Not loaded'}>
        <div style={{ padding: '20px' }}>
          {sandboxOnly && (
            <div style={{
              padding: '12px 16px', borderRadius: 'var(--radius-md)',
              background: 'var(--warning-bg)', border: '1px solid var(--warning)',
              fontSize: 'var(--text-sm)', color: 'var(--warning)', marginBottom: '16px',
            }}>
              <strong>Every enabled endpoint is on sandbox.</strong> Test data only — production access is
              granted when the technical gate clears.
            </div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', fontSize: 'var(--text-sm)' }}>
            <ApiRow label="Environments" value={access?.environments.join(', ') || 'None granted yet'} />
            <ApiRow label="Rate limit" value={access ? `${fmtInt(access.rateLimit)} requests per minute` : '—'} />
            <ApiRow label="Monthly quota" value={access ? `${fmtInt(access.quota)} calls` : '—'} />
            <ApiRow label="Used this month" value={access ? `${fmtInt(access.volume)} calls` : '—'} />
            <ApiRow label="Scopes" value={access?.scopes.join(', ') || 'None granted yet'} />
          </div>
        </div>
      </SectionCard>

      {/* What nothing is listening for. A gap here is why an order never
          reaches the seller's own system, and it was not being checked. */}
      {uncovered.length > 0 && (
        <Callout tone="warning" title="Nothing is listening for every event the marketplace sends">
          No enabled endpoint subscribes to {uncovered.map(id => EVENTS.find(e => e.id === id)?.id ?? id).join(' or ')}.
          Until one does, {uncovered.includes('order.created')
            ? 'orders will not reach your own systems'
            : 'a cancelled order will still be shipped'}.
        </Callout>
      )}

      {failing.length > 0 && (
        <div style={{
          display: 'flex', gap: '12px', alignItems: 'flex-start',
          padding: '14px 18px', borderRadius: 'var(--radius-md)',
          background: 'var(--danger-bg)', border: '1px solid var(--danger)',
        }}>
          <AlertTriangle size={18} style={{ color: 'var(--danger)', flexShrink: 0, marginTop: '1px' }} />
          <div style={{ fontSize: 'var(--text-sm)', color: 'var(--danger)' }}>
            <strong>{failing[0].name} is failing.</strong>{' '}
            {healthNote(book.calls, failing[0].id)}
            {failing[0].note ? ` ${failing[0].note}` : ''}{' '}
            Until it answers, orders routed to it will not be acknowledged.
            <span style={{ marginLeft: '8px' }}>
              <button
                onClick={() => void test(failing[0])}
                disabled={testing === failing[0].id}
                style={{
                  background: 'none', border: 'none', color: 'var(--danger)',
                  textDecoration: 'underline', cursor: testing ? 'wait' : 'pointer', font: 'inherit',
                }}>
                {testing === failing[0].id ? 'Calling…' : 'Send a test call'}
              </button>
            </span>
          </div>
        </div>
      )}

      <div className="stat-row">
        <StatCard label="Endpoints enabled" value={`${live.length} of ${book.endpoints.length}`}
                  sublabel={`${book.endpoints.filter(e => e.env === 'Sandbox').length} on sandbox`} />
        <StatCard label="Required events covered"
                  value={`${2 - uncovered.length} of 2`}
                  sublabel={uncovered.length ? `${uncovered.join(', ')} uncovered` : 'Order created and cancelled are both handled'}
                  color={uncovered.length ? 'var(--danger)' : 'var(--success)'} />
        <StatCard label="Call success"
                  value={allCalls ? `${Math.round((good / allCalls) * 100)}%` : '—'}
                  sublabel={allCalls ? `${allCalls - good} failed of ${allCalls} recorded` : 'Nothing called yet'}
                  color={allCalls && good / allCalls < 0.9 ? 'var(--danger)' : undefined} />
        <StatCard label="Average round trip" value={avgMs === null ? '—' : `${avgMs}ms`}
                  sublabel={latencies.length ? `Over ${latencies.length} calls` : 'Nothing timed yet'} />
      </div>

      <SectionCard title="Your endpoints" subtitle={`${book.endpoints.length} registered`}>
        {book.endpoints.length === 0 ? (
          <EmptyState message="No endpoints yet. Register one and the marketplace will call it when an order is placed." />
        ) : (
          <>
            <Table headers={['Name', 'Environment', 'URL', 'Auth', 'Health', 'Enabled', '']}>
              {page.rows.map(ep => {
                const health = healthOf(book.calls, ep.id)
                const rate = successRate(book.calls, ep.id)
                const last = recent(book.calls, ep.id, 1)[0]
                return (
                  <tr key={ep.id}>
                    <Td>
                      <div style={{ fontWeight: 600 }}>{ep.name}</div>
                      <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
                        {ep.method} · {ep.retry} · {ep.timeout_ms}ms
                      </div>
                    </Td>
                    <Td>{ep.env}</Td>
                    <Td style={{ fontSize: 'var(--text-xs)', fontFamily: 'monospace', color: 'var(--text-secondary)' }}>
                      {ep.url.replace('https://', '')}
                    </Td>
                    {/* "HMAC-SHA256" is one algorithm, not two — the hyphen is a
                        break opportunity CSS takes by default and the column was
                        printing it over two lines. */}
                    <Td><Id>{ep.auth}</Id></Td>
                    <Td right>
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '2px' }}>
                        <StatusPill status={health === 'healthy' ? 'healthy' : health === 'failing' ? 'rejected' : 'draft'} />
                        <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', whiteSpace: 'nowrap' }}>
                          {rate === null ? 'Never called' : `${rate}% of last ${recent(book.calls, ep.id).length}`}
                        </span>
                      </div>
                    </Td>
                    <Td right><StatusPill status={ep.enabled ? 'active' : 'paused'} /></Td>
                    <Td right>
                      <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                        <Btn variant="secondary" size="sm" disabled={testing === ep.id} onClick={() => void test(ep)}>
                          <Send size={13} /> {testing === ep.id ? 'Calling…' : 'Test'}
                        </Btn>
                        <Btn variant="secondary" size="sm" onClick={() => setEditing({ endpoint: ep, draft: draftOf(ep) })}>
                          Configure
                        </Btn>
                      </div>
                      {last && (
                        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', marginTop: '4px' }}>
                          Last {fmtDateTime(last.called_at)}
                        </div>
                      )}
                    </Td>
                  </tr>
                )
              })}
            </Table>
            <div style={{ padding: '0 20px 14px' }}><Pager page={page} noun="endpoints" /></div>
          </>
        )}
      </SectionCard>

      {/* ------------------------------------------------------- add / edit */}
      <Modal
        open={!!editing}
        onClose={() => setEditing(null)}
        title={editing?.endpoint ? `Configure ${editing.endpoint.name}` : 'Add an endpoint'}
        footer={
          <div style={{ display: 'flex', gap: '8px', justifyContent: 'space-between', width: '100%' }}>
            <div>
              {editing?.endpoint && (
                <Btn variant="secondary" size="sm" onClick={() => { setRemoving(editing.endpoint); setEditing(null) }}>
                  <Trash2 size={13} /> Remove
                </Btn>
              )}
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <Btn variant="secondary" onClick={() => setEditing(null)}>Cancel</Btn>
              <Btn variant="primary" onClick={() => void save()}>
                {editing?.endpoint ? 'Save' : 'Register it'}
              </Btn>
            </div>
          </div>
        }>
        {editing && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <FormField label="Name" required hint="What the failure alert will call it.">
              <TextInput value={editing.draft.name}
                         onChange={e => setEditing({ ...editing, draft: { ...editing.draft, name: e.target.value } })}
                         placeholder="Fulfilment webhook" />
            </FormField>

            <FormField label="URL" required hint="https only — the callback carries order lines and a delivery address.">
              <TextInput value={editing.draft.url}
                         onChange={e => setEditing({ ...editing, draft: { ...editing.draft, url: e.target.value } })}
                         placeholder="https://api.example.com/marketplace/callback" />
            </FormField>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px' }}>
              <FormField label="Method">
                <Select value={editing.draft.method}
                        onChange={e => setEditing({ ...editing, draft: { ...editing.draft, method: e.target.value } })}>
                  {METHODS.map(m => <option key={m} value={m}>{m}</option>)}
                </Select>
              </FormField>
              <FormField label="Environment">
                <Select value={editing.draft.env}
                        onChange={e => setEditing({ ...editing, draft: { ...editing.draft, env: e.target.value } })}>
                  {ENVIRONMENTS.map(m => <option key={m} value={m}>{m}</option>)}
                </Select>
              </FormField>
              <FormField label="Timeout (ms)" hint="500–60000">
                <TextInput type="number" value={String(editing.draft.timeoutMs)}
                           onChange={e => setEditing({ ...editing, draft: { ...editing.draft, timeoutMs: Number(e.target.value) } })} />
              </FormField>
            </div>

            <FormField label="How we authenticate to you">
              <Select value={editing.draft.auth}
                      onChange={e => setEditing({ ...editing, draft: { ...editing.draft, auth: e.target.value } })}>
                {AUTH_KINDS.map(a => <option key={a} value={a}>{a}</option>)}
              </Select>
            </FormField>

            <FormField label="Events" required hint="The two marked required have to be covered by some enabled endpoint.">
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {EVENTS.map(ev => (
                  <label key={ev.id} style={{ display: 'flex', gap: '8px', alignItems: 'center', fontSize: 'var(--text-sm)', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={editing.draft.events.includes(ev.id)}
                      onChange={e => setEditing({
                        ...editing,
                        draft: {
                          ...editing.draft,
                          events: e.target.checked
                            ? [...editing.draft.events, ev.id]
                            : editing.draft.events.filter(x => x !== ev.id),
                        },
                      })}
                    />
                    <span style={{ fontFamily: 'monospace', fontSize: 'var(--text-xs)' }}>{ev.id}</span>
                    <span style={{ color: 'var(--text-tertiary)' }}>{ev.label}</span>
                    {ev.required && <span style={{ fontSize: 'var(--text-xs)', color: 'var(--warning)' }}>required</span>}
                  </label>
                ))}
              </div>
            </FormField>

            <label style={{ display: 'flex', gap: '8px', alignItems: 'center', fontSize: 'var(--text-sm)', cursor: 'pointer' }}>
              <input type="checkbox" checked={editing.draft.enabled}
                     onChange={e => setEditing({ ...editing, draft: { ...editing.draft, enabled: e.target.checked } })} />
              Enabled — the marketplace calls it
            </label>

            {editing.endpoint && (
              <div>
                <div style={{ fontSize: 'var(--text-xs)', fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '6px' }}>
                  Recent calls
                </div>
                {recent(book.calls, editing.endpoint.id).length === 0
                  ? <EmptyState message="Never called. Save, then send a test call." />
                  : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      {recent(book.calls, editing.endpoint.id).map(c => (
                        <div key={c.id} style={{ display: 'flex', gap: '10px', fontSize: 'var(--text-xs)', alignItems: 'baseline' }}>
                          <span style={{ color: c.status === 'ok' ? 'var(--success)' : 'var(--danger)', fontWeight: 700, minWidth: '52px' }}>
                            {c.status}
                          </span>
                          <span style={{ color: 'var(--text-tertiary)', minWidth: '120px' }}>{fmtDateTime(c.called_at)}</span>
                          <span style={{ color: 'var(--text-secondary)' }}>{c.ms !== null ? `${c.ms}ms · ` : ''}{c.detail}</span>
                        </div>
                      ))}
                    </div>
                  )}
              </div>
            )}

            {editing.endpoint && (
              <Btn variant="secondary" size="sm" onClick={() => void toggle(editing.endpoint!)}>
                {editing.endpoint.enabled ? 'Disable it for now' : 'Enable it'}
              </Btn>
            )}
          </div>
        )}
      </Modal>

      {/* ---------------------------------------------------------- API keys */}
      <Modal open={keys} onClose={() => setKeys(false)} title="API access"
             footer={<Btn variant="secondary" onClick={() => setKeys(false)}>Close</Btn>}>
        {!access ? <EmptyState message="This did not load." /> : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <Callout tone="info">
              Keys are issued to a named technical contact and are never shown again after issue. Ask the
              marketplace desk to rotate one if it has been exposed — there is no self-service rotation while
              you are on sandbox.
            </Callout>

            {access.subscriptions.length === 0
              ? <EmptyState message="No API subscriptions yet. The marketplace grants these at the technical gate." />
              : (
                <Table headers={['API', 'Version', 'Environment', 'Scopes', 'Calls']}>
                  {access.subscriptions.map(s => (
                    <tr key={s.id}>
                      <Td><span style={{ fontWeight: 600 }}>{s.api_name}</span></Td>
                      <Td>{s.version}</Td>
                      <Td>{s.environment}</Td>
                      <Td style={{ fontSize: 'var(--text-xs)', fontFamily: 'monospace' }}>{s.scopes.join(', ')}</Td>
                      <Td right>{fmtInt(s.volume)}</Td>
                    </tr>
                  ))}
                </Table>
              )}

            {access.unsubscribed.length > 0 && (
              <div>
                <div style={{ fontSize: 'var(--text-xs)', fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '6px' }}>
                  Available to sellers, not granted to you
                </div>
                <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                  {access.unsubscribed.map(a => a.name).join(', ')}. Ask at the technical gate if you need one.
                </div>
              </div>
            )}
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={!!removing}
        onClose={() => setRemoving(null)}
        onConfirm={() => void drop()}
        title="Remove this endpoint?"
        message={removing
          ? `The marketplace will stop calling ${removing.name}. Its call history goes with it. If it is covering ${removing.events.join(' or ')}, nothing else may be listening.`
          : ''}
        confirmLabel="Remove it"
        danger
      />
    </div>
  )
}

function draftOf(ep: Endpoint): EndpointDraft {
  return {
    name: ep.name, url: ep.url, method: ep.method, auth: ep.auth,
    env: ep.env, events: [...ep.events], timeoutMs: ep.timeout_ms, enabled: ep.enabled,
  }
}

function ApiRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', gap: '12px' }}>
      <span style={{ color: 'var(--text-tertiary)', minWidth: '140px' }}>{label}</span>
      <span style={{ fontWeight: 600, color: 'var(--text)' }}>{value}</span>
    </div>
  )
}
