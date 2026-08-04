/* The rules behind the seller's Integrations screen — all of which the screen
   used to assert as literals. */
import { describe, it, expect } from 'vitest'
import {
  recent, successRate, healthOf, healthNote, eventsUncovered,
  validateEndpoint, blankDraft, describeResult, nextCallId, nextEndpointId,
  REQUIRED_EVENTS,
} from './endpoints'
import type { Endpoint, TestCall, EndpointDraft } from './endpoints'

const ep = (over: Partial<Endpoint> = {}): Endpoint => ({
  id: 'EP-1004-01', partner_id: 'PTR-1004', name: 'Fulfilment webhook',
  url: 'https://api.nimbus-sensors.example/fulfil', method: 'POST', auth: 'HMAC-SHA256',
  enabled: true, events: ['order.created', 'order.cancelled'], env: 'Sandbox',
  retry: '3 attempts', timeout_ms: 5000, note: null, sort_order: 1, ...over,
})

const call = (over: Partial<TestCall> & { called_at: string }): TestCall => ({
  id: 'ETC-0001', endpoint_id: 'EP-1004-01', status: 'ok', ms: 200,
  detail: 'HTTP 200', called_by: 'Rajesh Kumar', ...over,
})

const draft = (over: Partial<EndpointDraft> = {}): EndpointDraft => ({
  ...blankDraft(), name: 'Fulfilment webhook', url: 'https://api.example.com/hook', ...over,
})

describe('what the recent calls say', () => {
  const calls: TestCall[] = [
    call({ called_at: '2026-07-26T09:00:00Z', id: 'a', status: 'ok' }),
    call({ called_at: '2026-07-27T09:00:00Z', id: 'b', status: 'ok' }),
    call({ called_at: '2026-07-29T09:00:00Z', id: 'c', status: 'failed' }),
    call({ called_at: '2026-08-01T09:00:00Z', id: 'd', status: 'failed' }),
    call({ called_at: '2026-08-03T09:00:00Z', id: 'e', status: 'timeout' }),
  ]

  it('reads newest first', () => {
    expect(recent(calls, 'EP-1004-01').map(c => c.id)).toEqual(['e', 'd', 'c', 'b', 'a'])
  })

  it('only reads the endpoint asked for', () => {
    const mixed = [...calls, call({ called_at: '2026-08-04T09:00:00Z', id: 'z', endpoint_id: 'EP-1004-02' })]
    expect(recent(mixed, 'EP-1004-02').map(c => c.id)).toEqual(['z'])
  })

  it('gives the success rate over the window', () => {
    expect(successRate(calls, 'EP-1004-01')).toBe(40)
  })

  it('says nothing rather than 0% when nothing has been called', () => {
    /* An untested endpoint that reads "0% success" gets a working integration
       switched off by somebody trying to be careful. */
    expect(successRate(calls, 'EP-9999-01')).toBeNull()
    expect(healthOf(calls, 'EP-9999-01')).toBe('untested')
  })

  it('judges health on the last call, not the average', () => {
    /* Three failures then a success is a fixed endpoint. The average still says
       40%, and sending somebody to debug it would waste their afternoon. */
    const fixed = [...calls, call({ called_at: '2026-08-04T10:00:00Z', id: 'f', status: 'ok' })]
    expect(successRate(fixed, 'EP-1004-01')).toBe(40)
    expect(healthOf(fixed, 'EP-1004-01')).toBe('healthy')
  })

  it('calls it failing while the last call failed', () => {
    expect(healthOf(calls, 'EP-1004-01')).toBe('failing')
  })

  it('counts the failures in its one-line note', () => {
    expect(healthNote(calls, 'EP-1004-01')).toBe('3 of the last 5 calls failed')
    expect(healthNote([call({ called_at: '2026-08-01T09:00:00Z' })], 'EP-1004-01'))
      .toBe('1 of the last 1 calls succeeded')
    expect(healthNote([], 'EP-1004-01')).toBe('Never called')
  })
})

describe('the events somebody has to be listening for', () => {
  it('is happy when the required ones are covered', () => {
    expect(eventsUncovered([ep()])).toEqual([])
  })

  it('names what nothing is listening for', () => {
    expect(eventsUncovered([ep({ events: ['order.created'] })])).toEqual(['order.cancelled'])
  })

  it('lets two endpoints share the required events between them', () => {
    /* Splitting them across endpoints is a normal arrangement. Requiring both
       on one endpoint would be a rule nobody agreed to. */
    expect(eventsUncovered([
      ep({ id: 'a', events: ['order.created'] }),
      ep({ id: 'b', events: ['order.cancelled'] }),
    ])).toEqual([])
  })

  it('does not count a disabled endpoint as cover', () => {
    expect(eventsUncovered([ep({ enabled: false })])).toEqual(REQUIRED_EVENTS)
  })
})

