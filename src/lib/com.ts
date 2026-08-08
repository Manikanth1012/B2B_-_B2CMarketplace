/**
 * Pushing fulfilment to the telco's Customer Order Management system.
 *
 * The marketplace sells things it cannot deliver. A mobile plan, an eSIM, a
 * roaming pass, an IoT SIM estate, five hundred wholesale lines — every one of
 * them ends in a subscriber record and a rating rule inside systems the
 * marketplace does not own. It takes the order, takes the money, settles the
 * seller, and something else has to actually turn the service on.
 *
 * Three distinctions carry the whole module, and each one exists because
 * collapsing it produces a specific, expensive wrong answer:
 *
 *   ACCEPTED IS NOT DELIVERED. A 201 from an order manager means the request is
 *   in a queue. `acknowledged`, `in-progress` and `completed` are three
 *   different answers to "has the customer got their service", and a storefront
 *   that treats the first as the third tells somebody their SIM is live while it
 *   is not.
 *
 *   A REJECTION IS NOT A TIMEOUT. A required field that resolved to nothing will
 *   resolve to nothing on the fifth attempt too. Retrying it spends the budget
 *   and buries the reason under four identical failures. Only transport is
 *   retried.
 *
 *   SILENCE IS A STATE. Sent and never acknowledged is how orders are quietly
 *   lost: nothing failed, so nothing is on a failure list, and the customer
 *   waits. It is measured against the system's own acknowledgement SLA rather
 *   than a constant, because an Emirati platform on a private interconnect and
 *   an asynchronous Kenyan estate provisioner do not owe the same latency.
 *
 * The arithmetic of the payload lives in `com_payload` in the database, because
 * a push writes a row and stamps a state together or not at all. What is here
 * is what the screens need: which of these is a problem, whose problem it is,
 * and what the next thing to do about it is.
 */

export type ComState =
  | 'queued' | 'sent' | 'acknowledged' | 'in-progress'
  | 'completed' | 'rejected' | 'failed' | 'cancelled'

export type Fulfil = 'shipped' | 'esim' | 'provisioned' | 'activation' | 'instant'
export type Route = 'telco-com' | 'marketplace' | 'seller'

export interface ComSystem {
  id: string
  market: string
  name: string
  vendor: string
  standard: string
  api_version: string
  base_url: string
  auth: 'oauth2-client-credentials' | 'mtls' | 'api-key'
  token_url: string | null
  timeout_ms: number
  max_attempts: number
  backoff_seconds: number
  ack_sla_seconds: number
  environment: 'production' | 'sandbox'
  status: 'live' | 'degraded' | 'down'
  status_note: string | null
  contact: string | null
  note: string | null
  sort_order: number
}

export interface Mapping {
  id: string
  applies_to: 'all' | 'esim' | 'provisioned' | 'activation'
  source: string
  target: string
  transform: 'number' | 'iso-8601' | 'upper' | 'e164' | null
  required: boolean
  label: string
  note: string | null
  sort_order: number
}

export interface Push {
  id: string
  order_ref: string
  order_item_id: string | null
  system_id: string
  market: string
  product_id: string | null
  product_name: string | null
  fulfil: Fulfil
  quantity: number
  state: ComState
  com_order_id: string | null
  correlation_id: string
  payload: Record<string, unknown> | null
  attempts: number
  last_attempt_at: string | null
  next_attempt_at: string | null
  sent_at: string | null
  acknowledged_at: string | null
  completed_at: string | null
  failure_code: string | null
  failure_reason: string | null
  note: string | null
  created_at: string
}

export interface ComEvent {
  id: string
  com_order: string
  kind: 'submitted' | 'acknowledged' | 'state-change' | 'completed' | 'rejected' | 'failed' | 'retry'
  state: string | null
  detail: string | null
  occurred_at: string
}

export const STATE_LABEL: Record<ComState, string> = {
  queued: 'With us, not yet sent',
  sent: 'Sent, no answer',
  acknowledged: 'Accepted',
  'in-progress': 'Being provisioned',
  completed: 'Live',
  rejected: 'Rejected',
  failed: 'Given up',
  cancelled: 'Cancelled',
}

