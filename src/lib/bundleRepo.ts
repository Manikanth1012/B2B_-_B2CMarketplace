// The only module that reads or writes bundle templates and selections.
//
// Pricing, ownership, currency, the seven-day hold and every rule about what
// may be sold live in the database (price_bundle, configure_bundle, the guards
// and RLS). Nothing here decides: it asks, and hands back the database's own
// sentence when the answer is no. No function throws, and none reports success
// it did not see — a write that changes no row is an error, not an "ok".

import { supabase } from './supabase'
import type { BundleTemplate, BundleSlot, BundleOption, Choices } from './bundles'
import {
  asTemplate, asSlot, asOption, asSelection, asSelectionLine, asPriced,
  priceArgs, planTemplateSave, templateRow, type SlotInput, type Selection, type SelectionLine,
} from './bundlePayload'

export interface BundleBook { templates: BundleTemplate[]; slots: BundleSlot[]; options: BundleOption[]; loadError: string | null }
export type { Selection, SelectionLine }
type Result<T = void> = { ok: true; value: T } | { ok: false; error: string }

const NOTHING = 'Nothing changed — you are not allowed to make that change, or it no longer exists.'

/* --------------------------------------------------------------- reading -- */

/** Everything the signed-in persona can see; RLS does the scoping. */
export async function loadBundleBook(): Promise<BundleBook> {
  try {
    const [t, s, o] = await Promise.all([
      supabase.from('bundle_templates').select('*').order('name'),
      supabase.from('bundle_slots').select('*').order('sort_order'),
      supabase.from('bundle_options').select('*').order('sort_order'),
    ])
    const errors: string[] = []
    const grab = (res: { data: unknown; error: { message: string } | null }, what: string): Record<string, unknown>[] => {
      if (res.error) errors.push(`${what}: ${res.error.message}`)
      return (res.data ?? []) as Record<string, unknown>[]
    }
    return {
      templates: grab(t, 'bundles').map(asTemplate),
      slots: grab(s, 'parts').map(asSlot),
      options: grab(o, 'options').map(asOption),
      loadError: errors.length ? `Some of this did not load (${errors.join('; ')}).` : null,
    }
  } catch (err) {
    return { templates: [], slots: [], options: [], loadError: errorText(err) }
  }
}

/** The configuration a buyer starts from, as the database builds it. */
export async function defaultChoicesOnServer(templateId: string): Promise<Result<Choices>> {
  try {
    const { data, error } = await supabase.rpc('bundle_default_choices', { p_template: templateId })
    if (error) return { ok: false, error: error.message }
    if (!data || typeof data !== 'object' || Array.isArray(data)) return { ok: false, error: 'The database did not say what to start from.' }
    return { ok: true, value: data as Choices }
  } catch (err) {
    return { ok: false, error: errorText(err) }
  }
}

/** Selections by id, with their lines. RLS shows only the caller's own; an id
    that is not theirs is simply absent. No ids is a successful, empty answer. */
export async function loadSelections(ids: string[]): Promise<Result<{ selections: Selection[]; lines: SelectionLine[] }>> {
  const unique = [...new Set(ids)]
  if (unique.length === 0) return { ok: true, value: { selections: [], lines: [] } }
  try {
    const [s, l] = await Promise.all([
      supabase.from('bundle_selections').select('*').in('id', unique),
      supabase.from('bundle_selection_lines').select('*').in('selection_id', unique).order('sort_order'),
    ])
    if (s.error) return { ok: false, error: s.error.message }
    if (l.error) return { ok: false, error: l.error.message }
    return {
      ok: true,
      value: {
        selections: ((s.data ?? []) as Record<string, unknown>[]).map(asSelection),
        lines: ((l.data ?? []) as Record<string, unknown>[]).map(asSelectionLine),
      },
    }
  } catch (err) {
    return { ok: false, error: errorText(err) }
  }
}

/* --------------------------------------------------------------- pricing -- */

/** What the database would charge. Writes nothing. The lines carry no id and
    no selection: there is not one yet. */
export async function priceOnServer(templateId: string, choices: Choices, currency: string, quantity: number):
  Promise<Result<{ lines: SelectionLine[]; total: number; parts_total: number; saving: number }>> {
  try {
    const { data, error } = await supabase.rpc('price_bundle', priceArgs(templateId, choices, currency, quantity))
    if (error) return { ok: false, error: error.message }
    const priced = asPriced(data)
    if (!priced) return { ok: false, error: 'The database did not say what the bundle costs.' }
    return { ok: true, value: priced }
  } catch (err) {
    return { ok: false, error: errorText(err) }
  }
}

/** Price it and hold it for seven days; then read back what was written. */
export async function configureBundle(templateId: string, choices: Choices, currency: string, quantity: number):
  Promise<Result<{ selection: Selection; lines: SelectionLine[] }>> {
  try {
    const { data, error } = await supabase.rpc('configure_bundle', priceArgs(templateId, choices, currency, quantity))
    if (error) return { ok: false, error: error.message }
    if (typeof data !== 'string' || !data) return { ok: false, error: 'The database did not say what the bundle was called.' }
    const got = await loadSelections([data])
    if (!got.ok) return got
    const selection = got.value.selections[0]
    if (!selection) return { ok: false, error: 'The bundle was priced but cannot be read back.' }
    return { ok: true, value: { selection, lines: got.value.lines } }
  } catch (err) {
    return { ok: false, error: errorText(err) }
  }
}

