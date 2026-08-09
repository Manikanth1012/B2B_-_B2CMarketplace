/* Nineteen reviews with nobody behind them.
 *
 * Every other record in this marketplace traces to something. An order points
 * at a requisition, a note at the statement it lands on, a dispute at its
 * subject, an agreement at a signed PDF. A review points at a product and
 * carries a name typed into a text column, and that is all: of twenty-four,
 * five carried a `user_id` and nineteen carried a string.
 *
 * So the marketplace publishes a five-star review on a live product and cannot
 * answer the only question anybody asks about a review — did this person buy
 * this thing.
 *
 * WHAT THE NAMES TURNED OUT TO BE
 *
 * Not noise. Thirteen of the nineteen resolve to real parties already in the
 * database — Brightline Foods is ENT-2011, Arun Deshpande is a consumer
 * profile, Northwind Mobility is PTR-1012. They were never linked, but they
 * were never invented either. Of those thirteen, nine turn out to have actually
 * bought the thing they reviewed, and the orders are on the book.
 *
 * FOUR ARE PUBLISHED WITH NO PURCHASE BEHIND THEM, AND THEY DIFFER
 *
 * Three are real customers reviewing something they do not own. Arun's text is
 * unmistakably a K9 Pro review — "camera is a clear step up from the K7 I traded
 * in" — and he has three orders, none of them a handset. The reviews and the
 * orders were seeded independently and nobody ever crossed them.
 *
 * The fourth is different in kind: Northwind Mobility is a seller on this
 * marketplace, reviewing a rival's occupancy sensor. That is not a missing
 * link, it is a conflict of interest, and no amount of provenance makes it
 * publishable.
 *
 * WHY UNVERIFIED REVIEWS ARE NOT DELETED
 *
 * The obvious rule — a review must trace to a purchase or it does not go up —
 * is stricter than anything actually operated anywhere, and it would silently
 * remove things people wrote. Every marketplace of any size publishes
 * unverified reviews and badges the verified ones, because "I bought this" and
 * "this is worth reading" are different claims and the reader can weigh them
 * separately.
 *
 * So the verified ones are linked to the order that proves it, the unverified
 * ones say so on their face, and the moderation queue is told which is which
 * before somebody presses publish.
 *
 * AND THE BADGE IS THE POINTER, NOT A FLAG BESIDE IT
 *
 * No `verified` boolean. `order_ref` either names the purchase or it does not,
 * and that is the whole of it — a flag next to the evidence is a second copy of
 * one fact, and this codebase has spent two days repairing exactly that shape.
 */

/* ---- 1. What a review points at ------------------------------------------------- */

alter table public.product_reviews
  /* The customer record, not the login.
   *
     `user_id` is an auth user, and four of the seven shoppers in this seed have
     no login at all — Arun Deshpande is a real customer with three orders and
     no way to sign in, which is ordinary for a marketplace that takes guest
     checkouts. Linking reviews only to `user_id` left three named customers
     reading as "not linked to any account", which understates what is actually
     known about them by a long way. */
  add column if not exists customer_id text references public.consumer_profile(id),
  add column if not exists account_id text references public.enterprise_accounts(id),
  /* The purchase this review is about. Null is not a defect — it is an
     unverified review, which is a thing that legitimately exists. */
  add column if not exists order_ref text,
  add column if not exists linked_on date;

create index if not exists product_reviews_order on public.product_reviews(order_ref);

/* ---- 2. Link the ones that trace ------------------------------------------------- */

/* Name matching, once, here. Deliberately not in a trigger: a runtime rule that
 * resolves an author by typing their name would let anybody claim to be
 * Brightline Foods. At runtime the author is whoever is signed in, and that is
 * what section 3 enforces. This is a backfill over data written before the
 * column existed, and it is checked afterwards rather than trusted.
 */
update public.product_reviews r
   set customer_id = c.id,
       user_id = coalesce(r.user_id, c.user_id)
  from public.consumer_profile c
 where c.name = r.author and r.customer_id is null;

update public.product_reviews r
   set account_id = a.id
  from public.enterprise_accounts a
 where a.company = r.author and r.account_id is null;

/* The earliest order for that party containing the product. Earliest rather
 * than latest: the review is about the first time they had it, and a later
 * repeat purchase does not change who is speaking. */
