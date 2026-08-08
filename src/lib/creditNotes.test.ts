import { describe, it, expect } from 'vitest'
import {
  signedAmount, netOf, approvalNeeded, needsEvidence, canApprove, whatIsMissing,
  canVoid, workQueue, exposure, line, nextId, reasonsFor, noteProblems,
  STATE_LABEL, STATE_TONE, STATE_MEANING,
} from './creditNotes'
import type { Note, NoteReason, NotePolicy, NoteState } from './creditNotes'

const POLICY: NotePolicy = {
  id: 'standard',
  currency: 'USD',
  auto_approve_below: 250,
  second_approval_above: 5000,
  require_evidence_above: 1000,
  void_window_days: 30,
  tax_treatment: 'Restated at the rate on the original charge',
  settle_on: 'The next settlement run for that seller',
  note: '',
}

const note = (over: Partial<Note> = {}): Note => ({
  id: 'CN-2026-0001',
  partner_id: 'PTR-1004',
  kind: 'credit',
  reason_id: 'comm-rate',
  amount: 400,
  currency: 'USD',
  tax: 72,
  tax_rate: 18,
  period: 'Jun 2026',
  ref: 'ss-1004-202606',
  evidence: 'Rate card v3',
  detail: 'Commission charged at 15% against a contracted 12%.',
  state: 'draft',
  raised_by: 'Renu Iyer',
  raised_on: '2026-07-01',
  approved_by: null,
  approved_on: null,
  second_approved_by: null,
  second_approved_on: null,
  statement_id: null,
  applied_on: null,
  void_reason: null,
  void_on: null,
  disputed_on: null,
  dispute_note: null,
  ...over,
})

const reason = (over: Partial<NoteReason> = {}): NoteReason => ({
  id: 'comm-rate',
  kind: 'credit',
  label: 'Commission charged at the wrong rate',
  guidance: 'Name the period and the rate that should have applied.',
  needs_ref: true,
  ref_label: 'The statement it was charged on',
  active: true,
  sort_order: 10,
  ...over,
})

describe('which way a note moves the payout', () => {
  it('pays the seller more on a credit', () => {
    expect(signedAmount({ kind: 'credit', amount: 400 })).toBe(400)
  })

  it('recovers from the seller on a debit', () => {
    expect(signedAmount({ kind: 'debit', amount: 400 })).toBe(-400)
  })

  /* The direction lives in `kind` alone. A negative amount beside a debit kind
     would be a double negative and pay somebody twice. */
  it('never reads a sign off the amount', () => {
    expect(signedAmount({ kind: 'debit', amount: 400 })).toBe(-400)
    expect(signedAmount({ kind: 'credit', amount: 400 })).toBe(400)
  })

  it('nets a mixed set to the movement, not the turnover', () => {
    expect(netOf([
      { kind: 'credit', amount: 1284.4 },
      { kind: 'debit', amount: 640 },
      { kind: 'credit', amount: 175 },
    ])).toBe(819.4)
  })

  it('rounds to the cent rather than carrying float noise', () => {
    expect(netOf([{ kind: 'credit', amount: 0.1 }, { kind: 'credit', amount: 0.2 }])).toBe(0.3)
  })

  it('is zero for nothing at all', () => {
    expect(netOf([])).toBe(0)
  })
})

describe('what a signature is worth', () => {
  it('needs nobody under the floor', () => {
    expect(approvalNeeded(175, POLICY)).toBe('none')
  })

  it('needs one at the floor exactly', () => {
    expect(approvalNeeded(250, POLICY)).toBe('one')
  })

  it('needs two at the ceiling exactly', () => {
    /* The boundary matters: "above 5000" read literally would let 5000 through
       on one signature, which is the number somebody picks when they want it to. */
    expect(approvalNeeded(5000, POLICY)).toBe('two')
  })

  it('needs two above the ceiling', () => {
    expect(approvalNeeded(7420, POLICY)).toBe('two')
  })

  it('asks for evidence at the evidence line', () => {
    expect(needsEvidence(1000, POLICY)).toBe(true)
    expect(needsEvidence(999.99, POLICY)).toBe(false)
  })
})

