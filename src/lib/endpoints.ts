/**
 * What a seller's callback endpoints have to satisfy, and what their recent
 * calls say about them.
 *
 * The screen used to assert all of this: "40% success, 3 failed, all on one
 * endpoint" was a string, "healthy" was a literal on an object, and "Send a
 * test call" answered "200 OK" without calling anything. None of those could be
 * wrong, because none of them were derived from anything.
 *
 * Health lives here as arithmetic over the call log rather than as a column,
 * because a stored health is a second copy of what the calls already say and is
 * free to disagree with them.
 */

export type CallStatus = 'ok' | 'failed' | 'timeout'
export type Health = 'healthy' | 'failing' | 'untested'

export interface Endpoint {
  id: string
  partner_id: string
  name: string
  url: string
  method: string
  auth: string
  enabled: boolean
  events: string[]
  env: string
  retry: string
  timeout_ms: number
  note: string | null
  sort_order: number
}

export interface TestCall {
  id: string
  endpoint_id: string
  status: CallStatus
  called_at: string
  ms: number | null
  detail: string | null
  called_by: string | null
}

export const METHODS = ['POST', 'GET', 'PUT'] as const
export const ENVIRONMENTS = ['Sandbox', 'Production'] as const

export const AUTH_KINDS = [
  'HMAC-SHA256', 'Bearer token', 'API key', 'Mutual TLS', 'OAuth2 client credentials', 'None',
] as const

/* The events the marketplace will call a seller about. Two of them are not
   optional — a seller who is not told an order was placed cannot fulfil it, and
   one who is not told it was cancelled ships it anyway. */
export const EVENTS: { id: string; label: string; required: boolean }[] = [
  { id: 'order.created', label: 'An order was placed', required: true },
  { id: 'order.cancelled', label: 'An order was cancelled', required: true },
  { id: 'order.refunded', label: 'An order was refunded', required: false },
  { id: 'stock.update', label: 'Stock levels were asked for', required: false },
  { id: 'catalogue.sync', label: 'The catalogue was synchronised', required: false },
  { id: 'subscription.renewed', label: 'A subscription renewed', required: false },
  { id: 'subscription.updated', label: 'A subscription changed seats', required: false },
]

export const REQUIRED_EVENTS = EVENTS.filter(e => e.required).map(e => e.id)

export type Check = { ok: true; note?: string } | { ok: false; reason: string }

/* -------------------------------------------------------------- health --- */

/** The most recent calls first. Everything below reads a bounded window of it. */
export function recent(calls: readonly TestCall[], endpointId: string, window = 5): TestCall[] {
  return calls
    .filter(c => c.endpoint_id === endpointId)
    .sort((a, b) => (a.called_at < b.called_at ? 1 : -1))
    .slice(0, window)
}

/**
 * Successes as a percentage of the recent window, or null when nothing has been
 * called.
 *
 * Null rather than 0: an endpoint nobody has tested is not an endpoint that
 * fails every time, and showing "0%" for one is the sort of number that gets a
 * working integration switched off.
 */
export function successRate(calls: readonly TestCall[], endpointId: string, window = 5): number | null {
  const window_ = recent(calls, endpointId, window)
  if (!window_.length) return null
  return Math.round((window_.filter(c => c.status === 'ok').length / window_.length) * 100)
}

/**
 * Whether an endpoint is working.
 *
 * The *last* call decides, not the average. An endpoint that failed three times
 * and then succeeded has been fixed, and calling it "failing" on a 40% average
 * sends somebody to debug something that already works. The average is shown
 * beside it as history, which is the job it is actually good for.
 */
export function healthOf(calls: readonly TestCall[], endpointId: string): Health {
  const [last] = recent(calls, endpointId, 1)
  if (!last) return 'untested'
  return last.status === 'ok' ? 'healthy' : 'failing'
}

/** What to say about it in one line, with the count behind the claim. */
export function healthNote(calls: readonly TestCall[], endpointId: string, window = 5): string {
  const seen = recent(calls, endpointId, window)
  if (!seen.length) return 'Never called'
  const bad = seen.filter(c => c.status !== 'ok').length
  if (bad === 0) return `${seen.length} of the last ${seen.length} calls succeeded`
  return `${bad} of the last ${seen.length} calls failed`
}

/**
 * Which required events nothing is listening for.
 *
 * Per marketplace rather than per endpoint: a seller may split order.created
 * and order.cancelled across two endpoints, and asking each endpoint to carry
 * both would be an invented rule.
 */
export function eventsUncovered(endpoints: readonly Endpoint[]): string[] {
  const covered = new Set(endpoints.filter(e => e.enabled).flatMap(e => e.events))
  return REQUIRED_EVENTS.filter(id => !covered.has(id))
}

/* ---------------------------------------------------------- validation --- */

export interface EndpointDraft {
  name: string
  url: string
  method: string
  auth: string
  env: string
  events: string[]
  timeoutMs: number
  enabled: boolean
}

