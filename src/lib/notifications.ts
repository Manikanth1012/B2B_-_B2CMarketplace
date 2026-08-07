/* Notifications — what the platform says, to whom, where, and what it said.
   No React and no Supabase, so the rules can be tested without a network.

   The split that matters: a RULE is the operator's decision (this event, this
   persona, these channels, this often) and a PREFERENCE is the recipient's
   (of the channels the rule offers, which ones I want). A recipient can never
   widen a rule — there is no template for a channel the rule does not carry —
   and can never silence a mandatory one, only move it. Everything below is
   built so a screen cannot offer a choice the database will then refuse. */

import { round2 } from './money'

export type KindId = 'inapp' | 'email' | 'push' | 'sms' | 'whatsapp'
export type Persona = 'operator' | 'partner' | 'enterprise' | 'consumer'
export type Severity = 'high' | 'normal' | 'low'
export type LogState = 'queued' | 'sent' | 'delivered' | 'failed' | 'suppressed'

export interface Kind {
  id: KindId
  label: string
  max_chars: number | null
  needs: 'email' | 'phone' | 'device' | 'none'
  note: string
  sort_order: number
}

export interface NotificationEvent {
  id: string
  label: string
  description: string
  personas: Persona[]
  category: string
  sort_order: number
}

export interface Rule {
  id: string
  persona: Persona
  event_id: string
  name: string
  audience: string
  kinds: KindId[]
  throttle: string
  severity: Severity
  enabled: boolean
  mandatory: boolean
  why: string
  last_sent: string | null
  sort_order: number
}

export interface Template {
  id: string
  rule_id: string
  kind_id: KindId
  subject: string
  body: string
  edited_by: string | null
  edited_on: string | null
}

export interface Preference {
  id: string
  rule_id: string
  scope: 'user' | 'partner'
  user_id: string | null
  partner_id: string | null
  enabled: boolean
  kinds: KindId[]
  updated_on: string | null
}

export interface LogEntry {
  id: string
  rule_id: string | null
  kind_id: KindId
  channel_id: string | null
  persona: Persona
  recipient: string
  user_id: string | null
  partner_id: string | null
  subject: string
  body: string
  sent_at: string
  state: LogState
  detail: string | null
  /* Priced by the database from the rate card, never by whoever wrote the row.
     `cost_currency` is null only where nothing carried the message — in-app —
     and a cost without a currency is a number nobody can add up. */
  cost: number
  cost_currency: string | null
  /* Where it went, and how many segments the carrier billed. A 300-character
     SMS is three of them, which is why a channel's bill cannot be read off a
     message count. */
  destination: string | null
  segments: number | null
  ref: string | null
}

/** Who a preference or a log line belongs to, by name, from the
    `notification_recipient` view. A preference keyed on a partner belongs to
    the whole seller account; one keyed on a user belongs to a person. */
export interface Recipient {
  scope: 'user' | 'partner'
  key: string
  name: string
  persona: Persona
  ref: string | null
  detail: string | null
}

/** A gateway from `operator_channels`, only the parts notifications care about. */
export interface Gateway {
  id: string
  name: string
  kind: KindId | null
  enabled: boolean
  transport?: string | null
  has_receipt?: boolean
  sender?: string | null
}

/* ---- The integration behind the name --------------------------------------
 *
 * A channel used to say "Route Mobile, SMPP 3.4" and hold nothing else. That is
 * a label on a box with no wiring in it: no host, no bind credential, no sender
 * registration, no receipt callback, no retry policy, no failover target. The
 * screen's own note promised "failover is automatic after a defined number of
 * attempts" while nothing anywhere defined a number or a target.
 */

export type AuthMode = 'none' | 'basic' | 'api_key' | 'oauth2' | 'smpp_bind' | 'mtls'
export type IntegrationStatus = 'not_configured' | 'configured' | 'verified' | 'failing'

