/* Financing, instalments and EMI.
 *
 * A ₹64,999 handset is the most expensive thing on the shelf and the checkout
 * offers seven ways to pay all of it today. Every marketplace this competes
 * with spreads it — card EMI in India, Tabby and Tamara in the Emirates, Lipa
 * Later in Kenya — and the seller sees a materially larger basket for it.
 *
 * WHAT THE MARKETPLACE IS DOING, AND WHAT IT IS NOT.
 *
 * It is not lending. The financier pays the marketplace in full on the day, the
 * customer owes the financier and not us, and the credit decision is made at
 * the financier against their own rules. That has three consequences the model
 * has to carry rather than gloss:
 *
 *   The seller's settlement is unaffected. They sold a handset for ₹64,999 and
 *   are settled on ₹64,999, whatever instalment plan the buyer took. Nothing in
 *   `settlement_lines` should know this method exists.
 *
 *   The tenure is chosen at the financier, not here. This checkout can say what
 *   is typically offered; it cannot promise twenty-four months to somebody the
 *   bank will offer six. So the plan comes back on the attempt rather than
 *   going out on it.
 *
 *   A decline is a credit decline. "Your card was declined" and "you were not
 *   approved for this plan" are different sentences to receive, and the second
 *   one needs to leave the customer somewhere to go.
 *
 * THE CEILING BUG THIS ALSO FIXES.
 *
 * `payment_methods.max_amount` is one number for every market. Carrier billing
 * carries 30,000 on it, which is a sane monthly cap in rupees, an absurd one in
 * dirhams and a tight one in shillings — the same figure standing for three
 * different amounts of money. Financing needs a floor as well as a ceiling and
 * would have inherited the same bug, so the limits move to
 * `payment_method_markets`, where the market's currency is known.
 */

/* ---- 1. Limits belong where the currency is known ---------------------------- */

alter table public.payment_method_markets
  add column if not exists min_amount numeric(12,2),
  add column if not exists max_amount numeric(12,2);

do $$ begin
  alter table public.payment_method_markets
    add constraint payment_method_markets_band
    check (min_amount is null or max_amount is null or min_amount <= max_amount);
exception when duplicate_object then null; end $$;

comment on column public.payment_method_markets.min_amount is
  'In this market''s own currency. A floor exists on financing because nobody '
  'underwrites a four-dollar instalment plan.';

/* The one that was already wrong. 30,000 was written for India and applied to
   three markets; these are the real caps in each market's money. */
update public.payment_method_markets set max_amount = 30000.00
 where method_id = 'carrier_billing' and market_code = 'IN';
update public.payment_method_markets set max_amount = 1500.00
 where method_id = 'carrier_billing' and market_code = 'AE';
update public.payment_method_markets set max_amount = 40000.00
 where method_id = 'carrier_billing' and market_code = 'KE';

/* ---- 2. What a financed method is ------------------------------------------- */

alter table public.payment_methods
  add column if not exists financed boolean not null default false,
  /* What the provider typically offers. Indicative on purpose — see below. */
  add column if not exists tenures integer[],
  add column if not exists credit_note text,
  /* Financing a recurring charge is not a thing. You cannot take twelve months
     to pay a monthly subscription; the second instalment arrives with the next
     month's charge and the customer is now paying two of everything. */
  add column if not exists one_off_only boolean not null default false;

do $$ begin
  alter table public.payment_methods
    add constraint payment_methods_financed_says_so
    check (not financed or (credit_note is not null and tenures is not null and one_off_only));
exception when duplicate_object then null; end $$;

comment on column public.payment_methods.tenures is
  'What the financier typically offers, for the checkout to show an indicative '
  'monthly figure. The plan a customer actually gets is decided at the '
  'financier and comes back on the attempt.';

/* `kind` drives what the provider's page asks for, and financing genuinely asks
   for something no existing kind does — a plan to choose. Two new kinds rather
   than reusing 'card', which would produce an EMI page asking for a CVV and
   nothing else. */
