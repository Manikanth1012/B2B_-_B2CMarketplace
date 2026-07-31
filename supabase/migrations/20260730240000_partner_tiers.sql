-- Partner tiers, with something behind the word.
--
-- `partners.tier` held 'Platinum', 'Gold', 'Silver' or 'Bronze' as free text and
-- nothing anywhere said what any of them meant, how a seller reached one, or
-- what changed when they did. A badge that carries no consequence is decoration,
-- and a seller cannot work towards one they cannot read the rules of.

create table if not exists partner_tiers (
  id             text primary key,
  name           text not null,
  /* Ascending, so a comparison is a comparison rather than a lookup table of
     which word outranks which. */
  rank           integer not null unique,
  /* Trailing twelve-month gross value at which a seller qualifies. */
  qualify_gross  numeric not null,
  /* What the tier is actually worth, stated in the seller's terms. */
  benefits       text[] not null default '{}',
  /* Points off the commission rate. A tier that changes nothing about what a
     seller is paid is a tier nobody works towards. */
  rate_relief    numeric not null default 0,
  /* From the validated categorical palette, assigned by rank and never cycled,
     so a colour always means the same tier wherever it appears. The obvious
     metallics were tried first and fail the checks: silver and platinum drop
     below the chroma floor (they read as gray), and silver against bronze
     measures ΔE 14.2 to normal colour vision — under the floor, so full-sighted
     readers cannot reliably tell them apart either. A hue that cannot be told
     apart cannot carry identity, however apt its name. */
  colour         text not null,
  sort_order     integer not null
);

alter table partner_tiers enable row level security;

drop policy if exists "auth_read_partner_tiers"     on partner_tiers;
drop policy if exists "operator_write_partner_tiers" on partner_tiers;

/* Readable by anyone signed in — a seller has to be able to read the ladder
   they are on. Writable by the operator alone. */
create policy "auth_read_partner_tiers" on partner_tiers
  for select to authenticated using (true);
create policy "operator_write_partner_tiers" on partner_tiers
  for all to authenticated
  using (current_persona() = 'operator') with check (current_persona() = 'operator');

insert into partner_tiers (id, name, rank, qualify_gross, benefits, rate_relief, colour, sort_order)
values
  ('bronze', 'Bronze', 1, 0, array[
     'Standard catalogue review, one working day',
     'Self-service onboarding and support',
     'Monthly settlement on the plan default'
   ], 0, '#2a78d6', 1),
  ('silver', 'Silver', 2, 120000, array[
     'Priority catalogue review, same working day',
     'A named onboarding contact',
     'Eligible for seasonal campaign slots'
   ], 0.5, '#eb6834', 2),
  ('gold', 'Gold', 3, 400000, array[
     'Priority catalogue review and pre-submission advice',
     'A named account manager',
     'Guaranteed campaign slots each quarter',
     'Fortnightly settlement available on request'
   ], 1.0, '#1baf7a', 3),
  ('platinum', 'Platinum', 4, 1000000, array[
     'Same-day catalogue review with a standing reviewer',
     'A named account manager and a quarterly business review',
     'Homepage and category placement negotiated per campaign',
     'Fortnightly settlement and a reduced holdback'
   ], 1.5, '#4a3aa7', 4)
on conflict (id) do update set
  benefits = excluded.benefits, rate_relief = excluded.rate_relief,
  qualify_gross = excluded.qualify_gross, colour = excluded.colour;

/* The stored tier becomes a reference rather than a word. Kept as a column on
   `partners` rather than derived from trailing gross, because a tier is
   *awarded* — it survives a bad quarter, and the qualification figure is what
   the review looks at rather than what the badge follows automatically. */
alter table partners add column if not exists tier_id text
  references partner_tiers(id) on delete restrict;

update partners set tier_id = lower(tier) where tier_id is null and tier is not null;

/* Every seller starts at the entry tier and is promoted, so the column has a
   default and cannot be null. Without it a desk-created application landed with
   no tier at all — not "Bronze", not "unrated", but a badge that renders as
   nothing and a filter that can never find them. */
update partners set tier_id = 'bronze' where tier_id is null;
alter table partners alter column tier_id set default 'bronze';
alter table partners alter column tier_id set not null;

do $$
declare bad text;
begin
  select string_agg(name || ' (' || coalesce(tier, 'null') || ')', ', ') into bad
  from partners where tier_id is null;
  if bad is not null then
    raise exception 'partner on a tier that does not exist: %', bad;
  end if;

  -- The ladder must rise. A tier that qualifies at less gross than the one
  -- below it is a ladder somebody can fall up.
  if exists (
    select 1 from partner_tiers a join partner_tiers b on b.rank = a.rank + 1
    where b.qualify_gross <= a.qualify_gross
  ) then
    raise exception 'the tier ladder does not ascend';
  end if;
end $$;
