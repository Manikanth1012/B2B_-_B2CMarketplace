/* Touches the live Supabase project. Configures bundles, puts them in a basket,
 * orders them, raises them on requisitions, builds a template — and removes
 * every row it wrote.
 *
 * Spec 7 §5. Every rule under test lives in the database (price_bundle,
 * configure_bundle, the template, basket, requisition and order guards, RLS),
 * so it can only be checked against it. Each persona signs in for real and asks
 * the way its screen does (bundleRepo, bundleBasketRepo, raiseRequisition,
 * decideRequisition, releaseHold); where a test tries what no screen would
 * send, it writes to the table directly.
 *
 * Sign-ins are rationed (Supabase rate-limits them): signed out, operator,
 * shopper, business buyer, operator, business buyer — in that order, each
 * session reused for everything it can do.
 *
 * Clean-up, in afterAll and again at the start of a run in case one died:
 *   - orders: every one this file writes is tracked; a shopper's carries an
 *     `ORD-ITBUN-` reference, a business one the requisition it came from;
 *     removed as the operator (lines first), before the selections.
 *   - selections: tracked by id, plus any on an `[itest-bundles]` template;
 *     deleted as the operator — selection lines and basket lines cascade,
 *     requisition and order lines lose the link.
 *   - templates: every `[itest-bundles]` one, as the operator.
 *   - requisitions: title carries `[itest-bundles]`; removed by the business
 *     buyer, whose policy covers it (lines cascade).
 * BT-SEED-* templates are only ever read.
 *
 * Why the business order is placed from a test template and not the seed: the
 * seeded office kit's Connectivity part offers only IoT Connect SIMs, which are
 * fulfilled by the network (`fulfilment_route = 'telco-com'`). Ordering one
 * queues a `com_order`, and `guard_order_delete` then refuses to remove the
 * order ("a network fulfilment record refers to it"). An order this file cannot
 * remove is one it must not place, so the seed is raised on requisitions (never
 * approved) and the approve → order path runs on a test template of a sensor
 * and a gateway, both fulfilled by their sellers.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { supabase } from './supabase'
import { signIn, signOut } from './authRepo'
import {
  loadBundleBook, defaultChoicesOnServer, loadSelections, priceOnServer, configureBundle,
  saveTemplate, setTemplateStatus,
} from './bundleRepo'
import { putBundleInCart } from './bundleBasketRepo'
import { loadAccount, raiseRequisition, decideRequisition } from './enterpriseRepo'
import type { AccountBook, Draft } from './enterpriseRepo'
import { canDecide } from './enterprise'
import { releaseHold } from './creditRepo'
import {
  defaultChoices, priceBundle, bundleStanding,
  type BundleSlot, type BundleOption, type Choices, type PricedPart,
} from './bundles'
import type { SelectionLine } from './bundlePayload'

const OPERATOR = { email: 'anika.sharma@aventa.com', password: 'operator123' }
const SHOPPER = { email: 'priya.raman@example.com', password: 'demo1234' }      // INR, market IN
const BUYER = { email: 'vikram.shah@smartbuild.in', password: 'enterprise123' }  // SmartBuild, ENT-2007, INR

const HOME = 'BT-SEED-HOME'
const OFFICE = 'BT-SEED-OFFICE'
const MARKER = '[itest-bundles]'
const ORDER_PREFIX = 'ORD-ITBUN-'

/* Test template parts: both enterprise, both live, both fulfilled by their
   seller, both priced in every market currency. */
const SENSOR = 'SKU-5003'    // Nimbus Cold-chain sensor
const GATEWAY = 'SKU-5007'   // Volta IoT Gateway LTE-M

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

const pause = (ms: number) => new Promise(r => setTimeout(r, ms))
const cents = (n: unknown) => Math.round(Number(n) * 100)

/* Everything this run wrote, so the clean-up can find it however it ended. */
const made = {
  selections: new Set<string>(),
  orders: new Set<string>(),
  templates: new Set<string>(),
}

/* ------------------------------------------------------------- clean-up -- */

/** As the operator: orders, then selections, then templates. Each delete is
    checked; a sweep that cannot fail is not a sweep. */
