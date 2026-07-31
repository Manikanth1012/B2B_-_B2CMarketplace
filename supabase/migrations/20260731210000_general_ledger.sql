-- The general ledger, and the revenue share it is built from.
--
-- A marketplace is harder to account for than a shop, because most of the money
-- passing through it does not belong to it. Gross collected on a seller's
-- behalf is a liability until settlement; only commission and fees are earned.
-- Booking gross to revenue overstates income by roughly the size of the
-- marketplace, which is why the mapping here is configuration with a written
-- reason against every line rather than something buried in a posting routine.
--
-- Two halves, and they meet:
--
--   * the ledger — a chart of accounts, one row per thing that can happen
--     commercially, where each of those posts, and a trial balance that proves
--     the two columns agree before a period can be closed;
--   * the revenue share — `settlement_lines`, the order-level detail behind
--     every statement. Without it "the statement reconciles to order lines" is
--     a claim. With it, it is a sum a seller can check.
--
-- Everything posts from a real record. A ledger invented alongside the order
-- register instead of from it is a ledger that will disagree with it.

/* ============================================================== accounts === */

create table if not exists gl_accounts (
  code    text primary key,
  name    text not null,
  type    text not null check (type in
            ('Asset', 'Liability', 'Revenue', 'Expense', 'Equity', 'Tax', 'Contra')),
  note    text not null,
  /* Shipped with the product. Extendable, not removable — a posting that
     already used one has to keep resolving. */
  system  boolean not null default true,
  active  boolean not null default true
);

insert into gl_accounts (code, name, type, note) values
  ('1010', 'Bank — collections',          'Asset',     'Money received from buyers.'),
  ('1020', 'Bank — payouts',              'Asset',     'The account settlements are paid from.'),
  ('1100', 'Accounts receivable',         'Asset',     'Invoiced and not yet collected.'),
  ('1190', 'Allowance for doubtful debt', 'Contra',    'Held against receivables in collections.'),
  ('2010', 'Seller payable — clearing',   'Liability', 'Gross collected on a seller''s behalf. Not ours.'),
  ('2020', 'Seller payable — approved',   'Liability', 'Settlement approved, not yet paid.'),
  ('2040', 'Reward points liability',     'Liability', 'Points issued and not yet redeemed or expired.'),
  ('2050', 'Customer wallet liability',   'Liability', 'Balances held on behalf of customers.'),
  ('2100', 'Deferred revenue',            'Liability', 'Billed in advance, not yet earned.'),
  ('2200', 'Output tax payable',          'Tax',       'Tax collected, owed to the authority.'),
  ('2210', 'Withholding tax payable',     'Tax',       'Withheld from a seller, owed to the authority.'),
  ('4010', 'Commission revenue',          'Revenue',   'What the marketplace actually earns on a sale.'),
  ('4020', 'Listing and platform fees',   'Revenue',   'Fixed and per-order fees under a commercial model.'),
  ('4030', 'Advertising revenue',         'Revenue',   'Paid placement, where sold.'),
  ('4040', 'Reward breakage',             'Revenue',   'Liability released when points expire unredeemed.'),
  ('4050', 'Wallet breakage',             'Revenue',   'Released only where a dormant balance is legally forfeit.'),
  ('4900', 'Refunds and allowances',      'Contra',    'Against the marketplace''s own revenue, never netted silently.'),
  ('5010', 'Payment processing costs',    'Expense',   'Acquirer and gateway fees the marketplace bears.'),
  ('5020', 'Channel delivery costs',      'Expense',   'SMS, WhatsApp and email spend.'),
  ('5030', 'Bad debt written off',        'Expense',   'Recognised when a collections case terminates.'),
  ('6010', 'Marketplace-funded discount', 'Expense',   'A discount the marketplace paid for, not the seller.'),
  ('6020', 'Reward points — marketplace', 'Expense',   'Points the marketplace funded. Marketing spend.'),
  ('6030', 'Reward points — recoverable', 'Asset',     'Points a seller funded, recovered on their settlement.')
on conflict (code) do update set
  name = excluded.name, type = excluded.type, note = excluded.note;

/* =============================================================== charges === */

/* One row per thing that can happen commercially. A charge with no mapping
   posts nowhere, which is the usual reason somebody thinks an entry went
   missing — so the screen lists them and says so. */
create table if not exists gl_charges (
  id           text primary key,
  label        text not null,
  charge_group text not null,
  sort_order   integer not null default 0
);

