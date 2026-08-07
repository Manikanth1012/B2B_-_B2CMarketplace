import { useState, useEffect, useCallback } from 'react'
import { Plus, Check, X, Ban, RefreshCw, PauseCircle, PlayCircle, ChevronDown, ChevronRight } from 'lucide-react'
import { Pager, usePaging } from '../Pager'
import { supabase } from '../../lib/supabase'
import type { OperatorApi } from '../../types'
import {
  SectionCard, StatCard, Table, Td, StatusPill, EmptyState, fmtInt, fmtDate, Btn,
  Modal, FormField, TextInput, Select, TextArea, toast, Id,
} from './shared'
import { Callout } from '../OnboardingJourney'
import {
  LIFECYCLE_LABEL, KEY_STATE_LABEL, keyNote, maskedSecret, usable, sunsetWarning,
  usageOf, statusBreakdown, productionQueue, publishable, deprecatable, LIMITS, daysUntil, specSize,
} from '../../lib/devPortal'
import type { Version, Credential, Application, Subscription } from '../../lib/devPortal'
import {
  loadPortalAdmin, decideProductionAccess, publishVersion, addEndpoint,
  setLifecycle, setApplicationStatus, revokeCredential, rotateCredential,
} from '../../lib/devPortalRepo'
import type { PortalAdmin } from '../../lib/devPortalRepo'

/* The marketplace's half of the developer portal.
 *
 * What was here published an API by asking for a name, a TM Forum number, a
 * version string and a one-line reason, and then offered a red Delete beside
 * every row. Both are wrong in the same direction: publishing produced
 * something no developer could call, and deleting took it away from whoever
 * was still calling it — with no notice, no sunset date, and no record it had
 * ever existed.
 *
 * So publishing now demands a version with a base path and at least one
 * endpoint, because a version with none is a name rather than an API. And
 * Delete is replaced by deprecation: a date at least a release cycle out and a
 * note saying what to do instead, which is what a caller needs in order to
 * move. Retiring a version is still possible — it is just something that
 * happens after the sunset date the callers were told about.
 *
 * The queue is the other half. Sellers can now ask for production, so somebody
 * has to answer, and a refusal has to carry a reason the seller can act on.
 */
type Tab = 'apis' | 'queue' | 'applications' | 'traffic'

