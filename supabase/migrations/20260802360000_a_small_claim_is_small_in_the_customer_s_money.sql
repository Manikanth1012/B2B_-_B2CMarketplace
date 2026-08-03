-- The threshold below which a refund decides itself is a dollar figure.
--
-- `refund_policy.auto_approve_below` is 25.00 and there is one of it. It means
-- "below this, arguing costs both sides more than the refund" — a judgement
-- about how much a person's time is worth, which is not the same number in
-- Bangalore, Dubai and Nairobi and is certainly not twenty-five of whatever
-- unit happens to be on the row.
--
-- Left alone it would have quietly changed the rules the moment
-- `20260802340000` restated the refunds themselves. Sanya Kapoor's ClearVault
-- refund was $6.49, under twenty-five, and approved itself on the spot; the
-- same refund is now ₹549 and would go to a human queue to wait two days. The
-- money did not change and the customer did not change — only the unit did.
--
-- So the threshold gets the same treatment the wallet limits got in
-- `20260802270000`: a small table keyed by currency, holding chosen round
-- figures rather than twenty-five converted four ways. ₹2,000 is a number
-- somebody would write in a policy. ₹2,185.50 is a number a spreadsheet
-- produced.

create table if not exists refund_thresholds (
  currency           text primary key references currencies(code),
  auto_approve_below numeric not null check (auto_approve_below > 0),
  note               text not null
);

comment on table refund_thresholds is
  'Below this, a refund in that currency approves itself. Chosen per market, not converted — the threshold is a judgement about somebody''s time, and time is not priced by the FX desk.';

alter table refund_thresholds enable row level security;

drop policy if exists refund_thresholds_read on refund_thresholds;
create policy refund_thresholds_read on refund_thresholds
  for select to anon, authenticated using (true);

insert into refund_thresholds (currency, auto_approve_below, note) values
  ('USD', 25,   'Twenty-five dollars. The original figure, kept as the marketplace''s reporting currency.'),
  ('INR', 2000, 'Two thousand rupees — about the price of a case or a month of streaming.'),
  ('AED', 100,  'A hundred dirhams.'),
  ('KES', 3000, 'Three thousand shillings.')
on conflict (currency) do update
  set auto_approve_below = excluded.auto_approve_below,
      note = excluded.note;

comment on column refund_policy.auto_approve_below is
  'The reporting-currency threshold, and the fallback for a currency with no row in refund_thresholds. Read through thresholdFor(), never directly.';

/* -------------------------------------------------------- sanity checks -- */
do $$
declare n integer; s text;
begin
  /* Every currency the marketplace actually raises refunds in has a threshold.
     Ranged over the refunds that exist rather than over a list written here —
     a list would still pass on the day somebody opens a fifth market. */
  select string_agg(distinct r.currency, ', ') into s
    from refunds r
   where not exists (select 1 from refund_thresholds t where t.currency = r.currency);
  if s is not null then raise exception 'refunds are raised in % with no threshold set', s; end if;

  /* And every currency a market trades in, which is the larger set — a market
     can be open before its first refund. */
  select string_agg(distinct mc.currency, ', ') into s
    from market_currencies mc
   where not exists (select 1 from refund_thresholds t where t.currency = mc.currency);
  if s is not null then raise exception 'markets trade in % with no refund threshold', s; end if;

  /* Chosen, not converted: a threshold is a round number. Anything that still
     has minor units on it came out of a multiplication. */
  select string_agg(t.currency || ': ' || t.auto_approve_below, '; ') into s
    from refund_thresholds t where t.auto_approve_below <> round(t.auto_approve_below);
  if s is not null then raise exception 'these thresholds are converted figures, not chosen ones: %', s; end if;

  /* A threshold nothing could ever fall under is a threshold that has been
     turned off by accident. The cheapest thing on the shelf in that currency
     has to be able to clear it. */
  select string_agg(t.currency || ': threshold ' || t.auto_approve_below
                    || ', cheapest listing ' || x.low, '; ') into s
    from refund_thresholds t
    join lateral (select min(price) as low from product_prices p where p.currency = t.currency) x on true
   where x.low is not null and x.low >= t.auto_approve_below;
  if s is not null then raise exception 'nothing is ever under these thresholds, so they do nothing: %', s; end if;

  /* Nor one so high that everything falls under it — that is not a small-claim
     rule, that is refunding on request. */
  select string_agg(t.currency || ': threshold ' || t.auto_approve_below
                    || ', dearest listing ' || x.high, '; ') into s
    from refund_thresholds t
    join lateral (select max(price) as high from product_prices p where p.currency = t.currency) x on true
   where x.high is not null and x.high < t.auto_approve_below;
  if s is not null then raise exception 'everything is under these thresholds, so nobody ever decides anything: %', s; end if;

  select count(*) into n from refund_thresholds;
  if n < 4 then raise exception 'only % thresholds, so this checked almost nothing', n; end if;
end $$;
