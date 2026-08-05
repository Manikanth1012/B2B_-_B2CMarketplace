/*
  # Two things the Kenyan customer seed got wrong

  Both were written in `20260806010000` and neither was caught until the
  integration suite ran against the finished Kenyan market. Both are the same
  kind of mistake: a value invented rather than looked up.

  ## A ticket in a category that does not exist

      tk-ke-001   technical   Mesh node dropped off the network after a power cut

  `support_categories` has nine rows and `technical` is not one of them. The
  console groups the queue by category, so a ticket in an unknown one is a
  ticket that either disappears from the grouping or forms a group of one with
  no label — the operator's queue quietly stops being the whole queue.

  It belongs in `service`, whose own hint describes this ticket exactly: "It
  worked and now it does not."

  ## A refund deadline that is not the published one

      RFN-KE-01   requested 2025-11-28   due 2025-11-30   +2 days
      RFN-KE-02   requested 2026-07-31   due 2026-08-04   +4 days

  The marketplace publishes one response deadline and every row is meant to be
  it. The first Kenyan refund follows it and the second does not, which is worse
  than both being wrong: a customer reading the two learns that the deadline
  depends on who is looking, and a support desk cannot be measured against an
  SLA that moves.

  Recomputed from the request date and the published window rather than typed,
  so the two cannot drift apart again.
*/

update support_tickets set category = 'service'
 where id = 'tk-ke-001' and category = 'technical';

/* The published window, taken from the rows that already follow it rather than
   from a number written here. */
update refunds r
   set sla_due = r.requested + (
     select mode() within group (order by x.sla_due - x.requested)
       from refunds x where x.sla_due is not null and x.requested is not null
   )
 where r.id = 'RFN-KE-02';

do $$
declare n integer; r record;
begin
  /* Every ticket is in a category the console can group it under. */
  for r in
    select t.id, t.category from support_tickets t
     where not exists (select 1 from support_categories c where c.id = t.category)
  loop
    raise exception 'Ticket % is in %, which is not a category the queue has', r.id, r.category;
  end loop;

  /* And the category is one the persona who raised it is actually offered — a
     consumer ticket filed under a category only operators and businesses see is
     a ticket the customer could not have raised.

     Through `profiles.persona` rather than "has a user_id". Every persona has a
     user_id, and the first version of this check read a signed-in enterprise
     buyer's contract-pricing ticket as a customer's. */
  for r in
    select t.id, t.category, p.persona
      from support_tickets t
      join profiles p on p.id = t.user_id
      join support_categories c on c.id = t.category
     where not (p.persona = any (c.personas))
  loop
    raise exception 'Ticket % is in %, which is not offered to a %', r.id, r.category, r.persona;
  end loop;

  /* One published deadline, applied to every row. */
  select count(distinct (sla_due - requested)) into n
    from refunds where sla_due is not null and requested is not null;
  if n <> 1 then
    raise exception 'The refund book runs to % different response deadlines', n;
  end if;
end $$;
