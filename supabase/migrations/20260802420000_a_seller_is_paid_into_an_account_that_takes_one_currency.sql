-- Kestrel Devices banks with HDFC in Bengaluru, has an IFSC code and a PAN, and
-- `partner_bank.currency` says USD.
--
-- So does Sentinel Cyber's Emirates NBD account in Dubai, and Beacon Reseller's
-- Equity Bank account in Nairobi. Six of the fifteen sellers hold accounts in a
-- currency this marketplace actually trades in, and every one of them is marked
-- as taking dollars. The other nine bank in Singapore, Germany, Poland, Sweden,
-- Taiwan, the UK, Vietnam, Brazil and Israel — settling those in dollars is an
-- ordinary cross-border arrangement and stays.
--
-- This is the last half of task #43. Orders, bills, invoices, subscriptions,
-- wallets, refunds and the reward ledger were all given the money they are in;
-- a settlement was left because "the marketplace pays out in its reporting
-- currency" sounded like a decision. It was not a decision, it was a column
-- nobody had looked at.
--
-- A settlement has two legs and they are not the same currency:
--
--   what it is computed in   the reporting currency. Commission is a percentage
--                            of a figure the marketplace books, and it books in
--                            one currency so that a take rate means something.
--   what it is paid in       whatever the seller's account receives.
--
-- The conversion between them is dated and frozen on the row. A statement
-- reprinted next year has to come out the same as the one the seller was paid
-- against — recomputing at today's rate is the single most common way currency
-- handling goes wrong, and `rateOn` exists in `money.ts` precisely to stop it.

/* ============================== rates to convert at === */

/* There were two fixes on file, July and August, and statements going back to
   February. A dated conversion needs a rate at or before the date, so half the
   book could not be converted at all — and `rateOn`'s whole reason for existing
   was untestable against the real data. Monthly fixes back to January. */
insert into fx_rates (id, base, quote, rate, as_of, source, pegged) values
  ('FX-USD-INR-20260101', 'USD', 'INR',  85.1000, '2026-01-01', 'Marketplace treasury', false),
  ('FX-USD-INR-20260201', 'USD', 'INR',  85.5500, '2026-02-01', 'Marketplace treasury', false),
  ('FX-USD-INR-20260301', 'USD', 'INR',  86.0200, '2026-03-01', 'Marketplace treasury', false),
  ('FX-USD-INR-20260401', 'USD', 'INR',  86.3000, '2026-04-01', 'Marketplace treasury', false),
  ('FX-USD-INR-20260501', 'USD', 'INR',  86.6100, '2026-05-01', 'Marketplace treasury', false),
  ('FX-USD-INR-20260601', 'USD', 'INR',  86.7500, '2026-06-01', 'Marketplace treasury', false),
  ('FX-USD-KES-20260101', 'USD', 'KES', 126.1000, '2026-01-01', 'Marketplace treasury', false),
  ('FX-USD-KES-20260201', 'USD', 'KES', 126.5500, '2026-02-01', 'Marketplace treasury', false),
  ('FX-USD-KES-20260301', 'USD', 'KES', 127.1000, '2026-03-01', 'Marketplace treasury', false),
  ('FX-USD-KES-20260401', 'USD', 'KES', 127.4000, '2026-04-01', 'Marketplace treasury', false),
  ('FX-USD-KES-20260501', 'USD', 'KES', 127.8500, '2026-05-01', 'Marketplace treasury', false),
  ('FX-USD-KES-20260601', 'USD', 'KES', 128.1000, '2026-06-01', 'Marketplace treasury', false),
  /* The dirham is pegged, so every fix is the same number. Written out rather
     than special-cased: a peg is a rate that happens not to move, and code that
     treats it as an absence of a rate breaks on the day it is repegged. */
  ('FX-USD-AED-20260101', 'USD', 'AED',   3.6725, '2026-01-01', 'Central bank peg', true),
  ('FX-USD-AED-20260201', 'USD', 'AED',   3.6725, '2026-02-01', 'Central bank peg', true),
  ('FX-USD-AED-20260301', 'USD', 'AED',   3.6725, '2026-03-01', 'Central bank peg', true),
  ('FX-USD-AED-20260401', 'USD', 'AED',   3.6725, '2026-04-01', 'Central bank peg', true),
  ('FX-USD-AED-20260501', 'USD', 'AED',   3.6725, '2026-05-01', 'Central bank peg', true),
  ('FX-USD-AED-20260601', 'USD', 'AED',   3.6725, '2026-06-01', 'Central bank peg', true)
