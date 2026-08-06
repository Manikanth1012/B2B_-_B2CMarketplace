/* Everything the two developer-portal screens read and write.
 *
 * The judgements live in `devPortal.ts` where they can be tested. This file
 * only fetches and calls — including the four functions that hold the rules
 * the client must never be trusted with: registering an application, taking a
 * subscription, deciding production access, and rotating or revoking a key.
 * Those run in the database, under RLS, so a seller cannot mint themselves a
 * live credential by calling the same endpoint with a different partner id.
 */
import { supabase } from './supabase'
import type {
  Application, Credential, Version, Endpoint, Subscription, CallRecord, Environment,
} from './devPortal'

export interface DeveloperWorkspace {
  applications: Application[]
  credentials: Credential[]
  subscriptions: Subscription[]
  versions: Version[]
  calls: CallRecord[]
  loadError?: string
}

const EMPTY: DeveloperWorkspace = {
  applications: [], credentials: [], subscriptions: [], versions: [], calls: [],
}

/* The catalogue of everything published, with its endpoints. Public by design —
   documentation nobody can read before they sign up is documentation nobody
   reads. */
export async function loadPublishedApis(): Promise<Version[]> {
  const [vs, es, as] = await Promise.all([
    supabase.from('api_versions').select('*').order('sort_order'),
    supabase.from('api_endpoints').select('*').order('sort_order'),
    supabase.from('operator_apis').select('id, name, standard, description, scopes, audience'),
  ])
  if (vs.error || es.error || as.error) return []

  type ApiRow = { id: string; name: string; standard: string; description: string; scopes: string[]; audience: string }
  const apis = (as.data ?? []) as ApiRow[]
  const endpoints = (es.data ?? []) as unknown as Endpoint[]

  return ((vs.data ?? []) as Record<string, unknown>[]).map(v => {
    const api = apis.find(a => a.id === v.api_id)
    return {
      id: String(v.id),
      api_id: String(v.api_id),
      api_name: api?.name ?? String(v.api_id),
      version: String(v.version),
      lifecycle: String(v.lifecycle) as Version['lifecycle'],
      base_path: String(v.base_path),
      released_on: String(v.released_on),
      deprecated_on: (v.deprecated_on as string | null) ?? null,
      sunset_on: (v.sunset_on as string | null) ?? null,
      migration_note: (v.migration_note as string | null) ?? null,
      scopes: api?.scopes ?? [],
      standard: api?.standard ?? '',
      description: api?.description ?? '',
      endpoints: endpoints.filter(e => e.version_id === v.id),
    }
  })
}

/* Everything one seller has. RLS does the filtering on applications,
   credentials and the call log; the partner id is passed for subscriptions,
   whose policy predates this model. */
export async function loadWorkspace(partnerId: string): Promise<DeveloperWorkspace> {
  const [apps, creds, subs, versions, calls] = await Promise.all([
    supabase.from('api_applications').select('*').eq('partner_id', partnerId).order('created_at'),
    supabase.from('api_credential_state').select('*').order('issued_at', { ascending: false }),
    supabase.from('operator_api_subscriptions').select('*').eq('partner_id', partnerId).order('sort_order'),
    loadPublishedApis(),
    supabase.from('api_call_log').select('*').order('called_at', { ascending: false }).limit(2000),
  ])

  const err = apps.error ?? creds.error ?? subs.error ?? calls.error
  if (apps.error) return { ...EMPTY, versions, loadError: apps.error.message }

  const applications = (apps.data ?? []) as unknown as Application[]
  const mine = new Set(applications.map(a => a.id))

  return {
    applications,
    /* The view is readable to the operator too; a seller must only ever see
       keys on their own applications, so filter rather than trust the join. */
    credentials: ((creds.data ?? []) as unknown as Credential[]).filter(c => mine.has(c.application_id)),
    subscriptions: shapeSubs(subs.data ?? [], versions),
    versions,
    calls: ((calls.data ?? []) as unknown as CallRecord[]).filter(c => c.application_id && mine.has(c.application_id)),
    loadError: err?.message,
  }
}

