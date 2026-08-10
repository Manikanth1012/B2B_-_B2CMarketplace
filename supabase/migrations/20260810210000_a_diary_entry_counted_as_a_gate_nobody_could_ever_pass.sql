/* A diary entry counted as a gate nobody could ever pass.
 *
 * `business_onboarding_ladder` has six rows and only five of them are gates:
 * the sixth carries `gate_id = null` and says in its own text "Opened as a
 * diary entry, not something to do now". It is the annual credit review, and a
 * yearly review is never finished by design — it comes round again.
 *
 * `enterprise_onboarding`, the instantiated ladder, does not carry the gate at
 * all. So nothing downstream can tell the two kinds apart, and the first screen
 * to count them read "0 of 6 fully onboarded" for a book in which every company
 * had passed every real gate. The number was wrong about all six accounts and
 * would have been wrong about every account ever opened.
 *
 * The column, backfilled from the ladder it was instantiated from, and set by
 * `accept_application` from now on so the next company to be accepted carries
 * it without a second backfill.
 */

alter table public.enterprise_onboarding
  add column if not exists gate_id text;

comment on column public.enterprise_onboarding.gate_id is
  'The gate this step belongs to, or null where it is a diary entry rather than something that has to be passed. Onboarding completeness counts the gates only.';

update public.enterprise_onboarding o
   set gate_id = l.gate_id
  from public.business_onboarding_ladder l
 where l.sort_order = o.sort_order
   and o.gate_id is distinct from l.gate_id;

do $$
declare n integer;
begin
  /* Five gates and one diary entry, on every account. */
  select count(*) into n from public.enterprise_accounts a
   where (select count(*) from public.enterprise_onboarding o
           where o.account_id = a.id and o.gate_id is not null) <> 5;
  if n > 0 then
    raise exception '% accounts do not carry exactly five gates.', n;
  end if;

  select count(*) into n from public.enterprise_accounts a
   where (select count(*) from public.enterprise_onboarding o
           where o.account_id = a.id and o.gate_id is null) <> 1;
  if n > 0 then
    raise exception '% accounts do not carry exactly one diary entry.', n;
  end if;

  /* And the diary entry is the review, not something else that lost its gate. */
  select count(*) into n from public.enterprise_onboarding
   where gate_id is null and name <> 'Annual credit review';
  if n > 0 then
    raise exception '% steps have no gate and are not the annual review.', n;
  end if;
end $$;
/* And the function that instantiates the ladder carries the gate too, so the
 * next company accepted does not need a second backfill. */
