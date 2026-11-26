/* Touches the live Supabase project. Reads only: nothing is written, no order
 * or payment is placed, and every function called as someone who may not call
 * it is given arguments that would change nothing even if it wrongly worked.
 *
 * 20261113600000_orders_and_accounts_are_scored_for_risk.sql (spec 13):
 *   - the operator reads the 17 seeded rules and the two band settings (40/70);
 *   - a shopper and a business buyer read nothing of order_risk, account_risk,
 *     risk_rules, risk_settings or risk_rule_changes;
 *   - a shopper cannot decide a held order, tune a rule, set the bands or
 *     refresh account scores;
 *   - the operator deciding an order that is not held is refused;
 *   - a seller reads no held order.
 *
 * Skipped, saying why, until the migration is applied: `risk_rules` is asked
 * for, and a missing relation means it is not there yet.
 *
 * Sign-ins: operator, shopper, business buyer, seller, operator.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { supabase } from './supabase'
import { signIn, signOut } from './authRepo'

const OPERATOR = { email: 'anika.sharma@aventa.com', password: 'operator123' }
const SHOPPER = { email: 'priya.raman@example.com', password: 'demo1234' }
const BUYER = { email: 'vikram.shah@smartbuild.in', password: 'enterprise123' }
const SELLER = { email: 'rajesh.kumar@nimbussensors.com', password: 'partner123' }

type Creds = { email: string; password: string }
let who = ''
async function as(c: Creds | null) {
  if (c && who === c.email) return
  await signOut()
  who = ''
  if (!c) return
  await signIn(c.email, c.password)
  who = c.email
}

let applied = false
const skipUnlessApplied = (ctx: { skip: () => void }) => {
  if (!applied) {
    console.warn('Skipped: there is no risk_rules table, so 20261113600000_orders_and_accounts_are_scored_for_risk.sql has not been applied yet.')
    ctx.skip()
  }
}

const RULE_IDS = [
  'o-account-review', 'o-account-high', 'o-new-account', 'o-first-order', 'o-big-order', 'o-sim-line',
  'o-sim-new-address', 'o-guest', 'o-failed-payments', 'o-burst', 'o-carrier-emi',
  'a-refunds', 'a-disputes', 'a-failed-payments', 'a-bursts', 'a-over-credit', 'a-overdue',
]
const TABLES = ['order_risk', 'account_risk', 'risk_rules', 'risk_settings', 'risk_rule_changes'] as const

beforeAll(async () => {
  await as(OPERATOR)
  const { error } = await supabase.from('risk_rules').select('id').limit(1)
  if (error) {
    if (/does not exist|could not find|schema cache/i.test(error.message)) return
    throw new Error(`risk_rules could not be read: ${error.message}`)
  }
  applied = true
}, 60000)
afterAll(async () => { await as(null) }, 30000)

describe('the operator reads the risk rules and bands', () => {
  it('sees the 17 seeded rules', async (ctx) => {
    skipUnlessApplied(ctx)
    await as(OPERATOR)
    const { data, error } = await supabase.from('risk_rules').select('id, applies, points, enabled')
    expect(error).toBeNull()
    expect((data ?? []).map(r => r.id).sort()).toEqual([...RULE_IDS].sort())
  }, 60000)

  it('sees the bands, 40 and 70 for orders and for accounts', async (ctx) => {
    skipUnlessApplied(ctx)
    await as(OPERATOR)
    const { data, error } = await supabase.from('risk_settings').select('kind, review_at, hold_at').order('kind')
    expect(error).toBeNull()
    expect(data).toEqual([
      { kind: 'account', review_at: 40, hold_at: 70 },
      { kind: 'order', review_at: 40, hold_at: 70 },
    ])
  }, 60000)

  it('refuses to decide an order that is not held', async (ctx) => {
    skipUnlessApplied(ctx)
    await as(OPERATOR)
    const { error } = await supabase.rpc('decide_held_order', { p_order_ref: 'ORD-NOPE', p_decision: 'release', p_note: 'test' })
    expect(error, 'a decision on an order that does not exist was accepted').not.toBeNull()
  }, 60000)
})

describe.each([['a shopper', SHOPPER], ['a business buyer', BUYER]] as const)('%s', (_n, creds) => {
  it('reads nothing of the risk tables', async (ctx) => {
    skipUnlessApplied(ctx)
    await as(creds)
    for (const t of TABLES) {
      const { data, error } = await supabase.from(t).select('*').limit(5)
      /* A permission error and an empty result both mean "cannot read". */
      if (!error) expect(data ?? [], `${t} was readable`).toEqual([])
    }
  }, 60000)
})

describe('a shopper cannot use the operator\'s risk functions', () => {
  it('cannot decide a held order', async (ctx) => {
    skipUnlessApplied(ctx)
    await as(SHOPPER)
    const { error } = await supabase.rpc('decide_held_order', { p_order_ref: 'ORD-NOPE', p_decision: 'release', p_note: 'test' })
    expect(error).not.toBeNull()
  }, 60000)

  it('cannot tune a rule', async (ctx) => {
    skipUnlessApplied(ctx)
    await as(SHOPPER)
    const { error } = await supabase.rpc('update_risk_rule', { p_id: 'o-first-order', p_points: 10, p_enabled: true, p_threshold: null })
    expect(error).not.toBeNull()
  }, 60000)

  it('cannot set the bands', async (ctx) => {
    skipUnlessApplied(ctx)
    await as(SHOPPER)
    const { error } = await supabase.rpc('set_risk_bands', { p_kind: 'order', p_review_at: 40, p_hold_at: 70 })
    expect(error).not.toBeNull()
  }, 60000)

  it('cannot refresh account scores', async (ctx) => {
    skipUnlessApplied(ctx)
    await as(SHOPPER)
    const { error } = await supabase.rpc('refresh_account_risk', {})
    expect(error).not.toBeNull()
  }, 60000)
})

describe('a held order is hidden from sellers', () => {
  it('shows a seller no order whose status is held', async (ctx) => {
    skipUnlessApplied(ctx)
    await as(SELLER)
    const { data, error } = await supabase.from('orders').select('order_ref').eq('status', 'held')
    expect(error).toBeNull()
    expect(data ?? []).toEqual([])
  }, 60000)
})
