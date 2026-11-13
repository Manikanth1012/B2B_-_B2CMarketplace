/* Touches the live Supabase project. Keeps a business buyer's requisition
 * basket, reads it back as the operator, and puts the buyer's basket back as
 * it was found. No order, no requisition and no payment is placed, and no
 * product's stock or status is changed.
 *
 * 20261113200000_a_basket_is_kept_and_watched.sql (spec 11, section 2):
 *   - `save_requisition_basket` replaces the signed-in buyer's basket in one
 *     go; a line the buyer left alone keeps its id across saves; an empty list
 *     deletes the basket;
 *   - the operator reads every kept basket (loadWatchedBaskets, the Baskets
 *     screen's own read);
 *   - `remind_basket_owner` is the operator's alone;
 *   - `accept_basket_flag` refuses a line that is not in the caller's basket,
 *     and leaves a line with no flag as it is (nothing to accept).
 * The stock flag itself is not exercised: raising one means changing a
 * product's stock, which this file never does. The migration's own self-check
 * covers it in a rolled-back block.
 *
 * Skipped, saying why, until the migration is applied: `requisition_baskets`
 * is asked for, and a missing relation means it is not there yet.
 *
 * Sign-ins: business buyer, operator, business buyer.
 *
 * Clean-up, in afterAll however the run ended: the buyer's basket is put back
 * as it was found (the same lines, saved again; their ids and stamps are new),
 * or deleted if there was none.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { supabase } from './supabase'
import { signIn, signOut } from './authRepo'
import {
  loadRequisitionBasket, saveRequisitionBasket, acceptBasketFlag, loadWatchedBaskets, remindBasketOwner,
} from './basketRepo'
import type { KeptBasket } from './baskets'
import type { BasketLine } from './requisitionBasket'

const OPERATOR = { email: 'anika.sharma@aventa.com', password: 'operator123' }
const BUYER = { email: 'vikram.shah@smartbuild.in', password: 'enterprise123' }  // SmartBuild, ENT-2007, INR

const SENSOR = 'SKU-5003'    // Nimbus Cold-chain sensor, business, live
const GATEWAY = 'SKU-5007'   // Volta IoT Gateway LTE-M, business, live
const CUR = 'INR'

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

let applied = false
let skipReason = ''
/* What the buyer had before this file touched it, to put back. */
let found: KeptBasket | null = null
let lines: BasketLine[] = []
let basketId = ''
let ids: string[] = []

function skipUnlessApplied(ctx: { skip: () => void }) {
  if (!applied) {
    console.warn(skipReason)
    ctx.skip()
  }
}

/** A kept line back as the client's basket line, to save it again. */
const asLine = (k: KeptBasket['lines'][number]): BasketLine => ({
  product_id: k.product_id, name: k.name, seller: k.seller, partner_id: k.partner_id,
  quantity: k.quantity, unit_price: Number(k.unit_price), model: k.model, vertical: k.vertical ?? '',
  unit: k.unit, quote_line_id: k.quote_line_id, bundle_selection_id: k.bundle_selection_id,
  ...(k.bundle ? { bundle: k.bundle } : {}),
  ...(k.on_contract != null ? { on_contract: k.on_contract } : {}),
  ...(k.off_contract_reason ? { off_contract_reason: k.off_contract_reason } : {}),
} as BasketLine)

beforeAll(async () => {
  await as(BUYER)
  const { error } = await supabase.from('requisition_baskets').select('id').limit(1)
  if (error) {
    if (/does not exist|could not find|schema cache/i.test(error.message)) {
      skipReason = 'Skipped: there is no requisition_baskets table, so 20261113200000_a_basket_is_kept_and_watched.sql has not been applied yet.'
      return
    }
    throw new Error(`requisition_baskets could not be read: ${error.message}`)
  }
  applied = true

  const before = await loadRequisitionBasket()
  if (!before.ok) throw new Error(`the buyer's basket could not be read: ${before.error}`)
  found = before.value

  /* Two live business listings, named and sold as the shelf has them. Read
     only. */
  const { data, error: pErr } = await supabase.from('products')
    .select('id,name,seller,partner_id,price,unit,category_id').in('id', [SENSOR, GATEWAY])
  if (pErr) throw new Error(`the listings could not be read: ${pErr.message}`)
  const rows = (data ?? []) as { id: string; name: string; seller: string; partner_id: string | null; price: number; unit: string | null; category_id: string }[]
  expect(rows.map(r => r.id).sort()).toEqual([SENSOR, GATEWAY])
  lines = [SENSOR, GATEWAY].map(id => {
    const p = rows.find(r => r.id === id)!
    return {
      product_id: p.id, name: p.name, seller: p.seller, partner_id: p.partner_id, quantity: 1,
      unit_price: Number(p.price), model: 'oneoff', vertical: p.category_id, unit: p.unit,
    }
  })
}, 120000)

