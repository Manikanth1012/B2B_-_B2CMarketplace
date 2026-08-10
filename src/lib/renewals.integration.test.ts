/* Touches the live Supabase project.
 *
 * Nothing in this build ever moved `next_renewal`. Three active monthly
 * subscriptions sat on 2026-08-09 until the calendar went past them, and an
 * active subscription renewing in the past is one that has quietly stopped
 * billing. The run that fixed that went too far the other way and renewed
 * everything — including the subscriptions a seller sells, whose renewals the
 * seller takes and reports. Rolling those dates on the seller's behalf asserted
 * renewals that may never have happened.
 *
 * Four claims:
 *
 *   - `plan` and `renew_subscriptions` agree about what is due, what is refused
 *     and what is somebody else's, checked against every subscription on file
 *     rather than a fixture
 *   - the run refuses a date in the future, is idempotent, says why it skipped
 *     somebody, and does not touch a date it does not own
 *   - a vendor can report a renewal, only their own, and a repeat is answered
 *     rather than charged twice
 *   - what nobody has reported is visible as work rather than as silence
 *
 * Everything written here is put back.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { supabase } from './supabase'
import { signIn, signOut } from './authRepo'
import { plan, chargeFor, skipReason, cycleLength, advance, ownedByMarketplace } from './renewals'
import type { Subscription } from './renewals'

const OPERATOR = { email: 'anika.sharma@aventa.com', password: 'operator123' }
/* Beacon Reseller Co, PTR-1009 — the one seller with a console login who also
   has subscriptions of their own to renew. */
const BEACON = { email: 'amara.okonkwo@example.com', password: 'partner123' }
const TODAY = new Date().toISOString().slice(0, 10)

