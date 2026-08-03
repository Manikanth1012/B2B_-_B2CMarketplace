-- The credit limit is still a dollar figure on a rupee account.
--
-- `20260802270000_a_business_account_is_in_one_currency_too.sql` brought the
-- account's own currency and its annual budget into line with its invoices, and
-- missed the third money column on the same account: `enterprise_billing`
-- carries a `credit_limit` and a `currency` of its own, both left saying USD
-- 120,000 against an account invoiced ₹27,27,882 to date.
--
-- Which made My details read "Limit $120,000 · Committed ₹19,69,453 · Headroom
-- -₹18,49,453" — a credit position where the limit and what is drawn against it
-- are not the same kind of number.
--
-- A limit is chosen, like the budget: a finance team agrees ₹1 crore, not the
-- ₹1,04,90,400 that $120,000 converts to. Set to match the budget for this
-- account, which is what a credit line against an annual commitment usually is.

update enterprise_billing b set
  currency = a.currency,
  credit_limit = case a.id
    when 'ENT-2007' then 10000000.00   -- SmartBuild Ltd, ₹1 crore (was $120,000)
    else round(b.credit_limit * coalesce(
      (select f.rate from fx_rates f
        where f.base = 'USD' and f.quote = a.currency and f.as_of <= '2026-08-01'
        order by f.as_of desc limit 1), 1), 2)
  end
  from enterprise_accounts a
 where a.id = b.account_id;

comment on column enterprise_billing.credit_limit is
  'How much the account may owe at once, in the currency it is invoiced in. Compared against what is committed, so the two have to be the same kind of number.';

/* The billing record follows the account it belongs to. Same shape as
   `guard_account_currency`, one table along — and the reason this migration
   exists is that the last one guarded the account and left this beside it. */
create or replace function guard_billing_currency()
returns trigger language plpgsql security definer set search_path = public as $$
declare theirs text;
begin
  if current_persona() is null then return new; end if;
  select currency into theirs from enterprise_accounts where id = new.account_id;
  if theirs is null then return new; end if;
  if new.currency is null then new.currency := theirs; return new; end if;
  if new.currency is distinct from theirs then
    raise exception 'This account is invoiced in %, so its credit line cannot be held in %.',
      theirs, new.currency;
  end if;
  return new;
end $$;

drop trigger if exists guard_billing_currency_trg on enterprise_billing;
create trigger guard_billing_currency_trg before insert or update on enterprise_billing
  for each row execute function guard_billing_currency();

/* -------------------------------------------------------- sanity checks -- */
do $$
declare n integer; s text;
begin
  /* The billing record and its account agree. */
  select string_agg(b.account_id || ': billing in ' || b.currency || ', account in ' || a.currency, '; ') into s
    from enterprise_billing b join enterprise_accounts a on a.id = b.account_id
   where b.currency <> a.currency;
  if s is not null then raise exception 'these credit lines are in the wrong money: %', s; end if;

  /* A limit under what is already committed against it is a limit that was
     never read against the thing it limits — which is exactly how it went
     unnoticed. */
  select string_agg(b.account_id || ': limit ' || b.credit_limit || ' vs owed ' || x.owed, '; ') into s
    from enterprise_billing b
    join enterprise_accounts a on a.id = b.account_id
    join lateral (
      select coalesce(sum(i.total), 0) as owed from enterprise_invoices i
       where i.account_id = b.account_id and i.currency = a.currency
         and i.status in ('open', 'overdue', 'disputed')
    ) x on true
   where x.owed > b.credit_limit;
  if s is not null then raise exception 'these accounts are already past their credit limit: %', s; end if;

  /* And the plausibility check, which is the one that catches a relabelled
     figure rather than a converted one. */
  select count(*) into n from enterprise_billing b
    join enterprise_accounts a on a.id = b.account_id
   where a.currency = 'INR' and b.credit_limit < 1000000;
  if n > 0 then
    raise exception '% rupee credit limits are under ten lakh — these look like dollar figures wearing a rupee label', n;
  end if;
end $$;
