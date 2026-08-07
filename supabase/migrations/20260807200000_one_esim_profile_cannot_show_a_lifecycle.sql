/* Two thin spots the console made visible.
 *
 * The eSIM tab renders the six states SGP.22 defines and had one profile to
 * render them with, sitting in one of them. A lifecycle you can only see one
 * step of has not been demonstrated — and worse, the seed had walked that one
 * profile all the way to enabled, so the tab was a single green row and the
 * refusals in the middle of the ladder were untested against real data.
 *
 * And Kenya had no retail SIM block at all. Wanjiru and Otieno were given
 * Kenyan mobile numbers with nothing behind them, which is a number that cannot
 * make a call. The first migration left that visible deliberately; this one
 * fixes it, because a marketplace that sells in Kenya and cannot issue a SIM
 * there is not a gap worth keeping as a demonstration.
 */

insert into public.number_range
  (id, kind, system_id, market, purpose, range_from, range_to, size, reserved, expires_on, status, note, claimed_on, sort_order) values
  ('RNG-KE-RTLSIM','iccid','SYS-SIM','KE','retail',
   '8925401000000000001','8925401000000009999', 9999, 9999, null, 'active',
   'Kenyan retail SIM stock. Claimed after the console reported two Kenyan customers holding a number with no SIM behind it.',
   current_date, 12),
  ('RNG-AE-M2M','msisdn','SYS-BSS','AE','iot',
   '551900000','551909999', 10000, 800, '2027-06-30', 'active',
   'UAE M2M block. Nothing is allocated out of it yet — the UAE cold-chain order came back rather than being delivered.',
   current_date, 13)
on conflict (id) do nothing;

/* Give the two Kenyan customers the SIM their number needs. */
do $$
declare
  r record;
  sim jsonb;
begin
  for r in
    select n.id, n.user_id, n.holder_name, n.plan
      from public.number_resource n
     where n.kind = 'msisdn' and n.purpose = 'retail' and n.market = 'KE'
       and n.state = 'assigned'
       and not exists (select 1 from public.number_resource s
                        where s.kind = 'iccid' and s.user_id = n.user_id)
  loop
    sim := public.assign_number('iccid', 'KE', 'retail', r.user_id, null, null,
                                r.holder_name, null, r.plan);
    if not (sim->>'ok')::boolean then raise exception 'KE retail SIM: %', sim->>'why'; end if;
    update public.number_resource set paired_with = sim->>'id' where id = r.id;
    update public.number_resource set paired_with = r.id where id = sim->>'id';
  end loop;
end $$;

/* Holding a number is not assigning one, and `assign_number` could not express
   the difference — it writes `assigned`, which the guard rightly refuses
   without a holder. A number kept back for somebody who is part-way through
   signing up has no holder yet and is not free either, so it needs its own
   verb. */
create or replace function public.hold_number(
  p_kind text, p_market text, p_purpose text, p_for text, p_why text
) returns jsonb
language plpgsql security definer
set search_path = public, extensions as $$
declare
  rng public.number_range;
  val text;
  id  text;
begin
  if p_why is null or length(trim(p_why)) = 0 then
    return jsonb_build_object('ok', false,
      'why', 'A held number has to say why it is held, or it is a number nobody can account for');
  end if;

  select * into rng from public.number_range
   where kind = p_kind and market = p_market and purpose = p_purpose
     and status in ('active','expiring')
     and (expires_on is null or expires_on > current_date)
   order by (status = 'active') desc, sort_order limit 1;
  if rng.id is null then
    return jsonb_build_object('ok', false,
      'why', format('No usable %s block reserved for %s in %s', p_kind, p_purpose, p_market));
  end if;

  val := public.next_in_range(rng.id);
  if val is null then
    return jsonb_build_object('ok', false, 'why', format('%s is exhausted', rng.id));
  end if;

  id := upper(p_kind) || '-' || val;
  insert into public.number_resource
    (id, kind, value, range_id, market, purpose, state, holder_name, note,
     bss_ref, assigned_on)
  values (id, p_kind, val, rng.id, p_market, p_purpose, 'reserved', p_for, p_why,
     'TMF652-' || upper(substr(md5(id || now()::text), 1, 10)), current_date);

  return jsonb_build_object('ok', true, 'id', id, 'value', val, 'range', rng.id);
end $$;

grant execute on function public.hold_number(text,text,text,text,text) to authenticated;

/* More retail numbers, so the estate is not three people. These are identities
   the telco side already knows — the same names the SSO records carry, whose
   MSISDNs were display strings with nothing behind them. They are HELD rather
   than assigned, because none of them has a marketplace account, and calling
   them assigned would be naming a holder the marketplace cannot produce. */
