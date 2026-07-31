-- Rewards, from the seller's side.
--
-- The loyalty programme has always issued points on sellers' products and
-- recovered the cost from their settlements, and no seller could see a single
-- movement of it: `loyalty_ledger` was readable by the customer who earned the
-- points and by the operator, and by nobody else. A seller was being billed for
-- a campaign they could not read, itemised on a statement line they could not
-- check.
--
-- Three things here:
--
--   * a seller may read the movements attributed to them — their own products,
--     their own cost, nothing about another seller's customers;
--   * a seller may propose a rule that spends their own margin, and only their
--     own. The marketplace still decides whether it runs;
--   * the proposal carries who asked, when, and what the marketplace said back,
--     because a proposal refused in a meeting is a proposal that gets asked for
--     again next quarter.

/* ---------------------------------------------------------- proposals ----- */

alter table loyalty_earn_rules add column if not exists proposed_by   text;
alter table loyalty_earn_rules add column if not exists proposed_on   date;
alter table loyalty_earn_rules add column if not exists decided_by    text;
alter table loyalty_earn_rules add column if not exists decided_on    date;
alter table loyalty_earn_rules add column if not exists decision_note text;

/* A rule the marketplace wrote has no proposer; a rule a seller asked for has
   one, and it has to be scoped to that seller. Nobody proposes a rule that
   spends somebody else's margin. */
alter table loyalty_earn_rules drop constraint if exists loyalty_earn_rules_proposal_check;
alter table loyalty_earn_rules add constraint loyalty_earn_rules_proposal_check
  check ((proposed_by is null) = (proposed_on is null));

alter table loyalty_earn_rules drop constraint if exists loyalty_earn_rules_proposed_scope_check;
alter table loyalty_earn_rules add constraint loyalty_earn_rules_proposed_scope_check
  check (proposed_by is null or (scope = 'partner' and scope_id is not null));

/* A decision says who made it. A rule still pending has not had one. */
alter table loyalty_earn_rules drop constraint if exists loyalty_earn_rules_decision_check;
alter table loyalty_earn_rules add constraint loyalty_earn_rules_decision_check
  check ((decided_by is null) = (decided_on is null));

/* Shared means split at a stated rate. Anything else is a rule whose funding
   nobody can compute, which is the argument this column exists to end. */
alter table loyalty_earn_rules drop constraint if exists loyalty_earn_rules_split_check;
alter table loyalty_earn_rules add constraint loyalty_earn_rules_split_check
  check ((funder = 'shared') = (split is not null));

/* ERN-10 was already sitting as a plain rule; it becomes what it actually is —
   something a seller asked for and nobody has answered.

   It was also seeded as a shared 60/40, which a seller cannot propose: the
   insert policy below only lets them spend their own margin. A seeded row that
   the rules forbid teaches whoever reads the demo the wrong rule, so it becomes
   a seller-funded proposal, and the marketplace agreeing to carry part of it is
   the thing the operator does on approval. */
update loyalty_earn_rules
set proposed_by = 'Rajesh Kumar (Nimbus Sensors)', proposed_on = '2026-07-18',
    funder = 'partner', split = null, status = 'pending',
    decided_by = null, decided_on = null, decision_note = null,
    why = 'Gateways sell alongside sensors and rarely on their own. We would fund the attach and would take a 60/40 split with the marketplace if you think it earns one.'
where id = 'ERN-10';

insert into loyalty_earn_rules (id, name, scope, scope_id, rate, funder, split, status,
                                "from", "to", cap_per_order, cap_per_month, audience, why,
                                proposed_by, proposed_on)
values
  ('ERN-11', 'Sentinel renewal bonus', 'partner', 'PTR-1003', 2.0, 'partner', null, 'pending',
   '01 Sep 2026', '31 Dec 2026', 1500, null, 'enterprise',
   'Managed security renews or it churns, and the decision is made a month before the anniversary. Points at the renewal are cheaper than winning the account back.',
   'Farah Al Hashimi (Sentinel Cyber)', '2026-07-26')
on conflict (id) do nothing;

/* ------------------------------------------- a contradiction in the ledger -- */

/* LTX-70175 said Sanya Kapoor earned 680 points on ORD-881044 under the device
   trade-in rule. Three things wrong with one row: ORD-881044 is Priya Raman's,
   it is an IoT sensor rather than a device, and the order was refunded on
   02 Jul — while the refund record states in as many words that the points were
   reversed with it. They were not. A seller reading their new rewards page
   would have found themselves billed $6.80 for loyalty on a sale that did not
   stand, which is the exact complaint this page invites.

   So: put it on the right member, under the seller's own rule, and reverse it
   the day the refund was granted. */
update loyalty_ledger
set member = 'LM-4001', rule_id = 'ERN-09', when_date = '01 Jul 2026',
    note = 'Nimbus Occupancy sensor — 2.5x seller funded'
where id = 'LTX-70175';

insert into loyalty_ledger (id, member, when_date, type, points, ref, rule_id, funder,
                            seller_id, value, note)
values
  ('LTX-70176', 'LM-4001', '02 Jul 2026', 'reverse', -680, 'ORD-881044', 'ERN-09', 'partner',
   'PTR-1004', 6.80,
   'Order refunded inside the 14-day window — points went back and the cost came off the seller')
on conflict (id) do nothing;

/* Two movement notes call a Nimbus sensor a "tracker". A tracker is what
   TrackWise sells; this is the seller's own page and it reads as somebody
   else's product on their bill. */
update loyalty_ledger set note = 'Nimbus sensor pack' where id = 'LTX-70199';
update loyalty_ledger set note = 'Nimbus Occupancy sensor — consumer purchase' where id = 'LTX-70190';

