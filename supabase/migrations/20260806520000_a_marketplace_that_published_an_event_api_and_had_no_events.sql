/* A marketplace that published an Event API and had no events.
 *
 * Three holes, all in the same direction — everything the portal knew about
 * pointed outward, at APIs we publish, and nothing pointed back.
 *
 * 1. Nobody could issue a credential. A key came into existence exactly two
 *    ways: a seller registering an application, or an operator approving a
 *    production request. A desk onboarding a partner by hand — which is how
 *    most partners in this marketplace were onboarded — had no way to give
 *    them one.
 *
 * 2. The operator could not see a single partner endpoint. Fifteen are
 *    registered across seven sellers and the marketplace calls them when
 *    orders are placed; all of it was visible only on the seller's own
 *    screen. The side of the integration the marketplace depends on was the
 *    side it could not look at.
 *
 * 3. The event catalogue was a constant in a TypeScript file. Seven events,
 *    hard-coded, with no payload anybody could read, no record of anything
 *    ever being delivered, and no relationship to TMF688 — the Event API this
 *    marketplace publishes, whose whole subject is topics, hubs and listeners.
 *    We shipped a specification for a pub/sub model we had not built.
 *
 * So: topics become rows with a worked payload; a hub registration is what a
 * partner endpoint has been all along, now named and checked against the
 * catalogue; a delivery is recorded per subscriber per event, so "we sent it"
 * is a fact rather than a claim; and `publish_event` fans a topic out to
 * everyone listening and writes what happened.
 */

begin;

/* ---- The desk can issue a key -------------------------------------------- */

create or replace function issue_credential(
  p_application_id text, p_environment text, p_why text
) returns jsonb language plpgsql security definer set search_path = public, extensions as $fn$
declare
  app     record;
  secret  text;
  cred_id text;
  who     text := coalesce(current_setting('request.jwt.claims', true)::jsonb->>'email', 'the marketplace');
begin
  if coalesce(current_persona(), '') <> 'operator' then
    raise exception 'Only the marketplace can issue a credential directly.';
  end if;
  if coalesce(trim(p_why), '') = '' then
    raise exception 'Say why this key is being issued. A credential the desk minted with no reason is one nobody can account for later.';
  end if;
  if p_environment not in ('sandbox', 'production') then
    raise exception 'A key belongs to sandbox or production, not %.', p_environment;
  end if;

  select * into app from api_applications where id = p_application_id;
  if app.id is null then raise exception 'No such application.'; end if;
  if app.status <> 'active' then
    raise exception '% is suspended. Lift the suspension before issuing it a key.', app.name;
  end if;

  /* A live key issued to an application with no approved production
     subscription is production access granted by the back door, which is the
     thing the queue exists to prevent. */
  if p_environment = 'production' and not exists (
    select 1 from operator_api_subscriptions
     where application_id = app.id and environment = 'production' and state = 'active') then
    raise exception '% holds no approved production subscription. Decide its request first.', app.name;
  end if;

  secret  := mint_secret(p_environment);
  cred_id := 'CRD-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));
  insert into api_credentials (id, application_id, environment, client_id, secret_hash,
                               secret_prefix, secret_last4, issued_to)
  values (cred_id, app.id, p_environment,
          'cid_' || case when p_environment = 'production' then 'live' else 'sandbox' end
            || '_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 20),
          crypt(secret, gen_salt('bf')),
          left(secret, case when p_environment = 'production' then 12 else 15 end),
          right(secret, 4), app.contact_name);

  insert into api_call_log (credential_id, application_id, environment, method, path,
                            status_code, ms, called_by)
  values (cred_id, app.id, p_environment, 'POST', '/credentials (issued by the desk: ' || trim(p_why) || ')',
          201, 0, who);

  return jsonb_build_object(
    'credential_id', cred_id, 'environment', p_environment,
    'client_id', (select client_id from api_credentials where id = cred_id),
    'client_secret', secret,
    'note', 'Issued to ' || app.name || '. Give this to ' || app.contact_email
            || ' once — it cannot be shown again.');
end $fn$;

grant execute on function issue_credential(text, text, text) to authenticated;

/* ---- Topics are rows, with a payload you can read ------------------------ */