export function OperatorDeveloper() {
  const [admin, setAdmin] = useState<PortalAdmin | null>(null)
  const [apis, setApis] = useState<OperatorApi[]>([])
  const [tab, setTab] = useState<Tab>('apis')
  const [publishing, setPublishing] = useState<OperatorApi | null>(null)
  const [addingApi, setAddingApi] = useState(false)
  const [editApi, setEditApi] = useState<OperatorApi | null>(null)
  const [deprecating, setDeprecating] = useState<Version | null>(null)
  const [deciding, setDeciding] = useState<Subscription | null>(null)
  const [minted, setMinted] = useState<{ client_id?: string; client_secret?: string; note: string } | null>(null)
  const [suspending, setSuspending] = useState<Application | null>(null)

  const reload = useCallback(async () => {
    const [a, list] = await Promise.all([
      loadPortalAdmin(),
      supabase.from('operator_apis').select('*').order('sort_order'),
    ])
    setAdmin(a)
    if (list.data) setApis(list.data as OperatorApi[])
  }, [])

  useEffect(() => { void reload() }, [reload])

  if (!admin) return <div style={{ textAlign: 'center', padding: '40px' }}><div className="spinner" style={{ margin: '0 auto' }} /></div>

  const { versions, subscriptions, applications, credentials, usage } = admin
  const queue = productionQueue(subscriptions)
  const liveSubs = subscriptions.filter(s => s.state === 'active')
  const undocumented = versions.filter(v => v.endpoints.length === 0)
  const sandboxUse = usageOf(usage.filter(r => r.environment === 'sandbox'), LIMITS.sandbox.quota)
  const liveUse = usageOf(usage.filter(r => r.environment === 'production'), LIMITS.production.quota)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '16px', flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontSize: 'var(--text-2xl)', fontWeight: 800, color: 'var(--text)' }}>Developer Portal</h1>
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)', marginTop: '4px' }}>
            {apis.length} APIs · {versions.length} versions · {liveSubs.length} live subscriptions ·
            {' '}{applications.length} applications · {credentials.filter(usable).length} keys authenticating
          </p>
        </div>
        <Btn onClick={() => setAddingApi(true)}><Plus size={14} /> Publish an API</Btn>
      </div>

      {admin.loadError && <Callout tone="danger" title="Some of this did not load">{admin.loadError}</Callout>}

      {queue.length > 0 && (
        <Callout tone={queue[0].waitingDays > 5 ? 'warning' : 'info'}
                 title={`${queue.length} production request${queue.length === 1 ? '' : 's'} waiting`}>
          {queue[0].sub.consumer_name} has been waiting {queue[0].waitingDays} day
          {queue[0].waitingDays === 1 ? '' : 's'} on {queue[0].sub.api_name} {queue[0].sub.version}.{' '}
          <button onClick={() => setTab('queue')} style={linkStyle}>Decide it</button>
        </Callout>
      )}

      {versions.some(v => v.spec && !v.spec.is_tmf_standard) && (
        <Callout tone="warning" title="Two published APIs carry a file that is not the standard they name">
          {versions.filter(v => v.spec && !v.spec.is_tmf_standard)
                   .map(v => `${v.api_name} (${v.spec!.tmf} — ${v.spec!.title} ${v.spec!.declared_version})`)
                   .join(', ')}. A developer looking up the standard will find a different document from
          the one published here. Replace the file, or change what the API claims to implement.
        </Callout>
      )}

      {undocumented.length > 0 && (
        <Callout tone="warning" title={`${undocumented.length} published version${undocumented.length === 1 ? ' has' : 's have'} no endpoints`}>
          {undocumented.map(v => `${v.api_name} ${v.version}`).join(', ')} — a developer opening the reference
          finds nothing to call. Add endpoints or move it back to draft.
        </Callout>
      )}

      <div className="stat-row">
        <StatCard label="Production requests waiting" value={String(queue.length)}
                  sublabel={queue.length ? `Oldest ${queue[0].waitingDays} days` : 'Queue is clear'}
                  color={queue.length ? 'var(--warning)' : 'var(--success)'} />
        <StatCard label="Keys authenticating" value={String(credentials.filter(usable).length)}
                  sublabel={`${credentials.filter(c => c.state === 'revoked').length} revoked · ${credentials.filter(c => c.state === 'retiring').length} rotating`} />
        <StatCard label="Sandbox traffic" value={fmtInt(sandboxUse.calls)}
                  sublabel={sandboxUse.successRate === null ? 'No calls recorded' : `${sandboxUse.successRate}% succeeded`} />
        <StatCard label="Production traffic" value={fmtInt(liveUse.calls)}
                  sublabel={liveUse.successRate === null ? 'No calls recorded' : `${liveUse.successRate}% succeeded`}
                  color={liveUse.successRate !== null && liveUse.successRate < 95 ? 'var(--danger)' : undefined} />
      </div>

      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
        {([
          ['apis', `APIs and versions`], ['queue', `Production queue${queue.length ? ` (${queue.length})` : ''}`],
          ['applications', 'Applications and keys'], ['traffic', 'Traffic'],
        ] as [Tab, string][]).map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)} style={tabStyle(tab === id)}>{label}</button>
        ))}
      </div>

      {tab === 'apis' && (
        <ApisTab apis={apis} versions={versions} subscriptions={subscriptions}
                 onEdit={setEditApi} onPublishVersion={setPublishing}
                 onDeprecate={setDeprecating} onChanged={() => void reload()} />
      )}

      {tab === 'queue' && (
        <QueueTab subscriptions={subscriptions} applications={applications} onDecide={setDeciding} />
      )}

      {tab === 'applications' && (
        <ApplicationsTab admin={admin} onSuspend={setSuspending}
                         onChanged={() => void reload()} onMinted={setMinted} />
      )}

      {tab === 'traffic' && <TrafficTab admin={admin} />}

      {(addingApi || editApi) && (
        <ApiModal api={editApi}
                  onClose={() => { setAddingApi(false); setEditApi(null) }}
                  onSaved={async () => { setAddingApi(false); setEditApi(null); await reload() }} />
      )}

      {publishing && (
        <PublishVersionModal api={publishing} onClose={() => setPublishing(null)}
                             onDone={async () => { setPublishing(null); await reload() }} />
      )}

      {deprecating && (
        <DeprecateModal version={deprecating} subscriptions={subscriptions}
                        onClose={() => setDeprecating(null)}
                        onDone={async () => { setDeprecating(null); await reload() }} />
      )}

      {deciding && (
        <DecideModal sub={deciding} applications={applications}
                     onClose={() => setDeciding(null)}
                     onDone={async (r) => { setDeciding(null); if (r) setMinted(r); await reload() }} />
      )}

      {minted && <MintedModal minted={minted} onClose={() => setMinted(null)} />}

      {suspending && (
        <SuspendModal app={suspending} onClose={() => setSuspending(null)}
                      onDone={async () => { setSuspending(null); await reload() }} />
      )}
    </div>
  )
}

/* ---- APIs and their versions ---------------------------------------------- */

