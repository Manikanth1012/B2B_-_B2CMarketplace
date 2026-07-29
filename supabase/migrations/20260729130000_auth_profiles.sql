-- Task 1 of docs/superpowers/plans/2026-07-29-real-authentication-and-rls.md
--
-- The identity table. A policy cannot read a persona out of thin air, and the JWT
-- should not be trusted to carry one the user can set. `profiles` maps auth.uid()
-- to a persona and — unlike app_metadata — gives partner_id a real foreign key to
-- `partners`.
--
-- Task 2 seeded the four personas into app_metadata because DDL was unavailable at
-- the time. app_metadata stays as the client-side source (src/lib/auth.ts reads it);
-- this table is the source the *policies* read. The seed below derives one from the
-- other so they cannot disagree at the point they are created.

create table if not exists profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  persona    text not null check (persona in ('consumer','operator','partner','enterprise')),
  partner_id text references partners(id),
  created_at timestamptz not null default now()
);

alter table profiles enable row level security;

drop policy if exists "own_profile_read" on profiles;
create policy "own_profile_read" on profiles
  for select to authenticated using (id = auth.uid());

-- No insert/update/delete policy: profiles is written with service_role only. A user
-- who could write their own row could grant themselves the operator persona.

-- Helpers. `security definer` so a policy can resolve the caller's persona without
-- the caller needing to read `profiles` for anyone; `stable` so the planner calls
-- them once per statement rather than once per row.

create or replace function current_persona() returns text
  language sql stable security definer set search_path = public
as $$ select persona from profiles where id = auth.uid() $$;

create or replace function current_partner_id() returns text
  language sql stable security definer set search_path = public
as $$ select partner_id from profiles where id = auth.uid() $$;

revoke all on function current_persona() from public;
revoke all on function current_partner_id() from public;
grant execute on function current_persona() to anon, authenticated;
grant execute on function current_partner_id() to anon, authenticated;

-- Seed the four personas from the app_metadata Task 2 wrote.
insert into profiles (id, persona, partner_id)
select u.id,
       u.raw_app_meta_data ->> 'persona',
       nullif(u.raw_app_meta_data ->> 'partner_id', '')
from auth.users u
where u.raw_app_meta_data ->> 'persona' in ('consumer','operator','partner','enterprise')
on conflict (id) do update
  set persona    = excluded.persona,
      partner_id = excluded.partner_id;
