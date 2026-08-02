-- The last migration called every historical bill a rupee bill and left the
-- numbers alone. That was wrong, and wrong in the way that is hardest to see.
--
-- Every amount in this marketplace was seeded in dollars — an $18 mobile plan,
-- a $12.99 streaming add-on. Declaring those rows to be INR without touching
-- the figures produced a ₹18 mobile plan and a ₹416 monthly bill: internally
-- consistent, correctly taxed, adding up perfectly, and eighty-seven times too
-- cheap. Every assertion in that migration passed, because every one of them
-- checked the bill against itself.
--
-- A number is not converted by being relabelled. The two AED bills inherited
-- the error and then had it scaled by 3.6725/87.42, so they are wrong too.
--
-- What this does: takes each bill back to the dollars it was really in, then
-- converts it properly at the rate the row already carries. The rate is right —
-- only the arithmetic was skipped.
--
-- And it adds the check that would have caught it: a bill converted back to the
-- reporting currency has to land in a range a telecom bill actually occupies.
-- Every previous assertion compared the bill to itself, which is exactly why
-- none of them noticed the magnitude was absurd.

/* ============================================== back to what they cost === */

/* The AED bills first, because they carry the error twice — once from being
   relabelled and once from being converted out of the wrong label. Undoing the
   bad conversion recovers the original dollar figure. */
do $$
declare
  usdinr   numeric;
  aed_rate numeric;
  b        record;
  np numeric; ns numeric; no_ numeric; ntax numeric; trate numeric;
begin
  select f.rate into usdinr   from fx_rates f where f.base='USD' and f.quote='INR' and f.as_of='2026-08-01';
  select f.rate into aed_rate from fx_rates f where f.base='USD' and f.quote='AED' and f.as_of='2026-08-01';
  select m.tax_rate into trate from markets m where m.code = 'AE';

  for b in select * from consumer_bills where currency = 'AED' loop
    /* current = usd * aed_rate / usdinr, so usd = current * usdinr / aed_rate,
       and the figure wanted is usd * aed_rate — which is current * usdinr. */
    np   := round(b.plan_charge   * usdinr, 2);
    ns   := round(b.subscriptions * usdinr, 2);
    no_  := round(b.oneoff        * usdinr, 2);
    ntax := round((np + ns + no_) * trate / 100, 2);

    update consumer_bills set
      plan_charge = np, subscriptions = ns, oneoff = no_,
      tax = ntax, total = np + ns + no_ + ntax
     where id = b.id;
  end loop;
end $$;

/* The rupee bills were only relabelled, so converting them once at their own
   recorded rate is all that is owed. Each uses the rate on its own row — the
   whole reason that column exists. */
do $$
declare
  b record;
  np numeric; ns numeric; no_ numeric; ntax numeric; trate numeric;
begin
  select m.tax_rate into trate from markets m where m.code = 'IN';

  for b in select * from consumer_bills where currency = 'INR' loop
    np   := round(b.plan_charge   * b.fx_rate, 2);
    ns   := round(b.subscriptions * b.fx_rate, 2);
    no_  := round(b.oneoff        * b.fx_rate, 2);
    ntax := round((np + ns + no_) * trate / 100, 2);

    update consumer_bills set
      plan_charge = np, subscriptions = ns, oneoff = no_,
      tax = ntax, total = np + ns + no_ + ntax
     where id = b.id;
  end loop;
end $$;

/* Same on the business side. The one Kenyan invoice carries the doubled error;
   the rest were only relabelled. */
do $$
declare
  usdinr numeric;
  i      record;
  nr numeric; no_ numeric; ntax numeric; trate numeric;
begin
  select f.rate into usdinr from fx_rates f where f.base='USD' and f.quote='INR' and f.as_of='2026-08-01';

  for i in select * from enterprise_invoices loop
    select m.tax_rate into trate from markets m where m.code = i.market;

    if i.currency = 'INR' then
      nr := round(i.recurring * i.fx_rate, 2);
      no_ := round(i.oneoff   * i.fx_rate, 2);
    else
      /* Converted out of a wrong label, so the same undo as the AED bills. */
      nr := round(i.recurring * usdinr, 2);
      no_ := round(i.oneoff   * usdinr, 2);
    end if;

    ntax := round((nr + no_) * trate / 100, 2);
    update enterprise_invoices set
      recurring = nr, oneoff = no_, tax = ntax, total = nr + no_ + ntax
     where id = i.id;
  end loop;
end $$;

/* -------------------------------------------------------- sanity checks -- */
do $$
declare n integer; s text;
begin
  /* The check that was missing.
   *
   * Converted back to the reporting currency at the bill's own rate, a monthly
   * consumer telecom bill lands somewhere between a couple of dollars and a few
   * hundred. Anything outside that is a unit error, and a unit error is exactly
   * what every self-consistent assertion in the last migration sailed past. */
  select string_agg(id || ' (' || round(total / fx_rate, 2) || ' USD)', ', ') into s
    from consumer_bills where total / fx_rate < 2 or total / fx_rate > 2000;
  if s is not null then raise exception 'these consumer bills are not a plausible size: %', s; end if;

  /* A business invoice is bigger, but not unboundedly so. */
  select string_agg(id || ' (' || round(total / fx_rate, 2) || ' USD)', ', ') into s
    from enterprise_invoices where total / fx_rate < 10 or total / fx_rate > 500000;
  if s is not null then raise exception 'these invoices are not a plausible size: %', s; end if;

  /* A rupee bill should be a bigger number than a dirham bill for the same
     money, because a rupee is worth less. If that ordering is inverted, a
     conversion went the wrong way. */
  if (select avg(total) from consumer_bills where currency = 'INR')
     <= (select avg(total) from consumer_bills where currency = 'AED') then
    raise exception 'rupee bills are not larger than dirham bills, so a conversion is inverted';
  end if;

  /* And everything still reconciles, which is what the last migration checked
     and is necessary but nowhere near sufficient. */
  select string_agg(id, ', ') into s from consumer_bills
   where abs((plan_charge + subscriptions + oneoff + tax) - total) > 0.02;
  if s is not null then raise exception 'these bills no longer add up: %', s; end if;

  select string_agg(id, ', ') into s from enterprise_invoices
   where abs((recurring + oneoff + tax) - total) > 0.02;
  if s is not null then raise exception 'these invoices no longer add up: %', s; end if;

  select string_agg(id, ', ') into s from consumer_bills
   where abs(tax - (plan_charge + subscriptions + oneoff) * tax_rate / 100) > 0.02;
  if s is not null then raise exception 'the tax on these is not what their rate says: %', s; end if;

  select count(distinct currency) into n from consumer_bills;
  if n < 2 then raise exception 'every consumer bill is in one currency again'; end if;
end $$;
