/*
 * A bundle is bought whole.
 *
 * Spec 11, section 3 (docs/superpowers/specs/2026-11-13-loose-ends-ii-design.md,
 * decisions 3 to 8). The bundle edges spec 7 left open, closed in one place each:
 *
 *   1. A monthly bundle part renews at the bundle price for 12 months, then at
 *      the published price on the renewal date, never below the seller's
 *      floor. `subscriptions` gains `bundle_selection_id` and
 *      `bundle_price_until`; `subscription_renewal_price` decides the figure,
 *      and `renew_subscriptions` charges it and moves `subscriptions.price`
 *      once, when it switches.
 *
 *   2. A bundle bought in part is refused when the payment settles.
 *      `settle_payment_attempt` is the one place that sees all of a checkout's
 *      orders: on success, every bundle on them must be whole across this
 *      payment's orders and not already ordered on any other order that is not
 *      waiting to be paid. Otherwise the attempt is recorded failed, with the
 *      reason, and this payment's orders go. Nothing is charged. The
 *      basket-completeness check in `guard_bundle_order_line`, and the residual
 *      risk it accepted, are replaced by it.
 *
 *   3. An abandoned checkout no longer blocks the next one: a part on an
 *      unpaid order of another payment does not count as "already ordered",
 *      and `expire_stale_payments` joins the night (job `payments`).
 *
 *   4. Unused selections are deleted by the night (job `bundle selections`)
 *      once their price hold ended more than 7 days ago and nothing refers to
 *      them.
 *
 *   5. One selection, one live requisition: `z_one_requisition_per_selection`
 *      refuses a second requisition (pending or approved) for a selection.
 *
 *   6. `configure_bundle`: a business buyer may price in any currency its
 *      account's market takes. The default, and a shopper's rule, are unchanged.
 *
 *   7. The night has seven jobs.
 *
 * And the help article for the operator's Scheduled jobs screen (`op-jobs`).
 *
 * Idempotent, one transaction, self-check last.
 */

begin;

/* ===================================================== 1. subscriptions -- */

alter table public.subscriptions
  add column if not exists bundle_selection_id text references public.bundle_selections(id) on delete set null;
alter table public.subscriptions
  add column if not exists bundle_price_until date;

comment on column public.subscriptions.bundle_selection_id is
  'The configured bundle this subscription was bought as a part of. Null for every subscription bought on its own.';
comment on column public.subscriptions.bundle_price_until is
  'The day the bundle price stops: purchase plus 12 months. A renewal starting before it is charged the subscription''s price; one starting on or after it, the published price in the subscription''s currency, never below the seller''s floor. Null: the subscription''s price, always.';

/* What the cycle starting on `p_on` is charged. Read only; the caller writes. */
create or replace function public.subscription_renewal_price(p_sub public.subscriptions, p_on date)
returns numeric language plpgsql stable set search_path = public as $$
declare
  v_published numeric;
begin
  if p_sub.bundle_price_until is null or p_on < p_sub.bundle_price_until then
    return p_sub.price;
  end if;
  select round(greatest(pp.price, coalesce(pp.floor_price, 0)), 2) into v_published
    from public.product_prices pp
   where pp.product_id = p_sub.product_id and pp.currency = p_sub.currency;
  /* No published price in that currency: keep charging what was agreed rather
     than invent one. */
  return coalesce(v_published, p_sub.price);
end $$;

comment on function public.subscription_renewal_price(public.subscriptions, date) is
  'The price a renewal starting on p_on is charged: the subscription''s price before bundle_price_until, the published price (floored) from then on.';

revoke all on function public.subscription_renewal_price(public.subscriptions, date) from public, anon, authenticated;

/* `renew_subscriptions`, copied from 20261112600000 (its latest definition).
   Changed only: the loop row is typed `public.subscriptions` so it can be
   handed to `subscription_renewal_price`; the charge is that price; the
   subscription's price follows it (once, when it switches); `repriced` is
   counted and reported. */
create or replace function public.renew_subscriptions(
  p_as_of date default current_date, p_actor text default 'Renewal scheduler')
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  s        public.subscriptions;
  months   integer;
  p_start  date;
  p_end    date;
  vendor   text;
  vname    text;
  charged  integer := 0;
  already  integer := 0;
  rolled   integer := 0;
  repriced integer := 0;
  skips    jsonb := '[]'::jsonb;
  waits    jsonb := '[]'::jsonb;
  new_id   text;
  v_amount numeric;
