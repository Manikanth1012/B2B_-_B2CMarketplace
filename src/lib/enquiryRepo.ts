// The only module that reads or writes enquiries.
//
// Every rule that matters lives in the database (guard_enquiry and friends), so
// nothing here decides whether a move is allowed: it asks, and hands back the
// database's own words when the answer is no. No function throws, and none
// reports success it did not see — a write that changes no row (row-level
// security hides rows it will not let you touch) is an error, not an "ok".

import { supabase } from './supabase'
import type { Enquiry, EnquiryLine, EnquirySlot, EnquiryMessage } from './enquiries'
import { quoteLinesPayload, asLine } from './enquiryPayload'

export interface EnquiryEvent {
  id: string; enquiry_id: string; actor_role: string; actor_name: string
  action: string; from_status: string | null; to_status: string | null
  note: string | null; at: string
}

export interface EnquiryBook {
  enquiries: Enquiry[]; lines: EnquiryLine[]; slots: EnquirySlot[]
  messages: EnquiryMessage[]; events: EnquiryEvent[]; loadError: string | null
}

type Result = { ok: true } | { ok: false; error: string }
type IdResult = { ok: true; id: string } | { ok: false; error: string }

const NOTHING = 'Nothing changed — you are not allowed to make that change, or it no longer exists.'

/** Everything the signed-in persona can see; RLS does the scoping. */
export async function loadEnquiries(): Promise<EnquiryBook> {
  try {
    const [e, l, s, m, ev] = await Promise.all([
      supabase.from('enquiries').select('*').order('created_at', { ascending: false }),
      supabase.from('enquiry_lines').select('*').order('sort_order'),
      supabase.from('enquiry_slots').select('*').order('starts_at'),
      supabase.from('enquiry_messages').select('*').order('created_at'),
      supabase.from('enquiry_events').select('*').order('at'),
    ])
    const errors: string[] = []
    const grab = <T>(res: { data: unknown; error: { message: string } | null }, what: string): T[] => {
      if (res.error) errors.push(`${what}: ${res.error.message}`)
      return (res.data ?? []) as T[]
    }
    return {
      enquiries: grab<Enquiry>(e, 'enquiries'),
      lines: grab<Record<string, unknown>>(l, 'lines').map(asLine),
      slots: grab<EnquirySlot>(s, 'times'),
      messages: grab<EnquiryMessage>(m, 'messages'),
      events: grab<EnquiryEvent>(ev, 'history'),
      loadError: errors.length ? `Some of this did not load (${errors.join('; ')}).` : null,
    }
  } catch (err) {
    return { enquiries: [], lines: [], slots: [], messages: [], events: [], loadError: errorText(err) }
  }
}

/* ---------------------------------------------------------------- raising -- */

export async function raiseQuote(input: {
  subject: string
  lines: { product_id: string; quantity: number; target_unit_price?: number | null }[]
  needed_by?: string | null
  note?: string | null
}): Promise<IdResult> {
  return rpcId('raise_quote', {
    p_subject: input.subject,
    p_lines: quoteLinesPayload(input.lines),
    p_needed_by: input.needed_by ?? null,
    p_note: input.note ?? null,
  })
}

export async function raiseDemo(input: {
  subject: string; product_id: string; format: 'video' | 'onsite'
  attendees: number; slots: string[]; note?: string | null
}): Promise<IdResult> {
  return rpcId('raise_demo', {
    p_subject: input.subject,
    p_product_id: input.product_id,
    p_format: input.format,
    p_attendees: input.attendees,
    p_slots: input.slots,
    p_note: input.note ?? null,
  })
}

export async function raiseSales(input: {
  subject: string; message: string; contact_pref: 'email' | 'phone' | 'in_app'
}): Promise<IdResult> {
  return rpcId('raise_sales', {
    p_subject: input.subject,
    p_message: input.message,
    p_contact_pref: input.contact_pref,
  })
}

/* ----------------------------------------------------------- answering -- */

/** Price every line, then move the quote to `quoted` with its date. Sending the
    same call again on a quoted quote is a re-quote. The prices are written
    first because the guard refuses `quoted` while any line is unpriced. A note,
    if given, goes into the conversation once the quote is out. */
