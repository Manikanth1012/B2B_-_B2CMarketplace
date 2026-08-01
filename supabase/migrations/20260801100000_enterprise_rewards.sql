-- Rewards for an organisation, which is not the same programme as a person's.
--
-- Three things are different once the member is a company, and the existing
-- programme got all three wrong for them:
--
--   the ladder   Tiers qualified at $600 / $1,800 / $4,500. An account spending
--                $78,000 a year is platinum on its first invoice, which makes
--                the tier meaningless. Organisations get their own ladder.
--   the rules    A company buys IoT connectivity, security subscriptions and
--                device fleets — not handsets and streaming. The accelerators
--                have to be written against the catalogue it actually buys
--                from, or the programme rewards nothing it does.
--   the spending Points earned on company spend are company money. One person
--                proposing and another releasing is the same control that
--                applies to a requisition, for the same reason.
--
-- And points are generated from the invoice lines rather than typed in, so a
-- purchase made tomorrow earns on exactly the rules that are live today.

/* ========================================================== the ladder === */

/* Two ladders in one table rather than two tables: the tier a member holds is
   still one column, and a screen that forgets to filter shows too many rows
   rather than the wrong multiplier. */
alter table loyalty_tiers add column if not exists kind text not null default 'consumer';

alter table loyalty_tiers drop constraint if exists loyalty_tiers_kind_check;
alter table loyalty_tiers add constraint loyalty_tiers_kind_check
  check (kind in ('consumer', 'enterprise'));

alter table loyalty_tiers drop constraint if exists loyalty_tiers_pkey cascade;
alter table loyalty_tiers add primary key (id);

insert into loyalty_tiers (id, name, sort_order, qualify_spend, multiplier, colour, benefits, note, kind) values
  ('org-bronze', 'Registered', 1, 0, 1.0, '#8A6D3B',
   array['1 point per $1 of qualifying spend',
         'Points valid for 24 months',
         'Standard support queue'],
   'Where every account starts on the day it is enrolled.', 'enterprise'),
  ('org-silver', 'Business', 2, 12000, 1.25, '#6B7280',
   array['1.25 points per $1',
         'Named onboarding contact for new services',
         'Consolidated invoice broken down by cost centre'],
   'Reached at $12,000 of qualifying spend over a rolling twelve months.', 'enterprise'),
  ('org-gold', 'Business Plus', 3, 35000, 1.5, '#B45309',
   array['1.5 points per $1',
         'Priority support queue — first response target halved',
         'Quarterly service review with the marketplace',
         'Contract pricing reviewed at every renewal'],
   'Reached at $35,000. Most multi-site accounts sit here.', 'enterprise'),
  ('org-platinum', 'Strategic', 4, 100000, 2.0, '#1F2937',
   array['2 points per $1',
         'Named account manager and a direct escalation path',
         'Points never expire while the tier is held',
         'Early access to new listings before general release',
         'Annual true-up against committed volume'],
   'Reached at $100,000. Held for a full year after it is earned, so one quiet quarter does not cost the benefits.',
   'enterprise')
on conflict (id) do update set
  name = excluded.name, sort_order = excluded.sort_order, qualify_spend = excluded.qualify_spend,
  multiplier = excluded.multiplier, benefits = excluded.benefits, note = excluded.note, kind = excluded.kind;

update loyalty_tiers set kind = 'consumer' where id in ('bronze', 'silver', 'gold', 'platinum');

/* ===================================================== who the member is === */

/* The organisation members existed with a free-text `party`, so nothing tied
   them to the account whose spend earned the points. */
alter table loyalty_members add column if not exists account_id text references enterprise_accounts(id);

update loyalty_members set account_id = 'ENT-2011' where id = 'LM-4101';
update loyalty_members set account_id = 'ENT-2014' where id = 'LM-4102';

/* The demo account. Its qualifying spend covers the twelve months to 31 Jul
   2026 — longer than the invoice history on file, because the account has been
   buying since Aug 2025 and only the last six invoices were loaded. The
   assertion at the bottom holds it to at least what those invoices show. */
insert into loyalty_members (id, party, name, kind, tier, balance, joined, qualify_12m,
                             lifetime_earned, lifetime_redeemed, expiring_soon, expiring_on,
                             last_activity, user_id, account_id) values
  ('LM-4104', 'ORG-77455', 'SmartBuild Ltd', 'enterprise', 'org-gold', 0, '12 Aug 2025',
   78412.00, 0, 0, 0, null, '29 Jul 2026', null, 'ENT-2007')
