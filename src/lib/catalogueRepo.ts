/* The one module that talks to Supabase about the catalogue. The rules live in
   catalogue.ts; this is the read path they sit on and the write path that
   applies them. */

import { supabase } from './supabase'
import { canApprove, canReject, checkBundlePrice, bundleView } from './catalogue'
import type {
  ProductRow, Submission, ProductRule, Component, Media, CategoryPolicy, PolicyRuleRow,
} from './catalogue'
import type { CommissionPlan } from './partnerCommerce'
import type { Category } from '../types'
import { compose, compositionProblem, priceBasis } from './federation'
import type { TelcoItem, BundleRule, ComponentPick } from './federation'

/** One line of what a first-party listing was composed from. The name and the
    rates are as they stood when it was composed — see the migration. */
export interface PackComponent {
  product_id: string
  telco_id: string
  quantity: number
  discount: number
  rc_at: number
  nrc_at: number
  name_at: string
  note: string | null
  sort_order: number
}

export interface ListingQuery {
  id: string
  product_id: string
  partner_id: string | null
  subject: string
  body: string
  asked_by: string
  asked_on: string
  due_on: string
  status: 'open' | 'answered' | 'overdue' | 'closed'
  answer: string | null
  answered_on: string | null
}

export interface CatalogueSnapshot {
  products: ProductRow[]
  submissions: Submission[]
  rules: ProductRule[]
  components: Component[]
  media: Media[]
  categories: Category[]
  policies: CategoryPolicy[]
  policyRules: PolicyRuleRow[]
  matrix: { category_id: string; rule_id: string; level: string }[]
  plans: CommissionPlan[]
  partners: { id: string; name: string; status: string; plan_id: string | null }[]
  queries: ListingQuery[]
  /* The federated BSS rate card and the policy for composing from it. Empty for
     anyone but the operator — the rate card carries delivery costs, and RLS
     returns no rows rather than an error to a persona that may not read it. */
  telco: TelcoItem[]
  bundleRule: BundleRule
  packComponents: PackComponent[]
  loadError?: string
}

/* The published composition policy, used when the rate card could not be read —
   which is every persona but the operator. Matches the seeded row; the operator
   screen always has the real one, so this is a floor, not a second source of
   truth. */
const FALLBACK_RULE: BundleRule = {
  per_component: 4, max_discount: 18, min_components: 2, max_components: 6,
}

/* One round trip per table. The alternative — a query per product to find its
   rules, its components and its images — is a hundred requests to draw one
   screen. */
export async function loadCatalogue(): Promise<CatalogueSnapshot> {
  const [
    prodRes, subRes, ruleRes, compRes, mediaRes,
    catRes, polRes, prRes, matrixRes, planRes, partnerRes, queryRes,
    telcoRes, bundleRuleRes, packCompRes,
  ] = await Promise.all([
    supabase.from('products').select('*').order('sort_order'),
    supabase.from('operator_listings').select('*').order('sort_order'),
    supabase.from('product_rules').select('*').order('sort_order'),
    supabase.from('product_components').select('*').order('sort_order'),
    supabase.from('product_media').select('*').order('sort_order'),
    supabase.from('categories').select('*').order('sort_order'),
    supabase.from('category_policy').select('*'),
    supabase.from('policy_rules').select('*').order('sort_order'),
    supabase.from('category_policy_rules').select('*'),
    supabase.from('commission_plans').select('*').order('sort_order'),
    supabase.from('partners').select('id,name,status,plan_id').order('id'),
    supabase.from('listing_queries').select('*').order('asked_on', { ascending: false }),
    supabase.from('telco_catalogue').select('*').order('sort_order'),
    supabase.from('bundle_rules').select('*').eq('id', 'standard').maybeSingle(),
    supabase.from('product_telco_components').select('*').order('sort_order'),
  ])

  const errors: string[] = []
  const note = (label: string, e: { message: string } | null) => { if (e) errors.push(`${label}: ${e.message}`) }
  note('products', prodRes.error); note('submissions', subRes.error); note('rules', ruleRes.error)
  note('components', compRes.error); note('media', mediaRes.error); note('categories', catRes.error)
  note('category policy', polRes.error); note('policy rules', prRes.error); note('policy matrix', matrixRes.error)
  note('plans', planRes.error); note('partners', partnerRes.error); note('queries', queryRes.error)
  /* The rate card is deliberately unreadable to anyone but the operator, and RLS
     expresses that as an empty result rather than an error. Only a real failure
     is worth reporting, so these are noted the same way as the rest. */
  note('rate card', telcoRes.error); note('composition rule', bundleRuleRes.error)
  note('pack components', packCompRes.error)

  return {
    products: (prodRes.data ?? []) as ProductRow[],
    submissions: (subRes.data ?? []) as Submission[],
    rules: (ruleRes.data ?? []) as ProductRule[],
    components: (compRes.data ?? []) as Component[],
    media: (mediaRes.data ?? []) as Media[],
    categories: (catRes.data ?? []) as Category[],
    policies: (polRes.data ?? []) as CategoryPolicy[],
    policyRules: (prRes.data ?? []) as PolicyRuleRow[],
    matrix: (matrixRes.data ?? []) as { category_id: string; rule_id: string; level: string }[],
    plans: (planRes.data ?? []) as CommissionPlan[],
    partners: (partnerRes.data ?? []) as { id: string; name: string; status: string; plan_id: string | null }[],
    queries: (queryRes.data ?? []) as ListingQuery[],
    telco: (telcoRes.data ?? []) as TelcoItem[],
    bundleRule: (bundleRuleRes.data as BundleRule | null) ?? FALLBACK_RULE,
    packComponents: (packCompRes.data ?? []) as PackComponent[],
    ...(errors.length > 0 ? { loadError: `Could not load the full catalogue (${errors.join('; ')}).` } : {}),
  }
}