do $$
declare
  r record;
  q jsonb;
  sim jsonb;
begin
  for r in
    select * from (values
      ('Rohan Mehta',    'IN', 'Aventa Freedom 50 GB'),
      ('Aisha Nakato',   'KE', 'Aventa Freedom 20 GB'),
      ('Meera Iyer',     'IN', 'Aventa Freedom 100 GB'),
      ('Daniel Mwangi',  'KE', 'Aventa Freedom Unlimited'),
      ('Sanjay Gupta',   'IN', 'Aventa Freedom 50 GB'),
      ('Fatima Al Zaabi','IN', 'Aventa Freedom 20 GB')
    ) as t(name, mkt, plan)
  loop
    q := public.hold_number('msisdn', r.mkt, 'retail', r.name,
      'Held against a telco identity that has no marketplace account yet');
    if not (q->>'ok')::boolean then raise exception 'hold msisdn: %', q->>'why'; end if;

    sim := public.hold_number('iccid', r.mkt, 'retail', r.name,
      'Held with the number it is paired to, for the same identity');
    if (sim->>'ok')::boolean then
      update public.number_resource set paired_with = sim->>'id' where id = q->>'id';
      update public.number_resource set paired_with = q->>'id' where id = sim->>'id';
    end if;
  end loop;
end $$;

/* ---- eSIM profiles at every step of the ladder ------------------------------ */

insert into public.esim_profile (iccid, eid, resource_id, state, smdp, activation_code, released_on)
select n.value,
       '8904903200000000000000000000' || lpad((1000 + row_number() over (order by n.id))::text, 4, '0'),
       n.id, 'released', 'smdp.aventa.com',
       'LPA:1$smdp.aventa.com$' || upper(substr(md5(n.id), 1, 16)),
       current_date - 30
  from public.number_resource n
 where n.kind = 'iccid' and n.purpose = 'retail'
   and not exists (select 1 from public.esim_profile e where e.iccid = n.value)
on conflict (iccid) do nothing;

/* Walked forward one state at a time, because the trigger refuses anything
   else and it is right to — a row inserted as "installed" is a claim about
   what a handset did, made by a script that watched nothing. */
do $$
declare
  p record;
  steps text[];
  s text;
begin
  for p in
    select iccid, row_number() over (order by iccid) as rn
      from public.esim_profile where state = 'released'
  loop
    steps := case (p.rn % 5)
      when 1 then array['downloaded','installed','enabled']
      when 2 then array['downloaded','installed']
      when 3 then array['downloaded']
      when 4 then array['downloaded','installed','enabled','disabled']
      else array[]::text[] end;
    foreach s in array steps loop
      update public.esim_profile set state = s where iccid = p.iccid;
    end loop;
  end loop;

  /* One deleted, so the end of the ladder is visible and the refusal on it is
     exercised against a real row. */
  update public.esim_profile
     set state = 'deleted',
         note = 'Handset traded in; the profile was deleted at the customer''s request and cannot be restored'
   where iccid = (select iccid from public.esim_profile where state = 'enabled' order by iccid desc limit 1);

  update public.esim_profile
     set note = 'Released and not yet downloaded — the SM-DP+ has been degraded since 05:10'
   where state = 'released' and note is null;
end $$;

/* ---- Assertions ------------------------------------------------------------- */

do $$
declare
  n int;
  seen text;
begin
  /* Every Kenyan retail number now has a SIM behind it. */
  select count(*) into n from public.number_resource m
   where m.kind = 'msisdn' and m.purpose = 'retail' and m.market = 'KE' and m.state = 'assigned'
     and m.paired_with is null;
  if n > 0 then raise exception '% Kenyan numbers still have no SIM', n; end if;

  /* The eSIM ladder is visible at more than one rung. */
  select string_agg(distinct state, ', ' order by state) into seen from public.esim_profile;
  select count(distinct state) into n from public.esim_profile;
  if n < 5 then
    raise exception 'only % eSIM states are represented (%) — the lifecycle cannot be read from one row', n, seen;
  end if;

  /* A held number is not an assigned one, and it must say why it is held. */
  select count(*) into n from public.number_resource
   where state = 'reserved' and note is null;
  if n > 0 then raise exception '% held numbers do not say why', n; end if;

  /* Pairings still point both ways after all of that. */
  select count(*) into n from public.number_resource a
    join public.number_resource b on b.id = a.paired_with
   where b.paired_with is distinct from a.id;
  if n > 0 then raise exception '% pairings are one-way', n; end if;

  raise notice 'numbers: %, esim states represented: % (%)',
    (select count(*) from public.number_resource),
    (select count(distinct state) from public.esim_profile), seen;
end $$;
