/* The only module that talks to Supabase about partners themselves — who they
   are, what they may sell, what they settle on, and how their status moves.
   The rules live in partnerLifecycle.ts and partnerCommerce.ts; this is the one
   read path and the one write path they sit on. */

import { supabase } from './supabase'
import { canMove } from './partnerLifecycle'
import type { PartnerStatus, LifecycleEvent, Transition } from './partnerLifecycle'
import type { PartnerCategory, CommissionPlan, ListingRow } from './partnerCommerce'
import type { Tier, PolicyRule, CategoryEvidence } from './partnerDirectory'
import type { GateDocument } from './onboarding'
import type { Category } from '../types'
import {
  canAddCategory, canApproveCategory, canWithdrawCategory, openingEvidence, approvalBasis,
} from './partnerCategories'
import type {
  CategoryRow, Approval, EvidenceRow, PolicyRuleRow,
} from './partnerCategories'

export type Result = { ok: true; note?: string } | { ok: false; reason: string }

/* Category changes are governance, not catalogue work: they alter what a seller
   is contractually allowed to sell. The audit row says so, and carries the
   reason the operator gave rather than only the fact that something moved. */
async function writeAudit(
  actor: string, action: string, object: string,
  before: string | null, after: string, severity: string, detail: string,
): Promise<void> {
  await supabase.from('operator_audit_log').insert({
    id: `AUD-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    actor, role: 'Marketplace operations', action, object,
    category: 'Partners', severity, outcome: 'success',
    before_val: before, after_val: `${after} — ${detail}`,
  })
}

function todayLabel(): string {
  return new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

export interface Statement {
  id: string
  partner_id: string | null
  partner_name: string
  plan_id: string | null
  period: string
  gross: number
  commission: number
  commission_rate: number
  fees: number
  withholding: number
  refunds: number
  net: number
  status: string
  order_count: number
  currency: string
  approved_by: string | null
  approved_at: string | null
  disputed: boolean
  sort_order: number
}

export interface PartnerRecord {
  id: string
  name: string
  type: string
  country: string
  tier: string
  status: PartnerStatus
  rating: number
  contact: string
  email: string
  joined: string
  plan_id: string | null
  tier_id: string
}

export interface PartnerDirectoryRow extends PartnerRecord {
  categories: string[]
  planName: string | null
  listings: number
  liveListings: number
  /* The gate the seller sits on, or null once every gate has cleared. */
  currentGate: string | null
  clearedGates: number
  totalGates: number
}

export interface DirectorySnapshot {
  rows: PartnerDirectoryRow[]
  categories: Category[]
  plans: CommissionPlan[]
  tiers: Tier[]
  loadError?: string
}

/* One round trip per table rather than per partner. The alternative — a query
   inside a map over fifteen sellers — is sixty requests to render one screen. */
export async function loadPartnerDirectory(): Promise<DirectorySnapshot> {
  const [partnerRes, catRes, planRes, pcRes, prodRes, gateRes, tierRes] = await Promise.all([
    supabase.from('partners').select('*').order('id'),
    supabase.from('categories').select('*').order('sort_order'),
    supabase.from('commission_plans').select('*').order('sort_order'),
    supabase.from('partner_categories').select('*'),
    supabase.from('products').select('id,partner_id,status').not('partner_id', 'is', null),
    supabase.from('onboarding_gates').select('partner_id,gate_name,gate_order,status').order('gate_order'),
    supabase.from('partner_tiers').select('*').order('sort_order'),
  ])

  const errors: string[] = []
  const note = (label: string, e: { message: string } | null) => { if (e) errors.push(`${label}: ${e.message}`) }
  note('partners', partnerRes.error); note('categories', catRes.error); note('plans', planRes.error)
  note('approved categories', pcRes.error); note('listings', prodRes.error); note('gates', gateRes.error)
  note('tiers', tierRes.error)

  const partners = (partnerRes.data ?? []) as PartnerRecord[]
  const categories = (catRes.data ?? []) as Category[]
  const plans = (planRes.data ?? []) as CommissionPlan[]
  const approvals = (pcRes.data ?? []) as PartnerCategory[]
  const products = (prodRes.data ?? []) as { id: string; partner_id: string; status: string }[]
  const gates = (gateRes.data ?? []) as { partner_id: string; gate_name: string; gate_order: number; status: string }[]

  const rank = (id: string) => categories.find(c => c.id === id)?.sort_order ?? 999

  const rows = partners.map(p => {
    const mine = gates.filter(g => g.partner_id === p.id)
    const listings = products.filter(x => x.partner_id === p.id)
    return {
      ...p,
      categories: approvals.filter(a => a.partner_id === p.id).map(a => a.category_id).sort((a, b) => rank(a) - rank(b)),
      planName: plans.find(pl => pl.id === p.plan_id)?.name ?? null,
      listings: listings.length,
      liveListings: listings.filter(x => x.status === 'live').length,
      currentGate: mine.find(g => g.status === 'current')?.gate_name
        ?? mine.find(g => g.status === 'failed')?.gate_name
        ?? null,
      clearedGates: mine.filter(g => g.status === 'cleared').length,
      totalGates: mine.length,
    }
  })

  return {
    rows, categories, plans,
    tiers: (tierRes.data ?? []) as Tier[],
    ...(errors.length > 0 ? { loadError: `Could not load the full partner directory (${errors.join('; ')}).` } : {}),
  }
}

export interface PartnerDetail {
  partner: PartnerRecord | null
  plan: CommissionPlan | null
  approvals: PartnerCategory[]
  listings: ListingRow[]
  history: LifecycleEvent[]
  /* What each category the seller applied for demands, and what they supplied
     against it. The company gates say who they are; this says what they may
     sell, and it is per category because the demands are. */
  evidence: CategoryEvidence[]
  rules: PolicyRule[]
  /* Everything the seller has ever handed over, from the company gates. */
  documents: GateDocument[]
  statements: Statement[]
  /* Which rules each category applies and at what level. Needed to decide
     whether a category may be approved, and to know what a newly added one
     will owe — both of which the screen has to answer before it writes. */
  matrix: MatrixRow[]
  loadError?: string
}

export interface MatrixRow { category_id: string; rule_id: string; level: string }

export async function loadPartnerDetail(partnerId: string): Promise<PartnerDetail> {
  const [pRes, prodRes, pcRes, histRes, evRes, ruleRes, docRes, stmtRes, matrixRes] = await Promise.all([
    supabase.from('partners').select('*, plan:commission_plans(*)').eq('id', partnerId).maybeSingle(),
    /* The lifecycle columns come back with the row rather than on opening one:
       My Listings tells a seller "goes live in 6 days" in the table itself, and
       a second read per row to say that would be a read per row. */
    supabase.from('products')
      .select('id,name,category_id,status,price,stock,listed,description,sub_category,fulfil,tags,go_live_on,paused_on,paused_reason,retired_on,retired_reason')
      .eq('partner_id', partnerId).order('id'),
    supabase.from('partner_categories').select('*').eq('partner_id', partnerId),
    supabase.from('partner_lifecycle_events').select('*').eq('partner_id', partnerId),
    supabase.from('partner_category_evidence').select('*').eq('partner_id', partnerId),
    supabase.from('policy_rules').select('*').order('sort_order'),
    supabase.from('onboarding_documents').select('*').eq('partner_id', partnerId).order('sort_order'),
    supabase.from('settlement_statements').select('*').eq('partner_id', partnerId).order('sort_order', { ascending: false }),
    supabase.from('category_policy_rules').select('*'),
  ])

  const errors: string[] = []
  const note = (label: string, e: { message: string } | null) => { if (e) errors.push(`${label}: ${e.message}`) }
  note('partner', pRes.error); note('listings', prodRes.error)
  note('approved categories', pcRes.error); note('lifecycle history', histRes.error)
  note('category evidence', evRes.error); note('policy rules', ruleRes.error)
  note('documents', docRes.error); note('statements', stmtRes.error)
  note('policy matrix', matrixRes.error)

  const raw = pRes.data as (PartnerRecord & { plan: CommissionPlan | null }) | null

  return {
    partner: raw ? { ...raw } : null,
    plan: raw?.plan ?? null,
    approvals: (pcRes.data ?? []) as PartnerCategory[],
    listings: (prodRes.data ?? []) as ListingRow[],
    history: (histRes.data ?? []) as LifecycleEvent[],
    evidence: (evRes.data ?? []) as CategoryEvidence[],
    rules: (ruleRes.data ?? []) as PolicyRule[],
    documents: (docRes.data ?? []) as GateDocument[],
    statements: (stmtRes.data ?? []) as Statement[],
    matrix: (matrixRes.data ?? []) as MatrixRow[],
    ...(errors.length > 0 ? { loadError: `Could not load the full partner record (${errors.join('; ')}).` } : {}),
  }
}

/* ------------------------------------------------- the seller's own view -- */

export interface SellerRecord {
  partner: PartnerRecord | null
  plan: CommissionPlan | null
  approvals: PartnerCategory[]
  listings: ListingRow[]
  evidence: CategoryEvidence[]
  rules: PolicyRule[]
  statements: Statement[]
  categories: Category[]
  /* Everything the seller handed over at the seven company gates. They supplied
     these; not showing them back is the console keeping the seller's own
     paperwork from them. */
  documents: GateDocument[]
  /* Which rules each marketplace applies, so the seller can be told what a
     marketplace they do *not* hold would ask of them before they apply. */
  matrix: MatrixRow[]
  loadError?: string
}

/**
 * What a seller sees about themselves. The same rows the operator reads, under
 * the seller's own RLS — which is the point: two screens rendering one record.
 *
 * Before this the partner console ran on a hard-coded profile that had drifted
 * from the database it sits on. It offered a Security listing to a seller
 * approved only for IoT and Devices, and quoted a 12% rate against a plan that
 * settles at 11%. A number a seller reads and plans against has to be the
 * number they are actually paid on.
 */
export async function loadSellerRecord(partnerId: string): Promise<SellerRecord> {
  const [detail, catRes] = await Promise.all([
    loadPartnerDetail(partnerId),
    supabase.from('categories').select('*').order('sort_order'),
  ])

  const errors: string[] = []
  if (detail.loadError) errors.push(detail.loadError)
  if (catRes.error) errors.push(`categories: ${catRes.error.message}`)

  return {
    partner: detail.partner,
    plan: detail.plan,
    approvals: detail.approvals,
    listings: detail.listings,
    evidence: detail.evidence,
    rules: detail.rules,
    statements: detail.statements,
    categories: (catRes.data ?? []) as Category[],
    documents: detail.documents,
    matrix: detail.matrix,
    ...(errors.length > 0 ? { loadError: errors.join(' ') } : {}),
  }
}

/**
 * A seller applying for another marketplace themselves.
 *
 * The same two-step the operator uses, from the other side: this files an
 * application with its evidence outstanding, and the operator still decides. A
 * seller cannot approve themselves — the insert policy refuses any row that
 * arrives already approved, so this is safe even though the seller is the one
 * writing it.
 */
export async function applyForCategory(
  { partnerId, categoryId, note }: { partnerId: string; categoryId: string; note: string },
): Promise<Result> {
  if (!note.trim()) {
    return { ok: false, reason: 'Say why you want to sell here. The marketplace desk reads it alongside your evidence.' }
  }

  const [catRes, pcRes, matrixRes, ruleRes, pRes] = await Promise.all([
    supabase.from('categories').select('*').order('sort_order'),
    supabase.from('partner_categories').select('*').eq('partner_id', partnerId),
    supabase.from('category_policy_rules').select('*').eq('category_id', categoryId),
    supabase.from('policy_rules').select('*'),
    supabase.from('partners').select('id,name,status').eq('id', partnerId).maybeSingle(),
  ])

  const categories = (catRes.data ?? []) as (CategoryRow & { self_apply?: boolean })[]
  const category = categories.find(c => c.id === categoryId)
  if (!category) return { ok: false, reason: 'That marketplace does not exist.' }
  if (category.self_apply === false) {
    return { ok: false, reason: `${category.name} is not open to applications — the marketplace places sellers there itself.` }
  }

  const partner = pRes.data as { status: string } | null
  const verdict = canAddCategory(partner?.status ?? 'unknown', categoryId, categories,
    (pcRes.data ?? []) as Approval[])
  if (!verdict.ok) return verdict

  const { error: insErr } = await supabase.from('partner_categories').insert({
    partner_id: partnerId, category_id: categoryId, approved_at: null, approved_by: null,
  })
  if (insErr) return { ok: false, reason: `The application was not filed: ${insErr.message}` }

  const opening = openingEvidence(
    categoryId,
    (matrixRes.data ?? []) as MatrixRow[],
    (ruleRes.data ?? []) as PolicyRuleRow[],
  )
  const { error: evErr } = opening.length > 0
    ? await supabase.from('partner_category_evidence').insert(opening.map((o: ReturnType<typeof openingEvidence>[number]) => ({
        id: `pce-${partnerId.slice(4)}-${categoryId}-${o.rule_id}`,
        partner_id: partnerId, category_id: categoryId, rule_id: o.rule_id,
        state: o.state, document: o.document,
        note: o.state === 'outstanding' ? `Owed since ${todayLabel()} — applied for by the seller.` : null,
      })))
    : { error: null }

  await writeAudit('Seller self-service', 'partner.category.applied', `${partnerId}/${categoryId}`,
    null, 'applied', 'info', note)

  if (evErr) {
    return { ok: true, note: `Applied for ${category.name}, but the checklist was not written (${evErr.message}). Tell the marketplace desk.` }
  }
  const owed = opening.filter((o: ReturnType<typeof openingEvidence>[number]) => o.state === 'outstanding').length
  return {
    ok: true,
    note: `Applied for ${category.name}. ${owed} document${owed === 1 ? '' : 's'} ${owed === 1 ? 'is' : 'are'} needed before it can open.`,
  }
}

export type MoveResult =
  | { ok: true; transition: Transition; listingsSuspended: number; recordWarning?: string }
  | { ok: false; reason: string }

/**
 * The only write path for `partners.status`.
 *
 * Re-reads the partner and its gates before deciding, because the screen can be
 * stale — another desk may have moved the seller on, or a gate may have cleared
 * since the panel rendered. The same discipline `clearGate` follows: the write
 * path must not trust what the screen believed.
 */
export async function movePartner(
  { partnerId, to, reason, actor }: { partnerId: string; to: PartnerStatus; reason: string; actor: string },
): Promise<MoveResult> {
  const [pRes, gRes] = await Promise.all([
    supabase.from('partners').select('id,name,status').eq('id', partnerId).maybeSingle(),
    supabase.from('onboarding_gates').select('status').eq('partner_id', partnerId),
  ])
  if (pRes.error) return { ok: false, reason: `Could not re-read the partner before moving it: ${pRes.error.message}` }
  if (gRes.error) return { ok: false, reason: `Could not re-read the onboarding gates before moving the partner: ${gRes.error.message}` }
  if (!pRes.data) return { ok: false, reason: 'That partner no longer exists.' }

  const from = pRes.data.status as PartnerStatus
  const verdict = canMove(from, to, {
    gateStatuses: (gRes.data ?? []).map(g => g.status as string),
    reason,
  })
  if (!verdict.ok) return verdict

  /* PostgREST reports an UPDATE matching zero rows as success — RLS denial and
     "no such row" both come back as `error: null, data: []`. A state change has
     to check what it actually changed. */
  const { data: updated, error: upErr } = await supabase
    .from('partners').update({ status: to }).eq('id', partnerId).select()
  if (upErr) return { ok: false, reason: `Could not change the status: ${upErr.message}` }
  if (!updated || updated.length === 0) {
    return { ok: false, reason: 'No row was updated. Check that the partner exists and that write access is permitted.' }
  }

  /* Taking listings down is part of the move, not a follow-up somebody might
     forget: a suspended seller whose stock is still on sale is not suspended. */
  let listingsSuspended = 0
  if (verdict.transition.suspendsListings) {
    const { data, error } = await supabase.from('products')
      .update({ status: 'suspended' }).eq('partner_id', partnerId).eq('status', 'live').select('id')
    if (error) {
      return { ok: false, reason: `The status changed to ${to}, but the seller's live listings could not be taken down: ${error.message}. Take them down before anything else.` }
    }
    listingsSuspended = data?.length ?? 0
  }

  const now = new Date().toISOString()
  const suffix = Math.random().toString(36).slice(2, 8)

  const { error: evErr } = await supabase.from('partner_lifecycle_events').insert({
    id: `PLE-${partnerId}-${Date.now().toString(36)}${suffix}`,
    partner_id: partnerId, from_status: from, to_status: to, reason, actor, at: now,
  })

  const { error: auditErr } = await supabase.from('operator_audit_log').insert({
    id: `AUD-${Date.now()}-${suffix}`,
    actor, role: 'Marketplace operations',
    action: 'partner.status.changed',
    object: `${partnerId} · ${pRes.data.name}`,
    category: 'Partner', severity: to === 'suspended' || to === 'rejected' ? 'warning' : 'info',
    outcome: 'success', before_val: from, after_val: to,
  })

  /* By this point the change is durable and there is no transaction to roll it
     back with. Returning a failure here would tell the caller the move did not
     happen when it did — a worse lie than surfacing a warning alongside the
     success it actually is. */
  if (evErr || auditErr) {
    return {
      ok: true, transition: verdict.transition, listingsSuspended,
      recordWarning: `The partner is now ${to} and that has taken effect, but the record of it could not be ` +
        `written (${[evErr?.message, auditErr?.message].filter(Boolean).join('; ')}). Tell the marketplace desk.`,
    }
  }

  return { ok: true, transition: verdict.transition, listingsSuspended }
}

