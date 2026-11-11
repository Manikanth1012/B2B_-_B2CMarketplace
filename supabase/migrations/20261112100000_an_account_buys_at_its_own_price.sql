/* An account buys at its own price.
 *
 * Every business account paid the price published for its market, and CR-008
 * said so on purpose: "Rate cards negotiated per account belong with the
 * commercial team that agrees them and a pricing engine that can version them
 * by account and by date; a marketplace that shows one price and invoices
 * another is the worst of both." Spec 6 then let an account negotiate one
 * quote at a time, and the next quote started from nothing. Every buyer who
 * negotiates asks the same question the week after: why is the price I agreed
 * not the price on the shelf?
 *
 * So this file builds what CR-008 said was missing, on CR-008's own terms.
 *
 *   versioned by account and by date
 *                `account_prices`: one row per account, listing and currency,
 *                with the day it starts and the day it ends. One price applies
 *                at a time. A price is never edited — it is ended and a new
 *                one set — so every requisition raised at the old one can
 *                still be explained.
 *   one price shown and invoiced
 *                the shelf shows it, the requisition line is held to it by the
 *                same guard that held it to the published price, and the order
 *                is written from the line. Nothing converts, nothing rounds
 *                differently on the way.
 *
 * WHO PAYS FOR IT. The seller, exactly as for a quote or a bundle part: the line
 * carries the account's price, the order item carries the line's, and the
 * seller is settled on the order item. So the seller is protected the way
 * spec 7 protects it: no account price is set below the floor the seller
 * agreed, and when a line is written the price charged is
 *
 *     least(published, greatest(account price, floor))
 *
 * with today's published price and today's floor. A floor raised after the
 * price was agreed still holds; a published price that falls below the agreed
 * one is what the buyer pays. A seller's one-off quote under its own floor is
 * its choice for that deal and does not become a standing price under it.
 *
 * GUIDED BUYING. An account's own policy-setter (a role with `can_set_policy`
 * — not the literal 'procurement-lead', which is SmartBuild's id only) names
 * preferred sellers and products, and says what happens to a line with no
 * account price on it — "off contract": allow it, ask the buyer why, or send
 * the requisition for approval whatever it costs. The line stores what was
 * decided on the day it was written, as the requisition stores `need`.
 *
 * REQUIRES, IN THIS ORDER:
 *   20261111200000_a_requisition_is_ordered_line_by_line.sql
 *   20261111300000_a_requisition_line_carries_the_list_price.sql
 * The second installs the price guard this file replaces. The check below runs
 * before anything is changed, and again at the end. Never re-run
 * 20261111300000 after this file: it would put back a guard that knows nothing
 * of account prices, and every account-priced line would be refused.
 *
 * Re-runnable: tables `if not exists`, functions replaced, triggers and
 * policies dropped and made again, seed rows by id. One transaction: if any
 * check fails, nothing here is left behind.
 */

begin;

/* ===================================================== what this stands on === */

do $$
declare
  v_def text;
  v_n   integer;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname = 'place_requisition_order';
  if v_def is null or v_def not like '%v_by_line%' then
    raise exception 'Apply 20261111200000_a_requisition_is_ordered_line_by_line.sql first: place_requisition_order does not yet order an ordinary requisition line by line.';
  end if;

  select count(*) into v_n from pg_trigger
   where tgrelid = 'public.enterprise_requisition_lines'::regclass
     and tgname = 'enterprise_requisition_lines_price_guard' and not tgisinternal;
  if v_n <> 1 then
    raise exception 'Apply 20261111300000_a_requisition_line_carries_the_list_price.sql first: there is no price guard on requisition lines for this file to replace.';
  end if;
end $$;

/* ============================================================ the tables === */

create sequence if not exists account_price_seq start with 1001;

/* One account's price for one listing in one currency, from a day until a day.
   `ends_on` is the last day it applies. A price ended before it started
   (`ends_on = starts_on - 1`) was withdrawn: it never applied, and it stays on
   file so the desk can see it was set. Whether a price is in force is the
   dates and the clock, never a stored flag. */
create table if not exists account_prices (
  id            text primary key default ('AP-' || nextval('account_price_seq')),
  account_id    text not null references enterprise_accounts(id) on delete cascade,
  product_id    text not null references products(id) on delete cascade,
  currency      text not null references currencies(code),
  /* The precision of the requisition line it becomes, so "equal" is exact. */
  unit_price    numeric(10,2) not null,
  starts_on     date not null default current_date,
  ends_on       date,
  source        text not null default 'negotiated',
  quote_line_id text references enquiry_lines(id) on delete set null,
  /* The enquiry, kept when the quoted line itself is gone. */
  quote_ref     text,
  note          text,
  set_by        text not null default 'Marketplace',
  set_at        timestamptz not null default now(),
  ended_by      text,
  ended_at      timestamptz,
  end_reason    text,
  constraint account_prices_positive     check (unit_price > 0),
  constraint account_prices_window       check (ends_on is null or ends_on >= starts_on - 1),
  constraint account_prices_source_kind  check (source in ('negotiated', 'quote')),
  constraint account_prices_quote_named  check (source <> 'quote' or quote_ref is not null),
  constraint account_prices_note_length  check (note is null or char_length(note) <= 300),
  constraint account_prices_end_says_why check (ended_at is null or coalesce(btrim(end_reason), '') <> '')
);

create index if not exists account_prices_key_idx on account_prices(account_id, product_id, currency, starts_on);
create index if not exists account_prices_product_idx on account_prices(product_id);

/* What the account does about a line with no account price on it. A missing
   row reads as 'allow'. */
create table if not exists enterprise_buying_rules (
  account_id   text primary key references enterprise_accounts(id) on delete cascade,
  off_contract text not null default 'allow',
  note         text,
  updated_by   text,
  updated_on   date,
  constraint enterprise_buying_rules_rule_kind   check (off_contract in ('allow', 'reason', 'approval')),
  constraint enterprise_buying_rules_note_length check (note is null or char_length(note) <= 300)
);

/* The sellers and listings an account would rather its buyers used. Steering,
   not a fence: nothing here stops a buyer choosing another. */
