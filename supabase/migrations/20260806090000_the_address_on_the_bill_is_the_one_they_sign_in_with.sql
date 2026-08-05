/*
  # The address on the bill is the one they sign in with

  Two email addresses per customer, and the customer only ever knew about one:

      login                            profile / printed on the bill
      priya.raman@example.com          priya.raman@6dtech.co.in
      wanjiru.kamau@example.com        wanjiru.kamau@6dtech.co.ke

  The split was deliberate once — the sign-in address is the shared demo
  credential and the profile carried something that looked like a real corporate
  address. But it is the profile address that gets printed in the BILLED TO
  block, offered back on "My details", and shown as where notifications go. So
  the customer is shown an address they never typed, cannot receive mail at, and
  will not find in their inbox when they look for the bill.

  It also invites the fault it produced: a `.co.in` address on a Kenyan
  customer's record, because the second customer was built from the first and
  the domain came along with everything else. Somebody reading her bill sees an
  Indian address on a Kenyan document, alongside the Indian company that was
  issuing it until the migration before this one.

  So there is one address per customer, and it is the one they sign in with.
  `@example.com` is reserved by RFC 2606 for exactly this — documentation and
  examples — which is more honest about what a demo record is than a domain
  that resolves.

  ## What is not touched

  `auth.users.email` and the hard-coded demo credentials. Nobody's sign-in
  changes; the profile is brought into line with the sign-in, not the other way
  round. `consumer_profile.email` is display and contact only — every screen
  that authenticates reads the session, which is why `PasswordModal` already
  calls `currentEmail()` rather than `profile.email`.
*/

update consumer_profile p
   set email = u.email
  from auth.users u
 where u.id = p.user_id and p.email is distinct from u.email;

do $$
declare n integer; r record;
begin
  /* One address per customer. */
  select count(*) into n
    from consumer_profile p join auth.users u on u.id = p.user_id
   where p.email is distinct from u.email;
  if n > 0 then
    raise exception '% customers are shown an address they do not sign in with', n;
  end if;

  /* And no customer carries another country's domain, which is what made this
     visible. A Kenyan record with a `.co.in` address is a record that was
     copied rather than written. */
  for r in
    select p.name, p.email, p.market from consumer_profile p
     where (p.market = 'KE' and p.email like '%.co.in')
        or (p.market = 'IN' and p.email like '%.co.ke')
        or (p.market = 'AE' and (p.email like '%.co.in' or p.email like '%.co.ke'))
  loop
    raise exception '% is in % and has the email address %, which belongs to another market',
      r.name, r.market, r.email;
  end loop;

  /* Nobody's sign-in moved. This migration is about what is printed. */
  select count(*) into n from auth.users
   where email in ('priya.raman@example.com', 'wanjiru.kamau@example.com');
  if n <> 2 then raise exception 'A demo sign-in address changed'; end if;
end $$;
