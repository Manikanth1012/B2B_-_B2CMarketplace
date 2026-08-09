/* A section list nobody could reorder, and a column nothing ever wrote.
 *
 * Two things were missing from the template editor and they turn out to be the
 * same shape of gap.
 *
 * `invoice_template_sections.sort_order` has existed since the table did. It is
 * per template, which is exactly right — one template's layout is not another's
 * — and nothing has ever written it. `saveSections` copies the GLOBAL
 * `invoice_sections.sort_order` in when a section is added and never touches it
 * again, so every template on the marketplace prints its blocks in one fixed
 * order that no screen offers to change. The column is a sentence about an
 * intention, not a control.
 *
 * And the catalogue is a closed set of seventeen. There is no way to put a
 * regulatory footer on the Kenyan documents, or a payment instruction that
 * applies to one seller, without a migration — which means in practice it does
 * not happen.
 *
 * ---- What a custom section is, and is not -----------------------------------
 *
 * A heading and free text, written once per template. Deliberately not a
 * seventeenth kind of live data block: every built-in section renders figures
 * the marketplace computes, and those have to stay code-backed or a template
 * becomes a place to invent numbers. A custom section says something; it does
 * not calculate anything.
 *
 * It lives in `invoice_sections` because `invoice_template_sections.section_id`
 * is a foreign key to it and the ordering has to be one list — a custom block
 * that could not sit between two built-in ones would not be worth adding. What
 * marks it out is `owner_template`: a custom section belongs to exactly one
 * template and is offered to no other. Two templates wanting the same footer
 * write it twice, which is the honest answer — they are two documents, and one
 * of them will want to change it.
 *
 * ---- Why the order is not free ---------------------------------------------
 *
 * "Summary and total" says of itself: *reconciles every block above it*. Put it
 * above the charges and the document makes a false statement about its own
 * arithmetic. The masthead is the masthead because it is first. The fiscal
 * stamp stamps the total it follows.
 *
 * So ordering is constrained rather than free, and the constraint is stated in
 * the data rather than enforced by the shape of a list nobody can edit. Each
 * section declares where it may sit: pinned to the top, pinned below the
 * summary, or free to move anywhere between. The rule is evaluated twice — here
 * on write, and in `orderProblem` so the screen can grey out an arrow rather
 * than accept a drag and then refuse to save it.
 */

begin;

alter table invoice_sections
  add column if not exists custom         boolean not null default false,
  add column if not exists owner_template text references invoice_templates(id) on delete cascade,
  add column if not exists heading        text,
  add column if not exists body           text,
  /* Where this section may sit.
       'top'     — the masthead and the parties block. A document that opens
                   with its terms and conditions is not a document.
       'after'   — must follow the summary: the fiscal stamp, the payment slip.
       null      — free to move anywhere in between, which is most of them. */
  add column if not exists anchor         text;

do $$ begin
  alter table invoice_sections add constraint invoice_sections_anchor_known
    check (anchor is null or anchor in ('top', 'after'));
exception when duplicate_object then null; end $$;

/* A custom section is a heading and words, owned by one template, and never
   locked — locking somebody's own footer against them is a rule with no
   argument behind it. A built-in carries none of those columns: it renders
   computed figures, and a heading typed beside it would be a second name for
   a block that already has one. */
do $$ begin
  alter table invoice_sections add constraint invoice_sections_custom_is_words
    check (
      case when custom
        then owner_template is not null
         and coalesce(heading, '') <> ''
         and coalesce(body, '') <> ''
         and not locked
        else owner_template is null and heading is null and body is null
      end);
exception when duplicate_object then null; end $$;

/* The built-ins, told where they may sit. Everything not named here is free. */
update invoice_sections set anchor = 'top'   where id in ('masthead', 'parties');
update invoice_sections set anchor = 'after' where id in ('fiscal', 'slip');

/* ---- Writing a custom section ---------------------------------------------
 *
 * A function rather than an insert policy, because the id has to be derived
 * from the template that owns it and the position has to land at the end of
 * that template's list — two facts a client would have to compute, and would
 * eventually compute differently from the next client.
 */
create or replace function public.add_custom_section(
  p_template text, p_heading text, p_body text)
returns text language plpgsql security invoker as $$
declare v_id text; v_pos int; v_audience text;
begin
  if coalesce(trim(p_heading), '') = '' then
    raise exception 'A section needs a heading. A block of text with no name is one nobody can find on the page.';
  end if;
  if coalesce(trim(p_body), '') = '' then
    raise exception 'A section needs something to say. An empty block prints as a heading and a gap.';
  end if;

  select audience into v_audience from public.invoice_templates where id = p_template;
  if v_audience is null then
    raise exception '% is not a template.', p_template;
  end if;

  /* Offered to whoever the template is for. A section that belongs to one
     template is never offered to another, so a narrower audience than the
     template's own would only ever hide it from itself. */
  v_id := format('custom:%s:%s', p_template, substr(md5(p_heading || clock_timestamp()::text), 1, 6));

  select coalesce(max(sort_order), 0) + 1 into v_pos
    from public.invoice_template_sections where template_id = p_template;

  insert into public.invoice_sections
    (id, label, note, locked, audiences, sort_order, custom, owner_template, heading, body, anchor)
  values (
    v_id, trim(p_heading),
    'Written for this template. Not offered to any other.',
    false,
    case when v_audience = 'any'
      then array['consumer', 'enterprise', 'partner']
      else array[v_audience] end,
    v_pos, true, p_template, trim(p_heading), trim(p_body), null);

  insert into public.invoice_template_sections (template_id, section_id, sort_order)
  values (p_template, v_id, v_pos);

  return v_id;
end $$;

