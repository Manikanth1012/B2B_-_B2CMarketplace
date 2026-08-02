-- The document a bill comes out as, decided by the operator rather than by us.
--
-- Every persona in this marketplace gets billed and none of them gets the same
-- document. A retail customer wants the amount due at the top, a payment slip
-- at the bottom and — commercially — one offer in the middle. A procurement
-- team wants every line itemised against a purchase order and did not ask to
-- be sold to on a tax invoice. A seller gets a self-billing invoice, where a
-- payment slip is backwards because the marketplace pays them.
--
-- Those are three documents, and the difference between them is which sections
-- appear and in what order. That is configuration, so it lives here: a
-- catalogue of sections, a set of templates that pick from it, and an
-- assignment saying which audience gets which.
--
-- Four sections cannot be switched off. A document without both parties, the
-- tax breakdown and a summary that reconciles is not a bill — it is a letter
-- about money. That constraint is in the database rather than in the form,
-- because a form is a suggestion.

/* ================================================== what a bill is made of === */

create table if not exists invoice_sections (
  id         text primary key,
  label      text not null,
  note       text not null,
  /* Cannot be switched off on any template, at all, by anybody. */
  locked     boolean not null default false,
  /* Which audiences it makes sense for. A payment slip on a self-billing
     invoice is not a preference, it is backwards. */
  audiences  text[] not null default array['consumer', 'enterprise', 'partner'],
  sort_order integer not null
);

insert into invoice_sections (id, label, note, locked, audiences, sort_order) values
  ('masthead', 'Masthead and logos', 'Issuing operator and platform marks, and the document title.',
   true, array['consumer', 'enterprise', 'partner'], 1),
  ('parties', 'Billed to and bill from', 'Both parties, with registered address, contact and tax registration.',
   true, array['consumer', 'enterprise', 'partner'], 2),
  ('hero', 'Amount due panel', 'The figure, large, near the top. What most people open the document to find.',
   false, array['consumer', 'enterprise', 'partner'], 3),
  ('subs', 'Subscriptions and recurring', 'Itemised by service, seller, quantity and rate.',
   false, array['consumer', 'enterprise', 'partner'], 4),
  ('usage', 'Usage and one-off charges', 'Anything billed in arrears rather than in advance.',
   false, array['consumer', 'enterprise', 'partner'], 5),
  ('credits', 'Credits and adjustments', 'Shown even when nil, so nobody wonders whether it was forgotten.',
   false, array['consumer', 'enterprise', 'partner'], 6),
  ('rewards', 'Reward points', 'Earned this period, balance, and anything redeemed against this bill.',
   false, array['consumer', 'enterprise'], 7),
  ('tax', 'Taxation breakdown', 'Component, rate, taxable base and tax. Required for a tax invoice.',
   true, array['consumer', 'enterprise', 'partner'], 8),
  ('summary', 'Summary and total', 'Reconciles every block above it. If it does not add up, the bill is wrong.',
   true, array['consumer', 'enterprise', 'partner'], 9),
  ('payments', 'Payments received', 'What has already been paid this period, so the balance is not a surprise.',
   false, array['consumer', 'enterprise', 'partner'], 10),
  ('howtopay', 'How to pay', 'Bank detail, the reference to quote, and what happens if it is late.',
   false, array['consumer', 'enterprise', 'partner'], 11),
  ('paylink', 'Payment link and QR', 'A one-tap link to settle it. Suppressed on a bill already paid.',
   false, array['consumer', 'enterprise'], 12),
  ('support', 'Support and contact', 'Who to call, and by when a query has to be raised.',
   false, array['consumer', 'enterprise', 'partner'], 13),
  ('advert', 'Advertisement or banner', 'One relevant offer, drawn from the storefront banners. Never on a dunning or final notice.',
   false, array['consumer'], 14),
  ('terms', 'Terms and conditions', 'Numbered, two columns, at the foot.',
   false, array['consumer', 'enterprise', 'partner'], 15),
  ('slip', 'Payment slip', 'Detachable, below a tear line. For somebody paying over a counter.',
   false, array['consumer', 'enterprise'], 16)
on conflict (id) do update set
  label = excluded.label, note = excluded.note, locked = excluded.locked,
  audiences = excluded.audiences, sort_order = excluded.sort_order;

