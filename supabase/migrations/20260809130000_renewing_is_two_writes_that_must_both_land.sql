/* Renewing is two writes that must both land.
 *
 * A renewal supersedes the old agreement and creates the new one pointing back
 * at it. Done as two calls from a browser, a dropped connection between them
 * leaves the account in one of two states, and both are bad in a way nobody
 * notices for a while:
 *
 *   the new one landed, the old one was not superseded
 *     two agreements in force at once, so two sets of payment terms and no way
 *     to say which was breached
 *
 *   the old one was superseded, the new one did not land
 *     no agreement in force, so `guard_requisition_contract` refuses every
 *     purchase on the account until somebody works out why
 *
 * So it is one function and one transaction. The same argument as
 * `place_requisition_order` and `release_credit_hold`: an act that is only
 * correct as a whole does not get to be two round trips.
 *
 * Terminating is one write, and is here for a different reason — it has a rule
 * a client cannot be trusted with. A termination with no recorded reason leaves
 * whoever takes the call from the account with nothing to say.
 */

create or replace function public.renew_contract(
  p_from text, p_id text, p_signed_on date, p_starts_on date, p_ends_on date,
  p_terms text, p_auto_renew boolean, p_notice_days int, p_term_value numeric,
  p_signed_by text, p_signed_title text, p_countersigned_by text,
  p_title text, p_note text)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare old record;
begin
  if current_persona() is distinct from 'operator' then
    raise exception 'Only the marketplace renews an agreement.';
  end if;

  select * into old from public.enterprise_contract where id = p_from;
  if old.id is null then
    return jsonb_build_object('ok', false, 'why', format('There is no agreement %s.', p_from));
  end if;
  if old.state <> 'active' then
    return jsonb_build_object('ok', false, 'why',
      format('%s is %s, so there is nothing to renew. Write a new agreement instead.', p_from, old.state));
  end if;
  if exists (select 1 from public.enterprise_contract where id = p_id) then
    return jsonb_build_object('ok', false, 'why', format('%s already exists.', p_id));
  end if;

  /* The overlap check, in the database as well as in the browser. The browser
     one exists so the operator is told before they fill the form in; this one
     is why it cannot be got round. */
  if p_starts_on <= old.ends_on then
    return jsonb_build_object('ok', false, 'why', format(
      '%s runs to %s. A term starting %s would overlap it, and two agreements in force '
      'at once is two sets of payment terms.', p_from, old.ends_on, p_starts_on));
  end if;

  insert into public.enterprise_contract (
    id, account_id, title, signed_on, starts_on, ends_on, terms, currency,
    auto_renew, notice_days, term_value, signed_by, signed_title, countersigned_by,
    state, note, sort_order)
  values (
    p_id, old.account_id, p_title, p_signed_on, p_starts_on, p_ends_on, p_terms, old.currency,
    coalesce(p_auto_renew, false), coalesce(p_notice_days, 30), p_term_value,
    p_signed_by, p_signed_title, p_countersigned_by,
    'active', p_note, coalesce(old.sort_order, 0) + 1);

  update public.enterprise_contract
     set state = 'superseded', superseded_by = p_id
   where id = p_from;

  return jsonb_build_object('ok', true, 'id', p_id, 'why',
    format('%s runs from %s to %s. %s is superseded.', p_id, p_starts_on, p_ends_on, p_from));
end $$;

grant execute on function public.renew_contract(
  text, text, date, date, date, text, boolean, int, numeric, text, text, text, text, text)
  to authenticated;

create or replace function public.terminate_contract(p_id text, p_on date, p_why text)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare c record;
begin
  if current_persona() is distinct from 'operator' then
    raise exception 'Only the marketplace ends an agreement.';
  end if;
  if coalesce(trim(p_why), '') = '' then
    return jsonb_build_object('ok', false, 'why',
      'Say why it is being ended. Whoever takes the call from the account needs it.');
  end if;

  select * into c from public.enterprise_contract where id = p_id;
  if c.id is null then
    return jsonb_build_object('ok', false, 'why', format('There is no agreement %s.', p_id));
  end if;
  if c.state <> 'active' then
    return jsonb_build_object('ok', false, 'why', format('%s is already %s.', p_id, c.state));
  end if;
  if p_on < c.starts_on then
    return jsonb_build_object('ok', false, 'why', format(
      '%s starts on %s and cannot be ended before it began.', p_id, c.starts_on));
  end if;

  update public.enterprise_contract
     set state = 'terminated', terminated_on = p_on, terminated_why = trim(p_why)
   where id = p_id;

  /* Said plainly, because it is the part the operator will be asked about an
     hour later. Ending an agreement stops the account buying. */
  return jsonb_build_object('ok', true, 'why', format(
    '%s ends on %s. %s cannot raise or approve anything on account from that date '
    'until a new agreement is in force.', p_id, p_on, c.account_id));
end $$;

grant execute on function public.terminate_contract(text, date, text) to authenticated;

/* ---- What has to be true ------------------------------------------------------- */

do $$
declare v_body text; n int;
begin
  /* ASSERT-1: both are the marketplace's alone. Checked in the source rather
     than by calling, because this migration runs as the migration role, which
     has no persona — invoking either would raise the guard, and a first draft
     of this check two files ago mistook that for a failure. */
  for v_body in
    select pg_get_functiondef(p.oid) from pg_proc p
      join pg_namespace ns on ns.oid = p.pronamespace
     where ns.nspname = 'public' and p.proname in ('renew_contract', 'terminate_contract')
  loop
    if v_body not like '%Only the marketplace%' then
      raise exception 'an agreement can be renewed or ended by anybody';
    end if;
  end loop;

  /* ASSERT-2: the renewal refuses an overlapping term. The whole reason it is
     one function is to stop an account holding two live agreements. */
  select pg_get_functiondef(p.oid) into v_body from pg_proc p
    join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname = 'renew_contract';
  if v_body not like '%would overlap it%' then
    raise exception 'renew_contract does not check the new term against the old one';
  end if;

  /* ASSERT-3: and a termination still demands a reason. */
  select pg_get_functiondef(p.oid) into v_body from pg_proc p
    join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname = 'terminate_contract';
  if v_body not like '%Say why it is being ended%' then
    raise exception 'an agreement can be ended with no reason recorded';
  end if;

  /* ASSERT-4: nothing in the register is in two states at once after all this. */
  select count(*) into n from (
    select account_id from public.enterprise_contract
     where state = 'active' and current_date between starts_on and ends_on
     group by account_id having count(*) > 1) t;
  if n <> 0 then raise exception '% accounts hold more than one live agreement', n; end if;
end $$;
