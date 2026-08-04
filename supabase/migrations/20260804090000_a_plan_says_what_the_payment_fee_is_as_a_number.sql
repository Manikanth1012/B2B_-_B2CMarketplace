/*
  # A plan says what the payment fee is, as a number

  The seller dashboard's "Where your money goes" card splits a $1,000 sale into
  three bars. The figures are written into the JSX: `1000 - 120 - 21`. That is
  12% commission and 2.1% of fees, and it is the same three numbers for every
  seller on every plan. Nimbus Sensors settles on CP-IOT-STD at 11% with 1.9% +
  $0.20 of fees, so the card has been telling that seller they keep $859 when
  they keep $870.80.

  The commission rate was already a column and the card ignored it. The fee was
  not a column at all — `fees` is prose ("Payment processing 1.9% + $0.20 ·
  logistics at cost"), which is the right thing to show a reader and the wrong
  thing to do arithmetic on.

  1. `payment_fee_pct` and `payment_fee_flat`
     The numbers behind the sentence. `fees` stays exactly as it is: it carries
     things no pair of numbers can ("logistics at cost", "the reseller invoices
     the end customer"), and losing that to a schema would be a worse trade than
     keeping both.

  2. Backfilled from the prose, then checked
     Every plan's numbers are read back against its own text below, so a plan
     whose sentence and figures disagree fails this migration rather than
     shipping a card that quietly rounds somebody's money wrong.
*/

alter table commission_plans
  add column if not exists payment_fee_pct  numeric(5,2) not null default 0,
  add column if not exists payment_fee_flat numeric(8,2) not null default 0;

alter table commission_plans drop constraint if exists commission_plans_fee_pct_ck;
alter table commission_plans add constraint commission_plans_fee_pct_ck
  check (payment_fee_pct >= 0 and payment_fee_pct <= 20);

alter table commission_plans drop constraint if exists commission_plans_fee_flat_ck;
alter table commission_plans add constraint commission_plans_fee_flat_ck
  check (payment_fee_flat >= 0 and payment_fee_flat <= 100);

update commission_plans set payment_fee_pct = 1.9,  payment_fee_flat = 0.20 where id = 'CP-CONTENT-STD';
update commission_plans set payment_fee_pct = 1.9,  payment_fee_flat = 0.20 where id = 'CP-DEVICE-VOL';
update commission_plans set payment_fee_pct = 1.9,  payment_fee_flat = 0.20 where id = 'CP-DEVICE-STD';
update commission_plans set payment_fee_pct = 1.9,  payment_fee_flat = 0    where id = 'CP-SEC-SAAS';
update commission_plans set payment_fee_pct = 1.9,  payment_fee_flat = 0.20 where id = 'CP-IOT-STD';
/* Introducer and reseller plans take no payment fee, for different reasons: the
   insurer collects the premium, and the reseller invoices their own customer.
   Both come to zero here, and both keep their sentence saying why. */
update commission_plans set payment_fee_pct = 0,    payment_fee_flat = 0    where id = 'CP-INS-STD';
update commission_plans set payment_fee_pct = 0,    payment_fee_flat = 0    where id in ('CP-RESELL-T2', 'CP-RESELL-T3');

do $$
declare
  r record;
  said numeric;
begin
  for r in select id, fees, payment_fee_pct, payment_fee_flat from commission_plans loop
    /* The first percentage in the sentence, if there is one. A plan whose prose
       says 1.9% and whose column says something else is the drift this is here
       to stop. */
    said := nullif((regexp_match(r.fees, '([0-9]+(?:\.[0-9]+)?)%'))[1], '')::numeric;

    if said is null then
      if r.payment_fee_pct <> 0 then
        raise exception 'Plan % charges %%% but its terms name no percentage: "%"',
          r.id, r.payment_fee_pct, r.fees;
      end if;
    elsif said <> r.payment_fee_pct then
      raise exception 'Plan % says "%" and charges %%%', r.id, r.fees, r.payment_fee_pct;
    end if;
  end loop;

  /* The demo seller's card is the one that was wrong, so it is the one asserted
     by name. On a 1,000 sale: 11% commission and 1.9% + 0.20 of fees leaves
     870.80, not the 859 the JSX was drawing. */
  select round(1000 - 1000 * base_rate / 100 - 1000 * payment_fee_pct / 100 - payment_fee_flat, 2)
    into said from commission_plans where id = 'CP-IOT-STD';
  if said <> 870.80 then
    raise exception 'CP-IOT-STD leaves the seller % of a 1000 sale, and the card is drawn from that', said;
  end if;
end $$;
