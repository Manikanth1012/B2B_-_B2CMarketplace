/* Touches the live Supabase project.
 *
 * A credit limit is only a limit if something refuses. Everything else in this
 * area — the band, the review, the deposit — is bookkeeping around one moment:
 * an account asks for something it cannot afford and the marketplace says so.
 * So the centre of this file is that moment, made for real: an approval on an
 * account that is over its limit, and what the database does about it.
 *
 * The rest checks the two things that make the moment trustworthy. That the
 * position the screen draws is the position the trigger reads — one arithmetic,
 * not two that agree today. And that the file behind it does not contradict
 * itself: a limit with no assessment, or an assessment in a currency the
 * account does not trade in, is a control nobody can defend when it bites.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { supabase } from './supabase'
import { signIn, signOut } from './authRepo'
import { loadCreditBook, releaseHold } from './creditRepo'
import type { CreditBook } from './creditRepo'
import { loadAccount, decideRequisition } from './enterpriseRepo'
import { waiting, canDecide } from './enterprise'
import type { Requisition } from './enterprise'
import {
  utilisation, isOver, pressure, wouldBreach, positionLine, reserveOn, sellerCover,
  securityLine, reviewIn, reviewOverdue, reviewQueue, creditBook, creditProblems,
  reviewMonths, dueFrom, onCadence,
} from './credit'

const OPERATOR = { email: 'anika.sharma@aventa.com', password: 'operator123' }
const PARTNER = { email: 'rajesh.kumar@nimbussensors.com', password: 'partner123' }
const ENTERPRISE = { email: 'vikram.shah@smartbuild.in', password: 'enterprise123' }
const TODAY = new Date().toISOString().slice(0, 10)

describe('the credit file the marketplace works from', () => {
  let book: CreditBook

  beforeAll(async () => {
    await signIn(OPERATOR.email, OPERATOR.password)
    book = await loadCreditBook()
  })
  afterAll(async () => { await signOut() })

  it('loads', () => {
    expect(book.loadError).toBeUndefined()
    expect(book.positions.length).toBeGreaterThan(0)
    expect(book.assessments.length).toBeGreaterThan(0)
  })

  /* PostgREST hands numerics back as strings, and a limit compared as a string
     is compared alphabetically — "990000" is less than "9167000" as text and
     greater as a number, which is the whole book the wrong way round. */
  it('gives every figure back as a number', () => {
    for (const p of book.positions) {
      for (const k of ['credit_limit', 'deposit_held', 'owed', 'committed', 'exposure', 'headroom'] as const) {
        expect(typeof p[k], `${p.account_id} ${k}`).toBe('number')
      }
    }
    for (const s of book.security) {
      for (const k of ['deposit_held', 'reserve_pct', 'reserve_held'] as const) {
        expect(typeof s[k], `${s.partner_id} ${k}`).toBe('number')
      }
    }
  })

  it('gives every account on terms a limit somebody set', () => {
    for (const p of book.positions) {
      expect(p.credit_limit, `${p.company} buys on terms against no limit`).toBeGreaterThan(0)
    }
  })

  /* A limit with no assessment behind it is a number somebody typed. */
  it('traces every limit to a review with an author and evidence', () => {
    for (const p of book.positions) {
      const a = book.assessments.find(x => x.account_id === p.account_id && !x.superseded_by)
      expect(a, `${p.company} has a limit of ${p.credit_limit} and no assessment`).toBeTruthy()
      expect(a!.reviewed_by, `${a!.id} has no author`).toBeTruthy()
      expect(a!.evidence.length, `${a!.id} cites no evidence`).toBeGreaterThan(20)
      expect(a!.rationale.length, `${a!.id} gives no reasoning`).toBeGreaterThan(20)
      expect(a!.limit_granted, `${a!.id} granted no limit`).toBe(p.credit_limit)
    }
  })

  /* Each account's limit is in its own money. Assessing in one currency and
     enforcing in another is a limit that is wrong by whatever the rate is. */
  it('assesses every account in the currency it trades in', () => {
    for (const p of book.positions) {
      const a = book.assessments.find(x => x.account_id === p.account_id && !x.superseded_by)!
      expect(a.currency, `${p.company} assessed in ${a.currency}, trades in ${p.currency}`)
        .toBe(p.currency)
    }
  })

  it('reports a position that adds up inside its own row', () => {
    for (const p of book.positions) {
      expect(Math.abs(p.owed + p.committed - p.exposure), `${p.company} exposure`)
        .toBeLessThanOrEqual(0.01)
      expect(Math.abs(p.credit_limit - p.exposure - p.headroom), `${p.company} headroom`)
        .toBeLessThanOrEqual(0.01)
      expect(p.over_limit, `${p.company} over_limit`).toBe(isOver(p))
    }
  })

  /* An assertion that passes because nothing is over is an assertion about an
     empty set. The hold exists; something has to be under it. */
  it('has at least one account actually over its limit', () => {
    const over = book.positions.filter(p => isOver(p))
    expect(over.length, 'no account is over its limit, so the hold is unexercised').toBeGreaterThan(0)
    for (const p of over) {
      expect(utilisation(p)).toBeGreaterThan(1)
      expect(pressure(p)).toBe('over')
      expect(positionLine(p)).toMatch(/over its limit/)
    }
  })

  /* Over the limit and reviewed as low risk is how a red figure stays quiet —
     the state my own first pass left SmartBuild in. */
  it('bands every over-limit account as high risk or refused', () => {
    for (const p of book.positions.filter(x => isOver(x))) {
      expect(['high', 'refused'], `${p.company} is over its limit and banded ${p.band}`)
        .toContain(p.band)
    }
  })

  it('does not disagree with itself anywhere', () => {
    expect(creditProblems(book.positions, book.assessments, book.security, TODAY)).toEqual([])
  })

  it('never adds a limit across currencies', () => {
    const roll = creditBook(book.positions, book.assessments, TODAY)
    const currencies = new Set(book.positions.map(p => p.currency))
    expect(roll.exposed.length).toBe(currencies.size)
    for (const line of roll.exposed) {
      const own = book.positions.filter(p => p.currency === line.currency)
      expect(line.count).toBe(own.length)
      const sum = own.reduce((t, p) => t + p.exposure, 0)
      expect(Math.abs(line.total.amount - sum)).toBeLessThanOrEqual(0.01)
    }
    expect(roll.over).toBeGreaterThan(0)
    expect(roll.noLimit).toBe(0)
  })

  it('puts the over-limit accounts at the front of the review queue', () => {
    const q = reviewQueue(book.positions, book.assessments, TODAY)
    expect(q.length).toBe(book.positions.length)
    const firstClear = q.findIndex(p => !isOver(p))
    if (firstClear >= 0) {
      expect(q.slice(firstClear).some(p => isOver(p)),
        'an over-limit account is behind one that is clear').toBe(false)
    }
  })

  it('gives every review a next date, and none is a decade out', () => {
    for (const a of book.assessments.filter(x => !x.superseded_by)) {
      expect(a.next_review, `${a.id} has no next review`).toBeTruthy()
      const days = reviewIn(a, TODAY)
      expect(days, `${a.id} is reviewed ${days} days out`).toBeLessThan(400)
      expect(reviewOverdue(a, TODAY), `${a.id} was due on ${a.next_review}`).toBe(false)
    }
  })

  /* A high-risk account reviewed annually is a band that costs nothing, and
     that is what the seed produced for every one of them: `+ 1 year` for buyers
     and `+ 6 months` for sellers, whatever the band. */
  it('puts every review on the cadence its band asks for', () => {
    for (const a of book.assessments.filter(x => !x.superseded_by)) {
      expect(onCadence(a),
        `${a.id} is banded ${a.band}, reviewed ${a.reviewed_on}, next ${a.next_review} `
        + `— its band asks for ${dueFrom(a.band, a.reviewed_on)}`).toBe(true)
    }
  })

  it('reviews the risky ones sooner than the safe ones, on both sides', () => {
    const live = book.assessments.filter(a => !a.superseded_by)
    for (const side of ['buyer', 'seller'] as const) {
      const gap = (band: string) => live
        .filter(a => a.side === side && a.band === band).map(a => reviewIn(a, TODAY))
      const high = gap('high')
      const low = gap('low')
      expect(high.length, `nothing on the ${side} side is banded high`).toBeGreaterThan(0)
      expect(low.length, `nothing on the ${side} side is banded low`).toBeGreaterThan(0)
      expect(Math.max(...high), `a high-risk ${side} is reviewed no sooner than a low-risk one`)
        .toBeLessThan(Math.min(...low))
    }
  })

  /* The cadence is evaluated twice — `credit_review_months` in the database
     stamps the date, `reviewMonths` in the browser says when it will be. This
     is the test that stops them drifting apart. */
  it('agrees with the database about how long each band gets', async () => {
    for (const band of ['low', 'medium', 'high', 'refused'] as const) {
      const { data, error } = await supabase.rpc('credit_review_months', { p_band: band })
      expect(error, `${band}: ${error?.message}`).toBeNull()
      expect(Number(data), `the database gives ${band} ${data} months, the browser `
        + `${reviewMonths(band)}`).toBe(reviewMonths(band))
    }
  })
})

