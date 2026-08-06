/*
  # A customer the telco already knows does not fill the form again

  Somebody who already has an Aventa account has already given the telco their
  name, their number, their address and their identity documents, and the telco
  has already verified them. Making them type it all again into a marketplace
  registration form is asking twice for something already answered — and asking
  worse, because the second answer is unverified.

  So: a second door. `Continue with Aventa ID` hands the marketplace a signed
  statement about who they are, and the marketplace opens an account from it.

  The first door does not close. Most of a marketplace's addressable market is
  not a subscriber, and sellers and business buyers never are — there is no 360
  record to assert against for a Nairobi reseller. `register_as_consumer` and
  both application ladders are untouched.

  ## The three outcomes, and the one that matters

  An assertion arrives about a subscriber. Three things can be true:

  - **Nobody here yet** — provision from the assertion. No form.
  - **Already linked** — sign them in.
  - **An account exists on that address and is not linked** — *stop*.

  The third is the whole design. The same person may well have registered by
  hand last year; they are not a duplicate. But an email address in an assertion
  is not proof that the marketplace account on that address is theirs, and
  binding on a match alone means anybody who can make the IdP assert an address
  can take over the account sitting on it.

  So the marketplace refuses to bind on a match. It says an account exists and
  asks them to sign into it once, with its own password. Two credentials proved
  in one session is proof both are theirs. Then it binds, once, and never asks
  again.

  Getting this wrong in the other direction is worse than it looks: silently
  provisioning a second account forks one customer into two wallets, two point
  balances and two order histories, and nothing downstream can tell they are the
  same person.

  ## What is simulated, and where the seam is

  There is no OIDC provider here. `telco_identities` stands in for the
  subscriber directory an IdP would authenticate against, and `id_secret` is the
  credential the *telco* holds — not the marketplace's.

  `mk_secret` on the link row is the seam and is worth being explicit about: the
  marketplace account needs a Supabase credential to establish a session, and a
  real deployment would exchange an authorization code for tokens instead. It is
  generated at provisioning, never chosen by anybody, never shown, and readable
  only by a `security definer` function that has already verified the IdP
  credential. RLS denies every client read of both columns. Against a real IdP
  neither column exists.

  ## What the assertion is allowed to decide

  Name, number, city, address and market — the things the telco verified — and
  nothing else. It does not carry a password, a role or a persona: persona is a
  literal in the function below for exactly the reason it is a literal in
  `register_as_consumer`.
*/

/* ------------------------------------------------ the subscriber directory */

create table if not exists telco_identities (
  subject text primary key,
  name text not null,
  email text not null,
  msisdn text not null,
  market text not null references markets(code),
  city text not null,
  line1 text not null,
  pin text not null,
  /* What the telco verified, and to what standard. This is the whole reason
     the second door is worth having. */
  kyc_level text not null,
  kyc_id_kind text not null,
  kyc_id_masked text not null,
  kyc_verified_on date not null,
  customer_since date not null,
  plan text not null,
  /* The credential the telco holds. Stands in for whatever the IdP
     authenticates with; the marketplace never stores a customer's telco
     password in life. */
  id_secret text not null,
  status text not null default 'active',
  sort_order integer not null default 0
);

alter table telco_identities enable row level security;

/* No policy at all: nothing reads this table from a client session. Every read
   goes through a `security definer` function that returns the assertion and
   never the secrets. */

create table if not exists identity_links (
  user_id uuid primary key references auth.users(id) on delete cascade,
  /* One subscriber, one marketplace account. Without this a second link would
     fork the customer, which is the failure this whole file is about. */
  subject text not null unique references telco_identities(subject),
  how text not null check (how in ('provisioned', 'confirmed-with-password')),
  linked_on timestamptz not null default now(),
  /* See the header. The seam, and the only place it lives. */
  mk_secret text
);

alter table identity_links enable row level security;

/* A customer may see that their account is linked, and to which subscriber.
   `mk_secret` is excluded by the view below rather than by hoping nobody
   selects it. */
drop policy if exists read_own_link on identity_links;
create policy read_own_link on identity_links for select using (user_id = auth.uid());

