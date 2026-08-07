/* A tax invoice nobody had registered with anybody.
 *
 * The marketplace issues invoices in three jurisdictions and computes tax
 * correctly in all three — rates per market, reverse charge, exemption
 * certificates, the lot. What it does not do is the part that makes a tax
 * invoice a tax invoice in any of them: register it with the revenue authority
 * and print what the authority gave back.
 *
 * India. Since October 2020 a B2B invoice from a business over the turnover
 * threshold is not valid unless it has been registered on the Invoice
 * Registration Portal BEFORE it is issued. The IRP returns an IRN — a
 * sixty-four character hash — an acknowledgement number and date, and a signed
 * QR code. An invoice without them is not a tax invoice: the customer cannot
 * claim input credit against it and the supplier is penalised per document.
 * It can be cancelled on the portal for twenty-four hours and not one minute
 * longer; after that it takes a credit note.
 *
 * Kenya. eTIMS, under the Electronic Tax Invoice Regulations. Every invoice
 * passes through a control unit which stamps it with a control unit invoice
 * number, its own serial, and a QR linking to KRA's verification page. Unlike
 * India this happens at issue rather than before it, and there is no
 * cancellation — a mistake is corrected with a credit note that is itself
 * stamped.
 *
 * United Arab Emirates. The Peppol-based five-corner model, phased in from
 * July 2026 for the largest taxpayers. The invoice goes to an accredited
 * service provider, which delivers it to the buyer's provider and reports it to
 * the Federal Tax Authority. Nothing is returned to print on the face of the
 * document; what exists is a transmission reference and a delivery
 * acknowledgement, which is a different shape of the same obligation.
 *
 * WHY THE THREE ARE ONE MODEL.
 *
 * They differ on when clearance happens relative to issue, on what comes back,
 * and on whether the document can be cancelled. So those are the three things
 * the regime row carries, and everything else falls out of them. Saudi's ZATCA
 * — cryptographic stamp, UUID, cleared XML — is a fourth instance of the same
 * shape, which is the test of whether the shape is right.
 */

/* ---- 1. What each jurisdiction requires --------------------------------------- */

create table if not exists public.tax_regime (
  market        text primary key references public.markets(code),
  authority     text not null,
  scheme        text not null,

  /* The distinction that matters most, because it decides whether a document
     can be shown to a customer before the authority has seen it. */
  clearance     text not null check (clearance in ('before-issue', 'at-issue', 'after-issue', 'none')),

  /* Which documents are in scope. B2C and B2B are not the same obligation
     anywhere — India requires an IRN on B2B and only a dynamic QR on B2C. */
  covers_b2b    boolean not null default true,
  covers_b2c    boolean not null default false,

  /* What comes back and goes on the face of the document. Named, because
     "reference" is three different things in three countries and a column
     called that would be filled with whichever one somebody was thinking of. */
  returns_irn   boolean not null default false,
  returns_qr    boolean not null default false,
  returns_control_unit boolean not null default false,

  /* Nil means no cancellation at all — Kenya corrects with a credit note. */
  cancel_hours  integer not null default 0 check (cancel_hours >= 0),

  effective_from date not null,
  note          text,
  sort_order    integer not null default 0
);

comment on table public.tax_regime is
  'Statutory e-invoicing per market. `clearance` is the load-bearing column: '
  'before-issue means the document cannot be shown to a customer until the '
  'authority has registered it.';

insert into public.tax_regime
  (market, authority, scheme, clearance, covers_b2b, covers_b2c,
   returns_irn, returns_qr, returns_control_unit, cancel_hours, effective_from, note, sort_order) values

  ('IN', 'Goods and Services Tax Network — Invoice Registration Portal', 'GST e-invoice (IRP)',
   'before-issue', true, false, true, true, false, 24, date '2020-10-01',
   'A B2B invoice is registered before it is issued and comes back with an IRN, an acknowledgement and a signed QR. Without them the customer cannot claim input credit. Cancellable on the portal for 24 hours; after that it takes a credit note. B2C is out of scope for the IRN and needs a dynamic QR only.', 1),

  ('KE', 'Kenya Revenue Authority', 'eTIMS',
   'at-issue', true, true, false, true, true, 0, date '2023-09-01',
   'Every invoice passes through a control unit as it is issued and is stamped with a control unit invoice number, the unit''s serial and a QR linking to KRA verification. Both B2B and B2C. No cancellation — a mistake is corrected with a credit note, itself stamped.', 2),

  ('AE', 'Federal Tax Authority', 'Peppol five-corner e-invoicing',
   'after-issue', true, false, false, false, false, 0, date '2026-07-01',
   'The invoice is delivered to the buyer through accredited service providers and reported to the FTA. Nothing comes back to print on the face of the document; what exists is a transmission reference and a delivery acknowledgement.', 3)
