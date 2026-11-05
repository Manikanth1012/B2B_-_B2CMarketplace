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
  values ('quote', v_me.account_id, v_me.id, v_partner, btrim(p_subject), 'submitted', v_currency, p_needed_by)
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
  if (select count(distinct s) from unnest(p_slots) s) <> array_length(p_slots, 1) then
    raise exception 'The same time is offered twice.';
  end if;
  foreach v_slot in array p_slots loop
    if v_slot is null or v_slot <= now() then
      raise exception 'Every time offered has to be in the future.';
    end if;
  end loop;

  select a.currency into v_currency from enterprise_accounts a where a.id = v_me.account_id;

  insert into enquiries (type, account_id, raised_by, partner_id, subject, status, currency, format, attendees)
  values ('demo', v_me.account_id, v_me.id, v_product.partner_id, btrim(p_subject), 'requested',
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
  values ('sales', v_me.account_id, v_me.id, null, btrim(p_subject), 'open', v_currency, p_contact_pref)
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
  perform set_config('enquiry.reason', btrim(p_reason), true);
  update enquiries set partner_id = p_partner_id where id = p_id;
  if not found then
    raise exception 'There is no enquiry %.', p_id;
  end if;
  perform set_config('enquiry.reason', '', true);
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
    if new.status is distinct from case new.type when 'quote' then 'submitted'
                                                when 'demo' then 'requested'
                                                when 'sales' then 'open' end then
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
  v_requote := not v_moved and new.status = 'quoted' and new.valid_until is distinct from old.valid_until;

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
      if old.partner_id is distinct from current_partner_id() then
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
    if v_moved or new.valid_until is distinct from old.valid_until then
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
 * price they offer, and may set it while the quote is open (submitted or
 * quoted). Neither may write the other's column, and nobody renames a line or
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
    if new.quoted_unit_price is distinct from old.quoted_unit_price
       and not (v_e.type = 'quote' and v_e.status in ('submitted', 'quoted')) then
      raise exception '% is %, so its prices cannot be changed.', v_e.id, v_e.status;
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
 * The side proposing is taken from who is asking, never from the row. The
 * buyer may suggest a time while the demo is requested or already scheduled
 * (a suggestion to move it, discussed in the conversation); the responder
 * proposes while it is requested.
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
    if v_role = 'buyer' and v_e.status not in ('requested', 'scheduled') then
      raise exception '% is %, so there is nothing left to arrange.', v_e.id, v_e.status;
    end if;
    if v_role = 'responder' and v_e.status <> 'requested' then
      raise exception '% is %, so a new time cannot be proposed on it.', v_e.id, v_e.status;
    end if;
    if new.starts_at is null or new.starts_at <= now() then
      raise exception 'A time proposed has to be in the future.';
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

/* One accepted line buys once. */
create unique index if not exists enterprise_requisition_lines_quote_line_idx
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
  if new.quote_line_id is null then return new; end if;
  if current_persona() is null then return new; end if;

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
  elsif new.status is distinct from old.status or new.valid_until is distinct from old.valid_until then
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
   waiting on the desk. `ENQ-9` ids, so tests and cleanup can tell them apart.
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
   where quote_line_id in (select l.id from enquiry_lines l where l.enquiry_id like 'ENQ-9%');
  delete from enquiries where id like 'ENQ-9%';

  select name into v_nim_name from partners where id = v_nim;

  insert into enquiries (id, type, account_id, raised_by, partner_id, subject, status, currency,
                         needed_by, valid_until, format, attendees, contact_pref,
                         created_at, updated_at, decided_at) values
    ('ENQ-9001', 'quote', 'ENT-2007', 'EU-2007-01', v_nim,
     'Occupancy sensors for the Whitefield office', 'quoted', v_cur,
     current_date + 21, current_date + 30, null, null, null,
     now() - interval '6 days', now() - interval '2 days', null),
    ('ENQ-9002', 'demo', 'ENT-2007', 'EU-2007-01', v_nim,
     'Occupancy sensing walkthrough for the facilities team', 'scheduled', v_cur,
     null, null, 'video', 6, null,
     now() - interval '5 days', now() - interval '3 days', null),
    ('ENQ-9003', 'sales', 'ENT-2007', 'EU-2007-01', null,
     'Volume terms across all four sites', 'answered', v_cur,
     null, null, null, null, 'email',
     now() - interval '4 days', now() - interval '1 day', null),
    ('ENQ-9004', 'quote', 'ENT-2007', 'EU-2007-01', null,
     'Sensors and managed firewalls for the Hubli depot', 'submitted', v_cur,
     current_date + 45, null, null, null, null,
     now() - interval '1 day', now() - interval '1 day', null);

  insert into enquiry_lines (id, enquiry_id, product_id, name, partner_id, quantity,
                             target_unit_price, quoted_unit_price, sort_order)
  select v.id, v.enquiry_id, p.id, p.name, p.partner_id, v.quantity, v.target, v.quoted, v.sort_order
    from (values
      ('EQL-9001-1', 'ENQ-9001', 'SKU-5004', 120, 3800.00::numeric, 3899.00::numeric, 1),
      ('EQL-9002-1', 'ENQ-9002', 'SKU-5004',   1, null,             null,             1),
      ('EQL-9004-1', 'ENQ-9004', 'SKU-5004',  40, 4100.00,          null,             1),
      ('EQL-9004-2', 'ENQ-9004', 'SKU-6001',   4, null,             null,             2)
    ) as v(id, enquiry_id, product_id, quantity, target, quoted, sort_order)
    join products p on p.id = v.product_id;

  insert into enquiry_slots (id, enquiry_id, starts_at, proposed_by, confirmed, location, created_at) values
    ('EQS-9002-1', 'ENQ-9002', date_trunc('day', now()) + interval '8 days 4 hours 30 minutes', 'buyer', true,
     'Video call — https://meet.nimbussensors.example/smartbuild-occupancy', now() - interval '5 days'),
    ('EQS-9002-2', 'ENQ-9002', date_trunc('day', now()) + interval '9 days 9 hours', 'buyer', false,
     null, now() - interval '5 days');

  insert into enquiry_messages (id, enquiry_id, author_role, author_name, body, created_at) values
    ('EQM-9001-1', 'ENQ-9001', 'buyer', 'Vikram Shah',
     'We are fitting out the Whitefield office in two phases. 120 sensors covers both floors. Can you do better than list at this volume?',
     now() - interval '6 days'),
    ('EQM-9001-2', 'ENQ-9001', 'partner', coalesce(v_nim_name, 'Nimbus Sensors'),
     'Yes — the price on the quote holds for the full 120 and includes the gateway pairing on site. Valid for 30 days.',
     now() - interval '2 days'),
    ('EQM-9002-1', 'ENQ-9002', 'buyer', 'Vikram Shah',
     'Six of us from facilities. We mainly want to see how the occupancy dashboard handles shared desks.',
     now() - interval '5 days'),
    ('EQM-9002-2', 'ENQ-9002', 'partner', coalesce(v_nim_name, 'Nimbus Sensors'),
     'The first time works for us. The joining link is on the booking; we will bring a live floor plan from a customer site.',
     now() - interval '3 days'),
    ('EQM-9003-1', 'ENQ-9003', 'buyer', 'Vikram Shah',
     'We buy across four sites and expect to add two more this year. Is there a volume arrangement that applies across sellers?',
     now() - interval '4 days'),
    ('EQM-9003-2', 'ENQ-9003', 'operator', 'Enquiries desk',
     'There is: Business Plus accounts get a pricing review at every renewal, and multi-seller quotes come through this desk. Send us the list for the new sites and we will quote it as one.',
     now() - interval '1 day'),
    ('EQM-9004-1', 'ENQ-9004', 'buyer', 'Vikram Shah',
     'The Hubli depot opens next quarter. Sensors for cold storage and firewalls for the four buildings on site.',
     now() - interval '1 day');

  /* The trail behind each one, after the "raised" row the insert trigger
     already wrote. */
  insert into enquiry_events (id, enquiry_id, actor_role, actor_name, action, from_status, to_status, note, at) values
    ('EQE-9001-2', 'ENQ-9001', 'partner', coalesce(v_nim_name, 'Nimbus Sensors'), 'quoted', 'submitted', 'quoted',
     'Valid until ' || to_char(current_date + 30, 'DD Mon YYYY'), now() - interval '2 days'),
    ('EQE-9002-2', 'ENQ-9002', 'partner', coalesce(v_nim_name, 'Nimbus Sensors'), 'scheduled', 'requested', 'scheduled',
     null, now() - interval '3 days'),
    ('EQE-9003-2', 'ENQ-9003', 'operator', 'Enquiries desk', 'answered', 'open', 'answered',
     null, now() - interval '1 day');

  /* The seed's actor names on the "raised" rows say who asked, not "Marketplace". */
  update enquiry_events set actor_role = 'buyer', actor_name = 'Vikram Shah'
   where enquiry_id like 'ENQ-9%' and action = 'raised';
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
  select count(*) into n from enquiries where id like 'ENQ-9%';
  if n <> 4 then raise exception 'expected 4 seeded enquiries, found %', n; end if;

  /* The routing rule holds on the seed: one seller routes to that seller; two
     sellers go to the desk. Asked of the catalogue, not of what was typed. */
  select count(*) into n from enquiries e
   where e.id like 'ENQ-9%' and e.type in ('quote', 'demo')
     and e.partner_id is distinct from (
       select case when count(distinct p.partner_id) = 1 and count(*) filter (where p.partner_id is null) = 0
                   then min(p.partner_id) end
         from enquiry_lines l join products p on p.id = l.product_id
        where l.enquiry_id = e.id);
  if n > 0 then raise exception '% seeded enquiries are routed against the rule', n; end if;

  select count(*) into n from enquiries where id = 'ENQ-9001' and partner_id is not null;
  if n <> 1 then raise exception 'the single-seller quote did not route to its seller'; end if;
  select count(*) into n from enquiries where id = 'ENQ-9004' and partner_id is null;
  if n <> 1 then raise exception 'the two-seller quote did not route to the desk'; end if;
  select count(distinct partner_id) into n from enquiry_lines where enquiry_id = 'ENQ-9004';
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
end $$;
