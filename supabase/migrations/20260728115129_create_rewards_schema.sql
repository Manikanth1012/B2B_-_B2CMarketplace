/*
# Create Rewards / Loyalty Programme Schema (§4.53)

1. New Tables
- `loyalty_programme` — single row defining the programme (name, conversion rate, expiry window, breakage, liability account)
- `loyalty_tiers` — four tiers with qualifying spend thresholds and earn multipliers
- `loyalty_earn_rules` — earn rules naming a funder (marketplace, seller, or shared split), scope, rate, caps, audience, status
- `loyalty_redeem_options` — redemption catalogue: kind, minimum, step, value rate, funder, audience, status
- `loyalty_members` — consumer and enterprise member accounts with balance, tier, qualifying spend, lifetime totals
- `loyalty_ledger` — every earn, bonus, redemption, expiry, reversal and adjustment with money value, funder and seller attribution

2. Security
- All tables use RLS with `TO anon, authenticated` (single-tenant, no-auth storefront).
- Read-only tables (programme, tiers, earn_rules, redeem_options) get SELECT-only policies.
- Members and ledger get full CRUD for anon (the app reads and writes balances on redemption).

3. Notes
- `loyalty_ledger.value` is the money worth of each movement, derived from `|points| / perUnit`.
- `loyalty_ledger.funder` carries who paid for the points on that row, so a seller's cost report does not depend on an order lookup.
- `loyalty_members.expiring_soon` / `expiring_on` track points within 90 days of expiry.
- Seed data mirrors the old prototype exactly so the rewards screen has real content.
*/

-- Programme (single row)
CREATE TABLE IF NOT EXISTS loyalty_programme (
  id text PRIMARY KEY DEFAULT 'default',
  name text NOT NULL DEFAULT 'Aventa Rewards',
  unit text NOT NULL DEFAULT 'points',
  per_unit numeric NOT NULL DEFAULT 100,
  min_redeem numeric NOT NULL DEFAULT 100,
  expiry_months int NOT NULL DEFAULT 24,
  rounding_note text NOT NULL DEFAULT 'Points are earned on the net amount after discount and before tax, rounded down.',
  breakage numeric NOT NULL DEFAULT 0.185,
  breakage_basis text NOT NULL DEFAULT 'Observed on points issued Jul 2024 – Jun 2025 and now past expiry',
  liability_account text NOT NULL DEFAULT '2040',
  funding_note text NOT NULL DEFAULT 'Every earn rule names who pays for the points it issues.',
  status text NOT NULL DEFAULT 'live',
  launched text NOT NULL DEFAULT 'Mar 2024'
);

INSERT INTO loyalty_programme (id) VALUES ('default')
  ON CONFLICT (id) DO NOTHING;

-- Tiers
CREATE TABLE IF NOT EXISTS loyalty_tiers (
  id text PRIMARY KEY,
  name text NOT NULL,
  sort_order int NOT NULL,
  qualify_spend numeric NOT NULL DEFAULT 0,
  multiplier numeric NOT NULL DEFAULT 1.0,
  colour text NOT NULL DEFAULT '#8D6E63',
  benefits text[] NOT NULL DEFAULT '{}',
  note text
);

-- Earn rules
CREATE TABLE IF NOT EXISTS loyalty_earn_rules (
  id text PRIMARY KEY,
  name text NOT NULL,
  scope text NOT NULL,
  scope_id text,
  rate numeric NOT NULL DEFAULT 1.0,
  funder text NOT NULL,
  split numeric,
  status text NOT NULL DEFAULT 'active',
  "from" text,
  "to" text,
  cap_per_order numeric,
  cap_per_month numeric,
  audience text NOT NULL DEFAULT 'all',
  bonus numeric,
  first_only boolean DEFAULT false,
  why text
);

-- Redeem options
CREATE TABLE IF NOT EXISTS loyalty_redeem_options (
  id text PRIMARY KEY,
  name text NOT NULL,
  kind text NOT NULL,
  min numeric NOT NULL,
  step numeric NOT NULL,
  value_per numeric NOT NULL DEFAULT 1.0,
  cost text NOT NULL,
  audience text NOT NULL DEFAULT 'all',
  status text NOT NULL DEFAULT 'active',
  description text NOT NULL,
  why text
);

