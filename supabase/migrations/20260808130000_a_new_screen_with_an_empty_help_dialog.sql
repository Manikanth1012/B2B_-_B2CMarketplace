/* A new screen whose help button opened onto nothing.
 *
 * `helpCoverage` asks, as each persona in turn, for the article behind every
 * screen that persona can reach — and it does not accept a row coming back as
 * an answer, because a row with an empty body renders the same useless dialog.
 * Shelves and rules was added and the check caught it within the hour.
 *
 * Which is the point of that test existing, and worth saying plainly: the help
 * article is part of the screen, not a follow-up. An operator changing a rating
 * bar is one click from removing a supplier, and "are you sure" is not an
 * explanation of what they are about to do.
 */

insert into public.kb_articles
  (id, persona, personas, kind, title, mins, updated, view, roles, tags, summary, body, status, sort_order)
values (
  'KB-O24', 'operator', array['operator'], 'howto',
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
  'published', 24)
on conflict (id) do update set
  title = excluded.title, summary = excluded.summary, body = excluded.body,
  view = excluded.view, roles = excluded.roles, tags = excluded.tags,
  status = excluded.status, updated = excluded.updated;

do $$
declare a public.kb_articles;
begin
  select * into a from public.kb_articles where view = 'op-shelves' and status = 'published';
  if a.id is null then raise exception 'the shelves screen still has no published article'; end if;

  /* The same bar the coverage check applies: a row is not an answer. */
  if coalesce(trim(a.title), '') = '' or coalesce(trim(a.summary), '') = ''
     or jsonb_array_length(a.body) < 3 then
    raise exception 'the article is too thin to answer anything (% sections)', jsonb_array_length(a.body);
  end if;

  /* And every section is a heading and a body, not a heading alone. */
  if exists (
    select 1 from jsonb_array_elements(a.body) s
     where jsonb_array_length(s) < 2 or coalesce(trim(s ->> 1), '') = ''
  ) then
    raise exception 'the article has a heading with nothing under it';
  end if;

  raise notice 'op-shelves article: % sections, roles %', jsonb_array_length(a.body), a.roles;
end $$;