/* --------------------------------------------- category eligibility ------ */

/**
 * Add a category to a seller's agreement.
 *
 * It lands *unapproved*, with the rules that category applies written out as
 * what the seller now owes. That is the whole point of the two-step: adding a
 * category says the marketplace is willing to consider them for it, and
 * approving says they have shown what it demands. Collapsing the two would let
 * a seller into Security on the strength of somebody clicking a menu.
 */
export async function addPartnerCategory(
  { partnerId, categoryId, actor, reason }: {
    partnerId: string; categoryId: string; actor: string; reason: string
  },
): Promise<Result> {
  if (!reason.trim()) {
    return { ok: false, reason: 'Say why this category is being added. It changes what the seller may sell, and the next person to read the record will want to know who decided that and on what basis.' }
  }

  /* Re-read rather than trusting what the screen was holding — the same reason
     the listing decisions do. */
  const [pRes, catRes, pcRes, matrixRes, ruleRes] = await Promise.all([
    supabase.from('partners').select('id,name,status').eq('id', partnerId).maybeSingle(),
    supabase.from('categories').select('id,name,sort_order').order('sort_order'),
    supabase.from('partner_categories').select('*').eq('partner_id', partnerId),
    supabase.from('category_policy_rules').select('*').eq('category_id', categoryId),
    supabase.from('policy_rules').select('*'),
  ])
  if (pRes.error) return { ok: false, reason: `Could not read the seller: ${pRes.error.message}` }
  const partner = pRes.data as { id: string; name: string; status: string } | null
  if (!partner) return { ok: false, reason: 'That seller no longer exists.' }

  const categories = (catRes.data ?? []) as CategoryRow[]
  const approvals = (pcRes.data ?? []) as Approval[]
  const verdict = canAddCategory(partner.status, categoryId, categories, approvals)
  if (!verdict.ok) return verdict

  const category = categories.find(c => c.id === categoryId)!

  const { error: insErr } = await supabase.from('partner_categories').insert({
    partner_id: partnerId, category_id: categoryId, approved_at: null, approved_by: null,
  })
  if (insErr) return { ok: false, reason: `The category was not added: ${insErr.message}` }

  /* What it now owes. Seeded the same way the category-onboarding migration
     seeds it, so a category added here and one that came with the seed are
     indistinguishable afterwards. */
  const opening = openingEvidence(
    categoryId,
    (matrixRes.data ?? []) as MatrixRow[],
    (ruleRes.data ?? []) as PolicyRuleRow[],
  )
  const { error: evErr } = opening.length > 0
    ? await supabase.from('partner_category_evidence').insert(opening.map((o: ReturnType<typeof openingEvidence>[number]) => ({
        id: `pce-${partnerId.slice(4)}-${categoryId}-${o.rule_id}`,
        partner_id: partnerId, category_id: categoryId, rule_id: o.rule_id,
        state: o.state, document: o.document,
        note: o.state === 'outstanding' ? `Owed since ${todayLabel()} — added with the category.` : null,
      })))
    : { error: null }

  await writeAudit(actor, 'partner.category.added', `${partnerId}/${categoryId}`, null, 'applied', 'info', reason)

  if (evErr) {
    return { ok: true, note: `${category.name} was added to ${partner.name}, but its evidence checklist was not written (${evErr.message}) — it will show no rules until that is fixed.` }
  }
  const owed = opening.filter((o: ReturnType<typeof openingEvidence>[number]) => o.state === 'outstanding').length
  return {
    ok: true,
    note: `${category.name} added to ${partner.name}. It is not open yet — ${owed} document${owed === 1 ? '' : 's'} ${owed === 1 ? 'is' : 'are'} outstanding before it can be approved.`,
  }
}