on conflict (id) do nothing;

/* ============================== what the account takes === */

/* Derived from where the account is, which is the fact on the row that decides
   it — a bank in Bengaluru with an IFSC code receives rupees. Residencies the
   marketplace holds no rate for keep dollars, because that is what those
   accounts really are paid in. */
update partner_bank set currency = case residency
  when 'India' then 'INR'
  when 'UAE'   then 'AED'
  when 'Kenya' then 'KES'
  else 'USD'
end;

comment on column partner_bank.currency is
  'What this account receives. Derived from where it is: a bank in Bengaluru takes rupees whatever the marketplace books in. A settlement remits in this and freezes the rate it used.';

/* ============================== the two legs of a statement === */

alter table settlement_statements add column if not exists payout_currency text references currencies(code);
alter table settlement_statements add column if not exists payout_net      numeric;
alter table settlement_statements add column if not exists fx_rate         numeric;
alter table settlement_statements add column if not exists fx_as_of        date;

comment on column settlement_statements.currency is
  'What the statement is computed in — the reporting currency. Commission is a percentage of a figure the marketplace books, and it books in one currency so a take rate means something.';
comment on column settlement_statements.payout_currency is
  'What the seller is actually paid in: their bank account''s currency. Equal to `currency` where the account takes dollars.';
comment on column settlement_statements.payout_net is
  'The net remitted, in `payout_currency`. Frozen — a statement reprinted next year must come out the same as the one the seller was paid against, which recomputing at today''s rate would not.';
comment on column settlement_statements.fx_as_of is
  'The date of the fix used. The rate in force at or before the period end, not the newest one.';

do $$
declare
  s record;
  period_end date;
  fx record;
  n integer := 0;
begin
  for s in select * from settlement_statements loop
    /* "Feb 2026" is the period; the fix that applies is the one in force at its
       end. `to_date` on the first of the month plus a month, less a day. */
    period_end := (to_date('01 ' || s.period, 'DD Mon YYYY') + interval '1 month - 1 day')::date;

    /* Six statements are the marketplace's own first-party line — no partner,
       no bank account, nothing remitted. Those settle in the currency they are
       computed in, because there is nobody else to pay. */
    select coalesce(
      (select b.currency from partner_bank b where b.partner_id = s.partner_id),
      s.currency) as currency into fx;

    if fx.currency = s.currency then
      /* Nothing to convert. The rate is 1 and the date is still recorded, so
         every row can be read the same way rather than half of them being a
         special case a reader has to notice. */
      update settlement_statements set
        payout_currency = s.currency, payout_net = s.net,
        fx_rate = 1, fx_as_of = period_end
       where id = s.id;
    else
      declare r numeric; d date;
      begin
        select f.rate, f.as_of into r, d from fx_rates f
         where f.base = s.currency and f.quote = fx.currency and f.as_of <= period_end
         order by f.as_of desc limit 1;
        if r is null then
          raise exception 'no % to % rate on or before %, so % cannot be settled',
            s.currency, fx.currency, period_end, s.id;
        end if;
        update settlement_statements set
          payout_currency = fx.currency,
          /* Converted from the net, not recomputed from the parts. The net is
             what was agreed; apportioning gross, commission and fees separately
             and rounding each would make them stop adding up to it. */
          payout_net = round(s.net * r, 2),
          fx_rate = r, fx_as_of = d
         where id = s.id;
      end;
    end if;
    n := n + 1;
  end loop;
  raise notice 'settled % statements', n;
