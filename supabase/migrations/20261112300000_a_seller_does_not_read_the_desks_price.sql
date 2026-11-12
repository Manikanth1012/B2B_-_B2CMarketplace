/*
 * A seller no longer reads the price the desk quoted on its lines.
 *
 * On a quote across several sellers, the marketplace desk answers the buyer.
 * Since 20261105100000 each seller on it could read its own line rows of that
 * quote straight from `enquiry_lines` (policy `partner_read_enquiry_lines`),
 * every column, so once the desk sent the quote the seller could read
 * `quoted_unit_price`: the price the desk charged the buyer, and so the desk's
 * margin over what the seller asked for.
 *
 * Since 20261112200000 the seller reads those lines through
 * `my_desk_quote_lines()`, which gives it what it needs to price them (the
 * quote's status, subject, currency, its own proposal and floor) and not the
 * desk's price. The seller screen reads nothing else for them. So the direct
 * read is narrowed: a seller reads line rows only of enquiries routed to it,
 * which it answers itself. Nothing else changes: the buyer, the desk and a
 * seller's own enquiries read exactly what they read before, and the seller's
 * proposals (`enquiry_line_proposals`) are untouched.
 *
 * Needs 20261112200000 (it refuses to run without `my_desk_quote_lines`, or the
 * seller would lose sight of its desk lines altogether). Idempotent, one
 * transaction, ends with a self-check.
 */

begin;

do $$
begin
  if to_regclass('public.enquiry_lines') is null then
    raise exception 'enquiry_lines is missing: apply 20261105100000 first';
  end if;
  if to_regprocedure('public.my_desk_quote_lines()') is null then
    raise exception 'my_desk_quote_lines() is missing: apply 20261112200000 first, or the seller would lose sight of its lines on desk quotes';
  end if;
  if to_regprocedure('public.enquiry_routed_to_me(text)') is null then
    raise exception 'enquiry_routed_to_me(text) is missing: apply 20261105100000 first';
  end if;
end $$;

drop policy if exists "partner_read_enquiry_lines" on enquiry_lines;
create policy "partner_read_enquiry_lines" on enquiry_lines for select to authenticated
  using (current_persona() = 'partner' and enquiry_routed_to_me(enquiry_id));

/* ============================================================ self-check === */

do $$
declare
  v_qual text;
  n int;
begin
  select count(*), max(qual) into n, v_qual
    from pg_policies
   where schemaname = 'public' and tablename = 'enquiry_lines' and policyname = 'partner_read_enquiry_lines';
  if n <> 1 then raise exception 'expected one partner_read_enquiry_lines policy, found %', n; end if;
  if v_qual not like '%enquiry_routed_to_me%' then
    raise exception 'partner_read_enquiry_lines does not limit the seller to enquiries routed to it: %', v_qual;
  end if;
  if v_qual like '%enquiry_is_desk_quote%' then
    raise exception 'partner_read_enquiry_lines still lets a seller read its lines on a desk quote: %', v_qual;
  end if;

  /* No other policy lets a seller read lines. */
  select count(*) into n
    from pg_policies
   where schemaname = 'public' and tablename = 'enquiry_lines'
     and cmd in ('SELECT', 'ALL')
     and policyname <> 'partner_read_enquiry_lines'
     and coalesce(qual, '') like '%partner%';
  if n <> 0 then raise exception '% other policies on enquiry_lines mention the seller', n; end if;

  /* my_desk_quote_lines still does not hand the desk's price over. */
  select count(*) into n
    from pg_proc p join pg_namespace s on s.oid = p.pronamespace
   where s.nspname = 'public' and p.proname = 'my_desk_quote_lines'
     and pg_get_functiondef(p.oid) like '%quoted_unit_price%';
  if n <> 0 then raise exception 'my_desk_quote_lines returns the desk''s quoted price'; end if;
end $$;

commit;