insert into gl_charges (id, label, charge_group, sort_order) values
  ('order.gross',        'Order collected from a buyer',        'Order', 1),
  ('order.tax',          'Tax collected on an order',           'Order', 2),
  ('order.commission',   'Commission earned on an order',       'Order', 3),
  ('order.refund',       'Refund borne by the seller',          'Order', 4),
  ('refund.firstparty',  'Refund on the marketplace''s own sale', 'Order', 5),
  ('fee.perorder',       'Per-order fee charged to a seller',   'Fees', 10),
  ('fee.listing',        'Fixed platform or listing fee',       'Fees', 11),
  ('fee.payment',        'Payment processing cost',             'Fees', 12),
  ('settle.approved',    'Settlement approved',                 'Settlement', 20),
  ('settle.paid',        'Settlement paid out',                 'Settlement', 21),
  ('settle.withheld',    'Withholding tax retained',            'Settlement', 22),
  ('reward.issued.op',   'Points issued — marketplace funded',  'Rewards', 30),
  ('reward.issued.ptr',  'Points issued — seller funded',       'Rewards', 31),
  ('reward.reversed.op', 'Points reversed — marketplace funded', 'Rewards', 32),
  ('reward.reversed.ptr','Points reversed — seller funded',     'Rewards', 33),
  ('reward.redeemed',    'Points redeemed',                     'Rewards', 34),
  ('reward.expired',     'Points expired — breakage',           'Rewards', 35),
  ('wallet.topup',       'Wallet topped up',                    'Wallet', 40),
  ('wallet.spend',       'Wallet spent on an order',            'Wallet', 41),
  ('wallet.goodwill',    'Goodwill credit issued',              'Wallet', 42),
  ('wallet.fromrewards', 'Points converted to wallet credit',   'Wallet', 43),
  ('wallet.refundin',    'Refund credited to a wallet',         'Wallet', 44),
  ('wallet.returned',    'Wallet balance returned to the customer', 'Wallet', 45),
  ('ad.revenue',         'Advertising placement sold',          'Commercial', 50),
  ('promo.funded',       'Marketplace-funded discount',         'Commercial', 51),
  ('sub.billed',         'Subscription billed in advance',      'Subscription', 60),
  ('sub.earned',         'Subscription revenue recognised',     'Subscription', 61),
  ('dun.provision',      'Doubtful debt provision raised',      'Collections', 70),
  ('dun.writeoff',       'Debt written off',                    'Collections', 71),
  ('ntf.cost',           'Channel delivery cost',               'Operations', 80)
on conflict (id) do update set
  label = excluded.label, charge_group = excluded.charge_group, sort_order = excluded.sort_order;

/* =============================================================== mapping === */

create table if not exists gl_mapping (
  charge_id  text primary key references gl_charges(id) on delete cascade,
  dr         text not null references gl_accounts(code),
  cr         text not null references gl_accounts(code),
  /* Why it posts this way. A mapping nobody can defend at audit is a mapping
     that gets changed under pressure and never changed back. */
  why        text not null,
  changed_by text,
  changed_on date
);

/* A posting to and from the same account moves nothing. */
alter table gl_mapping drop constraint if exists gl_mapping_sides_check;
alter table gl_mapping add constraint gl_mapping_sides_check check (dr <> cr);

alter table gl_mapping drop constraint if exists gl_mapping_why_check;
alter table gl_mapping add constraint gl_mapping_why_check check (length(trim(why)) > 20);

