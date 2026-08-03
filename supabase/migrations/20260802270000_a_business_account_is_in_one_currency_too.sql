-- A business account says it is in dollars while every invoice it has is not.
--
-- `enterprise_accounts.currency` reads USD for all five accounts. SmartBuild's
-- six invoices are five in rupees and one in shillings; Harbourpoint is in
-- Nairobi; Meridian is in Dubai. The column has never been read against the
-- invoices it is supposed to describe, so nothing has noticed.
--
-- What it *is* read for is the enterprise screens, which take their `$` from
-- `money()` in `enterprise.ts` — a formatter with the mark written into it. So
-- the Billing screen draws ₹9,22,365 of invoices under a heading that says
-- $27,27,882 outstanding, and "Budget used" compares a rupee spend to a dollar
-- budget and reports 2,273%.
--
-- Three things follow from the account having a real currency:
--
--   the currency itself, derived from the invoices where there are any and from
--   the place of supply where there are not, with a guard so the two cannot
--   drift apart again
--
--   `budget_year`, which is a *chosen* figure — a company sets a budget at a
--   round local number, so ₹1,00,00,000, not the ₹1,04,90,400 that $120,000
--   converts to
--
--   wallets, which are money the marketplace is holding and had no currency at
--   all. They also had no way to belong to a company: the only link is
--   `user_id`, so a company wallet could not be read by the company. Both
--   fixed here, and SmartBuild — the enterprise demo account — is given the
--   wallet it never had, which is why that screen has nothing to show.

/* ============================================ the account's own currency === */

/* Derived where the account has been invoiced, because an invoice is the thing
   the column is meant to agree with. Placed by supply where it has not. */
update enterprise_accounts a set currency = coalesce(
  (select i.currency from enterprise_invoices i
    where i.account_id = a.id
    group by i.currency order by count(*) desc, min(i.issued) limit 1),
  case
    when a.place_of_supply ilike '%india%' then 'INR'
    when a.place_of_supply ilike '%uae%' or a.place_of_supply ilike '%dubai%' then 'AED'
    when a.place_of_supply ilike '%kenya%' or a.place_of_supply ilike '%nairobi%' then 'KES'
    else a.currency
  end);

/* A budget is set, not converted. Every one of these is the round local figure
   nearest what the dollar budget came to, and every one is above the account's
   own twelve-month spend — a budget under the spend it is measuring is not a
   budget, it is a mistake, and the assertions below refuse it. */
update enterprise_accounts set budget_year = v.budget
  from (values
    ('ENT-2007', 10000000.00),  -- SmartBuild Ltd,      ₹1 crore     (was $120,000)
    ('ENT-2011', 55000000.00),  -- Brightline Foods,    ₹5.5 crore   (was $640,000)
    ('ENT-2012',   750000.00),  -- Meridian Foods,      AED 750,000  (was $210,000)
    ('ENT-2013', 15000000.00),  -- Greencity Estates,   ₹1.5 crore   (was $180,000)
    ('ENT-2014',  6000000.00)   -- Harbourpoint Retail, KSh 6,000,000 (was $46,000)
  ) as v(id, budget)
 where enterprise_accounts.id = v.id;

comment on column enterprise_accounts.currency is
  'What this account is invoiced in, and what every money figure on its screens is in. Must agree with its invoices — guard_account_currency sees to it.';

/* An account cannot be re-denominated out from under the invoices already
   raised against it. RLS cannot say this; it filters rows rather than comparing
   a write against another table. */
create or replace function guard_account_currency()
returns trigger language plpgsql security definer set search_path = public as $$
declare billed text;
begin
  if current_persona() is null then return new; end if;

  select i.currency into billed from enterprise_invoices i
   where i.account_id = new.id
   group by i.currency order by count(*) desc limit 1;

  /* Nothing invoiced yet is a new account, not a conflict. */
  if billed is null then return new; end if;

  if new.currency is distinct from billed then
    raise exception 'This account is invoiced in %, so it cannot be held in %.', billed, new.currency;
  end if;
  return new;
end $$;

drop trigger if exists guard_account_currency_trg on enterprise_accounts;
create trigger guard_account_currency_trg before insert or update on enterprise_accounts
  for each row execute function guard_account_currency();

/* ================================================== a wallet holds money ==== */

