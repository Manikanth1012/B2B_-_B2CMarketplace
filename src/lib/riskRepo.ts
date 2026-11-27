/**
 * The only module that reads and writes the risk screens' data: held orders,
 * the scores behind them, the rules and bands, and the account scores
 * (migration 20261113600000).
 *
 * The tables are readable by the operator only and have no write policies; every
 * write is a function call. Before the migration is applied every call fails
 * with "does not exist" (or PostgREST's "could not find ... in the schema cache"),
 * and `missing` says so, so a caller can carry on exactly as before. What a score
 * means lives in risk.ts. A buyer never reads order_risk: `heldRefs` reads only
 * the status of the buyer's own orders.
 */
import { supabase } from './supabase'
import { isMissing } from './basketRepo'
import type { Kept } from './basketRepo'
import { DEFAULT_ACCOUNT_BANDS, DEFAULT_ORDER_BANDS } from './risk'
import type { AccountBand, Bands, OrderBand, RiskReason } from './risk'

export type { Kept }

const fail = <T>(error: unknown): Kept<T> => {
  if (error && typeof error === 'object' && 'message' in (error as object)) {
    const e = error as { message?: string; code?: string }
    return { ok: false, missing: isMissing(e), error: e.message ?? 'The request failed.' }
  }
  return { ok: false, missing: false, error: error instanceof Error ? error.message : 'The request failed.' }
}

export interface HeldRow {
  order_ref: string
  buyer: string
  total: number
  currency: string
  score: number
  band: OrderBand
  reasons: RiskReason[]
  scored_at: string
}
export interface FlaggedRow extends HeldRow {
  status: string
  decision: string | null
  decided_by: string | null
  decided_at: string | null
  note: string | null
}
export interface AccountRiskRow {
  kind: 'shopper' | 'business'
  id: string
  name: string
  score: number
  band: AccountBand
  reasons: RiskReason[]
  scored_at: string
}
export interface RuleRow {
  id: string
  applies: 'order' | 'account'
  label: string
  points: number
  enabled: boolean
  threshold: number | null
  unit: string | null
  sort_order: number
}
export interface RuleChange { id: number; rule_id: string; field: string; was: string | null; now: string | null; by_name: string; at: string }
export interface RiskBook {
  held: HeldRow[]
  flagged: FlaggedRow[]
  accounts: AccountRiskRow[]
  rules: RuleRow[]
  bands: { order: Bands; account: Bands }
  changes: RuleChange[]
}

type Rec = Record<string, unknown>

const reasonsOf = (v: unknown): RiskReason[] =>
  Array.isArray(v)
    ? (v as Rec[]).map(r => ({ rule: String(r.rule ?? ''), label: String(r.label ?? ''), points: Number(r.points ?? 0) }))
    : []

const numOrNull = (v: unknown): number | null =>
  (v === null || v === undefined || !Number.isFinite(Number(v)) ? null : Number(v))

const toRow = (s: Rec, o: Rec): FlaggedRow => ({
  order_ref: String(o.order_ref),
  buyer: String(o.buyer_name ?? 'Unknown buyer'),
  total: Number(o.total ?? 0),
  currency: String(o.currency ?? ''),
  score: Number(s.score),
  band: s.band as OrderBand,
  reasons: reasonsOf(s.reasons),
  scored_at: String(s.scored_at),
  status: String(o.status ?? ''),
  decision: s.decision === null || s.decision === undefined ? null : String(s.decision),
  decided_by: s.decided_by === null || s.decided_by === undefined ? null : String(s.decided_by),
  decided_at: s.decided_at === null || s.decided_at === undefined ? null : String(s.decided_at),
  note: s.note === null || s.note === undefined ? null : String(s.note),
})

const ORDER_COLS = 'id, order_ref, buyer_name, total, currency, status'
const SCORE_COLS = 'order_id, score, band, reasons, scored_at, decision, decided_by, decided_at, note'

