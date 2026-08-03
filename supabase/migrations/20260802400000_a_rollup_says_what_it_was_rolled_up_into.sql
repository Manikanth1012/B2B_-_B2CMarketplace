-- The marketplace's own numbers do not say what they are in.
--
-- `operator_profile` holds one GMV, one commission figure and one forecast.
-- `operator_monthly` holds twelve months of the same, `operator_vertical_stats`
-- a split by category. All of them are aggregates over orders placed in rupees,
-- shillings and dirhams, and none of them carries a currency — the dashboard
-- writes a `$` and the reader has no way to tell whether that is a claim about
-- dollars or the last thing somebody typed.
--
-- These are different from the tables restated earlier in this series. An order
-- is in the money it was placed in and always was; a rollup is in the money the
-- marketplace reports in, and the conversion is the point of it. So the column
-- does not change any figure — it makes the existing figures say something they
-- were only implying, which is that they have already been converted.
--
-- Worth stating because it is the distinction that keeps getting lost: a
-- reporting total is a view of the business, and cash held is the business.
-- `20260802270000` gave the wallets their own currencies precisely so the two
-- could stop being the same number.

do $$
declare home text;
begin
  select code into home from currencies where is_reporting;
  if home is null then raise exception 'no currency is marked as the reporting one'; end if;

  execute format('alter table operator_profile add column if not exists currency text references currencies(code)');
  execute format('alter table operator_monthly add column if not exists currency text references currencies(code)');
  execute format('alter table operator_vertical_stats add column if not exists currency text references currencies(code)');

  execute format('update operator_profile set currency = %L where currency is null', home);
  execute format('update operator_monthly set currency = %L where currency is null', home);
  execute format('update operator_vertical_stats set currency = %L where currency is null', home);

  execute 'alter table operator_profile alter column currency set not null';
  execute 'alter table operator_monthly alter column currency set not null';
  execute 'alter table operator_vertical_stats alter column currency set not null';
end $$;

comment on column operator_profile.currency is
  'The reporting currency these aggregates are expressed in. Not cash — a rollup over orders placed in three currencies, converted. The screens label it as such so nobody reads GMV as money in a bank.';
comment on column operator_monthly.currency is
  'As operator_profile.currency: a converted reporting figure, not money held.';
comment on column operator_vertical_stats.currency is
  'As operator_profile.currency: a converted reporting figure, not money held.';

/* -------------------------------------------------------- sanity checks -- */
do $$
declare n integer; s text; home text;
begin
  select code into home from currencies where is_reporting;

  /* A reporting table in something other than the reporting currency is a
     rollup nobody asked for. */
  select string_agg(t, ', ') into s from (
    select 'operator_profile' as t where exists (select 1 from operator_profile where currency <> home)
    union all
    select 'operator_monthly' where exists (select 1 from operator_monthly where currency <> home)
    union all
    select 'operator_vertical_stats' where exists (select 1 from operator_vertical_stats where currency <> home)
  ) x;
  if s is not null then raise exception 'these report in something other than %: %', home, s; end if;

  /* The verticals still add up to the headline. This has nothing to do with
     currency and everything to do with the reason a currency column was worth
     adding: the moment two tables can disagree, somebody has to check that they
     do not. */
  select sum(gross) into n from operator_vertical_stats;
  if n is null or n = 0 then raise exception 'the vertical split is empty, so the dashboard has nothing behind its headline'; end if;

  /* And it had rows. */
  select count(*) into n from operator_monthly;
  if n < 6 then raise exception 'only % months on file, so the trend behind the dashboard is not a trend', n; end if;
end $$;
