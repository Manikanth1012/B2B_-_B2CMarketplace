/* Every total the rows beneath it cannot produce.
 *
 * Otieno's account carried three of these and each was found by looking at a
 * screenshot: a wallet balance over an empty statement, five document rows over
 * an empty bucket, and a loyalty balance that had been typed rather than summed.
 * Finding them one screen at a time is not a method.
 *
 * `ledger_consistency` is the method. Every stored total in the schema that has
 * rows which ought to produce it, checked against those rows. An empty result is
 * the invariant, the same way `market_consistency` works.
 *
 * Most of it was already true. Orders agree with their own parts and with their
 * items; bills and enterprise invoices agree with theirs; settlement statements
 * agree with their lines; requisition lines are quantity times price; every
 * wallet agrees with its movements. Those become guarantees rather than
 * coincidences.
 *
 * What was not true: `loyalty_members.lifetime_earned` and `.lifetime_redeemed`.
 * Nine of eleven members held a figure the ledger cannot produce — Brightline
 * Foods claimed 186,400 points earned against a ledger whose most generous
 * reading is 103,450. The balances were all correct, which is why nobody
 * noticed: the number people act on was right and the two beside it, printed on
 * the same card, were decoration.
 *
 * The definitions this settles on:
 *
 *   lifetime_earned   — every point credited by an earn, a bonus or a positive
 *                       adjustment, less any reversal that took an earn back.
 *                       A refunded purchase did not, in the end, earn.
 *   lifetime_redeemed — every point spent on a redemption, less any redemption
 *                       that was reversed. A redemption that was undone was not,
 *                       in the end, a redemption.
 *
 * `reverse` mirrors whatever it undoes and takes its sign from that, which is
 * why both definitions net it out rather than treating it as one direction.
 *
 * One caveat, recorded rather than fixed: SmartBuild Ltd's ledger carries 37
 * reversals dated this week, every one of them written by the integration
 * suite. Recomputing from a polluted ledger gives a true answer to the wrong
 * question. The recompute is applied anyway, because a headline derived from
 * the rows is better than one derived from nothing — but the rows themselves
 * need the same clean-up as the duplicate subscriptions on Priya's account, and
 * that is somebody's decision rather than a migration's.
 */

begin;

/* ---- Reconcile the loyalty headlines to their ledgers -------------------- */

with sums as (
  select m.id,
         coalesce(sum(l.points) filter (
           where l.type in ('earn', 'bonus') or (l.type = 'adjust' and l.points > 0)), 0)
         + coalesce(sum(l.points) filter (where l.type = 'reverse' and l.points < 0), 0)
           as earned,
         abs(
           coalesce(sum(l.points) filter (where l.type = 'redeem'), 0)
           + coalesce(sum(l.points) filter (where l.type = 'reverse' and l.points > 0), 0)
         ) as redeemed
    from loyalty_members m
    left join loyalty_ledger l on l.member = m.id
   group by m.id
)
update loyalty_members m
   set lifetime_earned = s.earned,
       lifetime_redeemed = s.redeemed
  from sums s
 where s.id = m.id
   and (m.lifetime_earned <> s.earned or m.lifetime_redeemed <> s.redeemed);

/* ---- The sweep ----------------------------------------------------------- */

create or replace view ledger_consistency
with (security_invoker = on) as

  select 'wallet balance vs its movements' as finding, w.id as subject,
         'holds ' || w.cash || ' cash and ' || w.promo || ' credit; movements sum to '
         || coalesce(sum(l.amount) filter (where l.pot = 'cash'), 0) || ' and '
         || coalesce(sum(l.amount) filter (where l.pot = 'promo'), 0) as detail
    from wallets w left join wallet_ledger l on l.wallet_id = w.id
   group by w.id, w.cash, w.promo
  having w.cash  <> coalesce(sum(l.amount) filter (where l.pot = 'cash'), 0)
      or w.promo <> coalesce(sum(l.amount) filter (where l.pot = 'promo'), 0)

union all
  select 'loyalty balance vs its ledger', m.id,
         'holds ' || m.balance || ', ledger sums to ' || coalesce(sum(l.points), 0)
    from loyalty_members m left join loyalty_ledger l on l.member = m.id
   group by m.id, m.balance
  having m.balance <> coalesce(sum(l.points), 0)

union all
  select 'lifetime earned vs its ledger', m.id,
         'says ' || m.lifetime_earned || ', ledger gives '
         || (coalesce(sum(l.points) filter (
               where l.type in ('earn','bonus') or (l.type='adjust' and l.points>0)), 0)
             + coalesce(sum(l.points) filter (where l.type='reverse' and l.points<0), 0))
    from loyalty_members m left join loyalty_ledger l on l.member = m.id
   group by m.id, m.lifetime_earned
  having m.lifetime_earned <>
         coalesce(sum(l.points) filter (
           where l.type in ('earn','bonus') or (l.type='adjust' and l.points>0)), 0)
         + coalesce(sum(l.points) filter (where l.type='reverse' and l.points<0), 0)

