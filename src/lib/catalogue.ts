/* The catalogue's own rules, pure.
 *
 * Three things the screens kept deciding for themselves and disagreeing about:
 * whether a listing may be approved, what a bundle actually saves, and whether
 * a basket is allowed to contain what somebody has put in it.
 */

export interface ProductRow {
  id: string
  category_id: string
  sub_category: string
  name: string
  partner_id: string | null
  seller: string
  price: number
  was_price: number | null
  cost: number
  model: string
  fulfil: string
  rating: number
  reviews: number
  stock: string
  status: string
  listed: string | null
  description: string
  tags: string[]
  comm: number
  /* The price band and its tax basis — see the listing-price-bands migration.
     `floor_price` is what the seller agreed to accept, and it is the operator's
     only honest answer to "how much may I discount this in a bundle". */
  floor_price: number
  list_price: number
  price_includes_tax: boolean
  tax_rate: number
  badge: string | null
  specs: Record<string, string>
  sort_order: number
}

export interface Submission {
  id: string
  product_id: string
  partner_id: string | null
  status: 'pending' | 'approved' | 'rejected'
  risk: 'low' | 'medium' | 'high'
  check_note: string
  issue: string | null
  decision_reason: string | null
  submitted_by: string | null
  submitted_at: string | null
  reviewed_by: string | null
  reviewed_at: string | null
  version: number
  sort_order: number
}

export interface ProductRule {
  id: string
  product_id: string
  kind: 'requires' | 'excludes' | 'works_with'
  targets: string[]
  why: string
  sort_order: number
}

export interface Component {
  bundle_id: string
  component_id: string
  quantity: number
  note: string | null
  sort_order: number
}

export interface Media {
  id: string
  product_id: string
  url: string
  role: 'hero' | 'gallery'
  alt: string | null
  sort_order: number
}

/* ------------------------------------------------------------- review ---- */

export type ApproveVerdict =
  | { ok: true }
  | { ok: false; reason: string }

/**
 * Whether a submission can be approved.
 *
 * A high risk is a stated policy breach, and approving one exposes the
 * marketplace rather than only the seller — so there is no override parameter
 * here, the same discipline the technical onboarding gate follows. A medium
 * risk is a question, not a breach: it can be approved by somebody who has
 * satisfied themselves, and the screen makes them say what satisfied them.
 */
export function canApprove(s: Submission): ApproveVerdict {
  if (s.status !== 'pending') {
    return { ok: false, reason: `This submission was already ${s.status}. A change to a live listing is a new submission, not a second decision on this one.` }
  }
  if (s.risk === 'high') {
    return {
      ok: false,
      reason: `This is a stated policy breach, not a query: ${s.issue ?? s.check_note}. Approving it exposes the marketplace, not only the seller. Reject it, or raise a query and let the seller correct the listing.`,
    }
  }
  return { ok: true }
}

/** Rejection always needs a ground the seller can act on. A refusal they cannot
    act on comes straight back as a support ticket. */
export function canReject(s: Submission, reason: string): ApproveVerdict {
  if (s.status !== 'pending') {
    return { ok: false, reason: `This submission was already ${s.status}.` }
  }
  if (reason.trim().length < 15) {
    return { ok: false, reason: 'Name the rule, name what is missing, and say what would clear it. A rejection the seller cannot act on comes straight back as a ticket.' }
  }
  return { ok: true }
}

export interface QueueSummary {
  waiting: number
  flagged: number
  blocked: number
  live: number
  suspended: number
  rejected: number
  /* Median age in days of what is waiting. Null when nothing is. */
  medianAgeDays: number | null
  /* Share of decided submissions that were approved. Null before anything has
     been decided — 0% and "nothing decided yet" are different answers. */
  approvalRate: number | null
}

const DAY = 24 * 60 * 60 * 1000

export function summarise(
  submissions: readonly Submission[],
  products: readonly ProductRow[],
  today: Date,
): QueueSummary {
  const waiting = submissions.filter(s => s.status === 'pending')
  const decided = submissions.filter(s => s.status !== 'pending')

  const ages = waiting
    .filter(s => s.submitted_at)
    .map(s => Math.max(0, Math.round((today.getTime() - Date.parse(s.submitted_at!)) / DAY)))
    .sort((a, b) => a - b)

  return {
    waiting: waiting.length,
    flagged: waiting.filter(s => s.risk !== 'low').length,
    blocked: waiting.filter(s => s.risk === 'high').length,
    live: products.filter(p => p.status === 'live').length,
    suspended: products.filter(p => p.status === 'suspended').length,
    rejected: submissions.filter(s => s.status === 'rejected').length,
    medianAgeDays: ages.length === 0 ? null : ages[Math.floor(ages.length / 2)],
    approvalRate: decided.length === 0
      ? null
      : Math.round((decided.filter(s => s.status === 'approved').length / decided.length) * 100),
  }
}

/* ------------------------------------------------------------ bundles ---- */

