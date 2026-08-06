/**
 * What a price means, and how far it may move.
 *
 * Two facts a single number cannot carry. The first is the basis: a consumer
 * listing quotes what the shopper pays, a business listing quotes what the
 * buyer reclaims tax against, and reading one as the other misstates every
 * figure on the page by the tax rate. The second is the band: the seller agreed
 * a floor below which they will not go, and the operator needs it to know how
 * much of somebody else's margin a bundle discount is spending.
 *
 * The band is the seller's, not the marketplace's. That is the whole point of
 * recording it — before this, composing a bundle meant guessing.
 */

import { round2 } from './money'

export interface Priced {
  price: number
  /* Whether `price` already carries tax. */
  price_includes_tax: boolean
  tax_rate: number
  /* The least the seller will accept, and the most it is ever sold for. */
  floor_price: number
  list_price: number
  cost?: number
}

export interface Bases {
  /* What the buyer hands over. */
  gross: number
  /* What the seller books. */
  net: number
  tax: number
  rate: number
  /* Which of the two the listing was quoted in, for labelling. */
  quotedIn: 'gross' | 'net'
}



/** Both sides of a price, derived from whichever one was quoted. Stored once,
    shown twice — the alternative is two columns that drift. */
export function bases(p: Pick<Priced, 'price' | 'price_includes_tax' | 'tax_rate'>): Bases {
  const rate = p.tax_rate / 100
  if (p.price_includes_tax) {
    const net = rate === 0 ? p.price : p.price / (1 + rate)
    return {
      gross: round2(p.price), net: round2(net), tax: round2(p.price - net),
      rate: p.tax_rate, quotedIn: 'gross',
    }
  }
  const tax = p.price * rate
  return {
    gross: round2(p.price + tax), net: round2(p.price), tax: round2(tax),
    rate: p.tax_rate, quotedIn: 'net',
  }
}

/** Convert a figure from one basis to the other. Used where a form lets
    somebody type either and shows the one they did not. */
export function toOtherBasis(amount: number, rate: number, from: 'gross' | 'net'): number {
  const r = rate / 100
  return round2(from === 'gross' ? amount / (1 + r) : amount * (1 + r))
}

/* --------------------------------------------------------------- band --- */

export interface Headroom {
  /* How far below the asking price this may be discounted. */
  amount: number
  pct: number
  /* And how far above, before it passes the RRP. */
  above: number
  none: boolean
}

export function headroom(p: Pick<Priced, 'price' | 'floor_price' | 'list_price'>): Headroom {
  const amount = round2(Math.max(0, p.price - p.floor_price))
  return {
    amount,
    pct: p.price === 0 ? 0 : Math.round((amount / p.price) * 1000) / 10,
    above: round2(Math.max(0, p.list_price - p.price)),
    none: amount <= 0,
  }
}

/**
 * Whether a price band holds together, or why it does not.
 *
 * Checked on the seller's own form as well as at the write, because a seller
 * who submits a listing that will be refused three days later for arithmetic
 * they could have been shown immediately has been wasted, not reviewed.
 */
export function validateBand(
  { price, floor, list, cost }: { price: number; floor: number; list: number; cost?: number },
): string | null {
  if (!(price > 0)) return 'Set a price.'
  if (!(floor >= 0)) return 'The minimum cannot be negative.'
  if (floor > price) {
    return `The minimum of $${floor.toFixed(2)} is above the asking price of $${price.toFixed(2)}. The minimum is the least you will accept, not a target.`
  }
  if (list < price) {
    return `The maximum of $${list.toFixed(2)} is below the asking price of $${price.toFixed(2)}. It is the most it is ever sold for, so it cannot be less than what you are asking.`
  }
  if (cost !== undefined && cost > 0 && floor < cost) {
    return `A minimum of $${floor.toFixed(2)} is below what it costs you to deliver ($${cost.toFixed(2)}). Every bundle discounted to that floor loses you money.`
  }
  return null
}

