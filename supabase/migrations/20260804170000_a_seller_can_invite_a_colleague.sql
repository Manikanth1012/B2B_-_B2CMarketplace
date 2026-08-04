/*
  # A seller can invite a colleague

  "Invite a colleague" on the seller's team page raised an informational toast:
  "Invitations are sent by the marketplace desk in this build." That is a
  statement about the build, printed at somebody trying to do their job. The
  marketplace desk does not, in fact, send them — nothing does.

  `partner_users` already has `status`, and the roster screen already renders a
  pill for it, so an invited colleague has somewhere to sit. What was missing was
  the grant: the seller could read their own team and update it, and could not
  add to it.

  1. Insert, with the row's shape pinned
     A seller may add a person to their own company, and the trigger fixes what
     that person arrives as: invited, no MFA, no sessions, never signed in.
     Without that, the insert policy would let a seller create a colleague who
     was already active with a password-changed date they made up — an audit
     record that reads exactly like a real one.

  2. Removing is a status, not a delete
     `partner_users` is what an audit row points at when it says who acted. A
     deleted person turns every one of those into a dangling reference and the
     seller's own history becomes unreadable. Setting `status` to 'removed'
     keeps the record and stops the access, which is what removal actually
     means.

  3. The last admin cannot be removed or demoted
     An account with no admin can publish nothing and act on no onboarding, and
     nobody inside the company can fix it — they would have to ring the
     marketplace to get their own account back. Refused at the database, because
     the screen is not the only way in.
*/

create or replace function guard_partner_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  admins integer;
begin
  if tg_op = 'INSERT' then
    /* A colleague arrives as an invitation and nothing else, whatever the
       insert asked for. */
    if current_persona() is distinct from 'operator' then
      new.status      := 'invited';
      new.mfa         := false;
      new.sessions    := 0;
      new.last_active := null;
      new.pwd_changed := null;
      new.pwd_strength := null;
      new.must_reset  := true;
      new.joined      := current_date;
      new.out_of_office := false;
      new.delegate_id := null;
    end if;
    return new;
  end if;

  /* The last admin. Counted after the change, over everybody still active. */
  if tg_op = 'UPDATE' and (old.role = 'admin' or old.role = 'seller-admin') then
    select count(*) into admins
      from partner_users u
     where u.partner_id = old.partner_id
       and u.id <> old.id
       and u.role in ('admin', 'seller-admin')
       and u.status = 'active';

    if admins = 0 and (new.role not in ('admin', 'seller-admin') or new.status <> 'active') then
      raise exception '% is the last administrator at this company. Make somebody else an administrator first, or nobody here will be able to publish a listing or act on onboarding.',
        old.name;
    end if;
  end if;

  return new;
end $$;

drop trigger if exists guard_partner_user on partner_users;
create trigger guard_partner_user
  before insert or update on partner_users
  for each row execute function guard_partner_user();

create policy partner_invite_own_users on partner_users
  for insert to authenticated
  with check (partner_id = current_partner_id());

do $$
declare
  n integer;
begin
  select count(*) into n from pg_policies
   where tablename = 'partner_users' and policyname = 'partner_invite_own_users';
  if n <> 1 then
    raise exception 'A seller still cannot invite anybody';
  end if;

  select count(*) into n from pg_trigger
   where tgrelid = 'partner_users'::regclass and tgname = 'guard_partner_user';
  if n <> 1 then
    raise exception 'The guard did not take, and the policy alone would let a seller invent an active colleague';
  end if;

  /* Every seller with any people has at least one active administrator, or the
     rule above is protecting a state that already does not hold. */
  select count(*) into n
    from (select partner_id from partner_users group by partner_id) p
   where not exists (
     select 1 from partner_users u
      where u.partner_id = p.partner_id and u.role in ('admin', 'seller-admin') and u.status = 'active'
   );
  if n > 0 then
    raise exception '% sellers have people and no active administrator among them', n;
  end if;
end $$;
