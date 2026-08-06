import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  Plus, Copy, RefreshCw, Ban, Play, Download, ChevronRight, ChevronDown,
} from 'lucide-react'
import {
  SectionCard, StatCard, Table, Td, StatusPill, EmptyState, Btn, Modal,
  FormField, TextInput, TextArea, Select, toast, fmtInt, fmtDate, Id,
} from '../operator/shared'
import { Callout } from '../OnboardingJourney'
import {
  KEY_STATE_LABEL, LIFECYCLE_LABEL, LIMITS, keyNote, usable, maskedSecret,
  sunsetWarning, usageOf, curlFor, endpointUrl, scopesHeld, callability,
  groupEndpoints, statusTone, daysUntil,
} from '../../lib/devPortal'
import type {
  Application, Credential, Version, Endpoint, Subscription, Environment,
} from '../../lib/devPortal'
import {
  loadWorkspace, registerApplication, subscribeApplication, rotateCredential,
  revokeCredential, sandboxCall, loadSpec,
} from '../../lib/devPortalRepo'
import type { DeveloperWorkspace, IssuedCredential, SandboxResult } from '../../lib/devPortalRepo'

/* The seller's half of the developer portal.
 *
 * Before this, a seller's entire API experience was a modal listing which
 * subscriptions somebody had granted them, with a note saying there was no
 * self-service anything. No documentation, no specification, no key, no way to
 * make a call, no way to ask for production. Every step of the journey a
 * developer actually takes was missing, so what the screen showed was the
 * outcome of a process that had no beginning.
 *
 * The journey now runs end to end on this screen: read what is published,
 * register an application, get sandbox keys immediately, read the reference,
 * execute a real call, and ask for production with a sentence saying why.
 * Sandbox is instant because a developer deciding whether to integrate at all
 * will not wait a week for a key; production is asked for, because production
 * is other people's customers.
 */
type Tab = 'apps' | 'apis' | 'console' | 'requests'

export function PartnerDeveloper({ partnerId }: { partnerId: string }) {
  const [ws, setWs] = useState<DeveloperWorkspace | null>(null)
  const [tab, setTab] = useState<Tab>('apps')
  const [registering, setRegistering] = useState(false)
  const [issued, setIssued] = useState<IssuedCredential | null>(null)
  const [subscribing, setSubscribing] = useState<Version | null>(null)
  const [rotating, setRotating] = useState<Credential | null>(null)
  const [revoking, setRevoking] = useState<Credential | null>(null)

  const reload = useCallback(async () => setWs(await loadWorkspace(partnerId)), [partnerId])
  useEffect(() => { void reload() }, [reload])

  if (!ws) return <div style={{ textAlign: 'center', padding: '40px' }}><div className="spinner" style={{ margin: '0 auto' }} /></div>

  const { applications, credentials, subscriptions, versions, usage } = ws
  const activeApps = applications.filter(a => a.status === 'active')
  const sandboxUsage = usageOf(usage.filter(r => r.environment === 'sandbox'), LIMITS.sandbox.quota)
  const liveUsage = usageOf(usage.filter(r => r.environment === 'production'), LIMITS.production.quota)
  const live = subscriptions.filter(s => s.state === 'active')
  const pending = subscriptions.filter(s => s.state === 'pending')

  /* A version this seller is calling that is going to be switched off. The one
     thing they must not learn from a 410 in production. */
  const sunsetting = versions
    .filter(v => live.some(s => s.version_id === v.id))
    .map(v => sunsetWarning(v))
    .filter((w): w is NonNullable<typeof w> => w !== null)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '16px', flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontSize: 'var(--text-2xl)', fontWeight: 800, color: 'var(--text)' }}>Developer</h1>
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)', marginTop: '4px' }}>
            {applications.length} application{applications.length === 1 ? '' : 's'} · {live.length} live subscription{live.length === 1 ? '' : 's'} ·
            {' '}sandbox keys are issued the moment you register
          </p>
        </div>
        <Btn variant="primary" onClick={() => setRegistering(true)}><Plus size={14} /> Register an application</Btn>
      </div>

      {ws.loadError && <Callout tone="danger" title="Some of this did not load">{ws.loadError}</Callout>}

      {sunsetting.map((w, i) => (
        <Callout key={i} tone={w.tone === 'info' ? 'info' : w.tone} title={w.headline}>{w.detail}</Callout>
      ))}

      <div className="stat-row">
        <StatCard label="Applications" value={String(activeApps.length)}
                  sublabel={applications.length > activeApps.length
                    ? `${applications.length - activeApps.length} suspended`
                    : 'Each holds its own keys'} />
        <StatCard label="Sandbox calls" value={fmtInt(sandboxUsage.calls)}
                  sublabel={sandboxUsage.successRate === null
                    ? 'Nothing called yet'
                    : `${sandboxUsage.successRate}% succeeded · busiest day ${fmtInt(sandboxUsage.peakDay)} of ${fmtInt(LIMITS.sandbox.quota)}`}
                  color={sandboxUsage.nearLimit ? 'var(--warning)' : undefined} />
        <StatCard label="Production calls" value={fmtInt(liveUsage.calls)}
                  sublabel={liveUsage.calls === 0
                    ? 'No production access yet'
                    : `${liveUsage.successRate}% succeeded · busiest day ${fmtInt(liveUsage.peakDay)} of ${fmtInt(LIMITS.production.quota)}`}
                  color={liveUsage.nearLimit ? 'var(--warning)' : undefined} />
        <StatCard label="Waiting on the marketplace" value={String(pending.length)}
                  sublabel={pending.length ? 'Production requests being decided' : 'Nothing outstanding'}
                  color={pending.length ? 'var(--info)' : undefined} />
      </div>

      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
        {([
          ['apps', 'Your applications'], ['apis', 'API reference'],
          ['console', 'Sandbox console'], ['requests', 'Production access'],
        ] as [Tab, string][]).map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)} style={tabStyle(tab === id)}>{label}</button>
        ))}
      </div>

      {tab === 'apps' && (
        <ApplicationsTab
          applications={applications} credentials={credentials} subscriptions={subscriptions}
          versions={versions} usage={usage}
          onRotate={setRotating} onRevoke={setRevoking}
          onSubscribe={() => setTab('apis')} />
      )}

      {tab === 'apis' && (
        <ReferenceTab versions={versions} subscriptions={subscriptions}
                      applications={activeApps} onSubscribe={setSubscribing} />
      )}

      {tab === 'console' && (
        <ConsoleTab versions={versions} credentials={credentials.filter(c => c.environment === 'sandbox')}
                    applications={activeApps} subscriptions={subscriptions} onDone={() => void reload()} />
      )}

      {tab === 'requests' && (
        <RequestsTab subscriptions={subscriptions} applications={applications} />
      )}

      {registering && (
        <RegisterModal
          onClose={() => setRegistering(false)}
          onDone={async (r) => { setRegistering(false); setIssued(r); await reload() }} />
      )}

      {issued && <SecretModal issued={issued} onClose={() => setIssued(null)} />}

      {subscribing && (
        <SubscribeModal
          version={subscribing} applications={activeApps} subscriptions={subscriptions}
          onClose={() => setSubscribing(null)}
          onDone={async () => { setSubscribing(null); await reload() }} />
      )}

      {rotating && (
        <RotateModal credential={rotating} onClose={() => setRotating(null)}
                     onDone={async (r) => { setRotating(null); setIssued(r); await reload() }} />
      )}

      {revoking && (
        <RevokeModal credential={revoking} onClose={() => setRevoking(null)}
                     onDone={async () => { setRevoking(null); await reload() }} />
      )}
    </div>
  )
}

