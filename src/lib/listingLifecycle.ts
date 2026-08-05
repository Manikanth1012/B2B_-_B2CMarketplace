/**
 * The life of a listing after it is published, as rules rather than as buttons.
 *
 * My Listings displayed a state and offered no way to change it: a seller could
 * submit a listing and then never touch it again — not take it off sale while a
 * component was out of stock, not withdraw one they no longer make, not correct
 * a description, not say when a new one should appear.
 *
 * Everything here is duplicated by `guard_listing_state` in the database, on
 * purpose. The screen needs to know which buttons to offer and why one is
 * missing; the database needs to be right whatever the screen does. Where they
 * disagree the database wins, and the wording of the refusals is kept close so
 * a reader is not told two different stories.
 */
export type { Check } from './enterprise'
import type { Check } from './enterprise'

export type ListingState =
  | 'draft' | 'pending' | 'rejected' | 'scheduled' | 'live' | 'paused' | 'suspended' | 'retired'

export interface Listing {
  id: string
  name: string
  status: string
  go_live_on?: string | null
  paused_on?: string | null
  paused_reason?: string | null
  retired_on?: string | null
}

/* What each state means to the person reading it, in terms of whether anybody
   can buy the thing. "Pending" and "Paused" both mean not on sale, and they mean
   it for completely different reasons. */
export const STATE_MEANING: Record<ListingState, { label: string; says: string; selling: boolean }> = {
  draft:     { label: 'Draft',      says: 'Not submitted. Nobody but you can see it.', selling: false },
  pending:   { label: 'In review',  says: 'With the catalogue desk. Not visible to buyers.', selling: false },
  rejected:  { label: 'Not approved', says: 'The desk refused it. Fix what they asked for and submit it again.', selling: false },
  scheduled: { label: 'Scheduled',  says: 'Approved and waiting for its go-live date.', selling: false },
  live:      { label: 'Live',       says: 'On sale and visible to buyers.', selling: true },
  paused:    { label: 'Paused',     says: 'You took it off sale. Nothing is lost — put it back whenever you like.', selling: false },
  suspended: { label: 'Suspended',  says: 'The marketplace took it down. Only they can put it back.', selling: false },
  retired:   { label: 'Retired',    says: 'Withdrawn for good. Past orders keep their record.', selling: false },
}

export function stateOf(l: Listing): ListingState {
  const s = l.status.toLowerCase()
  return (s in STATE_MEANING ? s : 'draft') as ListingState
}

export function isSelling(l: Listing): boolean {
  return STATE_MEANING[stateOf(l)].selling
}

/* Who may move it where. `suspended` appears as a destination for nobody: the
   marketplace sets it directly, and a seller who could reach it could also
   leave it. */
const SELLER_MOVES: Record<ListingState, ListingState[]> = {
  draft:     ['pending', 'retired'],
  pending:   ['retired'],
  rejected:  ['pending', 'retired'],
  scheduled: ['live', 'paused', 'retired'],
  live:      ['paused', 'retired'],
  paused:    ['live', 'scheduled', 'retired'],
  suspended: [],
  retired:   [],
}

export function sellerMayMoveTo(l: Listing): ListingState[] {
  return SELLER_MOVES[stateOf(l)]
}

/**
 * Whether a seller may make this move, and what to say when they may not.
 *
 * The refusals name the way forward rather than the rule that was broken. "A
 * listing that is suspended cannot be moved to live" is true and useless; the
 * seller needs to know who can lift it.
 */
export function canMove(l: Listing, to: ListingState): Check {
  const from = stateOf(l)
  if (from === to) return { ok: false, reason: `${l.name} is already ${STATE_MEANING[to].label.toLowerCase()}.` }

  if (from === 'suspended') {
    return {
      ok: false,
      reason: `${l.name} was suspended by the marketplace, so it is not yours to put back. Raise it in Disputes & Support and the desk will tell you what they need.`,
    }
  }
  if (from === 'retired') {
    return { ok: false, reason: `${l.name} has been retired. Withdrawing is final — list it again as a new listing.` }
  }
  if (to === 'suspended') {
    return { ok: false, reason: 'Only the marketplace suspends a listing.' }
  }
  if (!SELLER_MOVES[from].includes(to)) {
    return { ok: false, reason: `A listing that is ${STATE_MEANING[from].label.toLowerCase()} cannot be made ${STATE_MEANING[to].label.toLowerCase()}.` }
  }
  return { ok: true, note: STATE_MEANING[to].says }
}