export type Result = { ok: true; note?: string } | { ok: false; reason: string }

/* A decision moves two records — the review and the product — and a screen that
   moved one would leave the marketplace with two opinions about whether
   something is on sale. That split is what these writes exist to prevent, so
   both happen here or the caller is told the first one already landed. */

export async function approveListing(
  { submissionId, actor, note }: { submissionId: string; actor: string; note: string },
): Promise<Result> {
  const { data: fresh, error: readErr } = await supabase
    .from('operator_listings').select('*').eq('id', submissionId).maybeSingle()
  if (readErr) return { ok: false, reason: `Could not re-read the submission: ${readErr.message}` }
  if (!fresh) return { ok: false, reason: 'That submission no longer exists.' }

  const verdict = canApprove(fresh as Submission)
  if (!verdict.ok) return verdict
  if (!note.trim()) {
    return { ok: false, reason: 'Say what you checked. The seller sees this, and so does the next person to open the listing.' }
  }

  const now = new Date().toISOString()
  const { data: updated, error } = await supabase.from('operator_listings').update({
    status: 'approved', reviewed_by: actor, reviewed_at: now, decision_reason: note,
  }).eq('id', submissionId).eq('status', 'pending').select()
  if (error) return { ok: false, reason: `Could not record the decision: ${error.message}` }
  if (!updated || updated.length === 0) {
    return { ok: false, reason: 'Nothing was updated — somebody else may have decided this while you were reading it. Refresh and look again.' }
  }

  /* Publishing is what approval means. Without this the queue empties and
     nothing goes on sale. */
  const { data: pub, error: pubErr } = await supabase.from('products')
    .update({ status: 'live' }).eq('id', (fresh as Submission).product_id).select('id')
  if (pubErr || !pub || pub.length === 0) {
    return {
      ok: false,
      reason: `The decision was recorded but the listing did not go live${pubErr ? `: ${pubErr.message}` : ''}. It is approved and invisible — tell the catalogue desk before doing anything else.`,
    }
  }

  await writeAudit(actor, 'catalogue.listing.approved', (fresh as Submission).product_id, 'pending', 'live', 'info')
  return { ok: true }
}

export async function rejectListing(
  { submissionId, actor, reason }: { submissionId: string; actor: string; reason: string },
): Promise<Result> {
  const { data: fresh, error: readErr } = await supabase
    .from('operator_listings').select('*').eq('id', submissionId).maybeSingle()
  if (readErr) return { ok: false, reason: `Could not re-read the submission: ${readErr.message}` }
  if (!fresh) return { ok: false, reason: 'That submission no longer exists.' }

  const verdict = canReject(fresh as Submission, reason)
  if (!verdict.ok) return verdict

  const now = new Date().toISOString()
  const { data: updated, error } = await supabase.from('operator_listings').update({
    status: 'rejected', reviewed_by: actor, reviewed_at: now, decision_reason: reason,
  }).eq('id', submissionId).eq('status', 'pending').select()
  if (error) return { ok: false, reason: `Could not record the decision: ${error.message}` }
  if (!updated || updated.length === 0) {
    return { ok: false, reason: 'Nothing was updated — somebody else may have decided this already.' }
  }

  const { error: pErr } = await supabase.from('products')
    .update({ status: 'rejected' }).eq('id', (fresh as Submission).product_id)
  if (pErr) {
    return { ok: false, reason: `The rejection was recorded but the listing is still pending: ${pErr.message}` }
  }

  await writeAudit(actor, 'catalogue.listing.rejected', (fresh as Submission).product_id, 'pending', 'rejected', 'warning')
  return { ok: true }
}