/* A collision the refunds migration introduced and nothing caught at the time:
   RFN-3228 was filed against ORD-881207, which the loyalty ledger already uses
   for a 9,600-point issue to Brightline Foods on a Sentinel Cyber security
   purchase. Two different sellers, two different products, one order reference.
   The refund is the newer record and the arbitrary one, so it moves. */
update refunds set order_ref = 'ORD-881211' where id = 'RFN-3228';

/* The window of movements is a recent sample rather than the whole history, so
   a balance is not the sum of it. It still has to move when something inside
   the window moves. */
update loyalty_members set balance = balance - 680
where id = 'LM-4001' and balance >= 680
  and not exists (select 1 from loyalty_members m2 where m2.id = 'LM-4001' and m2.balance = 2500);

/* ------------------------------------------------------------------ RLS ---- */

drop policy if exists "partner_read_own_loyalty_ledger" on loyalty_ledger;
drop policy if exists "partner_propose_earn_rule"       on loyalty_earn_rules;
drop policy if exists "partner_withdraw_own_proposal"   on loyalty_earn_rules;

/* Their own cost, and nothing about another seller's customers — the same
   boundary every other screen in this console keeps. The member id travels with
   the row, but a seller cannot resolve it: loyalty_members stays operator and
   owner only. */
create policy "partner_read_own_loyalty_ledger" on loyalty_ledger
  for select to authenticated using (seller_id = current_partner_id());

/* A seller may spend their own margin and only their own. The check is the
   whole control: partner-scoped, scoped to *them*, funded by them, and arriving
   as a proposal rather than as a live rule. A rule that issues points before
   anybody agreed to it is a rule that has already cost somebody money. */
create policy "partner_propose_earn_rule" on loyalty_earn_rules
  for insert to authenticated
  with check (
    scope = 'partner'
    and scope_id = current_partner_id()
    and funder = 'partner'
    and status = 'pending'
    and proposed_by is not null
  );

/* Withdrawing something nobody has answered. Not an update: letting a seller
   edit a rule in place would let them edit one after it was approved. */
create policy "partner_withdraw_own_proposal" on loyalty_earn_rules
  for delete to authenticated
  using (
    scope = 'partner'
    and scope_id = current_partner_id()
    and status = 'pending'
    and proposed_by is not null
  );

/* ------------------------------------------------------ sanity assertions -- */
do $$
declare n integer; b numeric;
begin
  /* Somebody has to be billed for every point that is not the marketplace's. */
  select count(*) into n from loyalty_ledger
   where funder in ('partner', 'shared') and seller_id is null;
  if n > 0 then
    raise exception '% ledger movements are charged to a seller nobody named', n;
  end if;

  /* And that somebody has to exist. */
  select count(*) into n from loyalty_ledger l
   where l.seller_id is not null
     and not exists (select 1 from partners p where p.id = l.seller_id);
  if n > 0 then
    raise exception '% ledger movements name a seller that is not on the books', n;
  end if;

  select count(*) into n from loyalty_earn_rules r
   where r.scope = 'partner'
     and not exists (select 1 from partners p where p.id = r.scope_id);
  if n > 0 then
    raise exception '% earn rules are scoped to a seller that does not exist', n;
  end if;

  /* An earn attributed to a seller must be under a rule that could have issued
     it — their own, or one that covers the marketplace they sell in. */
  select count(*) into n
    from loyalty_ledger l
    join loyalty_earn_rules r on r.id = l.rule_id
    join products p on p.partner_id = l.seller_id and p.partner_id is not null
   where l.rule_id is not null and r.scope = 'partner' and r.scope_id <> l.seller_id;
  if n > 0 then
    raise exception '% movements bill a seller under another seller''s rule', n;
  end if;

  /* The one this migration exists to fix. Points issued on an order that was
     refunded have to be reversed: a seller is not charged for loyalty on a sale
     that did not stand, and the refund record already says so. */
  select count(*) into n
    from loyalty_ledger l
   where l.type = 'earn'
     and exists (select 1 from refunds f
                  where f.order_ref = l.ref and f.state in ('refunded', 'partial'))
     and not exists (select 1 from loyalty_ledger rv
                      where rv.ref = l.ref and rv.type = 'reverse' and rv.member = l.member);
  if n > 0 then
    raise exception '% point issues stand against orders that were refunded', n;
  end if;

  /* A movement has to sit on the member who earned it. */
  select count(*) into n
    from loyalty_ledger l
    join orders o on o.order_ref = l.ref
    join loyalty_members m on m.id = l.member
   where m.name <> o.buyer_name;
  if n > 0 then
    raise exception '% movements credit points to somebody other than the buyer on the order', n;
  end if;

  /* The demo seller must have both a clawback and a redemption on their record,
     or two of the four numbers on the new page are demonstrated against
     nothing. */
  select count(*) into n from loyalty_ledger
   where seller_id = 'PTR-1004' and type = 'reverse';
  if n < 2 then
    raise exception 'the demo seller has fewer than two clawbacks — the reversal case is thin';
  end if;
  select count(*) into n from loyalty_ledger
   where seller_id = 'PTR-1004' and type = 'redeem';
  if n < 1 then
    raise exception 'nothing has been redeemed against the demo seller';
  end if;

  /* And the marketplace must have something to approve. */
  select count(*) into n from loyalty_earn_rules
   where status = 'pending' and proposed_by is not null;
  if n < 2 then
    raise exception 'fewer than two seller proposals are waiting — the approval queue is thin';
  end if;

  select balance into b from loyalty_members where id = 'LM-4001';
  if b <> 2500 then
    raise exception 'LM-4001 balance is % — the reversal was applied more or less than once', b;
  end if;
end $$;
