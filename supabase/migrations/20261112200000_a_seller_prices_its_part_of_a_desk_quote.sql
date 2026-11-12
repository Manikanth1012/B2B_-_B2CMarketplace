/* A seller prices its own part of a desk quote.
 *
 * A quote that names two sellers' listings goes to the operator desk, because
 * no single seller can price all of it (20261105100000). The desk then had to
 * price lines it does not sell, with nothing to go on but the published price.
 * The seller of each line could already read its own lines on such a quote —
 * the policy said so, "so it can tell the desk what it would charge" — and had
 * nowhere to say it except a message the desk might never connect to a line.
 *
 * So the seller of a line on a desk quote now proposes a unit price for that
 * line, with a note if it wants one, and the desk sees the proposal beside the
 * line when it prices the quote. The desk may use it or not. The desk still
 * sends the quote: the buyer hears one voice, and every price the buyer can
 * accept is still one `send_quote` wrote.
 *
 *   enquiry_lines.seller_unit_price   what the seller would charge, per unit
 *   enquiry_lines.seller_note         why, or on what terms
 *   enquiry_lines.seller_priced_at    when it said so
 *
 * Written only by `propose_line_price(p_line_id, p_price, p_note)`, and only:
 *
 *   by the seller of that line          the line's own `partner_id`
 *   on a desk quote                     type quote, routed to the desk
 *   while the desk has not answered it  status `submitted`
 *   above nought, within the column     at most 99,999,999.99, the most a
 *                                       quoted line can carry
 *   at or above the seller's own floor  `product_prices.floor_price` in the
 *                                       quote's currency (or the listing's
 *                                       own floor when that is its currency)
 *
 * The floor is a refusal here, where on the seller's own quote it is only a
 * warning. There the seller is the one sending the price; here it is telling
 * the desk what to send, and a proposal under the seller's own minimum is one
 * the desk could use against the seller without knowing it.
 *
 * `guard_enquiry_line` refuses a write to the three columns made any other
 * way — by the seller, the buyer or the desk — the way it refuses a quoted
 * price that did not come through `send_quote`: the function puts this
 * transaction's id in `enquiry_seller_price_tokens`, a table no API role can
 * touch, for exactly its own write. A migration or the service role (no
 * persona) is not held to it, as with every guard on this table.
 *
 * The seller cannot read the enquiry itself (it is the desk's), so it cannot
 * see the quote's status, subject or currency. `my_desk_quote_lines()` returns
 * the seller's own lines on desk quotes with just those facts about the quote,
 * and the seller's floor in its currency. Nothing about other sellers' lines.
 *
 * The desk is told through the existing path (`enquiry_send`), under a new
 * event, `enquiry.seller_priced`, in-app only like the rest.
 *
 * REQUIRES 20261105100000_a_business_can_ask_before_it_buys.sql. This file
 * replaces its `guard_enquiry_line`; never re-run that file after this one, or
 * the seller's proposals will be refused ("That line is not yours to change")
 * until this one is run again.
 *
 * Re-runnable: columns and the token table `if not exists`, constraints and
 * triggers dropped and made again, functions replaced, notification rows by
 * id. One transaction: if a check fails, nothing here is left behind.
 */

begin;

/* ===================================================== what this stands on === */

do $$
begin
  if to_regclass('public.enquiry_lines') is null or to_regclass('public.enquiry_rpc_tokens') is null then
    raise exception 'Apply 20261105100000_a_business_can_ask_before_it_buys.sql first: there are no enquiry lines to price.';
  end if;
  if to_regclass('public.product_prices') is null then
    raise exception 'There is no product_prices table, so a seller''s floor cannot be read. Apply 20260802110000_prices_are_chosen_not_converted.sql first.';
  end if;
  if not exists (select 1 from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
                  where ns.nspname = 'public' and p.proname = 'enquiry_send') then
    raise exception 'There is no enquiry_send, so the desk could not be told. Apply 20261105100000_a_business_can_ask_before_it_buys.sql first.';
  end if;
