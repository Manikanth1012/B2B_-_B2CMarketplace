/* Touches the live Supabase project. Reads, and pushes one order line.
 *
 * The payload is built twice: once by `com_payload` in the database, from the
 * mapping table, inside the transaction that records the push; and once here in
 * `missingFor`, so a screen can say what would happen before anybody presses
 * anything. Two evaluations of one published mapping are only safe while
 * something reconciles them.
 *
 * The rest is about the data the rules run against. A queue with only happy
 * rows in it has never been looked at under load, and every state below is one
 * a support agent will be asked about.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { supabase } from './supabase'
import { signIn, signOut } from './authRepo'
import { loadComBook, previewPayload, loadContext, pushOrder, loadPushesFor } from './comRepo'
import type { ComBook } from './comRepo'
import {
  mappingFor, mappingProblems, missingFor, unacknowledged, retryable, explain,
  queueHealth, workOrder, inFlight, STATE_MEANING,
} from './com'

const OPERATOR = { email: 'anika.sharma@aventa.com', password: 'operator123' }

let book: ComBook
const NOW = new Date().toISOString()

beforeAll(async () => {
  await signIn(OPERATOR.email, OPERATOR.password)
  book = await loadComBook()
  expect(book.loadError, book.loadError ?? '').toBeUndefined()
})

afterAll(async () => { await signOut() })

describe('what gets pushed, and what does not', () => {
  it('sends every line the network has to fulfil, and only those', async () => {
    const { data } = await supabase.from('products').select('id,name,fulfilment_route')
    const route = new Map(((data ?? []) as { id: string; fulfilment_route: string }[])
      .map(p => [p.id, p.fulfilment_route]))

    const { data: items } = await supabase.from('order_items').select('id,product_id')
    const network = ((items ?? []) as { id: string; product_id: string }[])
      .filter(i => route.get(i.product_id) === 'telco-com')
    expect(network.length,
      'nothing in the catalogue is provisioned by the network, so none of this is exercised')
      .toBeGreaterThan(0)

    const pushed = new Set(book.pushes.map(p => p.order_item_id))
    for (const i of network) {
      expect(pushed.has(i.id),
        `${i.product_id} was sold and the order manager was never told`).toBe(true)
    }
    for (const p of book.pushes) {
      expect(route.get(p.product_id ?? ''),
        `${p.product_id} was pushed to a telco order manager and is not its business`)
        .toBe('telco-com')
    }
  })

  it('never pushes a security subscription or a shipped device', async () => {
    const { data } = await supabase.from('products')
      .select('id,category_id,fulfilment_route')
      .in('category_id', ['security', 'content', 'device'])
    for (const p of (data ?? []) as { id: string; fulfilment_route: string }[]) {
      expect(p.fulfilment_route, `${p.id} routes to the network`).not.toBe('telco-com')
    }
  })

  it('is idempotent — pushing an order twice does not provision it twice', async () => {
    const ref = book.pushes[0].order_ref
    const before = await loadPushesFor(ref)
    const r = await pushOrder(ref)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.queued, 'a second push queued the same line again').toBe(0)
    const after = await loadPushesFor(ref)
    expect(after.length).toBe(before.length)
    expect(after.map(p => p.id).sort()).toEqual(before.map(p => p.id).sort())
  })
})

describe('the mapping, and the payload it produces', () => {
  it('has no two rows fighting over one field', () => {
    expect(mappingProblems(book.mappings)).toEqual([])
  })

  it('sends the envelope plus the fields for the fulfilment class, and nothing else’s', () => {
    const esim = mappingFor(book.mappings, 'esim').map(m => m.id)
    const prov = mappingFor(book.mappings, 'provisioned').map(m => m.id)
    expect(esim.length).toBeGreaterThan(5)
    /* The APN belongs to connectivity and nowhere near an eSIM profile order. */
    const apn = book.mappings.find(m => m.label === 'APN')!
    expect(prov).toContain(apn.id)
    expect(esim).not.toContain(apn.id)
  })

  /* The reconciliation. If the screen and the database part company, an
     operator is told an order will go through and it is refused. */
  it('agrees with the database about what a line cannot supply', async () => {
    for (const p of book.pushes) {
      if (!p.order_item_id) continue
      const [ctx, { data: sqlMissing }] = await Promise.all([
        loadContext(p.order_item_id),
        supabase.rpc('com_missing', { p_item: p.order_item_id }),
      ])
      const ours = missingFor(book.mappings, p.fulfil, ctx)
      expect(ours.sort(), `${p.id}: the screen and the database disagree about what is missing`)
        .toEqual(((sqlMissing ?? []) as string[]).sort())
    }
  })

  it('builds a body that is the shape TMF622 describes', async () => {
    const p = book.pushes.find(x => x.state === 'completed' && x.fulfil === 'provisioned')
      ?? book.pushes.find(x => x.state === 'completed')!
    const body = await previewPayload(p.order_item_id!) as Record<string, unknown>
    expect(body.externalId, 'the body carries no reference of ours').toBeTruthy()
    expect(['B2B', 'B2C']).toContain(body.category)

    const items = body.productOrderItem as Record<string, unknown>[]
    expect(Array.isArray(items)).toBe(true)
    expect(typeof items[0].quantity, 'quantity was sent as a string, which the standard rejects')
      .toBe('number')
    expect((items[0].productOffering as Record<string, string>).id).toBeTruthy()

    /* The rate-card item, not the marketplace SKU — COM has never heard of a
       marketplace SKU. */
    const offering = (items[0].productOffering as Record<string, string>).id
    if (offering.startsWith('TP-')) {
      const { data } = await supabase.from('telco_catalogue').select('id').eq('id', offering)
      expect(data?.length, `${offering} is not on the rate card`).toBe(1)
    }

    const parties = body.relatedParty as Record<string, string>[]
    expect(parties[0].id, 'the order names no customer').toBeTruthy()
    expect(parties[0].role).toBe('Customer')

    /* Characteristics come in name/value pairs. A value with no name beside it
       arrives as an anonymous field and is dropped. */
    const chars = ((items[0].product as Record<string, unknown>)
      ?.productCharacteristic ?? []) as Record<string, string>[]
    for (const c of chars) {
      expect(c.name, `a characteristic was sent with no name: ${JSON.stringify(c)}`).toBeTruthy()
    }
  })

  it('sends an ISO timestamp for the start date, not whatever Postgres prints', async () => {
    const p = book.pushes.find(x => x.payload)!
    const body = await previewPayload(p.order_item_id!) as Record<string, string>
    expect(body.requestedStartDate).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/)
  })
})

