/* The marketplace could read every order and move none of them.
 *
 * `orders` has eight row-level policies. Sellers can update the orders they
 * supply, consumers can update their own, and the operator — who runs the
 * marketplace, works the fulfilment queue and is the only persona that can see
 * every order — has `operator_read_orders` and nothing else.
 *
 * That was survivable while nothing needed moving. It is not survivable now.
 * The previous migration made an order's last stage conditional on the network
 * having actually provisioned it, which means somebody has to move it when the
 * order manager reports completion, and somebody has to cancel one that was
 * refused. On a first-party order — a mobile plan, an eSIM, an IoT SIM estate,
 * all sold by Aventa Telecom with no partner behind them — there is no seller
 * to do it. `partner_supplies_order` returns false and the row is untouchable
 * by everyone.
 *
 * Which is the shape this build keeps finding: the screen was built, the
 * function was written, and the grant that would let the persona it exists for
 * use it was never made.
 *
 * The policy is not a blanket one. An operator moving an order along is a
 * different act from an operator rewriting what it cost, and the second is how
 * a marketplace loses an argument with a customer holding a receipt.
 */

create policy operator_update_orders on public.orders
  for update using (current_persona() = 'operator')
  with check (current_persona() = 'operator');

/* What an operator may actually change. The same division the seller's guard
   draws, for the same reason: the money and the buyer are what was agreed at
   checkout, and a document somebody has already been charged against is not
   edited afterwards. */
create or replace function public.guard_operator_order_edit()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if current_persona() is distinct from 'operator' then return new; end if;

  if new.total is distinct from old.total
     or new.subtotal is distinct from old.subtotal
     or new.tax is distinct from old.tax
     or new.tax_rate is distinct from old.tax_rate
     or new.discount is distinct from old.discount
     or new.currency is distinct from old.currency
     or new.market is distinct from old.market
     or new.buyer_name is distinct from old.buyer_name
     or new.buyer_email is distinct from old.buyer_email
     or new.user_id is distinct from old.user_id
     or new.account_id is distinct from old.account_id
     or new.order_ref is distinct from old.order_ref
     or new.invoice_id is distinct from old.invoice_id
     or new.requisition_id is distinct from old.requisition_id
     or new.payment_method is distinct from old.payment_method
     or new.payment_ref is distinct from old.payment_ref
  then
    raise exception
      'The marketplace moves % along; it does not rewrite what it cost or who bought it. Those were agreed at checkout and a refund is the way to change them.',
      old.order_ref;
  end if;

  /* Failing an order without saying why leaves a customer with a dead order and
     support with nothing to tell them. */
  if new.failed and not old.failed and coalesce(trim(new.failed_reason), '') = '' then
    raise exception 'Say what went wrong with %. "Failed" on its own cannot be acted on by anybody.', old.order_ref;
  end if;

  return new;
end $$;

drop trigger if exists z_guard_operator_order_edit on public.orders;
create trigger z_guard_operator_order_edit
  before update on public.orders
  for each row execute function public.guard_operator_order_edit();

/* ---- Moving an order on when the network says it is done --------------------- */

/* The other half of the same gap. `com_state` records what the order manager
 * reported and stops there, so an order whose service went live yesterday is
 * still showing its buyer "Provisioning". Completing the last push completes
 * the order, in the same transaction, because two writes from a screen can
 * leave the two disagreeing and the disagreement is invisible.
 */
