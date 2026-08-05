/* Moving a listing through its life, and proposing changes to one that is
   already selling.

   Rules are in `listingLifecycle.ts` so they can be tested without a network.
   Every refusal here is also enforced by `guard_listing_state` — these calls
   are what makes the screen able to explain itself, not what makes it safe. */
import { supabase } from './supabase'
import {
  stateAfterApproval, nextVersion, todayIso, validateGoLiveFor, VERSIONED_FIELDS,
} from './listingLifecycle'
import type { Listing, ListingState, ProductVersion, Check } from './listingLifecycle'

const REFUSED = 'Nothing changed — you are not allowed to make that change.'

/**
 * Publish whatever is due.
 *
 * There is no scheduler, so the listing screens call this when they load. It is
 * idempotent and it only ever moves a row the seller and the desk already
 * agreed should go live, on the date they agreed — so calling it from more
 * places is harmless and calling it from none only makes a listing late.
 */
export async function publishDue(): Promise<number> {
  const { data } = await supabase.rpc('publish_due_listings')
  return Number(data ?? 0)
}

export async function loadVersions(productId: string): Promise<ProductVersion[]> {
  const { data } = await supabase.from('product_versions')
    .select('*').eq('product_id', productId).order('version', { ascending: false })
  return (data ?? []) as ProductVersion[]
}

/** Taking a listing off sale, with the reason the database insists on. */
export async function pauseListing(l: Listing, reason: string): Promise<Check> {
  return move(l, 'paused', { paused_on: todayIso(), paused_reason: reason.trim() })
}

/**
 * Putting it back.
 *
 * A listing with a go-live date still in the future goes back to waiting rather
 * than straight on sale — resuming is undoing the pause, not overriding the
 * schedule the seller set.
 */
export async function resumeListing(l: Listing): Promise<Check> {
  const to = stateAfterApproval(l.go_live_on ?? null)
  return move(l, to, { paused_on: null, paused_reason: null })
}

export async function retireListing(l: Listing, reason: string): Promise<Check> {
  return move(l, 'retired', { retired_on: todayIso(), retired_reason: reason.trim() })
}

/** Changing when it goes on sale. */
export async function setGoLive(l: Listing, date: string): Promise<Check> {
  const check = validateGoLiveFor(l, date)
  if (!check.ok) return check

  const goLive = date.trim() || null
  const state = stateAfterApproval(goLive)

  /* A listing still in review keeps its date and nothing else — it is not the
     schedule's job to approve it. A live one only ever moves back to live,
     because `validateGoLiveFor` has already refused a future date on it: taking
     something off sale is a pause with a reason, not a date. */
  const patch: Record<string, unknown> = { go_live_on: goLive }
  if (l.status === 'live' || l.status === 'scheduled') patch.status = state

  const { data, error } = await supabase.from('products')
    .update(patch).eq('id', l.id).select('id')
  if (error) return { ok: false, reason: friendly(error.message) }
  if (!data?.length) return { ok: false, reason: REFUSED }

  return {
    ok: true,
    note: goLive
      ? state === 'scheduled'
        ? `${l.name} is hidden until ${goLive}, then goes on sale on its own.`
        : `${l.name} goes on sale today.`
      : `${l.name} goes on sale as soon as it is approved.`,
  }
}

async function move(l: Listing, to: ListingState, patch: Record<string, unknown>): Promise<Check> {
  const { data, error } = await supabase.from('products')
    .update({ status: to, ...patch }).eq('id', l.id).select('id, status')
  if (error) return { ok: false, reason: friendly(error.message) }
  if (!data?.length) return { ok: false, reason: REFUSED }
  return { ok: true, note: noteFor(l, to) }
}

function noteFor(l: Listing, to: ListingState): string {
  switch (to) {
    case 'paused': return `${l.name} is off sale. Buyers no longer see it; nothing else about it changes.`
    case 'live': return `${l.name} is back on sale.`
    case 'scheduled': return `${l.name} is waiting for ${l.go_live_on}.`
    case 'retired': return `${l.name} has been withdrawn. Past orders keep their record of it.`
    default: return 'Saved.'
  }
}

/* ------------------------------------------------------------- proposals --- */

/**
 * Proposing a change to a listing that is already selling.
 *
 * `was` is stored alongside `proposed` so an approval three days later applies
 * to the listing the desk actually looked at. Without it, a change that crossed
 * with another one would be applied silently over the top of it.
 */