/** Ask the seller for something instead of refusing. The listing stays in the
    queue; the question is what unblocks it. */
export async function raiseQuery(
  { productId, partnerId, subject, body, actor }:
  { productId: string; partnerId: string | null; subject: string; body: string; actor: string },
): Promise<Result> {
  if (!subject.trim() || body.trim().length < 15) {
    return { ok: false, reason: 'A query needs a subject and enough detail for the seller to answer it without guessing.' }
  }
  const asked = new Date()
  const due = new Date(asked.getTime() + 4 * 24 * 60 * 60 * 1000)
  const { error } = await supabase.from('listing_queries').insert({
    id: `LQ-Q-${Date.now().toString(36)}`,
    product_id: productId, partner_id: partnerId,
    subject, body, asked_by: actor,
    asked_on: asked.toISOString().slice(0, 10),
    due_on: due.toISOString().slice(0, 10),
    status: 'open',
  })
  if (error) return { ok: false, reason: `The query was not raised: ${error.message}` }
  return { ok: true, note: `Asked. The seller has until ${due.toISOString().slice(0, 10)} to answer.` }
}

/* ------------------------------------------------------- first party ----- */

/**
 * Publish something the operator already sells. First party is federated from
 * the operator's own catalogue rather than typed in again — the product record
 * exists, so this puts it on the marketplace rather than inventing it.
 */
export async function publishFirstParty(
  { productId, actor }: { productId: string; actor: string },
): Promise<Result> {
  const { data: p, error } = await supabase
    .from('products').select('*').eq('id', productId).maybeSingle()
  if (error) return { ok: false, reason: `Could not read the product: ${error.message}` }
  if (!p) return { ok: false, reason: 'That product is not in the operator catalogue.' }
  const product = p as ProductRow
  if (product.partner_id !== null) {
    return { ok: false, reason: `${product.name} belongs to a seller. Only their own submission can publish it — the operator approves, it does not publish on their behalf.` }
  }
  if (product.status === 'live') {
    return { ok: false, reason: `${product.name} is already on sale.` }
  }

  const { data: pub, error: pubErr } = await supabase.from('products')
    .update({ status: 'live', listed: todayLabel() }).eq('id', productId).select('id')
  if (pubErr) return { ok: false, reason: `Could not publish: ${pubErr.message}` }
  if (!pub || pub.length === 0) return { ok: false, reason: 'No row was updated. Check that write access is permitted.' }

  /* Even first party goes through the record. A listing on the marketplace with
     no review behind it is a listing nobody can account for later. */
  const { error: recErr } = await supabase.from('operator_listings').insert({
    id: `ol-${productId.replace('SKU-', '')}-fp${Date.now().toString(36).slice(-4)}`,
    product_id: productId, partner_id: null, status: 'approved', risk: 'low',
    check_note: 'First party — composed from the operator catalogue',
    submitted_by: actor, submitted_at: new Date().toISOString(),
    reviewed_by: actor, reviewed_at: new Date().toISOString(),
    decision_reason: 'Published by the operator from its own catalogue. No commission and no settlement.',
    version: 1, sort_order: 500,
  })
  if (recErr) return { ok: true, note: `${product.name} is live, but the review record was not written: ${recErr.message}` }

  await writeAudit(actor, 'catalogue.firstparty.published', productId, product.status, 'live', 'info')
  return { ok: true }
}

/* ------------------------------------------------------ operator packs --- */

export interface PackDraft {
  name: string
  categoryId: string
  description: string
  picks: ComponentPick[]
  /* Null takes the derived price. Anything else has to beat the parts and clear
     the cost floor, both of which `compositionProblem` checks. */
  override: number | null
}

