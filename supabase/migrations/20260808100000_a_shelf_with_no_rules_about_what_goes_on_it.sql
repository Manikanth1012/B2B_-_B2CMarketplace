/* A policy nobody can change, and mostly nobody reads.
 *
 * Correcting the record first, because the plan this migration came from was
 * written against a bad measurement. Three things I reported as absent are
 * present:
 *
 *   `policy_rules` — the ten-rule catalogue, each with how it is checked, what
 *   it rests on, who owns it, what evidence it needs, whether it blocks and
 *   whether it can be appealed. Fully populated.
 *
 *   `category_policy_rules` — the rule × category matrix, off/warn/enforce.
 *
 *   `category_policy` — review mode, auto-publish, returns window, review SLA,
 *   price floor, rating bar and listings-per-seller cap, for all six shelves.
 *
 * And `applyPolicy` in `catalogue.ts` genuinely evaluates the matrix against a
 * listing, checking the automatable rules itself. That is more than I credited
 * and none of it needed building.
 *
 * What is actually wrong is narrower and worse:
 *
 * ONE. Nobody can change any of it. The operator sees one summary line on the
 * catalogue screen and cannot author a rule, set a level, move a cap or close a
 * shelf. A governance model that can only be edited by migration is not a
 * governance model.
 *
 * TWO. Most of it is advisory. `price_floor` is checked, inside a function that
 * produces a review note. `max_listings_per_seller` is printed on a screen and
 * enforced by nothing. `min_rating` is read by nothing at all. A cap that
 * cannot refuse anything is a number in a table.
 *
 * THREE. `rating_required` is false on four shelves that also carry a
 * `min_rating`. Two columns, one question, and they disagree — so whether
 * consumer demands 3.0 depends on which of the two a reader happens to trust.
 *
 * FOUR. The caps are the ones the prototype shipped: 400 devices, 250 consumer,
 * 180 content — against a catalogue where the largest supplier has thirteen
 * listings. No cap can be reached, so no cap has ever been tested.
 *
 * FIVE. `partners.rating` is 0 on four sellers and does not mean they scored
 * zero; it means nobody has rated them. `OperatorPartners.tsx` already knows
 * that — `p.rating > 0 ? … : 'No rating yet'` — so the knowledge lives in one
 * component and nowhere else. The moment a rating bar is enforced, 0 becomes a
 * score and every new seller is permanently below every threshold. A
 * marketplace that quietly closes itself to new supply is worse than one with
 * no bar at all, and it would look exactly like the bar working.
 */

/* ---- 1. Unrated is not zero --------------------------------------------------- */

update public.partners set rating = null
 where rating = 0
   and not exists (select 1 from public.product_reviews r
                    join public.products p on p.id = r.product_id
                   where p.partner_id = partners.id and r.status = 'published');

comment on column public.partners.rating is
  'Average buyer rating, or NULL where nobody has rated this seller yet. Never 0 for unrated — a threshold that reads 0 as a score locks out every new seller for ever.';

/* ---- 2. One question, one column ---------------------------------------------- */

alter table public.category_policy
  add column if not exists open_to_buyers boolean not null default true,
  add column if not exists closed_reason  text,
  /* The decision `min_rating` on its own cannot express, and the reason
     `rating_required` was never the right shape: a shelf that demands 4.0 has
     to say separately what it does about a seller nobody has rated, because
     those are different policies and only one of them is about quality. */
  add column if not exists allow_unrated  boolean not null default true,
  add column if not exists unrated_note   text,
  add column if not exists note           text,
  add column if not exists updated_on     date,
  add column if not exists updated_by     text;

/* `rating_required` said no on four shelves that carry a bar. Null the bar
   where it was not required, so the remaining value means what it says — which
   needs the column to admit "no bar" at all, and it did not. */
alter table public.category_policy alter column min_rating drop not null;

update public.category_policy set min_rating = null
 where not rating_required;

alter table public.category_policy drop column if exists rating_required;

do $$ begin
  alter table public.category_policy add constraint category_policy_rating_check
    check (min_rating is null or (min_rating >= 1 and min_rating <= 5));
exception when duplicate_object then null; end $$;

/* ---- 3. Caps sized to this shelf ---------------------------------------------- */

/* A telco marketplace category is a curated shelf, not an open catalogue: the
 * question is "how many chargers from one OEM belong in front of a buyer", and
 * the answer is a small number. Four hundred was inherited from somewhere with a
 * different catalogue and made the column unreachable.
 *
 * Each of these leaves real headroom against what is on the shelf today —
 * Kestrel has five devices against twelve, Sentinel four security listings
 * against six — so "approaching the cap" is a state the screen can show and a
 * seller can hit, rather than a theoretical one.
 */