function ApisTab({ apis, versions, subscriptions, onEdit, onPublishVersion, onDeprecate, onChanged }: {
  apis: OperatorApi[]; versions: Version[]; subscriptions: Subscription[]
  onEdit: (a: OperatorApi) => void; onPublishVersion: (a: OperatorApi) => void
  onDeprecate: (v: Version) => void; onChanged: () => void
}) {
  const page = usePaging(apis)
  const [open, setOpen] = useState<string | null>(null)

  const retire = async (v: Version) => {
    const left = daysUntil(v.sunset_on)
    if (left !== null && left > 0) {
      toast(`Callers were told this runs until ${v.sunset_on}. Retiring it now breaks that promise.`, 'error')
      return
    }
    const r = await setLifecycle(v.id, 'retired')
    toast(r.ok ? 'Retired. It no longer accepts calls, and its record stays.' : r.reason, r.ok ? 'success' : 'error')
    onChanged()
  }

  const makeCurrent = async (v: Version) => {
    const r = await setLifecycle(v.id, 'current')
    toast(r.ok ? `${v.api_name} ${v.version} is current.` : r.reason, r.ok ? 'success' : 'error')
    onChanged()
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      <Callout tone="info" title="Deprecation, not deletion">
        A published API is something other people's code depends on. Deleting one takes it away with no
        notice and no record it existed — so a version is deprecated with a sunset date and a migration
        note, and only retired once that date has passed.
      </Callout>

      {apis.length === 0 ? <EmptyState message="No APIs published" /> : (
        <>
          {page.rows.map(a => {
            const vs = versions.filter(v => v.api_id === a.id)
            const isOpen = open === a.id
            const subs = subscriptions.filter(s => s.api_id === a.id && s.state === 'active')
            return (
              <SectionCard key={a.id} title={a.name}
                subtitle={`${a.standard} · ${a.audience} · ${vs.length} version${vs.length === 1 ? '' : 's'} · ${subs.length} live subscription${subs.length === 1 ? '' : 's'} · ${a.why}`}
                action={
                  <div style={{ display: 'flex', gap: '6px' }}>
                    <Btn variant="secondary" size="sm" onClick={() => onEdit(a)}>Edit</Btn>
                    <Btn size="sm" onClick={() => onPublishVersion(a)}><Plus size={12} /> Version</Btn>
                    <Btn variant="secondary" size="sm" onClick={() => setOpen(isOpen ? null : a.id)}>
                      {isOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />} Versions
                    </Btn>
                  </div>
                }>
                {isOpen && (
                  <div style={{ padding: '8px 0' }}>
                    {vs.length === 0 ? (
                      <EmptyState message="No versions. Nobody can call this API until one is published with endpoints." />
                    ) : (
                      <Table headers={['Version', 'Lifecycle', 'Base path', 'Specification', 'Live here', 'Callers', 'Sunset', 'Actions']}>
                        {vs.map(v => {
                          const callers = subscriptions.filter(s => s.version_id === v.id && s.state === 'active')
                          const warn = sunsetWarning(v)
                          return (
                            <tr key={v.id}>
                              <Td><strong>{v.version}</strong></Td>
                              {/* The lifecycle word itself. Mapping it onto
                                  another status made the pill say "pending"
                                  under a version that was deprecated. */}
                              <Td><StatusPill status={v.lifecycle} /></Td>
                              <Td style={{ fontFamily: 'monospace', fontSize: 'var(--text-xs)' }}>{v.base_path}</Td>
                              {/* The published document, which is the thing a
                                  developer asks for and the operator had no
                                  way of seeing was missing. */}
                              <Td style={{ fontSize: 'var(--text-xs)' }}>
                                {v.spec ? (
                                  <a href={v.spec.file_path} download
                                     style={{ color: 'var(--info)', textDecoration: 'none' }}>
                                    {v.spec.tmf} {v.spec.declared_version}
                                    <span style={{ color: 'var(--text-tertiary)' }}>
                                      {' · '}{v.spec.operation_count} ops · {specSize(v.spec.file_bytes)}
                                    </span>
                                    {!v.spec.is_tmf_standard && (
                                      <span style={{ color: 'var(--warning)' }}> · not the standard</span>
                                    )}
                                  </a>
                                ) : <span style={{ color: 'var(--danger)', fontWeight: 600 }}>none published</span>}
                              </Td>
                              <Td right>
                                {v.endpoints.length === 0
                                  ? <span style={{ color: 'var(--danger)', fontWeight: 600 }}>none</span>
                                  : v.endpoints.length}
                              </Td>
                              <Td right>{callers.length}</Td>
                              <Td style={{ fontSize: 'var(--text-xs)', maxWidth: '30ch' }}>
                                {v.sunset_on
                                  ? <span style={{ color: warn?.tone === 'danger' ? 'var(--danger)' : 'var(--warning)' }}>
                                      {v.sunset_on}{callers.length ? ` · ${callers.length} still calling` : ''}
                                    </span>
                                  : <span style={{ color: 'var(--text-tertiary)' }}>—</span>}
                              </Td>
                              <Td right>
                                <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                                  {v.lifecycle === 'draft' && (
                                    <Btn size="sm" onClick={() => void makeCurrent(v)}>Make current</Btn>
                                  )}
                                  {(v.lifecycle === 'current' || v.lifecycle === 'draft') && (
                                    <Btn variant="secondary" size="sm" onClick={() => onDeprecate(v)}>Deprecate</Btn>
                                  )}
                                  {v.lifecycle === 'deprecated' && (() => {
                                    /* Offering a button that always refuses is
                                       worse than not offering it. It becomes
                                       live on the date the callers were given. */
                                    const left = daysUntil(v.sunset_on)
                                    const early = left !== null && left > 0
                                    return (
                                      <Btn variant="danger" size="sm" disabled={early}
                                           title={early
                                             ? `Callers were told this runs until ${v.sunset_on} — ${left} days away.`
                                             : 'The sunset date has passed.'}
                                           onClick={() => void retire(v)}>
                                        Retire
                                      </Btn>
                                    )
                                  })()}
                                </div>
                              </Td>
                            </tr>
                          )
                        })}
                      </Table>
                    )}
                  </div>
                )}
              </SectionCard>
            )
          })}
          <div style={{ padding: '0 4px' }}><Pager page={page} noun="APIs" /></div>
        </>
      )}
    </div>
  )
}

/* ---- The queue ------------------------------------------------------------ */