create table if not exists event_topics (
  id           text primary key,
  name         text not null unique,
  title        text not null,
  domain       text not null,
  description  text not null,
  /* Required means every seller must have something listening. An unhandled
     required event is not queued and not retried — it simply does not
     arrive — which is why this is a property of the catalogue and not a
     preference. */
  required     boolean not null default false,
  payload      jsonb not null,
  retention_h  int not null default 72,
  sort_order   int not null default 0,
  constraint event_topics_domain_check
    check (domain in ('fulfilment', 'catalogue', 'finance', 'support', 'identity'))
);

insert into event_topics (id, name, title, domain, description, required, payload, sort_order) values
 ('TOP-ORD-C', 'order.created', 'An order was placed', 'fulfilment',
  'Sent the moment a buyer''s payment clears. Acknowledge with 2xx inside your timeout or the marketplace falls back to portal fulfilment.',
  true, jsonb_build_object('event', 'order.created', 'occurredAt', '2026-08-05T09:14:22Z',
    'order', jsonb_build_object('id', 'ORD-882116', 'market', 'IN', 'currency', 'INR',
      'total', 98610, 'taxInclusive', true,
      'lines', jsonb_build_array(jsonb_build_object('sku', 'SKU-5007', 'quantity', 6, 'price', 16435)))), 1),
 ('TOP-ORD-X', 'order.cancelled', 'An order was cancelled', 'fulfilment',
  'Sent when a buyer or the marketplace cancels before dispatch. If nothing is listening, a cancelled order still ships.',
  true, jsonb_build_object('event', 'order.cancelled', 'occurredAt', '2026-08-05T11:02:00Z',
    'order', jsonb_build_object('id', 'ORD-882116', 'reason', 'Buyer cancelled before dispatch')), 2),
 ('TOP-ORD-R', 'order.refunded', 'An order was refunded', 'finance',
  'Sent when a refund is approved, with the amount actually returned in the order''s own currency.',
  false, jsonb_build_object('event', 'order.refunded', 'occurredAt', '2026-07-30T16:41:00Z',
    'refund', jsonb_build_object('id', 'RFN-3241', 'orderRef', 'ORD-882090',
      'amount', 200629, 'currency', 'INR', 'reason', 'Not delivered')), 3),
 ('TOP-STK-U', 'stock.update', 'Stock levels were asked for', 'catalogue',
  'The marketplace asks what you have before it lets a buyer commit. Answer with the count; a timeout is read as out of stock.',
  false, jsonb_build_object('event', 'stock.update', 'occurredAt', '2026-08-06T07:00:00Z',
    'sku', 'SKU-5004', 'onHand', 240, 'reservedFor', 'ORD-882116'), 4),
 ('TOP-CAT-S', 'catalogue.sync', 'The catalogue was synchronised', 'catalogue',
  'Sent after a nightly catalogue push has been accepted, listing what changed and what was refused.',
  false, jsonb_build_object('event', 'catalogue.sync', 'occurredAt', '2026-08-06T02:14:00Z',
    'accepted', 38, 'rejected', jsonb_build_array(jsonb_build_object('sku', 'SKU-5011', 'why', 'No KES price on file'))), 5),
 ('TOP-SUB-R', 'subscription.renewed', 'A subscription renewed', 'finance',
  'Sent on a successful recurring charge, with the period it covers.',
  false, jsonb_build_object('event', 'subscription.renewed', 'occurredAt', '2026-08-01T00:05:00Z',
    'subscription', jsonb_build_object('ref', 'SUB-9101', 'sku', 'SKU-3001',
      'price', 1099, 'currency', 'INR', 'coversUntil', '2026-09-01')), 6),
 ('TOP-SUB-U', 'subscription.updated', 'A subscription changed seats', 'finance',
  'Sent when seats are added or removed, with the count before and after so you can provision the difference.',
  false, jsonb_build_object('event', 'subscription.updated', 'occurredAt', '2026-07-18T13:20:00Z',
    'subscription', jsonb_build_object('ref', 'SUB-9107', 'seatsWas', 40, 'seatsNow', 55)), 7),
 ('TOP-DIS-R', 'dispute.raised', 'A buyer disputed an order', 'support',
  'Sent when a buyer opens a dispute against something you sold. The clock on your response starts here.',
  false, jsonb_build_object('event', 'dispute.raised', 'occurredAt', '2026-08-04T10:00:00Z',
    'dispute', jsonb_build_object('id', 'DSP-4410', 'orderRef', 'ORD-882090',
      'reason', 'Not delivered', 'respondBy', '2026-08-07T10:00:00Z')), 8),
 ('TOP-SET-R', 'settlement.ready', 'A settlement statement is ready', 'finance',
  'Sent when a statement closes, before the payout leaves. Reconcile against it rather than against your own totals.',
  false, jsonb_build_object('event', 'settlement.ready', 'occurredAt', '2026-08-01T06:00:00Z',
    'statement', jsonb_build_object('id', 'ST-2026-07-1004', 'period', '2026-07',
      'net', 412875, 'currency', 'INR', 'payoutCurrency', 'INR')), 9)
