/* One order, one state, however many sellers and fulfilment kinds are on it.
 *
 * An order carries a single `status`, a single `tracking_ref`, a single
 * `carrier` and a single `stages` rail. Ninety-four orders on this marketplace,
 * eleven of them span two sellers and eleven mix a fulfilment kind that ships
 * with one that activates. For those, the header is a claim about the whole
 * order that is true of at most half of it.
 *
 * It is not a hypothetical. Three orders are `in transit` with no item on them
 * that ships at all — ORD-77120404 is an eSIM and an instant add-on, and the
 * marketplace is telling its buyer their nothing is on a van. The same three
 * carry a tracking reference for a parcel that does not exist.
 *
 * And the `stages` rail is per order, so a basket of a handset and an eSIM gets
 * either "Ordered / Approved / Packed / In transit / Delivered" or "Ordered /
 * Confirmed / Provisioning / Activating / Active" — one of the two journeys the
 * order is actually on, drawn for both halves.
 *
 * ---- The security half -------------------------------------------------------
 *
 * `partner_fulfil_own_orders` is an UPDATE policy on `orders` reading
 * `partner_supplies_order(id)`. On ORD-77130506 — Kestrel Devices and PlayForge
 * Games — that is true for both, so either seller may write the status of the
 * whole order. Kestrel can mark PlayForge's game delivered, and PlayForge can
 * put Kestrel's handset back in transit. Each is correctly allowed to act on
 * the order; neither should be able to act on the other's half of it, and with
 * one status field there is no other half to act on.
 *
 * ---- What a part is ----------------------------------------------------------
 *
 * The items that travel together: one seller, one fulfilment kind. That is the
 * natural unit rather than an arbitrary grouping — one seller despatches one
 * parcel, and an eSIM activates on its own schedule whatever else is in the
 * basket. A single-seller single-kind order has exactly one part and reads
 * exactly as it does today.
 *
 * The order's status stops being written and starts being derived. A header
 * that is computed from its parts cannot contradict them, which is the only
 * durable fix for the three orders above — the alternative is correcting them
 * and waiting for the next one.
 */

begin;

/* ---- One spelling ----------------------------------------------------------
 *
 * `in transit` and `in-transit` are both in use, on both tables, for one state.
 * Anything grouping, filtering or counting by status sees two states; anything
 * comparing them sees inequality. Settled on the spaced form, which is what the
 * `stages` rails already print.
 */
update orders      set status = 'in transit' where status = 'in-transit';
update order_items set status = 'in transit' where status = 'in-transit';

create table if not exists order_part (
  id           text primary key,
  order_id     uuid not null references orders(id) on delete cascade,
  /* Who owes this part. Null seller is the marketplace's own — the same
     convention `products.partner_id` uses, and the reason a part cannot simply
     be keyed on the partner. */
  seller       text not null,
  partner_id   text references partners(id),
  kind         text not null,
  state        text not null,
  /* Only ever meaningful on a part that ships. The check below refuses them
     anywhere else rather than leaving a tracking number on an eSIM to be
     explained by whoever finds it. */
  carrier      text,
  tracking_ref text,
  despatched_on date,
  delivered_on  date,
  sort_order   int not null default 0,

  constraint order_part_kind_known
    check (kind in ('shipped', 'instant', 'esim', 'provisioned', 'activation')),

  /* Two journeys, and a state belongs to exactly one of them. A part that
     ships is packed and delivered; a part that activates is provisioned and
     live. `placed`, `failed` and `refunded` are common to both because they are
     things that happen to any part. */
  constraint order_part_state_known
    check (state in ('placed', 'packed', 'in transit', 'delivered',
                     'activating', 'active', 'failed', 'refunded')),
  constraint order_part_state_suits_kind
    check (
      case
        when state in ('placed', 'failed', 'refunded') then true
        when kind = 'shipped' then state in ('packed', 'in transit', 'delivered')
        else state in ('activating', 'active')
      end),

  /* A carrier and a tracking number describe a parcel. Nothing else has one. */
  constraint order_part_carriage_is_for_parcels
    check (kind = 'shipped' or (carrier is null and tracking_ref is null
                                and despatched_on is null and delivered_on is null)),
  /* Delivered before despatched is a record of an impossible journey. */
  constraint order_part_delivered_after_despatch
    check (delivered_on is null or despatched_on is null or delivered_on >= despatched_on),

  unique (order_id, seller, kind)
);

alter table order_items add column if not exists part_id text references order_part(id) on delete set null;