begin
  if public.current_persona() is distinct from 'operator' and not public.is_scheduler() then
    raise exception 'Only the marketplace runs renewals.';
  end if;

  if p_as_of > current_date then
    raise exception
      'A renewal run cannot be dated %. A period that has not started has not been used, and charging for it is charging for nothing.',
      p_as_of;
  end if;

  for s in
    select * from public.subscriptions
     where status = 'active' and next_renewal is not null and next_renewal <= p_as_of
     order by next_renewal, ref
  loop
    months := public.cycle_length(s.cycle);

    /* A subscription that ends before its next renewal does not renew. It ends,
       and saying so is better than charging somebody for a cycle they had
       already cancelled out of. Before the ownership question, because a lapsed
       subscription is nobody's to renew. */
    if s.ends_at is not null and s.ends_at <= s.next_renewal then
      skips := skips || jsonb_build_object(
        'ref', s.ref, 'product', s.product_name, 'reason',
        format('Ends on %s, before the renewal on %s. Nothing renewed and nothing charged.',
               s.ends_at, s.next_renewal));
      continue;
    end if;

    if not s.auto_renew then
      skips := skips || jsonb_build_object(
        'ref', s.ref, 'product', s.product_name, 'reason',
        format('Auto-renew is off. It lapses on %s rather than renewing, and the customer has to take it again.',
               s.next_renewal));
      continue;
    end if;

    /* Not ours to renew. */
    vendor := public.renewal_vendor(s.product_id);
    if vendor is not null then
      select name into vname from public.partners where id = vendor;
      waits := waits || jsonb_build_object(
        'ref', s.ref, 'product', s.product_name,
        'vendor_id', vendor, 'vendor', coalesce(vname, vendor),
        'due', s.next_renewal, 'days_late', (p_as_of - s.next_renewal),
        'reason', format(
          '%s renews this one and has not reported the cycle due on %s. The marketplace does not roll a date it does not own — chase the vendor.',
          coalesce(vname, vendor), s.next_renewal));
      continue;
    end if;

    /* The cycle that starts on the renewal date. */
    p_start := s.next_renewal;
    p_end   := (p_start + make_interval(months => months) - interval '1 day')::date;
    new_id  := format('SC-%s-%s', s.ref, to_char(p_start, 'YYYYMM'));

    /* A bundle part keeps the bundle price for its 12 months, then the
       published price. Everything else: its own price, as before. */
    v_amount := public.subscription_renewal_price(s, p_start);

    insert into public.subscription_charge
      (id, subscription_id, ref, user_id, product_id, product_name, seller,
       period_start, period_end, period_label, amount, currency, source)
    values
      (new_id, s.id, s.ref, s.user_id, s.product_id, s.product_name, s.seller,
       p_start, p_end, to_char(p_start, 'Mon YYYY'), v_amount, s.currency, 'marketplace')
    on conflict (subscription_id, period_start) do nothing;

    if found then charged := charged + 1; else already := already + 1; end if;

    /* Forward by whole cycles from the agreed date, so somebody billed on the
       9th stays on the 9th. "Today plus a month" would walk the billing day
       every time a run was late. */
    while p_start < p_as_of or p_start = s.next_renewal loop
      p_start := (p_start + make_interval(months => months))::date;
      exit when p_start > p_as_of;
    end loop;

    if v_amount is distinct from s.price then
      repriced := repriced + 1;
    end if;
    update public.subscriptions set next_renewal = p_start, price = v_amount where id = s.id;
    rolled := rolled + 1;
  end loop;

  return jsonb_build_object(
    'ran_on', p_as_of, 'ran_by', p_actor,
    'charged', charged, 'already', already, 'rolled', rolled, 'repriced', repriced,
    'skipped', skips, 'awaiting', waits);
end $$;

revoke all on function public.renew_subscriptions(date, text) from public;
grant execute on function public.renew_subscriptions(date, text) to authenticated;

/* ================================================= 2. the order line guard -- */

/**
 * `guard_bundle_order_line`, copied from 20261105200000 (its only definition).
 * Changed only: the order's `payment_ref` is read, "already ordered" ignores a
 * part on an unpaid (`awaiting_payment`) order of another payment, and the
 * shopper's basket-completeness block is gone: whether a bundle was bought
 * whole is decided when the payment settles (`settle_payment_attempt`).
 *
 * Only acts when `bundle_selection_id` is set. The order belongs to the
 * selection's owner (the account for a business order, the shopper
 * otherwise) and is in the selection's money; the line is one of its
 * products at its quantity and unit price. A shopper's order is the moment of
 * purchase, so it must also be inside the seven days with every part on sale.
 * A business order comes from an approved requisition, whose lines were held
 * to the same when it was raised; refusing it now would make the approval one
 * nobody can act on.
 */
create or replace function public.guard_bundle_order_line() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_s    bundle_selections;
  v_l    bundle_selection_lines;
  v_o    record;
  v_gone text;
