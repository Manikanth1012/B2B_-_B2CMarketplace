/* Touches the live Supabase project. Sets account prices, raises requisitions
 * and quotes against them, and removes every one of them again.
 *
 * 20261112100000_an_account_buys_at_its_own_price.sql: an account's own price
 * per listing, currency and date window, set only by the marketplace, never
 * under the seller's floor or over the published price; a requisition line
 * held to it; the account's off-contract rule enforced on the line and on the
 * header. The rules live in triggers and RPCs, so they can only be checked
 * against the database.
 *
 * Skipped, saying why, until that migration is applied: `account_prices` is
 * asked for, and a missing relation means it is not there yet. Any other error
 * fails loudly.
 *
 * Listings are picked at run time: live business listings priced in INR with
 * a floor below the published price, not used by another integration test,
 * with no account price for SmartBuild. P is sold by Nimbus Sensors if one
 * qualifies; Q is another seller's.
 *
 * Clean-up, in afterAll and again at the start in case a run died: the
 * buyer deletes every requisition whose title carries the marker; the
 * operator deletes every account price on P and Q (never `AP-SEED-*`) and
 * every enquiry whose subject carries the marker; Vikram puts the buying rule
 * back as it was found. Every delete checks it removed something.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { supabase } from './supabase'
import { signIn, signOut } from './authRepo'
import { loadAccount, raiseRequisition, loadEnterpriseCatalogue } from './enterpriseRepo'
import type { AccountBook, EnterpriseListing } from './enterpriseRepo'
import { raiseQuote, sendQuote, acceptQuote, reassign } from './enquiryRepo'

const OPERATOR = { email: 'anika.sharma@aventa.com', password: 'operator123' }
const BUYER = { email: 'vikram.shah@smartbuild.in', password: 'enterprise123' }      // SmartBuild ENT-2007, policy-setter
const NIMBUS = { email: 'rajesh.kumar@nimbussensors.com', password: 'partner123' }   // PTR-1004
const MERIDIAN = { email: 'omar.haddad@meridianfoods.ae', password: 'enterprise123' } // ENT-2012, another business

const ACCOUNT = 'ENT-2007'
const NIMBUS_ID = 'PTR-1004'
const CUR = 'INR'
/* Letters only: requisitionRaise's stray check looks for `[a-z]+` in brackets. */
const MARKER = '[pricebookcheck]'
const LINE_PREFIX = 'RL-PRICEBOOK-'
/* Used by other integration tests, which raise lines at the published price. */
const TAKEN = ['SKU-2001', 'SKU-2004', 'SKU-4003', 'SKU-4008', 'SKU-5003', 'SKU-5004', 'SKU-5005',
  'SKU-5007', 'SKU-5008', 'SKU-6001', 'SKU-6002', 'SKU-7001', 'SKU-7004', 'SKU-7009']

type Creds = { email: string; password: string }
let who = ''
async function as(c: Creds) {
  if (who === c.email) return
  await signOut()
  who = ''
  await signIn(c.email, c.password)   // throws when the login is refused
  who = c.email
}

/** A date `days` from today in the database's calendar (UTC). */
function day(days: number): string {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}
const round2 = (n: number) => Math.round(n * 100) / 100

interface Pick { item: EnterpriseListing; book: number; floor: number }
interface PriceRow {
  id: string; account_id: string; product_id: string; currency: string; unit_price: number | string
  starts_on: string; ends_on: string | null; source: string; quote_ref: string | null
  end_reason: string | null
}

let applied = false
let skipReason = ''
let book: AccountBook
let P: Pick | null = null
let Q: Pick | null = null
let savedRule: { off_contract: string; note: string | null } | null = null
let reqId = ''
let qLineId = ''
let firstId = ''
let currentId = ''

/* ------------------------------------------------------------- the sweep -- */