update public.product_reviews r
   set order_ref = (
     select o.order_ref
       from public.orders o
       join public.order_items i on i.order_id = o.id
      where i.product_id = r.product_id
        and ((r.account_id is not null and o.account_id = r.account_id)
             or (r.user_id is not null and o.user_id = r.user_id)
             /* By email as well as by login, because a customer without an auth
                user still has orders and they are keyed on the address. */
             or (r.customer_id is not null and o.buyer_email = (
                   select c.email from public.consumer_profile c where c.id = r.customer_id)))
      order by o.created_at limit 1),
       linked_on = current_date
 where r.order_ref is null;

/* ---- 3. What may not be reviewed at all ----------------------------------------- */

create or replace function public.guard_product_review()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare v_seller text;
begin
  /* A seller does not review on the marketplace they sell through. Their own
     products for obvious reasons, and a rival's for less obvious but worse
     ones — REV-7005 is a seller giving a competitor's sensor four stars, which
     reads as generous until you notice who wrote it. There is no version of
     this that is fine, so it is refused rather than moderated. */
  /* Rejecting one is the remedy, so the remedy must not meet the rule. This
     refused the very update that takes REV-7005 down — the same shape as the
     contract guard, where withdrawing a requisition had to stay possible after
     the agreement lapsed. A rule that blocks its own cure is a rule nobody can
     apply. */
  if new.status = 'rejected' then return new; end if;

  select p.name into v_seller from public.partners p where p.name = new.author;
  if v_seller is not null then
    raise exception
      '% sells on this marketplace and cannot review products on it. A seller reviewing '
      'anything here — their own listing or a rival''s — is a conflict the reader cannot see.',
      new.author;
  end if;

  /* An order reference on a review has to be an order that contains the
     product. Otherwise the badge says "verified purchase" against a purchase of
     something else. */
  if new.order_ref is not null then
    if not exists (
      select 1 from public.orders o
        join public.order_items i on i.order_id = o.id
       where o.order_ref = new.order_ref and i.product_id = new.product_id)
    then
      raise exception
        '% does not contain %, so it cannot be the purchase behind this review.',
        new.order_ref, new.product_id;
    end if;
  end if;

  return new;
end $$;

drop trigger if exists z_guard_product_review on public.product_reviews;
create trigger z_guard_product_review
  before insert or update on public.product_reviews
  for each row execute function public.guard_product_review();

/* ---- 4. The two that cannot stand ------------------------------------------------ */

update public.product_reviews
   set status = 'rejected',
       reject_reason = 'Northwind Mobility sells on this marketplace. A seller reviewing a '
                       'product listed here — a rival''s as much as their own — is a conflict '
                       'the reader has no way of seeing, so it is not published whatever it says.'
 where id = 'REV-7005' and status <> 'rejected';

update public.product_reviews
   set status = 'rejected',
       reject_reason = 'Left over from testing the review form — the body is keyboard mash '
                       'and the author is not a customer.'
 where id = 'REV-7015' and status <> 'rejected';

/* ---- 5. Where a review came from, as one row ------------------------------------- */

/* Dropped rather than replaced: `create or replace view` refuses to change the
   shape of an existing one, and this gains a column on re-run. */
drop view if exists public.product_review_provenance;
create view public.product_review_provenance as
  select r.id, r.product_id, p.name as product_name, p.seller,
         r.rating, r.title, r.body, r.author, r.submitted, r.status,
         r.reject_reason, r.reply_by, r.reply_at, r.reply_text,
         r.user_id, r.customer_id, r.account_id, r.order_ref,
         (r.order_ref is not null) as verified,
         /* What the moderator needs before pressing publish, in words rather
            than as three columns they have to combine. */
         case
           when r.order_ref is not null then 'Verified purchase'
           when r.customer_id is not null or r.account_id is not null
             then 'Known customer, no purchase of this product on file'
           else 'Not linked to any account'
         end as provenance
    from public.product_reviews r
    join public.products p on p.id = r.product_id;

alter view public.product_review_provenance set (security_invoker = on);
grant select on public.product_review_provenance to authenticated, anon;

/* ---- What has to be true ------------------------------------------------------- */

