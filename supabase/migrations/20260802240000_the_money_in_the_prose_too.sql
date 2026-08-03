-- The money still written into stored prose.
--
-- Two places kept a currency in text where the reader's own was needed. Both
-- now sit beside figures that have been restated, so leaving them makes the
-- sentence disagree with the number next to it — worse than either being wrong
-- alone.
--
--   `loyalty_ledger.note`      "Redeemed for $15.00 of wallet credit", on a row
--                              whose Worth column says ₹1,500.
--   `loyalty_redeem_options.description`
--                              "100 points becomes $1.00 of wallet credit" — a
--                              claim that is true for one reader in four.
--
-- The ledger notes are rewritten in the member's own currency. How the figure
-- is arrived at depends on what it means:
--
--   a redemption   the note's amount *is* the row's worth, so it becomes the
--                  row's restated `value` exactly.
--   an earn with a stated multiplier
--                  the amount is the order that earned the points, so it is
--                  derived: spend = points / (earn_per_unit × multiplier). That
--                  keeps note, points and worth agreeing, which converting at a
--                  rate would not.
--   anything else  converted at the rate in force, because there is nothing to
--                  derive it from — a capped earn is not proportional to the
--                  order by definition.

do $$
declare
  r      record;
  mark   text;
  amount numeric;
  mult   numeric;
  fx     numeric;
  n      integer := 0;
begin
  for r in
    select l.id, l.type, l.points, l.value, l.note, m.currency,
           pr.earn_per_unit, c.symbol
      from loyalty_ledger l
      join loyalty_members m       on m.id = l.member
      join loyalty_point_rates pr  on pr.currency = m.currency
      join currencies c            on c.code = m.currency
     where l.note ~ '\$[0-9]'
  loop
    mark := case when r.symbol = r.currency then r.symbol || ' ' else r.symbol end;

    if r.type = 'redeem' then
      amount := r.value;
    else
      /* "at 1.5x Gold", "3x on a ... order" — the multiplier the points were
         earned at, when the note happens to name it. */
      mult := nullif(substring(r.note from '([0-9]+(?:\.[0-9]+)?)\s*[xX×]'), '')::numeric;
      if mult is not null and mult > 0 then
        amount := round(abs(r.points) / (r.earn_per_unit * mult));
      else
        select f.rate into fx from fx_rates f
         where f.base = 'USD' and f.quote = r.currency and f.as_of <= '2026-08-01'
         order by f.as_of desc limit 1;
        amount := round(
          coalesce(nullif(substring(r.note from '\$([0-9,]+(?:\.[0-9]+)?)'), '')::numeric, 0)
          * coalesce(fx, 1));
      end if;
    end if;

    update loyalty_ledger set
      note = regexp_replace(
        note, '\$[0-9,]+(?:\.[0-9]+)?',
        mark || to_char(amount, 'FM999,999,999,990'), 'g')
     where id = r.id;
    n := n + 1;
  end loop;

  raise notice 'restated % ledger notes', n;
end $$;

/* The option descriptions drop their leading money claim entirely — the screen
   assembles it from `min`, `value_per` and the reader's own rate, which is the
   only place all three are known. What is left is what the option *is*. */
update loyalty_redeem_options set description =
  initcap(substring(regexp_replace(description, '^[0-9,]+ points? (becomes|takes|adds) ', ''), 1, 1))
  || substring(regexp_replace(description, '^[0-9,]+ points? (becomes|takes|adds) ', ''), 2)
 where description ~ '^[0-9,]+ points?';

update loyalty_redeem_options set description = regexp_replace(description, '\$[0-9,]+(\.[0-9]+)?\s*', '', 'g')
 where description ~ '\$[0-9]';

do $$
declare s text;
begin
  select string_agg(id, ', ') into s from loyalty_ledger where note ~ '\$[0-9]';
  if s is not null then raise exception 'these movements still quote dollars: %', s; end if;

  select string_agg(id, ', ') into s from loyalty_redeem_options where description ~ '\$[0-9]';
  if s is not null then raise exception 'these redemption options still quote dollars: %', s; end if;

  /* A redemption's note must agree with its own Worth column, or the row
     argues with itself in front of the customer. */
  select string_agg(l.id, ', ') into s
    from loyalty_ledger l join loyalty_members m on m.id = l.member
   where l.type = 'redeem'
     and l.note ~ '[0-9]'
     and position(to_char(l.value, 'FM999,999,999,990') in l.note) = 0;
  if s is not null then raise exception 'these redemptions disagree with their own worth: %', s; end if;

  select string_agg(id, ', ') into s from loyalty_redeem_options where trim(description) = '';
  if s is not null then raise exception 'these options now describe nothing: %', s; end if;
end $$;
-- Two things the previous pass got wrong.
--
-- A multi-character mark needs a space: "KSh12,000" is not how anybody writes
-- it, and the rule already exists in `markFor` on the client — a mark longer
-- than one character takes a space, which is why "AED 1,200.00" reads and
-- "AED1,200.00" does not.
update loyalty_ledger set note = regexp_replace(note, '(KSh|AED)([0-9])', '\1 \2', 'g')
 where note ~ '(KSh|AED)[0-9]';

-- And the option descriptions were cut by regex, which left fragments: "of
-- wallet credit, spendable on anything." The money had to come out — it is a
-- different figure for every reader — but what remains has to be a sentence.
-- Written out rather than pattern-matched, because eight rows of editorial
-- text are cheaper to say than to derive.
update loyalty_redeem_options set description = v.description
  from (values
    ('RDM-01', 'Wallet credit, spendable on anything the marketplace sells.'),
    ('RDM-05', 'Taken straight off the basket at payment.'),
    ('RDM-06', 'Upgrades the shipping line on a marketplace order.'),
    ('RDM-02', 'Credited against the next invoice, at a 5% premium over the plain rate.'),
    ('RDM-08', 'Funds a month of connectivity for a student through Digital Access.'),
    ('RDM-03', 'A voucher against that seller''s listings, at a 20% premium — the seller funds it.'),
    ('RDM-04', 'Added to a trade-in valuation, at a 30% premium — the seller funds it.'),
    ('RDM-07', 'A lounge pass, at a 10% premium.')
  ) as v(id, description)
 where loyalty_redeem_options.id = v.id;

do $$
declare s text;
begin
  select string_agg(id, ', ') into s from loyalty_redeem_options
   where description ~ '\$[0-9]' or description !~ '^[A-Z]' or description !~ '\.$';
  if s is not null then raise exception 'these descriptions are not sentences: %', s; end if;

  select string_agg(id, ', ') into s from loyalty_ledger where note ~ '(KSh|AED)[0-9]';
  if s is not null then raise exception 'these notes run the mark into the figure: %', s; end if;

  /* Nothing anywhere in the rewards data still quotes a currency the reader
     may not be in. */
  select string_agg(id, ', ') into s from loyalty_ledger where note ~ '\$[0-9]';
  if s is not null then raise exception 'these movements still quote dollars: %', s; end if;
end $$;
