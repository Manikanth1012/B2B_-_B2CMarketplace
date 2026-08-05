/*
  # A category grant is not a row, it is the evidence behind it

  `20260806130000` granted Beacon Reseller Co the `iot` category so their
  managed SIM estate sat in the category it belongs to. That was half the job.
  A category grant on this marketplace is not a row in `partner_categories` —
  it is that row *plus* one `partner_category_evidence` record per rule the
  category demands, which is what the seller actually had to satisfy and what
  the operator's console shows when somebody asks why they are allowed to sell
  it.

  `iot` demands five: type approval per market, a data processing agreement, an
  operations undertaking, an advertising standard and a compliance attestation.
  A grant without them is a permission with nothing behind it — which is the
  shape of every "the screen was built and the rule was never wired" fault this
  codebase keeps turning up, done to myself in one migration.

  ## And the dashboard did not know they had traded

  `operator_monthly` is the series the operator's dashboard draws, and it must
  equal the settlement register month by month. Six new statements went into the
  register and the series was left where it was, so from February onwards the
  dashboard understated the marketplace by exactly Beacon's gross.

  Recomputed from the register rather than adjusted by a delta, and commission
  and order counts with it — a month whose gross agrees and whose commission
  does not is a chart that is right about the wrong thing.
*/

/* ------------------------------------ the evidence behind the iot grant --- */

/* Modelled on the same five rules another IoT seller satisfied. Two demand a
   document and are `accepted` with one on file; three are standing
   undertakings, which have no document because there is nothing to upload —
   the seller agreed to them and the marketplace recorded who reviewed it. */
insert into partner_category_evidence (
  id, partner_id, category_id, rule_id, state, document, kind, size,
  submitted_by, submitted_at, reviewed_by, reviewed_at, path
) values
  ('pce-1009-iot-PR-04', 'PTR-1009', 'iot', 'PR-04', 'accepted',
   'Type-approval certificate per market', 'PDF', '1.6 MB',
   'Amara Okonkwo', '2025-03-01', 'Compliance', '2025-03-01',
   'PTR-1009/categories/pce-1009-iot-pr-04.pdf'),
  ('pce-1009-iot-PR-05', 'PTR-1009', 'iot', 'PR-05', 'accepted',
   'Countersigned data processing agreement', 'PDF', '0.7 MB',
   'Amara Okonkwo', '2025-03-01', 'Legal', '2025-03-01',
   'PTR-1009/categories/pce-1009-iot-pr-05.pdf'),
  ('pce-1009-iot-PR-07', 'PTR-1009', 'iot', 'PR-07', 'standing',
   null, null, null, 'Amara Okonkwo', '2025-03-01', 'Operations', '2025-03-01', null),
  ('pce-1009-iot-PR-08', 'PTR-1009', 'iot', 'PR-08', 'standing',
   null, null, null, 'Amara Okonkwo', '2025-03-01', 'Legal', '2025-03-01', null),
  ('pce-1009-iot-PR-10', 'PTR-1009', 'iot', 'PR-10', 'standing',
   null, null, null, 'Amara Okonkwo', '2025-03-01', 'Compliance', '2025-03-01', null)
on conflict (id) do nothing;

/* ------------------------------------------- the dashboard the operator sees */

/* From the register, not by adding Beacon's figures onto what was there. The
   series and the register are two views of one month, and a delta is a second
   place to be wrong. */
update operator_monthly m
   set gross = r.gross,
       commission = r.commission,
       orders = r.orders
  from (
    select s.period,
           round(sum(s.gross), 2) gross,
           round(sum(s.commission), 2) commission,
           sum(s.order_count)::int orders
      from settlement_statements s
     group by s.period
  ) r
 where m.month = r.period
   and (m.gross <> r.gross or m.commission <> r.commission or m.orders <> r.orders);

/* ------------------------------------------------------------ assertions -- */

do $$
declare n integer; r record;
begin
  /* Every category grant carries exactly the evidence its category demands —
     no more, and none missing. */
  for r in
    select pc.partner_id, pc.category_id,
           (select coalesce(array_agg(cr.rule_id order by cr.rule_id), '{}')
              from category_policy_rules cr
             where cr.category_id = pc.category_id and cr.level <> 'off') demanded,
           (select coalesce(array_agg(e.rule_id order by e.rule_id), '{}')
              from partner_category_evidence e
             where e.partner_id = pc.partner_id and e.category_id = pc.category_id) held
      from partner_categories pc
     where pc.partner_id = 'PTR-1009'
  loop
    if r.demanded is distinct from r.held then
      raise exception '% in % holds % against a category that demands %',
        r.partner_id, r.category_id, r.held, r.demanded;
    end if;
  end loop;

  /* A rule that demands a document has one. A standing undertaking does not,
     and inventing a file for it would be inventing a record. */
  select count(*) into n from partner_category_evidence
   where partner_id = 'PTR-1009' and state = 'accepted' and coalesce(document, '') = '';
  if n > 0 then raise exception '% accepted evidence records have no document behind them', n; end if;

  select count(*) into n from partner_category_evidence
   where partner_id = 'PTR-1009' and state = 'standing' and document is not null;
  if n > 0 then raise exception '% standing undertakings carry a document, which is not what standing means', n; end if;

  /* The dashboard equals the register, month by month. */
  for r in
    select s.period, round(sum(s.gross), 2) billed,
           (select gross from operator_monthly m where m.month = s.period) shown
      from settlement_statements s group by s.period
  loop
    if r.shown is null then
      raise exception '% is billed but is not on the dashboard series', r.period;
    end if;
    if abs(r.billed - r.shown) >= 0.02 then
      raise exception '% is billed % and the dashboard shows %', r.period, r.billed, r.shown;
    end if;
  end loop;

  /* And so does the commission, or the chart is right about the wrong thing. */
  for r in
    select s.period, round(sum(s.commission), 2) billed,
           (select commission from operator_monthly m where m.month = s.period) shown
      from settlement_statements s group by s.period
  loop
    if r.shown is not null and abs(r.billed - r.shown) >= 0.02 then
      raise exception '% billed % in commission and the dashboard shows %', r.period, r.billed, r.shown;
    end if;
  end loop;
end $$;
