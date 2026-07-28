/*
# Create Consumer Account Section (§4.53 — account, notifications, activity, household, refunds)

1. New Tables
- `consumer_profile` — single row: the logged-in shopper's name, ID, phone, city, tier, wallet, points, payment method
- `consumer_notifications` — alert topics with per-channel toggles (Push/Email/SMS), mandatory flag, severity
- `consumer_audit_log` — every action on the account: purchases, cap changes, password changes, etc.
- `consumer_household` — people sharing the account with roles, spend caps, status
- `consumer_refunds` — refund requests linked to orders with state, amount, reason, decision

2. Security
- All tables: RLS with `TO anon, authenticated` (single-tenant, no-auth storefront).
- Full CRUD on all tables so the app can toggle notification channels, update profile, etc.

3. Notes
- `consumer_notifications.mandatory` locks the topic on (price changes, delivery failures).
- `consumer_household.role_id` maps to consumer roles: CO-OWNER, CO-ADULT, CO-YOUNG, CO-VIEW.
- `consumer_audit_log` cannot be deleted — it is the immutable record of the account.
- Seed data mirrors the old prototype exactly.
*/

-- Profile
CREATE TABLE IF NOT EXISTS consumer_profile (
  id text PRIMARY KEY DEFAULT 'me',
  name text NOT NULL DEFAULT 'Priya Raman',
  customer_id text NOT NULL DEFAULT 'CUS-449021',
  msisdn text NOT NULL DEFAULT '+91 98860 41127',
  city text NOT NULL DEFAULT 'Bengaluru',
  since text NOT NULL DEFAULT 'Customer since Jun 2024',
  tier text NOT NULL DEFAULT 'Gold',
  wallet numeric NOT NULL DEFAULT 42.60,
  points numeric NOT NULL DEFAULT 3180,
  payment_method text NOT NULL DEFAULT 'Bill to mobile · card ending 4419',
  email text NOT NULL DEFAULT 'priya.raman@6dtech.co.in'
);
INSERT INTO consumer_profile (id) VALUES ('me') ON CONFLICT (id) DO NOTHING;

-- Notifications
CREATE TABLE IF NOT EXISTS consumer_notifications (
  id text PRIMARY KEY,
  name text NOT NULL,
  event text NOT NULL,
  channels text[] NOT NULL DEFAULT '{}',
  who text NOT NULL DEFAULT 'You',
  on_state boolean NOT NULL DEFAULT true,
  last_sent text,
  severity text NOT NULL DEFAULT 'normal',
  mandatory boolean NOT NULL DEFAULT false
);

-- Audit log
CREATE TABLE IF NOT EXISTS consumer_audit_log (
  id text PRIMARY KEY,
  when_date text NOT NULL,
  action text NOT NULL,
  label text NOT NULL,
  category text NOT NULL DEFAULT 'Account',
  severity text NOT NULL DEFAULT 'info',
  detail text
);

-- Household
CREATE TABLE IF NOT EXISTS consumer_household (
  id text PRIMARY KEY,
  name text NOT NULL,
  email text NOT NULL,
  role_id text NOT NULL,
  role_name text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  last_active text,
  mfa boolean NOT NULL DEFAULT false,
  joined text NOT NULL,
  cap numeric,
  spent numeric NOT NULL DEFAULT 0,
  is_you boolean NOT NULL DEFAULT false
);

-- Refunds
CREATE TABLE IF NOT EXISTS consumer_refunds (
  id text PRIMARY KEY,
  order_ref text NOT NULL,
  item text NOT NULL,
  seller text NOT NULL,
  amount numeric NOT NULL,
  reason text NOT NULL,
  state text NOT NULL DEFAULT 'pending',
  decided text,
  note text
);

-- Enable RLS
ALTER TABLE consumer_profile ENABLE ROW LEVEL SECURITY;
ALTER TABLE consumer_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE consumer_audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE consumer_household ENABLE ROW LEVEL SECURITY;
ALTER TABLE consumer_refunds ENABLE ROW LEVEL SECURITY;