-- Members
CREATE TABLE IF NOT EXISTS loyalty_members (
  id text PRIMARY KEY,
  party text,
  name text NOT NULL,
  kind text NOT NULL DEFAULT 'consumer',
  tier text NOT NULL DEFAULT 'bronze',
  balance numeric NOT NULL DEFAULT 0,
  joined text,
  qualify_12m numeric NOT NULL DEFAULT 0,
  lifetime_earned numeric NOT NULL DEFAULT 0,
  lifetime_redeemed numeric NOT NULL DEFAULT 0,
  expiring_soon numeric NOT NULL DEFAULT 0,
  expiring_on text,
  last_activity text
);

-- Ledger
CREATE TABLE IF NOT EXISTS loyalty_ledger (
  id text PRIMARY KEY,
  member text NOT NULL REFERENCES loyalty_members(id) ON DELETE CASCADE,
  when_date text NOT NULL,
  type text NOT NULL,
  points numeric NOT NULL,
  ref text,
  rule_id text,
  funder text NOT NULL,
  seller_id text,
  value numeric NOT NULL,
  note text
);

-- Enable RLS
ALTER TABLE loyalty_programme ENABLE ROW LEVEL SECURITY;
ALTER TABLE loyalty_tiers ENABLE ROW LEVEL SECURITY;
ALTER TABLE loyalty_earn_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE loyalty_redeem_options ENABLE ROW LEVEL SECURITY;
ALTER TABLE loyalty_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE loyalty_ledger ENABLE ROW LEVEL SECURITY;

-- Policies: programme (read-only)
DROP POLICY IF EXISTS "anon_read_loyalty_programme" ON loyalty_programme;
CREATE POLICY "anon_read_loyalty_programme" ON loyalty_programme FOR SELECT TO anon, authenticated USING (true);

-- Policies: tiers (read-only)
DROP POLICY IF EXISTS "anon_read_loyalty_tiers" ON loyalty_tiers;
CREATE POLICY "anon_read_loyalty_tiers" ON loyalty_tiers FOR SELECT TO anon, authenticated USING (true);

-- Policies: earn_rules (read-only)
DROP POLICY IF EXISTS "anon_read_loyalty_earn_rules" ON loyalty_earn_rules;
CREATE POLICY "anon_read_loyalty_earn_rules" ON loyalty_earn_rules FOR SELECT TO anon, authenticated USING (true);

-- Policies: redeem_options (read-only)
DROP POLICY IF EXISTS "anon_read_loyalty_redeem_options" ON loyalty_redeem_options;
CREATE POLICY "anon_read_loyalty_redeem_options" ON loyalty_redeem_options FOR SELECT TO anon, authenticated USING (true);

-- Policies: members (full CRUD)
DROP POLICY IF EXISTS "anon_select_loyalty_members" ON loyalty_members;
CREATE POLICY "anon_select_loyalty_members" ON loyalty_members FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_loyalty_members" ON loyalty_members;
CREATE POLICY "anon_insert_loyalty_members" ON loyalty_members FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_loyalty_members" ON loyalty_members;
CREATE POLICY "anon_update_loyalty_members" ON loyalty_members FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_loyalty_members" ON loyalty_members;
CREATE POLICY "anon_delete_loyalty_members" ON loyalty_members FOR DELETE TO anon, authenticated USING (true);

-- Policies: ledger (full CRUD)
DROP POLICY IF EXISTS "anon_select_loyalty_ledger" ON loyalty_ledger;
CREATE POLICY "anon_select_loyalty_ledger" ON loyalty_ledger FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_loyalty_ledger" ON loyalty_ledger;
CREATE POLICY "anon_insert_loyalty_ledger" ON loyalty_ledger FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_loyalty_ledger" ON loyalty_ledger;
CREATE POLICY "anon_update_loyalty_ledger" ON loyalty_ledger FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_loyalty_ledger" ON loyalty_ledger;
CREATE POLICY "anon_delete_loyalty_ledger" ON loyalty_ledger FOR DELETE TO anon, authenticated USING (true);