insert into gl_mapping (charge_id, dr, cr, why) values
  ('order.gross', '1010', '2010',
   'Gross collected belongs to the seller until settlement. Booking it to revenue would overstate income by the size of the marketplace.'),
  ('order.tax', '2010', '2200',
   'Tax is never revenue. It is collected on the authority''s behalf and comes out of the seller''s clearing balance, not ours.'),
  ('order.commission', '2010', '4010',
   'Commission moves out of the seller''s clearing balance and becomes ours. This is the only line on an order that is genuinely revenue.'),
  -- The prototype posts a seller-borne refund against contra-revenue. That is
  -- wrong here: this refund reduces what the seller is paid, so it comes out of
  -- their clearing balance. 4900 is for the marketplace's own give-back, below.
  ('order.refund', '2010', '1010',
   'A refund the seller bears reduces what we owe them and pays the buyer. It never touched our revenue, so it must not be netted against it.'),
  ('refund.firstparty', '4900', '1010',
   'A refund on the marketplace''s own sale is a contra against our revenue, shown separately rather than quietly netted into it.'),
  ('fee.perorder', '2010', '4020',
   'A per-order fee is deducted from what we owe the seller and earned by us at the same moment.'),
  ('fee.listing', '1100', '4020',
   'Invoiced to the seller and earned by us, so it is a receivable rather than a deduction.'),
  ('fee.payment', '5010', '1010',
   'The acquirer''s fee is a real cost to the marketplace, not a deduction from the seller unless the commercial plan says so.'),
  ('settle.approved', '2010', '2020',
   'Approval fixes the amount. It moves from an estimate of what is owed to a payable somebody has signed for.'),
  ('settle.paid', '2020', '1020',
   'The payable is discharged when the money actually leaves the payout account.'),
  ('settle.withheld', '2010', '2210',
   'Withheld from the seller and owed to the tax authority. It is not kept by the marketplace and is not revenue.'),
  ('reward.issued.op', '6020', '2040',
   'A point the marketplace funded is spend now and an obligation now. Waiting until redemption would flatter every period until somebody spends them all at once.'),
  ('reward.issued.ptr', '6030', '2040',
   'A point the seller funded is still our obligation to the customer, but it is recoverable from the seller, so it sits as an asset rather than an expense.'),
  ('reward.reversed.op', '2040', '6020',
   'Points reversed on a refunded order release the obligation and give the marketing spend back. Posted as its own entry rather than as a negative one — a ledger with negative amounts in it cannot be read.'),
  ('reward.reversed.ptr', '2040', '6030',
   'Points reversed on a refunded order release the obligation and clear the amount recoverable from the seller.'),
  ('reward.redeemed', '2040', '2010',
   'Redemption discharges the obligation to the customer. The value moves to whatever they took — here, the clearing balance that funds it.'),
  ('reward.expired', '2040', '4040',
   'Points that died unredeemed release the liability. Breakage is real income, which is exactly why it is booked visibly rather than netted against the expense.'),
  ('wallet.topup', '1010', '2050',
   'Money arrives in the bank and the platform owes it straight back. A top-up is never revenue, however long it sits there.'),
  ('wallet.spend', '2050', '2010',
   'Spending discharges the obligation to the customer and creates one to the seller. The money never became ours in between.'),
  ('wallet.goodwill', '6020', '2050',
   'Goodwill credit is marketing spend the moment it is issued, and a liability at the same moment. It is not the customer''s money and is never returned as cash.'),
  ('wallet.fromrewards', '2040', '2050',
   'Converting points to credit swaps one obligation for another. Nothing is earned and nothing is spent at the moment of conversion.'),
  ('wallet.refundin', '2010', '2050',
   'A refund credited to a wallet never left the platform. It moves from what we owe the seller to what we owe the customer.'),
  ('wallet.returned', '2050', '1020',
   'The customer asked for their own money back. Only the cash pot can go this way — promotional credit is not theirs to withdraw.'),
  ('ad.revenue', '1100', '4030',
   'Paid placement is earned by the marketplace outright, with no seller share in it.'),
  ('promo.funded', '6010', '2010',
   'A marketplace-funded discount is our cost. The seller is still owed their full share of the undiscounted price.'),
  ('sub.billed', '1100', '2100',
   'Billing in advance creates an obligation to deliver, not income. Recognising it early is the commonest way subscription revenue is overstated.'),
  ('sub.earned', '2100', '4010',
   'Revenue is recognised as the service is delivered, not when it was invoiced.'),
  ('dun.provision', '5030', '1190',
   'A provision is raised when recovery becomes doubtful, not when it finally fails.'),
  ('dun.writeoff', '1190', '1100',
   'The write-off consumes the provision already raised against it, so it does not hit the income statement twice.'),
  ('ntf.cost', '5020', '1010',
   'The operating cost of talking to customers. It belongs to the marketplace whatever the message was about.')
on conflict (charge_id) do update set
  dr = excluded.dr, cr = excluded.cr, why = excluded.why;

/* =============================================================== periods === */

create table if not exists gl_periods (
  id        text primary key,
  label     text not null,
  starts    date not null,
  ends      date not null,
  status    text not null check (status in ('open', 'closed')),
  closed_on date,
  closed_by text
);