/* The operator's view: every application, every key, every subscription, and
   the queue of production requests nobody has decided. */
export interface PortalAdmin {
  applications: Application[]
  credentials: Credential[]
  subscriptions: Subscription[]
  versions: Version[]
  calls: CallRecord[]
  partners: { id: string; name: string }[]
  loadError?: string
}

export async function loadPortalAdmin(): Promise<PortalAdmin> {
  const [apps, creds, subs, versions, calls, partners] = await Promise.all([
    supabase.from('api_applications').select('*').order('created_at', { ascending: false }),
    supabase.from('api_credential_state').select('*').order('issued_at', { ascending: false }),
    supabase.from('operator_api_subscriptions').select('*').order('sort_order'),
    loadPublishedApis(),
    supabase.from('api_call_log').select('*').order('called_at', { ascending: false }).limit(2000),
    supabase.from('partners').select('id, name').order('name'),
  ])

  return {
    applications: (apps.data ?? []) as unknown as Application[],
    credentials: (creds.data ?? []) as unknown as Credential[],
    subscriptions: shapeSubs(subs.data ?? [], versions),
    versions,
    calls: (calls.data ?? []) as unknown as CallRecord[],
    partners: (partners.data ?? []) as { id: string; name: string }[],
    loadError: (apps.error ?? subs.error)?.message,
  }
}

function shapeSubs(rows: unknown[], versions: Version[]): Subscription[] {
  return (rows as Record<string, unknown>[]).map(s => ({
    id: String(s.id),
    api_id: String(s.api_id),
    api_name: versions.find(v => v.id === s.version_id)?.api_name ?? String(s.api_id),
    application_id: (s.application_id as string | null) ?? null,
    version_id: (s.version_id as string | null) ?? null,
    version: String(s.version ?? ''),
    environment: String(s.environment) as Environment,
    scopes: (s.scopes ?? []) as string[],
    volume: Number(s.volume ?? 0),
    state: String(s.state ?? 'active') as Subscription['state'],
    use_case: (s.use_case as string | null) ?? null,
    requested_at: (s.requested_at as string | null) ?? null,
    decided_at: (s.decided_at as string | null) ?? null,
    decided_by: (s.decided_by as string | null) ?? null,
    decision_note: (s.decision_note as string | null) ?? null,
    rate_limit_per_min: Number(s.rate_limit_per_min ?? 60),
    quota_per_day: Number(s.quota_per_day ?? 10_000),
    consumer_name: String(s.consumer_name ?? ''),
    partner_id: (s.partner_id as string | null) ?? null,
  }))
}

/* ---- Writes, every one of them a database function ------------------------ */

export type Outcome<T> = { ok: true; data: T } | { ok: false; reason: string }

/* The database raises the refusals as sentences a developer can act on, so the
   message is passed through rather than replaced with "something went wrong". */
async function callFn<T>(name: string, args: Record<string, unknown>): Promise<Outcome<T>> {
  const { data, error } = await supabase.rpc(name, args)
  if (error) return { ok: false, reason: error.message.replace(/^.*?:\s*/, '') }
  return { ok: true, data: data as T }
}

/* The one and only time a secret is readable. Everything downstream of this
   sees a prefix and four characters. */
export interface IssuedCredential {
  application_id?: string
  credential_id: string
  client_id: string
  client_secret: string
  environment?: string
  note: string
}

export const registerApplication = (
  name: string, description: string, contactName: string, contactEmail: string,
) => callFn<IssuedCredential>('register_application', {
  p_name: name, p_description: description,
  p_contact_name: contactName, p_contact_email: contactEmail,
})