-- Seed: tiers
INSERT INTO loyalty_tiers (id, name, sort_order, qualify_spend, multiplier, colour, benefits, note) VALUES
('bronze', 'Bronze', 1, 0, 1.0, '#8D6E63', ARRAY['Earn 1 point per $1 spent','Points valid for 24 months'], 'Where every account starts.'),
('silver', 'Silver', 2, 600, 1.25, '#90A4AE', ARRAY['Earn 1.25 points per $1','Free delivery on device orders','Early access to content offers'], 'Reached on $600 of qualifying spend in a rolling twelve months.'),
('gold', 'Gold', 3, 1800, 1.5, '#C8A200', ARRAY['Earn 1.5 points per $1','Free delivery on everything','Priority support queue','Double points one weekend a quarter'], 'Reached on $1,800 of qualifying spend.'),
('platinum', 'Platinum', 4, 4500, 2.0, '#455A64', ARRAY['Earn 2 points per $1','Free next-day delivery','Named account contact','Points never expire while the tier is held','Annual device trade-in bonus'], 'Reached on $4,500 of qualifying spend.')
ON CONFLICT (id) DO NOTHING;

-- Seed: earn rules
INSERT INTO loyalty_earn_rules (id, name, scope, scope_id, rate, funder, split, status, "from", "to", cap_per_order, cap_per_month, audience, bonus, first_only, why) VALUES
('ERN-01', 'Base earn — everything', 'all', null, 1.0, 'operator', null, 'active', '01 Mar 2024', null, null, null, 'all', null, false, 'The floor. Without it a tier multiplier has nothing to multiply.'),
('ERN-02', 'Digital content — double earn', 'vertical', 'content', 2.0, 'shared', 50, 'active', '01 Apr 2026', '30 Sep 2026', 500, 2000, 'all', null, false, 'Content has the highest margin and the weakest repeat rate.'),
('ERN-03', 'Device trade-in bonus', 'vertical', 'device', 1.0, 'partner', null, 'active', '01 Jan 2026', null, 1500, null, 'all', 750, false, 'The OEM funds it because the trade-in makes the next handset sale happen.'),
('ERN-04', 'IoT volume accelerator', 'vertical', 'iot', 0.5, 'operator', null, 'active', '01 Feb 2026', null, null, 5000, 'enterprise', null, false, 'Enterprise IoT spend is large and repeatable.'),
('ERN-05', 'Security first purchase', 'vertical', 'security', 1.0, 'partner', null, 'active', '15 May 2026', '31 Dec 2026', 2000, null, 'enterprise', null, true, 'Security is a considered purchase with a long cycle.'),
('ERN-06', 'Kestrel handset launch', 'partner', 'PTR-1002', 3.0, 'partner', null, 'active', '01 Jul 2026', '31 Aug 2026', 3000, null, 'consumer', null, false, 'A launch window the OEM is paying for.'),
('ERN-07', 'Weekend double points — Gold+', 'all', null, 2.0, 'operator', null, 'scheduled', '01 Aug 2026', '03 Aug 2026', 1000, null, 'gold+', null, false, 'A tier benefit that has to actually happen.'),
('ERN-09', 'Nimbus sensor starter pack', 'partner', 'PTR-1004', 2.5, 'partner', null, 'active', '01 Jun 2026', '30 Sep 2026', 1200, null, 'all', null, false, 'A sensor is bought once and then bought again for every site.'),
('ERN-10', 'Nimbus gateway attach', 'partner', 'PTR-1004', 2.0, 'shared', 40, 'pending', '01 Aug 2026', '31 Oct 2026', 800, null, 'enterprise', null, false, 'Gateways sell alongside sensors.'),
('ERN-08', 'Insurance attach', 'vertical', 'consumer', 1.5, 'shared', 60, 'paused', '01 May 2026', null, 400, null, 'consumer', null, false, 'Paused while the insurer reviews its share.')
ON CONFLICT (id) DO NOTHING;

