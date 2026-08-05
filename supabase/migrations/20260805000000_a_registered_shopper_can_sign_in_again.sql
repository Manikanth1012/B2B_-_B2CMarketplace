/*
  # A registered shopper can sign in again

  Registering worked. Coming back did not.

  `register_as_consumer` creates the `profiles` row, and `profiles.persona` is
  what every RLS policy reads through `current_persona()`. But the client decides
  which console to open from a different copy of the same fact —
  `auth.users.raw_app_meta_data->>'persona'`, which arrives in the JWT — and
  nothing ever wrote it. So a shopper who had just registered was signed in (the
  registration hands back `{ persona: 'consumer' }` it constructed itself), and
  the next time they typed their address and password they got:

      This account has no console assigned to it.

  Their account was fine. Their profile was fine. Every policy in the database
  would have let them read their own orders. The one thing missing was the copy
  the browser reads.

  This has been true of every account created since registration was added. It
  could not be found, because the only sign-in screen prefilled demo credentials
  — and the four demo users were seeded with their metadata by hand. Nobody had
  ever typed a real shopper's password into it. Making the real sign-in reachable
  is what exposed it.

  ## The fix, and why it is a trigger

  The honest options were to delete the duplicate — have the client read
  `profiles` after signing in — or to keep the copies in step automatically.

  This does the second. The JWT claim is worth keeping: it is one round trip
  fewer on every page load, and `restoreSession` runs on every load. What is not
  worth keeping is a copy that a *particular* code path has to remember to
  write. `register_as_consumer` forgot; the next sign-up path would forget too.
  A trigger on `profiles` cannot forget, because it is not a step anybody has to
  take.

  `security definer` is what lets it write `auth.users` — a trigger on a public
  table cannot otherwise. It writes exactly three keys and preserves everything
  else in the metadata, so the auth service's own `provider` and `providers`
  survive.
*/

create or replace function sync_persona_to_auth() returns trigger
language plpgsql security definer set search_path = public, auth as $$
begin
  update auth.users u
     set raw_app_meta_data =
           coalesce(u.raw_app_meta_data, '{}'::jsonb)
           || jsonb_strip_nulls(jsonb_build_object(
                'persona',    new.persona,
                'partner_id', new.partner_id,
                'account_id', new.account_id
              ))
   where u.id = new.id;
  return new;
end $$;

drop trigger if exists sync_persona_to_auth on profiles;
create trigger sync_persona_to_auth
  after insert or update of persona, partner_id, account_id on profiles
  for each row execute function sync_persona_to_auth();

/* Everybody already registered. The demo four already agree — they were seeded
   with both — so this only touches accounts created through the public form,
   which is every account that has ever been locked out. */
update auth.users u
   set raw_app_meta_data =
         coalesce(u.raw_app_meta_data, '{}'::jsonb)
         || jsonb_strip_nulls(jsonb_build_object(
              'persona',    p.persona,
              'partner_id', p.partner_id,
              'account_id', p.account_id
            ))
  from profiles p
 where p.id = u.id
   /* Bracketed. Without them `and A or B or C` parses as `(p.id = u.id and A)
      or B or C`, because `or` binds looser than `and` — the join condition
      falls out of two thirds of the predicate and the statement stops meaning
      what it reads as. */
   and (
        (u.raw_app_meta_data->>'persona')    is distinct from p.persona
     or (u.raw_app_meta_data->>'partner_id') is distinct from p.partner_id
     or (u.raw_app_meta_data->>'account_id') is distinct from p.account_id
   );

do $$
declare
  n integer;
begin
  /* The two copies agree, for everybody. This is the assertion that would have
     caught it: it is about the pair, not about either one on its own, and
     either copy read alone looks perfectly healthy. */
  select count(*) into n
    from profiles p join auth.users u on u.id = p.id
   where (u.raw_app_meta_data->>'persona')    is distinct from p.persona
      or (u.raw_app_meta_data->>'partner_id') is distinct from p.partner_id
      or (u.raw_app_meta_data->>'account_id') is distinct from p.account_id;
  if n > 0 then
    raise exception '% accounts have a profile the browser cannot see, so they can register and never sign in again', n;
  end if;

  /* Every profile carries a persona the client recognises. One that does not
     produces the same lockout by a different route. */
  select count(*) into n from profiles
   where persona is null or persona not in ('consumer', 'operator', 'partner', 'enterprise');
  if n > 0 then
    raise exception '% profiles have a persona no console is assigned to', n;
  end if;

  select count(*) into n from pg_trigger
   where tgrelid = 'profiles'::regclass and tgname = 'sync_persona_to_auth';
  if n <> 1 then
    raise exception 'The trigger did not take, and the next sign-up path will forget the copy again';
  end if;
end $$;
