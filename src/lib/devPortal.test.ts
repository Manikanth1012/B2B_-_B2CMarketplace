import { describe, it, expect } from 'vitest'
import {
  keyNote, usable, maskedSecret, daysUntil, sunsetWarning, usageOf, LIMITS,
  curlFor, endpointUrl, scopesHeld, callability, productionQueue,
  publishable, deprecatable, statusTone, groupEndpoints, KEY_STATE_LABEL,
} from './devPortal'
import type { Credential, Version, Endpoint, Subscription, CallRecord } from './devPortal'

const NOW = new Date('2026-08-06T12:00:00Z')

const cred = (over: Partial<Credential> = {}): Credential => ({
  id: 'CRD-1', application_id: 'APP-1', environment: 'sandbox',
  client_id: 'cid_sandbox_abc', secret_prefix: 'ak_sandbox_9f2', secret_last4: 'c41f',
  issued_at: '2026-01-04T00:00:00Z', issued_to: 'Katrin Boehm',
  rotated_from: null, grace_until: null, revoked_at: null, revoked_why: null,
  last_used_at: null, state: 'active', grace_days_left: null, ...over,
})

const ep = (over: Partial<Endpoint> = {}): Endpoint => ({
  id: 'EP-CAT-1', version_id: 'AP-CAT@2.1', method: 'GET', path: '/productOffering',
  summary: 'List your offerings', description: null, scope: 'catalogue:read',
  request_example: null, response_example: { totalCount: 0 }, ...over,
})

const ver = (over: Partial<Version> = {}): Version => ({
  id: 'AP-CAT@2.1', api_id: 'AP-CAT', api_name: 'Product Catalogue', version: '2.1',
  lifecycle: 'current', base_path: '/tmf-api/productcatalogue/v2', released_on: '2024-06-01',
  deprecated_on: null, sunset_on: null, migration_note: null,
  scopes: ['catalogue:read', 'catalogue:write'], standard: 'TMF620',
  description: 'The catalogue', endpoints: [ep()], ...over,
})

const sub = (over: Partial<Subscription> = {}): Subscription => ({
  id: 'SUB-1', api_id: 'AP-CAT', api_name: 'Product Catalogue',
  application_id: 'APP-1', version_id: 'AP-CAT@2.1', version: '2.1',
  environment: 'sandbox', scopes: ['catalogue:read'], volume: 0, state: 'active',
  use_case: null, requested_at: null, decided_at: null, decided_by: null,
  decision_note: null, rate_limit_per_min: 60, quota_per_day: 10_000,
  consumer_name: 'Nimbus Sensors', partner_id: 'PTR-1004', ...over,
})

const call = (over: Partial<CallRecord> = {}): CallRecord => ({
  id: 1, application_id: 'APP-1', version_id: 'AP-CAT@2.1', environment: 'sandbox',
  method: 'GET', path: '/productOffering', status_code: 200, ms: 120,
  called_at: '2026-08-01T09:00:00Z', ...over,
})

describe('key state', () => {
  it('names every state it can be in', () => {
    expect(Object.keys(KEY_STATE_LABEL).sort())
      .toEqual(['active', 'expired', 'retiring', 'revoked'])
  })

  it('a revoked key carries the reason it was revoked', () => {
    const note = keyNote(cred({
      state: 'revoked', revoked_at: '2026-07-01T00:00:00Z',
      revoked_why: 'Committed to a public repository.',
    }))
    expect(note).toContain('2026-07-01')
    expect(note).toContain('public repository')
  })

  it('a rotating key states the deadline, not just the status', () => {
    const note = keyNote(cred({ state: 'retiring', grace_days_left: 3, grace_until: '2026-08-09T00:00:00Z' }))
    expect(note).toContain('3 days')
    expect(note).toContain('2026-08-09')
  })

  it('says today rather than "in 0 days" on the last day', () => {
    expect(keyNote(cred({ state: 'retiring', grace_days_left: 0 }))).toContain('today')
  })

  it('does not pluralise a single day', () => {
    const note = keyNote(cred({ state: 'retiring', grace_days_left: 1 }))
    expect(note).toContain('in 1 day.')
    expect(note).not.toContain('1 days')
  })

  it('an unused key says so rather than showing a blank', () => {
    expect(keyNote(cred({ last_used_at: null }))).toContain('never used')
  })

  it('a key inside its grace window still authenticates', () => {
    expect(usable(cred({ state: 'retiring' }))).toBe(true)
    expect(usable(cred({ state: 'active' }))).toBe(true)
    expect(usable(cred({ state: 'expired' }))).toBe(false)
    expect(usable(cred({ state: 'revoked' }))).toBe(false)
  })

  it('masks the secret to the two parts the table can actually see', () => {
    const m = maskedSecret(cred())
    expect(m.startsWith('ak_sandbox_9f2')).toBe(true)
    expect(m.endsWith('c41f')).toBe(true)
    expect(m).not.toContain('•'.repeat(25))
  })
})

