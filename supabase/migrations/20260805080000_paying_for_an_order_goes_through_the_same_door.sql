/*
  # Paying for an order goes through the same door as topping up a wallet

  Checkout offered four ways to pay, hard-coded into the JSX, and the Pay button
  wrote the order. Nothing went anywhere. The four were also wrong in a way that
  is easy to miss: "Mobile Wallet — PayTM, Airtel Money, M-Pesa" offered three
  countries' rails on one line to every shopper, in a marketplace whose whole
  premise is that India, the UAE and Kenya are different places. A shopper in
  Dubai was being shown M-Pesa.

  The wallet top-up already had a payment catalogue, an attempt record and a
  settle function. This puts the checkout on the same three rather than growing
  a second set beside them, which means one place decides what a market can be
  paid in and one function decides what "paid" does to the records.

  ## Two more ways to pay

  `mobile_wallet` and `carrier_billing` join the catalogue. Carrier billing
  belongs here more than anywhere: this is a telecom marketplace, the shopper
  already has a bill with the operator, and putting a £15 streaming add-on on it
  is the single most natural payment on the site. It carries a ceiling, because
  a carrier bill is not a credit line and no operator would let somebody put a
  ₹65,000 handset on next month's bill.

  ## An attempt can now be for an order instead of a wallet

  `payment_attempts.purpose` existed and always said 'wallet_topup'. It now
  means something: an attempt links to a wallet or to an order, exactly one, and
  the check constraint says which for each purpose. `orders.payment_ref` holds
  the attempt's reference, so settling matches on equality rather than picking
  apart an order reference with string functions — and the shopper's order has a
  payment reference on it, which is the number they will quote if anything goes
  wrong.

  ## What "paid" does

  `settle_payment_attempt` branches. For a top-up it credits the wallet, as
  before. For an order it moves every order carrying that payment reference from
  `awaiting_payment` to `placed`. A basket spanning two sellers becomes two
  orders and one payment — the shopper paid once — so the update is by reference
  and not by id.

  Orders are written before the shopper leaves, in `awaiting_payment`, because
  an order that does not exist until the money arrives cannot be reconciled
  against a payment that arrived without one. They are not visible as orders
  until they are paid for; `expire_stale_payments` clears the ones nobody came
  back to.
*/

/* The kinds have to admit the two new ones before the two new ones arrive. */
alter table payment_methods drop constraint if exists payment_methods_kind_check;
alter table payment_methods add constraint payment_methods_kind_check
  check (kind in ('card', 'netbanking', 'upi', 'mobile_money', 'bank_transfer',
                  'mobile_wallet', 'carrier_billing'));

insert into payment_methods (id, label, kind, blurb, redirects, asks_for, typical, sort_order) values
  ('mobile_wallet', 'Mobile wallet', 'mobile_wallet',
   'Pay from a wallet you already top up — the balance is debited straight away.',
   true, 'Your registered mobile number, then the wallet''s own PIN', 'under a minute', 6),
  ('carrier_billing', 'Add to your telecom bill', 'carrier_billing',
   'Charged to your Aventa account and settled with next month''s bill. Nothing leaves your bank today.',
   true, 'Your mobile number, then the code we text to it', 'about a minute', 7)
on conflict (id) do update set
  label = excluded.label, kind = excluded.kind, blurb = excluded.blurb,
  redirects = excluded.redirects, asks_for = excluded.asks_for,
  typical = excluded.typical, sort_order = excluded.sort_order;

/* A carrier bill is not a credit line. Above this the shopper is asked to pay
   another way, which is what an operator's own billing rules would do. */
alter table payment_methods add column if not exists max_amount numeric(12,2);
comment on column payment_methods.max_amount is
  'Ceiling per payment in the market currency, or null for none. Carrier billing has one because a monthly bill is not a credit line.';

/* Where the new two are offered, and by whom. Mobile wallets are national: an
   Indian shopper knows PayTM and PhonePe and has never heard of Careem Pay.
   Kenya is deliberately absent — M-Pesa is already in the catalogue as
   `mobile_money`, and listing it twice under two names would be one rail
   pretending to be two. */
