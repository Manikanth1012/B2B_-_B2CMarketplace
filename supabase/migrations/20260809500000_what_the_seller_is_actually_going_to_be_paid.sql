/* The accrual card told a seller what they would be paid, and it was wrong twice.
 *
 * `settlement_accruing` is what a seller sees mid-period: sales so far, gross,
 * net, and what is inside the returns hold. The screen turned that into
 * "payable if it closed today" by subtracting the hold from the net.
 *
 * `run_settlements_core`, which is what actually happens when the period does
 * close, computes:
 *
 *     payable = net - withholding - held + carried_in
 *
 * Two of those four terms were missing from the projection. Tax deducted at
 * source is not a rounding difference — 194-O and s.52 CGST together take 1.1%
 * of gross off every Indian seller's payment, and the carry-in from a period
 * that fell under the minimum payout can be the whole of what makes this one
 * clear it. A seller reading the card was told a number nobody was going to
 * pay them.
 *
 * Withholding stays out of this view on purpose. It is computed from the rules
 * in force on the day the period closes, and `withholding.ts` exists precisely
 * so a screen can say what will be deducted before any run has happened — the
 * same rule, evaluated twice, reconciled by the integration suite. What the
 * view could not do without help is the carry-in, because that is a fact about
 * the PREVIOUS statement, and no amount of arithmetic over this period's lines
 * will recover it.
 */

/* Dropped rather than replaced: `create or replace view` refuses to add a
   column in the middle, and nothing else selects from this one. */
drop view if exists public.settlement_accruing;

create view public.settlement_accruing as
  select t.partner_id,
         p.name as partner_name,
         t.frequency,
         w.period_start,
         w.period_end,
         w.closed_on,
         (w.closed_on + ((t.pay_within_days || ' days')::interval))::date as due_on,
         t.hold_days,
         t.hold_reason,
         t.minimum_payout,
         t.payout_currency,
         coalesce(sum(l.gross), 0) as gross,
         coalesce(sum(l.commission), 0) as commission,
         coalesce(sum(l.fees), 0) as fees,
         coalesce(sum(l.refunds), 0) as refunds,
         coalesce(sum(l.net), 0) as net,
         count(l.id) as lines,
         coalesce(sum(l.net) filter (
           where t.hold_days > 0 and l.occurred_on > (w.closed_on - t.hold_days)), 0) as held_back,
         /* What the last closed period could not pay. Same lookup the run does:
            the most recent statement that ended before this period began, which
            is not necessarily the one immediately before it — a seller can go a
            period without trading. */
         coalesce((
           select s.carried_out
             from public.settlement_statements s
            where s.partner_id = t.partner_id
              and s.period_end < w.period_start
            order by s.period_end desc
            limit 1), 0) as carried_in,
         /* The two facts the withholding rules are applied against. Neither is
            money, and both are already readable by whoever can read this row —
            a seller reads their own bank record, the operator reads all of
            them — so carrying them here costs no visibility and saves the
            screen a second round trip it would have to keep in step. */
         p.market,
         coalesce(b.tax_residence, p.market) as tax_residence,
         coalesce(b.treaty_on_file, false) as treaty_on_file
    from public.partner_settlement_terms t
    join public.partners p on p.id = t.partner_id
    left join public.partner_bank b on b.partner_id = t.partner_id
    cross join lateral public.settlement_window(
      t.frequency, t.align, t.starts_on, t.closes_on_day, current_date)
      w(period_start, period_end, closed_on)
    left join public.settlement_lines l
      on l.partner_id = t.partner_id
     and l.statement_id is null
     and l.occurred_on >= w.period_start
     and l.occurred_on <= w.period_end
   where p.status = 'live'
   group by t.partner_id, p.name, t.frequency, w.period_start, w.period_end,
            w.closed_on, t.pay_within_days, t.hold_days, t.hold_reason,
            t.minimum_payout, t.payout_currency, p.market,
            b.tax_residence, b.treaty_on_file;

/* Without this the view runs as its owner and every seller reads every other
   seller's period. The same line has had to be added to every view in this
   schema; it is not a default anybody should rely on remembering. */
alter view public.settlement_accruing set (security_invoker = on);
grant select on public.settlement_accruing to authenticated;

/* ---- What has to be true -------------------------------------------------- */

do $$
declare n int; bad text;
begin
  /* The columns the screen now reads. A view that silently lost one of these
     would leave the projection wrong in exactly the way this migration is
     fixing, and nothing else would notice. */
  select count(*) into n
    from information_schema.columns
   where table_schema = 'public' and table_name = 'settlement_accruing'
     and column_name in ('carried_in', 'market', 'tax_residence', 'treaty_on_file');
  if n <> 4 then
    raise exception 'settlement_accruing is missing % of the four new columns', 4 - n;
  end if;

  /* Nobody is tax resident nowhere. The coalesce onto the partner's own market
     is what guarantees it, and a null here would send `rateFor` down the
     non-resident branch for a domestic seller — a 20% deduction instead of
     1.1%. */
  select string_agg(partner_id, ', ') into bad
    from public.settlement_accruing where tax_residence is null or market is null;
  if bad is not null then raise exception 'no market or residence for %', bad; end if;

  /* A carry-in is money the marketplace already owes. It cannot be negative:
     that would be a seller carrying a debt forward, which this model has no
     way to collect and no screen that says so. */
  select string_agg(format('%s carries %s', partner_id, carried_in), '; ') into bad
    from public.settlement_accruing where carried_in < 0;
  if bad is not null then raise exception 'negative carry-in: %', bad; end if;

  /* And it has to be the figure the run would pick up, not a different one.
     Computed here the way `run_settlements_core` computes it, against the same
     statements, so the two cannot drift apart unnoticed. */
  select string_agg(format('%s: view says %s, the run would take %s',
                           a.partner_id, a.carried_in, r.expected), '; ') into bad
    from public.settlement_accruing a
    join lateral (
      select coalesce((
        select s.carried_out from public.settlement_statements s
         where s.partner_id = a.partner_id and s.period_end < a.period_start
         order by s.period_end desc limit 1), 0) as expected) r on true
   where abs(a.carried_in - r.expected) > 0.005;
  if bad is not null then raise exception 'carry-in disagrees with the run: %', bad; end if;

  select count(*) into n
    from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
   where ns.nspname = 'public' and c.relname = 'settlement_accruing'
     and c.reloptions @> array['security_invoker=on'];
  if n <> 1 then
    raise exception 'settlement_accruing does not run as its reader, so every seller can read every other seller''s period';
  end if;
end $$;
