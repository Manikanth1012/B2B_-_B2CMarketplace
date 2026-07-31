-- Settlement statements, reconciled and given a history.
--
-- Same fiction the stock ledger carried: the statements were made out to
-- "TechDyne Devices", "CloudSync Labs", "Nimbus IoT Solutions" and "Sentinel
-- Cyber Systems", of which only two are real partners under different names and
-- two are nobody. Nine of twelve rows had no partner_id at all, so a partner
-- record could not reach its own bills.
--
-- Three further disagreements:
--
--   `commission_rate` was 9.3 on every row — the marketplace-wide average take
--   rate — while the seller's own plan says 11%, 18% or 22%. A statement is the
--   document a seller reconciles against; a rate on it that is not their rate is
--   the single most disputable number in the marketplace.
--
--   Only two periods existed, so "previous bills" was two months for three
--   sellers and nothing at all for the other twelve.
--
--   Nothing tied the statements to the twelve-month series on the operator
--   dashboard, so the two screens could quote different gross values for the
--   same month and neither was wrong.
--
-- Rebuilt from what the marketplace already knows: each seller's share is their
-- catalogue's share, the rate is their plan's rate, and each period's statements
-- sum to exactly the month on `operator_monthly`. The settlement screen and the
-- dashboard now cannot disagree.

alter table settlement_statements add column if not exists plan_id text
  references commission_plans(id) on delete set null;

-- Rebuilt rather than patched: nine rows name a seller that does not exist, and
-- there is nothing to carry forward from a bill made out to nobody.
delete from settlement_statements;

insert into settlement_statements (
  id, partner_id, partner_name, plan_id, period, gross, commission, commission_rate,
  fees, withholding, refunds, net, status, order_count, currency,
  submitted_at, approved_by, approved_at, disputed, sort_order
)
with period(name, month_start, gross, ord, status) as (values
  -- The same six months the dashboard's twelve-month series carries, and the
  -- same gross for each. Feb through Apr are settled history; the last three
  -- are the line-level months the 90-day headline is computed from.
  ('Feb 2026', date '2026-02-01', 172479.47, 1, 'paid'),
  ('Mar 2026', date '2026-03-01', 192639.41, 2, 'paid'),
  ('Apr 2026', date '2026-04-01', 203839.37, 3, 'paid'),
  ('May 2026', date '2026-05-01', 223999.31, 4, 'paid'),
  ('Jun 2026', date '2026-06-01', 238221.49, 5, 'approved'),
  ('Jul 2026', date '2026-07-01', 248888.13, 6, 'pending')
),
/* A seller's share of a month is their share of the shelf in each marketplace
   they sell in, and each marketplace's share of the month is the one already
   published on `operator_vertical_stats`.

   Weighting by price list instead was the first attempt and it was nonsense:
   it paid a seller of $4,800 fleet bundles three hundred times a seller of
   $12.99 subscriptions, when the published figures say digital content turns
   795 orders against IoT's 188. A share of the shelf is coarse, but it is
   coarse in a way that does not invert the marketplace. */
vertical_share as (
  select category_id, gross / sum(gross) over () as share
  from operator_vertical_stats
),
/* Live listings per category, counting the operator's own — first party is a
   seller on the same shelf, and leaving it out would hand its share to the
   partners. */
shelf as (
  select
    pr.category_id,
    pr.partner_id,
    count(*)::numeric as listings,
    sum(count(*)) over (partition by pr.category_id)::numeric as category_listings
  from products pr
  left join partners p on p.id = pr.partner_id
  /* A suspended seller's listings came down *with* them, so counting only live
     ones would erase the trading history of the very seller whose history you
     most want to read. Their statements still stop at the suspension date. */
  where pr.status = 'live'
     or (p.status = 'suspended' and pr.status = 'suspended')
  group by pr.category_id, pr.partner_id
),
weight as (
  select
    p.id      as partner_id,
    p.name    as partner_name,
    p.plan_id,
    p.country,
    /* Suspended sellers stop billing when they are suspended, not when the
       record was written. Vertex came down on 18 May 2026. */
    case when p.status = 'suspended' then date '2026-05-31' else date '2099-01-01' end as bills_until,
    sum(vs.share * s.listings / s.category_listings) as w
  from partners p
  join shelf s on s.partner_id = p.id
  join vertical_share vs on vs.category_id = s.category_id
  where p.status in ('live', 'suspended')
  group by p.id, p.name, p.plan_id, p.country, p.status
),
rows as (
  select
    w.partner_id, w.partner_name, w.plan_id, w.country, pe.name as period,
    pe.month_start, pe.ord, pe.status,
    round(pe.gross * w.w, 2) as gross,
    /* The seller's own rate, from the plan they counter-signed at the
       agreements gate. */
    cp.base_rate as rate,
    cp.fees as fee_terms
  from weight w
  cross join period pe
  left join commission_plans cp on cp.id = w.plan_id
  where pe.month_start <= w.bills_until
),
priced as (
  select
    r.*,
    /* Order count from the month's gross against the seller's average line
       value, so the two move together instead of being set apart. */
    greatest(1, round(r.gross / nullif(avgline.v, 0))::int) as order_count,
    round(r.gross * r.rate / 100, 2) as commission
  from rows r
  join lateral (
    select avg(price) v from products where partner_id = r.partner_id
  ) avgline on true
),
costed as (
  select
    p.*,
    /* Plans that state no fees charge none. The rest carry payment processing
       at 1.9% plus 20 cents an order, which is what the plan says. */
    case when p.fee_terms like 'None%' then 0
         else round(p.gross * 0.019 + p.order_count * 0.20, 2) end as fees,
    /* Withheld at source where no treaty certificate is on file. */
    case when p.country in ('Brazil', 'Vietnam') then round(p.commission * 0.10, 2) else 0 end as withholding,
    /* A refund lands in some months and not others, deterministically, so the
       gross-to-net stack has something in it to reconcile. */
    case when (p.ord + length(p.partner_id)) % 4 = 0 then round(p.gross * 0.004, 2) else 0 end as refunds
  from priced p
)
select
  'ss-' || substr(c.partner_id, 5) || '-' || to_char(c.month_start, 'YYYYMM'),
  c.partner_id,
  /* The trading name at the time. A statement is a document, and a document
     reissued under a name the seller did not trade as is a different document —
     so this is snapshotted, unlike the live joins everywhere else. */
  c.partner_name,
  c.plan_id,
  c.period,
  c.gross,
  c.commission,
  c.rate,
  c.fees,
  c.withholding,
  c.refunds,
  round(c.gross - c.commission - c.fees - c.withholding - c.refunds, 2),
  c.status,
  c.order_count,
  'USD',
  (c.month_start + interval '1 month' + interval '4 days'),
  case when c.status <> 'pending' then 'Ruben Oyelaran' end,
  case when c.status <> 'pending' then (c.month_start + interval '1 month' + interval '6 days') end,
  false,
  c.ord * 100 + (substr(c.partner_id, 5)::int - 1000)