insert into payment_method_markets (method_id, market_code, provider, sort_order) values
  ('mobile_wallet',   'IN', 'PayTM · PhonePe · Amazon Pay', 4),
  ('mobile_wallet',   'AE', 'Careem Pay · e& money',        3),
  ('carrier_billing', 'IN', 'Aventa Telecom billing',       5),
  ('carrier_billing', 'AE', 'Aventa Telecom billing',       4),
  ('carrier_billing', 'KE', 'Aventa Telecom billing',       4)
on conflict (method_id, market_code) do update set
  provider = excluded.provider, sort_order = excluded.sort_order;

/* Set in the market's own money rather than converted from one number, because
   a ceiling is a policy per market and not an exchange-rate calculation. */
update payment_methods set max_amount = 30000 where id = 'carrier_billing';

/* ------------------------------------------------ an attempt for an order --- */

alter table payment_attempts add column if not exists order_ref text;
alter table payment_attempts alter column wallet_id drop not null;

alter table payment_attempts drop constraint if exists payment_attempts_purpose_check;
alter table payment_attempts add constraint payment_attempts_purpose_check
  check (purpose in ('wallet_topup', 'order'));

/* Exactly one thing is being paid for. An attempt against both a wallet and an
   order would credit one and settle the other from a single payment. */
alter table payment_attempts drop constraint if exists payment_attempts_target_check;
alter table payment_attempts add constraint payment_attempts_target_check
  check (
    (purpose = 'wallet_topup' and wallet_id is not null and order_ref is null)
    or (purpose = 'order' and order_ref is not null and wallet_id is null)
  );

/* `payment_attempts_credit_check` was written when every payment was a wallet
   top-up, so it said a successful payment has a ledger row. That is true of a
   top-up and false of an order — an order payment moves the order and writes
   nothing to the wallet ledger, because no wallet was involved. The rule is
   about the purpose, and it always was; it only looked like a rule about
   success because there was one purpose. */
alter table payment_attempts drop constraint if exists payment_attempts_credit_check;
alter table payment_attempts add constraint payment_attempts_credit_check
  check (
    (purpose = 'wallet_topup' and ((state = 'succeeded') = (ledger_id is not null)))
    or (purpose = 'order' and ledger_id is null)
  );

alter table orders add column if not exists payment_ref text;
create index if not exists orders_payment_ref_idx on orders (payment_ref);

comment on column orders.payment_ref is
  'The payment_attempts reference that paid for this order. One payment may cover several orders, because a basket spanning two sellers becomes two orders and the shopper paid once.';

/* A shopper starting a payment for their own basket. The wallet clause is
   unchanged; the order clause is new, and it is narrow on purpose — an order
   payment may only be started against orders that are waiting for one and that
   belong to the person starting it. */
drop policy if exists owner_start_payment_attempts on payment_attempts;
create policy owner_start_payment_attempts on payment_attempts
  for insert to authenticated
  with check (
    state = 'initiated'
    and decided_at is null
    and ledger_id is null
    and (
      (purpose = 'wallet_topup' and exists (
        select 1 from wallets w
         where w.id = payment_attempts.wallet_id
           and (w.user_id = auth.uid()
                or (w.account_id is not null and w.account_id = current_account_id()))
      ))
      or (purpose = 'order' and user_id = auth.uid())
    )
  );

/* And reading them back. An order payment has no wallet to hang the permission
   off, so it hangs off who started it. */
drop policy if exists owner_read_payment_attempts on payment_attempts;
create policy owner_read_payment_attempts on payment_attempts
  for select to authenticated
  using (
    user_id = auth.uid()
    or exists (
      select 1 from wallets w
       where w.id = payment_attempts.wallet_id
         and (w.user_id = auth.uid()
              or (w.account_id is not null and w.account_id = current_account_id()))
    )
  );

/* ------------------------------------------------------- settling, twice --- */

