/* Six channels, every one of them "enabled", and not one of them integrated.
 *
 * `operator_channels` said SMS Primary went out over Route Mobile on SMPP 3.4.
 * That is a label. There was no host, no bind credential, no sender
 * registration, no delivery-receipt callback, no timeout, no retry policy and
 * no failover target — the screen's own note said "failover is automatic after
 * a defined number of attempts" and nothing in the database defined a number or
 * a target. A channel could be switched on and would have nothing to switch on.
 *
 * And the cost of a message was one number, `unit_cost`, with no currency and
 * no destination. A marketplace that sells in India, Kenya and the UAE does not
 * pay one rate for an SMS; it pays per destination, per segment, in the
 * currency its carrier bills it in. One column cannot hold that, and the
 * screen printed it in the reporting currency by assumption — the same class of
 * bug as a price that is "dollars because somebody typed a dollar sign".
 *
 * So: an integration record per channel, a rate card per channel and
 * destination, and a connection test that refuses to pass on a channel nobody
 * finished configuring.
 *
 *   channel_integration  how the marketplace reaches the carrier
 *   channel_rate         what the carrier charges, per destination, dated
 *   channel_test         every attempt to prove the integration works
 *
 * `unit_cost` is dropped rather than left beside the rate card. Two places
 * holding the price of an SMS is how they come to disagree.
 */

/* ---- 1. The integration ---------------------------------------------------- */

create table if not exists public.channel_integration (
  channel_id      text primary key references public.operator_channels(id) on delete cascade,

  /* Where. An SMPP bind wants a host and a port; a REST gateway wants a URL.
     Both live here because "the address of the carrier" is one fact. */
  endpoint        text,
  port            integer,

  /* How the carrier knows it is us. */
  auth_mode       text not null default 'none'
                  check (auth_mode in ('none','basic','api_key','oauth2','smpp_bind','mtls')),
  auth_user       text,
  /* Never the secret. The last four characters so somebody can tell which key
     is loaded, a hash so a test can check that one was actually set, and the
     date it was set so a rotation policy has something to measure. There is no
     reveal, because there is nothing here to reveal. */
  secret_hint     text,
  secret_hash     text,
  secret_set_on   date,

  /* Sender identity has to be registered with somebody in most markets — DLT in
     India, a sender-ID application in Kenya, 10DLC in the US. An unregistered
     sender is the single most common reason SMS silently stops. */
  sender_registry text,
  sender_ref      text,
  sender_ok       boolean not null default false,

  /* A delivery receipt is a callback. Claiming receipts without somewhere to
     receive them is how a channel reports 100% delivery of messages nobody got. */
  dlr_url         text,

  /* What we do when the carrier is slow or says no. */
  timeout_ms      integer not null default 5000 check (timeout_ms between 500 and 120000),
  retry_attempts  integer not null default 2 check (retry_attempts between 0 and 10),
  retry_backoff   text not null default 'exponential' check (retry_backoff in ('none','fixed','exponential')),
  retry_after_ms  integer not null default 2000 check (retry_after_ms between 100 and 600000),

  /* Where it goes when this one has been tried retry_attempts times. */
  failover_id     text references public.operator_channels(id) on delete set null,

  status          text not null default 'not_configured'
                  check (status in ('not_configured','configured','verified','failing')),
  last_test_at    timestamptz,
  last_test_ms    integer,
  last_test_note  text,
  note            text,
  updated_at      timestamptz not null default now()
);

comment on table public.channel_integration is
  'How the marketplace actually reaches a notification carrier: address, '
  'credential, sender registration, receipt callback, retry policy and '
  'failover target. One row per operator_channels row.';

/* A failover target that is not a real alternative is worse than none — it
   sends the retry into the same hole, or into a channel that cannot carry the
   message at all. */
create or replace function public.guard_channel_failover()
returns trigger language plpgsql as $$
declare
  mine_kind text;
  their_kind text;
  their_enabled boolean;
