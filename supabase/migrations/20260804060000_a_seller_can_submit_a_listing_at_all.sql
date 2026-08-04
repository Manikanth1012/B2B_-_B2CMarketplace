/* A seller could not create a listing.
 *
 * `submitForReview` writes three rows: the product, the review record the
 * catalogue desk decides on, and — since the wizard learned to ask — the
 * bundle's components. `products` carried a policy for the operator and a read
 * policy for everyone, and nothing else. So every seller submission was refused
 * at the first insert with "new row violates row-level security policy for
 * table products", and had been since the function was written.
 *
 * The same shape as the requisition lines: the screen was built, the function
 * was written, and the grant that would let the persona it exists for actually
 * use it was never made. It hid for the same reason too — the wizard's own
 * submit button reported the failure honestly to a seller nobody was watching.
 *
 * `product_prices` is the exception and worth noting: it already had seller
 * INSERT and UPDATE policies, and they already checked that the currency is one
 * its markets trade in. That half was waiting for a form that asked for a price
 * per currency, which is what it now gets.
 */

/* --------------------------------------------------------------- create -- */

/* A seller creates their own listings, and only in `pending`.
 *
 * The status is in the policy rather than left to the caller. Publishing is the
 * catalogue desk's decision, and a seller who could insert `status = 'live'`
 * would be on the storefront without anybody having looked — which is the whole
 * of the review process, bypassed by one field. */
create policy partner_insert_own_products
  on products for insert to authenticated
  with check (
    partner_id is not null
    and partner_id = current_partner_id()
    and status = 'pending'
  );

/* And may correct one while it is still waiting. Bounded the same way: the row
   has to stay theirs and stay pending, so this cannot be used to approve a
   listing or hand it to somebody else. */
create policy partner_update_pending_products
  on products for update to authenticated
  using (partner_id = current_partner_id() and status = 'pending')
  with check (partner_id = current_partner_id() and status = 'pending');

/* Withdrawing before the desk has looked, and — the reason this cannot be left
   out — the rollback inside `submitForReview`. It deletes the product when the
   review record fails to write, so that a listing nobody will ever look at is
   not left behind. Without this the rollback silently does nothing and the
   orphan stays. */
create policy partner_delete_pending_products
  on products for delete to authenticated
  using (partner_id = current_partner_id() and status = 'pending');

/* ---------------------------------------------------------- the queue ---- */

/* The seller queues their own submission and can watch it. `loadSellerSubmissions`
   reads this table filtered by partner — with only the operator's policy on it,
   that query returned nothing and the seller's own submissions page was empty
   whatever they had sent. */
create policy partner_read_own_listing_reviews
  on operator_listings for select to authenticated
  using (partner_id = current_partner_id());

create policy partner_insert_own_listing_reviews
  on operator_listings for insert to authenticated
  with check (partner_id = current_partner_id() and status = 'pending');

/* Paired with the product delete above: the same rollback removes the product,
   and the cascade takes this with it only if the foreign key says so. Granting
   the delete explicitly means the undo works whichever row failed. */
create policy partner_delete_own_pending_reviews
  on operator_listings for delete to authenticated
  using (partner_id = current_partner_id() and status = 'pending');

/* -------------------------------------------------------- bundle parts --- */

/* What a seller's own bundle is made of. Both ends are checked: the bundle has
   to be theirs, and so does every component in it — a bundle of somebody else's
   products is a claim about stock the seller does not hold. */
create policy partner_write_own_components
  on product_components for all to authenticated
  using (
    exists (select 1 from products b where b.id = product_components.bundle_id and b.partner_id = current_partner_id())
  )
  with check (
    exists (select 1 from products b where b.id = product_components.bundle_id and b.partner_id = current_partner_id())
    and exists (select 1 from products c where c.id = product_components.component_id and c.partner_id = current_partner_id())
  );

/* --------------------------------------------------------- what is true -- */

do $$
declare
  n int;
begin
  /* Each grant exists and is the command it was meant to be. A policy created
     `for all` where `for insert` was intended still creates cleanly and gives
     away far more. */
  select count(*) into n from pg_policies
  where tablename = 'products' and policyname = 'partner_insert_own_products' and cmd = 'INSERT';
  if n <> 1 then raise exception 'a seller still cannot create a listing'; end if;

  select count(*) into n from pg_policies
  where tablename = 'operator_listings'
    and policyname in ('partner_read_own_listing_reviews', 'partner_insert_own_listing_reviews',
                       'partner_delete_own_pending_reviews');
  if n <> 3 then raise exception 'the seller queue policies are incomplete (% of 3)', n; end if;

  select count(*) into n from pg_policies
  where tablename = 'product_components' and policyname = 'partner_write_own_components';
  if n <> 1 then raise exception 'a seller cannot record what their bundle contains'; end if;

  /* The status condition is in the policy text. Asserted because it is the one
     thing standing between a seller and the storefront — a version of this
     policy without it would pass every other check here. */
  select count(*) into n from pg_policies
  where tablename = 'products' and policyname = 'partner_insert_own_products'
    and with_check like '%pending%';
  if n <> 1 then
    raise exception 'the insert policy does not pin the status to pending — a seller could publish themselves';
  end if;

  /* And the operator keeps everything it had. These are additions; a narrowing
     would show up here. */
  select count(*) into n from pg_policies
  where tablename = 'products' and policyname = 'operator_all_products';
  if n <> 1 then raise exception 'the operator lost its policy on products'; end if;

  select count(*) into n from pg_policies
  where tablename = 'products' and policyname = 'public_read_products';
  if n <> 1 then raise exception 'the storefront lost its read of products'; end if;
end $$;
