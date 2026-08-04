/*
  # A seller's endpoints are records, not a constant

  The Integrations screen renders `PARTNER_ENDPOINTS` — three objects in
  `src/components/partner/data.ts` describing Nimbus Sensors' webhooks. Every
  seller who signs in sees Nimbus's URLs. `partner_endpoints` has existed the
  whole time and holds two rows, both belonging to Sentinel Cyber, which no
  screen has ever read.

  Four buttons on that screen raise a toast and do nothing: API keys, Add an
  endpoint, Send a test call, Configure. The last two are the interesting ones —
  a seller whose fulfilment webhook is failing is told so by a banner, offered a
  "send a test call" link, and the link lies to them: it says "200 OK" whatever
  the endpoint does.

  This migration gives the table the columns the screen needs, records a test
  call as a fact rather than a claim, and puts real endpoints behind the sellers
  who trade through them.

  1. Columns on `partner_endpoints`
     - `env` — Sandbox or Production. A seller on sandbox is not live, and the
       screen says so; without the column it was asserting it.
     - `retry`, `timeout_ms` — what the marketplace does when the endpoint is
       slow or fails. These are the marketplace's promises to the seller and
       belong beside the URL they apply to.
     - `note` — why an endpoint is in the state it is in.
     - `sort_order` — a stable order, so the table does not reshuffle on reload.

  2. Columns on `endpoint_test_calls`
     - `ms`, `detail`, `called_by` — a test call that records only "failed" tells
       the seller nothing they can act on. The status line and the round trip are
       what they take to their own logs.

  3. Health is derived, never stored
     There is no `health` column, on purpose. Health is what the last few calls
     did; a column would be a second copy of that, free to disagree with the
     calls it summarises, and it is exactly the kind of field that goes stale
     while a screen keeps rendering it confidently.

  4. Security
     `endpoint_scope_endpoint_test_calls` checked only that the endpoint exists —
     `exists (select 1 from partner_endpoints e where e.id = ...)` with nothing
     about who owns it. Any signed-in user could read or write the call history
     of any seller's endpoints. Replaced with the ownership test it was meant to
     be.

  5. Data
     Endpoints for the six live sellers who have something to fulfil, with the
     call history that makes Nimbus's fulfilment webhook failing — which the
     dashboard already tells that seller — true.
*/

alter table partner_endpoints
  add column if not exists env        text    not null default 'Sandbox',
  add column if not exists retry      text    not null default '3 attempts, exponential backoff',
  add column if not exists timeout_ms integer not null default 5000,
  add column if not exists note       text,
  add column if not exists sort_order integer not null default 0;

alter table partner_endpoints drop constraint if exists partner_endpoints_env_ck;
alter table partner_endpoints add constraint partner_endpoints_env_ck
  check (env in ('Sandbox', 'Production'));

alter table partner_endpoints drop constraint if exists partner_endpoints_timeout_ck;
alter table partner_endpoints add constraint partner_endpoints_timeout_ck
  check (timeout_ms between 500 and 60000);

alter table endpoint_test_calls
  add column if not exists ms        integer,
  add column if not exists detail    text,
  add column if not exists called_by text;

/* The one row already there says 'acknowledged', which is what an endpoint
   returning 2xx did. It is the same fact as 'ok' under a longer name, and two
   spellings of one outcome is how a success rate ends up counting half its
   successes as something else. */
update endpoint_test_calls set status = 'ok' where status = 'acknowledged';

alter table endpoint_test_calls drop constraint if exists endpoint_test_calls_status_ck;
alter table endpoint_test_calls add constraint endpoint_test_calls_status_ck
  check (status in ('ok', 'failed', 'timeout'));

/* ------------------------------------------------------------- security --- */

/* The old policy's whole test was that the endpoint row existed. It named
   `partner_endpoints` and then asked it nothing, which reads as scoping and is
   not: every signed-in user passed it for every endpoint in the table. */
drop policy if exists endpoint_scope_endpoint_test_calls on endpoint_test_calls;

create policy operator_all_endpoint_test_calls on endpoint_test_calls
  for all to authenticated
  using (current_persona() = 'operator')
  with check (current_persona() = 'operator');

