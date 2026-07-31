import { describe, it, expect } from 'vitest'
import {
  effective, orderKinds, myRules, validatePreference, toggleKind, reachability,
  summarisePrefs, byCategory, availableEvents, validateRule, ruleChangeImpact,
  missingTemplates, placeholdersIn, validateTemplate, remaining, preview, SAMPLE,
  newestFirst, filterLog, deliverySummary, byKind, notDelivered, silentRules,
  costByGateway, explain, money, when, KIND_ORDER, PERSONA_LABEL, STATE_LABEL,
} from './notifications'
import type { Rule, Preference, Kind, NotificationEvent, Template, LogEntry, Gateway, KindId } from './notifications'

const kinds: Kind[] = [
  { id: 'inapp', label: 'In-app', max_chars: 240, needs: 'none', note: '', sort_order: 1 },
  { id: 'email', label: 'Email', max_chars: null, needs: 'email', note: '', sort_order: 2 },
  { id: 'push', label: 'Push', max_chars: 120, needs: 'device', note: '', sort_order: 3 },
  { id: 'sms', label: 'SMS', max_chars: 160, needs: 'phone', note: '', sort_order: 4 },
  { id: 'whatsapp', label: 'WhatsApp', max_chars: 1024, needs: 'phone', note: '', sort_order: 5 },
]

const events: NotificationEvent[] = [
  { id: 'order.stage', label: 'An order changes stage', description: 'Packed, in transit, delivered.', personas: ['enterprise', 'consumer'], category: 'Orders', sort_order: 2 },
  { id: 'order.failed', label: 'An order fails', description: 'Fulfilment failed.', personas: ['operator', 'partner', 'enterprise', 'consumer'], category: 'Orders', sort_order: 3 },
  { id: 'payment.failed', label: 'A payment fails', description: 'A charge was declined.', personas: ['enterprise', 'consumer'], category: 'Money', sort_order: 34 },
  { id: 'doc.expiring', label: 'A document expires', description: 'Something lapses.', personas: ['partner'], category: 'Compliance', sort_order: 70 },
]

function rule(over: Partial<Rule> = {}): Rule {
  return {
    id: 'NR-C1', persona: 'consumer', event_id: 'order.stage', name: 'Order and delivery updates',
    audience: 'You', kinds: ['push', 'sms'], throttle: 'Every time', severity: 'normal',
    enabled: true, mandatory: false, why: 'People want these.', last_sent: '20 min ago',
    sort_order: 30, ...over,
  }
}

function pref(over: Partial<Preference> = {}): Preference {
  return {
    id: 'NP-NR-C1', rule_id: 'NR-C1', scope: 'user', user_id: 'u1', partner_id: null,
    enabled: true, kinds: ['push'], updated_on: '2026-07-12', ...over,
  }
}

function entry(over: Partial<LogEntry> = {}): LogEntry {
  return {
    id: 'NL-1', rule_id: 'NR-C1', kind_id: 'push', channel_id: 'ch-005', persona: 'consumer',
    recipient: 'Priya Raman', user_id: 'u1', partner_id: null, subject: 'Out for delivery',
    body: 'On its way.', sent_at: '2026-07-31T07:12:00Z', state: 'delivered', detail: null,
    cost: 0, ref: 'ORD-881044', ...over,
  }
}

/* ------------------------------------------------------------ preferences -- */

describe('effective', () => {
  it('falls back to the rule when the recipient has never chosen', () => {
    const e = effective(rule(), null)
    expect(e.enabled).toBe(true)
    expect(e.kinds).toEqual(['push', 'sms'])
    expect(e.customised).toBe(false)
  })

  it('narrows to what the recipient chose', () => {
    const e = effective(rule(), pref())
    expect(e.kinds).toEqual(['push'])
    expect(e.customised).toBe(true)
  })

  it('does not call a preference customised when it matches the rule', () => {
    const e = effective(rule(), pref({ kinds: ['sms', 'push'] }))
    expect(e.customised).toBe(false)
    expect(e.kinds).toEqual(['push', 'sms'])
  })

  it('reads a switched-off preference as off even though the rule is on', () => {
    const e = effective(rule(), pref({ enabled: false, kinds: [] }))
    expect(e.enabled).toBe(false)
    expect(e.customised).toBe(true)
  })
})

