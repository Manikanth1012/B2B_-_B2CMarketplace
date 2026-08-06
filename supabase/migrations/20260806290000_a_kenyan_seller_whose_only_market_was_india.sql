/* A Kenyan seller whose only market was India.
 *
 * Vertex Endpoint is registered in Kenya. Its four settlement statements are
 * raised in USD and paid out in KES, which is exactly what selling in Kenya
 * looks like — the market trades KES and USD, a seller can earn the second and
 * be paid in the first. Everything about the money is right.
 *
 * Its single `partner_markets` row said India.
 *
 * India trades INR and nothing else, so on paper this seller earned four months
 * of dollars in a market that has never taken one, and was paid in a currency
 * belonging to a market it was not linked to at all. Nothing in the UI shows
 * it, because a suspended seller's statements are read from the statement rows
 * and nobody joins back to ask which market they could have come from.
 *
 * The market link is the wrong fact, not the money. Corrected to Kenya, and
 * left suspended because the partner is suspended — a market approval that
 * outlives the seller's own standing is the next version of this bug.
 *
 * The rest of the platform came through the same audit clean: every listed
 * product is priced in a currency its market trades, every seller with an
 * approved market has a price there and a bank account to be paid into, no
 * consumer order or enterprise invoice is in a currency its market does not
 * take, and no loyalty movement is in a currency its member does not hold.
 *
 * The one thing that looked wrong and was not: Wanjiru Kamau holds a USD
 * subscription while her account currency is KES. Kenya trades both and she
 * bought it in dollars. A check that compares a subscription against the
 * customer's default currency rather than against what their market trades
 * reports that as a fault, which is why the view below compares against the
 * market.
 */

begin;

/* ---- The correction ------------------------------------------------------ */

update partner_markets
   set market_code = 'KE',
       note = 'Corrected from IN. The company is registered in Kenya and every '
              || 'settlement it has is USD gross paid out in KES, which is a '
              || 'Kenyan arrangement — India trades INR only and could not have '
              || 'produced them.'
 where partner_id = 'PTR-1015' and market_code = 'IN';

/* ---- Somewhere to see it next time --------------------------------------- */

/* The audit as a view rather than as a query somebody has to remember. Each row
   is a fact that should not be true; an empty result is the invariant.
   Deliberately compares currencies against what a *market* trades rather than
   against a party's default, because a market with two currencies is the whole
   point of `market_currencies` and a check that ignores it condemns every
   legitimate second-currency purchase. */
create or replace view market_consistency as
with mc as (select market_code, currency from market_currencies)

  select 'listing priced into a market its seller cannot sell in' as finding,
         p.id as subject,
         p.seller || ' is not approved anywhere trading ' || pp.currency as detail
    from products p
    join product_prices pp on pp.product_id = p.id
   where p.partner_id is not null
     and not exists (
       select 1 from partner_markets pm join mc on mc.market_code = pm.market_code
        where pm.partner_id = p.partner_id and pm.state = 'approved' and mc.currency = pp.currency)

union all
  select 'listed in a market it has no price for',
         pmk.product_id,
         'listed in ' || pmk.market_code || ' with no price in any currency that market trades'
    from product_markets pmk
   where not exists (
     select 1 from product_prices pp join mc on mc.currency = pp.currency
      where pp.product_id = pmk.product_id and mc.market_code = pmk.market_code)

union all
  select 'settled in a currency no market it is linked to trades',
         s.id,
         s.partner_name || ' settled in ' || s.currency
    from settlement_statements s
   where s.partner_id is not null
     and not exists (
       select 1 from partner_markets pm join mc on mc.market_code = pm.market_code
        where pm.partner_id = s.partner_id and mc.currency = s.currency)

union all
  select 'converted on payout with no rate recorded',
         s.id,
         s.currency || ' to ' || s.payout_currency || ' and no fx_rate or fx_as_of'
    from settlement_statements s
   where s.payout_currency is not null and s.payout_currency <> s.currency
     and (s.fx_rate is null or s.fx_as_of is null)

union all
  select 'consumer order in a currency their market does not trade',
         o.order_ref,
         o.buyer_name || ' in ' || o.market || ' paid ' || o.currency
    from orders o
   where o.market is not null and o.currency is not null
     and not exists (select 1 from mc where mc.market_code = o.market and mc.currency = o.currency)

union all
  select 'enterprise invoice in a currency their market does not take',
         i.id,
         a.company || ' in ' || i.market || ' billed ' || i.currency
    from enterprise_invoices i
    join enterprise_accounts a on a.id = i.account_id
   where not exists (select 1 from mc where mc.market_code = i.market and mc.currency = i.currency)

union all
  select 'loyalty movement in a currency its member does not hold',
         l.id,
         m.name || ' holds ' || m.currency || ', movement in ' || l.currency
    from loyalty_ledger l join loyalty_members m on m.id = l.member
   where l.currency <> m.currency

union all
  select 'live listing behind a seller that is not live',
         p.id,
         pt.name || ' is ' || pt.status
    from products p join partners pt on pt.id = p.partner_id
   where p.status = 'live' and pt.status <> 'live'

union all
  select 'market approval outliving the seller''s own standing',
         pm.partner_id,
         pt.name || ' is ' || pt.status || ' but ' || pm.market_code || ' is ' || pm.state
    from partner_markets pm join partners pt on pt.id = pm.partner_id
   where pt.status <> 'live' and pm.state = 'approved'

union all
  select 'approved to sell with nowhere to be paid',
         pt.id,
         pt.name || ' has approved markets and no bank account'
    from partners pt
   where pt.status = 'live'
     and exists (select 1 from partner_markets pm where pm.partner_id = pt.id and pm.state = 'approved')
     and not exists (select 1 from partner_bank b where b.partner_id = pt.id);

comment on view market_consistency is
  'Facts that should not be true about markets, currencies and who may sell where. '
  'An empty result is the invariant. Compares against what a market trades, not '
  'against a party''s default currency — a market may trade more than one.';

grant select on market_consistency to authenticated;

/* ---- What this asserts --------------------------------------------------- */

do $$
declare
  n int;
  worst text;
begin
  select count(*) into n from market_consistency;
  if n <> 0 then
    select finding || ' — ' || subject || ' — ' || detail into worst from market_consistency limit 1;
    raise exception 'the platform is % market/currency facts inconsistent, e.g. %', n, worst;
  end if;

  /* Vertex specifically: Kenyan company, Kenyan market, and the USD it was
     actually settled in is a currency that market trades. */
  if not exists (
    select 1 from partner_markets where partner_id = 'PTR-1015' and market_code = 'KE'
  ) then
    raise exception 'Vertex Endpoint is still not linked to the market it is registered in';
  end if;
  if exists (select 1 from partner_markets where partner_id = 'PTR-1015' and market_code = 'IN') then
    raise exception 'Vertex Endpoint is still linked to India';
  end if;

  /* And the legitimate case is still legitimate: Wanjiru's USD subscription in
     a KES account survives, because Kenya trades both. If this ever fails, the
     view has started condemning the second-currency purchase it was written to
     allow. */
  if not exists (
    select 1 from subscriptions s
      join consumer_profile c on c.user_id = s.user_id
     where c.market = 'KE' and c.currency = 'KES' and s.currency = 'USD'
  ) then
    raise exception 'the two-currency buyer case has gone missing from the seed';
  end if;
end $$;

commit;