/* -------------------------------------------------------------- operator -- */

/** Create or change a template with its slots and options. A live template is
    frozen: the database refuses any change to its slots or options, and that
    sentence is what comes back — pause it, edit, publish again. Only what
    differs is written (planTemplateSave), so renaming a live template touches
    no slot. Not one transaction; a refusal part-way leaves the earlier steps
    done, and the screen reloads to show what stands. Returns the template id. */
export async function saveTemplate(
  t: Omit<BundleTemplate, 'id'> & { id?: string },
  slots: SlotInput[],
): Promise<Result<string>> {
  let created: string | null = null
  try {
    const r = await saveTemplateSteps(t, slots, id => { created = id })
    if (!r.ok && created) await discardDraft(created)
    return r
  } catch (err) {
    if (created) await discardDraft(created)
    return { ok: false, error: errorText(err) }
  }
}

/** A create that failed leaves nothing behind: the new draft (its slots and
    options go with it) is removed, so a retry cannot make a second one. If the
    delete itself is refused the draft stays and is harmless; the error shown
    is still the original one. */
async function discardDraft(id: string): Promise<void> {
  try { await supabase.from('bundle_templates').delete().eq('id', id) } catch { /* the original error is the one to show */ }
}

async function saveTemplateSteps(
  t: Omit<BundleTemplate, 'id'> & { id?: string },
  slots: SlotInput[],
  onCreated: (id: string) => void,
): Promise<Result<string>> {
  try {
    let id = t.id
    let existingSlots: BundleSlot[] = []
    let existingOptions: BundleOption[] = []

    if (id) {
      const [s, o] = await Promise.all([
        supabase.from('bundle_slots').select('*').eq('template_id', id),
        supabase.from('bundle_options').select('*, bundle_slots!inner(template_id)').eq('bundle_slots.template_id', id),
      ])
      if (s.error) return { ok: false, error: s.error.message }
      if (o.error) return { ok: false, error: o.error.message }
      existingSlots = ((s.data ?? []) as Record<string, unknown>[]).map(asSlot)
      existingOptions = ((o.data ?? []) as Record<string, unknown>[]).map(asOption)
    } else {
      const ins = await supabase.from('bundle_templates').insert(templateRow(t)).select('id')
      if (ins.error) return { ok: false, error: ins.error.message }
      id = (ins.data?.[0] as { id: string } | undefined)?.id
      if (!id) return { ok: false, error: NOTHING }
      onCreated(id)
    }

    const plan = planTemplateSave(existingSlots, existingOptions, slots)

    if (plan.removeSlots.length) {
      const r = await supabase.from('bundle_slots').delete().in('id', plan.removeSlots).select('id')
      if (r.error) return { ok: false, error: r.error.message }
      if (!r.data?.length) return { ok: false, error: NOTHING }
    }

    for (const sp of plan.slots) {
      let slotId = sp.id
      if (slotId === null) {
        const r = await supabase.from('bundle_slots').insert({ ...sp.fields, template_id: id }).select('id')
        if (r.error) return { ok: false, error: r.error.message }
        slotId = (r.data?.[0] as { id: string } | undefined)?.id ?? null
        if (!slotId) return { ok: false, error: NOTHING }
      } else if (sp.write) {
        const r = await supabase.from('bundle_slots').update(sp.fields).eq('id', slotId).select('id')
        if (r.error) return { ok: false, error: r.error.message }
        if (!r.data?.length) return { ok: false, error: NOTHING }
      }
      if (sp.options.remove.length) {
        const r = await supabase.from('bundle_options').delete().in('id', sp.options.remove).select('id')
        if (r.error) return { ok: false, error: r.error.message }
        if (!r.data?.length) return { ok: false, error: NOTHING }
      }
      for (const c of sp.options.change) {
        const r = await supabase.from('bundle_options').update({ is_default: c.is_default, sort_order: c.sort_order }).eq('id', c.id).select('id')
        if (r.error) return { ok: false, error: r.error.message }
        if (!r.data?.length) return { ok: false, error: NOTHING }
      }
      if (sp.options.add.length) {
        const r = await supabase.from('bundle_options').insert(sp.options.add.map(a => ({ ...a, slot_id: slotId }))).select('id')
        if (r.error) return { ok: false, error: r.error.message }
        if (!r.data?.length) return { ok: false, error: NOTHING }
      }
    }

    // The template row last for an existing template, so a refused slot change
    // does not leave the new name behind. A new one was written first.
    if (t.id) {
      const r = await supabase.from('bundle_templates').update(templateRow(t)).eq('id', id).select('id')
      if (r.error) return { ok: false, error: r.error.message }
      if (!r.data?.length) return { ok: false, error: NOTHING }
    }
    return { ok: true, value: id }
  } catch (err) {
    return { ok: false, error: errorText(err) }
  }
}

/** Publish, pause or return to draft. Whether it may go live is the database's
    question (its sentence comes back). */
export async function setTemplateStatus(id: string, status: BundleTemplate['status']): Promise<Result> {
  try {
    const { data, error } = await supabase.from('bundle_templates').update({ status }).eq('id', id).select('id')
    if (error) return { ok: false, error: error.message }
    if (!data?.length) return { ok: false, error: NOTHING }
    return { ok: true, value: undefined }
  } catch (err) {
    return { ok: false, error: errorText(err) }
  }
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
