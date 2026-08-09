/* Help for both agreement screens.
 *
 * Two articles, because two personas read this and they need opposite things.
 * The operator needs to know what a renewal actually does and why terminating
 * one stops an account buying. The account needs to know what the agreement
 * settles, what it does not settle — prices — and what happens when it runs out.
 *
 * Ids computed rather than typed, for the fifth time and the same reason: a
 * hardcoded `KB-O24` once silently replaced the Refunds article.
 */

do $$
declare op_id text; en_id text;
begin
  select 'KB-O' || (coalesce(max(substring(id from 'KB-O(\d+)')::int), 0) + 1)
    into op_id from public.kb_articles where id ~ '^KB-O\d+$';
  /* The buyer's articles are numbered KB-B, not KB-E — a scheme worth reading
     off the table rather than guessing, which is how the first draft of this
     file tried to create KB-E1 next to twenty existing KB-B rows. Padded to two
     digits because that is what the existing ones do. */
  select 'KB-B' || lpad((coalesce(max(substring(id from 'KB-B(\d+)')::int), 0) + 1)::text, 2, '0')
    into en_id from public.kb_articles where id ~ '^KB-B\d+$';

  if exists (select 1 from public.kb_articles where id in (op_id, en_id)) then
    raise exception 'the next free ids are not free: %, %', op_id, en_id;
  end if;

  if not exists (select 1 from public.kb_articles where view = 'op-contracts') then
    insert into public.kb_articles
      (id, persona, personas, kind, title, mins, updated, view, roles, tags, summary, body, status, sort_order)
    values
      (op_id, 'operator', array['operator'], 'howto',
       'The agreement register', 6, current_date, 'op-contracts',
       array['OR-ADMIN', 'OR-FIN'], array['contracts', 'accounts', 'renewals'],
       'What an agreement settles here, why it is not a price list, and what renewing, amending and terminating one actually do.',
       jsonb_build_array(
         jsonb_build_array(
           'What an agreement settles, and what it does not',
           'The term, the payment terms, the currency, who signed on each side, and what happens when it runs out. Not the price. Every account is charged what is published for its market and the only discounts are the ones on the storefront — there is no rate card hanging off any of this, and a stated expected spend buys nothing. That is recorded as a boundary, not left as a gap: see the channel rules.'),
         jsonb_build_array(
           'No agreement in force means the account cannot buy',
           'A requisition raised or approved on an account with nothing in force is refused outright. That is different from a credit hold, which says the terms are agreed and the account is past its limit — finance can release one of those against a payment. No agreement means there is nothing to buy under at all, and no amount of money fixes it. Somebody has to sign.'),
         jsonb_build_array(
           'In force is worked out from the dates, not stored',
           'The state on the row says only what a person decided: drafted, active, terminated, superseded. Whether it binds today is two dates and the clock, so the register computes it every time you open it. That is why nothing has to be run overnight for an expiry to take effect, and why you will never find a row that says active next to a date last year.'),
         jsonb_build_array(
           'Expiring is the column that matters',
           'Expired is too late — that account already cannot buy and somebody is already annoyed. The window worth watching is the notice period, and it is per agreement because a ninety-day notice is a ninety-day warning. The register orders on it: expired first, then by how little time is left.'),
         jsonb_build_array(
           'Renewing supersedes in the same act',
           'One button, one transaction. The new term is created and the old one is superseded together, because doing it in two steps means a dropped connection leaves the account either with two agreements in force — two sets of payment terms and no way to say which was breached — or with none, which locks them out until somebody works out why. The new term has to start after the old one ends; the screen refuses an overlap and so does the database.'),
         jsonb_build_array(
           'Amending, and why both sides are required',
           'An amendment says what it changed from and what to, with a reason. One side alone cannot be read back by whoever has to explain it to the account that signed it, and a change with no reason is an edit somebody made. Amendments are kept in the order they took effect, which is not always the order they were signed. A payment-terms amendment also changes the agreement itself — record it and the terms follow.'),
         jsonb_build_array(
           'Terminating stops the account buying from that date',
           'Say why. Whoever takes the call needs it, and "terminated" with nothing recorded leaves them with nothing to say. Subscriptions already running continue to their own renewal dates and are still invoiced — ending the agreement stops new purchases, it does not cancel what is live.'),
         jsonb_build_array(
           'Stated spend against invoiced',
           'Each agreement carries what the account said it expected to spend. It is evidence for a credit review and nothing else. The register shows it beside what has actually been invoiced and how far through the term you are, because a percentage on its own is unreadable — two months in and two months from the end give the same figure and mean opposite things.'),
         jsonb_build_array(
           'The red banner',
           'It appears when the register disagrees with itself or with what it governs: an account trading with nothing behind it, two agreements live at once, billing terms that no longer match the agreement, a superseded row pointing at nothing. None of those should ever appear, so treat one as a defect rather than as work.')
       ),
       'published', 21);
    raise notice 'operator agreements article %', op_id;
  end if;

  if not exists (select 1 from public.kb_articles where view = 'en-agreement') then
    insert into public.kb_articles
      (id, persona, personas, kind, title, mins, updated, view, roles, tags, summary, body, status, sort_order)
    values
      (en_id, 'enterprise', array['enterprise'], 'howto',
       'Your agreement with Aventa', 4, current_date, 'en-agreement',
       array['BY-ADMIN', 'BY-FIN'], array['contracts', 'billing', 'renewals'],
       'What your master services agreement covers, what it deliberately does not, and what happens as it approaches its end date.',
       jsonb_build_array(
         jsonb_build_array(
           'What you are looking at',
           'The master services agreement your account buys under: the term, your payment terms, the currency you are invoiced in, who signed on each side, and every amendment since. The signed copy is the countersigned one and you can download it here at any time.'),
         jsonb_build_array(
           'It does not set prices',
           'You are charged the price published for your market on the day you order. No rate card forms part of this agreement, and any promotion running is available to you on the same terms as to any other buyer in your market. The expected spend on the agreement is your own planning figure — it is not a commitment to buy and it carries no price advantage.'),
         jsonb_build_array(
           'What happens at the end of the term',
           'Read the line at the top of the page, because the two cases fail in opposite directions. An agreement that does not auto-renew simply stops, and from that date nothing can be raised or approved on account. One that auto-renews rolls into another term unless somebody gives notice. Both go wrong the same way: by nobody acting.'),
         jsonb_build_array(
           'Notice',
           'The date shown is the last day either side can give notice and still be inside the term. It is not a countdown to a decision you can make later — after it, the renewal happens or the agreement ends regardless.'),
         jsonb_build_array(
           'If it lapses',
           'Purchases on account stop. Subscriptions already running continue to their own renewal dates and are still invoiced, so nothing switches off — but nothing new can be ordered until a replacement is signed. Your account manager is the person to speak to.'),
         jsonb_build_array(
           'Amendments',
           'Every change since signature is listed with what it said before, what it says now, when it took effect and why. They are ordered by when they took effect, which is not always the order they were signed. Each one has its own signed copy.'),
         jsonb_build_array(
           'Earlier agreements',
           'Kept rather than replaced. If you need to know what you were on in a previous year — which payment terms applied to an invoice from then, for instance — it is still here.')
       ),
       'published', 22);
    raise notice 'enterprise agreement article %', en_id;
  end if;