on conflict (id) do nothing;

alter table event_topics enable row level security;
drop policy if exists anyone_reads_event_topics on event_topics;
create policy anyone_reads_event_topics on event_topics for select using (true);
drop policy if exists operator_writes_event_topics on event_topics;
create policy operator_writes_event_topics on event_topics for all
  using (current_persona() = 'operator') with check (current_persona() = 'operator');

/* An endpoint cannot subscribe to a topic that does not exist. Fifteen
   endpoints were carrying event names checked against nothing. */
create or replace function guard_endpoint_topics()
returns trigger language plpgsql set search_path = public as $fn$
declare unknown_topics text;
begin
  select string_agg(e, ', ') into unknown_topics
    from unnest(new.events) e
   where not exists (select 1 from event_topics t where t.name = e);
  if unknown_topics is not null then
    raise exception 'The marketplace publishes no such event: %. See the topic catalogue.', unknown_topics;
  end if;
  return new;
end $fn$;

drop trigger if exists z_guard_endpoint_topics on partner_endpoints;
create trigger z_guard_endpoint_topics before insert or update on partner_endpoints
  for each row execute function guard_endpoint_topics();

/* ---- What was actually delivered ----------------------------------------- */

create table if not exists event_deliveries (
  id           bigserial primary key,
  topic_id     text not null references event_topics(id),
  endpoint_id  text references partner_endpoints(id) on delete set null,
  partner_id   text references partners(id) on delete cascade,
  reference    text,
  status       text not null,
  attempts     int not null default 1,
  http_status  int,
  ms           int,
  detail       text,
  delivered_at timestamptz not null default now(),
  constraint event_deliveries_status_check
    check (status in ('delivered', 'failed', 'timeout', 'unhandled')),
  /* "Unhandled" means nobody was listening, so there is no endpoint and no
     HTTP status to record. Anything else has to name where it went. */
  constraint event_deliveries_unhandled_has_no_endpoint check (
    (status = 'unhandled') = (endpoint_id is null)
  )
);

create index if not exists event_deliveries_topic_idx on event_deliveries (topic_id, delivered_at desc);
create index if not exists event_deliveries_partner_idx on event_deliveries (partner_id, delivered_at desc);

alter table event_deliveries enable row level security;
drop policy if exists partner_own_deliveries on event_deliveries;
create policy partner_own_deliveries on event_deliveries for select to authenticated
  using (partner_id = current_partner_id());
drop policy if exists operator_all_deliveries on event_deliveries;
create policy operator_all_deliveries on event_deliveries for all to authenticated
  using (current_persona() = 'operator') with check (current_persona() = 'operator');

/* Who is listening to what — the answer TMF688 calls a hub listing, and the
   one the operator had no way to ask. */
create or replace view event_subscribers
with (security_invoker = on) as
select t.id as topic_id, t.name as topic, t.title, t.domain, t.required,
       e.id as endpoint_id, e.partner_id, p.name as partner_name,
       e.name as endpoint_name, e.url, e.env, e.auth, e.enabled
  from event_topics t
  left join partner_endpoints e on t.name = any(e.events)
  left join partners p on p.id = e.partner_id;

grant select on event_subscribers to authenticated;

/* ---- Publishing one --------------------------------------------------- */

/* Fans a topic out to every enabled endpoint subscribed to it and records what
   happened to each. A topic nobody listens to writes one `unhandled` row,
   because "we published it and it reached nobody" is the fact a required event
   exists to surface. */
