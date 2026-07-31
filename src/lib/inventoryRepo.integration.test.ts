/* Touches the live Supabase project. Reads only.

   The stock ledger against the catalogue it counts. Signed in as the operator,
   because operator_inventory is operator-scoped — the consumer suite reads zero
   rows here, which is the RLS working rather than an empty warehouse. */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { supabase } from './supabase'
import { signIn, signOut } from './authRepo'
import { stockBadge, canStock } from './inventory'

const OPERATOR = { email: 'anika.sharma@aventa.com', password: 'operator123' }

beforeAll(async () => { await signIn(OPERATOR.email, OPERATOR.password) })
afterAll(async () => { await signOut() })

/* -------------------------------------------------------- inventory ------ */

describe('the stock ledger', () => {
  interface Line {
    id: string
    product_id: string
    warehouse_id: string
    on_hand: number
    reserved: number
    available: number
    reorder_point: number
    inbound: number
    unit_cost: number
    product: { id: string; name: string; fulfil: string; status: string; stock: string; cost: number; price: number; category_id: string } | null
    warehouse: { id: string; name: string; type: string; categories: string[] } | null
  }

  let lines: Line[] = []

  beforeAll(async () => {
    const { data, error } = await supabase
      .from('operator_inventory')
      .select('*, product:products(id,name,fulfil,status,stock,cost,price,category_id), warehouse:operator_warehouses(id,name,type,categories)')
      .returns<Line[]>()
    expect(error).toBeNull()
    lines = data ?? []
    expect(lines.length).toBeGreaterThan(0)
  })

  /* The defect this reconciliation removed: the ledger counted 450 units of "K9
     Pro 5G Smartphone" from "TechDyne Devices", and neither existed. */
  it('resolves every stock line to a real product and a real warehouse', () => {
    for (const l of lines) {
      expect(l.product, `${l.id} points at ${l.product_id}, which is not in the catalogue`).toBeTruthy()
      expect(l.warehouse, `${l.id} points at ${l.warehouse_id}, which is not a warehouse`).toBeTruthy()
    }
  })

  it('holds stock only for things that are actually shipped', () => {
    for (const l of lines) {
      expect(l.product!.fulfil, `${l.product!.name} is ${l.product!.fulfil}, so it has no warehouse stock`).toBe('shipped')
    }
  })

  it('counts every shipped product that is on sale', async () => {
    const { data } = await supabase.from('products').select('id,name').eq('fulfil', 'shipped').eq('status', 'live')
    for (const p of (data ?? []) as { id: string; name: string }[]) {
      expect(lines.some(l => l.product_id === p.id), `${p.name} is on sale with no stock line`).toBe(true)
    }
  })

  /* `available` is a generated column, so this cannot drift — which is the
     point of checking it: if it ever fails, somebody made it writable again. */
  it('keeps available exactly on hand minus reserved', () => {
    for (const l of lines) {
      expect(l.available, `${l.product!.name}`).toBe(l.on_hand - l.reserved)
      expect(l.reserved, `${l.product!.name} has more reserved than it holds`).toBeLessThanOrEqual(l.on_hand)
    }
  })

  /* The badge a buyer reads against the numbers behind it. A product listed as
     "in stock" with an empty shelf is the failure this pair exists to stop. */
  it('agrees with the storefront badge on every line', () => {
    for (const l of lines) {
      expect(l.product!.stock, `${l.product!.name}: ${l.available} available, reorder at ${l.reorder_point}`)
        .toBe(stockBadge(l.available, l.reorder_point))
    }
  })

  it('records one cost per product rather than two', () => {
    for (const l of lines) {
      expect(Number(l.product!.cost), `${l.product!.name} costs differently in the catalogue and the ledger`)
        .toBe(Number(l.unit_cost))
      expect(Number(l.product!.cost), `${l.product!.name} costs at least what it sells for`)
        .toBeLessThan(Number(l.product!.price))
    }
  })

  it('holds stock only where the warehouse serves that marketplace, and never in a returns centre', () => {
    for (const l of lines) {
      const verdict = canStock(l.warehouse!, l.product!.category_id)
      expect(verdict.ok, `${l.product!.name} in ${l.warehouse!.name}: ${verdict.ok ? '' : verdict.reason}`).toBe(true)
    }
  })

  it('never counts the same product twice in one warehouse', () => {
    const keys = lines.map(l => `${l.product_id}@${l.warehouse_id}`)
    expect(new Set(keys).size, 'two lines answer "how many have we got" differently').toBe(keys.length)
  })

  it('names a real marketplace in every warehouse it configures', async () => {
    const [{ data: whs }, { data: cats }] = await Promise.all([
      supabase.from('operator_warehouses').select('name,categories'),
      supabase.from('categories').select('id'),
    ])
    const ids = new Set(((cats ?? []) as { id: string }[]).map(c => c.id))
    for (const w of (whs ?? []) as { name: string; categories: string[] }[]) {
      for (const c of w.categories) {
        expect(ids.has(c), `${w.name} serves "${c}", which is not a category`).toBe(true)
      }
    }
  })
})