/** Advice the seller can act on without being stopped. */
export function bandWarnings(
  { price, floor, list, cost }: { price: number; floor: number; list: number; cost?: number },
): string[] {
  const out: string[] = []
  if (price > 0 && floor >= price) {
    out.push('No discount room at all. The marketplace cannot put this in a bundle, which is where most volume comes from.')
  } else if (price > 0) {
    const pct = Math.round(((price - floor) / price) * 100)
    if (pct > 45) {
      out.push(`You are offering up to ${pct}% off. That is a lot of room to hand the marketplace — check it is deliberate.`)
    }
  }
  if (cost !== undefined && cost > 0 && price > 0) {
    const margin = Math.round(((price - cost) / price) * 100)
    if (margin < 10) out.push(`Only ${margin}% margin at the asking price, before commission.`)
  }
  if (list > price * 2) {
    out.push('The maximum is more than double the asking price. A saving nobody believes is worse than no saving shown.')
  }
  return out
}

/* ------------------------------------------------------------ bundles --- */

export interface BundleComponent {
  productId: string
  name: string
  quantity: number
  price: number
  floor_price: number
}

export interface BundleRoom {
  /* What the parts cost separately at their asking prices. */
  partsTotal: number
  /* The least the sellers collectively agreed to. Below this the operator is
     spending margin that is not theirs. */
  floorTotal: number
  /* The deepest discount available, in money and as a percentage of the parts. */
  maxDiscount: number
  maxDiscountPct: number
  /* Which components are doing the constraining, worst first — the ones with
     the least room are why the bundle cannot go lower. */
  tightest: { productId: string; name: string; roomPct: number }[]
}

/**
 * How much a bundle may be discounted, given what each seller agreed to.
 *
 * This is the number the operator never had. A bundle price below `floorTotal`
 * is not aggressive pricing, it is the marketplace spending a seller's margin
 * without asking — and the seller finds out on their settlement.
 */
export function bundleRoom(components: readonly BundleComponent[]): BundleRoom {
  const partsTotal = round2(components.reduce((n, c) => n + c.price * c.quantity, 0))
  const floorTotal = round2(components.reduce((n, c) => n + c.floor_price * c.quantity, 0))
  const maxDiscount = round2(Math.max(0, partsTotal - floorTotal))
  return {
    partsTotal, floorTotal, maxDiscount,
    maxDiscountPct: partsTotal === 0 ? 0 : Math.round((maxDiscount / partsTotal) * 1000) / 10,
    tightest: components
      .map(c => ({
        productId: c.productId, name: c.name,
        roomPct: c.price === 0 ? 0 : Math.round(((c.price - c.floor_price) / c.price) * 1000) / 10,
      }))
      .sort((a, b) => a.roomPct - b.roomPct)
      .slice(0, 3),
  }
}

/** Whether a proposed bundle price is one the operator is entitled to set. */
export function checkBundleAgainstFloors(
  price: number,
  components: readonly BundleComponent[],
): { ok: true; room: BundleRoom } | { ok: false; reason: string; room: BundleRoom } {
  const room = bundleRoom(components)
  if (price >= room.partsTotal) {
    return {
      ok: false, room,
      reason: `At $${price.toFixed(2)} this costs the same or more than buying the parts separately ($${room.partsTotal.toFixed(2)}). That is not a bundle.`,
    }
  }
  if (price < room.floorTotal) {
    const short = round2(room.floorTotal - price)
    const tight = room.tightest[0]
    return {
      ok: false, room,
      reason: `$${price.toFixed(2)} is $${short.toFixed(2)} below what these sellers agreed to accept ($${room.floorTotal.toFixed(2)}). The deepest you can go is $${room.floorTotal.toFixed(2)}, a ${room.maxDiscountPct}% saving${tight ? ` — ${tight.name} has the least room at ${tight.roomPct}%` : ''}.`,
    }
  }
  return { ok: true, room }
}