-- Policies: profile (full CRUD)
DROP POLICY IF EXISTS "anon_crud_consumer_profile" ON consumer_profile;
CREATE POLICY "anon_select_consumer_profile" ON consumer_profile FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "anon_insert_consumer_profile" ON consumer_profile FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "anon_update_consumer_profile" ON consumer_profile FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "anon_delete_consumer_profile" ON consumer_profile FOR DELETE TO anon, authenticated USING (true);

-- Policies: notifications (full CRUD)
CREATE POLICY "anon_select_consumer_notifications" ON consumer_notifications FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "anon_insert_consumer_notifications" ON consumer_notifications FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "anon_update_consumer_notifications" ON consumer_notifications FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "anon_delete_consumer_notifications" ON consumer_notifications FOR DELETE TO anon, authenticated USING (true);

-- Policies: audit log (select + insert only — no delete, no update)
CREATE POLICY "anon_select_consumer_audit_log" ON consumer_audit_log FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "anon_insert_consumer_audit_log" ON consumer_audit_log FOR INSERT TO anon, authenticated WITH CHECK (true);

-- Policies: household (full CRUD)
CREATE POLICY "anon_select_consumer_household" ON consumer_household FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "anon_insert_consumer_household" ON consumer_household FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "anon_update_consumer_household" ON consumer_household FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "anon_delete_consumer_household" ON consumer_household FOR DELETE TO anon, authenticated USING (true);

-- Policies: refunds (select + insert + update)
CREATE POLICY "anon_select_consumer_refunds" ON consumer_refunds FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "anon_insert_consumer_refunds" ON consumer_refunds FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "anon_update_consumer_refunds" ON consumer_refunds FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);

-- Seed: notifications
INSERT INTO consumer_notifications (id, name, event, channels, who, on_state, last_sent, severity, mandatory) VALUES
('NR-C1', 'Order and delivery updates', 'Every time an order changes stage', ARRAY['Push','SMS'], 'You', true, '20 min ago', 'normal', false),
('NR-C2', 'Delivery problem', 'A delivery attempt fails or is delayed', ARRAY['Push','SMS','Email'], 'You', true, '2 h ago', 'high', true),
('NR-C3', 'Before a subscription renews', '3 days before any subscription renews', ARRAY['Push','Email'], 'You', true, 'Yesterday', 'normal', false),
('NR-C4', 'Price change on a subscription', 'A seller changes the price of something you hold', ARRAY['Email'], 'You', true, 'Never', 'high', true),
('NR-C5', 'A household member asks to buy', 'Someone on your account needs your approval', ARRAY['Push'], 'Account owner', true, '4 d ago', 'normal', false),
('NR-C6', 'Spend cap reached', 'A member reaches their monthly cap', ARRAY['Push','Email'], 'Account owner', true, '2 w ago', 'normal', false),
('NR-C7', 'Bill ready', 'Your monthly bill is issued', ARRAY['Push','Email'], 'You', true, '01 Jul', 'normal', false),
('NR-C8', 'Offers and recommendations', 'Deals picked from what you already have', ARRAY['Push','Email'], 'You', false, 'Never', 'low', false)
ON CONFLICT (id) DO NOTHING;