/* ---- Every order, split ----------------------------------------------------- */

insert into order_part (id, order_id, seller, partner_id, kind, state,
                        carrier, tracking_ref, sort_order)
  select
    format('%s-%s', o.order_ref,
           row_number() over (partition by o.id
                              order by coalesce(p.seller, 'Aventa Telecom'), i.fulfil)),
    o.id,
    coalesce(p.seller, 'Aventa Telecom'),
    max(p.partner_id),
    i.fulfil,
    /* The item states, reduced to one for the part. The least advanced wins:
       a part is not delivered while any of it is still being packed. */
    case
      when bool_and(i.status = 'refunded') then 'refunded'
      when bool_or(i.status in ('failed', 'partly-failed')) then 'failed'
      when i.fulfil = 'shipped' then
        case
          when bool_and(i.status = 'delivered') then 'delivered'
          when bool_or(i.status in ('in transit', 'shipped')) then 'in transit'
          when bool_or(i.status = 'packed') then 'packed'
          else 'placed'
        end
      else
        case
          when bool_and(i.status in ('delivered', 'active', 'ok')) then 'active'
          when bool_or(i.status in ('processing', 'pending')) then 'activating'
          else 'placed'
        end
    end,
    /* Carriage moves to the part that ships, and to no other. The three orders
       carrying a tracking number with nothing on them to track lose it here,
       which is the point. */
    case when i.fulfil = 'shipped' then o.carrier end,
    case when i.fulfil = 'shipped' then o.tracking_ref end,
    row_number() over (partition by o.id
                       order by coalesce(p.seller, 'Aventa Telecom'), i.fulfil)
  from orders o
  join order_items i on i.order_id = o.id
  left join products p on p.id = i.product_id
  group by o.id, o.order_ref, coalesce(p.seller, 'Aventa Telecom'), i.fulfil
on conflict (order_id, seller, kind) do nothing;

update order_items i
   set part_id = pt.id
  from order_part pt
 where pt.order_id = i.order_id
   and pt.kind = i.fulfil
   /* Correlated rather than joined: an UPDATE ... FROM cannot join a second
      table against the row being updated. */
   and pt.seller = coalesce(
     (select p.seller from products p where p.id = i.product_id), 'Aventa Telecom');

/* ---- The order's own state, derived ---------------------------------------- */

create or replace function public.order_state_from_parts(p_order uuid)
returns text language sql stable as $$
  /* Read in the order a person would: is any of it still going, has any of it
     failed, and only then what the whole of it amounts to.

     `partly-failed` exists because "failed" on an order where the handset
     arrived and the insurance did not is a worse answer than either half. */
  select case
    when count(*) = 0 then 'placed'
    when bool_and(state = 'refunded') then 'refunded'
    when bool_and(state = 'failed') then 'failed'
    when bool_or(state = 'failed') then 'partly-failed'
    when bool_and(state in ('delivered', 'active', 'refunded'))
      then case when bool_or(state = 'delivered') then 'delivered' else 'active' end
    when bool_or(state = 'in transit') then 'in transit'
    when bool_or(state = 'packed') then 'packed'
    when bool_or(state = 'activating') then 'processing'
    else 'placed'
  end
  from public.order_part where order_id = p_order
$$;

create or replace function public.restate_order()
returns trigger language plpgsql as $$
declare v_order uuid;
begin
  v_order := coalesce(new.order_id, old.order_id);
  update public.orders
     set status = public.order_state_from_parts(v_order)
   where id = v_order;
  return null;
end $$;

drop trigger if exists zz_restate_order on public.order_part;
create trigger zz_restate_order
  after insert or update or delete on public.order_part
  for each row execute function public.restate_order();

/* Bring every order into line with the parts just written. */
update orders o set status = public.order_state_from_parts(o.id)
 where exists (select 1 from order_part pt where pt.order_id = o.id);

/* Carriage now lives on the part that ships. Leaving a copy on the header is
   two places to read one fact, and on a mixed order the header's copy is the
   one that is wrong. */
update orders o set carrier = null, tracking_ref = null
 where exists (select 1 from order_part pt where pt.order_id = o.id);

/* ---- Who may move a part --------------------------------------------------- */

alter table order_part enable row level security;

drop policy if exists operator_all_order_part on order_part;
create policy operator_all_order_part on order_part for all
  using (current_persona() = 'operator') with check (current_persona() = 'operator');

