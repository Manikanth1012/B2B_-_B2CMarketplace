import { describe, it, expect } from 'vitest'
import { techStatus, techReady, TECH_CHECKS, GATES, REQUIRED_EVENTS, SLA_DAYS } from './onboarding'
import { canClearGate, deriveTaskState, nextGate, gateIdFor } from './onboarding'
import { buildJourney, journeyProgress, evidenceChecklist } from './onboarding'
import type { Endpoint, TestCall, SandboxRun } from './onboarding'
import type { GateRow, TaskRow, TechStatus } from './onboarding'
import type { Submission, GateDocument, JourneyStep } from './onboarding'

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

/* ------------------------------------------------------------- journey ---- */

type Row = JourneyStep['row']

const row = (over: Partial<Row> & { gate_name: string; gate_order: number; status: Row['status'] }): Row => {
  const def = GATES.find(g => g.name === over.gate_name)!
  return {
    id: `og-PTR-1004-${def.id}`, partner_id: 'PTR-1004',
    owner: def.owner, target_days: def.targetDays, dual_control: def.dualControl,
    waivable: def.waivable, evidence: [], notes: null,
    submitted_by: 'Katrin Boehm', submitted_at: '2024-09-10T00:00:00Z',
    reviewed_by: 'Lena Fischer', reviewed_at: '2024-09-11T00:00:00Z',
    ...over,
  }
}

const sub = (gate_id: string, fields: [string, string][], over: Partial<Submission> = {}): Submission => ({
  gate_id, partner_id: 'PTR-1004', gate_key: 'apply', decision: 'Cleared', note: null, fields, ...over,
})

const doc = (gate_id: string, name: string, sort_order = 1): GateDocument => ({
  id: `doc-${name}`, gate_id, partner_id: 'PTR-1004', name, kind: 'PDF', size: '1.0 MB',
  uploaded_by: 'Katrin Boehm', uploaded_at: '2024-09-10T00:00:00Z', sort_order,
})

describe('SLA_DAYS', () => {
  /* The figure the marketplace publishes. Computed from the ladder rather than
     written down, so the two cannot disagree — and the migration asserts the
     same sum against the rows in the database. */
  it('is the sum of the gate targets, which is the published five working days', () => {
    expect(SLA_DAYS).toBe(5)
    expect(SLA_DAYS).toBe(GATES.reduce((n, g) => n + g.targetDays, 0))
  })
})

describe('buildJourney', () => {
  it('orders by gate order whatever order the rows arrive in', () => {
    const rows = [
      row({ gate_name: 'Agreements', gate_order: 3, status: 'cleared' }),
      row({ gate_name: 'Application', gate_order: 1, status: 'cleared' }),
    ]
    expect(buildJourney(rows, [], []).map(s => s.gate.id)).toEqual(['apply', 'agree'])
  })

  it('attaches the submission and documents belonging to each gate and no others', () => {
    const rows = [
      row({ id: 'g1', gate_name: 'Application', gate_order: 1, status: 'cleared' }),
      row({ id: 'g2', gate_name: 'KYC & due diligence', gate_order: 2, status: 'cleared' }),
    ]
    const steps = buildJourney(rows, [sub('g2', [['Adverse media', 'Nothing material found']])],
      [doc('g2', 'Certificate of incorporation'), doc('g1', 'Completed application form')])
    expect(steps[0].submission).toBeNull()
    expect(steps[0].documents.map(d => d.name)).toEqual(['Completed application form'])
    expect(steps[1].submission?.fields[0][0]).toBe('Adverse media')
  })

  it('measures how long a decided gate took', () => {
    const rows = [row({
      gate_name: 'KYC & due diligence', gate_order: 2, status: 'cleared',
      submitted_at: '2024-09-12T00:00:00Z', reviewed_at: '2024-09-14T00:00:00Z',
    })]
    expect(buildJourney(rows, [], [])[0].elapsedDays).toBe(2)
  })

  /* A clock that has not stopped must not be reported as a duration. */
  it('reports no elapsed time on a gate still under review', () => {
    const rows = [row({ gate_name: 'Bank & tax', gate_order: 4, status: 'current', reviewed_at: null, reviewed_by: null })]
    const step = buildJourney(rows, [], [])[0]
    expect(step.elapsedDays).toBeNull()
    expect(step.overTarget).toBe(false)
  })

  it('flags a decided gate that ran past its target', () => {
    const rows = [row({
      /* Compliance review targets a same-day decision. */
      gate_name: 'Compliance review', gate_order: 6, status: 'cleared',
      submitted_at: '2024-09-23T00:00:00Z', reviewed_at: '2024-09-26T00:00:00Z',
    })]
    expect(buildJourney(rows, [], [])[0].overTarget).toBe(true)
  })

  it('does not flag a gate that decided inside its target', () => {
    const rows = [row({
      gate_name: 'KYC & due diligence', gate_order: 2, status: 'cleared',
      submitted_at: '2024-09-12T00:00:00Z', reviewed_at: '2024-09-14T00:00:00Z',
    })]
    expect(buildJourney(rows, [], [])[0].overTarget).toBe(false)
  })
})