end $$;

/* ---- What has to be true ------------------------------------------------------- */

do $$
declare n int; bad text;
begin
  /* ASSERT-1: both are there, published and worth opening. */
  select count(*) into n from public.kb_articles
   where view in ('op-contracts', 'en-agreement')
     and status = 'published' and jsonb_array_length(body) >= 7;
  if n <> 2 then
    raise exception 'the agreement articles are missing, unpublished or too thin (% found)', n;
  end if;

  /* ASSERT-2: each is written for the persona that reads that screen. The
     operator's article on the buyer's screen would be worse than none. */
  select string_agg(id || ' (' || persona || ' on ' || view || ')', ', ') into bad
    from public.kb_articles
   where (view = 'op-contracts' and persona <> 'operator')
      or (view = 'en-agreement' and persona <> 'enterprise');
  if bad is not null then raise exception 'agreement help written for the wrong persona: %', bad; end if;

  /* ASSERT-3: both say the thing the whole boundary rests on. An account that
     believes it has negotiated pricing and has not is a conversation nobody
     wants to have at invoice time. */
  select string_agg(id, ', ') into bad from public.kb_articles
   where view in ('op-contracts', 'en-agreement')
     and body::text not ilike '%price published%'
     and body::text not ilike '%published price%'
     and body::text not ilike '%published for its market%'
     and body::text not ilike '%published for your market%';
  if bad is not null then
    raise exception 'agreement help that does not say prices are the published ones: %', bad;
  end if;

  /* ASSERT-4: one article per screen, still. */
  select string_agg(view || ' x' || c, ', ') into bad from (
    select view, count(*) c from public.kb_articles
     where view in ('op-contracts', 'en-agreement') group by view having count(*) > 1) t;
  if bad is not null then raise exception 'screens with more than one help article: %', bad; end if;

  /* ASSERT-5: and no id was reused. */
  select count(*) into n from (
    select id from public.kb_articles group by id having count(*) > 1) t;
  if n <> 0 then raise exception '% duplicated article ids', n; end if;
end $$;
