-- The prototype's reviews, against products that exist here.
--
-- Its own note on the seed is the reason for the spread: "The demo seller carries a
-- realistic spread, including poor reviews that have not been answered — that is the
-- state the Reviews screen exists to make visible, and a screen that only shows
-- praise proves nothing."
--
-- So this keeps the two-star batch-failure review, keeps one four-star complaint the
-- seller has answered and one they have not, and leaves two in `pending` so the
-- operator's moderation queue has something in it and one `rejected` so the refused
-- state is visible too.
--
-- `user_id` is null on all of them: these were written by other customers, not by the
-- demo consumer. The insert policy's "must have bought it" rule applies to writes
-- from the app, not to a seed applied as postgres — and giving them all to Priya
-- would put four reviews she never wrote into "reviews you have written".

insert into product_reviews
  (id, product_id, rating, title, body, author, submitted, status, reject_reason, reply_by, reply_at, reply_text)
select v.id, v.product_id, v.rating, v.title, v.body, v.author, v.submitted::date, v.status,
       v.reject_reason, v.reply_by, v.reply_at::date, v.reply_text
from (values
  ('REV-7001', 'SKU-5003', 5, 'Held calibration through a heatwave',
   'Forty units across three depots, no drift over six weeks of 44-degree afternoons. The gateway pairing was the only fiddly part.',
   'Brightline Foods', '2026-07-24', 'published', null, null, null, null),

  ('REV-7002', 'SKU-5003', 4, 'Good sensor, poor documentation',
   'Hardware is solid. The setup guide assumes you already know their platform, so budget an afternoon of guessing.',
   'Meridian Foods', '2026-07-21', 'published', null,
   'Nimbus Sensors', '2026-07-22',
   'Fair, and we have heard it before. A rewritten guide with a worked example goes out next month; we will email it to you directly.'),

  -- Unanswered and unflattering. This is the row the seller's Reviews screen exists for.
  ('REV-7003', 'SKU-5003', 2, 'Two of the batch failed inside a fortnight',
   'Eighteen of twenty are fine. Two stopped reporting on day nine and day twelve. Replacements came quickly but I now check every reading.',
   'Harbourpoint Retail', '2026-07-20', 'published', null, null, null, null),

  ('REV-7004', 'SKU-5003', 5, 'Cheaper than the incumbent and just as good',
   'Swapped out a well-known brand at half the unit cost. No regrets after two months.',
   'Cadence Health', '2026-07-16', 'published', null, null, null, null),

  ('REV-7005', 'SKU-5004', 4, 'Accurate once you place it properly',
   'Counts are within one or two of the door sensor. Mount it too high and it under-reports; that is not in the manual.',
   'Northwind Mobility', '2026-07-23', 'published', null, null, null, null),

  ('REV-7006', 'SKU-4001', 5, 'Battery genuinely lasts the day',
   'Two days of light use, one heavy. Camera is a clear step up from the K7 I traded in.',
   'Arun Deshpande', '2026-07-18', 'published', null, null, null, null),

  ('REV-7007', 'SKU-4001', 3, 'Good phone, slow updates',
   'No complaints about the hardware. Still waiting on the security patch that was promised at launch.',
   'Sanya Kapoor', '2026-07-11', 'published', null, null, null, null),

  ('REV-7008', 'SKU-3001', 4, 'Picture quality is excellent, app is not',
   'Streams in proper 4K without buffering. The app forgets where I was in a series about once a week.',
   'Daniel Osei', '2026-07-09', 'published', null, null, null, null),

  -- Waiting on the operator. The moderation queue needs to have something in it.
  ('REV-7009', 'SKU-5003', 5, 'Exactly what we needed for cold chain',
   'Deployed across two sites last month. Alerts arrive before the temperature actually breaches, which is the whole point.',
   'Meera Krishnan', '2026-07-29', 'pending', null, null, null, null),

  ('REV-7010', 'SKU-4001', 1, 'Arrived with a cracked screen',
   'Boxed badly and the screen was already broken. Support have been fine about it but I have not been able to use the thing.',
   'Rohan Raman', '2026-07-28', 'pending', null, null, null, null),

  -- Refused, with the reason recorded. "Rejected" on its own is not a decision.
  ('REV-7011', 'SKU-3001', 5, 'Best deal anywhere — call me on 98860 41127',
   'Genuinely great. Ring me on 98860 41127 and I will tell you where to get it cheaper.',
   'Anonymous', '2026-07-25', 'rejected', 'Contains personal data', null, null, null)
) as v(id, product_id, rating, title, body, author, submitted, status, reject_reason, reply_by, reply_at, reply_text)
where exists (select 1 from products p where p.id = v.product_id)
  and not exists (select 1 from product_reviews r where r.id = v.id);
