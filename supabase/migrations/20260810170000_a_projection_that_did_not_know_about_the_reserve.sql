/* The mid-period projection knew nothing about the reserve.
 *
 * `settlement_accruing` answers "what will I be paid if this period closed
 * today", and it answered it without the retention the run now takes — which
 * on the seller holding ten per cent is a figure wrong by ten per cent of their
 * gross, in the direction that flatters us.
 *
 * Three columns, and the third is the one a seller actually asks for: the rate,
 * what has already matured and is coming back on the next statement, and what
 * is held from them in total right now.
 *
 * The view is dropped rather than replaced because `create or replace view`
 * cannot change a view's column shape.
 */
drop view if exists public.settlement_accruing cascade;
create view public.settlement_accruing with (security_invoker = on) as
 SELECT t.partner_id,
    p.name AS partner_name,
    t.frequency,
    w.period_start,
    w.period_end,
    w.closed_on,
    (w.closed_on + ((t.pay_within_days || ' days'::text)::interval))::date AS due_on,
    t.hold_days,
    t.hold_reason,
    t.minimum_payout,
    t.payout_currency,
    COALESCE(sum(l.gross), 0::numeric) AS gross,
    COALESCE(sum(l.commission), 0::numeric) AS commission,
    COALESCE(sum(l.fees), 0::numeric) AS fees,
    COALESCE(sum(l.refunds), 0::numeric) AS refunds,
    COALESCE(sum(l.net), 0::numeric) AS net,
    count(l.id) AS lines,
    COALESCE(sum(l.net) FILTER (WHERE t.hold_days > 0 AND l.occurred_on > (w.closed_on - t.hold_days)), 0::numeric) AS held_back,
    COALESCE(( SELECT s.carried_out
           FROM settlement_statements s
          WHERE s.partner_id = t.partner_id AND s.period_end < w.period_start
          ORDER BY s.period_end DESC
         LIMIT 1), 0::numeric) AS carried_in,
    p.market,
    COALESCE(b.tax_residence, p.market) AS tax_residence,
    COALESCE(b.treaty_on_file, false) AS treaty_on_file,
    COALESCE(sec.reserve_pct, 0::numeric) AS reserve_pct,
    COALESCE(( SELECT sum(rt.amount)
           FROM partner_reserve_tranche rt
          WHERE rt.partner_id = t.partner_id AND rt.released_on IS NULL AND rt.matures_on <= w.closed_on), 0::numeric) AS reserve_matured,
    COALESCE(sec.reserve_held, 0::numeric) AS reserve_held
   FROM partner_settlement_terms t
     JOIN partners p ON p.id = t.partner_id
     LEFT JOIN partner_bank b ON b.partner_id = t.partner_id
     LEFT JOIN partner_security sec ON sec.partner_id = t.partner_id
     CROSS JOIN LATERAL settlement_window(t.frequency, t.align, t.starts_on, t.closes_on_day, CURRENT_DATE) w(period_start, period_end, closed_on)
     LEFT JOIN settlement_lines l ON l.partner_id = t.partner_id AND l.statement_id IS NULL AND l.occurred_on >= w.period_start AND l.occurred_on <= w.period_end
  WHERE p.status = 'live'::text
  GROUP BY t.partner_id, p.name, t.frequency, w.period_start, w.period_end, w.closed_on, t.pay_within_days, t.hold_days, t.hold_reason, t.minimum_payout, t.payout_currency, p.market, b.tax_residence, b.treaty_on_file, sec.reserve_pct, sec.reserve_held;
grant select on public.settlement_accruing to authenticated;

/* `partner_wholesale_accruing` is built on it and went with the drop. */
drop view if exists public.partner_wholesale_accruing;
create view public.partner_wholesale_accruing
with (security_invoker = on) as
select
  a.partner_id,
  a.period_start,
  a.period_end,
  a.closed_on,
  coalesce((select sum(coalesce(c.gross - c.recovered, w.gross))
              from public.wholesale_charges(a.partner_id, a.period_start, a.period_end) w
              left join public.partner_charge c
                on c.purchase_id = w.purchase_id and c.period_start = w.month_start), 0)
    as this_period,
  coalesce((select sum(c.gross - c.recovered) from public.partner_charge c
             where c.partner_id = a.partner_id and c.recovered < c.gross
               and c.period_end < a.period_start), 0) as brought_forward,
  (select count(*) from public.partner_purchase pu
    where pu.partner_id = a.partner_id and pu.state = 'active') as active_purchases
from public.settlement_accruing a;

grant select on public.partner_wholesale_accruing to authenticated;

do $$
declare r record;
begin
  select * into r from public.settlement_accruing where partner_id = 'PTR-1011';
  if r.reserve_pct is null or r.reserve_pct <> 10 then
    raise exception 'The accruing view does not carry the seller''s reserve rate: %.', r.reserve_pct;
  end if;
  perform 1 from public.partner_wholesale_accruing limit 1;
end $$;
