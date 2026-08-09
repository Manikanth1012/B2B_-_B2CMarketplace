/* What an order is actually doing, part by part.
 *
 * An order carried one `status`, one `tracking_ref`, one `carrier` and one
 * `stages` rail. Eleven of the ninety-four orders here span two sellers and
 * eleven mix a kind that ships with one that activates, so for those the header
 * was a claim about the whole order that was true of at most half of it — three
 * of them said `in transit` with nothing on them that ships.
 *
 * A part is the items that travel together: one seller, one fulfilment kind.
 * One seller despatches one parcel; an eSIM activates on its own schedule
 * whatever else is in the basket. A single-seller single-kind order has exactly
 * one part and reads exactly as it always did.
 *
 * `order_state_from_parts` in the database is the same reduction as
 * `orderStateFrom` here — the trigger has to derive the header inside the
 * transaction that moves a part, and a screen has to be able to say what an
 * order amounts to without asking. The integration suite reconciles them.
 *
 * Separate from `fulfilment.ts`, which is the same seller's rules stated over
 * the whole order. That module's `canAdvance` refuses a mixed basket outright —
 * "the marketplace moves it on when every seller has" — which was the only
 * honest answer available while an order had one status. With parts there is a
 * half to move, so the refusal becomes a narrower one: move your own.
 */

export type FulfilKind = 'shipped' | 'instant' | 'esim' | 'provisioned' | 'activation'

export type PartState =
  | 'placed' | 'packed' | 'in transit' | 'delivered'
  | 'activating' | 'active'
  | 'failed' | 'refunded'

export interface Part {
  id: string
  order_id: string
  seller: string
  partner_id: string | null
  kind: FulfilKind
  state: PartState
  carrier: string | null
  tracking_ref: string | null
  despatched_on: string | null
  delivered_on: string | null
  sort_order: number
}

/**
 * The journey each kind of part is on.
 *
 * Two of them, not five. A handset is packed and delivered; everything else is
 * provisioned and switched on, and the differences between an eSIM and a
 * managed firewall are in what the words mean rather than in the shape of the
 * journey. `stages` on the order held four rails for what are really two, and
 * printed one of them over both halves of a mixed basket.
 */
export const RAIL: Record<FulfilKind, PartState[]> = {
  shipped: ['placed', 'packed', 'in transit', 'delivered'],
  instant: ['placed', 'activating', 'active'],
  esim: ['placed', 'activating', 'active'],
  provisioned: ['placed', 'activating', 'active'],
  activation: ['placed', 'activating', 'active'],
}

/* Off the rail rather than at the end of it: a part does not progress into
   having failed, and a refund is something done to it afterwards. */
export const OFF_RAIL: PartState[] = ['failed', 'refunded']

/** What a part's state is called, in the words the kind uses. */
export const STATE_LABEL: Record<FulfilKind, Partial<Record<PartState, string>>> = {
  shipped: {
    placed: 'Ordered', packed: 'Packed', 'in transit': 'On its way', delivered: 'Delivered',
  },
  instant: { placed: 'Ordered', activating: 'Switching on', active: 'Ready to use' },
  esim: { placed: 'Ordered', activating: 'Activating', active: 'Active on your line' },
  provisioned: { placed: 'Ordered', activating: 'Provisioning', active: 'In service' },
  activation: { placed: 'Ordered', activating: 'Activating', active: 'In service' },
}

export function labelFor(part: Pick<Part, 'kind' | 'state'>): string {
  if (part.state === 'failed') return 'Could not be fulfilled'
  if (part.state === 'refunded') return 'Refunded'
  return STATE_LABEL[part.kind]?.[part.state] ?? part.state
}

/** How far along its own rail a part is, and how long that rail is. */
export function progressOf(part: Pick<Part, 'kind' | 'state'>): { at: number; of: number } {
  const rail = RAIL[part.kind] ?? RAIL.instant
  const at = rail.indexOf(part.state)
  return { at: at < 0 ? 0 : at, of: rail.length }
}

export function onRail(part: Pick<Part, 'kind' | 'state'>): boolean {
  return (RAIL[part.kind] ?? []).includes(part.state)
}

/**
 * What the whole order amounts to.
 *
 * The twin of `order_state_from_parts`. Read in the order a person would ask:
 * has any of it failed, is any of it still going, and only then what the whole
 * of it comes to.
 *
 * `partly-failed` exists because "failed" on an order where the handset arrived
 * and the insurance did not is a worse answer than either half of it.
 */
export type OrderState =
  | 'placed' | 'packed' | 'in transit' | 'processing'
  | 'delivered' | 'active' | 'failed' | 'partly-failed' | 'refunded'