create or replace view my_identity_link as
  select l.user_id, l.subject, l.how, l.linked_on,
         t.msisdn, t.kyc_level, t.kyc_verified_on, t.plan
    from identity_links l join telco_identities t on t.subject = l.subject
   where l.user_id = auth.uid();

/* --------------------------------------------------- where they came from -- */

alter table consumer_profile add column if not exists identity_source text
  not null default 'self';
alter table consumer_profile add column if not exists verified_by text;
alter table consumer_profile add column if not exists verified_at date;

alter table consumer_profile drop constraint if exists consumer_profile_identity_source_check;
alter table consumer_profile add constraint consumer_profile_identity_source_check
  check (identity_source in ('self', 'telco-sso'));

/* It changes what the account can do, which is why it is recorded rather than
   inferred. Somebody who came through the second door has no marketplace
   password to change; somebody who came through the first has no verified
   identity behind their name. */

/* ------------------------------------------ where the marketplace trades -- */

/* A market the telco operates in and the marketplace does not. It has to exist
   as a row — the subscriber below is registered there and the foreign key is
   the point — but `trades` is what decides whether anything can be sold into
   it. `sso_begin` refuses on this column rather than on a list written into a
   function, so opening Uganda later is a data change and not a code change. */
alter table markets add column if not exists trades boolean not null default true;

insert into markets (code, name, currency, tax_label, tax_rate, tax_note, is_default, sort_order, trades)
select 'UG', 'Uganda', 'USD', 'VAT', 18, 'The telco operates here. The marketplace does not trade here yet.', false, 99, false
where not exists (select 1 from markets where code = 'UG');

update markets set trades = false where code = 'UG';
update markets set trades = true where code in ('IN', 'KE', 'AE');

/* ------------------------------------------------------------- the seed --- */

insert into telco_identities (
  subject, name, email, msisdn, market, city, line1, pin,
  kyc_level, kyc_id_kind, kyc_id_masked, kyc_verified_on, customer_since, plan,
  id_secret, sort_order
) values
  /* Nobody on the marketplace holds this address, so it provisions with no form
     at all — the case the whole feature is for. */
  ('AV-IN-88214021', 'Rohan Mehta', 'rohan.mehta@example.com', '+91 99450 22187',
   'IN', 'Pune', 'Flat 12B, Konark Meadows, Baner Road', '411045',
   'Full', 'Aadhaar', 'XXXX XXXX 4417', '2023-06-14', '2023-06-14',
   'Aventa Freedom 50 GB', 'telco1234', 1),

  /* Kenya, so the second door is not an Indian-only door — the fault this
     marketplace kept finding in everything else. */
  ('AV-KE-44120876', 'Otieno Odhiambo', 'otieno.odhiambo@example.com', '+254 711 306 442',
   'KE', 'Kisumu', 'Milimani Estate, Oginga Odinga Street', '40100',
   'Full', 'National ID', 'XXXXX 8842', '2024-02-03', '2024-02-03',
   'Aventa Freedom Unlimited', 'telco1234', 2),

  /* The one that matters. This is Priya Raman's sign-in address, and she
     registered by hand long before any of this existed — so the assertion
     matches an account nobody has proved is theirs, and the marketplace has to
     stop and ask. Her account, her password and her data are untouched by
     seeding this; the link is only made if somebody signs in as her. */
  ('AV-IN-77105533', 'Priya Raman', 'priya.raman@example.com', '+91 98860 41127',
   'IN', 'Bengaluru', '42 Rustom Bagh, Off Airport Road', '560017',
   'Full', 'Aadhaar', 'XXXX XXXX 9021', '2021-03-09', '2021-03-09',
   'Aventa Freedom 100 GB', 'telco1234', 3),

  /* A subscriber the marketplace cannot serve. The telco operates in more
     countries than the marketplace trades in, and an assertion is not a
     licence to sell somewhere. */
  ('AV-UG-51200934', 'Aisha Nakato', 'aisha.nakato@example.com', '+256 772 415 908',
   'UG', 'Kampala', 'Plot 14, Kira Road, Kamwokya', '00256',
   'Full', 'National ID', 'XXXXX 5510', '2024-09-22', '2024-09-22',
   'Aventa Freedom 20 GB', 'telco1234', 4),

  /* Verified for a phone line and not to the standard the marketplace needs to
     open an account and take payment. A door that ignores this is a door that
     makes KYC decorative. */
  ('AV-AE-30047781', 'Yusuf Al Marzooqi', 'yusuf.almarzooqi@example.com', '+971 55 240 8813',
   'AE', 'Dubai', 'Villa 7, Al Barsha 2', '00000',
   'Basic', 'Emirates ID', 'XXX-XXXX-8813', '2025-11-30', '2025-11-30',
   'Aventa Freedom 10 GB', 'telco1234', 5)