describe('orderKinds', () => {
  it('puts channels in one order everywhere so two screens never disagree', () => {
    expect(orderKinds(['sms', 'inapp', 'push'])).toEqual(['inapp', 'push', 'sms'])
  })

  it('does not mutate its argument', () => {
    const k: KindId[] = ['sms', 'inapp']
    orderKinds(k)
    expect(k).toEqual(['sms', 'inapp'])
  })
})

describe('myRules', () => {
  const rules = [
    rule({ id: 'A', sort_order: 2 }),
    rule({ id: 'B', sort_order: 1 }),
    rule({ id: 'C', enabled: false }),
    rule({ id: 'D', persona: 'partner', event_id: 'doc.expiring' }),
  ]

  it('shows only this persona, only what the operator has switched on, in order', () => {
    const out = myRules(rules, 'consumer', [])
    expect(out.map((e) => e.rule.id)).toEqual(['B', 'A'])
  })

  it('attaches each recipient preference to its own rule', () => {
    const out = myRules(rules, 'consumer', [pref({ rule_id: 'A', kinds: ['sms'] })])
    expect(out.find((e) => e.rule.id === 'A')!.kinds).toEqual(['sms'])
    expect(out.find((e) => e.rule.id === 'B')!.pref).toBeNull()
  })
})

describe('validatePreference', () => {
  it('refuses to silence a mandatory rule and says what to do instead', () => {
    const c = validatePreference(rule({ mandatory: true, name: 'A delivery problem' }), false, [])
    expect(c.ok).toBe(false)
    if (!c.ok) expect(c.reason).toMatch(/cannot be switched off/)
  })

  it('refuses a channel the rule does not carry', () => {
    const c = validatePreference(rule(), true, ['push', 'whatsapp'])
    expect(c.ok).toBe(false)
    if (!c.ok) expect(c.reason).toMatch(/whatsapp/)
  })

  it('refuses on-with-nowhere-to-go', () => {
    const c = validatePreference(rule(), true, [])
    expect(c.ok).toBe(false)
    if (!c.ok) expect(c.reason).toMatch(/nowhere to go/)
  })

  it('does not offer "switch it off" as a way out of a mandatory rule', () => {
    const c = validatePreference(rule({ mandatory: true }), true, [])
    expect(c.ok).toBe(false)
    if (!c.ok) expect(c.reason).not.toMatch(/switch it off/)
  })

  it('allows switching an optional rule off with no channels at all', () => {
    expect(validatePreference(rule(), false, []).ok).toBe(true)
  })

  it('allows a narrower subset', () => {
    expect(validatePreference(rule(), true, ['sms']).ok).toBe(true)
  })
})

describe('toggleKind', () => {
  it('adds a channel in the shared order', () => {
    const r = rule()
    const out = toggleKind(r, effective(r, pref({ kinds: ['sms'] })), 'push')
    expect(out.ok).toBe(true)
    expect(out.kinds).toEqual(['push', 'sms'])
  })

  it('removes one while another remains', () => {
    const r = rule()
    const out = toggleKind(r, effective(r, null), 'sms')
    expect(out.kinds).toEqual(['push'])
  })

  it('refuses to remove the last channel of a rule that is still on', () => {
    const r = rule()
    const out = toggleKind(r, effective(r, pref({ kinds: ['push'] })), 'push')
    expect(out.ok).toBe(false)
    expect(out.kinds).toBeUndefined()
  })

  it('refuses to remove the last channel of a mandatory rule', () => {
    const r = rule({ mandatory: true })
    const out = toggleKind(r, effective(r, pref({ kinds: ['push'] })), 'push')
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.reason).toMatch(/nowhere to go/)
  })
})