/* -------------------------------------------------- the other side of it -- */

describe('what is held from a seller, and what it covers', () => {
  let book: CreditBook

  beforeAll(async () => {
    await signIn(OPERATOR.email, OPERATOR.password)
    book = await loadCreditBook()
  })
  afterAll(async () => { await signOut() })

  it('has a security record for every live seller', () => {
    expect(book.sellers.length).toBeGreaterThan(0)
    for (const s of book.sellers) {
      expect(book.security.find(x => x.partner_id === s.partner_id),
        `${s.name} sells here with nothing on file about what we hold`).toBeTruthy()
    }
  })

  it('says in one line what is held and why, for every one of them', () => {
    for (const s of book.security) {
      expect(securityLine(s).length, `${s.partner_id}`).toBeGreaterThan(10)
      expect(s.why.length, `${s.partner_id} holds security for no recorded reason`)
        .toBeGreaterThan(20)
    }
  })

  /* Holding a deposit against no instrument, or a reserve against a rate of
     zero, is money we cannot explain to the seller it belongs to. */
  it('holds nothing it cannot name an instrument for', () => {
    for (const s of book.security) {
      if (s.deposit_held > 0) {
        expect(s.deposit_kind, `${s.partner_id} deposit`).not.toBe('none')
        expect(s.deposit_taken_on, `${s.partner_id} deposit has no date`).toBeTruthy()
      }
      if (s.reserve_held > 0) expect(s.reserve_pct).toBeGreaterThan(0)
      if (s.reserve_pct > 0) expect(s.reserve_pct).toBeLessThanOrEqual(20)
    }
  })

  it('computes cover against what each seller is actually owed', () => {
    for (const s of book.security) {
      const line = book.sellers.find(x => x.partner_id === s.partner_id)
      const unpaid = line?.unpaid ?? 0
      const cover = sellerCover(s, unpaid)
      expect(cover.held).toBe(Math.round((s.deposit_held + s.reserve_held) * 100) / 100)
      expect(cover.uncovered).toBeGreaterThanOrEqual(0)
      expect(cover.covered).toBe(cover.held >= unpaid)
    }
  })

  it('takes a reserve rate off a gross the same way arithmetic does', () => {
    for (const s of book.security.filter(x => x.reserve_pct > 0)) {
      expect(reserveOn(100000, s.reserve_pct)).toBe(100000 * s.reserve_pct / 100)
    }
  })

  /* A shortfall is not a settlement. Nothing may settle negative — the seller
     would be invoiced for having traded with us. */
  it('has no statement that settles negative', async () => {
    const { data } = await supabase.from('settlement_statements').select('id,net,currency').lt('net', 0)
    expect((data ?? []).map(x => (x as { id: string }).id)).toEqual([])
  })
})

