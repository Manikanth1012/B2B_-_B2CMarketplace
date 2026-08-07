/* The plan had nowhere to land.
 *
 * `settle_payment_attempt` is the only thing that may move a payment out of
 * `initiated`, and it takes an instrument and a gateway reference. Financing
 * comes back with a third fact — the plan the customer was approved for — and
 * there was no parameter for it.
 *
 * That is not a cosmetic gap. `guard_financed_attempt` refuses to let a
 * financed attempt reach `succeeded` without a plan, deliberately, because
 * "paid by EMI" with no tenure is a line nobody can reconcile against a bank
 * statement. So without this the two work against each other: the guard would
 * refuse every EMI payment the settle function tried to complete, and the
 * customer would be told their approved plan had failed.
 *
 * Dropped and recreated rather than overloaded. Two functions of the same name
 * with different arities leave PostgREST to guess which one a client meant, and
 * the one it guesses is the one whose defaults are wrong.
 */

drop function if exists public.settle_payment_attempt(text, text, text, text, text);

create or replace function public.settle_payment_attempt(
  p_attempt text, p_outcome text,
  p_instrument text default null, p_gateway_ref text default null, p_reason text default null,
  /* What the financier came back with. Null on every method that is not
     financing; required on one that is, and refused below rather than by a
     constraint the client cannot read. */
  p_tenure integer default null, p_instalment numeric default null, p_financier text default null
) returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare
  a          payment_attempts%rowtype;
  w          wallets%rowtype;
  m          payment_methods%rowtype;
  mine       boolean;
  led        text;
  ceiling    numeric;
  n_orders   integer;
begin
  if p_outcome not in ('succeeded', 'failed', 'cancelled', 'expired') then
    raise exception 'A payment is not %.', p_outcome;
  end if;

  select * into a from payment_attempts where id = p_attempt for update;
  if not found then
    raise exception 'There is no payment %.', p_attempt;
  end if;

  select * into m from payment_methods where id = a.method_id;

  /* Who is allowed to answer for this payment. A top-up hangs off the wallet's
     owner; an order payment off whoever started it, because an order has no
     wallet to ask. */
  if a.purpose = 'wallet_topup' then
    select * into w from wallets where id = a.wallet_id for update;
    if not found then
      raise exception 'That payment is against a wallet that no longer exists.';
    end if;
    mine := (w.user_id = auth.uid())
         or (w.account_id is not null and w.account_id = current_account_id());
  else
    mine := (a.user_id = auth.uid());
  end if;

  if not mine then
    raise exception 'That payment is not yours.';
  end if;

  if a.state <> 'initiated' then
    /* Not an error. A provider calling back twice is ordinary, and the second
       call must find the first call's answer rather than a failure. */
    return jsonb_build_object(
      'already', true, 'state', a.state, 'reference', a.reference,
      'note', format('Payment %s was already %s.', a.reference, a.state));
  end if;

  /* A financier that approved somebody has to say on what. Refused here, in
     words, rather than leaving the trigger to raise a constraint message at a
     customer who is looking at a confirmation screen. */
  if p_outcome = 'succeeded' and m.financed and p_tenure is null then
    raise exception
      '% came back approved without saying over how long. A plan with no tenure cannot be put on an order.',
      m.label;
  end if;

  if p_outcome <> 'succeeded' then
    update payment_attempts
       set state = p_outcome,
           decided_at = now(),
           gateway_ref = coalesce(p_gateway_ref, gateway_ref),
           instrument = coalesce(p_instrument, instrument),
           failure_reason = case when p_outcome = 'failed'
                                 then coalesce(nullif(trim(p_reason), ''), 'The provider refused the payment and gave no reason.')
                                 else p_reason end
     where id = a.id;
    return jsonb_build_object('already', false, 'state', p_outcome, 'reference', a.reference);
  end if;

  /* ------------------------------------------------------------- an order */
  if a.purpose = 'order' then
    update orders
       set status = 'placed',
           payment_method = a.method_id
     where payment_ref = a.reference
       and status = 'awaiting_payment';
    get diagnostics n_orders = row_count;

    if n_orders = 0 then
      update payment_attempts
         set state = 'failed', decided_at = now(),
             gateway_ref = coalesce(p_gateway_ref, gateway_ref),
             instrument = coalesce(p_instrument, instrument),
             failure_reason = 'The basket this paid for is no longer waiting to be paid. Nothing was charged.'
       where id = a.id;
      return jsonb_build_object('already', false, 'state', 'failed', 'reference', a.reference,
        'note', 'There was nothing left to pay for.');
    end if;

    update payment_attempts
       set state = 'succeeded', decided_at = now(),
           gateway_ref = coalesce(p_gateway_ref, gateway_ref),
           instrument = coalesce(p_instrument, instrument),
           tenure_months = p_tenure,
           /* Divided here only where the financier did not say. A plan that
              carries interest states its own instalment, and computing one
              would under-report what the customer agreed to. */
           instalment = case when p_tenure is null then null
                             else coalesce(p_instalment, round(a.amount / p_tenure, 2)) end,
           financier = p_financier
     where id = a.id;

    return jsonb_build_object('already', false, 'state', 'succeeded',
                              'reference', a.reference, 'orders', n_orders,
                              'tenure_months', p_tenure);
  end if;

  /* -------------------------------------------------------------- a wallet */
  /* The ceiling is checked here and not only when the form opened. A customer
     can be away at the provider for two minutes, and a refund landing in that
     window is exactly how a wallet ends up over its limit. */
  select max_balance into ceiling from wallet_limits where currency = w.currency;
  if ceiling is not null and w.balance + a.amount > ceiling then
    update payment_attempts
       set state = 'failed', decided_at = now(),
           gateway_ref = coalesce(p_gateway_ref, gateway_ref),
           instrument = coalesce(p_instrument, instrument),
           failure_reason = format(
             'The wallet reached %s while this payment was with the provider, and crediting it would pass the %s ceiling. Nothing was charged.',
             w.balance, ceiling)
     where id = a.id;
    return jsonb_build_object('already', false, 'state', 'failed', 'reference', a.reference,
      'note', 'The payment was not applied — the wallet would have passed its ceiling.');
  end if;

  led := 'W' || a.id;

  insert into wallet_ledger (id, wallet_id, when_date, source, what, amount, pot, ref, sort_order)
  values (led, w.id, current_date, 'topup',
          format('Top-up by %s', coalesce(p_instrument, a.instrument, 'card')),
          a.amount, 'cash', a.reference, 999);

  update wallets
     set cash = cash + a.amount,
         last_move = current_date
   where id = w.id;

  update payment_attempts
     set state = 'succeeded', decided_at = now(), ledger_id = led,
         gateway_ref = coalesce(p_gateway_ref, gateway_ref),
         instrument = coalesce(p_instrument, instrument)
   where id = a.id;

  return jsonb_build_object('already', false, 'state', 'succeeded',
                            'reference', a.reference, 'ledger_id', led);