begin
  if current_persona() is null then return new; end if;
  /* Detaching is refused, except the foreign key's own `set null` once the
     selection itself has been deleted (`operator_delete_bundle_selections`). */
  if tg_op = 'UPDATE' and old.bundle_selection_id is not null
     and new.bundle_selection_id is distinct from old.bundle_selection_id
     and exists (select 1 from bundle_selections x where x.id = old.bundle_selection_id) then
    raise exception 'A part of a bundle stays part of it.';
  end if;
  if new.bundle_selection_id is null then return new; end if;
  if tg_op = 'UPDATE'
     and new.bundle_selection_id is not distinct from old.bundle_selection_id
     and new.order_id is not distinct from old.order_id
     and new.product_id is not distinct from old.product_id
     and new.quantity is not distinct from old.quantity
     and new.price is not distinct from old.price then
    return new;
  end if;

  select * into v_s from bundle_selections where id = new.bundle_selection_id;
  if v_s.id is null then
    raise exception 'There is no configured bundle %.', new.bundle_selection_id;
  end if;
  select o.id, o.user_id, o.account_id, o.currency, o.payment_ref into v_o from orders o where o.id = new.order_id;
  if v_o.id is null then
    raise exception 'There is no order %.', new.order_id;
  end if;
  if v_o.account_id is not null then
    if v_s.account_id is distinct from v_o.account_id then
      raise exception 'That bundle was configured for another account.';
    end if;
  elsif v_s.user_id is null or v_s.user_id is distinct from v_o.user_id then
    raise exception 'That bundle was configured by somebody else, so it cannot be on this order.';
  end if;
  if v_s.currency is distinct from v_o.currency then
    raise exception 'That bundle is priced in % and this order is in %.', v_s.currency, coalesce(v_o.currency, 'no currency');
  end if;
  select * into v_l from bundle_selection_lines where selection_id = v_s.id and product_id = new.product_id;
  if v_l.id is null then
    raise exception '% is not part of that bundle.', coalesce(new.product_name, new.product_id);
  end if;
  if new.quantity is distinct from v_l.quantity then
    raise exception 'That bundle has % of %, not %.', v_l.quantity, v_l.name, new.quantity;
  end if;
  if new.price is distinct from v_l.unit_price then
    raise exception '% is priced at % in that bundle, not %.', v_l.name, v_l.unit_price, new.price;
  end if;
  /* Each part of a selection is bought once. Without this, a request written
     by hand could order the discounted part again and again, at the bundle's
     price, for as long as the selection's price is held. The selection row is
     locked first so two orders placed at the same moment are counted one after
     the other. An order undone after a failed payment takes its items with it,
     so a retry is not refused; and a part on an unpaid order of another
     payment (a checkout abandoned at the provider) does not count either. The
     settle step refuses whichever of two such payments is not whole. */
  perform 1 from bundle_selections where id = v_s.id for update;
  if exists (select 1 from order_items oi
               join orders o2 on o2.id = oi.order_id
              where oi.bundle_selection_id = v_s.id
                and oi.product_id = new.product_id
                and oi.id is distinct from new.id
                and not (o2.status = 'awaiting_payment'
                         and o2.payment_ref is distinct from v_o.payment_ref)) then
    raise exception '% from that bundle has already been ordered. Configure the bundle again to buy it again.', v_l.name;
  end if;
  if v_o.account_id is null then
    if v_s.valid_until < now() then
      raise exception 'The price of that bundle was held until %. Re-price it before checking out.',
        to_char(v_s.valid_until, 'DD Mon YYYY');
    end if;
    v_gone := bundle_part_unavailable(v_s.id, v_s.currency);
    if v_gone is not null then
      raise exception '% is no longer available as it was configured, so the bundle cannot be bought. Edit the bundle to continue.', v_gone;
    end if;
    /* Bought whole, for a shopper: checked once, when the payment settles
       (`settle_payment_attempt`), across all of that payment's orders. */
  end if;
  return new;
end $$;

drop trigger if exists order_items_bundle_guard on public.order_items;
create trigger order_items_bundle_guard before insert or update on public.order_items
  for each row execute function public.guard_bundle_order_line();

/* ================================================== 3. settling a payment -- */

/* `settle_payment_attempt`, copied from 20260807330000 (its latest
   definition). Changed only: on `succeeded` for an order, before the orders
   move to `placed`, every bundle on this payment's orders must be whole across
   them and not already ordered elsewhere. If one is not, the attempt is
   recorded `failed` with the reason, this payment's unpaid orders (their items,
   and the subscriptions checkout wrote for them that have never been charged)
   are deleted, and the answer has the same shape as any other failed
   settlement. Same signature, so the grant is unchanged. */
create or replace function public.settle_payment_attempt(
  p_attempt text, p_outcome text,
  p_instrument text default null, p_gateway_ref text default null, p_reason text default null,
  /* What the financier came back with. Null on every method that is not
     financing; required on one that is, and refused below rather than by a
     constraint the client cannot read. */
  p_tenure integer default null, p_instalment numeric default null, p_financier text default null
) returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare
  a          payment_attempts%rowtype;
  w          wallets%rowtype;
  m          payment_methods%rowtype;
  mine       boolean;
  led        text;
  ceiling    numeric;
  n_orders   integer;
  v_broken   text;
  v_why      text := 'A bundle was not bought whole, so nothing was charged.';
  v_refs     text[];