on conflict (id) do update set
  name = excluded.name, kind = excluded.kind, qualify_12m = excluded.qualify_12m,
  account_id = excluded.account_id, joined = excluded.joined;

/* The organisations were sitting on the consumer ladder, where all three of
   them are platinum several times over. */
update loyalty_members set tier = case
    when qualify_12m >= 100000 then 'org-platinum'
    when qualify_12m >= 35000  then 'org-gold'
    when qualify_12m >= 12000  then 'org-silver'
    else 'org-bronze' end
 where kind = 'enterprise';

/* ============================================== rules for what they buy === */

/* An accelerator is only worth having if it names something the account
   actually buys. These are written against the business catalogue — IoT
   connectivity and sensors, managed security, and device fleets — and each one
   says who pays for the points it issues. */
insert into loyalty_earn_rules (id, name, scope, scope_id, rate, funder, split, status,
                                "from", "to", cap_per_order, cap_per_month, audience,
                                bonus, first_only, why) values
  ('ERN-20', 'Managed security — multi-site', 'vertical', 'security', 1.0, 'shared', 50, 'active',
   '01 Feb 2026', null, null, 8000, 'enterprise', null, false,
   'Security is the stickiest thing on a business account and the hardest to move once it is in. Half funded by the seller, who keeps the renewal.'),
  ('ERN-21', 'Device fleet — 10 units or more', 'vertical', 'devices', 0.5, 'partner', null, 'active',
   '01 Feb 2026', null, 4000, null, 'enterprise', null, false,
   'A fleet order is a single decision worth many units. The seller funds it because the margin is theirs.'),
  ('ERN-22', 'First managed service on the account', 'all', null, 2.0, 'operator', null, 'active',
   '01 Apr 2026', null, 10000, null, 'enterprise', null, true,
   'Paid once, on the first managed service an account ever buys. Getting a business past its first subscription is most of the work.')
on conflict (id) do update set
  name = excluded.name, rate = excluded.rate, funder = excluded.funder, split = excluded.split,
  status = excluded.status, cap_per_order = excluded.cap_per_order,
  cap_per_month = excluded.cap_per_month, audience = excluded.audience, why = excluded.why;

/* Every invoice line needs to know which marketplace it came from, or nothing
   can work out which accelerator applies to it. */
alter table enterprise_invoice_lines add column if not exists vertical text;

update enterprise_invoice_lines l set vertical = s.vertical
  from enterprise_subscriptions s where s.id = l.subscription_id and l.vertical is null;
update enterprise_invoice_lines l set vertical = r.vertical
  from enterprise_requisitions r where r.id = l.requisition_id and l.vertical is null;
/* The two rollout lines belong to no subscription and no requisition. */
update enterprise_invoice_lines set vertical = 'iot' where vertical is null;

/* ================================================= what has been earned === */

/**
 * Points for one purchase, worked out rather than typed.
 *
 * The same function is used to generate the history below and by anything that
 * places an order afterwards, so a purchase made tomorrow earns on exactly the
 * rules that are live today. Rounded down, on the amount before tax, which is
 * what the programme says.
 */
create or replace function enterprise_points_for(
  p_account text, p_vertical text, p_amount numeric, p_on date
) returns table (points integer, rule_id text, funder text, rate numeric)
language plpgsql stable as $$
declare
  mult   numeric;
  member_id text;
  acc    record;
  n      integer;
  used   integer;
