/* What a developer portal has to be able to say.
 *
 * Everything here is arithmetic and prose over rows the repo layer fetches —
 * no Supabase client, so it can be tested against the cases that matter rather
 * than against whatever happens to be in the database today.
 *
 * The judgements it makes are the ones a developer arrives wanting:
 *
 *   - is this key going to stop working, and when
 *   - is this version going to be switched off, and what do I do about it
 *   - am I near a limit, and is that limit the sandbox one or the real one
 *   - what would this call actually look like from my own terminal
 *
 * A portal that cannot answer those is a list of names, which is what this one
 * was.
 */

export type KeyState = 'active' | 'retiring' | 'expired' | 'revoked'
export type Lifecycle = 'draft' | 'current' | 'deprecated' | 'retired'
export type SubState = 'pending' | 'active' | 'refused' | 'suspended'
export type Environment = 'sandbox' | 'production'

export interface Credential {
  id: string
  application_id: string
  environment: Environment
  client_id: string
  secret_prefix: string
  secret_last4: string
  issued_at: string
  issued_to: string
  rotated_from: string | null
  grace_until: string | null
  revoked_at: string | null
  revoked_why: string | null
  last_used_at: string | null
  state: KeyState
  grace_days_left: number | null
}

export interface Version {
  id: string
  api_id: string
  api_name: string
  version: string
  lifecycle: Lifecycle
  base_path: string
  released_on: string
  deprecated_on: string | null
  sunset_on: string | null
  migration_note: string | null
  scopes: string[]
  standard: string
  description: string
  endpoints: Endpoint[]
  /* The published specification, where one has been loaded. */
  spec?: Spec
}

/* The specification the marketplace publishes for an API — TM Forum's own
   document, as retrieved, not one we assembled. `operations` is every
   operation it declares, which is what makes the reference worth reading:
   there are 146 across the seven files against the 20 the sandbox exposes. */
export interface Spec {
  id: string
  api_id: string
  version_id: string
  tmf: string
  title: string
  declared_version: string
  spec_format: string
  servers: string[]
  file_path: string
  file_bytes: number
  sha256: string
  source_file: string
  retrieved_on: string
  operation_count: number
  is_tmf_standard: boolean
  note: string | null
  operations: SpecOperation[]
}

export interface SpecOperation {
  method: string
  path: string
  summary: string
  description: string
  operationId: string | null
  tag: string | null
}

/* Grouped by the tag the specification itself uses, which is how its authors
   organised it — better than re-deriving groups from path segments and getting
   a different answer from the document we are claiming to render. */
export function groupOperations(ops: readonly SpecOperation[]): { tag: string; operations: SpecOperation[] }[] {
  const groups = new Map<string, SpecOperation[]>()
  for (const o of ops) {
    const key = o.tag ?? o.path.split('/').filter(Boolean).pop() ?? 'Operations'
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(o)
  }
  return [...groups.entries()]
    .map(([tag, operations]) => ({ tag, operations }))
    .sort((a, b) => b.operations.length - a.operations.length || a.tag.localeCompare(b.tag))
}

/* How much of a published API this marketplace actually implements. A portal
   that shows sixty TM Forum operations and can execute four should say so
   rather than let a developer discover it one 404 at a time. */
export function coverage(spec: Spec, ours: readonly Endpoint[]): {
  ours: number; theirs: number; pct: number; note: string
} {
  const pct = spec.operation_count ? Math.round((ours.length / spec.operation_count) * 100) : 0
  return {
    ours: ours.length, theirs: spec.operation_count, pct,
    note: ours.length === 0
      ? `None of ${spec.tmf}'s ${spec.operation_count} operations are exposed here yet.`
      : `${ours.length} of ${spec.tmf}'s ${spec.operation_count} operations are live on this marketplace. `
        + `The rest are in the specification and will answer 404 until they are.`,
  }
}

