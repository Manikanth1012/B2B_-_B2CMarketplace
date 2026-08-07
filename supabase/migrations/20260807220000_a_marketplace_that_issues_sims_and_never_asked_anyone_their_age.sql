/* Date of birth.
 *
 * The marketplace holds a name, an email, an address, a KYC level and — since
 * yesterday — an MSISDN and a SIM for every customer, and has never asked
 * anybody how old they are. That is not a missing field on a form. Issuing a
 * mobile number to a minor in their own name is not allowed in India, Kenya or
 * the UAE, and the marketplace has been allocating them without a way to check.
 *
 * So this is not a profile decoration. It is the input to a rule.
 *
 * Two positions taken here and enforced below:
 *
 *   Age is never stored. It is derived from the date every time it is asked
 *   for. A stored age is wrong the day after it is written, and nothing
 *   recomputes it.
 *
 *   Nobody outside the customer needs the exact date. The operator needs to
 *   know whether somebody is old enough, and for reporting an age band is
 *   enough. The full date stays with the person it belongs to and with the
 *   KYC record that verified it.
 */

alter table public.consumer_profile
  add column if not exists dob date,
  /* Where it came from. A date somebody typed into a profile form is a
     different claim from one an ID document was checked against, and treating
     them as the same is how an unverified date ends up gating a legal
     requirement. */
  add column if not exists dob_source text
    check (dob_source in ('self','kyc','import'));

alter table public.telco_identities
  add column if not exists dob date;

comment on column public.consumer_profile.dob is
  'Date of birth. Nullable — "not given" is a real state and is different from '
  '"under age". Age is derived from it and is never stored.';

/* A date in the future is not a birth date, and neither is one a hundred and
   thirty years ago. Both are typos, and both would otherwise sit in the table
   gating a legal check. */
create or replace function public.guard_dob()
returns trigger language plpgsql as $$
begin
  if new.dob is null then
    new.dob_source := null;
    return new;
  end if;
  if new.dob > current_date then
    raise exception 'A date of birth in the future is a typo, not a date of birth';
  end if;
  if new.dob < current_date - interval '130 years' then
    raise exception 'That date of birth would make the customer over 130';
  end if;
  if new.dob_source is null then
    /* Self-declared unless somebody says otherwise. Silently promoting it to
       verified is how an unchecked date comes to gate a legal requirement. */
    new.dob_source := 'self';
  end if;
  return new;
end $$;

drop trigger if exists z_guard_dob on public.consumer_profile;
create trigger z_guard_dob
  before insert or update on public.consumer_profile
  for each row execute function public.guard_dob();

/* ---- Age, derived ------------------------------------------------------------ */

create or replace function public.age_years(p_dob date, p_on date default current_date)
returns integer language sql immutable as $$
  select case when p_dob is null then null
              else extract(year from age(p_on, p_dob))::integer end
$$;

/* The band, for anywhere the exact date is more than is needed. An operator
   report does not require somebody's birthday. */
create or replace function public.age_band(p_dob date, p_on date default current_date)
returns text language sql immutable as $$
  select case
    when p_dob is null then 'not given'
    when public.age_years(p_dob, p_on) < 18 then 'under 18'
    when public.age_years(p_dob, p_on) < 25 then '18-24'
    when public.age_years(p_dob, p_on) < 35 then '25-34'
    when public.age_years(p_dob, p_on) < 50 then '35-49'
    when public.age_years(p_dob, p_on) < 65 then '50-64'
    else '65+' end
$$;

/* ---- The rule it exists for -------------------------------------------------- */

/* A retail number cannot be issued to a minor in their own name. The check
   belongs in the allocation, not on the form — a form can be skipped and the
   API cannot. */
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
begin
  /* Age first, because refusing after allocating would burn a number. */
  if p_user is not null and p_purpose = 'retail' then
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

/* ---- The data the customer is entitled to ------------------------------------ */

/* A date of birth is personal data and has to come out in an export. A field
   the marketplace holds and the export omits is the export lying by omission. */
create or replace view public.my_personal_data
with (security_invoker = on) as
  select cp.user_id,
         cp.name, cp.email, cp.msisdn, cp.city, cp.market, cp.currency,
         cp.customer_id, cp.since,
         cp.dob,
         cp.dob_source,
         public.age_years(cp.dob) as age,
         cp.preferred_language, cp.time_zone,
         cp.identity_source, cp.verified_by, cp.verified_at
    from public.consumer_profile cp
   where cp.user_id = auth.uid();

grant select on public.my_personal_data to authenticated;
grant execute on function public.age_years(date, date) to authenticated;
grant execute on function public.age_band(date, date) to authenticated;

/* ---- Synthetic data for the customers on file -------------------------------- */

