/* Touches the live Supabase project.
 *
 * A dispute lives in two places at once: a flag at the source that changes
 * behaviour there — an invoice that stops chasing, a note that stops settling —
 * and a case that holds who owns the answer and when it is due. Two records of
 * one fact drift, and the way they drift is silent: an invoice frozen for ever
 * because the case was closed and nothing told it, or a case sitting in the
 * queue for something nobody is disputing any more.
 *
 * The triggers are what stop that, in one direction each: raising at the source
 * opens a case, closing the case releases the source. These tests make both
 * moves for real and check the other end.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { supabase } from './supabase'
import { signIn, signOut } from './authRepo'
import { loadDisputeBook, closeDispute, reassign } from './disputesRepo'
import type { DisputeBook } from './disputesRepo'
import {
  isClosed, withholding, workQueue, atStake, disputeProblems, outcomesFor, record,
} from './disputes'

const OPERATOR = { email: 'anika.sharma@aventa.com', password: 'operator123' }
const PARTNER = { email: 'rajesh.kumar@nimbussensors.com', password: 'partner123' }
const TODAY = new Date().toISOString().slice(0, 10)

describe('the dispute book the desk works from', () => {
  let book: DisputeBook

  beforeAll(async () => {
    await signIn(OPERATOR.email, OPERATOR.password)
    book = await loadDisputeBook()
  })
  afterAll(async () => { await signOut() })

  it('loads', () => {
    expect(book.loadError).toBeUndefined()
    expect(book.disputes.length).toBeGreaterThan(0)
  })

  it('gives every amount back as a number', () => {
    for (const d of book.disputes) {
      expect(typeof d.amount, `${d.id} amount`).toBe('number')
    }
  })

  /* Four kinds, so no case on the screen is drawn against nothing. Three of them
     had no home at all before this. */
  it('has a case of every kind', () => {
    const kinds = new Set(book.disputes.map(d => d.kind))
    for (const k of ['order', 'invoice', 'statement', 'note']) {
      expect(kinds.has(k as never), `nothing is disputing ${k}`).toBe(true)
    }
  })

  it('agrees with every source flag, in both directions', () => {
    expect(disputeProblems(book.disputes, book.flagged)).toEqual([])
  })

  it('points every case at something that exists', () => {
    for (const d of book.disputes) {
      const s = book.subjects.find(x => x.kind === d.kind && x.ref === d.subject_ref)
      expect(s, `${d.id} points at ${d.kind} ${d.subject_ref}, which is not there`).toBeTruthy()
    }
  })

  /* An amount with no currency is a figure nobody can add up, and it was the
     state every dispute was in before `20260808300000`. */
  it('quotes every claim in the currency of the thing it is about', () => {
    for (const d of book.disputes) {
      expect(d.currency, `${d.id} has no currency`).toBeTruthy()
      const s = book.subjects.find(x => x.kind === d.kind && x.ref === d.subject_ref)!
      expect(d.currency, `${d.id} claims ${d.currency} against a ${s.currency} ${d.kind}`)
        .toBe(s.currency)
    }
  })

  it('claims no more than the thing is worth', () => {
    for (const d of book.disputes) {
      const s = book.subjects.find(x => x.kind === d.kind && x.ref === d.subject_ref)!
      expect(d.amount, `${d.id} claims ${d.amount} against a ${s.amount} ${d.kind}`)
        .toBeLessThanOrEqual(s.amount + 0.02)
    }
  })

  it('gives every open case a clock and an owner', () => {
    const live = book.disputes.filter(d => !isClosed(d))
    expect(live.length).toBeGreaterThan(0)
    for (const d of live) {
      expect(d.due_on, `${d.id} has no date on it, so nobody is ever late`).toBeTruthy()
      expect(d.owner, `${d.id} is owned by nobody`).toBeTruthy()
    }
  })

  it('gives every closed case an outcome and an answer', () => {
    const closed = book.disputes.filter(isClosed)
    expect(closed.length).toBeGreaterThan(0)
    for (const d of closed) {
      expect(d.outcome, `${d.id} is closed and nobody can tell who paid`).toBeTruthy()
      expect((d.resolution ?? '').trim(), `${d.id} is closed with no answer`).not.toBe('')
    }
  })

  it('has somebody genuinely unpaid, so the queue’s own ordering means something', () => {
    const bleeding = book.disputes.filter(withholding)
    expect(bleeding.length, 'nothing is withholding, so the ranking is untested').toBeGreaterThan(0)
    const q = workQueue(book.disputes, TODAY)
    expect(withholding(q[0]), 'the top of the queue is not somebody who is unpaid').toBe(true)
  })

  it('reports what is at stake without adding two currencies together', () => {
    const s = atStake(book.disputes, TODAY)
    const all = [...s.withheld, ...s.claimed]
    expect(all.length).toBeGreaterThan(1)
    for (const g of all) expect(g.total.currency).toBe(g.currency)
  })

  it('has a record worth reporting', () => {
    const r = record(book.disputes)
    expect(r.closed).toBeGreaterThan(0)
    expect(r.upheldPct).not.toBeNull()
    expect(r.medianDays).not.toBeNull()
  })
})

