/*
  # A listing life that has actually been lived

  The previous migration gave a listing states, a go-live date and versions.
  Every listing in the marketplace was then in exactly one of three of them —
  live, pending or suspended — so a seller opening My Listings could reach the
  new controls but had nothing to look at, and the catalogue desk's change queue
  was a heading over an empty box. A feature demonstrated only by using it is a
  feature nobody discovers.

  Three things are seeded, each on a listing chosen so that seeding it does not
  quietly change something else.

  ## Undoing what verification left behind

  Driving the round trip in a browser left real rows: SKU-5003's description was
  changed to "Seven-year cell" and a published version recorded that. It is put
  back — the cell is five years, `specs` and the "5-year battery" tag both say
  so, and a description that disagrees with the tag beside it is worse than no
  description. The version row goes with it: history of a change that was only
  ever a test is not history.

  ## Paused, on a listing where pausing costs nothing else

  SKU-5004 is not a component of any bundle, so taking it off sale cannot make
  something else undeliverable. It has four order lines behind it, which is the
  point rather than a problem: a paused listing keeps every record it ever made,
  and the four lines are how you can see that from the seller's own screens.

  ## A go-live date on something that has not gone live yet

  SKU-5009 is with the catalogue desk. Giving it a date changes nothing today —
  a listing in review is not on sale whatever date it carries — and when the
  desk approves it, `stateAfterApproval` lands it in `scheduled` rather than
  `live`. That is the whole path the schedule exists for, and it is the one
  arrangement of the data where approving a listing demonstrates it.

  ## One change waiting and one already refused

  `was` is built from the listing itself rather than typed out here, so the diff
  the desk is shown cannot drift from the row it is a diff against. The refused
  one carries the reason it was refused, because a change history that records
  outcomes and not grounds tells a seller they were turned down and nothing
  about what to do next.
*/

/* ------------------------------------------- what verification left behind --- */

update products
   set description = 'Battery temperature and humidity logger for refrigerated transport. Five-year cell, IP67.'
 where id = 'SKU-5003';

delete from product_versions where id = 'PV-SKU-5003-1';

/* ---------------------------------------------------------------- paused --- */

update products
   set status        = 'paused',
       paused_on     = date '2026-08-03',
       paused_reason = 'Cell supplier moved the September batch to October. Back on sale as soon as the batch lands.',
       go_live_on    = null
 where id = 'SKU-5004';

/* ------------------------------------------------------------- scheduled --- */

/* Still in review — the date says when it should appear once it is cleared,
   not that it has been. */
update products
   set go_live_on = date '2026-09-01'
 where id = 'SKU-5009';

/* --------------------------------------------------------------- changes --- */

/* The fields a seller may version, read off the listing as it stands. Anything
   not being changed is in `was` and absent from `proposed`, which is what makes
   `changesIn` show a difference rather than a second copy of the listing. */
create temporary view listing_now as
  select id,
         jsonb_build_object(
           'name', name, 'description', description, 'sub_category', sub_category,
           'fulfil', fulfil, 'stock', stock, 'tags', to_jsonb(tags)
         ) as fields
    from products;

insert into product_versions
  (id, product_id, partner_id, version, state, proposed, was, note,
   submitted_by, submitted_at, decided_by, decided_at, decision_reason)
select
  'PV-SKU-5003-1', 'SKU-5003', 'PTR-1004', 1, 'pending',
  jsonb_build_object(
    'description', 'Battery temperature and humidity logger for refrigerated transport. Five-year cell, IP67. Rated −25 °C to +25 °C, logging every 30 minutes.',
    'tags', jsonb_build_array('IP67', '5-year battery', '−25 °C to +25 °C')
  ),
  n.fields,
  'The operating range has been on the datasheet since the Pune cold-store trial in June and has never been on the listing. Buyers keep asking us for it in tickets.',
  'Rajesh Kumar', timestamptz '2026-08-04 09:20:00+00',
  null, null, null
  from listing_now n where n.id = 'SKU-5003';