update public.category_policy set max_listings_per_seller = v.cap
  from (values ('consumer', 20), ('device', 12), ('content', 8),
               ('iot', 10), ('security', 6), ('partner', 8)) as v(cat, cap)
 where category_policy.category_id = v.cat;

/* The bar, and what each shelf does about a seller nobody has rated. */
update public.category_policy set
  min_rating = v.bar, allow_unrated = v.unrated, unrated_note = v.why
  from (values
    ('consumer', null::numeric, true,
     'The operator''s own mobility shelf — sellers appear by invitation, so the invitation carries the bar.'),
    ('device', 3.0, true,
     'A new OEM lists on the strength of its onboarding evidence. A shelf that never admits a new supplier stops being a marketplace.'),
    ('content', 3.0, true,
     'Content is cheap to withdraw and cheap to trial, so a new publisher gets a shelf on evidence.'),
    ('iot', 3.0, true,
     'IoT hardware is proved by its certifications rather than by a rating.'),
    ('security', 4.0, false,
     'The one shelf where an unrated seller is refused. A managed firewall or an endpoint agent from a supplier nobody has ever rated is not something to put in front of an enterprise, and the enterprise cannot tell from the listing.'),
    ('partner', 3.5, false,
     'A reseller programme is entered by agreement rather than by application, so there is no unrated case to admit.')
  ) as v(cat, bar, unrated, why)
 where category_policy.category_id = v.cat;

update public.category_policy set
  note = v.note, updated_on = date '2026-08-08', updated_by = 'Anika Sharma'
  from (values
    ('consumer', 'The operator''s own mobility shelf, spot-checked because most of what is on it is first-party.'),
    ('device',   'Highest-volume shelf, and the one where a price below cost does most damage — a device is the largest single line most buyers ever place.'),
    ('content',  'Reviewed by hand because what is published is somebody else''s content and the rights sit with them. Twenty-four hours, because a content launch date is a marketing date.'),
    ('iot',      'Five days to review, because an IoT listing is a device, a connectivity plan and a data pool that have to be checked together.'),
    ('security', 'Returns are contractual — a security subscription is governed by its own agreement and a blanket window would contradict it.'),
    ('partner',  'Reseller enablement rather than a shelf to trade on. Everything here is a wholesale commitment with a contract behind it.')
  ) as v(cat, note)
 where category_policy.category_id = v.cat;

/* ---- 4. Making it refuse things ----------------------------------------------- */

/* `applyPolicy` produces a review note, which is right for a reviewer and not
 * enough for a rule. A cap and a rating bar have to refuse a write, or the only
 * thing standing between the shelf and a breach is somebody reading the note.
 */
create or replace function public.guard_category_policy()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare
  pol  public.category_policy;
  ptr  public.partners;
  cat  public.categories;
  used integer;
  who  text;
begin
  /* Only states that occupy the shelf. Retired and rejected never reached it.
     Suspended is the case worth naming: the marketplace has already taken that
     listing down, so re-refusing it on the way past would block the operator
     from tidying up a decision they made themselves. */
  if new.status in ('retired', 'rejected', 'suspended') then return new; end if;

  select * into pol from public.category_policy where category_id = new.category_id;
  if pol.category_id is null then return new; end if;
  select * into cat from public.categories where id = new.category_id;
  who := coalesce((select name from public.partners where id = new.partner_id), 'The marketplace');

  if pol.price_floor and new.cost is not null and new.cost > 0 and new.price < new.cost then
    raise exception
      '% cannot be listed in % at % — it costs % to supply, and this shelf does not allow a listing below cost.',
      new.name, cat.name, new.price, new.cost;
  end if;

  if new.partner_id is not null and pol.min_rating is not null then
    select * into ptr from public.partners where id = new.partner_id;

    if ptr.rating is null then
      if not pol.allow_unrated then
        raise exception
          '% has no buyer rating yet and % does not admit unrated sellers. %',
          ptr.name, cat.name,
          coalesce(pol.unrated_note, 'The shelf opens to them once they have been rated elsewhere.');
      end if;
    elsif ptr.rating < pol.min_rating then
      raise exception
        '% is rated % and % requires %. The listing is refused on the seller, not on the listing.',
        ptr.name, ptr.rating, cat.name, pol.min_rating;
    end if;
  end if;

  if pol.max_listings_per_seller is not null then
    /* A listing the marketplace suspended does not consume the seller's
       allowance. Taking their listing down and then counting it against them
       is charging them twice for one decision. */
    select count(*) into used from public.products p
     where p.category_id = new.category_id
       and p.status not in ('retired', 'rejected', 'suspended')
       and p.id is distinct from new.id
       and p.partner_id is not distinct from new.partner_id;

    if used >= pol.max_listings_per_seller then
      raise exception
        '% already holds % of the % listings % allows one supplier. Retire one before adding another.',
        who, used, pol.max_listings_per_seller, cat.name;
    end if;
  end if;

  return new;
