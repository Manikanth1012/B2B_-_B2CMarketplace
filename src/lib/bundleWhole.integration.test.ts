/* Touches the live Supabase project. Configures a bundle, raises it on a
 * requisition, tries to raise it on a second, builds a throwaway template —
 * and removes every row it wrote. No order and no payment is placed.
 *
 * 20261113100000_a_bundle_is_bought_whole.sql (spec 11, decisions 7 and 10):
 *   - a configured bundle goes on one live requisition (pending or approved):
 *     `z_one_requisition_per_selection` refuses it on a second;
 *   - a part that is not on sale blocks the bundle: a throwaway template whose
 *     option is the occupancy sensor (SKU-5004, paused since 20260805040000
 *     while its supplier is late) cannot be configured with it. The product is
 *     only read; its stock and status are never touched;
 *   - the night's helpers are not callable through the API by anybody signed
 *     in: `delete_unused_bundle_selections`, `subscription_renewal_price`,
 *     `run_nightly` (revoked from authenticated; only pg_cron runs them).
 *
 * Skipped, saying why, until the migration is applied: `subscriptions.
 * bundle_selection_id` is asked for, and a missing column means it is not
 * there yet. Any other error fails loudly.
 *
 * Sign-ins are rationed: operator (sweep, template), business buyer
 * (configure, raise, refusals, its own requisitions swept), operator
 * (selections and template removed).
 *
 * Clean-up, in afterAll and at the start in case a run died: the buyer deletes
 * every requisition whose title carries the marker (lines cascade); the
 * operator deletes every selection this run made or that sits on a marked
 * template, then every marked template. Every delete is checked.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { supabase } from './supabase'
import { signIn, signOut } from './authRepo'
import { defaultChoicesOnServer, configureBundle, saveTemplate, setTemplateStatus } from './bundleRepo'
import { loadAccount, raiseRequisition } from './enterpriseRepo'
import type { AccountBook, Draft } from './enterpriseRepo'
import type { SelectionLine } from './bundlePayload'
import type { BundleSlot } from './bundles'

const OPERATOR = { email: 'anika.sharma@aventa.com', password: 'operator123' }
const BUYER = { email: 'vikram.shah@smartbuild.in', password: 'enterprise123' }  // SmartBuild, ENT-2007, INR

const OFFICE = 'BT-SEED-OFFICE'
const MARKER = '[itest-bundlewhole]'
const SENSOR = 'SKU-5003'    // Nimbus Cold-chain sensor, live
const GATEWAY = 'SKU-5007'   // Volta IoT Gateway LTE-M, live
const PAUSED = 'SKU-5004'    // Nimbus Occupancy sensor, paused — only read

type Creds = { email: string; password: string }
let who = ''
async function as(c: Creds | null) {
  if (c && who === c.email) return
  await signOut()
  who = ''
  if (!c) return
  await signIn(c.email, c.password)   // throws when the login is refused
  who = c.email
}

const pause = (ms: number) => new Promise(r => setTimeout(r, ms))

let applied = false
let skipReason = ''
let pausedReady = false
let book: AccountBook
let templateId = ''
let sensorSlot = ''
let gatewaySlot = ''
const made = { selections: new Set<string>(), templates: new Set<string>() }

function skipUnlessApplied(ctx: { skip: () => void }) {
  if (!applied) {
    console.warn(skipReason)
    ctx.skip()
  }
}

/* ------------------------------------------------------------- clean-up -- */

/** As the buyer: every marked requisition (lines cascade). */
async function requisitionSweep() {
  await as(BUYER)
  const { data, error } = await supabase.from('enterprise_requisitions').select('id').like('title', `%${MARKER}%`)
  if (error) throw new Error(`could not list requisitions to sweep: ${error.message}`)
  for (const r of (data ?? []) as { id: string }[]) {
    const { data: gone, error: dErr } = await supabase.from('enterprise_requisitions').delete().eq('id', r.id).select('id')
    if (dErr) throw new Error(`could not sweep ${r.id}: ${dErr.message}`)
    if (!gone?.length) throw new Error(`sweeping ${r.id} removed nothing — it is still there`)
  }
}

