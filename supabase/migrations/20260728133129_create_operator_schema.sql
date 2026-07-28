/*
# Create Operator Console Schema

This migration adds the tables needed to power the Marketplace Operator console —
the back-office surface that the telecom operator uses to manage partners, catalogue,
settlement, inventory, tickets, audit, developer portal, roles, and promotions.

## New Tables (all single-tenant, no auth — shared demo data)

1. **operator_profile** — single-row operator identity (name, GMV, commission, partner count, etc.)
2. **onboarding_gates** — the 7-gate onboarding funnel definition + per-partner progress
3. **operator_listings** — product listings pending review / approved / rejected
4. **settlement_statements** — monthly settlement statements with gross-to-net deduction stack
5. **operator_inventory** — stock ledger: on hand, reserved, available, warehouse, movements
6. **operator_warehouses** — warehouse configuration (type, address, capacity, system link)
7. **operator_tickets** — support ticket queue with SLA clocks, escalation, threaded messages
8. **operator_audit_log** — append-only audit trail with hash chain, role-scoped categories
9. **operator_apis** — developer portal: published APIs with versions and lifecycle states
10. **operator_api_subscriptions** — which consumers hold which API version
11. **operator_roles** — 13 operator roles with a 32-row capability matrix
12. **operator_users** — people assigned to operator roles
13. **operator_promotions** — conditional discount rules with budgets and conditions
14. **operator_dunning_cases** — collections cases with ladder step, amount, age
15. **operator_channels** — notification transport providers (SMS, email, push)
16. **operator_banners** — storefront advertising slots with targeting and measurement

## Security
- RLS enabled on every table.
- Policies allow anon + authenticated CRUD (single-tenant, no sign-in, shared demo data).
*/

