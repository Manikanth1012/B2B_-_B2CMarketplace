/* The only module that reads or writes notification configuration.
   Rules live in notifications.ts so they can be tested without a network.

   Every write here is checked twice on purpose: once in `notifications.ts` so
   the screen can explain the refusal in the recipient's own words, and once by
   a trigger in the database so a refusal cannot be skipped by talking to the
   API directly. */

import { supabase } from './supabase'
import { validatePreference, validateRule, validateTemplate, validateRate, orderKinds } from './notifications'
import type {
  Kind, NotificationEvent, Rule, Template, Preference, LogEntry, Gateway,
  Persona, KindId, Check, Effective, Recipient, Integration, Rate, ChannelTest,
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
  /* Who the preferences and the log lines belong to, by name. Read alongside
     them rather than looked up per row, because a table of forty preferences
     would otherwise be forty round trips to name four people. */
  recipients: Recipient[]
  /* How each gateway is actually reached, what it charges and whether anybody
     has proved it works. Read with the rest, because a channel list without
     them is a list of vendor names. */
  integrations: Integration[]
  rates: Rate[]
  tests: ChannelTest[]
  loadError?: string
}

const EMPTY: NotificationBook = {
  kinds: [], events: [], rules: [], templates: [], preferences: [], log: [], gateways: [],
  recipients: [], integrations: [], rates: [], tests: [],
}

/** Everything the operator configures. One read, because a screen that fetches
    rules without templates will happily show a rule that can say nothing. */