from costed c;

-- What the operator sells itself: the month's gross less every seller's share.
-- Computed as the remainder so each period's statements sum to exactly the
-- figure the dashboard's series carries, rather than to something close to it.
insert into settlement_statements (
  id, partner_id, partner_name, plan_id, period, gross, commission, commission_rate,
  fees, withholding, refunds, net, status, order_count, currency,
  submitted_at, approved_by, approved_at, disputed, sort_order
)
with period(name, month_start, gross, ord, status) as (values
  ('Feb 2026', date '2026-02-01', 172479.47, 1, 'paid'),
  ('Mar 2026', date '2026-03-01', 192639.41, 2, 'paid'),
  ('Apr 2026', date '2026-04-01', 203839.37, 3, 'paid'),
  ('May 2026', date '2026-05-01', 223999.31, 4, 'paid'),
  ('Jun 2026', date '2026-06-01', 238221.49, 5, 'approved'),
  ('Jul 2026', date '2026-07-01', 248888.13, 6, 'pending')
)
select
  'ss-firstparty-' || to_char(pe.month_start, 'YYYYMM'),
  null,
  'Aventa Telecom — first party',
  null,
  pe.name,
  pe.gross - coalesce(sold.g, 0),
  /* No commission on your own stock: there is nobody to pay it to. First party
     means no partner, no commission and no settlement — the row exists so the
     period reconciles, not because money moves. */
  0, 0, 0, 0, 0,
  pe.gross - coalesce(sold.g, 0),
  pe.status,
  0,
  'USD',
  (pe.month_start + interval '1 month' + interval '4 days'),
  case when pe.status <> 'pending' then 'Ruben Oyelaran' end,
  case when pe.status <> 'pending' then (pe.month_start + interval '1 month' + interval '6 days') end,
  false,
  pe.ord * 100 + 99
from period pe
left join lateral (
  select sum(gross) g from settlement_statements s where s.period = pe.name and s.partner_id is not null
) sold on true;

-- One disputed statement, because a settlement screen where nothing is ever
-- contested cannot show what happens when something is. The prototype's dispute
-- is the same one: a fulfilment SLA argument on the current run.
update settlement_statements
set disputed = true
where partner_id = 'PTR-1011' and period = 'Jul 2026';

do $$
declare bad text; diff numeric;
begin
  -- Every statement names a partner that exists, under the name they trade as.
  select string_agg(s.id || ' → ' || s.partner_name, ', ') into bad
  from settlement_statements s
  where s.partner_id is not null
    and not exists (select 1 from partners p where p.id = s.partner_id and p.name = s.partner_name);
  if bad is not null then
    raise exception 'statement made out to a seller that does not exist under that name: %', bad;
  end if;

  -- The rate on the bill is the rate on the plan the seller counter-signed.
  select string_agg(s.id, ', ') into bad
  from settlement_statements s join commission_plans cp on cp.id = s.plan_id
  where s.commission_rate <> cp.base_rate;
  if bad is not null then
    raise exception 'statement charges a rate the seller never agreed: %', bad;
  end if;

  -- Gross to net adds up on every row.
  select string_agg(id, ', ') into bad
  from settlement_statements
  where abs(net - (gross - commission - fees - withholding - refunds)) > 0.01;
  if bad is not null then
    raise exception 'gross-to-net does not reconcile on: %', bad;
  end if;

  -- And each period sums to the month the dashboard's series shows, so the two
  -- screens cannot quote different figures for the same month.
  select max(abs(t.billed - m.gross)) into diff
  from (select period, sum(gross) billed from settlement_statements group by period) t
  join operator_monthly m on m.month = t.period;
  if diff is null or diff > 0.01 then
    raise exception 'settlement periods do not sum to the dashboard series (worst gap %)', diff;
  end if;

  -- Nothing is settled at a loss.
  select string_agg(id, ', ') into bad from settlement_statements where net < 0;
  if bad is not null then
    raise exception 'statement settles to a negative payout: %', bad;
  end if;
end $$;