begin
  if p_outcome not in ('succeeded', 'failed', 'cancelled', 'expired') then
    raise exception 'A payment is not %.', p_outcome;
  end if;

  select * into a from payment_attempts where id = p_attempt for update;
  if not found then
    raise exception 'There is no payment %.', p_attempt;
  end if;

  select * into m from payment_methods where id = a.method_id;

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

  /* A financier that approved somebody has to say on what. Refused here, in
     words, rather than leaving the trigger to raise a constraint message at a
     customer who is looking at a confirmation screen. */
  if p_outcome = 'succeeded' and m.financed and p_tenure is null then
    raise exception
      '% came back approved without saying over how long. A plan with no tenure cannot be put on an order.',
      m.label;
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
    /* Bought whole. A shopper's bundle arrives as one order per seller, so no
       single order can hold it; this payment's orders together must. Each
       selection on them is locked first, so two payments for the same bundle
       settle one after the other and the second sees the first's orders. */
    perform 1 from bundle_selections bs
     where bs.id in (select oi.bundle_selection_id
                       from order_items oi join orders o on o.id = oi.order_id
                      where o.payment_ref = a.reference and o.status = 'awaiting_payment'
                        and oi.bundle_selection_id is not null)
     order by bs.id
       for update;

    select string_agg(distinct t.name, ', ') into v_broken
      from bundle_selections bs
      join bundle_templates t on t.id = bs.template_id
     where bs.id in (select oi.bundle_selection_id
                       from order_items oi join orders o on o.id = oi.order_id
                      where o.payment_ref = a.reference and o.status = 'awaiting_payment'
                        and oi.bundle_selection_id is not null)
       and (
         /* A part that is not on this payment's orders, at its quantity. */
         exists (select 1 from bundle_selection_lines l
                  where l.selection_id = bs.id
                    and not exists (select 1 from order_items oi join orders o on o.id = oi.order_id
                                     where o.payment_ref = a.reference and o.status = 'awaiting_payment'
                                       and oi.bundle_selection_id = bs.id
                                       and oi.product_id = l.product_id
                                       and oi.quantity = l.quantity))
         /* Or a part already ordered on an order that is not waiting to be paid. */
         or exists (select 1 from order_items oi join orders o on o.id = oi.order_id
                     where oi.bundle_selection_id = bs.id
                       and o.status <> 'awaiting_payment'));

    if v_broken is not null then
      update payment_attempts
         set state = 'failed', decided_at = now(),
             gateway_ref = coalesce(p_gateway_ref, gateway_ref),
             instrument = coalesce(p_instrument, instrument),
             failure_reason = v_why
       where id = a.id;

      select array_agg(o.order_ref) into v_refs
        from orders o
       where o.payment_ref = a.reference and o.status = 'awaiting_payment';

      /* Nothing was charged, so there is nothing to keep: as
         `expire_stale_payments` does for a payment nobody answered. */
      delete from order_items oi
       using orders o
       where oi.order_id = o.id
         and o.payment_ref = a.reference
         and o.status = 'awaiting_payment';

      delete from orders
       where payment_ref = a.reference
         and status = 'awaiting_payment';

      /* Checkout writes a monthly part's subscription with its order. One that
         has never been charged goes with the order, or it would renew a
         purchase that did not happen, and block the retry as a duplicate. */
      if v_refs is not null then
        delete from subscriptions sb
         where sb.ref = any(v_refs)
           and sb.user_id is not distinct from a.user_id
           and not exists (select 1 from subscription_charge c where c.subscription_id = sb.id);
      end if;

      return jsonb_build_object('already', false, 'state', 'failed', 'reference', a.reference,
        'note', v_why, 'reason', v_why, 'bundles', v_broken);
    end if;

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
           instrument = coalesce(p_instrument, instrument),
           tenure_months = p_tenure,
           /* Divided here only where the financier did not say. A plan that
              carries interest states its own instalment, and computing one
              would under-report what the customer agreed to. */
           instalment = case when p_tenure is null then null
                             else coalesce(p_instalment, round(a.amount / p_tenure, 2)) end,
           financier = p_financier
     where id = a.id;

    return jsonb_build_object('already', false, 'state', 'succeeded',
                              'reference', a.reference, 'orders', n_orders,
                              'tenure_months', p_tenure);
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
end $function$;

grant execute on function public.settle_payment_attempt(text,text,text,text,text,integer,numeric,text)
  to authenticated;

/* ===================================== 4. one selection, one requisition -- */

/* A selection may be on one requisition that is still live: pending or
   approved (`enterprise_requisitions.state`; the others are declined and
   withdrawn). A second would be the approval nobody can act on, because the
   first one's order has already taken the parts. Checked on every write,
   whoever writes it: it is a fact about the data. */
create or replace function public.guard_one_requisition_per_selection() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_other text;
  v_state text;