-- Seed: redeem options
INSERT INTO loyalty_redeem_options (id, name, kind, min, step, value_per, cost, audience, status, description, why) VALUES
('RDM-01', 'Wallet credit', 'wallet', 100, 100, 1.00, 'operator', 'consumer', 'active', '100 points becomes $1.00 of wallet credit, spendable on anything.', 'The plainest option, keeps money inside the marketplace.'),
('RDM-02', 'Credit on the next bill', 'bill', 500, 500, 1.05, 'operator', 'all', 'active', '500 points becomes $5.25 off the next invoice — a 5% premium.', 'Worth slightly more because a bill credit costs nothing in payment fees.'),
('RDM-03', 'Seller voucher', 'voucher', 1000, 1000, 1.20, 'partner', 'all', 'active', '1,000 points becomes a $12.00 voucher against that seller''s listings.', 'The best rate, because the seller funds it to pull the customer back.'),
('RDM-04', 'Device trade-in top-up', 'tradein', 2000, 1000, 1.30, 'partner', 'consumer', 'active', '2,000 points adds $26.00 to a trade-in valuation.', 'The highest rate, only pays out against a sale the OEM wanted anyway.'),
('RDM-05', 'Points off at checkout', 'basket', 200, 100, 1.00, 'operator', 'all', 'active', '200 points takes $2.00 off the basket at payment.', 'Removes the step between earning and spending.'),
('RDM-06', 'Next-day delivery', 'delivery', 400, 400, 1.15, 'operator', 'all', 'active', '400 points upgrades the shipping line on a marketplace order.', 'Cheap at the margin, worth more to somebody who needs it tomorrow.'),
('RDM-07', 'Airport lounge pass', 'external', 15000, 15000, 1.10, 'operator', 'consumer', 'retired', '15,000 points for a single lounge visit, honoured by a third party.', 'Retired. Fulfilled outside the marketplace — turned points liability into cash invoice.'),
('RDM-08', 'Donate to Digital Access', 'external', 500, 500, 1.00, 'operator', 'all', 'retired', '500 points funded one month of connectivity for a student.', 'Retired for the same reason — value left the marketplace as cash.')
ON CONFLICT (id) DO NOTHING;

-- Seed: members
INSERT INTO loyalty_members (id, party, name, kind, tier, balance, joined, qualify_12m, lifetime_earned, lifetime_redeemed, expiring_soon, expiring_on, last_activity) VALUES
('LM-4001', 'CUS-449021', 'Priya Raman', 'consumer', 'gold', 3180, '14 Jun 2024', 2140.55, 9420, 6240, 420, '30 Sep 2026', '25 Jul 2026'),
('LM-4002', 'CUS-449118', 'Arun Deshpande', 'consumer', 'silver', 1145, '02 Sep 2024', 812.40, 2960, 1815, 0, null, '22 Jul 2026'),
('LM-4003', 'CUS-449204', 'Meera Krishnan', 'consumer', 'platinum', 11840, '21 Mar 2024', 5310.00, 24680, 12840, 0, null, '24 Jul 2026'),
('LM-4004', 'CUS-449377', 'Daniel Osei', 'consumer', 'bronze', 260, '11 May 2026', 196.00, 260, 0, 0, null, '25 Jul 2026'),
('LM-4005', 'CUS-449512', 'Sanya Kapoor', 'consumer', 'silver', 1890, '08 Jan 2025', 1024.75, 4110, 2220, 610, '31 Aug 2026', '25 Jul 2026'),
('LM-4101', 'ORG-77120', 'Brightline Foods', 'enterprise', 'platinum', 74250, '05 Apr 2024', 118420.55, 186400, 112150, 8400, '31 Oct 2026', '24 Jul 2026'),
('LM-4102', 'ORG-77208', 'Harbourpoint Retail', 'enterprise', 'gold', 21630, '19 Aug 2024', 38940.00, 54200, 32570, 0, null, '21 Jul 2026'),
('LM-4103', 'ORG-77341', 'Cadence Health', 'enterprise', 'silver', 6480, '02 Feb 2025', 14210.80, 16900, 10420, 0, null, '18 Jul 2026')
ON CONFLICT (id) DO NOTHING;

