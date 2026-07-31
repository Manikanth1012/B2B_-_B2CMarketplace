-- Let a seller apply for another marketplace themselves.
--
-- Adding a category was operator-only: the seller could see what each
-- marketplace demanded of them and had no way to say "I would like to sell in
-- Security too". Every widening had to start with an email, which is the sort
-- of thing that turns a self-service marketplace back into an account-managed
-- one within a quarter.
--
-- Two marketplaces are not open to self-application, and it is worth saying why
-- rather than quietly leaving them off the menu:
--
--   consumer  the operator's own mobility shelf — plans, eSIMs and the packs
--             composed from the rate card. A seller belongs here only where the
--             operator has a specific reason to put them there.
--   partner   reseller enablement: the white-label storefront and the API. It
--             is the operator's own product for running a reseller programme,
--             not a marketplace anybody trades in.
--
-- Applying is not being approved. The application lands with its evidence
-- outstanding, exactly as an operator-initiated one does, and the same rules
-- decide when it opens.

alter table categories add column if not exists self_apply boolean not null default true;
alter table categories add column if not exists self_apply_note text;

comment on column categories.self_apply is
  'Whether a seller may apply for this marketplace on their own. False where the '
  'shelf is the operator''s own — a seller can still be added to it by the operator, '
  'which is how the existing exceptions got there.';

update categories set self_apply = false, self_apply_note =
  'The operator''s own mobility shelf. Sellers appear here by invitation, alongside '
  'the plans and packs composed from the operator rate card.'
where id = 'consumer';

update categories set self_apply = false, self_apply_note =
  'Reseller enablement — the white-label storefront and the partner API. It is how a '
  'reseller programme is run rather than a marketplace to trade in.'
where id = 'partner';

update categories set self_apply_note =
  'Open to any seller who can satisfy what it asks for.'
where self_apply and self_apply_note is null;

/* ------------------------------------------------------------------ RLS -- */

-- A seller may file their own application and nothing more. Everything that
-- makes it real — the approval, the reviewed evidence — stays with the
-- operator, so this cannot be used to let anybody onto a shelf.
drop policy if exists "partner_apply_category" on partner_categories;
create policy "partner_apply_category" on partner_categories
  for insert to authenticated
  with check (
    partner_id = current_partner_id()
    /* Unapproved, always. A seller cannot approve themselves by writing the
       column, which is the only thing that would make this dangerous. */
    and approved_at is null
    and approved_by is null
    and exists (select 1 from categories c where c.id = category_id and c.self_apply)
    /* And only while they are trading. A suspended seller applying for a new
       marketplace is a suspended seller widening their reach. */
    and exists (
      select 1 from partners p
      where p.id = partner_id and p.status in ('live', 'onboarding', 'review')
    )
  );

-- The evidence checklist that comes with an application. The seller writes the
-- rows that say what they now owe; they cannot write the states that say it was
-- accepted, because the update policy below refuses everything but a document.
drop policy if exists "partner_seed_category_evidence" on partner_category_evidence;
create policy "partner_seed_category_evidence" on partner_category_evidence
  for insert to authenticated
  with check (
    partner_id = current_partner_id()
    and state in ('outstanding', 'standing')
    and reviewed_by is null
    and reviewed_at is null
    /* Only against a category they have actually applied for. */
    and exists (
      select 1 from partner_categories pc
      where pc.partner_id = partner_category_evidence.partner_id
        and pc.category_id = partner_category_evidence.category_id
    )
  );

/* ------------------------------------------------------------ assertions - */

do $$
declare bad text; n integer;
begin
  select count(*) into n from categories where self_apply;
  if n <> 4 then
    raise exception 'expected 4 self-serve marketplaces, found %', n;
  end if;

  -- Every category says whether it is open and why, because "not offered" with
  -- no reason reads as a bug to the seller looking for it.
  select string_agg(id, ', ') into bad from categories where self_apply_note is null;
  if bad is not null then
    raise exception 'category with no self-application note: %', bad;
  end if;

  -- The closed ones are closed to *application*, not to being placed there.
  -- Existing sellers on those shelves are the operator's own decision and must
  -- survive this migration.
  select count(*) into n
  from partner_categories pc join categories c on c.id = pc.category_id
  where not c.self_apply;
  if n = 0 then
    raise exception 'the operator-only shelves lost their existing sellers';
  end if;
end $$;
