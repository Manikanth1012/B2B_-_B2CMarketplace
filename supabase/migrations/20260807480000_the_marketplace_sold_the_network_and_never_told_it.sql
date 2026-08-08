/* The marketplace sold the network and never told it.
 *
 * Twenty-one products are provisioned by the telco: mobile plans, eSIMs, data
 * and roaming add-ons, IoT SIM estates, wholesale lines. Every one of them ends
 * in a subscriber record, an APN and a rating rule inside systems the
 * marketplace does not own. The marketplace takes the order, takes the money,
 * settles the seller — and nothing anywhere sends the order to the system that
 * would actually turn the service on.
 *
 * What goes downstream is a Customer Order Management system, one per market,
 * and the interface is TMF622 Product Ordering, which is the same standard the
 * marketplace already publishes to its own sellers. That symmetry is worth
 * stating plainly, because the developer portal is built entirely around APIs
 * the marketplace PUBLISHES and this is the first one it CONSUMES. A screen
 * that mixed the two would have an operator wondering why they cannot approve a
 * subscription to it.
 *
 * Three things make this a model rather than a queue table:
 *
 *   THE MAPPING IS DATA. Which marketplace field lands at which TMF path is a
 *   table, and the payload is folded out of that table rather than written by
 *   hand. A mapping screen built beside a hand-written payload builder is two
 *   descriptions of one thing, and the screen is always the one that is wrong.
 *
 *   A REJECTION AND A TIMEOUT ARE NOT THE SAME FAILURE. A required
 *   characteristic that resolved to nothing will resolve to nothing again, and
 *   retrying it four more times wastes four more attempts and buries the reason.
 *   A transport failure is exactly the thing retries exist for. They get
 *   different states and only one of them is retried.
 *
 *   AN ORDER IS NOT FULFILLED WHEN IT IS SENT. Acknowledged, in progress and
 *   completed are three different answers to "has the customer got their
 *   service", and a marketplace that treats a 201 from the order manager as
 *   delivery tells the buyer their SIM is live while it is still in a work
 *   order queue.
 */

/* ---- 1. The systems downstream ------------------------------------------------ */

create table if not exists public.com_system (
  id            text primary key,
  market        text not null references public.markets(code),
  name          text not null,
  vendor        text not null,

  /* The interface, named. A marketplace that pushes to three order managers
     through three bespoke shapes has three integrations to maintain; naming
     the standard is what makes it one. */
  standard      text not null default 'TMF622',
  api_version   text not null,
  base_url      text not null,
  auth          text not null check (auth in ('oauth2-client-credentials', 'mtls', 'api-key')),
  token_url     text,

  timeout_ms    integer not null default 15000 check (timeout_ms between 1000 and 120000),
  max_attempts  integer not null default 5 check (max_attempts between 1 and 20),
  /* First retry after this many seconds, doubling. */
  backoff_seconds integer not null default 60 check (backoff_seconds > 0),
  /* How long an acknowledgement may take before somebody should look. Sent and
     silent is the state that quietly loses orders. */
  ack_sla_seconds integer not null default 300 check (ack_sla_seconds > 0),

  environment   text not null default 'production' check (environment in ('production', 'sandbox')),
  status        text not null default 'live' check (status in ('live', 'degraded', 'down')),
  status_note   text,
  contact       text,
  note          text,
  sort_order    integer not null default 0,
  unique (market, environment)
);

insert into public.com_system
  (id, market, name, vendor, api_version, base_url, auth, token_url,
   timeout_ms, max_attempts, backoff_seconds, ack_sla_seconds, status, status_note, contact, note, sort_order) values
  ('COM-IN', 'IN', 'Aventa COM — India', 'Netcracker', '4.0.0',
   'https://com.in.aventa.internal/tmf-api/productOrderingManagement/v4',
   'oauth2-client-credentials', 'https://iam.in.aventa.internal/oauth2/token',
   15000, 5, 60, 300, 'live', null, 'com-ops.in@aventa.com',
   'Orchestrates activation, number assignment and rating for the Indian network.', 1),
  ('COM-KE', 'KE', 'Aventa COM — Kenya', 'Amdocs', '4.0.0',
   'https://com.ke.aventa.internal/tmf-api/productOrderingManagement/v4',
   'oauth2-client-credentials', 'https://iam.ke.aventa.internal/oauth2/token',
   20000, 5, 90, 600, 'live', null, 'com-ops.ke@aventa.com',
   'Same interface, different orchestrator. Kenya''s IoT estate provisioning is asynchronous and slower to acknowledge.', 2),
  ('COM-AE', 'AE', 'Aventa COM — United Arab Emirates', 'Ericsson', '4.0.0',
   'https://com.ae.aventa.internal/tmf-api/productOrderingManagement/v4',
   'mtls', null,
   15000, 4, 120, 300, 'degraded',
   'Order acknowledgements are running twelve minutes behind since the 4 August upgrade. Orders are being accepted; nothing is being lost.',
   'com-ops.ae@aventa.com',
   'Mutual TLS rather than OAuth — the Emirati platform terminates at a private interconnect.', 3)