/** Pausing needs a reason, because the desk and your colleagues read it. */
export function validatePause(reason: string): Check {
  if (reason.trim().length < 4) {
    return { ok: false, reason: 'Say why it is coming off sale. Somebody picking this up next week has only what you write here.' }
  }
  return { ok: true, note: 'It stops being visible immediately. Nothing else about it changes.' }
}

/**
 * Withdrawing for good.
 *
 * Deliberately harder than pausing, and says what it costs. A seller reaching
 * for "retire" when they meant "pause" loses the listing and has to be
 * re-approved from scratch.
 */
export function validateRetire(reason: string, confirmName: string, l: Listing): Check {
  if (reason.trim().length < 4) {
    return { ok: false, reason: 'Say why it is being withdrawn. It goes on the listing’s record permanently.' }
  }
  if (confirmName.trim().toLowerCase() !== l.name.trim().toLowerCase()) {
    return { ok: false, reason: `Type the listing’s name to confirm. This cannot be undone — if you only want it off sale for a while, pause it instead.` }
  }
  return { ok: true, note: 'Buyers stop seeing it. Past orders and settlements keep their record of it.' }
}

/* ------------------------------------------------------------ scheduling --- */

/** Today, as the date the rest of this reasons about. Injected so the tests do
    not depend on when they run. */
export function todayIso(now = new Date()): string {
  return now.toISOString().slice(0, 10)
}

/* A date far enough out that it is somebody's mistake rather than their plan. */
export const MAX_SCHEDULE_DAYS = 365

/**
 * When a listing should go on sale.
 *
 * Empty means as soon as it is approved, which is what everybody means by
 * default. A past date is refused rather than silently treated as "now": it is
 * almost always a typo in the year, and honouring it would publish something
 * the seller thought they had a week to finish.
 */
export function validateGoLive(date: string, today = todayIso()): Check {
  if (!date.trim()) return { ok: true, note: 'It goes on sale as soon as the catalogue desk approves it.' }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { ok: false, reason: 'Give the date as YYYY-MM-DD.' }
  const when = new Date(`${date}T00:00:00Z`)
  if (Number.isNaN(when.getTime())) return { ok: false, reason: `${date} is not a date.` }

  if (date < today) {
    return { ok: false, reason: `${date} has passed. Leave it empty to go on sale as soon as it is approved.` }
  }
  if (date === today) {
    return { ok: true, note: 'It goes on sale today, once the catalogue desk has approved it.' }
  }

  const days = Math.round((when.getTime() - new Date(`${today}T00:00:00Z`).getTime()) / 86_400_000)
  if (days > MAX_SCHEDULE_DAYS) {
    return { ok: false, reason: `That is ${days} days away. A listing cannot be scheduled more than a year ahead.` }
  }
  return { ok: true, note: `It stays hidden until ${date}, then goes on sale on its own.` }
}

/**
 * The same date, against the listing it is being set on.
 *
 * A listing that is already selling cannot be given a future date. That move is
 * `live → scheduled`, which is a listing going dark, and the one way a seller
 * takes something off sale is by pausing it and saying why — `paused_reason`
 * exists so that whoever picks this up next week knows what happened. Allowing
 * it here would be a second way out of `live` with nothing written down.
 *
 * From `paused` it is fine: the listing is already off sale and the reason is
 * already on it, so a date only says when it comes back.
 */
export function validateGoLiveFor(l: Listing, date: string, today = todayIso()): Check {
  const base = validateGoLive(date, today)
  if (!base.ok) return base

  if (stateOf(l) === 'live' && date.trim() && date > today) {
    return {
      ok: false,
      reason: `${l.name} is on sale now, so a future date would take it down without saying why. Pause it with a reason first, then set the date — it comes back on ${date} on its own.`,
    }
  }
  return base
}

/** Where an approved listing lands: straight on sale, or waiting for its day. */
export function stateAfterApproval(goLiveOn: string | null, today = todayIso()): 'live' | 'scheduled' {
  return goLiveOn && goLiveOn > today ? 'scheduled' : 'live'
}