on conflict (market) do nothing;

/* ---- 2. What the authority gave back ------------------------------------------ */

create table if not exists public.einvoice_clearance (
  id            text primary key,

  /* One row per document, and a document is a consumer bill or an enterprise
     invoice. Kept as a kind and an id rather than two nullable foreign keys —
     the same obligation lands on both and a schema that forks here forks
     everything downstream of it. */
  doc_kind      text not null check (doc_kind in ('consumer_bill', 'enterprise_invoice', 'credit_note')),
  doc_id        text not null,
  market        text not null references public.tax_regime(market),
  audience      text not null check (audience in ('b2b', 'b2c')),

  status        text not null default 'pending'
                check (status in ('pending', 'cleared', 'failed', 'cancelled', 'not-required')),

  /* India. The IRN is a 64-character hash of supplier GSTIN, document number
     and financial year; the QR is signed by the IRP and is what a field
     officer scans. */
  irn           text,
  ack_no        text,
  ack_date      timestamptz,
  signed_qr     text,

  /* Kenya. The control unit stamps the document as it is issued. */
  cu_invoice_no text,
  cu_serial     text,
  verify_url    text,

  /* The Emirates, and anywhere else that reports rather than clears. */
  transmission_ref text,
  delivered_at  timestamptz,

  submitted_at  timestamptz,
  cleared_at    timestamptz,
  /* A refusal is a fact about the document, not a log line. An invoice the
     portal rejected is an invoice that cannot be issued, and the reason is what
     somebody has to act on. */
  failure_code  text,
  failure_reason text,
  cancelled_at  timestamptz,
  cancel_reason text,

  attempts      integer not null default 1 check (attempts > 0),

  constraint einvoice_one_per_document unique (doc_kind, doc_id),
  /* A cleared Indian document has the three things the IRP returns; a cleared
     Kenyan one has what the control unit stamped. Enforced rather than left to
     whoever writes the next integration. */
  constraint einvoice_cleared_carries_its_evidence check (
    status <> 'cleared' or cleared_at is not null),
  constraint einvoice_failed_says_why check (
    status <> 'failed' or coalesce(length(trim(failure_reason)), 0) >= 4),
  constraint einvoice_cancelled_says_why check (
    status <> 'cancelled' or (cancelled_at is not null and coalesce(length(trim(cancel_reason)), 0) >= 4))
);

create index if not exists einvoice_clearance_doc on public.einvoice_clearance (doc_kind, doc_id);
create index if not exists einvoice_clearance_status on public.einvoice_clearance (status) where status <> 'cleared';

comment on table public.einvoice_clearance is
  'What the revenue authority returned for one document. A document in a '
  'before-issue regime with no cleared row here is not a tax invoice.';

/* Everything a cleared document must carry, per regime. Written as a trigger
   rather than a check constraint because it depends on the regime row. */
create or replace function public.guard_einvoice_clearance()
returns trigger language plpgsql as $$
declare r public.tax_regime;
begin
  select * into r from public.tax_regime where market = new.market;

  if new.status = 'cleared' then
    if r.returns_irn and (new.irn is null or new.ack_no is null or new.ack_date is null) then
      raise exception
        'A document cleared through % has an IRN, an acknowledgement number and an acknowledgement date. Without them the customer cannot claim input credit against it.',
        r.scheme;
    end if;
    if r.returns_irn and new.irn is not null and length(new.irn) <> 64 then
      raise exception 'An IRN is a 64-character hash. "%" is % characters.', new.irn, length(new.irn);
    end if;
    if r.returns_control_unit and (new.cu_invoice_no is null or new.cu_serial is null) then
      raise exception
        'A document cleared through % carries the control unit invoice number and the unit''s serial.',
        r.scheme;
    end if;
    if r.returns_qr and new.signed_qr is null and new.verify_url is null then
      raise exception
        '% returns something for the customer to scan, and this document has neither a signed QR nor a verification URL.',
        r.scheme;
    end if;
    if r.clearance = 'after-issue' and new.transmission_ref is null then
      raise exception
        '% reports rather than clears, so what proves it happened is the transmission reference.', r.scheme;
    end if;
  end if;

  /* Cancellation is a window, not a permission. India allows twenty-four
     hours; Kenya allows none and corrects with a credit note. */
  if new.status = 'cancelled' and old.status = 'cleared' then
    if r.cancel_hours = 0 then
      raise exception
        '% does not allow a cleared document to be cancelled. Issue a credit note against it instead.', r.scheme;
    end if;
    if new.cancelled_at > old.cleared_at + (r.cancel_hours || ' hours')::interval then
      raise exception
        'The cancellation window on % is % hours and this document was cleared at %. After that it takes a credit note.',
        r.scheme, r.cancel_hours, old.cleared_at;
    end if;
  end if;

  return new;
