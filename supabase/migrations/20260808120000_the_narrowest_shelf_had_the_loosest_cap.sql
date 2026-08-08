/* The most tightly governed shelf had the loosest cap on it.
 *
 * Security is the narrowest shelf in the marketplace by every other measure:
 * every listing reviewed by hand, ninety-six hours to do it, a 4.0 rating bar,
 * an unrated seller refused outright, returns governed by the contract rather
 * than by a window. It is deliberately hard to get onto.
 *
 * And its cap was six per supplier, against two suppliers holding five listings
 * between them. Room for twelve on a shelf that currently carries five. A cap
 * three times the size of the shelf is not a curation decision, it is a number
 * that will never be reached — which is the same fault the caps had before this
 * week, just less extreme.
 *
 * Five. Sentinel holds four of them, which means the shelf now has a supplier
 * genuinely near its limit, and "near the cap" becomes a state somebody can see
 * on the screen rather than a colour in a stylesheet nothing ever selects.
 */

update public.category_policy set
  max_listings_per_seller = 5,
  note = 'Returns are contractual — a security subscription is governed by its own agreement and a blanket window would contradict it. The tightest shelf in the marketplace: reviewed by hand, a 4.0 bar, no unrated sellers, and five listings per supplier.',
  updated_on = date '2026-08-08', updated_by = 'Anika Sharma'
 where category_id = 'security';

do $$
declare n int; most int; bad text;
begin
  /* Nothing is pushed over by the change — a cap set below where a supplier
     already sits refuses their next listing and does nothing about the ones
     already there, which is a worse state than the one it replaced. */
  select string_agg(x.who || ' holds ' || x.held, '; ') into bad from (
    select coalesce(pt.name, 'the marketplace') as who, count(*) as held
      from public.products p
      left join public.partners pt on pt.id = p.partner_id
     where p.category_id = 'security' and p.status not in ('retired', 'rejected', 'suspended')
     group by 1
  ) x where x.held > 5;
  if bad is not null then raise exception 'the tighter cap is already breached: %', bad; end if;

  /* And somebody is now close enough to it that the state means something. A
     shelf where every supplier sits under four fifths of the cap draws the
     "near the cap" case against nothing. */
  select max(k) into most from (
    select count(*) k from public.products p
      join public.category_policy pol on pol.category_id = p.category_id
     where p.status not in ('retired', 'rejected', 'suspended')
       and pol.max_listings_per_seller is not null
     group by p.category_id, p.partner_id, pol.max_listings_per_seller
    having count(*)::numeric / pol.max_listings_per_seller >= 0.8
  ) y;
  if most is null then
    raise exception 'no supplier sits within four fifths of any cap, so "near the cap" is untested';
  end if;

  select count(*) into n from public.category_policy where max_listings_per_seller is not null;
  raise notice 'capped shelves %, tightest %, closest supplier holds %',
    n, (select min(max_listings_per_seller) from public.category_policy where max_listings_per_seller is not null), most;
end $$;