/**
 * Open a category the seller has satisfied.
 *
 * Refuses on the same condition the database asserts after every migration: an
 * approved category with an enforcing rule outstanding is the contradiction the
 * whole eligibility model exists to prevent.
 */
export async function approvePartnerCategory(
  { partnerId, categoryId, actor }: { partnerId: string; categoryId: string; actor: string },
): Promise<Result> {
  const [catRes, pcRes, evRes, matrixRes, ruleRes] = await Promise.all([
    supabase.from('categories').select('id,name,sort_order'),
    supabase.from('partner_categories').select('*').eq('partner_id', partnerId),
    supabase.from('partner_category_evidence').select('*').eq('partner_id', partnerId),
    supabase.from('category_policy_rules').select('*'),
    supabase.from('policy_rules').select('*'),
  ])

  const categories = (catRes.data ?? []) as CategoryRow[]
  const approvals = (pcRes.data ?? []) as Approval[]
  const evidence = (evRes.data ?? []) as EvidenceRow[]
  const matrix = (matrixRes.data ?? []) as MatrixRow[]
  const rules = (ruleRes.data ?? []) as PolicyRuleRow[]

  const verdict = canApproveCategory(partnerId, categoryId, approvals, evidence, matrix, rules)
  if (!verdict.ok) return verdict

  const category = categories.find(c => c.id === categoryId)
  const now = new Date().toISOString()

  /* Guarded on approved_at being null, so two people approving the same
     category at once cannot both claim to have been the one who did. */
  const { data: updated, error } = await supabase.from('partner_categories')
    .update({ approved_at: now, approved_by: actor })
    .eq('partner_id', partnerId).eq('category_id', categoryId).is('approved_at', null)
    .select()
  if (error) return { ok: false, reason: `Could not approve the category: ${error.message}` }
  if (!updated || updated.length === 0) {
    return { ok: false, reason: 'Nothing was updated — somebody else may have approved this while you were reading it. Refresh and look again.' }
  }

  const basis = approvalBasis(category?.name ?? categoryId, evidence, partnerId, categoryId, matrix)
  await writeAudit(actor, 'partner.category.approved', `${partnerId}/${categoryId}`, 'applied', 'approved', 'info', basis)

  return { ok: true, note: `${category?.name ?? categoryId} is open. ${basis}` }
}