grant execute on function public.add_custom_section(text, text, text) to authenticated;

/* ---- The order, enforced where it is written ------------------------------- */

create or replace function public.guard_section_order()
returns trigger language plpgsql as $$
declare v_anchor text; v_summary int; v_bad text;
begin
  select anchor into v_anchor from public.invoice_sections where id = new.section_id;

  /* A top-anchored section that is not at the top, or a below-summary section
     above it, produces a document that lies about itself — "reconciles every
     block above it" over a summary with nothing above it. */
  if v_anchor = 'top' then
    select string_agg(s.id, ', ') into v_bad
      from public.invoice_template_sections ts
      join public.invoice_sections s on s.id = ts.section_id
     where ts.template_id = new.template_id
       and ts.section_id <> new.section_id
       and coalesce(s.anchor, '') <> 'top'
       and ts.sort_order < new.sort_order;
    if v_bad is not null then
      raise exception
        '% opens the document and cannot sit below %. The masthead and the parties '
        'block are what a reader identifies the document by before they read any of it.',
        new.section_id, v_bad;
    end if;
  end if;

  if v_anchor = 'after' then
    select ts.sort_order into v_summary
      from public.invoice_template_sections ts
     where ts.template_id = new.template_id and ts.section_id = 'summary';
    if v_summary is not null and new.sort_order < v_summary then
      raise exception
        '% follows the total. A fiscal stamp or a payment slip above the figure it '
        'refers to is a document nobody can check.', new.section_id;
    end if;
  end if;

  return new;
end $$;

drop trigger if exists z_guard_section_order on public.invoice_template_sections;
create trigger z_guard_section_order
  before insert or update on public.invoice_template_sections
  for each row execute function public.guard_section_order();

commit;

/* ---- What has to be true ---------------------------------------------------- */

do $$
declare n int; bad text; v_id text;
begin
  /* Every built-in still declares nothing custom about itself. */
  select string_agg(id, ', ') into bad from public.invoice_sections
   where not custom and (owner_template is not null or heading is not null or body is not null);
  if bad is not null then raise exception 'built-in sections carrying custom columns: %', bad; end if;

  /* The anchors are on the sections whose meaning depends on where they sit,
     and on no others — an over-anchored catalogue is one nobody can reorder,
     which is the state this migration is undoing. */
  select string_agg(id, ', ') into bad from public.invoice_sections
   where anchor = 'top' and id not in ('masthead', 'parties');
  if bad is not null then raise exception 'unexpected top anchor on %', bad; end if;
  select count(*) into n from public.invoice_sections where anchor is null and not custom;
  if n < 10 then raise exception 'only % sections are free to move; the list is anchored shut', n; end if;

  /* The per-template order is still one position per section. Two sections at
     one position means the document order is decided by whatever the database
     returns first. */
  select string_agg(format('%s: %s', template_id, ids), '; ') into bad
    from (select template_id, sort_order, string_agg(section_id, ' and ') ids, count(*) c
            from public.invoice_template_sections group by template_id, sort_order) g
   where g.c > 1;
  if bad is not null then raise exception 'two sections share a position: %', bad; end if;

  /* The guard refuses, and refuses for its own reason rather than because some
     other column was missing. */
  begin
    update public.invoice_template_sections set sort_order = 99
     where template_id = 'BT-CON' and section_id = 'masthead';
    bad := 'the masthead was moved to the bottom';
  exception when others then
    bad := case when sqlerrm like '%opens the document%' then null else sqlerrm end;
  end;
  if bad is not null then raise exception 'the order guard did not hold: %', bad; end if;

  begin
    update public.invoice_template_sections set sort_order = 1
     where template_id = 'BT-CON' and section_id = 'fiscal';
    bad := 'the fiscal stamp was moved above the total';
  exception when others then
    bad := case when sqlerrm like '%follows the total%' then null else sqlerrm end;
  end;
  if bad is not null then raise exception 'the stamp guard did not hold: %', bad; end if;

  /* And it lets an ordinary move through, or the rule is not a constraint but
     a lock. */
  update public.invoice_template_sections set sort_order = 6
   where template_id = 'BT-CON' and section_id = 'rewards';
  update public.invoice_template_sections set sort_order = 7
   where template_id = 'BT-CON' and section_id = 'credits';
  select count(*) into n from public.invoice_template_sections
   where template_id = 'BT-CON' and section_id = 'rewards' and sort_order = 6;
  if n <> 1 then raise exception 'an ordinary reorder was refused'; end if;
  /* Put back: this is an assertion, not a change to somebody's layout. */
  update public.invoice_template_sections set sort_order = 7
   where template_id = 'BT-CON' and section_id = 'rewards';
  update public.invoice_template_sections set sort_order = 6
   where template_id = 'BT-CON' and section_id = 'credits';

  /* A custom section can be written, is offered to its own template and to no
     other, and cannot be written empty. */
  begin
    perform public.add_custom_section('BT-CON', '  ', 'Something');
    bad := 'a section with no heading was accepted';
  exception when others then
    bad := case when sqlerrm like '%needs a heading%' then null else sqlerrm end;
  end;
  if bad is not null then raise exception '%', bad; end if;

  v_id := public.add_custom_section('BT-CON', 'Assertion probe', 'Written and removed by the migration.');
  select count(*) into n from public.invoice_sections
   where id = v_id and custom and owner_template = 'BT-CON' and not locked;
  if n <> 1 then raise exception 'the custom section was not written as one'; end if;
  select count(*) into n from public.invoice_template_sections
   where template_id = 'BT-CON' and section_id = v_id;
  if n <> 1 then raise exception 'the custom section was not put on its template'; end if;
  delete from public.invoice_sections where id = v_id;
end $$;