export const specSize = (bytes: number): string =>
  bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`

export interface Endpoint {
  id: string
  version_id: string
  method: string
  path: string
  summary: string
  description: string | null
  scope: string
  request_example: unknown
  response_example: unknown
}

export interface Subscription {
  id: string
  api_id: string
  api_name: string
  application_id: string | null
  version_id: string | null
  version: string
  environment: Environment
  scopes: string[]
  volume: number
  state: SubState
  use_case: string | null
  requested_at: string | null
  decided_at: string | null
  decided_by: string | null
  decision_note: string | null
  rate_limit_per_min: number
  quota_per_day: number
  consumer_name: string
  partner_id: string | null
}

export interface Application {
  id: string
  partner_id: string
  name: string
  description: string
  contact_name: string
  contact_email: string
  status: 'active' | 'suspended'
  created_at: string
  suspended_why: string | null
}

export interface CallRecord {
  id: number
  application_id: string | null
  version_id: string | null
  environment: string
  method: string
  path: string
  status_code: number
  ms: number
  called_at: string
}

/* One row per application, environment, version, status code and day, from the
   `api_call_rollup` view. Every figure on both screens is a sum over these.
   Counting `CallRecord`s in the browser looked equivalent and was not:
   PostgREST caps a response at a thousand rows, so a marketplace with more
   calls than that was reporting percentages of whichever thousand arrived. */
export interface Rollup {
  application_id: string | null
  environment: string
  version_id: string | null
  api_id: string | null
  status_code: number
  on_day: string
  calls: number
  total_ms: number
}

/* ---- Keys ----------------------------------------------------------------- */

export const KEY_STATE_LABEL: Record<KeyState, string> = {
  active: 'Active',
  retiring: 'Rotating',
  expired: 'Expired',
  revoked: 'Revoked',
}

/* What the developer is being told about this key, in the words that tell them
   whether they have to do something today. "Rotating" without the date is a
   status; with it, it is a deadline. */
export function keyNote(c: Credential): string {
  switch (c.state) {
    case 'revoked':
      return `Revoked${c.revoked_at ? ` on ${dateOnly(c.revoked_at)}` : ''}. ${c.revoked_why ?? ''}`.trim()
    case 'expired':
      return `Stopped working${c.grace_until ? ` on ${dateOnly(c.grace_until)}` : ''}. Its replacement is the key issued after it.`
    case 'retiring': {
      const d = c.grace_days_left
      if (d === null) return 'Being replaced.'
      if (d <= 0) return 'Stops working today. Deploy the replacement now.'
      return `Stops working in ${d} day${d === 1 ? '' : 's'}${c.grace_until ? `, on ${dateOnly(c.grace_until)}` : ''}. Deploy the replacement before then.`
    }
    default:
      return c.last_used_at
        ? `Last used ${dateOnly(c.last_used_at)}.`
        : 'Issued but never used — nothing has authenticated with it yet.'
  }
}

/* A key that authenticates a call right now. Used to decide whether the sandbox
   console has anything to send with. */
export const usable = (c: Credential): boolean => c.state === 'active' || c.state === 'retiring'

/* The masked form. Never the secret — only what the table can actually see. */
export const maskedSecret = (c: Credential): string => `${c.secret_prefix}${'•'.repeat(24)}${c.secret_last4}`

/* ---- Versions and their end -------------------------------------------- */

export const LIFECYCLE_LABEL: Record<Lifecycle, string> = {
  draft: 'Draft', current: 'Current', deprecated: 'Deprecated', retired: 'Retired',
}

export function daysUntil(iso: string | null, now = new Date()): number | null {
  if (!iso) return null
  const then = new Date(`${iso.slice(0, 10)}T00:00:00Z`).getTime()
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  return Math.round((then - today) / 86_400_000)
}

export interface SunsetWarning {
  tone: 'danger' | 'warning' | 'info'
  headline: string
  detail: string
}

/* The one thing a deprecated version has to communicate: a date, and what to do
   before it. A "deprecated" pill on its own tells a developer nothing they can
   act on, which is why the schema refuses a deprecation without both. */
export function sunsetWarning(v: Version, now = new Date()): SunsetWarning | null {
  if (v.lifecycle === 'retired') {
    return {
      tone: 'danger',
      headline: `${v.api_name} ${v.version} has been retired`,
      detail: v.migration_note ?? 'It no longer accepts calls. Move to the current version.',
    }
  }
  if (v.lifecycle !== 'deprecated') return null
  const left = daysUntil(v.sunset_on, now)
  if (left === null) {
    return { tone: 'warning', headline: `${v.api_name} ${v.version} is deprecated`, detail: v.migration_note ?? '' }
  }
  if (left <= 0) {
    return {
      tone: 'danger',
      headline: `${v.api_name} ${v.version} was switched off on ${v.sunset_on}`,
      detail: v.migration_note ?? '',
    }
  }
  return {
    tone: left <= 90 ? 'danger' : 'warning',
    headline: left <= 90
      ? `${v.api_name} ${v.version} stops answering in ${left} days`
      : `${v.api_name} ${v.version} is deprecated — sunset ${v.sunset_on}`,
    detail: v.migration_note ?? '',
  }
}

/* ---- Usage against a limit ------------------------------------------------ */

export interface Usage {
  calls: number
  failed: number
  successRate: number | null
  avgMs: number | null
  /* The busiest single day in the window, which is the figure a daily quota is
     actually compared against. A monthly total divided by thirty hides the
     morning the nightly job ran twice. */
  peakDay: number
  peakDayOn: string | null
  quota: number
  headroom: number | null
  nearLimit: boolean
}

export function usageOf(rows: Rollup[], quota: number): Usage {
  let n = 0
  let failed = 0
  let totalMs = 0
  const byDay = new Map<string, number>()

  for (const r of rows) {
    n += r.calls
    if (r.status_code >= 400) failed += r.calls
    totalMs += r.total_ms
    byDay.set(r.on_day, (byDay.get(r.on_day) ?? 0) + r.calls)
  }

  let peakDay = 0
  let peakDayOn: string | null = null
  for (const [d, k] of byDay) if (k > peakDay) { peakDay = k; peakDayOn = d }

  return {
    calls: n,
    failed,
    successRate: n ? Math.round(((n - failed) / n) * 100) : null,
    avgMs: n ? Math.round(totalMs / n) : null,
    peakDay,
    peakDayOn,
    quota,
    headroom: quota > 0 ? quota - peakDay : null,
    nearLimit: quota > 0 && peakDay >= quota * 0.8,
  }
}

/* What the gateway answered, across everything rather than across a page. */
export function statusBreakdown(rows: Rollup[]): { code: number; calls: number; share: number }[] {
  const byCode = new Map<number, number>()
  let total = 0
  for (const r of rows) {
    byCode.set(r.status_code, (byCode.get(r.status_code) ?? 0) + r.calls)
    total += r.calls
  }
  return [...byCode.entries()]
    .map(([code, calls]) => ({ code, calls, share: total ? calls / total : 0 }))
    .sort((a, b) => b.calls - a.calls)
}

/* Sandbox is throttled harder than production on purpose: a seller testing a
   retry loop against it is the normal case, and the limit exists so their bug
   does not become the marketplace's outage. */
export const LIMITS: Record<Environment, { rate: number; quota: number }> = {
  sandbox: { rate: 100, quota: 10_000 },
  production: { rate: 600, quota: 250_000 },
}

/* ---- The call, as the developer would make it ----------------------------- */

const SANDBOX_HOST = 'https://sandbox.api.aventa.com'
const LIVE_HOST = 'https://api.aventa.com'

export function endpointUrl(v: Version, e: Endpoint, env: Environment): string {
  return `${env === 'production' ? LIVE_HOST : SANDBOX_HOST}${v.base_path}${e.path}`
}

/* A copyable curl. The point is not decoration — a developer who can paste one
   line and see the same response the portal showed them has verified the portal
   is telling the truth, which is the only thing that makes the rest credible. */
export function curlFor(v: Version, e: Endpoint, env: Environment, clientId: string): string {
  const lines = [
    `curl -X ${e.method} '${endpointUrl(v, e, env)}' \\`,
    `  -H 'Authorization: Bearer $ACCESS_TOKEN' \\`,
    `  -H 'Content-Type: application/json'`,
  ]
  if (e.request_example) {
    lines[lines.length - 1] += ' \\'
    lines.push(`  -d '${JSON.stringify(e.request_example)}'`)
  }
  return [
    `# Exchange your credentials for a token, then call the endpoint.`,
    `# client_id: ${clientId}`,
    `curl -X POST '${env === 'production' ? LIVE_HOST : SANDBOX_HOST}/oauth2/token' \\`,
    `  -d 'grant_type=client_credentials' \\`,
    `  -d 'client_id=${clientId}' \\`,
    `  -d 'client_secret=$CLIENT_SECRET' \\`,
    `  -d 'scope=${e.scope}'`,
    '',
    ...lines,
  ].join('\n')
}

