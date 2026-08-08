/**
 * Credit and debit notes against a seller.
 *
 * A settlement statement is derived from trade: gross, commission, fees,
 * refunds, withholding. So when the marketplace owes a seller something that is
 * not about a sale — commission charged at the wrong rate for a month, a
 * promotion the marketplace agreed to fund, a fee billed twice, an SLA penalty
 * in the contract — there is nowhere on the statement to put it, and it gets put
 * somewhere wrong. Either the commission rate is adjusted, so the seller's own
 * reconciliation against their contracted rate fails and they dispute a rate
 * nobody changed; or it is netted into fees, where it cannot be explained,
 * appealed or reversed.
 *
 * A note is the alternative: separate, reasoned, evidenced, approved, and
 * visible on the statement as itself.
 *
 * Three things carry the module.
 *
 * DIRECTION IS A KIND, NOT A SIGN. `amount` is always positive and `kind` says
 * which way it moves. A signed amount beside a kind is two places to get the
 * direction wrong, and they disagree eventually.
 *
 * THE SECOND APPROVER IS A THIRD PERSON. Every marketplace has an approval
 * ceiling and most can be satisfied by the raiser clicking approve twice. The
 * rule is enforced in the database; it is evaluated here too so the button is
 * disabled with a reason rather than failing on submit.
 *
 * A NOTE NEVER MOVES MONEY ON ITS OWN. It changes what the next run pays. That
 * is why an issued note is an exposure the marketplace has committed to and not
 * yet settled, and why the screen reports that figure separately from what has
 * already landed.
 */

export type NoteKind = 'credit' | 'debit'
export type NoteState = 'draft' | 'pending' | 'issued' | 'applied' | 'void' | 'disputed'

export interface NotePolicy {
  id: string
  currency: string
  auto_approve_below: number
  second_approval_above: number
  require_evidence_above: number
  void_window_days: number
  tax_treatment: string
  settle_on: string
  note: string
}

export interface NoteReason {
  id: string
  kind: NoteKind
  label: string
  guidance: string
  needs_ref: boolean
  ref_label: string | null
  active: boolean
  sort_order: number
}

export interface Note {
  id: string
  partner_id: string
  kind: NoteKind
  reason_id: string
  amount: number
  currency: string
  tax: number
  tax_rate: number | null
  period: string | null
  ref: string | null
  evidence: string | null
  detail: string
  state: NoteState
  raised_by: string
  raised_on: string
  approved_by: string | null
  approved_on: string | null
  second_approved_by: string | null
  second_approved_on: string | null
  statement_id: string | null
  applied_on: string | null
  void_reason: string | null
  void_on: string | null
  disputed_on: string | null
  dispute_note: string | null
}

export const STATE_LABEL: Record<NoteState, string> = {
  draft: 'Draft',
  pending: 'Awaiting a second signature',
  issued: 'Issued',
  applied: 'Settled',
  void: 'Voided',
  disputed: 'Disputed',
}

export const STATE_TONE: Record<NoteState, string> = {
  draft: 'draft',
  pending: 'pending',
  issued: 'current',
  applied: 'healthy',
  void: 'degraded',
  disputed: 'rejected',
}

/** What the state means to the seller reading it, which is the audience that matters. */
export const STATE_MEANING: Record<NoteState, string> = {
  draft: 'Being written. The seller cannot see it.',
  pending: 'Approved once and waiting for a second signature, because of what it is worth.',
  issued: 'Agreed by the marketplace. It applies at the next settlement run for this seller.',
  applied: 'Settled. It is a line on a statement.',
  void: 'Cancelled before it settled. The reason is kept.',
  disputed: 'The seller has challenged it. It does not settle while the dispute is open.',
}

/** Which way it moves the payout. Positive pays the seller more. */
export function signedAmount(note: Pick<Note, 'kind' | 'amount'>): number {
  return note.kind === 'credit' ? note.amount : -note.amount
}

export function netOf(notes: readonly Pick<Note, 'kind' | 'amount'>[]): number {
  return Math.round(notes.reduce((n, x) => n + signedAmount(x), 0) * 100) / 100
}

