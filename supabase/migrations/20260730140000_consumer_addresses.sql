-- A delivery address book.
--
-- There was no address table at all. `orders.shipping_address` is a jsonb blob typed
-- fresh into Checkout every time, so a customer who had ordered six times had typed
-- the same address six times and could not correct it once. The prototype keeps a
-- book: labelled addresses, one default, each with a phone number and a delivery note.

create table if not exists consumer_addresses (
  id         text primary key,
  label      text not null,
  line1      text not null,
  city       text not null,
  pin        text not null,
  phone      text,
  /* "Leave with the security desk if out" — the thing that actually gets a parcel
     delivered, and the field most address forms omit. */
  notes      text,
  is_default boolean not null default false,
  user_id    uuid references auth.users(id) on delete cascade default auth.uid(),
  created_at timestamptz not null default now()
);

create index if not exists consumer_addresses_user_id_idx on consumer_addresses (user_id);

-- One default per customer, enforced here rather than hoped for in the client. Two
-- defaults would make Checkout's pick arbitrary, and the bug would only show up as
-- a parcel going to the wrong place.
create unique index if not exists consumer_addresses_one_default
  on consumer_addresses (user_id) where is_default;

alter table consumer_addresses enable row level security;

drop policy if exists "owner_read_consumer_addresses"    on consumer_addresses;
drop policy if exists "owner_insert_consumer_addresses"  on consumer_addresses;
drop policy if exists "owner_update_consumer_addresses"  on consumer_addresses;
drop policy if exists "owner_delete_consumer_addresses"  on consumer_addresses;
drop policy if exists "operator_read_consumer_addresses" on consumer_addresses;

create policy "owner_read_consumer_addresses" on consumer_addresses
  for select to authenticated using (user_id = auth.uid());
create policy "owner_insert_consumer_addresses" on consumer_addresses
  for insert to authenticated
  with check (user_id = auth.uid() and current_persona() = 'consumer');
create policy "owner_update_consumer_addresses" on consumer_addresses
  for update to authenticated
  using (user_id = auth.uid() and current_persona() = 'consumer')
  with check (user_id = auth.uid() and current_persona() = 'consumer');
create policy "owner_delete_consumer_addresses" on consumer_addresses
  for delete to authenticated
  using (user_id = auth.uid() and current_persona() = 'consumer');
/* The operator reads them to answer "where was this going?" on a delivery ticket. */
create policy "operator_read_consumer_addresses" on consumer_addresses
  for select to authenticated using (current_persona() = 'operator');

-- The prototype's two, owned by the consumer persona.
insert into consumer_addresses (id, label, line1, city, pin, phone, notes, is_default, user_id)
select v.id, v.label, v.line1, v.city, v.pin, v.phone, v.notes, v.is_default,
       (select id from profiles where persona = 'consumer' order by created_at limit 1)
from (values
  ('AD-1', 'Home', '42 Rustom Bagh, HAL Old Airport Road', 'Bengaluru', '560017',
   '+91 98860 41127', 'Leave with the security desk if out', true),
  ('AD-2', 'Work', 'Prestige Tech Park, Marathahalli', 'Bengaluru', '560103',
   '+91 98860 41127', 'Reception, tower B, 09:00 to 18:00', false)
) as v(id, label, line1, city, pin, phone, notes, is_default)
where not exists (select 1 from consumer_addresses a where a.id = v.id);
