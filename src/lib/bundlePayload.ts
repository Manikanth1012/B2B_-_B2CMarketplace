// The pure edges of bundleRepo: what goes to the database and what comes back
// from it. Kept apart because bundleRepo imports supabase, which cannot load
// in a Node unit test.

import type { BundleTemplate, BundleSlot, BundleOption, Choices } from './bundles'

export interface Selection { id: string; template_id: string; currency: string; quantity: number; total: number; parts_total: number; priced_at: string; valid_until: string; choices: Choices }
export interface SelectionLine { id: string; selection_id: string; product_id: string; name: string; partner_id: string | null; seller: string; quantity: number; list_unit_price: number; unit_price: number; floor_unit_price: number | null; sort_order: number }

const num = (v: unknown): number => Number(v)
const numOrNull = (v: unknown): number | null => (v === null || v === undefined || v === '' ? null : Number(v))
const strOrNull = (v: unknown): string | null => (v === null || v === undefined ? null : String(v))

/* ------------------------------------------------------------ rows → domain -- */

export function asTemplate(r: Record<string, unknown>): BundleTemplate {
  return {
    id: String(r.id), name: String(r.name),
    description: strOrNull(r.description), image: strOrNull(r.image),
    status: r.status as BundleTemplate['status'],
    audiences: ((r.audiences ?? []) as BundleTemplate['audiences']),
    discount_pct: num(r.discount_pct),
  }
}

export function asSlot(r: Record<string, unknown>): BundleSlot {
  return {
    id: String(r.id), template_id: String(r.template_id), label: String(r.label),
    min_pick: num(r.min_pick), max_pick: num(r.max_pick),
    qty_min: num(r.qty_min), qty_max: num(r.qty_max), qty_default: num(r.qty_default),
    sort_order: num(r.sort_order ?? 0),
  }
}

export function asOption(r: Record<string, unknown>): BundleOption {
  return {
    id: String(r.id), slot_id: String(r.slot_id), product_id: String(r.product_id),
    is_default: r.is_default === true, sort_order: num(r.sort_order ?? 0),
  }
}

/** `choices` is jsonb; tolerate a stringified one and drop anything malformed. */
export function asChoices(v: unknown): Choices {
  let raw = v
  if (typeof raw === 'string') { try { raw = JSON.parse(raw) } catch { return {} } }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const out: Choices = {}
  for (const [slot, picks] of Object.entries(raw as Record<string, unknown>)) {
    if (!Array.isArray(picks)) continue
    out[slot] = picks
      .filter((p): p is Record<string, unknown> => !!p && typeof p === 'object')
      .map(p => ({ product_id: String(p.product_id), quantity: num(p.quantity) }))
  }
  return out
}

export function asSelection(r: Record<string, unknown>): Selection {
  return {
    id: String(r.id), template_id: String(r.template_id), currency: String(r.currency),
    quantity: num(r.quantity), total: num(r.total), parts_total: num(r.parts_total),
    priced_at: String(r.priced_at), valid_until: String(r.valid_until),
    choices: asChoices(r.choices),
  }
}

export function asSelectionLine(r: Record<string, unknown>): SelectionLine {
  return {
    id: String(r.id ?? ''), selection_id: String(r.selection_id ?? ''),
    product_id: String(r.product_id), name: String(r.name),
    partner_id: strOrNull(r.partner_id), seller: String(r.seller ?? ''),
    quantity: num(r.quantity), list_unit_price: num(r.list_unit_price),
    unit_price: num(r.unit_price), floor_unit_price: numOrNull(r.floor_unit_price),
    sort_order: num(r.sort_order ?? 0),
  }
}

/** What `price_bundle` returns. Its lines are not stored yet, so they carry no
    id and no selection. Null when the answer is not the shape promised. */
export function asPriced(data: unknown): { lines: SelectionLine[]; total: number; parts_total: number; saving: number } | null {
  if (!data || typeof data !== 'object') return null
  const d = data as Record<string, unknown>
  if (!Array.isArray(d.lines)) return null
  return {
    lines: (d.lines as Record<string, unknown>[]).map(asSelectionLine),
    total: num(d.total), parts_total: num(d.parts_total), saving: num(d.saving),
  }
}

