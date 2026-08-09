/* Help for the credit screen.
 *
 * Id computed rather than typed, for the fourth time and the same reason: a
 * hardcoded `KB-O24` once silently replaced the Refunds article.
 */

do $$
declare op_id text;
begin
  select 'KB-O' || (coalesce(max(substring(id from 'KB-O(\d+)')::int), 0) + 1)
    into op_id from public.kb_articles where id ~ '^KB-O\d+$';

  if exists (select 1 from public.kb_articles where id = op_id) then
    raise exception 'the next free id is not free: %', op_id;
  end if;
  if exists (select 1 from public.kb_articles where view = 'op-credit') then
    raise notice 'the credit article is already in place';
    return;
  end if;

  insert into public.kb_articles
    (id, persona, personas, kind, title, mins, updated, view, roles, tags, summary, body, status, sort_order)
  values
    (op_id, 'operator', array['operator'], 'howto',
     'Credit, deposits and what a hold actually does', 7, current_date, 'op-credit',
     array['OR-ADMIN', 'OR-FIN'], array['credit', 'money', 'risk', 'settlement'],
     'Two risks running in opposite directions, why the instruments differ, and what happens between an approval and an order when an account is past its limit.',
     jsonb_build_array(
       jsonb_build_array(
         'Two risks, running opposite ways',
         'A business account owes us: they buy on terms, so between the order and the payment we have lent them the goods. The instrument is a limit. A seller is owed by us, so the exposure runs the other way — their refunds, chargebacks and debit notes can exceed their sales in a period and leave us out of pocket. Nobody extends credit to a seller; the instrument there is security, meaning a deposit and a rolling reserve. One screen, because it is one question, but do not expect the two halves to look alike.'),
       jsonb_build_array(
         'Retail is neither, and that is deliberate',
         'A shopper pays at checkout, so there is nothing to assess and nothing to hold. That is recorded as a boundary rather than left as a gap — if a retail credit question ever arrives, it is a new decision and not an oversight to patch.'),
       jsonb_build_array(
         'Exposure is what is owed plus what is committed',
         'Open, overdue and disputed invoices, plus every approved requisition that has not reached a paid invoice yet. The committed half is the half people forget: a limit checked against invoices alone is checked after the decision that mattered, because by the time it is an invoice the goods have gone.'),
       jsonb_build_array(
         'Over the limit is a state, not an error',
         'It happens to real accounts and it is what the control working looks like. What must never happen is it being quiet, so every figure on this screen leads with it. An account over its limit whose review still calls it low risk is the case to look for — that is how a red number stays invisible for a quarter.'),
       jsonb_build_array(
         'What a hold does, and what it does not',
         'When an approval would take an account past its limit, the requisition is approved and held. Approving is a decision the account is entitled to make and it is recorded as one. Sending the order is what commits us, so that is what stops: nothing goes to the seller, and the requisition appears here with the arithmetic that held it. The buyer''s approver is told at the moment they approve, not afterwards.'),
       jsonb_build_array(
         'Releasing one',
         'Only the marketplace can, and only with a reason. The reason is not a formality — a hold lifted with nothing recorded is a limit that does not exist, and the next person sees an approved purchase over the limit with no account of why anybody was comfortable. Releasing places the order that was waiting, in the same act, so a release is finished when you press it rather than being a flag somebody has to follow up.'),
       jsonb_build_array(
         'Every limit traces to a review',
         'A limit with no assessment behind it is a number somebody typed. Each one carries what was looked at, what was concluded, who concluded it and when it is next due. Reviews supersede rather than overwrite, because the previous view of an account is how anybody judges whether this one is an improvement.'),
       jsonb_build_array(
         'The band decides the cadence too',
         'High risk and refused are looked at quarterly, watch every six months, low risk annually. That follows the band automatically — you do not choose a date. It is worth knowing because it was not always true: the file was seeded with a year for every buyer whatever their band, which made the band a label rather than a rating.'),
       jsonb_build_array(
         'What we hold from a seller, and what it covers',
         'Cover is the deposit plus the reserve against what we currently owe them. Only the shortfall matters — holding more than we owe is not extra safety, it is their money sitting with us for no reason. The rates come from the seller''s own book rather than a flat bond: how long they have traded, what has been disputed, what has been charged back, and what they refund.'),
       jsonb_build_array(
         'Nothing settles negative',
         'A statement whose deductions exceed its sales would invoice a seller for having traded with us. The database refuses it. Carry the shortfall to the next period instead, which moves it rather than zeroing a figure somebody did not like — the money is still owed and still visible.'),
       jsonb_build_array(
         'Never one total',
         'Four currencies trade here and a limit is never compared across them. "Total exposure" over the whole book is a quantity of nothing, so the rollups are per currency and always will be.')
     ),
     'published', 20);

  raise notice 'credit article %', op_id;
end $$;

/* ---- What has to be true ------------------------------------------------------- */

do $$
declare n int; bad text;
begin
  /* ASSERT-1: it is there, published, and long enough to be worth opening. */
  select count(*) into n from public.kb_articles
   where view = 'op-credit' and status = 'published' and jsonb_array_length(body) >= 8;
  if n <> 1 then
    raise exception 'the credit article is missing, unpublished or too thin (% found)', n;
  end if;

  /* ASSERT-2: exactly one article per operator screen. Two articles on one view
     is how the wrong one gets read for a year. */
  select string_agg(view || ' x' || c, ', ') into bad from (
    select view, count(*) c from public.kb_articles
     where persona = 'operator' and view is not null group by view having count(*) > 1) t;
  if bad is not null then
    raise exception 'operator screens with more than one help article: %', bad;
  end if;

  /* ASSERT-3: and it did not land on top of another article's id. */
  select count(*) into n from (
    select id from public.kb_articles group by id having count(*) > 1) t;
  if n <> 0 then raise exception '% duplicated article ids', n; end if;
end $$;
