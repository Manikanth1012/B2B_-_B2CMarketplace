/**
 * Composing a first-party listing out of the operator's federated rate card.
 *
 * The rules are the prototype's (_src/mp_shared.js, `nbMath`): a pack discount
 * of a few percent per extra component capped at a published maximum, an
 * optional per-component discount on top, and a hard floor at what the
 * components cost to deliver. Nothing here is typed by hand — the price is
 * derived, and an override has to beat the parts or it is not a pack.
 *
 * Kept separate from the repo module so the arithmetic can be tested without a
 * database, and separate from the component so the operator screen and any
 * future partner-facing composer read the same rule.
 */

export interface TelcoItem {
  id: string
  name: string
  family: string
  kind: 'Plan' | 'Service' | 'Add-on' | 'Hardware'
  /* Recurring and non-recurring are separate facts. An item may carry either or
     both — fibre is $26 a month and $35 to install. */
  rc: number
  nrc: number
  unit: string
  spec: string
  cost_rc: number
  cost_nrc: number
}

export interface BundleRule {
  per_component: number
  max_discount: number
  min_components: number
  max_components: number
}

export interface ComponentPick {
  telcoId: string
  quantity: number
  /* Per-component discount in percent, applied before the pack discount. */
  discount: number
  note?: string
}

export interface Line {
  item: TelcoItem
  quantity: number
  /* What was asked for, and what was allowed. They differ when a discount would
     have taken a component below its own cost. */
  discount: number
  requestedDiscount: number
  maxDiscount: number
  clipped: boolean
  rcList: number
  nrcList: number
  rcNet: number
  nrcNet: number
  cost: number
}

export type Model = 'monthly' | 'oneoff'

export interface Composition {
  lines: Line[]
  /* The rate card total — what the same components cost bought separately. */
  listTotal: number
  lineDiscountTotal: number
  /* The standing pack discount, as a percentage and as money. */
  packPct: number
  packDiscount: number
  /* What the rule arrives at, before any override. */
  derived: number
  /* What it will actually be sold for. */
  price: number
  /* Set when an override was raised to the cost floor rather than accepted. */
  floored: boolean
  requested: number
  cost: number
  margin: number
  marginPct: number
  model: Model
  fulfil: string
  saving: number
  savingPct: number
}

const money = (n: number) => Math.round(n * 100) / 100

/**
 * The deepest a single component may be discounted: down to its own cost, never
 * through it. Returned as a percentage so a control can be bounded by it rather
 * than validating after the fact.
 */
export function maxComponentDiscount(item: TelcoItem): number {
  const list = item.rc || item.nrc
  const cost = item.rc ? item.cost_rc : item.cost_nrc
  if (!list) return 0
  /* Rounded before it is floored. $63.20 against $79.00 is exactly 20%, but in
     binary it lands a hair under, and flooring that gives 19 — a cap one point
     tighter than the rate card actually allows, on every item whose margin is a
     round number. */
  const headroom = +((1 - cost / list) * 100).toFixed(6)
  return Math.max(0, Math.floor(headroom))
}

/**
 * Whether a set of picks bills monthly or once.
 *
 * A pack is one row in `products`, which carries one price and one billing
 * model. That makes a pack of a monthly plan and a one-off router unbillable
 * rather than merely awkward — see `compositionProblem`, which refuses it.
 */
export function packModel(picks: readonly ComponentPick[], items: readonly TelcoItem[]): Model {
  const chosen = picks.flatMap(p => items.filter(i => i.id === p.telcoId))
  return chosen.some(i => i.rc > 0) ? 'monthly' : 'oneoff'
}

/** How a pack gets to the buyer, inferred from what is in it. Equipment ships;
    a travel eSIM is a profile; connectivity is provisioned. */
export function guessFulfil(picks: readonly ComponentPick[], items: readonly TelcoItem[]): string {
  const families = picks.flatMap(p => items.filter(i => i.id === p.telcoId)).map(i => i.family)
  if (families.includes('Equipment')) return 'shipped'
  if (families.includes('eSIM')) return 'esim'
  if (families.includes('Fixed broadband') || families.includes('IoT connectivity')) return 'provisioned'
  return 'instant'
}

/**
 * The composition, priced.
 *
 * `override` is what the operator typed, or null to take the derived price. It
 * is clamped to the cost floor rather than merely flagged: a price below cost is
 * not a decision anybody should be able to make by mistyping a number.
 */
