/* Two rules that were never stated, and the data that broke both.
 *
 * FIRST: a marketplace account is not a network subscription. Somebody can sign
 * up, buy a router and never be a telco customer at all. Only a person with a
 * telco identity behind them — an SSO link to the BSS, with KYC done there — is
 * on the network, and only they can hold a mobile number and a SIM in their own
 * name. Wanjiru Kamau has no identity link, no verification and no KYC, and the
 * number seed gave her a Kenyan MSISDN and a SIM anyway. She is a marketplace
 * customer, not a subscriber, and those records should not exist.
 *
 * The distinction is not pedantry. A number in the BSS against somebody the BSS
 * has never KYC'd is a regulatory problem in every market this sells in, and it
 * is exactly the kind of row that gets created by a seed loop that reads
 * `consumer_profile` and assumes every row in it is a subscriber.
 *
 * SECOND: every customer on file has been on the network for at least a year.
 * A demo where somebody signed up last month has no bill history to show, no
 * renewal, no tenure and no loyalty tier that means anything. Yusuf Al Marzooqi
 * was 250 days old.
 *
 * A third thing fell out of checking the first: `identity_source` said 'self'
 * for Priya Raman, who has an identity link and an Aadhaar verification on her
 * record. A stored flag that disagrees with the table it summarises is the same
 * two-answers bug this build keeps finding, so it is now written by the link
 * rather than typed beside it.
 */

/* ---- 1. The flag follows the link ------------------------------------------- */

create or replace function public.z_identity_source_follows_link()
returns trigger language plpgsql as $$
begin
  update public.consumer_profile cp
     set identity_source = case when tg_op = 'DELETE' then 'self' else 'telco-sso' end,
         verified_by = case when tg_op = 'DELETE' then null else cp.verified_by end,
         verified_at = case when tg_op = 'DELETE' then null else cp.verified_at end
   where cp.user_id = coalesce(new.user_id, old.user_id);
  return coalesce(new, old);
end $$;

drop trigger if exists z_identity_source_follows_link on public.identity_links;
create trigger z_identity_source_follows_link
  after insert or delete on public.identity_links
  for each row execute function public.z_identity_source_follows_link();

/* Correct what is already there. */
update public.consumer_profile cp
   set identity_source = case
     when exists (select 1 from public.identity_links il where il.user_id = cp.user_id)
     then 'telco-sso' else 'self' end
 where cp.user_id is not null;

/* Whether somebody is actually on the network, in one place, derived. */
create or replace view public.customer_network_status
with (security_invoker = on) as
  select cp.user_id, cp.name, cp.customer_id, cp.market,
         il.subject,
         (il.subject is not null) as on_network,
         t.customer_since as network_since,
         case when t.customer_since is null then null
              else (current_date - t.customer_since) end as days_on_network,
         t.kyc_level, t.kyc_id_kind,
         (select count(*) from public.number_resource n
           where n.user_id = cp.user_id and n.purpose = 'retail'
             and n.state in ('assigned','suspended')) as personal_lines
    from public.consumer_profile cp
    left join public.identity_links il on il.user_id = cp.user_id
    left join public.telco_identities t on t.subject = il.subject
   where cp.user_id is not null;

grant select on public.customer_network_status to authenticated;

/* ---- 2. A personal line needs a network identity ---------------------------- */

/* Enforced in the allocation rather than left to whoever writes the next seed
   loop. The rule is about a line held in somebody's own name: device
   connectivity bought with an IoT product is a different thing, sold with the
   product, and is not gated here. */
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
  dob date;
  yrs integer;
  who text;