create policy partner_own_endpoint_test_calls on endpoint_test_calls
  for all to authenticated
  using (
    exists (
      select 1 from partner_endpoints e
      where e.id = endpoint_test_calls.endpoint_id
        and e.partner_id = current_partner_id()
    )
  )
  with check (
    exists (
      select 1 from partner_endpoints e
      where e.id = endpoint_test_calls.endpoint_id
        and e.partner_id = current_partner_id()
    )
  );

/* ----------------------------------------------------------------- data --- */

/* Sentinel's two rows predate this and have no env or retry of their own; they
   take the defaults, which is what they were always shown as. */
update partner_endpoints set note = 'Live since the technical gate cleared.', sort_order = 1
  where id = 'EP-1003-01' and note is null;
update partner_endpoints set note = 'Polled hourly by the catalogue sync.', sort_order = 2
  where id = 'EP-1003-02' and note is null;

insert into partner_endpoints (id, partner_id, name, url, method, auth, enabled, events, env, retry, timeout_ms, note, sort_order) values
  /* Nimbus Sensors — the demo seller. The dashboard tells this seller their
     fulfilment webhook is failing on retry; the calls below are why. */
  ('EP-1004-01', 'PTR-1004', 'Fulfilment webhook', 'https://api.nimbus-sensors.example/fulfil/callback', 'POST', 'HMAC-SHA256', true,  array['order.created','order.cancelled'], 'Sandbox', '3 attempts, exponential backoff', 5000,  'Returning HTTP 500 on the retry leg since the 28th.', 1),
  ('EP-1004-02', 'PTR-1004', 'Stock sync',         'https://api.nimbus-sensors.example/stock/sync',      'GET',  'Bearer token', true,  array['stock.update'],                     'Sandbox', '2 attempts',                     3000,  null, 2),
  ('EP-1004-03', 'PTR-1004', 'Catalogue feed',     'https://api.nimbus-sensors.example/catalogue/feed',  'GET',  'API key',      false, array['catalogue.sync'],                   'Sandbox', '1 attempt',                      10000, 'Registered but not enabled — the feed is still hand-uploaded.', 3),

  ('EP-1001-01', 'PTR-1001', 'Entitlement callback', 'https://api.streamnova.example/entitlements', 'POST', 'HMAC-SHA256', true, array['order.created','subscription.renewed'], 'Production', '3 attempts, exponential backoff', 4000, null, 1),
  ('EP-1001-02', 'PTR-1001', 'Cancellation hook',    'https://api.streamnova.example/cancel',       'POST', 'HMAC-SHA256', true, array['order.cancelled'],                      'Production', '3 attempts, exponential backoff', 4000, null, 2),

  ('EP-1002-01', 'PTR-1002', 'Despatch callback', 'https://edi.kestreldevices.example/despatch', 'POST', 'Mutual TLS', true, array['order.created'],  'Production', '5 attempts, exponential backoff', 8000, 'Runs against the warehouse EDI bridge.', 1),
  ('EP-1002-02', 'PTR-1002', 'Stock levels',      'https://edi.kestreldevices.example/stock',    'GET',  'Mutual TLS', true, array['stock.update'],   'Production', '2 attempts',                      3000, null, 2),
  ('EP-1002-03', 'PTR-1002', 'Returns notice',    'https://edi.kestreldevices.example/returns',  'POST', 'Mutual TLS', true, array['order.refunded'], 'Production', '3 attempts, exponential backoff', 6000, null, 3),

  ('EP-1008-01', 'PTR-1008', 'Provisioning webhook', 'https://api.voltarouters.example/provision', 'POST', 'Bearer token', true,  array['order.created'], 'Production', '3 attempts, exponential backoff', 5000, null, 1),
  ('EP-1008-02', 'PTR-1008', 'RMA callback',         'https://api.voltarouters.example/rma',       'POST', 'Bearer token', false, array['order.refunded'], 'Sandbox',   '2 attempts',                      5000, 'Waiting on the returns process being signed off.', 2),

  ('EP-1010-01', 'PTR-1010', 'Tenant provisioning', 'https://api.clearvault.example/tenants',  'POST', 'OAuth2 client credentials', true, array['order.created','subscription.renewed'], 'Production', '4 attempts, exponential backoff', 9000, 'Tenant creation is slow by design — the timeout is deliberate.', 1),
  ('EP-1010-02', 'PTR-1010', 'Seat sync',           'https://api.clearvault.example/seats',    'POST', 'OAuth2 client credentials', true, array['subscription.updated'],                 'Production', '3 attempts, exponential backoff', 5000, null, 2),

  ('EP-1011-01', 'PTR-1011', 'Device activation', 'https://hooks.trackwise.example/activate', 'POST', 'API key', true, array['order.created'], 'Sandbox', '3 attempts, exponential backoff', 5000, 'Sandbox until the technical gate clears.', 1)