-- Seed: audit log
INSERT INTO consumer_audit_log (id, when_date, action, label, category, severity, detail) VALUES
('AUD-CU-9001', '25 Jul 2026 14:22', 'order.placed', 'Order placed — ORD-881433', 'Orders', 'info', 'Aegis Screen Cover — $140.00'),
('AUD-CU-9002', '25 Jul 2026 11:05', 'reward.redeemed', 'Redeemed 1500 points for wallet credit', 'Rewards', 'info', '$15.00 added to wallet'),
('AUD-CU-9003', '24 Jul 2026 09:30', 'order.delivered', 'Order ORD-881311 delivered', 'Orders', 'info', 'PlayForge Season Pass'),
('AUD-CU-9004', '22 Jul 2026 16:14', 'notif.channel', 'Delivery problem — added Email channel', 'Notifications', 'info', 'Channels changed by the account holder'),
('AUD-CU-9005', '19 Jul 2026 10:00', 'order.refunded', 'Order ORD-881204 refunded', 'Orders', 'warning', 'Kestrel K7 handset — $389.00 returned'),
('AUD-CU-9006', '12 Jul 2026 08:45', 'reward.bonus', 'Goodwill bonus of 500 points', 'Rewards', 'info', 'After delivery failure on ORD-880912'),
('AUD-CU-9007', '04 Jul 2026 13:20', 'order.placed', 'Order placed — ORD-880788', 'Orders', 'info', 'Kestrel launch window — 3x earn'),
('AUD-CU-9008', '28 Jun 2026 00:00', 'reward.expired', '320 points expired', 'Rewards', 'warning', 'Earned Jun 2024, unredeemed at 24 months'),
('AUD-CU-9009', '21 Jun 2026 15:30', 'reward.redeemed', 'Redeemed 2400 points for seller voucher', 'Rewards', 'info', 'StreamNova Media — $28.80'),
('AUD-CU-9010', '02 Feb 2025 10:00', 'household.added', 'Aditi Raman added to the account', 'Household', 'info', 'Role: Young person, cap $15/month'),
('AUD-CU-9011', '14 Jun 2024 09:00', 'account.created', 'Account created', 'Account', 'info', 'Welcome to Aventa Marketplace')
ON CONFLICT (id) DO NOTHING;

-- Seed: household
INSERT INTO consumer_household (id, name, email, role_id, role_name, status, last_active, mfa, joined, cap, spent, is_you) VALUES
('CU-01', 'Priya Raman', 'priya.raman@6dtech.co.in', 'CO-OWNER', 'Account owner', 'active', 'Now', true, '14 Jun 2024', null, 0, true),
('CU-02', 'Vikram Raman', 'v.raman@gmail.com', 'CO-ADULT', 'Adult member', 'active', '1 h ago', true, '14 Jun 2024', 40, 22.99, false),
('CU-03', 'Aditi Raman', 'aditi.r@gmail.com', 'CO-YOUNG', 'Young person', 'active', 'Yesterday', false, '02 Feb 2025', 15, 9.99, false),
('CU-04', 'Lakshmi Raman', 'l.raman@gmail.com', 'CO-VIEW', 'View only', 'active', '1 w ago', false, '02 Feb 2025', 0, 0, false),
('CU-05', 'Rohan Raman', 'rohan.r@gmail.com', 'CO-YOUNG', 'Young person', 'invited', 'Never', false, '24 Jul 2026', 15, 0, false)
ON CONFLICT (id) DO NOTHING;

-- Seed: refunds
INSERT INTO consumer_refunds (id, order_ref, item, seller, amount, reason, state, decided, note) VALUES
('RFN-3201', 'ORD-881204', 'Kestrel K7 handset', 'Kestrel Devices', 389.00, 'Device arrived with a cracked screen', 'refunded', '19 Jul 2026', 'Full refund — seller accepted fault'),
('RFN-3202', 'ORD-880912', 'Aegis Screen Cover', 'Aegis Assurance', 18.00, 'Delivery failure — item never arrived', 'refunded', '12 Jul 2026', 'Refund issued plus 500 goodwill points'),
('RFN-3203', 'ORD-881044', 'Nimbus sensor pack', 'Nimbus Sensors', 42.00, 'Order returned within 14-day window', 'refunded', '02 Jul 2026', 'Points reversed with the refund'),
('RFN-3204', 'ORD-880788', 'Kestrel K7 handset (2nd)', 'Kestrel Devices', 389.00, 'Wrong colour delivered', 'partial', 'Pending review', 'Seller offered $50 credit, buyer wants full refund'),
('RFN-3205', 'ORD-880451', 'Travel Cover Lite', 'Aegis Assurance', 12.99, 'Subscription cancelled within cooling-off', 'pending', null, 'Awaiting seller response')
ON CONFLICT (id) DO NOTHING;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_consumer_audit_when ON consumer_audit_log(when_date);
CREATE INDEX IF NOT EXISTS idx_consumer_refunds_state ON consumer_refunds(state);