end $$;

/* ============================================================ the columns === */

alter table enquiry_lines add column if not exists seller_unit_price numeric(12,2);
alter table enquiry_lines add column if not exists seller_note text;
alter table enquiry_lines add column if not exists seller_priced_at timestamptz;

comment on column enquiry_lines.seller_unit_price is
  'On a desk quote: the unit price the seller of this line proposes to the desk. Advisory; the desk prices the quote. Written only by propose_line_price.';
comment on column enquiry_lines.seller_note is
  'On a desk quote: the seller''s note to the desk about its proposed price. Written only by propose_line_price.';
comment on column enquiry_lines.seller_priced_at is
  'When the seller last proposed a price for this line. Written only by propose_line_price.';

/* Named so they cannot collide with the auto-named enquiry_lines_<col>_check. */
alter table enquiry_lines drop constraint if exists enquiry_lines_seller_price_above_nought;
alter table enquiry_lines add constraint enquiry_lines_seller_price_above_nought
  check (seller_unit_price is null or seller_unit_price > 0);
alter table enquiry_lines drop constraint if exists enquiry_lines_seller_note_length;
alter table enquiry_lines add constraint enquiry_lines_seller_note_length
  check (seller_note is null or char_length(seller_note) <= 1000);
/* A proposal is a price with the time it was given. A note with no price, or a
   price with no time, is half of one. */
alter table enquiry_lines drop constraint if exists enquiry_lines_seller_proposal_whole;
alter table enquiry_lines add constraint enquiry_lines_seller_proposal_whole
  check ((seller_unit_price is null and seller_priced_at is null and seller_note is null)
      or (seller_unit_price is not null and seller_priced_at is not null));

/* Which transactions are inside `propose_line_price` right now. The same idea
   as `enquiry_rpc_tokens`, kept apart from it: that token tells the guards a
   price is being sent to the buyer, and this write sends nothing. */
create table if not exists enquiry_seller_price_tokens (
  txid bigint primary key
);
alter table enquiry_seller_price_tokens enable row level security;
revoke all on enquiry_seller_price_tokens from public, anon, authenticated;

/* ============================================================== the floor === */

/* The seller's floor for a listing in a currency, or null when it has none.
   The price book first; the listing's own floor only when the listing is
   priced in that currency, as the requisition price guard reads it. */
create or replace function enquiry_seller_floor(p_product text, p_currency text) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select round(pp.floor_price, 2) from product_prices pp
      where pp.product_id = p_product and pp.currency = p_currency),
    (select round(p.floor_price, 2) from products p
      where p.id = p_product and p.currency = p_currency
        and not exists (select 1 from product_prices pp2
                         where pp2.product_id = p_product and pp2.currency = p_currency)))
$$;

/* ================================================================ the rpc === */

/**
 * Propose a unit price for one of your lines on a desk quote.
 *
 * Proposing again replaces the last proposal; a blank note clears the note.
 * The desk is told each time. Nothing is sent to the buyer.
 */