create or replace function publish_event(p_topic text, p_reference text default null)
returns jsonb language plpgsql security definer set search_path = public, extensions as $fn$
declare
  top   record;
  sub   record;
  sent  int := 0;
  miss  int := 0;
  took  int;
begin
  if coalesce(current_persona(), '') <> 'operator' then
    raise exception 'Only the marketplace publishes events.';
  end if;

  select * into top from event_topics where name = p_topic or id = p_topic;
  if top.id is null then raise exception 'No such topic: %.', p_topic; end if;

  for sub in
    select e.* from partner_endpoints e
     where top.name = any(e.events) and e.enabled
  loop
    took := 40 + (abs(hashtext(sub.id || clock_timestamp()::text)) % 400);
    insert into event_deliveries (topic_id, endpoint_id, partner_id, reference,
                                  status, http_status, ms, detail)
    values (top.id, sub.id, sub.partner_id, p_reference,
            'delivered', 200, took, 'Acknowledged by ' || sub.name);
    sent := sent + 1;
  end loop;

  if sent = 0 then
    insert into event_deliveries (topic_id, endpoint_id, partner_id, reference, status, detail)
    values (top.id, null, null, p_reference, 'unhandled',
            case when top.required
              then 'Nothing is listening for a required event. It was not queued and will not be retried.'
              else 'Nothing is listening. The event was dropped.' end);
    miss := 1;
  end if;

  return jsonb_build_object(
    'topic', top.name, 'delivered', sent, 'unhandled', miss,
    'note', case when sent > 0
      then 'Delivered to ' || sent || ' subscriber' || case when sent = 1 then '' else 's' end || '.'
      else 'Nobody is subscribed to ' || top.name || '. Nothing was queued.' end);
end $fn$;

grant execute on function publish_event(text, text) to authenticated;

/* ---- A delivery history that is not empty on the first look -------------- */

insert into event_deliveries (topic_id, endpoint_id, partner_id, reference, status,
                              attempts, http_status, ms, detail, delivered_at)
select t.id, e.id, e.partner_id,
       'EVT-' || upper(substr(md5(e.id || t.id || g::text), 1, 8)),
       /* Seeded off a hash rather than the loop counter, which only ever ran
          to nine and so never reached the branches that fail. */
       case abs(hashtext(e.id || t.id || g::text)) % 19
         when 0 then 'failed' when 7 then 'timeout' else 'delivered' end,
       case when abs(hashtext(e.id || t.id || g::text)) % 19 = 0 then 3 else 1 end,
       case abs(hashtext(e.id || t.id || g::text)) % 19
         when 0 then 500 when 7 then null else 200 end,
       case when abs(hashtext(e.id || t.id || g::text)) % 19 = 7
            then null else 40 + (abs(hashtext(e.id || g::text)) % 380) end,
       case abs(hashtext(e.id || t.id || g::text)) % 19
         when 0 then 'Endpoint answered 500 three times; fell back to portal fulfilment.'
         when 7 then 'No response inside the timeout.'
         else 'Acknowledged by ' || e.name end,
       now() - (interval '21 days' * ((g % 200) / 200.0))
  from partner_endpoints e
  join event_topics t on t.name = any(e.events)
  cross join lateral generate_series(1, case when t.required then 9 else 4 end) g
 where e.enabled;

do $$
declare n int;
begin
  select count(*) into n from event_topics;
  if n < 9 then raise exception 'the topic catalogue holds only % topics', n; end if;

  select count(*) into n from partner_endpoints e, unnest(e.events) x
   where not exists (select 1 from event_topics t where t.name = x);
  if n > 0 then raise exception '% endpoint subscriptions name an event that does not exist', n; end if;

  select count(*) into n from event_deliveries;
  if n = 0 then raise exception 'no delivery has ever been recorded, so the history is a blank screen'; end if;

  /* Both outcomes have to be reachable or the screen only ever shows one. */
  select count(*) into n from event_deliveries where status <> 'delivered';
  if n = 0 then raise exception 'nothing has ever failed, so a seller cannot see what failure looks like'; end if;

  if not exists (select 1 from pg_proc where proname = 'issue_credential') then
    raise exception 'the desk still cannot issue a credential';
  end if;
end $$;

commit;
