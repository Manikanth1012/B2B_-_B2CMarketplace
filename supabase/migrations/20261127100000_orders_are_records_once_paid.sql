/*
 * Orders are records once paid, and the risk follow-ups.
 *
 * Spec 17 (docs/superpowers/specs/2026-11-27-order-integrity-and-risk-follow-ups-design.md).
 * Applies after 20261126100000.
 *
 * Spec 13 held a risky order until the marketplace decided it, and its final
 * review found the hold could be walked around by the buyer: the shopper
 * policies 20260729130300 wrote for every consumer table (`owner_update_%`,
 * `owner_delete_%`, made in a loop) still covered `orders` and `order_items`.
 * A shopper could update their own order (status, address, total) and delete
 * it, held, scored or delivered, and `order_risk` went with it on the cascade.
 *
 *   1. A shopper deletes an order only while it is waiting to be paid and has
 *      never been scored: exactly what checkout's undo does. The policy
 *      (`owner_delete_orders`: their own, as a consumer) stays; the delete
 *      guard (`guard_order_delete`, latest copy from 20260808220000) now
 *      refuses anything else from a signed-in non-operator, with a sentence
 *      saying why. The operator's rules are unchanged, and so is a session
 *      with nobody signed in (the schedule, a data fix). The security-definer
 *      clean-ups a shopper's session runs (`settle_payment_attempt` and
 *      `expire_stale_payments` removing unpaid baskets, the latter anyone's)
 *      delete only orders still awaiting payment, so they pass.
 *
 *   2. A shopper updates neither `orders` nor `order_items`: the two
 *      `owner_update_*` policies go. Nothing in the app updates either as a
 *      shopper; every move is a security-definer function, the operator's
 *      policy, or a seller's part (`order_part`). `owner_delete_order_items`
 *      goes too: a shopper could strip the lines off a paid order, and the
 *      only legitimate removal of lines is the cascade from an order, which
 *      runs as the table's owner and does not need it.
 *
 *   2b. An order is created unpaid. `owner_insert_orders` (latest copy, the
 *      20260729130300 loop) now also asks for `status = 'awaiting_payment'`
 *      and no account: a shopper could write a `placed` or `delivered` order
 *      with no payment behind it. `owner_insert_order_items` now also asks
 *      that the line's order is the shopper's own and still awaiting payment:
 *      it never asked whose order it was. Checkout writes exactly that (its
 *      orders unpaid, then their lines). Business orders, payments, seeds and
 *      data fixes are written by security-definer functions or the SQL
 *      editor, as the tables' owner, and are not held to these policies.
 *
 *   Plus `orders_are_records()`, a read-only marker (always true) the live
 *   test calls to tell whether this migration is applied without writing.
 *
 *   3. `guard_order_currency` (latest copy from 20260802470000) lets the
 *      decision on a held order through when the shopper has changed market
 *      since: inside `decide_held_order` (the `aventa.risk_decision` flag is
 *      on) an update that changes neither the market, the currency, the
 *      account nor the buyer is not a new sale.
 *
 *   4. `refresh_account_risk` (latest copy from 20261113600000) scores each
 *      account in its own block. A fault on one is counted in `failed`, the
 *      first 20 listed in `failures` as {kind, id, reason}, and the rest are
 *      still scored.
 *
 *   5. `score_order` (latest copy from 20261113600000) does not count an
 *      earlier order that is held as a purchase: not for "First order", the
 *      usual size ("Far bigger than usual") or the addresses used before.
 *      "Orders in an hour" still counts one, as it counts every attempt.
 *
 * Idempotent, one transaction, self-check last (all of it rolled back).
 */

begin;

/* ============================================ 1 and 2. the policies === */

drop policy if exists "owner_update_orders" on public.orders;
drop policy if exists "owner_update_order_items" on public.order_items;
drop policy if exists "owner_delete_order_items" on public.order_items;

/* 2b. The two insert policies, copied from the 20260729130300 loop (their
   latest definitions) with one condition each added. The order_items check
   reads orders under the shopper's own row-level security, which lets them
   see their own orders; no orders policy reads order_items back, so the
   check does not recurse. */
drop policy if exists "owner_insert_orders" on public.orders;
create policy "owner_insert_orders" on public.orders for insert to authenticated
  with check (user_id = auth.uid() and current_persona() = 'consumer'
              and status = 'awaiting_payment' and account_id is null);

drop policy if exists "owner_insert_order_items" on public.order_items;
create policy "owner_insert_order_items" on public.order_items for insert to authenticated
  with check (user_id = auth.uid() and current_persona() = 'consumer'
              and exists (select 1 from public.orders o
                           where o.id = order_items.order_id
                             and o.user_id = auth.uid()
                             and o.status = 'awaiting_payment'));

/* The marker. Read-only and always true: its existence is the answer. */
create or replace function public.orders_are_records()
returns boolean language sql stable set search_path = public as $$ select true $$;

comment on function public.orders_are_records() is
  'True once 20261127100000 (orders are records once paid) is applied. Read-only; the live test calls it.';

revoke all on function public.orders_are_records() from public, anon;
grant execute on function public.orders_are_records() to authenticated;

/* ================================================= 1. the delete guard === */

/* `guard_order_delete`, copied from 20260808220000 (its latest definition).
   Changed only: a signed-in non-operator may remove an order only while it
   is waiting to be paid and has never been scored. Whose order it is stays
   the policy's question (`owner_delete_orders`). */
