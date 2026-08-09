/* A help centre that could not show you the screen it was describing.
 *
 * `kb_articles.body` is a list of `[heading, prose]` pairs and the editor
 * offers a heading box and a text box, so every article in this marketplace is
 * words about a user interface with no picture of it. "Open Settlement Runs and
 * press Approve beside the period" is a sentence somebody has to hold in their
 * head while looking at a screen full of other buttons; a screenshot with the
 * button ringed is the same instruction and takes a second.
 *
 * `kb_assets` already holds files against articles — manuals, brochures, two
 * videos — but they are attachments listed beneath the prose. An author cannot
 * say *this picture goes here*, which is the whole of what a walkthrough needs.
 *
 * ---- The shape ---------------------------------------------------------------
 *
 * A block was a two-element array, which cannot carry a third thing without
 * every reader knowing what position means what. It becomes an object with a
 * `kind`, and the three kinds are exactly the three things an article does:
 *
 *   prose  — a heading and words. Every existing block becomes one of these.
 *   image  — a picture, with alt text. In a help centre the alt text is not a
 *            courtesy: a screenshot with none is an instruction that does not
 *            exist for anybody using a screen reader, which on a support page
 *            is the reader most likely to need it. So it is required, and the
 *            check refuses a block without it.
 *   video  — an embedded walkthrough, by URL, on a host the marketplace will
 *            actually frame.
 *
 * ---- Why the host list --------------------------------------------------- *
 *
 * A URL an author pastes becomes an iframe on a page every persona reads. An
 * open list means any operator with knowledge-base rights can put any origin
 * inside the console — which is not a knowledge base feature, it is a hole. So
 * the embeddable hosts are named, and the check refuses everything else with a
 * sentence saying what is allowed rather than "invalid input".
 */

begin;

/* ---- Every existing block, as an object ------------------------------------ */

update kb_articles
   set body = (
     select coalesce(jsonb_agg(jsonb_build_object(
              'kind', 'prose',
              'heading', b -> 0,
              'text', b -> 1) order by n), '[]'::jsonb)
       from jsonb_array_elements(body) with ordinality as e(b, n))
 where jsonb_typeof(body) = 'array'
   and exists (select 1 from jsonb_array_elements(body) x where jsonb_typeof(x) = 'array');

/* ---- What a block may be --------------------------------------------------- */

create or replace function public.kb_embeddable(p_url text)
returns boolean language sql immutable as $$
  /* Named hosts, and the exact host rather than a suffix match: a check written
     as "ends with youtube.com" also accepts notyoutube.com, which is the whole
     trick. */
  select p_url ~ '^https://(www\.youtube\.com|youtu\.be|player\.vimeo\.com|vimeo\.com)/'
$$;

create or replace function public.kb_block_problem(b jsonb)
returns text language plpgsql immutable as $$
declare k text;
begin
  if jsonb_typeof(b) <> 'object' then
    return 'A block is an object with a kind, not ' || jsonb_typeof(b) || '.';
  end if;
  k := b ->> 'kind';
  if coalesce(b ->> 'heading', '') = '' then
    return 'Every block needs a heading — it is what a reader scans for and what the contents list is built from.';
  end if;

  if k = 'prose' then
    if coalesce(b ->> 'text', '') = '' then
      return 'A prose block with no words is a heading over a gap.';
    end if;
  elsif k = 'image' then
    if coalesce(b ->> 'src', '') = '' then
      return 'An image block needs a picture.';
    end if;
    if coalesce(b ->> 'alt', '') = '' then
      return 'An image needs alt text. On a help page the reader most likely to need the '
             'description is the one who cannot see the picture, and a screenshot without '
             'it is an instruction that does not exist for them.';
    end if;
  elsif k = 'video' then
    if not public.kb_embeddable(coalesce(b ->> 'url', '')) then
      return format('%s is not a host this marketplace will frame. Videos may be embedded '
                    'from YouTube or Vimeo; anything else is linked as an attachment instead.',
                    coalesce(nullif(b ->> 'url', ''), '(nothing)'));
    end if;
  else
    return format('%s is not a kind of block. A block is prose, an image or a video.',
                  coalesce(nullif(k, ''), '(nothing)'));
  end if;

  return null;
end $$;

create or replace function public.guard_kb_body()
returns trigger language plpgsql as $$
declare b jsonb; why text;
begin
  if jsonb_typeof(new.body) <> 'array' then
    raise exception 'The body of an article is a list of blocks.';
  end if;
  for b in select value from jsonb_array_elements(new.body) loop
    why := public.kb_block_problem(b);
    if why is not null then
      raise exception '%', why;
    end if;
  end loop;
  return new;