describe('the flag and the case, kept in step', () => {
  beforeAll(async () => { await signIn(OPERATOR.email, OPERATOR.password) })
  afterAll(async () => { await signOut() })

  /* Raising at the source opens a case. Without this, disputing an invoice is
     what it was before: a status change nobody reads. */
  it('opens a case when an invoice is disputed, and closes nothing else', async () => {
    const before = await loadDisputeBook()
    const target = before.subjects.find(s =>
      s.kind === 'invoice' && (s.state === 'open' || s.state === 'overdue'))!
    expect(target, 'no payable invoice to dispute').toBeTruthy()

    await supabase.from('enterprise_invoices')
      .update({ status: 'disputed', note: 'Integration test — disputed to check a case opens.' })
      .eq('id', target.ref)

    const after = await loadDisputeBook()
    const made = after.disputes.find(d => d.kind === 'invoice' && d.subject_ref === target.ref)
    expect(made, `disputing ${target.ref} opened no case`).toBeTruthy()
    expect(made!.amount).toBe(target.amount)
    expect(made!.currency).toBe(target.currency)
    expect(made!.due_on).toBeTruthy()
    expect(made!.detail).toMatch(/Integration test/)
    expect(after.disputes.length).toBe(before.disputes.length + 1)

    /* Closing the case releases the invoice — the other direction, and the one
       that stops an answered dispute leaving an invoice frozen for ever. */
    const closed = await closeDispute(made!.id, 'partial', 'Integration test — half allowed, half stands.')
    expect(closed.ok, closed.why).toBe(true)

    const { data } = await supabase.from('enterprise_invoices')
      .select('status').eq('id', target.ref).single()
    expect((data as { status: string }).status,
      `${target.ref} is still disputed after its case was closed`).not.toBe('disputed')

    /* Put it back exactly as it was, so the file runs twice. */
    await supabase.from('enterprise_invoices')
      .update({ status: target.state, note: null }).eq('id', target.ref)
    await supabase.from('disputes').delete().eq('id', made!.id)
  })

  it('raises no second case for something already being disputed', async () => {
    const book = await loadDisputeBook()
    const live = book.disputes.find(d => d.kind === 'note' && !isClosed(d))
    if (!live) throw new Error('no open note dispute, so this is untested')

    const before = (await loadDisputeBook()).disputes.length
    /* Set the note to disputed again. The trigger fires on the transition, and
       `open_dispute` refuses a second open case for one subject either way. */
    await supabase.from('settlement_note')
      .update({ state: 'disputed', dispute_note: 'Same argument, said twice.' })
      .eq('id', live.subject_ref)
    expect((await loadDisputeBook()).disputes.length).toBe(before)
  })

  /* The whole reason the note case carries an outcome: it decides whether the
     adjustment survives, and the two answers are opposite. */
  it('voids the adjustment when the seller wins, and reinstates it when they do not', async () => {
    const book = await loadDisputeBook()
    const c = book.disputes.find(d => d.kind === 'note' && !isClosed(d))!
    const { data: was } = await supabase.from('settlement_note')
      .select('*').eq('id', c.subject_ref).single()

    const r = await closeDispute(c.id, 'upheld_seller',
      'Integration test — proof of delivery accepted, the chargeback should be defended with the issuer.')
    expect(r.ok, r.why).toBe(true)

    const { data: now } = await supabase.from('settlement_note')
      .select('state,void_reason').eq('id', c.subject_ref).single()
    expect((now as { state: string }).state,
      'the seller won and the note still stands against them').toBe('void')
    expect((now as { void_reason: string }).void_reason).toMatch(/Integration test/)

    /* Back to where it was, both halves — and the case first.
     *
     * The other order fails, and the failure is the model working. Putting the
     * note back to `disputed` fires `dispute_from_note`, which finds no OPEN
     * case (this one is closed) and opens a second; re-opening the first then
     * breaks `disputes_one_open_per_subject` and is silently refused. Restoring
     * the case first means the trigger finds it and returns it. */
    await supabase.from('disputes').update({
      status: c.status, outcome: null, resolution: null, resolved_on: null,
    }).eq('id', c.id)
    await supabase.from('settlement_note').update({
      state: 'disputed',
      void_reason: (was as { void_reason: string | null }).void_reason,
      void_on: (was as { void_on: string | null }).void_on,
    }).eq('id', c.subject_ref)

    const back = await loadDisputeBook()
    expect(back.disputes.find(d => d.id === c.id)!.status).toBe(c.status)
  })

  it('unfreezes a statement when its case is decided', async () => {
    const book = await loadDisputeBook()
    const c = book.disputes.find(d => d.kind === 'statement' && !isClosed(d))!
    expect(c, 'no open statement dispute').toBeTruthy()

    const r = await closeDispute(c.id, 'upheld_seller',
      'Integration test — the statement is correct as cut.')
    expect(r.ok, r.why).toBe(true)

    const { data } = await supabase.from('settlement_statements')
      .select('disputed').eq('id', c.subject_ref).single()
    expect((data as { disputed: boolean }).disputed,
      `${c.subject_ref} is still frozen after its case was decided`).toBe(false)

    /* The case first, for the same reason as the note above. */
    await supabase.from('disputes').update({
      status: c.status, outcome: null, resolution: null, resolved_on: null,
    }).eq('id', c.id)
    await supabase.from('settlement_statements').update({ disputed: true }).eq('id', c.subject_ref)
  })
})

