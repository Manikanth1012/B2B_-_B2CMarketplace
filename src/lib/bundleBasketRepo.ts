// Configured bundles on the shopper's basket: reading them back with their
// names, putting one in whole, taking one out.
//
// The database holds every rule (guard_bundle_cart_line, the "whole" check at
// commit, bundle_cart_follow removing a bundle's other lines). This asks and
// hands back its sentence. Nothing here throws.

import { supabase } from './supabase'
import { loadSelections } from './bundleRepo'
import { BUNDLE_FALLBACK_NAME, type BundleInfo } from './bundleLines'

type Result<T = void> = { ok: true; value: T } | { ok: false; error: string }

/** A put that may have changed the basket even though it failed: `changed`
    says the rows are different now, so the screen must reload whatever the
    outcome — a stale list is one checkout could order from. */
export type PutResult = { ok: true } | { ok: false; error: string; changed: boolean }

/** Selections by id with their lines and template names. A template the
    caller can no longer see (paused, say) is named generically. */
export async function loadBundleInfo(ids: string[]): Promise<Result<Map<string, BundleInfo>>> {
  const got = await loadSelections(ids)
  if (!got.ok) return got
  const { selections, lines } = got.value
  const names = new Map<string, string>()
  const templateIds = [...new Set(selections.map(s => s.template_id))]
  if (templateIds.length) {
    try {
      const { data } = await supabase.from('bundle_templates').select('id,name').in('id', templateIds)
      for (const t of (data ?? []) as { id: string; name: string }[]) names.set(t.id, t.name)
    } catch { /* names are a courtesy; the prices are what matter */ }
  }
  const out = new Map<string, BundleInfo>()
  for (const s of selections) {
    out.set(s.id, {
      selection: s,
      lines: lines.filter(l => l.selection_id === s.id),
      name: names.get(s.template_id) ?? BUNDLE_FALLBACK_NAME,
    })
  }
  return { ok: true, value: out }
}

/**
 * A selection into the basket: every part in one insert, so the commit-time
 * check sees the bundle whole. With `replaceSelectionId`, the old bundle is
 * taken out after the new one is in — removing one of its lines removes the
 * rest — so a failed add never leaves the shopper with neither.
 */
export async function putBundleInCart(selectionId: string, replaceSelectionId?: string): Promise<PutResult> {
  const got = await loadSelections([selectionId])
  if (!got.ok) return { ok: false, error: got.error, changed: false }
  const lines = got.value.lines.filter(l => l.selection_id === selectionId)
  if (!got.value.selections.length || !lines.length) {
    return { ok: false, error: 'That bundle could not be read back, so nothing was added.', changed: false }
  }
  try {
    const ins = await supabase.from('cart_items')
      .insert(lines.map(l => ({ product_id: l.product_id, quantity: l.quantity, bundle_selection_id: selectionId })))
      .select('id')
    if (ins.error) {
      /* Refused whole: the commit-time check rolls the insert back, so the
         basket is as it was. */
      return {
        ok: false, changed: false,
        error: /duplicate key/i.test(ins.error.message) ? 'That bundle is already in your basket.' : friendly(ins.error.message),
      }
    }
    if ((ins.data?.length ?? 0) !== lines.length) {
      /* Written without a refusal, but fewer rows came back than were sent.
         The basket did change, so it is reloaded rather than described. */
      return {
        ok: false, changed: true,
        error: 'The bundle went into your basket, but not every part could be read back. Your basket has been reloaded; check it before you pay.',
      }
    }
    if (replaceSelectionId && replaceSelectionId !== selectionId) {
      const del = await removeCartBundle(replaceSelectionId)
      if (!del.ok) {
        return {
          ok: false, changed: true,
          error: `Both bundles are now in your basket: the new one went in, but the old one could not be taken out (${del.error}). Remove the old one before you check out.`,
        }
      }
    }
    return { ok: true }
  } catch (err) {
    /* The request may or may not have reached the database; reload to find out. */
    return { ok: false, changed: true, error: err instanceof Error ? err.message : String(err) }
  }
}

/** Every line of one bundle out of the basket. */
export async function removeCartBundle(selectionId: string): Promise<Result> {
  try {
    const { error } = await supabase.from('cart_items').delete().eq('bundle_selection_id', selectionId)
    if (error) return { ok: false, error: friendly(error.message) }
    return { ok: true, value: undefined }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

function friendly(message: string): string {
  const m = message.replace(/^.*?\bERROR:\s*/i, '').trim()
  if (/row-level security/i.test(m)) return 'That bundle cannot go in this basket.'
  return m
}