describe('whether an endpoint can be saved', () => {
  it('accepts a sensible one', () => {
    expect(validateEndpoint(draft(), []).ok).toBe(true)
  })

  it('needs a name, because the failure alert has to call it something', () => {
    const r = validateEndpoint(draft({ name: '  ' }), [])
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/name/)
  })

  it('refuses plain http, naming what would be readable', () => {
    const r = validateEndpoint(draft({ url: 'http://api.example.com/hook' }), [])
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/https/)
  })

  it('refuses localhost, which would register cleanly and never deliver', () => {
    const r = validateEndpoint(draft({ url: 'https://localhost:3000/hook' }), [])
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/localhost/)
  })

  it('refuses something that is not a URL at all', () => {
    expect(validateEndpoint(draft({ url: 'api.example.com/hook' }), []).ok).toBe(false)
  })

  it('refuses an endpoint subscribed to nothing', () => {
    const r = validateEndpoint(draft({ events: [] }), [])
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/at least one event/)
  })

  it('refuses an event the marketplace does not send', () => {
    const r = validateEndpoint(draft({ events: ['order.vanished'] }), [])
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toContain('order.vanished')
  })

  it('keeps the timeout inside what the caller will wait', () => {
    expect(validateEndpoint(draft({ timeoutMs: 100 }), []).ok).toBe(false)
    expect(validateEndpoint(draft({ timeoutMs: 90000 }), []).ok).toBe(false)
    expect(validateEndpoint(draft({ timeoutMs: 500 }), []).ok).toBe(true)
  })

  it('refuses a second endpoint on the same URL and environment, naming the first', () => {
    /* Both would fire for the same event, and the seller would fulfil twice. */
    const r = validateEndpoint(
      draft({ url: 'https://api.nimbus-sensors.example/fulfil', env: 'Sandbox' }),
      [ep()],
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toContain('Fulfilment webhook')
  })

  it('allows the same URL on the other environment', () => {
    expect(validateEndpoint(
      draft({ url: 'https://api.nimbus-sensors.example/fulfil', env: 'Production' }),
      [ep()],
    ).ok).toBe(true)
  })

  it('does not accuse an endpoint of clashing with itself while it is edited', () => {
    expect(validateEndpoint(
      draft({ url: 'https://api.nimbus-sensors.example/fulfil', env: 'Sandbox' }),
      [ep()], 'EP-1004-01',
    ).ok).toBe(true)
  })
})

describe('reporting a call back', () => {
  it('says how long each outcome took', () => {
    expect(describeResult({ status: 'ok', ms: 312, detail: 'HTTP 200' })).toBe('Answered in 312ms — HTTP 200')
    expect(describeResult({ status: 'timeout', ms: 5000, detail: 'no response' })).toMatch(/No answer inside 5000ms/)
    expect(describeResult({ status: 'failed', ms: 900, detail: 'HTTP 500' })).toMatch(/Failed after 900ms/)
  })

  it('numbers the next call within its own endpoint', () => {
    expect(nextCallId([
      call({ called_at: 'x', id: 'EP-1004-01-C001' }),
      call({ called_at: 'y', id: 'EP-1004-01-C002' }),
    ], 'EP-1004-01')).toBe('EP-1004-01-C003')
    expect(nextCallId([], 'EP-1004-01')).toBe('EP-1004-01-C001')
  })

  it('does not collide with a call it cannot see', () => {
    /* The first real test call hit this. A seller loads only their own calls,
       so the highest id in hand was ETC-0007 while ETC-0008 already existed on
       another seller's endpoint: the insert came back a duplicate key, the
       endpoint was called, the seller was told, and nothing was written down.
       Prefixing with the endpoint makes the id unique whether or not the rows
       that would clash are visible. */
    const mine = [call({ called_at: 'x', id: 'ETC-0007', endpoint_id: 'EP-1004-01' })]
    expect(nextCallId(mine, 'EP-1004-01')).toBe('EP-1004-01-C001')
    expect(nextCallId(mine, 'EP-1004-02')).toBe('EP-1004-02-C001')
  })

  it('ignores another endpoint\u2019s numbering', () => {
    expect(nextCallId([
      call({ called_at: 'x', id: 'EP-1004-02-C009', endpoint_id: 'EP-1004-02' }),
    ], 'EP-1004-01')).toBe('EP-1004-01-C001')
  })

  it('numbers a new endpoint within its own seller', () => {
    /* Scoped to the seller so two of them adding at the same moment do not
       both claim EP-04. */
    expect(nextEndpointId('PTR-1004', [ep(), ep({ id: 'EP-1004-03' }), ep({ id: 'EP-1002-09', partner_id: 'PTR-1002' })]))
      .toBe('EP-1004-04')
    expect(nextEndpointId('PTR-1007', [])).toBe('EP-1007-01')
  })
})