describe('reachability', () => {
  it('names what is missing rather than just refusing', () => {
    const r = reachability(kinds, { email: true, phone: false, device: false })
    expect(r.email).toBeNull()
    expect(r.inapp).toBeNull()
    expect(r.sms).toMatch(/mobile/)
    expect(r.push).toMatch(/push/)
  })

  it('clears every channel once the platform holds everything', () => {
    const r = reachability(kinds, { email: true, phone: true, device: true })
    expect(Object.values(r).every((v) => v === null)).toBe(true)
  })
})

describe('summarisePrefs', () => {
  const rules = [
    rule({ id: 'A', kinds: ['push', 'sms'] }),
    rule({ id: 'B', mandatory: true, kinds: ['email'] }),
    rule({ id: 'C', kinds: ['email'] }),
  ]
  const list = myRules(rules, 'consumer', [
    pref({ rule_id: 'C', enabled: false, kinds: [] }),
    pref({ rule_id: 'A', kinds: ['push'] }),
  ])

  it('counts what is on, what is off and what cannot be changed', () => {
    const s = summarisePrefs(list)
    expect(s.total).toBe(3)
    expect(s.on).toBe(2)
    expect(s.off).toBe(1)
    expect(s.locked).toBe(1)
    expect(s.customised).toBe(2)
  })

  it('counts channels across what is on only, and drops the unused ones', () => {
    const s = summarisePrefs(list)
    expect(s.byKind).toEqual([{ kind: 'email', count: 1 }, { kind: 'push', count: 1 }])
  })
})

describe('byCategory', () => {
  it('groups by the event catalogue and orders the groups by it', () => {
    const rules = [
      rule({ id: 'A', event_id: 'payment.failed', persona: 'consumer' }),
      rule({ id: 'B', event_id: 'order.stage', persona: 'consumer' }),
    ]
    const out = byCategory(myRules(rules, 'consumer', []), events)
    expect(out.map((g) => g.category)).toEqual(['Orders', 'Money'])
  })

  it('parks a rule whose event is unknown rather than dropping it', () => {
    const out = byCategory(myRules([rule({ event_id: 'nope' })], 'consumer', []), events)
    expect(out.map((g) => g.category)).toEqual(['Other'])
  })
})

/* ----------------------------------------------------------------- rules --- */

describe('availableEvents', () => {
  it('leaves out events that already have a rule on this persona', () => {
    const out = availableEvents(events, [rule({ event_id: 'order.stage' })], 'consumer')
    expect(out.map((e) => e.id)).toEqual(['order.failed', 'payment.failed'])
  })

  it('leaves out events that never happen to this persona', () => {
    const out = availableEvents(events, [], 'partner')
    expect(out.map((e) => e.id)).toEqual(['order.failed', 'doc.expiring'])
  })
})

describe('validateRule', () => {
  const gateways: Gateway[] = [
    { id: 'ch-001', name: 'SMS Primary', kind: 'sms', enabled: true },
    { id: 'ch-003', name: 'Email Primary', kind: 'email', enabled: true },
    { id: 'ch-005', name: 'Push', kind: 'push', enabled: false },
  ]
  const base = { name: 'x', event_id: 'order.failed', persona: 'partner' as const, kinds: ['email'] as KindId[], enabled: true, mandatory: false, why: 'because' }

  it('accepts a rule with a gateway behind every channel', () => {
    expect(validateRule(base, events, gateways).ok).toBe(true)
  })

  it('refuses an event that does not happen to the persona', () => {
    const c = validateRule({ ...base, event_id: 'doc.expiring', persona: 'consumer' }, events, gateways)
    expect(c.ok).toBe(false)
    if (!c.ok) expect(c.reason).toMatch(/never happens/)
  })

  it('refuses a channel whose gateway is switched off', () => {
    const c = validateRule({ ...base, kinds: ['push'] }, events, gateways)
    expect(c.ok).toBe(false)
    if (!c.ok) expect(c.reason).toMatch(/no gateway/)
  })

  it('does not ask for a gateway behind in-app, which has none', () => {
    expect(validateRule({ ...base, kinds: ['inapp'] }, events, gateways).ok).toBe(true)
  })

  it('refuses a rule with no channel at all', () => {
    expect(validateRule({ ...base, kinds: [] }, events, gateways).ok).toBe(false)
  })

  it('refuses mandatory-and-off, which nobody could ever receive', () => {
    const c = validateRule({ ...base, mandatory: true, enabled: false }, events, gateways)
    expect(c.ok).toBe(false)
    if (!c.ok) expect(c.reason).toMatch(/cannot itself be switched off/)
  })

  it('insists on a reason, because the next reader will need one', () => {
    const c = validateRule({ ...base, why: '  ' }, events, gateways)
    expect(c.ok).toBe(false)
    if (!c.ok) expect(c.reason).toMatch(/why/)
  })
})

