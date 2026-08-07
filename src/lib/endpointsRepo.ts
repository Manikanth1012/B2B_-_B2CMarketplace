/* Reading and writing a seller's callback endpoints.
 *
 * Rules are in `endpoints.ts` so they can be tested without a network. What is
 * here is the four round trips and the one genuinely awkward thing: a test call
 * that really calls.
 */
import { supabase } from './supabase'
import type { Topic, Delivery } from './devPortal'
import { nextCallId, nextEndpointId } from './endpoints'
import type { Endpoint, TestCall, EndpointDraft, TestResult, Check } from './endpoints'

export interface EndpointBook {
  endpoints: Endpoint[]
  calls: TestCall[]
  loadError?: string
}

const REFUSED = 'Nothing changed — you are not allowed to make that change.'

/* The topic catalogue and this seller's own delivery history.
 *
 * `EVENTS` in endpoints.ts was a hard-coded list of seven names with no payload
 * behind any of them, and the seller had no way to see whether anything had
 * ever actually been delivered to their endpoints. Both now come from the
 * tables the operator publishes and writes. */
export async function loadEventBook(partnerId: string): Promise<{
  topics: Topic[]; deliveries: Delivery[]
}> {
  const [t, d] = await Promise.all([
    supabase.from('event_topics').select('*').order('sort_order'),
    supabase.from('event_deliveries').select('*').eq('partner_id', partnerId)
      .order('delivered_at', { ascending: false }).limit(120),
  ])
  return {
    topics: (t.data ?? []) as unknown as Topic[],
    deliveries: (d.data ?? []) as unknown as Delivery[],
  }
}

export async function loadEndpoints(partnerId: string): Promise<EndpointBook> {
  const eps = await supabase.from('partner_endpoints').select('*')
    .eq('partner_id', partnerId).order('sort_order')

  if (eps.error) {
    return { endpoints: [], calls: [], loadError: `Endpoints did not load (${eps.error.message}).` }
  }

  const endpoints = (eps.data ?? []) as Endpoint[]
  if (!endpoints.length) return { endpoints: [], calls: [] }

  /* Scoped by id rather than fetching the lot: RLS would refuse another
     seller's calls anyway, and asking for them and being given nothing looks
     the same as an endpoint with no history. */
  const calls = await supabase.from('endpoint_test_calls').select('*')
    .in('endpoint_id', endpoints.map(e => e.id))
    .order('called_at', { ascending: false })

  return {
    endpoints,
    calls: (calls.data ?? []) as TestCall[],
    ...(calls.error ? { loadError: `The call history did not load (${calls.error.message}).` } : {}),
  }
}

export async function addEndpoint(
  partnerId: string, draft: EndpointDraft, existing: readonly Endpoint[],
): Promise<Check> {
  const { error } = await supabase.from('partner_endpoints').insert({
    id: nextEndpointId(partnerId, existing),
    partner_id: partnerId,
    name: draft.name.trim(),
    url: draft.url.trim(),
    method: draft.method,
    auth: draft.auth,
    enabled: draft.enabled,
    events: draft.events,
    env: draft.env,
    /* The retry policy is the marketplace's, not the seller's — it is what we
       promise to do when their endpoint is slow, so they do not get to type it. */
    retry: retryFor(draft.env),
    timeout_ms: draft.timeoutMs,
    note: null,
    sort_order: existing.filter(e => e.partner_id === partnerId).length + 1,
  })
  if (error) return { ok: false, reason: friendly(error.message) }
  return { ok: true, note: `${draft.name.trim()} registered on ${draft.env}. Send it a test call before you rely on it.` }
}

export async function updateEndpoint(id: string, draft: EndpointDraft): Promise<Check> {
  const { data, error } = await supabase.from('partner_endpoints').update({
    name: draft.name.trim(),
    url: draft.url.trim(),
    method: draft.method,
    auth: draft.auth,
    enabled: draft.enabled,
    events: draft.events,
    env: draft.env,
    retry: retryFor(draft.env),
    timeout_ms: draft.timeoutMs,
  }).eq('id', id).select('id')

  if (error) return { ok: false, reason: friendly(error.message) }
  if (!data?.length) return { ok: false, reason: REFUSED }
  return { ok: true, note: 'Saved.' }
}

export async function setEnabled(id: string, enabled: boolean): Promise<Check> {
  const { data, error } = await supabase.from('partner_endpoints')
    .update({ enabled }).eq('id', id).select('id, name')
  if (error) return { ok: false, reason: friendly(error.message) }
  if (!data?.length) return { ok: false, reason: REFUSED }
  return { ok: true, note: `${(data[0] as { name: string }).name} ${enabled ? 'enabled' : 'disabled'}.` }
}