export interface BundleView {
  bundle: ProductRow
  parts: { component: ProductRow; quantity: number; note: string | null; lineTotal: number }[]
  partsTotal: number
  saving: number
  savingPct: number
  /* A component that is not on sale cannot be delivered, so neither can the
     bundle. Named rather than counted — the operator has to know which one. */
  unavailable: ProductRow[]
}

/** What a bundle contains and what it saves, computed from the parts rather
    than from a percentage somebody typed. */
export function bundleView(
  bundle: ProductRow,
  components: readonly Component[],
  products: readonly ProductRow[],
): BundleView | null {
  const mine = components
    .filter(c => c.bundle_id === bundle.id)
    .sort((a, b) => a.sort_order - b.sort_order)
  if (mine.length === 0) return null

  const parts = mine.flatMap(c => {
    const component = products.find(p => p.id === c.component_id)
    if (!component) return []
    return [{
      component, quantity: c.quantity, note: c.note,
      lineTotal: +(component.price * c.quantity).toFixed(2),
    }]
  })

  const partsTotal = +parts.reduce((n, p) => n + p.lineTotal, 0).toFixed(2)
  const saving = +(partsTotal - bundle.price).toFixed(2)

  return {
    bundle, parts, partsTotal, saving,
    savingPct: partsTotal === 0 ? 0 : Math.round((saving / partsTotal) * 100),
    unavailable: parts.filter(p => p.component.status !== 'live').map(p => p.component),
  }
}

/** Whether a proposed bundle is worth selling. Checked before it is created,
    because a bundle priced above its parts is not a bundle. */
export function checkBundlePrice(price: number, partsTotal: number): ApproveVerdict {
  if (partsTotal <= 0) return { ok: false, reason: 'A bundle needs at least one component with a price.' }
  if (price <= 0) return { ok: false, reason: 'A bundle needs a price.' }
  if (price >= partsTotal) {
    return {
      ok: false,
      reason: `At $${price.toFixed(2)} this costs the same or more than buying the parts separately ($${partsTotal.toFixed(2)}). That is not a bundle — it is a worse deal with a badge on it.`,
    }
  }
  return { ok: true }
}

/* ----------------------------------------------------- basket eligibility */

export type BasketVerdict =
  | { ok: true; suggestions: { product: string; why: string }[] }
  | { ok: false; kind: 'requires' | 'excludes'; reason: string; blocking: string[] }

/**
 * Whether a product can be added to what somebody already holds.
 *
 * `held` is everything they have — subscriptions, delivered orders and what is
 * already in the basket — because a rule that only looks at the basket lets a
 * shopper buy a second StreamNova tier as long as they do it on separate days.
 *
 * A suggestion never blocks. That distinction is the whole point of having
 * three kinds of rule, and collapsing it would turn advice into a refusal.
 */
export function canAddToBasket(
  productId: string,
  held: readonly string[],
  rules: readonly ProductRule[],
  nameOf: (id: string) => string,
): BasketVerdict {
  const mine = rules.filter(r => r.product_id === productId)
  const holding = new Set(held)

  for (const r of mine.filter(r => r.kind === 'excludes')) {
    const clash = r.targets.filter(t => holding.has(t))
    if (clash.length > 0) {
      return {
        ok: false, kind: 'excludes', blocking: clash,
        reason: `You already have ${clash.map(nameOf).join(' and ')}. ${r.why}`,
      }
    }
  }

  for (const r of mine.filter(r => r.kind === 'requires')) {
    if (!r.targets.some(t => holding.has(t))) {
      return {
        ok: false, kind: 'requires', blocking: r.targets,
        reason: `${r.why} Add ${r.targets.map(nameOf).join(' or ')} first.`,
      }
    }
  }

  /* Rules the other way round matter too: something already held may exclude
     what is being added, and the buyer needs telling which. */
  for (const r of rules.filter(r => r.kind === 'excludes' && holding.has(r.product_id))) {
    if (r.targets.includes(productId)) {
      return {
        ok: false, kind: 'excludes', blocking: [r.product_id],
        reason: `You already have ${nameOf(r.product_id)}. ${r.why}`,
      }
    }
  }

  return {
    ok: true,
    suggestions: mine
      .filter(r => r.kind === 'works_with')
      .flatMap(r => r.targets.filter(t => !holding.has(t)).map(t => ({ product: t, why: r.why }))),
  }
}

/** Every rule a product carries, for the operator's own screen. Grouped so the
    blocking ones read together and the advice reads as advice. */
export function rulesFor(productId: string, rules: readonly ProductRule[]): {
  requires: ProductRule[]; excludes: ProductRule[]; worksWith: ProductRule[]; blocking: number
} {
  const mine = rules.filter(r => r.product_id === productId).sort((a, b) => a.sort_order - b.sort_order)
  const requires = mine.filter(r => r.kind === 'requires')
  const excludes = mine.filter(r => r.kind === 'excludes')
  return {
    requires, excludes,
    worksWith: mine.filter(r => r.kind === 'works_with'),
    blocking: requires.length + excludes.length,
  }
}