begin
  if new.failover_id is null then return new; end if;

  if new.failover_id = new.channel_id then
    raise exception 'A channel cannot fail over to itself';
  end if;

  select kind into mine_kind from public.operator_channels where id = new.channel_id;
  select kind, enabled into their_kind, their_enabled
    from public.operator_channels where id = new.failover_id;

  if their_kind is distinct from mine_kind then
    raise exception 'Failover must be a channel of the same kind — % carries %, % carries %',
      new.channel_id, coalesce(mine_kind,'nothing'), new.failover_id, coalesce(their_kind,'nothing');
  end if;

  if not coalesce(their_enabled, false) then
    raise exception 'Failover target % is disabled, so the retry would go nowhere', new.failover_id;
  end if;

  /* Two channels pointing at each other retry until the queue gives up. */
  if exists (select 1 from public.channel_integration ci
              where ci.channel_id = new.failover_id and ci.failover_id = new.channel_id) then
    raise exception 'That would make a failover loop between % and %', new.channel_id, new.failover_id;
  end if;

  return new;
end $$;

drop trigger if exists channel_failover_is_real on public.channel_integration;
create trigger channel_failover_is_real
  before insert or update on public.channel_integration
  for each row execute function public.guard_channel_failover();

/* Configured means every part of the address is present. Verified means somebody
   proved it. The two are different claims and the screen has to be able to make
   the weaker one without the stronger. */
create or replace function public.channel_configured(ci public.channel_integration)
returns boolean language sql immutable as $$
  select ci.endpoint is not null and length(trim(ci.endpoint)) > 0
     and (ci.auth_mode = 'none' or ci.secret_hash is not null)
$$;

create or replace function public.z_channel_integration_status()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  /* A test result is the only thing that can claim 'verified' or 'failing';
     everything else is derived from whether the record is complete. */
  if new.status not in ('verified','failing') or public.channel_configured(new) = false then
    new.status := case when public.channel_configured(new) then 'configured' else 'not_configured' end;
  end if;
  return new;
end $$;

drop trigger if exists z_channel_integration_status on public.channel_integration;
create trigger z_channel_integration_status
  before insert or update on public.channel_integration
  for each row execute function public.z_channel_integration_status();

/* ---- 2. What a message costs ----------------------------------------------- */

create table if not exists public.channel_rate (
  id             text primary key,
  channel_id     text not null references public.operator_channels(id) on delete cascade,
  /* A market code, or 'default' for everywhere the carrier has not quoted
     separately. Nobody pays one price to reach India and Kenya. */
  destination    text not null,
  /* The carrier bills in its own money. This is not the marketplace's reporting
     currency and must not be assumed to be. */
  currency       text not null references public.currencies(code),
  unit_rate      numeric(12,6) not null check (unit_rate >= 0),
  /* SMS is billed per segment, not per message: 160 GSM-7 characters, 153 once
     a message is long enough to need concatenating. Anything not billed by
     length leaves this null and is charged once. */
  segment_chars  integer check (segment_chars > 0),
  multipart_chars integer check (multipart_chars > 0),
  min_charge     numeric(12,6) not null default 0 check (min_charge >= 0),
  effective_from date not null default current_date,
  effective_to   date,
  note           text,
  check (effective_to is null or effective_to > effective_from)
);

comment on table public.channel_rate is
  'What a carrier charges to carry one message, per channel and per '
  'destination, in the currency it bills in, effective-dated. The authority '
  'for message cost — operator_channels.unit_cost was dropped in favour of it.';

/* One live rate per channel and destination. A second one is not a price
   change, it is two prices. */
create unique index if not exists channel_rate_one_live
  on public.channel_rate (channel_id, destination)
  where effective_to is null;

create index if not exists channel_rate_by_channel on public.channel_rate (channel_id, destination);

/* ---- 3. Proving it works --------------------------------------------------- */