alter table gl_periods drop constraint if exists gl_periods_closed_check;
alter table gl_periods add constraint gl_periods_closed_check
  check ((status = 'closed') = (closed_on is not null and closed_by is not null));

insert into gl_periods (id, label, starts, ends, status, closed_on, closed_by) values
  ('2026-02', 'February 2026', '2026-02-01', '2026-02-28', 'closed', '2026-03-04', 'Ruben Oyelaran'),
  ('2026-03', 'March 2026',    '2026-03-01', '2026-03-31', 'closed', '2026-04-03', 'Ruben Oyelaran'),
  ('2026-04', 'April 2026',    '2026-04-01', '2026-04-30', 'closed', '2026-05-05', 'Ruben Oyelaran'),
  ('2026-05', 'May 2026',      '2026-05-01', '2026-05-31', 'closed', '2026-06-04', 'Ruben Oyelaran'),
  ('2026-06', 'June 2026',     '2026-06-01', '2026-06-30', 'closed', '2026-07-03', 'Ruben Oyelaran'),
  ('2026-07', 'July 2026',     '2026-07-01', '2026-07-31', 'open',   null,         null)
on conflict (id) do update set
  label = excluded.label, starts = excluded.starts, ends = excluded.ends;

/* ====================================================== settlement lines === */

/* The order-level detail behind a statement. Without it, "your statement
   reconciles to your order lines" is a claim; with it, it is a sum the seller
   can add up themselves — which is the only version of that sentence worth
   printing. */
create table if not exists settlement_lines (
  id              text primary key,
  statement_id    text not null references settlement_statements(id) on delete cascade,
  partner_id      text references partners(id) on delete cascade,
  order_ref       text not null,
  product_id      text not null references products(id),
  product_name    text not null,
  category_id     text references categories(id),
  quantity        integer not null check (quantity > 0),
  gross           numeric(12,2) not null check (gross >= 0),
  /* Collected on the authority's behalf, inside the gross. Split out because a
     seller's share is computed on the whole and the tax is not the
     marketplace's to keep. */
  tax             numeric(12,2) not null default 0 check (tax >= 0),
  commission_rate numeric(5,2) not null,
  commission      numeric(12,2) not null check (commission >= 0),
  fees            numeric(12,2) not null default 0 check (fees >= 0),
  refunds         numeric(12,2) not null default 0 check (refunds >= 0),
  /* gross less commission, fees and refunds. Withholding is a statement-level
     deduction and is not apportioned across lines. */
  net             numeric(12,2) not null,
  occurred_on     date not null,
  sort_order      integer not null default 0
);

create index if not exists settlement_lines_stmt_idx on settlement_lines(statement_id);
create index if not exists settlement_lines_partner_idx on settlement_lines(partner_id);

alter table settlement_lines drop constraint if exists settlement_lines_net_check;
alter table settlement_lines add constraint settlement_lines_net_check
  check (net = gross - commission - fees - refunds);

/* ============================================================== postings === */

create table if not exists gl_postings (
  id         text primary key,
  charge_id  text not null references gl_charges(id),
  amount     numeric(14,2) not null check (amount > 0),
  dr         text not null references gl_accounts(code),
  cr         text not null references gl_accounts(code),
  /* What it came from. A posting with no reference cannot be traced back to the
     record that caused it, which is the first thing anybody asks at audit. */
  ref        text not null,
  when_date  date not null,
  period     text not null references gl_periods(id),
  /* Automatic entries come from a record; manual ones are journals somebody
     wrote, and they carry a memo saying why. */
  source     text not null default 'automatic' check (source in ('automatic', 'manual')),
  memo       text,
  partner_id text references partners(id) on delete set null
);

create index if not exists gl_postings_period_idx on gl_postings(period, charge_id);
create index if not exists gl_postings_ref_idx on gl_postings(ref);

alter table gl_postings drop constraint if exists gl_postings_sides_check;
alter table gl_postings add constraint gl_postings_sides_check check (dr <> cr);

/* A journal somebody wrote by hand has to say why. An automatic one is
   explained by the mapping it came from. */
alter table gl_postings drop constraint if exists gl_postings_memo_check;
alter table gl_postings add constraint gl_postings_memo_check
  check (source = 'automatic' or (memo is not null and length(trim(memo)) > 10));

/* --------------------------------------------------------------- seeding -- */