export const subscribeApplication = (
  applicationId: string, versionId: string, environment: Environment,
  scopes: string[], useCase?: string,
) => callFn<{ subscription_id: string; state: string; note: string }>('subscribe_application', {
  p_application_id: applicationId, p_version_id: versionId,
  p_environment: environment, p_scopes: scopes, p_use_case: useCase ?? null,
})

export const decideProductionAccess = (subscriptionId: string, approve: boolean, note: string) =>
  callFn<Partial<IssuedCredential> & { state: string; note: string }>('decide_production_access', {
    p_subscription_id: subscriptionId, p_approve: approve, p_note: note,
  })

export const rotateCredential = (credentialId: string, graceDays: number) =>
  callFn<IssuedCredential & { old_credential_id: string; old_stops_working: string }>('rotate_credential', {
    p_credential_id: credentialId, p_grace_days: graceDays,
  })

export const revokeCredential = (credentialId: string, why: string) =>
  callFn<{ credential_id: string; state: string; note: string }>('revoke_credential', {
    p_credential_id: credentialId, p_why: why,
  })

/* ---- The sandbox --------------------------------------------------------- */

export interface SandboxResult {
  request: { method: string; url: string; headers: Record<string, string>; body: unknown }
  response: { status: number; ms: number; body: unknown }
}

/* Executes. The four checks happen in the database against the caller's real
   credential, so a 403 here is the same 403 production would return. */
export const sandboxCall = (credentialId: string, endpointId: string, body?: unknown) =>
  callFn<SandboxResult>('sandbox_call', {
    p_credential_id: credentialId, p_endpoint_id: endpointId, p_body: body ?? null,
  })

/* The OpenAPI document, generated from the same endpoint rows the reference
   page renders — so the file a developer downloads and the page they read
   cannot drift apart. */
export async function loadSpec(versionId: string): Promise<unknown | null> {
  const { data, error } = await supabase.rpc('api_spec', { p_version_id: versionId })
  return error ? null : data
}

/* ---- Operator publishing -------------------------------------------------- */

export async function publishVersion(v: {
  api_id: string; version: string; base_path: string; released_on: string; notes: string
}): Promise<Outcome<string>> {
  const id = `${v.api_id}@${v.version}`
  const { error } = await supabase.from('api_versions').insert({
    id, api_id: v.api_id, version: v.version, lifecycle: 'draft',
    base_path: v.base_path, released_on: v.released_on, notes: v.notes,
    sort_order: 0,
  })
  return error ? { ok: false, reason: error.message } : { ok: true, data: id }
}

export async function addEndpoint(e: {
  version_id: string; method: string; path: string; summary: string
  description: string; scope: string; request_example: unknown; response_example: unknown
}): Promise<Outcome<string>> {
  const id = `EP-${Math.random().toString(36).slice(2, 8).toUpperCase()}`
  const { error } = await supabase.from('api_endpoints').insert({ id, ...e, sort_order: 0 })
  return error ? { ok: false, reason: error.message } : { ok: true, data: id }
}

export async function setLifecycle(
  versionId: string, lifecycle: string, sunset?: string, note?: string,
): Promise<Outcome<null>> {
  const patch: Record<string, unknown> = { lifecycle }
  if (lifecycle === 'deprecated') {
    patch.deprecated_on = new Date().toISOString().slice(0, 10)
    patch.sunset_on = sunset
    patch.migration_note = note
  }
  const { error } = await supabase.from('api_versions').update(patch).eq('id', versionId)
  return error ? { ok: false, reason: error.message } : { ok: true, data: null }
}

export async function setApplicationStatus(
  appId: string, status: 'active' | 'suspended', why: string,
): Promise<Outcome<null>> {
  const { error } = await supabase.from('api_applications').update({
    status,
    suspended_at: status === 'suspended' ? new Date().toISOString() : null,
    suspended_why: status === 'suspended' ? why : null,
  }).eq('id', appId)
  return error ? { ok: false, reason: error.message } : { ok: true, data: null }
}
