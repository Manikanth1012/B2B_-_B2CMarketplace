-- A Kenyan company may pay in shillings or dollars, like a Kenyan person.
--
-- `20260802450000` bound a business to one market and one currency: the market
-- it contracts in, and the single currency on `enterprise_accounts.currency`.
-- The market half is right and stays. The currency half was stricter than the
-- rule the marketplace actually wants — a market that trades in two currencies
-- trades in two currencies for everybody in it, and a company in Nairobi has
-- the same choice a shopper in Nairobi has.
--
-- What `enterprise_accounts.currency` means is narrowed rather than removed. It
-- is the account's primary currency: the one its budget, its credit limit and
-- its cost-centre caps are set in, because those are chosen figures somebody
-- signed off, and a limit that moved with the currency of the last purchase
-- would not be a limit. An individual order or invoice may be in any currency
-- the account's market takes.
--
-- And an invoice was in the wrong one. INV-2026-0779 is SmartBuild's July
-- recurring invoice — the current one — raised in market KE and shillings,
-- billing the same six Indian subscriptions every other invoice on the account
-- bills, converted. It is not a Kenyan subsidiary's invoice; there is no Kenyan
-- subsidiary. It is this account's ordinary July bill in the wrong money, and
-- an integration test had been scoped around it rather than the row being
-- fixed. SmartBuild contracts in Karnataka, India trades in rupees alone, so
-- the invoice is restated here.

/* ============================ the currency rule, loosened === */

create or replace function guard_order_currency()
returns trigger language plpgsql security definer set search_path = public as $$
declare home text;
begin
  if current_persona() is null then return new; end if;

  if new.account_id is not null then
    select a.market into home from enterprise_accounts a where a.id = new.account_id;

    /* Where it contracts is not a choice — the invoice is raised under that
       market's tax by an entity registered there. */
    if home is not null and new.market is distinct from home then
      raise exception 'This account contracts in %, so an order cannot be placed in the % market.', home, new.market;
    end if;

    /* Within it, whatever that market trades in. The same question asked of a
       consumer three lines down, and deliberately the same answer: a business
       in Nairobi has the choice a shopper in Nairobi has. */
    if home is not null and not market_takes(home, new.currency) then
      raise exception 'The % market does not trade in %. It takes %.',
        home, new.currency,
        (select string_agg(mc.currency, ' or ' order by mc.sort_order)
           from market_currencies mc where mc.market_code = home);
    end if;
    return new;
  end if;

  if new.market is null then return new; end if;

  select p.market into home from consumer_profile p where p.user_id = new.user_id;

  if home is not null and new.market is distinct from home then
    raise exception 'This customer is registered in %, so an order cannot be placed in the % market.', home, new.market;
  end if;

  if not market_takes(new.market, new.currency) then
    raise exception 'The % market does not trade in %. It takes %.',
      new.market, new.currency,
      (select string_agg(mc.currency, ' or ' order by mc.sort_order)
         from market_currencies mc where mc.market_code = new.market);
  end if;
  return new;
end $$;

comment on column enterprise_accounts.currency is
  'The account''s primary currency: what its budget, credit limit and cost-centre caps are set in, because those are chosen figures somebody signed off. An individual order or invoice may be in any currency the account''s market takes.';

/* ============================ an invoice is raised where the account is === */

/* There was no guard on `enterprise_invoices` at all, which is how a Kenyan
   invoice came to sit on an Indian account without anything objecting. */
create or replace function guard_invoice_market()
returns trigger language plpgsql security definer set search_path = public as $$
declare home text;
begin
  if current_persona() is null then return new; end if;

  select a.market into home from enterprise_accounts a where a.id = new.account_id;
  if home is null then return new; end if;

  if new.market is distinct from home then
    raise exception 'This account contracts in %, so an invoice cannot be raised in the % market.', home, new.market;
  end if;
  if not market_takes(new.market, new.currency) then
    raise exception 'The % market does not trade in %, so an invoice cannot be raised in it.', new.market, new.currency;
  end if;
  return new;
end $$;

drop trigger if exists guard_invoice_market_trg on enterprise_invoices;
create trigger guard_invoice_market_trg before insert or update on enterprise_invoices
  for each row execute function guard_invoice_market();

/* ============================ the invoice that was in the wrong money === */

/* Derived from what it bills, not converted from what it said. The six
   subscription lines are the account's own monthly commitments, which are
   already in rupees; the two one-off lines are the retail-estate rollout, whose
   rupee figures are on ORD-882091. Converting the shilling totals instead would
   reproduce them to the paisa and agree with nothing else on the account. */
update enterprise_invoice_lines l set amount = s.monthly
  from enterprise_subscriptions s
 where l.invoice_id = 'INV-2026-0779'
   and l.kind = 'subscription'
   and l.id = 'INV-2026-0779-' || s.id;