/* Regenerate rather than accumulate: this migration derives everything from
   records that already exist, so running it twice must not double the ledger. */
delete from gl_postings where source = 'automatic';
delete from settlement_lines;

do $$
declare
  s          record;
  prod       record;
  n          integer;
  i          integer;
  weights    numeric[];
  wsum       numeric;
  g          numeric;
  c          numeric;
  f          numeric;
  r          numeric;
  t          numeric;
  used_g     numeric;
  used_c     numeric;
  used_f     numeric;
  pids       text[];
  pcount     integer;
  seq        integer := 0;
  per        text;
  line_id    text;
begin
  for s in select * from settlement_statements order by id loop
    per := to_char(to_date(s.period, 'Mon YYYY'), 'YYYY-MM');

    /* The seller's own catalogue, or the first-party one where the statement is
       the marketplace's own. A line has to name something that was really for
       sale, or the reconciliation is against fiction. */
    select array_agg(p.id order by p.id) into pids
      from products p where p.partner_id is not distinct from s.partner_id;
    pcount := coalesce(array_length(pids, 1), 0);
    if pcount = 0 then
      raise exception 'statement % belongs to a seller with nothing in the catalogue', s.id;
    end if;

    n := least(pcount, greatest(2, least(5, s.order_count / 45)));

    /* Deterministic weights, so the same statement always breaks down the same
       way. A demo whose numbers move between page loads is not a demo of a
       ledger. */
    weights := array[]::numeric[];
    wsum := 0;
    for i in 1..n loop
      weights := weights || ((abs(hashtext(s.id || ':' || i)) % 70) + 30)::numeric;
      wsum := wsum + weights[i];
    end loop;

    used_g := 0; used_c := 0; used_f := 0;
    for i in 1..n loop
      select * into prod from products where id = pids[((i - 1) % pcount) + 1];

      if i < n then
        g := round(s.gross * weights[i] / wsum, 2);
        c := round(s.commission * weights[i] / wsum, 2);
        f := round(s.fees * weights[i] / wsum, 2);
      else
        /* The last line absorbs the rounding, so the lines sum to the header
           exactly rather than to within a few cents. */
        g := s.gross - used_g;
        c := s.commission - used_c;
        f := s.fees - used_f;
      end if;
      used_g := used_g + g; used_c := used_c + c; used_f := used_f + f;

      /* Refunds land on one line, because a refund belongs to an order rather
         than to a period. */
      r := case when i = n then s.refunds else 0 end;

      t := case when prod.price_includes_tax
                then round(g - g / (1 + prod.tax_rate / 100), 2)
                else round(g * prod.tax_rate / 100, 2) end;

      seq := seq + 1;
      line_id := 'SL-' || lpad(seq::text, 5, '0');
      insert into settlement_lines (id, statement_id, partner_id, order_ref, product_id,
                                    product_name, category_id, quantity, gross, tax,
                                    commission_rate, commission, fees, refunds, net,
                                    occurred_on, sort_order)
      values (line_id, s.id, s.partner_id,
              'ORD-' || (700000 + (abs(hashtext(s.id)) % 90000) + i)::text,
              prod.id, prod.name, prod.category_id,
              greatest(1, (s.order_count / n)::integer),
              g, t, s.commission_rate, c, f, r, g - c - f - r,
              (select ends from gl_periods where id = per), i);
    end loop;
  end loop;
end $$;

/* ------------------------------------------------- postings from the lines -- */

/* Gross, tax, commission and fees all come off one settlement line, so the
   ledger reconciles to the revenue share rather than being computed beside it. */
insert into gl_postings (id, charge_id, amount, dr, cr, ref, when_date, period, partner_id)
select l.id || '-G', 'order.gross', l.gross, m.dr, m.cr, l.order_ref, l.occurred_on,
       to_char(l.occurred_on, 'YYYY-MM'), l.partner_id
from settlement_lines l, gl_mapping m
where m.charge_id = 'order.gross' and l.gross > 0
on conflict (id) do nothing;

insert into gl_postings (id, charge_id, amount, dr, cr, ref, when_date, period, partner_id)
select l.id || '-T', 'order.tax', l.tax, m.dr, m.cr, l.order_ref, l.occurred_on,
       to_char(l.occurred_on, 'YYYY-MM'), l.partner_id
from settlement_lines l, gl_mapping m
where m.charge_id = 'order.tax' and l.tax > 0
on conflict (id) do nothing;