on conflict (id) do nothing;

/* The call history. Nimbus's fulfilment webhook is 2 of 5 — which is the "40%
   success, 3 failed, all on one endpoint" the screen has been asserting from a
   hard-coded string. Everything else has a clean run behind it, because a
   marketplace where every seller's webhook is broken is not a marketplace. */
insert into endpoint_test_calls (id, endpoint_id, status, called_at, ms, detail, called_by) values
  ('ETC-0001', 'EP-1004-01', 'ok',     now() - interval '9 days',  312,  'HTTP 200 · signature verified',            'Rajesh Kumar'),
  ('ETC-0002', 'EP-1004-01', 'ok',     now() - interval '8 days',  298,  'HTTP 200 · signature verified',            'Rajesh Kumar'),
  ('ETC-0003', 'EP-1004-01', 'failed', now() - interval '6 days',  1840, 'HTTP 500 · upstream returned no body',     'Rajesh Kumar'),
  ('ETC-0004', 'EP-1004-01', 'failed', now() - interval '3 days',  2110, 'HTTP 500 · upstream returned no body',     'Rajesh Kumar'),
  ('ETC-0005', 'EP-1004-01', 'failed', now() - interval '1 day',   5000, 'Timed out after 5000ms on the retry leg',  'Rajesh Kumar'),
  ('ETC-0006', 'EP-1004-02', 'ok',     now() - interval '2 days',  184,  'HTTP 200 · 41 SKUs returned',              'Rajesh Kumar'),
  ('ETC-0007', 'EP-1004-02', 'ok',     now() - interval '5 hours', 176,  'HTTP 200 · 41 SKUs returned',              'Rajesh Kumar'),

  ('ETC-0008', 'EP-1002-01', 'ok', now() - interval '4 days',  620, 'HTTP 202 · queued at the EDI bridge', 'Priya Iyer'),
  ('ETC-0009', 'EP-1002-01', 'ok', now() - interval '1 day',   588, 'HTTP 202 · queued at the EDI bridge', 'Priya Iyer'),
  ('ETC-0010', 'EP-1001-01', 'ok', now() - interval '7 days',  221, 'HTTP 200 · entitlement granted',      'Marcus Webb'),
  ('ETC-0011', 'EP-1010-01', 'ok', now() - interval '2 days', 3400, 'HTTP 201 · tenant created',           'Sofia Almeida'),
  ('ETC-0012', 'EP-1011-01', 'failed', now() - interval '10 days', 900, 'HTTP 401 · API key rejected',     'Dev Menon'),
  ('ETC-0013', 'EP-1011-01', 'ok',     now() - interval '9 days',  410, 'HTTP 200 · key rotated and accepted', 'Dev Menon')
on conflict (id) do nothing;

/* ----------------------------------------------------------- assertions --- */

do $$
declare
  n integer;
begin
  select count(*) into n from partner_endpoints where partner_id = 'PTR-1004';
  if n <> 3 then
    raise exception 'The demo seller has % endpoints, and the screen expects three', n;
  end if;

  /* The banner on the dashboard says the fulfilment webhook is failing. If the
     calls behind it ever say otherwise, one of the two is lying to the seller. */
  select count(*) into n from endpoint_test_calls
   where endpoint_id = 'EP-1004-01' and status <> 'ok';
  if n < 1 then
    raise exception 'The seller is told their fulfilment webhook is failing, and no call says so';
  end if;

  /* Every call belongs to an endpoint somebody owns. A call whose endpoint has
     been deleted is a row nobody can read and nobody can delete. */
  select count(*) into n from endpoint_test_calls c
   where not exists (select 1 from partner_endpoints e where e.id = c.endpoint_id);
  if n > 0 then
    raise exception '% test calls point at an endpoint that does not exist', n;
  end if;

  select count(*) into n from pg_policies
   where tablename = 'endpoint_test_calls' and policyname = 'endpoint_scope_endpoint_test_calls';
  if n > 0 then
    raise exception 'The unscoped test-call policy is still in place';
  end if;
end $$;
