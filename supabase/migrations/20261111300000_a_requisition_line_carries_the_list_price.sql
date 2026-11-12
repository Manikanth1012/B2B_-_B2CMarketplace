/* A requisition line could carry any price at all.
 *
 * `raiseRequisition` writes each line with the `unit_price` the browser sent.
 * The browser took it from the shelf (`loadEnterpriseCatalogue`, which reads
 * `product_prices` for the requisition's currency), so on the screen it was
 * always the price book's figure. Nothing behind the screen said so. A buyer
 * with the API key and their own session could put forty handsets on a
 * requisition at ₹1 each, an approver would sign off ₹40, and the order would
 * go to the seller at that.
 *
 * Quoted lines and bundle parts were already held to their price, by
 * `guard_quoted_line` and `guard_bundle_requisition_line`. The ordinary line —
 * the one most requisitions are made of — was the only one held to nothing.
 *
 * So, from now on, an ordinary line (no `quote_line_id`, no
 * `bundle_selection_id`) written by a business buyer carries the price the
 * price book shows for its product in the requisition's currency, at the
 * moment it is written:
 *
 *   the book     `product_prices.price` for (product, requisition currency),
 *                to the cent. There is no other price for a business buyer:
 *                nothing is negotiated on this marketplace (src/lib/contracts.ts,
 *                CR-008), an agreement buys nothing and discounts nothing, and
 *                a "was" price is the struck-through figure, not one anybody
 *                pays.
 *   the base     where the book has no row for that currency, the product's
 *                own `products.price`, if the product is denominated in the
 *                requisition's currency. That is the shelf's own fallback
 *                (`loadEnterpriseCatalogue`: "the book's figure, or the base
 *                row"), so a line the shelf offered is a line this accepts.
 *   no listing   a line naming no product has no price to be held to, and
 *                would be the way round this check, so it is refused.
 *
 * A basket is built minutes before it is raised and is not kept across a
 * reload (RequisitionContext). If a seller changes the price in between, the
 * line is refused with a sentence that says the price changed and what to do
 * on the requisition panel: remove the line (its × button) and add it again
 * from the catalogue, which reads the current price. `raiseRequisition` then
 * removes the header it wrote, so nothing is left half-raised, and the basket
 * is kept for the buyer to correct.
 *
 * Two edges, accepted for now. A product the seller has withdrawn from its
 * home currency still passes on its base row in that currency, where the
 * shelf hides it (the shelf labels the base row USD); every seeded product's
 * base is USD, so the two agree today. And a bundle part whose selection is
 * deleted (the foreign key sets `bundle_selection_id` null) becomes an
 * ordinary line at the bundle's price; it is not re-checked, because watching
 * that column would refuse the cascade — the count at the end includes it.
 *
 * Who it applies to is the house rule (`guard_requisition_line`): the business
 * buyer. A null persona is a migration or the service role; the operator has
 * its own reasons to correct a line. On an update it only looks again when the
 * price, the product or the requisition changed, so changing a quantity on a
 * line raised before this file — or before a price moved — is not refused.
 * Lines already on file are not rewritten; the check at the end only counts
 * the pending ones that are not at the book's price, and says how many.
 *
 * Re-runnable: the function is replaced and the trigger dropped and made again.
 * Named to fire after `enterprise_requisition_lines_guard` (triggers of one
 * timing fire in name order), so a line on a decided requisition is still
 * refused for that, first.
 */

/* ======================================================= the price guard === */

create or replace function guard_requisition_line_price() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_req  record;
  v_book numeric;
  v_name text;
begin
  /* Null persona is a migration or the service role; the operator corrects
     lines for its own reasons. Neither is a buyer. */
  if current_persona() is distinct from 'enterprise' then
    return new;
  end if;

  /* Quoted and bundled lines are held to their own price by their own guards. */
  if new.quote_line_id is not null or new.bundle_selection_id is not null then
    return new;
  end if;

  /* Only what this guard vouches for. A trigger "of" columns still fires when
     a column is set to what it already was. */
  if tg_op = 'UPDATE'
     and new.unit_price is not distinct from old.unit_price
     and new.product_id is not distinct from old.product_id
     and new.requisition_id is not distinct from old.requisition_id then
    return new;
  end if;

  select r.id, r.currency into v_req from enterprise_requisitions r where r.id = new.requisition_id;
  if v_req.id is null then
    /* `guard_requisition_line` says this one, in its own words. */
    return new;
  end if;

  v_name := coalesce(nullif(btrim(new.name), ''), new.product_id, 'That line');

  if new.product_id is null then
    raise exception '% names no listing, so there is no price to hold it to. Add it from the catalogue and raise the requisition again.',
      v_name;
  end if;

  select round(pp.price, 2) into v_book
    from product_prices pp
   where pp.product_id = new.product_id and pp.currency = v_req.currency;

  if v_book is null then
    /* The shelf's own fallback: the base row, when it is in this money. */
    select round(p.price, 2) into v_book
      from products p
     where p.id = new.product_id and p.currency = v_req.currency;
  end if;

  if v_book is null then
    raise exception '% has no price in %, so it cannot go on a requisition in %. Remove it from the requisition to raise the rest.',
      v_name, v_req.currency, v_req.currency;
  end if;

  if round(new.unit_price, 2) is distinct from v_book then
    raise exception 'The price of % has changed: it is now % %, and this requisition has it at %. Remove it from the requisition and add it again from the catalogue to take the current price.',
      v_name, v_req.currency, v_book, round(new.unit_price, 2);
  end if;

  return new;
