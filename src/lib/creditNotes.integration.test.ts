/* Touches the live Supabase project.
 *
 * The approval rule is written twice: as arithmetic in `guard_settlement_note`
 * and `approve_note`, because a transactional write cannot ask a browser what it
 * thinks; and in TypeScript, because a screen has to answer "can this person
 * sign?" before anybody clicks anything. Two evaluations of one rule drift, and
 * the way they drift is that the screen offers a button the database refuses.
 * These tests are the reconciliation.
 *
 * The other half is the seller's. Row-level security is what stops one seller
 * reading a note raised against another, and what stops a seller editing the
 * amount on a debit note instead of disputing it. Neither can be tested through
 * the operator's session, so this file signs in as both.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { supabase } from './supabase'
import { signIn, signOut } from './authRepo'
import { loadNoteBook, loadMyNotes, disputeNote } from './creditNotesRepo'
import {
  approvalNeeded, canApprove, needsEvidence, exposure, netOf, noteProblems, signedAmount,
} from './creditNotes'
import type { NoteBook } from './creditNotesRepo'

const OPERATOR = { email: 'anika.sharma@aventa.com', password: 'operator123' }
const PARTNER = { email: 'rajesh.kumar@nimbussensors.com', password: 'partner123' }
const DEMO = 'PTR-1004'

describe('the note book the operator works from', () => {
  let book: NoteBook

  beforeAll(async () => {
    await signIn(OPERATOR.email, OPERATOR.password)
    book = await loadNoteBook()
  })
  afterAll(async () => { await signOut() })

  it('loads, with a policy behind it', () => {
    expect(book.loadError).toBeUndefined()
    expect(book.notes.length).toBeGreaterThan(0)
    expect(book.policy).toBeTruthy()
    expect(book.reasons.length).toBeGreaterThan(0)
  })

  /* PostgREST hands back every numeric as a string. One un-Numbered amount and
     the exposure figure on the screen is two amounts concatenated. */
  it('gives every figure back as a number', () => {
    for (const n of book.notes) {
      expect(typeof n.amount, `${n.id} amount`).toBe('number')
      expect(typeof n.tax, `${n.id} tax`).toBe('number')
    }
    expect(typeof book.policy!.second_approval_above).toBe('number')
  })

  it('has a note in every state, so no state on the screen is unexercised', () => {
    const states = new Set(book.notes.map(n => n.state))
    for (const s of ['issued', 'applied', 'pending', 'disputed', 'draft', 'void']) {
      expect(states.has(s as never), `no note is ${s}`).toBe(true)
    }
  })

  it('disagrees with the policy nowhere', () => {
    expect(noteProblems(book.notes, book.reasons, book.policy!)).toEqual([])
  })

  it('never carries a note whose reason belongs to the other direction', () => {
    for (const n of book.notes) {
      const r = book.reasons.find(x => x.id === n.reason_id)
      expect(r, `${n.id} has reason ${n.reason_id}, which does not exist`).toBeTruthy()
      expect(r!.kind, `${n.id} is a ${n.kind} note on a ${r!.kind} reason`).toBe(n.kind)
    }
  })

  it('holds evidence on everything the policy demands it for', () => {
    const pol = book.policy!
    for (const n of book.notes.filter(x => x.state !== 'draft')) {
      if (!needsEvidence(n.amount, pol)) continue
      expect((n.evidence ?? '').trim(), `${n.id} is ${n.amount} and has no evidence`).not.toBe('')
    }
  })

  it('holds the reference every reason asks for', () => {
    for (const n of book.notes.filter(x => x.state !== 'draft')) {
      const r = book.reasons.find(x => x.id === n.reason_id)!
      if (!r.needs_ref) continue
      expect((n.ref ?? '').trim(), `${n.id} needs ${r.ref_label} and has none`).not.toBe('')
    }
  })

  /* The control that is easy to state and easy to leave unenforced. */
  it('has nothing issued above the ceiling on a single signature', () => {
    const pol = book.policy!
    for (const n of book.notes.filter(x => x.state === 'issued' || x.state === 'applied')) {
      if (approvalNeeded(n.amount, pol) !== 'two') continue
      expect(n.second_approved_by, `${n.id} settled at ${n.amount} on one name`).toBeTruthy()
      expect(n.second_approved_by).not.toBe(n.approved_by)
      expect(n.second_approved_by).not.toBe(n.raised_by)
    }
  })

  it('has nobody approving what they raised', () => {
    for (const n of book.notes) {
      if (!n.approved_by) continue
      expect(n.approved_by, `${n.id} was signed by its own raiser`).not.toBe(n.raised_by)
    }
  })

  it('keeps a case waiting for a second signature, so the ceiling is visible', () => {
    const pol = book.policy!
    const waiting = book.notes.filter(n => n.state === 'pending')
    expect(waiting.length, 'nothing is short a second signature').toBeGreaterThan(0)
    for (const n of waiting) {
      expect(approvalNeeded(n.amount, pol), `${n.id} is pending but under the ceiling`).toBe('two')
    }
  })

  /* An applied note that is not on a statement has moved nobody's money, and a
     settled one that is on a statement missing from `adjustment_detail` is a
     figure with no lineage. */
  it('has every settled note on a statement that itemises it', async () => {
    const settled = book.notes.filter(n => n.state === 'applied')
    expect(settled.length).toBeGreaterThan(0)

    const ids = [...new Set(settled.map(n => n.statement_id!))]
    const { data } = await supabase.from('settlement_statements')
      .select('id,adjustments,adjustment_detail').in('id', ids)

    for (const s of (data ?? []) as { id: string; adjustments: string; adjustment_detail: { note_id: string; amount: string; kind: string }[] }[]) {
      const mine = settled.filter(n => n.statement_id === s.id)
      const named = new Set(s.adjustment_detail.map(d => d.note_id))
      for (const n of mine) {
        expect(named.has(n.id), `${n.id} says it settled on ${s.id}, which does not name it`).toBe(true)
      }
      /* And the stored total is the sum of the notes rather than an assertion. */
      const derived = Math.round(mine.reduce((a, n) => a + signedAmount(n), 0) * 100) / 100
      expect(Number(s.adjustments), `${s.id} adjustments disagree with its notes`).toBe(derived)
    }
  })

  it('leaves the statement net equal to its own parts', async () => {
    const ids = [...new Set(book.notes.filter(n => n.statement_id).map(n => n.statement_id!))]
    const { data } = await supabase.from('settlement_statements')
      .select('id,gross,commission,fees,refunds,withholding,adjustments,net').in('id', ids)

    for (const s of (data ?? []) as Record<string, string>[]) {
      const derived = Math.round((
        Number(s.gross) - Number(s.commission) - Number(s.fees)
        - Number(s.refunds) - Number(s.withholding) + Number(s.adjustments)
      ) * 100) / 100
      expect(Number(s.net), `${s.id} net is asserted rather than derived`).toBe(derived)
    }
  })

  it('never lets a note reach a statement in a currency the statement is not in', async () => {
    const ids = [...new Set(book.notes.filter(n => n.statement_id).map(n => n.statement_id!))]
    const { data } = await supabase.from('settlement_statements').select('id,currency').in('id', ids)
    const cur = new Map((data ?? []).map((s: { id: string; currency: string }) => [s.id, s.currency]))
    for (const n of book.notes.filter(x => x.statement_id)) {
      expect(n.currency, `${n.id} is in ${n.currency} on a ${cur.get(n.statement_id!)} statement`)
        .toBe(cur.get(n.statement_id!))
    }
  })

  it('reports an exposure that is only the agreed-and-unpaid', () => {
    const e = exposure(book.notes, book.policy!)
    expect(e.committed).toBe(netOf(book.notes.filter(n => n.state === 'issued')))
    /* Voided notes are in no figure at all — the point of voiding one. */
    const voided = book.notes.filter(n => n.state === 'void')
    expect(voided.length).toBeGreaterThan(0)
    expect(e.committed + e.settled + e.awaiting + e.disputed)
      .toBe(netOf(book.notes.filter(n => n.state !== 'void')))
  })
})

