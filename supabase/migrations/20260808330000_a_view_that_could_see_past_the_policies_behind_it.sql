/* A view that could see past the policies behind it.
 *
 * `partner_disputes` was rebuilt as a view over `disputes` so the seller's own
 * support screen would not know the table had been generalised. The table
 * carries row-level security: a seller reads disputes where `partner_id =
 * current_partner_id()`, and nothing else.
 *
 * The view does not. A Postgres view runs with the privileges of whoever owns it
 * — the migration role — unless it is created `security_invoker`. So the
 * policies on `disputes` were evaluated as the owner, which passes everything,
 * and the view handed every seller's disputes to whoever asked.
 *
 * The integration test caught it in the plainest possible way: signed in as
 * Nimbus Sensors, `select * from partner_disputes` returned a row belonging to
 * Sentinel Cyber. Before the generalisation `partner_disputes` was a table with
 * its own policy and this could not happen; the view reintroduced it, and the
 * compatibility that made the seller's screen keep working is exactly what made
 * it stop being safe.
 *
 * Worth stating because it will come up again: making a table into a view for
 * compatibility silently drops row-level security unless you say otherwise. The
 * screens keep working, which is what makes it quiet.
 */

alter view public.partner_disputes set (security_invoker = on);

/* ---- What has to be true ------------------------------------------------------- */

do $$
declare n int; bad text;
begin
  /* ASSERT-1: the view now defers to the policies on the table under it. */
  select count(*) into n from pg_class c
    join pg_namespace ns on ns.oid = c.relnamespace
   where ns.nspname = 'public' and c.relname = 'partner_disputes'
     and c.reloptions::text like '%security_invoker=on%';
  if n <> 1 then
    raise exception 'partner_disputes still runs with its owner''s privileges';
  end if;

  /* ASSERT-2: and it still shows what it always showed — order disputes, every
     one of them, with an order on it. A fix that empties the seller's screen is
     not a fix. */
  select count(*) into n from public.partner_disputes;
  if n <> 7 then raise exception 'the seller-facing view returns % rows, not 7', n; end if;

  select count(*) into n from public.partner_disputes where order_ref is null;
  if n <> 0 then raise exception 'the seller-facing view returned % rows with no order on them', n; end if;

  /* ASSERT-3: and no NEW view has the same hole.
   *
   * Running as its owner is a hazard rather than a defect. A view that does it
   * has to carry its own filter, and two here deliberately do:
   *
   *   `my_identity_link`  filters on `l.user_id = auth.uid()` inside the view,
   *                       which is the security. Owner privileges are what let
   *                       it join `telco_identities` at all.
   *   `public_banners`    exists precisely to show live banners to a visitor who
   *                       is not signed in. Seeing past the policies on
   *                       `operator_banners` is the feature.
   *
   * `partner_disputes` filtered too — on `kind = 'order'` — and that is the
   * distinction worth holding on to: it filtered by subject matter and not by
   * viewer, so every seller got every seller's rows. The check below is an
   * allowlist of the two that are deliberate, so the third one to appear fails
   * here rather than in a year.
   */
  select string_agg(distinct v.relname, ', ') into bad
    from pg_class v
    join pg_namespace vn on vn.oid = v.relnamespace
    join pg_depend dep on dep.refobjid = v.oid and dep.deptype = 'i'
    join pg_rewrite rw on rw.oid = dep.objid
    join pg_depend d2 on d2.objid = rw.oid and d2.classid = 'pg_rewrite'::regclass
    join pg_class t on t.oid = d2.refobjid and t.relkind = 'r' and t.relrowsecurity
    join pg_namespace tn on tn.oid = t.relnamespace and tn.nspname = 'public'
   where vn.nspname = 'public' and v.relkind = 'v'
     and v.relname not in ('my_identity_link', 'public_banners')
     and coalesce(v.reloptions::text, '') not like '%security_invoker=on%';

  if bad is not null then
    raise exception
      'views reading a row-secured table with their owner''s privileges, so the policies do not apply: %. '
      'If that is deliberate the view has to filter by viewer itself — add it to the list in this migration '
      'with the reason.',
      bad;
  end if;
end $$;
