-- Privacy: data subject requests, and account closure.
--
-- The prototype's Privacy panel does two things the app did not:
--
--   * **Asks for a copy of your data.** A scoped request with a reference, a raised
--     date and a 30-day due date — the statutory clock, not a vague "we'll email you".
--   * **Closes the account**, on 30 days' notice, showing what closure will actually
--     cost: which subscriptions get cancelled, which orders are still in flight, what
--     happens to the wallet.
--
-- Note what the prototype's privacy panel deliberately is *not*: a row of consent
-- toggles. It states what is shared with sellers and what never is. Toggles that
-- cannot really change the sharing would be worse than the plain statement, so this
-- migration adds no consent columns and the screen keeps the disclosure.

create table if not exists consumer_data_requests (
  id         text primary key,
  kind       text not null,
  raised     date not null default current_date,
  due        date not null,
  status     text not null default 'open',
  user_id    uuid references auth.users(id) on delete cascade default auth.uid(),
  created_at timestamptz not null default now()
);

comment on table consumer_data_requests is
  'Data subject requests. `due` is the statutory 30 days from `raised`, stored rather than computed so a request keeps the deadline it was given.';

create index if not exists consumer_data_requests_user_id_idx on consumer_data_requests (user_id);

alter table consumer_data_requests enable row level security;

-- Same shape as the other consumer-owned tables: the owner sees and creates their
-- own, the operator sees all, and nobody updates or deletes. A data request is a
-- record that it was asked for — editing it away defeats the point of logging it.
drop policy if exists "owner_read_consumer_data_requests"    on consumer_data_requests;
drop policy if exists "owner_insert_consumer_data_requests"  on consumer_data_requests;
drop policy if exists "operator_read_consumer_data_requests" on consumer_data_requests;

create policy "owner_read_consumer_data_requests" on consumer_data_requests
  for select to authenticated using (user_id = auth.uid());
create policy "owner_insert_consumer_data_requests" on consumer_data_requests
  for insert to authenticated
  with check (user_id = auth.uid() and current_persona() = 'consumer');
create policy "operator_read_consumer_data_requests" on consumer_data_requests
  for select to authenticated using (current_persona() = 'operator');

-- ---------------------------------------------------------------------------
-- Account closure
-- ---------------------------------------------------------------------------
-- Requested and effective, both nullable — the normal state is an open account. The
-- 30-day gap is the whole point: everything keeps working until the effective date
-- and the customer can stop it at any time, so this is a scheduled intention rather
-- than a deletion.

alter table consumer_profile add column if not exists closure_requested_at date;
alter table consumer_profile add column if not exists closure_effective    date;
alter table consumer_profile add column if not exists closure_reason       text;

comment on column consumer_profile.closure_effective is
  'When closure takes effect. Until then the account works normally and the request can be withdrawn.';
