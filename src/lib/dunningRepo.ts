/* The only module that talks to Supabase about dunning. */
import { supabase } from './supabase'
import {
  type Ladder, type Step, type Case, type Audience,
  canAddStep, validateLadder, canDeleteLadder, ladderFor, stepsOn,
} from './dunning'

export type Result = { ok: true; note?: string } | { ok: false; reason: string }

export interface DunningBook {
  ladders: Ladder[]
  steps: Step[]
  cases: Case[]
  loadError?: string
}

export async function loadDunning(): Promise<DunningBook> {
  const [lRes, sRes, cRes] = await Promise.all([
    supabase.from('dunning_ladders').select('*').order('sort_order'),
    supabase.from('dunning_steps').select('*').order('step_no'),
    supabase.from('operator_dunning_cases').select('*').order('sort_order'),
  ])

  const book: DunningBook = {
    ladders: (lRes.data ?? []) as Ladder[],
    steps: (sRes.data ?? []) as Step[],
    cases: (cRes.data ?? []) as Case[],
  }
  const failed = [lRes.error, sRes.error, cRes.error].find(Boolean)
  return failed ? { ...book, loadError: failed.message } : book
}

/* ------------------------------------------------------------- ladders --- */

export type LadderDraft = Pick<Ladder,
  'name' | 'audience' | 'tier' | 'grace_days' | 'suspend_on_day' |
  'withhold_settlement' | 'pause_on_promise' | 'note'>

export async function saveLadder(
  { id, draft, actor, ladders }: {
    id: string | null; draft: LadderDraft; actor: string; ladders: readonly Ladder[]
  },
): Promise<Result & { id?: string }> {
  /* Validated against the other ladders minus this one, so editing a ladder
     does not fail on being harsher than itself. */
  const check = validateLadder(draft, ladders.filter(l => l.id !== id))
  if (!check.ok) return check

  const isNew = !id
  const ladderId = id ?? `DL-${Date.now().toString(36).toUpperCase().slice(-5)}`

  const { data, error } = await supabase.from('dunning_ladders').upsert({
    ...draft,
    id: ladderId,
    tier: draft.tier || null,
    updated_by: actor,
    updated_on: new Date().toISOString().slice(0, 10),
    ...(isNew ? { system: false, sort_order: 90 } : {}),
  }).select('id')

  if (error) return { ok: false, reason: friendly(error.message) }
  if (!data?.length) return { ok: false, reason: REFUSED }

  await writeAudit(actor, isNew ? 'dunning.ladder.created' : 'dunning.ladder.edited',
    draft.name, isNew ? null : ladderId, isNew ? 'created' : 'edited',
    `${draft.audience}${draft.tier ? ` · ${draft.tier}` : ' default'}`)

  return {
    ok: true,
    id: ladderId,
    note: isNew
      ? `${draft.name} created. Accounts resolve onto it from their next chase — cases already running keep the ladder they are on.`
      : `${draft.name} saved. It applies to steps not yet taken; nothing already sent is unsent.`,
  }
}

export async function deleteLadder(
  { ladder, cases, actor }: { ladder: Ladder; cases: readonly Case[]; actor: string },
): Promise<Result> {
  const check = canDeleteLadder(ladder, cases)
  if (!check.ok) return check

  const { data, error } = await supabase.from('dunning_ladders')
    .delete().eq('id', ladder.id).select('id')
  if (error) return { ok: false, reason: friendly(error.message) }
  if (!data?.length) return { ok: false, reason: REFUSED }

  await writeAudit(actor, 'dunning.ladder.deleted', ladder.name, ladder.id, 'deleted',
    'Unused tier ladder removed', 'warn')
  return { ok: true, note: `${ladder.name} deleted. Accounts at that tier fall back to the audience default.` }
}

/* --------------------------------------------------------------- steps --- */

export type StepDraft = Pick<Step, 'name' | 'day' | 'channel' | 'action' | 'note'>

export async function saveStep(
  { id, ladder, draft, stepNo, actor }: {
    id: string | null; ladder: Ladder; draft: StepDraft; stepNo: number; actor: string
  },
): Promise<Result> {
  const check = canAddStep(draft, ladder)
  if (!check.ok) return check
  if (!draft.name.trim()) return { ok: false, reason: 'A step needs a name — it is what the case list shows the collector.' }

  const stepId = id ?? `DS-${Date.now().toString(36).toUpperCase().slice(-6)}`
  const { data, error } = await supabase.from('dunning_steps').upsert({
    ...draft, id: stepId, ladder_id: ladder.id, step_no: stepNo,
  }).select('id')

  if (error) return { ok: false, reason: friendly(error.message) }
  if (!data?.length) return { ok: false, reason: REFUSED }

  await writeAudit(actor, id ? 'dunning.step.edited' : 'dunning.step.added',
    `${ladder.name} — ${draft.name}`, null, `day ${draft.day}`, `${draft.channel} · ${draft.action}`)
  return { ok: true, note: `${draft.name} saved on ${ladder.name}.` }
}

/**
 * Take a step off, and close the gap it leaves.
 *
 * Renumbering matters: a case records which step it is on as a number, so a
 * hole in the sequence is an account that stops advancing. The rows below the
 * gap move up in the same call.
 */