begin
  if p_user is not null and p_purpose = 'retail' then
    /* On the network at all? A marketplace account is not a subscription, and
       a number in the BSS against somebody it has never KYC'd is a regulatory
       problem in every market this sells in. */
    if not exists (select 1 from public.identity_links il where il.user_id = p_user) then
      select cp.name into who from public.consumer_profile cp where cp.user_id = p_user;
      return jsonb_build_object('ok', false,
        'why', format('%s is a marketplace customer and is not on the network — there is no telco identity linked to the account. A number and a SIM come with a network subscription, and that starts with an identity check the marketplace does not do.',
                      coalesce(who, 'That customer')));
    end if;

    select cp.dob into dob from public.consumer_profile cp where cp.user_id = p_user;
    yrs := public.age_years(dob);
    if yrs is not null and yrs < 18 then
      return jsonb_build_object('ok', false,
        'why', format('That customer is %s. A mobile number cannot be issued to somebody under 18 in their own name — it goes to a parent or guardian, on their account.', yrs));
    end if;
  end if;

  select * into rng from public.number_range
   where kind = p_kind and market = p_market and purpose = p_purpose
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

/* And the same rule on the table, so a direct write cannot get round it. */
create or replace function public.guard_personal_line()
returns trigger language plpgsql as $$
declare
  who text;
begin
  /* Only when a row is being put into the guarded state, not every time it is
     touched. Clearing a pairing on a row that is already wrong would otherwise
     fire the guard and block the very cleanup that fixes it. */
  if tg_op = 'UPDATE'
     and new.user_id is not distinct from old.user_id
     and new.purpose is not distinct from old.purpose
     and new.state is not distinct from old.state then
    return new;
  end if;

  if new.purpose = 'retail' and new.user_id is not null
     and new.state in ('assigned','suspended') then
    if not exists (select 1 from public.identity_links il where il.user_id = new.user_id) then
      select cp.name into who from public.consumer_profile cp where cp.user_id = new.user_id;
      raise exception
        '% is not on the network — a personal number and SIM belong to a subscriber, and this account has no telco identity linked to it',
        coalesce(who, new.user_id::text);
    end if;
  end if;
  return new;
end $$;

drop trigger if exists z_guard_personal_line on public.number_resource;
create trigger z_guard_personal_line
  before insert or update on public.number_resource
  for each row execute function public.guard_personal_line();

/* ---- 3. Take back what should never have been issued ------------------------ */

/* Deleted rather than released into quarantine. Quarantine exists to protect
   the previous holder's calls, and these numbers were never in service — there
   are no calls to protect and no bill to reconcile. They go straight back to
   being free, which is what they always were. */
delete from public.esim_profile e
 using public.number_resource n
 where e.resource_id = n.id
   and n.purpose = 'retail' and n.user_id is not null
   and not exists (select 1 from public.identity_links il where il.user_id = n.user_id);

/* Unpair first, or the pairing points at a row that is about to go. */
update public.number_resource a
   set paired_with = null
  from public.number_resource b
 where a.paired_with = b.id
   and b.purpose = 'retail' and b.user_id is not null
   and not exists (select 1 from public.identity_links il where il.user_id = b.user_id);

delete from public.number_resource n
 where n.purpose = 'retail' and n.user_id is not null
   and not exists (select 1 from public.identity_links il where il.user_id = n.user_id);

/* ---- 4. A year on the network, at least ------------------------------------- */

/* Yusuf Al Marzooqi joined 250 days ago. A demo customer with less than a year
   behind them has no renewal, no tenure and no bill history worth showing, and
   every screen that reads "customer since" reads as a brand-new account. */
update public.telco_identities
   set customer_since = date '2025-02-14'
 where subject = 'AV-AE-30047781' and customer_since > current_date - interval '1 year';

/* Priya's marketplace record said "Customer since Jun 2024" and her telco
   record says she has been on the network since March 2021. Two dates for one
   fact, and the marketplace was showing the later one. The network is where
   the relationship started, so that is the date. */
update public.consumer_profile cp
   set since = 'Customer since ' || to_char(t.customer_since, 'Mon YYYY')
  from public.identity_links il
  join public.telco_identities t on t.subject = il.subject
 where il.user_id = cp.user_id
   and cp.since is distinct from 'Customer since ' || to_char(t.customer_since, 'Mon YYYY');