/**
 * Publish a pack the operator composed from its own federated rate card.
 *
 * This is the first-party equivalent of a seller's submission, and the reason it
 * does not queue for review is that the operator is the reviewer — so the record
 * is written approved, by them, saying so. The alternative is a listing on the
 * marketplace that nobody can account for later.
 *
 * The price is derived here rather than taken from the caller. A composer that
 * trusts a price posted to it is a composer whose floor can be walked through.
 */
export async function composePack(
  { draft, telco, rule, actor }: {
    draft: PackDraft; telco: readonly TelcoItem[]; rule: BundleRule; actor: string
  },
): Promise<Result & { productId?: string }> {
  const composition = compose(draft.picks, telco, rule, draft.override)
  const problem = compositionProblem(draft.name, draft.picks, telco, rule, composition)
  if (problem) return { ok: false, reason: problem }
  if (!draft.categoryId) return { ok: false, reason: 'Choose the marketplace this pack sells in.' }

  const id = `SKU-FP${Date.now().toString(36).slice(-5).toUpperCase()}`
  const contents = composition.lines
    .map(l => (l.quantity > 1 ? `${l.quantity} × ${l.item.name}` : l.item.name))
    .join(', ')

  const { error: insErr } = await supabase.from('products').insert({
    id,
    category_id: draft.categoryId,
    sub_category: 'Operator packs',
    name: draft.name.trim(),
    /* First party is the whole point: no partner, so no commission and nothing
       to settle. */
    partner_id: null, seller: 'Aventa Telecom', comm: 0,
    price: composition.price,
    /* What the same components cost bought separately, so the saving shown on
       the product page is arithmetic rather than marketing. */
    was_price: composition.listTotal,
    cost: composition.cost,
    model: composition.model, fulfil: composition.fulfil,
    rating: null, reviews: 0, stock: 'in', status: 'live', listed: todayLabel(),
    description: draft.description.trim() || `${contents}, priced as one pack.`,
    tags: ['Bundle', 'First party'], badge: 'Bundle',
    specs: {
      Composition: 'Federated from the operator catalogue — components listed below',
      Billing: composition.model === 'oneoff' ? 'Charged once' : 'One line on one invoice',
      'Sold by': 'Aventa Telecom (first party)',
    },
    sort_order: 920,
  })
  if (insErr) return { ok: false, reason: `The pack was not created: ${insErr.message}` }

  /* Rates and names as they stand now. The BSS is free to reprice tomorrow; a
     pack that silently follows it reprices a contract somebody already holds. */
  const { error: compErr } = await supabase.from('product_telco_components').insert(
    composition.lines.map((l, i) => ({
      product_id: id, telco_id: l.item.id, quantity: l.quantity, discount: l.discount,
      rc_at: l.item.rc, nrc_at: l.item.nrc, name_at: l.item.name,
      note: draft.picks.find(p => p.telcoId === l.item.id)?.note ?? null,
      sort_order: i + 1,
    })),
  )
  if (compErr) {
    /* A pack with no components is a product with a word on it, so do not leave
       one behind. */
    await supabase.from('products').delete().eq('id', id)
    return { ok: false, reason: `The components could not be recorded, so the pack was removed: ${compErr.message}` }
  }

  /* A pack has nothing to photograph — it is an arrangement of tariff items, not
     an object — but the catalogue requires a hero on anything for sale, and a
     tile with a blank square reads as a broken listing rather than a new one.
     It borrows the category's imagery and says so in the alt text, so the
     operator can see it is a placeholder rather than a chosen photograph. */
  const { data: sibling } = await supabase
    .from('product_media')
    .select('url, product:products!inner(category_id, partner_id)')
    .eq('role', 'hero')
    .eq('products.category_id', draft.categoryId)
    .limit(1)
    .maybeSingle()
  const heroUrl = (sibling as { url?: string } | null)?.url
  const mediaErr = heroUrl
    ? (await supabase.from('product_media').insert({
        id: `pm-${id}-1`, product_id: id, url: heroUrl, role: 'hero',
        alt: `${draft.name.trim()} — placeholder imagery taken from the marketplace, not a photograph of this pack`,
        sort_order: 1,
      })).error
    : null

  const { error: recErr } = await supabase.from('operator_listings').insert({
    id: `ol-${id.replace('SKU-', '')}`, product_id: id, partner_id: null,
    status: 'approved', risk: 'low',
    check_note: 'First party — composed from the federated operator catalogue',
    submitted_by: actor, submitted_at: new Date().toISOString(),
    reviewed_by: actor, reviewed_at: new Date().toISOString(),
    decision_reason: `${priceBasis(composition, rule)} No partner, no commission, no settlement.`,
    version: 1, sort_order: 520,
  })

  await writeAudit(actor, 'catalogue.pack.composed', id, null, 'live', 'info')

  const gaps = [
    recErr && 'its review record',
    (mediaErr || !heroUrl) && 'its placeholder image',
  ].filter(Boolean).join(' and ')
  return gaps
    ? { ok: true, productId: id, note: `${draft.name} is live, but ${gaps} could not be written — add imagery before promoting it.` }
    : { ok: true, productId: id, note: `${draft.name} is live at $${composition.price.toFixed(2)}. It carries placeholder imagery until you replace it.` }
}

