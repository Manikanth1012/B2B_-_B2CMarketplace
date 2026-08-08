/* Reading the fulfilment queue, and acting on it.
 *
 * The push itself is `push_to_com` / `com_send` in the database, because a push
 * writes a row, builds a payload from the mapping and stamps a state, and those
 * three have to move together. A browser doing them in sequence can leave an
 * order marked sent with nothing behind it.
 */

import { supabase } from './supabase'
import type { ComSystem, Mapping, Push, ComEvent } from './com'

const num = <T,>(row: T, keys: string[]): T => {
  const out = { ...row } as Record<string, unknown>
  for (const k of keys) if (out[k] != null) out[k] = Number(out[k])
  return out as T
}

export interface ComBook {
  systems: ComSystem[]
  mappings: Mapping[]
  pushes: Push[]
  events: ComEvent[]
  loadError?: string
}

export async function loadComBook(): Promise<ComBook> {
  const [s, m, p, e] = await Promise.all([
    supabase.from('com_system').select('*').order('sort_order'),
    supabase.from('com_mapping').select('*').order('sort_order'),
    supabase.from('com_order').select('*').order('created_at', { ascending: false }),
    supabase.from('com_event').select('*').order('occurred_at', { ascending: false }).limit(400),
  ])

  const errors: string[] = []
  if (s.error) errors.push(`the systems: ${s.error.message}`)
  if (m.error) errors.push(`the mapping: ${m.error.message}`)
  if (p.error) errors.push(`the queue: ${p.error.message}`)

  return {
    systems: ((s.data ?? []) as ComSystem[]).map(x =>
      num(x, ['timeout_ms', 'max_attempts', 'backoff_seconds', 'ack_sla_seconds', 'sort_order'])),
    mappings: ((m.data ?? []) as Mapping[]).map(x => num(x, ['sort_order'])),
    pushes: ((p.data ?? []) as Push[]).map(x => num(x, ['quantity', 'attempts'])),
    events: (e.data ?? []) as ComEvent[],
    ...(errors.length ? { loadError: `Some of the fulfilment queue did not load (${errors.join('; ')}).` } : {}),
  }
}

/** The state of one order's fulfilment, for the buyer chasing it. */
export async function loadPushesFor(orderRef: string): Promise<Push[]> {
  const { data } = await supabase.from('com_order').select('*')
    .eq('order_ref', orderRef).order('created_at')
  return ((data ?? []) as Push[]).map(x => num(x, ['quantity', 'attempts']))
}

/** Queue every line of an order the network has to fulfil. Idempotent. */
export async function pushOrder(orderRef: string): Promise<
  { ok: true; queued: number; skipped: { product_id: string; reason: string }[] }
  | { ok: false; why: string }
> {
  const { data, error } = await supabase.rpc('push_to_com', { p_order_ref: orderRef })
  if (error) return { ok: false, why: error.message }
  const r = (data ?? {}) as { ok: boolean; why?: string; queued?: number; skipped?: unknown }
  if (!r.ok) return { ok: false, why: r.why ?? 'The push did not happen and said nothing about why.' }
  return {
    ok: true,
    queued: Number(r.queued ?? 0),
    skipped: (r.skipped ?? []) as { product_id: string; reason: string }[],
  }
}

/** One attempt against the order manager. */
export async function sendPush(id: string): Promise<{ ok: boolean; state?: string; missing?: string[]; why?: string }> {
  const { data, error } = await supabase.rpc('com_send', { p_id: id })
  if (error) return { ok: false, why: error.message }
  return (data ?? { ok: false, why: 'The order manager returned nothing.' }) as
    { ok: boolean; state?: string; missing?: string[]; why?: string }
}

/**
 * Ask the order manager what became of an order it has already accepted.
 *
 * The right move on a sent-and-silent one, and the reason it has no Retry
 * button: the far end has the request and has not said what happened to it.
 * Sending it again puts a duplicate provisioning behind one correlation header.
 * A GET changes nothing and is safe to repeat.
 */
export async function pollPush(id: string): Promise<{ ok: boolean; state?: string; changed?: boolean; why?: string }> {
  const { data, error } = await supabase.rpc('com_poll', { p_id: id })
  if (error) return { ok: false, why: error.message }
  return (data ?? { ok: false, why: 'The order manager returned nothing.' }) as
    { ok: boolean; state?: string; changed?: boolean; why?: string }
}

/** Everything due a retry, retried. The scheduler's half, on demand. */
export async function retryDue(): Promise<{ ok: boolean; tried?: number; accepted?: number; why?: string }> {
  const { data, error } = await supabase.rpc('com_retry', {})
  if (error) return { ok: false, why: error.message }
  return (data ?? { ok: false }) as { ok: boolean; tried?: number; accepted?: number }
}

/** A state notification from the order manager, recorded. */
export async function recordState(
  id: string, state: 'in-progress' | 'completed' | 'failed' | 'cancelled', detail?: string,
): Promise<{ ok: boolean; why?: string }> {
  const { data, error } = await supabase.rpc('com_state', {
    p_id: id, p_state: state, p_detail: detail ?? null,
  })
  if (error) return { ok: false, why: error.message }
  return (data ?? { ok: false }) as { ok: boolean; why?: string }
}

/** The body that would be sent for an order line, built from the mapping. */
export async function previewPayload(orderItemId: string): Promise<Record<string, unknown> | null> {
  const { data } = await supabase.rpc('com_payload', { p_item: orderItemId })
  return (data ?? null) as Record<string, unknown> | null
}

/** Everything the mapping can draw on for an order line — the left-hand side. */
export async function loadContext(orderItemId: string): Promise<Record<string, unknown>> {
  const { data } = await supabase.rpc('com_context', { p_item: orderItemId })
  return (data ?? {}) as Record<string, unknown>
}

export async function saveSystem(s: Partial<ComSystem> & { id: string }): Promise<{ ok: boolean; why?: string }> {
  const { error } = await supabase.from('com_system').upsert(s)
  return error ? { ok: false, why: error.message } : { ok: true }
}