describe('days until', () => {
  it('counts whole days forward', () => {
    expect(daysUntil('2026-08-09', NOW)).toBe(3)
  })
  it('is zero on the day itself, whatever the time', () => {
    expect(daysUntil('2026-08-06', NOW)).toBe(0)
  })
  it('goes negative once the date has passed', () => {
    expect(daysUntil('2026-08-01', NOW)).toBe(-5)
  })
  it('has no answer for no date', () => {
    expect(daysUntil(null, NOW)).toBeNull()
  })
})

describe('sunset warning', () => {
  it('says nothing about a current version', () => {
    expect(sunsetWarning(ver(), NOW)).toBeNull()
  })

  it('turns urgent inside 90 days and counts them', () => {
    const w = sunsetWarning(ver({
      lifecycle: 'deprecated', deprecated_on: '2026-03-01', sunset_on: '2026-09-30',
      migration_note: 'Read prices[] instead of price.',
    }), NOW)
    expect(w?.tone).toBe('danger')
    expect(w?.headline).toContain('55 days')
    expect(w?.detail).toContain('prices[]')
  })

  it('is a warning, not an alarm, when the sunset is far out', () => {
    const w = sunsetWarning(ver({
      lifecycle: 'deprecated', deprecated_on: '2026-03-01', sunset_on: '2027-06-30',
      migration_note: 'Move to 2.1.',
    }), NOW)
    expect(w?.tone).toBe('warning')
    expect(w?.headline).toContain('2027-06-30')
  })

  it('says it has already happened once the date is past', () => {
    const w = sunsetWarning(ver({
      lifecycle: 'deprecated', deprecated_on: '2025-01-01', sunset_on: '2026-01-01',
      migration_note: 'Move to 2.1.',
    }), NOW)
    expect(w?.tone).toBe('danger')
    expect(w?.headline).toContain('switched off')
  })

  it('a retired version is the strongest thing it says', () => {
    expect(sunsetWarning(ver({ lifecycle: 'retired' }), NOW)?.tone).toBe('danger')
  })
})

describe('usage', () => {
  it('a quota is compared against the busiest day, not the average', () => {
    const calls = [
      ...Array.from({ length: 90 }, (_, i) => call({ id: i, called_at: '2026-08-01T09:00:00Z' })),
      ...Array.from({ length: 10 }, (_, i) => call({ id: 100 + i, called_at: '2026-08-02T09:00:00Z' })),
    ]
    const u = usageOf(calls, 100)
    expect(u.calls).toBe(100)
    expect(u.peakDay).toBe(90)
    expect(u.peakDayOn).toBe('2026-08-01')
    /* Averaged over two days this is 50 of 100 and looks safe. It is not. */
    expect(u.nearLimit).toBe(true)
    expect(u.headroom).toBe(10)
  })

  it('counts failures as failures and reports the rate', () => {
    const u = usageOf([
      call({ id: 1, status_code: 200 }), call({ id: 2, status_code: 200 }),
      call({ id: 3, status_code: 403 }), call({ id: 4, status_code: 500 }),
    ], 1000)
    expect(u.failed).toBe(2)
    expect(u.successRate).toBe(50)
  })

  it('has no success rate when nothing was called, rather than 0%', () => {
    const u = usageOf([], 1000)
    expect(u.successRate).toBeNull()
    expect(u.avgMs).toBeNull()
    expect(u.nearLimit).toBe(false)
  })

  it('averages only calls that were timed', () => {
    expect(usageOf([call({ ms: 100 }), call({ id: 2, ms: 0 }), call({ id: 3, ms: 300 })], 10).avgMs).toBe(200)
  })

  it('throttles sandbox harder than production', () => {
    expect(LIMITS.sandbox.rate).toBeLessThan(LIMITS.production.rate)
    expect(LIMITS.sandbox.quota).toBeLessThan(LIMITS.production.quota)
  })
})

describe('the call as the developer would make it', () => {
  it('points sandbox and production at different hosts', () => {
    expect(endpointUrl(ver(), ep(), 'sandbox')).toContain('sandbox.api.aventa.com')
    expect(endpointUrl(ver(), ep(), 'production')).not.toContain('sandbox')
  })

  it('builds the path from the version base path, not a guess', () => {
    expect(endpointUrl(ver(), ep(), 'sandbox'))
      .toBe('https://sandbox.api.aventa.com/tmf-api/productcatalogue/v2/productOffering')
  })

  it('the curl asks for the scope the endpoint needs', () => {
    expect(curlFor(ver(), ep(), 'sandbox', 'cid_sandbox_abc')).toContain('scope=catalogue:read')
  })

  it('never prints the secret, only the variable that holds it', () => {
    const c = curlFor(ver(), ep(), 'sandbox', 'cid_sandbox_abc')
    expect(c).toContain('$CLIENT_SECRET')
    expect(c).toContain('cid_sandbox_abc')
  })

  it('sends a body only where the endpoint takes one', () => {
    expect(curlFor(ver(), ep(), 'sandbox', 'x')).not.toContain('-d \'{')
    const withBody = curlFor(ver(), ep({ method: 'POST', request_example: { name: 'X' } }), 'sandbox', 'x')
    expect(withBody).toContain('"name":"X"')
  })
})

