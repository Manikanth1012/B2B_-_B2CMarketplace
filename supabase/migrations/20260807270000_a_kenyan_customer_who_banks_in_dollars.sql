/* Otieno Odhiambo moves to dollars.
 *
 * He lives in Kisumu, is served by the Kenyan entity and pays Kenyan VAT. What
 * changes is the money he is quoted, billed and paid in — which is a real
 * arrangement, and one the marketplace can already express: `market_currencies`
 * has taken USD in Kenya since markets were built, and every product carries a
 * USD price as well as a shilling one.
 *
 * WHAT IS CONVERTED, AND WHAT IS NOT.
 *
 * His wallet is converted, because a wallet holds money and money can be
 * changed from one currency to another. That is a transaction: it happens on a
 * date, at a rate, and it goes in the ledger. Editing the balance and the
 * currency column in place would leave a wallet whose statement no longer adds
 * up to it.
 *
 * His bills and his orders are NOT converted. BILL-450031-2026-04-KES was
 * issued for KES 42,945.00 and paid in shillings, the seller was settled in
 * shillings against it, and the tax on it was Kenyan VAT computed on a shilling
 * figure. Rewriting `total` to 332.39 would make the document disagree with
 * what he paid, with the settlement behind it and with the tax return it fed.
 * Six migrations in this repository exist to freeze currency and rate on
 * exactly those rows.
 *
 * So history keeps its shillings and is PRESENTED in dollars — converted at
 * each document's own date, with the original alongside it. That is what every
 * bank statement in the world does with a foreign transaction, and it is the
 * only way "show me everything in dollars" does not mean "tell me I paid
 * something I did not".
 */

/* ---- What kind of movement a conversion is ----------------------------------- */

/* None of the seven existing kinds fits. It is not a top-up, a spend, a refund
   or a write-off — no money enters or leaves the wallet, and the customer is
   neither better nor worse off by a shilling. It is the same money, restated.
   Reusing `adjustment`, or worse `topup`, would put a line in the statement
   that says something the customer would query. */
insert into public.wallet_sources (id, label, pot, direction, note, sort_order) values
  ('convert-out', 'Closed for currency conversion', 'cash', 'out',
   'The balance in the old currency, closed so the same money can be reopened in the new one. Nothing left the wallet.', 8),
  ('convert-in', 'Reopened in the new currency', 'cash', 'in',
   'The same money, restated at a dated rate. The rate and the day are on the line so the figure can be checked.', 9)
on conflict (id) do nothing;

/* ---- The wallet, converted as a transaction ---------------------------------- */

do $$
declare
  w public.wallets;
  fx numeric;
  on_date date := date '2026-08-01';
  new_cash numeric(12,2);
  new_promo numeric(12,2);
begin
  select * into w from public.wallets
   where user_id = 'e5b3c7a1-9d42-4f68-b015-7c3e9a2b4d81'::uuid;
  if w.id is null then raise exception 'no wallet to convert'; end if;
  if w.currency = 'USD' then
    raise notice 'already converted';
    return;
  end if;

  select rate into fx from public.fx_rates
   where base = 'USD' and quote = w.currency and as_of <= on_date
   order by as_of desc limit 1;
  if fx is null then
    raise exception 'no USD/% rate on or before %', w.currency, on_date;
  end if;

  /* Both pots separately. The cash is his and the promo is ours, and a single
     conversion of the total would round them into each other. */
  new_cash  := round(w.cash / fx, 2);
  new_promo := round(w.promo / fx, 2);

  /* Out in shillings, in in dollars, each as its own line — so the statement
     reads as what happened rather than as a balance that changed by itself. */
  insert into public.wallet_ledger
    (id, wallet_id, when_date, source, what, amount, pot, ref, sort_order)
  values
    ('W-450031-CVT-OUT', w.id, on_date, 'convert-out',
     format('Closed the shilling balance to convert it: KES %s at %s to the dollar (treasury rate, %s)',
            w.cash, fx, on_date),
     -w.cash, 'cash', 'FX-USD-KES-20260801', 800),
    ('W-450031-CVT-OUTP', w.id, on_date, 'convert-out',
     format('Closed the shilling promotional credit: KES %s', w.promo),
     -w.promo, 'promo', 'FX-USD-KES-20260801', 801),
    ('W-450031-CVT-IN', w.id, on_date, 'convert-in',
     format('Opened in US dollars at %s to the dollar', fx),
     new_cash, 'cash', 'FX-USD-KES-20260801', 802),
    ('W-450031-CVT-INP', w.id, on_date, 'convert-in',
     'Promotional credit carried across at the same rate',
     new_promo, 'promo', 'FX-USD-KES-20260801', 803)
  on conflict (id) do nothing;

  /* `balance` is generated from the two pots — it follows them and is not set
     here. That is the same rule this build applies to every stored total. */
  update public.wallets
     set currency = 'USD', cash = new_cash, promo = new_promo,
         last_move = on_date,
         note = coalesce(w.note, '') || ' Converted from shillings to US dollars on '
                || on_date || ' at ' || fx || '.'
   where id = w.id;

  raise notice 'wallet % converted: KES % -> USD %', w.id, w.balance, new_cash + new_promo;
end $$;

/* ---- Quoted, billed and paid in dollars from here on ------------------------- */

/* The market does not change. He is still a Kenyan customer of the Kenyan
   entity paying Kenyan VAT — the currency is what moves, and the market has
   accepted USD since it was configured. */