export interface Integration {
  channel_id: string
  endpoint: string | null
  port: number | null
  auth_mode: AuthMode
  auth_user: string | null
  /* The last four characters of the credential and the day it was set. The
     credential itself is not here and is not fetchable — the database keeps a
     hash so a test can prove one was set, and nothing that can be shown. */
  secret_hint: string | null
  secret_set_on: string | null
  sender_registry: string | null
  sender_ref: string | null
  sender_ok: boolean
  dlr_url: string | null
  timeout_ms: number
  retry_attempts: number
  retry_backoff: 'none' | 'fixed' | 'exponential'
  retry_after_ms: number
  failover_id: string | null
  status: IntegrationStatus
  last_test_at: string | null
  last_test_ms: number | null
  last_test_note: string | null
  note: string | null
}

export interface Rate {
  id: string
  channel_id: string
  /* A market code, or 'default' for everywhere the carrier has not quoted
     separately. */
  destination: string
  currency: string
  unit_rate: number
  segment_chars: number | null
  multipart_chars: number | null
  min_charge: number
  effective_from: string
  effective_to: string | null
  note: string | null
}

export interface ChannelTest {
  id: string
  channel_id: string
  ran_at: string
  ran_by: string
  ok: boolean
  ms: number | null
  detail: string
  checks: string[]
}

export type Check = { ok: true; note?: string } | { ok: false; reason: string }

export const KIND_ORDER: KindId[] = ['inapp', 'email', 'push', 'sms', 'whatsapp']

export const PERSONA_LABEL: Record<Persona, string> = {
  operator: 'Marketplace',
  partner: 'Sellers',
  enterprise: 'Enterprise buyers',
  consumer: 'Customers',
}

/* ------------------------------------------------------------ preferences -- */

/** What a recipient is actually signed up for: the rule as the operator wrote
    it, narrowed by whatever the recipient chose. A rule with no preference row
    is on at its own defaults — an account that has never opened the screen
    still gets told when a payment fails. */
export interface Effective {
  rule: Rule
  pref: Preference | null
  enabled: boolean
  kinds: KindId[]
  /* True when the recipient has moved away from what the operator set. Worth
     showing, because "I turned that off" is the first answer to "why did I not
     get it". */
  customised: boolean
}

/* ---- Naming a recipient ---------------------------------------------------
 *
 * "Who chose what" listed `e5b3c7a1…`, which answers nothing. The screen is
 * there so support can settle "why was I not told?", and that conversation is
 * about Otieno Odhiambo, not about a foreign key.
 */

/** A preference belongs to a seller account or to a person, never to both. */
export function ownerKey(p: Pick<Preference, 'partner_id' | 'user_id'>): string | null {
  return p.partner_id ?? p.user_id ?? null
}

export interface NamedRecipient {
  name: string
  ref: string | null
  detail: string | null
  persona: Persona | null
  /* False where the directory has no row. The label still has to read as a
     sentence rather than as a truncated id, because an unresolvable owner is
     itself a finding worth showing. */
  known: boolean
}

const UNKNOWN: NamedRecipient = {
  name: 'Not in the directory', ref: null, detail: null, persona: null, known: false,
}

export function nameRecipient(
  key: string | null, directory: readonly Recipient[],
): NamedRecipient {
  if (!key) return { ...UNKNOWN, name: 'Nobody in particular' }
  const r = directory.find(d => d.key === key)
  if (!r) {
    /* Say what could not be resolved, but shortened — a full UUID in a table
       cell pushes every other column off the screen. */
    return { ...UNKNOWN, ref: key.length > 12 ? `${key.slice(0, 8)}…` : key }
  }
  return { name: r.name, ref: r.ref, detail: r.detail, persona: r.persona, known: true }
}

/** One line for a table cell: the name, and the reference that tells two people
    of the same name apart. */
export function recipientLine(n: NamedRecipient): string {
  return n.ref && n.ref !== n.name ? `${n.name} · ${n.ref}` : n.name
}

/** A seller preference covers everybody at that seller; a user preference
    covers one person. Support needs to know which before it explains why a
    colleague did get the message. */
export function scopeLine(scope: Preference['scope']): string {
  return scope === 'partner' ? 'the whole seller account' : 'one person'
}

export function effective(rule: Rule, pref: Preference | null): Effective {
  const enabled = pref ? pref.enabled : rule.enabled
  const kinds = orderKinds(pref ? pref.kinds : rule.kinds)
  return {
    rule,
    pref,
    enabled,
    kinds,
    customised: !!pref && (pref.enabled !== rule.enabled || !sameKinds(pref.kinds, rule.kinds)),
  }
}

