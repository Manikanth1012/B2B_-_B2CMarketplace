/* Touches the live Supabase project. Raises a requisition, tries lines on it at
 * the wrong price, and removes everything it wrote.
 *
 * 20261111300000_a_requisition_line_carries_the_list_price.sql: an ordinary
 * requisition line (no quote, no bundle) written by a business buyer carries
 * the price book's price for its product in the requisition's currency. The
 * rule lives in a trigger, so it can only be checked against the database.
 *
 * Skipped, saying why, until that migration is applied. Whether it is applied
 * is asked the only way a client can: a line at the wrong price is written
 * onto this file's own pending requisition, and if it lands the guard is not
 * there (the line is then removed again). Refused for any other reason, the
 * probe fails loudly rather than skipping or running against the wrong guard.
 *
 * Clean-up, in afterAll and again at the start in case a run died: every
 * requisition whose title carries the marker is deleted by the business buyer,
 * whose policy covers it; its lines go with it (the foreign key cascades).
 * The sweep checks what it removed.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { supabase } from './supabase'
import { signIn, signOut } from './authRepo'
import { loadAccount, raiseRequisition, loadEnterpriseCatalogue } from './enterpriseRepo'
import type { AccountBook, EnterpriseListing } from './enterpriseRepo'

const BUYER = { email: 'vikram.shah@smartbuild.in', password: 'enterprise123' }   // SmartBuild, INR

/* Letters only: requisitionRaise's stray check looks for `[a-z]+` in brackets. */
const MARKER = '[pricecheck]'
const LINE_PREFIX = 'RL-PRICECHECK-'
const SKU = 'SKU-4003'

let book: AccountBook
let item: EnterpriseListing
let reqId = ''
let applied = false
let probeNote = ''

async function sweep() {
  const { data, error } = await supabase.from('enterprise_requisitions')
    .select('id').like('title', `%${MARKER}%`)
  if (error) throw new Error(`could not look for ${MARKER} requisitions: ${error.message}`)
  for (const r of (data ?? []) as { id: string }[]) {
    const { data: gone, error: e } = await supabase.from('enterprise_requisitions')
      .delete().eq('id', r.id).select('id')
    if (e) throw new Error(`could not sweep ${r.id}: ${e.message}`)
    if (!gone?.length) throw new Error(`sweeping ${r.id} removed nothing — it is still there`)
  }
}

/** The price book's figure for the SKU in the account's currency, read directly. */
async function bookPrice(): Promise<number> {
  const { data, error } = await supabase.from('product_prices')
    .select('price').eq('product_id', SKU).eq('currency', book.account!.currency).maybeSingle()
  if (error) throw new Error(error.message)
  expect(data, `${SKU} has no price in ${book.account!.currency}`).toBeTruthy()
  return Math.round(Number((data as { price: number }).price) * 100) / 100
}

const wrongLine = (n: number, unit: number) => ({
  id: `${LINE_PREFIX}${Date.now()}-${n}`, requisition_id: reqId,
  product_id: SKU, name: item.name, seller: item.seller, partner_id: item.partner_id,
  quantity: 1, unit_price: unit, line_total: unit, sort_order: 90 + n,
})

beforeAll(async () => {
  await signOut()
  await signIn(BUYER.email, BUYER.password)
  book = await loadAccount()
  expect(book.account, 'the buyer did not load an account').toBeTruthy()
  expect(book.me, 'the buyer is not on the account').toBeTruthy()
  await sweep()

  const shelf = await loadEnterpriseCatalogue(book.account!.currency)
  item = shelf.find(p => p.id === SKU)!
  expect(item, `the shelf did not carry ${SKU}`).toBeTruthy()

  /* The requisition every test works on, raised the way the screen raises one:
     at the price the shelf shows. */
  const res = await raiseRequisition({
    draft: {
      title: `Price check ${MARKER}`,
      reason: 'Integration test of the requisition price guard.',
      currency: book.account!.currency, vertical: 'device',
      cost_centre: book.centres[0]?.id ?? null, model: 'oneoff', po_ref: 'PO-PRICECHECK',
      lines: [{ product_id: item.id, name: item.name, seller: item.seller, partner_id: item.partner_id,
        quantity: 2, unit_price: item.price }],
    },
    me: book.me!, account: book.account!, policy: book.policy!,
    currencies: book.currencies, rates: book.rates,
  })
  probeNote = res.ok ? '' : res.reason
  const { data } = await supabase.from('enterprise_requisitions')
    .select('id').like('title', `%${MARKER}%`)
  reqId = ((data ?? []) as { id: string }[])[0]?.id ?? ''
  if (!reqId) return

  /* Is the guard there? A line one unit over the list price. */
  const probe = wrongLine(0, item.price + 1)
  const { error } = await supabase.from('enterprise_requisition_lines').insert(probe)
  if (error) {
    /* Only the guard's own refusal says it is there. Anything else (RLS, the
       line guard, a constraint) is a broken probe, not an applied migration. */
    if (!/The price of .* has changed/.test(error.message)) {
      throw new Error(`the probe line was refused, but not by the price guard: ${error.message}`)
    }
    applied = true
  } else {
    const { error: e } = await supabase.from('enterprise_requisition_lines').delete().eq('id', probe.id)
    if (e) throw new Error(`could not remove the probe line ${probe.id}: ${e.message}`)
  }
}, 90000)