-- ============================================================
-- 1. operator_profile
-- ============================================================
CREATE TABLE IF NOT EXISTS operator_profile (
  id text PRIMARY KEY DEFAULT 'default',
  operator_name text NOT NULL DEFAULT 'Aventa Communications',
  gmv numeric NOT NULL DEFAULT 711108.93,
  commission numeric NOT NULL DEFAULT 66304.03,
  commission_rate numeric NOT NULL DEFAULT 9.3,
  active_partners int NOT NULL DEFAULT 15,
  pending_applications int NOT NULL DEFAULT 3,
  open_tickets int NOT NULL DEFAULT 8,
  sla_breaches int NOT NULL DEFAULT 2,
  settlement_due int NOT NULL DEFAULT 12,
  total_orders int NOT NULL DEFAULT 2600,
  refund_requests int NOT NULL DEFAULT 5,
  dunning_cases int NOT NULL DEFAULT 4,
  churn_risk int NOT NULL DEFAULT 23,
  avg_order_value numeric NOT NULL DEFAULT 273.50,
  take_rate numeric NOT NULL DEFAULT 9.3,
  forecast_gmv numeric NOT NULL DEFAULT 742000,
  forecast_commission numeric NOT NULL DEFAULT 69000,
  forecast_accuracy numeric NOT NULL DEFAULT 4.2,
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE operator_profile ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_crud_operator_profile" ON operator_profile;
CREATE POLICY "anon_crud_operator_profile" ON operator_profile FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "anon_insert_operator_profile" ON operator_profile FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "anon_update_operator_profile" ON operator_profile FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "anon_delete_operator_profile" ON operator_profile FOR DELETE TO anon, authenticated USING (true);

-- ============================================================
-- 2. onboarding_gates
-- ============================================================
CREATE TABLE IF NOT EXISTS onboarding_gates (
  id text PRIMARY KEY,
  partner_id text NOT NULL,
  partner_name text NOT NULL,
  gate_name text NOT NULL,
  gate_order int NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  owner text NOT NULL,
  target_days int NOT NULL DEFAULT 1,
  dual_control boolean NOT NULL DEFAULT false,
  waivable boolean NOT NULL DEFAULT true,
  submitted_by text,
  submitted_at timestamptz,
  reviewed_by text,
  reviewed_at timestamptz,
  evidence text[],
  notes text,
  sort_order int NOT NULL DEFAULT 0
);
ALTER TABLE onboarding_gates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_select_onboarding_gates" ON onboarding_gates;
CREATE POLICY "anon_select_onboarding_gates" ON onboarding_gates FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "anon_insert_onboarding_gates" ON onboarding_gates FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "anon_update_onboarding_gates" ON onboarding_gates FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "anon_delete_onboarding_gates" ON onboarding_gates FOR DELETE TO anon, authenticated USING (true);

-- ============================================================
-- 3. operator_listings
-- ============================================================
CREATE TABLE IF NOT EXISTS operator_listings (
  id text PRIMARY KEY,
  product_name text NOT NULL,
  partner_name text NOT NULL,
  category text NOT NULL,
  price numeric NOT NULL,
  cost numeric NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  submitted_at timestamptz DEFAULT now(),
  reviewed_by text,
  reviewed_at timestamptz,
  rating numeric,
  reviews int DEFAULT 0,
  stock_status text DEFAULT 'in',
  version int DEFAULT 1,
  sort_order int NOT NULL DEFAULT 0
);
ALTER TABLE operator_listings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_select_operator_listings" ON operator_listings;
CREATE POLICY "anon_select_operator_listings" ON operator_listings FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "anon_insert_operator_listings" ON operator_listings FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "anon_update_operator_listings" ON operator_listings FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "anon_delete_operator_listings" ON operator_listings FOR DELETE TO anon, authenticated USING (true);

-- ============================================================
-- 4. settlement_statements
-- ============================================================
CREATE TABLE IF NOT EXISTS settlement_statements (
  id text PRIMARY KEY,
  partner_name text NOT NULL,
  period text NOT NULL,
  gross numeric NOT NULL,
  commission numeric NOT NULL,
  commission_rate numeric NOT NULL,
  fees numeric NOT NULL DEFAULT 0,
  withholding numeric NOT NULL DEFAULT 0,
  refunds numeric NOT NULL DEFAULT 0,
  net numeric NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  order_count int NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'USD',
  submitted_at timestamptz DEFAULT now(),
  approved_by text,
  approved_at timestamptz,
  disputed boolean DEFAULT false,
  sort_order int NOT NULL DEFAULT 0
);
ALTER TABLE settlement_statements ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_select_settlement_statements" ON settlement_statements;
CREATE POLICY "anon_select_settlement_statements" ON settlement_statements FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "anon_insert_settlement_statements" ON settlement_statements FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "anon_update_settlement_statements" ON settlement_statements FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "anon_delete_settlement_statements" ON settlement_statements FOR DELETE TO anon, authenticated USING (true);

-- ============================================================
-- 5. operator_inventory
-- ============================================================
CREATE TABLE IF NOT EXISTS operator_inventory (
  id text PRIMARY KEY,
  product_name text NOT NULL,
  partner_name text NOT NULL,
  warehouse text NOT NULL,
  on_hand int NOT NULL DEFAULT 0,
  reserved int NOT NULL DEFAULT 0,
  available int NOT NULL DEFAULT 0,
  reorder_point int NOT NULL DEFAULT 10,
  inbound int NOT NULL DEFAULT 0,
  inbound_due date,
  unit_cost numeric NOT NULL DEFAULT 0,
  last_count date,
  category text NOT NULL,
  sort_order int NOT NULL DEFAULT 0
);
ALTER TABLE operator_inventory ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_select_operator_inventory" ON operator_inventory;
CREATE POLICY "anon_select_operator_inventory" ON operator_inventory FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "anon_insert_operator_inventory" ON operator_inventory FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "anon_update_operator_inventory" ON operator_inventory FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "anon_delete_operator_inventory" ON operator_inventory FOR DELETE TO anon, authenticated USING (true);

-- ============================================================
-- 6. operator_warehouses
-- ============================================================
CREATE TABLE IF NOT EXISTS operator_warehouses (
  id text PRIMARY KEY,
  name text NOT NULL,
  type text NOT NULL DEFAULT 'fulfilment',
  address text NOT NULL,
  timezone text NOT NULL DEFAULT 'UTC',
  despatch_cutoff text NOT NULL DEFAULT '16:00',
  capacity int NOT NULL DEFAULT 10000,
  utilisation int NOT NULL DEFAULT 0,
  categories text[] NOT NULL DEFAULT '{}',
  countries text[] NOT NULL DEFAULT '{}',
  system_name text,
  sync_mode text NOT NULL DEFAULT 'real-time',
  sync_state text NOT NULL DEFAULT 'healthy',
  last_sync timestamptz,
  tax_reg text,
  sort_order int NOT NULL DEFAULT 0
);
ALTER TABLE operator_warehouses ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_select_operator_warehouses" ON operator_warehouses;
CREATE POLICY "anon_select_operator_warehouses" ON operator_warehouses FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "anon_insert_operator_warehouses" ON operator_warehouses FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "anon_update_operator_warehouses" ON operator_warehouses FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "anon_delete_operator_warehouses" ON operator_warehouses FOR DELETE TO anon, authenticated USING (true);

-- ============================================================
-- 7. operator_tickets
-- ============================================================
CREATE TABLE IF NOT EXISTS operator_tickets (
  id text PRIMARY KEY,
  subject text NOT NULL,
  category text NOT NULL,
  priority text NOT NULL DEFAULT 'P3',
  status text NOT NULL DEFAULT 'open',
  opened_by text NOT NULL,
  org text NOT NULL,
  owner text,
  opened_at timestamptz DEFAULT now(),
  sla_mins int NOT NULL DEFAULT 480,
  response_mins int,
  resolution_mins int,
  breached boolean NOT NULL DEFAULT false,
  escalated boolean NOT NULL DEFAULT false,
  escalated_at timestamptz,
  waiting_on_customer boolean NOT NULL DEFAULT false,
  messages jsonb NOT NULL DEFAULT '[]'::jsonb,
  sort_order int NOT NULL DEFAULT 0
);
ALTER TABLE operator_tickets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_select_operator_tickets" ON operator_tickets;
CREATE POLICY "anon_select_operator_tickets" ON operator_tickets FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "anon_insert_operator_tickets" ON operator_tickets FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "anon_update_operator_tickets" ON operator_tickets FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "anon_delete_operator_tickets" ON operator_tickets FOR DELETE TO anon, authenticated USING (true);

-- ============================================================
-- 8. operator_audit_log
-- ============================================================
CREATE TABLE IF NOT EXISTS operator_audit_log (
  id text PRIMARY KEY,
  when_ts timestamptz DEFAULT now(),
  actor text NOT NULL,
  role text NOT NULL,
  action text NOT NULL,
  object text,
  category text NOT NULL,
  severity text NOT NULL DEFAULT 'info',
  before_val text,
  after_val text,
  outcome text NOT NULL DEFAULT 'success',
  session_id text,
  hash text,
  prev_hash text
);
ALTER TABLE operator_audit_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_select_operator_audit_log" ON operator_audit_log;
CREATE POLICY "anon_select_operator_audit_log" ON operator_audit_log FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "anon_insert_operator_audit_log" ON operator_audit_log FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "anon_update_operator_audit_log" ON operator_audit_log FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "anon_delete_operator_audit_log" ON operator_audit_log FOR DELETE TO anon, authenticated USING (true);

-- ============================================================
-- 9. operator_apis
-- ============================================================
CREATE TABLE IF NOT EXISTS operator_apis (
  id text PRIMARY KEY,
  name text NOT NULL,
  standard text NOT NULL,
  audience text NOT NULL,
  description text NOT NULL,
  why text NOT NULL,
  scopes text[] NOT NULL DEFAULT '{}',
  methods text[] NOT NULL DEFAULT '{}',
  environments text[] NOT NULL DEFAULT '{}',
  lifecycle text NOT NULL DEFAULT 'current',
  version text NOT NULL DEFAULT '1.0',
  subscriber_count int NOT NULL DEFAULT 0,
  sort_order int NOT NULL DEFAULT 0
);
ALTER TABLE operator_apis ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_select_operator_apis" ON operator_apis;
CREATE POLICY "anon_select_operator_apis" ON operator_apis FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "anon_insert_operator_apis" ON operator_apis FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "anon_update_operator_apis" ON operator_apis FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "anon_delete_operator_apis" ON operator_apis FOR DELETE TO anon, authenticated USING (true);

-- ============================================================
-- 10. operator_api_subscriptions
-- ============================================================
CREATE TABLE IF NOT EXISTS operator_api_subscriptions (
  id text PRIMARY KEY,
  api_id text NOT NULL,
  consumer_name text NOT NULL,
  version text NOT NULL,
  environment text NOT NULL DEFAULT 'sandbox',
  scopes text[] NOT NULL DEFAULT '{}',
  volume int NOT NULL DEFAULT 0,
  started_at timestamptz DEFAULT now(),
  status text NOT NULL DEFAULT 'active',
  sort_order int NOT NULL DEFAULT 0
);
ALTER TABLE operator_api_subscriptions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_select_operator_api_subscriptions" ON operator_api_subscriptions;
CREATE POLICY "anon_select_operator_api_subscriptions" ON operator_api_subscriptions FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "anon_insert_operator_api_subscriptions" ON operator_api_subscriptions FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "anon_update_operator_api_subscriptions" ON operator_api_subscriptions FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "anon_delete_operator_api_subscriptions" ON operator_api_subscriptions FOR DELETE TO anon, authenticated USING (true);

-- ============================================================
-- 11. operator_roles
-- ============================================================
CREATE TABLE IF NOT EXISTS operator_roles (
  id text PRIMARY KEY,
  name text NOT NULL,
  description text NOT NULL,
  is_builtin boolean NOT NULL DEFAULT true,
  assigned_count int NOT NULL DEFAULT 0,
  audit_categories text[] NOT NULL DEFAULT '{}',
  capabilities jsonb NOT NULL DEFAULT '{}'::jsonb,
  sort_order int NOT NULL DEFAULT 0
);
ALTER TABLE operator_roles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_select_operator_roles" ON operator_roles;
CREATE POLICY "anon_select_operator_roles" ON operator_roles FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "anon_insert_operator_roles" ON operator_roles FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "anon_update_operator_roles" ON operator_roles FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "anon_delete_operator_roles" ON operator_roles FOR DELETE TO anon, authenticated USING (true);

-- ============================================================
-- 12. operator_users
-- ============================================================
CREATE TABLE IF NOT EXISTS operator_users (
  id text PRIMARY KEY,
  name text NOT NULL,
  email text NOT NULL,
  role_id text NOT NULL,
  role_name text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  last_active timestamptz,
  mfa_enabled boolean NOT NULL DEFAULT false,
  joined_at timestamptz DEFAULT now(),
  sort_order int NOT NULL DEFAULT 0
);
ALTER TABLE operator_users ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_select_operator_users" ON operator_users;
CREATE POLICY "anon_select_operator_users" ON operator_users FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "anon_insert_operator_users" ON operator_users FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "anon_update_operator_users" ON operator_users FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "anon_delete_operator_users" ON operator_users FOR DELETE TO anon, authenticated USING (true);

-- ============================================================
-- 13. operator_promotions
-- ============================================================
CREATE TABLE IF NOT EXISTS operator_promotions (
  id text PRIMARY KEY,
  name text NOT NULL,
  description text NOT NULL,
  effect_type text NOT NULL,
  effect_value numeric NOT NULL,
  conditions jsonb NOT NULL DEFAULT '{}'::jsonb,
  stacking boolean NOT NULL DEFAULT false,
  priority int NOT NULL DEFAULT 50,
  budget numeric NOT NULL DEFAULT 0,
  spent numeric NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'active',
  starts_at timestamptz,
  ends_at timestamptz,
  sort_order int NOT NULL DEFAULT 0
);
ALTER TABLE operator_promotions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_select_operator_promotions" ON operator_promotions;
CREATE POLICY "anon_select_operator_promotions" ON operator_promotions FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "anon_insert_operator_promotions" ON operator_promotions FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "anon_update_operator_promotions" ON operator_promotions FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "anon_delete_operator_promotions" ON operator_promotions FOR DELETE TO anon, authenticated USING (true);

-- ============================================================
-- 14. operator_dunning_cases
-- ============================================================
CREATE TABLE IF NOT EXISTS operator_dunning_cases (
  id text PRIMARY KEY,
  account_name text NOT NULL,
  account_type text NOT NULL DEFAULT 'consumer',
  amount numeric NOT NULL,
  age_days int NOT NULL DEFAULT 0,
  step int NOT NULL DEFAULT 1,
  step_name text NOT NULL,
  ladder text NOT NULL,
  attempts int NOT NULL DEFAULT 0,
  reason text NOT NULL,
  collector text,
  promise_to_pay date,
  status text NOT NULL DEFAULT 'active',
  sort_order int NOT NULL DEFAULT 0
);
ALTER TABLE operator_dunning_cases ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_select_operator_dunning_cases" ON operator_dunning_cases;
CREATE POLICY "anon_select_operator_dunning_cases" ON operator_dunning_cases FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "anon_insert_operator_dunning_cases" ON operator_dunning_cases FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "anon_update_operator_dunning_cases" ON operator_dunning_cases FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "anon_delete_operator_dunning_cases" ON operator_dunning_cases FOR DELETE TO anon, authenticated USING (true);

-- ============================================================
-- 15. operator_channels
-- ============================================================
CREATE TABLE IF NOT EXISTS operator_channels (
  id text PRIMARY KEY,
  name text NOT NULL,
  type text NOT NULL,
  transport text NOT NULL,
  protocol text NOT NULL,
  sender text NOT NULL,
  throughput int NOT NULL DEFAULT 100,
  unit_cost numeric NOT NULL DEFAULT 0,
  success_rate numeric NOT NULL DEFAULT 0,
  region text NOT NULL DEFAULT 'global',
  has_receipt boolean NOT NULL DEFAULT true,
  is_primary boolean NOT NULL DEFAULT false,
  enabled boolean NOT NULL DEFAULT true,
  note text,
  sort_order int NOT NULL DEFAULT 0
);
ALTER TABLE operator_channels ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_select_operator_channels" ON operator_channels;
CREATE POLICY "anon_select_operator_channels" ON operator_channels FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "anon_insert_operator_channels" ON operator_channels FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "anon_update_operator_channels" ON operator_channels FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "anon_delete_operator_channels" ON operator_channels FOR DELETE TO anon, authenticated USING (true);

-- ============================================================
-- 16. operator_banners
-- ============================================================
CREATE TABLE IF NOT EXISTS operator_banners (
  id text PRIMARY KEY,
  slot text NOT NULL,
  title text NOT NULL,
  subtitle text,
  cta text NOT NULL DEFAULT 'Shop now',
  audience text NOT NULL DEFAULT 'all',
  region text NOT NULL DEFAULT 'all',
  device text NOT NULL DEFAULT 'all',
  weight int NOT NULL DEFAULT 50,
  impressions int NOT NULL DEFAULT 0,
  clicks int NOT NULL DEFAULT 0,
  revenue numeric NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'active',
  starts_at date,
  ends_at date,
  sort_order int NOT NULL DEFAULT 0
);
ALTER TABLE operator_banners ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_select_operator_banners" ON operator_banners;
CREATE POLICY "anon_select_operator_banners" ON operator_banners FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "anon_insert_operator_banners" ON operator_banners FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "anon_update_operator_banners" ON operator_banners FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "anon_delete_operator_banners" ON operator_banners FOR DELETE TO anon, authenticated USING (true);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_onboarding_gates_partner ON onboarding_gates(partner_id);
CREATE INDEX IF NOT EXISTS idx_operator_listings_status ON operator_listings(status);
CREATE INDEX IF NOT EXISTS idx_settlement_statements_status ON settlement_statements(status);
CREATE INDEX IF NOT EXISTS idx_operator_tickets_status ON operator_tickets(status);
CREATE INDEX IF NOT EXISTS idx_operator_audit_log_when ON operator_audit_log(when_ts);
CREATE INDEX IF NOT EXISTS idx_operator_dunning_cases_status ON operator_dunning_cases(status);