/* ========================================================= the templates === */

create table if not exists invoice_templates (
  id          text primary key,
  name        text not null,
  audience    text not null check (audience in ('consumer', 'enterprise', 'partner', 'any')),
  /* What is printed at the top. "Tax invoice" carries a legal meaning in some
     jurisdictions, which is why it is a field rather than a constant. */
  doc_title   text not null,
  accent      text not null default '#0D47A1',
  note        text not null default '',
  /* Ships with the marketplace. Editable, never deletable — an audience with
     no template has no bill. */
  system      boolean not null default false,

  /* Formatting belongs to the template rather than to a separate settings
     object. Two screens each holding half the answer is how a numbering
     pattern and a document title end up disagreeing on the same bill. */
  numbering     text not null default 'INV-{YYYY}-{SEQ}',
  next_seq      integer not null default 1,
  date_format   text not null default 'DD MMM YYYY',
  currency      text not null default 'USD',
  tax_label     text not null default 'Tax',
  rounding      text not null default 'Half up, 2 decimal places',
  language      text not null default 'English',
  logo          boolean not null default true,
  show_order_lines boolean not null default true,
  remittance    text not null default '',
  footer        text not null default '',

  updated_by  text,
  updated_on  date,
  sort_order  integer not null default 0
);

alter table invoice_templates drop constraint if exists invoice_templates_numbering_check;
alter table invoice_templates add constraint invoice_templates_numbering_check
  check (numbering like '%{SEQ}%');

create table if not exists invoice_template_sections (
  template_id text not null references invoice_templates(id) on delete cascade,
  section_id  text not null references invoice_sections(id) on delete cascade,
  sort_order  integer not null default 0,
  primary key (template_id, section_id)
);

/* Which audience gets which template, and the per-counterparty exception —
   one seller in a jurisdiction that demands a particular format does not
   change the document every other seller gets. */
create table if not exists invoice_template_assignments (
  id          text primary key,
  audience    text not null check (audience in ('consumer', 'enterprise', 'partner')),
  /* Null is the default for that audience; a value overrides it for one
     counterparty. */
  party_id    text,
  template_id text not null references invoice_templates(id),
  why         text not null default '',
  updated_by  text,
  updated_on  date
);

create unique index if not exists invoice_assignment_default_idx
  on invoice_template_assignments(audience) where party_id is null;
create unique index if not exists invoice_assignment_party_idx
  on invoice_template_assignments(audience, party_id) where party_id is not null;

/* ------------------------------------------------------------- the five --- */

insert into invoice_templates (id, name, audience, doc_title, accent, note, system,
                               numbering, next_seq, tax_label, currency, language,
                               remittance, footer, updated_by, updated_on, sort_order) values
  ('BT-CON', 'Consumer standard', 'consumer', 'Your monthly bill', '#0D47A1',
   'The full retail bill. Carries the reward summary, the payment link and one offer.', true,
   'BILL-{YYYY}-{SEQ}', 88214, 'GST', 'USD', 'English',
   'Pay online, by card on file, or by bank transfer quoting the bill number.',
   'Issued by Aventa Telecom. Queries within 30 days of the issue date.',
   'Anika Sharma', '2026-07-28', 1),

  ('BT-ENT', 'Enterprise consolidated', 'enterprise', 'Consolidated bill', '#1B5E20',
   'One invoice across every seller. No advert — a procurement team did not ask to be sold to on a tax document.', true,
   'INV-{YYYY}-{SEQ}', 715, 'VAT / GST', 'USD', 'English',
   'Payable by bank transfer within the agreed terms. Quote the invoice number.',
   'Issued by Aventa Telecom. Queries within 30 days of the issue date.',
   'Anika Sharma', '2026-07-28', 2),

  ('BT-PTR', 'Seller self-billing', 'partner', 'Self-billing invoice', '#4527A0',
   'Raised by the marketplace on the seller''s behalf. No payment slip: we pay them, not the reverse.', true,
   'SB-{YYYY}-{PARTNER}-{SEQ}', 1042, 'GST / VAT', 'USD', 'English',
   'Self-billing agreement in place; the seller does not raise an invoice.',
   'Issued by Aventa Telecom under a self-billing agreement.',
   'Anika Sharma', '2026-07-28', 3),

  ('BT-MIN', 'Compact — totals only', 'any', 'Bill', '#37474F',
   'One page. For accounts that reconcile from the data file and want the document short.', false,
   'INV-{YYYY}-{SEQ}', 1, 'Tax', 'USD', 'English',
   'Paid by bank transfer to the account on file. Quote the document reference.',
   'Issued by Aventa Telecom.', 'Ruben Oyelaran', '2026-07-30', 4),

  ('BT-REG', 'Regulator format (India)', 'any', 'Tax invoice', '#B71C1C',
   'Tax invoice wording, no advertising, every charge itemised. Used where the regulator requires it.', false,
   'TI-{YYYY}-{SEQ}', 401, 'GST', 'USD', 'English and Hindi',
   'Paid by bank transfer to the account on file. Quote the document reference.',
   'Tax invoice issued under the Central Goods and Services Tax Act.',
   'Ruben Oyelaran', '2026-07-30', 5)
