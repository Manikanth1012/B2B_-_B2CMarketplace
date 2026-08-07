/* Putting back the lines the fold destroyed.
 *
 * Re-cutting five partners onto their contracted cycles deleted their monthly
 * statements and inserted the folded ones. `settlement_lines.statement_id`
 * cascades on delete, so sixty-four per-order records went with them — the
 * entire line-level history of Sentinel Cyber, Aegis Assurance, Halo Audio,
 * Beacon Reseller and Vertex Endpoint.
 *
 * Every assertion in that migration passed. All of them were about totals, and
 * the totals were right: a statement with no lines still adds up. The check
 * that would have caught it — "a statement that had lines still has them" — is
 * now in that migration, so a replay from scratch both preserves them and
 * proves it did.
 *
 * This repairs the live database, where the rows are already gone.
 *
 * WHAT IS REBUILT, AND HOW HONESTLY.
 *
 * The original lines were a sample: two or three per month, each standing for a
 * month of orders against one product, with the quantity carrying the volume.
 * That shape is reconstructible because the statement holds the totals, the
 * partner holds the products, and the commission rate is on the statement.
 * What is NOT reconstructible is which order each stood for, so the order
 * references are new. They are marked as such: `SL-R…` ids and an order
 * reference of the form `ORD-R…`, so nobody reads them as the originals.
 *
 * The distribution across months is the same rising curve the seed used, and
 * the last line in each period absorbs the rounding — the statement total is
 * the fact, and the lines have to sum to it exactly rather than to within a
 * cent.
 */

do $$
declare
  s record;
  prods text[];
  names text[];
  cats text[];
  n_months integer;
  m integer;
  weight numeric;
  total_weight numeric;
  line_gross numeric;
  line_comm numeric;
  line_fees numeric;
  line_ref numeric;
  running numeric;
  run_comm numeric;
  run_fees numeric;
  run_ref numeric;
  seq integer := 0;
  occurred date;
  pick integer;
  rate numeric;
begin
  for s in
    select st.*, p.name as pname
      from public.settlement_statements st
      join public.partners p on p.id = st.partner_id
     where not exists (select 1 from public.settlement_lines l where l.statement_id = st.id)
     order by st.partner_id, st.period_start
  loop
    select array_agg(id order by id), array_agg(name order by id), array_agg(category_id order by id)
      into prods, names, cats
      from public.products where partner_id = s.partner_id;

    if prods is null then
      raise notice 'no products for %, so nothing to rebuild against', s.partner_id;
      continue;
    end if;

    /* One line per month of the period, which is what the originals were. A
       quarterly statement gets three, a half-yearly six, a year twelve. */
    n_months := (extract(year from age(s.period_end + 1, s.period_start)) * 12
                 + extract(month from age(s.period_end + 1, s.period_start)))::integer;
    if n_months < 1 then n_months := 1; end if;

    /* Rising through the period, the way trade actually did — the monthly
       statements this was folded from grew month on month. */
    total_weight := 0;
    for m in 1..n_months loop total_weight := total_weight + (100 + m * 6); end loop;

    running := 0;
    run_comm := 0; run_fees := 0; run_ref := 0;
    rate := s.commission_rate;

    for m in 1..n_months loop
      weight := (100 + m * 6) / total_weight;
      occurred := (s.period_start + ((m || ' months')::interval) - interval '1 day')::date;
      if occurred > s.period_end then occurred := s.period_end; end if;

      /* The last month takes whatever is left, on every column. Distributing
         evenly and hoping is how a reconciliation ends up a cent out for
         reasons nobody can find — and `settlement_lines` enforces
         net = gross − commission − fees − refunds on insert, so the figures
         have to be right before the row exists rather than corrected after. */
      if m = n_months then
        line_gross := round(s.gross - running, 2);
        line_comm  := round(s.commission - run_comm, 2);
        line_fees  := round(s.fees - run_fees, 2);
        line_ref   := round(s.refunds - run_ref, 2);
      else
        line_gross := round(s.gross * weight, 2);
        line_comm  := round(s.commission * weight, 2);
        line_fees  := round(s.fees * weight, 2);
        line_ref   := round(s.refunds * weight, 2);
      end if;
      running  := running + line_gross;
      run_comm := run_comm + line_comm;
      run_fees := run_fees + line_fees;
      run_ref  := run_ref + line_ref;

      pick := 1 + ((m - 1) % array_length(prods, 1));
      seq := seq + 1;

      insert into public.settlement_lines
        (id, statement_id, partner_id, order_ref, product_id, product_name, category_id,
         quantity, gross, tax, commission_rate, commission, fees, refunds, net,
         occurred_on, sort_order)
      values (
        format('SL-R%s', lpad(seq::text, 5, '0')),
        s.id, s.partner_id,
        format('ORD-R%s', lpad(seq::text, 6, '0')),
        prods[pick], names[pick], cats[pick],
        /* A month of orders, not one. The originals carried the volume in the
           quantity and the value in the gross, and so do these. */
        greatest(1, round(line_gross / 40)::integer),
        line_gross,
        round(line_gross * 0.1525, 2),
        rate,
        line_comm, line_fees, line_ref,
        line_gross - line_comm - line_fees - line_ref,
        occurred, m);
    end loop;
  end loop;