describe('what the database refuses whatever the screen says', () => {
  let book: DisputeBook

  beforeAll(async () => {
    await signIn(OPERATOR.email, OPERATOR.password)
    book = await loadDisputeBook()
  })
  afterAll(async () => { await signOut() })

  it('refuses to close one with no answer on it', async () => {
    const c = book.disputes.find(d => !isClosed(d))!
    const { error } = await supabase.from('disputes')
      .update({ status: 'resolved', outcome: 'refunded', resolution: '   ' }).eq('id', c.id)
    expect(error, 'a dispute was closed with nothing said to the person who raised it').toBeTruthy()
    expect(error!.message).toMatch(/nobody answered/)
  })

  it('refuses to close one with no outcome, because nobody could tell who paid', async () => {
    const c = book.disputes.find(d => !isClosed(d))!
    const { error } = await supabase.from('disputes')
      .update({ status: 'resolved', resolution: 'We looked into it.' }).eq('id', c.id)
    expect(error).toBeTruthy()
    expect(error!.message).toMatch(/who paid/)
  })

  it('refuses one resolved before it was raised', async () => {
    const c = book.disputes.find(d => !isClosed(d))!
    const { error } = await supabase.from('disputes').update({
      status: 'resolved', outcome: 'refunded', resolution: 'x', resolved_on: '2020-01-01',
    }).eq('id', c.id)
    expect(error).toBeTruthy()
  })

  it('refuses an order dispute naming no order', async () => {
    const { error } = await supabase.from('disputes').insert({
      id: `DSP-PROBE-${Date.now()}`, kind: 'order', subject_ref: 'ORD-NOWHERE',
      reason: 'probe', claimant: 'probe', raised: '2026-08-08', amount: 1,
      currency: 'INR', owner: 'seller', status: 'open', sort_order: 99,
    })
    expect(error, 'an order dispute was accepted with no order on it').toBeTruthy()
  })

  it('reassigns and moves the clock with it', async () => {
    const c = book.disputes.find(d => !isClosed(d) && d.owner !== 'buyer')!
    const days = 11
    const r = await reassign(c.id, 'buyer', days)
    expect(r.ok, r.why).toBe(true)

    const after = await loadDisputeBook()
    const now = after.disputes.find(d => d.id === c.id)!
    expect(now.owner).toBe('buyer')
    /* The date it should be, not merely "a different one" — a case whose clock
       happened to already sit where it was being moved to passed that. */
    expect(now.due_on).toBe(new Date(Date.now() + days * 86400000).toISOString().slice(0, 10))

    await supabase.from('disputes')
      .update({ owner: c.owner, status: c.status, due_on: c.due_on }).eq('id', c.id)
  })
})

