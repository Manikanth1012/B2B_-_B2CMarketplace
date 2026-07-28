-- The records behind the technical gate, plus per-partner onboarding tasks.
--
-- RLS follows this project's existing convention: anon has full access with
-- USING (true), matching every current table. Recorded as a risk in the spec;
-- tightening it is a separate piece of work.

CREATE TABLE IF NOT EXISTS partner_endpoints (
  id text PRIMARY KEY,
  partner_id text NOT NULL REFERENCES partners(id) ON DELETE CASCADE,
  name text NOT NULL,
  url text NOT NULL,
  method text NOT NULL DEFAULT 'POST',
  auth text NOT NULL DEFAULT 'None',
  enabled boolean NOT NULL DEFAULT true,
  events text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_partner_endpoints_partner ON partner_endpoints(partner_id);

CREATE TABLE IF NOT EXISTS endpoint_test_calls (
  id text PRIMARY KEY,
  endpoint_id text NOT NULL REFERENCES partner_endpoints(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'sent',
  called_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_endpoint_test_calls_endpoint ON endpoint_test_calls(endpoint_id);

CREATE TABLE IF NOT EXISTS sandbox_runs (
  id text PRIMARY KEY,
  partner_id text NOT NULL REFERENCES partners(id) ON DELETE CASCADE,
  state text NOT NULL DEFAULT 'not_started',
  ran_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_sandbox_runs_partner ON sandbox_runs(partner_id);

-- A task belongs to a partner AND a gate. It was previously one flat array,
-- so opening a gate on a partner live since 2024 showed another applicant's
-- open chasers. There is no status column: state derives from the gate.
-- closed_by/closed_at are attribution, not state — they cannot be recomputed.
CREATE TABLE IF NOT EXISTS onboarding_tasks (
  id text PRIMARY KEY,
  partner_id text NOT NULL REFERENCES partners(id) ON DELETE CASCADE,
  gate_id text NOT NULL,
  title text NOT NULL,
  detail text NOT NULL DEFAULT '',
  owner text NOT NULL DEFAULT 'You',
  due text,
  closed_by text,
  closed_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_onboarding_tasks_partner ON onboarding_tasks(partner_id);

ALTER TABLE partner_endpoints    ENABLE ROW LEVEL SECURITY;
ALTER TABLE endpoint_test_calls  ENABLE ROW LEVEL SECURITY;
ALTER TABLE sandbox_runs         ENABLE ROW LEVEL SECURITY;
ALTER TABLE onboarding_tasks     ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['partner_endpoints','endpoint_test_calls','sandbox_runs','onboarding_tasks'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS "anon_all_%1$s" ON %1$I', t);
    EXECUTE format('CREATE POLICY "anon_all_%1$s" ON %1$I FOR ALL TO anon, authenticated USING (true) WITH CHECK (true)', t);
  END LOOP;
END $$;

-- Seed: Sentinel Cyber (PTR-1003) sits on the technical gate with a partially
-- proved integration, so the refusal is visible the first time the screen opens.
INSERT INTO partner_endpoints (id, partner_id, name, url, method, auth, enabled, events) VALUES
  ('EP-1003-01','PTR-1003','Fulfilment webhook','https://api.sentinel.example/fulfil','POST','HMAC-SHA256',true,'{order.created,order.cancelled}'),
  ('EP-1003-02','PTR-1003','Stock sync','https://api.sentinel.example/stock','POST','None',true,'{stock.update}')
ON CONFLICT (id) DO NOTHING;

INSERT INTO endpoint_test_calls (id, endpoint_id, status) VALUES
  ('TC-1003-01','EP-1003-01','acknowledged')
ON CONFLICT (id) DO NOTHING;

INSERT INTO sandbox_runs (id, partner_id, state) VALUES
  ('SR-1003','PTR-1003','not_started')
ON CONFLICT (id) DO NOTHING;

INSERT INTO onboarding_tasks (id, partner_id, gate_id, title, detail, owner, due) VALUES
  ('OB-1003-01','PTR-1003','tech','Publish a sandbox test order','Place one end-to-end order in sandbox so fulfilment and settlement can be verified before go-live.','You','In 2 days'),
  ('OB-1003-02','PTR-1003','tech','Authenticate the stock sync endpoint','The stock sync endpoint accepts unauthenticated requests. Order payloads carry buyer data.','You','Today'),
  ('OB-1003-03','PTR-1003','assure','Security questionnaire','42-question baseline covering data handling, retention and sub-processors.','You',NULL),
  ('OB-1004-01','PTR-1004','finance','Verify the settlement account','Micro-deposit confirmation on the nominated account.','You','In 3 days')
ON CONFLICT (id) DO NOTHING;