create or replace function public.guard_order_delete()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare touched text;
begin
  /* Nobody signed in: the schedule, or a data fix in the SQL editor. */
  if public.current_persona() is null then return old; end if;

  /* A shopper removing a basket nobody paid for (checkout's undo, or a
     payment that never came back) is the only delete that is not the
     marketplace's. Anything past that is a record of a purchase. */
  if public.current_persona() is distinct from 'operator' then
    if old.status is distinct from 'awaiting_payment' then
      raise exception
        '% cannot be removed. It is no longer waiting to be paid, so it is a record of a purchase; ask for it to be cancelled or refunded instead.',
        old.order_ref;
    end if;
    if exists (select 1 from public.order_risk r where r.order_id = old.id) then
      raise exception
        '% cannot be removed. The marketplace has checked it, so it is kept as a record.',
        old.order_ref;
    end if;
    return old;
  end if;

  /* Money first, because these are the ones that make it a transaction rather
     than a stray row. */
  select string_agg(x.what, ', ') into touched from (
    select w.what from (values
      ('a payment attempt', exists (select 1 from public.payment_attempts where order_ref = old.order_ref)),
      ('a refund',          exists (select 1 from public.refunds          where order_ref = old.order_ref)),
      ('a settlement line', exists (select 1 from public.settlement_lines where order_ref = old.order_ref)),
      ('a network fulfilment record',
                            exists (select 1 from public.com_order        where order_ref = old.order_ref)),
      ('a reserved number', exists (select 1 from public.number_resource  where order_ref = old.order_ref)),
      ('a number holder',   exists (select 1 from public.number_holder    where order_ref = old.order_ref)),
      ('a stock unit',      exists (select 1 from public.stock_unit       where order_ref = old.order_ref)),
      ('a seller dispute',  exists (select 1 from public.partner_disputes where order_ref = old.order_ref))
    ) as w(what, hit)
     where w.hit
  ) x;

  if touched is not null then
    raise exception
      '% cannot be removed — % refers to it. An order that money has touched is a record of '
      'something that happened; fail it with a reason, or refund it.',
      old.order_ref, touched;
  end if;

  if old.invoice_id is not null then
    raise exception
      '% is on invoice %. Removing it would leave the invoice quoting an order that does not exist.',
      old.order_ref, old.invoice_id;
  end if;

  /* And nothing that has been fulfilled. A delivered order with no payment
     record is its own problem, and deleting it hides that rather than fixing
     it. */
  if old.status in ('delivered', 'active', 'refunded', 'in-transit', 'shipped') then
    raise exception
      '% is %. Only an order that never went anywhere can be removed; this one did.',
      old.order_ref, old.status;
  end if;

  return old;
end $$;

revoke all on function public.guard_order_delete() from public, anon, authenticated;

drop trigger if exists z_guard_order_delete on public.orders;
create trigger z_guard_order_delete
  before delete on public.orders
  for each row execute function public.guard_order_delete();

/* ================================================ 3. the currency guard === */

/* `guard_order_currency`, copied from 20260802470000 (its latest definition).
   Changed only: the first statement. A decision on a held order
   (`decide_held_order` sets the flag around its one update) that leaves the
   market, the currency, the account and the buyer as they were is a status
   change on a sale already made in that money, not a new sale; asking the
   shopper's market again would leave the order stuck if they had moved. */
create or replace function public.guard_order_currency()
returns trigger language plpgsql security definer set search_path = public as $$
declare home text;
begin
  if tg_op = 'UPDATE'
     and coalesce(current_setting('aventa.risk_decision', true), '') = 'on'
     and new.market is not distinct from old.market
     and new.currency is not distinct from old.currency
     and new.account_id is not distinct from old.account_id
     and new.user_id is not distinct from old.user_id then
    return new;
  end if;

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

revoke all on function public.guard_order_currency() from public, anon, authenticated;

drop trigger if exists guard_order_currency_trg on public.orders;
create trigger guard_order_currency_trg
  before insert or update on public.orders
  for each row execute function public.guard_order_currency();

/* ===================================================== 5. scoring an order === */

/* `score_order`, copied from 20261113600000 (its latest definition). Changed
   only: an earlier order that is held is not counted as a purchase in the
   earlier-order count, the median and the addresses used before. The burst
   (orders in an hour) is unchanged and still counts it. */
