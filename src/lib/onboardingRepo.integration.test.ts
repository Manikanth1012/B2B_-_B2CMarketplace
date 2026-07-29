/* Touches the live Supabase project. It owns only the rows it creates under
   PTR-TEST and never reads or mutates the demo partners.

   Runs as the operator. Since the scoped-RLS migrations landed, the partner-scoped
   tables answer only to `partner_id = current_partner_id()` or to the operator, and
   the demo partner persona is PTR-1004 — it could not see PTR-TEST at all. The
   operator is the persona that legitimately reaches every partner's onboarding. */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { supabase } from './supabase'
import { signIn, signOut } from './authRepo'
import { loadOnboarding, clearGate, registerEndpoint, setEndpointAuth, sendTestCall, runSandboxOrder } from './onboardingRepo'
import { GATES } from './onboarding'

const PID = 'PTR-TEST'
const OPERATOR = { email: 'anika.sharma@aventa.com', password: 'operator123' }

async function teardown() {
  const { data: eps } = await supabase.from('partner_endpoints').select('id').eq('partner_id', PID)
  for (const e of eps ?? []) await supabase.from('endpoint_test_calls').delete().eq('endpoint_id', e.id)
  await supabase.from('partner_endpoints').delete().eq('partner_id', PID)
  await supabase.from('sandbox_runs').delete().eq('partner_id', PID)
  await supabase.from('onboarding_tasks').delete().eq('partner_id', PID)
  await supabase.from('onboarding_gates').delete().eq('partner_id', PID)
  await supabase.from('partners').delete().eq('id', PID)
  /* clearGate writes one audit row per gate cleared, keyed `${partnerId} · ${gate_name}`.
     Those rows are deliberately left behind: the scoped-RLS migration gives
     operator_audit_log no DELETE policy for any role, because a hash-chained log that
     can be edited is decoration. Nothing here asserts on the table's size, and every
     row carries a unique id, so they accumulate harmlessly. */
}

beforeAll(async () => {
  await signIn(OPERATOR.email, OPERATOR.password)
  await teardown()
  /* Upsert instead of insert so a second run doesn't 23505 on the primary key, and
     reset status so a prior run ending at 'live' doesn't leak into this one's
     assertions. */
  const { error: partnerErr } = await supabase.from('partners')
    .upsert({ id: PID, name: 'Integration Test Co', type: 'IoT hardware', status: 'onboarding' })
  if (partnerErr) throw new Error(`Could not seed PTR-TEST partner: ${partnerErr.message}`)
  const { error: gatesErr } = await supabase.from('onboarding_gates').insert(GATES.map(g => ({
    id: `og-${PID}-${g.order}`, partner_id: PID, gate_name: g.name, gate_order: g.order,
    status: g.order === 1 ? 'current' : 'pending', owner: g.owner, target_days: g.targetDays,
    dual_control: g.dualControl, waivable: g.waivable, evidence: [], sort_order: g.order,
  })))
  if (gatesErr) throw new Error(`Could not seed PTR-TEST gates: ${gatesErr.message}`)

  /* Without a task on an early gate, the task-closing UPDATE in clearGate
     matches zero rows on every clear in this suite and a broken gateIdFor
     mapping would still leave the suite green. Seed one on 'apply' so
     closing it is actually exercised and asserted below. */
  const { error: taskErr } = await supabase.from('onboarding_tasks').insert({
    id: `OB-${PID}-apply`, partner_id: PID, gate_id: 'apply',
    title: 'Submit the application form', detail: 'Baseline application details.', owner: 'You', due: null,
  })
  if (taskErr) throw new Error(`Could not seed PTR-TEST task: ${taskErr.message}`)
})

afterAll(async () => {
  await teardown()
  await signOut()
})

describe('onboarding round trip', () => {
  it('refuses to clear without evidence', async () => {
    const s = await loadOnboarding(PID)
    const res = await clearGate({ gateId: s.gates[0].id, partnerId: PID, evidence: '  ', actor: 'test' })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.reason).toMatch(/evidence note is required/i)
  })

  it('walks apply through to the technical gate', async () => {
    for (const order of [1, 2, 3, 4]) {
      const s = await loadOnboarding(PID)
      const gate = s.gates.find(g => g.gate_order === order)!
      const res = await clearGate({ gateId: gate.id, partnerId: PID, evidence: `cleared ${order}`, actor: 'test' })
      expect(res.ok).toBe(true)
    }
    const s = await loadOnboarding(PID)
    expect(s.gates.find(g => g.gate_order === 5)!.status).toBe('current')

    /* Clearing 'apply' (order 1) must have closed the task seeded on it. This
       is the only assertion in either suite that the task-closing write in
       clearGate actually matched and updated a row. */
    const task = s.tasks.find(t => t.id === `OB-${PID}-apply`)
    expect(task).toBeTruthy()
    expect(task!.closed_by).toBe('test')
    expect(task!.closed_at).not.toBeNull()
  })

  it('refuses the technical gate until all four checks pass', async () => {
    const s = await loadOnboarding(PID)
    const tech = s.gates.find(g => g.gate_order === 5)!
    const refused = await clearGate({ gateId: tech.id, partnerId: PID, evidence: 'trust me', actor: 'test' })
    expect(refused.ok).toBe(false)
    if (!refused.ok) expect(refused.reason).toMatch(/no override/i)

    expect((await registerEndpoint(PID, 'Fulfilment', 'https://x.test/f', ['order.created', 'order.cancelled', 'stock.update'])).ok).toBe(true)
    const withEp = await loadOnboarding(PID)
    expect(withEp.tech.checks.registered).toBe(true)
    expect(withEp.tech.checks.auth).toBe(false)

    expect((await setEndpointAuth(withEp.endpoints[0].id, 'HMAC-SHA256')).ok).toBe(true)
    expect((await sendTestCall(withEp.endpoints[0].id)).ok).toBe(true)
    expect((await runSandboxOrder(PID)).ok).toBe(true)

    const ready = await loadOnboarding(PID)
    expect(ready.tech.checks).toEqual({ registered: true, auth: true, tested: true, sandbox: true })

    const allowed = await clearGate({ gateId: tech.id, partnerId: PID, evidence: 'all four verified', actor: 'test' })
    expect(allowed.ok).toBe(true)
  })

  it('publishes the partner when the final gate clears', async () => {
    for (const order of [6, 7]) {
      const s = await loadOnboarding(PID)
      const gate = s.gates.find(g => g.gate_order === order)!
      expect((await clearGate({ gateId: gate.id, partnerId: PID, evidence: `cleared ${order}`, actor: 'test' })).ok).toBe(true)
    }
    const { data } = await supabase.from('partners').select('status').eq('id', PID).single()
    expect(data!.status).toBe('live')
  })
})
