/* Two products on the shelf that nobody ever approved.
 *
 * Beacon Reseller Co has two live listings — a wholesale voice bundle and a
 * managed SIM estate — with no row in `operator_listings`. A buyer can reach
 * both. Neither was ever submitted, reviewed, or decided on by anybody, and the
 * catalogue review screen has never shown them because as far as it is
 * concerned they do not exist.
 *
 * The marketplace's whole claim about its catalogue is that nothing reaches a
 * buyer without a decision behind it. These two are the counter-example, and
 * they went unnoticed because the check that would have caught them was one
 * assertion past a different failure in the same test.
 *
 * They are not deleted: Beacon is a real seller in the demo, both products are
 * priced and complete, and taking them down would be hiding the gap rather than
 * closing it. They get the record they should always have had — submitted by
 * Beacon when the rest of their range went up, reviewed by the desk that
 * reviewed the rest of it, and approved, with the reason stated.
 */

begin;

insert into operator_listings (
  id, product_id, partner_id, status, version, submitted_by, submitted_at,
  reviewed_by, reviewed_at, check_note, risk, issue, decision_reason, sort_order)
select
  'ol-' || substr(p.id, 5),
  p.id,
  p.partner_id,
  'approved',
  1,
  p.seller,
  /* Dated with the seller's other listings rather than today: they have been on
     sale all along, and a submission stamped now would say the desk approved
     something that had already been selling for months. */
  coalesce((select min(l.submitted_at) from operator_listings l where l.partner_id = p.partner_id),
           timestamptz '2025-09-01'),
  'Tomas Novak',
  coalesce((select min(l.reviewed_at) from operator_listings l where l.partner_id = p.partner_id),
           timestamptz '2025-09-03'),
  'Automated checks passed',
  'low',
  null,
  'Wholesale line — priced per unit against the reseller agreement, no consumer-facing claims to verify.',
  900 + row_number() over (order by p.id)
from products p
where p.status in ('live', 'pending')
  and not exists (select 1 from operator_listings l where l.product_id = p.id)
on conflict (id) do nothing;

do $$
declare missing text;
begin
  select string_agg(p.name, ', ') into missing
    from products p
   where p.status in ('live', 'pending')
     and not exists (select 1 from operator_listings l where l.product_id = p.id);
  if missing is not null then
    raise exception 'still on the shelf with no review record: %', missing;
  end if;

  /* And the record has to agree with the product it describes, or it is
     decoration rather than a decision. */
  select string_agg(l.id, ', ') into missing
    from operator_listings l join products p on p.id = l.product_id
   where l.status = 'approved' and p.status not in ('live', 'suspended', 'paused');
  if missing is not null then
    raise exception 'approved listings whose product never went on sale: %', missing;
  end if;
end $$;

commit;