export async function sendQuote(
  id: string, prices: Record<string, number>, valid_until: string, note?: string | null,
): Promise<Result> {
  try {
    for (const [lineId, price] of Object.entries(prices)) {
      const r = await supabase.from('enquiry_lines')
        .update({ quoted_unit_price: price }).eq('id', lineId).eq('enquiry_id', id).select('id')
      if (r.error) return { ok: false, error: r.error.message }
      if (!r.data?.length) return { ok: false, error: NOTHING }
    }
    const moved = await change(id, { status: 'quoted', valid_until })
    if (!moved.ok) return moved
    if (note && note.trim()) {
      const said = await reply(id, note)
      if (!said.ok) return { ok: false, error: `The quote was sent, but the note was not: ${said.error}` }
    }
    return { ok: true }
  } catch (err) {
    return { ok: false, error: errorText(err) }
  }
}

/** Status only. The screen then adds the lines to the requisition, where
    guard_quoted_line holds each to the quoted price. */
export const acceptQuote = (id: string): Promise<Result> => change(id, { status: 'accepted' })

export const decline = (id: string, reason: string): Promise<Result> =>
  change(id, { status: 'declined', decline_reason: reason })

export const withdraw = (id: string): Promise<Result> => change(id, { status: 'withdrawn' })

export const markDone = (id: string): Promise<Result> => change(id, { status: 'done' })

export const closeEnquiry = (id: string): Promise<Result> => change(id, { status: 'closed' })

/** Confirming a time moves the demo to `scheduled` (a trigger does that). The
    place is the seller's to give: when the time already carries one — the
    seller proposed it — only `confirmed` is sent, because the guard refuses the
    buyer changing it. */
export async function confirmSlot(slotId: string, location: string): Promise<Result> {
  try {
    const cur = await supabase.from('enquiry_slots').select('location').eq('id', slotId).maybeSingle()
    if (cur.error) return { ok: false, error: cur.error.message }
    if (!cur.data) return { ok: false, error: NOTHING }
    const has = ((cur.data as { location: string | null }).location ?? '').trim() !== ''
    const patch = has ? { confirmed: true } : { confirmed: true, location }
    const r = await supabase.from('enquiry_slots').update(patch).eq('id', slotId).select('id')
    if (r.error) return { ok: false, error: r.error.message }
    if (!r.data?.length) return { ok: false, error: NOTHING }
    return { ok: true }
  } catch (err) {
    return { ok: false, error: errorText(err) }
  }
}

/** Offer another time. Who is proposing is taken from who is signed in. A
    seller proposing should say where it would be, since the buyer cannot. */
export async function proposeSlot(enquiryId: string, starts_at: string, location?: string | null): Promise<Result> {
  try {
    const row: Record<string, unknown> = { enquiry_id: enquiryId, starts_at }
    if (location && location.trim()) row.location = location.trim()
    const { error } = await supabase.from('enquiry_slots').insert(row)
    return error ? { ok: false, error: error.message } : { ok: true }
  } catch (err) {
    return { ok: false, error: errorText(err) }
  }
}

/** Add to the conversation. The author's role and name come from the session,
    not from anything sent here. */
export async function reply(id: string, body: string): Promise<Result> {
  try {
    const { error } = await supabase.from('enquiry_messages').insert({ enquiry_id: id, body: body.trim() })
    return error ? { ok: false, error: error.message } : { ok: true }
  } catch (err) {
    return { ok: false, error: errorText(err) }
  }
}

/** Operator only. Goes through reassign_enquiry: a direct write of partner_id is
    refused for want of a reason on record. */
export async function reassign(id: string, partner_id: string | null, reason: string): Promise<Result> {
  try {
    const { error } = await supabase.rpc('reassign_enquiry', {
      p_id: id, p_partner_id: partner_id, p_reason: reason,
    })
    return error ? { ok: false, error: error.message } : { ok: true }
  } catch (err) {
    return { ok: false, error: errorText(err) }
  }
}

/* ------------------------------------------------------------- plumbing -- */

async function change(id: string, patch: Record<string, unknown>): Promise<Result> {
  try {
    const { data, error } = await supabase.from('enquiries').update(patch).eq('id', id).select('id')
    if (error) return { ok: false, error: error.message }
    if (!data?.length) return { ok: false, error: NOTHING }
    return { ok: true }
  } catch (err) {
    return { ok: false, error: errorText(err) }
  }
}

async function rpcId(fn: string, args: Record<string, unknown>): Promise<IdResult> {
  try {
    const { data, error } = await supabase.rpc(fn, args)
    if (error) return { ok: false, error: error.message }
    if (typeof data !== 'string' || !data) return { ok: false, error: 'The database did not say what the enquiry was called.' }
    return { ok: true, id: data }
  } catch (err) {
    return { ok: false, error: errorText(err) }
  }
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