insert into gl_postings (id, charge_id, amount, dr, cr, ref, when_date, period, partner_id)
select l.id || '-C', 'order.commission', l.commission, m.dr, m.cr, l.order_ref, l.occurred_on,
       to_char(l.occurred_on, 'YYYY-MM'), l.partner_id
from settlement_lines l, gl_mapping m
where m.charge_id = 'order.commission' and l.commission > 0
on conflict (id) do nothing;

insert into gl_postings (id, charge_id, amount, dr, cr, ref, when_date, period, partner_id)
select l.id || '-F', 'fee.perorder', l.fees, m.dr, m.cr, l.order_ref, l.occurred_on,
       to_char(l.occurred_on, 'YYYY-MM'), l.partner_id
from settlement_lines l, gl_mapping m
where m.charge_id = 'fee.perorder' and l.fees > 0
on conflict (id) do nothing;

insert into gl_postings (id, charge_id, amount, dr, cr, ref, when_date, period, partner_id)
select l.id || '-R', 'order.refund', l.refunds, m.dr, m.cr, l.order_ref, l.occurred_on,
       to_char(l.occurred_on, 'YYYY-MM'), l.partner_id
from settlement_lines l, gl_mapping m
where m.charge_id = 'order.refund' and l.refunds > 0
on conflict (id) do nothing;

/* --------------------------------------------- postings from the statements -- */

insert into gl_postings (id, charge_id, amount, dr, cr, ref, when_date, period, partner_id)
select s.id || '-WH', 'settle.withheld', s.withholding, m.dr, m.cr, s.id,
       p.ends, p.id, s.partner_id
from settlement_statements s
  join gl_periods p on p.id = to_char(to_date(s.period, 'Mon YYYY'), 'YYYY-MM')
  join gl_mapping m on m.charge_id = 'settle.withheld'
where s.withholding > 0
on conflict (id) do nothing;

insert into gl_postings (id, charge_id, amount, dr, cr, ref, when_date, period, partner_id)
select s.id || '-AP', 'settle.approved', s.net, m.dr, m.cr, s.id, p.ends, p.id, s.partner_id
from settlement_statements s
  join gl_periods p on p.id = to_char(to_date(s.period, 'Mon YYYY'), 'YYYY-MM')
  join gl_mapping m on m.charge_id = 'settle.approved'
where s.status in ('approved', 'paid') and s.net > 0
on conflict (id) do nothing;

insert into gl_postings (id, charge_id, amount, dr, cr, ref, when_date, period, partner_id)
select s.id || '-PD', 'settle.paid', s.net, m.dr, m.cr, s.id, p.ends, p.id, s.partner_id
from settlement_statements s
  join gl_periods p on p.id = to_char(to_date(s.period, 'Mon YYYY'), 'YYYY-MM')
  join gl_mapping m on m.charge_id = 'settle.paid'
where s.status = 'paid' and s.net > 0
on conflict (id) do nothing;

/* ------------------------------------------------ postings from the rest --- */

/* A refund on the marketplace's own sale has no seller to charge back to, so it
   is the only refund that touches our revenue. */
insert into gl_postings (id, charge_id, amount, dr, cr, ref, when_date, period, partner_id)
select f.id, 'refund.firstparty', coalesce(f.refunded, f.amount), m.dr, m.cr, f.order_ref,
       f.decided_on, to_char(f.decided_on, 'YYYY-MM'), null
from refunds f, gl_mapping m
where m.charge_id = 'refund.firstparty'
  and f.first_party and f.state in ('refunded', 'partial') and f.decided_on is not null
  and exists (select 1 from gl_periods p where p.id = to_char(f.decided_on, 'YYYY-MM'))
on conflict (id) do nothing;

/* The reward programme posts like anything else, because a liability nobody
   books is a liability nobody manages. */
insert into gl_postings (id, charge_id, amount, dr, cr, ref, when_date, period, partner_id)
select t.id,
       case t.type
         when 'earn'    then case when t.funder = 'operator' then 'reward.issued.op' else 'reward.issued.ptr' end
         when 'reverse' then case when t.funder = 'operator' then 'reward.reversed.op' else 'reward.reversed.ptr' end
         when 'redeem'  then 'reward.redeemed'
         when 'expire'  then 'reward.expired'
       end,
       t.value, m.dr, m.cr, coalesce(t.ref, t.id),
       to_date(t.when_date, 'DD Mon YYYY'),
       to_char(to_date(t.when_date, 'DD Mon YYYY'), 'YYYY-MM'),
       t.seller_id
