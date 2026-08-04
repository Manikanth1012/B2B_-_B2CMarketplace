/* How often a subscription bills, and which markets a listing is sold in.
 *
 * Two things the new-listing wizard could not record because there was nowhere
 * to put them.
 *
 * `model` is 'oneoff' or 'monthly', and 'monthly' has been carrying two
 * meanings: that a thing recurs, and that it recurs every month. A seller
 * choosing Subscription in the wizard was never asked how often — so a yearly
 * licence and a monthly SIM plan were the same row, and every screen that reads
 * `model` printed "/mo" against both. `billing_period` separates the two
 * questions: `model` says whether it recurs, this says how often.
 *
 * And a listing said nothing at all about where it could be bought.
 * `partner_markets` records which markets a seller is approved to trade in —
 * Nimbus holds IN, KE and AE — but the product carried no market of its own, so
 * every listing was implicitly sold everywhere the seller was allowed to sell.
 * That is a reasonable default and a bad assumption: a cold-chain sensor
 * certified for one market is not thereby certified for the others, and the
 * seller is the only one who knows.
 */

/* ------------------------------------------------------- billing period -- */

alter table products add column if not exists billing_period text;

alter table products drop constraint if exists products_billing_period_check;
alter table products add constraint products_billing_period_check check (
  /* Null is the honest value for something bought once. A one-off purchase has
     no billing period, and writing 'monthly' there to avoid a null would make
     every rollup that groups by period wrong. */
  (model = 'oneoff' and billing_period is null)
  or (model <> 'oneoff' and billing_period in ('monthly', 'quarterly', 'half-yearly', 'yearly'))
);

/* Everything recurring on file today bills monthly — that is what `model =
   'monthly'` meant when it was the only recurring value there was. Stated as a
   backfill rather than a default so the column carries a fact rather than a
   guess about rows written later. */
update products set billing_period = 'monthly'
where model <> 'oneoff' and billing_period is null;

/* ------------------------------------------------------ where it is sold -- */

create table if not exists product_markets (
  product_id  text not null references products(id) on delete cascade,
  market_code text not null references markets(code),
  primary key (product_id, market_code)
);

alter table product_markets enable row level security;

/* A buyer has to be able to see where something is sold — it is what decides
   whether the storefront should offer it at all. */
create policy public_read_product_markets
  on product_markets for select to anon, authenticated using (true);

/* A seller says where their own listing is sold, and nowhere else. */
create policy partner_write_product_markets
  on product_markets for all to authenticated
  using (exists (
    select 1 from products p
    where p.id = product_markets.product_id and p.partner_id = current_partner_id()
  ))
  with check (exists (
    select 1 from products p
    where p.id = product_markets.product_id and p.partner_id = current_partner_id()
  ));

create policy operator_all_product_markets
  on product_markets for all to authenticated
  using (current_persona() = 'operator')
  with check (current_persona() = 'operator');

/* A listing cannot be sold where its seller may not trade. Enforced here rather
   than only in the form, because the form is one caller and the rule is about
   the marketplace: a seller whose approval for a market is withdrawn should not
   be able to add listings to it through any door. First-party products have no
   partner and are the marketplace's own, so they are exempt. */
create or replace function guard_product_market() returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_partner text;
  v_state   text;
begin
  select partner_id into v_partner from products where id = new.product_id;
  if v_partner is null then
    return new;
  end if;

  select state into v_state from partner_markets
  where partner_id = v_partner and market_code = new.market_code;

  if v_state is null then
    raise exception '% is not approved to sell in %', v_partner, new.market_code;
  end if;
  if v_state <> 'approved' then
    raise exception '%''s approval for % is %, not approved', v_partner, new.market_code, v_state;
  end if;
  return new;
end $$;

drop trigger if exists product_markets_guard on product_markets;
create trigger product_markets_guard
  before insert or update on product_markets
  for each row execute function guard_product_market();

/* Every live product is sold where its seller trades, which is what was
   implicitly true before this table existed. Backfilled rather than left empty:
   an empty table would mean "sold nowhere" to anything reading it. */
insert into product_markets (product_id, market_code)
select p.id, pm.market_code
from products p
join partner_markets pm on pm.partner_id = p.partner_id and pm.state = 'approved'
on conflict do nothing;

/* First-party products — the marketplace's own, with no seller behind them —
   are sold in every market the marketplace operates. */
insert into product_markets (product_id, market_code)
select p.id, m.code
from products p cross join markets m
where p.partner_id is null
on conflict do nothing;

/* --------------------------------------------------------- what is true -- */

do $$
declare
  n int;
begin
  /* The period is recorded for everything that recurs, and for nothing that
     does not. Ranged over the table rather than spot-checked. */
  select count(*) into n from products where model <> 'oneoff' and billing_period is null;
  if n > 0 then raise exception '% recurring products have no billing period', n; end if;

  select count(*) into n from products where model = 'oneoff' and billing_period is not null;
  if n > 0 then raise exception '% one-off products claim a billing period', n; end if;

  /* The constraint refuses a period nobody offers. Checked by trying it, since
     a check constraint that was written wrong still creates cleanly. */
  begin
    insert into products (id, category_id, name, seller, price, floor_price, list_price,
                          model, fulfil, stock, status, description, tags, billing_period)
    values ('SKU-CHECK-BP', 'iot', 'constraint probe', 'probe', 1, 1, 1,
            'monthly', 'provisioned', 'in', 'pending', 'x', '{}', 'fortnightly');
    raise exception 'the billing period constraint accepted "fortnightly"';
  exception
    when check_violation then null;
  end;

  /* Every product is sold somewhere. A product in no market is invisible, and
     the backfill above is what stops this table meaning that. */
  select count(*) into n from products p
  where p.status = 'live'
    and not exists (select 1 from product_markets pm where pm.product_id = p.id);
  if n > 0 then raise exception '% live products are sold in no market at all', n; end if;

  /* And nothing is sold where its seller may not trade — the condition the
     trigger exists to hold, checked against the rows that already existed. */
  select count(*) into n from product_markets pm
  join products p on p.id = pm.product_id
  where p.partner_id is not null
    and not exists (
      select 1 from partner_markets x
      where x.partner_id = p.partner_id and x.market_code = pm.market_code and x.state = 'approved'
    );
  if n > 0 then raise exception '% listings are sold in a market their seller does not hold', n; end if;

  select count(*) into n from pg_policies where tablename = 'product_markets';
  if n <> 3 then raise exception 'product_markets has % of its 3 policies', n; end if;

  select count(*) into n from pg_trigger
  where tgrelid = 'product_markets'::regclass and tgname = 'product_markets_guard';
  if n <> 1 then raise exception 'the product market guard is not attached'; end if;
end $$;
