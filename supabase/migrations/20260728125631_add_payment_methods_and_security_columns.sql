CREATE TABLE IF NOT EXISTS consumer_payment_methods (
  id text PRIMARY KEY,
  kind text NOT NULL,
  detail text NOT NULL,
  holder text NOT NULL,
  expires text,
  is_primary boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'active',
  added text NOT NULL
);

ALTER TABLE consumer_payment_methods ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anon_select_payment_methods" ON consumer_payment_methods FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "anon_insert_payment_methods" ON consumer_payment_methods FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "anon_update_payment_methods" ON consumer_payment_methods FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "anon_delete_payment_methods" ON consumer_payment_methods FOR DELETE TO anon, authenticated USING (true);

INSERT INTO consumer_payment_methods (id, kind, detail, holder, expires, is_primary, status, added) VALUES
  ('PM-1', 'Bill to mobile', '+91 98860 41127', 'Priya Raman', null,      true,  'active',  '14 Jun 2024'),
  ('PM-2', 'Visa',           '•••• 4419',       'P Raman',     '09/2028', false, 'active',  '02 Nov 2024'),
  ('PM-3', 'Mastercard',     '•••• 8871',       'P Raman',     '03/2026', false, 'expired', '19 Mar 2024')
ON CONFLICT (id) DO NOTHING;

-- Add MFA + sessions columns to consumer_profile
ALTER TABLE consumer_profile ADD COLUMN IF NOT EXISTS mfa_enabled boolean NOT NULL DEFAULT true;
ALTER TABLE consumer_profile ADD COLUMN IF NOT EXISTS active_sessions integer NOT NULL DEFAULT 2;
ALTER TABLE consumer_profile ADD COLUMN IF NOT EXISTS pwd_changed text NOT NULL DEFAULT '12 Jun 2026';
