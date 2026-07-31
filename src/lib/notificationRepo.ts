/* The only module that reads or writes notification configuration.
   Rules live in notifications.ts so they can be tested without a network.

   Every write here is checked twice on purpose: once in `notifications.ts` so
   the screen can explain the refusal in the recipient's own words, and once by
   a trigger in the database so a refusal cannot be skipped by talking to the
   API directly. */

import { supabase } from './supabase'
import { validatePreference, validateRule, validateTemplate, orderKinds } from './notifications'
import type {
  Kind, NotificationEvent, Rule, Template, Preference, LogEntry, Gateway,
  Persona, KindId, Check, Effective,
} from './notifications'

export type Result = Check

export interface NotificationBook {
  kinds: Kind[]
  events: NotificationEvent[]
  rules: Rule[]
  templates: Template[]
  preferences: Preference[]
  log: LogEntry[]
  gateways: Gateway[]
  loadError?: string
}

const EMPTY: NotificationBook = {
  kinds: [], events: [], rules: [], templates: [], preferences: [], log: [], gateways: [],
}

/** Everything the operator configures. One read, because a screen that fetches
    rules without templates will happily show a rule that can say nothing. */
export async function loadConfiguration(): Promise<NotificationBook> {
  const [k, e, r, t, p, l, g] = await Promise.all([
    supabase.from('notification_kinds').select('*').order('sort_order'),
    supabase.from('notification_events').select('*').order('sort_order'),
    supabase.from('notification_rules').select('*').order('sort_order'),
    supabase.from('notification_templates').select('*').order('id'),
    supabase.from('notification_preferences').select('*').order('id'),
    supabase.from('notification_log').select('*').order('sent_at', { ascending: false }),
    supabase.from('operator_channels').select('id,name,kind,enabled,transport').order('sort_order'),
  ])
  const errors: string[] = []
  const grab = <T>(res: { data: unknown; error: { message: string } | null }, what: string): T[] => {
    if (res.error) errors.push(`${what}: ${res.error.message}`)
    return (res.data ?? []) as T[]
  }
  return {
    ...EMPTY,
    kinds: grab<Kind>(k, 'channels'),
    events: grab<NotificationEvent>(e, 'events'),
    rules: grab<Rule>(r, 'rules'),
    templates: grab<Template>(t, 'templates'),
    preferences: grab<Preference>(p, 'preferences'),
    log: grab<LogEntry>(l, 'history'),
    gateways: grab<Gateway>(g, 'gateways'),
    ...(errors.length ? { loadError: `Some of this did not load (${errors.join('; ')}).` } : {}),
  }
}

/**
 * What one recipient can see: the rules for their persona, the templates behind
 * them, their own preferences and their own history.
 *
 * RLS does the scoping, not this function — a partner's select on
 * `notification_rules` returns partner rules whatever is asked for. The filters
 * below are there so the query is small, not so that it is safe.
 */
export async function loadMine(persona: Persona): Promise<NotificationBook> {
  const [k, e, r, t, p, l] = await Promise.all([
    supabase.from('notification_kinds').select('*').order('sort_order'),
    supabase.from('notification_events').select('*').order('sort_order'),
    supabase.from('notification_rules').select('*').eq('persona', persona).order('sort_order'),
    supabase.from('notification_templates').select('*').order('id'),
    supabase.from('notification_preferences').select('*'),
    supabase.from('notification_log').select('*').order('sent_at', { ascending: false }).limit(100),
  ])
  const errors: string[] = []
  const grab = <T>(res: { data: unknown; error: { message: string } | null }, what: string): T[] => {
    if (res.error) errors.push(`${what}: ${res.error.message}`)
    return (res.data ?? []) as T[]
  }
  return {
    ...EMPTY,
    kinds: grab<Kind>(k, 'channels'),
    events: grab<NotificationEvent>(e, 'events'),
    rules: grab<Rule>(r, 'rules'),
    templates: grab<Template>(t, 'templates'),
    preferences: grab<Preference>(p, 'your preferences'),
    log: grab<LogEntry>(l, 'history'),
    ...(errors.length ? { loadError: `Some of this did not load (${errors.join('; ')}).` } : {}),
  }
}

/* ------------------------------------------------------------ preferences -- */