/* ------------------------------------------------------------- approval -- */

export type ApprovalNeed = 'none' | 'one' | 'two'

/**
 * How many signatures this is worth.
 *
 * The threshold decides, not the person raising it — otherwise the control is
 * whatever the raiser believes it is.
 */
export function approvalNeeded(amount: number, policy: NotePolicy): ApprovalNeed {
  if (amount >= policy.second_approval_above) return 'two'
  if (amount >= policy.auto_approve_below) return 'one'
  return 'none'
}

export function needsEvidence(amount: number, policy: NotePolicy): boolean {
  return amount >= policy.require_evidence_above
}

/**
 * Whether this person may put their name to it now, and why not.
 *
 * The self-approval rule is the whole control. A disabled button with a reason
 * is better than an enabled one that fails, because the reason is the thing
 * somebody needs to understand.
 */
export function canApprove(
  note: Note, actor: string, policy: NotePolicy,
): { ok: true; which: 'first' | 'second' } | { ok: false; reason: string } {
  if (note.state === 'applied' || note.state === 'void') {
    return { ok: false, reason: `${note.id} is already ${STATE_LABEL[note.state].toLowerCase()}.` }
  }
  if (note.state === 'disputed') {
    return {
      ok: false,
      reason: 'The seller has challenged this note. It does not settle while the dispute is open — resolve that first.',
    }
  }
  if (actor === note.raised_by) {
    return { ok: false, reason: `${actor} raised this note and cannot also approve it.` }
  }
  if (note.approved_by === null) return { ok: true, which: 'first' }

  if (approvalNeeded(note.amount, policy) !== 'two') {
    return { ok: false, reason: `${note.id} is already approved and does not need a second signature.` }
  }
  if (note.second_approved_by !== null) {
    return { ok: false, reason: `${note.id} already has both signatures.` }
  }
  if (actor === note.approved_by) {
    return {
      ok: false,
      reason: `${actor} has already approved this note. A second signature has to come from a third person.`,
    }
  }
  return { ok: true, which: 'second' }
}

/** What is still outstanding on a note before it can issue, in words. */
export function whatIsMissing(
  note: Note, reason: NoteReason | null, policy: NotePolicy,
): string[] {
  const out: string[] = []
  if (needsEvidence(note.amount, policy) && !(note.evidence ?? '').trim()) {
    out.push(`Evidence — anything of ${policy.require_evidence_above} ${policy.currency} or more needs it.`)
  }
  if (reason?.needs_ref && !(note.ref ?? '').trim()) {
    out.push(`${reason.ref_label ?? 'A reference'} — without it the seller cannot check the claim.`)
  }
  if (!note.detail.trim()) out.push('An explanation the seller can read.')

  const need = approvalNeeded(note.amount, policy)
  if (need !== 'none' && !note.approved_by) out.push('An approver.')
  if (need === 'two' && note.approved_by && !note.second_approved_by) {
    out.push(`A second approver — it is at or above ${policy.second_approval_above} ${policy.currency}.`)
  }
  return out
}

/** Whether it can still be pulled back, and if not, what to do instead. */
export function canVoid(
  note: Note, policy: NotePolicy, today: string,
): { ok: true; until: string } | { ok: false; reason: string } {
  if (note.state === 'applied') {
    return {
      ok: false,
      reason: `${note.id} has settled on ${note.statement_id}. Reverse it with a note the other way rather than voiding it.`,
    }
  }
  if (note.state === 'void') return { ok: false, reason: 'Already voided.' }

  const raised = new Date(note.raised_on + 'T00:00:00Z')
  const until = new Date(raised.getTime() + policy.void_window_days * 86400000)
    .toISOString().slice(0, 10)
  if (today > until) {
    return {
      ok: false,
      reason: `The void window is ${policy.void_window_days} days and it closed on ${until}. Reverse it with a note the other way.`,
    }
  }
  return { ok: true, until }
}

/* ----------------------------------------------------------- the queue -- */