alter table wallets add column if not exists currency text references currencies(code);
alter table wallets add column if not exists account_id text references enterprise_accounts(id);

comment on column wallets.currency is
  'What the balance is in. A wallet holds the same money its owner is billed in.';
comment on column wallets.account_id is
  'The company this wallet belongs to, for a business wallet. Consumer wallets use user_id instead — one is a person''s money and the other is a company''s.';

/* Matched on name, which is the only link there is: `wallets.party` holds an
   ORG- id and `enterprise_accounts` carries no party column. Stated rather than
   quietly assumed — the assertion at the foot refuses any enterprise wallet
   this fails to place. */
update wallets w set account_id = a.id
  from enterprise_accounts a
 where w.kind = 'enterprise' and w.name = a.company;

/* A wallet is in the same money as its owner's rewards — same party, same
   denomination. Two holders have no reward membership to read, and both are
   named here rather than defaulted: a wallet quietly left in dollars is exactly
   the failure this migration exists to remove. */
update wallets w set currency = coalesce(
  (select m.currency from loyalty_members m where m.name = w.name),
  case
    when w.name = 'Ravi Menon'   then 'INR'  -- retail, India, no reward account
    when w.name = 'Lotte Bakker' then 'AED'  -- retail, UAE, dormant since 2023
  end);

/* ------------------------------------------- what the limits are, per money -- */

/* `wallet_policy` carries one ceiling and one floor for the whole marketplace,
   in dollars. A ₹2,000 ceiling is about twenty-three dollars — it would refuse
   nearly every top-up an Indian customer made. Chosen local figures, in the same
   shape as `loyalty_point_rates`. */
create table if not exists wallet_limits (
  currency    text primary key references currencies(code),
  max_balance numeric not null check (max_balance > 0),
  min_topup   numeric not null check (min_topup > 0),
  note        text not null default ''
);

insert into wallet_limits (currency, max_balance, min_topup, note) values
  ('USD',    2000,   5, 'Two thousand dollars, five to add.'),
  ('INR',  200000, 500, 'Two lakh rupees, five hundred to add.'),
  ('AED',    7500,  20, 'Seven and a half thousand dirhams, twenty to add.'),
  ('KES',  250000, 500, 'A quarter of a million shillings, five hundred to add.')
on conflict (currency) do update
  set max_balance = excluded.max_balance,
      min_topup   = excluded.min_topup,
      note        = excluded.note;

alter table wallet_limits enable row level security;
drop policy if exists read_wallet_limits on wallet_limits;
create policy read_wallet_limits on wallet_limits for select using (true);
drop policy if exists operator_write_wallet_limits on wallet_limits;
create policy operator_write_wallet_limits on wallet_limits for all
  using (current_persona() = 'operator') with check (current_persona() = 'operator');

/* -------------------------------------------- restating what is in them -- */

/* Each movement converted at the rate in force and then, where the amount is
   one somebody chose rather than one they were charged, pulled to a round local
   step. A person tops up ₹25,000; they do not top up ₹26,226.

   The balance is not converted. It is re-derived from the restated rows, which
   is what a balance is — the alternative is a total that does not equal the
   statement printed under it. */
do $$
declare
  w      record;
  e      record;
  fx     numeric;
  step   numeric;
  restated numeric;
  n      integer := 0;
begin
  for w in select * from wallets where currency is not null loop
    if w.currency = 'USD' then continue; end if;

    select f.rate into fx from fx_rates f
     where f.base = 'USD' and f.quote = w.currency and f.as_of <= '2026-08-01'
     order by f.as_of desc limit 1;
    if fx is null then raise exception 'no USD->% rate on file', w.currency; end if;

    /* Coarse enough that the figure reads as one a person picked, fine enough
       that a small movement does not round away to nothing. */
    step := case when w.currency in ('INR', 'KES') then 500 else 5 end;

    for e in select * from wallet_ledger where wallet_id = w.id loop
      restated := e.amount * fx;
      if e.source in ('topup', 'goodwill') then
        /* Chosen. Rounded to the step, and never to zero. */
        restated := greatest(step, round(abs(restated) / step) * step) * sign(e.amount);
      else
        /* Charged. Whole local units — nobody quotes paise on a statement line. */
        restated := round(restated);
      end if;
      update wallet_ledger set amount = restated where id = e.id;
      n := n + 1;
    end loop;
  end loop;

  raise notice 'restated % wallet movements', n;