/* ----------------------------------------------------------- bundles ----- */

export interface BundleDraft {
  name: string
  categoryId: string
  subCategory: string
  description: string
  price: number
  model: string
  fulfil: string
  components: { productId: string; quantity: number; note: string }[]
}

/**
 * Compose a bundle from anything on sale — the operator's own stock and any
 * partner's alike. The marketplace is the only party that can do this, because
 * it is the only one with a relationship with every seller in it.
 */
export async function createBundle(
  { draft, actor }: { draft: BundleDraft; actor: string },
): Promise<Result & { productId?: string }> {
  if (!draft.name.trim()) return { ok: false, reason: 'A bundle needs a name.' }
  if (draft.components.length < 2) {
    return { ok: false, reason: 'A bundle is two or more things sold together. With one component it is just the product.' }
  }

  const { data: prodData, error } = await supabase.from('products').select('*')
    .in('id', draft.components.map(c => c.productId))
  if (error) return { ok: false, reason: `Could not read the components: ${error.message}` }
  const products = (prodData ?? []) as ProductRow[]

  const missing = draft.components.filter(c => !products.some(p => p.id === c.productId))
  if (missing.length > 0) {
    return { ok: false, reason: `These are not in the catalogue: ${missing.map(m => m.productId).join(', ')}.` }
  }
  const notLive = products.filter(p => p.status !== 'live')
  if (notLive.length > 0) {
    return { ok: false, reason: `A bundle cannot contain something that is not on sale: ${notLive.map(p => p.name).join(', ')}.` }
  }

  const partsTotal = +draft.components.reduce((n, c) => {
    const p = products.find(x => x.id === c.productId)!
    return n + p.price * c.quantity
  }, 0).toFixed(2)

  const priced = checkBundlePrice(draft.price, partsTotal)
  if (!priced.ok) return priced

  const id = `SKU-B${Date.now().toString(36).slice(-5).toUpperCase()}`
  const { error: insErr } = await supabase.from('products').insert({
    id, category_id: draft.categoryId, sub_category: draft.subCategory || 'Bundles',
    name: draft.name, partner_id: null, seller: 'Aventa Telecom',
    price: draft.price, was_price: partsTotal, cost: 0,
    model: draft.model, fulfil: draft.fulfil,
    /* A first-party bundle that recurs bills monthly, which is what `model =
       'monthly'` meant before the period was a column of its own. The operator's
       bundle builder does not ask, so this states the existing meaning rather
       than inventing an answer — the seller's wizard is where the question is
       put, because that is where the four periods were asked for. */
    billing_period: draft.model === 'oneoff' ? null : 'monthly',
    rating: 0, reviews: 0, stock: 'in', status: 'live', listed: todayLabel(),
    description: draft.description || `Sold together: ${products.map(p => p.name).join(', ')}.`,
    tags: ['Bundle'], comm: 0, badge: 'Bundle', specs: {}, sort_order: 900,
  })
  if (insErr) return { ok: false, reason: `The bundle was not created: ${insErr.message}` }

  const { error: compErr } = await supabase.from('product_components').insert(
    draft.components.map((c, i) => ({
      bundle_id: id, component_id: c.productId, quantity: c.quantity,
      note: c.note || null, sort_order: i + 1,
    })),
  )
  if (compErr) {
    /* A bundle with no components is a product with a word on it, so do not
       leave one behind. */
    await supabase.from('products').delete().eq('id', id)
    return { ok: false, reason: `The components could not be recorded, so the bundle was removed: ${compErr.message}` }
  }

  /* Holding the bundle blocks buying its parts again. The reverse is
     deliberately not written: holding a part and adding the bundle is an
     upgrade, and the basket says which standalone it replaces. */
  const { error: ruleErr } = await supabase.from('product_rules').insert(
    draft.components.map((c, i) => {
      const p = products.find(x => x.id === c.productId)!
      return {
        id: `PRL-${id}-${i + 1}`, product_id: id, kind: 'excludes',
        targets: [c.productId],
        why: `${p.name} is already inside this bundle — holding both bills it twice.`,
        sort_order: i + 1,
      }
    }),
  )

  const { error: recErr } = await supabase.from('operator_listings').insert({
    id: `ol-${id}`, product_id: id, partner_id: null, status: 'approved', risk: 'low',
    check_note: 'Bundle composed by the operator from live listings',
    submitted_by: actor, submitted_at: new Date().toISOString(),
    reviewed_by: actor, reviewed_at: new Date().toISOString(),
    decision_reason: `Composed from ${draft.components.length} live listings, priced $${(partsTotal - draft.price).toFixed(2)} below the parts.`,
    version: 1, sort_order: 500,
  })

  await writeAudit(actor, 'catalogue.bundle.created', id, null, 'live', 'info')

  const warnings = [ruleErr && 'its exclusion rules', recErr && 'its review record']
    .filter(Boolean).join(' and ')
  return warnings
    ? { ok: true, productId: id, note: `The bundle is live, but ${warnings} could not be written.` }
    : { ok: true, productId: id }
}

