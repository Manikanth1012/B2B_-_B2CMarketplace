/* Otieno Odhiambo's screen showed two mobile numbers and a start date that was
 * today.
 *
 *   Phone            +254 711 306 442      what he has always been on file as
 *   Mobile number     711300001            what the number seed gave him
 *   In service since  2026-08-07           the day the seed ran
 *
 * All three are the same mistake in different clothes. The seed allocated the
 * next free number in the block instead of the number he already has, and
 * stamped today on it. A subscriber's contact number IS their mobile number —
 * for anybody on the network there is only one, and the marketplace showing two
 * is the marketplace telling a customer their own number is wrong.
 *
 * And a line that has been live since 2024 did not enter service on the day
 * somebody wrote a migration. The date belongs to the network, and the network
 * already knew it.
 *
 * The fix needs something the model did not have: a way to allocate a
 * SPECIFIC number rather than the next one. That is not a workaround — it is
 * how numbers work. A customer moving to us keeps their number, a customer
 * already with us keeps the one they have had for five years, and an
 * allocation function that can only hand out the next free one cannot express
 * either.
 */

/* ---- A block that actually contains Priya's number --------------------------- */

/* +91 98860 41127 is not inside 9876500000–9876599999, so the seed could not
   have given it to her even if it had tried. Operators hold many blocks; this
   is the one hers came out of. */
insert into public.number_range
  (id, kind, system_id, market, purpose, range_from, range_to, size, reserved, expires_on, status, note, claimed_on, sort_order)
values
  ('RNG-IN-RTL2','msisdn','SYS-BSS','IN','retail',
   '9886000000','9886099999', 100000, 15000, null, 'active',
   'The older Karnataka retail series. Numbers issued before 2022 came out of this one.',
   '2019-06-01', 14)
on conflict (id) do nothing;

/* ---- Claiming a number somebody already has ---------------------------------- */

/* Allocation by value. The number has to be inside a block the marketplace
   actually holds — claiming one that is not is claiming a number from an
   operator we have no arrangement with, which the BSS would refuse and this
   does too. */
create or replace function public.claim_number(
  p_kind text, p_market text, p_purpose text, p_value text,
  p_user uuid default null, p_account text default null,
  p_holder text default null, p_plan text default null,
  p_since date default null
) returns jsonb
language plpgsql security definer
set search_path = public, extensions as $$
declare
  rng public.number_range;
  id  text;
  who text;
begin
  if p_user is not null and p_purpose = 'retail'
     and not exists (select 1 from public.identity_links il where il.user_id = p_user) then
    select cp.name into who from public.consumer_profile cp where cp.user_id = p_user;
    return jsonb_build_object('ok', false,
      'why', format('%s is not on the network, so there is no number to claim.', coalesce(who,'That customer')));
  end if;

  /* Which block is it in? Compared numerically — a string comparison puts
     9886041127 outside 9876500000–9876599999 for the wrong reason and inside
     other ranges for a worse one. */
  select * into rng from public.number_range r
   where r.kind = p_kind and r.market = p_market and r.purpose = p_purpose
     and r.status <> 'released'
     and length(p_value) = length(r.range_from)
     and p_value::numeric between r.range_from::numeric and r.range_to::numeric
   order by r.sort_order limit 1;

  if rng.id is null then
    return jsonb_build_object('ok', false,
      'why', format('%s is not inside any %s block the marketplace holds for %s in %s. A number we have no block for is somebody else''s number.',
                    p_value, p_kind, p_purpose, p_market));
  end if;

  if exists (select 1 from public.number_resource n
              where n.kind = p_kind and n.value = p_value and n.state <> 'released') then
    return jsonb_build_object('ok', false, 'why', format('%s is already allocated.', p_value));
  end if;

  id := upper(p_kind) || '-' || p_value;
  insert into public.number_resource
    (id, kind, value, range_id, market, purpose, state,
     user_id, account_id, holder_name, plan, bss_ref, assigned_on, activated_on)
  values (id, p_kind, p_value, rng.id, p_market, p_purpose, 'assigned',
     p_user, p_account, p_holder, p_plan,
     'TMF652-' || upper(substr(md5(id || now()::text), 1, 10)),
     coalesce(p_since, current_date), coalesce(p_since, current_date));

  return jsonb_build_object('ok', true, 'id', id, 'value', p_value, 'range', rng.id);
end $$;

grant execute on function public.claim_number(text,text,text,text,uuid,text,text,text,date) to authenticated;

/* ---- Give the two subscribers the numbers they actually have ----------------- */

do $$
declare
  c record;
  old_sim text;
  q jsonb;
  digits text;
