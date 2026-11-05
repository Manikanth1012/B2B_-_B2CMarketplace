/* A business can ask before it buys.
 *
 * Until now the only thing a business buyer could do with a listing was add it
 * to a requisition at its list price. Nobody buys four hundred sensors or two
 * hundred seats that way: they ask for a price, they ask to see it working, or
 * they ask somebody a question first. None of that had anywhere to live, so it
 * happened in email, and the marketplace could not see it, route it, or hold
 * anybody to what was said.
 *
 * One record, `enquiries`, with three types and the parts each needs:
 *
 *   quote   lines asked for (and the price the buyer hopes for), priced by
 *           whoever answers, valid until a date, accepted or declined
 *   demo    one listing, a format, a head count, and the times on offer
 *   sales   a question and a preferred way to be answered
 *
 * plus a conversation and an audit trail on every one of them.
 *
 * Who answers. A quote or demo whose lines all belong to one seller goes to that
 * seller. Anything else — two sellers on one quote, a first-party listing, and
 * every Contact Sales enquiry — goes to the operator desk (`partner_id` null).
 * The routing is worked out from the catalogue when the enquiry is raised, by
 * the `raise_*` functions below, never taken from the client; only the operator
 * may change it afterwards, and only with a reason.
 *
 * Accepting a quote. Acceptance is a decision, not a purchase: the quoted lines
 * go into the buyer's requisition at the quoted price, and the approval and
 * order flow that already exists takes it from there. The requisition line
 * carries `quote_line_id`, and `guard_quoted_line` refuses one whose price,
 * product or quantity is not what was accepted, or whose quote has run out. A
 * quoted price the buyer can edit on the way into the requisition is a list
 * price with extra steps.
 *
 * Expiry. There is no scheduler, so nothing flips a quote to "expired". A
 * `quoted` quote whose `valid_until` is before today is expired when read
 * (`enquiry_book.expired`, and `enquiryState()` in `src/lib/enquiries.ts`); the
 * guard refuses to accept it; the seller may re-quote it with a new date.
 *
 * The same rules are mirrored, as pure functions, in `src/lib/enquiries.ts`, so
 * a screen never offers what this file would refuse. This file is the one that
 * decides.
 */

/* ============================================================ the tables === */

create sequence if not exists enquiry_seq start with 1001;

create table if not exists enquiries (
  id             text primary key default ('ENQ-' || nextval('enquiry_seq')),
  type           text not null check (type in ('quote', 'demo', 'sales')),
  account_id     text not null references enterprise_accounts(id) on delete cascade,
  raised_by      text not null references enterprise_users(id),
  /* Null is the operator desk. */
  partner_id     text references partners(id),
  subject        text not null check (char_length(btrim(subject)) between 1 and 120),
  status         text not null,
  /* The account's money. A price with no currency beside it is a number. */
  currency       text references currencies(code),
  needed_by      date,
  valid_until    date,
  format         text,
  attendees      integer,
  contact_pref   text,
  decline_reason text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  decided_at     timestamptz,

  /* Each type has its own vocabulary. A demo cannot be "quoted" and a quote
     cannot be "scheduled", and a check on the pair says so in one place. */
  constraint enquiries_status_check check (
       (type = 'quote' and status in ('submitted', 'quoted', 'accepted', 'declined', 'withdrawn'))
    or (type = 'demo'  and status in ('requested', 'scheduled', 'done', 'declined', 'withdrawn'))
    or (type = 'sales' and status in ('open', 'answered', 'closed'))),
  constraint enquiries_currency_check check (type <> 'quote' or currency is not null),
  constraint enquiries_needed_by_check check (type = 'quote' or needed_by is null),
  /* A quote that has been priced says until when. */
  constraint enquiries_valid_until_check check (
    (type = 'quote' or valid_until is null)
    and (type <> 'quote' or status not in ('quoted', 'accepted') or valid_until is not null)),
  constraint enquiries_format_check check (
       (type = 'demo' and format in ('video', 'onsite'))
    or (type <> 'demo' and format is null)),
  constraint enquiries_attendees_check check (
       (type = 'demo' and attendees between 1 and 500)
    or (type <> 'demo' and attendees is null)),
  constraint enquiries_contact_pref_check check (
       (type = 'sales' and contact_pref in ('email', 'phone', 'in_app'))
    or (type <> 'sales' and contact_pref is null)),
  /* A decline with no reason is the one buyers and sellers both complain
     about, and fairly — neither can act on what they were not told. */
  constraint enquiries_decline_reason_check check (
    status <> 'declined' or coalesce(btrim(decline_reason), '') <> '')
);

create index if not exists enquiries_account_idx on enquiries(account_id, status);
create index if not exists enquiries_partner_idx on enquiries(partner_id, status);

/* What was asked for. On a demo, the one listing being demonstrated. */
create table if not exists enquiry_lines (
  id                text primary key default gen_random_uuid()::text,
  enquiry_id        text not null references enquiries(id) on delete cascade,
  product_id        text not null references products(id),
  name              text not null,
  partner_id        text references partners(id),
  quantity          integer not null check (quantity > 0),
  /* What the buyer hopes to pay. Advisory; nobody is bound by it. */
  target_unit_price numeric(10,2) check (target_unit_price is null or target_unit_price >= 0),
  /* What the responder offers. Null until quoted. Same precision as the
     requisition line it will become, so "equal to the quoted price" is exact. */
  quoted_unit_price numeric(10,2) check (quoted_unit_price is null or quoted_unit_price >= 0),
  sort_order        integer not null default 0
);

create index if not exists enquiry_lines_enquiry_idx on enquiry_lines(enquiry_id);
create index if not exists enquiry_lines_partner_idx on enquiry_lines(partner_id);

/* Times on offer for a demo. Either side proposes; the other confirms. */
create table if not exists enquiry_slots (
  id          text primary key default gen_random_uuid()::text,
  enquiry_id  text not null references enquiries(id) on delete cascade,
  starts_at   timestamptz not null,
  proposed_by text not null check (proposed_by in ('buyer', 'responder')),
  confirmed   boolean not null default false,
  /* A joining link or an address. A confirmed time with nowhere to be is not
     a meeting. */
  location    text,
  created_at  timestamptz not null default now(),
  constraint enquiry_slots_location_check check (not confirmed or coalesce(btrim(location), '') <> '')
);

create index if not exists enquiry_slots_enquiry_idx on enquiry_slots(enquiry_id);
create unique index if not exists enquiry_slots_one_confirmed on enquiry_slots(enquiry_id) where confirmed;

/* The conversation. Insert-only: nobody edits what they said. */
create table if not exists enquiry_messages (
  id          text primary key default gen_random_uuid()::text,
  enquiry_id  text not null references enquiries(id) on delete cascade,
  author_role text not null check (author_role in ('buyer', 'partner', 'operator')),
  author_name text not null,
  body        text not null check (char_length(btrim(body)) >= 1 and char_length(body) <= 4000),
  created_at  timestamptz not null default now()
);

create index if not exists enquiry_messages_enquiry_idx on enquiry_messages(enquiry_id, created_at);

/* What happened, written by the triggers and readable by whoever can read the
   enquiry. Nobody writes to it directly, the operator included. */
create table if not exists enquiry_events (
  id          text primary key default gen_random_uuid()::text,
  enquiry_id  text not null references enquiries(id) on delete cascade,
  actor_role  text not null,
  actor_name  text not null,
  action      text not null,
  from_status text,
  to_status   text,
  note        text,
  at          timestamptz not null default now()
);

/* Which transactions are inside `send_quote` right now. One row per
   transaction, for as long as the function runs; empty otherwise.

   The guards need to know that a price or a move to `quoted` came from
   `send_quote` and not from a client writing the row itself. A session setting
   cannot say so: any client can call `set_config` with the same name. A row in
   a table nobody but the definer functions can write can. So RLS is on with no
   policy at all, and every privilege is taken away from the API roles — the
   security-definer functions, owned by whoever runs this migration, are the
   only things that ever touch it.

   `txid_current()` is the 64-bit, epoch-extended id of the top-level
   transaction, so it never repeats and a savepoint inside the same
   transaction still sees its own row. */
create table if not exists enquiry_rpc_tokens (
  txid bigint primary key
);
alter table enquiry_rpc_tokens enable row level security;
revoke all on enquiry_rpc_tokens from public, anon, authenticated;

create index if not exists enquiry_events_enquiry_idx on enquiry_events(enquiry_id, at);

/* Expiry applied on read. `security_invoker`, so it shows exactly the rows the
   reader could already select from `enquiries` and nothing more. */
create or replace view enquiry_book with (security_invoker = on) as
  select e.*,
         coalesce(e.type = 'quote' and e.status = 'quoted' and e.valid_until < current_date, false) as expired
    from enquiries e;

/* ============================================================== helpers === */

/* The caller as a member of a buying account, or a sentence saying why not.
   Active only: a suspended or invited member cannot ask on the account's behalf. */
create or replace function enquiry_buyer() returns enterprise_users
language plpgsql stable security definer set search_path = public as $$
declare v_me enterprise_users;
begin
  if current_persona() is distinct from 'enterprise' then
    raise exception 'Only a signed-in business buyer can raise an enquiry.';
  end if;
  select * into v_me from enterprise_users
   where user_id = auth.uid() and account_id = current_account_id() and status = 'active'
   order by sort_order limit 1;
  if v_me.id is null then
    raise exception 'You are not an active member of a business account, so you cannot raise an enquiry.';
  end if;
  return v_me;
end $$;

/* The subject, in a sentence rather than a constraint name when it is wrong. */
create or replace function enquiry_subject(p_subject text) returns text
language plpgsql immutable as $$
begin
  if nullif(btrim(coalesce(p_subject, '')), '') is null then
    raise exception 'Give the enquiry a subject.';
  end if;
  if char_length(btrim(p_subject)) > 120 then
    raise exception 'Keep the subject to 120 characters.';
  end if;
  return btrim(p_subject);
end $$;

/* Who the caller is, by name, for the conversation and the audit trail. */
create or replace function enquiry_actor_name() returns text
language sql stable security definer set search_path = public as $$
  select case current_persona()
    when 'enterprise' then coalesce(
      (select u.name from enterprise_users u
        where u.user_id = auth.uid() and u.account_id = current_account_id()
        order by u.sort_order limit 1), 'A buyer')
    when 'partner' then coalesce(
      (select p.name from partners p where p.id = current_partner_id()), 'The seller')
    when 'operator' then coalesce(
      (select ou.name from operator_users ou join auth.users au on lower(au.email) = lower(ou.email)
        where au.id = auth.uid() limit 1), 'Enquiries desk')
    else 'Marketplace' end
$$;

create or replace function enquiry_actor_role() returns text
language sql stable security definer set search_path = public as $$
  select case current_persona()
    when 'enterprise' then 'buyer'
    when 'partner' then 'partner'
    when 'operator' then 'operator'
    else 'system' end
$$;

/* Asked by the policies. `security definer` because a seller on a desk-routed
   quote cannot read the enquiry itself and still has to be shown its own lines;
   a policy that asked `enquiries` directly would see nothing and say no. Both
   return a yes or no about the caller, never anybody's data. */
create or replace function enquiry_routed_to_me(p_enquiry text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select e.partner_id = current_partner_id() from enquiries e where e.id = p_enquiry), false)
$$;

create or replace function enquiry_is_desk_quote(p_enquiry text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select e.type = 'quote' and e.partner_id is null from enquiries e where e.id = p_enquiry), false)
$$;

/* The transition table, once. `src/lib/enquiries.ts` (`canTransition`) holds the
   same rows; the role here is 'buyer' or 'responder' — the operator answering a
   desk-routed enquiry is the responder. */