-- Seed: ledger
INSERT INTO loyalty_ledger (id, member, when_date, type, points, ref, rule_id, funder, seller_id, value, note) VALUES
('LTX-70100', 'LM-4001', '25 Jul 2026', 'earn', 210, 'ORD-881433', 'ERN-01', 'operator', null, 2.10, 'Aegis Screen Cover — $140.00 at 1.5x Gold'),
('LTX-70103', 'LM-4001', '24 Jul 2026', 'redeem', -1500, 'RDM-01', null, 'operator', null, 15.00, 'Redeemed for $15.00 of wallet credit'),
('LTX-70106', 'LM-4001', '22 Jul 2026', 'earn', 840, 'ORD-881311', 'ERN-02', 'shared', 'PTR-1005', 8.40, 'PlayForge Season Pass — double earn on content'),
('LTEX-70109', 'LM-4001', '19 Jul 2026', 'reverse', -585, 'ORD-881204', 'ERN-01', 'operator', null, 5.85, 'Kestrel K7 refunded — points went back with the money'),
('LTX-70112', 'LM-4001', '19 Jul 2026', 'earn', 585, 'ORD-881204', 'ERN-01', 'operator', null, 5.85, 'Kestrel K7 handset — $389.00 at 1.5x Gold'),
('LTX-70115', 'LM-4001', '12 Jul 2026', 'bonus', 500, null, null, 'operator', null, 5.00, 'Goodwill after a delivery failure on ORD-880912'),
('LTX-70118', 'LM-4001', '04 Jul 2026', 'earn', 1890, 'ORD-880788', 'ERN-06', 'partner', 'PTR-1002', 18.90, 'Kestrel launch window — 3x on a $420.00 order'),
('LTX-70121', 'LM-4001', '28 Jun 2026', 'expire', -320, null, null, 'operator', null, 3.20, 'Earned Jun 2024, unredeemed at 24 months'),
('LTX-70124', 'LM-4001', '21 Jun 2026', 'redeem', -2400, 'RDM-03', null, 'partner', 'PTR-1001', 28.80, 'Seller voucher with StreamNova Media — $28.80'),
('LTX-70127', 'LM-4001', '15 Jun 2026', 'earn', 960, 'ORD-880451', 'ERN-01', 'operator', null, 9.60, 'Travel Cover Lite — annual premium'),
('LTX-70130', 'LM-4003', '24 Jul 2026', 'earn', 1240, 'ORD-881288', 'ERN-01', 'operator', null, 12.40, 'Halo Music Family — Platinum 2x'),
('LTX-70133', 'LM-4003', '20 Jul 2026', 'redeem', -4000, 'RDM-04', null, 'partner', 'PTR-1002', 52.00, 'Trade-in top-up on a Kestrel K7 — $52.00'),
('LTX-70136', 'LM-4003', '11 Jul 2026', 'earn', 3600, 'ORD-880940', 'ERN-06', 'partner', 'PTR-1002', 36.00, 'Kestrel launch window'),
('LTX-70139', 'LM-4005', '25 Jul 2026', 'earn', 145, 'ORD-881441', 'ERN-01', 'operator', null, 1.45, 'Nimbus sensor pack'),
('LTX-70142', 'LM-4005', '16 Jul 2026', 'adjust', 300, null, null, 'operator', null, 3.00, 'Correction — ERN-02 cap applied twice on 14 Jul'),
('LTX-70145', 'LM-4004', '25 Jul 2026', 'earn', 96, 'ORD-881441', 'ERN-01', 'operator', null, 0.96, 'First order on the account'),
('LTX-70148', 'LM-4004', '18 May 2026', 'bonus', 164, null, null, 'operator', null, 1.64, 'Joining bonus'),
('LTX-70151', 'LM-4101', '24 Jul 2026', 'earn', 4210, 'ORD-881402', 'ERN-04', 'operator', null, 42.10, 'Nimbus IoT SIMs — enterprise accelerator'),
('LTX-70154', 'LM-4101', '22 Jul 2026', 'redeem', -25000, 'RDM-02', null, 'operator', null, 262.50, 'Credit on invoice INV-2026-0613 — $262.50'),
('LTX-70157', 'LM-4101', '18 Jul 2026', 'earn', 9600, 'ORD-881207', 'ERN-05', 'partner', 'PTR-1003', 96.00, 'Sentinel MDR first purchase — seller funded'),
('LTX-70160', 'LM-4101', '09 Jul 2026', 'earn', 2840, 'ORD-880996', 'ERN-04', 'operator', null, 28.40, 'IoT connectivity — monthly cap reached'),
('LTX-70163', 'LM-4101', '01 Jul 2026', 'expire', -1200, null, null, 'operator', null, 12.00, 'Earned Jun 2024, unredeemed at 24 months'),
('LTX-70166', 'LM-4102', '21 Jul 2026', 'earn', 3120, 'ORD-881350', 'ERN-05', 'partner', 'PTR-1003', 31.20, 'Sentinel MDR — 40 seats'),
('LTX-70169', 'LM-4102', '14 Jul 2026', 'redeem', -12000, 'RDM-02', null, 'operator', null, 126.00, 'Credit on invoice INV-2026-0598 — $126.00'),
('LTX-70172', 'LM-4103', '18 Jul 2026', 'earn', 1640, 'ORD-881118', 'ERN-04', 'operator', null, 16.40, 'IoT connectivity renewal'),
('LTX-70175', 'LM-4005', '09 Jul 2026', 'earn', 680, 'ORD-881044', 'ERN-03', 'partner', 'PTR-1004', 6.80, 'Nimbus tracker trade-in bonus'),
('LTX-70178', 'LM-4002', '17 Jul 2026', 'earn', 420, 'ORD-881122', 'ERN-02', 'shared', 'PTR-1005', 4.20, 'PlayForge content — double earn, shared 50/50'),
('LTX-70181', 'LM-4002', '05 Jul 2026', 'redeem', -1000, 'RDM-03', null, 'partner', 'PTR-1005', 12.00, 'PlayForge voucher — $12.00'),
('LTX-70184', 'LM-4101', '23 Jul 2026', 'earn', 1200, 'ORD-881402', 'ERN-09', 'partner', 'PTR-1004', 12.00, 'Nimbus starter pack — cap reached on a $640 order'),
('LTX-70187', 'LM-4103', '19 Jul 2026', 'earn', 940, 'ORD-881118', 'ERN-09', 'partner', 'PTR-1004', 9.40, 'Nimbus sensor pack — 2.5x seller funded'),
('LTX-70190', 'LM-4002', '14 Jul 2026', 'earn', 525, 'ORD-881090', 'ERN-09', 'partner', 'PTR-1004', 5.25, 'Nimbus tracker — consumer purchase'),
('LTX-70193', 'LM-4003', '08 Jul 2026', 'earn', 1200, 'ORD-880977', 'ERN-09', 'partner', 'PTR-1004', 12.00, 'Nimbus starter pack — cap reached'),
('LTX-70196', 'LM-4005', '02 Jul 2026', 'reverse', -380, 'ORD-880902', 'ERN-09', 'partner', 'PTR-1004', 3.80, 'Order returned within 14 days — points went back'),
('LTX-70199', 'LM-4005', '01 Jul 2026', 'earn', 380, 'ORD-880902', 'ERN-09', 'partner', 'PTR-1004', 3.80, 'Nimbus tracker pack'),
('LTX-70202', 'LM-4102', '27 Jun 2026', 'earn', 1200, 'ORD-880844', 'ERN-09', 'partner', 'PTR-1004', 12.00, 'Nimbus sensor rollout — cap reached'),
('LTX-70205', 'LM-4101', '24 Jun 2026', 'redeem', -3000, 'RDM-03', null, 'partner', 'PTR-1004', 36.00, 'Nimbus voucher against a gateway order — $36.00')
ON CONFLICT (id) DO NOTHING;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_loyalty_ledger_member ON loyalty_ledger(member);
CREATE INDEX IF NOT EXISTS idx_loyalty_ledger_type ON loyalty_ledger(type);
CREATE INDEX IF NOT EXISTS idx_loyalty_members_tier ON loyalty_members(tier);