describe('who may put their name to it', () => {
  it('lets a colleague give the first signature', () => {
    const r = canApprove(note(), 'Tomas Alvarez', POLICY)
    expect(r.ok).toBe(true)
    expect(r.ok && r.which).toBe('first')
  })

  it('refuses the person who raised it', () => {
    const r = canApprove(note(), 'Renu Iyer', POLICY)
    expect(r.ok).toBe(false)
    expect(!r.ok && r.reason).toMatch(/raised this note and cannot also approve/)
  })

  /* The control most marketplaces state and few enforce: a ceiling satisfied by
     the same person clicking twice is not a second pair of eyes. */
  it('refuses the first approver as the second signature', () => {
    const n = note({ amount: 7420, state: 'pending', approved_by: 'Tomas Alvarez' })
    const r = canApprove(n, 'Tomas Alvarez', POLICY)
    expect(r.ok).toBe(false)
    expect(!r.ok && r.reason).toMatch(/has to come from a third person/)
  })

  it('lets a genuine third person give the second', () => {
    const n = note({ amount: 7420, state: 'pending', approved_by: 'Tomas Alvarez' })
    const r = canApprove(n, 'Amelia Nkosi', POLICY)
    expect(r.ok).toBe(true)
    expect(r.ok && r.which).toBe('second')
  })

  it('refuses a second signature on a note that does not need one', () => {
    const n = note({ amount: 400, state: 'issued', approved_by: 'Tomas Alvarez' })
    const r = canApprove(n, 'Amelia Nkosi', POLICY)
    expect(r.ok).toBe(false)
    expect(!r.ok && r.reason).toMatch(/does not need a second signature/)
  })

  it('refuses a third signature on one that already has both', () => {
    const n = note({
      amount: 7420, state: 'issued',
      approved_by: 'Tomas Alvarez', second_approved_by: 'Amelia Nkosi',
    })
    const r = canApprove(n, 'Priya Raman', POLICY)
    expect(r.ok).toBe(false)
    expect(!r.ok && r.reason).toMatch(/already has both signatures/)
  })

  it('refuses to approve a settled note', () => {
    const r = canApprove(note({ state: 'applied' }), 'Tomas Alvarez', POLICY)
    expect(r.ok).toBe(false)
  })

  it('refuses to approve a voided one', () => {
    const r = canApprove(note({ state: 'void' }), 'Tomas Alvarez', POLICY)
    expect(r.ok).toBe(false)
  })

  /* A disputed note is a seller arguing they have been charged wrongly. Signing
     it while the argument is open is exactly the move the dispute exists to stop. */
  it('refuses to approve one under dispute, and says to resolve it first', () => {
    const r = canApprove(note({ state: 'disputed' }), 'Tomas Alvarez', POLICY)
    expect(r.ok).toBe(false)
    expect(!r.ok && r.reason).toMatch(/resolve that first/)
  })
})

describe('what is still outstanding before it can issue', () => {
  it('is nothing for a small, complete note', () => {
    expect(whatIsMissing(note({ amount: 175 }), reason({ needs_ref: false }), POLICY)).toEqual([])
  })

  it('asks for evidence above the line, naming the threshold', () => {
    const out = whatIsMissing(note({ amount: 1200, evidence: null }), reason(), POLICY)
    expect(out.some(x => x.includes('1000 USD'))).toBe(true)
  })

  it('treats whitespace as no evidence at all', () => {
    const out = whatIsMissing(note({ amount: 1200, evidence: '   ' }), reason(), POLICY)
    expect(out.some(x => x.startsWith('Evidence'))).toBe(true)
  })

  it('asks for the reference in the reason’s own words', () => {
    const out = whatIsMissing(note({ ref: null }), reason(), POLICY)
    expect(out.some(x => x.startsWith('The statement it was charged on'))).toBe(true)
  })

  it('does not ask for a reference the reason never wanted', () => {
    const out = whatIsMissing(note({ ref: null }), reason({ needs_ref: false }), POLICY)
    expect(out.some(x => x.includes('reference'))).toBe(false)
  })

  it('asks for an explanation the seller can read', () => {
    const out = whatIsMissing(note({ detail: '  ' }), reason({ needs_ref: false }), POLICY)
    expect(out).toContain('An explanation the seller can read.')
  })

  it('asks for a second approver once the first has signed a big one', () => {
    const n = note({ amount: 7420, approved_by: 'Tomas Alvarez', evidence: 'Audit' })
    const out = whatIsMissing(n, reason(), POLICY)
    expect(out.some(x => x.includes('second approver'))).toBe(true)
    expect(out.some(x => x === 'An approver.')).toBe(false)
  })

  it('asks for nobody at all under the floor', () => {
    const out = whatIsMissing(note({ amount: 175 }), reason({ needs_ref: false }), POLICY)
    expect(out.some(x => x.includes('approver'))).toBe(false)
  })
})