/* Refused, and the seller can act on the reason. A bundle's name is what a
   buyer reads on the basket line, so shortening it to something that no longer
   says what is in the box is a change the desk turns down. */
insert into product_versions
  (id, product_id, partner_id, version, state, proposed, was, note,
   submitted_by, submitted_at, decided_by, decided_at, decision_reason)
select
  'PV-SKU-5006-1', 'SKU-5006', 'PTR-1004', 1, 'rejected',
  jsonb_build_object('name', 'Cold-chain starter'),
  n.fields,
  'Shortening the name so it fits the reseller price list without wrapping.',
  'Rajesh Kumar', timestamptz '2026-07-21 11:05:00+00',
  'Aventa catalogue desk', timestamptz '2026-07-22 08:40:00+00',
  'The name is what a buyer reads on their basket line and their bill, and "Cold-chain starter" does not say it contains 25 sensors and 25 SIMs. Propose a shorter name that still names what is in the box, or ask your reseller to widen the column.'
  from listing_now n where n.id = 'SKU-5006';

do $$
declare
  n integer;
  r record;
begin
  /* The listing and the tag beside it agree again. */
  select count(*) into n from products
   where id = 'SKU-5003' and (description like '%Seven-year%' or not ('5-year battery' = any(tags)));
  if n > 0 then raise exception 'SKU-5003 still describes a cell its own tag disagrees with'; end if;

  /* Nothing paused, scheduled or retired is a component of a bundle that is
     still on sale — a bundle whose parts cannot be delivered is a bundle that
     takes an order it cannot fill. */
  for r in
    select b.id bundle, c.component_id, p.status
      from product_components pc
      join products b on b.id = pc.bundle_id
      join products p on p.id = pc.component_id
      join product_components c on c.bundle_id = pc.bundle_id and c.component_id = pc.component_id
     where b.status = 'live' and p.status <> 'live'
  loop
    raise exception 'Bundle % is on sale but its component % is %', r.bundle, r.component_id, r.status;
  end loop;

  /* Every state carries what that state requires. The table constraints say the
     same thing; this says it about the rows this migration wrote. */
  select count(*) into n from products where status = 'paused' and (paused_on is null or paused_reason is null);
  if n > 0 then raise exception '% listings are paused for no stated reason', n; end if;

  select count(*) into n from products where status = 'live' and go_live_on > current_date;
  if n > 0 then raise exception '% listings are on sale and waiting for a future date', n; end if;

  /* A proposal has to propose something, and it has to differ from what it
     proposes to change — an empty diff on the desk's screen is a decision
     nobody can take. */
  for r in
    select v.id, v.product_id from product_versions v where v.proposed = '{}'::jsonb or v.was = '{}'::jsonb
  loop
    raise exception 'Version % on % carries no fields to compare', r.id, r.product_id;
  end loop;

  for r in
    select v.id from product_versions v
     where not exists (
       select 1 from jsonb_each_text(v.proposed) k
        where v.was ->> k.key is distinct from k.value
     )
  loop
    raise exception 'Version % proposes nothing that differs from what it would replace', r.id;
  end loop;

  /* A refusal names a ground. One that does not comes straight back as a
     ticket, which is the thing the review queue exists to avoid. */
  select count(*) into n from product_versions
   where state = 'rejected' and coalesce(length(trim(decision_reason)), 0) < 15;
  if n > 0 then raise exception '% refused changes give the seller nothing to work from', n; end if;

  /* And there is something in each queue to look at. */
  select count(*) into n from product_versions where state = 'pending';
  if n < 1 then raise exception 'The catalogue desk has no change to decide'; end if;

  select count(*) into n from products where status = 'paused';
  if n < 1 then raise exception 'No listing is paused, so the state is still only reachable by using it'; end if;

  select count(*) into n from products where go_live_on is not null;
  if n < 1 then raise exception 'No listing has a go-live date'; end if;
end $$;
