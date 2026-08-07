/* A hundred and five sensors got a SIM and no number.
 *
 * `assign_number` filtered blocks on `status = 'active'`. India's M2M block is
 * marked `expiring` — its reservation runs out on 30 September and somebody has
 * to renew it — and expiring is not expired. The block has 4,000 numbers
 * reserved and every one of them is allocatable today.
 *
 * The effect was silent and specific: the ICCID assignment succeeded, the
 * MSISDN one returned "no active msisdn block reserved for iot in IN", and the
 * seed's `if (q->>'ok')` branch skipped the pairing without a word. A hundred
 * and five devices in the field with a SIM and nothing to dial.
 *
 * A status is a warning to a human, not a gate on the machine. What actually
 * stops an allocation is the expiry date, and that is already checked.
 */

create or replace function public.assign_number(
  p_kind text, p_market text, p_purpose text,
  p_user uuid default null, p_account text default null,
  p_serial text default null, p_holder text default null,
  p_order text default null, p_plan text default null
) returns jsonb
language plpgsql security definer
set search_path = public, extensions as $$
declare
  rng public.number_range;
  val text;
  id  text;
begin
  select * into rng from public.number_range
   where kind = p_kind and market = p_market and purpose = p_purpose
     /* Expiring is a flag for whoever renews the reservation. Only released
        and exhausted stop an allocation, and the date does the rest. */
     and status in ('active', 'expiring')
     and (expires_on is null or expires_on > current_date)
   order by (status = 'active') desc, sort_order
   limit 1;

  if rng.id is null then
    return jsonb_build_object('ok', false,
      'why', format('No usable %s block reserved for %s in %s. Reserve one from the owning system first.',
                    p_kind, p_purpose, p_market));
  end if;

  val := public.next_in_range(rng.id);
  if val is null then
    return jsonb_build_object('ok', false,
      'why', format('%s is exhausted — all %s reserved numbers are allocated.', rng.id, rng.reserved));
  end if;

  id := upper(p_kind) || '-' || val;
  insert into public.number_resource
    (id, kind, value, range_id, market, purpose, state,
     user_id, account_id, stock_serial, holder_name, order_ref, plan,
     bss_ref, assigned_on, activated_on)
  values (id, p_kind, val, rng.id, p_market, p_purpose, 'assigned',
     p_user, p_account, p_serial, p_holder, p_order, p_plan,
     'TMF652-' || upper(substr(md5(id || now()::text), 1, 10)),
     current_date, current_date);

  return jsonb_build_object('ok', true, 'id', id, 'value', val, 'range', rng.id,
    'expires_on', rng.expires_on);
end $$;

/* Give the hundred and five devices their numbers. */
do $$
declare
  s record;
  q jsonb;
  n int := 0;
begin
  for s in
    select nr.stock_serial, nr.id as sim_id, nr.market, nr.account_id, nr.user_id,
           nr.holder_name, nr.order_ref
      from public.number_resource nr
     where nr.kind = 'iccid' and nr.purpose = 'iot' and nr.stock_serial is not null
       and not exists (select 1 from public.number_resource m
                        where m.kind = 'msisdn' and m.stock_serial = nr.stock_serial)
     order by nr.id
  loop
    q := public.assign_number('msisdn', s.market, 'iot', s.user_id, s.account_id,
                              s.stock_serial, s.holder_name, s.order_ref, 'Aventa IoT Connect');
    if not (q->>'ok')::boolean then
      raise exception 'still cannot number %: %', s.stock_serial, q->>'why';
    end if;
    update public.number_resource set paired_with = q->>'id'   where id = s.sim_id;
    update public.number_resource set paired_with = s.sim_id    where id = q->>'id';
    n := n + 1;
  end loop;
  raise notice 'devices given a number: %', n;
end $$;

do $$
declare
  n int;
  bad text;
begin
  /* A SIM in a device with no number behind it is a device nobody can reach,
     which is the whole failure this pair of migrations exists to end. */
  select count(*) into n from public.number_resource nr
   where nr.kind = 'iccid' and nr.stock_serial is not null
     and not exists (select 1 from public.number_resource m
                      where m.kind = 'msisdn' and m.stock_serial = nr.stock_serial);
  if n > 0 then raise exception '% devices have a SIM and no number', n; end if;

  /* And every pairing points both ways. */
  select count(*) into n from public.number_resource a
    join public.number_resource b on b.id = a.paired_with
   where b.paired_with is distinct from a.id;
  if n > 0 then raise exception '% pairings are one-way', n; end if;

  /* The expiring block is allocating and is still flagged, because the renewal
     is a real piece of work somebody owes. */
  if (select assigned from public.range_use where range_id = 'RNG-IN-M2M') = 0 then
    raise exception 'the M2M block is still allocating nothing';
  end if;
  if (select status from public.number_range where id = 'RNG-IN-M2M') <> 'expiring' then
    raise exception 'the M2M reservation still lapses in September and should say so';
  end if;

  select string_agg(range_id || ' (' || used_pct || '%)', ', ') into bad
    from public.range_use where used_pct > 80;
  raise notice 'blocks over 80%% used: %', coalesce(bad, 'none');
end $$;