/* ------------------------------------------------------------ domain → RPC -- */

/** The arguments `price_bundle` and `configure_bundle` take. */
export function priceArgs(templateId: string, choices: Choices, currency: string, quantity: number):
  { p_template: string; p_choices: Choices; p_currency: string; p_quantity: number } {
  const p_choices: Choices = {}
  for (const [slot, picks] of Object.entries(choices)) {
    p_choices[slot] = picks.map(p => ({ product_id: p.product_id, quantity: Number(p.quantity) }))
  }
  return { p_template: templateId, p_choices, p_currency: currency, p_quantity: Number(quantity) }
}

/* ------------------------------------------------------------ saving a template -- */

export type SlotInput = Omit<BundleSlot, 'id' | 'template_id'> & {
  id?: string
  options: { product_id: string; is_default: boolean }[]
}

type SlotFields = Omit<BundleSlot, 'id' | 'template_id'>

export interface OptionPlan {
  remove: string[]                                                    // option ids
  add: { product_id: string; is_default: boolean; sort_order: number }[]
  change: { id: string; is_default: boolean; sort_order: number }[]
}
export interface SlotPlan {
  /** Existing slot id, or null for a slot to be created. */
  id: string | null
  fields: SlotFields
  /** True when a row must be written (new, or any field differs). */
  write: boolean
  options: OptionPlan
}
export interface TemplatePlan { removeSlots: string[]; slots: SlotPlan[] }

export const slotFields = (s: SlotFields): SlotFields => ({
  label: s.label.trim(), min_pick: s.min_pick, max_pick: s.max_pick,
  qty_min: s.qty_min, qty_max: s.qty_max, qty_default: s.qty_default, sort_order: s.sort_order,
})

/**
 * The smallest set of writes that turns what is stored into what was asked
 * for. A live template is frozen by the database, so a save that changes no
 * slot and no option must write none — otherwise renaming a live template
 * would be refused for rewriting slots it never changed. Order of the input is
 * the order shown: sort_order is always the 1-based place in the list (the
 * convention the seed and the migration use), whatever the caller set.
 */
export function planTemplateSave(
  existingSlots: readonly BundleSlot[],
  existingOptions: readonly BundleOption[],
  wanted: readonly SlotInput[],
): TemplatePlan {
  const have = new Map(existingSlots.map(s => [s.id, s]))
  const keep = new Set(wanted.map(w => w.id).filter((id): id is string => !!id && have.has(id)))
  const removeSlots = existingSlots.filter(s => !keep.has(s.id)).map(s => s.id)

  const slots: SlotPlan[] = wanted.map((w, wi) => {
    const fields = slotFields({ ...w, sort_order: wi + 1 })
    const cur = w.id ? have.get(w.id) : undefined
    const id = cur ? cur.id : null
    const curFields = cur ? slotFields(cur) : null
    const write = !curFields || (Object.keys(fields) as (keyof SlotFields)[]).some(k => fields[k] !== curFields[k])

    const curOpts = id ? existingOptions.filter(o => o.slot_id === id) : []
    const byProduct = new Map(curOpts.map(o => [o.product_id, o]))
    const wantedProducts = new Set(w.options.map(o => o.product_id))
    const options: OptionPlan = {
      remove: curOpts.filter(o => !wantedProducts.has(o.product_id)).map(o => o.id),
      add: [], change: [],
    }
    w.options.forEach((o, i) => {
      const prev = byProduct.get(o.product_id)
      if (!prev) options.add.push({ product_id: o.product_id, is_default: o.is_default, sort_order: i + 1 })
      else if (prev.is_default !== o.is_default || prev.sort_order !== i + 1) {
        options.change.push({ id: prev.id, is_default: o.is_default, sort_order: i + 1 })
      }
    })
    return { id, fields, write, options }
  })
  return { removeSlots, slots }
}

/** The template row as written: no id (the database names it), blank text as null. */
export function templateRow(t: Omit<BundleTemplate, 'id'>): Record<string, unknown> {
  return {
    name: t.name.trim(),
    description: t.description?.trim() ? t.description.trim() : null,
    image: t.image?.trim() ? t.image.trim() : null,
    status: t.status,
    audiences: t.audiences,
    discount_pct: Number(t.discount_pct),
  }
}
