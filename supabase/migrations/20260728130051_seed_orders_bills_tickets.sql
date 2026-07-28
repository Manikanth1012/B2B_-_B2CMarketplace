/*
  Seed orders + order_items with historical synthetic data,
  create consumer_bills and consumer_tickets tables with seed data.
*/

-- ============ SEED ORDERS ============
INSERT INTO orders (id, order_ref, status, total, subtotal, tax, discount, payment_method, buyer_name, buyer_email, shipping_address, created_at) VALUES
  ('a0000000-0000-0000-0000-000000000001', 'ORD-881433', 'shipped',   140.00, 127.27, 12.73, 0, 'Bill to mobile', 'Priya Raman', 'priya.raman@6dtech.co.in', '{"line1":"12 Indiranagar","city":"Bengaluru","pin":"560038"}', '2026-07-25 14:22:00+00'),
  ('a0000000-0000-0000-0000-000000000002', 'ORD-881311', 'delivered',  12.99,  11.81,  1.18, 0, 'Visa •••• 4419',  'Priya Raman', 'priya.raman@6dtech.co.in', '{"line1":"12 Indiranagar","city":"Bengaluru","pin":"560038"}', '2026-07-24 09:30:00+00'),
  ('a0000000-0000-0000-0000-000000000003', 'ORD-881204', 'refunded',  389.00, 353.64, 35.36, 0, 'Visa •••• 4419',  'Priya Raman', 'priya.raman@6dtech.co.in', '{"line1":"12 Indiranagar","city":"Bengaluru","pin":"560038"}', '2026-07-19 10:00:00+00'),
  ('a0000000-0000-0000-0000-000000000004', 'ORD-881044', 'delivered',  42.00,  38.18,  3.82, 0, 'Bill to mobile', 'Priya Raman', 'priya.raman@6dtech.co.in', '{"line1":"12 Indiranagar","city":"Bengaluru","pin":"560038"}', '2026-07-02 15:30:00+00'),
  ('a0000000-0000-0000-0000-000000000005', 'ORD-880912', 'refunded',   18.00,  16.36,  1.64, 0, 'Bill to mobile', 'Priya Raman', 'priya.raman@6dtech.co.in', '{"line1":"12 Indiranagar","city":"Bengaluru","pin":"560038"}', '2026-06-28 11:00:00+00'),
  ('a0000000-0000-0000-0000-000000000006', 'ORD-880788', 'delivered', 389.00, 353.64, 35.36, 0, 'Visa •••• 4419',  'Priya Raman', 'priya.raman@6dtech.co.in', '{"line1":"12 Indiranagar","city":"Bengaluru","pin":"560038"}', '2026-06-04 13:20:00+00'),
  ('a0000000-0000-0000-0000-000000000007', 'ORD-880451', 'processing', 12.99, 11.81, 1.18, 0, 'Bill to mobile', 'Priya Raman', 'priya.raman@6dtech.co.in', '{"line1":"12 Indiranagar","city":"Bengaluru","pin":"560038"}', '2026-05-15 10:00:00+00')
ON CONFLICT (id) DO NOTHING;

