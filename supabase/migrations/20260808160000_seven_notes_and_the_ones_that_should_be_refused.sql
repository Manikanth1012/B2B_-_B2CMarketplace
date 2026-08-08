/* Seven notes, and the four things the marketplace should refuse.
 *
 * Every state a screen has to draw needs a row behind it or the screen is drawn
 * against nothing: a note waiting for its second approver, one issued and
 * waiting for the run, ones that have settled, one the seller has challenged,
 * and one voided before it went anywhere.
 *
 * The amounts are chosen against the policy rather than at random. 175 is under
 * the 250 auto-approval floor and needs nobody. 640 is over it and under the
 * 1,000 evidence line. 1,284 needs evidence. 7,420 is over the 5,000 ceiling
 * and cannot issue on one signature — which is the note left sitting in
 * `pending`, because a threshold with nothing waiting behind it is a threshold
 * nobody has seen work.
 */

do $$
declare res jsonb; st text;
begin

/* ---- Issued and applied, on statements not yet signed off -------------------- */

/* Kestrel was charged 12% for the whole of June against a contracted 9.5%.
   Their own reconciliation would have caught it, which is the point: the
   correction is a note, so the commission line still says what was charged and
   the seller can see both numbers. */
insert into public.settlement_note
  (id, partner_id, kind, reason_id, amount, tax, tax_rate, period, ref, evidence, detail,
   state, raised_by, raised_on, approved_by, approved_on, void_on, void_reason)
values
  ('CN-2026-0031', 'PTR-1002', 'credit', 'comm-rate', 1284.40, 231.19, 18.00,
   'Jun 2026', 'ss-1002-202606', 'Rate card v4 against the rate applied in the June run',
   'Commission was applied at 12% against a contracted 9.5% for the whole of June. Corrected in full rather than netted, so the June statement still shows what was charged.',
   'issued', 'Renu Iyer', date '2026-07-02', 'Tomas Alvarez', date '2026-07-03', null, null),

  ('DN-2026-0032', 'PTR-1008', 'debit', 'sla-penalty', 640.00, 115.20, 18.00,
   'Jun 2026', 'Contract cl. 8.2', 'Fulfilment SLA report — 14 breaches against a cap of 5',
   'Dispatch SLA missed on 14 orders in a rolling month against a contractual cap of five. The clause sets the penalty; this is not a negotiated figure.',
   'issued', 'Renu Iyer', date '2026-07-04', 'Tomas Alvarez', date '2026-07-05', null, null),

  /* Under the auto-approval floor. Nobody signs it because the policy says
     nobody needs to, and the approver is recorded as the policy itself rather
     than left blank — a blank reads as an oversight. */
  ('CN-2026-0036', 'PTR-1003', 'credit', 'goodwill', 175.00, 31.50, 18.00,
   'Jul 2026', null, null,
   'Absorbing a month of a managed firewall subscription for Meridian Foods after a four-hour outage on our side of the interconnect. Keeps an account worth far more than the credit.',
   'issued', 'Amelia Nkosi', date '2026-07-17', 'Under the approval floor', date '2026-07-17', null, null),

/* ---- Waiting for a second signature ------------------------------------------ */

  /* The one the ceiling exists for. It cannot issue on Renu's signature, and
     Tomas's alone would not be enough either if he had raised it. */
  ('CN-2026-0035', 'PTR-1001', 'credit', 'overcharge', 7420.00, 1335.60, 18.00,
   'May 2026', 'ss-1001-202605', 'Duplicate platform fee lines in the May run — both charged on 31 May',
   'The platform fee was billed twice in the May run. The whole of the duplicate is reversed rather than the net, so both the charge and its reversal are visible on the statement.',
   'pending', 'Renu Iyer', date '2026-07-14', 'Tomas Alvarez', date '2026-07-15', null, null),

/* ---- Challenged -------------------------------------------------------------- */

  ('DN-2026-0034', 'PTR-1011', 'debit', 'chargeback', 89.99, 16.20, 18.00,
   'Jul 2026', 'ORD-881377', 'Issuer reason code 4855 — goods not received',
   'The buyer''s bank reversed the payment on a TrackWise asset tracker. The loss follows the sale.',
   'disputed', 'Renu Iyer', date '2026-07-11', 'Tomas Alvarez', date '2026-07-12', null, null),

