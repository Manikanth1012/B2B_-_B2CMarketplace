/* Touches the live Supabase project. Raises quotes and removes every one of
 * them again.
 *
 * 20261112200000_a_seller_prices_its_part_of_a_desk_quote.sql: the seller of a
 * line on a desk quote proposes a unit price for it through
 * propose_line_price, and only that way; it lives in enquiry_line_proposals,
 * which the desk and that seller read and the buyer does not; the desk is
 * told. The rules live in the rpc, the policies and guard_line_proposal, so
 * they can only be checked against the database.
 *
 * Skipped, saying why, until that migration is applied: my_desk_quote_lines is
 * called, and a function the database cannot find means it is not there yet.
 * Any other error fails loudly.
 *
 * Clean-up, in afterAll and again at the start in case a run died: the
 * operator deletes every enquiry whose subject starts with the prefix; lines,
 * proposals, messages and events cascade. Left behind, by design, as in
 * enquiries.integration.test.ts: the notification_log rows, which nobody may
 * delete. They carry the deleted enquiry's id in `ref`.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { supabase } from './supabase'
import { signIn, signOut } from './authRepo'
import { raiseQuote, sendQuote, loadMyDeskQuoteLines, proposeLinePrice, loadLineProposals } from './enquiryRepo'
import { isMissingFunction } from './enquiryPayload'

const OPERATOR = { email: 'anika.sharma@aventa.com', password: 'operator123' }
const BUYER = { email: 'vikram.shah@smartbuild.in', password: 'enterprise123' }      // SmartBuild, ENT-2007
const NIMBUS = { email: 'rajesh.kumar@nimbussensors.com', password: 'partner123' }   // PTR-1004, sells SKU-5003

const NIMBUS_ID = 'PTR-1004'
const SENSOR = 'SKU-5003'      // Nimbus, live for businesses
const FIREWALL = 'SKU-6001'    // another seller, so a quote across both goes to the desk
const SUBJECT = 'ITEST-SP '

type Creds = { email: string; password: string }
let who = ''
async function as(c: Creds) {
  if (who === c.email) return
  await signOut()
  who = ''
  await signIn(c.email, c.password)
  who = c.email
}

function day(days: number): string {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

async function sweep() {
  await as(OPERATOR)
  const { data, error } = await supabase.from('enquiries').select('id').like('subject', `${SUBJECT}%`)
  if (error) throw new Error(`could not list enquiries to sweep: ${error.message}`)
  for (const e of (data ?? []) as { id: string }[]) {
    if (e.id.startsWith('ENQ-SEED-')) throw new Error(`refusing to sweep seed row ${e.id}`)
    const { data: gone, error: dErr } = await supabase.from('enquiries').delete().eq('id', e.id).select('id')
    if (dErr) throw new Error(`could not sweep ${e.id}: ${dErr.message}`)
    if (!gone?.length) throw new Error(`sweeping ${e.id} removed nothing — it is still there`)
  }
}

async function linesOf(id: string) {
  const { data, error } = await supabase.from('enquiry_lines').select('*').eq('enquiry_id', id).order('sort_order')
  expect(error).toBeNull()
  return (data ?? []) as ({ id: string; product_id: string } & Record<string, unknown>)[]
}

let applied = false
let skipReason = ''
let deskId = ''
let soloId = ''
let sensorLine = ''
let firewallLine = ''
let floor = 0

beforeAll(async () => {
  await as(NIMBUS)
  const { error } = await supabase.rpc('my_desk_quote_lines')
  if (error) {
    if (isMissingFunction(error)) {
      skipReason = 'Skipped: there is no my_desk_quote_lines, so 20261112200000_a_seller_prices_its_part_of_a_desk_quote.sql has not been applied yet.'
      return
    }
    throw new Error(`my_desk_quote_lines could not be called: ${error.message}`)
  }
  applied = true
  await sweep()

  await as(BUYER)
  const desk = await raiseQuote({
    subject: `${SUBJECT}sensors and firewalls`,
    lines: [{ product_id: SENSOR, quantity: 10 }, { product_id: FIREWALL, quantity: 2 }],
  })
  if (!desk.ok) throw new Error(`could not raise the desk quote: ${desk.error}`)
  deskId = desk.id
  const solo = await raiseQuote({ subject: `${SUBJECT}sensors only`, lines: [{ product_id: SENSOR, quantity: 5 }] })
  if (!solo.ok) throw new Error(`could not raise the single-seller quote: ${solo.error}`)
  soloId = solo.id

  await as(OPERATOR)
  const lines = await linesOf(deskId)
  sensorLine = lines.find(l => l.product_id === SENSOR)!.id
  firewallLine = lines.find(l => l.product_id === FIREWALL)!.id
}, 120000)

afterAll(async () => {
  if (applied) await sweep()
  await signOut()
}, 120000)

function skipUnlessApplied(ctx: { skip: () => void }) {
  if (!applied) {
    console.warn(skipReason)
    ctx.skip()
  }
}

describe("a seller prices its part of a desk quote", () => {
  it('1. the seller sees its own line on the desk quote, and not the other seller\'s', async (ctx) => {
    skipUnlessApplied(ctx)
    await as(NIMBUS)
    const r = await loadMyDeskQuoteLines()
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const mine = r.lines.filter(l => l.enquiry_id === deskId)
    expect(mine.map(l => l.line_id)).toEqual([sensorLine])
    expect(mine[0].status).toBe('submitted')
    expect(mine[0].currency).toBeTruthy()
    floor = mine[0].floor_price ?? 0
    /* The single-seller quote is Nimbus's own, not a desk quote. */
    expect(r.lines.some(l => l.enquiry_id === soloId)).toBe(false)
  })

  it("2. is refused on another seller's line, at nought, and under its floor", async (ctx) => {
    skipUnlessApplied(ctx)
    await as(NIMBUS)
    let r = await proposeLinePrice(firewallLine, 100)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/not one of yours on a desk quote/)
    r = await proposeLinePrice(sensorLine, 0)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/above zero/)
    if (floor > 0) {
      r = await proposeLinePrice(sensorLine, Math.max(0.01, floor - 1))
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.error).toMatch(/below the minimum you agreed/)
    }
  })

  it('3. is refused on its own single-seller quote, which it sends itself', async (ctx) => {
    skipUnlessApplied(ctx)
    await as(OPERATOR)
    const solo = await linesOf(soloId)
    await as(NIMBUS)
    const r = await proposeLinePrice(solo[0].id, 1000)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/routed to you/)
  })

  it('4. proposes a price and a note; the desk sees them on the line and is told', async (ctx) => {
    skipUnlessApplied(ctx)
    await as(NIMBUS)
    const price = Math.max(floor, 100) + 1
    const r = await proposeLinePrice(sensorLine, price, 'Includes pairing on site.')
    expect(r).toEqual({ ok: true })

    await as(OPERATOR)
    const desk = await loadLineProposals(deskId)
    expect(desk.ok).toBe(true)
    if (!desk.ok) return
    expect(Object.keys(desk.proposals)).toEqual([sensorLine])
    expect(desk.proposals[sensorLine].unit_price).toBe(price)
    expect(desk.proposals[sensorLine].note).toBe('Includes pairing on site.')
    expect(desk.proposals[sensorLine].partner_id).toBe(NIMBUS_ID)

    const { data, error } = await supabase.from('notification_log').select('rule_id, ref')
      .eq('ref', deskId).eq('rule_id', 'NR-O-ENQ-SELLER-PRICED')
    expect(error).toBeNull()
    expect((data ?? []).length).toBeGreaterThan(0)

    /* The seller reads its own back, through the table and through its rpc. */
    await as(NIMBUS)
    const own = await supabase.from('enquiry_line_proposals').select('line_id').eq('enquiry_id', deskId)
    expect(own.error).toBeNull()
    expect((own.data ?? []).map(r => (r as { line_id: string }).line_id)).toEqual([sensorLine])
    const mine = await loadMyDeskQuoteLines()
    expect(mine.ok && mine.lines.find(l => l.line_id === sensorLine)?.seller_unit_price).toBe(price)
  })

  it('5. the buyer sees none of it: not in the table, not on its lines', async (ctx) => {
    skipUnlessApplied(ctx)
    await as(BUYER)
    const p = await supabase.from('enquiry_line_proposals').select('*').eq('enquiry_id', deskId)
    expect(p.error).toBeNull()
    expect(p.data ?? []).toEqual([])
    const lines = await linesOf(deskId)
    expect(lines).toHaveLength(2)
    for (const l of lines) {
      expect(Object.keys(l).some(k => k.startsWith('seller_') || k === 'proposal')).toBe(false)
    }
  })

  it('6. nobody writes a proposal directly: not the seller, the desk or the buyer', async (ctx) => {
    skipUnlessApplied(ctx)
    const row = { line_id: firewallLine, enquiry_id: deskId, partner_id: NIMBUS_ID, unit_price: 1, proposed_by: 'x' }
    for (const c of [NIMBUS, OPERATOR, BUYER]) {
      await as(c)
      const ins = await supabase.from('enquiry_line_proposals').insert(row).select('line_id')
      expect(ins.error, `${c.email} inserted a proposal`).not.toBeNull()
      const upd = await supabase.from('enquiry_line_proposals').update({ unit_price: 1 }).eq('line_id', sensorLine).select('line_id')
      expect(upd.error !== null || (upd.data ?? []).length === 0, `${c.email} updated a proposal`).toBe(true)
    }
    await as(OPERATOR)
    const desk = await loadLineProposals(deskId)
    expect(desk.ok && Object.keys(desk.proposals)).toEqual([sensorLine])
    expect(desk.ok && desk.proposals[sensorLine].unit_price).toBe(Math.max(floor, 100) + 1)
  })

  it('7. once the desk has sent the quote, the seller can no longer propose', async (ctx) => {
    skipUnlessApplied(ctx)
    await as(OPERATOR)
    const sent = await sendQuote(deskId, { [sensorLine]: Math.max(floor, 100) + 1, [firewallLine]: 500 }, day(14))
    expect(sent).toEqual({ ok: true })
    await as(NIMBUS)
    const r = await proposeLinePrice(sensorLine, Math.max(floor, 100) + 5)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/already answered/)
  })
})
