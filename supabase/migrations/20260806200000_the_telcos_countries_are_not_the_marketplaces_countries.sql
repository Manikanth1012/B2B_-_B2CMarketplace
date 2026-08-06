/*
  # The telco's countries are not the marketplace's countries

  `20260806190000` needed a subscriber registered somewhere the marketplace does
  not sell, so the refusal path had something to refuse. It got one by adding
  Uganda to `markets` with a `trades = false` flag.

  That was the wrong table. `markets` is the marketplace's own list — every
  screen that reads it treats a row as a place you can shop. `moneyRepo` loads
  all of them into the `MoneyBook` the storefront's country picker is drawn
  from, so Uganda appeared as somewhere to browse, with no currency accepted, no
  seller approved and nothing priced. A `trades` flag would then have to be
  honoured by every one of those readers, and the first one that forgot would
  put a customer in a country the marketplace cannot bill.

  The modelling was inverted. `telco_identities` describes an external system.
  The telco operates in more countries than the marketplace trades in — that is
  the entire premise of the refusal — so its `market` is *the telco's* code, in
  the telco's vocabulary, and the foreign key asserting it must also be one of
  the marketplace's was the mistake.

  So the key goes, Uganda comes back out of `markets`, and the refusal becomes
  what it always was: this assertion names a country we do not trade in. The
  `trades` column goes with it. Nothing exercised it once Uganda left, and a
  flag that is always true is a flag every reader has to remember and none has a
  reason to.
*/

alter table telco_identities drop constraint if exists telco_identities_market_fkey;

comment on column telco_identities.market is
  'The telco''s country code for this subscriber, in the telco''s vocabulary. Not a foreign key: the telco operates where the marketplace does not, which is what sso_begin refuses on.';

delete from markets where code = 'UG';
alter table markets drop column if exists trades;

/* The refusal now asks the marketplace's own list whether it has heard of the
   country, rather than asking a flag on a row that should not have existed. */
create or replace function sso_begin(p_subject text, p_secret text)
returns table (
  outcome text, reason text,
  subject text, name text, email text, msisdn text, market text, city text,
  line1 text, pin text, kyc_level text, kyc_id_kind text, kyc_id_masked text,
  kyc_verified_on date, customer_since date, plan text,
  market_name text, currency text
)
language plpgsql security definer set search_path = public as $$
declare
  t telco_identities;
  m markets;
  existing uuid;
  linked uuid;
begin
  select * into t from telco_identities where telco_identities.subject = p_subject;
  if t is null or t.id_secret is distinct from p_secret then
    /* One message for "no such subscriber" and "wrong credential". Saying which
       turns this into a directory of who holds an Aventa account. */
    raise exception 'That did not match an Aventa ID.';
  end if;
  if t.status <> 'active' then
    raise exception 'That Aventa ID is not active. Speak to the telco before using it here.';
  end if;

  select * into m from markets where code = t.market;

  /* Where they are decides what they can be sold. A subscriber in a country the
     marketplace has never heard of gets a plain refusal and the list of where
     it does trade, rather than an account that can buy nothing. */
  if m is null then
    return query select
      'refused'::text,
      format('Your Aventa account is registered in %s, and the marketplace does not trade there yet. It trades in %s.',
             t.market,
             (select string_agg(mk.name, ', ' order by mk.sort_order) from markets mk))::text,
      t.subject, t.name, t.email, t.msisdn, t.market, t.city, t.line1, t.pin,
      t.kyc_level, t.kyc_id_kind, t.kyc_id_masked, t.kyc_verified_on,
      t.customer_since, t.plan, t.market, null::text;
    return;
  end if;

  /* Verified for a phone line is not verified for a marketplace account that
     holds a wallet and takes payment. */
  if t.kyc_level <> 'Full' then
    return query select
      'refused'::text,
      format('Your Aventa ID is verified to %s level, and opening a marketplace account needs full verification. Complete it with the telco, or create an account here instead.', lower(t.kyc_level))::text,
      t.subject, t.name, t.email, t.msisdn, t.market, t.city, t.line1, t.pin,
      t.kyc_level, t.kyc_id_kind, t.kyc_id_masked, t.kyc_verified_on,
      t.customer_since, t.plan, m.name, null::text;
    return;
  end if;

  select l.user_id into linked from identity_links l where l.subject = p_subject;
  select u.id into existing from auth.users u where lower(u.email) = lower(t.email);

  return query select
    case
      when linked is not null then 'signin'
      /* An account on the address that is not linked. Not a duplicate and not
         theirs to take — proved once, with its own password, then bound. */
      when existing is not null then 'link'
      else 'provision'
    end::text,
    case
      when linked is not null then null
      when existing is not null then
        format('There is already a marketplace account on %s. Sign into it once to prove it is yours, and we will link the two for good.', t.email)
      else null
    end::text,
    t.subject, t.name, t.email, t.msisdn, t.market, t.city, t.line1, t.pin,
    t.kyc_level, t.kyc_id_kind, t.kyc_id_masked, t.kyc_verified_on,
    t.customer_since, t.plan, m.name,
    (select mc.currency from market_currencies mc
      where mc.market_code = t.market order by mc.is_default desc, mc.sort_order limit 1);
end $$;

/* And the two writers stop asking about a column that no longer exists. */
create or replace function sso_provision(p_subject text, p_secret text, p_mk_secret text)
returns text
language plpgsql security definer set search_path = public as $$
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
    preferred_language, time_zone, data_units, currency, market,
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
    'GB', v_currency, t.market,
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
end $$;

do $$
declare n integer;
begin
  /* The marketplace's list is the three it trades in, and the picker draws
     exactly those. */
  select count(*) into n from markets;
  if n <> 3 then raise exception 'The marketplace has % markets, expected 3', n; end if;

  select count(*) into n from markets where code not in ('IN', 'KE', 'AE');
  if n > 0 then raise exception 'A market the marketplace does not trade in is back on the list'; end if;

  /* The subscriber in a country it does not trade in survives, because the
     refusal is the thing being demonstrated. */
  select count(*) into n from telco_identities t
   where not exists (select 1 from markets m where m.code = t.market);
  if n <> 1 then raise exception '% subscribers are outside the traded markets, expected 1', n; end if;

  /* And every other subscriber names one it does trade in. */
  select count(*) into n from telco_identities t
   where t.market <> 'UG' and not exists (select 1 from markets m where m.code = t.market);
  if n > 0 then raise exception '% subscribers name a market that is neither traded nor the refusal case', n; end if;

  /* Every market still has an issuing entity and a currency, which adding a
     fourth row had quietly broken. */
  select count(*) into n from markets m
   where not exists (select 1 from invoice_issuer i where i.market = m.code);
  if n > 0 then raise exception '% markets have no issuing entity', n; end if;

  select count(*) into n from markets m
   where not exists (select 1 from market_currencies c where c.market_code = m.code);
  if n > 0 then raise exception '% markets accept no currency', n; end if;
end $$;
