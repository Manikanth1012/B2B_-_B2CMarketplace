/* One shelf price that did not mean what the shelf beside it meant.
 *
 * Every consumer product on this marketplace is priced with its tax inside —
 * twenty-three of them say so on their own page, "including tax", and the
 * basket has always treated a shelf price as what the shopper pays.
 *
 * `SKU-5005`, the TrackWise Asset Tracker Pro, is sold to consumers and
 * enterprises both, and carried `price_includes_tax = false`. Two things
 * followed, in opposite directions:
 *
 *   - Its product page said "excluding tax" while every other consumer listing
 *     said the reverse, so the same shelf offered two meanings of a number.
 *   - `basketMoney` did not read the flag at all, so had anybody bought one the
 *     tax would have been worked *out* of the price instead of added to it, and
 *     the marketplace would have paid the buyer's VAT out of its own margin
 *     without anything on any screen looking wrong.
 *
 * The code half is fixed alongside this: the basket now reads the flag, so an
 * exclusive price genuinely has tax added. That makes this row the one place
 * where the policy and the data disagree, and the policy is the one every
 * consumer page already states. So the row moves.
 *
 * The thirteen enterprise-only and five partner listings stay exclusive, which
 * is correct: business pricing is quoted before tax nearly everywhere, and the
 * requisition and invoice paths already work that way through `bases()`.
 */

begin;

update products
   set price_includes_tax = true
 where id = 'SKU-5005';

do $$
declare
  n int;
  who text;
begin
  /* The rule this migration exists to make true: nothing a shopper can put in a
     basket is quoted before tax. If a later listing breaks it, the basket will
     add tax to a price the product page said was inclusive, and the two screens
     will disagree about the same number. */
  select count(*), string_agg(id || ' (' || name || ')', ', ')
    into n, who
    from products
   where status = 'live'
     and audiences && array['consumer']
     and price_includes_tax = false;
  if n <> 0 then
    raise exception 'a shopper can buy % listing(s) quoted before tax: %', n, who;
  end if;

  /* And the business side is untouched, or this migration has quietly
     re-priced thirteen enterprise listings. */
  select count(*) into n from products
   where status = 'live' and not (audiences && array['consumer'])
     and price_includes_tax = false;
  if n < 15 then
    raise exception 'the business listings were flipped too — only % remain exclusive', n;
  end if;
end $$;

commit;