update public.consumer_profile
   set currency = 'USD',
       wallet = (select balance from public.wallets
                  where user_id = 'e5b3c7a1-9d42-4f68-b015-7c3e9a2b4d81'::uuid)
 where user_id = 'e5b3c7a1-9d42-4f68-b015-7c3e9a2b4d81'::uuid;

/* ---- Presenting what is frozen ----------------------------------------------- */

/* Every historical figure of his, in dollars at its own date, beside what it
   actually was. A view rather than four conversions in the client: the rate a
   document is presented at is a property of the document, and one place
   deciding it is one place to be wrong. */
create or replace view public.my_money_in_account_currency
with (security_invoker = on) as
  with me as (
    select user_id, currency as account_currency
      from public.consumer_profile where user_id = auth.uid()
  ),
  doc as (
    select b.user_id, 'bill'::text as kind, b.id as ref,
           coalesce(b.fx_as_of, b.issued::date) as on_date,
           b.currency, b.total as amount
      from public.consumer_bills b
    union all
    select o.user_id, 'order', o.order_ref,
           coalesce(
             case when o.placed_date ~ '^\d{2} [A-Za-z]{3} \d{4}$'
                  then to_date(o.placed_date, 'DD Mon YYYY') end,
             o.created_at::date),
           o.currency, o.total
      from public.orders o
  )
  select d.user_id, d.kind, d.ref, d.on_date,
         d.currency as charged_in, d.amount as charged,
         me.account_currency,
         /* Null where no rate that old exists. A conversion nobody has a rate
            for is one that should not silently happen. */
         r.rate as rate_used, r.as_of as rate_on,
         case when d.currency = me.account_currency then d.amount
              when r.rate is null then null
              else round(d.amount / r.rate, 2) end as shown
    from doc d
    join me on me.user_id = d.user_id
    left join lateral (
      select f.rate, f.as_of from public.fx_rates f
       where f.base = me.account_currency and f.quote = d.currency
         and f.as_of <= d.on_date
       order by f.as_of desc limit 1
    ) r on d.currency <> me.account_currency;

grant select on public.my_money_in_account_currency to authenticated;

/* ---- Assertions --------------------------------------------------------------- */

do $$
declare
  w public.wallets;
  n int;
  r record;
begin
  select * into w from public.wallets where id = 'WAL-4131';
  if w.currency <> 'USD' then raise exception 'the wallet is still in %', w.currency; end if;
  if w.cash + w.promo <> w.balance then
    raise exception 'the two pots no longer add up to the balance';
  end if;
  /* 6,420 + 900 shillings at 129.20 is 49.69 + 6.97. Checked as a figure
     rather than as "it changed", because a conversion that lost a pot would
     also have changed it. */
  if w.cash <> 49.69 then raise exception 'cash converted to % rather than 49.69', w.cash; end if;
  if w.promo <> 6.97 then raise exception 'promo converted to % rather than 6.97', w.promo; end if;

  /* The statement adds up to the balance it claims. */
  /* Four lines: each pot closed in shillings and opened in dollars. A single
     line would be a balance that changed by itself. */
  select count(*) into n from public.wallet_ledger
   where wallet_id = 'WAL-4131' and id like 'W-450031-CVT-%';
  if n <> 4 then raise exception 'the conversion left % ledger lines, not four', n; end if;

  /* The profile agrees with the wallet. */
  if (select currency from public.consumer_profile where user_id = 'e5b3c7a1-9d42-4f68-b015-7c3e9a2b4d81') <> 'USD' then
    raise exception 'the profile is still in shillings';
  end if;
  if (select wallet from public.consumer_profile where user_id = 'e5b3c7a1-9d42-4f68-b015-7c3e9a2b4d81') <> w.balance then
    raise exception 'the profile and the wallet disagree on the balance';
  end if;

  /* And the history is untouched. This is the assertion that matters: a bill
     says what was charged, and nothing here may have changed one. */
  select count(*) into n from public.consumer_bills
   where user_id = 'e5b3c7a1-9d42-4f68-b015-7c3e9a2b4d81' and currency <> 'KES';
  if n > 0 then raise exception '% of his bills were rewritten', n; end if;
  select count(*) into n from public.orders
   where user_id = 'e5b3c7a1-9d42-4f68-b015-7c3e9a2b4d81' and currency <> 'KES';
  if n > 0 then raise exception '% of his orders were rewritten', n; end if;

  /* USD is a currency his market will actually take, or checkout would refuse
     the first thing he buys. */
  if not exists (select 1 from public.market_currencies
                  where market_code = 'KE' and currency = 'USD') then
    raise exception 'Kenya does not take dollars, so this account cannot buy anything';
  end if;

  /* And every product he can see has a dollar price. */
  select count(*) into n from public.products p
   where p.status = 'live'
     and exists (select 1 from public.product_prices q where q.product_id = p.id and q.currency = 'KES')
     and not exists (select 1 from public.product_prices q where q.product_id = p.id and q.currency = 'USD');
  if n > 0 then raise exception '% products he could buy have no dollar price', n; end if;

  raise notice 'wallet: USD %; bills still charged in: %',
    w.balance,
    (select string_agg(distinct currency, ', ') from public.consumer_bills
      where user_id = 'e5b3c7a1-9d42-4f68-b015-7c3e9a2b4d81');
end $$;
