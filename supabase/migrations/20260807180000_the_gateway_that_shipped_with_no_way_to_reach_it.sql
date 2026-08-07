/* The blocks, and the numbers actually in use.
 *
 * The point of the whole thing is the last section: the IoT units that have
 * already shipped get the SIMs that make them work. A Volta gateway delivered
 * to SmartBuild on ORD-882091 has a serial, an order, a customer — and until
 * now no ICCID, so nothing could reach it. That is not a cosmetic gap; a
 * connectivity marketplace that ships a cellular sensor and does not record
 * its SIM has shipped a brick.
 */

insert into public.resource_system (id, name, resources, interface, mode, sync_state, last_sync, latency_ms, note, sort_order) values
  ('SYS-BSS','Aventa BSS — Number Inventory', array['msisdn','imsi'], 'TMF639 Resource Inventory / TMF652 Resource Order',
   'real-time','healthy', now() - interval '4 minutes', 180,
   'Authoritative for every MSISDN and IMSI. The marketplace reserves blocks and records what it was given.', 1),
  ('SYS-SIM','SIM Vendor Portal (Gemalto)', array['iccid'], 'TMF639 Resource Inventory',
   'batch','healthy', now() - interval '9 hours', null,
   'Batch file nightly. Latency is not measured on a file drop, so it is not reported as a number.', 2),
  ('SYS-SMDP','SM-DP+ (IDEMIA)', array['eid','iccid'], 'SGP.22 ES2+',
   'real-time','degraded', now() - interval '2 hours', 940,
   'Degraded since 05:10 — profile downloads are queueing. Reservations are held rather than confirmed while it is in this state.', 3)
on conflict (id) do nothing;

/* ---- The blocks ------------------------------------------------------------- */

/* Real shapes. Indian retail mobile numbers are ten digits starting 6-9;
   Indian M2M numbers are thirteen digits and are a separate series precisely
   so they cannot be handed to a handset. Kenyan numbers are nine digits after
   the country code, UAE nine after the 5. ICCIDs are 19-20 digits beginning
   89 and the country code. */
insert into public.number_range
  (id, kind, system_id, market, purpose, range_from, range_to, size, reserved, expires_on, status, note, claimed_on, sort_order) values

  ('RNG-IN-RTL','msisdn','SYS-BSS','IN','retail',
   '9876500000','9876599999', 100000, 20000, null, 'active',
   'Retail consumer block for the Maharashtra and Karnataka circles.', '2025-04-01', 1),

  ('RNG-IN-ENT','msisdn','SYS-BSS','IN','enterprise',
   '9876600000','9876609999', 10000, 2500, '2027-03-31', 'active',
   'Enterprise voice block. Reservation renews annually with the licence.', '2025-04-01', 2),

  /* Thirteen digits. This is the one that cannot be mixed with retail. */
  ('RNG-IN-M2M','msisdn','SYS-BSS','IN','iot',
   '8912345600000','8912345609999', 10000, 4000, '2026-09-30', 'expiring',
   'M2M series per TEC. Thirteen digits — will not work in a handset, and a handset number will not work in a module.', '2025-06-15', 3),

  ('RNG-KE-RTL','msisdn','SYS-BSS','KE','retail',
   '711300000','711349999', 50000, 8000, null, 'active',
   'Kenyan retail block, Safaricom interconnect.', '2025-08-01', 4),

  ('RNG-KE-M2M','msisdn','SYS-BSS','KE','iot',
   '711900000','711909999', 10000, 1500, null, 'active',
   'Kenyan M2M block for cold-chain and telematics.', '2025-08-01', 5),

  ('RNG-AE-ENT','msisdn','SYS-BSS','AE','enterprise',
   '551200000','551209999', 10000, 1200, '2026-12-31', 'active',
   'UAE enterprise block via the local licensee.', '2025-11-01', 6),

  ('RNG-IN-SIM','iccid','SYS-SIM','IN','retail',
   '8991010000000000001','8991010000000019999', 20000, 20000, null, 'active',
   'Physical SIM stock, India. Reserved in full because the cards are already printed.', '2025-04-01', 7),

  ('RNG-IN-M2MSIM','iccid','SYS-SIM','IN','iot',
   '8991012000000000001','8991012000000004999', 5000, 5000, null, 'active',
   'Industrial-grade M2M SIMs — wider temperature range, soldered or 4FF.', '2025-06-15', 8),

  ('RNG-KE-SIM','iccid','SYS-SIM','KE','iot',
   '8925402000000000001','8925402000000002999', 3000, 3000, null, 'active',
   'Kenyan M2M SIM stock.', '2025-08-01', 9),

  ('RNG-AE-SIM','iccid','SYS-SIM','AE','enterprise',
   '8997102000000000001','8997102000000001999', 2000, 2000, null, 'active',
   'UAE enterprise SIM stock.', '2025-11-01', 10),

  ('RNG-IN-ESIM','eid','SYS-SMDP','IN','retail',
   '89049032000000000000000000000001','89049032000000000000000000009999', 9999, 3000, null, 'active',
   'eSIM identifiers for handsets and tablets that support a downloaded profile.', '2025-09-01', 11)