/** As the operator: selections (made here, or on a marked template), then marked templates. */
async function operatorSweep() {
  await as(OPERATOR)
  const { data: tpls, error: tErr } = await supabase.from('bundle_templates').select('id').like('name', `${MARKER}%`)
  if (tErr) throw new Error(`could not list test templates: ${tErr.message}`)
  for (const t of (tpls ?? []) as { id: string }[]) {
    if (t.id.startsWith('BT-SEED-')) throw new Error(`refusing to sweep seed template ${t.id}`)
    made.templates.add(t.id)
  }
  if (made.templates.size) {
    const { data: sels } = await supabase.from('bundle_selections').select('id').in('template_id', [...made.templates])
    for (const s of (sels ?? []) as { id: string }[]) made.selections.add(s.id)
  }
  if (made.selections.size) {
    /* Nothing of this file's is ordered; refuse to delete a selection that is. */
    const { data: ordered } = await supabase.from('order_items').select('order_id').in('bundle_selection_id', [...made.selections])
    if ((ordered ?? []).length) throw new Error(`a test selection is on an order, which this file never places: ${JSON.stringify(ordered)}`)
    const { error } = await supabase.from('bundle_selections').delete().in('id', [...made.selections])
    if (error) throw new Error(`could not remove selections: ${error.message}`)
    const { data: left } = await supabase.from('bundle_selections').select('id').in('id', [...made.selections])
    if ((left ?? []).length) throw new Error(`selections left behind: ${JSON.stringify(left)}`)
    made.selections.clear()
  }
  for (const id of made.templates) {
    const { error } = await supabase.from('bundle_templates').delete().eq('id', id)
    if (error) throw new Error(`could not remove template ${id}: ${error.message}`)
  }
  const { data: leftT } = await supabase.from('bundle_templates').select('id').like('name', `${MARKER}%`)
  if ((leftT ?? []).length) throw new Error(`test templates left behind: ${JSON.stringify(leftT)}`)
  made.templates.clear()
}

/* ------------------------------------------------------- setup and close -- */

beforeAll(async () => {
  await as(OPERATOR)
  const { error } = await supabase.from('subscriptions').select('bundle_selection_id').limit(1)
  if (error) {
    if (/does not exist|could not find|schema cache/i.test(error.message)) {
      skipReason = 'Skipped: subscriptions has no bundle_selection_id, so 20261113100000_a_bundle_is_bought_whole.sql has not been applied yet.'
      return
    }
    throw new Error(`subscriptions could not be read: ${error.message}`)
  }
  applied = true

  /* Leftovers of a run that died: the buyer's requisitions first, so the
     selections they hold can go. */
  await requisitionSweep()
  await operatorSweep()

  /* The paused part is only ever read. If somebody has put it back on sale,
     the paused-part test says so and skips rather than pausing it. */
  const { data: p, error: pErr } = await supabase.from('products').select('id,status').eq('id', PAUSED).maybeSingle()
  if (pErr) throw new Error(`could not read ${PAUSED}: ${pErr.message}`)
  pausedReady = (p as { status?: string } | null)?.status === 'paused'

  if (pausedReady) {
    /* A throwaway enterprise template: sensors (the live one by default, the
       paused one offered beside it) and a gateway. Two fillable parts, so it
       can go on sale; the paused option is what a buyer must not get. */
    const r = await saveTemplate(
      { name: `${MARKER} Paused part kit`, description: 'Integration test template.', image: null,
        status: 'draft', audiences: ['enterprise'], discount_pct: 6 },
      [
        { label: 'Sensors', min_pick: 1, max_pick: 1, qty_min: 1, qty_max: 5, qty_default: 1, sort_order: 1,
          options: [{ product_id: SENSOR, is_default: true }, { product_id: PAUSED, is_default: false }] },
        { label: 'Gateway', min_pick: 1, max_pick: 1, qty_min: 1, qty_max: 1, qty_default: 1, sort_order: 2,
          options: [{ product_id: GATEWAY, is_default: true }] },
      ],
    )
    if (!r.ok) throw new Error(`the throwaway template was not saved: ${r.error}`)
    templateId = r.value
    made.templates.add(templateId)
    const pub = await setTemplateStatus(templateId, 'live')
    if (!pub.ok) throw new Error(`the throwaway template did not go on sale: ${pub.error}`)
    const { data: slots } = await supabase.from('bundle_slots').select('*').eq('template_id', templateId).order('sort_order')
    const s = (slots ?? []) as BundleSlot[]
    sensorSlot = s.find(x => x.label === 'Sensors')?.id ?? ''
    gatewaySlot = s.find(x => x.label === 'Gateway')?.id ?? ''
    if (!sensorSlot || !gatewaySlot) throw new Error('the throwaway template\'s slots could not be read back')
  }

  await as(BUYER)
  book = await loadAccount()
  expect(book.account, 'the buyer did not load an account').toBeTruthy()
  expect(book.me, 'the buyer is not on the account').toBeTruthy()
}, 180000)

afterAll(async () => {
  if (!applied) { await as(null); return }
  await requisitionSweep()
  const { data: left } = await supabase.from('enterprise_requisitions').select('id').like('title', `%${MARKER}%`)
  expect(left ?? [], 'test requisitions were left behind').toEqual([])
  await operatorSweep()
  await as(null)
}, 180000)

/* ================================================================ tests == */

