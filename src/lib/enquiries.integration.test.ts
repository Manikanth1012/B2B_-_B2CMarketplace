/* Touches the live Supabase project. Raises enquiries and requisitions and
 * removes every one of them again.
 *
 * Spec 6 §4. The rules under test live in the database — guard_enquiry,
 * guard_enquiry_line, guard_enquiry_slot, guard_enquiry_message,
 * guard_quoted_line and the policies — so they can only be checked against it.
 * Each persona signs in for real and asks the way its screen does
 * (enquiryRepo, raiseRequisition); where a test needs to try something the
 * repo would never send, it writes to the table or calls the RPC directly.
 *
 * Clean-up. Every enquiry this file raises has a subject starting `ITEST `, and
 * every requisition a title carrying `[itest-enquiries]`, so the sweep finds
 * them however the run ended. Requisitions go first (their lines point at the
 * quoted lines), then the enquiries — as the operator, whose policy covers
 * delete; lines, times, messages and events cascade. The seed (`ENQ-SEED-*`) is
 * only ever read.
 *
 * Left behind, by design: `notification_log` rows the triggers wrote. That
 * table is history and has no delete policy for anybody ("Nobody edits what was
 * sent"), so a client cannot remove them. They carry the deleted enquiry's id
 * in `ref` and nothing points at them.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { supabase } from './supabase'
import { signIn, signOut } from './authRepo'
import {
  loadEnquiries, raiseQuote, raiseDemo, raiseSales, sendQuote, acceptQuote,
  confirmSlot, markDone, reply, closeEnquiry, reassign,
} from './enquiryRepo'
import { loadAccount, raiseRequisition } from './enterpriseRepo'
import type { AccountBook } from './enterpriseRepo'
import { toRequisitionLines } from './enquiries'
import type { Enquiry } from './enquiries'

const OPERATOR = { email: 'anika.sharma@aventa.com', password: 'operator123' }
const BUYER = { email: 'vikram.shah@smartbuild.in', password: 'enterprise123' }      // SmartBuild, ENT-2007
const NIMBUS = { email: 'rajesh.kumar@nimbussensors.com', password: 'partner123' }   // PTR-1004, sells SKU-5004
const BEACON = { email: 'amara.okonkwo@example.com', password: 'partner123' }        // PTR-1009, another seller
const MERIDIAN = { email: 'omar.haddad@meridianfoods.ae', password: 'enterprise123' } // ENT-2012, another business

const NIMBUS_ID = 'PTR-1004'
/* SKU-5004 is the seed's Nimbus listing, but it is paused on the live shelf,
   and raise_quote rightly refuses a listing a business cannot buy. SKU-5003 is
   Nimbus's live IoT listing for businesses. */
const SEED_SENSOR = 'SKU-5004'
const SENSOR = 'SKU-5003'      // Nimbus; IoT, so a demo is offered
const FIREWALL = 'SKU-6001'    // another seller (PTR-1003), so a quote across both goes to the desk

const SUBJECT = 'ITEST '
const MARKER = '[itest-enquiries]'

type Creds = { email: string; password: string }
let who = ''
async function as(c: Creds) {
  if (who === c.email) return
  await signOut()
  await signIn(c.email, c.password)
  who = c.email
}

