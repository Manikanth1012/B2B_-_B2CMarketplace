/*
  # Read-Only Analyst could read nothing

  Writing a guard that refuses a capability level outside none, scoped and full
  found a fourth level already in the data:

      role-002  Finance Auditor      audit read · dunning read
      role-013  Read-Only Analyst    audit read · reports read · dashboard read

  The form offered three levels and the console understood three. `read` was
  neither offered nor understood, so every screen reading these roles fell
  through to its default and treated `read` as `none`.

  Which means the Read-Only Analyst — a role whose entire purpose is looking at
  things without changing them — held three capabilities and granted none of
  them. It has been an empty role for as long as it has existed, and it looks
  fully configured on the roles table, which lists "3 full · 0 scoped" style
  counts that quietly omit it.

  ## `read` is a real level, not a typo

  It was tempting to map it onto `scoped` and be done. That is wrong: they are
  different axes. `scoped` limits *breadth* — this seller, this market, this
  queue — and still permits acting. `read` limits *depth* — everything here, but
  changing none of it. A finance auditor scoped to one market is a different
  grant from a finance auditor who may look at every market and alter nothing,
  and the marketplace plainly wanted the second.

  So the level joins the other three rather than being flattened into them. Four
  now: none, read, scoped, full.

  ## What binds

  `guard_role_definition` accepts the four and refuses anything else, which is
  what turned this up. It also keeps refusing `scoped` on a capability that
  cannot be scoped — but `read` is always available, because there is no
  capability where looking is all-or-nothing in a way that excludes it.
*/

create or replace function guard_role_definition() returns trigger
language plpgsql security definer set search_path = public as $$
declare bad text;
begin
  select c into bad
    from unnest(coalesce(new.audit_categories, '{}')) c
   where not exists (select 1 from operator_audit_categories a where a.id = c)
   limit 1;
  if bad is not null then
    raise exception '% is not an audit category. A role scoped to one that does not exist can see nothing, and says nothing about it.', bad;
  end if;

  select k into bad
    from jsonb_object_keys(coalesce(new.capabilities, '{}'::jsonb)) k
   where not exists (select 1 from operator_capabilities c where c.id = k)
   limit 1;
  if bad is not null then
    raise exception '% is not a capability this console has. Nothing reads it, so granting it grants nothing.', bad;
  end if;

  /* Four levels. `read` was in the data and in nothing else — not in the form,
     not in the console, not in the first version of this guard — so the two
     roles holding it granted nothing at all. */
  select e.k || ' = ' || e.v into bad
    from jsonb_each_text(coalesce(new.capabilities, '{}'::jsonb)) as e(k, v)
   where e.v not in ('none', 'read', 'scoped', 'full')
   limit 1;
  if bad is not null then
    raise exception 'Capability % is not one of none, read, scoped or full.', bad;
  end if;

  /* Scoping is about breadth and some capabilities have none to limit. Reading
     is always available: there is nothing here that can only be looked at in
     full or not at all. */
  select e.k into bad
    from jsonb_each_text(coalesce(new.capabilities, '{}'::jsonb)) as e(k, v)
    join operator_capabilities c on c.id = e.k
   where e.v = 'scoped' and not c.scopable
   limit 1;
  if bad is not null then
    raise exception '% cannot be scoped — it is held in full, read-only, or not at all.', bad;
  end if;

  return new;
end $$;

do $$
declare n integer; r record;
begin
  /* Every level in the data is one the console now understands. */
  for r in
    select ro.name, e.k, e.v from operator_roles ro, jsonb_each_text(ro.capabilities) as e(k, v)
     where e.v not in ('none', 'read', 'scoped', 'full')
  loop
    raise exception '% holds % at "%", which is not a level', r.name, r.k, r.v;
  end loop;

  /* The two roles that were empty are not any more. */
  select count(*) into n
    from operator_roles ro, jsonb_each_text(ro.capabilities) as e(k, v)
   where ro.id = 'role-013' and e.v <> 'none';
  if n < 3 then
    raise exception 'The Read-Only Analyst holds % capabilities, so it is still an empty role', n;
  end if;

  /* And no role anywhere holds nothing, which is a role that signs somebody in
     to a blank console. */
  for r in
    select ro.name from operator_roles ro
     where not exists (
       select 1 from jsonb_each_text(ro.capabilities) as e(k, v) where e.v <> 'none')
  loop
    raise exception '% grants nothing, so anybody assigned it sees an empty console', r.name;
  end loop;

  /* The guard still refuses what it should. */
  begin
    update operator_roles set capabilities = capabilities || '{"audit":"readonly"}'::jsonb
     where id = 'role-002';
    raise exception 'A capability was set to a level that does not exist';
  exception when others then
    if sqlerrm like 'A capability was set%' then raise; end if;
  end;
end $$;
