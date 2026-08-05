/*
  # The persona the database actually reads

  The Kenyan shopper signed in, her account loaded, her bills loaded, her wallet
  loaded — and Rewards sat on "Loading rewards…" for ever.

  `loyalty_programme`, `loyalty_tiers`, `loyalty_earn_rules` and
  `loyalty_redeem_options` are readable to `current_persona() is not null`.
  Everything that worked for her was gated on `user_id = auth.uid()` instead, so
  the split was exact and looked like nothing at all: some rows arrived and some
  did not, and the screen that needed the missing ones never resolved.

  `current_persona()` is

      select persona from profiles where id = auth.uid()

  — a table, not the JWT. Her `auth.users.raw_app_meta_data` carries
  `"persona": "consumer"`, the token carries it too, and both are beside the
  point: nothing reads them. She had no `profiles` row, so `current_persona()`
  returned NULL and every policy written against it refused her.

  The migration that created her asserted the persona claim was right, and it
  was. It asserted the wrong thing — the claim nobody reads rather than the row
  everybody does. That is the more useful half of this: an assertion can be
  true, specific, and about the wrong object.

  The last check below is written so the same mistake cannot be made again for
  a fourth market: every account that can sign in must have a profile, whoever
  seeds it.
*/

insert into profiles (id, persona, partner_id, account_id, created_at)
values (
  '7c9e1f42-3b8a-4d61-9e05-2a7f6b4c8d13', 'consumer', null, null,
  timestamptz '2025-02-11 07:40:00+03'
)
on conflict (id) do update set persona = excluded.persona;

do $$
declare
  n integer;
  r record;
begin
  select count(*) into n from profiles where id = '7c9e1f42-3b8a-4d61-9e05-2a7f6b4c8d13'
     and persona = 'consumer';
  if n <> 1 then raise exception 'The Kenyan shopper still has no persona the database can read'; end if;

  /* A consumer is not a seller and not a business, so neither id belongs on the
     row. A stray partner_id here would hand a shopper a seller console. */
  select count(*) into n from profiles
   where persona = 'consumer' and (partner_id is not null or account_id is not null);
  if n > 0 then raise exception '% consumer profiles carry a seller or account id', n; end if;

  /* Every signed-in account has a persona. Written against `auth.users` rather
     than against a list of emails, so seeding a shopper for a fourth market
     without a profile row fails here instead of failing silently on one screen
     three weeks later. */
  for r in
    select u.email from auth.users u
     where u.email_confirmed_at is not null
       and not exists (select 1 from profiles p where p.id = u.id)
  loop
    raise exception '% can sign in and has no profile row, so current_persona() will refuse them everything', r.email;
  end loop;

  /* And the two places a persona is written agree. They are kept in step by
     hand — `profiles` is what the policies read and `raw_app_meta_data` is what
     the application reads — so a row where they disagree is a row where one of
     the two consoles is wrong about who is looking at it. */
  for r in
    select u.email, p.persona as in_table, u.raw_app_meta_data ->> 'persona' as in_token
      from auth.users u join profiles p on p.id = u.id
     where p.persona is distinct from u.raw_app_meta_data ->> 'persona'
  loop
    raise exception '% is % in profiles and % in the token', r.email, r.in_table, r.in_token;
  end loop;
end $$;