/* Real dates, consistent with everything else the record says. Each one is old
   enough to have opened the account when the account says it was opened —
   a customer since 2021 who turns out to be nineteen now would have been
   fourteen at sign-up, which is the sort of thing nobody notices until a demo. */
update public.consumer_profile set dob = v.dob, dob_source = v.src
  from (values
    /* Bengaluru, on file since 2021 through the telco SSO, KYC verified
       against an Aadhaar — so the date came from the document. */
    ('Priya Raman',       date '1991-04-17', 'kyc'),
    /* Nairobi, self-registered in 2025 — she typed it in herself. */
    ('Wanjiru Kamau',     date '1996-11-02', 'self'),
    /* Kisumu, telco SSO with a National ID behind it. */
    ('Otieno Odhiambo',   date '1988-07-25', 'kyc')
  ) as v(name, dob, src)
 where public.consumer_profile.name = v.name
   and public.consumer_profile.user_id is not null;

/* The KYC side holds the same dates for the same people, because that is where
   they were verified. A telco identity whose date disagrees with the
   marketplace's copy is a reconciliation problem, so they are written from one
   place. */
update public.telco_identities t set dob = cp.dob
  from public.consumer_profile cp
 where lower(t.name) = lower(cp.name) and cp.dob is not null;

/* The two SSO identities with no marketplace account get theirs too — the
   telco verified them, and a KYC record with a Full level and no date of birth
   is a record that did not verify what it claims to have verified. */
update public.telco_identities set dob = v.dob
  from (values
    ('AV-IN-88214021', date '1993-02-08'),   -- Rohan Mehta, Pune
    ('AV-UG-51200934', date '1999-06-30'),   -- Aisha Nakato, Kampala
    ('AV-AE-30047781', date '2001-09-12')    -- Yusuf Al Marzooqi, basic KYC
  ) as v(subject, dob)
 where public.telco_identities.subject = v.subject
   and public.telco_identities.dob is null;

/* ---- Assertions --------------------------------------------------------------- */

do $$
declare
  bad text;
  n int;
  r record;
begin
  /* Every named customer has one. The integration-test shoppers do not, and
     should not — "not given" has to stay reachable or the empty state is
     never seen. */
  select string_agg(name, ', ') into bad
    from public.consumer_profile
   where user_id is not null and name not like 'Integration%' and dob is null;
  if bad is not null then raise exception 'customers with no date of birth: %', bad; end if;

  select count(*) into n from public.consumer_profile
   where name like 'Integration%' and dob is not null;
  if n > 0 then raise exception 'the test shoppers were given dates they never gave'; end if;

  /* Nobody is a child, and nobody signed up as one. */
  for r in
    select name, dob, since, public.age_years(dob) as yrs from public.consumer_profile
     where dob is not null
  loop
    if r.yrs < 18 then
      raise exception '% is % and holds a mobile number in their own name', r.name, r.yrs;
    end if;
    if r.yrs > 100 then raise exception '% is %', r.name, r.yrs; end if;
  end loop;

  /* And the KYC copy agrees with the marketplace copy, for everybody who is in
     both. Two systems holding two dates is the reconciliation bug this build
     keeps finding in other shapes. */
  select string_agg(cp.name, ', ') into bad
    from public.consumer_profile cp
    join public.telco_identities t on lower(t.name) = lower(cp.name)
   where cp.dob is distinct from t.dob;
  if bad is not null then raise exception 'the KYC date disagrees with the profile for %', bad; end if;

  /* A Full KYC level with no date of birth did not verify what it claims. */
  select string_agg(name, ', ') into bad from public.telco_identities
   where kyc_level = 'Full' and dob is null;
  if bad is not null then raise exception 'Full KYC with no date of birth: %', bad; end if;

  /* The source is always stated where a date is held. */
  select count(*) into n from public.consumer_profile where dob is not null and dob_source is null;
  if n > 0 then raise exception '% dates of birth do not say where they came from', n; end if;

  /* And the band never leaks the date. */
  /* Pinned to a fixed day, or the assertion is about when it was run. */
  if public.age_band(date '1991-04-17', date '2026-08-07') <> '35-49' then
    raise exception 'the age band is wrong: %', public.age_band(date '1991-04-17', date '2026-08-07');
  end if;
  if public.age_years(date '1991-04-17', date '2026-04-16') <> 34 then
    raise exception 'an age turns over on the birthday, not before it';
  end if;
  if public.age_years(date '1991-04-17', date '2026-04-17') <> 35 then
    raise exception 'an age turns over on the birthday itself';
  end if;
  if public.age_band(null) <> 'not given' then raise exception 'a missing date is not a band'; end if;

  raise notice 'dates of birth: profiles %, identities %',
    (select count(*) from public.consumer_profile where dob is not null),
    (select count(*) from public.telco_identities where dob is not null);
end $$;