export const STATE_TONE: Record<ComState, string> = {
  queued: 'pending',
  sent: 'pending',
  acknowledged: 'current',
  'in-progress': 'current',
  completed: 'healthy',
  rejected: 'rejected',
  failed: 'rejected',
  cancelled: 'degraded',
}

/**
 * What the state means to the person asking. Written for a support agent with a
 * customer on the phone, which is the only audience that matters for these
 * words — "acknowledged" tells them nothing they can say out loud.
 */
export const STATE_MEANING: Record<ComState, string> = {
  queued: 'The marketplace has the order. The network has not been asked yet.',
  sent: 'The network was asked and has not answered. Nothing has failed; nothing has been confirmed either.',
  acknowledged: 'The network has accepted the order. The service is not on yet.',
  'in-progress': 'The network is working on it.',
  completed: 'The service exists and the customer can use it.',
  rejected: 'The network refused the order. It will not succeed on its own.',
  failed: 'The network could not be reached and the marketplace stopped trying.',
  cancelled: 'The order was withdrawn and the network was told.',
}

/** States where something is still expected to happen. */
export function inFlight(state: ComState): boolean {
  return state === 'queued' || state === 'sent' || state === 'acknowledged' || state === 'in-progress'
}

/** States where nothing more will happen without somebody doing something. */
export function stuck(state: ComState): boolean {
  return state === 'rejected' || state === 'failed'
}

/**
 * Whether trying again could possibly help.
 *
 * A rejection is excluded on purpose and it is the whole point: the marketplace
 * could not supply a required field, and it will not be able to next time
 * either. Offering a Retry button there is offering somebody four more
 * identical failures.
 */
export function retryable(push: Push): boolean {
  return push.state === 'queued' || push.state === 'failed'
}

/**
 * Whether asking the order manager about it would tell anybody anything.
 *
 * The counterpart to `retryable`, and the two are deliberately disjoint on the
 * state that matters: a sent-and-silent order must be asked about and must not
 * be resent, because the far end has the request and a second one is a second
 * SIM.
 */
export function pollable(push: Push): boolean {
  return push.state === 'sent' || push.state === 'acknowledged' || push.state === 'in-progress'
}

/** When the next attempt is due, in seconds — the doubling the system configures. */
export function backoffFor(attempts: number, system: ComSystem): number {
  return system.backoff_seconds * Math.pow(2, Math.min(Math.max(attempts, 0), 6))
}

export function attemptsLeft(push: Push, system: ComSystem): number {
  return Math.max(0, system.max_attempts - push.attempts)
}

/**
 * Sent and silent past the system's own acknowledgement SLA.
 *
 * This is the one nothing else catches. It is not failed, so it is not on a
 * failure list; it is not queued, so no retry picks it up; and the customer is
 * waiting. Measured against the system's SLA rather than a constant because a
 * platform behind a private interconnect and an asynchronous estate provisioner
 * do not owe the same latency.
 */
export function unacknowledged(push: Push, system: ComSystem | null, now: string): boolean {
  if (push.state !== 'sent' || !push.sent_at || !system) return false
  const waited = (new Date(now).getTime() - new Date(push.sent_at).getTime()) / 1000
  return waited > system.ack_sla_seconds
}

/** How long it has been waiting, in whole minutes. */
export function waitingMinutes(push: Push, now: string): number | null {
  const from = push.sent_at ?? push.created_at
  if (!from) return null
  return Math.max(0, Math.round((new Date(now).getTime() - new Date(from).getTime()) / 60000))
}

/**
 * The one sentence a support agent needs, with the next step where there is one.
 *
 * Never just the state. "Rejected" without the reason and without "it will not
 * retry" leaves somebody watching a queue and expecting it to clear.
 */