do $$
declare bad text; n int;
begin
  /* ASSERT-1: every link points at an order that really contains the product.
     A badge reading "verified purchase" against a purchase of something else is
     worse than no badge. */
  select string_agg(format('%s cites %s for %s', r.id, r.order_ref, r.product_id), '; ') into bad
    from public.product_reviews r
   where r.order_ref is not null
     and not exists (select 1 from public.orders o
                       join public.order_items i on i.order_id = o.id
                      where o.order_ref = r.order_ref and i.product_id = r.product_id);
  if bad is not null then raise exception 'reviews citing an order that does not contain them: %', bad; end if;

  /* ASSERT-2: and the order belongs to whoever wrote the review. Otherwise the
     badge is somebody else's receipt. */
  select string_agg(r.id, ', ') into bad
    from public.product_reviews r
    join public.orders o on o.order_ref = r.order_ref
   where r.order_ref is not null
     and coalesce(o.account_id, '') is distinct from coalesce(r.account_id, '')
     and (r.user_id is null or o.user_id is distinct from r.user_id)
     and o.buyer_email is distinct from (
       select c.email from public.consumer_profile c where c.id = r.customer_id);
  if bad is not null then raise exception 'reviews linked to somebody else''s order: %', bad; end if;

  /* ASSERT-3: no seller has a review on the book. The guard refuses new ones;
     this is the check that the existing one went. */
  select string_agg(format('%s by %s', r.id, r.author), '; ') into bad
    from public.product_reviews r
    join public.partners p on p.name = r.author
   where r.status <> 'rejected';
  if bad is not null then raise exception 'sellers reviewing on the marketplace they sell through: %', bad; end if;

  /* ASSERT-4: something is actually verified, or the badge is decoration. */
  select count(*) into n from public.product_reviews where order_ref is not null;
  if n < 5 then raise exception 'only % reviews trace to a purchase, so the badge is untested', n; end if;

  /* ASSERT-5: and something is not, or the unverified path is untested. Both
     halves have to exist for either to mean anything. */
  select count(*) into n from public.product_reviews
   where order_ref is null and status = 'published';
  if n = 0 then raise exception 'no published review is unverified, so that label is unexercised'; end if;

  /* ASSERT-6: the view says one of its three things about every review, and
     never claims a purchase it cannot show. */
  select count(*) into n from public.product_review_provenance
   where provenance not in ('Verified purchase',
                            'Known customer, no purchase of this product on file',
                            'Not linked to any account');
  if n <> 0 then raise exception '% reviews with an unrecognised provenance', n; end if;

  select count(*) into n from public.product_review_provenance
   where verified and order_ref is null;
  if n <> 0 then raise exception '% reviews badged verified with no order behind them', n; end if;

  /* ASSERT-6b: and the middle case exists. A customer we can name who has no
     purchase of this product is a different thing from a stranger, and the
     moderator needs the difference — with only the two extremes on the book,
     the label between them is never seen. */
  select count(*) into n from public.product_review_provenance
   where provenance = 'Known customer, no purchase of this product on file';
  if n = 0 then raise exception 'no review sits between verified and anonymous, so that label is untested'; end if;

  /* ASSERT-6c: nobody we can identify is filed as a stranger. Three named
     customers read that way because they have no login, which says nothing
     about whether we know who they are. */
  select string_agg(format('%s by %s', r.id, r.author), '; ') into bad
    from public.product_reviews r
   where r.customer_id is null and r.account_id is null
     and (exists (select 1 from public.consumer_profile c where c.name = r.author)
          or exists (select 1 from public.enterprise_accounts a where a.company = r.author));
  if bad is not null then raise exception 'reviews by somebody we can name, filed as anonymous: %', bad; end if;

  /* ASSERT-7: the view cannot be read past the policies underneath it. */
  select count(*) into n from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
   where ns.nspname = 'public' and c.relname = 'product_review_provenance'
     and 'security_invoker=on' = any(c.reloptions);
  if n <> 1 then raise exception 'product_review_provenance does not run as its caller'; end if;

  select count(*) into n from public.product_reviews where order_ref is not null;
  raise notice '% of % reviews now trace to the purchase behind them',
    n, (select count(*) from public.product_reviews);
end $$;