create table if not exists account_preferences (
  id         text primary key default gen_random_uuid()::text,
  account_id text not null references enterprise_accounts(id) on delete cascade,
  kind       text not null,
  partner_id text references partners(id) on delete cascade,
  product_id text references products(id) on delete cascade,
  note       text,
  added_by   text not null default 'Marketplace',
  added_on   date not null default current_date,
  constraint account_preferences_target check (
       (kind = 'seller'  and partner_id is not null and product_id is null)
    or (kind = 'product' and product_id is not null and partner_id is null)),
  constraint account_preferences_note_length check (note is null or char_length(note) <= 200)
);

create unique index if not exists account_preferences_seller_once
  on account_preferences(account_id, partner_id) where kind = 'seller';
create unique index if not exists account_preferences_product_once
  on account_preferences(account_id, product_id) where kind = 'product';

/* What a requisition line was priced from, and what the rules said about it on
   the day it was written. Set by the guards below, never by the buyer. */
alter table enterprise_requisition_lines add column if not exists account_price_id text references account_prices(id) on delete set null;
alter table enterprise_requisition_lines add column if not exists off_contract boolean not null default false;
alter table enterprise_requisition_lines add column if not exists off_contract_rule text;
alter table enterprise_requisition_lines add column if not exists off_contract_reason text;

alter table enterprise_requisition_lines drop constraint if exists enterprise_requisition_lines_off_contract_shape;
alter table enterprise_requisition_lines add constraint enterprise_requisition_lines_off_contract_shape check (
     (off_contract and off_contract_rule in ('allow', 'reason', 'approval'))
  or (not off_contract and off_contract_rule is null));
alter table enterprise_requisition_lines drop constraint if exists enterprise_requisition_lines_off_contract_why;
alter table enterprise_requisition_lines add constraint enterprise_requisition_lines_off_contract_why check (
  off_contract_reason is null or char_length(off_contract_reason) <= 300);

/* ======================================================= who may set rules === */

/* A yes or no about the caller: an active member of their own account whose
   role carries `can_set_policy`. The role is asked, not its id — ids are
   suffixed per account (`procurement-lead-ENT-2011`). */
create or replace function account_may_set_policy() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from enterprise_users u join enterprise_roles r on r.id = u.role
     where u.user_id = auth.uid() and u.account_id = current_account_id()
       and u.status = 'active' and r.can_set_policy)
$$;

/* ===================================================== the price, guarded === */

create or replace function guard_account_price() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_persona text := current_persona();
  v_acct    record;
  v_prod    record;
  v_q       record;
  v_clash   record;
  v_book    numeric;
  v_floor   numeric;
begin
  if tg_op = 'UPDATE' then
    /* The foreign key letting go of a deleted quote line is not an edit. */
    if new.quote_line_id is null and old.quote_line_id is not null
       and new.ends_on is not distinct from old.ends_on
       and new.unit_price = old.unit_price then
      return new;
    end if;
  end if;

  /* The marketplace agrees an account's prices. A migration or the service
     role (no persona) seeds them. Nobody else writes one. */
  if v_persona is not null and v_persona <> 'operator' then
    raise exception 'Only the marketplace sets an account''s prices.';
  end if;

  if tg_op = 'UPDATE' then
    if new.account_id is distinct from old.account_id or new.product_id is distinct from old.product_id
       or new.currency is distinct from old.currency or new.unit_price is distinct from old.unit_price
       or new.starts_on is distinct from old.starts_on or new.source is distinct from old.source
       or new.quote_ref is distinct from old.quote_ref or new.set_by is distinct from old.set_by
       or new.set_at is distinct from old.set_at or new.note is distinct from old.note
       or (new.quote_line_id is not null and new.quote_line_id is distinct from old.quote_line_id) then
      raise exception 'An account price is not edited: end it and set a new one, so every requisition raised at the old price can still be explained.';
    end if;
    if new.ends_on is not distinct from old.ends_on then
      return new;
    end if;
    if v_persona is not null then
      if old.ends_on is not null and old.ends_on < current_date then
        raise exception 'That price ended on %. An ended price stays as it was.', to_char(old.ends_on, 'DD Mon YYYY');
      end if;
      if new.ends_on is not null and new.ends_on < current_date - 1 then
        raise exception 'A price can end yesterday at the earliest — requisitions already raised were checked against it.';
      end if;
      /* Brought forward is an ending, and an ending says why. */
      if new.ends_on is not null and (old.ends_on is null or new.ends_on < old.ends_on) then
        if coalesce(btrim(new.end_reason), '') = '' then
          raise exception 'Say why the price is ending.';
        end if;
        new.ended_by := enquiry_actor_name();
        new.ended_at := now();
      end if;
    end if;
  else
    if v_persona is not null and new.starts_on < current_date then
      raise exception 'A price starts today or later. Requisitions already raised were checked against the price that applied then.';
    end if;
    if new.ends_on is not null and new.ends_on < new.starts_on then
      raise exception 'A new price has to run for at least one day: it ends before it starts.';
    end if;

    select a.id, a.company, a.market into v_acct from enterprise_accounts a where a.id = new.account_id;
    if v_acct.id is null then
      raise exception 'There is no account %.', new.account_id;
    end if;
    if not exists (select 1 from market_currencies mc
                    where mc.market_code = v_acct.market and mc.currency = new.currency) then
      raise exception '% buys in %, which does not trade in %.', v_acct.company, v_acct.market, new.currency;
    end if;

    select p.id, p.name, p.audiences, p.price, p.currency into v_prod from products p where p.id = new.product_id;
    if v_prod.id is null then
      raise exception 'There is no listing %.', new.product_id;
    end if;
    if not ('enterprise' = any(v_prod.audiences)) then
      raise exception '% is not sold to business accounts, so it has no account price.', v_prod.name;
    end if;

    select round(pp.price, 2), round(pp.floor_price, 2) into v_book, v_floor
      from product_prices pp where pp.product_id = new.product_id and pp.currency = new.currency;
    if v_book is null and v_prod.currency = new.currency then
      v_book := round(v_prod.price, 2);
    end if;
    if v_book is null then
      raise exception '% has no published price in %, so there is nothing to agree a price against.', v_prod.name, new.currency;
    end if;
    if new.unit_price > v_book then
      raise exception 'That is above the published price of % % for %. An account price is at or below it.', new.currency, v_book, v_prod.name;
    end if;
    if v_floor is not null and new.unit_price < v_floor then
      raise exception 'That is below the floor of % % that the seller of % agreed. An account price never goes under it.', new.currency, v_floor, v_prod.name;
    end if;

    if new.source = 'quote' then
      if new.quote_line_id is null then
        raise exception 'A price promoted from a quote names the quoted line it came from.';
      end if;
      select l.product_id, l.quoted_unit_price, e.id as enquiry_id, e.type, e.status, e.account_id, e.currency
        into v_q
        from enquiry_lines l join enquiries e on e.id = l.enquiry_id
       where l.id = new.quote_line_id;
      if v_q.enquiry_id is null then
        raise exception 'There is no quoted line %.', new.quote_line_id;
      end if;
      if v_q.type <> 'quote' or v_q.status <> 'accepted' then
        raise exception '% has not been accepted, so its prices cannot become the account''s.', v_q.enquiry_id;
      end if;
      if v_q.account_id is distinct from new.account_id or v_q.currency is distinct from new.currency
         or v_q.product_id is distinct from new.product_id or v_q.quoted_unit_price is distinct from new.unit_price then
        raise exception 'A price promoted from % has to be that quote''s account, listing, currency and price.', v_q.enquiry_id;
      end if;
      new.quote_ref := v_q.enquiry_id;
    elsif new.quote_line_id is not null then
      raise exception 'A negotiated price does not name a quote. Promote the quote instead.';
    end if;

    if v_persona = 'operator' then
      new.set_by := enquiry_actor_name();
      new.set_at := now();
    end if;
  end if;

  /* One price at a time. Two writers on the same key queue here, so neither
     can miss the other. A withdrawn window (ends before it starts) is no
     window at all. */
  perform pg_advisory_xact_lock(hashtext('account_price|' || new.account_id || '|' || new.product_id || '|' || new.currency));
  if new.ends_on is null or new.ends_on >= new.starts_on then
    select ap.id, ap.starts_on, a.company, p.name into v_clash
      from account_prices ap
      join enterprise_accounts a on a.id = ap.account_id
      join products p on p.id = ap.product_id
     where ap.account_id = new.account_id and ap.product_id = new.product_id
       and ap.currency = new.currency and ap.id <> new.id
       and (ap.ends_on is null or ap.ends_on >= ap.starts_on)
       and ap.starts_on <= coalesce(new.ends_on, 'infinity'::date)
       and new.starts_on <= coalesce(ap.ends_on, 'infinity'::date)
     order by ap.starts_on
     limit 1;
    if v_clash.id is not null then
      raise exception '% already has a price for % in % from % (%). One price applies at a time: end that one first.',
        v_clash.company, v_clash.name, new.currency, to_char(v_clash.starts_on, 'DD Mon YYYY'), v_clash.id;
    end if;
  end if;

  return new;
