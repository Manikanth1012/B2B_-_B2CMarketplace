/* The only module that talks to Supabase for onboarding. Components call this,
   never the client directly, so the rules in onboarding.ts sit on exactly one
   read path and one write path. */
import { supabase } from './supabase'
import { techStatus } from './onboarding'
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
