import type { GateStatus } from '../lib/onboarding'

export interface Category {
  id: string
  name: string
  /* Display prose — 'B2C', 'B2B2X', 'Consumer & Enterprise' — and which landing
     rail promotes this. Never branch a permission on it; use shoppable_by. */
  audience: string
  /* The personas that may put a product from this category in a basket and pay
     for it. Not who may see it: the public partner page shows the partner
     category to anyone, and the operator runs all six. */
  shoppable_by: ('consumer' | 'enterprise' | 'partner')[]
  icon: string
  blurb: string
  sort_order: number
}

export interface Partner {
  id: string
  name: string
  type: string
  country: string
  tier: string
  status: string
  rating: number
  contact: string
  email: string
  joined: string
}

export interface Product {
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
  rating: number | null
  reviews: number
  stock: string
  status: string
  listed: string
  description: string
  tags: string[]
  comm: number
  badge: string | null
  unit: string | null
  specs: Record<string, string>
  sort_order: number
  /* Who this thing is actually sold to. The category decides which shelf a
     persona sees; this decides what on that shelf is theirs to buy. */
  audiences: string[]
  /* The currency `price` and `was_price` are in. Set by `reprice` when the
     catalogue is loaded for a market, so every component that prints a price
     is printing one it can format — a number without this is a number in some
     currency, which is not the same as a number in dollars. */
  currency?: string
  floor_price?: number
  list_price?: number
}

export interface CartItem {
  id: string
  product_id: string
  quantity: number
  created_at: string
  /* Set aside rather than being bought now. Saved lines stay in the basket — the
     prototype renders them as a dimmed section of it — but are excluded from the
     count, the totals and checkout. */
  saved: boolean
  product?: Product
}

export interface Order {
  id: string
  order_ref: string
  status: string
  total: number
  subtotal: number
  tax: number
  discount: number
  payment_method: string | null
  buyer_name: string | null
  buyer_email: string | null
  shipping_address: Record<string, string> | null
  created_at: string
  /* Frozen at checkout. An order is read in the money it was placed in — a
     reprice or a market switch afterwards must not change what somebody
     already paid. */
  currency: string
  market: string
  tax_rate: number
  tracking_ref: string | null
  carrier: string | null
  placed_date: string | null
  seller: string | null
  vertical: string | null
  failed: boolean
  stage: number
  stages: string[]
}

export interface OrderItem {
  id: string
  order_id: string
  product_id: string
  product_name: string
  price: number
  quantity: number
  fulfil: string
  status: string
}

export interface Subscription {
  id: string
  /* Human-facing id (SUB-9101), as orders carry order_ref. The key stays a uuid. */
  ref: string | null
  product_id: string
  product_name: string
  seller: string | null
  cycle: string | null
  status: string
  auto_renew: boolean
  started_at: string
  next_renewal: string | null
  /* Cancelled: access runs to here. Paused: billing restarts here. Distinct facts —
     see supabase/migrations/20260730090000_consumer_subscriptions.sql. */
  ends_at: string | null
  resumes_at: string | null
  price: number
  /* What the customer is charged in. `price` used to be the catalogue's dollar
     list price with nothing to say so, which put "$18.00/mo" on an account
     whose every bill is in rupees. */
  currency: string
}

export interface LoyaltyProgramme {
  id: string
  name: string
  unit: string
  per_unit: number
  min_redeem: number
  expiry_months: number
  rounding_note: string
  breakage: number
  breakage_basis: string
  liability_account: string
  funding_note: string
  status: string
  launched: string
}

export interface LoyaltyTier {
  id: string
  name: string
  sort_order: number
  qualify_spend: number
  multiplier: number
  colour: string
  benefits: string[]
  note: string | null
  /* Which ladder this rung belongs to. `loyalty_tiers` holds two of them —
     Bronze/Silver/Gold/Platinum for retail, Registered/Business/Business
     Plus/Strategic for business accounts — and they share sort_order 1..4.
     This field was in the database and missing from this type, so no caller
     could filter on it even if they thought to, and the retail rewards page
     drew all eight rungs interleaved. */
  kind: 'consumer' | 'enterprise'
}