/** What a bundle would look like before it exists, so the operator sees the
    saving while they are still setting the price. */
export function previewBundle(
  draft: Pick<BundleDraft, 'name' | 'price' | 'components'>,
  products: readonly ProductRow[],
) {
  const stub: ProductRow = {
    id: '__draft', category_id: '', sub_category: '', name: draft.name || 'New bundle',
    partner_id: null, seller: 'Aventa Telecom', price: draft.price, was_price: null, cost: 0,
    floor_price: draft.price, list_price: draft.price, price_includes_tax: true, tax_rate: 18,
    model: 'oneoff', fulfil: 'instant', rating: 0, reviews: 0, stock: 'in', status: 'live',
    listed: null, description: '', tags: [], comm: 0, badge: null, specs: {}, sort_order: 0,
    audiences: ['consumer', 'enterprise'],
  }
  return bundleView(
    stub,
    draft.components.map((c, i) => ({
      bundle_id: '__draft', component_id: c.productId, quantity: c.quantity,
      note: c.note || null, sort_order: i + 1,
    })),
    products,
  )
}

/* -------------------------------------------------------------- audit ---- */

async function writeAudit(
  actor: string, action: string, object: string,
  before: string | null, after: string, severity: string,
): Promise<void> {
  await supabase.from('operator_audit_log').insert({
    id: `AUD-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    actor, role: 'Marketplace operations', action, object,
    category: 'Catalogue', severity, outcome: 'success',
    before_val: before, after_val: after,
  })
}

function todayLabel(): string {
  return new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

/* ------------------------------------------------ the seller's own side --- */

export interface SellerSubmission {
  partnerId: string
  categoryId: string
  subCategory: string
  name: string
  description: string
  price: number
  cost: number
  model: string
  fulfil: string
  tags: string[]
  /* The band the operator may move within, and the basis the price is quoted
     on. A listing without a floor can never go in a bundle. */
  floorPrice: number
  listPrice: number
  priceIncludesTax: boolean
  taxRate: number
  /* How often it bills, for a subscription. Null for anything bought once —
     `products_billing_period_check` refuses the pair the other way round, so
     this is not a field that can be filled in defensively. */
  billingPeriod: string | null
  /* Where it is sold. Checked against `partner_markets` by a trigger, so a
     market the seller does not hold is refused at the database rather than
     only in the form. */
  markets: readonly string[]
  /* One row per currency the chosen markets take. These are chosen figures,
     not conversions of each other. */
  prices: readonly { currency: string; price: number; floor: number; list: number }[]
  /* What a bundle is made of. Empty for anything else. */
  components: readonly { product_id: string; quantity: number }[]
}

/**
 * A seller submitting a listing for review.
 *
 * This is the join the two consoles were missing. The partner's wizard used to
 * end in a toast and write nothing, so a seller could "submit" all day and the
 * operator's queue never moved. It now creates the product in `pending` and the
 * review record that the operator decides on — the same two rows the seeded
 * queue is made of, so what a seller submits and what the desk reviews are the
 * same object.
 *
 * The category is checked here as well as when the form was built: an approval
 * can be withdrawn between opening the wizard and finishing it.
 */
export async function submitForReview(
  { draft, submittedBy }: { draft: SellerSubmission; submittedBy: string },
): Promise<Result & { productId?: string }> {
  if (!draft.name.trim()) return { ok: false, reason: 'A listing needs a name.' }
  if (!(draft.price > 0)) return { ok: false, reason: 'A listing needs a price.' }

  const [{ data: approval, error: appErr }, { data: partner, error: pErr }] = await Promise.all([
    supabase.from('partner_categories').select('*')
      .eq('partner_id', draft.partnerId).eq('category_id', draft.categoryId).maybeSingle(),
    supabase.from('partners').select('id,name,status').eq('id', draft.partnerId).maybeSingle(),
  ])
  if (appErr || pErr) return { ok: false, reason: `Could not check your approvals: ${(appErr ?? pErr)!.message}` }
  if (!partner) return { ok: false, reason: 'That seller record no longer exists.' }
  if ((partner as { status: string }).status !== 'live') {
    return { ok: false, reason: `Your account is ${(partner as { status: string }).status}. Listings can only be submitted by a live seller.` }
  }
  if (!approval || !(approval as { approved_at: string | null }).approved_at) {
    return { ok: false, reason: 'You are not approved to sell in that marketplace yet. Approval is granted when your application clears.' }
  }

  /* The price floor is the one rule the platform can settle before a person
     ever looks — and telling the seller now is cheaper for everybody than a
     rejection in four days' time. */
  if (draft.cost > 0 && draft.price <= draft.cost) {
    return {
      ok: false,
      reason: `At $${draft.price.toFixed(2)} this sits at or below your declared cost of $${draft.cost.toFixed(2)}. The catalogue refuses a listing that loses money on every sale.`,
    }
  }

  const id = `SKU-P${Date.now().toString(36).slice(-5).toUpperCase()}`
  const { error: insErr } = await supabase.from('products').insert({
    id, category_id: draft.categoryId, sub_category: draft.subCategory || 'General',
    name: draft.name, partner_id: draft.partnerId, seller: (partner as { name: string }).name,
    price: draft.price, was_price: null, cost: draft.cost,
    floor_price: draft.floorPrice, list_price: draft.listPrice,
    price_includes_tax: draft.priceIncludesTax, tax_rate: draft.taxRate,
    model: draft.model, fulfil: draft.fulfil, billing_period: draft.billingPeriod,
    rating: 0, reviews: 0, stock: 'in', status: 'pending',
    listed: new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }),
    description: draft.description, tags: draft.tags, comm: 0, badge: null, specs: {}, sort_order: 999,
  })
  if (insErr) return { ok: false, reason: `The listing was not created: ${insErr.message}` }

  const { error: recErr } = await supabase.from('operator_listings').insert({
    id: `ol-${id}`, product_id: id, partner_id: draft.partnerId,
    status: 'pending', risk: 'low',
    check_note: 'Submitted by the seller — awaiting first review',
    issue: null, submitted_by: submittedBy, submitted_at: new Date().toISOString(),
    reviewed_by: null, reviewed_at: null, decision_reason: null, version: 1, sort_order: 10,
  })
  if (recErr) {
    /* A product in `pending` with no review record is a listing nobody will
       ever look at. Do not leave one behind. */
    await supabase.from('products').delete().eq('id', id)
    return { ok: false, reason: `The submission could not be queued, so nothing was created: ${recErr.message}` }
  }

  /* Everything that hangs off the product, written after it exists.

     Each one undoes the product if it fails, for the same reason the review
     record does: a listing priced in one of its three currencies, or sold in no
     market, or a bundle with nothing in it, is worse than no listing at all —
     it reaches the desk looking like a decision somebody made. */
  const undo = async (why: string): Promise<Result> => {
    await supabase.from('products').delete().eq('id', id)
    return { ok: false, reason: why }
  }

  if (draft.markets.length) {
    const { error } = await supabase.from('product_markets')
      .insert(draft.markets.map(market_code => ({ product_id: id, market_code })))
    if (error) {
      /* The trigger's own words when a seller reaches for a market they do not
         hold — worth passing through rather than replacing. */
      return undo(`The listing was not created: ${error.message}`)
    }
  }

  if (draft.prices.length) {
    const { error } = await supabase.from('product_prices').insert(
      draft.prices.map(r => ({
        product_id: id, currency: r.currency, price: r.price,
        floor_price: r.floor || r.price, list_price: r.list || r.price, was_price: null,
      })),
    )
    if (error) return undo(`The listing's prices were not saved, so nothing was created: ${error.message}`)
  }

  if (draft.components.length) {
    const { error } = await supabase.from('product_components').insert(
      /* `component_id`, not `product_id` — the column names which listing is
         inside the bundle, and `bundle_id` names the one it is inside. The
         pair is the key; there is no surrogate id. */
      draft.components.map((c, n) => ({
        bundle_id: id, component_id: c.product_id,
        quantity: c.quantity, note: null, sort_order: n + 1,
      })),
    )
    if (error) return undo(`The bundle's contents were not saved, so nothing was created: ${error.message}`)
  }

  return { ok: true, productId: id, note: `${draft.name} is in the marketplace review queue.` }
}

/** What the seller sees about their own submissions. */
export async function loadSellerSubmissions(partnerId: string): Promise<{
  submissions: Submission[]; products: ProductRow[]; queries: ListingQuery[]; loadError?: string
}> {
  const [subRes, prodRes, qRes] = await Promise.all([
    supabase.from('operator_listings').select('*').eq('partner_id', partnerId).order('sort_order'),
    supabase.from('products').select('*').eq('partner_id', partnerId).order('id'),
    supabase.from('listing_queries').select('*').eq('partner_id', partnerId).order('asked_on', { ascending: false }),
  ])
  const errors = [subRes.error, prodRes.error, qRes.error].filter(Boolean).map(e => e!.message)
  return {
    submissions: (subRes.data ?? []) as Submission[],
    products: (prodRes.data ?? []) as ProductRow[],
    queries: (qRes.data ?? []) as ListingQuery[],
    ...(errors.length > 0 ? { loadError: `Could not load your submissions (${errors.join('; ')}).` } : {}),
  }
}

/**
 * Who a listing is sold to.
 *
 * The category decides which shelves a persona sees; this decides what on the
 * shelf is theirs. Both are needed because IoT carries a $52 occupancy sensor
 * and a fifty-unit fleet bundle, and the shelf cannot tell them apart.
 *
 * Sold to nobody is refused here rather than stored: a listing with an empty
 * audience is invisible on every storefront while still reading as live in the
 * catalogue, which is a withdrawal that looks like a listing.
 */
export async function setAudiences(
  { productId, audiences, actor }: { productId: string; audiences: string[]; actor: string },
): Promise<Result> {
  const wanted = [...new Set(audiences)].filter(a => ['consumer', 'enterprise', 'partner'].includes(a))
  if (!wanted.length) {
    return {
      ok: false,
      reason: 'A listing has to be sold to somebody. To take it off sale, change its status — an empty audience is a withdrawal that still reads as live.',
    }
  }

  const { data: before } = await supabase.from('products')
    .select('audiences').eq('id', productId).maybeSingle()

  const { data, error } = await supabase.from('products')
    .update({ audiences: wanted }).eq('id', productId).select('id')
  if (error) return { ok: false, reason: `Could not change who it is sold to: ${error.message}` }
  if (!data?.length) return { ok: false, reason: 'Nothing changed — only the marketplace operator can reclassify a listing.' }

  await writeAudit(actor, 'catalogue.listing.audiences', productId,
    (before?.audiences as string[] | undefined)?.join(' and ') ?? null,
    wanted.join(' and '), 'info')

  /* Narrowing a listing can empty a shelf. Saying so is the operator's cue to
     look, rather than finding out when a storefront goes blank. */
  const { data: siblings } = await supabase.from('products')
    .select('id, category_id, audiences, status').neq('status', 'archived')
  const mine = (siblings ?? []).find(p => p.id === productId)
  const emptied = mine
    ? ['consumer', 'enterprise', 'partner'].filter(who =>
      !wanted.includes(who)
      && !(siblings ?? []).some(p =>
        p.category_id === mine.category_id && p.id !== productId
        && (p.audiences as string[]).includes(who)))
    : []

  return {
    ok: true,
    note: emptied.length
      ? `Saved. That was the last thing on this shelf sold to ${emptied.join(' and ')}, so the shelf no longer appears for them.`
      : `Saved. It is now sold to ${wanted.join(' and ')}.`,
  }
}