on conflict (id) do nothing;

/* ---- 2. The mapping ----------------------------------------------------------- */

/* One row per field that crosses the boundary. `source` is either a key
 * resolved from the order (`ctx:`) or a literal (`const:`); `target` is a path
 * into the TMF622 body.
 *
 * Kept as data because it is the part that changes. A telco that renames a
 * characteristic, a market that needs an extra one, a version bump that moves a
 * field — all of those are a row here, and none of them are a deployment.
 */
create table if not exists public.com_mapping (
  id          text primary key,
  /* Which fulfilment class the row applies to. 'all' is the envelope every
     order carries. */
  applies_to  text not null check (applies_to in ('all', 'esim', 'provisioned', 'activation')),
  source      text not null,
  target      text not null,
  transform   text check (transform in ('number', 'iso-8601', 'upper', 'e164')),
  /* A required field that resolves to nothing is a rejection, not a retry. */
  required    boolean not null default false,
  label       text not null,
  note        text,
  sort_order  integer not null default 0,
  unique (applies_to, target)
);

insert into public.com_mapping (id, applies_to, source, target, transform, required, label, note, sort_order) values
  /* The envelope. */
  ('CM-EXT',  'all', 'ctx:line_ref',      'externalId',                      null, true,
   'Our reference', 'The order line, not the order. COM works one product order per line and a shared reference makes two of them indistinguishable.', 1),
  ('CM-CAT',  'all', 'ctx:category',      'category',                        'upper', true,
   'Order category', 'B2C or B2B. It selects the fulfilment flow inside COM, so a consumer eSIM does not go down the enterprise path.', 2),
  ('CM-CHID', 'all', 'const:MKTPL',       'channel[0].id',                   null, true,
   'Channel id', 'How COM knows the order came from the marketplace rather than from a shop or self-care. It is what makes the channel rules enforceable at the other end too.', 3),
  ('CM-CHNM', 'all', 'const:Aventa Marketplace', 'channel[0].name',          null, false,
   'Channel name', null, 4),
  ('CM-DATE', 'all', 'ctx:requested_start', 'requestedStartDate',            'iso-8601', true,
   'Requested start', 'When service should begin. Absent, COM starts it on receipt, which bills a customer for a day they did not ask for.', 5),
  ('CM-PTID', 'all', 'ctx:customer_ref',  'relatedParty[0].id',              null, true,
   'Customer reference', 'The customer as the network knows them — CUS- for a consumer, ENT- for an account. Not the marketplace user id, which means nothing downstream.', 6),
  ('CM-PTNM', 'all', 'ctx:customer_name', 'relatedParty[0].name',            null, true,
   'Customer name', null, 7),
  ('CM-PTRL', 'all', 'const:Customer',    'relatedParty[0].role',            null, true,
   'Party role', null, 8),
  ('CM-ITID', 'all', 'ctx:line_no',       'productOrderItem[0].id',          null, true,
   'Item id', null, 9),
  ('CM-ITAC', 'all', 'const:add',         'productOrderItem[0].action',      null, true,
   'Action', 'add, modify or delete. The marketplace only ever adds — a change to a live service is made in self-care, which is the same channel rule that keeps number portability out of here.', 10),
  ('CM-ITQT', 'all', 'ctx:quantity',      'productOrderItem[0].quantity',    'number', true,
   'Quantity', null, 11),
  ('CM-OFID', 'all', 'ctx:offering_id',   'productOrderItem[0].productOffering.id', null, true,
   'Product offering', 'The telco rate-card item, not the marketplace SKU. A marketplace pack composed of three rate-card items sends three of these.', 12),
  ('CM-OFNM', 'all', 'ctx:offering_name', 'productOrderItem[0].productOffering.name', null, false,
   'Offering name', null, 13),
  ('CM-PRCU', 'all', 'ctx:currency',      'productOrderItem[0].itemPrice[0].price.taxIncludedAmount.unit', null, true,
   'Currency', 'The order''s own currency. COM prices in its market''s money and a mismatch here is a rating dispute nobody can settle.', 14),
  ('CM-PRAM', 'all', 'ctx:price',         'productOrderItem[0].itemPrice[0].price.taxIncludedAmount.value', 'number', true,
   'Amount', null, 15),
  ('CM-MKT',  'all', 'ctx:market',        'productOrderItem[0].product.productCharacteristic[0].value', null, true,
   'Market', null, 16),
  ('CM-MKTN', 'all', 'const:market',      'productOrderItem[0].product.productCharacteristic[0].name', null, true,
   'Market (name)', null, 17),

  /* eSIM. Note what is NOT required here. A consumer eSIM is ordered without
     knowing the device: COM allocates a profile from the pool and returns the
     SM-DP+ address and activation code, and the customer installs it from a QR.
     Demanding an EID up front would reject every consumer eSIM order the
     marketplace has ever taken — it is an M2M field, and the difference is
     worth carrying rather than discovering in production. */
  ('CM-DEVN', 'esim', 'const:deviceEid',  'productOrderItem[0].product.productCharacteristic[1].name', null, false,
   'Device EID (name)', null, 20),
  ('CM-DEVV', 'esim', 'ctx:eid',          'productOrderItem[0].product.productCharacteristic[1].value', null, false,
   'Device EID', 'Sent only where the buyer registered a device. A consumer ordering an eSIM has not, and does not need to — COM returns a profile and an activation code instead.', 21),
  ('CM-ESPN', 'esim', 'const:profileType','productOrderItem[0].product.productCharacteristic[2].name', null, true,
   'Profile type (name)', null, 22),
  ('CM-ESPV', 'esim', 'ctx:profile_type', 'productOrderItem[0].product.productCharacteristic[2].value', null, true,
   'Profile type', 'Consumer or M2M. It decides which pool COM allocates from and whether an activation code comes back at all.', 23),

  /* Connectivity, retail or wholesale. A SIM with no APN is a SIM that
     attaches and carries nothing. */
  ('CM-ICCN', 'provisioned', 'const:iccid', 'productOrderItem[0].product.productCharacteristic[1].name', null, true,
   'ICCID (name)', null, 30),
  ('CM-ICCV', 'provisioned', 'ctx:iccid',   'productOrderItem[0].product.productCharacteristic[1].value', null, false,
   'ICCID', 'Empty on a bulk estate order — COM allocates from its own pool and returns them.', 31),
  ('CM-APNN', 'provisioned', 'const:apn',   'productOrderItem[0].product.productCharacteristic[2].name', null, true,
   'APN (name)', null, 32),
  ('CM-APNV', 'provisioned', 'ctx:apn',     'productOrderItem[0].product.productCharacteristic[2].value', null, true,
   'APN', 'Which access point the SIM attaches through. A SIM provisioned without one attaches and carries nothing, and the fault reads as a coverage problem for weeks.', 33),

  /* An activation is against an existing line. */
  ('CM-MSIN', 'activation', 'const:msisdn', 'productOrderItem[0].product.productCharacteristic[1].name', null, true,
   'MSISDN (name)', null, 40),
  ('CM-MSIV', 'activation', 'ctx:msisdn',   'productOrderItem[0].product.productCharacteristic[1].value', 'e164', true,
   'MSISDN', 'The line the service is added to. In E.164 with the country code, because COM matches on it exactly.', 41)