create or replace function enquiry_transition_allowed(p_type text, p_from text, p_to text, p_role text)
returns boolean language sql immutable as $$
  select case p_type
    when 'quote' then
         (p_from = 'submitted' and p_to = 'quoted'    and p_role = 'responder')
      or (p_from = 'quoted'    and p_to = 'quoted'    and p_role = 'responder')
      or (p_from in ('submitted', 'quoted') and p_to = 'declined' and p_role = 'responder')
      or (p_from = 'quoted'    and p_to in ('accepted', 'declined') and p_role = 'buyer')
      or (p_from in ('submitted', 'quoted') and p_to = 'withdrawn' and p_role = 'buyer')
    when 'demo' then
         /* Whoever did not propose the slot confirms it — either side. */
         (p_from = 'requested' and p_to = 'scheduled' and p_role in ('buyer', 'responder'))
      or (p_from in ('requested', 'scheduled') and p_to = 'declined'  and p_role = 'responder')
      or (p_from in ('requested', 'scheduled') and p_to = 'withdrawn' and p_role = 'buyer')
      or (p_from = 'scheduled' and p_to = 'done' and p_role = 'responder')
    when 'sales' then
         (p_from = 'open'     and p_to = 'answered' and p_role = 'responder')
      or (p_from = 'answered' and p_to = 'open'     and p_role = 'buyer')
      or (p_from in ('open', 'answered') and p_to = 'closed' and p_role in ('buyer', 'responder'))
    else false end
$$;

create or replace function enquiry_is_terminal(p_type text, p_status text)
returns boolean language sql immutable as $$
  select case p_type
    when 'quote' then p_status in ('accepted', 'declined', 'withdrawn')
    when 'demo'  then p_status in ('done', 'declined', 'withdrawn')
    when 'sales' then p_status = 'closed'
    else false end
$$;

/* ========================================================= raising one === */

/**
 * Ask for a price on one or more listings.
 *
 * `p_lines` is `[{ "product_id": "SKU-5004", "quantity": 120, "target_unit_price": 3800 }]`.
 * The name, the seller and therefore the routing come from the catalogue, the
 * currency from the account and the asker from the caller's membership — none
 * of them from the client.
 */
create or replace function raise_quote(p_subject text, p_lines jsonb,
                                       p_needed_by date default null, p_note text default null)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_me       enterprise_users := enquiry_buyer();
  v_currency text;
  v_id       text;
  v_partner  text;
  v_bad      text;
  v_count    integer;
  v_sellers  integer;
  v_firstpty integer;
  v_line     jsonb;
  v_qty      integer;
  v_target   numeric;
  v_n        integer := 0;
begin
  if not v_me.can_raise then
    raise exception '% cannot raise on this account, so cannot ask for a quote either.', v_me.name;
  end if;
  /* Two tests, not one `or`: SQL does not promise to stop at the first, and
     the length of something that is not an array is an error, not a zero. */
  if jsonb_typeof(p_lines) is distinct from 'array' then
    raise exception 'A quote needs at least one line.';
  end if;
  if jsonb_array_length(p_lines) = 0 then
    raise exception 'A quote needs at least one line.';
  end if;
  if jsonb_array_length(p_lines) > 50 then
    raise exception 'A quote can carry at most 50 lines.';
  end if;
  if p_needed_by is not null and p_needed_by < current_date then
    raise exception 'The needed-by date has already passed.';
  end if;

  /* Every line names a listing a business can buy. */
  select string_agg(coalesce(x->>'product_id', '(none)'), ', ') into v_bad
    from jsonb_array_elements(p_lines) x
    left join products p on p.id = x->>'product_id'
   where p.id is null or p.status <> 'live' or not ('enterprise' = any(p.audiences));
  if v_bad is not null then
    raise exception 'These are not listings a business can ask about: %', v_bad;
  end if;

  /* The routing rule: one seller across every line, or the desk. */
  select count(*), count(distinct p.partner_id), count(*) filter (where p.partner_id is null)
    into v_count, v_sellers, v_firstpty
    from jsonb_array_elements(p_lines) x join products p on p.id = x->>'product_id';
  if v_sellers = 1 and v_firstpty = 0 then
    select p.partner_id into v_partner
      from jsonb_array_elements(p_lines) x join products p on p.id = x->>'product_id' limit 1;
  end if;

  select a.currency into v_currency from enterprise_accounts a where a.id = v_me.account_id;

  insert into enquiries (type, account_id, raised_by, partner_id, subject, status, currency, needed_by)
  values ('quote', v_me.account_id, v_me.id, v_partner, enquiry_subject(p_subject), 'submitted', v_currency, p_needed_by)
  returning id into v_id;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_n := v_n + 1;
    v_qty := (v_line->>'quantity')::integer;
    if v_qty is null or v_qty <= 0 then
      raise exception 'Line % asks for % — a quantity has to be a whole number above zero.', v_n, coalesce(v_line->>'quantity', 'nothing');
    end if;
    v_target := nullif(v_line->>'target_unit_price', '')::numeric;
    if v_target is not null and v_target < 0 then
      raise exception 'Line % has a target price below zero.', v_n;
    end if;
    insert into enquiry_lines (enquiry_id, product_id, name, partner_id, quantity, target_unit_price, sort_order)
    select v_id, p.id, p.name, p.partner_id, v_qty, v_target, v_n
      from products p where p.id = v_line->>'product_id';
  end loop;

  if nullif(btrim(coalesce(p_note, '')), '') is not null then
    insert into enquiry_messages (enquiry_id, author_role, author_name, body)
    values (v_id, 'buyer', v_me.name, btrim(p_note));
  end if;

  return v_id;
end $$;

/**
 * Ask to see one listing working, at one of up to three times.
 *
 * Offered where a demonstration means something: anything sold on a
 * subscription, and IoT and security hardware (`demoOffered` in the pure module
 * says the same).
 */
create or replace function raise_demo(p_subject text, p_product_id text, p_format text,
                                      p_attendees integer, p_slots timestamptz[], p_note text default null)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_me       enterprise_users := enquiry_buyer();
  v_product  products;
  v_currency text;
  v_id       text;
  v_slot     timestamptz;
begin
  if not v_me.can_raise then
    raise exception '% cannot raise on this account, so cannot book a demo either.', v_me.name;
  end if;

  select * into v_product from products where id = p_product_id;
  if v_product.id is null or v_product.status <> 'live' or not ('enterprise' = any(v_product.audiences)) then
    raise exception '% is not a listing a business can ask about.', coalesce(p_product_id, 'That');
  end if;
  if v_product.model = 'oneoff' and v_product.category_id not in ('iot', 'security') then
    raise exception '% is not offered as a demo — ask for a quote instead.', v_product.name;
  end if;
  if p_format is null or p_format not in ('video', 'onsite') then
    raise exception 'A demo is either by video or on site.';
  end if;
  if p_attendees is null or p_attendees not between 1 and 500 then
    raise exception 'Say how many will attend, between 1 and 500.';
  end if;
  if coalesce(array_length(p_slots, 1), 0) not between 1 and 3 then
    raise exception 'Offer between one and three times.';
  end if;
  foreach v_slot in array p_slots loop
    if v_slot is null or v_slot <= now() then
      raise exception 'Every time offered has to be in the future.';
    end if;
  end loop;
  if (select count(distinct s) from unnest(p_slots) s) <> array_length(p_slots, 1) then
    raise exception 'The same time is offered twice.';
  end if;

  select a.currency into v_currency from enterprise_accounts a where a.id = v_me.account_id;

  insert into enquiries (type, account_id, raised_by, partner_id, subject, status, currency, format, attendees)
  values ('demo', v_me.account_id, v_me.id, v_product.partner_id, enquiry_subject(p_subject), 'requested',
          v_currency, p_format, p_attendees)
  returning id into v_id;

  insert into enquiry_lines (enquiry_id, product_id, name, partner_id, quantity, sort_order)
  values (v_id, v_product.id, v_product.name, v_product.partner_id, 1, 1);

  foreach v_slot in array p_slots loop
    insert into enquiry_slots (enquiry_id, starts_at, proposed_by) values (v_id, v_slot, 'buyer');
  end loop;

  if nullif(btrim(coalesce(p_note, '')), '') is not null then
    insert into enquiry_messages (enquiry_id, author_role, author_name, body)
    values (v_id, 'buyer', v_me.name, btrim(p_note));
  end if;

  return v_id;
end $$;

/**
 * A word with sales. Always the desk; anybody active on the account may ask,
 * including members who cannot raise — asking is not spending.
 */
create or replace function raise_sales(p_subject text, p_message text, p_contact_pref text)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_me       enterprise_users := enquiry_buyer();
  v_currency text;
  v_id       text;
begin
  if p_contact_pref is null or p_contact_pref not in ('email', 'phone', 'in_app') then
    raise exception 'Say how you would like to be answered: email, phone or in the app.';
  end if;
  if nullif(btrim(coalesce(p_message, '')), '') is null then
    raise exception 'Say what you would like to ask.';
  end if;

  select a.currency into v_currency from enterprise_accounts a where a.id = v_me.account_id;

  insert into enquiries (type, account_id, raised_by, partner_id, subject, status, currency, contact_pref)
  values ('sales', v_me.account_id, v_me.id, null, enquiry_subject(p_subject), 'open', v_currency, p_contact_pref)
  returning id into v_id;

  insert into enquiry_messages (enquiry_id, author_role, author_name, body)
  values (v_id, 'buyer', v_me.name, btrim(p_message));

  return v_id;
end $$;

/**
 * Hand an enquiry to a seller, or back to the desk, with the reason on record.
 *
 * The reason travels to `guard_enquiry` in a transaction-local setting, and the
 * guard refuses a change of `partner_id` without one — so a reassignment that
 * skipped this function and wrote the column directly is refused rather than
 * recorded with a blank where the reason should be.
 */