async function operatorSweep() {
  await as(OPERATOR)

  const { data: tpls, error: tErr } = await supabase.from('bundle_templates').select('id,name').like('name', `${MARKER}%`)
  if (tErr) throw new Error(`could not list test templates: ${tErr.message}`)
  for (const t of (tpls ?? []) as { id: string }[]) {
    if (t.id.startsWith('BT-SEED-')) throw new Error(`refusing to sweep seed template ${t.id}`)
    made.templates.add(t.id)
  }
  if (made.templates.size) {
    const { data: sels } = await supabase.from('bundle_selections').select('id').in('template_id', [...made.templates])
    for (const s of (sels ?? []) as { id: string }[]) made.selections.add(s.id)
  }

  /* Orders: tracked, by our shopper reference, and any on our requisitions. */
  const { data: refOrders } = await supabase.from('orders').select('id').like('order_ref', `${ORDER_PREFIX}%`)
  for (const o of (refOrders ?? []) as { id: string }[]) made.orders.add(o.id)
  const { data: reqs } = await supabase.from('enterprise_requisitions').select('id').like('title', `%${MARKER}%`)
  const reqIds = ((reqs ?? []) as { id: string }[]).map(r => r.id)
  if (reqIds.length) {
    const { data: reqOrders } = await supabase.from('orders').select('id').in('requisition_id', reqIds)
    for (const o of (reqOrders ?? []) as { id: string }[]) made.orders.add(o.id)
  }
  if (made.selections.size) {
    const { data: items } = await supabase.from('order_items').select('order_id').in('bundle_selection_id', [...made.selections])
    for (const i of (items ?? []) as { order_id: string }[]) made.orders.add(i.order_id)
  }
  for (const id of made.orders) {
    const li = await supabase.from('order_items').delete().eq('order_id', id)
    if (li.error) throw new Error(`could not remove the lines of order ${id}: ${li.error.message}`)
    const o = await supabase.from('orders').delete().eq('id', id).select('id')
    if (o.error) throw new Error(`could not remove order ${id}: ${o.error.message}`)
  }
  if (made.orders.size) {
    const { data: leftOrders } = await supabase.from('orders').select('id').in('id', [...made.orders])
    if ((leftOrders ?? []).length) throw new Error(`orders left behind: ${JSON.stringify(leftOrders)}`)
  }
  made.orders.clear()

  if (made.selections.size) {
    const { error } = await supabase.from('bundle_selections').delete().in('id', [...made.selections])
    if (error) throw new Error(`could not remove selections: ${error.message}`)
    const { data: left } = await supabase.from('bundle_selections').select('id').in('id', [...made.selections])
    if ((left ?? []).length) throw new Error(`selections left behind: ${JSON.stringify(left)}`)
    made.selections.clear()
  }

  for (const id of made.templates) {
    if (id.startsWith('BT-SEED-')) throw new Error(`refusing to delete seed template ${id}`)
    const { error } = await supabase.from('bundle_templates').delete().eq('id', id)
    if (error) throw new Error(`could not remove template ${id}: ${error.message}`)
  }
  const { data: leftT } = await supabase.from('bundle_templates').select('id').like('name', `${MARKER}%`)
  if ((leftT ?? []).length) throw new Error(`test templates left behind: ${JSON.stringify(leftT)}`)
  made.templates.clear()
}

/** As the business buyer: every marked requisition (lines cascade). */
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

afterAll(async () => {
  await operatorSweep()
  await requisitionSweep()
  const { data: left } = await supabase.from('enterprise_requisitions').select('id').like('title', `%${MARKER}%`)
  expect(left ?? [], 'test requisitions were left behind').toEqual([])
  await as(null)
}, 120000)

/* ------------------------------------------------------------- helpers -- */

interface PriceRow { product_id: string; currency: string; price: number; floor_price: number | null }

/** The pure price of a configuration, from the price-book rows. */
function purePrice(slots: BundleSlot[], choices: Choices, prices: PriceRow[], currency: string, discount: number, qty: number) {
  const parts: PricedPart[] = []
  for (const s of [...slots].sort((a, b) => a.sort_order - b.sort_order || (a.id < b.id ? -1 : 1))) {
    for (const p of choices[s.id] ?? []) {
      const row = prices.find(r => r.product_id === p.product_id && r.currency === currency)
      if (!row) throw new Error(`${p.product_id} has no ${currency} price`)
      parts.push({
        product_id: p.product_id, list: Number(row.price),
        floor: row.floor_price == null ? null : Number(row.floor_price), quantity: p.quantity,
      })
    }
  }
  return priceBundle(parts, discount, qty)
}

/** Every line, the total and the saving, to the cent. */
function expectParity(
  server: { lines: (SelectionLine & { line_total?: unknown })[]; total: number; saving: number; parts_total: number },
  pure: ReturnType<typeof priceBundle>, what: string,
) {
  expect(server.lines.map(l => l.product_id), `${what}: the parts`).toEqual(pure.lines.map(l => l.product_id))
  pure.lines.forEach((p, i) => {
    const s = server.lines[i] as SelectionLine & { line_total?: unknown }
    expect(cents(s.quantity), `${what}: ${p.product_id} quantity`).toBe(cents(p.quantity))
    expect(cents(s.unit_price), `${what}: ${p.product_id} unit price`).toBe(cents(p.unit_price))
    expect(cents(s.line_total), `${what}: ${p.product_id} line total`).toBe(cents(p.line_total))
  })
  expect(cents(server.total), `${what}: total`).toBe(cents(pure.total))
  expect(cents(server.parts_total), `${what}: parts total`).toBe(cents(pure.parts_total))
  expect(cents(server.saving), `${what}: saving`).toBe(cents(pure.saving))
}