/**
 * A recipient changing where something reaches them.
 *
 * A recipient with no row yet is the normal case, not an error — they are on
 * the operator's defaults until the first time they touch the screen, so this
 * writes the whole choice rather than a delta.
 */
export async function savePreference(
  { rule, current, enabled, kinds, scope, partnerId }: {
    rule: Rule
    current: Effective
    enabled: boolean
    kinds: KindId[]
    scope: 'user' | 'partner'
    partnerId?: string
  },
): Promise<Result> {
  const wanted = orderKinds(kinds)
  const check = validatePreference(rule, enabled, wanted)
  if (!check.ok) return check

  if (scope === 'partner' && !partnerId) {
    return { ok: false, reason: 'This console does not know which seller account it is changing' }
  }

  const { data: session } = await supabase.auth.getUser()
  const userId = session.user?.id
  if (scope === 'user' && !userId) {
    return { ok: false, reason: 'Sign in again — this change could not be attributed to anybody' }
  }

  if (current.pref) {
    const { error } = await supabase.from('notification_preferences')
      .update({ enabled, kinds: wanted }).eq('id', current.pref.id)
    if (error) return { ok: false, reason: friendly(error.message) }
  } else {
    const id = scope === 'partner' ? `NP-${partnerId}-${rule.id}` : `NP-${userId!.slice(0, 8)}-${rule.id}`
    const { error } = await supabase.from('notification_preferences').insert({
      id, rule_id: rule.id, scope,
      user_id: scope === 'user' ? userId : null,
      partner_id: scope === 'partner' ? partnerId : null,
      enabled, kinds: wanted,
    })
    if (error) return { ok: false, reason: friendly(error.message) }
  }

  return {
    ok: true,
    note: enabled
      ? `${rule.name} — ${wanted.join(', ')}`
      : `${rule.name} is off. Nothing will be sent about it.`,
  }
}

/** Back to whatever the operator set, which is not the same as "everything on". */
export async function resetPreference(pref: Preference, rule: Rule): Promise<Result> {
  const { error } = await supabase.from('notification_preferences').delete().eq('id', pref.id)
  if (error) return { ok: false, reason: friendly(error.message) }
  return { ok: true, note: `${rule.name} is back to how the marketplace set it.` }
}

/* ----------------------------------------------------------------- rules --- */

export async function saveRule(
  { rule, book, isNew }: { rule: Rule; book: NotificationBook; isNew: boolean },
): Promise<Result> {
  const check = validateRule(rule, book.events, book.gateways)
  if (!check.ok) return check

  const payload = {
    persona: rule.persona, event_id: rule.event_id, name: rule.name.trim(),
    audience: rule.audience.trim() || 'Everyone', kinds: orderKinds(rule.kinds),
    throttle: rule.throttle, severity: rule.severity, enabled: rule.enabled,
    mandatory: rule.mandatory, why: rule.why.trim(), sort_order: rule.sort_order,
  }

  if (isNew) {
    const { error } = await supabase.from('notification_rules').insert({ id: rule.id, ...payload })
    if (error) return { ok: false, reason: friendly(error.message) }
  } else {
    const { error } = await supabase.from('notification_rules').update(payload).eq('id', rule.id)
    if (error) return { ok: false, reason: friendly(error.message) }
  }

  /* A rule is only trustworthy once something is written for every channel it
     claims, so the default is generated here rather than left as a to-do that
     surfaces as an empty message on somebody's phone. */
  const missing = orderKinds(rule.kinds).filter(
    (k) => !book.templates.some((t) => t.rule_id === rule.id && t.kind_id === k),
  )
  if (missing.length) {
    const ev = book.events.find((e) => e.id === rule.event_id)
    const rows = missing.map((k) => ({
      id: `${rule.id}-${k}`, rule_id: rule.id, kind_id: k,
      subject: rule.name.trim(),
      body: book.kinds.find((x) => x.id === k)?.max_chars === null
        ? `Hello {recipient},\n\n${rule.name.trim()}.\n\n${ev?.description ?? ''}\n\n{link}`
        : `${rule.name.trim()} — ${ev?.description ?? ''} {link}`.slice(0, 150),
    }))
    const { error } = await supabase.from('notification_templates').insert(rows)
    if (error) {
      return { ok: false, reason: `The rule saved but its wording did not: ${friendly(error.message)}` }
    }
    return { ok: true, note: `${rule.name} saved, with a starting draft for ${missing.join(' and ')}.` }
  }

  return { ok: true, note: `${rule.name} saved.` }
}