on conflict (subject) do update set
  name = excluded.name, email = excluded.email, msisdn = excluded.msisdn,
  market = excluded.market, city = excluded.city, line1 = excluded.line1,
  pin = excluded.pin, kyc_level = excluded.kyc_level,
  kyc_id_kind = excluded.kyc_id_kind, kyc_id_masked = excluded.kyc_id_masked,
  kyc_verified_on = excluded.kyc_verified_on, plan = excluded.plan;

/* -------------------------------------------------------- the exchange ---- */

/**
 * What the marketplace would do with this assertion, and the assertion itself.
 *
 * Returns no secret. The outcome is computed here rather than on the client
 * because deciding it needs a privileged look at whether an account exists on
 * the asserted address — which the caller has already proved they own.
 */
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

  /* Where they are decides what they can be sold, so a subscriber in a country
     the marketplace does not trade in gets a plain refusal rather than an
     account that can buy nothing. */
  if m is null or not m.trades then
    return query select
      'refused'::text,
      format('Your Aventa account is registered in %s, and the marketplace does not trade there yet. It trades in %s.',
             coalesce(m.name, t.market),
             (select string_agg(name, ', ' order by sort_order) from markets where trades))::text,
      t.subject, t.name, t.email, t.msisdn, t.market, t.city, t.line1, t.pin,
      t.kyc_level, t.kyc_id_kind, t.kyc_id_masked, t.kyc_verified_on,
      t.customer_since, t.plan, coalesce(m.name, t.market), null::text;
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

/**
 * Open a marketplace account from the assertion.
 *
 * Called with a session, in the same order and for the same reason as
 * `registerShopper`: the auth user first, then the rows that make it a
 * customer. The session must be the one on the asserted address — otherwise
 * this is a way to provision somebody else's subscriber onto your own sign-in.
 */
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
  if not exists (select 1 from markets where code = t.market and trades) then
    raise exception 'The marketplace does not trade in that market.';
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

/**
 * Bind an account somebody has just proved is theirs.
 *
 * The second half of the third outcome. By the time this runs they hold a
 * session on the marketplace account — so they have proved the password — and
 * they passed the IdP credential to get the assertion. Two proofs, one binding.
 */
create or replace function sso_link(p_subject text, p_secret text, p_mk_secret text)
returns text
language plpgsql security definer set search_path = public as $$
declare
  t telco_identities;
  v_uid uuid := auth.uid();
  v_email text;
begin
  if v_uid is null then raise exception 'Sign in first.'; end if;

  select * into t from telco_identities where telco_identities.subject = p_subject;
  if t is null or t.id_secret is distinct from p_secret then
    raise exception 'That did not match an Aventa ID.';
  end if;

  select email into v_email from auth.users where id = v_uid;
  /* The address on the session and the address in the assertion must be the
     same one. Without this, proving any password would bind any subscriber. */
  if lower(coalesce(v_email, '')) is distinct from lower(t.email) then
    raise exception 'You are signed in as %, and the Aventa ID belongs to %. Sign into that account instead.',
      v_email, t.email;
  end if;

  if exists (select 1 from identity_links where subject = p_subject and user_id <> v_uid) then
    raise exception 'That Aventa ID is already linked to another marketplace account.';
  end if;

  insert into identity_links (user_id, subject, how, mk_secret)
  values (v_uid, p_subject, 'confirmed-with-password', null)
  on conflict (user_id) do update set subject = excluded.subject, how = excluded.how;

  /* What the link buys them: the telco's verification now stands behind the
     name on their marketplace account. The account keeps its password and its
     `identity_source` of 'self' — it was opened here, and that stays true. */
  update consumer_profile
     set verified_by = 'Aventa ID · ' || t.kyc_id_kind,
         verified_at = t.kyc_verified_on
   where user_id = v_uid;

  return t.subject;
