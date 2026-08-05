/*
  # A payment nobody answered does not wait for ever

  `payment_attempts` records the gap between a customer leaving for their bank
  and an answer coming back. Most of those gaps close in a minute. The ones that
  do not — the customer shut the tab, the provider never called back — stay
  `initiated` for ever, and a row that says "in progress" three weeks later is
  worse than no row: the wallet screen goes on telling the customer to wait, and
  `canStart` goes on hedging about a payment nobody is going to hear about.

  Fifteen minutes is the window, the same number the screens quote. After that
  the attempt is `expired`, which is a distinct outcome from `failed` on
  purpose: failed means the provider said no and nothing was charged, expired
  means nobody knows — and if the customer's account was in fact debited, that
  is the case that has to be visibly open rather than quietly closed as a
  refusal.

  There is no scheduler, so this is called on wallet load, exactly as
  `publish_due_listings` is called on the listing screens. The failure mode is
  one-sided by design: forget to call it and a stale attempt is reported as
  still waiting, which is only ever more cautious than the truth.
*/

create or replace function expire_stale_payments() returns integer
language plpgsql security definer set search_path = public as $$
declare
  moved integer;
begin
  update payment_attempts
     set state = 'expired',
         decided_at = now(),
         failure_reason = null
   where state = 'initiated'
     and started_at < now() - interval '15 minutes';
  get diagnostics moved = row_count;
  return moved;
end $$;

grant execute on function expire_stale_payments() to authenticated;

do $$
declare
  n integer;
begin
  if to_regprocedure('public.expire_stale_payments()') is null then
    raise exception 'expire_stale_payments did not take';
  end if;

  /* Nothing that expired ever moved money. The table constraint says as much;
     this says it about what the function just did. */
  perform expire_stale_payments();

  select count(*) into n from payment_attempts where state = 'expired' and ledger_id is not null;
  if n > 0 then raise exception '% expired payments credited a wallet', n; end if;

  select count(*) into n from payment_attempts
   where state = 'initiated' and started_at < now() - interval '15 minutes';
  if n > 0 then raise exception '% payments are still waiting past the window', n; end if;
end $$;