on conflict (id) do nothing;

/* ---- Retail: real customers with real numbers ------------------------------- */

/* The SSO identity records already carry these people's MSISDNs as prose. Those
   were display strings with nothing behind them. These are allocations. */
do $$
declare
  r record;
  q jsonb;
  sim jsonb;
begin
  for r in
    select * from (values
      ('7c9e1f42-3b8a-4d61-9e05-2a7f6b4c8d13'::uuid, 'Wanjiru Kamau',   'KE', 'Aventa Freedom 20 GB'),
      ('e5b3c7a1-9d42-4f68-b015-7c3e9a2b4d81',       'Otieno Odhiambo', 'KE', 'Aventa Freedom Unlimited'),
      ('d5a4012b-56dc-4ade-ab33-a00b55a5f32e',       'Priya Raman',     'IN', 'Aventa Freedom 100 GB')
    ) as t(uid, name, mkt, plan)
  loop
    q := public.assign_number('msisdn', r.mkt, 'retail', r.uid, null, null, r.name, null, r.plan);
    if not (q->>'ok')::boolean then raise exception 'retail msisdn: %', q->>'why'; end if;

    /* An MSISDN with no SIM behind it is a number nobody can use. India has
       physical SIM stock in this seed; Kenya's retail block has none, which is
       itself a real gap and is left visible rather than papered over. */
    if r.mkt = 'IN' then
      sim := public.assign_number('iccid', r.mkt, 'retail', r.uid, null, null, r.name, null, r.plan);
      if (sim->>'ok')::boolean then
        update public.number_resource set paired_with = sim->>'id' where id = q->>'id';
        update public.number_resource set paired_with = q->>'id' where id = sim->>'id';
      end if;
    end if;
  end loop;
end $$;

/* ---- Enterprise: numbers on an account -------------------------------------- */

do $$
declare
  r record;
  q jsonb;
begin
  for r in
    select * from (values
      ('ENT-2007','SmartBuild Ltd',      'IN', 4),
      ('ENT-2012','Meridian Foods',      'AE', 3),
      ('ENT-2014','Harbourpoint Retail', 'KE', 0)
    ) as t(acct, name, mkt, n)
  loop
    for i in 1 .. r.n loop
      q := public.assign_number('msisdn', r.mkt, 'enterprise', null, r.acct, null, r.name,
                                null, 'Aventa Business Voice');
      if not (q->>'ok')::boolean then raise exception 'enterprise msisdn: %', q->>'why'; end if;
    end loop;
  end loop;
end $$;

/* ---- A correction found on the way ------------------------------------------ */

/* Trying to say whose SIM a delivered sensor carries found an order that could
   not say whose it was. ORD-883105 names Priya Raman as its buyer in prose and
   carries neither a user nor an account — so the sensor was delivered to a
   string. The buyer resolves against the customer directory by name and email,
   and the link is written rather than worked around here, because every other
   screen that asks "whose order is this" has the same problem with that row. */