export function orderKinds(kinds: KindId[]): KindId[] {
  return [...kinds].sort((a, b) => KIND_ORDER.indexOf(a) - KIND_ORDER.indexOf(b))
}

function sameKinds(a: KindId[], b: KindId[]): boolean {
  if (a.length !== b.length) return false
  const s = orderKinds(a).join(',')
  return s === orderKinds(b).join(',')
}

/** Everything one recipient can see, in the operator's order. A rule the
    operator has switched off entirely is not the recipient's business — it
    would be a promise the platform is not keeping. */
export function myRules(rules: Rule[], persona: Persona, prefs: Preference[]): Effective[] {
  return rules
    .filter((r) => r.persona === persona && r.enabled)
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((r) => effective(r, prefs.find((p) => p.rule_id === r.id) ?? null))
}

/** Refuse before the database does, so the screen can say why in the recipient's
    own terms rather than showing a Postgres exception. */
export function validatePreference(rule: Rule, enabled: boolean, kinds: KindId[]): Check {
  if (rule.mandatory && !enabled) {
    return { ok: false, reason: `${rule.name} cannot be switched off. Choose where it reaches you instead.` }
  }
  const stray = kinds.filter((k) => !rule.kinds.includes(k))
  if (stray.length) {
    return { ok: false, reason: `${rule.name} is not written for ${stray.join(' or ')} — there is nothing to send.` }
  }
  if (enabled && kinds.length === 0) {
    return { ok: false, reason: `${rule.name} is on but has nowhere to go. Pick a channel${rule.mandatory ? '' : ' or switch it off'}.` }
  }
  return { ok: true }
}

/** Turning a channel on or off, worked out rather than assumed — the caller
    should never have to reason about what the last remaining channel means. */
export function toggleKind(rule: Rule, current: Effective, kind: KindId): Check & { kinds?: KindId[] } {
  const has = current.kinds.includes(kind)
  const next = has ? current.kinds.filter((k) => k !== kind) : orderKinds([...current.kinds, kind])
  const check = validatePreference(rule, current.enabled, next)
  if (!check.ok) return check
  return { ok: true, kinds: next, note: has ? `No longer by ${kind}` : `Now also by ${kind}` }
}

/** What a recipient cannot be sent, whatever they picked, because the platform
    does not hold the thing the channel needs. Silence with a reason beats
    silence. */
export function reachability(
  kinds: Kind[],
  held: { email?: boolean; phone?: boolean; device?: boolean },
): Record<string, string | null> {
  const out: Record<string, string | null> = {}
  for (const k of kinds) {
    out[k.id] =
      k.needs === 'email' && !held.email ? 'No verified email address on file'
        : k.needs === 'phone' && !held.phone ? 'No verified mobile number on file'
          : k.needs === 'device' && !held.device ? 'No device has accepted push here yet'
            : null
  }
  return out
}

/** The one-line summary above a preference screen. Counting what is on is less
    useful than counting what a person can still change. */
export function summarisePrefs(list: Effective[]): {
  total: number; on: number; off: number; locked: number; customised: number
  byKind: { kind: KindId; count: number }[]
} {
  const on = list.filter((e) => e.enabled)
  const byKind = KIND_ORDER
    .map((kind) => ({ kind, count: on.filter((e) => e.kinds.includes(kind)).length }))
    .filter((x) => x.count > 0)
  return {
    total: list.length,
    on: on.length,
    off: list.length - on.length,
    locked: list.filter((e) => e.rule.mandatory).length,
    customised: list.filter((e) => e.customised).length,
    byKind,
  }
}

/** Grouped the way people think about them, in the event catalogue's order. */
export function byCategory(
  list: Effective[], events: NotificationEvent[],
): { category: string; items: Effective[] }[] {
  const order = new Map(events.map((e) => [e.id, e]))
  const groups = new Map<string, Effective[]>()
  for (const e of list) {
    const cat = order.get(e.rule.event_id)?.category ?? 'Other'
    const arr = groups.get(cat)
    if (arr) arr.push(e); else groups.set(cat, [e])
  }
  const rank = (cat: string) =>
    Math.min(...events.filter((e) => e.category === cat).map((e) => e.sort_order), 999)
  return [...groups.entries()]
    .map(([category, items]) => ({ category, items }))
    .sort((a, b) => rank(a.category) - rank(b.category))
}