/* ------------------------------------------------------ listing policy --- */

export interface CategoryPolicy {
  category_id: string
  review: string
  auto_publish: boolean
  returns_window: string
  sla_hours: number
  price_floor: boolean
  rating_required: boolean
  min_rating: number
  max_listings_per_seller: number
}

export interface PolicyRuleRow {
  id: string
  name: string
  descr: string
  check_by: 'auto' | 'doc' | 'manual' | 'extern'
  basis: string
  owner: string
  evidence: string | null
  blocks: boolean
  status: string
  locked: string | null
  sort_order: number
}

export interface AppliedRule {
  rule: PolicyRuleRow
  level: 'warn' | 'enforce'
  /* What the platform can decide by itself, for the rules it checks itself.
     Null where a person or a document decides — asserting a pass on those would
     be the screen doing the reviewer's job and getting it wrong. */
  automatic: { pass: boolean; detail: string } | null
}

/**
 * The category's rules, applied to one listing, with the automated ones
 * actually evaluated. This is what turns a policy page into a review: the rules
 * the platform can check are checked here, and the rest are named for the
 * person who has to check them.
 */
export function applyPolicy(
  product: ProductRow,
  policy: CategoryPolicy | null,
  rules: readonly PolicyRuleRow[],
  matrix: readonly { category_id: string; rule_id: string; level: string }[],
  media: readonly Media[],
): AppliedRule[] {
  const applied = matrix.filter(m => m.category_id === product.category_id && m.level !== 'off')

  return applied.flatMap(m => {
    const rule = rules.find(r => r.id === m.rule_id)
    if (!rule) return []

    let automatic: AppliedRule['automatic'] = null
    if (rule.check_by === 'auto') {
      switch (rule.id) {
        case 'PR-03': {
          /* The floor is the cost. Selling below it loses money on every unit,
             which is the one thing a price check can settle on its own. */
          const pass = !policy?.price_floor || product.cost <= 0 || product.price > product.cost
          automatic = {
            pass,
            detail: product.cost <= 0
              ? 'No cost is recorded, so there is no floor to check against.'
              : pass
              ? `Sells at $${product.price.toFixed(2)} against a floor of $${product.cost.toFixed(2)}.`
              : `Sells at $${product.price.toFixed(2)}, which is $${(product.cost - product.price).toFixed(2)} below the floor of $${product.cost.toFixed(2)}.`,
          }
          break
        }
        case 'PR-07': {
          const pass = product.fulfil !== null && product.fulfil !== ''
          automatic = {
            pass,
            detail: pass
              ? `Fulfilment is ${product.fulfil}; the category's window is ${policy?.sla_hours ?? '—'} hours.`
              : 'No fulfilment method is declared, so no window can be held.',
          }
          break
        }
        case 'PR-08': {
          /* Only a physical item carries a returns window. Anything else is not
             exempt by luck — the rule does not apply to it. */
          const physical = product.fulfil === 'shipped'
          automatic = {
            pass: !physical || (policy?.returns_window ?? '') !== '',
            detail: physical
              ? `Physical item; the category window is ${policy?.returns_window ?? 'not set'}.`
              : 'Not a physical item, so no statutory returns window applies.',
          }
          break
        }
      }
    }

    /* The accessibility finding the queue is meant to raise. Media is a fact
       the platform can read, whatever the rule's declared check method. */
    if (rule.id === 'PR-11' || rule.name.toLowerCase().includes('accessib')) {
      const mine = media.filter(x => x.product_id === product.id)
      const missing = mine.filter(x => !x.alt).length
      automatic = {
        pass: missing === 0,
        detail: missing === 0
          ? `All ${mine.length} images carry alt text.`
          : `${missing} of ${mine.length} images have no alt text.`,
      }
    }

    return [{ rule, level: m.level as 'warn' | 'enforce', automatic }]
  }).sort((a, b) => a.rule.sort_order - b.rule.sort_order)
}

/** Automated rules this listing fails at enforce level. What the review has to
    resolve before anything can be published. */
export function policyFailures(applied: readonly AppliedRule[]): AppliedRule[] {
  return applied.filter(a => a.level === 'enforce' && a.automatic && !a.automatic.pass)
}

/* --------------------------------------------------------- commission ---- */

/** What the marketplace takes and what the seller keeps on one sale. First
    party has no partner, so there is nobody to pay a commission to. */
export function splitOf(product: ProductRow, rate: number | null): {
  gross: number; commission: number; fees: number; net: number; firstParty: boolean
} {
  const firstParty = product.partner_id === null
  const commission = firstParty ? 0 : +(product.price * (rate ?? product.comm) / 100).toFixed(2)
  const fees = firstParty ? 0 : +(product.price * 0.019 + 0.20).toFixed(2)
  return {
    gross: product.price,
    commission,
    fees,
    net: +(product.price - commission - fees).toFixed(2),
    firstParty,
  }
}
