/* The copy that outlived the products.
 *
 * The previous migration took new lines and fixed access off the shelf. It did
 * not touch the sentences that promise them, and a storefront whose hero says
 * "browse mobile plans" and whose promo strip says "add a second line for ₹299
 * a month" is a storefront that gets a customer to the checkout and then tells
 * them no.
 *
 * `bn-008` is the sharpest case: a live banner in the bill slot, 38,400
 * impressions and 214 orders against it, pointing at SKU-2001 — which is now
 * retired. Left alone it would keep serving, keep being clicked, and land on a
 * product page that no longer exists.
 *
 * The banner is repointed rather than deleted. Its slot, its weight and its
 * region are a real piece of scheduling somebody set up, and the offer it now
 * carries — family safety at the same ₹299 — is the nearest true thing. Its
 * counters are reset, because 214 orders were for a different product and
 * carrying them across would overstate the new offer's performance from the
 * day it launched.
 */

/* ---- The hero's own words, where the shopper reads them first ---------------- */

update public.categories set
  blurb = 'Add-ons, travel eSIMs, device protection and insurance for customers already on the network'
 where id = 'consumer';

comment on column public.categories.blurb is
  'What the category card promises. Kept true to what is actually on the shelf '
  'in it — a promise here is the first thing a shopper tests.';

/* ---- The promo strip --------------------------------------------------------- */

update public.operator_banners set
  title = 'Family safety on every line for ₹299 a month',
  subtitle = 'Content filtering, screen-time limits and location sharing. Cancel any month.',
  cta = 'See how it works',
  name = 'Family safety across the account',
  alt = 'A parent and child looking at a phone together',
  destination_ref = 'SKU-2009',
  /* Somebody else''s numbers. A banner that changed what it sells has not
     earned the click-through of what it used to sell. */
  impressions = 0, clicks = 0, orders = 0, revenue = 0
 where id = 'bn-008';

update public.operator_banners set
  title = 'Family safety on every line for AED 13 a month',
  subtitle = 'Content filtering, screen-time limits and location sharing. Cancel any month.',
  cta = 'See how it works',
  name = 'Family safety across the account (UAE)',
  destination_ref = 'SKU-2009'
 where id = 'bn-008-ae';

/* ---- Assertions --------------------------------------------------------------- */

do $$
declare bad text;
begin
  /* Nothing live points at something that is not on sale. This is the check
     that would have caught bn-008 before it was written, and it is worth
     keeping for the next banner somebody schedules against a listing that is
     later retired. */
  select string_agg(b.id || ' → ' || b.destination_ref, ', ')
    into bad
    from public.operator_banners b
    left join public.products p on p.id = b.destination_ref
   where b.status = 'live'
     and b.destination_ref like 'SKU-%'
     and (p.id is null or p.status not in ('live','scheduled'));
  if bad is not null then
    raise exception 'live banners pointing at something nobody can buy: %', bad;
  end if;

  /* And the category card does not promise a line. */
  if exists (select 1 from public.categories
              where id = 'consumer' and blurb ilike '%mobile plan%') then
    raise exception 'the consumer category still advertises mobile plans';
  end if;

  /* The price in the banner is the price on the product, in that market''s own
     money. A banner quoting a figure the product page contradicts is worse
     than one quoting none. */
  if not exists (
    select 1 from public.product_prices
     where product_id = 'SKU-2009' and currency = 'INR' and price = 299.00
  ) then
    raise exception 'the banner quotes ₹299 and the product does not';
  end if;
  if not exists (
    select 1 from public.product_prices
     where product_id = 'SKU-2009' and currency = 'AED' and price = 12.99
  ) then
    raise exception 'the UAE banner quotes AED 13 and the product does not';
  end if;
end $$;