end $$;

drop trigger if exists account_prices_guard on account_prices;
create trigger account_prices_guard before insert or update on account_prices
  for each row execute function guard_account_price();

/* ============================================== the desk's three actions === */

/* Put a price in force from a day. Whatever would overlap it is ended the day
   before, or withdrawn if it had not started; a later price that begins after
   the new one ends is left alone. One transaction, so the account is never
   without a price, or with two, in between. */
create or replace function set_account_price(
  p_account text, p_product text, p_currency text, p_unit_price numeric,
  p_starts_on date default current_date, p_ends_on date default null,
  p_note text default null, p_quote_line text default null)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_old record;
  v_id  text;
begin
  if current_persona() is distinct from 'operator' then
    raise exception 'Only the marketplace sets an account''s prices.';
  end if;
  if p_starts_on is null or p_starts_on < current_date then
    raise exception 'A price starts today or later. Requisitions already raised were checked against the price that applied then.';
  end if;
  if p_ends_on is not null and p_ends_on < p_starts_on then
    raise exception 'A new price has to run for at least one day: it ends before it starts.';
  end if;

  perform pg_advisory_xact_lock(hashtext('account_price|' || p_account || '|' || p_product || '|' || p_currency));

  for v_old in
    select ap.id, ap.starts_on from account_prices ap
     where ap.account_id = p_account and ap.product_id = p_product and ap.currency = p_currency
       and (ap.ends_on is null or ap.ends_on >= ap.starts_on)
       and (ap.ends_on is null or ap.ends_on >= p_starts_on)
       and ap.starts_on <= coalesce(p_ends_on, 'infinity'::date)
  loop
    update account_prices
       set ends_on = greatest(p_starts_on - 1, v_old.starts_on - 1),
           end_reason = 'Replaced by the price from ' || to_char(p_starts_on, 'DD Mon YYYY') || '.'
     where id = v_old.id;
  end loop;

  insert into account_prices (account_id, product_id, currency, unit_price, starts_on, ends_on,
                              source, quote_line_id, note)
  values (p_account, p_product, p_currency, round(p_unit_price, 2), p_starts_on, p_ends_on,
          (case when p_quote_line is null then 'negotiated' else 'quote' end), p_quote_line,
          nullif(btrim(coalesce(p_note, '')), ''))
  returning id into v_id;
  return v_id;
end $$;