on conflict (id) do update set
  name = excluded.name, doc_title = excluded.doc_title, note = excluded.note,
  numbering = excluded.numbering, tax_label = excluded.tax_label;

/* `show_order_lines` off is what makes the compact template compact. */
update invoice_templates set show_order_lines = false where id = 'BT-MIN';

insert into invoice_template_sections (template_id, section_id, sort_order)
select t.id, s.id, s.sort_order
  from invoice_templates t
  join invoice_sections s on true
 where (t.id = 'BT-CON' and s.id in ('masthead','parties','hero','subs','usage','credits','rewards',
                                     'tax','summary','payments','howtopay','paylink','support',
                                     'advert','terms','slip'))
    or (t.id = 'BT-ENT' and s.id in ('masthead','parties','hero','subs','usage','credits','rewards',
                                     'tax','summary','payments','howtopay','paylink','support',
                                     'terms','slip'))
    or (t.id = 'BT-PTR' and s.id in ('masthead','parties','hero','usage','credits',
                                     'tax','summary','support','terms'))
    or (t.id = 'BT-MIN' and s.id in ('masthead','parties','hero','tax','summary','howtopay','support'))
    or (t.id = 'BT-REG' and s.id in ('masthead','parties','hero','subs','usage','credits',
                                     'tax','summary','payments','howtopay','support','terms'))
on conflict (template_id, section_id) do nothing;

insert into invoice_template_assignments (id, audience, party_id, template_id, why, updated_by, updated_on) values
  ('IA-CON', 'consumer',   null,       'BT-CON', 'Every retail customer.', 'Anika Sharma', '2026-07-28'),
  ('IA-ENT', 'enterprise', null,       'BT-ENT', 'Every business account.', 'Anika Sharma', '2026-07-28'),
  ('IA-PTR', 'partner',    null,       'BT-PTR', 'Every seller we self-bill.', 'Anika Sharma', '2026-07-28'),
  ('IA-1003', 'partner',   'PTR-1003', 'BT-REG',
   'Registered in a state whose regulator prescribes the tax invoice format. The exception is theirs alone.',
   'Ruben Oyelaran', '2026-07-30')
on conflict (id) do update set template_id = excluded.template_id, why = excluded.why;

/* ================================================================= RLS === */

alter table invoice_sections              enable row level security;
alter table invoice_templates             enable row level security;
alter table invoice_template_sections     enable row level security;
alter table invoice_template_assignments  enable row level security;

do $$
declare t text;
begin
  foreach t in array array['invoice_sections', 'invoice_templates',
                           'invoice_template_sections', 'invoice_template_assignments'] loop
    execute format('drop policy if exists "operator_all_%1$s" on %1$I', t);
    execute format('drop policy if exists "read_%1$s" on %1$I', t);
    execute format($f$create policy "operator_all_%1$s" on %1$I for all to authenticated
                        using (current_persona() = 'operator')
                        with check (current_persona() = 'operator')$f$, t);
    /* Everybody reads. A counterparty is entitled to know what shape the
       document they are sent takes, and the seller console shows it. */
    execute format($f$create policy "read_%1$s" on %1$I for select to anon, authenticated
                        using (true)$f$, t);
  end loop;
