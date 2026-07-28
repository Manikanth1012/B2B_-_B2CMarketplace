import { describe, it, expect } from 'vitest'
import { techStatus, techReady, TECH_CHECKS, GATES, REQUIRED_EVENTS } from './onboarding'
import { canClearGate, deriveTaskState, nextGate, gateIdFor } from './onboarding'
import type { Endpoint, TestCall, SandboxRun } from './onboarding'
import type { GateRow, TaskRow, TechStatus } from './onboarding'

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

const gates = (currentOrder: number): GateRow[] =>
  GATES.map(g => ({
    id: `og-PTR-1004-${g.order}`, partner_id: 'PTR-1004', gate_name: g.name, gate_order: g.order,
    status: g.order < currentOrder ? 'cleared' as const : g.order === currentOrder ? 'current' as const : 'pending' as const,
    notes: null, reviewed_by: null, reviewed_at: null,
  }))

const readyTech: TechStatus =
  { checks: { registered: true, auth: true, tested: true, sandbox: true }, missing: [], noAuth: [], untested: [] }
const partialTech: TechStatus =
  { checks: { registered: true, auth: true, tested: true, sandbox: false }, missing: [], noAuth: [], untested: [] }

describe('gateIdFor', () => {
  it('maps a row back to its gate id by name', () => {
    expect(gateIdFor(gates(5)[4])).toBe('tech')
  })
})

describe('canClearGate', () => {
  it('allows clearing the current gate', () => {
    const all = gates(4)
    expect(canClearGate(all[3], all, readyTech)).toEqual({ ok: true })
  })

  it('refuses a gate that is still pending', () => {
    const all = gates(4)
    const v = canClearGate(all[5], all, readyTech)
    expect(v.ok).toBe(false)
    if (!v.ok) expect(v.reason).toMatch(/not the current gate/i)
  })

  it('refuses a gate that is already cleared', () => {
    const all = gates(4)
    const v = canClearGate(all[0], all, readyTech)
    expect(v.ok).toBe(false)
    if (!v.ok) expect(v.reason).toMatch(/already cleared/i)
  })

  it('refuses the technical gate when three of four checks pass', () => {
    const all = gates(5)
    const v = canClearGate(all[4], all, partialTech)
    expect(v.ok).toBe(false)
    if (!v.ok) {
      expect(v.outstanding).toHaveLength(1)
      expect(v.outstanding[0].id).toBe('sandbox')
      expect(v.reason).toMatch(/no override/i)
    }
  })

  it('allows the technical gate once all four pass', () => {
    const all = gates(5)
    expect(canClearGate(all[4], all, readyTech)).toEqual({ ok: true })
  })

  it('does not apply technical checks to other gates', () => {
    const all = gates(4)
    expect(canClearGate(all[3], all, partialTech)).toEqual({ ok: true })
  })
})

describe('nextGate', () => {
  it('returns the following gate by order', () => {
    const all = gates(4)
    expect(nextGate(all[3], all)?.gate_order).toBe(5)
  })

  it('returns null on the final gate', () => {
    const all = gates(7)
    expect(nextGate(all[6], all)).toBeNull()
  })
})

describe('deriveTaskState', () => {
  const task = (gate_id: string): TaskRow => ({
    id: 'OB-1', partner_id: 'PTR-1004', gate_id, title: 't', detail: 'd',
    owner: 'You', due: null, closed_by: null, closed_at: null,
  })

  it('is done when its gate is cleared', () => {
    expect(deriveTaskState(task('apply'), gates(4))).toBe('done')
  })

  it('is open when its gate is current', () => {
    expect(deriveTaskState(task('finance'), gates(4))).toBe('open')
  })

  it('is not started when its gate has not been reached', () => {
    expect(deriveTaskState(task('golive'), gates(4))).toBe('not_started')
  })

  it('is not started when the gate id is unknown', () => {
    expect(deriveTaskState(task('nonsense'), gates(4))).toBe('not_started')
  })
})
