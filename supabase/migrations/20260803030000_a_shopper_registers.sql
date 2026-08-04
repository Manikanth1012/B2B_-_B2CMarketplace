-- The retail page says "Start shopping" and there is no way to become a shopper.
--
-- A seller can now apply from the outside. A shopper cannot. The retail hero
-- offers one button, it goes to the catalogue, and the moment somebody tries to
-- put something in a basket they are sent to a sign-in screen with four demo
-- accounts on it and no way to make a fifth.
--
-- Unlike a seller application this needs a real account, because everything a
-- shopper does is owner-scoped: `cart_items`, `orders`, `consumer_profile` and
-- the loyalty tables are all `user_id = auth.uid()`. There is nothing to hang a
-- basket on until an auth user exists.
--
-- Which makes the persona the whole security question. `current_persona()` is
--
--     select persona from profiles where id = auth.uid()
--
-- so a client that can write its own `profiles` row can call itself an
-- operator. Today nothing can: `profiles` has row security on and exactly one
-- policy, `own_profile_read`, which is SELECT. That stays exactly as it is.
--
-- Registration therefore goes through one `security definer` function with the
-- persona WRITTEN INTO ITS BODY. There is no persona parameter, no column list
-- a caller controls, and no path that reaches `profiles` with anything but the
-- literal 'consumer'. The function refuses outright if the caller already has a
-- profile, so it can never be used to change what somebody already is.
--
-- The other thing it fixes is the seeded defaults. Every column on
-- `consumer_profile` defaults to Priya Raman's own value — her name, her
-- number, her Bengaluru address, her Gold tier, her ₹42.60 wallet and her 3,180
-- points. Those were convenient for one demo row and are wrong for everybody
-- else, so this writes every column explicitly rather than letting a single
-- omission hand a new shopper somebody else's balance.

/* ============================ customer numbering === */

/* Past every CUS- already in use. A number reissued to a second person is a
   customer id that identifies two people, which is worse than an ugly gap. */
do $$
declare highest integer;
begin
  select coalesce(max(nullif(regexp_replace(customer_id, '\D', '', 'g'), ''))::integer, 449000)
    into highest from consumer_profile;
  execute format('create sequence if not exists consumer_ref_seq start %s', greatest(highest, 449999) + 1);
end $$;

/* ============================ registering === */

create or replace function register_as_consumer(
  p_name text, p_msisdn text, p_city text, p_market text
) returns text language plpgsql security definer set search_path = public as $$
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

  /* Every column named. The table's defaults are Priya Raman's — her tier, her
     wallet, her points, her phone number — and an omitted column here would
     silently hand a stranger her balance. */
  insert into consumer_profile (
    id, user_id, name, customer_id, msisdn, city, since, tier, wallet, points,
    payment_method, email, mfa_enabled, active_sessions, pwd_changed,
    preferred_language, time_zone, data_units, currency, market
  ) values (
    v_id, v_uid, trim(p_name), v_customer, trim(p_msisdn), trim(p_city),
    'Customer since ' || to_char(now(), 'Mon YYYY'),
    'Bronze', 0, 0,
    'Not set up yet', coalesce(v_email, ''), false, 1, to_char(now(), 'DD Mon YYYY'),
    'English',
    case p_market when 'IN' then 'Asia/Kolkata (IST)'
                  when 'AE' then 'Asia/Dubai (GST)'
                  when 'KE' then 'Africa/Nairobi (EAT)'
                  else 'UTC' end,
    'GB', v_currency, p_market
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
end $$;

revoke all on function register_as_consumer(text, text, text, text) from public, anon, authenticated;
/* `authenticated` only. Registration happens on the far side of `signUp`, so
   the caller always has a session by the time they get here — and anon holding
   it would mean a function that creates a profile for `auth.uid()` being called
   when `auth.uid()` is null. */
grant execute on function register_as_consumer(text, text, text, text) to authenticated;
revoke all on sequence consumer_ref_seq from public, anon, authenticated;

/* Whether an email is already registered, so the form can say so before it
   sends somebody through a sign-up that will fail. Returns a boolean and never
   the row — an endpoint that confirms which addresses exist is a nuisance, and
   one that hands back anything about them is worse. */
create or replace function email_is_registered(p_email text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from auth.users where lower(email) = lower(trim(p_email)));
$$;

revoke all on function email_is_registered(text) from public, anon, authenticated;
grant execute on function email_is_registered(text) to anon, authenticated;

/* -------------------------------------------------------- sanity checks -- */
do $$
declare n integer; s text;
begin
  /* `profiles` still cannot be written by a client. This is the assertion the
     whole file rests on: if an INSERT policy ever appears here, the persona
     stops being ours to decide and `current_persona()` stops meaning anything. */
  select string_agg(policyname || ' (' || cmd || ')', ', ') into s
    from pg_policies where schemaname = 'public' and tablename = 'profiles' and cmd <> 'SELECT';
  if s is not null then
    raise exception 'profiles can be written from a client: %', s;
  end if;

  select count(*) into n from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
   where ns.nspname = 'public' and c.relname = 'profiles' and c.relrowsecurity;
  if n <> 1 then raise exception 'row security is off on profiles'; end if;

  /* And the function that does write it cannot be asked for another persona.
     Read off the source rather than asserted about the signature — a parameter
     added later would not change the argument count check, but it would show
     up here. */
  select prosrc into s from pg_proc where proname = 'register_as_consumer';
  if s !~ 'values \(v_uid, ''consumer''\)' then
    raise exception 'register_as_consumer no longer writes a literal persona';
  end if;
  if s ~* 'persona\s*[:]?=\s*p_' or s ~* 'p_persona' then
    raise exception 'register_as_consumer takes its persona from the caller';
  end if;

  /* Anon cannot register anybody; a signed-in caller can. */
  if has_function_privilege('anon', 'register_as_consumer(text,text,text,text)', 'EXECUTE') then
    raise exception 'an anonymous caller can create a profile';
  end if;
  if not has_function_privilege('authenticated', 'register_as_consumer(text,text,text,text)', 'EXECUTE') then
    raise exception 'a signed-up shopper cannot register';
  end if;

  /* Every customer id is unique, and the sequence will not reissue one. A
     customer number that identifies two people is worse than a gap. */
  select count(*) into n from (
    select customer_id from consumer_profile group by customer_id having count(*) > 1) x;
  if n > 0 then raise exception '% customer ids are shared by more than one profile', n; end if;

  select count(*) into n from consumer_profile
   where nullif(regexp_replace(customer_id, '\D', '', 'g'), '')::integer
         >= (select last_value from consumer_ref_seq);
  if n > 0 then
    raise exception '% existing customers sit at or above the next number the sequence will issue', n;
  end if;

  /* The demo shopper is untouched. Her row is the one every other test and
     screen is built around, and this migration must not have moved it. */
  select count(*) into n from consumer_profile where id = 'me' and name = 'Priya Raman';
  if n <> 1 then raise exception 'the demo customer profile was disturbed'; end if;

  /* A registered shopper is billed in money their market takes — the rule
     `20260802450000` asserts for everybody, checked again here because this
     function is now a second way rows get into that table. */
  select string_agg(p.id || ' billed in ' || p.currency || ' from ' || p.market, '; ') into s
    from consumer_profile p where not market_takes(p.market, p.currency);
  if s is not null then raise exception 'these customers are billed in money their market does not take: %', s; end if;
end $$;