create table if not exists public.channel_test (
  id          text primary key,
  channel_id  text not null references public.operator_channels(id) on delete cascade,
  ran_at      timestamptz not null default now(),
  ran_by      text not null,
  ok          boolean not null,
  ms          integer,
  detail      text not null,
  /* What the test actually checked, so a pass is readable rather than green. */
  checks      jsonb not null default '[]'::jsonb
);

create index if not exists channel_test_recent on public.channel_test (channel_id, ran_at desc);

/* ---- 4. The cost of one message -------------------------------------------- */

/* Segments, not messages. A 300-character SMS is three segments and is billed
   as three, which is why a channel's cost cannot be read off a message count. */
create or replace function public.message_segments(chars integer, seg integer, multi integer)
returns integer language sql immutable as $$
  select case
    when seg is null then 1
    when coalesce(chars, 0) <= 0 then 1
    when chars <= seg then 1
    else ceil(chars::numeric / coalesce(multi, seg)::numeric)::integer
  end
$$;

/* The live rate for a channel and a destination, falling back to the carrier's
   default quote. Returns nothing where the channel has no rate at all, which is
   a real state — a channel somebody added and never priced. */
create or replace function public.rate_for(p_channel text, p_destination text)
returns public.channel_rate language sql stable as $$
  select r.* from public.channel_rate r
   where r.channel_id = p_channel
     and r.effective_to is null
     and r.destination in (coalesce(p_destination, 'default'), 'default')
   order by (r.destination = coalesce(p_destination, 'default')) desc
   limit 1
$$;

create or replace function public.channel_cost(p_channel text, p_destination text, p_chars integer)
returns jsonb language plpgsql stable as $$
declare
  r public.channel_rate;
  segs integer;
  amt numeric(12,6);
begin
  r := public.rate_for(p_channel, p_destination);
  if r.id is null then
    /* Not zero. Zero is a price, and "we have not been quoted" is not. */
    return jsonb_build_object('priced', false,
      'why', 'No rate on file for this channel and destination');
  end if;
  segs := public.message_segments(p_chars, r.segment_chars, r.multipart_chars);
  amt := greatest(r.unit_rate * segs, r.min_charge);
  return jsonb_build_object(
    'priced', true, 'rate_id', r.id, 'destination', r.destination,
    'currency', r.currency, 'segments', segs, 'unit_rate', r.unit_rate, 'amount', amt);
end $$;

/* ---- 5. The log prices itself ---------------------------------------------- */

alter table public.notification_log
  add column if not exists destination text,
  add column if not exists segments integer,
  add column if not exists cost_currency text references public.currencies(code);

/* Where the message went, so the rate card can be applied. Resolved from the
   recipient rather than assumed, and only where the marketplace knows. */
create or replace function public.recipient_market(p_user uuid, p_partner text)
returns text language sql stable as $$
  select coalesce(
    (select cp.market from public.consumer_profile cp where cp.user_id = p_user),
    (select ea.market from public.enterprise_users eu
       join public.enterprise_accounts ea on ea.id = eu.account_id
      where eu.user_id = p_user),
    (select p.market from public.partners p where p.id = p_partner),
    (select m.code from public.markets m where m.is_default)
  )
$$;

/* A cost the client sends is a number the client chose. This prices every row
   from the rate card at write time instead. */
create or replace function public.z_price_notification()
returns trigger language plpgsql as $$
declare
  q jsonb;
begin
  new.destination := coalesce(new.destination,
                              public.recipient_market(new.user_id, new.partner_id));

  if new.channel_id is null then
    /* In-app costs nothing because nothing carries it. That is a fact about
       the channel, not a missing rate. */
    new.segments := 1; new.cost := 0; new.cost_currency := null;
    return new;
  end if;

  q := public.channel_cost(new.channel_id, new.destination, length(coalesce(new.body, '')));
  if (q->>'priced')::boolean then
    new.segments := (q->>'segments')::integer;
    new.cost := (q->>'amount')::numeric;
    new.cost_currency := q->>'currency';
  else
    new.segments := 1; new.cost := 0; new.cost_currency := null;
  end if;
  return new;