/** How long until it appears, for a screen to say something better than a date. */
export function untilLive(goLiveOn: string | null, today = todayIso()): string | null {
  if (!goLiveOn || goLiveOn <= today) return null
  const days = Math.round(
    (new Date(`${goLiveOn}T00:00:00Z`).getTime() - new Date(`${today}T00:00:00Z`).getTime()) / 86_400_000,
  )
  if (days === 1) return 'Goes live tomorrow'
  return `Goes live in ${days} days`
}

/* -------------------------------------------------------------- versions --- */

/* The fields a seller may propose changing on a listing that is already
   selling. Price is not among them: a price is changed through the price book,
   per market and per currency, and putting it here as well would be two ways to
   do one thing that could disagree. */
export const VERSIONED_FIELDS = [
  { key: 'name', label: 'Name' },
  { key: 'description', label: 'Description' },
  { key: 'sub_category', label: 'Sub-category' },
  { key: 'fulfil', label: 'How it is fulfilled' },
  { key: 'stock', label: 'Availability' },
  { key: 'tags', label: 'Tags' },
] as const

export type VersionedField = typeof VERSIONED_FIELDS[number]['key']

export interface ProductVersion {
  id: string
  product_id: string
  version: number
  state: 'pending' | 'published' | 'rejected' | 'withdrawn' | 'superseded'
  proposed: Record<string, unknown>
  was: Record<string, unknown>
  note: string | null
  submitted_by: string | null
  submitted_at: string
  decided_by: string | null
  decided_at: string | null
  decision_reason: string | null
}

export interface Change {
  key: VersionedField
  label: string
  from: string
  to: string
}

const show = (v: unknown): string => {
  if (v === null || v === undefined || v === '') return '—'
  if (Array.isArray(v)) return v.length ? v.join(', ') : '—'
  return String(v)
}

/**
 * What actually differs between the listing and a proposal.
 *
 * Only the fields that changed. A review screen showing every field with most
 * of them identical is one where the reviewer skims and misses the one that
 * matters, which is the entire job.
 */
export function changesIn(proposed: Record<string, unknown>, was: Record<string, unknown>): Change[] {
  const out: Change[] = []
  for (const f of VERSIONED_FIELDS) {
    if (!(f.key in proposed)) continue
    const before = show(was[f.key])
    const after = show(proposed[f.key])
    if (before === after) continue
    out.push({ key: f.key, label: f.label, from: before, to: after })
  }
  return out
}

/** A proposal has to propose something. */
export function validateProposal(changes: readonly Change[], note: string): Check {
  if (changes.length === 0) {
    return { ok: false, reason: 'Nothing is different yet. Change something before sending it for review.' }
  }
  if (note.trim().length < 4) {
    return {
      ok: false,
      reason: 'Say what changed and why. The desk decides from this, and a proposal with no reason waits longer than one with a sentence.',
    }
  }
  return {
    ok: true,
    note: `${changes.length} change${changes.length === 1 ? '' : 's'} go to the catalogue desk. The listing keeps selling exactly as it is until they approve.`,
  }
}

/** The version number a new proposal takes. */
export function nextVersion(existing: readonly ProductVersion[]): number {
  return existing.reduce((n, v) => Math.max(n, v.version), 0) + 1
}

/** The proposal waiting on the desk, if there is one. */
export function pendingVersion(versions: readonly ProductVersion[]): ProductVersion | null {
  return versions.find(v => v.state === 'pending') ?? null
}

/**
 * Whether a seller may propose a change at all.
 *
 * One at a time. Two pending versions of one listing is a queue whose order
 * decides the outcome, and nobody reading the review screen would know that.
 */
export function canPropose(l: Listing, versions: readonly ProductVersion[]): Check {
  const state = stateOf(l)
  if (state === 'retired') return { ok: false, reason: `${l.name} has been retired.` }
  if (state === 'suspended') {
    return { ok: false, reason: `${l.name} is suspended. Clear that with the desk first — a change to a suspended listing has nothing to publish to.` }
  }
  if (state === 'pending') {
    return { ok: false, reason: `${l.name} is already with the desk. Withdraw that submission if you want to change it.` }
  }
  const open = pendingVersion(versions)
  if (open) {
    return {
      ok: false,
      reason: `A change to ${l.name} is already waiting on the desk. Withdraw it to propose a different one.`,
    }
  }
  return { ok: true }
}