describe('renewing a subscription when its date comes', () => {
  let subs: Subscription[]
  /* What this file moved, and back it goes. */
  const restore: { id: string; ref: string; next_renewal: string | null }[] = []
  const madeCharges: string[] = []

  beforeAll(async () => {
    await signIn(OPERATOR.email, OPERATOR.password)
    const [{ data, error }, prods] = await Promise.all([
      supabase.from('subscriptions').select('*'),
      supabase.from('products').select('id, partner_id'),
    ])
    expect(error, error?.message).toBeNull()
    const owner = new Map((prods.data ?? []).map(
      (p: { id: string; partner_id: string | null }) => [p.id, p.partner_id]))
    subs = ((data ?? []) as Record<string, unknown>[]).map(s => ({
      ...s, price: Number(s.price ?? 0), vendor: owner.get(String(s.product_id)) ?? null,
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

  /* The floor. With every subscription on one side of the split, every
     assertion below proves only half of what it says. */
  it('has subscriptions on both sides of the split', () => {
    const active = subs.filter(s => s.status === 'active')
    expect(active.filter(ownedByMarketplace).length,
      'nothing is ours to renew').toBeGreaterThan(0)
    expect(active.filter(s => !ownedByMarketplace(s)).length,
      'no seller renews anything, so the ownership rules are never exercised').toBeGreaterThan(0)
  })

  /* The original defect, restated as an invariant — and narrowed to what it was
     ever about. A vendor-maintained date in the past is not a stalled billing
     run; it is a seller who has not reported, which the chase list below is
     responsible for. */
  it('leaves no subscription we sell renewing in the past', () => {
    const late = subs
      .filter(s => s.status === 'active' && ownedByMarketplace(s) && s.next_renewal && s.next_renewal < TODAY)
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

  it('agrees with the database about who renews every subscription on file', async () => {
    const wrong: string[] = []
    for (const s of subs) {
      const { data } = await supabase.rpc('renewal_vendor', { p_product_id: s.product_id })
      const sql = (data as string | null) ?? null
      if (sql !== (s.vendor ?? null)) wrong.push(`${s.ref}: sql ${sql} vs ts ${s.vendor}`)
    }
    expect(wrong, wrong.join('; ')).toEqual([])
  }, 60_000)

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
    const target = subs.find(s =>
      s.status === 'active' && s.auto_renew && s.next_renewal && !s.ends_at && ownedByMarketplace(s))
    expect(target, 'no ordinary active subscription of ours to renew').toBeTruthy()
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
    /* Raised by us, and saying so. */
    expect(c!.source).toBe('marketplace')
    expect(c!.vendor_id).toBeNull()
    /* Nothing is taken here — it waits for the bill covering its period. */
    expect(c!.bill_id).toBeNull()

    /* And the date moved to the cycle they are actually in, on their own day. */
    const { data: after } = await supabase.from('subscriptions')
      .select('next_renewal').eq('id', s.id).maybeSingle()
    const next = String((after as { next_renewal: string }).next_renewal)
    expect(next > TODAY, `${s.ref} still renews on ${next}`).toBe(true)
    expect(next.slice(-2), 'the run walked the billing day').toBe(s.next_renewal!.slice(-2))
  }, 60_000)

  /* The correction. The run used to roll these too, which meant the
     marketplace's book claimed renewals nobody had taken. */
  it('does not charge or move a date a seller owns', async () => {
    const theirs = subs.filter(s => s.status === 'active' && !ownedByMarketplace(s))
    const dates = new Map(theirs.map(s => [s.ref, s.next_renewal]))

    const { data, error } = await supabase.rpc('renew_subscriptions', {
      p_as_of: TODAY, p_actor: 'integration test',
    })
    expect(error, error?.message).toBeNull()

    const { data: after } = await supabase.from('subscriptions')
      .select('ref, next_renewal').in('ref', [...dates.keys()])
    const moved = ((after ?? []) as { ref: string; next_renewal: string }[])
      .filter(r => String(r.next_renewal) !== String(dates.get(r.ref)))
      .map(r => `${r.ref} moved to ${r.next_renewal}`)
    expect(moved, moved.join('; ')).toEqual([])

    /* And nothing of theirs was raised by us. */
    const { data: charges } = await supabase.from('subscription_charge')
      .select('id, ref, source').eq('source', 'marketplace')
    const wrong = ((charges ?? []) as { ref: string }[])
      .filter(c => dates.has(c.ref)).map(c => c.ref)
    expect(wrong, `the run raised charges against ${wrong.join(', ')}`).toEqual([])

    /* It says what it is waiting for rather than passing over it in silence. */
    const out = data as { awaiting: { ref: string; vendor: string; reason: string }[] }
    for (const a of out.awaiting) {
      expect(a.ref, 'something is awaited with no subscription on it').toBeTruthy()
      expect(a.vendor, `${a.ref} is awaited with no vendor named`).toBeTruthy()
      expect(a.reason, `${a.ref} is awaited with no reason`).toBeTruthy()
    }
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

  /* And the module refuses the same ones, and waits on the same ones, in the
     same words, so a screen can say "this lapses on the 9th" before the date
     rather than after it. */
  it('agrees with the run about what does not renew and what is not ours', async () => {
    const { data } = await supabase.rpc('renew_subscriptions', {
      p_as_of: TODAY, p_actor: 'integration test',
    })
    const run = data as { awaiting: { ref: string }[] }
    const { data: fresh } = await supabase.from('subscriptions').select('*')
    const owner = new Map(subs.map(s => [s.product_id, s.vendor ?? null]))
    const now = ((fresh ?? []) as Record<string, unknown>[]).map(s => ({
      ...s, price: Number(s.price ?? 0), vendor: owner.get(String(s.product_id)) ?? null,
    })) as unknown as Subscription[]

    const p = plan(now, TODAY)
    for (const s of now) {
      const no = skipReason(s)
      const planned = p.charge.some(c => c.ref === s.ref)
      if (no && s.next_renewal && s.next_renewal <= TODAY) {
        expect(planned, `${s.ref} is ${no.kind} and was planned for charging`).toBe(false)
      }
      if (!ownedByMarketplace(s)) {
        expect(planned, `${s.ref} is renewed by its seller and was planned for charging`).toBe(false)
      }
    }
    expect([...p.awaiting.map(a => a.ref)].sort(),
      'the browser and the run disagree about who we are waiting on')
      .toEqual([...run.awaiting.map(a => a.ref)].sort())
  }, 60_000)

  /* What nobody has reported has to be visible, or the split just moves the
     silence somewhere else. */
  it('shows every unreported vendor cycle on the chase list, and nothing else', async () => {
    const { data, error } = await supabase.from('renewal_watch').select('*')
    expect(error, error?.message).toBeNull()
    const watch = (data ?? []) as { ref: string; vendor: string; days_late: number; band: string }[]

    const { data: run } = await supabase.rpc('renew_subscriptions', {
      p_as_of: TODAY, p_actor: 'integration test',
    })
    expect(watch.map(w => w.ref).sort())
      .toEqual((run as { awaiting: { ref: string }[] }).awaiting.map(a => a.ref).sort())

    for (const w of watch) {
      expect(w.vendor, `${w.ref} is being chased with no vendor to chase`).toBeTruthy()
      expect(w.days_late).toBeGreaterThanOrEqual(0)
      expect(['watch', 'chase', 'escalate']).toContain(w.band)
    }
  }, 30_000)

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

    /* And a customer cannot renew their own subscription by reporting it as
       though they were the seller. */
    const reported = await supabase.rpc('report_renewal', {
      p_ref: 'SUB-9102', p_period_start: TODAY, p_vendor_ref: 'nope', p_amount: 0,
    })
    expect(reported.error, 'a customer reported a renewal').not.toBeNull()

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

describe('a vendor reporting a renewal they took', () => {
  /* Beacon's own book, read and written as Beacon. Everything is put back. */
  let ref: string | null = null
  let due: string | null = null
  let cycle: string | null = null

  beforeAll(async () => {
    await signIn(BEACON.email, BEACON.password)
  }, 30_000)

  afterAll(async () => {
    await signOut()
    if (ref && due) {
      await signIn(OPERATOR.email, OPERATOR.password)
      await supabase.from('subscription_charge').delete().eq('vendor_ref', 'INTEGRATION-TEST')
      await supabase.rpc('set_renewal_date', { p_ref: ref, p_on: due })
    }
    await signOut()
  })

  it('gives the seller their own renewals, and only theirs', async () => {
    const { data, error } = await supabase.rpc('vendor_renewal_book', { p_partner: null })
    expect(error, error?.message).toBeNull()
    const rows = (data ?? []) as { ref: string; product_id: string; due: string; reported: boolean }[]
    expect(rows.length, 'the seller with the console login renews nothing, so this proves nothing')
      .toBeGreaterThan(0)

    /* The subscription, never the subscriber. */
    for (const r of rows) {
      expect(Object.keys(r)).not.toContain('user_id')
      expect(Object.keys(r)).not.toContain('customer')
    }

    /* Their own listings and no others. */
    const { data: mine } = await supabase.from('products').select('id').eq('partner_id', 'PTR-1009')
    const ours = new Set(((mine ?? []) as { id: string }[]).map(p => p.id))
    const strays = rows.filter(r => !ours.has(r.product_id)).map(r => r.ref)
    expect(strays, `a seller was shown ${strays.join(', ')}`).toEqual([])
  }, 30_000)

  /* The hole the book was written to avoid, opened a day later by a row-level
     policy on a table with a `user_id` column on every row. */
  it('cannot read the charge table itself, only what it reported', async () => {
    const { data } = await supabase.from('subscription_charge').select('user_id')
    expect((data ?? []).length,
      'a seller can read the customer ids on the charge table').toBe(0)

    const { data: mine, error } = await supabase.rpc('vendor_reported_charges', { p_partner: null })
    expect(error, error?.message).toBeNull()
    expect((mine ?? []).length, 'and cannot read what they did report').toBeGreaterThan(0)
  }, 30_000)

  it('refuses one another seller renews', async () => {
    /* SUB-9102 is Halo Audio's. Beacon may not report it. */
    const { error } = await supabase.rpc('report_renewal', {
      p_ref: 'SUB-9102', p_period_start: '2026-08-11', p_vendor_ref: 'INTEGRATION-TEST',
    })
    expect(error, 'a seller reported another seller\'s renewal').not.toBeNull()
    expect(error!.message).toMatch(/not by you/)
  }, 30_000)

  it('refuses a subscription the marketplace sells', async () => {
    const { error } = await supabase.rpc('report_renewal', {
      p_ref: 'SUB-9103', p_period_start: '2026-08-14', p_vendor_ref: 'INTEGRATION-TEST',
    })
    expect(error, 'a seller reported a renewal on a first-party line').not.toBeNull()
    expect(error!.message).toMatch(/sold by the marketplace/)
  }, 30_000)

  it('records the cycle, moves the date by exactly one, and answers a repeat', async () => {
    const { data } = await supabase.rpc('vendor_renewal_book', { p_partner: null })
    const rows = (data ?? []) as {
      ref: string; due: string; reported: boolean; price: number; currency: string; cycle: string
    }[]
    const outstanding = rows.find(r => !r.reported && r.due <= TODAY)
    expect(outstanding, 'Beacon has nothing outstanding, so the report path is never exercised').toBeTruthy()
    ref = outstanding!.ref
    due = outstanding!.due
    cycle = outstanding!.cycle

    const first = await supabase.rpc('report_renewal', {
      p_ref: ref, p_period_start: due, p_vendor_ref: 'INTEGRATION-TEST',
    })
    expect(first.error, first.error?.message).toBeNull()
    const one = first.data as { already: boolean; renews_next: string; amount: number }
    expect(one.already, 'a first report was treated as a repeat').toBe(false)
    /* Exactly one cycle, from the cycle reported — not from today. */
    expect(one.renews_next).toBe(advance(due, cycle))

    /* The charge is on file and carries the seller's own reference. Read
       through `vendor_reported_charges` because a seller has no read on the
       table itself — every row on it carries the customer's id, and row-level
       security restricts rows rather than columns. */
    const { data: reported } = await supabase.rpc('vendor_reported_charges', { p_partner: null })
    const c = ((reported ?? []) as Record<string, string>[])
      .find(r => r.ref === ref && r.period_start === due)
    expect(c, `nothing was recorded for ${ref} covering ${due}`).toBeTruthy()
    expect(c!.vendor_ref).toBe('INTEGRATION-TEST')
    expect(c!.bill_id, 'reporting a renewal took money').toBeNull()
    /* And the customer did not come with it. */
    expect(Object.keys(c!)).not.toContain('user_id')

    /* A retry from a vendor's own system is answered, not refused, and does not
       raise a second charge or move the date again. */
    const again = await supabase.rpc('report_renewal', {
      p_ref: ref, p_period_start: due, p_vendor_ref: 'INTEGRATION-TEST',
    })
    expect(again.error, again.error?.message).toBeNull()
    expect((again.data as { already: boolean }).already, 'a repeat was raised again').toBe(true)

    /* Read back through the book rather than off `subscriptions`: a seller has
       no select on that table at all, which is the point of the book existing.
       Querying it here returned nothing and reported success — the same
       row-level refusal that has caught this suite before. */
    const { data: reread } = await supabase.rpc('vendor_renewal_book', { p_partner: null })
    const now = ((reread ?? []) as { ref: string; due: string; reported: boolean }[])
      .find(r => r.ref === ref)
    expect(now, `${ref} fell out of the seller's own book`).toBeTruthy()
    expect(now!.due).toBe(advance(due, cycle))
    expect(now!.reported, 'the next cycle is already reported, so the roll went too far').toBe(false)
  }, 60_000)
})
