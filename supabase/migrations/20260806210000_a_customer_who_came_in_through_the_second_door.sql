/*
  # A customer who came in through the second door

  Everything about the SSO journey works and nothing on the platform had used
  it: every link in the prototype was made by somebody walking through it, and
  the walk-throughs were deliberately cleaned up afterwards so the picker's
  labels stayed true.

  That leaves the Sign-in & security screen with nothing to show. It now reads
  `identity_source` to decide whether to offer "Change password" — an account
  opened with an Aventa ID never had one to choose — and there is no such
  account to look at.

  This is the same gap the Kenyan seller and buyer had, and it is worth being
  blunt about how often it has come up: four faults in the Kenyan market were
  live for weeks because nobody could open a Kenyan screen, and the seller
  statement and enterprise invoice were correct by construction and had never
  been looked at. A code path with no data behind it is a code path nobody has
  seen.

  So Otieno Odhiambo — the Kenyan subscriber — arrives as a customer opened
  through the second door, exactly as `sso_provision` would have opened him.

  Rohan Mehta stays un-provisioned on purpose. He is the one the picker
  describes as "opens an account with no form", and that journey has to remain
  walkable from a cold start. Between the two, every outcome is demonstrable
  without anybody having to reset anything:

      Rohan     nobody here yet     opens an account, no form
      Otieno    already linked      signs straight in
      Priya     account exists      asks for its password, then links
      Yusuf     basic verification  refused, with the reason
      Aisha     Uganda              refused, with where it does trade

  ## The credential

  `mk_secret` is the simulation seam described in `20260806190000`. Seeding one
  means writing it down, which is the same bargain the four demo passwords
  already make — and it buys nothing an attacker does not already have, since
  the IdP credential that unlocks it (`telco1234`) is in the same repository and
  the whole directory is fictional. It is generated here rather than typed, so
  it is at least not a word.
*/

/* The auth row needs the same treatment `20260806020000` had to repair on the
   Kenyan customer — the eight token
   columns are plain Go strings in GoTrue and a NULL in any of them makes the
   password grant 500 before the password is checked. */
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at, last_sign_in_at,
  confirmation_token, recovery_token, email_change, email_change_token_new,
  email_change_token_current, phone_change, phone_change_token, reauthentication_token
) values (
  '00000000-0000-0000-0000-000000000000',
  'e5b3c7a1-9d42-4f68-b015-7c3e9a2b4d81',
  'authenticated', 'authenticated',
  'otieno.odhiambo@example.com',
  crypt('sso-9f2c41d8-6b07-4e35-a913-5d80c46e2f7a', gen_salt('bf')),
  '2024-02-03 09:00:00+00',
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{"name":"Otieno Odhiambo"}'::jsonb,
  '2024-02-03 09:00:00+00', now(), '2026-08-05 07:20:00+00',
  '', '', '', '', '', '', '', ''
) on conflict (id) do nothing;

insert into auth.identities (
  provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at
) values (
  'e5b3c7a1-9d42-4f68-b015-7c3e9a2b4d81',
  'e5b3c7a1-9d42-4f68-b015-7c3e9a2b4d81',
  '{"sub":"e5b3c7a1-9d42-4f68-b015-7c3e9a2b4d81","email":"otieno.odhiambo@example.com","email_verified":true,"phone_verified":false}'::jsonb,
  'email', '2026-08-05 07:20:00+00', '2024-02-03 09:00:00+00', now()
) on conflict (provider, provider_id) do nothing;

/* Everything below is what `sso_provision` writes, written the same way, so
   what a demo looks at is the shape the function actually produces rather than
   a hand-made approximation of it. `sync_persona_to_auth` puts the persona on
   the token from here. */
insert into profiles (id, persona, created_at)
values ('e5b3c7a1-9d42-4f68-b015-7c3e9a2b4d81', 'consumer', '2024-02-03 09:00:00+00')
on conflict (id) do nothing;

insert into consumer_profile (
  id, user_id, name, customer_id, msisdn, city, since, wallet,
  payment_method, email, mfa_enabled, active_sessions, pwd_changed,
  preferred_language, time_zone, data_units, currency, market,
  identity_source, verified_by, verified_at
)
select
  'cp-e5b3c7a19d424f68b0157c3e9a2b4d81',
  'e5b3c7a1-9d42-4f68-b015-7c3e9a2b4d81',
  t.name, 'CUS-450031', t.msisdn, t.city,
  'Customer since ' || to_char(t.customer_since, 'Mon YYYY'),
  0, 'Not set up yet', t.email, false, 1, '03 Feb 2024',
  'English', 'Africa/Nairobi (EAT)', 'GB',
  (select mc.currency from market_currencies mc
    where mc.market_code = t.market order by mc.is_default desc, mc.sort_order limit 1),
  t.market,
  'telco-sso', 'Aventa ID · ' || t.kyc_id_kind, t.kyc_verified_on
