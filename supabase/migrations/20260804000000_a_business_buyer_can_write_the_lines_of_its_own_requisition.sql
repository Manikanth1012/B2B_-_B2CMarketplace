/* A requisition a buyer cannot put lines on.
 *
 * `enterprise_requisitions` has carried an ALL policy for the account since it
 * was built, so a business buyer could always write the header. Its lines
 * carried a SELECT policy and nothing else: readable, never writable by anybody
 * but the operator.
 *
 * The effect was that `raiseRequisition` — which inserts the header, then the
 * lines, then deletes the header if the lines fail — could not complete for the
 * persona it exists for. It wrote a requisition, was refused the lines, undid
 * itself, and reported "That was not raised". Nothing was left behind, so
 * nothing pointed at the cause. The catalogue's Add button was a toast with no
 * requisition behind it, which hid this one layer further down: the screen that
 * would have found it had never been built.
 *
 * What a line may do is narrower than what the header may. The header's rules
 * live in `guard_requisition`, which lets an approver move a requisition
 * through its states; a line has no states of its own and must simply stop
 * changing once the requisition has been decided. An approver who signs off
 * ₹3,64,979 of handsets and then finds a fortieth handset appended has approved
 * something that no longer exists.
 */

/* ------------------------------------------------------------ the policy -- */

/* Mirrors the header's: the account may write what belongs to it. The state
   rule is the trigger's job below, because a policy that silently matches no
   rows produces "nothing changed" rather than a sentence, and this one has a
   sentence worth reading. */
create policy account_write_enterprise_requisition_lines
  on enterprise_requisition_lines
  for all
  using (
    exists (
      select 1 from enterprise_requisitions r
      where r.id = enterprise_requisition_lines.requisition_id
        and r.account_id = current_account_id()
    )
  )
  with check (
    exists (
      select 1 from enterprise_requisitions r
      where r.id = enterprise_requisition_lines.requisition_id
        and r.account_id = current_account_id()
    )
  );

/* ----------------------------------------------------------- the guard --- */

create or replace function guard_requisition_line() returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_req   record;
  v_me    record;
  v_id    text;
begin
  /* Null persona is a migration or a service role; the operator has its own
     policy and its own reasons to correct a line. Neither is a buyer. */
  if current_persona() is distinct from 'enterprise' then
    return coalesce(new, old);
  end if;

  v_id := coalesce(new.requisition_id, old.requisition_id);
  select * into v_req from enterprise_requisitions where id = v_id;
  if v_req is null then
    raise exception 'there is no requisition %', v_id;
  end if;

  select * into v_me from enterprise_users where user_id = auth.uid();
  if v_me is null then
    raise exception 'you are not on this account';
  end if;
  if not v_me.can_raise then
    raise exception '% cannot raise a requisition on this account', v_me.name;
  end if;

  /* The whole point. A decided requisition is a record of what was agreed. */
  if v_req.state <> 'pending' then
    raise exception '% was already %, so its lines cannot be changed — raise a new requisition',
      v_req.id, v_req.state;
  end if;

  return coalesce(new, old);
end $$;

create trigger enterprise_requisition_lines_guard
  before insert or update or delete on enterprise_requisition_lines
  for each row execute function guard_requisition_line();

/* --------------------------------------------------------- what is true -- */

do $$
declare
  n int;
begin
  /* The policy exists and covers writes, not only reads. Asked of `pg_policies`
     rather than assumed from the statement above having run, because a policy
     for the wrong command would still have created cleanly. */
  select count(*) into n from pg_policies
  where tablename = 'enterprise_requisition_lines'
    and policyname = 'account_write_enterprise_requisition_lines'
    and cmd = 'ALL';
  if n <> 1 then
    raise exception 'the account write policy on requisition lines is not there (found %)', n;
  end if;

  /* And the read policy it joins is still there — replacing rather than adding
     would have been a silent narrowing. */
  select count(*) into n from pg_policies
  where tablename = 'enterprise_requisition_lines'
    and policyname = 'account_read_enterprise_requisition_lines';
  if n <> 1 then
    raise exception 'the account read policy on requisition lines went missing';
  end if;

  select count(*) into n from pg_trigger
  where tgrelid = 'enterprise_requisition_lines'::regclass
    and tgname = 'enterprise_requisition_lines_guard';
  if n <> 1 then
    raise exception 'the line guard is not attached';
  end if;

  /* RLS is on at all. A policy on a table with RLS disabled is decoration. */
  select count(*) into n from pg_class
  where oid = 'enterprise_requisition_lines'::regclass and relrowsecurity;
  if n <> 1 then
    raise exception 'row level security is off on enterprise_requisition_lines';
  end if;
end $$;

/* The line guard has to see the requisition to judge it, and the buyer's own
   SELECT policy would already show it — but `security definer` is what makes
   that true for the DELETE case too, where the parent may be being removed in
   the same statement. Both paths are exercised from a client in
   `requisitionRaise.integration.test.ts`, because RLS cannot be tested from
   here: this file runs as the service role, which bypasses every policy it
   just wrote. */
