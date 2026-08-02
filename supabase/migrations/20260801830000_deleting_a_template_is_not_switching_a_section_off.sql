-- No template could be deleted. Any template, including the drafts the delete
-- path exists for.
--
-- `invoice_template_sections` cascades from `invoice_templates`, and the guard
-- that stops somebody switching the tax block off fires on every one of those
-- cascaded rows. So deleting a template raised "The Masthead and logos section
-- cannot be switched off" — a refusal that is correct about the row in front of
-- it and wrong about what was happening.
--
-- The two cases are genuinely different and the guard could not tell them
-- apart. Switching a section off leaves a document that is no longer a bill.
-- Deleting a template leaves no document at all, which is a decision already
-- guarded one table up: system templates cannot go, and neither can one
-- somebody is still billed on.
--
-- The parent row is already gone by the time a referential action runs, so
-- "is the template still there?" separates them exactly.
--
-- Found by the integration suite's own cleanup, which is the useful place for
-- it to be found: a test that cannot undo what it did is a test telling you
-- the delete path does not work.

create or replace function guard_invoice_template() returns trigger
language plpgsql security definer set search_path = public as $$
declare locked boolean; n integer; who text;
begin
  if current_persona() is null then
    return case tg_op when 'DELETE' then old else new end;
  end if;

  if tg_table_name = 'invoice_template_sections' and tg_op = 'DELETE' then
    /* The template is going, so this is not somebody taking a section off it.
       Whether the template may go at all was decided on `invoice_templates`
       before this cascade ever ran. */
    if not exists (select 1 from invoice_templates where id = old.template_id) then
      return old;
    end if;

    select s.locked into locked from invoice_sections s where s.id = old.section_id;
    if coalesce(locked, false) then
      raise exception 'The % section cannot be switched off. A document without both parties, the tax breakdown and a summary that reconciles is not a bill.',
        (select label from invoice_sections where id = old.section_id);
    end if;
    return old;
  end if;

  if tg_table_name = 'invoice_templates' and tg_op = 'DELETE' then
    if old.system then
      raise exception '% ships with the marketplace. It can be edited but not deleted — an audience with no template has no bill.', old.name;
    end if;
    select string_agg(coalesce(party_id, audience), ', ') into who
      from invoice_template_assignments where template_id = old.id;
    if who is not null then
      raise exception '% is still assigned to %. Point them at another template first.', old.name, who;
    end if;
    return old;
  end if;

  if tg_table_name = 'invoice_template_assignments' and tg_op in ('INSERT', 'UPDATE') then
    select count(*) into n from invoice_templates
     where id = new.template_id and audience in (new.audience, 'any');
    if n = 0 then
      raise exception 'That template is not written for a % counterparty.', new.audience;
    end if;
  end if;

  return new;
end $$;

/* ------------------------------------------------------- sanity checks -- */
do $$
declare n integer;
begin
  /* Delete a throwaway template with all four locked sections on it and prove
     it goes, along with its sections.
     This runs with `current_persona()` null, so the guard short-circuits and
     what is proved here is the cascade rather than the new branch. The branch
     itself is proved by the integration suite, which does the same delete
     signed in as the operator. Both are worth having: this one fails the
     migration, that one fails the build. */
  insert into invoice_templates (id, name, audience, doc_title, system, numbering)
    values ('BT-ZZTEST', 'Throwaway', 'consumer', 'Test', false, 'ZZ-{SEQ}');
  insert into invoice_template_sections (template_id, section_id, sort_order)
    select 'BT-ZZTEST', id, sort_order from invoice_sections where locked;

  delete from invoice_templates where id = 'BT-ZZTEST';

  select count(*) into n from invoice_templates where id = 'BT-ZZTEST';
  if n > 0 then raise exception 'a template with locked sections on it still cannot be deleted'; end if;
  select count(*) into n from invoice_template_sections where template_id = 'BT-ZZTEST';
  if n > 0 then raise exception 'the template went and its sections did not'; end if;

  /* And the five that ship are all still here. */
  select count(*) into n from invoice_templates;
  if n <> 5 then raise exception 'the catalogue holds % templates rather than 5', n; end if;
end $$;