describe('the states, against real rows', () => {
  it('has every state a screen has to draw', () => {
    for (const state of ['completed', 'in-progress', 'rejected', 'sent', 'cancelled'] as const) {
      expect(book.pushes.some(p => p.state === state),
        `nothing is ${state}, so that case is drawn against nothing`).toBe(true)
    }
  })

  /* The distinction the whole failure model turns on. */
  it('does not offer to retry anything it refused for a missing field', () => {
    const rejected = book.pushes.filter(p => p.state === 'rejected')
    expect(rejected.length).toBeGreaterThan(0)
    for (const p of rejected) {
      expect(retryable(p), `${p.id} offers a retry that cannot possibly succeed`).toBe(false)
      expect(p.next_attempt_at, `${p.id} is scheduled for a retry`).toBeNull()
      expect(p.failure_reason, `${p.id} was refused for no stated reason`).toBeTruthy()
      expect(explain(p, book.systems.find(s => s.id === p.system_id) ?? null, NOW))
        .toBe(p.failure_reason)
    }
  })

  it('never calls an accepted order a delivered one', () => {
    for (const p of book.pushes.filter(x => x.state === 'acknowledged')) {
      expect(p.completed_at, `${p.id} is only acknowledged and carries a completion time`).toBeNull()
      expect(inFlight(p.state)).toBe(true)
    }
    for (const p of book.pushes.filter(x => x.state === 'completed')) {
      expect(p.acknowledged_at, `${p.id} completed without ever being accepted`).toBeTruthy()
      expect(new Date(p.completed_at!).getTime())
        .toBeGreaterThan(new Date(p.acknowledged_at!).getTime())
    }
  })

  it('finds the order that was sent and never answered', () => {
    const silent = book.pushes.filter(p =>
      unacknowledged(p, book.systems.find(s => s.id === p.system_id) ?? null, NOW))
    expect(silent.length,
      'nothing is sent-and-silent, so the state that quietly loses orders is untested')
      .toBeGreaterThan(0)
    for (const p of silent) {
      expect(p.acknowledged_at).toBeNull()
      expect(explain(p, book.systems.find(s => s.id === p.system_id)!, NOW))
        .toMatch(/not acknowledged/)
    }
  })

  it('works the queue worst-first', () => {
    const q = workOrder(book.pushes, book.systems, NOW)
    expect(q[0].state === 'rejected' || q[0].state === 'failed').toBe(true)
    const h = queueHealth(book.pushes, book.systems, NOW)
    expect(h.worst).toBeTruthy()
    expect(h.total).toBe(book.pushes.length)
  })

  it('carries an event trail behind every push', () => {
    for (const p of book.pushes) {
      expect(book.events.some(e => e.com_order === p.id),
        `${p.id} has a state and no record of how it got there`).toBe(true)
    }
  })
})