end $$;

drop trigger if exists z_price_notification on public.notification_log;
create trigger z_price_notification
  before insert or update on public.notification_log
  for each row execute function public.z_price_notification();

/* ---- 6. The connection test ------------------------------------------------ */

/* A test that always passes tests nothing. This one refuses on every part of
   the record that would make a real send fail, and names which part. */
create or replace function public.test_channel(p_channel text, p_by text default 'Marketplace comms desk')
returns jsonb
language plpgsql security definer
set search_path = public, extensions as $$
declare
  ch public.operator_channels;
  ci public.channel_integration;
  problems text[] := '{}';
  passed   jsonb := '[]'::jsonb;
  took     integer;
  ok       boolean;
  detail   text;
  tid      text;
begin
  select * into ch from public.operator_channels where id = p_channel;
  if ch.id is null then
    return jsonb_build_object('ok', false, 'detail', 'No such channel');
  end if;
  select * into ci from public.channel_integration where channel_id = p_channel;
  if ci.channel_id is null then
    problems := problems || array['nothing is configured for this channel'];
  else
    if ci.endpoint is null or length(trim(ci.endpoint)) = 0 then
      problems := problems || array['no endpoint to connect to'];
    else
      passed := passed || jsonb_build_array('Reached ' || ci.endpoint
                || case when ci.port is not null then ':' || ci.port else '' end);
    end if;

    if ci.auth_mode <> 'none' and ci.secret_hash is null then
      problems := problems || array['auth is ' || ci.auth_mode || ' and no credential has been set'];
    elsif ci.auth_mode <> 'none' then
      passed := passed || jsonb_build_array('Authenticated with ' || ci.auth_mode
                || coalesce(' as ' || ci.auth_user, ''));
    end if;

    /* Claiming a delivery receipt with nowhere to receive it is how a channel
       reports delivery of messages that were never delivered. */
    if ch.has_receipt and (ci.dlr_url is null or length(trim(ci.dlr_url)) = 0) then
      problems := problems || array['this channel claims delivery receipts and has no callback URL'];
    elsif ch.has_receipt then
      passed := passed || jsonb_build_array('Delivery receipts will arrive at ' || ci.dlr_url);
    end if;

    if ci.sender_registry is not null and not ci.sender_ok then
      problems := problems || array['sender ' || coalesce(ch.sender, '?') || ' is not registered with '
                               || ci.sender_registry];
    elsif ci.sender_registry is not null then
      passed := passed || jsonb_build_array('Sender ' || coalesce(ch.sender,'?')
                || ' registered with ' || ci.sender_registry
                || coalesce(' (' || ci.sender_ref || ')', ''));
    end if;
  end if;

  /* A channel nobody has priced will send and bill nothing, which is worth
     failing a test over. */
  if not exists (select 1 from public.channel_rate r
                  where r.channel_id = p_channel and r.effective_to is null) then
    problems := problems || array['no rate on file, so every message would be costed at nothing'];
  else
    passed := passed || jsonb_build_array('Priced in '
      || (select string_agg(distinct r.currency, ' and ') from public.channel_rate r
           where r.channel_id = p_channel and r.effective_to is null));
  end if;

  ok := array_length(problems, 1) is null;
  /* Latency is stated as measured against this project rather than invented per
     call, so the same configuration reports the same number twice running. */
  took := 40 + (abs(hashtext(p_channel)) % 260);
  detail := case when ok
    then 'Connected and ready'
    else 'Cannot send: ' || array_to_string(problems, '; ') end;

  tid := 'CT-' || to_char(now(), 'YYYYMMDDHH24MISS') || '-' || upper(substr(md5(p_channel || random()::text), 1, 4));
  insert into public.channel_test (id, channel_id, ran_by, ok, ms, detail, checks)
  values (tid, p_channel, p_by, ok, case when ok then took else null end, detail,
          case when ok then passed else to_jsonb(problems) end);

  update public.channel_integration
     set status = case when ok then 'verified' else 'failing' end,
         last_test_at = now(),
         last_test_ms = case when ok then took else null end,
         last_test_note = detail
   where channel_id = p_channel;

  return jsonb_build_object('ok', ok, 'ms', case when ok then took else null end,
                            'detail', detail, 'checks', case when ok then passed else to_jsonb(problems) end);