async function sweep() {
  await as(BUYER)
  const { data: reqs, error: rErr } = await supabase.from('enterprise_requisitions')
    .select('id').like('title', `%${MARKER}%`)
  if (rErr) throw new Error(`could not look for ${MARKER} requisitions: ${rErr.message}`)
  for (const r of (reqs ?? []) as { id: string }[]) {
    const { data: gone, error } = await supabase.from('enterprise_requisitions').delete().eq('id', r.id).select('id')
    if (error) throw new Error(`could not sweep ${r.id}: ${error.message}`)
    if (!gone?.length) throw new Error(`sweeping ${r.id} removed nothing — it is still there`)
  }

  await as(OPERATOR)
  /* Every price this file sets carries the marker in its note; a run that
     died before picking the same P again leaves only those. */
  const ids = new Set<string>()
  const { data: marked, error: mErr } = await supabase.from('account_prices')
    .select('id').like('note', `%${MARKER}%`)
  if (mErr) throw new Error(`could not look for test account prices: ${mErr.message}`)
  for (const r of (marked ?? []) as { id: string }[]) ids.add(r.id)
  const products = [P?.item.id, Q?.item.id].filter((x): x is string => !!x)
  if (products.length) {
    const { data: rows, error: pErr } = await supabase.from('account_prices')
      .select('id').eq('account_id', ACCOUNT).in('product_id', products)
    if (pErr) throw new Error(`could not look for test account prices: ${pErr.message}`)
    for (const r of (rows ?? []) as { id: string }[]) ids.add(r.id)
  }
  {
    const rows = [...ids].filter(id => !id.startsWith('AP-SEED-')).map(id => ({ id }))
    for (const r of rows) {
      const { data: gone, error } = await supabase.from('account_prices').delete().eq('id', r.id).select('id')
      if (error) throw new Error(`could not sweep ${r.id}: ${error.message}`)
      if (!gone?.length) throw new Error(`sweeping ${r.id} removed nothing — it is still there`)
    }
  }
  const { data: enqs, error: eErr } = await supabase.from('enquiries').select('id').like('subject', `%${MARKER}%`)
  if (eErr) throw new Error(`could not look for ${MARKER} enquiries: ${eErr.message}`)
  for (const e of (enqs ?? []) as { id: string }[]) {
    if (e.id.startsWith('ENQ-SEED-')) throw new Error(`refusing to sweep seed row ${e.id}`)
    const { data: gone, error } = await supabase.from('enquiries').delete().eq('id', e.id).select('id')
    if (error) throw new Error(`could not sweep ${e.id}: ${error.message}`)
    if (!gone?.length) throw new Error(`sweeping ${e.id} removed nothing — it is still there`)
  }
}

async function setRule(off_contract: string, note: string | null = null) {
  await as(BUYER)
  const { data, error } = await supabase.from('enterprise_buying_rules')
    .update({ off_contract, note }).eq('account_id', ACCOUNT).select('off_contract')
  if (error) throw new Error(`could not set the buying rule to ${off_contract}: ${error.message}`)
  if (!data?.length) throw new Error(`setting the buying rule to ${off_contract} changed nothing`)
}

/* ------------------------------------------------------------- helpers -- */

async function setPrice(unit: number, starts_on = day(0), ends_on: string | null = null) {
  return supabase.rpc('set_account_price', {
    p_account: ACCOUNT, p_product: P!.item.id, p_currency: CUR, p_unit_price: unit,
    p_starts_on: starts_on, p_ends_on: ends_on, p_note: `Integration test ${MARKER}`, p_quote_line: null,
  })
}

async function priceRow(id: string): Promise<PriceRow> {
  const { data, error } = await supabase.from('account_prices').select('*').eq('id', id).maybeSingle()
  expect(error).toBeNull()
  expect(data, `account price ${id} is not there`).toBeTruthy()
  return data as PriceRow
}

async function rowsOnP(): Promise<PriceRow[]> {
  const { data, error } = await supabase.from('account_prices').select('*')
    .eq('account_id', ACCOUNT).eq('product_id', P!.item.id).eq('currency', CUR).order('set_at')
  expect(error).toBeNull()
  return (data ?? []) as PriceRow[]
}

let lineN = 0
function line(pick: Pick, unit: number, extra: Record<string, unknown> = {}) {
  lineN++
  return {
    id: `${LINE_PREFIX}${Date.now()}-${lineN}`, requisition_id: reqId,
    product_id: pick.item.id, name: pick.item.name, seller: pick.item.seller, partner_id: pick.item.partner_id,
    quantity: 1, unit_price: unit, line_total: unit, sort_order: 90 + lineN, ...extra,
  }
}