describe('what the buyer is shown agrees with what the network did', () => {
  it('never shows an order as finished whose service was never provisioned', async () => {
    const { data } = await supabase.from('orders').select('order_ref,stage,stages,status')
    const orders = (data ?? []) as { order_ref: string; stage: number; stages: string[]; status: string }[]
    for (const p of book.pushes) {
      const o = orders.find(x => x.order_ref === p.order_ref)
      if (!o) continue
      if (o.stage >= (o.stages?.length ?? 1) - 1) {
        expect(['completed', 'cancelled'],
          `${o.order_ref} is shown on its last rung and its service is ${p.state}`)
          .toContain(p.state)
      }
    }
  })

  it('stops the marketplace walking an unprovisioned order to its last stage', async () => {
    const stuck = book.pushes.find(p => p.state === 'rejected')!
    const { data } = await supabase.from('orders').select('id,stage,stages')
      .eq('order_ref', stuck.order_ref).maybeSingle()
    const o = data as { id: string; stage: number; stages: string[] }
    const { error } = await supabase.from('orders')
      .update({ stage: o.stages.length - 1 }).eq('id', o.id)
    expect(error, 'an order with a refused provisioning request walked to "live"').toBeTruthy()
    expect(error!.message).toMatch(/cannot show as/)
  })

  it('shows no eSIM being posted to anybody', async () => {
    const { data } = await supabase.from('orders').select('order_ref,stages')
    const orders = (data ?? []) as { order_ref: string; stages: string[] }[]
    for (const p of book.pushes.filter(x => x.fulfil === 'esim')) {
      const o = orders.find(x => x.order_ref === p.order_ref)
      expect(o?.stages ?? [], `${p.order_ref} is an eSIM order tracked like a parcel`)
        .not.toContain('In transit')
    }
  })

  it('gives the buyer words rather than a state name', () => {
    for (const p of book.pushes) {
      expect(STATE_MEANING[p.state].length).toBeGreaterThan(20)
    }
  })
})

describe('the systems', () => {
  it('has one for every market that sells something the network fulfils', async () => {
    const markets = new Set(book.pushes.map(p => p.market))
    expect(markets.size).toBeGreaterThan(1)
    for (const m of markets) {
      expect(book.systems.find(s => s.market === m && s.environment === 'production'),
        `${m} sells network service and has no order manager configured`).toBeTruthy()
    }
  })

  it('names a standard and a version rather than a bespoke shape', () => {
    for (const s of book.systems) {
      expect(s.standard).toMatch(/^TMF\d+$/)
      expect(s.api_version).toMatch(/^\d+\.\d+\.\d+$/)
      expect(s.max_attempts).toBeGreaterThan(0)
      expect(s.ack_sla_seconds).toBeGreaterThan(0)
    }
  })

  /* Three markets, three vendors, three sets of numbers — a fixture that
     flattened them would test one integration three times. */
  it('is genuinely three integrations, not one repeated', () => {
    expect(new Set(book.systems.map(s => s.vendor)).size).toBe(book.systems.length)
    expect(new Set(book.systems.map(s => s.auth)).size).toBeGreaterThan(1)
    expect(new Set(book.systems.map(s => s.ack_sla_seconds)).size).toBeGreaterThan(1)
  })
})
