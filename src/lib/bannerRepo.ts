/* The one module that talks to Supabase about banners and the slots they run
   in. The rules live in banners.ts; this is the read path they sit on and the
   write path that applies them. */

import { supabase } from './supabase'
import { validateBanner, occupancy } from './banners'
import type { BannerRow, BannerSlot, BannerDraft, ArtworkVerdict } from './banners'

export interface BannerSnapshot {
  banners: BannerRow[]
  slots: BannerSlot[]
  /* Products a banner can point at, for the destination picker. Only what is on
     sale — a call to action landing on a withdrawn listing is a dead end the
     operator built on purpose without meaning to. */
  products: { id: string; name: string; category_id: string }[]
  loadError?: string
}

export async function loadBanners(): Promise<BannerSnapshot> {
  const [bRes, sRes, pRes] = await Promise.all([
    supabase.from('operator_banners').select('*').order('sort_order'),
    supabase.from('banner_slots').select('*').order('sort_order'),
    supabase.from('products').select('id,name,category_id').eq('status', 'live').order('name'),
  ])

  const errors: string[] = []
  const note = (label: string, e: { message: string } | null) => { if (e) errors.push(`${label}: ${e.message}`) }
  note('banners', bRes.error); note('slots', sRes.error); note('products', pRes.error)

  return {
    banners: (bRes.data ?? []) as BannerRow[],
    slots: (sRes.data ?? []) as BannerSlot[],
    products: (pRes.data ?? []) as { id: string; name: string; category_id: string }[],
    ...(errors.length > 0 ? { loadError: `Could not load the banner console (${errors.join('; ')}).` } : {}),
  }
}

export type Result = { ok: true; note?: string } | { ok: false; reason: string }

const today = () => new Date().toISOString().slice(0, 10)

/* Re-reads before deciding, the same discipline the catalogue and partner write
   paths follow: the screen can be stale, and slot capacity in particular is a
   shared resource somebody else may have taken while this form was open. */
async function fresh(): Promise<{ banners: BannerRow[]; slots: BannerSlot[] } | null> {
  const [b, s] = await Promise.all([
    supabase.from('operator_banners').select('*'),
    supabase.from('banner_slots').select('*').order('sort_order'),
  ])
  if (b.error || s.error) return null
  return { banners: (b.data ?? []) as BannerRow[], slots: (s.data ?? []) as BannerSlot[] }
}

export async function saveBanner(
  { draft, artwork, actor, editingId }: {
    draft: BannerDraft; artwork: ArtworkVerdict | null; actor: string; editingId?: string
  },
): Promise<Result & { id?: string }> {
  const now = await fresh()
  if (!now) return { ok: false, reason: 'Could not re-read the banners to check the slot. Try again.' }

  const slot = now.slots.find(s => s.id === draft.slot)
  const problem = validateBanner(draft, slot, artwork, now.slots, now.banners, today(), editingId)
  if (problem) return { ok: false, reason: problem }

  const row = {
    slot: draft.slot, name: draft.name.trim(), title: draft.title.trim(),
    subtitle: draft.subtitle.trim() || null, cta: draft.cta.trim(),
    audience: draft.audience, region: draft.region, device: draft.device,
    weight: draft.weight, status: draft.status,
    starts_at: draft.starts_at, ends_at: draft.ends_at,
    destination: draft.destination, destination_ref: draft.destination_ref,
    accent: draft.accent, image_url: draft.image_url, alt: draft.alt.trim() || null,
  }

  if (editingId) {
    const { data, error } = await supabase.from('operator_banners')
      .update(row).eq('id', editingId).select('id')
    if (error) return { ok: false, reason: `That did not save: ${error.message}` }
    if (!data || data.length === 0) {
      return { ok: false, reason: 'Nothing was updated — it may have been deleted while you were editing. Refresh and look again.' }
    }
    await writeAudit(actor, 'banner.updated', editingId, null, draft.status,
      `${draft.name} on ${slot!.label}`)
    return { ok: true, id: editingId }
  }

  const id = `bn-${Date.now().toString(36).slice(-6)}`
  const maxSort = now.banners.reduce((n, b) => Math.max(n, b.sort_order), 0)
  const { error } = await supabase.from('operator_banners')
    .insert({ id, ...row, impressions: 0, clicks: 0, orders: 0, revenue: 0, sort_order: maxSort + 1 })
  if (error) return { ok: false, reason: `The banner was not created: ${error.message}` }

  await writeAudit(actor, 'banner.created', id, null, draft.status,
    `${draft.name} on ${slot!.label}`)
  return {
    ok: true, id,
    note: draft.status === 'draft'
      ? `${draft.name} saved as a draft. Nothing is on the site until you set it live.`
      : `${draft.name} is ${draft.status} on ${slot!.label}.`,
  }
}

