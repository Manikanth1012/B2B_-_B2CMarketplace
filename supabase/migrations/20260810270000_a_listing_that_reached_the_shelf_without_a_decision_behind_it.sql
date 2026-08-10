/* A listing that reached the shelf without a decision behind it.
 *
 * `SKU-7011` was seeded live in the migration that gave the vendor renewal path
 * a seller who signs in, and it went on sale with no row in `operator_listings`.
 * `catalogueIntegrity.integration` caught it: nothing a buyer can reach may have
 * arrived without a review behind it, because the approval is what the sale
 * rests on.
 *
 * Seeding a product straight to `live` is exactly how that happens — the
 * publishing path writes both, and an INSERT writes one. The decision recorded
 * here is the real one: it sits inside the category eligibility and market
 * approval Beacon already holds, which is why it could be live at all.
 */

insert into public.operator_listings
  (id, status, submitted_at, reviewed_by, reviewed_at, version, sort_order,
   product_id, partner_id, check_note, risk, issue, decision_reason, submitted_by)
values
  ('ol-7011', 'approved', '2026-02-04 00:00:00+00', 'Tomas Novak',
   '2026-02-06 00:00:00+00', 1, 903, 'SKU-7011', 'PTR-1009',
   'Automated checks passed', 'low', null,
   'Consumer connectivity resold on the Aventa network. Inside Beacon''s IoT category approval and their Kenyan market grant; no rupee price, since they are not approved in India. Renewals are the seller''s to maintain and the listing says so.',
   'Beacon Reseller Co')
on conflict (id) do nothing;

do $$
declare n integer;
begin
  /* The invariant the test states, checked here so the data cannot drift back:
     nothing on the shelf, or waiting to be, without a decision behind it. */
  select count(*) into n
    from public.products p
   where p.status in ('live', 'pending')
     and not exists (select 1 from public.operator_listings l where l.product_id = p.id);
  if n > 0 then
    raise exception '% products are on the shelf with no review record.', n;
  end if;

  /* And the decision agrees with where the product ended up. */
  select count(*) into n
    from public.operator_listings l join public.products p on p.id = l.product_id
   where l.id = 'ol-7011' and (l.status <> 'approved' or p.status <> 'live');
  if n > 0 then raise exception 'ol-7011 and SKU-7011 disagree about what happened.'; end if;
end $$;
