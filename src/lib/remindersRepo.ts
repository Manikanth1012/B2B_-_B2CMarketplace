/**
 * The only module that reads and writes basket windows and reminder
 * schedules (migration 20261127400000): `basket_settings`, the steps of a rule
 * on a dated event (`notification_rule_steps`) with what each says
 * (`notification_step_templates`), and what the night sent
 * (`notification_schedule_log`).
 *
 * Settings, steps and templates are written straight to their tables; row
 * level security lets only the operator write them and the database's
 * triggers refuse what basket windows and steps may not be. The schedule log
 * is read only. Before the migration is applied every call fails with "does
 * not exist" (or PostgREST's "could not find … in the schema cache"), and
 * `missing` says so, as in basketRepo. Rules live in reminders.ts.
 */
import { supabase } from './supabase'
import { isMissing } from './basketRepo'
import type { Kept } from './basketRepo'
import type { KindId } from './notifications'
import type { BasketWindow } from './reminders'

type PgError = { message?: string; code?: string } | null | undefined

const fail = <T>(error: PgError | unknown): Kept<T> => {
  if (error && typeof error === 'object' && 'message' in (error as object)) {
    const e = error as { message?: string; code?: string }
    return { ok: false, missing: isMissing(e), error: e.message ?? 'The request failed.' }
  }
  return { ok: false, missing: false, error: error instanceof Error ? error.message : 'The request failed.' }
}

const str = (v: unknown): string | null => (v === null || v === undefined ? null : String(v))

/* ---------------------------------------------------- basket windows -- */

export interface BasketSettings extends BasketWindow {
  /** A market code, or 'default'. */
  market: string
  updated_at: string | null
  updated_by: string | null
}

const SETTINGS = 'market, pending_days, abandoned_after_days, clear_after_days, updated_at, updated_by'

function toSettings(r: Record<string, unknown>): BasketSettings {
  return {
    market: String(r.market), pending_days: Number(r.pending_days),
    abandoned_after_days: Number(r.abandoned_after_days), clear_after_days: Number(r.clear_after_days),
    updated_at: str(r.updated_at), updated_by: str(r.updated_by),
  }
}

/** Every market's basket rules, the default first. */
export async function loadBasketSettings(): Promise<Kept<BasketSettings[]>> {
  try {
    const { data, error } = await supabase.from('basket_settings').select(SETTINGS).order('market')
    if (error) return fail(error)
    const rows = ((data ?? []) as Record<string, unknown>[]).map(toSettings)
    rows.sort((a, b) => (a.market === 'default' ? -1 : b.market === 'default' ? 1 : a.market.localeCompare(b.market)))
    return { ok: true, value: rows }
  } catch (e) {
    return fail(e)
  }
}

/** Add or change one market's rules (or the default's). Returns the row as kept. Operator only. */
export async function saveBasketSettings(market: string, w: BasketWindow): Promise<Kept<BasketSettings>> {
  try {
    const { data, error } = await supabase.from('basket_settings')
      .upsert({
        market, pending_days: w.pending_days,
        abandoned_after_days: w.abandoned_after_days, clear_after_days: w.clear_after_days,
      }, { onConflict: 'market' })
      .select(SETTINGS)
      .single()
    if (error) return fail(error)
    return { ok: true, value: toSettings(data as Record<string, unknown>) }
  } catch (e) {
    return fail(e)
  }
}

/** A market back on the default rules. The default itself cannot be removed. */
export async function removeBasketSettings(market: string): Promise<Kept<number>> {
  if (market === 'default') return { ok: false, missing: false, error: 'The default basket rules cannot be removed.' }
  try {
    const { data, error } = await supabase.from('basket_settings').delete().eq('market', market).select('market')
    if (error) return fail(error)
    return { ok: true, value: (data ?? []).length }
  } catch (e) {
    return fail(e)
  }
}