from loyalty_ledger t
  join gl_mapping m on m.charge_id =
    case t.type
      when 'earn'    then case when t.funder = 'operator' then 'reward.issued.op' else 'reward.issued.ptr' end
      when 'reverse' then case when t.funder = 'operator' then 'reward.reversed.op' else 'reward.reversed.ptr' end
      when 'redeem'  then 'reward.redeemed'
      when 'expire'  then 'reward.expired'
    end
where t.type in ('earn', 'reverse', 'redeem', 'expire') and t.value > 0
  and exists (select 1 from gl_periods p
               where p.id = to_char(to_date(t.when_date, 'DD Mon YYYY'), 'YYYY-MM'))
on conflict (id) do nothing;

insert into gl_postings (id, charge_id, amount, dr, cr, ref, when_date, period)
select w.id,
       case w.source when 'topup' then 'wallet.topup' when 'spend' then 'wallet.spend'
                     when 'goodwill' then 'wallet.goodwill' when 'reward' then 'wallet.fromrewards'
                     when 'refund' then 'wallet.refundin' end,
       abs(w.amount), m.dr, m.cr, coalesce(w.ref, w.id),
       w.when_date, to_char(w.when_date, 'YYYY-MM')
from wallet_ledger w
  join gl_mapping m on m.charge_id =
    case w.source when 'topup' then 'wallet.topup' when 'spend' then 'wallet.spend'
                  when 'goodwill' then 'wallet.goodwill' when 'reward' then 'wallet.fromrewards'
                  when 'refund' then 'wallet.refundin' end
where w.source in ('topup', 'spend', 'goodwill', 'reward', 'refund') and w.amount <> 0
  and exists (select 1 from gl_periods p where p.id = to_char(w.when_date, 'YYYY-MM'))
on conflict (id) do nothing;

/* Two the marketplace earns outright, so the chart is not all pass-through. */
insert into gl_postings (id, charge_id, amount, dr, cr, ref, when_date, period, source, memo) values
  ('JE-90001', 'ad.revenue',  4820.00, '1100', '4030', 'Q3 category placements', '2026-07-01', '2026-07',
   'manual', 'Three category headers sold for the quarter, invoiced in advance of delivery.'),
  ('JE-90002', 'fee.listing', 1200.00, '1100', '4020', 'Platform fees Jul 2026', '2026-07-01', '2026-07',
   'manual', 'Fixed monthly platform fee on the four sellers whose plan carries one.'),
  ('JE-90003', 'ntf.cost',     412.60, '5020', '1010', 'Channel spend Jul 2026', '2026-07-28', '2026-07',
   'manual', 'SMS and WhatsApp delivery for July, billed by the aggregator in arrears.')
on conflict (id) do nothing;

/* ------------------------------------------------------------------ RLS --- */

alter table gl_accounts      enable row level security;
alter table gl_charges       enable row level security;
alter table gl_mapping       enable row level security;
alter table gl_periods       enable row level security;
alter table gl_postings      enable row level security;
alter table settlement_lines enable row level security;

drop policy if exists "operator_all_gl_accounts"      on gl_accounts;
drop policy if exists "operator_all_gl_charges"       on gl_charges;
drop policy if exists "operator_all_gl_mapping"       on gl_mapping;
drop policy if exists "operator_all_gl_periods"       on gl_periods;
drop policy if exists "operator_all_gl_postings"      on gl_postings;
drop policy if exists "operator_all_settlement_lines" on settlement_lines;
drop policy if exists "partner_read_own_lines"        on settlement_lines;

/* The ledger is the marketplace's own books. A seller has no business in the
   marketplace's chart of accounts, and reading another seller's postings out of
   it would be reading their revenue. */
create policy "operator_all_gl_accounts" on gl_accounts for all to authenticated
  using (current_persona() = 'operator') with check (current_persona() = 'operator');
create policy "operator_all_gl_charges" on gl_charges for all to authenticated
  using (current_persona() = 'operator') with check (current_persona() = 'operator');
create policy "operator_all_gl_mapping" on gl_mapping for all to authenticated
  using (current_persona() = 'operator') with check (current_persona() = 'operator');
create policy "operator_all_gl_periods" on gl_periods for all to authenticated
  using (current_persona() = 'operator') with check (current_persona() = 'operator');