end $$;

/* ---- Assertions --------------------------------------------------------------- */

do $$
declare bad text; n int;
begin
  /* Nothing on the shelf has a settlement nobody can query. */
  select string_agg(s.id, ', ') into bad
    from public.settlement_statements s
   where not exists (select 1 from public.settlement_lines l where l.statement_id = s.id);
  if bad is not null then raise exception 'statements with no lines behind them: %', bad; end if;

  /* And every statement reconciles to its lines, on all four columns. Gross
     alone would pass a rebuild that got the commission split wrong, and the
     commission is the number a seller checks. */
  select string_agg(x.id || ' (' || x.what || ')', ', ') into bad from (
    select s.id, 'gross' what from public.settlement_statements s
      join public.settlement_lines l on l.statement_id = s.id
     group by s.id, s.gross having abs(s.gross - sum(l.gross)) > 0.01
    union all
    select s.id, 'commission' from public.settlement_statements s
      join public.settlement_lines l on l.statement_id = s.id
     group by s.id, s.commission having abs(s.commission - sum(l.commission)) > 0.01
    union all
    select s.id, 'fees' from public.settlement_statements s
      join public.settlement_lines l on l.statement_id = s.id
     group by s.id, s.fees having abs(s.fees - sum(l.fees)) > 0.01
    union all
    select s.id, 'refunds' from public.settlement_statements s
      join public.settlement_lines l on l.statement_id = s.id
     group by s.id, s.refunds having abs(s.refunds - sum(l.refunds)) > 0.01
  ) x;
  if bad is not null then raise exception 'statements that do not reconcile to their lines: %', bad; end if;

  /* Every line's own arithmetic holds — the check constraint says so, but a
     rebuild that set `net` before adjusting the columns would have tripped it
     rather than passed silently, and this proves the order was right. */
  select count(*) into n from public.settlement_lines
   where abs(net - (gross - commission - fees - refunds)) > 0.001;
  if n > 0 then raise exception '% rebuilt lines do not add up', n; end if;

  /* The rebuilt ones are marked as rebuilt. Somebody reconciling against the
     order book must not find `ORD-R000001` and go looking for it. */
  select count(*) into n from public.settlement_lines
   where id like 'SL-R%' and order_ref not like 'ORD-R%';
  if n > 0 then raise exception '% rebuilt lines are wearing a real order reference', n; end if;

  /* Every line falls inside the period of the statement it belongs to. */
  select count(*) into n from public.settlement_lines l
    join public.settlement_statements s on s.id = l.statement_id
   where l.occurred_on < s.period_start or l.occurred_on > s.period_end;
  if n > 0 then raise exception '% lines fall outside their own settlement period', n; end if;

  raise notice 'lines: % (% rebuilt) across % statements',
    (select count(*) from public.settlement_lines),
    (select count(*) from public.settlement_lines where id like 'SL-R%'),
    (select count(distinct statement_id) from public.settlement_lines);
end $$;
