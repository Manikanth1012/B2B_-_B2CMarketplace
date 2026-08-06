/* A screen whose help button opened nothing.
 *
 * `helpCoverage` asks every screen in the product for the article its help
 * button would open, as the persona that reads it. The new seller Developer
 * screen had none, so pressing help there gave an empty dialog — a check that
 * exists precisely because a screen shipped without its answer is invisible
 * until somebody in a demo presses the button.
 *
 * The article answers what a developer arriving at that screen is actually
 * asking, in the order they ask it: why sandbox is instant and production is
 * not, what an application is for, what happens to a secret, and what to do
 * when a version they are calling is going to be switched off.
 */

begin;

insert into kb_articles (id, persona, kind, title, mins, view, status, sort_order,
                         tags, personas, summary, body)
values (
  'KB-P09', 'partner', 'howto', 'Get an API key and make your first call', 5,
  'pt-developer', 'published', 4,
  array['api', 'keys', 'sandbox'], array['partner'],
  'Register an application, collect sandbox keys, run a real call, and ask for production.',
  jsonb_build_array(
    jsonb_build_array(
      'Start with an application',
      'An application is the thing that holds keys — not your company. Run as many as you need: '
      || 'one for your production integration, one for an agency doing your catalogue, one for a spike. '
      || 'Each has its own keys, so revoking one does not take the others down.'),
    jsonb_build_array(
      'Sandbox is instant',
      'Register and sandbox credentials are issued immediately, with no approval and no waiting. '
      || 'Deciding whether to integrate at all should not take a week.'),
    jsonb_build_array(
      'The secret is shown once',
      'It is stored as a salted hash. Nobody at the marketplace can read it back, and neither can the '
      || 'screen once you close it. Lose it and you rotate — a replacement is issued straight away and '
      || 'the old key keeps working for the grace period you choose, so nothing breaks the moment you click. '
      || 'Revoke instead of rotating only when a key is known to be exposed: there is no grace period on that.'),
    jsonb_build_array(
      'Subscribe before anything authenticates',
      'A key on its own calls nothing. Subscribe the application to the API version you want, and ask '
      || 'only for the scopes you will use — every endpoint in the reference says which one it needs.'),
    jsonb_build_array(
      'Run the call before you write the code',
      'The sandbox console sends real calls with your real key. Reads answer with your own listings, '
      || 'orders and settlement lines, shaped the way the specification says, so a shape mismatch shows up '
      || 'here rather than in production. Writes are validated and echoed and nothing is stored. '
      || 'A call you are not entitled to make returns the same 401 or 403 the live gateway would.'),
    jsonb_build_array(
      'Production is asked for, not issued',
      'Production carries real customers and real money, so the marketplace decides — on the sentence you '
      || 'write saying what it is for. Your sandbox access is unaffected while they decide, and a refusal '
      || 'always comes back with a reason you can act on.'),
    jsonb_build_array(
      'Watch for a sunset date',
      'A deprecated version has a date it stops answering and a note saying what to move to, and both '
      || 'appear at the top of this screen while you are still calling it. That banner is the only warning '
      || 'you get — after the date, calls return 404.')
  )
)
on conflict (id) do update set
  title = excluded.title, body = excluded.body, summary = excluded.summary,
  view = excluded.view, status = excluded.status;

do $$
declare n int;
begin
  select count(*) into n from kb_articles
   where view = 'pt-developer' and status = 'published' and 'partner' = any(personas);
  if n = 0 then
    raise exception 'the Developer screen still opens a help dialog with nothing in it';
  end if;
  /* The coverage check also refuses an article too thin to answer anything. */
  select jsonb_array_length(body) into n from kb_articles where id = 'KB-P09';
  if n < 4 then raise exception 'the article is too thin to be an answer: % sections', n; end if;
end $$;

commit;