end $function$;

grant execute on function public.settle_payment_attempt(text,text,text,text,text,integer,numeric,text)
  to authenticated;

/* Financing is a way to pay for a basket, not a way to fund a wallet. Topping
   up on credit is a payday loan wearing a telecom logo, and the wallet branch
   above quietly ignores the plan rather than refusing it — so it is refused
   here, where a reader can see it. */
create or replace function public.guard_financed_purpose()
returns trigger language plpgsql as $$
declare m public.payment_methods;
begin
  select * into m from public.payment_methods where id = new.method_id;
  if m.financed and new.purpose = 'wallet_topup' then
    raise exception
      'A wallet cannot be topped up on credit. % is for paying for a basket.', m.label;
  end if;
  return new;
end $$;

drop trigger if exists z_guard_financed_purpose on public.payment_attempts;
create trigger z_guard_financed_purpose
  before insert on public.payment_attempts
  for each row execute function public.guard_financed_purpose();

/* ---- Assertions --------------------------------------------------------------- */

do $$
declare n int;
begin
  /* One function of that name, not two. An overload is how a client ends up
     calling the version whose defaults are wrong. */
  select count(*) into n from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname = 'settle_payment_attempt';
  if n <> 1 then raise exception 'there are % settle_payment_attempt functions', n; end if;

  /* It takes the plan. */
  if not exists (
    select 1 from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
     where ns.nspname = 'public' and p.proname = 'settle_payment_attempt'
       and pg_get_function_arguments(p.oid) like '%p_tenure integer%'
  ) then raise exception 'the settle function still cannot carry a plan'; end if;

  /* And a wallet cannot be filled on credit. */
  begin
    insert into public.payment_attempts
      (id, reference, purpose, wallet_id, amount, currency, method_id, market_code, provider, state)
    values ('PA-ASSERT-TOPUP', 'PAY-ASSERT-TOPUP', 'wallet_topup',
            (select id from public.wallets limit 1), 5000, 'INR', 'emi', 'IN', 'Razorpay', 'initiated');
    raise exception 'a wallet was topped up on credit';
  exception when others then
    if sqlerrm not like '%cannot be topped up on credit%' then
      raise exception 'the credit top-up failed on % rather than the purpose guard', sqlerrm;
    end if;
  end;

  select count(*) into n from public.payment_attempts where id like 'PA-ASSERT-%';
  if n > 0 then raise exception '% assertion probes were left behind', n; end if;
end $$;
