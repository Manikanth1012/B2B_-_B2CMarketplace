/* Somewhere for a seller's listing photographs to go.
 *
 * The new-listing wizard's media step was a dashed rectangle with two buttons
 * on it, and both were `toast('Image added')` — no file input, no upload, no
 * state. A seller could press Add image six times, be told six times that an
 * image had been added, and submit a listing with no photograph on it. The
 * submission itself is real: `submitForReview` writes the product and the
 * review record the catalogue desk decides on. Only the pictures were theatre.
 *
 * `product_media` already exists and already lets a seller write rows for their
 * own products. What was missing was a bucket to put the files in — `evidence`
 * is private and for compliance documents, `kb-assets` belongs to the operator's
 * knowledge base, and neither is where a public product photograph goes.
 *
 * Public read, because that is what these are: the picture on the storefront
 * card. Write is scoped to the seller's own folder, the same shape
 * `evidence_owner_write` uses — the first path segment is the partner id and
 * the policy compares it to `current_partner_id()`.
 */

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'listing-media', 'listing-media', true,
  /* 50 MB, sized for the one short video a listing may carry. The image limit
     is 5 MB and is enforced before upload — a bucket limit is a backstop, not
     the rule a seller reads. */
  52428800,
  array['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/webm']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

/* Anyone may look at them. They end up on the public storefront, so a signed-out
   visitor has to be able to load them — the same reason `product_media` itself
   carries a public read policy. */
create policy listing_media_public_read
  on storage.objects for select
  to anon, authenticated
  using (bucket_id = 'listing-media');

/* A seller writes into their own folder and nobody else's. `foldername()[1]` is
   the partner id; anything not shaped that way matches no policy and is
   refused. */
create policy listing_media_partner_write
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'listing-media'
    and array_length(storage.foldername(name), 1) >= 2
    and (storage.foldername(name))[1] = current_partner_id()
  );

/* And removes their own — a seller who picked the wrong photograph has to be
   able to take it off before submitting. */
create policy listing_media_partner_delete
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'listing-media'
    and array_length(storage.foldername(name), 1) >= 2
    and (storage.foldername(name))[1] = current_partner_id()
  );

/* The catalogue desk reviews these and may take one down. */
create policy listing_media_operator_all
  on storage.objects for all
  to authenticated
  using (bucket_id = 'listing-media' and current_persona() = 'operator')
  with check (bucket_id = 'listing-media' and current_persona() = 'operator');

/* --------------------------------------------------------- what is true -- */

do $$
declare
  n int;
  b record;
begin
  select * into b from storage.buckets where id = 'listing-media';
  if b is null then raise exception 'the listing-media bucket was not created'; end if;
  if not b.public then raise exception 'listing-media is private, so storefront photographs would not load'; end if;

  /* The types a seller may actually send. Asked of the bucket rather than
     assumed from the statement above, because `on conflict do update` on a
     pre-existing row is where a silently different set would come from. */
  if not (b.allowed_mime_types @> array['image/jpeg', 'image/png', 'image/webp']) then
    raise exception 'listing-media does not accept the image types the form offers';
  end if;
  if not (b.allowed_mime_types @> array['video/mp4']) then
    raise exception 'listing-media does not accept video, which the form offers';
  end if;

  select count(*) into n from pg_policies
  where schemaname = 'storage' and tablename = 'objects'
    and policyname in ('listing_media_public_read', 'listing_media_partner_write',
                       'listing_media_partner_delete', 'listing_media_operator_all');
  if n <> 4 then raise exception 'listing-media has % of its 4 policies', n; end if;

  /* `product_media` is where the rows land once the listing is submitted, and a
     seller has to be able to write them for their own product. That policy
     predates this file — asserted because the upload is pointless without it,
     and a missing one would show up as a listing with photographs in storage
     and none on the product. */
  select count(*) into n from pg_policies
  where tablename = 'product_media' and policyname = 'partner_write_product_media';
  if n <> 1 then
    raise exception 'a seller cannot write product_media rows, so uploaded photographs would never reach the product';
  end if;
end $$;
