/* A treaty rate no payment in the marketplace was eligible for.
 *
 * The migration before last took thirteen treaty certificates off thirteen
 * domestic payments, because a double-tax treaty governs a payment that crosses
 * a border and does nothing to one that does not. That was right, and it left
 * three things in the withholding model exercised by nothing at all:
 *
 *   `withholding_rule.treaty_rate` — the 15% Kenyan commission rate under a
 *   treaty. Every payee is now resident, so no statement can reach it.
 *
 *   `withholding_on`'s non-resident branch, which is the expensive one: 20% in
 *   Kenya against 5% domestic. A rule that quadruples a deduction and has never
 *   run against a real statement is a rule nobody has checked.
 *
 *   `taxPosition`'s renewal window, which was demonstrated by the demo seller's
 *   own certificate and now has no certificate anywhere to count down.
 *
 * A marketplace with sellers in three countries and payments in three countries
 * and no cross-border payee between them is not a simplification, it is the
 * case the whole module exists for going untested.
 *
 * And a second thing, found on the way. Every seller's finance gate record —
 * the evidence an operator approved them on — disagrees with `partner_bank`
 * about the bank, the account, and the country the seller is taxed in. The gate
 * says Nimbus Sensors banks with Deutsche Bank and is taxed in Germany; the
 * settlement record says HDFC Bank and India. Both were seeded, neither was
 * read against the other, and the one an approver looks at is the wrong one.
 */

/* ---- 1. One payee that is actually paid across a border ---------------------- */

/* Beacon Reseller Co trades in the Kenyan marketplace and contracts through its
 * Dubai holding company — an ordinary structure for a regional distributor
 * serving East Africa, and the reason the Kenya–UAE treaty exists.
 *
 * Note what does NOT move: the settlement bank stays in Nairobi and the payout
 * stays in shillings. Residence is a tax fact, not a banking one, and a model
 * that inferred one from the other would deduct the wrong rate from anybody who
 * banks outside their own country. Nor does the KRA PIN move: a non-resident
 * earning Kenyan-source income still registers with the KRA, and the
 * certificate is issued against that number.
 */
update public.partner_bank set
  tax_residence  = 'AE',
  residency      = 'United Arab Emirates',
  treaty_on_file = true,
  /* Deliberately inside the sixty-day renewal window. A certificate expiring
     next spring demonstrates nothing — the screen that counts down to it would
     never be seen counting. */
  treaty_expires = date '2026-09-30',
  withholding    = 'Cross-border payment — the payee is a UAE tax resident paid by the Kenyan entity, so the non-resident rate of 20% applies. The Kenya–UAE double-tax treaty reduces it to 15% while a valid residence certificate is on file. The KRA PIN stays the Kenyan registration the certificate is issued against.'
where partner_id = 'PTR-1009';

/* ---- 2. Recompute what that changes ------------------------------------------ */

/* One statement is affected: the only one of Beacon's that is not yet approved.
 * An approved statement is not rewritten — the rate that applied is the rate it
 * was signed off at, and a correction belongs in the next period, not in a
 * document somebody has already agreed.
 */
do $$
declare
  s  record;
  d  record;
  wht numeric;
  detail jsonb;
begin
  for s in
    select st.*, p.market
      from public.settlement_statements st
      join public.partners p on p.id = st.partner_id
     where st.partner_id = 'PTR-1009'
       and st.status not in ('paid', 'approved')
  loop
    wht := 0;
    detail := '[]'::jsonb;
    for d in
      select * from public.withholding_on(
        s.market, 'partner-payout', 'AE', true,
        s.gross, s.commission, s.gross - s.commission - s.fees - s.refunds,
        s.closed_on)
    loop
      if d.amount > 0 then
        wht := wht + d.amount;
        detail := detail || jsonb_build_object(
          'rule_id', d.rule_id, 'statute', d.statute, 'label', d.label,
          'basis', d.basis, 'rate', d.rate, 'amount', d.amount);
      end if;
    end loop;

    update public.settlement_statements set
      withholding        = wht,
      withholding_rate   = case when s.gross > 0 then round(wht / s.gross * 100, 3) else 0 end,
      withholding_detail = detail,
      net                = round(s.gross - s.commission - s.fees - s.refunds - wht, 2),
      /* The payout leg is derived from the net, at the rate already frozen on
         the statement. Changing the net and leaving the payout is how a
         statement comes to say two different things about one payment. */
      payout_net         = round((s.gross - s.commission - s.fees - s.refunds - wht) * s.fx_rate, 2)
     where id = s.id;

    /* And the certificate, which is what the seller claims the deduction back
       with. A certificate that still says 82.71 against a statement that
       deducted 248.13 is a dispute the marketplace loses. */
    update public.withholding_certificate c set
      amount = (select coalesce(sum((e.value ->> 'amount')::numeric), 0)
                  from public.settlement_statements st2
                  left join lateral jsonb_array_elements(st2.withholding_detail) e
                    on e.value ->> 'rule_id' = c.rule_id
                 where st2.partner_id = c.partner_id
                   and st2.closed_on between c.period_start and c.period_end)
     where c.partner_id = s.partner_id
       and c.period_start <= s.closed_on and c.period_end >= s.closed_on;
  end loop;
end $$;

/* ---- 3. The gate record and the settlement record, telling one story --------- */

/* The finance gate is rebuilt from `partner_bank` rather than corrected by
 * hand, because a second hand-written copy is what produced the disagreement in
 * the first place. The other gates' fields are left alone; only the finance
 * block has a table behind it.
 */
