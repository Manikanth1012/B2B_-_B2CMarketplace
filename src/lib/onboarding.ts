/* The onboarding gate machine.
   Pure by design: no React, no Supabase, no I/O. Both the operator console and
   the partner console import this, which is what makes the rule one rule rather
   than two implementations that happen to agree today. */

export type GateStatus = 'cleared' | 'current' | 'pending'

export interface Gate {
  id: string
  name: string
  order: number
  owner: string
  targetDays: number
  dualControl: boolean
  waivable: boolean
}

export interface TechCheck {
  id: 'registered' | 'auth' | 'tested' | 'sandbox'
  label: string
  why: string
}

export interface Endpoint {
  id: string
  partner_id: string
  name: string
  url: string
  method: string
  auth: string
  enabled: boolean
  events: string[]
}

export interface TestCall {
  id: string
  endpoint_id: string
  status: 'sent' | 'acknowledged' | 'failed'
  called_at: string
}

export interface SandboxRun {
  id: string
  partner_id: string
  state: 'not_started' | 'running' | 'passed' | 'failed'
  ran_at: string | null
}

export interface TechStatus {
  checks: { registered: boolean; auth: boolean; tested: boolean; sandbox: boolean }
  missing: string[]
  noAuth: Endpoint[]
  untested: Endpoint[]
}

/* Gate names match the rows already seeded in onboarding_gates. */
export const GATES: Gate[] = [
  { id: 'apply',   name: 'Application',          order: 1, owner: 'Onboarding Desk', targetDays: 0, dualControl: false, waivable: true },
  { id: 'kyc',     name: 'KYC & due diligence',  order: 2, owner: 'Compliance',      targetDays: 3, dualControl: true,  waivable: false },
  { id: 'agree',   name: 'Agreements',           order: 3, owner: 'Legal',           targetDays: 1, dualControl: true,  waivable: false },
  { id: 'finance', name: 'Bank & tax',           order: 4, owner: 'Finance',         targetDays: 1, dualControl: true,  waivable: true },
  { id: 'tech',    name: 'Technical readiness',  order: 5, owner: 'Integrations',    targetDays: 0, dualControl: true,  waivable: false },
  { id: 'assure',  name: 'Compliance review',    order: 6, owner: 'Compliance',      targetDays: 0, dualControl: true,  waivable: true },
  { id: 'golive',  name: 'Go-live',              order: 7, owner: 'Onboarding Desk', targetDays: 0, dualControl: false, waivable: true },
]

/* Events a seller must be able to receive before going live. An event with
   nowhere to go is not queued and not retried — it does not arrive. */
export const REQUIRED_EVENTS = ['order.created', 'order.cancelled', 'stock.update']

/* Carried over from the prototype (_src/mp_shared.js:12711). The reasoning is
   shown in the UI, because a check whose purpose is invisible gets waived. */
export const TECH_CHECKS: TechCheck[] = [
  { id: 'registered', label: 'Endpoints registered for every required event',
    why: 'A required event with nowhere to go is not queued and not retried. It does not arrive.' },
  { id: 'auth', label: 'Every endpoint authenticates',
    why: 'Order payloads carry buyer data. An unauthenticated endpoint is a data leak with a URL.' },
  { id: 'tested', label: 'A signed test call acknowledged on each endpoint',
    why: 'Registration proves intent. An acknowledgement proves it works.' },
  { id: 'sandbox', label: 'One sandbox order completed end to end',
    why: 'The single requirement that removes most go-live failures.' },
]

const NO_AUTH = new Set(['', 'none'])

export function techStatus(
  endpoints: Endpoint[],
  calls: TestCall[],
  run: SandboxRun | null,
): TechStatus {
  const live = endpoints.filter(e => e.enabled)
  const covered = new Set(live.flatMap(e => e.events))
  const missing = REQUIRED_EVENTS.filter(ev => !covered.has(ev))
  const noAuth = live.filter(e => NO_AUTH.has((e.auth || '').trim().toLowerCase()))
  const acked = new Set(calls.filter(c => c.status === 'acknowledged').map(c => c.endpoint_id))
  const untested = live.filter(e => !acked.has(e.id))

  return {
    missing, noAuth, untested,
    checks: {
      registered: live.length > 0 && missing.length === 0,
      auth: live.length > 0 && noAuth.length === 0,
      tested: live.length > 0 && untested.length === 0,
      sandbox: run?.state === 'passed',
    },
  }
}

export function techReady(s: TechStatus): boolean {
  return TECH_CHECKS.every(c => s.checks[c.id])
}

export interface GateRow {
  id: string
  partner_id: string
  gate_name: string
  gate_order: number
  status: GateStatus
  notes: string | null
  reviewed_by: string | null
  reviewed_at: string | null
}

export interface TaskRow {
  id: string
  partner_id: string
  gate_id: string
  title: string
  detail: string
  owner: string
  due: string | null
  closed_by: string | null
  closed_at: string | null
}

export type ClearVerdict =
  | { ok: true }
  | { ok: false; reason: string; outstanding: TechCheck[] }

/* Rows carry the display name; the rules key off the stable id. */
export function gateIdFor(row: GateRow): string {
  return GATES.find(g => g.name === row.gate_name)?.id ?? ''
}

/* There is deliberately no override parameter. A caller cannot route around
   the technical gate because there is nothing to pass. */
export function canClearGate(gate: GateRow, all: GateRow[], tech: TechStatus): ClearVerdict {
  if (gate.status === 'cleared') {
    return { ok: false, reason: 'This gate is already cleared. Gates cannot be un-cleared — a partner that should not have progressed must be suspended instead.', outstanding: [] }
  }
  if (gate.status !== 'current') {
    return { ok: false, reason: 'This is not the current gate. Gates clear in order.', outstanding: [] }
  }
  if (gateIdFor(gate) === 'tech' && !techReady(tech)) {
    const outstanding = TECH_CHECKS.filter(c => !tech.checks[c.id])
    return {
      ok: false,
      outstanding,
      reason: `Technical readiness is not proved: ${outstanding.length} of ${TECH_CHECKS.length} checks outstanding. Each is verified against the seller's own endpoints. No override exists for this gate.`,
    }
  }
  return { ok: true }
}

export function nextGate(gate: GateRow, all: GateRow[]): GateRow | null {
  return all.find(g => g.gate_order === gate.gate_order + 1) ?? null
}

/* State is derived from the gate, never stored. A stored status is a second
   opinion that can contradict the gate it belongs to. */
export function deriveTaskState(task: TaskRow, gates: GateRow[]): 'done' | 'open' | 'not_started' {
  const gate = gates.find(g => gateIdFor(g) === task.gate_id)
  if (!gate) return 'not_started'
  if (gate.status === 'cleared') return 'done'
  if (gate.status === 'current') return 'open'
  return 'not_started'
}