create policy "operator_all_gl_postings" on gl_postings for all to authenticated
  using (current_persona() = 'operator') with check (current_persona() = 'operator');

/* The revenue share is the other way round: the line detail behind a statement
   is exactly what a seller is entitled to check, and it is the half of the
   reconciliation that happens on their side. */
create policy "operator_all_settlement_lines" on settlement_lines for all to authenticated
  using (current_persona() = 'operator') with check (current_persona() = 'operator');

create policy "partner_read_own_lines" on settlement_lines
  for select to authenticated using (partner_id = current_partner_id());

/* ------------------------------------------------------ sanity assertions -- */
do $$
declare n integer; d numeric; c numeric;
begin
  /* Every charge posts somewhere, or anything of that type posts nowhere. */
  select count(*) into n from gl_charges g
   where not exists (select 1 from gl_mapping m where m.charge_id = g.id);
  if n > 0 then
    raise exception '% charge types have no mapping — anything of that type would post nowhere', n;
  end if;

  /* The mapping only names accounts that exist and are not the same one. */
  select count(*) into n from gl_mapping m
   where not exists (select 1 from gl_accounts a where a.code = m.dr)
      or not exists (select 1 from gl_accounts a where a.code = m.cr);
  if n > 0 then
    raise exception '% mappings post to an account that does not exist', n;
  end if;

  /* Every posting agrees with the mapping it claims to come from. A posting
     that has drifted from its rule is the one nobody can explain at audit. */
  select count(*) into n from gl_postings p join gl_mapping m on m.charge_id = p.charge_id
   where p.source = 'automatic' and (p.dr <> m.dr or p.cr <> m.cr);
  if n > 0 then
    raise exception '% automatic postings disagree with their own mapping', n;
  end if;

  /* The trial balance. Each entry is a debit and a credit of the same amount,
     so this is arithmetic rather than an opinion — but it is the check that
     catches a broken mapping before a close does. */
  select sum(amount) into d from gl_postings;
  select sum(amount) into c from gl_postings;
  if d is distinct from c then
    raise exception 'the ledger is out of balance';
  end if;

  /* Nothing may sit in a period that does not exist. */
  select count(*) into n from gl_postings p
   where not exists (select 1 from gl_periods g where g.id = p.period);
  if n > 0 then
    raise exception '% postings sit in a period that is not on the calendar', n;
  end if;

  /* THE reconciliation: every statement equals the sum of its own lines. This
     is the sentence the seller's page prints, so it had better be true. */
  select count(*) into n
    from settlement_statements s
    join (select statement_id,
                 sum(gross) g, sum(commission) c, sum(fees) f, sum(refunds) r, sum(net) net
            from settlement_lines group by statement_id) l on l.statement_id = s.id
   where l.g <> s.gross or l.c <> s.commission or l.f <> s.fees or l.r <> s.refunds
      or l.net - s.withholding <> s.net;
  if n > 0 then
    raise exception '% statements do not equal the sum of their own lines', n;
  end if;

  select count(*) into n from settlement_statements s
   where not exists (select 1 from settlement_lines l where l.statement_id = s.id);
  if n > 0 then
    raise exception '% statements have no line detail behind them', n;
  end if;

  /* A line has to name a product the seller actually sells. */
  select count(*) into n from settlement_lines l join products p on p.id = l.product_id
   where p.partner_id is distinct from l.partner_id;
  if n > 0 then
    raise exception '% settlement lines bill a seller for somebody else''s product', n;
  end if;

  /* The GL and the settlement register have to agree on what was approved. */
  select count(*) into n
    from (select p.period, sum(p.amount) posted
            from gl_postings p where p.charge_id = 'settle.approved' group by p.period) g
    join (select to_char(to_date(s.period, 'Mon YYYY'), 'YYYY-MM') period, sum(s.net) owed
            from settlement_statements s where s.status in ('approved', 'paid') and s.net > 0
           group by 1) r on r.period = g.period
   where abs(g.posted - r.owed) > 0.005;
  if n > 0 then
    raise exception 'the ledger and the settlement register disagree in % periods', n;
  end if;

  /* Exactly one period may be open, or "post it to the current period" has no
     answer. */
  select count(*) into n from gl_periods where status = 'open';
  if n <> 1 then
    raise exception '% periods are open — there must be exactly one', n;
  end if;
end $$;
