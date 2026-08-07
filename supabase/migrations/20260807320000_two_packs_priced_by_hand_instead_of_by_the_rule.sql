/* Two packs I priced by typing a number.
 *
 * `federation.integration.test.ts` composes every first-party pack from its
 * stored components and asserts the stored price is exactly what the published
 * rule derives — the database and the pure module being two independent
 * evaluations of one rule, so that a disagreement means one of them has
 * drifted. Both new packs disagreed, and both times the module was right.
 *
 *   Family Safety Pack — 3 lines. Two components, so the pack discount is one
 *   step: 4% off $16.50 is $15.84. I published $14.85, which is 10% — a number
 *   I picked because it looked like a pack discount rather than because the
 *   rule produced it.
 *
 *   Digital Life Pack. Three components, two steps, 8% off $13.00 is $11.96.
 *   I published $11.70.
 *
 * The rule exists so that the price of a pack can be defended: "4% per extra
 * component, capped at 18%" is a policy, and $14.85 is somebody's preference.
 * A price under the derived one is not generous, it is unexplainable — the
 * operator screen prints the derivation beside the figure, and the two would
 * have disagreed on screen.
 *
 * The delivery costs were wrong too, and in the direction that flatters:
 * $7.20 against a real $6.45, $5.28 against a real $4.94. Margin is computed
 * from `cost`, so an invented cost is an invented margin on the operator's own
 * dashboard.
 */

update public.products set
  price = 15.84, cost = 6.45   /* 1.20 + 0.95, three times over */
 where id = 'SKU-FP9506';

update public.products set
  price = 11.96, cost = 4.94   /* 0.95 + 2.28 + 1.71 */
 where id = 'SKU-FP9507';

/* Each market's own money, discounted by the same rule rather than converted
   from the corrected dollar figure — which is what this build does everywhere
   else, and the reason a price is struck per market in the first place. */
update public.product_prices set price = 15.84 where product_id = 'SKU-FP9506' and currency = 'USD';
update public.product_prices set price = 1343.00 where product_id = 'SKU-FP9506' and currency = 'INR';
update public.product_prices set price = 58.55 where product_id = 'SKU-FP9506' and currency = 'AED';
update public.product_prices set price = 2063.00 where product_id = 'SKU-FP9506' and currency = 'KES';

update public.product_prices set price = 11.96 where product_id = 'SKU-FP9507' and currency = 'USD';
update public.product_prices set price = 1011.00 where product_id = 'SKU-FP9507' and currency = 'INR';
update public.product_prices set price = 44.15 where product_id = 'SKU-FP9507' and currency = 'AED';
update public.product_prices set price = 1544.00 where product_id = 'SKU-FP9507' and currency = 'KES';

/* And a third, for a different reason. Reseller Starter was re-based from the
   retail prepaid item onto wholesale capacity in the migration before this —
   which is the right component and a cheaper one, $7.80 a line against $9.00.
   Its price was left where the old component put it, so the pack was carrying
   a rate-card total it no longer had. The saving belongs to the reseller: they
   are buying wholesale capacity, and wholesale is what it now costs. */
update public.products set
  price = 988.80, was_price = 1030.00, list_price = 1030.00,
  cost = 547.00   /* (4.52 + 0.95) × 100 */
 where id = 'SKU-FP9505';

update public.product_prices set price = 988.80,   was_price = 1030.00,   list_price = 1030.00   where product_id = 'SKU-FP9505' and currency = 'USD';
update public.product_prices set price = 86399.00, was_price = 89999.00,  list_price = 89999.00  where product_id = 'SKU-FP9505' and currency = 'INR';
update public.product_prices set price = 3647.00,  was_price = 3799.00,   list_price = 3799.00   where product_id = 'SKU-FP9505' and currency = 'AED';
update public.product_prices set price = 129599.00, was_price = 134999.00, list_price = 134999.00 where product_id = 'SKU-FP9505' and currency = 'KES';

/* The 500-line pack is one rate-card item resold as it stands, so no pack
   discount applies and the composition test skips it. Two things about it were
   still untrue: its stored cost was zero, and the note I wrote on its component
   claimed a volume discount against a rate card that is now the wholesale one.
   The discount IS the wholesale rate — $7.80 a line against $9.00 retail — and
   claiming a second one on top of it would be claiming it twice. */
update public.products set cost = 2260.00 where id = 'SKU-7002';