async function insertLine(row: Record<string, unknown>) {
  return supabase.from('enterprise_requisition_lines').insert(row).select('*').maybeSingle()
}

/** Candidates: live business listings on the buyer's INR shelf, priced in INR
    with a floor at least two rupees below the price, not taken, and with no
    account price for SmartBuild. */
async function candidates(): Promise<Pick[]> {
  const shelf = await loadEnterpriseCatalogue(CUR)
  const ids = shelf.map(s => s.id).filter(id => !TAKEN.includes(id))
  if (!ids.length) return []
  const { data: prices, error } = await supabase.from('product_prices')
    .select('product_id, price, floor_price').eq('currency', CUR).in('product_id', ids)
  if (error) throw new Error(`could not read prices: ${error.message}`)
  const { data: own, error: oErr } = await supabase.from('account_prices')
    .select('product_id').eq('account_id', ACCOUNT).eq('currency', CUR)
  if (oErr) throw new Error(`could not read SmartBuild's account prices: ${oErr.message}`)
  const priced = new Set(((own ?? []) as { product_id: string }[]).map(r => r.product_id))
  const out: Pick[] = []
  for (const p of (prices ?? []) as { product_id: string; price: number | string; floor_price: number | string | null }[]) {
    if (p.floor_price === null || priced.has(p.product_id)) continue
    const bookP = round2(Number(p.price))
    const floor = round2(Number(p.floor_price))
    if (floor < 2 || bookP - floor < 2) continue
    const item = shelf.find(s => s.id === p.product_id)!
    if (round2(item.price) !== bookP) continue
    out.push({ item, book: bookP, floor })
  }
  return out.sort((a, b) => a.item.id.localeCompare(b.item.id))
}

/* ------------------------------------------------------- setup and close -- */

beforeAll(async () => {
  await as(BUYER)
  const { error } = await supabase.from('account_prices').select('id').limit(1)
  if (error) {
    if (/does not exist|could not find the table|schema cache/i.test(error.message)) {
      skipReason = 'Skipped: there is no account_prices table, so 20261112100000_an_account_buys_at_its_own_price.sql has not been applied yet.'
      return
    }
    throw new Error(`account_prices could not be read: ${error.message}`)
  }
  applied = true

  await sweep()
  await as(BUYER)
  book = await loadAccount()
  expect(book.account, 'the buyer did not load an account').toBeTruthy()
  expect(book.me, 'the buyer is not on the account').toBeTruthy()
  expect(book.account!.currency).toBe(CUR)

  const all = await candidates()
  const nimbus = all.filter(c => c.item.partner_id === NIMBUS_ID)
  P = nimbus[0] ?? all[0] ?? null
  /* Q: another seller, cheapest first, so its requisition stays under the
     approval threshold and needs nobody. */
  Q = all.filter(c => c !== P && c.item.partner_id !== P?.item.partner_id)
    .sort((a, b) => a.book - b.book)[0] ?? null
  if (!P || !Q) {
    skipReason = 'Skipped: no two live business listings by different sellers, priced in INR with a floor, are free to test account prices on.'
    applied = false
    return
  }

  const { data: rule, error: rErr } = await supabase.from('enterprise_buying_rules')
    .select('off_contract, note').eq('account_id', ACCOUNT).maybeSingle()
  if (rErr) throw new Error(`could not read SmartBuild's buying rule: ${rErr.message}`)
  expect(rule, 'SmartBuild has no buying rules row').toBeTruthy()
  savedRule = rule as { off_contract: string; note: string | null }

  await setRule('allow', savedRule.note)
}, 120000)

afterAll(async () => {
  if (!applied) { await signOut(); return }
  await sweep()
  if (savedRule) await setRule(savedRule.off_contract, savedRule.note)
  await signOut()
}, 120000)

function skipUnlessApplied(ctx: { skip: () => void }) {
  if (!applied) {
    console.warn(skipReason)
    ctx.skip()
  }
}

/* ================================================================= tests == */