export function explain(push: Push, system: ComSystem | null, now: string): string {
  const where = system?.name ?? push.system_id
  switch (push.state) {
    case 'rejected':
      return push.failure_reason
        ?? `${where} refused the order and gave no reason. It will not be retried — the reason has to be found before it can go again.`
    case 'failed':
      return push.failure_reason
        ?? `${where} could not be reached after ${push.attempts} attempts. Nothing is provisioned and this needs a human.`
    case 'queued': {
      const when = push.next_attempt_at
      return push.attempts === 0
        ? `Waiting to go to ${where}.`
        : `Attempt ${push.attempts} did not get through${when ? `; the next is due ${when.slice(0, 16).replace('T', ' ')}` : ''}.`
    }
    case 'sent':
      return unacknowledged(push, system, now)
        ? `Sent to ${where} ${waitingMinutes(push, now)} minutes ago and not acknowledged — past the ${Math.round((system?.ack_sla_seconds ?? 0) / 60)}-minute window it is meant to answer in. ${system?.status_note ?? 'Nothing has failed, and nothing is confirmed.'}`
        : `Sent to ${where}, waiting for acknowledgement.`
    case 'acknowledged':
      return `${where} has accepted the order as ${push.com_order_id ?? 'an order'}. The service is not on yet.`
    case 'in-progress':
      return `${where} is provisioning it.`
    case 'completed':
      return `Live${push.completed_at ? ` since ${push.completed_at.slice(0, 16).replace('T', ' ')}` : ''}.`
    case 'cancelled':
      return push.note ?? 'Withdrawn, and the network was told.'
  }
}

export interface Health {
  total: number
  live: number
  inFlight: number
  stuck: number
  silent: number
  /* The single worst thing, for a banner. Null when there is nothing to say —
     which is a real answer and not the same as zero of something. */
  worst: { push: Push; why: string } | null
}

/**
 * The state of the queue, worst thing first.
 *
 * The ordering is the judgement: a rejection blocks a customer who has paid,
 * a give-up means nothing is provisioned and nobody is trying, and silence is
 * the one that looks fine on every other screen.
 */
export function queueHealth(
  pushes: readonly Push[], systems: readonly ComSystem[], now: string,
): Health {
  const sys = (id: string) => systems.find(s => s.id === id) ?? null
  const silent = pushes.filter(p => unacknowledged(p, sys(p.system_id), now))
  const rejected = pushes.filter(p => p.state === 'rejected')
  const failed = pushes.filter(p => p.state === 'failed')

  const worst = rejected[0]
    ? { push: rejected[0], why: 'refused by the order manager and not retrying' }
    : failed[0]
      ? { push: failed[0], why: 'abandoned after every attempt failed' }
      : silent[0]
        ? { push: silent[0], why: 'sent and never acknowledged' }
        : null

  return {
    total: pushes.length,
    live: pushes.filter(p => p.state === 'completed').length,
    inFlight: pushes.filter(p => inFlight(p.state)).length,
    stuck: rejected.length + failed.length,
    silent: silent.length,
    worst,
  }
}

/** The queue, in the order somebody should work it. */
export function workOrder(
  pushes: readonly Push[], systems: readonly ComSystem[], now: string,
): Push[] {
  const rank = (p: Push): number => {
    if (p.state === 'rejected') return 0
    if (p.state === 'failed') return 1
    if (unacknowledged(p, systems.find(s => s.id === p.system_id) ?? null, now)) return 2
    if (p.state === 'queued') return 3
    if (p.state === 'sent' || p.state === 'acknowledged') return 4
    if (p.state === 'in-progress') return 5
    return 6
  }
  return [...pushes].sort((a, b) => {
    const d = rank(a) - rank(b)
    return d !== 0 ? d : (a.created_at < b.created_at ? -1 : 1)
  })
}

/* ------------------------------------------------------------- the mapping -- */

/** Which mapping rows apply to a fulfilment class, in the order they are sent. */
export function mappingFor(mappings: readonly Mapping[], fulfil: Fulfil): Mapping[] {
  return mappings
    .filter(m => m.applies_to === 'all' || m.applies_to === fulfil)
    .sort((a, b) => a.sort_order - b.sort_order)
}

/** Where a mapping row's value comes from, in words. */
export function sourceLabel(m: Mapping): string {
  if (m.source.startsWith('const:')) return `“${m.source.slice(6)}”`
  return m.source.slice(4)
}

/**
 * What is wrong with the mapping as configured.
 *
 * A mapping table is edited by whoever is integrating a new market, under time
 * pressure, against a vendor's PDF. Every one of these has a specific way of
 * going wrong quietly.
 */