/** Everything the Risk screen shows. Orders are joined to their scores here, with no foreign-key embed. */
export async function loadRiskBook(now: Date = new Date()): Promise<Kept<RiskBook>> {
  try {
    const since = new Date(now.getTime() - 30 * 86_400_000).toISOString()
    const [heldOrders, flaggedScores, accounts, rules, settings, changes, profiles, companies] = await Promise.all([
      supabase.from('orders').select(ORDER_COLS).eq('status', 'held'),
      supabase.from('order_risk').select(SCORE_COLS).or('band.eq.review,and(band.eq.hold,decision.not.is.null)').gte('scored_at', since)
        .order('scored_at', { ascending: false }),
      supabase.from('account_risk').select('kind, id, score, band, reasons, scored_at').order('score', { ascending: false }),
      supabase.from('risk_rules').select('id, applies, label, points, enabled, threshold, unit, sort_order').order('sort_order'),
      supabase.from('risk_settings').select('kind, review_at, hold_at'),
      supabase.from('risk_rule_changes').select('id, rule_id, field, was, now, by_name, at')
        .order('at', { ascending: false }).limit(50),
      supabase.from('consumer_profile').select('user_id, name'),
      supabase.from('enterprise_accounts').select('id, company'),
    ])
    const first = [heldOrders.error, flaggedScores.error, accounts.error, rules.error, settings.error, changes.error].find(Boolean)
    if (first) return fail(first)

    const heldList = (heldOrders.data ?? []) as Rec[]
    const heldIds = heldList.map(o => String(o.id))
    const heldScores = heldIds.length
      ? await supabase.from('order_risk').select(SCORE_COLS).in('order_id', heldIds)
      : { data: [] as Rec[], error: null }
    if (heldScores.error) return fail(heldScores.error)
    const scoreOf = new Map(((heldScores.data ?? []) as Rec[]).map(s => [String(s.order_id), s]))
    const held = heldList
      .filter(o => scoreOf.has(String(o.id)))
      .map(o => toRow(scoreOf.get(String(o.id))!, o))
      .sort((a, b) => (a.scored_at < b.scored_at ? 1 : -1))

    const fs = (flaggedScores.data ?? []) as Rec[]
    const flaggedIds = fs.map(s => String(s.order_id))
    const flaggedOrders = flaggedIds.length
      ? await supabase.from('orders').select(ORDER_COLS).in('id', flaggedIds)
      : { data: [] as Rec[], error: null }
    if (flaggedOrders.error) return fail(flaggedOrders.error)
    const orderOf = new Map(((flaggedOrders.data ?? []) as Rec[]).map(o => [String(o.id), o]))
    const flagged = fs
      .filter(s => orderOf.has(String(s.order_id)) && orderOf.get(String(s.order_id))!.status !== 'held')
      .map(s => toRow(s, orderOf.get(String(s.order_id))!))

    const shopperName = new Map(((profiles.data ?? []) as Rec[]).map(p => [String(p.user_id), String(p.name ?? '')]))
    const companyName = new Map(((companies.data ?? []) as Rec[]).map(c => [String(c.id), String(c.company ?? c.id)]))
    const accountRows: AccountRiskRow[] = ((accounts.data ?? []) as Rec[]).map(a => {
      const kind = a.kind === 'business' ? 'business' : 'shopper'
      const id = String(a.id)
      const name = (kind === 'business' ? companyName.get(id) : shopperName.get(id)) || (kind === 'business' ? id : 'Unknown shopper')
      return { kind, id, name, score: Number(a.score), band: a.band as AccountBand, reasons: reasonsOf(a.reasons), scored_at: String(a.scored_at) }
    })

    const bandFor = (kind: string, fallback: Bands): Bands => {
      const s = ((settings.data ?? []) as Rec[]).find(x => x.kind === kind)
      return s ? { review_at: Number(s.review_at), hold_at: Number(s.hold_at) } : fallback
    }

    return {
      ok: true,
      value: {
        held, flagged, accounts: accountRows,
        rules: ((rules.data ?? []) as Rec[]).map(r => ({
          id: String(r.id), applies: r.applies === 'account' ? 'account' : 'order', label: String(r.label ?? r.id),
          points: Number(r.points), enabled: r.enabled === true, threshold: numOrNull(r.threshold),
          unit: r.unit === null || r.unit === undefined ? null : String(r.unit), sort_order: Number(r.sort_order ?? 0),
        })),
        bands: { order: bandFor('order', DEFAULT_ORDER_BANDS), account: bandFor('account', DEFAULT_ACCOUNT_BANDS) },
        changes: ((changes.data ?? []) as Rec[]).map(c => ({
          id: Number(c.id), rule_id: String(c.rule_id), field: String(c.field),
          was: c.was === null || c.was === undefined ? null : String(c.was),
          now: c.now === null || c.now === undefined ? null : String(c.now),
          by_name: String(c.by_name), at: String(c.at),
        })),
      },
    }
  } catch (e) {
    return fail(e)
  }
}