/** A date `days` from today in the database's calendar (UTC). */
function day(days: number): string {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

const pause = (ms: number) => new Promise(r => setTimeout(r, ms))

async function enquiry(id: string) {
  const { data, error } = await supabase.from('enquiries').select('*').eq('id', id).maybeSingle()
  expect(error).toBeNull()
  return data as Enquiry | null
}
async function linesOf(id: string) {
  const { data, error } = await supabase.from('enquiry_lines').select('*').eq('enquiry_id', id).order('sort_order')
  expect(error).toBeNull()
  return (data ?? []) as { id: string; product_id: string; quantity: number; quoted_unit_price: number | string | null; partner_id: string | null; name: string }[]
}
async function eventsOf(id: string) {
  const { data, error } = await supabase.from('enquiry_events').select('*').eq('enquiry_id', id).order('at')
  expect(error).toBeNull()
  return (data ?? []) as { action: string; note: string | null; actor_role: string; from_status: string | null; to_status: string | null }[]
}

/* ------------------------------------------------------------- the sweep -- */

async function sweep() {
  /* Requisitions first: their lines reference the quoted lines, and that
     foreign key does not cascade. The buyer can delete its own; the line
     guard lets the cascade through. */
  await as(BUYER)
  const { data: reqs, error: rErr } = await supabase.from('enterprise_requisitions')
    .select('id').like('title', `%${MARKER}%`)
  if (rErr) throw new Error(`could not list requisitions to sweep: ${rErr.message}`)
  for (const r of (reqs ?? []) as { id: string }[]) {
    const { data: gone, error } = await supabase.from('enterprise_requisitions').delete().eq('id', r.id).select('id')
    if (error) throw new Error(`could not sweep ${r.id}: ${error.message}`)
    if (!gone?.length) throw new Error(`sweeping ${r.id} removed nothing — it is still there`)
  }

  await as(OPERATOR)
  const { data: enqs, error: eErr } = await supabase.from('enquiries').select('id, subject').like('subject', `${SUBJECT}%`)
  if (eErr) throw new Error(`could not list enquiries to sweep: ${eErr.message}`)
  for (const e of (enqs ?? []) as { id: string }[]) {
    if (e.id.startsWith('ENQ-SEED-')) throw new Error(`refusing to sweep seed row ${e.id}`)
    const { data: gone, error } = await supabase.from('enquiries').delete().eq('id', e.id).select('id')
    if (error) throw new Error(`could not sweep ${e.id}: ${error.message}`)
    if (!gone?.length) throw new Error(`sweeping ${e.id} removed nothing — it is still there`)
  }
}

let book: AccountBook

beforeAll(async () => {
  await sweep()
  await as(BUYER)
  book = await loadAccount()
  expect(book.account, 'the buyer did not load an account').toBeTruthy()
  expect(book.me, 'the buyer is not on the account').toBeTruthy()
}, 90000)

afterAll(async () => {
  await sweep()
  /* And check it: nothing of ours is left, the seed is all there. */
  await as(OPERATOR)
  const { data: left } = await supabase.from('enquiries').select('id').like('subject', `${SUBJECT}%`)
  expect(left ?? [], 'test enquiries were left behind').toEqual([])
  const { data: seed } = await supabase.from('enquiries').select('id').like('id', 'ENQ-SEED-%')
  expect((seed ?? []).length, 'the seed lost a row').toBe(4)
  await signOut()
  who = ''
}, 90000)

/** The draft the requisition drawer sends, built from an accepted quote the way
    EnterpriseEnquiries adds it to the basket and RequisitionPanel raises it. */
function draftFrom(e: Enquiry, lines: Awaited<ReturnType<typeof linesOf>>, over: { unit_price?: number } = {}) {
  const ls = toRequisitionLines(e, lines.map(l => ({
    ...l, enquiry_id: e.id, target_unit_price: null, sort_order: 0,
    quantity: Number(l.quantity),
    quoted_unit_price: l.quoted_unit_price === null ? null : Number(l.quoted_unit_price),
  })) as never)
  return {
    title: `Quoted sensors ${MARKER}`,
    reason: 'Bought at the price the seller quoted.',
    currency: e.currency ?? book.account!.currency,
    vertical: 'iot',
    cost_centre: book.centres[0]?.id ?? null,
    model: 'oneoff' as const,
    po_ref: 'PO-ITEST-ENQ',
    lines: ls.map(l => ({
      product_id: l.product_id, name: l.name, seller: 'Nimbus Sensors',
      partner_id: l.partner_id, quantity: l.quantity,
      unit_price: over.unit_price ?? l.unit_price,
      quote_line_id: l.quote_line_id ?? null,
    })),
  }
}

async function raiseReq(draft: ReturnType<typeof draftFrom>) {
  /* raiseRequisition names the requisition from the clock in seconds, so two
     in the same second would collide on the id. */
  await pause(1100)
  return raiseRequisition({
    draft, me: book.me!, account: book.account!, policy: book.policy!,
    currencies: book.currencies, rates: book.rates,
  })
}

/* ============================================================ 1. the seed == */

describe('the seed is readable by the people it belongs to', () => {
  it('the business that asked sees all four', async () => {
    await as(BUYER)
    const b = await loadEnquiries()
    expect(b.loadError).toBeNull()
    const seed = b.enquiries.map(e => e.id).filter(id => id.startsWith('ENQ-SEED-')).sort()
    expect(seed).toEqual(['ENQ-SEED-1', 'ENQ-SEED-2', 'ENQ-SEED-3', 'ENQ-SEED-4'])
  })

  it("Nimbus sees the two routed to it, and none of the desk quote's lines directly", async () => {
    await as(NIMBUS)
    const b = await loadEnquiries()
    expect(b.loadError).toBeNull()
    const seed = b.enquiries.map(e => e.id).filter(id => id.startsWith('ENQ-SEED-')).sort()
    expect(seed, 'Nimbus reads a header that is not routed to it').toEqual(['ENQ-SEED-1', 'ENQ-SEED-2'])

    /* ENQ-SEED-4 is on the desk, across Nimbus and another seller. Since
       20261112300000 Nimbus reads none of its line rows (they carry the desk's
       price); it reads its own line through my_desk_quote_lines, which leaves
       the desk's price out. */
    expect(b.lines.filter(l => l.enquiry_id === 'ENQ-SEED-4')).toEqual([])
    const { data, error } = await supabase.rpc('my_desk_quote_lines')
    expect(error).toBeNull()
    const desk = ((data ?? []) as Record<string, unknown>[]).filter(l => l.enquiry_id === 'ENQ-SEED-4')
    expect(desk.map(l => l.product_id)).toEqual([SEED_SENSOR])
    expect(desk.every(l => !('quoted_unit_price' in l))).toBe(true)
    /* And none of the desk enquiry's conversation, times or history. */
    expect(b.messages.some(m => m.enquiry_id === 'ENQ-SEED-4')).toBe(false)
    expect(b.events.some(e => e.enquiry_id === 'ENQ-SEED-4')).toBe(false)
  })

  it('the other seller on the desk quote has no sign-in; a seller on none of it sees nothing', async () => {
    /* SKU-6001's seller (PTR-1003) has no demo login, so "each seller reads only
       its own line" is checked from Nimbus's side above, and here from a seller
       on neither line. */
    await as(BEACON)
    const b = await loadEnquiries()
    expect(b.loadError).toBeNull()
    expect(b.enquiries.filter(e => e.id.startsWith('ENQ-SEED-'))).toEqual([])
    expect(b.lines.filter(l => l.enquiry_id.startsWith('ENQ-SEED-'))).toEqual([])
  })

  it('the operator sees all four, and both lines of the desk quote', async () => {
    await as(OPERATOR)
    const b = await loadEnquiries()
    expect(b.loadError).toBeNull()
    const seed = b.enquiries.map(e => e.id).filter(id => id.startsWith('ENQ-SEED-')).sort()
    expect(seed).toEqual(['ENQ-SEED-1', 'ENQ-SEED-2', 'ENQ-SEED-3', 'ENQ-SEED-4'])
    expect(b.lines.filter(l => l.enquiry_id === 'ENQ-SEED-4').map(l => l.product_id).sort()).toEqual([SEED_SENSOR, FIREWALL].sort())
  })
})

/* ===================================================== 2. a quote, round == */

describe('a quote goes round: asked, priced, accepted, bought at that price', () => {
  let id = ''
  let lineId = ''
  const PRICE = 1234.5
  const QTY = 2

  it('the buyer asks Nimbus for a price and it is routed to Nimbus', async () => {
    await as(BUYER)
    const r = await raiseQuote({
      subject: `${SUBJECT}quote round trip`,
      lines: [{ product_id: SENSOR, quantity: QTY, target_unit_price: 1200 }],
      note: 'Integration test — removed afterwards.',
    })
    expect(r.ok, r.ok ? '' : r.error).toBe(true)
    if (!r.ok) return
    id = r.id
    const e = await enquiry(id)
    expect(e!.partner_id).toBe(NIMBUS_ID)
    expect(e!.status).toBe('submitted')
    expect(e!.currency).toBe(book.account!.currency)
    const ls = await linesOf(id)
    expect(ls).toHaveLength(1)
    expect(ls[0].quoted_unit_price).toBeNull()
    lineId = ls[0].id
  })

  it('Nimbus sends the quote: quoted, on the record, and the buyer told', async () => {
    expect(id, 'nothing was raised').not.toBe('')
    await as(NIMBUS)
    const r = await sendQuote(id, { [lineId]: PRICE }, day(14), 'Holds for the full quantity.')
    expect(r.ok, r.ok ? '' : r.error).toBe(true)

    const e = await enquiry(id)
    expect(e!.status).toBe('quoted')
    expect(e!.valid_until).toBe(day(14))
    expect(Number((await linesOf(id))[0].quoted_unit_price)).toBe(PRICE)

    const actions = (await eventsOf(id)).map(ev => ev.action)
    expect(actions).toContain('raised')
    expect(actions).toContain('quoted')

    /* The seller's own notice of the request arriving. */
    const { data: toSeller } = await supabase.from('notification_log')
      .select('kind_id, state, persona, ref').eq('ref', id).eq('persona', 'partner')
    expect((toSeller ?? []).length, 'Nimbus was not told the quote was asked').toBeGreaterThan(0)

    await as(BUYER)
    const { data: told, error } = await supabase.from('notification_log')
      .select('kind_id, state, persona, ref, subject').eq('ref', id).eq('persona', 'enterprise')
    expect(error).toBeNull()
    const inapp = (told ?? []).filter((n: { kind_id: string }) => n.kind_id === 'inapp') as { state: string; subject: string }[]
    expect(inapp.length, 'the buyer was not told the quote is ready').toBeGreaterThan(0)
    expect(inapp.every(n => n.state === 'delivered')).toBe(true)
    expect(inapp.some(n => /quote is ready/i.test(n.subject))).toBe(true)
  })

  it('the quote is not expired on read', async () => {
    await as(BUYER)
    const { data } = await supabase.from('enquiry_book').select('id, expired').eq('id', id).maybeSingle()
    expect((data as { expired: boolean } | null)?.expired).toBe(false)
  })

  it('the buyer accepts it', async () => {
    await as(BUYER)
    const r = await acceptQuote(id)
    expect(r.ok, r.ok ? '' : r.error).toBe(true)
    const e = await enquiry(id)
    expect(e!.status).toBe('accepted')
    expect(e!.decided_at).not.toBeNull()
    expect((await eventsOf(id)).map(ev => ev.action)).toContain('accepted')
  })

  it('a requisition line at a different price is refused', async () => {
    await as(BUYER)
    const e = (await enquiry(id))!
    const res = await raiseReq(draftFrom(e, await linesOf(id), { unit_price: PRICE - 100 }))
    expect(res.ok, 'a quoted line went on at a price it was not quoted at').toBe(false)
    if (!res.ok) expect(res.reason).toMatch(/was quoted at/i)
  }, 30000)

  it('the buyer raises a requisition carrying the quoted line, at the quoted price', async () => {
    await as(BUYER)
    const e = (await enquiry(id))!
    const res = await raiseReq(draftFrom(e, await linesOf(id)))
    expect(res.ok, res.ok ? '' : res.reason).toBe(true)

    const { data } = await supabase.from('enterprise_requisition_lines')
      .select('requisition_id, quote_line_id, unit_price, quantity').eq('quote_line_id', lineId)
    const rows = (data ?? []) as { unit_price: number; quantity: number }[]
    expect(rows).toHaveLength(1)
    expect(Number(rows[0].unit_price)).toBe(PRICE)
    expect(Number(rows[0].quantity)).toBe(QTY)
  }, 30000)

  it('the same quoted line on a second live requisition is refused', async () => {
    await as(BUYER)
    const e = (await enquiry(id))!
    const res = await raiseReq(draftFrom(e, await linesOf(id)))
    expect(res.ok, 'one quoted line was bought twice').toBe(false)
    if (!res.ok) expect(res.reason).toMatch(/already on a requisition/i)
    const { data } = await supabase.from('enterprise_requisition_lines').select('id').eq('quote_line_id', lineId)
    expect(data ?? []).toHaveLength(1)
  }, 30000)
})

/* ========================================================== 3. refusals == */

describe('what the guards refuse', () => {
  let id = ''
  let lineId = ''

  beforeAll(async () => {
    await as(BUYER)
    const r = await raiseQuote({ subject: `${SUBJECT}refusals`, lines: [{ product_id: SENSOR, quantity: 3 }] })
    expect(r.ok, r.ok ? '' : r.error).toBe(true)
    if (r.ok) id = r.id
    lineId = (await linesOf(id))[0].id
  }, 30000)

  it('the buyer cannot price its own line', async () => {
    await as(BUYER)
    const { error } = await supabase.from('enquiry_lines').update({ quoted_unit_price: 1 }).eq('id', lineId)
    expect(error, 'the buyer priced its own quote').not.toBeNull()
    expect(error!.message).toMatch(/Only whoever answers the quote can price it/)
  })

  it('the seller cannot price a line except through send_quote', async () => {
    await as(NIMBUS)
    const { error } = await supabase.from('enquiry_lines').update({ quoted_unit_price: 1 }).eq('id', lineId)
    expect(error, 'a price was written outside send_quote').not.toBeNull()
    expect(error!.message).toMatch(/send_quote/)
    expect((await linesOf(id))[0].quoted_unit_price).toBeNull()
  })

  it('the seller cannot move it to quoted except through send_quote', async () => {
    await as(NIMBUS)
    const { error } = await supabase.from('enquiries').update({ status: 'quoted', valid_until: day(10) }).eq('id', id)
    expect(error, 'a quote was marked quoted outside send_quote').not.toBeNull()
    expect(error!.message).toMatch(/send_quote/)
  })

  it('a quote dated in the past, or past ninety days, is refused', async () => {
    await as(NIMBUS)
    for (const d of [day(-1), day(0), day(91)]) {
      const r = await sendQuote(id, { [lineId]: 100 }, d)
      expect(r.ok, `a quote valid until ${d} was sent`).toBe(false)
      if (!r.ok) expect(r.error).toMatch(/between 1 and 90 days/)
    }
  })

  it('nobody can write the send_quote token table', async () => {
    for (const c of [NIMBUS, BUYER]) {
      await as(c)
      const { error } = await supabase.from('enquiry_rpc_tokens').insert({ txid: 1 })
      expect(error, `${c.email} wrote a send_quote token`).not.toBeNull()
      const { data } = await supabase.from('enquiry_rpc_tokens').select('txid')
      expect(data ?? []).toEqual([])
    }
  })

  it('a seller it was not routed to cannot read it or answer it', async () => {
    await as(BEACON)
    expect(await enquiry(id)).toBeNull()
    expect(await linesOf(id)).toEqual([])
    const q = await sendQuote(id, { [lineId]: 10 }, day(10))
    expect(q.ok).toBe(false)
    if (!q.ok) expect(q.error).toMatch(/not yours to quote/)
    const m = await reply(id, 'Let me take this one.')
    expect(m.ok, 'another seller joined the conversation').toBe(false)
    const d = await closeEnquiry(id)
    expect(d.ok).toBe(false)
    await as(OPERATOR)
    expect((await enquiry(id))!.status).toBe('submitted')
  })

  it('another business cannot read it or decide it', async () => {
    await as(MERIDIAN)
    expect(await enquiry(id)).toBeNull()
    expect(await linesOf(id)).toEqual([])
    const { data: seed } = await supabase.from('enquiries').select('id').like('id', 'ENQ-SEED-%')
    expect(seed ?? []).toEqual([])
    const w = await supabase.from('enquiries').update({ status: 'withdrawn' }).eq('id', id).select('id')
    expect(w.data ?? []).toEqual([])
    const m = await reply(id, 'Not mine to say.')
    expect(m.ok).toBe(false)
  })

  it('the buyer cannot insert an enquiry directly', async () => {
    await as(BUYER)
    const { data, error } = await supabase.from('enquiries').insert({
      type: 'sales', account_id: book.account!.id, raised_by: book.me!.id,
      subject: `${SUBJECT}direct insert`, status: 'open', contact_pref: 'email',
    }).select('id')
    expect(error, 'a buyer inserted an enquiry around raise_*').not.toBeNull()
    expect(error!.message).toMatch(/row-level security|permission/i)
    expect(data).toBeNull()
  })
})

/* ============================================================ 4. expiry == */

describe('an expired quote cannot be accepted', () => {
  /* There is no legitimate way to make one today: send_quote and the guard both
     refuse a valid-until before tomorrow (checked above), and every persona,
     the operator included, goes through them. Only the service role (null
     persona) could back-date one, and these tests do not hold it. The refusal
     text ("This quote ran out on …") is in guard_enquiry and guard_quoted_line;
     the boundary itself is covered in the pure module (isExpired /
     enquiryState / toRequisitionLines in enquiries.test.ts). What can be read
     live is that the seeded quote, dated 30 days out, is not expired. */
  it('the seeded quote reads as in date', async () => {
    await as(BUYER)
    const { data } = await supabase.from('enquiry_book').select('id, expired, valid_until').eq('id', 'ENQ-SEED-1').maybeSingle()
    const r = data as { expired: boolean; valid_until: string } | null
    expect(r).toBeTruthy()
    expect(r!.expired).toBe(r!.valid_until < day(0))
  })
})

/* ============================================================== 5. demo == */

describe('a demo is asked for, booked and done', () => {
  let id = ''

  it('the buyer offers two times and it goes to Nimbus', async () => {
    await as(BUYER)
    const d1 = new Date(Date.now() + 5 * 86400000).toISOString()
    const d2 = new Date(Date.now() + 6 * 86400000).toISOString()
    const r = await raiseDemo({ subject: `${SUBJECT}demo`, product_id: SENSOR, format: 'video', attendees: 4, slots: [d1, d2] })
    expect(r.ok, r.ok ? '' : r.error).toBe(true)
    if (!r.ok) return
    id = r.id
    const e = await enquiry(id)
    expect(e!.partner_id).toBe(NIMBUS_ID)
    expect(e!.status).toBe('requested')
    const { data: slots } = await supabase.from('enquiry_slots').select('*').eq('enquiry_id', id)
    expect(slots ?? []).toHaveLength(2)
    expect((slots ?? []).every((s: { proposed_by: string }) => s.proposed_by === 'buyer')).toBe(true)
  })

  it('Nimbus confirms one with a joining link and it is scheduled', async () => {
    await as(NIMBUS)
    const { data: slots } = await supabase.from('enquiry_slots').select('id').eq('enquiry_id', id).order('starts_at')
    expect(slots ?? []).toHaveLength(2)
    const r = await confirmSlot((slots![0] as { id: string }).id, 'https://meet.example/itest')
    expect(r.ok, r.ok ? '' : r.error).toBe(true)
    expect((await enquiry(id))!.status).toBe('scheduled')
    expect((await eventsOf(id)).map(e => e.action)).toContain('scheduled')
  })

  it('Nimbus marks it done', async () => {
    await as(NIMBUS)
    const r = await markDone(id)
    expect(r.ok, r.ok ? '' : r.error).toBe(true)
    expect((await enquiry(id))!.status).toBe('done')
  })
})

/* ============================================================= 6. sales == */

describe('a word with sales', () => {
  let id = ''

  it('goes to the desk', async () => {
    await as(BUYER)
    const r = await raiseSales({ subject: `${SUBJECT}sales`, message: 'Integration test question.', contact_pref: 'in_app' })
    expect(r.ok, r.ok ? '' : r.error).toBe(true)
    if (!r.ok) return
    id = r.id
    const e = await enquiry(id)
    expect(e!.partner_id).toBeNull()
    expect(e!.status).toBe('open')
  })

  it('the desk replies and it is answered', async () => {
    await as(OPERATOR)
    const r = await reply(id, 'Answered by the desk.')
    expect(r.ok, r.ok ? '' : r.error).toBe(true)
    expect((await enquiry(id))!.status).toBe('answered')
  })

  it('the buyer replies and it is open again', async () => {
    await as(BUYER)
    const r = await reply(id, 'One more thing.')
    expect(r.ok, r.ok ? '' : r.error).toBe(true)
    expect((await enquiry(id))!.status).toBe('open')
    expect((await eventsOf(id)).map(e => e.action)).toContain('reopened')
  })

  it('the buyer closes it, and it takes no more messages', async () => {
    await as(BUYER)
    const c = await closeEnquiry(id)
    expect(c.ok, c.ok ? '' : c.error).toBe(true)
    expect((await enquiry(id))!.status).toBe('closed')
    const m = await reply(id, 'And another.')
    expect(m.ok, 'a closed enquiry took a message').toBe(false)
    if (!m.ok) expect(m.error).toMatch(/is closed/)
  })
})

/* ========================================================== 7. reassign == */

describe('the desk passes an enquiry on, with a reason', () => {
  let id = ''

  beforeAll(async () => {
    await as(BUYER)
    const r = await raiseQuote({
      subject: `${SUBJECT}reassign`,
      lines: [{ product_id: SENSOR, quantity: 1 }, { product_id: FIREWALL, quantity: 1 }],
    })
    expect(r.ok, r.ok ? '' : r.error).toBe(true)
    if (r.ok) id = r.id
  }, 30000)

  it('a quote across two sellers lands on the desk', async () => {
    await as(OPERATOR)
    expect((await enquiry(id))!.partner_id).toBeNull()
  })

  it('without a reason it is refused', async () => {
    await as(OPERATOR)
    for (const reason of ['', '   ']) {
      const r = await reassign(id, NIMBUS_ID, reason)
      expect(r.ok, 'reassigned with no reason').toBe(false)
      if (!r.ok) expect(r.error).toMatch(/Say why/)
    }
    expect((await enquiry(id))!.partner_id).toBeNull()
  })

  it('nor by writing partner_id directly', async () => {
    await as(OPERATOR)
    const { error } = await supabase.from('enquiries').update({ partner_id: NIMBUS_ID }).eq('id', id)
    expect(error, 'partner_id was written with no reason on record').not.toBeNull()
    expect(error!.message).toMatch(/reassign_enquiry/)
  })

  it('with a reason it moves, and the reason is on the record', async () => {
    await as(OPERATOR)
    const reason = 'Nimbus will price both — ITEST'
    const r = await reassign(id, NIMBUS_ID, reason)
    expect(r.ok, r.ok ? '' : r.error).toBe(true)
    expect((await enquiry(id))!.partner_id).toBe(NIMBUS_ID)
    const ev = (await eventsOf(id)).find(e => e.action.startsWith('reassigned to'))
    expect(ev, 'no reassignment event').toBeTruthy()
    expect(ev!.note).toBe(reason)
    expect(ev!.actor_role).toBe('operator')

    /* And the seller it went to can now read it. */
    await as(NIMBUS)
    expect(await enquiry(id)).not.toBeNull()
  })

  it('only the operator can reassign', async () => {
    await as(BUYER)
    const r = await reassign(id, null, 'Back to the desk please')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/Only the marketplace/)
  })
})