/* ---- 5. Fifteen test shoppers carrying Priya's phone number ------------------ */

/* The registration test's fixture uses `+91 98860 41127`, which is Priya
   Raman's. Every account the suite has ever left behind carries it, so a
   support search for that number returns sixteen people. They are marketplace
   accounts and not subscribers, so what they hold is a contact number — it
   just has to be their own. */
update public.consumer_profile
   set msisdn = '+91 98860 ' || lpad((41200 + (abs(hashtext(customer_id)) % 700))::text, 5, '0')
 where name = 'Integration Shopper' and msisdn = '+91 98860 41127';

/* ---- 6. Assertions ----------------------------------------------------------- */

do $$
declare
  bad text;
  n int;
  r record;
begin
  /* Nobody off the network holds a line. */
  select string_agg(distinct coalesce(cp.name, n2.user_id::text), ', ') into bad
    from public.number_resource n2
    left join public.consumer_profile cp on cp.user_id = n2.user_id
   where n2.purpose = 'retail' and n2.user_id is not null
     and not exists (select 1 from public.identity_links il where il.user_id = n2.user_id);
  if bad is not null then
    raise exception 'off-network customers still holding a personal line: %', bad;
  end if;

  /* And the ones who are on it kept theirs. */
  select count(*) into n from public.number_resource
   where purpose = 'retail' and user_id is not null and state = 'assigned';
  if n = 0 then raise exception 'every personal line was removed, which is too many'; end if;

  /* The rule refuses rather than merely having been applied once. */
  begin
    insert into public.number_resource
      (id, kind, value, range_id, market, purpose, state, user_id, assigned_on)
    select 'TEST-GUARD', 'msisdn', '711399999', 'RNG-KE-RTL', 'KE', 'retail', 'assigned',
           cp.user_id, current_date
      from public.consumer_profile cp where cp.name = 'Wanjiru Kamau';
    raise exception 'the guard let an off-network line through';
  exception when others then
    if sqlerrm like '%the guard let%' then raise; end if;
    /* Refused, which is the point. */
  end;

  /* Everybody on the network has been on it a year. */
  select string_agg(t.name || ' (' || (current_date - t.customer_since) || ' days)', ', ') into bad
    from public.telco_identities t
   where t.customer_since > current_date - interval '1 year';
  if bad is not null then raise exception 'on the network for less than a year: %', bad; end if;

  /* And the marketplace's own date agrees with the network's, for everybody in
     both. */
  for r in
    select cp.name, cp.since, t.customer_since
      from public.consumer_profile cp
      join public.identity_links il on il.user_id = cp.user_id
      join public.telco_identities t on t.subject = il.subject
  loop
    if r.since is distinct from 'Customer since ' || to_char(r.customer_since, 'Mon YYYY') then
      raise exception '% says "%" and the network says %', r.name, r.since, r.customer_since;
    end if;
  end loop;

  /* The stored flag agrees with the links table. */
  select string_agg(name, ', ') into bad from public.consumer_profile cp
   where cp.user_id is not null
     and (cp.identity_source = 'telco-sso')
         <> exists (select 1 from public.identity_links il where il.user_id = cp.user_id);
  if bad is not null then raise exception 'identity_source disagrees with the links for %', bad; end if;

  /* Nobody is carrying somebody else's phone number. */
  select count(*) into n from public.consumer_profile
   where msisdn = '+91 98860 41127' and name <> 'Priya Raman';
  if n > 0 then raise exception '% accounts still carry Priya Raman''s number', n; end if;

  raise notice 'on the network: %, marketplace only: %, personal lines: %',
    (select count(*) from public.customer_network_status where on_network),
    (select count(*) from public.customer_network_status where not on_network),
    (select count(*) from public.number_resource where purpose = 'retail' and user_id is not null);
end $$;