describe('journeyProgress', () => {
  const seven = (currentOrder: number) => GATES.map(g => row({
    gate_name: g.name, gate_order: g.order,
    status: g.order < currentOrder ? 'cleared' : g.order === currentOrder ? 'current' : 'pending',
  }))

  it('counts cleared gates and names the current one', () => {
    const p = journeyProgress(buildJourney(seven(4), [], []))
    expect(p).toMatchObject({ cleared: 3, total: 7, complete: false })
    expect(p.current?.gate.id).toBe('finance')
    expect(p.failed).toBeNull()
  })

  it('reports complete with no current gate once every gate has cleared', () => {
    const p = journeyProgress(buildJourney(seven(8), [], []))
    expect(p).toMatchObject({ cleared: 7, complete: true })
    expect(p.current).toBeNull()
  })

  /* A stopped application is not an application in progress. */
  it('names the failed gate rather than reporting a current one', () => {
    const rows = seven(2).map(r => r.gate_order === 2 ? { ...r, status: 'failed' as const } : r)
    const p = journeyProgress(buildJourney(rows, [], []))
    expect(p.failed?.gate.id).toBe('kyc')
    expect(p.current).toBeNull()
    expect(p.complete).toBe(false)
  })
})

describe('evidenceChecklist', () => {
  const kyc = (fields: [string, string][], docs: GateDocument[], evidence: string[]) =>
    buildJourney(
      [row({ id: 'g2', gate_name: 'KYC & due diligence', gate_order: 2, status: 'cleared', evidence })],
      fields.length ? [sub('g2', fields)] : [], docs,
    )[0]

  it('ticks a demand met by a submitted field', () => {
    const step = kyc([['Adverse media', 'Nothing material found']], [], ['Adverse media check'])
    expect(evidenceChecklist(step)).toEqual([{ demand: 'Adverse media check', seen: true }])
  })

  /* The over-claim this keys on the longest word to avoid: "tax" appears in
     "Tax residency", so a first-word match ticked a certificate nobody sent. */
  it('does not tick a certificate just because a related field mentions the subject', () => {
    const step = kyc([['Tax residency', 'UAE'], ['Treaty certificate', 'Not yet supplied']], [],
      ['Tax residency certificate'])
    expect(evidenceChecklist(step)[0].seen).toBe(false)
  })

  it('ticks it once the document itself is attached', () => {
    const step = kyc([['Tax residency', 'UAE']], [doc('g2', 'Tax residency certificate')],
      ['Tax residency certificate'])
    expect(evidenceChecklist(step)[0].seen).toBe(true)
  })

  it('ignores punctuation when picking the word to match on', () => {
    const step = kyc([['Marketplace terms', 'Version 4.2, e-signed']], [], ['Marketplace terms, e-signed'])
    expect(evidenceChecklist(step)[0].seen).toBe(true)
  })

  /* A gate still under review carries fields whose value *is* the absence. */
  it('does not tick a field whose value says the thing has not happened', () => {
    const step = kyc([['Sanctions screening', 'Not started']], [], ['Sanctions and PEP screening'])
    expect(evidenceChecklist(step)[0].seen).toBe(false)
  })

  it('does not tick a field awaiting something', () => {
    const step = kyc([['Adverse media', 'Sent — awaiting the provider']], [], ['Adverse media check'])
    expect(evidenceChecklist(step)[0].seen).toBe(false)
  })

  /* "No match" opens with a negative and is a result, not an absence — the one
     case a bare leading "no" would get wrong. */
  it('still ticks a clean screening result that happens to start with "No"', () => {
    const step = kyc([['Sanctions screening', 'No match — OFAC, EU, UN, HMT']], [], ['Sanctions and PEP screening'])
    expect(evidenceChecklist(step)[0].seen).toBe(true)
  })

  it('ticks a demand met by an attached document', () => {
    const step = kyc([['Something else', 'x']], [doc('g2', 'Certificate of incorporation')],
      ['Certificate of incorporation'])
    expect(evidenceChecklist(step)[0].seen).toBe(true)
  })

  it('leaves a demand nothing answers unticked', () => {
    const step = kyc([['Adverse media', 'Nothing material found']], [], ['Sanctions and PEP screening'])
    expect(evidenceChecklist(step)[0].seen).toBe(false)
  })

  /* Nothing submitted is not the same as submitted-and-missing, but neither is
     a tick. A gate with no submission ticks nothing at all. */
  it('ticks nothing on a gate with no submission', () => {
    const step = buildJourney(
      [row({ id: 'g5', gate_name: 'Technical readiness', gate_order: 5, status: 'pending',
             evidence: ['Fulfilment webhook reachable'], submitted_at: null, submitted_by: null,
             reviewed_at: null, reviewed_by: null })],
      [], [],
    )[0]
    expect(evidenceChecklist(step)).toEqual([{ demand: 'Fulfilment webhook reachable', seen: false }])
  })
})

describe('deriveTaskState on a failed gate', () => {
  const failedKyc: GateRow[] = [
    { id: 'g1', partner_id: 'PTR-1014', gate_name: 'Application', gate_order: 1, status: 'cleared', notes: null, reviewed_by: null, reviewed_at: null },
    { id: 'g2', partner_id: 'PTR-1014', gate_name: 'KYC & due diligence', gate_order: 2, status: 'failed', notes: null, reviewed_by: null, reviewed_at: null },
  ]
  const task = (due: string | null): TaskRow => ({
    id: 'OB-1', partner_id: 'PTR-1014', gate_id: 'kyc', title: 't', detail: 'd',
    owner: 'Partner', due, closed_by: null, closed_at: null,
  })

  /* One task is the reason the gate failed; the rest never got their turn. */
  it('blocks the task the failure is about', () => {
    expect(deriveTaskState(task('Overdue'), failedKyc)).toBe('blocked')
  })

  it('leaves the others not started rather than chasing them', () => {
    expect(deriveTaskState(task(null), failedKyc)).toBe('not_started')
  })
})