on conflict (id) do nothing;

/* ---- 3. What was pushed, and what came back ---------------------------------- */

create table if not exists public.com_order (
  id            text primary key,
  order_ref     text not null,
  order_item_id uuid references public.order_items(id) on delete cascade,
  system_id     text not null references public.com_system(id),
  market        text not null,
  product_id    text,
  product_name  text,
  fulfil        text not null,
  quantity      integer not null default 1,

  state         text not null default 'queued'
                check (state in ('queued', 'sent', 'acknowledged', 'in-progress',
                                 'completed', 'rejected', 'failed', 'cancelled')),

  /* What COM called it. Null until it has accepted one. */
  com_order_id  text,
  /* Ours, and stable across retries, so a duplicate submission is recognisable
     as one at the other end rather than provisioning a second SIM. */
  correlation_id text not null,

  /* The body actually sent, kept. An order manager and a marketplace arguing
     about what was requested is a conversation that needs an artefact. */
  payload       jsonb,

  attempts      integer not null default 0,
  last_attempt_at timestamptz,
  next_attempt_at timestamptz,
  sent_at       timestamptz,
  acknowledged_at timestamptz,
  completed_at  timestamptz,

  failure_code  text,
  failure_reason text,
  note          text,
  created_at    timestamptz not null default now(),
  unique (order_item_id)
);

create index if not exists com_order_state_idx on public.com_order (state, next_attempt_at);