/* ---- Voided before it went anywhere ------------------------------------------ */

  ('CN-2026-0033', 'PTR-1004', 'credit', 'promo-share', 310.00, 55.80, 18.00,
   'Jun 2026', 'PROMO-IOT-SUM26', 'Campaign approval, 11 June',
   'Half the summer IoT promotion discount, funded by the marketplace as agreed at launch.',
   'void', 'Renu Iyer', date '2026-07-08', null, null, date '2026-07-20',
   'Raised against the wrong campaign. PROMO-IOT-SUM26 was funded entirely by the seller; the marketplace share was on PROMO-IOT-Q3. Reraised as CN-2026-0038.'),

/* ---- A draft, which the seller cannot see ------------------------------------ */

  ('DN-2026-0037', 'PTR-1005', 'debit', 'undercharge', 412.00, 74.16, 18.00,
   'May 2026', 'May 2026', 'Fee schedule v3, listing surcharge not applied to eight listings',
   'The per-listing surcharge was not billed on eight PlayForge listings in May. Still being checked against the fee schedule before it goes to the seller.',
   'draft', 'Renu Iyer', date '2026-08-06', null, null, null, null)
on conflict (id) do nothing;

update public.settlement_note set
  disputed_on = date '2026-07-19',
  dispute_note = 'The order was delivered and signed for. Proof of delivery attached — the chargeback should be defended with the issuer rather than passed to us.'
 where id = 'DN-2026-0034' and dispute_note is null;

/* And the note it was reraised as, so the void points at something real. */
insert into public.settlement_note
  (id, partner_id, kind, reason_id, amount, tax, tax_rate, period, ref, evidence, detail,
   state, raised_by, raised_on, approved_by, approved_on)
values
  ('CN-2026-0038', 'PTR-1004', 'credit', 'promo-share', 310.00, 55.80, 18.00,
   'Jun 2026', 'PROMO-IOT-Q3', 'Campaign approval, 11 June — marketplace-funded half',
   'Half the Q3 IoT promotion discount, funded by the marketplace as agreed at launch. Replaces CN-2026-0033, which named the wrong campaign.',
   'issued', 'Renu Iyer', date '2026-07-20', 'Tomas Alvarez', date '2026-07-21')
on conflict (id) do nothing;

/* ---- Land the issued ones on the statements they belong to -------------------- */

/* Only statements that are still `pending` — submitted and not yet approved.
   A note cannot be added to something somebody has signed off, and the guard
   refuses it, so this is choosing the right target rather than working around
   a rule. */
for st in
  select distinct s.id from public.settlement_statements s
    join public.settlement_note n on n.partner_id = s.partner_id and n.state = 'issued'
   where s.status = 'pending'
   order by s.id
loop
  res := public.apply_notes(st);
  raise notice 'apply_notes(%): %', st, res;
end loop;

end $$;

/* ---- Assertions ------------------------------------------------------------- */