export interface EarnRule {
  id: string
  name: string
  scope: string
  scope_id: string | null
  rate: number
  funder: string
  split: number | null
  status: string
  from: string | null
  to: string | null
  cap_per_order: number | null
  cap_per_month: number | null
  audience: string
  bonus: number | null
  first_only: boolean
  why: string
}

export interface RedeemOption {
  id: string
  name: string
  kind: string
  min: number
  step: number
  value_per: number
  cost: string
  audience: string
  status: string
  description: string
  why: string
}

export interface LoyaltyMember {
  id: string
  party: string | null
  name: string
  kind: string
  tier: string
  balance: number
  joined: string | null
  qualify_12m: number
  lifetime_earned: number
  lifetime_redeemed: number
  expiring_soon: number
  expiring_on: string | null
  last_activity: string | null
}

export interface LoyaltyLedgerEntry {
  id: string
  member: string
  when_date: string
  type: string
  points: number
  ref: string | null
  rule_id: string | null
  funder: string
  seller_id: string | null
  value: number
  /* What `value` is in. A movement's worth is derived from its points at the
     member's own rate, so it follows the member's currency and not the
     marketplace's. */
  currency: string
  note: string
}

export interface ConsumerProfile {
  id: string
  /* Whose row this is. `id` is not that — the demo customer's is the literal
     'me' — and RLS scopes this table by `user_id`, so this is what an update
     filters on. Nullable because the column is, though a signed-in shopper's
     row always has it. */
  user_id: string | null
  name: string
  customer_id: string
  msisdn: string
  city: string
  since: string
  wallet: number
  /* What this customer's money is in — their bills', their wallet's, their
     orders'. Every figure on the account screens is formatted with it rather
     than with the market the shopper happens to be browsing: somebody billed
     in rupees who switches the storefront to Kenya has not thereby been
     refunded in shillings. */
  currency: string
  payment_method: string
  email: string
  mfa_enabled: boolean
  active_sessions: number
  pwd_changed: string
  /* Which door they came through. It changes what this account can do — an
     account opened with an Aventa ID has no marketplace password to change —
     so it is recorded rather than inferred. */
  identity_source: 'self' | 'telco-sso'
  verified_by: string | null
  verified_at: string | null
  /* How the marketplace talks to this customer. Defaulted in the database rather
     than nullable, so every screen has an effective answer without inventing one. */
  preferred_language: string
  time_zone: string
  data_units: string
  /* Closure is scheduled, not immediate — 30 days' notice, withdrawable until then. */
  closure_requested_at: string | null
  closure_effective: string | null
  closure_reason: string | null
}

export interface ConsumerPaymentMethod {
  id: string
  kind: string
  detail: string
  holder: string
  expires: string | null
  is_primary: boolean
  status: string
  added: string
}

export interface ConsumerNotification {
  id: string
  name: string
  event: string
  channels: string[]
  who: string
  on_state: boolean
  last_sent: string | null
  severity: string
  mandatory: boolean
}

export interface ConsumerAuditEntry {
  id: string
  when_date: string
  action: string
  label: string
  category: string
  severity: string
  detail: string | null
}

export interface ConsumerHouseholdMember {
  id: string
  name: string
  email: string
  role_id: string
  role_name: string
  status: string
  last_active: string | null
  mfa: boolean
  joined: string
  cap: number | null
  spent: number
  is_you: boolean
}

export interface ConsumerBill {
  id: string
  period: string
  issued: string
  due: string
  plan_charge: number
  subscriptions: number
  oneoff: number
  /* The rate the tax below was charged at. Recorded rather than implied: a
     figure with no stated basis cannot be checked, which is how retail bills
     drifted to nine percent while every other document charged eighteen. */
  tax_rate: number
  tax: number
  total: number
  status: string
  paid_on: string | null
  pages: number
  /* The market the bill was raised in, the currency it is denominated in, and
     the rate it was struck at — all frozen when it was issued. A bill re-
     converted at today's rate stops matching the payment that settled it. */
  market?: string
  currency?: string
  fx_rate?: number
  fx_as_of?: string
}

export interface TicketMessage {
  who: string
  when: string
  text: string
}