end $$;

drop trigger if exists z_guard_category_policy on public.products;
create trigger z_guard_category_policy
  before insert or update of status, price, cost, category_id, partner_id on public.products
  for each row execute function public.guard_category_policy();

/* ---- 5. A closed shelf is closed --------------------------------------------- */

/* `open_to_buyers` has to reach the storefront or it is a switch wired to
 * nothing. The storefront reads `categories`, so the answer is mirrored there
 * by a trigger rather than by two screens both remembering. */
alter table public.categories add column if not exists open_to_buyers boolean not null default true;

create or replace function public.sync_category_open()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  update public.categories set open_to_buyers = new.open_to_buyers where id = new.category_id;
  return new;
end $$;

drop trigger if exists z_sync_category_open on public.category_policy;
create trigger z_sync_category_open
  after insert or update of open_to_buyers on public.category_policy
  for each row execute function public.sync_category_open();

update public.categories c set open_to_buyers = p.open_to_buyers
  from public.category_policy p where p.category_id = c.id;

/* ---- 6. Who may change it ----------------------------------------------------- */

alter table public.category_policy enable row level security;
alter table public.policy_rules enable row level security;
alter table public.category_policy_rules enable row level security;

drop policy if exists everyone_reads_category_policy on public.category_policy;
create policy everyone_reads_category_policy on public.category_policy for select using (true);
drop policy if exists operator_writes_category_policy on public.category_policy;
create policy operator_writes_category_policy on public.category_policy
  for all using (current_persona() = 'operator') with check (current_persona() = 'operator');

/* A seller reads the rules of the shelf they list on. A cap discovered by being
   refused is a cap that wasted somebody's afternoon. */
drop policy if exists everyone_reads_policy_rules on public.policy_rules;
create policy everyone_reads_policy_rules on public.policy_rules for select using (true);
drop policy if exists operator_writes_policy_rules on public.policy_rules;
create policy operator_writes_policy_rules on public.policy_rules
  for all using (current_persona() = 'operator') with check (current_persona() = 'operator');

drop policy if exists everyone_reads_policy_matrix on public.category_policy_rules;
create policy everyone_reads_policy_matrix on public.category_policy_rules for select using (true);
drop policy if exists operator_writes_policy_matrix on public.category_policy_rules;
create policy operator_writes_policy_matrix on public.category_policy_rules
  for all using (current_persona() = 'operator') with check (current_persona() = 'operator');

grant select on public.category_policy, public.policy_rules, public.category_policy_rules
  to authenticated, anon;
grant insert, update, delete on public.category_policy, public.policy_rules, public.category_policy_rules
  to authenticated;

/* ---- 7. Assertions ------------------------------------------------------------ */

