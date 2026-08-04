/* A second business account with a login behind it.
 *
 * Five enterprise accounts exist and exactly one — SmartBuild — had a way in.
 * That made a whole class of rule impossible to test the only way it can
 * honestly be tested, which is from a client: every "an account cannot see or
 * touch another account's records" assertion had one account to range over, so
 * it was checking that SmartBuild could reach SmartBuild's rows. A policy that
 * scopes nothing passes that.
 *
 * Meridian Foods rather than one of the other three, for two reasons. It
 * contracts in AE, which trades in both AED and USD, so it is also the account
 * that exercises a business buying in its market's second currency — the case
 * `guard_requisition_currency` was written for and which no signed-in account
 * could reach. And its approval threshold is AED 10,000 against SmartBuild's
 * INR 200,000, so the two accounts disagree about what needs approving, which
 * is the point of the policy being per-account at all.
 *
 * The demo sign-in screen is deliberately left alone. This login is for tests
 * and for exercising the second-currency path by hand; the four cards on that
 * screen are what they were.
 */

/* ------------------------------------------------------- what it spends -- */

/* Meridian had a policy and no cost centres, so its own procurement lead could
   not have raised anything: `validateRequisition` asks for one and there were
   none to pick. Three, for a food distributor in Dubai.

   `spent_quarter` is nought on all three because the account genuinely has no
   approved requisitions, no orders, no invoices and no subscriptions. A
   plausible-looking spend figure would be a number reconciling to nothing —
   the approvals screen reads this column and states what a purchase would move
   it to, and that sentence has to be true. */
insert into enterprise_cost_centres (id, account_id, name, owner, quarter, cap_quarter, spent_quarter, status, sort_order)
values
  ('CC-2012-COLD', 'ENT-2012', 'Cold chain',            'Omar Haddad', '2026-Q3', 220000.00, 0.00, 'active', 1),
  ('CC-2012-IT',   'ENT-2012', 'IT and infrastructure', 'Omar Haddad', '2026-Q3', 150000.00, 0.00, 'active', 2),
  ('CC-2012-DEPOT','ENT-2012', 'Stores and depots',     'Omar Haddad', '2026-Q3',  90000.00, 0.00, 'active', 3)
on conflict (id) do nothing;

/* ------------------------------------------------------------ the login -- */

do $$
declare
  v_uid  uuid;
  v_mail text := 'omar.haddad@meridianfoods.ae';
begin
  select id into v_uid from auth.users where email = v_mail;

  if v_uid is null then
    v_uid := gen_random_uuid();

    /* Shaped on the row the existing enterprise login already has, rather than
       on documentation: `persona` lives in `raw_app_meta_data` because that is
       what reaches the JWT, and the profile below is what `current_persona()`
       and `current_account_id()` actually read. Both have to agree. */
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, created_at, updated_at,
      raw_app_meta_data, raw_user_meta_data,
      /* Empty strings rather than left to default.

         These are `text` columns and GoTrue scans them into non-nullable Go
         strings, so a NULL makes the sign-in handler fail before it ever
         checks the password — and the error it returns is a generic one, which
         the client renders as "Incorrect email or password". A perfectly good
         account that cannot log in and blames the password. The existing demo
         rows carry '' in all four; this row did not, and that was the whole
         difference. */
      confirmation_token, recovery_token, email_change, email_change_token_new
    ) values (
      '00000000-0000-0000-0000-000000000000', v_uid, 'authenticated', 'authenticated',
      v_mail, extensions.crypt('enterprise123', extensions.gen_salt('bf')),
      now(), now(), now(),
      jsonb_build_object('persona', 'enterprise', 'provider', 'email', 'providers', jsonb_build_array('email')),
      jsonb_build_object('email_verified', true),
      '', '', '', ''
    );

    /* Without this GoTrue has no email identity to match a password sign-in
       against, and the account exists but cannot log in. */
    insert into auth.identities (id, user_id, provider, provider_id, identity_data, created_at, updated_at, last_sign_in_at)
    values (
      gen_random_uuid(), v_uid, 'email', v_uid::text,
      jsonb_build_object('sub', v_uid::text, 'email', v_mail, 'email_verified', false, 'phone_verified', false),
      now(), now(), now()
    );
  end if;

  /* `current_account_id()` is `select account_id from profiles where id =
     auth.uid()`, so this row — not `enterprise_users.user_id` — is what scopes
     every enterprise policy to Meridian. */
  insert into profiles (id, persona, account_id)
  values (v_uid, 'enterprise', 'ENT-2012')
  on conflict (id) do update set persona = 'enterprise', account_id = 'ENT-2012';

  /* And `enterprise_users.user_id` is what tells the account which member this
     is — the guard reads it to find out whether they may raise. Both linkages
     are needed and they answer different questions. */
  update enterprise_users set user_id = v_uid where id = 'EU-2012-01';