update public.orders o
   set user_id = cp.user_id
  from public.consumer_profile cp
 where o.user_id is null and o.account_id is null
   and cp.user_id is not null
   and lower(cp.name) = lower(o.buyer_name)
   and (o.buyer_email is null or lower(o.buyer_email) = lower(coalesce(cp.email, '')));

/* ---- IoT: the SIMs that make the shipped devices work ----------------------- */

/* This is the join that did not exist. Every IoT unit that has left the
   warehouse gets an M2M SIM, on the account that bought it, recorded against
   the serial — so "which sensor is this, whose is it, and how do I reach it"
   is one query instead of a shrug.
 *
 * The M2M MSISDN comes with it where the market has a block. Kenya's does;
 * the UAE has no M2M block reserved at all, which is a real gap this seed
 * leaves visible.
 */
do $$
declare
  u record;
  q jsonb;
  sim jsonb;
  mkt text;
  acct text;
  uid uuid;
  purp text;
  n int := 0;
begin
  for u in
    select su.serial, su.product_id, su.order_ref, su.customer, su.warehouse_id,
           o.market, o.account_id, o.user_id
      from public.stock_unit su
      join public.products p on p.id = su.product_id
      left join public.orders o on o.id = su.order_id
     where p.category_id = 'iot'
       and su.state in ('despatched','delivered')
     order by su.serial
  loop
    mkt := coalesce(u.market, 'IN');
    acct := u.account_id;
    uid  := case when u.account_id is null then u.user_id end;

    /* An IoT SIM belongs to the account that bought the device, or to the
       person where a retail customer bought one. A sensor bought by Priya is
       not on SmartBuild's account, and a number belonging to both belongs to
       neither. */
    if acct is null and uid is null then
      raise notice 'no buyer on % (%) — cannot say whose SIM this would be', u.serial, u.order_ref;
      continue;
    end if;

    sim := public.assign_number('iccid', mkt, 'iot', uid, acct, u.serial, u.customer,
                                u.order_ref, 'Aventa IoT Connect');
    if not (sim->>'ok')::boolean then
      /* Named, not skipped. A market with devices in the field and no SIM
         stock reserved is exactly the thing this console exists to surface. */
      raise notice 'no IoT SIM block for % — % on % is unreachable', mkt, u.serial, u.order_ref;
      continue;
    end if;

    q := public.assign_number('msisdn', mkt, 'iot', uid, acct, u.serial, u.customer,
                              u.order_ref, 'Aventa IoT Connect');
    if (q->>'ok')::boolean then
      update public.number_resource set paired_with = q->>'id' where id = sim->>'id';
      update public.number_resource set paired_with = sim->>'id' where id = q->>'id';
    end if;
    n := n + 1;
  end loop;
  raise notice 'IoT units given connectivity: %', n;
end $$;

/* ---- eSIM profiles ---------------------------------------------------------- */

/* One per retail ICCID allocated in India, in the states the standard defines.
   None of them is claimed as installed unless somebody would have watched it
   happen. */
/* Created released, every one of them — the trigger refuses anything else, and
   it is right to. A row inserted as "installed" is a claim about what a handset
   did, made by a seed script that watched nothing. They are then walked forward
   one state at a time, which is the only way a profile ever gets anywhere. */
insert into public.esim_profile (iccid, eid, resource_id, state, smdp, activation_code, released_on, note)
select n.value,
       '8904903200000000000000000000' || lpad((row_number() over (order by n.id))::text, 4, '0'),
       n.id,
       'released',
       'smdp.aventa.com',
       'LPA:1$smdp.aventa.com$' || upper(substr(md5(n.id), 1, 16)),
       current_date - 40,
       null
  from public.number_resource n
 where n.kind = 'iccid' and n.purpose = 'retail'
on conflict (iccid) do nothing;

do $$
declare
  p record;
  steps text[];
  s text;
  rank int;