export async function proposeChange(
  { listing, partnerId, proposed, was, note, submittedBy, existing }: {
    listing: Listing
    partnerId: string
    proposed: Record<string, unknown>
    was: Record<string, unknown>
    note: string
    submittedBy: string
    existing: readonly ProductVersion[]
  },
): Promise<Check> {
  const version = nextVersion(existing)
  const { error } = await supabase.from('product_versions').insert({
    id: `PV-${listing.id}-${version}`,
    product_id: listing.id,
    partner_id: partnerId,
    version,
    state: 'pending',
    proposed,
    was,
    note: note.trim(),
    submitted_by: submittedBy,
  })
  if (error) return { ok: false, reason: friendly(error.message) }
  return {
    ok: true,
    note: `Version ${version} is with the catalogue desk. ${listing.name} keeps selling exactly as it is until they decide.`,
  }
}

/** Taking a proposal back. The listing was never touched, so nothing unwinds. */
export async function withdrawProposal(v: ProductVersion): Promise<Check> {
  const { data, error } = await supabase.from('product_versions')
    .update({ state: 'withdrawn' }).eq('id', v.id).eq('state', 'pending').select('id')
  if (error) return { ok: false, reason: friendly(error.message) }
  if (!data?.length) return { ok: false, reason: 'That change has already been decided.' }
  return { ok: true, note: 'Withdrawn. You can propose a different change now.' }
}

/**
 * The desk approving a proposal: the proposed fields become the listing.
 *
 * Only the fields the seller is allowed to version are copied, whatever else
 * the row happens to contain — an approval is not a licence to write arbitrary
 * columns, and `proposed` is a jsonb blob a seller wrote.
 */
export async function approveProposal(v: ProductVersion, who: string): Promise<Check> {
  const patch: Record<string, unknown> = {}
  for (const f of VERSIONED_FIELDS) {
    if (f.key in v.proposed) patch[f.key] = v.proposed[f.key]
  }
  if (!Object.keys(patch).length) {
    return { ok: false, reason: 'That proposal changes nothing this listing allows to be versioned.' }
  }

  const { error: pErr } = await supabase.from('products').update(patch).eq('id', v.product_id)
  if (pErr) return { ok: false, reason: friendly(pErr.message) }

  const { data, error } = await supabase.from('product_versions').update({
    state: 'published', decided_by: who, decided_at: new Date().toISOString(),
  }).eq('id', v.id).eq('state', 'pending').select('id')
  if (error) return { ok: false, reason: friendly(error.message) }
  if (!data?.length) return { ok: false, reason: 'That change had already been decided.' }

  /* Everything older that was still open is now beside the point. */
  await supabase.from('product_versions').update({ state: 'superseded' })
    .eq('product_id', v.product_id).lt('version', v.version).eq('state', 'pending')

  return { ok: true, note: `Version ${v.version} is live. Buyers see the new wording from now on.` }
}

export async function rejectProposal(v: ProductVersion, who: string, why: string): Promise<Check> {
  if (why.trim().length < 4) {
    return { ok: false, reason: 'Say what is wrong with it. The seller has only this to work from.' }
  }
  const { data, error } = await supabase.from('product_versions').update({
    state: 'rejected', decided_by: who, decided_at: new Date().toISOString(), decision_reason: why.trim(),
  }).eq('id', v.id).eq('state', 'pending').select('id')
  if (error) return { ok: false, reason: friendly(error.message) }
  if (!data?.length) return { ok: false, reason: 'That change had already been decided.' }
  return { ok: true, note: 'Refused, with your reason on the record. The listing is unchanged.' }
}

function friendly(message: string): string {
  const m = message.replace(/^.*?\bERROR:\s*/i, '').replace(/^P0001:\s*/, '').trim()
  if (/row-level security/i.test(m)) return REFUSED
  if (/product_versions_one_pending/i.test(m)) {
    return 'A change to this listing is already waiting on the desk. Withdraw it to propose a different one.'
  }
  if (/products_status_check/i.test(m)) return 'That is not a state a listing can be in.'
  if (/products_schedule_check/i.test(m)) return 'A scheduled listing needs a date, and a live one cannot be waiting for a future one.'
  return m
}
