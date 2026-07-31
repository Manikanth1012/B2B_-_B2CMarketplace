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
  loadError?: string
}

export async function loadPartnerDetail(partnerId: string): Promise<PartnerDetail> {
  const [pRes, prodRes, pcRes, histRes, evRes, ruleRes, docRes, stmtRes] = await Promise.all([
    supabase.from('partners').select('*, plan:commission_plans(*)').eq('id', partnerId).maybeSingle(),
    supabase.from('products').select('id,name,category_id,status,price,stock,listed')
      .eq('partner_id', partnerId).order('id'),
    supabase.from('partner_categories').select('*').eq('partner_id', partnerId),
    supabase.from('partner_lifecycle_events').select('*').eq('partner_id', partnerId),
    supabase.from('partner_category_evidence').select('*').eq('partner_id', partnerId),
    supabase.from('policy_rules').select('*').order('sort_order'),
    supabase.from('onboarding_documents').select('*').eq('partner_id', partnerId).order('sort_order'),
    supabase.from('settlement_statements').select('*').eq('partner_id', partnerId).order('sort_order', { ascending: false }),
  ])

  const errors: string[] = []
  const note = (label: string, e: { message: string } | null) => { if (e) errors.push(`${label}: ${e.message}`) }
  note('partner', pRes.error); note('listings', prodRes.error)
  note('approved categories', pcRes.error); note('lifecycle history', histRes.error)
  note('category evidence', evRes.error); note('policy rules', ruleRes.error)
  note('documents', docRes.error); note('statements', stmtRes.error)

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
    ...(errors.length > 0 ? { loadError: errors.join(' ') } : {}),
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