export async function removeEndpoint(id: string): Promise<Check> {
  const { data, error } = await supabase.from('partner_endpoints')
    .delete().eq('id', id).select('id')
  if (error) return { ok: false, reason: friendly(error.message) }
  if (!data?.length) return { ok: false, reason: REFUSED }
  return { ok: true, note: 'Removed. The marketplace will stop calling it.' }
}

/**
 * Actually calling the endpoint, and recording what happened.
 *
 * The old version answered "Test callback sent — 200 OK" without sending
 * anything, which is worse than doing nothing: a seller whose webhook is down
 * is told it is up.
 *
 * A browser cannot read the response of a cross-origin request the endpoint has
 * not opted into with CORS, and a seller's fulfilment webhook has no reason to
 * have done so. So the request goes out `no-cors` and what comes back is
 * whether it *completed* — which distinguishes an unreachable host, a DNS
 * failure and a timeout from a host that answered, and those are the failures
 * worth catching before go-live. What it cannot tell you is the status code,
 * and it says so rather than inventing one.
 */
export async function sendTestCall(
  endpoint: Endpoint, calls: readonly TestCall[],
): Promise<{ ok: boolean; reason?: string; note?: string; result?: TestResult }> {
  const calledBy = await whoAmI()
  const started = Date.now()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), endpoint.timeout_ms)

  let result: TestResult
  try {
    await fetch(endpoint.url, {
      method: endpoint.method === 'GET' ? 'GET' : 'POST',
      mode: 'no-cors',
      signal: controller.signal,
      ...(endpoint.method === 'GET' ? {} : {
        body: JSON.stringify({ event: endpoint.events[0] ?? 'ping', test: true, at: new Date().toISOString() }),
      }),
    })
    result = {
      status: 'ok',
      ms: Date.now() - started,
      detail: 'the host accepted the request (the status code is not readable cross-origin)',
    }
  } catch (e) {
    const aborted = e instanceof DOMException && e.name === 'AbortError'
    result = aborted
      ? { status: 'timeout', ms: endpoint.timeout_ms, detail: 'the host did not answer' }
      : { status: 'failed', ms: Date.now() - started, detail: reachFailure(e) }
  } finally {
    clearTimeout(timer)
  }

  const { error } = await supabase.from('endpoint_test_calls').insert({
    id: nextCallId(calls, endpoint.id),
    endpoint_id: endpoint.id,
    status: result.status,
    called_at: new Date().toISOString(),
    ms: result.ms,
    detail: result.detail,
    called_by: calledBy,
  })
  /* The call happened whether or not we managed to write it down. Reporting a
     failed *write* as a failed *call* would send somebody to debug a working
     endpoint. */
  if (error) {
    return { ok: true, result, note: `${describeShort(result)} — but this could not be recorded (${friendly(error.message)}).` }
  }
  return { ok: true, result, note: describeShort(result) }
}

/* Who to record the call against. Matched on the address the session
   authenticates as, rather than passed in from the screen: a caller's name that
   arrives as a prop is a name the screen can get wrong, and this one goes into
   a record the operator reads back. */
async function whoAmI(): Promise<string> {
  const { data } = await supabase.auth.getUser()
  const email = data.user?.email
  if (!email) return 'A seller'
  const { data: rows } = await supabase.from('partner_users').select('name').eq('email', email).limit(1)
  return (rows?.[0] as { name: string } | undefined)?.name ?? email
}

function describeShort(r: TestResult): string {
  if (r.status === 'ok') return `Reached in ${r.ms}ms.`
  if (r.status === 'timeout') return `No answer inside ${r.ms}ms.`
  return `Could not reach it — ${r.detail}.`
}

function reachFailure(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e)
  if (/Failed to fetch|NetworkError|ENOTFOUND|getaddrinfo/i.test(m)) {
    return 'the host could not be reached — check DNS and that it is listening'
  }
  if (/certificate|SSL|TLS/i.test(m)) return 'the TLS certificate was rejected'
  return m.slice(0, 140)
}

/* The marketplace retries harder in production than in sandbox, because a
   sandbox call nobody acts on is worth one round of noise and a production one
   is a customer waiting for their order. */
function retryFor(env: string): string {
  return env === 'Production' ? '5 attempts, exponential backoff' : '3 attempts, exponential backoff'
}

function friendly(message: string): string {
  if (/row-level security/i.test(message)) return REFUSED
  if (/duplicate key/i.test(message)) return 'That endpoint already exists.'
  if (/partner_endpoints_env_ck/i.test(message)) return 'That is not an environment.'
  if (/partner_endpoints_timeout_ck/i.test(message)) return 'The timeout has to be between 500ms and 60 seconds.'
  return message
}