/** Release a held order, or cancel it and refund it. The note is required. */
export async function decideHeldOrder(ref: string, decision: 'release' | 'cancel', note: string): Promise<Kept<unknown>> {
  try {
    const { data, error } = await supabase.rpc('decide_held_order', { p_order_ref: ref, p_decision: decision, p_note: note })
    if (error) return fail(error)
    return { ok: true, value: data }
  } catch (e) {
    return fail(e)
  }
}

export async function updateRiskRule(
  id: string, edit: { points: number; enabled: boolean; threshold: number | null },
): Promise<Kept<unknown>> {
  try {
    const { data, error } = await supabase.rpc('update_risk_rule', {
      p_id: id, p_points: edit.points, p_enabled: edit.enabled, p_threshold: edit.threshold,
    })
    if (error) return fail(error)
    return { ok: true, value: data }
  } catch (e) {
    return fail(e)
  }
}

export async function setRiskBands(kind: 'order' | 'account', bands: Bands): Promise<Kept<unknown>> {
  try {
    const { data, error } = await supabase.rpc('set_risk_bands', {
      p_kind: kind, p_review_at: bands.review_at, p_hold_at: bands.hold_at,
    })
    if (error) return fail(error)
    return { ok: true, value: data }
  } catch (e) {
    return fail(e)
  }
}

/** Score every account now. Returns what the nightly job's result holds. */
export async function rescoreAccounts(): Promise<Kept<{ scored: number; review: number; high: number; failed?: number }>> {
  try {
    const { data, error } = await supabase.rpc('refresh_account_risk')
    if (error) return fail(error)
    const r = (data ?? {}) as Rec
    /* `failed`: accounts that could not be scored and kept their last score
       (20261127100000); absent before it, read as 0. */
    return { ok: true, value: {
      scored: Number(r.scored ?? 0), review: Number(r.review ?? 0), high: Number(r.high ?? 0), failed: Number(r.failed ?? 0),
    } }
  } catch (e) {
    return fail(e)
  }
}

/** The risk score of each order given, by order id; empty when there is none or the tables are missing. */
export async function orderScores(orderIds: string[]): Promise<Map<string, { score: number; band: OrderBand }>> {
  const out = new Map<string, { score: number; band: OrderBand }>()
  if (orderIds.length === 0) return out
  try {
    const { data, error } = await supabase.from('order_risk').select('order_id, score, band').in('order_id', orderIds)
    if (error) return out
    for (const r of (data ?? []) as Rec[]) out.set(String(r.order_id), { score: Number(r.score), band: r.band as OrderBand })
  } catch { /* fail soft */ }
  return out
}

/** The band of each business account (by account id); empty when the tables are missing. */
export async function accountBands(kind: 'shopper' | 'business'): Promise<Map<string, { score: number; band: AccountBand }>> {
  const out = new Map<string, { score: number; band: AccountBand }>()
  try {
    const { data, error } = await supabase.from('account_risk').select('id, score, band').eq('kind', kind)
    if (error) return out
    for (const r of (data ?? []) as Rec[]) out.set(String(r.id), { score: Number(r.score), band: r.band as AccountBand })
  } catch { /* fail soft */ }
  return out
}

/** Which of the just-placed order references are being held. Never throws; [] when unknown. */
export async function heldRefs(refs: string[]): Promise<string[]> {
  if (refs.length === 0) return []
  try {
    const { data, error } = await supabase.from('orders').select('order_ref, status').in('order_ref', refs)
    if (error) return []
    return ((data ?? []) as Rec[]).filter(o => o.status === 'held').map(o => String(o.order_ref))
  } catch {
    return []
  }
}