export function blankDraft(): EndpointDraft {
  return {
    name: '', url: '', method: 'POST', auth: 'HMAC-SHA256', env: 'Sandbox',
    events: ['order.created'], timeoutMs: 5000, enabled: true,
  }
}

/**
 * Whether this endpoint can be saved.
 *
 * HTTPS is not negotiable and not a preference: the callback carries order
 * lines and a buyer's delivery address, and over plain HTTP those are readable
 * by anything between the two of us. Localhost is refused for the same reason
 * it is tempting — the marketplace's servers cannot reach the seller's laptop,
 * so it would register cleanly and then never deliver anything.
 */
export function validateEndpoint(draft: EndpointDraft, existing: readonly Endpoint[], selfId?: string): Check {
  if (!draft.name.trim()) return { ok: false, reason: 'Give the endpoint a name — it is what the failure alert will call it.' }

  const url = draft.url.trim()
  if (!url) return { ok: false, reason: 'An endpoint needs a URL to call.' }

  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return { ok: false, reason: `"${url}" is not a URL the marketplace can call.` }
  }
  if (parsed.protocol !== 'https:') {
    return { ok: false, reason: 'The URL has to be https. The callback carries order lines and a delivery address.' }
  }
  if (['localhost', '127.0.0.1', '::1', '0.0.0.0'].includes(parsed.hostname)) {
    return { ok: false, reason: 'The marketplace cannot reach localhost. Point this at a host on the internet.' }
  }

  if (!(METHODS as readonly string[]).includes(draft.method)) {
    return { ok: false, reason: `${draft.method} is not a method the marketplace sends.` }
  }
  if (!(ENVIRONMENTS as readonly string[]).includes(draft.env)) {
    return { ok: false, reason: `${draft.env} is not an environment.` }
  }
  if (!draft.events.length) {
    return { ok: false, reason: 'Choose at least one event. An endpoint subscribed to nothing is never called.' }
  }
  const stranger = draft.events.find(e => !EVENTS.some(x => x.id === e))
  if (stranger) return { ok: false, reason: `The marketplace does not send ${stranger}.` }

  if (!Number.isFinite(draft.timeoutMs) || draft.timeoutMs < 500 || draft.timeoutMs > 60000) {
    return { ok: false, reason: 'The timeout has to be between 500ms and 60 seconds.' }
  }

  const clash = existing.find(e => e.id !== selfId && e.url.trim().toLowerCase() === url.toLowerCase() && e.env === draft.env)
  if (clash) {
    return { ok: false, reason: `${clash.name} already calls that URL on ${draft.env}, so both would fire for the same event.` }
  }

  return { ok: true }
}

/**
 * What a test call did.
 *
 * This is the marketplace's own report of the round trip, not a guess. It is
 * kept here so that the shape of a result is one thing whether it came from a
 * real request or from the sandbox, and so nothing downstream has to decide
 * what "worked" means twice.
 */
export interface TestResult {
  status: CallStatus
  ms: number
  detail: string
}

export function describeResult(r: TestResult): string {
  if (r.status === 'ok') return `Answered in ${r.ms}ms — ${r.detail}`
  if (r.status === 'timeout') return `No answer inside ${r.ms}ms — ${r.detail}`
  return `Failed after ${r.ms}ms — ${r.detail}`
}

/**
 * A stable id for the next call, prefixed with the endpoint it belongs to.
 *
 * Numbering off the highest id in hand does not work here and the first
 * real call proved it: a seller loads only their own calls, so "the highest I
 * can see" was ETC-0007 while ETC-0008 already existed on another seller's
 * endpoint. The insert came back a duplicate key and the call went unrecorded —
 * the endpoint was called, the seller was told, and nothing was written down.
 *
 * Prefixing with the endpoint id makes the id unique by construction, because
 * an endpoint belongs to exactly one seller and nobody else's rows can collide
 * with it, whether or not this seller can see them.
 */
export function nextCallId(existing: readonly TestCall[], endpointId: string): string {
  const highest = existing
    .filter(c => c.endpoint_id === endpointId)
    .map(c => Number(new RegExp(`^${endpointId}-C(\\d+)$`).exec(c.id)?.[1] ?? 0))
    .reduce((a, b) => Math.max(a, b), 0)
  return `${endpointId}-C${String(highest + 1).padStart(3, '0')}`
}

/** The next endpoint id for a seller, scoped to them so two sellers adding at
    the same moment do not collide. */
export function nextEndpointId(partnerId: string, existing: readonly Endpoint[]): string {
  const suffix = partnerId.replace(/^PTR-/, '')
  const highest = existing
    .filter(e => e.partner_id === partnerId)
    .map(e => Number(e.id.split('-').pop() ?? 0))
    .reduce((a, b) => Math.max(a, b), 0)
  return `EP-${suffix}-${String(highest + 1).padStart(2, '0')}`
}