/* ---- What the seller can and cannot do next ------------------------------- */

/* Which scopes an application holds in an environment, across all its
   subscriptions. A seller with orders:read on sandbox and orders:write on
   production holds both — but not both anywhere, and the difference is the
   whole reason the environment column exists. */
export function scopesHeld(subs: Subscription[], appId: string, env: Environment): string[] {
  return [...new Set(
    subs.filter(s => s.application_id === appId && s.environment === env && s.state === 'active')
        .flatMap(s => s.scopes),
  )].sort()
}

/* Whether a given endpoint can be called by this application right now, and if
   not, the sentence that says what is missing. Answering this in the portal is
   what stops the first 403 happening in production. */
export function callability(
  subs: Subscription[], appId: string, env: Environment, v: Version, e: Endpoint,
): { ok: true } | { ok: false; reason: string } {
  const sub = subs.find(s =>
    s.application_id === appId && s.version_id === v.id && s.environment === env && s.state === 'active')
  if (!sub) {
    const pending = subs.find(s =>
      s.application_id === appId && s.version_id === v.id && s.environment === env && s.state === 'pending')
    if (pending) return { ok: false, reason: `Your ${env} request for ${v.api_name} ${v.version} is still with the marketplace.` }
    return { ok: false, reason: `This application is not subscribed to ${v.api_name} ${v.version} on ${env}.` }
  }
  if (!sub.scopes.includes(e.scope)) {
    return { ok: false, reason: `Needs ${e.scope}. Your subscription carries ${sub.scopes.join(', ')}.` }
  }
  return { ok: true }
}