create table if not exists public.com_event (
  id          text primary key,
  com_order   text not null references public.com_order(id) on delete cascade,
  kind        text not null check (kind in ('submitted', 'acknowledged', 'state-change', 'completed', 'rejected', 'failed', 'retry')),
  state       text,
  detail      text,
  payload     jsonb,
  occurred_at timestamptz not null default now()
);

create index if not exists com_event_order_idx on public.com_event (com_order, occurred_at);

/* ---- 4. Building the body from the mapping ------------------------------------ */

/* Writes a value at a dotted path, creating the objects and arrays on the way.
   `jsonb_set` will not create a missing parent, and a mapping table whose
   targets have to be declared in dependency order is a mapping table nobody can
   safely add a row to. */
create or replace function public.jsonb_put(doc jsonb, path text, val jsonb)
returns jsonb language plpgsql immutable as $$
declare
  keys   text[] := '{}';
  seg    text;
  cur    jsonb;
  parent jsonb;
  needed text;
  want   int;
  i      int;
  n      int;
begin
  if val is null or val = 'null'::jsonb then return doc; end if;
  doc := coalesce(doc, '{}'::jsonb);

  /* "a.b[0].c" becomes {a, b, 0, c}. */
  foreach seg in array string_to_array(path, '.') loop
    if seg ~ '\[[0-9]+\]$' then
      keys := keys || substring(seg from '^[^\[]+');
      keys := keys || substring(seg from '\[([0-9]+)\]$');
    else
      keys := keys || seg;
    end if;
  end loop;
  n := array_length(keys, 1);
  if keys[1] ~ '^[0-9]+$' then
    raise exception 'A mapping target cannot start with an array index: %', path;
  end if;

  for i in 1 .. n loop
    /* An index only exists if the array is long enough to hold it. `jsonb_set`
       against an index past the end appends rather than reaching, which is how
       characteristic[1] silently became characteristic[0] and the APN went out
       under the name of the ICCID. */
    if keys[i] ~ '^[0-9]+$' then
      want := keys[i]::int;
      parent := doc #> keys[1:i - 1];
      if parent is null or jsonb_typeof(parent) <> 'array' then parent := '[]'::jsonb; end if;
      while jsonb_array_length(parent) <= want loop
        parent := parent || jsonb_build_array('{}'::jsonb);
      end loop;
      doc := jsonb_set(doc, keys[1:i - 1], parent, true);
    end if;

    /* And each parent has to be the KIND of container the next key needs. A
       padded placeholder object where the path calls for an array is the same
       bug one level down. */
    if i < n then
      needed := case when keys[i + 1] ~ '^[0-9]+$' then 'array' else 'object' end;
      cur := doc #> keys[1:i];
      if cur is null or jsonb_typeof(cur) <> needed then
        doc := jsonb_set(doc, keys[1:i],
                         case needed when 'array' then '[]'::jsonb else '{}'::jsonb end, true);
      end if;
    end if;
  end loop;

  return jsonb_set(doc, keys, val, true);
end $$;

/* Everything the mapping can draw on, for one order line. */
create or replace function public.com_context(p_item uuid)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare
  it  public.order_items;
  o   public.orders;
  p   public.products;
  cp  public.consumer_profile;
  ln  int;
begin
  select * into it from public.order_items where id = p_item;
  if it.id is null then return null; end if;
  select * into o from public.orders where id = it.order_id;
  select * into p from public.products where id = it.product_id;
  select * into cp from public.consumer_profile where user_id = o.user_id;

  select count(*) into ln from public.order_items x
   where x.order_id = it.order_id and x.id <= it.id;

  return jsonb_strip_nulls(jsonb_build_object(
    'line_ref',      o.order_ref || '-' || ln,
    'line_no',       ln::text,
    'order_ref',     o.order_ref,
    /* An enterprise order is B2B whoever placed it. The distinction selects a
       fulfilment path inside COM, so it follows the account and not the
       storefront the buyer happened to use. */
    'category',      case when o.account_id is not null then 'B2B' else 'B2C' end,
    'market',        o.market,
    'currency',      o.currency,
    'requested_start', coalesce(o.created_at, now()),
    'customer_ref',  coalesce(o.account_id, cp.customer_id),
    'customer_name', coalesce(o.buyer_name, cp.name),
    'customer_email', coalesce(o.buyer_email, cp.email),
    'quantity',      it.quantity,
    'price',         it.price,
    'product_id',    it.product_id,
    'product_name',  coalesce(p.name, it.product_name),
    /* The rate-card item, which is what COM sells. A marketplace SKU means
       nothing to it. */
    'offering_id',   coalesce(
                       (select c.telco_id from public.product_telco_components c
                         where c.product_id = it.product_id order by c.telco_id limit 1),
                       it.product_id),
    'offering_name', coalesce(
                       (select t.name from public.product_telco_components c
                          join public.telco_catalogue t on t.id = c.telco_id
                         where c.product_id = it.product_id order by c.telco_id limit 1),
                       coalesce(p.name, it.product_name)),
    'msisdn',        cp.msisdn,
    /* Not ours to supply. COM allocates the ICCID from its own pool and returns
       it; the EID belongs to a device the marketplace has never seen. Both are
       here as keys so the mapping can name them, and both resolve to nothing
       until something upstream knows better. */
    'iccid',         null,
    'eid',           null,
    'profile_type',  case when o.account_id is not null or p.category_id in ('iot', 'partner')
                          then 'M2M' else 'Consumer' end,
    /* Retail traffic and machine traffic are rated and routed differently and
       must not share an access point. */
    'apn',           case when p.category_id = 'iot' or p.category_id = 'partner'
                          then 'iot.aventa' else 'internet.aventa' end
  ));