end $$;

drop trigger if exists enterprise_requisition_lines_price_guard on enterprise_requisition_lines;
create trigger enterprise_requisition_lines_price_guard
  before insert or update of unit_price, product_id, requisition_id on enterprise_requisition_lines
  for each row execute function guard_requisition_line_price();

/* --------------------------------------------------------- what is true -- */

do $$
declare
  v_n    integer;
  v_type integer;
  v_cols text;
  v_ok   boolean;
begin
  /* Attached once, before the row is written, on insert and on update of the
     three columns it judges, and never on delete. Asked of `pg_trigger`
     because a trigger on the wrong event would still have created cleanly.
     tgtype bits: 1 row, 2 before, 4 insert, 8 delete, 16 update. */
  select count(*) into v_n from pg_trigger
   where tgrelid = 'enterprise_requisition_lines'::regclass
     and tgname = 'enterprise_requisition_lines_price_guard' and not tgisinternal;
  if v_n <> 1 then
    raise exception 'the price guard is not attached to enterprise_requisition_lines (found %)', v_n;
  end if;

  select tgtype::integer, tgattr::text into v_type, v_cols from pg_trigger
   where tgrelid = 'enterprise_requisition_lines'::regclass
     and tgname = 'enterprise_requisition_lines_price_guard';
  if (v_type & 23) <> 23 or (v_type & 8) <> 0 then
    raise exception 'the price guard fires on the wrong events (tgtype %)', v_type;
  end if;
  if array_length(string_to_array(btrim(v_cols), ' '), 1) is distinct from 3 then
    raise exception 'the price guard watches the wrong columns (%)', v_cols;
  end if;

  /* The function says what it exists to say, and stays out of the lines it
     does not price. */
  select prosrc like '%has changed%add it again from the catalogue%'
         and prosrc like '%quote_line_id is not null or new.bundle_selection_id is not null%'
         and prosecdef
    into v_ok
    from pg_proc where proname = 'guard_requisition_line_price';
  if v_ok is not true then
    raise exception 'guard_requisition_line_price is not the function this file wrote';
  end if;

  /* And every guard already on the table is still there beside it. */
  select count(*) into v_n from pg_trigger
   where tgrelid = 'enterprise_requisition_lines'::regclass and not tgisinternal
     and tgname in ('enterprise_requisition_lines_guard', 'enterprise_requisition_lines_quoted_guard',
                    'enterprise_requisition_lines_bundle_guard', 'enterprise_requisition_lines_bundle_follow',
                    'enterprise_requisition_lines_bundle_whole');
  if v_n <> 5 then
    raise exception 'an existing requisition line guard went missing (found % of 5)', v_n;
  end if;

  /* Read only. Lines already on pending requisitions that this guard would
     refuse if they were written today. They are not changed: a buyer who
     changes a quantity is not refused, one who changes a price is. Said as a
     notice, because a seller moving a price after a requisition was raised is
     not a fault in the data. */
  select count(*) into v_n
    from enterprise_requisition_lines l
    join enterprise_requisitions r on r.id = l.requisition_id
    left join product_prices pp on pp.product_id = l.product_id and pp.currency = r.currency
    left join products p on p.id = l.product_id and p.currency = r.currency
   where r.state = 'pending'
     and l.quote_line_id is null and l.bundle_selection_id is null
     and (l.product_id is null
          or round(l.unit_price, 2) is distinct from coalesce(round(pp.price, 2), round(p.price, 2)));
  raise notice '% ordinary lines on pending requisitions are not at the price book''s price; they stand as written, and would be refused only if a buyer changed their price, product or requisition.',
    v_n;
end $$;