afterAll(async () => {
  await sweep()
  await signOut()
}, 60000)

function skipUnlessApplied(ctx: { skip: () => void }) {
  if (!applied) {
    console.warn('Skipped: a line at the wrong price was accepted, so 20261111300000_a_requisition_line_carries_the_list_price.sql has not been applied yet.')
    ctx.skip()
  }
}

describe('a requisition line carries the list price', () => {
  it('raises a requisition at the price the shelf shows', async (ctx) => {
    expect(reqId, `the requisition was not raised: ${probeNote}`).not.toBe('')
    skipUnlessApplied(ctx)
    const want = await bookPrice()
    expect(item.price).toBe(want)
    const { data } = await supabase.from('enterprise_requisition_lines')
      .select('id, unit_price, quantity').eq('requisition_id', reqId)
    const rows = (data ?? []) as { id: string; unit_price: number; quantity: number }[]
    expect(rows).toHaveLength(1)
    expect(Number(rows[0].unit_price)).toBe(want)
  }, 30000)

  it('refuses a hand-written line at a price the book does not show, and nothing lands', async (ctx) => {
    skipUnlessApplied(ctx)
    const want = await bookPrice()
    const line = wrongLine(1, Math.max(1, want - 100))
    const { error } = await supabase.from('enterprise_requisition_lines').insert(line)
    expect(error, 'a line went on at a price the book does not show').not.toBeNull()
    expect(error!.message).toMatch(/has changed.*add it again from the catalogue/)

    const { data } = await supabase.from('enterprise_requisition_lines').select('id').like('id', `${LINE_PREFIX}%`)
    expect(data ?? []).toEqual([])
  }, 30000)

  it('refuses a line naming no listing', async (ctx) => {
    skipUnlessApplied(ctx)
    const { error } = await supabase.from('enterprise_requisition_lines')
      .insert({ ...wrongLine(2, 1), product_id: null, name: 'Unlisted thing' })
    expect(error).not.toBeNull()
    expect(error!.message).toMatch(/Unlisted thing names no listing/)
  }, 30000)

  it('refuses moving a raised line to another price', async (ctx) => {
    skipUnlessApplied(ctx)
    const want = await bookPrice()
    const { data: rows } = await supabase.from('enterprise_requisition_lines')
      .select('id, quantity').eq('requisition_id', reqId)
    const l = ((rows ?? []) as { id: string; quantity: number }[])[0]
    expect(l).toBeTruthy()
    const cheap = Math.max(1, want - 100)
    const { error } = await supabase.from('enterprise_requisition_lines')
      .update({ unit_price: cheap, line_total: cheap * l.quantity }).eq('id', l.id).select('id')
    expect(error, 'a raised line was moved to another price').not.toBeNull()
    expect(error!.message).toMatch(/has changed/)
  }, 30000)

  it('still lets the buyer change a quantity on a pending line', async (ctx) => {
    skipUnlessApplied(ctx)
    const want = await bookPrice()
    const { data: rows } = await supabase.from('enterprise_requisition_lines')
      .select('id, quantity').eq('requisition_id', reqId)
    const l = ((rows ?? []) as { id: string; quantity: number }[])[0]
    expect(l).toBeTruthy()
    const q = l.quantity + 1
    const { data, error } = await supabase.from('enterprise_requisition_lines')
      .update({ quantity: q, line_total: Math.round(want * q * 100) / 100 }).eq('id', l.id).select('id')
    expect(error?.message ?? '').toBe('')
    expect(data ?? []).toHaveLength(1)
  }, 30000)
})
