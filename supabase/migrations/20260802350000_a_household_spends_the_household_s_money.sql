-- A household's spending caps are in the household's money.
--
-- `consumer_household` gives Vikram a cap of 40 and a spend of 22.99, and Aditi
-- 15 and 9.99. Priya's bills, her wallet, her orders, her refunds and her
-- reward balance are all in rupees; a forty-rupee monthly allowance is about
-- forty-six cents.
--
-- And `consumer_profile` has a wallet balance and no currency, so the screen
-- that draws it has nothing to format it with and writes a dollar sign. The
-- balance itself is already right — it mirrors WAL-4100, which
-- `20260802270000` restated to rupees — so the number is fine and only the mark
-- on it is wrong. That is the failure mode worth naming: a correct figure with
-- a false currency reads as a wrong figure, and neither the row nor the screen
-- can tell.
--
-- Caps are chosen; spend is measured. A monthly allowance is a round number
-- somebody picked — ₹3,500, not ₹3,496.80 — while what was actually spent is a
-- quantity that happened and converts at the dated rate. This is the same split
-- the rest of the marketplace uses, and it is why the two columns are treated
-- differently three lines apart.

/* ================================= a customer is in one currency === */

alter table consumer_profile add column if not exists currency text references currencies(code);

comment on column consumer_profile.currency is
  'The money this customer is billed and refunded in. Follows their bills; the household''s caps and their wallet are in it.';

update consumer_profile p set currency = coalesce(
    (select b.currency from consumer_bills b where b.user_id = p.user_id
      order by to_date(b.issued, 'DD Mon YYYY') desc limit 1),
    (select w.currency from wallets w where w.user_id = p.user_id limit 1),
    (select currency from markets where is_default));

alter table consumer_profile alter column currency set not null;

/* ============================================== caps and spend === */

do $$
declare
  p record;
  rate numeric;
  step numeric;
begin
  for p in select * from consumer_profile loop
    /* USD is the currency these figures were written in. A profile already in
       dollars needs no restating and must not be multiplied by one. */
    if p.currency = 'USD' then continue; end if;

    select f.rate into rate from fx_rates f
     where f.base = 'USD' and f.quote = p.currency
     order by f.as_of desc limit 1;
    if rate is null then
      raise exception 'no rate from USD to %, so % cannot be restated', p.currency, p.id;
    end if;

    /* What a round number looks like depends on how big the unit is. A rupee
       cap lands on ₹500; a dirham one on 5. Derived from the rate rather than
       written per currency, so a fourth market gets a sensible step without
       anybody remembering to add one. */
    step := case when rate >= 50 then 500 when rate >= 10 then 50 else 5 end;

    update consumer_household h set
      /* Chosen: pulled to the step, and a zero cap stays zero — "view only"
         means no spending, not a small allowance. */
      cap = case when h.cap is null or h.cap = 0 then h.cap
                 else greatest(round(h.cap * rate / step) * step, step) end,
      /* Measured: converted, and left where it lands. */
      spent = round(h.spent * rate, 2)
     where h.user_id = p.user_id;
  end loop;
end $$;

/* -------------------------------------------------------- sanity checks -- */
do $$
declare n integer; s text;
begin
  /* Nobody is over a cap they were under before. Converting the two columns
     with different rules is exactly the way that could happen, and "Vikram is
     now overspent" is a state the screen renders in red. */
  select string_agg(h.name || ' spent ' || h.spent || ' against a cap of ' || h.cap, '; ') into s
    from consumer_household h
   where h.cap is not null and h.cap > 0 and h.spent > h.cap;
  if s is not null then raise exception 'restating put these members over their cap: %', s; end if;

  /* A cap somebody chose, not one arrived at by multiplying. The step comes
     from the rate, the same way the restatement above derived it — written out
     twice it would be two rules that drift, and the assertion would then be
     checking a convention the data no longer follows. */
  select string_agg(h.name || ': ' || h.cap || ' ' || p.currency, '; ') into s
    from consumer_household h
    join consumer_profile p on p.user_id = h.user_id
    join lateral (
      select case when r.rate >= 50 then 500 when r.rate >= 10 then 50 else 5 end as step
        from fx_rates r where r.base = 'USD' and r.quote = p.currency
       order by r.as_of desc limit 1
    ) x on true
   where h.cap is not null and h.cap > 0 and h.cap <> round(h.cap / x.step) * x.step;
  if s is not null then raise exception 'these caps are not round numbers in their own currency: %', s; end if;

  /* The plausibility check: self-consistent assertions would all pass on a
     dollar figure wearing a rupee label. A rupee allowance worth having is
     three figures at least. */
  select string_agg(h.name || ': ' || h.cap, '; ') into s
    from consumer_household h join consumer_profile p on p.user_id = h.user_id
   where p.currency in ('INR', 'KES') and h.cap is not null and h.cap > 0 and h.cap < 100;
  if s is not null then raise exception 'these caps look like dollar figures wearing a rupee label: %', s; end if;

  /* The wallet on the profile and the wallet in `wallets` are the same money,
     and this is the first migration that can say so — before `currency` landed
     on the profile there was nothing to compare. */
  select string_agg(p.id || ': profile says ' || p.wallet || ' ' || p.currency
                    || ', wallet says ' || w.balance || ' ' || w.currency, '; ') into s
    from consumer_profile p join wallets w on w.user_id = p.user_id
   where p.currency <> w.currency or round(p.wallet, 2) <> round(w.balance, 2);
  if s is not null then raise exception 'the profile and the wallet disagree: %', s; end if;

  /* And it had rows to check. */
  select count(*) into n from consumer_household where cap is not null and cap > 0;
  if n = 0 then raise exception 'no capped household members were found, so this checked nothing'; end if;
end $$;