/* ---- Applications and their keys ------------------------------------------ */

function ApplicationsTab({
  applications, credentials, subscriptions, versions, usage, onRotate, onRevoke, onSubscribe,
}: {
  applications: Application[]; credentials: Credential[]; subscriptions: Subscription[]
  versions: Version[]; usage: DeveloperWorkspace['usage']
  onRotate: (c: Credential) => void; onRevoke: (c: Credential) => void; onSubscribe: () => void
}) {
  if (applications.length === 0) {
    return (
      <SectionCard title="No applications yet" subtitle="An application is what holds the keys">
        <div style={{ padding: '24px' }}>
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', lineHeight: 1.7, maxWidth: '62ch' }}>
            Register one and sandbox credentials are issued straight away — no approval, no waiting.
            Run as many as you need: one for your production integration, one for an agency doing your
            catalogue, one for a spike. Each has its own keys, so revoking one does not take the others down.
          </p>
        </div>
      </SectionCard>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {applications.map(app => {
        const keys = credentials.filter(c => c.application_id === app.id)
        const subs = subscriptions.filter(s => s.application_id === app.id)
        const use = usageOf(usage.filter(r => r.application_id === app.id), LIMITS.sandbox.quota)

        return (
          <SectionCard key={app.id} title={app.name}
            subtitle={`${app.description} · technical contact ${app.contact_name}, ${app.contact_email}`}
            action={<Btn variant="secondary" size="sm" onClick={onSubscribe}><Plus size={13} /> Subscribe to an API</Btn>}>
            <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: '18px' }}>
              {app.status === 'suspended' && (
                <Callout tone="danger" title="This application is suspended">
                  {app.suspended_why} Its keys will not authenticate until the marketplace lifts it.
                </Callout>
              )}

              <div>
                <Heading>Credentials</Heading>
                {keys.length === 0 ? <EmptyState message="No keys on this application." /> : (
                  <Table headers={['Environment', 'Client ID', 'Secret', 'State', 'Issued', '']}>
                    {keys.map(c => (
                      <tr key={c.id}>
                        <Td><StatusPill status={c.environment} /></Td>
                        <Td style={{ fontFamily: 'monospace', fontSize: 'var(--text-xs)' }}>
                          <CopyText value={c.client_id} />
                        </Td>
                        <Td style={{ fontFamily: 'monospace', fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
                          {maskedSecret(c)}
                        </Td>
                        <Td>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                            {/* KEY_STATE_LABEL, not a status borrowed from
                                elsewhere — "rotating" is what is happening. */}
                            <StatusPill status={KEY_STATE_LABEL[c.state].toLowerCase()} />
                            <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', maxWidth: '34ch' }}>
                              {keyNote(c)}
                            </span>
                          </div>
                        </Td>
                        <Td right style={{ fontSize: 'var(--text-xs)' }}>{fmtDate(c.issued_at)}</Td>
                        <Td right>
                          {usable(c) && (
                            <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end' }}>
                              <Btn variant="secondary" size="sm" onClick={() => onRotate(c)}>
                                <RefreshCw size={12} /> Rotate
                              </Btn>
                              <Btn variant="danger" size="sm" onClick={() => onRevoke(c)}>
                                <Ban size={12} /> Revoke
                              </Btn>
                            </div>
                          )}
                        </Td>
                      </tr>
                    ))}
                  </Table>
                )}
                <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', marginTop: '8px', maxWidth: '80ch', lineHeight: 1.6 }}>
                  Secrets are stored hashed and shown once, at issue. If one is lost or exposed, rotate —
                  the replacement is issued immediately and the old key keeps working for the grace period
                  you choose, so nothing breaks the moment you click.
                </p>
              </div>

              <div>
                <Heading>Subscriptions</Heading>
                {subs.length === 0 ? (
                  <EmptyState message="Not subscribed to anything yet. Nothing will authenticate until it is." />
                ) : (
                  <Table headers={['API', 'Version', 'Environment', 'Scopes', 'State', 'Calls']}>
                    {subs.map(s => {
                      const v = versions.find(x => x.id === s.version_id)
                      return (
                        <tr key={s.id}>
                          <Td>{s.api_name}</Td>
                          <Td>
                            {s.version}
                            {v && v.lifecycle !== 'current' && (
                              <span style={{ fontSize: 'var(--text-xs)', color: 'var(--warning)', marginLeft: '6px' }}>
                                {LIFECYCLE_LABEL[v.lifecycle]}
                              </span>
                            )}
                          </Td>
                          <Td>{s.environment}</Td>
                          <Td style={{ fontFamily: 'monospace', fontSize: 'var(--text-xs)' }}>{s.scopes.join(', ')}</Td>
                          <Td><StatusPill status={s.state} /></Td>
                          <Td right>{fmtInt(s.volume)}</Td>
                        </tr>
                      )
                    })}
                  </Table>
                )}
              </div>

              <div style={{ display: 'flex', gap: '28px', flexWrap: 'wrap', fontSize: 'var(--text-sm)' }}>
                <Figure label="Calls recorded" value={fmtInt(use.calls)} />
                <Figure label="Succeeded" value={use.successRate === null ? '—' : `${use.successRate}%`}
                        tone={use.successRate !== null && use.successRate < 90 ? 'bad' : undefined} />
                <Figure label="Failed" value={fmtInt(use.failed)} tone={use.failed > 0 ? 'bad' : undefined} />
                <Figure label="Average round trip" value={use.avgMs === null ? '—' : `${use.avgMs}ms`} />
                <Figure label="Busiest day" value={use.peakDayOn ? `${fmtInt(use.peakDay)} on ${use.peakDayOn}` : '—'} />
              </div>
            </div>
          </SectionCard>
        )
      })}
    </div>
  )
}

/* ---- The reference ------------------------------------------------------- */

function ReferenceTab({ versions, subscriptions, applications, onSubscribe }: {
  versions: Version[]; subscriptions: Subscription[]
  applications: Application[]; onSubscribe: (v: Version) => void
}) {
  const [open, setOpen] = useState<string | null>(versions[0]?.id ?? null)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      <Callout tone="info" title="Everything published, whether or not you hold it">
        Read the reference before you subscribe. Each endpoint says which scope it needs, so you can see
        what you would be asking for. The specification you download is generated from these same rows —
        the page and the file cannot disagree.
      </Callout>

      {versions.map(v => {
        const isOpen = open === v.id
        const held = subscriptions.filter(s => s.version_id === v.id && s.state === 'active')
        const warn = sunsetWarning(v)

        return (
          <SectionCard key={v.id}
            title={`${v.api_name} ${v.version}`}
            subtitle={`${v.standard} · ${v.endpoints.length} endpoint${v.endpoints.length === 1 ? '' : 's'} · base path ${v.base_path}${
              held.length ? ` · you hold it on ${held.map(s => s.environment).join(' and ')}` : ''}`}
            action={
              <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                <StatusPill status={v.lifecycle} />
                <Btn variant="secondary" size="sm" onClick={() => void download(v)}>
                  <Download size={13} /> OpenAPI
                </Btn>
                {applications.length > 0 && v.lifecycle !== 'retired' && (
                  <Btn size="sm" onClick={() => onSubscribe(v)}>Subscribe</Btn>
                )}
                <Btn variant="secondary" size="sm" onClick={() => setOpen(isOpen ? null : v.id)}>
                  {isOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />} {isOpen ? 'Hide' : 'Reference'}
                </Btn>
              </div>
            }>
            {isOpen && (
              <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
                {warn && <Callout tone={warn.tone === 'info' ? 'info' : warn.tone} title={warn.headline}>{warn.detail}</Callout>}

                <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', lineHeight: 1.7, maxWidth: '76ch' }}>
                  {v.description}
                </p>

                {groupEndpoints(v.endpoints).map(g => (
                  <div key={g.resource}>
                    <Heading>/{g.resource}</Heading>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                      {g.endpoints.map(e => <EndpointCard key={e.id} version={v} endpoint={e} />)}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </SectionCard>
        )
      })}
    </div>
  )
}

function EndpointCard({ version, endpoint }: { version: Version; endpoint: Endpoint }) {
  const [show, setShow] = useState(false)
  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
      <button onClick={() => setShow(!show)} style={{
        width: '100%', display: 'flex', gap: '12px', alignItems: 'center', padding: '10px 14px',
        background: 'var(--surface-2, #fafafa)', border: 'none', cursor: 'pointer', textAlign: 'left',
      }}>
        <span style={{
          fontFamily: 'monospace', fontSize: 'var(--text-xs)', fontWeight: 800, minWidth: '52px',
          color: endpoint.method === 'GET' ? 'var(--info)' : endpoint.method === 'DELETE' ? 'var(--danger)' : 'var(--success)',
        }}>{endpoint.method}</span>
        <span style={{ fontFamily: 'monospace', fontSize: 'var(--text-xs)', color: 'var(--text)' }}>{endpoint.path}</span>
        <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)', flex: 1 }}>{endpoint.summary}</span>
        <Id>{endpoint.scope}</Id>
      </button>
      {show && (
        <div style={{ padding: '14px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {endpoint.description && (
            <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', lineHeight: 1.6, maxWidth: '76ch' }}>
              {endpoint.description}
            </p>
          )}
          <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', fontFamily: 'monospace' }}>
            {endpointUrl(version, endpoint, 'sandbox')}
          </div>
          {endpoint.request_example != null && (
            <div><Heading>Request</Heading><Code>{JSON.stringify(endpoint.request_example, null, 2)}</Code></div>
          )}
          <div><Heading>Response</Heading><Code>{JSON.stringify(endpoint.response_example, null, 2)}</Code></div>
          <div>
            <Heading>From your terminal</Heading>
            <Code>{curlFor(version, endpoint, 'sandbox', 'YOUR_CLIENT_ID')}</Code>
          </div>
        </div>
      )}
    </div>
  )
}

/* ---- The console --------------------------------------------------------- */

/* This is the part that was missing entirely, and the part that makes the rest
   worth reading: the button sends the call. If the key is wrong, the scope is
   wrong or the subscription is not there, the answer is the one production
   would give. */
function ConsoleTab({ versions, credentials, applications, subscriptions, onDone }: {
  versions: Version[]; credentials: Credential[]
  applications: Application[]; subscriptions: Subscription[]; onDone: () => void
}) {
  const usableKeys = useMemo(() => credentials.filter(usable), [credentials])
  const [credId, setCredId] = useState(usableKeys[0]?.id ?? '')
  const [verId, setVerId] = useState(versions.find(v => v.lifecycle === 'current')?.id ?? versions[0]?.id ?? '')
  const [epId, setEpId] = useState('')
  const [body, setBody] = useState('')
  const [result, setResult] = useState<SandboxResult | null>(null)
  const [sending, setSending] = useState(false)

  const version = versions.find(v => v.id === verId)
  const endpoint = version?.endpoints.find(e => e.id === epId) ?? version?.endpoints[0]
  const cred = usableKeys.find(c => c.id === credId)
  const app = applications.find(a => a.id === cred?.application_id)

  useEffect(() => {
    if (version && !version.endpoints.some(e => e.id === epId)) setEpId(version.endpoints[0]?.id ?? '')
  }, [version, epId])

  useEffect(() => {
    setBody(endpoint?.request_example ? JSON.stringify(endpoint.request_example, null, 2) : '')
  }, [endpoint])

  const verdict = app && version && endpoint
    ? callability(subscriptions, app.id, 'sandbox', version, endpoint)
    : null

  const send = async () => {
    if (!cred || !endpoint) return
    setSending(true)
    let parsed: unknown = null
    if (body.trim()) {
      try { parsed = JSON.parse(body) } catch { toast('That body is not valid JSON.', 'error'); setSending(false); return }
    }
    const r = await sandboxCall(cred.id, endpoint.id, parsed)
    setSending(false)
    if (!r.ok) { toast(r.reason, 'error'); return }
    setResult(r.data)
    onDone()
  }

  if (usableKeys.length === 0) {
    return (
      <SectionCard title="Sandbox console" subtitle="Nothing to send with yet">
        <div style={{ padding: '24px' }}>
          <EmptyState message="Register an application first. Its sandbox key is issued straight away, and this console will send with it." />
        </div>
      </SectionCard>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <Callout tone="info" title="These calls really happen">
        The credential, the subscription and the scope are all checked against your own records, and reads
        answer with your own rows. Writes are validated and echoed — nothing is stored, so you can send them
        as often as you like without filling the marketplace with test data.
      </Callout>

      <SectionCard title="Sandbox console" subtitle="Pick a key, pick an endpoint, send it">
        <div style={{ padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px' }}>
            <FormField label="Credential">
              <Select value={credId} onChange={e => setCredId(e.target.value)}>
                {usableKeys.map(c => (
                  <option key={c.id} value={c.id}>
                    {applications.find(a => a.id === c.application_id)?.name ?? c.application_id} — {c.secret_prefix}…
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField label="API version">
              <Select value={verId} onChange={e => setVerId(e.target.value)}>
                {versions.map(v => (
                  <option key={v.id} value={v.id}>{v.api_name} {v.version}{v.lifecycle !== 'current' ? ` (${LIFECYCLE_LABEL[v.lifecycle]})` : ''}</option>
                ))}
              </Select>
            </FormField>
            <FormField label="Endpoint">
              <Select value={endpoint?.id ?? ''} onChange={e => setEpId(e.target.value)}>
                {(version?.endpoints ?? []).map(e => (
                  <option key={e.id} value={e.id}>{e.method} {e.path}</option>
                ))}
              </Select>
            </FormField>
          </div>

          {verdict && !verdict.ok && (
            <Callout tone="warning" title="This will be refused, and you can send it anyway">
              {verdict.reason} Sending it shows you exactly what your code will receive.
            </Callout>
          )}

          {endpoint && endpoint.method !== 'GET' && (
            <FormField label="Request body" hint="JSON. Validated and echoed — nothing is written.">
              <TextArea rows={6} value={body} onChange={e => setBody(e.target.value)}
                        style={{ fontFamily: 'monospace', fontSize: 'var(--text-xs)' }} />
            </FormField>
          )}

          <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
            <Btn variant="primary" disabled={sending || !endpoint} onClick={() => void send()}>
              <Play size={14} /> {sending ? 'Sending…' : `Send ${endpoint?.method ?? ''} ${endpoint?.path ?? ''}`}
            </Btn>
            {endpoint && (
              <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', fontFamily: 'monospace' }}>
                needs {endpoint.scope}
              </span>
            )}
          </div>

          {result && <ResultPanel result={result} />}
        </div>
      </SectionCard>

      {app && version && (
        <SectionCard title="What this application holds on sandbox" subtitle="The scopes any call from it can carry">
          <div style={{ padding: '16px 20px', fontSize: 'var(--text-sm)', fontFamily: 'monospace' }}>
            {scopesHeld(subscriptions, app.id, 'sandbox').join(', ') || 'Nothing yet — subscribe to an API first.'}
          </div>
        </SectionCard>
      )}
    </div>
  )
}

function ResultPanel({ result }: { result: SandboxResult }) {
  const tone = statusTone(result.response.status)
  const colour = tone === 'ok' ? 'var(--success)' : tone === 'client' ? 'var(--warning)' : 'var(--danger)'
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      <div style={{ display: 'flex', gap: '12px', alignItems: 'baseline', flexWrap: 'wrap' }}>
        <span style={{ fontWeight: 800, fontSize: 'var(--text-lg)', color: colour }}>{result.response.status}</span>
        <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>{result.response.ms}ms</span>
        <span style={{ fontFamily: 'monospace', fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>
          {result.request.method} {result.request.url}
        </span>
      </div>
      <div>
        <Heading>Request headers</Heading>
        <Code>{Object.entries(result.request.headers).map(([k, v]) => `${k}: ${v}`).join('\n')}</Code>
      </div>
      <div>
        <Heading>Response body</Heading>
        <Code>{JSON.stringify(result.response.body, null, 2)}</Code>
      </div>
    </div>
  )
}

/* ---- Production access ---------------------------------------------------- */

function RequestsTab({ subscriptions, applications }: {
  subscriptions: Subscription[]; applications: Application[]
}) {
  const requests = subscriptions.filter(s => s.environment === 'production')

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <Callout tone="info" title="Sandbox is yours; production is asked for">
        Sandbox keys are issued the moment you register, because deciding whether to integrate should not
        take a week. Production carries other people's customers and other people's money, so the
        marketplace decides — on the sentence you write saying what it is for.
      </Callout>

      {requests.length === 0 ? (
        <SectionCard title="No production access requested" subtitle="Subscribe to an API and choose production">
          <div style={{ padding: '24px' }}>
            <EmptyState message="When you are ready, subscribe again with production selected and say what it is for." />
          </div>
        </SectionCard>
      ) : (
        <SectionCard title="Production requests" subtitle={`${requests.length} on record`}>
          <div style={{ padding: '10px 0' }}>
            {requests.map(s => (
              <div key={s.id} style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)' }}>
                <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap', marginBottom: '6px' }}>
                  <StatusPill status={s.state} />
                  <strong style={{ fontSize: 'var(--text-sm)' }}>{s.api_name} {s.version}</strong>
                  <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
                    {applications.find(a => a.id === s.application_id)?.name ?? s.application_id} ·
                    {' '}{s.scopes.join(', ')}
                  </span>
                  {s.requested_at && (
                    <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
                      asked {fmtDate(s.requested_at)}
                      {s.state === 'pending' && (() => {
                        const d = daysUntil(s.requested_at)
                        return d !== null ? ` · waiting ${Math.abs(d)} day${Math.abs(d) === 1 ? '' : 's'}` : ''
                      })()}
                    </span>
                  )}
                </div>
                {s.use_case && (
                  <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', lineHeight: 1.6, maxWidth: '80ch' }}>
                    <span style={{ color: 'var(--text-tertiary)' }}>You said: </span>{s.use_case}
                  </p>
                )}
                {s.decision_note && (
                  <div style={{
                    marginTop: '8px', padding: '10px 12px', borderRadius: 'var(--radius)',
                    background: s.state === 'refused' ? 'var(--danger-bg)' : 'var(--success-bg)',
                    fontSize: 'var(--text-sm)', lineHeight: 1.6,
                    color: s.state === 'refused' ? 'var(--danger)' : 'var(--success)', maxWidth: '80ch',
                  }}>
                    <strong>{s.state === 'refused' ? 'Refused' : 'Approved'}
                      {s.decided_by ? ` by ${s.decided_by}` : ''}
                      {s.decided_at ? ` on ${fmtDate(s.decided_at)}` : ''}.</strong>{' '}
                    {s.decision_note}
                  </div>
                )}
                {s.state === 'pending' && (
                  <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', marginTop: '6px' }}>
                    Your sandbox access is unaffected while they decide.
                  </p>
                )}
              </div>
            ))}
          </div>
        </SectionCard>
      )}
    </div>
  )
}

/* ---- Modals --------------------------------------------------------------- */

function RegisterModal({ onClose, onDone }: { onClose: () => void; onDone: (r: IssuedCredential) => void }) {
  const [form, setForm] = useState({ name: '', description: '', contactName: '', contactEmail: '' })
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    setBusy(true)
    const r = await registerApplication(form.name, form.description, form.contactName, form.contactEmail)
    setBusy(false)
    if (!r.ok) { toast(r.reason, 'error'); return }
    onDone(r.data)
  }

  return (
    <Modal open onClose={onClose} title="Register an application"
      footer={<><Btn variant="secondary" onClick={onClose}>Cancel</Btn>
               <Btn disabled={busy} onClick={() => void submit()}>{busy ? 'Issuing…' : 'Register and issue sandbox keys'}</Btn></>}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
        <Callout tone="info">
          Sandbox credentials are issued immediately — no approval. Production is a separate request you
          make once the integration works.
        </Callout>
        <FormField label="Name" required hint="How you will tell its keys apart from your other applications'.">
          <TextInput value={form.name} onChange={e => setForm({ ...form, name: e.target.value })}
                     placeholder="Fulfilment integration" />
        </FormField>
        <FormField label="What it does" required hint="A key with no stated purpose is one nobody can safely revoke later.">
          <TextArea rows={3} value={form.description} onChange={e => setForm({ ...form, description: e.target.value })}
                    placeholder="Receives orders into our WMS and acknowledges them." />
        </FormField>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
          <FormField label="Technical contact" required>
            <TextInput value={form.contactName} onChange={e => setForm({ ...form, contactName: e.target.value })} />
          </FormField>
          <FormField label="Contact email" required hint="Where expiry and failure notices go.">
            <TextInput value={form.contactEmail} onChange={e => setForm({ ...form, contactEmail: e.target.value })} />
          </FormField>
        </div>
      </div>
    </Modal>
  )
}

/* The one screen in the product that shows a secret. It says so, loudly,
   because the developer has one chance to copy it. */
function SecretModal({ issued, onClose }: { issued: IssuedCredential; onClose: () => void }) {
  return (
    <Modal open onClose={onClose} title="Copy this secret now"
           footer={<Btn onClick={onClose}>I have stored it</Btn>}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
        <Callout tone="warning" title="This is the only time it will be shown">
          {issued.note}
        </Callout>
        <div>
          <Heading>Client ID</Heading>
          <Code copy>{issued.client_id}</Code>
        </div>
        <div>
          <Heading>Client secret</Heading>
          <Code copy>{issued.client_secret}</Code>
        </div>
        <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', lineHeight: 1.6 }}>
          Stored as a salted hash. Nobody at the marketplace can read it back, and neither can this screen
          once you close it. If you lose it, rotate the credential — that issues a replacement and leaves the
          old one working for a grace period you choose.
        </p>
      </div>
    </Modal>
  )
}

function SubscribeModal({ version, applications, subscriptions, onClose, onDone }: {
  version: Version; applications: Application[]; subscriptions: Subscription[]
  onClose: () => void; onDone: () => void
}) {
  const [appId, setAppId] = useState(applications[0]?.id ?? '')
  const [env, setEnv] = useState<Environment>('sandbox')
  const [scopes, setScopes] = useState<string[]>([])
  const [useCase, setUseCase] = useState('')
  const [busy, setBusy] = useState(false)

  const already = subscriptions.find(s =>
    s.application_id === appId && s.version_id === version.id && s.environment === env)

  const submit = async () => {
    setBusy(true)
    const r = await subscribeApplication(appId, version.id, env, scopes, useCase)
    setBusy(false)
    if (!r.ok) { toast(r.reason, 'error'); return }
    toast(r.data.note)
    onDone()
  }

  return (
    <Modal open onClose={onClose} title={`Subscribe to ${version.api_name} ${version.version}`}
      footer={<><Btn variant="secondary" onClick={onClose}>Cancel</Btn>
               <Btn disabled={busy || !!already} onClick={() => void submit()}>
                 {busy ? 'Sending…' : env === 'production' ? 'Ask for production' : 'Subscribe'}
               </Btn></>}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
        {already && (
          <Callout tone="warning" title="Already subscribed">
            {applications.find(a => a.id === appId)?.name} already holds this version on {env} — it is {already.state}.
          </Callout>
        )}

        <FormField label="Application" required>
          <Select value={appId} onChange={e => setAppId(e.target.value)}>
            {applications.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
          </Select>
        </FormField>

        <FormField label="Environment" hint="Sandbox is granted immediately. Production is decided by the marketplace.">
          <Select value={env} onChange={e => setEnv(e.target.value as Environment)}>
            <option value="sandbox">Sandbox — test data, issued now</option>
            <option value="production">Production — real customers, needs approval</option>
          </Select>
        </FormField>

        <FormField label="Scopes" required hint="Ask for what you will call and nothing more. Each endpoint's reference says which it needs.">
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {version.scopes.map(s => (
              <label key={s} style={{ display: 'flex', gap: '8px', alignItems: 'center', fontSize: 'var(--text-sm)', cursor: 'pointer' }}>
                <input type="checkbox" checked={scopes.includes(s)}
                       onChange={e => setScopes(e.target.checked ? [...scopes, s] : scopes.filter(x => x !== s))} />
                <span style={{ fontFamily: 'monospace', fontSize: 'var(--text-xs)' }}>{s}</span>
                <span style={{ color: 'var(--text-tertiary)' }}>
                  {version.endpoints.filter(e => e.scope === s).length} endpoint
                  {version.endpoints.filter(e => e.scope === s).length === 1 ? '' : 's'}
                </span>
              </label>
            ))}
          </div>
        </FormField>

        {env === 'production' && (
          <FormField label="What will this be used for?" required
                     hint="The desk decides on this sentence. Say what it does and why sandbox is no longer enough.">
            <TextArea rows={4} value={useCase} onChange={e => setUseCase(e.target.value)} />
          </FormField>
        )}
      </div>
    </Modal>
  )
}

function RotateModal({ credential, onClose, onDone }: {
  credential: Credential; onClose: () => void; onDone: (r: IssuedCredential) => void
}) {
  const [days, setDays] = useState(7)
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    setBusy(true)
    const r = await rotateCredential(credential.id, days)
    setBusy(false)
    if (!r.ok) { toast(r.reason, 'error'); return }
    toast(r.data.note)
    onDone(r.data)
  }

  return (
    <Modal open onClose={onClose} title="Rotate this credential"
      footer={<><Btn variant="secondary" onClick={onClose}>Cancel</Btn>
               <Btn disabled={busy} onClick={() => void submit()}>{busy ? 'Issuing…' : 'Issue the replacement'}</Btn></>}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
        <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', lineHeight: 1.7 }}>
          A new secret is issued now. The current one — <code>{credential.secret_prefix}…</code> — keeps
          working for the grace period, so you can deploy the replacement without an outage.
        </p>
        <FormField label="Grace period" hint="Zero stops the old key immediately. Anything up to 30 days.">
          <Select value={String(days)} onChange={e => setDays(Number(e.target.value))}>
            <option value="0">None — stop the old key now</option>
            <option value="1">1 day</option>
            <option value="7">7 days</option>
            <option value="14">14 days</option>
            <option value="30">30 days</option>
          </Select>
        </FormField>
        {days === 0 && (
          <Callout tone="warning" title="Anything still using the old key will start failing immediately">
            Choose this only if the key is known to be exposed.
          </Callout>
        )}
      </div>
    </Modal>
  )
}

function RevokeModal({ credential, onClose, onDone }: {
  credential: Credential; onClose: () => void; onDone: () => void
}) {
  const [why, setWhy] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    setBusy(true)
    const r = await revokeCredential(credential.id, why)
    setBusy(false)
    if (!r.ok) { toast(r.reason, 'error'); return }
    toast(r.data.note)
    onDone()
  }

  return (
    <Modal open onClose={onClose} title="Revoke this credential"
      footer={<><Btn variant="secondary" onClick={onClose}>Cancel</Btn>
               <Btn variant="danger" disabled={busy} onClick={() => void submit()}>{busy ? 'Revoking…' : 'Revoke it'}</Btn></>}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
        <Callout tone="danger" title="Calls with this key start failing immediately">
          There is no grace period on a revocation. If you only want to replace it, rotate instead.
        </Callout>
        <FormField label="Why?" required hint="A revoked key with no reason is one nobody can explain later.">
          <TextArea rows={3} value={why} onChange={e => setWhy(e.target.value)}
                    placeholder="Committed to a public repository by a contractor." />
        </FormField>
      </div>
    </Modal>
  )
}

/* ---- Small pieces --------------------------------------------------------- */

async function download(v: Version) {
  const spec = await loadSpec(v.id)
  if (!spec) { toast('The specification did not load.', 'error'); return }
  const blob = new Blob([JSON.stringify(spec, null, 2)], { type: 'application/json' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `${v.api_id.toLowerCase()}-${v.version}-openapi.json`
  a.click()
  URL.revokeObjectURL(a.href)
  toast(`OpenAPI 3.1 for ${v.api_name} ${v.version} downloaded.`)
}

function tabStyle(on: boolean): React.CSSProperties {
  return {
    padding: '8px 16px', borderRadius: 'var(--radius)', fontSize: 'var(--text-sm)', fontWeight: 600,
    background: on ? 'var(--brand-navy)' : 'white', color: on ? 'white' : 'var(--text-secondary)',
    border: '1px solid var(--border)', cursor: 'pointer',
  }
}

function Heading({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontSize: 'var(--text-xs)', fontWeight: 700, color: 'var(--text-tertiary)',
      textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '8px',
    }}>{children}</div>
  )
}

function Code({ children, copy }: { children: string; copy?: boolean }) {
  return (
    <div style={{ position: 'relative' }}>
      <pre style={{
        margin: 0, padding: '12px 14px', borderRadius: 'var(--radius)',
        background: 'var(--brand-navy)', color: '#e8eef7',
        fontSize: 'var(--text-xs)', lineHeight: 1.6, overflow: 'auto',
        whiteSpace: 'pre', fontFamily: 'monospace',
        /* A real catalogue response runs to hundreds of lines. Without this the
           page grows to the length of the JSON and the controls that sent it
           scroll off the top. */
        maxHeight: '420px',
      }}>{children}</pre>
      {copy && (
        <button onClick={() => { void navigator.clipboard?.writeText(children); toast('Copied.') }}
                style={{
                  position: 'absolute', top: '8px', right: '8px', padding: '4px 8px',
                  borderRadius: '4px', border: '1px solid rgba(255,255,255,0.25)',
                  background: 'rgba(255,255,255,0.1)', color: '#e8eef7',
                  fontSize: 'var(--text-xs)', cursor: 'pointer',
                }}>
          <Copy size={11} /> Copy
        </button>
      )}
    </div>
  )
}

function CopyText({ value }: { value: string }) {
  return (
    <button onClick={() => { void navigator.clipboard?.writeText(value); toast('Copied.') }}
            title="Copy"
            style={{ background: 'none', border: 'none', padding: 0, font: 'inherit', cursor: 'pointer', color: 'var(--text)' }}>
      {value}
    </button>
  )
}

function Figure({ label, value, tone }: { label: string; value: string; tone?: 'bad' }) {
  return (
    <div>
      <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>{label}</div>
      <div style={{ fontWeight: 700, color: tone === 'bad' ? 'var(--danger)' : 'var(--text)' }}>{value}</div>
    </div>
  )
}
