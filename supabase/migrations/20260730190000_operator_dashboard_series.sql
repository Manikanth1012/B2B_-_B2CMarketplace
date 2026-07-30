-- The numbers the operator dashboard is missing.
--
-- The prototype's overview carries a twelve-month gross-value series and a split by
-- marketplace, and derives both from thousands of synthetic orders. This project
-- holds seven orders, so deriving them here would produce a chart of nothing. These
-- are the aggregates, seeded to reconcile with `operator_profile` — which is what the
-- headline cards already read.
--
-- Two tables rather than one: a month is a point in a time series, a marketplace is a
-- slice of the whole. Putting both in one table would need a null-heavy shape and a
-- discriminator column to tell rows apart.

create table if not exists operator_monthly (
  id         text primary key,
  month      text not null,          -- 'Aug 2025', for the axis
  month_start date not null,         -- the sortable, comparable one
  gross      numeric not null,
  commission numeric not null,
  orders     integer not null,
  /* True where the row is a monthly aggregate carried forward rather than computed
     from orders still held at line level. The prototype states this on the panel —
     "the most recent 3 are computed from the orders held at line level" — because a
     chart that mixes the two without saying so is quietly claiming a precision it
     does not have. */
  aggregated boolean not null default true,
  sort_order integer not null
);

create table if not exists operator_vertical_stats (
  category_id text primary key references categories(id) on delete cascade,
  orders      integer not null,
  gross       numeric not null,
  commission  numeric not null,
  sort_order  integer not null
);

alter table operator_monthly        enable row level security;
alter table operator_vertical_stats enable row level security;

drop policy if exists "operator_all_operator_monthly"        on operator_monthly;
drop policy if exists "operator_all_operator_vertical_stats" on operator_vertical_stats;

create policy "operator_all_operator_monthly" on operator_monthly
  for all to authenticated
  using (current_persona() = 'operator') with check (current_persona() = 'operator');
create policy "operator_all_operator_vertical_stats" on operator_vertical_stats
  for all to authenticated
  using (current_persona() = 'operator') with check (current_persona() = 'operator');

-- Twelve months to Jul 2026, and they reconcile with `operator_profile` on purpose.
-- The prototype states the rule on the panel — "the last three months of the 12-month
-- series sum exactly to the 90-day figure" — and a chart that contradicts the cards
-- above it is worse than no chart. The three line-level months therefore sum to
-- exactly 711,108.93 gross, 66,304.03 commission and 2,600 orders.
insert into operator_monthly (id, month, month_start, gross, commission, orders, aggregated, sort_order)
values
  ('om-01', 'Aug 2025', '2025-08-01', 161279.51, 14998.99, 590, true, 1),
  ('om-02', 'Sep 2025', '2025-09-01', 167999.48, 15623.95, 614, true, 2),
  ('om-03', 'Oct 2025', '2025-10-01', 176959.46, 16457.23, 647, true, 3),
  ('om-04', 'Nov 2025', '2025-11-01', 201599.38, 18748.74, 737, true, 4),
  ('om-05', 'Dec 2025', '2025-12-01', 217279.33, 20206.98, 794, true, 5),
  ('om-06', 'Jan 2026', '2026-01-01', 185919.43, 17290.51, 680, true, 6),
  ('om-07', 'Feb 2026', '2026-02-01', 172479.47, 16040.59, 631, true, 7),
  ('om-08', 'Mar 2026', '2026-03-01', 192639.41, 17915.47, 704, true, 8),
  ('om-09', 'Apr 2026', '2026-04-01', 203839.37, 18957.06, 745, true, 9),
  ('om-10', 'May 2026', '2026-05-01', 223999.31, 20885.77, 819, false, 10),
  ('om-11', 'Jun 2026', '2026-06-01', 238221.49, 22211.85, 871, false, 11),
  ('om-12', 'Jul 2026', '2026-07-01', 248888.13, 23206.41, 910, false, 12)
on conflict (id) do nothing;

-- The split the prototype's insight turns on: consumer and digital content carry the
-- order count, IoT and security carry the value. The two charts invert, and that is
-- the point of showing both — support load follows orders, settlement risk follows
-- gross value.
-- Scaled to the same 90-day window, so the six slices sum to the headline figures
-- rather than to a different marketplace.
insert into operator_vertical_stats (category_id, orders, gross, commission, sort_order)
values
  ('consumer', 1061,  109510.77,  9331.24, 1),
  ('partner',     40,  49180.32,  4576.19, 2),
  ('iot',        188, 196720.55, 18384.72, 3),
  ('security',   115, 156847.32, 14612.11, 4),
  ('device',     401, 167486.24, 15528.66, 5),
  ('content',    795,  31363.73,  3871.11, 6)
on conflict (category_id) do nothing;