export interface ConsumerTicket {
  id: string
  subject: string
  category: string
  severity: string
  status: string
  /* `opened` is not a column — support_tickets stores `opened_at`. The row is
     cast straight to this type, so anything named here that the table does not
     have arrives undefined. Kept optional so the screen has to say what it
     does when there is nothing to show. */
  opened?: string
  opened_at?: string
  opened_by: string
  channel: string
  owner: string | null
  sla_mins: number
  resolution_mins: number | null
  breached: boolean
  escalated: boolean
  messages: TicketMessage[]
  /* The consent record, the customer's side of it. 'resolved' is the desk
     saying it is fixed; nothing is over until this customer agrees or the
     window runs out. */
  resolution_note?: string | null
  confirm_due?: string | null
  confirmed_by?: string | null
  closed_how?: 'confirmed' | 'offline' | 'auto' | null
  reopened?: number
}

// ---------- Operator Console Types ----------

export interface OperatorProfile {
  /* The reporting currency these aggregates are expressed in. A rollup over
     orders placed in three currencies, already converted — not cash. */
  currency: string
  id: string
  operator_name: string
  gmv: number
  commission: number
  commission_rate: number
  active_partners: number
  pending_applications: number
  open_tickets: number
  sla_breaches: number
  settlement_due: number
  total_orders: number
  refund_requests: number
  dunning_cases: number
  churn_risk: number
  avg_order_value: number
  take_rate: number
  forecast_gmv: number
  forecast_commission: number
  forecast_accuracy: number
  updated_at: string
}

export interface OnboardingGate {
  id: string
  partner_id: string
  gate_name: string
  gate_order: number
  status: GateStatus
  owner: string
  target_days: number
  dual_control: boolean
  waivable: boolean
  submitted_by: string | null
  submitted_at: string | null
  reviewed_by: string | null
  reviewed_at: string | null
  evidence: string[]
  notes: string | null
  sort_order: number
  /* Joined from partners. Present whenever the row was selected with
     `*, partner:partners(id,name,status)`. */
  partner?: { id: string; name: string; status: string }
}

/* The record of the review that decided whether a listing could be sold — not a
   listing in itself. A listing *is* a product, and `products.status` is the
   lifecycle both sides read. The name, price, category and seller live on the
   product; this used to hold copies of all four, and they drifted.

   The working shape is `Submission` in lib/catalogue.ts; this alias is what the
   screens that only count rows still import. */