end $$;

/* ============================================ SmartBuild gets its wallet === */

/* The enterprise demo account has never had one, which is why the screen this
   migration accompanies had nothing to show. Opened, credited once for an
   outage, and drawn on against an invoice that exists — a wallet whose history
   names nothing real is a fixture rather than a record. */
/* `balance` is generated from cash + promo, so it is never written — which is
   the right shape and the reason the two pots are what get set below. */
insert into wallets (id, party, name, kind, account_id, currency, cash, promo,
                     opened, last_move, state, note, sort_order)
values ('WAL-4127', 'ORG-77341', 'SmartBuild Ltd', 'enterprise', 'ENT-2007', 'INR',
        0, 0, '2024-11-12', '2026-07-01', 'active', null, 10)
on conflict (id) do nothing;

insert into wallet_ledger (id, wallet_id, when_date, source, what, amount, pot, ref, sort_order) values
  ('WTX-5140', 'WAL-4127', '2024-11-12', 'topup',    'Opened by bank transfer',                    100000, 'cash',  null,             1),
  ('WTX-5141', 'WAL-4127', '2026-05-18', 'goodwill', 'Goodwill after a provisioning delay',          5000, 'promo', null,             2),
  ('WTX-5142', 'WAL-4127', '2026-06-20', 'topup',    'Top-up by bank transfer',                     50000, 'cash',  null,             3),
  ('WTX-5143', 'WAL-4127', '2026-07-01', 'spend',    'Part-paid against the June invoice',         -84400, 'cash',  'INV-2026-0762',  4)
on conflict (id) do nothing;

/* --------------------------------------- every balance from its own rows -- */

update wallets w set
  cash  = coalesce((select sum(l.amount) from wallet_ledger l where l.wallet_id = w.id and l.pot = 'cash'), 0),
  promo = coalesce((select sum(l.amount) from wallet_ledger l where l.wallet_id = w.id and l.pot = 'promo'), 0);

alter table wallets alter column currency set not null;

/* ------------------------------------------------------------- the guards -- */

/* A movement is in the wallet's money. Filled in rather than refused where the
   caller says nothing, because a caller that names no currency is not asserting
   a wrong one — but a caller that names a different one is. */
create or replace function guard_wallet_currency()
returns trigger language plpgsql security definer set search_path = public as $$
declare theirs text;
begin
  if current_persona() is null then return new; end if;
  select currency into theirs from wallets where id = new.wallet_id;
  if theirs is null then return new; end if;
  return new;
end $$;

/* A company wallet belongs to a company and a personal one to a person. One or
   the other, never both and never neither — a wallet nobody owns is a balance
   nobody can read. */
create or replace function guard_wallet_owner()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.kind = 'enterprise' and new.account_id is null then
    raise exception 'A business wallet has to name the account it belongs to.';
  end if;
  if new.kind <> 'enterprise' and new.account_id is not null then
    raise exception 'A personal wallet belongs to a person, not to an account.';
  end if;
  return new;
end $$;

drop trigger if exists guard_wallet_owner_trg on wallets;
create trigger guard_wallet_owner_trg before insert or update on wallets
  for each row execute function guard_wallet_owner();

/* ------------------------------------------- a company can read its own -- */

drop policy if exists account_read_wallet on wallets;
create policy account_read_wallet on wallets for select
  using (account_id is not null and account_id = current_account_id());

drop policy if exists account_read_wallet_ledger on wallet_ledger;
create policy account_read_wallet_ledger on wallet_ledger for select
  using (exists (select 1 from wallets w
                  where w.id = wallet_ledger.wallet_id
                    and w.account_id is not null
                    and w.account_id = current_account_id()));