from telco_identities t where t.subject = 'AV-KE-44120876'
on conflict (id) do nothing;

insert into consumer_addresses (id, label, line1, city, pin, phone, notes, is_default, user_id)
select 'AD-450031', 'Home', t.line1, t.city, t.pin, t.msisdn,
       'Brought across from your Aventa account.', true,
       'e5b3c7a1-9d42-4f68-b015-7c3e9a2b4d81'
from telco_identities t where t.subject = 'AV-KE-44120876'
on conflict (id) do nothing;

insert into loyalty_members (id, party, name, kind, tier, balance, joined,
                             qualify_12m, lifetime_earned, lifetime_redeemed,
                             expiring_soon, user_id, currency)
select 'LM-450031', 'CUS-450031', t.name, 'consumer', 'bronze', 0, '03 Feb 2024',
       0, 0, 0, 0, 'e5b3c7a1-9d42-4f68-b015-7c3e9a2b4d81', 'KES'
from telco_identities t where t.subject = 'AV-KE-44120876'
on conflict (id) do nothing;

insert into identity_links (user_id, subject, how, linked_on, mk_secret)
values ('e5b3c7a1-9d42-4f68-b015-7c3e9a2b4d81', 'AV-KE-44120876', 'provisioned',
        '2024-02-03 09:00:00+00', 'sso-9f2c41d8-6b07-4e35-a913-5d80c46e2f7a')
on conflict (user_id) do nothing;

do $$
declare n integer; r record;
begin
  /* The security screen has an account to describe. */
  select count(*) into n from consumer_profile where identity_source = 'telco-sso';
  if n < 1 then raise exception 'No account was opened through the second door, so the security screen still has nothing to show'; end if;

  /* And it is linked, or the screen would say "Not linked" on an account that
     could only have been opened by being linked. */
  select count(*) into n from consumer_profile cp
    join identity_links l on l.user_id = cp.user_id
   where cp.identity_source = 'telco-sso';
  if n < 1 then raise exception 'An account opened through the second door holds no link'; end if;

  /* It carries what the telco verified, which is the whole reason the door is
     worth having and the thing the screen reports. */
  select count(*) into n from consumer_profile
   where identity_source = 'telco-sso' and (verified_by is null or verified_at is null);
  if n > 0 then raise exception '% SSO accounts carry no verification', n; end if;

  /* Kenyan through and through — the fault this market kept producing. */
  for r in
    select cp.name, cp.market, cp.currency, cp.time_zone
      from consumer_profile cp where cp.identity_source = 'telco-sso'
       and (cp.market <> 'KE' or cp.currency <> 'KES' or cp.time_zone not like 'Africa/Nairobi%')
  loop
    raise exception '% is meant to be Kenyan and is %, % , %', r.name, r.market, r.currency, r.time_zone;
  end loop;

  /* The provisioned link holds the credential its sign-in needs; a link made by
     confirming a password does not, and must not. */
  select count(*) into n from identity_links where how = 'provisioned' and mk_secret is null;
  if n > 0 then raise exception '% provisioned links cannot sign their customer back in', n; end if;

  select count(*) into n from identity_links where how = 'confirmed-with-password' and mk_secret is not null;
  if n > 0 then raise exception '% confirmed links hold a credential they have no business holding', n; end if;

  /* Rohan stays out, or the no-form journey cannot be walked from a cold
     start. This is the assertion that stops a later seed quietly closing the
     one path the feature exists for. */
  select count(*) into n from auth.users where lower(email) = 'rohan.mehta@example.com';
  if n > 0 then raise exception 'The subscriber the picker offers as "opens an account with no form" already has one'; end if;

  select count(*) into n from identity_links where subject = 'AV-IN-77105533';
  if n > 0 then raise exception 'The demo customer is pre-linked, so the confirmation journey cannot be shown'; end if;

  /* And Priya is untouched — she is the confirmation case, and seeding around
     her must not have moved her. */
  select count(*) into n from consumer_profile
   where id = 'me' and (identity_source <> 'self' or verified_by is not null);
  if n > 0 then raise exception 'The demo customer was changed'; end if;
end $$;
