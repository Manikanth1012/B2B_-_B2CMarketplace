/* Reading and changing what each shelf demands.
 *
 * Ordinary table writes rather than functions: a policy row is one row, a
 * matrix cell is one row, and neither has anything that has to move with it.
 * The guard that refuses a listing breaching the policy lives in the database,
 * so a change made here takes effect on the next write from anywhere.
 */

import { supabase } from './supabase'
import type { CategoryPolicy, PolicyRuleRow } from './catalogue'
import type { CategoryRow, ListingRow, SellerRow, MatrixRow, RuleLevel, RuleForm } from './shelfPolicy'

const num = <T,>(row: T, keys: string[]): T => {
  const out = { ...row } as Record<string, unknown>
  for (const k of keys) if (out[k] != null) out[k] = Number(out[k])
  return out as T
}

export interface ShelfBook {
  categories: CategoryRow[]
  policies: CategoryPolicy[]
  rules: PolicyRuleRow[]
  matrix: MatrixRow[]
  listings: ListingRow[]
  sellers: SellerRow[]
  loadError?: string
}

export async function loadShelfBook(): Promise<ShelfBook> {
  const [c, p, r, m, l, s] = await Promise.all([
    supabase.from('categories').select('id,name,audience,blurb,open_to_buyers,sort_order').order('sort_order'),
    supabase.from('category_policy').select('*'),
    supabase.from('policy_rules').select('*').order('sort_order'),
    supabase.from('category_policy_rules').select('*'),
    supabase.from('products').select('id,category_id,partner_id,status,price,cost'),
    supabase.from('partners').select('id,name,status,rating'),
  ])

  const errors: string[] = []
  if (c.error) errors.push(`the categories: ${c.error.message}`)
  if (p.error) errors.push(`the policies: ${p.error.message}`)
  if (r.error) errors.push(`the rules: ${r.error.message}`)
  if (m.error) errors.push(`the matrix: ${m.error.message}`)

  return {
    categories: ((c.data ?? []) as CategoryRow[]).map(x => num(x, ['sort_order'])),
    policies: ((p.data ?? []) as CategoryPolicy[]).map(x =>
      num(x, ['sla_hours', 'min_rating', 'max_listings_per_seller'])),
    rules: ((r.data ?? []) as PolicyRuleRow[]).map(x => num(x, ['sort_order'])),
    matrix: (m.data ?? []) as MatrixRow[],
    listings: ((l.data ?? []) as ListingRow[]).map(x => num(x, ['price', 'cost'])),
    sellers: ((s.data ?? []) as SellerRow[]).map(x => num(x, ['rating'])),
    ...(errors.length ? { loadError: `Some of the shelf policy did not load (${errors.join('; ')}).` } : {}),
  }
}

/** Change what a shelf demands. Stamped, because a policy with no author is one nobody owns. */
export async function savePolicy(
  categoryId: string, patch: Partial<CategoryPolicy>, actor: string,
): Promise<{ ok: boolean; why?: string }> {
  const { error } = await supabase.from('category_policy')
    .update({ ...patch, updated_on: new Date().toISOString().slice(0, 10), updated_by: actor })
    .eq('category_id', categoryId)
  return error ? { ok: false, why: error.message } : { ok: true }
}

/**
 * Set how hard a rule bites on one shelf.
 *
 * `off` deletes the row rather than storing the word: an absent row and a row
 * saying "off" are the same fact, and keeping both invites a screen to show
 * one and a query to count the other.
 */
export async function setLevel(
  categoryId: string, ruleId: string, level: RuleLevel,
): Promise<{ ok: boolean; why?: string }> {
  if (level === 'off') {
    const { error } = await supabase.from('category_policy_rules')
      .delete().eq('category_id', categoryId).eq('rule_id', ruleId)
    return error ? { ok: false, why: error.message } : { ok: true }
  }
  const { error } = await supabase.from('category_policy_rules')
    .upsert({ category_id: categoryId, rule_id: ruleId, level })
  return error ? { ok: false, why: error.message } : { ok: true }
}

/* ------------------------------------------------------------ the rule book -- */

type Done = { ok: boolean; why?: string }

/** A new rule, written as a draft: it applies nowhere until a shelf takes it on and it is activated. */
export async function createRule(id: string, form: RuleForm, sortOrder: number): Promise<Done> {
  const { error } = await supabase.from('policy_rules').insert({
    id, name: form.name.trim(), descr: form.descr.trim(), check_by: form.check_by, basis: form.basis,
    owner: form.owner.trim(), evidence: form.evidence.trim() || null, blocks: form.blocks, appeal: form.appeal,
    status: 'draft', locked: null, note: null, added: new Date().toISOString().slice(0, 10), sort_order: sortOrder,
  })
  return error ? { ok: false, why: error.message } : { ok: true }
}

/** A rule's wording and settings. Its id, status and lock are not changed here. */
export async function updateRule(id: string, form: RuleForm): Promise<Done> {
  const { error } = await supabase.from('policy_rules').update({
    name: form.name.trim(), descr: form.descr.trim(), check_by: form.check_by, basis: form.basis,
    owner: form.owner.trim(), evidence: form.evidence.trim() || null, blocks: form.blocks, appeal: form.appeal,
  }).eq('id', id)
  return error ? { ok: false, why: error.message } : { ok: true }
}

/** Publish a draft, or bring a retired rule back (as a draft is, on no shelf until one takes it). */
export async function setRuleStatus(id: string, status: 'active' | 'draft'): Promise<Done> {
  const { error } = await supabase.from('policy_rules').update({ status }).eq('id', id)
  return error ? { ok: false, why: error.message } : { ok: true }
}

/** Retire a rule: off every shelf first, so nothing is judged against it any more, then marked retired. */
export async function retireRule(id: string): Promise<Done> {
  const off = await supabase.from('category_policy_rules').delete().eq('rule_id', id)
  if (off.error) return { ok: false, why: off.error.message }
  const { error } = await supabase.from('policy_rules').update({ status: 'retired' }).eq('id', id)
  return error ? { ok: false, why: error.message } : { ok: true }
}

/** Delete a rule nothing refers to. The database refuses one a shelf or a seller's evidence still names. */
export async function deleteRule(id: string): Promise<Done> {
  const { error } = await supabase.from('policy_rules').delete().eq('id', id)
  if (!error) return { ok: true }
  if (error.code === '23503' || /foreign key/i.test(error.message)) {
    return { ok: false, why: 'Seller evidence or a shelf still refers to this rule, so it cannot be deleted. Retire it instead.' }
  }
  return { ok: false, why: error.message }
}

/** Open or close a shelf to buyers. The reason is not optional when closing. */
export async function setOpen(
  categoryId: string, open: boolean, reason: string | null, actor: string,
): Promise<{ ok: boolean; why?: string }> {
  if (!open && !(reason ?? '').trim()) {
    return {
      ok: false,
      why: 'Say why the shelf is closing. Somebody will reopen it and needs to know what they are undoing.',
    }
  }
  return savePolicy(categoryId, { open_to_buyers: open, closed_reason: open ? null : reason }, actor)
}
