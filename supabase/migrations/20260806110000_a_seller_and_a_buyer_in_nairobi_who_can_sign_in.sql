/*
  # A seller and a buyer in Nairobi who can sign in

  Four faults in the Kenyan market's records were found by building a customer
  there, and every one of them had been live for weeks because nobody had ever
  looked at a Kenyan screen. Two screens still cannot be looked at: the seller's
  settlement statement and the enterprise invoice. Both are now issued by the
  right entity, and neither has ever been opened, because there is no Kenyan
  seller login and no Kenyan enterprise login.

  The parties exist. `PTR-1009` Beacon Reseller Co is live, gold, on a reseller
  plan. `ENT-2014` Harbourpoint Retail Kenya Limited is active with a KES wallet
  and a rewards membership. Neither has an `auth.users` row, so neither can be
  signed into, so neither has been seen.

  ## What was wrong with them already

  Looking at the two records to give them a sign-in turned up the same fault the
  customer had, in two more places:

      partner_users PU-1009-1   Amara Okonkwo, Nairobi   Europe/London (GMT)
      enterprise_users EU-2014-01  Grace Wanjiru, Nairobi  Asia/Kolkata (IST)

  A Nairobi seller keeping London hours and a Nairobi buyer keeping Indian ones.
  The second is the same `Asia/Kolkata` that was on the customer's support line,
  arriving the same way: the row was copied from an Indian one and the field
  came along.

      amara.okonkwo@beaconresellerco.example
      grace.wanjiru@harbourpoint.co.ke

  Two conventions for the same kind of address. The enterprise one matches the
  rule the customer migration settled on — the address on the record is the one
  they sign in with — so it is kept and the seller's is brought into line.

  ## The sign-in

  Created the way `20260806020000` had to repair the customer's: the token
  columns on `auth.users` are plain Go strings in GoTrue, and a hand-written
  insert leaves them NULL, so the password grant fails with a 500 before the
  password is ever checked. They are written as empty strings here rather than
  fixed afterwards.

  A partner session resolves its seller through `profiles.partner_id` and an
  enterprise session its account through `profiles.account_id` — not through the
  token, which carries a copy nothing reads. Both rows are written here; the
  customer's absence of one was why `current_persona()` returned NULL for her.
*/

/* ------------------------------------------------- the seller's sign-in --- */

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at, last_sign_in_at,
  confirmation_token, recovery_token, email_change, email_change_token_new,
  email_change_token_current, phone_change, phone_change_token, reauthentication_token
) values (
  '00000000-0000-0000-0000-000000000000',
  'b1d47a06-9f52-4c38-8e71-3a5c2d90f4e8',
  'authenticated', 'authenticated',
  'amara.okonkwo@example.com',
  crypt('partner123', gen_salt('bf')),
  '2025-05-30 08:00:00+00',
  '{"provider":"email","providers":["email"],"persona":"partner","partner_id":"PTR-1009"}'::jsonb,
  '{"name":"Amara Okonkwo"}'::jsonb,
  '2025-05-30 08:00:00+00', now(), '2026-08-04 06:12:00+00',
  '', '', '', '', '', '', '', ''
) on conflict (id) do nothing;

insert into auth.identities (
  provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at
) values (
  'b1d47a06-9f52-4c38-8e71-3a5c2d90f4e8',
  'b1d47a06-9f52-4c38-8e71-3a5c2d90f4e8',
  '{"sub":"b1d47a06-9f52-4c38-8e71-3a5c2d90f4e8","email":"amara.okonkwo@example.com","email_verified":true,"phone_verified":false}'::jsonb,
  'email', '2026-08-04 06:12:00+00', '2025-05-30 08:00:00+00', now()
) on conflict (provider, provider_id) do nothing;

/* The row `current_persona()` and `current_partner_id()` actually read. The
   token claim above is a copy that nothing consults. */
insert into profiles (id, persona, partner_id, account_id, created_at)
values ('b1d47a06-9f52-4c38-8e71-3a5c2d90f4e8', 'partner', 'PTR-1009', null, '2025-05-30 08:00:00+00')
on conflict (id) do update set persona = excluded.persona, partner_id = excluded.partner_id;

/* Nairobi, not London — and the address on the record is the one they sign in
   with, matching the rule `20260806090000` settled for the customer. */
update partner_users set
  email = 'amara.okonkwo@example.com',
  timezone = 'Africa/Nairobi (EAT)',
  last_active = '04 Aug 2026',
  sessions = 1,
  pwd_changed = '2026-02-18',
  pwd_strength = 'strong'
where id = 'PU-1009-1';

/* --------------------------------------------- the buyer's sign-in -------- */

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at, last_sign_in_at,
  confirmation_token, recovery_token, email_change, email_change_token_new,
  email_change_token_current, phone_change, phone_change_token, reauthentication_token
) values (
  '00000000-0000-0000-0000-000000000000',
  'c4f8b213-6e07-4a95-b3d2-8f19c7e05a64',
  'authenticated', 'authenticated',
  'grace.wanjiru@harbourpoint.co.ke',
  crypt('enterprise123', gen_salt('bf')),
  '2025-08-01 07:30:00+00',
  '{"provider":"email","providers":["email"],"persona":"enterprise","account_id":"ENT-2014"}'::jsonb,
  '{"name":"Grace Wanjiru"}'::jsonb,
  '2025-08-01 07:30:00+00', now(), '2026-07-25 15:48:00+00',
  '', '', '', '', '', '', '', ''
) on conflict (id) do nothing;