export async function loadConfiguration(): Promise<NotificationBook> {
  const [k, e, r, t, p, l, g, d, ci, cr, ct] = await Promise.all([
    supabase.from('notification_kinds').select('*').order('sort_order'),
    supabase.from('notification_events').select('*').order('sort_order'),
    supabase.from('notification_rules').select('*').order('sort_order'),
    supabase.from('notification_templates').select('*').order('id'),
    supabase.from('notification_preferences').select('*').order('id'),
    supabase.from('notification_log').select('*').order('sent_at', { ascending: false }),
    /* `has_receipt` and `sender` are not decoration: a channel that claims
       delivery receipts with nowhere to receive them reports delivery of
       messages nobody got, and a sender that is not registered is the commonest
       reason SMS silently stops. Leaving them out of this select made the
       screen say "none claimed" against every gateway, including the ones that
       do claim, and hid one of the two broken gateways from the warning. */
    supabase.from('operator_channels')
      .select('id,name,kind,enabled,transport,has_receipt,sender').order('sort_order'),
    supabase.from('notification_recipient').select('*'),
    /* Named columns, not `*`. The credential hash is not among the grants
       `authenticated` holds on this table and asking for it would fail the
       whole read. It is also not something a screen has any use for. */
    supabase.from('channel_integration').select(
      'channel_id,endpoint,port,auth_mode,auth_user,secret_hint,secret_set_on,'
      + 'sender_registry,sender_ref,sender_ok,dlr_url,timeout_ms,retry_attempts,'
      + 'retry_backoff,retry_after_ms,failover_id,status,last_test_at,last_test_ms,'
      + 'last_test_note,note'),
    supabase.from('channel_rate').select('*').order('channel_id').order('destination'),
    /* Enough history to show a channel flapping, not the whole audit trail. */
    supabase.from('channel_test').select('*').order('ran_at', { ascending: false }).limit(120),
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
    recipients: grab<Recipient>(d, 'the recipient directory'),
    integrations: grab<Integration>(ci, 'gateway integrations'),
    rates: grab<Rate>(cr, 'rate cards'),
    tests: grab<ChannelTest>(ct, 'connection tests'),
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

/* --------------------------------------- the integration behind a gateway -- */

/** Address, credential mode, sender registration, receipt callback, retry
    policy and failover. Everything except the credential itself — that goes
    through `setGatewaySecret`, which is the only path that touches it. */
export async function saveIntegration(ci: Integration): Promise<Result> {
  const { channel_id, ...rest } = ci
  /* `secret_hint` and the test results are written by the database, and sending
     them back would let a form overwrite the record of what happened. */
  const payload = {
    endpoint: rest.endpoint?.trim() || null,
    port: rest.port,
    auth_mode: rest.auth_mode,
    auth_user: rest.auth_user?.trim() || null,
    sender_registry: rest.sender_registry?.trim() || null,
    sender_ref: rest.sender_ref?.trim() || null,
    sender_ok: rest.sender_ok,
    dlr_url: rest.dlr_url?.trim() || null,
    timeout_ms: rest.timeout_ms,
    retry_attempts: rest.retry_attempts,
    retry_backoff: rest.retry_backoff,
    retry_after_ms: rest.retry_after_ms,
    failover_id: rest.failover_id || null,
    note: rest.note?.trim() || null,
  }
  const { error } = await supabase.from('channel_integration')
    .upsert({ channel_id, ...payload }, { onConflict: 'channel_id' })
  if (error) return { ok: false, reason: friendly(error.message) }
  return { ok: true, note: 'Saved. Run the check to prove it works.' }
}

/** The credential goes in and does not come back. The database keeps a hash so
    a check can prove one was set and the last four so somebody can tell which
    key is loaded; there is no reveal because there is nothing to reveal. */
export async function setGatewaySecret(channelId: string, secret: string): Promise<Result> {
  const { data, error } = await supabase.rpc('set_channel_secret', {
    p_channel: channelId, p_secret: secret,
  })
  if (error) return { ok: false, reason: friendly(error.message) }
  const r = data as { ok: boolean; why?: string; hint?: string }
  if (!r.ok) return { ok: false, reason: r.why ?? 'That credential was refused.' }
  return { ok: true, note: `Credential set, ending ${r.hint}. It is stored hashed and cannot be read back.` }
}

/** Checks every part of the record that would make a real send fail and names
    the ones that would. It does not open a socket — it refuses to call a
    half-configured channel healthy, which is what the screen used to do. */
export async function testGateway(channelId: string, by: string): Promise<
  Result & { checks?: string[]; ms?: number | null }
> {
  const { data, error } = await supabase.rpc('test_channel', { p_channel: channelId, p_by: by })
  if (error) return { ok: false, reason: friendly(error.message) }
  const r = data as { ok: boolean; detail: string; checks?: string[]; ms?: number | null }
  return r.ok
    ? { ok: true, note: r.detail, checks: r.checks, ms: r.ms }
    : { ok: false, reason: r.detail, checks: r.checks }
}

/* ------------------------------------------------------------ rate cards -- */

/** A new rate for a destination that already has one is a price change, not a
    second price. The old one is closed off the day before the new one starts so
    last month's bill still reconciles against last month's rate. */
export async function saveRate(rate: Rate, replacing: Rate | null): Promise<Result> {
  const check = validateRate(rate)
  if (!check.ok) return check

  if (replacing) {
    const from = new Date(rate.effective_from)
    const to = new Date(from.getTime() - 86400000).toISOString().slice(0, 10)
    if (to <= replacing.effective_from) {
      return {
        ok: false,
        reason: `The rate it replaces started on ${replacing.effective_from}, so a new one cannot start on ${rate.effective_from} — it would close the old one before it opened.`,
      }
    }
    const { error } = await supabase.from('channel_rate')
      .update({ effective_to: to }).eq('id', replacing.id)
    if (error) return { ok: false, reason: friendly(error.message) }
  }

  const { error } = await supabase.from('channel_rate').insert({
    id: rate.id || `RATE-${Date.now().toString(36).toUpperCase()}`,
    channel_id: rate.channel_id,
    destination: rate.destination.trim(),
    currency: rate.currency,
    unit_rate: rate.unit_rate,
    segment_chars: rate.segment_chars,
    multipart_chars: rate.multipart_chars,
    min_charge: rate.min_charge,
    effective_from: rate.effective_from,
    note: rate.note?.trim() || null,
  })
  if (error) return { ok: false, reason: friendly(error.message) }
  return {
    ok: true,
    note: replacing
      ? `New rate from ${rate.effective_from}. The old one is closed, not deleted.`
      : 'Rate added.',
  }
}

/** Ending a rate rather than deleting it. A deleted rate makes every message
    priced against it unexplainable. */
export async function endRate(rate: Rate, on: string): Promise<Result> {
  if (on <= rate.effective_from) {
    return { ok: false, reason: `That rate started on ${rate.effective_from} and cannot end before it began.` }
  }
  const { error } = await supabase.from('channel_rate').update({ effective_to: on }).eq('id', rate.id)
  if (error) return { ok: false, reason: friendly(error.message) }
  return { ok: true, note: `Closed on ${on}. Messages priced against it keep their figure.` }
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