/**
 * What somebody should work, worst first.
 *
 * A disputed note is a seller who thinks they have been charged wrongly and is
 * not being paid while it is open. A pending one is money the marketplace has
 * decided to move and has not finished deciding. A draft is somebody's
 * unfinished work and comes last.
 */
export function workQueue(notes: readonly Note[]): Note[] {
  const rank = (n: Note): number =>
    n.state === 'disputed' ? 0 : n.state === 'pending' ? 1
      : n.state === 'issued' ? 2 : n.state === 'draft' ? 3 : 4
  return [...notes].sort((a, b) => {
    const d = rank(a) - rank(b)
    if (d !== 0) return d
    /* Within a rank, the biggest first — it is the one whose delay costs most. */
    return b.amount - a.amount
  })
}

export interface Exposure {
  /* Agreed and not yet on a statement. This is what the marketplace has
     committed to and not paid, and it belongs on a screen by itself. */
  committed: number
  /* On a statement, done. */
  settled: number
  /* Decided by nobody yet. */
  awaiting: number
  disputed: number
  currency: string
}

export function exposure(notes: readonly Note[], policy: NotePolicy): Exposure {
  const sum = (s: NoteState) => netOf(notes.filter(n => n.state === s))
  return {
    committed: sum('issued'),
    settled: sum('applied'),
    awaiting: netOf(notes.filter(n => n.state === 'pending' || n.state === 'draft')),
    disputed: sum('disputed'),
    currency: policy.currency,
  }
}

/** One sentence for a row, naming the reason and what it is against. */
export function line(note: Note, reason: NoteReason | null): string {
  const what = reason?.label ?? note.reason_id
  const against = note.ref ? ` against ${note.ref}` : ''
  const when = note.period ? ` for ${note.period}` : ''
  return `${what}${when}${against}.`
}

/**
 * The next id, following whatever is already there.
 *
 * Credits and debits number separately because they are different documents to
 * an auditor, and a single sequence makes a run of credit notes look like a gap.
 */
export function nextId(notes: readonly Note[], kind: NoteKind, year: number): string {
  const prefix = kind === 'credit' ? 'CN' : 'DN'
  const seen = notes
    .map(n => new RegExp(`^${prefix}-${year}-(\\d+)$`).exec(n.id))
    .filter((m): m is RegExpExecArray => m !== null)
    .map(m => Number(m[1]))
  const next = seen.length === 0 ? 1 : Math.max(...seen) + 1
  return `${prefix}-${year}-${String(next).padStart(4, '0')}`
}

/** Reasons available for a kind, in the order they are offered. */
export function reasonsFor(reasons: readonly NoteReason[], kind: NoteKind): NoteReason[] {
  return reasons.filter(r => r.kind === kind && r.active).sort((a, b) => a.sort_order - b.sort_order)
}

/**
 * Where a set of notes disagrees with itself or with the policy.
 *
 * The interesting one is the last: a note issued above the ceiling without a
 * second signature means the control was bypassed, and it is worth finding on a
 * screen rather than in an audit.
 */
export function noteProblems(
  notes: readonly Note[], reasons: readonly NoteReason[], policy: NotePolicy,
): string[] {
  const out: string[] = []
  for (const n of notes) {
    const r = reasons.find(x => x.id === n.reason_id) ?? null
    if (r && r.kind !== n.kind) {
      out.push(`${n.id} is a ${n.kind} note raised under "${r.label}", which is a ${r.kind} reason.`)
    }
    if (n.currency !== policy.currency) {
      out.push(`${n.id} is in ${n.currency} and statements are denominated in ${policy.currency}.`)
    }
    if ((n.state === 'issued' || n.state === 'applied')
        && approvalNeeded(n.amount, policy) === 'two' && !n.second_approved_by) {
      out.push(`${n.id} is ${n.state} at ${n.amount} ${n.currency} on one signature. It is at or above the ${policy.second_approval_above} ceiling.`)
    }
    if (n.approved_by && n.approved_by === n.raised_by) {
      out.push(`${n.id} was approved by the person who raised it.`)
    }
    if (n.second_approved_by && n.second_approved_by === n.approved_by) {
      out.push(`${n.id} carries two signatures from the same person.`)
    }
  }
  return out
}