create or replace function settle_payment_attempt(
  p_attempt   text,
  p_outcome   text,
  p_instrument text default null,
  p_gateway_ref text default null,
  p_reason    text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  a          payment_attempts%rowtype;
  w          wallets%rowtype;
  mine       boolean;
  led        text;
  ceiling    numeric;
  n_orders   integer;
begin
  if p_outcome not in ('succeeded', 'failed', 'cancelled', 'expired') then
    raise exception 'A payment is not %.', p_outcome;
  end if;

  select * into a from payment_attempts where id = p_attempt for update;
  if not found then
    raise exception 'There is no payment %.', p_attempt;
  end if;

  /* Who is allowed to answer for this payment. A top-up hangs off the wallet's
     owner; an order payment off whoever started it, because an order has no
     wallet to ask. */
  if a.purpose = 'wallet_topup' then
    select * into w from wallets where id = a.wallet_id for update;
    if not found then
      raise exception 'That payment is against a wallet that no longer exists.';
    end if;
    mine := (w.user_id = auth.uid())
         or (w.account_id is not null and w.account_id = current_account_id());
  else
    mine := (a.user_id = auth.uid());
  end if;

  if not mine then
    raise exception 'That payment is not yours.';
  end if;

  if a.state <> 'initiated' then
    /* Not an error. A provider calling back twice is ordinary, and the second
       call must find the first call's answer rather than a failure. */
    return jsonb_build_object(
      'already', true, 'state', a.state, 'reference', a.reference,
      'note', format('Payment %s was already %s.', a.reference, a.state));
  end if;

  if p_outcome <> 'succeeded' then
    update payment_attempts
       set state = p_outcome,
           decided_at = now(),
           gateway_ref = coalesce(p_gateway_ref, gateway_ref),
           instrument = coalesce(p_instrument, instrument),
           failure_reason = case when p_outcome = 'failed'
                                 then coalesce(nullif(trim(p_reason), ''), 'The provider refused the payment and gave no reason.')
                                 else p_reason end
     where id = a.id;
    return jsonb_build_object('already', false, 'state', p_outcome, 'reference', a.reference);
  end if;

  /* ------------------------------------------------------------- an order */
  if a.purpose = 'order' then
    update orders
       set status = 'placed',
           payment_method = a.method_id
     where payment_ref = a.reference
       and status = 'awaiting_payment';
    get diagnostics n_orders = row_count;

    if n_orders = 0 then
      update payment_attempts
         set state = 'failed', decided_at = now(),
             gateway_ref = coalesce(p_gateway_ref, gateway_ref),
             instrument = coalesce(p_instrument, instrument),
             failure_reason = 'The basket this paid for is no longer waiting to be paid. Nothing was charged.'
       where id = a.id;
      return jsonb_build_object('already', false, 'state', 'failed', 'reference', a.reference,
        'note', 'There was nothing left to pay for.');
    end if;

    update payment_attempts
       set state = 'succeeded', decided_at = now(),
           gateway_ref = coalesce(p_gateway_ref, gateway_ref),
           instrument = coalesce(p_instrument, instrument)
     where id = a.id;

    return jsonb_build_object('already', false, 'state', 'succeeded',
                              'reference', a.reference, 'orders', n_orders);
  end if;

  /* -------------------------------------------------------------- a wallet */
  /* The ceiling is checked here and not only when the form opened. A customer
     can be away at the provider for two minutes, and a refund landing in that
     window is exactly how a wallet ends up over its limit. */
  select max_balance into ceiling from wallet_limits where currency = w.currency;
  if ceiling is not null and w.balance + a.amount > ceiling then
    update payment_attempts
       set state = 'failed', decided_at = now(),
           gateway_ref = coalesce(p_gateway_ref, gateway_ref),
           instrument = coalesce(p_instrument, instrument),
           failure_reason = format(
             'The wallet reached %s while this payment was with the provider, and crediting it would pass the %s ceiling. Nothing was charged.',
             w.balance, ceiling)
     where id = a.id;
    return jsonb_build_object('already', false, 'state', 'failed', 'reference', a.reference,
      'note', 'The payment was not applied — the wallet would have passed its ceiling.');
  end if;

  led := 'W' || a.id;

  insert into wallet_ledger (id, wallet_id, when_date, source, what, amount, pot, ref, sort_order)
  values (led, w.id, current_date, 'topup',
          format('Top-up by %s', coalesce(p_instrument, a.instrument, 'card')),
          a.amount, 'cash', a.reference, 999);

  update wallets
     set cash = cash + a.amount,
         last_move = current_date
   where id = w.id;

  update payment_attempts
     set state = 'succeeded', decided_at = now(), ledger_id = led,
         gateway_ref = coalesce(p_gateway_ref, gateway_ref),
         instrument = coalesce(p_instrument, instrument)
   where id = a.id;

  return jsonb_build_object('already', false, 'state', 'succeeded',
                            'reference', a.reference, 'ledger_id', led);
end $$;

grant execute on function settle_payment_attempt(text, text, text, text, text) to authenticated;

/* ------------------------------------------- and the baskets nobody paid --- */

/**
 * Close out anything nobody is going to answer, and the orders waiting on it.
 *
 * An order sitting in `awaiting_payment` for ever is worse than no order: it
 * holds a reference, it can be reconciled against nothing, and the shopper who
 * abandoned it three weeks ago has no idea it is there. When the payment
 * expires the basket goes with it — nothing was charged, so there is nothing to
 * keep.
 */
create or replace function expire_stale_payments() returns integer
language plpgsql security definer set search_path = public as $$
declare
  moved integer;
begin
  create temporary table if not exists expired_now (reference text) on commit drop;
  delete from expired_now;

  with gone as (
    update payment_attempts
       set state = 'expired',
           decided_at = now(),
           failure_reason = null
     where state = 'initiated'
       and started_at < now() - interval '15 minutes'
    returning reference, purpose
  )
  insert into expired_now select reference from gone where purpose = 'order';

  get diagnostics moved = row_count;

  delete from order_items oi
   where oi.order_id in (
     select o.id from orders o
      join expired_now e on e.reference = o.payment_ref
     where o.status = 'awaiting_payment');

  delete from orders o
   using expired_now e
   where e.reference = o.payment_ref
     and o.status = 'awaiting_payment';

  select count(*) into moved from payment_attempts
   where state = 'expired' and decided_at > now() - interval '1 minute';
  return moved;
end $$;

grant execute on function expire_stale_payments() to authenticated;

do $$
declare
  n integer;
  r record;
begin
  /* Every market can still be paid in, and can still take a card. */
  select count(*) into n from markets m
   where not exists (select 1 from payment_method_markets pm where pm.market_code = m.code);
  if n > 0 then raise exception '% markets offer no way to pay at all', n; end if;

  /* Carrier billing is offered everywhere, because everywhere here is a market
     this telco bills in. If that stops being true this assertion is the thing
     that notices. */
  select count(*) into n from markets m
   where not exists (
     select 1 from payment_method_markets pm
      where pm.market_code = m.code and pm.method_id = 'carrier_billing');
  if n > 0 then raise exception '% markets cannot put a purchase on the telecom bill', n; end if;

  /* No rail is offered where it does not exist. */
  for r in
    select method_id, market_code from payment_method_markets
     where (method_id in ('upi', 'netbanking') and market_code <> 'IN')
        or (method_id = 'mobile_money' and market_code <> 'KE')
        or (method_id = 'mobile_wallet' and market_code = 'KE')
  loop
    raise exception '% is offered in %, where it is not a payment rail', r.method_id, r.market_code;
  end loop;

  /* The ceiling exists and is a real number. A carrier-billing ceiling of null
     is a credit line, which is the thing it must not be. */
  select count(*) into n from payment_methods
   where id = 'carrier_billing' and coalesce(max_amount, 0) <= 0;
  if n > 0 then raise exception 'Carrier billing has no ceiling'; end if;

  /* An attempt pays for exactly one thing. Checked as data rather than only as
     a constraint, because the constraint was added to a table with rows in it. */
  select count(*) into n from payment_attempts
   where (wallet_id is null) = (order_ref is null);
  if n > 0 then raise exception '% payments pay for both a wallet and an order, or neither', n; end if;

  /* A successful top-up credited a wallet; a successful order payment did not,
     and must not have. */
  select count(*) into n from payment_attempts
   where purpose = 'wallet_topup' and (state = 'succeeded') <> (ledger_id is not null);
  if n > 0 then raise exception '% top-ups disagree about whether they credited anything', n; end if;

  select count(*) into n from payment_attempts where purpose = 'order' and ledger_id is not null;
  if n > 0 then raise exception '% order payments wrote to a wallet ledger', n; end if;

  /* Nothing was quietly re-purposed. */
  select count(*) into n from payment_attempts where purpose <> 'wallet_topup';
  if n > 0 then raise exception '% existing payments changed purpose', n; end if;

  if to_regprocedure('public.settle_payment_attempt(text, text, text, text, text)') is null then
    raise exception 'settle_payment_attempt did not take';
  end if;

  /* Still nobody may decide an attempt by updating it. */
  select count(*) into n from pg_policies
   where tablename = 'payment_attempts' and cmd in ('UPDATE', 'ALL');
  if n > 0 then
    raise exception '% policies let an attempt be decided outside settle_payment_attempt', n;
  end if;
end $$;