update enterprise_invoice_lines l set amount = x.line_total
  from (
    select i.product_name, i.price * i.quantity as line_total
      from order_items i join orders o on o.id = i.order_id
     where o.order_ref = 'ORD-882091'
  ) x
 where l.invoice_id = 'INV-2026-0779'
   and l.kind = 'oneoff'
   and l.description like x.product_name || '%';

do $$
declare rec numeric; one numeric; rate numeric;
begin
  select coalesce(sum(amount) filter (where kind = 'subscription'), 0),
         coalesce(sum(amount) filter (where kind = 'oneoff'), 0)
    into rec, one
    from enterprise_invoice_lines where invoice_id = 'INV-2026-0779';

  select m.tax_rate into rate from markets m
    join enterprise_accounts a on a.market = m.code where a.id = 'ENT-2007';

  /* The convention every other invoice on this account follows: tax on top of
     the lines, total the sum of the three. Read off the rows rather than
     assumed — a business invoice is tax-exclusive here and a consumer shelf
     price is tax-inclusive, and the two have been confused before. */
  update enterprise_invoices set
    market = (select market from enterprise_accounts where id = 'ENT-2007'),
    currency = (select currency from enterprise_accounts where id = 'ENT-2007'),
    recurring = rec,
    oneoff = one,
    tax_rate = rate,
    tax = round((rec + one) * rate / 100, 2),
    total = rec + one + round((rec + one) * rate / 100, 2),
    /* Raised in the account's own money, so nothing was converted. `issued` is
       already a date column here — unlike `consumer_bills.issued`, which is
       text in "DD Mon YYYY" and needs parsing. Two tables, two shapes, and
       assuming one of them is how this first failed. */
    fx_rate = 1,
    fx_as_of = issued
   where id = 'INV-2026-0779';
end $$;

/* -------------------------------------------------------- sanity checks -- */
do $$
declare n integer; s text;
begin
  /* Every invoice is raised where its account contracts, in money that market
     takes. The check that did not exist, which is why the Kenyan one survived. */
  select string_agg(i.id || ': ' || i.market || '/' || i.currency
                    || ' on an account contracting in ' || a.market, '; ') into s
    from enterprise_invoices i join enterprise_accounts a on a.id = i.account_id
   where i.market is distinct from a.market or not market_takes(i.market, i.currency);
  if s is not null then raise exception 'these invoices are raised in the wrong market: %', s; end if;

  /* And it still adds up, by the convention its siblings follow. */
  select string_agg(i.id || ': ' || i.total || ' vs ' || (i.recurring + i.oneoff + i.tax), '; ') into s
    from enterprise_invoices i
   where abs(i.total - (i.recurring + i.oneoff + i.tax)) > 0.01;
  if s is not null then raise exception 'these invoices no longer add up: %', s; end if;

  select string_agg(i.id || ': tax ' || i.tax || ' on ' || (i.recurring + i.oneoff)
                    || ' at ' || i.tax_rate || '%', '; ') into s
    from enterprise_invoices i
   where abs(i.tax - round((i.recurring + i.oneoff) * i.tax_rate / 100, 2)) > 0.01;
  if s is not null then raise exception 'these invoices charge tax at a rate they do not name: %', s; end if;

  /* The lines equal the header. */
  select string_agg(i.id || ': lines ' || x.lines || ' vs ' || (i.recurring + i.oneoff), '; ') into s
    from enterprise_invoices i
    join lateral (select coalesce(sum(amount), 0) as lines
                    from enterprise_invoice_lines l where l.invoice_id = i.id) x on true
   where x.lines > 0 and abs(x.lines - (i.recurring + i.oneoff)) > 0.01;
  if s is not null then raise exception 'these invoices disagree with their own lines: %', s; end if;

  /* An invoice is taxed at its market's rate. */
  select string_agg(i.id || ' at ' || i.tax_rate || '% in ' || i.market, '; ') into s
    from enterprise_invoices i join markets m on m.code = i.market
   where i.tax_rate <> m.tax_rate;
  if s is not null then raise exception 'these invoices name a rate their market does not charge: %', s; end if;

  /* The account's own recurring commitment now equals its current recurring
     invoice, which is what the Billing screen claims and what the integration
     test had to be scoped around instead of being able to assert. */
  select string_agg('committed ' || x.committed || ' vs invoiced ' || i.recurring, '') into s
    from enterprise_invoices i
    join lateral (select sum(monthly) as committed from enterprise_subscriptions
                   where account_id = 'ENT-2007') x on true
   where i.id = 'INV-2026-0779' and abs(x.committed - i.recurring) > 0.01;
  if s is not null then raise exception 'the July invoice does not bill what the account holds: %', s; end if;

  /* The guard permits a second currency where the market offers one. Asserted
     as a permission, because a guard that refuses everything satisfies every
     refusal test ever written for it. */
  select count(*) into n from enterprise_accounts a
   where (select count(*) from market_currencies mc where mc.market_code = a.market) > 1;
  if n = 0 then
    raise exception 'no account sits in a market with two currencies, so the loosened rule proves nothing';
  end if;
end $$;