union all
  select 'lifetime redeemed vs its ledger', m.id,
         'says ' || m.lifetime_redeemed || ', ledger gives '
         || abs(coalesce(sum(l.points) filter (where l.type='redeem'), 0)
                + coalesce(sum(l.points) filter (where l.type='reverse' and l.points>0), 0))
    from loyalty_members m left join loyalty_ledger l on l.member = m.id
   group by m.id, m.lifetime_redeemed
  having m.lifetime_redeemed <>
         abs(coalesce(sum(l.points) filter (where l.type='redeem'), 0)
             + coalesce(sum(l.points) filter (where l.type='reverse' and l.points>0), 0))

union all
  select 'order total vs its own parts', o.order_ref,
         'total ' || o.total || ', subtotal plus tax less discount '
         || (o.subtotal + o.tax - coalesce(o.discount, 0))
    from orders o
   where round(o.total, 2) <> round(o.subtotal + o.tax - coalesce(o.discount, 0), 2)

union all
  select 'order total vs the items on it', o.order_ref,
         'total ' || o.total || ', items sum to ' || coalesce(sum(i.price * i.quantity), 0)
    from orders o join order_items i on i.order_id = o.id
   group by o.order_ref, o.total
  having round(o.total, 2) <> round(coalesce(sum(i.price * i.quantity), 0), 2)

union all
  select 'bill total vs its own parts', b.id,
         'total ' || b.total || ', parts sum to '
         || (b.plan_charge + b.subscriptions + b.oneoff + b.tax)
    from consumer_bills b
   where round(b.total, 2) <> round(b.plan_charge + b.subscriptions + b.oneoff + b.tax, 2)

union all
  select 'enterprise invoice vs its own parts', i.id,
         'total ' || i.total || ', parts sum to ' || (i.recurring + i.oneoff + i.tax)
    from enterprise_invoices i
   where round(i.total, 2) <> round(i.recurring + i.oneoff + i.tax, 2)

union all
  select 'settlement gross vs its lines', s.id,
         'gross ' || s.gross || ', lines sum to ' || coalesce(sum(sl.gross), 0)
    from settlement_statements s join settlement_lines sl on sl.statement_id = s.id
   group by s.id, s.gross
  having round(s.gross, 2) <> round(coalesce(sum(sl.gross), 0), 2)

union all
  select 'settlement net vs its lines', s.id,
         'net ' || s.net || ', lines sum to ' || coalesce(sum(sl.net), 0)
    from settlement_statements s join settlement_lines sl on sl.statement_id = s.id
   group by s.id, s.net
  having round(s.net, 2) <> round(coalesce(sum(sl.net), 0), 2)

union all
  select 'requisition line vs quantity times price', l.id,
         'line total ' || l.line_total || ', quantity times unit price '
         || (l.quantity * l.unit_price)
    from enterprise_requisition_lines l
   where round(l.line_total, 2) <> round(l.quantity * l.unit_price, 2)

union all
  /* The profile prints a wallet figure of its own. Two places holding the same
     number is how they come to differ. */
  select 'profile wallet figure vs the wallet', c.customer_id,
         'profile says ' || c.wallet || ', the wallet holds ' || w.balance
    from consumer_profile c join wallets w on w.user_id = c.user_id
   where round(c.wallet, 2) <> round(w.balance, 2);

comment on view ledger_consistency is
  'Stored totals that the rows beneath them cannot produce. An empty result is '
  'the invariant. Reads with the caller''s own rights, so an operator sees the '
  'platform and nobody else sees anybody''s rows.';

grant select on ledger_consistency to authenticated;

/* ---- What this asserts --------------------------------------------------- */

do $$
declare
  n int;
  worst text;
begin
  select count(*) into n from ledger_consistency;
  if n <> 0 then
    select finding || ' — ' || subject || ' — ' || detail into worst from ledger_consistency limit 1;
    raise exception 'still % totals that do not add up, e.g. %', n, worst;
  end if;

  /* The definitions have to be exercised by the seed, or they are untested
     prose. Somebody must have had an earn reversed, and somebody must have had
     a redemption reversed — the two cases that make `reverse` ambiguous. */
  if not exists (select 1 from loyalty_ledger where type = 'reverse' and points < 0) then
    raise exception 'no reversal of an earn in the seed, so that half of the definition is untested';
  end if;
  if not exists (select 1 from loyalty_ledger where type = 'reverse' and points > 0) then
    raise exception 'no reversal of a redemption in the seed, so that half of the definition is untested';
  end if;

  /* And a member whose figures were wrong before this ran must now be right,
     rather than the whole table having been quietly emptied. */
  if (select lifetime_earned from loyalty_members where id = 'LM-4101') = 186400 then
    raise exception 'Brightline Foods still holds the figure its ledger cannot produce';
  end if;
  if (select count(*) from loyalty_members where lifetime_earned > 0) < 8 then
    raise exception 'the recompute has emptied the table rather than corrected it';
  end if;
end $$;

commit;
