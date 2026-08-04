/*
  # A guard that asks who you are has to handle "nobody"

  `guard_order_fulfilment` opens with

      if current_persona() <> 'partner' then return new; end if;

  and `current_persona()` returns null when there is no signed-in user — a
  migration, a scheduled job, anything run with the service role or as the
  database owner. In SQL, `null <> 'partner'` is null, not true, so the branch
  is not taken and the caller falls into the seller's checks. The next thing
  they hit is

      You supply nothing on ORD-883101, so it is not yours to fulfil.

  which is both wrong and impossible to act on: there is no seller to be, and no
  way to become one. It was found putting an order back after a verification
  run, which is the mildest possible version of it — the same fault would stop a
  data fix or a nightly job with a message about supply.

  `is distinct from` is the comparison that treats null as a value rather than
  as an unknown, so "no persona" takes the early return with everybody else who
  is not a seller.

  `guard_subscription_change` has the same shape the other way up — it asks
  whether you *are* the operator — so a null persona falls into the buyer's
  checks there too. Same fix, same reason.
*/

create or replace function guard_order_fulfilment() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  /* `is distinct from` rather than `<>`: with no signed-in user this is null,
     and `null <> 'partner'` is null, which is not true, which means the early
     return never happens and a job with no persona is told it does not supply
     anything. */
  if current_persona() is distinct from 'partner' then
    return new;
  end if;

  if not partner_supplies_order(new.id) then
    raise exception 'You supply nothing on %, so it is not yours to fulfil.', old.order_ref;
  end if;
  if not partner_alone_on_order(new.id) then
    raise exception '% carries another seller''s lines as well as yours. Marking the whole order would speak for them too — the marketplace moves a shared order on when every seller has.',
      old.order_ref;
  end if;

  if new.total is distinct from old.total
     or new.subtotal is distinct from old.subtotal
     or new.tax is distinct from old.tax
     or new.discount is distinct from old.discount
     or new.currency is distinct from old.currency
     or new.market is distinct from old.market
     or new.tax_rate is distinct from old.tax_rate
     or new.buyer_name is distinct from old.buyer_name
     or new.buyer_email is distinct from old.buyer_email
     or new.shipping_address is distinct from old.shipping_address
     or new.account_id is distinct from old.account_id
     or new.user_id is distinct from old.user_id
     or new.order_ref is distinct from old.order_ref
     or new.stages is distinct from old.stages
     or new.payment_method is distinct from old.payment_method
     or new.requisition_id is distinct from old.requisition_id
     or new.invoice_id is distinct from old.invoice_id
  then
    raise exception 'Only how far % has got is yours to change. The money and the buyer are what was agreed at checkout.',
      old.order_ref;
  end if;

  if new.stage < old.stage then
    raise exception '% is already at "%". A stage is not moved backwards — ask the marketplace, which records who did it and why.',
      old.order_ref, old.stages[old.stage + 1];
  end if;
  if new.stage > array_length(new.stages, 1) - 1 then
    raise exception '% has % stages and cannot go past the last of them.',
      old.order_ref, array_length(new.stages, 1);
  end if;

  if new.failed and not old.failed and coalesce(trim(new.failed_reason), '') = '' then
    raise exception 'Say what went wrong with %. "Failed" on its own cannot be acted on by anybody.', old.order_ref;
  end if;

  return new;
end $$;

create or replace function guard_subscription_change() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  /* Anybody who is not a business buyer writes these freely — the operator, and
     any job running with no persona at all. Asking `= 'enterprise'` rather than
     `<> 'operator'` is what makes the null case fall the safe way. */
  if current_persona() is distinct from 'enterprise' then
    return new;
  end if;

  if new.account_id is distinct from old.account_id
     or new.product_id is distinct from old.product_id
     or new.name is distinct from old.name
     or new.seller is distinct from old.seller
     or new.partner_id is distinct from old.partner_id
     or new.vertical is distinct from old.vertical
     or new.quantity is distinct from old.quantity
     or new.seats_used is distinct from old.seats_used
     or new.unit_price is distinct from old.unit_price
     or new.unit is distinct from old.unit
     or new.monthly is distinct from old.monthly
     or new.cost_centre is distinct from old.cost_centre
     or new.started is distinct from old.started
     or new.renews is distinct from old.renews
     or new.status is distinct from old.status
     or new.contract_ref is distinct from old.contract_ref
     or new.why_suspended is distinct from old.why_suspended
     or new.currency is distinct from old.currency
  then
    raise exception 'Only whether it renews is yours to change. Everything else on % is what was agreed with %.',
      old.name, old.seller;
  end if;

  if new.auto_renew and not old.auto_renew and old.status = 'suspended' then
    raise exception '% is suspended, so setting it to renew would produce a renewal the marketplace refuses. %',
      old.name, coalesce(old.why_suspended, 'Clear the suspension first.');
  end if;

  return new;
end $$;

do $$
declare
  before_stage integer;
begin
  /* The check is the thing that was broken: a write with no persona at all.
     This block runs as the owner with no JWT, which is exactly that case, and
     before the fix it raised "You supply nothing on ORD-883101". */
  select stage into before_stage from orders where order_ref = 'ORD-883101';

  update orders set stage = stage where order_ref = 'ORD-883101';
  update enterprise_subscriptions set auto_renew = auto_renew where id = 'SUB-7781';

  if (select stage from orders where order_ref = 'ORD-883101') <> before_stage then
    raise exception 'The no-op write moved the order';
  end if;
end $$;
