/* "Who chose what" listed its recipients as `e5b3c7a1…`.
 *
 * The screen exists to answer one support question — "why was I not told?" —
 * and it cannot be answered against a truncated UUID. Every one of those ids
 * resolves to a named person the marketplace already holds:
 *
 *   7c9e1f42…  Wanjiru Kamau      CUS-449288  consumer, Nairobi
 *   d5a4012b…  Priya Raman        CUS-449021  consumer, Bengaluru
 *   e5b3c7a1…  Otieno Odhiambo    CUS-450031  consumer, Nairobi
 *   e0e1d692…  Vikram Shah        ENT-2007    Procurement Lead, SmartBuild
 *   PTR-1004   Nimbus Sensors                 whole seller account
 *
 * The screen never asked. It read `notification_preferences` and printed the
 * foreign key.
 *
 * A view rather than four joins in the client: the same resolution is wanted by
 * the history tab, and a directory that lives in one place cannot disagree with
 * itself. `security_invoker` so the operator's read is the operator's read —
 * the operator has a select policy on all four source tables, a consumer has
 * one on their own row only, and this view inherits both rather than granting
 * anything new.
 */

create or replace view public.notification_recipient
with (security_invoker = on) as
  /* A shopper: their own account, and the market they shop in — support asks
     "which Priya" often enough that the reference number earns its column. */
  select 'user'::text                     as scope,
         cp.user_id::text                 as key,
         cp.name                          as name,
         'consumer'::text                 as persona,
         cp.customer_id                   as ref,
         coalesce(cp.city, cp.market, '') as detail
    from public.consumer_profile cp
   where cp.user_id is not null

  union all

  /* A named person inside a buying account. The job title is the detail that
     matters here: "Vikram turned off approval requests" is a different problem
     when Vikram is the one who approves them. */
  select 'user',
         eu.user_id::text,
         eu.name,
         'enterprise',
         coalesce(eu.user_ref, eu.account_id),
         coalesce(eu.title || ' · ', '') || coalesce(ea.company, eu.account_id)
    from public.enterprise_users eu
    left join public.enterprise_accounts ea on ea.id = eu.account_id
   where eu.user_id is not null

  union all

  /* A seller preference is set for the whole account rather than for a person,
     which is why it keys on the partner and not on a user. */
  select 'partner',
         p.id,
         p.name,
         'partner',
         p.id,
         coalesce(p.tier, '') || case when p.country is not null then ' · ' || p.country else '' end
    from public.partners p

  union all

  select 'user',
         ou.id,
         ou.name,
         'operator',
         ou.id,
         coalesce(ou.role_name, '')
    from public.operator_users ou;

comment on view public.notification_recipient is
  'Who a notification preference or log line belongs to, by name. One row per '
  'addressable recipient across the four personas. security_invoker, so it '
  'shows exactly what the reader could already select from the source tables.';

grant select on public.notification_recipient to authenticated, anon;

do $$
declare
  missing text;
  named   int;
begin
  /* Every preference on file must resolve to somebody. A preference whose owner
     the directory cannot name is the bug this migration exists to remove, and
     it would come back silently. */
  select string_agg(k, ', ') into missing
    from (
      select coalesce(p.partner_id, p.user_id::text) as k
        from public.notification_preferences p
       where not exists (
         select 1 from public.notification_recipient r
          where r.key = coalesce(p.partner_id, p.user_id::text))
       group by 1
    ) s;
  if missing is not null then
    raise exception 'preferences whose owner cannot be named: %', missing;
  end if;

  select count(*) into named from public.notification_recipient;
  raise notice 'directory holds % addressable recipients', named;
end $$;