describe('one configured bundle, one live requisition', () => {
  let sel = ''
  let lines: SelectionLine[] = []

  const draftOf = (title: string): Draft => ({
    title: `${title} ${MARKER}`,
    reason: 'Integration test: one bundle, one requisition.',
    currency: book.account!.currency, vertical: 'iot',
    cost_centre: book.centres[0]?.id ?? null, model: 'oneoff', po_ref: 'PO-ITEST-WHOLE',
    lines: lines.map(l => ({
      product_id: l.product_id, name: l.name, seller: l.seller, partner_id: l.partner_id,
      quantity: l.quantity, unit_price: l.unit_price, bundle_selection_id: sel,
    })),
  })
  const raise = (draft: Draft) => raiseRequisition({
    draft, me: book.me!, account: book.account!, policy: book.policy!,
    currencies: book.currencies, rates: book.rates,
  })
  const marked = async (title: string) => {
    const { data } = await supabase.from('enterprise_requisitions').select('id,state').eq('title', `${title} ${MARKER}`)
    return (data ?? []) as { id: string; state: string }[]
  }

  it('raises a configured office kit once, in pending', async (ctx) => {
    skipUnlessApplied(ctx)
    await as(BUYER)
    const d = await defaultChoicesOnServer(OFFICE)
    expect(d.ok, d.ok ? '' : d.error).toBe(true)
    const r = await configureBundle(OFFICE, d.ok ? d.value : {}, book.account!.currency, 1)
    expect(r.ok, r.ok ? '' : r.error).toBe(true)
    if (!r.ok) return
    sel = r.value.selection.id
    made.selections.add(sel)
    lines = r.value.lines

    const first = await raise(draftOf('First office kit'))
    expect(first.ok, first.ok ? '' : first.reason).toBe(true)
    const rows = await marked('First office kit')
    expect(rows.length).toBe(1)
    expect(rows[0].state).toBe('pending')
  }, 60000)

  it('refuses the same bundle on a second requisition, and leaves nothing of it', async (ctx) => {
    skipUnlessApplied(ctx)
    expect(sel, 'the first requisition was not raised').toBeTruthy()
    await pause(1100)   // requisition ids are minted from the second
    const second = await raise(draftOf('Second office kit'))
    expect(second.ok).toBe(false)
    if (!second.ok) {
      expect(second.reason).toMatch(/That bundle is already on requisition REQ-\S+, which is pending\. A configured bundle goes on one requisition/)
    }
    expect(await marked('Second office kit')).toEqual([])
    /* The first is untouched. */
    expect((await marked('First office kit')).map(r => r.state)).toEqual(['pending'])
  }, 60000)
})

describe('a part that is not on sale blocks the bundle', () => {
  it('will not configure the throwaway template with the paused sensor', async (ctx) => {
    skipUnlessApplied(ctx)
    if (!pausedReady) {
      console.warn(`Skipped: ${PAUSED} is not paused on this database, and this test never pauses a product.`)
      ctx.skip()
    }
    await as(BUYER)
    const r = await configureBundle(templateId, {
      [sensorSlot]: [{ product_id: PAUSED, quantity: 1 }],
      [gatewaySlot]: [{ product_id: GATEWAY, quantity: 1 }],
    }, book.account!.currency, 1)
    expect(r.ok, 'a bundle with a paused part was configured').toBe(false)
    if (!r.ok) expect(r.error).toMatch(/is not on sale at the moment, so it cannot be part of the bundle/)
    /* Nothing was written for it. */
    const { data } = await supabase.from('bundle_selections').select('id').eq('template_id', templateId)
    expect(data ?? []).toEqual([])
  }, 60000)

  it('configures the same template with the live sensor, so it is the paused part that blocked it', async (ctx) => {
    skipUnlessApplied(ctx)
    if (!pausedReady) ctx.skip()
    const r = await configureBundle(templateId, {
      [sensorSlot]: [{ product_id: SENSOR, quantity: 1 }],
      [gatewaySlot]: [{ product_id: GATEWAY, quantity: 1 }],
    }, book.account!.currency, 1)
    expect(r.ok, r.ok ? '' : r.error).toBe(true)
    if (r.ok) made.selections.add(r.value.selection.id)
  }, 60000)
})

describe("the night's helpers are not the API's", () => {
  /* A date long past, so that even a call that wrongly got through would find
     nothing to renew, expire or delete. */
  const LONG_AGO = '2000-01-01'

  it('a signed-in buyer cannot clear unused selections, price a renewal or run the night', async (ctx) => {
    skipUnlessApplied(ctx)
    await as(BUYER)
    const del = await supabase.rpc('delete_unused_bundle_selections', { p_as_of: LONG_AGO })
    expect(del.error, 'delete_unused_bundle_selections answered a signed-in buyer').not.toBeNull()
    expect(del.data ?? null).toBeNull()

    const price = await supabase.rpc('subscription_renewal_price', { p_sub: {}, p_on: LONG_AGO })
    expect(price.error, 'subscription_renewal_price answered a signed-in buyer').not.toBeNull()
    expect(price.data ?? null).toBeNull()

    const night = await supabase.rpc('run_nightly', { p_as_of: LONG_AGO })
    expect(night.error, 'run_nightly answered a signed-in buyer').not.toBeNull()
    expect(night.data ?? null).toBeNull()
  }, 60000)
})