/* ----------------------------------------------------------------- rules --- */

/** The events an operator can still write a rule for on a given persona.
    Offering the rest would be offering a rule that the database refuses. */
export function availableEvents(events: NotificationEvent[], rules: Rule[], persona: Persona): NotificationEvent[] {
  const taken = new Set(rules.filter((r) => r.persona === persona).map((r) => r.event_id))
  return events
    .filter((e) => e.personas.includes(persona) && !taken.has(e.id))
    .sort((a, b) => a.sort_order - b.sort_order)
}

export function validateRule(
  rule: Partial<Rule>, events: NotificationEvent[], gateways: Gateway[],
): Check {
  if (!rule.name?.trim()) return { ok: false, reason: 'Give the rule a name people will recognise on a preference screen' }
  if (!rule.event_id) return { ok: false, reason: 'Pick the event this fires on' }
  if (!rule.persona) return { ok: false, reason: 'Pick who hears it' }
  const ev = events.find((e) => e.id === rule.event_id)
  if (!ev) return { ok: false, reason: `No such event: ${rule.event_id}` }
  if (!ev.personas.includes(rule.persona)) {
    return { ok: false, reason: `“${ev.label}” never happens to ${PERSONA_LABEL[rule.persona].toLowerCase()}` }
  }
  const kinds = rule.kinds ?? []
  if (!kinds.length) return { ok: false, reason: 'A rule that reaches nobody is a rule that does nothing — pick at least one channel' }
  const dead = kinds.filter((k) => k !== 'inapp' && !gateways.some((g) => g.kind === k && g.enabled))
  if (dead.length) {
    return { ok: false, reason: `There is no gateway behind ${dead.join(' or ')}. Enable one on Channels first.` }
  }
  if (rule.mandatory && !rule.enabled) {
    return { ok: false, reason: 'A rule nobody may switch off cannot itself be switched off' }
  }
  if (!rule.why?.trim()) {
    return { ok: false, reason: 'Say why this is worth interrupting somebody for — the next person to read this list will need it' }
  }
  return { ok: true }
}

/** What changing a rule does to the people already on it. The operator should
    know before they save that narrowing a rule silently drops somebody's
    chosen channel. */
export function ruleChangeImpact(
  rule: Rule, next: Partial<Rule>, prefs: Preference[],
): string[] {
  const out: string[] = []
  const mine = prefs.filter((p) => p.rule_id === rule.id)
  const nextKinds = next.kinds ?? rule.kinds
  const removed = rule.kinds.filter((k) => !nextKinds.includes(k))
  for (const k of removed) {
    const n = mine.filter((p) => p.kinds.includes(k)).length
    if (n) out.push(`${n} recipient${n === 1 ? '' : 's'} chose ${k} and will lose it`)
  }
  const added = nextKinds.filter((k) => !rule.kinds.includes(k))
  if (added.length) {
    out.push(`${added.join(' and ')} needs a template written before anything goes out on it`)
  }
  if (next.mandatory === true && !rule.mandatory) {
    const off = mine.filter((p) => !p.enabled).length
    if (off) out.push(`${off} recipient${off === 1 ? ' has' : 's have'} this switched off and will be switched back on`)
  }
  if (next.enabled === false && rule.enabled) {
    out.push(`${mine.length || 'All'} recipient preference${mine.length === 1 ? '' : 's'} stay saved, but nothing will be sent while it is off`)
  }
  return out
}

/** A rule cannot be trusted to fire unless something is written for every
    channel it claims. This is the list an operator has to clear. */
export function missingTemplates(rules: Rule[], templates: Template[]): { rule: Rule; kind: KindId }[] {
  const out: { rule: Rule; kind: KindId }[] = []
  for (const r of rules) {
    for (const k of r.kinds) {
      if (!templates.some((t) => t.rule_id === r.id && t.kind_id === k)) out.push({ rule: r, kind: k })
    }
  }
  return out
}

