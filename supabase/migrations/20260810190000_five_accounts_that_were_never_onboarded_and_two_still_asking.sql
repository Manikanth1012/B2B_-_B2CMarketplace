/* Five accounts nobody can show you the onboarding of, and nobody waiting.
 *
 * `business_onboarding_ladder` describes six steps every company passes to open
 * an account, and `accept_application` instantiates all six the moment the desk
 * accepts one. Exactly one account on file has them. The other five — Brightline,
 * Meridian, Greencity, Harbourpoint, Cadence — have credit assessments, limits,
 * invoices and orders, and no record of ever having been onboarded at all.
 *
 * That is not only untidy. The credit assessment is a gate the marketplace owns
 * and a screen showing who is part-way through it would have five of its six
 * rows blank, which reads as a broken screen rather than as missing history.
 *
 * So the five get the history their trade implies, back-dated to before their
 * first invoice, with the same six steps and the people who actually staff those
 * roles elsewhere in this build. Two are deliberately not finished: an annual
 * credit review that has come round again, and a mandate that was never signed
 * by a company trading on the shortest terms in the book — which is what a
 * missing mandate looks like from the outside.
 *
 * And two companies are left waiting on the desk. `applications` was empty, so
 * the queue that decides them showed its empty state and an operator would
 * reasonably have concluded there was nothing behind it.
 */

/* ---------------------------------------------------- the five, back-filled */

insert into public.enterprise_onboarding
  (id, account_id, name, detail, state, done_on, done_by, due_on, documents, sort_order)
select
  format('BO-%s-%s', right(a.id, 4), l.sort_order),
  a.id, l.name, l.detail,
  case
    /* Greencity's yearly review has come round and nobody has done it. */
    when l.sort_order = 6 and a.id = 'ENT-2013' then 'overdue'
    when l.sort_order = 6 then 'due'
    /* Harbourpoint trades on Net 15 and never signed a mandate. Shortest terms
       in the book is what the marketplace does when it cannot collect. */
    when l.sort_order = 4 and a.id = 'ENT-2014' then 'due'
    else 'done'
  end,
  case
    when l.sort_order = 6 then null
    when l.sort_order = 4 and a.id = 'ENT-2014' then null
    else (s.opened + (l.sort_order * 2))::date
  end,
  case
    when l.sort_order = 6 then null
    when l.sort_order = 4 and a.id = 'ENT-2014' then null
    when l.sort_order in (1) then 'Lena Fischer'
    when l.sort_order in (2, 3) then 'Ruben Oyelaran'
    else 'Meera Iyer'
  end,
  case
    when l.sort_order = 6 and a.id = 'ENT-2013' then (current_date - 34)
    when l.sort_order = 6 then (s.opened + interval '1 year')::date
    when l.sort_order = 4 and a.id = 'ENT-2014' then (current_date + 9)
    else null
  end,
  '[]'::jsonb,
  l.sort_order
from public.enterprise_accounts a
cross join public.business_onboarding_ladder l
cross join lateral (
  /* Before their first invoice. An account cannot have been invoiced before it
     was opened, and a back-fill that says otherwise is a back-fill somebody
     will find. */
  select coalesce(
    (select min(i.issued::date) - 40 from public.enterprise_invoices i where i.account_id = a.id),
    current_date - 400) as opened
) s
where a.id <> 'ENT-2007'
  and not exists (select 1 from public.enterprise_onboarding o where o.account_id = a.id)
on conflict (id) do nothing;

/* ------------------------------------------------------- two still asking -- */

insert into public.applications
  (id, access_code, email, phone, company, contact_name, country, kind, kind_of,
   state, reached, started, last_saved, submitted_on)
values
  ('APP-BIZ-3001', 'KESTREL-7742', 'procurement@northgate-logistics.in', '+91 80 4455 2210',
   'Northgate Logistics', 'Sunita Deshpande', 'IN', 'business', 'business',
   'submitted', 20, now() - interval '9 days', now() - interval '6 days',
   now() - interval '6 days'),
  ('APP-BIZ-3002', 'HARRIER-5518', 'finance@atlasclinics.ae', '+971 4 552 8830',
   'Atlas Clinics Group', 'Omar Haddad', 'AE', 'business', 'business',
   'draft', 11, now() - interval '3 days', now() - interval '1 day', null)
on conflict (id) do nothing;

/* Answers for the one that was actually submitted, so the desk has something to
   read rather than a name and a country. A submitted application with no
   answers is a row nobody can decide. */
insert into public.application_answers (application_id, field_id, value)
select 'APP-BIZ-3001', f.id,
  case f.id
    when 'biz-legal'    then 'Northgate Logistics Private Limited'
    when 'biz-industry' then 'Transport and logistics'
    when 'biz-staff'    then '340'
    when 'biz-sites'    then '11'
    when 'biz-terms'    then 'Net 30'
    when 'biz-threshold' then '150000'
    when 'biz-regno'    then 'U63030KA2016PTC091447'
    when 'biz-address'  then '18 Hosur Road, Bengaluru 560029'
    when 'biz-regtype'  then 'GSTIN'
    when 'biz-taxid'    then '29AAECN4471M1ZR'
    when 'biz-supply'   then 'Karnataka'
    when 'biz-exempt'   then 'no'
    when 'biz-reverse'  then 'no'
    when 'biz-spend'    then '4200000'
    when 'biz-fy'       then '2026-04-01'
    when 'biz-refs'     then 'Sundaram Freight (Net 30, 4 years) and Deccan Warehousing (Net 45, 2 years)'
    when 'biz-mandate'  then 'HDFC Bank, Koramangala'
    when 'biz-signatory' then 'Sunita Deshpande'
    when 'biz-signatory-email' then 'sunita.deshpande@northgate-logistics.in'
    when 'biz-po'       then 'yes'
    when 'biz-cc'       then 'yes'
    when 'biz-admin'    then 'Sunita Deshpande'
    else 'Provided on the form'
  end
from public.application_fields f
where f.kind_of = 'business'
on conflict do nothing;

/* ------------------------------------------------------------- assertions -- */

do $$
declare n integer;
begin
  select count(distinct account_id) into n from public.enterprise_onboarding;
  if n < 6 then
    raise exception 'Only % accounts have an onboarding record.', n;
  end if;

  /* Every step of every ladder, or the screen shows a rail with holes in it. */
  select count(*) into n from public.enterprise_accounts a
   where (select count(*) from public.enterprise_onboarding o where o.account_id = a.id) <> 6;
  if n > 0 then raise exception '% accounts have an incomplete ladder.', n; end if;

  /* Nothing done before the account could have existed. */
  select count(*) into n from public.enterprise_onboarding o
    join public.enterprise_invoices i on i.account_id = o.account_id
   where o.done_on is not null and o.done_on > i.issued::date;
  if n > 0 then
    raise exception '% onboarding steps were completed after the account had already been invoiced.', n;
  end if;

  /* A step that is not done says when it is due, or nobody is ever late. */
  select count(*) into n from public.enterprise_onboarding
   where state in ('due', 'overdue') and due_on is null;
  if n > 0 then raise exception '% open steps have no date on them.', n; end if;

  select count(*) into n from public.applications where kind_of = 'business' and state = 'submitted';
  if n = 0 then raise exception 'Nothing is waiting on the desk, so the queue is still unshowable.'; end if;
end $$;