function QueueTab({ subscriptions, applications, onDecide }: {
  subscriptions: Subscription[]; applications: Application[]; onDecide: (s: Subscription) => void
}) {
  const queue = productionQueue(subscriptions)
  const decided = subscriptions
    .filter(s => s.environment === 'production' && s.state !== 'pending' && s.decided_at)
    .sort((a, b) => (b.decided_at ?? '').localeCompare(a.decided_at ?? ''))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <SectionCard title="Waiting on a decision"
                   subtitle={queue.length ? `${queue.length} request${queue.length === 1 ? '' : 's'}, oldest first` : 'Nothing outstanding'}>
        {queue.length === 0 ? (
          <div style={{ padding: '20px' }}><EmptyState message="No production requests waiting. Sellers keep their sandbox access either way." /></div>
        ) : (
          <div>
            {queue.map(({ sub, waitingDays }) => (
              <div key={sub.id} style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)' }}>
                <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap', marginBottom: '8px' }}>
                  <strong style={{ fontSize: 'var(--text-base)' }}>{sub.consumer_name}</strong>
                  <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>
                    {sub.api_name} {sub.version}
                  </span>
                  {sub.scopes.map(s => <Id key={s}>{s}</Id>)}
                  <span style={{
                    fontSize: 'var(--text-xs)', fontWeight: 700,
                    color: waitingDays > 5 ? 'var(--danger)' : 'var(--text-tertiary)',
                  }}>
                    waiting {waitingDays} day{waitingDays === 1 ? '' : 's'}
                  </span>
                </div>
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', marginBottom: '8px' }}>
                  Application: {applications.find(a => a.id === sub.application_id)?.name ?? sub.application_id}
                  {' · '}asked {fmtDate(sub.requested_at)}
                </div>
                {sub.use_case && (
                  <p style={{
                    fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', lineHeight: 1.7,
                    maxWidth: '84ch', padding: '10px 14px', borderRadius: 'var(--radius)',
                    background: 'var(--info-bg)', marginBottom: '10px',
                  }}>
                    {sub.use_case}
                  </p>
                )}
                <Btn size="sm" onClick={() => onDecide(sub)}>Decide it</Btn>
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      {decided.length > 0 && (
        <SectionCard title="Already decided" subtitle="Every refusal carries the reason the seller was given">
          <Table headers={['Seller', 'API', 'Scopes', 'Decision', 'By', 'When', 'Reason']}>
            {decided.map(s => (
              <tr key={s.id}>
                <Td>{s.consumer_name}</Td>
                <Td>{s.api_name} {s.version}</Td>
                <Td style={{ fontFamily: 'monospace', fontSize: 'var(--text-xs)' }}>{s.scopes.join(', ')}</Td>
                <Td><StatusPill status={s.state} /></Td>
                <Td style={{ fontSize: 'var(--text-xs)' }}>{s.decided_by}</Td>
                <Td right style={{ fontSize: 'var(--text-xs)' }}>{fmtDate(s.decided_at)}</Td>
                <Td style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', maxWidth: '40ch' }}>
                  {s.decision_note}
                </Td>
              </tr>
            ))}
          </Table>
        </SectionCard>
      )}
    </div>
  )
}

/* ---- Applications and their keys ------------------------------------------ */

function ApplicationsTab({ admin, onSuspend, onChanged, onMinted }: {
  admin: PortalAdmin; onSuspend: (a: Application) => void; onChanged: () => void
  onMinted: (m: { client_id?: string; client_secret?: string; note: string }) => void
}) {
  const { applications, credentials, subscriptions, usage, partners } = admin
  const page = usePaging(applications, { initialSize: 10 })

  const lift = async (a: Application) => {
    const r = await setApplicationStatus(a.id, 'active', '')
    toast(r.ok ? 'Suspension lifted. Its keys authenticate again.' : r.reason, r.ok ? 'success' : 'error')
    onChanged()
  }

  const kill = async (c: Credential) => {
    const why = window.prompt('Why is this key being revoked? The seller sees this.')
    if (!why?.trim()) return
    const r = await revokeCredential(c.id, why)
    toast(r.ok ? r.data.note : r.reason, r.ok ? 'success' : 'error')
    onChanged()
  }

  const roll = async (c: Credential) => {
    const r = await rotateCredential(c.id, 7)
    if (!r.ok) { toast(r.reason, 'error'); return }
    onMinted({ client_id: r.data.client_id, client_secret: r.data.client_secret, note: r.data.note })
    onChanged()
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
      {applications.length === 0 ? <EmptyState message="No applications registered" /> : (
        <>
          {page.rows.map(app => {
            const keys = credentials.filter(c => c.application_id === app.id)
            const subs = subscriptions.filter(s => s.application_id === app.id)
            const use = usageOf(usage.filter(r => r.application_id === app.id), LIMITS.production.quota)
            const seller = partners.find(p => p.id === app.partner_id)

            return (
              <SectionCard key={app.id} title={`${seller?.name ?? app.partner_id} — ${app.name}`}
                subtitle={`${app.description} · ${app.contact_name}, ${app.contact_email} · registered ${fmtDate(app.created_at)}`}
                action={
                  app.status === 'suspended'
                    ? <Btn variant="secondary" size="sm" onClick={() => void lift(app)}><PlayCircle size={13} /> Lift suspension</Btn>
                    : <Btn variant="danger" size="sm" onClick={() => onSuspend(app)}><PauseCircle size={13} /> Suspend</Btn>
                }>
                <div style={{ padding: '14px 20px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
                  {app.status === 'suspended' && (
                    <Callout tone="danger" title="Suspended">{app.suspended_why}</Callout>
                  )}

                  <Table headers={['Environment', 'Client ID', 'Secret', 'State', 'Last used', 'Actions']}>
                    {keys.map(c => (
                      <tr key={c.id}>
                        <Td><StatusPill status={c.environment} /></Td>
                        <Td style={{ fontFamily: 'monospace', fontSize: 'var(--text-xs)' }}>{c.client_id}</Td>
                        <Td style={{ fontFamily: 'monospace', fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
                          {maskedSecret(c)}
                        </Td>
                        <Td>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                            <span style={{ fontWeight: 600, fontSize: 'var(--text-xs)' }}>{KEY_STATE_LABEL[c.state]}</span>
                            <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', maxWidth: '32ch' }}>
                              {keyNote(c)}
                            </span>
                          </div>
                        </Td>
                        <Td right style={{ fontSize: 'var(--text-xs)' }}>{c.last_used_at ? fmtDate(c.last_used_at) : 'never'}</Td>
                        <Td right>
                          {usable(c) && (
                            <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end' }}>
                              <Btn variant="secondary" size="sm" onClick={() => void roll(c)}><RefreshCw size={12} /> Rotate</Btn>
                              <Btn variant="danger" size="sm" onClick={() => void kill(c)}><Ban size={12} /> Revoke</Btn>
                            </div>
                          )}
                        </Td>
                      </tr>
                    ))}
                  </Table>

                  <div style={{ display: 'flex', gap: '24px', flexWrap: 'wrap', fontSize: 'var(--text-sm)' }}>
                    <Figure label="Subscriptions" value={`${subs.filter(s => s.state === 'active').length} live`} />
                    <Figure label="Calls recorded" value={fmtInt(use.calls)} />
                    <Figure label="Succeeded" value={use.successRate === null ? '—' : `${use.successRate}%`}
                            tone={use.successRate !== null && use.successRate < 90 ? 'bad' : undefined} />
                    <Figure label="Busiest day" value={use.peakDayOn ? `${fmtInt(use.peakDay)} on ${use.peakDayOn}` : '—'} />
                  </div>
                </div>
              </SectionCard>
            )
          })}
          <div style={{ padding: '0 4px' }}><Pager page={page} noun="applications" /></div>
        </>
      )}
    </div>
  )
}

/* ---- Traffic -------------------------------------------------------------- */

function TrafficTab({ admin }: { admin: PortalAdmin }) {
  const { usage, calls, applications, partners } = admin
  /* `calls` is the most recent page of individual records — enough to list, not
     enough to count from. Every figure below comes from `usage`, which is
     aggregated in the database and therefore sees every call. */
  const failures = calls.filter(c => c.status_code >= 400)
  const page = usePaging(failures, { initialSize: 15 })
  const codes = statusBreakdown(usage)
  const total = codes.reduce((a, c) => a + c.calls, 0)

  const nameOf = (appId: string | null) => {
    const app = applications.find(a => a.id === appId)
    if (!app) return appId ?? '—'
    return `${partners.find(p => p.id === app.partner_id)?.name ?? app.partner_id} — ${app.name}`
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <SectionCard title="What the gateway answered" subtitle={`Every one of ${fmtInt(total)} recorded calls`}>
        <Table headers={['Status', 'Calls', 'Share', 'What it means']}>
          {codes.map(({ code, calls: n, share }) => (
            <tr key={code}>
              <Td><strong style={{
                color: code < 400 ? 'var(--success)' : code < 500 ? 'var(--warning)' : 'var(--danger)',
              }}>{code}</strong></Td>
              <Td right>{fmtInt(n)}</Td>
              <Td right>{share < 0.005 && n > 0 ? '<1%' : `${Math.round(share * 100)}%`}</Td>
              <Td style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>{CODE_MEANING[code] ?? ''}</Td>
            </tr>
          ))}
        </Table>
      </SectionCard>

      <SectionCard title="Recent failures"
                   subtitle={`The ${fmtInt(failures.length)} in the last ${fmtInt(calls.length)} calls — a 401 or 403 here is somebody's integration not working right now`}>
        {failures.length === 0 ? <EmptyState message="Nothing has failed." /> : (
          <>
            <Table headers={['When', 'Caller', 'Call', 'Status']}>
              {page.rows.map(c => (
                <tr key={c.id}>
                  <Td style={{ fontSize: 'var(--text-xs)' }}>{fmtDate(c.called_at)}</Td>
                  <Td style={{ fontSize: 'var(--text-xs)' }}>{nameOf(c.application_id)}</Td>
                  <Td style={{ fontFamily: 'monospace', fontSize: 'var(--text-xs)' }}>{c.method} {c.path}</Td>
                  <Td right><strong style={{ color: c.status_code < 500 ? 'var(--warning)' : 'var(--danger)' }}>{c.status_code}</strong></Td>
                </tr>
              ))}
            </Table>
            <div style={{ padding: '0 18px 12px' }}><Pager page={page} noun="failures" /></div>
          </>
        )}
      </SectionCard>
    </div>
  )
}

const CODE_MEANING: Record<number, string> = {
  200: 'Read succeeded.',
  201: 'Something was created.',
  401: 'The key was missing, expired or revoked. Somebody\'s integration is down.',
  403: 'The key was valid but did not carry the scope. Usually a subscription that needs widening.',
  404: 'No such endpoint on that version — often a caller still on a retired path.',
  429: 'Over the rate limit. If it is persistent the limit is wrong, not the caller.',
  500: 'Ours.',
}

/* ---- Modals --------------------------------------------------------------- */

function ApiModal({ api, onClose, onSaved }: {
  api: OperatorApi | null; onClose: () => void; onSaved: () => void
}) {
  const [form, setForm] = useState<OperatorApi>(api ?? {
    id: '', name: '', standard: 'TMF620', audience: 'Sellers', description: '', why: '',
    scopes: [], methods: ['GET'], environments: ['sandbox'], lifecycle: 'current',
    version: '1.0', subscriber_count: 0, sort_order: 0,
  })
  const [scopeText, setScopeText] = useState((api?.scopes ?? []).join(', '))

  const save = async () => {
    if (!form.name.trim()) { toast('Name is required', 'error'); return }
    if (!form.why.trim()) { toast('Say in one line why this API exists.', 'error'); return }
    const scopes = scopeText.split(',').map(s => s.trim()).filter(Boolean)
    if (scopes.length === 0) {
      toast('An API with no scopes issues tokens that can do nothing.', 'error'); return
    }
    if (api) {
      const { error } = await supabase.from('operator_apis').update({ ...form, scopes }).eq('id', api.id)
      if (error) { toast(error.message, 'error'); return }
      toast('Updated.')
    } else {
      const id = `AP-${Math.random().toString(36).slice(2, 6).toUpperCase()}`
      const { error } = await supabase.from('operator_apis').insert({
        ...form, id, scopes, lifecycle: 'current', subscriber_count: 0, sort_order: 99,
      })
      if (error) { toast(error.message, 'error'); return }
      toast('Published. Add a version with endpoints — until then nobody can call it.')
    }
    onSaved()
  }

  return (
    <Modal open onClose={onClose} title={api ? `Edit ${api.name}` : 'Publish an API'}
      footer={<><Btn variant="secondary" onClick={onClose}>Cancel</Btn><Btn onClick={() => void save()}>Save</Btn></>}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
        {!api && (
          <Callout tone="info">
            This creates the API. It becomes callable when you publish a version with at least one
            endpoint — a version with none is a name in a list.
          </Callout>
        )}
        <FormField label="Name" required>
          <TextInput value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
        </FormField>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
          <FormField label="TM Forum standard">
            <TextInput value={form.standard} onChange={e => setForm({ ...form, standard: e.target.value })} />
          </FormField>
          <FormField label="Audience">
            <TextInput value={form.audience} onChange={e => setForm({ ...form, audience: e.target.value })}
                       placeholder="Sellers, Buyers, Sellers + Buyers" />
          </FormField>
        </div>
        <FormField label="Description">
          <TextArea rows={3} value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} />
        </FormField>
        <FormField label="Scopes" required
                   hint="Comma separated. A subscription can only ask for scopes listed here.">
          <TextInput value={scopeText} onChange={e => setScopeText(e.target.value)}
                     placeholder="catalogue:read, catalogue:write" />
        </FormField>
        <FormField label="Why does this API exist? (one line)" required
                   hint="If it cannot answer this, it probably should not be published.">
          <TextInput value={form.why} onChange={e => setForm({ ...form, why: e.target.value })} />
        </FormField>
      </div>
    </Modal>
  )
}

/* Publishing a version means publishing what it can do. The old flow let a
   version string be typed into a box and called it published. */
function PublishVersionModal({ api, onClose, onDone }: {
  api: OperatorApi; onClose: () => void; onDone: () => void
}) {
  const [v, setV] = useState({
    version: '', base_path: `/tmf-api/${api.name.toLowerCase().replace(/\s+/g, '')}/v1`,
    released_on: new Date().toISOString().slice(0, 10), notes: '',
  })
  const [eps, setEps] = useState<{
    method: string; path: string; summary: string; description: string
    scope: string; request_example: string; response_example: string
  }[]>([])
  const [busy, setBusy] = useState(false)

  const addBlank = () => setEps([...eps, {
    method: 'GET', path: '', summary: '', description: '',
    scope: api.scopes[0] ?? '', request_example: '', response_example: '{}',
  }])

  const submit = async () => {
    const check = publishable({ ...v, endpoints: eps })
    if (!check.ok) { toast(check.reason, 'error'); return }
    for (const e of eps) {
      if (!e.path.startsWith('/')) { toast(`"${e.path || '(blank)'}" is not a path — it starts with a slash.`, 'error'); return }
      if (!e.summary.trim()) { toast(`${e.method} ${e.path} needs a summary. A reference row with no sentence is a row nobody can use.`, 'error'); return }
      try { JSON.parse(e.response_example) } catch { toast(`The response example for ${e.method} ${e.path} is not valid JSON.`, 'error'); return }
      if (e.request_example.trim()) {
        try { JSON.parse(e.request_example) } catch { toast(`The request example for ${e.method} ${e.path} is not valid JSON.`, 'error'); return }
      }
    }

    setBusy(true)
    const created = await publishVersion({ api_id: api.id, ...v })
    if (!created.ok) { setBusy(false); toast(created.reason, 'error'); return }
    for (const e of eps) {
      const r = await addEndpoint({
        version_id: created.data, method: e.method, path: e.path, summary: e.summary,
        description: e.description, scope: e.scope,
        request_example: e.request_example.trim() ? JSON.parse(e.request_example) : null,
        response_example: JSON.parse(e.response_example),
      })
      if (!r.ok) { setBusy(false); toast(r.reason, 'error'); return }
    }
    setBusy(false)
    toast(`${api.name} ${v.version} published as a draft with ${eps.length} endpoint${eps.length === 1 ? '' : 's'}. Make it current when you are ready.`)
    onDone()
  }

  return (
    <Modal open onClose={onClose} title={`Publish a version of ${api.name}`}
      footer={<><Btn variant="secondary" onClick={onClose}>Cancel</Btn>
               <Btn disabled={busy} onClick={() => void submit()}>{busy ? 'Publishing…' : 'Publish as draft'}</Btn></>}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
        <Callout tone="info" title="A version needs endpoints">
          The reference page, the sandbox console and the downloadable OpenAPI document are all generated
          from the endpoints you add here. Publish with none and a developer opens the reference to
          nothing.
        </Callout>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr 1fr', gap: '12px' }}>
          <FormField label="Version" required hint="1.0, 2.1 — callers pin to it.">
            <TextInput value={v.version} onChange={e => setV({ ...v, version: e.target.value })} placeholder="1.0" />
          </FormField>
          <FormField label="Base path" required>
            <TextInput value={v.base_path} onChange={e => setV({ ...v, base_path: e.target.value })} />
          </FormField>
          <FormField label="Released on">
            <TextInput type="date" value={v.released_on} onChange={e => setV({ ...v, released_on: e.target.value })} />
          </FormField>
        </div>

        <FormField label="Release notes">
          <TextArea rows={2} value={v.notes} onChange={e => setV({ ...v, notes: e.target.value })} />
        </FormField>

        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
            <strong style={{ fontSize: 'var(--text-sm)' }}>
              Endpoints ({eps.length}){eps.length === 0 ? ' — at least one is required' : ''}
            </strong>
            <Btn variant="secondary" size="sm" onClick={addBlank}><Plus size={12} /> Add an endpoint</Btn>
          </div>

          {eps.map((e, i) => (
            <div key={i} style={{
              border: '1px solid var(--border)', borderRadius: 'var(--radius-md)',
              padding: '12px', marginBottom: '10px', display: 'flex', flexDirection: 'column', gap: '10px',
            }}>
              <div style={{ display: 'grid', gridTemplateColumns: '110px 1fr 1fr auto', gap: '10px', alignItems: 'end' }}>
                <FormField label="Method">
                  <Select value={e.method} onChange={ev => patch(i, { method: ev.target.value })}>
                    {['GET', 'POST', 'PATCH', 'PUT', 'DELETE'].map(m => <option key={m}>{m}</option>)}
                  </Select>
                </FormField>
                <FormField label="Path">
                  <TextInput value={e.path} onChange={ev => patch(i, { path: ev.target.value })} placeholder="/productOffering" />
                </FormField>
                <FormField label="Scope">
                  <Select value={e.scope} onChange={ev => patch(i, { scope: ev.target.value })}>
                    {api.scopes.map(s => <option key={s}>{s}</option>)}
                  </Select>
                </FormField>
                <Btn variant="secondary" size="sm" onClick={() => setEps(eps.filter((_, j) => j !== i))}>
                  <X size={12} />
                </Btn>
              </div>
              <FormField label="Summary" hint="One line, shown in the reference list.">
                <TextInput value={e.summary} onChange={ev => patch(i, { summary: ev.target.value })} />
              </FormField>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                <FormField label="Request example" hint="JSON, or blank for a read.">
                  <TextArea rows={3} value={e.request_example} onChange={ev => patch(i, { request_example: ev.target.value })}
                            style={{ fontFamily: 'monospace', fontSize: 'var(--text-xs)' }} />
                </FormField>
                <FormField label="Response example" hint="JSON. Shown in the reference and returned by the sandbox.">
                  <TextArea rows={3} value={e.response_example} onChange={ev => patch(i, { response_example: ev.target.value })}
                            style={{ fontFamily: 'monospace', fontSize: 'var(--text-xs)' }} />
                </FormField>
              </div>
            </div>
          ))}
        </div>
      </div>
    </Modal>
  )

  function patch(i: number, over: Partial<(typeof eps)[number]>) {
    setEps(eps.map((e, j) => j === i ? { ...e, ...over } : e))
  }
}

/* What replaced the red Delete. */
function DeprecateModal({ version, subscriptions, onClose, onDone }: {
  version: Version; subscriptions: Subscription[]; onClose: () => void; onDone: () => void
}) {
  const [sunset, setSunset] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const callers = subscriptions.filter(s => s.version_id === version.id && s.state === 'active')

  const submit = async () => {
    const check = deprecatable(version, sunset, note)
    if (!check.ok) { toast(check.reason, 'error'); return }
    setBusy(true)
    const r = await setLifecycle(version.id, 'deprecated', sunset, note)
    setBusy(false)
    if (!r.ok) { toast(r.reason, 'error'); return }
    toast(`${version.api_name} ${version.version} is deprecated. ${callers.length} caller${callers.length === 1 ? '' : 's'} will see the sunset date and your note.`)
    onDone()
  }

  return (
    <Modal open onClose={onClose} title={`Deprecate ${version.api_name} ${version.version}`}
      footer={<><Btn variant="secondary" onClick={onClose}>Cancel</Btn>
               <Btn disabled={busy} onClick={() => void submit()}>{busy ? 'Saving…' : 'Deprecate it'}</Btn></>}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
        {callers.length > 0 ? (
          <Callout tone="warning" title={`${callers.length} seller${callers.length === 1 ? ' is' : 's are'} calling this version`}>
            {callers.map(c => c.consumer_name).join(', ')}. They will see the sunset date and your note on
            their own screens from the moment you save this.
          </Callout>
        ) : (
          <Callout tone="info">Nobody is calling this version. Deprecating it is free.</Callout>
        )}

        <FormField label="Sunset date" required
                   hint="When it stops answering. At least 30 days out — callers need a release cycle to move in.">
          <TextInput type="date" value={sunset} onChange={e => setSunset(e.target.value)} />
        </FormField>

        <FormField label="What should callers do instead?" required
                   hint="Name what changed and what to move to. This is the whole value of a deprecation.">
          <TextArea rows={4} value={note} onChange={e => setNote(e.target.value)}
                    placeholder="v2.1 replaces the single price field with prices[], one entry per market and currency. A v2.0 caller reading price gets the home-market price and will misquote every other market." />
        </FormField>
      </div>
    </Modal>
  )
}

function DecideModal({ sub, applications, onClose, onDone }: {
  sub: Subscription; applications: Application[]
  onClose: () => void
  onDone: (minted: { client_id?: string; client_secret?: string; note: string } | null) => void
}) {
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const app = applications.find(a => a.id === sub.application_id)

  const decide = async (approve: boolean) => {
    setBusy(true)
    const r = await decideProductionAccess(sub.id, approve, note)
    setBusy(false)
    if (!r.ok) { toast(r.reason, 'error'); return }
    toast(r.data.note)
    onDone(r.data.client_secret
      ? { client_id: r.data.client_id, client_secret: r.data.client_secret, note: r.data.note }
      : null)
  }

  return (
    <Modal open onClose={onClose} title={`${sub.consumer_name} — production access`}
      footer={
        <div style={{ display: 'flex', gap: '8px', justifyContent: 'space-between', width: '100%' }}>
          <Btn variant="secondary" onClick={onClose}>Cancel</Btn>
          <div style={{ display: 'flex', gap: '8px' }}>
            <Btn variant="danger" disabled={busy} onClick={() => void decide(false)}><X size={13} /> Refuse</Btn>
            <Btn disabled={busy} onClick={() => void decide(true)}><Check size={13} /> Approve and issue a live key</Btn>
          </div>
        </div>
      }>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
        <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', lineHeight: 1.7 }}>
          <strong>{app?.name ?? sub.application_id}</strong> is asking for {sub.api_name} {sub.version} on
          production, carrying <code>{sub.scopes.join(', ')}</code>. Contact: {app?.contact_name} ({app?.contact_email}).
        </div>

        {sub.use_case && (
          <div style={{
            padding: '12px 14px', borderRadius: 'var(--radius)', background: 'var(--info-bg)',
            fontSize: 'var(--text-sm)', lineHeight: 1.7, maxWidth: '80ch',
          }}>
            {sub.use_case}
          </div>
        )}

        <Callout tone="warning" title="Approving mints a live key">
          It is shown once. Refusing writes your reason to the seller's screen — and a refusal with no
          reason is one they cannot act on, so it is required.
        </Callout>

        <FormField label="Your note" hint="Required to refuse. Optional to approve, but it is the record of why.">
          <TextArea rows={4} value={note} onChange={e => setNote(e.target.value)} />
        </FormField>
      </div>
    </Modal>
  )
}

function MintedModal({ minted, onClose }: {
  minted: { client_id?: string; client_secret?: string; note: string }; onClose: () => void
}) {
  return (
    <Modal open onClose={onClose} title="A live key has been issued"
           footer={<Btn onClick={onClose}>Done</Btn>}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
        <Callout tone="warning" title="Shown once">{minted.note}</Callout>
        {minted.client_id && (
          <div>
            <div style={headingStyle}>Client ID</div>
            <pre style={codeStyle}>{minted.client_id}</pre>
          </div>
        )}
        {minted.client_secret && (
          <div>
            <div style={headingStyle}>Client secret</div>
            <pre style={codeStyle}>{minted.client_secret}</pre>
          </div>
        )}
        {/* Named rather than hidden: in a real portal the developer would get a
            one-time link and the marketplace would never see this value. It is
            here so the demo can show the exchange happening. */}
        <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', lineHeight: 1.6 }}>
          In a live deployment this secret would go straight to the seller's technical contact by one-time
          link and never appear on this screen. It is shown here so the exchange is visible end to end.
        </p>
      </div>
    </Modal>
  )
}

function SuspendModal({ app, onClose, onDone }: {
  app: Application; onClose: () => void; onDone: () => void
}) {
  const [why, setWhy] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    if (!why.trim()) { toast('Say why. The seller sees this, and a suspension they cannot explain is one they cannot fix.', 'error'); return }
    setBusy(true)
    const r = await setApplicationStatus(app.id, 'suspended', why)
    setBusy(false)
    if (!r.ok) { toast(r.reason, 'error'); return }
    toast('Suspended. Its keys stop authenticating and the seller is told why.')
    onDone()
  }

  return (
    <Modal open onClose={onClose} title={`Suspend ${app.name}`}
      footer={<><Btn variant="secondary" onClick={onClose}>Cancel</Btn>
               <Btn variant="danger" disabled={busy} onClick={() => void submit()}>{busy ? 'Saving…' : 'Suspend it'}</Btn></>}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
        <Callout tone="danger" title="Every key on this application stops working">
          Their other applications are unaffected — which is the reason applications exist as a separate
          thing from the seller.
        </Callout>
        <FormField label="Why?" required>
          <TextArea rows={3} value={why} onChange={e => setWhy(e.target.value)}
                    placeholder="Sustained 429s from a retry loop with no backoff, reported by the gateway team." />
        </FormField>
      </div>
    </Modal>
  )
}

/* ---- Small pieces --------------------------------------------------------- */

function tabStyle(on: boolean): React.CSSProperties {
  return {
    padding: '8px 16px', borderRadius: 'var(--radius)', fontSize: 'var(--text-sm)', fontWeight: 600,
    background: on ? 'var(--brand-navy)' : 'white', color: on ? 'white' : 'var(--text-secondary)',
    border: '1px solid var(--border)', cursor: 'pointer',
  }
}

const linkStyle: React.CSSProperties = {
  background: 'none', border: 'none', padding: 0, font: 'inherit',
  textDecoration: 'underline', cursor: 'pointer', color: 'inherit',
}

const headingStyle: React.CSSProperties = {
  fontSize: 'var(--text-xs)', fontWeight: 700, color: 'var(--text-tertiary)',
  textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '6px',
}

const codeStyle: React.CSSProperties = {
  margin: 0, padding: '12px 14px', borderRadius: 'var(--radius)',
  background: 'var(--brand-navy)', color: '#e8eef7',
  fontSize: 'var(--text-xs)', overflowX: 'auto', fontFamily: 'monospace',
}

function Figure({ label, value, tone }: { label: string; value: string; tone?: 'bad' }) {
  return (
    <div>
      <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>{label}</div>
      <div style={{ fontWeight: 700, color: tone === 'bad' ? 'var(--danger)' : 'var(--text)' }}>{value}</div>
    </div>
  )
}