describe('ruleChangeImpact', () => {
  const r = rule({ id: 'A', kinds: ['push', 'sms'] })
  const prefs = [
    pref({ id: '1', rule_id: 'A', kinds: ['push', 'sms'] }),
    pref({ id: '2', rule_id: 'A', kinds: ['sms'] }),
    pref({ id: '3', rule_id: 'B', kinds: ['sms'] }),
  ]

  it('counts the people whose chosen channel is being taken away', () => {
    const out = ruleChangeImpact(r, { kinds: ['push'] }, prefs)
    expect(out.some((s) => /2 recipients chose sms/.test(s))).toBe(true)
  })

  it('warns that a new channel needs a template before it sends anything', () => {
    const out = ruleChangeImpact(r, { kinds: ['push', 'sms', 'email'] }, prefs)
    expect(out.some((s) => /template/.test(s))).toBe(true)
  })

  it('warns that making a rule mandatory switches people back on', () => {
    const withOff = [...prefs, pref({ id: '4', rule_id: 'A', enabled: false, kinds: [] })]
    const out = ruleChangeImpact(r, { mandatory: true }, withOff)
    expect(out.some((s) => /switched back on/.test(s))).toBe(true)
  })

  it('says nothing when nothing changes', () => {
    expect(ruleChangeImpact(r, { kinds: ['push', 'sms'] }, prefs)).toEqual([])
  })
})

describe('missingTemplates', () => {
  it('finds the channel a rule claims but cannot say anything on', () => {
    const templates: Template[] = [
      { id: 't1', rule_id: 'NR-C1', kind_id: 'push', subject: 's', body: 'b', edited_by: null, edited_on: null },
    ]
    const out = missingTemplates([rule()], templates)
    expect(out).toHaveLength(1)
    expect(out[0].kind).toBe('sms')
  })

  it('is empty when every pair is written', () => {
    const templates: Template[] = (['push', 'sms'] as KindId[]).map((k) => ({
      id: `t-${k}`, rule_id: 'NR-C1', kind_id: k, subject: 's', body: 'b', edited_by: null, edited_on: null,
    }))
    expect(missingTemplates([rule()], templates)).toEqual([])
  })
})

/* ------------------------------------------------------------- templates -- */

describe('placeholdersIn', () => {
  it('finds each placeholder once', () => {
    expect(placeholdersIn('{order} failed for {buyer}. See {order}.')).toEqual(['order', 'buyer'])
  })

  it('finds none in plain text', () => {
    expect(placeholdersIn('Nothing to fill in here')).toEqual([])
  })
})

describe('validateTemplate', () => {
  it('accepts a short SMS', () => {
    expect(validateTemplate({ subject: 'Order failed', body: '{order} failed. {link}', kind_id: 'sms' }, kinds).ok).toBe(true)
  })

  it('refuses a body longer than the channel carries, and says by how much', () => {
    const c = validateTemplate({ subject: 's', body: 'x'.repeat(161), kind_id: 'sms' }, kinds)
    expect(c.ok).toBe(false)
    if (!c.ok) expect(c.reason).toMatch(/160 characters and this is 161/)
  })

  it('lets email run to any length', () => {
    expect(validateTemplate({ subject: 's', body: 'x'.repeat(5000), kind_id: 'email' }, kinds).ok).toBe(true)
  })

  it('refuses a placeholder nothing fills in', () => {
    const c = validateTemplate({ subject: 'Hi {nickname}', body: 'b', kind_id: 'email' }, kinds)
    expect(c.ok).toBe(false)
    if (!c.ok) expect(c.reason).toMatch(/\{nickname\}/)
  })

  it('refuses an empty subject', () => {
    expect(validateTemplate({ subject: '  ', body: 'b', kind_id: 'email' }, kinds).ok).toBe(false)
  })
})