create or replace function propose_line_price(p_line_id text, p_price numeric, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_me     text := current_partner_id();
  v_line   enquiry_lines;
  v_e      enquiries;
  v_floor  numeric;
  v_price  numeric;
  v_note   text := nullif(btrim(coalesce(p_note, '')), '');
  v_seller text;
begin
  if current_persona() is distinct from 'partner' or v_me is null then
    raise exception 'Only the seller of a line can propose its price.';
  end if;

  select * into v_line from enquiry_lines where id = p_line_id for update;
  /* Not found and not yours read the same, so the answer says nothing about
     somebody else's line. */
  if v_line.id is null or v_line.partner_id is distinct from v_me then
    raise exception 'That line is not one of yours on a desk quote.';
  end if;

  select * into v_e from enquiries where id = v_line.enquiry_id;
  if v_e.partner_id is not distinct from v_me then
    raise exception '% is routed to you, so price it and send the quote yourself.', v_e.id;
  end if;
  if v_e.type is distinct from 'quote' or v_e.partner_id is not null then
    raise exception 'That line is not one of yours on a desk quote.';
  end if;
  if v_e.status is distinct from 'submitted' then
    raise exception 'The desk has already answered % (it is %), so a price can no longer be proposed on it.', v_e.id, v_e.status;
  end if;

  if p_price is null then
    raise exception 'Give a unit price.';
  end if;
  v_price := round(p_price, 2);
  if v_price <= 0 then
    raise exception 'A unit price has to be above zero.';
  end if;
  if v_price > 99999999.99 then
    raise exception 'A unit price can be at most 99,999,999.99.';
  end if;
  v_floor := enquiry_seller_floor(v_line.product_id, v_e.currency);
  if v_floor is not null and v_floor > 0 and v_price < v_floor then
    raise exception 'That is below the minimum you agreed for %, which is % %.', v_line.name, v_e.currency, v_floor;
  end if;
  if v_note is not null and char_length(v_note) > 1000 then
    raise exception 'Keep the note to 1,000 characters.';
  end if;

  /* The token, for exactly this write. No exception handler here, so an error
     in the update rolls the token back with it. */
  insert into enquiry_seller_price_tokens (txid) values (txid_current()) on conflict do nothing;
  update enquiry_lines
     set seller_unit_price = v_price, seller_note = v_note, seller_priced_at = now()
   where id = v_line.id;
  delete from enquiry_seller_price_tokens where txid = txid_current();

  select name into v_seller from partners where id = v_me;
  perform enquiry_send('enquiry.seller_priced', 'operator', 'Enquiries desk', null, null,
    coalesce(v_seller, 'A seller') || ' priced its line on ' || v_e.id,
    coalesce(v_seller, 'A seller') || ' proposes ' || v_e.currency || ' ' || to_char(v_price, 'FM999,999,999,990.00')
      || ' a unit for ' || v_line.name || ' on "' || v_e.subject || '". Use it or not when you send the quote.',
    v_e.id);
end $$;

/**
 * The seller's own lines on desk quotes, with what it needs to know about each
 * quote to price them: its status, subject, currency and needed-by date, and
 * the seller's own floor in that currency. Nothing about anybody else's lines,
 * and nothing about the price the desk sent.
 */
create or replace function my_desk_quote_lines()
returns table (line_id text, enquiry_id text, subject text, status text, currency text,
               needed_by date, raised_at timestamptz, product_id text, name text, quantity integer,
               target_unit_price numeric, seller_unit_price numeric, seller_note text,
               seller_priced_at timestamptz, floor_price numeric, sort_order integer)
language sql stable security definer set search_path = public as $$
  select l.id, e.id, e.subject, e.status, e.currency, e.needed_by, e.created_at,
         l.product_id, l.name, l.quantity, l.target_unit_price, l.seller_unit_price, l.seller_note,
         l.seller_priced_at, enquiry_seller_floor(l.product_id, e.currency), l.sort_order
    from enquiry_lines l join enquiries e on e.id = l.enquiry_id
   where current_persona() = 'partner'
     and current_partner_id() is not null
     and l.partner_id = current_partner_id()
     and e.type = 'quote' and e.partner_id is null
   order by e.created_at desc, l.sort_order
$$;

/* ============================================================== the guard === */

/**
 * What a line may have done to it after it was asked for.
 *
 * As in 20261105100000, with one addition: the seller's proposal on a desk
 * quote. It is written only inside `propose_line_price`, which checked who and
 * when, and that write changes nothing else on the line. Nobody writes it
 * directly — the seller, the buyer and the desk included — and a line is never
 * raised with one.
 *
 * The rest is unchanged. The buyer owns what was asked — the quantity and the
 * price they hope for — and may change it while nobody has answered yet. The
 * responder owns the price they offer, and sets it only through `send_quote`,
 * while the quote is open (submitted or quoted). Neither may write the other's
 * column, and nobody renames a line or points it at a different listing.
 */
create or replace function guard_enquiry_line() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_persona text := current_persona();
  v_e       enquiries;
  v_role    text;
begin
  if v_persona is null then return new; end if;

  select * into v_e from enquiries where id = new.enquiry_id;
  if v_e.id is null then
    raise exception 'There is no enquiry %.', new.enquiry_id;
  end if;

  if tg_op = 'INSERT' then
    if v_e.type = 'sales' then
      raise exception 'A sales enquiry has no lines.';
    end if;
    if v_e.status not in ('submitted', 'requested') then
      raise exception 'Lines are added when % is raised, not after it has been answered.', v_e.id;
    end if;
    if v_e.type = 'demo' and new.quantity <> 1 then
      raise exception 'A demo is of one listing, once.';
    end if;
    if new.quoted_unit_price is not null then
      raise exception 'A line is priced by quoting it, not when it is asked for.';
    end if;
    if new.seller_unit_price is not null or new.seller_note is not null or new.seller_priced_at is not null then
      raise exception 'A seller proposes its price after the quote is raised, with propose_line_price.';
    end if;
    return new;
  end if;

  if new.id is distinct from old.id or new.enquiry_id is distinct from old.enquiry_id
     or new.product_id is distinct from old.product_id or new.name is distinct from old.name
     or new.partner_id is distinct from old.partner_id or new.sort_order is distinct from old.sort_order then
    raise exception 'A line names what was asked for, and that does not change.';
  end if;

  /* ---------------------------------------------- the seller's proposal -- */
  if new.seller_unit_price is distinct from old.seller_unit_price
     or new.seller_note is distinct from old.seller_note
     or new.seller_priced_at is distinct from old.seller_priced_at then
    if not exists (select 1 from enquiry_seller_price_tokens where txid = txid_current()) then
      raise exception 'A seller''s price is proposed with propose_line_price, never written on its own.';
    end if;
    if new.quantity is distinct from old.quantity
       or new.target_unit_price is distinct from old.target_unit_price
       or new.quoted_unit_price is distinct from old.quoted_unit_price then
      raise exception 'A seller''s proposal changes nothing else on the line.';
    end if;
    return new;
  end if;

  if v_persona = 'enterprise' and v_e.account_id = current_account_id() then
    if not exists (select 1 from enterprise_users
                    where user_id = auth.uid() and account_id = v_e.account_id and status = 'active') then
      raise exception 'You are not an active member of this account.';
    end if;
    v_role := 'buyer';
  elsif v_persona = 'partner' and v_e.partner_id = current_partner_id() then
    v_role := 'responder';
  elsif v_persona = 'operator' and v_e.partner_id is null then
    v_role := 'responder';
  elsif v_persona = 'operator' then
    raise exception '% is the seller''s to price. Reassign it to the desk first.', v_e.id;
  else
    raise exception 'That line is not yours to change.';
  end if;

  if v_role = 'buyer' then
    if new.quoted_unit_price is distinct from old.quoted_unit_price then
      raise exception 'Only whoever answers the quote can price it.';
    end if;
    if (new.quantity is distinct from old.quantity or new.target_unit_price is distinct from old.target_unit_price)
       and not (v_e.type = 'quote' and v_e.status = 'submitted') then
      raise exception 'What was asked can be changed until it is answered, and % has been.', v_e.id;
    end if;
  else
    if new.quantity is distinct from old.quantity or new.target_unit_price is distinct from old.target_unit_price then
      raise exception 'The quantity and the target price are the buyer''s. Price what was asked for.';
    end if;
    if new.quoted_unit_price is distinct from old.quoted_unit_price then
      if not exists (select 1 from enquiry_rpc_tokens where txid = txid_current()) then
        raise exception 'Prices are sent with send_quote, as a quote or a re-quote, never changed on their own.';
      end if;
      if not (v_e.type = 'quote' and v_e.status in ('submitted', 'quoted')) then
        raise exception '% is %, so its prices cannot be changed.', v_e.id, v_e.status;
      end if;
      if new.quoted_unit_price is null then
        raise exception 'A quoted line cannot be un-priced.';
      end if;
    end if;
  end if;

  return new;
end $$;

drop trigger if exists enquiry_lines_guard on enquiry_lines;
create trigger enquiry_lines_guard before insert or update on enquiry_lines
  for each row execute function guard_enquiry_line();

/* ======================================================== notifications === */

insert into notification_events (id, label, description, personas, category, sort_order) values
  ('enquiry.seller_priced', 'A seller prices its part of a desk quote',
   'The seller of a line on a quote the desk is answering has said what it would charge for it.',
   array['operator'], 'Enquiries', 83)
on conflict (id) do update set
  label = excluded.label, description = excluded.description,
  personas = excluded.personas, category = excluded.category, sort_order = excluded.sort_order;

/* `do nothing` on conflict, so a rule the operator has since edited stays as
   they left it. */
insert into notification_rules (id, persona, event_id, name, audience, kinds, throttle,
                                severity, enabled, mandatory, why, last_sent, sort_order) values
  ('NR-O-ENQ-SELLER-PRICED', 'operator', 'enquiry.seller_priced', 'A seller priced its line on a desk quote',
   'Enquiries desk', array['inapp'], 'Every time', 'normal', true, false,
   'The desk prices a multi-seller quote; the seller of each line knows best what it would charge.', null, 9)
on conflict (id) do nothing;

insert into notification_templates (id, rule_id, kind_id, subject, body)
select r.id || '-' || k, r.id, k, r.name,
       left(r.name || ' — ' || e.description || ' {link}', 240)
  from notification_rules r
  join notification_events e on e.id = r.event_id
  cross join lateral unnest(r.kinds) k
 where r.id = 'NR-O-ENQ-SELLER-PRICED'
on conflict (id) do nothing;

/* ================================================================ grants === */

revoke all on function propose_line_price(text, numeric, text) from public, anon;
grant execute on function propose_line_price(text, numeric, text) to authenticated;
revoke all on function my_desk_quote_lines() from public, anon;
grant execute on function my_desk_quote_lines() to authenticated;
/* Internal: asked by the two above. */
revoke all on function enquiry_seller_floor(text, text) from public, anon, authenticated;

/* ========================================================== what is true === */

do $$
declare
  n integer;
  t text;
  v_def text;
begin
  /* The three columns are there, with their types. */
  select count(*) into n from information_schema.columns
   where table_schema = 'public' and table_name = 'enquiry_lines'
     and ((column_name = 'seller_unit_price' and data_type = 'numeric' and numeric_precision = 12 and numeric_scale = 2)
       or (column_name = 'seller_note' and data_type = 'text')
       or (column_name = 'seller_priced_at' and data_type = 'timestamp with time zone'));
  if n <> 3 then raise exception 'expected the three seller columns on enquiry_lines, found %', n; end if;

  select count(*) into n from pg_constraint
   where conrelid = 'public.enquiry_lines'::regclass
     and conname in ('enquiry_lines_seller_price_above_nought', 'enquiry_lines_seller_note_length',
                     'enquiry_lines_seller_proposal_whole');
  if n <> 3 then raise exception 'expected 3 seller constraints on enquiry_lines, found %', n; end if;

  /* The token is the definer functions' alone: RLS on, no policy, and no API
     role can touch it. A client that could write a row for its own
     transaction could write a seller's price for anybody. */
  select count(*) into n from pg_class where oid = 'public.enquiry_seller_price_tokens'::regclass and relrowsecurity;
  if n <> 1 then raise exception 'row level security is off on enquiry_seller_price_tokens'; end if;
  select count(*) into n from pg_policies where schemaname = 'public' and tablename = 'enquiry_seller_price_tokens';
  if n <> 0 then raise exception 'enquiry_seller_price_tokens has % policies; it should have none', n; end if;
  foreach t in array array['anon', 'authenticated'] loop
    if has_table_privilege(t, 'public.enquiry_seller_price_tokens', 'select')
       or has_table_privilege(t, 'public.enquiry_seller_price_tokens', 'insert')
       or has_table_privilege(t, 'public.enquiry_seller_price_tokens', 'update')
       or has_table_privilege(t, 'public.enquiry_seller_price_tokens', 'delete') then
      raise exception '% can still touch enquiry_seller_price_tokens', t;
    end if;
  end loop;
  select count(*) into n from enquiry_seller_price_tokens;
  if n <> 0 then raise exception '% seller price tokens were left behind', n; end if;

  /* The guard is attached, and is this file's: it knows the token and still
     knows send_quote's. */
  select count(*) into n from pg_trigger
   where tgrelid = 'public.enquiry_lines'::regclass and tgname = 'enquiry_lines_guard' and not tgisinternal;
  if n <> 1 then raise exception 'the enquiry line guard is not attached'; end if;
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname = 'guard_enquiry_line';
  if v_def is null or v_def not like '%enquiry_seller_price_tokens%' or v_def not like '%enquiry_rpc_tokens%' then
    raise exception 'guard_enquiry_line does not guard both the seller''s proposal and the quoted price';
  end if;

  /* The rpc and the read are security definer with a search path, callable by
     a signed-in seller and by nobody signed out. */
  foreach t in array array['propose_line_price', 'my_desk_quote_lines'] loop
    select count(*) into n
      from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
     where ns.nspname = 'public' and p.proname = t and p.prosecdef
       and exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%');
    if n <> 1 then raise exception '% is not one security definer function with a search path', t; end if;
  end loop;
  if not has_function_privilege('authenticated', 'public.propose_line_price(text, numeric, text)', 'execute') then
    raise exception 'a signed-in seller cannot call propose_line_price';
  end if;
  if has_function_privilege('anon', 'public.propose_line_price(text, numeric, text)', 'execute') then
    raise exception 'propose_line_price can be called signed out';
  end if;
  if not has_function_privilege('authenticated', 'public.my_desk_quote_lines()', 'execute') then
    raise exception 'a signed-in seller cannot call my_desk_quote_lines';
  end if;
  if has_function_privilege('anon', 'public.my_desk_quote_lines()', 'execute') then
    raise exception 'my_desk_quote_lines can be called signed out';
  end if;
  if has_function_privilege('authenticated', 'public.enquiry_seller_floor(text, text)', 'execute') then
    raise exception 'enquiry_seller_floor is callable from the API';
  end if;

  /* Nobody was handed a proposal by this file. */
  select count(*) into n from enquiry_lines l join enquiries e on e.id = l.enquiry_id
   where l.seller_unit_price is not null and not (e.type = 'quote' and e.partner_id is null);
  if n > 0 then raise exception '% lines off desk quotes carry a seller''s proposal', n; end if;

  /* The desk can be told: the rule is aimed at a persona its event applies to,
     and has wording for every kind it names. */
  select count(*) into n from notification_rules r join notification_events e on e.id = r.event_id
   where r.id = 'NR-O-ENQ-SELLER-PRICED' and r.persona = any(e.personas);
  if n <> 1 then raise exception 'the seller-priced rule is missing or aimed at the wrong persona'; end if;
  select count(*) into n
    from notification_rules r, unnest(r.kinds) k
   where r.id = 'NR-O-ENQ-SELLER-PRICED'
     and not exists (select 1 from notification_templates tp where tp.rule_id = r.id and tp.kind_id = k);
  if n > 0 then raise exception 'the seller-priced rule has % kinds with no template', n; end if;
end $$;

commit;
