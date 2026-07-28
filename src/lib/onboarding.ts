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
