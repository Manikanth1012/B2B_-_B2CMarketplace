/* What is wrong with a template draft, said before anything is saved. Pure.
   Mirrors the table checks and the publish rules the operator can see; the
   database still has the last word and its sentence is shown if it differs. */

export interface ProblemSlot {
  key: string
  label: string
  min_pick: number
  max_pick: number
  qty_min: number
  qty_max: number
  qty_default: number
  options: { product_id: string; is_default: boolean }[]
}
export interface ProblemDraft { name: string; discount_pct: number; audiences: string[]; slots: ProblemSlot[] }

export interface DraftProblems {
  /** Field id (`name`, `discount`, `audiences`) to sentence. */
  bundle: Record<string, string>
  /** Slot key to field to sentence. Fields: label, min_pick, max_pick, qty_min, qty_max, qty_default, options. */
  slots: Record<string, Record<string, string>>
}

export function draftProblems(d: ProblemDraft, maxDiscount: number): DraftProblems {
  const bundle: Record<string, string> = {}
  const slots: Record<string, Record<string, string>> = {}
  if (d.name.trim() === '') bundle.name = 'Give the bundle a name'
  if (!(d.discount_pct > 0)) bundle.discount = 'The discount must be above 0%'
  else if (d.discount_pct > maxDiscount) bundle.discount = `The published rule allows at most ${maxDiscount}%`
  if (d.audiences.length === 0) bundle.audiences = 'Choose who this is sold to'

  const seen = new Map<string, number>()
  d.slots.forEach(s => s.options.forEach(o => seen.set(o.product_id, (seen.get(o.product_id) ?? 0) + 1)))

  for (const s of d.slots) {
    const p: Record<string, string> = {}
    const whole = (n: number) => Number.isInteger(n)
    if (s.label.trim() === '') p.label = 'Name this part'
    if (!whole(s.min_pick) || s.min_pick < 0) p.min_pick = 'Use a whole number, 0 or more'
    if (!whole(s.max_pick) || s.max_pick < 1) p.max_pick = 'Use a whole number, at least 1'
    else if (!p.min_pick && s.min_pick > s.max_pick) p.min_pick = 'Cannot be more than the most a buyer may pick'
    if (!whole(s.qty_min) || s.qty_min < 1) p.qty_min = 'Use a whole number, at least 1'
    if (!whole(s.qty_max) || s.qty_max < 1) p.qty_max = 'Use a whole number, at least 1'
    else if (!p.qty_min && s.qty_min > s.qty_max) p.qty_min = 'Cannot be more than the most of each'
    if (!whole(s.qty_default) || s.qty_default < 1) p.qty_default = 'Use a whole number, at least 1'
    else if (!p.qty_min && s.qty_default < s.qty_min) p.qty_default = `Cannot be below the fewest (${s.qty_min})`
    else if (!p.qty_max && s.qty_default > s.qty_max) p.qty_default = `Cannot be above the most (${s.qty_max})`

    if (s.options.length === 0) p.options = 'Offer at least one product'
    else {
      const dupes = s.options.filter(o => (seen.get(o.product_id) ?? 0) > 1)
      const defaults = s.options.filter(o => o.is_default).length
      if (dupes.length) p.options = 'A product can be offered in one part only'
      else if (s.options.length < Math.max(s.min_pick, 1)) p.options = `Offer at least ${Math.max(s.min_pick, 1)} products to pick from`
      else if (s.min_pick >= 1 && !p.min_pick && !p.max_pick && (defaults < s.min_pick || defaults > s.max_pick)) {
        p.options = s.min_pick === s.max_pick && s.min_pick === 1
          ? 'Mark exactly one starting choice'
          : `Mark between ${s.min_pick} and ${s.max_pick} starting choices`
      }
    }
    if (Object.keys(p).length) slots[s.key] = p
  }
  return { bundle, slots }
}

export const hasProblems = (p: DraftProblems): boolean =>
  Object.keys(p.bundle).length > 0 || Object.keys(p.slots).length > 0