/** Switching a rule off leaves every preference behind it saved. Deleting it
    would throw away choices people made, to stop something the operator can
    stop with a flag. */
export async function setRuleEnabled(rule: Rule, enabled: boolean): Promise<Result> {
  if (rule.mandatory && !enabled) {
    return { ok: false, reason: `${rule.name} is mandatory. Make it optional first if it really should stop.` }
  }
  const { error } = await supabase.from('notification_rules').update({ enabled }).eq('id', rule.id)
  if (error) return { ok: false, reason: friendly(error.message) }
  return {
    ok: true,
    note: enabled
      ? `${rule.name} is on again. Everybody's saved choices apply as they were.`
      : `${rule.name} is off. Nothing goes out on it, and nobody's choices were touched.`,
  }
}

export async function deleteRule(rule: Rule, preferences: Preference[]): Promise<Result> {
  const n = preferences.filter((p) => p.rule_id === rule.id).length
  if (n > 0) {
    return {
      ok: false,
      reason: `${n} recipient${n === 1 ? ' has' : 's have'} chosen how they want this. Switch it off instead — deleting it throws their choices away.`,
    }
  }
  const { error } = await supabase.from('notification_rules').delete().eq('id', rule.id)
  if (error) return { ok: false, reason: friendly(error.message) }
  return { ok: true, note: `${rule.name} deleted along with its wording.` }
}

/* ------------------------------------------------------------- templates -- */

export async function saveTemplate(
  { template, kinds, by }: { template: Template; kinds: Kind[]; by: string },
): Promise<Result> {
  const check = validateTemplate(template, kinds)
  if (!check.ok) return check
  const { error } = await supabase.from('notification_templates').update({
    subject: template.subject.trim(),
    body: template.body,
    edited_by: by,
    edited_on: new Date().toISOString().slice(0, 10),
  }).eq('id', template.id)
  if (error) return { ok: false, reason: friendly(error.message) }
  return { ok: true, note: 'Saved. This is what goes out from now on.' }
}

/* -------------------------------------------------------------- gateways -- */

/** Which kind of message a gateway carries. Without it the channel catalogue is
    a list of vendors nobody can connect to a message. */
export async function setGatewayKind(gateway: Gateway, kind: KindId | null): Promise<Result> {
  const { error } = await supabase.from('operator_channels').update({ kind }).eq('id', gateway.id)
  if (error) return { ok: false, reason: friendly(error.message) }
  return { ok: true, note: `${gateway.name} now carries ${kind ?? 'nothing'}.` }
}

/** Turning off the last gateway behind a channel silences every rule using it,
    which is not something to discover afterwards. */
export async function setGatewayEnabled(
  gateway: Gateway, enabled: boolean, book: NotificationBook,
): Promise<Result> {
  if (!enabled && gateway.kind) {
    const others = book.gateways.filter((g) => g.id !== gateway.id && g.kind === gateway.kind && g.enabled)
    const rules = book.rules.filter((r) => r.enabled && r.kinds.includes(gateway.kind as KindId))
    if (!others.length && rules.length) {
      return {
        ok: false,
        reason: `${rules.length} rule${rules.length === 1 ? '' : 's'} still send on ${gateway.kind} and this is the last gateway carrying it. Enable a failover first.`,
      }
    }
  }
  const { error } = await supabase.from('operator_channels').update({ enabled }).eq('id', gateway.id)
  if (error) return { ok: false, reason: friendly(error.message) }
  return { ok: true, note: `${gateway.name} ${enabled ? 'enabled' : 'disabled'}.` }
}

/* --------------------------------------------------------------- helpers -- */

/** The database refuses in its own words on purpose — the trigger messages are
    written to be read. This only strips the Postgres wrapper off the front. */
function friendly(message: string): string {
  const m = message.replace(/^.*?\bERROR:\s*/i, '').trim()
  if (/row-level security/i.test(m)) {
    return 'You are not allowed to change that. Only the marketplace configures notifications.'
  }
  if (/duplicate key/i.test(m)) return 'That already exists.'
  return m
}
