/*
 * Loose ends III: two answers made exact.
 *
 * Follows spec 11 (docs/superpowers/specs/2026-11-13-loose-ends-ii-design.md)
 * and the "Still open" list under it in docs/superpowers/backlog.md. Applies
 * after 20261113200000.
 *
 *   1. A bundle part renewed by its seller follows decision 3 as the
 *      marketplace's own run does: `report_renewal` (copied from
 *      20260810240000, its only definition) charges the cycle at
 *      `subscription_renewal_price` when the seller does not name an amount,
 *      and the subscription's price follows it. `vendor_renewal_book` (same
 *      file) shows the seller that price, not the bundle price after its 12
 *      months. A subscription that is not a bundle part is charged exactly as
 *      before (`subscription_renewal_price` returns its price).
 *
 *   2. `accept_basket_flag` (copied from 20261113200000) says whether it
 *      changed anything: `changed: false` and a note when the line had no
 *      flag, `changed: true` when it cleared one. Still answered, not
 *      refused, so a second click is harmless.
 *
 * Idempotent, one transaction, self-check last.
 */

begin;

/* =============================================== 1. a seller's renewal -- */

/* report_renewal, copied from 20260810240000. Changed only: the default
   amount is subscription_renewal_price, and the price follows it. */
create or replace function public.report_renewal(
  p_ref text, p_period_start date, p_vendor_ref text, p_amount numeric default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  s        public.subscriptions;
  vendor   text;
  vname    text;
  persona  text := public.current_persona();
  mine     text := public.current_partner_id();
  months   integer;
  p_end    date;
  amount   numeric;
  new_id   text;
  actor    text;
begin
  select * into s from public.subscriptions where ref = p_ref;
  if s.ref is null then raise exception 'There is no subscription %.', p_ref; end if;

  vendor := public.renewal_vendor(s.product_id);
  if vendor is null then
    raise exception
      '% is sold by the marketplace, so there is no vendor renewal to report. The renewal run raises it.',
      p_ref;
  end if;
  select name into vname from public.partners where id = vendor;

  if persona = 'partner' then
    if mine is distinct from vendor then
      raise exception '% is renewed by %, not by you.', p_ref, coalesce(vname, vendor);
    end if;
    actor := coalesce(vname, vendor);
  elsif persona = 'operator' then
    actor := format('Operator, on behalf of %s', coalesce(vname, vendor));
  else
    raise exception 'Only the seller who renews a subscription, or the marketplace on their behalf, may report a renewal.';
  end if;

  /* Before anything about whether this cycle is due: a report we already hold is
     a retry, and a retry is answered rather than refused. Asked after the due
     check it would never be reached — the first report moves the date, so the
     second one arrives about a cycle that is no longer due and would come back
     as an error to a vendor who had done nothing wrong. */
  if exists (select 1 from public.subscription_charge
              where subscription_id = s.id and period_start = p_period_start) then
    return jsonb_build_object('ok', true, 'already', true, 'ref', p_ref,
      'period', p_period_start, 'renews_next', s.next_renewal,
      'note', 'This cycle was already reported. Nothing was raised twice and the date did not move again.');
  end if;

  if s.status <> 'active' then
    raise exception '% is %, so nothing renewed.', p_ref, s.status;
  end if;
  if not s.auto_renew then
    raise exception
      'Auto-renew is off on %. It lapses on % rather than renewing, and a renewal reported against it would contradict what the customer was told.',
      p_ref, s.next_renewal;
  end if;
  if s.ends_at is not null and s.ends_at <= s.next_renewal then
    raise exception '% ends on %, before the renewal on %. Nothing renewed.', p_ref, s.ends_at, s.next_renewal;
  end if;
  if p_period_start > current_date then
    raise exception
      'A renewal cannot be reported for a cycle starting %. A period that has not started has not been used, and charging for it is charging for nothing.',
      p_period_start;
  end if;
  /* The cycle that is due, not whichever one the caller names. Reporting out of
     order would leave a gap nothing would ever chase. */
  if p_period_start is distinct from s.next_renewal then
    raise exception 'The cycle due on % is the one to report for %, not %.',
      s.next_renewal, p_ref, p_period_start;
  end if;

  /* A vendor who says what they charged is taken at their word. Otherwise the
     price this cycle is charged at: for a bundle part, the bundle price for
     its 12 months and the published price (floored) after, as the
     marketplace's own run charges it. */
  amount := round(coalesce(p_amount, public.subscription_renewal_price(s, p_period_start)), 2);
  if amount < 0 then
    raise exception 'A renewal of % cannot be a negative amount. Reverse it with a credit note.', p_ref;
  end if;

  months := public.cycle_length(s.cycle);
  p_end  := (p_period_start + make_interval(months => months) - interval '1 day')::date;
  new_id := format('SC-%s-%s', s.ref, to_char(p_period_start, 'YYYYMM'));

  insert into public.subscription_charge
    (id, subscription_id, ref, user_id, product_id, product_name, seller,
     period_start, period_end, period_label, amount, currency,
     source, vendor_id, vendor_ref, reported_by, reported_at)
  values
    (new_id, s.id, s.ref, s.user_id, s.product_id, s.product_name, s.seller,
     p_period_start, p_end, to_char(p_period_start, 'Mon YYYY'), amount, s.currency,
     'vendor', vendor, p_vendor_ref, actor, now())
  on conflict (subscription_id, period_start) do nothing;

  if not found then
    return jsonb_build_object('ok', true, 'already', true, 'ref', p_ref,
      'period', p_period_start, 'note', 'This cycle was already reported. Nothing was raised twice.');
  end if;

  /* One report, one cycle. */
  update public.subscriptions
     set next_renewal = (p_period_start + make_interval(months => months))::date,
         price = case when p_amount is null then amount else price end
   where id = s.id;

  return jsonb_build_object(
    'ok', true, 'already', false, 'ref', p_ref, 'vendor', coalesce(vname, vendor),
    'reported_by', actor, 'period', p_period_start, 'period_end', p_end,
    'amount', amount, 'currency', s.currency,
    'renews_next', (p_period_start + make_interval(months => months))::date);
end $$;

revoke all on function public.report_renewal(text, date, text, numeric) from public;
grant execute on function public.report_renewal(text, date, text, numeric) to authenticated;

/* vendor_renewal_book, copied from 20260810240000. Changed only: the price
   column is the price the due cycle is charged at. */
create or replace function public.vendor_renewal_book(
  p_partner text default null, p_as_of date default current_date)
returns table (
  ref text, product_id text, product_name text, cycle text,
  price numeric, currency text, due date, days_late integer,
  reported boolean, last_reported date, vendor_ref text)
language plpgsql security definer set search_path = public as $$
declare who text;
begin
  if public.current_persona() = 'partner' then
    who := public.current_partner_id();
  elsif public.current_persona() = 'operator' then
    who := p_partner;
    if who is null then raise exception 'Which seller''s book?'; end if;
  else
    raise exception 'A renewal book belongs to the seller who maintains it.';
  end if;
  if who is null then raise exception 'You are not signed in as a seller.'; end if;

  return query
    select s.ref, s.product_id, s.product_name, s.cycle,
           public.subscription_renewal_price(s, s.next_renewal), s.currency,
           s.next_renewal,
           greatest(0, (p_as_of - s.next_renewal))::integer,
           c.id is not null,
           last.period_start,
           last.vendor_ref
      from public.subscriptions s
      left join public.subscription_charge c
             on c.subscription_id = s.id and c.period_start = s.next_renewal
      left join lateral (
             select x.period_start, x.vendor_ref from public.subscription_charge x
              where x.subscription_id = s.id
              order by x.period_start desc limit 1) last on true
     where s.status = 'active'
       and s.next_renewal is not null
       and public.renewal_vendor(s.product_id) = who
     order by s.next_renewal, s.ref;
end $$;

revoke all on function public.vendor_renewal_book(text, date) from public;
grant execute on function public.vendor_renewal_book(text, date) to authenticated;

/* ========================================== 2. accepting a stock flag -- */

/* accept_basket_flag, copied from 20261113200000. Changed only: `changed`
   in the answer, and a note when there was nothing to accept. */
create or replace function public.accept_basket_flag(p_kind text, p_line_id text)
returns jsonb language plpgsql security definer set search_path = public as $$
<<ac>>
declare
  v_uid     uuid := auth.uid();
  v_product text;
  v_qty     integer;
  v_note    text;
  v_bundle  boolean;
  v_basket  text;
  v_name    text;
  v_flag    jsonb;
begin
  if v_uid is null then
    raise exception 'Sign in to change your basket.';
  end if;

  if p_kind = 'cart' then
    if public.current_persona() is distinct from 'consumer' then
      raise exception 'Only a shopper has a shopping basket.';
    end if;
    select c.product_id, c.quantity, c.stock_note, c.bundle_selection_id is not null
      into v_product, v_qty, v_note, v_bundle
      from public.cart_items c
     where c.id::text = p_line_id and c.user_id = v_uid
       for update;
    if not found then
      raise exception 'That line is not in your basket.';
    end if;
  elsif p_kind = 'requisition' then
    if public.current_persona() is distinct from 'enterprise' then
      raise exception 'Only a business buyer has a requisition basket.';
    end if;
    select l.product_id, l.quantity, l.stock_note, l.bundle_selection_id is not null, l.basket_id
      into v_product, v_qty, v_note, v_bundle, v_basket
      from public.requisition_basket_lines l
      join public.requisition_baskets b on b.id = l.basket_id
     where l.id = p_line_id and b.user_id = v_uid
       for update of l;
    if not found then
      raise exception 'That line is not in your requisition basket.';
    end if;
  else
    raise exception 'A basket is a cart or a requisition basket, not %.', coalesce(p_kind, 'nothing');
  end if;

  /* Nothing to accept: answered, not refused (a second click, or a flag the
     buyer already cleared on another device), and said so. */
  if v_note is null then
    return jsonb_build_object('kind', p_kind, 'line_id', p_line_id, 'quantity', v_qty, 'accepted', true,
                              'changed', false, 'note', 'This line had no stock note to accept.');
  end if;

  v_flag := public.basket_line_stock_flag(v_product, v_qty, v_bundle, null);
  if v_flag is not null then
    select p.name into v_name from public.products p where p.id = v_product;
    if v_flag ->> 'note' = 'No longer available' then
      raise exception '% is no longer available. Remove it from your basket.', coalesce(v_name, v_product);
    end if;
    if v_bundle then
      raise exception '% does not have enough left for this bundle (%). Remove the bundle instead.',
        coalesce(v_name, v_product), v_flag ->> 'note';
    end if;
    raise exception '% has less left than this line asks for (%). Remove it, or lower the quantity.',
      coalesce(v_name, v_product), v_flag ->> 'note';
  end if;

  if p_kind = 'cart' then
    update public.cart_items c
       set stock_note = null, was_quantity = null, flagged_at = null
     where c.id::text = p_line_id;
  else
    update public.requisition_basket_lines l
       set stock_note = null, was_quantity = null, flagged_at = null
     where l.id = p_line_id;
    update public.requisition_baskets b set updated_at = now() where b.id = v_basket;
  end if;

  return jsonb_build_object('kind', p_kind, 'line_id', p_line_id, 'quantity', v_qty, 'accepted', true,
                            'changed', true);
end $$;

revoke all on function public.accept_basket_flag(text, text) from public, anon;
grant execute on function public.accept_basket_flag(text, text) to authenticated;

/* ============================================================ self-check === */

do $$
<<chk>>
declare
  v_def  text;
  v_sub  public.subscriptions;
  v_got  numeric;
  v_pub  numeric;
begin
  v_def := pg_get_functiondef('public.report_renewal(text,date,text,numeric)'::regprocedure);
  if v_def not like '%subscription_renewal_price(s, p_period_start)%' then
    raise exception 'report_renewal does not charge a bundle part at its renewal price';
  end if;
  if v_def not like '%price = case when p_amount is null then amount else price end%' then
    raise exception 'report_renewal does not move the subscription''s price with the charge';
  end if;
  if pg_get_functiondef('public.vendor_renewal_book(text,date)'::regprocedure)
       not like '%subscription_renewal_price(s, s.next_renewal)%' then
    raise exception 'vendor_renewal_book shows the seller a price it will not be charged at';
  end if;
  v_def := pg_get_functiondef('public.accept_basket_flag(text,text)'::regprocedure);
  if v_def not like '%''changed'', false%' or v_def not like '%''changed'', true%' then
    raise exception 'accept_basket_flag does not say whether it changed anything';
  end if;

  /* Who may call what, unchanged. */
  if not has_function_privilege('authenticated', 'public.report_renewal(text,date,text,numeric)', 'execute')
     or not has_function_privilege('authenticated', 'public.vendor_renewal_book(text,date)', 'execute')
     or not has_function_privilege('authenticated', 'public.accept_basket_flag(text,text)', 'execute') then
    raise exception 'a signed-in user can no longer call a function they could before';
  end if;
  if has_function_privilege('anon', 'public.accept_basket_flag(text,text)', 'execute') then
    raise exception 'accept_basket_flag is callable without signing in';
  end if;

  /* The price rule the seller's report now uses, on a subscription row that
     is never written: as a bundle part it charges the bundle price before its
     date and the published price (floored) on it; as anything else, its own
     price. */
  select s.* into v_sub
    from public.subscriptions s
    join public.product_prices pp on pp.product_id = s.product_id and pp.currency = s.currency
   where round(greatest(pp.price, coalesce(pp.floor_price, 0)), 2) <> s.price
   order by s.id
   limit 1;
  if found then
    select round(greatest(pp.price, coalesce(pp.floor_price, 0)), 2) into v_pub
      from public.product_prices pp where pp.product_id = v_sub.product_id and pp.currency = v_sub.currency;
    v_sub.bundle_price_until := current_date + 30;
    v_got := public.subscription_renewal_price(v_sub, current_date + 29);
    if v_got is distinct from v_sub.price then
      raise exception 'a bundle part before its date renews at %, not its bundle price %', v_got, v_sub.price;
    end if;
    v_got := public.subscription_renewal_price(v_sub, current_date + 30);
    if v_got is distinct from v_pub then
      raise exception 'a bundle part on its date renews at %, not the published %', v_got, v_pub;
    end if;
    v_sub.bundle_price_until := null;
    v_got := public.subscription_renewal_price(v_sub, current_date + 400);
    if v_got is distinct from v_sub.price then
      raise exception 'a subscription that is not a bundle part renews at %, not its price %', v_got, v_sub.price;
    end if;
  end if;
end $$;

commit;