/* ------------------------------------------------ who may see what of it -- */

describe('the credit file is the marketplace\'s, not the market\'s', () => {
  afterAll(async () => { await signOut() })

  it('shows a seller what we hold from them, and from nobody else', async () => {
    await signIn(PARTNER.email, PARTNER.password)
    const { data, error } = await supabase.from('partner_security').select('partner_id')
    expect(error).toBeNull()
    const rows = (data ?? []) as { partner_id: string }[]
    expect(rows.length, 'the seller sees no security record of their own').toBe(1)
    await signOut()
  })

  /* The rationale is the marketplace's working. A seller reading "band: high"
     learns nothing they can act on and everything about how we price them. */
  it('does not show a seller the assessment behind it', async () => {
    await signIn(PARTNER.email, PARTNER.password)
    const { data } = await supabase.from('credit_assessment').select('id')
    expect((data ?? []).length, 'a seller can read the credit assessments').toBe(0)
    await signOut()
  })

  it('shows an account its own assessment and no other', async () => {
    await signIn(ENTERPRISE.email, ENTERPRISE.password)
    const { data } = await supabase.from('credit_assessment').select('id,account_id')
    const rows = (data ?? []) as { account_id: string | null }[]
    expect(rows.length).toBeGreaterThan(0)
    for (const r of rows) expect(r.account_id).toBe('ENT-2007')
    await signOut()
  })

  /* The view is the one that nearly leaked. A view runs with its owner's
     privileges unless it is told not to, so `security_invoker` is the whole
     difference between this returning one row and returning the book. */
  it('shows an account its own position through the view, and no other', async () => {
    await signIn(ENTERPRISE.email, ENTERPRISE.password)
    const { data } = await supabase.from('account_credit_position').select('account_id')
    const rows = (data ?? []) as { account_id: string }[]
    expect(rows.length, 'the account sees more positions than its own').toBe(1)
    expect(rows[0].account_id).toBe('ENT-2007')
    await signOut()
  })

  it('will not let anybody but the marketplace release a hold', async () => {
    await signIn(ENTERPRISE.email, ENTERPRISE.password)
    const held = await supabase.from('enterprise_requisitions')
      .select('id').eq('credit_hold', true).limit(1)
    const id = ((held.data ?? [])[0] as { id: string } | undefined)?.id ?? 'REQ-5512'
    const res = await releaseHold(id, 'Vikram Shah', 'we are good for it')
    expect(res.ok, 'an account released its own credit hold').toBe(false)
    expect(res.why).toMatch(/only the marketplace/i)
    await signOut()
  })

  it('will not let the marketplace release one for no recorded reason', async () => {
    await signIn(OPERATOR.email, OPERATOR.password)
    const res = await releaseHold('REQ-5512', 'Anika Sharma', '   ')
    expect(res.ok).toBe(false)
    expect(res.why).toMatch(/what the release is against/i)
    await signOut()
  })
})