describe('an account buys at its own price', () => {
  it('1. the desk is refused a price under the floor, over the published price, or in the past', async (ctx) => {
    skipUnlessApplied(ctx)
    await as(OPERATOR)
    let r = await setPrice(P!.floor - 1)
    expect(r.error?.message).toMatch(/below the floor/)
    r = await setPrice(P!.book + 1)
    expect(r.error?.message).toMatch(/above the published price/)
    r = await setPrice(mid(0.5), day(-1))
    expect(r.error?.message).toMatch(/starts today or later/)
    expect(await rowsOnP()).toEqual([])
  })

  it('2. the desk sets a price from today; the buyer reads it, another account does not', async (ctx) => {
    skipUnlessApplied(ctx)
    await as(OPERATOR)
    const r = await setPrice(mid(0.5))
    expect(r.error, r.error?.message).toBeNull()
    expect(typeof r.data).toBe('string')
    firstId = r.data as string
    const row = await priceRow(firstId)
    expect(row.starts_on).toBe(day(0))
    expect(row.ends_on).toBeNull()
    expect(Number(row.unit_price)).toBe(mid(0.5))
    expect(row.source).toBe('negotiated')

    await as(BUYER)
    const { data } = await supabase.from('account_prices').select('id').eq('id', firstId)
    expect((data ?? []).map((x: { id: string }) => x.id)).toEqual([firstId])
  })

  it('2b. another business reads none of it', async (ctx) => {
    skipUnlessApplied(ctx)
    try {
      await as(MERIDIAN)
    } catch {
      console.warn('Skipped: the second business login could not sign in.')
      ctx.skip()
      return
    }
    const { data, error } = await supabase.from('account_prices').select('id').eq('product_id', P!.item.id)
    expect(error).toBeNull()
    expect(data ?? []).toEqual([])
  })

  it('1b. a direct overlapping insert, and a direct edit, are refused', async (ctx) => {
    skipUnlessApplied(ctx)
    await as(OPERATOR)
    const { error: ins } = await supabase.from('account_prices').insert({
      account_id: ACCOUNT, product_id: P!.item.id, currency: CUR, unit_price: mid(0.4), starts_on: day(3),
    })
    expect(ins?.message).toMatch(/One price applies at a time/)
    const { error: upd } = await supabase.from('account_prices').update({ unit_price: mid(0.3) }).eq('id', firstId)
    expect(upd?.message).toMatch(/is not edited/)
  })

  it('3. a new price from tomorrow ends the first today; one from today withdraws them', async (ctx) => {
    skipUnlessApplied(ctx)
    await as(OPERATOR)
    const r = await setPrice(mid(0.6), day(1))
    expect(r.error, r.error?.message).toBeNull()
    const second = r.data as string
    expect((await priceRow(firstId)).ends_on).toBe(day(0))
    expect((await priceRow(second)).ends_on).toBeNull()
    expect((await rowsOnP()).map(x => x.id).sort()).toEqual([firstId, second].sort())

    const r2 = await setPrice(mid(0.7), day(0))
    expect(r2.error, r2.error?.message).toBeNull()
    currentId = r2.data as string
    const a = await priceRow(firstId)
    const b = await priceRow(second)
    expect(a.ends_on).toBe(day(-1))               // starts_on − 1: withdrawn
    expect(b.ends_on).toBe(day(0))                // its starts_on − 1: withdrawn
    expect(a.end_reason).toMatch(/Replaced by the price from/)
    const c = await priceRow(currentId)
    expect(c.starts_on).toBe(day(0))
    expect(c.ends_on).toBeNull()
  })

  it('4. a requisition line is held to the account price; a line without one is off contract', async (ctx) => {
    skipUnlessApplied(ctx)
    await as(BUYER)
    const res = await raiseRequisition({
      draft: {
        title: `Price book check ${MARKER}`,
        reason: 'Integration test of account price books.',
        currency: CUR, vertical: 'device',
        cost_centre: book.centres[0]?.id ?? null, model: 'oneoff', po_ref: 'PO-PRICEBOOK',
        lines: [{ product_id: Q!.item.id, name: Q!.item.name, seller: Q!.item.seller, partner_id: Q!.item.partner_id,
          quantity: 1, unit_price: Q!.book }],
      },
      me: book.me!, account: book.account!, policy: book.policy!,
      currencies: book.currencies, rates: book.rates,
    })
    expect(res.ok, res.ok ? '' : res.reason).toBe(true)
    const { data: reqs } = await supabase.from('enterprise_requisitions')
      .select('id, state').like('title', `%${MARKER}%`)
    const req = ((reqs ?? []) as { id: string; state: string }[])[0]
    expect(req?.state).toBe('pending')
    reqId = req.id

    const { error: e1 } = await insertLine(line(P!, P!.book))
    expect(e1?.message).toMatch(/your account's price is now/)

    const { data: ok, error: e2 } = await insertLine(line(P!, mid(0.7)))
    expect(e2, e2?.message).toBeNull()
    expect((ok as { account_price_id: string }).account_price_id).toBe(currentId)
    expect((ok as { off_contract: boolean }).off_contract).toBe(false)

    const { data: lines } = await supabase.from('enterprise_requisition_lines')
      .select('id, product_id, off_contract, off_contract_rule, account_price_id').eq('requisition_id', reqId)
    const q = ((lines ?? []) as { id: string; product_id: string; off_contract: boolean; off_contract_rule: string | null; account_price_id: string | null }[])
      .find(l => l.product_id === Q!.item.id)!
    expect(q.off_contract).toBe(true)
    expect(q.off_contract_rule).toBe('allow')
    expect(q.account_price_id).toBeNull()
    qLineId = q.id
  }, 60000)

  it('5. the buyer cannot mark an off-contract line as on contract', async (ctx) => {
    skipUnlessApplied(ctx)
    await as(BUYER)
    await supabase.from('enterprise_requisition_lines').update({ off_contract: false, off_contract_rule: null }).eq('id', qLineId)
    const { data } = await supabase.from('enterprise_requisition_lines')
      .select('off_contract, off_contract_rule').eq('id', qLineId).maybeSingle()
    expect((data as { off_contract: boolean }).off_contract).toBe(true)
    expect((data as { off_contract_rule: string }).off_contract_rule).toBe('allow')
  })

  it('6. the policy-setter asks for a reason, then for approval', async (ctx) => {
    skipUnlessApplied(ctx)
    await setRule('reason')
    let r = await insertLine(line(Q!, Q!.book))
    expect(r.error?.message).toMatch(/ask for a reason/)
    r = await insertLine(line(Q!, Q!.book, { off_contract_reason: 'Only stockist in Pune' }))
    expect(r.error, r.error?.message).toBeNull()
    expect((r.data as { off_contract_reason: string }).off_contract_reason).toBe('Only stockist in Pune')
    expect((r.data as { off_contract_rule: string }).off_contract_rule).toBe('reason')

    /* The header has to need nobody for the next refusal; nothing on it is
       sent for approval yet, so this is allowed. */
    const { error: none } = await supabase.from('enterprise_requisitions').update({ need: 'none' }).eq('id', reqId)
    expect(none, none?.message).toBeNull()

    await setRule('approval')
    r = await insertLine(line(Q!, Q!.book))
    expect(r.error?.message).toMatch(/send anything bought off it for approval/)

    const { error: fin } = await supabase.from('enterprise_requisitions').update({ need: 'finance' }).eq('id', reqId)
    expect(fin, fin?.message).toBeNull()
    r = await insertLine(line(Q!, Q!.book))
    expect(r.error, r.error?.message).toBeNull()
    expect((r.data as { off_contract_rule: string }).off_contract_rule).toBe('approval')

    const { error: back } = await supabase.from('enterprise_requisitions').update({ need: 'none' }).eq('id', reqId)
    expect(back?.message).toMatch(/cannot be marked as needing none/)
    await setRule('allow', savedRule!.note)
  }, 60000)

  it('7. the seller reads the prices on its own listings, with the account named', async (ctx) => {
    skipUnlessApplied(ctx)
    if (P!.item.partner_id !== NIMBUS_ID) {
      console.warn('Skipped: no listing by Nimbus Sensors qualified as P, so the seller view cannot be checked with its login.')
      ctx.skip()
      return
    }
    await as(NIMBUS)
    const { data: rows, error } = await supabase.from('account_prices').select('product_id')
    expect(error).toBeNull()
    const ids = [...new Set(((rows ?? []) as { product_id: string }[]).map(r => r.product_id))]
    if (ids.length) {
      const { data: prods } = await supabase.from('products').select('id, partner_id').in('id', ids)
      for (const p of (prods ?? []) as { id: string; partner_id: string }[]) expect(p.partner_id, p.id).toBe(NIMBUS_ID)
    }
    const { data: mine, error: e2 } = await supabase.rpc('seller_account_prices')
    expect(e2, e2?.message).toBeNull()
    const list = (mine ?? []) as { id: string; company: string; product_id: string }[]
    const row = list.find(x => x.id === currentId)
    expect(row, 'the seller does not see the price on its listing').toBeTruthy()
    expect(row!.company).toBe(book.account!.company)
    expect(list.some(x => x.product_id === Q!.item.id)).toBe(false)
  })

  it('8. an accepted quote under the floor is refused as a standing price; one inside it is promoted', async (ctx) => {
    skipUnlessApplied(ctx)
    async function quoteAt(price: number, label: string): Promise<{ id: string; lineId: string }> {
      await as(BUYER)
      const q = await raiseQuote({ subject: `Price book ${label} ${MARKER}`, lines: [{ product_id: P!.item.id, quantity: 1 }],
        note: 'Integration test — removed afterwards.' })
      expect(q.ok, q.ok ? '' : q.error).toBe(true)
      if (!q.ok) throw new Error(q.error)
      const { data: ls } = await supabase.from('enquiry_lines').select('id').eq('enquiry_id', q.id)
      const lineId = ((ls ?? []) as { id: string }[])[0].id
      await as(OPERATOR)
      const { data: e } = await supabase.from('enquiries').select('partner_id').eq('id', q.id).maybeSingle()
      if ((e as { partner_id: string | null } | null)?.partner_id) {
        const rr = await reassign(q.id, null, 'Priced by the desk for an integration test.')
        expect(rr.ok, rr.ok ? '' : rr.error).toBe(true)
      }
      const s = await sendQuote(q.id, { [lineId]: price }, day(14))
      expect(s.ok, s.ok ? '' : s.error).toBe(true)
      await as(BUYER)
      const a = await acceptQuote(q.id)
      expect(a.ok, a.ok ? '' : a.error).toBe(true)
      return { id: q.id, lineId }
    }

    const low = await quoteAt(P!.floor - 1, 'under floor')
    await as(OPERATOR)
    const note = `From an integration test quote ${MARKER}`
    const r1 = await supabase.rpc('promote_quote_line', { p_quote_line: low.lineId, p_note: note })
    expect(r1.error?.message).toMatch(/below the floor/)

    const good = await quoteAt(mid(0.8), 'inside band')
    await as(OPERATOR)
    const r2 = await supabase.rpc('promote_quote_line', { p_quote_line: good.lineId, p_note: note })
    expect(r2.error, r2.error?.message).toBeNull()
    const promoted = await priceRow(r2.data as string)
    expect(promoted.source).toBe('quote')
    expect(promoted.quote_ref).toBe(good.id)
    expect(Number(promoted.unit_price)).toBe(mid(0.8))
    const earlier = await priceRow(currentId)
    expect(earlier.ends_on).not.toBeNull()
    expect(earlier.ends_on! < promoted.starts_on).toBe(true)
    currentId = promoted.id
  }, 120000)

  it('9. ending a price says why, and an ended price cannot be ended again', async (ctx) => {
    skipUnlessApplied(ctx)
    await as(OPERATOR)
    let r = await supabase.rpc('end_account_price', { p_id: currentId, p_reason: '' })
    expect(r.error?.message).toMatch(/Say why/)
    r = await supabase.rpc('end_account_price', { p_id: currentId, p_reason: `Ended by the integration test ${MARKER}` })
    expect(r.error, r.error?.message).toBeNull()
    const row = await priceRow(currentId)
    expect(row.ends_on).not.toBeNull()
    expect(row.ends_on! < day(0)).toBe(true)        // ended yesterday, or withdrawn
    r = await supabase.rpc('end_account_price', { p_id: currentId, p_reason: 'Again.' })
    expect(r.error?.message).toMatch(/has already ended/)
  })
})

/** A price `share` of the way from P's floor to its published price, to the cent. */
function mid(share: number): number {
  return round2(P!.floor + (P!.book - P!.floor) * share)
}