-- ============ SEED ORDER ITEMS ============
INSERT INTO order_items (id, order_id, product_id, product_name, price, quantity, fulfil, status) VALUES
  ('b0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'SKU-4001', 'Aegis Screen Cover', 140.00, 1, 'Shipped', 'shipped'),
  ('b0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000002', 'SKU-3003', 'PlayForge Season Pass', 12.99, 1, 'Instant', 'delivered'),
  ('b0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000003', 'SKU-4002', 'Kestrel K7 handset', 389.00, 1, 'Shipped', 'refunded'),
  ('b0000000-0000-0000-0000-000000000004', 'a0000000-0000-0000-0000-000000000004', 'SKU-5001', 'Nimbus sensor pack', 42.00, 1, 'Shipped', 'delivered'),
  ('b0000000-0000-0000-0000-000000000005', 'a0000000-0000-0000-0000-000000000005', 'SKU-4001', 'Aegis Screen Cover', 18.00, 1, 'Shipped', 'refunded'),
  ('b0000000-0000-0000-0000-000000000006', 'a0000000-0000-0000-0000-000000000006', 'SKU-4002', 'Kestrel K7 handset', 389.00, 1, 'Shipped', 'delivered'),
  ('b0000000-0000-0000-0000-000000000007', 'a0000000-0000-0000-0000-000000000007', 'SKU-2004', 'Travel Cover Lite', 12.99, 1, 'Instant', 'processing')
ON CONFLICT (id) DO NOTHING;

-- ============ CONSUMER BILLS TABLE ============
CREATE TABLE IF NOT EXISTS consumer_bills (
  id text PRIMARY KEY,
  period text NOT NULL,
  issued text NOT NULL,
  due text NOT NULL,
  plan_charge numeric NOT NULL DEFAULT 18.00,
  subscriptions numeric NOT NULL DEFAULT 0,
  oneoff numeric NOT NULL DEFAULT 0,
  tax numeric NOT NULL DEFAULT 0,
  total numeric NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'open',
  paid_on text,
  pages integer NOT NULL DEFAULT 3
);

ALTER TABLE consumer_bills ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_select_consumer_bills" ON consumer_bills FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "anon_insert_consumer_bills" ON consumer_bills FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "anon_update_consumer_bills" ON consumer_bills FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "anon_delete_consumer_bills" ON consumer_bills FOR DELETE TO anon, authenticated USING (true);

INSERT INTO consumer_bills (id, period, issued, due, plan_charge, subscriptions, oneoff, tax, total, status, paid_on, pages) VALUES
  ('BILL-2026-07', 'July 2026',    '01 Aug 2026', '15 Aug 2026', 18.00, 49.38, 129.00, 17.76, 214.14, 'open',    null,       4),
  ('BILL-2026-06', 'June 2026',    '01 Jul 2026', '15 Jul 2026', 18.00, 49.38,   0.00,  6.08,  73.46, 'paid',    '12 Jul 2026', 3),
  ('BILL-2026-05', 'May 2026',     '01 Jun 2026', '15 Jun 2026', 18.00, 49.38, 349.00, 37.71, 454.09, 'paid',    '10 Jun 2026', 5),
  ('BILL-2026-04', 'April 2026',   '01 May 2026', '15 May 2026', 18.00, 49.38,   0.00,  6.08,  73.46, 'paid',    '08 May 2026', 3),
  ('BILL-2026-03', 'March 2026',   '01 Apr 2026', '15 Apr 2026', 18.00, 42.48,  24.00,  7.62,  92.10, 'paid',    '11 Apr 2026', 3),
  ('BILL-2026-02', 'February 2026','01 Mar 2026', '15 Mar 2026', 18.00, 42.48,   0.00,  5.42,  65.90, 'paid',    '09 Mar 2026', 3),
  ('BILL-2026-01', 'January 2026', '01 Feb 2026', '15 Feb 2026', 18.00, 42.48,  89.00, 13.51, 162.99, 'paid',    '07 Feb 2026', 4)
ON CONFLICT (id) DO NOTHING;

-- ============ CONSUMER TICKETS TABLE ============
CREATE TABLE IF NOT EXISTS consumer_tickets (
  id text PRIMARY KEY,
  subject text NOT NULL,
  category text NOT NULL DEFAULT 'General',
  severity text NOT NULL DEFAULT 'P3',
  status text NOT NULL DEFAULT 'open',
  opened text NOT NULL,
  opened_by text NOT NULL DEFAULT 'Priya Raman',
  channel text NOT NULL DEFAULT 'Self-care portal',
  owner text,
  sla_mins integer NOT NULL DEFAULT 1440,
  resolution_mins integer,
  breached boolean NOT NULL DEFAULT false,
  escalated boolean NOT NULL DEFAULT false,
  messages jsonb NOT NULL DEFAULT '[]'::jsonb
);

ALTER TABLE consumer_tickets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_select_consumer_tickets" ON consumer_tickets FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "anon_insert_consumer_tickets" ON consumer_tickets FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "anon_update_consumer_tickets" ON consumer_tickets FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "anon_delete_consumer_tickets" ON consumer_tickets FOR DELETE TO anon, authenticated USING (true);

INSERT INTO consumer_tickets (id, subject, category, severity, status, opened, opened_by, channel, owner, sla_mins, resolution_mins, breached, escalated, messages) VALUES
  ('TCK-59120', 'Delivery attempt failed — parcel at depot', 'Delivery', 'P3', 'inprogress', '2 d ago', 'Priya Raman', 'Self-care portal', 'Kestrel Telecom — Tier 1', 1440, null, false, false,
    '[{"who":"Priya Raman","when":"2 d ago 10:14","text":"The tracking says delivery failed but I was home all day. Can you rebook?"},{"who":"Kestrel Telecom — Tier 1","when":"2 d ago 14:30","text":"I am sorry about that. I have contacted the carrier and booked a redelivery for tomorrow, 09:00–13:00. You will get an SMS an hour before."}]'::jsonb),
  ('TCK-59123', 'Screen cover arrived cracked', 'Product', 'P3', 'resolved', '1 w ago', 'Priya Raman', 'Self-care portal', 'Kestrel Telecom — Tier 1', 1440, 320, false, false,
    '[{"who":"Priya Raman","when":"1 w ago 09:00","text":"The screen cover I received was cracked in the packaging."},{"who":"Kestrel Telecom — Tier 1","when":"1 w ago 11:20","text":"I am sorry about that. A replacement has been shipped and will arrive in 2 days. You do not need to return the damaged one."},{"who":"Priya Raman","when":"5 d ago 08:00","text":"Replacement arrived today, looks good. Thank you."}]'::jsonb),
  ('TCK-59126', 'PlayForge Season Pass not activating', 'Technical', 'P2', 'resolved', '3 w ago', 'Priya Raman', 'AI assistant', 'Kestrel Telecom — Tier 2', 480, 210, false, true,
    '[{"who":"Priya Raman","when":"3 w ago 16:00","text":"I bought the PlayForge Season Pass but it is not showing up in my game."},{"who":"AARYA assistant","when":"3 w ago 16:01","text":"I can see your purchase ORD-880788 completed. Let me check the activation status with PlayForge."},{"who":"Kestrel Telecom — Tier 2","when":"3 w ago 16:30","text":"There was a delay in the activation webhook. I have manually triggered it and your pass should now be active. Please restart the game."},{"who":"Priya Raman","when":"3 w ago 17:00","text":"Yes it is working now, thanks!"}]'::jsonb),
  ('TCK-59129', 'Question about travel cover cooling-off', 'Billing', 'P4', 'resolved', '1 mo ago', 'Priya Raman', 'Email', 'Kestrel Telecom — Tier 1', 2880, 180, false, false,
    '[{"who":"Priya Raman","when":"1 mo ago 10:00","text":"Can I cancel my Travel Cover Lite subscription within the 14-day cooling-off period for a full refund?"},{"who":"Kestrel Telecom — Tier 1","when":"1 mo ago 13:00","text":"Yes — you can cancel within 14 days of purchase for a full refund, no questions asked. I can see your subscription SUB-9102 started on 15 Jun, so you are within the window. Would you like me to process the cancellation?"},{"who":"Priya Raman","when":"1 mo ago 14:00","text":"Not yet, I just wanted to know. Thank you."}]'::jsonb)
ON CONFLICT (id) DO NOTHING;

-- ============ ADD TRACKING COLUMNS TO ORDERS ============
ALTER TABLE orders ADD COLUMN IF NOT EXISTS tracking_ref text;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS carrier text;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS placed_date text;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS seller text;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS vertical text;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS failed boolean NOT NULL DEFAULT false;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS stage integer NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS stages text[] NOT NULL DEFAULT ARRAY['Ordered','Confirmed','Dispatched','In transit','Delivered'];

UPDATE orders SET
  tracking_ref = CASE order_ref
    WHEN 'ORD-881433' THEN 'TRK-772140'
    WHEN 'ORD-881311' THEN 'TRK-772098'
    WHEN 'ORD-881204' THEN 'TRK-771887'
    WHEN 'ORD-881044' THEN 'TRK-771534'
    WHEN 'ORD-880912' THEN 'TRK-771401'
    WHEN 'ORD-880788' THEN 'TRK-771156'
    WHEN 'ORD-880451' THEN NULL
  END,
  carrier = CASE order_ref
    WHEN 'ORD-881433' THEN 'BlueDart'
    WHEN 'ORD-881311' THEN 'Digital'
    WHEN 'ORD-881204' THEN 'BlueDart'
    WHEN 'ORD-881044' THEN 'BlueDart'
    WHEN 'ORD-880912' THEN 'BlueDart'
    WHEN 'ORD-880788' THEN 'BlueDart'
    WHEN 'ORD-880451' THEN 'Digital'
  END,
  placed_date = CASE order_ref
    WHEN 'ORD-881433' THEN '25 Jul 2026'
    WHEN 'ORD-881311' THEN '24 Jul 2026'
    WHEN 'ORD-881204' THEN '19 Jul 2026'
    WHEN 'ORD-881044' THEN '02 Jul 2026'
    WHEN 'ORD-880912' THEN '28 Jun 2026'
    WHEN 'ORD-880788' THEN '04 Jul 2026'
    WHEN 'ORD-880451' THEN '15 May 2026'
  END,
  seller = CASE order_ref
    WHEN 'ORD-881433' THEN 'Aegis Assurance'
    WHEN 'ORD-881311' THEN 'PlayForge Games'
    WHEN 'ORD-881204' THEN 'Kestrel Devices'
    WHEN 'ORD-881044' THEN 'Nimbus Sensors'
    WHEN 'ORD-880912' THEN 'Aegis Assurance'
    WHEN 'ORD-880788' THEN 'Kestrel Devices'
    WHEN 'ORD-880451' THEN 'Aegis Assurance'
  END,
  vertical = CASE order_ref
    WHEN 'ORD-881433' THEN 'device'
    WHEN 'ORD-881311' THEN 'content'
    WHEN 'ORD-881204' THEN 'device'
    WHEN 'ORD-881044' THEN 'iot'
    WHEN 'ORD-880912' THEN 'device'
    WHEN 'ORD-880788' THEN 'device'
    WHEN 'ORD-880451' THEN 'consumer'
  END,
  failed = CASE order_ref WHEN 'ORD-880912' THEN true ELSE false END,
  stage = CASE order_ref
    WHEN 'ORD-881433' THEN 3
    WHEN 'ORD-881311' THEN 4
    WHEN 'ORD-881204' THEN 4
    WHEN 'ORD-881044' THEN 4
    WHEN 'ORD-880912' THEN 4
    WHEN 'ORD-880788' THEN 4
    WHEN 'ORD-880451' THEN 1
  END,
  stages = CASE
    WHEN vertical IN ('content','consumer') THEN ARRAY['Ordered','Confirmed','Activated']
    ELSE ARRAY['Ordered','Confirmed','Dispatched','In transit','Delivered']
  END
WHERE order_ref IN ('ORD-881433','ORD-881311','ORD-881204','ORD-881044','ORD-880912','ORD-880788','ORD-880451');
