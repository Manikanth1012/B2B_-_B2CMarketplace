-- The rule is enforced and the data cannot show it.
--
-- RLS on `product_prices` already restricts a seller to the currencies of the
-- markets they are approved in: the write policy joins `partner_markets` to
-- `market_currencies` and refuses anything outside it. That is correct and it
-- has been correct for several migrations.
--
-- But eleven of the fifteen sellers are approved in all three markets and the
-- other four hold a single grant, so no row in the seeded data looks like the
-- case the rule exists for — a seller trading in some markets and not others.
-- On the screen, a rule that never binds is indistinguishable from a rule that
-- is not there, and in the tests it is a policy every fixture satisfies.
--
-- Beacon Reseller Co is registered in Kenya. It sells in Kenya and the UAE and
-- not in India, which makes it the example: it may price in KES and USD for
-- Nairobi and AED and USD for Dubai, and the database refuses it a rupee price.
-- Its one listing already had an INR row, written before the grants meant
-- anything, and that row is removed here — leaving it would be the marketplace
-- holding a price the seller is not allowed to set.

update partner_markets
   set state = 'suspended',
       note = 'Not approved for India. Beacon is a Kenyan reseller trading in East Africa and the Gulf; the Indian market was never part of the agreement.',
       approved_at = null, approved_by = null
 where partner_id = 'PTR-1009' and market_code = 'IN';

/* The price it was never entitled to set. Removed rather than left, because a
   listing priced in a market its seller cannot trade in is a shelf nobody can
   settle a sale from. */
delete from product_prices pp
 using products p
 where p.id = pp.product_id
   and p.partner_id = 'PTR-1009'
   and not exists (
     select 1 from partner_markets pm
       join market_currencies mc on mc.market_code = pm.market_code
      where pm.partner_id = p.partner_id and pm.state = 'approved'
        and mc.currency = pp.currency);

/* -------------------------------------------------------- sanity checks -- */
do $$
declare n integer; s text;
begin
  /* No seller holds a price in a currency none of their approved markets take.
     Ranged over every seller rather than the one this migration touched — the
     rule is the marketplace's, not Beacon's. */
  select string_agg(p.partner_id || ' prices ' || p.id || ' in ' || pp.currency, '; ') into s
    from product_prices pp
    join products p on p.id = pp.product_id
   where p.partner_id is not null
     and not exists (
       select 1 from partner_markets pm
         join market_currencies mc on mc.market_code = pm.market_code
        where pm.partner_id = p.partner_id and pm.state = 'approved'
          and mc.currency = pp.currency);
  if s is not null then raise exception 'these sellers price in money they may not trade in: %', s; end if;

  /* And the case now exists. Without this the assertion above passes on a
     marketplace where every seller is approved everywhere, which is what it did
     before today and why the rule was invisible. */
  select count(*) into n from (
    select pm.partner_id
      from partner_markets pm
     group by pm.partner_id
    having count(*) filter (where pm.state = 'approved') between 2 and (select count(*) - 1 from markets)
  ) x;
  if n = 0 then
    raise exception 'no seller trades in some markets and not others, so the restriction proves nothing';
  end if;

  /* Beacon can still sell somewhere — suspending its last market would be a
     different change, and `guard_market_currency_removal` exists for that. */
  select count(*) into n from partner_markets
   where partner_id = 'PTR-1009' and state = 'approved';
  if n < 2 then raise exception 'Beacon is left trading in % markets', n; end if;

  /* What it may price in is exactly the union of its markets' currencies. */
  select string_agg(mc.currency, ',' order by mc.currency) into s
    from partner_markets pm
    join market_currencies mc on mc.market_code = pm.market_code
   where pm.partner_id = 'PTR-1009' and pm.state = 'approved';
  if s is distinct from 'AED,KES,USD,USD' and s is distinct from 'AED,KES,USD' then
    raise exception 'Beacon may price in %, which is not what Kenya and the UAE take', s;
  end if;
end $$;
