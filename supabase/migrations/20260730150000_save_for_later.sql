-- Save for later.
--
-- The prototype keeps saved items *inside* the basket — `.cartline.is-saved` is a
-- dimmed variant of the same row, not a separate screen. So this is a state on the
-- cart line rather than a second table: the same product and quantity move between
-- "buying now" and "keeping for later" without being copied anywhere.
--
-- A flag also means the existing owner-scoped RLS on cart_items covers it with no
-- new policies, and no way for the two lists to disagree about what is in them.

alter table cart_items add column if not exists saved boolean not null default false;

comment on column cart_items.saved is
  'Saved for later rather than being bought now. Saved lines are excluded from the basket count, the totals and checkout.';

create index if not exists cart_items_saved_idx on cart_items (user_id, saved);

-- The prototype's MY_SAVED = ['SKU-4004'] — Volta Mesh Wi-Fi 6 (3-pack). Seeded so
-- the feature has something to show without the visitor having to save something
-- first. Only inserted if the consumer's basket does not already hold that product.
insert into cart_items (product_id, quantity, saved, user_id)
select 'SKU-4004', 1, true, p.id
from profiles p
where p.persona = 'consumer'
  and not exists (
    select 1 from cart_items c where c.user_id = p.id and c.product_id = 'SKU-4004'
  );
