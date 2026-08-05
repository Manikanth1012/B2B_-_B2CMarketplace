/*
  # Full platform access held half the platform

  `role-001` is described as "Full platform access — all modules and
  configuration". Showing the whole capability catalogue in the role editor —
  rather than only the keys a role happened to be written with — made it read:

      Operator Admin    14 full · 14 none

  It holds none of `dashboard`, `access`, `security`, `sessions`, `reports`,
  `ledger`, `tax`, `mor`, `support`, `routing`, `listings`, `collections`,
  `compliance` or `integrations`. The platform administrator cannot, on paper,
  open the operator dashboard.

  This is the ordinary way a permission matrix rots: the role was written when
  the console had fourteen capabilities, fourteen more arrived with the screens
  that needed them, and nothing went back to the roles. The old form could not
  have shown it — it listed only the keys already on the role, so the fourteen
  missing ones were not absent-looking, they were invisible.

  ## What this does and does not change

  Nothing in the operator console reads `operator_roles.capabilities` to decide
  what anybody may do; it is a declarative matrix that the roles screen renders
  and the audit trail refers to. So this grants no access that was being
  withheld — it makes the record agree with its own description.

  It is still a change to a role definition, and it is deliberately the only one
  made here. Every other role's description is a summary ("Settlement approval,
  billing, tax, GL") rather than a claim about completeness, and none of them
  can be checked the way "all modules" can.
*/

update operator_roles r
   set capabilities = (
     select jsonb_object_agg(c.id, 'full')
       from operator_capabilities c
   )
 where r.id = 'role-001';

do $$
declare n integer; r record;
begin
  /* The claim and the grant agree. */
  select count(*) into n from operator_capabilities c
   where not exists (
     select 1 from operator_roles ro, jsonb_each_text(ro.capabilities) e(k, v)
      where ro.id = 'role-001' and e.k = c.id and e.v = 'full');
  if n > 0 then
    raise exception 'The role described as full platform access is missing % capabilities', n;
  end if;

  /* And nobody else was moved. This migration is about one row. */
  select count(*) into n from operator_roles
   where id <> 'role-001'
     and (select count(*) from jsonb_each_text(capabilities) e(k, v) where e.v <> 'none') = 0;
  if n > 0 then raise exception '% roles now hold nothing', n; end if;

  select count(*) into n from operator_roles where id = 'role-002'
    and capabilities->>'audit' <> 'read';
  if n > 0 then raise exception 'The Finance Auditor''s read-only grants were changed'; end if;

  /* Every role still holds only levels the console understands — the grant
     above is written by a query, and a query that produced 'true' or 'yes'
     would have been accepted by the update and refused by nothing else. */
  for r in
    select ro.name, e.k, e.v from operator_roles ro, jsonb_each_text(ro.capabilities) as e(k, v)
     where e.v not in ('none', 'read', 'scoped', 'full')
  loop
    raise exception '% holds % at "%"', r.name, r.k, r.v;
  end loop;
end $$;