/** Every market's code, for adding rules to a market that has none of its own. */
export async function loadMarketCodes(): Promise<Kept<string[]>> {
  try {
    const { data, error } = await supabase.from('markets').select('code').order('sort_order')
    if (error) return fail(error)
    return { ok: true, value: ((data ?? []) as Record<string, unknown>[]).map(r => String(r.code)) }
  } catch (e) {
    return fail(e)
  }
}

/* -------------------------------------------------------------- steps -- */

export interface StepTemplate {
  id: string
  step_id: string
  kind_id: KindId
  subject: string
  body: string
  edited_by: string | null
  edited_on: string | null
}

export interface RuleStep {
  id: string
  rule_id: string
  offset_days: number
  kinds: KindId[]
  enabled: boolean
  sort_order: number
  templates: StepTemplate[]
}

const TEMPLATE = 'id, step_id, kind_id, subject, body, edited_by, edited_on'
const STEP = `id, rule_id, offset_days, kinds, enabled, sort_order, templates:notification_step_templates(${TEMPLATE})`

function toTemplate(t: Record<string, unknown>): StepTemplate {
  return {
    id: String(t.id), step_id: String(t.step_id), kind_id: String(t.kind_id) as KindId,
    subject: String(t.subject ?? ''), body: String(t.body ?? ''),
    edited_by: str(t.edited_by), edited_on: str(t.edited_on),
  }
}

function toStep(r: Record<string, unknown>): RuleStep {
  return {
    id: String(r.id), rule_id: String(r.rule_id), offset_days: Number(r.offset_days),
    kinds: ((r.kinds ?? []) as unknown[]).map(k => String(k) as KindId),
    enabled: !!r.enabled, sort_order: Number(r.sort_order ?? 0),
    templates: ((r.templates ?? []) as Record<string, unknown>[]).map(toTemplate),
  }
}

const byOrder = (a: RuleStep, b: RuleStep) =>
  a.rule_id.localeCompare(b.rule_id) || a.sort_order - b.sort_order || a.offset_days - b.offset_days || a.id.localeCompare(b.id)

/** The steps of one rule, or of every rule, each with its templates. */
export async function loadSteps(ruleId?: string): Promise<Kept<RuleStep[]>> {
  try {
    let q = supabase.from('notification_rule_steps').select(STEP)
    if (ruleId) q = q.eq('rule_id', ruleId)
    const { data, error } = await q.order('sort_order')
    if (error) return fail(error)
    return { ok: true, value: ((data ?? []) as Record<string, unknown>[]).map(toStep).sort(byOrder) }
  } catch (e) {
    return fail(e)
  }
}

export interface StepInput { offset_days: number; kinds: KindId[]; enabled?: boolean; sort_order?: number }

/** A new step on a rule; off unless said otherwise. */
export async function addStep(ruleId: string, s: StepInput): Promise<Kept<RuleStep>> {
  try {
    const { data, error } = await supabase.from('notification_rule_steps')
      .insert({
        rule_id: ruleId, offset_days: s.offset_days, kinds: s.kinds,
        enabled: s.enabled ?? false, sort_order: s.sort_order ?? 0,
      })
      .select(STEP)
      .single()
    if (error) return fail(error)
    return { ok: true, value: toStep(data as Record<string, unknown>) }
  } catch (e) {
    return fail(e)
  }
}

/** Change a step's offset, channels, order or switch. */
export async function updateStep(id: string, patch: Partial<StepInput>): Promise<Kept<RuleStep>> {
  try {
    const { data, error } = await supabase.from('notification_rule_steps')
      .update(patch)
      .eq('id', id)
      .select(STEP)
      .single()
    if (error) return fail(error)
    return { ok: true, value: toStep(data as Record<string, unknown>) }
  } catch (e) {
    return fail(e)
  }
}

/** A step gone, with its templates. What it sent stays in the schedule log: the rows keep their step label and
    offset, and their step_id goes null (on delete set null). */
export async function removeStep(id: string): Promise<Kept<number>> {
  try {
    const { data, error } = await supabase.from('notification_rule_steps').delete().eq('id', id).select('id')
    if (error) return fail(error)
    return { ok: true, value: (data ?? []).length }
  } catch (e) {
    return fail(e)
  }
}

