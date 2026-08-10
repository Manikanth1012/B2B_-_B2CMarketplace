/* Touches the live Supabase project.
 *
 * Nothing in this build ever moved `next_renewal`. Three active monthly
 * subscriptions sat on 2026-08-09 until the calendar went past them, and an
 * active subscription renewing in the past is one that has quietly stopped
 * billing — the customer's screen shows a date that has been and gone and
 * nothing has charged them for the month they are using.
 *
 * Three claims:
 *
 *   - `plan` and `renew_subscriptions` agree about what is due and what is
 *     refused, checked against every subscription on file rather than a fixture
 *   - the run refuses a date in the future, is idempotent, and says why it
 *     skipped somebody — the three things that go wrong with a job like this
 *   - it actually charges and rolls, run rather than asserted about
 *
 * Everything written here is put back.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { supabase } from './supabase'
import { signIn, signOut } from './authRepo'
import { plan, chargeFor, skipReason, cycleLength, advance } from './renewals'
import type { Subscription } from './renewals'

const OPERATOR = { email: 'anika.sharma@aventa.com', password: 'operator123' }
const TODAY = new Date().toISOString().slice(0, 10)

describe('renewing a subscription when its date comes', () => {
  let subs: Subscription[]
  /* What this file moved, and back it goes. */
  const restore: { id: string; ref: string; next_renewal: string | null }[] = []
  const madeCharges: string[] = []

  beforeAll(async () => {
    await signIn(OPERATOR.email, OPERATOR.password)
    const { data, error } = await supabase.from('subscriptions').select('*')
    expect(error, error?.message).toBeNull()
    subs = ((data ?? []) as Record<string, unknown>[]).map(s => ({
      ...s, price: Number(s.price ?? 0),
    })) as unknown as Subscription[]
    expect(subs.length).toBeGreaterThan(0)
  }, 30_000)

  afterAll(async () => {
    await signIn(OPERATOR.email, OPERATOR.password)
    for (const id of madeCharges) {
      await supabase.from('subscription_charge').delete().eq('id', id)
    }
    for (const r of restore) {
      if (r.next_renewal) await supabase.rpc('set_renewal_date', { p_ref: r.ref, p_on: r.next_renewal })
    }
    await signOut()
  })

  /* The defect, restated as an invariant. */
  it('leaves no active subscription renewing in the past', () => {
    const late = subs.filter(s => s.status === 'active' && s.next_renewal && s.next_renewal < TODAY)
      .map(s => `${s.ref} renews ${s.next_renewal}`)
    expect(late, late.join('; ')).toEqual([])
  })

  it('gives every active subscription a date and a cycle to move it by', () => {
    const bad = subs.filter(s => s.status === 'active')
      .filter(s => !s.next_renewal || !s.cycle)
      .map(s => `${s.ref} has ${s.next_renewal ? 'no cycle' : 'no renewal date'}`)
    expect(bad, bad.join('; ')).toEqual([])
  })

  /* Two evaluations of one rule. */
  it('agrees with the database about how long every cycle is', async () => {
    const wrong: string[] = []
    for (const c of new Set(subs.map(s => s.cycle))) {
      const { data, error } = await supabase.rpc('cycle_length', { p_cycle: c })
      expect(error, error?.message).toBeNull()
      if (Number(data) !== cycleLength(c)) {
        wrong.push(`${c}: sql ${data} vs ts ${cycleLength(c)}`)
      }
    }
    expect(wrong, wrong.join('; ')).toEqual([])
  }, 30_000)

  it('refuses a run dated into the future, before it writes anything', async () => {
    const before = await supabase.from('subscription_charge').select('id')
    const ahead = new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10)
    const { error } = await supabase.rpc('renew_subscriptions', {
      p_as_of: ahead, p_actor: 'integration test',
    })
    expect(error, 'a renewal run was allowed to charge for a period nobody has used').not.toBeNull()
    expect(error!.message).toMatch(/charging for nothing/)

    const after = await supabase.from('subscription_charge').select('id')
    expect((after.data ?? []).length).toBe((before.data ?? []).length)
  })

  /* Charge, roll, and put it all back. */
  it('charges the cycle, moves the date, and keeps the billing day', async () => {
    const target = subs.find(s => s.status === 'active' && s.auto_renew && s.next_renewal && !s.ends_at)
    expect(target, 'no ordinary active subscription to renew').toBeTruthy()
    const s = target!
    restore.push({ id: s.id, ref: s.ref, next_renewal: s.next_renewal })

    /* Wound back one whole cycle so the run has something due today. Whole
       cycles rather than an arbitrary past date, so the billing day this test
       asserts on is the one the customer actually agreed to.

       Through `set_renewal_date` rather than a direct update: `subscriptions`
       is writable only by the person who owns the row, so an operator's update
       matches nothing, writes nothing and reports success — which is how the
       first version of this test came to assert against a run that had had
       nothing to do. */
    const wound = advance(s.next_renewal!, s.cycle, -1)
    const set = await supabase.rpc('set_renewal_date', { p_ref: s.ref, p_on: wound })
    expect(set.error, set.error?.message).toBeNull()
    const check = await supabase.from('subscriptions')
      .select('next_renewal').eq('id', s.id).maybeSingle()
    expect(String((check.data as { next_renewal: string }).next_renewal),
      'the wind-back wrote nothing, so the run would have had nothing due').toBe(wound)

    const mine = chargeFor({ ...s, next_renewal: wound })!
    const { data, error } = await supabase.rpc('renew_subscriptions', {
      p_as_of: TODAY, p_actor: 'integration test',
    })
    expect(error, error?.message).toBeNull()
    const out = data as { charged: number; already: number; rolled: number; skipped: unknown[] }
    expect(out.rolled, 'the run rolled nothing').toBeGreaterThan(0)

    /* The charge is on file, for the cycle that started — not for today. */
    const { data: row } = await supabase.from('subscription_charge')
      .select('*').eq('subscription_id', s.id).eq('period_start', wound).maybeSingle()
    const c = row as Record<string, string> | null
    expect(c, `nothing was charged for ${s.ref} covering ${wound}`).toBeTruthy()
    madeCharges.push(String(c!.id))
    expect(c!.period_end).toBe(mine.period_end)
    expect(Number(c!.amount)).toBe(mine.amount)
    expect(c!.currency).toBe(s.currency)
    /* Nothing is taken here — it waits for the bill covering its period. */
    expect(c!.bill_id).toBeNull()

    /* And the date moved to the cycle they are actually in, on their own day. */
    const { data: after } = await supabase.from('subscriptions')
      .select('next_renewal').eq('id', s.id).maybeSingle()
    const next = String((after as { next_renewal: string }).next_renewal)
    expect(next > TODAY, `${s.ref} still renews on ${next}`).toBe(true)
    expect(next.slice(-2), 'the run walked the billing day').toBe(s.next_renewal!.slice(-2))
  }, 60_000)

  /* A second run finds the first run's charges rather than raising them twice. */
  it('is idempotent', async () => {
    const before = await supabase.from('subscription_charge').select('id')
    const { data, error } = await supabase.rpc('renew_subscriptions', {
      p_as_of: TODAY, p_actor: 'integration test',
    })
    expect(error, error?.message).toBeNull()
    expect((data as { charged: number }).charged, 'a second run charged again').toBe(0)

    const after = await supabase.from('subscription_charge').select('id')
    expect((after.data ?? []).length).toBe((before.data ?? []).length)
  }, 30_000)

  /* "Four were skipped" is not something anybody can act on. */
  it('names every subscription it skipped and why', async () => {
    const { data } = await supabase.rpc('renew_subscriptions', {
      p_as_of: TODAY, p_actor: 'integration test',
    })
    for (const s of (data as { skipped: Record<string, string>[] }).skipped) {
      expect(s.ref, 'a skip with no subscription on it').toBeTruthy()
      expect(s.reason, `${s.ref} was skipped with no reason`).toBeTruthy()
    }
  })

  /* And the module refuses the same ones, in the same words, so a screen can
     say "this lapses on the 9th" before the date rather than after it. */
  it('agrees with the run about what does not renew', () => {
    const p = plan(subs, TODAY)
    for (const s of subs) {
      const no = skipReason(s)
      const planned = p.charge.some(c => c.ref === s.ref)
      if (no && s.next_renewal && s.next_renewal <= TODAY) {
        expect(planned, `${s.ref} is ${no.kind} and was planned for charging`).toBe(false)
      }
    }
  })

  /* Definer rights were the point — `subscriptions` is writable only by its
     owner and a run writes everybody's — and the missing persona check was the
     hole. A consumer could have run the billing job for the whole marketplace. */
  it('lets only the marketplace run it', async () => {
    await signOut()
    await signIn('priya.raman@example.com', 'demo1234')
    const { error } = await supabase.rpc('renew_subscriptions', {
      p_as_of: TODAY, p_actor: 'a customer',
    })
    expect(error, 'a customer ran the renewal job').not.toBeNull()
    expect(error!.message).toMatch(/Only the marketplace/)

    const moved = await supabase.rpc('set_renewal_date', { p_ref: 'SUB-9102', p_on: TODAY })
    expect(moved.error, 'a customer moved a billing date').not.toBeNull()

    await signOut()
    await signIn(OPERATOR.email, OPERATOR.password)
  }, 30_000)

  it('shows a customer only their own charges', async () => {
    await signOut()
    await signIn('priya.raman@example.com', 'demo1234')
    const { data } = await supabase.from('subscription_charge').select('user_id')
    const seen = new Set(((data ?? []) as { user_id: string }[]).map(r => r.user_id))
    expect(seen.size, 'a customer can see more than one person\'s charges').toBeLessThanOrEqual(1)
    await signOut()
    await signIn(OPERATOR.email, OPERATOR.password)
  }, 30_000)
})
