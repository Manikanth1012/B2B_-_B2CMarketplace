-- A requisition has an amount and no currency.
--
-- `20260802470000` decided that a business may pay in any currency its market
-- takes. Meridian contracts in Dubai and so may pay in dirhams or dollars;
-- Harbourpoint contracts in Nairobi and so may pay in shillings or dollars.
-- That is now true of an order and true of an invoice, and it is not yet
-- expressible in the one place a business purchase actually begins.
--
-- `enterprise_requisitions.amount` is a bare numeric. Every screen reads it in
-- `enterprise_accounts.currency`, which was safe while an account had exactly
-- one currency and is not safe now: a 15,000 requisition on Harbourpoint's
-- account is 15,000 shillings or 15,000 dollars and the row does not say
-- which. The difference is a factor of about 129.
--
-- Two things follow from giving the row a currency.
--
--   the guard    a requisition may be raised in any currency the account's
--                market takes, and nothing else. The same question
--                `guard_order_currency` asks, asked earlier — a requisition
--                that clears approval and is then refused at the order is an
--                approval nobody can act on.
--   the threshold  is a chosen figure. Somebody signed off "anything at or
--                above ₹2,00,000 needs finance", and a limit that moved with
--                the currency of the last purchase would not be a limit. So
--                the threshold stays in the account's primary currency and the
--                requisition is converted to compare against it — the measured
--                quantity is what gets converted, at a dated rate, which is the
--                rule this schema has followed since `20260802420000`.
--
-- The conversion belongs in the application, where the rate date and the FX
-- table already live (`needFor` in `src/lib/enterprise.ts`). What belongs here
-- is the currency itself, the guard, and the assertion that the stored `need`
-- still agrees with the policy it was derived from.

/* ============================ the money a requisition is raised in === */

alter table enterprise_requisitions
  add column if not exists currency text references currencies(code);

comment on column enterprise_requisitions.currency is
  'What this requisition is raised in. Any currency the account''s market takes, which is not necessarily the account''s primary currency — the threshold it is judged against is, so a requisition in a second currency is converted at a dated rate to be compared.';

/* Every requisition on file is SmartBuild's and SmartBuild contracts in India,
   which trades in rupees alone, so the backfill is not a guess: there was one
   currency these could have been in and the account names it. */
update enterprise_requisitions r set currency = a.currency
  from enterprise_accounts a
 where a.id = r.account_id and r.currency is null;

alter table enterprise_requisitions alter column currency set not null;

/* ============================ raised in money the market takes === */

create or replace function guard_requisition_currency()
returns trigger language plpgsql security definer set search_path = public as $$
declare home text;
begin
  /* A null persona is a migration or the service role, not a user. */
  if current_persona() is null then return new; end if;

  select a.market into home from enterprise_accounts a where a.id = new.account_id;
  if home is null then return new; end if;

  if not market_takes(home, new.currency) then
    raise exception 'This account contracts in %, which does not trade in %. It takes %.',
      home, new.currency,
      (select string_agg(mc.currency, ' or ' order by mc.sort_order)
         from market_currencies mc where mc.market_code = home);
  end if;
  return new;
end $$;

drop trigger if exists guard_requisition_currency_trg on enterprise_requisitions;
create trigger guard_requisition_currency_trg
  before insert or update on enterprise_requisitions
  for each row execute function guard_requisition_currency();

/* -------------------------------------------------------- sanity checks -- */
do $$
declare n integer; s text;
begin
  /* Every requisition is raised in money its account's market trades in. */
  select string_agg(r.id || ': ' || r.currency || ' on an account contracting in ' || a.market, '; ') into s
    from enterprise_requisitions r join enterprise_accounts a on a.id = r.account_id
   where not market_takes(a.market, r.currency);
  if s is not null then raise exception 'these requisitions are raised in money their market does not take: %', s; end if;

  /* Its lines are in the same money as its header — they have no currency
     column of their own and are read as the requisition's. */
  select string_agg(r.id || ': lines ' || x.lines || ' vs ' || r.amount, '; ') into s
    from enterprise_requisitions r
    join lateral (select coalesce(sum(line_total), 0) as lines
                    from enterprise_requisition_lines l where l.requisition_id = r.id) x on true
   where x.lines > 0 and abs(x.lines - r.amount) > 0.01;
  if s is not null then raise exception 'these requisitions disagree with their own lines: %', s; end if;

  /* The stored `need` still follows from the policy. Recomputed here rather
     than trusted, because adding a currency beside an amount is exactly the
     change that can leave a figure being compared against a threshold in some
     other money without anything complaining.

     Only checked where the requisition is in the account's primary currency:
     anywhere else the comparison is a conversion at a dated rate, which is the
     application's job and not something to reimplement in SQL and have drift. */
  select string_agg(r.id || ': stored ' || r.need || ', policy says ' || x.want, '; ') into s
    from enterprise_requisitions r
    join enterprise_accounts a on a.id = r.account_id
    join enterprise_approval_policy p on p.account_id = r.account_id
    join lateral (
      select case
        when r.amount >= p.threshold and r.vertical = 'security' and p.security_signoff then 'both'
        when r.amount >= p.threshold then 'finance'
        when r.vertical = 'security' and p.security_signoff then 'it'
        else 'none' end as want
    ) x on true
   where r.currency = a.currency and r.need is distinct from x.want;
  if s is not null then raise exception 'these requisitions need something their policy does not ask for: %', s; end if;

  /* Floors. An empty table satisfies all three checks above having read
     nothing, which is the failure mode this file is otherwise blind to. */
  select count(*) into n from enterprise_requisitions;
  if n = 0 then raise exception 'no requisitions were found, so this checked nothing'; end if;

  select count(*) into n from enterprise_requisitions r
    join enterprise_accounts a on a.id = r.account_id
    join enterprise_approval_policy p on p.account_id = r.account_id
   where r.amount >= p.threshold;
  if n = 0 then raise exception 'no requisition reaches its threshold, so the policy check proved nothing'; end if;

  /* And the case the guard exists for is reachable: an account whose market
     takes a currency that is not the account's primary one. Without this the
     guard is a rule that can only ever say yes. */
  select count(*) into n from enterprise_accounts a
    join market_currencies mc on mc.market_code = a.market
   where mc.currency <> a.currency;
  if n = 0 then
    raise exception 'no account may transact in a second currency, so the requisition guard proves nothing';
  end if;
end $$;