end $$;

alter table settlement_statements alter column payout_currency set not null;
alter table settlement_statements alter column payout_net      set not null;
alter table settlement_statements alter column fx_rate         set not null;
alter table settlement_statements alter column fx_as_of        set not null;

/* -------------------------------------------------------- sanity checks -- */
do $$
declare n integer; s text;
begin
  /* Every statement remits into the account the seller actually holds. */
  select string_agg(st.id || ' pays ' || st.payout_currency
                    || ' into an account that takes ' || b.currency, '; ') into s
    from settlement_statements st join partner_bank b on b.partner_id = st.partner_id
   where st.payout_currency <> b.currency;
  if s is not null then raise exception 'these settlements pay into the wrong account: %', s; end if;

  /* The conversion on the row reproduces the figure on the row. This is the one
     that catches a rate edited without the amount, or an amount edited without
     the rate — the two halves of the same drift. */
  select string_agg(st.id || ': ' || st.net || ' × ' || st.fx_rate
                    || ' = ' || round(st.net * st.fx_rate, 2)
                    || ', row says ' || st.payout_net, '; ') into s
    from settlement_statements st
   where abs(st.payout_net - round(st.net * st.fx_rate, 2)) > 0.01;
  if s is not null then raise exception 'these settlements do not reproduce their own conversion: %', s; end if;

  /* The rate used was in force at or before the period it covers — never the
     newest. A reprint converted at today''s fix is a different document from
     the one the seller was paid against. */
  select string_agg(st.id || ' for ' || st.period || ' used a fix dated ' || st.fx_as_of, '; ') into s
    from settlement_statements st
   where st.fx_as_of > (to_date('01 ' || st.period, 'DD Mon YYYY') + interval '1 month - 1 day')::date;
  if s is not null then raise exception 'these settlements used a rate from after the period: %', s; end if;

  /* And that the fix they name is a real one, not a number typed onto the row. */
  select string_agg(st.id || ' claims ' || st.fx_rate || ' for '
                    || st.currency || '→' || st.payout_currency || ' on ' || st.fx_as_of, '; ') into s
    from settlement_statements st
   where st.fx_rate <> 1
     and not exists (select 1 from fx_rates f
                      where f.base = st.currency and f.quote = st.payout_currency
                        and f.as_of = st.fx_as_of and f.rate = st.fx_rate);
  if s is not null then raise exception 'these settlements name a rate that is not on file: %', s; end if;

  /* The statement still adds up in the currency it is computed in. Untouched by
     this migration, and worth asserting for that reason: a change that leaves
     the arithmetic alone should be able to prove it. */
  select string_agg(id || ': ' || net || ' vs ' || (gross - commission - fees - withholding - refunds), '; ') into s
    from settlement_statements
   where abs(net - (gross - commission - fees - withholding - refunds)) > 0.01;
  if s is not null then raise exception 'these statements no longer add up: %', s; end if;

  /* Plausibility. Every check above compares a row to itself or to a rate, and
     all of them would pass on a dollar figure wearing a rupee label. */
  select count(*) into n from settlement_statements
   where payout_currency in ('INR', 'KES') and payout_net < 10000;
  if n > 0 then
    raise exception '% settlements pay under ten thousand in a currency where that is small change — these look unconverted', n;
  end if;

  /* And it had something to convert. If every seller banked in dollars this
     migration would pass having done nothing, which is the failure mode this
     series keeps finding. */
  select count(*) into n from settlement_statements where fx_rate <> 1;
  if n = 0 then raise exception 'no settlement needed converting, so this proved nothing'; end if;
  select count(distinct payout_currency) into n from settlement_statements;
  if n < 3 then raise exception 'only % payout currencies, so this checked almost nothing', n; end if;
end $$;