end $$;

drop trigger if exists z_guard_einvoice_clearance on public.einvoice_clearance;
create trigger z_guard_einvoice_clearance
  before insert or update on public.einvoice_clearance
  for each row execute function public.guard_einvoice_clearance();

/* ---- 3. Clearing a document --------------------------------------------------- */

/* Deterministic stand-ins for what each authority returns. Real in shape and in
   length — an IRN is sixty-four hex characters and a screen that renders a
   short one will look right and break against the real portal — and derived
   from the document so a re-run produces the same values rather than a second
   set of them. */
create or replace function public.clear_einvoice(
  p_kind text, p_doc text, p_market text, p_audience text default 'b2b',
  p_when timestamptz default now()
) returns jsonb
language plpgsql security definer set search_path to 'public', 'extensions' as $$
declare
  r public.tax_regime;
  existing public.einvoice_clearance;
  row_id text;
begin
  select * into r from public.tax_regime where market = p_market;
  if r.market is null then
    return jsonb_build_object('ok', false,
      'why', format('No e-invoicing regime is configured for %s. That is not the same as nothing being required — it is a question nobody has answered.', p_market));
  end if;

  /* Out of scope is a real answer and it is recorded, not skipped. An Indian
     B2C bill needs a dynamic QR and no IRN, and a row saying so is what stops
     somebody later reporting it as an unclearead document. */
  if (p_audience = 'b2b' and not r.covers_b2b) or (p_audience = 'b2c' and not r.covers_b2c) then
    insert into public.einvoice_clearance (id, doc_kind, doc_id, market, audience, status, submitted_at)
    values (format('EI-%s', p_doc), p_kind, p_doc, p_market, p_audience, 'not-required', p_when)
    on conflict (doc_kind, doc_id) do nothing;
    return jsonb_build_object('ok', true, 'status', 'not-required',
      'why', format('%s does not cover %s documents.', r.scheme, upper(p_audience)));
  end if;

  select * into existing from public.einvoice_clearance
   where doc_kind = p_kind and doc_id = p_doc;
  if existing.status = 'cleared' then
    return jsonb_build_object('ok', true, 'status', 'cleared', 'already', true,
      'irn', existing.irn, 'cu_invoice_no', existing.cu_invoice_no);
  end if;

  row_id := format('EI-%s', p_doc);

  insert into public.einvoice_clearance
    (id, doc_kind, doc_id, market, audience, status,
     irn, ack_no, ack_date, signed_qr,
     cu_invoice_no, cu_serial, verify_url,
     transmission_ref, delivered_at,
     submitted_at, cleared_at)
  values (
    row_id, p_kind, p_doc, p_market, p_audience, 'cleared',
    case when r.returns_irn then encode(digest(p_doc || p_market || 'IRP', 'sha256'), 'hex') end,
    case when r.returns_irn then '1' || lpad((abs(hashtext(p_doc)) % 1000000000000000)::text, 15, '0') end,
    case when r.returns_irn then p_when end,
    case when r.returns_irn then 'eyJhbGciOiJSUzI1NiJ9.' || encode(digest(p_doc || 'QR', 'sha256'), 'base64') end,
    case when r.returns_control_unit then '0' || lpad((abs(hashtext(p_doc || 'CU')) % 100000000)::text, 9, '0') end,
    case when r.returns_control_unit then 'KRACU' || lpad((abs(hashtext(p_market)) % 10000000)::text, 7, '0') end,
    case when r.returns_control_unit
         then 'https://itax.kra.go.ke/KRA-Portal/invoiceChk.htm?actionCode=loadPage&invoiceNo='
              || '0' || lpad((abs(hashtext(p_doc || 'CU')) % 100000000)::text, 9, '0') end,
    case when r.clearance = 'after-issue'
         then 'PEPPOL-' || upper(substr(encode(digest(p_doc || 'AE', 'sha256'), 'hex'), 1, 16)) end,
    case when r.clearance = 'after-issue' then p_when end,
    p_when, p_when)
  on conflict (doc_kind, doc_id) do update set
    status = 'cleared', cleared_at = excluded.cleared_at,
    irn = excluded.irn, ack_no = excluded.ack_no, ack_date = excluded.ack_date,
    signed_qr = excluded.signed_qr,
    cu_invoice_no = excluded.cu_invoice_no, cu_serial = excluded.cu_serial,
    verify_url = excluded.verify_url,
    transmission_ref = excluded.transmission_ref, delivered_at = excluded.delivered_at,
    failure_code = null, failure_reason = null,
    attempts = public.einvoice_clearance.attempts + 1;

  select * into existing from public.einvoice_clearance where id = row_id;
  return jsonb_build_object('ok', true, 'status', 'cleared', 'scheme', r.scheme,
    'irn', existing.irn, 'ack_no', existing.ack_no,
    'cu_invoice_no', existing.cu_invoice_no, 'transmission_ref', existing.transmission_ref);
