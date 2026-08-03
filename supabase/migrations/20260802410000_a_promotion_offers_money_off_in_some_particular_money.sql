-- I changed the prose and left the number.
--
-- `20260802370000` rewrote promo-002's description to "₹20,000 off IoT orders
-- over ₹1,00,000" because it was quoting dollars at a shelf priced in rupees.
-- Underneath it, `effect_value` is still 200 and `conditions.min_cart` is still
-- 1000. So the screen now reads a rupee sentence over a dollar discount, which
-- is worse than the dollar sentence was: before, the two agreed and were both
-- wrong; now they disagree and nothing compares them.
--
-- That is the exact failure this series keeps catching in other people's work,
-- committed by me, two migrations ago. It happened because the sweep that found
-- the prose searched text columns and a promotion's amount is a numeric one, so
-- nothing connected the sentence to the figure it describes. The assertion at
-- the bottom connects them.
--
-- Everything here is restated into the default market's money. A promotion is
-- an offer to a customer, and the customers on this marketplace are in India,
-- the UAE and Kenya — not in the reporting currency. Budgets are chosen round
-- figures; what has been spent against them keeps the proportion it had, since
-- "64% of budget used" is the fact the screen is actually showing.

alter table operator_promotions add column if not exists currency text references currencies(code);
/* `public_banners` is a view over `operator_banners` and picks the column up on
   its own — which is also why `20260802370000` updating "both tables" was one
   table twice. Harmless there, worth knowing here. */
alter table operator_banners   add column if not exists currency text references currencies(code);

comment on column operator_promotions.currency is
  'The money this promotion''s amounts are in — the discount, the minimum basket and the budget. A customer-facing offer, so the market''s currency and not the marketplace''s reporting one.';
comment on column operator_banners.currency is
  'The reporting currency the attributed revenue is expressed in. A rollup across markets, already converted.';

do $$
declare
  home text;      -- the default market's currency: what customers are offered
  report text;    -- the reporting currency: what the marketplace counts in
  p record;
  ratio numeric;
begin
  select currency into home from markets where is_default;
  select code into report from currencies where is_reporting;

  update operator_promotions set currency = home where currency is null;
  update operator_banners   set currency = report where currency is null;

  for p in select * from operator_promotions loop
    /* What proportion of the budget had gone. Captured before the budget moves,
       because that proportion is the only thing on the screen that was true. */
    ratio := case when p.budget > 0 then p.spent / p.budget else 0 end;

    update operator_promotions set
      /* Only a fixed-amount effect is money. A percentage is a percentage in
         every currency, and "1 free month" is a month. */
      effect_value = case when p.effect_type = 'fixed' then 20000 else p.effect_value end,
      conditions = case
        when p.conditions ? 'min_cart'
          /* A minimum basket is a chosen threshold, so it lands on a round
             number a person would write rather than on a converted one. */
          then jsonb_set(p.conditions, '{min_cart}',
                 to_jsonb(round((p.conditions->>'min_cart')::numeric * 100 / 1000) * 1000))
        else p.conditions end,
      budget = round(p.budget * 100 / 25000) * 25000,
      currency = home
     where id = p.id;

    update operator_promotions set spent = round(budget * ratio) where id = p.id;
  end loop;

end $$;

/* The description is written by hand and is the thing that drifted, so it is
   rebuilt from the figures rather than left to agree by luck. Outside the block
   above because `p` in there is a loop record, and a table alias that shadows
   one resolves to the record — the same shadowing that bit `20260802370000`. */
update operator_promotions pr set description =
  money_text(pr.effect_value, pr.currency) || ' off IoT orders over '
  || money_text((pr.conditions->>'min_cart')::numeric, pr.currency)
 where pr.id = 'promo-002';

update operator_promotions pr set description =
  pr.effect_value || '% off all devices, on baskets over '
  || money_text((pr.conditions->>'min_cart')::numeric, pr.currency)
 where pr.id = 'promo-001';

update operator_promotions pr set description =
  pr.effect_value || ' months free on annual content subs, on baskets over '
  || money_text((pr.conditions->>'min_cart')::numeric, pr.currency)
 where pr.id = 'promo-006';

alter table operator_promotions alter column currency set not null;
alter table operator_banners   alter column currency set not null;

/* -------------------------------------------------------- sanity checks -- */
do $$
declare n integer; s text;
begin
  /* The sentence and the figure agree. This is the check that did not exist
     when `20260802370000` rewrote the sentence and not the figure — the sweep
     it ran searched text columns, and a promotion's amount lives in a numeric
     one, so nothing joined the two. */
  select string_agg(p.id || ': "' || p.description || '" over an effect of '
                    || money_text(p.effect_value, p.currency), '; ') into s
    from operator_promotions p
   where p.effect_type = 'fixed'
     and p.description not like '%' || money_text(p.effect_value, p.currency) || '%';
  if s is not null then raise exception 'these promotions describe an amount they do not offer: %', s; end if;

  select string_agg(p.id || ': "' || p.description || '" over a minimum of '
                    || money_text((p.conditions->>'min_cart')::numeric, p.currency), '; ') into s
    from operator_promotions p
   where p.conditions ? 'min_cart'
     and p.description like '%over%'
     and p.description not like '%' || money_text((p.conditions->>'min_cart')::numeric, p.currency) || '%';
  if s is not null then raise exception 'these promotions name a minimum basket they do not require: %', s; end if;

  /* A discount bigger than the basket that qualifies for it is free money. */
  select string_agg(p.id || ': ' || p.effect_value || ' off a minimum of '
                    || (p.conditions->>'min_cart'), '; ') into s
    from operator_promotions p
   where p.effect_type = 'fixed' and p.conditions ? 'min_cart'
     and p.effect_value >= (p.conditions->>'min_cart')::numeric;
  if s is not null then raise exception 'these promotions give away more than the basket they need: %', s; end if;

  /* Nothing has overspent its budget, and nothing spent a different share of it
     than it did before. */
  select string_agg(id || ': ' || spent || ' of ' || budget, '; ') into s
    from operator_promotions where spent > budget;
  if s is not null then raise exception 'these promotions are over budget: %', s; end if;

  /* Plausibility. Every check above compares a row to itself. */
  select string_agg(id || ': ' || budget || ' ' || currency, '; ') into s
    from operator_promotions where currency in ('INR', 'KES') and budget < 10000;
  if s is not null then raise exception 'these budgets look like dollar figures wearing a rupee label: %', s; end if;

  select count(*) into n from operator_promotions where effect_type = 'fixed';
  if n = 0 then raise exception 'no fixed-amount promotions were found, so the amount checks proved nothing'; end if;
end $$;
