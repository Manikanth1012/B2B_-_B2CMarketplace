/* Two things the marketplace does not operate.
 *
 * `channel_rule` already records the activities that are real, that a telco
 * does, and that this marketplace deliberately does not: a new line, a number
 * port, a fibre install. Each row says what it is, where it is done instead,
 * and why — so a reviewer asking "where is number portability" gets an answer
 * rather than a silence that reads as an oversight.
 *
 * Two more decisions belong there, both taken this week, both currently living
 * only in a conversation:
 *
 * RATING AND CHARGING. There is no real-time rating of prepaid or postpaid
 * usage here — no CDR feed, no rated event, no bundle depletion, no overage.
 * The marketplace sells the plan and pushes the order to Customer Order
 * Management; the telco's charging system meters and rates what happens next.
 * `products.fulfilment_route = 'telco-com'` already carries half of this — the
 * network provisions it — and this is the other half: the network also runs it.
 * Without the row, "no usage rating" reads as a gap in the build rather than a
 * boundary in the architecture.
 *
 * SUBSCRIPTION LIFECYCLE. There is no proration. A subscription runs from the
 * day it is bought to its renewal date, and a change mid-cycle is not
 * apportioned across it. The subscription itself is held by whoever operates
 * the service — the telco for connectivity, the ISV for their own software —
 * and what the marketplace keeps is the commercial record and the renewal date.
 * What it does do is tell somebody a renewal is coming, which is why the
 * notification rules exist and the proration arithmetic does not.
 *
 * Both are recorded as decisions with a date on them, because the difference
 * between "we decided not to" and "nobody got to it" is the whole value of
 * writing them down.
 */

/* `decision` was written when every row was about selling. These two are about
   operating, which is a different boundary and needs a word of its own — a
   marketplace that "does not sell" rating would be a strange thing to claim. */
alter table public.channel_rule drop constraint if exists channel_rule_decision_check;
alter table public.channel_rule add constraint channel_rule_decision_check
  check (decision in ('sold here', 'not sold here', 'not operated here'));

insert into public.channel_rule
  (id, what, label, decision, sold_through, reason, effective_from, agreed_by, sort_order) values

  ('CR-005', 'usage-rating',
   'Rating and charging of prepaid and postpaid usage',
   'not operated here',
   'Aventa charging system and BSS',
   'The marketplace sells the plan and hands the order to Customer Order Management. Metering, rating, bundle depletion and overage happen in the charging system that owns the subscriber, and a second meter in a storefront would be a second answer to what somebody owes.',
   date '2026-08-08', 'Marketplace product owner', 5),

  ('CR-006', 'subscription-proration',
   'Proration and mid-cycle apportionment',
   'not operated here',
   'The operator, partner or service provider that holds the subscription',
   'A subscription runs from the day it is bought to its renewal date; a change part-way through is not apportioned across it. The subscription is held wherever the service is run, and the marketplace keeps the commercial record, the renewal date and the reminder — not the arithmetic.',
   date '2026-08-08', 'Marketplace product owner', 6)
on conflict (id) do nothing;

do $$
declare n int;
begin
  /* Every decision names somewhere it is done instead, or it is not a boundary,
     it is a hole. */
  select count(*) into n from public.channel_rule
   where decision <> 'sold here' and coalesce(sold_through, '') = '';
  if n > 0 then raise exception '% withdrawn activities name nowhere else to go', n; end if;

  /* And the two new ones are about operating rather than selling, which is a
     distinction the column now has to carry. */
  select count(*) into n from public.channel_rule where decision = 'not operated here';
  if n <> 2 then raise exception 'expected two operating boundaries, found %', n; end if;

  raise notice 'channel rules: % (% not sold here, % not operated here)',
    (select count(*) from public.channel_rule),
    (select count(*) from public.channel_rule where decision = 'not sold here'),
    (select count(*) from public.channel_rule where decision = 'not operated here');
end $$;
