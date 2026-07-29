-- The storefront promo strip reads its copy from the operator's Banners section.
--
-- `operator_banners` is operator-only since the scoped-RLS migrations, and it has to
-- stay that way: alongside the promo copy it carries `impressions`, `clicks` and
-- `revenue`, which are commercial figures no visitor should see. The landing page is
-- anonymous, so it cannot read the table at all.
--
-- A view is the right boundary here rather than a second policy on the table. A policy
-- grants rows, not columns — anon would get the revenue column too. This view drops
-- the commercial columns and hard-codes the "is this banner live right now" rule, so
-- the storefront cannot ask for a paused or out-of-window banner even by mistake.
--
-- `security_invoker = false` is deliberate and is what makes this work: the view runs
-- as its owner and so is not itself blocked by the RLS on operator_banners. The view
-- *is* the security boundary. Read-only — SELECT is the only grant.

create or replace view public_banners
  with (security_invoker = false)
as
select id, slot, title, subtitle, cta, audience, weight, sort_order
from operator_banners
where status = 'active'
  and (starts_at is null or starts_at <= current_date)
  and (ends_at   is null or ends_at   >= current_date);

revoke all on public_banners from public;
revoke all on public_banners from anon, authenticated;
grant select on public_banners to anon, authenticated;

-- The strip shows the storefront slots. The seed had one `storefront_strip` banner and
-- one `storefront_hero`, so only two of the four tiles would have carried a message.
-- Two more storefront promos, drawn from partners and categories that already exist in
-- the catalogue, so the strip is full without inventing sellers.
insert into operator_banners
  (id, slot, title, subtitle, cta, audience, region, device, weight,
   impressions, clicks, revenue, status, starts_at, ends_at, sort_order)
values
  ('bn-006', 'storefront_strip',
   'Halo Audio wireless range — save 25%',
   'Earbuds and over-ear headphones from a verified partner',
   'Shop audio', 'consumer', 'India,UAE', 'all', 65,
   0, 0, 0, 'active', '2026-07-01', '2026-09-30', 6),
  ('bn-007', 'storefront_strip',
   'Become a marketplace seller',
   'Onboard in seven gates, settle every fortnight',
   'Apply to sell', 'all', 'India,UAE,Kenya', 'all', 45,
   0, 0, 0, 'active', '2026-07-01', '2026-12-31', 7)
on conflict (id) do nothing;