end $$;

/* The body, folded out of the mapping table. */
create or replace function public.com_payload(p_item uuid)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare
  ctx  jsonb;
  it   public.order_items;
  m    record;
  raw  text;
  val  jsonb;
  doc  jsonb := '{}'::jsonb;
begin
  select * into it from public.order_items where id = p_item;
  ctx := public.com_context(p_item);
  if ctx is null then return null; end if;

  for m in
    select * from public.com_mapping
     where applies_to in ('all', it.fulfil)
     order by sort_order
  loop
    if m.source like 'const:%' then
      raw := substring(m.source from 7);
    else
      raw := ctx ->> substring(m.source from 5);
    end if;

    if raw is null or raw = '' then continue; end if;

    val := case m.transform
             when 'number'   then to_jsonb(raw::numeric)
             when 'upper'    then to_jsonb(upper(raw))
             when 'iso-8601' then to_jsonb(to_char(raw::timestamptz at time zone 'UTC',
                                                    'YYYY-MM-DD"T"HH24:MI:SS"Z"'))
             when 'e164'     then to_jsonb(case when raw like '+%' then raw else '+' || regexp_replace(raw, '[^0-9]', '', 'g') end)
             else to_jsonb(raw)
           end;

    doc := public.jsonb_put(doc, m.target, val);
  end loop;

  return doc;
end $$;

/* Which required fields the mapping could not fill. This is the difference
   between a rejection and a retry, so it is computed rather than inferred from
   whatever the far end says. */
create or replace function public.com_missing(p_item uuid)
returns text[] language plpgsql stable security definer set search_path to 'public' as $$
declare
  ctx jsonb; it public.order_items; m record; raw text; out_missing text[] := '{}';
begin
  select * into it from public.order_items where id = p_item;
  ctx := public.com_context(p_item);
  if ctx is null then return array['the order line no longer exists']; end if;

  for m in
    select * from public.com_mapping
     where required and applies_to in ('all', it.fulfil)
     order by sort_order
  loop
    if m.source like 'const:%' then continue; end if;
    raw := ctx ->> substring(m.source from 5);
    if raw is null or raw = '' then
      out_missing := out_missing || (m.label || ' (' || m.target || ')');
    end if;
  end loop;
  return out_missing;
end $$;

/* ---- 5. Pushing, and being told about it -------------------------------------- */

/* Queue every line of an order that the network has to fulfil. Idempotent: a
   line already queued or sent is left where it is, because a second product
   order for one line is a second SIM. */
create or replace function public.push_to_com(p_order_ref text)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  o    public.orders;
  it   record;
  sys  public.com_system;
  made int := 0; skipped jsonb := '[]'::jsonb; row_id text; n int;
