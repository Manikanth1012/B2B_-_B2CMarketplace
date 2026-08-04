/*
  # A seller can ask about their own commission

  "Request a tier review" on the settlement plan screen raised a toast reading
  "Tier review requested — reference TRV-118". TRV-118 is not a reference to
  anything: no row was written, no queue received it, and a seller who came back
  a week later quoting it would be quoting a number invented in the browser.

  Routing it through the support queue means it lands where every other request
  a seller makes lands. Two things were in the way.

  1. The category a tier review belongs to excluded sellers
     `support_categories.contract` — "Contract and pricing", hint "Renewal terms,
     contract pricing, or a quote" — is the category for it, and its `personas`
     array was `{operator, enterprise}`. A commission ladder is the seller's
     contract pricing; there is no reading of that category under which the
     seller it prices is not allowed to ask about it.

  2. A partner's ticket was not marked as the partner's
     `raiseTicket` never set `partner_id`, so a ticket raised by one person at a
     seller was readable by that person alone. `partner_support_tickets` exists
     precisely so a seller's colleagues can see it, and nothing was ever setting
     the column it reads. The write policy below is what lets the column be set
     in the first place — `own_support_tickets` allows the insert, and a partner
     ticket that names its partner is still that user's own ticket.
*/

update support_categories
   set personas = array['operator', 'partner', 'enterprise']
 where id = 'contract';

/* A seller may raise a ticket against their own company, and read what their
   colleagues raised. Reading was already granted; writing the column was not. */
create policy partner_write_own_support_tickets on support_tickets
  for all to authenticated
  using (partner_id = current_partner_id())
  with check (partner_id = current_partner_id() and account_id is null);

do $$
declare
  n integer;
begin
  select count(*) into n from support_categories
   where id = 'contract' and 'partner' = any(personas);
  if n <> 1 then
    raise exception 'A seller still cannot file under the category their commission ladder belongs to';
  end if;

  /* Every persona named on a category has to be one the product has. A typo
     here removes a category from a console silently. */
  select count(*) into n from support_categories c, unnest(c.personas) p
   where p not in ('operator', 'partner', 'enterprise', 'consumer');
  if n > 0 then
    raise exception '% support categories name a persona that does not exist', n;
  end if;

  select count(*) into n from pg_policies
   where tablename = 'support_tickets' and policyname = 'partner_write_own_support_tickets';
  if n <> 1 then
    raise exception 'The seller write policy did not take';
  end if;
end $$;