create or replace function reassign_enquiry(p_id text, p_partner_id text, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if current_persona() is distinct from 'operator' then
    raise exception 'Only the marketplace can pass an enquiry to somebody else.';
  end if;
  if nullif(btrim(coalesce(p_reason, '')), '') is null then
    raise exception 'Say why it is being reassigned — the buyer and the seller will both read it.';
  end if;
  if p_partner_id is not null and not exists (select 1 from partners where id = p_partner_id) then
    raise exception 'There is no seller %.', p_partner_id;
  end if;
  if not exists (select 1 from enquiries where id = p_id) then
    raise exception 'There is no enquiry %.', p_id;
  end if;
  if exists (select 1 from enquiries where id = p_id and partner_id is not distinct from p_partner_id) then
    raise exception '% is already with %.', p_id, coalesce(p_partner_id, 'the desk');
  end if;
  perform set_config('enquiry.reason', btrim(p_reason), true);
  update enquiries set partner_id = p_partner_id where id = p_id;
  perform set_config('enquiry.reason', '', true);
end $$;

/**
 * Send a quote, or send it again. The only way a price is ever set.
 *
 * `p_prices` is `{ "<line id>": 3899.00, ... }` and must price every line on
 * the quote. In one transaction it writes the prices, dates the quote 1 to 90
 * days ahead, moves it submitted -> quoted (or re-quotes a quoted one), and
 * through the guards writes 'quoted' or 'requoted' to the trail and tells the
 * buyer. A note, if given, goes into the conversation.
 *
 * The guards refuse a price or a move to `quoted` made any other way: they
 * look for this transaction's row in `enquiry_rpc_tokens`, which only this
 * function writes and no client can. So what the buyer accepts is always a set
 * of prices that were sent to them together, with a date, and recorded.
 *
 * A price is held as numeric(10,2), so the most a unit can be quoted at is
 * 99,999,999.99. Anything above it is refused here with a sentence rather
 * than reaching the column as "numeric field overflow".
 */
create or replace function send_quote(p_id text, p_prices jsonb, p_valid_until date, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_persona text := current_persona();
  v_e       enquiries;
  v_bad     text;
begin
  select * into v_e from enquiries where id = p_id for update;
  if v_e.id is null then
    raise exception 'There is no enquiry %.', p_id;
  end if;
  if not ((v_persona = 'partner' and current_partner_id() is not null and v_e.partner_id = current_partner_id())
          or (v_persona = 'operator' and v_e.partner_id is null)) then
    raise exception '% is not yours to quote.', p_id;
  end if;
  if v_e.type <> 'quote' then
    raise exception '% is a %, not a quote.', p_id, v_e.type;
  end if;
  if v_e.status not in ('submitted', 'quoted') then
    raise exception '% is %, so it cannot be quoted.', p_id, v_e.status;
  end if;
  if p_valid_until is null or p_valid_until < current_date + 1 or p_valid_until > current_date + 90 then
    raise exception 'A quote has to be valid for between 1 and 90 days from today.';
  end if;
  if jsonb_typeof(p_prices) is distinct from 'object' then
    raise exception 'Give a price for every line.';
  end if;

  /* Every key is a line of this quote ... */
  select string_agg(k, ', ') into v_bad
    from jsonb_object_keys(p_prices) k
   where not exists (select 1 from enquiry_lines l where l.id = k and l.enquiry_id = p_id);
  if v_bad is not null then
    raise exception 'These are not lines of %: %', p_id, v_bad;
  end if;
  /* ... every line has a key ... */
  select string_agg(l.name, ', ' order by l.sort_order) into v_bad
    from enquiry_lines l where l.enquiry_id = p_id and not (p_prices ? l.id);
  if v_bad is not null then
    raise exception 'Price every line before sending the quote. Missing: %', v_bad;
  end if;
  /* ... every value is a number, nought or more ... (The cast is inside the
     case so a string is reported as unusable, not as a failed cast.) */
  select string_agg(l.name, ', ' order by l.sort_order) into v_bad
    from jsonb_each(p_prices) as x(k, v) join enquiry_lines l on l.id = x.k
   where case when jsonb_typeof(v) = 'number' then (v #>> '{}')::numeric < 0 else true end;
  if v_bad is not null then
    raise exception 'These lines have no usable price: %', v_bad;
  end if;
  /* ... and fits the column. Rounded first, because 99999999.995 rounds up
     past the limit on the way in. */
  select string_agg(l.name, ', ' order by l.sort_order) into v_bad
    from jsonb_each(p_prices) as x(k, v) join enquiry_lines l on l.id = x.k
   where round((v #>> '{}')::numeric, 2) > 99999999.99;
  if v_bad is not null then
    raise exception 'A unit price can be at most 99,999,999.99. These lines are over it: %', v_bad;
  end if;

  /* The token says "this transaction is inside send_quote" to the guards on
     enquiry_lines and enquiries, and to notify_enquiry, for exactly the two
     writes below. It is deleted straight after them.

     On the error path nothing deletes it explicitly, and nothing needs to:
     this function has no exception handler, so any error raised by the writes
     (a guard refusing, a constraint) propagates and rolls back the statement —
     or the caller's savepoint — and the insert of the token with it. A row
     that was never committed cannot be seen by anybody, and it is gone from
     this transaction too. So the token exists only while these writes run.

     `on conflict do nothing` because a second call in the same transaction
     would find its own row; send_quote does not call itself, so the delete
     below never removes a row another call is still relying on. */
  insert into enquiry_rpc_tokens (txid) values (txid_current()) on conflict do nothing;

  update enquiry_lines l set quoted_unit_price = (p_prices ->> l.id)::numeric
   where l.enquiry_id = p_id;
  update enquiries set status = 'quoted', valid_until = p_valid_until where id = p_id;

  delete from enquiry_rpc_tokens where txid = txid_current();

  if nullif(btrim(coalesce(p_note, '')), '') is not null then
    insert into enquiry_messages (enquiry_id, author_role, author_name, body)
    values (p_id, 'partner', 'pending', btrim(p_note));   -- author derived by the guard
  end if;
end $$;

/* ============================================================ the guards === */

/**
 * What may happen to an enquiry, and who may make it happen.
 *
 * The caller's part comes from who they are, never from the row: the business
 * that asked is the buyer; the seller it is routed to is the responder; the
 * operator is the responder on anything routed to the desk, and on a seller's
 * enquiry may reassign it and nothing else. Then the transition table decides,
 * and on top of it the rules a table cannot express:
 *
 *   quoted     every line priced, and valid for 1 to 90 days from today
 *   accepted   by somebody who can raise, and not after the quote ran out
 *   scheduled  a slot confirmed by the side that did not propose it
 *   declined   with a reason
 *
 * What was asked — the type, the account, the asker, the subject and the
 * particulars — does not change once asked. Every move of status, every
 * re-quote and every reassignment is written to `enquiry_events`.
 *
 * A null persona is a migration or the service role. It is not a party to the
 * enquiry, so it is not held to the table — but what it changes is still
 * written down.
 */
create or replace function guard_enquiry() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_persona text := current_persona();
  v_role    text;
  v_me      enterprise_users;
  v_action  text;
  v_note    text;
  v_moved   boolean;
  v_requote boolean;
begin
  if tg_op = 'INSERT' then
    if v_persona is null then return new; end if;
    /* Raised through `raise_*`, or by the operator. Either way it starts at the
       beginning, unpriced and undecided. */
    /* The CASE is in parentheses on purpose: PL/pgSQL ends an IF condition at
       the first THEN it meets, and without them that would be the CASE's own. */
    if new.status is distinct from (case new.type when 'quote' then 'submitted'
                                                 when 'demo' then 'requested'
                                                 when 'sales' then 'open' end) then
      raise exception 'A % enquiry starts as %, not %.', new.type,
        case new.type when 'quote' then 'submitted' when 'demo' then 'requested' else 'open' end, new.status;
    end if;
    new.valid_until := null;
    new.decline_reason := null;
    new.decided_at := null;
    new.created_at := now();
    new.updated_at := now();
    return new;
  end if;

  new.updated_at := now();
  v_moved := new.status is distinct from old.status;
  /* A re-quote is `send_quote` on a quote that is already quoted, whether or
     not the date moved: the prices may have. */
  v_requote := not v_moved and new.status = 'quoted'
               and (new.valid_until is distinct from old.valid_until
                    or exists (select 1 from enquiry_rpc_tokens where txid = txid_current()));

  if v_persona is not null then
    /* --------------------------------------------------- who is asking -- */
    if v_persona = 'enterprise' then
      if old.account_id is distinct from current_account_id() then
        raise exception '% belongs to another account.', old.id;
      end if;
      select * into v_me from enterprise_users
       where user_id = auth.uid() and account_id = old.account_id and status = 'active'
       order by sort_order limit 1;
      if v_me.id is null then
        raise exception 'You are not an active member of this account.';
      end if;
      v_role := 'buyer';
    elsif v_persona = 'partner' then
      if current_partner_id() is null or old.partner_id is distinct from current_partner_id() then
        raise exception '% is not routed to you.', old.id;
      end if;
      v_role := 'responder';
    elsif v_persona = 'operator' then
      v_role := case when old.partner_id is null then 'responder' else 'operator' end;
    else
      raise exception 'Only the business that asked, the seller it went to, or the marketplace can change an enquiry.';
    end if;

    /* ------------------------------------------- what was asked stays -- */
    if new.id is distinct from old.id or new.type is distinct from old.type
       or new.account_id is distinct from old.account_id or new.raised_by is distinct from old.raised_by
       or new.subject is distinct from old.subject or new.currency is distinct from old.currency
       or new.needed_by is distinct from old.needed_by or new.format is distinct from old.format
       or new.attendees is distinct from old.attendees or new.contact_pref is distinct from old.contact_pref
       or new.created_at is distinct from old.created_at then
      raise exception 'What was asked on % cannot be changed once asked — withdraw it and ask again.', old.id;
    end if;

    /* --------------------------------------------------- reassignment -- */
    if new.partner_id is distinct from old.partner_id then
      if v_persona <> 'operator' then
        raise exception 'Only the marketplace can pass % to somebody else.', old.id;
      end if;
      if enquiry_is_terminal(old.type, old.status) then
        raise exception '% is already %, so there is nobody left to pass it to.', old.id, old.status;
      end if;
      if v_moved or new.valid_until is distinct from old.valid_until or new.decline_reason is distinct from old.decline_reason then
        raise exception 'Reassign % on its own, then let whoever has it answer.', old.id;
      end if;
      v_note := nullif(btrim(coalesce(current_setting('enquiry.reason', true), '')), '');
      if v_note is null then
        raise exception 'Say why % is being reassigned (use reassign_enquiry).', old.id;
      end if;
    end if;

    /* ------------------------------------------------------ the moves -- */
    if v_moved or v_requote or new.valid_until is distinct from old.valid_until then
      if v_role = 'operator' then
        raise exception '% is the seller''s to answer. Reassign it to the desk first.', old.id;
      end if;

      /* Only quoting sets the date, and only the responder quotes. */
      if new.valid_until is distinct from old.valid_until and not (v_role = 'responder' and new.status = 'quoted') then
        raise exception 'The valid-until date is set by quoting, not on its own.';
      end if;

      if not enquiry_transition_allowed(old.type, old.status, new.status, v_role) then
        raise exception 'A % cannot go from % to % by the %.', old.type, old.status, new.status, v_role;
      end if;

      if new.status = 'quoted' then
        /* Quoting and re-quoting go through `send_quote`, which prices the
           lines and moves the quote in one transaction. A quote moved here on
           its own would be a quote the buyer saw priced by whatever happened
           to be on the lines. */
        if not exists (select 1 from enquiry_rpc_tokens where txid = txid_current()) then
          raise exception 'A quote is sent with send_quote, which prices every line and dates it in one step.';
        end if;
        if new.valid_until is null or new.valid_until < current_date + 1 or new.valid_until > current_date + 90 then
          raise exception 'A quote has to be valid for between 1 and 90 days from today.';
        end if;
        if not exists (select 1 from enquiry_lines where enquiry_id = old.id) then
          raise exception '% has no lines to price.', old.id;
        end if;
        if exists (select 1 from enquiry_lines where enquiry_id = old.id and quoted_unit_price is null) then
          raise exception 'Price every line on % before sending the quote.', old.id;
        end if;
      end if;

      if v_role = 'buyer' and old.type = 'quote' and new.status in ('accepted', 'declined') and not v_me.can_raise then
        raise exception '% cannot raise on this account, so cannot decide a quote.', v_me.name;
      end if;

      if new.status = 'accepted' and old.valid_until < current_date then
        raise exception 'This quote ran out on %. Ask for it to be re-quoted.', to_char(old.valid_until, 'DD Mon YYYY');
      end if;
      /* What is accepted is what was sent: every line still priced. */
      if new.status = 'accepted' and exists (
           select 1 from enquiry_lines where enquiry_id = old.id and quoted_unit_price is null) then
        raise exception '% has a line with no price on it, so it cannot be accepted. Ask for it to be re-quoted.', old.id;
      end if;

      if new.status = 'scheduled' and not exists (
           select 1 from enquiry_slots s
            where s.enquiry_id = old.id and s.confirmed and s.proposed_by <> v_role) then
        raise exception 'A demo is scheduled by confirming a time the other side proposed.';
      end if;
    end if;

    if new.decline_reason is distinct from old.decline_reason and not (v_moved and new.status = 'declined') then
      raise exception 'A decline reason is given when declining, not afterwards.';
    end if;
    if v_moved and new.status = 'declined' and coalesce(btrim(new.decline_reason), '') = '' then
      raise exception 'Say why % is being declined.', old.id;
    end if;
  else
    v_note := nullif(btrim(coalesce(current_setting('enquiry.reason', true), '')), '');
  end if;

  /* ----------------------------------------------------------- stamps -- */
  if v_moved and enquiry_is_terminal(new.type, new.status) and not enquiry_is_terminal(old.type, old.status) then
    new.decided_at := now();
  elsif v_persona is not null then
    new.decided_at := old.decided_at;
  end if;

  /* ------------------------------------------------------ the record -- */
  if new.partner_id is distinct from old.partner_id then
    insert into enquiry_events (enquiry_id, actor_role, actor_name, action, from_status, to_status, note)
    values (old.id, enquiry_actor_role(), enquiry_actor_name(),
            case when new.partner_id is null then 'reassigned to the desk'
                 else 'reassigned to ' || coalesce((select name from partners where id = new.partner_id), new.partner_id) end,
            old.status, new.status, v_note);
  end if;

  if v_moved or v_requote then
    v_action := case
      when v_requote then 'requoted'
      when new.status = 'open' and old.status = 'answered' then 'reopened'
      else new.status end;
    insert into enquiry_events (enquiry_id, actor_role, actor_name, action, from_status, to_status, note)
    values (old.id, enquiry_actor_role(), enquiry_actor_name(), v_action, old.status, new.status,
            case when new.status = 'declined' then new.decline_reason
                 when new.status = 'quoted' then 'Valid until ' || to_char(new.valid_until, 'DD Mon YYYY')
                 else null end);
  end if;

  return new;
end $$;

drop trigger if exists enquiries_guard on enquiries;
create trigger enquiries_guard before insert or update on enquiries
  for each row execute function guard_enquiry();

/* The first line of every audit trail. After insert, because the event points
   at the enquiry and the enquiry has to exist first. */
create or replace function record_enquiry_raised() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into enquiry_events (enquiry_id, actor_role, actor_name, action, from_status, to_status, note, at)
  values (new.id, enquiry_actor_role(), enquiry_actor_name(), 'raised', null, new.status,
          case when new.partner_id is null then 'Routed to the desk'
               else 'Routed to ' || coalesce((select name from partners where id = new.partner_id), new.partner_id) end,
          new.created_at);
  return null;
end $$;

drop trigger if exists enquiries_record_raised on enquiries;
create trigger enquiries_record_raised after insert on enquiries
  for each row execute function record_enquiry_raised();

/**
 * What a line may have done to it after it was asked for.
 *
 * The buyer owns what was asked — the quantity and the price they hope for —
 * and may change it while nobody has answered yet. The responder owns the
 * price they offer, and sets it only through `send_quote`, while the quote is
 * open (submitted or quoted). Neither may write the other's column, and nobody renames a line or
 * points it at a different listing: a quote for one thing that quietly becomes
 * a quote for another is not the quote anybody answered.
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
    return new;
  end if;

  if new.id is distinct from old.id or new.enquiry_id is distinct from old.enquiry_id
     or new.product_id is distinct from old.product_id or new.name is distinct from old.name
     or new.partner_id is distinct from old.partner_id or new.sort_order is distinct from old.sort_order then
    raise exception 'A line names what was asked for, and that does not change.';
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
      /* Prices move only inside `send_quote`, which re-dates the quote, writes
         it to the trail and tells the buyer. A price changed on its own is a
         price the buyer may accept without ever having been shown it. */
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

/**
 * The times on offer for a demo.
 *
 * Either side may propose a time; whoever did not propose it may confirm it.
 * The side proposing is taken from who is asking, never from the row. Either
 * side proposes only while the demo is requested, and has at most three
 * unconfirmed future times on offer at once.
 *
 * A confirmed time needs a joining link or an address. The responder gives it
 * when confirming a buyer's time, or when proposing their own — so a buyer
 * confirming a seller's time confirms the place the seller named and cannot
 * change it. At most one time is confirmed, and confirming it schedules the
 * demo (`slot_confirms_demo`, after the row is written).
 */
create or replace function guard_enquiry_slot() returns trigger
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
  else
    raise exception 'The times on % are not yours to change.', v_e.id;
  end if;

  if tg_op = 'INSERT' then
    if v_e.type <> 'demo' then
      raise exception 'Only a demo has times.';
    end if;
    /* Times are proposed while the demo is being arranged. Once it is
       scheduled the time is fixed: withdraw, decline, or talk it through. */
    if v_e.status <> 'requested' then
      raise exception '% is %, so a new time cannot be proposed on it.', v_e.id, v_e.status;
    end if;
    if new.starts_at is null or new.starts_at <= now() then
      raise exception 'A time proposed has to be in the future.';
    end if;
    /* Three open offers a side, the most anybody can weigh at once.
       The enquiry row is locked first, so two proposals sent at the same
       moment are counted one after the other: the second waits for the first
       to commit and then sees it, instead of both counting two and both
       going in. */
    perform 1 from enquiries where id = v_e.id for update;
    if (select count(*) from enquiry_slots
         where enquiry_id = v_e.id and proposed_by = v_role and not confirmed and starts_at > now()) >= 3 then
      raise exception 'You already have three times on offer for %. Wait for an answer, or say in the conversation which to drop.', v_e.id;
    end if;
    new.proposed_by := v_role;
    new.confirmed := false;
    new.created_at := now();
    return new;
  end if;

  if new.id is distinct from old.id or new.enquiry_id is distinct from old.enquiry_id
     or new.starts_at is distinct from old.starts_at or new.proposed_by is distinct from old.proposed_by
     or new.created_at is distinct from old.created_at then
    raise exception 'A time proposed stays as proposed. Propose another instead.';
  end if;

  if old.confirmed then
    if not new.confirmed then
      raise exception 'A confirmed time is not un-confirmed. Decline or withdraw the demo, or agree another time in the conversation.';
    end if;
    if new.location is distinct from old.location then
      raise exception 'The place of a confirmed demo is not changed afterwards. Say so in the conversation.';
    end if;
    return new;
  end if;

  if not new.confirmed then
    /* An unconfirmed time: only its proposer may say where it would be. */
    if new.location is distinct from old.location and v_role <> old.proposed_by then
      raise exception 'Only the side that proposed this time can say where it would be.';
    end if;
    return new;
  end if;

  /* Confirming. */
  if v_role = old.proposed_by then
    raise exception 'A time is confirmed by the other side — whoever proposed it cannot confirm it too.';
  end if;
  if v_e.status <> 'requested' then
    raise exception '% is %, so a time cannot be confirmed on it.', v_e.id, v_e.status;
  end if;
  if old.starts_at <= now() then
    raise exception 'That time has already passed.';
  end if;
  if v_role = 'buyer' and new.location is distinct from old.location then
    raise exception 'The joining link or address comes from the seller who proposed this time.';
  end if;
  if coalesce(btrim(new.location), '') = '' then
    if v_role = 'buyer' then
      raise exception 'The seller gave no joining link or address with this time, so it cannot be confirmed yet. Ask them in the conversation.';
    end if;
    raise exception 'Give a joining link or an address to confirm this time.';
  end if;
  return new;
end $$;

drop trigger if exists enquiry_slots_guard on enquiry_slots;
create trigger enquiry_slots_guard before insert or update on enquiry_slots
  for each row execute function guard_enquiry_slot();

create or replace function slot_confirms_demo() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.confirmed and not old.confirmed then
    update enquiries set status = 'scheduled' where id = new.enquiry_id and status = 'requested';
  end if;
  return null;
end $$;

drop trigger if exists enquiry_slots_confirm on enquiry_slots;
create trigger enquiry_slots_confirm after update on enquiry_slots
  for each row execute function slot_confirms_demo();

/**
 * The conversation.
 *
 * Who wrote a message is taken from who is signed in — a client that sends
 * `author_role: 'operator'` is a buyer pretending to be the marketplace, and is
 * written down as the buyer. Nothing is edited once sent. A closed sales
 * enquiry takes no more messages; ask again instead.
 */
create or replace function guard_enquiry_message() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_persona text := current_persona();
  v_e       enquiries;
begin
  if v_persona is null then return new; end if;

  if tg_op = 'UPDATE' then
    raise exception 'A message is not edited once it has been sent.';
  end if;

  select * into v_e from enquiries where id = new.enquiry_id;
  if v_e.id is null then
    raise exception 'There is no enquiry %.', new.enquiry_id;
  end if;
  if v_e.type = 'sales' and v_e.status = 'closed' then
    raise exception '% is closed. Contact sales again to start a new conversation.', v_e.id;
  end if;

  if v_persona = 'enterprise' and v_e.account_id = current_account_id() then
    if not exists (select 1 from enterprise_users
                    where user_id = auth.uid() and account_id = v_e.account_id and status = 'active') then
      raise exception 'You are not an active member of this account.';
    end if;
    new.author_role := 'buyer';
  elsif v_persona = 'partner' and v_e.partner_id = current_partner_id() then
    new.author_role := 'partner';
  elsif v_persona = 'operator' then
    new.author_role := 'operator';
  else
    raise exception 'That conversation is not yours to join.';
  end if;

  new.author_name := enquiry_actor_name();
  new.created_at := now();
  return new;
end $$;

drop trigger if exists enquiry_messages_guard on enquiry_messages;
create trigger enquiry_messages_guard before insert or update on enquiry_messages
  for each row execute function guard_enquiry_message();

/* On a sales enquiry the conversation is the state: the responder's reply
   answers it and the buyer's reply opens it again. */
create or replace function message_moves_sales() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_e enquiries;
begin
  if current_persona() is null then return null; end if;
  select * into v_e from enquiries where id = new.enquiry_id;
  if v_e.type <> 'sales' then return null; end if;

  if new.author_role = 'buyer' and v_e.status = 'answered' then
    update enquiries set status = 'open' where id = v_e.id;
  elsif v_e.status = 'open'
        and ((new.author_role = 'partner' and v_e.partner_id is not null)
          or (new.author_role = 'operator' and v_e.partner_id is null)) then
    update enquiries set status = 'answered' where id = v_e.id;
  end if;
  return null;
end $$;

drop trigger if exists enquiry_messages_moves_sales on enquiry_messages;
create trigger enquiry_messages_moves_sales after insert on enquiry_messages
  for each row execute function message_moves_sales();

/* The audit trail is written by the triggers above and by nobody else. */
create or replace function guard_enquiry_event() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if current_persona() is null then return new; end if;
  raise exception 'The audit trail of an enquiry is not edited.';
end $$;

drop trigger if exists enquiry_events_guard on enquiry_events;
create trigger enquiry_events_guard before update on enquiry_events
  for each row execute function guard_enquiry_event();

/* ==================================================== the requisition link === */

alter table enterprise_requisition_lines
  add column if not exists quote_line_id text references enquiry_lines(id);

comment on column enterprise_requisition_lines.quote_line_id is
  'The accepted quote line this requisition line was priced from. When set, guard_quoted_line holds the line to the quote: same product, same quantity, the quoted price, an accepted quote that has not run out, on the same account and in the same money. Null for every line priced from the catalogue.';

/* One accepted line buys once — once at a time. A requisition that was
   declined or withdrawn bought nothing, so its quote can be raised again; the
   check is in `guard_quoted_line`, because a unique index cannot see the
   requisition's state. An earlier version of this file had the plain index. */
drop index if exists enterprise_requisition_lines_quote_line_idx;
create index if not exists enterprise_requisition_lines_quote_line_lookup
  on enterprise_requisition_lines(quote_line_id) where quote_line_id is not null;

/**
 * A requisition line that claims a quoted price has to be the quote.
 *
 * Only acts when `quote_line_id` is set; every line priced from the catalogue
 * goes through exactly as before. On an update it only looks again when
 * something it vouched for changed, so correcting the sort order of an old line
 * does not trip over a quote that has since run out.
 */
create or replace function guard_quoted_line() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_q   record;
  v_req record;
begin
  if current_persona() is null then return new; end if;
  /* A line priced from a quote stays priced from it. Letting go of the link
     would leave the quoted price on a line nothing holds to it. */
  if tg_op = 'UPDATE' and old.quote_line_id is not null
     and new.quote_line_id is distinct from old.quote_line_id then
    raise exception 'A line priced from a quote stays tied to it. Remove the line and add it again instead.';
  end if;
  if new.quote_line_id is null then return new; end if;

  if tg_op = 'UPDATE'
     and new.quote_line_id is not distinct from old.quote_line_id
     and new.requisition_id is not distinct from old.requisition_id
     and new.product_id is not distinct from old.product_id
     and new.quantity is not distinct from old.quantity
     and new.unit_price is not distinct from old.unit_price
     and new.line_total is not distinct from old.line_total then
    return new;
  end if;

  select l.product_id, l.quantity, l.quoted_unit_price,
         e.id as enquiry_id, e.type, e.status, e.valid_until, e.account_id, e.currency
    into v_q
    from enquiry_lines l join enquiries e on e.id = l.enquiry_id
   where l.id = new.quote_line_id;
  if v_q.enquiry_id is null then
    raise exception 'There is no quoted line %.', new.quote_line_id;
  end if;
  if v_q.type <> 'quote' or v_q.status <> 'accepted' then
    raise exception '% has not been accepted, so its prices cannot be used yet.', v_q.enquiry_id;
  end if;
  if v_q.valid_until < current_date then
    raise exception 'The quote % ran out on %. Ask for it to be re-quoted.', v_q.enquiry_id, to_char(v_q.valid_until, 'DD Mon YYYY');
  end if;

  select r.account_id, r.currency into v_req from enterprise_requisitions r where r.id = new.requisition_id;
  if v_req.account_id is null then
    raise exception 'There is no requisition %.', new.requisition_id;
  end if;
  if v_req.account_id is distinct from v_q.account_id then
    raise exception 'The quote % was given to another account.', v_q.enquiry_id;
  end if;
  if v_req.currency is distinct from v_q.currency then
    raise exception 'The quote % is in % and this requisition is in %.', v_q.enquiry_id, v_q.currency, v_req.currency;
  end if;
  if new.product_id is distinct from v_q.product_id then
    raise exception 'That line was quoted for a different listing.';
  end if;
  if new.quantity is distinct from v_q.quantity then
    raise exception 'That line was quoted for % — ask for a new quote to buy a different quantity.', v_q.quantity;
  end if;
  if new.unit_price is distinct from v_q.quoted_unit_price then
    raise exception 'That line was quoted at %, not %.', v_q.quoted_unit_price, new.unit_price;
  end if;
  if new.line_total is distinct from round(new.unit_price * new.quantity, 2) then
    raise exception 'The line total has to be the quoted price times the quantity.';
  end if;

  /* Once at a time. The quoted line is locked first so two requisitions
     raised at the same moment cannot both see the other as absent. A
     requisition that is pending or approved holds it; one that was declined
     or withdrawn (the only other states, 20260801000000) let it go. */
  perform 1 from enquiry_lines where id = new.quote_line_id for update;
  if exists (select 1 from enterprise_requisition_lines o
               join enterprise_requisitions r on r.id = o.requisition_id
              where o.quote_line_id = new.quote_line_id
                and o.id is distinct from new.id
                and r.state not in ('declined', 'withdrawn')) then
    raise exception 'That quoted line is already on a requisition that is pending or approved.';
  end if;
  return new;
end $$;

drop trigger if exists enterprise_requisition_lines_quoted_guard on enterprise_requisition_lines;
create trigger enterprise_requisition_lines_quoted_guard
  before insert or update on enterprise_requisition_lines
  for each row execute function guard_quoted_line();

/* ======================================================== notifications === */

insert into notification_events (id, label, description, personas, category, sort_order) values
  ('enquiry.raised',   'A business asks for a quote, a demo or sales', 'A business buyer has asked something and is waiting for the answer.', array['operator','partner'], 'Enquiries', 80),
  ('enquiry.answered', 'An enquiry is answered',  'A quote was sent, a demo booked, a question answered — or the enquiry was declined.', array['enterprise'], 'Enquiries', 81),
  ('enquiry.decided',  'A business decides on an enquiry', 'The buyer accepted, declined, withdrew, confirmed a time or closed it.', array['operator','partner'], 'Enquiries', 82)
on conflict (id) do update set
  label = excluded.label, description = excluded.description,
  personas = excluded.personas, category = excluded.category, sort_order = excluded.sort_order;

/* One rule per persona per event, in-app only: there is no gateway connected to
   send anything else, and a rule naming one would only ever be suppressed.
   `do nothing` on conflict, so a rule the operator has since edited stays as
   they left it. */
insert into notification_rules (id, persona, event_id, name, audience, kinds, throttle,
                                severity, enabled, mandatory, why, last_sent, sort_order) values
  ('NR-O-ENQ-RAISED', 'operator', 'enquiry.raised', 'A business asked the desk', 'Enquiries desk',
   array['inapp'], 'Every time', 'normal', true, false,
   'Multi-seller quotes and every Contact Sales enquiry come to the desk. Nobody else will answer them.', null, 7),
  ('NR-O-ENQ-DECIDED', 'operator', 'enquiry.decided', 'A business decided on a desk enquiry', 'Enquiries desk',
   array['inapp'], 'Every time', 'normal', true, false,
   'An accepted quote is about to become a requisition at the price the desk offered.', null, 8),
  ('NR-P-ENQ-RAISED', 'partner', 'enquiry.raised', 'A business asked about your listing', 'Seller admin',
   array['inapp'], 'Every time', 'normal', true, false,
   'A business asking for a price or a demo is a sale waiting on you.', null, 18),
  ('NR-P-ENQ-DECIDED', 'partner', 'enquiry.decided', 'A business decided on your quote or demo', 'Seller admin',
   array['inapp'], 'Every time', 'normal', true, false,
   'Accepted means an order is on its way through their approvals; declined comes with the reason.', null, 19),
  ('NR-B-ENQ-ANSWERED', 'enterprise', 'enquiry.answered', 'Your enquiry was answered', 'The person who asked',
   array['inapp'], 'Every time', 'normal', true, false,
   'To whoever asked. A quote has a date on it, so the sooner it is read the better.', null, 28)
on conflict (id) do nothing;

insert into notification_templates (id, rule_id, kind_id, subject, body)
select r.id || '-' || k, r.id, k, r.name,
       left(r.name || ' — ' || e.description || ' {link}', 240)
  from notification_rules r
  join notification_events e on e.id = r.event_id
  cross join lateral unnest(r.kinds) k
 where r.id in ('NR-O-ENQ-RAISED', 'NR-O-ENQ-DECIDED', 'NR-P-ENQ-RAISED', 'NR-P-ENQ-DECIDED', 'NR-B-ENQ-ANSWERED')
on conflict (id) do nothing;

/* One message to one recipient, through every rule aimed at them. In-app is
   delivered — it is a row the console shows. Anything else a rule names is
   written down as not sent, with why, because a suppressed message with no
   reason is indistinguishable from a bug. */
create or replace function enquiry_send(p_event text, p_persona text, p_recipient text,
                                        p_user uuid, p_partner text, p_subject text,
                                        p_body text, p_ref text)
returns void language plpgsql security definer set search_path = public as $$
declare
  r record;
  k text;
begin
  for r in select * from notification_rules
            where event_id = p_event and persona = p_persona order by sort_order loop
    foreach k in array r.kinds loop
      insert into notification_log (id, rule_id, kind_id, channel_id, persona, recipient,
                                    user_id, partner_id, subject, body, sent_at, state, detail, cost, ref)
      values ('NL-ENQ-' || replace(gen_random_uuid()::text, '-', ''), r.id, k, null, p_persona,
              coalesce(p_recipient, 'Enquiries desk'), p_user, p_partner,
              left(p_subject, 200), left(p_body, 240), now(),
              case when not r.enabled then 'suppressed'
                   when k = 'inapp' then 'delivered'
                   else 'suppressed' end,
              case when not r.enabled then 'The rule "' || r.name || '" is switched off. Nothing was sent.'
                   when k = 'inapp' then null
                   else 'No gateway is connected for ' || k end,
              0, p_ref);
    end loop;
  end loop;
end $$;

/**
 * Who hears about an enquiry, at the moment it changes.
 *
 *   raised (or reassigned)        the seller it went to, or the desk
 *   answered by the responder     the buyer who asked
 *   decided by the buyer          the seller, or the desk
 *
 * A migration or the service role (null persona) tells nobody: seeding
 * yesterday's enquiries is not news.
 */
create or replace function notify_enquiry() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_persona   text := current_persona();
  v_company   text;
  v_buyer     enterprise_users;
  v_seller    text;
  v_what      text;
  v_event     text;
  v_subject   text;
  v_body      text;
begin
  if v_persona is null then return null; end if;

  select a.company into v_company from enterprise_accounts a where a.id = new.account_id;
  v_what := case new.type when 'quote' then 'a quote' when 'demo' then 'a demo' else 'a word with sales' end;

  if tg_op = 'INSERT' or new.partner_id is distinct from old.partner_id then
    v_event := 'enquiry.raised';
    v_subject := case when tg_op = 'INSERT' then coalesce(v_company, 'A business') || ' asked for ' || v_what
                      else 'An enquiry was passed to you' end;
    v_body := coalesce(v_company, 'A business') || ' asked for ' || v_what || ' on ' || new.id
              || ': "' || new.subject || '". Answer it from Enquiries.';
  elsif new.status is distinct from old.status or new.valid_until is distinct from old.valid_until
        or (new.status = 'quoted' and exists (select 1 from enquiry_rpc_tokens where txid = txid_current())) then
    if v_persona = 'enterprise' then
      if new.status not in ('accepted', 'declined', 'withdrawn', 'closed', 'scheduled') then
        return null;
      end if;
      v_event := 'enquiry.decided';
      v_subject := coalesce(v_company, 'The buyer') || ' ' || case new.status
        when 'accepted' then 'accepted the quote'
        when 'declined' then 'declined'
        when 'withdrawn' then 'withdrew'
        when 'scheduled' then 'confirmed a time'
        else 'closed' end || ' — ' || new.id;
      v_body := '"' || new.subject || '" is now ' || new.status
                || case when new.status = 'declined' then '. Reason: ' || coalesce(new.decline_reason, '') else '.' end;
    else
      v_event := 'enquiry.answered';
      v_subject := case
        when new.status = 'quoted' and old.status = 'quoted' then 'Your quote was revised'
        when new.status = 'quoted' then 'Your quote is ready'
        when new.status = 'scheduled' then 'Your demo is booked'
        when new.status = 'answered' then 'Sales replied'
        when new.status = 'declined' then 'Your enquiry was declined'
        when new.status = 'done' then 'Your demo is marked done'
        when new.status = 'closed' then 'Your enquiry was closed'
        else 'Your enquiry was updated' end || ' — ' || new.id;
      v_body := '"' || new.subject || '"'
                || case when new.status = 'quoted' then ' is priced and valid until ' || to_char(new.valid_until, 'DD Mon YYYY') || '.'
                        when new.status = 'declined' then ' was declined. Reason: ' || coalesce(new.decline_reason, '')
                        else ' is now ' || new.status || '.' end;
    end if;
  else
    return null;
  end if;

  if v_event = 'enquiry.answered' then
    select * into v_buyer from enterprise_users where id = new.raised_by;
    perform enquiry_send(v_event, 'enterprise', v_buyer.name, v_buyer.user_id, null, v_subject, v_body, new.id);
  elsif new.partner_id is not null then
    select name into v_seller from partners where id = new.partner_id;
    perform enquiry_send(v_event, 'partner', v_seller, null, new.partner_id, v_subject, v_body, new.id);
  else
    perform enquiry_send(v_event, 'operator', 'Enquiries desk', null, null, v_subject, v_body, new.id);
  end if;
  return null;
end $$;

drop trigger if exists enquiries_notify on enquiries;
create trigger enquiries_notify after insert or update on enquiries
  for each row execute function notify_enquiry();

/* ================================================================= RLS === */

alter table enquiries        enable row level security;
alter table enquiry_lines    enable row level security;
alter table enquiry_slots    enable row level security;
alter table enquiry_messages enable row level security;
alter table enquiry_events   enable row level security;

grant select, insert, update, delete on enquiries, enquiry_lines, enquiry_slots to authenticated;
grant select, insert on enquiry_messages to authenticated;
grant select on enquiry_events to authenticated;
/* Supabase's default privileges grant everything to anon and authenticated, so
   the lines above narrow nothing on their own. These do: messages are read and
   added, and the trail is only read, whatever policy is added later. */
revoke all on enquiries, enquiry_lines, enquiry_slots, enquiry_messages, enquiry_events, enquiry_book from anon;
revoke update, delete, truncate on enquiry_messages from authenticated;
revoke insert, update, delete, truncate on enquiry_events from authenticated;
grant select on enquiry_book to authenticated;
grant usage on sequence enquiry_seq to authenticated;

drop policy if exists "operator_all_enquiries"         on enquiries;
drop policy if exists "account_read_enquiries"         on enquiries;
drop policy if exists "account_update_enquiries"       on enquiries;
drop policy if exists "partner_read_enquiries"         on enquiries;
drop policy if exists "partner_update_enquiries"       on enquiries;
drop policy if exists "operator_all_enquiry_lines"     on enquiry_lines;
drop policy if exists "account_read_enquiry_lines"     on enquiry_lines;
drop policy if exists "account_update_enquiry_lines"   on enquiry_lines;
drop policy if exists "partner_read_enquiry_lines"     on enquiry_lines;
drop policy if exists "partner_update_enquiry_lines"   on enquiry_lines;
drop policy if exists "operator_all_enquiry_slots"     on enquiry_slots;
drop policy if exists "account_read_enquiry_slots"     on enquiry_slots;
drop policy if exists "account_write_enquiry_slots"    on enquiry_slots;
drop policy if exists "account_update_enquiry_slots"   on enquiry_slots;
drop policy if exists "partner_read_enquiry_slots"     on enquiry_slots;
drop policy if exists "partner_write_enquiry_slots"    on enquiry_slots;
drop policy if exists "partner_update_enquiry_slots"   on enquiry_slots;
drop policy if exists "operator_read_enquiry_messages" on enquiry_messages;
drop policy if exists "operator_write_enquiry_messages" on enquiry_messages;
drop policy if exists "account_read_enquiry_messages"  on enquiry_messages;
drop policy if exists "account_write_enquiry_messages" on enquiry_messages;
drop policy if exists "partner_read_enquiry_messages"  on enquiry_messages;
drop policy if exists "partner_write_enquiry_messages" on enquiry_messages;
drop policy if exists "operator_read_enquiry_events"   on enquiry_events;
drop policy if exists "account_read_enquiry_events"    on enquiry_events;
drop policy if exists "partner_read_enquiry_events"    on enquiry_events;

/* The desk sees everything, because it is the desk. */
create policy "operator_all_enquiries" on enquiries for all to authenticated
  using (current_persona() = 'operator') with check (current_persona() = 'operator');

/* A business sees everything anybody on it has asked — enquiries, like
   tickets, are a shared inbox. It changes them only through the guard; it
   raises them only through `raise_*`, so there is no insert policy. */
create policy "account_read_enquiries" on enquiries for select to authenticated
  using (current_persona() = 'enterprise' and account_id = current_account_id());
create policy "account_update_enquiries" on enquiries for update to authenticated
  using (current_persona() = 'enterprise' and account_id = current_account_id())
  with check (current_persona() = 'enterprise' and account_id = current_account_id());

/* A seller sees what was routed to them. */
create policy "partner_read_enquiries" on enquiries for select to authenticated
  using (current_persona() = 'partner' and partner_id = current_partner_id());
create policy "partner_update_enquiries" on enquiries for update to authenticated
  using (current_persona() = 'partner' and partner_id = current_partner_id())
  with check (current_persona() = 'partner' and partner_id = current_partner_id());

/* Lines follow the enquiry — with one addition: on a multi-seller quote the
   desk answers, and each seller may read its own lines on it and nothing else,
   so it can tell the desk what it would charge. It cannot write them. */
create policy "operator_all_enquiry_lines" on enquiry_lines for all to authenticated
  using (current_persona() = 'operator') with check (current_persona() = 'operator');
create policy "account_read_enquiry_lines" on enquiry_lines for select to authenticated
  using (exists (select 1 from enquiries e where e.id = enquiry_lines.enquiry_id
                   and current_persona() = 'enterprise' and e.account_id = current_account_id()));
create policy "account_update_enquiry_lines" on enquiry_lines for update to authenticated
  using (exists (select 1 from enquiries e where e.id = enquiry_lines.enquiry_id
                   and current_persona() = 'enterprise' and e.account_id = current_account_id()))
  with check (exists (select 1 from enquiries e where e.id = enquiry_lines.enquiry_id
                   and current_persona() = 'enterprise' and e.account_id = current_account_id()));
create policy "partner_read_enquiry_lines" on enquiry_lines for select to authenticated
  using (current_persona() = 'partner'
         and (enquiry_routed_to_me(enquiry_id)
              or (partner_id = current_partner_id() and enquiry_is_desk_quote(enquiry_id))));
create policy "partner_update_enquiry_lines" on enquiry_lines for update to authenticated
  using (current_persona() = 'partner' and enquiry_routed_to_me(enquiry_id))
  with check (current_persona() = 'partner' and enquiry_routed_to_me(enquiry_id));

create policy "operator_all_enquiry_slots" on enquiry_slots for all to authenticated
  using (current_persona() = 'operator') with check (current_persona() = 'operator');
create policy "account_read_enquiry_slots" on enquiry_slots for select to authenticated
  using (exists (select 1 from enquiries e where e.id = enquiry_slots.enquiry_id
                   and current_persona() = 'enterprise' and e.account_id = current_account_id()));
create policy "account_write_enquiry_slots" on enquiry_slots for insert to authenticated
  with check (exists (select 1 from enquiries e where e.id = enquiry_slots.enquiry_id
                   and current_persona() = 'enterprise' and e.account_id = current_account_id()));
create policy "account_update_enquiry_slots" on enquiry_slots for update to authenticated
  using (exists (select 1 from enquiries e where e.id = enquiry_slots.enquiry_id
                   and current_persona() = 'enterprise' and e.account_id = current_account_id()))
  with check (exists (select 1 from enquiries e where e.id = enquiry_slots.enquiry_id
                   and current_persona() = 'enterprise' and e.account_id = current_account_id()));
create policy "partner_read_enquiry_slots" on enquiry_slots for select to authenticated
  using (current_persona() = 'partner' and enquiry_routed_to_me(enquiry_id));
create policy "partner_write_enquiry_slots" on enquiry_slots for insert to authenticated
  with check (current_persona() = 'partner' and enquiry_routed_to_me(enquiry_id));
create policy "partner_update_enquiry_slots" on enquiry_slots for update to authenticated
  using (current_persona() = 'partner' and enquiry_routed_to_me(enquiry_id))
  with check (current_persona() = 'partner' and enquiry_routed_to_me(enquiry_id));

/* Messages: read and add, never edit or remove — the operator included. */
create policy "operator_read_enquiry_messages" on enquiry_messages for select to authenticated
  using (current_persona() = 'operator');
create policy "operator_write_enquiry_messages" on enquiry_messages for insert to authenticated
  with check (current_persona() = 'operator');
create policy "account_read_enquiry_messages" on enquiry_messages for select to authenticated
  using (exists (select 1 from enquiries e where e.id = enquiry_messages.enquiry_id
                   and current_persona() = 'enterprise' and e.account_id = current_account_id()));
create policy "account_write_enquiry_messages" on enquiry_messages for insert to authenticated
  with check (exists (select 1 from enquiries e where e.id = enquiry_messages.enquiry_id
                   and current_persona() = 'enterprise' and e.account_id = current_account_id()));
create policy "partner_read_enquiry_messages" on enquiry_messages for select to authenticated
  using (current_persona() = 'partner' and enquiry_routed_to_me(enquiry_id));
create policy "partner_write_enquiry_messages" on enquiry_messages for insert to authenticated
  with check (current_persona() = 'partner' and enquiry_routed_to_me(enquiry_id));

/* The audit trail: read-only to whoever can read the enquiry. */
create policy "operator_read_enquiry_events" on enquiry_events for select to authenticated
  using (current_persona() = 'operator');
create policy "account_read_enquiry_events" on enquiry_events for select to authenticated
  using (exists (select 1 from enquiries e where e.id = enquiry_events.enquiry_id
                   and current_persona() = 'enterprise' and e.account_id = current_account_id()));
create policy "partner_read_enquiry_events" on enquiry_events for select to authenticated
  using (current_persona() = 'partner' and enquiry_routed_to_me(enquiry_id));

/* ------------------------------------------------------ function grants -- */

revoke all on function raise_quote(text, jsonb, date, text) from public, anon;
revoke all on function raise_demo(text, text, text, integer, timestamptz[], text) from public, anon;
revoke all on function raise_sales(text, text, text) from public, anon;
revoke all on function reassign_enquiry(text, text, text) from public, anon;
grant execute on function raise_quote(text, jsonb, date, text) to authenticated;
grant execute on function raise_demo(text, text, text, integer, timestamptz[], text) to authenticated;
grant execute on function raise_sales(text, text, text) to authenticated;
grant execute on function reassign_enquiry(text, text, text) to authenticated;
revoke all on function send_quote(text, jsonb, date, text) from public, anon;
grant execute on function send_quote(text, jsonb, date, text) to authenticated;

revoke all on function enquiry_routed_to_me(text) from public, anon;
revoke all on function enquiry_is_desk_quote(text) from public, anon;
grant execute on function enquiry_routed_to_me(text) to authenticated;
grant execute on function enquiry_is_desk_quote(text) to authenticated;

/* Internal. A client that could call these could write a notification, or ask
   for somebody else's membership row. */
revoke all on function enquiry_send(text, text, text, uuid, text, text, text, text) from public, anon, authenticated;
revoke all on function enquiry_buyer() from public, anon, authenticated;

/* ================================================================ seed === */

/* SmartBuild, so every screen has something on first run: a quote waiting on
   the buyer, a demo booked, a sales question answered, and a two-seller quote
   waiting on the desk. `ENQ-SEED-` ids: not a number, so the sequence can never
   produce one and a re-run can never delete a real enquiry.
   The seller, the listing name and the currency are read from the catalogue
   and the account rather than typed, so the seed cannot route differently from
   the rule it is there to show. */
do $$
declare
  v_cur  text := (select currency from enterprise_accounts where id = 'ENT-2007');
  v_nim  text := (select partner_id from products where id = 'SKU-5004');
  v_nim_name text;
begin
  /* A requisition already raised from a seed quote would hold the line in
     place; let go of it rather than refuse to re-seed. */
  update enterprise_requisition_lines set quote_line_id = null
   where quote_line_id in (select l.id from enquiry_lines l where l.enquiry_id like 'ENQ-SEED-%');
  delete from enquiries where id like 'ENQ-SEED-%';

  select name into v_nim_name from partners where id = v_nim;

  insert into enquiries (id, type, account_id, raised_by, partner_id, subject, status, currency,
                         needed_by, valid_until, format, attendees, contact_pref,
                         created_at, updated_at, decided_at) values
    ('ENQ-SEED-1', 'quote', 'ENT-2007', 'EU-2007-01', v_nim,
     'Occupancy sensors for the Whitefield office', 'quoted', v_cur,
     current_date + 21, current_date + 30, null, null, null,
     now() - interval '6 days', now() - interval '2 days', null),
    ('ENQ-SEED-2', 'demo', 'ENT-2007', 'EU-2007-01', v_nim,
     'Occupancy sensing walkthrough for the facilities team', 'scheduled', v_cur,
     null, null, 'video', 6, null,
     now() - interval '5 days', now() - interval '3 days', null),
    ('ENQ-SEED-3', 'sales', 'ENT-2007', 'EU-2007-01', null,
     'Volume terms across all four sites', 'answered', v_cur,
     null, null, null, null, 'email',
     now() - interval '4 days', now() - interval '1 day', null),
    ('ENQ-SEED-4', 'quote', 'ENT-2007', 'EU-2007-01', null,
     'Sensors and managed firewalls for the Hubli depot', 'submitted', v_cur,
     current_date + 45, null, null, null, null,
     now() - interval '1 day', now() - interval '1 day', null);

  insert into enquiry_lines (id, enquiry_id, product_id, name, partner_id, quantity,
                             target_unit_price, quoted_unit_price, sort_order)
  select v.id, v.enquiry_id, p.id, p.name, p.partner_id, v.quantity, v.target, v.quoted, v.sort_order
    from (values
      ('EQL-SEED-1-1', 'ENQ-SEED-1', 'SKU-5004', 120, 3800.00::numeric, 3899.00::numeric, 1),
      ('EQL-SEED-2-1', 'ENQ-SEED-2', 'SKU-5004',   1, null,             null,             1),
      ('EQL-SEED-4-1', 'ENQ-SEED-4', 'SKU-5004',  40, 4100.00,          null,             1),
      ('EQL-SEED-4-2', 'ENQ-SEED-4', 'SKU-6001',   4, null,             null,             2)
    ) as v(id, enquiry_id, product_id, quantity, target, quoted, sort_order)
    join products p on p.id = v.product_id;

  insert into enquiry_slots (id, enquiry_id, starts_at, proposed_by, confirmed, location, created_at) values
    ('EQS-SEED-2-1', 'ENQ-SEED-2', date_trunc('day', now()) + interval '8 days 4 hours 30 minutes', 'buyer', true,
     'Video call — https://meet.nimbussensors.example/smartbuild-occupancy', now() - interval '5 days'),
    ('EQS-SEED-2-2', 'ENQ-SEED-2', date_trunc('day', now()) + interval '9 days 9 hours', 'buyer', false,
     null, now() - interval '5 days');

  insert into enquiry_messages (id, enquiry_id, author_role, author_name, body, created_at) values
    ('EQM-SEED-1-1', 'ENQ-SEED-1', 'buyer', 'Vikram Shah',
     'We are fitting out the Whitefield office in two phases. 120 sensors covers both floors. Can you do better than list at this volume?',
     now() - interval '6 days'),
    ('EQM-SEED-1-2', 'ENQ-SEED-1', 'partner', coalesce(v_nim_name, 'Nimbus Sensors'),
     'Yes — the price on the quote holds for the full 120 and includes the gateway pairing on site. Valid for 30 days.',
     now() - interval '2 days'),
    ('EQM-SEED-2-1', 'ENQ-SEED-2', 'buyer', 'Vikram Shah',
     'Six of us from facilities. We mainly want to see how the occupancy dashboard handles shared desks.',
     now() - interval '5 days'),
    ('EQM-SEED-2-2', 'ENQ-SEED-2', 'partner', coalesce(v_nim_name, 'Nimbus Sensors'),
     'The first time works for us. The joining link is on the booking; we will bring a live floor plan from a customer site.',
     now() - interval '3 days'),
    ('EQM-SEED-3-1', 'ENQ-SEED-3', 'buyer', 'Vikram Shah',
     'We buy across four sites and expect to add two more this year. Is there a volume arrangement that applies across sellers?',
     now() - interval '4 days'),
    ('EQM-SEED-3-2', 'ENQ-SEED-3', 'operator', 'Enquiries desk',
     'There is: Business Plus accounts get a pricing review at every renewal, and multi-seller quotes come through this desk. Send us the list for the new sites and we will quote it as one.',
     now() - interval '1 day'),
    ('EQM-SEED-4-1', 'ENQ-SEED-4', 'buyer', 'Vikram Shah',
     'The Hubli depot opens next quarter. Sensors for cold storage and firewalls for the four buildings on site.',
     now() - interval '1 day');

  /* The trail behind each one, after the "raised" row the insert trigger
     already wrote. */
  insert into enquiry_events (id, enquiry_id, actor_role, actor_name, action, from_status, to_status, note, at) values
    ('EQE-SEED-1-2', 'ENQ-SEED-1', 'partner', coalesce(v_nim_name, 'Nimbus Sensors'), 'quoted', 'submitted', 'quoted',
     'Valid until ' || to_char(current_date + 30, 'DD Mon YYYY'), now() - interval '2 days'),
    ('EQE-SEED-2-2', 'ENQ-SEED-2', 'partner', coalesce(v_nim_name, 'Nimbus Sensors'), 'scheduled', 'requested', 'scheduled',
     null, now() - interval '3 days'),
    ('EQE-SEED-3-2', 'ENQ-SEED-3', 'operator', 'Enquiries desk', 'answered', 'open', 'answered',
     null, now() - interval '1 day');

  /* The seed's actor names on the "raised" rows say who asked, not "Marketplace". */
  update enquiry_events set actor_role = 'buyer', actor_name = 'Vikram Shah'
   where enquiry_id like 'ENQ-SEED-%' and action = 'raised';
end $$;

/* ================================================================ help === */

/* Three new screens, three articles. `helpCoverage.integration.test.ts` reads
 * the screens out of `src/types/view.ts`, so en-enquiries, pt-enquiries and
 * op-enquiries are in the coverage check from the commit that added them, and
 * a help button with nothing behind it would turn it red.
 *
 * One article per persona, because the three read the same enquiry from three
 * sides: the business asked it, the seller answers it, the desk answers what no
 * single seller can and watches the rest.
 *
 * Ids computed rather than typed: the next free number in each set, read off
 * the table, the way the agreements articles did it after a hardcoded id once
 * replaced somebody else's article. Each insert is skipped when its screen
 * already has an article, so running this file again adds nothing.
 *
 * No picture of the screen yet. Every other article carries a capture served
 * from `kb-assets`, but there is no capture of these screens to point at, and
 * an image block naming a file that does not exist is the stock-photo mistake
 * the media pass removed. The picture goes in when the screens are captured.
 */

do $$
declare
  v_op text; v_pt text; v_en text;
  n_op int;  n_pt int;  n_en int;
begin
  select coalesce(max(substring(id from '^KB-O(\d+)$')::int), 0) + 1 into n_op
    from public.kb_articles where id ~ '^KB-O\d+$';
  select coalesce(max(substring(id from '^KB-P(\d+)$')::int), 0) + 1 into n_pt
    from public.kb_articles where id ~ '^KB-P\d+$';
  select coalesce(max(substring(id from '^KB-B(\d+)$')::int), 0) + 1 into n_en
    from public.kb_articles where id ~ '^KB-B\d+$';
  /* Padded to two digits, as the existing ones are. */
  v_op := 'KB-O' || lpad(n_op::text, 2, '0');
  v_pt := 'KB-P' || lpad(n_pt::text, 2, '0');
  v_en := 'KB-B' || lpad(n_en::text, 2, '0');

  /* ------------------------------------------------------- the business -- */
  if not exists (select 1 from public.kb_articles where view = 'en-enquiries') then
    insert into public.kb_articles
      (id, persona, kind, title, mins, updated, view, roles, tags, summary,
       body, status, sort_order, personas, audience_note, audience_ids)
    values (
      v_en, 'enterprise', 'howto', 'Asking for a quote, a demo or a word with sales', 5,
      '05 Nov 2026', 'en-enquiries',
      array['BY-BUY', 'BY-ADMIN'], array['enquiries', 'quotes', 'demos', 'ordering'],
      'Where to ask before you buy, who answers, and what accepting a quote does — and does not — do.',
      jsonb_build_array(
        jsonb_build_object('kind', 'prose', 'heading', 'Where you ask',
          'text', 'On any listing, Request a quote asks for a price on the quantity you want, with the price you hope for if you have one. Book a demo appears on the listings where seeing it working means something — anything sold on a subscription, and IoT and security hardware — and asks for one to three times that suit you. In the requisition drawer, Request a quote for this basket asks for the whole basket at once and leaves the basket as it is. Contact Sales, in the header, is for anything that is not about one listing.'),
        jsonb_build_object('kind', 'prose', 'heading', 'Who answers',
          'text', 'If everything you asked about is sold by one seller, that seller answers. A quote across two sellers, anything Aventa sells itself, and every Contact Sales question go to the marketplace desk instead. The Answered by column says which. The marketplace can pass an enquiry from one to the other, and when it does the reason is written in the history.'),
        jsonb_build_object('kind', 'prose', 'heading', 'Finding what needs you',
          'text', 'Waiting on you is everything where the next move is yours: a quote that has been priced and is still in date, and a sales question that has been answered. Waiting on them is the rest that is still open. Those come first in the list, then the most recently changed. Open a row to read it in full and act on it.'),
        jsonb_build_object('kind', 'prose', 'heading', 'A priced quote',
          'text', 'Every line carries the seller''s price and the quote carries a date it is valid until, never more than ninety days out. Accept it, decline it with a reason the seller can act on, or withdraw. Only somebody who can raise requisitions on this account can accept or decline a quote; anybody on the account can follow it and reply. After the valid-until date the quote shows as expired and cannot be accepted — ask in the conversation for it to be re-quoted.'),
        jsonb_build_object('kind', 'prose', 'heading', 'Accepting is not ordering',
          'text', 'Accepting puts the quoted lines into your requisition at the quoted prices and quantities. Nothing is ordered until that requisition is raised and approved, exactly as for anything else. If the seller re-quoted after you opened the page, the acceptance stands but nothing is added: look at the new prices first, then use Add to requisition. That button stays until the quote runs out, and once the lines are on a live requisition the screen names it instead.'),
        jsonb_build_object('kind', 'prose', 'heading', 'A demo',
          'text', 'Whoever did not propose a time confirms it. When the seller proposes one, they say where — a joining link or an address — and Confirm a time books it as they gave it. You can suggest another time instead, up to three open at once. Once a time is confirmed the demo is scheduled and the time is fixed; if it no longer works, say so in the conversation or withdraw.'),
        jsonb_build_object('kind', 'prose', 'heading', 'A sales question',
          'text', 'The conversation is the whole of it. The desk''s reply marks it answered; yours opens it again. Close it when you have what you needed. A closed one takes no more messages — use Contact Sales again to start another.'),
        jsonb_build_object('kind', 'prose', 'heading', 'What you asked stays as asked',
          'text', 'An enquiry is not edited once it is sent — the subject, what it is for and how you asked to be answered stay as they were — so what the seller answered is always what you asked. To ask for something different, withdraw it and ask again. Every move it makes, and who made it, is under History.')
      ),
      'published', n_en, array['enterprise'], '', array[]::text[]);
    raise notice 'enterprise enquiries article %', v_en;
  end if;

  /* ---------------------------------------------------------- the seller -- */
  if not exists (select 1 from public.kb_articles where view = 'pt-enquiries') then
    insert into public.kb_articles
      (id, persona, kind, title, mins, updated, view, roles, tags, summary,
       body, status, sort_order, personas, audience_note, audience_ids)
    values (
      v_pt, 'partner', 'howto', 'Answering quotes and demos', 4,
      '05 Nov 2026', 'pt-enquiries',
      array['PR-OWNER', 'PR-OPS'], array['enquiries', 'quotes', 'demos'],
      'What reaches you, how a quote is priced and sent, and how a demo gets booked.',
      jsonb_build_array(
        jsonb_build_object('kind', 'prose', 'heading', 'What reaches you',
          'text', 'A business''s quote or demo request comes here when every line of it is one of your listings. A quote that also names another seller''s listing goes to the marketplace desk, because no single seller can price all of it. The marketplace can pass an enquiry to you or away from you; the reason is in its history and you are told when one arrives.'),
        jsonb_build_object('kind', 'prose', 'heading', 'Sending a quote',
          'text', 'Give a unit price above zero for every line, and the date the quote is valid until: from tomorrow to ninety days out. A note, if you write one, goes into the conversation. Beside each line you see the quantity the buyer asked for and the price they hope for, if they gave one. The prices and the date go together, in one step, and the buyer is told the quote is ready.'),
        jsonb_build_object('kind', 'prose', 'heading', 'Under your agreed minimum',
          'text', 'If a price is below the floor you agreed for that listing, the form says so beside the line. It is a warning, not a refusal: the floor is your number and you can choose to go under it. If the floors could not be read, the form says that instead and you quote as usual.'),
        jsonb_build_object('kind', 'prose', 'heading', 'Changing a quote you sent',
          'text', 'Send a new quote. Prices only change that way — never one line on its own — so whatever the buyer accepts is a set of prices that were sent to them together, with a date. The buyer is told the quote was revised. A quote whose date has passed shows as expired and waits on you: re-quote it with a new date, or decline it.'),
        jsonb_build_object('kind', 'prose', 'heading', 'Declining',
          'text', 'Say why. The reason goes to the buyer and stays on the enquiry, and a decline with no reason is one nobody can act on.'),
        jsonb_build_object('kind', 'prose', 'heading', 'Booking a demo',
          'text', 'The buyer offers up to three times. Confirm one and give the joining link or the address, and the demo is scheduled. Or suggest another time with where it would be, and the buyer confirms it as you gave it. Each side can have three times open at once. Once the demo has happened, mark it done.'),
        jsonb_build_object('kind', 'prose', 'heading', 'Waiting on you',
          'text', 'The chip counts everything whose next move is yours: a new request, an expired quote, a demo booked but not yet marked done. It is where to start each day.')
      ),
      'published', n_pt, array['partner'], '', array[]::text[]);
    raise notice 'partner enquiries article %', v_pt;
  end if;

  /* -------------------------------------------------------- the operator -- */
  if not exists (select 1 from public.kb_articles where view = 'op-enquiries') then
    insert into public.kb_articles
      (id, persona, kind, title, mins, updated, view, roles, tags, summary,
       body, status, sort_order, personas, audience_note, audience_ids)
    values (
      v_op, 'operator', 'howto', 'The enquiries desk', 5,
      '05 Nov 2026', 'op-enquiries',
      array['OR-ADMIN', 'OR-SUPPORT'], array['enquiries', 'quotes', 'demos', 'sellers'],
      'Every quote, demo and sales question buyers have asked: the ones the desk answers, and the ones it only watches and moves.',
      jsonb_build_array(
        jsonb_build_object('kind', 'prose', 'heading', 'What lands on the desk',
          'text', 'A quote or demo whose lines all belong to one seller goes to that seller. Everything else comes here: a quote across two sellers, anything Aventa sells itself, and every Contact Sales question. The routing is worked out from the catalogue when the enquiry is raised, not chosen by the buyer. Answered by says Operator desk for these.'),
        jsonb_build_object('kind', 'prose', 'heading', 'Finding the ones that matter',
          'text', 'The chips and the type filter work as they do for buyers and sellers. Who answers narrows the list to the desk or to one seller. Age shows the enquiries still open that nobody has touched in over two or over seven days — the ones a seller may have gone quiet on. Finished enquiries are left out of it, because nothing is waiting on them.'),
        jsonb_build_object('kind', 'prose', 'heading', 'Answering a desk enquiry',
          'text', 'On the desk''s own enquiries you answer as a seller would: send a quote with a unit price above zero for every line and a valid-until date up to ninety days out, re-quote, decline with a reason, confirm or suggest a demo time with where it will be, mark a demo done. A sales question is answered by replying, and closed when it is settled. There is no price floor here; the floor warning belongs to the seller who agreed it.'),
        jsonb_build_object('kind', 'prose', 'heading', 'A seller''s enquiry is theirs',
          'text', 'On an enquiry routed to a seller you can reply in the conversation and reassign it, and nothing else. The desk does not price on a seller''s behalf — the database refuses it. If it should be answered here, reassign it to the desk first.'),
        jsonb_build_object('kind', 'prose', 'heading', 'Reassigning',
          'text', 'Move an enquiry between the desk and any seller, with a reason. The reason is required and goes into the history, and whoever now holds it is told. A finished enquiry cannot be moved — there is nobody left to answer it.'),
        jsonb_build_object('kind', 'prose', 'heading', 'The record',
          'text', 'Every move, every re-quote and every reassignment is written to History with who did it, and nobody edits that trail, the desk included. Messages are not edited once sent. When a buyer accepts a quote, its lines go into their requisition at the quoted price, and the requisition is held to that price, product and quantity.')
      ),
      'published', n_op, array['operator'], '', array[]::text[]);
    raise notice 'operator enquiries article %', v_op;
  end if;
end $$;

/* --------------------------------------------------------- what is true -- */

do $$
declare
  n integer;
  t text;
begin
  /* RLS is on at all. A policy on a table with RLS off is decoration. */
  foreach t in array array['enquiries', 'enquiry_lines', 'enquiry_slots', 'enquiry_messages', 'enquiry_events'] loop
    select count(*) into n from pg_class where oid = t::regclass and relrowsecurity;
    if n <> 1 then raise exception 'row level security is off on %', t; end if;
  end loop;

  /* The send_quote token is the definer functions' alone: RLS on, no policy,
     and no API role can read or write it. If a client could insert a row for
     its own transaction, it could price a quote without sending it. */
  select count(*) into n from pg_class where oid = 'enquiry_rpc_tokens'::regclass and relrowsecurity;
  if n <> 1 then raise exception 'row level security is off on enquiry_rpc_tokens'; end if;
  select count(*) into n from pg_policies where schemaname = 'public' and tablename = 'enquiry_rpc_tokens';
  if n <> 0 then raise exception 'enquiry_rpc_tokens has % policies; it should have none', n; end if;
  foreach t in array array['anon', 'authenticated'] loop
    if has_table_privilege(t, 'enquiry_rpc_tokens', 'select')
       or has_table_privilege(t, 'enquiry_rpc_tokens', 'insert')
       or has_table_privilege(t, 'enquiry_rpc_tokens', 'update')
       or has_table_privilege(t, 'enquiry_rpc_tokens', 'delete') then
      raise exception '% can still touch enquiry_rpc_tokens', t;
    end if;
  end loop;
  /* And nothing is left in it: every token is removed by the call that made it. */
  select count(*) into n from enquiry_rpc_tokens;
  if n <> 0 then raise exception '% send_quote tokens were left behind', n; end if;

  /* Every guard is attached. */
  select count(*) into n from pg_trigger
   where not tgisinternal and tgname in ('enquiries_guard', 'enquiries_record_raised', 'enquiries_notify',
                                         'enquiry_lines_guard', 'enquiry_slots_guard', 'enquiry_slots_confirm',
                                         'enquiry_messages_guard', 'enquiry_messages_moves_sales',
                                         'enquiry_events_guard', 'enterprise_requisition_lines_quoted_guard');
  if n <> 10 then raise exception 'expected 10 enquiry triggers, found %', n; end if;

  /* The existing line guard is still there beside the new one. */
  select count(*) into n from pg_trigger
   where tgrelid = 'enterprise_requisition_lines'::regclass and tgname = 'enterprise_requisition_lines_guard';
  if n <> 1 then raise exception 'the requisition line guard went missing'; end if;

  /* The seed is the four cases the screens exist to show. */
  select count(*) into n from enquiries where id like 'ENQ-SEED-%';
  if n <> 4 then raise exception 'expected 4 seeded enquiries, found %', n; end if;

  /* The routing rule holds on the seed: one seller routes to that seller; two
     sellers go to the desk. Asked of the catalogue, not of what was typed. */
  select count(*) into n from enquiries e
   where e.id like 'ENQ-SEED-%' and e.type in ('quote', 'demo')
     and e.partner_id is distinct from (
       select case when count(distinct p.partner_id) = 1 and count(*) filter (where p.partner_id is null) = 0
                   then min(p.partner_id) end
         from enquiry_lines l join products p on p.id = l.product_id
        where l.enquiry_id = e.id);
  if n > 0 then raise exception '% seeded enquiries are routed against the rule', n; end if;

  select count(*) into n from enquiries where id = 'ENQ-SEED-1' and partner_id is not null;
  if n <> 1 then raise exception 'the single-seller quote did not route to its seller'; end if;
  select count(*) into n from enquiries where id = 'ENQ-SEED-4' and partner_id is null;
  if n <> 1 then raise exception 'the two-seller quote did not route to the desk'; end if;
  select count(distinct partner_id) into n from enquiry_lines where enquiry_id = 'ENQ-SEED-4';
  if n <> 2 then raise exception 'the desk quote does not carry two sellers (found %)', n; end if;

  /* A quoted quote has every line priced and a date in range. */
  select count(*) into n from enquiries e
   where e.type = 'quote' and e.status in ('quoted', 'accepted')
     and exists (select 1 from enquiry_lines l where l.enquiry_id = e.id and l.quoted_unit_price is null);
  if n > 0 then raise exception '% quoted quotes have unpriced lines', n; end if;

  /* A scheduled demo has exactly one confirmed time, with somewhere to be. */
  select count(*) into n from enquiries e
   where e.type = 'demo' and e.status = 'scheduled'
     and (select count(*) from enquiry_slots s where s.enquiry_id = e.id and s.confirmed) <> 1;
  if n > 0 then raise exception '% scheduled demos do not have exactly one confirmed time', n; end if;

  /* Every enquiry has the first line of its audit trail. */
  select count(*) into n from enquiries e
   where not exists (select 1 from enquiry_events v where v.enquiry_id = e.id and v.action = 'raised');
  if n > 0 then raise exception '% enquiries have no "raised" event', n; end if;

  /* The notifications can be sent: each new rule has wording for every kind
     it names, and is aimed at a persona its event applies to. */
  select count(*) into n
    from notification_rules r, unnest(r.kinds) k
   where r.event_id like 'enquiry.%'
     and not exists (select 1 from notification_templates t where t.rule_id = r.id and t.kind_id = k);
  if n > 0 then raise exception '% enquiry rule/channel pairs have no template', n; end if;

  select count(*) into n from notification_rules r join notification_events e on e.id = r.event_id
   where r.event_id like 'enquiry.%' and not (r.persona = any(e.personas));
  if n > 0 then raise exception '% enquiry rules go to a persona their event does not apply to', n; end if;

  select count(*) into n from notification_rules where event_id like 'enquiry.%';
  if n < 5 then raise exception 'expected 5 enquiry notification rules, found %', n; end if;

  /* Each new screen opens a help article written for whoever reads it, and
     only one: the help button shows the first, so a second would be hidden. */
  select count(*) into n from public.kb_articles
   where status = 'published'
     and ((view = 'en-enquiries' and 'enterprise' = any(personas))
       or (view = 'pt-enquiries' and 'partner' = any(personas))
       or (view = 'op-enquiries' and 'operator' = any(personas)));
  if n <> 3 then raise exception 'expected one help article for each enquiries screen, found %', n; end if;
  select count(*) into n from (
    select view from public.kb_articles
     where view in ('en-enquiries', 'pt-enquiries', 'op-enquiries') group by view having count(*) > 1) t;
  if n <> 0 then raise exception '% enquiries screens have more than one help article', n; end if;
end $$;