drop policy if exists buyer_read_order_part on order_part;
create policy buyer_read_order_part on order_part for select using (
  exists (select 1 from orders o
           where o.id = order_part.order_id
             and (o.user_id = auth.uid() or o.account_id = current_account_id())));

drop policy if exists partner_read_order_part on order_part;
create policy partner_read_order_part on order_part for select
  using (public.partner_supplies_order(order_id));

/* The half this is all for. A seller may move THEIR part and no other, so
   Kestrel can no longer mark PlayForge's game delivered. `with check` as well
   as `using`, or a seller could reassign a part to themselves on the way
   through. */
drop policy if exists partner_move_own_part on order_part;
create policy partner_move_own_part on order_part for update
  using (partner_id = current_partner_id())
  with check (partner_id = current_partner_id());

/* And the header stops being writable by a seller at all: it is derived now,
   so a write to it is either a no-op or a lie that the next part change
   overwrites. */
drop policy if exists partner_fulfil_own_orders on public.orders;

commit;

/* ---- What has to be true ---------------------------------------------------- */

do $$
declare n int; bad text;
begin
  /* Every item belongs to a part, and to the part that matches it. An item
     without one is an item no seller is answerable for. */
  select count(*) into n from public.order_items where part_id is null;
  if n > 0 then raise exception '% order items belong to no part', n; end if;

  select string_agg(i.id::text, ', ') into bad
    from public.order_items i join public.order_part pt on pt.id = i.part_id
   where pt.kind <> i.fulfil or pt.order_id <> i.order_id;
  if bad is not null then raise exception 'items filed under the wrong part: %', bad; end if;

  /* The thing that started this: nothing claims to be in transit with nothing
     on it that ships. */
  select string_agg(o.order_ref, ', ') into bad
    from public.orders o
   where o.status in ('in transit', 'packed')
     and not exists (select 1 from public.order_part pt
                      where pt.order_id = o.id and pt.kind = 'shipped');
  if bad is not null then raise exception 'still in transit with nothing to ship: %', bad; end if;

  select count(*) into n from public.orders o
   where (o.tracking_ref is not null or o.carrier is not null)
     and exists (select 1 from public.order_part pt where pt.order_id = o.id);
  if n > 0 then raise exception '% orders still carry carriage on the header', n; end if;

  /* One spelling. */
  select count(*) into n from public.orders where status = 'in-transit';
  if n > 0 then raise exception '% orders still spell it in-transit', n; end if;

  /* The header agrees with its parts, on every order. */
  select string_agg(format('%s says %s, its parts say %s',
                           o.order_ref, o.status, public.order_state_from_parts(o.id)), '; ')
    into bad
    from public.orders o
   where exists (select 1 from public.order_part pt where pt.order_id = o.id)
     and o.status <> public.order_state_from_parts(o.id);
  if bad is not null then raise exception 'a header contradicts its parts: %', bad; end if;

  /* The mixed orders actually got split, or this whole migration ran against a
     marketplace where the case does not arise. */
  select count(*) into n from (
    select order_id from public.order_part group by order_id having count(*) > 1) t;
  if n < 10 then raise exception 'only % orders have more than one part', n; end if;

  /* The trigger holds: moving a part restates its order rather than leaving
     the two to be reconciled by whoever notices. */
  declare v_part text; v_order uuid; v_was text; v_now text;
  begin
    select pt.id, pt.order_id into v_part, v_order
      from public.order_part pt where pt.kind = 'shipped' and pt.state = 'delivered'
      limit 1;
    select status into v_was from public.orders where id = v_order;
    update public.order_part set state = 'packed' where id = v_part;
    select status into v_now from public.orders where id = v_order;
    if v_now = v_was and v_was = 'delivered' then
      raise exception 'a part moved and its order did not';
    end if;
    update public.order_part set state = 'delivered' where id = v_part;
  end;

  /* And a part cannot hold a state from the other journey, or a tracking
     number for something that never ships. */
  begin
    update public.order_part set state = 'active' where kind = 'shipped'
      and id = (select id from public.order_part where kind = 'shipped' limit 1);
    bad := 'a shipped part was marked active';
  exception when check_violation then bad := null;
  end;
  if bad is not null then raise exception '%', bad; end if;

  begin
    update public.order_part set tracking_ref = 'X' where kind <> 'shipped'
      and id = (select id from public.order_part where kind <> 'shipped' limit 1);
    bad := 'an eSIM was given a tracking number';
  exception when check_violation then bad := null;
  end;
  if bad is not null then raise exception '%', bad; end if;
end $$;