/* ---- The operator's queue ------------------------------------------------- */

export interface QueueItem {
  sub: Subscription
  waitingDays: number
}

export function productionQueue(subs: Subscription[], now = new Date()): QueueItem[] {
  return subs
    .filter(s => s.state === 'pending')
    .map(s => ({ sub: s, waitingDays: Math.max(0, -(daysUntil(s.requested_at, now) ?? 0)) }))
    .sort((a, b) => b.waitingDays - a.waitingDays)
}

/* Whether an API version may be published at all. The old screen let an API be
   created with a name and a version string and nothing else — which is how
   seven APIs came to be listed that a developer could not have called one of. */
export function publishable(
  v: { version: string; base_path: string; endpoints: unknown[] },
): { ok: true } | { ok: false; reason: string } {
  if (!/^\d+(\.\d+)*$/.test(v.version.trim())) {
    return { ok: false, reason: 'A version is a number like 1.0 or 2.1. Callers pin to it, so it has to sort.' }
  }
  if (!v.base_path.trim().startsWith('/')) {
    return { ok: false, reason: 'The base path starts with a slash — /tmf-api/productCatalog/v2.' }
  }
  if (v.endpoints.length === 0) {
    return { ok: false, reason: 'Add at least one endpoint. A version with none is a name, not an API.' }
  }
  return { ok: true }
}

/* Deprecating rather than deleting. Deletion took a published API away from
   whoever was still calling it, with no notice and no record it had existed —
   the one operation a portal must not offer. */
export function deprecatable(
  v: { lifecycle: Lifecycle }, sunset: string, note: string, now = new Date(),
): { ok: true } | { ok: false; reason: string } {
  if (v.lifecycle === 'retired') return { ok: false, reason: 'It is already retired.' }
  const left = daysUntil(sunset, now)
  if (left === null) return { ok: false, reason: 'Give it a sunset date. A deprecation nobody can plan around is a rumour.' }
  if (left < 30) return { ok: false, reason: 'Sunset has to be at least 30 days out. Callers need a release cycle to move in.' }
  if (note.trim().length < 20) {
    return { ok: false, reason: 'Say what changed and what to do instead. "Deprecated" on its own sends everybody to support.' }
  }
  return { ok: true }
}

/* ---- Small shared shaping ------------------------------------------------- */