export function orderStateFrom(parts: readonly Pick<Part, 'state'>[]): OrderState {
  if (parts.length === 0) return 'placed'
  const has = (s: PartState) => parts.some(p => p.state === s)
  const all = (f: (s: PartState) => boolean) => parts.every(p => f(p.state))

  if (all(s => s === 'refunded')) return 'refunded'
  if (all(s => s === 'failed')) return 'failed'
  if (has('failed')) return 'partly-failed'
  if (all(s => s === 'delivered' || s === 'active' || s === 'refunded')) {
    return has('delivered') ? 'delivered' : 'active'
  }
  if (has('in transit')) return 'in transit'
  if (has('packed')) return 'packed'
  if (has('activating')) return 'processing'
  return 'placed'
}

/**
 * The one sentence a buyer wants, on an order with more than one part.
 *
 * "Delivered" over an order whose second half has not activated yet is the
 * defect this whole change is about, so where the parts disagree the summary
 * says so rather than picking the most advanced or the least.
 */
export function summaryOf(parts: readonly Part[]): string {
  if (parts.length === 0) return 'Nothing on this order yet.'
  if (parts.length === 1) return labelFor(parts[0])

  const done = parts.filter(p => p.state === 'delivered' || p.state === 'active')
  const failed = parts.filter(p => p.state === 'failed')
  if (failed.length && failed.length < parts.length) {
    return `${done.length} of ${parts.length} parts complete · ${failed.length} could not be fulfilled`
  }
  if (done.length === parts.length) return `All ${parts.length} parts complete`
  const moving = parts.find(p => p.state !== 'delivered' && p.state !== 'active')
  return `${done.length} of ${parts.length} parts complete · ${moving ? labelFor(moving).toLowerCase() : 'in progress'}`
}

/* ------------------------------------------------------------- moving one -- */

/**
 * Where a part may go next, and nowhere else.
 *
 * Forward one step along its own rail. Not to any state on the rail: a seller
 * marking a part delivered that was never despatched is a record of a parcel
 * nobody carried, and the buyer's tracking page is built from the same rows.
 */
export function nextFor(part: Pick<Part, 'kind' | 'state'>): PartState | null {
  const rail = RAIL[part.kind] ?? []
  const at = rail.indexOf(part.state)
  if (at < 0 || at === rail.length - 1) return null
  return rail[at + 1]
}

/**
 * Whether this seller may move this part there.
 *
 * The database says the same thing twice over — a check constraint on which
 * states suit which kind, and an RLS policy that a seller may only update a
 * part whose `partner_id` is theirs. This is so the screen can grey out a
 * button and say why, rather than offering one and relaying a refusal.
 */
export function canMove(
  part: Pick<Part, 'kind' | 'state' | 'partner_id' | 'tracking_ref'>,
  to: PartState,
  as: { partner_id: string | null; operator?: boolean },
): { ok: true } | { ok: false; reason: string } {
  if (!as.operator && part.partner_id !== as.partner_id) {
    return {
      ok: false,
      reason: 'This part of the order is another seller\'s. You can move your own and no more — '
        + 'which is the point of the order having parts.',
    }
  }
  if (part.state === 'refunded') {
    return { ok: false, reason: 'This part was refunded. Its journey is over.' }
  }
  if (part.state === 'failed') {
    return { ok: false, reason: 'This part could not be fulfilled. Raise a new one rather than reviving it.' }
  }
  if (to !== nextFor(part)) {
    const next = nextFor(part)
    return {
      ok: false,
      reason: next
        ? `A part moves one step at a time. The next step for this one is “${STATE_LABEL[part.kind]?.[next] ?? next}”.`
        : 'This part is at the end of its journey.',
    }
  }
  /* A parcel in transit has to be a parcel somebody can find. */
  if (part.kind === 'shipped' && to === 'in transit' && !part.tracking_ref?.trim()) {
    return {
      ok: false,
      reason: 'Give it a carrier and a tracking number first. "On its way" with nothing to '
        + 'track is a status a buyer cannot do anything with.',
    }
  }
  return { ok: true }
}

/** The parts of one order, in a settled order. */
export function partsOf(parts: readonly Part[], orderId: string): Part[] {
  return parts
    .filter(p => p.order_id === orderId)
    .sort((a, b) => a.sort_order - b.sort_order || a.id.localeCompare(b.id))
}

/** The parts this seller owes, across every order. */
export function mine(parts: readonly Part[], partnerId: string | null): Part[] {
  return parts.filter(p => p.partner_id === partnerId)
}

/**
 * The parts a seller has something to do about, most overdue first.
 *
 * A part at the end of its rail needs nothing; one that failed needs a
 * conversation rather than a button.
 */
export function awaiting(parts: readonly Part[]): Part[] {
  return parts
    .filter(p => onRail(p) && nextFor(p) !== null)
    .sort((a, b) => progressOf(a).at - progressOf(b).at || a.id.localeCompare(b.id))
}