/* ------------------------------------------------------------- templates -- */

export const PLACEHOLDERS = [
  'recipient', 'order', 'listing', 'partner', 'buyer', 'amount', 'due',
  'reason', 'link', 'marketplace',
] as const

export function placeholdersIn(text: string): string[] {
  const found = text.match(/\{([a-z_]+)\}/g) ?? []
  return [...new Set(found.map((f) => f.slice(1, -1)))]
}

export function validateTemplate(t: { subject: string; body: string; kind_id: KindId }, kinds: Kind[]): Check {
  if (!t.subject.trim()) return { ok: false, reason: 'A message with no subject is one nobody opens' }
  if (!t.body.trim()) return { ok: false, reason: 'Write what it says' }
  const kind = kinds.find((k) => k.id === t.kind_id)
  if (!kind) return { ok: false, reason: `No such channel: ${t.kind_id}` }
  if (kind.max_chars !== null && t.body.length > kind.max_chars) {
    return {
      ok: false,
      reason: `${kind.label} cuts off at ${kind.max_chars} characters and this is ${t.body.length}. It would arrive half-written.`,
    }
  }
  const unknown = placeholdersIn(t.subject + ' ' + t.body).filter((p) => !PLACEHOLDERS.includes(p as never))
  if (unknown.length) {
    return { ok: false, reason: `Nothing fills in ${unknown.map((u) => `{${u}}`).join(', ')} — it would be sent as written` }
  }
  return { ok: true }
}

/** Headroom left on a short-form channel, for the counter beside the box. */
export function remaining(body: string, kind: Kind | undefined): number | null {
  if (!kind || kind.max_chars === null) return null
  return kind.max_chars - body.length
}

/** A template with its placeholders filled in, so the operator sees the message
    rather than the skeleton. Anything the sample does not cover is left as
    written — quietly blanking it would hide a template that says nothing. */
export function preview(text: string, sample: Record<string, string>): string {
  return text.replace(/\{([a-z_]+)\}/g, (whole, key: string) => sample[key] ?? whole)
}

export const SAMPLE: Record<string, string> = {
  recipient: 'Rajesh',
  order: 'ORD-881489',
  listing: 'Nimbus Cold-chain sensor',
  partner: 'Nimbus Sensors',
  buyer: 'Brightline Foods',
  amount: '$142.00',
  due: '01 Aug 2026',
  reason: 'Two units short on a delivery of eight',
  link: 'https://aventa.example/o/881489',
  marketplace: 'Aventa',
}

/* ------------------------------------------------------------------- log -- */

export const STATE_LABEL: Record<LogState, string> = {
  queued: 'Queued',
  sent: 'Sent',
  delivered: 'Delivered',
  failed: 'Failed',
  suppressed: 'Not sent',
}

export function logTime(entry: LogEntry): number {
  const t = Date.parse(entry.sent_at)
  return Number.isNaN(t) ? 0 : t
}

export function newestFirst(log: LogEntry[]): LogEntry[] {
  return [...log].sort((a, b) => logTime(b) - logTime(a))
}

export interface LogFilter {
  persona?: Persona | 'all'
  kind?: KindId | 'all'
  state?: LogState | 'all'
  search?: string
}

export function filterLog(log: LogEntry[], f: LogFilter): LogEntry[] {
  const q = (f.search ?? '').trim().toLowerCase()
  return newestFirst(log).filter((e) => {
    if (f.persona && f.persona !== 'all' && e.persona !== f.persona) return false
    if (f.kind && f.kind !== 'all' && e.kind_id !== f.kind) return false
    if (f.state && f.state !== 'all' && e.state !== f.state) return false
    if (q && ![e.subject, e.body, e.recipient, e.ref ?? '', e.rule_id ?? ''].some((s) => s.toLowerCase().includes(q))) return false
    return true
  })
}

/** The three numbers worth a tile: how many got through, how many did not, and
    what the month cost. A delivery rate that counts suppressed messages as
    failures would read as a broken platform rather than a working preference. */