create or replace function end_account_price(p_id text, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare v_p account_prices;
begin
  if current_persona() is distinct from 'operator' then
    raise exception 'Only the marketplace sets an account''s prices.';
  end if;
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'Say why the price is ending.';
  end if;
  select * into v_p from account_prices where id = p_id for update;
  if v_p.id is null then
    raise exception 'There is no account price %.', p_id;
  end if;
  if v_p.ends_on is not null and (v_p.ends_on < current_date or v_p.ends_on < v_p.starts_on) then
    raise exception '% has already ended.', p_id;
  end if;
  update account_prices
     set ends_on = greatest(current_date - 1, v_p.starts_on - 1), end_reason = btrim(p_reason)
   where id = p_id;
end $$;

create or replace function promote_quote_line(
  p_quote_line text, p_starts_on date default current_date, p_ends_on date default null, p_note text default null)
returns text language plpgsql security definer set search_path = public as $$
declare v_q record;
begin
  if current_persona() is distinct from 'operator' then
    raise exception 'Only the marketplace sets an account''s prices.';
  end if;
  select l.id, l.product_id, l.quoted_unit_price, e.id as enquiry_id, e.account_id, e.currency, e.status
    into v_q
    from enquiry_lines l join enquiries e on e.id = l.enquiry_id
   where l.id = p_quote_line;
  if v_q.id is null then
    raise exception 'There is no quoted line %.', p_quote_line;
  end if;
  if v_q.status <> 'accepted' or v_q.quoted_unit_price is null then
    raise exception '% has not been accepted, so its prices cannot become the account''s.', v_q.enquiry_id;
  end if;
  return set_account_price(v_q.account_id, v_q.product_id, v_q.currency, v_q.quoted_unit_price,
                           p_starts_on, p_ends_on,
                           coalesce(nullif(btrim(coalesce(p_note, '')), ''), 'From quote ' || v_q.enquiry_id || '.'),
                           p_quote_line);
end $$;

/* What a seller's listings are sold at, to whom and until when. The seller
   funds the difference, so it sees it; it cannot read the accounts table, so
   the company name comes through here. */
create or replace function seller_account_prices()
returns table (id text, company text, product_id text, product_name text, currency text,
               unit_price numeric, starts_on date, ends_on date, source text)
language sql stable security definer set search_path = public as $$
  select ap.id, a.company, ap.product_id, p.name, ap.currency, ap.unit_price, ap.starts_on, ap.ends_on, ap.source
    from account_prices ap
    join products p on p.id = ap.product_id
    join enterprise_accounts a on a.id = ap.account_id
   where current_persona() = 'partner'
     and current_partner_id() is not null
     and p.partner_id = current_partner_id()
     and (ap.ends_on is null or ap.ends_on >= ap.starts_on)
   order by p.name, a.company, ap.starts_on desc
$$;

/* ================================================== rules and preferences === */

create or replace function guard_buying_rules() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if current_persona() = 'enterprise' then
    if new.account_id is distinct from current_account_id() or not account_may_set_policy() then
      raise exception 'Only somebody who can set this account''s policy can change its buying rules.';
    end if;
  elsif current_persona() is not null and current_persona() <> 'operator' then
    raise exception 'Only the account, or the marketplace for it, changes its buying rules.';
  end if;
  if tg_op = 'UPDATE' and new.account_id is distinct from old.account_id then
    raise exception 'Buying rules belong to one account.';
  end if;
  if current_persona() is not null then
    new.updated_by := enquiry_actor_name();
    new.updated_on := current_date;
  end if;
  new.note := nullif(btrim(coalesce(new.note, '')), '');
  return new;
end $$;

drop trigger if exists enterprise_buying_rules_guard on enterprise_buying_rules;
create trigger enterprise_buying_rules_guard before insert or update on enterprise_buying_rules
  for each row execute function guard_buying_rules();

create or replace function guard_account_preference() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_prod record;
begin
  if tg_op = 'UPDATE' then
    raise exception 'A preference is not edited: remove it and add it again.';
  end if;
  if current_persona() = 'enterprise' then
    if new.account_id is distinct from current_account_id() or not account_may_set_policy() then
      raise exception 'Only somebody who can set this account''s policy can choose its preferred sellers and products.';
    end if;
  elsif current_persona() is not null and current_persona() <> 'operator' then
    raise exception 'Only the account, or the marketplace for it, chooses its preferred sellers and products.';
  end if;
  if new.kind = 'product' then
    select p.id, p.name, p.audiences into v_prod from products p where p.id = new.product_id;
    if v_prod.id is null or not ('enterprise' = any(v_prod.audiences)) then
      raise exception '% is not sold to business accounts, so it cannot be a preferred product.', coalesce(v_prod.name, new.product_id);
    end if;
  end if;
  if current_persona() is not null then
    new.added_by := enquiry_actor_name();
    new.added_on := current_date;
  end if;
  return new;
end $$;

drop trigger if exists account_preferences_guard on account_preferences;
create trigger account_preferences_guard before insert or update on account_preferences
  for each row execute function guard_account_preference();

/* ============================================ the requisition line, priced === */

/* Was (20261111300000): an ordinary line written by a business buyer carries
   the published price for its listing in the requisition's currency. Now: the
   account's own price where one is in force today, held between the floor and
   the published price as they stand today; the published price otherwise.
   Everything else is as it was — who it applies to, which lines it leaves to
   their own guards, when an update is looked at again, and the words. It also
   records what the line was priced from and whether it was bought off the
   account's price book. */
create or replace function guard_requisition_line_price() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_req   record;
  v_book  numeric;
  v_floor numeric;
  v_ap    record;
  v_price numeric;
  v_rule  text;
  v_name  text;
begin
  /* Null persona is a migration or the service role; the operator corrects
     lines for its own reasons. Neither is a buyer. */
  if current_persona() is distinct from 'enterprise' then
    return new;
  end if;

  /* Quoted and bundled lines are held to their own price by their own guards. */
  if new.quote_line_id is not null or new.bundle_selection_id is not null then
    new.account_price_id := null;
    new.off_contract := false;
    new.off_contract_rule := null;
    return new;
  end if;

  if tg_op = 'UPDATE'
     and new.unit_price is not distinct from old.unit_price
     and new.product_id is not distinct from old.product_id
     and new.requisition_id is not distinct from old.requisition_id then
    return new;
  end if;

  select r.id, r.currency, r.account_id into v_req from enterprise_requisitions r where r.id = new.requisition_id;
  if v_req.id is null then
    /* `guard_requisition_line` says this one, in its own words. */
    return new;
  end if;

  v_name := coalesce(nullif(btrim(new.name), ''), new.product_id, 'That line');

  if new.product_id is null then
    raise exception '% names no listing, so there is no price to hold it to. Add it from the catalogue and raise the requisition again.',
      v_name;
  end if;

  select round(pp.price, 2), round(pp.floor_price, 2) into v_book, v_floor
    from product_prices pp
   where pp.product_id = new.product_id and pp.currency = v_req.currency;

  if v_book is null then
    /* The shelf's own fallback: the base row, when it is in this money. */
    select round(p.price, 2) into v_book
      from products p
     where p.id = new.product_id and p.currency = v_req.currency;
  end if;

  if v_book is null then
    raise exception '% has no price in %, so it cannot go on a requisition in %. Remove it from the requisition to raise the rest.',
      v_name, v_req.currency, v_req.currency;
  end if;

  select ap.id, ap.unit_price into v_ap
    from account_prices ap
   where ap.account_id = v_req.account_id and ap.product_id = new.product_id
     and ap.currency = v_req.currency
     and ap.starts_on <= current_date
     and (ap.ends_on is null or ap.ends_on >= current_date)
   order by ap.starts_on desc
   limit 1;

  if v_ap.id is null then
    v_price := v_book;
    select coalesce((select b.off_contract from enterprise_buying_rules b where b.account_id = v_req.account_id), 'allow')
      into v_rule;
    new.account_price_id := null;
    new.off_contract := true;
    new.off_contract_rule := v_rule;
  else
    /* Never under the seller's floor, never over the published price. */
    v_price := least(v_book, greatest(round(v_ap.unit_price, 2), coalesce(v_floor, 0)));
    new.account_price_id := v_ap.id;
    new.off_contract := false;
    new.off_contract_rule := null;
  end if;

  if round(new.unit_price, 2) is distinct from v_price then
    if v_ap.id is null then
      raise exception 'The price of % has changed: it is now % %, and this requisition has it at %. Remove it from the requisition and add it again from the catalogue to take the current price.',
        v_name, v_req.currency, v_price, round(new.unit_price, 2);
    else
      raise exception 'The price of % has changed: your account''s price is now % %, and this requisition has it at %. Remove it from the requisition and add it again from the catalogue to take the current price.',
        v_name, v_req.currency, v_price, round(new.unit_price, 2);
    end if;
  end if;

  return new;
end $$;

/* The same trigger, made again so this file says what it is attached to. */
drop trigger if exists enterprise_requisition_lines_price_guard on enterprise_requisition_lines;
create trigger enterprise_requisition_lines_price_guard
  before insert or update of unit_price, product_id, requisition_id on enterprise_requisition_lines
  for each row execute function guard_requisition_line_price();

/* What the buying rules ask of a line bought off the price book. Named to run
   after every other line guard, so it judges the line they have finished
   with. A business buyer only; on an update that changes nothing the price
   guard looks at, the stored verdict stays as it was. */
create or replace function guard_requisition_line_contract() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_need text;
  v_name text;
begin
  if current_persona() is distinct from 'enterprise' then
    return new;
  end if;

  if tg_op = 'UPDATE'
     and new.unit_price is not distinct from old.unit_price
     and new.product_id is not distinct from old.product_id
     and new.requisition_id is not distinct from old.requisition_id
     and new.quote_line_id is not distinct from old.quote_line_id
     and new.bundle_selection_id is not distinct from old.bundle_selection_id then
    new.account_price_id := old.account_price_id;
    new.off_contract := old.off_contract;
    new.off_contract_rule := old.off_contract_rule;
  end if;

  if new.quote_line_id is not null or new.bundle_selection_id is not null then
    new.account_price_id := null;
    new.off_contract := false;
    new.off_contract_rule := null;
  end if;

  if not new.off_contract then
    new.off_contract_reason := null;
    return new;
  end if;

  new.off_contract_reason := nullif(btrim(coalesce(new.off_contract_reason, '')), '');
  v_name := coalesce(nullif(btrim(new.name), ''), new.product_id, 'That line');

  if new.off_contract_rule = 'reason' and coalesce(char_length(new.off_contract_reason), 0) < 5 then
    raise exception '% is not on your account''s price book, and your buying rules ask for a reason when you buy off it. Say why on the line (at least 5 characters).',
      v_name;
  end if;

  if new.off_contract_rule = 'approval' then
    select r.need into v_need from enterprise_requisitions r where r.id = new.requisition_id;
    if v_need in ('none', 'it') then
      raise exception '% is not on your account''s price book, and your buying rules send anything bought off it for approval. Raise the requisition again so it goes to a finance approver.',
        v_name;
    end if;
  end if;

  return new;
end $$;

drop trigger if exists enterprise_requisition_lines_z_contract_guard on enterprise_requisition_lines;
create trigger enterprise_requisition_lines_z_contract_guard
  before insert or update on enterprise_requisition_lines
  for each row execute function guard_requisition_line_contract();

/* Lines are written after their header, and a pending header can be updated
   by its buyer. Without this, a requisition sent for approval by its lines
   could be marked as needing none afterwards. */
create or replace function guard_requisition_off_contract() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if current_persona() is distinct from 'enterprise' then
    return new;
  end if;
  if new.need in ('finance', 'both') then
    return new;
  end if;
  if exists (select 1 from enterprise_requisition_lines l
              where l.requisition_id = new.id and l.off_contract and l.off_contract_rule = 'approval') then
    raise exception '% holds lines bought off your account''s price book, which your buying rules send for approval, so it cannot be marked as needing none.',
      new.id;
  end if;
  return new;
end $$;

drop trigger if exists z_guard_requisition_off_contract on enterprise_requisitions;
create trigger z_guard_requisition_off_contract
  before update of need on enterprise_requisitions
  for each row execute function guard_requisition_off_contract();

/* ================================================================== RLS === */

alter table account_prices          enable row level security;
alter table enterprise_buying_rules enable row level security;
alter table account_preferences     enable row level security;

drop policy if exists "operator_all_account_prices" on account_prices;
drop policy if exists "account_read_account_prices" on account_prices;
drop policy if exists "partner_read_account_prices" on account_prices;
create policy "operator_all_account_prices" on account_prices for all to authenticated
  using (current_persona() = 'operator') with check (current_persona() = 'operator');
create policy "account_read_account_prices" on account_prices for select to authenticated
  using (account_id = current_account_id());
create policy "partner_read_account_prices" on account_prices for select to authenticated
  using (current_persona() = 'partner' and exists (
    select 1 from products p where p.id = account_prices.product_id and p.partner_id = current_partner_id()));

drop policy if exists "operator_all_enterprise_buying_rules" on enterprise_buying_rules;
drop policy if exists "account_read_enterprise_buying_rules" on enterprise_buying_rules;
drop policy if exists "account_insert_enterprise_buying_rules" on enterprise_buying_rules;
drop policy if exists "account_update_enterprise_buying_rules" on enterprise_buying_rules;
create policy "operator_all_enterprise_buying_rules" on enterprise_buying_rules for all to authenticated
  using (current_persona() = 'operator') with check (current_persona() = 'operator');
create policy "account_read_enterprise_buying_rules" on enterprise_buying_rules for select to authenticated
  using (account_id = current_account_id());
create policy "account_insert_enterprise_buying_rules" on enterprise_buying_rules for insert to authenticated
  with check (account_id = current_account_id() and account_may_set_policy());
create policy "account_update_enterprise_buying_rules" on enterprise_buying_rules for update to authenticated
  using (account_id = current_account_id() and account_may_set_policy())
  with check (account_id = current_account_id() and account_may_set_policy());

drop policy if exists "operator_all_account_preferences" on account_preferences;
drop policy if exists "account_read_account_preferences" on account_preferences;
drop policy if exists "account_insert_account_preferences" on account_preferences;
drop policy if exists "account_delete_account_preferences" on account_preferences;
create policy "operator_all_account_preferences" on account_preferences for all to authenticated
  using (current_persona() = 'operator') with check (current_persona() = 'operator');
create policy "account_read_account_preferences" on account_preferences for select to authenticated
  using (account_id = current_account_id());
create policy "account_insert_account_preferences" on account_preferences for insert to authenticated
  with check (account_id = current_account_id() and account_may_set_policy());
create policy "account_delete_account_preferences" on account_preferences for delete to authenticated
  using (account_id = current_account_id() and account_may_set_policy());

grant select, insert, update, delete on account_prices, enterprise_buying_rules, account_preferences to authenticated;
/* Supabase's default privileges grant everything to anon as well. None of
   this is for a visitor who is not signed in. */
revoke all on account_prices, enterprise_buying_rules, account_preferences from anon;
grant usage on sequence account_price_seq to authenticated;

revoke all on function set_account_price(text, text, text, numeric, date, date, text, text) from public, anon;
revoke all on function end_account_price(text, text) from public, anon;
revoke all on function promote_quote_line(text, date, date, text) from public, anon;
revoke all on function seller_account_prices() from public, anon;
grant execute on function set_account_price(text, text, text, numeric, date, date, text, text) to authenticated;
grant execute on function end_account_price(text, text) to authenticated;
grant execute on function promote_quote_line(text, date, date, text) to authenticated;
grant execute on function seller_account_prices() to authenticated;

/* ============================================================ the boundary === */

/* CR-008 said this marketplace does not negotiate prices, and why. It does now,
   on the terms the rule itself set out. */
update channel_rule
   set decision       = 'sold here',
       sold_through   = 'Account price books, agreed by the marketplace (operator console: Price books)',
       reason         = 'An account can have prices of its own: agreed by the marketplace with the account, per listing and currency, from a date until a date, never below the floor the seller agreed and never above the published price. Everything else is bought at the price published for the account''s market. One price is shown and the same price is invoiced: the catalogue, the requisition and the order all carry it, and the database refuses a requisition line at any other.',
       effective_from = current_date,
       agreed_by      = 'Anika Sharma'
 where id = 'CR-008' and decision = 'not operated here';

/* ================================================================= seed === */

insert into enterprise_buying_rules (account_id, off_contract, note, updated_by, updated_on)
select a.id, 'allow', null, 'Marketplace', current_date from enterprise_accounts a
on conflict (account_id) do nothing;

update enterprise_buying_rules
   set note = 'Off-contract buying is allowed while the price book is built up. Reviewed at the next commercial review.',
       updated_by = 'Vikram Shah'
 where account_id = 'ENT-2007' and note is null;

/* One price for SmartBuild, on a live business listing priced in rupees with a
   floor below its price, that no integration test buys — those tests raise
   lines at the published price and would be refused at this one. About 8%
   under the published price, never under the floor. SKU-4006 if it qualifies;
   otherwise the first that does. */
do $$
declare v_pick record;
begin
  if exists (select 1 from account_prices where id = 'AP-SEED-2007-1') then
    return;
  end if;

  select p.id, p.name, p.partner_id, round(pp.price, 2) as book, round(pp.floor_price, 2) as floor
    into v_pick
    from products p
    join product_prices pp on pp.product_id = p.id and pp.currency = 'INR'
   where p.status = 'live' and 'enterprise' = any(p.audiences)
     and pp.floor_price is not null and pp.floor_price < pp.price
     and p.id not in ('SKU-2001', 'SKU-2004', 'SKU-4003', 'SKU-4008', 'SKU-5003', 'SKU-5004', 'SKU-5005',
                      'SKU-5007', 'SKU-5008', 'SKU-6001', 'SKU-6002', 'SKU-7001', 'SKU-7004', 'SKU-7009')
     and not exists (select 1 from account_prices ap
                      where ap.account_id = 'ENT-2007' and ap.product_id = p.id and ap.currency = 'INR')
   order by (p.id = 'SKU-4006') desc, p.id
   limit 1;

  if v_pick.id is null then
    raise exception 'No live business listing priced in INR with a floor is free to seed SmartBuild''s account price on.';
  end if;

  insert into account_prices (id, account_id, product_id, currency, unit_price, starts_on, ends_on,
                              source, note, set_by)
  values ('AP-SEED-2007-1', 'ENT-2007', v_pick.id, 'INR',
          greatest(v_pick.floor, round(v_pick.book * 0.92, 0)), current_date, null,
          'negotiated', 'Agreed at SmartBuild''s 2026 commercial review.', 'Anika Sharma')
  on conflict (id) do nothing;

  insert into account_preferences (id, account_id, kind, product_id, note, added_by)
  values ('PREF-SEED-2007-P', 'ENT-2007', 'product', v_pick.id, 'On our price book.', 'Vikram Shah')
  on conflict do nothing;

  if v_pick.partner_id is not null then
    insert into account_preferences (id, account_id, kind, partner_id, note, added_by)
    values ('PREF-SEED-2007-S', 'ENT-2007', 'seller', v_pick.partner_id, 'Preferred supplier since 2025.', 'Vikram Shah')
    on conflict do nothing;
  end if;

  raise notice 'SmartBuild''s seeded account price is on % (%)', v_pick.id, v_pick.name;
end $$;

/* ================================================================= help === */

/* The agreement articles said prices are never negotiated. They still say what
   the agreement settles; the price section now says where an account's own
   prices are. Both keep "published for … market", which 20260809150000 checks. */
update kb_articles k
   set body = (
     select jsonb_agg(
              (case when jsonb_typeof(e) = 'array' and e ->> 0 = 'It does not set prices'
                    then jsonb_build_array('Prices',
                      'You are charged the price published for your market on the day you order, unless your account has a price of its own for that listing on that day. Those are agreed with Aventa and listed on Price book, each with the dates it applies; they are not part of this agreement and do not change when it is amended. The expected spend on the agreement is your own planning figure — it is not a commitment to buy and it carries no price advantage.')
                    else e end)
              order by ord)
       from jsonb_array_elements(k.body) with ordinality t(e, ord))
 where k.view = 'en-agreement' and k.body::text like '%It does not set prices%';

update kb_articles k
   set body = (
     select jsonb_agg(
              (case when jsonb_typeof(e) = 'array' and e ->> 0 = 'What an agreement settles, and what it does not'
                    then jsonb_build_array(e ->> 0,
                      'The term, the payment terms, the currency, who signed on each side, and what happens when it runs out. Not the price. An account is charged what is published for its market, or its own price on Price books where one is in force for that listing on that day. The two are kept apart on purpose: an agreement is a signed document, and a price book changes at every commercial review. A stated expected spend buys nothing.')
                    else e end)
              order by ord)
       from jsonb_array_elements(k.body) with ordinality t(e, ord))
 where k.view = 'op-contracts' and k.body::text like '%no rate card hanging off any of this%';

do $$
declare
  v_op text; v_en text;
  n_op int;  n_en int;
begin
  select coalesce(max(substring(id from '^KB-O(\d+)$')::int), 0) + 1 into n_op
    from kb_articles where id ~ '^KB-O\d+$';
  select coalesce(max(substring(id from '^KB-B(\d+)$')::int), 0) + 1 into n_en
    from kb_articles where id ~ '^KB-B\d+$';
  v_op := 'KB-O' || lpad(n_op::text, 2, '0');
  v_en := 'KB-B' || lpad(n_en::text, 2, '0');

  if not exists (select 1 from kb_articles where view = 'op-pricebooks') then
    insert into kb_articles
      (id, persona, kind, title, mins, updated, view, roles, tags, summary,
       body, status, sort_order, personas, audience_note, audience_ids)
    values (
      v_op, 'operator', 'howto', 'Account price books', 5, to_char(current_date, 'DD Mon YYYY'), 'op-pricebooks',
      array['OR-ADMIN'], array['pricing', 'accounts', 'quotes'],
      'Setting, replacing and ending the prices a business account buys at, and turning an accepted quote into one.',
      jsonb_build_array(
        jsonb_build_object('kind', 'prose', 'heading', 'What an account price is',
          'text', 'A price one business account pays for one listing in one currency, from a day until a day. Everything without one is bought at the price published for the account''s market. The shelf, the requisition and the order all carry the same figure, and the database refuses a requisition line at any other.'),
        jsonb_build_object('kind', 'prose', 'heading', 'Between the floor and the published price',
          'text', 'A price is set at or below the published price and never below the floor the seller agreed. The seller is settled at it, as for a quote. If the seller later raises its floor above the agreed price, the account is charged the floor and the book says "held at floor"; if the published price falls below it, the account pays the published price.'),
        jsonb_build_object('kind', 'prose', 'heading', 'Changing a price',
          'text', 'A price is never edited. Set a new one from today or a later day and the old one ends the day before — or is withdrawn, if it had not started. One price applies at a time, so a price that would overlap another is refused until the other is ended. Ending asks for a reason, which the account can read.'),
        jsonb_build_object('kind', 'prose', 'heading', 'From a quote',
          'text', 'An accepted quote line can become a standing price at its quoted figure. It is held to the floor like any other: a seller may quote one deal below its floor, and that is not agreement to a standing price below it.')
      ),
      'published', n_op, array['operator'], '', array[]::text[]);
  end if;

  if not exists (select 1 from kb_articles where view = 'en-pricebook') then
    insert into kb_articles
      (id, persona, kind, title, mins, updated, view, roles, tags, summary,
       body, status, sort_order, personas, audience_note, audience_ids)
    values (
      v_en, 'enterprise', 'howto', 'Your price book and buying rules', 4, to_char(current_date, 'DD Mon YYYY'), 'en-pricebook',
      array['BY-ADMIN', 'BY-BUY'], array['pricing', 'policy', 'ordering'],
      'The prices agreed for your account, the sellers and products you prefer, and what happens when somebody buys off the price book.',
      jsonb_build_array(
        jsonb_build_object('kind', 'prose', 'heading', 'Your prices',
          'text', 'These are the prices Aventa has agreed with your account, each for one listing in one currency between two dates. In the catalogue they show as Your price, with the published price struck through, and the requisition carries them. Anything not listed here is bought at the price published for your market. A price ending is shown here before it ends.'),
        jsonb_build_object('kind', 'prose', 'heading', 'Preferred sellers and products',
          'text', 'Somebody who can set your account''s policy can name preferred sellers and products. They come first in the catalogue and carry a Preferred badge. Nobody is stopped from buying anything else.'),
        jsonb_build_object('kind', 'prose', 'heading', 'Buying off the price book',
          'text', 'A line with no account price on it is off your price book. Your buying rules say what happens: it is allowed; the buyer says why on the line and the approver reads it; or the requisition goes to a finance approver whatever it costs. What the rules said is kept on the line as it was raised.')
      ),
      'published', n_en, array['enterprise'], '', array[]::text[]);
  end if;
end $$;

/* ========================================================== what is true === */

do $$
declare
  v_def  text;
  v_n    integer;
  v_type integer;
  v_cols text;
  v_bad  text;
begin
  /* Still standing on what it needs. */
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname = 'place_requisition_order';
  if v_def is null or v_def not like '%v_by_line%' then
    raise exception 'place_requisition_order is not the line-by-line version from 20261111200000';
  end if;

  /* RLS on every new table. */
  select string_agg(c.relname, ', ') into v_bad
    from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
   where ns.nspname = 'public'
     and c.relname in ('account_prices', 'enterprise_buying_rules', 'account_preferences')
     and not c.relrowsecurity;
  if v_bad is not null then
    raise exception 'row level security is off on %', v_bad;
  end if;

  /* The price guard: attached once, before insert and update of its three
     columns, never on delete, and it is this file's function.
     tgtype bits: 1 row, 2 before, 4 insert, 8 delete, 16 update. */
  select tgtype::integer, tgattr::text into v_type, v_cols from pg_trigger
   where tgrelid = 'public.enterprise_requisition_lines'::regclass
     and tgname = 'enterprise_requisition_lines_price_guard' and not tgisinternal;
  if v_type is null or (v_type & 23) <> 23 or (v_type & 8) <> 0 then
    raise exception 'the price guard fires on the wrong events (tgtype %)', v_type;
  end if;
  if array_length(string_to_array(btrim(v_cols), ' '), 1) is distinct from 3 then
    raise exception 'the price guard watches the wrong columns (%)', v_cols;
  end if;
  select count(*) into v_n from pg_proc
   where proname = 'guard_requisition_line_price' and prosecdef
     and prosrc like '%account_prices%'
     and prosrc like '%has changed%add it again from the catalogue%'
     and prosrc like '%new.quote_line_id is not null or new.bundle_selection_id is not null%';
  if v_n <> 1 then
    raise exception 'guard_requisition_line_price is not the function this file wrote';
  end if;

  /* The contract guard: before insert or update, every column. */
  select tgtype::integer, tgattr::text into v_type, v_cols from pg_trigger
   where tgrelid = 'public.enterprise_requisition_lines'::regclass
     and tgname = 'enterprise_requisition_lines_z_contract_guard' and not tgisinternal;
  if v_type is null or (v_type & 23) <> 23 or (v_type & 8) <> 0 or coalesce(btrim(v_cols), '') <> '' then
    raise exception 'the off-contract line guard is attached wrongly (tgtype %, columns %)', v_type, v_cols;
  end if;

  /* The header guard: before update of need only. */
  select tgtype::integer, tgattr::text into v_type, v_cols from pg_trigger
   where tgrelid = 'public.enterprise_requisitions'::regclass
     and tgname = 'z_guard_requisition_off_contract' and not tgisinternal;
  if v_type is null or (v_type & 19) <> 19 or (v_type & 12) <> 0
     or array_length(string_to_array(btrim(coalesce(v_cols, '')), ' '), 1) is distinct from 1 then
    raise exception 'the off-contract header guard is attached wrongly (tgtype %, columns %)', v_type, v_cols;
  end if;

  /* Every guard already on the lines is still there beside these. */
  select count(*) into v_n from pg_trigger
   where tgrelid = 'public.enterprise_requisition_lines'::regclass and not tgisinternal
     and tgname in ('enterprise_requisition_lines_guard', 'enterprise_requisition_lines_quoted_guard',
                    'enterprise_requisition_lines_bundle_guard', 'enterprise_requisition_lines_bundle_follow',
                    'enterprise_requisition_lines_bundle_whole', 'enterprise_requisition_lines_price_guard',
                    'enterprise_requisition_lines_z_contract_guard');
  if v_n <> 7 then
    raise exception 'a requisition line guard went missing (found % of 7)', v_n;
  end if;

  select count(*) into v_n from pg_trigger
   where not tgisinternal and tgname in ('account_prices_guard', 'enterprise_buying_rules_guard', 'account_preferences_guard');
  if v_n <> 3 then
    raise exception 'a guard on the new tables is missing (found % of 3)', v_n;
  end if;

  /* Every function this file wrote runs as its owner with a fixed path. */
  select string_agg(p.proname, ', ') into v_bad from pg_proc p
   where p.proname in ('account_may_set_policy', 'guard_account_price', 'set_account_price', 'end_account_price',
                       'promote_quote_line', 'seller_account_prices', 'guard_buying_rules', 'guard_account_preference',
                       'guard_requisition_line_price', 'guard_requisition_line_contract', 'guard_requisition_off_contract')
     and (not p.prosecdef or not coalesce(array_to_string(p.proconfig, ',') like '%search_path=public%', false));
  if v_bad is not null then
    raise exception 'not security definer with search_path = public: %', v_bad;
  end if;

  /* One price at a time, in the data as well as in the guard. */
  select string_agg(a.id || '/' || b.id, ', ') into v_bad
    from account_prices a
    join account_prices b on b.account_id = a.account_id and b.product_id = a.product_id
                         and b.currency = a.currency and a.id < b.id
   where (a.ends_on is null or a.ends_on >= a.starts_on)
     and (b.ends_on is null or b.ends_on >= b.starts_on)
     and a.starts_on <= coalesce(b.ends_on, 'infinity'::date)
     and b.starts_on <= coalesce(a.ends_on, 'infinity'::date);
  if v_bad is not null then
    raise exception 'account prices that overlap: %', v_bad;
  end if;

  /* The seed is there and inside its band. */
  select count(*) into v_n
    from account_prices ap
    join product_prices pp on pp.product_id = ap.product_id and pp.currency = ap.currency
   where ap.id = 'AP-SEED-2007-1'
     and ap.unit_price <= round(pp.price, 2)
     and ap.unit_price >= round(coalesce(pp.floor_price, 0), 2);
  if v_n <> 1 then
    raise exception 'SmartBuild''s seeded account price is missing or outside its floor and published price';
  end if;
  if exists (select 1 from enterprise_accounts a
              where not exists (select 1 from enterprise_buying_rules b where b.account_id = a.id)) then
    raise exception 'an account has no buying rules row';
  end if;
  if (select off_contract from enterprise_buying_rules where account_id = 'ENT-2007') is distinct from 'allow' then
    raise exception 'SmartBuild''s seeded rule is not allow, which existing requisition tests rely on';
  end if;

  /* Read only: prices in force that today's floor or published price has moved
     past. The guard charges the clamped figure; the desk sees "held at floor". */
  select count(*) into v_n
    from account_prices ap
    join product_prices pp on pp.product_id = ap.product_id and pp.currency = ap.currency
   where ap.starts_on <= current_date and (ap.ends_on is null or ap.ends_on >= current_date)
     and (ap.unit_price > round(pp.price, 2) or ap.unit_price < round(coalesce(pp.floor_price, 0), 2));
  raise notice '% account prices in force are outside today''s floor and published price, and are charged at the nearer bound.', v_n;

  /* The boundary is written down as it now is. */
  if not exists (select 1 from channel_rule where id = 'CR-008' and decision = 'sold here' and reason like '%published%') then
    raise exception 'CR-008 still says negotiated pricing is not operated here';
  end if;

  /* Every new screen has its help, and the agreement articles still say prices
     are the published ones unless the account has its own. */
  select count(*) into v_n from kb_articles where view in ('op-pricebooks', 'en-pricebook');
  if v_n <> 2 then
    raise exception 'the price book screens do not each have one help article (found %)', v_n;
  end if;
  select string_agg(id, ', ') into v_bad from kb_articles
   where view in ('op-contracts', 'en-agreement')
     and body::text not ilike '%published for its market%'
     and body::text not ilike '%published for your market%';
  if v_bad is not null then
    raise exception 'agreement help no longer says what the published price is: %', v_bad;
  end if;
end $$;

commit;
