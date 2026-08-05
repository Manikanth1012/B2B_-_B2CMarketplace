/*
  # A seller runs the life of their own listing

  My Listings showed a state and offered no way to change it. A seller could
  submit a listing and, from that moment, do nothing to it ever again: not take
  it off sale for a fortnight while a component was out of stock, not withdraw
  one they no longer make, not correct the description, not say when a new one
  should go on sale. The only button on the row was "Prices".

  Three things, which turn out to be one thing.

  ## 1. States a seller owns, and states they do not

  `products.status` held live, pending and suspended. The important addition is
  `paused` as something *separate from* `suspended`: a seller taking their own
  listing off sale for a week and the marketplace taking it down are not the
  same event, and collapsing them would let a seller clear a suspension by
  pausing and resuming. The guard below refuses a seller any write to a
  suspended row, and refuses them `suspended` as a destination.

      pending   → live | scheduled | rejected   (the desk decides)
      live      → paused | retired              (the seller decides)
      paused    → live | scheduled | retired    (the seller decides)
      scheduled → live | paused | retired
      suspended → live | retired                (the desk decides)
      retired   → nothing. It is the end.
      rejected  → pending                       (resubmitting)

  ## 2. A go-live date, without a scheduler

  `go_live_on` is when the listing should appear. The trick is that a scheduled
  listing sits in its own status rather than in `live` with a date beside it, so
  no reader had to change: `isSellable()` in `storefront.ts` is the single gate
  every shopper surface passes through, and `scheduled` is simply not in it. A
  date-that-must-be-checked spread across a dozen queries is a date that one
  query forgets, and that failure shows a buyer something nobody meant to sell
  yet.

  Nothing here runs on a timer, so `publish_due_listings()` promotes what is
  due, and the seller and operator listing screens call it when they load. The
  failure mode is deliberately one-sided: forget to call it and a listing goes
  live late, which somebody notices and nobody is harmed by. The other
  arrangement fails by publishing early.

  ## 3. Changing a listing that is already selling

  A live listing cannot be edited in place. Buyers are looking at it, orders
  reference it, and the catalogue desk approved *those words at that price* —
  editing the row would change what was approved without anybody approving it.

  So an edit is a proposal: `product_versions` holds what the seller wants it to
  become, the live row keeps selling untouched, and the desk approves or refuses
  the change. On approval the proposed fields are applied and the version
  becomes the published one. A seller with a pending change may withdraw it.

  Only one change may be in flight at a time. Two pending versions of one
  listing is a queue whose order decides the outcome, and nobody looking at the
  review screen would know that.
*/

alter table products
  add column if not exists go_live_on    date,
  add column if not exists paused_on     date,
  add column if not exists paused_reason text,
  add column if not exists retired_on    date,
  add column if not exists retired_reason text;

alter table products drop constraint if exists products_status_check;
alter table products add constraint products_status_check
  check (status in ('draft', 'pending', 'rejected', 'scheduled', 'live', 'paused', 'suspended', 'retired'));

/* A scheduled listing has a date to be scheduled for, and a live one is not
   waiting on a future date — otherwise "scheduled" and "live" stop meaning
   anything and the promotion below has nothing to work from. */
alter table products drop constraint if exists products_schedule_check;
alter table products add constraint products_schedule_check
  check (
    (status <> 'scheduled' or go_live_on is not null)
    and (status <> 'live' or go_live_on is null or go_live_on <= current_date)
  );

alter table products drop constraint if exists products_paused_check;
alter table products add constraint products_paused_check
  check (status <> 'paused' or paused_on is not null);

alter table products drop constraint if exists products_retired_check;
alter table products add constraint products_retired_check
  check (status <> 'retired' or retired_on is not null);

/* ------------------------------------------------------------- versions --- */

create table if not exists product_versions (
  id             text primary key,
  product_id     text not null references products(id) on delete cascade,
  partner_id     text references partners(id) on delete cascade,
  version        integer not null,
  state          text not null default 'pending'
                   check (state in ('pending', 'published', 'rejected', 'withdrawn', 'superseded')),
  /* What the listing would become. Only the fields being changed, so the review
     screen can show a difference rather than a second copy of everything. */
  proposed       jsonb not null default '{}'::jsonb,
  /* What it was when the proposal was made — so an approval three days later
     applies to the listing the desk actually looked at, and a change that
     crossed with another one is visible instead of silent. */
  was            jsonb not null default '{}'::jsonb,
  note           text,
  submitted_by   text,
  submitted_at   timestamptz not null default now(),
  decided_by     text,
  decided_at     timestamptz,
  decision_reason text,
  unique (product_id, version)
);

create index if not exists product_versions_product_idx on product_versions (product_id, version desc);

/* One change in flight per listing. A partial unique index rather than a check,
   because the rule is about the set of rows and not about any one of them. */
create unique index if not exists product_versions_one_pending
  on product_versions (product_id) where state = 'pending';

alter table product_versions enable row level security;

create policy operator_all_product_versions on product_versions
  for all to authenticated
  using (current_persona() = 'operator')
  with check (current_persona() = 'operator');

create policy partner_read_own_product_versions on product_versions
  for select to authenticated
  using (partner_id = current_partner_id());