begin
  select m.id, t.multiplier into member_id, mult
    from loyalty_members m join loyalty_tiers t on t.id = m.tier
   where m.account_id = p_account;
  if mult is null then return; end if;

  /* The base rule everybody gets, then whichever accelerators name this
     marketplace or apply to everything a business buys. */
  for acc in
    select r.id, r.funder, r.rate, r.cap_per_order, r.cap_per_month, r.first_only
      from loyalty_earn_rules r
     where r.status = 'active'
       and (r.id = 'ERN-01'
            or (r.audience = 'enterprise'
                and (r.scope = 'all' or (r.scope = 'vertical' and r.scope_id = p_vertical))))
       and to_date(r."from", 'DD Mon YYYY') <= p_on
     order by (r.id = 'ERN-01') desc, r.id
  loop
    /* Paid once per account. A "first purchase" bonus that pays on every
       monthly invoice is not a first-purchase bonus, it is a rate rise
       nobody signed off. */
    if acc.first_only and exists (
      select 1 from loyalty_ledger l where l.member = member_id and l.rule_id = acc.id
    ) then
      continue;
    end if;

    n := floor(p_amount * acc.rate * mult);

    /* Capped per order where the rule says so — an uncapped accelerator on a
       fleet order issues more value than the order made. */
    if acc.cap_per_order is not null and n > acc.cap_per_order then
      n := acc.cap_per_order;
    end if;

    /* And per calendar month, counted against what this rule has already
       issued to this member in the month being earned in. */
    if acc.cap_per_month is not null then
      select coalesce(sum(l.points), 0) into used
        from loyalty_ledger l
       where l.member = member_id and l.rule_id = acc.id and l.type = 'earn'
         and date_trunc('month', to_date(l.when_date, 'DD Mon YYYY')) = date_trunc('month', p_on);
      n := least(n, greatest(acc.cap_per_month - used, 0));
    end if;

    if n <= 0 then continue; end if;

    points := n; rule_id := acc.id; funder := acc.funder; rate := acc.rate * mult;
    return next;
  end loop;
end $$;

/* The history, generated from the invoice lines the account was actually
   billed for. Typing these in would have produced a balance nobody could
   reconcile to a purchase. */
do $$
declare
  l   record;
  pts record;
  n   integer := 0;
  total integer := 0;
begin
  delete from loyalty_ledger where member = 'LM-4104';

  for l in
    select il.id, il.invoice_id, il.description, il.amount, il.vertical, il.partner_id,
           i.issued, i.period
      from enterprise_invoice_lines il
      join enterprise_invoices i on i.id = il.invoice_id
     where i.account_id = 'ENT-2007'
     order by i.issued, il.sort_order
  loop
    for pts in select * from enterprise_points_for('ENT-2007', l.vertical, l.amount, l.issued) loop
      if pts.points <= 0 then continue; end if;
      n := n + 1;
      total := total + pts.points;
      insert into loyalty_ledger (id, member, when_date, type, points, ref, rule_id, funder,
                                  seller_id, value, note, user_id)
      values ('LTX-71' || lpad(n::text, 3, '0'), 'LM-4104',
              to_char(l.issued, 'DD Mon YYYY'), 'earn', pts.points, l.invoice_id, pts.rule_id,
              pts.funder, l.partner_id,
              round(pts.points::numeric / (select per_unit from loyalty_programme where id = 'default'), 2),
              l.description || ' — ' || l.period, null);
    end loop;
  end loop;

  update loyalty_members
     set balance = total, lifetime_earned = total, last_activity = '29 Jul 2026'
   where id = 'LM-4104';

  raise notice 'LM-4104 earned % points across % movements', total, n;
end $$;

/* ===================================================== spending them === */

/* Who may turn company points into company money.
 *
 * The same split as a requisition, for the same reason: points earned on the
 * organisation's spend are the organisation's money, and one person proposing
 * with another releasing is the control that makes that true rather than
 * merely stated. */
create table if not exists enterprise_reward_policy (
  account_id      text primary key references enterprise_accounts(id) on delete cascade,
  min_redeem      integer not null check (min_redeem > 0),
  /* Who may put a redemption forward, and who may release it. Held as roles
     rather than names so somebody leaving does not silently disable the
     programme. */
  propose_roles   text[] not null,
  release_roles   text[] not null,
  /* A redemption that lands on the invoice automatically is one nobody has to
     remember to apply. */
  auto_apply      boolean not null default true,
  allocate_to_cost_centre boolean not null default true,
  default_cost_centre text references enterprise_cost_centres(id),
  note            text not null,
  updated_by      text,
  updated_on      date
);

insert into enterprise_reward_policy (account_id, min_redeem, propose_roles, release_roles,
                                      auto_apply, allocate_to_cost_centre, default_cost_centre,
                                      note, updated_by, updated_on) values
  ('ENT-2007', 5000, array['buyer', 'procurement-lead', 'it-approver'], array['procurement-lead', 'finance-approver'],
   true, true, 'CC-1000',
   'Points are the company''s money, so they are released the way any other spend is: somebody proposes, somebody else signs. Credit lands on the next invoice automatically and is allocated to Corporate unless a different cost centre is named.',
   'Vikram Shah', '2026-05-14'),
  ('ENT-2011', 25000, array['buyer', 'procurement-lead'], array['procurement-lead'], true, true, null,
   'Group treasury releases all reward credit centrally.', 'Farida Qureshi', '2026-06-02'),
  ('ENT-2014', 2000, array['procurement-lead'], array['procurement-lead'], false, false, null,
   'One person runs this account, so proposing and releasing are the same act. It is a known exception.',
   'Grace Wanjiru', '2026-07-01')
