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
 * WHERE IT LIVES. In its own table, `enquiry_line_proposals`, one row per line,
 * and not on `enquiry_lines`. The buyer reads every column of its own lines,
 * and the gap between what a seller asked for and what the desk quoted is the
 * desk's margin: it is between the seller and the desk. Here the seller reads
 * the rows for its own lines, the desk reads them all, and the buyer reads
 * none. Nothing of 20261105100000 is replaced — not `enquiry_lines`, not its
 * guard, not its policies — so every screen that reads lines reads exactly
 * what it read before.
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
 * Nobody writes the table directly. No API role holds insert, update or delete
 * on it and there is no policy that would allow one; and `guard_line_proposal`
 * refuses a write from any signed-in persona that did not come through
 * `propose_line_price` (whose transaction holds a row in
 * `enquiry_seller_price_tokens`, a table no API role can touch). The desk is
 * held to it too: a "seller's price" the desk wrote itself would be worth
 * nothing. A migration or the service role (no persona) is not.
 *
 * The seller cannot read the enquiry itself (it is the desk's), so it cannot
 * see the quote's status, subject or currency. `my_desk_quote_lines()` returns
 * the seller's own lines on desk quotes with just those facts about the quote,
 * its own proposal, and its floor in that currency. Nothing about other
 * sellers' lines, and not the price the desk sent.
 *
 * The desk is told through the existing path (`enquiry_send`), under a new
 * event, `enquiry.seller_priced`, in-app only like the rest. No row goes to
 * `enquiry_events`: the buyer reads those.
 *
 * REQUIRES 20261105100000_a_business_can_ask_before_it_buys.sql.
 *
 * Re-runnable: tables `if not exists`, functions replaced, triggers and
 * policies dropped and made again, notification rows by id, the help section
 * added once. One transaction: if a check fails, nothing here is left behind.
 */

begin;

/* ===================================================== what this stands on === */

do $$
begin
  if to_regclass('public.enquiry_lines') is null or to_regclass('public.enquiries') is null then
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

/* ============================================================== the table === */

/* One proposal per line: proposing again replaces it. The constraints are
   named, and none ends in `_check`, so none collides with an auto-named one. */
create table if not exists enquiry_line_proposals (
  line_id     text primary key references enquiry_lines(id) on delete cascade,
  /* The line's enquiry, so the desk reads a quote's proposals in one ask. */
  enquiry_id  text not null references enquiries(id) on delete cascade,
  partner_id  text not null references partners(id),
  unit_price  numeric(12,2) not null,
  note        text,
  proposed_at timestamptz not null default now(),
  /* Who said it, by name, as the conversation names people. */
  proposed_by text not null,
  constraint enquiry_line_proposals_price_above_nought check (unit_price > 0),
  constraint enquiry_line_proposals_note_length check (note is null or char_length(note) <= 1000)
);

create index if not exists enquiry_line_proposals_enquiry_idx on enquiry_line_proposals(enquiry_id);
create index if not exists enquiry_line_proposals_partner_idx on enquiry_line_proposals(partner_id);

comment on table enquiry_line_proposals is
  'On a desk quote: the unit price the seller of a line proposes to the desk. Advisory; the desk prices the quote. Read by that seller and the desk, never by the buyer. Written only by propose_line_price.';

/* Which transactions are inside `propose_line_price` right now. The same idea
   as `enquiry_rpc_tokens`, kept apart from it: that token tells the guards a
   price is being sent to the buyer, and this write sends nothing. */
create table if not exists enquiry_seller_price_tokens (
  txid bigint primary key
);
alter table enquiry_seller_price_tokens enable row level security;
revoke all on enquiry_seller_price_tokens from public, anon, authenticated;

/* ================================================================ the RLS === */

alter table enquiry_line_proposals enable row level security;

/* Read only, whatever policy is added later. Supabase's default privileges
   grant everything to anon and authenticated, so these are what narrow it. */
revoke all on enquiry_line_proposals from public, anon;
revoke insert, update, delete, truncate on enquiry_line_proposals from authenticated;
grant select on enquiry_line_proposals to authenticated;

drop policy if exists "operator_read_enquiry_line_proposals" on enquiry_line_proposals;
drop policy if exists "partner_read_enquiry_line_proposals" on enquiry_line_proposals;

/* The desk reads them all; it prices every desk quote. */
create policy "operator_read_enquiry_line_proposals" on enquiry_line_proposals for select to authenticated
  using (current_persona() = 'operator');
/* A seller reads its own and nobody else's. The buyer has no policy at all. */
create policy "partner_read_enquiry_line_proposals" on enquiry_line_proposals for select to authenticated
  using (current_persona() = 'partner' and partner_id = current_partner_id());

/* ============================================================== the guard === */

/* Belt and braces under the missing privileges: a write from anybody signed
   in that did not come through propose_line_price is refused in a sentence.
   Not on delete: a proposal goes when its line or enquiry is deleted, by the
   cascade, and no API role holds delete on the table anyway. */
create or replace function guard_line_proposal() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if current_persona() is null then return new; end if;
  if not exists (select 1 from enquiry_seller_price_tokens where txid = txid_current()) then
    raise exception 'A seller''s price is proposed with propose_line_price, never written on its own.';
  end if;
  return new;
end $$;

drop trigger if exists enquiry_line_proposals_guard on enquiry_line_proposals;
create trigger enquiry_line_proposals_guard before insert or update on enquiry_line_proposals
  for each row execute function guard_line_proposal();

/* ============================================================== the floor === */

/* The seller's floor for a listing in a currency, or null when it has none.
   The price book first; the listing's own floor only when the listing is
   priced in that currency and has no price-book row for it. */
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

  select * into v_line from enquiry_lines where id = p_line_id;
  /* Not found and not yours read the same, so the answer says nothing about
     somebody else's line. */
  if v_line.id is null or v_line.partner_id is distinct from v_me then
    raise exception 'That line is not one of yours on a desk quote.';
  end if;

  /* Locked, so the desk sending the quote and the seller proposing cannot
     pass each other: whichever comes second sees the other. */
  select * into v_e from enquiries where id = v_line.enquiry_id for update;
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

  select name into v_seller from partners where id = v_me;

  /* The token, for exactly this write. No exception handler here, so an error
     in the write rolls the token back with it. */
  insert into enquiry_seller_price_tokens (txid) values (txid_current()) on conflict do nothing;
  insert into enquiry_line_proposals (line_id, enquiry_id, partner_id, unit_price, note, proposed_at, proposed_by)
  values (v_line.id, v_e.id, v_me, v_price, v_note, now(), coalesce(v_seller, 'The seller'))
  on conflict (line_id) do update set
    unit_price = excluded.unit_price, note = excluded.note,
    proposed_at = excluded.proposed_at, proposed_by = excluded.proposed_by;
  delete from enquiry_seller_price_tokens where txid = txid_current();

  perform enquiry_send('enquiry.seller_priced', 'operator', 'Enquiries desk', null, null,
    coalesce(v_seller, 'A seller') || ' priced its line on ' || v_e.id,
    coalesce(v_seller, 'A seller') || ' proposes ' || v_e.currency || ' ' || to_char(v_price, 'FM999,999,999,990.00')
      || ' a unit for ' || v_line.name || ' on "' || v_e.subject || '". Use it or not when you send the quote.',
    v_e.id);
end $$;

/**
 * The seller's own lines on desk quotes, with what it needs to know about each
 * quote to price them: its status, subject, currency and needed-by date, its
 * own proposal, and its floor in that currency. Nothing about anybody else's
 * lines, and not the price the desk sent.
 */
create or replace function my_desk_quote_lines()
returns table (line_id text, enquiry_id text, subject text, status text, currency text,
               needed_by date, raised_at timestamptz, product_id text, name text, quantity integer,
               target_unit_price numeric, seller_unit_price numeric, seller_note text,
               seller_priced_at timestamptz, floor_price numeric, sort_order integer)
language sql stable security definer set search_path = public as $$
  select l.id, e.id, e.subject, e.status, e.currency, e.needed_by, e.created_at,
         l.product_id, l.name, l.quantity, l.target_unit_price, p.unit_price, p.note,
         p.proposed_at, enquiry_seller_floor(l.product_id, e.currency), l.sort_order
    from enquiry_lines l
    join enquiries e on e.id = l.enquiry_id
    left join enquiry_line_proposals p on p.line_id = l.id and p.partner_id = l.partner_id
   where current_persona() = 'partner'
     and current_partner_id() is not null
     and l.partner_id = current_partner_id()
     and e.type = 'quote' and e.partner_id is null
   order by e.created_at desc, l.sort_order
$$;

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

/* ================================================================== help === */

/* The seller's enquiries article gains one section, after "What reaches you",
   which says a quote across sellers goes to the desk. Blocks are
   `{kind, heading, text}` objects since 20260809900000 (`z_guard_kb_body`
   refuses anything else). Added once: skipped when the heading is there. */
update kb_articles k
   set body = (
     select jsonb_agg(x.e order by x.ord)
       from (select e, ord::numeric as ord from jsonb_array_elements(k.body) with ordinality t(e, ord)
             union all
             select jsonb_build_object('kind', 'prose', 'heading', 'Your lines on a quote the desk answers',
                      'text', 'When a business asks one quote across your listings and another seller''s, the marketplace desk answers it, and your lines on it are listed under Your lines on quotes the desk is answering. Give the unit price you would charge for each, with a note if it helps; it cannot be below the minimum you agreed for that listing. You can propose until the desk sends the quote, and proposing again replaces what you said. The desk is told, sees your price beside the line and decides what to send. The buyer never sees it.'),
                    coalesce((select t2.ord + 0.5 from jsonb_array_elements(k.body) with ordinality t2(e2, ord)
                               where t2.e2 ->> 'heading' = 'What reaches you' limit 1),
                             jsonb_array_length(k.body) + 1)) x(e, ord))
 where k.view = 'pt-enquiries'
   and jsonb_typeof(k.body) = 'array'
   and not exists (select 1 from jsonb_array_elements(k.body) b
                    where b ->> 'heading' = 'Your lines on a quote the desk answers');

/* ================================================================ grants === */

revoke all on function propose_line_price(text, numeric, text) from public, anon;
grant execute on function propose_line_price(text, numeric, text) to authenticated;
revoke all on function my_desk_quote_lines() from public, anon;
grant execute on function my_desk_quote_lines() to authenticated;
/* Internal: asked by the two above, and by the trigger. */
revoke all on function enquiry_seller_floor(text, text) from public, anon, authenticated;
revoke all on function guard_line_proposal() from public, anon, authenticated;

/* ========================================================== what is true === */

do $$
declare
  n integer;
  t text;
begin
  /* The proposal is not on the line, where the buyer would read it. */
  select count(*) into n from information_schema.columns
   where table_schema = 'public' and table_name = 'enquiry_lines'
     and column_name in ('seller_unit_price', 'seller_note', 'seller_priced_at');
  if n <> 0 then raise exception 'enquiry_lines carries % seller proposal columns; the buyer can read them there', n; end if;

  /* The table: RLS on, read by the seller and the desk, by nobody else, and
     written by no API role. */
  select count(*) into n from pg_class where oid = 'public.enquiry_line_proposals'::regclass and relrowsecurity;
  if n <> 1 then raise exception 'row level security is off on enquiry_line_proposals'; end if;
  select count(*) into n from pg_policies where schemaname = 'public' and tablename = 'enquiry_line_proposals';
  if n <> 2 then raise exception 'enquiry_line_proposals has % policies; it should have the desk''s and the seller''s', n; end if;
  select count(*) into n from pg_policies
   where schemaname = 'public' and tablename = 'enquiry_line_proposals'
     and (cmd <> 'SELECT' or coalesce(qual, '') like '%enterprise%');
  if n <> 0 then raise exception 'enquiry_line_proposals has a policy that writes, or one a buyer could pass'; end if;
  if has_table_privilege('anon', 'public.enquiry_line_proposals', 'select') then
    raise exception 'enquiry_line_proposals can be read signed out';
  end if;
  foreach t in array array['anon', 'authenticated'] loop
    if has_table_privilege(t, 'public.enquiry_line_proposals', 'insert')
       or has_table_privilege(t, 'public.enquiry_line_proposals', 'update')
       or has_table_privilege(t, 'public.enquiry_line_proposals', 'delete') then
      raise exception '% can write enquiry_line_proposals directly', t;
    end if;
  end loop;
  select count(*) into n from pg_trigger
   where tgrelid = 'public.enquiry_line_proposals'::regclass and tgname = 'enquiry_line_proposals_guard' and not tgisinternal;
  if n <> 1 then raise exception 'the proposal guard is not attached'; end if;

  select count(*) into n from pg_constraint
   where conrelid = 'public.enquiry_line_proposals'::regclass
     and conname in ('enquiry_line_proposals_price_above_nought', 'enquiry_line_proposals_note_length');
  if n <> 2 then raise exception 'expected 2 named constraints on enquiry_line_proposals, found %', n; end if;

  /* The token is the definer functions' alone, and nothing is left in it. */
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

  /* Every proposal is the line's own seller's, on a desk quote. */
  select count(*) into n from enquiry_line_proposals p
    join enquiry_lines l on l.id = p.line_id join enquiries e on e.id = l.enquiry_id
   where p.partner_id is distinct from l.partner_id or p.enquiry_id <> l.enquiry_id
      or not (e.type = 'quote' and e.partner_id is null);
  if n > 0 then raise exception '% proposals are not the line seller''s on a desk quote', n; end if;

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

  /* The seller's help says how, once. */
  select count(*) into n from kb_articles k, jsonb_array_elements(k.body) b
   where k.view = 'pt-enquiries' and k.status = 'published'
     and b ->> 'kind' = 'prose' and b ->> 'heading' = 'Your lines on a quote the desk answers'
     and b ->> 'text' like '%until the desk sends the quote%';
  if n <> 1 then raise exception 'the seller''s enquiries article has % sections on desk quotes; it should have one', n; end if;
end $$;

commit;