end $$;

/* --------------------------------------------------------- what is true -- */

do $$
declare
  v_uid uuid;
  n     int;
begin
  select id into v_uid from auth.users where email = 'omar.haddad@meridianfoods.ae';
  if v_uid is null then raise exception 'the second business login was not created'; end if;

  select count(*) into n from auth.identities where user_id = v_uid and provider = 'email';
  if n <> 1 then raise exception 'the login has % email identities and cannot sign in', n; end if;

  /* The four columns that decide whether GoTrue can read the row at all.
     Asserted because the failure they cause is indistinguishable from a wrong
     password, which is the least helpful place for it to surface. */
  select count(*) into n from auth.users
  where id = v_uid
    and confirmation_token is not null and recovery_token is not null
    and email_change is not null and email_change_token_new is not null;
  if n <> 1 then
    raise exception 'the login has null token columns and GoTrue will refuse it as a bad password';
  end if;

  /* The two linkages agree with each other. A profile pointing at one account
     and a member row at another is a buyer who reads one company's catalogue
     and raises against another's budget. */
  select count(*) into n
  from profiles p join enterprise_users eu on eu.user_id = p.id
  where p.id = v_uid and p.persona = 'enterprise'
    and p.account_id = 'ENT-2012' and eu.account_id = 'ENT-2012';
  if n <> 1 then raise exception 'the profile and the member row do not agree about the account'; end if;

  /* It is a second one, not a second login onto the first. Without this the
     whole point is lost and every cross-account test still ranges over one
     account. */
  select count(distinct account_id) into n from profiles where account_id is not null;
  if n < 2 then raise exception 'there is still only one business account with a login'; end if;

  /* Two accounts that disagree about what needs approving, which is what makes
     the per-account policy worth testing. */
  select count(*) into n
  from enterprise_approval_policy a, enterprise_approval_policy b
  where a.account_id = 'ENT-2007' and b.account_id = 'ENT-2012' and a.threshold <> b.threshold;
  if n <> 1 then raise exception 'the two accounts do not differ on threshold, so nothing distinguishes them'; end if;

  /* Meridian can now raise at all. Three cost centres, and none of them
     claiming a spend the account has no records for. */
  select count(*) into n from enterprise_cost_centres where account_id = 'ENT-2012';
  if n <> 3 then raise exception 'Meridian has % cost centres', n; end if;

  select count(*) into n from enterprise_cost_centres c
  where c.account_id = 'ENT-2012' and c.spent_quarter <> 0;
  if n <> 0 then
    raise exception '% Meridian cost centres claim a spend the account has no approved requisitions for', n;
  end if;

  /* And its market really does take two currencies, which is the other reason
     this account was the one chosen. */
  select count(*) into n from market_currencies where market_code = 'AE';
  if n < 2 then raise exception 'AE trades in % currencies, so the second-currency path is still unreachable', n; end if;
end $$;

/* Credentials: omar.haddad@meridianfoods.ae / enterprise123. Same family as
   the other demo logins on purpose, but not added to the sign-in screen —
   `requisitionScope.integration.test.ts` is what uses it. */