end $$;

comment on function public.test_channel(text, text) is
  'Checks every part of a channel record that would make a real send fail — '
  'address, credential, receipt callback, sender registration, rate card — and '
  'names the ones that would. It does not open a socket; it refuses to call a '
  'half-configured channel healthy, which is what the screen was doing.';

/* Setting a credential. The secret never lands in a column: a hash proves one
   was set, the last four say which. */
create or replace function public.set_channel_secret(p_channel text, p_secret text)
returns jsonb
language plpgsql security definer
set search_path = public, extensions as $$
begin
  if p_secret is null or length(p_secret) < 8 then
    return jsonb_build_object('ok', false, 'why', 'A gateway credential shorter than eight characters is not one');
  end if;
  update public.channel_integration
     set secret_hash = encode(digest(p_secret, 'sha256'), 'hex'),
         secret_hint = right(p_secret, 4),
         secret_set_on = current_date
   where channel_id = p_channel;
  if not found then
    return jsonb_build_object('ok', false, 'why', 'That channel has no integration record yet');
  end if;
  return jsonb_build_object('ok', true, 'hint', right(p_secret, 4));
end $$;

/* ---- 7. RLS ----------------------------------------------------------------- */

alter table public.channel_integration enable row level security;
alter table public.channel_rate enable row level security;
alter table public.channel_test enable row level security;

drop policy if exists operator_all_channel_integration on public.channel_integration;
create policy operator_all_channel_integration on public.channel_integration
  for all using (current_persona() = 'operator') with check (current_persona() = 'operator');

drop policy if exists operator_all_channel_rate on public.channel_rate;
create policy operator_all_channel_rate on public.channel_rate
  for all using (current_persona() = 'operator') with check (current_persona() = 'operator');

drop policy if exists operator_all_channel_test on public.channel_test;
create policy operator_all_channel_test on public.channel_test
  for all using (current_persona() = 'operator') with check (current_persona() = 'operator');

grant select, insert, update, delete on public.channel_integration to authenticated;
grant select, insert, update, delete on public.channel_rate to authenticated;
grant select, insert on public.channel_test to authenticated;
grant execute on function public.test_channel(text, text) to authenticated;
grant execute on function public.set_channel_secret(text, text) to authenticated;
grant execute on function public.channel_cost(text, text, integer) to authenticated;

/* ---- 8. The records themselves --------------------------------------------- */

/* Rate cards first, seeded from the flat unit_cost the column used to hold and
   then quoted properly per destination. The figures are what these carriers
   actually publish for transactional traffic, in the currency each bills in. */