alter table public.payment_methods drop constraint if exists payment_methods_kind_check;
alter table public.payment_methods add constraint payment_methods_kind_check
  check (kind in ('card','netbanking','upi','mobile_money','bank_transfer',
                  'mobile_wallet','carrier_billing','emi','bnpl'));

insert into public.payment_methods
  (id, label, kind, blurb, redirects, asks_for, typical, sort_order,
   financed, tenures, credit_note, one_off_only) values

  ('emi', 'EMI on your card', 'emi',
   'Split the cost over monthly instalments on a credit card you already hold. Your bank decides the plan and how much interest, if any, it carries.',
   true,
   'Your card, then the plan your bank offers you and its own one-time code',
   'two or three minutes', 8,
   true, array[3, 6, 9, 12, 18, 24],
   'The instalment agreement is with your card issuer, not with Aventa. We are paid in full today; you repay your bank on the terms they show you before you confirm. Interest, if any, is theirs to state.',
   true),

  ('bnpl', 'Pay in instalments', 'bnpl',
   'Take the item now and pay in a few equal instalments. The provider runs a quick check and tells you straight away whether you are approved.',
   true,
   'Your mobile number and a one-time code, then a short eligibility check',
   'about two minutes', 9,
   true, array[3, 4, 6],
   'The instalment agreement is with the provider, not with Aventa. They decide whether you are approved and on what terms, and they tell you before you confirm. A missed instalment is between you and them, and may carry their fee.',
   true)
on conflict (id) do nothing;

/* ---- 3. Where each is offered, by whom, and between what amounts ------------- */

/* Real providers in each market, because a list of invented financiers tells a
   reader this is a mock more loudly than the label that says so. */
insert into public.payment_method_markets
  (method_id, market_code, provider, sort_order, min_amount, max_amount) values
  ('emi',  'IN', 'Razorpay · HDFC, ICICI, Axis and SBI credit cards',        8,  3000.00, 500000.00),
  ('emi',  'AE', 'Network International · ADCB, Emirates NBD and Mashreq',   8,   400.00,  75000.00),
  /* Not Kenya. Card EMI needs a domestic credit-card issuing base that is not
     there — offering it would be a redirect to a provider with nothing to
     offer, which is worse than not offering it. */

  ('bnpl', 'IN', 'Simpl · LazyPay',    9,  1500.00,  60000.00),
  ('bnpl', 'AE', 'Tabby · Tamara',     9,   200.00,   9000.00),
  ('bnpl', 'KE', 'Lipa Later',         9,  3000.00, 300000.00)
on conflict (method_id, market_code) do nothing;

/* ---- 4. What came back from the financier ----------------------------------- */

alter table public.payment_attempts
  /* The plan the customer was actually approved for. Null on every method that
     is not financing, and null on a financed attempt that has not come back —
     which is the difference between "no plan" and "not yet". */
  add column if not exists tenure_months integer check (tenure_months is null or tenure_months between 2 and 60),
  add column if not exists financier text,
  add column if not exists instalment numeric(12,2);

do $$ begin
  alter table public.payment_attempts
    add constraint payment_attempts_plan_is_whole
    check ((tenure_months is null) = (instalment is null));
exception when duplicate_object then null; end $$;

comment on column public.payment_attempts.instalment is
  'What the financier said each instalment would be, in the attempt''s own '
  'currency. Stored rather than divided at render: a plan may carry interest, '
  'and amount/tenure would quietly under-report what the customer agreed to.';

/* A financed attempt that succeeded has to say what plan it succeeded on.
   Without this the order shows "paid by EMI" and nobody — customer, support or
   auditor — can say over how long. */
create or replace function public.guard_financed_attempt()
returns trigger language plpgsql as $$
declare m public.payment_methods;
begin
  select * into m from public.payment_methods where id = new.method_id;

  if new.state = 'succeeded' and m.financed and new.tenure_months is null then
    raise exception
      'A financed payment that succeeded has to carry the plan it was approved on. "Paid by %" with no tenure is a figure nobody can reconcile against the customer''s statement.',
      m.label;
  end if;

  if not m.financed and new.tenure_months is not null then
    raise exception '% is not a financing method and cannot carry an instalment plan.', m.label;
  end if;

  return new;
