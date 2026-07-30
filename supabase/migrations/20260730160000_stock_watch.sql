-- "Tell me when it's back."
--
-- An out-of-stock product was a dead end: the tile showed a disabled button and the
-- shopper had nowhere to leave their interest. The prototype lets them ask to be
-- told, records how to reach them, and keeps the list on the account — and the
-- operator can see who is waiting for what, which is the demand signal that decides
-- what to reorder.

create table if not exists stock_watch (
  id          text primary key,
  product_id  text not null references products(id) on delete cascade,
  /* How to reach them. Stored per watch rather than read from the profile at send
     time: someone can ask to be told on a different channel from their usual one,
     and the record should say what was actually promised. */
  channel     text not null default 'Email',
  to_address  text not null,
  since       date not null default current_date,
  /* Null while still waiting. Set when the alert went out, which is what turns the
     row from a promise into a closed record. */
  notified_at date,
  user_id     uuid references auth.users(id) on delete cascade default auth.uid(),
  created_at  timestamptz not null default now()
);

create index if not exists stock_watch_user_id_idx    on stock_watch (user_id);
create index if not exists stock_watch_product_id_idx on stock_watch (product_id);

-- One open watch per person per product. Asking twice is the same request, and two
-- rows would send two alerts. Partial, so a closed watch does not block asking again
-- next time it goes out of stock.
create unique index if not exists stock_watch_one_open
  on stock_watch (user_id, product_id) where notified_at is null;

alter table stock_watch enable row level security;

drop policy if exists "owner_read_stock_watch"    on stock_watch;
drop policy if exists "owner_insert_stock_watch"  on stock_watch;
drop policy if exists "owner_delete_stock_watch"  on stock_watch;
drop policy if exists "operator_all_stock_watch"  on stock_watch;

create policy "owner_read_stock_watch" on stock_watch
  for select to authenticated using (user_id = auth.uid());
create policy "owner_insert_stock_watch" on stock_watch
  for insert to authenticated
  with check (user_id = auth.uid() and current_persona() = 'consumer');
/* Cancelling is a delete — the shopper changed their mind and nothing should be
   sent. There is deliberately no owner UPDATE: marking your own watch as notified
   is the marketplace's job, not the shopper's. */
create policy "owner_delete_stock_watch" on stock_watch
  for delete to authenticated
  using (user_id = auth.uid() and current_persona() = 'consumer' and notified_at is null);
/* The operator reads the demand and is the one that closes a watch by sending. */
create policy "operator_all_stock_watch" on stock_watch
  for all to authenticated
  using (current_persona() = 'operator') with check (current_persona() = 'operator');

-- The prototype's own two, against the products that are actually short here:
-- SKU-4008 is out, SKU-5007 is low. One still waiting, one already told, so the
-- panel has both states to show.
insert into stock_watch (id, product_id, channel, to_address, since, notified_at, user_id)
select v.id, v.product_id, v.channel, v.to_address, v.since::date, v.notified_at::date,
       (select id from profiles where persona = 'consumer' order by created_at limit 1)
from (values
  ('WCH-3002', 'SKU-4008', 'Email', 'priya.raman@6dtech.co.in', '2026-07-14', null),
  ('WCH-3003', 'SKU-5007', 'SMS',   '+91 98860 41127',          '2026-07-02', '2026-07-21')
) as v(id, product_id, channel, to_address, since, notified_at)
where not exists (select 1 from stock_watch w where w.id = v.id);
