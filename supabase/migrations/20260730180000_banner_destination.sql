-- Give a banner somewhere to point.
--
-- The promo strip worked out where a banner's call to action went by reading its
-- `audience`. That conflates two different things: audience is *who the banner is
-- shown to*, and the destination is *where the click lands*. They are usually the
-- same and sometimes not — "Become a marketplace seller · Apply to sell" has an
-- audience of `all`, because it is shown to everyone, and was therefore sending
-- would-be sellers to the retail shop.
--
-- The operator writes the copy and the call to action, so the operator should choose
-- what it does. Backfilled from the old inference so nothing moves except the banner
-- that was wrong.

alter table operator_banners add column if not exists destination text;

comment on column operator_banners.destination is
  'Public page the call to action opens: landing, retail, enterprise or partner. Null falls back to the audience, which is what the storefront used to infer.';

alter table operator_banners drop constraint if exists operator_banners_destination_check;
alter table operator_banners add constraint operator_banners_destination_check
  check (destination is null or destination in ('landing', 'retail', 'enterprise', 'partner'));

-- Reproduce what the storefront was inferring, so existing banners keep their
-- current behaviour rather than silently changing.
update operator_banners
   set destination = case
     when lower(audience) like '%enterprise%' or lower(audience) like '%b2b%' then 'enterprise'
     when lower(audience) like '%partner%' then 'partner'
     else 'retail'
   end
 where destination is null;

-- The one that was actually wrong. Its call to action is "Apply to sell".
update operator_banners set destination = 'partner' where id = 'bn-007';

-- The view is the storefront's only way in, so it has to carry the new column.
-- Dropped and recreated rather than replaced: `create or replace view` can only
-- append columns, and `destination` belongs beside `audience` it qualifies.
drop view if exists public_banners;
create view public_banners
  with (security_invoker = false)
as
select id, slot, title, subtitle, cta, audience, destination, weight, sort_order
from operator_banners
where status = 'active'
  and (starts_at is null or starts_at <= current_date)
  and (ends_at   is null or ends_at   >= current_date);

revoke all on public_banners from public;
revoke all on public_banners from anon, authenticated;
grant select on public_banners to anon, authenticated;
