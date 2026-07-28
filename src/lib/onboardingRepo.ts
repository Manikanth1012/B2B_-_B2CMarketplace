/* The only module that talks to Supabase for onboarding. Components call this,
   never the client directly, so the rules in onboarding.ts sit on exactly one
   read path and one write path. */
import { supabase } from './supabase'
import { techStatus, canClearGate, nextGate, gateIdFor } from './onboarding'
import type { GateRow, TaskRow, Endpoint, TestCall, SandboxRun, TechStatus } from './onboarding'

export interface OnboardingSnapshot {
  gates: GateRow[]
  tasks: TaskRow[]
  endpoints: Endpoint[]
  calls: TestCall[]
  run: SandboxRun | null
  tech: TechStatus
  partnerName: string
}

export async function loadOnboarding(partnerId: string): Promise<OnboardingSnapshot> {
  const [gatesRes, tasksRes, epRes, partnerRes] = await Promise.all([
    supabase.from('onboarding_gates').select('*').eq('partner_id', partnerId).order('gate_order'),
    supabase.from('onboarding_tasks').select('*').eq('partner_id', partnerId),
    supabase.from('partner_endpoints').select('*').eq('partner_id', partnerId).order('id'),
    supabase.from('partners').select('id,name').eq('id', partnerId).maybeSingle(),
  ])

  const endpoints = (epRes.data ?? []) as Endpoint[]

  /* Test calls hang off endpoints, so they cannot be fetched until the endpoint
     ids are known. An empty `in` list matches nothing, so skip the round trip. */
  let calls: TestCall[] = []
  if (endpoints.length > 0) {
    const { data } = await supabase
      .from('endpoint_test_calls').select('*')
      .in('endpoint_id', endpoints.map(e => e.id))
    calls = (data ?? []) as TestCall[]
  }

  const { data: runRow } = await supabase
    .from('sandbox_runs').select('*').eq('partner_id', partnerId).maybeSingle()
  const run = (runRow ?? null) as SandboxRun | null

  return {
    gates: (gatesRes.data ?? []) as GateRow[],
    tasks: (tasksRes.data ?? []) as TaskRow[],
    endpoints, calls, run,
    tech: techStatus(endpoints, calls, run),
    partnerName: partnerRes.data?.name ?? partnerId,
  }
}

/* The operator's partner picker. */
export async function loadPartnerNames(): Promise<{ id: string; name: string }[]> {
  const { data } = await supabase
    .from('onboarding_gates')
    .select('partner_id, partner:partners(id,name)')
    .returns<{ partner_id: string; partner: { id: string; name: string } | null }[]>()
  const seen = new Map<string, string>()
  ;(data ?? []).forEach(r => {
    if (!seen.has(r.partner_id)) seen.set(r.partner_id, r.partner?.name ?? r.partner_id)
  })
  return [...seen].map(([id, name]) => ({ id, name }))
}

export type ClearResult =
  | { ok: true; snapshot: OnboardingSnapshot; auditWarning?: string }
  | { ok: false; reason: string }

/* Re-validates against freshly loaded state before writing. The operator's
   screen can be stale — another desk may have moved the partner on, or the
   seller may have disabled an endpoint since the panel rendered. The write
   path must not trust what the screen believed. */
export async function clearGate(
  { gateId, partnerId, evidence, actor }: { gateId: string; partnerId: string; evidence: string; actor: string },
): Promise<ClearResult> {
  if (!evidence.trim()) {
    return { ok: false, reason: 'An evidence note is required. Only clear a gate you have personally reviewed the evidence for.' }
  }

  const fresh = await loadOnboarding(partnerId)
  const gate = fresh.gates.find(g => g.id === gateId)
  if (!gate) return { ok: false, reason: 'That gate no longer exists.' }

  const verdict = canClearGate(gate, fresh.gates, fresh.tech)
  if (!verdict.ok) return { ok: false, reason: verdict.reason }

  const now = new Date().toISOString()

  const { error: clearErr } = await supabase.from('onboarding_gates')
    .update({ status: 'cleared', reviewed_by: actor, reviewed_at: now, notes: evidence })
    .eq('id', gate.id)
  if (clearErr) return { ok: false, reason: `Could not clear the gate: ${clearErr.message}` }

  const next = nextGate(gate, fresh.gates)
  if (next) {
    const { error } = await supabase.from('onboarding_gates').update({ status: 'current' }).eq('id', next.id)
    if (error) return { ok: false, reason: `Gate cleared, but the next gate could not be opened: ${error.message}` }
  }

  /* A cleared gate cannot keep open tasks. */
  {
    const { error } = await supabase.from('onboarding_tasks')
      .update({ closed_by: actor, closed_at: now })
      .eq('partner_id', partnerId).eq('gate_id', gateIdFor(gate)).is('closed_at', null)
    if (error) return { ok: false, reason: `Gate cleared, but its open tasks could not be closed: ${error.message}` }
  }

  /* Clearing the final gate publishes the storefront. */
  if (!next) {
    const { error } = await supabase.from('partners').update({ status: 'live' }).eq('id', partnerId)
    if (error) return { ok: false, reason: `Gate cleared, but the partner could not be published live: ${error.message}` }
  }

  /* The audit insert is handled differently from the writes above: by this
     point the state transition is already durable and there is no transaction
     to roll it back with. Returning ok:false here would tell the caller the
     clear didn't happen when it did — a worse lie than surfacing a warning
     alongside the success it actually is. */
  const { error: auditErr } = await supabase.from('operator_audit_log').insert({
    id: `AUD-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    actor, role: 'Marketplace operations',
    action: 'onboarding.gate.cleared',
    object: `${partnerId} · ${gate.gate_name}`,
    category: 'Onboarding', severity: 'info', outcome: 'success',
    before_val: gate.status, after_val: 'cleared',
  })

  const snapshot = await loadOnboarding(partnerId)
  if (auditErr) {
    return { ok: true, snapshot, auditWarning: `The gate was cleared but the audit entry could not be written: ${auditErr.message}` }
  }
  return { ok: true, snapshot }
}