on conflict (account_id) do update set
  min_redeem = excluded.min_redeem, propose_roles = excluded.propose_roles,
  release_roles = excluded.release_roles, auto_apply = excluded.auto_apply,
  allocate_to_cost_centre = excluded.allocate_to_cost_centre, note = excluded.note;

/* A redemption on its way from proposed to spent. */
create table if not exists enterprise_redemptions (
  id           text primary key,
  account_id   text not null references enterprise_accounts(id) on delete cascade,
  member_id    text not null references loyalty_members(id) on delete cascade,
  option_id    text not null references loyalty_redeem_options(id),
  points       integer not null check (points > 0),
  /* What the points are worth in money, fixed at the moment it was proposed.
     A rate that moves between proposing and releasing is a rate somebody will
     argue about. */
  value        numeric(12,2) not null check (value > 0),
  cost_centre  text references enterprise_cost_centres(id),
  reason       text not null,
  state        text not null check (state in ('proposed', 'released', 'applied', 'declined', 'withdrawn')),
  proposed_by  text not null references enterprise_users(id),
  proposed_on  date not null,
  released_by  text references enterprise_users(id),
  released_on  date,
  decision_note text,
  /* `on delete set null` so rebuilding the invoice history does not have to
     tear down the redemptions that reference it. The link is restored by the
     seed below, which runs after. */
  applied_to   text references enterprise_invoices(id) on delete set null,
  applied_on   date,
  ledger_ref   text,
  sort_order   integer not null default 0
);

create index if not exists enterprise_redemptions_account_idx on enterprise_redemptions(account_id, state);

alter table enterprise_redemptions drop constraint if exists enterprise_redemptions_applied_to_fkey;
alter table enterprise_redemptions add constraint enterprise_redemptions_applied_to_fkey
  foreign key (applied_to) references enterprise_invoices(id) on delete set null;

alter table enterprise_redemptions drop constraint if exists enterprise_redemptions_released_check;
alter table enterprise_redemptions add constraint enterprise_redemptions_released_check
  check ((state = 'proposed' and released_by is null)
      or (state = 'withdrawn')
      or (state in ('released', 'applied', 'declined') and released_by is not null and released_on is not null));

alter table enterprise_redemptions drop constraint if exists enterprise_redemptions_declined_check;
alter table enterprise_redemptions add constraint enterprise_redemptions_declined_check
  check (state <> 'declined' or coalesce(decision_note, '') <> '');

insert into enterprise_redemptions (id, account_id, member_id, option_id, points, value, cost_centre,
                                    reason, state, proposed_by, proposed_on, released_by, released_on,
                                    decision_note, applied_to, applied_on, ledger_ref, sort_order) values
  ('RDX-1101', 'ENT-2007', 'LM-4104', 'RDM-02', 20000, 200.00, 'CC-1000',
   'Twenty thousand points against the July invoice. We are carrying more than a year of earn and nothing has been spent.',
   'proposed', 'EU-2007-04', '2026-07-30', null, null, null, null, null, null, 1),
  ('RDX-1102', 'ENT-2007', 'LM-4104', 'RDM-06', 8000, 80.00, 'CC-4100',
   'Next-day delivery on the depot rollout — the sensors are needed before the site opens.',
   'proposed', 'EU-2007-05', '2026-07-31', null, null, null, null, null, null, 2),
  ('RDX-1098', 'ENT-2007', 'LM-4104', 'RDM-02', 15000, 150.00, 'CC-1000',
   'Credit against the June invoice.',
   'applied', 'EU-2007-04', '2026-06-24', 'EU-2007-02', '2026-06-25',
   'Released. Straightforward — it is our own money and the balance was sitting idle.',
   'INV-2026-0762', '2026-07-01', 'LTX-71900', 10),
  ('RDX-1090', 'ENT-2007', 'LM-4104', 'RDM-03', 40000, 400.00, 'CC-2200',
   'A seller voucher against Sentinel, to put toward the endpoint expansion.',
   'declined', 'EU-2007-03', '2026-05-11', 'EU-2007-02', '2026-05-13',
   'Declined. A voucher locks the value to one seller for twelve months, and we are still deciding whether Sentinel is the long-term answer. Take it as invoice credit instead.',
   null, null, null, 11)