export const dateOnly = (iso: string): string => iso.slice(0, 10)

export const statusTone = (code: number): 'ok' | 'client' | 'server' =>
  code < 400 ? 'ok' : code < 500 ? 'client' : 'server'

/* Endpoints read better grouped by the resource they act on than in one flat
   list of twenty — which was the complaint about the console: "cannot remember
   the categories, keep searching and shifting tabs". */
export function groupEndpoints(eps: Endpoint[]): { resource: string; endpoints: Endpoint[] }[] {
  const groups = new Map<string, Endpoint[]>()
  for (const e of eps) {
    const key = e.path.split('/').filter(Boolean)[0] ?? e.path
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(e)
  }
  return [...groups.entries()]
    .map(([resource, endpoints]) => ({ resource, endpoints }))
    .sort((a, b) => a.resource.localeCompare(b.resource))
}

/* ---- Events: topics, who listens, and what actually arrived --------------- */

export interface Topic {
  id: string
  name: string
  title: string
  domain: 'fulfilment' | 'catalogue' | 'finance' | 'support' | 'identity'
  description: string
  required: boolean
  payload: unknown
  retention_h: number
}

export interface Subscriber {
  topic_id: string
  topic: string
  title: string
  domain: string
  required: boolean
  endpoint_id: string | null
  partner_id: string | null
  partner_name: string | null
  endpoint_name: string | null
  url: string | null
  env: string | null
  auth: string | null
  enabled: boolean | null
}

export interface Delivery {
  id: number
  topic_id: string
  endpoint_id: string | null
  partner_id: string | null
  reference: string | null
  status: 'delivered' | 'failed' | 'timeout' | 'unhandled'
  attempts: number
  http_status: number | null
  ms: number | null
  detail: string | null
  delivered_at: string
}

export interface TopicHealth {
  topic: Topic
  listeners: Subscriber[]
  delivered: number
  failed: number
  successRate: number | null
  /* A required topic nobody listens to is the one line on this screen that
     means an order is not reaching anybody. It is not a percentage problem. */
  silent: boolean
  warning: string | null
}

export function topicHealth(
  topics: readonly Topic[], subs: readonly Subscriber[], deliveries: readonly Delivery[],
): TopicHealth[] {
  return topics.map(topic => {
    const listeners = subs.filter(s => s.topic_id === topic.id && s.endpoint_id && s.enabled)
    const mine = deliveries.filter(d => d.topic_id === topic.id)
    const delivered = mine.filter(d => d.status === 'delivered').length
    const failed = mine.filter(d => d.status === 'failed' || d.status === 'timeout').length
    const attempted = delivered + failed
    const silent = listeners.length === 0

    return {
      topic, listeners, delivered, failed,
      successRate: attempted ? Math.round((delivered / attempted) * 100) : null,
      silent,
      warning: silent && topic.required
        ? `${topic.name} is required and nothing is listening. It is not queued and not retried — it simply does not arrive.`
        : silent
          ? `Nothing subscribes to ${topic.name}. It is published and dropped.`
          : attempted > 0 && delivered / attempted < 0.9
            ? `${failed} of the last ${attempted} deliveries did not land.`
            : null,
    }
  })
}

/* Which sellers are missing something the marketplace requires of everyone. */
export function coverageGaps(
  topics: readonly Topic[], subs: readonly Subscriber[],
): { partner_id: string; partner_name: string; missing: string[] }[] {
  const required = topics.filter(t => t.required).map(t => t.name)
  const partners = new Map<string, string>()
  for (const s of subs) if (s.partner_id) partners.set(s.partner_id, s.partner_name ?? s.partner_id)

  return [...partners.entries()]
    .map(([partner_id, partner_name]) => ({
      partner_id, partner_name,
      missing: required.filter(name =>
        !subs.some(s => s.partner_id === partner_id && s.topic === name && s.enabled)),
    }))
    .filter(g => g.missing.length > 0)
    .sort((a, b) => b.missing.length - a.missing.length)
}

export const DELIVERY_TONE: Record<Delivery['status'], 'ok' | 'bad' | 'flat'> = {
  delivered: 'ok', failed: 'bad', timeout: 'bad', unhandled: 'flat',
}