create or replace function public.score_order(p_order uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
<<so>>
declare
  v_o         public.orders%rowtype;
  v_at        timestamptz;
  v_band_acct text;
  v_joined    timestamptz;
  v_earlier   integer := 0;
  v_median    numeric;
  v_sim       boolean := false;
  v_new_addr  boolean := false;
  v_failed    integer := 0;
  v_burst     integer := 0;
  v_rate      numeric;
  v_usd       numeric;
  rr          record;
  v_pts       integer;
  v_score     integer := 0;
  v_reasons   jsonb := '[]'::jsonb;
  v_review    integer;
  v_hold      integer;
  v_band      text;
begin
  select * into v_o from public.orders o where o.id = p_order;
  if not found then
    raise exception 'There is no order % to score.', p_order;
  end if;
  v_at := coalesce(v_o.created_at, now());

  if v_o.user_id is not null then
    select ar.band into v_band_acct
      from public.account_risk ar
     where ar.kind = 'shopper' and ar.id = v_o.user_id::text;

    select u.created_at into v_joined from auth.users u where u.id = v_o.user_id;

    select count(*) into v_earlier
      from public.orders e
     where e.user_id = v_o.user_id and e.id <> v_o.id and e.account_id is null
       and e.created_at < v_at
       and (v_o.payment_ref is null or e.payment_ref is distinct from v_o.payment_ref)
       and e.status not in ('held', 'awaiting_payment', 'cancelled', 'failed');

    select percentile_cont(0.5) within group (order by e.total) into v_median
      from public.orders e
     where e.user_id = v_o.user_id and e.id <> v_o.id and e.account_id is null
       and e.created_at < v_at
       and (v_o.payment_ref is null or e.payment_ref is distinct from v_o.payment_ref)
       and e.status not in ('held', 'awaiting_payment', 'cancelled', 'failed')
       and e.currency = v_o.currency;

    select count(distinct coalesce(e.payment_ref, e.order_ref)) into v_burst
      from public.orders e
     where e.user_id = v_o.user_id and e.account_id is null
       and (e.id = v_o.id
            or (e.created_at > v_at - interval '1 hour' and e.created_at <= v_at
                and e.status not in ('awaiting_payment', 'cancelled', 'failed')));
  end if;

  /* A SIM or eSIM line: one fulfilled as an eSIM, or a product filed or named
     as a SIM (the IoT SIMs ship). */
  select exists (
    select 1
      from public.order_items i
      left join public.products p on p.id = i.product_id
      left join public.categories c on c.id = p.category_id
     where i.order_id = v_o.id
       and (i.fulfil = 'esim' or p.fulfil = 'esim'
            or concat_ws(' ', c.id, c.name, p.sub_category, i.product_name) ~* '\m(e-?)?sims?\M'))
    into v_sim;

  /* To an address none of the buyer's earlier orders went to. */
  if v_sim and v_earlier > 0 and v_o.shipping_address is not null then
    v_new_addr := not exists (
      select 1 from public.orders e
       where e.user_id = v_o.user_id and e.id <> v_o.id and e.account_id is null
         and e.created_at < v_at
         and (v_o.payment_ref is null or e.payment_ref is distinct from v_o.payment_ref)
         and e.status not in ('held', 'awaiting_payment', 'cancelled', 'failed')
         and e.shipping_address = v_o.shipping_address);
  end if;

  /* Refused attempts in the last day, by the buyer or for this order. */
  select count(*) into v_failed
    from public.payment_attempts pa
   where pa.state = 'failed'
     and ((v_o.user_id is not null and pa.user_id = v_o.user_id) or pa.order_ref = v_o.order_ref)
     and coalesce(pa.decided_at, pa.started_at) > now() - interval '24 hours';

  /* The total in dollars, at the latest rate on or before the order. */
  if v_o.currency = 'USD' then
    v_usd := v_o.total;
  else
    select f.rate into v_rate
      from public.fx_rates f
     where f.base = 'USD' and f.quote = v_o.currency and f.as_of <= v_at::date
     order by f.as_of desc limit 1;
    if v_rate > 0 then v_usd := v_o.total / v_rate; end if;
  end if;

  for rr in
    select r.* from public.risk_rules r where r.applies = 'order' and r.enabled order by r.sort_order, r.id
  loop
    v_pts := 0;
    if rr.id = 'o-account-review' then
      if v_band_acct = 'review' then v_pts := rr.points; end if;
    elsif rr.id = 'o-account-high' then
      if v_band_acct = 'high' then v_pts := rr.points; end if;
    elsif rr.id = 'o-new-account' then
      if v_joined > v_at - rr.threshold * interval '1 day' then v_pts := rr.points; end if;
    elsif rr.id = 'o-first-order' then
      if v_o.user_id is not null and v_earlier = 0 then v_pts := rr.points; end if;
    elsif rr.id = 'o-big-order' then
      if v_median > 0 and v_o.total > rr.threshold * v_median then v_pts := rr.points; end if;
    elsif rr.id = 'o-sim-line' then
      if v_sim then v_pts := rr.points; end if;
    elsif rr.id = 'o-sim-new-address' then
      if v_new_addr then v_pts := rr.points; end if;
    elsif rr.id = 'o-guest' then
      if v_o.user_id is null then v_pts := rr.points; end if;
    elsif rr.id = 'o-failed-payments' then
      if v_failed >= rr.threshold then v_pts := rr.points; end if;
    elsif rr.id = 'o-burst' then
      if v_burst >= rr.threshold then v_pts := rr.points; end if;
    elsif rr.id = 'o-carrier-emi' then
      if v_o.payment_method in ('carrier_billing', 'emi') and v_usd > rr.threshold then v_pts := rr.points; end if;
    end if;

    if v_pts <> 0 then
      v_score := v_score + v_pts;
      v_reasons := v_reasons || jsonb_build_array(jsonb_build_object('rule', rr.id, 'label', rr.label, 'points', v_pts));
    end if;
  end loop;

  select s.review_at, s.hold_at into v_review, v_hold from public.risk_settings s where s.kind = 'order';
  v_review := coalesce(v_review, 40);
  v_hold := coalesce(v_hold, 70);
  if v_score >= v_hold then
    v_band := 'hold';
  elsif v_score >= v_review then
    v_band := 'review';
  else
    v_band := 'low';
  end if;

  return jsonb_build_object('score', v_score, 'band', v_band, 'reasons', v_reasons);
end $$;

comment on function public.score_order(uuid) is
  'The risk score of an order: the enabled order rules that fired, the band, and the reasons. Read-only.';

revoke all on function public.score_order(uuid) from public, anon, authenticated;

/* ============================================= 4. rescoring the accounts === */

/* `refresh_account_risk`, copied from 20261113600000 (its latest
   definition). Changed only: each account is scored in its own block. A
   fault rolls back that account alone, is counted in `failed` and, for the
   first 20, listed in `failures`; the rest are still scored. */
create or replace function public.refresh_account_risk(p_as_of date default current_date)
returns jsonb language plpgsql security definer set search_path = public as $$
<<ra>>
declare
  v_acct     record;
  v_s        jsonb;
  n_scored   integer := 0;
  n_review   integer := 0;
  n_high     integer := 0;
  n_failed   integer := 0;
  v_failures jsonb := '[]'::jsonb;
begin
  if public.current_persona() is distinct from 'operator' and not public.is_scheduler() then
    raise exception 'Only the schedule, or the marketplace, scores accounts.';
  end if;
  if p_as_of is null or p_as_of > current_date then
    raise exception 'Accounts cannot be scored as of %. Only a day that has happened has a history to score.',
      coalesce(p_as_of::text, 'no date');
  end if;

  for v_acct in
    select 'shopper'::text as acct_kind, x.uid::text as acct_id
      from (select o.user_id as uid from public.orders o
             where o.user_id is not null and o.account_id is null
            union
            select pa.user_id from public.payment_attempts pa where pa.user_id is not null) x
     where exists (select 1 from auth.users u where u.id = x.uid)
       and not exists (select 1 from public.profiles pr where pr.id = x.uid and pr.persona <> 'consumer')
    union all
    select 'business'::text, ea.id from public.enterprise_accounts ea
     order by 1, 2
  loop
    begin
      v_s := public.score_account_on(v_acct.acct_kind, v_acct.acct_id, p_as_of);
      insert into public.account_risk as ar (kind, id, score, band, reasons, scored_at)
      values (v_acct.acct_kind, v_acct.acct_id, (v_s ->> 'score')::integer, v_s ->> 'band',
              coalesce(v_s -> 'reasons', '[]'::jsonb), now())
      on conflict (kind, id) do update
        set score = excluded.score, band = excluded.band, reasons = excluded.reasons, scored_at = excluded.scored_at;
      n_scored := n_scored + 1;
      if v_s ->> 'band' = 'review' then
        n_review := n_review + 1;
      elsif v_s ->> 'band' = 'high' then
        n_high := n_high + 1;
      end if;
    exception when others then
      n_failed := n_failed + 1;
      if jsonb_array_length(v_failures) < 20 then
        v_failures := v_failures || jsonb_build_array(
          jsonb_build_object('kind', v_acct.acct_kind, 'id', v_acct.acct_id, 'reason', sqlerrm));
      end if;
      raise warning 'The % account % could not be scored: %', v_acct.acct_kind, v_acct.acct_id, sqlerrm;
    end;
  end loop;

  return jsonb_build_object('ran_on', p_as_of, 'scored', n_scored, 'review', n_review, 'high', n_high,
                            'failed', n_failed, 'failures', v_failures);
end $$;

comment on function public.refresh_account_risk(date) is
  'Scores every shopper and business account into account_risk. Run by the night (job "risk") or the operator. An account that cannot be scored is counted in failed (the first 20 listed in failures) and the rest are still scored.';

revoke all on function public.refresh_account_risk(date) from public, anon;
grant execute on function public.refresh_account_risk(date) to authenticated;

/* ============================================================ self-check === */

do $$
<<chk>>
declare
  dry       jsonb;
  j         jsonb;
  v_n       integer;
  v_res     jsonb;
  v_risk    jsonb;
  v_user    uuid;
  v_cur     text;
  v_mkt     text;
  v_taxr    numeric;
  v_other   text;
  v_op      uuid;
  v_seller  uuid;
  v_dev     record;
  v_biz     text;
  v_total   numeric;
  v_stages  text[] := array['Ordered', 'Confirmed', 'Dispatched', 'In transit', 'Delivered'];
  v_ap      uuid := gen_random_uuid();
  v_aps     uuid := gen_random_uuid();
  v_held    uuid := gen_random_uuid();
  v_placed  uuid := gen_random_uuid();
  v_rel     uuid := gen_random_uuid();
  v_eheld   uuid := gen_random_uuid();
  v_first   uuid := gen_random_uuid();
  v_eplaced uuid := gen_random_uuid();
  v_new     uuid := gen_random_uuid();
  v_else    uuid := gen_random_uuid();
  v_shop    record;
begin
  if not public.is_scheduler() then
    raise exception 'This session (%) is not one the schedule runs as, so the checks below would be refused.', session_user;
  end if;

  /* The shape: no shopper write on either table but the delete of an order,
     the guards in place, the copies changed where they should be. */
  select count(*) into v_n from pg_policies p
   where p.schemaname = 'public' and p.tablename in ('orders', 'order_items')
     and p.policyname in ('owner_update_orders', 'owner_update_order_items', 'owner_delete_order_items');
  if v_n <> 0 then raise exception 'a shopper still has % write policies on orders or their lines', v_n; end if;
  if not exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = 'orders'
                    and p.policyname = 'owner_delete_orders' and p.cmd = 'DELETE') then
    raise exception 'owner_delete_orders is gone, so checkout can no longer undo an unpaid basket';
  end if;
  if exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename in ('orders', 'order_items')
                and p.cmd in ('UPDATE', 'ALL') and coalesce(p.qual, '') like '%auth.uid()%') then
    raise exception 'a policy still lets a buyer update their own order or its lines';
  end if;
  if coalesce((select p.with_check from pg_policies p where p.schemaname = 'public' and p.tablename = 'orders'
                  and p.policyname = 'owner_insert_orders' and p.cmd = 'INSERT'), '') not like '%awaiting_payment%' then
    raise exception 'owner_insert_orders still lets a shopper write an order that is not awaiting payment';
  end if;
  if coalesce((select p.with_check from pg_policies p where p.schemaname = 'public' and p.tablename = 'order_items'
                  and p.policyname = 'owner_insert_order_items' and p.cmd = 'INSERT'), '') not like '%awaiting_payment%' then
    raise exception 'owner_insert_order_items still lets a shopper add a line to any order';
  end if;
  if to_regprocedure('public.orders_are_records()') is null
     or not has_function_privilege('authenticated', 'public.orders_are_records()', 'execute')
     or has_function_privilege('anon', 'public.orders_are_records()', 'execute')
     or public.orders_are_records() is distinct from true then
    raise exception 'the marker orders_are_records() is missing, wrong, or callable without signing in';
  end if;
  if not exists (select 1 from pg_trigger t where t.tgrelid = 'public.orders'::regclass
                    and t.tgname = 'z_guard_order_delete' and not t.tgisinternal) then
    raise exception 'z_guard_order_delete is not on orders';
  end if;
  if not exists (select 1 from pg_trigger t where t.tgrelid = 'public.orders'::regclass
                    and t.tgname = 'guard_order_currency_trg' and not t.tgisinternal) then
    raise exception 'guard_order_currency_trg is not on orders';
  end if;
  if pg_get_functiondef('public.guard_order_currency()'::regprocedure) not like '%aventa.risk_decision%' then
    raise exception 'guard_order_currency does not let a risk decision through';
  end if;
  if pg_get_functiondef('public.score_order(uuid)'::regprocedure)
       not like '%e.status not in (''held'', ''awaiting_payment'', ''cancelled'', ''failed'')%' then
    raise exception 'score_order still counts an earlier held order';
  end if;
  if has_function_privilege('authenticated', 'public.score_order(uuid)', 'execute')
     or has_function_privilege('anon', 'public.refresh_account_risk(date)', 'execute')
     or not has_function_privilege('authenticated', 'public.refresh_account_risk(date)', 'execute') then
    raise exception 'who may call score_order or refresh_account_risk has changed';
  end if;

  /* Rolled back, all of it. */
  begin
    perform set_config('request.jwt.claims', null, true);

    /* A shopper with a home market and an order in it, in money it takes. */
    select o.user_id, o.currency, o.market, o.tax_rate into v_user, v_cur, v_mkt, v_taxr
      from public.orders o
      join public.profiles pr on pr.id = o.user_id and pr.persona = 'consumer'
      join public.consumer_profile cp on cp.user_id = o.user_id and cp.market = o.market
     where o.account_id is null and public.market_takes(o.market, o.currency)
     order by o.created_at desc
     limit 1;
    if v_user is null then raise exception 'no shopper with an order in their home market to check with'; end if;

    select m.code into v_other from public.markets m where m.code <> v_mkt order by m.code limit 1;
    if v_other is null then raise exception 'there is only one market, so a shopper cannot have moved'; end if;

    select p.id, p.name, p.partner_id, coalesce(p.seller, 'Seller') as seller, pr.id as seller_uid into v_dev
      from public.products p
      join public.profiles pr on pr.persona = 'partner' and pr.partner_id = p.partner_id
      left join public.categories c on c.id = p.category_id
     where p.fulfil = 'shipped'
       and concat_ws(' ', c.id, c.name, p.sub_category, p.name) !~* '\m(e-?)?sims?\M'
     order by p.id, pr.id
     limit 1;
    if not found then raise exception 'no seller''s shipped product to check a seller''s move with'; end if;
    v_seller := v_dev.seller_uid;

    select pr.id into v_op
      from public.profiles pr join auth.users u on u.id = pr.id
     where pr.persona = 'operator'
     order by (lower(u.email) = 'anika.sharma@aventa.com') desc, pr.id
     limit 1;
    if v_op is null then raise exception 'no operator to check with'; end if;

    select ea.id into v_biz from public.enterprise_accounts ea order by ea.id limit 1;
    if v_biz is null then raise exception 'no business account to fault the rescore with'; end if;

    insert into public.orders
      (id, order_ref, status, total, subtotal, tax, discount, payment_method, buyer_name,
       created_at, placed_date, seller, vertical, failed, stage, stages,
       user_id, account_id, currency, market, tax_rate, shipping_address, payment_ref)
    values
      (v_ap,      'ORD-SELFCHECK-OI-AP',  'awaiting_payment', 10, 10, 0, 0, 'card', 'Self-check',
       now(), to_char(current_date, 'DD Mon YYYY'), null, 'device', false, 0, v_stages,
       v_user, null, v_cur, v_mkt, v_taxr, jsonb_build_object('line1', 'Self-check'), null),
      (v_aps,     'ORD-SELFCHECK-OI-APS', 'awaiting_payment', 10, 10, 0, 0, 'card', 'Self-check',
       now(), to_char(current_date, 'DD Mon YYYY'), null, 'device', false, 0, v_stages,
       v_user, null, v_cur, v_mkt, v_taxr, jsonb_build_object('line1', 'Self-check'), null),
      (v_held,    'ORD-SELFCHECK-OI-H',   'held',             10, 10, 0, 0, 'card', 'Self-check',
       now(), to_char(current_date, 'DD Mon YYYY'), null, 'device', false, 0, v_stages,
       v_user, null, v_cur, v_mkt, v_taxr, jsonb_build_object('line1', 'Self-check'), null),
      (v_placed,  'ORD-SELFCHECK-OI-P',   'placed',           10, 10, 0, 0, 'card', 'Self-check',
       now(), to_char(current_date, 'DD Mon YYYY'), null, 'device', false, 0, v_stages,
       v_user, null, v_cur, v_mkt, v_taxr, jsonb_build_object('line1', 'Self-check'), null),
      (v_rel,     'ORD-SELFCHECK-OI-REL', 'held',             10, 10, 0, 0, 'card', 'Self-check',
       now(), to_char(current_date, 'DD Mon YYYY'), null, 'device', false, 0, v_stages,
       v_user, null, v_cur, v_mkt, v_taxr, jsonb_build_object('line1', 'Self-check'), null),
      /* Long before anything real: an earlier held order, and the order after it. */
      (v_eheld,   'ORD-SELFCHECK-OI-EH',  'held',             10, 10, 0, 0, 'card', 'Self-check',
       timestamptz '2000-01-01 00:00+00', '01 Jan 2000', null, 'device', false, 0, v_stages,
       v_user, null, v_cur, v_mkt, v_taxr, jsonb_build_object('line1', 'Self-check'), null),
      (v_first,   'ORD-SELFCHECK-OI-F',   'awaiting_payment', 10, 10, 0, 0, 'card', 'Self-check',
       timestamptz '2000-01-02 00:00+00', '02 Jan 2000', null, 'device', false, 0, v_stages,
       v_user, null, v_cur, v_mkt, v_taxr, jsonb_build_object('line1', 'Self-check'), null);

    insert into public.order_items (id, order_id, product_id, product_name, price, quantity, fulfil, status) values
      (gen_random_uuid(), v_ap,     v_dev.id, v_dev.name, 10, 1, 'shipped', 'placed'),
      (gen_random_uuid(), v_placed, v_dev.id, v_dev.name, 10, 1, 'shipped', 'placed');

    insert into public.order_risk (order_id, score, band, reasons, scored_at)
    values (v_aps, 0, 'low', '[]'::jsonb, now());

    insert into public.order_part (id, order_id, seller, partner_id, kind, state, sort_order)
    values ('PART-SELFCHECK-OI', v_placed, v_dev.seller, v_dev.partner_id, 'shipped', 'placed', 0);
    select o.total into v_total from public.orders o where o.id = v_placed;

    /* ---- 1 and 2: the shopper, through the policies ---- */
    perform set_config('request.jwt.claims', json_build_object('sub', v_user, 'role', 'authenticated')::text, true);
    set local role authenticated;

    select count(*) into v_n from public.orders o where o.id in (v_ap, v_aps, v_held, v_placed);
    if v_n <> 4 then
      reset role;
      raise exception 'the shopper reads % of their 4 self-check orders, so the refusals below prove nothing', v_n;
    end if;

    update public.orders o set status = 'cancelled', total = 1 where o.id = v_placed;
    get diagnostics v_n = row_count;
    if v_n <> 0 then reset role; raise exception 'a shopper updated their own order'; end if;
    update public.order_items i set price = 1 where i.order_id = v_placed;
    get diagnostics v_n = row_count;
    if v_n <> 0 then reset role; raise exception 'a shopper updated a line of their own order'; end if;
    delete from public.order_items i where i.order_id = v_placed;
    get diagnostics v_n = row_count;
    if v_n <> 0 then reset role; raise exception 'a shopper removed a line of their own order'; end if;

    begin
      delete from public.orders o where o.id = v_placed;
      raise exception 'a shopper removed their own placed order';
    exception when raise_exception then
      if sqlerrm not like '%is a record of a purchase%' then reset role; raise; end if;
    end;
    begin
      delete from public.orders o where o.id = v_held;
      raise exception 'a shopper removed their own held order';
    exception when raise_exception then
      if sqlerrm not like '%is a record of a purchase%' then reset role; raise; end if;
    end;
    begin
      delete from public.orders o where o.id = v_aps;
      raise exception 'a shopper removed their own scored order';
    exception when raise_exception then
      if sqlerrm not like '%has checked it%' then reset role; raise; end if;
    end;

    delete from public.orders o where o.id = v_ap;
    get diagnostics v_n = row_count;
    reset role;
    if v_n <> 1 then raise exception 'a shopper could not remove their own unpaid order'; end if;

    perform set_config('request.jwt.claims', null, true);
    if exists (select 1 from public.order_items i where i.order_id = v_ap) then
      raise exception 'an unpaid order''s lines outlived it';
    end if;
    if (select o.status from public.orders o where o.id = v_placed) is distinct from 'placed'
       or (select o.total from public.orders o where o.id = v_placed) is distinct from v_total
       or (select count(*) from public.order_items i where i.order_id = v_placed and i.price = 10) <> 1
       or (select count(*) from public.orders o where o.id in (v_held, v_aps)) <> 2
       or not exists (select 1 from public.order_risk r where r.order_id = v_aps) then
      raise exception 'a refused shopper write changed something';
    end if;

    /* ---- 2b: an order is created unpaid, and only its buyer adds lines ---- */
    /* A product this shopper may buy, on a shelf they may buy from, not
       flagged in their basket; and an unpaid order that is somebody else's. */
    select p.id, p.name into v_shop
      from public.products p join public.categories c on c.id = p.category_id
     where p.status = 'live' and p.fulfil = 'shipped'
       and 'consumer' = any (c.shoppable_by) and 'consumer' = any (p.audiences)
       and not exists (select 1 from public.cart_items ci
                        where ci.user_id = v_user and ci.product_id = p.id and ci.stock_note is not null)
     order by p.id
     limit 1;
    if not found then raise exception 'no shipped product a shopper may buy, to check their lines with'; end if;

    insert into public.orders
      (id, order_ref, status, total, subtotal, tax, discount, payment_method, buyer_name,
       created_at, placed_date, seller, vertical, failed, stage, stages,
       user_id, account_id, currency, market, tax_rate, shipping_address, payment_ref)
    values
      (v_else, 'ORD-SELFCHECK-OI-ELSE', 'awaiting_payment', 10, 10, 0, 0, 'card', 'Self-check',
       now(), to_char(current_date, 'DD Mon YYYY'), null, 'device', false, 0, v_stages,
       v_op, null, v_cur, v_mkt, v_taxr, jsonb_build_object('line1', 'Self-check'), null);

    perform set_config('request.jwt.claims', json_build_object('sub', v_user, 'role', 'authenticated')::text, true);
    set local role authenticated;

    begin
      insert into public.orders
        (id, order_ref, status, total, subtotal, tax, discount, payment_method, buyer_name,
         seller, failed, stage, stages, user_id, currency, market, tax_rate, shipping_address)
      values
        (gen_random_uuid(), 'ORD-SELFCHECK-OI-PAIDBYNOBODY', 'placed', 10, 10, 0, 0, 'card', 'Self-check',
         null, false, 0, v_stages, v_user, v_cur, v_mkt, v_taxr, jsonb_build_object('line1', 'Self-check'));
      raise exception 'a shopper wrote a placed order with no payment behind it';
    exception when insufficient_privilege then
      null;
    end;

    begin
      insert into public.orders
        (id, order_ref, status, total, subtotal, tax, discount, payment_method, buyer_name,
         seller, failed, stage, stages, user_id, currency, market, tax_rate, shipping_address)
      values
        (v_new, 'ORD-SELFCHECK-OI-NEW', 'awaiting_payment', 10, 10, 0, 0, 'card', 'Self-check',
         null, false, 0, v_stages, v_user, v_cur, v_mkt, v_taxr, jsonb_build_object('line1', 'Self-check'));
    exception when others then
      reset role;
      raise exception 'a shopper could not write their own unpaid order: %', sqlerrm;
    end;

    begin
      insert into public.order_items (id, order_id, product_id, product_name, price, quantity, fulfil, status)
      values (gen_random_uuid(), v_new, v_shop.id, v_shop.name, 10, 1, 'shipped', 'placed');
    exception when others then
      reset role;
      raise exception 'a shopper could not add a line to their own unpaid order: %', sqlerrm;
    end;

    begin
      insert into public.order_items (id, order_id, product_id, product_name, price, quantity, fulfil, status)
      values (gen_random_uuid(), v_else, v_shop.id, v_shop.name, 10, 1, 'shipped', 'placed');
      raise exception 'a shopper added a line to somebody else''s order';
    exception when insufficient_privilege then
      null;
    end;

    begin
      insert into public.order_items (id, order_id, product_id, product_name, price, quantity, fulfil, status)
      values (gen_random_uuid(), v_placed, v_shop.id, v_shop.name, 10, 1, 'shipped', 'placed');
      raise exception 'a shopper added a line to their own placed order';
    exception when insufficient_privilege then
      null;
    end;
    reset role;

    perform set_config('request.jwt.claims', null, true);
    if (select count(*) from public.order_items i where i.order_id = v_new) <> 1
       or exists (select 1 from public.order_items i where i.order_id = v_else)
       or (select count(*) from public.order_items i where i.order_id = v_placed) <> 1
       or exists (select 1 from public.orders o where o.order_ref = 'ORD-SELFCHECK-OI-PAIDBYNOBODY') then
      raise exception 'a refused shopper insert wrote something, or an allowed one did not';
    end if;

    /* ---- the seller and the operator still move what is theirs ---- */
    perform set_config('request.jwt.claims', json_build_object('sub', v_seller, 'role', 'authenticated')::text, true);
    set local role authenticated;
    update public.order_part p set state = 'packed' where p.id = 'PART-SELFCHECK-OI';
    get diagnostics v_n = row_count;
    reset role;
    if v_n <> 1 then raise exception 'a seller could not move their own part'; end if;

    perform set_config('request.jwt.claims', json_build_object('sub', v_op, 'role', 'authenticated')::text, true);
    set local role authenticated;
    update public.orders o set stage = 1, status = 'processing' where o.id = v_placed;
    get diagnostics v_n = row_count;
    reset role;
    if v_n <> 1 or (select o.stage from public.orders o where o.id = v_placed) is distinct from 1 then
      raise exception 'the operator could not move an order a stage';
    end if;

    /* ---- 3: the shopper moves market, and a held order is still decided ---- */
    perform set_config('request.jwt.claims', null, true);
    update public.consumer_profile cp set market = v_other where cp.user_id = v_user;

    perform set_config('request.jwt.claims', json_build_object('sub', v_op, 'role', 'authenticated')::text, true);
    /* Without the decision, the guard still asks: the control. */
    begin
      update public.orders o set stage = 2 where o.id = v_placed;
      raise exception 'an order whose shopper moved market was moved without the guard asking';
    exception when raise_exception then
      if sqlerrm not like '%registered in%' then raise; end if;
    end;
    begin
      v_res := public.decide_held_order('ORD-SELFCHECK-OI-REL', 'release', 'Self-check: the buyer confirmed it.');
    exception when others then
      raise exception 'a held order whose shopper moved market could not be released: %', sqlerrm;
    end;
    if (select o.status from public.orders o where o.id = v_rel) is distinct from 'placed' then
      raise exception 'a held order whose shopper moved market could not be released (%)', v_res;
    end if;
    if coalesce(current_setting('aventa.risk_decision', true), '') = 'on' then
      raise exception 'deciding a held order left the flag on';
    end if;

    /* ---- 4: one bad account, and the rest are scored ---- */
    perform set_config('request.jwt.claims', null, true);
    create or replace function public.zz_selfcheck_oi_fault()
    returns trigger language plpgsql as $f$
    begin
      if new.kind = 'business' and new.id = current_setting('aventa.selfcheck_fault', true) then
        raise exception 'self-check fault on %', new.id;
      end if;
      return new;
    end $f$;
    create trigger zz_selfcheck_oi_fault
      before insert or update on public.account_risk
      for each row execute function public.zz_selfcheck_oi_fault();
    perform set_config('aventa.selfcheck_fault', v_biz, true);

    begin
      v_res := public.refresh_account_risk(current_date);
    exception when others then
      raise exception 'one bad account failed the rescore: %', sqlerrm;
    end;
    if (v_res ->> 'failed')::integer is distinct from 1
       or jsonb_array_length(v_res -> 'failures') <> 1
       or (v_res -> 'failures' -> 0 ->> 'kind') is distinct from 'business'
       or (v_res -> 'failures' -> 0 ->> 'id') is distinct from v_biz
       or (v_res -> 'failures' -> 0 ->> 'reason') not like 'self-check fault on%' then
      raise exception 'one bad account failed the rescore, or was not reported (%)', v_res;
    end if;
    select count(*) into v_n from public.enterprise_accounts;
    if (v_res ->> 'scored')::integer < v_n - 1 then
      raise exception 'one bad account failed the rescore: % scored, and there are % other businesses alone',
        v_res ->> 'scored', v_n - 1;
    end if;
    drop trigger zz_selfcheck_oi_fault on public.account_risk;
    drop function public.zz_selfcheck_oi_fault();
    perform set_config('aventa.selfcheck_fault', '', true);

    /* ---- 5: an earlier held order is not a purchase ---- */
    update public.risk_rules r set enabled = true, points = 10 where r.id = 'o-first-order';
    v_res := public.score_order(v_first);
    if not exists (select 1 from jsonb_array_elements(v_res -> 'reasons') x(value)
                    where x.value ->> 'rule' = 'o-first-order') then
      raise exception 'an earlier held order counted as an earlier purchase (%)', v_res;
    end if;
    /* The control: an earlier placed order is one. */
    insert into public.orders
      (id, order_ref, status, total, subtotal, tax, discount, payment_method, buyer_name,
       created_at, placed_date, seller, vertical, failed, stage, stages,
       user_id, account_id, currency, market, tax_rate, shipping_address, payment_ref)
    values
      (v_eplaced, 'ORD-SELFCHECK-OI-EP', 'placed', 10, 10, 0, 0, 'card', 'Self-check',
       timestamptz '2000-01-01 06:00+00', '01 Jan 2000', null, 'device', false, 0, v_stages,
       v_user, null, v_cur, v_mkt, v_taxr, jsonb_build_object('line1', 'Self-check'), null);
    v_res := public.score_order(v_first);
    if exists (select 1 from jsonb_array_elements(v_res -> 'reasons') x(value)
                where x.value ->> 'rule' = 'o-first-order') then
      raise exception 'an earlier placed order did not count, so the held check proves nothing (%)', v_res;
    end if;

    raise exception using errcode = 'ZZ999', message = 'rolling the order integrity check back';
  exception when sqlstate 'ZZ999' then
    null;
  end;

  /* The night, still ten jobs, dry-run and rolled back; the risk job now says
     how many accounts it could not score. */
  perform set_config('request.jwt.claims', null, true);
  begin
    dry := public.run_nightly(current_date);
    select l.result into v_risk from public.scheduled_job_log l where l.job = 'risk' order by l.id desc limit 1;
    raise exception using errcode = 'ZZ999', message = 'rolling the dry run back';
  exception when sqlstate 'ZZ999' then
    null;
  end;
  for j in select value from jsonb_array_elements(dry -> 'jobs') loop
    if not (j ->> 'ok')::boolean then
      raise exception 'A dry run of the nightly "%" job fails: %', j ->> 'job', j ->> 'error';
    end if;
  end loop;
  if jsonb_array_length(dry -> 'jobs') <> 10 then
    raise exception 'the dry run ran % jobs, not 10', jsonb_array_length(dry -> 'jobs');
  end if;
  if (dry -> 'jobs' -> 8 ->> 'job') is distinct from 'risk' then
    raise exception 'the ninth job of the night is %, not risk', dry -> 'jobs' -> 8 ->> 'job';
  end if;
  if v_risk is null or not (v_risk ? 'failed') or jsonb_typeof(v_risk -> 'failures') is distinct from 'array' then
    raise exception 'the risk job does not report the accounts it could not score (%)', v_risk;
  end if;
  if (v_risk ->> 'failed')::integer > 0 then
    raise notice 'The risk job could not score % accounts tonight: %', v_risk ->> 'failed', v_risk -> 'failures';
  end if;
end $$;

commit;