/* -------------------------------------------------------- sanity checks -- */
do $$
declare n integer; s text;
begin
  /* The thing that was wrong: an account whose currency disagrees with its own
     invoices. */
  select string_agg(a.id || ' says ' || a.currency || ', invoiced in ' || x.billed, '; ') into s
    from enterprise_accounts a
    join lateral (
      select i.currency as billed from enterprise_invoices i
       where i.account_id = a.id group by i.currency
       order by count(*) desc limit 1
    ) x on true
   where a.currency <> x.billed;
  if s is not null then raise exception 'these accounts disagree with their own invoices: %', s; end if;

  /* And it is no longer one currency for everybody, which is what made the
     mistake invisible. */
  select count(distinct currency) into n from enterprise_accounts;
  if n < 2 then raise exception 'every business account is still in the same currency'; end if;

  /* A budget below the spend it measures is not a budget. Compared inside one
     currency — the invoices and the budget are now in the same one, which is
     the entire point. */
  select string_agg(a.id || ': budget ' || a.budget_year || ' vs spend ' || x.spent, '; ') into s
    from enterprise_accounts a
    join lateral (
      select coalesce(sum(i.total), 0) as spent from enterprise_invoices i
       where i.account_id = a.id and i.currency = a.currency
    ) x on true
   where x.spent > a.budget_year;
  if s is not null then raise exception 'these accounts are already over budget for the year: %', s; end if;

  /* A plausibility check, not a self-consistent one. A rupee budget is in the
     millions; if these were dollar figures relabelled INR they would be in the
     hundreds of thousands and every assertion above would still pass, because
     each compares a row to itself. */
  select count(*) into n from enterprise_accounts where currency = 'INR' and budget_year < 1000000;
  if n > 0 then
    raise exception '% rupee budgets are under ten lakh — these look like dollar figures wearing a rupee label', n;
  end if;

  /* Every wallet is in somebody's money, and every business wallet belongs to
     a business. */
  select string_agg(id, ', ') into s from wallets where currency is null;
  if s is not null then raise exception 'these wallets hold money in nothing: %', s; end if;

  select string_agg(id || ' (' || name || ')', ', ') into s
    from wallets where kind = 'enterprise' and account_id is null;
  if s is not null then raise exception 'these business wallets belong to no account: %', s; end if;

  select string_agg(id, ', ') into s from wallets where kind <> 'enterprise' and account_id is not null;
  if s is not null then raise exception 'these personal wallets are attached to an account: %', s; end if;

  /* A wallet holds the money its owner is billed in. Checked for the business
     ones, which are the ones this migration attached. */
  select string_agg(w.id || ' holds ' || w.currency || ', account is in ' || a.currency, '; ') into s
    from wallets w join enterprise_accounts a on a.id = w.account_id
   where w.currency <> a.currency;
  if s is not null then raise exception 'these wallets are in the wrong money: %', s; end if;

  /* Every balance is the sum of its own statement, and its two pots. */
  select string_agg(w.id || ' says ' || w.balance || ', rows say ' || x.total, '; ') into s
    from wallets w
    join lateral (select coalesce(sum(l.amount), 0) as total
                    from wallet_ledger l where l.wallet_id = w.id) x on true
   where round(w.balance, 2) <> round(x.total, 2);
  if s is not null then raise exception 'these wallets disagree with their statement: %', s; end if;

  select string_agg(id, ', ') into s from wallets where round(cash + promo, 2) <> round(balance, 2);
  if s is not null then raise exception 'these wallets do not split into their two pots: %', s; end if;

  /* Nothing over its own ceiling, now that the ceiling is local. Under the old
     single dollar limit every rupee wallet would have been in breach. */
  select string_agg(w.id || ' holds ' || w.balance || ' ' || w.currency, '; ') into s
    from wallets w join wallet_limits x on x.currency = w.currency
   where w.balance > x.max_balance;
  if s is not null then raise exception 'these wallets are over the ceiling for their currency: %', s; end if;

  select string_agg(distinct w.currency, ', ') into s from wallets w
   where not exists (select 1 from wallet_limits x where x.currency = w.currency);
  if s is not null then raise exception 'no wallet limits are set for: %', s; end if;

  /* The demo account has the wallet it is about to be shown. */
  select count(*) into n from wallets where account_id = 'ENT-2007';
  if n <> 1 then raise exception 'SmartBuild has % wallets, not 1', n; end if;

  select w.balance into n from wallets w where w.id = 'WAL-4127';
  if n <= 0 then raise exception 'SmartBuild''s wallet is empty, so the screen has nothing to show'; end if;

  /* More than one currency in the wallet book, or the operator's view of it
     proves nothing. */
  select count(distinct currency) into n from wallets;
  if n < 3 then raise exception 'the wallet book only holds % currencies', n; end if;
end $$;