describe('pulling one back', () => {
  it('can be voided inside the window and says until when', () => {
    const r = canVoid(note({ raised_on: '2026-07-01' }), POLICY, '2026-07-15')
    expect(r.ok).toBe(true)
    expect(r.ok && r.until).toBe('2026-07-31')
  })

  it('closes the window on the day after it expires', () => {
    const r = canVoid(note({ raised_on: '2026-07-01' }), POLICY, '2026-08-01')
    expect(r.ok).toBe(false)
    expect(!r.ok && r.reason).toMatch(/closed on 2026-07-31/)
  })

  it('is still open on the last day of the window', () => {
    expect(canVoid(note({ raised_on: '2026-07-01' }), POLICY, '2026-07-31').ok).toBe(true)
  })

  /* Voiding a settled note would silently unwind a statement somebody has been
     paid against. The reversal has to be its own document. */
  it('refuses to void a settled note and names the statement', () => {
    const n = note({ state: 'applied', statement_id: 'ss-1004-202607' })
    const r = canVoid(n, POLICY, '2026-07-02')
    expect(r.ok).toBe(false)
    expect(!r.ok && r.reason).toMatch(/ss-1004-202607/)
    expect(!r.ok && r.reason).toMatch(/note the other way/)
  })

  it('refuses to void one that is already void', () => {
    expect(canVoid(note({ state: 'void' }), POLICY, '2026-07-02').ok).toBe(false)
  })
})

describe('what somebody should work first', () => {
  const q = workQueue([
    note({ id: 'a', state: 'applied', amount: 900 }),
    note({ id: 'b', state: 'draft', amount: 900 }),
    note({ id: 'c', state: 'issued', amount: 900 }),
    note({ id: 'd', state: 'pending', amount: 900 }),
    note({ id: 'e', state: 'disputed', amount: 90 }),
  ])

  it('puts the seller who is arguing at the top, however small', () => {
    expect(q[0].id).toBe('e')
  })

  it('then the half-decided, then the decided, then somebody’s draft', () => {
    expect(q.map(n => n.id)).toEqual(['e', 'd', 'c', 'b', 'a'])
  })

  it('breaks a tie on size, because the delay costs most there', () => {
    const two = workQueue([
      note({ id: 'small', state: 'pending', amount: 300 }),
      note({ id: 'big', state: 'pending', amount: 7420 }),
    ])
    expect(two[0].id).toBe('big')
  })

  it('does not reorder the caller’s array', () => {
    const src = [note({ id: 'a', state: 'applied' }), note({ id: 'b', state: 'disputed' })]
    workQueue(src)
    expect(src[0].id).toBe('a')
  })
})

describe('what the marketplace has committed and not paid', () => {
  const notes = [
    note({ id: '1', state: 'issued', kind: 'credit', amount: 1000 }),
    note({ id: '2', state: 'issued', kind: 'debit', amount: 400 }),
    note({ id: '3', state: 'applied', kind: 'credit', amount: 250 }),
    note({ id: '4', state: 'pending', kind: 'credit', amount: 7420 }),
    note({ id: '5', state: 'draft', kind: 'debit', amount: 20 }),
    note({ id: '6', state: 'disputed', kind: 'debit', amount: 89.99 }),
    note({ id: '7', state: 'void', kind: 'credit', amount: 310 }),
  ]
  const e = exposure(notes, POLICY)

  it('reports agreed-and-unpaid on its own, because that is the commitment', () => {
    expect(e.committed).toBe(600)
  })

  it('separates what has already landed', () => {
    expect(e.settled).toBe(250)
  })

  it('counts drafts and pending together as undecided', () => {
    expect(e.awaiting).toBe(7400)
  })

  it('keeps disputed apart — it is not going to settle as it stands', () => {
    expect(e.disputed).toBe(-89.99)
  })

  it('leaves voided notes out of every figure', () => {
    expect(e.committed + e.settled + e.awaiting + e.disputed).not.toBe(310)
  })

  it('carries the currency the figures are in', () => {
    expect(e.currency).toBe('USD')
  })
})

describe('the sentence on a row', () => {
  it('names the reason, the period and what it is against', () => {
    expect(line(note(), reason()))
      .toBe('Commission charged at the wrong rate for Jun 2026 against ss-1004-202606.')
  })

  it('drops the parts that are not there', () => {
    expect(line(note({ period: null, ref: null }), reason()))
      .toBe('Commission charged at the wrong rate.')
  })

  it('falls back to the reason id rather than printing nothing', () => {
    expect(line(note({ period: null, ref: null }), null)).toBe('comm-rate.')
  })
})

