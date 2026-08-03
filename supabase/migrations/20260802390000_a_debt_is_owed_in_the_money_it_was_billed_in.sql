-- Collections chases four debts and none of them says what it is owed in.
--
-- `operator_dunning_cases` holds an `amount` and no currency. dc-001 is Priya
-- Raman for 42.00, which the screen writes as $42.00 — she is billed in rupees,
-- and the refund the figure came from is now ₹4,499. dc-004 is a seller, and a
-- seller's balance with the marketplace really is in dollars, so the four rows
-- are not one answer.
--
-- Derived rather than declared: a consumer is chased in the money their bills
-- are in, a business in the money its invoices are in, and a seller in the
-- marketplace's reporting currency, because that is what a settlement is
-- denominated in. Where the named party is not on the marketplace at all — the
-- prototype has two such rows, Acme Logistics and TechDyne Devices, who exist
-- only here — the type decides.
--
-- Amounts follow the same rule as everywhere else in this series: a figure that
-- traces to a row is taken from that row, and a figure that traces to nothing
-- is a chosen round number in the right money rather than a conversion with
-- decimals nobody would write on a dunning notice.

alter table operator_dunning_cases add column if not exists currency text references currencies(code);

comment on column operator_dunning_cases.currency is
  'What the debt is owed in — the customer''s billing currency, or the reporting currency for a seller balance. Never the operator''s own: a collections desk quotes a debtor their own figure.';

update operator_dunning_cases c set currency = coalesce(
  /* A consumer we actually bill. */
  (select b.currency from consumer_bills b
     join consumer_profile p on p.user_id = b.user_id
    where p.name = c.account_name
    order by to_date(b.issued, 'DD Mon YYYY') desc limit 1),
  /* A business we actually invoice. */
  (select a.currency from enterprise_accounts a where a.company = c.account_name),
  /* A seller's balance is against their settlement, which is in the
     marketplace's reporting currency. */
  case when c.account_type = 'partner'
    then (select code from currencies where is_reporting) end,
  /* Somebody named here and nowhere else. The default market is the honest
     guess for a customer; there is nothing better to reach for. */
  case when c.account_type = 'partner'
    then (select code from currencies where is_reporting)
    else (select currency from markets where is_default) end);

alter table operator_dunning_cases alter column currency set not null;

/* --------------------------------------------------- what is actually owed -- */

do $$
declare owed numeric;
begin
  /* Priya's case is the refund on ORD-881044 going the other way — the one
     figure here that traces to a row. Taken from it rather than converted, so
     the collections desk and her account screen cannot disagree. */
  select r.amount into owed from refunds r where r.id = 'RFN-3203';
  if owed is null then raise exception 'RFN-3203 is gone, so dc-001 has nothing to be derived from'; end if;
  update operator_dunning_cases set amount = owed where id = 'dc-001';

  /* The other three name parties the marketplace does not hold, so there is no
     row to read. Chosen figures in the right money: a lakh and a half of rupees
     on a thirty-five-day enterprise debt, two thousand on a consumer one, and
     the seller's left in dollars because that is what it was already in. */
  update operator_dunning_cases set amount = 150000 where id = 'dc-002';
  update operator_dunning_cases set amount = 2000   where id = 'dc-003';
end $$;

/* -------------------------------------------------------- sanity checks -- */
do $$
declare n integer; s text;
begin
  /* A case chasing somebody we bill is in the currency we bill them in. */
  select string_agg(c.id || ' (' || c.account_name || ') in ' || c.currency
                    || ', billed in ' || x.billed, '; ') into s
    from operator_dunning_cases c
    join lateral (
      select coalesce(
        (select b.currency from consumer_bills b
           join consumer_profile p on p.user_id = b.user_id
          where p.name = c.account_name
          order by to_date(b.issued, 'DD Mon YYYY') desc limit 1),
        (select a.currency from enterprise_accounts a where a.company = c.account_name)) as billed
    ) x on true
   where x.billed is not null and c.currency <> x.billed;
  if s is not null then raise exception 'these cases chase the wrong money: %', s; end if;

  /* And the one that traces to a refund agrees with it. A collections figure
     that disagrees with the record it came from is two accounts of one debt. */
  select string_agg(c.id || ': ' || c.amount || ' vs ' || r.amount, '; ') into s
    from operator_dunning_cases c join refunds r on r.id = 'RFN-3203'
   where c.id = 'dc-001' and round(c.amount, 2) <> round(r.amount, 2);
  if s is not null then raise exception 'dc-001 disagrees with the refund it chases: %', s; end if;

  /* Plausibility, because every check above compares a row to another row and
     both would pass on a dollar figure wearing a rupee label. Nobody opens a
     collections case over ninety rupees. */
  select string_agg(id || ': ' || amount || ' ' || currency, '; ') into s
    from operator_dunning_cases where currency in ('INR', 'KES') and amount < 500;
  if s is not null then raise exception 'these debts are too small to chase in their own currency: %', s; end if;

  select count(*) into n from operator_dunning_cases;
  if n = 0 then raise exception 'no dunning cases were found, so this checked nothing'; end if;
end $$;