export interface OperatorListing {
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

export interface SettlementStatement {
  id: string
  partner_name: string
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
  /* What the statement is computed in — the reporting currency. Commission is a
     percentage of a figure the marketplace books, and it books in one currency
     so that a take rate means something across three markets. */
  currency: string
  /* And what the seller is actually paid in: their bank account's currency.
     Kestrel Devices banks with HDFC in Bengaluru, so its net is remitted in
     rupees however the statement was computed. Equal to `currency` where the
     account takes dollars, which nine of fifteen sellers' do. */
  payout_currency: string
  payout_net: number
  /* Frozen, not recomputed. A statement reprinted next year has to come out the
     same as the one the seller was paid against, so the rate and the date of
     the fix live on the row. Rate 1 where nothing was converted, rather than
     null — every row then reads the same way. */
  fx_rate: number
  fx_as_of: string
  submitted_at: string
  approved_by: string | null
  approved_at: string | null
  disputed: boolean
  sort_order: number
  partner_id: string | null
}

/* A stock line points at the product and the warehouse rather than naming them.
   The names, the seller and the category are read through the joins, because
   inventory is live state — there is nothing here worth snapshotting, and a
   stored copy is a copy that goes stale. */
export interface OperatorInventory {
  id: string
  product_id: string
  warehouse_id: string
  on_hand: number
  reserved: number
  /* Generated in the database as on_hand − reserved. Read only. */
  available: number
  reorder_point: number
  inbound: number
  inbound_due: string | null
  unit_cost: number
  last_count: string | null
  sort_order: number
  /* Present when the row was selected with the embeds below. */
  product?: { id: string; name: string; seller: string; category_id: string; price: number }
  warehouse?: { id: string; name: string; type: string; categories: string[] }
}

export interface OperatorWarehouse {
  id: string
  name: string
  type: string
  address: string
  timezone: string
  despatch_cutoff: string
  capacity: number
  utilisation: number
  categories: string[]
  countries: string[]
  system_name: string | null
  sync_mode: string
  sync_state: string
  last_sync: string | null
  tax_reg: string | null
  sort_order: number
}

export interface OperatorTicket {
  id: string
  subject: string
  category: string
  priority: string
  status: string
  opened_by: string
  org: string
  owner: string | null
  opened_at: string
  sla_mins: number
  response_mins: number | null
  resolution_mins: number | null
  breached: boolean
  escalated: boolean
  escalated_at: string | null
  waiting_on_customer: boolean
  messages: TicketMessage[]
  /* The consent record. 'resolved' means the desk has answered and is waiting
     to be told whether that was right; 'closed' means somebody said so, or the
     window ran out. The console shows which, because "closed because they
     agreed" and "closed because nobody replied" are not the same queue. */
  resolution_note: string | null
  confirm_due: string | null
  confirmed_by: string | null
  confirmed_at: string | null
  closed_how: 'confirmed' | 'offline' | 'auto' | null
  reopened: number
  sort_order: number
}

export interface OperatorAuditEntry {
  id: string
  when_ts: string
  actor: string
  role: string
  action: string
  object: string | null
  category: string
  severity: string
  before_val: string | null
  after_val: string | null
  outcome: string
  session_id: string | null
  hash: string | null
  prev_hash: string | null
}

export interface OperatorApi {
  id: string
  name: string
  standard: string
  audience: string
  description: string
  why: string
  scopes: string[]
  methods: string[]
  environments: string[]
  lifecycle: string
  version: string
  subscriber_count: number
  sort_order: number
}

export interface OperatorApiSubscription {
  id: string
  api_id: string
  consumer_name: string
  version: string
  environment: string
  scopes: string[]
  volume: number
  started_at: string
  status: string
  sort_order: number
}

export interface OperatorRole {
  id: string
  name: string
  description: string
  is_builtin: boolean
  assigned_count: number
  audit_categories: string[]
  capabilities: Record<string, string>
  sort_order: number
}

export interface OperatorUser {
  id: string
  name: string
  email: string
  role_id: string
  role_name: string
  status: string
  last_active: string | null
  mfa_enabled: boolean
  joined_at: string
  sort_order: number
}

export interface OperatorPromotion {
  /* What the discount, the minimum basket and the budget are in. A promotion is
     an offer to a customer, so it is the market's currency and not the
     marketplace's reporting one. */
  currency: string
  id: string
  name: string
  description: string
  effect_type: string
  effect_value: number
  conditions: Record<string, unknown>
  stacking: boolean
  priority: number
  budget: number
  spent: number
  status: string
  starts_at: string | null
  ends_at: string | null
  sort_order: number
}

export interface OperatorDunningCase {
  id: string
  account_name: string
  account_type: string
  amount: number
  age_days: number
  step: number
  step_name: string
  ladder: string
  attempts: number
  reason: string
  collector: string | null
  promise_to_pay: string | null
  status: string
  sort_order: number
}

export interface OperatorChannel {
  id: string
  name: string
  type: string
  transport: string
  protocol: string
  sender: string
  throughput: number
  /* What a message costs is not one number. It is a rate per destination in the
     currency the carrier bills in, and it lives in `channel_rate` — see the
     Rates action on this screen. A `unit_cost` column here would be a second
     answer to the same question. */
  success_rate: number
  region: string
  has_receipt: boolean
  is_primary: boolean
  enabled: boolean
  note: string | null
  sort_order: number
}

export interface OperatorBanner {
  id: string
  slot: string
  title: string
  subtitle: string | null
  cta: string
  audience: string
  region: string
  device: string
  weight: number
  impressions: number
  clicks: number
  revenue: number
  status: string
  starts_at: string | null
  ends_at: string | null
  sort_order: number
}

export type { Endpoint, TestCall, SandboxRun, GateRow, TaskRow, TechStatus, TechCheck, Gate, ClearVerdict } from '../lib/onboarding'