begin
  for c in
    select cp.user_id, cp.name, cp.market, cp.msisdn, t.customer_since, t.msisdn as telco_msisdn
      from public.consumer_profile cp
      join public.identity_links il on il.user_id = cp.user_id
      join public.telco_identities t on t.subject = il.subject
  loop
    /* The national number, without the country code or the spacing the screen
       puts in. The telco record is the authority — the profile string is a
       display of it. */
    digits := regexp_replace(coalesce(c.telco_msisdn, c.msisdn), '[^0-9]', '', 'g');
    digits := case c.market
      when 'IN' then right(digits, 10)
      when 'KE' then right(digits, 9)
      when 'AE' then right(digits, 9)
      else digits end;

    /* Keep the SIM — the card is real and its number is fine. Only the mobile
       number was invented. */
    select paired_with into old_sim from public.number_resource
     where user_id = c.user_id and kind = 'msisdn' and purpose = 'retail' limit 1;

    update public.number_resource set paired_with = null
     where id in (select paired_with from public.number_resource
                   where user_id = c.user_id and kind = 'msisdn' and purpose = 'retail');
    delete from public.number_resource
     where user_id = c.user_id and kind = 'msisdn' and purpose = 'retail';

    q := public.claim_number('msisdn', c.market, 'retail', digits, c.user_id, null,
                             c.name, null, c.customer_since);
    if not (q->>'ok')::boolean then
      raise exception 'could not give % their own number (%): %', c.name, digits, q->>'why';
    end if;

    if old_sim is not null then
      update public.number_resource set paired_with = old_sim where id = q->>'id';
      update public.number_resource set paired_with = q->>'id' where id = old_sim;
    end if;

    /* The SIM entered service with the line, not on the day the seed ran. */
    update public.number_resource
       set assigned_on = c.customer_since, activated_on = c.customer_since
     where user_id = c.user_id and kind = 'iccid' and purpose = 'retail';

    /* And the profile's display string is written from the allocation rather
       than typed beside it, so the two cannot drift again. */
    update public.consumer_profile
       set msisdn = case c.market
         when 'IN' then '+91 ' || substr(digits,1,5) || ' ' || substr(digits,6,5)
         when 'KE' then '+254 ' || substr(digits,1,3) || ' ' || substr(digits,4,3) || ' ' || substr(digits,7,3)
         when 'AE' then '+971 ' || substr(digits,1,2) || ' ' || substr(digits,3,3) || ' ' || substr(digits,6,4)
         else digits end
     where user_id = c.user_id;
  end loop;
end $$;

/* The eSIM profile follows the SIM it is on. */
update public.esim_profile e
   set released_on = least(e.released_on, n.activated_on)
  from public.number_resource n
 where e.resource_id = n.id and n.activated_on is not null
   and e.released_on > n.activated_on;

/* ---- Data units ------------------------------------------------------------- */

/* Withdrawn. It was a preference between showing a number in GB or MB, which
   is a unit the marketplace picks per figure from the size of the figure —
   nobody wants 0.0004 GB and nobody wants 4,096,000 MB. A setting that cannot
   improve any screen is one more thing on a page and one more column to keep. */
alter table public.consumer_profile drop column if exists data_units;

/* ---- Assertions --------------------------------------------------------------- */

do $$
declare
  r record;
  n int;
begin
  /* One mobile number per subscriber, and it is the one on their profile. */
  for r in
    select cp.name, cp.msisdn as shown, nr.value as allocated, nr.activated_on,
           t.customer_since
      from public.consumer_profile cp
      join public.identity_links il on il.user_id = cp.user_id
      join public.telco_identities t on t.subject = il.subject
      left join public.number_resource nr
        on nr.user_id = cp.user_id and nr.kind = 'msisdn' and nr.purpose = 'retail'
  loop
    if r.allocated is null then
      raise exception '% is on the network and holds no mobile number', r.name;
    end if;
    if right(regexp_replace(r.shown, '[^0-9]', '', 'g'), length(r.allocated)) <> r.allocated then
      raise exception '% is shown as % and holds %', r.name, r.shown, r.allocated;
    end if;
    /* And the line has been in service since they joined, not since the seed. */
    if r.activated_on <> r.customer_since then
      raise exception '%''s line says it started % and they joined %',
        r.name, r.activated_on, r.customer_since;
    end if;
  end loop;

  select count(*) into n
    from public.consumer_profile cp
    join public.identity_links il on il.user_id = cp.user_id
    join public.number_resource nr on nr.user_id = cp.user_id
   where nr.kind = 'msisdn' and nr.purpose = 'retail';
  if n <> 2 then raise exception 'expected one retail number each for two subscribers, found %', n; end if;

  /* The SIM entered service with the line. */
  select count(*) into n from public.number_resource a
    join public.number_resource b on b.id = a.paired_with
   where a.purpose = 'retail' and a.activated_on is distinct from b.activated_on;
  if n > 0 then raise exception '% pairs entered service on different days', n; end if;

  /* Claiming a number outside every block we hold is refused. */
  if ((public.claim_number('msisdn','IN','retail','9999999999'))->>'ok')::boolean then
    raise exception 'a number from a block we do not hold was allocated';
  end if;

  if exists (select 1 from information_schema.columns
              where table_name = 'consumer_profile' and column_name = 'data_units') then
    raise exception 'data_units is still there';
  end if;

  raise notice 'subscriber lines: %',
    (select string_agg(cp.name || ' ' || cp.msisdn || ' since ' || nr.activated_on, '; ')
       from public.consumer_profile cp
       join public.number_resource nr on nr.user_id = cp.user_id
      where nr.kind = 'msisdn' and nr.purpose = 'retail');
end $$;
