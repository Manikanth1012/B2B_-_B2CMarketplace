/* Dropping a column is not finished until nothing writes it.
 *
 * `data_units` was withdrawn and the column removed, and two functions still
 * listed it in an insert: `register_as_consumer` and `sso_provision`. Every
 * registration failed — the integration suite caught it, five tests in the file
 * that registers a shopper, and the last one is there for exactly this: it
 * asserts at least one account was created, so the refusals above it cannot
 * pass vacuously against a function that never worked.
 *
 * The lesson is in the migration list rather than in these two functions: a
 * column added in one migration is written by every function defined after it,
 * and `drop column` does not tell you which. The check is
 * `pg_proc.prosrc like '%the_column%'`, and it belongs in the migration that
 * drops the column rather than in the one that repairs it afterwards.
 */

CREATE OR REPLACE FUNCTION public.register_as_consumer(p_name text, p_msisdn text, p_city text, p_market text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid;
  v_email text;
  v_customer text;
  v_currency text;
  v_id text;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'Create the sign-in first — there is nothing to attach a profile to.';
  end if;

  /* The one check that makes this safe to expose. Somebody who already has a
     profile has a persona, and this function must never be a way to change it —
     an operator calling it would otherwise end up with a consumer row and a
     basket, and a consumer calling it twice would get two. */
  if exists (select 1 from profiles where id = v_uid) then
    raise exception 'This sign-in is already registered.';
  end if;

  if coalesce(trim(p_name), '') = '' then
    raise exception 'Give the name the account should be in.';
  end if;
  if coalesce(trim(p_msisdn), '') = '' then
    raise exception 'Give a mobile number — it is what plans and top-ups are attached to.';
  end if;
  if coalesce(trim(p_city), '') = '' then
    raise exception 'Give a city, so deliveries and tax go to the right place.';
  end if;

  /* Where they are registered decides which market they buy in and therefore
     what they pay and what tax they pay — `20260802450000`. Not a preference,
     and not something the storefront picker changes afterwards. */
  if not exists (select 1 from markets m where m.code = p_market) then
    raise exception 'The marketplace does not operate there yet. It trades in %.',
      (select string_agg(name, ', ' order by sort_order) from markets);
  end if;
  select mc.currency into v_currency from market_currencies mc
   where mc.market_code = p_market order by mc.is_default desc, mc.sort_order limit 1;

  select email into v_email from auth.users where id = v_uid;

  /* Persona is a literal. It is not a parameter, it is not read from a table a
     caller can write, and there is no other statement in this schema that puts
     a row in `profiles` from a client request. */
  insert into profiles (id, persona) values (v_uid, 'consumer');

  v_customer := 'CUS-' || nextval('consumer_ref_seq')::text;
  v_id := 'cp-' || replace(v_uid::text, '-', '');

  /* Every column named. The table's defaults are Priya Raman's — her wallet,
     her phone number — and an omitted column here would silently hand a
     stranger her balance.

     `tier` and `points` are gone from this list because they are gone from the
     table: they duplicated `loyalty_members`, nothing maintained the copy, and
     the second customer arrived with 0 against a ledger of 760. The membership
     row below carries both, and is the only place either is written. */
  insert into consumer_profile (
    id, user_id, name, customer_id, msisdn, city, since, wallet,
    payment_method, email, mfa_enabled, active_sessions, pwd_changed,
    preferred_language, time_zone, currency, market
  ) values (
    v_id, v_uid, trim(p_name), v_customer, trim(p_msisdn), trim(p_city),
    'Customer since ' || to_char(now(), 'Mon YYYY'),
    0,
    'Not set up yet', coalesce(v_email, ''), false, 1, to_char(now(), 'DD Mon YYYY'),
    'English',
    case p_market when 'IN' then 'Asia/Kolkata (IST)'
                  when 'AE' then 'Asia/Dubai (GST)'
                  when 'KE' then 'Africa/Nairobi (EAT)'
                  else 'UTC' end,
    v_currency, p_market
  );

  /* A membership row, because the rewards screen reads one and a shopper
     without it has a screen that renders nothing rather than zero. Balances at
     nought: points are earned, and seeding any would be inventing a purchase
     history. */
  insert into loyalty_members (id, party, name, kind, tier, balance, joined,
                               qualify_12m, lifetime_earned, lifetime_redeemed,
                               expiring_soon, user_id, currency)
  values ('LM-' || replace(v_customer, 'CUS-', ''), v_customer, trim(p_name),
          'consumer', 'bronze', 0, to_char(now(), 'DD Mon YYYY'),
          0, 0, 0, 0, v_uid, v_currency);

  return v_customer;
end $function$;

CREATE OR REPLACE FUNCTION public.sso_provision(p_subject text, p_secret text, p_mk_secret text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  t telco_identities;
  v_uid uuid := auth.uid();
  v_email text;
  v_customer text;
  v_currency text;
  v_id text;
begin
  if v_uid is null then
    raise exception 'Create the sign-in first — there is nothing to attach a profile to.';
  end if;

  select * into t from telco_identities where telco_identities.subject = p_subject;
  if t is null or t.id_secret is distinct from p_secret then
    raise exception 'That did not match an Aventa ID.';
  end if;

  select email into v_email from auth.users where id = v_uid;
  if lower(coalesce(v_email, '')) is distinct from lower(t.email) then
    raise exception 'That sign-in is not the address the Aventa ID asserts, so it cannot be opened from it.';
  end if;

  if exists (select 1 from profiles where id = v_uid) then
    raise exception 'This sign-in is already registered.';
  end if;
  if exists (select 1 from identity_links where subject = p_subject) then
    raise exception 'That Aventa ID is already linked to a marketplace account.';
  end if;
  if not exists (select 1 from markets where code = t.market) then
    raise exception 'The marketplace does not trade in %.', t.market;
  end if;
  if t.kyc_level <> 'Full' then
    raise exception 'That Aventa ID is not verified to the standard a marketplace account needs.';
  end if;

  select mc.currency into v_currency from market_currencies mc
   where mc.market_code = t.market order by mc.is_default desc, mc.sort_order limit 1;

  /* Persona is a literal, for the reason it is a literal in
     `register_as_consumer`: an assertion says who somebody is, never what they
     are allowed to be. */
  insert into profiles (id, persona) values (v_uid, 'consumer');

  v_customer := 'CUS-' || nextval('consumer_ref_seq')::text;
  v_id := 'cp-' || replace(v_uid::text, '-', '');

  insert into consumer_profile (
    id, user_id, name, customer_id, msisdn, city, since, wallet,
    payment_method, email, mfa_enabled, active_sessions, pwd_changed,
    preferred_language, time_zone, currency, market,
    identity_source, verified_by, verified_at
  ) values (
    v_id, v_uid, t.name, v_customer, t.msisdn, t.city,
    'Customer since ' || to_char(t.customer_since, 'Mon YYYY'),
    0, 'Not set up yet', t.email, false, 1, to_char(now(), 'DD Mon YYYY'),
    'English',
    case t.market when 'IN' then 'Asia/Kolkata (IST)'
                  when 'AE' then 'Asia/Dubai (GST)'
                  when 'KE' then 'Africa/Nairobi (EAT)'
                  else 'UTC' end,
    v_currency, t.market,
    'telco-sso', 'Aventa ID · ' || t.kyc_id_kind, t.kyc_verified_on
  );

  /* Their address, because the telco has it and asking for it again is the
     thing this door exists to stop. */
  insert into consumer_addresses (id, label, line1, city, pin, phone, notes, is_default, user_id)
  values ('AD-' || replace(v_customer, 'CUS-', ''), 'Home', t.line1, t.city, t.pin,
          t.msisdn, 'Brought across from your Aventa account.', true, v_uid);

  insert into loyalty_members (id, party, name, kind, tier, balance, joined,
                               qualify_12m, lifetime_earned, lifetime_redeemed,
                               expiring_soon, user_id, currency)
  values ('LM-' || replace(v_customer, 'CUS-', ''), v_customer, t.name,
          'consumer', 'bronze', 0, to_char(now(), 'DD Mon YYYY'),
          0, 0, 0, 0, v_uid, v_currency);

  insert into identity_links (user_id, subject, how, mk_secret)
  values (v_uid, p_subject, 'provisioned', p_mk_secret);

  return v_customer;
end $function$;


do $$
declare
  bad text;
begin
  /* Nothing writes the column that no longer exists. The check that should
     have run when it was dropped. */
  select string_agg(p.proname, ', ') into bad
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prosrc like '%data_units%';
  if bad is not null then raise exception 'still writing data_units: %', bad; end if;

  if exists (select 1 from information_schema.columns
              where table_name = 'consumer_profile' and column_name = 'data_units') then
    raise exception 'the column came back';
  end if;
end $$;