/* The reconciliation. Each of these asks the TypeScript rule for a verdict and
 * then makes the write for real, and the assertion is that they agreed. */
describe('the same rule, evaluated in the browser and in the database', () => {
  let book: NoteBook

  beforeAll(async () => {
    await signIn(OPERATOR.email, OPERATOR.password)
    book = await loadNoteBook()
  })
  afterAll(async () => { await signOut() })

  it('refuses a self-approval in both places', async () => {
    const n = book.notes.find(x => x.state === 'draft')!
    const verdict = canApprove(n, n.raised_by, book.policy!)
    expect(verdict.ok, 'the screen would offer a self-approval').toBe(false)

    const { data, error } = await supabase.rpc('approve_note', { p_id: n.id, p_actor: n.raised_by })
    /* A refusal either way is agreement; what would be wrong is the write
       succeeding after the screen said it could not. */
    const ok = !error && (data as { ok?: boolean })?.ok === true
    expect(ok, 'the database accepted a self-approval the screen refused').toBe(false)
  })

  it('refuses the first approver as the second in both places', async () => {
    const n = book.notes.find(x => x.state === 'pending' && x.approved_by)!
    const verdict = canApprove(n, n.approved_by!, book.policy!)
    expect(verdict.ok).toBe(false)

    const { data, error } = await supabase.rpc('approve_note', { p_id: n.id, p_actor: n.approved_by })
    const ok = !error && (data as { ok?: boolean })?.ok === true
    expect(ok, 'the same person signed twice').toBe(false)

    const after = await loadNoteBook()
    const now = after.notes.find(x => x.id === n.id)!
    expect(now.second_approved_by, `${n.id} took a second signature from its first approver`)
      .not.toBe(n.approved_by)
  })

  it('refuses to sign a disputed note in both places', async () => {
    const n = book.notes.find(x => x.state === 'disputed')!
    expect(canApprove(n, 'Anika Sharma', book.policy!).ok).toBe(false)

    const { data } = await supabase.rpc('approve_note', { p_id: n.id, p_actor: 'Anika Sharma' })
    expect((data as { ok?: boolean })?.ok).toBe(false)

    const after = await loadNoteBook()
    expect(after.notes.find(x => x.id === n.id)!.state,
      'a disputed note was approved out from under the seller').toBe('disputed')
  })

  it('refuses a credit reason on a debit note', async () => {
    const credit = book.reasons.find(r => r.kind === 'credit')!
    const { error } = await supabase.from('settlement_note').insert({
      id: 'DN-9999-9999', partner_id: DEMO, kind: 'debit', reason_id: credit.id,
      amount: 100, currency: 'USD', detail: 'A probe.', raised_by: 'Integration test',
    })
    expect(error, 'a debit note took a credit reason').toBeTruthy()
  })

  it('refuses a note against a statement that has been signed off', async () => {
    const { data: paid } = await supabase.from('settlement_statements')
      .select('id').eq('status', 'paid').limit(1).maybeSingle()
    const { data } = await supabase.rpc('apply_notes', { p_statement: (paid as { id: string }).id })
    expect((data as { ok?: boolean })?.ok, 'a note landed on a paid statement').toBe(false)
    expect((data as { why?: string })?.why).toMatch(/signed off/)
  })
})