end $$;

drop trigger if exists z_guard_financed_attempt on public.payment_attempts;
create trigger z_guard_financed_attempt
  before insert or update on public.payment_attempts
  for each row execute function public.guard_financed_attempt();

/* ---- 5. Assertions ------------------------------------------------------------ */

do $$
declare n int; bad text; probe_order text;
begin
  /* A real order to hang the probes on — the table refuses an order payment
     with no order, and inventing one would be a row left behind. */
  select order_ref into probe_order from public.orders order by order_ref limit 1;
  /* Every financed method says what the customer is agreeing to. The check
     constraint enforces it; this proves the seed actually filled it in. */
  select count(*) into n from public.payment_methods
   where financed and (credit_note is null or coalesce(array_length(tenures,1),0) = 0);
  if n > 0 then raise exception '% financing methods do not say what is being agreed', n; end if;

  /* Every offer has a floor, and the floor is in the market's own currency —
     which is only meaningful if the market takes that currency. */
  select string_agg(l.method_id || '/' || l.market_code, ', ') into bad
    from public.payment_method_markets l
    join public.payment_methods m on m.id = l.method_id
   where m.financed and l.min_amount is null;
  if bad is not null then raise exception 'financing with no floor: %', bad; end if;

  /* Carrier billing no longer carries one number for three currencies. */
  select count(distinct max_amount) into n from public.payment_method_markets
   where method_id = 'carrier_billing';
  if n < 3 then
    raise exception 'carrier billing still caps three markets at % distinct amounts', n;
  end if;

  /* A financed attempt with a plan goes through. Done FIRST, so that the two
     refusals below are known to be refusing the plan rather than tripping over
     some other constraint on the same row — an `exception when others` that
     catches the wrong error is an assertion that passes for the wrong reason. */
  insert into public.payment_attempts
    (id, reference, purpose, order_ref, amount, currency, method_id, market_code, provider, state,
     decided_at, tenure_months, instalment, financier)
  values ('PA-ASSERT-OK', 'PAY-ASSERT-OK', 'order', probe_order, 64999, 'INR', 'emi', 'IN',
          'Razorpay · HDFC, ICICI, Axis and SBI credit cards', 'succeeded',
          now(), 12, 5645.75, 'HDFC Bank');
  delete from public.payment_attempts where id = 'PA-ASSERT-OK';

  /* The plan guard bites. Asserted rather than assumed: it is the only thing
     standing between a financed order and a statement nobody can reconcile.
     The same row as above, minus the plan. */
  begin
    insert into public.payment_attempts
      (id, reference, purpose, order_ref, amount, currency, method_id, market_code, provider, state, decided_at)
    values ('PA-ASSERT-EMI', 'PAY-ASSERT-EMI', 'order', probe_order, 64999, 'INR', 'emi', 'IN',
            'Razorpay · HDFC, ICICI, Axis and SBI credit cards', 'succeeded', now());
    raise exception 'a financed payment succeeded with no plan on it';
  exception when others then
    if sqlerrm not like '%has to carry the plan%' then
      raise exception 'the no-plan insert failed, but on % rather than the plan guard', sqlerrm;
    end if;
  end;

  /* And a method that is not financing cannot carry one. */
  begin
    insert into public.payment_attempts
      (id, reference, purpose, order_ref, amount, currency, method_id, market_code, provider, state, tenure_months, instalment)
    values ('PA-ASSERT-UPI', 'PAY-ASSERT-UPI', 'order', probe_order, 900, 'INR', 'upi', 'IN', 'Razorpay', 'initiated', 6, 150);
    raise exception 'a UPI payment took an instalment plan';
  exception when others then
    if sqlerrm not like '%not a financing method%' then
      raise exception 'the UPI insert failed, but on % rather than the plan guard', sqlerrm;
    end if;
  end;

  /* Nothing was left behind by any of the three. */
  select count(*) into n from public.payment_attempts where id like 'PA-ASSERT-%';
  if n > 0 then raise exception '% assertion probes were left behind', n; end if;
end $$;
