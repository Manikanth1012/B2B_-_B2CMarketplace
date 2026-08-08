/* Reading and moving credit and debit notes.
 *
 * Raising, voiding and disputing are ordinary table writes — the guard trigger
 * refuses the wrong ones, so a screen cannot talk the database into a state the
 * policy forbids. Approving goes through `approve_note` instead, because what a
 * signature is worth is the threshold's answer and not the caller's: a client
 * that decided its own approval level would be a control the client owns.
 *
 * Every numeric arrives from PostgREST as a string. A screen that adds two of
 * them without `Number()` concatenates them and reports a settlement figure with
 * a comma in it, so the conversion happens here once rather than at each use.
 */

import { supabase } from './supabase'
import type { Note, NoteReason, NotePolicy, NoteKind } from './creditNotes'

const NOTE_NUM = ['amount', 'tax', 'tax_rate']

const num = <T,>(row: T, keys: readonly string[]): T => {
  const out = { ...row } as Record<string, unknown>
  for (const k of keys) if (out[k] != null) out[k] = Number(out[k])
  return out as T
}

/** A statement a note could still land on. Signed-off ones cannot take one. */
export interface OpenStatement {
  id: string
  partner_id: string
  partner_name: string
  period: string
  status: string
  currency: string
  net: number
  adjustments: number
}

export interface NoteBook {
  notes: Note[]
  reasons: NoteReason[]
  policy: NotePolicy | null
  sellers: { id: string; name: string; status: string }[]
  open: OpenStatement[]
  loadError?: string
}

/* ------------------------------------------------------------ the operator -- */

export async function loadNoteBook(): Promise<NoteBook> {
  const [n, r, p, s, st] = await Promise.all([
    supabase.from('settlement_note').select('*').order('raised_on', { ascending: false }),
    supabase.from('note_reason').select('*').order('sort_order'),
    supabase.from('note_policy').select('*').eq('id', 'standard').maybeSingle(),
    supabase.from('partners').select('id,name,status').order('name'),
    supabase.from('settlement_statements')
      .select('id,partner_id,partner_name,period,status,currency,net,adjustments')
      .in('status', ['open', 'pending'])
      .order('period', { ascending: false }),
  ])

  const errors: string[] = []
  if (n.error) errors.push(`the notes: ${n.error.message}`)
  if (r.error) errors.push(`the reasons: ${r.error.message}`)
  if (p.error) errors.push(`the policy: ${p.error.message}`)

  return {
    notes: ((n.data ?? []) as Note[]).map(x => num(x, NOTE_NUM)),
    reasons: ((r.data ?? []) as NoteReason[]).map(x => num(x, ['sort_order'])),
    policy: p.data
      ? num(p.data as NotePolicy,
            ['auto_approve_below', 'second_approval_above', 'require_evidence_above', 'void_window_days'])
      : null,
    sellers: (s.data ?? []) as NoteBook['sellers'],
    open: ((st.data ?? []) as OpenStatement[]).map(x => num(x, ['net', 'adjustments'])),
    ...(errors.length ? { loadError: `Some of the note book did not load (${errors.join('; ')}).` } : {}),
  }
}

export interface NewNote {
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
  raised_by: string
}

/**
 * Raise one. It starts as a draft whatever it is worth — a note the seller can
 * see is one somebody has decided on, and deciding is what approval is.
 */
export async function raiseNote(note: NewNote): Promise<{ ok: boolean; why?: string }> {
  const { error } = await supabase.from('settlement_note').insert({
    ...note,
    state: 'draft',
    raised_on: new Date().toISOString().slice(0, 10),
  })
  return error ? { ok: false, why: error.message } : { ok: true }
}

/**
 * Put a name to it. The database decides whether that is the first signature or
 * the second, and whether one was enough.
 */
export async function approveNote(
  id: string, actor: string,
): Promise<{ ok: boolean; why?: string; state?: string }> {
  const { data, error } = await supabase.rpc('approve_note', { p_id: id, p_actor: actor })
  if (error) return { ok: false, why: error.message }
  const r = (data ?? {}) as { ok?: boolean; why?: string; state?: string }
  return { ok: r.ok === true, why: r.why, state: r.state }
}