describe('remaining', () => {
  it('counts down on a capped channel', () => {
    expect(remaining('hello', kinds.find((k) => k.id === 'sms'))).toBe(155)
  })

  it('goes negative rather than clamping, so the counter shows the overrun', () => {
    expect(remaining('x'.repeat(170), kinds.find((k) => k.id === 'sms'))).toBe(-10)
  })

  it('is absent on an uncapped channel', () => {
    expect(remaining('hello', kinds.find((k) => k.id === 'email'))).toBeNull()
  })
})

describe('preview', () => {
  it('fills in what the sample knows', () => {
    expect(preview('{order} failed for {buyer}', SAMPLE)).toBe('ORD-881489 failed for Brightline Foods')
  })

  it('leaves an unknown placeholder visible rather than blanking it', () => {
    expect(preview('Hi {nickname}', SAMPLE)).toBe('Hi {nickname}')
  })
})

/* ------------------------------------------------------------------- log -- */

describe('newestFirst', () => {
  it('sorts by the timestamp, not by id', () => {
    const log = [
      entry({ id: 'a', sent_at: '2026-07-01T00:00:00Z' }),
      entry({ id: 'b', sent_at: '2026-07-31T00:00:00Z' }),
      entry({ id: 'c', sent_at: '2026-07-15T00:00:00Z' }),
    ]
    expect(newestFirst(log).map((e) => e.id)).toEqual(['b', 'c', 'a'])
  })
})

describe('filterLog', () => {
  const log = [
    entry({ id: 'a', persona: 'consumer', kind_id: 'push', state: 'delivered', subject: 'Out for delivery' }),
    entry({ id: 'b', persona: 'partner', kind_id: 'sms', state: 'suppressed', detail: 'unverified', subject: 'Order failed', ref: 'ORD-881489' }),
    entry({ id: 'c', persona: 'enterprise', kind_id: 'email', state: 'failed', detail: 'bounced', subject: 'Payment failed' }),
  ]

  it('filters by persona', () => {
    expect(filterLog(log, { persona: 'partner' }).map((e) => e.id)).toEqual(['b'])
  })

  it('treats "all" as no filter at all', () => {
    expect(filterLog(log, { persona: 'all', kind: 'all', state: 'all' })).toHaveLength(3)
  })

  it('searches the reference as well as the subject', () => {
    expect(filterLog(log, { search: 'ord-881489' }).map((e) => e.id)).toEqual(['b'])
  })

  it('combines filters rather than widening', () => {
    expect(filterLog(log, { persona: 'partner', state: 'failed' })).toEqual([])
  })
})

describe('deliverySummary', () => {
  const log = [
    entry({ id: 'a', state: 'delivered', cost: 0.0001 }),
    entry({ id: 'b', state: 'sent', cost: 0.0001 }),
    entry({ id: 'c', state: 'failed', detail: 'x', cost: 0.0045 }),
    entry({ id: 'd', state: 'suppressed', detail: 'turned off', cost: 0 }),
  ]

  it('does not count a deliberate suppression against delivery', () => {
    const s = deliverySummary(log)
    expect(s.attempted).toBe(3)
    expect(s.rate).toBe(66.67)
    expect(s.suppressed).toBe(1)
  })

  it('counts sent as through, since some channels give no receipt', () => {
    expect(deliverySummary([entry({ state: 'sent' })]).rate).toBe(100)
  })

  it('has no rate at all when nothing was attempted', () => {
    expect(deliverySummary([entry({ state: 'suppressed', detail: 'x' })]).rate).toBeNull()
  })

  it('adds up fractional per-message costs without losing them', () => {
    expect(deliverySummary(log).cost).toBe(0.0047)
  })
})