end $$;

grant execute on function public.clear_einvoice(text,text,text,text,timestamptz) to authenticated;

/* ---- 4. Clearing what has already been issued -------------------------------- */

do $$
declare d record;
begin
  /* Every enterprise invoice: B2B everywhere, so in scope in all three. */
  for d in select id, market, issued from public.enterprise_invoices where market is not null loop
    perform public.clear_einvoice('enterprise_invoice', d.id, d.market, 'b2b',
                                  (d.issued::timestamptz + interval '9 hours'));
  end loop;

  /* Every consumer bill: B2C, which India does not cover and Kenya does. The
     rows India does not cover are written as `not-required` rather than left
     absent, so a report of uncleared documents does not list them for ever. */
  for d in select id, market, issued from public.consumer_bills where market is not null loop
    perform public.clear_einvoice('consumer_bill', d.id, d.market, 'b2c',
                                  (to_date(d.issued, 'DD Mon YYYY')::timestamptz + interval '9 hours'));
  end loop;
end $$;

/* One that failed, because a portal that never refuses anything is a portal
   nobody has built error handling for. This is the real commonest rejection:
   the buyer's registration number is not active on the date of supply. */
update public.einvoice_clearance set
  status = 'failed',
  failure_code = '2172',
  failure_reason = 'The buyer GSTIN is not active for the date of supply. Confirm the registration with the customer and resubmit; the invoice cannot be issued until it clears.',
  cleared_at = null, irn = null, ack_no = null, ack_date = null, signed_qr = null,
  attempts = 2
 where doc_id = 'INV-2026-0781';

/* ---- 5. RLS ------------------------------------------------------------------- */

alter table public.tax_regime enable row level security;
alter table public.einvoice_clearance enable row level security;

drop policy if exists everyone_reads_tax_regime on public.tax_regime;
create policy everyone_reads_tax_regime on public.tax_regime for select using (true);
drop policy if exists operator_all_tax_regime on public.tax_regime;
create policy operator_all_tax_regime on public.tax_regime
  for all using (current_persona() = 'operator') with check (current_persona() = 'operator');

drop policy if exists operator_all_einvoice on public.einvoice_clearance;
create policy operator_all_einvoice on public.einvoice_clearance
  for all using (current_persona() = 'operator') with check (current_persona() = 'operator');

/* A customer reads the clearance on their own document, because the IRN and the
   QR are printed on the invoice they were given and they are entitled to check
   them. */
drop policy if exists own_einvoice on public.einvoice_clearance;
create policy own_einvoice on public.einvoice_clearance for select using (
  (doc_kind = 'consumer_bill' and exists (
     select 1 from public.consumer_bills b where b.id = doc_id and b.user_id = auth.uid()))
  or
  (doc_kind = 'enterprise_invoice' and exists (
     select 1 from public.enterprise_invoices i
      where i.id = doc_id and i.account_id = current_account_id()))
);

grant select on public.tax_regime to authenticated, anon;
grant insert, update on public.tax_regime to authenticated;
grant select, insert, update on public.einvoice_clearance to authenticated;

/* ---- 6. Assertions ------------------------------------------------------------ */