/**
 * Move a banner between states.
 *
 * Separate from saving because it is the action somebody takes in a hurry — a
 * campaign is misbehaving and it has to come down now, without reopening a form
 * and re-satisfying every rule that applies to editing it.
 */
export async function setBannerStatus(
  { id, status, actor }: { id: string; status: BannerRow['status']; actor: string },
): Promise<Result> {
  const now = await fresh()
  if (!now) return { ok: false, reason: 'Could not re-read the banners. Try again.' }

  const banner = now.banners.find(b => b.id === id)
  if (!banner) return { ok: false, reason: 'That banner no longer exists.' }
  if (banner.status === status) return { ok: false, reason: `It is already ${status}.` }

  const slot = now.slots.find(s => s.id === banner.slot)
  /* Pausing is always allowed — taking something down must never be blocked by
     the rules that govern putting something up. Going the other way has to
     clear the slot. */
  if (status === 'live' || status === 'scheduled') {
    if (!slot) return { ok: false, reason: 'Its slot no longer exists.' }
    if (!banner.image_url) {
      return { ok: false, reason: `${banner.name ?? banner.title} has no artwork. ${slot.label} needs an image at ${slot.width}×${slot.height} before it can run.` }
    }
    const occ = occupancy(slot, now.banners.filter(b => b.id !== id))
    if (occ.remaining === 0) {
      return { ok: false, reason: `${slot.label} already carries ${occ.running} of ${occ.max}. Pause one before putting this up.` }
    }
  }

  const { data, error } = await supabase.from('operator_banners')
    .update({ status }).eq('id', id).select('id')
  if (error) return { ok: false, reason: `That did not save: ${error.message}` }
  if (!data || data.length === 0) return { ok: false, reason: 'Nothing was updated. Refresh and look again.' }

  await writeAudit(actor, `banner.${status}`, id, banner.status, status,
    banner.name ?? banner.title)
  return { ok: true, note: `${banner.name ?? banner.title} is ${status}.` }
}

export async function deleteBanner(
  { id, actor }: { id: string; actor: string },
): Promise<Result> {
  const now = await fresh()
  const banner = now?.banners.find(b => b.id === id)
  if (!banner) return { ok: false, reason: 'That banner no longer exists.' }

  /* What a banner earned is the only evidence of whether its slot is worth
     anything. Deleting one that ran throws that away, and there is a state for
     "stop showing this" that does not. */
  if (banner.impressions > 0) {
    return {
      ok: false,
      reason: `${banner.name ?? banner.title} has been seen ${banner.impressions.toLocaleString()} times. Deleting it throws away the only record of how the slot performed — end it or pause it instead.`,
    }
  }

  const { error } = await supabase.from('operator_banners').delete().eq('id', id)
  if (error) return { ok: false, reason: `That did not delete: ${error.message}` }

  await writeAudit(actor, 'banner.deleted', id, banner.status, 'deleted', banner.name ?? banner.title)
  return { ok: true, note: `${banner.name ?? banner.title} deleted. It had never run.` }
}

async function writeAudit(
  actor: string, action: string, object: string,
  before: string | null, after: string, detail: string,
): Promise<void> {
  await supabase.from('operator_audit_log').insert({
    id: `AUD-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    actor, role: 'Marketplace operations', action, object,
    category: 'Merchandising', severity: 'info', outcome: 'success',
    before_val: before, after_val: `${after} — ${detail}`,
  })
}