/** The raw price_bundle answer (line_total included, which asPriced drops). */
async function rawPrice(template: string, choices: Choices, currency: string, qty: number) {
  const { data, error } = await supabase.rpc('price_bundle', {
    p_template: template, p_choices: choices, p_currency: currency, p_quantity: qty,
  })
  expect(error, error?.message).toBeNull()
  const d = data as { lines: (SelectionLine & { line_total: unknown })[]; total: number; saving: number; parts_total: number }
  return d
}

/* ============================================================== reading === */

describe('who can see which bundle', () => {
  it('signed out: only the live consumer template, with its slots and options', async () => {
    await as(null)
    const book = await loadBundleBook()
    expect(book.loadError).toBeNull()
    expect(book.templates.map(t => t.id)).toContain(HOME)
    expect(book.templates.map(t => t.id)).not.toContain(OFFICE)
    for (const t of book.templates) {
      expect(t.status, `${t.id} is shown signed out`).toBe('live')
      expect(t.audiences).toContain('consumer')
    }
    const homeSlots = book.slots.filter(s => s.template_id === HOME)
    expect(homeSlots.length).toBe(3)
    expect(book.slots.some(s => s.template_id === OFFICE), 'office parts are visible signed out').toBe(false)
    const homeSlotIds = new Set(homeSlots.map(s => s.id))
    expect(book.options.filter(o => homeSlotIds.has(o.slot_id)).length).toBe(3)
    expect(book.options.every(o => book.slots.some(s => s.id === o.slot_id))).toBe(true)
  })

  it('signed out cannot price on the server', async () => {
    const { error } = await supabase.rpc('price_bundle', { p_template: HOME, p_choices: {}, p_currency: 'INR', p_quantity: 1 })
    expect(error, 'anon priced a bundle').not.toBeNull()
  })

  it('the operator sees both seeds and every part of them', async () => {
    await operatorSweep()   // leftovers of a run that died, before anything is written
    await as(OPERATOR)
    const book = await loadBundleBook()
    expect(book.loadError).toBeNull()
    const ids = book.templates.map(t => t.id)
    expect(ids).toContain(HOME)
    expect(ids).toContain(OFFICE)
    expect(book.slots.filter(s => s.template_id === OFFICE).length).toBe(3)
    expect(book.slots.filter(s => s.template_id === HOME).length).toBe(3)
  }, 60000)
})

/* ============================================================== pricing === */

describe('the server and the screen price a bundle the same', () => {
  let book: Awaited<ReturnType<typeof loadBundleBook>>
  let prices: PriceRow[]
  let currencies: string[]

  beforeAll(async () => {
    await as(OPERATOR)
    book = await loadBundleBook()
    const productIds = [...new Set(book.options.map(o => o.product_id))]
    const pr = await supabase.from('product_prices').select('product_id,currency,price,floor_price').in('product_id', productIds)
    expect(pr.error).toBeNull()
    prices = (pr.data ?? []) as PriceRow[]
    const mc = await supabase.from('market_currencies').select('currency')
    currencies = [...new Set(((mc.data ?? []) as { currency: string }[]).map(c => c.currency))].sort()
    expect(currencies.length).toBeGreaterThan(0)
  })

  for (const tid of [HOME, OFFICE]) {
    it(`${tid}: the default configuration, in every market currency`, async () => {
      const t = book.templates.find(x => x.id === tid)!
      const slots = book.slots.filter(s => s.template_id === tid)
      const options = book.options.filter(o => slots.some(s => s.id === o.slot_id))

      /* The server's starting point is the screen's. */
      const server = await defaultChoicesOnServer(tid)
      expect(server.ok, server.ok ? '' : server.error).toBe(true)
      const pure = defaultChoices(slots, options)
      expect(server.ok && server.value).toEqual(pure)

      for (const c of currencies) {
        const s = await rawPrice(tid, pure, c, 1)
        expectParity(s, purePrice(slots, pure, prices, c, t.discount_pct, 1), `${tid} default in ${c}`)
        expect(s.lines.every(l => Number(l.unit_price) >= Number(l.floor_unit_price ?? 0)), 'a part below its floor').toBe(true)
      }
    })

    it(`${tid}: second options, quantities at their maximum, two bundles`, async () => {
      const t = book.templates.find(x => x.id === tid)!
      const slots = book.slots.filter(s => s.template_id === tid).sort((a, b) => a.sort_order - b.sort_order)
      const options = book.options.filter(o => slots.some(s => s.id === o.slot_id))
      const choices: Choices = {}
      for (const s of slots) {
        const mine = options.filter(o => o.slot_id === s.id).sort((a, b) => a.sort_order - b.sort_order)
        const pick = mine[1] ?? mine[0]
        choices[s.id] = [{ product_id: pick.product_id, quantity: s.qty_max }]
      }
      /* A product offered in two slots (none in the seed) would be refused, so
         guard the test's own construction rather than the server's. */
      const all = Object.values(choices).flat().map(p => p.product_id)
      expect(new Set(all).size).toBe(all.length)
      for (const c of currencies) {
        const s = await rawPrice(tid, choices, c, 2)
        expectParity(s, purePrice(slots, choices, prices, c, t.discount_pct, 2), `${tid} non-default in ${c}`)
      }
    })
  }

  it('a floor is respected: a part whose discount would go under it is held at it', async () => {
    /* IoT Connect 500 MB in AED is listed at its floor, so any discount meets it. */
    const office = book.slots.filter(s => s.template_id === OFFICE)
    const conn = office.find(s => s.label === 'Connectivity')!
    const sensors = office.find(s => s.label === 'Sensors and trackers')!
    const choices: Choices = {
      [sensors.id]: [{ product_id: SENSOR, quantity: 5 }],
      [conn.id]: [{ product_id: 'SKU-5001', quantity: 5 }],
    }
    const s = await rawPrice(OFFICE, choices, 'AED', 1)
    const sim = s.lines.find(l => l.product_id === 'SKU-5001')! as SelectionLine & { at_floor?: boolean }
    expect(cents(sim.unit_price)).toBe(cents(sim.floor_unit_price))
    expect(sim.at_floor).toBe(true)
  })
})