do $$
declare n int; bad text;
begin
  /* Every shelf is governed, and the two rating decisions are now separate
     columns that genuinely differ. */
  select string_agg(c.id, ', ') into bad from public.categories c
   where not exists (select 1 from public.category_policy p where p.category_id = c.id);
  if bad is not null then raise exception 'categories with no policy: %', bad; end if;

  select count(*) into n from public.category_policy where min_rating is not null and allow_unrated;
  if n = 0 then raise exception 'no shelf admits an unrated seller under a bar'; end if;
  select count(*) into n from public.category_policy where min_rating is not null and not allow_unrated;
  if n = 0 then raise exception 'no shelf refuses an unrated seller, so allow_unrated decides nothing'; end if;

  /* Unrated is null, and the case exists. */
  select count(*) into n from public.partners where rating = 0;
  if n > 0 then raise exception '% sellers still carry 0 meaning "unrated"', n; end if;
  select count(*) into n from public.partners where rating is null;
  if n = 0 then raise exception 'no seller is unrated, so the case the bar turns on is untested'; end if;

  /* A cap that cannot be reached is not a cap. Every one has to be within sight
     of what a supplier already holds. */
  select string_agg(p.category_id || ' (cap ' || p.max_listings_per_seller || ', most held ' ||
                    coalesce((select max(k) from (
                       select count(*) k from public.products x
                        where x.category_id = p.category_id and x.status not in ('retired','rejected')
                        group by x.partner_id) y), 0) || ')', '; ')
    into bad
    from public.category_policy p
   where p.max_listings_per_seller is not null
     and p.max_listings_per_seller > 4 * coalesce((select max(k) from (
           select count(*) k from public.products x
            where x.category_id = p.category_id and x.status not in ('retired','rejected')
            group by x.partner_id) y), 1);
  if bad is not null then raise exception 'caps too far above the shelf to ever be reached: %', bad; end if;

  /* And nothing on the shelf breaches what was just set. */
  select string_agg(x.who || ' in ' || x.cat, '; ') into bad from (
    select coalesce(pt.name, 'the marketplace') as who, c.name as cat
      from public.products p
      join public.category_policy pol on pol.category_id = p.category_id
      join public.categories c on c.id = p.category_id
      left join public.partners pt on pt.id = p.partner_id
     where p.status not in ('retired', 'rejected', 'suspended') and pol.max_listings_per_seller is not null
     group by 1, 2, pol.max_listings_per_seller
    having count(*) > pol.max_listings_per_seller
  ) x;
  if bad is not null then raise exception 'the caps just set are already breached: %', bad; end if;

  /* Nothing below its shelf's bar is reachable by a buyer.
   *
   * Stated this way rather than as "nothing below the bar exists", because one
   * does: SKU-6004, Vertex Endpoint Protect, from a seller rated 3.2 against
   * security's 4.0. That listing is the case the bar exists for, and the
   * marketplace has already suspended it by hand — which is the outcome the
   * rule now produces automatically instead. Asserting it away would delete the
   * only evidence that the bar is about something real. */
  select string_agg(p.id || ' (' || pt.name || ', rated ' || pt.rating || ')', ', ') into bad
    from public.products p
    join public.category_policy pol on pol.category_id = p.category_id
    join public.partners pt on pt.id = p.partner_id
   where p.status in ('live', 'scheduled') and pol.min_rating is not null
     and pt.rating is not null and pt.rating < pol.min_rating;
  if bad is not null then raise exception 'on sale below their shelf''s bar: %', bad; end if;

  /* And the case itself is still there to look at. */
  if not exists (
    select 1 from public.products p
      join public.category_policy pol on pol.category_id = p.category_id
      join public.partners pt on pt.id = p.partner_id
     where pol.min_rating is not null and pt.rating < pol.min_rating
  ) then
    raise exception 'no seller sits below their shelf''s bar, so the rule demonstrates nothing';
  end if;

  /* The guard refuses all three things, and names which. */
  begin
    insert into public.products (id, category_id, name, price, cost, status, seller, sort_order)
    values ('SKU-ASSERT-1', 'device', 'Assertion probe', 10.00, 40.00, 'pending', 'Assertion', 999);
    raise exception 'a listing priced below cost reached the device shelf';
  exception when others then
    if sqlerrm not like '%does not allow a listing below cost%' then
      raise exception 'the price floor failed on % rather than the guard', sqlerrm;
    end if;
  end;

  begin
    insert into public.products (id, category_id, name, price, cost, status, seller, partner_id, sort_order)
    values ('SKU-ASSERT-2', 'security', 'Assertion probe', 100.00, 40.00, 'pending', 'Lumen Wearables', 'PTR-1013', 999);
    raise exception 'an unrated seller listed on the security shelf';
  exception when others then
    if sqlerrm not like '%does not admit unrated sellers%' then
      raise exception 'the unrated refusal failed on % rather than the guard', sqlerrm;
    end if;
  end;

  begin
    insert into public.products (id, category_id, name, price, cost, status, seller, partner_id, sort_order)
    values ('SKU-ASSERT-3', 'security', 'Assertion probe', 100.00, 40.00, 'pending', 'Vertex Endpoint', 'PTR-1015', 999);
    raise exception 'a seller below the bar listed on the security shelf';
  exception when others then
    if sqlerrm not like '%requires 4.0%' then
      raise exception 'the rating refusal failed on % rather than the guard', sqlerrm;
    end if;
  end;

  delete from public.products where id like 'SKU-ASSERT-%';

  /* Closing a shelf reaches the storefront. */
  update public.category_policy set open_to_buyers = false, closed_reason = 'Assertion' where category_id = 'content';
  if (select open_to_buyers from public.categories where id = 'content') then
    raise exception 'closing a shelf did not reach the storefront';
  end if;
  update public.category_policy set open_to_buyers = true, closed_reason = null where category_id = 'content';

  raise notice 'shelves %, capped %, bar set on %, refusing unrated %, unrated sellers %',
    (select count(*) from public.category_policy),
    (select count(*) from public.category_policy where max_listings_per_seller is not null),
    (select count(*) from public.category_policy where min_rating is not null),
    (select count(*) from public.category_policy where not allow_unrated),
    (select count(*) from public.partners where rating is null);
end $$;
