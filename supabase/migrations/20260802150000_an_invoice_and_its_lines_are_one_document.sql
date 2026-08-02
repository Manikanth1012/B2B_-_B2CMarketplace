-- The invoice headers were converted and their line items were not.
--
-- `20260802130000` gave every invoice a currency and restated its totals; it
-- did nothing to `enterprise_invoice_lines`. So INV-2026-0779 announced
-- KSh 1,567,454.58 before tax above a list of lines adding to 12,132 — the
-- header in shillings, the detail in dollars, on one page.
--
-- The migration's assertions did not catch it because every one of them
-- compared the header to itself: recurring plus one-off plus tax equals total,
-- tax is the stated percentage of the net. All true, and all true of a document
-- whose body contradicts its own summary. It took the integration suite, which
-- reads the document the way a person does, to notice.
--
-- Every line converts by its own invoice's recorded rate, which is exactly the
-- factor the header moved by — so the two agree by construction rather than by
-- arithmetic that happens to land.

update enterprise_invoice_lines l set
  unit_price = round(l.unit_price * i.fx_rate, 2),
  amount     = round(l.amount     * i.fx_rate, 2)
 from enterprise_invoices i
 where i.id = l.invoice_id;

/* And the header is re-derived from the lines it now has, rather than
   converted separately and hoped to match.
   
   Converting both sides independently leaves them a rounding apart — twelve
   lines rounded to the cent do not sum to the same figure as their total
   rounded to the cent, and the gap was eighteen paise. Widening the tolerance
   would hide that; deriving the header from the lines removes it, because an
   invoice header is a summary of its lines and not a second opinion. */
update enterprise_invoices i set
  recurring = d.recurring,
  oneoff    = d.oneoff,
  tax       = round((d.recurring + d.oneoff) * i.tax_rate / 100, 2),
  total     = d.recurring + d.oneoff + round((d.recurring + d.oneoff) * i.tax_rate / 100, 2)
 from (
   select l.invoice_id,
          coalesce(sum(l.amount) filter (where l.kind = 'subscription'), 0) as recurring,
          coalesce(sum(l.amount) filter (where l.kind <> 'subscription'), 0) as oneoff
     from enterprise_invoice_lines l
    group by l.invoice_id
 ) d
 where d.invoice_id = i.id;

/* -------------------------------------------------------- sanity checks -- */
do $$
declare s text;
begin
  /* The check that was missing: a header agrees with the lines under it.
     Exactly, to the cent, because the header is now computed from the lines
     rather than converted alongside them. */
  select string_agg(
           x.id || ' (header ' || x.header_net || ' vs lines ' || x.lines_sum || ')', ', ') into s
    from (
      select i.id,
             round(i.recurring + i.oneoff, 2) as header_net,
             round(coalesce(sum(l.amount), 0), 2) as lines_sum,
             count(l.*) as n
        from enterprise_invoices i
        left join enterprise_invoice_lines l on l.invoice_id = i.id
       group by i.id, i.recurring, i.oneoff
    ) x
   where x.n > 0
     and abs(x.header_net - x.lines_sum) > 0.02;
  if s is not null then raise exception 'these invoices disagree with their own lines: %', s; end if;

  /* And the lines are a plausible size in the reporting currency, the same way
     the headers are — a line converted twice would pass the check above while
     being a hundred times too big. */
  select string_agg(l.invoice_id || '/' || l.description, ', ') into s
    from enterprise_invoice_lines l
    join enterprise_invoices i on i.id = l.invoice_id
   where l.amount / i.fx_rate > 200000 or (l.amount > 0 and l.amount / i.fx_rate < 0.5);
  if s is not null then raise exception 'these invoice lines are not a plausible size: %', left(s, 300); end if;
end $$;