create or replace function public.com_state(
  p_id text, p_state text, p_detail text default null, p_now timestamptz default now()
) returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare c public.com_order; o public.orders; n int; outstanding int;
begin
  select * into c from public.com_order where id = p_id;
  if c.id is null then return jsonb_build_object('ok', false, 'why', 'No such push.'); end if;
  if p_state not in ('in-progress', 'completed', 'failed', 'cancelled') then
    return jsonb_build_object('ok', false, 'why',
      format('%s is not a state the order manager reports.', p_state));
  end if;
  if c.state in ('queued', 'rejected') then
    return jsonb_build_object('ok', false, 'why',
      'Nothing has been accepted for this line, so there is no state to report against it.');
  end if;

  update public.com_order set
    state = p_state,
    completed_at = case when p_state = 'completed' then p_now else completed_at end,
    failure_reason = case when p_state = 'failed' then coalesce(p_detail, failure_reason) else null end,
    failure_code = case when p_state = 'failed' then coalesce(failure_code, 'COM-FAIL') else null end
   where id = p_id;

  select count(*) into n from public.com_event where com_order = p_id;
  insert into public.com_event (id, com_order, kind, state, detail, occurred_at)
  values (format('%s-S%s', p_id, n + 1), p_id,
          case p_state when 'completed' then 'completed'
                       when 'failed' then 'failed' else 'state-change' end,
          p_state, p_detail, p_now);

  /* The buyer's own ladder. Only when every line on the order is done — a
     two-line order half provisioned is not a delivered order, and moving it
     would tell somebody their second SIM works. */
  select * into o from public.orders where order_ref = c.order_ref;
  if o.id is not null and p_state = 'completed' then
    select count(*) into outstanding from public.com_order
     where order_ref = c.order_ref and state not in ('completed', 'cancelled');
    if outstanding = 0 and o.stage < array_length(o.stages, 1) - 1 then
      update public.orders set
        stage = array_length(stages, 1) - 1,
        status = case when vertical in ('iot', 'security') then 'active' else 'delivered' end
       where id = o.id;
    end if;
  end if;

  return jsonb_build_object('ok', true, 'state', p_state,
                            'order_moved', p_state = 'completed' and coalesce(outstanding, 1) = 0);
end $$;

grant execute on function public.com_state(text, text, text, timestamptz) to authenticated;

/* ---- Assertions --------------------------------------------------------------- */

do $$
declare n int; ref text; before_stage int; c public.com_order;
begin
  /* The operator can write to orders at all. */
  select count(*) into n from pg_policy
   where polrelid = 'public.orders'::regclass and polcmd = 'w'
     and pg_get_expr(polqual, polrelid) like '%operator%';
  if n = 0 then raise exception 'the marketplace still cannot move an order'; end if;

  /* The first-party case that had nobody at all: an order Aventa sells
     directly, with no partner behind it to fulfil it. */
  select count(*) into n from public.orders o
   where exists (select 1 from public.com_order x where x.order_ref = o.order_ref)
     and not public.partner_supplies_order(o.id);
  if n = 0 then
    raise exception 'no first-party network order exists, so the case this policy exists for is untested';
  end if;

  /* Completing the last push completes the order. Run against a real one and
     put it back. */
  select * into c from public.com_order where state = 'in-progress' limit 1;
  if c.id is null then raise exception 'nothing is in progress to complete'; end if;
  select order_ref, stage into ref, before_stage from public.orders where order_ref = c.order_ref;

  perform public.com_state(c.id, 'completed', 'Assertion: provisioning finished.');
  select stage into n from public.orders where order_ref = ref;
  if n <> (select array_length(stages, 1) - 1 from public.orders where order_ref = ref) then
    raise exception 'the order did not move when its last line went live (stage % of %)',
      n, (select array_length(stages, 1) from public.orders where order_ref = ref);
  end if;

  /* Put it back, so the seed keeps an in-progress row for the screens that
     draw one. */
  update public.orders set stage = before_stage where order_ref = ref;
  update public.com_order set state = 'in-progress', completed_at = null where id = c.id;
  delete from public.com_event where com_order = c.id and detail = 'Assertion: provisioning finished.';

  /* And a half-provisioned order does not move. */
  select count(*) into n from public.orders o
    join public.com_order x on x.order_ref = o.order_ref
   where o.stage >= array_length(o.stages, 1) - 1
     and x.state not in ('completed', 'cancelled');
  if n > 0 then raise exception '% orders are finished with a line still outstanding', n; end if;

  raise notice 'operator write policy in place; % network orders, % of them first-party',
    (select count(distinct order_ref) from public.com_order),
    (select count(*) from public.orders o
      where exists (select 1 from public.com_order x where x.order_ref = o.order_ref)
        and not public.partner_supplies_order(o.id));
end $$;
