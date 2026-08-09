/* Twelve Kenyan bills carry a KRA control unit number nothing can print.
 *
 * `einvoice_clearance` has held the fiscal stamp for every document since the
 * clearance work: an IRN, acknowledgement number and signed QR for India, and
 * for Kenya the eTIMS control unit invoice number, the CU serial, and the iTax
 * URL a buyer checks it against. Twelve consumer bills and six enterprise
 * invoices in Kenya are `cleared` and carry all three.
 *
 * `invoice_sections` had sixteen sections and not one of them printed any of
 * it. So the marketplace holds the stamp, the document has nowhere to put it,
 * and a Kenyan buyer receives a bill that under the VAT (Electronic Tax
 * Invoice) Regulations is not a tax invoice at all — they cannot claim input
 * VAT against it, and the seller cannot prove it was transmitted.
 *
 * One section, not one per country. A template here is assigned by audience
 * and serves every market — BT-CON issues Indian, Emirati and Kenyan bills
 * alike — so a section called "eTIMS" would be off on two thirds of the
 * documents it appeared on. This one prints the clearance the document
 * actually carries and says which regime it is under: the Indian rows print an
 * IRN, the Kenyan rows print a CU number, and a document whose market requires
 * no clearance prints nothing rather than an empty heading.
 *
 * Locked, for the same reason. Switching it off is only harmless on the
 * documents that never needed it, and there is no per-market switch to make
 * that distinction with — one toggle would take the stamp off every Kenyan
 * invoice on the template. `tax` and `summary` are locked on the same
 * argument: a section the law puts on the page is not a preference.
 */

begin;

/* Room at position ten. The stamp belongs directly under the total it is a
   stamp on, which is where both authorities' own specimens put it and where a
   reader checking a figure against a portal will look for it. */
update invoice_sections set sort_order = sort_order + 1 where sort_order >= 10;

insert into invoice_sections (id, label, note, locked, audiences, sort_order)
values (
  'fiscal',
  'Fiscal clearance',
  'The tax authority''s own reference for this document — an IRN and signed QR in India, '
  'an eTIMS control unit number and verification link in Kenya. Printed only where the '
  'market requires clearance.',
  true,
  array['consumer', 'enterprise', 'partner'],
  10)
on conflict (id) do update
  set label = excluded.label, note = excluded.note,
      locked = excluded.locked, audiences = excluded.audiences,
      sort_order = excluded.sort_order;

/* Onto every template that already carries the total it stamps. A template
   that has been given the section stays as it is — this is a backfill, not a
   reset of somebody's layout. */
insert into invoice_template_sections (template_id, section_id, sort_order)
  select t.id, 'fiscal', 10
    from invoice_templates t
   where exists (
     select 1 from invoice_template_sections ts
      where ts.template_id = t.id and ts.section_id = 'summary')
on conflict do nothing;

/* And the per-template order follows the global one for everything after it,
   so the stamp does not land on top of the section that used to be tenth.
   `invoice_template_sections.sort_order` is a copy of the global figure taken
   when the section was added; nothing has ever written it since. */
update invoice_template_sections ts
   set sort_order = s.sort_order
  from invoice_sections s
 where s.id = ts.section_id and ts.section_id <> 'fiscal';

commit;

/* ---- What has to be true ---------------------------------------------------- */

do $$
declare n int; bad text;
begin
  /* The section exists, is locked, and is offered to all three audiences —
     Kenya requires the stamp on a B2C receipt as much as a B2B invoice. */
  select count(*) into n from public.invoice_sections
   where id = 'fiscal' and locked
     and audiences @> array['consumer', 'enterprise', 'partner'];
  if n <> 1 then raise exception 'the fiscal section is missing or not locked for every audience'; end if;

  /* No two sections share a position, or the document order is decided by
     whatever the database happens to return first. */
  select string_agg(format('%s at %s', ids, sort_order), '; ') into bad
    from (select sort_order, string_agg(id, ' and ') ids, count(*) c
            from public.invoice_sections group by sort_order) g
   where g.c > 1;
  if bad is not null then raise exception 'two sections claim one position: %', bad; end if;

  /* Every template that prints a total now prints the stamp under it. */
  select string_agg(t.id, ', ') into bad
    from public.invoice_templates t
   where exists (select 1 from public.invoice_template_sections ts
                  where ts.template_id = t.id and ts.section_id = 'summary')
     and not exists (select 1 from public.invoice_template_sections ts
                      where ts.template_id = t.id and ts.section_id = 'fiscal');
  if bad is not null then
    raise exception 'these templates print a total with no clearance under it: %', bad;
  end if;

  /* The per-template order agrees with the global one, so the stamp is not
     sitting on top of whatever used to be tenth. */
  select string_agg(format('%s/%s: %s vs %s', ts.template_id, ts.section_id, ts.sort_order, s.sort_order), '; ')
    into bad
    from public.invoice_template_sections ts
    join public.invoice_sections s on s.id = ts.section_id
   where ts.sort_order <> s.sort_order;
  if bad is not null then raise exception 'template order disagrees with the section order: %', bad; end if;

  /* And the thing this is all for: there is real clearance to print. A section
     added against no data would render as nothing on every document and
     nobody would know it had never worked. */
  select count(*) into n from public.einvoice_clearance
   where market = 'KE' and status = 'cleared' and coalesce(cu_invoice_no, '') <> '';
  if n = 0 then raise exception 'no Kenyan document carries a control unit number, so the section has nothing to print'; end if;

  select count(*) into n from public.einvoice_clearance
   where market = 'IN' and status = 'cleared' and coalesce(irn, '') <> '';
  if n = 0 then raise exception 'no Indian document carries an IRN'; end if;
end $$;
