-- Retail bills were charging about nine percent. Everything else charges
-- eighteen.
--
-- `enterprise_invoices` carries a `tax_rate` column and every row in it says
-- 18.00, which is GST on telecom services in India — where the issuing entity
-- is registered, and what the tax registration on the face of every document
-- refers to. `consumer_bills` carried no rate at all, only an amount, and the
-- amounts implied 8.96% to 9.06% across seven bills. Not a rate: a number
-- somebody typed, seven times, near a number.
--
-- The drift is the point. One table recorded its rate and one recorded only
-- the result, so there was nothing to disagree with and nothing to check. A
-- figure with no stated basis cannot be wrong, which is why it was.
--
-- So: retail bills get the same `tax_rate` column, and the tax and totals are
-- recomputed from the charges at the rate that was always meant. The charges
-- themselves do not move — a plan is £18.00 and a handset is £129.00 whatever
-- the tax on them is — and neither does anything downstream, because nothing
-- references these rows: no foreign key, no wallet entry, no loyalty movement,
-- no dunning case. That was checked rather than assumed.
--
-- Bills already sent to a customer would normally be untouchable. These are
-- demo records that have never been sent to anybody, and leaving a marketplace
-- that bills one rate in one console and another rate in another is the worse
-- of the two wrongs.

alter table consumer_bills add column if not exists tax_rate numeric not null default 18;

/* The charges stay; the tax follows them. Rounded half-up to the cent, which
   is what `invoice_templates.rounding` says the marketplace does. */
update consumer_bills set
  tax = round((plan_charge + subscriptions + oneoff) * tax_rate / 100, 2),
  total = (plan_charge + subscriptions + oneoff)
        + round((plan_charge + subscriptions + oneoff) * tax_rate / 100, 2);

/* ------------------------------------------------------- sanity checks -- */
do $$
declare n integer; s text;
begin
  /* Every retail bill now charges the rate it states. */
  select string_agg(id, ', ') into s from consumer_bills
   where tax <> round((plan_charge + subscriptions + oneoff) * tax_rate / 100, 2);
  if s is not null then raise exception 'these bills charge a tax their own rate does not produce: %', s; end if;

  /* And adds up. A summary that does not reconcile is the one thing a bill
     may not be. */
  select string_agg(id, ', ') into s from consumer_bills
   where total <> (plan_charge + subscriptions + oneoff) + tax;
  if s is not null then raise exception 'these bills do not add up: %', s; end if;

  /* The same for the business side, which was already right and is asserted
     here so the two are checked by one rule from now on. */
  select string_agg(id, ', ') into s from enterprise_invoices
   where tax <> round((recurring + oneoff) * tax_rate / 100, 2);
  if s is not null then raise exception 'these invoices charge a tax their own rate does not produce: %', s; end if;

  select string_agg(id, ', ') into s from enterprise_invoices
   where total <> (recurring + oneoff) + tax;
  if s is not null then raise exception 'these invoices do not add up: %', s; end if;

  /* One jurisdiction, one rate. Two rates would be defensible — a marketplace
     can sell across borders — but not two rates for the same tax in the same
     country under the same registration, which is what this fixes. */
  select count(distinct r) into n from (
    select tax_rate r from consumer_bills
    union select tax_rate from enterprise_invoices
  ) x;
  if n <> 1 then
    select string_agg(distinct r::text, ', ') into s from (
      select tax_rate r from consumer_bills
      union select tax_rate from enterprise_invoices
    ) y;
    raise exception 'the marketplace charges % different tax rates under one registration: %', n, s;
  end if;

  /* The rate is the one the issuing entity is registered for. */
  select count(*) into n from consumer_bills where tax_rate <> 18;
  if n > 0 then raise exception '% retail bills are not at the Indian GST rate on telecom services', n; end if;

  /* Nothing downstream referenced these totals — asserted rather than
     remembered, because the next person to change them will want to know. */
  select count(*) into n from pg_constraint where confrelid = 'consumer_bills'::regclass;
  if n > 0 then raise exception '% things now reference consumer_bills; this migration assumed nothing did', n; end if;

  /* The open bill is still the open bill, at its new figure. */
  select count(*) into n from consumer_bills where status = 'open';
  if n <> 1 then raise exception 'there are % open retail bills rather than 1', n; end if;
end $$;