describe('what a seller can see and do about a note raised against them', () => {
  beforeAll(async () => { await signIn(PARTNER.email, PARTNER.password) })
  afterAll(async () => { await signOut() })

  it('sees its own notes, with the reasons and the policy behind them', async () => {
    const mine = await loadMyNotes()
    expect(mine.notes.length, 'the demo seller has no notes to look at').toBeGreaterThan(0)
    expect(mine.notes.every(n => n.partner_id === DEMO)).toBe(true)
    expect(mine.reasons.length).toBeGreaterThan(0)
    expect(mine.policy).toBeTruthy()
  })

  /* A draft is somebody thinking. Showing it to the seller would mean every
     half-typed idea reaching the person it is about. */
  it('does not see a draft', async () => {
    const mine = await loadMyNotes()
    expect(mine.notes.some(n => n.state === 'draft')).toBe(false)
  })

  it('sees nothing raised against another seller', async () => {
    const mine = await loadMyNotes()
    expect(mine.notes.some(n => n.partner_id !== DEMO)).toBe(false)
  })

  /* Row-level security cannot say "this column but not that one", so without the
     guard a seller could set state to void, or halve the amount, in the same
     call that disputes it. This writes for real and asserts nothing moved. */
  it('cannot rewrite what a note says while disputing it', async () => {
    const mine = await loadMyNotes()
    const target = mine.notes.find(n => n.state === 'issued' || n.state === 'applied')!

    await supabase.from('settlement_note')
      .update({ amount: 1, kind: 'credit', detail: 'I decided it says this now', state: 'disputed', dispute_note: 'x' })
      .eq('id', target.id)

    const after = (await loadMyNotes()).notes.find(n => n.id === target.id)!
    expect(after.amount, 'a seller changed the amount on a note against them').toBe(target.amount)
    expect(after.kind, 'a seller flipped a debit into a credit').toBe(target.kind)
    expect(after.detail).toBe(target.detail)
  })

  it('cannot void one', async () => {
    const mine = await loadMyNotes()
    const target = mine.notes.find(n => n.state === 'issued' || n.state === 'applied')!
    await supabase.from('settlement_note')
      .update({ state: 'void', void_reason: 'I would rather not' }).eq('id', target.id)
    const after = (await loadMyNotes()).notes.find(n => n.id === target.id)!
    expect(after.state, 'a seller voided a note raised against them').not.toBe('void')
  })

  it('cannot approve one into existence', async () => {
    const { data, error } = await supabase.rpc('approve_note', { p_id: 'CN-2026-0035', p_actor: 'Rajesh Kumar' })
    const ok = !error && (data as { ok?: boolean })?.ok === true
    expect(ok, 'a seller approved a note in their own favour').toBe(false)
  })

  it('refuses a dispute with no reason, because it cannot be investigated', async () => {
    const mine = await loadMyNotes()
    const target = mine.notes.find(n => n.state === 'issued' || n.state === 'applied')!
    const r = await disputeNote(target.id, '   ')
    expect(r.ok).toBe(false)
    expect(r.why).toMatch(/cannot be investigated/)
  })

  it('can dispute one, and it stops settling', async () => {
    const mine = await loadMyNotes()
    const target = mine.notes.find(n => n.state === 'issued')
      ?? mine.notes.find(n => n.state === 'applied')!
    const was = target.state

    const r = await disputeNote(target.id, 'Integration test — the campaign ran a week, not a month.')
    expect(r.ok, r.why).toBe(true)

    const after = (await loadMyNotes()).notes.find(n => n.id === target.id)!
    expect(after.state).toBe('disputed')
    expect(after.dispute_note).toMatch(/Integration test/)

    /* Put it back, so the file can be run twice — and the dispute case with it.
     *
     * Disputing a note now opens a case on the operator's dispute desk. Undoing
     * the note without withdrawing the case left an open dispute against
     * something nobody was disputing, which `disputeProblems` reports and which
     * broke this whole block on the next run: the note stayed `disputed` and
     * every test below it that wanted an issued one found nothing.
     *
     * The case is deleted rather than resolved. It never happened — it was a
     * test making a note dispute itself — and closing it would put a fabricated
     * outcome and a fabricated answer into the desk's record of what it has
     * decided. */
    await signOut()
    await signIn(OPERATOR.email, OPERATOR.password)
    await supabase.from('settlement_note')
      .update({ state: was, dispute_note: null, disputed_on: null }).eq('id', target.id)
    await supabase.from('disputes')
      .delete().eq('kind', 'note').eq('subject_ref', target.id)
      .not('status', 'in', '("resolved","rejected")')
    await signOut()
    await signIn(PARTNER.email, PARTNER.password)

    const restored = (await loadMyNotes()).notes.find(n => n.id === target.id)!
    expect(restored.state).toBe(was)
  })
})