export function compose(
  picks: readonly ComponentPick[],
  items: readonly TelcoItem[],
  rule: BundleRule,
  override: number | null = null,
): Composition {
  const model = packModel(picks, items)

  const lines: Line[] = picks.flatMap(p => {
    const item = items.find(i => i.id === p.telcoId)
    if (!item) return []
    const maxDiscount = maxComponentDiscount(item)
    const requestedDiscount = Math.max(0, p.discount || 0)
    const discount = Math.min(requestedDiscount, maxDiscount)
    const rcList = money(item.rc * p.quantity)
    const nrcList = money(item.nrc * p.quantity)
    return [{
      item, quantity: p.quantity, discount, requestedDiscount, maxDiscount,
      clipped: requestedDiscount > maxDiscount,
      rcList, nrcList,
      rcNet: money(rcList * (1 - discount / 100)),
      nrcNet: money(nrcList * (1 - discount / 100)),
      /* Only the dimension being billed counts towards the floor. A monthly
         pack is not made cheaper to deliver by an install fee it does not
         charge. */
      cost: money((model === 'oneoff' ? item.cost_nrc : item.cost_rc) * p.quantity),
    }]
  })

  const listTotal = money(lines.reduce((n, l) => n + (model === 'oneoff' ? l.nrcList : l.rcList), 0))
  const afterLine = money(lines.reduce((n, l) => n + (model === 'oneoff' ? l.nrcNet : l.rcNet), 0))
  const lineDiscountTotal = money(listTotal - afterLine)
  const cost = money(lines.reduce((n, l) => n + l.cost, 0))

  /* The standing rule, on top of anything given per component. Two components
     discount by one step, not two — the first component is the product. */
  const packPct = lines.length >= rule.min_components
    ? Math.min(rule.max_discount, (lines.length - 1) * rule.per_component)
    : 0
  const packDiscount = money(afterLine * packPct / 100)
  const derived = money(afterLine - packDiscount)

  const requested = override ?? derived
  const floored = cost > 0 && requested < cost
  const price = floored ? cost : money(requested)

  return {
    lines, listTotal, lineDiscountTotal, packPct, packDiscount, derived,
    price, floored, requested: money(requested), cost,
    margin: money(price - cost),
    marginPct: price > 0 ? Math.round((price - cost) / price * 1000) / 10 : 0,
    model,
    fulfil: guessFulfil(picks, items),
    saving: money(listTotal - price),
    savingPct: listTotal > 0 ? Math.round((listTotal - price) / listTotal * 1000) / 10 : 0,
  }
}

/**
 * Why this composition cannot be published, or null when it can.
 *
 * One reason at a time and in the order the operator can act on them, because a
 * form that lists four problems at once gets read as one problem and three
 * pieces of noise.
 */
export function compositionProblem(
  name: string,
  picks: readonly ComponentPick[],
  items: readonly TelcoItem[],
  rule: BundleRule,
  composition: Composition,
): string | null {
  if (!name.trim()) return 'Give the pack a name buyers will recognise.'

  if (picks.length < rule.min_components) {
    return `A pack is ${rule.min_components} or more components sold together. With ${picks.length === 1 ? 'one' : 'none'} it is just the product.`
  }
  if (picks.length > rule.max_components) {
    return `A pack is capped at ${rule.max_components} components — past that a buyer cannot tell what they are buying.`
  }

  const chosen = picks.flatMap(p => items.filter(i => i.id === p.telcoId))
  /* The schema carries one price and one billing model per listing, so a pack
     that is $54 a month and $114 up front can only be half told on the product
     page and half charged at the checkout. Refused rather than half-built. */
  const recurring = chosen.filter(i => i.rc > 0)
  const oneOff = chosen.filter(i => i.nrc > 0)
  if (recurring.length > 0 && oneOff.length > 0) {
    const names = oneOff.map(i => i.name).join(', ')
    return `A pack bills either monthly or once, not both. ${names} ${oneOff.length === 1 ? 'carries' : 'carry'} a one-off charge alongside the recurring components, and the marketplace can only put one of those on the invoice. Compose them as separate listings.`
  }

  if (composition.price <= 0) return 'A pack needs a price.'
  if (composition.floored) {
    return `$${composition.requested.toFixed(2)} is below the $${composition.cost.toFixed(2)} these components cost to deliver. The floor is the cost of the parts.`
  }
  if (composition.price >= composition.listTotal) {
    return `At $${composition.price.toFixed(2)} this costs the same or more than buying the parts separately ($${composition.listTotal.toFixed(2)}). That is not a pack — it is a worse deal with a badge on it.`
  }
  return null
}

/**
 * Advice that does not block. Kept apart from `compositionProblem` on purpose:
 * a warning that stops the operator is a refusal wearing a friendlier word, and
 * a refusal they can dismiss is not a refusal.
 */
export function compositionWarnings(composition: Composition): string[] {
  const out: string[] = []

  const clipped = composition.lines.filter(l => l.clipped)
  if (clipped.length > 0) {
    out.push(`${clipped.map(l => l.item.name).join(', ')} cannot go below cost — ${clipped.length === 1 ? 'its discount was' : 'their discounts were'} capped at the deepest that keeps ${clipped.length === 1 ? 'it' : 'them'} above the floor.`)
  }
  if (composition.margin <= 0) {
    out.push('There is no margin left at this price. Every sale breaks even at best.')
  } else if (composition.marginPct < 15) {
    out.push(`Margin is ${composition.marginPct}%. That is thin for a pack the operator has to support as one thing.`)
  }
  if (composition.derived > 0 && composition.price < composition.derived * 0.6) {
    out.push('More than 40% below what the rule derives. Worth checking this is intentional and not a typo.')
  }
  return out
}

/** A one-line summary of where the price came from, for the audit record and
    the review note. The number on its own does not say what produced it. */
export function priceBasis(composition: Composition, rule: BundleRule): string {
  const parts = [`${composition.lines.length} components at $${composition.listTotal.toFixed(2)}`]
  if (composition.lineDiscountTotal > 0) {
    parts.push(`less $${composition.lineDiscountTotal.toFixed(2)} per-component`)
  }
  if (composition.packPct > 0) {
    parts.push(`less ${composition.packPct}% pack discount (${rule.per_component}% per extra component, capped at ${rule.max_discount}%)`)
  }
  const derivedNote = composition.price === composition.derived
    ? `= $${composition.price.toFixed(2)}`
    : `= $${composition.derived.toFixed(2)} derived, published at $${composition.price.toFixed(2)}`
  return `${parts.join(', ')} ${derivedNote}.`
}