begin
  select * into o from public.orders where order_ref = p_order_ref;
  if o.id is null then
    return jsonb_build_object('ok', false, 'why', format('No order %s.', p_order_ref));
  end if;

  select * into sys from public.com_system
   where market = o.market and environment = 'production';
  if sys.id is null then
    return jsonb_build_object('ok', false, 'why',
      format('No order management system is configured for %s. The order cannot be provisioned and nobody has been told that.', o.market));
  end if;

  for it in
    select i.*, p.fulfilment_route, p.name as pname
      from public.order_items i
      left join public.products p on p.id = i.product_id
     where i.order_id = o.id
     order by i.id
  loop
    if coalesce(it.fulfilment_route, 'seller') <> 'telco-com' then
      skipped := skipped || jsonb_build_object(
        'product_id', it.product_id, 'reason',
        format('%s is fulfilled by the %s, not the network.', coalesce(it.pname, it.product_id),
               coalesce(it.fulfilment_route, 'seller')));
      continue;
    end if;

    select count(*) into n from public.com_order where order_item_id = it.id;
    if n > 0 then
      skipped := skipped || jsonb_build_object(
        'product_id', it.product_id, 'reason', 'Already with the order manager.');
      continue;
    end if;

    row_id := format('COM-%s-%s', replace(p_order_ref, 'ORD-', ''), right(it.id::text, 4));

    insert into public.com_order
      (id, order_ref, order_item_id, system_id, market, product_id, product_name,
       fulfil, quantity, state, correlation_id, next_attempt_at)
    values (row_id, p_order_ref, it.id, sys.id, o.market, it.product_id,
            coalesce(it.pname, it.product_name), it.fulfil, coalesce(it.quantity, 1),
            'queued', row_id || '-' || to_char(now(), 'YYYYMMDDHH24MISS'), now());

    insert into public.com_event (id, com_order, kind, state, detail)
    values (row_id || '-Q', row_id, 'submitted', 'queued',
            format('Queued for %s.', sys.name));

    made := made + 1;
  end loop;

  return jsonb_build_object('ok', true, 'queued', made, 'skipped', skipped);
end $$;

/* One attempt. The two failure classes part company here. */
create or replace function public.com_send(p_id text, p_now timestamptz default now())
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  c    public.com_order;
  sys  public.com_system;
  gaps text[];
  body jsonb;
  wait int;
begin
  select * into c from public.com_order where id = p_id;
  if c.id is null then return jsonb_build_object('ok', false, 'why', 'No such push.'); end if;
  if c.state in ('completed', 'cancelled') then
    return jsonb_build_object('ok', true, 'state', c.state, 'already', true);
  end if;

  select * into sys from public.com_system where id = c.system_id;

  /* A required characteristic that resolved to nothing will resolve to nothing
     on the next attempt too. Retrying it spends the budget and buries the
     reason under four identical timeouts. */
  gaps := public.com_missing(c.order_item_id);
  if array_length(gaps, 1) > 0 then
    update public.com_order set
      state = 'rejected', attempts = attempts + 1, last_attempt_at = p_now,
      next_attempt_at = null,
      failure_code = 'TMF-400',
      failure_reason = format('%s rejected the order: %s could not be supplied. This is not retried — the field will be empty next time too.',
                              sys.name, array_to_string(gaps, '; '))
     where id = p_id;
    insert into public.com_event (id, com_order, kind, state, detail)
    values (format('%s-R%s', p_id, c.attempts + 1), p_id, 'rejected', 'rejected',
            array_to_string(gaps, '; '));
    return jsonb_build_object('ok', false, 'state', 'rejected', 'missing', gaps);
  end if;

  body := public.com_payload(c.order_item_id);

  /* Transport. This is the failure retries exist for. */
  if sys.status = 'down' then
    wait := sys.backoff_seconds * power(2, least(c.attempts, 6))::int;
    if c.attempts + 1 >= sys.max_attempts then
      update public.com_order set
        state = 'failed', attempts = attempts + 1, last_attempt_at = p_now, next_attempt_at = null,
        payload = body, failure_code = 'TRANSPORT',
        failure_reason = format('%s did not answer on any of %s attempts. The order is not provisioned and needs a human.',
                                sys.name, sys.max_attempts)
       where id = p_id;
      insert into public.com_event (id, com_order, kind, state, detail)
      values (format('%s-F%s', p_id, c.attempts + 1), p_id, 'failed', 'failed',
              format('Given up after %s attempts.', sys.max_attempts));
      return jsonb_build_object('ok', false, 'state', 'failed');
    end if;
    update public.com_order set
      attempts = attempts + 1, last_attempt_at = p_now,
      next_attempt_at = p_now + make_interval(secs => wait),
      payload = body, failure_code = 'TRANSPORT',
      failure_reason = format('%s is not answering. Retrying in %s seconds.', sys.name, wait)
     where id = p_id;
    insert into public.com_event (id, com_order, kind, state, detail)
    values (format('%s-T%s', p_id, c.attempts + 1), p_id, 'retry', 'queued',
            format('No answer. Attempt %s of %s; next in %ss.', c.attempts + 1, sys.max_attempts, wait));
    return jsonb_build_object('ok', false, 'state', 'queued', 'retry_in', wait);
  end if;

  /* Accepted. Note what this is not: the service is not on yet. */
  update public.com_order set
    state = 'acknowledged', attempts = attempts + 1, last_attempt_at = p_now,
    next_attempt_at = null, sent_at = coalesce(sent_at, p_now), acknowledged_at = p_now,
    payload = body,
    com_order_id = 'PO-' || upper(substr(md5(p_id), 1, 10)),
    failure_code = null, failure_reason = null
   where id = p_id;

  insert into public.com_event (id, com_order, kind, state, detail, payload)
  values (format('%s-A%s', p_id, c.attempts + 1), p_id, 'acknowledged', 'acknowledged',
          format('%s accepted the order.', sys.name), body)
  on conflict (id) do nothing;

  return jsonb_build_object('ok', true, 'state', 'acknowledged',
                            'com_order_id', 'PO-' || upper(substr(md5(p_id), 1, 10)));
