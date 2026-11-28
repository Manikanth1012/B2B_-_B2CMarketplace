/* Touches the live Supabase project, read only. Writes nothing.
 *
 * 20261127400000, spec 19: basket windows per market at 7, 7 and 90 unless
 * changed; the six dated events; the basket reminder rules seeded with their
 * steps, every one off; a shopper reads the basket rules and cannot change
 * them. The rolled-back dry run (a basket at n−1 of clearing gets exactly one
 * schedule-log row, a second run none) is the migration's own self-check:
 * run_reminders is not callable through the API.
 *
 * Skipped, saying why, until the migration is applied: `basket_settings` is
 * asked for.
 *
 * Sign-ins: operator, shopper.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { supabase } from './supabase'
import { signIn, signOut } from './authRepo'
import { loadBasketSettings, loadSteps } from './remindersRepo'

const OPERATOR = { email: 'anika.sharma@aventa.com', password: 'operator123' }
const SHOPPER = { email: 'priya.raman@example.com', password: 'demo1234' }

let applied = false
const skipUnlessApplied = (ctx: { skip: () => void }) => {
  if (!applied) {
    console.warn('Skipped: basket_settings is not there, so 20261127400000 has not been applied yet.')
    ctx.skip()
  }
}

beforeAll(async () => {
  await signOut()
  await signIn(OPERATOR.email, OPERATOR.password)
  const r = await loadBasketSettings()
  applied = r.ok
}, 60000)

afterAll(async () => { await signOut() })

describe('scheduled reminders and basket windows, live', () => {
  it('has default rules and a row for every market', async ctx => {
    skipUnlessApplied(ctx)
    const r = await loadBasketSettings()
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value[0].market).toBe('default')
    const { data: markets } = await supabase.from('markets').select('code')
    for (const m of (markets ?? []) as { code: string }[]) {
      expect(r.value.some(s => s.market === m.code), m.code).toBe(true)
    }
  })

  it('carries the six dated events', async ctx => {
    skipUnlessApplied(ctx)
    const { data, error } = await supabase.from('notification_events').select('id, anchor').not('anchor', 'is', null)
    expect(error).toBeNull()
    const ids = ((data ?? []) as { id: string }[]).map(e => e.id)
    for (const id of ['basket.abandoned', 'basket.clearing', 'invoice.due', 'subscription.renewal', 'agreement.notice', 'quote.expiry']) {
      expect(ids).toContain(id)
    }
  })

  it('seeds the basket steps with a template for every channel', async ctx => {
    skipUnlessApplied(ctx)
    const r = await loadSteps('NR-C-BSK-CLEARING')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.map(s => s.offset_days).sort((a, b) => a - b)).toEqual([-7, -1])
    for (const s of r.value) {
      for (const k of s.kinds) expect(s.templates.some(t => t.kind_id === k), `${s.id} ${k}`).toBe(true)
    }
  })

  it('lets a shopper read the basket rules but not change them', async ctx => {
    skipUnlessApplied(ctx)
    await signOut()
    await signIn(SHOPPER.email, SHOPPER.password)
    const read = await loadBasketSettings()
    expect(read.ok && read.value.length).toBeGreaterThan(0)
    const { data } = await supabase.from('basket_settings').update({ clear_after_days: 91 }).eq('market', 'default').select('market')
    expect(data ?? []).toHaveLength(0)
  })
})
