import { describe, it, expect } from 'vitest'
import { techStatus, techReady, TECH_CHECKS, GATES, REQUIRED_EVENTS } from './onboarding'
import type { Endpoint, TestCall, SandboxRun } from './onboarding'

const ep = (over: Partial<Endpoint> = {}): Endpoint => ({
  id: 'EP-01', partner_id: 'PTR-1004', name: 'Fulfilment', url: 'https://x.test/f',
  method: 'POST', auth: 'HMAC-SHA256', enabled: true, events: [...REQUIRED_EVENTS], ...over,
})
const ack = (endpoint_id: string): TestCall =>
  ({ id: 'TC-1', endpoint_id, status: 'acknowledged', called_at: '2026-07-28T10:00:00Z' })
const passedRun: SandboxRun =
  { id: 'SR-1', partner_id: 'PTR-1004', state: 'passed', ran_at: '2026-07-28T10:00:00Z' }

describe('constants', () => {
  it('declares seven gates in order with no duplicates', () => {
    expect(GATES).toHaveLength(7)
    expect(GATES.map(g => g.order)).toEqual([1, 2, 3, 4, 5, 6, 7])
    expect(new Set(GATES.map(g => g.id)).size).toBe(7)
  })

  it('declares four technical checks, each carrying its reasoning', () => {
    expect(TECH_CHECKS).toHaveLength(4)
    expect(TECH_CHECKS.map(c => c.id)).toEqual(['registered', 'auth', 'tested', 'sandbox'])
    TECH_CHECKS.forEach(c => expect(c.why.length).toBeGreaterThan(20))
  })
})

describe('techStatus', () => {
  it('passes all four when everything is in place', () => {
    const s = techStatus([ep()], [ack('EP-01')], passedRun)
    expect(s.checks).toEqual({ registered: true, auth: true, tested: true, sandbox: true })
    expect(techReady(s)).toBe(true)
  })

  it('fails registered when a required event has no endpoint', () => {
    const s = techStatus([ep({ events: ['order.created'] })], [ack('EP-01')], passedRun)
    expect(s.checks.registered).toBe(false)
    expect(s.missing).toContain('stock.update')
    expect(techReady(s)).toBe(false)
  })

  it('fails auth when an endpoint has none', () => {
    const s = techStatus([ep({ auth: 'None' })], [ack('EP-01')], passedRun)
    expect(s.checks.auth).toBe(false)
    expect(s.noAuth.map(e => e.id)).toEqual(['EP-01'])
  })

  it('fails tested when a call was sent but never acknowledged', () => {
    const sent: TestCall = { id: 'TC-2', endpoint_id: 'EP-01', status: 'sent', called_at: '2026-07-28T10:00:00Z' }
    const s = techStatus([ep()], [sent], passedRun)
    expect(s.checks.tested).toBe(false)
    expect(s.untested.map(e => e.id)).toEqual(['EP-01'])
  })

  it('fails sandbox when the run has not passed', () => {
    const s = techStatus([ep()], [ack('EP-01')], { ...passedRun, state: 'failed' })
    expect(s.checks.sandbox).toBe(false)
  })

  it('fails sandbox when there is no run at all', () => {
    expect(techStatus([ep()], [ack('EP-01')], null).checks.sandbox).toBe(false)
  })

  it('ignores disabled endpoints when judging auth', () => {
    const s = techStatus([ep(), ep({ id: 'EP-02', auth: 'None', enabled: false })], [ack('EP-01')], passedRun)
    expect(s.checks.auth).toBe(true)
  })

  it('fails everything when no endpoints are registered', () => {
    const s = techStatus([], [], passedRun)
    expect(s.checks.registered).toBe(false)
    expect(s.checks.auth).toBe(false)
    expect(s.checks.tested).toBe(false)
  })
})