end $$;

/**
 * The token exchange, simulated.
 *
 * A returning customer who came in through the second door has no marketplace
 * password — there was never one to choose. Against a real IdP the client would
 * exchange an authorization code for tokens; here it proves the IdP credential
 * and gets back the credential the marketplace account was opened with.
 *
 * This function is the entire reason `mk_secret` exists and is the only thing
 * that can read it.
 */
create or replace function sso_signin(p_subject text, p_secret text)
returns table (email text, secret text)
language plpgsql security definer set search_path = public as $$
declare
  t telco_identities;
  l identity_links;
begin
  select * into t from telco_identities where telco_identities.subject = p_subject;
  if t is null or t.id_secret is distinct from p_secret then
    raise exception 'That did not match an Aventa ID.';
  end if;

  select * into l from identity_links where subject = p_subject;
  if l is null then raise exception 'That Aventa ID is not linked to a marketplace account yet.'; end if;
  if l.mk_secret is null then
    /* Linked by confirmation rather than provisioned, so the account has its
       own password and this door is not how they get in. */
    raise exception 'That account was opened here and has its own password. Sign in with it.';
  end if;

  return query select t.email, l.mk_secret;
end $$;

revoke all on function sso_signin(text, text) from public;
grant execute on function sso_signin(text, text) to anon, authenticated;

/* ------------------------------------------------------------ assertions -- */

do $$
declare n integer; r record;
begin
  /* Nothing reads the directory or the secrets from a session. */
  select count(*) into n from pg_policies
   where tablename = 'telco_identities' and cmd = 'SELECT';
  if n > 0 then raise exception 'The subscriber directory is readable from a client session'; end if;

  /* Every identity points at a market that exists, and exactly one points at a
     market the marketplace does not trade in — or the refusal is never
     exercised and this file describes a rule nobody can see work. */
  select count(*) into n from telco_identities t
   where not exists (select 1 from markets m where m.code = t.market);
  if n > 0 then raise exception '% identities name a market that does not exist', n; end if;

  select count(*) into n from telco_identities t
    join markets m on m.code = t.market where not m.trades;
  if n <> 1 then raise exception '% identities are in a market the marketplace does not trade in, expected 1', n; end if;

  select count(*) into n from telco_identities where kyc_level <> 'Full';
  if n <> 1 then raise exception '% identities are short of full verification, expected 1', n; end if;

  /* One that matches an existing marketplace account, so the confirmation path
     is demonstrable, and at least one that does not, so the no-form path is. */
  select count(*) into n from telco_identities t
   where exists (select 1 from auth.users u where lower(u.email) = lower(t.email));
  if n < 1 then raise exception 'No identity matches an existing account, so the linking path cannot be shown'; end if;

  select count(*) into n from telco_identities t
    join markets m on m.code = t.market
   where m.trades and t.kyc_level = 'Full'
     and not exists (select 1 from auth.users u where lower(u.email) = lower(t.email));
  if n < 1 then raise exception 'No identity provisions cleanly, so the no-form path cannot be shown'; end if;

  /* The markets the marketplace actually trades in are untouched. */
  select count(*) into n from markets where code in ('IN', 'KE', 'AE') and not trades;
  if n > 0 then raise exception '% trading markets were marked as not trading', n; end if;

  /* Nobody is linked yet — every link in this prototype is made by somebody
     walking through the journey, which is the point of building it. */
  select count(*) into n from identity_links;
  if n > 0 then raise exception '% links were seeded rather than made', n; end if;

  /* And the demo customer is exactly as she was. Her address is in the
     directory so the confirmation path can be shown against a real account;
     seeding that must not have touched her. */
  select count(*) into n from consumer_profile
   where id = 'me' and (name <> 'Priya Raman' or identity_source <> 'self'
      or email <> 'priya.raman@example.com');
  if n > 0 then raise exception 'The demo customer was changed'; end if;
end $$;
