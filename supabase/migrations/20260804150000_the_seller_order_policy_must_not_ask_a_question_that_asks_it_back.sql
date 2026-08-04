/*
  # The seller's order policy must not ask a question that asks it back

  The policy added in the previous migration reads, in words: a seller may see
  an order if a line on it is theirs. `order_items` already had the mirror of
  that for the enterprise buyer — an account may see a line if the order it
  belongs to is theirs — so `orders` asked `order_items`, `order_items` asked
  `orders`, and Postgres refused the lot:

      42P17: infinite recursion detected in policy for relation "orders"

  The seller's Orders screen came up empty, which is exactly what it looked like
  before the policy existed. That is the dangerous part: a policy that recurses
  fails the same way as a policy that is missing, and the screen it broke was
  one that had never worked, so there was nothing to notice.

  The fix is the pattern `current_partner_id()` already uses. A security-definer
  function answers "does this seller supply a line on this order" without RLS
  applying inside it, so the question is asked once and never asked back.

  `security definer` here is not a widening: the function takes the order id and
  the caller's own partner id and returns a boolean about the two. It cannot be
  asked about anybody else, because it does not take anybody else as an
  argument.
*/

create or replace function partner_supplies_order(oid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from order_items i
    join products p on p.id = i.product_id
    where i.order_id = oid
      and p.partner_id = current_partner_id()
  )
$$;

/* The one that matters for the same reason: whether an order is *only* this
   seller's, which is what decides if they may move it on alone. */
create or replace function partner_alone_on_order(oid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select partner_supplies_order(oid)
     and not exists (
       select 1
       from order_items i
       join products p on p.id = i.product_id
       where i.order_id = oid
         and p.partner_id is distinct from current_partner_id()
     )
$$;

drop policy if exists partner_read_own_orders on orders;
create policy partner_read_own_orders on orders
  for select to authenticated
  using (partner_supplies_order(id));

drop policy if exists partner_fulfil_own_orders on orders;
create policy partner_fulfil_own_orders on orders
  for update to authenticated
  using (partner_supplies_order(id))
  with check (partner_supplies_order(id));

/* `order_items` was the other half of the cycle. Its seller policy asks
   `products`, which asks nothing back, so it only needed the recursion removed
   from the `orders` side — but it is restated here through the same function so
   the two sides cannot drift into asking each other again. */
drop policy if exists partner_read_own_order_items on order_items;
create policy partner_read_own_order_items on order_items
  for select to authenticated
  using (partner_supplies_order(order_id));

/* The guard did its own counting over `order_items` inside a trigger, which is
   fine — a trigger function is not a policy and does not recurse — but it now
   asks the same two questions the policies ask, so a refusal on the screen and
   a refusal in the database have one definition between them. */
create or replace function guard_order_fulfilment() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if current_persona() <> 'partner' then
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

do $$
declare
  n integer;
begin
  /* The recursion is what this migration exists to remove, so it is what gets
     checked: read the table as the demo seller and see how many come back.
     Before the fix this raised 42P17 rather than returning a number. */
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    '{"sub":"8df60815-a607-4f28-996a-ded5c6aefa16","role":"authenticated"}', true);

  select count(*) into n from orders;
  if n < 5 then
    raise exception 'The demo seller can see % orders, which is not the history they have', n;
  end if;

  select count(*) into n from order_items;
  if n < 5 then
    raise exception 'The demo seller can see % order lines', n;
  end if;

  /* And sees nobody else's: every order they can read carries a line of
     theirs. */
  select count(*) into n from orders o where not partner_supplies_order(o.id);
  if n > 0 then
    raise exception 'The demo seller can read % orders they supply nothing on', n;
  end if;

  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end $$;