/** Pull one back before it settles. The reason is kept — a void with no reason is a deletion. */
export async function voidNote(id: string, reason: string): Promise<{ ok: boolean; why?: string }> {
  if (!reason.trim()) {
    return { ok: false, why: 'Say why it is being voided. It stays on the record either way.' }
  }
  const { error } = await supabase.from('settlement_note')
    .update({ state: 'void', void_reason: reason, void_on: new Date().toISOString().slice(0, 10) })
    .eq('id', id)
  return error ? { ok: false, why: error.message } : { ok: true }
}

/** Edit a draft. Once it has a signature on it, nothing here can move. */
export async function saveDraft(
  id: string, patch: Partial<NewNote>,
): Promise<{ ok: boolean; why?: string }> {
  const { error } = await supabase.from('settlement_note').update(patch).eq('id', id)
  return error ? { ok: false, why: error.message } : { ok: true }
}

/**
 * Land every issued note for that seller on a statement now, rather than waiting
 * for the run. The run does this itself; the button exists for a statement that
 * was cut before somebody finished approving.
 */
export async function applyToStatement(
  statementId: string,
): Promise<{ ok: boolean; why?: string; applied?: number }> {
  const { data, error } = await supabase.rpc('apply_notes', { p_statement: statementId })
  if (error) return { ok: false, why: error.message }
  const r = (data ?? {}) as { ok?: boolean; why?: string; applied?: number }
  return { ok: r.ok === true, why: r.why, applied: r.applied }
}

/** Take a dispute off a note, once somebody has dealt with it. */
export async function resolveDispute(
  id: string, back: 'issued' | 'void', how: string,
): Promise<{ ok: boolean; why?: string }> {
  if (!how.trim()) {
    return { ok: false, why: 'Say how it was resolved. The seller raised it and is owed an answer.' }
  }
  const patch = back === 'void'
    ? { state: 'void', void_reason: how, void_on: new Date().toISOString().slice(0, 10) }
    : { state: 'issued', dispute_note: `${how}` }
  const { error } = await supabase.from('settlement_note').update(patch).eq('id', id)
  return error ? { ok: false, why: error.message } : { ok: true }
}

/* -------------------------------------------------------------- the seller -- */

export interface MyNotes {
  notes: Note[]
  reasons: NoteReason[]
  policy: NotePolicy | null
}

/**
 * What the seller can see: their own notes, once they are past being a draft.
 * The filtering is row-level security's, not this function's — asking for
 * everything and being handed the seller's own is the point of the policy.
 */
export async function loadMyNotes(): Promise<MyNotes> {
  const [n, r, p] = await Promise.all([
    supabase.from('settlement_note').select('*').order('raised_on', { ascending: false }),
    supabase.from('note_reason').select('*').order('sort_order'),
    supabase.from('note_policy').select('*').eq('id', 'standard').maybeSingle(),
  ])
  return {
    notes: ((n.data ?? []) as Note[]).map(x => num(x, NOTE_NUM)),
    reasons: ((r.data ?? []) as NoteReason[]).map(x => num(x, ['sort_order'])),
    policy: p.data
      ? num(p.data as NotePolicy,
            ['auto_approve_below', 'second_approval_above', 'require_evidence_above', 'void_window_days'])
      : null,
  }
}

/**
 * The seller's one move. Only `state` and `dispute_note` are sent: the guard
 * refuses anything else, and sending the whole row would make an honest screen
 * look like an attempt to rewrite the document.
 */
export async function disputeNote(id: string, why: string): Promise<{ ok: boolean; why?: string }> {
  if (!why.trim()) {
    return { ok: false, why: 'Say what is wrong with it. A dispute with no reason cannot be investigated.' }
  }
  const { error } = await supabase.from('settlement_note')
    .update({ state: 'disputed', dispute_note: why, disputed_on: new Date().toISOString().slice(0, 10) })
    .eq('id', id)
  return error ? { ok: false, why: error.message } : { ok: true }
}