describe('numbering', () => {
  const existing = [
    note({ id: 'CN-2026-0031' }), note({ id: 'DN-2026-0032' }), note({ id: 'CN-2026-0038' }),
  ]

  it('follows the highest credit note, not the highest note', () => {
    expect(nextId(existing, 'credit', 2026)).toBe('CN-2026-0039')
  })

  /* Separate series because they are different documents to an auditor, and one
     shared sequence makes a run of credits look like missing debits. */
  it('numbers debits in their own series', () => {
    expect(nextId(existing, 'debit', 2026)).toBe('DN-2026-0033')
  })

  it('starts a new year at one', () => {
    expect(nextId(existing, 'credit', 2027)).toBe('CN-2027-0001')
  })

  it('starts at one when there is nothing', () => {
    expect(nextId([], 'debit', 2026)).toBe('DN-2026-0001')
  })
})

describe('the reasons on offer', () => {
  const rs = [
    reason({ id: 'a', kind: 'credit', sort_order: 20 }),
    reason({ id: 'b', kind: 'credit', sort_order: 10 }),
    reason({ id: 'c', kind: 'debit', sort_order: 10 }),
    reason({ id: 'd', kind: 'credit', sort_order: 5, active: false }),
  ]

  it('offers only the kind being raised, in order', () => {
    expect(reasonsFor(rs, 'credit').map(r => r.id)).toEqual(['b', 'a'])
  })

  it('leaves a retired reason off the form but does not delete history', () => {
    expect(reasonsFor(rs, 'credit').some(r => r.id === 'd')).toBe(false)
  })
})

describe('where a set of notes disagrees with itself', () => {
  it('finds a credit reason on a debit note', () => {
    const out = noteProblems([note({ kind: 'debit' })], [reason()], POLICY)
    expect(out[0]).toMatch(/is a debit note raised under/)
  })

  it('finds a note in a currency statements are not written in', () => {
    const out = noteProblems([note({ currency: 'INR' })], [reason()], POLICY)
    expect(out.some(x => x.includes('INR') && x.includes('USD'))).toBe(true)
  })

  /* The one worth finding on a screen rather than in an audit: the ceiling was
     bypassed and the money has already moved. */
  it('finds a note issued above the ceiling on one signature', () => {
    const n = note({ amount: 7420, state: 'issued', approved_by: 'Tomas Alvarez' })
    const out = noteProblems([n], [reason()], POLICY)
    expect(out.some(x => x.includes('on one signature'))).toBe(true)
  })

  it('does not complain about a big note still waiting for its second', () => {
    const n = note({ amount: 7420, state: 'pending', approved_by: 'Tomas Alvarez' })
    expect(noteProblems([n], [reason()], POLICY)).toEqual([])
  })

  it('finds self-approval', () => {
    const n = note({ state: 'issued', approved_by: 'Renu Iyer' })
    expect(noteProblems([n], [reason()], POLICY).some(x => x.includes('approved by the person who raised it')))
      .toBe(true)
  })

  it('finds the same person signing twice', () => {
    const n = note({
      amount: 7420, state: 'issued',
      approved_by: 'Tomas Alvarez', second_approved_by: 'Tomas Alvarez',
    })
    expect(noteProblems([n], [reason()], POLICY).some(x => x.includes('two signatures from the same person')))
      .toBe(true)
  })

  it('is silent on a clean book', () => {
    const clean = [
      note({ amount: 175, state: 'issued', approved_by: 'Tomas Alvarez' }),
      note({ id: 'DN-2026-0002', kind: 'debit', reason_id: 'sla', amount: 640, state: 'issued', approved_by: 'Tomas Alvarez' }),
    ]
    expect(noteProblems(clean, [reason(), reason({ id: 'sla', kind: 'debit' })], POLICY)).toEqual([])
  })
})

describe('the words on a state', () => {
  const states: NoteState[] = ['draft', 'pending', 'issued', 'applied', 'void', 'disputed']

  it('has a label, a tone and a meaning for every state', () => {
    for (const s of states) {
      expect(STATE_LABEL[s], s).toBeTruthy()
      expect(STATE_TONE[s], s).toBeTruthy()
      expect(STATE_MEANING[s], s).toBeTruthy()
    }
  })

  /* The seller reads this, not an operator. "pending" tells them nothing; what
     it is waiting for tells them whether to chase. */
  it('explains pending as a missing signature rather than as a status word', () => {
    expect(STATE_LABEL.pending).toMatch(/second signature/)
  })

  it('tells a seller a disputed note is not being taken from them', () => {
    expect(STATE_MEANING.disputed).toMatch(/does not settle/)
  })
})
