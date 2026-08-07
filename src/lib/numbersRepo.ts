/* Reading and allocating numbers.
 *
 * RLS does the scoping: an operator sees every block and every allocation, a
 * person sees their own numbers, an account sees its own. The filters below are
 * there so the query is small, not so that it is safe.
 */

import { supabase } from './supabase'
import type {
  ResourceSystem, NumberRange, RangeUse, HeldNumber, EsimProfile,
  NumberKind, Purpose, EsimState, Check,
} from './numbers'
import { validateAssignment, canMoveProfile } from './numbers'
import type { ChannelRule } from './channelRules'

export type Result = Check

export interface NumberBook {
  systems: ResourceSystem[]
  ranges: NumberRange[]
  use: RangeUse[]
  esim: EsimProfile[]
  /* What this channel does and does not do with numbers. Carried with the book
     because `assign_number` refuses from the same rows — a screen that offered
     an allocation the function refuses would be describing a different product
     from the one running. */
  rules: ChannelRule[]
  loadError?: string
}

/** The blocks and the systems behind them. Not the allocations — there are
    thousands and the console asks for them a question at a time. */
export async function loadNumberBook(): Promise<NumberBook> {
  const [s, r, u, e, c] = await Promise.all([
    supabase.from('resource_system').select('*').order('sort_order'),
    supabase.from('number_range').select('*').order('sort_order'),
    supabase.from('range_use').select('*'),
    supabase.from('esim_profile').select('*').order('iccid'),
    supabase.from('channel_rule').select('*').order('sort_order'),
  ])
  const errors: string[] = []
  const grab = <T>(res: { data: unknown; error: { message: string } | null }, what: string): T[] => {
    if (res.error) errors.push(`${what}: ${res.error.message}`)
    return (res.data ?? []) as T[]
  }
  return {
    systems: grab<ResourceSystem>(s, 'the owning systems'),
    ranges: grab<NumberRange>(r, 'ranges'),
    use: grab<RangeUse>(u, 'utilisation'),
    esim: grab<EsimProfile>(e, 'eSIM profiles'),
    rules: grab<ChannelRule>(c, 'the channel rules'),
    ...(errors.length ? { loadError: `Some of this did not load (${errors.join('; ')}).` } : {}),
  }
}

/** What has been allocated out of one block. Capped — a block can hold
    thousands and the counts above the list already answer "how many". */
export async function loadRangeNumbers(rangeId: string, limit = 200): Promise<HeldNumber[]> {
  const { data } = await supabase.from('number_holder').select('*')
    .eq('range_id', rangeId).order('value').limit(limit)
  return (data ?? []) as HeldNumber[]
}

/** The search box. A number, an order, a device serial or a name — support does
    not know which of those the customer is reading out. */
export async function findNumbers(query: string, limit = 60): Promise<HeldNumber[]> {
  const q = query.trim().replace(/[,()*]/g, ' ').trim()
  if (q.length < 3) return []
  const { data } = await supabase.from('number_holder').select('*')
    .or([
      `value.ilike.%${q}%`,
      `id.ilike.%${q}%`,
      `order_ref.ilike.%${q}%`,
      `stock_serial.ilike.%${q}%`,
      `holder_name.ilike.%${q}%`,
    ].join(','))
    .order('value').limit(limit)
  return (data ?? []) as HeldNumber[]
}

/** Who a retail number would go to, and whether they are old enough. The
    allocation refuses on it in the database; this is so the screen can say why
    before anybody presses anything. */
export async function ageCheck(userId: string): Promise<{
  name: string | null; dob: string | null; source: string | null
  onNetwork: boolean; networkSince: string | null
} | null> {
  const { data } = await supabase.from('customer_network_status')
    .select('name,on_network,network_since').eq('user_id', userId).maybeSingle()
  if (!data) return null
  const s = data as { name: string; on_network: boolean; network_since: string | null }
  const { data: p } = await supabase.from('consumer_profile')
    .select('dob,dob_source').eq('user_id', userId).maybeSingle()
  const d = (p ?? {}) as { dob?: string | null; dob_source?: string | null }
  return {
    name: s.name, dob: d.dob ?? null, source: d.dob_source ?? null,
    onNetwork: s.on_network, networkSince: s.network_since,
  }
}

/** Whether this person is a network subscriber at all, for a screen that has
    only their id. */
export async function onNetwork(userId: string): Promise<boolean> {
  const { data } = await supabase.from('customer_network_status')
    .select('on_network').eq('user_id', userId).maybeSingle()
  return Boolean((data as { on_network?: boolean } | null)?.on_network)
}

/** Everything on one account, or one person, or one device. */
export async function loadHeldBy(
  by: { account_id?: string; user_id?: string; stock_serial?: string },
): Promise<HeldNumber[]> {
  let q = supabase.from('number_holder').select('*')
  if (by.account_id) q = q.eq('account_id', by.account_id)
  if (by.user_id) q = q.eq('user_id', by.user_id)
  if (by.stock_serial) q = q.eq('stock_serial', by.stock_serial)
  const { data } = await q.order('kind').order('value')
  return (data ?? []) as HeldNumber[]
}