do $$
declare n int; bad text; want text; res jsonb; st public.settlement_statements;
begin
  /* Every state a screen draws exists. */
  foreach want in array array['pending', 'issued', 'applied', 'void', 'disputed', 'draft'] loop
    select count(*) into n from public.settlement_note where state = want;
    if n = 0 then raise exception 'no note is %, so that case is drawn against nothing', want; end if;
  end loop;

  /* Both directions, and both sides of every threshold. */
  if not exists (select 1 from public.settlement_note where kind = 'credit') then
    raise exception 'no credit note'; end if;
  if not exists (select 1 from public.settlement_note where kind = 'debit') then
    raise exception 'no debit note'; end if;
  if not exists (select 1 from public.settlement_note x, public.note_policy p
                  where x.amount < p.auto_approve_below) then
    raise exception 'nothing sits under the auto-approval floor'; end if;
  if not exists (select 1 from public.settlement_note x, public.note_policy p
                  where x.amount >= p.second_approval_above) then
    raise exception 'nothing sits above the second-approval ceiling'; end if;

  /* The ceiling is doing something: the note above it has not issued. */
  select count(*) into n from public.settlement_note x, public.note_policy p
   where x.amount >= p.second_approval_above and x.state = 'issued'
     and x.second_approved_by is null;
  if n > 0 then raise exception '% notes issued above the ceiling on one signature', n; end if;

  /* Nobody has approved their own. */
  select string_agg(id, ', ') into bad from public.settlement_note
   where approved_by is not null and approved_by = raised_by;
  if bad is not null then raise exception 'self-approved notes: %', bad; end if;

  /* Applied notes reached a statement, and it adds up. */
  select string_agg(x.id, ', ') into bad from (
    select s.id from public.settlement_statements s
     where s.adjustments <> 0
       and abs(s.net - (s.gross - s.commission - s.fees - s.refunds - s.withholding + s.adjustments)) > 0.01
  ) x;
  if bad is not null then raise exception 'statements whose net ignores their adjustments: %', bad; end if;

  select count(*) into n from public.settlement_statements where adjustments <> 0;
  if n = 0 then raise exception 'no statement carries an adjustment, so apply_notes did nothing'; end if;

  /* The detail behind the figure sums to the figure. */
  select string_agg(x.id, ', ') into bad from (
    select s.id from public.settlement_statements s
      left join lateral (
        select coalesce(sum(case d.value ->> 'kind' when 'credit' then (d.value ->> 'amount')::numeric
                                                    else -(d.value ->> 'amount')::numeric end), 0) as t
          from jsonb_array_elements(s.adjustment_detail) d
      ) k on true
     where s.adjustments <> 0 and abs(s.adjustments - k.t) > 0.01
  ) x;
  if bad is not null then raise exception 'adjustments that disagree with the notes behind them: %', bad; end if;

  /* Every applied note names the statement it landed on, and that statement
     names it back. */
  select string_agg(nt.id, ', ') into bad from public.settlement_note nt
   where nt.state = 'applied'
     and (nt.statement_id is null
          or not exists (select 1 from public.settlement_statements s
                          where s.id = nt.statement_id
                            and s.adjustment_detail @> jsonb_build_array(jsonb_build_object('note_id', nt.id))));
  if bad is not null then raise exception 'applied notes missing from their statement: %', bad; end if;

  /* ---- The four refusals ---- */

  /* A credit reason on a debit note. */
  begin
    insert into public.settlement_note (id, partner_id, kind, reason_id, amount, detail, raised_by)
    values ('ASSERT-1', 'PTR-1002', 'debit', 'goodwill', 100, 'probe', 'Assertion');
    raise exception 'a debit note was raised under a credit reason';
  exception when others then
    if sqlerrm not like '%is a credit reason%' then
      raise exception 'the reason check failed on % rather than the guard', sqlerrm; end if;
  end;

  /* Approving your own. */
  begin
    insert into public.settlement_note
      (id, partner_id, kind, reason_id, amount, detail, raised_by, approved_by, state)
    values ('ASSERT-2', 'PTR-1002', 'credit', 'goodwill', 400, 'probe', 'Renu Iyer', 'Renu Iyer', 'issued');
    raise exception 'somebody approved their own note';
  exception when others then
    if sqlerrm not like '%cannot also approve it%' then
      raise exception 'the self-approval check failed on % rather than the guard', sqlerrm; end if;
  end;

  /* A second signature from the person who gave the first. */
  begin
    insert into public.settlement_note
      (id, partner_id, kind, reason_id, amount, evidence, detail,
       raised_by, approved_by, second_approved_by, state)
    values ('ASSERT-3', 'PTR-1002', 'credit', 'goodwill', 9000, 'probe evidence', 'probe',
            'Renu Iyer', 'Tomas Alvarez', 'Tomas Alvarez', 'issued');
    raise exception 'the same person signed a note twice';
  exception when others then
    if sqlerrm not like '%third person%' then
      raise exception 'the second-approver check failed on % rather than the guard', sqlerrm; end if;
  end;

  /* Issuing above the ceiling on one signature. */
  begin
    insert into public.settlement_note
      (id, partner_id, kind, reason_id, amount, evidence, detail, raised_by, approved_by, state)
    values ('ASSERT-4', 'PTR-1002', 'credit', 'goodwill', 9000, 'probe evidence', 'probe',
            'Renu Iyer', 'Tomas Alvarez', 'issued');
    raise exception 'a note above the ceiling issued on one signature';
  exception when others then
    if sqlerrm not like '%needs a second approver%' then
      raise exception 'the ceiling check failed on % rather than the guard', sqlerrm; end if;
  end;

  /* And a note cannot be added to a statement somebody has signed off. */
  select * into st from public.settlement_statements where status = 'paid' limit 1;
  res := public.apply_notes(st.id);
  if (res ->> 'ok')::boolean then
    raise exception 'a note was applied to a statement that has been paid';
  end if;

  delete from public.settlement_note where id like 'ASSERT-%';

  raise notice 'notes: % (% credit, % debit, % applied, % awaiting a second signature); adjusted statements %',
    (select count(*) from public.settlement_note),
    (select count(*) from public.settlement_note where kind = 'credit'),
    (select count(*) from public.settlement_note where kind = 'debit'),
    (select count(*) from public.settlement_note where state = 'applied'),
    (select count(*) from public.settlement_note where state = 'pending'),
    (select count(*) from public.settlement_statements where adjustments <> 0);
end $$;