on conflict (id) do update set
  points = excluded.points, value = excluded.value, state = excluded.state,
  released_by = excluded.released_by, released_on = excluded.released_on,
  decision_note = excluded.decision_note, applied_to = excluded.applied_to;

/* The applied one has to show on the ledger, or the balance is wrong and the
   history says a redemption that never cost anything. */
insert into loyalty_ledger (id, member, when_date, type, points, ref, rule_id, funder,
                            seller_id, value, note, user_id) values
  ('LTX-71900', 'LM-4104', '25 Jun 2026', 'redeem', -15000, 'RDM-02', null, 'operator', null, 150.00,
   'Credit on invoice INV-2026-0762 — $150.00, released by Meera Iyer', null)
on conflict (id) do update set points = excluded.points, note = excluded.note;

update loyalty_members m
   set balance = (select coalesce(sum(points), 0) from loyalty_ledger where member = m.id),
       lifetime_redeemed = (select coalesce(-sum(points), 0) from loyalty_ledger
                             where member = m.id and type = 'redeem')
 where m.id = 'LM-4104';

/* ================================================================= RLS === */

alter table enterprise_reward_policy enable row level security;
alter table enterprise_redemptions   enable row level security;

drop policy if exists "operator_all_enterprise_reward_policy" on enterprise_reward_policy;
drop policy if exists "account_read_enterprise_reward_policy" on enterprise_reward_policy;
drop policy if exists "operator_all_enterprise_redemptions" on enterprise_redemptions;
drop policy if exists "account_read_enterprise_redemptions" on enterprise_redemptions;
drop policy if exists "account_write_enterprise_redemptions" on enterprise_redemptions;

create policy "operator_all_enterprise_reward_policy" on enterprise_reward_policy for all to authenticated
  using (current_persona() = 'operator') with check (current_persona() = 'operator');
create policy "account_read_enterprise_reward_policy" on enterprise_reward_policy
  for select to authenticated using (account_id = current_account_id());

create policy "operator_all_enterprise_redemptions" on enterprise_redemptions for all to authenticated
  using (current_persona() = 'operator') with check (current_persona() = 'operator');
create policy "account_read_enterprise_redemptions" on enterprise_redemptions
  for select to authenticated using (account_id = current_account_id());
create policy "account_write_enterprise_redemptions" on enterprise_redemptions
  for all to authenticated
  using (account_id = current_account_id()) with check (account_id = current_account_id());

/* The member row and its movements. A buyer reads their own organisation's;
   nobody writes them from a console, because a balance a client can edit is
   not a balance. */
drop policy if exists "account_read_loyalty_member" on loyalty_members;
drop policy if exists "account_read_loyalty_ledger" on loyalty_ledger;

create policy "account_read_loyalty_member" on loyalty_members
  for select to authenticated using (account_id = current_account_id());
create policy "account_read_loyalty_ledger" on loyalty_ledger
  for select to authenticated using (
    exists (select 1 from loyalty_members m
             where m.id = loyalty_ledger.member and m.account_id = current_account_id()));

/* ---------------------------------------------- separation of duties ---- */

/**
 * Who may release a redemption.
 *
 * The same shape as `guard_requisition`, and for the same reason. The one
 * difference is that the points already exist — declining does not stop a
 * purchase, it stops the company's own money leaving its own balance — so the
 * roles are held separately from the approval roles rather than reusing them.
 */
create or replace function guard_redemption() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  me  record;
  pol record;
  bal integer;