export function mappingProblems(mappings: readonly Mapping[]): string[] {
  const out: string[] = []

  /* Two rows writing to one path: the second wins and the first is silently
     never sent, which looks exactly like the far end ignoring it. */
  const seen = new Map<string, Mapping>()
  for (const m of mappings) {
    const key = `${m.applies_to}::${m.target}`
    const first = seen.get(key)
    if (first) {
      out.push(`${first.label} and ${m.label} both write to ${m.target}. Only the later one is sent, and the earlier one looks like the far end ignoring it.`)
    } else {
      seen.set(key, m)
    }
  }

  /* A characteristic is a name/value pair. A value at an index with no name
     beside it arrives as an anonymous field the order manager drops. */
  const chars = new Map<string, { name?: Mapping; value?: Mapping }>()
  for (const m of mappings) {
    const at = /^(.*productCharacteristic\[\d+\])\.(name|value)$/.exec(m.target)
    if (!at) continue
    const key = `${m.applies_to}::${at[1]}`
    const pair = chars.get(key) ?? {}
    if (at[2] === 'name') pair.name = m; else pair.value = m
    chars.set(key, pair)
  }
  for (const [key, pair] of chars) {
    if (!pair.name) {
      out.push(`${pair.value!.label} sends a characteristic value at ${key.split('::')[1]} with no name beside it. The order manager cannot tell what it is and drops it.`)
    }
    if (!pair.value) {
      out.push(`${pair.name!.label} names a characteristic at ${key.split('::')[1]} and never sends a value for it.`)
    }
  }

  /* Required and constant is a contradiction that hides a missing decision:
     it can never be absent, so marking it required says nothing, and somebody
     believed they had guarded a field they had not. */
  for (const m of mappings) {
    if (m.required && m.source.startsWith('const:') && m.source.slice(6).trim() === '') {
      out.push(`${m.label} is required and its constant is empty.`)
    }
  }

  return out
}

/**
 * Which required fields this order line cannot supply.
 *
 * The same question `com_missing` answers in the database, evaluated here so a
 * screen can say what would happen before anybody presses anything. Two
 * evaluations of one published rule, reconciled by the integration suite —
 * which is the price of being able to answer before the transaction exists.
 */
export function missingFor(
  mappings: readonly Mapping[], fulfil: Fulfil, context: Record<string, unknown>,
): string[] {
  return mappingFor(mappings, fulfil)
    .filter(m => m.required && !m.source.startsWith('const:'))
    .filter(m => {
      const v = context[m.source.slice(4)]
      return v === null || v === undefined || v === ''
    })
    .map(m => `${m.label} (${m.target})`)
}

/* -------------------------------------------------------------- the system -- */

/** Whether a system can be pushed to at all right now, and if not, why. */
export function reachable(system: ComSystem): { ok: true } | { ok: false; reason: string } {
  if (system.status === 'down') {
    return {
      ok: false,
      reason: `${system.name} is down. ${system.status_note ?? 'Orders will queue and retry; nothing is lost, and nothing is provisioned either.'}`,
    }
  }
  return { ok: true }
}

/** What the system is, in a sentence, for the screen that configures it. */
export function systemLine(s: ComSystem): string {
  const auth = s.auth === 'mtls' ? 'mutual TLS'
    : s.auth === 'api-key' ? 'an API key'
    : 'OAuth client credentials'
  return `${s.vendor}, speaking ${s.standard} ${s.api_version} over ${auth}. Up to ${s.max_attempts} attempts, first retry after ${s.backoff_seconds}s and doubling; expected to acknowledge within ${Math.round(s.ack_sla_seconds / 60)} minutes.`
}

/** Which route a product takes, in words, for the catalogue screen. */
export const ROUTE_LABEL: Record<Route, string> = {
  'telco-com': 'Provisioned by the network',
  marketplace: 'Fulfilled by the marketplace',
  seller: 'Fulfilled by the seller',
}

export function routeNote(route: Route): string {
  switch (route) {
    case 'telco-com':
      return 'Every order for this is pushed to the telco’s order management system. It is not delivered until that system says it is.'
    case 'marketplace':
      return 'The marketplace’s own platform provisions this. Nothing leaves for the network.'
    case 'seller':
      return 'The seller ships or activates this on their own systems. The marketplace tracks it and does not perform it.'
  }
}