end $$;

/* The state coming back. COM owns the truth about fulfilment; this records what
   it said and when. */
create or replace function public.com_state(
  p_id text, p_state text, p_detail text default null, p_now timestamptz default now()
) returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare c public.com_order; n int;
begin
  select * into c from public.com_order where id = p_id;
  if c.id is null then return jsonb_build_object('ok', false, 'why', 'No such push.'); end if;
  if p_state not in ('in-progress', 'completed', 'failed', 'cancelled') then
    return jsonb_build_object('ok', false, 'why',
      format('%s is not a state the order manager reports.', p_state));
  end if;
  if c.state in ('queued', 'rejected') then
    return jsonb_build_object('ok', false, 'why',
      'Nothing has been accepted for this line, so there is no state to report against it.');
  end if;

  update public.com_order set
    state = p_state,
    completed_at = case when p_state = 'completed' then p_now else completed_at end,
    failure_reason = case when p_state = 'failed' then coalesce(p_detail, failure_reason) else null end,
    failure_code = case when p_state = 'failed' then coalesce(failure_code, 'COM-FAIL') else null end
   where id = p_id;

  select count(*) into n from public.com_event where com_order = p_id;
  insert into public.com_event (id, com_order, kind, state, detail, occurred_at)
  values (format('%s-S%s', p_id, n + 1), p_id,
          case p_state when 'completed' then 'completed'
                       when 'failed' then 'failed' else 'state-change' end,
          p_state, p_detail, p_now);

  return jsonb_build_object('ok', true, 'state', p_state);
end $$;

/* Everything due, retried. The scheduler's half of the backoff. */
create or replace function public.com_retry(p_now timestamptz default now())
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare c record; tried int := 0; ok int := 0; res jsonb;
begin
  if current_persona() is distinct from 'operator' then
    raise exception 'Only the marketplace retries a push to the order manager.';
  end if;
  for c in
    select id from public.com_order
     where state = 'queued' and coalesce(next_attempt_at, p_now) <= p_now
     order by created_at
  loop
    res := public.com_send(c.id, p_now);
    tried := tried + 1;
    if (res ->> 'ok')::boolean then ok := ok + 1; end if;
  end loop;
  return jsonb_build_object('ok', true, 'tried', tried, 'accepted', ok);
end $$;

/* A line the network has to fulfil is queued as it is written, rather than by
   whichever screen happens to remember. Queued, not sent: the send is an HTTP
   call and a browser transaction cannot promise one. */
create or replace function public.queue_com_on_order_item()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare o public.orders; p public.products; sys public.com_system; row_id text;
begin
  select * into p from public.products where id = new.product_id;
  if coalesce(p.fulfilment_route, 'seller') <> 'telco-com' then return new; end if;

  select * into o from public.orders where id = new.order_id;
  select * into sys from public.com_system where market = o.market and environment = 'production';
  if sys.id is null then return new; end if;

  row_id := format('COM-%s-%s', replace(o.order_ref, 'ORD-', ''), right(new.id::text, 4));

  insert into public.com_order
    (id, order_ref, order_item_id, system_id, market, product_id, product_name,
     fulfil, quantity, state, correlation_id, next_attempt_at)
  values (row_id, o.order_ref, new.id, sys.id, o.market, new.product_id,
          coalesce(p.name, new.product_name), new.fulfil, coalesce(new.quantity, 1),
          'queued', row_id || '-' || to_char(now(), 'YYYYMMDDHH24MISS'), now())
  on conflict (order_item_id) do nothing;

  insert into public.com_event (id, com_order, kind, state, detail)
  values (row_id || '-Q', row_id, 'submitted', 'queued', format('Queued for %s.', sys.name))
  on conflict (id) do nothing;

  return new;
end $$;

drop trigger if exists z_queue_com_on_order_item on public.order_items;
create trigger z_queue_com_on_order_item
  after insert on public.order_items
  for each row execute function public.queue_com_on_order_item();

/* ---- 6. Who may see and do what ----------------------------------------------- */

alter table public.com_system  enable row level security;
alter table public.com_mapping enable row level security;
alter table public.com_order   enable row level security;
alter table public.com_event   enable row level security;

