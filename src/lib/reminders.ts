/**
 * Reminders on a schedule, and basket windows — the rules, without a database.
 *
 * Spec 19 (migration 20261127400000). A rule on a dated event has steps, each
 * an offset from the event's anchor date: n−7 is seven days before, n+0 the
 * day, n+2 two days after. The night sends a step on anchor + offset (UTC).
 * Baskets read their windows (pending, abandoned after, clear after) from
 * `basket_settings`, per market, instead of a hard-coded 7 and 90.
 *
 * Every date here is a UTC calendar day, 'YYYY-MM-DD', as the database's
 * `date` columns and `run_reminders(p_as_of)` use them. Pure: no Supabase.
 */
import type { KindId } from './notifications'

export type Check = { ok: true } | { ok: false; reason: string }

const DAY_MS = 86_400_000

/* ------------------------------------------------------------ dates -- */

/** 'YYYY-MM-DD' (or a timestamp) → the UTC day number; NaN when unreadable. */
function dayNumber(iso: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  const t = m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : Date.parse(iso)
  return Number.isNaN(t) ? NaN : Math.floor(t / DAY_MS)
}

const fromDayNumber = (n: number): string => new Date(n * DAY_MS).toISOString().slice(0, 10)

/** The UTC calendar day of a date or timestamp, or null when it cannot be read. */
export function utcDay(iso: string | Date): string | null {
  const n = typeof iso === 'string' ? dayNumber(iso) : Math.floor(iso.getTime() / DAY_MS)
  return Number.isNaN(n) ? null : fromDayNumber(n)
}

/** `day` plus `days` (negative goes back). Null when `day` cannot be read. */
export function addDays(day: string, days: number): string | null {
  const n = dayNumber(day)
  return Number.isNaN(n) ? null : fromDayNumber(n + days)
}

/** Whole days from `from` to `to` (negative when `to` is earlier); null when either cannot be read. */
export function daysBetween(from: string, to: string): number | null {
  const a = dayNumber(from), b = dayNumber(to)
  return Number.isNaN(a) || Number.isNaN(b) ? null : b - a
}

/* ------------------------------------------------------ offset maths -- */

export const MIN_OFFSET = -30
export const MAX_OFFSET = 30

/** The day a step at `offset` is sent for an anchor: anchor + offset. */
export function dueOn(anchor: string, offset: number): string | null {
  return addDays(anchor, offset)
}

/** The anchor a step at `offset` is sent for on `today`: today − offset (as run_reminders computes it). */
export function anchorFor(today: string, offset: number): string | null {
  return addDays(today, -offset)
}

export interface StepLike { id?: string; offset_days: number; enabled?: boolean }

/**
 * The steps due on `today` for a subject whose anchor is `anchor`: those with
 * anchor + offset = today. Steps that are off are left out unless
 * `includeOff`. Usually one; two only when two steps share an offset.
 */
export function stepsDueOn<S extends StepLike>(steps: readonly S[], anchor: string, today: string,
  includeOff = false): S[] {
  const gap = daysBetween(anchor, today)
  if (gap === null) return []
  return steps.filter(s => s.offset_days === gap && (includeOff || s.enabled !== false))
}

/** The first step due on `today`, or null. */
export function stepDueOn<S extends StepLike>(steps: readonly S[], anchor: string, today: string): S | null {
  return stepsDueOn(steps, anchor, today)[0] ?? null
}

/* -------------------------------------------------------------- labels -- */

const MINUS = '−'

/** 'n−7', 'n+0', 'n+2'. */
export function offsetCode(offset: number): string {
  return offset < 0 ? `n${MINUS}${-offset}` : `n+${offset}`
}

/** '7 days before', '1 day before', 'on the day', '2 days after'. */
export function stepLabel(offset: number): string {
  if (offset === 0) return 'on the day'
  const n = Math.abs(offset)
  return `${n} ${n === 1 ? 'day' : 'days'} ${offset < 0 ? 'before' : 'after'}`
}

/** '7 days before (n−7)'. */
export function stepLabelWithCode(offset: number): string {
  return `${stepLabel(offset)} (${offsetCode(offset)})`
}

/** 'n−7', 'n-7', 'n+2', 'n 0', '-3', '+1' → the offset; null when it is not one or is out of range. */
export function parseOffset(text: string): number | null {
  const m = /^\s*n?\s*([+\-−])?\s*(\d{1,2})\s*$/i.exec(text)
  if (!m) return null
  const n = Number(m[2]) * (m[1] === '-' || m[1] === MINUS ? -1 : 1)
  return n < MIN_OFFSET || n > MAX_OFFSET ? null : n === 0 ? 0 : n
}

/* -------------------------------------------------------------- steps -- */

export interface StepDraft { offset_days: number; kinds: readonly string[] }

/** What the database's guard_rule_step refuses, said first. */
export function validateStep(step: StepDraft, ruleKinds: readonly string[]): Check {
  if (!Number.isInteger(step.offset_days)) return { ok: false, reason: 'The offset is a whole number of days' }
  if (step.offset_days < MIN_OFFSET || step.offset_days > MAX_OFFSET) {
    return { ok: false, reason: `A step goes from 30 days before to 30 days after, not ${stepLabel(step.offset_days)}` }
  }
  if (step.kinds.length === 0) return { ok: false, reason: 'A step that goes nowhere sends nothing. Pick at least one channel' }
  const foreign = step.kinds.filter(k => !ruleKinds.includes(k))
  if (foreign.length) {
    return { ok: false, reason: `The rule does not send on ${foreign.join(' or ')}. Add it to the rule first` }
  }
  return { ok: true }
}