end $$;

/* ------------------------------------ what a template may not be made into -- */

/**
 * The four that cannot come off, and the templates that cannot go.
 *
 * RLS cannot express either. The first compares the row being deleted against
 * a property of the section it names; the second compares a template against
 * whether anything still points at it. Both are the difference between a
 * configuration screen and a way to issue a document nobody can pay.
 */
create or replace function guard_invoice_template() returns trigger
language plpgsql security definer set search_path = public as $$
declare locked boolean; n integer; who text;
begin
  if current_persona() is null then
    return case tg_op when 'DELETE' then old else new end;
  end if;

  if tg_table_name = 'invoice_template_sections' and tg_op = 'DELETE' then
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

  /* An assignment has to name a template that serves that audience. */
  if tg_table_name = 'invoice_template_assignments' and tg_op in ('INSERT', 'UPDATE') then
    select count(*) into n from invoice_templates
     where id = new.template_id and audience in (new.audience, 'any');
    if n = 0 then
      raise exception 'That template is not written for a % counterparty.', new.audience;
    end if;
  end if;

  return new;
end $$;

drop trigger if exists invoice_template_sections_guard on invoice_template_sections;
create trigger invoice_template_sections_guard before delete on invoice_template_sections
  for each row execute function guard_invoice_template();

drop trigger if exists invoice_templates_guard on invoice_templates;
create trigger invoice_templates_guard before delete on invoice_templates
  for each row execute function guard_invoice_template();

drop trigger if exists invoice_template_assignments_guard on invoice_template_assignments;
create trigger invoice_template_assignments_guard before insert or update on invoice_template_assignments
  for each row execute function guard_invoice_template();

/* ------------------------------------------------------- sanity checks -- */
do $$
declare n integer; s text;
begin
  /* Every template carries all four locked sections. */
  select string_agg(t.name || ' (' || sec.id || ')', ', ') into s
    from invoice_templates t
    join invoice_sections sec on sec.locked
   where not exists (select 1 from invoice_template_sections ts
                      where ts.template_id = t.id and ts.section_id = sec.id);
  if s is not null then raise exception 'these templates are missing a required section: %', s; end if;

  /* And nothing carries a section written for another audience — a payment
     slip on a self-billing invoice is backwards, not a preference. */
  select string_agg(t.name || ' (' || ts.section_id || ')', ', ') into s
    from invoice_template_sections ts
    join invoice_templates t on t.id = ts.template_id
    join invoice_sections sec on sec.id = ts.section_id
   where t.audience <> 'any' and not (t.audience = any (sec.audiences));
  if s is not null then raise exception 'these templates carry a section their audience cannot use: %', s; end if;

  /* Every audience has a default, or somebody gets no document at all. */
  select string_agg(a, ', ') into s from unnest(array['consumer','enterprise','partner']) a
   where not exists (select 1 from invoice_template_assignments x
                      where x.audience = a and x.party_id is null);
  if s is not null then raise exception 'these audiences have no default template: %', s; end if;

  /* Every assignment points at a template that serves it. */
  select count(*) into n from invoice_template_assignments x
    join invoice_templates t on t.id = x.template_id
   where t.audience not in (x.audience, 'any');
  if n > 0 then raise exception '% assignments name a template written for somebody else', n; end if;

  /* A numbering pattern without a sequence produces the same reference on
     every document, which is the one thing a reference may not do. */
  select count(*) into n from invoice_templates where numbering not like '%{SEQ}%';
  if n > 0 then raise exception '% templates have a numbering pattern with no sequence in it', n; end if;

  /* The seller template does not offer a payment slip or a reward summary, and
     the enterprise one does not carry an advert. Asserted rather than assumed,
     because those three are the whole reason this is configuration. */
  if exists (select 1 from invoice_template_sections
              where template_id = 'BT-PTR' and section_id in ('slip', 'paylink')) then
    raise exception 'the self-billing template asks the seller to pay us';
  end if;
  if exists (select 1 from invoice_template_sections
              where template_id = 'BT-ENT' and section_id = 'advert') then
    raise exception 'the enterprise template carries an advertisement on a tax document';
  end if;
end $$;