/* ====================================================== template guards === */

describe('the operator builds a template, and the database holds it to the rule', () => {
  let tid = ''
  const base = {
    name: `${MARKER} Sensor and gateway kit`, description: 'Integration test template.', image: null,
    status: 'draft' as const, audiences: ['enterprise' as const], discount_pct: 6,
  }
  const sensorSlot = {
    label: 'Sensors', min_pick: 1, max_pick: 1, qty_min: 1, qty_max: 10, qty_default: 5, sort_order: 1,
    options: [{ product_id: SENSOR, is_default: true }],
  }
  const gatewaySlot = {
    label: 'Gateway', min_pick: 1, max_pick: 1, qty_min: 1, qty_max: 2, qty_default: 1, sort_order: 2,
    options: [{ product_id: GATEWAY, is_default: true }],
  }
  const slotsOf = async () => {
    const { data } = await supabase.from('bundle_slots').select('*').eq('template_id', tid).order('sort_order')
    return (data ?? []) as BundleSlot[]
  }

  beforeAll(async () => { await as(OPERATOR) })

  it('refuses a discount above the published cap', async () => {
    const r = await saveTemplate({ ...base, discount_pct: 25 }, [sensorSlot, gatewaySlot])
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/at most 18(\.00)?% off under the published rule, not 25(\.00)?%/)
    const { data } = await supabase.from('bundle_templates').select('id').like('name', `${MARKER}%`)
    expect(data ?? [], 'a refused create left a draft behind').toEqual([])
  })

  it('saves a draft with one part, and will not publish it', async () => {
    const r = await saveTemplate(base, [sensorSlot])
    expect(r.ok, r.ok ? '' : r.error).toBe(true)
    if (r.ok) { tid = r.value; made.templates.add(tid) }
    expect(tid).toMatch(/^BT-\d+$/)

    const pub = await setTemplateStatus(tid, 'live')
    expect(pub.ok).toBe(false)
    if (!pub.ok) {
      expect(pub.error).toMatch(/cannot go on sale: a bundle needs at least 2 parts that can be filled, and this one has 1\./)
    }
    const { data } = await supabase.from('bundle_templates').select('status').eq('id', tid).single()
    expect((data as { status: string }).status).toBe('draft')
  })

  it('publishes once the second part is there', async () => {
    const have = await slotsOf()
    const r = await saveTemplate({ ...base, id: tid }, [{ ...sensorSlot, id: have[0].id }, gatewaySlot])
    expect(r.ok, r.ok ? '' : r.error).toBe(true)
    const pub = await setTemplateStatus(tid, 'live')
    expect(pub.ok, pub.ok ? '' : pub.error).toBe(true)
  })

  it('refuses to change a part of a live template', async () => {
    const have = await slotsOf()
    const r = await saveTemplate({ ...base, id: tid, status: 'live' },
      [{ ...sensorSlot, id: have[0].id, label: 'Sensors, renamed' }, { ...gatewaySlot, id: have[1].id }])
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/Pause the bundle before changing its parts/)
    const after = await slotsOf()
    expect(after[0].label).toBe('Sensors')
    /* And a direct delete of an option is refused too. */
    const { error } = await supabase.from('bundle_options').delete().eq('slot_id', have[1].id)
    expect(error?.message).toMatch(/Pause the bundle before taking an option out of it/)
  })

  it('lets it be changed once paused, and published again', async () => {
    expect((await setTemplateStatus(tid, 'paused')).ok).toBe(true)
    const have = await slotsOf()
    const r = await saveTemplate({ ...base, id: tid, status: 'paused' },
      [{ ...sensorSlot, id: have[0].id, label: 'Cold-chain sensors' }, { ...gatewaySlot, id: have[1].id }])
    expect(r.ok, r.ok ? '' : r.error).toBe(true)
    expect((await slotsOf())[0].label).toBe('Cold-chain sensors')
    /* Live again: the business buyer configures from it below. */
    const pub = await setTemplateStatus(tid, 'live')
    expect(pub.ok, pub.ok ? '' : pub.error).toBe(true)
  })

  afterAll(() => { testTemplate.id = tid })
})