drop policy if exists operator_all_com_system on public.com_system;
create policy operator_all_com_system on public.com_system
  for all using (current_persona() = 'operator') with check (current_persona() = 'operator');

drop policy if exists operator_all_com_mapping on public.com_mapping;
create policy operator_all_com_mapping on public.com_mapping
  for all using (current_persona() = 'operator') with check (current_persona() = 'operator');

drop policy if exists operator_all_com_order on public.com_order;
create policy operator_all_com_order on public.com_order
  for all using (current_persona() = 'operator') with check (current_persona() = 'operator');

drop policy if exists operator_all_com_event on public.com_event;
create policy operator_all_com_event on public.com_event
  for all using (current_persona() = 'operator') with check (current_persona() = 'operator');

/* A buyer reads the fulfilment state of their own order, because "we have your
   money and the network has not been told" is exactly what somebody chasing an
   order needs to see. Not the payload — that carries an ICCID and an EID. */
drop policy if exists own_com_order on public.com_order;
create policy own_com_order on public.com_order for select using (
  exists (select 1 from public.orders o
           where o.order_ref = com_order.order_ref
             and (o.user_id = auth.uid() or o.account_id = current_account_id()))
);

grant select on public.com_system, public.com_mapping to authenticated;
grant insert, update, delete on public.com_system, public.com_mapping to authenticated;
grant select, insert, update on public.com_order, public.com_event to authenticated;
grant execute on function public.push_to_com(text) to authenticated;
grant execute on function public.com_send(text, timestamptz) to authenticated;
grant execute on function public.com_state(text, text, text, timestamptz) to authenticated;
grant execute on function public.com_retry(timestamptz) to authenticated;
grant execute on function public.com_payload(uuid) to authenticated;
grant execute on function public.com_context(uuid) to authenticated;
grant execute on function public.com_missing(uuid) to authenticated;

/* ---- 7. Assertions ------------------------------------------------------------ */

do $$
declare n int; body jsonb; bad text; item uuid;
begin
  /* Every market that sells something the network fulfils has somewhere to
     send it. */
  select string_agg(distinct o.market, ', ') into bad
    from public.orders o
    join public.order_items i on i.order_id = o.id
    join public.products p on p.id = i.product_id
   where p.fulfilment_route = 'telco-com'
     and not exists (select 1 from public.com_system s
                      where s.market = o.market and s.environment = 'production');
  if bad is not null then raise exception 'network orders in markets with no order manager: %', bad; end if;

  /* The path writer creates its own parents, which is the whole reason it
     exists. */
  body := public.jsonb_put('{}'::jsonb, 'productOrderItem[0].product.productCharacteristic[1].value', '"x"'::jsonb);
  if body #>> '{productOrderItem,0,product,productCharacteristic,1,value}' is distinct from 'x' then
    raise exception 'jsonb_put did not build the path: %', body;
  end if;
  if jsonb_typeof(body -> 'productOrderItem') <> 'array' then
    raise exception 'jsonb_put made an object where the path called for an array: %', body;
  end if;

  /* Two mappings cannot claim one target — the later would silently overwrite
     the earlier and the screen would show both. The unique index says so; this
     says why. */
  select count(*) into n from (
    select applies_to, target from public.com_mapping group by 1, 2 having count(*) > 1
  ) x;
  if n > 0 then raise exception '% targets are claimed twice', n; end if;

  /* A payload built from the mapping reaches the standard's own shape. */
  select i.id into item from public.order_items i
    join public.products p on p.id = i.product_id
   where p.fulfilment_route = 'telco-com' and i.fulfil = 'provisioned' limit 1;
  if item is null then raise exception 'no provisioned line to build a payload from'; end if;

  body := public.com_payload(item);
  if body -> 'externalId' is null then raise exception 'the payload has no reference: %', body; end if;
  if body #>> '{productOrderItem,0,productOffering,id}' is null then
    raise exception 'the payload names no offering: %', body;
  end if;
  if jsonb_typeof(body #> '{productOrderItem,0,quantity}') <> 'number' then
    raise exception 'quantity was sent as a string, which TMF622 rejects: %', body #> '{productOrderItem,0,quantity}';
  end if;
  /* And the APN, which is the field whose absence reads as a coverage fault. */
  if body::text not like '%iot.aventa%' and body::text not like '%internet.aventa%' then
    raise exception 'a provisioned line carries no APN: %', body;
  end if;

  raise notice 'com systems %, mappings %, payload keys %',
    (select count(*) from public.com_system),
    (select count(*) from public.com_mapping),
    (select count(*) from jsonb_object_keys(body));
end $$;