begin
  for p in
    select iccid, row_number() over (order by iccid) as rn from public.esim_profile
  loop
    /* One is left at released and says why — the SM-DP+ has been degraded
       since 05:10 and downloads are queueing. That is a state a real console
       has to be able to show. */
    rank := least(p.rn, 4);
    steps := case rank
      when 1 then array['downloaded','installed','enabled']
      when 2 then array['downloaded','installed']
      when 3 then array['downloaded']
      else array[]::text[] end;
    foreach s in array steps loop
      update public.esim_profile set state = s where iccid = p.iccid;
    end loop;
    if rank = 4 then
      update public.esim_profile
         set note = 'Released and not yet downloaded — the SM-DP+ has been degraded since 05:10'
       where iccid = p.iccid;
    end if;
  end loop;
end $$;

/* A released number, so the quarantine rule is visible rather than only
   written down. */
do $$
declare
  id text;
begin
  select n.id into id from public.number_resource n
   where n.kind = 'msisdn' and n.purpose = 'enterprise' and n.account_id = 'ENT-2012'
   order by n.value desc limit 1;
  if id is not null then
    perform public.release_number(id, 'Handset lost; the line was cancelled at the account''s request');
  end if;
end $$;

/* ---- Assertions ------------------------------------------------------------- */

do $$
declare
  n int;
  bad text;
  r record;
begin
  /* Every IoT unit in the field is reachable, or the gap is a named market
     rather than a silence. */
  select count(*) into n
    from public.stock_unit su join public.products p on p.id = su.product_id
   where p.category_id = 'iot' and su.state in ('despatched','delivered')
     and not exists (select 1 from public.number_resource nr
                      where nr.stock_serial = su.serial and nr.kind = 'iccid');
  if n > 0 then
    select string_agg(distinct coalesce(o.market, 'IN'), ', ') into bad
      from public.stock_unit su join public.products p on p.id = su.product_id
      left join public.orders o on o.id = su.order_id
     where p.category_id = 'iot' and su.state in ('despatched','delivered')
       and not exists (select 1 from public.number_resource nr
                        where nr.stock_serial = su.serial and nr.kind = 'iccid');
    raise exception '% shipped IoT units have no SIM — no M2M block is reserved for %', n, bad;
  end if;

  /* No number belongs to two holders. */
  select count(*) into n from public.number_resource
   where state in ('assigned','suspended')
     and (user_id is not null)::int + (account_id is not null)::int <> 1;
  if n > 0 then raise exception '% numbers belong to both a person and an account', n; end if;

  /* Utilisation is against reserved, and no block is over-allocated. */
  select string_agg(range_id, ', ') into bad from public.range_use where free < 0;
  if bad is not null then raise exception 'over-allocated blocks: %', bad; end if;

  /* An M2M number is thirteen digits in India and a retail one is ten. If
     those ever mix, a module gets a number that will not register. */
  select count(*) into n from public.number_resource
   where market = 'IN' and purpose = 'iot' and kind = 'msisdn' and length(value) <> 13;
  if n > 0 then raise exception '% Indian M2M numbers are not thirteen digits', n; end if;
  select count(*) into n from public.number_resource
   where market = 'IN' and purpose = 'retail' and kind = 'msisdn' and length(value) <> 10;
  if n > 0 then raise exception '% Indian retail numbers are not ten digits', n; end if;

  /* A released number is quarantined, never straight back into the pool. */
  select count(*) into n from public.number_resource
   where state = 'quarantine' and (reusable_from is null or reusable_from <= current_date);
  if n > 0 then raise exception '% quarantined numbers are already reusable', n; end if;

  /* And the paired ones point at each other rather than one way. */
  select count(*) into n from public.number_resource a
    join public.number_resource b on b.id = a.paired_with
   where b.paired_with is distinct from a.id;
  if n > 0 then raise exception '% pairings are one-way', n; end if;

  raise notice 'ranges: %, allocated: %, on devices: %, esim profiles: %',
    (select count(*) from public.number_range),
    (select count(*) from public.number_resource),
    (select count(*) from public.number_resource where stock_serial is not null),
    (select count(*) from public.esim_profile);
end $$;