/** What a step says on one channel, written or rewritten. */
export async function saveStepTemplate(t: { step_id: string; kind_id: KindId; subject: string; body: string; edited_by?: string | null }):
  Promise<Kept<StepTemplate>> {
  try {
    const { data, error } = await supabase.from('notification_step_templates')
      .upsert({
        step_id: t.step_id, kind_id: t.kind_id, subject: t.subject, body: t.body,
        edited_by: t.edited_by ?? null, edited_on: new Date().toISOString().slice(0, 10),
      }, { onConflict: 'step_id,kind_id' })
      .select(TEMPLATE)
      .single()
    if (error) return fail(error)
    return { ok: true, value: toTemplate(data as Record<string, unknown>) }
  } catch (e) {
    return fail(e)
  }
}

export async function removeStepTemplate(id: string): Promise<Kept<number>> {
  try {
    const { data, error } = await supabase.from('notification_step_templates').delete().eq('id', id).select('id')
    if (error) return fail(error)
    return { ok: true, value: (data ?? []).length }
  } catch (e) {
    return fail(e)
  }
}

/* ------------------------------------------------------ schedule log -- */

/** 'claimed' only while a run is sending it; 'deferred' when the rule's throttle held it back for another night;
    'expired' when a deferred one could no longer be sent. */
export type ScheduleOutcome = 'claimed' | 'sent' | 'deferred' | 'expired' | 'skipped_preference' | 'skipped_no_template'

export interface ScheduleLogRow {
  id: number
  /** Null once the step has been removed; the label and offset still say what it was. */
  step_id: string | null
  step_label: string
  rule_id: string
  event_id: string
  offset_days: number
  subject_id: string
  anchor_date: string
  /** anchor_date + offset when the row was made: the day it was due. */
  due_on: string
  sent_on: string
  outcome: ScheduleOutcome
  detail: string | null
  notification_ids: string[]
  recipient: string | null
  user_id: string | null
  ref: string | null
  created_at: string
}

const LOG = 'id, step_id, step_label, rule_id, event_id, offset_days, subject_id, anchor_date, due_on, sent_on, outcome, detail, notification_ids, recipient, user_id, ref, created_at'

export const SCHEDULE_LOG_LIMIT = 500

/** What the night sent (or why not), newest first. */
export async function loadScheduleLog(f: { ruleId?: string; stepId?: string; subjectId?: string; limit?: number;
  /** Server-side: only these events. */ events?: readonly string[]; /** Server-side: only this outcome. */ outcome?: ScheduleOutcome } = {}):
  Promise<Kept<ScheduleLogRow[]>> {
  try {
    let q = supabase.from('notification_schedule_log').select(LOG)
    if (f.ruleId) q = q.eq('rule_id', f.ruleId)
    if (f.stepId) q = q.eq('step_id', f.stepId)
    if (f.subjectId) q = q.eq('subject_id', f.subjectId)
    if (f.events) q = q.in('event_id', [...f.events])
    if (f.outcome) q = q.eq('outcome', f.outcome)
    const { data, error } = await q.order('created_at', { ascending: false }).limit(f.limit ?? SCHEDULE_LOG_LIMIT)
    if (error) return fail(error)
    const rows = ((data ?? []) as Record<string, unknown>[]).map(r => ({
      id: Number(r.id), step_id: str(r.step_id), step_label: String(r.step_label ?? ''),
      rule_id: String(r.rule_id), event_id: String(r.event_id),
      offset_days: Number(r.offset_days), subject_id: String(r.subject_id), anchor_date: String(r.anchor_date),
      due_on: String(r.due_on ?? ''),
      sent_on: String(r.sent_on), outcome: String(r.outcome) as ScheduleOutcome, detail: str(r.detail),
      notification_ids: ((r.notification_ids ?? []) as unknown[]).map(String),
      recipient: str(r.recipient), user_id: str(r.user_id), ref: str(r.ref), created_at: String(r.created_at),
    }))
    return { ok: true, value: rows }
  } catch (e) {
    return fail(e)
  }
}