/**
 * Withdraw a category from a seller's agreement.
 *
 * Refused while anything is on sale or in review in it: withdrawing underneath
 * live listings would leave products for sale in a category their seller is not
 * allowed to sell in.
 */
export async function withdrawPartnerCategory(
  { partnerId, categoryId, actor, reason }: {
    partnerId: string; categoryId: string; actor: string; reason: string
  },
): Promise<Result> {
  if (!reason.trim()) {
    return { ok: false, reason: 'Say why it is being withdrawn. The seller is told, and a withdrawal with no reason reads as a mistake.' }
  }

  const [catRes, pcRes, prodRes] = await Promise.all([
    supabase.from('categories').select('id,name,sort_order'),
    supabase.from('partner_categories').select('*').eq('partner_id', partnerId),
    supabase.from('products').select('id,name,category_id,status').eq('partner_id', partnerId),
  ])

  const categories = (catRes.data ?? []) as CategoryRow[]
  const approvals = (pcRes.data ?? []) as Approval[]
  const listings = (prodRes.data ?? []) as { id: string; name: string; category_id: string; status: string }[]

  const verdict = canWithdrawCategory(categoryId, approvals, listings)
  if (!verdict.ok) return verdict

  /* The evidence goes with it. Keeping a checklist for a category the seller no
     longer holds leaves rows that no screen has a place for, and re-adding the
     category later would collide with them on the unique key. */
  const { error: evErr } = await supabase.from('partner_category_evidence')
    .delete().eq('partner_id', partnerId).eq('category_id', categoryId)
  if (evErr) return { ok: false, reason: `Could not clear the evidence for this category: ${evErr.message}` }

  const { data: removed, error } = await supabase.from('partner_categories')
    .delete().eq('partner_id', partnerId).eq('category_id', categoryId).select()
  if (error) return { ok: false, reason: `Could not withdraw the category: ${error.message}` }
  if (!removed || removed.length === 0) {
    return { ok: false, reason: 'Nothing was removed — it may already have been withdrawn. Refresh and look again.' }
  }

  const category = categories.find(c => c.id === categoryId)
  await writeAudit(actor, 'partner.category.withdrawn', `${partnerId}/${categoryId}`, 'approved', 'withdrawn', 'warning', reason)

  return { ok: true, note: `${category?.name ?? categoryId} withdrawn. This seller can no longer list in it.` }
}