begin
  if current_persona() is distinct from 'enterprise' then return new; end if;

  select * into me from enterprise_users where user_id = auth.uid();
  if me is null then raise exception 'you are not on this account'; end if;
  select * into pol from enterprise_reward_policy where account_id = new.account_id;

  if tg_op = 'INSERT' then
    if not (me.role = any(pol.propose_roles)) then
      raise exception '% cannot propose a redemption on this account', me.name;
    end if;
    if new.state <> 'proposed' then
      raise exception 'a redemption starts as proposed — it cannot be raised already released';
    end if;
    if new.points < pol.min_redeem then
      raise exception 'the minimum redemption on this account is % points', pol.min_redeem;
    end if;
    select coalesce(sum(points), 0) into bal from loyalty_ledger where member = new.member_id;
    if new.points > bal then
      raise exception 'that is more than the % points the account holds', bal;
    end if;
    return new;
  end if;

  if new.state = old.state then return new; end if;

  if old.state <> 'proposed' then
    raise exception '% was already %', old.id, old.state;
  end if;

  if new.state = 'withdrawn' then
    if old.proposed_by <> me.id then
      raise exception 'only the person who proposed % can withdraw it', old.id;
    end if;
    return new;
  end if;

  if not (me.role = any(pol.release_roles)) then
    raise exception '% cannot release a redemption on this account', me.name;
  end if;
  /* Harbourpoint has one person who does both, and says so in its policy. */
  if old.proposed_by = me.id and array_length(pol.release_roles, 1) > 1 then
    raise exception 'you proposed %. Somebody else has to release it — points are the company''s money too.', old.id;
  end if;

  new.released_by := me.id;
  new.released_on := current_date;
  return new;
end $$;

drop trigger if exists enterprise_redemptions_guard on enterprise_redemptions;
create trigger enterprise_redemptions_guard before insert or update on enterprise_redemptions
  for each row execute function guard_redemption();

/* ------------------------------------------------------ sanity checks -- */
do $$
declare n integer; b integer; v numeric;
begin
  /* Every organisation is on the organisation ladder. A company on the
     consumer ladder is platinum on its first invoice. */
  select count(*) into n from loyalty_members m
    join loyalty_tiers t on t.id = m.tier
   where m.kind = 'enterprise' and t.kind <> 'enterprise';
  if n > 0 then raise exception '% organisations are on the consumer tier ladder', n; end if;

  select count(*) into n from loyalty_members m
    join loyalty_tiers t on t.id = m.tier
   where m.kind = 'consumer' and t.kind <> 'consumer';
  if n > 0 then raise exception '% people are on the organisation tier ladder', n; end if;

  /* And holds the tier its spend actually qualifies for. */
  select count(*) into n from loyalty_members m
    join loyalty_tiers t on t.id = m.tier
   where m.kind = 'enterprise'
     and t.id <> (select t2.id from loyalty_tiers t2
                   where t2.kind = 'enterprise' and t2.qualify_spend <= m.qualify_12m
                   order by t2.qualify_spend desc limit 1);
  if n > 0 then raise exception '% organisations hold a tier their spend does not qualify for', n; end if;

  /* The balance is the ledger, not a number somebody typed. */
  select balance into b from loyalty_members where id = 'LM-4104';
  select coalesce(sum(points), 0) into n from loyalty_ledger where member = 'LM-4104';
  if b <> n then
    raise exception 'LM-4104 says % points but its movements add to %', b, n;
  end if;
  if b <= 0 then raise exception 'the demo account earned nothing'; end if;

  /* Every movement traces to an invoice the account was actually billed for. */
  select count(*) into n from loyalty_ledger l
   where l.member = 'LM-4104' and l.type = 'earn'
     and not exists (select 1 from enterprise_invoices i where i.id = l.ref);
  if n > 0 then raise exception '% earn movements name an invoice that does not exist', n; end if;

  /* Every earn names a rule that was live, and the rule applies to businesses. */
  select count(*) into n from loyalty_ledger l
    join loyalty_earn_rules r on r.id = l.rule_id
   where l.member = 'LM-4104' and r.status <> 'active';
  if n > 0 then raise exception '% movements were earned under a rule that is not active', n; end if;

  /* Qualifying spend has to be at least what the invoices on file show. */
  select coalesce(sum(total), 0) into v from enterprise_invoices where account_id = 'ENT-2007';
  select qualify_12m into b from loyalty_members where id = 'LM-4104';
  if b < v then
    raise exception 'qualifying spend of % is less than the % of invoices on file', b, v;
  end if;

  /* Nobody released their own, unless the account has only one person who can. */
  select count(*) into n from enterprise_redemptions x
    join enterprise_reward_policy p on p.account_id = x.account_id
   where x.released_by = x.proposed_by and array_length(p.release_roles, 1) > 1;
  if n > 0 then raise exception '% redemptions were released by the person who proposed them', n; end if;

  /* And whoever did release one held a role that may. */
  select count(*) into n from enterprise_redemptions x
    join enterprise_reward_policy p on p.account_id = x.account_id
    join enterprise_users u on u.id = x.released_by
   where not (u.role = any(p.release_roles));
  if n > 0 then raise exception '% redemptions were released by somebody whose role cannot', n; end if;

  /* An applied redemption has to show on the ledger, or the balance is wrong. */
  select count(*) into n from enterprise_redemptions x
   where x.state = 'applied'
     and not exists (select 1 from loyalty_ledger l
                      where l.id = x.ledger_ref and l.type = 'redeem' and -l.points = x.points);
  if n > 0 then raise exception '% applied redemptions have no matching movement on the ledger', n; end if;

  /* Nothing proposed is below the account's own floor. */
  select count(*) into n from enterprise_redemptions x
    join enterprise_reward_policy p on p.account_id = x.account_id
   where x.points < p.min_redeem;
  if n > 0 then raise exception '% redemptions are below the account minimum', n; end if;

  /* There is something waiting and something decided, or the screen has
     nothing to show. */
  select count(*) into n from enterprise_redemptions where account_id = 'ENT-2007' and state = 'proposed';
  if n < 1 then raise exception 'nothing is waiting to be released on the demo account'; end if;
  select count(*) into n from enterprise_redemptions where account_id = 'ENT-2007' and state <> 'proposed';
  if n < 2 then raise exception 'the demo account has no redemption history'; end if;

  /* Every invoice line knows which marketplace it came from, or no
     accelerator can be matched to it. */
  select count(*) into n from enterprise_invoice_lines where vertical is null;
  if n > 0 then raise exception '% invoice lines have no marketplace on them', n; end if;