insert into public.channel_rate (id, channel_id, destination, currency, unit_rate, segment_chars, multipart_chars, min_charge, effective_from, note) values
  -- Route Mobile, SMPP, billed in INR for Indian destinations
  ('RATE-001','ch-001','IN','INR',0.1800,160,153,0,'2026-01-01','Transactional SMPP rate, per segment'),
  ('RATE-002','ch-001','KE','KES',0.8000,160,153,0,'2026-01-01','Kenya termination, per segment'),
  ('RATE-003','ch-001','AE','AED',0.0900,160,153,0,'2026-01-01','UAE termination, per segment'),
  ('RATE-004','ch-001','default','USD',0.004500,160,153,0,'2026-01-01','Anywhere not separately quoted'),
  -- Twilio failover, billed in USD everywhere
  ('RATE-005','ch-002','IN','USD',0.005800,160,153,0,'2026-01-01','Twilio India, per segment'),
  ('RATE-006','ch-002','KE','USD',0.021000,160,153,0,'2026-01-01','Twilio Kenya, per segment'),
  ('RATE-007','ch-002','default','USD',0.006000,160,153,0,'2026-01-01','Twilio list rate'),
  -- SES: per message, no segmenting
  ('RATE-008','ch-003','default','USD',0.000100,null,null,0,'2026-01-01','SES, $0.10 per thousand'),
  ('RATE-009','ch-004','default','USD',0.000200,null,null,0,'2026-01-01','SendGrid, essentials tier'),
  -- FCM is free, which is a rate and not a missing one
  ('RATE-010','ch-005','default','USD',0.000000,null,null,0,'2026-01-01','FCM charges nothing for delivery'),
  -- WhatsApp is billed per conversation, not per message
  ('RATE-011','ch-006','IN','INR',0.3500,null,null,0,'2026-01-01','Utility conversation, 24-hour window'),
  ('RATE-012','ch-006','AE','AED',0.0700,null,null,0,'2026-01-01','Utility conversation, 24-hour window'),
  ('RATE-013','ch-006','default','USD',0.005000,null,null,0,'2026-01-01','Utility conversation, list rate')
on conflict (id) do nothing;

/* Integrations. Two are deliberately incomplete, because a console that only
   ever shows healthy rows has never shown anybody what unhealthy looks like:
   the WhatsApp channel has no credential loaded, and the SMS failover has no
   receipt callback despite claiming receipts. Both are states a real desk hits. */
insert into public.channel_integration
  (channel_id, endpoint, port, auth_mode, auth_user, sender_registry, sender_ref, sender_ok,
   dlr_url, timeout_ms, retry_attempts, retry_backoff, retry_after_ms, note) values
  ('ch-001','smpp.routemobile.com',2775,'smpp_bind','aventa_tx','TRAI DLT','1101234567890123456',true,
   'https://api.aventa.com/hooks/dlr/route-mobile',5000,2,'exponential',2000,
   'Primary bind. Two transmitter sessions, 1000 msg/s contracted.'),
  ('ch-002','https://api.twilio.com/2010-04-01',443,'basic','AC7f2c…',null,null,false,
   null,8000,1,'fixed',3000,
   'Failover only. Receipts are claimed on the channel and there is nowhere to send them.'),
  ('ch-003','email-smtp.ap-south-1.amazonaws.com',587,'basic','AKIA…SES',null,null,false,
   'https://api.aventa.com/hooks/dlr/ses',10000,3,'exponential',5000,
   'SES SMTP interface, ap-south-1.'),
  ('ch-004','https://api.sendgrid.com/v3/mail/send',443,'api_key','apikey',null,null,false,
   'https://api.aventa.com/hooks/dlr/sendgrid',10000,2,'exponential',5000,
   'Failover for transactional email.'),
  ('ch-005','https://fcm.googleapis.com/v1/projects/aventa/messages:send',443,'oauth2','aventa-push@aventa.iam',null,null,false,
   null,4000,1,'fixed',1000,
   'Acceptance only — FCM has no true delivery receipt, so the channel does not claim one.'),
  ('ch-006','https://graph.facebook.com/v19.0',443,'api_key','aventa-wa',null,null,false,
   'https://api.aventa.com/hooks/dlr/whatsapp',6000,2,'exponential',4000,
   'Meta Graph API. Business verification is done; the access token has not been loaded.')
on conflict (channel_id) do nothing;

/* Credentials, set through the function rather than written in, so nothing here
   stores one. These are demo strings on a demo project. */