CREATE OR REPLACE FUNCTION public.accept_application(p_ref text, p_note text DEFAULT NULL::text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  app applications;
  v_partner text;
  v_account text;
  v_actor text;
  v_country text;
  v_markets text[];
  v_currency text;
  n integer;
  answer text;
begin
  if current_persona() is distinct from 'operator' then
    raise exception 'Only the marketplace can accept an application.';
  end if;

  select * into app from applications where id = upper(trim(p_ref));
  if app.id is null then raise exception 'No application called %.', p_ref; end if;
  if app.state = 'accepted' then
    raise exception '% was already accepted, and is now %.', app.id,
      coalesce(app.partner_id, app.account_id);
  end if;
  if app.state <> 'submitted' then
    raise exception '% is %, so there is nothing to accept yet.', app.id, app.state;
  end if;

  select count(*) into n from application_fields f
   where f.required and f.kind_of = app.kind_of
     and not exists (select 1 from application_answers a
                      where a.application_id = app.id and a.field_id = f.id);
  if n > 0 then
    raise exception '% is missing % required answers. Send it back rather than accepting it.', app.id, n;
  end if;

  select count(*) into n from application_document_kinds k
   where k.required and k.kind_of = app.kind_of
     and not exists (select 1 from application_documents d
                      where d.application_id = app.id and d.kind_id = k.id);
  if n > 0 then
    raise exception '% is missing % required documents. Send it back rather than accepting it.', app.id, n;
  end if;

  v_actor := coalesce(current_setting('request.jwt.claims', true)::jsonb ->> 'email', 'the onboarding desk');
  select m.name into v_country from markets m where m.code = app.country;
  select mc.currency into v_currency from market_currencies mc
   where mc.market_code = app.country order by mc.is_default desc, mc.sort_order limit 1;

  if app.kind_of = 'business' then
    v_account := 'ENT-' || nextval('account_ref_seq')::text;

    insert into enterprise_accounts (
      id, company, legal_name, segment, industry, sites, staff, terms, currency,
      fy_starts, budget_year, reg_type, registration, place_of_supply,
      po_required, reverse_charge, cost_centre_on_invoice, tax_exempt,
      status, sort_order, market
    ) values (
      v_account, app.company,
      coalesce(nullif(trim(answer_of(app.id, 'biz-legal')), ''), app.company),
      /* Segment from headcount rather than asked for. A company that picks its
         own segment picks the one with the best terms. */
      case when coalesce(nullif(regexp_replace(answer_of(app.id, 'biz-staff'), '\D', '', 'g'), '')::integer, 0) >= 1000 then 'large'
           when coalesce(nullif(regexp_replace(answer_of(app.id, 'biz-staff'), '\D', '', 'g'), '')::integer, 0) >= 100 then 'mid'
           else 'small' end,
      coalesce(nullif(answer_of(app.id, 'biz-industry'), ''), 'Other'),
      coalesce(nullif(regexp_replace(answer_of(app.id, 'biz-sites'), '\D', '', 'g'), '')::integer, 1),
      coalesce(nullif(regexp_replace(answer_of(app.id, 'biz-staff'), '\D', '', 'g'), '')::integer, 1),
      /* The terms they asked for are what they asked for. The credit gate is
         where that becomes a decision, so the account opens on the shortest
         terms and is moved after the assessment. */
      'Net 30', v_currency,
      coalesce(nullif(answer_of(app.id, 'biz-fy'), '')::date, date_trunc('year', now())::date),
      /* No budget until somebody sets one. Their expected spend is what they
         said, not what the marketplace has agreed to carry. */
      0,
      coalesce(nullif(answer_of(app.id, 'biz-regtype'), ''), 'Not registered'),
      /* The tax number, which is what this column holds — ENT-2007's is a
         GSTIN. The company registration number is a separate answer the desk
         reads at verification and the account has nowhere to put. */
      nullif(answer_of(app.id, 'biz-taxid'), ''),
      coalesce(nullif(answer_of(app.id, 'biz-supply'), ''), v_country),
      answer_of(app.id, 'biz-po') = 'Yes',
      answer_of(app.id, 'biz-reverse') = 'Yes',
      answer_of(app.id, 'biz-cc') = 'Yes',
      answer_of(app.id, 'biz-exempt') = 'Yes',
      /* `on-hold`, which is the only value in this column's check constraint
         that means "exists and cannot trade". There is no 'onboarding' status
         on an account the way there is on a partner, and inventing one would
         have needed the constraint widening for a state the rest of the
         screens do not understand. The ladder below is what says why it is
         held: an account that could buy before its credit assessment is an
         account with no limit. */
      'on-hold', 0, app.country
    );

    /* The steps, from the ladder, with the documents filed against the one that
       reads each. `documents` is the jsonb the screens render and
       `document_paths` is what opens them — both, because the existing rows
       carry both and a step with one and not the other renders a name that
       clicks through to nothing. */
    insert into enterprise_onboarding (id, account_id, name, detail, state, due_on,
                                       documents, document_paths, sort_order, gate_id)
    select 'BO-' || replace(v_account, 'ENT-', '') || '-' || l.sort_order,
           v_account, l.name, l.detail,
           /* All due. `enterprise_onboarding.state` allows done, due or
              overdue and nothing else — there is no "in progress" on this
              table, and which step the desk is working is read off the due
              dates, which is why they are staggered rather than all the same.
              A second constraint ties `done` to having a date and a name on it,
              so nothing can be marked finished by nobody. */
           'due',
           (now() + make_interval(days => coalesce(l.due_days, 30)))::date,
           coalesce((select jsonb_agg(jsonb_build_object(
                       'kind', upper(coalesce(nullif(split_part(d.mime, '/', 2), ''), 'FILE')),
                       'name', k.label,
                       'size', case when d.bytes < 1048576
                                    then to_char(round(d.bytes / 1024.0, 0), 'FM999999') || ' KB'
                                    else to_char(round(d.bytes / 1048576.0, 1), 'FM999990.9') || ' MB' end)
                       order by k.sort_order)
                      from application_documents d
                      join application_document_kinds k on k.id = d.kind_id
                     where d.application_id = app.id and k.gate_id = l.gate_id), '[]'::jsonb),
           coalesce((select array_agg(d.path order by k.sort_order)
                       from application_documents d
                       join application_document_kinds k on k.id = d.kind_id
                      where d.application_id = app.id and k.gate_id = l.gate_id), '{}'::text[]),
           l.sort_order,
           l.gate_id
      from business_onboarding_ladder l;

    /* A policy, so the approvals screen has something to read. The threshold is
       what they asked for; self-approval is off and stays off until somebody
       decides otherwise. */
    insert into enterprise_approval_policy (account_id, threshold, security_signoff,
                                            duplicate_flag, auto_approve_renewals, self_approve, note)
    values (v_account,
            coalesce(nullif(regexp_replace(answer_of(app.id, 'biz-threshold'), '\D', '', 'g'), '')::numeric, 100000),
            true, true, false, false,
            'Opened from ' || app.id || '. Asked for by the applicant and not yet reviewed.')
    on conflict (account_id) do nothing;

    update applications
       set state = 'accepted', account_id = v_account, last_saved = now()
     where id = app.id;
    return v_account;
  end if;

  /* ---- a seller, which is what this function used to only do ---- */
  v_partner := 'PTR-' || nextval('partner_ref_seq')::text;

  insert into partners (id, name, type, status, country, contact, email, joined, tier, tier_id)
  values (v_partner, app.company, app.kind, 'onboarding', v_country,
          app.contact_name, app.email, to_char(now(), 'DD Mon YYYY'), 'Bronze', 'bronze');

  perform open_partner_journey(
    v_partner,
    'Opened from ' || app.id || ' by ' || v_actor
      || case when coalesce(trim(p_note), '') = '' then '' else ': ' || trim(p_note) end,
    app.contact_name, app.submitted_on,
    array(select f.label from application_fields f
           where f.gate_id = 'apply' and f.required and f.kind_of = 'seller'
           order by f.sort_order));

  insert into onboarding_documents (id, gate_id, partner_id, name, kind, size, uploaded_by, uploaded_at, sort_order, path)
  select 'doc-' || v_partner || '-' || d.kind_id,
         'og-' || v_partner || '-' || k.gate_id,
         v_partner, k.label,
         upper(coalesce(nullif(split_part(d.mime, '/', 2), ''), 'FILE')),
         case when d.bytes < 1048576
              then to_char(round(d.bytes / 1024.0, 0), 'FM999999') || ' KB'
              else to_char(round(d.bytes / 1048576.0, 1), 'FM999990.9') || ' MB' end,
         app.contact_name, d.uploaded_at, k.sort_order, d.path
    from application_documents d
    join application_document_kinds k on k.id = d.kind_id
   where d.application_id = app.id;

  insert into onboarding_tasks (id, partner_id, gate_id, title, detail, owner, due)
  select 'OB-' || replace(v_partner, 'PTR-', '') || '-' || t.id,
         v_partner, t.gate_id, t.title, t.detail, t.owner,
         case when t.gate_id = 'apply'
              then case when t.days <= 1 then 'Today' else 'In ' || t.days || ' days' end
         end
    from onboarding_task_ladder t
   where not exists (select 1 from onboarding_tasks o
                      where o.id = 'OB-' || replace(v_partner, 'PTR-', '') || '-' || t.id);

  v_markets := string_to_array(coalesce(answer_of(app.id, 'apply-markets'), ''), ',');
  insert into partner_markets (partner_id, market_code, state, note)
  select v_partner, m.code, 'requested',
         'Asked for on ' || app.id || '. Approved at the compliance gate, not before.'
    from markets m
   where m.name = any (select trim(x) from unnest(v_markets) x)
  on conflict do nothing;

  insert into partner_contacts (id, partner_id, kind, value, purpose, label, verified, sort_order)
  values (v_partner || '-email', v_partner, 'email', app.email, 'signin', app.contact_name, false, 1),
         (v_partner || '-phone', v_partner, 'phone', app.phone, 'escalation', app.contact_name, false, 2)
  on conflict (id) do nothing;

  insert into partner_lifecycle_events (id, partner_id, from_status, to_status, reason, actor, at)
  values (v_partner || '-accepted', v_partner, null, 'onboarding',
          'Accepted from ' || app.id
            || case when coalesce(trim(p_note), '') = '' then '.' else ': ' || trim(p_note) end,
          v_actor, now());

  update applications
     set state = 'accepted', partner_id = v_partner, last_saved = now()
   where id = app.id;
  return v_partner;
end $function$
;