insert into auth.identities (
  provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at
) values (
  'c4f8b213-6e07-4a95-b3d2-8f19c7e05a64',
  'c4f8b213-6e07-4a95-b3d2-8f19c7e05a64',
  '{"sub":"c4f8b213-6e07-4a95-b3d2-8f19c7e05a64","email":"grace.wanjiru@harbourpoint.co.ke","email_verified":true,"phone_verified":false}'::jsonb,
  'email', '2026-07-25 15:48:00+00', '2025-08-01 07:30:00+00', now()
) on conflict (provider, provider_id) do nothing;

insert into profiles (id, persona, partner_id, account_id, created_at)
values ('c4f8b213-6e07-4a95-b3d2-8f19c7e05a64', 'enterprise', null, 'ENT-2014', '2025-08-01 07:30:00+00')
on conflict (id) do update set persona = excluded.persona, account_id = excluded.account_id;

/* Nairobi, not Kolkata. Same fault as the customer's support line, arriving the
   same way — an Indian row copied and the field left behind. */
update enterprise_users set
  user_id = 'c4f8b213-6e07-4a95-b3d2-8f19c7e05a64',
  timezone = 'Africa/Nairobi (EAT)',
  phone = '+254 733 902 415'
where id = 'EU-2014-01';

/* And every other Kenyan party's staff, for the same reason. A record is only
   ever wrong in the place somebody happens to look. */
update partner_users u set timezone = 'Africa/Nairobi (EAT)'
  from partners p where p.id = u.partner_id and p.market = 'KE'
   and u.timezone <> 'Africa/Nairobi (EAT)';

update enterprise_users u set timezone = 'Africa/Nairobi (EAT)'
  from enterprise_accounts a where a.id = u.account_id and a.market = 'KE'
   and u.timezone <> 'Africa/Nairobi (EAT)';

/* ------------------------------------------------------------ assertions -- */

do $$
declare n integer; r record;
begin
  /* Both sign-ins exist and can actually be granted a token. A NULL in any of
     the eight token columns is a 500 from GoTrue before the password is
     checked, which is how the customer's first login failed. */
  select count(*) into n from auth.users
   where email in ('amara.okonkwo@example.com', 'grace.wanjiru@harbourpoint.co.ke')
     and (confirmation_token is null or recovery_token is null or email_change is null
       or email_change_token_new is null or email_change_token_current is null
       or phone_change is null or phone_change_token is null or reauthentication_token is null);
  if n > 0 then raise exception '% of the new sign-ins would 500 on a NULL token column', n; end if;

  select count(*) into n from auth.users u
   where u.email in ('amara.okonkwo@example.com', 'grace.wanjiru@harbourpoint.co.ke')
     and not exists (select 1 from profiles p where p.id = u.id);
  if n > 0 then raise exception '% new sign-ins have no profile row, so current_persona() would return null', n; end if;

  /* And each lands on the party it is meant to. */
  select count(*) into n from profiles
   where id = 'b1d47a06-9f52-4c38-8e71-3a5c2d90f4e8' and (persona <> 'partner' or partner_id <> 'PTR-1009');
  if n > 0 then raise exception 'The Kenyan seller sign-in does not resolve to Beacon Reseller Co'; end if;

  select count(*) into n from profiles
   where id = 'c4f8b213-6e07-4a95-b3d2-8f19c7e05a64' and (persona <> 'enterprise' or account_id <> 'ENT-2014');
  if n > 0 then raise exception 'The Kenyan buyer sign-in does not resolve to Harbourpoint Retail'; end if;

  /* Nobody in a Kenyan market keeps another country's hours. */
  for r in
    select u.name, u.timezone, 'seller' as what from partner_users u
      join partners p on p.id = u.partner_id
     where p.market = 'KE' and u.timezone not like 'Africa/Nairobi%'
    union all
    select u.name, u.timezone, 'buyer' from enterprise_users u
      join enterprise_accounts a on a.id = u.account_id
     where a.market = 'KE' and u.timezone not like 'Africa/Nairobi%'
  loop
    raise exception 'The Kenyan % % keeps % hours', r.what, r.name, r.timezone;
  end loop;

  /* The address on a record is the one they sign in with, wherever there is a
     sign-in to compare it to. */
  select count(*) into n from partner_users u
    join auth.users a on a.raw_app_meta_data->>'partner_id' = u.partner_id
   where a.raw_app_meta_data->>'persona' = 'partner' and u.sort_order = 1 and u.email <> a.email;
  if n > 0 then raise exception '% sellers are shown an address they do not sign in with', n; end if;

  select count(*) into n from enterprise_users u
    join auth.users a on a.id = u.user_id
   where u.email <> a.email;
  if n > 0 then raise exception '% buyers are shown an address they do not sign in with', n; end if;

  /* The four personas each have a Kenyan sign-in now, or will once the seller
     and buyer are seeded. Operator is global and has no market. */
  select count(*) into n from profiles where persona = 'partner' and partner_id in (
    select id from partners where market = 'KE');
  if n < 1 then raise exception 'No Kenyan seller can sign in'; end if;

  select count(*) into n from profiles where persona = 'enterprise' and account_id in (
    select id from enterprise_accounts where market = 'KE');
  if n < 1 then raise exception 'No Kenyan buyer can sign in'; end if;
end $$;