describe('what this application may call', () => {
  it('holds only the scopes of its active subscriptions in that environment', () => {
    const subs = [
      sub({ id: 'a', scopes: ['catalogue:read'], environment: 'sandbox' }),
      sub({ id: 'b', scopes: ['catalogue:write'], environment: 'production' }),
      sub({ id: 'c', scopes: ['orders:read'], environment: 'sandbox', state: 'pending' }),
    ]
    expect(scopesHeld(subs, 'APP-1', 'sandbox')).toEqual(['catalogue:read'])
    expect(scopesHeld(subs, 'APP-1', 'production')).toEqual(['catalogue:write'])
  })

  it('allows a call the subscription covers', () => {
    expect(callability([sub()], 'APP-1', 'sandbox', ver(), ep()).ok).toBe(true)
  })

  it('names the missing scope rather than just refusing', () => {
    const r = callability([sub({ scopes: ['catalogue:read'] })], 'APP-1', 'sandbox', ver(),
                          ep({ scope: 'catalogue:write' }))
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.reason).toContain('catalogue:write')
      expect(r.reason).toContain('catalogue:read')
    }
  })

  it('distinguishes "not subscribed" from "still waiting to be decided"', () => {
    const waiting = callability([sub({ state: 'pending', environment: 'production' })],
                                'APP-1', 'production', ver(), ep())
    expect(waiting.ok).toBe(false)
    if (!waiting.ok) expect(waiting.reason).toContain('still with the marketplace')

    const none = callability([], 'APP-1', 'production', ver(), ep())
    expect(none.ok).toBe(false)
    if (!none.ok) expect(none.reason).toContain('not subscribed')
  })

  it('does not let one application borrow another\'s subscription', () => {
    expect(callability([sub({ application_id: 'APP-OTHER' })], 'APP-1', 'sandbox', ver(), ep()).ok).toBe(false)
  })
})

describe('the operator queue', () => {
  it('puts the request that has waited longest at the top', () => {
    const q = productionQueue([
      sub({ id: 'new', state: 'pending', requested_at: '2026-08-05T00:00:00Z' }),
      sub({ id: 'old', state: 'pending', requested_at: '2026-07-01T00:00:00Z' }),
      sub({ id: 'done', state: 'active' }),
    ], NOW)
    expect(q.map(i => i.sub.id)).toEqual(['old', 'new'])
    expect(q[0].waitingDays).toBe(36)
  })

  it('holds nothing when nothing is pending', () => {
    expect(productionQueue([sub({ state: 'active' }), sub({ state: 'refused' })], NOW)).toEqual([])
  })
})

describe('publishing', () => {
  it('refuses a version with no endpoints', () => {
    const r = publishable({ version: '1.0', base_path: '/tmf-api/x/v1', endpoints: [] })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toContain('at least one endpoint')
  })

  it('refuses a version string callers could not pin to', () => {
    expect(publishable({ version: 'latest', base_path: '/x', endpoints: [1] }).ok).toBe(false)
    expect(publishable({ version: '2.1', base_path: '/x', endpoints: [1] }).ok).toBe(true)
  })

  it('refuses a base path that is not one', () => {
    expect(publishable({ version: '1.0', base_path: 'tmf-api/x', endpoints: [1] }).ok).toBe(false)
  })
})

describe('deprecation, which replaced deletion', () => {
  it('refuses a sunset too soon for callers to move', () => {
    const r = deprecatable({ lifecycle: 'current' }, '2026-08-20',
                           'Move to v3, which splits price into prices[].', NOW)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toContain('30 days')
  })

  it('refuses a deprecation with no migration note', () => {
    const r = deprecatable({ lifecycle: 'current' }, '2027-01-01', 'old', NOW)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toContain('what to do instead')
  })

  it('accepts a dated, explained deprecation', () => {
    expect(deprecatable({ lifecycle: 'current' }, '2027-01-01',
      'v3 replaces price with prices[], one entry per market.', NOW).ok).toBe(true)
  })

  it('will not deprecate what is already retired', () => {
    expect(deprecatable({ lifecycle: 'retired' }, '2027-01-01',
      'v3 replaces price with prices[], one entry per market.', NOW).ok).toBe(false)
  })
})

describe('shaping', () => {
  it('separates the caller\'s fault from the marketplace\'s', () => {
    expect(statusTone(200)).toBe('ok')
    expect(statusTone(403)).toBe('client')
    expect(statusTone(500)).toBe('server')
  })

  it('groups endpoints by the resource they act on', () => {
    const g = groupEndpoints([
      ep({ id: '1', path: '/productOffering' }),
      ep({ id: '2', path: '/productOffering/{id}' }),
      ep({ id: '3', path: '/category' }),
    ])
    expect(g.map(x => x.resource)).toEqual(['category', 'productOffering'])
    expect(g[1].endpoints).toHaveLength(2)
  })
})