/** The channels of a step with no template written for them. */
export function missingStepTemplates(step: { id: string; kinds: readonly string[] },
  templates: readonly { step_id: string; kind_id: string }[]): KindId[] {
  return step.kinds.filter(k => !templates.some(t => t.step_id === step.id && t.kind_id === k)) as KindId[]
}

/* ------------------------------------------------------ basket windows -- */

export interface BasketWindow {
  pending_days: number
  abandoned_after_days: number
  clear_after_days: number
}

/** Today's numbers, and what every market is seeded with. */
export const DEFAULT_BASKET_WINDOW: BasketWindow = { pending_days: 7, abandoned_after_days: 7, clear_after_days: 90 }

const LIMIT = { min: 1, max: 365 }

/** The basket_settings constraints, in words. */
export function validateBasketWindow(s: BasketWindow): Check {
  const named: [keyof BasketWindow, string][] = [
    ['pending_days', 'Pending'], ['abandoned_after_days', 'Abandoned after'], ['clear_after_days', 'Clear after'],
  ]
  for (const [key, label] of named) {
    const v = s[key]
    if (typeof v !== 'number' || !Number.isInteger(v)) return { ok: false, reason: `${label} is a whole number of days` }
    if (v < LIMIT.min || v > LIMIT.max) return { ok: false, reason: `${label} is between 1 and 365 days, not ${v}` }
  }
  if (s.abandoned_after_days < s.pending_days) {
    return { ok: false, reason: 'A basket cannot be abandoned while it is still pending: abandoned after must be at least the pending days' }
  }
  if (s.clear_after_days <= s.abandoned_after_days) {
    return { ok: false, reason: 'A basket is cleared only after it is abandoned: clear after must be more than abandoned after' }
  }
  return { ok: true }
}

/** The rules that apply in a market: its own, else the default, else today's numbers. */
export function windowFor<W extends BasketWindow & { market: string }>(rows: readonly W[], market: string | null | undefined): BasketWindow {
  return rows.find(r => r.market === market) ?? rows.find(r => r.market === 'default') ?? DEFAULT_BASKET_WINDOW
}

/** The day a basket becomes abandoned: last change + abandoned_after_days (UTC), as basket_anchor. */
export function abandonedOn(lastChange: string, s: BasketWindow): string | null {
  const t = Date.parse(lastChange)
  return Number.isNaN(t) ? null : fromDayNumber(Math.floor((t + s.abandoned_after_days * DAY_MS) / DAY_MS))
}

/** The night that clears a basket: the day of its last change + clear_after_days + 1 (UTC), as basket_anchor. */
export function clearsOn(lastChange: string, s: BasketWindow): string | null {
  const day = utcDay(lastChange)
  return day === null ? null : addDays(day, s.clear_after_days + 1)
}

/** How close to clearing counts as clearing soon: the default first clearing reminder (n−7). */
export const CLEARING_SOON_DAYS = 7

export type BasketState = 'pending' | 'abandoned' | 'clearing-soon'

/**
 * Where a basket stands on `today` (a day or a timestamp):
 *   abandoned      untouched for abandoned_after_days or more;
 *   clearing-soon  abandoned, and the night that clears it is within
 *                  CLEARING_SOON_DAYS;
 *   pending        otherwise. Between pending_days and abandoned_after_days
 *                  (when the operator sets them apart) a basket is still
 *                  pending: it is not abandoned yet.
 * An unreadable date reads as pending: nobody is chased on a guess.
 */
export function basketStateFor(lastChange: string, s: BasketWindow, today: string | Date): BasketState {
  const t = Date.parse(lastChange)
  const now = typeof today === 'string'
    ? (/^\d{4}-\d{2}-\d{2}$/.test(today) ? Date.parse(`${today}T00:00:00Z`) : Date.parse(today))
    : today.getTime()
  if (Number.isNaN(t) || Number.isNaN(now)) return 'pending'
  if (now - t < s.abandoned_after_days * DAY_MS) return 'pending'
  const clears = clearsOn(lastChange, s)
  const day = utcDay(new Date(now))
  const left = clears && day ? daysBetween(day, clears) : null
  return left !== null && left <= CLEARING_SOON_DAYS ? 'clearing-soon' : 'abandoned'
}

export const BASKET_STATE_LABEL: Record<BasketState, string> = {
  pending: 'Pending', abandoned: 'Abandoned', 'clearing-soon': 'Clearing soon',
}

/** 'Pending: changed in the last 7 days. Abandoned: left for 7 days or more. Cleared after 90 days untouched.' */
export function basketWindowLine(s: BasketWindow): string {
  const d = (n: number) => `${n} ${n === 1 ? 'day' : 'days'}`
  return `Pending: changed in the last ${d(s.pending_days)}. Abandoned: left for ${d(s.abandoned_after_days)} or more. ` +
    `Cleared by the nightly run after ${d(s.clear_after_days)} untouched.`
}