begin
  if new.bundle_selection_id is null then return new; end if;
  if tg_op = 'UPDATE'
     and new.bundle_selection_id is not distinct from old.bundle_selection_id
     and new.requisition_id is not distinct from old.requisition_id then
    return new;
  end if;

  /* Two requisitions raised at once are counted one after the other. */
  perform 1 from public.bundle_selections where id = new.bundle_selection_id for update;

  select r.id, r.state into v_other, v_state
    from public.enterprise_requisition_lines l
    join public.enterprise_requisitions r on r.id = l.requisition_id
   where l.bundle_selection_id = new.bundle_selection_id
     and l.requisition_id is distinct from new.requisition_id
     and r.state not in ('declined', 'withdrawn')
   order by r.id
   limit 1;

  if v_other is not null then
    raise exception 'That bundle is already on requisition %, which is %. A configured bundle goes on one requisition; configure it again to raise another.',
      v_other, v_state;
  end if;
  return new;
end $$;

revoke all on function public.guard_one_requisition_per_selection() from public, anon, authenticated;

drop trigger if exists z_one_requisition_per_selection on public.enterprise_requisition_lines;
create trigger z_one_requisition_per_selection
  before insert or update on public.enterprise_requisition_lines
  for each row execute function public.guard_one_requisition_per_selection();

/* ====================================================== 5. configure_bundle -- */

/**
 * `configure_bundle`, copied from 20261105200000 (its only definition).
 * Changed only: a business buyer may pass any currency its account's market
 * takes (`market_currencies`), not only the account's own, so a bundle can
 * follow a requisition raised in a secondary currency. It is priced from that
 * currency's price book by `price_bundle`, as before. A shopper's rule, and
 * the signature the client calls (src/lib/bundleRepo.ts), are unchanged.
 *
 * Price a configuration and write it down for the caller, held seven days.
 * Returns the selection id. The owner comes from who is asking, never from
 * the client.
 */
create or replace function public.configure_bundle(p_template text, p_choices jsonb, p_currency text, p_quantity integer)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_persona text := current_persona();
  v_uid     uuid := auth.uid();
  v_account text;
  v_user    uuid;
  v_home    text;
  v_market  text;
  v_price   jsonb;
  v_id      text;
  v_now     timestamptz := now();
begin
  if v_persona = 'consumer' then
    if v_uid is null then
      raise exception 'Sign in to configure a bundle.';
    end if;
    select p.currency into v_home from consumer_profile p where p.user_id = v_uid order by p.id limit 1;
    if v_home is null then
      raise exception 'Your account has no home currency yet, so a bundle cannot be priced for you. Finish setting up your profile first.';
    end if;
    v_user := v_uid;
  elsif v_persona = 'enterprise' then
    v_account := current_account_id();
    if v_account is null or not exists (
         select 1 from enterprise_users u
          where u.user_id = v_uid and u.account_id = v_account and u.status = 'active') then
      raise exception 'You are not an active member of a business account, so you cannot configure a bundle on its behalf.';
    end if;
    select a.currency, a.market into v_home, v_market from enterprise_accounts a where a.id = v_account;
    if v_home is null then
      raise exception 'Your account has no currency, so a bundle cannot be priced for it.';
    end if;
  else
    raise exception 'Only a signed-in shopper or business buyer can configure a bundle.';
  end if;

  if p_currency is distinct from v_home
     and not (v_persona = 'enterprise'
              and exists (select 1 from market_currencies mc
                           where mc.market_code = v_market and mc.currency = p_currency)) then
    if v_persona = 'enterprise' then
      raise exception 'Your account''s market does not take %, so the bundle cannot be priced in it. Choose % or another currency your market takes.',
        coalesce(p_currency, 'nothing'), v_home;
    end if;
    raise exception 'Your account is kept in %, so the bundle is priced in %, not %.',
      v_home, v_home, coalesce(p_currency, 'nothing');
  end if;

  v_price := price_bundle(p_template, p_choices, p_currency, p_quantity);

  insert into bundle_selections (template_id, account_id, user_id, currency, choices, quantity,
                                 total, parts_total, priced_at, valid_until)
  values (p_template, v_account, v_user, p_currency, v_price -> 'choices', p_quantity,
          (v_price ->> 'total')::numeric, (v_price ->> 'parts_total')::numeric,
          v_now, v_now + interval '7 days')
  returning id into v_id;

  insert into bundle_selection_lines (selection_id, product_id, name, partner_id, seller, quantity,
                                      list_unit_price, unit_price, floor_unit_price, sort_order)
  select v_id, l ->> 'product_id', l ->> 'name', l ->> 'partner_id', l ->> 'seller',
         (l ->> 'quantity')::integer, (l ->> 'list_unit_price')::numeric,
         (l ->> 'unit_price')::numeric, (l ->> 'floor_unit_price')::numeric,
         (l ->> 'sort_order')::integer
    from jsonb_array_elements(v_price -> 'lines') l;

  return v_id;
end $$;

revoke all on function public.configure_bundle(text, jsonb, text, integer) from public, anon;
grant execute on function public.configure_bundle(text, jsonb, text, integer) to authenticated;

/* ================================================= 6. unused selections -- */

/* A selection whose price hold ended more than 7 days before `p_as_of` and
   that nothing refers to: no basket line, requisition line, order line or
   subscription. Nothing else ever removes one. Its lines go with it. */
