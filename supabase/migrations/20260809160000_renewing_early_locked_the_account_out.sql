/* Renewing early locked the account out.
 *
 * `renew_contract` created the new term and set the old one to `superseded` in
 * the same transaction. That is right when the old term has already ended. It is
 * wrong in the case the whole feature exists for.
 *
 * Meridian's agreement runs to 31 August and is inside its notice period now.
 * Renewing it today — which is exactly what the expiring column is telling
 * somebody to do — creates a term starting 1 September and immediately marks
 * the current one superseded. `contract_in_force` looks for `state = 'active'`
 * between the dates, so from the moment of the renewal until September there is
 * nothing in force, and `guard_requisition_contract` refuses every purchase on
 * the account for three weeks.
 *
 * Acting early is the behaviour the notice period is designed to produce, and
 * the reward for it was an outage. The integration test caught it on the
 * assertion that the account still holds exactly one agreement in force after a
 * renewal — it held none.
 *
 * WHAT SUPERSEDED ACTUALLY MEANS
 *
 * Not "replaced from now". It means "there is a successor", and the old
 * agreement goes on binding until its own term runs out. So the pointer is set
 * at renewal and the state is left alone; the old one keeps working, expires on
 * its own date, and reads as superseded from then because something replaced it.
 *
 * That means an account can hold two `active` agreements at once — one running,
 * one starting later. That is not the thing the one-in-force rule forbids: the
 * rule is about two agreements binding on the same day, and non-overlapping
 * terms never do. `renew_contract` already refuses an overlap, which is what
 * makes this safe.
 */

/* ---- 1. Standing knows the difference between expired and replaced --------------- */

create or replace view public.account_contract as
  select c.id, c.account_id, a.company, a.market,
         c.title, c.signed_on, c.starts_on, c.ends_on,
         c.terms, c.currency, c.auto_renew, c.notice_days, c.term_value,
         c.signed_by, c.signed_title, c.countersigned_by,
         c.document_name, c.document_path,
         c.state, c.superseded_by, c.terminated_on, c.terminated_why, c.note,
         (c.ends_on - current_date) as days_left,
         (c.state = 'active'
          and current_date >= c.starts_on
          and current_date <= c.ends_on) as in_force,
         case
           when c.state = 'draft'       then 'draft'
           when c.state = 'terminated'  then 'terminated'
           when c.state = 'superseded'  then 'superseded'
           when current_date < c.starts_on then 'not started'
           /* Past its term with a successor named is superseded, not expired.
              Expired means nothing replaced it and the account is locked out;
              saying that about an agreement that was properly renewed would
              send somebody chasing a renewal that already happened. */
           when current_date > c.ends_on and c.superseded_by is not null then 'superseded'
           when current_date > c.ends_on   then 'expired'
           when (c.ends_on - current_date) <= c.notice_days then 'expiring'
           else 'in force'
         end as standing,
         c.sort_order
    from public.enterprise_contract c
    join public.enterprise_accounts a on a.id = c.account_id;

alter view public.account_contract set (security_invoker = on);
grant select on public.account_contract to authenticated;

/* ---- 2. Renewing leaves the old one running until its own end date --------------- */

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
  if old.superseded_by is not null then
    return jsonb_build_object('ok', false, 'why',
      format('%s has already been renewed into %s.', p_from, old.superseded_by));
  end if;
  if exists (select 1 from public.enterprise_contract where id = p_id) then
    return jsonb_build_object('ok', false, 'why', format('%s already exists.', p_id));
  end if;

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

  /* The pointer always; the state only once the old term is actually over.
     Renewing inside the notice period is the behaviour the register asks for,
     and marking the current agreement superseded on the spot took the account
     off account-purchasing until the new term began. */
  update public.enterprise_contract
     set superseded_by = p_id,
         state = case when current_date > ends_on then 'superseded' else state end
   where id = p_from;

  return jsonb_build_object(
    'ok', true, 'id', p_id,
    'why', case
      when p_starts_on > current_date then format(
        '%s runs from %s to %s. %s keeps running until %s, so nothing is interrupted.',
        p_id, p_starts_on, p_ends_on, p_from, old.ends_on)
      else format('%s runs from %s to %s. %s is superseded.', p_id, p_starts_on, p_ends_on, p_from)
    end);
end $$;

grant execute on function public.renew_contract(
  text, text, date, date, date, text, boolean, int, numeric, text, text, text, text, text)
  to authenticated;

/* And an agreement whose successor has started stops binding, so the old row is
 * settled the day the new term opens rather than waiting for somebody to look.
 */
create or replace function public.contract_in_force(p_account text)
returns text language sql stable security definer set search_path to 'public' as $$
  select c.id from public.enterprise_contract c
   where c.account_id = p_account
     and c.state = 'active'
     and current_date between c.starts_on and c.ends_on
   order by c.starts_on desc limit 1;
$$;

/* ---- What has to be true ------------------------------------------------------- */

do $$
declare v_body text; n int; v_standing text;
begin
  /* ASSERT-1: a renewal no longer takes the old agreement out of force early. */
  select pg_get_functiondef(p.oid) into v_body from pg_proc p
    join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname = 'renew_contract';
  if v_body not like '%case when current_date > ends_on then%' then
    raise exception 'renew_contract still supersedes an agreement that is still running';
  end if;
  if v_body not like '%would overlap it%' then
    raise exception 'renew_contract no longer checks the new term against the old one';
  end if;

  /* ASSERT-2: every account still has exactly one thing in force. The change
     above lets two `active` rows exist for one account, so this is the check
     that the terms behind them still do not overlap. */
  select count(*) into n from (
    select account_id from public.enterprise_contract
     where state = 'active' and current_date between starts_on and ends_on
     group by account_id having count(*) > 1) t;
  if n <> 0 then raise exception '% accounts hold more than one live agreement', n; end if;

  select count(*) into n from public.enterprise_accounts a
   where a.status = 'active' and public.contract_in_force(a.id) is null;
  if n <> 0 then raise exception '% trading accounts have nothing in force', n; end if;

  /* ASSERT-3: the one that has already been replaced still reads superseded
     rather than expired, so nobody chases a renewal that happened in 2024. */
  select standing into v_standing from public.account_contract where id = 'CTR-2007-00';
  if v_standing <> 'superseded' then
    raise exception 'CTR-2007-00 reads % rather than superseded', v_standing;
  end if;

  /* ASSERT-4: and nothing that is genuinely lapsed is being called superseded,
     which would hide an account that cannot buy. */
  select count(*) into n from public.account_contract
   where standing = 'superseded' and superseded_by is null;
  if n <> 0 then raise exception '% agreements read superseded with no successor', n; end if;
end $$;
