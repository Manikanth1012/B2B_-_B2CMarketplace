/* The line guard refused to let a requisition be deleted.
 *
 * `guard_requisition_line` looks the parent requisition up so it can refuse a
 * line written into one that has already been decided. On DELETE it did the
 * same lookup — and a line is deleted precisely when its parent is going away,
 * because the foreign key cascades. By the time the trigger ran, the parent was
 * gone, the lookup found nothing, and it raised "there is no requisition
 * REQ-9025" over a row that had existed a moment earlier.
 *
 * So deleting a requisition became impossible for the account that owned it,
 * from a guard written to protect its lines. Withdrawing is unaffected — that
 * is a state change on the header and never touches a line — but anything that
 * genuinely removes one was blocked.
 *
 * It hid because the integration sweeps that delete their own requisitions did
 * not check the error on the way out. They reported success, left the rows
 * behind, and the next run failed on a count. The sweeps now assert what they
 * removed; this fixes what they were hitting.
 */

create or replace function guard_requisition_line() returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_req record;
  v_me  record;
  v_id  text;
begin
  /* Null persona is a migration or a service role; the operator has its own
     policy and its own reasons to correct a line. Neither is a buyer. */
  if current_persona() is distinct from 'enterprise' then
    return coalesce(new, old);
  end if;

  v_id := coalesce(new.requisition_id, old.requisition_id);
  select * into v_req from enterprise_requisitions where id = v_id;

  if v_req is null then
    /* The parent is already gone. On DELETE that is the cascade doing its job,
       and the decision was taken on the header a statement ago — by a policy
       that had already checked the account owns it. Refusing here would mean no
       requisition could ever be removed.

       On INSERT or UPDATE it is a different claim entirely: a line pointing at
       a requisition that does not exist. The foreign key would refuse it too,
       but this says so in a sentence. */
    if tg_op = 'DELETE' then
      return old;
    end if;
    raise exception 'there is no requisition %', v_id;
  end if;

  select * into v_me from enterprise_users where user_id = auth.uid();
  if v_me is null then
    raise exception 'you are not on this account';
  end if;
  if not v_me.can_raise then
    raise exception '% cannot raise a requisition on this account', v_me.name;
  end if;

  /* The rule this guard exists for. A decided requisition is a record of what
     was agreed, and its lines are what was agreed to. */
  if v_req.state <> 'pending' then
    raise exception '% was already %, so its lines cannot be changed — raise a new requisition',
      v_req.id, v_req.state;
  end if;

  return coalesce(new, old);
end $$;

/* --------------------------------------------------------- what is true -- */

do $$
declare
  v_ok  boolean;
  n     int;
begin
  select count(*) into n from pg_trigger
  where tgrelid = 'enterprise_requisition_lines'::regclass
    and tgname = 'enterprise_requisition_lines_guard';
  if n <> 1 then raise exception 'the line guard is not attached'; end if;

  /* The function still says the thing it exists to say. Asserted on the source
     because the behaviour itself needs a signed-in buyer, which this file does
     not have — `requisitionRaise.integration.test.ts` checks it from a client. */
  select prosrc like '%cannot be changed%' into v_ok
  from pg_proc where proname = 'guard_requisition_line';
  if not v_ok then
    raise exception 'the guard no longer refuses a line on a decided requisition';
  end if;

  select prosrc like '%tg_op = ''DELETE''%' into v_ok
  from pg_proc where proname = 'guard_requisition_line';
  if not v_ok then
    raise exception 'the guard still blocks the cascade';
  end if;
end $$;