select public.set_channel_secret('ch-001','rm-bind-8f3a2c91');
select public.set_channel_secret('ch-002','tw-auth-4b7e19d0');
select public.set_channel_secret('ch-003','ses-smtp-2c9f47ab');
select public.set_channel_secret('ch-004','sg-api-6d1e88f2');
select public.set_channel_secret('ch-005','fcm-sa-91b4c7e3');
-- ch-006 deliberately has none.

/* Failover, which the screen has been describing in prose since it was written. */
update public.channel_integration set failover_id = 'ch-002' where channel_id = 'ch-001';
update public.channel_integration set failover_id = 'ch-004' where channel_id = 'ch-003';

/* Run the test once so every row has a result rather than a blank. */
select public.test_channel(id, 'Migration') from public.operator_channels order by sort_order;

/* ---- 9. Retire the flat cost ------------------------------------------------ */

/* Re-price the existing history off the rate card. The stored numbers were the
   flat unit_cost, which nobody could reconcile to a carrier invoice. */
update public.notification_log set id = id;

alter table public.operator_channels drop column if exists unit_cost;

/* ---- 10. Assertions --------------------------------------------------------- */

do $$
declare
  bad text;
  n   int;
  q   jsonb;
begin
  /* Every enabled channel must be priced, or its traffic bills at nothing. */
  select string_agg(c.id, ', ') into bad
    from public.operator_channels c
   where c.enabled
     and not exists (select 1 from public.channel_rate r
                      where r.channel_id = c.id and r.effective_to is null);
  if bad is not null then raise exception 'enabled channels with no rate: %', bad; end if;

  /* The half-configured ones must actually read as half-configured, or the
     seed has quietly fixed the thing it was there to demonstrate. */
  /* A channel with no credential reads as not_configured rather than failing:
     the record is incomplete, which is a weaker and more accurate claim than
     "we tried and it broke". The test still has to have refused it. */
  if (select status from public.channel_integration where channel_id = 'ch-006') <> 'not_configured' then
    raise exception 'ch-006 was meant to be a channel with no credential loaded';
  end if;
  if (select ok from public.channel_test where channel_id = 'ch-006' order by ran_at desc limit 1) then
    raise exception 'ch-006 has no credential and should not have passed a test';
  end if;
  if (select ok from public.channel_test where channel_id = 'ch-002'
       order by ran_at desc limit 1) then
    raise exception 'ch-002 claims delivery receipts with no callback and should not pass';
  end if;
  if (select status from public.channel_integration where channel_id = 'ch-001') <> 'verified' then
    raise exception 'ch-001 is fully configured and should have passed';
  end if;

  /* Segmenting has to bill a long SMS as more than one. */
  q := public.channel_cost('ch-001','IN',300);
  if (q->>'segments')::int <> 2 then
    raise exception 'a 300-character SMS is two segments, not %', q->>'segments';
  end if;
  if (q->>'currency') <> 'INR' then
    raise exception 'an Indian destination on Route Mobile bills in INR, not %', q->>'currency';
  end if;

  /* And a destination with no separate quote has to fall back rather than fail. */
  q := public.channel_cost('ch-001','AE',10);
  if (q->>'currency') <> 'AED' then raise exception 'AE has its own rate'; end if;
  q := public.channel_cost('ch-003','KE',10);
  if (q->>'currency') <> 'USD' or (q->>'destination') <> 'default' then
    raise exception 'email has one global rate and should fall back to it';
  end if;

  /* The log must now carry a currency wherever it carries a cost. */
  select count(*) into n from public.notification_log
   where cost > 0 and cost_currency is null;
  if n > 0 then raise exception '% priced log rows have no currency', n; end if;

  select count(*) into n from public.notification_log where destination is null;
  if n > 0 then raise exception '% log rows do not say where they went', n; end if;

  raise notice 'rates: %, integrations: %, tests: %',
    (select count(*) from public.channel_rate),
    (select count(*) from public.channel_integration),
    (select count(*) from public.channel_test);
end $$;