update public.onboarding_submissions s set
  fields = (
    select jsonb_build_array(
      jsonb_build_array('Settlement bank', b.bank),
      jsonb_build_array('Account holder', b.holder),
      jsonb_build_array('Account (masked)',
        '•••• ' || right(b.account, 4)),
      jsonb_build_array('Verification',
        case when b.verified then coalesce(b.method, 'Verified')
             else 'Two micro-deposits sent — the seller has not confirmed the amounts' end),
      jsonb_build_array('Settlement currency', b.currency),
      jsonb_build_array('Tax residency', b.residency),
      jsonb_build_array(b.tax_label, b.tax_id),
      jsonb_build_array('Treaty certificate',
        case when b.treaty_on_file and b.treaty_expires is not null
             then 'On file, valid to ' || to_char(b.treaty_expires, 'DD Mon YYYY')
             when p.market = b.tax_residence
             then 'Not applicable — this is a domestic payment'
             else 'Not yet supplied' end),
      jsonb_build_array('Withholding', b.withholding)
    )::jsonb
    from public.partner_bank b
    join public.partners p on p.id = b.partner_id
   where b.partner_id = s.partner_id
  )
 where s.gate_key = 'finance'
   and exists (select 1 from public.partner_bank b where b.partner_id = s.partner_id);

/* ---- 4. Assertions ------------------------------------------------------------ */

do $$
declare n int; bad text; r record; w numeric;
begin
  /* The point of the exercise: a payment that crosses a border, at a rate no
     other payment in the marketplace reaches. */
  select count(*) into n from public.partner_bank b
    join public.partners p on p.id = b.partner_id
   where b.tax_residence <> p.market;
  if n = 0 then raise exception 'still no cross-border payee anywhere'; end if;

  select * into r from public.withholding_on('KE', 'partner-payout', 'AE', true,
                                             10000, 1000, 9000, current_date);
  if r.rate <> 15 then
    raise exception 'the treaty rate is % rather than 15 — the treaty branch is not being reached', r.rate;
  end if;

  /* And that without the certificate it would be four times the domestic rate,
     which is what makes the certificate worth chasing. */
  select rate into w from public.withholding_on('KE', 'partner-payout', 'AE', false,
                                                10000, 1000, 9000, current_date);
  if w <> 20 then raise exception 'the non-resident rate is % rather than 20', w; end if;

  /* Beacon's open statement carries the treaty rate and adds up. */
  select count(*) into n from public.settlement_statements
   where id = 'ss-1009-202607'
     and abs(withholding - 248.13) < 0.01
     and abs(net - (gross - commission - fees - refunds - withholding)) < 0.01
     and abs(payout_net - net * fx_rate) < 0.01;
  if n <> 1 then
    raise exception 'the treaty deduction did not reach the statement: %',
      (select format('withholding %s, net %s, payout %s', withholding, net, payout_net)
         from public.settlement_statements where id = 'ss-1009-202607');
  end if;

  /* Nothing approved moved. A signed-off statement is not rewritten. */
  select count(*) into n from public.settlement_statements
   where partner_id = 'PTR-1009' and status in ('paid','approved') and withholding > 0;
  if n > 0 then raise exception '% approved statements were re-rated', n; end if;

  /* Every certificate still reconciles to the statements in its quarter. */
  select count(*) into n from (
    select c.partner_id, c.rule_id, c.period_start, c.amount,
           coalesce(sum((d.value ->> 'amount')::numeric), 0) as from_statements
      from public.withholding_certificate c
      left join public.settlement_statements s
        on s.partner_id = c.partner_id
       and s.closed_on between c.period_start and c.period_end
      left join lateral jsonb_array_elements(s.withholding_detail) d
        on d.value ->> 'rule_id' = c.rule_id
     group by c.partner_id, c.rule_id, c.period_start, c.amount
    having abs(c.amount - coalesce(sum((d.value ->> 'amount')::numeric), 0)) > 0.01
  ) x;
  if n > 0 then raise exception '% certificates no longer reconcile to their quarter', n; end if;

  /* A certificate inside the renewal window exists, so the countdown on the
     seller's tax panel has something to count. */
  select count(*) into n from public.partner_bank
   where treaty_on_file and treaty_expires between current_date and current_date + 60;
  if n = 0 then
    raise exception 'no certificate is inside the renewal window — the tax panel counts down to nothing';
  end if;

  /* The gate record and the settlement record now tell one story. */
  select string_agg(x.partner_id || ' (gate says ' || x.gate || ', bank says ' || x.bank || ')', '; ')
    into bad
    from (
      select s.partner_id,
             (select e -> 1 ->> 0 from jsonb_array_elements(s.fields) e
               where e -> 0 ->> 0 = 'Tax residency') as gate,
             b.residency as bank
        from public.onboarding_submissions s
        join public.partner_bank b on b.partner_id = s.partner_id
       where s.gate_key = 'finance'
    ) x
   where x.gate is distinct from x.bank;
  if bad is not null then raise exception 'finance gates still disagree with the bank record: %', bad; end if;

  select string_agg(s.partner_id, ', ') into bad
    from public.onboarding_submissions s
    join public.partner_bank b on b.partner_id = s.partner_id
   where s.gate_key = 'finance'
     and not exists (
       select 1 from jsonb_array_elements(s.fields) e
        where e -> 0 ->> 0 = 'Settlement bank' and e -> 1 ->> 0 = b.bank);
  if bad is not null then raise exception 'finance gates still name a different bank: %', bad; end if;

  raise notice 'cross-border payees: %; deducted this quarter: %',
    (select count(*) from public.partner_bank b join public.partners p on p.id = b.partner_id
      where b.tax_residence <> p.market),
    (select round(sum(amount), 2) from public.withholding_certificate where status = 'accruing');
end $$;