update public.product_telco_components set
  note = 'Five hundred lines of wholesale data capacity at $7.80 a line — the wholesale rate card, against $9.00 for a retail prepaid line. The reseller onboards the subscribers in its own channel.'
 where product_id = 'SKU-7002' and telco_id = 'TP-WHL-DATA';

/* The review record quoted the figure it approved, and it approved the wrong
   one. Left disagreeing, it is a decision note that contradicts the product. */
update public.operator_listings set
  decision_reason = 'Composed from 2 rate-card components across 3 lines at $16.50, less the 4% pack discount, published at $15.84.'
 where id = 'ol-9506-fp';
update public.operator_listings set
  decision_reason = 'Composed from 3 rate-card components at $13.00, less the 8% pack discount, published at $11.96.'
 where id = 'ol-9507-fp';

/* ---- And the photographs ------------------------------------------------------ */

/* `product_media` is what the operator's catalogue shows; `images.ts` is what
   every buyer-facing screen shows. They are reconciled for the federated packs
   and must not diverge on a product whose photo was chosen deliberately. Two of
   the six I seeded reused a photo already carrying another product — and one of
   them, SKU-2010, was given a picture of a family for a travel eSIM.
   These are the URLs `images.ts` now holds. */
update public.product_media set
  url = 'https://images.pexels.com/photos/4482900/pexels-photo-4482900.jpeg?auto=compress&cs=tinysrgb&w=600',
  alt = 'An eSIM profile shown on a screen'
 where id = 'pm-2010-h';
update public.product_media set
  url = 'https://images.pexels.com/photos/3184465/pexels-photo-3184465.jpeg?auto=compress&cs=tinysrgb&w=600',
  alt = 'A family with phones between them'
 where id = 'pm-2009-h';
update public.product_media set
  url = 'https://images.pexels.com/photos/4226140/pexels-photo-4226140.jpeg?auto=compress&cs=tinysrgb&w=600',
  alt = 'A household with their phones out'
 where id = 'pm-9506-h';
update public.product_media set
  url = 'https://images.pexels.com/photos/2881229/pexels-photo-2881229.jpeg?auto=compress&cs=tinysrgb&w=600',
  alt = 'A protected device'
 where id = 'pm-9507-h';

/* ---- Assertions --------------------------------------------------------------- */

do $$
declare r record; derived numeric; list numeric; pct numeric; n int;
begin
  /* The same arithmetic the pure module does, done here independently — which
     is the whole point of the test that caught this. If these two ever
     disagree again, one of the three has drifted rather than two of them. */
  for r in
    select p.id, p.name, p.price, p.was_price, p.cost,
           count(*) as parts,
           sum(t.rc * c.quantity) as rc_total,
           sum(t.cost_rc * c.quantity) as cost_total
      from public.products p
      join public.product_telco_components c on c.product_id = p.id
      join public.telco_catalogue t on t.id = c.telco_id
     where p.id in ('SKU-FP9506','SKU-FP9507','SKU-FP9505')
     group by p.id, p.name, p.price, p.was_price, p.cost
  loop
    select b.per_component, b.max_discount into pct, n
      from public.bundle_rules b where b.id = 'standard';
    pct := least(n, (r.parts - 1) * pct);
    list := r.rc_total;
    derived := round(list * (1 - pct / 100), 2);

    if r.price <> derived then
      raise exception '% is published at % and the rule derives %', r.name, r.price, derived;
    end if;
    if r.was_price <> list then
      raise exception '% claims a rate-card total of % against a real %', r.name, r.was_price, list;
    end if;
    if r.cost <> r.cost_total then
      raise exception '% carries a cost of % against a real %', r.name, r.cost, r.cost_total;
    end if;
  end loop;

  /* And every currency still holds a price. Correcting one of four is the
     failure this kind of fix invites. */
  select count(*) into n from public.products p
   where p.id in ('SKU-FP9506','SKU-FP9507','SKU-FP9505')
     and (select count(*) from public.product_prices q where q.product_id = p.id) <> 4;
  if n > 0 then raise exception '% of the three packs lost a currency', n; end if;

  /* The band still holds after the price moved. */
  select count(*) into n from public.product_prices
   where product_id in ('SKU-FP9506','SKU-FP9507','SKU-FP9505')
     and (floor_price > price or list_price < price);
  if n > 0 then raise exception '% prices fall outside their own floor and list', n; end if;
end $$;