afterAll(async () => {
  if (!applied) { await as(null); return }
  await as(BUYER)
  const back = await saveRequisitionBasket(found?.currency ?? CUR, (found?.lines ?? []).map(asLine))
  await as(null)
  if (!back.ok) throw new Error(`the buyer's basket could not be put back as it was: ${back.error}`)
}, 120000)

describe("a business buyer's basket is kept", () => {
  it('saves two lines and reads them back with ids', async (ctx) => {
    skipUnlessApplied(ctx)
    await as(BUYER)
    const r = await saveRequisitionBasket(CUR, lines)
    expect(r.ok, r.ok ? '' : r.error).toBe(true)
    if (!r.ok || !r.value) throw new Error('nothing came back from the save')
    expect(r.value.currency).toBe(CUR)
    expect(r.value.lines.map(l => l.product_id)).toEqual([SENSOR, GATEWAY])
    for (const l of r.value.lines) expect(l.id, `${l.product_id} has no id`).toBeTruthy()
    basketId = r.value.id
    ids = r.value.lines.map(l => l.id)

    const read = await loadRequisitionBasket()
    expect(read.ok, read.ok ? '' : read.error).toBe(true)
    if (read.ok) {
      expect(read.value?.id).toBe(basketId)
      expect([...(read.value?.lines ?? [])].sort((a, b) => a.sort_order - b.sort_order).map(l => l.id)).toEqual(ids)
    }
  }, 60000)

  it('keeps each line\'s id when the same lines are saved again', async (ctx) => {
    skipUnlessApplied(ctx)
    expect(ids.length, 'the first save did not happen').toBe(2)
    const r = await saveRequisitionBasket(CUR, lines)
    expect(r.ok, r.ok ? '' : r.error).toBe(true)
    if (r.ok) {
      expect(r.value?.id).toBe(basketId)
      expect(r.value?.lines.map(l => l.id)).toEqual(ids)
    }
  }, 60000)

  it('refuses to accept a flag on a line that is not in the basket', async (ctx) => {
    skipUnlessApplied(ctx)
    const r = await acceptBasketFlag('requisition', 'no-such-line')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/That line is not in your requisition basket/)
  }, 60000)

  it('leaves a line with no flag as it is when "accepted"', async (ctx) => {
    skipUnlessApplied(ctx)
    const read = await loadRequisitionBasket()
    if (!read.ok || !read.value) throw new Error('the basket could not be read')
    const unflagged = read.value.lines.find(l => !l.stock_note)
    if (!unflagged) {
      console.warn('Skipped: both test lines carry a stock flag on this database, so there is no unflagged line to try.')
      ctx.skip()
      return
    }
    const r = await acceptBasketFlag('requisition', unflagged.id)
    expect(r.ok, r.ok ? '' : r.error).toBe(true)
    if (r.ok) expect(r.value.quantity).toBe(unflagged.quantity)
    const after = await loadRequisitionBasket()
    const same = after.ok ? after.value?.lines.find(l => l.id === unflagged.id) : undefined
    expect(same?.quantity).toBe(unflagged.quantity)
    expect(same?.stock_note ?? null).toBeNull()
  }, 60000)

  it('will not let a business buyer send a basket reminder', async (ctx) => {
    skipUnlessApplied(ctx)
    const r = await remindBasketOwner('requisition', basketId)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/Only the marketplace reminds somebody about their basket/)
    const { data } = await supabase.from('requisition_baskets').select('reminded_at').eq('id', basketId).maybeSingle()
    expect((data as { reminded_at: string | null } | null)?.reminded_at ?? null)
      .toBe(found?.id === basketId ? found.reminded_at : null)
  }, 60000)

  it('is on the operator\'s Baskets screen, owner and lines', async (ctx) => {
    skipUnlessApplied(ctx)
    await as(OPERATOR)
    const r = await loadWatchedBaskets()
    expect(r.ok, r.ok ? '' : r.error).toBe(true)
    if (!r.ok) return
    const mine = r.value.business.find(b => b.id === basketId)
    expect(mine, 'the operator does not see the buyer\'s basket').toBeTruthy()
    expect(mine!.currency).toBe(CUR)
    expect(mine!.lines.map(l => l.id).sort()).toEqual([...ids].sort())
    expect(mine!.owner, 'the basket is not named for its owner').not.toBe('Unknown buyer')
  }, 60000)

  it('deletes the basket when it is saved empty', async (ctx) => {
    skipUnlessApplied(ctx)
    await as(BUYER)
    const r = await saveRequisitionBasket(CUR, [])
    expect(r.ok, r.ok ? '' : r.error).toBe(true)
    if (r.ok) expect(r.value).toBeNull()
    const read = await loadRequisitionBasket()
    expect(read.ok).toBe(true)
    if (read.ok) expect(read.value).toBeNull()
    const { data } = await supabase.from('requisition_basket_lines').select('id').in('id', ids)
    expect(data ?? []).toEqual([])
  }, 60000)
})