export function deliverySummary(log: LogEntry[]): {
  total: number; delivered: number; failed: number; suppressed: number
  attempted: number; rate: number | null; spend: Spend[]
} {
  const delivered = log.filter((e) => e.state === 'delivered' || e.state === 'sent').length
  const failed = log.filter((e) => e.state === 'failed').length
  const suppressed = log.filter((e) => e.state === 'suppressed').length
  const attempted = delivered + failed
  return {
    total: log.length,
    delivered,
    failed,
    suppressed,
    attempted,
    rate: attempted ? round2((delivered / attempted) * 100) : null,
    spend: spendByCurrency(log),
  }
}

/* ---- What the messages cost -----------------------------------------------
 *
 * This used to be one number and one dollar sign. Route Mobile bills Kenyan
 * termination in shillings and Indian termination in rupees; SES bills in
 * dollars. Adding those three together produces a figure that is not money in
 * any currency, and printing it with a `$` in front makes the claim worse
 * rather than better. So spend is per currency, always, and a caller that wants
 * one total has to say what it converted and at which rate.
 */

export interface Spend {
  currency: string
  amount: number
  messages: number
  /* Carriers bill per segment. A count of messages is not a count of what was
     paid for. */
  segments: number
}

export function spendByCurrency(log: readonly LogEntry[]): Spend[] {
  const m = new Map<string, Spend>()
  for (const e of log) {
    /* A row with no currency cost nothing to carry — in-app. Counting it as a
       zero in some arbitrary currency would invent a currency. */
    if (!e.cost_currency) continue
    const s = m.get(e.cost_currency) ?? { currency: e.cost_currency, amount: 0, messages: 0, segments: 0 }
    s.amount += Number(e.cost || 0)
    s.messages += 1
    s.segments += Number(e.segments || 1)
    m.set(e.cost_currency, s)
  }
  return [...m.values()]
    .map((s) => ({ ...s, amount: round4(s.amount) }))
    .sort((a, b) => b.amount - a.amount || a.currency.localeCompare(b.currency))
}

/** "INR 0.90 and KES 2.40" — the sentence a tile can hold without pretending
    the two add up. */
export function spendLine(spend: readonly Spend[], money: (n: number, c: string) => string): string {
  if (spend.length === 0) return 'Nothing — every message so far went out on a channel that charges nothing'
  return spend.map((s) => money(s.amount, s.currency)).join(' · ')
}

/** Per channel, because "delivery is at 92%" is never actionable and "SMS is at
    60% and everything else is fine" always is. */
export function byKind(log: LogEntry[], kinds: Kind[]): {
  kind: KindId; label: string; sent: number; failed: number; suppressed: number
  rate: number | null; spend: Spend[]
}[] {
  return kinds
    .slice()
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((k) => {
      const mine = log.filter((e) => e.kind_id === k.id)
      const s = deliverySummary(mine)
      return {
        kind: k.id, label: k.label, sent: s.delivered, failed: s.failed,
        suppressed: s.suppressed, rate: s.rate, spend: s.spend,
      }
    })
    .filter((r) => r.sent + r.failed + r.suppressed > 0)
}

/** Everything that did not reach somebody, with the reason attached. This is
    the screen support opens when a customer says they were never told. */
export function notDelivered(log: LogEntry[]): LogEntry[] {
  return newestFirst(log.filter((e) => e.state === 'failed' || e.state === 'suppressed'))
}

/** A rule that has never sent anything is either wrongly configured or aimed at
    something that does not happen. Either way somebody should look at it. */
export function silentRules(rules: Rule[], log: LogEntry[]): Rule[] {
  const fired = new Set(log.map((e) => e.rule_id).filter(Boolean) as string[])
  return rules.filter((r) => r.enabled && !fired.has(r.id)).sort((a, b) => a.sort_order - b.sort_order)
}

/** What the operator is spending to talk to people, by gateway. Push and in-app
    are free, which is exactly why the expensive channels deserve a number. */