describe('byKind', () => {
  it('reports each channel separately and hides the ones nothing used', () => {
    const log = [
      entry({ kind_id: 'sms', state: 'failed', detail: 'x', cost: 0.0045 }),
      entry({ kind_id: 'sms', state: 'delivered', cost: 0.0045 }),
      entry({ kind_id: 'push', state: 'delivered' }),
    ]
    const out = byKind(log, kinds)
    expect(out.map((r) => r.kind)).toEqual(['push', 'sms'])
    expect(out.find((r) => r.kind === 'sms')!.rate).toBe(50)
    expect(out.find((r) => r.kind === 'sms')!.cost).toBe(0.009)
  })
})

describe('notDelivered', () => {
  it('picks up both the failures and the deliberate silences', () => {
    const log = [
      entry({ id: 'a', state: 'delivered' }),
      entry({ id: 'b', state: 'failed', detail: 'x', sent_at: '2026-07-01T00:00:00Z' }),
      entry({ id: 'c', state: 'suppressed', detail: 'y', sent_at: '2026-07-20T00:00:00Z' }),
    ]
    expect(notDelivered(log).map((e) => e.id)).toEqual(['c', 'b'])
  })
})

describe('silentRules', () => {
  it('names an enabled rule that has never fired', () => {
    const rules = [rule({ id: 'A' }), rule({ id: 'B' }), rule({ id: 'C', enabled: false })]
    const out = silentRules(rules, [entry({ rule_id: 'A' })])
    expect(out.map((r) => r.id)).toEqual(['B'])
  })
})

describe('costByGateway', () => {
  it('ranks the expensive gateways first and drops the unused ones', () => {
    const gateways: Gateway[] = [
      { id: 'ch-001', name: 'SMS Primary', kind: 'sms', enabled: true },
      { id: 'ch-003', name: 'Email Primary', kind: 'email', enabled: true },
      { id: 'ch-006', name: 'WhatsApp', kind: 'whatsapp', enabled: true },
    ]
    const log = [
      entry({ channel_id: 'ch-001', kind_id: 'sms', cost: 0.0045 }),
      entry({ channel_id: 'ch-003', kind_id: 'email', cost: 0.0001 }),
      entry({ channel_id: 'ch-003', kind_id: 'email', cost: 0.0001 }),
    ]
    const out = costByGateway(log, gateways)
    expect(out.map((r) => r.id)).toEqual(['ch-001', 'ch-003'])
    expect(out[1].messages).toBe(2)
  })
})

describe('explain', () => {
  it('prefers the reason the log recorded', () => {
    expect(explain(entry({ state: 'suppressed', detail: 'SMS turned off on 12 Jul' }))).toMatch(/12 Jul/)
  })

  it('says why a sent message has no receipt', () => {
    expect(explain(entry({ state: 'sent' }))).toMatch(/no delivery receipt/)
  })

  it('flags a row with no reason as a problem in itself', () => {
    expect(explain(entry({ state: 'queued', detail: null }))).toMatch(/Waiting/)
  })
})

/* --------------------------------------------------------------- helpers -- */

describe('money', () => {
  it('keeps four places on a fraction of a cent, where SMS pricing lives', () => {
    expect(money(0.0045)).toBe('$0.0045')
  })

  it('uses two places once there is real money', () => {
    expect(money(12.5)).toBe('$12.50')
    expect(money(0)).toBe('$0.00')
  })
})

describe('when', () => {
  it('gives a date and a time and no year', () => {
    expect(when('2026-07-31T07:12:00Z')).toMatch(/31 Jul/)
  })

  it('hands back anything it cannot parse rather than showing "Invalid Date"', () => {
    expect(when('not a date')).toBe('not a date')
  })
})

describe('shared vocabulary', () => {
  it('orders channels cheapest and quietest first', () => {
    expect(KIND_ORDER[0]).toBe('inapp')
    expect(KIND_ORDER).toHaveLength(5)
  })

  it('labels every persona and every log state', () => {
    expect(Object.keys(PERSONA_LABEL)).toHaveLength(4)
    expect(STATE_LABEL.suppressed).toBe('Not sent')
  })
})
