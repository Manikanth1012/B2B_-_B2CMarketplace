/*
  # A business can turn off its own auto-renewal

  "Manage" beside every subscription on the enterprise console was
  `toast(`${s.name} · ${s.contract_ref ?? 'no contract reference'}`)` — it
  printed the contract reference in a bubble that vanished after four seconds and
  managed nothing.

  The one thing a buyer genuinely manages between renewals is whether the
  subscription renews at all, and `enterprise_subscriptions.auto_renew` has been
  a column the whole time with no policy allowing anybody but the operator to
  set it. A business had to raise a ticket to stop a renewal it is contractually
  free to stop.

  1. The buyer may set `auto_renew`, and nothing else
     Seats, price, term and the contract reference are the marketplace's record
     of what was agreed. A buyer who can edit `quantity` has re-priced their own
     contract. `guard_subscription_change` refuses any write from an account that
     touches a column other than `auto_renew`, so the policy cannot be widened by
     accident later — the check is on the row, not on the intent of whoever wrote
     the update.

  2. A suspended subscription cannot be set to renew
     Turning auto-renew back on for something the marketplace has suspended
     produces a renewal that will be refused, and a buyer who thinks they have
     fixed it. Turning it *off* stays allowed, which is the direction that never
     surprises anybody.
*/

create or replace function guard_subscription_change() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  /* The operator writes these rows freely — this guard is about the buyer. */
  if current_persona() = 'operator' then
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

drop trigger if exists guard_subscription_change on enterprise_subscriptions;
create trigger guard_subscription_change
  before update on enterprise_subscriptions
  for each row execute function guard_subscription_change();

create policy account_renew_enterprise_subscriptions on enterprise_subscriptions
  for update to authenticated
  using (account_id = current_account_id())
  with check (account_id = current_account_id());

do $$
declare
  n integer;
begin
  select count(*) into n from pg_policies
   where tablename = 'enterprise_subscriptions' and policyname = 'account_renew_enterprise_subscriptions';
  if n <> 1 then
    raise exception 'The renewal policy did not take';
  end if;

  select count(*) into n from pg_trigger
   where tgrelid = 'enterprise_subscriptions'::regclass and tgname = 'guard_subscription_change';
  if n <> 1 then
    raise exception 'The guard did not take, and the policy on its own would let a buyer re-price their contract';
  end if;

  /* A suspended subscription that is also set to auto-renew is the state the
     guard exists to stop being created. None should exist to begin with. */
  select count(*) into n from enterprise_subscriptions where status = 'suspended' and auto_renew;
  if n > 0 then
    raise exception '% suspended subscriptions are set to renew', n;
  end if;
end $$;
