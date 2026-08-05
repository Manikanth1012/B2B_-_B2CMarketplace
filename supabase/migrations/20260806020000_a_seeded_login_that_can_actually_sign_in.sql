/*
  # A seeded login that can actually sign in

  The Kenyan shopper's `auth.users` row was written by hand, and every assertion
  about it passed: the persona claim is right, the email is confirmed, the
  identity row exists, and `crypt('demo1234', encrypted_password)` verifies. She
  still could not sign in. The password grant returned 500.

  The cause is not in this schema. GoTrue reads `auth.users` into a Go struct
  whose token fields are plain `string`, not `*string` — so a NULL in any of
  them fails to scan and the whole request 500s before the password is ever
  checked. A row created through the admin API gets empty strings in those
  columns; a row created with `insert ... values` gets NULLs, because the
  columns are nullable and nothing said otherwise.

  So the assertions were all true and the user was still broken, which is worth
  recording: "the password verifies" and "the user can sign in" turned out to be
  different claims, and only the first was being checked. The last assertion
  here closes that gap by comparing against the four logins that are known to
  work rather than against a rule written from memory.

  Applied to every user rather than to hers alone: the same hand-written row
  could be seeded again for a fourth market, and a fix that only names one email
  is a fix that has to be remembered.
*/

update auth.users set
  confirmation_token         = coalesce(confirmation_token, ''),
  recovery_token             = coalesce(recovery_token, ''),
  email_change               = coalesce(email_change, ''),
  email_change_token_new     = coalesce(email_change_token_new, ''),
  email_change_token_current = coalesce(email_change_token_current, ''),
  phone_change               = coalesce(phone_change, ''),
  phone_change_token         = coalesce(phone_change_token, ''),
  reauthentication_token     = coalesce(reauthentication_token, '')
 where confirmation_token is null
    or recovery_token is null
    or email_change is null
    or email_change_token_new is null
    or email_change_token_current is null
    or phone_change is null
    or phone_change_token is null
    or reauthentication_token is null;

do $$
declare
  n integer;
  r record;
begin
  select count(*) into n from auth.users
   where confirmation_token is null or recovery_token is null
      or email_change is null or email_change_token_new is null
      or email_change_token_current is null or phone_change is null
      or phone_change_token is null or reauthentication_token is null;
  if n > 0 then
    raise exception '% users still carry a NULL where the auth service expects a string', n;
  end if;

  /* The real check: the new login looks, column for column, like the four that
     are known to sign in. Comparing against them rather than against a list
     written here is what would have caught this the first time. */
  for r in
    select a.attname
      from pg_attribute a
     where a.attrelid = 'auth.users'::regclass
       and a.attnum > 0 and not a.attisdropped
       and a.attname in ('confirmation_token', 'recovery_token', 'email_change',
                         'email_change_token_new', 'email_change_token_current',
                         'phone_change', 'phone_change_token', 'reauthentication_token',
                         'aud', 'role', 'instance_id')
  loop
    execute format(
      'select count(*) from auth.users w, auth.users p
        where w.email = %L and p.email = %L
          and (w.%I is null) <> (p.%I is null)',
      'wanjiru.kamau@example.com', 'priya.raman@example.com', r.attname, r.attname)
      into n;
    if n > 0 then
      raise exception 'The Kenyan login differs from a working one on %', r.attname;
    end if;
  end loop;
end $$;