/* ------------------------------------------- the moment the limit bites -- */

describe('the same limit, in the browser and in the database', () => {
  let target: Requisition
  let before: { credit_limit: number; exposure: number; currency: string }

  beforeAll(async () => {
    await signIn(ENTERPRISE.email, ENTERPRISE.password)
    const account = await loadAccount()
    /* The last decidable one rather than the first: `enterprise.integration`
       takes the first, and two files approving the same requisition in parallel
       is a flake nobody can reproduce. */
    const decidable = waiting(account.requisitions)
      .filter(r => canDecide(r, account.me!, account.policy!).ok)
    target = decidable[decidable.length - 1]
    expect(target, 'nothing on the account is decidable by the lead').toBeTruthy()

    const pos = await supabase.from('account_credit_position')
      .select('credit_limit,exposure,currency').eq('account_id', 'ENT-2007').single()
    const row = pos.data as { credit_limit: string; exposure: string; currency: string }
    before = {
      credit_limit: Number(row.credit_limit),
      exposure: Number(row.exposure),
      currency: row.currency,
    }
  })

  afterAll(async () => {
    /* Put it back as the operator: `guard_requisition` refuses to re-open a
       decision for the account that made it, which is the rule the separation
       of duties depends on. */
    await signOut()
    await signIn(OPERATOR.email, OPERATOR.password)
    await supabase.from('enterprise_requisitions').update({
      state: 'pending', decided_by: null, decided_on: null, decision_note: null,
      order_ref: null, credit_hold: false, credit_note: null,
    }).eq('id', target.id)

    /* And any order, though the point of the test is that there should be none.
       Cleaning up regardless is what stops a failed run leaving a purchase
       nobody approved in the book — three of this week's defects were a tidy-up
       nobody watched fail. */
    const placed = await supabase.from('orders').select('id').eq('requisition_id', target.id)
    for (const o of (placed.data ?? []) as { id: string }[]) {
      await supabase.from('order_items').delete().eq('order_id', o.id)
      await supabase.from('orders').delete().eq('id', o.id)
    }
    await signOut()
  })

  it('is testing an account that is already past its limit', () => {
    expect(isOver(before), 'ENT-2007 is inside its limit, so nothing here is exercised').toBe(true)
  })

  it('says in the browser that this requisition would breach', () => {
    const b = wouldBreach(before, target.amount)
    expect(b.breach, `${target.id} of ${target.amount} ${before.currency} was called clear`).toBe(true)
  })

  it('holds it when the approver approves it anyway', async () => {
    const account = await loadAccount()
    const res = await decideRequisition({
      req: target, me: account.me!, policy: account.policy!, approve: true,
      note: 'Approved for the integration test — expected to be held on credit.',
      currency: account.account!.currency,
    })
    /* Approved and held: the third outcome. Approving past a limit is a decision
       the account is entitled to make and is recorded as one; what it does not
       do is send the order. Reporting it as a failure — which is what this did
       until the hold got its own result — left the approver with a red toast
       beside a requisition the database had already approved. */
    expect(res.ok, res.ok ? '' : res.reason).toBe(true)
    expect(res.ok && res.held, 'a held approval was reported as an ordinary one').toBe(true)
    expect(res.ok && res.note, 'the approver was not told why nothing was ordered')
      .toMatch(/held on credit/i)

    const after = await supabase.from('enterprise_requisitions')
      .select('state,credit_hold,credit_note,order_ref').eq('id', target.id).single()
    const row = after.data as {
      state: string; credit_hold: boolean; credit_note: string | null; order_ref: string | null
    }
    expect(row.state).toBe('approved')
    expect(row.credit_hold, `${target.id} was approved past the limit with no hold`).toBe(true)
    expect(row.credit_note, 'held with no note saying why').toMatch(/against a limit of/i)
  })

  /* The gap this test found. The migration that added the hold said "a held
     requisition does not become an order until somebody releases it" and
     nothing implemented it — a control that was a sentence, in a file written
     to fix exactly that. */
  it('and sends nothing to the seller while the hold stands', async () => {
    const { data } = await supabase.from('orders')
      .select('order_ref').eq('requisition_id', target.id)
    expect((data ?? []).map(o => (o as { order_ref: string }).order_ref),
      'a held requisition went to the seller anyway').toEqual([])
  })

  it('refuses to place it directly either, whatever the screen calls', async () => {
    const { error } = await supabase.rpc('place_requisition_order', { p_req_id: target.id })
    expect(error, 'place_requisition_order ignored the hold').toBeTruthy()
    expect(error!.message).toMatch(/held on credit/i)
  })

  it('shows it to the marketplace as held, with what it is for', async () => {
    await signOut()
    await signIn(OPERATOR.email, OPERATOR.password)
    const book = await loadCreditBook()
    const held = book.held.find(h => h.id === target.id)
    expect(held, `${target.id} is held and does not appear on the credit screen`).toBeTruthy()
    expect(typeof held!.amount).toBe('number')
    expect(held!.currency).toBe(target.currency)
    await signOut()
    await signIn(ENTERPRISE.email, ENTERPRISE.password)
  })

  /* A release is a complete act, not a flag change somebody has to follow up:
     the order the hold was stopping goes out in the same call. */
  it('releases it, and the order goes out on the release', async () => {
    await signOut()
    await signIn(OPERATOR.email, OPERATOR.password)
    const res = await releaseHold(target.id, 'Anika Sharma',
      'Integration test — released against a cleared payment.')
    expect(res.ok, res.why).toBe(true)
    expect(res.why).toMatch(/gone to the seller/i)

    const { data } = await supabase.from('orders')
      .select('order_ref,total,currency,requisition_id').eq('requisition_id', target.id)
    const orders = (data ?? []) as { order_ref: string; total: string; currency: string }[]
    expect(orders.length, 'the release did not place the order it was holding').toBe(1)
    expect(Number(orders[0].total)).toBe(target.amount)
    expect(orders[0].currency).toBe(target.currency)

    const req = await supabase.from('enterprise_requisitions')
      .select('credit_hold,credit_note,order_ref').eq('id', target.id).single()
    const row = req.data as { credit_hold: boolean; credit_note: string; order_ref: string }
    expect(row.credit_hold).toBe(false)
    expect(row.credit_note, 'the release recorded no reason').toMatch(/Released by Anika Sharma/)
    expect(row.order_ref).toBe(orders[0].order_ref)
  })

  it('will not release the same one twice', async () => {
    const res = await releaseHold(target.id, 'Anika Sharma', 'again')
    expect(res.ok).toBe(false)
    expect(res.why).toMatch(/not held/i)
  })
})
