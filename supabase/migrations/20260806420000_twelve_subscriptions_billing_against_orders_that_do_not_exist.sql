/* Twelve subscriptions billing against orders that do not exist.
 *
 * Priya's account carried nineteen subscriptions where the prototype defines
 * seven. Thirteen of the extras have refs beginning `ORD-`, all started on the
 * same day, all duplicating a product she already held — residue from checkouts
 * run while verifying the storefront in a browser.
 *
 * Twelve of those thirteen point at an order reference with no order behind it.
 * That is not a matter of taste about demo data: it is a recurring charge whose
 * only evidence of ever having been bought does not exist. They go.
 *
 * The thirteenth, ORD-13327384, has a real order and a real payment attempt
 * behind it, so the purchase happened. What should not have happened is the
 * second subscription it created: Priya already held SUB-9103 for the same SKU,
 * and the marketplace took her money for a duplicate of something she was
 * already paying for monthly. The order stays — it is a true record — and the
 * duplicate subscription is cancelled with the date her existing access already
 * covers, which is what a marketplace that noticed would have done.
 *
 * Then the rule that would have prevented all of it. There was nothing stopping
 * a second active subscription to a product an account already subscribes to,
 * which is why one careless afternoon produced thirteen. A partial unique index
 * makes it impossible rather than merely discouraged, and a trigger says why in
 * a sentence a checkout can show the shopper.
 */

begin;

/* ---- The twelve with nothing behind them ---------------------------------- */

delete from subscriptions s
 where s.ref like 'ORD-%'
   and not exists (
     select 1 from orders o
      where o.order_ref = s.ref
         or o.order_ref = split_part(s.ref, '-', 1) || '-' || split_part(s.ref, '-', 2)
   );

/* ---- The one that was paid for, and duplicated something already held ----- */

update subscriptions dup
   set status = 'cancelled',
       auto_renew = false,
       next_renewal = null,
       /* Her existing subscription to the same product already covers her, and
          its renewal date is the honest answer to "until when". */
       ends_at = (select held.next_renewal from subscriptions held
                   where held.user_id = dup.user_id
                     and held.product_id = dup.product_id
                     and held.ref <> dup.ref
                     and held.status = 'active'
                   order by held.started_at limit 1)
 where dup.ref like 'ORD-%'
   and dup.status = 'active'
   and exists (
     select 1 from subscriptions held
      where held.user_id = dup.user_id
        and held.product_id = dup.product_id
        and held.ref <> dup.ref
        and held.status = 'active'
        and held.started_at < dup.started_at
   );

/* ---- The rule ------------------------------------------------------------- */

/* One active subscription per account per product. Partial, because a cancelled
   or paused row for the same product is exactly what a re-subscription looks
   like and must stay allowed. */
create unique index if not exists subscriptions_one_active_per_product
  on subscriptions (user_id, product_id)
  where status = 'active';

create or replace function guard_duplicate_subscription()
returns trigger language plpgsql set search_path = public as $fn$
declare existing subscriptions%rowtype;
begin
  if new.status <> 'active' then return new; end if;

  select * into existing from subscriptions
   where user_id = new.user_id and product_id = new.product_id
     and status = 'active' and ref is distinct from new.ref
   limit 1;

  if existing.ref is not null then
    /* The index would refuse this anyway. The trigger exists so the refusal
       arrives as something a checkout screen can show a shopper, rather than as
       a unique-violation the storefront turns into "something went wrong". */
    raise exception 'You already subscribe to % (%) — it renews on %. Change that subscription rather than taking a second one.',
      new.product_name, existing.ref, coalesce(existing.next_renewal::text, 'its next cycle');
  end if;

  return new;
end $fn$;

drop trigger if exists z_guard_duplicate_subscription on subscriptions;
create trigger z_guard_duplicate_subscription
  before insert or update on subscriptions
  for each row execute function guard_duplicate_subscription();

/* ---- Checks --------------------------------------------------------------- */

do $$
declare n int;
begin
  select count(*) into n from subscriptions s
   where not exists (select 1 from orders o
                      where o.order_ref = s.ref
                         or o.order_ref = split_part(s.ref, '-', 1) || '-' || split_part(s.ref, '-', 2))
     and s.ref like 'ORD-%';
  if n > 0 then raise exception '% subscriptions still reference an order that does not exist', n; end if;

  select count(*) into n
    from (select user_id, product_id from subscriptions
           where status = 'active' group by 1, 2 having count(*) > 1) d;
  if n > 0 then raise exception '% products are actively subscribed twice on one account', n; end if;

  /* The seven the prototype defines must all still be here — the clean-up was
     meant to remove residue, not to thin out the demo. */
  select count(*) into n from subscriptions
   where ref in ('SUB-9101','SUB-9102','SUB-9103','SUB-9104','SUB-9105','SUB-9106','SUB-9107');
  if n <> 7 then raise exception 'only % of the prototype''s seven subscriptions survive', n; end if;
end $$;

commit;
