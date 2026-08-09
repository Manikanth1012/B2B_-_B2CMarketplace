/* Touches the live Supabase project.
 *
 * An order carried one status over parts that were doing different things, and
 * `partner_fulfil_own_orders` let either seller on a shared basket write it. So
 * there are two claims here and the second is the one that matters:
 *
 *   - `orderStateFrom` and `order_state_from_parts` are the same reduction,
 *     checked against every order actually on file rather than a fixture
 *   - a seller can move their own part and cannot touch the other seller's,
 *     tried rather than read
 *
 * Everything written here is put back in the same file.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { supabase } from './supabase'
import { signIn, signOut } from './authRepo'
import { orderStateFrom, partsOf, canMove, nextFor, onRail } from './orderParts'
import type { Part, PartState } from './orderParts'

const OPERATOR = { email: 'anika.sharma@aventa.com', password: 'operator123' }
const PARTNER = { email: 'rajesh.kumar@nimbussensors.com', password: 'partner123' }

interface OrderRow { id: string; order_ref: string; status: string; tracking_ref: string | null; carrier: string | null }

describe('an order is its parts', () => {
  let parts: Part[]
  let orders: OrderRow[]
  const restore: { id: string; state: PartState }[] = []

  beforeAll(async () => {
    await signIn(OPERATOR.email, OPERATOR.password)
    const [p, o] = await Promise.all([
      supabase.from('order_part').select('*').order('sort_order'),
      supabase.from('orders').select('id, order_ref, status, tracking_ref, carrier'),
    ])
    expect(p.error, p.error?.message).toBeNull()
    expect(o.error, o.error?.message).toBeNull()
    parts = ((p.data ?? []) as Record<string, unknown>[]).map(r => ({
      ...r, order_id: String(r.order_id), sort_order: Number(r.sort_order ?? 0),
    })) as unknown as Part[]
    orders = (o.data ?? []) as OrderRow[]
    expect(parts.length).toBeGreaterThan(0)
  }, 30_000)

  afterAll(async () => {
    await signIn(OPERATOR.email, OPERATOR.password)
    for (const r of restore) {
      await supabase.from('order_part').update({ state: r.state }).eq('id', r.id)
    }
    await signOut()
  })

  it('gives every order at least one part, and every item a part to belong to', async () => {
    const withParts = new Set(parts.map(p => p.order_id))
    const orphans = orders.filter(o => !withParts.has(o.id)).map(o => o.order_ref)
    expect(orphans, `orders with no part: ${orphans.join(', ')}`).toEqual([])

    const { data } = await supabase.from('order_items').select('id').is('part_id', null)
    expect((data ?? []).length, 'order items belonging to no part').toBe(0)
  })

  /* The claim the file exists for. */
  it('agrees with the database on what every order amounts to', async () => {
    const wrong = orders
      .map(o => ({ o, mine: orderStateFrom(partsOf(parts, o.id)) }))
      .filter(({ o, mine }) => partsOf(parts, o.id).length > 0 && o.status !== mine)
      .map(({ o, mine }) => `${o.order_ref}: header says ${o.status}, its parts say ${mine}`)
    expect(wrong, wrong.join('; ')).toEqual([])
  })

  /* Three orders said `in transit` with nothing on them that ships. */
  it('is never in transit with no part that ships', () => {
    const bad = orders
      .filter(o => ['in transit', 'packed'].includes(o.status))
      .filter(o => !partsOf(parts, o.id).some(p => p.kind === 'shipped'))
      .map(o => o.order_ref)
    expect(bad, bad.join(', ')).toEqual([])
  })

  it('keeps carriage on the part that ships and nowhere else', () => {
    const onHeader = orders.filter(o => o.tracking_ref || o.carrier).map(o => o.order_ref)
    expect(onHeader, `still on the header: ${onHeader.join(', ')}`).toEqual([])

    const wrongKind = parts.filter(p => p.kind !== 'shipped' && (p.tracking_ref || p.carrier))
    expect(wrongKind.map(p => p.id)).toEqual([])
  })

  it('spells one state one way', () => {
    expect(orders.filter(o => o.status === 'in-transit')).toEqual([])
  })

  /* A rule with nothing exercising it is a rule nobody has checked. */
  it('has orders that genuinely span sellers and fulfilment kinds', () => {
    const byOrder = new Map<string, Part[]>()
    for (const p of parts) byOrder.set(p.order_id, [...(byOrder.get(p.order_id) ?? []), p])
    const many = [...byOrder.values()].filter(ps => ps.length > 1)
    expect(many.length, 'no order has more than one part').toBeGreaterThanOrEqual(10)
    expect(many.some(ps => new Set(ps.map(p => p.seller)).size > 1),
      'no order spans two sellers').toBe(true)
    expect(many.some(ps => new Set(ps.map(p => p.kind)).size > 1),
      'no order mixes fulfilment kinds').toBe(true)
  })

  it('holds every part on a state its own kind can be in', () => {
    const off = parts.filter(p => !onRail(p) && !['failed', 'refunded'].includes(p.state))
    expect(off.map(p => `${p.id} is ${p.kind}/${p.state}`)).toEqual([])
  })

  /* Moving a part restates its order, in the same transaction. */
  it('restates the order when a part moves', async () => {
    const part = parts.find(p => p.kind === 'shipped' && p.state === 'delivered')
    expect(part, 'no delivered shipped part to move').toBeTruthy()
    restore.push({ id: part!.id, state: part!.state })

    const before = orders.find(o => o.id === part!.order_id)!.status
    const { error } = await supabase.from('order_part')
      .update({ state: 'packed' }).eq('id', part!.id)
    expect(error, error?.message).toBeNull()

    const { data } = await supabase.from('orders')
      .select('status').eq('id', part!.order_id).maybeSingle()
    const after = (data as { status: string }).status
    expect(after, `the order stayed ${before} while its part moved`).not.toBe('delivered')

    /* And it agrees with the module about the new state. */
    const moved = partsOf(parts, part!.order_id).map(p =>
      p.id === part!.id ? { ...p, state: 'packed' as PartState } : p)
    expect(after).toBe(orderStateFrom(moved))
  })

  /* The security half: Kestrel could mark PlayForge's game delivered. */
  it('lets a seller move their own part and refuses them the other seller\'s', async () => {
    await signOut()
    await signIn(PARTNER.email, PARTNER.password)

    const { data } = await supabase.from('order_part').select('*')
    const visible = ((data ?? []) as Record<string, unknown>[]) as unknown as Part[]
    expect(visible.length, 'the seller can see no parts at all').toBeGreaterThan(0)

    const theirs = visible.find(p => p.partner_id !== 'PTR-1004' && nextFor(p) !== null)
    if (theirs) {
      const before = theirs.state
      const { data: wrote } = await supabase.from('order_part')
        .update({ state: nextFor(theirs)! }).eq('id', theirs.id).select('id')
      /* A row-level refusal writes nothing and reports success, so the absence
         of the row is the assertion. */
      expect(wrote ?? [], `${theirs.id} belongs to ${theirs.seller} and was moved anyway`).toEqual([])

      const { data: check } = await supabase.from('order_part')
        .select('state').eq('id', theirs.id).maybeSingle()
      expect((check as { state: string } | null)?.state).toBe(before)

      /* And the module refuses it with a sentence rather than silence. */
      const out = canMove(theirs, nextFor(theirs)!, { partner_id: 'PTR-1004' })
      expect(out.ok).toBe(false)
      if (!out.ok) expect(out.reason).toMatch(/another seller's/)
    }

    const own = visible.find(p => p.partner_id === 'PTR-1004' && nextFor(p) !== null
      && !(p.kind === 'shipped' && nextFor(p) === 'in transit' && !p.tracking_ref))
    if (own) {
      restore.push({ id: own.id, state: own.state })
      const { data: wrote, error } = await supabase.from('order_part')
        .update({ state: nextFor(own)! }).eq('id', own.id).select('id')
      expect(error, error?.message).toBeNull()
      expect((wrote ?? []).length, 'a seller could not move their own part').toBe(1)
    }

    await signOut()
    await signIn(OPERATOR.email, OPERATOR.password)
  }, 30_000)

  /* A state from the other journey, and a tracking number for something that
     never ships, are both refused by the column rather than by a screen. */
  it('refuses a state the kind cannot be in', async () => {
    const shipped = parts.find(p => p.kind === 'shipped')!
    const { error } = await supabase.from('order_part')
      .update({ state: 'active' }).eq('id', shipped.id)
    expect(error, 'a parcel was marked active').not.toBeNull()

    const digital = parts.find(p => p.kind !== 'shipped')!
    const bad = await supabase.from('order_part')
      .update({ tracking_ref: 'RM000' }).eq('id', digital.id)
    expect(bad.error, 'an eSIM was given a tracking number').not.toBeNull()
  })
})