create or replace function public.delete_unused_bundle_selections(p_as_of date default current_date)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  n_gone integer;
begin
  if public.current_persona() is distinct from 'operator' and not public.is_scheduler() then
    raise exception 'Only the schedule, or the marketplace, clears unused bundles.';
  end if;

  delete from public.bundle_selections bs
   where bs.valid_until < (p_as_of - 7)
     and not exists (select 1 from public.cart_items c where c.bundle_selection_id = bs.id)
     and not exists (select 1 from public.enterprise_requisition_lines l where l.bundle_selection_id = bs.id)
     and not exists (select 1 from public.order_items oi where oi.bundle_selection_id = bs.id)
     and not exists (select 1 from public.subscriptions sb where sb.bundle_selection_id = bs.id);
  get diagnostics n_gone = row_count;

  return jsonb_build_object('ran_on', p_as_of, 'deleted', n_gone);
end $$;

revoke all on function public.delete_unused_bundle_selections(date) from public, anon, authenticated;

/* ============================================================ 7. the night -- */

/* `run_nightly`, copied from 20261112700000 (its latest definition). Changed
   only: two jobs, `payments` (before the settlement run) and `bundle
   selections`, so seven. */
create or replace function public.run_nightly(p_as_of date default current_date)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  j    text;
  res  jsonb;
  err  text;
  t0   timestamptz;
  outs jsonb := '[]'::jsonb;
begin
  if public.current_persona() is distinct from 'operator' and not public.is_scheduler() then
    raise exception 'Only the schedule, or the marketplace, runs the night.';
  end if;

  foreach j in array array['agreements', 'enterprise subscriptions', 'subscriptions', 'documents', 'payments', 'bundle selections', 'settlements'] loop
    t0 := clock_timestamp(); res := null; err := null;
    begin
      res := case j
        when 'agreements'               then public.auto_renew_contracts(p_as_of, 'Nightly schedule')
        when 'enterprise subscriptions' then public.renew_enterprise_subscriptions(p_as_of, 'Nightly schedule')
        when 'subscriptions'            then public.renew_subscriptions(p_as_of, 'Nightly schedule')
        when 'documents'                then public.lapse_expired_documents(p_as_of)
        when 'payments'                 then jsonb_build_object('expired', public.expire_stale_payments())
        when 'bundle selections'        then public.delete_unused_bundle_selections(p_as_of)
        when 'settlements'              then public.settle_to_date(p_as_of)
      end;
    exception when others then
      err := format('%s (%s)', sqlerrm, sqlstate);
    end;
    insert into public.scheduled_job_log (job, ran_on, started_at, finished_at, ok, result, error)
    values (j, p_as_of, t0, clock_timestamp(), err is null, res, err);
    outs := outs || jsonb_build_object('job', j, 'ok', err is null, 'error', err);
  end loop;

  return jsonb_build_object('ran_on', p_as_of, 'jobs', outs);
end $$;

revoke all on function public.run_nightly(date) from public, anon, authenticated;

/* ================================================================= help === */

/* The operator's Scheduled jobs screen (`op-jobs`), seeded the way
   20261112100000 seeds `op-pricebooks`: the next KB-O number, once. */
do $$
declare
  v_op text;
  n_op int;
begin
  select coalesce(max(substring(id from '^KB-O(\d+)$')::int), 0) + 1 into n_op
    from kb_articles where id ~ '^KB-O\d+$';
  v_op := 'KB-O' || lpad(n_op::text, 2, '0');

  if not exists (select 1 from kb_articles where view = 'op-jobs') then
    insert into kb_articles
      (id, persona, kind, title, mins, updated, view, roles, tags, summary,
       body, status, sort_order, personas, audience_note, audience_ids)
    values (
      v_op, 'operator', 'howto', 'Scheduled jobs', 4, to_char(current_date, 'DD Mon YYYY'), 'op-jobs',
      array['OR-ADMIN'], array['schedule', 'renewals', 'settlement'],
      'What the marketplace does by itself every night, and how to tell whether it worked.',
      jsonb_build_array(
        jsonb_build_object('kind', 'prose', 'heading', 'What this screen shows',
          'text', 'Every night at 00:30 UTC (06:00 in India, 03:30 in Kenya) the marketplace runs seven jobs, one after the other. Each one is listed here for each night: whether it finished OK or failed, a short summary of what it did, and the error in full when it failed. A job that fails changes nothing, and the jobs after it still run.'),
        jsonb_build_object('kind', 'prose', 'heading', 'The seven jobs',
          'text', 'Agreements: an agreement with auto-renew on whose notice deadline has passed is renewed for a like term. Enterprise subscriptions: a business subscription renews for a year on its date, or ends there if auto-renew is off or it is suspended. Subscriptions: a shopper subscription the marketplace sells is charged for the cycle that starts and its date moves on; a bundle part keeps the bundle price for 12 months, then the published price. Documents: a seller document past its expiry stops counting as accepted. Payments: a payment nobody answered for 15 minutes expires, and the unpaid orders behind it are removed. Bundle selections: a priced bundle whose hold ended more than 7 days ago and that is on no basket, requisition or order is deleted. Settlements: every closed period not yet settled is settled, oldest first.'),
        jsonb_build_object('kind', 'prose', 'heading', 'Reading only',
          'text', 'Nothing on this screen changes anything; it is the record of what the night did. To run the night by hand, for example after fixing whatever made a job fail, open the SQL editor and run select public.run_nightly(); and come back here to see the result. Running it twice in a day is safe: each job only does what is still due.')
      ),
      'published', n_op, array['operator'], '', array[]::text[]);
  end if;
