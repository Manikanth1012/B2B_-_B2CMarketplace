-- Who a piece of the knowledge base is for, enforced where it is decided.
--
-- Two problems, one shape.
--
-- First: an article or a question is published to *personas* — retail
-- customers, business accounts, sellers, staff — and there is no way to
-- address one to a particular seller. "Nimbus Sensors: your cold-chain
-- certification expires in March" is a real thing an operator needs to say,
-- and saying it to every seller is how nobody reads any of them.
--
-- Second, and worse: none of the existing audience rules were enforced by the
-- database. `public_read_kb_articles` allowed any published article to
-- anybody, and `read_kb_faqs` had no condition at all — `using (true)` — so
-- every question including unpublished drafts was readable by every signed-in
-- user and by anonymous visitors. The persona filtering was done in the client
-- and was therefore a display preference, not a rule. Anyone reading the REST
-- endpoint directly saw the lot.
--
-- So `audience_ids` is added, and the read policies are rewritten to enforce
-- both the persona and the named audience. Empty means "everyone in the
-- personas this is published to", which is what every existing row means and
-- so is the default.

/* =============================================== who a reader counts as === */

/* Every id that identifies this reader — their seller id, their account id,
   their customer id, whichever they have. One function so the two policies
   below cannot drift, and security definer so it can read the mapping tables a
   reader is not otherwise entitled to. */
create or replace function current_audience_ids()
returns text[] language sql stable security definer set search_path = public as $$
  select array_remove(array[
    current_partner_id(),
    current_account_id(),
    current_customer_id()
  ], null)
$$;

grant execute on function current_audience_ids() to anon, authenticated;

/* ==================================================== the column itself === */

alter table kb_articles add column if not exists audience_ids text[] not null default '{}';
alter table kb_faqs     add column if not exists audience_ids text[] not null default '{}';

comment on column kb_articles.audience_ids is
  'Empty means everyone in `personas`. Otherwise the specific seller ids, account ids or customer ids this is addressed to — narrowing `personas`, never widening it.';
comment on column kb_faqs.audience_ids is
  'Empty means everyone in `personas`. Otherwise the specific readers it is addressed to.';

/* ========================================================= the reading === */

drop policy if exists "public_read_kb_articles" on kb_articles;
drop policy if exists "read_kb_faqs" on kb_faqs;
drop policy if exists "kb_articles_read" on kb_articles;
drop policy if exists "kb_faqs_read" on kb_faqs;

/* Published, addressed to a persona this reader is, and either addressed to
   everybody or to them by name.

   A signed-out visitor has no persona and no ids, so they get what is
   published to retail customers and addressed to everybody — which is the
   public help the storefront links to, and nothing else. Before this they
   could read staff articles. */
create policy "kb_articles_read" on kb_articles for select to anon, authenticated
  using (
    status = 'published'
    and personas @> array[coalesce(current_persona(), 'consumer')]
    and (
      cardinality(audience_ids) = 0
      or audience_ids && current_audience_ids()
    )
  );

create policy "kb_faqs_read" on kb_faqs for select to anon, authenticated
  using (
    status = 'published'
    and personas @> array[coalesce(current_persona(), 'consumer')]
    and (
      cardinality(audience_ids) = 0
      or audience_ids && current_audience_ids()
    )
  );

/* The operator's own ALL policies are untouched: they author this, so they read
   drafts and everything addressed to anybody. `current_persona() = 'operator'`
   already covers it. */

/* ------------------------------------------- what the guard cannot say -- */

/* An article addressed to a named reader who is not in any of its personas can
   never be read by anybody — the two conditions are ANDed. That is a mistake
   at authoring time rather than a permission question, so it is refused on the
   way in rather than discovered by the reader it was written for. */