const testTemplate = { id: '' }

/* ============================================================ the shopper === */

describe('a shopper configures, baskets and orders the home bundle', () => {
  let uid = ''
  let selId = ''
  let lines: SelectionLine[] = []
  let market = { code: 'IN', tax_rate: 0 }
  const fulfil = new Map<string, string>()

  beforeAll(async () => {
    await as(SHOPPER)
    const { data: u } = await supabase.auth.getUser()
    uid = u.user!.id
    const { data: m } = await supabase.from('markets').select('code,tax_rate').eq('code', 'IN').single()
    market = { code: 'IN', tax_rate: Number((m as { tax_rate: number }).tax_rate) }
  }, 60000)

  it('sees the home bundle and not the office one', async () => {
    const book = await loadBundleBook()
    expect(book.templates.map(t => t.id)).toContain(HOME)
    expect(book.templates.map(t => t.id)).not.toContain(OFFICE)
  })

  it('is refused a selection in a currency their account is not kept in', async () => {
    const d = await defaultChoicesOnServer(HOME)
    expect(d.ok).toBe(true)
    const r = await configureBundle(HOME, d.ok ? d.value : {}, 'USD', 1)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe('Your account is kept in INR, so the bundle is priced in INR, not USD.')
  })

  it('configures it in their home currency, at the price the server quotes, held seven days', async () => {
    const d = await defaultChoicesOnServer(HOME)
    expect(d.ok).toBe(true)
    const choices = d.ok ? d.value : {}
    const quote = await priceOnServer(HOME, choices, 'INR', 1)
    expect(quote.ok, quote.ok ? '' : quote.error).toBe(true)

    const r = await configureBundle(HOME, choices, 'INR', 1)
    expect(r.ok, r.ok ? '' : r.error).toBe(true)
    if (!r.ok) return
    selId = r.value.selection.id
    made.selections.add(selId)
    lines = r.value.lines
    expect(r.value.selection.currency).toBe('INR')
    expect(lines.length).toBeGreaterThanOrEqual(2)
    if (quote.ok) {
      expect(cents(r.value.selection.total)).toBe(cents(quote.value.total))
      expect(lines.map(l => cents(l.unit_price))).toEqual(quote.value.lines.map(l => cents(l.unit_price)))
    }
    const held = Date.parse(r.value.selection.valid_until) - Date.parse(r.value.selection.priced_at)
    expect(held).toBe(7 * 24 * 3600 * 1000)

    const { data: p } = await supabase.from('products').select('id,fulfil').in('id', lines.map(l => l.product_id))
    for (const x of (p ?? []) as { id: string; fulfil: string }[]) fulfil.set(x.id, x.fulfil)
  })

  it('reads its own selection back with its lines', async () => {
    const r = await loadSelections([selId])
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.value.selections.map(s => s.id)).toEqual([selId])
      expect(r.value.lines.length).toBe(lines.length)
    }
  })

  /* ---- the basket ---- */

  it('refuses one part on its own, at commit, and leaves nothing', async () => {
    const one = lines[0]
    const { error } = await supabase.from('cart_items')
      .insert({ product_id: one.product_id, quantity: one.quantity, bundle_selection_id: selId }).select('id')
    expect(error, 'a lone bundle part went into the basket').not.toBeNull()
    expect(error!.message).toMatch(new RegExp(`A bundle goes into the basket whole: 1 of its ${lines.length} parts are there`))
    const { data } = await supabase.from('cart_items').select('id').eq('bundle_selection_id', selId)
    expect(data ?? []).toEqual([])
  })

  it('refuses a part at the wrong quantity', async () => {
    const rows = lines.map((l, i) => ({
      product_id: l.product_id, quantity: i === 0 ? l.quantity + 1 : l.quantity, bundle_selection_id: selId,
    }))
    const { error } = await supabase.from('cart_items').insert(rows).select('id')
    expect(error).not.toBeNull()
    expect(error!.message).toMatch(new RegExp(`That bundle has ${lines[0].quantity} of .*, not ${lines[0].quantity + 1}\\.`))
    const { data } = await supabase.from('cart_items').select('id').eq('bundle_selection_id', selId)
    expect(data ?? []).toEqual([])
  })

  it('takes the whole bundle in one insert, the way the screen sends it', async () => {
    const r = await putBundleInCart(selId)
    expect(r.ok, r.ok ? '' : r.error).toBe(true)
    const { data } = await supabase.from('cart_items').select('product_id,quantity').eq('bundle_selection_id', selId)
    expect(((data ?? []) as { product_id: string }[]).map(x => x.product_id).sort())
      .toEqual(lines.map(l => l.product_id).sort())
  })

  /* ---- the orders, as checkout writes them: one per seller ---- */

  const order = async (seller: string, total: number) => {
    const res = await supabase.from('orders').insert({
      order_ref: `${ORDER_PREFIX}${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      seller, status: 'awaiting_payment', total, subtotal: total, tax: 0, discount: 0,
      currency: 'INR', market: market.code, tax_rate: market.tax_rate,
      payment_method: 'card', buyer_name: 'Priya Raman', buyer_email: SHOPPER.email,
      shipping_address: { address: 'Integration test', city: 'Bengaluru', country: 'IN' }, user_id: uid,
    }).select('id').single()
    expect(res.error, res.error?.message).toBeNull()
    const id = (res.data as { id: string }).id
    made.orders.add(id)
    return id
  }
  const item = (orderId: string, l: SelectionLine, over: { price?: number } = {}) => ({
    order_id: orderId, product_id: l.product_id, product_name: l.name,
    price: over.price ?? l.unit_price, quantity: l.quantity,
    fulfil: fulfil.get(l.product_id) ?? 'instant', status: 'placed', bundle_selection_id: selId,
  })
  const shopperOrders: string[] = []

  it('refuses a bundle part at a price that is not the selection\'s', async () => {
    const l = lines[0]
    const oid = await order(l.seller, l.unit_price)
    shopperOrders.push(oid)
    const { error } = await supabase.from('order_items').insert(item(oid, l, { price: l.list_unit_price })).select('id')
    expect(error, 'a bundle part was ordered at its shelf price').not.toBeNull()
    expect(error!.message).toMatch(/is priced at .* in that bundle, not /)
  })

  it('orders each seller\'s part at the selection price while the basket holds the rest', async () => {
    /* The first seller's order already exists (the refused line left it empty). */
    const [first, ...rest] = lines
    const a = await supabase.from('order_items').insert(item(shopperOrders[0], first)).select('id')
    expect(a.error, a.error?.message).toBeNull()
    for (const l of rest) {
      const oid = await order(l.seller, Number(l.unit_price) * l.quantity)
      shopperOrders.push(oid)
      const r = await supabase.from('order_items').insert(item(oid, l)).select('id')
      expect(r.error, r.error?.message).toBeNull()
    }
    const { data } = await supabase.from('order_items').select('product_id,price,quantity,bundle_selection_id')
      .in('order_id', shopperOrders)
    const got = (data ?? []) as { product_id: string; price: number; quantity: number; bundle_selection_id: string }[]
    expect(got.length).toBe(lines.length)
    for (const l of lines) {
      const g = got.find(x => x.product_id === l.product_id)!
      expect(g.bundle_selection_id).toBe(selId)
      expect(cents(g.price)).toBe(cents(l.unit_price))
      expect(g.quantity).toBe(l.quantity)
    }
  })

  it('refuses to order the same part again', async () => {
    const l = lines[0]
    const oid = await order(l.seller, l.unit_price)
    shopperOrders.push(oid)
    const { error } = await supabase.from('order_items').insert(item(oid, l)).select('id')
    expect(error, 'a bundle part was ordered twice at the bundle price').not.toBeNull()
    expect(error!.message).toMatch(/from that bundle has already been ordered/)
  })

  it('removes its orders, as checkout undoes them', async () => {
    for (const id of shopperOrders) {
      const { data, error } = await supabase.from('orders').delete().eq('id', id).select('id')
      expect(error, error?.message).toBeNull()
      expect(data?.length, `order ${id} was not removed`).toBe(1)
      made.orders.delete(id)
    }
    const { data } = await supabase.from('order_items').select('id').in('order_id', shopperOrders)
    expect(data ?? [], 'order lines outlived their orders').toEqual([])
  })

  it('takes the whole bundle out when one part is removed', async () => {
    const { error } = await supabase.from('cart_items').delete()
      .eq('bundle_selection_id', selId).eq('product_id', lines[0].product_id)
    expect(error).toBeNull()
    const { data } = await supabase.from('cart_items').select('id').eq('bundle_selection_id', selId)
    expect(data ?? [], 'the rest of the bundle stayed in the basket').toEqual([])
  })

  afterAll(() => { shopperSelection.id = selId })
})

const shopperSelection = { id: '' }

/* ===================================================== the business buyer === */

describe('a business buyer raises bundles on requisitions', () => {
  let book: AccountBook
  let officeSel = ''
  let officeLines: SelectionLine[] = []
  let kitSel = ''
  let kitLines: SelectionLine[] = []
  let kitReq = ''

  beforeAll(async () => {
    await as(BUYER)
    await requisitionSweep()
    book = await loadAccount()
    expect(book.account, 'the buyer did not load an account').toBeTruthy()
    expect(book.me, 'the buyer is not on the account').toBeTruthy()
  }, 60000)

  it('sees the office bundle and not the home one', async () => {
    const b = await loadBundleBook()
    expect(b.templates.map(t => t.id)).toContain(OFFICE)
    expect(b.templates.map(t => t.id)).not.toContain(HOME)
    expect(b.slots.filter(s => s.template_id === OFFICE).length).toBe(3)
  })

  it('cannot read the shopper\'s selection', async () => {
    expect(shopperSelection.id).toBeTruthy()
    const r = await loadSelections([shopperSelection.id])
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.value.selections).toEqual([])
      expect(r.value.lines).toEqual([])
    }
  })

  it('cannot configure the shopper\'s bundle', async () => {
    const r = await configureBundle(HOME, {}, 'INR', 1)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/not on sale at the moment|not sold to enterprise buyers|no bundle/i)
  })

  it('configures the office bundle for the account, in the account currency', async () => {
    const d = await defaultChoicesOnServer(OFFICE)
    expect(d.ok).toBe(true)
    const r = await configureBundle(OFFICE, d.ok ? d.value : {}, book.account!.currency, 1)
    expect(r.ok, r.ok ? '' : r.error).toBe(true)
    if (!r.ok) return
    officeSel = r.value.selection.id
    made.selections.add(officeSel)
    officeLines = r.value.lines
    expect(officeLines.length).toBe(2)
  })

  const draftOf = (title: string, lines: SelectionLine[], sel: string, over: Partial<{ unit: (l: SelectionLine) => number }> = {}): Draft => ({
    title: `${title} ${MARKER}`,
    reason: 'Integration test of configured bundles.',
    currency: book.account!.currency, vertical: 'iot',
    cost_centre: book.centres[0]?.id ?? null, model: 'oneoff', po_ref: 'PO-ITEST-BUNDLES',
    lines: lines.map(l => ({
      product_id: l.product_id, name: l.name, seller: l.seller, partner_id: l.partner_id,
      quantity: l.quantity, unit_price: over.unit ? over.unit(l) : l.unit_price, bundle_selection_id: sel,
    })),
  })
  const raise = (draft: Draft) => raiseRequisition({
    draft, me: book.me!, account: book.account!, policy: book.policy!,
    currencies: book.currencies, rates: book.rates,
  })
  const marked = async (title: string) => {
    const { data } = await supabase.from('enterprise_requisitions').select('id,amount,state,need').eq('title', `${title} ${MARKER}`)
    return (data ?? []) as { id: string; amount: number; state: string; need: string }[]
  }

  it('is refused part of a bundle, and nothing is left raised', async () => {
    const r = await raise(draftOf('Partial office kit', officeLines.slice(0, 1), officeSel))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(new RegExp(`A bundle goes onto a requisition whole: 1 of its ${officeLines.length} parts are there`))
    expect(await marked('Partial office kit')).toEqual([])
  })

  it('is refused a bundle part at a price that is not the selection\'s', async () => {
    await pause(1100)   // requisition ids are minted from the second
    const r = await raise(draftOf('Repriced office kit', officeLines, officeSel, { unit: l => l.list_unit_price }))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/is priced at .* in that bundle, not /)
    expect(await marked('Repriced office kit')).toEqual([])
  })

  it('raises the whole bundle in one insert, through the app\'s own path', async () => {
    await pause(1100)
    const r = await raise(draftOf('Office kit', officeLines, officeSel))
    expect(r.ok, r.ok ? '' : r.reason).toBe(true)
    const rows = await marked('Office kit')
    expect(rows.length).toBe(1)
    const { data } = await supabase.from('enterprise_requisition_lines')
      .select('product_id,quantity,unit_price,bundle_selection_id').eq('requisition_id', rows[0].id)
    const got = (data ?? []) as { product_id: string; quantity: number; unit_price: number; bundle_selection_id: string }[]
    expect(got.length).toBe(officeLines.length)
    for (const l of officeLines) {
      const g = got.find(x => x.product_id === l.product_id)!
      expect(g.bundle_selection_id).toBe(officeSel)
      expect(cents(g.unit_price)).toBe(cents(l.unit_price))
    }
    const sum = officeLines.reduce((n, l) => n + cents(l.unit_price) * l.quantity, 0)
    expect(cents(rows[0].amount)).toBe(sum)
  })

  it('configures and raises the test kit, within policy', async () => {
    expect(testTemplate.id, 'the template test did not leave a live template').toBeTruthy()
    const d = await defaultChoicesOnServer(testTemplate.id)
    expect(d.ok, d.ok ? '' : d.error).toBe(true)
    const r = await configureBundle(testTemplate.id, d.ok ? d.value : {}, book.account!.currency, 1)
    expect(r.ok, r.ok ? '' : r.error).toBe(true)
    if (!r.ok) return
    kitSel = r.value.selection.id
    made.selections.add(kitSel)
    kitLines = r.value.lines
    expect(kitLines.map(l => l.product_id)).toEqual([SENSOR, GATEWAY])

    await pause(1100)
    const raised = await raise(draftOf('Sensor kit', kitLines, kitSel))
    expect(raised.ok, raised.ok ? '' : raised.reason).toBe(true)
    const rows = await marked('Sensor kit')
    expect(rows.length).toBe(1)
    kitReq = rows[0].id
    expect(rows[0].need).toBe('none')
  })

  it('confirms it (within policy, so the raiser may), and it is approved', async () => {
    const fresh = await loadAccount()
    const req = fresh.requisitions.find(r => r.id === kitReq)!
    expect(req).toBeTruthy()
    const can = canDecide(req, fresh.me!, fresh.policy!)
    expect(can.ok, can.ok ? '' : can.reason).toBe(true)
    const res = await decideRequisition({
      req, me: fresh.me!, policy: fresh.policy!, approve: true,
      note: 'Approved for the bundles integration test.', currency: fresh.account!.currency, rates: fresh.rates,
    })
    expect(res.ok, res.ok ? '' : res.reason).toBe(true)
    const { data } = await supabase.from('enterprise_requisitions').select('state,credit_hold,order_ref').eq('id', kitReq).single()
    const row = data as { state: string; credit_hold: boolean; order_ref: string | null }
    expect(row.state).toBe('approved')
    kitOrder.held = !!row.credit_hold
    kitOrder.ref = row.order_ref
    kitOrder.req = kitReq
    kitOrder.sel = kitSel
    kitOrder.lines = kitLines
  })
})

const kitOrder: { req: string; sel: string; held: boolean; ref: string | null; lines: SelectionLine[] } = {
  req: '', sel: '', held: false, ref: null, lines: [],
}

/* ========================================== the order a requisition becomes === */

describe('the approved requisition becomes one order carrying the bundle', () => {
  beforeAll(async () => { await as(OPERATOR) })

  it('goes to the sellers — on release, when the account is held on credit', async () => {
    expect(kitOrder.req, 'nothing was approved above').toBeTruthy()
    if (kitOrder.held) {
      /* SmartBuild is over its credit limit, so approving holds; the
         marketplace's release is what places the order, through
         place_requisition_order. */
      const res = await releaseHold(kitOrder.req, 'Anika Sharma', 'Integration test — bundles; released against a cleared payment.')
      expect(res.ok, res.why).toBe(true)
      expect(res.why).toMatch(/gone to the seller/i)
    }
    const { data: orders } = await supabase.from('orders').select('id,order_ref,total,currency,account_id,seller')
      .eq('requisition_id', kitOrder.req)
    const os = (orders ?? []) as { id: string; order_ref: string; total: number; currency: string; account_id: string; seller: string | null }[]
    for (const o of os) made.orders.add(o.id)
    expect(os.length).toBe(1)
    expect(os[0].account_id).toBe('ENT-2007')
    /* Two sellers' parts on one order: it names none. */
    expect(os[0].seller).toBeNull()

    const { data: items } = await supabase.from('order_items').select('product_id,price,quantity,bundle_selection_id')
      .eq('order_id', os[0].id)
    const got = (items ?? []) as { product_id: string; price: number; quantity: number; bundle_selection_id: string }[]
    expect(got.length).toBe(kitOrder.lines.length)
    for (const l of kitOrder.lines) {
      const g = got.find(x => x.product_id === l.product_id)!
      expect(g, `${l.product_id} is not on the order`).toBeTruthy()
      expect(g.bundle_selection_id).toBe(kitOrder.sel)
      expect(cents(g.price)).toBe(cents(l.unit_price))
      expect(g.quantity).toBe(l.quantity)
    }
    expect(cents(os[0].total)).toBe(kitOrder.lines.reduce((n, l) => n + cents(l.unit_price) * l.quantity, 0))
  })
})

/* ============================================================ expiry === */

describe('an expired selection', () => {
  /* A selection is held seven days from `now()` and nothing a client may do
     back-dates one (configure_bundle stamps both instants), so an expired one
     cannot be made in a test without waiting a week. The rule the guards apply
     — `valid_until < now()`, instant against instant — is the one
     `bundleStanding` mirrors, so that is what is asserted here. The seven-day
     hold itself is asserted on a real selection above. */
  const lines = [{ product_id: 'SKU-5005', name: 'TrackWise Asset Tracker Pro' }]
  it('is refused once its hold has passed, even earlier the same day', () => {
    expect(bundleStanding({ valid_until: '2026-11-11T08:00:00Z' }, lines, '2026-11-11T08:00:01Z', () => true))
      .toEqual({ kind: 'expired' })
    expect(bundleStanding({ valid_until: '2026-11-11T08:00:00Z' }, lines, '2026-11-11T08:00:00Z', () => true))
      .toEqual({ kind: 'ok' })
    expect(bundleStanding({ valid_until: 'not a date' }, lines, '2026-11-11T08:00:00Z', () => true))
      .toEqual({ kind: 'expired' })
  })
})
