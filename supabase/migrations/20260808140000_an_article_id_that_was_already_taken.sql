/* An article id that was already taken.
 *
 * The migration before this one added the help article for Shelves and rules
 * and gave it `KB-O24`, which was the operator's Refunds article. It carried an
 * `on conflict do update`, so it did not fail — it silently replaced Refunds
 * and moved on. `helpCoverage` caught it on the next run: the screen it had
 * just fixed passed, and `op-refunds` had gone dark.
 *
 * Two things worth keeping from that.
 *
 * The upsert is what made it silent. `do update` is right for a row this
 * migration owns and wrong for one it might not, and there is no way to tell
 * those apart from inside the statement. The insert below takes the next free
 * id and does not update anything.
 *
 * And the check that caught it is the one that exists because a row coming back
 * is not the same as an answer coming back. It was written to catch an empty
 * body; it caught a whole article being overwritten, because it asks the same
 * question of every screen every time rather than of the screen somebody
 * happened to change.
 */

/* ---- Refunds, back as it was -------------------------------------------------- */

update public.kb_articles set
  kind = 'howto', title = 'Refunds', mins = 3, updated = date '2026-08-04',
  view = 'op-refunds', roles = '{"OR-FIN","OR-SUP"}', tags = '{"money","support"}',
  summary = 'Who asks, who decides, and where the money comes from.',
  body = '[["Raised against an order line","Not against an order. A parcel arriving damaged is one line, and refunding the whole order would be refunding things that arrived fine."],
   ["The decision","Approve, decline or part-refund, each with a reason the buyer sees. A decline with no reason is not accepted."],
   ["Where it goes","Back to the original payment method, or to the wallet if that is no longer reachable. The choice is recorded."],
   ["The seller''s side","A refund on a settled line is recovered from the next settlement run and appears on their statement as its own entry, not as a smaller sale."]]'::jsonb,
  status = 'published', sort_order = 24
 where id = 'KB-O24';

/* ---- Shelves and rules, at an id nobody else holds ---------------------------- */

insert into public.kb_articles
  (id, persona, personas, kind, title, mins, updated, view, roles, tags, summary, body, status, sort_order)
values (
  'KB-O33', 'operator', array['operator'], 'howto',
  'Change what a shelf demands', 5, current_date, 'op-shelves',
  array['OR-ADMIN', 'OR-CAT'], array['catalogue', 'policy', 'governance'],
  'What each category asks of a listing and its seller, how to change it, and what a change does to the suppliers already there.',
  jsonb_build_array(
    jsonb_build_array(
      'A shelf is a set of decisions, not a label',
      'Each category carries its own review mode, review window, returns position, price floor, rating bar and per-supplier cap. Security is sold to enterprises under contract with an attestation behind it; digital content is somebody else''s rights being resold; devices are boxes that ship. Governing them identically means either strangling the cheap ones or under-checking the expensive ones.'),
    jsonb_build_array(
      'Every change here refuses things immediately',
      'The policy is enforced in the database, not by this screen. The moment you save, the next listing written from anywhere — the seller''s portal, the bundle composer, an API client — is checked against it. There is no publish step and no delay.'),
    jsonb_build_array(
      'A rating bar is two decisions, not one',
      'The bar itself, and what happens to a seller nobody has rated yet. They are different questions: an unrated seller is not below the bar, they are not on it. Set the bar without answering the second and you have quietly closed the shelf to every new supplier, which looks exactly like the bar working. Security refuses the unrated deliberately — an enterprise cannot tell a new firewall vendor from an established one by reading a listing. Devices admit them on their onboarding evidence.'),
    jsonb_build_array(
      'Read the impact box before you save',
      'Raising a bar is the same act as removing the suppliers underneath it, and the box names them and counts their listings. Nothing already live is withdrawn by a bar change — but none of it can be relisted or changed, which is the same thing three months later. If the box names somebody you did not intend to remove, you have found the reason it is there.'),
    jsonb_build_array(
      'A cap refuses the next listing, never the ones already there',
      'Lowering a cap below where a supplier already sits does not take anything down. It stops them adding, and leaves them above the limit indefinitely. The shelf tab flags anybody in that state; clearing it is a conversation with the seller, not a setting.'),
    jsonb_build_array(
      'Off, warn and enforce',
      'On the matrix tab: off means the rule is not applied to that shelf at all; warn puts it in front of the reviewer without blocking; enforce refuses the listing. A rule marked as blocking that only ever warns is a contradiction the screen will tell you about — either it does not block, or the flag on the rule is wrong.'),
    jsonb_build_array(
      'Closing a shelf needs a reason',
      'A closed category disappears from the storefront and the reason is required, because the person who reopens it will not be you and has no other way to know what they are undoing.')
  ),
  'published', 33);

/* ---- The listing-rules article that was written and never published ---------- */

/* `KB-O04`, "How listing rules work", has been held since the knowledge base was
 * seeded, pointing at no screen — because the screen it described did not exist.
 * It does now. It stays a concept article rather than a screen article, because
 * `op-shelves` already has one and a screen's help button resolves to exactly
 * one row; what it gains is being readable at all.
 */
update public.kb_articles set status = 'published', updated = current_date
 where id = 'KB-O04' and status = 'held';

/* ---- Assertions --------------------------------------------------------------- */

do $$
declare bad text; n int;
begin
  /* Every operator screen that names an article has one, with a body. The
     narrow version of what helpCoverage asks, so a repeat of this fails here
     rather than seven minutes into the integration run. */
  select string_agg(x.view, ', ') into bad from (
    select a.view, a.id from public.kb_articles a
     where a.persona = 'operator' and a.view is not null and a.status = 'published'
       and (coalesce(trim(a.title), '') = '' or coalesce(trim(a.summary), '') = ''
            or jsonb_array_length(a.body) < 3)
  ) x;
  if bad is not null then raise exception 'operator articles too thin to answer anything: %', bad; end if;

  /* One article per screen. Two rows claiming one view is the same collision
     that caused this migration, one step later. */
  select string_agg(x.view || ' (' || x.ids || ')', '; ') into bad from (
    select view, string_agg(id, ', ') as ids, count(*) as n
      from public.kb_articles
     where persona = 'operator' and view is not null and status = 'published'
     group by view having count(*) > 1
  ) x;
  if bad is not null then raise exception 'screens claimed by more than one article: %', bad; end if;

  /* Refunds is back, and is about refunds. */
  select count(*) into n from public.kb_articles
   where id = 'KB-O24' and view = 'op-refunds' and title = 'Refunds';
  if n <> 1 then raise exception 'the refunds article did not come back'; end if;

  /* And the new screen has its own. */
  select count(*) into n from public.kb_articles
   where view = 'op-shelves' and status = 'published' and jsonb_array_length(body) >= 5;
  if n <> 1 then raise exception 'the shelves article is missing or thin'; end if;

  raise notice 'operator articles: % published, % held, % screens covered',
    (select count(*) from public.kb_articles where persona = 'operator' and status = 'published'),
    (select count(*) from public.kb_articles where persona = 'operator' and status = 'held'),
    (select count(distinct view) from public.kb_articles
      where persona = 'operator' and view is not null and status = 'published');
end $$;
