-- A moderation queue with something to moderate.
--
-- The queue held two reviews, both of them fine. That is a screen which proves
-- the buttons are wired and nothing else: it cannot show a duplicate being
-- caught, because there is no duplicate, and the automated screen has nothing
-- to say about either of them.
--
-- These eight are what a real day looks like. Each one is here to fire a
-- specific check in lib/reviewScreening.ts, and between them they cover every
-- severity the screen can report — including two that are completely clean,
-- because a filter that flags everything is a filter nobody reads.
--
-- Nothing here is auto-refused. The screen recommends and evidences; a person
-- still decides, which is why every one of these lands 'pending'.

insert into product_reviews (
  id, product_id, rating, title, body, author, submitted, status,
  reject_reason, reply_by, reply_at, reply_text
)
select
  v.id, v.product_id, v.rating, v.title, v.body, v.author, v.submitted::date, v.status,
  v.reject_reason, v.reply_by, v.reply_at::date, v.reply_text
from (values
  -- Copy-paste across two products by one person. Neither says anything about
  -- either product, which is the point of catching it.
  ('REV-7012', 'SKU-4002', 5, 'Great value',
   'Absolutely brilliant product, does everything I wanted and the price was fair. Would buy again.',
   'Vikram Sethi', '2026-07-26', 'pending', null, null, null, null),
  ('REV-7013', 'SKU-4003', 5, 'Great value',
   'Absolutely brilliant product, does everything I wanted and the price was fair. Would buy again.',
   'Vikram Sethi', '2026-07-26', 'pending', null, null, null, null),

  -- The same paragraph from a different name. One person being lazy is a
  -- duplicate; two names posting one paragraph is a farm.
  ('REV-7014', 'SKU-4001', 5, 'Great value here',
   'Absolutely brilliant product, does everything I wanted and the price was fair. Would buy again.',
   'Priya Nair', '2026-07-27', 'pending', null, null, null, null),

  -- Keyboard mash. Clears the twenty-character rule and means nothing.
  ('REV-7015', 'SKU-3002', 4, 'asdfgh',
   'asdfghjkl aaaaaaaaaa qwertyuiop nnnnnnnnn',
   'Test User', '2026-07-27', 'pending', null, null, null, null),

  -- A phone number in the body. Publishing it puts somebody''s number on a
  -- public product page.
  ('REV-7016', 'SKU-2001', 5, 'Cheaper elsewhere, ask me',
   'Good plan but you can do better. WhatsApp me on +91 99820 41556 and I will sort you out.',
   'Anonymous', '2026-07-28', 'pending', null, null, null, null),

  -- Five stars, and the text describes a broken product. Either the stars
  -- slipped or the text belongs to something else.
  ('REV-7017', 'SKU-5005', 5, 'Does not work',
   'Completely useless, the tracker stopped working after a week and it was a total waste of money.',
   'Arjun Mehta', '2026-07-29', 'pending', null, null, null, null),

  -- Clean, and deliberately so: the queue has to show the screen staying quiet
  -- as well as firing.
  ('REV-7018', 'SKU-6001', 4, 'Solid once it was tuned',
   'Took a fortnight of tuning the rules before the false positives settled down. Since then it has been quiet and the weekly report is genuinely readable.',
   'Fatima Al-Balushi', '2026-07-29', 'pending', null, null, null, null),

  ('REV-7019', 'SKU-3001', 2, 'Buffers on anything over 1080p',
   'Picture is fine at 1080p but 4K stalls every few minutes on a 300 Mbps line. Support suggested restarting the router, which did not help.',
   'Kwame Boateng', '2026-07-30', 'pending', null, null, null, null)
) as v(id, product_id, rating, title, body, author, submitted, status,
       reject_reason, reply_by, reply_at, reply_text)
where exists (select 1 from products p where p.id = v.product_id)
  and not exists (select 1 from product_reviews r where r.id = v.id);

/* ------------------------------------------------------------ assertions -- */

do $$
declare n integer; bad text;
begin
  -- Every seeded review points at a product that exists. The `where exists`
  -- above silently drops rows whose product is missing, which would leave the
  -- queue quietly thinner than intended rather than failing loudly.
  select count(*) into n from product_reviews where id between 'REV-7012' and 'REV-7019';
  if n <> 8 then
    raise exception 'expected 8 seeded queue reviews, found % — a product id in the seed does not exist', n;
  end if;

  -- All of them are waiting on a person. The screen does not publish and does
  -- not refuse; if any of these arrived already decided, the seed is claiming
  -- the automated pass made a decision it is not allowed to make.
  select string_agg(id || ' is ' || status, ', ') into bad
  from product_reviews where id between 'REV-7012' and 'REV-7019' and status <> 'pending';
  if bad is not null then
    raise exception 'seeded queue review is not pending: %', bad;
  end if;

  -- The duplicate pair has to actually be duplicated, or the check it exists to
  -- demonstrate has nothing to find.
  select count(*) into n from product_reviews a
  join product_reviews b on b.body = a.body and b.id <> a.id
  where a.id = 'REV-7012';
  if n < 2 then
    raise exception 'the duplicate seed is not duplicated — screening has nothing to catch';
  end if;

  -- And the ratings are in range, which the storefront average depends on.
  select string_agg(id, ', ') into bad from product_reviews where rating not between 1 and 5;
  if bad is not null then
    raise exception 'review rating outside 1-5: %', bad;
  end if;
end $$;