describe('what each side can see of it', () => {
  it('shows a seller the disputes against them and nobody else’s', async () => {
    await signIn(PARTNER.email, PARTNER.password)
    const { data } = await supabase.from('disputes').select('partner_id,account_id')
    const rows = (data ?? []) as { partner_id: string | null }[]
    expect(rows.length, 'a seller sees no disputes at all').toBeGreaterThan(0)
    expect(new Set(rows.map(r => r.partner_id)).size,
      'a seller can read disputes raised against another seller').toBe(1)
    expect(rows[0].partner_id).toBe('PTR-1004')
    await signOut()
  })

  /* The seller's own support screen reads the compatibility view, and it must
     show them order disputes only — an invoice dispute raised by somebody
     else's account is not theirs to read. */
  it('keeps the seller’s own screen on order disputes alone', async () => {
    await signIn(PARTNER.email, PARTNER.password)
    const { data } = await supabase.from('partner_disputes').select('*')
    const rows = (data ?? []) as { partner_id: string; order_ref: string | null }[]
    expect(rows.length).toBeGreaterThan(0)
    for (const r of rows) {
      expect(r.partner_id).toBe('PTR-1004')
      expect(r.order_ref, 'the seller-facing view returned something with no order on it').toBeTruthy()
    }
    await signOut()
  })

  it('will not let a seller decide their own dispute', async () => {
    await signIn(PARTNER.email, PARTNER.password)
    const { data } = await supabase.from('disputes').select('id,status').limit(1).single()
    const c = data as { id: string; status: string }

    await supabase.from('disputes').update({
      status: 'rejected', outcome: 'upheld_seller', resolution: 'I decided in my own favour.',
    }).eq('id', c.id)
    await signOut()

    await signIn(OPERATOR.email, OPERATOR.password)
    const { data: after } = await supabase.from('disputes').select('status').eq('id', c.id).single()
    expect((after as { status: string }).status,
      'a seller closed a dispute raised against them').toBe(c.status)
    await signOut()
  })

  it('offers redelivery only where there are goods to redeliver', () => {
    expect(outcomesFor('order')).toContain('redelivered')
    expect(outcomesFor('statement')).not.toContain('redelivered')
  })
})