export async function deleteStep(
  { step, ladder, steps, actor }: {
    step: Step; ladder: Ladder; steps: readonly Step[]; actor: string
  },
): Promise<Result> {
  const { data, error } = await supabase.from('dunning_steps')
    .delete().eq('id', step.id).select('id')
  if (error) return { ok: false, reason: friendly(error.message) }
  if (!data?.length) return { ok: false, reason: REFUSED }

  const after = stepsOn(ladder.id, steps).filter(s => s.step_no > step.step_no)
  for (const s of after) {
    const { error: moveErr } = await supabase.from('dunning_steps')
      .update({ step_no: s.step_no - 1 }).eq('id', s.id)
    if (moveErr) {
      return {
        ok: false,
        reason: `${step.name} was removed but the steps below it did not move up: ${friendly(moveErr.message)}. Reload before editing this ladder again.`,
      }
    }
  }

  await writeAudit(actor, 'dunning.step.removed', `${ladder.name} — ${step.name}`,
    `step ${step.step_no}`, 'removed', `${after.length} later steps moved up`, 'warn')
  return { ok: true, note: `${step.name} removed. The steps after it moved up so nobody stalls on a gap.` }
}

/** Move a step earlier or later in the sequence. */
export async function moveStep(
  { step, ladder, steps, delta, actor }: {
    step: Step; ladder: Ladder; steps: readonly Step[]; delta: -1 | 1; actor: string
  },
): Promise<Result> {
  const mine = stepsOn(ladder.id, steps)
  const swap = mine.find(s => s.step_no === step.step_no + delta)
  if (!swap) return { ok: false, reason: 'It is already at the end of the ladder.' }

  /* Three writes, not two. `(ladder_id, step_no)` is unique, so moving the
     first step onto the second's number collides while the second is still
     sitting there — the swap has to park one of them somewhere nobody is.
     9000 is out of the way of any real ladder and is never left behind: if the
     second write fails, the third puts it back where it started.
     The days move with the positions, or the ladder would chase backwards. */
  const PARK = 9000

  const parked = await supabase.from('dunning_steps')
    .update({ step_no: PARK }).eq('id', step.id).select('id')
  if (parked.error) return { ok: false, reason: friendly(parked.error.message) }
  if (!parked.data?.length) return { ok: false, reason: REFUSED }

  const b = await supabase.from('dunning_steps')
    .update({ step_no: step.step_no, day: step.day }).eq('id', swap.id).select('id')
  if (b.error) {
    await supabase.from('dunning_steps')
      .update({ step_no: step.step_no }).eq('id', step.id)
    return { ok: false, reason: friendly(b.error.message) }
  }

  const a = await supabase.from('dunning_steps')
    .update({ step_no: step.step_no + delta, day: swap.day }).eq('id', step.id).select('id')
  if (a.error) return { ok: false, reason: friendly(a.error.message) }
  if (!a.data?.length) return { ok: false, reason: REFUSED }

  await writeAudit(actor, 'dunning.step.moved', `${ladder.name} — ${step.name}`,
    `step ${step.step_no}`, `step ${step.step_no + delta}`, 'Reordered')
  return { ok: true, note: `${step.name} moved.` }
}

/* --------------------------------------------------------------- cases --- */

/** Put a case back on the ladder its account actually resolves to. */
export async function reresolveCase(
  { c, ladders, actor }: { c: Case; ladders: readonly Ladder[]; actor: string },
): Promise<Result> {
  const wanted = ladderFor({ audience: c.account_type as Audience, tier: c.tier }, ladders)
  if (!wanted) return { ok: false, reason: `No ladder is written for a ${c.account_type} account.` }
  if (wanted.id === c.ladder_id) return { ok: true, note: `${c.account_name} is already on ${wanted.name}.` }

  const { data, error } = await supabase.from('operator_dunning_cases')
    .update({ ladder_id: wanted.id, ladder: c.account_type }).eq('id', c.id).select('id')
  if (error) return { ok: false, reason: friendly(error.message) }
  if (!data?.length) return { ok: false, reason: REFUSED }

  await writeAudit(actor, 'dunning.case.resolved', c.account_name, c.ladder_id, wanted.id,
    `Re-resolved from the account: ${c.account_type}${c.tier ? ` · ${c.tier}` : ''}`)
  return { ok: true, note: `${c.account_name} now runs on ${wanted.name}.` }
}

/* --------------------------------------------------------------- helpers -- */

const REFUSED = 'Nothing changed. Only the marketplace operator can edit collections rules.'

async function writeAudit(
  actor: string, action: string, object: string, before: string | null,
  after: string, detail: string, severity = 'info',
): Promise<void> {
  await supabase.from('operator_audit_log').insert({
    id: `AUD-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    actor, role: 'Marketplace operations', action, object,
    category: 'Settlement', severity, outcome: 'success',
    before_val: before, after_val: `${after} — ${detail}`,
  })
}

/* The database refuses in its own language. These are the same refusals in the
   language of somebody who was trying to do something. */
function friendly(message: string): string {
  const m = message.replace(/^.*?\bERROR:\s*/i, '').trim()
  if (/never suspended|strands buyers|withhold the settlement/i.test(m)) return m
  if (/ships with the marketplace|is the default for every|being chased on/i.test(m)) return m
  if (/inside the .* days of grace|before the bill was due/i.test(m)) return m
  if (/dunning_ladder_default_idx/i.test(m)) {
    return 'That audience already has a default ladder. Edit the one it has rather than adding a second.'
  }
  if (/dunning_ladder_tier_idx/i.test(m)) {
    return 'That tier already has a ladder of its own. Edit the one it has.'
  }
  if (/dunning_steps_ladder_id_step_no_key|duplicate key/i.test(m)) {
    return 'Another step already sits at that position. Reload the ladder and try again.'
  }
  if (/violates check constraint.*channel/i.test(m)) return 'That is not a channel this marketplace can send on.'
  if (/violates check constraint.*action/i.test(m)) return 'That is not something a dunning step can do.'
  if (/row-level security|permission denied/i.test(m)) return REFUSED
  if (/violates foreign key/i.test(m)) return 'That ladder no longer exists. Reload the screen.'
  return m
}