end $$;

/* ============================================================ self-check === */

do $$
declare
  dry     jsonb;
  j       jsonb;
  v_sub   public.subscriptions;
  v_pp    record;
  v_fp    record;
  v_got   numeric;
  v_hold  uuid;
  v_move  uuid;
  v_n     int;
  v_sig   text;
begin
  if not public.is_scheduler() then
    raise exception 'This session (%) is not one the schedule runs as, so the dry run below would be refused.', session_user;
  end if;

  /* The columns, functions and trigger. */
  select count(*) into v_n from information_schema.columns
   where table_schema = 'public' and table_name = 'subscriptions'
     and column_name in ('bundle_selection_id', 'bundle_price_until');
  if v_n <> 2 then raise exception 'subscriptions has % of its two bundle columns', v_n; end if;

  foreach v_sig in array array[
      'public.subscription_renewal_price(public.subscriptions,date)',
      'public.delete_unused_bundle_selections(date)',
      'public.guard_one_requisition_per_selection()',
      'public.run_nightly(date)', 'public.renew_subscriptions(date,text)',
      'public.guard_bundle_order_line()', 'public.configure_bundle(text,jsonb,text,integer)',
      'public.settle_payment_attempt(text,text,text,text,text,integer,numeric,text)'] loop
    if to_regprocedure(v_sig) is null then raise exception '% is missing', v_sig; end if;
  end loop;

  select count(*) into v_n from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname = 'settle_payment_attempt';
  if v_n <> 1 then raise exception 'there are % settle_payment_attempt functions', v_n; end if;
  select count(*) into v_n from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname = 'configure_bundle';
  if v_n <> 1 then raise exception 'there are % configure_bundle functions', v_n; end if;

  if not exists (select 1 from pg_trigger
                  where tgrelid = 'public.enterprise_requisition_lines'::regclass
                    and tgname = 'z_one_requisition_per_selection' and not tgisinternal) then
    raise exception 'z_one_requisition_per_selection is not on enterprise_requisition_lines';
  end if;

  /* What changed, changed. */
  if pg_get_functiondef('public.settle_payment_attempt(text,text,text,text,text,integer,numeric,text)'::regprocedure)
       not like '%A bundle was not bought whole, so nothing was charged.%' then
    raise exception 'settle_payment_attempt does not check a bundle is whole';
  end if;
  if pg_get_functiondef('public.guard_bundle_order_line()'::regprocedure) ilike '%residual risk%'
     or pg_get_functiondef('public.guard_bundle_order_line()'::regprocedure) like '%neither in the basket nor ordered%' then
    raise exception 'guard_bundle_order_line still checks the basket';
  end if;
  if pg_get_functiondef('public.renew_subscriptions(date,text)'::regprocedure)
       not like '%public.subscription_renewal_price(s, p_start)%' then
    raise exception 'renew_subscriptions does not use subscription_renewal_price';
  end if;

  /* Who may call what. The new functions are the database's own; configure_bundle
     and settle_payment_attempt stay the app's. */
  foreach v_sig in array array[
      'public.subscription_renewal_price(public.subscriptions,date)',
      'public.delete_unused_bundle_selections(date)',
      'public.guard_one_requisition_per_selection()',
      'public.run_nightly(date)'] loop
    if has_function_privilege('anon', v_sig, 'execute')
       or has_function_privilege('authenticated', v_sig, 'execute')
       or exists (select 1 from pg_proc p,
                         aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x
                   where p.oid = v_sig::regprocedure and x.grantee = 0 and x.privilege_type = 'EXECUTE') then
      raise exception '% is callable through the API', v_sig;
    end if;
  end loop;
  if not has_function_privilege('authenticated', 'public.configure_bundle(text,jsonb,text,integer)', 'execute') then
    raise exception 'configure_bundle is no longer callable by a signed-in buyer';
  end if;
  if has_function_privilege('anon', 'public.configure_bundle(text,jsonb,text,integer)', 'execute') then
    raise exception 'configure_bundle is callable without signing in';
  end if;
  if not has_function_privilege('authenticated',
       'public.settle_payment_attempt(text,text,text,text,text,integer,numeric,text)', 'execute') then
    raise exception 'settle_payment_attempt is no longer callable by a signed-in customer';
  end if;

  /* The help for the new screen. */
  select count(*) into v_n from kb_articles
   where view = 'op-jobs' and 'operator' = any(personas) and status = 'published'
     and body::text like '%run_nightly()%';
  if v_n <> 1 then raise exception 'the Scheduled jobs screen has % help articles, not 1', v_n; end if;

  /* The renewal price, on a subscription held in memory: the bundle price
     before bundle_price_until, the published price (floored) from that day. */
  select pp.product_id, pp.currency, round(greatest(pp.price, coalesce(pp.floor_price, 0)), 2) as published
    into v_pp
    from public.product_prices pp
   where pp.price > 0
   order by pp.product_id, pp.currency
   limit 1;
  if not found then raise exception 'no published price to check the renewal price against'; end if;

  v_sub.product_id := v_pp.product_id;
  v_sub.currency := v_pp.currency;
  v_sub.price := v_pp.published + 1;
  v_sub.bundle_price_until := current_date + 30;
  v_got := public.subscription_renewal_price(v_sub, current_date + 29);
  if v_got is distinct from v_pp.published + 1 then
    raise exception 'before bundle_price_until the renewal price is %, not the bundle price %', v_got, v_pp.published + 1;
  end if;
  v_got := public.subscription_renewal_price(v_sub, current_date + 30);
  if v_got is distinct from v_pp.published then
    raise exception 'on bundle_price_until the renewal price is %, not the published %', v_got, v_pp.published;
  end if;
  v_sub.bundle_price_until := null;
  v_got := public.subscription_renewal_price(v_sub, current_date + 400);
  if v_got is distinct from v_pp.published + 1 then
    raise exception 'a subscription that is not a bundle part renews at %, not its own price', v_got;
  end if;

  /* And through renew_subscriptions, rolled back: two temporary subscriptions
     to a product the marketplace renews itself, one whose bundle price ends
     today and one whose bundle price ends tomorrow. */
  begin
    select p.id as product_id, p.name, pp.currency,
           round(greatest(pp.price, coalesce(pp.floor_price, 0)), 2) as published
      into v_fp
      from public.products p
      join public.product_prices pp on pp.product_id = p.id
     where p.partner_id is null and pp.price > 0
     order by p.id, pp.currency
     limit 1;

    if found then
      insert into public.subscriptions
        (product_id, product_name, status, auto_renew, next_renewal, price, currency, ref, cycle,
         user_id, bundle_price_until)
      values
        (v_fp.product_id, v_fp.name, 'active', true, current_date, v_fp.published + 1, v_fp.currency,
         'SUB-SELFCHECK-MOVE', 'Monthly', null, current_date)
      returning id into v_move;
      insert into public.subscriptions
        (product_id, product_name, status, auto_renew, next_renewal, price, currency, ref, cycle,
         user_id, bundle_price_until)
      values
        (v_fp.product_id, v_fp.name, 'active', true, current_date, v_fp.published + 1, v_fp.currency,
         'SUB-SELFCHECK-HOLD', 'Monthly', null, current_date + 1)
      returning id into v_hold;

      perform public.renew_subscriptions(current_date, 'Self-check');

      select c.amount into v_got from public.subscription_charge c
       where c.subscription_id = v_move and c.period_start = current_date;
      if v_got is distinct from v_fp.published then
        raise exception 'a bundle part whose bundle price ended today was charged %, not the published %', v_got, v_fp.published;
      end if;
      select sb.price into v_got from public.subscriptions sb where sb.id = v_move;
      if v_got is distinct from v_fp.published then
        raise exception 'the subscription''s price did not move to the published % (it is %)', v_fp.published, v_got;
      end if;

      select c.amount into v_got from public.subscription_charge c
       where c.subscription_id = v_hold and c.period_start = current_date;
      if v_got is distinct from v_fp.published + 1 then
        raise exception 'a bundle part still inside its 12 months was charged %, not the bundle price %', v_got, v_fp.published + 1;
      end if;
      select sb.price into v_got from public.subscriptions sb where sb.id = v_hold;
      if v_got is distinct from v_fp.published + 1 then
        raise exception 'a bundle part still inside its 12 months had its price changed to %', v_got;
      end if;
    else
      raise notice 'No product the marketplace renews itself has a published price; the renewal run was checked only in memory.';
    end if;

    raise exception using errcode = 'ZZ999', message = 'rolling the renewal check back';
  exception when sqlstate 'ZZ999' then
    null;
  end;

  /* The night, now with seven jobs, dry-run and rolled back. */
  begin
    dry := public.run_nightly(current_date);
    raise exception using errcode = 'ZZ999', message = 'rolling the dry run back';
  exception when sqlstate 'ZZ999' then
    null;
  end;
  for j in select value from jsonb_array_elements(dry -> 'jobs') loop
    if not (j ->> 'ok')::boolean then
      raise exception 'A dry run of the nightly "%" job fails: %', j ->> 'job', j ->> 'error';
    end if;
  end loop;
  if jsonb_array_length(dry -> 'jobs') <> 7 then
    raise exception 'the dry run ran % jobs, not 7', jsonb_array_length(dry -> 'jobs');
  end if;
end $$;

commit;