do $$
declare n int; bad text; ev public.einvoice_clearance; r jsonb;
begin
  /* Every market this issues invoices in has a stated regime. */
  select string_agg(code, ', ') into bad from public.markets m
   where not exists (select 1 from public.tax_regime t where t.market = m.code);
  if bad is not null then raise exception 'markets issuing invoices with no e-invoicing position: %', bad; end if;

  /* Every issued document has a clearance record — cleared, failed, or
     explicitly out of scope. An absent row is the state this migration exists
     to remove. */
  select count(*) into n from public.enterprise_invoices i
   where i.market is not null
     and not exists (select 1 from public.einvoice_clearance x
                      where x.doc_kind = 'enterprise_invoice' and x.doc_id = i.id);
  if n > 0 then raise exception '% enterprise invoices have no clearance record', n; end if;

  select count(*) into n from public.consumer_bills b
   where b.market is not null
     and not exists (select 1 from public.einvoice_clearance x
                      where x.doc_kind = 'consumer_bill' and x.doc_id = b.id);
  if n > 0 then raise exception '% consumer bills have no clearance record', n; end if;

  /* An Indian B2B invoice carries a real IRN. */
  select * into ev from public.einvoice_clearance
   where market = 'IN' and audience = 'b2b' and status = 'cleared' limit 1;
  if ev.irn is null then raise exception 'an Indian B2B invoice cleared with no IRN'; end if;
  if length(ev.irn) <> 64 then raise exception 'the IRN is % characters', length(ev.irn); end if;
  if ev.ack_no is null or ev.signed_qr is null then
    raise exception 'the IRP returned an IRN and nothing else';
  end if;

  /* A Kenyan one carries the control unit stamp instead. */
  select * into ev from public.einvoice_clearance
   where market = 'KE' and status = 'cleared' limit 1;
  if ev.cu_invoice_no is null or ev.cu_serial is null then
    raise exception 'a Kenyan document cleared with no control unit number';
  end if;
  if ev.irn is not null then raise exception 'a Kenyan document was given an Indian IRN'; end if;

  /* And an Emirati one carries a transmission reference and nothing to print. */
  select * into ev from public.einvoice_clearance
   where market = 'AE' and status = 'cleared' limit 1;
  if ev.transmission_ref is null then
    raise exception 'an Emirati invoice was reported with no transmission reference';
  end if;

  /* India does not cover B2C, and the bills that fall outside say so rather
     than being absent. */
  select count(*) into n from public.einvoice_clearance
   where market = 'IN' and audience = 'b2c' and status <> 'not-required';
  if n > 0 then raise exception '% Indian consumer bills claim to need an IRN', n; end if;
  select count(*) into n from public.einvoice_clearance
   where market = 'KE' and audience = 'b2c' and status = 'cleared';
  if n = 0 then raise exception 'no Kenyan consumer bill was cleared, and eTIMS covers B2C'; end if;

  /* The guard refuses a cleared document with no evidence. */
  begin
    insert into public.einvoice_clearance (id, doc_kind, doc_id, market, audience, status, cleared_at)
    values ('EI-PROBE', 'enterprise_invoice', 'PROBE-1', 'IN', 'b2b', 'cleared', now());
    raise exception 'an Indian invoice cleared with no IRN at all';
  exception when others then
    if sqlerrm not like '%has an IRN%' then
      raise exception 'the empty-clearance insert failed on % rather than the guard', sqlerrm;
    end if;
  end;

  /* And refuses a Kenyan cancellation, because eTIMS has no cancellation. */
  begin
    update public.einvoice_clearance
       set status = 'cancelled', cancelled_at = now(), cancel_reason = 'wrong customer'
     where market = 'KE' and status = 'cleared'
       and id = (select id from public.einvoice_clearance where market = 'KE' and status = 'cleared' limit 1);
    raise exception 'a Kenyan document was cancelled';
  exception when others then
    if sqlerrm not like '%does not allow a cleared document to be cancelled%' then
      raise exception 'the Kenyan cancellation failed on % rather than the guard', sqlerrm;
    end if;
  end;

  select count(*) into n from public.einvoice_clearance where doc_id = 'PROBE-1';
  if n > 0 then raise exception 'the probe was left behind'; end if;

  raise notice 'cleared: %; not required: %; failed: %',
    (select count(*) from public.einvoice_clearance where status = 'cleared'),
    (select count(*) from public.einvoice_clearance where status = 'not-required'),
    (select count(*) from public.einvoice_clearance where status = 'failed');
end $$;