end $$;

/* ------------------------------------------- releasing moves the points -- */

/**
 * The movement a release produces.
 *
 * This has to happen in the database rather than in the client that pressed
 * the button. The account has no insert rights on `loyalty_ledger` on purpose
 * — a balance a client can write is not a balance — so if the caller were
 * responsible for the movement, releasing would mark the redemption spent and
 * leave the points sitting there. The balance is recomputed from the ledger
 * for the same reason: it is a total, not an opinion.
 */
create or replace function apply_redemption() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  opt text;
  who text;
begin
  if new.state not in ('released', 'applied') or old.state = new.state then
    return new;
  end if;

  select name into opt from loyalty_redeem_options where id = new.option_id;
  select name into who from enterprise_users where id = new.released_by;

  insert into loyalty_ledger (id, member, when_date, type, points, ref, rule_id, funder,
                              seller_id, value, note, user_id)
  values (coalesce(new.ledger_ref, 'LTX-RDX-' || regexp_replace(new.id, '\D', '', 'g')),
          new.member_id, to_char(coalesce(new.released_on, current_date), 'DD Mon YYYY'),
          'redeem', -new.points, new.option_id, null, 'operator', null, new.value,
          coalesce(opt, 'Reward credit') || ' — ' ||
          to_char(new.value, 'FM$999,999,990.00') ||
          coalesce(', released by ' || who, ''), null)
  on conflict (id) do nothing;

  update loyalty_members m
     set balance = (select coalesce(sum(points), 0) from loyalty_ledger where member = m.id),
         lifetime_redeemed = (select coalesce(-sum(points), 0) from loyalty_ledger
                               where member = m.id and type = 'redeem'),
         last_activity = to_char(current_date, 'DD Mon YYYY')
   where m.id = new.member_id;

  return new;
end $$;

drop trigger if exists enterprise_redemptions_apply on enterprise_redemptions;
create trigger enterprise_redemptions_apply after update on enterprise_redemptions
  for each row execute function apply_redemption();

do $$
declare n integer;
begin
  /* An organisation may not write its own movements. The balance is the sum of
     the ledger, and the ledger is written by `apply_redemption` above.
     
     Scoped to the account policies deliberately: `owner_insert_loyalty_ledger`
     and `owner_update_loyalty_ledger` still let a signed-in CUSTOMER write
     rows against their own `user_id`, which is how the consumer rewards screen
     redeems today. That is a real hole — a customer can mint themselves points
     — but it predates this migration and closing it means moving the consumer
     redemption onto the same trigger. Recorded here rather than fixed quietly,
     because a silent change to how customers redeem is worse than a known gap. */
  select count(*) into n from pg_policies
   where tablename = 'loyalty_ledger' and cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')
     and qual || coalesce(with_check, '') like '%current_account_id%';
  if n > 0 then
    raise exception '% policies let an enterprise account write the reward ledger', n;
  end if;
end $$;