/** Every number in the estate, for the counts on the console. Capped, and the
    screen says the cap rather than implying it counted everything. */
export async function loadEstate(limit = 1000): Promise<HeldNumber[]> {
  const { data } = await supabase.from('number_holder').select('*')
    .order('assigned_on', { ascending: false }).limit(limit)
  return (data ?? []) as HeldNumber[]
}

/* ---- Allocating ------------------------------------------------------------ */

/** Checked here so the screen can explain the refusal in the desk's own words,
    and checked again by a trigger so it cannot be skipped by talking to the
    API directly. */
export async function assignNumber(a: {
  kind: NumberKind; market: string; purpose: Purpose
  user_id?: string | null; account_id?: string | null
  stock_serial?: string | null; holder?: string | null
  order_ref?: string | null; plan?: string | null
}): Promise<Result & { id?: string; value?: string }> {
  const check = validateAssignment(a)
  if (!check.ok) return check

  const { data, error } = await supabase.rpc('assign_number', {
    p_kind: a.kind, p_market: a.market, p_purpose: a.purpose,
    p_user: a.user_id ?? null, p_account: a.account_id ?? null,
    p_serial: a.stock_serial ?? null, p_holder: a.holder ?? null,
    p_order: a.order_ref ?? null, p_plan: a.plan ?? null,
  })
  if (error) return { ok: false, reason: friendly(error.message) }
  const r = data as { ok: boolean; why?: string; id?: string; value?: string; expires_on?: string }
  if (!r.ok) return { ok: false, reason: r.why ?? 'That allocation was refused.' }
  return {
    ok: true, id: r.id, value: r.value,
    note: `${r.value} allocated${r.expires_on ? `. The block it came from is reserved until ${r.expires_on}.` : '.'}`
      + (check.note ? ` ${check.note}` : ''),
  }
}

/** Releasing goes into quarantine, never straight back into the pool. */
export async function releaseNumber(id: string, why: string): Promise<Result> {
  if (!why.trim()) {
    return { ok: false, reason: 'Say why. Somebody reads this when the number comes back round.' }
  }
  const { data, error } = await supabase.rpc('release_number', { p_id: id, p_why: why.trim() })
  if (error) return { ok: false, reason: friendly(error.message) }
  const r = data as { ok: boolean; why?: string; note?: string }
  return r.ok ? { ok: true, note: r.note } : { ok: false, reason: r.why ?? 'That release was refused.' }
}

export async function suspendNumber(id: string, why: string): Promise<Result> {
  const { error } = await supabase.from('number_resource')
    .update({ state: 'suspended', suspended_on: new Date().toISOString().slice(0, 10), note: why })
    .eq('id', id)
  if (error) return { ok: false, reason: friendly(error.message) }
  return { ok: true, note: 'Suspended. The number is still allocated and is not free.' }
}

export async function resumeNumber(id: string): Promise<Result> {
  const { error } = await supabase.from('number_resource')
    .update({ state: 'assigned', suspended_on: null }).eq('id', id)
  if (error) return { ok: false, reason: friendly(error.message) }
  return { ok: true, note: 'Back in service.' }
}

/* ---- eSIM ------------------------------------------------------------------ */

/** The SM-DP+ owns these transitions. This records the one it reported; it
    does not cause it, and the screen says as much. */
export async function moveProfile(p: EsimProfile, to: EsimState): Promise<Result> {
  const check = canMoveProfile(p.state, to)
  if (!check.ok) return check
  const { error } = await supabase.from('esim_profile')
    .update({ state: to }).eq('iccid', p.iccid)
  if (error) return { ok: false, reason: friendly(error.message) }
  return { ok: true, note: check.note ?? `Recorded as ${to}.` }
}

/* ---- Ranges ---------------------------------------------------------------- */

/** Claiming a block. The reservation is what we may allocate, and it cannot be
    larger than the block it came out of. */
export async function saveRange(r: Partial<NumberRange>): Promise<Result> {
  if (!r.id?.trim()) return { ok: false, reason: 'A block needs a reference.' }
  if (!r.range_from || !r.range_to) return { ok: false, reason: 'A block needs a first and a last number.' }
  if (!r.size || r.size < 1) return { ok: false, reason: 'A block of nothing is not a block.' }
  if (r.reserved == null || r.reserved < 0) {
    return { ok: false, reason: 'Say how much of it the owning system has actually promised.' }
  }
  if (r.reserved > r.size) {
    return {
      ok: false,
      reason: 'More is reserved than the block holds. Reserving beyond the block is reserving numbers that are not there.',
    }
  }
  const { error } = await supabase.from('number_range').upsert(r as NumberRange, { onConflict: 'id' })
  if (error) return { ok: false, reason: friendly(error.message) }
  return {
    ok: true,
    note: r.expires_on
      ? `Saved. The reservation lapses on ${r.expires_on} — the numbers in it go back to the owning system that day.`
      : 'Saved.',
  }
}

function friendly(message: string): string {
  const m = message.replace(/^.*?\bERROR:\s*/i, '').trim()
  if (/row-level security/i.test(m)) {
    return 'You are not allowed to change that. Only the marketplace allocates numbers.'
  }
  return m
}