export function costByGateway(log: LogEntry[], gateways: Gateway[]): {
  id: string; name: string; kind: KindId | null; messages: number
  segments: number; spend: Spend[]
}[] {
  return gateways
    .map((g) => {
      const mine = log.filter((e) => e.channel_id === g.id)
      return {
        id: g.id, name: g.name, kind: g.kind, messages: mine.length,
        segments: mine.reduce((s, e) => s + Number(e.segments || 1), 0),
        spend: spendByCurrency(mine),
      }
    })
    .filter((r) => r.messages > 0)
    /* Most-used first. Sorting by cost would rank a rupee above a dollar. */
    .sort((a, b) => b.messages - a.messages || a.name.localeCompare(b.name))
}

/* ---- Reading an integration ------------------------------------------------
 *
 * Four states, and the distance between the middle two is the whole point.
 * `configured` says every field a send needs is filled in. `verified` says
 * somebody ran the check and it passed. A console that only has "enabled" makes
 * the second claim with the evidence for neither.
 */

export const INTEGRATION_LABEL: Record<IntegrationStatus, string> = {
  not_configured: 'Nothing configured',
  configured: 'Configured, never tested',
  verified: 'Tested and ready',
  failing: 'Last test failed',
}

/** Everything about this channel that would make a real send fail. The same
    list the database check produces, computed here so the screen can show it
    before anybody presses Test — a form that only tells you what is missing
    after you submit it is a form that wastes a round trip. */
export function configGaps(gw: Gateway, ci: Integration | null, rates: readonly Rate[]): string[] {
  const gaps: string[] = []
  if (!ci) return ['Nothing is configured for this channel']
  if (!ci.endpoint?.trim()) gaps.push('No endpoint to connect to')
  if (ci.auth_mode !== 'none' && !ci.secret_hint) {
    gaps.push(`Auth is ${ci.auth_mode} and no credential has been set`)
  }
  /* Claiming receipts with nowhere to receive them is how a channel reports
     delivery of messages nobody got. */
  if (gw.has_receipt && !ci.dlr_url?.trim()) {
    gaps.push('This channel claims delivery receipts and has no callback URL')
  }
  if (ci.sender_registry && !ci.sender_ok) {
    gaps.push(`Sender ${gw.sender ?? '?'} is not registered with ${ci.sender_registry}`)
  }
  if (!rates.some(r => r.channel_id === gw.id && !r.effective_to)) {
    gaps.push('No rate on file, so every message would be costed at nothing')
  }
  return gaps
}

/** A channel that is switched on and cannot send is the state worth shouting
    about — it is live, and every message routed to it is lost. */
export function liveButBroken(
  gateways: readonly Gateway[], integrations: readonly Integration[], rates: readonly Rate[],
): { gateway: Gateway; gaps: string[] }[] {
  return gateways
    .filter(g => g.enabled)
    .map(g => ({
      gateway: g,
      gaps: configGaps(g, integrations.find(i => i.channel_id === g.id) ?? null, rates),
    }))
    .filter(r => r.gaps.length > 0)
}

/** Where a message goes after this channel has been tried and refused. Follows
    the chain rather than reporting one hop, because two hops is what a desk
    needs to know before it disables anything. */
export function failoverChain(id: string, integrations: readonly Integration[]): string[] {
  const chain: string[] = [id]
  let at = id
  /* The database refuses a two-way loop, but a longer one written across
     several edits would still hang this. */
  for (let i = 0; i < 6; i++) {
    const next = integrations.find(x => x.channel_id === at)?.failover_id
    if (!next || chain.includes(next)) break
    chain.push(next)
    at = next
  }
  return chain
}

/* ---- Reading a rate card --------------------------------------------------- */

/** Segments, not messages. 160 GSM-7 characters in one, 153 once it has to be
    concatenated — so a 300-character SMS is two segments and a 400-character
    one is three. Anything not billed by length is charged once. */
export function segmentsFor(chars: number, seg: number | null, multi: number | null): number {
  if (seg === null) return 1
  if (chars <= 0) return 1
  if (chars <= seg) return 1
  return Math.ceil(chars / (multi ?? seg))
}

/** The live rate for a destination, falling back to the carrier's default
    quote. Null where the channel has never been priced — which is a real state
    and not a zero. */
export function rateFor(
  rates: readonly Rate[], channelId: string, destination: string | null,
): Rate | null {
  const live = rates.filter(r => r.channel_id === channelId && !r.effective_to)
  return live.find(r => r.destination === (destination ?? 'default'))
      ?? live.find(r => r.destination === 'default')
      ?? null
}