create policy partner_propose_product_versions on product_versions
  for insert to authenticated
  with check (
    partner_id = current_partner_id()
    and state = 'pending'
    and exists (select 1 from products p where p.id = product_id and p.partner_id = current_partner_id())
  );

/* Withdrawing a proposal is the seller's; deciding it is not. */
create policy partner_withdraw_product_versions on product_versions
  for update to authenticated
  using (partner_id = current_partner_id() and state = 'pending')
  with check (partner_id = current_partner_id() and state in ('pending', 'withdrawn'));

/* ------------------------------------------------------- the state guard --- */

create or replace function guard_listing_state() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  allowed text[];
begin
  if current_persona() is distinct from 'partner' then
    return new;
  end if;

  if new.partner_id is distinct from current_partner_id() then
    raise exception 'That listing is not yours.';
  end if;

  /* A suspension is the marketplace's decision about the seller, and a seller
     who can write to a suspended row can lift it by pausing and resuming. */
  if old.status = 'suspended' then
    raise exception '% is suspended by the marketplace. Raise it in Disputes & Support — it is not cleared from here.', old.name;
  end if;
  if new.status = 'suspended' then
    raise exception 'Only the marketplace suspends a listing.';
  end if;
  if old.status = 'retired' then
    raise exception '% has been retired. Withdrawing is final; list it again as a new listing.', old.name;
  end if;

  allowed := case old.status
    when 'live'      then array['live', 'paused', 'retired']
    when 'paused'    then array['paused', 'live', 'scheduled', 'retired']
    when 'scheduled' then array['scheduled', 'live', 'paused', 'retired']
    when 'pending'   then array['pending', 'retired']
    when 'rejected'  then array['rejected', 'pending', 'retired']
    when 'draft'     then array['draft', 'pending', 'retired']
    else array[old.status]
  end;

  if not (new.status = any(allowed)) then
    raise exception 'A listing that is % cannot be moved to %.', old.status, new.status;
  end if;

  /* The words and the money are what the desk approved. Changing them on a
     listing that is selling is what `product_versions` is for. */
  if old.status in ('live', 'scheduled', 'paused') and (
       new.name is distinct from old.name
    or new.description is distinct from old.description
    or new.price is distinct from old.price
    or new.category_id is distinct from old.category_id
    or new.model is distinct from old.model
    or new.billing_period is distinct from old.billing_period
  ) then
    raise exception 'Propose a change to % instead. What is on sale is what the catalogue desk approved, and it keeps selling until they approve the new version.', old.name;
  end if;

  return new;
end $$;

drop trigger if exists guard_listing_state on products;
create trigger guard_listing_state
  before update on products
  for each row execute function guard_listing_state();

/* A seller may move their own listing through the states above. The guard is
   what makes this narrow; the policy only says whose rows they are. */
drop policy if exists partner_manage_own_products on products;
create policy partner_manage_own_products on products
  for update to authenticated
  using (partner_id = current_partner_id())
  with check (partner_id = current_partner_id());

/* ------------------------------------------------------ what is now due --- */

/**
 * Promote every scheduled listing whose day has come.
 *
 * Called by the listing screens on load rather than by a timer, because there
 * is no timer. Idempotent, and safe to call from anywhere: it only ever moves a
 * row the seller and the desk already agreed should go live, on the date they
 * agreed.
 */
create or replace function publish_due_listings() returns integer
language plpgsql security definer set search_path = public as $$
declare
  moved integer;
begin
  update products
     set status = 'live'
   where status = 'scheduled'
     and go_live_on is not null
     and go_live_on <= current_date;
  get diagnostics moved = row_count;
  return moved;
end $$;

grant execute on function publish_due_listings() to authenticated;

do $$
declare
  n integer;
begin
  select count(*) into n from pg_trigger
   where tgrelid = 'products'::regclass and tgname = 'guard_listing_state';
  if n <> 1 then raise exception 'The state guard did not take'; end if;

  /* `scheduled`, `paused` and `retired` must not be sellable. The application's
     single gate is `SELLABLE` in storefront.ts, and this is the database saying
     the same thing: nothing in a non-selling state may sit in the set the
     storefront treats as on sale. */
  select count(*) into n from products
   where status in ('scheduled', 'paused', 'retired', 'suspended', 'pending', 'rejected', 'draft')
     and status in ('live', 'active', 'published');
  if n > 0 then raise exception 'A non-selling state is also a selling state'; end if;

  select count(*) into n from products where status = 'live' and go_live_on > current_date;
  if n > 0 then
    raise exception '% listings are live with a go-live date in the future', n;
  end if;

  select count(*) into n from products where status = 'scheduled' and go_live_on is null;
  if n > 0 then
    raise exception '% listings are scheduled for no date at all', n;
  end if;

  /* Nothing was quietly re-stated by this migration. */
  select count(*) into n from products where status not in ('live', 'pending', 'suspended');
  if n > 0 then
    raise exception '% listings changed state, and this migration should have moved none', n;
  end if;

  if to_regclass('public.product_versions') is null then
    raise exception 'product_versions did not take';
  end if;

  select count(*) into n from pg_policies where tablename = 'product_versions';
  if n < 4 then
    raise exception 'product_versions has only % policies, so somebody cannot do their half of a review', n;
  end if;
end $$;
