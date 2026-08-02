-- Six pieces of evidence nobody ever supplied were given a file.
--
-- `partner_category_evidence.document` is not "what arrived" — for an
-- outstanding row it is the name of the thing the category *demands*. Six rows
-- read "Type-approval certificate per market · Not supplied" and, because the
-- last migration keyed the path on `document is not null`, each of them got a
-- path and then a generated PDF behind it. The operator's documents tab drew
-- the row in red, said "Not supplied", and offered View and Download beside it.
--
-- That is worse than a dead link. A dead link is an annoyance; a certificate
-- that opens against a gate nothing was ever submitted for is fabricated
-- evidence, and the screen was telling the truth in words while contradicting
-- itself in buttons.
--
-- The test is `submitted_at`, which is the only column that records that
-- something actually arrived. The generator reads the same column, and the
-- assertion below is stated in those terms so this cannot come back.

update partner_category_evidence set path = null where submitted_at is null;

/* -------------------------------------------------------- sanity checks -- */
do $$
declare n integer; s text;
begin
  /* Nothing was submitted without being kept... */
  select string_agg(id, ', ') into s from partner_category_evidence
   where submitted_at is not null and document is not null and path is null;
  if s is not null then raise exception 'these submitted documents have nowhere to keep a file: %', s; end if;

  /* ...and nothing is kept that was never submitted. */
  select string_agg(id, ', ') into s from partner_category_evidence
   where submitted_at is null and path is not null;
  if s is not null then raise exception 'these unsubmitted rows point at a file: %', s; end if;

  /* The demo seller's category evidence still has files behind it — this
     migration removes paths, and removing all of them would pass every check
     above while leaving the screen with nothing to open. */
  select count(*) into n from partner_category_evidence
   where partner_id = 'PTR-1004' and path is not null;
  if n = 0 then raise exception 'the demo seller now has no category evidence at all'; end if;

  select count(*) into n from partner_category_evidence where path is not null;
  if n < 25 then raise exception 'only % category evidence files remain, which is too few to be right', n; end if;
end $$;