export type Quote =
  | { priced: true; rate: Rate; segments: number; amount: number; currency: string; fellBack: boolean }
  | { priced: false; why: string }

export function quote(
  rates: readonly Rate[], channelId: string, destination: string | null, chars: number,
): Quote {
  const r = rateFor(rates, channelId, destination)
  if (!r) return { priced: false, why: 'No rate on file for this channel and destination' }
  const segments = segmentsFor(chars, r.segment_chars, r.multipart_chars)
  return {
    priced: true, rate: r, segments,
    amount: round4(Math.max(r.unit_rate * segments, r.min_charge)),
    currency: r.currency,
    /* Worth saying out loud — a desk quoting a customer off the default rate
       when the carrier has a separate price for that market will be wrong. */
    fellBack: r.destination === 'default' && (destination ?? 'default') !== 'default',
  }
}

/** Which markets a channel has actually been quoted for. A default rate covers
    everywhere, but covering and being quoted are different things and a desk
    negotiating a contract wants to see the gap. */
export function rateCoverage(
  rates: readonly Rate[], channelId: string, markets: readonly string[],
): { destination: string; rate: Rate | null; onDefault: boolean }[] {
  return markets.map(m => {
    const own = rates.find(r => r.channel_id === channelId && !r.effective_to && r.destination === m)
    const fallback = rates.find(r => r.channel_id === channelId && !r.effective_to && r.destination === 'default')
    return { destination: m, rate: own ?? fallback ?? null, onDefault: !own && !!fallback }
  })
}

/** A rate is being replaced, not edited. Ending the old one and starting a new
    one keeps last month's bill reconcilable against last month's rate. */
export function validateRate(r: Partial<Rate>): Check {
  if (!r.destination?.trim()) return { ok: false, reason: 'A rate has to say what it covers' }
  if (!r.currency?.trim()) return { ok: false, reason: 'A rate with no currency is a number' }
  if (r.unit_rate == null || Number.isNaN(r.unit_rate) || r.unit_rate < 0) {
    return { ok: false, reason: 'A rate cannot be negative' }
  }
  if (r.segment_chars != null && r.segment_chars <= 0) {
    return { ok: false, reason: 'A segment of zero characters would divide by nothing' }
  }
  if (r.multipart_chars != null && r.segment_chars != null && r.multipart_chars > r.segment_chars) {
    return {
      ok: false,
      reason: 'A concatenated segment carries fewer characters than a single one, not more — the header takes the difference.',
    }
  }
  if (r.unit_rate === 0) {
    return { ok: true, note: 'Zero is a rate — this channel will report as costing nothing, which is right for push and wrong for anything else.' }
  }
  return { ok: true }
}

/** Why a given message was not sent, in the recipient's terms. The log already
    carries the reason; this is the fallback for a row that does not. */
export function explain(entry: LogEntry): string {
  if (entry.detail) return entry.detail
  if (entry.state === 'delivered') return 'Delivered'
  if (entry.state === 'sent') return 'Handed to the gateway; no delivery receipt on this channel'
  if (entry.state === 'queued') return 'Waiting to go out'
  return 'No reason was recorded, which is itself worth reporting'
}

/* --------------------------------------------------------------- helpers -- */

export { round2 }
export function round4(n: number): number { return Math.round(n * 10000) / 10000 }

/* Carrier money, which is not consumer money. A rate is 0.0001 of a dollar or
   0.18 of a rupee, so two decimal places round most of them to nothing and a
   currency symbol in front of a figure that small reads as a shelf price. The
   code goes in front instead, and it comes from the row rather than from
   whoever wrote the component — the old version printed a dollar sign on a
   number that might have been shillings. */
export function money(n: number, currency: string): string {
  const digits = n !== 0 && Math.abs(n) < 1 ? 4 : 2
  return `${currency} ${n.toFixed(digits)}`
}

/** "31 Jul, 07:12" — enough to line a message up against an order, without a
    timezone argument in the middle of a support call. */
export function when(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString('en-GB', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
  }).replace(',', ',')
}
