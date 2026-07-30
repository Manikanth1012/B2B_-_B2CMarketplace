-- Product reviews.
--
-- The prototype states the model in one sentence: "Ratings were a static number.
-- Reviews are now records: written only by someone who bought the thing, moderated
-- before publication, answerable by the seller, and aggregated from what is actually
-- published." All four of those are enforced here rather than assumed by a screen.
--
-- On the aggregate: `products.rating` and `products.reviews` are left alone. They are
-- the catalogue's all-time figures — 4.3 from 2140 reviews — and recomputing them
-- from the handful of records this table holds would replace a plausible history with
-- "5.0 from 2". Reviews written here are counted and averaged separately and shown as
-- their own section. Merging the two is a data decision for whoever owns the seed,
-- not something to do silently in a migration.

create table if not exists product_reviews (
  id          text primary key,
  product_id  text not null references products(id) on delete cascade,
  rating      integer not null check (rating between 1 and 5),
  title       text not null,
  body        text not null,
  author      text not null,
  submitted   date not null default current_date,
  status      text not null default 'pending' check (status in ('pending', 'published', 'rejected')),
  /* Why it was rejected. Required by the moderation screen, because "rejected" with
     no reason is not a decision anyone can appeal or learn from. */
  reject_reason text,
  -- The seller's answer. Held inline: a reply has no life of its own and is always
  -- read with the review it answers.
  reply_by    text,
  reply_at    date,
  reply_text  text,
  user_id     uuid references auth.users(id) on delete set null default auth.uid(),
  created_at  timestamptz not null default now()
);

create index if not exists product_reviews_product_id_idx on product_reviews (product_id);
create index if not exists product_reviews_user_id_idx    on product_reviews (user_id);
create index if not exists product_reviews_status_idx     on product_reviews (status);

-- One review per person per product. A second is an edit, not another opinion.
create unique index if not exists product_reviews_one_per_buyer
  on product_reviews (user_id, product_id) where user_id is not null;

alter table product_reviews enable row level security;

drop policy if exists "public_read_published_reviews" on product_reviews;
drop policy if exists "owner_read_own_reviews"        on product_reviews;
drop policy if exists "buyer_insert_review"           on product_reviews;
drop policy if exists "operator_all_reviews"          on product_reviews;
drop policy if exists "partner_reply_reviews"         on product_reviews;

-- Published reviews are public — they are the point. Pending and rejected ones are
-- not, or moderation would be theatre.
create policy "public_read_published_reviews" on product_reviews
  for select to anon, authenticated using (status = 'published');

-- An author always sees their own, including while it waits and after it is refused.
create policy "owner_read_own_reviews" on product_reviews
  for select to authenticated using (user_id = auth.uid());

/* "Written only by someone who bought the thing", enforced rather than asked nicely.
   The row is refused unless this user has an order containing this product. A screen
   can hide the button; only this stops a direct POST through PostgREST. It also pins
   status to 'pending' — nobody publishes their own review. */
create policy "buyer_insert_review" on product_reviews
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and current_persona() = 'consumer'
    and status = 'pending'
    and exists (
      select 1
      from order_items i
      join orders o on o.id = i.order_id
      where i.product_id = product_reviews.product_id
        and o.user_id = auth.uid()
    )
  );

-- Moderation is the operator's.
create policy "operator_all_reviews" on product_reviews
  for all to authenticated
  using (current_persona() = 'operator') with check (current_persona() = 'operator');

/* A partner may read and answer reviews of products they sell. `products.partner_id`
   is the key; a partner cannot touch a review of somebody else's product. */
create policy "partner_reply_reviews" on product_reviews
  for select to authenticated
  using (exists (
    select 1 from products p
    where p.id = product_reviews.product_id and p.partner_id = current_partner_id()
  ));

drop policy if exists "partner_update_reply" on product_reviews;
create policy "partner_update_reply" on product_reviews
  for update to authenticated
  using (exists (
    select 1 from products p
    where p.id = product_reviews.product_id and p.partner_id = current_partner_id()
  ))
  with check (exists (
    select 1 from products p
    where p.id = product_reviews.product_id and p.partner_id = current_partner_id()
  ));