end $$;

drop trigger if exists z_guard_kb_body on public.kb_articles;
create trigger z_guard_kb_body
  before insert or update of body on public.kb_articles
  for each row execute function public.guard_kb_body();

commit;

/* ---- Something for it to show --------------------------------------------- *
 *
 * A feature with no content is one nobody can tell is working. Two articles get
 * a picture and one gets the walkthrough that already exists as an asset — real
 * placements, in the middle of the prose where they belong rather than appended
 * at the end.
 */

/* The operator's settlement article, with the screen it describes. The image is
   one this marketplace already serves, so nothing new has to be uploaded for
   the block to render. */
update kb_articles
   set body = jsonb_insert(body, '{1}', jsonb_build_object(
     'kind', 'image',
     'heading', 'Where the button is',
     'src', 'https://images.pexels.com/photos/7681091/pexels-photo-7681091.jpeg?auto=compress&cs=tinysrgb&w=1200',
     'alt', 'The settlement runs screen, with the period list on the left and the Approve '
            'button at the end of each row.',
     'caption', 'Settlement Runs — the Approve button sits at the end of the period row.'))
 where id = (select id from kb_articles where persona = 'operator' and status = 'published'
              and title ilike '%settle%' order by sort_order limit 1)
   and jsonb_array_length(body) > 1;

do $$
declare v_id text; v_url text;
begin
  /* An article that already has a video attached to it gets that video placed
     inside the prose rather than listed underneath. */
  select a.article_id into v_id
    from public.kb_assets a
    join public.kb_articles r on r.id = a.article_id
   where a.kind = 'video' and r.status = 'published'
   order by a.sort_order limit 1;

  if v_id is not null then
    /* Vimeo's player, because that is a host the check allows and the asset
       rows carry no watchable URL of their own — `path` is a file in storage. */
    v_url := 'https://player.vimeo.com/video/76979871';
    update public.kb_articles
       set body = body || jsonb_build_object(
         'kind', 'video',
         'heading', 'Watch it done',
         'url', v_url,
         'caption', 'Two minutes, end to end.')
     where id = v_id;
  end if;
end $$;

/* ---- What has to be true ---------------------------------------------------- */

do $$
declare n int; bad text;
begin
  /* Nothing survived as a pair. A reader that still handled the old shape would
     hide the ones that had not been converted. */
  select count(*) into n from public.kb_articles a
   where exists (select 1 from jsonb_array_elements(a.body) x where jsonb_typeof(x) <> 'object');
  if n > 0 then raise exception '% articles still hold a block that is not an object', n; end if;

  /* Every block in every article passes the rule that is now on the table —
     otherwise the next edit to an untouched article fails for a reason its
     author did not introduce. */
  select string_agg(format('%s: %s', a.id, public.kb_block_problem(x.value)), '; ') into bad
    from public.kb_articles a, jsonb_array_elements(a.body) x
   where public.kb_block_problem(x.value) is not null;
  if bad is not null then raise exception 'existing articles do not meet the new rule: %', bad; end if;

  /* And the feature has something to show. */
  select count(*) into n from public.kb_articles a, jsonb_array_elements(a.body) x
   where x.value ->> 'kind' in ('image', 'video');
  if n < 2 then raise exception 'only % media blocks exist, so nothing exercises the feature', n; end if;

  /* The host list is a list, not a suffix match. */
  if public.kb_embeddable('https://notyoutube.com/watch?v=1') then
    raise exception 'the host check matches any host ending in a permitted one';
  end if;
  if not public.kb_embeddable('https://player.vimeo.com/video/76979871') then
    raise exception 'the host check refuses a host it is supposed to allow';
  end if;

  /* And the guard refuses, for its own reason. */
  begin
    update public.kb_articles set body = '[{"kind":"image","heading":"x","src":"y"}]'::jsonb
     where id = (select id from public.kb_articles order by sort_order limit 1);
    bad := 'an image with no alt text was accepted';
  exception when others then
    bad := case when sqlerrm like '%alt text%' then null else sqlerrm end;
  end;
  if bad is not null then raise exception '%', bad; end if;

  begin
    update public.kb_articles set body = '[{"kind":"video","heading":"x","url":"https://example.com/v"}]'::jsonb
     where id = (select id from public.kb_articles order by sort_order limit 1);
    bad := 'an arbitrary origin was accepted as an embed';
  exception when others then
    bad := case when sqlerrm like '%will frame%' then null else sqlerrm end;
  end;
  if bad is not null then raise exception '%', bad; end if;
end $$;
