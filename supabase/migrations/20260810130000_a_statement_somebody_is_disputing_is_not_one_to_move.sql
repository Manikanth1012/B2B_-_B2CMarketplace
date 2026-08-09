/* Wholesale netting reduced a statement four people had raised a dispute about.
 *
 * `disputes.integration` caught it:
 *
 *   DSP-2206 claims 14744.07 against a 14631.62 statement
 *
 * TrackWise's July statement carries four disputes, one of them still open, all
 * of them arguing about a net payable of 14744.07 — a figure quoted in the
 * dispute's own text. A $112.45 wholesale charge came off it automatically and
 * the statement became worth less than the claim against it. Nobody decided
 * that; a monthly job did it.
 *
 * `apply_settlement_adjustments` already refuses a statement that is approved or
 * paid, on the grounds that it is a document somebody has signed off. A disputed
 * statement is the same kind of thing from the other direction: somebody has
 * said the figure is wrong and is waiting for an answer. Moving it underneath
 * them is how a dispute becomes unresolvable — the seller is now arguing about a
 * number that no longer appears anywhere.
 *
 * The charge is still raised. What a partner bought is a fact about the month
 * and does not depend on whether a statement is under argument; it simply
 * cannot come off this one, so it stays outstanding and takes the next
 * settlement — which is the same path a charge takes when the period could not
 * cover it, already built and already tested.
 *
 * Notes still apply. A note is a deliberate act aimed at one statement, and
 * crediting a seller is often exactly how the dispute is settled; refusing that
 * would stop the marketplace answering the complaint. Wholesale is automatic,
 * and automatic is the part that has no business moving a contested figure.
 */

create or replace function public.apply_settlement_adjustments(p_statement text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  st        public.settlement_statements;
  n         public.settlement_note;
  c         public.partner_charge;
  adj       numeric := 0;
  det       jsonb := '[]'::jsonb;
  notes     int := 0;
  charged   int := 0;
  raised    int := 0;
  base      numeric;
  room      numeric;
  take      numeric;
  taken     numeric := 0;
  held_off  boolean := false;
begin
  select * into st from public.settlement_statements where id = p_statement;
  if st.id is null then return jsonb_build_object('ok', false, 'why', 'No such statement.'); end if;
  if st.status in ('approved', 'paid') then
    return jsonb_build_object('ok', false, 'why',
      format('%s is %s. A note cannot be added to a statement that has been signed off.', p_statement, st.status));
  end if;

  /* Undo this statement's own previous pass, so a second one starts where the
     first one did rather than on top of it. */
  update public.settlement_note
     set state = 'issued', statement_id = null, applied_on = null
   where statement_id = p_statement and state = 'applied';
  delete from public.partner_charge_recovery where statement_id = p_statement;

  for n in
    select * from public.settlement_note
     where partner_id = st.partner_id and state = 'issued'
     order by raised_on, id
  loop
    adj := adj + case n.kind when 'credit' then n.amount else -n.amount end;
    det := det || jsonb_build_object(
      'note_id', n.id, 'kind', n.kind, 'reason', n.reason_id,
      'amount', n.amount, 'detail', n.detail, 'ref', n.ref);
    update public.settlement_note set
      state = 'applied', statement_id = p_statement, applied_on = current_date
     where id = n.id;
    notes := notes + 1;
  end loop;

  /* This period's wholesale, and anything an earlier period could not cover.
     Raised whether or not this statement can take it. */
  if st.period_start is not null and st.period_end is not null then
    raised := public.raise_partner_charges(st.partner_id, st.period_start, st.period_end);
  end if;

  /* What the period actually has to give. `held_back` is inside a returns
     window and is not the marketplace's to spend; `carried_in` is money the
     last period owed and did not pay, and it is. */
  base := round(st.gross - st.commission - st.fees - st.refunds - st.withholding + adj, 2);
  room := round(base - st.held_back + st.carried_in, 2);

  /* And nothing at all, where the seller is disputing this statement. */
  if coalesce(st.disputed, false) then
    held_off := true;
    room := 0;
  end if;

  for c in
    select * from public.partner_charge
     where partner_id = st.partner_id
       and recovered < gross
       and period_start <= coalesce(st.period_end, period_start)
     order by period_start, id
  loop
    exit when room <= 0;
    take := least(round(c.gross - c.recovered, 2), room);
    if take <= 0 then continue; end if;

    adj   := adj - take;
    room  := round(room - take, 2);
    taken := round(taken + take, 2);
    det := det || jsonb_build_object(
      'charge_id', c.id, 'kind', 'debit', 'reason', 'wholesale',
      'amount', take, 'gross', c.gross, 'outstanding', round(c.gross - c.recovered - take, 2),
      'product', c.product_name, 'quantity', c.quantity,
      'period', to_char(c.period_start, 'Mon YYYY'),
      'detail', format('%s × %s%s', c.product_name, c.quantity,
        case when c.days_charged < c.days_in_period
             then format(', %s of %s days', c.days_charged, c.days_in_period) else '' end));

    insert into public.partner_charge_recovery (charge_id, statement_id, amount)
    values (c.id, p_statement, take);
    charged := charged + 1;
  end loop;

  /* Written even when nothing applied. The pass above may have undone an
     earlier one, and leaving the old figure in place would state an adjustment
     that no note or charge on file supports. */
  update public.settlement_statements set
    adjustments = adj,
    adjustment_detail = det,
    net = round(gross - commission - fees - refunds - withholding + adj, 2),
    payout_net = round((gross - commission - fees - refunds - withholding + adj) * fx_rate, 2)
   where id = p_statement;

  if notes = 0 and charged = 0 then
    return jsonb_build_object('ok', true, 'applied', 0, 'charges', 0, 'raised', raised,
      'held_off', held_off,
      'why', case when held_off
                  then format('%s is under dispute. Wholesale is not taken off a figure the seller is challenging; it waits for the next statement.', p_statement)
                  else 'No issued notes for that seller.' end);
  end if;

  return jsonb_build_object('ok', true, 'applied', notes, 'adjustment', adj,
    'charges', charged, 'raised', raised, 'recovered', taken, 'held_off', held_off);
end $$;

/* Put the statement back, and let the charge wait for one nobody is arguing
   about. */
select public.apply_settlement_adjustments(id)
  from public.settlement_statements
 where disputed and status not in ('approved', 'paid');

do $$
declare bad text;
begin
  /* No claim may exceed the thing it is against — the assertion that caught
     this, restated where the data is written rather than only in the suite. */
  select string_agg(format('%s claims %s against %s worth %s', d.id, d.amount, d.subject_ref, s.net), '; ')
    into bad
    from public.disputes d
    join public.settlement_statements s on s.id = d.subject_ref
   where d.kind = 'statement' and d.amount > s.net + 0.02;
  if bad is not null then
    raise exception 'A dispute is worth more than the statement it is against: %', bad;
  end if;

  /* And the charge that could not come off it is still on file, outstanding. */
  if not exists (
    select 1 from public.partner_charge where partner_id = 'PTR-1011' and recovered < gross) then
    raise exception 'The charge held off a disputed statement was not left outstanding.';
  end if;
end $$;