create or replace function guard_kb_audience()
returns trigger language plpgsql security definer set search_path = public as $$
declare bad text;
begin
  if current_persona() is null then return new; end if;
  if cardinality(new.audience_ids) = 0 then return new; end if;

  if cardinality(new.personas) = 0 then
    raise exception 'This is addressed to % by name but published to no audience at all, so nobody could read it.',
      array_to_string(new.audience_ids, ', ');
  end if;

  /* Every named id has to belong to somebody in one of the chosen personas. */
  select string_agg(x, ', ') into bad from unnest(new.audience_ids) x
   where not (
     ('partner'    = any(new.personas) and exists (select 1 from partners   p where p.id = x))
     or ('enterprise' = any(new.personas) and exists (select 1 from enterprise_accounts a where a.id = x))
     or ('consumer'   = any(new.personas) and exists (select 1 from consumer_profile c where c.customer_id = x))
   );
  if bad is not null then
    raise exception '% is not a reader in any of the audiences this is published to (%).',
      bad, array_to_string(new.personas, ', ');
  end if;

  return new;
end $$;

drop trigger if exists guard_kb_articles_audience on kb_articles;
create trigger guard_kb_articles_audience before insert or update on kb_articles
  for each row execute function guard_kb_audience();

drop trigger if exists guard_kb_faqs_audience on kb_faqs;
create trigger guard_kb_faqs_audience before insert or update on kb_faqs
  for each row execute function guard_kb_audience();

/* ================================================= something to look at === */

/* One question addressed to one seller, so the feature is exercised by the
   seed rather than only by a test. Nimbus Sensors is the demo seller, and cold
   chain is what they actually sell. */
insert into kb_faqs (id, question, answer, personas, topic, status, asked, helpful,
                     article_id, updated, updated_by, sort_order, audience_ids)
values (
  'FAQ-NIMBUS-COLDCHAIN',
  'Why does my cold-chain listing need a calibration certificate every year?',
  'Cold-chain sensors are sold against a temperature accuracy claim, and that claim is only as good as the last calibration. Your category agreement requires a certificate issued within the last twelve months for each sensor model on the shelf. Upload it against the listing under Documents; the marketplace checks the issue date, not the file name. A listing whose certificate lapses stays visible but stops being sellable into pharmaceutical and food categories until a current one is filed.',
  array['partner'], 'Your categories', 'published', 34, 31,
  null, to_char(now(), 'YYYY-MM-DD'), 'Anika Sharma', 90,
  array['PTR-1004']
)
on conflict (id) do update set
  answer = excluded.answer, audience_ids = excluded.audience_ids,
  personas = excluded.personas, status = excluded.status;

/* -------------------------------------------------------- sanity checks -- */
do $$
declare n integer; s text;
begin
  /* Every existing row means "everyone in my personas", which is what the
     default says. Nothing should have been narrowed by this migration. */
  select count(*) into n from kb_articles where cardinality(audience_ids) > 0;
  if n <> 0 then raise exception '% articles were narrowed by this migration; none should have been', n; end if;

  /* The one seeded exception. */
  select count(*) into n from kb_faqs where cardinality(audience_ids) > 0;
  if n <> 1 then raise exception 'expected exactly one addressed question, found %', n; end if;

  /* Nothing is addressed to a reader who cannot be in its audience — the guard
     enforces this going forward and this is the state it inherits. */
  select string_agg(f.id, ', ') into s from kb_faqs f
   where cardinality(f.audience_ids) > 0
     and not exists (
       select 1 from unnest(f.audience_ids) x
        where ('partner' = any(f.personas) and exists (select 1 from partners p where p.id = x))
           or ('enterprise' = any(f.personas) and exists (select 1 from enterprise_accounts a where a.id = x))
           or ('consumer' = any(f.personas) and exists (select 1 from consumer_profile c where c.customer_id = x)));
  if s is not null then raise exception 'these questions are addressed to nobody who could read them: %', s; end if;

  /* And the hole that was there before: a FAQ read policy with no condition. */
  select count(*) into n from pg_policies
   where tablename = 'kb_faqs' and cmd = 'SELECT' and qual = 'true';
  if n > 0 then raise exception 'kb_faqs still has an unconditional read policy'; end if;

  /* Every persona still has something published to it, or this migration has
     quietly emptied somebody's knowledge base. */
  foreach s in array array['consumer','enterprise','partner','operator'] loop
    select count(*) into n from kb_articles
     where status = 'published' and personas @> array[s] and cardinality(audience_ids) = 0;
    if n = 0 then raise exception '% now has no generally-published articles', s; end if;
  end loop;
end $$;
